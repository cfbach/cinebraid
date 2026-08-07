/* CineBraid declared-entity continuity — the deterministic comparison route.

   The model NEVER compares frames. Each frame is observed once, on its own,
   and CineBraid compares the two cached observations by stable entity id. The
   architectural payoff is measured here in provider request counts: a warm
   comparison must make ZERO model calls, and six frames must cost six
   observations no matter how many of the fifteen pairs are compared.

   Everything runs against a local mock OpenAI-compatible endpoint.
   Offline. No provider, no network, no model. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-continuity-compare-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "compare-project");
const TAKES = path.join(PROJECT_DIR, "shots", "S-01", "takes");

let upstream = null, upstreamPort = 0, ollamaPort = 0, ollamaServer = null;
let child = null, base = "", output = "";
let visionRequests = [];
/* frame file name -> reply for that image */
const replies = new Map();

const PNG_BASE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
/* Distinct bytes per frame so each has its own content identity. */
function frameBytes(tag) {
  return Buffer.concat([Buffer.from(PNG_BASE, "base64"), Buffer.from(`::${tag}`)]);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve({}); } });
  });
}
const imageParts = (body) => (Array.isArray(body?.messages?.[1]?.content) ? body.messages[1].content.filter((p) => p?.type === "image_url") : []);
async function request(url, options) {
  const response = await fetch(base + url, options);
  return { response, body: await response.json().catch(() => ({})) };
}
const post = (url, payload) => request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const compare = (payload) => post("/api/continuity/compare", payload);
const observe = (payload) => post("/api/continuity/observe", payload);
const purgeAll = () => request("/api/continuity/cache", { method: "DELETE" });

const ENTITIES = ["CHAR-KAI", "PROP-MUG"];
function record(patch = {}) {
  return { presence: "present", occlusion: "none", identifiable: "yes", bbox: [100, 100, 200, 200], color: "white", state: "not-applicable", markings: "not-applicable", evidence: "visible", ...patch };
}
const absentRecord = () => ({ presence: "absent", occlusion: "not-applicable", identifiable: "no", bbox: null, color: "not-applicable", state: "not-applicable", markings: "not-applicable", evidence: "gone" });
function reply(perEntity = {}) {
  const entities = {};
  for (const id of ENTITIES) entities[id] = perEntity[id] || record();
  return JSON.stringify({ coordinate_mode: "permille", entities });
}
/* Which frame an inbound request is about, identified by its image bytes. */
function frameOfRequest(body) {
  const url = imageParts(body)[0]?.image_url?.url || "";
  const b64 = url.split("base64,")[1] || "";
  const text = Buffer.from(b64, "base64").toString("latin1");
  const match = /::([A-Za-z0-9_-]+)$/.exec(text);
  return match ? match[1] : "";
}

const STATES = [
  { id: "state-default", name: "Default", notes: "Primary approved reference.", isDefault: true },
  { id: "state-jacket-off", name: "Jacket off", notes: "Jacket removed.", isDefault: false, parentStateId: "state-default" },
];
function buildProject(overrides = {}) {
  const frames = ["a", "b", "c", "d", "e", "f"];
  return {
    meta: { title: "Compare Project", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [{ id: "CHAR-KAI", name: "Kai", block: "Late-30s, lean.", continuityStates: STATES }],
    props: [{ id: "PROP-MUG", name: "Enamel mug", description: "White enamel mug.", continuityStates: STATES }],
    locations: [{ id: "LOC-BRIDGE", name: "Bridge", description: "Steel footbridge.", continuityStates: STATES }],
    vehicles: [], audio: [], mediaAssets: [], scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{
      id: "S-01", scene: "SC-01", title: "Shot one", desc: "Kai and the mug.",
      characters: ["CHAR-KAI"], codes: [],
      creationBrief: { propIds: ["PROP-MUG"], vehicleIds: [], frameWorkflows: {} },
      continuityStateSelections: {},
      keyframes: frames.map((f) => ({ id: `frame-${f}`, label: f.toUpperCase(), winner: `${f.toUpperCase()}.png`, required: true, generationPackages: [] })),
      clips: [], candidateFiles: [],
      ...overrides,
    }],
    agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  };
}
function writeProject(project) {
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(project, null, 2));
}
function writeConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "compare-project",
    assistant: { provider: "custom", visionProvider: "ollama" },
    routing: { extract: "assistant", bulk: "assistant", draft: "assistant", prompt: "assistant", critic: "assistant", embed: "ollama" },
    customBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    customModel: "nemotron_3_nano_omni", customVisionModel: "nemotron_3_nano_omni",
    continuity: { visionProvider: "custom", visionModel: "nemotron_3_nano_omni" },
    ollamaUrl: `http://127.0.0.1:${ollamaPort}`, ollamaModel: "local-text-model", ollamaVisionModel: "local-vision-model",
  }, null, 2));
}
const findingFor = (body, entityId, kind) => (body.changes || []).find((row) => row.entity_id === entityId && (!kind || row.kind === kind));

async function main() {
  upstreamPort = await freePort();
  ollamaPort = await freePort();
  upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "nemotron_3_nano_omni" }] }));
    if (req.url.endsWith("/chat/completions")) {
      const parts = imageParts(body);
      if (parts.length) visionRequests.push(body);
      const frame = frameOfRequest(body);
      const content = replies.get(frame) ?? reply();
      return res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((r) => upstream.listen(upstreamPort, "127.0.0.1", r));
  ollamaServer = http.createServer(async (req, res) => {
    await readBody(req);
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "local-vision-model" }] }));
    res.end(JSON.stringify({ message: { content: "{}" } }));
  });
  await new Promise((r) => ollamaServer.listen(ollamaPort, "127.0.0.1", r));

  fs.mkdirSync(TAKES, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"]) fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  for (const f of ["A", "B", "C", "D", "E", "F"]) fs.writeFileSync(path.join(TAKES, `${f}.png`), frameBytes(f));
  writeProject(buildProject());
  writeConfig();

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT, CINEBRAID_AI_VISION_TIMEOUT_MS: "6000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (c) => { output += c; });
  child.stderr.on("data", (c) => { output += c; });
  const deadline = Date.now() + 12000;
  for (;;) {
    try { if ((await fetch(base + "/api/me")).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 75));
  }

  /* ---- 1. cold A + cold B: two single-image observations, never a pair ---- */
  visionRequests = [];
  let result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" });
  assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
  assert.strictEqual(visionRequests.length, 2, "a cold comparison must make exactly two observations");
  for (const body of visionRequests) assert.strictEqual(imageParts(body).length, 1, "no request may ever carry two images — the model never compares frames");
  assert.strictEqual(result.body.engine.modelComparisonCalls, 0);
  assert.strictEqual(result.body.engine.providerRequests, 2);
  assert.strictEqual(result.body.observations.a.cached, false);
  assert.strictEqual(result.body.observations.b.cached, false);
  assert.notStrictEqual(result.body.observations.a.imageHash, result.body.observations.b.imageHash);

  /* ---- 2. warm A + warm B: ZERO provider requests ---- */
  visionRequests = [];
  result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" });
  assert.strictEqual(visionRequests.length, 0, "a warm comparison must make NO model call at all");
  assert.strictEqual(result.body.engine.providerRequests, 0);
  assert.strictEqual(result.body.observations.a.cached, true);
  assert.strictEqual(result.body.observations.b.cached, true);

  /* ---- 3. warm A + cold C: exactly one new observation ---- */
  visionRequests = [];
  result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-c" });
  assert.strictEqual(visionRequests.length, 1, "an already-observed frame must be reused");
  assert.strictEqual(result.body.observations.a.cached, true);
  assert.strictEqual(result.body.observations.b.cached, false);

  /* ---- 4. identical observations are stable ---- */
  assert.deepStrictEqual(result.body.changes, [], "identical observations must produce no change");
  assert.strictEqual(result.body.summary.label, "no-change");
  assert.strictEqual(result.body.summary.needsReview, false);
  assert.strictEqual(result.body.comparisonVersion, "continuity-comparison-v1");

  /* ---- 5. presence loss reproduces the Phase 1 finding ---- */
  replies.set("D", reply({ "PROP-MUG": absentRecord() }));
  await purgeAll();
  visionRequests = [];
  result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-d" });
  const lost = findingFor(result.body, "PROP-MUG", "removed");
  assert(lost, `expected a presence loss, got ${JSON.stringify(result.body.changes)}`);
  assert.strictEqual(lost.attribute, "presence");
  assert.strictEqual(lost.label, "possible-continuity-error");
  assert.strictEqual(result.body.summary.label, "possible-continuity-error");
  assert.strictEqual(result.body.summary.content, "possible-continuity-error");

  /* ---- 6. a declared expected change stays visible, reclassified ---- */
  let project = buildProject();
  project.shots[0].continuityIntent = { "PROP-MUG": { allowPresenceChange: "may-leave" } };
  writeProject(project);
  result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-d" });
  const expected = findingFor(result.body, "PROP-MUG", "removed");
  assert(expected, "an expected change must remain VISIBLE, not be deleted");
  assert.strictEqual(expected.label, "intended");
  assert.strictEqual(expected.intentSource, "allowance");
  assert.strictEqual(result.body.summary.label, "intended");
  /* Declared free text that names the entity but a different change must not pass. */
  project.shots[0].continuityIntent = { "PROP-MUG": { expected: ["the enamel mug is repainted"] } };
  writeProject(project);
  result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-d" });
  assert.strictEqual(findingFor(result.body, "PROP-MUG", "removed").label, "possible-continuity-error");
  assert.strictEqual(result.body.summary.label, "human-review", "a near-miss intent note must force human review");
  writeProject(buildProject());

  /* ---- 7/8. the human-review floor survives the route ----

     Heavy occlusion and uncertainty can never become a presence finding. */
  replies.set("E", reply({ "PROP-MUG": record({ occlusion: "heavy" }) }));
  await purgeAll();
  result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-e" });
  assert.strictEqual(result.body.summary.label, "human-review", "heavy occlusion must reach human review");
  assert(result.body.uncertain.some((row) => row.kind === "occlusion-transition"));
  assert(!(result.body.changes || []).some((row) => row.kind === "removed" || row.kind === "added"), "occlusion must never manufacture a presence finding");

  replies.set("F", reply({ "PROP-MUG": { presence: "uncertain", occlusion: "uncertain", identifiable: "uncertain", bbox: null, color: "uncertain", state: "uncertain", markings: "uncertain", evidence: "unclear" } }));
  await purgeAll();
  result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-f" });
  assert.strictEqual(result.body.summary.label, "human-review");
  assert(result.body.presenceUncertain.some((row) => row.entity_id === "PROP-MUG"));
  assert(!(result.body.changes || []).some((row) => ["removed", "added"].includes(row.kind)), "an uncertain reading must never become presence lost or gained");
  replies.clear();

  /* ---- 9. frames whose manifests differ are handled safely ----

     A frame-level declared state selection is honoured by the Phase 1 builder,
     so the two frames can legitimately carry different manifests. Entities
     present on only one side surface as missing records, not as inventions. */
  project = buildProject();
  project.shots[0].creationBrief.frameWorkflows = { "frame-b": { characterStateSelections: { "CHAR-KAI": "state-jacket-off" } } };
  writeProject(project);
  await purgeAll();
  visionRequests = [];
  result = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" });
  assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
  assert.strictEqual(visionRequests.length, 2);
  /* Same observation-relevant manifest (declared state is a cb_ annotation), so
     the comparison is well-formed and the declared difference is visible. */
  assert.strictEqual(result.body.observations.a.manifestHash, result.body.observations.b.manifestHash);
  assert.strictEqual(result.body.summary.nEntities, 2);

  /* An entity declared on one frame only. */
  project = buildProject();
  project.shots[0].codes = ["LOC-BRIDGE"];
  writeProject(project);
  await purgeAll();
  const withLocation = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" });
  assert.strictEqual(withLocation.body.summary.nEntities, 3, "a newly declared entity must join the comparison");
  writeProject(buildProject());

  /* ---- 10. unknown shot / frame fail as client errors ---- */
  assert.strictEqual((await compare({ shotId: "NOPE", frameA: "frame-a", frameB: "frame-b" })).response.status, 404);
  assert.strictEqual((await compare({ shotId: "S-01", frameA: "frame-zzz", frameB: "frame-b" })).response.status, 404);
  assert.strictEqual((await compare({ shotId: "S-01", frameA: "frame-a" })).response.status, 400);
  assert.strictEqual((await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-a" })).response.status, 400, "comparing a frame with itself is refused");
  const traversal = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b", fileNameB: "../../../../etc/passwd" });
  assert.strictEqual(traversal.response.status, 400, "a traversal attempt must be refused");

  /* ---- 11. removing the source image does not resurrect stale evidence ----

     The cache is keyed on content that must be read from disk to be known, so
     a missing file cannot be served from cache on identifiers alone. */
  await purgeAll();
  await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" });
  const removed = path.join(TAKES, "B.png");
  const keep = fs.readFileSync(removed);
  fs.unlinkSync(removed);
  const missing = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" });
  assert.strictEqual(missing.response.status, 400, "a comparison against a deleted image must fail, not serve cached evidence");
  assert(/not available/i.test(missing.body.error), missing.body.error);
  /* Restoring the identical bytes makes the original evidence addressable again. */
  fs.writeFileSync(removed, keep);
  visionRequests = [];
  const restored = await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" });
  assert.strictEqual(restored.response.status, 200);
  assert.strictEqual(visionRequests.length, 0, "restoring identical bytes must make the cached evidence addressable again");

  /* ---- 12. the response leaks nothing about the backend ---- */
  const text = JSON.stringify(restored.body);
  assert(!text.includes(`127.0.0.1:${upstreamPort}`), "the provider endpoint must never reach the client");
  assert(!text.includes("/v1"));
  assert(!text.includes(PROJECT_DIR), "no filesystem path may reach the client");
  assert(!text.includes(TEMP));
  assert(!text.includes("base64,"), "no image bytes may reach the client");
  assert(!text.includes("customBaseUrl"));
  /* But the provenance Phase 4 will need IS present. */
  assert.strictEqual(restored.body.engine.provider, "custom");
  assert.strictEqual(restored.body.engine.model, "nemotron_3_nano_omni");
  assert(restored.body.observations.a.imageHash);
  assert(restored.body.observations.a.manifestHash);
  assert(Array.isArray(restored.body.entities));
  assert(restored.body.frameA.fileName && restored.body.frameA.label);

  /* ---- 13. the architectural payoff: six frames, fifteen comparisons ----

     Pairwise model comparison would need one call per pair. Observing once per
     frame and comparing deterministically needs one call per frame. */
  await purgeAll();
  const frames = ["frame-a", "frame-b", "frame-c", "frame-d", "frame-e", "frame-f"];
  visionRequests = [];
  for (const frame of frames) {
    const r = await observe({ shotId: "S-01", frameId: frame });
    assert.strictEqual(r.response.status, 200, JSON.stringify(r.body));
  }
  const observationCalls = visionRequests.length;
  assert.strictEqual(observationCalls, 6, "six frames must cost exactly six observations");

  visionRequests = [];
  let pairs = 0;
  const started = process.hrtime.bigint();
  for (let i = 0; i < frames.length; i++)
    for (let j = i + 1; j < frames.length; j++) {
      const r = await compare({ shotId: "S-01", frameA: frames[i], frameB: frames[j] });
      assert.strictEqual(r.response.status, 200, `${frames[i]} vs ${frames[j]}: ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.engine.providerRequests, 0);
      pairs += 1;
    }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.strictEqual(pairs, 15, "six frames make fifteen pairs");
  assert.strictEqual(visionRequests.length, 0, "fifteen warm comparisons must make ZERO model calls");
  console.log(`Six frames -> 6 observations supporting all 15 pairwise comparisons: ${visionRequests.length} model calls for the comparisons, ${elapsedMs.toFixed(0)}ms total (pairwise model comparison would have needed 15 calls).`);

  /* ---- 14. the answer a user-facing surface is given ----------------------

     Phase 4 renders this response and decides nothing of its own, so the route
     has to hand over the five-value outcome, the described findings and an
     explicit statement about whether the analysis itself was usable. */
  await purgeAll();
  replies.set("A", reply());
  replies.set("B", reply({ "PROP-MUG": absentRecord() }));
  let described = (await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" })).body;
  assert.deepStrictEqual(Object.keys(described.outcomeCounts).sort(), ["expected", "issue", "review", "stable", "uncertain"], "the response must count all five outcomes");
  assert.strictEqual(described.analysis.usable, true, "two usable observations make a usable analysis");
  assert.deepStrictEqual(described.analysis.unusableFrames, []);
  const mug = described.entities.find((row) => row.entityId === "PROP-MUG");
  assert.strictEqual(mug.outcome, "issue", "an undeclared presence loss must arrive already classed as an issue");
  assert.strictEqual(mug.findings[0].headline, "Presence changed", "the finding must arrive in production English");
  assert.deepStrictEqual([mug.findings[0].from, mug.findings[0].to], ["present", "absent"], "the transition must carry the specifics the headline leaves out");
  /* Nothing may restate the transition in prose underneath it. */
  assert.strictEqual(mug.findings[0].detail, "", "a presence change is fully said by its transition and needs no detail sentence");
  assert.strictEqual(mug.findings[0].canMarkExpected, true, "a real change must arrive declarable");
  assert.deepStrictEqual(mug.findings[0].expectedAction, { target: "intent", field: "allowPresenceChange", value: "may-leave" }, "the declaration to write must arrive with the finding");
  const kai = described.entities.find((row) => row.entityId === "CHAR-KAI");
  assert.strictEqual(kai.outcome, "stable", "an unchanged entity must arrive stable");
  /* No card may need a flag code, a bbox or a coordinate mode to be rendered. */
  const cardJson = JSON.stringify(described.entities);
  for (const token of ["coordinate_mode", "permille", "invalid_enum", "invalid_coordinate_mode", "untracked_attribute_discarded"])
    assert(!cardJson.includes(token), `the per-entity rollup leaked contract internals ("${token}")`);

  /* And a set-wide integrity failure is reported as an analysis failure rather
     than as a shot full of continuity breaks. */
  await purgeAll();
  replies.set("B", JSON.stringify({ coordinate_mode: "pixels", entities: { "CHAR-KAI": record(), "PROP-MUG": record() } }));
  described = (await compare({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" })).body;
  assert.strictEqual(described.analysis.usable, false, "a wrong coordinate frame must make the analysis unusable");
  assert.deepStrictEqual(described.analysis.unusableFrames.map((row) => row.side), ["b"], "the unusable side must be named so it can be re-observed");
  replies.delete("B");

  console.log("Continuity compare-route suite passed: a cold comparison makes exactly two single-image observations and never a pairwise request, a warm comparison makes none, a half-warm one makes exactly one; identical observations are stable, presence loss reproduces the Phase 1 finding, declared intent reclassifies without hiding, near-miss intent forces review, heavy occlusion and uncertainty can never become a presence finding, differing frame manifests are compared safely, unknown and unsafe inputs are refused, a deleted image cannot serve stale evidence, the response leaks no path, endpoint or image bytes, and every finding arrives already classed, already described and already carrying the declaration that would make it expected.");
}

main()
  .then(() => { child?.kill(); upstream?.close(); ollamaServer?.close(); fs.rmSync(TEMP, { recursive: true, force: true }); process.exit(0); })
  .catch((error) => {
    console.error(error.stack || error.message || error);
    if (output) console.error("--- server output ---\n" + output);
    child?.kill(); upstream?.close(); ollamaServer?.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
    process.exit(1);
  });

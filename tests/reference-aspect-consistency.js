/* One shape per reference generation, proved on the receipt.

   The Scenario A acceptance run submitted a durable character reference and the
   two halves of the same request disagreed:

     outbound FAL request   aspectRatio "3:4"  ->  image_size 768 x 1024
     compiled prompt        "16:9 composition" ... "Output at 16:9"
     what came back         portrait

   The request won, which is the only reason the frame was usable at all. The
   prompt was arguing with it the whole time, and nothing in the product could
   see that because prompt and request were only ever tested apart.

   The divergence had one cause. The provider request read the reference format
   for the entity list — a character anchor is 3:4, a location plate 16:9, an
   object card 4:3 — while the compiler read the PRODUCTION delivery format off
   `meta.aspectRatio`. Two answers, no shared resolver, no test that ever held
   them up against each other.

   So every test here captures BOTH halves of the SAME operation and asserts
   they agree. Nothing is paid: the provider is a local express mock that
   records what it was sent.

     A  base character / location / prop references agree, prompt and request
     B  a non-default state reference uses the same reference format
     C  a derived edit stays source-preserving and acquires no literal ratio
     D  pass 2 and pass 3 carry pass 1's ratio, even if the project format moves
     E  the resolver and the contradiction detector themselves
     F  the workspace's own automation flow, three passes, against the real
        compiler — including what Reports reads back afterwards
     G  the derived-edit prompt the workspace assembles for itself             */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { spawn } = require("child_process");
const {
  referenceAspectLabel,
  aspectPromptConflicts,
  aspectRatioMentions,
  resolveAspect,
} = require("../public/shared-aspect");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-aspect-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const SLUG = "aspect-project";
const PROJECT_DIR = path.join(PROJECTS_ROOT, SLUG);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=",
  "base64",
);

/* The production format is deliberately widescreen and deliberately written in
   both places a project can carry it. Every literal 16:9 that turns up in a
   reference prompt below came from here. */
/* The creator approved CHAR-MARA's default reference. Derivation and the
   reference-edit profile require CANON on the server too since the closure
   pass, so the server-side fixture carries the receipt a real approved project
   has — the same statement its browser-side twin makes with withCanon(). */
const PROJECT = {
  productionAuthority: {
    version: 1,
    receipts: [{
      id: "authority-000001", sequence: 1, actor: "human", act: "explicit-approval",
      command: "approve-entity-state", kind: "entity-state",
      targetKey: "entity-state:characters:CHAR-MARA#state-default",
      shotId: "", frameId: "", unitKey: "", list: "characters",
      entityId: "CHAR-MARA", stateId: "state-default", slotId: "",
      value: "CHAR-MARA-DEFAULT.png", assetId: "", at: "2026-08-15T00:00:00.000Z",
      status: "current", supersededBy: "", supersededAt: "", revokedAt: "",
      revocationReason: "", note: "",
      provenance: { manualAction: "gesture-aspect-fixture", via: "aspect-fixture", gesture: "click" },
    }],
  },
  meta: {
    title: "Aspect Fixture",
    format: "Short film · 16:9",
    aspectRatio: "16:9",
    world: { setting: "A wet commuter platform at night." },
  },
  qcChecklist: [],
  characters: [{
    id: "CHAR-MARA",
    name: "Mara Venn",
    creationDescription: "Field investigator in her forties, soaked wool coat, hair flattened by rain.",
    approvedFile: "CHAR-MARA-DEFAULT.png",
    workflowStatus: "DRAFT",
    candidateFiles: [],
    continuityStates: [
      { id: "state-default", name: "Rain-soaked arrival", isDefault: true, approvedFile: "CHAR-MARA-DEFAULT.png", notes: "Coat soaked through, hair flattened." },
      { id: "state-dry", name: "Dried off", isDefault: false, approvedFile: "", notes: "Coat dry, hair loose and lifted.", parentStateId: "state-default", generationMode: "derive" },
    ],
  }],
  locations: [{
    id: "LOC-PLATFORM",
    name: "Commuter platform",
    creationDescription: "Open-air platform, tiled canopy, two benches, sodium lighting.",
    workflowStatus: "DRAFT",
    candidateFiles: [],
  }],
  props: [{
    id: "PROP-CASE",
    name: "Evidence case",
    creationDescription: "Scuffed aluminium case with a stencilled inventory number.",
    workflowStatus: "DRAFT",
    candidateFiles: [],
  }],
  vehicles: [],
  scenes: [],
  shots: [],
  mediaAssets: [],
};

/* ------------------------------------------------------- provider + server */

const providerCalls = [];
let mockOrigin = "";
let appServer = null;
let child = null;
let PORT = 0;
let base = "";
let serverOutput = "";

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function startMockProvider() {
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    const id = `req-${providerCalls.length + 1}`;
    providerCalls.push({ edit: req.path.endsWith("/edit"), body: req.body });
    res.json({
      request_id: id,
      status_url: `${mockOrigin}/status/${id}`,
      response_url: `${mockOrigin}/result/${id}`,
      cancel_url: `${mockOrigin}/cancel/${id}`,
    });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => res.json({ images: [{ url: `${mockOrigin}/image/${req.params.id}.png`, width: 1, height: 1 }] }));
  mock.get("/image/:name", (req, res) => res.type("png").send(PNG));
  mock.put("/cancel/:id", (req, res) => res.json({ ok: true }));
  appServer = await listen(mock);
  mockOrigin = `http://127.0.0.1:${appServer.address().port}`;
}

async function freePort() {
  const net = require("net");
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer() {
  PORT = await freePort();
  base = `http://127.0.0.1:${PORT}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      CINEBRAID_CONFIG_PATH: CONFIG_PATH,
      CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
      CINEBRAID_AI_TEXT_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk; });
  child.stderr.on("data", (chunk) => { serverOutput += chunk; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const result = await fetch(`${base}/api/me`);
      if (result.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Server did not start. Output:\n${serverOutput}`);
}

async function request(url, options = {}) {
  const response = await fetch(base + url, options);
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
  return { response, body };
}
const post = (url, payload) => request(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

/* --------------------------------------------------------------- receipts */

/* The compiled prompt for a reference, straight off the route the reference
   workspace and durable automation both call. */
async function compile(payload) {
  const result = await post("/api/prompt/asset-compile", { useLLM: false, ...payload });
  assert.strictEqual(result.response.status, 200, `asset-compile failed: ${JSON.stringify(result.body)}`);
  return String(result.body.compiledPrompt || "");
}

/* The bytes that would have been charged for, for that same prompt. Returns the
   provider input as sent, so image_size is the real one and not a re-derivation. */
async function dispatch(payload) {
  const before = providerCalls.length;
  const submitted = await post("/api/generation/fal/jobs", { purpose: "entity-reference", outputCount: 1, quality: "high", resolution: "1k", ...payload });
  assert(submitted.response.ok, `fal submit failed: ${JSON.stringify(submitted.body)}`);
  assert.strictEqual(providerCalls.length, before + 1, "exactly one provider request per submission");
  /* The concurrency guard is real and shared with production: settle this job
     before asking for the next one. */
  const settled = await post(`/api/generation/fal/jobs/${submitted.body.job.id}/refresh`, {});
  assert(settled.response.ok, `refresh failed: ${JSON.stringify(settled.body)}`);
  return { job: submitted.body.job, sent: providerCalls[providerCalls.length - 1] };
}

/* The whole point of the suite: hold the two halves up against each other. */
function assertReceiptAgrees(label, prompt, sent, expectedRatio) {
  const wanted = resolveAspect(expectedRatio);
  assert(wanted, `${label}: ${expectedRatio} is not a resolvable ratio`);

  const conflicts = aspectPromptConflicts(prompt, expectedRatio);
  assert.deepStrictEqual(conflicts, [],
    `${label}: the prompt tells the model ${conflicts.join(", ")} while the request asks for ${expectedRatio}`);

  const size = sent.body?.image_size;
  assert(size && size.width > 0 && size.height > 0, `${label}: the provider request carried no image_size`);
  const sentRatio = size.width / size.height;
  assert(Math.abs(sentRatio - wanted.ratio) / wanted.ratio < 0.01,
    `${label}: the provider was sent ${size.width}x${size.height} (${sentRatio.toFixed(3)}) for a ${expectedRatio} request`);

  /* Orientation in words, not only in numbers. "Output at 3:4" and "widescreen
     composition" are the same contradiction written two ways, and the run that
     started this repair contained both. */
  const portrait = wanted.ratio < 1;
  const forbidden = portrait
    ? /widescreen|landscape composition|horizontal framing/i
    : /portrait composition|vertical framing/i;
  const offending = prompt.match(forbidden);
  assert(!offending, `${label}: the prompt says "${offending?.[0]}" for a ${expectedRatio} request`);
}

/* ------------------------------------------------------------------ tests */

/* A — the three base reference formats, each proved on its own receipt. */
async function testBaseReferences() {
  const cases = [
    { list: "characters", id: "CHAR-MARA", entityType: "character", expected: "3:4" },
    { list: "locations", id: "LOC-PLATFORM", entityType: "location", expected: "16:9" },
    { list: "props", id: "PROP-CASE", entityType: "prop", expected: "4:3" },
  ];
  for (const item of cases) {
    assert.strictEqual(referenceAspectLabel(item.list), item.expected,
      `${item.list} must resolve to ${item.expected}`);
    const prompt = await compile({ list: item.list, id: item.id, profileId: "gpt-image-2/t2i" });
    const { sent } = await dispatch({
      entityList: item.list, entityId: item.id, entityType: item.entityType,
      sourceBuildId: `build-${item.id}`, prompt,
      aspectRatio: referenceAspectLabel(item.list),
    });
    assertReceiptAgrees(`base ${item.list}`, prompt, sent, item.expected);
    assert.strictEqual(sent.body.prompt, prompt, "the provider must be sent the compiled prompt, unedited");
  }

  /* The specific defect, named. A 16:9 project compiling a character reference
     used to write the production format into the prompt while the request asked
     for a portrait. */
  const characterPrompt = await compile({ list: "characters", id: "CHAR-MARA", profileId: "gpt-image-2/t2i" });
  assert(!/16:9/.test(characterPrompt),
    "a character reference prompt must not carry the production 16:9 format");
  assert(/3:4/.test(characterPrompt),
    "a character reference prompt must state the 3:4 shape the request asks for");

  /* And the mirror: a location reference IS 16:9, so 16:9 belongs in its prompt
     and 3:4 does not. A fix that simply deleted ratio prose would pass the test
     above and fail this one. */
  const locationPrompt = await compile({ list: "locations", id: "LOC-PLATFORM", profileId: "gpt-image-2/t2i" });
  assert(/16:9/.test(locationPrompt), "a location plate is 16:9 and may say so");
  assert(!/3:4/.test(locationPrompt), "a location prompt must not carry a character's format");
}

/* B — a non-default state generated independently is still a reference. */
async function testStateReference() {
  const prompt = await compile({
    list: "characters", id: "CHAR-MARA", stateId: "state-dry",
    generationMode: "independent", profileId: "gpt-image-2/t2i",
  });
  const { sent } = await dispatch({
    entityList: "characters", entityId: "CHAR-MARA", entityType: "character",
    continuityStateId: "state-dry", continuityStateName: "Dried off",
    derivationMode: "independent", sourceBuildId: "build-state-dry", prompt,
    aspectRatio: referenceAspectLabel("characters"),
  });
  assertReceiptAgrees("independent state", prompt, sent, "3:4");
  assert(/Dried off|Coat dry/i.test(prompt), "the state must actually be in the prompt being judged");
}

/* C — a derived edit takes its shape from the parent it is editing. It may say
   so in words; what it may not do is name a ratio the request never authorised. */
async function testDerivedEdit() {
  fs.writeFileSync(path.join(PROJECT_DIR, "anchors", "CHAR-MARA-DEFAULT.png"), PNG);
  const prompt = await compile({
    list: "characters", id: "CHAR-MARA", stateId: "state-dry",
    parentStateId: "state-default", generationMode: "derive",
    profileId: "gpt-image-2/edit",
  });
  assert(/source aspect ratio/i.test(prompt),
    "a derived edit must tell the model to keep the parent's shape");
  assert.deepStrictEqual(aspectRatioMentions(prompt), [],
    "a source-preserving edit must not name a literal ratio at all");

  const { sent, job } = await dispatch({
    entityList: "characters", entityId: "CHAR-MARA", entityType: "character",
    continuityStateId: "state-dry", continuityStateName: "Dried off",
    parentStateId: "state-default", parentStateName: "Rain-soaked arrival",
    parentApprovedFile: "CHAR-MARA-DEFAULT.png", derivationMode: "derive",
    sourceBuildId: "build-state-dry-derive", prompt,
    references: [{ key: "state-parent", label: "Rain-soaked arrival reference", role: "base", url: "/assets/anchors/CHAR-MARA-DEFAULT.png" }],
    aspectRatio: referenceAspectLabel("characters"),
  });
  assert.strictEqual(job.mode, "edit", "a parent-derived state must dispatch as an edit");
  assert(sent.edit, "a derived state must reach the edit endpoint");
  /* The parent was generated at the character reference format, so the request
     that edits it asks for the same shape. Source-preserving prose and a 3:4
     request are the same instruction; 16:9 prose would not have been. */
  assertReceiptAgrees("derived edit", prompt, sent, "3:4");
}

/* D — the ratio a run was authorised at survives every later pass. */
async function testLaterPassStability() {
  const directives = [
    "",
    "AUTOMATION REVISION\nCORRECT: raise facial exposure so identity is verifiable.",
    "AUTOMATION REVISION\nCORRECT: tighten framing to a full-body anchor.",
  ];
  const receipts = [];
  for (let pass = 1; pass <= 3; pass++) {
    if (pass === 2) {
      /* Mid-run, the production format moves. Reference generation must not
         follow it: the ratio pass 1 was authorised at is the one every later
         pass corrects against, and a prompt that silently changed shape between
         passes would make the pass-to-pass comparison meaningless. */
      const moved = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
      moved.meta.aspectRatio = "9:16";
      moved.meta.format = "Vertical cut · 9:16";
      const saved = await request(`/api/projects/${SLUG}/project`, {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": "*" },
        body: JSON.stringify(moved),
      });
      assert.strictEqual(saved.response.status, 200, `project update failed: ${JSON.stringify(saved.body)}`);
    }
    const prompt = await compile({ list: "characters", id: "CHAR-MARA", profileId: "gpt-image-2/t2i", directive: directives[pass - 1] });
    const { sent } = await dispatch({
      entityList: "characters", entityId: "CHAR-MARA", entityType: "character",
      sourceBuildId: `build-pass-${pass}`, prompt,
      aspectRatio: referenceAspectLabel("characters"),
    });
    assertReceiptAgrees(`pass ${pass}`, prompt, sent, "3:4");
    receipts.push({ prompt, size: sent.body.image_size });
  }
  assert(/raise facial exposure/i.test(receipts[1].prompt), "pass 2 must carry its correction");
  assert(/tighten framing/i.test(receipts[2].prompt), "pass 3 must carry its correction");
  assert.deepStrictEqual(receipts[1].size, receipts[0].size, "pass 2 must render at the pass-1 shape");
  assert.deepStrictEqual(receipts[2].size, receipts[0].size, "pass 3 must render at the pass-1 shape");
  assert(!/9:16/.test(receipts[1].prompt + receipts[2].prompt),
    "a mid-run change to the production format must not reach a reference prompt");
}

/* F — the same question asked of the workspace instead of the API.

   The browser code that a director actually starts is `runEntityAutomation`,
   and it is the layer that chooses the ratio for every pass. It runs here for
   real, against the real compiler: the prompt each pass sends is compiled by the
   server started above, so nothing about the ratio is invented by the stub. What
   is stubbed is the run store, the FAL job (whose submitted body is recorded and
   asserted) and the vision reviewer. */
async function testBrowserAutomationFlow() {
  const vm = require("vm");
  const { render, buildFixture } = require("./render-harness");

  const criteria = (severity, note) => ({
    design: { severity, note }, state: { severity: "pass", note: "State correct." },
    requirements: { severity: "pass", note: "Details present." },
    usefulness: { severity: "pass", note: "Framing fine." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  });
  const review = (score, pass, note) => ({
    score, pass, modelPass: pass, explicitPass: pass, explicitScore: true, autoApprove: pass,
    contractVersion: "reference-authority-v3",
    requiredHardChecks: [], hardChecks: {}, hardGateFailures: pass ? [] : ["score-below-85", "model-did-not-pass"],
    categories: criteria(pass ? "pass" : "major", note),
    summary: note, recommendation: pass ? "approve" : "correct",
  });
  /* Two failed passes so a correction is carried forward twice, then a strong
     third: the ratio has to survive both rewrites. */
  const passes = [
    [{ file: "CHAR-MARA-P1-A.png", review: review(62, false, "Face too dark; eyes difficult to read.") }],
    [{ file: "CHAR-MARA-P2-A.png", review: review(70, false, "Still shadowed across the face.") }],
    [{ file: "CHAR-MARA-P3-A.png", review: review(88, true, "Readable and usable.") }],
  ];
  const reviewsByFile = new Map(passes.flat().map((row) => [row.file, row.review]));
  const allFiles = passes.flat().map((row) => row.file);

  const project = buildFixture();
  project.meta.aspectRatio = "16:9";
  project.meta.format = "Short film · 16:9";
  project.characters = [{
    id: "CHAR-MARA", name: "Mara Venn", status: "IN PROGRESS", workflowStatus: "IN PROGRESS",
    creationDescription: "Field investigator in her forties, soaked wool coat, hair flattened by rain.",
    approvedFile: "", candidateFiles: [],
    continuityStates: [{ id: "state-default", name: "Rain-soaked arrival", isDefault: true, notes: "Coat soaked through, hair flattened." }],
  }];

  const submissions = [];
  let RUN = null, jobSeq = 0;
  const rendered = await render("#/character/CHAR-MARA", project, {
    scan: { anchors: allFiles.map((name) => ({ name, url: `/assets/anchors/${name}` })), plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} },
    fetch: async (url, init = {}, respond) => {
      const method = init.method || "GET";
      const body = init.body ? JSON.parse(init.body) : {};
      if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, defaults: {} });
      if (url === "/api/automation/runs" && method === "POST") { RUN = structuredClone(body); RUN.revision = 1; return respond({ run: RUN }); }
      if (/^\/api\/automation\/runs\/[^/]+$/.test(url) && method === "PUT") { RUN = structuredClone(body); RUN.revision = Number(RUN.revision || 1) + 1; return respond({ run: RUN }); }
      if (/^\/api\/automation\/runs\/[^/]+$/.test(url) && method === "GET") return respond({ run: RUN });
      if (url.endsWith("/lease") && method === "POST") {
        RUN = { ...RUN, runnerId: body.runnerId, leaseAcquiredAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 600000).toISOString() };
        return respond({ run: RUN, leaseMs: 600000, heartbeatMs: 300000 });
      }
      if ((url.endsWith("/heartbeat") || url.endsWith("/lease/revalidate")) && method === "POST") {
        RUN = { ...RUN, leaseExpiresAt: new Date(Date.now() + 600000).toISOString() };
        return respond({ run: RUN });
      }
      if (url.endsWith("/release") && method === "POST") return respond({ run: RUN });
      /* Not a stub: the real compiler, on the real server, for the real project
         above — which declares a 16:9 production format. */
      if (url === "/api/prompt/asset-compile" && method === "POST") {
        const compiled = await post("/api/prompt/asset-compile", { ...body, list: "characters", id: "CHAR-MARA" });
        return respond(compiled.body);
      }
      if (url === "/api/generation/fal/jobs" && method === "POST") {
        const pass = passes[submissions.length];
        assert(pass, `pass ${submissions.length + 1} was never authorised`);
        submissions.push({ aspectRatio: body.aspectRatio, prompt: String(body.prompt || "") });
        jobSeq += 1;
        return respond({ ok: true, job: { id: `job-${jobSeq}`, status: "COMPLETED", purpose: "entity-reference", model: "GPT Image 2", outputs: pass.map((row) => ({ name: row.file, url: `/assets/anchors/${row.file}` })) } });
      }
      if (url === "/api/generation/fal/jobs" && method === "GET") return respond({ jobs: [] });
      if (url === "/api/llm/review-entity-candidate" && method === "POST") {
        const found = reviewsByFile.get(body.fileName);
        assert(found, `${body.fileName} was reviewed but never generated`);
        return respond({ review: structuredClone(found), inputLabels: [{ image: 1, fileName: body.fileName, role: "candidate under review" }] });
      }
      return null;
    },
  });
  vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'test'};`, rendered.context);
  const runId = await vm.runInContext(`(async () => {
    const run = v626NewRun("entity-chain", "characters:CHAR-MARA", "default-only", "Mara Venn references", "single-state", {
      list: "characters", entityId: "CHAR-MARA", stateIds: ["state-default"], reuseApproved: true,
      stateRounds: 3, outputsPerRequest: 1, maxImages: 3,
      generationSettings: v6211AutomationGenerationSettings(),
    });
    run.entityList = "characters"; run.entityId = "CHAR-MARA";
    const saved = await v626CreateRun(run);
    await runEntityAutomation(saved.id);
    return saved.id;
  })()`, rendered.context);

  assert.strictEqual(submissions.length, 3, "three authorised passes must have run");
  for (const [index, submission] of submissions.entries()) {
    assert.strictEqual(submission.aspectRatio, "3:4", `pass ${index + 1} must request the character reference format`);
    assert.deepStrictEqual(aspectPromptConflicts(submission.prompt, "3:4"), [],
      `pass ${index + 1} submitted a prompt that disagrees with its own request`);
    assert(!/16:9|widescreen/i.test(submission.prompt),
      `pass ${index + 1} carried the production format into a reference prompt`);
  }
  assert.notStrictEqual(submissions[1].prompt, submissions[0].prompt, "pass 2 must actually be corrected");
  assert.notStrictEqual(submissions[2].prompt, submissions[1].prompt, "pass 3 must actually be corrected");

  /* Reports -> Prompts and revisions renders step.result.prompt. That is the
     record a director reads back afterwards, and it must not disagree either. */
  const run = vm.runInContext(`JSON.parse(JSON.stringify(v626Runs().find((row) => row.id === ${JSON.stringify(runId)})))`, rendered.context);
  const recorded = Object.entries(run.steps)
    .filter(([key]) => /:prompt$/.test(key))
    .map(([key, step]) => ({ key, prompt: String(step.result?.prompt || "") }));
  assert.strictEqual(recorded.length, 3, "every pass must record the prompt it compiled");
  for (const row of recorded) {
    assert(row.prompt, `${row.key} recorded no prompt`);
    assert.deepStrictEqual(aspectPromptConflicts(row.prompt, "3:4"), [],
      `${row.key} is reported with a ratio the run never requested`);
  }
}

/* G — the derived/edit workflow as the workspace builds it. The submitted prompt
   for a parent-derived state is assembled in the browser, not by the compiler,
   so it needs its own proof that it carries no literal ratio. */
async function testBrowserDerivedPrompt() {
  const vm = require("vm");
  const { render, buildFixture, withCanon } = require("./render-harness");
  const project = buildFixture();
  project.meta.aspectRatio = "16:9";
  project.meta.format = "Short film · 16:9";
  project.characters = [{
    id: "CHAR-MARA", name: "Mara Venn", status: "IN PROGRESS", workflowStatus: "IN PROGRESS",
    creationDescription: "Field investigator in her forties, soaked wool coat.",
    approvedFile: "CHAR-MARA-DEFAULT.png", candidateFiles: [],
    continuityStates: [
      { id: "state-default", name: "Rain-soaked arrival", isDefault: true, approvedFile: "CHAR-MARA-DEFAULT.png", notes: "Coat soaked through." },
      { id: "state-dry", name: "Dried off", isDefault: false, approvedFile: "", notes: "Coat dry, hair loose and lifted.", parentStateId: "state-default", generationMode: "derive" },
    ],
  }];
  /* The default state is APPROVED — a receipt, since the acceptance-correction
     pass. An unreceipted parent is historic and travels as context, not as an
     editable base, which is the distinction this assertion is about. */
  withCanon(project, { kind: "entity-state", list: "characters", entityId: "CHAR-MARA", stateId: "state-default", value: "CHAR-MARA-DEFAULT.png" });
  const rendered = await render("#/character/CHAR-MARA", project, {
    scan: { anchors: [{ name: "CHAR-MARA-DEFAULT.png", url: "/assets/anchors/CHAR-MARA-DEFAULT.png" }], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} },
    fetch: async (url, init, respond) => (url === "/api/generation/fal/status" ? respond({ enabled: true, configured: true, defaults: {} }) : null),
  });
  const derived = vm.runInContext(`(() => {
    const entity = P.characters[0];
    const state = entity.continuityStates.find((row) => row.id === "state-dry");
    const refs = entityGenerationReferences("characters", entity, { state, mode: "derive" });
    return {
      role: refs[0] ? refs[0].role : "",
      aspect: referenceAspectLabel("characters"),
      prompt: entityGenerationPrompt("characters", entity, { prompt: "COMPILED REFERENCE INSTRUCTION", profileName: "GPT Image 2" }, refs, { state, mode: "derive" }),
    };
  })()`, rendered.context);

  assert.strictEqual(derived.role, "base", "the approved parent must be the editable base");
  assert.strictEqual(derived.aspect, "3:4", "the request accompanying this prompt is still the character reference format");
  assert(/source aspect ratio/i.test(derived.prompt), "the derived edit must ask for the parent's shape");
  assert.deepStrictEqual(aspectRatioMentions(derived.prompt), [],
    "a source-preserving edit prompt must not acquire a literal ratio");
}

/* E — the resolver and the detector, on their own. */
function testResolverAndDetector() {
  assert.strictEqual(referenceAspectLabel("characters"), "3:4");
  assert.strictEqual(referenceAspectLabel("locations"), "16:9");
  assert.strictEqual(referenceAspectLabel("props"), "4:3");
  assert.strictEqual(referenceAspectLabel("vehicles"), "4:3");
  assert.strictEqual(referenceAspectLabel(""), "4:3", "an unknown list still gets one answer, not undefined");

  assert.deepStrictEqual(aspectPromptConflicts("Output at 16:9 and return one frame.", "3:4"), ["16:9"]);
  assert.deepStrictEqual(aspectPromptConflicts("Output at 3:4 and return one frame.", "16:9"), ["3:4"]);
  assert.deepStrictEqual(aspectPromptConflicts("Output at 3:4.", "3:4"), []);
  assert.deepStrictEqual(aspectPromptConflicts("Return one frame at the source aspect ratio.", "3:4"), []);
  assert.deepStrictEqual(aspectPromptConflicts("Output at 1920:1080.", "16:9"), [],
    "the same ratio written another way is not a contradiction");
  assert.deepStrictEqual(aspectPromptConflicts("Output at 16:9.", ""), ["16:9"],
    "with no authorised ratio, any literal is a contradiction");
  assert.deepStrictEqual(aspectRatioMentions("Hold for 0:05 before the cut."), [],
    "a timecode is not a format");
}

/* -------------------------------------------------------------------- main */


/* ===========================================================================
   CODEX CLOSURE, SERVER SIDE — /api/prompt/asset-compile.

   The browser resolvers were corrected and this route independently
   reintroduced the old rules: it accepted a caller-supplied parent id, fell back
   to the default state when it did not resolve, and shipped a raw `approvedFile`
   as `role: "base"`, `approved: true`, labelled "Approved … reference".

   Both are exercised against the real route, over HTTP, with no provider call. */
async function testServerAncestryAndCanon() {
  /* A — A GHOST PARENT FAILS CLOSED, BEFORE COMPILATION. */
  const ghosted = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
  const mara = ghosted.characters.find((row) => row.id === "CHAR-MARA");
  const dry = mara.continuityStates.find((row) => row.id === "state-dry");
  const realParent = dry.parentStateId;
  dry.parentStateId = "ghost";
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(ghosted, null, 2));

  const ghostResult = await post("/api/prompt/asset-compile", {
    useLLM: false, list: "characters", id: "CHAR-MARA", stateId: "state-dry",
    profileId: "gpt-image-2/edit", generationMode: "derive",
  });
  assert.strictEqual(ghostResult.response.status, 400,
    `a state whose recorded parent is missing must be refused, got ${ghostResult.response.status}`);
  assert.strictEqual(ghostResult.body.code, "STATE_ANCESTRY_UNRESOLVED",
    `and refused for the lineage reason, got ${JSON.stringify(ghostResult.body)}`);
  assert.match(String(ghostResult.body.error || ""), /ghost/,
    "naming the parent the record points at");
  assert(!ghostResult.body.compiledPrompt, "nothing was compiled");

  /* AND IT DOES NOT SILENTLY USE THE DEFAULT STATE, which is what it used to do. */
  assert(!/Rain-soaked arrival/.test(JSON.stringify(ghostResult.body)),
    "the default state must not appear anywhere in the refusal — it is not this state's parent");

  /* B — A HISTORIC PARENT CANNOT BECOME AN APPROVED BASE. */
  const historic = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
  historic.characters.find((row) => row.id === "CHAR-MARA")
    .continuityStates.find((row) => row.id === "state-dry").parentStateId = realParent;
  delete historic.productionAuthority;
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(historic, null, 2));

  const historicResult = await post("/api/prompt/asset-compile", {
    useLLM: false, list: "characters", id: "CHAR-MARA", stateId: "state-dry",
    profileId: "gpt-image-2/edit", generationMode: "derive",
  });
  assert.strictEqual(historicResult.response.status, 400,
    `an unreceipted parent must not become an editable base, got ${historicResult.response.status}`);
  assert.strictEqual(historicResult.body.code, "PARENT_NOT_CANON",
    `and refused for the canon reason, got ${JSON.stringify(historicResult.body)}`);
  const historicPayload = JSON.stringify(historicResult.body);
  assert(!/"role":"base"/.test(historicPayload), "no base reference is emitted");
  assert(!/"approved":true/.test(historicPayload), "nothing is marked approved");
  assert(!/Approved .* reference/.test(historicPayload), "and nothing is labelled an approved reference");

  /* C — THE POSITIVE HALF. With the receipt restored the same request compiles,
         so the two refusals above are not satisfied by everything failing. */
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(PROJECT, null, 2));
  const canonResult = await post("/api/prompt/asset-compile", {
    useLLM: false, list: "characters", id: "CHAR-MARA", stateId: "state-dry",
    profileId: "gpt-image-2/edit", generationMode: "derive",
  });
  assert.strictEqual(canonResult.response.status, 200,
    `a receipt-backed parent still compiles, got ${canonResult.response.status}: ${JSON.stringify(canonResult.body)}`);
  assert(String(canonResult.body.compiledPrompt || "").length > 0, "and returns a prompt");
  console.log("  server · asset-compile resolves exact ancestry, fails closed on a ghost parent, and refuses a historic parent as an approved base");
}

async function main() {
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "shots", "docs"]) {
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(PROJECT, null, 2));

  await startMockProvider();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    generation: {
      fal: {
        enabled: true,
        apiKey: "fal-secret-aspect-test",
        baseUrl: mockOrigin,
        textModel: "openai/gpt-image-2",
        editModel: "openai/gpt-image-2/edit",
        frameOutputs: 1,
        frameQuality: "high",
        frameResolution: "1k",
        maxConcurrent: 1,
      },
    },
  }, null, 2));

  await startServer();
  try {
    testResolverAndDetector();
    await testBaseReferences();
    await testStateReference();
    await testDerivedEdit();
    await testLaterPassStability();
    await testBrowserAutomationFlow();
    await testBrowserDerivedPrompt();
    await testServerAncestryAndCanon();
  } finally {
    if (child) child.kill();
    if (appServer) appServer.close();
  }
  console.log("Reference aspect consistency passed: base, state and derived receipts agree between prompt and provider request, later passes hold the authorised shape, and the contradiction detector catches both directions.");
}

main().catch((error) => {
  console.error(error);
  if (child) child.kill();
  if (appServer) appServer.close();
  process.exit(1);
});

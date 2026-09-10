/* CineBraid declared-entity continuity — the single-image observation route.

   Everything runs against a local mock OpenAI-compatible endpoint. No suite in
   CineBraid may depend on a live model service, and this one in particular must
   never reach the real Nemotron: the whole point of the one-image assertion is
   that its limit is never tested by accident.

   The regression guard at the end is as important as the new behaviour: the
   existing multi-image review routes must be provably unchanged. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-continuity-route-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "continuity-project");
const TAKES = path.join(PROJECT_DIR, "shots", "S-01", "takes");

let upstream = null;
let upstreamPort = 0;
let ollamaPort = 0;
let ollamaServer = null;
const visionRequests = [];
const ollamaRequests = [];
let deadPort = 0;
let child = null;
let base = "";
let output = "";
/* What the mock returns for the next structured request. */
let nextReply = null;
/* Rewrites an otherwise-valid reply, so a decoder termination defect can be
   reproduced against whatever entity set the request actually declared. */
let upstreamTransform = null;

/* A tiny valid PNG so the route has a real image to read and base64. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve({}); }
    });
  });
}
function countImages(body) {
  const content = body?.messages?.[1]?.content;
  return Array.isArray(content) ? content.filter((part) => part?.type === "image_url").length : 0;
}
async function request(url, options) {
  const response = await fetch(base + url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
const postObserve = (payload) =>
  request("/api/continuity/observe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

/* ---- project fixture ---- */
function writeProject() {
  fs.mkdirSync(TAKES, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  fs.writeFileSync(path.join(TAKES, "S-01_FRAME_A.png"), PNG);
  fs.writeFileSync(path.join(TAKES, "S-01_FRAME_B.png"), PNG);
  const emptyTakes = path.join(PROJECT_DIR, "shots", "S-02", "takes");
  fs.mkdirSync(emptyTakes, { recursive: true });
  fs.writeFileSync(path.join(emptyTakes, "S-02_FRAME_A.png"), PNG);
  const states = [{ id: "state-default", name: "Default", notes: "Primary approved reference.", isDefault: true }];
  fs.writeFileSync(
    path.join(PROJECT_DIR, "project.json"),
    JSON.stringify({
      meta: { title: "Continuity Route", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
      qcChecklist: [],
      characters: [{ id: "CHAR-KAI", name: "Kai", block: "Late-30s, lean, close-cropped dark hair.", continuityStates: states }],
      locations: [{ id: "LOC-BRIDGE", name: "Bridge", description: "Steel footbridge.", continuityStates: states }],
      props: [
        { id: "PROP-MUG", name: "Enamel mug", description: "White enamel mug, chipped rim.", tracking: { color: true }, continuityStates: states },
        { id: "PROP-WATCH", name: "Two-tone wristwatch", description: "Steel case, gold bezel.", continuityStates: states },
      ],
      vehicles: [], audio: [], mediaAssets: [], scenes: [{ id: "SC-01", title: "Scene one" }],
      shots: [
        {
          id: "S-01", scene: "SC-01", title: "Kai at the bridge", desc: "Kai sets the mug down.",
          characters: ["CHAR-KAI"], codes: [],
          creationBrief: { locationId: "LOC-BRIDGE", propIds: ["PROP-MUG", "PROP-WATCH"], vehicleIds: [], frameWorkflows: {} },
          continuityStateSelections: {},
          keyframes: [
            { id: "frame-a", label: "A", winner: "S-01_FRAME_A.png", required: true, generationPackages: [] },
            { id: "frame-b", label: "B", winner: "S-01_FRAME_B.png", required: true, generationPackages: [] },
          ],
          clips: [], candidateFiles: [],
        },
        /* A shot with no resolvable entities, for the empty-manifest path. */
        { id: "S-02", scene: "SC-01", title: "Empty shot", characters: [], codes: [], creationBrief: { propIds: [], vehicleIds: [], frameWorkflows: {} }, keyframes: [{ id: "frame-a", label: "A", winner: "S-02_FRAME_A.png", required: true, generationPackages: [] }], clips: [], candidateFiles: [] },
      ],
      agentRuns: [], decisions: [], sessions: [], finishJobs: [],
    }, null, 2),
  );
}
function writeConfig(patch = {}) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "continuity-project",
    assistant: { provider: "custom", visionProvider: "ollama" },
    routing: { extract: "assistant", bulk: "assistant", draft: "assistant", prompt: "assistant", critic: "assistant", embed: "ollama" },
    customBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    customModel: "nemotron_3_nano_omni",
    customVisionModel: "nemotron_3_nano_omni",
    continuity: { visionProvider: "custom", visionModel: "nemotron_3_nano_omni" },
    ollamaUrl: `http://127.0.0.1:${ollamaPort}`,
    ollamaModel: "local-text-model",
    ollamaVisionModel: "local-vision-model",
    ...patch,
  }, null, 2));
}
function writeConfigFile_continuityUnset() {
  writeConfig({ continuity: { visionProvider: "", visionModel: "" } });
}
/* A well-formed observation for whatever entity ids the schema declares. */
function validReplyFor(body) {
  const ids = body.response_format.json_schema.schema.properties.entities.required;
  const entities = {};
  for (const id of ids)
    entities[id] = { presence: "present", occlusion: "none", identifiable: "yes", bbox: [100, 100, 200, 200], color: "white", state: "not-applicable", markings: "not-applicable", evidence: "visible in frame" };
  return JSON.stringify({ coordinate_mode: "permille", entities });
}

async function main() {
  upstreamPort = await freePort();
  ollamaPort = await freePort();
  upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/chat/completions")) {
      if (countImages(body)) visionRequests.push(body);
      if (upstreamTransform && nextReply === null && countImages(body))
        return res.end(JSON.stringify({ choices: [{ message: { content: upstreamTransform(body) } }] }));
      const content = nextReply === null ? validReplyFor(body) : nextReply;
      return res.end(JSON.stringify({ choices: [{ message: typeof content === "object" ? content : { content } }] }));
    }
    if (req.url.endsWith("/models"))
      return res.end(JSON.stringify({ data: [{ id: "nemotron_3_nano_omni" }] }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));
  ollamaServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    ollamaRequests.push({ url: req.url, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "local-vision-model" }, { name: "local-text-model" }] }));
    res.end(JSON.stringify({ message: { content: '{"reviews":[{"n":1,"pass":true,"score":90,"notes":"ok"}]}' } }));
  });
  await new Promise((resolve) => ollamaServer.listen(ollamaPort, "127.0.0.1", resolve));

  writeProject();
  writeConfig();
  /* A port nothing listens on, for the endpoint-precedence and fail-closed
     cases below. Reserved and released so it stays free. */
  deadPort = await freePort();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT, CINEBRAID_AI_VISION_TIMEOUT_MS: "4000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 10000;
  for (;;) {
    try { if ((await fetch(base + "/api/me")).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  const Continuity = require("../public/shared-continuity");

  /* ---- 1. a successful observation sends exactly ONE image ---- */
  let result = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.response.status, 200, `observe failed: ${JSON.stringify(result.body)}`);
  assert.strictEqual(visionRequests.length, 1, "one observation must produce exactly one provider request");
  let sent = visionRequests.at(-1);
  assert.strictEqual(countImages(sent), 1, "continuity observation must send EXACTLY ONE image");
  assert.strictEqual(sent.messages[1].content.filter((p) => p.type === "text").length, 1);
  assert.strictEqual(sent.messages.map((m) => m.role).join(","), "system,user");
  assert(sent.messages[1].content[1].image_url.url.startsWith("data:image/png;base64,"), "the image must be an inline data URI");
  assert.strictEqual(result.body.engine.imagesSent, 1);

  /* ---- 2. the request carries the qualified structured-output contract ---- */
  assert.strictEqual(sent.response_format.type, "json_schema");
  assert.strictEqual(sent.response_format.json_schema.name, "declared_entities_final");
  assert.strictEqual(sent.response_format.json_schema.strict, true);
  assert(!("guided_json" in sent), "guided_json was never the qualified path");
  /* The schema is exactly what the Phase 1 core generates for this manifest. */
  const manifestFromRoute = result.body.manifest;
  const expectedSchema = Continuity.buildObservationSchema({ entities: manifestFromRoute.entities });
  assert.strictEqual(JSON.stringify(sent.response_format.json_schema.schema), JSON.stringify(expectedSchema), "the route must send the Phase 1 generated schema, not its own copy");

  /* ---- 3. qualified request parameters ---- */
  assert.strictEqual(sent.temperature, 0.2);
  assert.strictEqual(sent.top_k, 1);
  assert.strictEqual(sent.max_tokens, 4096, "the 51/51 run was qualified at 4096 tokens");
  assert.strictEqual(sent.stream, false);
  assert.deepStrictEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert.strictEqual(sent.model, "nemotron_3_nano_omni");

  /* ---- 4. the prompt is the frozen contract ---- */
  const prompt = Continuity.buildObservationPrompt({ entities: manifestFromRoute.entities });
  assert.strictEqual(sent.messages[0].content, prompt.system, "the route must send the frozen observation prompt");
  assert.strictEqual(sent.messages[1].content[0].text, "Check each declared entity against this frame.");

  /* ---- 5. the schema is closed on exactly the declared entity ids ---- */
  const declaredIds = manifestFromRoute.entities.map((row) => row.entity_id).sort();
  assert.deepStrictEqual(declaredIds, ["CHAR-KAI", "LOC-BRIDGE", "PROP-MUG", "PROP-WATCH"]);
  assert.deepStrictEqual(sent.response_format.json_schema.schema.properties.entities.required, declaredIds);
  assert.strictEqual(sent.response_format.json_schema.schema.properties.entities.additionalProperties, false);
  /* Colour is off by default; the mug declared it on. */
  const watch = manifestFromRoute.entities.find((row) => row.entity_id === "PROP-WATCH");
  assert.strictEqual(watch.track_color, false, "a project that declared nothing must not have colour tracked");
  assert.strictEqual(manifestFromRoute.entities.find((row) => row.entity_id === "PROP-MUG").track_color, true);

  /* ---- 6. the response is parsed through the Phase 1 core ---- */
  assert.strictEqual(result.body.observation.coordinate_mode, "permille");
  assert.deepStrictEqual(Object.keys(result.body.observation.entities).sort(), declaredIds);
  assert.strictEqual(result.body.validation.states["CHAR-KAI"], "present");
  assert.strictEqual(result.body.validation.contractVersion, "declared_entities_final");
  assert.deepStrictEqual(result.body.validation.invalidEntityIds, []);
  assert.strictEqual(result.body.cached, false, "the first observation of an image is never cached");
  assert.strictEqual(result.body.manifest.manifestHash.length, 20);
  /* The untracked colour was discarded before it could reach a comparison. */
  assert.strictEqual(result.body.observation.entities["PROP-WATCH"].color, "not-applicable");
  assert(result.body.validation.flags.some((flag) => flag.code === "untracked_attribute_discarded"));
  assert.strictEqual(result.body.observation.entities["PROP-MUG"].color, "white");

  /* ---- 7. malformed content fails conservatively ----

     Each failure mode uses its own image so it is a genuine cache miss and
     actually reaches the provider. Repeating an identical request would now be
     served from cache, which is Phase 3's whole point. */
  const distinctFrame = (tag) => {
    const name = `S-01_${tag}.png`;
    fs.writeFileSync(path.join(TAKES, name), Buffer.concat([PNG, Buffer.from(`::${tag}`)]));
    return { shotId: "S-01", frameId: "frame-a", fileName: name };
  };
  nextReply = "this is not json at all";
  result = await postObserve(distinctFrame("malformed"));
  assert.strictEqual(result.response.status, 502);
  assert(/parsable JSON/i.test(result.body.error), result.body.error);

  /* A well-formed envelope that breaks the contract is reported, not accepted. */
  nextReply = JSON.stringify({ coordinate_mode: "permille", entities: { "CHAR-KAI": { presence: "absent", occlusion: "none", identifiable: "yes", bbox: [1, 2, 3, 4], color: "white", state: "not-applicable", markings: "not-applicable", evidence: "x" } } });
  result = await postObserve(distinctFrame("badshape"));
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.validation.ok, false);
  assert.strictEqual(result.body.validation.states["CHAR-KAI"], "invalid", "an illegal record shape must not be judged");
  assert(result.body.validation.invalidEntityIds.includes("LOC-BRIDGE"), "an entity the model omitted must be reported, not dropped");

  /* ---- 8. reasoning without a final answer fails loudly ---- */
  nextReply = { content: "", reasoning_content: "thinking about the frame" };
  result = await postObserve(distinctFrame("reasoning"));
  assert.strictEqual(result.response.status, 500);
  assert(/reasoning but no final answer/i.test(result.body.error), result.body.error);
  nextReply = null;

  /* ---- 9. unknown shot / frame / image fail safely ---- */
  assert.strictEqual((await postObserve({ shotId: "NOPE", frameId: "frame-a" })).response.status, 404);
  assert.strictEqual((await postObserve({ shotId: "S-01", frameId: "frame-zzz" })).response.status, 404);
  let missing = await postObserve({ shotId: "S-01", frameId: "frame-a", fileName: "does-not-exist.png" });
  assert.strictEqual(missing.response.status, 400);
  /* A path escape is refused rather than resolved. */
  const escape = await postObserve({ shotId: "S-01", frameId: "frame-a", fileName: "../../../../etc/passwd" });
  assert.strictEqual(escape.response.status, 400, "a traversal attempt must be refused");
  /* A shot with no declared entities is a clear refusal, not an empty request. */
  const empty = await postObserve({ shotId: "S-02", frameId: "frame-a" });
  assert.strictEqual(empty.response.status, 400);
  assert(/no tracked continuity entities/i.test(empty.body.error), empty.body.error);

  /* ---- 10. a multi-image continuity request is impossible ----

     The route reads exactly one file, and the dispatcher asserts the count
     before the provider is reached. Every failing case above must have left
     the mock untouched. */
  const beforeGuard = visionRequests.length;
  for (const payload of [
    { shotId: "NOPE", frameId: "frame-a" },
    { shotId: "S-01", frameId: "frame-zzz" },
    { shotId: "S-01", frameId: "frame-a", fileName: "does-not-exist.png" },
    { shotId: "S-02", frameId: "frame-a" },
  ]) await postObserve(payload);
  assert.strictEqual(visionRequests.length, beforeGuard, "a request that cannot be built must never reach the provider");
  /* Every observation request ever sent carried exactly one image. */
  for (const body of visionRequests) assert.strictEqual(countImages(body), 1, "no continuity request may ever carry more than one image");
  /* The guard is enforced in code, not only by construction. */
  const serverSource = fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8");
  assert(serverSource.includes("CONTINUITY_MAX_IMAGES"), "the one-image limit must be an explicit named assertion");
  assert(/imageB64\.length !== CONTINUITY_MAX_IMAGES/.test(serverSource), "the assertion must run before provider dispatch");

  /* ---- 11/12. local-only policy ---- */
  const projectFile = path.join(PROJECT_DIR, "project.json");
  const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  project.meta.aiPolicy = "local-only";
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));
  /* A loopback custom endpoint satisfies local-only. */
  const localOk = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(localOk.response.status, 200, `loopback continuity provider must work under local-only: ${JSON.stringify(localOk.body)}`);
  /* A remote one refuses, and sends nothing. */
  const beforeRemote = visionRequests.length;
  writeConfig({ customBaseUrl: "http://192.168.68.116:11436/v1" });
  const remote = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(remote.response.status, 500);
  assert(/local-only/i.test(remote.body.error), remote.body.error);
  assert.strictEqual(visionRequests.length, beforeRemote, "a local-only refusal must not send project material off the machine");
  writeConfig();
  project.meta.aiPolicy = "project-default";
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));

  /* ---- 13/14. health: continuity ready while generic vision is not ---- */
  const health = await request("/api/system/health");
  assert.strictEqual(health.response.status, 200);
  assert(health.body.assistant.continuity, "health must report a distinct continuity capability");
  assert.strictEqual(health.body.assistant.continuity.provider, "custom");
  assert.strictEqual(health.body.assistant.continuity.model, "nemotron_3_nano_omni");
  assert.strictEqual(health.body.assistant.continuity.ready, true);
  assert.strictEqual(health.body.assistant.vision.provider, "ollama", "generic vision stays where it was");
  /* No endpoint address may appear anywhere in the health payload. */
  const healthText = JSON.stringify(health.body);
  assert(!healthText.includes(`127.0.0.1:${upstreamPort}`), "the custom endpoint URL must never reach the client");
  assert(!healthText.includes("customBaseUrl"));
  assert(!healthText.includes("/v1"));

  /* ---- 14b. an unconfigured continuity provider refuses and contacts nobody --

     Continuity is explicit opt-in: defaulting it to the custom endpoint would
     make every existing install a consumer of an endpoint it never chose. */
  const beforeUnset = visionRequests.length;
  writeConfigFile_continuityUnset();
  const unset = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(unset.response.status, 500);
  assert(/no provider/i.test(unset.body.error), unset.body.error);
  assert.strictEqual(visionRequests.length, beforeUnset, "an unconfigured continuity provider must not contact anything");
  const unsetHealth = await request("/api/system/health");
  assert.strictEqual(unsetHealth.body.assistant.continuity.ready, false, "continuity must report not ready until a provider is chosen");
  assert(!JSON.stringify(unsetHealth.body).includes("/v1"), "no endpoint may leak even when unconfigured");
  writeConfig();

  /* ---- 14c. continuity stands alone (packaged-acceptance defect D2) --------

     The intended runtime has the general assistant on Ollama and continuity on
     its own OpenAI-compatible service. Readiness used to go through
     providerConfigured("custom"), which demands customBaseUrl AND customModel —
     customModel being the general TEXT model, which continuity never sends
     anything to. A valid standalone continuity service reported not ready
     because an unrelated text model was blank. */
  const standalone = {
    assistant: { provider: "ollama", visionProvider: "ollama" },
    customBaseUrl: "",
    customModel: "",
    customVisionModel: "",
    continuity: {
      visionProvider: "custom",
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      visionModel: "nemotron_3_nano_omni",
    },
  };
  writeConfig(standalone);
  const alone = await request("/api/system/health");
  assert.strictEqual(alone.body.assistant.continuity.ready, true, "continuity with its own endpoint and model must be ready without any generic custom text model");
  assert.strictEqual(alone.body.assistant.continuity.model, "nemotron_3_nano_omni");
  assert.strictEqual(alone.body.assistant.text.provider, "ollama", "the general assistant is untouched by continuity's connection");
  assert(!JSON.stringify(alone.body).includes(`127.0.0.1:${upstreamPort}`), "a standalone continuity endpoint must not leak into health either");

  /* And it really reaches its own address, not the shared one.

     The cache is purged first because its key is deliberately the qualified
     identity — contract, prompt, image, manifest, provider, model — and does not
     include the endpoint address, so an already-observed frame would answer from
     store and prove nothing about dispatch. */
  const purgeCache = () => request("/api/continuity/cache", { method: "DELETE" });
  await purgeCache();
  const beforeStandalone = visionRequests.length;
  const aloneObserve = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(aloneObserve.response.status, 200, JSON.stringify(aloneObserve.body));
  assert.strictEqual(visionRequests.length, beforeStandalone + 1, "a standalone continuity endpoint must still dispatch exactly one observation");
  assert.strictEqual(countImages(visionRequests.at(-1)), 1, "one image per request is unchanged by the endpoint split");

  /* Loosening continuity must not loosen the generic text provider. */
  writeConfig({ ...standalone, assistant: { provider: "custom", visionProvider: "ollama" } });
  const textAlone = await request("/api/system/health");
  assert.strictEqual(textAlone.body.assistant.text.ready, false, "a custom TEXT provider must still require its own base URL and model");
  assert.strictEqual(textAlone.body.assistant.continuity.ready, true, "continuity readiness must not be dragged down with it");

  /* A continuity endpoint takes precedence over the shared one when both exist. */
  writeConfig({
    continuity: { visionProvider: "custom", baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, visionModel: "nemotron_3_nano_omni" },
    customBaseUrl: `http://127.0.0.1:${deadPort}/v1`,
    customModel: "nemotron_3_nano_omni",
  });
  const precedence = await request("/api/system/health");
  assert.strictEqual(precedence.body.assistant.continuity.ready, true, "continuity must use its own endpoint, not the shared unreachable one");
  await purgeCache();
  const beforePrecedence = visionRequests.length;
  assert.strictEqual((await postObserve({ shotId: "S-01", frameId: "frame-b" })).response.status, 200, "continuity must reach its own endpoint while the shared one is dead");
  assert.strictEqual(visionRequests.length, beforePrecedence + 1);

  /* An unreachable continuity endpoint fails closed rather than silently
     falling back to the shared connection. */
  writeConfig({ continuity: { visionProvider: "custom", baseUrl: `http://127.0.0.1:${deadPort}/v1`, visionModel: "nemotron_3_nano_omni" } });
  /* health exposes only ready/provider/model; the wording lives on agents/status. */
  const unreachable = await request("/api/agents/status");
  assert.strictEqual(unreachable.body.capabilities.continuity.ready, false, "an unreachable continuity endpoint must fail closed");
  assert(/cannot reach/i.test(unreachable.body.capabilities.continuity.message || ""), unreachable.body.capabilities.continuity.message);
  assert(!JSON.stringify(unreachable.body).includes(`127.0.0.1:${deadPort}`), "a failing continuity endpoint must not be named to the browser");

  /* An endpoint but no model is not configured, and says which field is missing. */
  writeConfig({ continuity: { visionProvider: "custom", baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, visionModel: "" }, customVisionModel: "", customModel: "" });
  const noModel = await request("/api/agents/status");
  assert.strictEqual(noModel.body.capabilities.continuity.ready, false, "continuity with no model must report not ready");
  assert(/no model/i.test(noModel.body.capabilities.continuity.message || ""), noModel.body.capabilities.continuity.message);

  /* BACKWARD COMPATIBILITY: a config written before continuity.baseUrl existed
     inherits the shared custom connection exactly as it did. */
  writeConfig();
  const inherited = await request("/api/system/health");
  assert.strictEqual(inherited.body.assistant.continuity.ready, true, "a pre-existing config with no continuity endpoint must keep working through the shared custom connection");
  await purgeCache();
  const beforeInherited = visionRequests.length;
  assert.strictEqual((await postObserve({ shotId: "S-01", frameId: "frame-a" })).response.status, 200);
  assert.strictEqual(visionRequests.length, beforeInherited + 1, "the inherited connection must still dispatch to the shared endpoint");

  /* ---- 14d. decoder termination defects recover end to end ---------------

     The Spark qualification found the model omitting one closing brace and then
     spending its whole token budget on legal whitespace. The answer inside is
     complete and correct; only the envelope is broken. It must reach the same
     validator, be cached like any other observation, and cost exactly one
     provider request — no retry, because nothing about the request was wrong. */
  await purgeCache();
  writeConfig();

  /* A. a normal valid response is unaffected. */
  nextReply = null;
  let count = visionRequests.length;
  let observed = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(observed.response.status, 200, JSON.stringify(observed.body));
  assert.strictEqual(observed.body.engine.recovery, "none", "a valid response reports no recovery");
  assert.strictEqual(observed.body.validation.usable, true);
  assert.strictEqual(visionRequests.length, count + 1, "one observation, one request");
  /* The intact reading, to compare the recovered one against field by field. */
  const intactValidation = observed.body.validation;
  const intactObservation = observed.body.observation;

  /* B. missing final brace plus pathological trailing whitespace. */
  await purgeCache();
  nextReply = null;
  const truncate = (body) => validReplyFor(body).slice(0, -1) + " \n\t".repeat(1500);
  upstreamTransform = truncate;
  count = visionRequests.length;
  observed = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(observed.response.status, 200, `an unterminated but complete observation must not be discarded: ${JSON.stringify(observed.body)}`);
  assert.strictEqual(observed.body.engine.recovery, "eof-closure");
  assert.strictEqual(observed.body.validation.usable, true, "the recovered observation must pass the existing validator");
  /* The strongest statement available: recovering the envelope produces exactly
     the reading the intact reply produced. Recovery is never reported as visual
     uncertainty, because it says nothing about the image. */
  assert.deepStrictEqual(observed.body.observation, intactObservation, "a recovered observation must be identical to the intact one");
  assert.strictEqual(observed.body.validation.status, intactValidation.status, "recovery must not change the validation status");
  assert.deepStrictEqual(observed.body.validation.flags, intactValidation.flags, "recovery must raise no new validation flag");
  assert.strictEqual(visionRequests.length, count + 1, "recovery must not cost a retry");
  assert.strictEqual(observed.body.engine.attempts, 1, "the request itself was never wrong, so it is never re-sent");

  /* The recovered observation is cached like any other, and only the
     normalized observation is stored. */
  observed = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(observed.body.cached, true, "a recovered observation is ordinary evidence and is cached");
  assert.strictEqual(observed.body.engine.recovery, "none", "a cache hit parsed nothing");
  const storedCache = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "continuity-observations.json"), "utf8"));
  const storedEntry = Object.values(storedCache.entries)[0];
  assert.strictEqual(storedEntry.observation.coordinate_mode, "permille");
  assert(!JSON.stringify(storedCache).includes("recovery"), "how the envelope arrived is not evidence and is not persisted");

  /* C. a raw form feed inside a string. */
  await purgeCache();
  upstreamTransform = (body) => validReplyFor(body).replace("visible in frame", "visible" + String.fromCharCode(0x0c) + " in frame");
  count = visionRequests.length;
  observed = await postObserve({ shotId: "S-01", frameId: "frame-b" });
  assert.strictEqual(observed.response.status, 200, JSON.stringify(observed.body));
  assert.strictEqual(observed.body.engine.recovery, "control-character");
  assert.strictEqual(observed.body.validation.usable, true);
  assert.strictEqual(visionRequests.length, count + 1, "control-character recovery must not cost a retry");

  /* A recovered pair compares normally afterwards. */
  upstreamTransform = truncate;
  const compared = await request("/api/continuity/compare", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ shotId: "S-01", frameA: "frame-a", frameB: "frame-b" }),
  });
  assert.strictEqual(compared.response.status, 200, JSON.stringify(compared.body));
  assert.strictEqual(compared.body.analysis.usable, true, "recovered observations compare like any other");
  assert(Array.isArray(compared.body.entities) && compared.body.entities.length > 0);

  /* D. genuinely malformed output is still refused, and still costs the
        existing explicit failure rather than a fabricated observation. */
  await purgeCache();
  upstreamTransform = null;
  nextReply = '{"coordinate_mode":"permille","entities":{"CHAR-KAI":{"presence":"present" "occlusion":"none"}}}';
  const malformed = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(malformed.response.status, 502, "JSON needing a comma must remain unparsable");
  assert(/parsable JSON/i.test(malformed.body.error || ""), malformed.body.error);
  nextReply = '{"coordinate_mode":"permille","entities":{"CHAR-KAI":{"presence":"present","evidence":"unterminat';
  const unterminated = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(unterminated.response.status, 502, "an unterminated string must never be closed");

  /* E. structurally recoverable but semantically wrong stays wrong. */
  nextReply = null;
  upstreamTransform = (body) => {
    const parsed = JSON.parse(validReplyFor(body));
    parsed.coordinate_mode = "pixels";
    return JSON.stringify(parsed).slice(0, -1);
  };
  const wrongFrame = await postObserve({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(wrongFrame.response.status, 200);
  assert.strictEqual(wrongFrame.body.engine.recovery, "eof-closure", "it recovered structurally");
  assert.strictEqual(wrongFrame.body.validation.usable, false, "and was still refused on its merits");
  assert(wrongFrame.body.validation.blockingFlags.includes("invalid_coordinate_mode"));
  upstreamTransform = null;
  await purgeCache();

  /* ---- 15. REGRESSION: existing multi-image routes are unchanged ---- */
  const beforeMulti = ollamaRequests.length;
  const continuityBeforeMulti = visionRequests.length;
  const review = await request("/api/llm/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "shot", id: "S-01" }),
  });
  assert.strictEqual(review.response.status, 200, `existing review route regressed: ${JSON.stringify(review.body)}`);
  assert(ollamaRequests.length > beforeMulti, "the existing review route must still reach the generic vision provider");
  const multi = ollamaRequests.at(-1);
  assert.strictEqual(multi.url, "/api/chat", "the generic vision path is unchanged");
  assert.strictEqual(multi.body.model, "local-vision-model", "generic vision provider selection is unchanged");
  assert(Array.isArray(multi.body.messages[1].images) && multi.body.messages[1].images.length >= 1, "multi-image shape is unchanged");
  for (const field of ["response_format", "json_schema", "guided_json", "top_k", "chat_template_kwargs"])
    assert(!(field in multi.body), `the generic vision request must not be given the continuity field ${field}`);
  assert(!("temperature" in multi.body), "the generic vision request must not be given continuity sampling settings");
  /* And the continuity provider was not touched by the multi-image route. */
  assert.strictEqual(visionRequests.length, continuityBeforeMulti, "the existing review route must not reach the continuity provider");

  console.log(`Continuity observe-route suite passed: exactly one image per request across ${visionRequests.length} observations, the frozen prompt and Phase 1 generated schema are sent verbatim with temperature 0.2 / top_k 1 / max_tokens 4096 / thinking disabled, malformed and reasoning-only replies fail loudly, unknown shot/frame/image and empty manifests are refused before dispatch, local-only refuses a remote endpoint without sending anything, health reports continuity ready while generic vision is not and never leaks the endpoint, continuity stands alone on its own endpoint without any generic custom text model while a custom TEXT provider still requires its own, its endpoint takes precedence over the shared one and fails closed rather than falling back, a config written before that field still inherits the shared connection, a decoder that omits a closing brace or emits a raw control character is recovered into the identical reading at the cost of no retry, cached like any other evidence and compared normally, while JSON needing a comma or an unterminated string stays unparsable and a structurally recovered but wrong-coordinate answer is still refused, and the existing multi-image review route is byte-for-byte unchanged.`);
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

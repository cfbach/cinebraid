/* CineBraid declared-entity continuity — observation evidence cache.

   The cache is content-addressed: an entry stops being addressable the moment
   any input that produced it changes. There is no TTL and no freshness
   heuristic, so the tests that matter are the ones that prove the key really
   does depend on everything it claims to — and, just as importantly, that it
   does NOT depend on a filename.

   Losing a cache entry costs a model call. Trusting a stale one costs a wrong
   continuity verdict. Every failure path here must degrade to a miss.

   Offline. No provider, no network, no model. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const {
  createContinuityCache,
  observationKey,
  hashImageFile,
  clearImageHashMemo,
  CACHE_VERSION,
  CACHE_FILE,
  MAX_ENTRIES,
} = require("../continuity-cache");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-continuity-cache-"));

/* Two distinct 1x1 PNGs and a byte-variant of the first. */
const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/* ====================================================================
   PART A — identity, offline, no server
   ==================================================================== */

const BASE = {
  contractVersion: "declared_entities_final",
  promptVersion: "arm-F-anti-confirmation-bias",
  imageHash: "a".repeat(64),
  manifestHash: "0123456789abcdef0123",
  provider: "custom",
  model: "nemotron_3_nano_omni",
};

/* ---- 1. same inputs -> same key, and the key is a well-formed digest ---- */
const baseKey = observationKey(BASE);
assert.strictEqual(baseKey, observationKey({ ...BASE }), "identical identity must produce an identical key");
assert.strictEqual(baseKey.length, 64);
assert(/^[0-9a-f]+$/.test(baseKey));

/* ---- 2. every declared component genuinely changes the key ----

   If any of these did not, evidence produced under one set of conditions could
   be served under another. */
for (const [field, value] of Object.entries({
  contractVersion: "declared_entities_v2",
  promptVersion: "some-other-prompt",
  imageHash: "b".repeat(64),
  manifestHash: "ffffffffffffffffffff",
  provider: "openai",
  model: "gpt-5.2",
})) assert.notStrictEqual(observationKey({ ...BASE, [field]: value }), baseKey, `${field} must be part of the cache key`);

/* The provider and model are joined, not concatenated ambiguously: a provider
   "a" with model "b@c" must not collide with provider "a@b" model "c". */
assert.notStrictEqual(
  observationKey({ ...BASE, provider: "a", model: "b@c" }),
  observationKey({ ...BASE, provider: "a@b", model: "c" }),
);

/* ---- 3. image content identity, not filename identity ---- */
const imgDir = path.join(TEMP, "images");
fs.mkdirSync(imgDir, { recursive: true });
const takeA = path.join(imgDir, "take_03.png");
const renamed = path.join(imgDir, "hero_take.png");
const other = path.join(imgDir, "other.png");
fs.writeFileSync(takeA, PNG_A);
fs.writeFileSync(renamed, PNG_A);
fs.writeFileSync(other, PNG_B);

const hashA = hashImageFile(takeA);
assert.strictEqual(hashA.length, 64);
assert.strictEqual(hashImageFile(renamed), hashA, "identical bytes under a different filename must hash the same");
assert.notStrictEqual(hashImageFile(other), hashA, "different bytes must hash differently");

/* One byte of difference is enough. */
const oneByte = path.join(imgDir, "one-byte.png");
const mutated = Buffer.from(PNG_A);
mutated[mutated.length - 5] ^= 0x01;
fs.writeFileSync(oneByte, mutated);
assert.notStrictEqual(hashImageFile(oneByte), hashA, "a one-byte change must change the image hash");

/* The same filename holding different bytes is different evidence — including
   a same-length rewrite landing in the same filesystem timestamp tick, where
   (size, mtime, ctime, inode) are indistinguishable. Serving the previous
   image's hash here would serve the previous image's observation. */
const replaced = path.join(imgDir, "replaced.png");
fs.writeFileSync(replaced, PNG_A);
assert.strictEqual(hashImageFile(replaced), hashA);
assert.strictEqual(PNG_A.length, PNG_B.length, "the rewrite must be the same byte length to exercise the collision");
fs.writeFileSync(replaced, PNG_B);
assert.strictEqual(hashImageFile(replaced), hashImageFile(other), "an immediate same-length rewrite must still change the hash");

/* And the same holds once the file has settled long enough to be memoized. */
const settled = path.join(imgDir, "settled.png");
fs.writeFileSync(settled, PNG_A);
const past = Date.now() / 1000 - 60;
fs.utimesSync(settled, past, past);
assert.strictEqual(hashImageFile(settled), hashA, "a settled file hashes correctly");
assert.strictEqual(hashImageFile(settled), hashA, "and is served from the memo");
fs.writeFileSync(settled, PNG_B);
assert.strictEqual(hashImageFile(settled), hashImageFile(other), "rewriting a memoized file must invalidate its memo");

/* ---- 4. the memo is an optimisation and never decides identity ---- */
clearImageHashMemo();
assert.strictEqual(hashImageFile(takeA), hashA, "a cold memo must produce the same hash");
assert.strictEqual(hashImageFile(takeA), hashA, "a memo hit must produce the same hash");
clearImageHashMemo();
assert.strictEqual(hashImageFile(takeA), hashA);

/* ---- 5/6/7. unreadable and non-file inputs fail cleanly ---- */
assert.throws(() => hashImageFile(path.join(imgDir, "does-not-exist.png")), /ENOENT|no such file/i);
assert.throws(() => hashImageFile(imgDir), /regular image file/i, "a directory must not hash as evidence");

/* ====================================================================
   PART B — the store: persistence, corruption, retention, concurrency
   ==================================================================== */

/* The real atomicWriteJson from server.js is not exported, so the store is
   exercised through an equivalent temp+rename writer. The production path uses
   the repository's audited helper. */
function atomicWriteJson(file, value) {
  const payload = JSON.stringify(value, null, 2);
  JSON.parse(payload);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temp, payload, "utf8");
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(temp, file);
}
function makeStore(name) {
  const dir = path.join(TEMP, name);
  fs.mkdirSync(dir, { recursive: true });
  const logs = [];
  return { dir, logs, cache: createContinuityCache({ projectDir: () => dir, atomicWriteJson, log: (m) => logs.push(m) }) };
}
function entryFor(key, patch = {}) {
  return {
    key, observedAt: "2026-08-07T00:00:00.000Z", lastAccessedAt: "2026-08-07T00:00:00.000Z",
    shotId: "S-01", frameId: "frame-a", imageName: "a.png",
    imageHash: BASE.imageHash, manifestHash: BASE.manifestHash,
    contractVersion: BASE.contractVersion, promptVersion: BASE.promptVersion,
    provider: BASE.provider, model: BASE.model,
    observation: { coordinate_mode: "permille", entities: { "PROP-MUG": { presence: "present", occlusion: "none", identifiable: "yes", bbox: [1, 2, 3, 4], color: "white", state: "not-applicable", markings: "not-applicable", evidence: "seen" } } },
    validation: { ok: true, flags: [], states: { "PROP-MUG": "present" }, invalidEntityIds: [], contractVersion: BASE.contractVersion },
    ...patch,
  };
}
const EXPECT = { ...BASE, key: baseKey, entityIds: ["PROP-MUG"] };

async function partB() {
  /* ---- 8. store and read back across a fresh store instance ---- */
  const s1 = makeStore("store");
  assert.strictEqual(s1.cache.lookup(baseKey, EXPECT), null, "an empty cache is a miss");
  await s1.cache.store(entryFor(baseKey));
  assert(s1.cache.lookup(baseKey, EXPECT), "a stored entry must be found");
  /* A brand-new store object reading the same directory sees it: the entry
     survives a process restart, not just this object's memory. */
  const reopened = createContinuityCache({ projectDir: () => s1.dir, atomicWriteJson, log: () => {} });
  assert(reopened.lookup(baseKey, EXPECT), "a stored entry must survive a store reload");
  const onDisk = JSON.parse(fs.readFileSync(path.join(s1.dir, CACHE_FILE), "utf8"));
  assert.strictEqual(onDisk.version, CACHE_VERSION);
  assert.strictEqual(Object.keys(onDisk.entries).length, 1);
  /* Nothing sensitive is persisted. */
  const text = JSON.stringify(onDisk);
  for (const forbidden of ["Bearer", "apiKey", "customBaseUrl", "http://", "https://", "base64,"])
    assert(!text.includes(forbidden), `the cache must not persist ${forbidden}`);
  assert(!text.includes(s1.dir), "the cache must not persist filesystem paths");

  /* ---- 9. a key match is not enough: the entry must match its identity ---- */
  for (const [field, value] of Object.entries({
    imageHash: "c".repeat(64), manifestHash: "deadbeefdeadbeefdead",
    contractVersion: "other", promptVersion: "other", provider: "openai", model: "other", key: "other",
  })) {
    const s = makeStore(`mismatch-${field}`);
    await s.cache.store(entryFor(baseKey, { [field]: value }));
    assert.strictEqual(s.cache.lookup(baseKey, EXPECT), null, `an entry whose ${field} disagrees with the key must be a miss`);
  }
  /* A structurally wrong payload is a miss, not a crash. */
  for (const patch of [
    { observation: null }, { observation: { coordinate_mode: "pixels", entities: {} } },
    { observation: { coordinate_mode: "permille", entities: null } },
    { validation: null }, { validation: { ok: true, states: null, flags: [] } },
    { validation: { ok: true, states: {}, flags: "nope" } },
  ]) {
    const s = makeStore(`shape-${Math.random().toString(36).slice(2)}`);
    await s.cache.store(entryFor(baseKey, patch));
    assert.strictEqual(s.cache.lookup(baseKey, EXPECT), null, "a malformed entry must be a miss");
  }
  /* An entry covering a different entity set is a miss: the manifest hash
     should have prevented it, so this is defence in depth. */
  const sEntities = makeStore("entities");
  await sEntities.cache.store(entryFor(baseKey));
  assert.strictEqual(sEntities.cache.lookup(baseKey, { ...EXPECT, entityIds: ["PROP-MUG", "CHAR-KAI"] }), null);

  /* ---- 10. a bad entry is dropped, not left to be re-read ---- */
  const sDrop = makeStore("drop");
  await sDrop.cache.store(entryFor(baseKey, { imageHash: "c".repeat(64) }));
  assert.strictEqual(sDrop.cache.lookup(baseKey, EXPECT), null);
  await sDrop.cache.purge({ shotId: "" }); // flush the pending removal through the write chain
  assert(sDrop.logs.some((m) => /did not match its declared identity/.test(m)), "a mismatched entry must be reported");

  /* ---- 11. corruption fails soft, quarantines, and rebuilds ---- */
  const sCorrupt = makeStore("corrupt");
  await sCorrupt.cache.store(entryFor(baseKey));
  const corruptFile = path.join(sCorrupt.dir, CACHE_FILE);
  fs.writeFileSync(corruptFile, "{ this is not json");
  fs.writeFileSync(`${corruptFile}.bak`, "{ also not json");
  assert.doesNotThrow(() => sCorrupt.cache.read(), "a corrupt cache must never throw at the caller");
  assert.strictEqual(sCorrupt.cache.lookup(baseKey, EXPECT), null, "a corrupt cache is a miss, not an error");
  assert(fs.readdirSync(sCorrupt.dir).some((f) => f.includes(".corrupt-")), "the corrupt file must be quarantined for diagnosis, not deleted");
  assert(sCorrupt.logs.some((m) => /unreadable/.test(m)));
  /* And the cache is usable again immediately afterwards. */
  await sCorrupt.cache.store(entryFor(baseKey));
  assert(sCorrupt.cache.lookup(baseKey, EXPECT), "the cache must rebuild after corruption");

  /* A cache written by a future version is not silently reinterpreted. */
  const sVersion = makeStore("version");
  atomicWriteJson(path.join(sVersion.dir, CACHE_FILE), { version: "continuity-observation-cache-v99", entries: { [baseKey]: entryFor(baseKey) } });
  assert.strictEqual(sVersion.cache.lookup(baseKey, EXPECT), null, "a foreign cache version must not be trusted");

  /* The .bak sidecar rescues a truncated main file. */
  const sBak = makeStore("bak");
  await sBak.cache.store(entryFor(baseKey));
  await sBak.cache.store(entryFor(`${baseKey.slice(0, 63)}f`, { key: `${baseKey.slice(0, 63)}f` }));
  fs.writeFileSync(path.join(sBak.dir, CACHE_FILE), "truncated{");
  assert.strictEqual(sBak.cache.read().version, CACHE_VERSION, "a truncated cache must fall back to its backup");
  assert(sBak.logs.some((m) => /backup copy was used/.test(m)));

  /* ---- 12. concurrent writes do not lose entries ----

     Two observations finishing together must both survive. Without write
     serialization the second would persist a snapshot taken before the first
     existed. */
  const sConcurrent = makeStore("concurrent");
  const keys = Array.from({ length: 40 }, (_, i) => `${String(i).padStart(2, "0")}`.repeat(32));
  await Promise.all(keys.map((k) => sConcurrent.cache.store(entryFor(k, { key: k }))));
  const stored = sConcurrent.cache.read().entries;
  assert.strictEqual(Object.keys(stored).length, keys.length, `all ${keys.length} concurrent writes must survive; found ${Object.keys(stored).length}`);
  for (const k of keys) assert(stored[k], `concurrent entry ${k.slice(0, 4)} was lost`);

  /* ---- 13. bounded retention at the approved cap ---- */
  const sCap = makeStore("cap");
  const bulk = {};
  for (let i = 0; i < MAX_ENTRIES + 25; i++) {
    const k = `k${String(i).padStart(6, "0")}`.padEnd(64, "0");
    bulk[k] = entryFor(k, { key: k, lastAccessedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() });
  }
  atomicWriteJson(path.join(sCap.dir, CACHE_FILE), { version: CACHE_VERSION, updatedAt: "", entries: bulk });
  const freshKey = "z".repeat(64);
  const capResult = await sCap.cache.store(entryFor(freshKey, { key: freshKey }));
  assert.strictEqual(capResult.size, MAX_ENTRIES, `the cache must be capped at ${MAX_ENTRIES}, found ${capResult.size}`);
  assert.strictEqual(capResult.evicted, 26, "exactly the overflow must be evicted");
  const after = sCap.cache.read().entries;
  assert(after[freshKey], "the entry just written must never be the one evicted");
  /* Eviction is oldest-accessed first, which is LRU over the access
     information the store actually has. */
  assert(!after["k000000".padEnd(64, "0")], "the least recently accessed entry must go first");
  assert(after[`k${String(MAX_ENTRIES + 24).padStart(6, "0")}`.padEnd(64, "0")], "the most recently accessed entry must be kept");

  /* ---- 14. purge scopes ---- */
  const sPurge = makeStore("purge");
  const rows = [
    ["a".repeat(64), "S-01", "frame-a"], ["b".repeat(64), "S-01", "frame-b"],
    ["c".repeat(64), "S-02", "frame-a"], ["d".repeat(64), "S-02", "frame-b"],
  ];
  for (const [k, shotId, frameId] of rows) await sPurge.cache.store(entryFor(k, { key: k, shotId, frameId }));
  assert.strictEqual(sPurge.cache.stats().size, 4);
  let purged = await sPurge.cache.purge({ shotId: "S-01", frameId: "frame-b" });
  assert.strictEqual(purged.removed, 1, "a frame purge removes exactly that frame");
  assert.strictEqual(sPurge.cache.stats().size, 3);
  purged = await sPurge.cache.purge({ shotId: "S-01" });
  assert.strictEqual(purged.removed, 1, "a shot purge removes only that shot's remaining entries");
  assert.strictEqual(sPurge.cache.stats().size, 2);
  purged = await sPurge.cache.purge({});
  assert.strictEqual(purged.removed, 2, "an unfiltered purge clears the project's evidence");
  assert.strictEqual(sPurge.cache.stats().size, 0);
  /* A purge is evidence-only: the cache file itself remains a valid store. */
  assert.strictEqual(sPurge.cache.read().version, CACHE_VERSION);
}

/* ====================================================================
   PART C — cache-first behaviour through the real server
   ==================================================================== */

const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "cache-project");
const TAKES = path.join(PROJECT_DIR, "shots", "S-01", "takes");
const CONFIG_PATH = path.join(TEMP, "config.json");
let upstream = null, upstreamPort = 0, ollamaPort = 0, ollamaServer = null;
let child = null, base = "", output = "";
let visionRequests = [];
let nextReply = null;

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
const countImages = (body) => (Array.isArray(body?.messages?.[1]?.content) ? body.messages[1].content.filter((p) => p?.type === "image_url").length : 0);
async function request(url, options) {
  const response = await fetch(base + url, options);
  return { response, body: await response.json().catch(() => ({})) };
}
const observe = (payload) => request("/api/continuity/observe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

const STATES = [{ id: "state-default", name: "Default", notes: "Primary approved reference.", isDefault: true }, { id: "state-worn", name: "Worn", notes: "Scuffed and rained on.", isDefault: false, parentStateId: "state-default" }];
function baseProject() {
  return {
    meta: { title: "Cache Project", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [{ id: "CHAR-KAI", name: "Kai", block: "Late-30s, lean.", continuityStates: STATES }],
    locations: [], vehicles: [], audio: [], mediaAssets: [],
    props: [{ id: "PROP-MUG", name: "Enamel mug", description: "White enamel mug.", continuityStates: STATES }],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{
      id: "S-01", scene: "SC-01", title: "Shot one", desc: "Kai and the mug.",
      characters: ["CHAR-KAI"], codes: [],
      creationBrief: { propIds: ["PROP-MUG"], vehicleIds: [], frameWorkflows: {} },
      continuityStateSelections: {},
      keyframes: [{ id: "frame-a", label: "A", winner: "A.png", required: true, generationPackages: [] }, { id: "frame-b", label: "B", winner: "B.png", required: true, generationPackages: [] }],
      clips: [], candidateFiles: [],
    }],
    agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  };
}
function writeProject(project) {
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(project, null, 2));
}
function writeConfig(patch = {}) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "cache-project",
    assistant: { provider: "custom", visionProvider: "ollama" },
    routing: { extract: "assistant", bulk: "assistant", draft: "assistant", prompt: "assistant", critic: "assistant", embed: "ollama" },
    customBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    customModel: "nemotron_3_nano_omni", customVisionModel: "nemotron_3_nano_omni",
    continuity: { visionProvider: "custom", visionModel: "nemotron_3_nano_omni" },
    ollamaUrl: `http://127.0.0.1:${ollamaPort}`, ollamaModel: "local-text-model", ollamaVisionModel: "local-vision-model",
    ...patch,
  }, null, 2));
}
function validReplyFor(body) {
  const ids = body.response_format.json_schema.schema.properties.entities.required;
  const entities = {};
  for (const id of ids) entities[id] = { presence: "present", occlusion: "none", identifiable: "yes", bbox: [100, 100, 200, 200], color: "white", state: "not-applicable", markings: "not-applicable", evidence: "visible" };
  return JSON.stringify({ coordinate_mode: "permille", entities });
}
const cacheFile = () => path.join(PROJECT_DIR, CACHE_FILE);

async function partC() {
  upstreamPort = await freePort();
  ollamaPort = await freePort();
  upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "nemotron_3_nano_omni" }] }));
    if (req.url.endsWith("/chat/completions")) {
      if (countImages(body)) visionRequests.push(body);
      if (nextReply === "http-error") { res.statusCode = 503; return res.end(JSON.stringify({ error: { message: "upstream unavailable" } })); }
      const content = nextReply === null ? validReplyFor(body) : nextReply;
      return res.end(JSON.stringify({ choices: [{ message: typeof content === "object" ? content : { content } }] }));
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
  fs.writeFileSync(path.join(TAKES, "A.png"), PNG_A);
  fs.writeFileSync(path.join(TAKES, "B.png"), PNG_B);
  writeProject(baseProject());
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

  /* ---- 15/16. cold then warm ---- */
  visionRequests = [];
  let result = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
  assert.strictEqual(result.body.cached, false, "the first observation is a miss");
  assert.strictEqual(visionRequests.length, 1, "a cold observation calls the model exactly once");
  assert.strictEqual(result.body.engine.imagesSent, 1);
  const coldHash = result.body.imageHash;
  const coldManifest = result.body.manifest.manifestHash;

  result = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.body.cached, true, "an identical observation must be served from cache");
  assert.strictEqual(visionRequests.length, 1, "a cache hit must make NO provider request");
  assert.strictEqual(result.body.engine.imagesSent, 0);
  assert.strictEqual(result.body.imageHash, coldHash);
  assert.deepStrictEqual(result.body.observation, (await observe({ shotId: "S-01", frameId: "frame-a" })).body.observation, "cached evidence is returned unchanged");
  assert.strictEqual(visionRequests.length, 1);

  /* ---- 17. the cache lives beside the project, not inside project.json ---- */
  assert(fs.existsSync(cacheFile()), "the cache must be a project-scoped file");
  const projectText = fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8");
  assert(!projectText.includes("coordinate_mode"), "observations must never be written into project.json");
  assert(!projectText.includes(coldHash), "the cache must not bloat project.json");
  const persisted = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
  assert.strictEqual(persisted.version, CACHE_VERSION);
  const persistedText = JSON.stringify(persisted);
  assert(!persistedText.includes(`127.0.0.1:${upstreamPort}`), "the provider endpoint must never be persisted");
  assert(!persistedText.includes("base64,"), "image bytes must never be persisted");
  assert(!persistedText.includes(PROJECT_DIR), "absolute paths must never be persisted");

  /* ---- 18. renaming the file with identical bytes stays a HIT ---- */
  fs.copyFileSync(path.join(TAKES, "A.png"), path.join(TAKES, "HERO.png"));
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "HERO.png" });
  assert.strictEqual(result.body.cached, true, "identical bytes under a new filename must be a cache HIT");
  assert.strictEqual(visionRequests.length, 1, "a rename must not cost a model call");
  assert.strictEqual(result.body.imageHash, coldHash);

  /* ---- 19. replacing the bytes under the same name is a MISS ---- */
  fs.writeFileSync(path.join(TAKES, "HERO.png"), PNG_B);
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "HERO.png" });
  assert.strictEqual(result.body.cached, false, "different bytes must be a MISS even under the same filename");
  assert.strictEqual(visionRequests.length, 2);
  assert.notStrictEqual(result.body.imageHash, coldHash);

  /* ---- 20. declared-state-only change is a HIT ----

     Phase 1 keeps the declared state as a cb_ annotation that is never sent to
     the model, so re-selecting it does not change the question that was asked
     and must not discard valid evidence. This is asserted against the actual
     manifest hash, not assumed. */
  let project = baseProject();
  project.shots[0].continuityStateSelections = { "PROP-MUG": "state-worn" };
  writeProject(project);
  const beforeState = visionRequests.length;
  result = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.body.manifest.manifestHash, coldManifest, "a declared-state change must not alter the observation-relevant manifest hash");
  assert.strictEqual(result.body.cached, true, "a declared-state-only change must remain a cache HIT");
  assert.strictEqual(visionRequests.length, beforeState, "a declared-state change must not cost a model call");
  /* The declared state did change, and is still reported. */
  assert.strictEqual(result.body.manifest.entities.find((e) => e.entity_id === "PROP-MUG").cb_declared_state_id, "state-worn");

  /* ---- 21. every observation-relevant manifest change is a MISS ---- */
  const MANIFEST_CHANGES = [
    ["entity added", (p) => { p.locations.push({ id: "LOC-BRIDGE", name: "Bridge", description: "A bridge.", continuityStates: STATES }); p.shots[0].codes = ["LOC-BRIDGE"]; }],
    ["entity removed", (p) => { p.shots[0].creationBrief.propIds = []; }],
    ["identity cues changed", (p) => { p.props[0].description = "A completely different mug."; }],
    ["tracking flags changed", (p) => { p.props[0].tracking = { color: true }; }],
    ["markings contract changed", (p) => { p.props[0].tracking = { markings: true }; }],
    ["composite boundary changed", (p) => { p.props[0].tracking = { unit: "composite" }; }],
    ["display name changed", (p) => { p.props[0].name = "Tin mug"; }],
    ["allowed state vocabulary changed", (p) => { p.props[0].continuityStates = [...STATES, { id: "state-broken", name: "Broken", notes: "Handle snapped.", isDefault: false }]; }],
  ];
  const hashes = new Set([coldManifest]);
  for (const [label, mutate] of MANIFEST_CHANGES) {
    const p = baseProject();
    mutate(p);
    writeProject(p);
    const before = visionRequests.length;
    const r = await observe({ shotId: "S-01", frameId: "frame-a" });
    assert.strictEqual(r.response.status, 200, `${label}: ${JSON.stringify(r.body)}`);
    assert.notStrictEqual(r.body.manifest.manifestHash, coldManifest, `${label} must change the manifest hash`);
    assert.strictEqual(r.body.cached, false, `${label} must be a cache MISS`);
    assert.strictEqual(visionRequests.length, before + 1, `${label} must cost exactly one model call`);
    hashes.add(r.body.manifest.manifestHash);
  }
  assert.strictEqual(hashes.size, MANIFEST_CHANGES.length + 1, "each observation-relevant change must produce a distinct manifest hash");
  writeProject(baseProject());

  /* ---- 22. provider/model identity is part of the key ---- */
  let before = visionRequests.length;
  await observe({ shotId: "S-01", frameId: "frame-a" }); // warm under the original model
  before = visionRequests.length;
  writeConfig({ continuity: { visionProvider: "custom", visionModel: "some-other-model" } });
  result = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.body.cached, false, "a model change must invalidate the evidence");
  assert.strictEqual(visionRequests.length, before + 1);
  writeConfig();

  /* ---- 23. uncertain evidence is cached; non-answers are not ---- */
  const uncertain = JSON.stringify({
    coordinate_mode: "permille",
    entities: {
      "CHAR-KAI": { presence: "uncertain", occlusion: "uncertain", identifiable: "uncertain", bbox: null, color: "uncertain", state: "uncertain", markings: "uncertain", evidence: "unclear" },
      "PROP-MUG": { presence: "present", occlusion: "heavy", identifiable: "yes", bbox: [1, 2, 3, 4], color: "white", state: "not-applicable", markings: "not-applicable", evidence: "mostly hidden" },
    },
  });
  fs.writeFileSync(path.join(TAKES, "C.png"), Buffer.concat([PNG_A, Buffer.from("uncertain")]));
  nextReply = uncertain;
  before = visionRequests.length;
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "C.png" });
  assert.strictEqual(result.body.cached, false);
  assert.strictEqual(result.body.validation.states["CHAR-KAI"], "uncertain");
  nextReply = null;
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "C.png" });
  assert.strictEqual(result.body.cached, true, "a truthful uncertain observation is evidence and must be reused");
  assert.strictEqual(result.body.validation.states["PROP-MUG"], "present");
  assert.strictEqual(visionRequests.length, before + 1, "uncertainty must not cause the model to be re-asked");

  /* A provider error is not evidence. */
  fs.writeFileSync(path.join(TAKES, "D.png"), Buffer.concat([PNG_A, Buffer.from("derror")]));
  nextReply = "http-error";
  before = visionRequests.length;
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "D.png" });
  assert.strictEqual(result.response.status, 500);
  nextReply = null;
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "D.png" });
  assert.strictEqual(result.body.cached, false, "a failed provider request must never be cached");

  /* Unparsable output is not evidence. */
  fs.writeFileSync(path.join(TAKES, "E.png"), Buffer.concat([PNG_A, Buffer.from("emalformed")]));
  nextReply = "not json at all";
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "E.png" });
  assert.strictEqual(result.response.status, 502);
  nextReply = null;
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "E.png" });
  assert.strictEqual(result.body.cached, false, "an unparsable response must never be cached");

  /* Output where every declared record is structurally invalid is not evidence. */
  fs.writeFileSync(path.join(TAKES, "F.png"), Buffer.concat([PNG_A, Buffer.from("finvalid")]));
  nextReply = JSON.stringify({
    coordinate_mode: "permille",
    entities: {
      "CHAR-KAI": { presence: "present", occlusion: "none", identifiable: "yes", bbox: null, color: "white", state: "not-applicable", markings: "not-applicable", evidence: "x" },
      "PROP-MUG": { presence: "absent", occlusion: "none", identifiable: "yes", bbox: [1, 2, 3, 4], color: "white", state: "not-applicable", markings: "not-applicable", evidence: "x" },
    },
  });
  before = visionRequests.length;
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "F.png" });
  assert.strictEqual(result.response.status, 200, "a structurally invalid answer is still reported to the caller");
  assert.strictEqual(result.body.validation.invalidEntityIds.length, 2);
  nextReply = null;
  result = await observe({ shotId: "S-01", frameId: "frame-a", fileName: "F.png" });
  assert.strictEqual(result.body.cached, false, "an answer with no usable record must never be cached");
  assert.strictEqual(visionRequests.length, before + 2);

  /* ---- 24. a corrupt cache does not stop the project working ----

     Corrupting only the main file is rescued by the .bak sidecar, which is the
     first line of defence and must be shown to work. */
  fs.writeFileSync(cacheFile(), "}}}not json{{{");
  before = visionRequests.length;
  result = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.body.cached, true, "a corrupt main file must be rescued by its backup");
  assert.strictEqual(visionRequests.length, before, "the backup rescue must not cost a model call");

  /* With both copies unreadable the evidence is genuinely gone. */
  fs.writeFileSync(cacheFile(), "}}}not json{{{");
  fs.writeFileSync(`${cacheFile()}.bak`, "{ also not json");
  const health = await request("/api/system/health");
  assert.strictEqual(health.response.status, 200, "a corrupt cache must not break the project");
  const scan = await request("/api/scan");
  assert.strictEqual(scan.response.status, 200);
  before = visionRequests.length;
  result = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.cached, false, "a corrupt cache degrades to a miss");
  assert.strictEqual(visionRequests.length, before + 1);
  result = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.body.cached, true, "the cache rebuilds itself after corruption");

  /* ---- 25. purge API ---- */
  await observe({ shotId: "S-01", frameId: "frame-b" });
  let stats = (await request("/api/continuity/cache")).body;
  assert(stats.size >= 2, `expected several cached entries, found ${stats.size}`);
  const purgedFrame = await request("/api/continuity/cache?shotId=S-01&frameId=frame-b", { method: "DELETE" });
  assert.strictEqual(purgedFrame.response.status, 200);
  assert.strictEqual(purgedFrame.body.scope, "frame");
  assert(purgedFrame.body.removed >= 1);
  before = visionRequests.length;
  result = await observe({ shotId: "S-01", frameId: "frame-b" });
  assert.strictEqual(result.body.cached, false, "a purged frame must be re-observed");
  assert.strictEqual(visionRequests.length, before + 1);
  /* frame-a survived a frame-scoped purge of frame-b. */
  result = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(result.body.cached, true, "a frame purge must not remove another frame's evidence");

  const purgedAll = await request("/api/continuity/cache", { method: "DELETE" });
  assert.strictEqual(purgedAll.body.scope, "project");
  assert.strictEqual((await request("/api/continuity/cache")).body.size, 0);
  /* Purging evidence never touches media or project data. */
  assert(fs.existsSync(path.join(TAKES, "A.png")), "a purge must never delete media");
  assert(fs.existsSync(path.join(PROJECT_DIR, "project.json")), "a purge must never delete project data");
  /* Unsafe purge inputs are refused. */
  assert.strictEqual((await request("/api/continuity/cache?shotId=NOPE", { method: "DELETE" })).response.status, 404);
  assert.strictEqual((await request("/api/continuity/cache?frameId=frame-a", { method: "DELETE" })).response.status, 400);
  const traversal = await request("/api/continuity/cache?shotId=" + encodeURIComponent("../../etc"), { method: "DELETE" });
  assert.strictEqual(traversal.response.status, 404, "a traversal attempt must not resolve to a project");

  /* ---- 26. the cache-miss request is still the qualified Phase 2 request ---- */
  const miss = visionRequests.at(-1);
  assert.strictEqual(countImages(miss), 1);
  assert.strictEqual(miss.response_format.type, "json_schema");
  assert.strictEqual(miss.response_format.json_schema.name, "declared_entities_final");
  assert.strictEqual(miss.response_format.json_schema.strict, true);
  assert.strictEqual(miss.temperature, 0.2);
  assert.strictEqual(miss.top_k, 1);
  assert.strictEqual(miss.max_tokens, 4096);
  assert.strictEqual(miss.stream, false);
  assert.deepStrictEqual(miss.chat_template_kwargs, { enable_thinking: false });
  assert(!("guided_json" in miss));
  assert.deepStrictEqual(Object.keys(miss).sort(), ["chat_template_kwargs", "max_tokens", "messages", "model", "response_format", "stream", "temperature", "top_k"], "adding a cache must not change the cache-miss request shape");
}

/* ====================================================================
   PART D — project lifecycle
   ==================================================================== */
async function partD() {
  /* Warm the cache again after Part C's purges. */
  await observe({ shotId: "S-01", frameId: "frame-a" });
  assert((await request("/api/continuity/cache")).body.size >= 1);
  const before = fs.readFileSync(cacheFile(), "utf8");

  /* ---- a project backup covers project.json only ----

     Derived machine evidence deliberately does not travel in a portable
     project backup: it can be rebuilt, it can be large, and a backup restore
     must not resurrect evidence for images the restore did not bring back. */
  const backup = await request("/api/projects/cache-project/backups", { method: "POST" });
  assert.strictEqual(backup.response.status, 200, JSON.stringify(backup.body));
  const backupDir = path.join(PROJECT_DIR, "backups");
  const backups = fs.readdirSync(backupDir);
  assert(backups.length >= 1, "a backup must have been written");
  for (const name of backups) assert(/^project-.*\.json$/.test(name), `a project backup must contain only project.json copies, found ${name}`);
  assert(!backups.some((name) => name.includes("continuity")), "the observation cache must not be copied into project backups");

  /* ---- archive and restore carry the whole project directory ----

     Both are a directory rename, so the cache travels with its project and
     stays addressable afterwards. Nothing in Phase 3 needed to teach them
     about the cache — but that has to be proven, not assumed. */
  const archived = await request("/api/projects/cache-project/archive", { method: "POST" });
  assert.strictEqual(archived.response.status, 200, JSON.stringify(archived.body));
  assert(!fs.existsSync(cacheFile()), "the project directory must have moved");
  const archiveDir = path.join(PROJECTS_ROOT, ".archive", archived.body.archiveName);
  assert(fs.existsSync(path.join(archiveDir, CACHE_FILE)), "the cache must travel with an archived project");

  const restored = await request(`/api/projects/archive/${encodeURIComponent(archived.body.archiveName)}/restore`, { method: "POST" });
  assert.strictEqual(restored.response.status, 200, JSON.stringify(restored.body));
  const restoredDir = path.join(PROJECTS_ROOT, restored.body.slug);
  assert(fs.existsSync(path.join(restoredDir, CACHE_FILE)), "the cache must come back with a restored project");
  assert.strictEqual(fs.readFileSync(path.join(restoredDir, CACHE_FILE), "utf8"), before, "restored evidence must be byte-identical");

  /* Reactivate the restored project and confirm the evidence is still used. */
  const switched = await request("/api/projects/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: restored.body.slug }) });
  assert.strictEqual(switched.response.status, 200, JSON.stringify(switched.body));
  const beforeCalls = visionRequests.length;
  const reused = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(reused.body.cached, true, "evidence must survive archive and restore intact");
  assert.strictEqual(visionRequests.length, beforeCalls, "a restored project must not have to re-observe");

  /* ---- the cache is per project and never read across projects ---- */
  const second = path.join(PROJECTS_ROOT, "other-project");
  fs.mkdirSync(path.join(second, "shots", "S-01", "takes"), { recursive: true });
  fs.copyFileSync(path.join(restoredDir, "shots", "S-01", "takes", "A.png"), path.join(second, "shots", "S-01", "takes", "A.png"));
  fs.copyFileSync(path.join(restoredDir, "project.json"), path.join(second, "project.json"));
  await request("/api/projects/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "other-project" }) });
  assert.strictEqual((await request("/api/continuity/cache")).body.size, 0, "a different project must start with no evidence");
  const crossCalls = visionRequests.length;
  const fresh = await observe({ shotId: "S-01", frameId: "frame-a" });
  assert.strictEqual(fresh.body.cached, false, "identical media in another project must not read the first project's cache");
  assert.strictEqual(visionRequests.length, crossCalls + 1);
  assert(fs.existsSync(path.join(second, CACHE_FILE)), "each project keeps its own cache file");

  /* ---- deleting a project takes its evidence with it ---- */
  const deleted = await request("/api/projects/other-project", { method: "DELETE" });
  assert.strictEqual(deleted.response.status, 200, JSON.stringify(deleted.body));
  assert(!fs.existsSync(path.join(second, CACHE_FILE)), "a deleted project must not leave its cache behind");
  assert(!fs.existsSync(second), "the project directory must be gone");
  /* Nothing was orphaned outside the project tree. */
  const stray = fs.readdirSync(PROJECTS_ROOT).filter((name) => name.includes("continuity-observations"));
  assert.deepStrictEqual(stray, [], "no cache file may exist outside a project directory");
}

async function main() {
  await partB();
  await partC();
  await partD();
  console.log("Continuity cache suite passed: evidence is addressed by image bytes rather than filename, every key component is load-bearing, a declared-state-only change stays a HIT while every observation-relevant manifest change is a MISS, uncertain observations are cached but provider errors, unparsable output and wholly invalid answers are not, corruption is quarantined and degrades to a miss without breaking the project, concurrent writes all survive, retention is capped at " + MAX_ENTRIES + " oldest-accessed-first, purge is scoped and never touches media, the cache travels with archive/restore/delete and is never read across projects while staying out of portable project backups, and the cache-miss request is still byte-shape-identical to the qualified Phase 2 request.");
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

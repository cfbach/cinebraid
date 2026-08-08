/* CineBraid config secret registry and provider credential scoping.

   Two security fixes, tested together because they are two halves of the same
   rule: a credential belongs to the endpoint it was configured for, and nothing
   else may see it.

   S1 — an explicit endpoint override replaces a provider's whole CONNECTION.
        The OpenAI branch used `endpoint.apiKey || cfg.openaiKey`, so a blank key
        on an explicit endpoint fell through to the user's OpenAI credential and
        transmitted it to a host it was never configured for. Every assertion
        below inspects the ACTUAL outgoing Authorization header, not the resolved
        config, because the resolved config was never the thing that leaked.

   S0 — which config fields are credentials is declared once, in CONFIG_SECRETS.
        The masking (GET) and restoring (PUT) halves used to be two hand-written
        enumerations in the route handlers; continuity.apiKey was added to neither
        and left the server in cleartext. A field is secret because it is
        declared, never because a handler remembered it and never because its name
        happens to contain "key".

   Everything runs against local mock endpoints. No suite in CineBraid may depend
   on a live model service, and this one in particular must never reach a real
   provider: the whole point is that no credential is sent. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-secret-registry-"));
/* Part A drives llm.js in THIS process, so its config path must be set before
   ../config is first required. Part B/C spawn a server with its own file. */
const UNIT_CONFIG_PATH = path.join(TEMP, "unit-config.json");
const SERVER_CONFIG_PATH = path.join(TEMP, "server-config.json");
process.env.CINEBRAID_CONFIG_PATH = UNIT_CONFIG_PATH;

const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "secret-project");
const TAKES = path.join(PROJECT_DIR, "shots", "S-01", "takes");

/* Distinctive canaries. Every one is grepped for in payloads that must not
   contain it, so they must not appear by accident — and none is shaped like a
   real credential, so scripts/scan-secrets.js needs no suppression for this
   file. Deliberately not `sk-…`: a synthetic value that trips the scanner buys
   a permanent allowlist entry for no benefit. */
const OPENAI_KEY = "openai-LEAKCANARY-1111";
const ANTHROPIC_KEY = "anthropic-LEAKCANARY-2222";
const CUSTOM_KEY = "custom-MUSTNEVERLEAK-3333";
const CONTINUITY_KEY = "continuity-MUSTNEVERLEAK-4444";
const FAL_KEY = "fal-MUSTNEVERLEAK-5555";
const EDITOR_PASS = "editor-MUSTNEVERLEAK-6666";
const VIEWER_PASS = "viewer-MUSTNEVERLEAK-7777";
const AUTH_SECRET = "authsecret-MUSTNEVERLEAK-8888";
const ALL_SECRETS = [
  OPENAI_KEY, ANTHROPIC_KEY, CUSTOM_KEY, CONTINUITY_KEY,
  FAL_KEY, EDITOR_PASS, VIEWER_PASS, AUTH_SECRET,
];

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
/* Different bytes, so the second observation is a genuine provider call rather
   than a cache hit. The observation cache keys on the image hash and the
   endpoint ADDRESS — deliberately not the credential — so re-observing the same
   frame at the same endpoint would correctly answer from cache. */
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let visionUpstream = null;
let visionPort = 0;
let ollamaServer = null;
let ollamaPort = 0;
/* Every request the mock provider received, with the header that matters. */
const received = [];
let child = null;
let base = "";
let output = "";

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
/* A well-formed observation for whatever entity ids the schema declares. */
function validReplyFor(body) {
  const ids = body?.response_format?.json_schema?.schema?.properties?.entities?.required || [];
  const entities = {};
  for (const id of ids)
    entities[id] = {
      presence: "present", occlusion: "none", identifiable: "yes",
      bbox: [100, 100, 200, 200], color: "white", state: "not-applicable",
      markings: "not-applicable", evidence: "visible in frame",
    };
  return JSON.stringify({ coordinate_mode: "permille", entities });
}
async function request(url, options) {
  const response = await fetch(base + url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
/* The single question this suite exists to answer. */
function lastAuthorization() {
  return received.at(-1)?.authorization;
}
function assertNoSecretIn(label, payload) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const secret of ALL_SECRETS)
    assert(!raw.includes(secret), `${label} must not contain the raw secret ${secret}`);
}

function writeUnitConfig(patch = {}) {
  fs.writeFileSync(UNIT_CONFIG_PATH, JSON.stringify({
    assistant: { provider: "openai", visionProvider: "same" },
    openaiBaseUrl: `http://127.0.0.1:${visionPort}/provider-default`,
    openaiKey: OPENAI_KEY,
    openaiModel: "gpt-test",
    openaiVisionModel: "gpt-test",
    customBaseUrl: `http://127.0.0.1:${visionPort}/custom-default`,
    customKey: CUSTOM_KEY,
    customModel: "custom-test",
    customVisionModel: "custom-test",
    ...patch,
  }, null, 2));
}

function writeProject() {
  fs.mkdirSync(TAKES, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  fs.writeFileSync(path.join(TAKES, "S-01_FRAME_A.png"), PNG);
  fs.writeFileSync(path.join(TAKES, "S-01_FRAME_B.png"), PNG_B);
  const states = [{ id: "state-default", name: "Default", notes: "Primary approved reference.", isDefault: true }];
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify({
    meta: { title: "Secret Registry", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [{ id: "CHAR-KAI", name: "Kai", block: "Late-30s, lean.", continuityStates: states }],
    locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{
      id: "S-01", scene: "SC-01", title: "Kai", desc: "Kai stands still.",
      characters: ["CHAR-KAI"], codes: [],
      creationBrief: { propIds: [], vehicleIds: [], frameWorkflows: {} },
      continuityStateSelections: {},
      keyframes: [
        { id: "frame-a", label: "A", winner: "S-01_FRAME_A.png", required: true, generationPackages: [] },
        { id: "frame-b", label: "B", winner: "S-01_FRAME_B.png", required: true, generationPackages: [] },
      ],
      clips: [], candidateFiles: [],
    }],
    agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
}

/* The server's stored config: every declared secret set to a distinctive value,
   plus two decoys whose names contain "key"/"token" but which are NOT secrets. */
function writeServerConfig() {
  fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify({
    activeProject: "secret-project",
    assistant: { provider: "ollama", visionProvider: "ollama" },
    anthropicKey: ANTHROPIC_KEY,
    openaiKey: OPENAI_KEY,
    openaiBaseUrl: `http://127.0.0.1:${visionPort}/openai`,
    openaiVisionModel: "gpt-test",
    customKey: CUSTOM_KEY,
    customBaseUrl: `http://127.0.0.1:${visionPort}/custom`,
    customModel: "custom-test",
    customVisionModel: "custom-test",
    /* Continuity stands alone at the mock. It starts with a key of its own so
       the masking assertions have something to mask; C6 blanks it to reproduce
       the shape Settings actually produces, which is the shape that leaked. */
    continuity: { visionProvider: "openai", visionModel: "gpt-test", baseUrl: `http://127.0.0.1:${visionPort}/continuity`, apiKey: CONTINUITY_KEY },
    generation: { fal: { enabled: false, apiKey: FAL_KEY } },
    ollamaUrl: `http://127.0.0.1:${ollamaPort}`,
    ollamaModel: "local-text-model",
    ollamaVisionModel: "local-vision-model",
    editorPass: "", /* auth stays off; the passcode fields are exercised via PUT */
    viewerPass: "",
    authSecret: AUTH_SECRET,
    /* Decoys: named like secrets, declared as nothing. */
    myTokenSetting: "decoy-token-visible",
    notASecretKey: "decoy-key-visible",
  }, null, 2));
}

async function main() {
  visionPort = await freePort();
  ollamaPort = await freePort();
  visionUpstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ url: req.url, authorization: req.headers.authorization, body });
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/chat/completions"))
      return res.end(JSON.stringify({ choices: [{ message: { content: countImages(body) ? validReplyFor(body) : "ok" } }] }));
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "gpt-test" }] }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => visionUpstream.listen(visionPort, "127.0.0.1", resolve));
  ollamaServer = http.createServer(async (req, res) => {
    await readBody(req);
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "local-vision-model" }, { name: "local-text-model" }] }));
    res.end(JSON.stringify({ message: { content: "local reply" } }));
  });
  await new Promise((resolve) => ollamaServer.listen(ollamaPort, "127.0.0.1", resolve));

  /* =====================================================================
     PART A — S1, at the wire. Provider credential scoping.
     ===================================================================== */
  const { vision, resolveProviderConnection } = require("../llm");
  const IMAGE = [PNG.toString("base64")];

  /* ---- A1. no endpoint override: OpenAI behaviour is unchanged ---- */
  writeUnitConfig();
  await vision("system", "user", IMAGE, 64, "openai");
  assert.strictEqual(
    received.at(-1).url, "/provider-default/chat/completions",
    "without an override the configured OpenAI base URL must be used",
  );
  assert.strictEqual(
    lastAuthorization(), `Bearer ${OPENAI_KEY}`,
    "without an override the configured OpenAI key must still be sent",
  );

  /* ---- A2. an explicit endpoint with its own key uses BOTH of its own ---- */
  await vision("system", "user", IMAGE, 64, "openai", "", {
    endpoint: { baseUrl: `http://127.0.0.1:${visionPort}/explicit`, apiKey: "explicit-endpoint-key" },
  });
  assert.strictEqual(received.at(-1).url, "/explicit/chat/completions");
  assert.strictEqual(
    lastAuthorization(), "Bearer explicit-endpoint-key",
    "an explicit endpoint with a key must send that key",
  );

  /* ---- A3. an explicit endpoint with a BLANK key sends NO credential ----
     This is the defect. `endpoint.apiKey || cfg.openaiKey` sent the user's
     OpenAI key to whatever host the override named. */
  await vision("system", "user", IMAGE, 64, "openai", "", {
    endpoint: { baseUrl: `http://127.0.0.1:${visionPort}/blank-key`, apiKey: "" },
  });
  assert.strictEqual(received.at(-1).url, "/blank-key/chat/completions");
  assert.strictEqual(
    lastAuthorization(), undefined,
    "an explicit endpoint with a blank key must receive NO Authorization header",
  );
  assertNoSecretIn("a blank-key endpoint request", received.at(-1));

  /* ---- A4. omitted and null keys behave the same as blank ---- */
  for (const [label, endpoint] of [
    ["omitted", { baseUrl: `http://127.0.0.1:${visionPort}/omitted-key` }],
    ["null", { baseUrl: `http://127.0.0.1:${visionPort}/null-key`, apiKey: null }],
  ]) {
    await vision("system", "user", IMAGE, 64, "openai", "", { endpoint });
    assert.strictEqual(
      lastAuthorization(), undefined,
      `an explicit endpoint with an ${label} key must not inherit the provider credential`,
    );
  }

  /* ---- A5. the custom branch keeps the semantics it already had ---- */
  await vision("system", "user", IMAGE, 64, "custom");
  assert.strictEqual(lastAuthorization(), `Bearer ${CUSTOM_KEY}`, "custom with no override is unchanged");
  await vision("system", "user", IMAGE, 64, "custom", "", {
    endpoint: { baseUrl: `http://127.0.0.1:${visionPort}/custom-explicit`, apiKey: "" },
  });
  assert.strictEqual(
    lastAuthorization(), undefined,
    "an explicit endpoint must not inherit the custom key either",
  );

  /* ---- A6. both OpenAI-compatible branches resolve through one helper ----
     so a future explicit endpoint cannot reintroduce the defect by copying
     whichever branch was not fixed. */
  assert.deepStrictEqual(
    resolveProviderConnection({}, "base", "provider-key"),
    { baseUrl: "base", apiKey: "provider-key" },
  );
  assert.deepStrictEqual(
    resolveProviderConnection({ endpoint: { baseUrl: "own", apiKey: "" } }, "base", "provider-key"),
    { baseUrl: "own", apiKey: "" },
  );
  assert.deepStrictEqual(
    resolveProviderConnection({ endpoint: { baseUrl: "own", apiKey: "own-key" } }, "base", "provider-key"),
    { baseUrl: "own", apiKey: "own-key" },
  );

  /* =====================================================================
     PART B — the registry itself, in isolation.
     ===================================================================== */
  const {
    CONFIG_SECRETS, MASK_PREFIX, SECRET_PRESENCE_SET,
    maskSecrets, mergeConfig, normalizeConfig, restoreSecrets,
  } = require("../config");

  const stored = normalizeConfig({
    anthropicKey: ANTHROPIC_KEY, openaiKey: OPENAI_KEY, customKey: CUSTOM_KEY,
    continuity: { apiKey: CONTINUITY_KEY, baseUrl: "http://example.invalid/v1", visionProvider: "openai" },
    generation: { fal: { apiKey: FAL_KEY } },
    editorPass: EDITOR_PASS, viewerPass: VIEWER_PASS, authSecret: AUTH_SECRET,
  });

  /* ---- B1. every declared secret is masked, and nothing leaks ----
     Two shapes, walked differently. A scalar path is a plain dot-reduce. A
     collection path (`accounts[*].credential.…`) names every element of an array,
     which a dot-reduce cannot express and which has nothing to walk on a config
     with no connections — so those declarations are checked against a fixture of
     their own, immediately below, rather than passing vacuously here. */
  const masked = maskSecrets(stored);
  assertNoSecretIn("maskSecrets output", masked);
  const collectionSecrets = CONFIG_SECRETS.filter((x) => x.path.includes("[*]"));
  for (const secret of CONFIG_SECRETS.filter((x) => x.mode === "masked" && !x.path.includes("[*]"))) {
    const value = secret.path.split(".").reduce((node, key) => (node || {})[key], masked);
    assert(String(value).startsWith(MASK_PREFIX), `${secret.path} must be masked`);
  }
  assert(collectionSecrets.length, "the collection grammar must stay in use, not become dead syntax");
  {
    const withCollection = maskSecrets({
      accounts: [{ connectionId: "conn-fixture", credential: { accessToken: "tok-AAAA1111", refreshToken: "ref-AAAA2222", apiKey: "key-AAAA3333" } }],
    });
    const credential = withCollection.accounts[0].credential;
    for (const secret of collectionSecrets) {
      const field = secret.path.split(".").pop();
      if (secret.mode === "omit") assert(!(field in credential), `${secret.path} must be removed entirely`);
      else assert(String(credential[field]).startsWith(MASK_PREFIX), `${secret.path} must be masked`);
    }
  }
  assert.strictEqual(masked.continuity.apiKey, `${MASK_PREFIX}4444`, "continuity.apiKey must be masked");
  assert.strictEqual(masked.editorPass, SECRET_PRESENCE_SET);
  assert.strictEqual(masked.viewerPass, SECRET_PRESENCE_SET);
  assert(!("authSecret" in masked), "authSecret must be omitted entirely");
  assert.strictEqual(maskSecrets({}).anthropicKey, "", "an unset secret masks to an empty string, as before");

  /* ---- B2. a GET → PUT round trip changes nothing ---- */
  let next = mergeConfig(stored, restoreSecrets(masked, stored));
  assert.strictEqual(next.anthropicKey, ANTHROPIC_KEY);
  assert.strictEqual(next.openaiKey, OPENAI_KEY);
  assert.strictEqual(next.customKey, CUSTOM_KEY);
  assert.strictEqual(next.continuity.apiKey, CONTINUITY_KEY);
  assert.strictEqual(next.generation.fal.apiKey, FAL_KEY);
  assert.strictEqual(next.editorPass, EDITOR_PASS);
  assert.strictEqual(next.viewerPass, VIEWER_PASS);
  assert.strictEqual(next.authSecret, AUTH_SECRET);

  /* ---- B3. updating one secret changes only that secret ---- */
  next = mergeConfig(stored, restoreSecrets({ ...masked, openaiKey: "openai-REPLACED" }, stored));
  assert.strictEqual(next.openaiKey, "openai-REPLACED");
  assert.strictEqual(next.anthropicKey, ANTHROPIC_KEY);
  assert.strictEqual(next.continuity.apiKey, CONTINUITY_KEY);
  assert.strictEqual(next.generation.fal.apiKey, FAL_KEY);

  /* ---- B4. changing unrelated config erases nothing, and the patch does
             not sprout branches the caller never sent ---- */
  const partial = restoreSecrets({ ollamaModel: "another-model" }, stored);
  assert(!("generation" in partial), "restore must not create a branch the patch omitted");
  assert(!("continuity" in partial), "restore must not create a branch the patch omitted");
  next = mergeConfig(stored, partial);
  assert.strictEqual(next.ollamaModel, "another-model");
  for (const [label, value] of [["openai", next.openaiKey], ["continuity", next.continuity.apiKey],
    ["fal", next.generation.fal.apiKey], ["editorPass", next.editorPass], ["authSecret", next.authSecret]])
    assert(value, `an unrelated config change must not erase the ${label} secret`);

  /* ---- B5. explicit clear still clears — existing behaviour, preserved ---- */
  next = mergeConfig(stored, restoreSecrets({ openaiKey: "", continuity: { apiKey: "" }, editorPass: "" }, stored));
  assert.strictEqual(next.openaiKey, "");
  assert.strictEqual(next.continuity.apiKey, "");
  assert.strictEqual(next.editorPass, "");

  /* ---- B6. a placeholder never becomes the stored secret ---- */
  next = mergeConfig(stored, restoreSecrets({ editorPass: SECRET_PRESENCE_SET, viewerPass: SECRET_PRESENCE_SET }, stored));
  assert.strictEqual(next.editorPass, EDITOR_PASS, "the set-marker must not become the passcode");
  assert.strictEqual(next.viewerPass, VIEWER_PASS);
  next = mergeConfig(stored, restoreSecrets({ editorPass: 12345 }, stored));
  assert.strictEqual(next.editorPass, EDITOR_PASS, "a non-string passcode is ignored, as before");

  /* ---- B7. an omitted secret is never accepted from a patch either ----
     authSecret signs every session cookie and is never shown, so a client has no
     legitimate value to send. Declaring it omit-mode covers both directions. */
  next = mergeConfig(stored, restoreSecrets({ authSecret: "attacker-chosen" }, stored));
  assert.strictEqual(next.authSecret, AUTH_SECRET, "authSecret must not be settable through a config patch");

  /* ---- B8. secrecy comes from the registry, not from field names ---- */
  const decoys = maskSecrets(normalizeConfig({ myTokenSetting: "visible", notASecretKey: "visible", apiKeyish: "visible" }));
  for (const key of ["myTokenSetting", "notASecretKey", "apiKeyish"])
    assert.strictEqual(decoys[key], "visible", `${key} is not declared secret and must not be masked`);

  /* ---- B9. the registry can already express a future nested collection
             credential, without either algorithm changing ----
     No account fields are added anywhere; this proves the path grammar only. */
  const futureRegistry = [
    { path: "accounts[*].credential.accessToken", mode: "masked", identity: "connectionId" },
    { path: "accounts[*].credential.refreshToken", mode: "masked", identity: "connectionId" },
  ];
  const withAccounts = {
    accounts: [
      { connectionId: "acct-1", displayName: "One", credential: { accessToken: "tok-AAAA1111", refreshToken: "ref-AAAA2222" } },
      { connectionId: "acct-2", displayName: "Two", credential: { accessToken: "tok-BBBB3333", refreshToken: "ref-BBBB4444" } },
    ],
  };
  const maskedAccounts = maskSecrets(withAccounts, futureRegistry);
  assert.strictEqual(maskedAccounts.accounts[0].credential.accessToken, `${MASK_PREFIX}1111`);
  assert.strictEqual(maskedAccounts.accounts[1].credential.refreshToken, `${MASK_PREFIX}4444`);
  assert.strictEqual(maskedAccounts.accounts[0].displayName, "One", "non-secret sibling fields are untouched");
  /* Reordered on the way back: correlation is by identity, not position. */
  const reordered = { accounts: [maskedAccounts.accounts[1], maskedAccounts.accounts[0]] };
  const restoredAccounts = restoreSecrets(reordered, withAccounts, futureRegistry);
  assert.strictEqual(restoredAccounts.accounts[0].credential.accessToken, "tok-BBBB3333");
  assert.strictEqual(restoredAccounts.accounts[1].credential.accessToken, "tok-AAAA1111");

  /* =====================================================================
     PART C — the real routes, on a real server.
     ===================================================================== */
  writeProject();
  writeServerConfig();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CINEBRAID_CONFIG_PATH: SERVER_CONFIG_PATH,
      CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
      CINEBRAID_AI_VISION_TIMEOUT_MS: "4000",
      /* FAL_KEY must stay unset here so the stored fal key is what is masked. */
      FAL_KEY: "",
    },
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

  /* ---- C1. GET /api/config never emits a raw secret ---- */
  let result = await request("/api/config");
  assert.strictEqual(result.response.status, 200);
  assertNoSecretIn("GET /api/config", result.body);
  assert.match(result.body.anthropicKey, /^••••/);
  assert.match(result.body.openaiKey, /^••••/);
  assert.match(result.body.customKey, /^••••/);
  assert.match(result.body.generation.fal.apiKey, /^••••/);
  assert.strictEqual(result.body.generation.fal.keySource, "settings");
  assert.match(
    result.body.continuity.apiKey, /^••••/,
    "continuity.apiKey must be masked — this is the field that used to leave in cleartext",
  );
  assert(!("authSecret" in result.body), "authSecret must not be sent to the browser at all");
  assert.strictEqual(result.body.myTokenSetting, "decoy-token-visible", "a non-secret field must not be masked by name");
  assert.strictEqual(result.body.notASecretKey, "decoy-key-visible");
  /* Non-secret config is otherwise untouched. */
  assert.strictEqual(result.body.ollamaModel, "local-text-model");
  assert.strictEqual(result.body.continuity.visionProvider, "openai");

  /* ---- C2. a GET → PUT round trip preserves every stored secret ----
     Everything GET returned goes back except `workspace`, which this route
     deliberately refuses in favour of the storage-settings endpoint. That guard
     predates this change and is asserted separately below. */
  const echoed = { ...result.body };
  delete echoed.workspace;
  const roundTrip = await request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(echoed),
  });
  assert.strictEqual(roundTrip.response.status, 200, JSON.stringify(roundTrip.body));
  let onDisk = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, "utf8"));
  assert.strictEqual(onDisk.anthropicKey, ANTHROPIC_KEY);
  assert.strictEqual(onDisk.openaiKey, OPENAI_KEY);
  assert.strictEqual(onDisk.customKey, CUSTOM_KEY);
  assert.strictEqual(onDisk.continuity.apiKey, CONTINUITY_KEY);
  assert.strictEqual(onDisk.generation.fal.apiKey, FAL_KEY);
  assert.strictEqual(onDisk.authSecret, AUTH_SECRET, "a round trip must not disturb the signing secret");

  /* ---- C3. a partial patch of unrelated config erases nothing ---- */
  await request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ollamaModel: "changed-model" }),
  });
  onDisk = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, "utf8"));
  assert.strictEqual(onDisk.ollamaModel, "changed-model");
  assert.strictEqual(onDisk.openaiKey, OPENAI_KEY);
  assert.strictEqual(onDisk.continuity.apiKey, CONTINUITY_KEY);
  assert.strictEqual(onDisk.generation.fal.apiKey, FAL_KEY);
  assert.strictEqual(onDisk.authSecret, AUTH_SECRET);

  /* ---- C4. a genuine new nested secret replaces only itself ---- */
  await request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ generation: { fal: { apiKey: "fal-REPLACED-9999" } } }),
  });
  onDisk = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, "utf8"));
  assert.strictEqual(onDisk.generation.fal.apiKey, "fal-REPLACED-9999");
  assert.strictEqual(onDisk.openaiKey, OPENAI_KEY);
  assert.strictEqual(onDisk.continuity.apiKey, CONTINUITY_KEY);

  /* ---- C5. no other browser-facing surface carries a raw secret ---- */
  for (const route of ["/api/config", "/api/agents/status", "/api/system/health"]) {
    const payload = await request(route);
    assertNoSecretIn(`GET ${route}`, payload.body);
  }

  /* ---- C6. S1 end to end: a standalone continuity endpoint with no key of
             its own must not receive the stored OpenAI credential ----
     This is the exact reachable configuration: Settings renders no continuity
     key field, so continuity.apiKey is "" on every install that configures a
     standalone endpoint through the interface. */
  const blanked = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, "utf8"));
  blanked.continuity.apiKey = "";
  assert.strictEqual(blanked.openaiKey, OPENAI_KEY, "the stored OpenAI key is what must not travel");
  fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify(blanked, null, 2));
  received.length = 0;
  const observe = await request("/api/continuity/observe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shotId: "S-01", frameId: "frame-a" }),
  });
  assert.strictEqual(observe.response.status, 200, `observe failed: ${JSON.stringify(observe.body)}`);
  const continuityCall = received.find((entry) => entry.url.startsWith("/continuity"));
  assert(continuityCall, `continuity must reach its own endpoint. Saw: ${received.map((r) => r.url).join(", ")}`);
  assert.strictEqual(
    continuityCall.authorization, undefined,
    "a standalone continuity endpoint with no key must receive NO credential — least of all the OpenAI key",
  );
  assertNoSecretIn("the continuity provider request", continuityCall);

  /* ---- C7. a standalone endpoint WITH its own key still gets that key ----
     The fix must not make a correctly configured standalone endpoint fail. */
  const configured = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, "utf8"));
  configured.continuity.apiKey = "continuity-own-0000";
  fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify(configured, null, 2));
  received.length = 0;
  const observeKeyed = await request("/api/continuity/observe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shotId: "S-01", frameId: "frame-b" }),
  });
  assert.strictEqual(observeKeyed.response.status, 200, `keyed observe failed: ${JSON.stringify(observeKeyed.body)}`);
  const keyedCall = received.find((entry) => entry.url.startsWith("/continuity"));
  assert.strictEqual(
    keyedCall.authorization, "Bearer continuity-own-0000",
    "a standalone endpoint with its own key must still be able to authenticate",
  );

  /* ---- C8. the continuity request contract is unchanged by this hotfix ----
     Sampling, budget and schema are qualification guarantees, not preferences. */
  const sent = keyedCall.body;
  assert.strictEqual(countImages(sent), 1, "continuity observation still sends exactly one image");
  assert.strictEqual(sent.max_tokens, 4096);
  assert.strictEqual(sent.temperature, 0.2);
  assert.strictEqual(sent.top_k, 1);
  assert.deepStrictEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert.strictEqual(sent.response_format.type, "json_schema");
  assert.strictEqual(sent.response_format.json_schema.name, "declared_entities_final");
  assert.strictEqual(sent.response_format.json_schema.strict, true);

  console.log(
    "Config secret registry suite passed: every declared secret is masked on read and restored on write, "
    + "continuity.apiKey never leaves in cleartext, an explicit endpoint never inherits a provider credential, "
    + "and the continuity request contract is unchanged.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    if (output) console.error(`--- server output ---\n${output}`);
    process.exitCode = 1;
  })
  .finally(() => {
    child?.kill();
    visionUpstream?.close();
    ollamaServer?.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

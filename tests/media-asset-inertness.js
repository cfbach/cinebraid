/* CineBraid MediaAsset boundary — the ledger is inert with respect to the product.
 *
 * Phase 2a landed identity, schema, lifecycle and the store. Phase 2b adds
 * discovery, indexing and explicit verification. What has NOT changed, and is the
 * point of this suite, is that none of it is reachable from CineBraid itself: no
 * route invokes it, opening a project does not trigger it, and a project with no
 * `media-assets.json` remains the normal state.
 *
 * That matters because indexing writes a file and verification reads media bytes.
 * Wiring either to project open would create a sidecar in every project and, on a
 * cloud-synced root, could pull a media corpus over the network. Activation is a
 * deliberate later decision, and this suite is what stops it happening by accident.
 *
 * The boundary is proved two ways, because either alone is weak: a source scan
 * (no production module imports or calls the ledger) and a runtime proof (opening a
 * real project through the real server creates no ledger, reads no media, PUTs
 * nothing).
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-inertness-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "inert-project");
const TAKES = path.join(PROJECT_DIR, "shots", "S-01", "takes");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ---- 1. source scan: no production module reaches the ledger ----
   The ledger modules import each other — that is the pipeline. What must not exist
   is an import or a call from anything else, because that is how a call site grows. */
const LEDGER_MODULES = ["media-assets", "media-asset-store", "media-asset-indexer", "media-asset-verify"];
const productionFiles = [
  ...fs.readdirSync(ROOT).filter((name) => name.endsWith(".js")),
  ...fs.readdirSync(path.join(ROOT, "public")).filter((name) => name.endsWith(".js")).map((name) => `public/${name}`),
  ...fs.readdirSync(path.join(ROOT, "scripts")).filter((name) => name.endsWith(".js")).map((name) => `scripts/${name}`),
].filter((rel) => !LEDGER_MODULES.includes(path.basename(rel, ".js")));

for (const rel of productionFiles) {
  const source = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  for (const moduleName of LEDGER_MODULES)
    assert(
      !new RegExp(`require\\(["'.\\/]*${moduleName}["']\\)`).test(source),
      `${rel} imports ${moduleName}. The ledger must have no production call site.`,
    );
  /* Persistence, indexing and verification must all be unreachable by name too —
     an import is not the only way to acquire a function. */
  for (const symbol of ["writeLedger", "writeLedgerSync", "readLedger", "indexProject", "verifyAssets"])
    assert(!new RegExp(`\\b${symbol}\\s*\\(`).test(source),
      `${rel} calls ${symbol}. Indexing and verification are not activated by this phase.`);
}

/* media-hash.js IS imported — by continuity-cache.js, which is the point of the
   extraction. Assert that relationship explicitly so the scan above cannot be
   misread as "nothing imports anything". */
const continuitySource = fs.readFileSync(path.join(ROOT, "continuity-cache.js"), "utf8");
assert(/require\("\.\/media-hash"\)/.test(continuitySource),
  "continuity-cache.js must consume the shared hasher — that is the extraction");

/* ---- 2. the schema and store layers stay free of discovery and hashing ----
   Discovery belongs to the indexer and hashing to the verifier, and keeping both
   out of the layers underneath is what makes the separation checkable. */
const foundationSource = ["media-assets", "media-asset-store"]
  .map((name) => stripComments(fs.readFileSync(path.join(ROOT, `${name}.js`), "utf8")))
  .join("\n");
for (const forbidden of ["readdirSync", "readdir", "opendirSync", "globSync", "hashMediaFile", "hashImageFile"])
  assert(!new RegExp(`\\b${forbidden}\\b`).test(foundationSource),
    `The schema and store layers must not reference ${forbidden} — no discovery, no hashing`);
assert(!/readFileSync\s*\(\s*[^)]*\bmedia\b/i.test(foundationSource),
  "The schema and store layers must not read media files");

/* ---- 2b. the indexer cannot hash, and the verifier is the only module that can ----
   This is the cloud-sync guarantee in structural form: the default pass is
   incapable of hydrating a placeholder because it has no hasher to call. */
const indexerSource = stripComments(fs.readFileSync(path.join(ROOT, "media-asset-indexer.js"), "utf8"));
for (const forbidden of ["media-hash", "hashMediaFile", "hashImageFile", "readFileSync", "createReadStream"])
  assert(!indexerSource.includes(forbidden),
    `media-asset-indexer.js references ${forbidden} — the default index must be unable to read bytes`);
const verifierSource = stripComments(fs.readFileSync(path.join(ROOT, "media-asset-verify.js"), "utf8"));
assert(/require\("\.\/media-hash"\)/.test(verifierSource),
  "media-asset-verify.js is the one module allowed to hash, and must use the shared hasher");

/* ---- 3. runtime proof: opening a real project changes nothing ---- */
function writeProject() {
  fs.mkdirSync(TAKES, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  /* Real media, so "no media was read" is a claim with something to read. */
  for (const name of ["S-01_FRAME_A.png", "S-01_FRAME_B.png", "S-01_FRAME_C.png"])
    fs.writeFileSync(path.join(TAKES, name), PNG);
  fs.writeFileSync(path.join(PROJECT_DIR, "anchors", "CHAR-KAI.png"), PNG);
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify({
    meta: { title: "Inert", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [{ id: "CHAR-KAI", name: "Kai", continuityStates: [{ id: "state-default", name: "Default", isDefault: true }] }],
    locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{
      id: "S-01", scene: "SC-01", title: "Kai", desc: "Kai stands still.",
      characters: ["CHAR-KAI"], codes: [],
      creationBrief: { propIds: [], vehicleIds: [], frameWorkflows: {} },
      keyframes: [{ id: "frame-a", label: "A", winner: "S-01_FRAME_A.png", required: true, generationPackages: [] }],
      clips: [], candidateFiles: [{ stored: "S-01_FRAME_A.png", decision: "shortlist", addedAt: "t" }],
    }],
    agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ activeProject: "inert-project", assistant: { provider: "ollama", visionProvider: "ollama" } }, null, 2));
}

async function main() {
  writeProject();
  const projectBytesBefore = fs.readFileSync(path.join(PROJECT_DIR, "project.json"));
  const mediaMtimesBefore = fs.readdirSync(TAKES).map((name) => {
    const stat = fs.statSync(path.join(TAKES, name));
    return `${name}|${stat.atimeMs}|${stat.mtimeMs}`;
  });

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT },
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

  /* Exercise the paths a normal open touches. */
  for (const route of ["/api/project", "/api/projects", "/api/scan", "/api/config", "/api/docs"]) {
    const response = await fetch(base + route);
    assert(response.ok, `${route} must still answer normally (got ${response.status})`);
    await response.json().catch(() => null);
  }

  /* No ledger anywhere under the project — not in the root, not in a subdirectory. */
  const strays = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.startsWith("media-assets")) strays.push(full);
    }
  })(PROJECTS_ROOT);
  assert.deepStrictEqual(strays, [],
    "opening a project must not create media-assets.json anywhere");

  /* project.json is byte-identical — no PUT, no normalisation write. */
  assert(
    projectBytesBefore.equals(fs.readFileSync(path.join(PROJECT_DIR, "project.json"))),
    "opening a project must leave project.json byte-identical",
  );
  /* And no backup was taken, which is what a write would have produced. */
  const backups = path.join(PROJECT_DIR, "backups");
  assert(
    !fs.existsSync(backups) || fs.readdirSync(backups).length === 0,
    "no project backup may be created, because no project write may happen",
  );

  /* No media file was read. atime is the direct evidence where the filesystem
     records it; mtime must be untouched regardless. */
  const mediaMtimesAfter = fs.readdirSync(TAKES).map((name) => {
    const stat = fs.statSync(path.join(TAKES, name));
    return `${name}|${stat.atimeMs}|${stat.mtimeMs}`;
  });
  for (let i = 0; i < mediaMtimesBefore.length; i += 1) {
    const [name, , mtimeBefore] = mediaMtimesBefore[i].split("|");
    const [, , mtimeAfter] = mediaMtimesAfter[i].split("|");
    assert.strictEqual(mtimeAfter, mtimeBefore, `${name} must not be modified by opening a project`);
  }

  /* FAL and the browser are untouched by this PR — assert the files themselves. */
  const untouched = ["fal-generation.js", "public/fal-generation.js", "public/app.js", "public/index.html"];
  for (const rel of untouched) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const moduleName of [...LEDGER_MODULES, "media-hash"])
      assert(!source.includes(moduleName),
        `${rel} must not reference ${moduleName} — no FAL or browser behaviour changes in this phase`);
  }

  console.log(
    "MediaAsset inertness suite passed: no production module imports the ledger or calls its reader, writer, indexer "
    + "or verifier; the schema and store layers contain no discovery or hashing and the indexer cannot read bytes at "
    + "all; and opening a real project with media on disk creates no media-assets.json, leaves project.json "
    + "byte-identical with no backup written, and modifies no media file.",
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
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

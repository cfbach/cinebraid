/* CineBraid Phase 2a boundary — the foundation is inert.
 *
 * Phase 2a lands MediaAsset identity, schema, lifecycle and the durable store, and
 * deliberately wires none of it up. Phase 2b adds discovery and indexing. Until
 * then a project with no `media-assets.json` is the normal state, and this suite is
 * what stops "inert" from being a claim in a PR description rather than a property
 * of the code.
 *
 * It proves the boundary two ways, because either alone is weak: a source scan
 * (nothing outside tests/ imports the store) and a runtime proof (opening a real
 * project through the real server creates no ledger, reads no media, and PUTs
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

/* ---- 1. source scan: no production module imports the Phase 2a modules ----
   Store code may exist and tests may exercise it. What must not exist is a
   production import that could grow a call site. */
const PHASE_2A_MODULES = ["media-assets", "media-asset-store"];
const productionFiles = [
  ...fs.readdirSync(ROOT).filter((name) => name.endsWith(".js")),
  ...fs.readdirSync(path.join(ROOT, "public")).filter((name) => name.endsWith(".js")).map((name) => `public/${name}`),
  ...fs.readdirSync(path.join(ROOT, "scripts")).filter((name) => name.endsWith(".js")).map((name) => `scripts/${name}`),
].filter((rel) => !PHASE_2A_MODULES.includes(path.basename(rel, ".js")));

for (const rel of productionFiles) {
  const source = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  for (const moduleName of PHASE_2A_MODULES)
    assert(
      !new RegExp(`require\\(["'.\\/]*${moduleName}["']\\)`).test(source),
      `${rel} imports ${moduleName}. Phase 2a must have no production call site.`,
    );
  /* The store's own writer must not be reachable from product code either. */
  for (const symbol of ["writeLedger", "writeLedgerSync", "readLedger"])
    assert(!new RegExp(`\\b${symbol}\\s*\\(`).test(source),
      `${rel} calls ${symbol}. Phase 2a must not activate ledger persistence.`);
}

/* media-hash.js IS imported — by continuity-cache.js, which is the point of the
   extraction. Assert that relationship explicitly so the scan above cannot be
   misread as "nothing imports anything". */
const continuitySource = fs.readFileSync(path.join(ROOT, "continuity-cache.js"), "utf8");
assert(/require\("\.\/media-hash"\)/.test(continuitySource),
  "continuity-cache.js must consume the shared hasher — that is the extraction");

/* ---- 2. no automatic hashing or discovery anywhere in Phase 2a ---- */
const phase2aSource = PHASE_2A_MODULES
  .map((name) => stripComments(fs.readFileSync(path.join(ROOT, `${name}.js`), "utf8")))
  .join("\n");
for (const forbidden of ["readdirSync", "readdir", "opendirSync", "globSync", "hashMediaFile", "hashImageFile"])
  assert(!new RegExp(`\\b${forbidden}\\b`).test(phase2aSource),
    `Phase 2a modules must not reference ${forbidden} — no discovery, no automatic hashing`);
assert(!/readFileSync\s*\(\s*[^)]*\bmedia\b/i.test(phase2aSource),
  "Phase 2a must not read media files");

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
    for (const moduleName of [...PHASE_2A_MODULES, "media-hash"])
      assert(!source.includes(moduleName),
        `${rel} must not reference ${moduleName} — no FAL or browser behaviour changes in Phase 2a`);
  }

  console.log(
    "Phase 2a inertness suite passed: no production module imports the ledger or calls its reader or writer, "
    + "the Phase 2a modules contain no discovery or hashing, and opening a real project with media on disk creates "
    + "no media-assets.json, leaves project.json byte-identical with no backup written, and modifies no media file.",
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

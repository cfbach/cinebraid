/* CineBraid MediaAsset boundary — the ledger is ACTIVE, through exactly one owner.
 *
 * This suite replaces tests/media-asset-inertness.js, and the reason the old one
 * existed is the reason this one has to be stronger rather than absent.
 *
 * WHAT INERTNESS GUARDED. Phase 2a/2b landed identity, the store, the indexer and
 * the verifier complete and switched off. The inertness suite proved, two ways,
 * that nothing in the running product could reach them: a source scan for imports
 * and for the bare symbols readLedger/writeLedger/writeLedgerSync/indexProject/
 * verifyAssets, and a runtime proof that opening a real project created no
 * `media-assets.json`, wrote no project.json and read no media byte. It existed
 * because indexing writes a file and verification reads bytes, and a project may
 * live in a OneDrive/Dropbox/Drive folder where reading a file downloads it — so
 * wiring either to project open by accident could pull an entire media corpus over
 * the network. Activation had to be a deliberate decision, and that suite is what
 * stopped it happening by drift.
 *
 * WHY INERTNESS IS BEING RETIRED DELIBERATELY (P4-SEM-C1). A media file's identity
 * is currently its filename, and the approval flow renames the file. Every fact
 * downstream — which file an approval approved, which candidate a review reviewed,
 * which bytes a job delivered — is keyed by a string that CineBraid itself
 * rewrites. The ledger is the fix, and a fix that cannot run is not one.
 *
 * WHAT REPLACES IT. Not "the ledger may now be called from anywhere". The
 * inertness rule was a count of ZERO production call sites; this is a count of
 * ONE. media-asset-service.js is the only production module that imports the
 * ledger or calls its reader, writer, indexer or verifier, server.js reaches it
 * only through that service, and the service is entered from exactly the three
 * points where a project becomes active or its media is re-enumerated. The
 * structural cloud-sync guarantee is unchanged and re-asserted here: the indexer
 * still imports no hasher and no read primitive, and a first pass over a project
 * with no ledger still reads zero media bytes.
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-boundary-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "boundary-project");
const TAKES = path.join(PROJECT_DIR, "shots", "S-01", "takes");
const LEDGER = path.join(PROJECT_DIR, "media-assets.json");
const SECOND_SLUG = "boundary-second";
const SECOND_DIR = path.join(PROJECTS_ROOT, SECOND_SLUG);
const SECOND_LEDGER = path.join(SECOND_DIR, "media-assets.json");

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

/* ---- 1. exactly one production module reaches the ledger ----

   The ledger modules import each other — that is the pipeline — and
   media-asset-service.js imports them because it is the owner. Everything else
   must not, because a second call site is how "one answer to when the ledger
   changes" quietly becomes several. */
const LEDGER_MODULES = ["media-assets", "media-asset-store", "media-asset-indexer", "media-asset-verify"];
const LEDGER_OWNER = "media-asset-service";
/* ofp/ was outside the old suite's scan, which is how ofp-migrate-scan.js came to
   require ../media-assets unnoticed. It borrows one pure predicate and is dead at
   runtime; it is pinned by name here so it stays that and the blind spot is
   closed rather than inherited. */
const PURE_PREDICATE_BORROWERS = new Map([["ofp/ofp-migrate-scan.js", ["media-assets"]]]);

function sourceFilesIn(dir, prefix = "") {
  return fs.readdirSync(path.join(ROOT, dir || "."))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `${prefix}${name}`);
}
const productionFiles = [
  ...sourceFilesIn("", ""),
  ...sourceFilesIn("public", "public/"),
  ...sourceFilesIn("scripts", "scripts/"),
  ...sourceFilesIn("ofp", "ofp/"),
].filter((rel) => ![...LEDGER_MODULES, LEDGER_OWNER].includes(path.basename(rel, ".js")));

const importers = [];
for (const rel of productionFiles) {
  const source = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const allowed = PURE_PREDICATE_BORROWERS.get(rel) || [];
  for (const moduleName of LEDGER_MODULES) {
    if (!new RegExp(`require\\(["'.\\/]*${moduleName}["']\\)`).test(source)) continue;
    if (allowed.includes(moduleName)) continue;
    importers.push(`${rel} -> ${moduleName}`);
  }
  /* Persistence, indexing and verification must be unreachable by name too — an
     import is not the only way to acquire a function. */
  for (const symbol of ["writeLedger", "writeLedgerSync", "readLedger", "indexProject", "verifyAssets"])
    assert(!new RegExp(`\\b${symbol}\\s*\\(`).test(source),
      `${rel} calls ${symbol}. The ledger has exactly one production caller: ${LEDGER_OWNER}.js.`);
}
assert.deepStrictEqual(importers, [],
  `only ${LEDGER_OWNER}.js may import the MediaAsset ledger; found: ${importers.join(", ")}`);

/* And the owner really is an owner: it imports all four, so the boundary is a
   funnel rather than a name nothing goes through. */
const ownerSource = fs.readFileSync(path.join(ROOT, `${LEDGER_OWNER}.js`), "utf8");
for (const moduleName of LEDGER_MODULES)
  assert(new RegExp(`require\\("\\./${moduleName}"\\)`).test(ownerSource),
    `${LEDGER_OWNER}.js must own ${moduleName} — the boundary is the module that imports them all`);

/* ---- 1b. the server enters the ledger through one function, from known places ----
   A count, not a vibe: if a fourth route starts activating the ledger this fails
   and someone has to say why in the diff. */
const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const serverNoComments = stripComments(serverSource);
assert(/require\("\.\/media-asset-service"\)/.test(serverNoComments),
  "server.js reaches the ledger through the service");
for (const moduleName of LEDGER_MODULES)
  assert(!new RegExp(`require\\(["'.\\/]*${moduleName}["']\\)`).test(serverNoComments),
    `server.js must not import ${moduleName} directly`);
assert.strictEqual((serverNoComments.match(/MediaAssetService\.activateProject\(/g) || []).length, 1,
  "server.js schedules activation from exactly one place — noteProjectActivity");
const activationCallers = [...serverNoComments.matchAll(/noteProjectActivity\("([a-z]+)"/g)].map((m) => m[1]).sort();
assert.deepStrictEqual(activationCallers, ["open", "rename", "scan", "switch"],
  "activation is entered on project open, media re-enumeration, project switch and the one route that renames media — and nowhere else");
/* The whole surface server.js is allowed to use, listed rather than counted, so a
   fifth entry point has to be argued for in a diff. */
const serviceCalls = [...new Set([...serverNoComments.matchAll(/MediaAssetService\.(\w+)\(/g)].map((m) => m[1]))].sort();
assert.deepStrictEqual(serviceCalls, ["activateProject", "anchorBeforeRename"],
  "server.js uses exactly two service entry points: schedule a pass, and anchor one file before renaming it");
assert.strictEqual((serverNoComments.match(/MediaAssetService\.anchorBeforeRename\(/g) || []).length, 1,
  "and the anchor is called from exactly one place — the media rename route");

/* ---- 2. the schema and store layers stay free of discovery and hashing ---- */
const foundationSource = ["media-assets", "media-asset-store"]
  .map((name) => stripComments(fs.readFileSync(path.join(ROOT, `${name}.js`), "utf8")))
  .join("\n");
for (const forbidden of ["readdirSync", "readdir", "opendirSync", "globSync", "hashMediaFile", "hashImageFile"])
  assert(!new RegExp(`\\b${forbidden}\\b`).test(foundationSource),
    `The schema and store layers must not reference ${forbidden} — no discovery, no hashing`);
assert(!/readFileSync\s*\(\s*[^)]*\bmedia\b/i.test(foundationSource),
  "The schema and store layers must not read media files");

/* ---- 2b. the indexer STILL cannot hash — activation did not weaken this ----
   This is the cloud-sync guarantee in structural form, and it is the single
   assertion that most needs to survive the ledger becoming reachable. */
const indexerSource = stripComments(fs.readFileSync(path.join(ROOT, "media-asset-indexer.js"), "utf8"));
for (const forbidden of ["media-hash", "hashMediaFile", "hashImageFile", "readFileSync", "createReadStream"])
  assert(!indexerSource.includes(forbidden),
    `media-asset-indexer.js references ${forbidden} — the default index must be unable to read bytes`);
const verifierSource = stripComments(fs.readFileSync(path.join(ROOT, "media-asset-verify.js"), "utf8"));
assert(/require\("\.\/media-hash"\)/.test(verifierSource),
  "media-asset-verify.js is the one module allowed to hash, and must use the shared hasher");
/* media-hash.js IS imported by continuity-cache.js, which is the point of the
   extraction. Assert it explicitly so the scan above cannot be misread. */
assert(/require\("\.\/media-hash"\)/.test(fs.readFileSync(path.join(ROOT, "continuity-cache.js"), "utf8")),
  "continuity-cache.js must consume the shared hasher — that is the extraction");

/* ---- 3. runtime proof of the NEW contract ---- */
function writeProject() {
  fs.mkdirSync(TAKES, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  for (const name of ["S-01_FRAME_A.png", "S-01_FRAME_B.png", "S-01_FRAME_C.png"])
    fs.writeFileSync(path.join(TAKES, name), PNG);
  fs.writeFileSync(path.join(PROJECT_DIR, "anchors", "CHAR-KAI.png"), PNG);
  /* Not media, and must never be indexed. */
  fs.writeFileSync(path.join(PROJECT_DIR, "docs", "notes.md"), "# notes\n");
  fs.writeFileSync(path.join(TAKES, "sidecar.txt"), "not media");
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify({
    meta: { title: "Boundary", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
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
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ activeProject: "boundary-project", assistant: { provider: "ollama", visionProvider: "ollama" } }, null, 2));
}

async function startServer() {
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
}
async function stopServer() {
  if (!child) return;
  const dead = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await dead;
  child = null;
}
/* Activation runs off the request path, so a client observes it by waiting. The
   predicate is what is being waited FOR, so a timeout names the condition that
   never held rather than just "no file". */
async function waitForLedger(deadlineMs = 10000, predicate = null, target = LEDGER) {
  const deadline = Date.now() + deadlineMs;
  let last = null;
  for (;;) {
    if (fs.existsSync(target)) {
      try {
        last = JSON.parse(fs.readFileSync(target, "utf8"));
        if (!predicate || predicate(last)) return last;
      } catch {}
    }
    if (Date.now() > deadline)
      throw new Error(`ledger condition never held for ${path.basename(path.dirname(target))}: ${JSON.stringify(last)}\n${output}`);
    /* Passes are activity-driven, so keep the product doing what it normally does
       rather than waiting for a timer that does not exist. */
    await fetch(base + "/api/scan").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

function writeSecondProject() {
  fs.mkdirSync(path.join(SECOND_DIR, "anchors"), { recursive: true });
  for (const dir of ["plates", "props", "vehicles", "audio", "media"])
    fs.mkdirSync(path.join(SECOND_DIR, dir), { recursive: true });
  fs.writeFileSync(path.join(SECOND_DIR, "anchors", "CHAR-ZED.png"), Buffer.concat([PNG, Buffer.from("zed")]));
  fs.writeFileSync(path.join(SECOND_DIR, "project.json"), JSON.stringify({
    meta: { title: "Second", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [{ id: "CHAR-ZED", name: "Zed", approvedFile: "CHAR-ZED.png", continuityStates: [{ id: "state-default", name: "Default", isDefault: true }] }],
    locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [], shots: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
}

async function main() {
  writeProject();
  const projectBytesBefore = fs.readFileSync(path.join(PROJECT_DIR, "project.json"));
  const mediaStatsBefore = fs.readdirSync(TAKES).map((name) => {
    const stat = fs.statSync(path.join(TAKES, name));
    return `${name}|${stat.mtimeMs}|${stat.size}`;
  });

  await startServer();
  for (const route of ["/api/project", "/api/projects", "/api/scan", "/api/config", "/api/docs"]) {
    const response = await fetch(base + route);
    assert(response.ok, `${route} must still answer normally (got ${response.status})`);
    await response.json().catch(() => null);
  }

  /* THE INVERSION. Opening a project now DOES produce a ledger. */
  const ledger = await waitForLedger();
  assert.strictEqual(ledger.schemaVersion, 1);
  const byPath = new Map(ledger.assets.map((asset) => [asset.storage.path, asset]));
  assert.deepStrictEqual([...byPath.keys()].sort(), [
    "anchors/CHAR-KAI.png",
    "shots/S-01/takes/S-01_FRAME_A.png",
    "shots/S-01/takes/S-01_FRAME_B.png",
    "shots/S-01/takes/S-01_FRAME_C.png",
  ], "every supported media file is indexed, and nothing else is");
  for (const [relativePath, asset] of byPath) {
    assert(/^asset-[0-9a-f]{32}$/.test(asset.assetId), `${relativePath} has a durable assetId`);
    /* The whole point: identity is complete WITHOUT having read a byte. */
    assert.strictEqual(asset.hashState, "unhashed", `${relativePath} was not hashed by a backfill`);
    assert.strictEqual(asset.contentHash, null, `${relativePath} carries no digest yet`);
  }
  assert.strictEqual(new Set([...byPath.values()].map((a) => a.assetId)).size, byPath.size,
    "identities are distinct");

  /* The ledger is the ONLY new file, and it lives beside project.json. */
  const strays = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.startsWith("media-assets") && path.dirname(full) !== PROJECT_DIR) strays.push(full);
    }
  })(PROJECTS_ROOT);
  assert.deepStrictEqual(strays, [], "the ledger belongs in the project root and nowhere else");

  /* project.json is byte-identical — the ledger is a sidecar, not a migration. */
  assert(projectBytesBefore.equals(fs.readFileSync(path.join(PROJECT_DIR, "project.json"))),
    "activation must leave project.json byte-identical");
  const backups = path.join(PROJECT_DIR, "backups");
  assert(!fs.existsSync(backups) || fs.readdirSync(backups).length === 0,
    "no project backup may be created, because no project write may happen");

  /* No media file was modified, and none grew an mtime. */
  const mediaStatsAfter = fs.readdirSync(TAKES).map((name) => {
    const stat = fs.statSync(path.join(TAKES, name));
    return `${name}|${stat.mtimeMs}|${stat.size}`;
  });
  assert.deepStrictEqual(mediaStatsAfter, mediaStatsBefore, "activation must not modify media");

  /* ---- 4. identity survives a restart, and the backlog converges by itself ----
     The fast first open leaves every row unhashed. That is a starting state, not a
     resting one: ordinary reopening is what anchors them, with no manual verify
     call, no UI and no future phase. */
  const idsAfterBackfill = Object.fromEntries(ledger.assets.map((a) => [a.storage.path, a.assetId]));
  await stopServer();
  await startServer();
  await fetch(base + "/api/project").then((r) => r.json());
  const converged = await waitForLedger(15000, (doc) =>
    doc.assets.length === 4 && doc.assets.every((a) => a.hashState === "hashed"));
  assert.deepStrictEqual(
    Object.fromEntries(converged.assets.map((a) => [a.storage.path, a.assetId])), idsAfterBackfill,
    "verification anchors bytes to the identities that already existed — it never re-mints one",
  );
  for (const asset of converged.assets)
    assert(/^sha256:[0-9a-f]{64}$/.test(asset.contentHash), `${asset.storage.path} carries a real digest`);

  /* Drained. A further restart-and-open now changes nothing at all. */
  const settledBytes = fs.readFileSync(LEDGER);
  await stopServer();
  await startServer();
  await fetch(base + "/api/project").then((r) => r.json());
  await fetch(base + "/api/scan").then((r) => r.json());
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert(settledBytes.equals(fs.readFileSync(LEDGER)),
    "reopening a converged project must not rewrite the ledger — identity does not churn");
  assert(projectBytesBefore.equals(fs.readFileSync(path.join(PROJECT_DIR, "project.json"))),
    "and must still leave project.json byte-identical");
  assert.deepStrictEqual(fs.readdirSync(TAKES).map((name) => {
    const stat = fs.statSync(path.join(TAKES, name));
    return `${name}|${stat.mtimeMs}|${stat.size}`;
  }), mediaStatsBefore, "and verification reads media without modifying any of it");

  /* ---- 5. the rename CineBraid ITSELF performs, on media it has not yet read ----
     POST /api/media/rename is the one place the product moves a media file, and
     both approval paths go through it (public/library-tools.js:333, :531). A second
     project is used because the condition being tested — a real row with no digest
     yet — exists only between a project's first index and its next pass, and the
     first project has long since converged. */
  writeSecondProject();
  const switched = await (await fetch(base + "/api/projects/switch", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: SECOND_SLUG }),
  })).json();
  assert.strictEqual(switched.ok, true, "the switch is accepted");

  const backfilled = await waitForLedger(15000, (doc) => doc.assets.length === 1, SECOND_LEDGER);
  const beforeRename = backfilled.assets[0];
  assert.strictEqual(beforeRename.hashState, "unhashed",
    "the file has a durable id and no digest yet — the exact window an approval rename can land in");
  assert.strictEqual(beforeRename.storage.path, "anchors/CHAR-ZED.png");

  const renamed = await (await fetch(base + "/api/media/rename", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ dir: "anchors", from: "CHAR-ZED.png", to: "CHAR-ZED_APPROVED" }),
  })).json();
  assert.strictEqual(renamed.name, "CHAR-ZED_APPROVED.png", "the route renames the file as usual");

  const afterRename = await waitForLedger(15000, (doc) =>
    doc.assets.some((a) => a.storage.path === "anchors/CHAR-ZED_APPROVED.png" && a.storage.missing !== true),
    SECOND_LEDGER);
  const movedRow = afterRename.assets.find(
    (a) => a.storage.path === "anchors/CHAR-ZED_APPROVED.png" && a.storage.missing !== true);
  assert.strictEqual(movedRow.assetId, beforeRename.assetId,
    "a rename the PRODUCT performed preserves assetId even though nothing had read the bytes when it started");
  assert(/^sha256:[0-9a-f]{64}$/.test(movedRow.contentHash),
    "because the route anchored the file to its bytes before moving it");
  assert.strictEqual(afterRename.assets.length, 1, "and one row survives, not two");

  /* ---- 6. FAL and the browser are untouched by this phase ---- */
  for (const rel of ["fal-generation.js", "public/fal-generation.js", "public/app.js", "public/index.html"]) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const moduleName of [...LEDGER_MODULES, LEDGER_OWNER, "media-hash"])
      assert(!source.includes(moduleName),
        `${rel} must not reference ${moduleName} — no FAL or browser behaviour changes in this phase`);
  }

  console.log(
    "MediaAsset boundary suite passed: the ledger is ACTIVE through exactly one owner — media-asset-service.js is the "
    + "only production importer and the only caller of readLedger/writeLedger/indexProject/verifyAssets; server.js uses "
    + "exactly two service entry points, schedules activation from one function entered on open, scan, switch and the "
    + "media rename route alone, and the ofp/ blind spot is now scanned with its one pure-predicate borrower pinned by "
    + "name; the indexer still imports no hasher; opening a real project mints a durable assetId for every supported "
    + "media file with ZERO media bytes read, leaves project.json byte-identical with no backup, modifies no media and "
    + "indexes nothing unsupported; ordinary reopening then anchors every one of those identities to its bytes with no "
    + "manual call, after which a further reopen rewrites nothing; and a rename performed by the product itself, on a "
    + "file whose bytes had never been read, keeps its assetId through POST /api/media/rename.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    if (output) console.error(`--- server output ---\n${output}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

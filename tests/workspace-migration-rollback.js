"use strict";

/* F-11 — WORKSPACE MIGRATION PARTIAL-FAILURE CLEANUP.
 *
 * Moving the projects root copies every project document to the new location one at
 * a time. Migration is CREATE_ONLY: it refuses rather than overwrite a destination
 * document, and it never writes to the source. Both of those were already true and
 * both must stay true.
 *
 * What was not true is that a failed attempt could be retried. A failure on the
 * fourth project left the first three standing at the destination; the next attempt
 * enumerated those leftovers and answered WORKSPACE_PROJECT_COLLISION. CineBraid was
 * refusing to move the workspace because of the copies CineBraid had just made, and
 * the only way out was deleting files by hand.
 *
 * The correction is a preflight that decides everything knowable before the first
 * destination byte exists, plus a ledger of the paths this attempt actually created
 * so a later failure can unwind exactly those and nothing else.
 *
 * Every scenario runs a REAL server against roots under os.tmpdir(). No provider is
 * configured or contacted. The whole-tree snapshots are content hashes, so "the
 * destination is unchanged" means the bytes are unchanged, not that a count matched.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const { ROOT, startCineBraidServer } = require("./fixtures/mock-civitai");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-f11-"));
const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replace(/\r\n/g, "\n");
const passed = [];

/* ==========================================================================
   FIXTURES
   ========================================================================== */

function baseProject(title) {
  return {
    meta: {
      title, format: "Test", version: "v1", hubVersion: "v6.0.0",
      schemaVersion: "6.6", aiPolicy: "project-default", world: {},
    },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [],
    audio: [], mediaAssets: [], jobs: [], agentRuns: [], decisions: [],
    sessions: [], finishJobs: [],
    scenes: [{ id: "SC-01", title: "Scene", whatHappens: "A test beat.", howItFeels: "Exact." }],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "Shot", desc: "A test shot.",
      positioning: "Locked frame.", dur: 5, workflowStatus: "DRAFT",
      characters: [], codes: [], risks: [], candidateFiles: [], creationBrief: {},
      keyframes: [{ id: "fr-a", label: "A", title: "Opening", description: "Opening frame.", generationPackages: [] }],
      clips: [],
    }],
  };
}

const toPosix = (value) => String(value).replace(/\\/g, "/");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function writeProjectAt(root, slug, project) {
  fs.mkdirSync(path.join(root, slug), { recursive: true });
  fs.writeFileSync(path.join(root, slug, "project.json"), JSON.stringify(project, null, 2) + "\n");
}
function writeFileAt(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/* Content hashes for every entry under a root, so equality is about bytes. A root
   that does not exist and a root that exists and is empty both snapshot to {} —
   applying settings creates the four configured roots whether or not a migration
   follows, and that is not what this suite is about. */
function snapshot(root) {
  const out = {};
  (function walk(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name), rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) { out[rel + "/"] = "dir"; walk(full, rel); }
      else out[rel] = sha(full);
    }
  })(root, "");
  return out;
}
const documentsAt = (root) => Object.keys(snapshot(root)).filter((rel) => rel.endsWith("/project.json") && rel.split("/").length === 2).sort();

async function withWorkspace(build, run) {
  const home = fs.mkdtempSync(path.join(TEMP, "ws-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(source, { recursive: true });
  build({ home, source, dest });
  const configPath = path.join(home, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    workspace: { projectRoot: toPosix(source) },
    activeProject: "alpha",
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: false } },
  }, null, 2));
  const server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: source,
    FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "",
  });
  const migrate = (to = dest) => server.request("/api/workspace/settings", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: { projectRoot: toPosix(to) } }),
  });
  const configuredRoot = () => path.resolve(JSON.parse(fs.readFileSync(configPath, "utf8")).workspace.projectRoot);
  try { await run({ home, source, dest, configPath, configuredRoot, server, migrate }); }
  finally { server.stop(); }
}

async function scenario(id, fn) {
  await fn();
  passed.push(id);
  console.log(`  ok  ${id}`);
}

/* The shipped ledger, evaluated from the shipped source in its own realm. The slice
   runs from the containment predicate to the workspace status reader, so what is
   under test is the code server.js runs and not a restatement of it. */
function shippedMigrationHelpers(source = SERVER_SOURCE) {
  const start = source.indexOf("function insideDirectory(");
  const end = source.indexOf("function workspaceStatus(");
  assert(start > 0 && end > start, "the F-11 migration helpers must be locatable in server.js");
  const sandbox = { require, module: { exports: {} }, console, fs, path, exports: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(start, end) +
    "\nmodule.exports = { insideDirectory, createdPathLedger, preflightWorkspaceMigration, workspaceMigrationRefusal, workspaceMigrationFailure };",
    sandbox, { filename: "server.js#f11-migration-helpers" },
  );
  return sandbox.module.exports;
}

/* ==========================================================================
   F11-1 .. F11-8
   ========================================================================== */

async function f11_1() {
  await withWorkspace(({ source }) => {
    writeProjectAt(source, "alpha", baseProject("Alpha"));
    writeFileAt(path.join(source, "beta", "project.json"), "{ not json");
  }, async ({ source, dest, configuredRoot, migrate }) => {
    const beforeSource = snapshot(source), beforeDest = snapshot(dest);
    const result = await migrate();

    assert.strictEqual(result.status, 422, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "WORKSPACE_MIGRATION_PREFLIGHT_FAILED");
    const problem = (result.body.problems || []).find((row) => row.slug === "beta");
    assert(problem, "the refusal must name the project that cannot be migrated");
    assert.strictEqual(problem.reason, "SOURCE_UNREADABLE");

    /* Nothing was created, so there is nothing to unwind and nothing claiming there
       was: a preflight refusal must not report a rollback it never performed. */
    assert.strictEqual(result.body.migration, undefined, "a preflight refusal performs no cleanup");
    assert.deepStrictEqual(snapshot(dest), beforeDest, "the destination must be untouched");
    assert.deepStrictEqual(fs.readdirSync(dest), [], "no destination project artifact may exist");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched");
    assert.strictEqual(configuredRoot(), path.resolve(source), "a refusal must not switch the workspace root");
  });
}

async function f11_2() {
  await withWorkspace(({ source, dest }) => {
    for (const slug of ["alpha", "beta", "gamma"]) writeProjectAt(source, slug, baseProject(slug));
    /* A plain file where the second project's folder has to go. There is no
       destination project document, so this is not a collision and preflight cannot
       know about it; the write discovers it, by which time alpha is already copied. */
    writeFileAt(path.join(dest, "beta"), "occupied by something else");
  }, async ({ source, dest, configuredRoot, migrate }) => {
    const beforeSource = snapshot(source), beforeDest = snapshot(dest);
    const result = await migrate();

    assert.strictEqual(result.status, 500, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "PROJECT_PERSISTENCE_FAILED");
    assert.strictEqual(result.body.slug, "beta", "the failure must name the project it failed on");
    assert.strictEqual(result.body.ok, false);

    const rollback = result.body.migration.rollback;
    assert.strictEqual(rollback.complete, true, JSON.stringify(rollback));
    assert(rollback.removed >= 2, `alpha's document and its folder must both be unwound, got ${rollback.removed}`);
    assert.strictEqual(result.body.migration.movedRoot, false, "a failed migration never reports a move");

    assert.strictEqual(fs.existsSync(path.join(dest, "alpha", "project.json")), false,
      "the document this attempt created must not survive the failure");
    assert.deepStrictEqual(snapshot(dest), beforeDest, "the destination must equal its pre-attempt state");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched");
    assert.strictEqual(configuredRoot(), path.resolve(source));

    /* The point of the whole slice: the second attempt meets the same external
       problem, and NOT a collision with the first attempt's own copies. */
    const retry = await migrate();
    assert.notStrictEqual(retry.body.code, "WORKSPACE_PROJECT_COLLISION",
      "a retry must never collide with the previous attempt's leftovers");
    assert.strictEqual(retry.body.collisions, undefined);
    assert.strictEqual(retry.status, 500, "the retry reports the unchanged external cause");
  });
}

async function f11_3() {
  await withWorkspace(({ source, dest }) => {
    for (const slug of ["alpha", "beta", "gamma"]) {
      writeProjectAt(source, slug, baseProject(slug));
      writeFileAt(path.join(source, slug, "media", "frame.bin"), `${slug}-frame-bytes`);
      writeFileAt(path.join(source, slug, "media", "deep", "take.bin"), `${slug}-take-bytes`);
    }
    /* Sorts last, so every project document and every copied file exists by the time
       the tree copy walks into it and finds a file where a folder must go. */
    writeFileAt(path.join(source, "zz-shared", "note.txt"), "shared");
    writeFileAt(path.join(dest, "zz-shared"), "occupied by something else");
  }, async ({ source, dest, migrate }) => {
    const beforeSource = snapshot(source), beforeDest = snapshot(dest);
    const result = await migrate();

    assert.strictEqual(result.status, 400, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "WORKSPACE_MIGRATION_FAILED");
    const rollback = result.body.migration.rollback;
    assert.strictEqual(rollback.complete, true, JSON.stringify(rollback));
    /* 3 documents + 3 project folders + 3 media folders + 3 deep folders
       + 3 frame files + 3 take files. */
    assert(rollback.removed >= 18, `every attempt-owned artifact must be unwound, got ${rollback.removed}`);
    assert.deepStrictEqual(rollback.leftover, []);

    /* Byte-for-byte equality with the pre-attempt destination is also the proof that
       cleanup ran in reverse: a folder still holding this attempt's files could not
       have been removed, because folders are only ever removed non-recursively. */
    assert.deepStrictEqual(snapshot(dest), beforeDest, "the destination must equal its pre-attempt state");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched");

    const retry = await migrate();
    assert.notStrictEqual(retry.body.code, "WORKSPACE_PROJECT_COLLISION",
      "a retry must never collide with the previous attempt's leftovers");
  });
}

async function f11_4() {
  await withWorkspace(({ source, dest }) => {
    writeProjectAt(source, "alpha", baseProject("Source Alpha"));
    writeProjectAt(source, "beta", baseProject("Source Beta"));
    writeProjectAt(dest, "alpha", baseProject("Somebody Else's Alpha"));
  }, async ({ source, dest, configuredRoot, migrate }) => {
    const beforeSource = snapshot(source), beforeDest = snapshot(dest);
    const collidingBytes = sha(path.join(dest, "alpha", "project.json"));
    const result = await migrate();

    assert.strictEqual(result.status, 409, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "WORKSPACE_PROJECT_COLLISION");
    assert(result.body.collisions.includes("alpha"));

    /* A refusal is not a failed attempt: nothing was created, so cleanup has no
       business running, and above all the pre-existing document is not ours. */
    assert.strictEqual(result.body.migration, undefined, "a collision refusal performs no cleanup");
    assert.strictEqual(sha(path.join(dest, "alpha", "project.json")), collidingBytes,
      "a pre-existing destination document must remain byte-identical");
    assert.deepStrictEqual(snapshot(dest), beforeDest, "the destination must be untouched");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched");
    assert.strictEqual(configuredRoot(), path.resolve(source), "a collision must not switch the workspace root");
  });
}

async function f11_5() {
  await withWorkspace(({ source, dest }) => {
    writeProjectAt(source, "alpha", baseProject("Alpha"));
    writeFileAt(path.join(source, "alpha", "media", "frame.bin"), "alpha-frame-bytes");
    writeProjectAt(source, "beta", baseProject("Beta"));
    writeFileAt(path.join(source, "zz-shared", "note.txt"), "shared");

    /* Unrelated material already at the destination, plus — the sharp case — a folder
       that carries the same name as a project being migrated. It holds no project
       document, so it is not a collision and migration proceeds into it. */
    writeFileAt(path.join(dest, "keep", "notes.txt"), "notes that predate the migration");
    writeFileAt(path.join(dest, "alpha", "legacy.bin"), "bytes that predate the migration");
    writeFileAt(path.join(dest, "zz-shared"), "occupied by something else");
  }, async ({ source, dest, migrate }) => {
    const beforeSource = snapshot(source), beforeDest = snapshot(dest);
    const legacyBytes = sha(path.join(dest, "alpha", "legacy.bin"));
    const notesBytes = sha(path.join(dest, "keep", "notes.txt"));
    const result = await migrate();

    assert.strictEqual(result.status, 400, JSON.stringify(result.body));
    assert.strictEqual(result.body.migration.rollback.complete, true, JSON.stringify(result.body.migration.rollback));

    /* Removed: only what this attempt made. */
    assert.strictEqual(fs.existsSync(path.join(dest, "alpha", "project.json")), false, "the copied document goes");
    assert.strictEqual(fs.existsSync(path.join(dest, "alpha", "media")), false, "the copied media folder goes");
    assert.strictEqual(fs.existsSync(path.join(dest, "beta")), false, "the whole folder this attempt created goes");

    /* Kept: everything that was there first — including the folder the migration
       wrote into, which it found rather than made. */
    assert.strictEqual(fs.existsSync(path.join(dest, "alpha")), true, "a pre-existing folder is never removed");
    assert.strictEqual(sha(path.join(dest, "alpha", "legacy.bin")), legacyBytes, "pre-existing bytes are untouched");
    assert.strictEqual(sha(path.join(dest, "keep", "notes.txt")), notesBytes, "unrelated material is untouched");

    assert.deepStrictEqual(snapshot(dest), beforeDest, "the destination must equal its pre-attempt state");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched");
  });
}

async function f11_6() {
  /* A clean migration of an identical source, to compare against. */
  const control = {};
  await withWorkspace(({ source }) => {
    for (const slug of ["alpha", "beta", "gamma"]) writeProjectAt(source, slug, baseProject(slug));
  }, async ({ dest, migrate }) => {
    const result = await migrate();
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
    for (const slug of ["alpha", "beta", "gamma"]) control[slug] = sha(path.join(dest, slug, "project.json"));
  });

  await withWorkspace(({ source, dest }) => {
    for (const slug of ["alpha", "beta", "gamma"]) writeProjectAt(source, slug, baseProject(slug));
    writeFileAt(path.join(dest, "beta"), "a transient obstruction");
  }, async ({ source, dest, configuredRoot, migrate }) => {
    const beforeSource = snapshot(source);
    const first = await migrate();
    assert.strictEqual(first.status, 500, JSON.stringify(first.body));
    assert.strictEqual(first.body.migration.rollback.complete, true);

    /* The external cause is corrected; nothing else is cleaned up by hand. */
    fs.unlinkSync(path.join(dest, "beta"));

    const second = await migrate();
    assert.strictEqual(second.status, 200, JSON.stringify(second.body));
    assert.notStrictEqual(second.body.code, "WORKSPACE_PROJECT_COLLISION");
    assert.strictEqual(second.body.migration.movedRoot, true);
    assert.strictEqual(second.body.migration.projectDocuments, 3);
    assert.strictEqual(configuredRoot(), path.resolve(dest), "a successful migration switches the workspace root");

    for (const slug of ["alpha", "beta", "gamma"])
      assert.strictEqual(sha(path.join(dest, slug, "project.json")), control[slug],
        `${slug} after rollback-and-retry must be byte-identical to a clean first attempt`);
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched by either attempt");
  });
}

function f11_7() {
  const { createdPathLedger, workspaceMigrationFailure } = shippedMigrationHelpers();
  const home = fs.mkdtempSync(path.join(TEMP, "cleanup-fails-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(source, { recursive: true });
  const slugDirectory = path.join(dest, "alpha");
  const document = path.join(slugDirectory, "project.json");
  const mediaDirectory = path.join(slugDirectory, "media");
  const copied = path.join(mediaDirectory, "frame.bin");

  fs.mkdirSync(mediaDirectory, { recursive: true });
  fs.writeFileSync(document, "{}");
  fs.writeFileSync(copied, "frame");

  const ledger = createdPathLedger({ destinationRoot: dest, sourceRoot: source });
  ledger.directory(slugDirectory);
  ledger.file(document);
  ledger.directory(mediaDirectory);
  ledger.file(copied);

  /* Something outside this migration writes into a folder the migration made — a
     sync client, a scanner, another window. Cleanup can no longer empty the folder,
     and the question is what it does about that. */
  const foreign = path.join(mediaDirectory, "arrived-from-elsewhere.bin");
  fs.writeFileSync(foreign, "bytes this migration did not create");
  const foreignBytes = sha(foreign);

  const rollback = ledger.unwind();
  assert.strictEqual(rollback.complete, false, "an obstructed cleanup must not report itself complete");
  assert(rollback.leftover.includes(mediaDirectory), "the leftover path must be identified: " + JSON.stringify(rollback.leftover));
  assert(rollback.errors.some((row) => row.code === "ENOTEMPTY"), JSON.stringify(rollback.errors));

  /* The obstruction is never forced. Folders are removed with rmdir, never a
     recursive remove, so a folder holding something this attempt did not create
     survives with its contents. */
  assert.strictEqual(fs.existsSync(foreign), true, "material this attempt did not create is never deleted");
  assert.strictEqual(sha(foreign), foreignBytes, "and it is not modified either");
  assert.strictEqual(fs.existsSync(copied), false, "what cleanup could reach is still cleaned up");
  assert.strictEqual(fs.existsSync(document), false);
  assert.strictEqual(fs.existsSync(source), true, "cleanup never touches the source");

  /* And the report keeps the original failure while naming what is still there. */
  let sent = null;
  const res = { status(code) { sent = { status: code }; return this; }, json(body) { sent.body = body; return sent; } };
  workspaceMigrationFailure(res, Object.assign(new Error("Project persistence failed."), {
    workspaceMigration: { status: 500, code: "PROJECT_PERSISTENCE_FAILED", message: "Project persistence failed.", slug: "beta" },
  }), rollback);

  assert.strictEqual(sent.status, 500, "the original failure's status survives cleanup");
  assert.strictEqual(sent.body.code, "PROJECT_PERSISTENCE_FAILED", "and so does its code");
  assert.strictEqual(sent.body.message, "Project persistence failed.", "the original message is still readable");
  assert.strictEqual(sent.body.ok, false, "a failed cleanup never upgrades the result");
  assert.strictEqual(sent.body.cleanupIncomplete, true);
  assert.strictEqual(sent.body.migration.movedRoot, false, "nothing may describe this as a workspace that moved");
  assert.deepStrictEqual(sent.body.migration.rollback.leftover, rollback.leftover);
  assert(/did not finish/.test(sent.body.error), "the reported error must say cleanup did not finish: " + sent.body.error);

  /* A complete cleanup says nothing of the kind, so the two are distinguishable. */
  let clean = null;
  const cleanRes = { status(code) { clean = { status: code }; return this; }, json(body) { clean.body = body; return clean; } };
  workspaceMigrationFailure(cleanRes, Object.assign(new Error("Project persistence failed."), {
    workspaceMigration: { status: 500, code: "PROJECT_PERSISTENCE_FAILED", message: "Project persistence failed." },
  }), { attempted: true, complete: true, removed: 4, leftover: [], errors: [] });
  assert.strictEqual(clean.body.cleanupIncomplete, undefined);
  assert.strictEqual(clean.body.error, "Project persistence failed.");
}

async function f11_8() {
  await withWorkspace(({ source }) => {
    writeProjectAt(source, "alpha", baseProject("Alpha"));
    writeFileAt(path.join(source, "alpha", "media", "frame.bin"), "alpha-frame-bytes");
    writeProjectAt(source, "beta", baseProject("Beta"));
    /* E-08's shape: a nested project.json that the tree copy must keep skipping. */
    writeFileAt(path.join(source, "alpha", "docs", "nested", "project.json"), '{"must":"not-copy"}');
  }, async ({ source, dest, configuredRoot, migrate, server }) => {
    const beforeSource = snapshot(source);
    const result = await migrate();

    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.migration.movedRoot, true);
    assert.strictEqual(result.body.migration.projectDocuments, 2);
    assert.strictEqual(result.body.migration.from, source);
    assert.strictEqual(result.body.migration.to, dest);
    assert(result.body.migration.copied >= 1, "the tree copy still reports what it copied");
    assert.strictEqual(result.body.migration.rollback, undefined, "a successful migration performs no cleanup");
    assert.strictEqual(path.resolve(result.body.projectRoot), path.resolve(dest));
    assert.strictEqual(result.body.projectRootExists, true);
    assert.strictEqual(configuredRoot(), path.resolve(dest));

    assert.deepStrictEqual(documentsAt(dest), ["alpha/project.json", "beta/project.json"]);
    assert.strictEqual(sha(path.join(dest, "alpha", "media", "frame.bin")), sha(path.join(source, "alpha", "media", "frame.bin")),
      "copied media must be byte-identical");
    assert.deepStrictEqual(snapshot(source), beforeSource, "a successful migration still leaves the source alone");

    /* Untouched by F-11 and asserted here so the ledger work cannot quietly change it:
       copyMissingTree skips project.json at any depth. That the nested document does
       not arrive is a separate, still-open finding about archived and trashed
       projects — see the residual note in this slice's report. */
    assert.strictEqual(fs.existsSync(path.join(dest, "alpha", "docs", "nested", "project.json")), false,
      "the tree copy must still skip project.json at depth");

    /* CREATE_ONLY end to end: a third root already holding one of these documents is
       still refused, and refused before anything is written. */
    const occupied = path.join(path.dirname(dest), "occupied");
    writeProjectAt(occupied, "alpha", baseProject("Already There"));
    const guardBytes = sha(path.join(occupied, "alpha", "project.json"));
    const refused = await server.request("/api/workspace/settings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: { projectRoot: toPosix(occupied) } }),
    });
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.code, "WORKSPACE_PROJECT_COLLISION");
    assert.strictEqual(sha(path.join(occupied, "alpha", "project.json")), guardBytes);
    assert.strictEqual(fs.existsSync(path.join(occupied, "beta", "project.json")), false,
      "a refused migration writes nothing at all");
    assert.strictEqual(configuredRoot(), path.resolve(dest), "and it leaves the workspace where it was");
  });
}

/* ==========================================================================
   SOURCE-LEVEL SAFETY. Five properties that have to hold by construction, not
   because a scenario happened not to trip them.
   ========================================================================== */

function safetyChecks() {
  const { createdPathLedger } = shippedMigrationHelpers();
  const home = fs.mkdtempSync(path.join(TEMP, "safety-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });

  /* Comments are stripped first. Every property below is a claim about CODE, and
     this block is heavily commented about exactly the words being searched for —
     "recursive", "own", "ledger" — so prose must not be able to satisfy or break it. */
  const codeOnly = (text) => String(text).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const routeStart = SERVER_SOURCE.indexOf('app.post("/api/workspace/settings"');
  const routeEnd = SERVER_SOURCE.indexOf('app.post("/api/assistant/test"', routeStart);
  assert(routeStart > 0 && routeEnd > routeStart, "the workspace settings route must be locatable");
  const route = codeOnly(SERVER_SOURCE.slice(routeStart, routeEnd));
  const ledgerStart = SERVER_SOURCE.indexOf("function createdPathLedger(");
  const ledgerEnd = SERVER_SOURCE.indexOf("function preflightWorkspaceMigration(");
  assert(ledgerStart > 0 && ledgerEnd > ledgerStart, "the ledger must be locatable in server.js");
  const ledgerSource = codeOnly(SERVER_SOURCE.slice(ledgerStart, ledgerEnd));
  const preflightSource = codeOnly(SERVER_SOURCE.slice(ledgerEnd, SERVER_SOURCE.indexOf("function workspaceMigrationRefusal(")));
  const occurrences = (text, needle) => text.split(needle).length - 1;

  /* S1 — every deletion is a ledger entry. The only removal calls in the ledger take
     `target`, which is only ever read out of `entries`. */
  const removals = ledgerSource.match(/fs\.(unlink|rmdir|rm|rmSync|unlinkSync|rmdirSync)[A-Za-z]*\([^)]*\)/g) || [];
  assert.deepStrictEqual(removals, ["fs.unlinkSync(target)", "fs.rmdirSync(target)"],
    "cleanup may delete nothing but a ledger entry: " + JSON.stringify(removals));
  assert.strictEqual(occurrences(ledgerSource, "entries[index]"), 1,
    "the deleted path must come from the ledger's own entry list");
  assert.strictEqual(occurrences(ledgerSource, "recursive"), 0,
    "cleanup must never remove a folder recursively");

  /* S2 — no cleanup path can point outside the destination migration root. */
  assert.throws(() => createdPathLedger({ destinationRoot: dest, sourceRoot: source }).file(path.join(home, "outside.bin")),
    /does not own/, "a path outside the destination must be refused");
  assert.throws(() => createdPathLedger({ destinationRoot: dest, sourceRoot: source }).directory(dest),
    /does not own/, "the destination root itself must be refused");
  assert.throws(() => createdPathLedger({ destinationRoot: dest, sourceRoot: source }).file(path.join(dest, "..", "escape.bin")),
    /does not own/, "a traversal out of the destination must be refused");

  /* S3 — no source path can enter the ledger. */
  assert.throws(() => createdPathLedger({ destinationRoot: dest, sourceRoot: source }).file(path.join(source, "alpha", "project.json")),
    /does not own/, "a source document must be refused");
  assert.throws(() => createdPathLedger({ destinationRoot: dest, sourceRoot: source }).directory(source),
    /does not own/, "the source root must be refused");
  /* And when the destination is nested inside the source, so that containment alone
     would not have caught it, the route refuses before a ledger even exists. */
  const nested = createdPathLedger({ destinationRoot: path.join(source, "inner"), sourceRoot: source });
  assert.throws(() => nested.file(path.join(source, "inner", "alpha", "project.json")), /does not own/);
  assert(preflightSource.includes("WORKSPACE_MIGRATION_NESTED_ROOT"),
    "a destination inside the source must be refused by preflight, before any ledger exists");

  /* S4 — a pre-existing destination artifact can never be entered. Ownership is read
     from the filesystem immediately before the write, never assumed. */
  assert.strictEqual(occurrences(route, "!fileExisted && fs.existsSync(item.destinationFile)"), 1,
    "the document may only be owned when it was proven absent first");
  assert.strictEqual(occurrences(route, "!directoryExisted && fs.existsSync(slugDirectory)"), 1,
    "the folder may only be owned when it was proven absent first");
  assert.strictEqual(occurrences(SERVER_SOURCE, "if (ledger && !destinationExisted) ledger.directory(destination);"), 1,
    "the tree copy may only own a folder it created");
  assert.strictEqual(occurrences(SERVER_SOURCE, "fs.copyFileSync(src, dest); if (ledger) ledger.file(dest); copied += 1;"), 1,
    "the tree copy may only own a file it copied into a path that did not exist");

  /* S5 — every failure terminal after the first creation unwinds. Once the ledger
     exists there is exactly one way out of the route, and it is the one that cleans
     up: no early `return res.` stands between the ledger and the success response. */
  const armed = route.slice(route.indexOf("ledger = createdPathLedger("), route.indexOf("res.json({ ok: true"));
  assert.strictEqual(occurrences(armed, "return res."), 0,
    "no failure may return from the route while the ledger is armed: " + armed);
  assert.strictEqual(occurrences(route, "if (ledger) return workspaceMigrationFailure(res, error, ledger.unwind());"), 1,
    "the single armed failure terminal must unwind");
  assert.strictEqual(occurrences(route, "let ledger = null;"), 1, "the ledger starts disarmed");
  assert.strictEqual(occurrences(route, "ledger = null;"), 2,
    "the ledger is disarmed exactly once after it is armed");
  assert(route.lastIndexOf("ledger = null;") > route.indexOf("writeConfig(nextConfig);"),
    "the ledger must still be armed while the settings write and the status read can throw");
}

/* ==========================================================================
   RUN
   ========================================================================== */

(async () => {
  console.log("F-11 workspace migration partial-failure cleanup\n");
  await scenario("F11-1  failure before any destination artifact", f11_1);
  await scenario("F11-2  failure after the first created artifact", f11_2);
  await scenario("F11-3  failure after many created artifacts", f11_3);
  await scenario("F11-4  genuine pre-existing destination collision", f11_4);
  await scenario("F11-5  attempt-owned removed, pre-existing kept", f11_5);
  await scenario("F11-6  retry after the transient cause is corrected", f11_6);
  await scenario("F11-7  cleanup itself fails", async () => f11_7());
  await scenario("F11-8  success path", f11_8);
  await scenario("F11-S  source-level safety properties", async () => safetyChecks());

  /* The exact set, so a scenario that quietly stopped running cannot pass as a
     smaller green suite. */
  assert.deepStrictEqual(passed.map((line) => line.slice(0, 5)),
    ["F11-1", "F11-2", "F11-3", "F11-4", "F11-5", "F11-6", "F11-7", "F11-8", "F11-S"]);
  console.log(`\nF-11 workspace migration cleanup: ${passed.length}/9 scenarios passed; provider calls: 0.`);
  fs.rmSync(TEMP, { recursive: true, force: true });
})().catch((error) => {
  console.error("\nF-11 FAILED\n", error);
  process.exit(1);
});

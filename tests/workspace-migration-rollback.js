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
const { execSync } = require("child_process");
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
      /* lstat, never stat: a reparse point is recorded as the link it is, with the
         target it names. Following one would hash somebody else's bytes and call
         the destination unchanged when it was not — and would crash outright on a
         dangling junction, which several of these fixtures deliberately plant. */
      if (fs.lstatSync(full).isSymbolicLink()) { out[rel] = "link:" + fs.readlinkSync(full); continue; }
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
/* The lexical test the shipped code uses for tidying, borrowed here only to prove a
   fixture really is string-wise inside the destination before asserting it is
   refused on physical grounds. */
function insideDirectoryOf(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(rel) && !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep);
}
/* Real paths come back from `realpathSync.native` in the filesystem's own casing,
   which on Windows need not match the casing a fixture happened to build. */
function samePath(left, right) {
  const normalise = (value) => (process.platform === "win32"
    ? path.resolve(String(value)).toLowerCase() : path.resolve(String(value)));
  return normalise(left) === normalise(right);
}
/* THE CANONICAL SPELLING OF A PATH THE LEDGER WOULD RECORD: realDirectory() of the
   parent plus the leaf, which is exactly how createdPathLedger builds realPath. Where
   TEMP sits under an account folder Windows also exposes by an 8.3 alias, a receipt
   that is correct still spells the file differently from the fixture that made it, and
   comparing the two as strings fails. This canonicalises the EXPECTED side only:
   samePath stays exactly as strict as it was, and no assertion drops to a lexical
   match. */
function realExpected(target) {
  return path.join(fs.realpathSync.native(path.dirname(target)), path.basename(target));
}

function shippedMigrationHelpers(source = SERVER_SOURCE) {
  const start = source.indexOf("function insideDirectory(");
  const end = source.indexOf("function workspaceStatus(");
  assert(start > 0 && end > start, "the F-11 migration helpers must be locatable in server.js");
  const sandbox = { require, module: { exports: {} }, console, fs, path, process, exports: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(start, end) +
    "\nmodule.exports = { insideDirectory, insideRealDirectory, sameRealPath, destinationChild,"
    + " createdPathLedger, claimDirectory, claimCopiedFile, preflightWorkspaceMigration,"
    + " workspaceMigrationRefusal, workspaceMigrationFailure };",
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

/* An obstruction preflight genuinely cannot see, which is what a B-class failure
   needs. `fs.existsSync` follows reparse points, so a dangling junction at a
   document path reads as ABSENT — no collision, nothing to refuse — and only the
   write itself discovers that something is there. It is also the deterministic
   stand-in for the race: an object present at the creation operation that was not
   visible to any check before it. */
function blockDocumentInvisibly(dest, slug) {
  fs.mkdirSync(path.join(dest, slug), { recursive: true });
  fs.symlinkSync(path.join(dest, slug, "no-such-target"), path.join(dest, slug, "project.json"), "junction");
}

async function f11_2() {
  await withWorkspace(({ source, dest }) => {
    for (const slug of ["alpha", "beta", "gamma"]) writeProjectAt(source, slug, baseProject(slug));
    blockDocumentInvisibly(dest, "beta");
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
    blockDocumentInvisibly(dest, "beta");
  }, async ({ source, dest, configuredRoot, migrate }) => {
    const beforeSource = snapshot(source);
    const first = await migrate();
    assert.strictEqual(first.status, 500, JSON.stringify(first.body));
    assert.strictEqual(first.body.migration.rollback.complete, true);

    /* The external cause is corrected; nothing else is cleaned up by hand. The
       folder the obstruction sat in was NOT this attempt's, so it is still here —
       which is exactly why the retry must not treat it as a collision. */
    fs.unlinkSync(path.join(dest, "beta", "project.json"));

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

  const ledger = createdPathLedger({ realDestinationRoot: fs.realpathSync.native(dest), realSourceRoot: fs.realpathSync.native(source) });
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
   OWNERSHIP AND PHYSICAL CONTAINMENT.

   The four below exist because the first version of this slice got ownership
   wrong in two ways: it inferred creation from "absent before, present after",
   which another process can walk into, and it decided containment on strings,
   which a junction can make lie.
   ========================================================================== */

/* RACE-1 — the artifact is there when the creation operation runs, and no check
   before it could have seen it. That is what losing the race looks like from the
   inside, and the requirement is that the migration notices rather than adopting
   whatever it finds. */
async function race1() {
  await withWorkspace(({ source, dest }) => {
    for (const slug of ["alpha", "beta", "gamma"]) writeProjectAt(source, slug, baseProject(slug));
    blockDocumentInvisibly(dest, "beta");
  }, async ({ source, dest, migrate }) => {
    const foreign = path.join(dest, "beta", "project.json");
    assert.strictEqual(fs.existsSync(foreign), false, "the fixture must be invisible to a stat-based check");
    assert.strictEqual(fs.lstatSync(foreign).isSymbolicLink(), true, "…while genuinely being there");
    const foreignTarget = fs.readlinkSync(foreign);
    const beforeSource = snapshot(source), beforeDest = snapshot(dest);

    const result = await migrate();
    assert.strictEqual(result.ok, false, "the migration must remain failed");
    assert.strictEqual(result.body.code, "PROJECT_PERSISTENCE_FAILED", JSON.stringify(result.body));
    assert.strictEqual(result.body.slug, "beta");

    /* Never adopted. The rollback that follows removes alpha's artifacts and stops
       there — the object it did not create is not in the receipt list at all. */
    const rollback = result.body.migration.rollback;
    assert.strictEqual(rollback.complete, true, JSON.stringify(rollback));
    assert.strictEqual(rollback.leftover.length, 0);
    assert.strictEqual(fs.lstatSync(foreign).isSymbolicLink(), true, "the foreign object must survive cleanup");
    assert.strictEqual(fs.readlinkSync(foreign), foreignTarget, "unchanged, not merely present");
    assert.strictEqual(fs.existsSync(path.join(dest, "alpha", "project.json")), false, "this attempt's own copy still goes");

    assert.deepStrictEqual(snapshot(dest), beforeDest, "the destination must equal its pre-attempt state");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched");

    /* And the retry reports the real external cause rather than a collision with
       the migration's own leftovers, because there are none. */
    const retry = await migrate();
    assert.notStrictEqual(retry.body.code, "WORKSPACE_PROJECT_COLLISION");
    assert.strictEqual(retry.body.code, "PROJECT_PERSISTENCE_FAILED");
  });
}

/* RACE-1b — the interleave itself, driven directly. The shipped claim primitives
   are the whole ownership answer, so this pins what they say when another actor
   got there first: not ours, and therefore never deleted. */
function race1Interleaved() {
  const { claimDirectory, claimCopiedFile } = shippedMigrationHelpers();
  const home = fs.mkdtempSync(path.join(TEMP, "interleave-"));
  fs.mkdirSync(home, { recursive: true });

  const folder = path.join(home, "folder");
  assert.strictEqual(claimDirectory(folder).created, true, "an absent folder is created by this call");
  assert.strictEqual(claimDirectory(folder).created, false,
    "a folder that already exists was NOT created by this call, however it got there");

  const source = path.join(home, "src.bin"); fs.writeFileSync(source, "ours");
  const target = path.join(home, "target.bin");
  assert.strictEqual(claimCopiedFile(source, target).created, true, "an absent file is created by this call");
  fs.writeFileSync(target, "another actor's bytes");
  const foreignBytes = sha(target);
  assert.strictEqual(claimCopiedFile(source, target).created, false,
    "a file another actor put there was NOT created by this call");
  assert.strictEqual(sha(target), foreignBytes,
    "and the refusal is a refusal: the exclusive copy never overwrote it");
}

/* The independently-reported hold, end to end over HTTP. */
async function junctionIntoSource() {
  await withWorkspace(({ source, dest }) => {
    writeProjectAt(source, "alpha", baseProject("Alpha"));
    fs.mkdirSync(path.join(source, "sink"), { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.symlinkSync(path.join(source, "sink"), path.join(dest, "alpha"), "junction");
  }, async ({ source, dest, configuredRoot, migrate }) => {
    const sink = path.join(source, "sink");
    const beforeSource = snapshot(source);
    /* The fixture is lexically beyond reproach — every string test passes. */
    assert.strictEqual(insideDirectoryOf(dest, path.join(dest, "alpha", "project.json")), true);

    const result = await migrate();
    assert.strictEqual(result.status, 409, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "WORKSPACE_MIGRATION_DESTINATION_REDIRECTED");
    assert.strictEqual((result.body.problems || [])[0].slug, "alpha");
    assert.strictEqual((result.body.problems || [])[0].reason, "REDIRECTED");

    assert.strictEqual(fs.existsSync(path.join(sink, "project.json")), false,
      "nothing may be written through the junction into the source workspace");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be byte-identical");
    assert.strictEqual(result.body.ok, false);
    assert.strictEqual(result.body.migration, undefined, "no move, and no cleanup to report");
    assert.strictEqual(configuredRoot(), path.resolve(source), "the workspace stays where it was");
  });
}

async function junctionOutsideDestination() {
  await withWorkspace(({ home, source, dest }) => {
    writeProjectAt(source, "alpha", baseProject("Alpha"));
    const outside = path.join(home, "unrelated");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "precious.bin"), "material outside both roots");
    fs.mkdirSync(dest, { recursive: true });
    fs.symlinkSync(outside, path.join(dest, "alpha"), "junction");
  }, async ({ home, source, dest, migrate }) => {
    const outside = path.join(home, "unrelated");
    const beforeOutside = snapshot(outside), beforeSource = snapshot(source);

    const result = await migrate();
    assert.strictEqual(result.status, 409, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "WORKSPACE_MIGRATION_DESTINATION_REDIRECTED");
    assert.strictEqual(fs.existsSync(path.join(outside, "project.json")), false,
      "nothing may be written outside the real destination root");
    assert.deepStrictEqual(snapshot(outside), beforeOutside, "unrelated storage must be byte-identical");
    assert.deepStrictEqual(snapshot(source), beforeSource);
    assert.strictEqual(result.body.migration, undefined, "nothing was created, so nothing entered a ledger");
  });
}

/* The 8.3 alias Windows keeps for a long name, or "" when the volume issues none.
   `for %I in (path) do @echo %~sI` is the only way to read it without a native call. */
function shortPathOf(target) {
  try {
    return String(execSync(`for %I in ("${target}") do @echo %~fsI`, { encoding: "utf8", windowsHide: true })).trim();
  } catch {
    return "";
  }
}

/* TWO SPELLINGS, ONE LOCATION. GitHub's Windows runners hand a test a TEMP whose
   account folder is spelled by its 8.3 alias, RUNNER~1, while its realpath carries the
   long name, runneradmin. The containment predicate resolved the
   destination root but compared the candidate lexically, so on that machine every
   legitimate creation under TEMP read as an escape: F11-7 failed on the first public
   run while passing on any machine whose TEMP is already long.

   Both halves are asserted together, because the correction is only right if the
   boundary did not move. The alias is admitted, AND a destination genuinely
   redirected out of the workspace is still refused when it is reached through that
   same alias — so this cannot pass by making the predicate permissive. */
function shortNameAliasIsOneLocation() {
  if (process.platform !== "win32") {
    console.log("      (skipped: 8.3 aliases are a Windows filesystem feature)");
    return;
  }
  const { createdPathLedger } = shippedMigrationHelpers();
  /* Names long enough to earn an alias of their own; TEMP itself may already be short. */
  const home = fs.mkdtempSync(path.join(TEMP, "alias-"));
  const source = path.join(home, "source-workspace");
  const dest = path.join(home, "destination-workspace");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });

  const shortDest = shortPathOf(dest);
  if (!shortDest || shortDest.toLowerCase() === dest.toLowerCase()) {
    console.log("      (skipped: this volume issues no 8.3 alias for the destination)");
    return;
  }
  assert.strictEqual(fs.realpathSync.native(shortDest).toLowerCase(), fs.realpathSync.native(dest).toLowerCase(),
    "the fixture only means anything if both spellings resolve to one directory");

  const ledger = createdPathLedger({
    realDestinationRoot: fs.realpathSync.native(dest),
    realSourceRoot: fs.realpathSync.native(source),
  });

  /* 1. The alias is one of the destination's own spellings, not an escape. */
  const slug = path.join(shortDest, "alpha");
  fs.mkdirSync(slug);
  ledger.directory(slug);
  const receipt = ledger.receipts().find((entry) => entry.path === path.resolve(slug));
  assert.ok(receipt, "the admitted directory must be receipted");
  assert.strictEqual(receipt.escaped, false,
    "a short-name spelling of the destination root is not a redirection");
  assert.strictEqual(receipt.realPath.toLowerCase(), path.join(fs.realpathSync.native(dest), "alpha").toLowerCase(),
    "and the receipt records the canonical location rather than the spelling it arrived in");

  /* 2. The boundary is where it was: a real redirection through the same alias is
        still refused, and the fixture proves the object really did land outside. */
  const outside = path.join(home, "unrelated");
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(dest, "beta"), "junction");
  const escaped = path.join(shortDest, "beta", "made-here");
  fs.mkdirSync(escaped);
  assert.throws(() => ledger.directory(escaped), /destination workspace/,
    "a destination redirected outside the workspace is still refused when reached through the alias");
  assert.strictEqual(fs.existsSync(path.join(outside, "made-here")), true,
    "the refusal is about placement: the object really is outside, not merely missing");
}

/* The object was legitimately created and receipted, and then became a different
   object before cleanup ran. Deleting on the strength of the path alone would
   destroy a stranger's file; the receipt is what stops it. */
function replacementBeforeRollback() {
  const { createdPathLedger } = shippedMigrationHelpers();
  const home = fs.mkdtempSync(path.join(TEMP, "replaced-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(source, { recursive: true });
  const slugDirectory = path.join(dest, "alpha");
  const document = path.join(slugDirectory, "project.json");
  const companion = path.join(slugDirectory, "kept.bin");
  fs.mkdirSync(slugDirectory, { recursive: true });
  fs.writeFileSync(document, "{}");
  fs.writeFileSync(companion, "also ours");

  const ledger = createdPathLedger({
    realDestinationRoot: fs.realpathSync.native(dest),
    realSourceRoot: fs.realpathSync.native(source),
  });
  ledger.directory(slugDirectory);
  ledger.file(document);
  ledger.file(companion);

  /* Between creation and cleanup the path stops naming the object it named. */
  fs.unlinkSync(document);
  fs.writeFileSync(document, "a different actor's document");
  const replacementBytes = sha(document);

  const rollback = ledger.unwind();
  assert.strictEqual(rollback.complete, false, "a changed identity must not report a clean cleanup");
  assert(rollback.leftover.includes(document), JSON.stringify(rollback.leftover));
  assert(rollback.errors.some((row) => /same filesystem object/.test(row.message)),
    "the reason must name the identity mismatch: " + JSON.stringify(rollback.errors));
  assert.strictEqual(fs.existsSync(document), true, "the replacement is not ours to delete");
  assert.strictEqual(sha(document), replacementBytes, "and it is untouched");
  assert.strictEqual(fs.existsSync(companion), false, "objects that are still ours are still cleaned up");
  assert.strictEqual(fs.existsSync(slugDirectory), true,
    "the folder cannot be removed while a stranger's file sits in it, and is reported instead");
  assert(rollback.leftover.includes(slugDirectory));
}

/* ==========================================================================
   F11-A1 / F11-A2 / F11-P1 — the correction.

   A1 is the class the design review named and Node cannot prevent on Windows:
   there is no handle-relative mkdir or open, so an actor that replaces an
   already-validated ancestor between the check and the syscall gets followed.
   What CineBraid owes in that case is not prevention but honesty — detect it,
   OWN what it exclusively created, remove exactly that, touch nothing else.
   ========================================================================== */

/* The shipped publish, from the shipped source, in its own realm. */
function shippedExclusivePublish(source = SERVER_SOURCE) {
  const start = source.indexOf("function atomicWriteJson(");
  const end = source.indexOf("/* ---- project save revision");
  assert(start > 0 && end > start, "atomicWriteJson must be locatable in server.js");
  const sandbox = { require, module: { exports: {} }, exports: {}, console, fs, path, crypto, process, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + "\nmodule.exports = { atomicWriteJson };",
    sandbox, { filename: "server.js#atomic-write-json" });
  return sandbox.module.exports.atomicWriteJson;
}

/* Deterministic by construction rather than by winning a race: the interleave is
   driven directly, so this proves the same thing a timing fixture would and proves
   it on every run, on every machine. */
function ancestorSwapOwnedEscape(helpers = shippedMigrationHelpers(), publish = shippedExclusivePublish()) {
  const { createdPathLedger, claimDirectory, workspaceMigrationFailure } = helpers;
  const home = fs.mkdtempSync(path.join(TEMP, "escape-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(source); fs.mkdirSync(dest);
  const sink = path.join(source, "sink"); fs.mkdirSync(sink);
  /* Material that was in the source workspace before any of this. Whatever else
     happens, not one byte of it may change. */
  writeFileAt(path.join(sink, "pre-existing.bin"), "source bytes that predate the migration");
  const preExistingBytes = sha(path.join(sink, "pre-existing.bin"));

  const ledger = createdPathLedger({
    realDestinationRoot: fs.realpathSync.native(dest), realSourceRoot: fs.realpathSync.native(source),
  });

  /* 1 — the ancestor is created by this attempt and validates as an ordinary
     destination folder, exactly as it does in the route. */
  const slugDirectory = path.join(dest, "alpha");
  assert.strictEqual(claimDirectory(slugDirectory).created, true);
  ledger.directory(slugDirectory);
  assert.strictEqual(ledger.receipts()[0].escaped, false, "it was in bounds when it was made");

  /* 2 — another actor replaces that validated ancestor with a junction into the
     source workspace. This is the window no path-based Node API can close. */
  fs.rmdirSync(slugDirectory);
  fs.symlinkSync(sink, slugDirectory, "junction");
  const junctionTarget = fs.readlinkSync(slugDirectory);

  /* 3 — the publish runs and is followed through the replacement. */
  const document = path.join(slugDirectory, "project.json");
  publish(document, { migrated: true }, { backup: false, exclusive: true });
  const escapedFile = path.join(sink, "project.json");
  assert.strictEqual(fs.existsSync(escapedFile), true,
    "the fixture must actually escape, or the rest of this proves nothing");
  const escapedIdentity = fs.lstatSync(escapedFile, { bigint: true });
  /* Taken now, while the file still exists: step 5 removes it and the comparison there
     needs the same canonical spelling this one does. */
  const escapedFileReal = realExpected(escapedFile);
  assert.deepStrictEqual(fs.readdirSync(sink).filter((name) => name.endsWith(".tmp")), [],
    "and the publish still cleans its own temp, even where it landed");

  /* 4 — the exclusive creation is proof of OWNERSHIP even though the PLACEMENT is
     wrong. Those are different questions, and the receipt survives the second. */
  assert.throws(() => ledger.file(document), /physically created at/, "the migration must fail");
  const receipt = ledger.receipts().find((row) => row.kind === "file");
  assert(receipt, "the proof that this attempt created it must be kept, not discarded");
  assert.strictEqual(receipt.escaped, true, JSON.stringify(receipt));
  assert.strictEqual(samePath(receipt.realPath, escapedFileReal), true,
    "the receipt must name where the object PHYSICALLY is: " + receipt.realPath);
  assert.strictEqual(receipt.dev, String(escapedIdentity.dev), "captured by filesystem identity");
  assert.strictEqual(receipt.ino, String(escapedIdentity.ino));
  assert(/inside the source workspace/.test(receipt.reason), receipt.reason);

  /* 5 — cleanup removes exactly that object, at the place it really occupies. */
  const rollback = ledger.unwind();
  assert.strictEqual(fs.existsSync(escapedFile), false, "the escaped copy must be removed");
  assert.strictEqual(rollback.escaped.length, 1, JSON.stringify(rollback.escaped));
  assert.strictEqual(rollback.escaped[0].removed, true);
  assert.strictEqual(samePath(rollback.escaped[0].realPath, escapedFileReal), true);

  /* 6 — and nothing else. The junction belongs to the other actor; the source
     material that predates this attempt is byte-identical; nothing was recursive. */
  assert.strictEqual(fs.lstatSync(slugDirectory).isSymbolicLink(), true, "the foreign junction survives");
  assert.strictEqual(fs.readlinkSync(slugDirectory), junctionTarget, "unchanged, not merely present");
  assert.strictEqual(sha(path.join(sink, "pre-existing.bin")), preExistingBytes,
    "pre-existing source bytes are untouched");
  assert.strictEqual(rollback.complete, false,
    "the ancestor receipt cannot be honoured, and that is reported rather than forced");
  assert(rollback.leftover.includes(slugDirectory), JSON.stringify(rollback.leftover));

  /* 7 — the response says all of it: failed, not moved, what escaped, what is left. */
  let sent = null;
  const res = { status(code) { sent = { status: code }; return this; }, json(body) { sent.body = body; return sent; } };
  workspaceMigrationFailure(res, new Error("Workspace migration stopped."), rollback);
  assert.strictEqual(sent.body.ok, false);
  assert.strictEqual(sent.body.migration.movedRoot, false, "nothing may describe this as a workspace that moved");
  assert.strictEqual(sent.body.escapedCreations.length, 1, JSON.stringify(sent.body));
  assert.strictEqual(sent.body.escapedCreations[0].removed, true);
  assert(/created outside the new project folder has been removed/.test(sent.body.error), sent.body.error);
  assert.strictEqual(sent.body.cleanupIncomplete, true, "and what it could not remove is still reported");
  assert(/did not finish/.test(sent.body.error), sent.body.error);
  return { escapedFile, rollback };
}

/* Escaped cleanup deletes at a real path with NO containment check to fall back on —
   by definition the object is out of bounds. Filesystem identity is therefore the
   only thing between it and a stranger's file at that location, so it is exercised
   on its own rather than assumed from the in-bounds case. */
function escapedIdentitySubstitution(helpers = shippedMigrationHelpers(), publish = shippedExclusivePublish()) {
  const { createdPathLedger, claimDirectory } = helpers;
  const home = fs.mkdtempSync(path.join(TEMP, "escape-swapped-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(source); fs.mkdirSync(dest);
  const sink = path.join(source, "sink"); fs.mkdirSync(sink);

  const ledger = createdPathLedger({
    realDestinationRoot: fs.realpathSync.native(dest), realSourceRoot: fs.realpathSync.native(source),
  });
  const slugDirectory = path.join(dest, "alpha");
  assert.strictEqual(claimDirectory(slugDirectory).created, true);
  ledger.directory(slugDirectory);
  fs.rmdirSync(slugDirectory);
  fs.symlinkSync(sink, slugDirectory, "junction");
  const document = path.join(slugDirectory, "project.json");
  publish(document, { migrated: true }, { backup: false, exclusive: true });
  assert.throws(() => ledger.file(document), /physically created at/);

  /* Between the escape and the cleanup, the escaped path stops naming our object. */
  const escapedFile = path.join(sink, "project.json");
  fs.unlinkSync(escapedFile);
  fs.writeFileSync(escapedFile, "a different actor's file, at the same place");
  const strangerBytes = sha(escapedFile);
  const escapedFileReal = realExpected(escapedFile);

  const rollback = ledger.unwind();
  assert.strictEqual(fs.existsSync(escapedFile), true, "the replacement is not ours to delete");
  assert.strictEqual(sha(escapedFile), strangerBytes, "and it is untouched");
  assert.strictEqual(rollback.escaped.length, 1, JSON.stringify(rollback.escaped));
  assert.strictEqual(rollback.escaped[0].removed, false,
    "and the report says so rather than claiming a clean escape: " + JSON.stringify(rollback.escaped));
  assert.strictEqual(rollback.complete, false);
  /* unwind() reports an escaped entry by its realPath, so the expectation is canonical too. */
  assert(rollback.leftover.some((row) => samePath(row, escapedFileReal)),
    "the escaped path must be named as leftover: " + JSON.stringify(rollback.leftover));
  assert(rollback.errors.some((row) => /same filesystem object/.test(row.message)),
    "the reason must be the identity mismatch: " + JSON.stringify(rollback.errors));
}

/* A source project folder represented through a junction. It used to be invisible
   to planning — not refused, just absent — and the migration answered 200 with the
   project missing from the new workspace. */
async function f11_a2() {
  await withWorkspace(({ home, source }) => {
    writeProjectAt(source, "alpha", baseProject("Alpha"));
    const elsewhere = path.join(home, "big-drive");
    writeProjectAt(elsewhere, "beta", baseProject("Beta"));
    writeFileAt(path.join(elsewhere, "beta", "media", "frame.bin"), "beta-frame-bytes");
    fs.symlinkSync(path.join(elsewhere, "beta"), path.join(source, "beta"), "junction");
  }, async ({ home, source, dest, configuredRoot, migrate }) => {
    const elsewhere = path.join(home, "big-drive");
    const beforeSource = snapshot(source), beforeElsewhere = snapshot(elsewhere);

    const result = await migrate();
    assert.strictEqual(result.status, 409, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "WORKSPACE_MIGRATION_SOURCE_ENTRY_UNSUPPORTED");
    assert.strictEqual(result.body.ok, false);
    const problem = (result.body.problems || []).find((row) => row.name === "beta");
    assert(problem, "the refusal must name the entry it cannot carry: " + JSON.stringify(result.body.problems));
    assert.strictEqual(problem.reason, "REDIRECTED");
    assert(/shortcut/.test(problem.detail), problem.detail);

    /* The point of the scenario: loudly, and with nothing written. */
    assert.strictEqual(result.body.migration, undefined, "a preflight refusal performs no cleanup");
    assert.strictEqual(fs.existsSync(path.join(dest, "alpha", "project.json")), false,
      "not even the project it could have carried is written");
    assert.deepStrictEqual(fs.readdirSync(dest), [], "the destination stays empty");
    assert.strictEqual(configuredRoot(), path.resolve(source), "the workspace stays where it was");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched");
    assert.deepStrictEqual(snapshot(elsewhere), beforeElsewhere, "and so must what the shortcut points at");
  });
}

/* A dangling reparse point sitting at the exact path the document must be published
   to. `existsSync` reports it as absent, so nothing before the publish can see it;
   the publish is what has to refuse, and it must not create the thing it points at. */
async function f11_p1() {
  await withWorkspace(({ source, dest }) => {
    writeProjectAt(source, "alpha", baseProject("Alpha"));
    blockDocumentInvisibly(dest, "alpha");
  }, async ({ source, dest, configuredRoot, migrate }) => {
    const blocker = path.join(dest, "alpha", "project.json");
    const pointsAt = path.join(dest, "alpha", "no-such-target");
    assert.strictEqual(fs.existsSync(blocker), false, "the blocker must be invisible to a stat-based check");
    assert.strictEqual(fs.lstatSync(blocker).isSymbolicLink(), true, "…while genuinely being there");
    const beforeSource = snapshot(source), beforeDest = snapshot(dest);

    const result = await migrate();
    assert.strictEqual(result.status, 500, JSON.stringify(result.body));
    assert.strictEqual(result.body.code, "PROJECT_PERSISTENCE_FAILED");
    assert.strictEqual(result.body.slug, "alpha");

    assert.strictEqual(fs.existsSync(pointsAt), false,
      "nothing may be brought into existence at the far end of the reparse point");
    assert.strictEqual(fs.lstatSync(blocker).isSymbolicLink(), true, "and the blocker itself is untouched");
    assert.deepStrictEqual(fs.readdirSync(path.join(dest, "alpha")).filter((name) => name.endsWith(".tmp")), [],
      "a refused publish leaves no temp behind to collide with the retry");

    const rollback = result.body.migration.rollback;
    assert.strictEqual(rollback.complete, true, JSON.stringify(rollback));
    assert.deepStrictEqual(rollback.escaped, [], "nothing escaped: this was refused at the publish");
    assert.strictEqual(result.body.escapedCreations, undefined);
    assert.deepStrictEqual(snapshot(dest), beforeDest, "the destination must equal its pre-attempt state");
    assert.deepStrictEqual(snapshot(source), beforeSource, "the source must be untouched");
    assert.strictEqual(configuredRoot(), path.resolve(source));
  });
}

/* ==========================================================================
   SOURCE-LEVEL SAFETY. Properties that have to hold by construction, not
   because a scenario happened not to trip them.
   ========================================================================== */

function safetyChecks() {
  const { createdPathLedger } = shippedMigrationHelpers();
  const home = fs.mkdtempSync(path.join(TEMP, "safety-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  const realSource = fs.realpathSync.native(source), realDest = fs.realpathSync.native(dest);
  /* The ledger only ever admits from a successful exclusive creation, so a test that
     wants to offer it a path must genuinely create that path first. */
  const ledger = () => createdPathLedger({ realDestinationRoot: realDest, realSourceRoot: realSource });
  const made = (target, contents = "x") => { writeFileAt(target, contents); return target; };

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

  /* S2 — an object outside the destination migration root still stops the migration,
     and containment is decided PHYSICALLY.

     What changed with the escape correction: stopping is no longer the same act as
     disowning. Admission only ever follows an exclusive creation, so the object IS
     this attempt's; the receipt is kept and marked escaped, and the throw is what
     fails the migration. Every assertion below therefore checks BOTH halves — it
     refused, and it kept the proof — because keeping only one of them is exactly how
     an escaped artifact ends up orphaned where it landed. */
  const escapes = (act, realHome) => {
    const led = ledger();
    assert.throws(act(led), /physically created at/, "an out-of-bounds creation must stop the migration");
    const [receipt] = led.receipts();
    assert(receipt, "and the proof that this attempt created it must be kept");
    assert.strictEqual(receipt.escaped, true, "marked escaped: " + JSON.stringify(receipt));
    assert(receipt.reason, "with a reason a person can read");
    /* Canonicalised here rather than at each call site: every caller passes the path it
       built the fixture from, and the receipt answers in realpath terms. */
    assert.strictEqual(samePath(receipt.realPath, realExpected(realHome)), true,
      `and pointing at where the object PHYSICALLY is, which is the only path cleanup may use: ${receipt.realPath} vs ${realHome}`);
    return receipt;
  };
  escapes((led) => () => led.file(made(path.join(home, "outside.bin"))), path.join(home, "outside.bin"));
  escapes((led) => () => led.directory(dest), dest);
  escapes((led) => () => led.file(made(path.join(home, "escape.bin"))), path.join(home, "escape.bin"));

  /* S3 — a source path is judged by its real location and never by prefix. */
  escapes((led) => () => led.file(made(path.join(source, "alpha", "project.json"), "{}")),
    path.join(source, "alpha", "project.json"));
  escapes((led) => () => led.directory(source), source);
  /* The one that a string test cannot catch: a name under the destination whose real
     location is inside the source. Lexically it is impeccable. */
  const sink = path.join(source, "sink"); fs.mkdirSync(sink, { recursive: true });
  const redirected = path.join(dest, "looks-fine");
  fs.symlinkSync(sink, redirected, "junction");
  writeFileAt(path.join(sink, "planted.bin"), "source bytes");
  /* A LEXICAL precondition, so both sides are the destination AS SPELLED. Against the
     realpath root it compared two spellings of one directory and failed on a machine
     whose TEMP carries an 8.3 alias — while saying "lexically" in its own message. */
  assert.strictEqual(insideDirectoryOf(dest, path.join(redirected, "planted.bin")), true,
    "the fixture must be lexically inside the destination, or it proves nothing");
  escapes((led) => () => led.file(path.join(redirected, "planted.bin")), path.join(sink, "planted.bin"));
  assert.strictEqual(fs.existsSync(path.join(sink, "planted.bin")), true, "and nothing was deleted proving it");
  assert(preflightSource.includes("WORKSPACE_MIGRATION_NESTED_ROOT"),
    "a destination inside the source must be refused by preflight, before any ledger exists");
  assert(preflightSource.includes("realDirectory(previousRoot)") && preflightSource.includes("realDirectory(nextRoot)"),
    "both roots must be resolved to real paths before anything is decided against them");

  /* S4 — ownership comes from the creation operation. The post-hoc pattern that
     admitted whatever existed afterwards must not be anywhere in the route. */
  assert.strictEqual(occurrences(route, "fs.existsSync(item.destinationFile)"), 0,
    "the document must never be owned by asking the filesystem what is there afterwards");
  assert.strictEqual(occurrences(route, "fs.existsSync(slugDirectory)"), 0,
    "the folder must never be owned by asking the filesystem what is there afterwards");
  assert.strictEqual(occurrences(route, "if (outcome.ok && outcome.created === true) ledger.file(item.destinationFile);"), 1,
    "the document is owned only on the seam's own proof that this call created it");
  assert.strictEqual(occurrences(route, "if (claimDirectory(item.slugDirectory).created) ledger.directory(item.slugDirectory);"), 1,
    "the folder is owned only on an exclusive mkdir that succeeded");
  assert.strictEqual(occurrences(SERVER_SOURCE, "else if (claimDirectory(destination).created) ledger.directory(destination);"), 1,
    "the tree copy may only own a folder its own exclusive mkdir created");
  assert.strictEqual(occurrences(SERVER_SOURCE, "if (claimCopiedFile(src, dest).created) { ledger.file(dest); copied += 1; } else skipped += 1;"), 1,
    "the tree copy may only own a file its own exclusive copy created");
  assert(codeOnly(SERVER_SOURCE).includes("fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)"),
    "the copy claim must be exclusive");
  assert(codeOnly(SERVER_SOURCE).includes("fs.copyFileSync(temp, file, fs.constants.COPYFILE_EXCL);"),
    "the document must be published with a primitive that cannot overwrite");
  assert.strictEqual(occurrences(codeOnly(SERVER_SOURCE), "fs.linkSync("), 0,
    "and not with a hard link, which does not exist on exFAT or FAT32");

  /* S6 — the invariant the escaped receipt rests on. admit() may now record a
     receipt for an object that is not where it should be, which is only safe while
     every admission follows a proven exclusive creation. So the call sites are
     counted, not just sampled: four, and every one of them is a line already pinned
     above as guarded by its own creation proof. */
  const code = codeOnly(SERVER_SOURCE);
  assert.strictEqual(occurrences(code, "ledger.file(") + occurrences(code, "ledger.directory("), 4,
    "a fifth admission would be an admission nobody proved: "
    + JSON.stringify((code.match(/ledger\.(file|directory)\([^)]*\)/g) || [])));
  for (const guarded of [
    "if (outcome.ok && outcome.created === true) ledger.file(item.destinationFile);",
    "if (claimDirectory(item.slugDirectory).created) ledger.directory(item.slugDirectory);",
    "else if (claimDirectory(destination).created) ledger.directory(destination);",
    "if (claimCopiedFile(src, dest).created) { ledger.file(dest); copied += 1; } else skipped += 1;",
  ]) assert.strictEqual(occurrences(code, guarded), 1, "every admission must be guarded: " + guarded);

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
  await scenario("RACE-1 foreign artifact present at the creation operation", race1);
  await scenario("RACE-1b the interleave, driven directly", async () => race1Interleaved());
  await scenario("F11-J1 destination junction into the source workspace", junctionIntoSource);
  await scenario("F11-J2 destination junction outside both roots", junctionOutsideDestination);
  await scenario("F11-N1 short-name alias of the destination is one location", async () => shortNameAliasIsOneLocation());
  await scenario("F11-R1 object replaced between creation and cleanup", async () => replacementBeforeRollback());
  await scenario("F11-A1 ancestor swapped mid-write: owned escape, cleaned by identity", async () => {
    ancestorSwapOwnedEscape();
    escapedIdentitySubstitution();
  });
  await scenario("F11-A2 source project folder is a junction", f11_a2);
  await scenario("F11-P1 dangling reparse at the destination document path", f11_p1);
  await scenario("F11-S  source-level safety properties", async () => safetyChecks());

  /* The exact set, so a scenario that quietly stopped running cannot pass as a
     smaller green suite. */
  assert.deepStrictEqual(passed.map((line) => line.split(" ")[0]),
    ["F11-1", "F11-2", "F11-3", "F11-4", "F11-5", "F11-6", "F11-7", "F11-8",
      "RACE-1", "RACE-1b", "F11-J1", "F11-J2", "F11-N1", "F11-R1", "F11-A1", "F11-A2", "F11-P1", "F11-S"]);
  console.log(`\nF-11 workspace migration cleanup: ${passed.length}/18 scenarios passed; provider calls: 0.`);
  fs.rmSync(TEMP, { recursive: true, force: true });
})().catch((error) => {
  console.error("\nF-11 FAILED\n", error);
  process.exit(1);
});

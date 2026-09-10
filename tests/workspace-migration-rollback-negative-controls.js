"use strict";

/* F-11 NEGATIVE CONTROLS.
 *
 * The positive suite shows that a failed workspace migration cleans up after itself
 * and can be retried. That is only worth something if the cleanup is what makes it
 * true. Each control here reintroduces one specific defect into the SHIPPED
 * server.js, runs a real server on the mutated source, and requires the exact
 * damage back.
 *
 * Every control runs twice. PHASE 0 runs the shipped source and requires the damage
 * to be ABSENT — a control that "detects" something already broken detects nothing.
 * PHASE 1 runs the mutated source and requires the damage to be PRESENT. Each
 * mutation is proved to match the shipped text exactly once and to change it, so a
 * needle that has drifted can never be mistaken for a defect that came back.
 *
 * Fixtures are isolated under os.tmpdir(). No provider is configured or contacted,
 * and the one control that reintroduces an indiscriminate deletion is arranged so
 * that the shipped last-line guard is what has to stop it.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const { ROOT, freePort } = require("./fixtures/mock-civitai");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-f11-nc-"));
const SERVER = path.join(ROOT, "src/server/server.js");
const SHIPPED = fs.readFileSync(SERVER, "utf8").replace(/\r\n/g, "\n");
const SCRATCH = new Set();

process.on("exit", () => { for (const file of SCRATCH) { try { fs.unlinkSync(file); } catch {} } });

/* ==========================================================================
   MUTATION
   ========================================================================== */

function applyMutations(source, edits) {
  let text = String(source).replace(/\r\n/g, "\n");
  edits.forEach((edit, index) => {
    const needle = String(edit.from).replace(/\r\n/g, "\n");
    const found = text.split(needle).length - 1;
    assert.strictEqual(found, 1,
      `edit ${index + 1}: the needle matched ${found} times in the shipped source, so this control is not armed`);
    const next = text.replace(needle, edit.to);
    assert.notStrictEqual(next, text, `edit ${index + 1}: the mutation produced no change`);
    text = next;
  });
  return text;
}

/* ==========================================================================
   FIXTURES AND A SERVER BUILT FROM ARBITRARY SOURCE
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

/* The mutated copy is written next to server.js so its own `require("./…")` calls
   resolve exactly as they do in production, under a name `.gitignore` already
   covers, and it is removed on the way out and again at exit. */
let scratchCounter = 0;
async function runServer(source, { configPath, projectsRoot }, body) {
  const isShipped = source === SHIPPED;
  const file = isShipped ? SERVER : path.join(path.dirname(SERVER), `server-f11-control-${process.pid}-${scratchCounter++}.tmp`);
  if (!isShipped) { fs.writeFileSync(file, source); SCRATCH.add(file); }
  const port = await freePort();
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot,
      FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/me`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const request = async (pathname, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      return { status: response.status, ok: response.ok, body: parsed, text };
    };
    return await body({ request });
  } finally {
    child.kill();
    if (!isShipped) { try { fs.unlinkSync(file); } catch {} SCRATCH.delete(file); }
  }
}

/* Runs one migration attempt and then one retry, against whichever source is given,
   over a freshly built copy of the fixture so the two phases cannot interfere. */
async function attemptAndRetry(source, build) {
  const home = fs.mkdtempSync(path.join(TEMP, "ws-"));
  const projectsRoot = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(projectsRoot, { recursive: true });
  build({ source: projectsRoot, dest });
  const configPath = path.join(home, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    workspace: { projectRoot: toPosix(projectsRoot) },
    activeProject: "alpha",
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: false } },
  }, null, 2));
  return runServer(source, { configPath, projectsRoot }, async ({ request }) => {
    const migrate = () => request("/api/workspace/settings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: { projectRoot: toPosix(dest) } }),
    });
    const first = await migrate();
    const afterFirst = fs.existsSync(dest)
      ? fs.readdirSync(dest, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dest, entry.name, "project.json")))
        .map((entry) => entry.name).sort()
      : [];
    const retry = await migrate();
    return { home, source: projectsRoot, dest, first, retry, documentsAfterFirst: afterFirst };
  });
}

/* One region of a build — shipped or mutated — evaluated in its own realm, so a
   control can exercise mutated code without writing a server to disk. */
function slice(source, from, to, exportsExpression, label) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert(start > 0 && end > start, `${label}: could not locate ${from}`);
  const sandbox = { require, module: { exports: {} }, exports: {}, console, fs, path, crypto, process, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source.slice(start, end)}\nmodule.exports = ${exportsExpression};`, sandbox, { filename: label });
  return sandbox.module.exports;
}

/* The shipped ledger, evaluated from source in its own realm so a control can load a
   mutated copy without writing anything to disk. */
function ledgerFrom(source) {
  const start = source.indexOf("function insideDirectory(");
  const end = source.indexOf("function workspaceStatus(");
  assert(start > 0 && end > start, "the F-11 migration helpers must be locatable");
  const sandbox = { require, module: { exports: {} }, console, fs, path, process, exports: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + "\nmodule.exports = { createdPathLedger };",
    sandbox, { filename: "server.js#f11-ledger" });
  return sandbox.module.exports.createdPathLedger;
}

/* ==========================================================================
   THE CONTROLS
   ========================================================================== */

/* A blocker preflight genuinely cannot see: `existsSync` follows reparse points, so
   a dangling junction at a document path reads as absent. The migration therefore
   gets as far as writing alpha before beta fails, which is the state every rollback
   control needs. */
const THREE_PROJECTS_ONE_BLOCKED = ({ source, dest }) => {
  for (const slug of ["alpha", "beta", "gamma"]) writeProjectAt(source, slug, baseProject(slug));
  fs.mkdirSync(path.join(dest, "beta"), { recursive: true });
  fs.symlinkSync(path.join(dest, "beta", "no-such-target"), path.join(dest, "beta", "project.json"), "junction");
};

const THREE_PROJECTS_COPY_BLOCKED = ({ source, dest }) => {
  for (const slug of ["alpha", "beta", "gamma"]) {
    writeProjectAt(source, slug, baseProject(slug));
    writeFileAt(path.join(source, slug, "media", "frame.bin"), `${slug}-frame`);
  }
  writeFileAt(path.join(source, "zz-shared", "note.txt"), "shared");
  writeFileAt(path.join(dest, "zz-shared"), "occupied by something else");
};

const PRE_EXISTING_INSIDE_A_MIGRATED_SLUG = ({ source, dest }) => {
  writeProjectAt(source, "alpha", baseProject("Alpha"));
  writeProjectAt(source, "beta", baseProject("Beta"));
  writeFileAt(path.join(source, "zz-shared", "note.txt"), "shared");
  /* A folder that already carries a migrated project's name but holds no project
     document, so it is not a collision and the migration writes into it. */
  writeFileAt(path.join(dest, "alpha", "legacy.bin"), "bytes that predate the migration");
  writeFileAt(path.join(dest, "zz-shared"), "occupied by something else");
};

const CONTROLS = [
  {
    id: "NC-F11-1",
    title: "rollback disabled after partial destination creation",
    /* The reporting path is left intact and only the unwind is removed, so what the
       control proves is the cleanup and not the shape of the error. */
    mutations: [{
      from: "if (ledger) return workspaceMigrationFailure(res, error, ledger.unwind());",
      to: "if (ledger) return workspaceMigrationFailure(res, error, { attempted: false, complete: true, removed: 0, leftover: [], errors: [] });",
    }],
    fixture: THREE_PROJECTS_ONE_BLOCKED,
    shipped(result) {
      assert.strictEqual(result.first.ok, false, "the first attempt must fail");
      assert.deepStrictEqual(result.documentsAfterFirst, [],
        "the shipped build leaves no document of its own behind");
      assert.notStrictEqual(result.retry.body.code, "WORKSPACE_PROJECT_COLLISION",
        "the shipped build's retry does not collide with itself");
    },
    mutated(result) {
      assert.strictEqual(result.first.ok, false, "the first attempt must still fail");
      assert.deepStrictEqual(result.documentsAfterFirst, ["alpha"],
        "without cleanup, the attempt's own copy stays at the destination");
      assert.strictEqual(result.retry.status, 409, JSON.stringify(result.retry.body));
      assert.strictEqual(result.retry.body.code, "WORKSPACE_PROJECT_COLLISION",
        "and the retry is refused because of it");
      assert.deepStrictEqual(result.retry.body.collisions, ["alpha"],
        "the collision names the migration's own leftover");
    },
  },
  {
    id: "NC-F11-2",
    title: "rollback insufficient after several creations",
    /* Cleanup runs, in the right order, and stops after one entry. */
    mutations: [{
      from: "for (let index = entries.length - 1; index >= 0; index -= 1) {",
      to: "for (let index = entries.length - 1; index >= entries.length - 1; index -= 1) {",
    }],
    fixture: THREE_PROJECTS_COPY_BLOCKED,
    shipped(result) {
      assert.strictEqual(result.first.ok, false);
      assert.strictEqual(result.first.body.migration.rollback.complete, true);
      assert.deepStrictEqual(result.documentsAfterFirst, [],
        "the shipped build removes every document it created");
      assert.notStrictEqual(result.retry.body.code, "WORKSPACE_PROJECT_COLLISION");
    },
    mutated(result) {
      assert.strictEqual(result.first.ok, false);
      assert(result.documentsAfterFirst.length >= 1,
        "a partial cleanup leaves at least one migration-owned document behind");
      assert.strictEqual(result.retry.status, 409, JSON.stringify(result.retry.body));
      assert.strictEqual(result.retry.body.code, "WORKSPACE_PROJECT_COLLISION",
        "and that is enough to block the retry");
      for (const slug of result.documentsAfterFirst)
        assert(result.retry.body.collisions.includes(slug),
          `${slug} was left by the attempt and collides with it`);
    },
  },
  {
    id: "NC-F11-3",
    title: "rollback indiscriminate rather than ledger-owned",
    /* Ownership stops being observed and becomes assumed: anything present after the
       write is treated as this attempt's, including the folder that was already
       there. The destination then holds pre-existing bytes inside a folder cleanup
       now believes it owns, and the only thing between them and deletion is the
       shipped rule that folders are emptied, never forced. */
    mutations: [
      {
        from: "        if (claimDirectory(item.slugDirectory).created) ledger.directory(item.slugDirectory);\n"
          + "        else ledger.container(item.slugDirectory);",
        to: "        if (fs.existsSync(item.slugDirectory)) ledger.directory(item.slugDirectory);",
      },
    ],
    fixture: PRE_EXISTING_INSIDE_A_MIGRATED_SLUG,
    shipped(result) {
      const legacy = path.join(result.dest, "alpha", "legacy.bin");
      assert.strictEqual(result.first.ok, false);
      assert.strictEqual(result.first.body.migration.rollback.complete, true,
        "the shipped build never even tries to remove the folder it found");
      assert.strictEqual(result.first.body.cleanupIncomplete, undefined);
      assert.strictEqual(fs.existsSync(legacy), true, "pre-existing bytes are untouched");
      assert.strictEqual(fs.existsSync(path.join(result.dest, "alpha")), true);
    },
    mutated(result) {
      const legacy = path.join(result.dest, "alpha", "legacy.bin");
      assert.strictEqual(result.first.ok, false);
      /* The unsafe deletion is ATTEMPTED — the pre-existing folder entered the ledger
         and cleanup went at it — and the shipped guard turns that into a reported
         failure instead of a loss. */
      const rollback = result.first.body.migration.rollback;
      assert.strictEqual(rollback.complete, false,
        "assuming ownership must not be able to pass as a clean cleanup");
      /* The migration resolves its destination root before it builds anything, so the
         leftover it reports is canonical. Where TEMP carries an 8.3 alias the fixture's
         own spelling is the short one and a string match fails against a report that is
         correct — so the expectation is canonicalised, not loosened. */
      const claimed = path.resolve(path.join(fs.realpathSync.native(result.dest), "alpha")).toLowerCase();
      assert(rollback.leftover.some((row) => path.resolve(String(row)).toLowerCase() === claimed),
        "the folder cleanup wrongly claimed is named: " + JSON.stringify(rollback.leftover));
      assert(rollback.errors.some((row) => row.code === "ENOTEMPTY"),
        "the guard that stops it is the non-recursive remove: " + JSON.stringify(rollback.errors));
      assert.strictEqual(result.first.body.cleanupIncomplete, true,
        "and the result says so rather than reporting a clean failure");
      assert.strictEqual(fs.existsSync(legacy), true,
        "the pre-existing bytes survive: the guard goes red before they are touched");
    },
  },
];

/* ==========================================================================
   NC-F11-3, second half: the containment rule itself.

   Nothing is deleted here. The point is that the shipped ledger REFUSES a path it
   does not own at the moment it is offered one — before any removal is even
   considered — and that removing the rule is what makes an unowned path admissible.
   ========================================================================== */

/* Re-anchored when the first test gained its canonical half, so that a short-name
   spelling of the destination stops reading as an escape. What the two controls below
   do with this needle is unchanged: NC-F11-3b removes the rule entirely, NC-F11-4 puts
   a lexical-only rule back. The second is the reason the canonical test was ADDED
   beside the lexical one rather than replacing it — a rule that consults only the path
   string is exactly what NC-F11-4 proves writes into the source workspace. */
const CONTAINMENT_RULE =
  '    if (sameRealPath(realParent, realSourceRoot) || insideRealDirectory(realSourceRoot, realParent))\n'
  + '      return "physically resides inside the source workspace";\n'
  + '    if (!insideRealDirectory(realDestinationRoot, realParent) && !sameRealPath(realParent, realDestinationRoot))\n'
  + '      return "physically resides outside the destination workspace";\n'
  + '    if (!insideRealDirectory(realDestinationRoot, target) && !insideRealDirectory(realDestinationRoot, realTarget))\n'
  + '      return "is not inside the destination workspace";\n'
  + '    return "";';

function containmentControl() {
  const home = fs.mkdtempSync(path.join(TEMP, "containment-"));
  const source = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(path.join(source, "alpha"), { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  const sourceDocument = path.join(source, "alpha", "project.json");
  fs.writeFileSync(sourceDocument, "{}");
  const outside = path.join(home, "somewhere-else.bin");
  fs.writeFileSync(outside, "not the destination");

  const roots = { realDestinationRoot: fs.realpathSync.native(dest), realSourceRoot: fs.realpathSync.native(source) };
  /* The shipped ledger stops the migration for both, and — since the escape
     correction — keeps the receipt while doing so, marked as out of bounds. Refusing
     to PROCEED and refusing to OWN are different things, and only the first is what
     the containment rule decides. */
  const shipped = ledgerFrom(SHIPPED);
  for (const [target, label] of [[sourceDocument, "a source path"], [outside, "a path outside the destination"]]) {
    const led = shipped(roots);
    assert.throws(() => led.file(target), /physically created at/, `the shipped ledger must refuse to proceed on ${label}`);
    const [receipt] = led.receipts();
    assert.strictEqual(receipt.escaped, true, `${label} must be marked out of bounds: ` + JSON.stringify(receipt));
    assert(receipt.reason, `${label} must carry a reason`);
  }

  const mutated = ledgerFrom(applyMutations(SHIPPED, [{ from: CONTAINMENT_RULE, to: '    return "";' }]));
  const unguarded = mutated({
    realDestinationRoot: fs.realpathSync.native(dest),
    realSourceRoot: fs.realpathSync.native(source),
  });
  unguarded.file(sourceDocument);
  unguarded.file(outside);
  assert.deepStrictEqual([...unguarded.paths()], [path.resolve(sourceDocument), path.resolve(outside)],
    "without the rule, a source path and a path outside the destination are both admitted");
  /* Spread first: `receipts()` is built inside the vm realm, and a realm array fails
     deepStrictEqual against a host literal while printing identically. */
  assert.deepStrictEqual([...unguarded.receipts()].map((row) => row.escaped), [false, false],
    "and admitted as ORDINARY entries — nothing marks them, nothing stops the migration, "
    + "and cleanup would go at a source document in place");

  /* Deliberately never unwound. The control's whole claim is that the shipped code
     stops this at admission, so nothing here ever reaches a delete. */
  assert.strictEqual(fs.existsSync(sourceDocument), true);
  assert.strictEqual(fs.existsSync(outside), true);
}

/* ==========================================================================
   NC-F11-4 — lexical containment restored.

   The independently-reported hold. `path.resolve`/`path.relative` say a junction
   at `<destination>/alpha` is inside the destination, because as strings it is.
   Put the reparse decisions back and the migration writes a project document into
   the SOURCE workspace and calls itself a success.
   ========================================================================== */

/* Everything destinationChild decides from the real filesystem, replaced by the
   lexical answer the path string gives — which is what the held candidate did. */
const LEXICAL_ONLY = [
  {
    from: '  if (link.isSymbolicLink())\n'
      + '    return { ok: false, reason: "REDIRECTED", detail: "This destination is a shortcut to somewhere else, so migrating into it would not put anything where it looks like it would." };\n'
      + '  if (!link.isDirectory())\n'
      + '    return { ok: false, reason: "NOT_A_FOLDER", detail: "Something that is not a folder already occupies this destination." };\n'
      + '  let real;\n'
      + '  try { real = realDirectory(target); }\n'
      + '  catch (error) { return { ok: false, reason: "UNREADABLE", detail: error?.message || "This destination could not be resolved." }; }\n'
      + '  if (!insideRealDirectory(realDestinationRoot, real))\n'
      + '    return { ok: false, reason: "ESCAPES_DESTINATION", detail: "This destination folder physically lives outside the new project folder." };\n'
      + '  if (sameRealPath(real, realSourceRoot) || insideRealDirectory(realSourceRoot, real))\n'
      + '    return { ok: false, reason: "RESOLVES_INTO_SOURCE", detail: "This destination folder physically lives inside the current project folder." };\n'
      + '  return { ok: true, exists: true, real };',
    to: "  return { ok: true, exists: true, real: target };",
  },
  {
    from: "      const link = fs.lstatSync(target);\n"
      + "      if (link.isSymbolicLink())\n"
      + "        throw new Error(`Workspace migration refused to write through a shortcut at ${target}.`);\n"
      + "      if (!link.isDirectory())\n"
      + "        throw new Error(`Workspace migration cannot copy into ${target}, because something that is not a folder is already there.`);\n"
      + "      const real = realDirectory(target);",
    to: "      const real = target;",
  },
  { from: CONTAINMENT_RULE, to: '    return insideDirectory(realDestinationRoot, target) ? "" : "is not inside the destination workspace";' },
];

async function junctionControl() {
  const build = ({ source, dest }) => {
    writeProjectAt(source, "alpha", baseProject("Alpha"));
    fs.mkdirSync(path.join(source, "sink"), { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.symlinkSync(path.join(source, "sink"), path.join(dest, "alpha"), "junction");
  };
  const run = async (source) => {
    const result = await attemptAndRetry(source, build);
    const sink = path.join(result.source, "sink");
    return { ...result, sinkDocument: path.join(sink, "project.json"), wrote: fs.existsSync(path.join(sink, "project.json")) };
  };

  const shipped = await run(SHIPPED);
  assert.strictEqual(shipped.first.status, 409, JSON.stringify(shipped.first.body));
  assert.strictEqual(shipped.first.body.code, "WORKSPACE_MIGRATION_DESTINATION_REDIRECTED");
  assert.strictEqual(shipped.wrote, false, "the shipped build must not write through the junction");

  const mutated = await run(applyMutations(SHIPPED, LEXICAL_ONLY));
  assert.strictEqual(mutated.wrote, true,
    "lexical containment must let a project document land inside the SOURCE workspace: " + JSON.stringify(mutated.first.body));
  assert.strictEqual(mutated.first.status, 200, "and say nothing was wrong: " + JSON.stringify(mutated.first.body));
  assert.strictEqual(mutated.first.body.migration.movedRoot, true, "reporting a safe move over a source-directed write");
}

/* ==========================================================================
   NC-F11-5 — creation ownership inferred instead of proved.

   The other independently-reported hold. Both claim primitives are replaced with
   their non-exclusive forms, which is what "absent before, present after" reduces
   to once the gap is real: they report that this attempt created something it
   found, and in the file case they destroy it on the way.
   ========================================================================== */

function creationOwnershipControl() {
  const home = fs.mkdtempSync(path.join(TEMP, "ownership-"));
  fs.mkdirSync(home, { recursive: true });
  const load = (source) => {
    const start = source.indexOf("function claimDirectory(");
    const end = source.indexOf("function preflightWorkspaceMigration(");
    assert(start > 0 && end > start, "the claim primitives must be locatable");
    const sandbox = { require, module: { exports: {} }, console, fs, path, process, exports: {} };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source.slice(start, end) + "\nmodule.exports = { claimDirectory, claimCopiedFile };",
      sandbox, { filename: "server.js#f11-claims" });
    return sandbox.module.exports;
  };

  const foreignDir = path.join(home, "their-folder"); fs.mkdirSync(foreignDir);
  const payload = path.join(home, "ours.bin"); fs.writeFileSync(payload, "our bytes");
  const foreignFile = path.join(home, "their-file.bin"); fs.writeFileSync(foreignFile, "their bytes");
  const foreignBytes = sha(foreignFile);

  const shipped = load(SHIPPED);
  assert.strictEqual(shipped.claimDirectory(foreignDir).created, false,
    "the shipped build must not claim a folder it found");
  assert.strictEqual(shipped.claimCopiedFile(payload, foreignFile).created, false,
    "the shipped build must not claim a file it found");
  assert.strictEqual(sha(foreignFile), foreignBytes, "and must not have overwritten it");

  const mutated = load(applyMutations(SHIPPED, [
    {
      from: "  try { fs.mkdirSync(target); return { created: true }; }\n"
        + "  catch (error) {\n"
        + "    if (error?.code === \"EEXIST\") return { created: false };\n"
        + "    throw error;\n"
        + "  }",
      to: "  const absent = !fs.existsSync(target);\n"
        + "  fs.mkdirSync(target, { recursive: true });\n"
        + "  return { created: absent || fs.existsSync(target) };",
    },
    {
      from: "  try { fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); return { created: true }; }",
      to: "  try { fs.copyFileSync(source, target); return { created: true }; }",
    },
  ]));
  assert.strictEqual(mutated.claimDirectory(foreignDir).created, true,
    "inferring ownership adopts a folder another actor created");
  assert.strictEqual(mutated.claimCopiedFile(payload, foreignFile).created, true,
    "and adopts a file another actor created");
  assert.notStrictEqual(sha(foreignFile), foreignBytes,
    "having destroyed its contents first — which is what a non-exclusive copy does");
}

/* ==========================================================================
   NC-F11-6 — EPERM read as "already there".

   On Windows COPYFILE_EXCL answers EPERM for four different situations, and one of
   them is that the SOURCE could not be copied at all — which is what a junction
   answers. Treating EPERM as occupied therefore turns a source project this
   migration cannot carry into a silent omission: a completed move, a switched
   workspace root, and the project simply not there.

   Three edits, because that behaviour has three parts now: the lenient classifier,
   the tree-copy Dirent guard, and the preflight top-level guard. Removing any one
   alone leaves another to catch it, which is the point of having all three.
   ========================================================================== */

const EPERM_AS_SKIP = [
  {
    from: '    if (error?.code === "EEXIST") return { created: false };\n'
      + '    if (error?.code === "EPERM")\n'
      + "      throw new Error(`Workspace migration could not create ${target} as an ordinary file, because something that is not one already occupies that name or the path is redirected.`);",
    to: '    if (error?.code === "EEXIST" || error?.code === "EPERM") return { created: false };',
  },
  {
    from: "    if (ledger && !entry.isDirectory() && !entry.isFile()) throw unsupportedSourceEntry(src, entry);",
    to: "    if (false) throw unsupportedSourceEntry(src, entry);",
  },
  {
    from: '  if (unsupported.length)\n    return refuse(409, "WORKSPACE_MIGRATION_SOURCE_ENTRY_UNSUPPORTED",',
    to: '  if (false)\n    return refuse(409, "WORKSPACE_MIGRATION_SOURCE_ENTRY_UNSUPPORTED",',
  },
];

const SOURCE_PROJECT_IS_A_JUNCTION = ({ source, dest }) => {
  writeProjectAt(source, "alpha", baseProject("Alpha"));
  const elsewhere = path.join(path.dirname(source), "big-drive");
  writeProjectAt(elsewhere, "beta", baseProject("Beta"));
  writeFileAt(path.join(elsewhere, "beta", "media", "frame.bin"), "beta-frame-bytes");
  fs.mkdirSync(dest, { recursive: true });
  fs.symlinkSync(path.join(elsewhere, "beta"), path.join(source, "beta"), "junction");
};

async function epermAsSkipControl() {
  const shipped = await attemptAndRetry(SHIPPED, SOURCE_PROJECT_IS_A_JUNCTION);
  assert.strictEqual(shipped.first.status, 409, JSON.stringify(shipped.first.body));
  assert.strictEqual(shipped.first.body.code, "WORKSPACE_MIGRATION_SOURCE_ENTRY_UNSUPPORTED",
    "the shipped build must refuse loudly: " + JSON.stringify(shipped.first.body));
  assert.deepStrictEqual(shipped.documentsAfterFirst, [], "and write nothing");

  const mutated = await attemptAndRetry(applyMutations(SHIPPED, EPERM_AS_SKIP), SOURCE_PROJECT_IS_A_JUNCTION);
  assert.strictEqual(mutated.first.status, 200,
    "reading EPERM as occupied must let the migration report success: " + JSON.stringify(mutated.first.body));
  assert.strictEqual(mutated.first.body.migration.movedRoot, true, "…as a completed move");
  assert.deepStrictEqual(mutated.documentsAfterFirst, ["alpha"],
    "…with the junctioned project silently absent from the new workspace");
  assert.strictEqual(fs.existsSync(path.join(mutated.dest, "beta")), false,
    "beta never arrives, and nothing in the response says so");
  assert.strictEqual(JSON.stringify(mutated.first.body).includes("beta"), false,
    "which is the defect: the omission is not reported anywhere: " + JSON.stringify(mutated.first.body));
}

/* ==========================================================================
   NC-F11-7 — admit() throwing INSTEAD of recording.

   The held candidate discarded the creation proof whenever placement was
   unexpected, so an object it had exclusively created — and could therefore prove
   was its own — became unowned and stayed where it landed. Deterministic: the
   interleave is driven, not raced.
   ========================================================================== */

const OWNERSHIP_DISCARDED_ON_ESCAPE = [{
  from: "    entries.push({\n"
    + "      kind, path: target, realPath, realParent,\n"
    + "      dev: identity.dev, ino: identity.ino, escaped: Boolean(reason), reason,\n"
    + "    });\n"
    + "    if (reason)\n"
    + "      throw new Error(`Workspace migration stopped because ${target} was physically created at ${realPath}, which ${reason}. The destination was redirected after it had been checked.`);",
  to: "    if (reason) throw new Error(`Workspace migration cleanup refused a path it does not own: ${target} ${reason}.`);\n"
    + "    entries.push({\n"
    + "      kind, path: target, realPath, realParent,\n"
    + '      dev: identity.dev, ino: identity.ino, escaped: false, reason: "",\n'
    + "    });",
}];

/* Runs the ancestor swap against whichever source is given and reports what was left
   behind. Nothing here races: the topology is changed between the two calls. */
function escapeRun(source, label) {
  const helpers = slice(source, "function insideDirectory(", "function workspaceStatus(",
    "{ createdPathLedger, claimDirectory }", `${label}#ledger`);
  const publish = slice(source, "function atomicWriteJson(", "/* ---- project save revision",
    "{ atomicWriteJson }", `${label}#publish`).atomicWriteJson;

  const home = fs.mkdtempSync(path.join(TEMP, "escape-" + label + "-"));
  const workspace = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(workspace); fs.mkdirSync(dest);
  const sink = path.join(workspace, "sink"); fs.mkdirSync(sink);
  const ledger = helpers.createdPathLedger({
    realDestinationRoot: fs.realpathSync.native(dest), realSourceRoot: fs.realpathSync.native(workspace),
  });
  const slugDirectory = path.join(dest, "alpha");
  assert.strictEqual(helpers.claimDirectory(slugDirectory).created, true);
  ledger.directory(slugDirectory);

  fs.rmdirSync(slugDirectory);
  fs.symlinkSync(sink, slugDirectory, "junction");
  publish(path.join(slugDirectory, "project.json"), { migrated: true }, { backup: false, exclusive: true });
  const escapedFile = path.join(sink, "project.json");
  assert.strictEqual(fs.existsSync(escapedFile), true, `${label}: the fixture must actually escape`);

  let admitted = true;
  try { ledger.file(path.join(slugDirectory, "project.json")); } catch { admitted = false; }
  const receipts = [...ledger.receipts()];
  const rollback = ledger.unwind();
  return { escapedFile, admitted, receipts, rollback, orphaned: fs.existsSync(escapedFile) };
}

function escapedOwnershipControl() {
  const shipped = escapeRun(SHIPPED, "shipped");
  assert.strictEqual(shipped.receipts.length, 2,
    "the shipped build keeps the proof it created the escaped object: " + JSON.stringify(shipped.receipts));
  assert.strictEqual(shipped.receipts[1].escaped, true, "marked, not discarded");
  assert.strictEqual(shipped.orphaned, false, "and cleanup removes it");
  assert.strictEqual(shipped.rollback.escaped.length, 1);
  assert.strictEqual(shipped.rollback.escaped[0].removed, true);

  const mutated = escapeRun(applyMutations(SHIPPED, OWNERSHIP_DISCARDED_ON_ESCAPE), "mutated");
  assert.strictEqual(mutated.receipts.length, 1,
    "throwing before recording loses the receipt: " + JSON.stringify(mutated.receipts));
  assert.strictEqual(mutated.orphaned, true,
    "and the object this attempt provably created is orphaned where it landed");
  assert.deepStrictEqual([...(mutated.rollback.escaped || [])], [],
    "with nothing in the report to say it is there");
}

/* ==========================================================================
   NC-F11-8 — the exclusive publish, behaviourally.

   Until now this was pinned only by a source-text assertion, and on Windows that
   gap is invisible: renameSync also fails EPERM on a dangling reparse point, so the
   suite's own blocker fixtures cannot tell an exclusive publish from an overwriting
   one. The discriminating fixture is a destination document that is simply THERE.
   ========================================================================== */

function publishFrom(source, label) {
  return slice(source, "function atomicWriteJson(", "/* ---- project save revision",
    "{ atomicWriteJson }", label).atomicWriteJson;
}

function exclusivePublishControl() {
  const home = fs.mkdtempSync(path.join(TEMP, "publish-"));
  const occupied = (name) => {
    const dir = path.join(home, name); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "project.json");
    fs.writeFileSync(file, "ANOTHER WRITER'S DOCUMENT");
    return { dir, file };
  };

  /* Shipped: a destination document that already exists is never replaced, and the
     failed publish leaves no temp behind. */
  const shippedTarget = occupied("shipped");
  let refused = null;
  try { publishFrom(SHIPPED, "shipped#publish")(shippedTarget.file, { mine: true }, { backup: false, exclusive: true }); }
  catch (error) { refused = error; }
  assert(refused, "the shipped publish must refuse an occupied destination");
  assert.strictEqual(refused.code, "EEXIST", refused.message);
  assert.strictEqual(fs.readFileSync(shippedTarget.file, "utf8"), "ANOTHER WRITER'S DOCUMENT",
    "and must not have overwritten it");
  assert.deepStrictEqual(fs.readdirSync(shippedTarget.dir), ["project.json"],
    "and must not leave a temp beside it");

  /* Shipped: a dangling reparse point at the destination is refused rather than
     followed, and what it points at is never brought into existence. */
  const reparseDir = path.join(home, "reparse"); fs.mkdirSync(reparseDir, { recursive: true });
  const reparse = path.join(reparseDir, "project.json"), pointsAt = path.join(reparseDir, "no-such-target");
  fs.symlinkSync(pointsAt, reparse, "junction");
  let followed = null;
  try { publishFrom(SHIPPED, "shipped#reparse")(reparse, { mine: true }, { backup: false, exclusive: true }); }
  catch (error) { followed = error; }
  assert(followed, "the shipped publish must refuse a dangling reparse point");
  assert.strictEqual(fs.existsSync(pointsAt), false, "and must not create what it points at");
  assert.strictEqual(fs.lstatSync(reparse).isSymbolicLink(), true, "the reparse point itself is untouched");
  assert.deepStrictEqual(fs.readdirSync(reparseDir), ["project.json"], "and no temp survives");

  /* Mutated: drop the exclusivity and the guarantee goes with it. */
  const mutatedTarget = occupied("mutated");
  const mutated = publishFrom(applyMutations(SHIPPED, [{
    from: "      fs.copyFileSync(temp, file, fs.constants.COPYFILE_EXCL);",
    to: "      fs.copyFileSync(temp, file);",
  }]), "mutated#publish");
  mutated(mutatedTarget.file, { mine: true }, { backup: false, exclusive: true });
  assert.notStrictEqual(fs.readFileSync(mutatedTarget.file, "utf8"), "ANOTHER WRITER'S DOCUMENT",
    "a non-exclusive publish destroys a document it was never allowed to touch");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(mutatedTarget.file, "utf8")), { mine: true },
    "replacing it with its own");
}

/* ==========================================================================
   RUN
   ========================================================================== */

(async () => {
  console.log("F-11 negative controls\n");
  let caught = 0, broken = 0, missed = 0;

  for (const control of CONTROLS) {
    let source;
    try { source = applyMutations(SHIPPED, control.mutations); }
    catch (error) {
      broken += 1;
      console.log(`  NOT ARMED  ${control.id}  ${control.title}\n             ${error.message}`);
      continue;
    }

    try { control.shipped(await attemptAndRetry(SHIPPED, control.fixture)); }
    catch (error) {
      broken += 1;
      console.log(`  BROKEN     ${control.id}  ${control.title}`);
      console.log(`             the shipped source already fails this control: ${error.message}`);
      continue;
    }

    let damage = null;
    try { control.mutated(await attemptAndRetry(source, control.fixture)); }
    catch (error) { damage = error; }
    if (damage) {
      missed += 1;
      console.log(`  MISSED     ${control.id}  ${control.title}`);
      console.log(`             the defect was reintroduced and nothing showed it: ${damage.message}`);
      continue;
    }
    caught += 1;
    console.log(`  caught     ${control.id}  ${control.title}`);
  }

  for (const [id, title, fn] of [
    ["NC-F11-3b", "ledger containment rule removed", containmentControl],
    ["NC-F11-4 ", "lexical containment restored — writes into the source workspace", junctionControl],
    ["NC-F11-5 ", "creation ownership inferred instead of proved", creationOwnershipControl],
    ["NC-F11-6 ", "EPERM read as occupied — a junctioned source project vanishes silently", epermAsSkipControl],
    ["NC-F11-7 ", "ownership discarded when a creation escapes — the object is orphaned", escapedOwnershipControl],
    ["NC-F11-8 ", "project document publish not exclusive — an existing document is destroyed", exclusivePublishControl],
  ]) {
    try { await fn(); caught += 1; console.log(`  caught     ${id}  ${title}`); }
    catch (error) { broken += 1; console.log(`  BROKEN     ${id}  ${title}\n             ${error.message}`); }
  }

  console.log(`\nF-11 negative controls: ${caught} caught · ${missed} missed · ${broken} broken; provider calls: 0.`);
  fs.rmSync(TEMP, { recursive: true, force: true });
  if (missed || broken) process.exit(1);
})().catch((error) => {
  console.error("\nF-11 negative controls FAILED\n", error);
  process.exit(1);
});

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
const SERVER = path.join(ROOT, "server.js");
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
  const file = isShipped ? SERVER : path.join(ROOT, `server-f11-control-${process.pid}-${scratchCounter++}.tmp`);
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
      assert(rollback.leftover.includes(path.join(result.dest, "alpha")),
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

const CONTAINMENT_RULE =
  '    if (!insideRealDirectory(realDestinationRoot, target)) return "is not inside the destination workspace";\n'
  + '    if (sameRealPath(realParent, realSourceRoot) || insideRealDirectory(realSourceRoot, realParent))\n'
  + '      return "physically resides inside the source workspace";\n'
  + '    if (!insideRealDirectory(realDestinationRoot, realParent) && !sameRealPath(realParent, realDestinationRoot))\n'
  + '      return "physically resides outside the destination workspace";\n'
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
  const shipped = ledgerFrom(SHIPPED);
  assert.throws(() => shipped(roots).file(sourceDocument),
    /does not own/, "the shipped ledger must refuse a source path");
  assert.throws(() => shipped(roots).file(outside),
    /does not own/, "the shipped ledger must refuse a path outside the destination");

  const mutated = ledgerFrom(applyMutations(SHIPPED, [{ from: CONTAINMENT_RULE, to: '    return "";' }]));
  const unguarded = mutated({
    realDestinationRoot: fs.realpathSync.native(dest),
    realSourceRoot: fs.realpathSync.native(source),
  });
  unguarded.file(sourceDocument);
  unguarded.file(outside);
  assert.deepStrictEqual([...unguarded.paths()], [path.resolve(sourceDocument), path.resolve(outside)],
    "without the rule, a source path and a path outside the destination are both admitted");

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

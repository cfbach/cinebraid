"use strict";

/* UNTRUSTED_IMPORT — CREATE_ONLY publication.
 *
 * THE DEFECT THIS ENDS. The Authority Write Seam classifies UNTRUSTED_IMPORT as
 * CREATE_ONLY, and both of its shipped callers — importing a CineBraid project and
 * starting a blank one — chose a slug like this:
 *
 *     while (fs.existsSync(candidate)) candidate = nextSuffix(candidate);
 *
 * That is a pre-check. It answers for the destination as it was at that instant and
 * holds nothing, and the publish underneath it was renameSync, which replaces in
 * silence. A document created at the chosen path in between was therefore destroyed
 * and the request was told it had created a project. Reproduced on the foundation
 * through both routes: the competing writer's document gone, HTTP 200 {ok:true},
 * and one physical project document for two successful creations.
 *
 * WHAT REPLACES IT. The publish is COPYFILE_EXCL, taken from the canonical
 * CREATE_ONLY classification rather than from a second list beside it, and a lost
 * publish answers with the same typed refusal the pre-check already had for a taken
 * destination. The route then does what it already did about a taken name: takes the
 * next one.
 *
 * NO TIMING CONSTANT. The competing writer waits for a CONDITION the shipped publish
 * itself creates — atomicWriteJson's temp file appearing in the destination folder.
 * At that moment the route has chosen its slug, ensureDirs has run, and the seam has
 * already answered "absent"; the publish has not happened. Every scenario asserts
 * that the interleave actually occurred before asserting anything about it, so a
 * window that failed to open fails the suite instead of passing vacuously.
 *
 * Fixtures are isolated under os.tmpdir(). No provider is configured or contacted.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { startCineBraidServer } = require("./fixtures/mock-civitai");
const { WRITE_CLASSES, isCreateOnlyWriteClass } = require("../src/authority/authority-write-seam");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-untrusted-import-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const CONFIG_PATH = path.join(TEMP, "config.json");

let server = null;
const passed = [];

/* Big enough that the publish spends real time in write+fsync before it copies, which
   is what makes the window an observable state rather than a coin toss. */
const BULK = "S".repeat(9 * 1024 * 1024);
const FOREIGN = JSON.stringify({
  THE_OTHER_WRITER: true,
  meta: { title: "Published by someone else" },
}, null, 2);

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const slugFor = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
const dirFor = (slug) => path.join(PROJECTS_ROOT, slug);
const fileFor = (slug) => path.join(dirFor(slug), "project.json");
const storedText = (slug) => fs.readFileSync(fileFor(slug), "utf8");
const storedJson = (slug) => JSON.parse(storedText(slug));

function sourceProject(title, { bulk = false } = {}) {
  return {
    meta: {
      title, format: "Short film", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6",
      aiPolicy: "project-default", world: { setting: bulk ? BULK : "A quiet coastal town." },
    },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [],
    mediaAssets: [], jobs: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
    scenes: [{ id: "SC-01", title: "Arrival", whatHappens: "She arrives.", howItFeels: "Still." }],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "Wide", desc: "The harbour, wide.", positioning: "Locked frame.",
      dur: 5, workflowStatus: "DRAFT", characters: [], codes: [], risks: [], candidateFiles: [],
      creationBrief: {}, keyframes: [], clips: [],
    }],
  };
}

async function scenario(id, body) {
  await body();
  passed.push(id);
  console.log(`  ${id} PASS`);
}

/* ---------------------------------------------------------------------------
   THE INTERLEAVE

   `plant` runs in THIS process — a genuinely different process from the server —
   at the one moment nothing the route can check could see it. The poll yields to
   the event loop between turns because the request it is racing is dispatched on
   that loop; a synchronous spin here would hold the fetch and there would be no
   race to win.
   --------------------------------------------------------------------------- */
async function plantInPublishWindow(dir, file, plant, budgetMs = 30000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { entries = []; }
    if (entries.some((name) => name.endsWith(".tmp"))) {
      try { plant(); return "planted"; }
      catch (error) { return "could-not-plant:" + (error?.code || error?.message); }
    }
    if (fs.existsSync(file)) return "published-before-the-window-opened";
    if (Date.now() > deadline) return "no-temp-file-appeared";
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const plantDocument = (file) => () => fs.writeFileSync(file, FOREIGN, { flag: "wx" });
const plantDanglingJunction = (file) => () =>
  fs.symlinkSync(path.join(path.dirname(file), "no-such-target"), file, "junction");

function requireInterleave(outcome, what) {
  assert.strictEqual(outcome, "planted",
    `${what}: the competing publication had to land inside the window, got "${outcome}"`);
}

/* The window is a state, not a duration — but it still has to open. If the publish
   finished before this process was next scheduled, the premise of the scenario did
   not hold and there is nothing to assert about it, so the attempt is retried under
   a fresh title. A machine that never opens the window fails loudly; it never passes
   vacuously. */
async function contested(what, attempt, tries = 4) {
  const misses = [];
  for (let index = 0; index < tries; index++) {
    const title = index ? `${what} Take ${index + 1}` : what;
    const outcome = await attempt(title);
    if (outcome.interleave === "planted") return outcome;
    misses.push(`${title}: ${outcome.interleave}`);
  }
  throw new Error(`${what}: the competing publication never landed inside the window — ${misses.join("; ")}`);
}

/* ---------------------------------------------------------------------------
   THE TWO SHIPPED CALLERS

   Each returns a pending response, so a scenario can race the publish before
   awaiting it.
   --------------------------------------------------------------------------- */
function beginBlankProject(title, { bulk = false } = {}) {
  return server.request("/api/projects/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      format: "Short film",
      aspectRatio: "2.39:1",
      globalStylePrompt: bulk ? BULK : "Muted daylight, long lenses.",
      globalNegativePrompt: "No lens flare.",
      worldSetting: "A quiet coastal town.",
      firstScene: "Arrival",
    }),
  });
}

async function previewImport(project) {
  const preview = await server.request("/api/projects/preview-import-json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project }),
  });
  assert.strictEqual(preview.status, 200, preview.text.slice(0, 400));
  return preview.body;
}

function beginImport(preview) {
  return server.request("/api/projects/import-json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ previewToken: preview.previewToken, previewHash: preview.previewHash }),
  });
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

/* ===========================================================================
   UI-1 — IMPORT: ORDINARY CREATE
   =========================================================================== */
async function ui1() {
  const title = "Ui One Harbour";
  const slug = slugFor(title);
  const source = sourceProject(title);
  const preview = await previewImport(source);
  const result = await beginImport(preview);

  assert.strictEqual(result.status, 200, result.text.slice(0, 400));
  assert.strictEqual(result.body.ok, true);
  assert.strictEqual(result.body.slug, slug, "an uncontested import keeps the slug its title asks for");
  assert.strictEqual(result.body.previewHash, preview.previewHash, "success semantics are unchanged");
  assert(Array.isArray(result.body.warnings), "and still carries the review warnings");
  assert(result.body.counts && typeof result.body.counts === "object", "and the builder counts");

  /* The intended bytes, exactly: the document the import produced, in the canonical
     form the writer emits, whole — not truncated, not re-encoded, nothing appended. */
  const bytes = storedText(slug);
  const document = JSON.parse(bytes);
  assert.strictEqual(bytes, JSON.stringify(document, null, 2),
    "the published bytes must be exactly the document, canonically serialised");
  assert.strictEqual(document.meta.title, title);
  assert.deepStrictEqual(document.scenes.map((row) => row.id), ["SC-01"]);
  assert.deepStrictEqual(document.shots.map((row) => row.id), ["SH-01"]);
  assert.strictEqual(document.shots[0].desc, "The harbour, wide.");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(document, "productionAuthority"), false,
    "an untrusted import still arrives with no production authority");
  assert.strictEqual(readConfig().activeProject, slug, "and the imported project becomes the active one");

  for (const name of ["anchors", "plates", "media", "shots", "docs"])
    assert(fs.existsSync(path.join(dirFor(slug), name)), `the project folder still gets ${name}/`);
  assert.deepStrictEqual(fs.readdirSync(dirFor(slug)).filter((name) => name.endsWith(".tmp")), [],
    "a successful publish leaves no temp behind");
  assert.strictEqual(fs.existsSync(fileFor(slug) + ".bak"), false,
    "and writes no backup, because a create-only publish has nothing to preserve");
}

/* ===========================================================================
   UI-2 — NEW BLANK PROJECT: ORDINARY CREATE
   =========================================================================== */
async function ui2() {
  const title = "Ui Two Blank";
  const slug = slugFor(title);
  const result = await beginBlankProject(title);

  assert.strictEqual(result.status, 200, result.text.slice(0, 400));
  assert.deepStrictEqual(result.body, { ok: true, slug }, "the response shape is unchanged");

  const document = storedJson(slug);
  assert.strictEqual(document.meta.title, title);
  assert.strictEqual(document.meta.format, "Short film");
  assert.strictEqual(document.meta.aspectRatio, "2.39:1");
  assert.strictEqual(document.meta.globalStylePrompt, "Muted daylight, long lenses.");
  assert.strictEqual(document.meta.globalNegativePrompt, "No lens flare.");
  assert.strictEqual(document.meta.world.setting, "A quiet coastal town.");
  assert.strictEqual(document.meta.world.reject, "No lens flare.");
  assert.deepStrictEqual(document.meta.styleBlocks.map((row) => row.id), ["global-style"],
    "the offered global look is still written as a style block");
  assert.deepStrictEqual(document.scenes.map((row) => row.title), ["Arrival"],
    "and the first scene is still created");
  assert.strictEqual(document.shots.length, 0, "a blank project still starts with no shots");
  assert.strictEqual(readConfig().activeProject, slug);
  assert.deepStrictEqual(fs.readdirSync(dirFor(slug)).filter((name) => name.endsWith(".tmp")), []);
}

/* ===========================================================================
   UI-3 — IMPORT: CONCURRENT COLLISION
   =========================================================================== */
async function ui3() {
  const { title, source, result, interleave } = await contested("Ui Three Contested", async (attemptTitle) => {
    const attemptSlug = slugFor(attemptTitle);
    const attemptSource = sourceProject(attemptTitle, { bulk: true });
    const pending = beginImport(await previewImport(attemptSource));
    const outcome = await plantInPublishWindow(
      dirFor(attemptSlug), fileFor(attemptSlug), plantDocument(fileFor(attemptSlug)));
    return { title: attemptTitle, source: attemptSource, result: await pending, interleave: outcome };
  });
  const slug = slugFor(title), retrySlug = slug + "-2";
  requireInterleave(interleave, "UI-3");

  /* 1 — the first publication survives byte-identically. */
  assert.strictEqual(storedText(slug), FOREIGN, "the document already published must be untouched");
  assert.strictEqual(sha(storedText(slug)), sha(FOREIGN), "byte for byte");
  assert.strictEqual(fs.existsSync(fileFor(slug) + ".bak"), false,
    "and must not have been copied aside either");

  /* 2 — the second succeeds under the next deterministic suffix. */
  assert.strictEqual(result.status, 200, result.text.slice(0, 400));
  assert.strictEqual(result.body.ok, true);
  assert.strictEqual(result.body.slug, retrySlug, "the loser retries at the next suffix, as a taken name always did");
  assert.strictEqual(storedJson(retrySlug).meta.title, title, "and its own document is there");

  /* 3 — never two successes over one physical document. */
  assert.notStrictEqual(result.body.slug, slug);
  assert.notStrictEqual(sha(storedText(retrySlug)), sha(FOREIGN),
    "the two writers hold two different documents");
  assert.deepStrictEqual(fs.readdirSync(dirFor(slug)).filter((name) => name.endsWith(".tmp")), [],
    "the refused publish leaves no temp beside the winner");

  /* 4 — the retried import published exactly what an uncontested one publishes. The
     control imports the same source project with nothing racing it, so any byte the
     collision path altered would show up here. */
  const control = await beginImport(await previewImport(source));
  assert.strictEqual(control.body.slug, slug + "-3", control.text.slice(0, 300));
  assert.strictEqual(storedText(retrySlug), storedText(slug + "-3"),
    "losing a race must not change one byte of what the import writes");
}

/* ===========================================================================
   UI-4 — NEW BLANK PROJECT: CONCURRENT COLLISION
   =========================================================================== */
async function ui4() {
  const { title, result, interleave } = await contested("Ui Four Contested", async (attemptTitle) => {
    const attemptSlug = slugFor(attemptTitle);
    const pending = beginBlankProject(attemptTitle, { bulk: true });
    const outcome = await plantInPublishWindow(
      dirFor(attemptSlug), fileFor(attemptSlug), plantDocument(fileFor(attemptSlug)));
    return { title: attemptTitle, result: await pending, interleave: outcome };
  });
  const slug = slugFor(title), retrySlug = slug + "-2";
  requireInterleave(interleave, "UI-4");

  assert.strictEqual(storedText(slug), FOREIGN, "the document already published must be untouched");
  assert.strictEqual(result.status, 200, result.text.slice(0, 400));
  assert.deepStrictEqual(result.body, { ok: true, slug: retrySlug });

  const document = storedJson(retrySlug);
  assert.strictEqual(document.meta.title, title, "the blank project is created, under its own name");
  assert.strictEqual(document.meta.globalStylePrompt.length, BULK.length, "complete, not truncated");
  assert.strictEqual(readConfig().activeProject, retrySlug,
    "and the project that was actually created is the one made active");
  assert.deepStrictEqual(fs.readdirSync(dirFor(slug)).filter((name) => name.endsWith(".tmp")), []);
}

/* ===========================================================================
   UI-5 — PRE-EXISTING TARGET

   The destination is occupied before the request arrives, so the ordinary slug
   scan sees it. Existing route behaviour: take the next suffix. Nothing about the
   existing project may change.
   =========================================================================== */
async function ui5() {
  for (const [label, title, begin] of [
    ["import", "Ui Five Import", async (name) => beginImport(await previewImport(sourceProject(name)))],
    ["new", "Ui Five New", async (name) => beginBlankProject(name)],
  ]) {
    const slug = slugFor(title);
    fs.mkdirSync(dirFor(slug), { recursive: true });
    fs.writeFileSync(fileFor(slug), FOREIGN);
    const before = { bytes: fs.readFileSync(fileFor(slug)), mtimeNs: fs.statSync(fileFor(slug), { bigint: true }).mtimeNs };

    const result = await begin(title);
    assert.strictEqual(result.status, 200, `${label}: ${result.text.slice(0, 300)}`);
    assert.strictEqual(result.body.slug, slug + "-2", `${label}: the existing project keeps its slug`);

    const after = fs.statSync(fileFor(slug), { bigint: true });
    assert(before.bytes.equals(fs.readFileSync(fileFor(slug))), `${label}: the existing document is byte-identical`);
    assert.strictEqual(after.mtimeNs, before.mtimeNs, `${label}: and was not even touched`);
    assert.strictEqual(fs.existsSync(fileFor(slug) + ".bak"), false, `${label}: nor copied aside`);
    assert.strictEqual(storedJson(slug + "-2").meta.title, title, `${label}: the new project is beside it`);
  }
}

/* ===========================================================================
   UI-6 — FAILED EXCLUSIVE PUBLISH THAT IS NOT A COLLISION

   A dangling reparse point planted in the same window. `existsSync` reports it as
   absent, so nothing before the publish can see it, and COPYFILE_EXCL answers
   EPERM rather than EEXIST — which must NOT be read as an occupied destination,
   because on Windows EPERM also covers a source that could not be read at all.
   =========================================================================== */
async function ui6() {
  const { title, result, interleave } = await contested("Ui Six Blocked", async (attemptTitle) => {
    const attemptBlocker = fileFor(slugFor(attemptTitle));
    const pending = beginBlankProject(attemptTitle, { bulk: true });
    const outcome = await plantInPublishWindow(
      dirFor(slugFor(attemptTitle)), attemptBlocker, plantDanglingJunction(attemptBlocker));
    return { title: attemptTitle, result: await pending, interleave: outcome };
  });
  const slug = slugFor(title);
  const blocker = fileFor(slug), pointsAt = path.join(dirFor(slug), "no-such-target");
  requireInterleave(interleave, "UI-6");

  assert.strictEqual(fs.existsSync(blocker), false, "the blocker must be invisible to a stat-based check");
  assert.strictEqual(fs.lstatSync(blocker).isSymbolicLink(), true, "…while genuinely being there");

  /* No false success, and the typed failure survives to the caller. */
  assert.strictEqual(result.status, 500, result.text.slice(0, 400));
  assert.strictEqual(result.body.ok, false);
  assert.strictEqual(result.body.code, "PROJECT_PERSISTENCE_FAILED",
    "a publish that failed for any reason other than an occupied destination is a failure, not a collision: "
    + JSON.stringify(result.body));
  assert.strictEqual(result.body.slug, slug, "and it names the project it failed on");

  /* No damage, and nothing brought into existence through the reparse point. */
  assert.strictEqual(fs.existsSync(pointsAt), false, "nothing may be created at the far end of the blocker");
  assert.strictEqual(fs.lstatSync(blocker).isSymbolicLink(), true, "the blocker itself is untouched");
  assert.strictEqual(fs.existsSync(fileFor(slug + "-2")), false,
    "an EPERM must not be retried as though the name were merely taken");
  assert.deepStrictEqual(fs.readdirSync(dirFor(slug)).filter((name) => name.endsWith(".tmp")), [],
    "and the failed publish cleans up its temp");
  assert.notStrictEqual(readConfig().activeProject, slug,
    "a project that was never created must not become the active one");
}

/* ===========================================================================
   UI-7 — THE MECHANISM, AND WHERE IT COMES FROM

   Exclusivity is derived from the canonical CREATE_ONLY classification. There is
   one such list, in the seam, and the caller that owns filesystem mechanics asks
   it rather than keeping a second copy — which is the drift that produced this
   defect in the first place.
   =========================================================================== */
function ui7() {
  const createOnly = [WRITE_CLASSES.UNTRUSTED_IMPORT, WRITE_CLASSES.WORKSPACE_MIGRATION];
  for (const writeClass of Object.values(WRITE_CLASSES))
    assert.strictEqual(isCreateOnlyWriteClass(writeClass), createOnly.includes(writeClass),
      `${writeClass} is classified create-only by exactly one authority`);
  for (const junk of ["", null, undefined, "UNTRUSTED", "untrusted_import"])
    assert.strictEqual(isCreateOnlyWriteClass(junk), false, `${JSON.stringify(junk)} is not a write class`);

  const seam = fs.readFileSync(path.join(ROOT, "src/authority/authority-write-seam.js"), "utf8");
  assert.strictEqual((seam.match(/const CREATE_ONLY = new Set\(/g) || []).length, 1,
    "there is exactly one CREATE_ONLY list");
  assert(/isCreateOnlyWriteClass\(writeClass\) && text\(error\?\.code\) === "EEXIST"/.test(seam),
    "and a lost exclusive publish is recognised from EEXIST alone");

  const serverSource = fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8");
  const options = serverSource.slice(serverSource.indexOf("atomicWriteJson(file, project, {"));
  const wiring = options.slice(0, options.indexOf("});") + 3);
  assert(/exclusive: isCreateOnlyWriteClass\(context\.writeClass\)/.test(wiring),
    "the publish asks the classifier whether it must be exclusive");
  assert(/backup: !isCreateOnlyWriteClass\(context\.writeClass\)/.test(wiring),
    "and so does the backup decision, rather than restating the same pair");
  assert.strictEqual(/WRITE_CLASSES\.(UNTRUSTED_IMPORT|WORKSPACE_MIGRATION)/.test(wiring), false,
    "no second CREATE_ONLY list beside the first: " + wiring);

  /* The publication primitive itself, and what it is deliberately not. */
  const publish = serverSource.slice(serverSource.indexOf("function atomicWriteJson("), serverSource.indexOf("/* ---- project save revision"));
  assert(/fs\.copyFileSync\(temp, file, fs\.constants\.COPYFILE_EXCL\)/.test(publish),
    "an exclusive publish is COPYFILE_EXCL");
  assert.strictEqual(/fs\.linkSync\(/.test(publish), false,
    "and never a hard link, which exFAT and FAT32 do not have");
  assert(/if \(exclusive\)[\s\S]*?\} else fs\.renameSync\(temp, file\);/.test(publish),
    "rename remains the publication for every class that is allowed to replace");
}

/* ===========================================================================
   RUN
   =========================================================================== */
async function main() {
  try {
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      activeProject: "", accounts: [], assistant: { provider: "none", visionProvider: "none" },
      workspace: { projectRoot: PROJECTS_ROOT.split(path.sep).join("/"), mediaRoot: "", outputRoot: "", backupRoot: "" },
    }, null, 2));
    server = await startCineBraidServer({
      CINEBRAID_CONFIG_PATH: CONFIG_PATH,
      CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
      FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "",
    });

    console.log("UNTRUSTED_IMPORT exclusive publish\n");
    await scenario("UI-1", ui1);
    await scenario("UI-2", ui2);
    await scenario("UI-3", ui3);
    await scenario("UI-4", ui4);
    await scenario("UI-5", ui5);
    await scenario("UI-6", ui6);
    await scenario("UI-7", async () => ui7());

    assert.deepStrictEqual(passed, ["UI-1", "UI-2", "UI-3", "UI-4", "UI-5", "UI-6", "UI-7"]);
    console.log(`\nUNTRUSTED_IMPORT exclusive publish: ${passed.length}/7 passed; provider calls: 0.`);
  } finally {
    server?.stop();
    fs.rmSync(TEMP, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  if (server?.output) console.error(`--- server output ---\n${server.output}`);
  process.exitCode = 1;
});

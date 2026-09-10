"use strict";

/* PSS-1 NEGATIVE CONTROLS.
 *
 * The positive suite says productions move out of the application folder without
 * anybody losing anything. Each control here reintroduces one specific way that could
 * be false, and requires the exact damage back.
 *
 * Every control runs twice. PHASE 0 runs the shipped source and requires the damage to
 * be ABSENT — a control that "detects" something already broken detects nothing.
 * PHASE 1 runs the mutated source and requires it PRESENT. Each mutation is proved to
 * match the shipped text exactly once, so a needle that has drifted can never be
 * mistaken for a defect that came back.
 *
 * NOTHING HERE TOUCHES REAL WORK. The resolution controls run in a realm against a
 * fabricated application directory under os.tmpdir(). The server control runs against a
 * disposable directory. The pristine-sample control operates on a COPY of the shipped
 * sample and never on the tracked one — a control that proves damage is detectable must
 * not be the thing that does the damage.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const { ROOT, freePort } = require("./fixtures/mock-civitai");

const SERVER = path.join(ROOT, "src/server/server.js");
const SHIPPED = fs.readFileSync(SERVER, "utf8").replace(/\r\n/g, "\n");
const BUNDLED_SAMPLE = path.join(ROOT, "projects", "cinebraid-sample");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-pss1-nc-"));
const SCRATCH = new Set();

process.on("exit", () => { for (const file of SCRATCH) { try { fs.unlinkSync(file); } catch {} } });

const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function treeHash(dir) {
  const out = {};
  (function walk(current, prefix) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name), rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out[rel] = sha(full);
    }
  })(dir, "");
  return out;
}

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

/* ---- the resolution block, from whichever source, in a controlled world ---- */

function resolutionIn(source, { appRoot, env = {} }) {
  const start = source.indexOf("const APP_ROOT =");
  const end = source.indexOf("function configuredWorkspacePath(");
  assert(start > 0 && end > start, "the project-root resolution block must be locatable");
  const sandbox = {
    fs, path, console, JSON,
    __dirname: path.join(appRoot, "src", "server"),
    process: { ...process, env: { ...env } },
    module: { exports: {} }, exports: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(start, end)
    + "\nmodule.exports = { INSTALL_PROJECTS_ROOT, USER_PROJECTS_ROOT, DEFAULT_PROJECTS_ROOT,"
    + " INSTALL_PROJECTS_STATE, projectRootSource, pathIsInsideInstall, projectsRoot };",
    sandbox, { filename: "server.js#project-root-resolution" },
  );
  return sandbox.module.exports;
}

function fakeInstall(label, build = () => {}) {
  const appRoot = fs.mkdtempSync(path.join(TEMP, `${label}-`));
  fs.mkdirSync(path.join(appRoot, "src", "server"), { recursive: true });
  const projects = path.join(appRoot, "projects");
  fs.mkdirSync(projects, { recursive: true });
  build({ appRoot, projects });
  return { appRoot, projects };
}
function writeDocumentAt(dir, title) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ meta: { title } }, null, 2) + "\n");
}
const HOME = { USERPROFILE: path.join(TEMP, "home"), HOME: path.join(TEMP, "home") };

/* What a user would actually see: the projects CineBraid finds where it decided to
   look. Deliberately re-derived here from the resolved root rather than read out of
   the server, because "what is on the list" is the thing being claimed. */
function projectsVisibleAt(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "project.json")))
      .map((entry) => entry.name).sort();
  } catch { return []; }
}

/* ==========================================================================
   NC-PSS1-1 — the legacy survey removed: an existing install loses its projects
   ========================================================================== */

const IGNORE_THE_LEGACY_ROOT = [{
  from: "const DEFAULT_PROJECTS_ROOT = ENV_PROJECTS_ROOT\n"
    + "  || (INSTALL_PROJECTS_STATE.holdsProductions ? INSTALL_PROJECTS_ROOT : USER_PROJECTS_ROOT);",
  to: "const DEFAULT_PROJECTS_ROOT = ENV_PROJECTS_ROOT || USER_PROJECTS_ROOT;",
}];

function legacyRootControl() {
  const build = ({ projects }) => {
    writeDocumentAt(path.join(projects, "cinebraid-sample"), "Sample");
    writeDocumentAt(path.join(projects, "a-real-film"), "A Real Film");
    writeDocumentAt(path.join(projects, "another-film"), "Another Film");
  };

  /* PHASE 0 — shipped: the update changes nothing the user can see. */
  const kept = fakeInstall("legacy-shipped", build);
  const shipped = resolutionIn(SHIPPED, { appRoot: kept.appRoot, env: HOME });
  assert.strictEqual(shipped.projectsRoot({}), kept.projects);
  assert.deepStrictEqual(projectsVisibleAt(shipped.projectsRoot({})),
    ["a-real-film", "another-film", "cinebraid-sample"],
    "shipped: an existing install still sees every project it had");
  assert.strictEqual(shipped.projectRootSource({}), "legacy-install");

  /* PHASE 1 — the defect this requirement exists to prevent. */
  const lost = fakeInstall("legacy-mutated", build);
  const mutated = resolutionIn(applyMutations(SHIPPED, IGNORE_THE_LEGACY_ROOT), { appRoot: lost.appRoot, env: HOME });
  assert.notStrictEqual(mutated.projectsRoot({}), lost.projects,
    "moving the default without looking points CineBraid somewhere else");
  assert.deepStrictEqual(projectsVisibleAt(mutated.projectsRoot({})), [],
    "and the project list is empty — which is what 'where did my film go' looks like");
  /* The films are still on disk. That is what makes it a data-LOSS scare rather than
     data loss, and it is exactly why the notice has to exist instead. */
  assert.deepStrictEqual(projectsVisibleAt(lost.projects),
    ["a-real-film", "another-film", "cinebraid-sample"],
    "while the productions are still sitting where they always were");
}

/* ==========================================================================
   NC-PSS1-2 — the sample counted as a production: every install pinned inside
   ========================================================================== */

const COUNT_THE_SAMPLE = [{
  from: "    if (entry.name === SAMPLE_PROJECT_SLUG) continue;",
  to: "    if (false) continue;",
}];

function sampleCountedControl() {
  const build = ({ projects }) => writeDocumentAt(path.join(projects, "cinebraid-sample"), "Sample");

  const fresh = fakeInstall("sample-shipped", build);
  const shipped = resolutionIn(SHIPPED, { appRoot: fresh.appRoot, env: HOME });
  assert.strictEqual(shipped.projectRootSource({}), "default", "shipped: a bundled sample is not a production");
  assert.strictEqual(shipped.pathIsInsideInstall(shipped.projectsRoot({})), false,
    "shipped: so a fresh install keeps projects outside the application");

  const pinned = fakeInstall("sample-mutated", build);
  const mutated = resolutionIn(applyMutations(SHIPPED, COUNT_THE_SAMPLE), { appRoot: pinned.appRoot, env: HOME });
  assert.strictEqual(mutated.projectRootSource({}), "legacy-install",
    "counting the sample makes every install look legacy");
  assert.strictEqual(mutated.projectsRoot({}), pinned.projects);
  assert.strictEqual(mutated.pathIsInsideInstall(mutated.projectsRoot({})), true,
    "which pins a brand-new install's work inside the application folder — the defect, permanently");
}

/* ==========================================================================
   NC-PSS1-3 — the test-isolation refusal removed
   ========================================================================== */

const DISARM_TEST_ISOLATION = [{
  from: "refuseTestRunInsideTheInstall();",
  to: "/* refuseTestRunInsideTheInstall(); */",
}];

let scratchCounter = 0;
async function startFrom(source, env) {
  const isShipped = source === SHIPPED;
  const file = isShipped ? SERVER : path.join(path.dirname(SERVER), `server-pss1-control-${process.pid}-${scratchCounter++}.tmp`);
  if (!isShipped) { fs.writeFileSync(file, source); SCRATCH.add(file); }
  const port = await freePort();
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), NODE_ENV: "",
      FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "", ...env,
    },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const finish = (started) => {
    if (!isShipped) { try { fs.unlinkSync(file); } catch {} SCRATCH.delete(file); }
    return { started, output: () => output, child, exited };
  };
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/me`)).ok) return finish(true); }
    catch { /* not up yet */ }
    if (child.exitCode !== null) { await exited; return finish(false); }
    if (Date.now() > deadline) { child.kill(); await exited; throw new Error(`neither started nor exited:\n${output}`); }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function testIsolationControl() {
  /* Inside the application, disposable, and under a name .gitignore already covers. */
  const probe = path.join(ROOT, "pss1-nc-isolation-probe.tmp");
  const configPath = path.join(TEMP, "nc-config.json");
  fs.mkdirSync(probe, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: false } }, activeProject: "",
  }, null, 2));
  const env = { CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: probe, CINEBRAID_TEST_MODE: "1" };

  try {
    const shipped = await startFrom(SHIPPED, env);
    assert.strictEqual(shipped.started, false, "shipped: a declared test run must refuse this root");
    assert(/refused to start/i.test(shipped.output()), "shipped: and say why");

    const mutated = await startFrom(applyMutations(SHIPPED, DISARM_TEST_ISOLATION), env);
    assert.strictEqual(mutated.started, true,
      "without the refusal a test run happily resolves into the application checkout: " + mutated.output());
    assert.strictEqual(/refused to start/i.test(mutated.output()), false, "and says nothing about it");
    mutated.child.kill();
    await mutated.exited;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

/* ==========================================================================
   NC-PSS1-4 — the pristine-sample check can fail

   Run against a COPY. The positive suite's strongest claim is that installing the
   sample leaves the shipped one byte-identical; that claim is worth exactly as much
   as the comparison behind it, and this proves the comparison notices.
   ========================================================================== */

function pristineSampleControl() {
  const copy = path.join(TEMP, "sample-copy");
  fs.cpSync(BUNDLED_SAMPLE, copy, { recursive: true });
  const before = treeHash(copy);
  assert.deepStrictEqual(treeHash(copy), before, "an untouched tree compares equal");
  assert(Object.keys(before).length >= 11, "and the sample is not an empty tree: " + Object.keys(before).length);

  /* A changed byte in a project document. */
  const document = path.join(copy, "project.json");
  const original = fs.readFileSync(document);
  fs.writeFileSync(document, Buffer.concat([original, Buffer.from(" ")]));
  assert.notDeepStrictEqual(treeHash(copy), before, "an edited document must be detected");
  fs.writeFileSync(document, original);
  assert.deepStrictEqual(treeHash(copy), before, "and restoring it must compare equal again");

  /* A same-size change in a media file, which only a hash can see. */
  const media = path.join(copy, "anchors", "CHAR-COURIER-FRONT.png");
  const bytes = fs.readFileSync(media);
  const flipped = Buffer.from(bytes); flipped[flipped.length - 1] = flipped[flipped.length - 1] ^ 0xff;
  fs.writeFileSync(media, flipped);
  assert.notDeepStrictEqual(treeHash(copy), before, "a same-size media change must be detected");
  fs.writeFileSync(media, bytes);

  /* A removed file. */
  fs.unlinkSync(media);
  assert.notDeepStrictEqual(treeHash(copy), before, "a removed file must be detected");
  fs.writeFileSync(media, bytes);
  assert.deepStrictEqual(treeHash(copy), before, "the fixture is restored");

  /* And the tracked sample itself is exactly as it was found. */
  assert.strictEqual(fs.existsSync(path.join(BUNDLED_SAMPLE, "project.json")), true);
}

/* ==========================================================================
   NC-PSS1-5 — the legacy sentence can lose the half that matters

   PS-10 asserts what Settings prints. That is only worth something if a weakened
   sentence fails it — and the sentence has one clause doing the real work. "Your
   projects are inside the application folder" on its own reads as a fault report;
   "and CineBraid has changed nothing" is what stops it reading as data loss. A
   person who believes their films have already been moved will start moving files
   by hand, which is the outcome the whole slice exists to avoid.
   ========================================================================== */

const SETTINGS = path.join(ROOT, "public/settings.js");
const SHIPPED_SETTINGS = fs.readFileSync(SETTINGS, "utf8").replace(/\r\n/g, "\n");

const DROP_THE_REASSURANCE = [{
  from: "CineBraid is still opening them from there and has changed nothing. ",
  to: "",
}];

function describeFrom(source) {
  const start = source.indexOf("const WORKSPACE_ROOT_STATE = {");
  const end = source.indexOf("window.refreshWorkspaceStatus = async () =>");
  assert(start > 0 && end > start, "the workspace state copy must be locatable in settings.js");
  const sandbox = { module: { exports: {} }, exports: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + "\nmodule.exports = { describeWorkspaceRoot };",
    sandbox, { filename: "settings.js#workspace-root-copy" });
  return sandbox.module.exports.describeWorkspaceRoot;
}

const LEGACY_STATUS = {
  projectRoot: "C:/CineBraid/CineBraid-Source/projects",
  projectRootSource: "legacy-install",
  rootInsideInstall: true,
  legacyInstallRoot: { active: true, productions: 2, archived: 1, trashed: 0 },
};

function settingsCopyControl() {
  const shipped = describeFrom(SHIPPED_SETTINGS)(LEGACY_STATUS);
  assert(shipped.includes("has changed nothing"), "shipped: the reassurance must be there");
  assert(shipped.includes("the originals stay where they are"), "shipped: and what moving would do");

  const mutated = describeFrom(applyMutations(SHIPPED_SETTINGS, DROP_THE_REASSURANCE))(LEGACY_STATUS);
  assert.strictEqual(mutated.includes("has changed nothing"), false,
    "the mutation must actually remove it: " + mutated);
  assert(mutated.includes("inside the CineBraid application folder"),
    "leaving a sentence that still reports the problem and no longer says nothing was done");
}

/* ==========================================================================
   RUN
   ========================================================================== */

(async () => {
  console.log("PSS-1 negative controls\n");
  let caught = 0, missed = 0, broken = 0;

  for (const [id, title, fn] of [
    ["NC-PSS1-1", "legacy survey removed — an existing install's project list goes empty", legacyRootControl],
    ["NC-PSS1-2", "the bundled sample counted as a production — every install pinned inside", sampleCountedControl],
    ["NC-PSS1-3", "test-isolation refusal removed — a test run resolves into the checkout", testIsolationControl],
    ["NC-PSS1-4", "the pristine-sample comparison can fail", pristineSampleControl],
    ["NC-PSS1-5", "the legacy sentence loses the clause that stops a panic", settingsCopyControl],
  ]) {
    try { await fn(); caught += 1; console.log(`  caught     ${id}  ${title}`); }
    catch (error) { broken += 1; console.log(`  BROKEN     ${id}  ${title}\n             ${error.message}`); }
  }

  console.log(`\nPSS-1 negative controls: ${caught} caught · ${missed} missed · ${broken} broken; provider calls: 0.`);
  fs.rmSync(TEMP, { recursive: true, force: true });
  if (missed || broken) process.exit(1);
})().catch((error) => {
  console.error("\nPSS-1 negative controls FAILED\n", error);
  process.exit(1);
});

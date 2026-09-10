"use strict";

/* PSS-1 — PRODUCTIONS LIVE OUTSIDE THE APPLICATION.
 *
 * A production is the most valuable thing CineBraid holds and the application folder
 * is the most disposable one: replaced by every update, a git checkout on a
 * developer's machine, and the thing a release archive is built from. Every CineBraid
 * before this one kept them in the same place.
 *
 * Moving the default is easy. Moving it WITHOUT losing anybody is what this suite is
 * about, and the hard half is the install that already has productions in the old
 * place and no saved preference — because nobody who used the default ever saved one.
 * For them the old location keeps being the default, nothing is copied, nothing is
 * written, and the situation is reported instead.
 *
 * TWO KINDS OF SCENARIO, and the split is deliberate.
 *
 *   RESOLUTION scenarios evaluate the shipped resolution block in its own realm with
 *   a controlled `__dirname` and `process.env`. That is the only honest way to test
 *   "what does a FRESH install default to" on a machine that is not one — and it is
 *   the only way to exercise the legacy branch without pointing a running server at
 *   the developer's real productions, which this suite must never do.
 *
 *   SERVER scenarios run a real server against a disposable root under os.tmpdir()
 *   and cover the status contract, the sample installer and the test-isolation
 *   refusal. No provider is configured or contacted.
 *
 * The tracked sample is READ and hashed before and after; nothing here may write to
 * `projects/` or `data/` in the checkout, and the assertions say so.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const { ROOT, freePort, startCineBraidServer } = require("./fixtures/mock-civitai");
const { disposableRoot, insideRepository } = require("./helpers/disposable-root");
const { render, emptyFixture } = require("./render-harness");

const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8").replace(/\r\n/g, "\n");
const BUNDLED_SAMPLE = path.join(ROOT, "projects", "cinebraid-sample");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-pss1-"));
const passed = [];
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

/* ==========================================================================
   THE SHIPPED RESOLUTION BLOCK, IN A CONTROLLED WORLD

   `__dirname` decides APP_ROOT, and APP_ROOT decides both the install projects root
   and what "inside the application" means. Handing the block a fixture directory is
   what lets a fresh install, a legacy install and an explicit override all be real
   answers from the real code rather than restatements of it.
   ========================================================================== */

function resolutionIn({ appRoot, env = {} }) {
  const start = SERVER_SOURCE.indexOf("const APP_ROOT =");
  const end = SERVER_SOURCE.indexOf("function configuredWorkspacePath(");
  assert(start > 0 && end > start, "the project-root resolution block must be locatable in server.js");
  const sandbox = {
    fs, path, console, JSON,
    /* server.js is `<appRoot>/src/server/server.js`, so this is where its own
       `path.resolve(__dirname, "../..")` has to start from. */
    __dirname: path.join(appRoot, "src", "server"),
    process: { ...process, env: { ...env } },
    module: { exports: {} }, exports: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    SERVER_SOURCE.slice(start, end)
    + "\nmodule.exports = { APP_ROOT, INSTALL_PROJECTS_ROOT, USER_PROJECTS_ROOT, ENV_PROJECTS_ROOT,"
    + " DEFAULT_PROJECTS_ROOT, INSTALL_PROJECTS_STATE, surveyInstallProjectsRoot, projectRootSource,"
    + " pathIsInsideInstall, resolveWorkspacePath, projectsRoot };",
    sandbox, { filename: "server.js#project-root-resolution" },
  );
  return sandbox.module.exports;
}

/* A fake application directory. `projects` is populated by the caller. */
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
const EXPECTED_USER_ROOT = path.join(TEMP, "home", "CineBraid Projects");

async function scenario(id, fn) {
  await fn();
  passed.push(id);
  console.log(`  ok  ${id}`);
}

/* ==========================================================================
   PS-1 — a fresh install keeps projects outside the application
   ========================================================================== */

function ps1() {
  /* Only the shipped sample, which is application content and must not pin an
     install to the old location. */
  const install = fakeInstall("fresh", ({ projects }) => writeDocumentAt(path.join(projects, "cinebraid-sample"), "Sample"));
  const r = resolutionIn({ appRoot: install.appRoot, env: HOME });

  assert.strictEqual(r.INSTALL_PROJECTS_STATE.holdsProductions, false,
    "a bundled sample is not a production: " + JSON.stringify(r.INSTALL_PROJECTS_STATE));
  assert.strictEqual(r.DEFAULT_PROJECTS_ROOT, EXPECTED_USER_ROOT);
  assert.strictEqual(r.projectsRoot({}), EXPECTED_USER_ROOT);
  assert.strictEqual(r.projectRootSource({}), "default");
  assert.strictEqual(r.pathIsInsideInstall(r.DEFAULT_PROJECTS_ROOT), false,
    "the default must not be inside the application directory");

  /* An install with no projects folder at all — the shape of an extracted archive
     before first run — answers the same way rather than throwing. */
  const bare = fs.mkdtempSync(path.join(TEMP, "bare-"));
  fs.mkdirSync(path.join(bare, "src", "server"), { recursive: true });
  const empty = resolutionIn({ appRoot: bare, env: HOME });
  assert.strictEqual(empty.DEFAULT_PROJECTS_ROOT, EXPECTED_USER_ROOT);
  assert.strictEqual(empty.projectRootSource({}), "default");
}

/* ==========================================================================
   PS-2 — precedence: saved choice, then environment, then the default
   ========================================================================== */

function ps2() {
  const install = fakeInstall("precedence");
  const chosen = path.join(TEMP, "chosen");

  const plain = resolutionIn({ appRoot: install.appRoot, env: HOME });
  assert.strictEqual(plain.projectsRoot({}), EXPECTED_USER_ROOT, "no config, no environment: the default");
  assert.strictEqual(plain.projectsRoot({ workspace: { projectRoot: chosen } }), path.resolve(chosen),
    "a saved root wins over the default");
  assert.strictEqual(plain.projectRootSource({ workspace: { projectRoot: chosen } }), "configured");

  const env = path.join(TEMP, "from-environment");
  const withEnv = resolutionIn({ appRoot: install.appRoot, env: { ...HOME, CINEBRAID_PROJECTS_ROOT: env } });
  assert.strictEqual(withEnv.projectsRoot({}), path.resolve(env), "the environment beats the default");
  assert.strictEqual(withEnv.projectRootSource({}), "environment");
  assert.strictEqual(withEnv.projectsRoot({ workspace: { projectRoot: chosen } }), path.resolve(chosen),
    "and a saved root still beats the environment");
  assert.strictEqual(withEnv.projectRootSource({ workspace: { projectRoot: chosen } }), "configured");

  /* An environment root is a default, so it is what a legacy install would otherwise
     have claimed — and it must still win, or a QA sandbox on a developer's machine
     would silently resolve to that developer's productions. */
  const legacy = fakeInstall("legacy-with-env", ({ projects }) => writeDocumentAt(path.join(projects, "a-real-film"), "Real"));
  const both = resolutionIn({ appRoot: legacy.appRoot, env: { ...HOME, CINEBRAID_PROJECTS_ROOT: env } });
  assert.strictEqual(both.INSTALL_PROJECTS_STATE.holdsProductions, true);
  assert.strictEqual(both.projectsRoot({}), path.resolve(env),
    "an explicit environment root must outrank the legacy install root");
  assert.strictEqual(both.projectRootSource({}), "environment");
}

/* ==========================================================================
   PS-3 — an existing install does not lose its projects

   The requirement in one assertion: update CineBraid, change nothing, and the
   projects are still where they were and still the ones CineBraid opens.
   ========================================================================== */

function ps3() {
  const install = fakeInstall("legacy", ({ projects }) => {
    writeDocumentAt(path.join(projects, "cinebraid-sample"), "Sample");
    writeDocumentAt(path.join(projects, "a-real-film"), "A Real Film");
    writeDocumentAt(path.join(projects, "another-film"), "Another Film");
  });
  const before = treeHash(install.projects);
  const r = resolutionIn({ appRoot: install.appRoot, env: HOME });

  assert.strictEqual(r.projectsRoot({}), install.projects,
    "an install that already holds productions keeps opening them from where they are");
  assert.strictEqual(r.projectRootSource({}), "legacy-install");
  /* Spread first: the survey ran inside a realm, so its array has that realm's
     Array prototype and deepStrictEqual compares prototypes. */
  assert.deepStrictEqual([...r.INSTALL_PROJECTS_STATE.productions], ["a-real-film", "another-film"],
    "the sample is not counted; the productions are");
  assert.strictEqual(r.pathIsInsideInstall(r.projectsRoot({})), true, "and the condition is detectable");

  /* NOTHING WAS DONE ABOUT IT. This is a survey; a migration is a thing the user asks
     for. Not one byte moved, and no config was written — the resolution block cannot
     even reach writeConfig. */
  assert.deepStrictEqual(treeHash(install.projects), before, "detecting the condition must not change anything");

  /* And the moment a choice is saved, the legacy branch stops mattering. */
  const moved = path.join(TEMP, "moved-out");
  assert.strictEqual(r.projectsRoot({ workspace: { projectRoot: moved } }), path.resolve(moved));
  assert.strictEqual(r.projectRootSource({ workspace: { projectRoot: moved } }), "configured");
}

/* ==========================================================================
   PS-4 — archived and trashed projects count as production state

   A projects root holding nothing but a `.trash` is still holding somebody's deleted
   film, and it is exactly what a naive default change loses.
   ========================================================================== */

function ps4() {
  const archiveOnly = fakeInstall("archive-only", ({ projects }) => {
    writeDocumentAt(path.join(projects, "cinebraid-sample"), "Sample");
    writeDocumentAt(path.join(projects, ".archive", "retired-2026-09-09T17-27-32-055Z"), "Retired");
  });
  const a = resolutionIn({ appRoot: archiveOnly.appRoot, env: HOME });
  assert.strictEqual(a.INSTALL_PROJECTS_STATE.archived, 1);
  assert.deepStrictEqual([...a.INSTALL_PROJECTS_STATE.productions], [], "an archive is not a live project");
  assert.strictEqual(a.projectRootSource({}), "legacy-install", "but it is production state, and it counts");

  const trashOnly = fakeInstall("trash-only", ({ projects }) => {
    writeDocumentAt(path.join(projects, ".trash", "discarded-2026-09-01T08-00-00-000Z"), "Discarded");
  });
  const t = resolutionIn({ appRoot: trashOnly.appRoot, env: HOME });
  assert.strictEqual(t.INSTALL_PROJECTS_STATE.trashed, 1);
  assert.strictEqual(t.projectRootSource({}), "legacy-install");

  /* An EMPTY .archive is not production state. A folder CineBraid made for itself
     must not pin an install to the old location forever. */
  const emptyInfra = fakeInstall("empty-infra", ({ projects }) => {
    fs.mkdirSync(path.join(projects, ".archive"), { recursive: true });
    fs.mkdirSync(path.join(projects, ".trash"), { recursive: true });
    writeDocumentAt(path.join(projects, "cinebraid-sample"), "Sample");
  });
  const e = resolutionIn({ appRoot: emptyInfra.appRoot, env: HOME });
  assert.strictEqual(e.INSTALL_PROJECTS_STATE.holdsProductions, false,
    "empty infrastructure folders are not productions: " + JSON.stringify(e.INSTALL_PROJECTS_STATE));
  assert.strictEqual(e.projectRootSource({}), "default");

  /* A directory with no project.json is not a project either. */
  const stray = fakeInstall("stray", ({ projects }) => {
    fs.mkdirSync(path.join(projects, "notes"), { recursive: true });
    fs.writeFileSync(path.join(projects, "notes", "readme.txt"), "not a project\n");
  });
  assert.strictEqual(resolutionIn({ appRoot: stray.appRoot, env: HOME }).projectRootSource({}), "default");
}

/* ==========================================================================
   PS-5 — the status contract a person and an interface both read
   ========================================================================== */

async function ps5() {
  const workspace = disposableRoot("status");
  const server = await startCineBraidServer(workspace.env);
  try {
    const status = (await server.request("/api/workspace/status")).body;
    assert.strictEqual(path.resolve(status.projectRoot), path.resolve(workspace.projectsRoot));
    assert.strictEqual(status.projectRootSource, "environment",
      "the disposable root arrives by environment, and the status must say so");
    assert.strictEqual(status.rootInsideInstall, false, "and must say it is outside the application");
    assert.strictEqual(typeof status.userDefaultRoot, "string");
    assert(status.userDefaultRoot.length > 0, "the recommended folder must be offered");
    assert.strictEqual(status.legacyInstallRoot.active, false, "an environment root is not the legacy case");
    assert.strictEqual(status.sample.slug, "cinebraid-sample");
    assert.strictEqual(status.sample.bundled, true, "this build carries the sample");
    assert.strictEqual(status.sample.installed, false, "and the disposable workspace has no copy of it yet");

    /* /api/projects carries the same statement, because the first-run screen is fed
       by that route and must not have to work it out for itself. */
    const projects = (await server.request("/api/projects")).body;
    assert.deepStrictEqual(projects.projects, [], "a fresh workspace is empty");
    assert.strictEqual(path.resolve(projects.workspace.projectRoot), path.resolve(workspace.projectsRoot));
    assert.strictEqual(projects.workspace.projectRootSource, "environment");
    assert.strictEqual(projects.sample.bundled, true);
    assert.strictEqual(projects.sample.installed, false);
  } finally { server.stop(); workspace.cleanup(); }
}

/* ==========================================================================
   PS-6 — the sample becomes an ordinary project, and the shipped one is untouched
   ========================================================================== */

async function ps6() {
  const workspace = disposableRoot("sample");
  const pristine = treeHash(BUNDLED_SAMPLE);
  const server = await startCineBraidServer(workspace.env);
  try {
    const installed = await server.request("/api/projects/install-sample", { method: "POST" });
    assert.strictEqual(installed.status, 200, JSON.stringify(installed.body));
    assert.strictEqual(installed.body.created, true);
    assert.strictEqual(installed.body.slug, "cinebraid-sample",
      "the copy is recognisably the sample rather than a slugified headline");

    const copy = path.join(workspace.projectsRoot, "cinebraid-sample");
    assert.strictEqual(fs.existsSync(path.join(copy, "project.json")), true);
    const document = JSON.parse(fs.readFileSync(path.join(copy, "project.json"), "utf8"));
    assert.strictEqual(document.meta.title, "CineBraid Sample — The Blue Parcel");
    assert.strictEqual((document.shots || []).length, 3, "with its shots");

    /* The media came too, or the sample is a document about pictures nobody has. */
    for (const rel of [
      ["anchors", "CHAR-COURIER-FRONT.png"],
      ["plates", "LOC-PLATFORM-MASTER.png"],
      ["props", "PROP-PARCEL-CLOSED.png"],
      ["shots", "SAMPLE-01", "takes", "SAMPLE-01-ARRIVAL.png"],
    ]) {
      const target = path.join(copy, ...rel);
      assert.strictEqual(fs.existsSync(target), true, `the sample copy must include ${rel.join("/")}`);
      assert.strictEqual(sha(target), sha(path.join(BUNDLED_SAMPLE, ...rel)), "byte-identical");
    }
    /* Runtime state belongs to the install that minted it. */
    for (const artifact of ["backups", "media-assets.json", "generation-jobs.json", "project.json.bak"])
      assert.strictEqual(fs.existsSync(path.join(copy, artifact)), false,
        `${artifact} is runtime state and must not be handed on`);

    /* IT IS AN ORDINARY PROJECT: it opens, and editing it is editing the copy. */
    const listed = (await server.request("/api/projects")).body;
    assert.deepStrictEqual(listed.projects.map((row) => row.slug), ["cinebraid-sample"]);
    assert.strictEqual(listed.sample.installed, true, "and the offer becomes 'open' rather than 'add'");

    /* Asking twice does not make two. */
    const again = await server.request("/api/projects/install-sample", { method: "POST" });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.created, false);
    assert.strictEqual(again.body.reason, "already-present");
    assert.deepStrictEqual(
      fs.readdirSync(workspace.projectsRoot).filter((name) => !name.startsWith(".")).sort(),
      ["cinebraid-sample"], "a second request must not add a second copy");
  } finally { server.stop(); workspace.cleanup(); }

  /* AND ON A ROOT THAT DOES NOT EXIST YET, which is the fresh install this feature is
     for. CineBraid creates nothing at startup, so the per-user default is a path rather
     than a folder until the first thing is put in it — and "add the sample" may be the
     first thing. */
  const unborn = disposableRoot("sample-fresh");
  fs.rmSync(unborn.projectsRoot, { recursive: true, force: true });
  assert.strictEqual(fs.existsSync(unborn.projectsRoot), false, "the fixture must really be absent");
  const fresh = await startCineBraidServer(unborn.env);
  try {
    const status = (await fresh.request("/api/workspace/status")).body;
    assert.strictEqual(status.projectRootExists, false, "and the server must say so rather than inventing it");
    const installed = await fresh.request("/api/projects/install-sample", { method: "POST" });
    assert.strictEqual(installed.status, 200,
      "installing the sample must create the projects folder it needs: " + JSON.stringify(installed.body));
    assert.strictEqual(installed.body.created, true);
    assert.strictEqual(fs.existsSync(path.join(unborn.projectsRoot, "cinebraid-sample", "project.json")), true);
  } finally { fresh.stop(); unborn.cleanup(); }

  /* THE POINT OF ALL OF IT: the tracked sample is exactly as it was. */
  assert.deepStrictEqual(treeHash(BUNDLED_SAMPLE), pristine,
    "installing the sample must not touch the shipped one");
}

/* ==========================================================================
   PS-7 — a test run refuses to resolve into the application directory
   ========================================================================== */

async function ps7() {
  /* A disposable directory that really is inside the application, so the refusal is
     exercised against the condition it exists for — and named `.tmp`, which
     .gitignore already covers, so the checkout is never dirtied. */
  const probe = path.join(ROOT, "pss1-isolation-probe.tmp");
  const configPath = path.join(TEMP, "probe-config.json");
  fs.mkdirSync(probe, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: false } }, activeProject: "",
  }, null, 2));

  const start = async (extra) => {
    const port = await freePort();
    const child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: {
        ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath,
        CINEBRAID_PROJECTS_ROOT: probe, CINEBRAID_TEST_MODE: "", NODE_ENV: "",
        FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "", ...extra,
      },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    const deadline = Date.now() + 15000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/me`)).ok) return { started: true, child, output, exited }; }
      catch { /* not up yet */ }
      if (child.exitCode !== null) return { started: false, code: await exited, output };
      if (Date.now() > deadline) { child.kill(); throw new Error(`server neither started nor exited:\n${output}`); }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  };

  try {
    const refused = await start({ CINEBRAID_TEST_MODE: "1" });
    assert.strictEqual(refused.started, false,
      "a declared test run must not start against a projects root inside the application");
    assert.notStrictEqual(refused.code, 0, "and must exit non-zero");
    assert(/refused to start/i.test(refused.output), "saying so: " + refused.output);
    assert(refused.output.includes(probe), "and naming the root it refused: " + refused.output);

    /* NODE_ENV=test arms the same refusal, for a runner that sets that instead. */
    const alsoRefused = await start({ NODE_ENV: "test" });
    assert.strictEqual(alsoRefused.started, false, "NODE_ENV=test must arm the same refusal");

    /* And it is the DECLARATION that arms it. An ordinary run — including the legacy
       install this slice is careful not to break — starts exactly as before. */
    const ordinary = await start({});
    assert.strictEqual(ordinary.started, true,
      "an ordinary run must still start against a root inside the application: " + ordinary.output);
    ordinary.child.kill();
    await ordinary.exited;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

/* ==========================================================================
   PS-8 — the disposable-root helper cannot be pointed at the checkout
   ========================================================================== */

function ps8() {
  assert.strictEqual(insideRepository(path.join(ROOT, "projects")), true);
  assert.strictEqual(insideRepository(path.join(ROOT, "data")), true);
  assert.strictEqual(insideRepository(ROOT), true);
  assert.strictEqual(insideRepository(TEMP), false);

  for (const target of [ROOT, path.join(ROOT, "projects"), path.join(ROOT, "data", "qa")])
    assert.throws(() => disposableRoot("bad", { at: target }), /may not live inside the repository/,
      `a disposable workspace at ${target} must be refused`);

  const workspace = disposableRoot("helper");
  try {
    assert.strictEqual(insideRepository(workspace.home), false);
    assert.strictEqual(workspace.env.CINEBRAID_TEST_MODE, "1",
      "the helper must declare the run a test, so the server's refusal is armed");
    assert.strictEqual(workspace.env.CINEBRAID_PROJECTS_ROOT, workspace.projectsRoot);
    assert.strictEqual(workspace.env.CINEBRAID_CONFIG_PATH, workspace.configPath);
    const config = JSON.parse(fs.readFileSync(workspace.configPath, "utf8"));
    assert.strictEqual(config.assistant.provider, "none", "no provider may be configured");
    assert.strictEqual(config.generation.fal.enabled, false);

    /* installSample copies; it never links, and it never hands on runtime state. */
    const pristine = treeHash(BUNDLED_SAMPLE);
    const copy = workspace.installSample();
    assert.strictEqual(fs.existsSync(path.join(copy, "project.json")), true);
    assert.strictEqual(fs.lstatSync(copy).isSymbolicLink(), false, "a copy, never a link");
    assert.strictEqual(fs.existsSync(path.join(copy, "backups")), false);
    assert.strictEqual(fs.existsSync(path.join(copy, "media-assets.json")), false);
    fs.writeFileSync(path.join(copy, "project.json"), '{"meta":{"title":"vandalised"}}');
    assert.deepStrictEqual(treeHash(BUNDLED_SAMPLE), pristine,
      "editing the disposable copy must not reach the shipped sample");
  } finally { workspace.cleanup(); }
  assert.strictEqual(fs.existsSync(workspace.home), false, "cleanup removes it");
}

/* ==========================================================================
   PS-9 — the welcome screen says where the work will be kept, and offers a
          sample it actually has

   The screen a person meets before their first project is the last cheap moment to
   change where it lands; after that it is a migration. So these assertions are about
   what a reader is told, not about what the route returned.
   ========================================================================== */

async function firstRun(workspace, sample, projects = []) {
  return render("#/production", emptyFixture(), {
    fetch: async (url, options, respond) => {
      if (url === "/api/project") return respond({ error: "No active project" }, 404);
      if (url === "/api/projects") return respond({ active: "", projects, workspace, sample });
      return null;
    },
  });
}
const BUNDLED = { slug: "cinebraid-sample", bundled: true, installed: false, isBundledLocation: false };
const USER_ROOT_FIXTURE = "C:\\Users\\somebody\\CineBraid Projects";
const INSTALL_ROOT_FIXTURE = "C:\\CineBraid\\CineBraid-Source\\projects";

async function ps9() {
  /* (a) the ordinary fresh install */
  const fresh = await firstRun(
    { projectRoot: USER_ROOT_FIXTURE, projectRootSource: "default", projectRootExists: false,
      rootInsideInstall: false, userDefaultRoot: USER_ROOT_FIXTURE, legacyInstallRoot: { active: false } }, BUNDLED);
  assert(fresh.html.includes("WELCOME TO CINEBRAID"), "the first-run screen must still render");
  assert(fresh.html.includes(USER_ROOT_FIXTURE), "and must name the folder projects will be kept in");
  assert(fresh.html.includes("Choose a different folder"), "and offer to change it");
  assert(fresh.html.includes("Add the CineBraid sample"),
    "a workspace with no sample copy must offer to add one, not to open one");
  assert(!fresh.html.includes("Open CineBraid Sample"),
    "and must not offer to open a sample it does not have");

  /* (b) the sample has been added */
  const withSample = await firstRun(
    { projectRoot: USER_ROOT_FIXTURE, projectRootSource: "default", projectRootExists: true,
      rootInsideInstall: false, userDefaultRoot: USER_ROOT_FIXTURE, legacyInstallRoot: { active: false } },
    { ...BUNDLED, installed: true });
  assert(withSample.html.includes("Open CineBraid Sample"), "once a copy exists the offer becomes 'open'");
  assert(!withSample.html.includes("Add the CineBraid sample"), "and stops being 'add'");

  /* (c) the legacy install — the one state a person has to act on */
  const legacy = await firstRun(
    { projectRoot: INSTALL_ROOT_FIXTURE, projectRootSource: "legacy-install", projectRootExists: true,
      rootInsideInstall: true, userDefaultRoot: USER_ROOT_FIXTURE,
      legacyInstallRoot: { active: true, productions: 2, archived: 1, trashed: 0 } }, BUNDLED);
  assert(legacy.html.includes('data-workspace-state="legacy-install"'),
    "the legacy state must be marked, so it can be styled as the warning it is");
  assert(legacy.html.includes("inside the CineBraid application folder"), "and said in words");
  assert(legacy.html.includes("has changed nothing"),
    "and must say nothing was moved, which is the part that stops a panic");
  assert(legacy.html.includes(USER_ROOT_FIXTURE), "and suggest somewhere safer");

  /* (d) a root deliberately pointed back inside the application */
  const inside = await firstRun(
    { projectRoot: INSTALL_ROOT_FIXTURE, projectRootSource: "configured", projectRootExists: true,
      rootInsideInstall: true, userDefaultRoot: USER_ROOT_FIXTURE, legacyInstallRoot: { active: false } }, BUNDLED);
  assert(inside.html.includes("updating CineBraid can overwrite"),
    "a saved root inside the application still carries the hazard, and still says so");
  assert(!inside.html.includes('data-workspace-state="legacy-install"'),
    "but it is a different situation from never having moved one");

  /* (e) a server that says nothing about the workspace renders the screen anyway */
  const silent = await firstRun(undefined, undefined);
  assert(silent.html.includes("WELCOME TO CINEBRAID"), "an older or failing server must not blank the screen");
  assert(!silent.html.includes("Add the CineBraid sample"),
    "and must not offer a sample nobody said was there");
}

/* ==========================================================================
   PS-10 — Settings says the same thing, in the words that fit each case

   Evaluated from the shipped public/settings.js in its own realm, so what is under
   test is the sentence the panel will actually print.
   ========================================================================== */

function settingsCopy() {
  const source = fs.readFileSync(path.join(ROOT, "public/settings.js"), "utf8").replace(/\r\n/g, "\n");
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

function ps10() {
  const describe = settingsCopy();
  const base = { projectRoot: "D:/Work/Films", rootInsideInstall: false, legacyInstallRoot: { active: false } };

  assert(describe({ ...base, projectRootSource: "configured" }).includes("the folder saved below"),
    "a saved choice is settled and says so");
  assert(describe({ ...base, projectRootSource: "environment" }).includes("CINEBRAID_PROJECTS_ROOT"),
    "an environment root must name itself, or a QA sandbox looks like a lost workspace");
  assert(describe({ ...base, projectRootSource: "default" }).includes("default folder"),
    "the ordinary case is ordinary");

  const legacy = describe({
    projectRoot: INSTALL_ROOT_FIXTURE, projectRootSource: "legacy-install", rootInsideInstall: true,
    legacyInstallRoot: { active: true, productions: 2, archived: 1, trashed: 3 },
  });
  assert(legacy.includes("2 projects"), "the legacy sentence must count what is at stake");
  assert(legacy.includes("1 archived") && legacy.includes("3 in the trash"),
    "including the retired and the deleted");
  assert(legacy.includes("has changed nothing"), "and must say nothing was moved");
  assert(legacy.includes("the originals stay where they are"), "and what moving them would do");

  /* Singular and plural, because "1 projects" is the kind of thing that makes a
     person doubt the number. */
  assert(describe({
    projectRoot: "x", projectRootSource: "legacy-install", rootInsideInstall: true,
    legacyInstallRoot: { active: true, productions: 1, archived: 0, trashed: 0 },
  }).includes("(1 project)"), "one project reads as one project");

  /* A root pointed back inside the application gets the hazard as well as its own
     sentence — and the legacy case does not get it twice. */
  const inside = describe({ ...base, projectRootSource: "configured", rootInsideInstall: true });
  assert(inside.includes("inside the CineBraid application"), "a configured inside-install root is warned about");
  assert.strictEqual(legacy.split("inside the CineBraid application").length - 1, 1,
    "and the legacy sentence must not say it twice: " + legacy);

  /* A status that could not answer says so rather than printing "undefined". */
  assert.strictEqual(describe(undefined), "CineBraid did not report where projects are kept.");
  assert.strictEqual(describe({}), "CineBraid did not report where projects are kept.");
}

/* ==========================================================================
   RUN
   ========================================================================== */

(async () => {
  console.log("PSS-1 productions live outside the application\n");
  await scenario("PS-1  a fresh install defaults outside the application", async () => ps1());
  await scenario("PS-2  saved root beats environment beats default", async () => ps2());
  await scenario("PS-3  an existing install keeps opening the projects it has", async () => ps3());
  await scenario("PS-4  archived and trashed projects are production state", async () => ps4());
  await scenario("PS-5  the status contract names the root and where it came from", ps5);
  await scenario("PS-6  the sample installs as an ordinary project; the shipped one is untouched", ps6);
  await scenario("PS-7  a declared test run refuses a root inside the application", ps7);
  await scenario("PS-8  the disposable-root helper refuses the checkout", async () => ps8());
  await scenario("PS-9  the welcome screen names the root and offers a sample it has", ps9);
  await scenario("PS-10 Settings says the same thing, in the words that fit each case", async () => ps10());

  assert.deepStrictEqual(passed.map((line) => line.split(" ")[0]),
    ["PS-1", "PS-2", "PS-3", "PS-4", "PS-5", "PS-6", "PS-7", "PS-8", "PS-9", "PS-10"]);
  console.log(`\nPSS-1 project storage separation: ${passed.length}/10 scenarios passed; provider calls: 0.`);
  fs.rmSync(TEMP, { recursive: true, force: true });
})().catch((error) => {
  console.error("\nPSS-1 FAILED\n", error);
  process.exit(1);
});

/* A2 — SHELL IDENTITY. WHICH PROJECT, WHICH APPLICATION, WHICH BUILD.
 *
 * THE FAILURE THIS SUITE EXISTS FOR. The rail printed a project's title and,
 * directly beneath it, `meta.format + " · " + meta.version`. On the shipped
 * sample that second value is "6.6.4-studio.2" and the line is uppercased, so a
 * filmmaker read THREE-SHOT SAMPLE · 6.6.4-STUDIO.2 under the name of their film
 * and had no way to know it described the project record rather than CineBraid.
 * Meanwhile the application's real version — package.json's, already canonical
 * and already enforced — appeared nowhere in the running shell at all.
 *
 * The eight claims below are the ones a regression would have to break, and each
 * is proven where it can actually be false:
 *
 *   I1  the application version comes from the existing release authority, live
 *       off the route the browser really calls — not from a new constant.
 *   I2  the visible project identity is not sourced from schema/hub versions.
 *   I3  the retired concatenation cannot come back, and no project field can
 *       reach the application identity line.
 *   I4  build identity has a truthful fallback, and a supplied one is honoured.
 *   I5  no runtime Git invocation was introduced — proven behaviourally, from
 *       inside a working tree where `git rev-parse` WOULD have succeeded.
 *   I6  the project menu opens, closes and offers only actions that exist.
 *   I7  the project title survives a 220px rail without overflowing it.
 *   I8  A1 ownership is untouched: Terminal, Assistant, no drawer.
 *
 * WHY THE RULES TAKE A SOURCE MAP. Every source-level rule below reads what it
 * is given rather than what is on disk, so tests/shell-identity-negative-controls.js
 * can hand it a deliberately broken copy and require the real rule to catch it.
 * A rule nobody has ever seen fail is a rule nobody has tested.
 *
 * NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. The two servers it starts
 * are bound to loopback with their config and projects inside a temporary
 * directory, so data/ and the shipped sample are never read or written.
 */

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const toLF = (text) => String(text).split("\r\n").join("\n");
const { render, buildFixture } = require("./render-harness");
const { releaseIdentity } = require("../release-identity");
const { buildIdentity } = require("../build-identity");

const pkg = JSON.parse(read("package.json"));
const identity = releaseIdentity(pkg.version);
const notes = [];
const note = (line) => notes.push(line);

/* Comments are stripped wherever a rule asks "is that gone?". The A2 notes quote
   the retired expression in order to explain what was retired, which is what a
   reader needs and exactly what an absence check must not trip over. */
const codeOnly = (source) => toLF(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

const SOURCES = () => ({
  app: read("public/app.js"),
  markup: read("public/index.html"),
  css: read("public/styles.css"),
  server: read("server.js"),
  build: read("build-identity.js"),
  activity: read("public/live-activity.js"),
  surfaces: read("public/creator-surfaces.js"),
});

/* ===========================================================================
   A FIXTURE THAT IS DELIBERATELY MISLEADING.

   Its `meta.version` is the exact string that caused this slice, its schema
   markers are set to values no build writes, and — the case that matters most —
   one variant renumbers the project to the APPLICATION's own version. A shell
   that reads the project for its application identity passes every check
   against an ordinary fixture and fails against this one.
   =========================================================================== */
const CONFUSING_VERSION = "6.6.4-studio.2";
function confusingFixture(overrides = {}) {
  const project = buildFixture();
  project.meta.title = "The Last Seat";
  project.meta.format = "Feature";
  project.meta.version = CONFUSING_VERSION;
  project.meta.hubVersion = "v9.9.9";
  project.meta.schemaVersion = "9.9";
  Object.assign(project.meta, overrides);
  return project;
}

/* The complete set of menu entries. A menu that grows one has to be declared
   here, which is what keeps "only supported actions" a rule rather than a hope. */
const SUPPORTED_MENU_ACTIONS = {
  "Project settings": "openProjectSettingsFromMenu",
  "Switch project": "openProjectSwitcherFromMenu",
  "New project": "newProjectFromMenu",
  "About CineBraid": "openAboutCineBraid",
};
/* What each entry ULTIMATELY reaches. All of these existed before A2 except the
   About surface this slice builds, which is why they are listed as the
   capability rather than as the wrapper. */
const UNDERLYING_CAPABILITY = {
  openProjectSwitcherFromMenu: "openProjectSwitcher",
  newProjectFromMenu: "newProject",
  openAboutCineBraid: "openModal",
};

/* ===========================================================================
   THE SOURCE-LEVEL RULES.
   =========================================================================== */

/* I1 — the route derives from the release authority, and the browser holds no
   version of its own. If the route stops calling the authority it has BECOME a
   second one, and the two can then disagree with nothing noticing. */
function checkReleaseAuthority(sources) {
  const server = codeOnly(sources.server);
  assert(/require\("\.\/release-identity"\)/.test(server),
    "server.js must read the application version through release-identity.js");
  assert(/releaseIdentity\(\)/.test(server), "the app-identity route must call releaseIdentity()");
  assert(/app\.get\("\/api\/app-identity"/.test(server), "the app-identity route must be served");

  const app = codeOnly(sources.app);
  assert(!app.includes(identity.version),
    `public/app.js declares the literal application version ${identity.version}; it must display the served one`);
  assert(!app.includes(identity.core),
    `public/app.js declares the literal application version core ${identity.core}`);
  assert(/APP_IDENTITY\?\.app\?\.version/.test(app),
    "the browser's application label must read the served version and nothing else");
}

/* I3 — the retired concatenation cannot return, and #project-format has a known
   set of writers. Four writers with four opinions is how the version got into
   one of them and not the others. */
function checkNoRetiredConcatenation(sources) {
  const app = codeOnly(sources.app);
  assert(!/P\.meta\.version \? " \u00b7 " \+ P\.meta\.version/.test(app),
    "the retired format-plus-version concatenation is back in the shell");
  assert(!/#project-format[\s\S]{0,400}meta\.version/.test(app),
    "the project format line must not read meta.version");
  assert(!/getElementById\("project-format"\)[\s\S]{0,400}meta\.version/.test(app),
    "the project format line must not read meta.version");

  assert.strictEqual((app.match(/function applyProjectIdentity\(/g) || []).length, 1,
    "the shell must have exactly one writer for its project identity lines");
  /* THREE WRITERS, AND THEY ARE NAMED. applyProjectIdentity() writes the format
     of an open project; showFirstRunWorkspace() and markProjectLoadFailure()
     each write a sentence about there being no project. */
  assert.strictEqual((app.match(/\$\("#project-format"\)|getElementById\("project-format"\)/g) || []).length, 3,
    "#project-format has an undeclared writer");
  for (const owner of ["showFirstRunWorkspace", "markProjectLoadFailure", "applyProjectIdentity"]) {
    assert(app.includes(`function ${owner}(`), `${owner} must still be the writer it is declared as`);
  }
}

/* I5 — no runtime Git invocation. The behavioural half runs in checkServed().
   Here: build identity cannot start a process or read a repository, and no
   runtime source starts an UNDECLARED subprocess. An allowlist rather than a
   search for "git", because that is the only form of this rule that catches the
   invocation nobody thought to grep for. */
const ALLOWED_RUNTIME_SUBPROCESSES = new Set(["ffmpeg", "npm", "df"]);
const RUNTIME_SOURCES = ["server.js", "release-identity.js", "build-identity.js", "config.js", "agent-suite.js", "llm.js", "automation-runs.js", "fal-generation.js"];
function checkNoRuntimeGit(sources) {
  const build = sources.build;
  assert(!/require\(["']child_process["']\)/.test(build),
    "build-identity.js must not be able to start a subprocess");
  for (const forbidden of [/\bexecSync\b/, /\bexecFileSync\b/, /\bspawnSync\b/, /\bspawn\b/, /rev-parse/, /\.git\b/]) {
    assert(!forbidden.test(codeOnly(build)),
      `build-identity.js must not reference ${forbidden}; build identity is supplied, never discovered`);
  }

  const found = [];
  for (const file of RUNTIME_SOURCES) {
    const text = codeOnly(file === "build-identity.js" ? build : file === "server.js" ? sources.server : read(file));
    for (const match of text.matchAll(/\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\(\s*["'`]([^"'`]+)["'`]/g)) {
      found.push({ file, command: match[1] });
    }
  }
  const undeclared = found.filter((entry) => !ALLOWED_RUNTIME_SUBPROCESSES.has(entry.command));
  assert.deepStrictEqual(undeclared.map((e) => `${e.file} -> ${e.command}`), [],
    "runtime sources start undeclared subprocesses");
  assert(!found.some((entry) => entry.command === "git"), "no runtime source may invoke Git");

  /* The browser cannot start a process at all, so what matters there is that it
     is not asking anyone else to: the identity it displays arrives from one
     route and is derived from nothing repository-shaped. */
  assert(!/rev-parse|\.git\b/.test(codeOnly(sources.app)), "the browser must reference nothing Git-shaped");
  return found;
}

/* I6, markup half — the button declares the menu, and both ship closed. */
function checkMenuDeclaration(sources) {
  const markup = sources.markup;
  /* A DISCLOSURE, deliberately: see the note beside the declaration. The head and
     the foot are the two most useful things in it and neither is a command, so a
     role="menu" would license a screen reader to skip exactly the facts A2 exists
     to make legible. What must hold is that the button says it controls something
     and says whether it is open. */
  assert(/id="project-menu"[^>]*role="group"/.test(markup), "the project menu must be a labelled group");
  assert(/id="project-menu"[^>]*aria-labelledby="project-title"/.test(markup), "the project menu must be labelled by the button that opens it");
  assert(!/id="project-menu"[^>]*role="menu"/.test(markup), "the project menu holds content as well as commands and must not claim role=menu");
  assert(/id="project-title"[^>]*aria-controls="project-menu"/.test(markup), "the project title must name what it controls");
  assert(/id="project-title"[^>]*aria-expanded="false"/.test(markup), "the project menu must ship closed");
  assert(/id="project-menu"[^>]*\bhidden\b/.test(markup), "the project menu must ship hidden");
  assert(/data-view="settings"/.test(markup), "Project settings must lead to a declared navigation view");
  assert(/location\.hash = "#\/settings"/.test(codeOnly(sources.app)), "Project settings must route to #/settings");
}

/* I7 — the rule that makes the compact-viewport measurements pass. The pixels
   are measured in tests/shell-identity-real-browser.py; this fails immediately
   when the rule behind them is edited away. */
function checkCompactTitleRules(sources) {
  const css = toLF(sources.css);
  const titleRule = (css.match(/^\.project-title\{[^}]*overflow-wrap[^}]*\}$/m) || [])[0];
  assert(titleRule, ".project-title must declare how it wraps inside the rail");
  assert(/overflow-wrap:anywhere/.test(titleRule),
    "a long unbroken title must be able to break rather than widen the rail");
  assert(/-webkit-line-clamp:\d/.test(titleRule),
    "the title must be capped so it cannot walk the navigation off a short screen");

  const menuRule = (css.match(/^\.project-menu\{[^}]*\}$/m) || [])[0];
  assert(menuRule, ".project-menu must be declared");
  assert(/position:absolute/.test(menuRule), "the menu must overlay rather than reflow the rail");
  assert(/max-width:calc\(100vw - \d+px\)/.test(menuRule),
    "the menu must be bounded by the viewport so a narrow laptop cannot cut it off");
  assert(/overflow-wrap:anywhere/.test((css.match(/^\.cb-section-title\{[^}]*\}$/m) || [""])[0]),
    "the menu head must be able to show a complete title, since the button clamps one");
}

/* I8 — A1 is frozen. A2 added markup to the rail head and the rail foot and
   nothing else, so what this proves is that the A1 surfaces are still declared,
   still owned where A1 left them, and that the new menu is inside none of them. */
function checkA1Ownership(sources) {
  const markup = sources.markup;
  for (const [id, why] of [
    ["automation-activity-toggle", "the single persistent activity control"],
    ["creator-rail-toggle", "the Assistant entry point"],
    ["cb-shell-dock", "the Activity Terminal's region"],
    ["cb-shell-rail", "the Assistant's region"],
    ["cb-shell-bar", "the shot workflow region"],
  ]) {
    assert(markup.includes(`id="${id}"`), `A1 surface missing: ${id} (${why})`);
  }
  assert(!/automation-activity-drawer/.test(markup), "the retired Global Activity drawer must not return");
  assert(!/openGlobalAutomationActivity/.test(toLF(sources.activity)), "the retired drawer must have no opener");
  for (const capability of ["recheckAutomationGateStatus()", "archivePreviousAutomationFailures()", "dismissAutomationActivityRun("]) {
    assert(toLF(sources.surfaces).includes(capability), `the Activity Terminal must still own ${capability}`);
  }

  /* The new menu lives in the rail head, which is the one region A1 does not
     own. Declared inside a shell slot it would be a second thing mounting into a
     region public/workspace-shell.js is responsible for. */
  const head = markup.slice(markup.indexOf('<div class="rail-head">'), markup.indexOf("</aside>"));
  assert(head.includes('id="project-menu"'), "the project menu belongs to the rail head");
  const workspace = markup.slice(markup.indexOf('<section id="workspace">'));
  assert(!workspace.includes('id="project-menu"'), "the project menu must not be declared inside the workspace shell");
  assert(!workspace.includes('id="app-identity"'), "the application identity line must not be declared inside the workspace shell");

  for (const file of ["public/live-activity.js", "public/creator-surfaces.js", "public/workspace-shell.js", "public/stage-surfaces.js", "public/shared-workspace-shell.js"]) {
    assert(!/project-menu|app-identity|APP_IDENTITY/.test(read(file)),
      `${file} is an A1 owner and must know nothing about A2 shell identity`);
  }
}

/* ===========================================================================
   I4 — BUILD IDENTITY. Takes the factory so a control can hand it a broken one.
   =========================================================================== */
function checkBuildFallback(factory) {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-build-none-"));
  try {
    const development = factory({ env: {}, root: empty });
    assert.strictEqual(development.supplied, false, "a checkout supplies no build id");
    assert.strictEqual(development.source, "development", "the fallback source must say development");
    assert.strictEqual(development.id, "", "the fallback must invent no identifier");
    assert.strictEqual(development.shortId, "", "the fallback must invent no short identifier");
    assert.strictEqual(development.label, "Development build", "the fallback label must be plain");
    assert(!/[0-9a-f]{7}/i.test(development.label), "the fallback label must contain nothing hash-shaped");

    const commit = "9653b7d5172f9df7a1bba46233cfff7ea0986abf";
    const fromEnv = factory({ env: { CINEBRAID_BUILD_ID: commit, CINEBRAID_BUILD_DATE: "2026-09-02" }, root: empty });
    assert.strictEqual(fromEnv.source, "environment", "an environment-supplied build must say so");
    assert.strictEqual(fromEnv.id, commit, "the full identifier must be preserved");
    assert.strictEqual(fromEnv.shortId, "9653b7d", "a commit-shaped identifier is displayed short");
    assert.strictEqual(fromEnv.label, "Build 9653b7d", "the label must name the build");

    fs.writeFileSync(path.join(empty, "build-info.json"), JSON.stringify({ commit, builtAt: "2026-09-02T09:00:00Z" }));
    const fromFile = factory({ env: {}, root: empty });
    assert.strictEqual(fromFile.source, "build-info", "a packaged build must read its build note");
    assert.strictEqual(fromFile.shortId, "9653b7d", "the packaged identifier must be the supplied one");
    assert.strictEqual(
      factory({ env: { CINEBRAID_BUILD_ID: "env-wins" }, root: empty }).source,
      "environment",
      "the environment must take precedence over the file",
    );

    /* A build note that cannot be read is a development build, not a crash and
       not a guess: the application still runs, and the honest thing to say about
       its identity is that none was supplied. */
    fs.writeFileSync(path.join(empty, "build-info.json"), "{ not json");
    const broken = factory({ env: {}, root: empty });
    assert.strictEqual(broken.source, "development", "an unreadable build note must fall back, truthfully");
    assert.strictEqual(broken.supplied, false, "an unreadable build note must not be reported as supplied");

    /* An identifier that is not commit-shaped is never truncated: shortening
       "2026-09-02-nightly" would produce a different and false identifier. */
    const named = factory({ env: { CINEBRAID_BUILD_ID: "2026-09-02-nightly" }, root: empty });
    assert.strictEqual(named.shortId, "2026-09-02-nightly", "a non-commit identifier must not be truncated");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
}

/* ===========================================================================
   THE RENDERED RULES. `mutate` is threaded through so a control can break the
   live path in memory and require the same assertions to catch it.
   =========================================================================== */

/* I2 and the rendered half of I3. */
async function checkProjectIdentityRendered(options = {}) {
  const project = confusingFixture();
  const { map } = await render("#/production", project, options);
  const title = map.get("project-title").textContent;
  const format = map.get("project-format").textContent;
  const topbar = map.get("topbar-project").textContent;

  assert.strictEqual(title, "The Last Seat", "the rail must show the project title and nothing else");
  assert.strictEqual(format, "Feature", "the subtitle must be the project format exactly");
  assert.strictEqual(topbar, "The Last Seat", "the topbar must show the project title");

  for (const [label, text] of [["title", title], ["format", format], ["topbar", topbar]]) {
    for (const value of [project.meta.hubVersion, project.meta.schemaVersion, project.meta.version]) {
      assert(!String(text).includes(value),
        `the shell's ${label} carries the project record value ${value}; project identity must not be sourced from it`);
    }
  }

  /* A project that renumbered ITSELF to the application version must not be able
     to become the application identity — the case where "the strings match"
     would otherwise look like success. */
  const shell = await render("#/production", confusingFixture({ version: identity.version, title: "Renumbered" }), options);
  assert.strictEqual(shell.map.get("app-identity").textContent, `CineBraid ${identity.version}`,
    "the application line must be the served release identity");
  /* `P` is a script-scoped binding rather than a property of the realm, so the
     edit is made from inside the realm — the way the product would make it. Both
     painters are then asked to repaint, because the claim is about what each of
     them READS: a shell where the application line re-derives from the project
     is one project-settings edit away from advertising a version CineBraid does
     not have. */
  vm.runInContext('P.meta.version = "9.9.9-project-invented"; applyProjectIdentity(); renderAppIdentity();', shell.context);
  assert.strictEqual(shell.map.get("app-identity").textContent, `CineBraid ${identity.version}`,
    "a project record edit reached the application identity line");
  assert.strictEqual(shell.map.get("project-format").textContent, "Feature",
    "a project record version edit reached the project subtitle");
}

/* I6, behavioural half. */
async function checkMenuBehaviour(options = {}) {
  const { context, map, documentListeners } = await render("#/production", confusingFixture(), options);
  const button = map.get("project-title");
  const menu = map.get("project-menu");
  const keydownCount = () => (documentListeners.get("keydown") || []).length;
  const baselineKeydown = keydownCount();
  assert.strictEqual(menu.hidden, true, "the menu must not be open on load");

  context.toggleProjectMenu({ focusFirst: false });
  assert.strictEqual(menu.hidden, false, "clicking the project title must open the menu");
  assert.strictEqual(button["aria-expanded"], "true", "an open menu must be announced as expanded");

  const entries = [...menu.innerHTML.matchAll(/onclick="([^"(]+)\(\)"[^>]*><b>([^<]+)<\/b><small>([^<]*)<\/small>/g)]
    .map(([, run, label, detail]) => ({ run, label, detail }));
  assert.strictEqual(entries.length, Object.keys(SUPPORTED_MENU_ACTIONS).length,
    `the menu rendered ${entries.length} entries; ${Object.keys(SUPPORTED_MENU_ACTIONS).length} are declared supported`);
  for (const entry of entries) {
    assert.strictEqual(SUPPORTED_MENU_ACTIONS[entry.label], entry.run,
      `menu entry "${entry.label}" runs ${entry.run}, which is not the declared supported action`);
    assert.strictEqual(typeof context[entry.run], "function",
      `menu entry "${entry.label}" calls ${entry.run}, which does not exist on the page`);
    const underlying = UNDERLYING_CAPABILITY[entry.run];
    if (underlying) {
      assert.strictEqual(typeof context[underlying], "function",
        `menu entry "${entry.label}" reaches ${underlying}, which does not exist`);
    }
    assert(entry.detail.length > 0, `menu entry "${entry.label}" must say what it does`);
  }

  /* The head names the open project. It is the one place the FULL title is
     guaranteed readable, which is what makes clamping it on the button safe. */
  assert(menu.innerHTML.includes("The Last Seat"), "the menu head must name the open project");
  assert(menu.innerHTML.includes("CURRENT PROJECT"), "the menu head must say what it is naming");
  assert(menu.innerHTML.includes(`CineBraid ${identity.version}`), "the menu foot must carry the application version");
  for (const forbidden of [CONFUSING_VERSION, "v9.9.9"]) {
    assert(!menu.innerHTML.includes(forbidden), `the menu carries the project record value ${forbidden}`);
  }

  /* ESCAPE CLOSES IT, THROUGH THE LISTENER THE PAGE REALLY REGISTERED. Calling
     closeProjectMenu() directly would prove only that a function exists; this
     delivers the key to whatever openProjectMenu() actually wired to the
     document, which is what a person pressing Escape reaches. */
  const deliver = (event) => {
    for (const handler of [...(documentListeners.get("keydown") || [])]) {
      handler({ stopPropagation() {}, preventDefault() {}, ...event });
    }
  };
  assert(keydownCount() > baselineKeydown, "an open menu must register a key listener");
  deliver({ key: "Escape" });
  assert.strictEqual(menu.hidden, true, "Escape must close the menu");
  assert.strictEqual(button["aria-expanded"], "false", "a closed menu must be announced as collapsed");

  /* AND THE LISTENER COMES BACK OFF. A menu that leaves a document-wide keydown
     handler behind every time it opens eventually swallows the Escape belonging
     to something else — public/review.js closes the modal on that key. */
  assert.strictEqual(keydownCount(), baselineKeydown, "closing the menu must remove its document listener");
  for (let i = 0; i < 3; i++) {
    context.toggleProjectMenu({ focusFirst: false });
    context.toggleProjectMenu({ focusFirst: false });
  }
  assert.strictEqual(keydownCount(), baselineKeydown, "opening the menu repeatedly must not accumulate document listeners");

  /* WITH NO PROJECT OPEN the menu still offers the way out. This is the state a
     failed load leaves the shell in, so "Switch project" must survive it. */
  vm.runInContext("P = null;", context);
  context.toggleProjectMenu({ focusFirst: false });
  assert(menu.innerHTML.includes("No project open"), "with no project the menu must say so");
  const buttons = [...menu.innerHTML.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => ({
    run: (attributes.match(/onclick="([^"(]+)\(\)"/) || [])[1] || "",
    disabled: /\bdisabled\b/.test(attributes),
  }));
  const enabled = buttons.filter((entry) => !entry.disabled).map((entry) => entry.run);
  assert(enabled.includes("openProjectSwitcherFromMenu"), "Switch project must remain available with no project open");
  assert(enabled.includes("newProjectFromMenu"), "New project must remain available with no project open");
  assert(enabled.includes("openAboutCineBraid"), "About must remain available with no project open");
  assert(buttons.some((entry) => entry.run === "openProjectSettingsFromMenu" && entry.disabled),
    "Project settings must be disabled when there is no project to settle");
  context.closeProjectMenu();
  return entries;
}

/* ===========================================================================
   THE LIVE HALVES OF I1, I4 AND I5.
   =========================================================================== */
function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}
async function withServer(env, body) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-shell-identity-"));
  const projects = path.join(temp, "projects");
  fs.mkdirSync(path.join(projects, "identity-fixture"), { recursive: true });
  fs.writeFileSync(path.join(projects, "identity-fixture", "project.json"), JSON.stringify(confusingFixture(), null, 2));
  fs.writeFileSync(path.join(temp, "config.json"), JSON.stringify({ activeProject: "identity-fixture" }, null, 2));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: path.join(temp, "config.json"), CINEBRAID_PROJECTS_ROOT: projects, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 12000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/me`)).ok) break;
      } catch {}
      if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return await body(base);
  } finally {
    child.kill();
    await new Promise((resolve) => child.on("exit", resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function checkServed() {
  const development = await withServer({}, async (base) => (await fetch(`${base}/api/app-identity`)).json());
  assert.strictEqual(development.app.version, identity.version,
    "/api/app-identity must serve package.json's version through release-identity.js");
  assert.strictEqual(development.app.displayName, identity.displayName, "the display name must be the derived one");
  assert.strictEqual(development.app.channel, identity.channel, "the channel must be the derived one");
  assert.strictEqual(development.app.isPrerelease, identity.isPrerelease, "the prerelease flag must be the derived one");

  /* I5, BEHAVIOURALLY. This process runs inside the Git working tree its own
     files are checked out into, so `git rev-parse HEAD` would have answered. The
     route reports a development build instead, which is the observable
     difference between "supplied, never discovered" and a comment claiming it. */
  assert(fs.existsSync(path.join(ROOT, ".git")),
    "this control is only meaningful from inside a working tree; .git was not found");
  assert.strictEqual(development.build.source, "development",
    "the running server discovered a build identity from a working tree it must not read");
  assert.strictEqual(development.build.supplied, false, "nothing was supplied, so nothing may be claimed");
  assert.strictEqual(development.build.label, "Development build", "the running fallback must be the plain one");

  /* And the injection path is real rather than theoretical. */
  const supplied = await withServer(
    { CINEBRAID_BUILD_ID: "9653b7d5172f9df7a1bba46233cfff7ea0986abf", CINEBRAID_BUILD_DATE: "2026-09-02" },
    async (base) => (await fetch(`${base}/api/app-identity`)).json(),
  );
  assert.strictEqual(supplied.build.supplied, true, "a supplied build id must be reported as supplied");
  assert.strictEqual(supplied.build.label, "Build 9653b7d", "a supplied build id must be displayed");
  assert.strictEqual(supplied.app.version, identity.version, "supplying a build must not change the version");
  return { development, supplied };
}

async function main() {
  const sources = SOURCES();
  checkBuildFallback(buildIdentity);
  note("I4 development fallback invents nothing; environment and build-info are honoured; an unreadable note falls back");
  const subprocesses = checkNoRuntimeGit(sources);
  note(`I5 build identity reads no .git and starts no process; ${subprocesses.length} runtime subprocess call(s), all declared (${[...ALLOWED_RUNTIME_SUBPROCESSES].join(", ")})`);
  checkCompactTitleRules(sources);
  note("I7 the rail title wraps and caps; the menu overlays, is viewport-bounded, and shows the complete title");
  checkA1Ownership(sources);
  note("I8 Terminal, Assistant, dock, rail and bar all still declared; no drawer; the A2 menu is outside every A1 region");
  checkMenuDeclaration(sources);
  checkNoRetiredConcatenation(sources);
  note(`I3 the retired concatenation is gone and #project-format has three named writers`);

  await checkProjectIdentityRendered();
  note("I2 title/format/topbar carry no hubVersion, no schemaVersion and no project meta.version; no project field can reach the application line");
  const entries = await checkMenuBehaviour();
  note(`I6 ${entries.length} menu entries, all declared and all resolving; opens, closes on Escape, toggles without leaking listeners, and keeps the way out with no project open`);

  checkReleaseAuthority(sources);
  const served = await checkServed();
  note(`I1 application version ${identity.version} served through release-identity.js; the browser declares none of its own`);
  note("I5 the route answers \u201cDevelopment build\u201d from inside a working tree where git rev-parse would have succeeded");
  note(`I4 live: nothing supplied \u2192 Development build; CINEBRAID_BUILD_ID supplied \u2192 ${served.supplied.build.label}`);

  console.log("A2 shell identity suite passed.");
  for (const line of notes) console.log(`  ${line}`);
}

module.exports = {
  SOURCES,
  codeOnly,
  confusingFixture,
  CONFUSING_VERSION,
  SUPPORTED_MENU_ACTIONS,
  checkReleaseAuthority,
  checkNoRetiredConcatenation,
  checkNoRuntimeGit,
  checkMenuDeclaration,
  checkCompactTitleRules,
  checkA1Ownership,
  checkBuildFallback,
  checkProjectIdentityRendered,
  checkMenuBehaviour,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

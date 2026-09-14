"use strict";

/* CONFIG_STORAGE_SEPARATION_V1 — CS-1, TEST ISOLATION.
 *
 * THE INVARIANT. Every automated or test-mode CineBraid server owns an explicit disposable
 * configuration environment, and cannot read or write the ordinary per-user settings, a
 * real installation's settings, or a real production projects root.
 *
 * The four suites that started a server with no settings of their own were the known
 * counterexamples. They are checked here, but they are not the definition of done: TI-1
 * inventories EVERY place tests/ and scripts/ start `server.js`, and the refusals below
 * are the server's own, so a counterexample nobody has found yet fails too.
 *
 * NO CHECK HERE POINTS A SERVER AT A LIVE LOCATION. Refusals are proved against a
 * disposable COPY of the application (stageInstallation), so if a refusal were ever
 * broken the damage would be a temporary file. The real per-user locations are asserted
 * by the pure rule only, and every live configuration location is compared by existence,
 * size and modification time — never by reading it — before and after the whole run.
 *
 *   TI-1  inventory: no server started with implicit configuration authority
 *   TI-2  the shared rule: what is and is not disposable
 *   TI-3  the seam: disposable by construction, credentials blank
 *   TI-4  the seam cannot be redirected to a live location
 *   TI-5  cleanup is deterministic, in Node and in Python
 *   TI-6  the ledger, and the browser gate that reads it
 *   TI-7  the server: disposable environments work, live ones are refused before any read
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const TestIsolation = require("../src/server/test-isolation");
const {
  CREDENTIAL_ENV, DISPOSABLE_MARKER, LEDGER_ENV, ROOT,
  disposableRoot, readLedger, removeDisposableHome, stageInstallation, verifyLedgerEntries,
} = require("./helpers/disposable-root");
const { freePort } = require("./fixtures/mock-civitai");

const SEAM = path.join(ROOT, "tests", "helpers", "disposable-root.js");
const SENTINEL = "cs1-sentinel-not-a-credential";
/* Outside the temporary directory, outside every installation, never created by anything. */
const NOT_DISPOSABLE = path.join(path.parse(os.tmpdir()).root, `cs1-not-disposable-${process.pid}-${Date.now()}`);

function refusal(target, options = {}) {
  return TestIsolation.disposableLocationRefusal(target, { appRoot: ROOT, ...options });
}

function applyOnce(text, from, to) {
  const found = text.split(from).length - 1;
  assert.strictEqual(found, 1, `expected one occurrence of ${JSON.stringify(from.slice(0, 60))}, found ${found}`);
  return text.replace(from, to);
}

/* A directory that looks like a CineBraid installation to the rule. */
function fakeInstallation(parent, name = "other-install") {
  const dir = path.join(parent, name);
  fs.mkdirSync(path.join(dir, "src", "server"), { recursive: true });
  fs.writeFileSync(path.join(dir, "server.js"), "// not a server\n");
  fs.writeFileSync(path.join(dir, "src", "server", "config.js"), "// not a config\n");
  return dir;
}

/* Existence, size and modification time of every live configuration location. */
function liveStamps() {
  const out = {};
  const stamp = (target) => {
    try { const stat = fs.statSync(target); return stat.isDirectory() ? "directory" : `${stat.size}:${stat.mtimeMs}`; }
    catch { return "absent"; }
  };
  for (const location of TestIsolation.liveConfigurationLocations(ROOT)) {
    out[location.path] = stamp(location.path);
    for (const name of ["config.json", "config.json.bak"]) out[path.join(location.path, name)] = stamp(path.join(location.path, name));
  }
  return out;
}

/* ---------------------------------------------------------------------------------------
   TI-1 — the inventory
   --------------------------------------------------------------------------------------- */

const SPAWN = /(?:\bspawn|\bspawnSync|\bfork|\bexecFile|\bexecFileSync|\bPopen|subprocess\.run)\s*\(\s*[^;]{0,200}?['"]server\.js['"]/g;

/* How one place that starts `server.js` gets its settings. */
function classifySpawn(file, source, window) {
  if (/serverEnv\(|\.env\(\s*port\b|workspace\.env\b/.test(window)) return "seam";
  if (/\benv\s*[=:]\s*env\b/.test(window) && /\benv\s*=\s*\w+\.(?:env|serverEnv)\(/.test(source)) return "seam";
  if (file === "tests/fixtures/mock-civitai.js" && /CINEBRAID_TEST_MODE:\s*"1"/.test(window)) return "guarded-fixture";
  /* The settings may be stated in the call, or in an object the call spreads. */
  const stated = [window, ...[...window.matchAll(/\.\.\.(\w+)\b/g)]
    .map(([, name]) => source.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{[\\s\\S]{0,600}`)))
    .filter(Boolean).map((match) => match[0])];
  if (stated.some((text) => /CINEBRAID_CONFIG_PATH/.test(text) && /CINEBRAID_PROJECTS_ROOT/.test(text))
    && /mkdtemp|tmpdir\(|tempfile|disposable/.test(source)) return "explicit";
  return "implicit";
}

function spawnSites(file, source) {
  const sites = [];
  for (const match of source.matchAll(SPAWN)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const before = source.slice(lineStart, match.index);
    /* Comments, docstrings and `inline code` in prose name server.js without starting it. */
    if (/^\s*(#|\/\/|\*|\/\*|""")/.test(before) || before.includes("`")) continue;
    const window = source.slice(match.index, match.index + 900);
    sites.push({ file, line: source.slice(0, match.index).split("\n").length, kind: classifySpawn(file, source, window) });
  }
  return sites;
}

function inventory() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!["node_modules", "__pycache__"].includes(entry.name)) walk(full); }
      else if (/\.(js|py)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(ROOT, "tests"));
  walk(path.join(ROOT, "scripts"));
  return files.flatMap((full) => spawnSites(path.relative(ROOT, full).split(path.sep).join("/"), fs.readFileSync(full, "utf8")));
}

function ti1() {
  const sites = inventory();
  const implicit = sites.filter((site) => site.kind === "implicit");
  assert.deepStrictEqual(implicit.map((site) => `${site.file}:${site.line}`), [],
    "every server a test or script starts must own explicit disposable settings");
  const counts = sites.reduce((out, site) => ({ ...out, [site.kind]: (out[site.kind] || 0) + 1 }), {});
  assert(sites.length > 60, `the inventory must actually find the spawn sites, found ${sites.length}`);

  /* The known counterexamples, and the two the inventory itself found. */
  for (const [file, kind] of [
    ["tests/continuity-correction-real-browser.py", "seam"],
    ["tests/motion-prompt-editing-real-browser.py", "seam"],
    ["tests/terminal-keyed-reconciliation-browser.js", "seam"],
    ["tests/external-test-readiness.js", "seam"],
    ["tests/windows-shutdown.js", "seam"],
    ["tests/comfy-integration.js", "explicit"],
  ]) {
    const own = sites.filter((site) => site.file === file);
    assert(own.length > 0, `${file} must still be found by the inventory`);
    assert(own.every((site) => site.kind === kind), `${file} must be ${kind}: ${JSON.stringify(own)}`);
  }
  const readiness = fs.readFileSync(path.join(ROOT, "tests", "external-test-readiness.js"), "utf8");
  assert(!/read\(\s*["'`]data\/config\.json["'`]\s*\)/.test(readiness),
    "external-test-readiness must not read the checkout's own settings file");
  return `${sites.length} spawn sites: ${Object.entries(counts).map(([kind, n]) => `${n} ${kind}`).join(", ")}; 0 implicit`;
}

/* ---------------------------------------------------------------------------------------
   TI-2 — the shared rule
   --------------------------------------------------------------------------------------- */

function ti2(scratch) {
  const home = TestIsolation.realAccountHome();
  assert(home, "the OS account must have a home for the per-user rule to mean anything");
  for (const dir of TestIsolation.perUserConfigurationDirectories(home)) {
    assert.strictEqual(refusal(path.join(dir, "config.json"))?.code, "PER_USER_CONFIGURATION", `${dir} is live per-user settings`);
  }
  assert.strictEqual(refusal(path.join(TestIsolation.defaultProjectsRoot(home), "a-film"))?.code, "DEFAULT_PROJECTS_ROOT");
  assert.strictEqual(refusal(path.join(ROOT, "data", "config.json"))?.code, "INSIDE_APPLICATION", "install-local settings");
  assert.strictEqual(refusal(path.join(ROOT, "anywhere", "deep", "config.json"))?.code, "INSIDE_APPLICATION", "any path inside the install");
  assert.strictEqual(refusal(NOT_DISPOSABLE)?.code, "NOT_TEMPORARY", "a path outside the temporary directory");
  assert.strictEqual(refusal("")?.code, "MISSING");

  const other = fakeInstallation(scratch);
  assert.strictEqual(refusal(path.join(other, "data", "config.json"))?.code, "INSIDE_INSTALLATION", "another installation's settings");

  /* Physical, not lexical: a link inside the temporary directory into an installation. */
  const link = path.join(scratch, "link-into-install");
  fs.symlinkSync(other, link, process.platform === "win32" ? "junction" : "dir");
  assert.strictEqual(refusal(path.join(link, "data", "config.json"))?.code, "INSIDE_INSTALLATION", "a link cannot carry a path out");

  /* Settings relocated by the environment to somewhere real are live too. */
  const relocated = path.join(path.parse(os.tmpdir()).root, `cs1-relocated-${process.pid}`);
  const env = process.platform === "win32" ? { LOCALAPPDATA: relocated } : { XDG_CONFIG_HOME: relocated };
  const relocatedDir = process.platform === "win32" ? path.join(relocated, "CineBraid") : path.join(relocated, "cinebraid");
  assert.strictEqual(refusal(path.join(relocatedDir, "config.json"), { env })?.code, "PER_USER_CONFIGURATION");

  assert.strictEqual(refusal(path.join(scratch, "config.json")), null, "a temporary location is disposable");

  /* Synthetic account homes: the rule joins onto whatever home it is given. */
  assert.deepStrictEqual(TestIsolation.perUserConfigurationDirectories("/srv/account", "linux"), ["/srv/account/.config/cinebraid"]);
  assert.deepStrictEqual(TestIsolation.perUserConfigurationDirectories("/srv/account", "darwin"),
    ["/srv/account/Library/Application Support/CineBraid", "/srv/account/.config/cinebraid"]);
  assert.deepStrictEqual(TestIsolation.perUserConfigurationDirectories("Z:\\profile", "win32"),
    ["Z:\\profile\\AppData\\Local\\CineBraid", "Z:\\profile\\AppData\\Roaming\\CineBraid"]);
  return "per-user, default projects, install-local, inside-install, other installation, linked, relocated and non-temporary locations refused";
}

/* ---------------------------------------------------------------------------------------
   TI-3 — the seam is disposable by construction, credentials blank
   --------------------------------------------------------------------------------------- */

function ti3() {
  const saved = Object.fromEntries(CREDENTIAL_ENV.map((name) => [name, process.env[name]]));
  for (const name of CREDENTIAL_ENV) process.env[name] = SENTINEL;
  const workspace = disposableRoot("ti-defaults");
  try {
    assert(fs.existsSync(path.join(workspace.home, DISPOSABLE_MARKER)), "the workspace carries its marker");
    assert.strictEqual(refusal(workspace.configPath), null, "settings file disposable");
    assert.strictEqual(refusal(workspace.projectsRoot), null, "projects root disposable");
    const env = workspace.serverEnv(4999);
    assert.strictEqual(env.CINEBRAID_TEST_MODE, "1");
    assert.strictEqual(env.CINEBRAID_CONFIG_PATH, workspace.configPath);
    assert.strictEqual(env.CINEBRAID_PROJECTS_ROOT, workspace.projectsRoot);
    for (const name of CREDENTIAL_ENV) assert.strictEqual(env[name], "", `${name} must be blank even when inherited`);

    const { CONFIG_SECRETS } = require("../src/server/config");
    const config = JSON.parse(fs.readFileSync(workspace.configPath, "utf8"));
    assert.strictEqual(config.assistant.provider, "none");
    assert.strictEqual(config.generation.fal.enabled, false);
    const populated = CONFIG_SECRETS.filter((secret) => !secret.path.includes("[*]"))
      .filter((secret) => secret.path.split(".").reduce((node, key) => (node == null ? node : node[key]), config));
    assert.deepStrictEqual(populated, [], "the disposable settings carry no credential");
    assert.deepStrictEqual(config.accounts || [], []);

    const profiled = disposableRoot("ti-profile-env", { profile: true });
    try {
      for (const name of ["USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA", "XDG_CONFIG_HOME"]) {
        assert(TestIsolation.contains(TestIsolation.physical(profiled.home), TestIsolation.physical(profiled.env[name])),
          `${name} must point inside the disposable profile`);
      }
      assert.strictEqual(profiled.env.CINEBRAID_PROJECTS_ROOT, "", "a profiled run leaves the projects root to the default");
      assert.strictEqual(refusal(profiled.projectsRoot), null);
    } finally { profiled.cleanup(); }
  } finally {
    workspace.cleanup();
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
  return "marker, test mode, disposable paths, blank inherited credentials, credential-free settings, disposable profile";
}

/* ---------------------------------------------------------------------------------------
   TI-4 — the seam cannot be redirected
   --------------------------------------------------------------------------------------- */

/* A copy of the seam and its rule, in a temporary tree, with the account home replaced —
   so the per-user refusal is exercised against a fake home, never the real one. */
function stagedSeam(scratch, { fakeHome, helper = (text) => text } = {}) {
  const stage = fs.mkdtempSync(path.join(scratch, "seam-"));
  fs.mkdirSync(path.join(stage, "tests", "helpers"), { recursive: true });
  fs.mkdirSync(path.join(stage, "src", "server"), { recursive: true });
  let rule = fs.readFileSync(path.join(ROOT, "src", "server", "test-isolation.js"), "utf8");
  if (fakeHome) {
    rule = applyOnce(rule, 'function realAccountHome() {\n  try { return os.userInfo().homedir || ""; } catch { return ""; }\n}',
      `function realAccountHome() {\n  return ${JSON.stringify(fakeHome)};\n}`);
  }
  fs.writeFileSync(path.join(stage, "src", "server", "test-isolation.js"), rule);
  fs.writeFileSync(path.join(stage, "tests", "helpers", "disposable-root.js"), helper(fs.readFileSync(SEAM, "utf8")));
  return path.join(stage, "tests", "helpers", "disposable-root.js");
}

function nodeEval(code, env = {}) {
  return spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true });
}

function ti4(scratch) {
  for (const target of [ROOT, path.join(ROOT, "projects"), path.join(ROOT, "data", "qa")]) {
    assert.throws(() => disposableRoot("bad", { at: target }), /may not live inside the repository/, target);
  }
  const other = fakeInstallation(scratch, "redirect-install");
  const intoInstallation = path.join(other, "workspace");
  assert.throws(() => disposableRoot("bad", { at: intoInstallation }), /disposable location/);
  assert.strictEqual(fs.existsSync(intoInstallation), false, "a refused location is not created");

  assert.throws(() => disposableRoot("bad", { at: NOT_DISPOSABLE }), /disposable location/);
  assert.strictEqual(fs.existsSync(NOT_DISPOSABLE), false, "a refused location is not created");

  const occupied = fs.mkdtempSync(path.join(scratch, "occupied-"));
  fs.writeFileSync(path.join(occupied, "keep.txt"), "not the helper's");
  assert.throws(() => disposableRoot("bad", { at: occupied }), /start empty/);
  assert.strictEqual(fs.existsSync(path.join(occupied, "keep.txt")), true);

  /* The ordinary per-user settings location, against a fake account home. */
  const fakeHome = fs.mkdtempSync(path.join(scratch, "account-home-"));
  const helper = stagedSeam(scratch, { fakeHome });
  const perUser = path.join(TestIsolation.perUserConfigurationDirectories(fakeHome)[0], "workspace");
  const attempt = nodeEval(`try { require(${JSON.stringify(helper)}).disposableRoot("bad", { at: ${JSON.stringify(perUser)} }); console.log("CREATED"); }
    catch (error) { console.log("REFUSED " + error.message); }`);
  assert(/^REFUSED .*per-user configuration/m.test(attempt.stdout), attempt.stdout + attempt.stderr);
  assert.strictEqual(fs.existsSync(perUser), false, "the per-user location is not created");

  /* The command line the Python runtime drives has no path parameter at all. */
  const cli = spawnSync(process.execPath, [SEAM, "create", "--label", "ti-cli", "--at", NOT_DISPOSABLE, "--config", NOT_DISPOSABLE],
    { encoding: "utf8", windowsHide: true });
  assert.strictEqual(cli.status, 0, cli.stderr);
  const created = JSON.parse(cli.stdout.trim().split(/\r?\n/).pop());
  try {
    assert.strictEqual(refusal(created.home), null, "the command line always builds its own disposable workspace");
    assert.strictEqual(created.env.CINEBRAID_CONFIG_PATH, created.configPath);
    assert.strictEqual(fs.existsSync(NOT_DISPOSABLE), false);
  } finally {
    assert.strictEqual(spawnSync(process.execPath, [SEAM, "cleanup", "--home", created.home], { windowsHide: true }).status, 0);
  }
  assert.strictEqual(fs.existsSync(created.home), false);
  return "repository, other installation, non-temporary, occupied and per-user locations refused and not created; CLI has no path parameter";
}

/* ---------------------------------------------------------------------------------------
   TI-5 — deterministic cleanup
   --------------------------------------------------------------------------------------- */

function pythonInterpreter() {
  const venv = path.join(ROOT, ".venv-browser", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const candidates = [...(fs.existsSync(venv) ? [[venv, []]] : []), ...(process.platform === "win32" ? [["py", ["-3"]], ["python", []]] : [["python3", []], ["python", []]])];
  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, "--version"], { encoding: "utf8", windowsHide: true });
    if (!probe.error && probe.status === 0) return [command, prefix];
  }
  return null;
}

function ti5() {
  const workspace = disposableRoot("ti-cleanup");
  workspace.cleanup();
  assert.strictEqual(fs.existsSync(workspace.home), false, "cleanup removes the workspace");
  workspace.cleanup();

  const unmarked = disposableRoot("ti-unmarked");
  fs.unlinkSync(path.join(unmarked.home, DISPOSABLE_MARKER));
  assert.throws(() => unmarked.cleanup(), /marker/, "an unmarked directory is never removed");
  assert.strictEqual(fs.existsSync(unmarked.home), true);
  fs.writeFileSync(path.join(unmarked.home, DISPOSABLE_MARKER), "{}\n");
  unmarked.cleanup();
  assert.strictEqual(removeDisposableHome(NOT_DISPOSABLE), false, "nothing to remove where nothing exists");

  const helper = JSON.stringify(SEAM);
  const exited = nodeEval(`const w = require(${helper}).disposableRoot("ti-exit"); console.log(w.home);`);
  const exitedHome = exited.stdout.trim().split(/\r?\n/).pop();
  assert(exitedHome && fs.existsSync(path.dirname(exitedHome)), exited.stderr);
  assert.strictEqual(fs.existsSync(exitedHome), false, "a workspace left open is removed when the process exits");

  const crashed = nodeEval(`const w = require(${helper}).disposableRoot("ti-crash"); console.log(w.home); throw new Error("boom");`);
  assert.notStrictEqual(crashed.status, 0);
  const crashedHome = crashed.stdout.trim().split(/\r?\n/).pop();
  assert(crashedHome, crashed.stderr);
  assert.strictEqual(fs.existsSync(crashedHome), false, "and when it dies of an uncaught exception");

  const python = pythonInterpreter();
  if (!python) return "Node: explicit, repeated, unmarked, exit and crash; Python: NOT RUN (no interpreter) — delegation still asserted statically";
  const runtime = fs.readFileSync(path.join(ROOT, "tests", "browser_runtime.py"), "utf8");
  assert(/disposable-root\.js/.test(runtime) && !/tempfile\.mkdtemp/.test(runtime), "the Python runtime must drive the shared helper, not its own");
  const script = [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "tests"))})`,
    "from browser_runtime import disposable_workspace",
    "w = disposable_workspace('ti-python', sample=False)",
    "env = w.env(4998)",
    "print(json.dumps({'home': str(w.home), 'config': env['CINEBRAID_CONFIG_PATH'], 'configPath': str(w.config_path), 'fal': env['FAL_KEY'], 'mode': env['CINEBRAID_TEST_MODE']}))",
  ].join("\n");
  const run = spawnSync(python[0], [...python[1], "-c", script], { encoding: "utf8", env: { ...process.env, FAL_KEY: SENTINEL }, windowsHide: true });
  assert.strictEqual(run.status, 0, run.stderr);
  const reported = JSON.parse(run.stdout.trim().split(/\r?\n/).pop());
  assert.strictEqual(reported.config, reported.configPath);
  assert.strictEqual(reported.fal, "", "Python inherits the blank credential from the shared helper");
  assert.strictEqual(reported.mode, "1");
  assert.strictEqual(refusal(reported.config), null);
  assert.strictEqual(fs.existsSync(reported.home), false, "the Python atexit backstop removes the workspace");
  return "Node: explicit, repeated, unmarked, exit and crash; Python: shared helper, blank credential, atexit removal";
}

/* ---------------------------------------------------------------------------------------
   TI-6 — the ledger, and the gate that reads it
   --------------------------------------------------------------------------------------- */

function ti6(scratch) {
  const ledger = path.join(scratch, "ledger.jsonl");
  const run = nodeEval(`const s = require(${JSON.stringify(SEAM)});
    const a = s.disposableRoot("ti-ledger-a"); s.disposableRoot("ti-ledger-b"); a.cleanup();`, { [LEDGER_ENV]: ledger });
  assert.strictEqual(run.status, 0, run.stderr);
  const entries = readLedger(ledger);
  assert.deepStrictEqual(entries.map((entry) => entry.label), ["ti-ledger-a", "ti-ledger-b"]);
  assert.deepStrictEqual(verifyLedgerEntries(entries), [], "both disposable, both removed");

  const leftover = fs.mkdtempSync(path.join(scratch, "leftover-"));
  const problems = verifyLedgerEntries([
    { label: "live", home: "", configPath: path.join(ROOT, "data", "config.json"), projectsRoot: path.join(scratch, "p") },
    { label: "kept", home: leftover, configPath: path.join(leftover, "config.json"), projectsRoot: path.join(leftover, "projects") },
  ]);
  assert(problems.some((problem) => /^live: settings file .* was not disposable/.test(problem)), problems.join("\n"));
  assert(problems.some((problem) => /^kept: disposable workspace .* was left behind/.test(problem)), problems.join("\n"));

  const gate = fs.readFileSync(path.join(ROOT, "tests", "run-browser-gate.js"), "utf8");
  assert(/CINEBRAID_TEST_MODE: "1"/.test(gate), "the gate runs every suite declared as a test");
  assert(/\[LEDGER_ENV\]: ledger/.test(gate) && /verifyLedgerEntries\(/.test(gate), "the gate checks each suite's reported locations");
  assert(/liveConfigurationLocations\(ROOT\)/.test(gate), "the gate watches the live configuration locations");
  const firstRun = gate.slice(gate.indexOf("const FIRST_RUN_ARTIFACTS"), gate.indexOf("]);", gate.indexOf("const FIRST_RUN_ARTIFACTS")));
  assert(!firstRun.includes("data/config.json"), "the checkout's settings file appearing is damage, not bootstrapping");
  return "reported locations recorded; non-disposable and left-behind entries named; gate wired to both";
}

/* ---------------------------------------------------------------------------------------
   TI-7 — the server
   --------------------------------------------------------------------------------------- */

async function startServer(app, workspace, extra = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: app.app,
    env: workspace.serverEnv(port, { NODE_PATH: app.nodePath, NODE_ENV: "", ...extra }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const deadline = Date.now() + 25000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/me`)).ok) return { started: true, port, child, exited, output: () => output }; }
    catch { /* not up yet */ }
    if (child.exitCode !== null) return { started: false, code: await exited, output: () => output };
    if (Date.now() > deadline) { child.kill(); await exited; throw new Error(`server neither started nor exited:\n${output}`); }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function stopServer(server) {
  if (server && server.started) { server.child.kill(); await server.exited; }
}

function assertRefused(server, pattern, label) {
  assert.strictEqual(server.started, false, `${label}: must not start\n${server.output()}`);
  assert.notStrictEqual(server.code, 0, `${label}: must exit non-zero`);
  assert(/refused to start/i.test(server.output()), `${label}: must say so\n${server.output()}`);
  assert(pattern.test(server.output()), `${label}: must say why\n${server.output()}`);
}

async function ti7(scratch) {
  const app = stageInstallation("ti-server");
  const stagedSettings = path.join(app.app, "data", "config.json");
  const results = [];
  const saved = process.env.FAL_KEY;
  process.env.FAL_KEY = SENTINEL;
  try {
    /* A. An explicit disposable settings file works. */
    const explicit = disposableRoot("ti-explicit");
    const server = await startServer(app, explicit);
    try {
      assert.strictEqual(server.started, true, server.output());
      assert(server.output().includes(`Projects root: ${explicit.projectsRoot} (environment)`), server.output());
      assert.strictEqual(fs.existsSync(explicit.configPath), true);
      assert.strictEqual(fs.existsSync(stagedSettings), false, "the installation's own settings file is never created");

      const config = await (await fetch(`http://127.0.0.1:${server.port}/api/config`)).json();
      for (const key of ["anthropicKey", "openaiKey", "customKey"]) assert.strictEqual(config[key], "", `${key} begins blank`);
      assert.strictEqual(config.continuity.apiKey, "");
      assert.strictEqual(config.generation.fal.apiKey, "", "an inherited FAL_KEY does not reach the server");
      assert.strictEqual(config.generation.fal.keySource, "none");

      /* The running server cannot be pointed at a non-disposable location either. */
      const post = (projectRoot) => fetch(`http://127.0.0.1:${server.port}/api/workspace/settings`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace: { projectRoot } }),
      });
      const refusedMove = await post(NOT_DISPOSABLE);
      const refusedBody = await refusedMove.json();
      assert.strictEqual(refusedMove.status, 400, JSON.stringify(refusedBody));
      assert.strictEqual(refusedBody.code, "TEST_WORKSPACE_NOT_DISPOSABLE");
      assert.strictEqual(fs.existsSync(NOT_DISPOSABLE), false, "and nothing is created there");
      const allowedMove = await post(path.join(explicit.home, "moved-projects"));
      assert.strictEqual(allowedMove.status, 200, JSON.stringify(await allowedMove.json()));
      results.push("explicit disposable settings start; credentials blank; runtime move to a live location refused");
    } finally { await stopServer(server); explicit.cleanup(); }

    /* B. A disposable profile exercises the default projects root. */
    const profiled = disposableRoot("ti-profile", { profile: true });
    const defaultServer = await startServer(app, profiled);
    try {
      assert.strictEqual(defaultServer.started, true, defaultServer.output());
      assert(defaultServer.output().includes(`Projects root: ${profiled.projectsRoot} (default)`), defaultServer.output());
      results.push("disposable profile resolves the default projects root inside itself");
    } finally { await stopServer(defaultServer); profiled.cleanup(); }

    const refusals = disposableRoot("ti-refusals");
    try {
      /* C. No settings path: the installation's own settings file. */
      assertRefused(await startServer(app, refusals, { CINEBRAID_CONFIG_PATH: "" }), /settings file[\s\S]*application directory/, "implicit settings");
      assert.strictEqual(fs.existsSync(stagedSettings), false, "refused before anything was read or written");

      /* D. The installation's settings file, named explicitly. */
      assertRefused(await startServer(app, refusals, { CINEBRAID_CONFIG_PATH: stagedSettings }), /application directory/, "install-local settings");
      assert.strictEqual(fs.existsSync(stagedSettings), false);

      /* E. Anywhere else inside the installation. */
      const inside = path.join(app.app, "qa-probe", "config.json");
      assertRefused(await startServer(app, refusals, { CINEBRAID_CONFIG_PATH: inside }), /application directory/, "arbitrary path inside the install");
      assert.strictEqual(fs.existsSync(path.dirname(inside)), false);

      /* F. Another installation's settings file. */
      const other = path.join(fakeInstallation(refusals.home), "data", "config.json");
      assertRefused(await startServer(app, refusals, { CINEBRAID_CONFIG_PATH: other }), /CineBraid installation/, "another installation");
      assert.strictEqual(fs.existsSync(other), false);

      /* G. The ordinary per-user settings, against a fake account home in a second copy. */
      const fakeHome = fs.mkdtempSync(path.join(scratch, "server-account-home-"));
      const rule = fs.readFileSync(path.join(ROOT, "src", "server", "test-isolation.js"), "utf8");
      const perUserApp = stageInstallation("ti-per-user", { replace: { "src/server/test-isolation.js": applyOnce(rule,
        'function realAccountHome() {\n  try { return os.userInfo().homedir || ""; } catch { return ""; }\n}',
        `function realAccountHome() {\n  return ${JSON.stringify(fakeHome)};\n}`) } });
      try {
        const perUser = path.join(TestIsolation.perUserConfigurationDirectories(fakeHome)[0], "config.json");
        assertRefused(await startServer(perUserApp, refusals, { CINEBRAID_CONFIG_PATH: perUser }), /per-user configuration/, "ordinary per-user settings");
        assert.strictEqual(fs.existsSync(path.dirname(perUser)), false, "the per-user directory is not created");
      } finally { perUserApp.cleanup(); }

      /* H. A projects root that is not disposable. */
      assertRefused(await startServer(app, refusals, { CINEBRAID_PROJECTS_ROOT: NOT_DISPOSABLE }), /projects root[\s\S]*not disposable/, "live projects root");
      assert.strictEqual(fs.existsSync(NOT_DISPOSABLE), false);

      /* I. NODE_ENV=test arms the same refusal. */
      assertRefused(await startServer(app, refusals, { CINEBRAID_TEST_MODE: "", NODE_ENV: "test", CINEBRAID_CONFIG_PATH: "" }), /settings file/, "NODE_ENV=test");
      assert.strictEqual(fs.existsSync(stagedSettings), false);

      /* J. Undeclared, it is inert: ordinary startup is unchanged. */
      const ordinary = await startServer(app, refusals, { CINEBRAID_TEST_MODE: "", CINEBRAID_CONFIG_PATH: "" });
      try {
        assert.strictEqual(ordinary.started, true, "an ordinary run starts exactly as before: " + ordinary.output());
        assert.strictEqual(fs.existsSync(stagedSettings), true, "and creates its installation's settings on first run, as before");
      } finally { await stopServer(ordinary); }
      results.push("implicit, install-local, inside-install, other-installation, per-user and live-root locations refused before any read or write; NODE_ENV=test arms it; undeclared runs unchanged");
    } finally { refusals.cleanup(); }
  } finally {
    app.cleanup();
    if (saved === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = saved;
  }
  return results.join("; ");
}

/* --------------------------------------------------------------------------------------- */

async function main() {
  const live = liveStamps();
  const scratchWorkspace = disposableRoot("ti-scratch");
  const scratch = scratchWorkspace.home;
  const checks = [
    ["TI-1", "no server is started with implicit configuration authority", () => ti1()],
    ["TI-2", "the shared rule refuses every live location and accepts disposable ones", () => ti2(scratch)],
    ["TI-3", "the seam is disposable by construction and credentials begin blank", () => ti3()],
    ["TI-4", "callers cannot redirect the seam to a live location", () => ti4(scratch)],
    ["TI-5", "cleanup is deterministic", () => ti5()],
    ["TI-6", "reported locations are checked, and the browser gate checks them", () => ti6(scratch)],
    ["TI-7", "the server accepts disposable environments and refuses live ones before reading", () => ti7(scratch)],
  ];
  let failed = 0;
  try {
    for (const [id, claim, run] of checks) {
      try {
        const detail = await run();
        console.log(`  PASS  ${id}  ${claim}\n        ${detail}`);
      } catch (error) {
        failed += 1;
        console.log(`  FAIL  ${id}  ${claim}\n        ${error.stack || error.message}`);
      }
    }
    assert.deepStrictEqual(liveStamps(), live, "no live configuration location changed during this run");
    console.log("  PASS  live configuration locations unchanged by existence, size and modification time");
    assert.strictEqual(fs.existsSync(NOT_DISPOSABLE), false);
  } finally {
    scratchWorkspace.cleanup();
  }
  if (failed) {
    console.error(`\nCS-1 test isolation failed: ${failed} of ${checks.length} checks.`);
    process.exit(1);
  }
  console.log(`\nCS-1 test isolation passed: ${checks.length} checks.`);
}

module.exports = { classifySpawn, spawnSites, fakeInstallation, stagedSeam, startServer, stopServer, applyOnce, nodeEval, NOT_DISPOSABLE, SENTINEL };

if (require.main === module) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}

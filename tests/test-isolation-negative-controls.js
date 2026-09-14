"use strict";

/* CONFIG_STORAGE_SEPARATION_V1 — CS-1 NEGATIVE CONTROLS.
 *
 * tests/test-isolation.js is only worth what its checks can notice. Each control here
 * breaks one guarantee — in a disposable copy of the application or of the seam, never in
 * this checkout — shows the shipped code refuses, and shows the broken code does exactly
 * what the positive check exists to catch.
 *
 *   NC-TI-1  the settings refusal removed: a test run writes its installation's settings
 *   NC-TI-2  the refusal moved after the settings read: refused, but the file is written
 *   NC-TI-3  the per-user rule removed: a test run writes ordinary per-user settings
 *   NC-TI-4  the seam's location check removed: a workspace lands in an installation
 *   NC-TI-5  the seam's credential blanking removed: an inherited key reaches the server
 *   NC-TI-6  the exit backstop removed: a workspace outlives its process
 *   NC-TI-7  the ledger check removed: a live location reported by a suite goes unnamed
 *   NC-TI-8  the runtime storage refusal removed: a running test server moves into an installation
 *   NC-TI-9  the inventory classifier: an implicit server start is named as one
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const TestIsolation = require("../src/server/test-isolation");
const { ROOT, disposableRoot, stageInstallation, verifyLedgerEntries } = require("./helpers/disposable-root");
const {
  applyOnce, classifySpawn, fakeInstallation, nodeEval, spawnSites, stagedSeam, startServer, stopServer, SENTINEL,
} = require("./test-isolation");

const SERVER = fs.readFileSync(path.join(ROOT, "src", "server", "server.js"), "utf8").replace(/\r\n/g, "\n");
const RULE = fs.readFileSync(path.join(ROOT, "src", "server", "test-isolation.js"), "utf8").replace(/\r\n/g, "\n");
const HOME_FN = 'function realAccountHome() {\n  try { return os.userInfo().homedir || ""; } catch { return ""; }\n}';
const withHome = (rule, home) => applyOnce(rule, HOME_FN, `function realAccountHome() {\n  return ${JSON.stringify(home)};\n}`);

async function nc1(scratch) {
  const shipped = stageInstallation("nc1-shipped");
  const broken = stageInstallation("nc1-broken", { replace: { "src/server/server.js":
    applyOnce(SERVER, "refuseTestConfigOutsideDisposableEnvironment();\nrefuseTestRunInsideTheInstall();\n", "refuseTestRunInsideTheInstall();\n") } });
  const workspace = disposableRoot("nc1");
  try {
    const refused = await startServer(shipped, workspace, { CINEBRAID_CONFIG_PATH: "" });
    assert.strictEqual(refused.started, false, "shipped: refused");
    assert.strictEqual(fs.existsSync(path.join(shipped.app, "data", "config.json")), false, "shipped: nothing written");

    const started = await startServer(broken, workspace, { CINEBRAID_CONFIG_PATH: "" });
    try {
      assert.strictEqual(started.started, true, "broken: a test run starts on its installation's settings: " + started.output());
      assert.strictEqual(fs.existsSync(path.join(broken.app, "data", "config.json")), true, "broken: and writes them");
    } finally { await stopServer(started); }
  } finally { workspace.cleanup(); shipped.cleanup(); broken.cleanup(); }
  return "without the refusal a test run reads and writes its installation's settings file";
}

async function nc2() {
  const late = applyOnce(
    applyOnce(SERVER, "refuseTestConfigOutsideDisposableEnvironment();\nrefuseTestRunInsideTheInstall();\n", "refuseTestRunInsideTheInstall();\n"),
    "  migrateConfigFile();\n} catch (error) {",
    "  migrateConfigFile();\n  refuseTestConfigOutsideDisposableEnvironment();\n} catch (error) {");
  const broken = stageInstallation("nc2-late", { replace: { "src/server/server.js": late } });
  const workspace = disposableRoot("nc2");
  try {
    const run = await startServer(broken, workspace, { CINEBRAID_CONFIG_PATH: "" });
    assert.strictEqual(run.started, false, "late: still refuses");
    assert.strictEqual(fs.existsSync(path.join(broken.app, "data", "config.json")), true,
      "late: but only after the settings file was already written — which TI-7 C rejects");
  } finally { workspace.cleanup(); broken.cleanup(); }
  return "a refusal after the settings read still refuses, and has already written the file";
}

async function nc3(scratch) {
  const fakeHome = fs.mkdtempSync(path.join(scratch, "nc3-home-"));
  const perUser = path.join(TestIsolation.perUserConfigurationDirectories(fakeHome)[0], "config.json");
  const shipped = stageInstallation("nc3-shipped", { replace: { "src/server/test-isolation.js": withHome(RULE, fakeHome) } });
  const broken = stageInstallation("nc3-broken", { replace: { "src/server/test-isolation.js": applyOnce(withHome(RULE, fakeHome),
    "  if (liveConfigurationDirectories({ home, env, platform, tmpdir }).some((dir) => contains(physical(dir), real))) {",
    "  if (false) {") } });
  const workspace = disposableRoot("nc3");
  try {
    const refused = await startServer(shipped, workspace, { CINEBRAID_CONFIG_PATH: perUser });
    assert.strictEqual(refused.started, false, "shipped: refused");
    assert.strictEqual(fs.existsSync(perUser), false);

    const started = await startServer(broken, workspace, { CINEBRAID_CONFIG_PATH: perUser });
    try {
      assert.strictEqual(started.started, true, "broken: a test run starts on per-user settings: " + started.output());
      assert.strictEqual(fs.existsSync(perUser), true, "broken: and writes them");
    } finally { await stopServer(started); }
  } finally { workspace.cleanup(); shipped.cleanup(); broken.cleanup(); }
  return "without the per-user rule a test run writes the (fake) account's ordinary settings";
}

function nc4(scratch) {
  const shipped = stagedSeam(scratch);
  const broken = stagedSeam(scratch, { helper: (text) => applyOnce(text,
    "    if (why) throw new Error(`A disposable workspace must be in a disposable location",
    "    if (false && why) throw new Error(`A disposable workspace must be in a disposable location") });
  const other = fakeInstallation(fs.mkdtempSync(path.join(scratch, "nc4-")));
  const target = path.join(other, "workspace");
  const attempt = (helper) => nodeEval(`try { const w = require(${JSON.stringify(helper)}).disposableRoot("nc4", { at: ${JSON.stringify(target)} });
    console.log("CREATED"); w.cleanup(); } catch (error) { console.log("REFUSED " + error.message); }`);
  const refused = attempt(shipped);
  assert(/^REFUSED /m.test(refused.stdout), refused.stdout + refused.stderr);
  assert.strictEqual(fs.existsSync(target), false);
  const created = attempt(broken);
  assert(/^CREATED/m.test(created.stdout), "broken: the seam builds a workspace inside an installation: " + created.stdout + created.stderr);
  return "without the location check the seam builds inside another installation";
}

function nc5(scratch) {
  const shipped = stagedSeam(scratch);
  const broken = stagedSeam(scratch, { helper: (text) => applyOnce(text,
    "    ...Object.fromEntries(CREDENTIAL_ENV.map((name) => [name, \"\"])),\n", "") });
  const probe = (helper) => nodeEval(`const w = require(${JSON.stringify(helper)}).disposableRoot("nc5");
    console.log(JSON.stringify(w.serverEnv(1).FAL_KEY)); w.cleanup();`, { FAL_KEY: SENTINEL });
  assert.strictEqual(probe(shipped).stdout.trim(), '""', "shipped: blank");
  assert.strictEqual(probe(broken).stdout.trim(), JSON.stringify(SENTINEL), "broken: the inherited key survives into the server's environment");
  return "without blanking, an inherited provider key reaches the test server";
}

function nc6(scratch) {
  const shipped = stagedSeam(scratch);
  const broken = stagedSeam(scratch, { helper: (text) => applyOnce(text, 'process.on("exit", () => {', 'process.on("cs1-never", () => {') });
  const leave = (helper) => nodeEval(`console.log(require(${JSON.stringify(helper)}).disposableRoot("nc6").home);`).stdout.trim().split(/\r?\n/).pop();
  const shippedHome = leave(shipped);
  assert.strictEqual(fs.existsSync(shippedHome), false, "shipped: removed at exit");
  const brokenHome = leave(broken);
  try {
    assert.strictEqual(fs.existsSync(brokenHome), true, "broken: the workspace outlives its process");
  } finally { fs.rmSync(brokenHome, { recursive: true, force: true }); }
  return "without the backstop a workspace outlives the process that made it";
}

function nc7(scratch) {
  const entry = { label: "live", home: "", configPath: path.join(ROOT, "data", "config.json"), projectsRoot: path.join(scratch, "p") };
  assert.strictEqual(verifyLedgerEntries([entry]).length, 1, "shipped: named");
  const broken = stagedSeam(scratch, { helper: (text) => applyOnce(text,
    "      if (why) problems.push(`${entry.label}: ${subject} ${target} was not disposable (${why.reason})`);\n", "") });
  const run = nodeEval(`console.log(require(${JSON.stringify(broken)}).verifyLedgerEntries([${JSON.stringify(entry)}]).length);`);
  assert.strictEqual(run.stdout.trim(), "0", "broken: a suite that used the checkout's settings passes the gate unnamed");
  return "without the ledger check a live settings file reported by a suite goes unnamed";
}

async function nc8(scratch) {
  const broken = stageInstallation("nc8-broken", { replace: { "src/server/server.js":
    applyOnce(SERVER, "    if (TEST_MODE) {\n      const refused = paths", "    if (false) {\n      const refused = paths") } });
  const shipped = stageInstallation("nc8-shipped");
  const workspace = disposableRoot("nc8");
  const other = fakeInstallation(workspace.home);
  const move = async (app, projectRoot) => {
    const server = await startServer(app, workspace);
    try {
      assert.strictEqual(server.started, true, server.output());
      return (await fetch(`http://127.0.0.1:${server.port}/api/workspace/settings`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace: { projectRoot } }),
      })).status;
    } finally { await stopServer(server); }
  };
  try {
    const shippedTarget = path.join(other, "projects-shipped");
    assert.strictEqual(await move(shipped, shippedTarget), 400, "shipped: refused");
    assert.strictEqual(fs.existsSync(shippedTarget), false);
    const brokenTarget = path.join(other, "projects-broken");
    assert.strictEqual(await move(broken, brokenTarget), 200, "broken: accepted");
    assert.strictEqual(fs.existsSync(brokenTarget), true, "broken: and created inside the installation");
  } finally { workspace.cleanup(); shipped.cleanup(); broken.cleanup(); }
  return "without the runtime refusal a running test server moves its projects into an installation";
}

function nc9() {
  const implicit = "const child = spawn(process.execPath, [\"server.js\"], { cwd: ROOT, env: { ...process.env, PORT: String(port) } });";
  assert.deepStrictEqual(spawnSites("tests/synthetic.js", implicit).map((site) => site.kind), ["implicit"]);
  const python = "server=subprocess.Popen(['node','server.js'],cwd=ROOT,env={**os.environ,'PORT':str(port)})";
  assert.deepStrictEqual(spawnSites("tests/synthetic.py", python).map((site) => site.kind), ["implicit"]);
  const unproven = "const d = '/srv/x'; spawn(process.execPath, [\"server.js\"], { env: { ...process.env, CINEBRAID_CONFIG_PATH: d, CINEBRAID_PROJECTS_ROOT: d } });";
  assert.strictEqual(classifySpawn("tests/synthetic.js", unproven, unproven), "implicit", "named variables without disposable evidence prove nothing");
  const seam = "const w = disposableRoot('x'); spawn(process.execPath, [\"server.js\"], { env: w.serverEnv(port) });";
  assert.deepStrictEqual(spawnSites("tests/synthetic.js", seam).map((site) => site.kind), ["seam"]);
  return "implicit Node and Python starts named; unproven explicit settings named; seam starts accepted";
}

async function main() {
  const scratchWorkspace = disposableRoot("nc-ti-scratch");
  const scratch = scratchWorkspace.home;
  const controls = [
    ["NC-TI-1", () => nc1(scratch)],
    ["NC-TI-2", () => nc2()],
    ["NC-TI-3", () => nc3(scratch)],
    ["NC-TI-4", () => nc4(scratch)],
    ["NC-TI-5", () => nc5(scratch)],
    ["NC-TI-6", () => nc6(scratch)],
    ["NC-TI-7", () => nc7(scratch)],
    ["NC-TI-8", () => nc8(scratch)],
    ["NC-TI-9", () => nc9()],
  ];
  let failed = 0;
  try {
    for (const [id, run] of controls) {
      try { console.log(`  PASS  ${id}  ${await run()}`); }
      catch (error) { failed += 1; console.log(`  FAIL  ${id}  ${error.stack || error.message}`); }
    }
  } finally { scratchWorkspace.cleanup(); }
  if (failed) {
    console.error(`\nCS-1 negative controls failed: ${failed} of ${controls.length}.`);
    process.exit(1);
  }
  console.log(`\nCS-1 negative controls passed: ${controls.length} controls, each shown able to fail.`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

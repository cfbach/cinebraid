"use strict";

/* CONFIG_STORAGE_SEPARATION_V1 — CS-2 NEGATIVE CONTROLS.
 *
 * tests/config-location.js is only worth what its checks can notice. Each control breaks one
 * guarantee in a disposable COPY — of the module, or of the whole application — shows the
 * shipped code holds, and shows the broken code does exactly what the positive check exists
 * to catch. Nothing here runs outside a disposable profile.
 *
 *   NC-CL-1   publication by rename: a destination another process published is overwritten
 *   NC-CL-2   normalise before copying: the move is no longer byte for byte
 *   NC-CL-3   migration under an override: an override run creates per-user settings
 *   NC-CL-4   fallback to the old settings when the per-user file is unreadable
 *   NC-CL-5   a parse message in a refusal: part of a credential reaches the console
 *   NC-CL-6   a raw profile path in the startup line
 *   NC-CL-7   a hardcoded project folder: a real install's own folder fails verification
 *   NC-CL-8   activation before the test-isolation check: a test run moves real settings
 *   NC-CL-9   the exact path disclosed to a LAN device
 *   NC-CL-10  the backup written beside the old settings instead of the per-user file
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, disposableRoot, stageInstallation } = require("./helpers/disposable-root");
const Suite = require("./config-location");
const ConfigLocation = require("../src/server/config-location");

const { Config, SENTINEL, bytesOf, getJson, legacyDocument, legacyStamps, migrate, startApp, stopApp, unitLocation, writeLegacy } = Suite;
const normalise = (text) => text.replace(/\r\n/g, "\n");
const MODULE = normalise(fs.readFileSync(path.join(ROOT, "src", "server", "config-location.js"), "utf8"));
const CONFIG = normalise(fs.readFileSync(path.join(ROOT, "src", "server", "config.js"), "utf8"));
const SERVER = normalise(fs.readFileSync(path.join(ROOT, "src", "server", "server.js"), "utf8"));

function applyOnce(text, from, to) {
  const found = text.split(from).length - 1;
  assert.strictEqual(found, 1, `expected one occurrence of ${JSON.stringify(from.slice(0, 70))}, found ${found}; this control is not armed`);
  return text.replace(from, to);
}

/* A broken copy of config-location.js, loaded from a disposable folder beside its one dependency. */
function brokenModule(scratch, from, to) {
  const dir = fs.mkdtempSync(path.join(scratch, "module-"));
  fs.writeFileSync(path.join(dir, "config-location.js"), applyOnce(MODULE, from, to));
  fs.copyFileSync(path.join(ROOT, "src", "server", "loopback-request.js"), path.join(dir, "loopback-request.js"));
  return require(path.join(dir, "config-location.js"));
}

function racing(competitor) {
  const hook = (real) => (from, to) => { fs.writeFileSync(to, competitor); return real(from, to); };
  return { ...fs, linkSync: hook(fs.linkSync), renameSync: hook(fs.renameSync) };
}

function nc1(scratch) {
  const broken = brokenModule(scratch, "      ops.linkSync(temp, destination);\n", "      ops.renameSync(temp, destination);\n");
  const legacy = bytesOf(legacyDocument({}));
  const competitor = bytesOf(legacyDocument({ openai: SENTINEL.perUser }));
  const shipped = unitLocation("nc1-shipped");
  const mutated = unitLocation("nc1-broken");
  try {
    fs.writeFileSync(shipped.location.legacyPath, legacy);
    fs.writeFileSync(mutated.location.legacyPath, legacy);
    migrate(shipped.location, shipped.appRoot, racing(competitor));
    assert(fs.readFileSync(shipped.location.path).equals(competitor), "shipped: the competitor's file stands");
    migrate(mutated.location, mutated.appRoot, racing(competitor), broken);
    assert(fs.readFileSync(mutated.location.path).equals(legacy), "broken: rename replaced the file another process published");
  } finally { shipped.workspace.cleanup(); mutated.workspace.cleanup(); }
  return "rename instead of link overwrites a per-user file that appeared mid-move";
}

function nc2(scratch) {
  const broken = brokenModule(scratch,
    "    chosen = { source, candidate, bytes: Buffer.from(bytes), parsed };",
    "    chosen = { source, candidate, bytes: Buffer.from(JSON.stringify(parsed, null, 2)), parsed };");
  const raw = Buffer.from("﻿" + JSON.stringify(legacyDocument({ unknown: true })) + "\n");
  const shipped = unitLocation("nc2-shipped");
  const mutated = unitLocation("nc2-broken");
  try {
    fs.writeFileSync(shipped.location.legacyPath, raw);
    fs.writeFileSync(mutated.location.legacyPath, raw);
    migrate(shipped.location, shipped.appRoot);
    assert(fs.readFileSync(shipped.location.path).equals(raw), "shipped: byte for byte, BOM and formatting included");
    migrate(mutated.location, mutated.appRoot, fs, broken);
    assert(!fs.readFileSync(mutated.location.path).equals(raw), "broken: the moved file is no longer the original bytes");
  } finally { shipped.workspace.cleanup(); mutated.workspace.cleanup(); }
  return "copying the parsed document instead of the bytes loses the original file — which CL-2's byte check catches";
}

async function nc3() {
  const broken = stageInstallation("nc3-broken", { replace: { "src/server/config.js": applyOnce(CONFIG,
    '  if (CONFIG_LOCATION.mode === "override") return { state: "override" };',
    '  if (CONFIG_LOCATION.mode === "override") {\n'
    + '    const perUser = ConfigLocation.resolveConfigLocation({ env: { ...process.env, CINEBRAID_CONFIG_PATH: "" }, platform: process.platform, appRoot: APP_ROOT });\n'
    + '    return ConfigLocation.activatePerUserSettings({ location: perUser, appRoot: APP_ROOT, parseBytes: parseConfigBytes, presence: secretPresence });\n'
    + '  }') } });
  const shipped = stageInstallation("nc3-shipped");
  const outcome = async (app, label) => {
    const workspace = disposableRoot(label, { profile: true });
    writeLegacy(app, { primary: bytesOf(legacyDocument({})) });
    const perUser = ConfigLocation.resolveConfigLocation({ env: { ...workspace.env, CINEBRAID_CONFIG_PATH: "" }, appRoot: app.app });
    const server = await startApp(app, workspace);
    try {
      assert.strictEqual(server.started, true, server.output());
      return fs.existsSync(perUser.path);
    } finally { await stopApp(server); workspace.cleanup(); }
  };
  try {
    assert.strictEqual(await outcome(shipped, "nc3-shipped"), false, "shipped: an override run creates no per-user settings");
    assert.strictEqual(await outcome(broken, "nc3-broken"), true, "broken: it moves the old settings anyway");
  } finally { shipped.cleanup(); broken.cleanup(); }
  return "an override that still migrates creates per-user settings — which CL-5 catches";
}

async function nc4() {
  const broken = stageInstallation("nc4-broken", { replace: { "src/server/config.js": applyOnce(CONFIG,
    "  if (!recoveredConfig) {\n    throw new ConfigUnreadableError(",
    "  if (!recoveredConfig) {\n    try { recoveredConfig = parseConfigDocument(CONFIG_LOCATION.legacyPath); } catch {}\n  }\n  if (!recoveredConfig) {\n    throw new ConfigUnreadableError(") } });
  const shipped = stageInstallation("nc4-shipped");
  const outcome = async (app, label) => {
    const workspace = disposableRoot(label, { profile: true, perUserSettings: true });
    writeLegacy(app, { primary: bytesOf(legacyDocument({ openai: SENTINEL.edited })) });
    fs.mkdirSync(path.dirname(workspace.configPath), { recursive: true });
    fs.writeFileSync(workspace.configPath, "{ torn");
    fs.writeFileSync(`${workspace.configPath}.bak`, "{ torn too");
    const server = await startApp(app, workspace);
    try {
      if (!server.started) return "refused";
      return (await getJson(server, "/api/config")).body.openaiKey === Config.maskSecretValue(SENTINEL.edited) ? "running on the old settings" : "running";
    } finally { await stopApp(server); workspace.cleanup(); }
  };
  try {
    assert.strictEqual(await outcome(shipped, "nc4-shipped"), "refused", "shipped: refused");
    assert.strictEqual(await outcome(broken, "nc4-broken"), "running on the old settings", "broken: silently running on the old settings");
  } finally { shipped.cleanup(); broken.cleanup(); }
  return "falling back to the old settings turns an unreadable per-user file into a silently different install — which CL-8 catches";
}

function nc5(scratch) {
  let leakySource = applyOnce(MODULE, "  let chosen = null;\n", "  let chosen = null;\n  let lastParseError = null;\n");
  leakySource = applyOnce(leakySource,
    "    try { parsed = parseBytes(bytes); } catch { continue; }",
    "    try { parsed = parseBytes(bytes); } catch (error) { lastParseError = error; continue; }");
  leakySource = applyOnce(leakySource,
    '    throw migrationFailed("LEGACY_UNREADABLE", "the settings in the application folder could not be read, and neither could their backup");',
    '    throw migrationFailed("LEGACY_UNREADABLE", `the settings in the application folder could not be read (${lastParseError && lastParseError.message})`);');
  const dir = fs.mkdtempSync(path.join(scratch, "module-leaky-"));
  fs.writeFileSync(path.join(dir, "config-location.js"), leakySource);
  fs.copyFileSync(path.join(ROOT, "src", "server", "loopback-request.js"), path.join(dir, "loopback-request.js"));
  const leaky = require(path.join(dir, "config-location.js"));
  const malformed = Buffer.from(SENTINEL.openai);
  const reasonFrom = (module) => {
    const unit = unitLocation("nc5");
    try {
      fs.writeFileSync(unit.location.legacyPath, malformed);
      try { migrate(unit.location, unit.appRoot, fs, module); } catch (error) { return error.reason; }
      return "";
    } finally { unit.workspace.cleanup(); }
  };
  const tail = SENTINEL.openai.slice(0, 10);
  assert(!reasonFrom(ConfigLocation).includes(tail), "shipped: the refusal carries no part of the value");
  assert(reasonFrom(leaky).includes(tail), "broken: the parser's message quotes part of the credential");
  return "passing the parse error through puts part of a credential in the startup refusal — which CL-8 catches";
}

function nc6(scratch) {
  const broken = brokenModule(scratch, "  return `Settings: per-user (${location.symbolic})${moved}`;", "  return `Settings: per-user (${location.path})${moved}`;");
  const location = { mode: "per-user", path: path.join(scratch, "profile", "CineBraid", "config.json"), symbolic: "%LOCALAPPDATA%\\CineBraid\\config.json" };
  assert(!ConfigLocation.startupSettingsLine(location).includes(location.path), "shipped: symbolic");
  assert(broken.startupSettingsLine(location).includes(location.path), "broken: the profile path is printed");
  return "a startup line built from the resolved path prints the profile — which CL-1 catches";
}

function nc7(scratch) {
  const broken = brokenModule(scratch,
    "  return (left && left.workspace && left.workspace.projectRoot) === (right && right.workspace && right.workspace.projectRoot);",
    '  return (left && left.workspace && left.workspace.projectRoot) === "/example/projects";');
  const outcome = (module) => {
    const unit = unitLocation("nc7");
    try {
      fs.writeFileSync(unit.location.legacyPath, bytesOf(legacyDocument({ projectRoot: path.join(unit.workspace.home, "their-own-projects") })));
      try { return migrate(unit.location, unit.appRoot, fs, module).state; } catch (error) { return error.reasonCode; }
    } finally { unit.workspace.cleanup(); }
  };
  assert.strictEqual(outcome(ConfigLocation), "migrated", "shipped: an install's own project folder is preserved");
  assert.strictEqual(outcome(broken), "VERIFICATION_MISMATCH", "broken: a hardcoded folder rejects every other install");
  return "expecting one particular project folder fails any install whose folder is different — which CL-2's disposable folders catch";
}

async function nc8() {
  const late = applyOnce(SERVER,
    "refuseTestConfigOutsideDisposableEnvironment();\nconst CONFIG_ACTIVATION = activateConfigLocationOrRefuse();\n",
    "const CONFIG_ACTIVATION = activateConfigLocationOrRefuse();\nrefuseTestConfigOutsideDisposableEnvironment();\n");
  const outcome = async (replace, label) => {
    const app = stageInstallation(label, { replace });
    const signature = [path.join(app.workspace.home, "server.js"), path.join(app.workspace.home, "src", "server", "config.js")];
    fs.mkdirSync(path.dirname(signature[1]), { recursive: true });
    for (const file of signature) fs.writeFileSync(file, "// makes the parent look like an installation\n");
    const workspace = disposableRoot(label, { profile: true, perUserSettings: true });
    try {
      writeLegacy(app, { primary: bytesOf(legacyDocument({})) });
      const server = await startApp(app, workspace);
      await stopApp(server);
      return fs.existsSync(workspace.configPath);
    } finally {
      fs.rmSync(path.join(app.workspace.home, "src"), { recursive: true, force: true });
      for (const file of signature) fs.rmSync(file, { force: true });
      workspace.cleanup();
      app.cleanup();
    }
  };
  assert.strictEqual(await outcome({}, "nc8-shipped"), false, "shipped: refused before anything is moved");
  assert.strictEqual(await outcome({ "src/server/server.js": late }, "nc8-broken"), true, "broken: the settings are moved before the check runs");
  return "activating before the test-isolation check moves a non-disposable install's settings — which CL-11 catches";
}

function nc9(scratch) {
  const broken = brokenModule(scratch,
    "  const exact = isLoopbackRequest(req) && !FORWARDING_HEADERS.some((name) => headers[name] !== undefined);",
    "  const exact = true;");
  const location = { mode: "per-user", path: path.join(scratch, "profile", "config.json"), symbolic: "%LOCALAPPDATA%\\CineBraid\\config.json" };
  const lan = { socket: { remoteAddress: "192.168.1.20" }, headers: {} };
  assert.strictEqual(ConfigLocation.settingsLocationDisclosure(lan, location).path, "", "shipped: symbolic");
  assert.strictEqual(broken.settingsLocationDisclosure(lan, location).path, location.path, "broken: a LAN device receives the profile path");
  return "an unconditional disclosure hands a LAN device the host's profile path — which CL-10 catches";
}

async function nc10() {
  const broken = stageInstallation("nc10-broken", { replace: { "src/server/config.js": applyOnce(CONFIG,
    'const CONFIG_BACKUP_PATH = CONFIG_PATH ? `${CONFIG_PATH}.bak` : "";',
    'const CONFIG_BACKUP_PATH = path.join(APP_ROOT, "data", "config.json.bak");') } });
  const shipped = stageInstallation("nc10-shipped");
  const outcome = async (app, label) => {
    const workspace = disposableRoot(label, { profile: true, perUserSettings: true });
    writeLegacy(app, { primary: bytesOf(legacyDocument({})) });
    const server = await startApp(app, workspace);
    try {
      const before = legacyStamps(app);
      const put = await getJson(server, "/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ appearance: { density: "compact" } }) });
      assert.strictEqual(put.status, 200, put.text);
      return JSON.stringify(legacyStamps(app)) === JSON.stringify(before);
    } finally { await stopApp(server); workspace.cleanup(); }
  };
  try {
    assert.strictEqual(await outcome(shipped, "nc10-shipped"), true, "shipped: the application folder is untouched by a write");
    assert.strictEqual(await outcome(broken, "nc10-broken"), false, "broken: the backup lands beside the old settings");
  } finally { shipped.cleanup(); broken.cleanup(); }
  return "a backup path that is not beside the per-user file writes into the application folder — which CL-9 catches";
}

async function main() {
  const scratchWorkspace = disposableRoot("nc-cl-scratch");
  const scratch = scratchWorkspace.home;
  const controls = [
    ["NC-CL-1", () => nc1(scratch)],
    ["NC-CL-2", () => nc2(scratch)],
    ["NC-CL-3", () => nc3()],
    ["NC-CL-4", () => nc4()],
    ["NC-CL-5", () => nc5(scratch)],
    ["NC-CL-6", () => nc6(scratch)],
    ["NC-CL-7", () => nc7(scratch)],
    ["NC-CL-8", () => nc8()],
    ["NC-CL-9", () => nc9(scratch)],
    ["NC-CL-10", () => nc10()],
  ];
  let failed = 0;
  try {
    for (const [id, run] of controls) {
      try { console.log(`  PASS  ${id}  ${await run()}`); }
      catch (error) { failed += 1; console.log(`  FAIL  ${id}  ${error.stack || error.message}`); }
    }
  } finally { scratchWorkspace.cleanup(); }
  if (failed) {
    console.error(`\nCS-2 negative controls failed: ${failed} of ${controls.length}.`);
    process.exit(1);
  }
  console.log(`\nCS-2 negative controls passed: ${controls.length} controls, each shown able to fail.`);
}

void Config;
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

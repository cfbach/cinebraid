"use strict";

/* CONFIG_STORAGE_SEPARATION_V1 — CS-2, SETTINGS OUTSIDE THE APPLICATION FOLDER.
 *
 * THE INVARIANT. Private, mutable settings live in the account's per-user settings location.
 * An explicit CINEBRAID_CONFIG_PATH is the top authority. An existing per-user file is the
 * authority after that and is never replaced, merged or quietly abandoned. An install that
 * still keeps data/config.json has it moved once — every byte, every field, the saved project
 * folder exactly — and the original is left where it was. A fresh install writes only to the
 * per-user location.
 *
 * NOTHING HERE TOUCHES A REAL LOCATION. Every server runs from a disposable copy of the
 * application (stageInstallation), declared as a test, inside a disposable profile whose
 * LOCALAPPDATA / HOME / XDG_CONFIG_HOME point into the temporary directory. The one server
 * that runs undeclared (CL-14) is given no resolvable location at all. This process itself
 * names a disposable settings file before it loads config.js. Every credential is a sentinel.
 *
 *   CL-1   fresh install                         CL-9   writes and sidecars after activation
 *   CL-2   legacy migration, byte for byte       CL-10  masking and local-versus-LAN disclosure
 *   CL-3   already migrated                      CL-11  test-isolation ordering
 *   CL-4   both present, never merged            CL-12  project-root authority unchanged
 *   CL-5   explicit override                     CL-13  rollback to the previous build
 *   CL-6   interrupted migration                 CL-14  no resolvable per-user location
 *   CL-7   destination race                      CL-15  permissions
 *   CL-8   malformed and unreadable settings     CL-16  nothing removes the old settings
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn, spawnSync } = require("child_process");
const { ROOT, disposableRoot, stageInstallation } = require("./helpers/disposable-root");
const ConfigLocation = require("../src/server/config-location");
const { freePort } = require("./fixtures/mock-civitai");

/* Before config.js is loaded: nothing this process calls can resolve a real settings file. */
const SCRATCH = disposableRoot("cl-scratch");
process.env.CINEBRAID_CONFIG_PATH = SCRATCH.configPath;
const Config = require("../src/server/config");

const SENTINEL = {
  openai: "cs2-sentinel-openai-legacy-A1b2",
  fal: "cs2-sentinel-fal-legacy-C3d4",
  account: "cs2-sentinel-account-legacy-E5f6",
  backup: "cs2-sentinel-openai-backup-Q7w6",
  edited: "cs2-sentinel-openai-edited-Z9y8",
  perUser: "cs2-sentinel-openai-peruser-K2m4",
};
const PREVIOUS_BUILD = "216a96963dcdb1e88f76e8cf1f68c6d674ef5da5";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/* ---------------------------------------------------------------------------------------- */

function legacyDocument({ projectRoot = "", unknown = false, openai = SENTINEL.openai } = {}) {
  const document = Config.normalizeConfig({
    assistant: { provider: "none", visionProvider: "none" },
    agents: { enabled: false },
    openaiKey: openai,
    generation: { fal: { enabled: false, apiKey: SENTINEL.fal } },
    accounts: [{ connectionId: "cs2-account", providerId: "civitai", label: "fixture", credential: { apiKey: SENTINEL.account } }],
    workspace: projectRoot ? { projectRoot } : {},
    activeProject: "",
  });
  return unknown ? { ...document, cs2FutureSetting: { kept: true, list: [1, 2, 3] } } : document;
}
const bytesOf = (document) => Buffer.from(JSON.stringify(document, null, 2));

const LEGACY_FILES = ["config.json", "config.json.bak", "config.json.corrupt"];
function writeLegacy(app, { primary, backup, corrupt } = {}) {
  const data = path.join(app.app, "data");
  for (const name of LEGACY_FILES) fs.rmSync(path.join(data, name), { force: true, recursive: true });
  if (primary) fs.writeFileSync(path.join(data, "config.json"), primary);
  if (backup) fs.writeFileSync(path.join(data, "config.json.bak"), backup);
  if (corrupt) fs.writeFileSync(path.join(data, "config.json.corrupt"), corrupt);
}
function stamp(target) {
  try {
    const stat = fs.statSync(target);
    return stat.isDirectory() ? "directory" : `${stat.size}:${stat.mtimeMs}:${sha(fs.readFileSync(target))}`;
  } catch { return "absent"; }
}
function legacyStamps(app) {
  const data = path.join(app.app, "data");
  return { names: fs.readdirSync(data).sort(), ...Object.fromEntries(LEGACY_FILES.map((name) => [name, stamp(path.join(data, name))])) };
}
function perUserEntries(workspace) {
  try { return fs.readdirSync(path.dirname(workspace.configPath)).sort(); } catch { return null; }
}
function writeProjects(root, slugs) {
  for (const slug of slugs) {
    fs.mkdirSync(path.join(root, slug), { recursive: true });
    fs.writeFileSync(path.join(root, slug, "project.json"), JSON.stringify({ meta: { title: slug } }, null, 2));
  }
}

async function startApp(app, workspace, extra = {}) {
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
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/api/me`);
      await probe.arrayBuffer();
      return { started: true, port, child, exited, output: () => output, base: `http://127.0.0.1:${port}` };
    } catch { /* not answering yet */ }
    if (child.exitCode !== null) return { started: false, code: await exited, output: () => output };
    if (Date.now() > deadline) { child.kill(); await exited; throw new Error(`server neither started nor exited:\n${output}`); }
    await sleep(60);
  }
}
async function stopApp(server) {
  if (server && server.started) { server.child.kill(); await server.exited; }
}
async function getJson(server, route, options = {}) {
  const response = await fetch(`${server.base}${route}`, options);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: response.status, body, text };
}

function settingsLines(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("Settings:"));
}
function symbolicFor(workspace) {
  return ConfigLocation.symbolicSettingsPath({ env: workspace.env });
}
/* Startup may name the projects root (that is PSS-1's line); nothing else may name the profile. */
function assertNoRawProfile(output, workspace, label) {
  const text = output.split(/\r?\n/).filter((line) => !/^\s*Projects root:/.test(line)).join("\n");
  for (const raw of [workspace.profileHome, workspace.configPath, path.dirname(workspace.configPath)].filter(Boolean)) {
    assert(!text.includes(raw), `${label}: startup output names a raw profile location`);
  }
}
function assertNoSentinels(text, label) {
  for (const value of Object.values(SENTINEL)) assert(!String(text).includes(value), `${label}: a credential value appeared`);
}
function assertRefusedStart(server, pattern, label) {
  assert.strictEqual(server.started, false, `${label}: must not start\n${server.output()}`);
  assert.notStrictEqual(server.code, 0, `${label}: must exit non-zero`);
  assert(/refused to start/i.test(server.output()), `${label}: must say so\n${server.output()}`);
  assert(pattern.test(server.output()), `${label}: must say why\n${server.output()}`);
}

/* A migration run through the module directly, in a disposable tree, for fault injection. */
function unitLocation(label) {
  const workspace = disposableRoot(label);
  const appRoot = path.join(workspace.home, "app");
  fs.mkdirSync(path.join(appRoot, "data"), { recursive: true });
  const env = {
    LOCALAPPDATA: path.join(workspace.home, "local"), USERPROFILE: path.join(workspace.home, "profile"),
    HOME: path.join(workspace.home, "home"), XDG_CONFIG_HOME: path.join(workspace.home, "xdg"),
  };
  const location = ConfigLocation.resolveConfigLocation({ env, appRoot });
  return { workspace, appRoot, location };
}
function migrate(location, appRoot, ops = fs, module = ConfigLocation) {
  return module.migrateLegacySettings({ location, appRoot, parseBytes: Config.parseConfigBytes, presence: Config.secretPresence, ops });
}
const migrationTemps = (directory) => { try { return fs.readdirSync(directory).filter((name) => name.includes(".migrate.")); } catch { return []; } };

/* ---------------------------------------------------------------------------------------- */

async function cl1(app) {
  writeLegacy(app);
  const workspace = disposableRoot("cl1", { profile: true, perUserSettings: true });
  const server = await startApp(app, workspace);
  try {
    assert.strictEqual(server.started, true, server.output());
    assert.deepStrictEqual(settingsLines(server.output()), [`Settings: per-user (${symbolicFor(workspace)})`]);
    assert.strictEqual(fs.existsSync(workspace.configPath), true, "fresh defaults are created in the per-user location");
    assert.strictEqual(fs.existsSync(path.join(app.app, "data", "config.json")), false, "and never in the application folder");
    const config = JSON.parse(fs.readFileSync(workspace.configPath, "utf8"));
    assert.strictEqual(config.activeProject || "", "", "no active project");
    assert.strictEqual(config.generation.fal.enabled, false, "FAL disabled");
    assert(!["openai", "anthropic"].includes(config.assistant.provider), "no cloud text provider");
    assert.deepStrictEqual(config.accounts, [], "no accounts");
    assert(Object.values(Config.secretPresence(config)).every((set) => set.every((value) => !value)), "no credentials");
    assert(server.output().includes(`Projects root: ${workspace.projectsRoot} (default)`), server.output());
    assertNoRawProfile(server.output(), workspace, "CL-1");
  } finally { await stopApp(server); workspace.cleanup(); }
  return "defaults created only in the per-user location; no active project, FAL off, no cloud provider, no accounts or credentials";
}

async function cl2(app, state) {
  const results = [];
  for (const variant of ["configured root", "no saved root", "unknown settings"]) {
    const workspace = disposableRoot(`cl2-${variant.replace(/\s+/g, "-")}`, { profile: true, perUserSettings: true });
    const projectRoot = variant === "configured root" ? path.join(workspace.home, "configured-projects") : "";
    if (projectRoot) writeProjects(projectRoot, ["film-one", "film-two"]);
    const primary = bytesOf(legacyDocument({ projectRoot, unknown: variant === "unknown settings" }));
    const backup = bytesOf(legacyDocument({ projectRoot, openai: SENTINEL.backup }));
    writeLegacy(app, { primary, backup, corrupt: Buffer.from("{ an old corrupt copy") });
    const before = legacyStamps(app);
    const server = await startApp(app, workspace);
    let keep = false;
    try {
      assert.strictEqual(server.started, true, server.output());
      assert.deepStrictEqual(settingsLines(server.output()),
        [`Settings: per-user (${symbolicFor(workspace)}) — moved from the application folder on this start`]);
      const moved = fs.readFileSync(workspace.configPath);
      assert(moved.equals(primary), `${variant}: byte for byte`);
      const parsed = JSON.parse(moved);
      assert.deepStrictEqual(parsed, JSON.parse(primary), `${variant}: every field`);
      assert.strictEqual(parsed.workspace.projectRoot, JSON.parse(primary).workspace.projectRoot, `${variant}: the saved project folder, exactly`);
      if (variant === "unknown settings") assert.deepStrictEqual(parsed.cs2FutureSetting, { kept: true, list: [1, 2, 3] });
      const record = fs.readFileSync(path.join(path.dirname(workspace.configPath), ConfigLocation.MIGRATION_RECORD), "utf8");
      assert.strictEqual(JSON.parse(record).sourceBytes, primary.length);
      assert.strictEqual(JSON.parse(record).from, "application settings");
      assertNoSentinels(server.output() + record, `CL-2 ${variant}`);
      assert.deepStrictEqual(legacyStamps(app), before, `${variant}: the old settings and every sidecar are untouched`);
      assertNoRawProfile(server.output(), workspace, `CL-2 ${variant}`);
      if (projectRoot) {
        /* CL-12 — the migrated project folder is the authority, and every project is there. */
        assert(server.output().includes(`Projects root: ${projectRoot} (configured)`), server.output());
        const projects = await getJson(server, "/api/projects");
        assert.deepStrictEqual((projects.body.projects || []).map((row) => row.slug).sort(), ["film-one", "film-two"]);
        state.migrated = { app, workspace, projectRoot, primary };
        keep = true;
      } else {
        assert(server.output().includes(`Projects root: ${workspace.projectsRoot} (default)`), server.output());
      }
    } finally { await stopApp(server); if (!keep) workspace.cleanup(); }
    results.push(variant);
  }
  return `moved byte for byte, every field and the project folder preserved, originals untouched: ${results.join(", ")}`;
}

async function cl3(state) {
  const { app, workspace, primary } = state.migrated;
  const recordPath = path.join(path.dirname(workspace.configPath), ConfigLocation.MIGRATION_RECORD);
  const recordBefore = stamp(recordPath);
  const server = await startApp(app, workspace);
  try {
    assert.strictEqual(server.started, true, server.output());
    assert.deepStrictEqual(settingsLines(server.output()), [`Settings: per-user (${symbolicFor(workspace)})`], "no second move");
    assert.strictEqual(stamp(recordPath), recordBefore, "the record is not rewritten");
    assert(fs.readFileSync(workspace.configPath).equals(primary));
  } finally { await stopApp(server); }
  return "second start uses the per-user file; nothing moved again, record unchanged";
}

async function cl4(state, scratchApp) {
  const { app, workspace, projectRoot, primary } = state.migrated;
  fs.writeFileSync(path.join(app.app, "data", "config.json"), bytesOf(legacyDocument({ projectRoot, openai: SENTINEL.edited })));
  const editedStamp = stamp(path.join(app.app, "data", "config.json"));
  const server = await startApp(app, workspace);
  try {
    assert.strictEqual(server.started, true, server.output());
    const config = await getJson(server, "/api/config");
    assert.strictEqual(config.body.openaiKey, Config.maskSecretValue(SENTINEL.openai), "the per-user value, not the edited old one");
    assert(fs.readFileSync(workspace.configPath).equals(primary), "the per-user file is not merged with anything");
    assert.strictEqual(stamp(path.join(app.app, "data", "config.json")), editedStamp);
  } finally { await stopApp(server); }

  /* Both present and never migrated, with an old file nobody could parse: it is never read. */
  const seeded = disposableRoot("cl4-seeded", { profile: true, perUserSettings: true });
  fs.mkdirSync(path.dirname(seeded.configPath), { recursive: true });
  fs.writeFileSync(seeded.configPath, bytesOf(legacyDocument({ openai: SENTINEL.perUser })));
  writeLegacy(scratchApp, { primary: Buffer.from("{ this old file is never parsed") });
  const before = legacyStamps(scratchApp);
  const seededServer = await startApp(scratchApp, seeded);
  try {
    assert.strictEqual(seededServer.started, true, seededServer.output());
    assert.deepStrictEqual(settingsLines(seededServer.output()), [`Settings: per-user (${symbolicFor(seeded)})`]);
    assert.strictEqual((await getJson(seededServer, "/api/config")).body.openaiKey, Config.maskSecretValue(SENTINEL.perUser));
    assert.strictEqual(fs.existsSync(path.join(path.dirname(seeded.configPath), ConfigLocation.MIGRATION_RECORD)), false);
    assert.deepStrictEqual(legacyStamps(scratchApp), before);
  } finally { await stopApp(seededServer); seeded.cleanup(); }
  return "per-user authority wins after an edit to the old file, and an unparseable old file beside a per-user file is never read";
}

async function cl5(app) {
  const workspace = disposableRoot("cl5", { profile: true });
  writeLegacy(app, { primary: bytesOf(legacyDocument({})) });
  const before = legacyStamps(app);
  const perUser = ConfigLocation.resolveConfigLocation({ env: { ...workspace.env, CINEBRAID_CONFIG_PATH: "" }, appRoot: app.app });
  const server = await startApp(app, workspace);
  try {
    assert.strictEqual(server.started, true, server.output());
    assert.deepStrictEqual(settingsLines(server.output()), ["Settings: explicit override (CINEBRAID_CONFIG_PATH)"]);
    assert(!server.output().includes(workspace.configPath), "the override's value is not printed");
    const config = await getJson(server, "/api/config");
    assert.strictEqual(config.body.assistant.provider, "none", "the override file is used");
    assert.strictEqual(config.body.openaiKey, "", "and nothing of the old settings");
    assert.strictEqual(fs.existsSync(perUser.directory), false, "the per-user location is not created");
    assert.deepStrictEqual(legacyStamps(app), before);
  } finally { await stopApp(server); workspace.cleanup(); }
  return "override used exclusively; per-user location not created; old settings not read or moved";
}

async function cl6(app) {
  /* A crash mid-migration left a temp from a CineBraid that is no longer running. */
  const stale = ".config.json.migrate.99999999.1.deadbeef.tmp";
  const crashed = disposableRoot("cl6-crashed", { profile: true, perUserSettings: true });
  const primary = bytesOf(legacyDocument({}));
  writeLegacy(app, { primary });
  fs.mkdirSync(path.dirname(crashed.configPath), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(crashed.configPath), stale), primary.subarray(0, 20));
  const resumed = await startApp(app, crashed);
  try {
    assert.strictEqual(resumed.started, true, resumed.output());
    assert(fs.readFileSync(crashed.configPath).equals(primary), "the restart completes the move");
    assert.deepStrictEqual(migrationTemps(path.dirname(crashed.configPath)), [], "and removes the dead temp");
  } finally { await stopApp(resumed); crashed.cleanup(); }

  /* The crash came after publication: the file is complete, a temp and no record remain. */
  const published = disposableRoot("cl6-published", { profile: true, perUserSettings: true });
  fs.mkdirSync(path.dirname(published.configPath), { recursive: true });
  fs.writeFileSync(published.configPath, bytesOf(legacyDocument({ openai: SENTINEL.perUser })));
  fs.writeFileSync(path.join(path.dirname(published.configPath), stale), primary.subarray(0, 20));
  const after = await startApp(app, published);
  try {
    assert.strictEqual(after.started, true, after.output());
    assert.deepStrictEqual(settingsLines(after.output()), [`Settings: per-user (${symbolicFor(published)})`]);
    assert.deepStrictEqual(migrationTemps(path.dirname(published.configPath)), []);
    assert.strictEqual(fs.existsSync(path.join(path.dirname(published.configPath), ConfigLocation.MIGRATION_RECORD)), false);
  } finally { await stopApp(after); published.cleanup(); }

  /* Faults injected at each step of the transaction itself. */
  const faults = {
    "copy write": { writeFileSync: (target, ...rest) => { if (typeof target === "number") throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); return fs.writeFileSync(target, ...rest); } },
    "verification": { readFileSync: (target, ...rest) => { const bytes = fs.readFileSync(target, ...rest); return String(target).includes(".migrate.") ? Buffer.concat([Buffer.from(bytes), Buffer.from(" ")]) : bytes; } },
    "publication": { linkSync: () => { throw Object.assign(new Error("not supported"), { code: "EPERM" }); } },
  };
  for (const [step, override] of Object.entries(faults)) {
    const unit = unitLocation(`cl6-${step.replace(/\s+/g, "-")}`);
    try {
      const legacy = bytesOf(legacyDocument({}));
      fs.writeFileSync(unit.location.legacyPath, legacy);
      assert.throws(() => migrate(unit.location, unit.appRoot, { ...fs, ...override }),
        (error) => error.code === "CONFIG_LOCATION_REFUSED" && error.status === "legacy migration failed", step);
      assert.strictEqual(fs.existsSync(unit.location.path), false, `${step}: nothing published`);
      assert.deepStrictEqual(migrationTemps(unit.location.directory), [], `${step}: no temp left`);
      assert.strictEqual(fs.existsSync(unit.location.directory), false, `${step}: the folder this attempt created is removed`);
      assert(fs.readFileSync(unit.location.legacyPath).equals(legacy), `${step}: the original is untouched`);
    } finally { unit.workspace.cleanup(); }
  }
  return "a dead migration temp is completed over and removed; a published file with a stale temp is used as is; copy, verification and publication faults leave nothing";
}

async function cl7(app) {
  const unit = unitLocation("cl7-unit");
  try {
    fs.writeFileSync(unit.location.legacyPath, bytesOf(legacyDocument({})));
    const competitor = bytesOf(legacyDocument({ openai: SENTINEL.perUser }));
    const racing = { ...fs, linkSync: (from, to) => { fs.writeFileSync(to, competitor); return fs.linkSync(from, to); } };
    const outcome = migrate(unit.location, unit.appRoot, racing);
    assert.strictEqual(outcome.state, "raced");
    assert(fs.readFileSync(unit.location.path).equals(competitor), "the file another process published is never overwritten");
    assert.deepStrictEqual(migrationTemps(unit.location.directory), []);
  } finally { unit.workspace.cleanup(); }

  const workspace = disposableRoot("cl7", { profile: true, perUserSettings: true });
  const primary = bytesOf(legacyDocument({}));
  writeLegacy(app, { primary });
  const [first, second] = await Promise.all([startApp(app, workspace), startApp(app, workspace)]);
  try {
    assert.strictEqual(first.started && second.started, true, first.output() + second.output());
    assert(fs.readFileSync(workspace.configPath).equals(primary));
    const moves = [first, second].filter((server) => server.output().includes("moved from the application folder")).length;
    assert.strictEqual(moves, 1, "exactly one start published the move");
    assert.deepStrictEqual(migrationTemps(path.dirname(workspace.configPath)), []);
    assert.strictEqual(fs.existsSync(path.join(path.dirname(workspace.configPath), ConfigLocation.MIGRATION_RECORD)), true);
  } finally { await stopApp(first); await stopApp(second); workspace.cleanup(); }
  return "a destination that appears mid-move is left alone; two simultaneous starts publish exactly once";
}

async function cl8(app) {
  const results = [];

  /* Old primary torn, old backup good: the move takes the backup, as an ordinary start would. */
  const fromBackup = disposableRoot("cl8-backup", { profile: true, perUserSettings: true });
  const backup = bytesOf(legacyDocument({ openai: SENTINEL.backup }));
  writeLegacy(app, { primary: Buffer.from("{ torn"), backup });
  let server = await startApp(app, fromBackup);
  try {
    assert.strictEqual(server.started, true, server.output());
    assert(fs.readFileSync(fromBackup.configPath).equals(backup));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(fromBackup.configPath), ConfigLocation.MIGRATION_RECORD), "utf8")).from,
      "application settings backup");
  } finally { await stopApp(server); fromBackup.cleanup(); }
  results.push("old backup used when the old primary is torn");

  /* Both old copies unusable: refused, nothing created, and no parse message leaks a value. */
  const unusable = disposableRoot("cl8-unusable", { profile: true, perUserSettings: true });
  /* The primary starts with a credential: exactly the shape a parser quotes back in its message. */
  writeLegacy(app, { primary: Buffer.from(SENTINEL.openai), backup: Buffer.from(`{"falKey":"${SENTINEL.fal}" y}`) });
  const before = legacyStamps(app);
  server = await startApp(app, unusable);
  try {
    assertRefusedStart(server, /Settings: legacy migration failed/, "unusable old settings");
    assert.strictEqual(fs.existsSync(path.dirname(unusable.configPath)), false, "no per-user folder or file");
    assert.deepStrictEqual(legacyStamps(app), before);
    assertNoSentinels(server.output(), "CL-8 unusable");
    assert(!server.output().includes(SENTINEL.openai.slice(0, 10)), "not even the start of one");
    assertNoRawProfile(server.output(), unusable, "CL-8 unusable");
  } finally { unusable.cleanup(); }
  results.push("both old copies unusable refuses, creates nothing, leaks nothing");

  /* Per-user primary torn, per-user backup good: recovered beside itself, never from the old. */
  writeLegacy(app, { primary: bytesOf(legacyDocument({ openai: SENTINEL.edited })) });
  const recovered = disposableRoot("cl8-recovered", { profile: true, perUserSettings: true });
  fs.mkdirSync(path.dirname(recovered.configPath), { recursive: true });
  fs.writeFileSync(recovered.configPath, "{ torn per-user");
  fs.writeFileSync(`${recovered.configPath}.bak`, bytesOf(legacyDocument({ openai: SENTINEL.perUser })));
  server = await startApp(app, recovered);
  try {
    assert.strictEqual(server.started, true, server.output());
    assert.strictEqual((await getJson(server, "/api/config")).body.openaiKey, Config.maskSecretValue(SENTINEL.perUser));
    assert.strictEqual(fs.existsSync(`${recovered.configPath}.corrupt`), true, "the corrupt copy is kept beside the per-user file");
  } finally { await stopApp(server); recovered.cleanup(); }
  results.push("torn per-user primary recovered from its own backup");

  /* Per-user file unusable in three ways, with a perfectly good old file beside it. */
  for (const [shape, prepare] of Object.entries({
    "primary and backup torn": (file) => { fs.writeFileSync(file, "{ torn"); fs.writeFileSync(`${file}.bak`, "{ torn too"); },
    "a directory": (file) => { fs.mkdirSync(file); },
    "not a settings document": (file) => { fs.writeFileSync(file, "[1, 2]"); },
  })) {
    const refused = disposableRoot(`cl8-${shape.replace(/\s+/g, "-")}`, { profile: true, perUserSettings: true });
    fs.mkdirSync(path.dirname(refused.configPath), { recursive: true });
    prepare(refused.configPath);
    const entriesBefore = perUserEntries(refused);
    const oldBefore = legacyStamps(app);
    server = await startApp(app, refused);
    try {
      assert.strictEqual(server.started, false, `${shape}: startup refuses: ${server.output()}`);
      assert.notStrictEqual(server.code, 0, `${shape}: and exits non-zero`);
      assertNoSentinels(server.output(), `CL-8 ${shape}`);
      assert(server.output().includes(`settings : ${symbolicFor(refused)}`) && /will not fall back/.test(server.output()), server.output());
      assert(!/detail|position \d+|at loadConfigDocument/.test(server.output()), `${shape}: no error object, stack or parser message is printed`);
      assertNoRawProfile(server.output(), refused, `CL-8 ${shape}`);
      assert.deepStrictEqual(perUserEntries(refused), entriesBefore, `${shape}: nothing written beside the per-user file`);
      assert.deepStrictEqual(legacyStamps(app), oldBefore, `${shape}: the old settings are neither moved nor used`);
    } finally { await stopApp(server); refused.cleanup(); }
  }
  results.push("an unreadable, directory or non-document per-user file refuses startup, symbolically, with no fallback and nothing written");
  return results.join("; ");
}

async function cl9(state) {
  const { app, workspace } = state.migrated;
  const before = legacyStamps(app);
  const server = await startApp(app, workspace);
  try {
    assert.strictEqual(server.started, true, server.output());
    const put = await getJson(server, "/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ appearance: { density: "compact" } }) });
    assert.strictEqual(put.status, 200, put.text);
    const naming = await getJson(server, "/api/workspace/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ naming: { versionPadding: 4 } }) });
    assert.strictEqual(naming.status, 200, naming.text);
    const saved = JSON.parse(fs.readFileSync(workspace.configPath, "utf8"));
    assert.strictEqual(saved.appearance.density, "compact");
    assert.strictEqual(saved.naming.versionPadding, 4);
    const entries = perUserEntries(workspace);
    assert(entries.includes("config.json.bak"), "the backup is written beside the per-user file");
    assert(entries.every((name) => ["config.json", "config.json.bak", "config.json.corrupt", ConfigLocation.MIGRATION_RECORD].includes(name)),
      `only settings sidecars beside it, and no temp left: ${entries.join(", ")}`);
    assert.deepStrictEqual(legacyStamps(app), before, "no write reaches the application folder");
  } finally { await stopApp(server); }
  return "settings and storage writes land in the per-user file with their backup beside it; nothing reaches the application folder";
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const entry of list || []) if (entry.family === "IPv4" && !entry.internal) return entry.address;
  return "";
}

async function cl10(state) {
  const { app, workspace } = state.migrated;
  const results = [];
  const server = await startApp(app, workspace);
  try {
    const config = await getJson(server, "/api/config");
    assert.strictEqual(config.body.openaiKey, Config.maskSecretValue(SENTINEL.openai));
    assertNoSentinels(config.text, "CL-10 /api/config");
    for (const raw of [workspace.configPath, workspace.profileHome, symbolicFor(workspace)]) assert(!config.text.includes(raw), "/api/config carries no settings location");
    const status = await getJson(server, "/api/workspace/status");
    assert.deepStrictEqual(status.body.settingsLocation, { mode: "per-user", symbolic: symbolicFor(workspace), exact: true, path: workspace.configPath },
      "a browser on this computer sees the exact path");
    assertNoSentinels(status.text, "CL-10 status");
    results.push("loopback sees the exact path; /api/config carries no location and no value");
  } finally { await stopApp(server); }

  const lan = lanAddress();
  if (lan) {
    const lanServer = await startApp(app, workspace, { CINEBRAID_LAN: "1" });
    try {
      assert.strictEqual(lanServer.started, true, lanServer.output());
      const remote = await fetch(`http://${lan}:${lanServer.port}/api/workspace/status`);
      const text = await remote.text();
      for (const raw of [workspace.configPath, workspace.profileHome]) assert(!text.includes(raw), "a LAN device never receives the profile path");
      assertNoSentinels(text, "CL-10 LAN");
      if (remote.status === 200) {
        const body = JSON.parse(text);
        assert.deepStrictEqual(body.settingsLocation, { mode: "per-user", symbolic: symbolicFor(workspace), exact: false, path: "" });
        results.push("a real LAN request receives only the symbolic location");
      } else {
        results.push(`a real LAN request was refused (${remote.status}) and its refusal names no location`);
      }
    } finally { await stopApp(lanServer); }
  } else {
    results.push("no non-loopback interface: real LAN request NOT RUN (the classifier table below still runs)");
  }

  const location = { mode: "per-user", path: "/disposable/settings/config.json", symbolic: "%LOCALAPPDATA%\\CineBraid\\config.json" };
  const override = { mode: "override", path: "/disposable/override.json", symbolic: ConfigLocation.OVERRIDE_SYMBOLIC };
  const request = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
  const disclose = (req, where = location) => ConfigLocation.settingsLocationDisclosure(req, where);
  assert.strictEqual(disclose(request("127.0.0.1")).path, location.path);
  assert.strictEqual(disclose(request("::1")).path, location.path);
  assert.strictEqual(disclose(request("::ffff:127.0.0.1")).path, location.path);
  assert.strictEqual(disclose(request("192.168.1.20")).path, "", "LAN");
  assert.strictEqual(disclose(request("::ffff:10.0.0.5")).path, "", "IPv4-mapped LAN");
  assert.strictEqual(disclose(request("127.0.0.1", { "x-forwarded-for": "203.0.113.9" })).path, "", "forwarded is ambiguous");
  assert.strictEqual(disclose(request("127.0.0.1", { forwarded: "for=203.0.113.9" })).path, "");
  assert.strictEqual(disclose({ headers: {} }).path, "", "no peer is ambiguous");
  assert.strictEqual(disclose(undefined).path, "");
  assert.deepStrictEqual(disclose(request("10.0.0.5"), override), { mode: "explicit override", symbolic: ConfigLocation.OVERRIDE_SYMBOLIC, exact: false, path: "" });
  results.push("classifier: loopback exact; LAN, forwarded and peerless symbolic");

  const settingsSource = fs.readFileSync(path.join(ROOT, "public", "settings.js"), "utf8");
  const start = settingsSource.indexOf("function describeSettingsLocation(");
  const end = settingsSource.indexOf("window.refreshWorkspaceStatus", start);
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(settingsSource.slice(start, end) + "\nmodule.exports = describeSettingsLocation;", sandbox);
  const describe = sandbox.module.exports;
  assert(describe({ mode: "per-user", symbolic: location.symbolic, exact: true, path: location.path }).includes(location.path));
  const remote = describe({ mode: "per-user", symbolic: location.symbolic, exact: false, path: "" });
  assert(remote.includes(location.symbolic) && !remote.includes(location.path));
  assert(!describe({ mode: "explicit override", symbolic: ConfigLocation.OVERRIDE_SYMBOLIC, exact: false, path: "" }).includes("/disposable"));
  const views = fs.readFileSync(path.join(ROOT, "public", "views.js"), "utf8");
  const disclosure = views.match(/<details class="settings-local-storage" id="settings-location"[^>]*>/);
  assert(disclosure && !/\bopen\b/.test(disclosure[0]), "the disclosure is a collapsed, secondary <details>");
  assert.strictEqual((views.match(/settings-local-storage/g) || []).length, 1, "and it is the only one");
  results.push("Settings renders the path only when the server sent it, inside one collapsed disclosure");
  return results.join("; ");
}

async function cl11() {
  /* A copy of the application sitting inside what looks like another installation: not
     disposable, so a test run must refuse to move its settings — before reading them. */
  const app = stageInstallation("cl11-nested");
  const signature = [path.join(app.workspace.home, "server.js"), path.join(app.workspace.home, "src", "server", "config.js")];
  fs.mkdirSync(path.dirname(signature[1]), { recursive: true });
  for (const file of signature) fs.writeFileSync(file, "// makes the parent look like an installation\n");
  const workspace = disposableRoot("cl11", { profile: true, perUserSettings: true });
  try {
    writeLegacy(app, { primary: bytesOf(legacyDocument({})) });
    const before = legacyStamps(app);
    const server = await startApp(app, workspace);
    assertRefusedStart(server, /would move the settings[\s\S]*not disposable/, "nested installation");
    assert.strictEqual(fs.existsSync(path.dirname(workspace.configPath)), false, "the per-user location is not created");
    assert.deepStrictEqual(legacyStamps(app), before);
    assertNoSentinels(server.output(), "CL-11");
  } finally {
    for (const file of signature) fs.rmSync(file, { force: true });
    fs.rmSync(path.join(app.workspace.home, "src"), { recursive: true, force: true });
    workspace.cleanup();
    app.cleanup();
  }
  return "a test run refuses to move settings out of an application folder that is not a disposable copy, before reading them";
}

async function cl13(state) {
  const available = spawnSync("git", ["cat-file", "-e", `${PREVIOUS_BUILD}^{commit}`], { cwd: ROOT, windowsHide: true }).status === 0;
  if (!available) return `NOT RUN: ${PREVIOUS_BUILD.slice(0, 8)} is not in this clone's history`;
  const show = (file) => spawnSync("git", ["show", `${PREVIOUS_BUILD}:${file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true }).stdout;
  const previous = stageInstallation("cl13-previous", {
    replace: { "src/server/server.js": show("src/server/server.js"), "src/server/config.js": show("src/server/config.js") },
  });
  const { workspace, projectRoot } = state.migrated;
  const results = [];
  try {
    /* After the move, the previous build pointed at the per-user file opens the same settings. */
    let server = await startApp(previous, workspace, { CINEBRAID_CONFIG_PATH: workspace.configPath });
    try {
      assert.strictEqual(server.started, true, server.output());
      assert(server.output().includes(`Projects root: ${projectRoot} (configured)`), server.output());
      assert.strictEqual((await getJson(server, "/api/config")).body.openaiKey, Config.maskSecretValue(SENTINEL.openai));
    } finally { await stopApp(server); }
    results.push("the previous build with CINEBRAID_CONFIG_PATH opens the per-user settings and project folder");

    /* Without an override the previous build reads the old file the move left in place. */
    writeLegacy(previous, { primary: bytesOf(legacyDocument({ projectRoot, openai: SENTINEL.backup })) });
    server = await startApp(previous, workspace, { CINEBRAID_CONFIG_PATH: "" });
    try {
      assert.strictEqual(server.started, true, server.output());
      assert.strictEqual((await getJson(server, "/api/config")).body.openaiKey, Config.maskSecretValue(SENTINEL.backup));
    } finally { await stopApp(server); }
    results.push("without it, the previous build reads the retained old settings");
  } finally { previous.cleanup(); }
  return results.join("; ");
}

async function cl14(app) {
  const unresolved = { CINEBRAID_CONFIG_PATH: "", LOCALAPPDATA: "", USERPROFILE: "", HOME: "", XDG_CONFIG_HOME: "", APPDATA: "" };
  const workspace = disposableRoot("cl14", { profile: true, perUserSettings: true });
  try {
    writeLegacy(app, { primary: bytesOf(legacyDocument({})) });
    let before = legacyStamps(app);
    let server = await startApp(app, workspace, unresolved);
    assertRefusedStart(server, /Settings: legacy migration required/, "unresolved with old settings");
    assert.deepStrictEqual(legacyStamps(app), before);
    assertNoSentinels(server.output(), "CL-14");

    writeLegacy(app);
    before = legacyStamps(app);
    server = await startApp(app, workspace, unresolved);
    assertRefusedStart(server, /Settings: per-user location unavailable/, "unresolved fresh");
    assert.deepStrictEqual(legacyStamps(app), before, "nothing is created in the application folder");
  } finally { workspace.cleanup(); }
  return "no resolvable per-user location refuses — 'legacy migration required' with old settings, 'unavailable' without — and writes nothing";
}

function cl15(state) {
  const { workspace } = state.migrated;
  const directory = path.dirname(workspace.configPath);
  const files = perUserEntries(workspace).map((name) => path.join(directory, name));
  if (process.platform === "win32") {
    const broad = ["BUILTIN\\Users:", "NT AUTHORITY\\Authenticated Users:", "Everyone:"];
    for (const target of [directory, ...files]) {
      const acl = spawnSync("icacls", [target], { encoding: "utf8", windowsHide: true });
      assert.strictEqual(acl.status, 0, acl.stderr);
      for (const principal of broad) assert(!acl.stdout.includes(principal), `${path.basename(target)} grants ${principal}`);
    }
    return `Windows: no broad principal on the settings folder or ${files.length} files (inherited from the disposable profile; the real LocalAppData ACL is a CS-3 gate)`;
  }
  assert.strictEqual(fs.statSync(directory).mode & 0o777, 0o700, "folder 0700");
  for (const file of files) assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, `${path.basename(file)} 0600`);
  return `POSIX: folder 0700, ${files.length} files 0600`;
}

function cl16() {
  const source = fs.readFileSync(path.join(ROOT, "src", "server", "config-location.js"), "utf8");
  assert(!/renameSync\(/.test(source), "the move never renames");
  for (const line of source.split(/\r?\n/).filter((text) => /legacyPath/.test(text))) {
    assert(!/unlink|rmSync|rmdir|rename|writeFile|copyFile|openSync|appendFile/.test(line), `a write or removal names the old settings: ${line.trim()}`);
  }
  return "CL-2, 4, 5, 8, 9, 11 and 14 each proved the old settings and sidecars unchanged, and no code path writes or removes them — the cleanup action itself is CS-4";
}

/* ---------------------------------------------------------------------------------------- */

async function main() {
  const shared = stageInstallation("cl-shared");
  const scratchApp = stageInstallation("cl-scratch-app");
  const migratedApp = stageInstallation("cl-migrated");
  const state = {};
  const checks = [
    ["CL-1", "fresh install", () => cl1(shared)],
    ["CL-2", "legacy migration, byte for byte (CL-12 inside)", () => cl2(migratedApp, state)],
    ["CL-3", "already migrated", () => cl3(state)],
    ["CL-4", "both present, never merged", () => cl4(state, scratchApp)],
    ["CL-5", "explicit override", () => cl5(shared)],
    ["CL-6", "interrupted migration", () => cl6(shared)],
    ["CL-7", "destination race", () => cl7(shared)],
    ["CL-8", "malformed and unreadable settings", () => cl8(shared)],
    ["CL-9", "writes and sidecars after activation", () => cl9(state)],
    ["CL-10", "masking and local-versus-LAN disclosure", () => cl10(state)],
    ["CL-11", "test-isolation ordering", () => cl11()],
    ["CL-13", "rollback to the previous build", () => cl13(state)],
    ["CL-14", "no resolvable per-user location", () => cl14(shared)],
    ["CL-15", "permissions", () => cl15(state)],
  ];
  let failed = 0;
  const live = TestIsolationLive();
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
    try {
      if (!state.migrated || failed) throw new Error("CL-12 and CL-16 are concluded from the scenarios above, and not all of them passed");
      console.log(`  PASS  CL-12  project-root authority unchanged\n        proved inside CL-2: a saved project folder resolves (configured) with every project listed; none resolves to the profile default`);
      console.log(`  PASS  CL-16  nothing removes the old settings\n        ${cl16()}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  CL-12/16\n        ${error.stack || error.message}`);
    }
    assert.deepStrictEqual(TestIsolationLive(), live, "a live configuration location changed during this run");
    console.log("  PASS  live configuration locations unchanged by existence, size and modification time");
  } finally {
    if (state.migrated) state.migrated.workspace.cleanup();
    shared.cleanup();
    scratchApp.cleanup();
    migratedApp.cleanup();
    SCRATCH.cleanup();
  }
  if (failed) {
    console.error(`\nCS-2 settings location failed: ${failed} check(s).`);
    process.exit(1);
  }
  console.log("\nCS-2 settings location passed: CL-1 through CL-16.");
}

function TestIsolationLive() {
  const TestIsolation = require("../src/server/test-isolation");
  const out = {};
  const mark = (target) => { try { const stat = fs.statSync(target); return stat.isDirectory() ? "directory" : `${stat.size}:${stat.mtimeMs}`; } catch { return "absent"; } };
  for (const location of TestIsolation.liveConfigurationLocations(ROOT)) {
    out[location.path] = mark(location.path);
    for (const name of ["config.json", "config.json.bak"]) out[path.join(location.path, name)] = mark(path.join(location.path, name));
  }
  return out;
}

module.exports = {
  SENTINEL, bytesOf, getJson, legacyDocument, legacyStamps, migrate, migrationTemps, settingsLines, startApp, stopApp,
  unitLocation, writeLegacy, assertRefusedStart, Config,
};

if (require.main === module) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}

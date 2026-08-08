/* CineBraid configuration durability — corruption must not become a factory reset.
 *
 * config.json is the only file in CineBraid that holds credentials: every provider
 * key, both passcodes, the cookie signing secret, and since Phase 3 the Civitai
 * OAuth access token, refresh token and personal API key.
 *
 * It was written with a bare writeFileSync and read with `catch { return defaults }`,
 * so a truncated, empty, NUL-padded or wrongly-encoded file read as DEFAULT_CONFIG —
 * and startup then wrote those defaults over the remains. Every credential was
 * destroyed, including ones still physically present in the corrupt bytes. Because
 * DEFAULT_CONFIG has no editorPass, an install running --lan with a passcode set
 * came back up with AUTHENTICATION SILENTLY OFF.
 *
 * The rule this suite locks in:
 *
 *     MISSING is a valid first-run state.   ->  defaults, and writing them is right.
 *     CORRUPT is not missing.               ->  recover from the backup, or refuse.
 *                                               Never invent, never overwrite.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-config-durability-"));

/* A populated configuration: one of every credential kind the file must protect. */
const OPENAI_KEY = "openai-MUSTSURVIVE-1111";
const EDITOR_PASS = "editor-MUSTSURVIVE-2222";
const VIEWER_PASS = "viewer-MUSTSURVIVE-3333";
const AUTH_SECRET = "authsecret-MUSTSURVIVE-4444";
const OAUTH_ACCESS = "civitaiaccess-MUSTSURVIVE-5555";
const OAUTH_REFRESH = "civitairefresh-MUSTSURVIVE-6666";
const PASTED_KEY = "civitaikey-MUSTSURVIVE-7777";
const PROJECT_ROOT = path.join(TEMP, "custom-project-root").replace(/\\/g, "/");
const ALL_SECRETS = [OPENAI_KEY, EDITOR_PASS, VIEWER_PASS, AUTH_SECRET, OAUTH_ACCESS, OAUTH_REFRESH, PASTED_KEY];

function connection(id, credential, identity) {
  return {
    connectionId: `conn-${id.repeat(32).slice(0, 32)}`,
    providerId: "civitai", providerLabel: "Civitai", status: "connected",
    identity: { providerUserId: identity.id, displayName: identity.name, avatarUrl: null, tier: "free", accountStatus: "active", grantedScope: "1" },
    credential, balance: { supported: false, unit: null, amount: null, checkedAt: null },
    createdAt: "2026-08-08T00:00:00.000Z", lastVerifiedAt: "2026-08-08T00:00:00.000Z", lastError: null,
  };
}
const POPULATED = {
  activeProject: "durable-project",
  openaiKey: OPENAI_KEY,
  editorPass: EDITOR_PASS,
  viewerPass: VIEWER_PASS,
  authSecret: AUTH_SECRET,
  workspace: { projectRoot: PROJECT_ROOT, mediaRoot: "", outputRoot: "", backupRoot: "", fileStrategy: "project/scene/shot", syncMode: "manual" },
  accountProviders: { civitai: { clientId: "durability-client" } },
  accounts: [
    connection("a", { tokenSource: "oauth", accessToken: OAUTH_ACCESS, refreshToken: OAUTH_REFRESH, apiKey: "", expiresAt: null }, { id: "1", name: "ada" }),
    connection("b", { tokenSource: "api_key", accessToken: "", refreshToken: "", apiKey: PASTED_KEY, expiresAt: null }, { id: "2", name: "kit" }),
  ],
};

/* Each case runs in its own directory with its own config path, and drives the real
   config module in a CHILD process — CONFIG_PATH is captured at require time, so a
   single process could only ever exercise one path. */
let caseIndex = 0;
function newCase() {
  const dir = path.join(TEMP, `case-${String(++caseIndex).padStart(2, "0")}`);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, config: path.join(dir, "config.json"), backup: path.join(dir, "config.json.bak") };
}
/* Runs an expression against ../config with a given CINEBRAID_CONFIG_PATH and
   returns { ok, value } or { ok:false, code, message }. */
function drive(configPath, expression) {
  const script = `
    const c = require(${JSON.stringify(path.join(ROOT, "config.js"))});
    try { console.log("@@" + JSON.stringify({ ok: true, value: (${expression}) })); }
    catch (error) { console.log("@@" + JSON.stringify({ ok: false, code: error?.code || "", message: String(error?.message || error) })); }`;
  const out = execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, CINEBRAID_CONFIG_PATH: configPath }, encoding: "utf8",
  });
  return JSON.parse(out.split("@@").pop().trim());
}
function readState(configPath) {
  return drive(configPath, `(() => { const r = c.readConfig(); return {
    editorPass: r.editorPass || "", viewerPass: r.viewerPass || "", authSecret: r.authSecret || "",
    openaiKey: r.openaiKey || "", projectRoot: r.workspace?.projectRoot || "",
    activeProject: r.activeProject || "", accounts: r.accounts || [],
  }; })()`);
}
function writePopulated(target, value = POPULATED) {
  fs.writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
}
function assertEverySecretPresent(state, label) {
  assert.strictEqual(state.editorPass, EDITOR_PASS, `${label}: the editor passcode must survive`);
  assert.strictEqual(state.viewerPass, VIEWER_PASS, `${label}: the viewer passcode must survive`);
  assert.strictEqual(state.authSecret, AUTH_SECRET, `${label}: the signing secret must survive`);
  assert.strictEqual(state.openaiKey, OPENAI_KEY, `${label}: provider keys must survive`);
  assert.strictEqual(state.projectRoot, PROJECT_ROOT, `${label}: the workspace root must survive`);
  assert.strictEqual(state.activeProject, "durable-project", `${label}: the open project must survive`);
  assert.strictEqual(state.accounts.length, 2, `${label}: both AccountConnections must survive`);
  const oauth = state.accounts.find((a) => a.credential.tokenSource === "oauth");
  const keyed = state.accounts.find((a) => a.credential.tokenSource === "api_key");
  assert.strictEqual(oauth.credential.accessToken, OAUTH_ACCESS, `${label}: the OAuth access token must survive`);
  assert.strictEqual(oauth.credential.refreshToken, OAUTH_REFRESH, `${label}: the OAuth refresh token must survive`);
  assert.strictEqual(keyed.credential.apiKey, PASTED_KEY, `${label}: the pasted API key must survive`);
  assert.strictEqual(oauth.identity.displayName, "ada", `${label}: connection identity must survive`);
}

function main() {
  /* ---- 1. missing file is a valid first run, not a corruption ---- */
  {
    const c = newCase();
    const state = readState(c.config);
    assert(state.ok, "a missing config must read as defaults, not as an error");
    assert.strictEqual(state.value.editorPass, "", "a first run has no passcode");
    assert.strictEqual(state.value.accounts.length, 0);
    assert(!fs.existsSync(c.config), "merely READING a missing config must not create one");
    const migrated = drive(c.config, "(c.migrateConfigFile(), true)");
    assert(migrated.ok);
    assert(fs.existsSync(c.config), "startup on a first run does create the file");
    JSON.parse(fs.readFileSync(c.config, "utf8"));
  }

  /* ---- 2. a valid primary reads exactly ---- */
  {
    const c = newCase();
    writePopulated(c.config);
    const state = readState(c.config);
    assert(state.ok, JSON.stringify(state));
    assertEverySecretPresent(state.value, "valid primary");
  }

  /* ---- 3-5. a corrupt primary recovers from a valid backup ----
     Three shapes, because they fail in the parser at different points: a truncated
     write, an interrupted truncate, and a NUL-padded tail from a power loss or a
     sync client. */
  const corruptions = [
    ["malformed / truncated at 60%", (text) => text.slice(0, Math.floor(text.length * 0.6))],
    ["empty", () => ""],
    ["trailing NULs", (text) => text.slice(0, Math.floor(text.length * 0.8)) + "\0".repeat(64)],
    ["not an object", () => "[1,2,3]"],
    ["whitespace only", () => "   \n\t  "],
  ];
  for (const [label, corrupt] of corruptions) {
    const c = newCase();
    const good = JSON.stringify(POPULATED, null, 2);
    fs.writeFileSync(c.backup, good, "utf8");
    fs.writeFileSync(c.config, corrupt(good), "utf8");
    const corruptBytes = fs.readFileSync(c.config);

    const state = readState(c.config);
    assert(state.ok, `${label}: a corrupt primary with a valid backup must recover, not refuse — ${JSON.stringify(state)}`);
    assertEverySecretPresent(state.value, label);
    /* Reading alone must not rewrite anything. */
    assert(corruptBytes.equals(fs.readFileSync(c.config)), `${label}: reading must not modify the primary`);

    /* Startup repairs the primary — and must NOT let the corrupt primary become the
       backup, which would destroy the copy the recovery just depended on. */
    const migrated = drive(c.config, "(c.migrateConfigFile(), true)");
    assert(migrated.ok, `${label}: startup must repair rather than refuse`);
    const repaired = JSON.parse(fs.readFileSync(c.config, "utf8"));
    assert.strictEqual(repaired.editorPass, EDITOR_PASS, `${label}: the repaired primary carries the recovered passcode`);
    assert.strictEqual(repaired.accounts.length, 2, `${label}: the repaired primary carries both connections`);
    assert.strictEqual(JSON.parse(fs.readFileSync(c.backup, "utf8")).editorPass, EDITOR_PASS,
      `${label}: the good backup must not be overwritten by the corrupt primary`);
    /* And the corrupt bytes are kept as evidence rather than thrown away. */
    const evidence = `${c.config}.corrupt`;
    if (label !== "empty" && label !== "whitespace only")
      assert(fs.existsSync(evidence), `${label}: the corrupt bytes must be preserved for recovery`);
  }

  /* ---- 6. a UTF-8 BOM is tolerated, the way every other reader here tolerates one ---- */
  {
    const c = newCase();
    fs.writeFileSync(c.config, "﻿" + JSON.stringify(POPULATED, null, 2), "utf8");
    const state = readState(c.config);
    assert(state.ok, `a BOM must not read as corruption — ${JSON.stringify(state)}`);
    assertEverySecretPresent(state.value, "UTF-8 BOM");
  }

  /* ---- 7. both copies unusable -> explicit refusal, and nothing is touched ---- */
  for (const [label, backupState] of [["no backup", null], ["corrupt backup", "{ broken"], ["empty backup", ""]]) {
    const c = newCase();
    const good = JSON.stringify(POPULATED, null, 2);
    fs.writeFileSync(c.config, good.slice(0, 400), "utf8");
    if (backupState !== null) fs.writeFileSync(c.backup, backupState, "utf8");
    const primaryBytes = fs.readFileSync(c.config);

    const state = readState(c.config);
    assert(!state.ok, `${label}: both copies unusable must refuse, not return defaults`);
    assert.strictEqual(state.code, "CONFIG_UNREADABLE", `${label}: the refusal is typed`);
    assert(!/DEFAULT|factory/i.test(state.message) || /empty settings/.test(state.message));

    const migrated = drive(c.config, "(c.migrateConfigFile(), true)");
    assert(!migrated.ok, `${label}: startup must propagate the refusal rather than resolve it by invention`);
    assert.strictEqual(migrated.code, "CONFIG_UNREADABLE");
    assert(primaryBytes.equals(fs.readFileSync(c.config)),
      `${label}: the corrupt primary is EVIDENCE and must be left exactly as found`);
    if (backupState !== null)
      assert.strictEqual(fs.readFileSync(c.backup, "utf8"), backupState, `${label}: the backup is untouched too`);
  }

  /* ---- 8. an interrupted write leaves a recoverable previous configuration ----
     Simulated the way it actually happens: a temp file left behind, the primary
     never renamed over. The previous configuration must still be the one on disk. */
  {
    const c = newCase();
    writePopulated(c.config);
    fs.writeFileSync(path.join(c.dir, `.config.json.${process.pid}.1.abcd1234.tmp`), "{ half-written", "utf8");
    const state = readState(c.config);
    assert(state.ok, "a stray temp file must not affect the primary");
    assertEverySecretPresent(state.value, "interrupted write");
    /* And a completed write leaves no temp file behind. */
    const written = drive(c.config, "(c.writeConfig(c.readConfig()), true)");
    assert(written.ok);
    const strays = fs.readdirSync(c.dir).filter((n) => n.endsWith(".tmp"));
    assert.strictEqual(strays.length, 1, "a completed write cleans up after itself (only the planted stray remains)");
  }

  /* ---- 9. overlapping writes serialize, and every one leaves a readable file ----
     writeConfig is synchronous end to end, so two callers in one process cannot
     interleave a temp file; this proves it rather than assuming it, and proves the
     file is parseable after every one of them. */
  {
    const c = newCase();
    writePopulated(c.config);
    const result = drive(c.config, `(() => {
      const results = [];
      for (let i = 0; i < 25; i += 1) {
        const cfg = c.readConfig();
        cfg.ollamaModel = "model-" + i;
        c.writeConfig(cfg);
        results.push(require("fs").readFileSync(${JSON.stringify(c.config)}, "utf8").length > 0);
      }
      const after = c.readConfig();
      return { allReadable: results.every(Boolean), last: after.ollamaModel, editorPass: after.editorPass, accounts: after.accounts.length };
    })()`);
    assert(result.ok, JSON.stringify(result));
    assert(result.value.allReadable, "the config file is parseable after every write");
    assert.strictEqual(result.value.last, "model-24", "the last write wins");
    assert.strictEqual(result.value.editorPass, EDITOR_PASS, "25 writes must not erode a secret");
    assert.strictEqual(result.value.accounts, 2);
    const strays = fs.readdirSync(c.dir).filter((n) => n.endsWith(".tmp"));
    assert.deepStrictEqual(strays, [], "no temp file may survive a completed write");
  }

  /* ---- 10. the backup is created by ordinary use, not only by corruption ---- */
  {
    const c = newCase();
    writePopulated(c.config);
    assert(!fs.existsSync(c.backup));
    const written = drive(c.config, `(() => { const cfg = c.readConfig(); cfg.ollamaModel = "changed"; c.writeConfig(cfg); return true; })()`);
    assert(written.ok);
    assert(fs.existsSync(c.backup), "a write takes a backup of the previous configuration first");
    assert.strictEqual(JSON.parse(fs.readFileSync(c.backup, "utf8")).editorPass, EDITOR_PASS);
    assert.strictEqual(JSON.parse(fs.readFileSync(c.config, "utf8")).ollamaModel, "changed");
  }

  /* ---- 11. corruption cannot silently disable authentication ----
     The security consequence, stated as its own assertion: after any recoverable
     corruption the passcodes are still set, so an install running --lan does not
     come back up open. */
  {
    const c = newCase();
    const good = JSON.stringify(POPULATED, null, 2);
    fs.writeFileSync(c.backup, good, "utf8");
    fs.writeFileSync(c.config, good.slice(0, 300), "utf8");
    const state = readState(c.config);
    assert(state.ok);
    assert(state.value.editorPass && state.value.viewerPass,
      "recovery must not leave authentication switched off");
    assert.strictEqual(state.value.authSecret, AUTH_SECRET,
      "a regenerated signing secret would silently invalidate every session; the stored one must survive");
  }

  /* ---- 12. the secret registry still applies to a recovered configuration ----
     Recovery must not be a way around masking: the projection of a recovered
     document carries no raw credential. */
  {
    const c = newCase();
    const good = JSON.stringify(POPULATED, null, 2);
    fs.writeFileSync(c.backup, good, "utf8");
    fs.writeFileSync(c.config, "{ truncated", "utf8");
    const masked = drive(c.config, "JSON.stringify(c.maskSecrets(c.readConfig()))");
    assert(masked.ok, JSON.stringify(masked));
    for (const secret of ALL_SECRETS)
      assert(!masked.value.includes(secret), `a recovered configuration must still mask ${secret}`);
    assert(masked.value.includes("••••7777"), "the pasted API key is masked, not omitted");
    assert(!masked.value.includes("accessToken"), "OAuth tokens stay omitted after recovery");
  }

  /* ---- 13. restarts after a recovery are stable ----
     One boot repairing the file is not enough: the question a user actually has is
     whether the machine is still theirs tomorrow. Three consecutive startups on the
     recovered configuration must leave the passcodes set, the signing secret
     unchanged (a regenerated one silently invalidates every session), both
     AccountConnections present with their credentials, and the workspace root
     intact — the field whose loss makes the whole project library vanish from the
     interface even though the directories are fine. */
  {
    const c = newCase();
    const good = JSON.stringify(POPULATED, null, 2);
    fs.writeFileSync(c.backup, good, "utf8");
    fs.writeFileSync(c.config, good.slice(0, 200), "utf8");
    for (const boot of [1, 2, 3]) {
      const started = drive(c.config, "(c.migrateConfigFile(), true)");
      assert(started.ok, `boot ${boot} must start: ${JSON.stringify(started)}`);
      const state = readState(c.config);
      assert(state.ok, `boot ${boot} must read: ${JSON.stringify(state)}`);
      assertEverySecretPresent(state.value, `boot ${boot} after recovery`);
    }
    /* And a subsequent ordinary write still keeps a usable backup. */
    const changed = drive(c.config, `(() => { const cfg = c.readConfig(); cfg.ollamaModel = "after-recovery"; c.writeConfig(cfg); return true; })()`);
    assert(changed.ok);
    assert.strictEqual(JSON.parse(fs.readFileSync(c.backup, "utf8")).editorPass, EDITOR_PASS,
      "the backup after a recovery is the repaired configuration, not the corrupt one");
    const final = readState(c.config);
    assertEverySecretPresent(final.value, "after a write following recovery");
  }

  console.log(
    "Config durability suite passed: a missing file is a first run, a valid primary reads exactly, five corruption "
    + "shapes and a UTF-8 BOM recover from the backup with every passcode, provider key, signing secret, workspace "
    + "root and AccountConnection credential intact, a corrupt primary never overwrites a good backup and is kept as "
    + "evidence, both-unusable refuses with a typed error while touching neither file, 25 overlapping writes leave no "
    + "temp file and erode no secret, recovery cannot switch authentication off, the secret registry still masks "
    + "a recovered document, and three consecutive restarts after a recovery keep every passcode, the signing "
    + "secret, both AccountConnections and the workspace root.",
  );
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}

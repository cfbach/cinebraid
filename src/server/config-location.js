"use strict";

/* WHERE CINEBRAID'S SETTINGS LIVE, AND HOW AN EXISTING INSTALL'S SETTINGS GET THERE.
 *
 * Private, mutable settings — provider keys, passcodes, the saved project folder — do not
 * belong inside the application folder. They live in the account's standard per-user
 * application-data location:
 *
 *     Windows   %LOCALAPPDATA%\CineBraid\config.json
 *     macOS     ~/Library/Application Support/CineBraid/config.json
 *     Linux     ${XDG_CONFIG_HOME:-~/.config}/CineBraid/config.json
 *
 * PRECEDENCE, decided once at startup and never re-decided:
 *
 *   1. CINEBRAID_CONFIG_PATH is set    -> that file, and nothing else is looked at.
 *   2. the per-user file exists        -> it is the authority. The application folder's
 *                                         old file is never read, and an unreadable
 *                                         per-user file is refused, never replaced.
 *   3. the per-user file is absent and
 *      the application folder has one  -> it is moved, once, by the transaction below.
 *   4. neither exists                  -> fresh defaults, in the per-user location only.
 *
 * Two settings documents are never merged. There is no rule for which of two saved keys,
 * two passcodes or two project folders is the right one, so there is no merge.
 *
 * THE MOVE IS A COPY. The application folder's file and every sidecar beside it are left
 * exactly as they were; removing them is a separate, explicit act that this file does not
 * contain. The copy is byte-for-byte, verified in memory, and published create-only, so
 * an existing per-user file can never be overwritten — not by a second CineBraid starting
 * at the same moment, and not by a restart after an interruption.
 *
 * NOTHING HERE PRINTS A PATH OR A VALUE. Every message is built from a symbolic location
 * and a reason, because startup output gets pasted into public issues. */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const util = require("util");
const { isLoopbackRequest } = require("./loopback-request");

const SETTINGS_FILE = "config.json";
const APPLICATION_DIRECTORY = "CineBraid";
const MIGRATION_RECORD = "migration.json";
const MIGRATION_TEMP = /^\.config\.json\.migrate\.(\d+)\.\d+\.[0-9a-f]{8}\.tmp$/;
const OVERRIDE_ENV = "CINEBRAID_CONFIG_PATH";
const OVERRIDE_SYMBOLIC = "the file named by CINEBRAID_CONFIG_PATH";

function variable(env, name) {
  return String((env && env[name]) || "").trim();
}

/* The one platform table. Everything that needs to know where per-user settings live —
   this file, config.js, and the test-isolation rule — asks here. */
function perUserConfigurationDirectory({ env = process.env, platform = process.platform } = {}) {
  if (platform === "win32") {
    if (variable(env, "LOCALAPPDATA")) return path.win32.join(variable(env, "LOCALAPPDATA"), APPLICATION_DIRECTORY);
    if (variable(env, "USERPROFILE")) return path.win32.join(variable(env, "USERPROFILE"), "AppData", "Local", APPLICATION_DIRECTORY);
    return "";
  }
  if (platform === "darwin") {
    return variable(env, "HOME") ? path.posix.join(variable(env, "HOME"), "Library", "Application Support", APPLICATION_DIRECTORY) : "";
  }
  if (variable(env, "XDG_CONFIG_HOME")) return path.posix.join(variable(env, "XDG_CONFIG_HOME"), APPLICATION_DIRECTORY);
  return variable(env, "HOME") ? path.posix.join(variable(env, "HOME"), ".config", APPLICATION_DIRECTORY) : "";
}

/* Every per-user settings directory an account could hold live settings in, for the
   test-isolation rule to refuse and the browser gate to watch. Wider than the one this
   build writes: Roaming on Windows, and the lower-case spelling on case-sensitive systems. */
function knownPerUserConfigurationDirectories(home, platform = process.platform) {
  if (!home) return [];
  if (platform === "win32") {
    return [path.win32.join(home, "AppData", "Local", APPLICATION_DIRECTORY), path.win32.join(home, "AppData", "Roaming", APPLICATION_DIRECTORY)];
  }
  if (platform === "darwin") {
    return [
      path.posix.join(home, "Library", "Application Support", APPLICATION_DIRECTORY),
      path.posix.join(home, ".config", APPLICATION_DIRECTORY),
      path.posix.join(home, ".config", "cinebraid"),
    ];
  }
  return [path.posix.join(home, ".config", APPLICATION_DIRECTORY), path.posix.join(home, ".config", "cinebraid")];
}

/* What may be said about the per-user location without naming anyone's profile. */
function symbolicSettingsPath({ env = process.env, platform = process.platform } = {}) {
  if (platform === "win32") return "%LOCALAPPDATA%\\CineBraid\\config.json";
  if (platform === "darwin") return "~/Library/Application Support/CineBraid/config.json";
  return variable(env, "XDG_CONFIG_HOME") ? "$XDG_CONFIG_HOME/CineBraid/config.json" : "~/.config/CineBraid/config.json";
}

function symbolicLegacyPath(platform = process.platform) {
  return platform === "win32" ? "<application folder>\\data\\config.json" : "<application folder>/data/config.json";
}

/* Pure: reads nothing. `mode` is override, per-user, or unresolved. */
function resolveConfigLocation({ env = process.env, platform = process.platform, appRoot }) {
  const legacyPath = path.join(appRoot, "data", SETTINGS_FILE);
  if (env && env[OVERRIDE_ENV]) {
    const file = path.resolve(env[OVERRIDE_ENV]);
    return { mode: "override", path: file, directory: path.dirname(file), symbolic: OVERRIDE_SYMBOLIC, legacyPath };
  }
  const directory = perUserConfigurationDirectory({ env, platform });
  const symbolic = symbolicSettingsPath({ env, platform });
  if (!directory) return { mode: "unresolved", path: "", directory: "", symbolic, legacyPath };
  return { mode: "per-user", path: path.join(directory, SETTINGS_FILE), directory, symbolic, legacyPath };
}

class ConfigLocationError extends Error {
  /* `status` is what startup says: "legacy migration required", "legacy migration failed",
     or "per-user location unavailable". `reason` is a sentence with no path and no value. */
  constructor(status, reasonCode, reason) {
    super(`${status}: ${reason}`);
    this.name = "ConfigLocationError";
    this.code = "CONFIG_LOCATION_REFUSED";
    this.status = status;
    this.reasonCode = reasonCode;
    this.reason = reason;
  }
}
const migrationFailed = (code, reason) => new ConfigLocationError("legacy migration failed", code, reason);

function entryExists(target, ops = fs) {
  try {
    ops.lstatSync(target);
    return true;
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw new ConfigLocationError("legacy migration failed", "LOCATION_UNCHECKABLE", "a settings location could not be checked");
  }
}

function legacySettingsPresent(location, ops = fs) {
  return entryExists(location.legacyPath, ops) || entryExists(`${location.legacyPath}.bak`, ops);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return Boolean(error && error.code === "EPERM"); }
}

/* Owner-only where the platform has modes. Windows access is governed by the ACL the
   per-user tree inherits, which is checked operationally rather than assumed here. */
function restrictMode(target, mode, ops = fs) {
  if (process.platform === "win32") return;
  try { ops.chmodSync(target, mode); } catch { /* best effort: the directory's own mode still applies */ }
}

/* A migration temp left by a CineBraid that is no longer running holds a copy of somebody's
   settings, so it is removed — and only that: our own pattern, and only a dead owner's. */
function removeStaleMigrationTemps(directory, ops = fs, pid = process.pid) {
  let names;
  try { names = ops.readdirSync(directory); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    const match = MIGRATION_TEMP.exec(name);
    if (!match) continue;
    const owner = Number(match[1]);
    if (owner === pid || processAlive(owner)) continue;
    try { ops.unlinkSync(path.join(directory, name)); removed += 1; } catch { /* another process got there first */ }
  }
  return removed;
}

function sameProjectRoot(left, right) {
  return (left && left.workspace && left.workspace.projectRoot) === (right && right.workspace && right.workspace.projectRoot);
}

function writeMigrationRecord({ directory, appRoot, chosen, sourceStat, now, ops }) {
  const record = {
    recordVersion: 1,
    migratedAt: new Date(now()).toISOString(),
    from: chosen.source === "primary" ? "application settings" : "application settings backup",
    sourceInstallation: appRoot,
    sourceBytes: chosen.bytes.length,
    sourceMtimeMs: sourceStat ? sourceStat.mtimeMs : null,
    sourceSha256: crypto.createHash("sha256").update(chosen.bytes).digest("hex"),
  };
  let fd;
  try {
    fd = ops.openSync(path.join(directory, MIGRATION_RECORD), "wx", 0o600);
    ops.writeFileSync(fd, JSON.stringify(record, null, 2) + "\n");
    ops.fsyncSync(fd);
  } catch {
    /* The record only describes the move; the move stands without it. */
  } finally {
    if (fd !== undefined) { try { ops.closeSync(fd); } catch { /* closed */ } }
  }
}

/* THE TRANSACTION. Copy, verify, publish create-only. Throws ConfigLocationError with
   status "legacy migration failed" and leaves nothing behind but what was already there. */
function migrateLegacySettings({
  location, appRoot, parseBytes, presence,
  ops = fs, pid = process.pid, now = Date.now, random = () => crypto.randomBytes(4).toString("hex"),
}) {
  const { directory, path: destination, legacyPath } = location;

  /* 1. The document an ordinary start would have used: the primary, or its backup. */
  let chosen = null;
  for (const [source, candidate] of [["primary", legacyPath], ["backup", `${legacyPath}.bak`]]) {
    let bytes;
    try { bytes = ops.readFileSync(candidate); } catch { continue; }
    let parsed;
    try { parsed = parseBytes(bytes); } catch { continue; }
    chosen = { source, candidate, bytes: Buffer.from(bytes), parsed };
    break;
  }
  if (!chosen) {
    throw migrationFailed("LEGACY_UNREADABLE", "the settings in the application folder could not be read, and neither could their backup");
  }
  let sourceStat = null;
  try { sourceStat = ops.statSync(chosen.candidate); } catch { /* the record says so */ }

  /* 2. The destination directory, owner-only where modes exist. */
  const createdDirectory = !entryExists(directory, ops);
  try {
    ops.mkdirSync(directory, { recursive: true, mode: 0o700 });
  } catch {
    throw migrationFailed("DESTINATION_UNAVAILABLE", "the per-user settings folder could not be created");
  }
  restrictMode(directory, 0o700, ops);
  removeStaleMigrationTemps(directory, ops, pid);

  const temp = path.join(directory, `.config.json.migrate.${pid}.${now()}.${random()}.tmp`);
  let fd;
  let published = false;
  try {
    /* 3. The copy, beside its destination, created exclusively. */
    try {
      fd = ops.openSync(temp, "wx", 0o600);
      ops.writeFileSync(fd, chosen.bytes);
      ops.fsyncSync(fd);
      ops.closeSync(fd);
      fd = undefined;
    } catch {
      throw migrationFailed("COPY_FAILED", "the copy could not be written");
    }

    /* 4. Verified in memory: the same bytes, the same settings, the same project folder, the
          same saved keys. Nothing about any of them is printed. */
    const copied = ops.readFileSync(temp);
    if (!Buffer.from(copied).equals(chosen.bytes)) {
      throw migrationFailed("VERIFICATION_MISMATCH", "the copy did not match the original byte for byte");
    }
    let reparsed;
    try { reparsed = parseBytes(copied); } catch {
      throw migrationFailed("VERIFICATION_MISMATCH", "the copy could not be read back");
    }
    if (!util.isDeepStrictEqual(reparsed, chosen.parsed)) {
      throw migrationFailed("VERIFICATION_MISMATCH", "the copy did not read back as the same settings");
    }
    if (!sameProjectRoot(reparsed, chosen.parsed)) {
      throw migrationFailed("VERIFICATION_MISMATCH", "the saved project folder did not survive the copy");
    }
    if (!util.isDeepStrictEqual(presence(reparsed), presence(chosen.parsed))) {
      throw migrationFailed("VERIFICATION_MISMATCH", "the saved keys did not survive the copy");
    }

    /* 5. Published create-only. link() fails rather than replacing, so a per-user file that
          appeared in the meantime — another CineBraid got there first — is left alone and
          becomes the authority. rename() would replace it on Windows, which is why it is not
          used here. */
    try {
      ops.linkSync(temp, destination);
      published = true;
    } catch (error) {
      if (error && error.code === "EEXIST") return { state: "raced", source: chosen.source };
      throw migrationFailed("ACTIVATION_FAILED", "the copy could not be put in place");
    }
  } catch (error) {
    throw error instanceof ConfigLocationError ? error : migrationFailed("MIGRATION_FAILED", "the settings could not be moved");
  } finally {
    if (fd !== undefined) { try { ops.closeSync(fd); } catch { /* closed */ } }
    try { ops.unlinkSync(temp); } catch { /* never created, or already gone */ }
    if (!published && createdDirectory) { try { ops.rmdirSync(directory); } catch { /* not empty: not ours to remove */ } }
  }

  restrictMode(destination, 0o600, ops);
  writeMigrationRecord({ directory, appRoot, chosen, sourceStat, now, ops });
  return { state: "migrated", source: chosen.source };
}

/* Rules 2–4 for a per-user location. Rule 1 never reaches here. */
function activatePerUserSettings({ location, ...options }) {
  if (!location || location.mode !== "per-user") throw new Error("activatePerUserSettings needs a per-user location");
  const ops = options.ops || fs;
  if (entryExists(location.path, ops)) {
    removeStaleMigrationTemps(location.directory, ops, options.pid || process.pid);
    return { state: "existing" };
  }
  if (!legacySettingsPresent(location, ops)) return { state: "fresh" };
  return migrateLegacySettings({ location, ...options });
}

function startupSettingsLine(location, activation = {}) {
  if (location.mode === "override") return "Settings: explicit override (CINEBRAID_CONFIG_PATH)";
  const moved = activation.state === "migrated" ? " — moved from the application folder on this start" : "";
  return `Settings: per-user (${location.symbolic})${moved}`;
}

/* What Settings may show. The exact path only to a browser on this computer whose request
   carries nothing a proxy adds; anything else — a LAN device, a forwarded request, a request
   whose peer cannot be established — gets the symbolic location. Never the contents. */
const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip"];
function settingsLocationDisclosure(req, location) {
  const headers = (req && req.headers) || {};
  const exact = isLoopbackRequest(req) && !FORWARDING_HEADERS.some((name) => headers[name] !== undefined);
  return {
    mode: location.mode === "override" ? "explicit override" : "per-user",
    symbolic: location.symbolic,
    exact,
    path: exact ? location.path : "",
  };
}

module.exports = {
  APPLICATION_DIRECTORY,
  ConfigLocationError,
  MIGRATION_RECORD,
  MIGRATION_TEMP,
  OVERRIDE_ENV,
  OVERRIDE_SYMBOLIC,
  SETTINGS_FILE,
  activatePerUserSettings,
  knownPerUserConfigurationDirectories,
  legacySettingsPresent,
  migrateLegacySettings,
  perUserConfigurationDirectory,
  removeStaleMigrationTemps,
  resolveConfigLocation,
  settingsLocationDisclosure,
  startupSettingsLine,
  symbolicLegacyPath,
  symbolicSettingsPath,
};

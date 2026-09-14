"use strict";

/* WHERE A DECLARED TEST RUN MAY KEEP ITS SETTINGS AND ITS PROJECTS.
 *
 * One rule with three readers, so they cannot disagree:
 *
 *   - the server's test-mode refusal (src/server/server.js), which asks before the
 *     settings file is read and before a storage path is created;
 *   - the disposable workspace every automated run builds
 *     (tests/helpers/disposable-root.js — the Python browser runtime drives that helper
 *     rather than re-implementing it);
 *   - the browser gate's check of the locations each suite actually used.
 *
 * A location is DISPOSABLE when it is inside the system temporary directory and is none
 * of the places real work lives:
 *
 *   - the application directory the server was started from;
 *   - any CineBraid installation or source checkout, recognised by its own files rather
 *     than by its name, so a worktree cannot reach another checkout's data/config.json;
 *   - the account's ordinary per-user configuration directories. These come from the OS
 *     account's real home (os.userInfo()), never from HOME or USERPROFILE alone, because
 *     a disposable profile overrides exactly those variables;
 *   - the account's ordinary default projects root.
 *
 * Comparisons are PHYSICAL. The nearest existing ancestor of a location is resolved with
 * realpath, so a junction, a symlink or an 8.3 short name cannot carry a path out of a
 * boundary it appears to be inside.
 *
 * Nothing here writes, and nothing here runs unless a caller asks. The server only asks
 * when the run declares itself a test, so ordinary use is untouched. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const ConfigLocation = require("./config-location");

/* Written into every disposable workspace, and required before one is removed. */
const DISPOSABLE_MARKER = ".cinebraid-disposable";

function realAccountHome() {
  try { return os.userInfo().homedir || ""; } catch { return ""; }
}

/* Resolves the nearest existing ancestor physically and re-attaches the rest, so a
   location that does not exist yet is still judged by where it would really land. */
function physical(target) {
  const requested = path.resolve(String(target));
  let current = requested;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return requested;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

function contains(parent, child) {
  const fold = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  const rel = path.relative(fold(parent), fold(child));
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
}

/* A CineBraid installation or checkout, found by the two files every one of them has. */
function installationContaining(target) {
  let dir = physical(target);
  for (;;) {
    if (fs.existsSync(path.join(dir, "server.js")) && fs.existsSync(path.join(dir, "src", "server", "config.js"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
}

/* The ordinary per-user configuration directories for an account on the host platform. They
   come from config-location.js, the one platform table, so the directory this rule refuses is
   always the directory the product writes. */
function perUserConfigurationDirectories(home = realAccountHome(), platform = process.platform) {
  return ConfigLocation.knownPerUserConfigurationDirectories(home, platform);
}

function defaultProjectsRoot(home = realAccountHome(), platform = process.platform) {
  if (!home) return "";
  return (platform === "win32" ? path.win32 : path.posix).join(home, "CineBraid Projects");
}

/* Every live configuration directory worth refusing and watching: the account's own,
   plus any the environment relocates to somewhere that is not itself temporary. A
   disposable profile points these variables into the temporary directory, and those are
   the test's own, not live. */
function liveConfigurationDirectories({ home = realAccountHome(), env = process.env, platform = process.platform, tmpdir = os.tmpdir() } = {}) {
  const temporary = physical(tmpdir);
  const relocated = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "CineBraid"),
    env.APPDATA && path.join(env.APPDATA, "CineBraid"),
    env.XDG_CONFIG_HOME && path.join(env.XDG_CONFIG_HOME, ConfigLocation.APPLICATION_DIRECTORY),
    env.XDG_CONFIG_HOME && path.join(env.XDG_CONFIG_HOME, "cinebraid"),
  ].filter((dir) => dir && !contains(temporary, physical(dir)));
  const seen = new Set();
  return [...perUserConfigurationDirectories(home, platform), ...relocated].filter((dir) => {
    const key = process.platform === "win32" ? physical(dir).toLowerCase() : physical(dir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* The configuration locations a test run must never change, for a census to watch. */
function liveConfigurationLocations(appRoot, options = {}) {
  return [
    { kind: "application settings", path: path.join(appRoot, "data") },
    ...liveConfigurationDirectories(options).map((dir) => ({ kind: "per-user settings", path: dir })),
  ];
}

/* null when `target` is disposable; otherwise why it is not. */
function disposableLocationRefusal(target, { appRoot = "", tmpdir = os.tmpdir(), home = realAccountHome(), env = process.env, platform = process.platform } = {}) {
  const raw = String(target || "").trim();
  if (!raw) return { code: "MISSING", reason: "no location was given" };
  const real = physical(raw);
  if (appRoot && contains(physical(appRoot), real)) {
    return { code: "INSIDE_APPLICATION", reason: "it is inside the application directory" };
  }
  const installation = installationContaining(real);
  if (installation) {
    return { code: "INSIDE_INSTALLATION", reason: `it is inside a CineBraid installation (${installation})` };
  }
  if (liveConfigurationDirectories({ home, env, platform, tmpdir }).some((dir) => contains(physical(dir), real))) {
    return { code: "PER_USER_CONFIGURATION", reason: "it is an ordinary per-user configuration location" };
  }
  const projects = defaultProjectsRoot(home, platform);
  if (projects && contains(physical(projects), real)) {
    return { code: "DEFAULT_PROJECTS_ROOT", reason: "it is the ordinary projects location" };
  }
  if (!contains(physical(tmpdir), real)) {
    return { code: "NOT_TEMPORARY", reason: "it is outside the system temporary directory" };
  }
  return null;
}

/* null when `appRoot` is a disposable COPY of the application: its folder sits somewhere
   disposable and inside no other installation. A real checkout never is one. A test run may
   only move settings out of an application folder like that. */
function disposableInstallationRefusal(appRoot, options = {}) {
  return disposableLocationRefusal(path.dirname(physical(appRoot)), { ...options, appRoot: "" });
}

module.exports = {
  DISPOSABLE_MARKER,
  contains,
  defaultProjectsRoot,
  disposableInstallationRefusal,
  disposableLocationRefusal,
  installationContaining,
  liveConfigurationDirectories,
  liveConfigurationLocations,
  perUserConfigurationDirectories,
  physical,
  realAccountHome,
};

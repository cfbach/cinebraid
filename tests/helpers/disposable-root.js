"use strict";

/* A disposable CineBraid workspace, for anything automated.
 *
 * THE CONTRACT, in one line: a test may not be able to see the developer's projects or
 * settings, let alone write to them.
 *
 * CineBraid reads its configuration from CINEBRAID_CONFIG_PATH and its projects from
 * CINEBRAID_PROJECTS_ROOT. Point both at a directory this helper made and a suite
 * cannot reach the repository's own `projects/` and `data/`, the ordinary per-user
 * settings, or the real production workspace, whatever it does. scripts/qa-sandbox.js
 * does this for a human driving the app by hand; this is the same guarantee for a test.
 *
 *     const workspace = disposableRoot("my-suite");
 *     const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: workspace.serverEnv(port) });
 *     ...
 *     workspace.cleanup();
 *
 * ONE RULE. What counts as disposable is src/server/test-isolation.js — the same rule
 * the server applies when a run declares itself a test, and the browser gate applies to
 * every location a suite reports. The Python browser runtime drives this file through
 * its command line rather than keeping a second implementation.
 *
 * WHAT IT REFUSES. A workspace anywhere that is not disposable: inside the repository,
 * inside any CineBraid installation, in the ordinary per-user settings or projects
 * locations, or outside the system temporary directory. There is no settings-path
 * parameter at all, so a caller cannot point a workspace at a live settings file.
 *
 * IT COPIES THE SAMPLE, NEVER LINKS IT. `withSample` puts an ordinary editable copy of
 * the shipped sample in the disposable root. Editing it cannot reach the tracked one,
 * which is the whole reason a copy and not a junction — and the runtime artefacts a
 * previous run left inside the shipped sample are left behind rather than carried
 * forward, because a per-install asset ledger belongs to the install that minted it.
 *
 * IT CARRIES NO CREDENTIALS. The config it produces disables every provider and the
 * environment it hands out blanks every provider key, so a suite that forgets to stub
 * one gets a refusal rather than a paid request.
 *
 * IT CLEANS UP DETERMINISTICALLY. `cleanup()` removes the workspace, and only a
 * directory carrying this helper's marker. Anything still open when the process exits —
 * including an exit caused by an uncaught exception — is removed then.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const TestIsolation = require("../../src/server/test-isolation");
const ConfigLocation = require("../../src/server/config-location");

const ROOT = path.resolve(__dirname, "..", "..");
const BUNDLED_SAMPLE = path.join(ROOT, "projects", "cinebraid-sample");
/* The runtime files CineBraid writes inside the sample. The same set
   scripts/qa-sandbox.js leaves behind, for the same reason. */
const RUNTIME_ARTIFACTS = new Set([
  "backups", "generation-jobs.json", "agent-index.json", "test-feedback.json",
  "embeddings.json", "media-assets.json",
]);
/* Provider credentials read from the environment. Blanked, not merely unset, so an
   inherited value cannot survive the spread into a child's environment. */
const CREDENTIAL_ENV = ["FAL_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY"];
/* When set, every workspace appends where it lives here, so a runner — the browser gate —
   can check the locations a suite actually used rather than the ones it was meant to. */
const LEDGER_ENV = "CINEBRAID_TEST_ISOLATION_LEDGER";
const { DISPOSABLE_MARKER } = TestIsolation;

/* Every provider off, so an un-stubbed call cannot become a real one. */
function isolatedConfig(extra = {}) {
  return {
    assistant: { provider: "none", visionProvider: "none" },
    agents: { enabled: false },
    generation: { fal: { enabled: false } },
    workspace: { projectRoot: "", mediaRoot: "", outputRoot: "", backupRoot: "" },
    activeProject: "",
    ...extra,
  };
}

function insideRepository(target) {
  const rel = path.relative(ROOT, path.resolve(target));
  if (!rel) return true;
  return !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep) && !rel.startsWith("../");
}

function refusal(target) {
  return TestIsolation.disposableLocationRefusal(target, { appRoot: ROOT });
}

/* Workspaces this process made and has not yet removed. */
const OPEN = new Set();
process.on("exit", () => {
  for (const workspace of [...OPEN]) {
    try { workspace.cleanup(); } catch { /* a refusal to remove is already the right outcome */ }
  }
});

/* Removes a disposable workspace, and nothing that is not one. */
function removeDisposableHome(home) {
  if (!home) return false;
  const target = path.resolve(String(home));
  if (!fs.existsSync(target)) return false;
  if (!fs.existsSync(path.join(target, DISPOSABLE_MARKER)))
    throw new Error(`Refusing to remove ${target}: it does not carry the disposable-workspace marker.`);
  const why = refusal(target);
  if (why) throw new Error(`Refusing to remove ${target}: ${why.reason}.`);
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function claimHome(label, at) {
  if (at) {
    const target = path.resolve(at);
    if (insideRepository(target))
      throw new Error(`A disposable workspace may not live inside the repository (${target}). Choose a directory outside ${ROOT}.`);
    const why = refusal(target);
    if (why) throw new Error(`A disposable workspace must be in a disposable location, and ${target} is not: ${why.reason}.`);
    if (fs.existsSync(target) && fs.readdirSync(target).length)
      throw new Error(`A disposable workspace must start empty, and ${target} does not.`);
    fs.mkdirSync(target, { recursive: true });
    return target;
  }
  const slug = String(label).replace(/[^a-z0-9-]+/gi, "-");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `cinebraid-${slug}-`));
  const why = insideRepository(home) ? { reason: "it is inside the repository" } : refusal(home);
  if (why) {
    fs.rmSync(home, { recursive: true, force: true });
    throw new Error(`The system temporary directory cannot hold a disposable workspace here (${home}): ${why.reason}. Check TMPDIR/TEMP.`);
  }
  return home;
}

/* Build one. `label` only names the temporary directory, so a leftover is traceable to
   the suite that made it.

   `profile` gives the run a disposable HOME as well — USERPROFILE, HOME, LOCALAPPDATA,
   APPDATA and XDG_CONFIG_HOME all inside the workspace — and leaves the projects root to
   the application's own default, which then resolves inside that profile. It is how a
   check exercises default-path behaviour without the real account's locations. */
/* `perUserSettings` (with `profile`) names no settings path at all, so CineBraid resolves its
   per-user settings location inside the disposable profile, and nothing is written there in
   advance. `configPath` is where that resolves to. */
function disposableRoot(label = "suite", { withSample = false, config = {}, at = "", profile = false, perUserSettings = false, register = true } = {}) {
  if (perUserSettings && !profile) throw new Error("perUserSettings needs a disposable profile to resolve inside.");
  const home = claimHome(label, at);
  fs.writeFileSync(path.join(home, DISPOSABLE_MARKER),
    JSON.stringify({ label: String(label), pid: process.pid, createdAt: new Date().toISOString() }) + "\n", "utf8");

  const profileHome = profile ? path.join(home, "profile") : "";
  const projectsRoot = profile ? path.join(profileHome, "CineBraid Projects") : path.join(home, "projects");
  const profileEnv = profile
    ? {
      CINEBRAID_PROJECTS_ROOT: "",
      USERPROFILE: profileHome,
      HOME: profileHome,
      LOCALAPPDATA: path.join(profileHome, "AppData", "Local"),
      APPDATA: path.join(profileHome, "AppData", "Roaming"),
      XDG_CONFIG_HOME: path.join(profileHome, ".config"),
    }
    : {};
  const configPath = perUserSettings
    ? ConfigLocation.resolveConfigLocation({ env: profileEnv, appRoot: ROOT }).path
    : path.join(home, "config.json");
  if (profile) {
    for (const parts of [["AppData", "Local"], ["AppData", "Roaming"], [".config"]])
      fs.mkdirSync(path.join(profileHome, ...parts), { recursive: true });
  } else {
    fs.mkdirSync(projectsRoot, { recursive: true });
  }
  if (!perUserSettings) fs.writeFileSync(configPath, JSON.stringify(isolatedConfig(config), null, 2) + "\n", "utf8");

  const env = {
    CINEBRAID_CONFIG_PATH: perUserSettings ? "" : configPath,
    CINEBRAID_TEST_MODE: "1",
    ...Object.fromEntries(CREDENTIAL_ENV.map((name) => [name, ""])),
    ...(profile ? profileEnv : { CINEBRAID_PROJECTS_ROOT: projectsRoot }),
  };

  const workspace = {
    home, projectsRoot, configPath, profileHome, env,
    /* The complete environment for `node server.js`: everything inherited, then this
       workspace's variables on top so nothing inherited can override them. */
    serverEnv(port, extra = {}) {
      return { ...process.env, ...env, PORT: String(port), ...extra };
    },
    installSample(slug = "cinebraid-sample") {
      const destination = path.join(projectsRoot, slug);
      fs.cpSync(BUNDLED_SAMPLE, destination, {
        recursive: true,
        filter: (source) => !RUNTIME_ARTIFACTS.has(path.basename(source))
          && !path.basename(source).toLowerCase().endsWith(".bak"),
      });
      return destination;
    },
    writeProject(slug, document) {
      const dir = path.join(projectsRoot, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(document, null, 2) + "\n", "utf8");
      return dir;
    },
    /* Removed from the exit backstop only once it is really gone, so a removal that fails
       now — a file a just-killed server still holds — is tried again at exit. */
    cleanup() {
      removeDisposableHome(home);
      OPEN.delete(workspace);
    },
  };

  const ledger = process.env[LEDGER_ENV];
  if (ledger) {
    fs.appendFileSync(ledger, JSON.stringify({ label: String(label), home, configPath, projectsRoot, pid: process.pid }) + "\n", "utf8");
  }
  if (register) OPEN.add(workspace);
  if (withSample) workspace.installSample();
  return workspace;
}

function readLedger(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

/* Problems with the locations a run reported: anything not disposable, and anything
   left behind. Empty when the run was isolated. */
function verifyLedgerEntries(entries) {
  const problems = [];
  for (const entry of entries) {
    for (const [subject, target] of [["settings file", entry.configPath], ["projects root", entry.projectsRoot]]) {
      const why = refusal(target);
      if (why) problems.push(`${entry.label}: ${subject} ${target} was not disposable (${why.reason})`);
    }
    if (entry.home && fs.existsSync(entry.home))
      problems.push(`${entry.label}: disposable workspace ${entry.home} was left behind`);
  }
  return problems;
}

/* A disposable COPY of the application, for a check that must start a server whose own
   installation — its `data/` and `projects/` — is disposable too. A refusal check that
   ran against this checkout would, if the refusal were ever broken, read and rewrite the
   checkout's own settings file; against a copy, the worst case is a temporary file.
   Dependencies are not copied: the copy resolves them through NODE_PATH. */
const STAGE_EXCLUDED = new Set([".git", ".claude", ".venv-browser", "node_modules", "tests", "docs", "dist", "projects", "data"]);
const SHIPPED_DATA = ["model-profiles.json", "model-definitions.json", "provider-surfaces.json"];
function stageInstallation(label = "install", { replace = {} } = {}) {
  const workspace = disposableRoot(`${label}-app`);
  const app = path.join(workspace.home, "app");
  fs.mkdirSync(path.join(app, "data"), { recursive: true });
  fs.mkdirSync(path.join(app, "projects"), { recursive: true });
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (STAGE_EXCLUDED.has(entry.name) || entry.name.endsWith(".log")) continue;
    fs.cpSync(path.join(ROOT, entry.name), path.join(app, entry.name), { recursive: true });
  }
  for (const name of SHIPPED_DATA) fs.copyFileSync(path.join(ROOT, "data", name), path.join(app, "data", name));
  for (const [relative, text] of Object.entries(replace)) fs.writeFileSync(path.join(app, relative), text);
  return { app, workspace, nodePath: path.join(ROOT, "node_modules"), cleanup: () => workspace.cleanup() };
}

module.exports = {
  BUNDLED_SAMPLE,
  CREDENTIAL_ENV,
  DISPOSABLE_MARKER,
  LEDGER_ENV,
  ROOT,
  RUNTIME_ARTIFACTS,
  disposableRoot,
  insideRepository,
  isolatedConfig,
  readLedger,
  removeDisposableHome,
  stageInstallation,
  verifyLedgerEntries,
};

/* The command line the Python browser runtime drives, so both languages share this file:
     node tests/helpers/disposable-root.js create --label <label> [--sample] [--profile] [--active-project <slug>]
     node tests/helpers/disposable-root.js cleanup --home <path>
   A workspace created here is handed to the caller, which owns its removal. */
if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || "") : "";
  };
  let created = null;
  try {
    if (command === "create") {
      const active = option("--active-project");
      created = disposableRoot(option("--label") || "suite", {
        profile: args.includes("--profile"), config: active ? { activeProject: active } : {}, register: false,
      });
      if (args.includes("--sample")) created.installSample();
      process.stdout.write(JSON.stringify({
        home: created.home, projectsRoot: created.projectsRoot, configPath: created.configPath, env: created.env,
      }) + "\n");
    } else if (command === "cleanup") {
      removeDisposableHome(option("--home"));
    } else {
      console.error("usage: node tests/helpers/disposable-root.js create --label <label> [--sample] [--profile] [--active-project <slug>]\n"
        + "       node tests/helpers/disposable-root.js cleanup --home <path>");
      process.exitCode = 2;
    }
  } catch (error) {
    if (created) { try { removeDisposableHome(created.home); } catch { /* reported below */ } }
    console.error(error.message);
    process.exitCode = 1;
  }
}

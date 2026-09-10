"use strict";

/* A disposable CineBraid workspace, for anything automated.
 *
 * THE CONTRACT, in one line: a test may not be able to see the developer's projects,
 * let alone write to them.
 *
 * CineBraid reads its configuration from CINEBRAID_CONFIG_PATH and its projects from
 * CINEBRAID_PROJECTS_ROOT. Point both at a directory this helper made and a suite
 * cannot reach the repository's own `projects/` and `data/`, or the real production
 * workspace, whatever it does. scripts/qa-sandbox.js does this for a human driving the
 * app by hand; this is the same guarantee for a test, in three lines instead of a
 * shell recipe, so there is no longer a reason to skip it.
 *
 *     const workspace = disposableRoot("my-suite");
 *     const server = await startCineBraidServer(workspace.env);
 *     ...
 *     workspace.cleanup();
 *
 * WHAT IT REFUSES. A destination inside the repository, and a caller that asks for a
 * projects root under `projects/` or `data/`. Those are the two mistakes that put QA
 * artefacts in the checkout in the first place, and they are refused rather than
 * tidied up afterwards.
 *
 * IT COPIES THE SAMPLE, NEVER LINKS IT. `withSample` puts an ordinary editable copy of
 * the shipped sample in the disposable root. Editing it cannot reach the tracked one,
 * which is the whole reason a copy and not a junction — and the runtime artefacts a
 * previous run left inside the shipped sample are left behind rather than carried
 * forward, because a per-install asset ledger belongs to the install that minted it.
 *
 * IT WRITES NO CREDENTIALS. The config it produces disables every provider, so a suite
 * that forgets to stub one gets a refusal rather than a paid request.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BUNDLED_SAMPLE = path.join(ROOT, "projects", "cinebraid-sample");
/* The runtime files CineBraid writes inside the sample. The same set
   scripts/qa-sandbox.js leaves behind, for the same reason. */
const RUNTIME_ARTIFACTS = new Set([
  "backups", "generation-jobs.json", "agent-index.json", "test-feedback.json",
  "embeddings.json", "media-assets.json",
]);

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

/* Build one. `label` only names the temporary directory, so a leftover is traceable to
   the suite that made it. */
function disposableRoot(label = "suite", { withSample = false, config = {}, at = "" } = {}) {
  const home = at
    ? path.resolve(at)
    : fs.mkdtempSync(path.join(os.tmpdir(), `cinebraid-${String(label).replace(/[^a-z0-9-]+/gi, "-")}-`));
  if (insideRepository(home))
    throw new Error(`A disposable workspace may not live inside the repository (${home}). Choose a directory outside ${ROOT}.`);

  const projectsRoot = path.join(home, "projects");
  const configPath = path.join(home, "config.json");
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(isolatedConfig(config), null, 2) + "\n", "utf8");

  const workspace = {
    home, projectsRoot, configPath,
    /* Spread straight into a spawn's env, or into startCineBraidServer(). */
    env: {
      CINEBRAID_PROJECTS_ROOT: projectsRoot,
      CINEBRAID_CONFIG_PATH: configPath,
      CINEBRAID_TEST_MODE: "1",
      FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "",
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
    cleanup() { fs.rmSync(home, { recursive: true, force: true }); },
  };

  if (withSample) workspace.installSample();
  return workspace;
}

module.exports = { disposableRoot, insideRepository, isolatedConfig, ROOT, BUNDLED_SAMPLE, RUNTIME_ARTIFACTS };

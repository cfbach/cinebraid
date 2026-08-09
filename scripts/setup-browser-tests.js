/* Provision the real-browser test runtime.

   Usage:
     npm run setup:browser-tests            create/refresh .venv-browser and Chromium
     npm run setup:browser-tests -- --check report what is present, change nothing

   Why this exists: the nine Playwright suites in tests/ had no installer. Nothing
   in the repository, the README or CI ever created a Python environment for them,
   so `from playwright.sync_api import sync_playwright` raised on every machine and
   each suite printed a skip and exited 0. The suites were not broken - they were
   never given a runtime, and the missing runtime was invisible because a skip and
   a pass looked identical.

   Everything lands in .venv-browser inside the repo, which is gitignored and
   therefore cannot reach a release (scripts/build-release.js builds from
   `git archive`, so ignored paths are excluded by construction). A system Python
   is used only to create that environment, never installed into. */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const VENV = path.join(ROOT, ".venv-browser");
const REQUIREMENTS = path.join(ROOT, "tests", "browser-requirements.txt");
const CHECK_ONLY = process.argv.includes("--check");

const WINDOWS = process.platform === "win32";
const venvPython = () => path.join(VENV, WINDOWS ? "Scripts" : "bin", WINDOWS ? "python.exe" : "python");

function fail(message) {
  console.error(`\nBrowser test setup failed: ${message}`);
  process.exit(1);
}

function run(command, args, { capture = false, label = "" } = {}) {
  if (label) console.log(`  ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1" },
  });
  if (result.error) fail(`${command} could not be launched (${result.error.message}).`);
  return result;
}

/* A system interpreter is needed once, to build the environment. */
function findSystemPython() {
  const candidates = WINDOWS
    ? [["py", ["-3"]], ["python", []], ["python3", []]]
    : [["python3", []], ["python", []]];
  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, "--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) continue;
    const version = `${probe.stdout || ""}${probe.stderr || ""}`.trim();
    /* The Microsoft Store stub on Windows answers --version but cannot build a venv;
       it is filtered out by the venv step failing loudly rather than by guesswork. */
    if (/Python 3\./.test(version)) return { command, prefix, version };
  }
  return null;
}

function pythonReports(script) {
  const result = run(venvPython(), ["-c", script], { capture: true });
  return { ok: result.status === 0, out: `${result.stdout || ""}${result.stderr || ""}`.trim() };
}

const PLAYWRIGHT_VERSION_SCRIPT =
  "from importlib.metadata import version; print(version('playwright'))";
const LAUNCH_SCRIPT = [
  "import sys",
  "sys.path.insert(0, 'tests')",
  "from browser_runtime import require_browser, launch_chromium",
  "pw = require_browser('setup verification')().start()",
  "browser = launch_chromium(pw, label='setup verification')",
  "browser.close(); pw.stop()",
].join("; ");

function reportState() {
  const present = fs.existsSync(venvPython());
  if (!present) return { present: false };
  const version = pythonReports(PLAYWRIGHT_VERSION_SCRIPT);
  return { present: true, playwright: version.ok ? version.out : "" };
}

console.log("CineBraid real-browser test setup");
console.log(`  repository      ${ROOT}`);
console.log(`  environment     ${VENV}`);

if (CHECK_ONLY) {
  const state = reportState();
  if (!state.present) {
    console.log("\n  status          NOT INSTALLED — run `npm run setup:browser-tests`.");
    process.exit(1);
  }
  if (!state.playwright) {
    console.log("\n  status          INCOMPLETE — the environment exists but Playwright is not importable.");
    process.exit(1);
  }
  const launch = pythonReports(LAUNCH_SCRIPT);
  console.log(`  playwright      ${state.playwright}`);
  console.log(launch.ok ? `  chromium        ${launch.out}` : `  chromium        UNAVAILABLE\n${launch.out}`);
  console.log(`\n  status          ${launch.ok ? "READY" : "INCOMPLETE — Chromium could not be launched."}`);
  process.exit(launch.ok ? 0 : 1);
}

if (!fs.existsSync(REQUIREMENTS)) fail(`${REQUIREMENTS} is missing.`);

if (!fs.existsSync(venvPython())) {
  const python = findSystemPython();
  if (!python) {
    fail("no Python 3 interpreter was found. Install Python 3.10 or newer from python.org " +
      "(tick \"Add python.exe to PATH\" on Windows) and run this command again.");
  }
  console.log(`  system python   ${python.version}`);
  const created = run(python.command, [...python.prefix, "-m", "venv", VENV], { label: "creating .venv-browser" });
  if (created.status !== 0 || !fs.existsSync(venvPython())) {
    fail("the virtual environment could not be created. On Windows this usually means the " +
      "Microsoft Store Python stub is first on PATH; install Python from python.org instead.");
  }
} else {
  console.log("  system python   not needed (.venv-browser already exists)");
}

const installed = run(venvPython(), ["-m", "pip", "install", "--disable-pip-version-check", "-r", REQUIREMENTS],
  { label: `installing ${path.relative(ROOT, REQUIREMENTS)}` });
if (installed.status !== 0) fail("pip could not install the browser test dependencies.");

/* Playwright's own Chromium, matched to the pinned package version. Without this the
   suites fall back to whatever Chrome the machine happens to have, which is fine for
   a workflow assertion and not fine for a layout one. */
const browsers = run(venvPython(), ["-m", "playwright", "install", "chromium"],
  { label: "downloading the matching Chromium (~115 MB on first run)" });
if (browsers.status !== 0) fail("Playwright could not download Chromium.");

const state = reportState();
const launch = pythonReports(LAUNCH_SCRIPT);
console.log("\nReady.");
console.log(`  playwright      ${state.playwright}`);
console.log(`  chromium        ${launch.ok ? launch.out : "could not be launched"}`);
console.log("\nRun the real-browser suites with:");
console.log("  npm run check:browser-gate      every real-browser suite, missing runtime fails");
console.log("  npm run check:release           the full check plus that gate");
if (!launch.ok) {
  console.error(`\nChromium verification failed:\n${launch.out}`);
  process.exit(1);
}

/* Launch one real-browser Python suite.

   Interpreter order matters. The project-managed environment created by
   `npm run setup:browser-tests` is tried first, because that is the only
   interpreter the repository can vouch for: it is where Playwright is installed
   and where the matching Chromium is registered. A system Python is the
   fallback so an already-provisioned machine still works.

   The exit code when nothing is available is the part that was wrong before.
   This runner used to print a sentence and fall off the end of the file, which
   exits 0 - so a missing interpreter and a passing browser suite were the same
   result to npm, and five suites contributed nothing to `npm run check` while
   appearing to pass. Under CINEBRAID_BROWSER_REQUIRED that is now exit 1 with
   the setup command. Without it the skip is preserved on purpose, so a fresh
   clone can still run the portable checks. */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const VENV = path.join(ROOT, ".venv-browser");
const SETUP_HINT =
  "Run `npm run setup:browser-tests` to create the project-managed Python environment " +
  "and download Chromium, then re-run this check. See docs/qa/BROWSER_TESTS.md.";

function browserRequired() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.CINEBRAID_BROWSER_REQUIRED || "").trim().toLowerCase());
}

function venvPython() {
  const candidate = process.platform === "win32"
    ? path.join(VENV, "Scripts", "python.exe")
    : path.join(VENV, "bin", "python");
  return fs.existsSync(candidate) ? candidate : "";
}

/* Interpreters this runner will try, most trusted first. */
function interpreters() {
  const managed = venvPython();
  const system = process.platform === "win32"
    ? [["py", ["-3"]], ["python", []], ["python3", []]]
    : [["python3", []], ["python", []]];
  return managed ? [[managed, []], ...system] : system;
}

const script = process.argv[2];
if (!script) {
  console.error("Usage: node tests/run-python-check.js <script.py> [NAME=value ...]");
  process.exit(2);
}

/* EXTRA `NAME=value` ARGUMENTS BECOME THE SUITE'S ENVIRONMENT.
   An npm script cannot set an inline variable portably - `FOO=bar cmd` is a shell-ism
   that Windows does not honour - and a file that carries two contracts needs to be told
   which one to run. Passing it as an argument keeps that decision in package.json, where
   the gate can read it, rather than in a wrapper nobody else can see. */
const extraEnv = {};
for (const entry of process.argv.slice(3)) {
  const split = entry.indexOf("=");
  if (split > 0) extraEnv[entry.slice(0, split)] = entry.slice(split + 1);
}

for (const [command, prefix] of interpreters()) {
  const probe = spawnSync(command, [...prefix, "--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) continue;
  const run = spawnSync(command, [...prefix, path.resolve(script)], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...extraEnv },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (run.error) {
    console.error(run.error.message);
    process.exit(1);
  }
  process.exit(run.status == null ? 1 : run.status);
}

if (browserRequired()) {
  console.error(`${script} FAILED: no Python 3 interpreter was found. ${SETUP_HINT}`);
  process.exit(1);
}
console.log(`Python browser check skipped: no Python 3 interpreter was found for ${script}. Run npm run check:quick for the portable Node-only verification.`);

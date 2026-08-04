const { spawnSync } = require("child_process");
const path = require("path");

const script = process.argv[2];
if (!script) {
  console.error("Usage: node tests/run-python-check.js <script.py>");
  process.exit(2);
}

const candidates = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];

for (const [command, prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, "--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) continue;
  const run = spawnSync(command, [...prefix, path.resolve(script)], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (run.error) {
    console.error(run.error.message);
    process.exit(1);
  }
  process.exit(run.status == null ? 1 : run.status);
}

console.log(`Python browser check skipped: no Python 3 interpreter was found for ${script}. Run npm run check:quick for the portable Node-only verification.`);

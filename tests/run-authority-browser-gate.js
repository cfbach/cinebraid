"use strict";

/* A narrow mandatory Chromium gate for O8. This wraps the repository-approved
 * Python launcher, requires a real launch receipt, and requires the canonical
 * 13/13 + 2/2 accounting line. A missing Python/Playwright/Chromium runtime is a
 * gate failure, never a skip. */
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const result = spawnSync(process.execPath, [
  path.join(ROOT, "tests", "run-python-check.js"),
  path.join(ROOT, "tests", "authority-write-seam-real-browser.py"),
], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, CINEBRAID_BROWSER_REQUIRED: "1" },
});
const output = `${result.stdout || ""}${result.stderr || ""}`;
process.stdout.write(output);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status == null ? 1 : result.status);
if (!/^\[browser-runtime\] .+: launched Chromium \S+ \(.+\)$/m.test(output)) {
  console.error("O8 authority browser gate failed: the suite exited without a real Chromium launch receipt.");
  process.exit(1);
}
if (!/13\/13 unique browser scenarios passed; 2\/2 secondary browser executions passed; provider calls: 0\./.test(output)) {
  console.error("O8 authority browser gate failed: canonical browser scenario accounting was not reported.");
  process.exit(1);
}
console.log("O8 authority browser gate passed with a real Chromium launch receipt.");

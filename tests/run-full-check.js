const { spawn } = require("child_process");

const nodeSuites = [
  "check:syntax",
  "check:render",
  "check:behavior",
  "check:browser",
  "check:benchmark",
  "check:project-builder",
  "check:composer",
  "check:history",
  "check:fal",
  "check:h3",
  "check:preview-ux",
  "check:api",
  "check:diagnostics",
  "check:activity",
  "check:coverage",
  "check:safety",
  "check:focused",
  "check:reference-ux",
  "check:reference-repair",
  "check:state-chain-recovery",
  "check:reference-authority",
  "check:recovery",
  "check:bounded",
  "check:clarity",
  "check:integrity",
  "check:manual-first",
  "check:manual-parity",
  "check:readiness-feedback",
  "check:blocking-automation",
  "check:automation-restoration",
  "check:v6641",
  "check:custom-provider",
];

const browserSuites = ["check:manual-browser", "check:browser-real", "check:h3-browser", "check:preview-layout", "check:ui-state"];
const releaseSuites = ["check:environment", "check:package"];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runScript(name) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    console.log(`\n=== ${name} ===`);
    const child = spawn(npmCommand, ["run", name], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) return reject(new Error(`${name} terminated by ${signal}`));
      if (code !== 0) return reject(new Error(`${name} failed with exit code ${code}`));
      resolve({ name, seconds: (Date.now() - startedAt) / 1000 });
    });
  });
}

async function runWithConcurrency(names, limit) {
  const pending = [...names];
  const completed = [];
  async function worker() {
    while (pending.length) {
      const name = pending.shift();
      completed.push(await runScript(name));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, names.length) }, worker));
  return completed;
}

(async () => {
  const startedAt = Date.now();
  const results = [];
  const [nodeResults, browserResults] = await Promise.all([
    runWithConcurrency(nodeSuites, 4),
    (async () => {
      const completed = [];
      for (const script of browserSuites) completed.push(await runScript(script));
      return completed;
    })(),
  ]);
  results.push(...nodeResults, ...browserResults);
  for (const script of releaseSuites) results.push(await runScript(script));
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const slowest = [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 5)
    .map((item) => `${item.name} ${item.seconds.toFixed(1)}s`).join(", ");
  console.log(`\nCineBraid full verification passed: ${results.length} suites in ${elapsedSeconds}s.`);
  console.log(`Slowest suites: ${slowest}.`);
})().catch((error) => {
  console.error(`\nCineBraid full verification failed: ${error.message}`);
  process.exit(1);
});

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

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
  "check:provider-health",
  "check:local-only",
  "check:secret-registry",
  "check:project-paths",
  "check:generation-contract",
  "check:generation-capability",
  "check:generation-policy",
  "check:model-definitions",
  "check:media-hash",
  "check:media-asset-identity",
  "check:media-asset-store",
  "check:asset-lifecycle",
  "check:media-asset-inertness",
  "check:continuity-manifest",
  "check:continuity-observation",
  "check:continuity-comparison",
  "check:continuity-prompt",
  "check:continuity-observe",
  "check:continuity-cache",
  "check:continuity-compare",
  "check:continuity-validation",
  /* Suites check:ci runs that this runner used to omit. Each is a plain Node suite
     with no reason to be excluded; they were simply never added, so `npm run check`
     silently claimed to pass while covering less than CI did. The invariant in
     tests/current-behavior.js now fails if that happens again. */
  "check:continuity-json",
  "check:continuity-workspace",
  "check:version",
  "check:shot-layout",
  "check:settings",
  "check:image-scale",
  "check:multi-aspect",
  "check:launch-blockers",
  "check:browser-exit",
  "check:data-safety",
  "check:project-switch",
];

/* Suites that assert something about the whole machine and therefore cannot share it.

   check:windows-shutdown snapshots every node PID on the box, terminates its own
   server, and asserts that no OTHER node process disappeared - which is exactly the
   orphan-killing defect worth guarding. Run beside three concurrent suites, other
   suites' processes exit inside that window and the assertion fires on them. The
   suite is right and the placement was wrong, so it runs on its own rather than
   having its assertion weakened. */
const serialSuites = ["check:windows-shutdown"];

const browserSuites = ["check:manual-browser", "check:browser-real", "check:h3-browser", "check:preview-layout", "check:ui-state"];
const releaseSuites = ["check:environment", "check:package"];
/* How a suite is launched, without a shell.

   This used to spawn "npm.cmd" directly. Node's hardening for CVE-2024-27980
   refuses to spawn a .cmd or .bat without a shell, so on current Node for Windows
   every spawn threw EINVAL — and because each suite prints its banner BEFORE
   spawning, the output looked like a failure partway through when in fact nothing
   ran at all.

   npm tells a script it launched exactly where its own CLI lives, and that CLI is a
   plain .js file. Running it with this same Node binary is a real executable with a
   plain file argument: no shell, no quoting rules, and one call that behaves
   identically on Windows and POSIX. */
function resolveNpmLauncher() {
  const fromNpm = process.env.npm_execpath;
  if (fromNpm && fromNpm.endsWith(".js") && fs.existsSync(fromNpm))
    return { command: process.execPath, prefix: [fromNpm], shell: false, how: "npm_execpath" };
  /* Running this file directly (node tests/run-full-check.js) leaves npm_execpath
     unset. npm ships beside the Node binary on Windows and on most POSIX installs. */
  const beside = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(beside))
    return { command: process.execPath, prefix: [beside], shell: false, how: "beside-node" };
  /* Last resort. Only the literal suite names declared above are ever placed on this
     command line, so nothing untrusted is interpolated into a shell. */
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    prefix: [],
    shell: process.platform === "win32",
    how: "npm-on-path",
  };
}
const launcher = resolveNpmLauncher();

function runScript(name) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    console.log(`\n=== ${name} ===`);
    const child = spawn(launcher.command, [...launcher.prefix, "run", name], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
      shell: launcher.shell,
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
  for (const script of serialSuites) results.push(await runScript(script));
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

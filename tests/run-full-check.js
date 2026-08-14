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
  "check:coverage-requirement",
  "check:coverage-requirement-negative",
  "check:state-binding",
  "check:state-binding-negative",
  "check:frame-preflight",
  "check:frame-preflight-negative",
  "check:state-authority",
  "check:state-authority-negative",
  "check:alpha-loop",
  "check:alpha-loop-negative",
  "check:safety",
  "check:focused",
  "check:reference-ux",
  "check:reference-repair",
  "check:reference-loop",
  "check:state-chain-recovery",
  "check:reference-authority",
  "check:reference-contract",
  "check:candidate-review",
  "check:candidate-review-negative",
  "check:reference-aspect",
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
  "check:openai-dialect",
  "check:provider-health",
  "check:local-only",
  "check:lan-passcodes",
  "check:secret-registry",
  "check:project-paths",
  "check:generation-contract",
  "check:generation-capability",
  "check:generation-policy",
  "check:model-definitions",
  "check:generation-plan",
  "check:generation-negative",
  "check:h3-execution",
  "check:h3-execution-negative",
  "check:generation-unresolved",
  "check:generation-unresolved-negative",
  "check:model-intelligence",
  "check:model-intelligence-negative",
  "check:gpt-image-2",
  "check:image-execution",
  "check:generation-options",
  "check:generation-options-negative",
  "check:generation-defaults",
  "check:generation-defaults-negative",
  "check:generation-cost",
  "check:generation-cost-negative",
  "check:media-hash",
  "check:media-asset-identity",
  "check:media-asset-store",
  "check:asset-lifecycle",
  "check:media-asset-boundary",
  "check:media-asset-backfill",
  "check:media-asset-sync-safety",
  "check:media-asset-no-hydration",
  "check:media-asset-verify",
  "check:media-asset-activation",
  "check:media-asset-activation-negative",
  "check:media-disposition",
  "check:media-disposition-negative",
  "check:shot-media-identity",
  "check:shot-media-identity-negative",
  "check:generation-truth",
  "check:generation-truth-negative",
  "check:state-honesty",
  "check:state-honesty-negative",
  "check:stage-model",
  "check:stage-model-negative",
  "check:workspace-shell",
  "check:workspace-shell-negative",
  "check:creator-state",
  "check:creator-state-negative",
  "check:stage-surfaces",
  "check:stage-surfaces-negative",
  "check:job-media-identity",
  "check:job-media-identity-negative",
  "check:account-contract",
  "check:account-secrets",
  "check:account-provider",
  "check:account-lan",
  "check:config-durability",
  "check:request-boundary",
  "check:backup-ownership",
  "check:state-interleaving",
  "check:save-revision-race",
  "check:save-revision-race-negative",
  "check:generation-job-durability",
  "check:approval-references",
  "check:voice-ownership",
  "check:voice-ownership-negative",
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
  "check:ofp-contract",
  "check:ofp-serialization",
  "check:ofp-invariant",
  "check:ofp-negative",
  "check:ofp-migration",
  "check:ofp-migration-negative",
  "check:ofp-overfit",
  "check:ofp-overfit-negative",
  "check:version",
  "check:shot-layout",
  "check:settings",
  "check:image-scale",
  "check:multi-aspect",
  "check:launch-blockers",
  "check:browser-exit",
  "check:data-safety",
  "check:intent-loss",
  "check:project-switch",
  "check:brand-logo",
];

/* Suites that assert something about the whole machine and therefore cannot share it.

   check:windows-shutdown snapshots every node PID on the box, terminates its own
   server, and asserts that no OTHER node process disappeared - which is exactly the
   orphan-killing defect worth guarding. Run beside three concurrent suites, other
   suites' processes exit inside that window and the assertion fires on them. The
   suite is right and the placement was wrong, so it runs on its own rather than
   having its assertion weakened. */
const serialSuites = ["check:windows-shutdown"];

/* Real-browser suites, run best-effort here: without a browser runtime they skip and
   this runner still passes, so a fresh clone can verify everything portable. The tier
   that refuses to accept a skip is `npm run check:browser-gate`, which every one of
   these also belongs to. See docs/qa/BROWSER_TESTS.md. */
const browserSuites = ["check:manual-browser", "check:browser-real", "check:h3-browser", "check:preview-layout",
  "check:ui-state", "check:c2b-browser", "check:brand-logo-browser", "check:lan-passcode-browser",
  "check:focused-browser", "check:alpha-loop-browser"];
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

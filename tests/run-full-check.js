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
  "check:shot-execution-tier0",
  "check:shot-execution-tier0-negative",
  "check:shot-readiness",
  "check:shot-readiness-negative",
  "check:preview-ux",
  "check:api",
  "check:authority-write-seam",
  "check:authority-server",
  "check:diagnostics",
  "check:activity",
  "check:coverage",
  "check:coverage-requirement",
  "check:coverage-requirement-negative",
  "check:state-binding",
  "check:shot-state-declaration",
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
  /* Production Truth Cleanup V1. Listed beside the candidate-review suites because
     they hold the same class of invariant on three surfaces those two do not reach:
     an approval control may not claim an approval the authority layer denies, an AI
     FLAG may not wear affirmative wording, and an unplanned duration may not be
     stored, printed or totalled as a real zero. */
  "check:production-truth",
  "check:production-truth-negative",
  /* Dogfood Pass #2 P0 trust batch. Listed individually rather than through the
     check:dogfood2-p0 aggregate so a failure names the invariant that broke
     rather than the group that contains it. */
  "check:production-authority",
  "check:frame-presence",
  "check:entity-ownership",
  "check:state-lineage",
  "check:correction-boundary",
  "check:dogfood2-p0-negative",
  /* Batch 1B. The end-to-end boundary suite the acceptance audit required: it
     drives the real paid dispatch route, the real UI setters and the real
     correction runner, and fails on durable false state or on a provider being
     contacted — never on a helper's return value. */
  "check:dogfood2-architecture",
  "check:entity-derivation",
  "check:reference-aspect",
  "check:recovery",
  "check:bounded",
  "check:clarity",
  "check:founder-p0",
  "check:founder-p0-negative",
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
  "check:generation-binding",
  "check:generation-binding-negative",
  "check:generation-unresolved",
  "check:generation-unresolved-negative",
  "check:ingest-reaper",
  "check:ingest-reaper-negative",
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
  /* Local File Affordances V1. Listed beside the MediaAsset activation suites
     because they read the same durable identity from the other side: those prove
     the ledger records which file is which, these prove a filmmaker can reach that
     exact file — and that CineBraid says so plainly when it cannot. */
  "check:local-file",
  "check:local-file-negative",
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
  /* Braidy. Listed beside the rail suite it extends, because a failure in either
     is a failure about the same surface and naming them together is what makes
     "which half broke" readable from the run. */
  "check:braidy",
  "check:braidy-negative",
  /* ComfyUI Foothold V1. Listed individually rather than behind an aggregate so a
     failure names the invariant that broke: the integration suite drives a real
     express app against a real loopback ComfyUI fixture and fails on a result that
     reaches the wrong shot, a stale mapping that dispatches, or a local render that
     records a provider charge — never on a helper's return value. */
  "check:comfy",
  "check:comfy-negative",
  "check:quiet-shell",
  "check:shell-ownership",
  /* A2. Named beside the A1 ownership suite because they guard the same shell
     from opposite directions: that one holds Activity and the Assistant where A1
     put them, this one holds project, application and build identity apart. */
  "check:shell-identity",
  "check:shell-identity-negative",
  "check:creator-surface-optin",
  /* The A1 boundary suites. They were registered in package.json and reachable by name,
     which is not the same as being run: a suite nobody runs is a suite that goes red
     unnoticed. tests/terminal-visual-corrections.js requires all four of these to appear
     here, so a future removal is a failure rather than a silence. */
  "check:terminal-visual",
  "check:terminal-visual-negative",
  "check:project-entry",
  "check:project-entry-negative",
  "check:reference-reframe",
  "check:reference-reframe-negative",
  "check:simple-advanced",
  "check:simple-advanced-negative",
  "check:shot-route",
  "check:shot-route-negative",
  "check:shot-intent",
  "check:shot-intent-negative",
  "check:action-projection",
  "check:action-projection-negative",
  /* AT1. Listed beside the readiness/action projection suites because they
     govern the same surface from the other side: those two hold that one
     projection answers "what needs me now", and these two hold that a control
     offering to act on that answer can actually perform it — or says truthfully
     that it is travelling to where it can be performed. The negative-controls
     file also carries this repository's first RETIREMENT assertions, which fail
     if a superseded owner comes back rather than merely proving the new one
     works. */
  "check:action-truth",
  "check:action-truth-negative",
  "check:at1-boundary",
  "check:at1-boundary-negative",
  /* The post-AT1 authority slice: AT1-E/B3 on the shot side. Listed immediately after
     the AT1 suites because it holds the same invariant on the other removal path — a
     target that can hold authority is not removed until every current receipt it would
     invalidate has actually been withdrawn — and its negative controls restore the
     drift hole that shipped. */
  "check:shot-canon-removal",
  "check:shot-canon-removal-negative",
  "check:stage-surfaces",
  "check:stage-surfaces-negative",
  "check:production-media",
  "check:production-media-negative",
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
  "check:save-truth",
  "check:load-transaction",
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
  "check:workspace-migration",
  "check:workspace-migration-negative",
  "check:untrusted-import",
  "check:untrusted-import-negative",
  "check:recovery-quarantine",
  "check:recovery-quarantine-negative",
  "check:brand-logo",
  "check:bible-canon",
  "check:bible-canon-negative",
  "check:returned-review",
  "check:returned-review-negative",
  "check:launch-language",
  "check:launch-language-negative",
  "check:reference-demand",
  "check:reference-demand-negative",
  "check:dogfood-truth",
  "check:dogfood-truth-negative",
  "check:shot-intent-compiler",
  "check:shot-intent-compiler-negative",
  "check:shot-intent-front",
  "check:shot-intent-front-negative",
  "check:reference-convergence",
  "check:reference-convergence-negative",
  "check:paid-request-truth",
  "check:paid-request-truth-negative",
  "check:sheet-gate",
  "check:sheet-gate-negative",
  "check:secrets",
  "check:public-exposure",
  "check:public-exposure-negative",
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
const browserSuites = [
  /* The only browser suite that needs no Playwright: it drives the Chrome already on the
     machine over the DevTools Protocol, so the keyed-reconciliation proofs — which are
     about DOM node identity and cannot be made in Node — actually run here. */
  "check:terminal-keyed-browser",
  "check:manual-browser", "check:browser-real", "check:h3-browser", "check:preview-layout",
  "check:ui-state", "check:c2b-browser", "check:brand-logo-browser", "check:lan-passcode-browser",
  "check:focused-browser", "check:alpha-loop-browser", "check:entity-truth-browser",
  "check:shot-readiness-browser", "check:founder-p0-browser", "check:quiet-shell-browser",
  "check:shell-identity-browser",
  "check:project-entry-browser", "check:reference-reframe-browser", "check:simple-advanced-browser",
  "check:shot-intent-browser", "check:authority-browser", "check:shot-canon-removal-browser",
  "check:save-truth-browser",
  "check:bible-canon-browser", "check:returned-review-browser", "check:launch-language-browser",
  "check:reference-demand-browser", "check:shot-intent-front-browser",
  "check:references-alpha-browser"];
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

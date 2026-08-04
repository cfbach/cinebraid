/* Regression check: the browser workflow suite must exit on its own.

   tests/browser-workflow.js completed every assertion and then sat for ten minutes before
   exiting. The cause was the manual-activity retention timer in public/live-activity.js:
   v641FinishManualActivity scheduled a 10-minute setTimeout to remove a finished drawer row,
   discarded the handle, and left it ref'd - so Node's event loop stayed alive long after the
   work was done. The suite is reached through the patched window.fetch in live-activity.js
   during reviewGuidedFrameSequence.

   This check spawns the suite as a child process and asserts it terminates naturally: it is
   never signalled or killed, so a clean exit proves the event loop actually drained and no
   timer, socket or handle was left behind. It deliberately does not call process.exit in the
   child or shorten the retention window - either would hide the leak rather than fix it. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SUITE = path.join(ROOT, "browser-workflow.js");
/* Generous next to a ~2s run, but far below the 10-minute retention window, so a
   reintroduced ref'd timer fails here instead of silently passing. */
const EXIT_BUDGET_MS = 60000;

function runSuiteToCompletion() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join("tests", "browser-workflow.js")], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const startedAt = Date.now();
    const budget = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL"); // only reached on failure, so the suite cannot hang this check
    }, EXIT_BUDGET_MS);

    child.on("exit", (code, signal) => {
      clearTimeout(budget);
      resolve({ code, signal, timedOut, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
  });
}

async function testBrowserWorkflowExitsNaturally() {
  const result = await runSuiteToCompletion();
  assert(!result.timedOut,
    `browser-workflow.js did not exit within ${EXIT_BUDGET_MS}ms - a lingering handle is keeping the event loop alive`);
  assert.strictEqual(result.signal, null,
    "browser-workflow.js must exit on its own, not by signal or forced termination");
  assert.strictEqual(result.code, 0,
    `browser-workflow.js must exit 0; got ${result.code}\n${result.stderr}`);
  assert(result.stdout.includes("Browser workflow suite passed"),
    "the suite's own assertions must still pass");
  console.log(`  browser-workflow.js exited naturally in ${result.elapsedMs}ms (budget ${EXIT_BUDGET_MS}ms)`);
}

/* Guards the specific regression: the retention timer must stay clearable and unref'd. */
function testRetentionTimerLifecycle() {
  const source = fs.readFileSync(path.join(ROOT, "public", "live-activity.js"), "utf8");
  assert(/V641_MANUAL_RETENTION_TIMERS/.test(source),
    "the manual-activity retention timer must be tracked so it can be cleared and replaced");
  assert(/typeof timer\.unref === "function"/.test(source),
    "the retention timer must be unref'd so it cannot hold a headless process open");
  assert(/function v641ClearManualRetention/.test(source),
    "there must be a way to clear a pending retention timer");
  assert(
    !/setTimeout\(\(\) => \{ V641_MANUAL_ACTIVITIES\.delete\(id\)/.test(source),
    "the original fire-and-forget retention setTimeout must not be reintroduced",
  );
  assert(/const V641_MANUAL_RETENTION_MS = 10 \* 60_000/.test(source),
    "the ten-minute retention window must be preserved, not shortened to mask the leak");
}

async function main() {
  testRetentionTimerLifecycle();
  await testBrowserWorkflowExitsNaturally();
  console.log(
    "Browser workflow exit suite passed: the manual-activity retention timer is tracked, replaceable " +
    "and unref'd, the ten-minute window is unchanged, and browser-workflow.js exits naturally with its " +
    "assertions intact.",
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

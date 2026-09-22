/* The Windows CI census: every `check:ci` step runs, and every failure is reported.

   `npm run check:ci` is an `&&` chain, so the first red step ends the run and every
   step behind it reports nothing - not a pass, not a failure, nothing. One inherited
   red therefore hides every later regression, and each fix costs another workflow
   attempt to discover the next one.

   This runner does not keep its own list. It reads the `check:ci` chain from
   package.json, refuses it unless it is exactly `npm run <script>` joined by ` && `
   (so nothing in the chain can mean something this runner does not execute), and runs
   the same steps in the same order, each as its own `npm run <script>` from the
   package root - the same process and working directory the chain gives it. The chain
   stays the one authoritative list and remains runnable on its own.

   What changes is only what happens after a red step:

     - an ordinary nonzero exit is recorded, and the next step runs;
     - a step that cannot be LAUNCHED at all stops the census, because a runner that
       cannot start a process says nothing trustworthy about the steps after it;
     - an interruption (Ctrl+C, SIGTERM, a cancelled job) terminates the running
       step's whole process tree and starts nothing further.

   Each step's output streams straight through. After the last step a census lists
   every step's result and duration, then every failed step, and the exit code is
   0 only when every step passed. Exit codes: 0 all passed, 1 one or more steps
   failed, 2 the census could not run or could not finish (refused plan, launch
   failure), 128+N interrupted by signal N.

   Aggregate steps (check:generation-core and its kind) are run exactly as declared,
   which means a red leaf inside one still ends THAT aggregate's own `&&` chain. The
   census reports the aggregate as failed; it does not claim to know about the
   leaves the aggregate never reached.

   Usage: node tests/run-ci-census.js [--script check:ci] [--package <dir>] [--report <file.json>]
   --report writes the per-step results and durations as JSON (evidence for later
   sharding work); nothing is written unless it is asked for. */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STEP = /^npm run ([A-Za-z0-9][A-Za-z0-9:_.-]*)$/;
const SEPARATOR = " && ";
const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", ...(process.platform === "win32" ? ["SIGBREAK"] : [])];
const DEFAULT_GRACE_MS = 5000;

/* Turn a declared chain into the steps it runs, or refuse it. Refusal is the point:
   anything other than `npm run <script>` steps joined by ` && ` - a `||`, a `;`, a
   bare `node ...`, a doubled separator - would make this runner execute something
   different from what the chain declares, so the census does not guess. */
function planFromScripts(scripts, scriptName) {
  const command = scripts && scripts[scriptName];
  if (typeof command !== "string" || !command.trim())
    throw new Error(`package.json declares no "${scriptName}" script to run`);
  const segments = command.split(SEPARATOR);
  const steps = segments.map((segment, index) => {
    const match = STEP.exec(segment);
    if (!match)
      throw new Error(`"${scriptName}" step ${index + 1} is not a plain \`npm run <script>\`: ${JSON.stringify(segment)}`);
    if (typeof scripts[match[1]] !== "string")
      throw new Error(`"${scriptName}" step ${index + 1} names "${match[1]}", which is not a package.json script`);
    return { index: index + 1, name: match[1] };
  });
  if (steps.map((step) => `npm run ${step.name}`).join(SEPARATOR) !== command)
    throw new Error(`"${scriptName}" does not round-trip through the census plan, so the census would not run what it declares`);
  return steps;
}

function readPlan(packageDir, scriptName) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
  return planFromScripts(manifest.scripts, scriptName);
}

/* Same launcher as tests/run-full-check.js, for the same reason: since CVE-2024-27980
   Node refuses to spawn npm.cmd without a shell, and npm hands the scripts it launches
   the path of its own .js CLI, which this Node binary runs directly on every platform. */
function resolveNpmLauncher() {
  const fromNpm = process.env.npm_execpath;
  if (fromNpm && fromNpm.endsWith(".js") && fs.existsSync(fromNpm))
    return { command: process.execPath, prefix: [fromNpm], shell: false, how: "npm_execpath" };
  const beside = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(beside))
    return { command: process.execPath, prefix: [beside], shell: false, how: "beside-node" };
  /* Only script names that passed the plan's pattern are ever placed on this line. */
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    prefix: [],
    shell: process.platform === "win32",
    how: "npm-on-path",
  };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/* Terminate a step and everything it started. On POSIX the step leads its own process
   group, so the signal reaches the npm process, the script's shell and the suite
   together. Windows has no process groups to signal and Node's kill() there ends only
   the one process, so the whole tree is ended by parent id with taskkill. */
function terminateTree(child, signal) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } }
}

function formatSeconds(seconds) {
  return seconds === null ? "-" : seconds.toFixed(1);
}

function describeStep(step) {
  if (step.status === "failed") return step.signal ? `terminated by ${step.signal}` : `exit code ${step.exitCode}`;
  if (step.status === "infrastructure") return `could not launch: ${step.detail}`;
  if (step.status === "interrupted") return `interrupted by ${step.detail}`;
  return step.status;
}

function printCensus(result, log) {
  const label = { passed: "PASS", failed: "FAIL", infrastructure: "INFRA", interrupted: "STOP", "not-run": "----" };
  const width = String(result.steps.length).length;
  log(`\n=== CI census: ${result.script} (${result.steps.length} declared steps) ===`);
  for (const step of result.steps)
    log(`  ${String(step.index).padStart(width)}  ${label[step.status].padEnd(5)} ${formatSeconds(step.seconds).padStart(7)}s  ${step.name}`);
  const count = (status) => result.steps.filter((step) => step.status === status).length;
  const failed = result.steps.filter((step) => step.status === "failed");
  const summary = `${count("passed")} passed, ${failed.length} failed, ${count("not-run")} not run, in ${result.totalSeconds.toFixed(1)}s`;
  if (result.outcome === "passed") {
    log(`\nCI census passed: all ${result.steps.length} steps passed in ${result.totalSeconds.toFixed(1)}s.`);
    return;
  }
  if (failed.length) {
    log(`\nFailed steps (${failed.length}):`);
    for (const step of failed) log(`  #${step.index} ${step.name} - ${describeStep(step)}, ${formatSeconds(step.seconds)}s`);
  }
  const stopped = result.steps.find((step) => step.status === "infrastructure" || step.status === "interrupted");
  if (result.outcome === "infrastructure")
    log(`\nCI census STOPPED ON AN INFRASTRUCTURE FAILURE at #${stopped.index} ${stopped.name} (${describeStep(stopped)}). `
      + `Steps after it were not run, so this is not a complete census: ${summary}.`);
  else if (result.outcome === "interrupted")
    log(`\nCI census INTERRUPTED by ${result.interruptedBy}${stopped ? ` during #${stopped.index} ${stopped.name}` : ""}. `
      + `Steps after it were not run, so this is not a complete census: ${summary}.`);
  else
    log(`\nCI census FAILED: ${summary}.`);
}

function exitCodeFor(result) {
  if (result.outcome === "passed") return 0;
  if (result.outcome === "failed") return 1;
  if (result.outcome === "interrupted") return 128 + (os.constants.signals[result.interruptedBy] || 2);
  return 2;
}

/* Run every planned step and resolve with the census. Never rejects for a red step;
   the only way out early is a launch failure or an interruption, both of which are
   recorded rather than thrown. */
async function runCensus({
  steps,
  script = "check:ci",
  cwd = ROOT,
  launcher = resolveNpmLauncher(),
  graceMs = DEFAULT_GRACE_MS,
  env = process.env,
  log = (line) => console.log(line),
}) {
  const startedAt = Date.now();
  const results = steps.map((step) => ({ ...step, status: "not-run", exitCode: null, signal: null, seconds: null, detail: null }));
  let current = null;
  let interruptedBy = null;
  let escalation = null;

  const onSignal = (signal) => {
    if (interruptedBy) {
      /* A second request means now. */
      if (current) terminateTree(current, "SIGKILL");
      return;
    }
    interruptedBy = signal;
    log(`\nCI census received ${signal}; ending the running step and starting no others.`);
    if (!current) return;
    if (process.platform !== "win32") terminateTree(current, signal);
    /* On Windows a console Ctrl+C already reached the step; give it the grace period to
       clean up, then end the whole tree. On POSIX this is the SIGKILL backstop. */
    const running = current;
    escalation = setTimeout(() => terminateTree(running, "SIGKILL"), graceMs);
  };
  for (const signal of INTERRUPT_SIGNALS) process.on(signal, onSignal);

  let outcome = "passed";
  try {
    for (const step of results) {
      if (interruptedBy) break;
      log(`\n=== [${step.index}/${results.length}] ${step.name} ===`);
      const stepStartedAt = Date.now();
      const settled = await new Promise((resolve) => {
        let done = false;
        const finish = (value) => { if (!done) { done = true; resolve(value); } };
        let child;
        try {
          child = spawn(launcher.command, [...launcher.prefix, "run", step.name], {
            cwd,
            env,
            stdio: "inherit",
            windowsHide: true,
            shell: launcher.shell,
            detached: process.platform !== "win32",
          });
        } catch (error) {
          finish({ launchError: error });
          return;
        }
        current = child;
        child.on("error", (error) => finish({ launchError: error }));
        child.on("exit", (code, signal) => finish({ code, signal }));
      });
      current = null;
      if (escalation) { clearTimeout(escalation); escalation = null; }
      step.seconds = (Date.now() - stepStartedAt) / 1000;
      if (settled.launchError) {
        step.status = "infrastructure";
        step.detail = settled.launchError.code || settled.launchError.message;
        outcome = "infrastructure";
        break;
      }
      step.exitCode = settled.code;
      step.signal = settled.signal;
      if (interruptedBy) {
        step.status = "interrupted";
        step.detail = interruptedBy;
        break;
      }
      step.status = settled.code === 0 && !settled.signal ? "passed" : "failed";
      if (step.status === "failed") log(`\n--- ${step.name} failed (${describeStep(step)}); continuing the census ---`);
    }
  } finally {
    for (const signal of INTERRUPT_SIGNALS) process.removeListener(signal, onSignal);
    if (escalation) clearTimeout(escalation);
  }

  if (interruptedBy && outcome !== "infrastructure") outcome = "interrupted";
  else if (outcome === "passed" && results.some((step) => step.status !== "passed")) outcome = "failed";
  const result = {
    script,
    package: cwd,
    launcher: launcher.how || null,
    platform: process.platform,
    node: process.version,
    startedAt: new Date(startedAt).toISOString(),
    totalSeconds: (Date.now() - startedAt) / 1000,
    outcome,
    interruptedBy,
    steps: results,
  };
  printCensus(result, log);
  return result;
}

function parseArgs(argv) {
  const options = { script: "check:ci", packageDir: ROOT, report: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--script", "--package", "--report"].includes(flag) || value === undefined)
      throw new Error(`unknown or incomplete argument: ${flag}`);
    if (flag === "--script") options.script = value;
    if (flag === "--package") options.packageDir = path.resolve(value);
    if (flag === "--report") options.report = path.resolve(value);
    index += 1;
  }
  return options;
}

async function main() {
  let options;
  let steps;
  try {
    options = parseArgs(process.argv.slice(2));
    steps = readPlan(options.packageDir, options.script);
  } catch (error) {
    console.error(`CI census refused to start: ${error.message}`);
    return 2;
  }
  const result = await runCensus({ steps, script: options.script, cwd: options.packageDir });
  if (options.report) {
    try {
      fs.mkdirSync(path.dirname(options.report), { recursive: true });
      fs.writeFileSync(options.report, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`CI census report written to ${options.report}`);
    } catch (error) {
      console.error(`CI census could not write its report: ${error.message}`);
      return Math.max(exitCodeFor(result), 2);
    }
  }
  return exitCodeFor(result);
}

module.exports = { planFromScripts, readPlan, resolveNpmLauncher, runCensus, exitCodeFor, parseArgs };

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(`CI census failed unexpectedly: ${error.stack || error.message}`);
    process.exitCode = 2;
  });
}

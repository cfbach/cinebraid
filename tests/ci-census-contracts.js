/* Contracts for tests/run-ci-census.js, the runner Windows CI uses for `check:ci`.

   The census exists so one workflow attempt reports every red `check:ci` step instead
   of the first. These contracts drive the real runner - real `npm run`, real child
   processes, real exit codes - against a throwaway package in the OS temp area whose
   path contains spaces, and hold that:

     1. early, middle and late failures are all reported in the same run, and the
        run exits nonzero only AFTER the census;
     2. a green run stays green and exits zero;
     3. every declared step runs exactly once per declaration, in declared order -
        nothing skipped, nothing added, a declared duplicate kept as declared;
     4. arguments with spaces and shell metacharacters reach the suite intact
        through npm's own shell on Windows and on POSIX;
     5. a chain the census cannot represent exactly is refused before anything runs;
     6. a step that cannot be launched stops the census, exit 2, nothing after it run;
     7. an interruption ends the running step's whole process tree, starts nothing
        further and exits 128+signal;
     8. the real `check:ci` chain is the census plan, step for step, and the Windows
        workflow runs the census while the history-range scan runs in a job of its
        own that a red census cannot skip.

   Nothing is written inside this repository. */

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CENSUS = path.join(__dirname, "run-ci-census.js");
const SPACED_ARG = "spaced name & ampersand";

/* ---- the fixture package ------------------------------------------------- */

const RUNNER_SOURCE = `const fs = require("fs");
const { spawn } = require("child_process");
const [name, code, mode] = process.argv.slice(2);
const mark = (extra) => fs.appendFileSync(process.env.CENSUS_MARKS, JSON.stringify({ name, pid: process.pid, ...extra }) + "\\n");
console.log("SUITE-OUTPUT " + name);
if (mode === "hang") {
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  mark({ grandchild: grandchild.pid });
  setInterval(() => {}, 1000);
} else {
  mark({});
  process.exit(Number(code));
}
`;

function suite(name, code, mode) {
  return `node "suite runner.js" ${/\s/.test(name) ? `"${name}"` : name} ${code}${mode ? ` ${mode}` : ""}`;
}
const chain = (...names) => names.map((name) => `npm run ${name}`).join(" && ");

function buildFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid ci census "));
  const dir = path.join(base, "package with spaces");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "suite runner.js"), RUNNER_SOURCE);
  const scripts = {
    "s-a": suite("a", 0),
    "s-b": suite("b", 0),
    "s-c": suite("c", 0),
    "s-spaced": suite(SPACED_ARG, 0),
    "s-fail-early": suite("fail-early", 1),
    "s-fail-mid": suite("fail-mid", 3),
    "s-fail-late": suite("fail-late", 7),
    "s-hang": suite("hang", 0, "hang"),
    "ci-green": chain("s-a", "s-spaced", "s-b", "s-c"),
    "ci-mixed": chain("s-fail-early", "s-a", "s-spaced", "s-fail-mid", "s-a", "s-b", "s-fail-late"),
    "ci-infra": chain("s-a", "s-b", "s-c", "s-spaced"),
    "ci-hang": chain("s-a", "s-hang", "s-b"),
    "ci-or": "npm run s-a || npm run s-b",
    "ci-semicolon": "npm run s-a; npm run s-b",
    "ci-bare-node": `npm run s-a && ${suite("b", 0)}`,
    "ci-unknown": chain("s-a", "s-missing"),
    "ci-doubled-space": "npm run s-a &&  npm run s-b",
    "ci-trailing": "npm run s-a && npm run s-b && ",
    "ci-flag": "npm run s-a && npm run --silent s-b",
  };
  fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "ci-census-fixture", version: "1.0.0", private: true, scripts }, null, 2)}\n`);
  return { base, dir, scripts };
}

function marksPath(fixture, label) {
  return path.join(fixture.base, `${label}.marks.jsonl`);
}
function readMarks(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(what, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

function runCli(fixture, script, label, censusPath = CENSUS) {
  const marks = marksPath(fixture, label);
  const report = path.join(fixture.base, `${label}.report.json`);
  const run = spawnSync(process.execPath, [censusPath, "--package", fixture.dir, "--script", script, "--report", report], {
    cwd: fixture.base,
    encoding: "utf8",
    env: { ...process.env, CENSUS_MARKS: marks },
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    marks: readMarks(marks),
    report: fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, "utf8")) : null,
  };
}

/* ---- the contracts ------------------------------------------------------- *
   Each takes the census under test so tests/ci-census-negative-controls.js can hand
   the same contract a deliberately broken runner and watch it fail. */

function contractMixedFailuresAllReported(fixture, censusPath = CENSUS) {
  const run = runCli(fixture, "ci-mixed", `mixed-${path.basename(censusPath)}`, censusPath);
  const declared = ["fail-early", "a", SPACED_ARG, "fail-mid", "a", "b", "fail-late"];
  assert.deepStrictEqual(run.marks.map((mark) => mark.name), declared,
    "every declared step must run exactly once per declaration, in order, including after red steps");
  assert.strictEqual(run.status, 1, `a census with red steps must exit 1, got ${run.status}\n${run.stderr}`);
  assert(run.report, "the census must write the report it was asked for");
  assert.deepStrictEqual(run.report.steps.map((step) => [step.index, step.name, step.status]), [
    [1, "s-fail-early", "failed"], [2, "s-a", "passed"], [3, "s-spaced", "passed"], [4, "s-fail-mid", "failed"],
    [5, "s-a", "passed"], [6, "s-b", "passed"], [7, "s-fail-late", "failed"],
  ]);
  for (const step of run.report.steps) assert(typeof step.seconds === "number" && step.seconds >= 0, `${step.name} must record a duration`);
  const nonzero = run.report.steps.filter((step) => step.status === "failed").map((step) => step.exitCode);
  assert(nonzero.every((code) => Number.isInteger(code) && code !== 0), `failed steps must record their nonzero exit: ${nonzero}`);
  /* Output streams through, and the census comes after all of it. */
  const lastSuiteOutput = run.stdout.lastIndexOf("SUITE-OUTPUT fail-late");
  const failedHeader = run.stdout.indexOf("Failed steps (3):");
  for (const name of declared) assert(run.stdout.includes(`SUITE-OUTPUT ${name}`), `suite output for ${name} must stream through`);
  assert(lastSuiteOutput > 0 && failedHeader > lastSuiteOutput, "the failure census must print after the last step, not instead of it");
  const tail = run.stdout.slice(failedHeader);
  const early = tail.indexOf("#1 s-fail-early");
  const middle = tail.indexOf("#4 s-fail-mid");
  const late = tail.indexOf("#7 s-fail-late");
  assert(early > 0 && middle > early && late > middle, `early, middle and late failures must all be listed in order:\n${tail}`);
  assert(/CI census FAILED: 4 passed, 3 failed, 0 not run/.test(tail), `the census must count every step:\n${tail}`);
}

function contractGreenStaysGreen(fixture, censusPath = CENSUS) {
  const run = runCli(fixture, "ci-green", `green-${path.basename(censusPath)}`, censusPath);
  assert.deepStrictEqual(run.marks.map((mark) => mark.name), ["a", SPACED_ARG, "b", "c"]);
  assert.strictEqual(run.status, 0, `an all-green census must exit 0, got ${run.status}\n${run.stdout.slice(-2000)}`);
  assert.strictEqual(run.report.outcome, "passed");
  assert(run.report.steps.every((step) => step.status === "passed"));
  assert(/CI census passed: all 4 steps passed/.test(run.stdout), "a green census must say so");
  assert(!/Failed steps/.test(run.stdout), "a green census must not print a failure list");
}

function contractRefusesUnrepresentableChains(fixture, censusPath = CENSUS) {
  for (const script of ["ci-or", "ci-semicolon", "ci-bare-node", "ci-unknown", "ci-doubled-space", "ci-trailing", "ci-flag", "ci-absent"]) {
    const run = runCli(fixture, script, `refuse-${script}-${path.basename(censusPath)}`, censusPath);
    assert.strictEqual(run.status, 2, `${script} must be refused with exit 2, got ${run.status}`);
    assert.deepStrictEqual(run.marks, [], `${script} must be refused before anything runs`);
    assert(/CI census refused to start/.test(run.stderr), `${script} must say why it refused:\n${run.stderr}`);
  }
}

async function contractLaunchFailureStops(fixture, census = require(CENSUS)) {
  const real = census.resolveNpmLauncher();
  assert.strictEqual(real.shell, false, "this contract needs the shell-free npm launcher to observe a launch failure");
  const missing = path.join(fixture.base, "no such directory", "node-that-is-not-there.exe");
  let launches = 0;
  const launcher = {
    get command() { launches += 1; return launches <= 2 ? real.command : missing; },
    prefix: real.prefix,
    shell: false,
    how: "contract",
  };
  const marks = marksPath(fixture, `infra-${Date.now()}`);
  const lines = [];
  const result = await census.runCensus({
    steps: census.readPlan(fixture.dir, "ci-infra"),
    script: "ci-infra",
    cwd: fixture.dir,
    launcher,
    env: { ...process.env, CENSUS_MARKS: marks },
    log: (line) => lines.push(line),
  });
  assert.deepStrictEqual(result.steps.map((step) => step.status), ["passed", "passed", "infrastructure", "not-run"],
    "a launch failure must stop the census and leave later steps not run");
  assert.deepStrictEqual(readMarks(marks).map((mark) => mark.name), ["a", "b"], "nothing may run after a launch failure");
  assert.strictEqual(result.outcome, "infrastructure");
  assert.strictEqual(census.exitCodeFor(result), 2, "a launch failure must exit 2, not 1");
  assert(/STOPPED ON AN INFRASTRUCTURE FAILURE at #3 s-c/.test(lines.join("\n")), `the census must name the launch failure:\n${lines.join("\n")}`);
}

async function contractInterruptionEndsTheTree(fixture, census = require(CENSUS)) {
  const marks = marksPath(fixture, `hang-${Date.now()}`);
  const lines = [];
  const before = process.listenerCount("SIGINT");
  const running = census.runCensus({
    steps: census.readPlan(fixture.dir, "ci-hang"),
    script: "ci-hang",
    cwd: fixture.dir,
    graceMs: 300,
    env: { ...process.env, CENSUS_MARKS: marks },
    log: (line) => lines.push(line),
  });
  const hung = await waitFor("the hanging step and its grandchild", () => readMarks(marks).find((mark) => mark.name === "hang"));
  assert(alive(hung.pid) && alive(hung.grandchild), "setup: the hanging suite and its grandchild must be running");
  /* process.emit reaches the census's own handler exactly as a delivered SIGINT does,
     and works identically on Windows, where one process cannot deliver a console
     signal to another. */
  process.emit("SIGINT", "SIGINT");
  try {
    const result = await Promise.race([running, wait(20000).then(() => null)]);
    assert(result, `the census did not finish within 20s of SIGINT: suite ${hung.pid} alive=${alive(hung.pid)}, grandchild ${hung.grandchild} alive=${alive(hung.grandchild)}`);
    assert.deepStrictEqual(result.steps.map((step) => step.status), ["passed", "interrupted", "not-run"]);
    assert.strictEqual(result.outcome, "interrupted");
    assert.strictEqual(census.exitCodeFor(result), 128 + os.constants.signals.SIGINT);
    assert.deepStrictEqual(readMarks(marks).map((mark) => mark.name), ["a", "hang"], "no step may start after an interruption");
    await waitFor("the interrupted step's tree to end", () => !alive(hung.pid) && !alive(hung.grandchild), 10000)
      .catch(() => assert.fail(`the interrupted step's tree survived: suite ${hung.pid} alive=${alive(hung.pid)}, grandchild ${hung.grandchild} alive=${alive(hung.grandchild)}`));
    assert.strictEqual(process.listenerCount("SIGINT"), before, "the census must remove its signal handlers when it returns");
    assert(/INTERRUPTED by SIGINT during #2 s-hang/.test(lines.join("\n")), `the census must report the interruption:\n${lines.join("\n")}`);
  } finally {
    /* Only reached with survivors when the census under test failed to end them. */
    for (const pid of [hung.pid, hung.grandchild]) if (alive(pid)) killTree(pid);
    await Promise.race([running, wait(10000)]);
  }
}

function killTree(pid) {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
}

/* ---- the real chain and the workflow that runs it ------------------------ */

function contractRealCensusIntact({
  census = require(CENSUS),
  workflowText = fs.readFileSync(path.join(ROOT, ".github", "workflows", "windows-ci.yml"), "utf8"),
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const declared = pkg.scripts["check:ci"].split(" && ").map((segment) => segment.replace(/^npm run /, ""));
  const plan = census.readPlan(ROOT, "check:ci");
  assert.deepStrictEqual(plan.map((step) => step.name), declared, "the census plan must be the check:ci chain, step for step");
  assert.deepStrictEqual(plan.map((step) => step.index), declared.map((_, index) => index + 1));
  assert(plan.length > 100, `check:ci must still declare its full suite list, got ${plan.length}`);
  for (const name of ["check:secrets", "check:public-exposure", "check:public-exposure-negative"])
    assert(plan.some((step) => step.name === name), `the census must run ${name}`);
  /* The runner Windows CI depends on is proven by Windows CI itself. */
  for (const name of ["check:ci-census-contracts", "check:ci-census-negative"])
    assert(plan.some((step) => step.name === name), `check:ci must run ${name}`);
  assert.strictEqual(pkg.scripts["check:ci-census"], "node tests/run-ci-census.js",
    "check:ci-census must run the census over the default check:ci chain, with no second list");

  const workflow = workflowText.replace(/\r\n/g, "\n");
  const jobOf = (key) => {
    const start = workflow.indexOf(`\n  ${key}:\n`);
    if (start < 0) return "";
    const next = workflow.slice(start + 1).search(/\n  [a-z][a-z-]*:\n/);
    return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
  };
  const job = jobOf("windows-validation");
  assert(job.indexOf("run: npm run check:ci-census") > 0, "Windows validation must run the census");
  assert(!/run: npm run check:ci\s*$/m.test(job), "Windows validation must not also run the fail-fast chain");
  assert(!/continue-on-error/.test(job), "no Windows validation step may swallow its own failure");

  /* The history-range scan lives in a job of its own, so a red census can never hide
     its answer: jobs run independently unless one needs another. */
  const scan = jobOf("publication-scan");
  assert(/--history-range/.test(scan), "the history-range scan must run in the publication-scan job");
  assert(!/--history-range/.test(job), "the history-range scan must not be a step that a red census can skip");
  assert(!/^\s+needs:/m.test(scan), "the publication scan must not wait on Windows validation; a red census would skip it");
  assert(!/continue-on-error/.test(scan), "the publication scan may not swallow its own failure");
  const scanIf = /\n {4}if: (.+)\n/.exec(scan)?.[1] || "";
  assert(/github\.event_name == 'pull_request'/.test(scanIf), `the scan must still be scoped to pull requests: if: ${scanIf}`);
  assert(!/success\(\)|needs\.|result/.test(scanIf), `the scan's condition must not depend on another job: if: ${scanIf}`);
  assert(/fetch-depth: 0/.test(scan), "the publication scan needs the full history it reads");
}

async function main() {
  contractRealCensusIntact();
  console.log("  real check:ci plan and Windows workflow wiring hold");
  const fixture = buildFixture();
  try {
    contractMixedFailuresAllReported(fixture);
    console.log("  early, middle and late failures reported in one run; exit 1 after the census");
    contractGreenStaysGreen(fixture);
    console.log("  green run stays green; exit 0");
    contractRefusesUnrepresentableChains(fixture);
    console.log("  unrepresentable chains refused before anything runs; exit 2");
    await contractLaunchFailureStops(fixture);
    console.log("  launch failure stops the census; exit 2");
    await contractInterruptionEndsTheTree(fixture);
    console.log("  interruption ends the step's process tree and starts nothing further");
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
  console.log("CI census contracts passed.");
}

module.exports = {
  buildFixture,
  contractMixedFailuresAllReported,
  contractGreenStaysGreen,
  contractRefusesUnrepresentableChains,
  contractLaunchFailureStops,
  contractInterruptionEndsTheTree,
  contractRealCensusIntact,
};

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

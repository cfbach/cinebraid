/* Negative controls for tests/ci-census-contracts.js.

   A contract that passes is only worth something if the same contract can be shown to
   fail when the guarantee it names is broken. Each control below rebuilds the census
   (or the workflow text) with exactly one guarantee removed and requires the matching
   contract to fail with an assertion - not with a setup error, which would prove only
   that the control never reached the thing it meant to test.

   Runner controls are written as mutated copies of tests/run-ci-census.js inside a
   throwaway directory in the OS temp area and run from there; workflow controls mutate
   the workflow text in memory. Nothing in this repository is modified.

   Anchors are matched against LF-normalised source, because a Windows checkout with
   core.autocrlf=true hands this file CRLF text that an LF anchor would never match. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const contracts = require("./ci-census-contracts");

const ROOT = path.resolve(__dirname, "..");
const CENSUS_SOURCE = fs.readFileSync(path.join(__dirname, "run-ci-census.js"), "utf8").replace(/\r\n/g, "\n");
const WORKFLOW_SOURCE = fs.readFileSync(path.join(ROOT, ".github", "workflows", "windows-ci.yml"), "utf8").replace(/\r\n/g, "\n");

function mutate(source, edits, label) {
  let mutated = source;
  for (const [from, to] of edits) {
    const count = mutated.split(from).length - 1;
    if (count !== 1) throw new Error(`SETUP: ${label} anchor matched ${count} times, expected exactly 1: ${JSON.stringify(from.slice(0, 80))}`);
    mutated = mutated.replace(from, () => to);
  }
  return mutated;
}

const RUNNER_CONTROLS = [
  {
    label: "stop at the first red step (the old && behaviour)",
    edits: [[
      `      step.status = settled.code === 0 && !settled.signal ? "passed" : "failed";\n`,
      `      step.status = settled.code === 0 && !settled.signal ? "passed" : "failed";\n      if (step.status === "failed") break;\n`,
    ]],
    contract: "contractMixedFailuresAllReported",
  },
  {
    label: "exit zero although a step failed",
    edits: [[`  if (result.outcome === "failed") return 1;\n`, `  if (result.outcome === "failed") return 0;\n`]],
    contract: "contractMixedFailuresAllReported",
  },
  {
    label: "report a red census as passed",
    edits: [[
      `  else if (outcome === "passed" && results.some((step) => step.status !== "passed")) outcome = "failed";\n`,
      "",
    ]],
    contract: "contractMixedFailuresAllReported",
  },
  {
    label: "collapse a declared duplicate step",
    edits: [[
      `    throw new Error(\`"\${scriptName}" does not round-trip through the census plan, so the census would not run what it declares\`);\n  return steps;\n`,
      `    throw new Error(\`"\${scriptName}" does not round-trip through the census plan, so the census would not run what it declares\`);\n  return steps.filter((step, index, all) => all.findIndex((other) => other.name === step.name) === index);\n`,
    ]],
    contract: "contractMixedFailuresAllReported",
  },
  {
    label: "the same duplicate collapse, seen against the real check:ci chain",
    edits: [[
      `    throw new Error(\`"\${scriptName}" does not round-trip through the census plan, so the census would not run what it declares\`);\n  return steps;\n`,
      `    throw new Error(\`"\${scriptName}" does not round-trip through the census plan, so the census would not run what it declares\`);\n  return steps.filter((step, index, all) => all.findIndex((other) => other.name === step.name) === index);\n`,
    ]],
    contract: "contractRealCensusIntact",
    inProcess: true,
  },
  {
    label: "accept a chain the census cannot represent (||, ;, doubled separators)",
    edits: [
      [`  const segments = command.split(SEPARATOR);\n`, `  const segments = command.split(/\\s*(?:&&|\\|\\||;)\\s*/).filter(Boolean);\n`],
      [`  if (steps.map((step) => \`npm run \${step.name}\`).join(SEPARATOR) !== command)\n`, `  if (false)\n`],
    ],
    contract: "contractRefusesUnrepresentableChains",
  },
  {
    label: "carry on after a step could not be launched",
    edits: [[`        outcome = "infrastructure";\n        break;\n`, `        outcome = "infrastructure";\n        continue;\n`]],
    contract: "contractLaunchFailureStops",
    inProcess: true,
  },
  {
    label: "leave the interrupted step's process tree running",
    edits: [[
      `function terminateTree(child, signal) {\n`,
      `function terminateTree(child, signal) {\n  return;\n`,
    ]],
    contract: "contractInterruptionEndsTheTree",
    inProcess: true,
  },
  {
    label: "start the next step after an interruption",
    edits: [
      [`      if (interruptedBy) break;\n      log(`, `      log(`],
      [`        step.detail = interruptedBy;\n        break;\n`, `        step.detail = interruptedBy;\n        continue;\n`],
    ],
    contract: "contractInterruptionEndsTheTree",
    inProcess: true,
  },
];

const WORKFLOW_CONTROLS = [
  {
    label: "the history-range scan skipped whenever the census is red",
    edits: [[
      `        if: \${{ !cancelled() && steps.checkout.outcome == 'success' && github.event_name == 'pull_request' }}\n`,
      `        if: github.event_name == 'pull_request'\n`,
    ]],
  },
  {
    label: "Windows validation back on the fail-fast chain",
    edits: [[`        run: npm run check:ci-census\n`, `        run: npm run check:ci\n`]],
  },
  {
    label: "the census step allowed to fail without failing the job",
    edits: [[`        run: npm run check:ci-census\n`, `        run: npm run check:ci-census\n        continue-on-error: true\n`]],
  },
];

async function expectDetection(label, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message.split("\n")[0];
    throw new Error(`SETUP: "${label}" failed with a non-assertion error, which is not a detection: ${error.stack || error}`);
  }
  throw new Error(`UNDETECTED: the contract passed with "${label}" broken`);
}

async function main() {
  const fixture = contracts.buildFixture();
  const mutantsDir = path.join(fixture.base, "mutants");
  fs.mkdirSync(mutantsDir);
  let detected = 0;
  try {
    for (const [index, control] of RUNNER_CONTROLS.entries()) {
      const mutantPath = path.join(mutantsDir, `census-mutant-${index + 1}.js`);
      fs.writeFileSync(mutantPath, mutate(CENSUS_SOURCE, control.edits, control.label));
      const contract = contracts[control.contract];
      const message = await expectDetection(control.label, () => (control.contract === "contractRealCensusIntact"
        ? contract({ census: require(mutantPath) })
        : contract(fixture, control.inProcess ? require(mutantPath) : mutantPath)));
      detected += 1;
      console.log(`  detected: ${control.label} -> ${control.contract}: ${message}`);
    }
    for (const control of WORKFLOW_CONTROLS) {
      const workflowText = mutate(WORKFLOW_SOURCE, control.edits, control.label);
      const message = await expectDetection(control.label, () => contracts.contractRealCensusIntact({ workflowText }));
      detected += 1;
      console.log(`  detected: ${control.label} -> contractRealCensusIntact: ${message}`);
    }
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
  assert.strictEqual(detected, RUNNER_CONTROLS.length + WORKFLOW_CONTROLS.length);
  console.log(`CI census negative controls passed: ${detected} of ${detected} broken guarantees detected.`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

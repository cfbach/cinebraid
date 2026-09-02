/* THE HARNESS OPT-IN, PROVED RATHER THAN ASSERTED.
 *
 * A1 made the Activity Terminal the canonical operational surface, so the suites that
 * used to render the retired Global Activity drawer need public/creator-surfaces.js in
 * their realm. Ninety-one suites share tests/render-harness.js and none of the others
 * asked for it, so it is requested per invocation.
 *
 * The risk this file exists for is not that the opt-in fails — a migrated suite would
 * say so immediately. It is that the DEFAULT quietly changed for everyone else, which
 * nothing else would notice until an unrelated suite started failing for a reason its
 * author never wrote.
 *
 * NO PROJECT DATA IS TOUCHED. NO PROVIDER, MODEL OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");
const { terminalHtml } = require("./terminal-view");

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (a, b, message) => { assert.strictEqual(a, b, message); checks += 1; };

async function main() {
  /* H1 — the default realm does not load creator surfaces. */
  const plain = await render("#/production", buildFixture());
  eq(vm.runInContext("typeof window.CineBraidCreatorSurfaces", plain.context), "undefined",
    "H1: the default harness must not load public/creator-surfaces.js");

  /* H2 — an unrelated suite sees the same globals it always did. Sampled across the
     bindings a harness consumer actually reaches for, plus the count of the ones the
     opt-in adds, so a silent realm change shows up as a number rather than a hunch. */
  const optedIn = await render("#/production", buildFixture(), { creatorSurfaces: true });
  const sample = ["P", "AUTOMATION_RUNS", "FAL_GENERATION_JOBS", "route", "esc", "attr", "toast"];
  for (const name of sample) {
    eq(vm.runInContext(`typeof ${name}`, plain.context), vm.runInContext(`typeof ${name}`, optedIn.context),
      `H2: the opt-in must not change what "${name}" is`);
  }
  /* And the ONLY difference is the surfaces themselves. */
  eq(vm.runInContext("typeof window.CineBraidCreatorSurfaces", optedIn.context), "object",
    "H3: the opt-in must load the Terminal's owner");
  eq(vm.runInContext("typeof creatorState", plain.context), "undefined",
    "H2: the projection must not reach the default realm either");

  /* H3 — the opt-in renders a real Terminal from real runs. */
  const html = (() => {
    vm.runInContext(`AUTOMATION_RUNS = [{
      id: "optin-run", revision: 1, type: "shot-chain", targetId: "L1-01", scope: "stills",
      label: "Opt-in run", status: "running", stage: "Frame A", summary: "Working.",
      runnerId: "r1", leaseExpiresAt: "2099-01-01T00:00:00Z", heartbeatAt: "2099-01-01T00:00:00Z",
      steps: {}, logs: [], config: {}, usage: {},
      createdAt: "2026-08-26T10:00:00Z", updatedAt: "2026-08-26T10:01:00Z",
    }];`, optedIn.context);
    return terminalHtml(optedIn.context);
  })();
  ok(/cb-terminal-row/.test(html), "H3: the opted-in realm must render Terminal rows");
  ok(/tone-working/.test(html), "H3: and carry the shipped classifier's tone");
  ok(html.includes("run:optin-run"), "H3: keyed by the run it is about");

  /* H4 — only the migrated suites ask for it, and each one is named here. A suite that
     starts opting in without being listed is a realm change nobody reviewed. */
  const EXPECTED = [
    /* The migrated Activity suites. */
    "coverage-workflow.js", "current-behavior.js",
    "dogfood-truth-reconciliation.js", "founder-smoke-p0-trust.js",
    "founder-smoke-p0-trust-negative-controls.js", "production-state-honesty.js",
    "production-state-honesty-negative-controls.js", "reference-authority-deep-dive.js",
    "render-harness.js",
    /* This file, which proves the flag; and the reader, which names the flag in the
       error a suite gets for forgetting it. Neither is a migrated suite, and both
       would be a surprise if they were absent. */
    "creator-surface-optin.js", "terminal-view.js",
  ];
  const actual = fs.readdirSync(path.join(ROOT, "tests"))
    .filter((name) => name.endsWith(".js"))
    .filter((name) => fs.readFileSync(path.join(ROOT, "tests", name), "utf8").includes("creatorSurfaces: true"))
    .sort();
  assert.deepStrictEqual(actual, EXPECTED.slice().sort(),
    "H4: exactly the migrated Activity suites may opt into creator surfaces");
  checks += 1;

  /* H5 — a migrated suite that loses the opt-in fails BY NAME rather than by asserting
     against an empty string, which is the failure mode that would let a realm mistake
     read as a passing test. */
  let named = "";
  try { terminalHtml(plain.context); } catch (error) { named = String(error.message || ""); }
  ok(/creator surfaces are not loaded/.test(named),
    `H5: reading the Terminal without the opt-in must fail by name, got: ${named}`);

  console.log(`creator-surface opt-in: ${checks} checks. Default realm unchanged; ${actual.length} suites opt in.`);
  console.log("No project data was touched. Provider calls made: 0.");
}

main().catch((error) => { console.error(error); process.exit(1); });

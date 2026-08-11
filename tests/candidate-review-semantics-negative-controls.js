/* Negative controls for UX B2a — candidate review / canon safety.
 *
 * A regression suite that has never failed is a claim, not evidence. Each
 * control below reintroduces exactly ONE of the defects B2a exists to remove and
 * asserts that the real guard — the same function tests/candidate-review-semantics.js
 * runs in the green path, not a restatement of it — FAILS.
 *
 *   NC-A  absent counted as the requested change
 *   NC-B  uncertainty defaulting to a pass
 *   NC-C  a high score forcing a pass over a failed requirement
 *   NC-D  undeclared parent-authority drift ignored
 *   NC-E  attribution read from current Settings instead of the review's own record
 *   NC-F  an AI pass performing the human approval
 *   NC-G  the motion-readiness gate moved after the navigation it protects
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Each defect is
 * introduced by evaluating a MODIFIED COPY of the source in memory.
 *
 * AN EXCEPTION IS NOT PROOF A CONTROL RAN. Every control carries a receipt: the
 * anchor must exist, must be unique, must actually change the source, and the
 * DEFECT ITSELF must be observed through a probe before the guard's failure is
 * allowed to count as detection. Only an AssertionError counts — a syntax error,
 * a module-load failure or an unrelated crash is re-thrown.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const Suite = require("./candidate-review-semantics");

/* Line endings are a checkout detail. This repo checks out CRLF on Windows, so
   a multi-line anchor written with \n would match nothing there and the control
   would report itself stale instead of biting. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const CONTRACT_PATH = path.join(ROOT, "reference-review-contract.js");
const CONTRACT_SOURCE = readLF(CONTRACT_PATH);

const applied = [];
function mutateOnce(source, needle, replacement, label) {
  const text = String(source).replace(/\r\n/g, "\n");
  const occurrences = text.split(needle).length - 1;
  assert.strictEqual(occurrences, 1, `NEGATIVE CONTROL ANCHOR STALE — ${label} matched ${occurrences} times, expected exactly 1`);
  const next = text.replace(needle, replacement);
  assert.notStrictEqual(next, text, `NEGATIVE CONTROL — ${label} changed nothing`);
  applied.push(label);
  return next;
}
/* A modified copy of the contract, compiled in memory. Never on disk, so no
   checkout can be what undoes it. */
function brokenContract(mutate) {
  const mutated = mutate(CONTRACT_SOURCE);
  /* Rooted at the contract so its own relative requires resolve exactly as they
     do in production. A bare `require` here would resolve against tests/ and
     throw MODULE_NOT_FOUND, which `control` would refuse to count anyway — but
     the defect probe would never get to run. */
  const sandbox = { require: Module.createRequire(CONTRACT_PATH), module: { exports: {} }, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(mutated, sandbox, { filename: "reference-review-contract.broken.js" });
  return sandbox.module.exports;
}
/* A source-only patch for the browser scripts, handed to the render harness. */
function mutateScript(fileName, needle, replacement, label) {
  return (file, source) => (file === fileName ? mutateOnce(source, needle, replacement, label) : source);
}

const results = [];
async function control({ id, label, guards, defect, guarded }) {
  const observed = await defect();
  assert(observed === true, `NEGATIVE CONTROL ${id}: the defect probe did not observe the reintroduced defect, so nothing below proves anything`);
  let detected = null;
  try {
    await guarded();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = error;
  }
  assert(detected, `NEGATIVE CONTROL ${id} FAILED: with "${label}" reintroduced, "${guards}" still passed. That test cannot detect the defect it exists for.`);
  results.push({ id, label, guards, outcome: String(detected.message).split("\n")[0].slice(0, 120) });
}

/* The exact shape the audit hit, used by the probes below. */
const absentSeal = () => [
  Suite.observed(Suite.SEAL, "the wax seal", "must-remain", "absent", "not-applicable", "No wax seal anywhere."),
  Suite.FLAP_OPEN(), Suite.ENVELOPE_SAME(),
];
const unreadableSeal = () => [
  Suite.observed(Suite.SEAL, "the wax seal", "must-remain", "present", "uncertain", "The seal region is behind a fold."),
  Suite.FLAP_OPEN(), Suite.ENVELOPE_SAME(),
];
const satisfied = () => [
  Suite.observed(Suite.SEAL, "the wax seal", "must-remain", "present", "as-required", "Cracked in two."),
  Suite.FLAP_OPEN(), Suite.ENVELOPE_SAME(),
];
const judge = (C, records, extra = {}, options = {}) =>
  C.normalizeEntityCandidateReview(Suite.reviewerResponse(records, extra), Suite.validating(options));

async function main() {
  /* ======================================================================
     NC-A — absent counted as the requested change. The defect verbatim. */
  const A_ANCHOR = `  if (base.expectedFeature === "must-remain" && base.observedFeature === "absent")
    return {
      ...base, outcome: "issue",`;
  const A_BROKEN = `  if (base.expectedFeature === "must-remain" && base.observedFeature === "absent")
    return {
      ...base, outcome: "expected",`;
  const brokenA = () => brokenContract((source) => mutateOnce(source, A_ANCHOR, A_BROKEN, "NC-A absent counted as broken"));
  await control({
    id: "NC-A",
    label: "an absent feature counted as satisfying a requirement that changes it",
    guards: "CASE 1 — absence never satisfies a change",
    defect: () => {
      const review = judge(brokenA(), absentSeal());
      /* RECEIPT: the candidate with no seal at all now passes, at 96/100 — which
         is exactly what the audit saw on screen. */
      return review.pass === true && review.score === 96 && review.semanticOutcome === "expected";
    },
    guarded: () => Suite.testAbsenceDoesNotSatisfyAChange(brokenA()),
  });

  /* ======================================================================
     NC-B — uncertainty defaulting to a pass. */
  const brokenB = () => brokenContract((source) => mutateOnce(source,
    '  if (stateEvidence.applies && stateEvidence.unresolvedCount) hardGateFailures.push("declared-state-unresolved");',
    "", "NC-B uncertainty defaults to pass"));
  await control({
    id: "NC-B",
    label: "unreadable evidence defaulting to a pass",
    guards: "CASE 3 — uncertainty stays uncertainty",
    defect: () => {
      const review = judge(brokenB(), unreadableSeal());
      /* RECEIPT: the evidence is still UNCERTAIN and the candidate passes anyway. */
      return review.pass === true && review.semanticOutcome === "uncertain";
    },
    guarded: () => Suite.testUncertaintyStaysUncertain(brokenB()),
  });

  /* ======================================================================
     NC-C — a high score forcing a pass over a failed requirement. This is the
     "just move the threshold" fix the batch was told not to accept. */
  const brokenC = () => brokenContract((source) => mutateOnce(source,
    "  const pass = uniqueFailures.length === 0;",
    "  const pass = uniqueFailures.length === 0 || score >= 95;", "NC-C score 95+ forces pass"));
  await control({
    id: "NC-C",
    label: "a score of 95 or more forcing a pass despite a failed declared requirement",
    guards: "CASE 6 — the score is subordinate to the semantic gates",
    defect: () => {
      const review = judge(brokenC(), absentSeal(), { score: 96 });
      /* RECEIPT: the gate list still names the failure, and pass is true anyway. */
      return review.pass === true && review.hardGateFailures.includes("declared-state-unsatisfied");
    },
    guarded: () => Suite.testScoreCannotOverrideSemantics(brokenC()),
  });

  /* ======================================================================
     NC-D — undeclared parent-authority drift ignored. */
  const brokenD = () => brokenContract((source) => mutateOnce(source,
    "  const rawDrift = comparable && Array.isArray(source?.parentDrift) ? source.parentDrift : [];",
    "  const rawDrift = [];", "NC-D parent drift ignored"));
  const DRIFT = { parentDrift: [{ attribute: "color", parentValue: "red paper", candidateValue: "blue paper", evidence: "The body is blue." }] };
  await control({
    id: "NC-D",
    label: "undeclared drift from the parent authority ignored",
    guards: "CASE 4 — the parent stays authoritative for what the state did not change",
    defect: () => {
      const review = judge(brokenD(), satisfied(), DRIFT);
      /* RECEIPT: a blue envelope where the parent is red now passes cleanly. */
      return review.pass === true && review.stateEvidence.drift.length === 0;
    },
    guarded: () => Suite.testUndeclaredParentDriftBlocks(brokenD()),
  });

  /* ======================================================================
     NC-E — attribution read from current Settings instead of the review's own
     record. The failure this guards is subtle and silent: the screen keeps
     looking right while naming a model that never saw the image. */
  const E_ANCHOR = `function entityReviewReviewerRecord(data) {
  return { provider: String(data?.reviewer?.provider || ""), model: String(data?.reviewer?.model || "") };
}`;
  const E_BROKEN = `function entityReviewReviewerRecord(data) {
  return { provider: String(data?.reviewer?.provider || ""), model: String(data?.reviewer?.model || "") };
}
function entityReviewConfiguredVisionModel() {
  return String(CONFIG.ollamaVisionModel || CONFIG.openaiVisionModel || CONFIG.customVisionModel || "");
}`;
  /* Two edits: a helper that reads live configuration, and the renderer falling
     back to it when the record carries nothing. */
  const E_RENDER_ANCHOR = `  const provider = String(review.reviewer?.provider || "");
  const model = String(review.reviewer?.model || "");`;
  const E_RENDER_BROKEN = `  const provider = String(review.reviewer?.provider || CONFIG.assistant?.provider || "");
  const model = String(review.reviewer?.model || entityReviewConfiguredVisionModel() || "");`;
  const brokenReviewSource = () => {
    const first = mutateScript("review.js", E_ANCHOR, E_BROKEN, "NC-E live-settings attribution helper");
    return (file, source) => file !== "review.js"
      ? source
      : mutateOnce(first(file, source), E_RENDER_ANCHOR, E_RENDER_BROKEN, "NC-E attribution falls back to current settings");
  };
  await control({
    id: "NC-E",
    label: "candidate-review model attribution read from the current configured model",
    guards: "CASE 8 — attribution comes from what actually served the review",
    defect: async () => {
      const project = Suite.uiFixture({ reviewer: { provider: "", model: "" } });
      const { rendered } = await Suite.openModal(project, [], brokenReviewSource());
      const markup = vm.runInContext(
        `(() => { CONFIG.assistant = { provider: "ollama", visionProvider: "same" }; CONFIG.ollamaVisionModel = "settings-model-changed-since"; `
        + `return entityReviewModalMarkup("props", P.props[0], { name: "PROP-ENVELOPE-CANDIDATE.png", url: "/x.png" }, entityStateById(P.props[0], "state-opened"), `
        + `P.props[0].candidateFiles[0].structuredReviews["state-opened"]); })()`,
        rendered.context,
      );
      /* RECEIPT: a review that recorded no reviewer is now labelled with the
         model the settings happen to name today. */
      return markup.includes("settings-model-changed-since");
    },
    guarded: () => Suite.uiSection(brokenReviewSource()),
  });

  /* ======================================================================
     NC-F — an AI pass performing the human approval. */
  const F_ANCHOR = `  const review = entityCandidateReviewIsCurrent(rawReview) ? rawReview : null;
  openModal(entityReviewModalMarkup(list, entity, media, state, review));`;
  const F_BROKEN = `  const review = entityCandidateReviewIsCurrent(rawReview) ? rawReview : null;
  if (review?.pass) { state.approvedFile = fileName; if (row) row.decision = "approved-reference"; }
  openModal(entityReviewModalMarkup(list, entity, media, state, review));`;
  const brokenApproval = () => mutateScript("review.js", F_ANCHOR, F_BROKEN, "NC-F an AI pass approves");
  await control({
    id: "NC-F",
    label: "an AI pass performing the human approval by itself",
    guards: "CASE 7 — approval is a human act",
    defect: async () => {
      const project = Suite.uiFixture({ records: satisfied() });
      const { rendered } = await Suite.openModal(project, [], brokenApproval());
      const state = vm.runInContext(
        `(() => { const e = P.props[0]; return { approved: e.continuityStates.find(x => x.id === "state-opened").approvedFile, decision: e.candidateFiles[0].decision }; })()`,
        rendered.context,
      );
      /* RECEIPT: merely opening the review canonised the candidate. */
      return state.approved === "PROP-ENVELOPE-CANDIDATE.png" && state.decision === "approved-reference";
    },
    guarded: () => Suite.humanAuthoritySection(brokenApproval()),
  });

  /* ======================================================================
     NC-G — the motion-readiness gate moved after the navigation it protects.
     Deliberately NOT a source-string control: the probe and the guard both DRIVE
     the real navigation and watch whether the motion panel opened. */
  const G_ANCHOR = `  if (approvedCount >= 2 && !sequenceReview?.pass) return toast(sequenceReview ? "Correct the frame-sequence continuity issues before creating motion" : "Run the frame-sequence continuity review before creating motion");
  const c = ensureShotCreation(s), suggested = suggestedMotionProfileForApprovedFrames(s, approvedCount);
  if (suggested) c.motionProfileId = suggested;
  c.deliveryIntent = "motion";`;
  const G_BROKEN = `  const c = ensureShotCreation(s), suggested = suggestedMotionProfileForApprovedFrames(s, approvedCount);
  if (suggested) c.motionProfileId = suggested;
  c.deliveryIntent = "motion";
  if (approvedCount >= 2 && !sequenceReview?.pass) return toast(sequenceReview ? "Correct the frame-sequence continuity issues before creating motion" : "Run the frame-sequence continuity review before creating motion");`;
  const brokenGate = () => mutateScript("creation-studio.js", G_ANCHOR, G_BROKEN, "NC-G motion gate moved after the navigation");
  await control({
    id: "NC-G",
    label: "the motion-readiness gate running after the navigation it protects",
    guards: "the readiness gate refuses before the motion panel opens (behaviour, not source order)",
    defect: async () => {
      const result = await Suite.motionGateBehaviour(brokenGate());
      /* RECEIPT: two approved anchors, no passing readiness review, and the
         motion panel opened anyway — a paid submit is now reachable ahead of the
         gate's decision. */
      return result.approvedCount >= 2 && result.reviewPassed === false && result.navigated === true;
    },
    guarded: () => Suite.testMotionGateStillRefuses(brokenGate()),
  });

  /* Every control must have actually bitten. A control whose anchor silently
     stopped matching would otherwise report green for a guarantee it no longer
     guards. */
  const expected = [
    "NC-A absent counted as broken",
    "NC-B uncertainty defaults to pass",
    "NC-C score 95+ forces pass",
    "NC-D parent drift ignored",
    "NC-E live-settings attribution helper",
    "NC-E attribution falls back to current settings",
    "NC-F an AI pass approves",
    "NC-G motion gate moved after the navigation",
  ];
  for (const label of expected) assert(applied.includes(label), `NEGATIVE CONTROL NEVER RAN — ${label}`);

  /* And the real modules are still intact afterwards: nothing was written. */
  assert.strictEqual(readLF(CONTRACT_PATH), CONTRACT_SOURCE, "the contract on disk must be untouched");

  console.log(`UX B2a negative controls passed: ${results.length} deliberate defects reintroduced in memory — every one detected by the guard that exists for it, `
    + "every one with a live-defect receipt, and the real modules untouched on disk.");
  for (const row of results) console.log(`  - ${row.id} ${row.label} -> caught by "${row.guards}" (${row.outcome})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

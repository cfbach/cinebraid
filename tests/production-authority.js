/* HUMAN-ONLY PRODUCTION AUTHORITY, and the reconciliation of the gates it
 * creates. Dogfood Pass #2 A1/A2, forensic audit F1/F2.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: no automated review, at any
 * score, on any path, may establish production authority — and a gate waiting
 * for a human decision stops being actionable the moment that decision exists.
 *
 * WHY THE TWO LIVE IN ONE SUITE. They are one invariant read from two ends.
 * Reconciliation asks "has the authority this gate is waiting for been
 * established?", and that question is only answerable because the first half
 * guarantees that only a human could have established it. Split them and the
 * reconciliation test would silently start passing for the wrong reason the day
 * automation could write a winner again.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation; the
 * only functions called are the authority guard, the recommendation record and
 * the gate resolver, all of which are pure.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const Authority = require("../public/shared-production-authority");
const P4 = require("../public/shared-production-media");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

/* ===========================================================================
   1. THE GRANT. What counts as an explicit human approval command.

   A truthy object is not a grant. That is the whole point: every machine call
   site in automation.js passed NOTHING, and a guard that accepted anything
   truthy would have accepted `{}` from the first refactor that added one. */

ok(Authority.isHumanAuthorityGrant(Authority.humanAuthorityGrant({ via: "test" })), "a minted grant is a grant");
ok(!Authority.isHumanAuthorityGrant(undefined), "an omitted argument is not a grant");
ok(!Authority.isHumanAuthorityGrant({}), "an empty object is not a grant");
ok(!Authority.isHumanAuthorityGrant(true), "a boolean is not a grant");
ok(!Authority.isHumanAuthorityGrant({ actor: "human" }), "an actor without an act is not a grant");
ok(!Authority.isHumanAuthorityGrant({ act: "explicit-approval" }), "an act without an actor is not a grant");
ok(!Authority.isHumanAuthorityGrant({ actor: "automation", act: "explicit-approval" }), "automation may not claim the human act");
ok(!Authority.isHumanAuthorityGrant({ actor: "human", act: "auto-approve" }), "a different act is not the approval act");

assert.throws(
  () => Authority.assertHumanAuthority(undefined, "Frame A of SH-01"),
  (error) => error.code === "HUMAN_AUTHORITY_REQUIRED" && error.authorityViolation === true,
  "the guard must throw a recognisable authority error, not a generic one",
);
checks++;
/* Recognisable so a runner cannot mistake it for a transient provider fault and
   retry it. v626FailureClass reads exactly these two fields. */
ok(/only an explicit human approval command/i.test(Authority.productionAuthorityError("x").message),
  "the refusal names the rule rather than saying 'invalid argument'");

/* ===========================================================================
   2. THE NOMINATION. What a strong automated pass is allowed to produce. */

const recommendation = Authority.automationRecommendation({
  file: "SH01_FRAME_A_003.png", score: 92, threshold: 85, rationale: "Strongest identity match.",
  runId: "automation-x", stepKey: "frame:fr-a:round-1:review", at: "2026-08-14T00:00:00.000Z",
});
ok(Authority.isAutomationRecommendation(recommendation), "the record identifies itself as a recommendation");
eq(recommendation.decision, "ai-recommendation", "and it says so in a field, so no reader has to infer it");
ok(recommendation.requiresHumanApproval === true, "and it states that a human decision is still required");
ok(!("winner" in recommendation), "a recommendation must not carry a `winner` — that is the authority field's name");
ok(!("approvedAt" in recommendation), "nor an approval timestamp");
ok(!("humanApproved" in recommendation), "nor the mark of a human act");
eq(recommendation.score, 92, "the score is preserved — nothing about the reviewer's work is discarded");
eq(recommendation.threshold, 85, "and so is the threshold it was measured against");

ok(!Authority.isAutomationRecommendation({ decision: "ai-recommendation" }), "a half-written record is not a recommendation");
eq(Authority.readAutomationRecommendation({ automationRecommendation: { decision: "approved" } }), null,
  "and a field holding something else reads as nothing rather than as a decision");
eq(Authority.readAutomationRecommendation({ [Authority.AUTOMATION_RECOMMENDATION_FIELD]: recommendation }), recommendation,
  "a frame's stored recommendation reads back");

/* ===========================================================================
   3. THE SOURCE, on the paths the forensic audit named.

   These are source assertions rather than behavioural ones because the defect
   was a BRANCH: `if (autoApprove) { approve(); return; }` sitting before the
   human gate. Its absence is the property, and a behavioural test can only
   observe the absence of a branch by exercising every configuration that could
   reach it. The behavioural half is section 4 — the writer refuses regardless. */

const automation = read("public/automation.js");
const sceneAutomation = read("public/scene-automation.js");
/* Comments are stripped for the "this identifier is gone" assertions. The old
   names are deliberately quoted in the explanatory comments — a repair that
   deletes the record of what it repaired is a repair nobody can review — and a
   naive substring search would read those as live code. */
const executable = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const automationCode = executable(automation);
const sceneAutomationCode = executable(sceneAutomation);

ok(!/reviewed\.result\?\.autoApprove/.test(automation),
  "the frame runner must no longer branch on an auto-approve verdict");
ok(!/result\?\.autoApprove\s*\|\|\s*reviewed\.result\?\.humanApproved/.test(sceneAutomation),
  "nor may correction automation approve on autoApprove OR humanApproved");
ok(!/V627_AUTOMATION_AUTO_APPROVE_SCORE/.test(automationCode),
  "the constant named for automatic approval is gone from executable code; a threshold that recommends must not be named for approving");
ok(!/v640AutoApproveScore/.test(automationCode + sceneAutomationCode),
  "and neither is its reader");
ok(/V627_AUTOMATION_RECOMMENDATION_SCORE = 85/.test(automationCode),
  "the strong-pass threshold itself remains explicit and unchanged at 85");
ok(/v627RecordFrameRecommendation/.test(automation),
  "a strong pass records a nomination instead");
ok(/assertHumanAuthority\(grant, `Frame/.test(automation),
  "v626ApproveFrame is guarded");
ok(/assertHumanAuthority\(grant, `\$\{list\}/.test(automation),
  "so is v626ApproveEntity, which never had the defect — a correct path is not an invariant");

/* Every call of the two authority writers passes a grant. Counted rather than
   spot-checked: a new call site added without one is exactly the regression. */
for (const [file, source] of [["public/automation.js", automationCode], ["public/scene-automation.js", sceneAutomationCode]]) {
  const calls = (source.match(/(?:function\s+)?v626Approve(?:Frame|Entity)\([^)]*\)/g) || [])
    .filter((call) => !call.startsWith("function "));
  ok(calls.length > 0, `${file}: the scan must actually find the authority writers`);
  for (const call of calls) {
    ok(/grant/i.test(call), `${file}: every authority write must carry a grant — found ${call}`);
  }
}

/* The resumed-completed path. A completed passing review that nobody decided is
   evidence, and the runner used to re-approve it on resume. */
ok(/prior\.status === "completed" && prior\.pass && prior\.winner && prior\.result\?\.humanApproved/.test(automation),
  "resuming may only re-state an approval a human actually made");

/* ===========================================================================
   4. THE PROJECTION. Automatic provenance may not read as a human decision.

   A pre-repair project still carries winner edges scene automation wrote. The
   evidence is preserved; the CLAIM about it is what had to change. */

function shotProject(approvalWord) {
  return {
    meta: {}, scenes: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "Rooftops", keyframes: [{ id: "fr-a", label: "A", winner: "SH01_A_001.png" }],
      clips: [], candidateFiles: [{ stored: "SH01_A_001.png" }],
      generationRecords: approvalWord ? [{ id: "r1", file: "SH01_A_001.png", files: "SH01_A_001.png", approval: approvalWord }] : [],
    }],
  };
}
function shotScan() {
  return { anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: { "SH-01": { takes: [{ name: "SH01_A_001.png", url: "/assets/x" }], locked: [], blocking: [] } } };
}
function decisionFor(approvalWord) {
  const built = P4.productionMediaRecords({ project: shotProject(approvalWord), scan: shotScan(), jobs: [], jobsAvailable: true });
  const row = built.records.find((item) => item.file.name === "SH01_A_001.png");
  assert(row, "the fixture must produce a record for the approved file");
  return row;
}

const machine = decisionFor("automatic");
eq(machine.disposition.role, "approved", "the EDGE is still reported as it is — evidence is not rewritten");
eq(machine.humanDecision.state, "machine-selected", "but the DECISION is not called a human one");
eq(machine.humanDecision.actor.value, "automation", "and the actor is named");

const director = decisionFor("director");
eq(director.humanDecision.state, "approved", "a director-approved edge is a human decision");
eq(director.humanDecision.actor.value, "human", "and says so");

const reused = decisionFor("reused");
eq(reused.humanDecision.state, "approved", "a reused edge rests on an earlier human decision");
eq(reused.humanDecision.actor.value, "prior-human", "recorded as such rather than collapsed into either extreme");

const unrecorded = decisionFor("");
eq(unrecorded.humanDecision.state, "approved", "an edge with no provenance is the ordinary manual approval and stays approved");
eq(unrecorded.humanDecision.actor.state, "not-recorded", "with the actor reported as unrecorded rather than assumed");

ok(P4.PRODUCTION_MEDIA_DECISION_STATES.includes("machine-selected"),
  "the fourth state is declared in the contract's own vocabulary, not invented at a call site");

/* The Inspector must have words for it. A state no surface can render would be
   a projection that is honest and invisible. */
const inspector = read("public/media-inspector.js");
ok(/machine-selected/.test(inspector), "the Inspector renders the machine-selected state");
ok(/Selected by automation/.test(inspector), "with wording that is not an approval");

/* Operational summaries. `kind` containing "approval" is not evidence of one. */
const runs = read("automation-runs.js");
ok(!/String\(step\.kind \|\| ""\)\.includes\("approval"\) && step\.status === "completed"/.test(runs),
  "the per-shot summary must not count a completed approval STEP as an approval");
const reports = read("public/reports.js");
ok(!/String\(step\.kind \|\| ""\)\.includes\("approval"\)/.test(reports),
  "nor may the run report's Human approvals section");

/* The board badge. */
const app = read("public/app.js");
ok(/shotWinnerBadgeMarkup/.test(app), "the board badge reads provenance rather than the mere presence of a winner");
ok(/AUTOMATION PICK/.test(app), "and has a word for a machine selection");

/* ===========================================================================
   5. GATE REQUIREMENTS. What a parked step is waiting for. */

const shotRun = {
  id: "run-shot", type: "shot-chain", targetId: "SH-01", status: "awaiting-review",
  steps: { "frame:fr-a:round-1:review": { key: "frame:fr-a:round-1:review", status: "needs-review", frameId: "fr-a", pass: true, winner: "SH01_A_001.png" } },
};
const entityRun = {
  id: "run-entity", type: "entity-chain", targetId: "characters:CHAR-A", status: "awaiting-review",
  config: { list: "characters", entityId: "CHAR-A" },
  steps: { "entity:st-soot:round-1:review": { key: "entity:st-soot:round-1:review", status: "needs-review", stateId: "st-soot" } },
};
const sceneRun = {
  id: "run-scene", type: "scene-chain", targetId: "SC-01", status: "awaiting-review",
  steps: { "scene-correction:p1:round-1:review": { key: "scene-correction:p1:round-1:review", status: "needs-review", shotId: "SH-01", frameId: "fr-a", result: { targetShotId: "SH-01" } } },
};

eq(Authority.gateRequirement(shotRun, shotRun.steps["frame:fr-a:round-1:review"]).kind, "shot-frame-approval", "a frame gate is identified");
eq(Authority.gateRequirement(entityRun, entityRun.steps["entity:st-soot:round-1:review"]).kind, "entity-state-approval", "an entity-state gate is identified");
eq(Authority.gateRequirement(sceneRun, sceneRun.steps["scene-correction:p1:round-1:review"]).shotId, "SH-01",
  "a scene-correction gate resolves its own shot, not the run's scene target");
eq(Authority.gateRequirement(shotRun, { status: "completed", frameId: "fr-a" }), null, "a completed step is not a gate");
eq(Authority.gateRequirement({ type: "shot-chain", targetId: "" }, { status: "needs-review", frameId: "fr-a" }), null,
  "a gate whose object cannot be identified reports nothing rather than a guess");

/* ===========================================================================
   6. SATISFACTION. Reconciliation against current project truth. */

function projectWithFrameWinner(winner) {
  return { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a", label: "A", ...(winner ? { winner } : {}) }] }], characters: [] };
}
function projectWithState(approvedFile, isDefault = false) {
  return {
    shots: [],
    characters: [{
      id: "CHAR-A", name: "A", approvedFile: "CHAR-A_PRIMARY.png",
      continuityStates: [
        { id: "state-default", isDefault: true, approvedFile: "CHAR-A_PRIMARY.png" },
        { id: "st-soot", name: "Heavy soot", isDefault, ...(approvedFile ? { approvedFile } : {}) },
      ],
    }],
  };
}

const frameRequirement = Authority.gateRequirement(shotRun, shotRun.steps["frame:fr-a:round-1:review"]);
ok(!Authority.gateSatisfied(frameRequirement, projectWithFrameWinner("")), "an unapproved frame leaves its gate outstanding");
ok(Authority.gateSatisfied(frameRequirement, projectWithFrameWinner("SH01_A_001.png")), "an approved frame satisfies it");
ok(Authority.gateSatisfied(frameRequirement, { shots: [{ id: "SH-01", winner: "SH01_A_001.png", keyframes: [{ id: "fr-a" }] }] }),
  "the opening frame's authority may live on the shot, which is where the manual path writes it");

const stateRequirement = Authority.gateRequirement(entityRun, entityRun.steps["entity:st-soot:round-1:review"]);
ok(!Authority.gateSatisfied(stateRequirement, projectWithState("")), "a state with no approved file leaves its gate outstanding");
ok(Authority.gateSatisfied(stateRequirement, projectWithState("CHAR-A_SOOT.png")), "its own approved file satisfies it");
ok(!Authority.gateSatisfied(stateRequirement, projectWithState("")),
  "and the ENTITY's primary file does not satisfy a declared non-default state — that is the state-authority substitution defect, and it must stay fixed");

/* ===========================================================================
   7. THE PLAN AND ITS APPLICATION. */

const satisfiedProject = projectWithFrameWinner("SH01_A_001.png");
const plan = Authority.reconcileRunGates(shotRun, satisfiedProject, { at: "2026-08-14T01:00:00.000Z" });
ok(plan.changed, "a satisfied gate is detected");
eq(plan.satisfied.length, 1, "exactly the one gate");
eq(plan.outstanding.length, 0, "with nothing left outstanding");
eq(plan.nextStatus, "interrupted",
  "and the run leaves awaiting-review for interrupted — NOT completed: the rest of the chain never ran, and claiming completion would replace one dishonesty with another");

/* Planning mutates nothing. A render asks this question and must not write. */
eq(shotRun.status, "awaiting-review", "the plan did not touch the run");
eq(shotRun.steps["frame:fr-a:round-1:review"].status, "needs-review", "nor its step");

const applied = Authority.applyGateReconciliation(JSON.parse(JSON.stringify(shotRun)), plan, { at: "2026-08-14T01:00:00.000Z" });
eq(applied.status, "interrupted", "applying the plan moves the run");
eq(applied.steps["frame:fr-a:round-1:review"].status, "completed", "and closes the gate");
ok(applied.steps["frame:fr-a:round-1:review"].result.humanApproved === true,
  "marked as a human approval, because only a human could have written the authority it observed");
ok(applied.steps["frame:fr-a:round-1:review"].result.satisfiedByReconciliation === true,
  "and marked as reconciled, so a reader can tell it from one approved inside the run modal");

const unsatisfiedPlan = Authority.reconcileRunGates(shotRun, projectWithFrameWinner(""), { at: "" });
ok(!unsatisfiedPlan.changed, "an outstanding gate is left alone");
eq(Authority.applyGateReconciliation(JSON.parse(JSON.stringify(shotRun)), unsatisfiedPlan).status, "awaiting-review",
  "and applying an empty plan changes nothing");

ok(Authority.runHasActionableGate(shotRun, projectWithFrameWinner("")), "an unsatisfied run is still waiting for you");
ok(!Authority.runHasActionableGate(shotRun, satisfiedProject), "a satisfied one is not");
ok(Authority.runHasActionableGate({ status: "awaiting-review", steps: {} }, satisfiedProject),
  "a run whose gate cannot be identified stays actionable — the failure mode of guessing wrong here is one extra item, not hidden work");

/* ===========================================================================
   8. THE WIRING. One boundary, every entry point.

   Source assertions, because these are integration points rather than pure
   functions: what matters is that no surface answers the question privately. */

ok(/readReconciled\(\)/.test(runs), "the server reconciles on read");
ok(/reconcileParkedGates/.test(runs), "through the shared boundary");
ok(/run\.status !== "awaiting-review"\) continue/.test(runs),
  "and only for parked runs, so a revision bump cannot race an active runner");
ok(/api\/automation\/runs\/recheck/.test(runs), "a manual Recheck status route exists");

const activity = read("public/live-activity.js");
ok(/v670RunGateOutstanding/.test(activity), "the browser predicate asks the same question");
ok(/runGateRequirements/.test(activity) && /gateSatisfied/.test(activity),
  "through the same shared functions rather than a per-surface filter");
ok(/recheckAutomationGateStatus/.test(activity), "and Recheck status is reachable from Global Activity");
ok(/v670ReconcileAfterApproval/.test(activity), "an approval elsewhere triggers reconciliation immediately");

const libraryCode = executable(read("public/library-tools.js"));
eq((libraryCode.match(/v670ReconcileAfterApproval\(\)/g) || []).length, 2,
  "both the shot approval and the entity approval call it — those are the two paths that write authority outside a run modal");

/* Dismissal must never falsify production state. The drawer's only dismissal is
   the archive action, which moves a FAILED run out of view and cannot touch a
   gate's satisfaction — assert that it still cannot reach one. */
ok(!/archivePreviousAutomationFailures[\s\S]{0,600}winner/.test(activity),
  "dismissing alerts must not write any approval edge");

console.log(`Production-authority suite passed ${checks} checks: the grant contract, the nomination record, the removed auto-approval branches on every automation path, actor-aware projections, gate identification, satisfaction against project truth, the reconciliation plan and its application, and the single reconciliation boundary shared by server, browser and every approval surface.`);

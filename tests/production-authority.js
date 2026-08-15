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
/* 1D-03: entity-state Canon requires a real ownership answer from the kernel,
   so the real resolver is wired here exactly as bootstrap wires it in the app.
   A suite that did not wire it would get AUTHORITY_OWNERSHIP_UNAVAILABLE — the
   fail-closed direction, which is the correct one. */
const Ownership = require("../public/shared-entity-ownership");
Authority.useEntityOwnershipResolver(Ownership);
const Kernel = require("../public/shared-authority-kernel");
/* BATCH 1C — THE CREDENTIAL IS A CAPABILITY, NOT A SHAPE.
 *
 * These tests used `Authority.humanAuthorityGrant({ via })` — the public
 * builder for `{ actor: "human", act: "explicit-approval" }`. The Batch 1B
 * re-audit forged exactly that object and got a winner and a receipt out of the
 * shipped writer, so the builder is gone and so is the shape check behind it.
 *
 * A manual approval is now a one-use capability minted inside a trusted user
 * gesture and bound to the targets it may authorize. Node has no user agent, so
 * a suite that exercises a manual path installs the harness source and opens
 * the window explicitly — and `manualActionSourceInstalled()` reports "harness"
 * rather than claiming a person was present. */
/* 1D-01: the synthetic source is gone from the product. This drives the REAL
   trusted-event listener through an event target the test composition owns —
   see tests/authority-test-gesture.js for why that boundary is compositional
   rather than a flag. */
const { installTestManualActionSource } = require("./authority-test-gesture.js");
const MANUAL = installTestManualActionSource(Kernel);
/* 1D-02: a capability binds the target AND the bytes. `approvalFor(target)`
   still mints a target-only capability where a suite is testing target rules;
   `approvalFor(target, value)` binds the exact value, which is what every real
   creator-facing approval does. */
const approvalFor = (target, value) => MANUAL.gesture(() => Authority.beginManualApproval({
  via: "test-approval-surface",
  targets: [value === undefined ? target : { ...target, value }],
}));
const approvalForAll = (...targets) => MANUAL.gesture(() => Authority.beginManualApproval({ via: "test-approval-surface", targets }));
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

/* THE FORGEABLE TRIO IS GONE, and its absence is the assertion. Re-exporting any
   of them restores the credential the re-audit forged in one line. */
for (const name of ["isHumanAuthorityGrant", "humanAuthorityGrant", "assertHumanAuthority"]) {
  ok(!(name in Authority), `${name} must not exist — a credential cannot be a shape a caller can type`);
}
/* A capability cannot be minted without a trusted gesture. */
assert.throws(() => Authority.beginManualApproval({ via: "x", targets: [{ kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }] }),
  (error) => error.code === "MANUAL_ACTION_REQUIRED", "no gesture, no capability");
checks++;
/* And the exact object the re-audit forged authorizes nothing. */
{
  const P = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }] }] };
  let wrote = false;
  assert.throws(() => Authority.writeFrameProductionAuthority(P, {
    shotId: "SH-01", frameId: "fr-a", value: "FORGED.png", at: "T",
    manualAction: { actor: "human", act: "explicit-approval" },
    applyEdge: (draft) => { wrote = true; draft.shots[0].keyframes[0].winner = "FORGED.png"; },
  }), (error) => error.code === "MANUAL_ACTION_INVALID", "the forged credential shape authorizes nothing");
  checks++;
  ok(!wrote, "and the edge writer never ran");
  ok(!P.shots[0].keyframes[0].winner, "so the project is untouched");
}

/* The refusal is recognisable, so a runner cannot mistake it for a transient
   provider fault and retry it. */
{
  const P = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }] }] };
  let code = "";
  try { Authority.writeFrameProductionAuthority(P, { shotId: "SH-01", frameId: "fr-a", value: "X.png", at: "T", manualAction: undefined, applyEdge: () => {} }); }
  catch (error) { code = error.code; ok(error.authorityViolation === true, "and it is flagged as an authority violation"); }
  eq(code, "MANUAL_ACTION_INVALID", "an omitted capability is refused by a named code");
}

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
/* BATCH 1C: the guard moved INSIDE the kernel transaction, so what these
   assertions look for is that both writers take a capability and hand it to the
   command rather than checking a shape themselves. */
ok(/function v626ApproveFrame\(shotId, frameId, fileName, manualAction\)/.test(automation),
  "v626ApproveFrame takes a manual-action capability");
ok(/function v626ApproveEntity\(list, entityId, stateId, fileName, manualAction\)/.test(automation),
  "so does v626ApproveEntity, which never had the defect — a correct path is not an invariant");
ok(!/assertHumanAuthority/.test(automationCode), "and neither checks a credential shape itself any more");

/* Every call of the two authority writers passes a grant. Counted rather than
   spot-checked: a new call site added without one is exactly the regression. */
{
  const calls = (automationCode.match(/(?:function\s+)?v626Approve(?:Frame|Entity)\([^)]*\)/g) || [])
    .filter((call) => !call.startsWith("function "));
  ok(calls.length > 0, "public/automation.js: the scan must actually find the authority writers");
  for (const call of calls) {
    ok(/manualAction/i.test(call), `public/automation.js: every authority write must carry a manual-action capability — found ${call}`);
  }
}
/* BATCH 1C: scene automation calls NO authority writer at all. It used to read
   a cached `result.humanApproved` and build itself a credential from it — the
   re-audit cited that line as proof the builder was not confined to a trusted
   human event. A correction is approved at the gate, by a person, like
   everything else. */
ok(!/v626Approve(?:Frame|Entity)\(/.test(sceneAutomationCode),
  "public/scene-automation.js: automation establishes no authority on any path");

/* The resumed-completed path.

   BATCH 1B CHANGED WHAT THIS ASSERTS, and the change is the repair. It used to
   check that resume read `prior.result?.humanApproved` — a boolean on a cached
   step. The acceptance audit turned that into a resurrection: revoke the
   approval, resume the run, and the stale boolean handed authority back, because
   the runner both trusted it and minted itself a fresh grant to act on it.

   Resume asks the durable receipt now, and re-states nothing. The behavioural
   proof is in tests/dogfood2-p0-architecture.js §1; what is asserted here is
   that the two reads a resurrection needs are both gone from the source. */
ok(/resumeAuthority\(P, \{ kind: "shot-frame-approval", shotId, frameId \}\)/.test(automation),
  "resuming asks whether a human decision exists RIGHT NOW");
ok(!/prior\.result\?\.humanApproved/.test(automation),
  "and never reads the cached boolean a revoked approval leaves behind");
ok(!/v626ApproveFrame\(shotId, frameId, prior\.winner/.test(automation),
  "and issues itself no grant to re-write an edge with — a live receipt means the edge is already there");

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

/* CHANGED IN BATCH 1D — AND THE 1C ACCEPTANCE AUDIT NAMED THIS BLOCK.

   OLD EXPECTATIONS: every fixture here has a raw `keyframes[0].winner` and NO
   authority ledger at all, and this block required the projection to call each
   of them `approved`, with three of the four also reporting `humanDecision:
   "approved"`. The audit's words were that the suite "pins the unreceipted case
   as an ordinary manual approval" — and it did, which is why Results and the
   Inspector rendered "Approved by you · It is production canon" for a project
   nobody had approved anything in.

   WHY THEY ARE NO LONGER VALID: a legacy pointer and an automation provenance
   word are both things a machine leaves behind. Reading either as a human
   decision is the second representation of production truth that 1D-04 removes.

   THE NEW INVARIANT: `approved` requires a valid current receipt. Everything
   else with an edge is `historic` — a real selection nobody approved as Canon.

   WHAT SURVIVES UNCHANGED, because it was the point of the block: the EVIDENCE
   IS NOT REWRITTEN. The edges are still enumerated in `disposition.targets`,
   `disposition.authority.claimed` still says an edge points here, and the
   automation provenance word is still read and reported. Nothing is hidden;
   what stopped is CineBraid claiming the filmmaker chose it. */
const machine = decisionFor("automatic");
eq(machine.disposition.role, "historic", "an edge with no receipt behind it is a historic selection, not an approval");
eq(machine.disposition.authority.claimed, true, "the edge is still reported as it is — evidence is not rewritten");
eq(machine.disposition.authority.receiptBacked, false, "and the reason it is not canon is stated, not implied");
eq(machine.disposition.targets.length > 0, true, "the targets it points at are still enumerated");
eq(machine.humanDecision.state, "undecided", "nobody has decided this, which is the truth about a project with no ledger");
eq(machine.humanDecision.actor.value, "automation", "and the actor the run recorded is still named");

const director = decisionFor("director");
eq(director.disposition.role, "historic", "even a run that recorded \"director\" has no receipt to show");
eq(director.humanDecision.state, "undecided",
  "an automation provenance WORD is not a durable human decision — it is the run's own note about itself, and 1B already proved a run can write it without a person");
eq(director.humanDecision.actor.value, "human", "the word is still reported, because it is real evidence about the run");

const reused = decisionFor("reused");
eq(reused.humanDecision.actor.value, "prior-human", "recorded as such rather than collapsed into either extreme");

const unrecorded = decisionFor("");
eq(unrecorded.disposition.role, "historic", "an edge with no provenance at all is historic too");
eq(unrecorded.humanDecision.actor.state, "not-recorded", "with the actor reported as unrecorded rather than assumed");

/* AND THE RECEIPTED CASE, which is the other half of the invariant and was not
   covered here before: with a valid current receipt the same projection says
   approved, and names the targets the receipt covers. */
{
  const project = shotProject("");
  const target = { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" };
  project.shots[0].keyframes[0].winner = "";
  Authority.writeFrameProductionAuthority(project, {
    shotId: "SH-01", frameId: "fr-a", value: "SH01_A_001.png", at: "2026-08-14T00:30:00.000Z",
    manualAction: approvalFor(target, "SH01_A_001.png"),
  });
  const built = P4.productionMediaRecords({ project, scan: shotScan(), jobs: [], jobsAvailable: true });
  const row = built.records.find((item) => item.file.name === "SH01_A_001.png");
  eq(row.disposition.role, "approved", "a receipted edge IS approved production media");
  eq(row.disposition.authority.receiptBacked, true, "and says what makes it so");
  eq(row.humanDecision.state, "approved", "and reads as a human decision");
  eq(built.counts.approved, 1, "and is counted as one");
}

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

/* BATCH 1B CHANGED WHAT MAKES A FIXTURE APPROVED, and every expectation below
   moved with it. These fixtures used to hand-write a `winner` field and assert
   the gate was satisfied — which is exactly the reasoning the acceptance audit
   refuted: a written edge is not a decision, and a preserved project is full of
   edges no person ever made. A fixture that wants an approved frame now has to
   APPROVE ONE, through the command a human surface calls.

   Legacy hand-written edges are still fixtures here, and they now prove the
   opposite property: they are visible historic selections that satisfy nothing. */

function projectWithFrameWinner(winner) {
  return { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a", label: "A", ...(winner ? { winner } : {}) }] }], characters: [] };
}
/* The same project, with the winner established the way a person establishes
   one. `approveFrameAsHuman` is the shipped command, not a test helper's
   reimplementation of it. */
function approvedFrameProject(winner, via = "test-approval-surface") {
  const P = projectWithFrameWinner("");
  Authority.writeFrameProductionAuthority(P, {
    shotId: "SH-01", frameId: "fr-a", value: winner, at: "2026-08-14T00:30:00.000Z",
    manualAction: approvalFor({ kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }, winner),
  });
  return P;
}
function projectWithState(approvedFile, isDefault = false) {
  return {
    shots: [],
    characters: [{
      id: "CHAR-A", name: "A", prefix: "CHAR-A", approvedFile: "CHAR-A_PRIMARY.png",
      /* 1D-03: entity-state Canon now REQUIRES one durable owner, and the
         kernel asks — there is no eligibility parameter to pass `ok:true` to
         any more. So the fixture durably claims the files it approves, which is
         what a real project looks like when the creator imported them. */
      candidateFiles: [{ stored: "CHAR-A_PRIMARY.png" }, { stored: "CHAR-A_SOOT.png" }],
      continuityStates: [
        { id: "state-default", isDefault: true, approvedFile: "CHAR-A_PRIMARY.png" },
        { id: "st-soot", name: "Heavy soot", isDefault, ...(approvedFile ? { approvedFile } : {}) },
      ],
    }],
  };
}
function approvedStateProject(approvedFile) {
  const P = projectWithState("");
  Authority.writeEntityStateProductionAuthority(P, {
    list: "characters", entityId: "CHAR-A", stateId: "st-soot",
    value: approvedFile, at: "2026-08-14T00:30:00.000Z",
    manualAction: approvalFor({ kind: "entity-state", list: "characters", entityId: "CHAR-A", stateId: "st-soot" }, approvedFile),
    /* 1D-03: no `eligibility` override, because there is no such parameter.
       Ownership is the kernel's rule for this target kind and the fixture above
       satisfies it honestly — which is the point: the only way to approve an
       entity state is to actually own the file. */
  });
  return P;
}

const frameRequirement = Authority.gateRequirement(shotRun, shotRun.steps["frame:fr-a:round-1:review"]);
ok(!Authority.gateSatisfied(frameRequirement, projectWithFrameWinner("")), "an unapproved frame leaves its gate outstanding");
ok(Authority.gateSatisfied(frameRequirement, approvedFrameProject("SH01_A_001.png")), "a frame a human approved satisfies it");
ok(!Authority.gateSatisfied(frameRequirement, projectWithFrameWinner("SH01_A_001.png")),
  "a bare winner with no receipt behind it does NOT — that is the audit's headline counterexample, and the whole reason the receipt exists");
eq(Authority.gateHistoricSelection(frameRequirement, projectWithFrameWinner("SH01_A_001.png")).basis, "no-human-receipt",
  "it is reported as a historic selection instead: visible, explained, and one act away from being real");
{
  const openingOnShot = approvedFrameProject("SH01_A_001.png");
  delete openingOnShot.shots[0].keyframes[0].winner;
  ok(Authority.gateSatisfied(frameRequirement, openingOnShot),
    "the opening frame's authority may live on the shot, which is where the manual path writes it");
}

const stateRequirement = Authority.gateRequirement(entityRun, entityRun.steps["entity:st-soot:round-1:review"]);
ok(!Authority.gateSatisfied(stateRequirement, projectWithState("")), "a state with no approved file leaves its gate outstanding");
ok(Authority.gateSatisfied(stateRequirement, approvedStateProject("CHAR-A_SOOT.png")), "a state a human approved satisfies it");
ok(!Authority.gateSatisfied(stateRequirement, projectWithState("CHAR-A_SOOT.png")),
  "an approvedFile with no receipt does not — the entity chain gets the same rule as the shot chain");
ok(!Authority.gateSatisfied(stateRequirement, projectWithState("")),
  "and the ENTITY's primary file does not satisfy a declared non-default state — that is the state-authority substitution defect, and it must stay fixed");

/* ===========================================================================
   7. THE PLAN AND ITS APPLICATION. */

const satisfiedProject = approvedFrameProject("SH01_A_001.png");
const plan = Authority.reconcileRunGates(shotRun, satisfiedProject, { at: "2026-08-14T01:00:00.000Z" });
ok(plan.changed, "a satisfied gate is detected");
eq(plan.satisfied.length, 1, "exactly the one gate");
eq(plan.outstanding.length, 0, "with nothing left outstanding");
eq(plan.nextStatus, "interrupted",
  "and the run leaves awaiting-review for interrupted — NOT completed: the rest of the chain never ran, and claiming completion would replace one dishonesty with another");

/* Planning mutates nothing. A render asks this question and must not write. */
eq(shotRun.status, "awaiting-review", "the plan did not touch the run");
eq(shotRun.steps["frame:fr-a:round-1:review"].status, "needs-review", "nor its step");

/* K2: the applier is handed the PROJECT, and re-verifies the cited receipt
   against it immediately before writing the step. A plan alone is a request. */
const applied = Authority.applyGateReconciliation(JSON.parse(JSON.stringify(shotRun)), plan, { at: "2026-08-14T01:00:00.000Z", project: satisfiedProject });
eq(applied.status, "interrupted", "applying the plan moves the run");
eq(applied.steps["frame:fr-a:round-1:review"].status, "completed", "and closes the gate");
ok(applied.steps["frame:fr-a:round-1:review"].result.humanApproved === true,
  "marked as a human approval — a CITATION of the receipt this plan verified, never a synthesis from a winner field");
ok(/^authority-\d{6}$/.test(String(applied.steps["frame:fr-a:round-1:review"].result.authorityReceiptId || "")),
  "and it names WHICH decision it is citing, so a run report can print the receipt instead of asserting a boolean nobody can trace");
ok(applied.steps["frame:fr-a:round-1:review"].result.satisfiedByReconciliation === true,
  "and marked as reconciled, so a reader can tell it from one approved inside the run modal");
/* A hand-built plan cannot close a gate this module never verified. */
{
  const forged = JSON.parse(JSON.stringify(shotRun));
  Authority.applyGateReconciliation(forged, { changed: true, satisfied: [{ ...frameRequirement, receiptId: "" }], invalidated: [], nextStatus: "interrupted" }, { at: "T" });
  eq(forged.steps["frame:fr-a:round-1:review"].status, "needs-review",
    "a satisfied entry with no receipt id closes nothing — the citation and the completion are written in the same statement or neither is");
}

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
ok(/RECONCILABLE_RUN_STATUSES = \["awaiting-review", "interrupted"\]/.test(runs)
  && /!RECONCILABLE_RUN_STATUSES\.includes\(String\(run\.status \|\| ""\)\)\) continue/.test(runs),
  "for parked and interrupted runs — never a `running` one, so a revision bump cannot race an active runner");
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

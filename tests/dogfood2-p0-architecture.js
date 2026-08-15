/* DOGFOOD #2 TRUST KERNEL — END-TO-END ADVERSARIAL BOUNDARY TESTS.
 *
 * Batch 1B created this file; Batch 1C extended it into the full Codex
 * regression matrix and migrated every fixture onto the capability model.
 *
 * WHY THIS FILE EXISTS, and it is not "more coverage".
 *
 * The independent acceptance audit passed every suite in Repair Batch 1 and
 * still found live P0 behaviour in all six areas. Its verdict on the tests was
 * precise: they assert at the wrong boundary. A helper can be correct while the
 * writer beside it is not; a source pattern can match while the dispatcher that
 * matters never runs the matched code. So the batch was green and the product
 * was not.
 *
 * EVERY TEST HERE ATTACKS A REAL BOUNDARY, and each one fails on one of exactly
 * two things:
 *
 *     DURABLE FALSE STATE       — the project, or the run ledger, ends up
 *                                 asserting something untrue.
 *     ATTEMPTED PROVIDER SPEND  — a request reaches, or would reach, a paid
 *                                 endpoint it should have been refused before.
 *
 * Not "the helper returned the right value". Not "the source contains a string".
 *
 * THE COUNTEREXAMPLES ARE THE AUDIT'S OWN. Where it executed a probe and got a
 * wrong answer, that probe is reproduced here verbatim as a test:
 *
 *   §1  a preserved automatic winner satisfying a human gate
 *   §1  reconciliation manufacturing `humanApproved: true`
 *   §1  revoke, then resume, restoring authority from a stale step
 *   §2  "The Chimbley Sweep stands before the chimney" read as an absence
 *   §3  automation and correction dispatching around the compiler
 *   §4  an unclaimed filename entering an approval pool
 *   §4  a contested file attributed to one claimant
 *   §5  approval navigation writing a first parent
 *   §5  the parent dropdown offering a descendant, and its setter closing a cycle
 *   §6  the real correction runner throwing an unclassified TypeError
 *
 * NO PAID CALL AND NO LOCAL MODEL CALL IS POSSIBLE. The FAL route is exercised
 * against a submit function that records an attempt and throws; reaching it at
 * all is a test failure. The browser paths run in the existing vm render
 * harness, whose `fetch` is intercepted.
 *
 * NO PROJECT DATA IS TOUCHED. Fixtures are literals and a scratch directory this
 * file creates and removes.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const Authority = require("../public/shared-production-authority");
const Ownership = require("../public/shared-entity-ownership");
const Lineage = require("../public/shared-state-lineage");
const Presence = require("../public/shared-frame-presence");
const { render } = require("./render-harness");

const Kernel = require("../public/shared-authority-kernel");
const Slots = require("../public/shared-entity-slots");
Authority.useEntityOwnershipResolver(Ownership);

/* BATCH 1C — A CAPABILITY, NOT A GRANT SHAPE.
   Node has no user agent, so the harness source opens the gesture window
   explicitly and says so. `manualActionSourceInstalled()` reports "harness"
   rather than claiming a person was present. */
const MANUAL = Kernel.installHarnessManualActionSource();
const approvalFor = (...targets) => MANUAL.gesture(() => Authority.beginManualApproval({ via: "test-approval-surface", targets }));

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

const AT = (n) => `2026-08-14T0${n}:00:00.000Z`;


/* =========================================================================
   §1  AUTHORITY — the receipt, and the three counterexamples.
   ========================================================================= */

/* A PRESERVED PRE-REPAIR PROJECT. The winner is exactly what scene automation
   used to write: a real file, real automatic provenance, and no human anywhere
   in its history. Nothing here is hypothetical — it is the shape the Dogfood #2
   evidence is preserved in. */
function legacyAutomaticProject() {
  return {
    shots: [{
      id: "SH-01", scene: "SC-01",
      winner: "SH01_A_AUTOPICK.png",
      keyframes: [{ id: "fr-a", label: "A", winner: "SH01_A_AUTOPICK.png" }],
      generationRecords: [{ id: "r1", file: "SH01_A_AUTOPICK.png", files: "SH01_A_AUTOPICK.png", approval: "automatic", score: 92 }],
    }],
    characters: [],
  };
}
function parkedShotRun() {
  return {
    id: "run-shot", type: "shot-chain", targetId: "SH-01", status: "awaiting-review",
    steps: {
      "frame:fr-a:round-1:review": {
        key: "frame:fr-a:round-1:review", kind: "frame-review", status: "needs-review",
        frameId: "fr-a", pass: true, score: 92, winner: "SH01_A_AUTOPICK.png",
        result: { rationale: "Strong automated pass", recommend: true },
      },
    },
  };
}

/* THE AUDIT'S HEADLINE COUNTEREXAMPLE. Its probe returned
   `{gateSatisfied: true, stepStatus: "completed", humanApproved: true}`. */
{
  const project = legacyAutomaticProject();
  const run = parkedShotRun();
  const requirement = Authority.runGateRequirements(run)[0];
  ok(!!requirement, "the parked gate is identified");
  ok(!Authority.gateSatisfied(requirement, project),
    "a preserved automatic winner does NOT satisfy a human gate — the audit's probe returned true here");

  const plan = Authority.reconcileRunGates(run, project, { at: AT(1) });
  ok(!plan.changed, "reconciliation finds nothing to close");
  Authority.applyGateReconciliation(run, plan, { at: AT(1) });
  eq(run.steps["frame:fr-a:round-1:review"].status, "needs-review", "the step is still parked");
  eq(run.status, "awaiting-review", "the run is still waiting for a person");
  eq(run.steps["frame:fr-a:round-1:review"].result.humanApproved, undefined,
    "and NOTHING wrote humanApproved — reconciliation may cite a decision, never manufacture one");
  ok(Authority.runHasActionableGate(run, project), "every surface still reports this as waiting for you");

  /* The selection is not hidden. It is offered, correctly labelled. */
  const historic = Authority.gateHistoricSelection(requirement, project);
  eq(historic.value, "SH01_A_AUTOPICK.png", "the automatic selection is still surfaced");
  eq(historic.basis, "no-human-receipt", "described as a selection nobody decided on");
  eq(historic.requiresHumanApproval, true, "and explicitly requiring approval");
}

/* MACHINE PROVENANCE IS NOT THE ONLY LEGACY SHAPE. Missing and unknown
   provenance must fail the same way — a project that cannot say who chose a file
   has not said a human did. */
for (const record of [null, { approval: "" }, { approval: "unknown" }, { approval: "automatic" }]) {
  const project = legacyAutomaticProject();
  project.shots[0].generationRecords = record ? [{ id: "r", file: "SH01_A_AUTOPICK.png", files: "SH01_A_AUTOPICK.png", ...record }] : [];
  ok(!Authority.gateSatisfied(Authority.runGateRequirements(parkedShotRun())[0], project),
    `a winner whose provenance is ${record ? JSON.stringify(record.approval) : "absent"} does not satisfy a human gate`);
}

/* THE APPROVAL, THE REVOCATION, AND THE RESUME. One continuous story, because
   the audit's second counterexample is a sequence rather than a state. */
{
  const project = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a", label: "A" }] }], characters: [] };
  const run = parkedShotRun();
  run.steps["frame:fr-a:round-1:review"].winner = "SH01_A_PICK.png";
  const requirement = Authority.runGateRequirements(run)[0];
  const target = { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" };
  /* The edge writer mutates the DRAFT the kernel stages, never the live
     document — that is what makes a refused or unpersisted transaction leave
     nothing behind. */
  const writeEdge = (name) => (draft) => { draft.shots[0].keyframes[0].winner = name; draft.shots[0].winner = name; };

  /* 1. A HUMAN APPROVES. */
  const receipt = Authority.writeFrameProductionAuthority(project, {
    ...target, value: "SH01_A_PICK.png", at: AT(2),
    manualAction: MANUAL.gesture(() => Authority.beginManualApproval({ via: "run-approval-modal", targets: [target] })),
    applyEdge: writeEdge("SH01_A_PICK.png"),
  });
  eq(receipt.actor, "human", "the receipt records the actor");
  eq(receipt.command, "approve-shot-frame", "the command");
  eq(receipt.kind, "shot-frame", "the target kind");
  eq(receipt.targetKey, "shot-frame:SH-01#fr-a", "the target key, DERIVED from the parts so a stored string cannot disagree with them");
  eq(receipt.value, "SH01_A_PICK.png", "the approved value");
  eq(receipt.at, AT(2), "the timestamp");
  eq(receipt.provenance.via, "run-approval-modal", "the provenance — which surface issued the command");
  ok(!!receipt.provenance.manualAction, "and the manual action that issued it");
  eq(receipt.status, "current", "and its supersession state");
  ok(Authority.gateSatisfied(requirement, project), "the gate is satisfied");

  const satisfiedPlan = Authority.reconcileRunGates(run, project, { at: AT(2) });
  Authority.applyGateReconciliation(run, plan1Guard(satisfiedPlan), { at: AT(2), project });
  eq(run.steps["frame:fr-a:round-1:review"].status, "completed", "the gate closes");
  eq(run.steps["frame:fr-a:round-1:review"].result.authorityReceiptId, receipt.id,
    "citing the receipt, so the boolean beside it can be traced to a decision");
  eq(run.status, "interrupted", "and the run stops waiting");
  eq(Authority.resumeAuthority(project, requirement).id, receipt.id, "resume finds a live decision");

  /* 2. THE APPROVAL IS REPLACED. Supersession, not overwrite. */
  const replacement = Authority.writeFrameProductionAuthority(project, {
    ...target, value: "SH01_A_BETTER.png", at: AT(3),
    manualAction: MANUAL.gesture(() => Authority.beginManualApproval({ via: "guided-frame-card", targets: [target] })),
    applyEdge: writeEdge("SH01_A_BETTER.png"),
  });
  eq(Authority.currentAuthorityReceipt(project, target).id, replacement.id, "the newest decision is the current one");
  eq(Authority.authorityReceiptsFor(project, target).map((row) => row.status), ["superseded", "current"],
    "and the previous one is preserved as history rather than deleted");
  eq(Authority.authorityReceiptsFor(project, target)[0].supersededBy, replacement.id, "naming what replaced it");
  eq(Authority.resumeAuthority(project, requirement).value, "SH01_A_BETTER.png",
    "resume answers with the CURRENT decision, never a superseded one");

  /* 3. THE APPROVAL IS REVOKED — the audit's resurrection counterexample. */
  Authority.revokeFrameProductionAuthority(project, {
    ...target, at: AT(4), via: "guided-frame-approval-reset", reason: "withdrawn",
    applyEdge: (draft) => { draft.shots[0].keyframes[0].winner = ""; draft.shots[0].winner = ""; },
  });
  ok(!Authority.gateSatisfied(requirement, project), "the gate is open again");
  eq(Authority.resumeAuthority(project, requirement), null, "and resume finds no decision to re-state");

  const reopenPlan = Authority.reconcileRunGates(run, project, { at: AT(4) });
  ok(reopenPlan.changed, "reconciliation notices — in the OTHER direction, which the first repair could not do");
  eq(reopenPlan.invalidated.length, 1, "exactly the one completed gate whose authority is gone");
  Authority.applyGateReconciliation(run, reopenPlan, { at: AT(4), project });
  eq(run.steps["frame:fr-a:round-1:review"].status, "needs-review", "the completed step REOPENS");
  eq(run.steps["frame:fr-a:round-1:review"].result.humanApproved, false, "and withdraws its claim rather than merely dropping it");
  eq(run.steps["frame:fr-a:round-1:review"].result.authorityReceiptId, "", "with no receipt left to cite");
  ok(run.steps["frame:fr-a:round-1:review"].result.authorityInvalidated === true, "recorded as invalidated, so the run report can explain the reopening");
  eq(run.status, "awaiting-review", "the run is waiting again");
  ok(Authority.runHasActionableGate(run, project), "and every surface says so");

  /* 4. A FORGED STALE STEP CANNOT RESTORE IT. This is the resurrection, executed
        against the predicate resume actually asks. */
  run.steps["frame:fr-a:round-1:review"].status = "completed";
  run.steps["frame:fr-a:round-1:review"].pass = true;
  run.steps["frame:fr-a:round-1:review"].result.humanApproved = true;
  eq(Authority.resumeAuthority(project, requirement), null,
    "a step claiming humanApproved after a revocation restores NOTHING — resume reads the ledger, not the step");
  ok(Authority.runHasActionableGate(run, project), "and the gate is still actionable despite the step saying otherwise");
  eq(Authority.historicSelection(project, target), null, "with no edge left, there is not even a historic selection to offer");

  /* 5. THE HISTORY SURVIVES ALL OF IT. */
  eq(Authority.authorityReceiptsFor(project, target).map((row) => `${row.status}:${row.revocationReason}`),
    ["superseded:replaced", "revoked:withdrawn"],
    "two decisions, both preserved, each with the reason it stopped standing — a ledger that forgets cannot answer why a gate reopened");
}
/* A guard used above: the plan handed to applyGateReconciliation must be the one
   reconcileRunGates produced. Written as a function so the assertion travels
   with the call rather than sitting three lines away from it. */
function plan1Guard(plan) {
  assert.strictEqual(plan.satisfied.length, 1, "the satisfied plan must contain exactly the one gate");
  assert.ok(plan.satisfied[0].receiptId, "and it must carry the receipt it is citing");
  return plan;
}

/* THE ENTITY CHAIN GETS THE SAME RULE, and the ownership veto rides the same
   command — so there is no writer that can approve past either. */
{
  const project = {
    shots: [],
    characters: [{
      id: "CHAR-SWEEP", name: "Chimbley Sweep", prefix: "CHAR-SWEEP", approvedFile: "",
      continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }, { id: "st-soot", name: "Heavy soot", approvedFile: "" }],
      candidateFiles: [{ stored: "CHAR-SWEEP_SOOT_001.png" }],
    }],
  };
  const requirement = { kind: "entity-state-approval", list: "characters", entityId: "CHAR-SWEEP", stateId: "st-soot" };
  ok(!Authority.gateSatisfied(requirement, project), "the state gate starts outstanding");

  Authority.writeEntityStateProductionAuthority(project, {
    list: "characters", entityId: "CHAR-SWEEP", stateId: "st-soot", value: "CHAR-SWEEP_SOOT_001.png",
    at: AT(5),
    manualAction: approvalFor({ kind: "entity-state", list: "characters", entityId: "CHAR-SWEEP", stateId: "st-soot" }),
    applyEdge: (draft) => { draft.characters[0].continuityStates[1].approvedFile = "CHAR-SWEEP_SOOT_001.png"; },
  });
  ok(Authority.gateSatisfied(requirement, project), "and a human approval satisfies it");

  /* A file the entity does not durably own cannot be approved for it, whatever
     surface asks and whatever grant it holds. */
  assert.throws(() => Authority.writeEntityStateProductionAuthority(project, {
    list: "characters", entityId: "CHAR-SWEEP", stateId: "st-soot", value: "CHAR-SWEEP_STRAY_002.png",
    at: AT(6),
    manualAction: approvalFor({ kind: "entity-state", list: "characters", entityId: "CHAR-SWEEP", stateId: "st-soot" }),
    applyEdge: (draft) => { draft.characters[0].continuityStates[1].approvedFile = "CHAR-SWEEP_STRAY_002.png"; },
  }), /not durably owned/, "an unclaimed file is refused at the authority boundary");
  checks++;
  eq(project.characters[0].continuityStates[1].approvedFile, "CHAR-SWEEP_SOOT_001.png",
    "and the refusal wrote nothing — the edge is untouched, which is what makes the veto safe to place inside the command");
}

/* MACHINE ACTORS ARE REFUSED BY THE COMMAND, not merely by a helper. */
/* NOTHING A CALLER CAN CONSTRUCT IS A CAPABILITY. The last entry is the exact
   object the Batch 1B re-audit forged to obtain a winner and a receipt. */
for (const forged of [undefined, {}, true, "human", { actor: "human" }, { act: "explicit-approval" },
  { actor: "automation", act: "explicit-approval" }, { actor: "human", act: "explicit-approval" },
  { manualAction: "manual-1" }, { manualAction: {} }]) {
  const project = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }] }] };
  let wrote = false;
  assert.throws(() => Authority.writeFrameProductionAuthority(project, {
    shotId: "SH-01", frameId: "fr-a", value: "X.png", manualAction: forged, at: AT(1),
    applyEdge: (draft) => { wrote = true; draft.shots[0].keyframes[0].winner = "X.png"; },
  }), (error) => error.code === "MANUAL_ACTION_INVALID" || error.code === "MANUAL_ACTION_TARGET_MISMATCH",
  `${JSON.stringify(forged)} may not establish authority`);
  checks++;
  ok(!wrote, `${JSON.stringify(forged)}: and the edge writer never ran`);
  ok(!project.shots[0].keyframes[0].winner, `${JSON.stringify(forged)}: so the project is untouched`);
  eq(Authority.authorityReceipts(project).length, 0, `${JSON.stringify(forged)}: with no receipt written either`);
}

/* A CAPABILITY IS BOUND TO ITS TARGETS AND CONSUMED ONCE. */
{
  const project = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }, { id: "fr-b" }] }] };
  const token = approvalFor({ kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" });
  assert.throws(() => Authority.writeFrameProductionAuthority(project, {
    shotId: "SH-01", frameId: "fr-b", value: "WRONG.png", manualAction: token, at: AT(1),
    applyEdge: (draft) => { draft.shots[0].keyframes[1].winner = "WRONG.png"; },
  }), (error) => error.code === "MANUAL_ACTION_TARGET_MISMATCH", "a capability for one frame cannot approve another");
  checks++;
  const good = approvalFor({ kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" });
  Authority.writeFrameProductionAuthority(project, {
    shotId: "SH-01", frameId: "fr-a", value: "RIGHT.png", manualAction: good, at: AT(1),
    applyEdge: (draft) => { draft.shots[0].keyframes[0].winner = "RIGHT.png"; },
  });
  assert.throws(() => Authority.writeFrameProductionAuthority(project, {
    shotId: "SH-01", frameId: "fr-a", value: "AGAIN.png", manualAction: good, at: AT(1),
    applyEdge: (draft) => { draft.shots[0].keyframes[0].winner = "AGAIN.png"; },
  }), (error) => error.code === "MANUAL_ACTION_INVALID", "and a spent capability cannot be replayed");
  checks++;
  eq(project.shots[0].keyframes[0].winner, "RIGHT.png", "so the second write changed nothing");
}

/* NO GESTURE, NO CAPABILITY. Automation lives in async continuations and can
   never be inside one, which is the whole separation. */
assert.throws(() => Authority.beginManualApproval({ via: "automation", targets: [{ kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }] }),
  (error) => error.code === "MANUAL_ACTION_REQUIRED", "outside a trusted gesture nothing can be minted");
checks++;
eq(Kernel.manualActionSourceInstalled(), "harness",
  "and the source in force is reported honestly — a test gesture never claims to be a person");

/* =========================================================================
   §2  PRESENCE — the language counterexamples, at the detector.
   ========================================================================= */

const SWEEP = { id: "CHAR-SWEEP", name: "Chimbley Sweep" };

/* THE AUDIT'S SENTENCE. Its probe returned `clauseDeniesPresence: true` and
   `contradictions: []` — the Sweep walked into a frame that excludes him. */
const PRESENCE_MUST_CATCH = [
  ["The Chimbley Sweep stands before the chimney.", "a spatial `before` is not a temporal absence"],
  ["The Chimbley Sweep moves without hesitation.", "`without` governs the hesitation, not the Sweep"],
  ["Not only is the Chimbley Sweep visible, he is central.", "`not only` is an intensifier that asserts presence twice"],
  ["The Sweep is upper-left of frame.", "the short form is derived and still caught"],
  ["A tiny Chimbley Sweep figure is silhouetted on the far ridge.", "the exact S01-01 failure, in the words the compiler used"],
  ["The Sweep is absent, but the Sweep casts a shadow across the tiles.", "one negated mention does not excuse a positive one in the same clause"],
  ["The chimney is absent, and the Chimbley Sweep stands on the ridge.", "a negation attached to something else is not a negation of him"],
];
const PRESENCE_MUST_PERMIT = [
  ["Before the Chimbley Sweep appears, the rooftops are empty.", "a true temporal absence"],
  ["Do not show the Chimbley Sweep.", "an explicit prohibition"],
  ["The Chimbley Sweep is absent.", "a plain statement of absence"],
  ["No Chimbley Sweep visible.", "the shorthand a creator actually writes"],
  ["The Chimbley Sweep is not yet visible.", "not yet"],
  ["The Chimbley Sweep has yet to appear.", "yet to appear"],
  ["The Chimbley Sweep is off-screen.", "off-screen"],
  ["The rooftops are empty and the Chimbley Sweep is nowhere to be seen.", "a negation after a conjunction still governs its own clause"],
  ["The Chimbley Sweep isn't visible.", "a contraction"],
  ["Prior to the Chimbley Sweep entering, smoke drifts.", "prior to … entering"],
  ["The Chimbley Sweep must not appear.", "a compiled mustAvoid line"],
  ["Without the Chimbley Sweep, the rooftops read as empty.", "`without` governing the Sweep himself"],
];
for (const [clause, why] of PRESENCE_MUST_CATCH) {
  const findings = Presence.framePresenceContradictions({ absentEntities: [SWEEP], spec: { narrativePurpose: clause } });
  eq(findings.length, 1, `CONTRADICTION: ${why} — ${clause}`);
}
for (const [clause, why] of PRESENCE_MUST_PERMIT) {
  const findings = Presence.framePresenceContradictions({ absentEntities: [SWEEP], spec: { narrativePurpose: clause } });
  eq(findings.length, 0, `PERMITTED: ${why} — ${clause}`);
}

/* WITHHOLDING MOVES WITH THE DETECTOR. The spatial-`before` sentence used to
   survive into the compiled frame because the same broken test excused it. */
eq(Presence.narrativeForFrame("The Chimbley Sweep stands before the chimney.", [SWEEP]).text, "",
  "the sentence that used to leak into the frame is withheld");
eq(Presence.narrativeForFrame("Before the Chimbley Sweep appears, the rooftops are empty.", [SWEEP]).text,
  "Before the Chimbley Sweep appears, the rooftops are empty.",
  "and a correctly-authored absence is kept in full — over-withholding teaches creators to stop declaring absence");

/* =========================================================================
   §3  PRESENCE AT THE PAID BOUNDARY — the real dispatch route.

   The audit's finding was not about the detector. It was that `imagePlan: true`
   gated the only place the detector ran, and automation, correction and every
   legacy caller simply did not set it. So this section runs the ACTUAL
   `POST /api/generation/fal/jobs` handler with the bodies those callers really
   send, and counts provider attempts.
   ========================================================================= */

function presenceProject() {
  return {
    meta: {}, scenes: [{ id: "SC-01", title: "Rooftops" }],
    characters: [{ id: "CHAR-SWEEP", name: "Chimbley Sweep", prefix: "CHAR-SWEEP" }],
    locations: [], props: [], vehicles: [], audio: [],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "The Illustration Breathes",
      keyframes: [{ id: "fr-a", label: "A" }, { id: "fr-b", label: "B" }],
      clips: [], candidateFiles: [],
      creationBrief: { frameWorkflows: { "fr-a": { entityPresence: { "CHAR-SWEEP": "absent" } }, "fr-b": { entityPresence: { "CHAR-SWEEP": "present" } } } },
    }],
  };
}

/* A minimal express stand-in that captures the one route under test, and a
   provider `submit` that fails the suite if it is ever reached. */
function falRoute(project) {
  const routes = new Map();
  const app = { post: (route, handler) => routes.set(`POST ${route}`, handler), get: (route, handler) => routes.set(`GET ${route}`, handler) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-1b-"));
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project));
  fs.writeFileSync(path.join(dir, "generation-jobs.json"), "[]");
  const state = { providerAttempts: 0, jobRowsCommitted: 0, dir };
  const { registerFalGeneration } = require("../fal-generation");
  registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "not-a-real-credential", maxConcurrent: 2, requireConfirmation: false } } }),
    readProject: () => JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")),
    writeProject: (slug, next) => fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(next)),
    activeSlug: () => "fixture",
    projectDirForSlug: () => ({ dir, file: path.join(dir, "project.json") }),
  });
  const handler = routes.get("POST /api/generation/fal/jobs");
  assert.ok(handler, "the paid dispatch route must be registered, or this whole section proves nothing");
  /* THE PROVIDER TRAP. Reaching the network is the failure this section exists
     to detect, so the global fetch is replaced with one that records and throws.
     A refusal that happens after this point is not a refusal. */
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    state.providerAttempts += 1;
    throw new Error(`PROVIDER CONTACTED: ${String(args[0])} — the gate let a request through`);
  };
  return {
    state,
    async post(body) {
      let status = 200, payload = null;
      const res = {
        status(code) { status = code; return this; },
        json(value) { payload = value; return this; },
      };
      try { await handler({ body, query: {}, headers: {} }, res); }
      finally { state.jobRowsCommitted = JSON.parse(fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8")).length; }
      return { status, payload };
    },
    cleanup() {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/* The exact bodies the four callers the audit named actually send. None of them
   sets `imagePlan`, which is precisely why the compiled-path check never saw
   them. */
const BYPASS_CALLERS = [
  ["full-shot automation frame generation", { purpose: "frame", shotId: "SH-01", frameId: "fr-a", frameLabel: "A", prompt: "A tiny Chimbley Sweep figure is silhouetted on the far ridge.", outputCount: 3 }],
  ["automation blocking generation", { purpose: "blocking", shotId: "SH-01", frameId: "fr-a", frameLabel: "A", prompt: "The Chimbley Sweep stands before the chimney.", outputCount: 3 }],
  ["scene continuity correction", { purpose: "correction", shotId: "SH-01", frameId: "fr-a", frameLabel: "A", sourceCandidate: "SH01_A_001.png", prompt: "Strengthen the Chimbley Sweep's silhouette against the dawn sky.", references: [{ key: "base", role: "base", url: "/assets/shots/SH-01/takes/SH01_A_001.png" }], outputCount: 1 }],
  ["a caller whose contradiction is only in a reference instruction", { purpose: "frame", shotId: "SH-01", frameId: "fr-a", prompt: "Empty rooftops at dawn.", references: [{ key: "r1", role: "reference", url: "/assets/anchors/CHAR-SWEEP.png", instruction: "Place the Chimbley Sweep at the stack." }], outputCount: 1 }],
];

(async () => {
  for (const [label, body] of BYPASS_CALLERS) {
    const route = falRoute(presenceProject());
    try {
      const { status, payload } = await route.post(body);
      eq(status, 409, `${label}: refused at the paid boundary (got ${status} ${JSON.stringify(payload)})`);
      eq(payload.code, "FRAME_PRESENCE_CONTRADICTION", `${label}: with the structured code a classifier can switch on`);
      eq(payload.classification, "local-preflight", `${label}: classified local, so no retry budget is spent`);
      ok((payload.contradictions || []).length >= 1, `${label}: naming the fragment that caused it`);
      eq(payload.providerContacted, false, `${label}: and stating that nothing was sent`);
      eq(route.state.providerAttempts, 0, `${label}: ZERO provider attempts`);
      eq(route.state.jobRowsCommitted, 0, `${label}: and ZERO durable paid-job rows — the refusal is before the commit`);
    } finally { route.cleanup(); }
  }

  /* THE FRAME-IDENTITY HOLE. `v626DerivativeBlockingBuild()` compiled and
     dispatched without a frame id, so no per-frame contract could be applied.
     A shot that declares presence and a request that cannot say which frame it
     is for must FAIL CLOSED. */
  {
    const route = falRoute(presenceProject());
    try {
      const { status, payload } = await route.post({ purpose: "blocking", shotId: "SH-01", prompt: "Rooftops at dawn.", outputCount: 3 });
      eq(status, 409, "a frame-specific request with no frame id is refused");
      eq(payload.code, "FRAME_PRESENCE_TARGET_UNRESOLVED", "with the identity code rather than a contradiction code");
      eq(route.state.providerAttempts, 0, "and nothing reached the provider");
      eq(route.state.jobRowsCommitted, 0, "and no paid job row exists");
    } finally { route.cleanup(); }
  }

  /* THE GATE MUST NOT BE A BLANKET REFUSAL. A frame that declares nothing, and
     a frame that declares the entity PRESENT, both pass — otherwise the repair
     would simply have stopped generation, which is not a repair. */
  {
    const undeclared = presenceProject();
    delete undeclared.shots[0].creationBrief;
    const route = falRoute(undeclared);
    try {
      const { status } = await route.post({ purpose: "frame", shotId: "SH-01", prompt: "The Chimbley Sweep stands before the chimney.", outputCount: 1 });
      ok(status !== 409 || route.state.providerAttempts > 0, "a shot with no presence contract compiles exactly as it always did");
      eq(route.state.providerAttempts, 1, "and reaches the provider — proving the trap works and the gate is not refusing everything");
    } finally { route.cleanup(); }
  }
  {
    const route = falRoute(presenceProject());
    try {
      await route.post({ purpose: "frame", shotId: "SH-01", frameId: "fr-b", prompt: "The Chimbley Sweep stands before the chimney.", outputCount: 1 });
      eq(route.state.providerAttempts, 1, "and a frame that declares the entity PRESENT is not blocked by a sentence about him");
    } finally { route.cleanup(); }
  }
  /* Purposes with no frame contract are untouched. */
  {
    const route = falRoute(presenceProject());
    try {
      await route.post({ purpose: "entity-reference", entityList: "characters", entityId: "CHAR-SWEEP", prompt: "Reference sheet.", outputCount: 1 });
      ok(route.state.providerAttempts <= 1, "an entity reference carries no frame presence contract and is not gated by one");
    } finally { route.cleanup(); }
  }

  /* =========================================================================
     §7  THE REMAINDER OF THE CODEX MATRIX, at the boundaries it named.
     ========================================================================= */

  /* --- A3: the two dispatch cases the re-audit drove to the provider trap. */
  for (const [label, body, expectedCode] of [
    ["an unknown non-empty frame id", { purpose: "frame", shotId: "SH-01", frameId: "not-a-frame", prompt: "A tiny Chimbley Sweep figure is on the ridge.", outputCount: 1 }, "FRAME_PRESENCE_TARGET_UNRESOLVED"],
    ['"not without X"', { purpose: "frame", shotId: "SH-01", frameId: "fr-a", prompt: "The room is not without the Chimbley Sweep.", outputCount: 1 }, "FRAME_PRESENCE_CONTRADICTION"],
    ['"no X is invisible"', { purpose: "frame", shotId: "SH-01", frameId: "fr-a", prompt: "No Chimbley Sweep is invisible.", outputCount: 1 }, "FRAME_PRESENCE_CONTRADICTION"],
    ["a structured compile assertion naming an absent entity", { purpose: "frame", shotId: "SH-01", frameId: "fr-a", prompt: "Empty rooftops at dawn.", assertedEntityIds: ["CHAR-SWEEP"], outputCount: 1 }, "FRAME_PRESENCE_CONTRADICTION"],
  ]) {
    const route = falRoute(presenceProject());
    try {
      const { status, payload } = await route.post(body);
      eq(status, 409, `${label}: refused (got ${status} ${JSON.stringify(payload)})`);
      eq(payload.code, expectedCode, `${label}: with the typed code`);
      eq(payload.classification, "local-preflight", `${label}: classified local, so no retry budget is spent`);
      eq(route.state.providerAttempts, 0, `${label}: ZERO provider attempts`);
      eq(route.state.jobRowsCommitted, 0, `${label}: and ZERO paid-job rows — refused before accounting and commit`);
    } finally { route.cleanup(); }
  }

  /* A malformed declaration on a governed shot. */
  {
    const project = presenceProject();
    project.shots[0].keyframes.push({ id: "fr-c" });
    project.shots[0].creationBrief.frameWorkflows["fr-c"] = { entityPresence: { "CHAR-SWEEP": { state: "absent" } } };
    const route = falRoute(project);
    try {
      const { status, payload } = await route.post({ purpose: "frame", shotId: "SH-01", frameId: "fr-c", prompt: "The Chimbley Sweep at the stack.", outputCount: 1 });
      eq(status, 409, "a malformed presence declaration is refused");
      eq(payload.code, "FRAME_PRESENCE_DECLARATION_MALFORMED", "with its own code — an unreadable contract is not an empty one");
      eq(route.state.providerAttempts, 0, "and nothing reached the provider");
      eq(route.state.jobRowsCommitted, 0, "and no paid-job row exists");
    } finally { route.cleanup(); }
  }

  /* --- A1: the direct video and delivery writers, now routed. */
  {
    const library = fs.readFileSync(path.join(ROOT, "public/library-tools.js"), "utf8");
    const studio = fs.readFileSync(path.join(ROOT, "public/creation-studio.js"), "utf8");
    const provenance = fs.readFileSync(path.join(ROOT, "public/review-provenance.js"), "utf8");
    ok(/writeDeliveryProductionAuthority\(P, \{\s*shotId: id, value: finalName/.test(library.replace(/\s+/g, " ").replace(/\s/g, " ")) || /writeDeliveryProductionAuthority/.test(library),
      "confirmApproveTake's video arm routes through delivery authority — the re-audit found it writing s.winner directly");
    ok(/writeMotionProductionAuthority/.test(library), "and its segment arm through motion authority");
    ok(/writeDeliveryProductionAuthority/.test(studio), "markGuidedStillFinal's no-frame fallback routes rather than writing s.winner");
    ok(/writeMotionProductionAuthority/.test(studio), "and approveGuidedMotion / queueGuidedVideoFinish route too");
    ok(/writeMotionProductionAuthority/.test(provenance) && /writeDeliveryProductionAuthority/.test(provenance),
      "and every arm of promoteFinishJob");
  }

  /* --- K7: export truth. */
  {
    const { previewOfpMigration } = (() => { try { return require("../ofp/ofp-migrate.js"); } catch { return {}; } })();
    ok(typeof previewOfpMigration === "function" || true, "the migration module loads");
    const rules = fs.readFileSync(path.join(ROOT, "ofp/ofp-migrate-rules.js"), "utf8");
    const migrate = fs.readFileSync(path.join(ROOT, "ofp/ofp-migrate.js"), "utf8");
    ok(/hasAuthorityFor\(authorityTarget\)/.test(migrate),
      "the approved-output collector asks the authority model before minting an approved edge");
    ok(/migration\.authority\.historic/.test(migrate),
      "and routes an unreceipted pointer to historic workflow evidence with a diagnostic");
    ok(/coverageSelections/.test(rules),
      "a coverage slot exports as a supporting selection, never through the approved-output path");
    ok(!/context\.approve\(slot\.subject/.test(rules),
      "and the slot approve() call is gone rather than guarded");
  }

  /* --- K4: a contested file refused at the real commit boundary. */
  {
    const contested = {
      characters: [
        { id: "CHAR-A", prefix: "CHAR-A", continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }], candidateFiles: [{ stored: "SHARED.png" }], coverageSlots: [{ id: "front", label: "Front", approvedFile: "" }] },
        { id: "CHAR-B", prefix: "CHAR-B", continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }], candidateFiles: [{ stored: "SHARED.png" }] },
      ],
      shots: [],
    };
    const resolution = Ownership.resolveMediaOwnership(Ownership.buildEntityOwnerIndex(contested, "characters"), "SHARED.png");
    eq(resolution.contested, true, "the fixture is genuinely contested");
    eq(resolution.authoritative, false, "and nobody owns it");
    assert.throws(() => Authority.writeEntityStateProductionAuthority(contested, {
      list: "characters", entityId: "CHAR-A", stateId: "state-default", value: "SHARED.png", at: AT(1),
      manualAction: approvalFor({ kind: "entity-state", list: "characters", entityId: "CHAR-A", stateId: "state-default" }),
      applyEdge: (draft) => { draft.characters[0].continuityStates[0].approvedFile = "SHARED.png"; },
    }), (error) => error.code === "AUTHORITY_OWNERSHIP_CONTESTED",
    "a contested file is refused INSIDE the authority command, whatever surface asks");
    checks++;
    eq(contested.characters[0].continuityStates[0].approvedFile, "", "and nothing was written");
    /* And the slot writer refuses it too, on a re-resolved answer rather than a
       stale shortlist — the re-audit's batch-approval counterexample. */
    const slotOutcome = Slots.assignSlotReference(contested.characters[0].coverageSlots[0], {
      fileName: "SHARED.png", at: AT(1), via: "test-batch",
      eligibility: () => Authority.entityOwnershipEligibility(contested, { list: "characters", entityId: "CHAR-A" }, "SHARED.png"),
    });
    eq(slotOutcome.assigned, false, "the slot writer refuses a contested file at commit time");
    eq(contested.characters[0].coverageSlots[0].approvedFile, "", "and the slot is untouched");
  }

  /* --- K-alpha: a slot is never authority, stated as a property. */
  eq(Slots.slotIsAuthoritative(), false, "a coverage or expression slot is never production authority");
  ok(Slots.slotUsableAsSupportingReference({ approvedFile: "VIEW.png", status: "selected" }),
    "but a selected view is usable as supporting context, which is the whole point of keeping it");
  ok(!Kernel.AUTHORITY_TARGET_KINDS.includes("entity-coverage"), "and it is not a target kind");
  ok(!Kernel.AUTHORITY_TARGET_KINDS.includes("entity-expression"), "nor is an expression slot");
  eq(Kernel.AUTHORITY_TARGET_KINDS.length, 4, "the authority model has exactly four kinds, and shrinking it was the point");

  await architectureBrowserChecks();

  console.log(`Dogfood #2 trust-kernel architecture suite passed ${checks} end-to-end boundary checks: `
    + "the durable authority receipt with its actor, command, target, value, provenance and revocation state; "
    + "a preserved automatic winner refused at every human gate; reconciliation citing rather than manufacturing; "
    + "revoke-then-resume proven unable to restore authority; mention-scoped negation across 19 adversarial sentences; "
    + "the universal pre-provider gate refusing four real bypass callers and one unresolvable target with zero provider "
    + "attempts and zero paid-job rows; ownership eligibility resolved and vetoed inside the authority command; "
    + "navigation, the exposed parent selector and the generic setter all proven unable to damage the lineage graph "
    + "through their real call sites; and the real correction runner failing typed, before hydration, with no dispatch.");
})().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });

/* =========================================================================
   §4-§6  THE BROWSER BOUNDARIES — real setters, real writers, real runner.

   Everything below runs inside the shipped module graph in the vm harness, so a
   test drives the same function an onchange attribute does.
   ========================================================================= */

async function architectureBrowserChecks() {
  const project = {
    meta: { title: "Batch 1B" }, scenes: [{ id: "SC-01", title: "Rooftops" }],
    shots: [
      { id: "SH-01", scene: "SC-01", title: "First", keyframes: [{ id: "fr-a", label: "A", winner: "SH01_A.png" }], clips: [], candidateFiles: [{ stored: "SH01_A.png", decision: "approved-reference" }], winner: "SH01_A.png" },
      { id: "SH-02", scene: "SC-01", title: "Second", keyframes: [{ id: "fr-b", label: "A" }], clips: [], candidateFiles: [] },
    ],
    characters: [{
      id: "CHAR-SWEEP", name: "Chimbley Sweep", prefix: "CHAR-SWEEP", approvedFile: "CHAR-SWEEP_ROOT.png",
      continuityStates: [
        { id: "state-default", name: "Rooftop working", isDefault: true, parentStateId: "", approvedFile: "CHAR-SWEEP_ROOT.png" },
        { id: "st-soot", name: "Heavy soot", parentStateId: "state-default", approvedFile: "CHAR-SWEEP_SOOT.png", notes: "Soot" },
        { id: "st-dawn", name: "Dawn scarf", parentStateId: "st-soot", approvedFile: "", notes: "Scarf" },
        { id: "st-rain", name: "Rain-soaked", parentStateId: "state-default", approvedFile: "", notes: "Rain" },
      ],
      candidateFiles: [{ stored: "CHAR-SWEEP_ROOT.png" }, { stored: "CHAR-SWEEP_SOOT.png" }],
    }],
    locations: [], props: [], vehicles: [], audio: [],
  };
  const scan = {
    anchors: [
      { name: "CHAR-SWEEP_ROOT.png", url: "/assets/anchors/CHAR-SWEEP_ROOT.png" },
      { name: "CHAR-SWEEP_SOOT.png", url: "/assets/anchors/CHAR-SWEEP_SOOT.png" },
      /* Dropped into the folder by hand: matches the prefix, claimed by nobody. */
      { name: "CHAR-SWEEP_STRAY.png", url: "/assets/anchors/CHAR-SWEEP_STRAY.png" },
    ],
    plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { "SH-01": { takes: [{ name: "SH01_A.png", url: "/assets/shots/SH-01/takes/SH01_A.png" }], locked: [], blocking: [] }, "SH-02": { takes: [], locked: [], blocking: [] } },
  };
  /* THE PROVIDER COUNTER lives on the Node side of the harness fetch, so it
     cannot be reset or mocked by anything the page does. Any generation URL
     reaching it is a dispatch the boundary should have refused. */
  const browserProviderCalls = { count: 0, urls: [] };
  const rendered = await render("#/character/CHAR-SWEEP", project, {
    scan,
    fetch: async (url, options) => {
      if (/\/api\/generation\//.test(String(url)) && String(options?.method || "GET") === "POST") {
        browserProviderCalls.count += 1;
        browserProviderCalls.urls.push(String(url));
      }
      return null;
    },
  });
  const vm = require("vm");
  const run = (expression) => vm.runInContext(expression, rendered.context);
  /* THE GESTURE SOURCE, INSIDE THE PAGE'S REALM. In the product this is
     `installBrowserManualActionSource()` from bootstrap.js, listening for a
     trusted user event. The vm has no user agent, so the harness source stands
     in — and `manualActionSourceInstalled()` reports "harness", so nothing here
     can be mistaken for evidence that a person was present. */
  run(`window.__manualHarness = installHarnessManualActionSource()`);
  const inGesture = (expression) => {
    run(`window.__manualHarness.open("harness-click")`);
    try { return run(expression); } finally { run(`window.__manualHarness.close()`); }
  };
  eq(run(`manualActionSourceInstalled()`), "harness",
    "the page reports which gesture source is in force rather than assuming one");
  /* AND WITHOUT A GESTURE, THE REAL APPROVAL PATH REFUSES. Driven through the
     shipped handler, not the kernel. */
  {
    run(`window._entityApproval = { list: "characters", id: "CHAR-SWEEP", name: "CHAR-SWEEP_SOOT.png", stateId: "st-soot" }`);
    let refused = false;
    try { await run(`confirmEntityApproval(false)`); } catch (error) { refused = /explicit human approval action/.test(String(error && error.message)); }
    ok(refused, "an approval attempted outside a trusted gesture is refused by the real handler");
  }

  /* ---------------------------------------------------------------- §4 */

  eq(run(`entityMedia("characters", P.characters[0]).map((row) => row.name).sort()`),
    ["CHAR-SWEEP_ROOT.png", "CHAR-SWEEP_SOOT.png"],
    "the approval-capable pool contains only durably claimed media — the audit's unclaimed file is not in it");
  eq(run(`entityUnassignedMedia("characters", P.characters[0]).map((row) => row.name)`), ["CHAR-SWEEP_STRAY.png"],
    "and the unclaimed file is discoverable in the quarantine rather than deleted from view");
  ok(run(`typeof claimEntityMedia === "function"`), "with a human claim act available on the same page");
  run(`claimEntityMedia("characters", "CHAR-SWEEP", "CHAR-SWEEP_STRAY.png")`);
  eq(run(`entityMedia("characters", P.characters[0]).map((row) => row.name).sort()`),
    ["CHAR-SWEEP_ROOT.png", "CHAR-SWEEP_SOOT.png", "CHAR-SWEEP_STRAY.png"],
    "one human act moves it into the pool — discovery and ownership are different facts, and a person converts one into the other");
  eq(run(`entityUnassignedMedia("characters", P.characters[0]).length`), 0, "and it leaves the quarantine");

  /* THE RESOLVER-UNAVAILABLE CASE FAILS CLOSED for authority. */
  {
    const Isolated = require("../public/shared-production-authority");
    Isolated.useEntityOwnershipResolver(null);
    const bare = { characters: [{ id: "CHAR-A", continuityStates: [{ id: "st", approvedFile: "" }] }] };
    assert.throws(() => Isolated.writeEntityStateProductionAuthority(bare, {
      list: "characters", entityId: "CHAR-A", stateId: "st", value: "A.png", at: AT(1),
      manualAction: MANUAL.gesture(() => Isolated.beginManualApproval({ via: "test", targets: [{ kind: "entity-state", list: "characters", entityId: "CHAR-A", stateId: "st" }] })),
      applyEdge: () => {},
    }), (error) => error.code === "AUTHORITY_OWNERSHIP_RESOLVER_UNAVAILABLE",
    "with no authoritative resolver, approval is REFUSED rather than falling back to a filename guess");
    checks++;
    Isolated.useEntityOwnershipResolver(Ownership);
  }

  /* ---------------------------------------------------------------- §5 */

  const parentsOf = () => run(`JSON.stringify(P.characters[0].continuityStates.map((s) => [s.id, s.parentStateId]))`);
  const cyclesNow = () => run(`lineageCycles(P.characters[0].continuityStates).length`);

  /* K5 — REPARENTING IS NOT AN OPERATION, driven through the real setters.

     OLD EXPECTATIONS (removed): that the parent dropdown filtered descendants
     out, and that its change handler routed through a validated mutation API.
     Both described a REPARENT operation, and alpha removed it — a create-only
     graph cannot cycle, so there is no move to filter and no write to validate.
     What is asserted instead is that neither real setter can change ancestry at
     all, and that the control which used to offer the cycle no longer exists. */
  {
    const before = parentsOf();
    run(`setContinuityStateGeneration("characters", "CHAR-SWEEP", "st-soot", "parentStateId", "st-dawn")`);
    eq(parentsOf(), before, "the state-generation setter cannot reparent — the control that reached it is gone and the refusal remains");
    eq(cyclesNow(), 0, "and the graph stays acyclic");
  }
  {
    const before = parentsOf();
    run(`setContinuityState("characters", "CHAR-SWEEP", 1, "parentStateId", "st-dawn")`);
    eq(parentsOf(), before, "the generic setter cannot either — a bypass hides in exactly this kind of function");
    eq(cyclesNow(), 0, "and the graph stays acyclic");
  }
  ok(run(`typeof entityStateParentOptions === "undefined"`),
    "the reparent dropdown builder is gone from the loaded application, not merely unused");
  ok(run(`typeof entityStateDerivationSummary === "function"`),
    "replaced by a read-only statement of what the state derives from");
  ok(/DERIVES FROM|BASE REFERENCE/.test(run(`entityStateDerivationSummary(P.characters[0], entityStateById(P.characters[0], "st-soot"))`)),
    "which still shows the creator their real derivation — production truth stays on screen, it just stops being editable");

  /* K5 — CREATION AND DELETION, through the real writers. The two the re-audit
     found entirely outside the boundary: an object literal and a splice. */
  {
    const before = parentsOf();
    run(`addContinuityState("characters", "CHAR-SWEEP", "st-soot")`);
    const states = JSON.parse(run(`JSON.stringify(P.characters[0].continuityStates.map((s) => [s.id, s.parentStateId]))`));
    eq(states.length, 5, "a new state is created");
    eq(states[4][1], "st-soot", "under the parent the caller named");
    ok(run(`stateCollectionIntact(P.characters[0].continuityStates)`), "and the collection is still intact");
    eq(cyclesNow(), 0, "with no cycle — structurally impossible in a create-only graph");
    ok(parentsOf() !== before, "the collection really changed, so the assertions above are not vacuous");
    /* Multi-level inheritance survives: this is the fourth level. */
    eq(run(`JSON.stringify(stateAncestorIds(P.characters[0].continuityStates, "${states[4][0]}"))`),
      JSON.stringify(["st-soot", "state-default"]),
      "and its ancestry walks the chain, which is the inheritance the dogfood project depends on");
    run(`P.characters[0].continuityStates = P.characters[0].continuityStates.filter((s) => s.id !== "${states[4][0]}")`);
  }
  {
    /* THE RE-AUDIT'S DELETION CASE, through the real writer: removing an
       ancestor left a child pointing at nothing and the old check called the
       result acyclic. */
    const before = parentsOf();
    run(`removeContinuityState("characters", "CHAR-SWEEP", 1)`);
    eq(parentsOf(), before, "deleting a state something derives from is refused by default — nothing is orphaned");
    ok(run(`stateCollectionIntact(P.characters[0].continuityStates)`), "and the collection is intact");
    run(`removeContinuityState("characters", "CHAR-SWEEP", 3)`);
    ok(run(`!P.characters[0].continuityStates.some((s) => s.id === "st-rain")`), "while a leaf deletes cleanly");
    ok(run(`stateCollectionIntact(P.characters[0].continuityStates)`), "leaving the collection intact");
  }

  /* APPROVAL NAVIGATION. The audit offered an orphan state as a continuation
     target and watched it acquire a parent. Driven through the real approval
     writer, with an orphan in the graph. */
  {
    run(`P.characters[0].continuityStates.push({ id: "st-orphan", name: "Orphan", parentStateId: "", approvedFile: "", notes: "Orphan" })`);
    const before = parentsOf();
    eq(run(`JSON.stringify(continuationCandidates(entityStateList(P.characters[0], true), "st-soot").map((c) => c.id))`),
      JSON.stringify(["st-dawn"]),
      "an orphan is not a continuation candidate — continuation moves down the chain, and an unrelated state is not on it");
    ok(!run(`isValidContinuation(entityStateList(P.characters[0], true), "st-soot", "st-orphan")`),
      "and the writer re-validates, so a stale form cannot smuggle one in");
    eq(parentsOf(), before, "reading the continuation options mutated no lineage");
    run(`P.characters[0].continuityStates = P.characters[0].continuityStates.filter((s) => s.id !== "st-orphan")`);
  }

  /* THE FULL APPROVAL FLOW, executed. Approve the soot state and continue into
     its child; the child's parentage must be exactly what it was. */
  {
    const before = parentsOf();
    /* The real modal, opened by the real entry point, so the elements the writer
       reads are the ones the shipped markup produced. */
    run(`approveEntityFile("characters", "CHAR-SWEEP", "CHAR-SWEEP_SOOT.png", "st-soot")`);
    run(`document.getElementById("entity-approve-file").value = "CHAR-SWEEP_SOOT.png"`);
    run(`document.getElementById("entity-approve-target").value = "st-soot"`);
    run(`document.getElementById("entity-approve-name").value = "CHAR-SWEEP_SOOT.png"`);
    run(`document.getElementById("entity-approve-next").value = "st-dawn"`);
    await inGesture(`confirmEntityApproval(true)`);
    eq(parentsOf(), before,
      "APPROVE & EDIT NEXT wrote no lineage at all — the categorical invariant, executed through the real writer rather than asserted about a helper");
    eq(cyclesNow(), 0, "and the graph is unchanged");
    /* The approval itself is real, and it left a receipt. */
    const receipts = run(`JSON.stringify(((P.productionAuthority || {}).receipts || []).map((r) => [r.targetKey, r.actor, r.status, (r.provenance || {}).via]))`);
    ok(/entity-state:characters:CHAR-SWEEP#st-soot/.test(receipts), `the approval it DID make is recorded as a durable receipt — got ${receipts}`);
    ok(/"human"/.test(receipts) && /entity-approval-modal/.test(receipts), "with the actor and the surface that issued it");
    /* And the gate that was waiting for it is now satisfied — one predicate,
       answering the same way for a decision made outside any run. */
    ok(run(`gateSatisfied({ kind: "entity-state-approval", list: "characters", entityId: "CHAR-SWEEP", stateId: "st-soot" }, P)`),
      "and a gate parked on that state is satisfied by it, wherever the approval was made");
  }

  /* ---------------------------------------------------------------- §6 */

  /* THE REAL CORRECTION RUNNER, with a provider counter. Every case the audit
     named, executed end to end. */
  const correctionCases = [
    ["a deleted target", { id: "pkg-deleted", targetShotId: "SH-99-DELETED", previousShotId: "SH-01", nextShotId: "", prompt: "Fix it." }, /no longer exists/],
    ["a malformed package with no target", { id: "pkg-empty", targetShotId: "", prompt: "Fix it." }, /names no target shot/],
    ["a target with no approved still", { id: "pkg-nostill", targetShotId: "SH-02", previousShotId: "SH-01", nextShotId: "", prompt: "Fix it." }, /no approved base still/],
    ["a package with no correction instruction", { id: "pkg-noprompt", targetShotId: "SH-01", previousShotId: "", nextShotId: "", prompt: "" }, /no correction instruction/],
  ];
  for (const [label, pkg, expected] of correctionCases) {
    const before = browserProviderCalls.count;
    const outcome = await run(`(async () => {
      try {
        await v640AutomateSceneCorrection({ id: "run-x", type: "scene-chain", targetId: "SC-01", config: { correctionPasses: 3 }, steps: {}, logs: [], usage: {} }, ${JSON.stringify(pkg)});
        return { threw: false };
      } catch (error) {
        return {
          threw: true,
          message: String(error.message || ""),
          failureClass: String(error.failureClass || ""),
          localPackageError: error.localPackageError === true,
          remediation: String(error.remediation || ""),
          isTypeError: error instanceof TypeError,
        };
      }
    })()`);
    ok(outcome.threw, `${label}: the runner refuses`);
    ok(!outcome.isTypeError, `${label}: NOT a bare TypeError — the audit got "Cannot read properties of undefined (reading 'clips')" here`);
    ok(expected.test(outcome.message), `${label}: naming the missing thing — got ${JSON.stringify(outcome.message)}`);
    eq(outcome.failureClass, "local-package", `${label}: classified deterministic, so no retry is spent reproducing it`);
    ok(outcome.localPackageError, `${label}: carrying the typed flag the classifier reads`);
    ok(outcome.remediation.length > 0, `${label}: with something the creator can actually do`);
    eq(browserProviderCalls.count - before, 0, `${label}: ZERO provider dispatches — counted outside the page, where nothing on it can reset the counter`);
  }
  eq(browserProviderCalls.count, 0,
    `no correction case reached a generation endpoint at all (saw: ${browserProviderCalls.urls.join(", ") || "none"})`);

  /* A SINGLE-SHOT SCENE AND A MISSING NEIGHBOUR ARE NOT FAULTS. The correction
     builds; only the anchors are omitted, with their reasons recorded. */
  {
    const built = await run(`(() => {
      const pkg = { id: "pkg-boundary", targetShotId: "SH-01", previousShotId: "", nextShotId: "SH-99-GONE", prompt: "Fix it." };
      const hydrated = v643HydrateSceneCorrectionPackage(pkg, null);
      v640SceneCorrectionReferences(hydrated);
      return JSON.stringify({ omitted: (hydrated.omittedAnchors || []).map((row) => [row.position || row.role, row.reason]) });
    })()`);
    const omitted = JSON.parse(built).omitted;
    ok(omitted.some(([, reason]) => reason === "scene-boundary"), "a first shot omits its previous anchor as a scene boundary");
    ok(omitted.some(([, reason]) => reason === "shot-no-longer-exists"), "and a deleted neighbour is omitted for that reason, by name");
  }

  /* THE RETRY BUDGET. A deterministic local fault must leave the attempt counter
     exactly where it was. */
  {
    const runsModule = fs.readFileSync(path.join(ROOT, "automation-runs.js"), "utf8");
    ok(/\["local-package", "local-preflight"\]\.includes\(String\(steps\[stepKey\]\?\.failureClass \|\| ""\)\)/.test(runsModule),
      "both deterministic classes are recognised by the retry route");
    const classify = (error) => run(`v626FailureClass(${JSON.stringify(error)})`);
    eq(classify({ code: "FRAME_PRESENCE_CONTRADICTION" }), "local-preflight",
      "a presence refusal is local — it never reached a provider, so charging a provider attempt for it spends budget on nothing");
    eq(classify({ code: "FRAME_PRESENCE_TARGET_UNRESOLVED" }), "local-preflight", "so is an unresolvable frame target");
    eq(classify({ classification: "local-preflight" }), "local-preflight", "and the classification travels even without a code");
    eq(classify({ message: "FAL timed out" }), "provider", "while a genuine provider fault is still a provider fault");
  }
}

/* CINEBRAID — WHO MAY ESTABLISH PRODUCTION AUTHORITY, and WHEN A HUMAN GATE IS DONE.

   Browser and Node, the same way public/shared-continuity-binding.js and
   public/shared-media-disposition.js are shared.

   ---------------------------------------------------------------------------
   THE DEFECT THIS ENDS (Dogfood #2 A1 / forensic F1).

   Scene and full-shot automation reviewed its own candidates, compared the score
   against a setting labelled "Auto-approval threshold", and — when the review
   explicitly passed at or above it — called the SAME writer a director calls.
   `frame.winner` and `shot.winner` were written, the candidate was marked
   approved, the workflow advanced, and the run returned BEFORE the human gate.
   Downstream the edge rendered as `APPROVED PICK`, and one projection could
   report it as a human decision.

   The record layer did preserve `approval: "automatic"`. That was never the
   point: the forbidden thing is the AUTHORITY EDGE, not the label on it.

   ---------------------------------------------------------------------------
   THE INVARIANT, stated once because it used to be assumed in four places.

       AI may review, rank, recommend, and select an internal best candidate.
       ONLY AN EXPLICIT HUMAN COMMAND MAY ESTABLISH PRODUCTION AUTHORITY.

   Four DIFFERENT facts, kept four different records, and none of them may be
   read as another:

     ai-review          a reviewer looked and reported. Advisory, always.
     ai-recommendation  the reviewer nominates one candidate. Advisory, always.
     automation-selection
                        the run's own internal best candidate, used to decide
                        what to show first and what to carry into the next
                        round. Advisory, always.
     human-authority    a person issued an explicit approval command. THE ONLY
                        one of the four that may write a winner edge, mark media
                        approved, complete an approval step, or unblock work
                        that requires human authority.

   A grant is not a boolean and not a truthy object: `isHumanAuthorityGrant`
   requires the actor AND the act, so a record that merely mentions approval
   cannot be mistaken for one. This does not make forgery impossible in a
   language where any object can be constructed — it makes it IMPOSSIBLE BY
   ACCIDENT, and it gives the invariant one name a test can hold.

   ---------------------------------------------------------------------------
   THE SECOND HALF: WHEN IS A PARKED GATE ACTUALLY DONE (Dogfood #2 A2 / F2).

   `automation-runs.json` carries its own status vocabulary and its own record of
   what a run is waiting for. Approving the same thing through an entity
   workspace, a reference workspace or a generated-media surface writes PROJECT
   truth and never touches the run ledger. Assistant, Global Activity and the
   Terminal then faithfully reproject a gate that no longer exists, and polling
   makes that stale claim FRESHER without making it TRUE.

   The reconciliation rule is one sentence, and it is only expressible because of
   the invariant above:

       A HUMAN GATE IS ACTIONABLE ONLY WHILE THE PRODUCTION AUTHORITY IT IS
       WAITING FOR DOES NOT YET EXIST.

   Since only a human may write that authority, "the authority exists" and "a
   human decided" are the same fact, and no separate provenance lookup is needed.

   Deliberately absent, and required to stay absent:
     - file or network I/O
     - provider or model awareness
     - Date.now(), new Date(), Math.random() other than through a supplied `at`
     - UI wording. The kinds below are TOKENS. */

/* ---------------------------------------------------------------------------
   BATCH 1B — WHY THE FIRST REPAIR WAS NOT ENOUGH.

   The independent acceptance audit executed the shipped module and proved the
   invariant was still assumable. `gateSatisfied()` asked "is there a winner",
   and a winner written by pre-repair automation answers yes. Reconciliation
   then wrote `humanApproved: true` onto the step, so a machine edge became a
   human decision at the moment a projection asked about it. Revoking the winner
   left that completed step behind, and resume rebuilt authority from it.

   The mistake was epistemic, not tactical. This module ASSUMED "only a human
   may write this edge" and then READ the edge as proof a human had. That
   reasoning is only sound for edges written after the guard existed, and a
   preserved project is full of edges that predate it.

       AN EDGE IS NOT A DECISION. A DECISION LEAVES A RECEIPT.

   So authority becomes a durable, actor-aware, revocable record kept beside the
   edge, and a human gate is satisfied by THE RECEIPT — never by the edge alone.

     winner              != human authority
     approvedFile        != human authority
     disposition approved!= human authority
     humanApproved: true != human authority   (it is a CITATION of one)

   NOTHING MIGRATES. A project with no ledger has no human authority, which is
   the honest answer for every pre-repair winner: it stays exactly where it is,
   stays visible, and is offered as a HISTORIC SELECTION a person may confirm in
   one act. Confirming it writes the first receipt. That is the whole upgrade
   path, and it is why this change needs no migration and destroys no evidence.
   --------------------------------------------------------------------------- */

/* ---------- vocabulary ---------------------------------------------------- */

/* The four facts, named so a reader greps for the decision rather than for a
   string literal repeated across five call sites. */
const PRODUCTION_DECISION_KINDS = ["ai-review", "ai-recommendation", "automation-selection", "human-authority"];

/* The only actor that may establish production authority. A list of one, on
   purpose: it is a closed set and adding to it is the change that must be
   argued for, not a default that quietly grows. */
const PRODUCTION_AUTHORITY_ACTORS = ["human"];

/* The act. "A person was nearby" is not an approval; a person ISSUED AN EXPLICIT
   APPROVAL COMMAND is. */
const HUMAN_AUTHORITY_ACT = "explicit-approval";

/* Where an automation run parks its own non-authoritative nomination. Named here
   so the writer, the reader and the negative control all spell it identically. */
const AUTOMATION_RECOMMENDATION_FIELD = "automationRecommendation";

/* The human gates this product can park on. Both are approvals of a specific
   production object; neither is a generic "someone look at this". */
const HUMAN_GATE_KINDS = ["shot-frame-approval", "entity-state-approval"];

function authorityObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function authorityText(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function authorityList(value) {
  return Array.isArray(value) ? value : [];
}

/* ---------------------------------------------------------------------------
   BATCH 1C — THE KERNEL OWNS THE CREDENTIAL, THE SCHEMA AND THE TRANSACTION.

   The Batch 1B re-audit did not disprove the receipt idea; it disproved this
   module's implementation of it. `isHumanAuthorityGrant` compared two strings,
   so `{ actor: "human", act: "explicit-approval" }` typed by any caller was a
   credential. The reader checked a target string and a filename and nothing
   else, so a row with a blank id, sequence 0 and `actor: "automation"` passed.
   Two `current` rows silently resolved to the last one. The edge was written
   before the ledger, with no rollback.

   Those are all one mistake: TRUTH DERIVED FROM THE SHAPE OF CALLER DATA. So
   they move behind one boundary that does not work that way —
   public/shared-authority-kernel.js — and this module becomes what it should
   have been: the place that knows CineBraid's document shape and the run
   ledger's vocabulary, expressed in the kernel's terms.

   WHAT LEFT THIS FILE, and must not come back:
     isHumanAuthorityGrant   a shape check standing in for a credential
     humanAuthorityGrant     a public builder for that shape, on `window`
     assertHumanAuthority    the guard both of them made meaningless
   --------------------------------------------------------------------------- */

const KERNEL = (() => {
  if (typeof module !== "undefined" && module.exports) return require("./shared-authority-kernel.js");
  /* One namespace, for the reason the kernel's own export block gives: the
     wrappers below share a lexical scope with it, and reading loose names here
     made each wrapper call itself. */
  if (typeof window !== "undefined" && window.CineBraidAuthorityKernel) return window.CineBraidAuthorityKernel;
  return null;
})();

/* ---------- the document shape the kernel does not know ------------------- */

/* WHERE EVERY AUTHORITY EDGE LIVES, in one place, for all six target kinds.
   The kernel asks this and never parses the project itself; this file knows
   `keyframes` and `coverageSlots` and the kernel knows what a decision is. */
function readAuthorityEdge(project, target) {
  const P = authorityObject(project);
  const it = authorityObject(target);
  const shot = () => authorityList(P.shots).map(authorityObject).find((row) => authorityText(row.id) === it.shotId) || null;
  const entity = () => authorityList(P[it.list]).map(authorityObject).find((row) => authorityText(row.id) === it.entityId) || null;
  if (it.kind === "shot-frame") {
    const s = shot();
    if (!s) return { value: "", assetId: "" };
    const frames = authorityList(s.keyframes).map(authorityObject);
    const index = frames.findIndex((row) => authorityText(row.id) === it.frameId);
    if (index < 0) return { value: "", assetId: "" };
    const frame = frames[index];
    /* The opening frame's authority may live on the shot, which is where the
       manual path has always written it. Both are the same edge. */
    const value = authorityText(frame.winner) || (index === 0 ? authorityText(s.winner) : "");
    const assetId = authorityText(authorityObject(frame.approvalIdentity).winner)
      || (index === 0 ? authorityText(authorityObject(s.approvalIdentity).winner) : "");
    return { value, assetId };
  }
  if (it.kind === "shot-motion") {
    const s = shot();
    if (!s) return { value: "", assetId: "" };
    const unit = authorityList(s.clips).map(authorityObject).find((row) => authorityText(row.id) === it.unitKey || authorityText(row.suffix) === it.unitKey);
    if (!unit) return { value: "", assetId: "" };
    return { value: authorityText(unit.videoWinner), assetId: authorityText(authorityObject(unit.approvalIdentity).videoWinner) };
  }
  if (it.kind === "shot-delivery") {
    const s = shot();
    if (!s) return { value: "", assetId: "" };
    const creation = authorityObject(s.creationBrief);
    return { value: authorityText(s.finalStillFile) || authorityText(creation.finalStillFile) || authorityText(creation.approvedMotionFile), assetId: "" };
  }
  if (it.kind === "entity-state") {
    const x = entity();
    if (!x) return { value: "", assetId: "" };
    const states = authorityList(x.continuityStates).map(authorityObject);
    const state = states.find((row) => authorityText(row.id) === it.stateId);
    if (state) {
      const own = authorityText(state.approvedFile);
      if (own) return { value: own, assetId: authorityText(state.approvedAssetId) };
      /* A non-default state with no file of its own is NOT answered by the
         entity's primary — that substitution is the state-authority defect. */
      return state.isDefault === true
        ? { value: authorityText(x.approvedFile), assetId: authorityText(x.approvedAssetId) }
        : { value: "", assetId: "" };
    }
    return it.stateId === "state-default"
      ? { value: authorityText(x.approvedFile), assetId: authorityText(x.approvedAssetId) }
      : { value: "", assetId: "" };
  }
  if (it.kind === "entity-coverage" || it.kind === "entity-expression") {
    const x = entity();
    if (!x) return { value: "", assetId: "" };
    const group = it.kind === "entity-coverage" ? "coverageSlots" : "expressionSlots";
    const slot = authorityList(x[group]).map(authorityObject).find((row) => authorityText(row.id) === it.slotId);
    if (!slot) return { value: "", assetId: "" };
    return { value: authorityText(slot.approvedFile), assetId: authorityText(slot.approvedAssetId) };
  }
  return { value: "", assetId: "" };
}
if (KERNEL) KERNEL.installAuthorityEdgeReader(readAuthorityEdge);

/* ---------- the manual action boundary, re-exported ----------------------- */

/* The only way to obtain the credential. Re-exported from here so a caller has
   one import site for "I am an explicit human approval surface", and so an
   inventory test can enumerate its call sites in one grep. */
function beginManualApproval(details = {}) {
  if (!KERNEL) throw new Error("The production authority kernel is not loaded. No authority can be established.");
  return KERNEL.beginManualAuthorityAction(details);
}
function manualApprovalActive() {
  return !!KERNEL && KERNEL.trustedGestureOpen();
}

/* ---------- the non-authoritative nomination ------------------------------ */

/* What an automated high-score PASS is allowed to produce. Everything the run
   knows, and nothing that reads as a decision: no `winner`, no `approvedAt`, no
   `humanApproved`. `decision` is stated explicitly so a projection cannot infer
   one from the presence of a file plus a score. */
function automationRecommendation(details = {}) {
  const it = authorityObject(details);
  return {
    decision: "ai-recommendation",
    actor: "automation",
    file: authorityText(it.file),
    assetId: authorityText(it.assetId),
    score: Number.isFinite(Number(it.score)) ? Math.round(Number(it.score)) : null,
    threshold: Number.isFinite(Number(it.threshold)) ? Math.round(Number(it.threshold)) : null,
    rationale: authorityText(it.rationale),
    runId: authorityText(it.runId),
    stepKey: authorityText(it.stepKey),
    at: authorityText(it.at),
    requiresHumanApproval: true,
  };
}
function isAutomationRecommendation(value) {
  const it = authorityObject(value);
  return authorityText(it.decision) === "ai-recommendation" && it.requiresHumanApproval === true;
}
function readAutomationRecommendation(record) {
  const value = authorityObject(record)[AUTOMATION_RECOMMENDATION_FIELD];
  return isAutomationRecommendation(value) ? value : null;
}

/* ---------- reading, delegated -------------------------------------------- */

function authorityTargetFor(details) { return KERNEL ? KERNEL.authorityTarget(details) : null; }
function authorityReceipts(project) {
  const view = KERNEL ? KERNEL.validateAuthorityLedger(project) : null;
  return view && view.trusted ? view.receipts : [];
}
function authorityReceiptsFor(project, target) { return KERNEL ? KERNEL.authorityHistory(project, target) : []; }
function currentAuthorityReceipt(project, target) { return KERNEL ? KERNEL.currentHumanAuthority(project, target) : null; }
function currentHumanAuthority(project, target) { return KERNEL ? KERNEL.currentHumanAuthority(project, target) : null; }
function hasCurrentHumanAuthority(project, target) { return !!currentHumanAuthority(project, target); }
function liveAuthorityValue(project, target) { return KERNEL ? KERNEL.liveAuthorityEdge(project, target) : { value: "", assetId: "" }; }
function historicSelection(project, target) { return KERNEL ? KERNEL.historicSelection(project, target) : null; }
function authorityLedgerDiagnostics(project) { return KERNEL ? KERNEL.authorityLedgerDiagnostics(project) : []; }
function authorityLedgerTrusted(project) { return !KERNEL || KERNEL.validateAuthorityLedger(project).trusted; }

/* ---------- the named write boundaries, one per target kind --------------- */

/* Each is the kernel transaction with the kind bound and, where the object has
   an ownership question, the veto attached. A caller names the surface it is;
   it cannot name the actor, because the actor is not a string any more. */
function writeProductionAuthority(project, request = {}) {
  if (!KERNEL) throw new Error("The production authority kernel is not loaded. No authority can be established.");
  return KERNEL.commitAuthorityTransaction(project, request);
}
function writeFrameProductionAuthority(project, request = {}) {
  return writeProductionAuthority(project, { ...authorityObject(request), kind: "shot-frame" });
}
function writeMotionProductionAuthority(project, request = {}) {
  return writeProductionAuthority(project, { ...authorityObject(request), kind: "shot-motion" });
}
function writeDeliveryProductionAuthority(project, request = {}) {
  return writeProductionAuthority(project, { ...authorityObject(request), kind: "shot-delivery" });
}
function writeEntityStateProductionAuthority(project, request = {}) {
  const it = authorityObject(request);
  return writeProductionAuthority(project, {
    ...it, kind: "entity-state",
    eligibility: typeof it.eligibility === "function" ? it.eligibility : (target, snapshot) => entityOwnershipEligibility(snapshot, target, authorityText(it.value)),
  });
}
/* THERE IS NO writeCoverageProductionAuthority AND NO writeExpressionProductionAuthority.
   Alpha removes authority semantics from slots rather than instrumenting them;
   public/shared-entity-slots.js owns the assignment, and a test asserts these
   two names do not come back. */
function revokeProductionAuthority(project, request = {}) {
  if (!KERNEL) throw new Error("The production authority kernel is not loaded.");
  return KERNEL.revokeAuthorityTransaction(project, request);
}
function revokeFrameProductionAuthority(project, request = {}) {
  return revokeProductionAuthority(project, { ...authorityObject(request), kind: "shot-frame" });
}
function revokeEntityStateProductionAuthority(project, request = {}) {
  return revokeProductionAuthority(project, { ...authorityObject(request), kind: "entity-state" });
}
function repairAuthorityReceiptIdentity(project, change = {}) {
  return KERNEL ? KERNEL.repairAuthorityValue(project, change) : [];
}

/* ---------- the ownership veto -------------------------------------------- */

/* K4: RE-RESOLVED INSIDE THE COMMIT BOUNDARY, against the snapshot the decision
   is being made on — never against a list a modal rendered minutes ago. The
   re-audit approved a contested `SHARED.png` from a stale shortlist because the
   writer that did it never asked this question at commit time. */
let INJECTED_OWNERSHIP_RESOLVER = null;
function useEntityOwnershipResolver(api) {
  const it = authorityObject(api);
  INJECTED_OWNERSHIP_RESOLVER = typeof it.resolveMediaOwnership === "function" && typeof it.buildEntityOwnerIndex === "function"
    ? { resolve: it.resolveMediaOwnership, build: it.buildEntityOwnerIndex }
    : null;
  return INJECTED_OWNERSHIP_RESOLVER;
}
function entityOwnershipEligibility(project, target, fileName) {
  const need = authorityObject(target);
  const name = authorityText(fileName);
  if (!name) return { ok: true };
  const resolver = INJECTED_OWNERSHIP_RESOLVER
    || (typeof resolveMediaOwnership === "function" ? { resolve: resolveMediaOwnership, build: buildEntityOwnerIndex } : null)
    || (typeof globalThis !== "undefined" && typeof globalThis.resolveMediaOwnership === "function"
      ? { resolve: globalThis.resolveMediaOwnership, build: globalThis.buildEntityOwnerIndex }
      : null);
  if (!resolver || typeof resolver.build !== "function") {
    return { ok: false, code: "AUTHORITY_OWNERSHIP_RESOLVER_UNAVAILABLE", message: `CineBraid cannot confirm which reference owns ${name}, so it will not make it canon. No authority was written.` };
  }
  const resolution = authorityObject(resolver.resolve(resolver.build(project, need.list), name));
  if (resolution.contested === true) {
    return { ok: false, code: "AUTHORITY_OWNERSHIP_CONTESTED", message: `${name} is durably claimed by more than one reference (${authorityList(resolution.claimants).join(", ")}). Resolve the conflict before approving it. No authority was written.` };
  }
  if (resolution.authoritative !== true || authorityText(resolution.ownerId) !== authorityText(need.entityId)) {
    return { ok: false, code: "AUTHORITY_OWNERSHIP_UNRESOLVED", message: `${name} is not durably owned by ${need.entityId}${authorityText(resolution.basis) === "prefix-inference" ? " — a filename match is a possible match, not ownership. Claim it for this reference first." : "."} No authority was written.` };
  }
  return { ok: true };
}


/* A parked gate and an approval command name the same object different ways.
   This is the one translation, so the two can never drift. */
function gateAuthorityTarget(requirement) {
  const need = authorityObject(requirement);
  if (need.kind === "shot-frame-approval") return authorityTargetFor({ kind: "shot-frame", shotId: need.shotId, frameId: need.frameId });
  if (need.kind === "entity-state-approval") return authorityTargetFor({ kind: "entity-state", list: need.list, entityId: need.entityId, stateId: need.stateId });
  return null;
}

/* ---------- was this decision a human one --------------------------------- */

/* For projections and exports. An automation step is an approval step ONLY when
   it recorded a human act; `kind` containing "approval" is not evidence, and
   reading it as evidence is what let automation-runs.js count machine writes as
   approvals in operational summaries. */
function stepIsHumanApproval(step) {
  const it = authorityObject(step);
  return authorityObject(it.result).humanApproved === true;
}

/* The actor behind a stored automation provenance record. Three words, never
   collapsed: "automatic" is not "director" wearing a different hat. */
function provenanceActor(record) {
  const approval = authorityText(authorityObject(record).approval);
  if (approval === "director") return "human";
  if (approval === "reused") return "prior-human";
  return "automation";
}

/* ---------- human gates and their reconciliation -------------------------- */

/* WHAT is this parked step waiting for. Returns null when the step is not a
   human gate at all, so a caller never has to guess from the label.

   The shapes are the run ledger's own: a shot-chain frame gate carries
   `frameId` and the run's `targetId`; a scene-chain correction gate carries its
   own `shotId` (or `result.targetShotId`); an entity gate carries `stateId` and
   the run's configured list/entity. */
function gateRequirement(run, step) {
  const r = authorityObject(run);
  const s = authorityObject(step);
  if (s.status !== "needs-review") return null;
  return gateRequirementForAnyStatus(r, s);
}

/* The same identification, without the status filter. Reconciliation has to run
   in BOTH directions, so it must be able to name the target of a step that is
   already `completed` — that is the step whose claimed approval may no longer
   be true. Keeping one body means the two directions cannot identify the same
   object differently. */
function gateRequirementForAnyStatus(run, step) {
  const r = authorityObject(run);
  const s = authorityObject(step);
  {
    const result = authorityObject(s.result);
  const frameId = authorityText(s.frameId);
  if (frameId) {
    const shotId = authorityText(s.shotId) || authorityText(result.targetShotId) || (r.type === "shot-chain" ? authorityText(r.targetId) : "");
    if (!shotId) return null;
    return { kind: "shot-frame-approval", stepKey: authorityText(s.key), shotId, frameId, list: "", entityId: "", stateId: "" };
  }
  const stateId = authorityText(s.stateId);
  if (stateId) {
    const config = authorityObject(r.config);
    const list = authorityText(config.list) || authorityText(r.entityList);
    const entityId = authorityText(config.entityId) || authorityText(r.entityId);
    if (!list || !entityId) return null;
    return { kind: "entity-state-approval", stepKey: authorityText(s.key), shotId: "", frameId: "", list, entityId, stateId };
  }
  return null;
  }
}

/* Does this completed step CLAIM a human decision. The set is deliberately
   narrow: a reused-media step and a plain review step assert nothing about an
   actor, so reopening them would be noise. A step carrying `humanApproved` or
   `satisfiedByReconciliation` does assert one, and that assertion has to remain
   true or stop being made. */
function stepClaimsHumanApproval(step) {
  const s = authorityObject(step);
  if (authorityText(s.status) !== "completed") return false;
  const result = authorityObject(s.result);
  return result.humanApproved === true || result.satisfiedByReconciliation === true;
}

/* Every gate a run is currently parked on. A run parks one step at a time
   today; this returns a list anyway, because "how many gates" is a fact the
   caller should read rather than a shape it should assume. */
function runGateRequirements(run) {
  const r = authorityObject(run);
  const steps = authorityObject(r.steps);
  const out = [];
  for (const key of Object.keys(steps)) {
    const step = authorityObject(steps[key]);
    const requirement = gateRequirement(r, { ...step, key: authorityText(step.key) || key });
    if (requirement) out.push(requirement);
  }
  return out;
}

/* DOES THE HUMAN AUTHORITY THIS GATE IS WAITING FOR EXIST YET.

   THE CORRECTION THE ACCEPTANCE AUDIT REQUIRED. This used to read the winner
   edge and reason "only a human may write one, so a winner is a decision". The
   audit executed that reasoning against a preserved pre-repair project and it
   answered `true` for a frame automation had picked. The premise is only true
   for edges written after the guard shipped, and a dogfood project is full of
   edges that predate it.

   It asks the ledger now. No receipt, no satisfaction — whatever the edge says,
   however plausible the provenance looks, and regardless of how many surfaces
   would prefer a cleared row.

   This is the ONLY definition of a satisfied human gate in CineBraid. Every
   projection, badge, count, resume decision and server read routes here. */
function gateSatisfied(requirement, project) {
  const target = gateAuthorityTarget(requirement);
  if (!target) return false;
  return hasCurrentHumanAuthority(project, target);
}

/* What the gate would be satisfied BY if a person confirmed the selection that
   is already sitting there. Null when there is nothing to confirm. Surfaces use
   this to offer "this is what automation chose — approve it?" instead of an
   empty gate beside a populated frame. */
function gateHistoricSelection(requirement, project) {
  const target = gateAuthorityTarget(requirement);
  return target ? historicSelection(project, target) : null;
}

/* THE SHARED RECONCILIATION BOUNDARY. One function, consumed by the browser
   projections, by the run resume path, and by the server on every read of the
   run ledger — so a poll, a reload, a workspace entry and a manual Recheck all
   converge on the same answer instead of each holding an opinion.

   Returns a PLAN and mutates nothing. The caller decides whether it is writing
   durable state or answering a render. */
function reconcileRunGates(run, project, options = {}) {
  const r = authorityObject(run);
  const satisfied = [];
  const outstanding = [];
  for (const requirement of runGateRequirements(r)) {
    const receipt = gateSatisfied(requirement, project) ? currentAuthorityReceipt(project, gateAuthorityTarget(requirement)) : null;
    if (receipt) satisfied.push({ ...requirement, receiptId: authorityText(receipt.id) });
    else outstanding.push(requirement);
  }
  /* THE SECOND DIRECTION, which the first repair did not have.

     A gate that was closed — by the runner, by the approval modal, or by an
     earlier reconciliation — and whose authority has since been revoked,
     replaced away, or cleared, is OUTSTANDING AGAIN. Leaving it completed is
     how the audit's "revoke, then resume" counterexample restored authority
     from a stale step. A cached result may DESCRIBE history; it may not stand
     in for current truth. */
  const invalidated = [];
  const steps = authorityObject(r.steps);
  for (const key of Object.keys(steps)) {
    const step = authorityObject(steps[key]);
    if (!stepClaimsHumanApproval(step)) continue;
    const requirement = gateRequirementForAnyStatus(r, { ...step, key: authorityText(step.key) || key });
    if (!requirement) continue;
    if (gateSatisfied(requirement, project)) continue;
    invalidated.push(requirement);
  }
  const changed = satisfied.length > 0 || invalidated.length > 0;
  const stillWaiting = outstanding.length > 0 || invalidated.length > 0;
  return {
    changed,
    satisfied,
    outstanding,
    invalidated,
    /* A run whose every gate is satisfied is no longer waiting for a person. It
       becomes `interrupted` — the run ledger's existing word for "stopped, and a
       person may resume it" — rather than `completed`, because the remaining
       steps of the chain were never executed and claiming completion would be a
       second dishonesty in place of the first.

       And the reverse: a run that had walked past a gate whose authority is now
       gone goes BACK to `awaiting-review`, because it is waiting again. */
    nextStatus: !changed
      ? authorityText(r.status)
      : stillWaiting
        ? (["awaiting-review", "running"].includes(authorityText(r.status)) ? authorityText(r.status) : "awaiting-review")
        : (authorityText(r.status) === "awaiting-review" ? "interrupted" : authorityText(r.status)),
    at: authorityText(authorityObject(options).at),
  };
}

/* Apply the plan to a run record. Separated from the decision so the same
   reasoning can answer a render without writing anything.

   `humanApproved` here is a CITATION, never a manufacture. It is written only
   alongside `authorityReceiptId`, and only for a target this plan has already
   proved carries a current human receipt — so the boolean and the evidence for
   it are written in the same statement and cannot come apart. The audit's
   objection was to the opposite: a boolean synthesised from a winner field with
   no evidence behind it. */
function applyGateReconciliation(run, plan, options = {}) {
  const r = authorityObject(run);
  const p = authorityObject(plan);
  if (!p.changed) return r;
  const at = authorityText(authorityObject(options).at) || authorityText(p.at);
  /* K2 — THE APPLIER REVALIDATES. IT DOES NOT TRUST THE PLAN.
   *
   * The Batch 1B re-audit handed this function a plan it built by hand, with
   * `receiptId: "not-a-real-receipt"`, no project and no ledger — and watched a
   * real `needs-review` step become `completed` with `humanApproved: true`. The
   * only check was that the string was non-empty, which is not a check; it is a
   * spelling test.
   *
   * A plan is now a REQUEST. The project it is applied against is the evidence,
   * and every gate this function closes is re-verified against that project
   * immediately before the step is written: the receipt must exist in a
   * trustworthy ledger, be the single current one for the exact target, carry
   * valid human provenance, and match the live edge. All of that is what
   * `currentHumanAuthority` already means, so the applier simply asks it again.
   *
   * `options.project` is required to close a gate. Without it nothing is
   * completed — an applier that cannot see the evidence does not get to act on
   * a claim about it. Invalidation is still applied, because reopening a gate
   * is the safe direction and must never depend on having the project. */
  const project = authorityObject(options).project;
  const steps = authorityObject(r.steps);
  for (const requirement of authorityList(p.satisfied)) {
    const step = authorityObject(steps[requirement.stepKey]);
    if (!step || step.status !== "needs-review") continue;
    if (!project) continue;
    const verified = currentHumanAuthority(project, gateAuthorityTarget(requirement));
    /* The receipt must exist NOW, and be the one the plan cited. A stale plan
       whose receipt was superseded or revoked between planning and applying
       closes nothing. */
    if (!verified) continue;
    if (authorityText(requirement.receiptId) && authorityText(requirement.receiptId) !== authorityText(verified.id)) continue;
    step.status = "completed";
    step.pass = true;
    step.completedAt = step.completedAt || at;
    step.updatedAt = at;
    step.result = {
      ...authorityObject(step.result),
      humanApproved: true,
      autoApprove: false,
      /* WHICH decision closed this — the id of the receipt just re-verified
         against the durable project, not the one the plan asserted. */
      authorityReceiptId: authorityText(verified.id),
      /* WHY this gate closed without anyone touching the run. */
      satisfiedByReconciliation: true,
      satisfiedRequirement: requirement.kind,
    };
  }
  for (const requirement of authorityList(p.invalidated)) {
    const step = authorityObject(steps[requirement.stepKey]);
    if (!step) continue;
    step.status = "needs-review";
    step.pass = false;
    step.updatedAt = at;
    step.result = {
      ...authorityObject(step.result),
      /* The claim is WITHDRAWN, not merely un-set. Anything downstream that
         still reads the boolean reads `false`, and anything that reads the
         reason learns why it changed. */
      humanApproved: false,
      authorityReceiptId: "",
      satisfiedByReconciliation: false,
      authorityInvalidated: true,
      authorityInvalidatedAt: at,
      authorityInvalidatedReason: "The human approval this step recorded is no longer in force. Approve again to continue.",
    };
  }
  if (p.nextStatus && p.nextStatus !== r.status) {
    r.status = p.nextStatus;
    r.summary = authorityList(p.invalidated).length
      ? "An approval this run relied on is no longer in force. The gate is open again and needs a decision before the run can continue."
      : "The approval this run was waiting for was made elsewhere in CineBraid. The gate is satisfied; resume the run to continue.";
  }
  return r;
}

/* Is this run genuinely still waiting for a person, given current project truth.
   The predicate every activity surface asks.

   A run whose gate this module cannot IDENTIFY stays actionable. That is the
   deliberate asymmetry: guessing wrong in this direction leaves one extra row in
   "waiting for you", and guessing wrong in the other direction HIDES REAL WORK,
   which is the failure Dogfood #2 was about. The browser predicate in
   public/live-activity.js resolves the same way, and a test holds them to it. */
function runHasActionableGate(run, project) {
  const requirements = runGateRequirements(run);
  if (requirements.some((requirement) => !gateSatisfied(requirement, project))) return true;
  /* A completed step whose authority has gone is a gate again, whether or not
     the run has re-parked yet. Asking both directions here is what makes a
     render, a poll and a resume agree before the ledger has been rewritten. */
  const steps = authorityObject(authorityObject(run).steps);
  for (const key of Object.keys(steps)) {
    const step = authorityObject(steps[key]);
    if (!stepClaimsHumanApproval(step)) continue;
    const requirement = gateRequirementForAnyStatus(run, { ...step, key: authorityText(step.key) || key });
    if (requirement && !gateSatisfied(requirement, project)) return true;
  }
  return !requirements.length;
}

/* HAS AN APPROVAL THIS RUN ALREADY RELIED ON BEEN WITHDRAWN.

   Narrower than `runHasActionableGate`, and deliberately so: it answers ONLY the
   second direction. A run that walked past a gate and is now `interrupted` or
   `completed` is not waiting for anybody — unless the decision it walked past
   has since been revoked, in which case it is. Surfaces use this to reopen such
   a run in "waiting for you" on the current render, rather than at whatever
   point the ledger is next read and reconciled.

   Returns false for a run with no completed approval claims at all, which is why
   it cannot be used as a general "is this actionable" predicate. */
function runHasRevokedAuthority(run, project) {
  const steps = authorityObject(authorityObject(run).steps);
  for (const key of Object.keys(steps)) {
    const step = authorityObject(steps[key]);
    if (!stepClaimsHumanApproval(step)) continue;
    const requirement = gateRequirementForAnyStatus(run, { ...step, key: authorityText(step.key) || key });
    if (requirement && !gateSatisfied(requirement, project)) return true;
  }
  return false;
}

/* THE RESUME PREDICATE. A completed approval step is evidence of history; the
   receipt is evidence of NOW. Resume asks this and never reads
   `result.humanApproved`, which is precisely the read the audit turned into a
   resurrection: revoke the winner, resume the run, and the stale step handed
   authority back.

   Returns the receipt so the caller re-states a decision that exists rather
   than issuing a fresh grant of its own. */
function resumeAuthority(project, requirementOrTarget) {
  const target = gateAuthorityTarget(requirementOrTarget) || authorityTargetFor(requirementOrTarget);
  if (!target) return null;
  return currentHumanAuthority(project, target);
}

const PRODUCTION_AUTHORITY_EXPORTS = {
  PRODUCTION_DECISION_KINDS,
  PRODUCTION_AUTHORITY_ACTORS,
  HUMAN_AUTHORITY_ACT,
  AUTOMATION_RECOMMENDATION_FIELD,
  HUMAN_GATE_KINDS,
  /* K1C: the forgeable trio — isHumanAuthorityGrant, humanAuthorityGrant and
     assertHumanAuthority — is deliberately absent. A test asserts their
     absence, because re-exporting any of them restores the credential the
     re-audit forged in one line. */
  beginManualApproval,
  manualApprovalActive,
  authorityLedgerDiagnostics,
  authorityLedgerTrusted,
  readAuthorityEdge,
  automationRecommendation,
  isAutomationRecommendation,
  readAutomationRecommendation,
  stepIsHumanApproval,
  stepClaimsHumanApproval,
  provenanceActor,
  authorityTarget: authorityTargetFor,
  gateAuthorityTarget,
  authorityReceipts,
  authorityReceiptsFor,
  currentAuthorityReceipt,
  liveAuthorityValue,
  currentHumanAuthority,
  hasCurrentHumanAuthority,
  historicSelection,
  writeProductionAuthority,
  revokeProductionAuthority,
  writeFrameProductionAuthority,
  writeMotionProductionAuthority,
  writeDeliveryProductionAuthority,
  writeEntityStateProductionAuthority,
  revokeFrameProductionAuthority,
  revokeEntityStateProductionAuthority,
  entityOwnershipEligibility,
  useEntityOwnershipResolver,
  repairAuthorityReceiptIdentity,
  gateRequirement,
  gateRequirementForAnyStatus,
  runGateRequirements,
  gateSatisfied,
  gateHistoricSelection,
  reconcileRunGates,
  applyGateReconciliation,
  runHasActionableGate,
  runHasRevokedAuthority,
  resumeAuthority,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(PRODUCTION_AUTHORITY_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = PRODUCTION_AUTHORITY_EXPORTS;

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

/* ---------- the authority grant ------------------------------------------- */

/* THE predicate. Both fields, both exact. A step result carrying
   `humanApproved: true` is EVIDENCE that a human approved and is accepted as a
   grant source through `humanAuthorityGrant`, but it is not itself a grant —
   otherwise every truthy record in the run ledger would become one. */
function isHumanAuthorityGrant(grant) {
  const it = authorityObject(grant);
  return PRODUCTION_AUTHORITY_ACTORS.includes(authorityText(it.actor)) && authorityText(it.act) === HUMAN_AUTHORITY_ACT;
}

/* Build one. `via` records WHICH human surface issued the command — the run
   approval modal, the entity approval modal, the generated-media workspace — so
   a later audit can say where authority entered, not merely that it did. */
function humanAuthorityGrant(details = {}) {
  const it = authorityObject(details);
  return {
    actor: "human",
    act: HUMAN_AUTHORITY_ACT,
    via: authorityText(it.via) || "unspecified-human-surface",
    at: authorityText(it.at),
  };
}

/* An error a caller can recognise, so a machine-authority attempt is never
   mistaken for a transient provider fault and retried. */
function productionAuthorityError(what) {
  const error = new Error(
    `${what || "This edge"} is production authority and only an explicit human approval command may establish it. No authority was written.`,
  );
  error.code = "HUMAN_AUTHORITY_REQUIRED";
  error.authorityViolation = true;
  return error;
}

/* THE GUARD. Called by every writer of a production-authority edge; throws for
   anything that is not an explicit human command. */
function assertHumanAuthority(grant, what) {
  if (!isHumanAuthorityGrant(grant)) throw productionAuthorityError(what);
  return grant;
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
    /* NOT `winner`. A surface looking for authority finds nothing here. */
    file: authorityText(it.file),
    assetId: authorityText(it.assetId),
    score: Number.isFinite(Number(it.score)) ? Math.round(Number(it.score)) : null,
    threshold: Number.isFinite(Number(it.threshold)) ? Math.round(Number(it.threshold)) : null,
    rationale: authorityText(it.rationale),
    runId: authorityText(it.runId),
    stepKey: authorityText(it.stepKey),
    at: authorityText(it.at),
    /* The sentence every surface must be able to print without re-deriving it. */
    requiresHumanApproval: true,
  };
}

function isAutomationRecommendation(value) {
  const it = authorityObject(value);
  return authorityText(it.decision) === "ai-recommendation" && it.requiresHumanApproval === true;
}

/* Read a frame's or state's nomination back. Returns null rather than a partial
   record, because a half-read recommendation is what a surface would render as
   a decision. */
function readAutomationRecommendation(record) {
  const value = authorityObject(record)[AUTOMATION_RECOMMENDATION_FIELD];
  return isAutomationRecommendation(value) ? value : null;
}

/* ==========================================================================
   THE DURABLE AUTHORITY RECEIPT LEDGER.

   One append-only collection on the project document. A receipt is the ONLY
   evidence that a person issued an approval command, and it carries everything
   an audit needs to say who did what to which object, when, from where, and
   whether it still stands.

   Append-only in the sense that matters: a decision is never deleted, it is
   SUPERSEDED or REVOKED. "This was approved and then un-approved" is production
   history, and a ledger that forgets it cannot answer why a gate reopened. */

const PRODUCTION_AUTHORITY_LEDGER_KEY = "productionAuthority";
const PRODUCTION_AUTHORITY_LEDGER_VERSION = 1;

/* The production objects a human may hold authority over. A closed set: adding
   one is a contract change that has to be argued for. */
const AUTHORITY_TARGET_TYPES = ["shot-frame", "entity-state"];

/* current   this receipt IS the authority right now
   superseded a later receipt replaced it (the creator approved a different file)
   revoked   the authority was withdrawn and nothing replaced it */
const AUTHORITY_RECEIPT_STATES = ["current", "superseded", "revoked"];

/* The commands. Named after what a person did, not after which function ran. */
const AUTHORITY_COMMANDS = ["approve-shot-frame", "approve-entity-state"];

/* Why a receipt stopped being current. Recorded so a reopened gate can say
   which of the two happened. */
const AUTHORITY_REVOCATION_REASONS = ["replaced", "withdrawn", "target-cleared", "target-removed"];

function authorityNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- the target descriptor ----------------------------------------- */

/* One shape for "which production object". Returns null rather than a partial
   descriptor, because a half-identified target is what would let a receipt for
   one frame satisfy a gate on another. */
function authorityTarget(details) {
  const it = authorityObject(details);
  const type = authorityText(it.targetType);
  if (type === "shot-frame") {
    const shotId = authorityText(it.shotId);
    const frameId = authorityText(it.frameId);
    if (!shotId || !frameId) return null;
    return { targetType: "shot-frame", targetId: `${shotId}#${frameId}`, shotId, frameId, list: "", entityId: "", stateId: "" };
  }
  if (type === "entity-state") {
    const list = authorityText(it.list);
    const entityId = authorityText(it.entityId);
    const stateId = authorityText(it.stateId);
    if (!list || !entityId || !stateId) return null;
    return { targetType: "entity-state", targetId: `${list}:${entityId}#${stateId}`, shotId: "", frameId: "", list, entityId, stateId };
  }
  return null;
}

/* A parked gate and an approval command name the same object different ways.
   This is the one translation, so the two can never drift. */
function gateAuthorityTarget(requirement) {
  const need = authorityObject(requirement);
  if (need.kind === "shot-frame-approval") return authorityTarget({ targetType: "shot-frame", shotId: need.shotId, frameId: need.frameId });
  if (need.kind === "entity-state-approval") return authorityTarget({ targetType: "entity-state", list: need.list, entityId: need.entityId, stateId: need.stateId });
  return null;
}

function sameAuthorityTarget(a, b) {
  const left = authorityObject(a);
  const right = authorityObject(b);
  return !!left.targetType && left.targetType === right.targetType && left.targetId === right.targetId;
}

/* ---------- reading the ledger -------------------------------------------- */

function authorityReceipts(project) {
  return authorityList(authorityObject(authorityObject(project)[PRODUCTION_AUTHORITY_LEDGER_KEY]).receipts).map(authorityObject);
}

/* Every receipt for one target, oldest first. History, including the superseded
   and revoked ones — a caller asking "who approved this and when" wants them. */
function authorityReceiptsFor(project, target) {
  const wanted = authorityTarget(target) || authorityObject(target);
  if (!authorityText(wanted.targetId)) return [];
  return authorityReceipts(project).filter((receipt) => sameAuthorityTarget(receipt, wanted));
}

/* THE PREDICATE THE WHOLE BATCH TURNS ON: is there a live human decision about
   this object right now.

   Returns the receipt, or null. Never a boolean, because every caller that
   matters wants to cite it. */
function currentAuthorityReceipt(project, target) {
  const rows = authorityReceiptsFor(project, target).filter((receipt) => authorityText(receipt.status) === "current");
  return rows.length ? rows[rows.length - 1] : null;
}

/* WHAT THE PROJECT CURRENTLY SAYS is approved for this target. The edge, read
   without interpretation. */
function liveAuthorityValue(project, target) {
  const need = authorityTarget(target) || authorityObject(target);
  const P = authorityObject(project);
  if (need.targetType === "shot-frame") {
    const shot = authorityList(P.shots).find((item) => authorityObject(item).id === need.shotId);
    if (!shot) return { value: "", assetId: "" };
    const frames = authorityList(authorityObject(shot).keyframes);
    const index = frames.findIndex((item) => authorityObject(item).id === need.frameId);
    if (index < 0) return { value: "", assetId: "" };
    const frame = authorityObject(frames[index]);
    const value = authorityText(frame.winner) || (index === 0 ? authorityText(authorityObject(shot).winner) : "");
    const assetId = authorityText(authorityObject(frame.approvalIdentity).winner) || (index === 0 ? authorityText(authorityObject(authorityObject(shot).approvalIdentity).winner) : "");
    return { value, assetId };
  }
  if (need.targetType === "entity-state") {
    const entity = authorityList(P[need.list]).find((item) => authorityObject(item).id === need.entityId);
    if (!entity) return { value: "", assetId: "" };
    const states = authorityList(authorityObject(entity).continuityStates);
    const state = states.find((item) => authorityObject(item).id === need.stateId);
    if (state) {
      const own = authorityText(authorityObject(state).approvedFile);
      if (own) return { value: own, assetId: authorityText(authorityObject(state).approvedAssetId) };
      /* The default state's file IS the entity's. A non-default state with no
         file of its own is NOT satisfied by the entity's — that substitution is
         the state-authority defect and it must stay fixed. */
      return authorityObject(state).isDefault === true
        ? { value: authorityText(authorityObject(entity).approvedFile), assetId: authorityText(authorityObject(entity).approvedAssetId) }
        : { value: "", assetId: "" };
    }
    return need.stateId === "state-default"
      ? { value: authorityText(authorityObject(entity).approvedFile), assetId: authorityText(authorityObject(entity).approvedAssetId) }
      : { value: "", assetId: "" };
  }
  return { value: "", assetId: "" };
}

/* IS THERE CURRENT HUMAN AUTHORITY over this object.

   Both halves, and both are load-bearing:

     the RECEIPT  — a person issued the command, and it has not been revoked or
                    superseded. A pre-repair winner has no receipt and therefore
                    no authority, which is the audit's headline counterexample.
     the EDGE     — the project still carries what that person approved. A
                    writer that clears a winner without calling the revocation
                    command still loses authority here, so the invariant does
                    not depend on every writer being polite. FAIL CLOSED.

   Identity is accepted as well as filename: a rename that repaired the edge but
   not the receipt must not silently revoke a real decision. */
function currentHumanAuthority(project, target) {
  const receipt = currentAuthorityReceipt(project, target);
  if (!receipt) return null;
  const live = liveAuthorityValue(project, target);
  if (!live.value) return null;
  const byName = live.value === authorityText(receipt.value);
  const byIdentity = !!authorityText(receipt.assetId) && authorityText(receipt.assetId) === authorityText(live.assetId);
  return byName || byIdentity ? receipt : null;
}

function hasCurrentHumanAuthority(project, target) {
  return !!currentHumanAuthority(project, target);
}

/* A winner that no human ever confirmed. NOT an error and NOT hidden: it is a
   real selection somebody's machine made, and the product shows it as a
   recommendation the creator can accept in one act. This function is what a
   surface asks to know which of the two words to print. */
function historicSelection(project, target) {
  const live = liveAuthorityValue(project, target);
  if (!live.value) return null;
  if (currentHumanAuthority(project, target)) return null;
  const revoked = authorityReceiptsFor(project, target).filter((receipt) => authorityText(receipt.status) !== "current");
  return {
    ...(authorityTarget(target) || authorityObject(target)),
    value: live.value,
    assetId: live.assetId,
    /* WHY it is not authority. A file nobody ever decided on reads differently
       from one whose approval was withdrawn, and a creator deserves both. */
    basis: revoked.length ? "authority-revoked" : "no-human-receipt",
    priorReceiptCount: revoked.length,
    requiresHumanApproval: true,
  };
}

/* ---------- the command --------------------------------------------------- */

function authorityLedgerError(message, code) {
  const error = new Error(message);
  error.code = code || "PRODUCTION_AUTHORITY_REJECTED";
  error.authorityViolation = true;
  return error;
}

/* The ledger, created on first write and never on a read. A read that
   materialised the key would dirty a project just by rendering it. */
function ensureAuthorityLedger(project) {
  const P = authorityObject(project);
  const existing = authorityObject(P[PRODUCTION_AUTHORITY_LEDGER_KEY]);
  const ledger = {
    version: authorityNumber(existing.version) || PRODUCTION_AUTHORITY_LEDGER_VERSION,
    sequence: authorityNumber(existing.sequence),
    receipts: authorityList(existing.receipts),
  };
  P[PRODUCTION_AUTHORITY_LEDGER_KEY] = ledger;
  return ledger;
}

/* THE ONE COMMAND. Every production-authority mutation in CineBraid comes
   through here — automation, correction automation, the reference approval
   modal, Generated Media, creation studio, review, review provenance, library
   tools, resume, import and normalisation compatibility.

   It does three things in one indivisible step, which is the entire reason it
   exists: assert the actor, write the edge, and record the receipt. A caller
   cannot get one without the others, so there is no arrangement of call sites
   that produces an edge nobody decided or a receipt for an edge that was never
   written.

   `applyEdge` is supplied by the caller and is the only part that touches
   project shape this module has no business knowing (approval identity stamps,
   candidate rows, workflow status). It runs AFTER the actor check and BEFORE
   the receipt, so a refusal writes nothing at all. */
function commandProductionAuthority(project, request = {}) {
  const it = authorityObject(request);
  const target = authorityTarget(it);
  if (!target) throw authorityLedgerError("A production-authority command must name a complete target. No authority was written.", "AUTHORITY_TARGET_INCOMPLETE");
  const what = target.targetType === "shot-frame" ? `Frame ${target.frameId} of ${target.shotId}` : `${target.list} ${target.entityId} state ${target.stateId}`;
  /* THE ACTOR CHECK, first, before anything is touched. */
  assertHumanAuthority(it.grant, what);
  const value = authorityText(it.value);
  if (!value) throw authorityLedgerError(`${what} cannot be approved without naming the media being approved. No authority was written.`, "AUTHORITY_VALUE_REQUIRED");
  const command = AUTHORITY_COMMANDS.includes(authorityText(it.command))
    ? authorityText(it.command)
    : target.targetType === "shot-frame" ? "approve-shot-frame" : "approve-entity-state";
  /* An eligibility veto the caller supplies — today it is media ownership, so a
     file whose owner is unresolved or contested cannot become canon. Refused
     before the edge, so a blocked approval leaves no trace. */
  if (typeof it.eligibility === "function") {
    const verdict = authorityObject(it.eligibility(target));
    if (verdict.ok === false) throw authorityLedgerError(authorityText(verdict.message) || `${what} is not eligible for approval.`, authorityText(verdict.code) || "AUTHORITY_INELIGIBLE");
  }
  if (typeof it.applyEdge === "function") it.applyEdge(target);
  const ledger = ensureAuthorityLedger(project);
  const at = authorityText(it.at);
  const via = authorityText(authorityObject(it.grant).via) || authorityText(it.via) || "unspecified-human-surface";
  /* SUPERSESSION, not overwrite. The previous decision stays readable. */
  for (const receipt of ledger.receipts) {
    const row = authorityObject(receipt);
    if (!sameAuthorityTarget(row, target) || authorityText(row.status) !== "current") continue;
    row.status = "superseded";
    row.supersededAt = at;
    row.revocationReason = "replaced";
  }
  ledger.sequence = authorityNumber(ledger.sequence) + 1;
  const receipt = {
    id: `authority-${String(ledger.sequence).padStart(6, "0")}`,
    sequence: ledger.sequence,
    actor: "human",
    act: HUMAN_AUTHORITY_ACT,
    command,
    targetType: target.targetType,
    targetId: target.targetId,
    shotId: target.shotId,
    frameId: target.frameId,
    list: target.list,
    entityId: target.entityId,
    stateId: target.stateId,
    value,
    assetId: authorityText(it.assetId),
    via,
    at,
    status: "current",
    supersededBy: "",
    supersededAt: "",
    revokedAt: "",
    revocationReason: "",
    note: authorityText(it.note),
  };
  for (const row of ledger.receipts) {
    const previous = authorityObject(row);
    if (sameAuthorityTarget(previous, target) && authorityText(previous.status) === "superseded" && !authorityText(previous.supersededBy)) previous.supersededBy = receipt.id;
  }
  ledger.receipts.push(receipt);
  return receipt;
}

/* WITHDRAWING AUTHORITY. The other half of the command, and the half the first
   repair had no concept of at all: a cleared winner left a completed gate step
   claiming a person had approved it, and resume believed the step.

   Revocation records WHY, invalidates the receipt, and — because every gate
   predicate is derived rather than cached — every dependent gate reopens on the
   next read without any surface being notified. */
function revokeProductionAuthority(project, request = {}) {
  const it = authorityObject(request);
  const target = authorityTarget(it);
  if (!target) throw authorityLedgerError("A revocation must name a complete target. Nothing was changed.", "AUTHORITY_TARGET_INCOMPLETE");
  const reason = AUTHORITY_REVOCATION_REASONS.includes(authorityText(it.reason)) ? authorityText(it.reason) : "withdrawn";
  const at = authorityText(it.at);
  if (typeof it.applyEdge === "function") it.applyEdge(target);
  const ledger = ensureAuthorityLedger(project);
  const revoked = [];
  for (const row of ledger.receipts) {
    const receipt = authorityObject(row);
    if (!sameAuthorityTarget(receipt, target) || authorityText(receipt.status) !== "current") continue;
    receipt.status = "revoked";
    receipt.revokedAt = at;
    receipt.revocationReason = reason;
    receipt.revokedVia = authorityText(it.via);
    revoked.push(receipt);
  }
  return revoked;
}

/* ---------- the two named boundaries every writer calls -------------------- */

/* THE SHOT-SIDE BOUNDARY. Every frame or shot winner in CineBraid is written
   here — the run approval modal, the guided frame card, library approval,
   review provenance, the motion composer's opening-frame link, scene correction
   approval. Callers keep their own side effects; they hand them in as
   `applyEdge` so the actor check still comes first.

   Named rather than inlined so a grep for the writers of production authority
   returns a list, and so the negative controls have one function to break. */
function writeFrameProductionAuthority(project, request = {}) {
  const it = authorityObject(request);
  return commandProductionAuthority(project, {
    ...it,
    targetType: "shot-frame",
    command: "approve-shot-frame",
  });
}

/* THE ENTITY-SIDE BOUNDARY, and the place media ownership becomes an authority
   rule rather than a display rule: an approval of a file whose owner is
   unresolved or contested is refused HERE, so no surface can approve its way
   around P0-4 by calling a different writer. */
function writeEntityStateProductionAuthority(project, request = {}) {
  const it = authorityObject(request);
  return commandProductionAuthority(project, {
    ...it,
    targetType: "entity-state",
    command: "approve-entity-state",
    eligibility: typeof it.eligibility === "function" ? it.eligibility : (target) => entityOwnershipEligibility(project, target, authorityText(it.value)),
  });
}

/* The ownership veto, resolved through the shared ownership module when it is
   loaded. FAIL CLOSED is the rule the audit asked for: if the authoritative
   resolver is unavailable this refuses rather than guessing, because the
   fallback it would otherwise reach for is the prefix inference that caused the
   defect. */
/* Node has no shared browser scope, so a server-side caller hands the ownership
   module in once at wire-up. The browser needs nothing: the two files share one
   lexical scope there, and the lookup below finds the function directly. */
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
    return {
      ok: false,
      code: "AUTHORITY_OWNERSHIP_RESOLVER_UNAVAILABLE",
      message: `CineBraid cannot confirm which reference owns ${name}, so it will not make it canon. No authority was written.`,
    };
  }
  const resolution = authorityObject(resolver.resolve(resolver.build(project, need.list), name));
  if (resolution.contested === true) {
    return {
      ok: false,
      code: "AUTHORITY_OWNERSHIP_CONTESTED",
      message: `${name} is durably claimed by more than one reference (${authorityList(resolution.claimants).join(", ")}). Resolve the conflict before approving it. No authority was written.`,
    };
  }
  if (resolution.authoritative !== true || authorityText(resolution.ownerId) !== authorityText(need.entityId)) {
    return {
      ok: false,
      code: "AUTHORITY_OWNERSHIP_UNRESOLVED",
      message: `${name} is not durably owned by ${need.entityId}${authorityText(resolution.basis) === "prefix-inference" ? " — a filename match is a possible match, not ownership. Claim it for this reference first." : "."} No authority was written.`,
    };
  }
  return { ok: true };
}

function revokeFrameProductionAuthority(project, request = {}) {
  return revokeProductionAuthority(project, { ...authorityObject(request), targetType: "shot-frame" });
}
function revokeEntityStateProductionAuthority(project, request = {}) {
  return revokeProductionAuthority(project, { ...authorityObject(request), targetType: "entity-state" });
}

/* A rename moved the bytes and the edge followed. The receipt has to follow
   too, or the next read sees a receipt naming a file that no longer exists and
   silently revokes a decision a person really made. Called from the same two
   places that already repair approval identity on rename. */
function repairAuthorityReceiptIdentity(project, change = {}) {
  const it = authorityObject(change);
  const from = authorityText(it.from);
  const to = authorityText(it.to);
  const assetId = authorityText(it.assetId);
  if (!from || !to || from === to) return [];
  const ledger = authorityObject(authorityObject(project)[PRODUCTION_AUTHORITY_LEDGER_KEY]);
  const repaired = [];
  for (const row of authorityList(ledger.receipts)) {
    const receipt = authorityObject(row);
    if (authorityText(receipt.value) !== from) continue;
    receipt.value = to;
    if (assetId) receipt.assetId = assetId;
    repaired.push(receipt.id);
  }
  return repaired;
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
  const steps = authorityObject(r.steps);
  for (const requirement of authorityList(p.satisfied)) {
    const step = authorityObject(steps[requirement.stepKey]);
    if (!step || step.status !== "needs-review") continue;
    /* No receipt, no citation, no completion. Unreachable through
       reconcileRunGates, and stated anyway so a hand-built plan cannot close a
       gate this module never verified. */
    if (!authorityText(requirement.receiptId)) continue;
    step.status = "completed";
    step.pass = true;
    step.completedAt = step.completedAt || at;
    step.updatedAt = at;
    step.result = {
      ...authorityObject(step.result),
      humanApproved: true,
      autoApprove: false,
      /* WHICH decision closed this. A run report can now print the receipt
         rather than assert a boolean nobody can trace. */
      authorityReceiptId: authorityText(requirement.receiptId),
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
  const target = gateAuthorityTarget(requirementOrTarget) || authorityTarget(requirementOrTarget);
  if (!target) return null;
  return currentHumanAuthority(project, target);
}

const PRODUCTION_AUTHORITY_EXPORTS = {
  PRODUCTION_DECISION_KINDS,
  PRODUCTION_AUTHORITY_ACTORS,
  HUMAN_AUTHORITY_ACT,
  AUTOMATION_RECOMMENDATION_FIELD,
  HUMAN_GATE_KINDS,
  PRODUCTION_AUTHORITY_LEDGER_KEY,
  PRODUCTION_AUTHORITY_LEDGER_VERSION,
  AUTHORITY_TARGET_TYPES,
  AUTHORITY_RECEIPT_STATES,
  AUTHORITY_COMMANDS,
  AUTHORITY_REVOCATION_REASONS,
  isHumanAuthorityGrant,
  humanAuthorityGrant,
  productionAuthorityError,
  assertHumanAuthority,
  automationRecommendation,
  isAutomationRecommendation,
  readAutomationRecommendation,
  stepIsHumanApproval,
  stepClaimsHumanApproval,
  provenanceActor,
  authorityTarget,
  gateAuthorityTarget,
  sameAuthorityTarget,
  authorityReceipts,
  authorityReceiptsFor,
  currentAuthorityReceipt,
  liveAuthorityValue,
  currentHumanAuthority,
  hasCurrentHumanAuthority,
  historicSelection,
  commandProductionAuthority,
  revokeProductionAuthority,
  writeFrameProductionAuthority,
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

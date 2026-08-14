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

/* Does the production authority this gate is waiting for exist YET.

   Reads the project record only. Since P0-1 makes a human the only writer of
   these edges, their presence IS the human decision and no provenance lookup is
   needed — which is exactly why the invariant had to land before the
   reconciliation could be trusted. */
function gateSatisfied(requirement, project) {
  const need = authorityObject(requirement);
  const P = authorityObject(project);
  if (need.kind === "shot-frame-approval") {
    const shot = authorityList(P.shots).find((item) => authorityObject(item).id === need.shotId);
    if (!shot) return false;
    const frames = authorityList(authorityObject(shot).keyframes);
    const index = frames.findIndex((item) => authorityObject(item).id === need.frameId);
    if (index < 0) return false;
    const frame = authorityObject(frames[index]);
    /* The opening frame's authority may live on the shot, which is where the
       manual approval path has always written it. Both are the same edge. */
    return !!authorityText(frame.winner) || (index === 0 && !!authorityText(authorityObject(shot).winner));
  }
  if (need.kind === "entity-state-approval") {
    const entity = authorityList(P[need.list]).find((item) => authorityObject(item).id === need.entityId);
    if (!entity) return false;
    const states = authorityList(authorityObject(entity).continuityStates);
    const state = states.find((item) => authorityObject(item).id === need.stateId);
    if (state) {
      if (authorityText(authorityObject(state).approvedFile)) return true;
      /* The default state's approval is the entity's own primary file — the one
         reading v627EntityPreflight has always used. A non-default state that
         has no file of its own is NOT satisfied by the entity's, which is the
         state-authority substitution defect and must stay fixed. */
      return authorityObject(state).isDefault === true && !!authorityText(authorityObject(entity).approvedFile);
    }
    /* A project that has never normalised its state collection stores only the
       entity-level file, and `state-default` is the id every such project uses. */
    return need.stateId === "state-default" && !!authorityText(authorityObject(entity).approvedFile);
  }
  return false;
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
    (gateSatisfied(requirement, project) ? satisfied : outstanding).push(requirement);
  }
  const changed = satisfied.length > 0;
  return {
    changed,
    satisfied,
    outstanding,
    /* A run whose every gate is satisfied is no longer waiting for a person. It
       becomes `interrupted` — the run ledger's existing word for "stopped, and a
       person may resume it" — rather than `completed`, because the remaining
       steps of the chain were never executed and claiming completion would be a
       second dishonesty in place of the first. */
    nextStatus: changed && !outstanding.length && r.status === "awaiting-review" ? "interrupted" : authorityText(r.status),
    at: authorityText(authorityObject(options).at),
  };
}

/* Apply the plan to a run record. Separated from the decision so the same
   reasoning can answer a render without writing anything. The satisfied step is
   completed and marked with the fact that reconciliation — not the runner —
   closed it, and with `humanApproved: true`, because the authority it observed
   can only have been written by a human. */
function applyGateReconciliation(run, plan, options = {}) {
  const r = authorityObject(run);
  const p = authorityObject(plan);
  if (!p.changed) return r;
  const at = authorityText(authorityObject(options).at) || authorityText(p.at);
  const steps = authorityObject(r.steps);
  for (const requirement of authorityList(p.satisfied)) {
    const step = authorityObject(steps[requirement.stepKey]);
    if (!step || step.status !== "needs-review") continue;
    step.status = "completed";
    step.pass = true;
    step.completedAt = step.completedAt || at;
    step.updatedAt = at;
    step.result = {
      ...authorityObject(step.result),
      humanApproved: true,
      autoApprove: false,
      /* WHY this gate closed without anyone touching the run. Recorded so the
         run report does not have to infer it, and so a reader can tell a
         reconciled gate from one approved inside the run modal. */
      satisfiedByReconciliation: true,
      satisfiedRequirement: requirement.kind,
    };
  }
  if (p.nextStatus && p.nextStatus !== r.status) {
    r.status = p.nextStatus;
    r.summary = "The approval this run was waiting for was made elsewhere in CineBraid. The gate is satisfied; resume the run to continue.";
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
  if (!requirements.length) return true;
  return requirements.some((requirement) => !gateSatisfied(requirement, project));
}

const PRODUCTION_AUTHORITY_EXPORTS = {
  PRODUCTION_DECISION_KINDS,
  PRODUCTION_AUTHORITY_ACTORS,
  HUMAN_AUTHORITY_ACT,
  AUTOMATION_RECOMMENDATION_FIELD,
  HUMAN_GATE_KINDS,
  isHumanAuthorityGrant,
  humanAuthorityGrant,
  productionAuthorityError,
  assertHumanAuthority,
  automationRecommendation,
  isAutomationRecommendation,
  readAutomationRecommendation,
  stepIsHumanApproval,
  provenanceActor,
  gateRequirement,
  runGateRequirements,
  gateSatisfied,
  reconcileRunGates,
  applyGateReconciliation,
  runHasActionableGate,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(PRODUCTION_AUTHORITY_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = PRODUCTION_AUTHORITY_EXPORTS;

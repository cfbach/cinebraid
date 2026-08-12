/* Generation job lifecycle — what a submission outcome MEANS.
 *
 * Provider-neutral and pure. No network, no filesystem, no model names, no branching on
 * a family or a backend. fal/H3 is the first execution path to use this; Seedance, Kling,
 * Wan, a Comfy node and a Runware adapter use the same rules unchanged, which is the
 * point of it being here rather than inside a provider adapter.
 *
 * THE PROBLEM THIS EXISTS FOR
 *
 * A paid request can cross the provider boundary and then lose transport before
 * CineBraid learns whether it was accepted. Before this module, that landed in FAILED —
 * the same state as "the provider read the request and rejected it".
 *
 * Those are not the same thing and must never look the same:
 *
 *   FAILED       the outcome is KNOWN. The provider answered and declined, or the
 *                request never left. Nothing is running. Nothing was charged.
 *
 *   UNRESOLVED   the request was sent and the outcome is UNKNOWN. It may have been
 *                accepted, may be rendering right now, and may have been charged.
 *
 * Presenting the second as the first invites the one action that costs real money: press
 * Generate again. So uncertainty gets its own durable state, and the rule when
 * classifying is asymmetric on purpose — a wrongly UNRESOLVED job costs a filmmaker one
 * confirmation click, and a wrongly FAILED job costs them a second paid render.
 *
 * `unresolved` was already in the GenerationJob contract's status vocabulary and already
 * absent from its terminal list, which is exactly right: an unresolved job has not
 * finished, it is unknown. This module is what finally uses it.
 */

/* The durable ledger's own vocabulary. Uppercase because that is what
   generation-jobs.json has held since long before this module, and rewriting a shipped
   ledger's strings to look tidier is a migration nobody needs. */
const LEDGER_STATUSES = ["SUBMITTING", "SUBMITTED", "IN_QUEUE", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "UNRESOLVED"];

/* The bridge to the provider-neutral contract in generation-contracts.js, so one job can
   be described in either vocabulary without a second source of truth. */
const LEDGER_STATUS_TO_CONTRACT = {
  SUBMITTING: "submitting",
  SUBMITTED: "submitted",
  IN_QUEUE: "queued",
  IN_PROGRESS: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  UNRESOLVED: "unresolved",
};

/* Terminal means "no further provider work will change this". UNRESOLVED is deliberately
   NOT terminal — the provider may still be rendering — and equally not active, because
   nothing is being awaited. It is its own thing, which is why it needed its own state. */
const TERMINAL_LEDGER_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"];
const ACTIVE_LEDGER_STATUSES = ["SUBMITTING", "SUBMITTED", "IN_QUEUE", "IN_PROGRESS"];

const UNRESOLVED = "UNRESOLVED";

function isUnresolved(job) {
  return String(job?.status || "") === UNRESOLVED;
}

/* THE PROVIDER'S HANDLE ON A SUBMITTED REQUEST, read from the one field the durable
   ledger actually persists. `externalId` is what fal-generation.js writes from
   `request_id` and what blocksResubmission() above already trusts, so readers that
   invented `providerRequestId` or `requestId` were testing fields no writer has ever
   produced: their id check never fired, and a run that HAD been accepted by the
   provider was reported as one that never reached it. Historical rows need no rewrite
   — this is the shape they are already in. */
function providerRequestId(job) {
  return String(job?.externalId || "");
}
/* Whether the provider is known to have taken this request. An id is the evidence;
   status alone is not, because SUBMITTING and FAILED both describe requests that may
   never have been accepted. */
function providerAcceptedRequest(job) {
  return Boolean(providerRequestId(job)) || !["SUBMITTING", "FAILED"].includes(String(job?.status || ""));
}
function isTerminalStatus(status) {
  return TERMINAL_LEDGER_STATUSES.includes(String(status || ""));
}
function isActiveStatus(status) {
  return ACTIVE_LEDGER_STATUSES.includes(String(status || ""));
}

/* ---------------------------------------------------------------------------
   A. CLASSIFYING A FAILED SUBMISSION

   The one question: did the provider tell us, authoritatively, that it did not take the
   job? Everything else is uncertainty.

   Deliberately NOT a list of "safe" status codes. The input is what actually happened at
   the transport boundary, and the rules are about what that establishes:

     never transmitted    we threw before the request was handed to the socket — a
                          serialisation failure, a missing file, a refused capability.
                          Nothing was sent. FAILED, and not even provider-contacted.

     transport lost       the request went out and no response came back. This is the
                          case the whole module exists for: the queue may hold it.
                          UNRESOLVED.

     4xx answered         the provider read the request and declined it. A malformed
                          prompt, a bad key, a rate limit. It is not running and it was
                          not charged. FAILED.
                          408 is carved out: "I did not receive your request in time"
                          does not establish that it never arrived.

     5xx answered         something broke on the provider's side. That says nothing
                          about whether the job was enqueued first. UNRESOLVED.

     accepted but opaque  a success response we cannot identify a job from. It may be
                          running and we have no handle to poll. UNRESOLVED. */
function classifyProviderFailure(evidence = {}) {
  const transmitted = evidence.transmitted === true;
  /* `== null` first, deliberately: Number(null) is 0 and Number.isFinite(0) is true, so
     coercing first would turn "nothing answered" into "answered with status 0" and
     describe a dropped connection as a provider reply. */
  const httpStatus = evidence.httpStatus == null || !Number.isFinite(Number(evidence.httpStatus))
    ? null
    : Number(evidence.httpStatus);

  if (!transmitted)
    return {
      status: "FAILED",
      outcome: "not-sent",
      providerContacted: false,
      providerAnswered: false,
      authoritative: true,
      reason: "The request was refused before it left CineBraid.",
    };

  if (httpStatus == null)
    return {
      status: UNRESOLVED,
      outcome: "indeterminate",
      providerContacted: true,
      providerAnswered: false,
      authoritative: false,
      reason: "The request was sent and no response came back, so it is not known whether the provider accepted it.",
    };

  if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408)
    return {
      status: "FAILED",
      outcome: "rejected",
      providerContacted: true,
      providerAnswered: true,
      authoritative: true,
      reason: "The provider read the request and declined it.",
    };

  if (httpStatus >= 200 && httpStatus < 300)
    return {
      status: UNRESOLVED,
      outcome: "indeterminate",
      providerContacted: true,
      providerAnswered: true,
      authoritative: false,
      reason: "The provider accepted the request but returned nothing CineBraid can use to identify or follow it.",
    };

  return {
    status: UNRESOLVED,
    outcome: "indeterminate",
    providerContacted: true,
    providerAnswered: true,
    authoritative: false,
    reason: "The provider answered with an error on its own side, which does not establish whether the request was queued first.",
  };
}

/* Attached to a thrown error by whichever adapter was talking to the provider, and read
   back by the route. Keeping it on the error is what lets one generic catch classify a
   failure from any adapter without knowing which one threw. */
function describeSubmissionFailure(error) {
  const evidence = error && typeof error === "object" && error.providerEvidence ? error.providerEvidence : null;
  /* No evidence attached means the throw happened before any adapter reached its
     transport — a validation refusal, a serialisation failure. Nothing was sent. */
  return classifyProviderFailure(evidence || { transmitted: false });
}

/* ---------------------------------------------------------------------------
   B. TRANSITIONS

   Repair B already refuses to walk a settled job backwards. UNRESOLVED joins that policy
   rather than sitting beside it:

     - a delivered COMPLETED is final and nothing displaces it;
     - UNRESOLVED holds until something AUTHORITATIVE displaces it — a real provider
       status, or a human who went and looked. A late, stale FAILED from an unrelated
       write does not get to turn "we do not know" into "we know it failed", because that
       is the exact information loss this state was created to prevent;
     - everything else keeps its existing behaviour.

   `authoritative` is the caller's claim that the incoming status came from the provider
   or from an explicit reconciliation. It is the only key that opens UNRESOLVED. */
function nextStatus(current, incoming, options = {}) {
  const from = String(current || "");
  const to = String(incoming || "");
  if (!to) return from;
  if (from === to) return to;

  /* A delivered result is the end of the story — the pre-existing Repair B rule,
     unchanged: a terminal job whose output has been ingested is never walked backwards
     by a slower response arriving out of order. */
  if (options.ingested && TERMINAL_LEDGER_STATUSES.includes(from)) return from;
  /* ...and a known terminal outcome never regresses into uncertainty. */
  if (to === UNRESOLVED && TERMINAL_LEDGER_STATUSES.includes(from)) return from;

  if (from === UNRESOLVED && !options.authoritative) return from;

  return to;
}

/* Whether a job may be submitted again without a human first establishing what happened
   to the last one. This is the guard that stops "Generate again" from quietly buying the
   same shot twice. */
function blocksResubmission(job) {
  if (!job || job.reconciliation) return false;
  if (isUnresolved(job)) return true;
  /* A submission still marked in-flight that carries NO provider handle is the same
     uncertainty wearing a different label. It exists for milliseconds in normal
     operation — between the pre-POST commit and the answer — so a durable one means the
     process died mid-request, or the ledger was recovered from a backup taken during
     one. Either way nothing distinguishes it from a request the provider accepted, and
     the record has no id to go and check with. Blocking a duplicate of that costs
     nothing when the request really is live, and prevents a second bill when it is not. */
  return String(job.status || "") === "SUBMITTING" && !job.externalId;
}

/* Why a job blocks, so the refusal can say the right thing. Both are uncertainty; only
   one of them has been through the classifier. */
function resubmissionBlockReason(job) {
  if (!blocksResubmission(job)) return "";
  return isUnresolved(job) ? "unresolved" : "in-flight-without-handle";
}

/* Two submissions are "the same generation" when they target the same production result
   from the same package. Deliberately not the job id — a retry is a new job — and
   deliberately not the model, because switching backend does not make a possibly-running
   render disappear. */
function generationContextKey(job) {
  return [
    job?.purpose,
    job?.shotId,
    job?.entityList,
    job?.entityId,
    job?.frameId,
    job?.sourceBuildId,
  ].map((value) => String(value == null ? "" : value)).join("|");
}

/* ---------------------------------------------------------------------------
   C. RECONCILIATION

   The way out of UNRESOLVED, and the only way that does not involve guessing. A person
   goes and looks at the provider and records what they saw. CineBraid does not infer it,
   does not time it out, and does not quietly decide on their behalf: the passage of time
   is not evidence that a request was refused.

   Both outcomes preserve the whole history. The job keeps its compiled plan, its
   endpoint, its bindings and the fact that it was once unresolved; reconciliation is
   recorded ON TOP of that, never in place of it. */
const RECONCILIATION_OUTCOMES = {
  /* "I checked and the provider never took it." Safe to generate again. */
  "not-accepted": { status: "FAILED", retryable: true },
  /* "I checked and the provider did have it." CineBraid cannot follow or ingest a job it
     has no identifier for, so this is recorded as an orphan — a real render that exists
     outside CineBraid's knowledge — rather than pretended into a completion. */
  accepted: { status: "ORPHANED", retryable: true },
};

function isReconciliationOutcome(value) {
  return Object.prototype.hasOwnProperty.call(RECONCILIATION_OUTCOMES, String(value));
}

/* Returns the mutation to apply, or null when the job is not one that can be reconciled.
   Pure: the caller performs the write inside its own durable, serialized turn. */
function reconcileUnresolved(job, outcome, meta = {}) {
  if (!isUnresolved(job)) return null;
  if (!isReconciliationOutcome(outcome)) return null;
  const resolution = RECONCILIATION_OUTCOMES[String(outcome)];
  return {
    status: resolution.status,
    reconciliation: {
      outcome: String(outcome),
      /* What it was before a person settled it. An unresolved job that has been
         reconciled must still read as having been unresolved. */
      previousStatus: UNRESOLVED,
      at: String(meta.at || ""),
      by: String(meta.by || "user"),
      note: String(meta.note || ""),
      providerContacted: job.providerContacted === true,
      providerAnswered: job.providerAnswered === true,
      externalId: String(job.externalId || ""),
    },
  };
}

module.exports = {
  ACTIVE_LEDGER_STATUSES,
  LEDGER_STATUSES,
  LEDGER_STATUS_TO_CONTRACT,
  RECONCILIATION_OUTCOMES,
  TERMINAL_LEDGER_STATUSES,
  UNRESOLVED,
  blocksResubmission,
  classifyProviderFailure,
  describeSubmissionFailure,
  generationContextKey,
  isActiveStatus,
  isReconciliationOutcome,
  isTerminalStatus,
  isUnresolved,
  nextStatus,
  providerAcceptedRequest,
  providerRequestId,
  reconcileUnresolved,
  resubmissionBlockReason,
};

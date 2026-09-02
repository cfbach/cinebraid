/* CineBraid — the shared creator-state projection, shared by browser and Node the
   same way public/shared-stage-model.js and public/shared-workspace-shell.js are.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: the Assistant rail and the Activity
   Terminal describe the same production because they are two renderings of ONE
   projection, not two programs that each worked out what was happening.

   ---------------------------------------------------------------------------
   WHY THIS IS NOT A SECOND STATE MODEL. Every fact below is already true somewhere
   else and stays true there:

     is machine work happening        public/live-activity.js  v670MachineActiveRun
     has it stopped, waiting on me    public/live-activity.js  v670WaitingForHumanRun
     what stage is this shot in       public/shared-stage-model.js
     what did the provider do         the durable generation-job ledger
     what did it cost                 generation-cost.js, at submission, once

   This module reads NONE of those sources. It is handed the answers — the caller
   asks the shipped predicates and passes what they said — and its whole job is to
   put those answers in buckets, in a declared order, bounded to a declared window.
   That is the difference between a projection and a rival truth, and it is why
   `creatorState()` cannot reach a project, a run, a job or a clock even if a future
   caller wanted it to.

   ---------------------------------------------------------------------------
   FOUR PROPERTIES THAT ARE STRUCTURAL HERE RATHER THAN MERELY TESTED.

   * NOTHING IS STORED AND NOTHING IS MUTATED. `creatorState()` returns a fresh
     frozen value on every call and writes to nothing it was handed. A caller that
     persists the result has turned a rendering into production state, which is the
     thing this module must not become. tests/creator-state-negative-controls.js
     breaks that line and requires a failure.

   * THE BUCKET IS DECIDED ONCE. `creatorRunKind` takes the two shipped predicates
     and the durable status and returns ONE token. Six copies of
     `["running","awaiting-review"]` is what made CineBraid claim two operations were
     active while both had stopped (docs/architecture/CINEBRAID_PRODUCTION_STATE_HONESTY_2026-08-13.md);
     the Terminal and the Assistant disagreeing about which bucket a run is in would
     be the same defect wearing the overhaul's clothes.

   * UNKNOWN IS A VALUE, NOT AN EMPTY STRING. A provider, a model, a request id and a
     cost are each reported as known, not-recorded or not-applicable. A surface that
     receives `{known:false}` cannot print `$0.00` by accident, because there is no
     zero to print.

   * NO SENTENCES. Every field below is a token, a count, an identifier or a
     timestamp. "Waiting for you to review Frame A" is the Assistant's wording and
     "awaiting-review · approval-required" is the Terminal's; both are formatted by
     their own renderer from the same `{kind, reason}` pair. Centralising the English
     here would make one surface's voice the other's.

   ---------------------------------------------------------------------------
   THE VOCABULARY, frozen because it is what two surfaces have to agree on.

     kind        machine-active   a machine or provider is executing right now.
                 waiting-human    work has stopped and only a person can restart it.
                 needs-attention  it failed, was interrupted, was cancelled, or its
                                  outcome is unknown.
                 completed        it finished.
                 informational    settled, and none of the above (archived).

     reason      WHY it is in that bucket, in tokens. `approval-required` and
                 `runner-stopped` are both waiting-human and need different things
                 from the director; `run-interrupted` is passed through UNCHANGED
                 even though the upstream status is known to be overloaded, because
                 reinterpreting it here would be a second opinion about run state.

     knowledge   known | not-recorded | not-applicable. See CREATOR_UNAVAILABLE for
                 the questions this projection currently cannot answer at all.
*/

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  function creatorText(value) {
    return String(value == null ? "" : value).trim();
  }

  function creatorCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  const CREATOR_STATE_CONTRACT = "creator-state/1";

  const CREATOR_ACTIVITY_KINDS = deepFreeze([
    "machine-active",
    "waiting-human",
    "needs-attention",
    "completed",
    "informational",
  ]);

  const CREATOR_ACTIVITY_SOURCES = deepFreeze(["automation-run", "manual", "generation-job"]);

  /* THE ASSISTANT'S SECTION ORDER, declared so a renderer cannot invent one.

     `needs-attention` outranks `waiting-human` here, and that is a deliberate
     difference from v6602ActivityStatus in public/live-activity.js, which ranks them
     the other way. The two are answering different questions and both are right:

       the Activity toggle picks ONE badge label out of four, and among a pending
       approval and an old failure the approval is the thing the director can finish
       right now — so it wins the badge.

       the Assistant renders every populated section, so nothing is hidden by the
       order. Here the ordering question is "what do I read first", and a failure is
       an unrecoverable stop while an approval gate is a pause: the failure may be
       the REASON nothing is waiting on the director yet.

     Neither surface computes a status of its own, so this is a difference in reading
     order over identical facts and not a second opinion about what is true. */
  const CREATOR_PRIORITY = deepFreeze([
    "needs-attention",
    "waiting-human",
    "machine-active",
    "stage-blocked",
    "next-action",
    "recent",
  ]);

  /* ==========================================================================
     THE DURABLE VOCABULARIES THIS PROJECTION NAMES.

     NAMES, not decides. Whether a run needs attention is answered by
     v670AttentionRun in public/live-activity.js and arrives here as a verdict — this
     list exists only to turn that verdict into a REASON token, so `failed`,
     `interrupted` and `cancelled` can be said differently by two surfaces that agree
     they are the same bucket. A status the predicate flags but this list does not name
     still lands in needs-attention, with an empty reason, rather than falling through
     to `informational`.

     tests/creator-state.js reads the predicate's own list out of public/live-activity.js
     and requires the two to be identical, so a status added upstream cannot leave a
     row here unnamed and unnoticed.

     The job list is generation-lifecycle.js's ledger vocabulary, cross-checked the
     same way. */
  const CREATOR_ATTENTION_RUN_STATUSES = deepFreeze(["failed", "interrupted", "cancelled"]);
  const CREATOR_COMPLETED_RUN_STATUSES = deepFreeze(["completed"]);

  const CREATOR_ACTIVE_JOB_STATUSES = deepFreeze(["SUBMITTING", "SUBMITTED", "IN_QUEUE", "IN_PROGRESS"]);
  const CREATOR_ATTENTION_JOB_STATUSES = deepFreeze(["FAILED", "CANCELLED", "UNRESOLVED", "ORPHANED"]);
  const CREATOR_COMPLETED_JOB_STATUSES = deepFreeze(["COMPLETED"]);

  /* Why a row sits where it does, in tokens. Declared as a set so a renderer that
     receives an unexpected reason fails a test rather than printing a raw string. */
  const CREATOR_REASONS = deepFreeze([
    "",
    "approval-required",
    "runner-stopped",
    "run-failed",
    "run-interrupted",
    "run-cancelled",
    "request-failed",
    "generation-failed",
    "generation-cancelled",
    "submission-unresolved",
    "provider-ran-uncollected",
  ]);

  /* ==========================================================================
     THE HISTORY POLICY.

     The Terminal is a fixed-height surface in a workspace, not an audit log. Deep
     history already exists and is already paginated — public/reports.js reads
     `/api/automation/runs?view=history` — so growing an unbounded stream in the dock
     would be a second, worse copy of a feature that is already better somewhere else.

     UNSETTLED WORK IS NEVER TRUNCATED. What is running and what is waiting on the
     director are the two things the surface exists to answer, and capping them would
     be a silent lie about the machine; both are bounded in practice by the
     concurrency guard and by how many gates one director can be at.

     SETTLED WORK IS BOUNDED AND SAYS SO. `omitted` is returned rather than dropped,
     so the Terminal can name what it is not showing and point at Reports. A surface
     that truncates silently reads as "this is everything". */
  const CREATOR_RECENT_LIMIT = 24;
  const CREATOR_ATTENTION_LIMIT = 12;
  const CREATOR_DEEP_HISTORY_ROUTE = "#/reports";

  /* ==========================================================================
     WHAT THIS PROJECTION CANNOT ANSWER, stated rather than guessed.

     Same discipline as SHOT_STAGE_LIMITATIONS in public/shared-stage-model.js: each
     entry names the record that would have to exist before the answer could be
     derived, and tests/creator-state.js requires them to stay declared for as long as
     the condition holds — so a gap cannot be quietly dropped instead of filled. */
  const CREATOR_UNAVAILABLE = deepFreeze({
    "job-duration": {
      question: "How long did this provider request take?",
      why: "A generation-job row records createdAt, updatedAt and ingestedAt. It records no start or completion moment for the provider's own work, so any duration would be the time CineBraid spent polling.",
      wouldNeed: "startedAt/completedAt stamped on the job row from the provider's status payload",
    },
    "job-attempt": {
      question: "Which attempt is this generation?",
      why: "A retry is a new job row with a new id. Only automation STEPS carry attempt / maxAttempts / retryCount, so a job dispatched outside a run has no attempt number to show.",
      wouldNeed: "an attempt or retry-of field on the generation-job record",
    },
    "motion-cost": {
      question: "What was this motion render estimated to cost?",
      why: "MiniMax H3 is billed on duration, resolution and reference count. The only per-second model lives in the browser as a pre-flight quote, so the server has no rate to record and the row is written `unknown` rather than multiplied by a per-image rate it has no evidence for.",
      wouldNeed: "an H3 rate the server can read at submission",
    },
    "provider-billing": {
      question: "What was actually charged?",
      why: "CineBraid receives no trustworthy billing figure from the provider. Every recorded amount is what was ESTIMATED at submission, including for jobs that later failed.",
      wouldNeed: "provider invoice reconciliation",
    },
    "stage-outside-shot": {
      question: "What stage is the filmmaker in, on a surface that is not a shot?",
      why: "The declared stage model describes a shot. A library or production surface has no shot, so the stage block is absent rather than guessed from the last shot visited.",
      wouldNeed: "a declared stage model for the surface in question",
    },
  });

  const CREATOR_UNAVAILABLE_KEYS = deepFreeze(Object.keys(CREATOR_UNAVAILABLE));

  /* ==========================================================================
     KNOWLEDGE.

     Three answers, and `""` is not one of them. A field that was never recorded and a
     field that cannot apply to this kind of work are different facts, and a surface
     that receives both as an empty string will eventually render one of them as a
     zero. */
  function creatorKnown(value) {
    const text = creatorText(value);
    return deepFreeze({ state: text ? "known" : "not-recorded", value: text });
  }

  function creatorNotApplicable(reason) {
    return deepFreeze({ state: "not-applicable", value: "", reason: creatorText(reason) });
  }

  function creatorKnownCount(value, { applicable = true, reason = "" } = {}) {
    if (!applicable) return creatorNotApplicable(reason);
    const number = Number(value);
    if (!Number.isFinite(number)) return deepFreeze({ state: "not-recorded", value: "" });
    return deepFreeze({ state: "known", value: String(Math.floor(number)), number: Math.floor(number) });
  }

  /* THE RECORDED COST — A FORMATTER OVER A STORED RECORD, AND NOTHING ELSE.

     THERE IS NO PRICING LOGIC IN THIS FUNCTION AND THERE MUST NEVER BE. No rate, no
     multiplication, no per-image or per-second table, no fallback to configuration.
     generation-cost.js decides what a job was estimated at, ONCE, at submission, from
     the configuration in effect at that moment; the number is then a historical fact
     written onto the durable row. `job.accounting` reaches the browser intact on the
     public job. All this does is classify what is already there.

     Three populations, no fourth, and never a number this projection produced:

       estimated     an amount was recorded at submission. Report that amount.
       unknown       recorded, and recorded as not knowable — no per-image rate applies
                     to this output. Every motion-h3 job is in this population.
       not-recorded  the row predates cost recording. Nothing is known.

     A missing accounting record is NOT zero, an unknown estimate is NOT zero, and
     neither is ever inferred from the provider or the model. Those are the three ways
     a surface could invent a price, and none of them has a branch here.

     tests/creator-state.js drives generation-cost.js's own recordedEstimate() and
     recordedAmount() over the same fixtures and requires the same verdict, so this
     classification cannot drift away from the authority without a suite going red. */
  function creatorCostFact(job) {
    const accounting = job && typeof job === "object" ? job.accounting : null;
    const estimate = accounting && typeof accounting === "object" && accounting.estimate
      && typeof accounting.estimate === "object" ? accounting.estimate : null;
    if (!estimate) return deepFreeze({ state: "not-recorded", amount: null, unit: "", basis: "" });
    if (creatorText(estimate.confidence) === "unknown")
      return deepFreeze({
        state: "unknown",
        amount: null,
        unit: creatorText(estimate.unit),
        basis: "estimated-at-submission",
        unpricedReason: creatorText(accounting.basis && accounting.basis.unpricedReason),
      });
    const amount = Number(estimate.amount);
    if (!Number.isFinite(amount) || amount < 0)
      return deepFreeze({ state: "not-recorded", amount: null, unit: creatorText(estimate.unit), basis: "" });
    return deepFreeze({
      state: "estimated",
      amount,
      unit: creatorText(estimate.unit) || "usd",
      basis: "estimated-at-submission",
      confidence: creatorText(estimate.confidence),
    });
  }

  /* ==========================================================================
     THE BUCKET DECISION — one function per source, and the run one is the important
     one.

     NONE of the three verdicts is computed here. `machineActive`, `waitingForHuman`
     and `needsAttention` arrive as the answers v670MachineActiveRun,
     v670WaitingForHumanRun and v670AttentionRun already gave, which is what stops this
     file becoming yet another place that decides whether a run is alive or broken —
     the defect that made CineBraid report two active operations while both had
     stopped, repeated one layer up.

     What IS decided here is the PRECEDENCE between those three verdicts and the
     durable status, so the Terminal and the Assistant cannot resolve the same run into
     two different buckets. */
  function creatorRunKind(facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const status = creatorText(raw.status);
    if (raw.machineActive === true) return { kind: "machine-active", reason: "" };
    if (raw.waitingForHuman === true)
      return { kind: "waiting-human", reason: status === "awaiting-review" ? "approval-required" : "runner-stopped" };
    if (raw.needsAttention === true)
      return {
        kind: "needs-attention",
        reason: CREATOR_ATTENTION_RUN_STATUSES.includes(status) ? `run-${status}` : "",
      };
    if (CREATOR_COMPLETED_RUN_STATUSES.includes(status)) return { kind: "completed", reason: "" };
    return { kind: "informational", reason: "" };
  }

  /* A submission whose outcome CineBraid does not know is NEEDS ATTENTION, not a
     routine approval gate. The only exit is a person going to look at the provider —
     which is waiting-for-human in shape — but the render may be running and may have
     been charged, and presenting that as a pause understates it. generation-lifecycle.js
     makes the same asymmetric call for the same reason: a wrongly cautious job costs a
     click, a wrongly reassuring one costs a second bill. */
  function creatorJobKind(facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const status = creatorText(raw.status).toUpperCase();
    /* UNCERTAINTY OUTRANKS ACTIVITY, and it is the server that says which jobs are
       uncertain. Asking `status === "UNRESOLVED"` here answered only one of the two ways
       a submission becomes uncertain: a durable SUBMITTING row with no provider handle is
       "active" by status, so it was bucketed machine-active and the rail told the
       filmmaker a machine was working on something nobody could account for. The status
       arm below still stands on its own for a projection built before the server carried
       this field. */
    if (raw.uncertain === true) return { kind: "needs-attention", reason: "submission-unresolved" };
    if (raw.active === true) return { kind: "machine-active", reason: "" };
    if (status === "UNRESOLVED") return { kind: "needs-attention", reason: "submission-unresolved" };
    if (status === "ORPHANED") return { kind: "needs-attention", reason: "provider-ran-uncollected" };
    if (status === "FAILED") return { kind: "needs-attention", reason: "generation-failed" };
    if (status === "CANCELLED") return { kind: "needs-attention", reason: "generation-cancelled" };
    if (CREATOR_COMPLETED_JOB_STATUSES.includes(status)) return { kind: "completed", reason: "" };
    return { kind: "informational", reason: "" };
  }

  function creatorManualKind(status) {
    const key = creatorText(status);
    if (key === "running") return { kind: "machine-active", reason: "" };
    if (key === "failed") return { kind: "needs-attention", reason: "request-failed" };
    if (key === "completed") return { kind: "completed", reason: "" };
    return { kind: "informational", reason: "" };
  }

  /* ==========================================================================
     NORMALISATION.

     Every fact reaching a renderer has the same closed shape whatever produced it, so
     the Terminal's row renderer has one path rather than three and a missing field is
     an absent value rather than an undefined property read. */
  function creatorTarget(value) {
    const raw = value && typeof value === "object" ? value : {};
    return { kind: creatorText(raw.kind), id: creatorText(raw.id), label: creatorText(raw.label) };
  }

  function creatorTechnical(value) {
    const raw = value && typeof value === "object" ? value : {};
    return {
      provider: creatorKnown(raw.provider),
      model: creatorKnown(raw.model),
      mode: creatorKnown(raw.mode),
      purpose: creatorKnown(raw.purpose),
      requestId: creatorKnown(raw.requestId),
      statusLabel: creatorKnown(raw.statusLabel),
      queuePosition: raw.queuePosition == null || raw.queuePosition === ""
        ? { state: "not-recorded", value: "" }
        : creatorKnownCount(raw.queuePosition),
      /* Attempt is reported not-applicable for a source that has no attempt concept,
         rather than as a missing number. A generation job's retry is a different row
         with a different id — see CREATOR_UNAVAILABLE["job-attempt"]. */
      attempt: raw.attemptApplicable === false
        ? creatorNotApplicable("job-attempt")
        : creatorKnownCount(raw.attempt),
      maxAttempts: raw.attemptApplicable === false
        ? creatorNotApplicable("job-attempt")
        : creatorKnownCount(raw.maxAttempts),
      retryCount: raw.attemptApplicable === false
        ? creatorNotApplicable("job-attempt")
        : creatorKnownCount(raw.retryCount),
      cost: raw.cost && typeof raw.cost === "object" && creatorText(raw.cost.state)
        ? raw.cost
        : { state: "not-applicable", amount: null, unit: "", basis: "", reason: "no-paid-request" },
      error: creatorKnown(raw.error),
    };
  }

  function creatorActivityFact(value) {
    const raw = value && typeof value === "object" ? value : {};
    const kind = creatorText(raw.kind);
    const reason = creatorText(raw.reason);
    const step = raw.step && typeof raw.step === "object" ? raw.step : {};
    return {
      key: creatorText(raw.key),
      source: CREATOR_ACTIVITY_SOURCES.includes(creatorText(raw.source)) ? creatorText(raw.source) : "",
      id: creatorText(raw.id),
      label: creatorText(raw.label),
      kind: CREATOR_ACTIVITY_KINDS.includes(kind) ? kind : "informational",
      reason: CREATOR_REASONS.includes(reason) ? reason : "",
      target: creatorTarget(raw.target),
      route: creatorText(raw.route),
      /* Whether the shipped result resolver found the exact result this run produced.
         A boolean rather than the target itself: the surfaces need to know which of
         OPEN RESULT and OPEN WORKSPACE they are offering, and openRunResult() resolves
         the destination again for itself at the moment of the handoff. Carrying the
         route here as well would be a second copy of a decision with one owner. */
      resultResolved: raw.resultResolved === true,
      at: creatorText(raw.at),
      startedAt: creatorText(raw.startedAt),
      endedAt: creatorText(raw.endedAt),
      elapsed: creatorText(raw.elapsed),
      step: { label: creatorText(step.label), system: creatorText(step.system), state: creatorText(step.state) },
      technical: creatorTechnical(raw.technical),
    };
  }

  /* Newest first, by the moment the row last changed. String comparison on ISO
     timestamps, which is the same ordering v641ActiveAndRecentRuns already uses — a
     Date.parse here would introduce a clock this module deliberately does not have. */
  function byRecency(a, b) {
    return String(b.at || "").localeCompare(String(a.at || "")) || String(a.key).localeCompare(String(b.key));
  }

  /* ==========================================================================
     THE STAGE BLOCK.

     Passed straight through from public/shared-stage-model.js with its fields intact.
     Nothing here re-derives availability, completion or a recommendation: the point of
     consuming O1 is that the Assistant reads the declaration's answer, and a stage
     whose recommendedNext is "" must arrive here as "" and leave as "". */
  function creatorStageBlock(stage) {
    if (!stage || typeof stage !== "object" || !creatorText(stage.id)) return null;
    return {
      id: creatorText(stage.id),
      order: creatorCount(stage.order),
      label: creatorText(stage.label),
      detail: creatorText(stage.detail),
      purpose: creatorText(stage.purpose),
      optional: stage.optional === true,
      availability: creatorText(stage.availability),
      blockedReason: creatorText(stage.blockedReason),
      completion: creatorText(stage.completion),
      activity: creatorText(stage.activity),
      note: stage.note && typeof stage.note === "object" ? { ...stage.note } : null,
      next: Array.isArray(stage.next) ? stage.next.map(creatorText).filter(Boolean) : [],
      recommendedNext: creatorText(stage.recommendedNext),
      authority: Array.isArray(stage.authority) ? stage.authority.map(creatorText).filter(Boolean) : [],
    };
  }

  /* THE ONE HONEST RECOMMENDATION, or none.

     Four answers and no fifth. `none` is returned with a reason rather than omitted,
     because "CineBraid has no recommendation here" is itself information and the
     alternative — a rail that silently drops the section — reads as a rendering bug.

     A blocked stage is NOT a recommendation. It is the reason there is not one, and
     it carries the declared blockedReason rather than a sentence composed here. */
  function creatorRecommendation(stage, stageLabels) {
    if (!stage) return { kind: "none", reason: "no-stage-context", stageId: "", label: "" };
    if (stage.availability === "blocked")
      return { kind: "blocked", reason: stage.blockedReason || "prerequisite-unmet", stageId: stage.id, label: "" };
    if (!stage.recommendedNext)
      return { kind: "none", reason: "no-honest-recommendation", stageId: stage.id, label: "" };
    return {
      kind: "stage",
      reason: "declared-next-stage",
      stageId: stage.recommendedNext,
      label: creatorText(stageLabels && stageLabels[stage.recommendedNext]),
    };
  }

  /* ==========================================================================
     THE PROJECTION.

     One call, one frozen answer. Deliberately not a store, not an observable and not
     a cache: a caller that wants a newer answer calls again, which is what keeps
     "the Terminal and the rail agree" true by construction rather than by
     subscription bookkeeping. */
  function creatorState(input) {
    const raw = input && typeof input === "object" ? input : {};
    const contextRaw = raw.context && typeof raw.context === "object" ? raw.context : {};
    const context = {
      view: creatorText(contextRaw.view),
      hasProject: contextRaw.hasProject === true,
      shellPresent: contextRaw.shellPresent === true,
      projectTitle: creatorText(contextRaw.projectTitle),
      target: creatorTarget(contextRaw.target),
    };

    const facts = (Array.isArray(raw.activities) ? raw.activities : [])
      .map(creatorActivityFact)
      .filter((fact) => fact.key);

    const working = facts.filter((fact) => fact.kind === "machine-active").sort(byRecency);
    const waiting = facts.filter((fact) => fact.kind === "waiting-human").sort(byRecency);
    const attentionAll = facts.filter((fact) => fact.kind === "needs-attention").sort(byRecency);
    const recentAll = facts
      .filter((fact) => fact.kind === "completed" || fact.kind === "informational")
      .sort(byRecency);

    const attention = attentionAll.slice(0, CREATOR_ATTENTION_LIMIT);
    const recent = recentAll.slice(0, CREATOR_RECENT_LIMIT);

    const stage = creatorStageBlock(raw.stage);
    const stageLabels = {};
    for (const row of Array.isArray(raw.stages) ? raw.stages : []) {
      if (row && creatorText(row.id)) stageLabels[creatorText(row.id)] = creatorText(row.label);
    }
    const recommendation = creatorRecommendation(stage, stageLabels);

    /* The single most important thing, chosen by the declared order and by nothing
       else. Returned as a token pair so the Assistant writes the sentence and the
       Terminal writes the label from the same decision. */
    let headline = { kind: "all-quiet", key: "" };
    if (attention.length) headline = { kind: "needs-attention", key: attention[0].key };
    else if (waiting.length) headline = { kind: "waiting-human", key: waiting[0].key };
    else if (working.length) headline = { kind: "machine-active", key: working[0].key };
    else if (stage && stage.availability === "blocked") headline = { kind: "stage-blocked", key: stage.id };
    else if (recommendation.kind === "stage") headline = { kind: "next-action", key: recommendation.stageId };

    return deepFreeze({
      contract: CREATOR_STATE_CONTRACT,
      context,
      priority: CREATOR_PRIORITY,
      headline,
      working,
      waiting,
      attention,
      recent,
      counts: {
        working: working.length,
        waiting: waiting.length,
        attention: attentionAll.length,
        recent: recentAll.length,
        total: facts.length,
      },
      omitted: {
        attention: Math.max(0, attentionAll.length - attention.length),
        recent: Math.max(0, recentAll.length - recent.length),
      },
      history: {
        policy: "unsettled-always-plus-bounded-settled",
        attentionLimit: CREATOR_ATTENTION_LIMIT,
        recentLimit: CREATOR_RECENT_LIMIT,
        deepHistoryRoute: CREATOR_DEEP_HISTORY_ROUTE,
      },
      stage,
      recommendation,
      unavailable: CREATOR_UNAVAILABLE_KEYS,
    });
  }

  return {
    CREATOR_STATE_CONTRACT,
    CREATOR_ACTIVITY_KINDS,
    CREATOR_ACTIVITY_SOURCES,
    CREATOR_PRIORITY,
    CREATOR_REASONS,
    CREATOR_ATTENTION_RUN_STATUSES,
    CREATOR_COMPLETED_RUN_STATUSES,
    CREATOR_ACTIVE_JOB_STATUSES,
    CREATOR_ATTENTION_JOB_STATUSES,
    CREATOR_COMPLETED_JOB_STATUSES,
    CREATOR_RECENT_LIMIT,
    CREATOR_ATTENTION_LIMIT,
    CREATOR_DEEP_HISTORY_ROUTE,
    CREATOR_UNAVAILABLE,
    CREATOR_UNAVAILABLE_KEYS,
    creatorKnown,
    creatorNotApplicable,
    creatorKnownCount,
    creatorCostFact,
    creatorRunKind,
    creatorJobKind,
    creatorManualKind,
    creatorActivityFact,
    creatorStageBlock,
    creatorRecommendation,
    creatorState,
  };
});

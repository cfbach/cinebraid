/* CineBraid — the two persistent creator surfaces: the Assistant rail and the
   Activity Terminal.

   O2 built the two slots. This file fills them, and it fills BOTH from one projection.

   ---------------------------------------------------------------------------
   THE SHAPE, and the reason it is this shape.

     collectActivityFacts()   the ONLY place in O3 that touches a raw run, a raw job
                              or a raw manual row. It asks the shipped predicates —
                              v670MachineActiveRun, v670WaitingForHumanRun, falJobActive
                              — and records what they said. It decides nothing.

     creatorState()           public/shared-creator-state.js. Buckets, orders and
                              bounds. Called ONCE per paint.

     assistantMarkup(state)   filmmaker language.
     terminalMarkup(state)    technical labels.

   Both renderers read `state` and NOTHING ELSE. That is the property the whole batch
   rests on: two surfaces cannot disagree about whether a run is active if neither of
   them is in a position to have an opinion. tests/creator-state.js reads the source of
   these two functions and requires them to contain no reference to AUTOMATION_RUNS,
   FAL_GENERATION_JOBS, V641_MANUAL_ACTIVITIES or any v670 / falJob predicate, and
   tests/creator-state-negative-controls.js puts one back and requires the suite to go
   red for it.

   ---------------------------------------------------------------------------
   WHAT THIS FILE DOES NOT DO.

   * IT ADDS NO TIMER. Not one. Activity is already polled every 3.5s by
     public/live-activity.js, gated on v670RunUnsettled, and that poll already ends by
     calling v641UpdateActivityButton(). O3 repaints from the event that function now
     emits, so a second clock over the same data never exists.

   * IT MAKES NO REQUEST. No fetch, no provider call, no LLM call. The rail is
     deterministic and is fully useful with no assistant model configured — which is
     the state most installs are in, and the state every test below runs in.

   * IT WRITES NOTHING TO A PROJECT. The only things persisted anywhere are whether
     the Terminal is collapsed and whether the Assistant rail is open, both in
     localStorage. Each is a preference about a panel and not a fact about a
     production, and neither is read by anything that derives truth.

   * BOTH PANELS ARE QUIET UNTIL ASKED FOR. Batch 2, Slice 1. The rail is NOT mounted
     and the Terminal is collapsed until the filmmaker opens them, because the shipped
     defaults gave a working surface roughly 340px of permanent Assistant and an
     expanded dock before any work had been done in it. Only the DEFAULT changed: an
     explicit stored preference in either direction is honoured exactly as before, and
     everything the two surfaces render is derived from the same projection as always.

   * IT NEVER APPROVES. No control here approves media, establishes canon, or triggers
     a paid generation or a paid retry. The Assistant renders no AI review verdict at
     all: an AI PASS causes nothing on its own, so a rail that reported one would be
     inviting the reader to treat it as a decision.

   ---------------------------------------------------------------------------
   HIDDEN vs SUSPENDED, decided here and stated once.

   O2 retains mounted content when a surface becomes ineligible. O3's choice, for both
   surfaces:

     RETAINED    the mounted nodes are never destroyed by navigation. Visiting Settings
                 and coming back returns the same surface, scrolled where it was.
     SUBSCRIBED  the listeners stay attached, so the moment the shell is present again
                 the surface repaints from current truth.
     NOT PAINTED the paint is SKIPPED while the shell is absent, and a flag records
                 that the surface is stale. Repainting something nobody can see is work
                 with no reader; skipping costs nothing because both surfaces are
                 derived rather than accumulated — there is no event log inside them to
                 miss.

   Only a project going away clears them, and that is not lifecycle economy: a Terminal
   describing a production that is not open is a stale claim, not retained context.

   The rule for the future: an expensive or model-backed part of the Assistant is what
   gets suspended when hidden, never the deterministic view. O3 has no such part. */

(function () {
  if (typeof document === "undefined") return;

  /* The MOUNT nodes, not the rendered surfaces. Named `-mount` so the id and the class
     cannot be confused: `#cb-assistant-mount` is the stable node the shell holds and
     the reconciler patches into, and `.cb-assistant` is the markup inside it, which is
     rebuilt in place on every paint. A test that stamps identity wants the first; a
     test that reads what the filmmaker sees wants the second. */
  const RAIL_ROOT_ID = "cb-assistant-mount";
  const DOCK_ROOT_ID = "cb-terminal-mount";
  const TERMINAL_COLLAPSED_KEY = "cinebraid-creator-terminal-collapsed";
  /* Opt-IN, unlike the Terminal's opt-OUT. Absent means closed, "1" means the
     filmmaker opened it. Stored rather than held for the session so opening the
     Assistant is a decision that survives a reload, the way collapsing the Terminal
     always has. */
  const RAIL_OPEN_KEY = "cinebraid-creator-rail-open";
  const RAIL_TOGGLE_ID = "creator-rail-toggle";

  /* The generation ledger holds every job a project has ever dispatched, and the
     Terminal shows at most a couple of dozen settled rows. Scanning the whole ledger
     into fact records every paint would be work thrown away, so the scan is
     pre-bounded by recency — with every ACTIVE job included whatever its position, so
     a live request can never be the thing that falls off the end. */
  const JOB_SCAN_LIMIT = 60;

  let RAIL_NODE = null;
  let DOCK_NODE = null;
  let STALE = false;

  /* ==========================================================================
     READING THE APP.

     `P`, `AUTOMATION_RUNS` and `FAL_GENERATION_JOBS` are top-level bindings in
     public/app.js and `V641_MANUAL_ACTIVITIES` is one in public/live-activity.js. In a
     classic script those are lexical bindings on the shared script scope and NOT
     properties of `window` — reading `window.P` here would be undefined on every route,
     which is the defect public/focused-workspaces.js documents at its own
     activeProject(). Each is read through typeof so this file also loads in a suite's
     realm where only some of them exist. */
  function activeProject() {
    return typeof P === "undefined" ? null : P;
  }
  function automationRuns() {
    const rows = typeof AUTOMATION_RUNS === "undefined" ? null : AUTOMATION_RUNS;
    return Array.isArray(rows) ? rows : [];
  }
  function generationJobs() {
    const rows = typeof FAL_GENERATION_JOBS === "undefined" ? null : FAL_GENERATION_JOBS;
    return Array.isArray(rows) ? rows : [];
  }
  /* Through live-activity.js's own project-scoped reader, so the rail and the Terminal
     cannot present another project's rows after a switch — the same answer the drawer
     gives, not a second one. The direct Map read stays as the fallback for a suite realm
     that loads this file without live-activity.js. */
  function manualActivities() {
    if (typeof v670ManualActivityRows === "function") {
      try { return v670ManualActivityRows(); } catch { return []; }
    }
    if (typeof V641_MANUAL_ACTIVITIES === "undefined" || !V641_MANUAL_ACTIVITIES) return [];
    try { return [...V641_MANUAL_ACTIVITIES.values()]; } catch { return []; }
  }
  function currentView() {
    const hash = String(location.hash || "#/production").split("?")[0];
    return hash.split("/")[1] || "production";
  }
  function currentTargetId() {
    const hash = String(location.hash || "").split("?")[0];
    const raw = hash.split("/")[2] || "";
    try { return decodeURIComponent(raw); } catch { return raw; }
  }

  /* ==========================================================================
     THE CONTEXT.

     Eligibility is the shell's answer, not a second one: creatorShellState is the same
     derivation public/workspace-shell.js applies to the same two facts. Asking it here
     rather than re-deriving "is this a creator surface" is what stops O3 becoming a
     third opinion about where the workspace exists. */
  function currentContext() {
    const project = activeProject();
    const view = currentView();
    const shell = typeof creatorShellState === "function"
      ? creatorShellState({ view, hasProject: !!project })
      : { present: false, reason: "no-declaration" };
    const targetId = currentTargetId();
    let target = { kind: "", id: "", label: "" };
    /* The record lookups are gated on the project, not merely on the route. `shotById`
       and `sceneById` read P.shots and P.scenes directly, and this function runs on the
       very first paint - before load() has resolved - where the hash already names a
       shot and P is still null. Reading the route without that guard threw
       "Cannot read properties of null" out of a route listener on every cold start.
       The id is still recorded; only the human-readable label needs a project. */
    if (targetId) {
      if (view === "shot") {
        const shot = project && typeof shotById === "function" ? shotById(targetId) : null;
        target = { kind: "shot", id: targetId, label: shot ? (shot.title || shot.id) : targetId };
      } else if (view === "scene") {
        const scene = project && typeof sceneById === "function" ? sceneById(targetId) : null;
        target = { kind: "scene", id: targetId, label: scene ? (scene.title || scene.id) : targetId };
      } else {
        target = { kind: view, id: targetId, label: targetId };
      }
    }
    return {
      view,
      hasProject: !!project,
      shellPresent: shell.present === true,
      blockedReason: shell.reason || "",
      projectTitle: project?.meta?.title || "",
      target,
    };
  }

  /* ==========================================================================
     THE STAGE.

     Consumed from O1, never re-derived. The fact record is assembled by the shipped
     shotStageModelFacts() in public/creation-studio.js — the same call the taskbar
     makes — and the selected stage by the shipped resolveShotStageId(), so the rail
     names the stage the workspace is actually showing rather than one it worked out
     for itself.

     Returns null off a shot route, which is CREATOR_UNAVAILABLE["stage-outside-shot"]
     and not a gap to fill with the last shot visited. */
  function currentStage(context) {
    if (context.target.kind !== "shot" || !context.target.id) return null;
    if (typeof shotById !== "function" || typeof shotStageModelFacts !== "function") return null;
    const shot = shotById(context.target.id);
    if (!shot) return null;
    try {
      const takes = typeof takesFor === "function" ? takesFor(shot.id) : [];
      const facts = shotStageModelFacts(shot, takes);
      const selected = typeof boundedShotSelectedTask === "function"
        ? boundedShotSelectedTask(shot, takes)
        : (typeof recommendedShotStageId === "function" ? recommendedShotStageId(facts) : "");
      if (!selected || typeof shotStageState !== "function") return null;
      return {
        state: shotStageState(selected, facts),
        progress: typeof shotStageProgress === "function" ? shotStageProgress(facts) : [],
        shotId: shot.id,
      };
    } catch { return null; }
  }

  /* ==========================================================================
     THE FACTS.

     Everything below records what an existing reader answered. Not one status literal
     appears in this section: `creatorRunKind`, `creatorJobKind` and `creatorManualKind`
     own the bucket decision, and they receive the shipped predicates' verdicts rather
     than a status this file interpreted. */
  function runTarget(run) {
    const type = String(run?.type || "");
    if (type === "scene-chain") return { kind: "scene", id: run.targetId, label: run.targetId };
    if (type === "shot-chain") return { kind: "shot", id: run.targetId, label: run.targetId };
    if (type === "entity-chain") {
      const [list, id] = String(run.targetId || "").split(":");
      return { kind: list || "reference", id: id || "", label: id || run.targetId };
    }
    return { kind: "", id: String(run?.targetId || ""), label: String(run?.targetId || "") };
  }

  function jobRoute(job) {
    if (job?.shotId) return `#/shot/${encodeURIComponent(job.shotId)}`;
    if (job?.entityList && job?.entityId) {
      const route = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle", audio: "sound" }[job.entityList] || "library";
      return `#/${route}/${encodeURIComponent(job.entityId)}`;
    }
    return "#/production";
  }

  function jobTarget(job) {
    if (job?.shotId) return { kind: "shot", id: job.shotId, label: job.shotId };
    if (job?.entityId) return { kind: job.entityList || "reference", id: job.entityId, label: job.entityId };
    return { kind: "", id: "", label: "" };
  }

  /* The provider block for one generation job. `falJobProviderRequestId` is the only
     honest reader for the request handle: `job.providerRequestId` and `job.requestId`
     are names no writer in CineBraid has ever produced, and every screen that read them
     rendered nothing while looking like it had checked. */
  function jobTechnical(job) {
    if (!job) return null;
    return {
      provider: job.provider || "",
      model: job.model || "",
      mode: job.mode || "",
      purpose: job.purpose || "",
      requestId: typeof falJobProviderRequestId === "function" ? falJobProviderRequestId(job) : "",
      statusLabel: typeof falJobStatusLabel === "function" ? falJobStatusLabel(job) : String(job.status || ""),
      queuePosition: job.queuePosition,
      /* A retry is a new job row with a new id, so there is no attempt number to
         report and reporting one would be inventing it. */
      attemptApplicable: false,
      cost: typeof creatorCostFact === "function" ? creatorCostFact(job) : null,
      error: job.error || job.unresolvedReason || "",
    };
  }

  function runFacts() {
    /* All three verdicts come from public/live-activity.js. Nothing in this file may
       ask "is this run running / waiting / broken" of a status string: the Activity
       drawer, the toolbar and these two surfaces answer that question with the same
       three functions or they will eventually answer it differently. */
    const machineActive = typeof v670MachineActiveRun === "function" ? v670MachineActiveRun : () => false;
    const waitingForHuman = typeof v670WaitingForHumanRun === "function" ? v670WaitingForHumanRun : () => false;
    const needsAttention = typeof v670AttentionRun === "function" ? v670AttentionRun : () => false;
    return automationRuns()
      .filter((run) => run && run.status !== "archived")
      .map((run) => {
        const bucket = creatorRunKind({
          status: run.status,
          machineActive: machineActive(run) === true,
          waitingForHuman: waitingForHuman(run) === true,
          needsAttention: needsAttention(run) === true,
        });
        const view = typeof v641DisplayedRunAndStep === "function"
          ? v641DisplayedRunAndStep(run)
          : { displayRun: run, step: null };
        const step = view.step || null;
        const failedStep = Object.values(run.steps || {}).find((item) => item?.status === "failed") || null;
        const job = step && typeof v641FalJobForStep === "function" ? v641FalJobForStep(step) : null;
        const provider = jobTechnical(job) || {};
        /* NO CLOCK NEXT TO A ROW THAT SAYS THE MACHINE STOPPED.

           v670StepElapsedLabel freezes on the STEP's own status, which is right for
           the case it was written for - a step parked at `needs-review` stops, and its
           frozen "01:00" is genuinely useful. An ABANDONED run is different: the tab
           closed, nothing rewrote the step, so the step record still reads `running`
           and the shipped reader keeps counting. The row would then say STOPPED beside
           a ticking timer.

           The reader is not changed - that would be a second opinion about step state,
           and the same overloaded record is read by the drawer. The label is simply not
           COLLECTED when the run is not machine-active and its step still claims to be:
           the coarser truthful answer is no elapsed time, not a wrong one. */
        const stepStillClaimsRunning = typeof v670MachineActiveStep === "function"
          ? v670MachineActiveStep(step) === true
          : step?.status === "running";
        const clockIsHonest = bucket.kind === "machine-active" || !stepStillClaimsRunning;
        return {
          key: `run:${run.id}`,
          source: "automation-run",
          id: run.id,
          label: run.label || run.targetId || run.id,
          kind: bucket.kind,
          reason: bucket.reason,
          target: runTarget(run),
          route: typeof v641RunRoute === "function" ? v641RunRoute(run) : "#/production",
          at: run.updatedAt || run.createdAt || "",
          startedAt: run.createdAt || "",
          endedAt: run.completedAt || "",
          elapsed: step && clockIsHonest && typeof v670StepElapsedLabel === "function" ? v670StepElapsedLabel(step) : "",
          step: {
            label: step ? (step.label || step.key || "") : (run.stage || ""),
            system: step && typeof v641StepSystem === "function" ? v641StepSystem(step) : "",
            state: step && typeof v641StepState === "function" ? v641StepState(step) : "",
          },
          technical: {
            ...provider,
            attemptApplicable: true,
            attempt: step?.attempt,
            maxAttempts: step?.maxAttempts,
            retryCount: step?.retryCount,
            error: failedStep?.error || provider.error || "",
          },
        };
      });
  }

  function manualFacts() {
    return manualActivities().map((row) => {
      const bucket = creatorManualKind(row.status);
      return {
        key: `manual:${row.id}`,
        source: "manual",
        id: row.id,
        label: row.title || "Local operation",
        kind: bucket.kind,
        reason: bucket.reason,
        target: { kind: "", id: "", label: "" },
        route: String(row.meta?.route || ""),
        at: row.updatedAt || row.startedAt || "",
        startedAt: row.startedAt || "",
        endedAt: row.completedAt || "",
        elapsed: typeof v670ManualElapsedLabel === "function" ? v670ManualElapsedLabel(row) : "",
        step: { label: row.detail || "", system: row.system || "", state: row.status || "" },
        /* A local request records no provider, model, request id or price. Every field
           is therefore not-recorded, which is what the surfaces will say. */
        technical: { attemptApplicable: false },
      };
    });
  }

  /* Jobs that no automation run owns. A run-owned job is already represented by its
     run's row, carrying that job's provider, model and cost — listing it twice would
     double-count the same paid request in a surface whose job is to be exact. */
  function jobFacts() {
    const owned = new Set(
      automationRuns().flatMap((run) => Object.values(run.steps || {}).map((step) => step?.childJobId).filter(Boolean)),
    );
    const active = typeof falJobActive === "function" ? falJobActive : () => false;
    const rows = generationJobs().filter((job) => job && !owned.has(job.id));
    const recent = [...rows]
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, JOB_SCAN_LIMIT);
    const scan = new Map(recent.map((job) => [job.id, job]));
    for (const job of rows) if (active(job) === true) scan.set(job.id, job);
    return [...scan.values()].map((job) => {
      /* `uncertain` is the server's own answer, carried on every job by publicJob(). The
         collection point passes it through; the classifier decides. */
      const bucket = creatorJobKind({ status: job.status, active: active(job) === true, uncertain: job.uncertain === true });
      return {
        key: `job:${job.id}`,
        source: "generation-job",
        id: job.id,
        label: job.purpose ? `${job.purpose} generation` : "Generation",
        kind: bucket.kind,
        reason: bucket.reason,
        target: jobTarget(job),
        route: jobRoute(job),
        at: job.updatedAt || job.createdAt || "",
        startedAt: job.createdAt || "",
        endedAt: job.ingestedAt || "",
        elapsed: "",
        step: {
          label: typeof falJobStatusLabel === "function" ? falJobStatusLabel(job) : String(job.status || ""),
          system: "",
          state: String(job.status || ""),
        },
        technical: jobTechnical(job),
      };
    });
  }

  function collectActivityFacts() {
    return [...runFacts(), ...manualFacts(), ...jobFacts()];
  }

  function projection() {
    const context = currentContext();
    const stage = currentStage(context);
    return creatorState({
      context,
      activities: collectActivityFacts(),
      stage: stage ? stage.state : null,
      stages: stage ? stage.progress : [],
    });
  }

  /* ==========================================================================
     WORDING — the Assistant's, and only the Assistant's.

     Tokens in, sentences out. The Terminal formats the same tokens its own way, which
     is why neither vocabulary lives in the projection. */
  const WAITING_SENTENCE = {
    "approval-required": "Review the result and approve or reject it to continue.",
    "runner-stopped": "Orchestration stopped. Open the run and choose Resume Run.",
  };
  const ATTENTION_SENTENCE = {
    "run-failed": "This run failed and did not finish.",
    "run-interrupted": "This run was interrupted. Open it to see what it needs.",
    "run-cancelled": "This run was cancelled.",
    "request-failed": "A local request failed.",
    "generation-failed": "The provider declined this generation.",
    "generation-cancelled": "This generation was cancelled.",
    "submission-unresolved": "CineBraid does not know whether the provider accepted this. Check before generating it again.",
    "provider-ran-uncollected": "This ran at the provider and was never collected here.",
  };
  const HEADLINE_EYEBROW = {
    "needs-attention": "NEEDS ATTENTION",
    "waiting-human": "WAITING FOR YOU",
    "machine-active": "WORKING",
    "stage-blocked": "BLOCKED",
    "next-action": "NEXT",
    /* Run-scoped, like the sentence beneath it. "ALL QUIET" is a claim about the
       whole production, and this projection has only ever seen run activity. */
    "all-quiet": "NO ACTIVITY",
  };
  const STAGE_COMPLETION_SENTENCE = {
    "not-started": "Not started",
    "in-progress": "In progress",
    "needs-review": "Needs your review",
    complete: "Complete",
  };

  /* THE ASSISTANT DESCRIBES RUN ACTIVITY, AND ITS SENTENCES MAY NOT REACH FURTHER.
   *
   * Every fact behind `state` is an ACTIVITY fact — an automation run, a manual
   * generation, a provider job. The projection has never been able to see a
   * filmmaker decision and must not start: canonical readiness owns that question
   * and Production renders its answer.
   *
   * Which is why the quiet sentence used to be false. "Nothing is running and
   * nothing is waiting on you" is two claims, and the second one is about a scope
   * this file cannot observe: a project with three outstanding decisions and no
   * running job produced it verbatim. The first half was always true. The second
   * half is now stated at the scope it is true at — no run and no generation job —
   * and the reader is pointed at the surface that owns the other question rather
   * than being told there is nothing there. */
  function headlineSentence(state) {
    const kind = state.headline.kind;
    if (kind === "needs-attention")
      return `${plural(state.counts.attention, "thing needs", "things need")} your attention.`;
    if (kind === "waiting-human")
      return state.counts.waiting === 1
        ? "CineBraid is waiting for you."
        : `${plural(state.counts.waiting, "run is", "runs are")} waiting for you.`;
    if (kind === "machine-active")
      return state.counts.working === 1
        ? "CineBraid is working."
        : `${plural(state.counts.working, "operation is", "operations are")} running.`;
    if (kind === "stage-blocked") return `${state.stage.label} cannot start yet.`;
    if (kind === "next-action") return `Ready to move to ${state.recommendation.label || state.recommendation.stageId}.`;
    return "No runs or generation jobs are active.";
  }

  function contextLine(state) {
    const target = state.context.target;
    if (target.kind === "shot" && target.id) return `Shot ${target.id}`;
    if (target.kind === "scene" && target.id) return `Scene ${target.id}`;
    if (target.id) return target.label || target.id;
    return state.context.projectTitle || "This production";
  }

  function assistantRow(fact, sentence) {
    const detail = [fact.step.system, fact.step.label].filter(Boolean).join(" · ");
    const unresolved = fact.reason === "submission-unresolved";
    const open = fact.source === "automation-run"
      ? `<button type="button" class="cb-assistant-action" onclick="openGlobalAutomationActivity('${attr(fact.id)}')">Open activity</button>`
      : "";
    const go = fact.route
      ? `<button type="button" class="cb-assistant-action" onclick="location.hash='${attr(fact.route)}'">Take me there</button>`
      : "";
    const resolve = unresolved
      ? `<button type="button" class="cb-assistant-action" onclick="openFalUnresolvedModal('${attr(fact.id)}')">Check and resolve</button>`
      : "";
    return `<article class="cb-assistant-row"><b>${esc(fact.label)}</b>${sentence ? `<p>${esc(sentence)}</p>` : ""}`
      + `${detail ? `<small>${esc(detail)}${fact.elapsed ? ` · ${esc(fact.elapsed)}` : ""}</small>` : ""}`
      + `<div class="cb-assistant-row-actions">${go}${resolve}${open}</div></article>`;
  }

  function assistantSection(tone, title, rows) {
    if (!rows.length) return "";
    return `<section class="cb-assistant-section tone-${attr(tone)}" data-cb-section="${attr(tone)}">`
      + `<header><b>${esc(title)}</b><span>${rows.length}</span></header>${rows.join("")}</section>`;
  }

  /* THE STAGE BLOCK, written from O1's answer and nothing else. `availability`,
     `blockedReason` and `completion` are printed as the declaration returned them: a
     rail that softened a blocked stage into "not started yet" would be describing a
     workflow CineBraid does not have. */
  function assistantStageSection(state) {
    const stage = state.stage;
    if (!stage) return "";
    const blocked = stage.availability === "blocked";
    const shotId = state.context.target.id;
    const jump = (id, label) => (shotId
      ? `<button type="button" class="cb-assistant-action" onclick="selectBoundedTask('shot-task','${attr(shotId)}','${attr(id)}')">${esc(label)}</button>`
      : "");
    const status = blocked
      ? stage.blockedReason
      : STAGE_COMPLETION_SENTENCE[stage.completion] || stage.completion;
    return `<section class="cb-assistant-section tone-stage" data-cb-section="stage">`
      + `<header><b>Current step</b><span>${esc(stage.label)}</span></header>`
      + `<article class="cb-assistant-row"><b>${esc(stage.label)}</b><p>${esc(stage.purpose)}</p>`
      + `<small>${esc(status)}${stage.optional ? " · optional" : ""}</small></article></section>`
      + assistantNextSection(state, jump);
  }

  /* NO RECOMMENDATION IS A RESULT. `recommendedNext === ""` is the declared model
     saying it does not know what should happen next — an undecided shot gets no guess
     — and printing nothing at all would read as a rendering fault rather than as the
     honest answer it is. */
  function assistantNextSection(state, jump) {
    const recommendation = state.recommendation;
    if (recommendation.kind === "stage")
      return `<section class="cb-assistant-section tone-next" data-cb-section="next">`
        + `<header><b>Next action</b></header>`
        + `<article class="cb-assistant-row"><b>${esc(recommendation.label || recommendation.stageId)}</b>`
        + `<p>CineBraid recommends this next.</p>`
        + `<div class="cb-assistant-row-actions">${jump(recommendation.stageId, `Open ${recommendation.label || recommendation.stageId}`)}</div></article></section>`;
    if (recommendation.kind === "blocked")
      return `<section class="cb-assistant-section tone-next" data-cb-section="next">`
        + `<header><b>Next action</b></header>`
        + `<article class="cb-assistant-row"><b>Blocked</b><p>${esc(recommendation.reason)}</p></article></section>`;
    return `<section class="cb-assistant-section tone-next" data-cb-section="next">`
      + `<header><b>Next action</b></header>`
      + `<article class="cb-assistant-row cb-assistant-quiet"><p>No recommendation is available yet. CineBraid only recommends a next step when the shot has said what it is being delivered as.</p></article></section>`;
  }

  function assistantMarkup(state) {
    const kind = state.headline.kind;
    const attention = state.attention.map((fact) => assistantRow(fact, ATTENTION_SENTENCE[fact.reason] || ""));
    const waiting = state.waiting.map((fact) => assistantRow(fact, WAITING_SENTENCE[fact.reason] || ""));
    const working = state.working.map((fact) => assistantRow(fact, ""));
    const quiet = !attention.length && !waiting.length && !working.length
      ? `<section class="cb-assistant-section tone-quiet" data-cb-section="quiet"><article class="cb-assistant-row cb-assistant-quiet"><p>No runs or generation jobs are active. Decisions that need you are shown in Production.</p></article></section>`
      : "";
    const omitted = state.omitted.attention
      ? `<p class="cb-assistant-omitted">${esc(`${state.omitted.attention} older item${state.omitted.attention === 1 ? "" : "s"} needing attention are not shown here.`)}</p>`
      : "";
    return `<div class="cb-assistant" data-cb-assistant="1" data-headline="${attr(kind)}">`
      + `<header class="cb-assistant-head"><span>${esc(HEADLINE_EYEBROW[kind] || "ASSISTANT")}</span>`
      + `<b>${esc(headlineSentence(state))}</b><small>${esc(contextLine(state))}</small></header>`
      + `<div class="cb-assistant-body">`
      + assistantSection("attention", "Needs attention", attention)
      + assistantSection("waiting", "Waiting for you", waiting)
      + assistantSection("working", "Working", working)
      + quiet
      + assistantStageSection(state)
      + `</div>`
      + `<footer class="cb-assistant-foot">${omitted}`
      + `<button type="button" class="cb-assistant-action" onclick="openGlobalAutomationActivity()">Open activity details</button></footer></div>`;
  }

  /* ==========================================================================
     THE TERMINAL.

     Operational, dense, and deliberately not narrated. Every value below is either
     recorded or explicitly absent — there is no branch that supplies a default, which
     is what makes "cost not recorded" impossible to turn into "$0.00" by a later edit. */
  const TERMINAL_STATUS = {
    "machine-active": "RUNNING",
    "waiting-human:approval-required": "AWAITING REVIEW",
    "waiting-human:runner-stopped": "STOPPED",
    "needs-attention:run-failed": "FAILED",
    "needs-attention:run-interrupted": "INTERRUPTED",
    "needs-attention:run-cancelled": "CANCELLED",
    "needs-attention:request-failed": "FAILED",
    "needs-attention:generation-failed": "FAILED",
    "needs-attention:generation-cancelled": "CANCELLED",
    "needs-attention:submission-unresolved": "UNRESOLVED",
    "needs-attention:provider-ran-uncollected": "ORPHANED",
    completed: "COMPLETED",
    informational: "SETTLED",
  };
  const TERMINAL_TONE = {
    "machine-active": "working",
    "waiting-human": "waiting",
    "needs-attention": "attention",
    completed: "done",
    informational: "idle",
  };

  function terminalStatus(fact) {
    return TERMINAL_STATUS[`${fact.kind}:${fact.reason}`] || TERMINAL_STATUS[fact.kind] || fact.kind.toUpperCase();
  }

  /* The recorded moment, formatted. Never "now": a settled row's time is when it
     settled, and a row with no usable timestamp prints nothing rather than the clock. */
  function terminalClock(iso) {
    const at = Date.parse(String(iso || ""));
    if (!Number.isFinite(at)) return "";
    const date = new Date(at);
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function terminalCost(cost) {
    if (!cost || cost.state === "not-applicable") return "";
    if (cost.state === "estimated") return `est $${Number(cost.amount).toFixed(2)}`;
    /* Two different absences and two different words. Neither of them is a number. */
    if (cost.state === "unknown") return "cost not priced";
    return "cost not recorded";
  }

  function terminalMeta(fact) {
    const tech = fact.technical;
    const parts = [];
    if (tech.provider.state === "known") parts.push(tech.provider.value);
    if (tech.model.state === "known") parts.push(tech.model.value);
    if (tech.mode.state === "known") parts.push(tech.mode.value);
    if (tech.requestId.state === "known") parts.push(`req ${tech.requestId.value}`);
    if (tech.queuePosition.state === "known") parts.push(`queue ${tech.queuePosition.value}`);
    if (tech.attempt.state === "known" && tech.attempt.number > 0)
      parts.push(tech.maxAttempts.state === "known" && tech.maxAttempts.number > 0
        ? `attempt ${tech.attempt.value}/${tech.maxAttempts.value}`
        : `attempt ${tech.attempt.value}`);
    if (tech.retryCount.state === "known" && tech.retryCount.number > 0) parts.push(`${tech.retryCount.value} retries`);
    const cost = terminalCost(tech.cost);
    if (cost) parts.push(cost);
    return parts;
  }

  function terminalRow(fact) {
    const tone = TERMINAL_TONE[fact.kind] || "idle";
    const clock = terminalClock(fact.at);
    const context = [fact.target.id, fact.step.system, fact.step.label].filter(Boolean).join(" · ");
    const meta = terminalMeta(fact);
    const resolve = fact.reason === "submission-unresolved"
      ? `<button type="button" class="cb-terminal-action" onclick="openFalUnresolvedModal('${attr(fact.id)}')">CHECK</button>`
      : "";
    const label = fact.route
      ? `<button type="button" class="cb-terminal-open" onclick="location.hash='${attr(fact.route)}'">${esc(fact.label)}</button>`
      : `<b>${esc(fact.label)}</b>`;
    return `<article class="cb-terminal-row tone-${attr(tone)}" data-activity-key="${attr(fact.key)}" data-cb-kind="${attr(fact.kind)}">`
      + `<time>${esc(clock)}</time><em>${esc(terminalStatus(fact))}</em>`
      + `<div class="cb-terminal-body">${label}${context ? `<small>${esc(context)}</small>` : ""}`
      + `${fact.technical.error.state === "known" ? `<small class="cb-terminal-error">${esc(fact.technical.error.value)}</small>` : ""}</div>`
      + `<div class="cb-terminal-meta">${meta.map((part) => `<span>${esc(part)}</span>`).join("")}${fact.elapsed ? `<span>${esc(fact.elapsed)}</span>` : ""}${resolve}</div></article>`;
  }

  function terminalMarkup(state, collapsed) {
    const rows = [...state.working, ...state.waiting, ...state.attention, ...state.recent];
    /* A COUNT OF NOTHING IS NOT NEWS.
     *
     * This line is permanent chrome across the bottom of every screen, and while a
     * project is idle it read "0 running · 0 waiting · 0 needing attention" — three
     * zeros competing with the filmmaker's actual task for the same attention that
     * one real running job will need. It now states only what is true: a zero is
     * omitted, and when every count is zero it says so in one quiet phrase.
     *
     * Nothing is removed. The counts, the rows, the collapse control, OPEN ACTIVITY
     * and the deep history in Reports are all exactly where they were, and the
     * instant anything is running, waiting or needing attention it is named here —
     * more prominently than before, because it is no longer one of three. */
    const parts = [
      state.counts.working ? `${state.counts.working} running` : "",
      state.counts.waiting ? `${state.counts.waiting} waiting` : "",
      state.counts.attention ? `${state.counts.attention} needing attention` : "",
    ].filter(Boolean);
    const summary = parts.length ? parts.join(" · ") : "Nothing running";
    /* What is NOT shown is stated, because a bounded surface that truncates silently
       reads as a complete one. Deep history is already paginated in Reports and this
       says so rather than quietly becoming a worse copy of it. */
    const omitted = [
      state.omitted.attention ? `${state.omitted.attention} older needing attention` : "",
      state.omitted.recent ? `${state.omitted.recent} older settled` : "",
    ].filter(Boolean).join(" · ");
    const body = collapsed
      ? ""
      : `<div class="cb-terminal-rows">${rows.map(terminalRow).join("")
        || `<div class="cb-terminal-empty"><span>No recorded activity in this project yet.</span></div>`}</div>`
        + `<footer class="cb-terminal-foot"><span>${esc(omitted ? `Not shown: ${omitted}.` : `Showing the ${rows.length} most recent event${rows.length === 1 ? "" : "s"}.`)}</span>`
        + `<a href="${attr(state.history.deepHistoryRoute)}">Full run history in Reports</a></footer>`;
    return `<div class="cb-terminal" data-cb-terminal="1" data-collapsed="${collapsed ? "1" : "0"}">`
      + `<header class="cb-terminal-head"><span>ACTIVITY TERMINAL</span><b>${esc(summary)}</b>`
      + `<div class="cb-terminal-head-actions">`
      + `<button type="button" class="cb-terminal-action" onclick="openGlobalAutomationActivity()">OPEN ACTIVITY</button>`
      + `<button type="button" class="cb-terminal-action" onclick="window.CineBraidCreatorSurfaces.toggleTerminal()" aria-expanded="${collapsed ? "false" : "true"}">${collapsed ? "EXPAND" : "COLLAPSE"}</button>`
      + `</div></header>${body}</div>`;
  }

  /* ==========================================================================
     PAINTING.

     Mount once, patch afterwards. Replacing the mounted node on every activity tick
     would reintroduce, in a permanent surface, the exact defect the Activity drawer was
     repaired for: a control detaching under the pointer every 3.5 seconds. The
     reconciler is the SAME one the drawer uses — v670PatchElement in
     public/live-activity.js — so there is one patching behaviour in CineBraid rather
     than two that can diverge. The wholesale path is kept for a DOM that cannot parse
     innerHTML, probed by the shipped v670DomCanReconcile rather than by sniffing for a
     test environment. */
  function applyMarkup(node, markup) {
    if (!node) return;
    const canReconcile = typeof v670DomCanReconcile === "function"
      && typeof v670PatchElement === "function"
      && v670DomCanReconcile(document)
      && node.firstElementChild;
    if (!canReconcile) { node.innerHTML = markup; return; }
    const staging = document.createElement("div");
    staging.innerHTML = markup;
    const next = staging.firstElementChild;
    if (!next) { node.innerHTML = markup; return; }
    v670PatchElement(node.firstElementChild, next);
  }

  /* COLLAPSED UNLESS EXPLICITLY EXPANDED. The stored value is unchanged and still
     means what it always did - "1" collapsed, "0" expanded - so a filmmaker who had
     expanded the Terminal keeps it expanded and one who had collapsed it keeps it
     collapsed. What changed is the answer for NO stored value, which used to be
     expanded. Reading the raw item rather than comparing it to "1" is what makes the
     three cases distinguishable at all. */
  function terminalCollapsed() {
    try {
      const stored = localStorage.getItem(TERMINAL_COLLAPSED_KEY);
      return stored === null ? true : stored !== "0";
    } catch { return true; }
  }

  /* CLOSED UNTIL OPENED. Absent is closed; only an explicit "1" opens the rail. */
  function railOpen() {
    try { return localStorage.getItem(RAIL_OPEN_KEY) === "1"; } catch { return false; }
  }

  /* Takes the rail slot back, and ONLY when this file is the thing occupying it.

     clearSlot() empties whatever is in the slot, so an unconditional call on every
     paint would evict content another consumer mounted - which is not hypothetical:
     tests/workspace-shell-real-browser.py mounts its own fixture there to prove the
     slot contract. Closing the Assistant must mean "take mine out", never "empty the
     slot". */
  function closeRailMount() {
    const shell = window.CineBraidShell;
    if (RAIL_NODE && RAIL_NODE.isConnected && shell && typeof shell.clearSlot === "function") shell.clearSlot("rail");
    RAIL_NODE = null;
  }

  function ensureMounted() {
    const shell = window.CineBraidShell;
    if (!shell || typeof shell.mountSlot !== "function") return false;
    /* The rail is mounted only when it is open. An unoccupied slot already collapses -
       shared-workspace-shell.js declares collapsesWhenEmpty and styles.css grants the
       340px track only under [data-occupied] - so NOT MOUNTING is the whole mechanism
       by which the centre reclaims the width. There is no new layout rule here and no
       second notion of "closed". */
    if (!railOpen()) closeRailMount();
    else if (!RAIL_NODE || !RAIL_NODE.isConnected) {
      RAIL_NODE = document.createElement("div");
      RAIL_NODE.id = RAIL_ROOT_ID;
      RAIL_NODE.className = "cb-assistant-mount";
      if (!shell.mountSlot("rail", RAIL_NODE)) { RAIL_NODE = null; return false; }
    }
    if (!DOCK_NODE || !DOCK_NODE.isConnected) {
      DOCK_NODE = document.createElement("div");
      DOCK_NODE.id = DOCK_ROOT_ID;
      DOCK_NODE.className = "cb-terminal-mount";
      if (!shell.mountSlot("dock", DOCK_NODE)) { DOCK_NODE = null; return false; }
    }
    return true;
  }

  function unmount() {
    const shell = window.CineBraidShell;
    if (shell && typeof shell.clearSlot === "function") { shell.clearSlot("rail"); shell.clearSlot("dock"); }
    RAIL_NODE = null;
    DOCK_NODE = null;
  }

  function paint() {
    const context = currentContext();
    /* No project, no surfaces. This is the one case that clears rather than retains:
       a Terminal describing a production that is not open is a stale claim, and there
       is no conversation or scroll position worth keeping when there is nothing to
       have been talking about. */
    if (!context.hasProject) { unmount(); syncRailToggle(false); STALE = false; return null; }
    syncRailToggle(context.shellPresent);
    if (!ensureMounted()) return null;
    /* Retained, subscribed, not painted. See the lifecycle note at the top. */
    if (!context.shellPresent) { STALE = true; return null; }
    STALE = false;
    const state = projection();
    /* applyMarkup already no-ops on a null node, so a closed rail is simply not
       painted. It is not painted into a hidden container either - there is no
       container. */
    applyMarkup(RAIL_NODE, assistantMarkup(state));
    applyMarkup(DOCK_NODE, terminalMarkup(state, terminalCollapsed()));
    /* TELL THE SHELL ITS DOCK CHANGED HEIGHT, rather than waiting to be noticed.

       The dock is position:fixed, so it cannot push the centre and instead hands the
       space back through --cb-dock-reserve, which public/workspace-shell.js measures.
       O2 keeps that number current with a ResizeObserver — correct for content that
       reflows on its own, and NOT sufficient here: mountSlot() measures an empty node,
       the Terminal's markup lands immediately afterwards, and the observer's callback
       is only delivered at a rendering opportunity. Observed in Chromium against the
       sandbox: the dock rendered 145px tall while the reservation still read 1px, so
       the bottom 144px of the workspace sat behind the Terminal.

       This consumer knows the exact moment the dock's content changed, so it says so.
       Synchronous, idempotent, and it leaves the observer in place as the backstop for
       reflows nobody initiated — a font loading, a viewport change. */
    remeasureShell();
    return state;
  }

  /* MEASURED TWICE, AND THE SECOND ONE IS NOT BELT-AND-BRACES.

     The reservation has a genuine feedback loop, observed in Chromium against the
     sandbox: writing --cb-dock-reserve lengthens #workspace, which can bring on the
     document scrollbar, which narrows the viewport, which narrows the fixed dock,
     which rewraps the Terminal's footer and changes the dock's height. The first
     measurement cannot see its own consequence — it was taken before the reservation
     existed — and it settled 15px too tall, leaving a dead band under the workspace.

     So: measure now, so the reservation is never stale for a whole frame, and measure
     again once layout has settled. One frame, not a timer, and both calls are the
     shell's own measurement rather than a second opinion about the dock's height. */
  function remeasureShell() {
    const shell = window.CineBraidShell;
    if (!shell || typeof shell.syncCreatorShell !== "function") return;
    shell.syncCreatorShell();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => shell.syncCreatorShell());
  }

  function toggleTerminal() {
    const next = terminalCollapsed() ? "0" : "1";
    try { localStorage.setItem(TERMINAL_COLLAPSED_KEY, next); } catch {}
    paint();
  }

  /* THE OPEN CONTROL, in the topbar beside the Activity chip.

     It is declared in public/index.html rather than created here, for the reason the
     shell regions are: a control built by JavaScript is a control that can be built
     twice. This only reflects state onto it; index.html binds the click. */
  function syncRailToggle(enabled) {
    const button = document.getElementById(RAIL_TOGGLE_ID);
    if (!button) return;
    const open = railOpen();
    button.hidden = !enabled;
    button.disabled = !enabled;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.classList.toggle("open", open);
    button.title = open ? "Close the Assistant rail" : "Open the Assistant rail";
  }

  function setRail(open) {
    try { localStorage.setItem(RAIL_OPEN_KEY, open ? "1" : "0"); } catch {}
    if (!open) closeRailMount();
    paint();
    /* Opening takes width from the centre and closing gives it back, and the shell's
       own measurement is what the dock reservation and the bar both depend on. Ask it
       to re-measure rather than leaving that to the next unrelated event. */
    remeasureShell();
    return railOpen();
  }

  function toggleRail() {
    return setRail(!railOpen());
  }

  /* ==========================================================================
     WIRING.

     The three route/project signals the shell already listens to, plus the one the
     activity layer now emits at the end of every update. No timer of this file's own,
     and no fetch: every repaint is a reaction to work somebody else already did. */
  window.addEventListener("hashchange", paint);
  window.addEventListener("cinebraid:route-rendered", paint);
  window.addEventListener("cinebraid:workspace-updated", paint);
  window.addEventListener("cinebraid:activity-updated", paint);
  window.addEventListener("load", paint);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();

  window.CineBraidCreatorSurfaces = {
    paint,
    toggleTerminal,
    toggleRail,
    openRail: () => setRail(true),
    closeRail: () => setRail(false),
    railOpen,
    terminalCollapsed,
    projection,
    assistantMarkup,
    terminalMarkup,
    collectActivityFacts,
    isStale: () => STALE,
  };
})();

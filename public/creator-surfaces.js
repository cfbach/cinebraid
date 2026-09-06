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

   * IT MAKES NO REQUEST. No fetch, no provider call, no LLM call. Everything THIS file
     renders is deterministic and is fully useful with no assistant model configured —
     which is the state most installs are in, and the state every test below runs in.

     Braidy, which public/braidy-rail.js owns and this file composes into the top of
     the rail, does make one request. That is the whole of the difference and it is
     kept on the far side of braidyBlock(): the block returns "" when Braidy is absent
     or throws, so every section below it renders byte-identically either way.

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

   The rule stated here for the future was that an expensive or model-backed part of the
   Assistant is what gets suspended when hidden, never the deterministic view. Braidy is
   that part, and it is held to it: closing the rail ABORTS its outstanding question
   rather than leaving it to land on a surface nobody can see, and a production going
   away clears its conversation for the same reason it clears the Terminal. Both are
   called from paint() and setRail() through braidySignal(), because this file is the
   only thing that knows either event happened. */

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
  /* Set by public/live-activity.js when the server answers for a DIFFERENT project
     than this window is showing. It is a scalar fact about this window, not activity
     data, and the drawer that used to announce it is gone — so the Terminal says it.
     Read here rather than in the renderer for the same reason every other app binding
     is: the two surfaces must not be in a position to hold an opinion. */
  function foreignActivityProject() {
    return typeof V641_ACTIVITY_FOREIGN_PROJECT === "undefined" ? "" : String(V641_ACTIVITY_FOREIGN_PROJECT || "");
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
        /* WHICH STEP THE PROVIDER BLOCK COMES FROM, and why it is not only the displayed
           one. v641DisplayedRunAndStep returns no step for a run that has already
           FAILED — there is no current work to display — so a failed run collected no
           provider, model or mode at all. Nothing looked wrong: the row simply never
           mentioned which provider had failed, and the failure-group signature, which
           reads those fields to keep unlike failures apart, had nothing to read. So the
           failed step is the fallback source: it is the step the row is about, and its
           job is the request that actually failed. */
        const providerStep = step || failedStep;
        const job = providerStep && typeof v641FalJobForStep === "function" ? v641FalJobForStep(providerStep) : null;
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
          /* THE EXACT-RESULT HANDOFF, ASKED ONCE AND ASKED HERE.
             v670RunResultTarget is the shipped resolver: it consults the declared stage
             model for a shot-chain and the real entity for an entity-chain, and reports
             `resolved` only when the thing the run produced actually exists. Asking it
             from terminalRow would put a classifier back inside a renderer, which is the
             property this whole file is built on, so the ANSWER is collected and the
             renderer only reads it. openRunResult() then performs the handoff, including
             its own fall back to the workspace route when the target cannot be resolved
             — this records which of the two the filmmaker is about to get, nothing more.

             ASKED ONLY FOR A SETTLED RUN. The resolver consults the declared stage model
             or looks a real entity up, and doing that for every run in a long ledger on
             every 3.5s repaint would be work with no reader: the handoff is offered on
             completed rows and nowhere else. */
          resultResolved: bucket.kind === "completed" && typeof v670RunResultTarget === "function"
            ? !!v670RunResultTarget(run).resolved
            : false,
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
        /* R12 — THE ROW THAT SAYS RESULTS RETURNED CAN OPEN THEM.
           The same reveal the completion strip uses, named here rather than
           re-implemented, so the Activity Terminal and the generation surface hand a
           filmmaker to one candidate section by one mechanism. Only an entity
           reference job that actually delivered something offers it. */
        reveal: job.purpose === "entity-reference"
          && job.status === "COMPLETED"
          && job.entityList
          && job.entityId
          && Number(job.outputCount || (job.outputs || []).length || 0) > 0
          ? { list: String(job.entityList), entityId: String(job.entityId), jobId: String(job.id) }
          : null,
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


  /* THE ONE CONVERGENCE POINT, and the reason it is here rather than everywhere.

     "Plan with Braidy" hands over the declared stage block: which step this is, what
     it is for, whether it is blocked and why, and the shot it belongs to. Those are
     O1's answers, copied verbatim — the handoff carries CineBraid's facts so Braidy
     interprets them instead of guessing at them, and public/shared-braidy.js freezes
     them on the way through so an interpretation cannot edit its own evidence.

     The existing contextual AI actions are NOT rerouted through here. Improving a
     prompt, reviewing a candidate and building scene audio each already have an owner,
     a working request and an explicit filmmaker choice at the end of it; a Braidy
     button that re-implemented any of them would be a second way to do one thing.
     Braidy's job beside them is the part none of them does — reading the situation
     out loud — and its destinations lead back to those owners. */
  function braidyStageAction(state) {
    const braidy = window.CineBraidBraidy;
    if (!braidy || typeof braidyPlan !== "function") return "";
    /* NOT OFFERED WHEN THERE IS NOTHING TO ANSWER WITH. Asked of Braidy rather than of
       AGENT_STATUS, because the claim about what Braidy can do has one owner and this
       file is not it. A control whose only outcome is the assistant refusing is worse
       than no control: the rail already says, in its own words, what is missing. */
    try { if (typeof braidy.capability === "function" && !braidy.capability().available) return ""; } catch { return ""; }
    const stage = state.stage;
    const shotId = state.context.target.id;
    if (!stage || !shotId) return "";
    const payload = {
      origin: { surface: "creator-rail-stage", route: `#/shot/${shotId}` },
      target: { kind: "shot", id: shotId, label: shotId },
      stageId: stage.id || "",
      task: `Where this shot stands at ${stage.label}.`,
      facts: {
        stage: stage.label,
        purpose: stage.purpose,
        availability: stage.availability,
        blockedReason: stage.blockedReason || "",
        completion: stage.completion,
        optional: !!stage.optional,
      },
      destinations: stage.id ? ["open-stage-task", "open-activity"] : ["open-activity"],
    };
    return `<button type="button" class="cb-assistant-action" onclick="${attr(`braidyPlan(${JSON.stringify(payload)})`)}">Plan with Braidy</button>`;
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
      + `<small>${esc(status)}${stage.optional ? " · optional" : ""}</small>`
      + `<div class="cb-assistant-row-actions">${braidyStageAction(state)}</div></article></section>`
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

  /* BRAIDY SITS ABOVE THE DETERMINISTIC RAIL, and is composed rather than merged.

     public/braidy-rail.js owns everything inside the block; this file owns only where
     it goes and that it is FIRST, so a filmmaker who opened the rail to ask something
     is not scrolling past a status list to reach the composer. It returns "" whenever
     Braidy is not loaded, which is every Node realm and every install where the file
     is absent, and the sections beneath it are unchanged in that case — which is the
     mechanism by which Braidy cannot become a gate on anything below it. */
  function braidyBlock() {
    const braidy = window.CineBraidBraidy;
    if (!braidy || typeof braidy.railMarkup !== "function") return "";
    try { return braidy.railMarkup(); } catch { return ""; }
  }

  /* THE ASSISTANT INTERPRETS; IT DOES NOT KEEP THE LEDGER.
     It used to render one row per run in three sections, which is a second
     chronological feed of the same runs the Terminal below it was already listing —
     the duplication the 2026-09-01 dogfood read as several competing owners. It now
     states the situation in counts and offers AT MOST ONE consequential handoff,
     which is the one thing a rail can say that a ledger cannot.
     Nothing new is derived: state.counts and state.headline already existed, and the
     single handoff is picked from the projection's own priority order — attention
     before waiting — rather than from a second opinion about what matters. */
  function assistantCountLine(state) {
    const parts = [
      state.counts.attention ? `${state.counts.attention} needing attention` : "",
      state.counts.waiting ? `${state.counts.waiting} waiting for you` : "",
      state.counts.working ? `${state.counts.working} running` : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }
  function assistantHandoff(state) {
    /* One fact, and only one that a person can act on now. A run that is merely
       working needs no handoff — watching it is the Terminal's job. */
    const fact = state.attention[0] || state.waiting[0] || null;
    if (!fact) return "";
    const sentence = state.attention[0]
      ? (ATTENTION_SENTENCE[fact.reason] || "")
      : (WAITING_SENTENCE[fact.reason] || "");
    const go = fact.route
      ? `<button type="button" class="cb-assistant-action" onclick="location.hash='${attr(fact.route)}'">Take me there</button>`
      : "";
    const resolve = fact.reason === "submission-unresolved"
      ? `<button type="button" class="cb-assistant-action" onclick="openFalUnresolvedModal('${attr(fact.id)}')">Check and resolve</button>`
      : "";
    if (!go && !resolve) return "";
    return `<section class="cb-assistant-section tone-${attr(state.attention[0] ? "attention" : "waiting")}" data-cb-section="handoff">`
      + `<article class="cb-assistant-row"><b>${esc(fact.label)}</b>${sentence ? `<p>${esc(sentence)}</p>` : ""}`
      + `<div class="cb-assistant-row-actions">${go}${resolve}</div></article></section>`;
  }
  function assistantMarkup(state) {
    const kind = state.headline.kind;
    const counts = assistantCountLine(state);
    const quiet = counts
      ? `<section class="cb-assistant-section tone-idle" data-cb-section="counts"><article class="cb-assistant-row cb-assistant-counts"><p>${esc(counts)}</p></article></section>`
      : `<section class="cb-assistant-section tone-quiet" data-cb-section="quiet"><article class="cb-assistant-row cb-assistant-quiet"><p>Decisions that need you are shown in Production.</p></article></section>`;
    const omitted = state.omitted.attention
      ? `<p class="cb-assistant-omitted">${esc(`${state.omitted.attention} older item${state.omitted.attention === 1 ? "" : "s"} needing attention are not shown here.`)}</p>`
      : "";
    return `<div class="cb-assistant" data-cb-assistant="1" data-headline="${attr(kind)}">`
      + braidyBlock()
      + `<header class="cb-assistant-head"><span>${esc(HEADLINE_EYEBROW[kind] || "ASSISTANT")}</span>`
      + `<b>${esc(headlineSentence(state))}</b><small>${esc(contextLine(state))}</small></header>`
      + `<div class="cb-assistant-body">`
      + quiet
      + assistantHandoff(state)
      + assistantStageSection(state)
      + `</div>`
      + `<footer class="cb-assistant-foot">${omitted}</footer></div>`;
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
    /* THE TWO PER-RUN AFFORDANCES THE RETIRED DRAWER OWNED, and nothing else moved
       with them. VIEW REPORT is a handoff to the deep-history owner; DISMISS is the
       attention-row control the drawer offered under exactly the same condition it
       is offered under here. Both are for runs, so a manual or provider row shows
       neither rather than being handed a control with no subject. */
    const isRun = fact.source === "automation-run" && fact.id;
    const report = isRun && typeof window.openAutomationReport === "function"
      ? `<button type="button" class="cb-terminal-action" onclick="openAutomationReport('${attr(fact.id)}')">VIEW REPORT</button>`
      : "";
    const dismiss = isRun && tone === "attention"
      ? `<button type="button" class="cb-terminal-action" onclick="dismissAutomationActivityRun('${attr(fact.id)}')">DISMISS</button>`
      : "";
    /* THE PRODUCTION HANDOFF, WHICH IS NOT THE EVIDENCE HANDOFF.
       VIEW REPORT above opens the run's record. This takes the filmmaker to the WORK —
       the exact stage and task the run produced, via the shipped resolver, which is what
       the retired drawer's OPEN RESULT did and what assigning a coarse workspace route
       here quietly stopped doing. The two are deliberately separate controls: one is
       "show me what happened", the other is "take me to it".

       Offered on a settled run, which is the same condition the resolver itself applies
       — it returns an unresolved target for anything still working, still waiting on a
       person, or sitting in attention. The label says which of the two the filmmaker
       will get, and openRunResult() falls back to the workspace route on its own when
       the exact target cannot be resolved. */
    const openResult = isRun && fact.kind === "completed" && typeof window.openRunResult === "function"
      ? `<button type="button" class="cb-terminal-action" onclick="openRunResult('${attr(fact.id)}')">${fact.resultResolved ? "OPEN RESULT" : "OPEN WORKSPACE"}</button>`
      : "";
    /* A completed reference generation is not a run, so it has no resolver and got no
       handoff at all — the row announced returned candidates and left the filmmaker to
       find them. This is the generation surface's own reveal, called by name. */
    const openReturned = fact.reveal && typeof window.revealReturnedEntityCandidates === "function"
      ? `<button type="button" class="cb-terminal-action" onclick="revealReturnedEntityCandidates('${attr(fact.reveal.list)}','${attr(fact.reveal.entityId)}','${attr(fact.reveal.jobId)}')">REVIEW RESULTS</button>`
      : "";
    /* The run's own name is the same handoff, so it goes through the same resolver
       rather than assigning a route beside it. A non-run row has no resolver and keeps
       the route it was collected with. */
    const label = isRun && typeof window.openRunResult === "function"
      ? `<button type="button" class="cb-terminal-open" onclick="openRunResult('${attr(fact.id)}')">${esc(fact.label)}</button>`
      : fact.route
        ? `<button type="button" class="cb-terminal-open" onclick="location.hash='${attr(fact.route)}'">${esc(fact.label)}</button>`
        : `<b>${esc(fact.label)}</b>`;
    return `<article class="cb-terminal-row tone-${attr(tone)}" data-activity-key="${attr(fact.key)}" data-cb-kind="${attr(fact.kind)}">`
      + `<time>${esc(clock)}</time><em>${esc(terminalStatus(fact))}</em>`
      + `<div class="cb-terminal-body">${label}${context ? `<small>${esc(context)}</small>` : ""}`
      /* THE MESSAGE IS EVIDENCE; THE ERROR STYLE IS A VERDICT.
         A run that is still working can carry a step that failed and was retried, and
         painting that in the failure colour hands the director a fault the run does not
         have — the defect the retired drawer guarded with `failed?.error && unhealthy`.
         The message is still shown either way, because it is what happened; only the
         styling follows the run's own tone. */
      + `${fact.technical.error.state === "known" ? `<small class="${tone === "attention" ? "cb-terminal-error" : "cb-terminal-note"}">${esc(fact.technical.error.value)}</small>` : ""}</div>`
      + `<div class="cb-terminal-meta">${meta.map((part) => `<span>${esc(part)}</span>`).join("")}${fact.elapsed ? `<span>${esc(fact.elapsed)}</span>` : ""}${resolve}${openReturned}${openResult}${report}${dismiss}</div></article>`;
  }

  /* C-1 — EQUIVALENT FAILURES COLLAPSE; NOTHING ELSE DOES.
     Six identical corrections filled the dock with the same sentence six times, which
     is the density the retired drawer's ×N was controlling. The grouping is
     PRESENTATION ONLY: creatorState, the run records, project scoping and Reports are
     untouched, every underlying row is still rendered inside the group, and each keeps
     its own report target and its own dismiss.

     THE SIGNATURE IS WHAT MAKES TWO FAILURES THE SAME FAILURE, not the fact that both
     say FAILED. It is deliberately narrow: same bucket AND reason, same owning target,
     same step and system, same error text. Anything that differs — a different shot, a
     different provider, a different message — stays its own row, because collapsing
     those would hide work rather than tidy it.

     THE COMMENT ABOVE SAID "a different provider" BEFORE THE CODE DID. Review found the
     gap: provider, model and mode were all available on the projected fact and none of
     them was read, so two failures that a filmmaker would have to fix in two different
     places collapsed into one line. They are read now.

     WHAT IS DELIBERATELY LEFT OUT. technical.requestId is a per-request transport id: no
     two runs ever share one, so including it would give every failure its own signature
     and turn grouping off while appearing to strengthen it. `purpose` is the opposite —
     the operation the request was FOR — so that is the stable operation identity this
     signature carries. Timestamps are left out for the same reason as requestId. */
  /* A projected technical field is {state, value}. "not recorded" and "" are different
     facts and must not be allowed to collide, so an unknown field contributes its state
     rather than an empty string. */
  function signatureField(field) {
    if (!field || typeof field !== "object") return "~absent";
    return field.state === "known" ? String(field.value == null ? "" : field.value) : `~${String(field.state || "unknown")}`;
  }
  function groupSignature(fact) {
    const tech = (fact && fact.technical) || {};
    return [
      fact.kind, fact.reason,
      fact.target && fact.target.id, fact.target && fact.target.kind,
      fact.step && fact.step.label, fact.step && fact.step.system,
      signatureField(tech.error),
      signatureField(tech.provider),
      signatureField(tech.model),
      signatureField(tech.mode),
      signatureField(tech.purpose),
      /* Unit Separator: a field whose own text contains the join character could
         otherwise spell out a different field's boundary and make two unlike failures
         look alike. */
    ].map((part) => String(part == null ? "" : part)).join("\u001f");
  }
  /* THE GROUP'S DOM KEY. The signature itself carries provider strings, model names and
     raw error text, none of it safe or stable as an attribute value, so the key is a
     deterministic digest of it (djb2). Same signature, same key, every repaint — which
     is the whole requirement the reconciler places on it. */
  function groupKey(signature) {
    let hash = 5381;
    for (let index = 0; index < signature.length; index += 1) {
      hash = (((hash << 5) + hash) ^ signature.charCodeAt(index)) >>> 0;
    }
    return `failure-group:${hash.toString(16)}`;
  }
  /* Only attention rows group. A running row is one live thing and a completed row is
     one finished thing; neither floods, and collapsing them would hide progress. */
  const GROUPABLE = new Set(["needs-attention"]);
  function groupRows(facts) {
    const order = [];
    const byKey = new Map();
    for (const fact of facts) {
      if (!GROUPABLE.has(fact.kind)) { order.push({ key: "", lead: fact, members: [fact] }); continue; }
      const key = groupKey(groupSignature(fact));
      if (!byKey.has(key)) {
        const entry = { key, lead: fact, members: [fact] };
        byKey.set(key, entry);
        order.push(entry);
      } else {
        byKey.get(key).members.push(fact);
      }
    }
    return order;
  }

  /* WHICH GROUPS THE FILMMAKER HAS OPENED. Disclosure is user interface state, not a
     fact about the production, so it lives here and not in the projection — and it must
     survive a repaint, because activity repaints every 3.5 seconds and a group that
     closed itself twice a minute would be unusable.
     Written only from a real toggle, so a group's default stays the markup's default
     until somebody actually opens it. */
  const GROUP_OPEN = new Map();
  function rememberDisclosure(event) {
    const node = event?.target;
    const key = node?.getAttribute?.("data-activity-key") || "";
    if (!key.startsWith("failure-group:")) return;
    GROUP_OPEN.set(key, !!node.open);
  }
  /* THE EVENT IS NOT FAST ENOUGH ON ITS OWN. `toggle` is dispatched asynchronously, so a
     repaint triggered between the click and the event would rebuild the group from a
     memory that had not been written yet and close it under the filmmaker's hand — which
     is exactly the defect this is here to prevent, arriving through a different door.
     The live DOM is the authority at paint time; the listener above still matters for a
     group that is toggled and then leaves the surface before the next paint. */
  function readDisclosureFromDom() {
    const groups = DOCK_NODE?.querySelectorAll?.('details[data-activity-key^="failure-group:"]');
    if (!groups) return;
    for (const group of groups) {
      /* A single-member group is held open by the renderer and shows no summary, so its
         `open` is not a decision the filmmaker made. Recording it would mean that the
         moment a second equivalent failure arrived the group would present itself already
         expanded — the opposite of the collapse it exists for. Only a group that HAS a
         disclosure control can report user intent. */
      if (Number(group.getAttribute("data-cb-group") || 0) < 2) continue;
      GROUP_OPEN.set(group.getAttribute("data-activity-key"), !!group.open);
    }
  }

  /* ONE CONTAINER SHAPE FOR A GROUPABLE FAILURE, whatever its member count.
     A signature that has one member today and six tomorrow used to change from <article>
     to <details> between repaints, which destroys the node and everything attached to
     it. The container is now always the same element and always carries the same key;
     only its treatment changes, and a single-member group is styled to read exactly as
     the plain row it replaces. */
  function terminalGroupMarkup(entry) {
    if (!entry.key) return terminalRow(entry.lead);
    const tone = TERMINAL_TONE[entry.lead.kind] || "idle";
    const count = entry.members.length;
    const context = [entry.lead.target.id, entry.lead.step.system, entry.lead.step.label].filter(Boolean).join(" · ");
    /* A LONE FAILURE IS ALWAYS OPEN, and that is not a default — it is the only way its
       row is visible at all. A closed <details> hides its content through the browser's
       own content slot, which author CSS cannot reliably reopen, so the first version of
       this container rendered a single failure that the Terminal counted, footed and
       announced but never showed. It carries no summary, so nothing about it reads as a
       disclosure; it simply is the row. */
    const open = count < 2 || GROUP_OPEN.get(entry.key) === true;
    /* NO GROUP-LEVEL DISMISS. A control that dismissed six runs from one click would be
       a bulk authority action wearing a tidy-up's clothes, and each run's dismiss is
       already on its own row inside. */
    return `<details class="cb-terminal-group tone-${attr(tone)}" data-activity-key="${attr(entry.key)}" data-cb-group="${attr(count)}"${open ? " open" : ""}>`
      + `<summary><em>${esc(terminalStatus(entry.lead))}</em>`
      + `<div class="cb-terminal-body"><b>${esc(entry.lead.label)}</b>`
      + `${context ? `<small>${esc(context)}</small>` : ""}`
      + `${entry.lead.technical.error.state === "known" ? `<small class="cb-terminal-error">${esc(entry.lead.technical.error.value)}</small>` : ""}</div>`
      + `<span class="cb-terminal-group-count">×${esc(String(count))}</span></summary>`
      + `<div class="cb-terminal-group-rows">${entry.members.map(terminalRow).join("")}</div></details>`;
  }

  function terminalMarkup(state, collapsed, foreignProject = "") {
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
      : `<div class="cb-terminal-rows">${groupRows(rows).map(terminalGroupMarkup).join("")
        || `<div class="cb-terminal-empty"><span>No recorded activity in this project yet.</span></div>`}</div>`
        /* C-3: with nothing recorded there is no bound to explain, and "Showing the 0
           most recent events" is a sentence about nothing. The honesty this line exists
           for — a bounded surface must not read as a complete one — only applies once
           there is something to bound. */
        + `<footer class="cb-terminal-foot">${omitted ? `<span>${esc(`Not shown: ${omitted}.`)}</span>` : rows.length ? `<span>${esc(`Showing the ${rows.length} most recent event${rows.length === 1 ? "" : "s"}.`)}</span>` : ""}`
        + `<a href="${attr(state.history.deepHistoryRoute)}">Full run history in Reports</a></footer>`;
    /* THE TWO GLOBAL AFFORDANCES THE DRAWER USED TO OWN, on the same conditions it
       offered them: RECHECK STATUS only when something is parked on a human, DISMISS
       PREVIOUS ALERTS only when something needs attention. They appear in the
       EXPANDED terminal because a collapsed one-line bar is a signal, not a console —
       which is the same reason the drawer had a header at all.
       OPEN ACTIVITY is gone with the surface it opened: this IS the activity owner,
       so a button here pointing somewhere else was the duplication. */
    const globalActions = collapsed ? "" : [
      state.counts.waiting
        ? `<button type="button" class="cb-terminal-action" onclick="recheckAutomationGateStatus()" title="Re-derive every parked approval gate against current project truth">RECHECK STATUS</button>`
        : "",
      state.counts.attention
        ? `<button type="button" class="cb-terminal-action" onclick="archivePreviousAutomationFailures()">DISMISS PREVIOUS ALERTS</button>`
        : "",
    ].join("");
    const foreign = foreignProject
      ? `<div class="cb-terminal-foreign" role="status" data-cb-foreign="1"><b>Activity below is not current.</b><span>${esc(`CineBraid’s active project was switched to ${foreignProject} somewhere else, so this window has stopped taking that project’s activity. Nothing here belongs to it.`)}</span><button type="button" class="cb-terminal-action" onclick="location.reload()">RELOAD THIS WINDOW</button></div>`
      : "";
    return `<div class="cb-terminal" data-cb-terminal="1" data-collapsed="${collapsed ? "1" : "0"}">${foreign}`
      + `<header class="cb-terminal-head"><span>ACTIVITY TERMINAL</span><b>${esc(summary)}</b>`
      + `<div class="cb-terminal-head-actions">${globalActions}`
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

  /* A CLOSED RAIL IS NOT A PLACE A QUESTION IS STILL WAITING.

     Braidy's request is aborted when the rail closes and its session is cleared when
     the production goes away. Both are this file's to call because both are events
     this file already owns: nothing else knows the rail was closed, and Braidy has no
     poll of its own to notice it. Without this an in-flight question would keep its
     "thinking" pose alive behind a surface nobody can see, and land on a rail that is
     no longer mounted. */
  function braidySignal(name, reason) {
    const braidy = window.CineBraidBraidy;
    if (!braidy || typeof braidy[name] !== "function") return;
    try { braidy[name](reason); } catch {}
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
    if (!context.hasProject) { braidySignal("reset"); unmount(); syncRailToggle(false); STALE = false; return null; }
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
    /* Read what is open BEFORE the new markup is built, because the new markup has to
       carry it. */
    readDisclosureFromDom();
    applyMarkup(DOCK_NODE, terminalMarkup(state, terminalCollapsed(), foreignActivityProject()));
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

  /* ONE WRITER PER PREFERENCE. Both the toggle and A1's expand set the same key, and
     two call sites writing one value is how a preference acquires two spellings. */
  function writeTerminalCollapsed(next) {
    try { localStorage.setItem(TERMINAL_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
  }
  function toggleTerminal() {
    writeTerminalCollapsed(!terminalCollapsed());
    paint();
  }
  /* EXPAND, NOT TOGGLE. The retired Global Activity drawer had one verb — open — and
     the surfaces that used to call it (the topbar chip, the compact run status, the
     related-scene block) mean "show me the operational record", not "flip whatever
     the dock is currently doing". A toggle in those hands closes the Terminal for a
     filmmaker who already had it open, which is the opposite of the request.
     Optionally scrolls one row into view, which is the focus the drawer did by
     rendering with a focusRunId. */
  function expandTerminal(activityKey = "") {
    let changed = false;
    if (terminalCollapsed()) {
      writeTerminalCollapsed(false);
      changed = true;
    }
    if (changed) paint();
    if (!activityKey) return;
    /* A KEY THAT ALREADY NAMES ITS SOURCE IS USED AS GIVEN.
       Every caller used to pass a bare run id and this prefixed `run:` for them, so a
       manual Braidy operation or a provider job — both of which have rows here, keyed
       `manual:<id>` and `job:<id>` — could not be addressed at all, and "View activity"
       on a prompt refinement had nothing to scroll to. A key that already carries one
       of the three known prefixes is honoured; anything else keeps the previous
       run-id behaviour, so no existing caller changes. */
    const rawKey = String(activityKey).replace(/["\\]/g, "");
    const prefixed = /^(run|manual|job):/.test(rawKey);
    const row = prefixed
      ? DOCK_NODE?.querySelector?.(`[data-activity-key="${rawKey}"]`)
      : DOCK_NODE?.querySelector?.(`[data-activity-key="run:${rawKey}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
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
    button.title = open ? "Close the Braidy rail" : "Open the Braidy rail";
    /* THE CONTROL WEARS THE SHIPPED BRAIDY, from the one table that turns a
       Braidy state into a file. The package's own static FRONT view, not frame
       zero of an animation nobody is playing: a toggle sitting in the topbar is
       not an operation, so it is still by construction. Written once - a repaint
       that rewrote it every time would be work for no change. */
    decorateAssistantMarks();
  }

  /* THE ONE PLACE A MARK BECOMES THE SHIPPED BRAIDY.
   *
   * This file is one of the four the reachability rule in tests/braidy-rail.js
   * allows to know Braidy exists, and it already owns Braidy's presence in the
   * shell - so the decorating happens here and nowhere else. A production path
   * that wants a mark writes an empty `[data-assistant-mark]` span and stops;
   * it never learns what fills it, and an undecorated span is inert.
   *
   * THE PACKAGE'S OWN STATIC FRONT VIEW, not frame zero of an animation nobody
   * is playing. A toggle in a topbar and a review panel with no request in
   * flight are not operations, so neither of them animates - which is also why
   * reduced motion needs nothing extra here.
   *
   * WRITTEN ONCE PER NODE. `data-braidy-sprite` is the receipt; a repaint that
   * rewrote every mark on every route change would be work for no change. */
/* A MARK MAY NAME THE POSE IT WANTS, and it still cannot name a file.
 *
 * The topbar toggle wants the still FRONT view because a toggle is not an operation.
 * A working card is an operation in flight, and the package maps that onto PROCESSING
 * — the `thinking` key — so it asks for that by NAME and the closed table decides
 * whether such a pose exists and which strip it is. An unknown pose resolves to null
 * there and is simply not decorated, which is the same fail-closed answer this
 * function already gave when Braidy was absent altogether.
 *
 * This is the whole reason production surfaces emit a mark rather than reading the
 * sprite table: a file that draws a reference must not know the assistant exists. */
  function decorateAssistantMarks(root) {
    if (typeof window.braidySprite !== "function") return;
    const marks = (root || document).querySelectorAll(
      "[data-assistant-mark], .topbar-braidy-mark");
    if (!marks.length) return;
    let reduced = false;
    try { reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches === true; } catch { reduced = false; }
    marks.forEach((mark) => {
      if (mark.dataset.braidySprite) return;
      const pose = String(mark.dataset.assistantMark || "idle") || "idle";
      /* The toggle keeps the still frame it has always had; a posed mark animates
         unless the reader has asked it not to. */
      const still = pose === "idle" || reduced;
      const sprite = window.braidySprite(pose, { reducedMotion: still });
      if (!sprite) return;
      mark.classList.add("cb-braidy-presence");
      mark.dataset.braidyArt = "v32";
      mark.dataset.braidyPose = pose;
      mark.dataset.braidyStill = still ? "1" : "0";
      mark.dataset.braidySprite = sprite.file;
      mark.style.backgroundImage = `url("${sprite.url}")`;
      mark.style.backgroundSize = `${sprite.sheetWidth}px ${sprite.size}px`;
    });
  }

  function setRail(open) {
    try { localStorage.setItem(RAIL_OPEN_KEY, open ? "1" : "0"); } catch {}
    if (!open) { braidySignal("abort", "That question was stopped when the rail was closed."); closeRailMount(); }
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
  /* CAPTURE, because `toggle` does not bubble. A capturing listener on the document
     still sees it, which is what lets one listener serve every failure group without
     rebinding one per group on every repaint — the rebinding being the thing that would
     put us back where we started. */
  document.addEventListener("toggle", rememberDisclosure, true);
  window.addEventListener("hashchange", paint);
  window.addEventListener("cinebraid:route-rendered", paint);
  window.addEventListener("cinebraid:modal-opened", () => decorateAssistantMarks());
  /* A mark can appear anywhere a route draws — the reference workspace's working card
     is one — so the same repaint signal the shell already reacts to decorates them.
     Decoration is idempotent: a mark that already carries a sprite is skipped. */
  window.addEventListener("cinebraid:route-rendered", () => decorateAssistantMarks());
  window.addEventListener("cinebraid:workspace-updated", paint);
  window.addEventListener("cinebraid:activity-updated", paint);
  window.addEventListener("load", paint);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();

  window.CineBraidCreatorSurfaces = {
    paint,
    toggleTerminal,
    expandTerminal,
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

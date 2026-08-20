/* CineBraid — the persistent stage strip and the persistent stage actions.

   O2 built the slots. O3 filled the rail and the dock. This file fills the bar, and it
   fills it from ONE read of the declared stage model.

   ---------------------------------------------------------------------------
   THE SHAPE, and the reason it is this shape.

     stageModel()      the ONLY place in O4 that touches a shot. It calls the SHIPPED
                       shotStageModelFacts(), shotStageProgress() and
                       boundedShotSelectedTask() — the same three calls the retired
                       taskbar made and the Assistant still makes. It judges nothing.

     stageActions()    public/shared-stage-actions.js. Bounded, refusing.

     stripMarkup()     where am I, and what is the state of the other stages.
     actionsMarkup()   what can I do here, and why not.

   Both renderers read that one model and NOTHING else. Neither contains a stage id, a
   stage label, a stage order or a panel name: every one of those comes out of
   public/shared-stage-model.js on the way through. tests/stage-surfaces.js reads the
   source of this file and requires it to name no declared stage in code, and
   tests/stage-surfaces-negative-controls.js puts one back and requires the suite to go
   red for it.

   ---------------------------------------------------------------------------
   WHAT THIS REPLACED. boundedShotTaskbarMarkup() in public/creation-studio.js, which
   was correct about everything except WHERE it lived. It already read O1 for the stage
   list, the order, the tone and the wording, and it already navigated through the
   shipped selectBoundedTask. But it was built by guidedShotWorkspaceView() into `#main`,
   and public/app.js replaces `#main` wholesale on every render — including the renders
   caused by changing stage. So the one surface whose job is to tell a filmmaker where
   they are in the workflow was destroyed and rebuilt by the act of moving through it.

   The rendered contract is deliberately UNCHANGED: same `.focused-taskbar
   .bounded-shot-taskbar` nav, same `.focused-task-button` children,
   same selectBoundedTask onclick, same status wording from the shipped
   boundedShotTaskStatus(). Nine shipped browser suites drive the shot workspace by
   clicking those buttons. A rewrite would have broken all of them to gain nothing:
   what was wrong was the ownership, not the markup.

   THERE MUST NOT BE TWO. The old call site is deleted rather than hidden, and
   tests/stage-surfaces.js fails if `#main` renders a second five-stage navigator.

   ---------------------------------------------------------------------------
   WHAT THIS FILE DOES NOT DO.

   * IT ADDS NO TIMER, MAKES NO REQUEST, AND WRITES NOTHING TO A PROJECT. It repaints
     from the four signals the shell already emits, and from the activity signal O3
     added — because the strip shows what a machine is doing on a stage, and that is
     the moment it changes.

   * IT NEVER APPROVES, NEVER GENERATES, NEVER DELETES. The action contract drops any
     candidate flagged paid or destructive before this file ever sees it, and nothing
     here can add one afterwards: `invoke()` dispatches only the two shipped calls
     named in STAGE_ACTION_INVOKE_KINDS.

   * IT DOES NOT ADVANCE A STAGE BY ITSELF. A stage becoming complete moves nothing.
     Continue is a button a person presses, and it exists only where the declared model
     produced a recommendation.

   * IT EXPLAINS NOTHING AT LENGTH. A blocked stage gets the declaration's own one
     line, next to the control it blocks. The Assistant is the surface that says what
     matters and why; repeating it here in a sticky bar would make both worse.

   ---------------------------------------------------------------------------
   ELIGIBILITY, which is narrower than the shell's and says so.

   The shell is present on sixteen creator views. A shot workflow strip is honest on
   exactly one of them, so this file mounts on the shot route and CLEARS the slot
   everywhere else — which collapses it to nothing, because that is what an unoccupied
   declared slot does. Off-shot there is no bar, no reserved band and no
   --cb-bar-height, so every sticky offset that consumes it is inert.

   Note the asymmetry with O3, which is deliberate. The Assistant is RETAINED when the
   surface becomes ineligible, because a conversation and a scroll position are worth
   keeping. There is nothing to retain here: the strip is a pure function of the shot
   it is looking at, so leaving a shot's strip mounted over the Reports page would be
   keeping a claim, not a context. */

(function () {
  if (typeof document === "undefined") return;

  /* The MOUNT node, not the rendered surface — the same distinction O3 draws.
     `#cb-stage-mount` is the stable node the shell holds and the reconciler patches
     into; `.cb-stage-bar` is the markup inside it, rebuilt in place on every paint. */
  const BAR_ROOT_ID = "cb-stage-mount";
  const BAR_SLOT = "bar";

  let BAR_NODE = null;
  let STALE = false;

  /* ==========================================================================
     READING THE APP.

     `P` is a top-level `let` in public/app.js. In a classic script that is a lexical
     binding on the shared script scope and NOT a property of `window` — reading
     `window.P` here would be undefined on every route, which is the defect
     public/focused-workspaces.js documents at its own activeProject(). Everything is
     read through typeof so this file also loads in a suite's realm where only some of
     the app exists. */
  function activeProject() {
    return typeof P === "undefined" ? null : P;
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

     Shell presence is the SHELL's answer, asked rather than re-derived, for the same
     reason O3 asks it: a third opinion about where the workspace exists is how three
     surfaces come to disagree about whether they are on one. What this file adds on
     top is the narrower question only it can answer — is this a shot. */
  /* THE STRIP DESCRIBES THE RENDERED WORKSPACE, NOT THE REQUESTED URL.
   *
   * `paint` is wired to `hashchange`, and `ROUTES.shot` awaits an HTTP POST before it
   * writes `#main`. So on every arrival at a shot there was a window — one server
   * round-trip wide — in which the shell had already mounted a full stage navigator
   * for SH010 while the centre still showed the page the filmmaker was leaving. The
   * strip was describing a workspace that did not exist yet.
   *
   * That is the same defect the `shotId` comment below already refuses one step later
   * ("a strip that fell back to the last shot visited would be describing a shot the
   * filmmaker is not looking at"), so it is refused here on the same grounds: the
   * strip mounts when the workspace it navigates has actually rendered.
   *
   * It is also what made tests/production-media-real-browser.py section 11 a coin
   * flip. That suite waits for `.cb-stage-strip` and then reads the shot surface;
   * because the strip appeared before the surface, the wait proved nothing and the
   * read landed on the previous view often enough to fail the gate. Nothing about the
   * assertion changed — the product stopped claiming to be somewhere it was not.
   *
   * `typeof` guarded because the O4 suites evaluate this module without public/app.js;
   * with no rendered-route key to consult, the answer is the pre-existing one. */
  function renderedRouteIsCurrent() {
    if (typeof CURRENT_RENDER_ROUTE_KEY === "undefined" || typeof currentRouteKey !== "function") return true;
    return CURRENT_RENDER_ROUTE_KEY === currentRouteKey();
  }
  function stageContext() {
    const project = activeProject();
    const view = currentView();
    const shell = typeof creatorShellState === "function"
      ? creatorShellState({ view, hasProject: !!project })
      : { present: false, reason: "no-declaration" };
    return {
      view,
      hasProject: !!project,
      shellPresent: shell.present === true,
      blockedReason: shell.reason || "",
      /* The route's own id, not a remembered one. A strip that fell back to the last
         shot visited would be describing a shot the filmmaker is not looking at. */
      shotId: view === "shot" && renderedRouteIsCurrent() ? currentTargetId() : "",
    };
  }

  /* ==========================================================================
     THE MODEL.

     Consumed from O1, never re-derived. `shotStageModelFacts` is the shipped assembler
     in public/creation-studio.js — the same call the Assistant makes — and the selected
     stage comes from the shipped `boundedShotSelectedTask`, so the strip marks the
     stage the workspace is actually showing rather than one it worked out for itself.

     Returns null off a shot, on a shot that does not exist, or before the app has
     finished loading. Null is a real answer here: it clears the bar. */
  function stageModel(context) {
    if (!context.shotId || !context.hasProject) return null;
    if (typeof shotById !== "function" || typeof shotStageModelFacts !== "function") return null;
    if (typeof shotStageProgress !== "function" || typeof stageActions !== "function") return null;
    const shot = shotById(context.shotId);
    if (!shot) return null;
    try {
      const takes = typeof takesFor === "function" ? takesFor(shot.id) : [];
      const facts = shotStageModelFacts(shot, takes);
      const selectedId = typeof boundedShotSelectedTask === "function"
        ? boundedShotSelectedTask(shot, takes)
        : (typeof recommendedShotStageId === "function" ? recommendedShotStageId(facts) : "");
      const states = shotStageProgress(facts);
      const current = states.find((state) => state.id === selectedId) || null;
      if (!current) return null;
      return {
        shotId: shot.id,
        selectedId,
        states,
        current,
        actions: stageActions(current, shot.id),
        /* The shipped wording function, called rather than copied. The strip's status
           words and the retired taskbar's were the same words because they were the
           same call, and they still are. */
        status: (stageId) => (typeof boundedShotTaskStatus === "function"
          ? boundedShotTaskStatus(shot, takes, stageId, facts)
          : { tone: "pending", label: "" }),
      };
    } catch { return null; }
  }

  /* ==========================================================================
     THE STRIP.

     One button per DECLARED stage, in the order the model returned them. Nothing here
     sorts, filters or renames: `states` arrives ordered by public/shared-stage-model.js
     and is rendered as it arrives. A reader that sorted would be a reader that could
     sort differently.

     WHAT O4 ADDED to the retired markup, and why each one:

       aria-current="step"    the current stage was previously distinguishable only by
                              a CSS class, which is a claim no assistive technology can
                              read. It is a step in a process, so it is "step".
       data-availability      BLOCKED MUST NOT READ AS OPTIONAL. The shipped tone for a
                              blocked stage is `optional`, which paints the same grey
                              as a stage nobody has started. The availability the
                              declaration actually returned is now on the element, and
                              the stylesheet keys the blocked treatment off it.
       data-completion        so a suite can compare what is painted against what O1
                              returned, without parsing the visible words.
       the reason inline      a blocked stage already carries its reason in the shipped
                              note; it stays in the button's own text, which is how it
                              reaches a screen reader without any extra wiring. */
  function stageButton(model, state) {
    const status = model.status(state.id);
    const selected = state.id === model.selectedId;
    /* THE NOTE REPLACES THE DETAIL RATHER THAN EXTENDING IT, which the retired taskbar
       did the other way round. `detail` is a fixed sentence about what the stage is
       for; `note` is what is true of THIS shot right now — "5 references", "1 of 2
       frames approved", "Confirm the required production reference". Concatenating them cost
       about thirty characters of a line that has room for twenty, so the live half was
       the half that got ellipsised away. The static sentence is still in `title`. */
    const detail = status.note || state.detail;
    const scope = typeof SHOT_STAGE_SCOPE === "string" ? SHOT_STAGE_SCOPE : "shot-task";
    return `<button type="button" class="focused-task-button tone-${attr(status.tone)}${selected ? " selected" : ""}"`
      + ` data-stage-id="${attr(state.id)}" data-availability="${attr(state.availability)}"`
      + ` data-completion="${attr(state.completion)}"${selected ? ' aria-current="step"' : ""}`
      + ` onclick="selectBoundedTask('${attr(scope)}','${attr(model.shotId)}','${attr(state.id)}')"`
      + ` title="${attr(`${state.label} — ${status.label} · ${state.detail}`)}">`
      + `<i></i><span><b>${esc(state.label)}</b><small>${esc(detail)}</small></span>`
      + `<em>${esc(status.label)}</em></button>`;
  }

  function stripMarkup(model) {
    /* `clarity-taskbar` is DELIBERATELY not carried over. It is a v6.6.2 layout class
       that forces `display:grid!important` and `overflow:visible!important` on the nav
       and `min-width:0!important` on every button — the right answer for a bar that
       wraps inside a page column, and the wrong one for a bar that must stay one row
       and scroll. Nothing reads it: it is styling, and the two classes the browser
       suites drive this strip by are the two that remain. */
    return `<nav class="focused-taskbar bounded-shot-taskbar cb-stage-strip" aria-label="Shot production stages">`
      + model.states.map((state) => stageButton(model, state)).join("")
      + `</nav>`;
  }

  /* ==========================================================================
     THE ACTIONS.

     Rendered exactly as the contract returned them. This function decides no
     availability, invents no reason, and adds no action of its own — its whole job is
     turning a bounded list into buttons.

     A DISABLED ACTION IS DISABLED THREE TIMES OVER, and the redundancy is deliberate:

       1. the `disabled` attribute, so it cannot be clicked or tabbed to;
       2. a VISIBLE reason beside it, associated by aria-describedby — visible rather
          than a tooltip, because a reason only a mouse can reveal is a reason a
          keyboard user does not have;
       3. invoke() re-derives the action from current truth before dispatching, so an
          action that became unavailable between paint and click does nothing, and
          neither does one whose attribute somebody removed. */
  function actionButton(action, reasonId) {
    return `<button type="button" class="cb-stage-action emphasis-${attr(action.emphasis)}"`
      + ` data-action-id="${attr(action.id)}" data-availability="${attr(action.availability)}"`
      + ` data-advances="${action.advances ? "1" : "0"}"`
      + `${reasonId ? ` disabled aria-describedby="${attr(reasonId)}"` : ""}`
      + ` onclick="window.CineBraidStageSurfaces.invoke('${attr(action.id)}')">${esc(action.label)}</button>`;
  }

  /* ONE LINE PER DISTINCT REASON. Two blocked actions on one stage necessarily carry
     the SAME reason — the contract copies both from the stage — so keying the reason
     elements by the reason text rather than by the action id is what stops the bar
     printing the same canonical blocker twice. Every blocked button points at
     the single element for its reason. */
  function actionsMarkup(model) {
    const actions = model.actions;
    const reasonIds = new Map();
    for (const action of actions) {
      if (action.availability !== "blocked" || reasonIds.has(action.disabledReason)) continue;
      reasonIds.set(action.disabledReason, `cb-stage-reason-${reasonIds.size}`);
    }
    const buttons = actions.map((action) => actionButton(action, reasonIds.get(action.disabledReason) || "")).join("");
    const reasons = [...reasonIds].map(([reason, id]) =>
      `<p class="cb-stage-action-reason" id="${attr(id)}">${esc(reason)}</p>`).join("");
    /* An empty action list is a real answer and is rendered as one. The alternative —
       collapsing the region — would move the bar's controls up and down the page as
       the shot progressed, which is the opposite of a predictable location. */
    const body = actions.length
      ? buttons + reasons
      : `<p class="cb-stage-action-reason cb-stage-action-none">No action for this stage is offered here. The work is in the workspace below.</p>`;
    return `<div class="cb-stage-actions" data-cb-stage-actions="1" data-action-count="${actions.length}"`
      + ` aria-label="${attr(`${model.current.label} actions`)}" role="group">${body}</div>`;
  }

  function barMarkup(model) {
    return `<div class="cb-stage-bar" data-cb-stage-bar="1" data-shot-id="${attr(model.shotId)}"`
      + ` data-current-stage="${attr(model.selectedId)}">${stripMarkup(model)}${actionsMarkup(model)}</div>`;
  }

  /* ==========================================================================
     INVOCATION.

     The only two calls this file can make, and both are shipped. `openGuidedPanel` is
     the existing cross-panel handoff — the same one the shot's own next-action card
     uses — and `selectBoundedTask` is the one stage-selection writer in the app. There
     is no third branch, and adding one means adding a kind to
     STAGE_ACTION_INVOKE_KINDS in the contract first.

     The action is looked up FROM CURRENT TRUTH rather than from the click, so what is
     dispatched is what the model says right now. */
  function invoke(actionId) {
    const model = stageModel(stageContext());
    const action = model ? model.actions.find((row) => row.id === String(actionId)) : null;
    if (!action || action.availability !== "available") return false;
    const target = action.invoke;
    if (target.kind === "open-panel" && typeof window.openGuidedPanel === "function") {
      window.openGuidedPanel(target.shotId, target.panel);
      return true;
    }
    if (target.kind === "select-stage" && typeof window.selectBoundedTask === "function") {
      window.selectBoundedTask(typeof SHOT_STAGE_SCOPE === "string" ? SHOT_STAGE_SCOPE : "shot-task", target.shotId, target.stageId);
      return true;
    }
    return false;
  }

  /* ==========================================================================
     PAINTING.

     Mount once, patch afterwards, through the SAME reconciler the Activity drawer and
     the O3 surfaces use — v670PatchElement in public/live-activity.js. One patching
     behaviour in CineBraid rather than three that can diverge, and it is what keeps
     the focused stage button the same node across a stage change: a button replaced
     under the pointer takes the keyboard focus with it. */
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

  function ensureMounted() {
    const shell = window.CineBraidShell;
    if (!shell || typeof shell.mountSlot !== "function") return false;
    if (!BAR_NODE || !BAR_NODE.isConnected) {
      BAR_NODE = document.createElement("div");
      BAR_NODE.id = BAR_ROOT_ID;
      BAR_NODE.className = "cb-stage-mount";
      if (!shell.mountSlot(BAR_SLOT, BAR_NODE)) { BAR_NODE = null; return false; }
    }
    return true;
  }

  function unmount() {
    const shell = window.CineBraidShell;
    if (shell && typeof shell.clearSlot === "function") shell.clearSlot(BAR_SLOT);
    BAR_NODE = null;
  }

  function paint() {
    const context = stageContext();
    const model = context.shellPresent ? stageModel(context) : null;
    /* No shot, no strip. Unlike O3 nothing is retained: see ELIGIBILITY above. */
    if (!model) { unmount(); STALE = !!context.shotId; remeasureShell(); return null; }
    if (!ensureMounted()) return null;
    STALE = false;
    applyMarkup(BAR_NODE, barMarkup(model));
    revealCurrentStage();
    /* TELL THE SHELL THE BAR CHANGED HEIGHT, rather than waiting to be noticed. The
       bar is sticky, and every sticky surface below it offsets by --cb-bar-height; a
       reservation that is one frame stale pins the shot header underneath the strip.
       O2's ResizeObserver is correct for reflows nobody initiated and is left in place
       as the backstop, but its callback only arrives at a rendering opportunity, and
       this consumer knows the exact moment the content changed. */
    remeasureShell();
    return model;
  }

  /* THE CURRENT STAGE MUST BE VISIBLE, INCLUDING ON A PHONE.

     At narrow widths the strip scrolls horizontally rather than dropping stages, which
     means the current stage can be off the left or right edge of it. This nudges the
     STRIP's own scrollLeft — never scrollIntoView(), which is allowed to scroll every
     scrollable ancestor including the document, and would yank the page whenever the
     bar repainted. Idempotent: a stage already fully in view is not moved, so the
     3.5-second activity repaint cannot fight a filmmaker who has scrolled the strip. */
  function revealCurrentStage() {
    const strip = BAR_NODE && BAR_NODE.querySelector(".cb-stage-strip");
    const current = strip && strip.querySelector('[aria-current="step"]');
    if (!strip || !current || typeof strip.scrollTo !== "function") return;
    const left = current.offsetLeft;
    const right = left + current.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 8);
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 8;
  }

  function remeasureShell() {
    const shell = window.CineBraidShell;
    if (!shell || typeof shell.syncCreatorShell !== "function") return;
    shell.syncCreatorShell();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => shell.syncCreatorShell());
  }

  /* ==========================================================================
     WIRING.

     The three route/project signals the shell listens to, plus the activity signal O3
     added. The last one is not decoration: the declared model mirrors a run's status
     onto the stage it is working on, so the moment activity changes is the moment the
     strip's tone is wrong. No timer of this file's own, and no fetch — every repaint
     is a reaction to work somebody else already did. */
  window.addEventListener("hashchange", paint);
  window.addEventListener("cinebraid:route-rendered", paint);
  window.addEventListener("cinebraid:workspace-updated", paint);
  window.addEventListener("cinebraid:activity-updated", paint);
  window.addEventListener("load", paint);
  /* RESIZE IS NOT A REPAINT, and it is not nothing either. None of the four signals
     above fires when the window changes size, and the strip's scroll geometry is
     entirely a function of its width: measured in Chromium at 390px, a shot whose
     current stage is the fourth of five had it scrolled off the right-hand edge after
     a resize, with no event that would have brought it back. Nothing is re-derived
     here — the model has not changed — so this reveals rather than repaints. */
  window.addEventListener("resize", revealCurrentStage);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();

  window.CineBraidStageSurfaces = {
    paint,
    invoke,
    stageModel: () => stageModel(stageContext()),
    stripMarkup,
    actionsMarkup,
    barMarkup,
    isStale: () => STALE,
  };
})();

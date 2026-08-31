/* CineBraid — Braidy, in the right rail.

   public/creator-surfaces.js still owns the rail SLOT: it mounts it, it paints it,
   and it decides when it is there at all. This file owns what Braidy IS inside it —
   the presence, the thread, the composer, and the one request Braidy makes — and it
   is composed into the rail by creator-surfaces.js calling railMarkup().

   That split is deliberate and it is the whole reason there is no second assistant
   framework here. Braidy adds a voice to a surface that already exists; it does not
   add a surface, a mount, a poll, a projection or a backend.

   ---------------------------------------------------------------------------
   THE FOUR RULES THIS FILE IS HELD TO. public/shared-braidy.js holds them as shapes;
   this file is the half that could break them by accident, so each one is named
   where it is kept.

     NOT AUTHORITY      Nothing here writes a project, approves media, establishes
                        canon, dispatches or retries a paid generation, or changes a
                        route's delivery. There is exactly one fetch in this file and
                        it is a question. Every control Braidy renders comes from
                        braidyOfferedActions(), whose table is calls that already
                        exist and already own their work.

     NOT A SECOND FEED  The Activity Terminal keeps the chronological technical
                        record — system, status, cost, duration, attempt. Braidy
                        renders none of those and prints no run history. When
                        something happened, Braidy says what it means for the film and
                        points at Activity for what actually happened.

     NOT A GATE         Braidy is closed by default, is not mounted when closed, and
                        no production path asks it anything. With no assistant
                        configured the rail still opens, still says so, and every
                        deterministic section beneath it is untouched.

     NOT IN CHARGE OF   The mascot's state is derived by braidyPresentation() from
     ITS OWN FACE       request and UI tokens. The answer text is never parsed for a
                        state, a token or an action. There is no code path from prose
                        to motion, and none from prose to a control.

   ---------------------------------------------------------------------------
   THE ART. There is no Braidy sprite in this repository — the only images are the
   CineBraid brand mark and its logo, which are the product's mark and not a
   character. So the presence renders as an explicit PLACEHOLDER: a neutral loop
   carrying the presentation state, stamped data-braidy-art="absent". It is
   deliberately not a face and deliberately not a redesign of Braidy; when the
   approved braided-rope frames arrive, they replace the placeholder inside this one
   element and every state below already means what it will mean then. */

(function () {
  if (typeof document === "undefined") return;

  const INPUT_ID = "cb-braidy-input";
  /* How long "acknowledge" lasts. A one-shot settle, not a clock: it is scheduled by
     an answer arriving and by nothing else, and the rail is repainted by the same
     paint() every other creator surface uses. */
  const ACKNOWLEDGE_MS = 1600;
  /* A request cannot outlive this. The assistant route's own timeouts are longer than
     anything a rail should hold a filmmaker's attention for, and a request that never
     returns is the exact way a mascot gets stuck thinking. */
  const REQUEST_TIMEOUT_MS = 120000;
  const THREAD_LIMIT = 8;

  /* ==========================================================================
     STATE. All of it session-scoped and none of it durable: Braidy remembers a
     conversation for as long as the tab is open and writes nothing anywhere. A
     transcript persisted next to a production would be a second record of what
     happened, which is the Terminal's job. */
  let THREAD = [];
  let HANDOFF = null;
  let PENDING = null;
  let FAILURE = "";
  let ACKNOWLEDGE_UNTIL = 0;
  let INPUT_ACTIVE = false;
  let SHOW_REST = false;
  /* Monotonic. The ONLY thing that decides whether a response may settle anything. */
  let SEQUENCE = 0;
  let ACKNOWLEDGE_TIMER = null;

  function api() {
    return typeof window !== "undefined" ? window : globalThis;
  }
  function contract() {
    const scope = api();
    return typeof scope.braidyHandoff === "function" ? scope : null;
  }
  function surfaces() {
    const scope = api();
    return scope.CineBraidCreatorSurfaces || null;
  }
  function repaint() {
    const owner = surfaces();
    if (owner && typeof owner.paint === "function") owner.paint();
  }

  /* Read through typeof for the same reason public/creator-surfaces.js does: `P` and
     `AGENT_STATUS` are lexical bindings in public/app.js and are simply absent in a
     suite realm that loads this file on its own. */
  function activeProject() {
    return typeof P === "undefined" ? null : P;
  }
  function agentStatus() {
    return typeof AGENT_STATUS === "undefined" ? null : AGENT_STATUS;
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch { return false; }
  }

  /* ==========================================================================
     CAPABILITY. One read, through the one function allowed to compose a claim.

     `assistantCapabilities().text` is the existing answer about the configured
     provider and is passed through untouched. Whether that amounts to a QUALIFIED
     Braidy is decided by braidyCapability() against the shipped qualification record,
     which currently names no champion — so a working configured assistant is
     described as the assistant the filmmaker configured, and is not relabelled. */
  function capability() {
    const shared = contract();
    const status = agentStatus();
    const text = status && status.capabilities ? status.capabilities.text : null;
    if (!shared) return { available: false, label: "Braidy is loading.", note: "", message: "", action: "" };
    return shared.braidyCapability(text || {}, shared.BRAIDY_QUALIFICATION);
  }

  /* ==========================================================================
     WHAT BRAIDY IS LOOKING AT when nobody handed it anything. Derived from the route
     the same way every other reader in the product derives it, so an answer is about
     the surface the filmmaker is actually on. */
  function routeSeed() {
    const parts = String(location.hash || "").split("/");
    const view = parts[1] || "";
    const id = parts[2] || "";
    const project = activeProject();
    if (view === "shot" && id) return { kind: "shot", id, label: id };
    if (view === "scene" && id) return { kind: "scene", id, label: id };
    return { kind: "project", id: "", label: project?.meta?.title || "This production" };
  }

  function seedHandoff() {
    const shared = contract();
    if (!shared) return null;
    const target = routeSeed();
    try {
      return shared.braidyHandoff({
        intent: "ask",
        origin: { surface: "braidy-rail", route: String(location.hash || "") },
        target,
        destinations: target.kind === "shot" ? ["open-shot", "open-activity"] : ["open-activity"],
      });
    } catch { return null; }
  }

  /* WHICH HANDOFF A QUESTION BELONGS TO.

     An explicit one — set by "Plan with Braidy" and its three siblings — governs while
     the filmmaker is still on the thing it named. Move to another shot and a typed
     question is about the shot in front of them, not the one they asked about ten
     minutes ago.

     DERIVED ON EVERY CALL, never cached. Caching the seed is the bug this replaced: the
     first paint on shot A would have fixed the target, and a question typed on shot B
     would have been answered about A with no sign anywhere that it had been.

     Braidy's memory is the visible thread and nothing else. /api/project/ask is
     stateless — it grounds every answer in the server's own read of the project — so a
     follow-up is a fresh question about the same subject rather than a continuation.
     That is a real limitation and it is deliberately not hidden by pretending the
     handoff carries a conversation. */
  function activeHandoff() {
    const seed = routeSeed();
    if (HANDOFF && HANDOFF.target.kind === seed.kind && HANDOFF.target.id === seed.id) return HANDOFF;
    return seedHandoff();
  }

  /* ==========================================================================
     PRESENTATION. Tokens out, so a suite can read exactly what the mascot was told
     without rendering anything — and so it is visible that prose is not among them. */
  function presentationTokens() {
    return {
      pending: !!PENDING,
      failed: !!FAILURE,
      acknowledging: Date.now() < ACKNOWLEDGE_UNTIL,
      /* A contextual handoff was opened and nothing has been said to it yet: Braidy is
         holding a subject and waiting for the filmmaker. Deliberately NOT "an answer
         offered some buttons" — every answer does that, and a pose that is always on
         is a pose that says nothing. */
      awaitingChoice: !PENDING && !FAILURE && !!HANDOFF && HANDOFF.intent !== "ask" && !THREAD.length,
      inputActive: INPUT_ACTIVE,
      reducedMotion: reducedMotion(),
    };
  }

  function presentation() {
    const shared = contract();
    const tokens = presentationTokens();
    if (!shared) return { state: "idle", reason: "idle", motion: tokens.reducedMotion ? "none" : "on" };
    return shared.braidyPresentation(tokens);
  }

  /* ==========================================================================
     THE REQUEST. One fetch, to the assistant route CineBraid already has.

     STALENESS IS DECIDED BY THE SEQUENCE AND NOTHING ELSE. A response whose id is no
     longer the newest settles nothing at all — not the thread, not the failure, not
     the pending flag — because the only thing that can clear PENDING is the request
     that set it, or an abort that invalidated it first. */
  function abort(reason = "") {
    if (!PENDING) return false;
    SEQUENCE += 1;
    try { PENDING.controller.abort(); } catch {}
    PENDING = null;
    if (reason) FAILURE = reason;
    return true;
  }

  function remember(entry) {
    THREAD = [...THREAD, entry].slice(-THREAD_LIMIT);
  }

  async function ask(message, handoff = activeHandoff()) {
    const shared = contract();
    const asked = String(message == null ? "" : message).trim();
    if (!shared || !handoff) return null;
    if (!asked && handoff.intent === "ask") return null;
    if (PENDING) abort();

    const id = ++SEQUENCE;
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch {} }, REQUEST_TIMEOUT_MS);
    PENDING = { id, controller, intent: handoff.intent };
    FAILURE = "";
    SHOW_REST = false;
    HANDOFF = handoff;
    remember({ role: "filmmaker", text: asked || handoff.task || shared.BRAIDY_INTENT_FRAMING[handoff.intent] || "" });
    repaint();

    let outcome = null;
    let failure = "";
    try {
      const response = await fetch("/api/project/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: shared.braidyQuestion(handoff, asked) }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) failure = String(data.error || `The assistant request failed (${response.status}).`);
      else outcome = String(data.answer || "").trim();
      if (!failure && !outcome) failure = "The assistant returned nothing to show.";
    } catch (error) {
      failure = error?.name === "AbortError"
        ? "That question was stopped before it finished."
        : String(error?.message || "Braidy could not reach CineBraid.");
    } finally {
      clearTimeout(timer);
    }

    /* SUPERSEDED OR ABORTED: settle nothing. The state this response would have
       written belongs to a question nobody is waiting on any more. */
    if (id !== SEQUENCE) return null;
    PENDING = null;
    if (failure) {
      FAILURE = failure;
      repaint();
      return null;
    }
    const advisory = shared.braidyAdvisory(outcome, handoff);
    remember({
      role: "braidy",
      advisory,
      /* Built from the HANDOFF. The answer is not consulted, which is why an answer
         cannot produce a control. */
      actions: shared.braidyOfferedActions(handoff),
    });
    acknowledge();
    repaint();
    return advisory;
  }

  function acknowledge() {
    ACKNOWLEDGE_UNTIL = Date.now() + ACKNOWLEDGE_MS;
    if (ACKNOWLEDGE_TIMER) clearTimeout(ACKNOWLEDGE_TIMER);
    /* One shot. It exists so the acknowledge pose settles back to idle on its own
       rather than waiting for the next unrelated repaint to notice it has expired. */
    ACKNOWLEDGE_TIMER = setTimeout(() => { ACKNOWLEDGE_TIMER = null; repaint(); }, ACKNOWLEDGE_MS + 40);
  }

  /* ==========================================================================
     MARKUP.

     A FIXED SKELETON, and that is a correctness requirement rather than tidiness. The
     rail is repainted whenever activity changes, and public/live-activity.js's
     reconciler patches children BY POSITION. An element sequence that varied with
     state would let a repaint replace the composer while somebody was typing in it.
     So every element below is always emitted; only attributes and text change. */
  function esc_(value) {
    return typeof esc === "function" ? esc(value) : String(value == null ? "" : value);
  }
  function attr_(value) {
    return typeof attr === "function" ? attr(value) : esc_(value);
  }

  function presenceMarkup(state) {
    /* data-braidy-art="absent" is the honest part: this is a placeholder for the
       approved braided-rope frames, not a character. One element, so supplying the
       art later is a change inside it and not a change to any state below. */
    return `<span class="cb-braidy-presence" data-braidy-art="absent" data-braidy-pose="${attr_(state)}" aria-hidden="true">`
      + `<i class="cb-braidy-loop"></i><i class="cb-braidy-loop"></i></span>`;
  }

  function actionsMarkup(actions) {
    if (!actions || !actions.length) return "";
    return `<div class="cb-braidy-actions">`
      + actions.map((action) => `<button type="button" class="cb-braidy-action" data-braidy-action="${attr_(action.id)}" data-braidy-target="${attr_(action.target?.id || "")}" onclick="${attr_(action.call)}">${esc_(action.label)}</button>`).join("")
      + `</div>`;
  }

  function answerMarkup(entry) {
    const advisory = entry.advisory;
    const lead = advisory.lead.map((paragraph) => `<p>${esc_(paragraph)}</p>`).join("");
    /* NOTHING IS DISCARDED. The compact register is a decision about what is shown
       first; the remainder is behind one control, verbatim. */
    const more = advisory.rest.length
      ? (SHOW_REST
        ? `<div class="cb-braidy-more">${advisory.rest.map((paragraph) => `<p>${esc_(paragraph)}</p>`).join("")}</div>`
          + `<button type="button" class="cb-braidy-action" onclick="window.CineBraidBraidy.showLess()">Show less</button>`
        : `<button type="button" class="cb-braidy-action" onclick="window.CineBraidBraidy.explainMore()">Explain more</button>`)
      : "";
    return `<article class="cb-braidy-turn" data-braidy-role="braidy" data-braidy-authority="${attr_(advisory.authority)}">`
      + `${lead}${more}`
      + `<div class="cb-braidy-turn-foot">`
      + `<button type="button" class="cb-braidy-action" onclick="window.copyText(window.CineBraidBraidy.lastAnswer())">Copy</button>`
      + actionsMarkup(entry.actions)
      + `</div></article>`;
  }

  function threadMarkup(cap) {
    if (FAILURE)
      return `<article class="cb-braidy-turn cb-braidy-trouble" data-braidy-role="trouble"><p>${esc_(FAILURE)}</p></article>`;
    if (PENDING)
      return `<article class="cb-braidy-turn cb-braidy-muted" data-braidy-role="pending"><p>Thinking about it.</p></article>`;
    if (!THREAD.length) {
      if (!cap.available)
        return `<article class="cb-braidy-turn cb-braidy-muted" data-braidy-role="unavailable">`
          + `<p>${esc_(cap.message || "No assistant is configured, so Braidy has nothing to think with.")}</p>`
          + `<p>${esc_(cap.action || "Everything below still works without it.")}</p></article>`;
      /* WHERE THE QUALIFICATION NOTE IS SAID, and why it is not in the header.

         In the header it was thirty words of chrome standing over every conversation
         forever, which is how an honest disclosure turns into furniture nobody reads.
         Here it is in front of the filmmaker before they ask anything, once. The
         header still never claims qualification — it says "the assistant you
         configured" — and data-braidy-qualified stays on the section either way. */
      return `<article class="cb-braidy-turn cb-braidy-muted" data-braidy-role="empty">`
        + `<p>Ask me about this shot, a reference, or what to do next.</p>`
        + `${cap.note ? `<p>${esc_(cap.note)}</p>` : ""}</article>`;
    }
    return THREAD.map((entry) => (entry.role === "braidy"
      ? answerMarkup(entry)
      : `<article class="cb-braidy-turn cb-braidy-asked" data-braidy-role="filmmaker"><p>${esc_(entry.text)}</p></article>`)).join("");
  }

  function railMarkup() {
    const shared = contract();
    if (!shared) return "";
    const cap = capability();
    const pose = presentation();
    const handoff = activeHandoff();
    const busy = !!PENDING;
    return `<section class="cb-braidy" data-braidy="1" data-braidy-state="${attr_(pose.state)}" data-braidy-motion="${attr_(pose.motion)}"`
      + ` data-braidy-intent="${attr_(handoff?.intent || "ask")}" data-braidy-qualified="${cap.qualified ? "1" : "0"}">`
      + `<header class="cb-braidy-head">`
      + presenceMarkup(pose.state)
      + `<span class="cb-braidy-id"><b>Braidy</b><small>${esc_(cap.label)}</small></span>`
      + `</header>`
      + `<div class="cb-braidy-thread" role="log" aria-live="polite" aria-label="Braidy">${threadMarkup(cap)}</div>`
      + `<div class="cb-braidy-compose">`
      + `<textarea id="${INPUT_ID}" rows="2" aria-label="Ask Braidy"`
      + ` placeholder="${attr_(cap.available ? "Ask Braidy" : "Braidy needs an assistant in Settings")}"`
      + ` onfocus="window.CineBraidBraidy.setInputActive(true)" onblur="window.CineBraidBraidy.setInputActive(false)"`
      + ` onkeydown="window.CineBraidBraidy.composerKey(event)"></textarea>`
      + `<button type="button" class="cb-braidy-send"${busy || !cap.available ? " disabled" : ""} onclick="window.CineBraidBraidy.submit()">${busy ? "Asking…" : "Ask"}</button>`
      + `</div></section>`;
  }

  /* ==========================================================================
     THE CONTEXTUAL HANDOFF, and the reason it is one function.

     "Improve with Braidy", "Plan with Braidy", "Review with Braidy" and "Fix with
     Braidy" differ by intent and by what they hand over. They do not differ by
     implementation, and none of them re-implements the work its surface already owns:
     the handoff opens the rail, tells Braidy what it is looking at, and offers the
     shipped destinations back to that exact thing. */
  function braidyWith(intent, input = {}) {
    const shared = contract();
    if (!shared) return null;
    let handoff;
    try {
      handoff = shared.braidyHandoff({ ...input, intent });
    } catch (error) {
      FAILURE = String(error?.message || "That handoff was not one Braidy could accept.");
      openRail();
      repaint();
      return null;
    }
    HANDOFF = handoff;
    FAILURE = "";
    openRail();
    repaint();
    if (input.askNow === false) return handoff;
    ask("", handoff);
    return handoff;
  }

  function openRail() {
    const owner = surfaces();
    if (owner && typeof owner.openRail === "function") owner.openRail();
  }

  /* ==========================================================================
     CLEARING. A rail that is closed, or a production that is not open, is not a place
     a question can still be waiting — so the request is aborted rather than left to
     land on a surface nobody is looking at. */
  function reset(reason = "") {
    abort(reason);
    THREAD = [];
    HANDOFF = null;
    FAILURE = "";
    ACKNOWLEDGE_UNTIL = 0;
    SHOW_REST = false;
    INPUT_ACTIVE = false;
    if (ACKNOWLEDGE_TIMER) { clearTimeout(ACKNOWLEDGE_TIMER); ACKNOWLEDGE_TIMER = null; }
  }

  /* WHICH PRODUCTION THE CONVERSATION IS ABOUT.

     CineBraid does not emit a project-changed event. `ACTIVE_PROJECT_SLUG` is a
     top-level binding in public/app.js that load() rewrites, and the surfaces find out
     by being repainted — so Braidy watches the VALUE on the signals it is already
     given rather than subscribing to an event that would never fire. A listener for an
     event nothing dispatches is worse than no listener: it reads as the guarantee it
     is not.

     A conversation about another production's shots is not retained context, it is a
     stale claim, and it is the one thing here worth clearing without being asked. */
  let PROJECT_KEY = null;
  function syncProject() {
    const slug = typeof ACTIVE_PROJECT_SLUG === "undefined" ? "" : String(ACTIVE_PROJECT_SLUG || "");
    if (slug === PROJECT_KEY) return;
    PROJECT_KEY = slug;
    reset();
  }
  window.addEventListener("cinebraid:workspace-updated", syncProject);
  window.addEventListener("cinebraid:route-rendered", syncProject);

  window.CineBraidBraidy = {
    syncProject,
    railMarkup,
    presentation,
    presentationTokens,
    capability,
    ask,
    braidyWith,
    abort,
    reset,
    handoff: () => activeHandoff(),
    thread: () => THREAD.map((entry) => ({ ...entry })),
    lastAnswer: () => {
      for (let index = THREAD.length - 1; index >= 0; index -= 1)
        if (THREAD[index].role === "braidy") return THREAD[index].advisory.text;
      return "";
    },
    explainMore: () => { SHOW_REST = true; repaint(); },
    showLess: () => { SHOW_REST = false; repaint(); },
    setInputActive: (active) => {
      const next = !!active;
      if (next === INPUT_ACTIVE) return;
      INPUT_ACTIVE = next;
      repaint();
    },
    composerKey: (event) => {
      if (!event || event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      window.CineBraidBraidy.submit();
    },
    submit: () => {
      const field = document.getElementById(INPUT_ID);
      const message = field ? String(field.value || "").trim() : "";
      if (!message) return;
      /* Cleared here rather than by the repaint: the reconciler preserves a live
         textarea's value on purpose, so the only thing that may empty it is the send
         that consumed it. */
      if (field) field.value = "";
      ask(message);
    },
  };

  /* The four contextual entry points, as globals because that is how every other
     contextual control in this product is invoked from markup. Each is the same
     handoff with a different intent — there is no fifth implementation behind them. */
  window.braidyImprove = (input) => braidyWith("improve", input);
  window.braidyPlan = (input) => braidyWith("plan", input);
  window.braidyReview = (input) => braidyWith("review", input);
  window.braidyFix = (input) => braidyWith("fix", input);
  window.braidyAsk = (input) => braidyWith("ask", input);
})();

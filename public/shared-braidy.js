/* CineBraid — the Braidy contract. Shared by the browser and Node the same way
   public/shared-creator-state.js and public/shared-stage-model.js are.

   Braidy is the creator-facing voice of the right rail. This file is everything
   about Braidy that has to be TRUE rather than merely rendered, which is why it is
   the half that Node can run: presentation state, the handoff shape, the fixed set
   of actions a handoff may offer, the capability claim, and the rule that a model's
   answer is advisory.

   ---------------------------------------------------------------------------
   THE FOUR PROPERTIES THIS FILE EXISTS TO HOLD.

   1. BRAIDY IS NOT PRODUCTION AUTHORITY. Everything a model returns comes back
      through braidyAdvisory(), which stamps `authority: "advisory"` and carries no
      field any production reader consumes. There is no branch in this file that
      turns a sentence into readiness, into a blocker, into canon, or into a write.
      Recommendation and requirement are separate shapes — braidyAdvisory() can only
      make the first one, and braidyRequirement() will only make the second from a
      deterministic fact that was handed to it.

   2. A MODEL CANNOT MINT AN ACTION. The controls the rail offers come from
      braidyOfferedActions(handoff), and a handoff is built by CineBraid before the
      request is sent. The response is not an input to it. BRAIDY_ACTIONS is a closed
      table of calls that already exist and already own their work, and an
      identifier that is not in it resolves to null rather than to a call.

   3. PRESENTATION IS DERIVED, NEVER DECLARED. braidyPresentation() reads request and
      UI tokens — pending, failed, awaiting a choice, the composer being used — and
      returns one of five states. It cannot see prose, so prose cannot drive the
      mascot. `pending` outranks everything, which is also what stops a settled
      request being described as still running.

   4. NOTHING IS QUALIFIED UNTIL A QUALIFICATION RECORD SAYS SO. braidyCapability()
      is the ONE place a capability claim about Braidy is composed, and it needs two
      separate things: whether an assistant is configured and reachable (which
      CineBraid has always known) and whether a model is a qualified champion (which
      nothing in this product currently asserts). See BRAIDY_QUALIFICATION.

   ---------------------------------------------------------------------------
   WHAT THIS FILE DOES NOT DO. No fetch, no DOM, no timer, no project read. It is
   handed tokens and returns shapes, so a suite can hold every rule in this file
   without a server, a browser or a model. */

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

  function braidyText(value) {
    return String(value == null ? "" : value).trim();
  }

  /* ==========================================================================
     1. PRESENTATION.

     Five states, and the reason there are only five: every one of them is a thing
     the interface already knows without asking anybody. A sixth state would have to
     be told to the rail by something, and the only thing left to tell it is the
     model's own prose. */
  const BRAIDY_PRESENTATION_STATES = ["idle", "listening", "thinking", "acknowledge", "attention"];

  /* The tokens, and nothing else, that may decide a state. Named here so a suite can
     assert the derivation reads these and a reviewer can see there is no sixth. */
  const BRAIDY_PRESENTATION_TOKENS = ["pending", "failed", "acknowledging", "awaitingChoice", "inputActive"];

  /* PENDING OUTRANKS EVERYTHING, and that is the half of the rule that matters least.
     The half that matters is that `pending` is the ONLY route into "thinking": a
     request that was superseded, aborted or closed stops being pending, and the
     state falls back through the same ladder as any other paint. There is no
     "still thinking" that outlives its request, because there is no state that is
     entered once and left by a separate instruction. */
  function braidyPresentation(tokens = {}) {
    const reducedMotion = !!tokens.reducedMotion;
    const decide = () => {
      if (tokens.pending) return { state: "thinking", reason: "pending" };
      if (tokens.failed) return { state: "attention", reason: "failed" };
      if (tokens.acknowledging) return { state: "acknowledge", reason: "acknowledging" };
      /* WAITING IS NOT TROUBLE. Braidy holding a handoff nobody has spoken to yet is
         attentive, not alarmed, so it shares the listening pose. `attention` is
         reachable only from `failed`, which is what keeps it rare enough to mean
         something when it does appear. */
      if (tokens.awaitingChoice) return { state: "listening", reason: "awaitingChoice" };
      if (tokens.inputActive) return { state: "listening", reason: "inputActive" };
      return { state: "idle", reason: "idle" };
    };
    const decided = decide();
    return deepFreeze({
      state: decided.state,
      reason: decided.reason,
      /* Presentation only. "none" is the answer the rail stamps on the element, so a
         reduced-motion reader is served by the markup and not only by a stylesheet
         that a future edit could reorganise away. */
      motion: reducedMotion ? "none" : "on",
    });
  }

  /* ==========================================================================
     2. THE HANDOFF.

     What a contextual "… with Braidy" control hands the rail. Five intents, because
     those are the five the product has controls for; an unknown one is refused
     rather than passed through as a free-form instruction. */
  const BRAIDY_INTENTS = ["ask", "improve", "plan", "review", "fix"];

  const BRAIDY_TARGET_KINDS = ["project", "scene", "shot", "entity", "frame", "motion"];

  /* An id that reaches an onclick expression. Refused rather than escaped, because an
     id CineBraid itself minted has never needed a quote in it, and the alternative to
     refusing is deciding how to encode one — which is how an injection seam is built. */
  const BRAIDY_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

  function braidySafeId(value) {
    const id = braidyText(value);
    return id && BRAIDY_ID_PATTERN.test(id) ? id : "";
  }

  /* THE CLOSED TABLE. Every entry is a call that already exists and already owns its
     work; nothing here is a new way to change a production. `call` is built from the
     handoff's own target, so the control that appears is about the thing the
     filmmaker was looking at when they asked.

     There is deliberately no entry that approves, that establishes canon, that
     dispatches a paid generation, or that retries one. Those decisions have owners
     and the rail is not one of them. */
  const BRAIDY_ACTIONS = deepFreeze({
    "open-activity": {
      id: "open-activity",
      label: "Open activity",
      /* The Terminal keeps the technical record; this is how the rail points at it
         rather than reprinting it. */
      call: () => "openGlobalAutomationActivity()",
    },
    "open-shot": {
      id: "open-shot",
      label: "Open the shot",
      needsTarget: true,
      call: (target) => `location.hash='#/shot/${target.id}'`,
    },
    "open-scene": {
      id: "open-scene",
      label: "Open the scene",
      needsTarget: true,
      call: (target) => `location.hash='#/scene/${target.id}'`,
    },
    "open-stage-task": {
      id: "open-stage-task",
      label: "Open this step",
      needsTarget: true,
      needsStage: true,
      /* The same call the stage bar makes. The rail moves a filmmaker through the
         shipped task selector or it does not move them at all. */
      call: (target, stageId) => `selectBoundedTask('shot-task','${target.id}','${stageId}')`,
    },
    "open-references": {
      id: "open-references",
      label: "Open References",
      call: () => "location.hash='#/library'",
    },
    "open-generated-media": {
      id: "open-generated-media",
      label: "Open Generated Media",
      call: () => "location.hash='#/results'",
    },
  });

  function braidyResolveAction(id) {
    const key = braidyText(id);
    return Object.prototype.hasOwnProperty.call(BRAIDY_ACTIONS, key) ? BRAIDY_ACTIONS[key] : null;
  }

  /* A handoff is refused rather than repaired. A control that could not say which
     shot it came from is a control whose answer would be about some other shot. */
  function braidyHandoff(input = {}) {
    const intent = braidyText(input.intent);
    if (!BRAIDY_INTENTS.includes(intent))
      throw new Error(`Braidy handoff intent "${intent || "(none)"}" is not one Braidy has a control for.`);

    const targetInput = input.target || {};
    const kind = braidyText(targetInput.kind) || "project";
    if (!BRAIDY_TARGET_KINDS.includes(kind))
      throw new Error(`Braidy handoff target kind "${kind}" is not a thing CineBraid can hand over.`);
    const id = braidySafeId(targetInput.id);
    if (kind !== "project" && !id)
      throw new Error(`Braidy handoff for a ${kind} needs an id CineBraid recognises.`);

    const destinations = (Array.isArray(input.destinations) ? input.destinations : [])
      .map((entry) => braidyText(entry))
      .filter((entry, index, all) => entry && all.indexOf(entry) === index);
    for (const destination of destinations) {
      if (!braidyResolveAction(destination))
        throw new Error(`Braidy handoff names destination "${destination}", which is not a shipped action.`);
    }

    return deepFreeze({
      intent,
      /* WHERE IT CAME FROM. Not decoration: the rail prints it, so a filmmaker who
         has moved on can see which surface the answer is about. */
      origin: {
        surface: braidyText(input.origin?.surface) || "unknown",
        route: braidyText(input.origin?.route),
      },
      target: { kind, id, label: braidyText(targetInput.label) || id || "This production" },
      stageId: braidySafeId(input.stageId),
      task: braidyText(input.task),
      /* THE DETERMINISTIC FACTS BRAIDY IS ALLOWED TO RELY ON. Read-only is the whole
         point: these are CineBraid's answer handed over for interpretation, and an
         interpretation that could edit its own evidence is not an interpretation.

         Frozen by the deepFreeze() around this whole object and NOT a second time
         here. A redundant freeze reads as defence in depth and is worse than that:
         nothing can tell the two apart, so a control that removed one would pass
         against the other and the guarantee would look tested when it was not. One
         freeze, at the boundary the handoff leaves through. */
      facts: braidyFacts(input.facts),
      destinations,
    });
  }

  function braidyFacts(input) {
    const facts = {};
    if (!input || typeof input !== "object") return facts;
    for (const [key, value] of Object.entries(input)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) facts[key] = value.map((item) => (typeof item === "object" && item ? { ...item } : item));
      else if (typeof value === "object") facts[key] = { ...value };
      else facts[key] = value;
    }
    return facts;
  }

  /* THE ONLY SOURCE OF A CONTROL IN THE RAIL. It takes a handoff and nothing else —
     in particular it does not take a response — which is the mechanism by which free
     -form model output cannot produce an executable action identifier. */
  function braidyOfferedActions(handoff) {
    if (!handoff || !Array.isArray(handoff.destinations)) return deepFreeze([]);
    const offered = [];
    for (const destination of handoff.destinations) {
      const action = braidyResolveAction(destination);
      if (!action) continue;
      if (action.needsTarget && !handoff.target?.id) continue;
      if (action.needsStage && !handoff.stageId) continue;
      offered.push({
        id: action.id,
        label: action.label,
        call: action.call(handoff.target, handoff.stageId),
        /* The task this control resolves back to, carried so a suite — and a reader —
           can check the control is about the thing the handoff named. */
        target: { kind: handoff.target.kind, id: handoff.target.id },
        stageId: handoff.stageId,
      });
    }
    return deepFreeze(offered);
  }

  /* ==========================================================================
     3. THE ANSWER.

     Advisory, always, and compact by presentation rather than by truncation.

     The rail's normal register is roughly 30-60 words. That is a LAYOUT decision, so
     it is applied by deciding what to show first and never by discarding the rest:
     braidySplitAnswer() returns a lead and a remainder whose concatenation is the
     paragraphs it was given. A legitimate long answer stays whole, behind one
     control. */
  const BRAIDY_COMPACT_WORDS = 60;

  function braidyWordCount(text) {
    const clean = braidyText(text);
    return clean ? clean.split(/\s+/).length : 0;
  }

  function braidyParagraphs(text) {
    return braidyText(text)
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function braidySplitAnswer(text, budget = BRAIDY_COMPACT_WORDS) {
    const paragraphs = braidyParagraphs(text);
    if (!paragraphs.length) return deepFreeze({ lead: [], rest: [], words: 0, compact: true });
    const lead = [];
    let words = 0;
    for (const paragraph of paragraphs) {
      const next = braidyWordCount(paragraph);
      /* The first paragraph is always shown whole. A budget that could cut a sentence
         in half would be the destructive truncation this split exists to avoid. */
      if (lead.length && words + next > budget) break;
      lead.push(paragraph);
      words += next;
    }
    const rest = paragraphs.slice(lead.length);
    return deepFreeze({ lead, rest, words: braidyWordCount(paragraphs.join(" ")), compact: !rest.length && words <= budget });
  }

  /* WHAT COMES BACK FROM A MODEL, typed as what it is. `authority` is stamped here
     and nowhere else, and there is no argument that can change it. */
  function braidyAdvisory(text, handoff = null) {
    const split = braidySplitAnswer(text);
    return deepFreeze({
      kind: "advisory",
      authority: "advisory",
      text: braidyText(text),
      lead: split.lead,
      rest: split.rest,
      words: split.words,
      compact: split.compact,
      /* Carried so the rendered answer can say which handoff it belongs to. Copied
         from the frozen handoff, never re-derived from the answer. */
      intent: handoff ? handoff.intent : "ask",
      target: handoff ? handoff.target : null,
    });
  }

  /* THE OTHER SHAPE, and the reason there are two.

     "I'd keep the opening frame" and "this shot cannot be generated yet" are not the
     same claim, and a rail that spelled them the same way would teach a filmmaker to
     read a preference as a gate. A requirement can only be made from a fact CineBraid
     already holds — the caller passes the deterministic source — so there is no path
     from prose to a blocker. */
  function braidyRequirement(fact = {}) {
    const source = braidyText(fact.source);
    if (!source)
      throw new Error("A Braidy requirement needs the deterministic source that established it.");
    return deepFreeze({
      kind: "requirement",
      authority: "deterministic",
      source,
      statement: braidyText(fact.statement),
      blocking: fact.blocking !== false,
    });
  }

  /* ==========================================================================
     4. CAPABILITY, AND THE QUALIFICATION SEAM.

     CineBraid has always known two things about text assistance: which provider is
     configured, and whether it answered. `assistantCapabilities().text` is that
     answer and it is unchanged by this file.

     It has never known a third thing: whether the model behind it has passed a frozen
     product qualification. Nothing in this product asserts that today —
     BRAIDY_QUALIFICATION.champion is null and its standing is "none" — and this
     function is the one place a future qualification record would govern what Braidy
     is allowed to be called. Everything downstream reads `qualified` from here rather
     than inferring it from a provider name, a model id or a reachable endpoint.

     A CONFIGURED ASSISTANT IS STILL A WORKING ASSISTANT. `available` is true whenever
     the configured provider answered, exactly as it was before Braidy existed, so
     nothing a filmmaker already had stops working for want of a champion. What
     changes is only the WORDS: it is described as the assistant they configured, not
     as a qualified one. */
  const BRAIDY_QUALIFICATION = deepFreeze({
    /* No product-qualified champion exists. This is a record of standing, not a
       placeholder to be filled in by whatever is convenient: a champion appears here
       when a model has passed its frozen gate, and until then every claim composed
       below is a claim about configuration. */
    champion: null,
    standing: "none",
    /* Named so the rail can be honest about what the reference runtime is FOR. It is
       research standing, not a shipped promise, and it is not what "configured"
       means either. */
    referenceRuntime: "DGX Spark reference runtime (research standing, not a product qualification)",
  });

  function braidyCapability(capability = {}, qualification = BRAIDY_QUALIFICATION) {
    const available = !!capability.ready;
    const provider = braidyText(capability.provider);
    const model = braidyText(capability.model);
    const champion = qualification && qualification.champion ? braidyText(qualification.champion) : "";
    const standing = braidyText(qualification && qualification.standing) || "none";
    /* A champion is a claim about a MODEL, so it is only claimable when a champion
       exists AND the configured model is that champion. Two separate facts, and
       neither of them is "the endpoint replied". */
    const qualified = !!champion && standing === "qualified" && !!model && model === champion;
    return deepFreeze({
      available,
      configured: provider !== "" && provider !== "none",
      provider,
      model,
      qualified,
      standing: qualified ? standing : "none",
      champion: qualified ? champion : null,
      /* The sentence the rail prints. It says "you configured", never "qualified",
         unless the two facts above both held. */
      label: !available
        ? "Braidy has no assistant to think with yet."
        : qualified
          ? `Braidy is running on ${model}, a qualified assistant.`
          : model
            ? `Braidy is using the assistant you configured (${model}).`
            : "Braidy is using the assistant you configured.",
      /* Said out loud rather than implied by omission. A filmmaker running a local
         model should know CineBraid has not certified it, and should still be able
         to use it. */
      note: available && !qualified
        ? "It is your configured assistant, not a CineBraid-qualified one, so treat what it says as a suggestion."
        : "",
      /* Unchanged, and passed straight through: the existing capability check already
         says exactly what is wrong and what to do about it. */
      message: braidyText(capability.message),
      action: braidyText(capability.action),
    });
  }

  /* ==========================================================================
     5. THE REQUEST BODY.

     One shape, built from the handoff, sent to the assistant route CineBraid already
     has. There is no second assistant backend and this function is the reason there
     does not need to be one: a contextual action is a differently-framed QUESTION,
     and the project record the answer is grounded in is still read by the server. */
  const BRAIDY_INTENT_FRAMING = deepFreeze({
    ask: "Answer the question.",
    improve: "Suggest how to improve this, and say what you would keep.",
    plan: "Say what you would do next, and why.",
    review: "Give your read on this, including what is working.",
    fix: "Say what is wrong and the smallest change that would address it.",
  });

  function braidyQuestion(handoff, message = "") {
    if (!handoff) throw new Error("Braidy needs a handoff to frame a question.");
    const asked = braidyText(message);
    const lines = [];
    lines.push(BRAIDY_INTENT_FRAMING[handoff.intent] || BRAIDY_INTENT_FRAMING.ask);
    if (handoff.target?.kind !== "project" && handoff.target?.id)
      lines.push(`This is about ${handoff.target.kind} ${handoff.target.id}.`);
    if (handoff.task) lines.push(handoff.task);
    if (Object.keys(handoff.facts || {}).length)
      lines.push(`What CineBraid already knows, which you may rely on and must not contradict: ${JSON.stringify(handoff.facts)}`);
    if (asked) lines.push(asked);
    /* THE REGISTER, asked for rather than enforced by cutting. The split above is what
       keeps a long answer readable when the model ignores this. */
    lines.push("Reply in about 30-60 words, in one to three short paragraphs. Give one recommendation. Say plainly when a choice is the filmmaker's, without using stock phrases for it. Do not claim to have changed anything.");
    return lines.join("\n\n");
  }

  return {
    BRAIDY_PRESENTATION_STATES,
    BRAIDY_PRESENTATION_TOKENS,
    BRAIDY_INTENTS,
    BRAIDY_TARGET_KINDS,
    BRAIDY_ACTIONS,
    BRAIDY_COMPACT_WORDS,
    BRAIDY_QUALIFICATION,
    BRAIDY_INTENT_FRAMING,
    braidySafeId,
    braidyPresentation,
    braidyHandoff,
    braidyResolveAction,
    braidyOfferedActions,
    braidySplitAnswer,
    braidyWordCount,
    braidyAdvisory,
    braidyRequirement,
    braidyCapability,
    braidyQuestion,
  };
});

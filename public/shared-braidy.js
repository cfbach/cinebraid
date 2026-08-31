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
     1b. THE SPRITE TABLE — a second closed table, for the same reason as the first.

     The art is Braidy V3.2, the knot-forward production library. Its master is a
     64x64 Aseprite document outside this repository; what ships here is six exported
     PNG strips, byte-for-byte, whose SHA-256 are recorded in that package's
     BRAIDY_PACKAGE_MANIFEST_V32.sha256 and re-checked by tests/braidy-rail.js. The
     master, the build scripts, the review boards, the GIF QA previews and the 2x/4x/8x
     packs are deliberately not here: the runtime needs five strips and one static
     frame, and 15 KB of it.

     WHY 1x IS THE HiDPI ANSWER. The canonical frame is 64 x 64 and the rail draws
     Braidy in a 32 CSS px box — the smallest size the package's own UI-size QA board
     covers. At a device pixel ratio of 2 that is 64 device pixels from a 64 pixel
     source: exact, one to one, no filtering. At ratio 1 it is a clean 2:1. Shipping
     the 2x pack as well would buy nothing above ratio 2 and would double the bytes.

     THE MAPPING IS THE PACKAGE'S OWN, not filename guessing. exports/braidy_state_map_v32.json
     maps its creator-facing `idle` to the IDLE_SOFT tag — the restrained one — and
     keeps the busier IDLE for `ambient_idle`. `working` and the `reviewing` alias both
     resolve to PROCESSING, which is why a request in flight draws PROCESSING and not
     THINKING: THINKING belongs to the package's "cognitive" mix and would have Braidy
     look contemplative while CineBraid is simply executing.

     AND IT IS A TABLE, so a state cannot name a file. braidySprite() reads own
     properties of this object only. There is no concatenation of caller input into a
     path, no traversal to escape the directory, and nothing outside these six files is
     addressable — which is what makes free-form model output unable to point the rail
     at anything at all. */
  const BRAIDY_SPRITE_BASE = "assets/assistant-character/";
  /* The box the rail draws Braidy in, and the divisor every sheet offset is computed
     from. One number, so the markup and the stylesheet cannot disagree about it. */
  const BRAIDY_SPRITE_SIZE = 32;
  /* What reduced motion shows, for every state. The package specifies the static FRONT
     view and this is it — one frame, no strip, nothing to cycle. It is deliberately
     NOT "frame zero of whichever animation was selected": that would make the still
     image depend on an animation nobody is playing. Which state the rail is in stays
     legible in words, which is where a presentation-only mascot should never have been
     carrying it. */
  const BRAIDY_STATIC_SPRITE = deepFreeze({ tag: "FRONT", file: "braidy-front-v32.png", frames: 1, durations: [], totalMs: 0, loop: false });

  const BRAIDY_SPRITES = deepFreeze({
    idle: { tag: "IDLE_SOFT", file: "braidy-idle-soft-v32.png", frames: 8, durations: [520, 420, 500, 420, 600, 65, 75, 260], totalMs: 2860, loop: true },
    listening: { tag: "LISTENING", file: "braidy-listening-v32.png", frames: 6, durations: [360, 320, 420, 360, 320, 460], totalMs: 2240, loop: true },
    thinking: { tag: "PROCESSING", file: "braidy-processing-v32.png", frames: 8, durations: [260, 240, 260, 300, 260, 240, 260, 340], totalMs: 2160, loop: true },
    acknowledge: { tag: "ACKNOWLEDGE", file: "braidy-acknowledge-v32.png", frames: 6, durations: [130, 95, 75, 100, 130, 260], totalMs: 790, loop: false },
    attention: { tag: "NEEDS_DECISION", file: "braidy-needs-decision-v32.png", frames: 8, durations: [340, 240, 260, 520, 320, 260, 220, 420], totalMs: 2580, loop: false },
  });

  /* THE ONE WAY A STATE BECOMES AN IMAGE. Unknown states, prototype-chain names and
     anything that is not one of the five resolve to null rather than to a file. */
  function braidySprite(state, options = {}) {
    const key = braidyText(state);
    if (!Object.prototype.hasOwnProperty.call(BRAIDY_SPRITES, key)) return null;
    const sprite = options.reducedMotion ? BRAIDY_STATIC_SPRITE : BRAIDY_SPRITES[key];
    return deepFreeze({
      state: key,
      tag: sprite.tag,
      file: sprite.file,
      url: BRAIDY_SPRITE_BASE + sprite.file,
      frames: sprite.frames,
      /* The strip's rendered width. A one-frame static sprite is one box wide, so the
         same expression covers both without a branch anywhere downstream. */
      sheetWidth: sprite.frames * BRAIDY_SPRITE_SIZE,
      size: BRAIDY_SPRITE_SIZE,
      /* The authored per-frame durations, carried rather than averaged. They are what
         the stylesheet's keyframe stops are derived from, and tests/braidy-rail.js
         re-derives them from here — so the CSS cannot quietly become even timing and
         turn IDLE_SOFT's 65ms blink into a slow eye-close. */
      durations: sprite.durations,
      totalMs: sprite.totalMs,
      loop: sprite.loop,
      /* True only when there is nothing to cycle. The rail stamps it so a suite can
         tell "reduced motion is being honoured" from "this state happens to be still". */
      still: sprite.frames === 1,
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

  /* ==========================================================================
     WHAT A FACT MAY BE, and why copying it is a validation rather than a clone.

     The handoff's promise is that CineBraid's answers are copied and then frozen
     INDEPENDENTLY of the caller. The first version copied one level: a nested object
     kept the caller's identity, an array inside an object kept the caller's identity,
     and the deepFreeze() that followed therefore reached out of Braidy and froze the
     caller's own live objects. A surface that had handed over a shot block would find
     its next push() throwing. An array inside an array fared worse still: it was
     spread as an object and arrived as {"0":"deep"}, which is not aliasing but silent
     corruption of the evidence the model was about to be given.

     So this walks the whole graph, and it REFUSES rather than repairs. Every value
     below is one the record can actually carry to the request and back out again in
     the same shape:

       null / undefined   omitted from an object, refused inside an array
       boolean, string    carried
       finite number      carried; NaN and Infinity are refused, because
                          JSON.stringify turns them into null and the model would be
                          told a fact CineBraid never recorded
       array              of permitted values
       plain object       Object.prototype or a null prototype, of permitted values

     Everything else is refused where it is handed over, not where it fails. A
     function, a symbol or a Date would have been carried into the facts and quietly
     dropped or emptied by JSON.stringify; a BigInt would have thrown at request time,
     a long way from the caller that supplied it. A Map or a Set would have arrived as
     {}. None of those is a fact CineBraid can state.

     THIS IS NOT A CLONE FRAMEWORK and must not become one. It knows six shapes,
     bounds the graph's depth, and refuses a cycle outright — a record cannot contain
     itself, and the alternative to refusing is either an infinite walk or a
     half-copied graph with one caller-owned node still in it. */
  const BRAIDY_FACT_MAX_DEPTH = 8;

  function braidyFactPath(path) {
    return path.length ? `facts.${path.join(".")}` : "facts";
  }

  function braidyFactRefusal(path, said) {
    return new Error(`Braidy cannot carry ${braidyFactPath(path)}: ${said}`);
  }

  /* PLAIN, ASKED IN A WAY THAT SURVIVES A REALM BOUNDARY AND STILL MEANS SOMETHING.

     Two wrong answers were tried before this one.

     `proto === Object.prototype` is realm-sensitive: this file is evaluated in a vm
     context by its own suite, and every fact object built by the host would have been
     refused as exotic. The same is true of anything reaching a browser from another
     frame.

     `Object.getPrototypeOf(proto) === null` fixed that and was far too generous. It
     asks "does the chain stop one step up", which is true of Object.prototype in every
     realm — and equally true of any prototype somebody rooted at null. All of these
     were accepted by it:

       class Exotic {}
       Object.setPrototypeOf(Exotic.prototype, null)
       new Exotic()                                  a class instance, straight through

       const proto = Object.create(null)
       Object.create(proto)                          an instance of a caller's own type

     The question is not how long the chain is. It is whether `proto` IS the intrinsic
     Object.prototype of the realm the value came from, and that has to be established
     rather than inferred from shape.

     WHAT ESTABLISHES IT. An intrinsic Object.prototype is introduced by a native
     `Object` constructor that points back at it, and carries native methods of its
     own. Both halves are checked, and neither can be forged from script:

       * the constructor is read as an OWN DATA PROPERTY, so an inherited or accessor
         `constructor` proves nothing;
       * `constructor.prototype === proto`, which is what defeats handing over the real
         `Object` as somebody else's constructor — and is also why a Proxy cannot be
         used here, since the proxy invariants forbid reporting a `prototype` other
         than the target's non-configurable one;
       * `Function.prototype.toString` reports `[native code]` for genuine intrinsics
         only. It is called through Function.prototype rather than through the value,
         so an own `toString` cannot answer for it; a Proxy or a bound function loses
         the name and reads `function () { [native code] }`; an authored
         `function Object() {}` and a `class Object {}` read as their own source; and a
         body written to LOOK native fails the anchors.

     A DIRECT null prototype stays accepted on its own — `Object.create(null)` is a
     plain record with nothing between it and nothing, which is exactly what a fact
     bag is. What is refused is inheriting from a null-rooted prototype somebody else
     made, because that is an instance of their type and not a record.

     Memoised in a WeakSet, because a fact graph is normally one realm and this would
     otherwise re-derive the same answer for every node. */
  const BRAIDY_INTRINSIC_PROTOTYPES = new WeakSet();
  const BRAIDY_FOREIGN_PROTOTYPES = new WeakSet();
  const BRAIDY_NATIVE_SOURCE = /^function\s+([A-Za-z$_][\w$]*)\s*\(\s*\)\s*\{\s*\[native code\]\s*\}$/;

  function braidyNativeFunctionNamed(candidate, name) {
    if (typeof candidate !== "function") return false;
    let source = "";
    try { source = Function.prototype.toString.call(candidate); } catch { return false; }
    const match = BRAIDY_NATIVE_SOURCE.exec(source);
    return !!match && match[1] === name;
  }

  function braidyIntrinsicObjectPrototype(proto) {
    if (BRAIDY_INTRINSIC_PROTOTYPES.has(proto)) return true;
    if (BRAIDY_FOREIGN_PROTOTYPES.has(proto)) return false;
    const decide = () => {
      if (Object.getPrototypeOf(proto) !== null) return false;
      const constructorAt = Object.getOwnPropertyDescriptor(proto, "constructor");
      if (!constructorAt || !("value" in constructorAt)) return false;
      const constructor = constructorAt.value;
      if (!braidyNativeFunctionNamed(constructor, "Object")) return false;
      /* Read once. `constructor.prototype` on an exotic callable can throw. */
      let introduced = null;
      try { introduced = constructor.prototype; } catch { return false; }
      if (introduced !== proto) return false;
      /* A second intrinsic anchor, for the same price. */
      const hasOwn = Object.getOwnPropertyDescriptor(proto, "hasOwnProperty");
      return !!hasOwn && "value" in hasOwn && braidyNativeFunctionNamed(hasOwn.value, "hasOwnProperty");
    };
    const answer = decide();
    (answer ? BRAIDY_INTRINSIC_PROTOTYPES : BRAIDY_FOREIGN_PROTOTYPES).add(proto);
    return answer;
  }

  function braidyPlainObject(value) {
    const proto = Object.getPrototypeOf(value);
    return proto === null || braidyIntrinsicObjectPrototype(proto);
  }

  /* The two refusals both walkers can reach, worded once so the order they run in
     cannot change what a caller is told. */
  function braidyDepthRefusal(path) {
    return braidyFactRefusal(path, `it is nested deeper than ${BRAIDY_FACT_MAX_DEPTH} levels. Facts are a bounded record of what CineBraid knows, not a document.`);
  }
  function braidyCycleRefusal(path) {
    return braidyFactRefusal(path, "it refers back to something that contains it. A record cannot contain itself.");
  }
  function braidySparseRefusal(path) {
    return braidyFactRefusal(path, "the array has no value at this position. A fact array is an explicit sequence, and a hole is not an absent fact but an unwritten one: it serialises as null, or as whatever Array.prototype happens to hold at that index when the request is built.");
  }
  function braidyAccessorRefusal(path) {
    return braidyFactRefusal(path, "it is an accessor. A fact is an inert recorded value and not behaviour, so a getter is refused rather than run: a property that answers with code can answer differently every time it is asked, and CineBraid would be handing the model something it never recorded.");
  }

  function braidyFactValue(value, path, ancestors) {
    if (path.length > BRAIDY_FACT_MAX_DEPTH)
      throw braidyDepthRefusal(path);

    const type = typeof value;
    if (type === "boolean" || type === "string") return value;
    if (type === "number") {
      if (!Number.isFinite(value))
        throw braidyFactRefusal(path, `it is ${String(value)}, which reaches the model as null. Braidy would be told a number CineBraid never recorded.`);
      return value;
    }
    if (value === null || value === undefined)
      throw braidyFactRefusal(path, "an array element cannot be empty. Dropping it would move every fact after it, and a fact whose position moved is not the fact CineBraid handed over.");
    if (type !== "object")
      throw braidyFactRefusal(path, `a ${type} is not something CineBraid can state.`);
    /* ANCESTORS, not "everything seen". The same object appearing twice in different
       branches is a value used twice and is copied twice; only a value that contains
       itself is a cycle. */
    if (ancestors.has(value))
      throw braidyCycleRefusal(path);

    const within = new Set(ancestors);
    within.add(value);
    if (Array.isArray(value)) return braidyFactArray(value, path, within);
    if (!braidyPlainObject(value))
      throw braidyFactRefusal(path, `a ${value.constructor?.name || "non-plain object"} is not a fact. It would arrive as an empty object or be dropped, and neither is what CineBraid meant.`);
    return braidyFactObject(value, path, within);
  }

  /* NULL AND UNDEFINED ARE OMITTED FROM AN OBJECT, which is what this contract has
     always done at the top level and now does at every depth. A key CineBraid has no
     answer for is a key Braidy is not told about, rather than one it is told is
     empty. */
  /* COPIED FROM THE DESCRIPTOR, never re-read through `input[key]`.

     By the time this runs the shape preflight has already established that every
     property on this surface is a data property, and reading through the object again
     would be a second observable property access for no reason. The key set is
     unchanged — own enumerable string-keyed, exactly what Object.entries gave — and
     the accessor branch below is defence in depth rather than the place accessors are
     caught. */
  function braidyFactObject(input, path, ancestors) {
    const facts = {};
    for (const key of Object.keys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) continue;
      if (!("value" in descriptor)) throw braidyAccessorRefusal([...path, key]);
      const value = descriptor.value;
      if (value === null || value === undefined) continue;
      facts[key] = braidyFactValue(value, [...path, key], ancestors);
    }
    return facts;
  }

  /* THE SAME, FOR AN ARRAY, AND EVERY POSITION MUST BE WRITTEN.

     `value.map()` reads each index through the object, which is a getter-capable
     lookup: an accessor installed at an index would have run. So the indices are read
     by descriptor, and an index with no OWN descriptor is a hole and is refused.

     A hole is not an absent fact, it is an unwritten one, and the difference matters
     at the only moment that counts — serialisation. `JSON.stringify([1, , 3])` is
     "[1,null,3]", so a position CineBraid never recorded arrives at the model as an
     explicit null. Worse, and measured: the copy is an ordinary array, so a hole reads
     through to Array.prototype. With a value parked at index 1 there, [1, , 3] was
     carried as ["1","inherited","3"] — something that was never in the record at all.

     This is the rule the contract already applies to an explicit null or undefined in
     an array, for the same reason: array position is semantic, and a slot must say
     what is in it. OWN descriptors only, so an inherited numeric property does not
     fill a hole; that is the case above. */
  function braidyFactArray(input, path, ancestors) {
    const facts = [];
    facts.length = input.length;
    for (let index = 0; index < input.length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) throw braidySparseRefusal([...path, key]);
      if (!("value" in descriptor)) throw braidyAccessorRefusal([...path, key]);
      facts[index] = braidyFactValue(descriptor.value, [...path, key], ancestors);
    }
    return facts;
  }

  /* ==========================================================================
     THE SHAPE PREFLIGHT — descriptors only, and the first thing that walks.

     A Braidy fact is an INERT RECORDED VALUE. A getter is not one: it is behaviour,
     and behaviour asked twice can answer twice differently. That is not hypothetical
     here. Before this existed, the cloneability preflight read the record once and the
     copier read it again, and a getter alternating between a harmless object and a
     prototype-spoofing Proxy put `{ secret: 7 }` into the facts — the preflight saw one
     graph and the walker copied another.

     So accessors are refused, and refused WITHOUT BEING RUN. That is why this pass
     exists separately and runs first: `structuredClone` itself reads enumerable
     properties, so an accessor rejected after it would already have executed. Nothing
     here reads a value through `input[key]`; it asks for the descriptor and descends
     only through `descriptor.value`.

     WHAT THIS PASS DOES NOT CLAIM. It is not a Proxy detector — a Proxy traps
     `ownKeys` and `getOwnPropertyDescriptor` as readily as anything else, and
     inspecting one runs its handler code. Browser JavaScript cannot promise otherwise
     through ordinary reflection. The jobs stay separate: this pass owns "does this
     surface present data or behaviour", the structured-clone preflight owns the
     Proxy/uncloneable boundary, and braidyFactValue owns which types are facts. */
  function braidyFactShapeValue(value, path, ancestors) {
    if (path.length > BRAIDY_FACT_MAX_DEPTH) throw braidyDepthRefusal(path);
    if (value === null || typeof value !== "object") return;
    if (ancestors.has(value)) throw braidyCycleRefusal(path);
    const within = new Set(ancestors);
    within.add(value);
    braidyFactShapeSurface(value, path, within);
  }

  /* Own enumerable string-keyed properties — the same surface the copier reads, and
     the same one structured clone serialises. A non-enumerable or symbol-keyed
     accessor is outside it: never copied, never cloned, never run, and deliberately
     not refused, because refusing it would widen a contract nothing reads.

     AN ARRAY'S SURFACE IS ITS INDICES, which is not what Object.keys() would give: a
     named property hung on an array is enumerable and would be inspected here while
     the copier ignores it entirely. The two passes have to agree about what they are
     looking at — that agreement is the whole reason the shape pass makes the clone
     preflight sound — so this walks 0..length-1 by descriptor exactly as the copier
     does. Density is not asked here; whether a position may be empty is a question
     about the VALUE, and braidyFactArray owns it. */
  function braidyFactShapeSurface(input, path, ancestors) {
    if (Array.isArray(input)) {
      for (let index = 0; index < input.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor) continue;
        if (!("value" in descriptor)) throw braidyAccessorRefusal([...path, key]);
        braidyFactShapeValue(descriptor.value, [...path, key], ancestors);
      }
      return;
    }
    for (const key of Object.keys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) continue;
      if (!("value" in descriptor)) throw braidyAccessorRefusal([...path, key]);
      braidyFactShapeValue(descriptor.value, [...path, key], ancestors);
    }
  }

  /* ==========================================================================
     THE PREFLIGHT, and why authenticating the prototype was not enough.

     Everything above trusts `Object.getPrototypeOf(value)`. That is an OPERATION, not
     a fact, and a Proxy can trap it:

       class Exotic { constructor() { this.secret = 7; } }
       new Proxy(new Exotic(), { getPrototypeOf: () => Object.prototype })

     The trap hands back the genuine intrinsic Object.prototype, so the authentication
     above authenticates it — correctly — and the class instance crosses the boundary
     and is copied out as `{ secret: 7 }`. The invariant that would normally force a
     Proxy to tell the truth about its prototype only applies when the target is
     non-extensible, and an ordinary instance is extensible. Measured, not assumed.

     There is no way to ask an object whether it is a Proxy, and every surface that
     might hint at it — the prototype, the constructor, the own keys, the descriptors,
     `instanceof`, `toString` — is a surface a Proxy virtualises. So this does not try.
     It asks the PLATFORM instead: structured clone refuses a Proxy outright, at every
     depth, and refuses it whether the prototype it reports is this realm's, another
     realm's, or a lie. That is a decision made below the language, by machinery a
     handler cannot reach.

     THE CLONE IS THROWN AWAY, and that is the whole design rather than an economy.
     Structured clone is BROADER than this contract: `structuredClone(new Exotic())`
     succeeds and yields `{ secret: 7 }`, a Date becomes a Date, a Map becomes a Map.
     Using its output as the facts would launder every one of those into something the
     strict walker below would then wave through. So the clone proves one thing —
     "nothing in this graph is uncloneable" — and is discarded unread. What a fact may
     BE is still decided entirely by braidyFactValue() and braidyPlainObject(), against
     the ORIGINAL values.

     It runs FIRST, before any prototype is trusted. Cycles, BigInt, non-finite numbers
     and the unsupported built-ins all clone successfully, so each of those still
     reaches its own refusal with its own words; only a Proxy, a function and a symbol
     are stopped here, and only the first of those could otherwise have lied.

     IT IS NOT ASKED FIRST. The shape preflight above it is, because structured clone
     reads enumerable properties and would therefore RUN an accessor before this
     boundary had a chance to refuse the record. Braidy fact records are inert data:
     accessor properties are refused and never evaluated, which is what makes "the
     graph the preflight saw" and "the graph the copier walks" the same graph. */
  function braidyPlatform() {
    return typeof globalThis !== "undefined" ? globalThis : null;
  }

  function braidyFactsCloneabilityPreflight(input) {
    const platform = braidyPlatform();
    /* FAIL CLOSED. A missing check is not a passed one: without this primitive there
       is no way to establish that a value has not virtualised its own identity, and
       the honest answer is to refuse the record rather than fall back to the weaker
       validation this exists to backstop. */
    if (!platform || typeof platform.structuredClone !== "function")
      throw braidyFactRefusal([], "the platform's structured-clone primitive is unavailable, and Braidy will not accept a fact record it cannot first prove is ordinary data.");
    try {
      platform.structuredClone(input);
    } catch {
      /* Deliberately not the platform's own prose, which varies by engine and is not a
         product contract. And deliberately not a claim that this WAS a Proxy: the
         platform reports one failure for a family of exotic values and CineBraid does
         not pretend to have distinguished them. */
      throw braidyFactRefusal([], "it holds a value the platform cannot clone — a Proxy, or another exotic object. A fact is plain data, and a value that can lie about what it is cannot be one.");
    }
  }

  function braidyFacts(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    if (!braidyPlainObject(input))
      throw braidyFactRefusal([], `a ${input.constructor?.name || "non-plain object"} is not a record of facts.`);
    /* FIRST, because structuredClone reads enumerable properties and an accessor
       refused after it would already have run. */
    braidyFactShapeSurface(input, [], new Set([input]));
    /* Then, before a single prototype is trusted. */
    braidyFactsCloneabilityPreflight(input);
    return braidyFactObject(input, [], new Set([input]));
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
    /* THERE IS NO THIRD FIELD, and that is deliberate. A research runtime does have a
       name, and naming it here would put a string one edit away from being rendered as
       a capability — which is precisely how a lab control becomes a product promise.
       What a qualification WAS run against belongs in the research record; what the
       product may claim belongs here, and today it is nothing. */
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
    BRAIDY_SPRITE_BASE,
    BRAIDY_SPRITE_SIZE,
    BRAIDY_SPRITES,
    BRAIDY_STATIC_SPRITE,
    braidySprite,
    BRAIDY_INTENTS,
    BRAIDY_TARGET_KINDS,
    BRAIDY_ACTIONS,
    BRAIDY_COMPACT_WORDS,
    BRAIDY_QUALIFICATION,
    BRAIDY_INTENT_FRAMING,
    braidySafeId,
    /* Exported so a suite can put the predicate under every prototype shape directly,
       rather than only through a handoff. */
    braidyPlainObject,
    braidyFactsCloneabilityPreflight,
    braidyFactShapeSurface,
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

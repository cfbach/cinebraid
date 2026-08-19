/* CineBraid — SHOT INTENT: the filmmaker-facing half of the declared delivery route.
 *
 * Batch 2 Slice 5a put ONE durable production statement on the shot record —
 * `shot.deliveryRoute`, canonically `t2v | i2v | flf | r2v | hybrid` — and deliberately
 * shipped no surface for it. This module is the projection Slice 5b needs in order to
 * make that statement useful, and it is a PROJECTION: it stores nothing, writes nothing,
 * reaches no DOM, no clock, no network and no filesystem, and it decides no
 * admissibility of its own.
 *
 * ---------------------------------------------------------------------------
 * THE ONE SENTENCE THAT DEFINES THE WHOLE FILE.
 *
 *     A declared route may NARROW what an existing CineBraid authority already
 *     permits. It may never widen it, and it may never grant anything.
 *
 * That is structural here rather than merely tested: shotIntentEffectiveModes() is a
 * `filter` over the array its caller hands it. There is no branch in this file that can
 * put a mode into a result that was not in the input, because there is no expression in
 * this file that adds one — no concat, no push onto a supplied list, no default set. A
 * caller that passes an empty admissible list gets an empty answer for every route,
 * including a perfectly valid one, and that is correct: the route is not the authority.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS NOT, and who owns each of them instead.
 *
 *     the route vocabulary        public/shared-shot-route.js (Slice 5a). This file
 *                                 declares no route token of its own; every one it
 *                                 uses comes out of CINEBRAID_SHOT_ROUTES.
 *     the storage representation  the same file. Reading and writing a shot's route is
 *                                 readShotRoute / declareShotRoute / clearShotRoute and
 *                                 nothing else; this module never touches the key.
 *     what may be generated       resolveTaskModes(), in
 *                                 public/shared-generation-options.js. Untouched, and
 *                                 not consulted from here — its ANSWER is what a caller
 *                                 hands in.
 *     what a method needs         public/shared-shot-readiness.js's
 *                                 ANIMATE_METHOD_PROBES, which is itself DERIVED from
 *                                 resolveTaskModes() at load rather than tabulated. This
 *                                 file reads that derivation and restates none of it.
 *     the stage model             public/shared-stage-model.js, which must not learn
 *                                 that routes exist: tests/stage-model.js asserts its
 *                                 source names no route token, and that line is not
 *                                 crossed by this slice. Frame RELEVANCE below is a
 *                                 presentation answer that sits beside the stage model,
 *                                 never inside it, and it changes no availability, no
 *                                 completion and no progress.
 *     the words                   the UI layer. This module returns tokens, roles and
 *                                 the SHIPPED mode language; it writes no sentence a
 *                                 filmmaker reads, for the same reason the stage model
 *                                 returns `note` as a token plus its counts.
 *
 * ---------------------------------------------------------------------------
 * WHY hybrid IS CONSTRAINED AND STILL NARROWS TO EVERYTHING.
 *
 * Slice 5a settled that `hybrid` is not a generation mode: "it names no mode precisely
 * because it names no single method". A shot declared hybrid is delivered by more than
 * one of the methods the other four routes name, so the honest compatible set is the
 * union of those four — derived here from CINEBRAID_SHOT_ROUTE_MODES rather than typed
 * out, so a fifth video route would join it automatically.
 *
 * On `animate-shot` that intersection removes nothing, because the shipped resolver can
 * only ever return one of those four. It is still NOT the same answer as an undeclared
 * route, and the difference is the point:
 *
 *     undeclared   `constrained: false`. NO intersection is applied at all. The
 *                  caller's list is returned unchanged, whatever is in it.
 *     hybrid       `constrained: true`. An intersection IS applied, against the four
 *                  methods a hybrid shot is composed of. A mode that is not one of them
 *                  — `edit`, `t2i`, `video-edit`, `retake` — is removed.
 *
 * So hybrid never collapses into absence, never widens, and never becomes a mode.
 *
 * ---------------------------------------------------------------------------
 * FRAME RELEVANCE NEEDS TWO SHIPPED ANSWERS AND THIS FILE OWNS NEITHER.
 *
 * "Does this route need the Frames workflow" has two authorities in the repository and
 * they do not agree about r2v:
 *
 *     ANIMATE_METHOD_PROBES               r2v's needs are ["reference"] — no frame role
 *     guidedVideoModeNeedsApprovedStill   TRUE for r2v: the shipped motion workspace
 *                                         gates every route except t2v behind an
 *                                         approved still, and ensureGuidedMotionUnit
 *                                         attaches `fromFrame` on the same predicate
 *
 * The UNION is taken, and taking it is the only safe reading. Hiding Frames for a route
 * the shipped Motion panel then refuses to open without an approved frame would send a
 * filmmaker to a locked panel with no way back — a workflow simplification that removes
 * the workflow. So the Frames workflow is de-emphasised only where EVERY shipped
 * authority agrees no input is required, which today is `t2v` and only `t2v`.
 *
 * The second authority lives in public/creation-studio.js, so it is PASSED IN rather
 * than copied. There is no default: a caller that cannot supply it gets `known: false`
 * and no adaptation whatsoever, which is baseline behaviour and the only honest answer.
 *
 * ---------------------------------------------------------------------------
 * ABSENCE AND CORRUPTION BOTH MEAN "DO NOTHING".
 *
 * A shot with no declared route, and a shot carrying a token this build cannot read, are
 * DIFFERENT FACTS — readShotIntent reports them differently so a surface can say so —
 * and they produce the IDENTICAL behaviour here: no narrowing, no adaptation, baseline
 * exposure. Nothing in this file turns an unreadable value into a route, and nothing in
 * it lets one reach a result that a valid route could not.
 */

(function (root, factory) {
  const nodeModule = typeof module !== "undefined" && module.exports;
  const routeOwner = nodeModule ? require("./shared-shot-route.js") : root;
  const optionsOwner = nodeModule ? require("./shared-generation-options.js") : root;
  const readinessOwner = nodeModule ? require("./shared-shot-readiness.js") : root;
  const api = factory({ route: routeOwner, options: optionsOwner, readiness: readinessOwner });
  if (nodeModule) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function (OWNERS) {
  const ROUTE = OWNERS.route;
  const OPTIONS = OWNERS.options;
  const READINESS = OWNERS.readiness;

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }
  function text(value) {
    return String(value == null ? "" : value).trim();
  }
  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  /* Each owner asked for by name, so a missing one is a single loud failure at load
     rather than a quiet wrong answer at render time. The same shape
     public/shared-shot-readiness.js uses, and for the same reason. */
  function requireOwner(value, name, from) {
    if (typeof value !== "function" && !(value && typeof value === "object")) {
      throw new Error(`shared-shot-intent.js needs ${name} from ${from}; load that module first`);
    }
    return value;
  }
  const CINEBRAID_SHOT_ROUTES = requireOwner(ROUTE && ROUTE.CINEBRAID_SHOT_ROUTES, "CINEBRAID_SHOT_ROUTES", "shared-shot-route.js");
  const canonicalShotRoute = requireOwner(ROUTE && ROUTE.canonicalShotRoute, "canonicalShotRoute()", "shared-shot-route.js");
  const readShotRoute = requireOwner(ROUTE && ROUTE.readShotRoute, "readShotRoute()", "shared-shot-route.js");
  const shotRouteGenerationMode = requireOwner(ROUTE && ROUTE.shotRouteGenerationMode, "shotRouteGenerationMode()", "shared-shot-route.js");
  const modeLanguage = requireOwner(OPTIONS && OPTIONS.modeLanguage, "modeLanguage()", "shared-generation-options.js");
  const ANIMATE_METHOD_PROBES = requireOwner(READINESS && READINESS.ANIMATE_METHOD_PROBES, "ANIMATE_METHOD_PROBES", "shared-shot-readiness.js");

  const CINEBRAID_SHOT_INTENT_CONTRACT = "cinebraid.shot-intent/1";

  /* The three readings are 5a's, carried through rather than re-declared: a surface that
     switched on a fourth state would be inventing one. */
  const SHOT_INTENT_READINGS = deepFreeze([...list(ROUTE.CINEBRAID_SHOT_ROUTE_READINGS)]);

  /* Every generation mode that some route names, derived from 5a's own table. `hybrid`
     contributes nothing because it maps to "", which is exactly what makes it the union
     of the others rather than a member of them. */
  const SHOT_INTENT_ROUTE_MODES = deepFreeze(
    [...new Set(CINEBRAID_SHOT_ROUTES.map((token) => shotRouteGenerationMode(token)).filter(Boolean))],
  );

  /* mode -> the shipped probe for it. ANIMATE_METHOD_PROBES is public/shared-shot-
     readiness.js's derivation from resolveTaskModes(): each row is an INPUT SHAPE and
     the mode that shape produces. Indexing it is not restating it — change the resolver
     and this index changes with it. */
  const SHOT_INTENT_METHOD_PROBES = deepFreeze(Object.fromEntries(
    list(ANIMATE_METHOD_PROBES)
      .filter((row) => row && text(row.method))
      .map((row) => [text(row.method), { method: text(row.method), needs: list(row.needs).map(text) }]),
  ));

  /* ==========================================================================
     WHICH METHODS A DECLARED ROUTE ADMITS.

     `constrained: false` means NO intersection may be applied — the caller's answer
     stands untouched. It is returned for absence and for an unreadable token alike,
     because neither is a decision and this module manufactures none. */
  function shotIntentCompatibleModes(value) {
    const route = canonicalShotRoute(value);
    if (!route) return deepFreeze({ route: "", constrained: false, modes: [] });
    const mode = shotRouteGenerationMode(route);
    if (mode) return deepFreeze({ route, constrained: true, modes: [mode] });
    /* The route that names no single method: every method the other routes name. */
    return deepFreeze({ route, constrained: true, modes: [...SHOT_INTENT_ROUTE_MODES] });
  }

  /* ==========================================================================
     THE NARROWING. A FILTER, AND ONLY EVER A FILTER.

     `admissible` is whatever an existing CineBraid authority already answered —
     resolveTaskModes()'s list, a picker's dispatchable set, a readiness rollup's
     methods. This function is not allowed to know how it was produced and is not
     allowed to produce one of its own.

     `modes` is `admissible.filter(...)`, so `modes` is a subset of `admissible` by
     construction for every route, every reading and every input, including the empty
     list and a list full of tokens no route names. */
  function shotIntentEffectiveModes(value, admissible) {
    const supplied = list(admissible).map(text).filter(Boolean);
    const compatible = shotIntentCompatibleModes(value);
    if (!compatible.constrained) {
      return deepFreeze({ route: "", constrained: false, modes: [...supplied], removed: [], reason: "" });
    }
    const modes = supplied.filter((mode) => compatible.modes.includes(mode));
    const removed = supplied.filter((mode) => !compatible.modes.includes(mode));
    return deepFreeze({
      route: compatible.route,
      constrained: true,
      modes,
      removed,
      /* A TOKEN, never a sentence: the surface that shows this owns the wording, the
         way the stage model's `note` does. */
      reason: removed.length ? "narrowed-by-declared-intent" : "",
    });
  }

  /* Is one method admitted by a declared route — the single-mode form of the above, for
     a caller iterating rows rather than holding a list. Same rule, same filter. */
  function shotIntentAdmitsMode(value, mode) {
    const compatible = shotIntentCompatibleModes(value);
    if (!compatible.constrained) return true;
    return compatible.modes.includes(text(mode));
  }

  /* ==========================================================================
     WHAT A DECLARED ROUTE ASKS THE SHOT FOR, from the shipped probes.

     `known: false` is returned for an undeclared or unreadable route AND for a declared
     route whose methods the probe set does not cover — in every case the caller must
     treat the answer as "nothing established" and change nothing. */
  function shotIntentInputNeeds(value) {
    const compatible = shotIntentCompatibleModes(value);
    if (!compatible.constrained)
      return deepFreeze({ route: "", constrained: false, known: false, modes: [], needs: [] });
    const rows = compatible.modes.map((mode) => SHOT_INTENT_METHOD_PROBES[mode] || null);
    if (rows.some((row) => !row))
      return deepFreeze({ route: compatible.route, constrained: true, known: false, modes: [...compatible.modes], needs: [] });
    const needs = [...new Set(rows.flatMap((row) => [...row.needs]))];
    return deepFreeze({
      route: compatible.route,
      constrained: true,
      known: true,
      modes: [...compatible.modes],
      needs,
    });
  }

  /* ==========================================================================
     SHOULD THE FRAMES WORKFLOW BE PUT IN FRONT OF THIS FILMMAKER.

     PRESENTATION ONLY. Nothing here is a stage availability, a completion, a readiness
     state or a prerequisite; the shipped answers to all four stay exactly as they were
     and stay authoritative. `adapt: true` means one thing: the Frames workflow may open
     folded instead of open. The frames, their candidates, their approvals and their
     history are untouched and one click away, because a route is a statement about how
     a shot is delivered and never a reason to lose work.

     `needsVisualAnchor(mode)` is public/creation-studio.js's own
     guidedVideoModeNeedsApprovedStill — the predicate the shipped Motion panel gates
     itself on. It is required, not defaulted: a wrong guess here is a filmmaker sent to
     a locked panel. */
  function shotIntentFrameExposure(value, needsVisualAnchor) {
    const needs = shotIntentInputNeeds(value);
    const inert = (reason) => deepFreeze({
      route: needs.route,
      constrained: needs.constrained,
      known: false,
      required: true,
      adapt: false,
      modes: [...needs.modes],
      needs: [],
      anchored: [],
      reason,
    });
    if (!needs.constrained) return inert("no-declared-intent");
    if (!needs.known) return inert("no-shipped-probe-for-method");
    if (typeof needsVisualAnchor !== "function") return inert("no-motion-workspace-prerequisite-supplied");
    const anchored = needs.modes.filter((mode) => needsVisualAnchor(mode) === true);
    const required = needs.needs.length > 0 || anchored.length > 0;
    return deepFreeze({
      route: needs.route,
      constrained: true,
      known: true,
      required,
      adapt: !required,
      modes: [...needs.modes],
      needs: [...needs.needs],
      anchored,
      reason: required ? "input-required-by-shipped-authority" : "no-input-required-by-any-shipped-authority",
    });
  }

  /* ==========================================================================
     THE CHOICES A SURFACE OFFERS, in 5a's declaration order.

     `label` is the SHIPPED presentation language for the mode a route names —
     CINEBRAID_MODE_LANGUAGE, which exists so a screen can say "Animate between frames"
     while the contract keeps saying `flf`. `hybrid` names no mode, so it gets no label
     from here and the surface supplies its own word, the same way the surface supplies
     the word for the undeclared state. This module does not invent filmmaker language
     for a concept the repository has not named. */
  function shotIntentChoices() {
    return deepFreeze(CINEBRAID_SHOT_ROUTES.map((route) => {
      const mode = shotRouteGenerationMode(route);
      const needs = shotIntentInputNeeds(route);
      return {
        route,
        mode,
        label: mode ? text(modeLanguage(mode)) : "",
        modes: [...shotIntentCompatibleModes(route).modes],
        needs: [...needs.needs],
        needsKnown: needs.known,
      };
    }));
  }

  /* ==========================================================================
     WHAT ONE SHOT'S RECORD SAYS, enriched with the projection above.

     The reading is 5a's, verbatim: `absent`, `declared` or `unrecognised`, with the
     stored value and its reason kept so a surface can name a bad token rather than
     silently showing nothing. This adds no fourth state and repairs nothing. */
  function readShotIntent(shot) {
    const reading = readShotRoute(shot);
    const compatible = shotIntentCompatibleModes(reading.route);
    const needs = shotIntentInputNeeds(reading.route);
    const mode = shotRouteGenerationMode(reading.route);
    return deepFreeze({
      reading: reading.reading,
      route: reading.route,
      stored: reading.stored,
      reason: reading.reason,
      mode,
      label: mode ? text(modeLanguage(mode)) : "",
      constrained: compatible.constrained,
      modes: [...compatible.modes],
      needs: [...needs.needs],
      needsKnown: needs.known,
    });
  }

  return {
    CINEBRAID_SHOT_INTENT_CONTRACT,
    SHOT_INTENT_READINGS,
    SHOT_INTENT_ROUTE_MODES,
    SHOT_INTENT_METHOD_PROBES,
    shotIntentCompatibleModes,
    shotIntentEffectiveModes,
    shotIntentAdmitsMode,
    shotIntentInputNeeds,
    shotIntentFrameExposure,
    shotIntentChoices,
    readShotIntent,
  };
});

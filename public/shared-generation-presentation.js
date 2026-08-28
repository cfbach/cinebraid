/* Simple and Advanced, derived once and shared by every generation surface.
 *
 * public/shared-generation-capability.js answers "what is possible for this
 * configuration". public/shared-generation-options.js answers "what can I press, and
 * why not". This module answers the question those two leave open:
 *
 *     Given all that, what does the SCREEN show — and what may the submitted payload
 *     contain as a result?
 *
 * THE NORTH STAR. A filmmaker should be able to say "make this, about this good, for
 * about this much" without first learning fifteen provider controls. So Simple is the
 * default everywhere and shows the small set of facts that decide a paid dispatch:
 * which model, where it runs, what it is estimated to cost, how many candidates, and
 * what stops the run early. Advanced keeps every expert control that exists — it does
 * not get a bigger one — and is one disclosure away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THAT MAKES THIS SAFE, and the whole reason the control plan and the payload
 * come out of ONE function:
 *
 *     A CONTROL THAT IS NOT RENDERED CONTRIBUTES NOTHING TO THE PAYLOAD.
 *
 * Not "is rendered disabled". Not "is rendered with the model's default". Not present.
 * The generic-UI failure this prevents is specific and it is the one that costs money:
 * a settings grid draws CFG, steps and seed for every model because some model somewhere
 * supports them, greys out the ones this model does not, and then ships their default
 * values in the request anyway — so a render is dispatched carrying settings the
 * filmmaker was shown as unavailable and the provider either ignores or, worse, honours.
 * `renderedControls()` and `payloadKeys()` are the same derivation read two ways, so the
 * screen and the request cannot disagree about what was offered.
 *
 * The second half of the same rule, and the reason switching views is not free:
 * a value entered under Advanced does not survive a return to Simple merely because it
 * was typed. Simple's payload is Simple's plan, computed from the same capability, and
 * `restrictPayloadToPlan()` is the gate every submission passes through.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RECOMMENDATION IS NOT COMPUTED HERE — OR ANYWHERE.
 *
 * `generationRecommendation()` reads exactly one thing: the use-case guide's own
 * `decision`, an answer a human wrote into data/model-definitions.json with a reason
 * beside it. It receives no index, performs no sort, and matches by model id.
 *
 * It may NOT be derived from first item, last item, alphabetical order, capability-list
 * position or provider enumeration order. `resolveCapability()` alphabetises its
 * results and reading position in an alphabetical list as quality is how "the best
 * resolution" once became 768P. public/generation-picker.js's no-ranking rule is
 * unchanged and this module is bound by it.
 *
 * Today every shipped guide is `undecided-pending-evaluation`, so the honest answer on
 * every surface is that no recommendation is available. Simple says so and names the
 * model it is actually going to use as a COMPATIBLE CHOICE — a statement about fit,
 * never a compliment. When a guide is decided, the same code renders it with the
 * guide's own words and nothing else changes.
 *
 * Pure. No network, no filesystem, no clock, and it never edits its arguments.
 */

/* Simple first, and the order is the disclosure order rather than a preference. */
const CINEBRAID_GENERATION_VIEW_MODES = ["simple", "advanced"];

/* THE CONTROL VOCABULARY.
 *
 * Every control any CineBraid generation surface may draw, with the capability that has
 * to be TRUE for it to exist and the request keys it owns. Data, not code: nothing below
 * branches on a model name, and a model gains or loses a control only by what its
 * capability layers declare.
 *
 * `requires` names one of three shapes in a resolved capability:
 *   flag   a tri-state boolean from CINEBRAID_CAPABILITY_FLAGS — true only when every
 *          declaring layer agreed, which is what makes a provider a veto.
 *   list   an enum the intersection left non-empty. An EMPTY list is a real answer
 *          meaning "no legal value", so an empty list removes the control.
 *   range  a [lo, hi] pair that survived intersection.
 *
 * `tier` is which view the control belongs to, and it is a judgement about the
 * filmmaker rather than about the model: how many options, how good, how big and how
 * long are production decisions; seed, CFG, steps and reference weighting are machine
 * settings. Both tiers are equally capability-gated — Simple does not get to show an
 * impossible control just because it is friendly. */
const CINEBRAID_GENERATION_CONTROLS = [
  {
    key: "outputCount",
    label: "Number of options",
    tier: "simple",
    /* A model that cannot batch candidates renders exactly one thing per request, and
       a "how many" picker in front of it is a control over nothing. MiniMax H3 declares
       no candidateBatching and correctly has never had this picker; GPT Image 2 declares
       it and does. */
    requires: { flag: "candidateBatching" },
    payloadKeys: ["outputCount"],
  },
  {
    key: "quality",
    label: "Quality",
    tier: "simple",
    requires: { list: "qualityTiers" },
    payloadKeys: ["quality"],
  },
  {
    key: "resolution",
    label: "Size",
    /* Expert, deliberately. "How big is the file" is not one of the three questions the
       north star names, and the compiler already resolves a sensible size from the shot's
       own format and the saved default — so Simple gets a good answer without asking.
       A filmmaker who wants to overrule it opens Advanced and does. */
    tier: "advanced",
    requires: { list: "resolutions" },
    payloadKeys: ["resolution"],
  },
  {
    key: "durationSeconds",
    label: "Duration",
    tier: "simple",
    requires: { range: "durationSeconds" },
    payloadKeys: ["durationSeconds"],
  },
  {
    key: "aspectRatio",
    label: "Aspect ratio",
    /* A PRODUCTION DECISION, and the reason it is not filed beside size is specific
       rather than aesthetic.
     *
     * Hiding a control removes its value from the payload, so what a surface falls back
     * to when the key is absent decides whether hiding it is safe. Size is safe: the
     * server falls back to the SAVED default a filmmaker chose in Settings, which is the
     * same value Simple would have sent anyway. Aspect ratio is not: the fallback is a
     * literal "16:9", so a 2.39:1 production that omitted the key would be silently
     * reframed to something nobody chose — and it would be reframed on the paid request,
     * not on a preview.
     *
     * A control whose absence changes the output is not a machine setting. It stays in
     * Simple. */
    tier: "simple",
    requires: { list: "aspectRatios" },
    payloadKeys: ["aspectRatio"],
  },
  {
    key: "seed",
    label: "Seed",
    tier: "advanced",
    /* Neither shipped model supports one. MiniMax documents no seed on any H3 endpoint
       and neither does fal; GPT Image 2's model page and guide are both silent. So this
       control renders on nothing today — which is the point. It is declared here so the
       ABSENCE is derived from the declaration rather than from a screen that simply
       never learned the control exists, and so the day a model declares `seed: true` the
       control appears without anybody editing a dialog. */
    requires: { flag: "seed" },
    payloadKeys: ["seed"],
  },
  {
    key: "cfgScale",
    label: "Guidance (CFG)",
    tier: "advanced",
    requires: { flag: "cfgScale" },
    payloadKeys: ["cfgScale", "guidanceScale"],
  },
  {
    key: "steps",
    label: "Sampling steps",
    tier: "advanced",
    requires: { flag: "steps" },
    payloadKeys: ["steps"],
  },
  {
    key: "referenceStrength",
    label: "Reference strength",
    tier: "advanced",
    /* The capability layer already refuses a per-reference weight on a model without
       this flag — checkRequestAgainstCapability() blocks `references[n].controls.weight`
       with "This model cannot weight references". The control is gated on the same flag
       so the screen and that refusal cannot disagree. */
    requires: { flag: "referenceWeights" },
    payloadKeys: ["referenceStrength", "referenceWeights"],
  },
];

/* Every request key the vocabulary above claims. `restrictPayloadToPlan()` strips only
   from this set: a payload also carries a prompt, a shot id, a build id and a reference
   manifest, and a filter that could not tell those from a control would quietly delete
   the request. */
const CINEBRAID_CONTROL_PAYLOAD_KEYS = Array.from(
  new Set(CINEBRAID_GENERATION_CONTROLS.flatMap((control) => control.payloadKeys)),
).sort();

/* ---------------------------------------------------------------------------
   THE SURFACE TABLE. Which controls a paid surface owns, declared once and read on
   BOTH sides of the wire.

   Until now each dialog passed its own `only:` list and its own output-shaped flags to
   generationControlPlan(), and the server saw neither. That is what made the gate a
   browser convention: a replayed POST simply did not run the code that knew which keys
   the surface was allowed to send, and the money boundary had no way to find out. The
   lists below moved here unchanged - this table is a relocation, not a new policy - so
   the dialog and POST /api/generation/fal/jobs derive the same plan from the same
   declaration.

   `only` is the control vocabulary the surface owns. Narrowing is allowed and widening
   is not; generationControlPlan() already enforces that, and it still evaluates every
   control in CINEBRAID_GENERATION_CONTROLS for support, so a surface that forgot to
   declare one cannot ship it.

   `flags` are the capability facts that are properties of the OUTPUT rather than of the
   model, which is why capabilityFromPlan() has always required the caller to declare
   them: a still-image request returns a batch of candidates and a motion request returns
   one clip, and neither is inferable from a capability record.

   `capability` is present ONLY for the fixed fal image route - the one route that
   dispatches through the configured text/edit endpoints rather than through a compiled
   plan, and therefore the one route with no capability resolver to ask. It is the exact
   literal the fixed dialogs already carried inline; moving it here is what lets the
   server enforce the same answer instead of inventing one. The compiled routes leave it
   absent and the caller supplies the capability their own resolver produced. */
const CINEBRAID_GENERATION_REQUEST_SURFACES = {
  /* The compiled still-frame dialog, public/generation-picker.js. */
  "compiled-frame": {
    label: "Compiled frame",
    only: ["outputCount", "quality", "resolution", "seed", "cfgScale", "steps", "referenceStrength"],
    flags: { candidateBatching: true, referenceWeights: false },
  },
  /* Every dialog that dispatches through CineBraid's configured fal image path: the
     blocking frame and its revision, entity reference generation, candidate correction,
     coverage automation and the automation runner's frame steps. One route, one
     capability, one control vocabulary. */
  "fixed-image": {
    label: "Configured image path",
    only: ["outputCount", "quality", "resolution", "seed", "cfgScale", "steps", "referenceStrength"],
    flags: { candidateBatching: true, referenceWeights: false },
    capability: {
      qualityTiers: ["low", "medium", "high"],
      resolutions: ["1k", "2k", "4k"],
      durationSeconds: null,
      flags: { seed: false, candidateBatching: true, referenceWeights: false, cfgScale: false, steps: false },
    },
  },
  /* THE TWO UNATTENDED DISPATCHERS, and why their vocabulary is SHORTER rather than
     their view wider.
   *
   * Neither of these is a Simple/Advanced screen at the moment it dispatches. The
   * coverage modal draws a sheet resolution unconditionally, because a sheet whose
   * panels are too small to crop is not a sheet; the automation runner sends the
   * settings the planner already stored on the run, which the filmmaker approved as a
   * block when they authorised it. In both cases `resolution` is an input the route
   * asserts, not a control a view is hiding - the same standing `aspectRatio` already
   * has on the frame dialogs, which show the shot's ratio rather than offering a picker.
   *
   * So it is left OUT of the vocabulary, where restrictPayloadToPlan() treats it as part
   * of the request rather than as a control to strip. Declaring these as `fixed-image`
   * in Simple would have deleted a value the filmmaker really did choose and silently
   * substituted today's Settings default for it.
   *
   * What both still guarantee - and what neither had before, because neither ran the
   * gate at all - is that a machine setting this route cannot honour never travels. An
   * unsupported control is stripped whether or not the surface declares it. */
  "reference-automation": {
    label: "Coverage automation",
    only: ["outputCount", "quality"],
    flags: { candidateBatching: true, referenceWeights: false },
    capability: {
      qualityTiers: ["low", "medium", "high"],
      resolutions: ["1k", "2k", "4k"],
      durationSeconds: null,
      flags: { seed: false, candidateBatching: true, referenceWeights: false, cfgScale: false, steps: false },
    },
  },
  "automation-run": {
    label: "Automation run",
    only: ["outputCount", "quality"],
    flags: { candidateBatching: true, referenceWeights: false },
    capability: {
      qualityTiers: ["low", "medium", "high"],
      resolutions: ["1k", "2k", "4k"],
      durationSeconds: null,
      flags: { seed: false, candidateBatching: true, referenceWeights: false, cfgScale: false, steps: false },
    },
  },
  /* The MiniMax H3 motion dialog, public/fal-generation.js. One clip per request, so
     there is no candidate-count control to draw or to send. */
  "motion-h3": {
    label: "MiniMax H3 motion",
    only: ["durationSeconds", "resolution", "aspectRatio", "seed", "cfgScale", "steps", "referenceStrength"],
    flags: { candidateBatching: false, referenceWeights: false },
  },
};

/* THE IDS, NAMED. A dialog file referring to its own surface needs a name for it, and a
   top-level `const` in public/*.js is not available for that: every browser script shares
   one lexical scope, and more than one test harness re-evaluates a single file into a
   context that already holds it - which a lexical redeclaration turns into a SyntaxError
   that blanks the whole app. These ride on the exports object instead, which is assigned
   rather than declared and is therefore safe to evaluate twice. */
const CINEBRAID_REQUEST_SURFACE_IDS = {
  compiledFrame: "compiled-frame",
  fixedImage: "fixed-image",
  motionH3: "motion-h3",
  referenceAutomation: "reference-automation",
  automationRun: "automation-run",
};

function generationRequestSurface(id) {
  const key = presentationText(id);
  return Object.prototype.hasOwnProperty.call(CINEBRAID_GENERATION_REQUEST_SURFACES, key)
    ? CINEBRAID_GENERATION_REQUEST_SURFACES[key]
    : null;
}

/* THE PLAN A PAID REQUEST IS GOVERNED BY, built the same way wherever it is asked for.
 *
 * The surface decides the vocabulary and the output-shaped flags; the caller supplies the
 * capability its own resolver produced, or omits it where the surface declares a fixed
 * route capability of its own.
 *
 * AN UNKNOWN SURFACE RETURNS NULL rather than a permissive plan, and so does a known one
 * with no capability to judge by. A plan nobody declared must not be the plan that
 * decides what may be spent - the caller has to handle the absence, and at the money
 * boundary handling it means refusing. */
function generationRequestPlan({ surface, mode, capability, force } = {}) {
  const row = generationRequestSurface(surface);
  if (!row) return null;
  const declared = presentationRecord(capability) || presentationRecord(row.capability) || null;
  if (!declared) return null;
  /* The surface's output-shaped flags win over the capability's, because they describe
     the REQUEST and the capability describes the model. A resolved image capability that
     says nothing about candidate batching must not turn the picker off. */
  const flags = { ...(presentationRecord(declared.flags) || {}), ...(presentationRecord(row.flags) || {}) };
  return generationControlPlan({
    capability: { ...declared, flags },
    mode,
    only: row.only.slice(),
    force,
  });
}

/* WHAT A REQUEST SAYS ABOUT ITSELF, read in one place so the browser writes exactly the
   record the server reads.

   `declared` is the fact the money boundary actually needs, and it is deliberately not
   the same as `viewMode`. "This filmmaker was in Simple" and "nothing said" must not
   collapse: the safe reading of an absent declaration is Simple, and a caller that meant
   Advanced would silently lose its own controls to that reading. So the boundary refuses
   the absence rather than assuming either answer. */
const CINEBRAID_REQUEST_PLAN_KEY = "generationRequest";
function readGenerationRequestDeclaration(body) {
  const row = presentationRecord(presentationRecord(body)?.[CINEBRAID_REQUEST_PLAN_KEY]);
  const surface = presentationText(row?.surface);
  const rawMode = presentationText(row?.viewMode);
  return {
    declared: Boolean(row) && Boolean(surface) && CINEBRAID_GENERATION_VIEW_MODES.includes(rawMode),
    surface,
    viewMode: generationViewMode(rawMode),
    /* Carried through unchanged so a ledger row can record which option the screen was
       showing. It is evidence about the SCREEN and is never used to choose a model. */
    selectedOptionId: presentationText(row?.selectedOptionId),
    selectedModelId: presentationText(row?.selectedModelId),
  };
}

/* WHICH SURFACE COULD HONESTLY HAVE BUILT THIS REQUEST, decided from the request itself.
 *
 * A declaration is evidence about a screen, and evidence that chooses its own vocabulary
 * is not evidence: without this, a body could name whichever surface governs it least.
 * So the boundary asks this first and accepts a declaration only if it is in the answer.
 *
 * `canonical` is the surface a CineBraid dialog would declare for this request, named
 * rather than taken from a list position. `legal` is the full set, because two surfaces
 * genuinely can build the same request - an entity reference comes from both the
 * reference dialog and the coverage automation modal, and they offer different controls.
 *
 * Note what decides it: `purpose`, the `imagePlan` marker, the presence of an automation
 * run id and the coverage job type. All four are structural facts about the request, not
 * readings of its content - nothing here infers what a filmmaker meant from an arbitrary
 * payload, from free text or from a filename. */

/* THE STRUCTURAL PROOF OF A COVERAGE-AUTOMATION REQUEST.
 *
 * `reference-automation` owns a SHORTER control vocabulary than `fixed-image` - it leaves
 * resolution out, because a coverage sheet whose panels are too small to crop is not a
 * sheet, so its size is a route input rather than a control a view is hiding.
 *
 * That makes it the more permissive surface for one specific key, and an independent
 * reviewer reproduced the consequence: an ORDINARY entity-reference request that simply
 * named `reference-automation` kept a 4K size under Simple and dispatched. A declaration
 * is evidence about a screen, and evidence that can be chosen is not evidence.
 *
 * So the surface has to be PROVED. `coverageJobType` says which KIND of coverage work a
 * request is asking for, and the ordinary entity dialog never sends it — but it is a
 * field in the same body, so on its own it proves nothing. A second reviewer demonstrated
 * exactly that: an ordinary entity request with `coverageJobType: "sheet"` added kept its
 * 4K and dispatched.
 *
 * READING THE KIND IS THEREFORE ONLY HALF THE ANSWER, and this function only does that
 * half. The other half is corroboration the caller cannot put in the body, and it lives
 * at the boundary that can read persisted state: coverageRunCorroboration() in
 * fal-generation.js requires a live coverage run recorded on the entity itself. This
 * module is pure and has no project to read, so it reports the surface a request is
 * ASKING for and the boundary decides whether the request may have it. */
const CINEBRAID_COVERAGE_JOB_TYPES = ["sheet", "slot"];

function generationRequestSurfacesFor(body, purpose) {
  const row = presentationRecord(body) || {};
  const kind = presentationText(purpose) || presentationText(row.purpose) || "frame";
  if (kind === "motion-h3") return { canonical: "motion-h3", legal: ["motion-h3"] };
  /* AN AUTHORISED RUN IS ASKED FIRST, before the compiled marker, and the order is a
     judgement rather than a convenience: inside a run, quality and size are not live
     controls a view is hiding - they are the settings the filmmaker approved as a block
     when they authorised it. That stays true whether or not the step happens to compile
     through a plan, so the run surface owns the request either way. Reading it as
     `compiled-frame` would tier a value nobody is being offered and could substitute
     today's Settings default for what was actually approved. */
  if (presentationText(row.automationRunId)) return { canonical: "automation-run", legal: ["automation-run"] };
  if (row.imagePlan === true && ["blocking", "frame"].includes(kind))
    return { canonical: "compiled-frame", legal: ["compiled-frame"] };
  if (kind === "entity-reference") {
    /* Both surfaces stay legal for a request that PROVES it is coverage work, because a
       caller naming the longer vocabulary can only make itself stricter. A request that
       cannot prove it gets the one surface its contents support. */
    return CINEBRAID_COVERAGE_JOB_TYPES.includes(presentationText(row.coverageJobType))
      ? { canonical: "reference-automation", legal: ["fixed-image", "reference-automation"] }
      : { canonical: "fixed-image", legal: ["fixed-image"] };
  }
  return { canonical: "fixed-image", legal: ["fixed-image"] };
}

/* What a dialog attaches to its body. One writer, so a surface cannot invent a shape the
   reader above does not understand. */
function generationRequestDeclaration({ surface, viewMode, selectedOptionId, selectedModelId } = {}) {
  return {
    surface: presentationText(surface),
    viewMode: generationViewMode(viewMode),
    ...(presentationText(selectedOptionId) ? { selectedOptionId: presentationText(selectedOptionId) } : {}),
    ...(presentationText(selectedModelId) ? { selectedModelId: presentationText(selectedModelId) } : {}),
  };
}

function presentationRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function presentationText(value) {
  return String(value == null ? "" : value).trim();
}
function presentationList(value) {
  return Array.isArray(value) ? value : [];
}

function generationViewMode(value) {
  return CINEBRAID_GENERATION_VIEW_MODES.includes(presentationText(value))
    ? presentationText(value)
    : "simple";
}

/* ---------------------------------------------------------------------------
   A. IS THIS CONTROL POSSIBLE AT ALL?

   One capability, one answer, and the answer carries why. A screen that knows a control
   is impossible can say so in the Advanced panel instead of leaving a gap the filmmaker
   reads as a missing feature. */
function controlSupport(control, capability) {
  const resolved = presentationRecord(capability) || {};
  const requires = control.requires || {};

  if (requires.flag) {
    const flags = presentationRecord(resolved.flags) || {};
    /* Undeclared everywhere is false — a capability nothing claims is not available. The
       intersection already applied that rule; this only reads it. */
    return flags[requires.flag] === true
      ? { supported: true, reason: "" }
      : { supported: false, reason: `This model does not support ${control.label.toLowerCase()}.` };
  }

  if (requires.list) {
    const values = resolved[requires.list];
    /* null means NOBODY CONSTRAINED IT, which is not the same as "none". A surface that
       treated an unconstrained enum as an empty one would hide a control every layer was
       happy to allow. An empty ARRAY is the real "no legal value". */
    if (values == null) return { supported: true, reason: "", values: null };
    if (!Array.isArray(values) || !values.length)
      return { supported: false, reason: `No ${control.label.toLowerCase()} value is available for this model and provider.` };
    return { supported: true, reason: "", values: values.slice() };
  }

  if (requires.range) {
    const range = resolved[requires.range];
    if (range == null) return { supported: true, reason: "", range: null };
    if (!Array.isArray(range) || range.length !== 2 || !Number.isFinite(Number(range[0])) || !Number.isFinite(Number(range[1])))
      return { supported: false, reason: `No ${control.label.toLowerCase()} range is available for this model and provider.` };
    return { supported: true, reason: "", range: [Number(range[0]), Number(range[1])] };
  }

  return { supported: false, reason: "This control declares no capability." };
}

/* ---------------------------------------------------------------------------
   B. THE PLAN. What may be drawn, and — the same fact read differently — what may be
   submitted.

   `rendered` is the single derivation both halves come from. Change it and the screen
   and the payload change together, which is the only arrangement in which they cannot
   drift. */
function generationControlPlan({ capability, mode, only, force } = {}) {
  const view = generationViewMode(mode);
  const limit = Array.isArray(only) && only.length ? new Set(only.map(presentationText)) : null;
  /* THE ESCAPE HATCH FOR A BLOCKING REFUSAL, and the only thing that can pull an expert
     control into Simple.
   *
   * "Advanced must not hide an error or a paid-dispatch warning behind a closed panel"
   * has a second half nobody states: it must not hide the CONTROL THAT FIXES the error
   * either. A dialog that shows "MiniMax H3 cannot deliver 2.39:1", disables the paid
   * button, and keeps the aspect picker in a panel the filmmaker has not opened is a dead
   * end wearing a helpful sentence.
   *
   * A forced control is promoted, never invented: capability still decides whether it
   * exists at all, so this cannot render a control the model would refuse. */
  const forced = Array.isArray(force) && force.length ? new Set(force.map(presentationText)) : null;

  /* EVERY control is evaluated for support, including ones this surface does not own.
     `only` decides what may be DRAWN; it must never decide what may be SENT. A surface
     that simply forgot to declare `seed` would otherwise be free to ship one to a model
     that has none, which turns the whole invariant into a convention. */
  const controls = CINEBRAID_GENERATION_CONTROLS.map((control) => {
    const support = controlSupport(control, capability);
    /* A surface may narrow the vocabulary to the controls it actually owns — the frame
       dialog shows the shot's aspect ratio rather than offering a picker for it, and the
       automation planner never had one. It may not WIDEN it, and narrowing cannot make an
       unsupported control renderable. */
    const inVocabulary = !limit || limit.has(control.key);
    /* Advanced shows every supported control. Simple shows the production ones only — and
       hiding a control in Simple removes it from the payload exactly as an unsupported one
       is removed, which is what stops an Advanced value from riding back in through a view
       switch. */
    const inTier = control.tier === "simple" || view === "advanced" || Boolean(forced && forced.has(control.key));
    return {
      key: control.key,
      label: control.label,
      tier: control.tier,
      inVocabulary,
      supported: support.supported === true,
      rendered: inVocabulary && support.supported === true && inTier,
      reason: support.supported === true ? "" : support.reason,
      values: support.values === undefined ? null : support.values,
      range: support.range === undefined ? null : support.range,
      payloadKeys: control.payloadKeys.slice(),
    };
  }).filter((control) => control.inVocabulary || !control.supported);

  const rendered = controls.filter((control) => control.rendered);
  return {
    mode: view,
    controls,
    forced: forced ? Array.from(forced).sort() : [],
    rendered: rendered.map((control) => control.key),
    /* Declared separately from `rendered` so a test can prove the difference between
       "Simple is hiding this" and "this model cannot do this at all" — two states a
       single boolean would collapse, and the collapse is what produces a disabled
       control with a default value in it. */
    supported: controls.filter((control) => control.supported).map((control) => control.key),
    unsupported: controls.filter((control) => !control.supported).map((control) => control.key),
    payloadKeys: Array.from(new Set(rendered.flatMap((control) => control.payloadKeys))).sort(),
  };
}

/* THE GATE. Every generation submission passes its body through this.
 *
 * Only keys the control vocabulary claims are candidates for removal; everything else —
 * prompt, shotId, sourceBuildId, references, clientRequestId — is the request itself and
 * is passed through untouched. Returns a new object; the caller's body is not edited. */
function restrictPayloadToPlan(payload, plan) {
  const body = presentationRecord(payload) || {};
  const rows = presentationList(presentationRecord(plan)?.controls).filter(presentationRecord);
  const keysOf = (row) => presentationList(row.payloadKeys).map(presentationText);
  /* GOVERNED: a control this surface owns, or any control this configuration cannot do.
     The second half is what makes the guarantee hold across surfaces — an unsupported
     control is stripped whether or not the surface remembered to declare it. */
  const governed = new Set(rows.filter((row) => row.inVocabulary !== false || row.supported !== true).flatMap(keysOf));
  const allowed = new Set(rows.filter((row) => row.rendered === true).flatMap(keysOf));
  const out = {};
  const removed = [];
  for (const key of Object.keys(body)) {
    if (CINEBRAID_CONTROL_PAYLOAD_KEYS.includes(key) && governed.has(key) && !allowed.has(key)) { removed.push(key); continue; }
    out[key] = body[key];
  }
  /* Named rather than silent. A submission that quietly dropped a value the filmmaker
     set is the mirror image of one that quietly kept it, and a caller that wants to say
     "your seed was not sent because this model has none" needs the list. */
  return { payload: out, removed: removed.sort() };
}

/* ---------------------------------------------------------------------------
   C. RECOMMENDATION.

   The only recommendation derivation in CineBraid, and it derives nothing. It reads the
   use-case guide's decision and reports it, or reports that there is none.

   NOTE WHAT THIS FUNCTION IS NOT GIVEN: an index, a rank, a sort order, or permission to
   pick. `options` is searched by model id and is never indexed into. */
function generationRecommendation({ guide, options } = {}) {
  const rows = presentationList(options).filter(presentationRecord);
  const decision = presentationRecord(guide);
  const state = presentationText(decision?.decisionState || decision?.state);

  if (!decision || !state)
    return {
      available: false,
      reason: "no-guide",
      modelId: "",
      option: null,
      headline: "Recommendation unavailable",
      detail: "CineBraid has not evaluated which model is best for this job, so it is not telling you. Every option is offered on capability and availability alone.",
    };

  if (state !== "decided")
    return {
      available: false,
      reason: "undecided",
      modelId: "",
      option: null,
      headline: "Recommendation unavailable",
      detail: "CineBraid is still evaluating which model is best for this job. Until that decision is made it will not name one.",
    };

  const modelId = presentationText(decision.recommended);
  if (!modelId)
    return {
      available: false,
      reason: "no-recommended-model",
      modelId: "",
      option: null,
      headline: "Recommendation unavailable",
      detail: "This job's guide has been decided, but it names no recommended model.",
    };

  /* BY IDENTITY. Not by position, not by proximity, not by "the first ready one". */
  const option = rows.find((row) => presentationText(row.modelId) === modelId) || null;
  if (!option)
    return {
      available: false,
      reason: "recommended-not-offered",
      modelId,
      option: null,
      headline: "Recommendation unavailable here",
      detail: "The recommended model for this job is not among the options this shot can use.",
    };

  /* THE AUTHORITY'S OWN WORDS, under the name the authority actually uses.
   *
   * `note` is the field data/model-definitions.json writes a decision's reasoning into —
   * the same field public/media-inspector.js already renders for a recorded decision.
   * This once read `decision.why`, which no decision has ever carried: `why` belongs to
   * the SHORTLIST rows, so a genuinely decided guide fell straight through to a generic
   * sentence. Both names are accepted now, `note` first, because a reader that knows only
   * one of them is how the rationale got lost in the first place.
   *
   * And when a decision genuinely records no reasoning, that is said rather than papered
   * over: inventing a rationale for a real decision is the same fabrication as inventing
   * the decision. */
  const rationale = presentationText(decision.note) || presentationText(decision.why);
  return {
    available: true,
    reason: "",
    modelId,
    option,
    headline: `Recommended · ${presentationText(option.modelName) || modelId}`,
    detail: rationale
      || "Recorded as the recommendation for this job. No reasoning was recorded with the decision.",
    /* Separately readable, so a surface can tell "the authority explained itself" from
       "the authority decided and said nothing", without parsing a sentence. */
    hasRationale: Boolean(rationale),
  };
}

/* What Simple may call the model it is actually about to use, when no recommendation
   exists. Both words are deliberate and neither is a compliment: the model FITS, and it
   is the one SELECTED. Nothing here implies it won anything. */
function selectedModelStanding(option, recommendation) {
  const row = presentationRecord(option);
  /* No option at all is a real state and it is not "nothing will happen": the entity and
     blocking-revision dialogs dispatch through CineBraid's configured fal image path
     without resolving a picker. Saying "choose a model" there would ask for a choice the
     screen does not offer. */
  if (!row) return {
    label: "Model not resolved on this screen",
    detail: "This request goes to CineBraid's configured image path. The capability-aware picker resolves models on the frame and motion dialogs.",
  };
  const name = presentationText(row.modelName) || presentationText(row.modelId);
  if (presentationRecord(recommendation)?.available === true
    && presentationText(recommendation.modelId) === presentationText(row.modelId))
    return { label: `Recommended · ${name}`, detail: presentationText(recommendation.detail) };
  return {
    label: `Compatible choice · ${name}`,
    detail: "This model can do this job with the inputs this shot is carrying. CineBraid has not ranked it against the others.",
  };
}

/* ---------------------------------------------------------------------------
   D. WHERE IT RUNS. Two words that decide whether a render costs money, read from the
   surface rather than guessed from a model name. */
function routePlacement(option) {
  const row = presentationRecord(option);
  const kind = presentationText(row?.surfaceKind);
  const local = kind === "local" || presentationText(row?.where) === "Local";
  return {
    local,
    label: local ? "Runs on this machine" : "Runs at a provider",
    detail: local
      ? "Nothing leaves this machine and no provider account is charged."
      : `This request is sent to ${presentationText(row?.surfaceName) || "the provider"} and is billed by them.`,
  };
}

/* ---------------------------------------------------------------------------
   E. HOW LONG IT WILL TAKE.
 *
 * Unavailable, on every model and every route, and this function exists to say so in one
 * place rather than let each dialog invent its own number.
 *
 * CineBraid records no timing truth. Not in data/model-definitions.json, not in
 * data/provider-surfaces.json, not in a model pack, not in a capability layer — there is
 * no latency field, no typical-duration field and no observed-time field anywhere in the
 * system. A number here would therefore be fabricated, and a fabricated render time in
 * front of a paid button is exactly the kind of confident wrongness this slice exists to
 * remove. The moment a route records real timing, this reads it. */
function generationTimeEstimate() {
  return {
    available: false,
    seconds: null,
    headline: "Estimated time unavailable",
    detail: "CineBraid records no generation-time information for this model or provider, so it is not estimating one.",
  };
}

const GENERATION_PRESENTATION_EXPORTS = {
  CINEBRAID_GENERATION_VIEW_MODES,
  CINEBRAID_GENERATION_CONTROLS,
  CINEBRAID_CONTROL_PAYLOAD_KEYS,
  CINEBRAID_GENERATION_REQUEST_SURFACES,
  CINEBRAID_REQUEST_PLAN_KEY,
  CINEBRAID_REQUEST_SURFACE_IDS,
  CINEBRAID_COVERAGE_JOB_TYPES,
  controlSupport,
  generationControlPlan,
  generationRecommendation,
  generationRequestDeclaration,
  generationRequestPlan,
  generationRequestSurface,
  generationRequestSurfacesFor,
  generationTimeEstimate,
  generationViewMode,
  readGenerationRequestDeclaration,
  restrictPayloadToPlan,
  routePlacement,
  selectedModelStanding,
};

if (typeof window !== "undefined") Object.assign(window, GENERATION_PRESENTATION_EXPORTS);
if (typeof module !== "undefined" && module.exports) module.exports = GENERATION_PRESENTATION_EXPORTS;

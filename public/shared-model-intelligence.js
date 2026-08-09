/* Model and provider intelligence, shared by the browser and the Node server.
 *
 * public/shared-generation-capability.js answers "what is possible for THIS
 * configuration". This module answers the four questions that come before it:
 *
 *     what models exist?
 *     what does each one actually do, and who says so?
 *     which provider surface exposes it, and on what terms?
 *     which of them should CineBraid put in front of a filmmaker?
 *
 * The distinction that makes the whole thing work, and the one every "list of models"
 * gets wrong:
 *
 *     A MODEL FACT is a property of the weights. It follows the model everywhere.
 *     A SURFACE FACT is a property of one provider's offering of that model. It
 *     follows the provider, and is true of nothing else.
 *
 * MiniMax H3 is the worked example that forced the separation and now proves it.
 * MiniMax documents no seed and neither does fal, so CineBraid's H3-on-fal path is
 * seed-unsupported. Runware's H3 offering declares a seed. Collapsing those into one
 * "H3 supports seed" would put a reproducibility control on a screen that the path
 * actually dispatching cannot honour; collapsing them the other way would deny a
 * control a different provider really offers. So both are recorded, the divergence is
 * named, and the capability a request is checked against is always model ∩ surface.
 *
 * Nothing here ranks by inference. A recommendation order is an integer a human wrote
 * into the catalogue with a reason beside it — never a sort of a capability list.
 * `resolveCapability` alphabetises its results, and reading position in an alphabetical
 * list as quality is how "the best resolution" became 768P.
 *
 * Pure. No network, no filesystem, no clock. `asOf` arrives as an argument so the same
 * catalogue answers the same question in a test, in the browser and on the server.
 */

/* ---------------------------------------------------------------------------
   Vocabulary. All data; no code below branches on a model, family or vendor name. */

/* What CineBraid is prepared to say about a model TODAY. Deliberately about product
   readiness, not quality: a model can be excellent and still be `watchlist` because
   nothing establishes what it does. */
const CINEBRAID_CATALOGUE_STATUSES = [
  /* Show it, recommend it, keep it working. */
  "launch",
  /* Evidenced and wanted, but something is still missing — usually an execution path
     or a prompt policy. Visible to a reader of the catalogue, not offered as a default. */
  "next-up",
  /* Interesting and NOT established. No capability may be asserted for it beyond what
     a cited source supports, which is usually very little. */
  "watchlist",
  /* Researched and deliberately declined, with the reason recorded. Kept because the
     next person to ask "why not X?" deserves an answer rather than a silence. */
  "not-recommended",
  /* It was launched and no longer should be. `supersededBy` says what replaced it. */
  "deprecated",
];

/* How finished the MODEL is, from its own vendor's account. Orthogonal to catalogue
   status: a generally-available model can be on the watchlist because CineBraid has no
   evidence, and a preview model can be next-up because it is well documented. */
const CINEBRAID_MODEL_MATURITIES = ["generally-available", "preview", "announced", "superseded"];

/* What a filmmaker is trying to do. This is the vocabulary a future "best for…" screen
   reads; it exists now so the data can support one without a schema change.
   A tag is a JOB, never a quality claim — "hero-still" is a task, not a compliment. */
const CINEBRAID_USE_CASES = [
  /* image */
  "fast-image-iteration",   /* cheap, quick looks while the shot is still being found */
  /* A BLOCKING FRAME is its own job and must never be scored as a lesser hero still.
     Its purpose is to establish composition, framing, subject placement, staging, rough
     identity, current wardrobe state, location, key props and tone — fast, cheaply, and
     accurately enough to direct from and to hand to a video model as a starting frame.
     A gorgeous frame that put the two characters on the wrong sides has failed at it;
     a plain one that got the staging right has not. Ranking this category by final-image
     aesthetics is the specific mistake the tag exists to prevent. */
  "blocking-frame",
  "hero-still",             /* the frame that has to hold up */
  "image-editing",          /* change part of an existing frame and keep the rest */
  "local-image",            /* runs on the filmmaker's own machine */
  "text-in-image",          /* signage, titles, props that must read correctly */
  "style-reference",        /* carry a look across shots */
  /* video */
  "cinematic-ref2vid",      /* approved references become a directed shot */
  "prompt-adherent-video",  /* the shot does what the prompt said */
  "image-to-video",         /* an approved frame starts moving */
  "keyframe-video",         /* the shot passes through approved beats */
  "long-form-video",        /* one take longer than a normal clip */
  "audio-native-video",     /* picture and sound generated together */
  "local-video",            /* runs on the filmmaker's own machine */
  /* audio */
  "voice-generation",
  "music-generation",
  "sound-effects",
];

/* What KIND of thing a provider surface is. The three behave differently and a badge
   that cannot tell them apart eventually calls a billed remote render "Local". */
const CINEBRAID_SURFACE_KINDS = [
  /* Runs other people's models AND hosts open weights itself. Runware and fal are both
     of these; the model it serves is not theirs, so its schema is never model evidence. */
  "aggregator_host",
  /* The organisation that made the model, serving it directly. Its docs ARE model
     evidence for hosted behaviour — but still not for open-weight behaviour. */
  "vendor_api",
  /* Weights executed on hardware the operator controls. */
  "local_runtime",
];

/* What a surface is FOR, in CineBraid's terms. A surface can be both, and Runware is:
   its catalogue is a research source whether or not CineBraid ever dispatches to it. */
const CINEBRAID_SURFACE_ROLES = ["catalogue", "execution"];

/* How far CineBraid has actually got with a surface, or with one model on it.
   `available` is a promise that something can dispatch today, and is the only one of
   these a screen may present as usable. */
const CINEBRAID_OFFERING_STATES = ["catalogued", "adapter-ready", "available"];

/* How a divergence between a model fact and a surface fact was classified.
   `narrows` is ordinary and needs no defence. `declares-unestablished` is the one that
   matters: a provider offering a control the model's own sources do not document. */
const CINEBRAID_DIVERGENCE_KINDS = ["narrows", "widens", "declares-unestablished", "withholds"];

/* WHO established what a model does. The field exists because "Kling 3 Pro does
   image-to-video" and "MiniMax H3 renders 4 to 15 seconds" are not claims of the same
   quality: the first is currently known only because a provider's catalogue says so,
   the second because MiniMax's own model card does. Both are usable; only one may be
   put behind a launch recommendation.

     vendor           the organisation that made the model documents it
     vendor-partial   the vendor documents some of it; the rest comes from a provider
     provider-only    ONLY a provider's catalogue establishes it
     none             nothing CineBraid has read establishes it */
const CINEBRAID_EVIDENCE_STRENGTHS = ["vendor", "vendor-partial", "provider-only", "none"];

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return String(value == null ? "" : value).trim();
}
function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/* ---------------------------------------------------------------------------
   Capability layers.

   Both of these produce descriptors in the shape shared-generation-capability.js
   already consumes. That is the entire integration: there is no second limit system,
   and a node or recipe layer slots in beside them unchanged when one exists. */

/* The ModelCapability layer, from a catalogue definition.
   `surface` selects between local and hosted capability sets where a model has both —
   open weights are not a smaller version of a hosted API, they are a different set. */
function modelCapabilityLayer(definition, mode, surface = "api") {
  if (!isPlainRecord(definition)) return { modes: [] };
  const capabilities = isPlainRecord(definition.capabilities) ? definition.capabilities : {};
  const constraints = isPlainRecord(definition.constraints) ? definition.constraints : {};
  const modes = listOf(capabilities.modes).map(text);
  if (mode && !modes.includes(text(mode))) return { modes: [] };

  /* A per-surface override REPLACES the field it names and nothing else. A model that
     renders 2K only through a hosted module says so here rather than in a comment. */
  const surfaces = isPlainRecord(definition.surfaceCapabilities) ? definition.surfaceCapabilities : {};
  const face = isPlainRecord(surfaces[text(surface)]) ? surfaces[text(surface)] : {};

  const layer = {
    modes,
    referenceRoles: listOf(capabilities.referenceRoles).map(text),
    maxReferenceImages: capabilities.maxReferenceImages,
    maxReferenceVideos: capabilities.maxReferenceVideos,
    maxReferenceAudio: capabilities.maxReferenceAudio,
    flags: isPlainRecord(capabilities.flags) ? { ...capabilities.flags } : {},
  };
  for (const field of ["resolutions", "aspectRatios", "fps", "durationSeconds"])
    if (Array.isArray(constraints[field])) layer[field] = constraints[field];
  if (Number.isFinite(Number(constraints.maxPromptCharacters)))
    layer.maxPromptCharacters = Number(constraints.maxPromptCharacters);
  for (const field of Object.keys(face)) layer[field] = face[field];
  /* A model that accepts no references of a kind cannot be widened into accepting some
     by a backend that has a field for them — so the zero is carried, not dropped. */
  return layer;
}

/* The BackendCapability layer, from one provider's offering of one model. The generic
   form of what fal-h3-backend.js hand-writes for H3: that file stays exactly as it is,
   because a shipped, dispatching adapter is not something to refactor for symmetry. */
function surfaceCapabilityLayer(offering, mode) {
  if (!isPlainRecord(offering)) return { modes: [] };
  const key = text(mode);
  const modes = listOf(offering.modes).map(text);
  if (key && !modes.includes(key)) return { modes: [] };

  const constraints = isPlainRecord(offering.constraints) ? offering.constraints : {};
  const references = isPlainRecord(offering.references) ? offering.references : {};
  const layer = { modes: key ? [key] : modes, flags: isPlainRecord(offering.flags) ? { ...offering.flags } : {} };

  for (const field of ["resolutions", "fps", "durationSeconds"])
    if (Array.isArray(constraints[field])) layer[field] = constraints[field];
  /* Aspect ratio is per mode on every video surface examined so far, because the three
     schemas genuinely differ: an image-to-video endpoint has no ratio field at all and
     takes the ratio from the supplied frame. `null` for a mode means exactly that, and
     is NOT the same as an empty list. */
  const aspect = constraints.aspectRatios;
  if (Array.isArray(aspect)) layer.aspectRatios = aspect;
  else if (isPlainRecord(aspect) && key && Array.isArray(aspect[key])) layer.aspectRatios = aspect[key];
  if (Number.isFinite(Number(constraints.maxPromptCharacters)))
    layer.maxPromptCharacters = Number(constraints.maxPromptCharacters);

  for (const [field, source] of [
    ["maxReferenceImages", "maxImages"],
    ["maxReferenceVideos", "maxVideos"],
    ["maxReferenceAudio", "maxAudio"],
  ]) if (Number.isFinite(Number(references[source]))) layer[field] = Number(references[source]);

  return layer;
}

/* ---------------------------------------------------------------------------
   Divergence.

   The check that keeps the two fact families honest. It compares one offering against
   the model definition it claims to serve and returns every place they disagree, each
   classified and each naming the field — so a reviewer can see at a glance which
   provider is quietly stricter and which is quietly more generous than the model's own
   sources support.

   This is a REPORT, not a refusal. A provider is allowed to differ; what it is not
   allowed to do is differ invisibly. */
const COMPARABLE_MAXIMA = [
  ["maxReferenceImages", "references.maxImages"],
  ["maxReferenceVideos", "references.maxVideos"],
  ["maxReferenceAudio", "references.maxAudio"],
];

function divergencesForOffering(definition, offering) {
  const out = [];
  if (!isPlainRecord(definition) || !isPlainRecord(offering)) return out;
  const capabilities = isPlainRecord(definition.capabilities) ? definition.capabilities : {};
  const constraints = isPlainRecord(definition.constraints) ? definition.constraints : {};
  const references = isPlainRecord(offering.references) ? offering.references : {};
  const offeringConstraints = isPlainRecord(offering.constraints) ? offering.constraints : {};
  const record = (field, kind, modelValue, surfaceValue, note) => {
    out.push({ field, kind, modelValue, surfaceValue, note: text(note) });
  };

  /* Modes. A surface that serves fewer is narrowing; one that serves a mode the model
     does not claim is asserting a capability nothing establishes. */
  const modelModes = new Set(listOf(capabilities.modes).map(text));
  const surfaceModes = listOf(offering.modes).map(text);
  const extraModes = surfaceModes.filter((mode) => !modelModes.has(mode));
  const missingModes = [...modelModes].filter((mode) => !surfaceModes.includes(mode));
  if (extraModes.length)
    record("modes", "declares-unestablished", [...modelModes], surfaceModes,
      `This surface offers ${extraModes.join(", ")}, which the model's own sources do not establish.`);
  if (missingModes.length)
    record("modes", "withholds", [...modelModes], surfaceModes,
      `This surface does not serve ${missingModes.join(", ")}.`);

  /* Reference maxima. */
  for (const [field, path] of COMPARABLE_MAXIMA) {
    const modelValue = Number(capabilities[field]);
    const surfaceValue = Number(references[path.split(".")[1]]);
    if (!Number.isFinite(modelValue) || !Number.isFinite(surfaceValue)) continue;
    if (surfaceValue < modelValue) record(field, "narrows", modelValue, surfaceValue, "");
    else if (surfaceValue > modelValue)
      record(field, "widens", modelValue, surfaceValue,
        "This surface accepts more inputs than the model's own sources establish.");
  }

  /* Duration. A floor above the model's is the divergence that costs a filmmaker the
     shot they directed, so it is always reported even though it is only a narrowing. */
  const modelDuration = Array.isArray(constraints.durationSeconds) ? constraints.durationSeconds.map(Number) : null;
  const surfaceDuration = Array.isArray(offeringConstraints.durationSeconds)
    ? offeringConstraints.durationSeconds.map(Number) : null;
  if (modelDuration && surfaceDuration) {
    if (surfaceDuration[0] > modelDuration[0] || surfaceDuration[1] < modelDuration[1])
      record("durationSeconds", "narrows", modelDuration, surfaceDuration, "");
    if (surfaceDuration[0] < modelDuration[0] || surfaceDuration[1] > modelDuration[1])
      record("durationSeconds", "widens", modelDuration, surfaceDuration,
        "This surface offers durations the model's own sources do not establish.");
  }

  /* Resolutions. */
  const modelResolutions = Array.isArray(constraints.resolutions) ? constraints.resolutions.map(text) : null;
  const surfaceResolutions = Array.isArray(offeringConstraints.resolutions)
    ? offeringConstraints.resolutions.map(text) : null;
  if (modelResolutions && surfaceResolutions) {
    const extra = surfaceResolutions.filter((value) => !modelResolutions.includes(value));
    const missing = modelResolutions.filter((value) => !surfaceResolutions.includes(value));
    if (extra.length)
      record("resolutions", "declares-unestablished", modelResolutions, surfaceResolutions,
        `This surface offers ${extra.join(", ")}, which the model's own sources do not establish.`);
    if (missing.length)
      record("resolutions", "withholds", modelResolutions, surfaceResolutions,
        `This surface does not offer ${missing.join(", ")}.`);
  }

  /* Flags. The H3 seed case lives here. A flag the model records as false and the
     surface records as true is the most consequential divergence in the catalogue,
     because it decides whether a control is drawn. */
  const modelFlags = isPlainRecord(capabilities.flags) ? capabilities.flags : {};
  const surfaceFlags = isPlainRecord(offering.flags) ? offering.flags : {};
  for (const flag of Object.keys(surfaceFlags).sort()) {
    if (surfaceFlags[flag] !== true) continue;
    if (modelFlags[flag] === true) continue;
    record(`flags.${flag}`, "declares-unestablished", modelFlags[flag] === false ? false : null, true,
      `This surface exposes ${flag}; the model's own sources do not establish it.`);
  }
  for (const flag of Object.keys(modelFlags).sort()) {
    if (modelFlags[flag] !== true) continue;
    if (!(flag in surfaceFlags)) continue;
    if (surfaceFlags[flag] === false)
      record(`flags.${flag}`, "withholds", true, false, `This surface does not expose ${flag}.`);
  }

  return out;
}

/* ---------------------------------------------------------------------------
   Recommendation.

   Ordering is DATA. `catalogue.priority` is an integer a human wrote with a reason in
   `recommendation`, and the only inference this function performs is a tie-break on
   modelId so the same catalogue always produces the same order.

   It deliberately cannot promote a model by reading its capabilities. A longer
   resolution list is not a better model, and the moment a recommender learns to sort
   on one, adding a resolution to a definition silently changes what CineBraid advises. */
function recommendForUseCase(models, useCase, options = {}) {
  const wanted = text(useCase);
  const statuses = listOf(options.statuses).map(text);
  const allowed = statuses.length ? statuses : ["launch", "next-up"];
  return listOf(models)
    .filter(isPlainRecord)
    .filter((model) => listOf(model.useCases).map(text).includes(wanted))
    .filter((model) => allowed.includes(text(model.catalogue?.status)))
    .filter((model) => (options.requireOpenWeights ? model.openWeights === true : true))
    .filter((model) => (options.requireLocal ? localCapable(model) : true))
    .sort((a, b) => {
      const priorityA = Number.isFinite(Number(a.catalogue?.priority)) ? Number(a.catalogue.priority) : Number.MAX_SAFE_INTEGER;
      const priorityB = Number.isFinite(Number(b.catalogue?.priority)) ? Number(b.catalogue.priority) : Number.MAX_SAFE_INTEGER;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0;
    });
}

/* Open weights and a local path are different questions, and the second one is the
   one a filmmaker is actually asking. LTX-2 publishes weights AND a runtime; Wan 2.7
   is widely described as open and its vendor's own model hub stops at 2.2. */
function localCapable(model) {
  if (!isPlainRecord(model)) return false;
  return listOf(model.execution).some((entry) => isPlainRecord(entry) && entry.local === true);
}

/* ---------------------------------------------------------------------------
   Use-case guides.

   A per-model `useCases` tag says "this model can do that job". A guide answers the
   question a screen actually asks: for THIS job, what should we put in front of a
   filmmaker, what is the free local option, and what is the expensive one worth paying
   for.

   Every slot may be null, and null means UNDECIDED — not "none exists". A guide whose
   decision state is `undecided-pending-evaluation` carries a `shortlist` per slot
   instead: the candidates that could fill it and why, so the answer can be rendered
   honestly ("pending evaluation; shortlist: A, B") rather than invented. Filling a slot
   is a decision that needs evidence, and the evaluation record says what evidence. */
const CINEBRAID_GUIDE_STATES = ["undecided-pending-evaluation", "decided", "superseded"];
const CINEBRAID_GUIDE_SLOTS = ["recommended", "localOption", "premiumAlternative"];

function useCaseGuide(guides, useCase) {
  return listOf(guides).filter(isPlainRecord).find((guide) => text(guide.useCase) === text(useCase)) || null;
}

/* Every model a guide names, in one list, so a caller can check them against the
   catalogue without knowing the guide's shape. */
function guideModelIds(guide) {
  if (!isPlainRecord(guide)) return [];
  const decision = isPlainRecord(guide.decision) ? guide.decision : {};
  const out = [];
  for (const slot of CINEBRAID_GUIDE_SLOTS) {
    if (isNonEmpty(decision[slot])) out.push(text(decision[slot]));
    for (const row of listOf(decision.shortlist && decision.shortlist[slot]))
      if (isPlainRecord(row) && isNonEmpty(row.modelId)) out.push(text(row.modelId));
  }
  for (const row of listOf(guide.candidates))
    if (isPlainRecord(row) && isNonEmpty(row.modelId)) out.push(text(row.modelId));
  return Array.from(new Set(out));
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

/* ---------------------------------------------------------------------------
   Churn.

   The catalogue goes stale by default: models are released and superseded faster than
   anyone re-reads a JSON file. So staleness is computed rather than remembered, from a
   date the caller supplies — no clock in here, for the same reason the compiler has
   none. A model whose evidence has not been re-checked inside the window is reported,
   not hidden and not deleted. */
function reviewQueue(models, options = {}) {
  const asOf = Date.parse(text(options.asOf));
  const maxAgeDays = Number.isFinite(Number(options.maxAgeDays)) ? Number(options.maxAgeDays) : 90;
  if (!Number.isFinite(asOf)) return [];
  const out = [];
  for (const model of listOf(models).filter(isPlainRecord)) {
    const reviewed = Date.parse(text(model.catalogue?.reviewedOn));
    if (!Number.isFinite(reviewed)) {
      out.push({ id: text(model.id), reason: "never-reviewed", ageDays: null });
      continue;
    }
    const ageDays = Math.floor((asOf - reviewed) / 86400000);
    if (ageDays > maxAgeDays) out.push({ id: text(model.id), reason: "stale", ageDays });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const EXPORTS = {
  CINEBRAID_CATALOGUE_STATUSES,
  CINEBRAID_MODEL_MATURITIES,
  CINEBRAID_USE_CASES,
  CINEBRAID_SURFACE_KINDS,
  CINEBRAID_SURFACE_ROLES,
  CINEBRAID_OFFERING_STATES,
  CINEBRAID_DIVERGENCE_KINDS,
  CINEBRAID_EVIDENCE_STRENGTHS,
  CINEBRAID_GUIDE_STATES,
  CINEBRAID_GUIDE_SLOTS,
  divergencesForOffering,
  guideModelIds,
  useCaseGuide,
  localCapable,
  modelCapabilityLayer,
  recommendForUseCase,
  reviewQueue,
  surfaceCapabilityLayer,
};

if (typeof window !== "undefined") Object.assign(window, EXPORTS);
if (typeof module !== "undefined" && module.exports) module.exports = EXPORTS;

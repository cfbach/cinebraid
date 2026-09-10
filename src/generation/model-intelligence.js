/* The model and provider catalogue, loaded and joined.
 *
 * Three files, three jobs, and the whole point is that they stay three:
 *
 *   data/model-definitions.json   what a MODEL is and can do, and what CineBraid is
 *                                 prepared to say about it today.
 *   data/provider-surfaces.json   what a PROVIDER offers, on what terms, and which
 *                                 models it exposes.
 *   data/model-profiles.json      how to WRITE for a model. Untouched here; the prompt
 *                                 registry has its own job and its own consumers.
 *
 * This module joins the first two and answers the questions a product needs answered:
 * which models exist, which surface can run one, what the effective capability is when
 * a model meets a provider, where the two disagree, what to recommend for a given job,
 * and what has gone stale.
 *
 * It is a READER. It performs no HTTP, mints no identity, dispatches nothing and edits
 * nothing it loads. Adding a model is a data change; adding a provider is a data
 * change; neither is a conditional in here, and there is no switch on a model, family
 * or vendor name anywhere in this file.
 *
 * SCOPE. Nothing in the shipped product reads this at runtime yet. It exists so that
 * the capability layer, the compiler and a later screen have one place to ask, instead
 * of each growing its own list. The execution paths that exist today — fal for H3 and
 * for the image models — are untouched.
 */

const fs = require("fs");
const path = require("path");

const { resolveCapability } = require("../../public/shared-generation-capability");
const {
  CINEBRAID_CATALOGUE_STATUSES,
  CINEBRAID_OFFERING_STATES,
  CINEBRAID_GUIDE_SLOTS,
  divergencesForOffering,
  guideModelIds,
  localCapable,
  modelCapabilityLayer,
  recommendForUseCase,
  reviewQueue,
  surfaceCapabilityLayer,
  useCaseGuide,
} = require("../../public/shared-model-intelligence");

const DATA_ROOT = path.join(path.resolve(__dirname, "../.."), "data");
const DEFINITIONS_PATH = path.join(DATA_ROOT, "model-definitions.json");
const SURFACES_PATH = path.join(DATA_ROOT, "provider-surfaces.json");

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return String(value == null ? "" : value).trim();
}
function listOf(value) {
  return Array.isArray(value) ? value : [];
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/* ---------------------------------------------------------------------------
   Construction.

   Injectable, because a test that has to write two JSON files into data/ to exercise a
   query is a test that will eventually be run against real data by accident. The
   default reads the shipped catalogue. */
function createModelIntelligence(input = {}) {
  const definitionsFile = isRecord(input.definitions) ? input.definitions : { models: [] };
  const surfacesFile = isRecord(input.surfaces) ? input.surfaces : { surfaces: [] };

  const models = listOf(definitionsFile.models).filter(isRecord);
  const surfaces = listOf(surfacesFile.surfaces).filter(isRecord);
  /* Use-case guides answer the question a screen asks — "for THIS job, what do we put in
     front of a filmmaker" — which a per-model tag cannot. They live beside the models
     because they are recommendation metadata about the same catalogue, and they are
     allowed to be UNDECIDED: an empty slot means nobody has established an answer, not
     that no answer exists. */
  const guides = listOf(definitionsFile.useCaseGuides).filter(isRecord);

  const modelsById = new Map(models.map((model) => [text(model.id), model]));
  const surfacesById = new Map(surfaces.map((surface) => [text(surface.surfaceId), surface]));

  /* modelId -> [{ surface, offering }]. Built once; the join is the expensive part and
     it is the same answer every time. Ordered by surfaceId so two readers agree. */
  const offeringsByModel = new Map();
  for (const surface of [...surfaces].sort((a, b) => (text(a.surfaceId) < text(b.surfaceId) ? -1 : 1)))
    for (const offering of listOf(surface.offerings).filter(isRecord)) {
      const key = text(offering.modelId);
      if (!offeringsByModel.has(key)) offeringsByModel.set(key, []);
      offeringsByModel.get(key).push({ surface, offering });
    }

  function getModel(modelId) {
    return modelsById.get(text(modelId)) || null;
  }
  function getSurface(surfaceId) {
    return surfacesById.get(text(surfaceId)) || null;
  }
  function offeringsForModel(modelId) {
    return [...(offeringsByModel.get(text(modelId)) || [])];
  }

  /* Filtering, not sorting. The catalogue's own order is preserved so that a reader who
     wants a recommendation asks for one explicitly and gets an explicitly ordered
     answer, rather than inheriting whatever order a filter happened to leave behind. */
  function listModels(filter = {}) {
    const wantStatus = listOf(filter.statuses).map(text);
    const wantModality = text(filter.modality);
    const wantUseCase = text(filter.useCase);
    const wantVendor = text(filter.vendor);
    return models.filter((model) => {
      if (wantStatus.length && !wantStatus.includes(text(model.catalogue?.status))) return false;
      if (wantModality && !listOf(model.outputModalities).map(text).includes(wantModality)) return false;
      if (wantUseCase && !listOf(model.useCases).map(text).includes(wantUseCase)) return false;
      if (wantVendor && text(model.vendor) !== wantVendor) return false;
      if (filter.requireOpenWeights && model.openWeights !== true) return false;
      if (filter.requireLocal && !localCapable(model)) return false;
      return true;
    });
  }

  /* Which surfaces could actually run this model today, as opposed to merely listing
     it. The distinction is the difference between a catalogue and a promise. */
  function dispatchableSurfaces(modelId) {
    return offeringsForModel(modelId).filter(({ surface, offering }) =>
      text(offering.state) === "available"
      && listOf(surface.roles).map(text).includes("execution"));
  }

  /* The join that matters: model ∩ surface, through the resolver that already exists.
     No second limit system, and a node or recipe layer passes straight through. */
  function effectiveCapability(request = {}) {
    const modelId = text(request.modelId);
    const surfaceId = text(request.surfaceId);
    const mode = text(request.mode);
    const model = getModel(modelId);
    if (!model)
      return { ok: false, capability: null, reason: "unknown-model", modelId, surfaceId, mode };
    const found = offeringsForModel(modelId).find(({ surface }) => text(surface.surfaceId) === surfaceId);
    if (surfaceId && !found)
      return { ok: false, capability: null, reason: "model-not-offered-here", modelId, surfaceId, mode };

    const surfaceKind = found ? text(found.surface.executionSurface) || "api" : text(request.surface) || "api";
    const layers = { model: modelCapabilityLayer(model, mode, surfaceKind) };
    if (found) layers.backend = surfaceCapabilityLayer(found.offering, mode);
    for (const [name, layer] of Object.entries(isRecord(request.extraLayers) ? request.extraLayers : {}))
      layers[name] = layer;

    const capability = resolveCapability(layers);
    return {
      ok: capability.ok,
      capability,
      modelId,
      surfaceId,
      mode,
      /* Carried so a refusal can say WHICH layer narrowed what without the caller
         re-deriving it, and so a screen never has to guess whether a limit is the
         model's or the provider's. */
      divergences: found ? divergencesForOffering(model, found.offering) : [],
    };
  }

  /* Every place a provider's account of a model differs from the model's own sources,
     across the whole catalogue. This is the report that keeps the two fact families
     from quietly merging; a suite asserts that each entry is deliberate. */
  function allDivergences() {
    const out = [];
    for (const model of models)
      for (const { surface, offering } of offeringsForModel(model.id))
        for (const divergence of divergencesForOffering(model, offering))
          out.push({ modelId: text(model.id), surfaceId: text(surface.surfaceId), ...divergence });
    return out;
  }

  /* A catalogue entry that names a model nobody defines, or a definition that claims a
     surface which does not exist, is a broken join rather than a missing feature —
     and it is exactly the failure a hand-maintained catalogue produces first. */
  function integrityProblems() {
    const problems = [];
    for (const surface of surfaces)
      for (const offering of listOf(surface.offerings).filter(isRecord)) {
        if (!modelsById.has(text(offering.modelId)))
          problems.push({
            code: "offering-without-model",
            surfaceId: text(surface.surfaceId),
            modelId: text(offering.modelId),
            message: `${text(surface.surfaceId)} offers ${text(offering.modelId)}, which is not in the model catalogue.`,
          });
      }
    /* A guide that names a model nobody defines, or recommends one that does not carry
       the tag, is the same broken join in a more damaging place: it is the thing a
       screen would show. */
    for (const guide of guides) {
      const useCase = text(guide.useCase);
      for (const modelId of guideModelIds(guide)) {
        const model = modelsById.get(modelId);
        if (!model) {
          problems.push({
            code: "guide-without-model",
            useCase,
            modelId,
            message: `The ${useCase} guide names ${modelId}, which is not in the model catalogue.`,
          });
          continue;
        }
        if (!listOf(model.useCases).map(text).includes(useCase))
          problems.push({
            code: "guide-model-missing-tag",
            useCase,
            modelId,
            message: `The ${useCase} guide names ${modelId}, which does not carry the ${useCase} use case.`,
          });
      }
      /* A filled slot is a recommendation. It may only exist where the decision has
         actually been taken — otherwise a shortlist entry becomes an answer by drift. */
      const decision = isRecord(guide.decision) ? guide.decision : {};
      for (const slot of CINEBRAID_GUIDE_SLOTS) {
        if (!isNonEmptyString(decision[slot])) continue;
        if (text(decision.state) !== "decided")
          problems.push({
            code: "guide-decided-without-evidence",
            useCase,
            modelId: text(decision[slot]),
            message: `The ${useCase} guide fills ${slot} while its decision state is "${decision.state}". A recommendation needs the decision to have been taken.`,
          });
      }
    }
    for (const model of models)
      for (const entry of listOf(model.execution).filter(isRecord)) {
        if (!surfacesById.has(text(entry.surfaceId)))
          problems.push({
            code: "execution-without-surface",
            modelId: text(model.id),
            surfaceId: text(entry.surfaceId),
            message: `${text(model.id)} names execution surface ${text(entry.surfaceId)}, which is not in the provider catalogue.`,
          });
        /* An "available" execution entry is a promise that a filmmaker can press
           Generate. It may only be made where the surface itself says the same. */
        if (text(entry.state) !== "available") continue;
        const offering = offeringsForModel(model.id)
          .find(({ surface }) => text(surface.surfaceId) === text(entry.surfaceId));
        if (!offering || text(offering.offering.state) !== "available")
          problems.push({
            code: "available-without-offering",
            modelId: text(model.id),
            surfaceId: text(entry.surfaceId),
            message: `${text(model.id)} claims it can dispatch through ${text(entry.surfaceId)}, but that surface does not offer it as available.`,
          });
      }
    return problems;
  }

  return {
    models,
    surfaces,
    guides,
    getModel,
    getSurface,
    getUseCaseGuide: (useCase) => useCaseGuide(guides, useCase),
    listModels,
    offeringsForModel,
    dispatchableSurfaces,
    effectiveCapability,
    allDivergences,
    integrityProblems,
    recommend: (useCase, options) => recommendForUseCase(models, useCase, options),
    reviewQueue: (options) => reviewQueue(models, options),
  };
}

/* The shipped catalogue. Read once per process: these files do not change while the
   server runs, and re-reading them per request would put a filesystem call on a path
   that has no business touching a disk. */
let cached = null;
function loadModelIntelligence(options = {}) {
  if (cached && !options.reload) return cached;
  const definitions = JSON.parse(fs.readFileSync(DEFINITIONS_PATH, "utf8"));
  const surfaces = JSON.parse(fs.readFileSync(SURFACES_PATH, "utf8"));
  cached = createModelIntelligence({ definitions, surfaces });
  return cached;
}

module.exports = {
  CINEBRAID_CATALOGUE_STATUSES,
  CINEBRAID_OFFERING_STATES,
  DEFINITIONS_PATH,
  SURFACES_PATH,
  createModelIntelligence,
  loadModelIntelligence,
};

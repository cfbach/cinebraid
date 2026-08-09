/* CineBraid model and provider intelligence.
 *
 * The C2a question is not "can CineBraid list models". It is whether the catalogue can
 * be trusted: whether a model fact and a provider fact stay apart, whether a provider
 * can widen a model, whether a recommendation is something a human wrote or something a
 * sort invented, and whether the whole thing can be kept current.
 *
 * Every assertion here is about one of those. Structural shape is checked only where
 * getting it wrong would silently produce a wrong answer.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  createModelIntelligence,
  loadModelIntelligence,
  SURFACES_PATH,
} = require("../model-intelligence");
const {
  CINEBRAID_SURFACE_KINDS,
  CINEBRAID_SURFACE_ROLES,
  CINEBRAID_OFFERING_STATES,
  CINEBRAID_USE_CASES,
  divergencesForOffering,
  localCapable,
  modelCapabilityLayer,
  recommendForUseCase,
  reviewQueue,
  surfaceCapabilityLayer,
} = require("../public/shared-model-intelligence");
const { CINEBRAID_GENERATION_MODES } = require("../public/shared-generation-capability");
const { MODE_OUTPUT_TYPES } = require("../generation-contracts");

const catalogue = loadModelIntelligence();
const surfacesFile = JSON.parse(fs.readFileSync(SURFACES_PATH, "utf8"));

/* ---- 1. the provider catalogue's own shape ---- */
assert.strictEqual(surfacesFile.schemaVersion, 1, "provider-surfaces schemaVersion must be 1");
const surfaceIds = catalogue.surfaces.map((surface) => surface.surfaceId);
assert.strictEqual(new Set(surfaceIds).size, surfaceIds.length, "surfaceIds must be unique");
for (const surface of catalogue.surfaces) {
  assert(CINEBRAID_SURFACE_KINDS.includes(surface.kind), `${surface.surfaceId}: unknown surface kind "${surface.kind}"`);
  assert(Array.isArray(surface.roles) && surface.roles.length, `${surface.surfaceId}: a surface must say what it is for`);
  for (const role of surface.roles)
    assert(CINEBRAID_SURFACE_ROLES.includes(role), `${surface.surfaceId}: unknown role "${role}"`);
  assert(CINEBRAID_OFFERING_STATES.includes(surface.state), `${surface.surfaceId}: unknown state "${surface.state}"`);
  assert(typeof surface.backendId === "string" && surface.backendId.trim(),
    `${surface.surfaceId}: an execution surface ties to the contract vocabulary through backendId`);
  for (const offering of surface.offerings || []) {
    assert(CINEBRAID_OFFERING_STATES.includes(offering.state),
      `${surface.surfaceId}/${offering.modelId}: unknown offering state`);
    for (const mode of offering.modes || [])
      assert(CINEBRAID_GENERATION_MODES.includes(mode),
        `${surface.surfaceId}/${offering.modelId}: unknown mode "${mode}"`);
    /* A provider's own handle is recorded and never used as identity. */
    assert(offering.providerModelId !== offering.modelId
      || surface.identifierScheme.format === "model-name",
      `${surface.surfaceId}/${offering.modelId}: a provider handle must not be CineBraid identity`);
  }
}

/* ---- 2. the join holds ---- */
assert.deepStrictEqual(catalogue.integrityProblems(), [],
  "every offering names a real model and every execution entry names a real surface");

/* An `available` execution claim is a promise a filmmaker can press Generate. It may
   only exist where the surface says the same, and integrityProblems proves it — so
   check the claim is actually being made somewhere, or the check proves nothing. */
const dispatchable = catalogue.models.filter((model) => catalogue.dispatchableSurfaces(model.id).length);
assert(dispatchable.length >= 3, "the catalogue must contain models that can actually dispatch today");
for (const model of dispatchable)
  assert(catalogue.dispatchableSurfaces(model.id).every(({ surface }) => surface.roles.includes("execution")),
    `${model.id}: a dispatchable surface must have the execution role`);

/* ---- 3. MODEL FACTS AND PROVIDER FACTS STAY APART ----
   The property the whole phase exists to establish, checked on the case that forced it.

   Runware documents a seed on its MiniMax H3 offering. MiniMax documents none and
   neither does fal. All three are recorded; the divergence is reported; and the
   effective capability a request is checked against still refuses a seed, because a
   provider may narrow a model and may never widen one. */
const h3Runware = catalogue.effectiveCapability({ modelId: "minimax-h3/fl2va", surfaceId: "runware", mode: "i2v" });
const seedDivergence = h3Runware.divergences.find((row) => row.field === "flags.seed");
assert(seedDivergence, "the Runware H3 seed divergence must be reported, not smoothed over");
assert.strictEqual(seedDivergence.kind, "declares-unestablished",
  "a provider offering a control the model's sources do not document is `declares-unestablished`");
assert.strictEqual(h3Runware.capability.flags.seed, false,
  "A PROVIDER MUST NOT WIDEN A MODEL. Runware declaring a seed cannot make H3 seed-capable.");

const h3Fal = catalogue.effectiveCapability({ modelId: "minimax-h3/fl2va", surfaceId: "fal-queue", mode: "i2v" });
assert.strictEqual(h3Fal.capability.flags.seed, false, "H3 on fal has no seed at either layer");
assert.deepStrictEqual(h3Fal.capability.durationSeconds, [5, 15],
  "the model's 4s floor and fal's 5s floor intersect to 5; neither number is rewritten");
assert(catalogue.getModel("minimax-h3/fl2va").constraints.durationSeconds[0] === 4,
  "the MODEL keeps its own 4s floor, so a backend without that restriction gets it back for free");
assert(!h3Fal.capability.resolutions.includes("4K"),
  "fal offers 4K and no MiniMax source establishes it, so the intersection withholds it");
assert(h3Fal.divergences.some((row) => row.field === "resolutions" && row.kind === "declares-unestablished"),
  "the 4K divergence must be reported rather than silently dropped");

/* Every divergence in the catalogue is one of the classified kinds, and every
   `declares-unestablished` is a provider claiming something a model's sources do not.
   A silent one would be the failure this report exists to prevent. */
const divergences = catalogue.allDivergences();
assert(divergences.length >= 8, "a real multi-provider catalogue disagrees with itself in several places");
for (const row of divergences) {
  assert(["narrows", "widens", "declares-unestablished", "withholds"].includes(row.kind),
    `${row.modelId}/${row.surfaceId}: unclassified divergence kind "${row.kind}"`);
  assert(typeof row.field === "string" && row.field, "a divergence must name its field");
}

/* ---- 4. the vocabulary gap, recorded deliberately ----
   Black Forest Labs calls its resolutions hd and fhd; Runware calls the same tiers 720P
   and 1080P. CineBraid does NOT translate between them, because no vendor publishes the
   mapping and inventing one would be a capability claim. The consequence is that the
   intersection is empty and the configuration is BLOCKED — which is the correct, safe
   outcome and is asserted here so it stays deliberate rather than becoming a mystery. */
const fluxRunware = catalogue.effectiveCapability({ modelId: "flux-3-video/pro", surfaceId: "runware", mode: "t2v" });
assert.strictEqual(fluxRunware.ok, false, "disjoint resolution vocabularies must block, not guess");
assert(fluxRunware.capability.blockedBy.some((row) => row.field === "resolutions" && row.reason === "empty-intersection"),
  "the block must name the field and the reason");
const fluxVendor = catalogue.effectiveCapability({ modelId: "flux-3-video/pro", surfaceId: "bfl-api", mode: "t2v" });
assert.strictEqual(fluxVendor.ok, true, "the same model resolves cleanly on the surface whose vocabulary it shares");

/* ---- 5. recommendation is data, not inference ---- */
for (const useCase of CINEBRAID_USE_CASES) {
  const ranked = catalogue.recommend(useCase);
  const priorities = ranked.map((model) => model.catalogue.priority);
  assert.deepStrictEqual(priorities, [...priorities].sort((a, b) => a - b),
    `${useCase}: recommendation order must follow the priority a human wrote`);
  for (const model of ranked)
    assert(["launch", "next-up"].includes(model.catalogue.status),
      `${useCase}: ${model.id} is ${model.catalogue.status} and must not be recommended by default`);
}
/* The use cases a filmmaker will reach for first must actually resolve to something. */
for (const useCase of ["image-editing", "fast-image-iteration", "hero-still", "cinematic-ref2vid", "image-to-video", "local-video", "voice-generation", "music-generation"])
  assert(catalogue.recommend(useCase).length > 0, `${useCase}: no model is recommended for a core job`);

/* Ordering must not be derivable from capability. Two models whose priorities are equal
   fall back to id, never to "which one lists more resolutions" — a longer capability
   list is not a better model, and a recommender that learns to sort on one changes its
   advice every time a definition gains a field. */
const tied = recommendForUseCase([
  { id: "b/one", catalogue: { status: "launch", priority: 5 }, useCases: ["hero-still"], constraints: { resolutions: ["1K", "2K", "4K", "8K"] } },
  { id: "a/two", catalogue: { status: "launch", priority: 5 }, useCases: ["hero-still"], constraints: { resolutions: ["1K"] } },
], "hero-still");
assert.deepStrictEqual(tied.map((model) => model.id), ["a/two", "b/one"],
  "a tie breaks on id, not on how much capability a model happens to list");

/* ---- 6. local means a path exists, not that weights were published ----
   The single largest correction this research pass produced. Wan 2.7 is widely
   described as the open local video model and its vendor's own model organisation
   publishes nothing past 2.2, so it has no local execution entry and cannot be
   recommended for local video. LTX-2.3 can. */
const wan = catalogue.getModel("wan/2.7");
assert(wan, "the Wan 2.7 correction must stay in the catalogue where it can be read");
assert.strictEqual(wan.openWeights, null,
  "openWeights is null, not true: nothing establishes it, and null is not the same claim as false");
assert.strictEqual(localCapable(wan), false, "a model with no local execution entry is not a local option");
assert(catalogue.recommend("local-video").every((model) => model.id !== "wan/2.7"),
  "Wan 2.7 must not be recommended for local video");
const localVideo = catalogue.recommend("local-video");
assert(localVideo.length > 0 && localVideo.every((model) => localCapable(model)),
  "every local-video recommendation must have a local path");
assert(catalogue.listModels({ requireLocal: true }).every((model) => localCapable(model)),
  "requireLocal must filter on the path, not on the licence");

/* ---- 7. Runware is first-class and CineBraid does not depend on it ---- */
const runware = catalogue.getSurface("runware");
assert(runware, "Runware must be in the provider catalogue");
assert(runware.roles.includes("catalogue") && runware.roles.includes("execution"),
  "Runware is BOTH a research catalogue and an execution surface, and the record must say so");
assert.strictEqual(runware.kind, "aggregator_host",
  "Runware aggregates third-party models AND hosts open weights; a one-sided label loses one of those");
assert(runware.offerings.length >= 10, "Runware must be modelled seriously, not as a footnote");
assert.strictEqual(runware.state, "catalogued",
  "CineBraid cannot dispatch to Runware and the record must not imply it can");
/* Nothing CineBraid can actually run may depend on Runware alone. */
for (const model of dispatchable)
  assert(catalogue.dispatchableSurfaces(model.id).some(({ surface }) => surface.surfaceId !== "runware"),
    `${model.id}: a dispatchable model must not depend on Runware alone`);
/* And no launch recommendation may rest on a provider-only evidence base. */
for (const model of catalogue.listModels({ statuses: ["launch"] }))
  assert(["vendor", "vendor-partial"].includes(model.evidenceStrength),
    `${model.id}: launch status requires vendor evidence`);
assert(catalogue.models.some((model) => model.evidenceStrength === "provider-only"),
  "the provider-only grade must actually be in use, or the rule above proves nothing");

/* ---- 7b. the blocking-frame category ----
   A blocking frame is its own job, not a cheaper hero still, and the catalogue has to be
   able to say so without ranking it by output beauty. */
const blocking = catalogue.getUseCaseGuide("blocking-frame");
assert(blocking, "blocking-frame must have a use-case guide, not just a tag");
assert(blocking.optimiseFor.includes("speed") && blocking.optimiseFor.includes("cost")
  && blocking.optimiseFor.includes("composition-and-staging-accuracy")
  && blocking.optimiseFor.includes("reference-adherence"),
  "the guide must record what this job optimises for");
assert(blocking.deprioritise.some((row) => /aesthetic/i.test(row)),
  "the guide must record that final-image aesthetics are deliberately NOT the ranking criterion");

/* No winner is hardcoded. Every slot is empty and every slot carries a shortlist, so a
   screen can be honest about a decision nobody has taken yet. */
assert.strictEqual(blocking.decision.state, "undecided-pending-evaluation");
for (const slot of ["recommended", "localOption", "premiumAlternative"]) {
  assert.strictEqual(blocking.decision[slot], null, `${slot} must not be decided before evidence`);
  assert(Array.isArray(blocking.decision.shortlist[slot]) && blocking.decision.shortlist[slot].length >= 2,
    `${slot} must carry a shortlist of at least two candidates with reasons`);
  for (const row of blocking.decision.shortlist[slot])
    assert(catalogue.getModel(row.modelId) && row.why.trim(),
      `${slot}: ${row.modelId} must exist in the catalogue and say why it is a candidate`);
}
/* The integrity check refuses a filled slot while the decision is undecided, so the
   emptiness above cannot drift into a recommendation by someone editing one field. */
assert(!catalogue.integrityProblems().some((row) => row.code === "guide-decided-without-evidence"));

/* All eleven distinctions are answered for every candidate, and `null` means not
   established rather than no. */
const DISTINCTIONS = blocking.distinctions;
assert.strictEqual(DISTINCTIONS.length, 11, "eleven distinctions were asked for");
assert(blocking.candidates.length >= 8, "the named comparison set must actually be compared");
for (const candidate of blocking.candidates) {
  assert(catalogue.getModel(candidate.modelId), `${candidate.modelId} is not in the catalogue`);
  assert(["local", "api"].includes(candidate.surface),
    `${candidate.modelId}: a blocking candidate must say which SURFACE it was assessed on`);
  for (const key of DISTINCTIONS)
    assert(key in candidate, `${candidate.modelId}/${candidate.surface}: ${key} is unanswered`);
  assert(candidate.note.trim(), `${candidate.modelId}: a comparison row must explain itself`);
}

/* THE RULE THE BRIEF ASKED FOR EXPLICITLY: a hosted capability must never be assumed to
   exist in an open checkpoint. Krea is the case — the hosted endpoint takes ten weighted
   references and the published weights are text-to-image only. */
const kreaLocal = blocking.candidates.find((row) => row.modelId === "krea-2/turbo" && row.surface === "local");
const kreaHosted = blocking.candidates.find((row) => row.modelId === "krea-2/large" && row.surface === "api");
assert(kreaLocal && kreaHosted, "both Krea surfaces must be compared separately");
assert.strictEqual(kreaLocal.acceptsApprovedReferences, false,
  "the OPEN Krea checkpoint is text-to-image only and must not inherit the hosted endpoint's references");
assert.strictEqual(kreaLocal.maxReferenceImages, 0);
assert.strictEqual(kreaHosted.maxReferenceImages, 10, "the hosted endpoint's weighted references stay on the hosted row");
assert.strictEqual(catalogue.getModel("krea-2/turbo").capabilities.maxReferenceImages, 0,
  "and the model definition agrees: no reference input on this checkpoint");
assert.strictEqual(catalogue.getModel("krea-2/turbo").openWeights, true,
  "Krea 2 Turbo's open weights ARE established, from the vendor's own model card and inference repository");
assert.strictEqual(localCapable(catalogue.getModel("krea-2/turbo")), true);

/* A local candidate that cannot take a reference must have SOME answer to production
   identity, or it is not a serious candidate for a job whose whole point is identity. */
for (const candidate of blocking.candidates.filter((row) => row.surface === "local")) {
  assert.strictEqual(candidate.acceptsApprovedReferences, false,
    `${candidate.modelId}: both open blocking checkpoints are text-to-image; if that changed the row must be re-researched`);
  assert.strictEqual(candidate.localIdentityViaLoraOrFinetune, true,
    `${candidate.modelId}: a local blocking candidate needs a documented route to production identity`);
}

/* Every model the guide names carries the tag, and every tagged model is real. */
assert(!catalogue.integrityProblems().some((row) => row.code === "guide-model-missing-tag"));
const tagged = catalogue.listModels({ useCase: "blocking-frame" });
assert(tagged.length >= 8, "the blocking category must span the field, not one model");
assert(tagged.some((model) => localCapable(model)), "a local blocking option must exist");
assert(tagged.some((model) => catalogue.dispatchableSurfaces(model.id).length),
  "at least one blocking candidate must be dispatchable today");

/* The evaluation is designed and NOT run, and says so rather than implying a result. */
assert.strictEqual(blocking.evaluation.state, "designed-not-run");
assert(/NONE APPROVED/.test(blocking.evaluation.budget), "no paid benchmark may be implied");
assert(fs.existsSync(path.join(ROOT, blocking.evaluation.fixtures)), "the fixture design must exist");
const fixtures = fs.readFileSync(path.join(ROOT, blocking.evaluation.fixtures), "utf8");
for (const fixture of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"])
  assert(new RegExp(`^\\| ${fixture} \\|`, "m").test(fixtures), `fixture ${fixture} is missing from the design`);
for (const dimension of ["composition accuracy", "identity adherence", "location adherence", "prop adherence",
  "instruction adherence", "iteration stability", "latency", "cost", "suitability as a video starting frame"])
  assert(fixtures.includes(dimension), `the scoring scheme is missing "${dimension}"`);
assert(blocking.openQuestions.length >= 3, "the guide must record what the evaluation is for");

/* ---- 8. the catalogue is genuinely multi-modal ---- */
const modalities = {};
for (const model of catalogue.models)
  for (const modality of model.outputModalities || []) modalities[modality] = (modalities[modality] || 0) + 1;
for (const modality of ["image", "video", "audio"])
  assert(modalities[modality] >= 3, `only ${modalities[modality] || 0} ${modality} models — the catalogue is still lopsided`);
for (const mode of ["tts", "music", "sfx"]) {
  assert(CINEBRAID_GENERATION_MODES.includes(mode), `${mode} must be in the shared mode vocabulary`);
  assert.strictEqual(MODE_OUTPUT_TYPES[mode], "audio", `${mode} must produce audio`);
}

/* ---- 9. churn ----
   Staleness is computed from a supplied date, never from a clock. A catalogue that
   cannot tell you what it has stopped checking will quietly become wrong. */
assert.deepStrictEqual(catalogue.reviewQueue({ asOf: "2026-08-20", maxAgeDays: 90 }), [],
  "a freshly reviewed catalogue has an empty review queue");
const stale = catalogue.reviewQueue({ asOf: "2027-06-01", maxAgeDays: 90 });
assert.strictEqual(stale.length, catalogue.models.length, "every entry goes stale eventually and the queue says so");
assert(stale.every((row) => row.reason === "stale" && row.ageDays > 90), "a stale row names its age");
assert.deepStrictEqual(reviewQueue([{ id: "x/y", catalogue: {} }], { asOf: "2026-08-08" }),
  [{ id: "x/y", reason: "never-reviewed", ageDays: null }],
  "an entry that was never reviewed is reported, not treated as fresh");
assert.deepStrictEqual(reviewQueue(catalogue.models, {}), [],
  "with no date supplied the queue is empty rather than invented");

/* ---- 10. purity ----
   The intelligence layer is loaded by the browser. It may not read a disk, reach a
   network or ask what time it is, and the check is structural rather than a promise. */
const sharedSource = fs.readFileSync(path.join(ROOT, "public", "shared-model-intelligence.js"), "utf8");
for (const forbidden of ["require(", "fetch(", "XMLHttpRequest", "Math.random", "Date.now", "new Date()"])
  assert(!sharedSource.includes(forbidden),
    `public/shared-model-intelligence.js must not contain ${forbidden}`);
/* Date.parse on a SUPPLIED string is the one date operation allowed, and it is not a clock. */
assert(sharedSource.includes("Date.parse"), "reviewQueue parses the date it is given");

/* No branching on a model, family or vendor name anywhere in the intelligence layer.
   That is what turns adding a model into an application-wide edit, and it is the rule
   the whole architecture is built to keep. */
const intelligenceSource = fs.readFileSync(path.join(ROOT, "model-intelligence.js"), "utf8");
for (const [file, source] of [["shared-model-intelligence.js", sharedSource], ["model-intelligence.js", intelligenceSource]])
  for (const name of ["minimax", "runware", "seedance", "kling", "gpt-image", "z-image", "krea", "flux", "openai", "bytedance", "elevenlabs"]) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert(!new RegExp(`["'\`][^"'\`]*${name}`, "i").test(code),
      `${file}: "${name}" appears in code rather than in data or a comment`);
  }

/* MediaAsset stays dormant. */
for (const [file, source] of [["shared-model-intelligence.js", sharedSource], ["model-intelligence.js", intelligenceSource]])
  for (const forbidden of ["media-asset", "mediaAsset", "media-hash"])
    assert(!source.includes(forbidden), `${file} must not touch the MediaAsset ledger`);

/* ---- 11. the pure resolvers, exercised without the shipped catalogue ----
   Injectable construction exists so a test never has to write into data/. */
const sandbox = createModelIntelligence({
  definitions: {
    models: [{
      id: "demo/one",
      family: "demo",
      variant: "one",
      outputModalities: ["video"],
      capabilities: { modes: ["t2v"], referenceRoles: ["base"], maxReferenceImages: 4, maxReferenceVideos: 0, maxReferenceAudio: 0, flags: { seed: true, nativeAudio: true } },
      constraints: { durationSeconds: [2, 20], resolutions: ["720P", "1080P"] },
      execution: [{ surfaceId: "demo-surface", state: "preparation", local: false }],
      catalogue: { status: "next-up", priority: 1 },
      useCases: [],
    }],
  },
  surfaces: {
    surfaces: [{
      surfaceId: "demo-surface",
      kind: "vendor_api",
      roles: ["execution"],
      state: "catalogued",
      backendId: "demo",
      executionSurface: "api",
      offerings: [{
        modelId: "demo/one",
        providerModelId: "demo@1",
        state: "catalogued",
        modes: ["t2v"],
        constraints: { durationSeconds: [5, 10], resolutions: ["720P"], aspectRatios: { t2v: ["16:9"] } },
        references: { maxImages: 2 },
        flags: { seed: false },
      }],
    }],
  },
});
const demo = sandbox.effectiveCapability({ modelId: "demo/one", surfaceId: "demo-surface", mode: "t2v" });
assert.deepStrictEqual(demo.capability.durationSeconds, [5, 10], "the tighter range wins");
assert.deepStrictEqual(demo.capability.resolutions, ["720P"], "the intersection withholds what the surface does not serve");
assert.strictEqual(demo.capability.maxReferenceImages, 2, "the smaller maximum wins");
assert.strictEqual(demo.capability.flags.seed, false, "a surface that declares a flag false vetoes it");
assert.deepStrictEqual(demo.capability.aspectRatios, ["16:9"], "a per-mode aspect list is read for the mode asked for");
/* A layer that does not mention a flag has NO OPINION about it and does not veto —
   the rule shared-generation-capability.js established in Phase 1 and this layer
   inherits rather than reinvents. Only a layer that declares false is a veto, which is
   why the seed above is refused and the audio here is not. */
assert.strictEqual(demo.capability.flags.nativeAudio, true,
  "a surface silent about a flag imposes no constraint on it");
assert.strictEqual("nativeAudio" in sandbox.surfaces[0].offerings[0].flags, false,
  "the fixture's silence is what makes the assertion above meaningful");
assert.deepStrictEqual(
  sandbox.effectiveCapability({ modelId: "demo/one", surfaceId: "nowhere", mode: "t2v" }).reason,
  "model-not-offered-here",
  "asking about a surface that does not offer the model is refused, not guessed",
);
assert.strictEqual(sandbox.effectiveCapability({ modelId: "nothing/here" }).reason, "unknown-model");

/* A mode the model does not claim collapses the model layer, so no configuration can
   conjure it from a backend that happens to have an endpoint. */
assert.deepStrictEqual(modelCapabilityLayer(sandbox.models[0], "r2v"), { modes: [] });
assert.deepStrictEqual(surfaceCapabilityLayer(sandbox.surfaces[0].offerings[0], "r2v"), { modes: [] });
assert.deepStrictEqual(divergencesForOffering(null, null), [], "a missing side reports nothing rather than throwing");

console.log(
  `Model intelligence passed: ${catalogue.models.length} models across ${catalogue.surfaces.length} provider surfaces, `
  + `${divergences.length} model-versus-provider divergences all classified, a provider cannot widen a model, `
  + "Runware is modelled as both catalogue and execution without anything depending on it alone, "
  + "recommendation order is written rather than inferred, local means a path exists, and staleness is computed from a supplied date.",
);

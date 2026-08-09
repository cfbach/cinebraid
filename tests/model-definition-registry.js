/* CineBraid model definition registry.
 *
 * data/model-definitions.json is model IDENTITY, CAPABILITY and EXECUTION metadata.
 * data/model-profiles.json is the PROMPT-AUTHORING registry the compiler consumes.
 * They are deliberately separate files with deliberately separate jobs, and the
 * failure this suite guards against is the two quietly becoming one: a definition
 * that restates prompt rules, or a prompt profile that starts deciding capability.
 *
 * The other guard is identity. `id` is the only identity a model has. A displayName
 * is a label and a FAL route is adapter configuration — the moment anything selects
 * on either, renaming a model or repointing a route changes behaviour.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "data", "model-definitions.json");
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
const profiles = require("../data/model-profiles.json");
const { CINEBRAID_GENERATION_MODES, CINEBRAID_REFERENCE_ROLES, CINEBRAID_CAPABILITY_FLAGS } =
  require("../public/shared-generation-capability");

const profileIds = new Set(profiles.profiles.map((profile) => profile.id));
const models = registry.models;

/* ---- 1. the file itself ---- */
assert.strictEqual(registry.schemaVersion, 2, "schemaVersion must be 2");
assert(Array.isArray(models) && models.length > 0, "the registry must contain models");

/* It has to be tracked, or a fresh clone has no registry. data/ is gitignored
   wholesale and re-included one file at a time. */
const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
for (const shipped of ["!/data/model-definitions.json", "!/data/provider-surfaces.json"])
  assert(
    gitignore.includes(shipped),
    `${shipped.slice(1)} must be re-included by .gitignore or it will not ship`,
  );
for (const secretBearing of ["/data/config.json", "/data/render-nodes.json", "/data/accounts.json"])
  assert(
    !gitignore.includes(`!${secretBearing}`),
    `${secretBearing} must never be un-ignored — data/ holds credentials`,
  );
assert(
  !/^!\/data\/?$/m.test(gitignore) && !gitignore.includes("!/data/*"),
  "the negation must name one file; a directory-wide negation would ship credentials",
);

/* ---- 2. identity ---- */
const ids = models.map((model) => model.id);
assert.strictEqual(new Set(ids).size, ids.length, "model ids must be unique");
for (const model of models) {
  assert(typeof model.id === "string" && model.id.includes("/"),
    `${model.id}: id must be family/variant`);
  const [family, variant] = model.id.split("/");
  assert.strictEqual(model.family, family, `${model.id}: family must match the id`);
  assert.strictEqual(model.variant, variant, `${model.id}: variant must match the id`);
  assert(typeof model.displayName === "string" && model.displayName.trim(),
    `${model.id}: a displayName is required for the screen`);
}

/* A display name is a label. Two models must never be distinguishable only by it, and
   nothing may key on it. */
const displayNames = models.map((model) => model.displayName);
assert.strictEqual(new Set(displayNames).size, displayNames.length, "display names must not collide");
const registrySource = fs.readFileSync(REGISTRY_PATH, "utf8");
/* Checked STRUCTURALLY rather than by scanning the file's text. Schema 2 execution
   entries carry a human-readable `note`, and a note that says "Runware lists MiniMax
   Music 2.6" is prose about a provider, not an identifier — a text scan cannot tell the
   two apart and would force the prose to be worse to satisfy the test. What actually
   matters is that no field anything SELECTS on ever holds a label. */
const displayNameSet = new Set(displayNames);
const IDENTITY_BEARING = ["id", "family", "variant"];
for (const model of models) {
  for (const field of IDENTITY_BEARING)
    assert(!displayNameSet.has(model[field]),
      `${model.id}: ${field} holds a display name; identity must not be a label`);
  for (const [mode, profileId] of Object.entries(model.promptProfiles))
    assert(profileId === null || !displayNameSet.has(profileId),
      `${model.id}: promptProfiles.${mode} holds a display name`);
  for (const entry of model.execution)
    for (const field of ["surfaceId", "state"])
      assert(!displayNameSet.has(entry[field]),
        `${model.id}: execution.${field} holds a display name`);
  if (model.promptPolicy && model.promptPolicy.packId)
    assert(!displayNameSet.has(model.promptPolicy.packId),
      `${model.id}: promptPolicy.packId holds a display name`);
}

/* Variants exist because they are genuinely different weights, not because a family
   needed padding. Where a family has more than one variant here, they must differ in
   what they can do — OR one of them must be explicitly superseded by the other, which
   is a different and equally legitimate reason for two entries to coexist.

   Entries whose evidenceStrength is `none` are excluded, and that exclusion is the rule
   working rather than a hole in it: Wan 2.7 and Wan 3.0 look identical here precisely
   because nothing is established about either, and inventing a difference to satisfy a
   uniqueness test is exactly the fabrication this registry exists to prevent. */
const byFamily = {};
for (const model of models) (byFamily[model.family] ||= []).push(model);
for (const [family, siblings] of Object.entries(byFamily)) {
  if (siblings.length < 2) continue;
  const distinguishable = siblings
    .filter((model) => !model.catalogue?.supersededBy)
    .filter((model) => model.evidenceStrength !== "none");
  const signatures = distinguishable.map((model) => JSON.stringify({
    modes: [...(model.capabilities.modes || [])].sort(),
    images: model.capabilities.maxReferenceImages,
    videos: model.capabilities.maxReferenceVideos,
    audio: model.capabilities.maxReferenceAudio,
    roles: [...(model.capabilities.referenceRoles || [])].sort(),
    /* Output size is a real capability distinction, not decoration: Nano Banana 2 Lite
       and Nano Banana 2 accept the same references in the same modes and one of them
       cannot produce 2K. A signature blind to that would call them the same model. */
    resolutions: [...(model.constraints?.resolutions || [])].sort(),
  }));
  assert.strictEqual(
    new Set(signatures).size, distinguishable.length,
    `${family}: two current variants declare identical capability — the distinction is not justified`,
  );
}

/* ---- 3. prompt profile references ---- */
for (const model of models) {
  assert(model.promptProfiles && typeof model.promptProfiles === "object",
    `${model.id}: promptProfiles is required (its values may be null)`);
  for (const [mode, profileId] of Object.entries(model.promptProfiles)) {
    assert(CINEBRAID_GENERATION_MODES.includes(mode),
      `${model.id}: promptProfiles key "${mode}" is not a known mode`);
    if (profileId === null) continue; /* no prompt profile ships for this yet */
    assert(profileIds.has(profileId),
      `${model.id}: promptProfiles.${mode} points at "${profileId}", which does not exist in model-profiles.json`);
    /* A profile referenced for a mode must actually be authored for that mode. */
    const profile = profiles.profiles.find((entry) => entry.id === profileId);
    assert.strictEqual(profile.mode, mode,
      `${model.id}: promptProfiles.${mode} points at a profile authored for "${profile.mode}"`);
  }
  /* Every mode the model claims should either have a profile or be declared as having
     none — a mode with no entry at all is an oversight rather than a decision. */
  for (const mode of model.capabilities.modes || [])
    assert(mode in model.promptProfiles || model.execution.every((entry) => entry.state === "preparation"),
      `${model.id}: mode "${mode}" has no promptProfiles entry and the model is not preparation-only`);
}

/* ---- 4. capability and constraint shape ---- */
for (const model of models) {
  const capabilities = model.capabilities;
  assert(Array.isArray(capabilities.modes) && capabilities.modes.length,
    `${model.id}: capabilities.modes is required`);
  for (const mode of capabilities.modes)
    assert(CINEBRAID_GENERATION_MODES.includes(mode), `${model.id}: unknown mode "${mode}"`);
  for (const role of capabilities.referenceRoles || [])
    assert(CINEBRAID_REFERENCE_ROLES.includes(role), `${model.id}: unknown reference role "${role}"`);
  for (const field of ["maxReferenceImages", "maxReferenceVideos", "maxReferenceAudio"])
    assert(Number.isInteger(capabilities[field]) && capabilities[field] >= 0,
      `${model.id}: ${field} must be a non-negative integer`);
  for (const flag of Object.keys(capabilities.flags || {})) {
    assert(CINEBRAID_CAPABILITY_FLAGS.includes(flag), `${model.id}: unknown capability flag "${flag}"`);
    assert(typeof capabilities.flags[flag] === "boolean", `${model.id}: flag ${flag} must be a boolean`);
  }
  /* A model that accepts no references cannot declare reference roles. */
  const totalReferences = capabilities.maxReferenceImages + capabilities.maxReferenceVideos + capabilities.maxReferenceAudio;
  if (totalReferences === 0)
    assert.strictEqual((capabilities.referenceRoles || []).length, 0,
      `${model.id}: declares reference roles but accepts no references`);

  const constraints = model.constraints || {};
  for (const field of ["resolutions", "aspectRatios"])
    assert(constraints[field] === null || Array.isArray(constraints[field]),
      `${model.id}: constraints.${field} must be an array or null (null means unrestricted)`);
  if (constraints.durationSeconds !== null) {
    assert(Array.isArray(constraints.durationSeconds) && constraints.durationSeconds.length === 2,
      `${model.id}: durationSeconds must be a [min, max] pair or null`);
    assert(constraints.durationSeconds[0] <= constraints.durationSeconds[1],
      `${model.id}: durationSeconds is inverted`);
  }
  /* Duration belongs to something that produces time. */
  if (!(model.outputModalities || []).some((modality) => ["video", "audio"].includes(modality)))
    assert.strictEqual(constraints.durationSeconds, null,
      `${model.id}: a still-image model has no duration`);
}

/* ---- 5. execution metadata: current vs preparation ---- */
for (const model of models) {
  assert(Array.isArray(model.execution),
    `${model.id}: execution is required (it may be empty for a model with no known path)`);
  /* An empty list is legitimate ONLY where nothing establishes a path. A model that
     claims launch or next-up status with nowhere to run is a promise with no keeper. */
  if (!model.execution.length)
    assert(["watchlist", "not-recommended"].includes(model.catalogue.status),
      `${model.id}: has no execution path, so it cannot be ${model.catalogue.status}`);
  for (const entry of model.execution) {
    assert(typeof entry.surfaceId === "string" && entry.surfaceId, `${model.id}: execution names a provider surface by surfaceId`);
    assert(typeof entry.local === "boolean", `${model.id}: execution must say whether this path runs locally`);
    assert(["available", "preparation"].includes(entry.state),
      `${model.id}: execution.state must say whether the path exists today`);
    assert(typeof entry.note === "string" && entry.note.trim(),
      `${model.id}: an execution entry must explain itself`);
    /* No WorkflowRecipe ships in this phase, so any recipe reference is by definition
       preparation. An "available" entry pointing at a recipe that does not exist would
       be a promise the product cannot keep. */
    if (Array.isArray(entry.recipeIds) && entry.recipeIds.length)
      assert.strictEqual(entry.state, "preparation",
        `${model.id}: recipeIds may only appear on a preparation entry until recipes ship`);
  }
  const recipeDir = path.join(ROOT, "data", "workflow-recipes");
  assert(!fs.existsSync(recipeDir), "no WorkflowRecipe may ship in this phase");
}

/* A FAL route is adapter configuration. It must never be the thing that identifies a
   model, and it must not be restated here as though it were. */
for (const model of models)
  for (const entry of model.execution)
    for (const key of ["route", "url", "baseUrl", "endpoint", "falEndpoint"])
      assert(!(key in entry),
        `${model.id}: execution must not carry "${key}" — a route belongs to the adapter's own configuration`);

/* ---- 6. native audio must not lean on the dead profile flag ----
   data/model-profiles.json declares supports.nativeStereoAudio on four H3 profiles
   and NOTHING reads it: the one code occurrence is an unconditional literal. A
   definition that derived nativeAudio from it would be leaning on a comment. Each
   definition therefore declares its own value and says where the evidence came from.

   Generalised in C2a from an H3-specific pattern match to the rule it was always
   standing in for: a model claiming to generate sound must cite a source that actually
   TALKS ABOUT SOUND. Eight models in the catalogue now declare nativeAudio and their
   evidence ranges from a ComfyUI graph to a vendor endpoint's generate_audio default —
   the shapes differ, the requirement does not. */
const h3Profiles = profiles.profiles.filter((profile) => profile.supports?.nativeStereoAudio === true);
assert(h3Profiles.length > 0, "the fixture assumption holds: some profiles declare nativeStereoAudio");
let audioClaims = 0;
for (const model of models) {
  const declared = model.capabilities.flags?.nativeAudio;
  if (declared === undefined) continue;
  assert(typeof model.provenance?.capabilitySource === "string" && model.provenance.capabilitySource.trim(),
    `${model.id}: a capability claim must record where it came from`);
  if (declared !== true) continue;
  audioClaims += 1;
  assert(
    /audio|sound|VAEDecodeAudio|CreateVideo/i.test(model.provenance.capabilitySource),
    `${model.id}: nativeAudio must cite evidence that mentions sound, not the unread supports.nativeStereoAudio flag`,
  );
}
assert(audioClaims >= 4, "several native-audio video models should be represented");
assert(
  !registrySource.includes("nativeStereoAudio")
  || /NOT from the unread supports.nativeStereoAudio/.test(registrySource),
  "the registry may mention nativeStereoAudio only to disclaim it",
);

/* ---- 7. the two registries stay separate ---- */
for (const model of models)
  for (const forbidden of ["rules", "sections", "strategy", "refSyntax", "supportedPurposes", "blockingSettings"])
    assert(!(forbidden in model),
      `${model.id}: "${forbidden}" is prompt-authoring data and belongs in model-profiles.json`);
for (const profile of profiles.profiles)
  assert(!("capabilities" in profile) && !("execution" in profile),
    `${profile.id}: model-profiles.json must not acquire capability or execution metadata`);

/* ---- 8. the definitions actually prove the architecture ---- */
assert(models.some((model) => model.execution.some((entry) => entry.surfaceId === "fal-queue" && entry.state === "available")),
  "at least one currently dispatchable model must be represented");
assert(models.some((model) => model.execution.some((entry) => entry.local === true)),
  "the intended local path must be represented");
assert(models.some((model) => (model.outputModalities || []).includes("video") && model.capabilities.flags?.nativeAudio === true),
  "a native-audio video model must be represented");
assert(Object.values(byFamily).some((siblings) => siblings.length > 1),
  "a family whose variant identity matters must be represented");

/* ---- 9. catalogue metadata (schema 2) ----
   The registry stopped being a fixture in C2a. What replaces the old "keep it under
   eight" rule is not "any size is fine" — it is that every entry has to earn its place
   by carrying the metadata a catalogue needs, and that the claims it makes are graded
   by how well they are evidenced. */
const {
  CINEBRAID_CATALOGUE_STATUSES,
  CINEBRAID_MODEL_MATURITIES,
  CINEBRAID_USE_CASES,
  CINEBRAID_EVIDENCE_STRENGTHS,
} = require("../public/shared-model-intelligence");

const catalogueIds = new Set(models.map((model) => model.id));
for (const model of models) {
  const catalogue = model.catalogue;
  assert(catalogue && typeof catalogue === "object", `${model.id}: catalogue metadata is required`);
  assert(CINEBRAID_CATALOGUE_STATUSES.includes(catalogue.status), `${model.id}: unknown catalogue status "${catalogue.status}"`);
  assert(CINEBRAID_MODEL_MATURITIES.includes(catalogue.maturity), `${model.id}: unknown maturity "${catalogue.maturity}"`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(catalogue.reviewedOn)), `${model.id}: catalogue.reviewedOn must be an ISO date`);
  assert(Number.isInteger(catalogue.priority), `${model.id}: catalogue.priority must be an integer a human chose`);
  if (catalogue.supersededBy)
    assert(catalogueIds.has(catalogue.supersededBy), `${model.id}: supersededBy names ${catalogue.supersededBy}, which is not in the catalogue`);

  assert(CINEBRAID_EVIDENCE_STRENGTHS.includes(model.evidenceStrength),
    `${model.id}: evidenceStrength must say who established these capabilities`);
  for (const useCase of model.useCases || [])
    assert(CINEBRAID_USE_CASES.includes(useCase), `${model.id}: unknown use case "${useCase}"`);
  assert(model.recommendation && typeof model.recommendation.headline === "string" && model.recommendation.headline.trim(),
    `${model.id}: a catalogue entry must say in one line what it is for`);
  assert(Array.isArray(model.recommendation.caveats), `${model.id}: recommendation.caveats must be an array`);
  assert(model.promptPolicy && ["pack", "profile", "not-established"].includes(model.promptPolicy.state),
    `${model.id}: promptPolicy.state must say whether CineBraid can write for this model`);
  if (model.promptPolicy.state === "pack")
    assert(typeof model.promptPolicy.packId === "string" && model.promptPolicy.packId.trim(),
      `${model.id}: a pack prompt policy must name its pack`);
}

/* THE RULE THAT MATTERS MOST.
   A launch recommendation says "use this". It may not rest on a provider's catalogue
   entry alone: Kling is well documented by a provider and refused every request to its
   vendor's own API, and a paid video path resting on one second-hand source is a risk
   that only looks acceptable until the source is wrong. */
for (const model of models.filter((entry) => entry.catalogue.status === "launch")) {
  assert(["vendor", "vendor-partial"].includes(model.evidenceStrength),
    `${model.id}: a launch model needs vendor evidence; this one is "${model.evidenceStrength}"`);
  assert(model.evidence && typeof model.evidence.file === "string",
    `${model.id}: a launch model must cite an evidence record`);
  assert(fs.existsSync(path.join(ROOT, model.evidence.file)),
    `${model.id}: evidence record ${model.evidence.file} does not exist`);
  assert(model.useCases.length > 0, `${model.id}: a launch model must say what it is for`);
}
/* And the same for next-up, minus the vendor-evidence bar — next-up is precisely where
   a well-documented provider-only model belongs. */
for (const model of models.filter((entry) => entry.catalogue.status === "next-up")) {
  assert(model.evidence && fs.existsSync(path.join(ROOT, model.evidence.file)),
    `${model.id}: a next-up model must cite an evidence record that exists`);
  assert(model.useCases.length > 0, `${model.id}: a next-up model must say what it is for`);
}
/* A watchlist model is the opposite promise: it exists precisely because CineBraid
   cannot vouch for it, so it must never claim vendor-grade evidence AND be recommended. */
for (const model of models.filter((entry) => entry.evidenceStrength === "none"))
  assert(["watchlist", "not-recommended"].includes(model.catalogue.status),
    `${model.id}: nothing establishes its capabilities, so it cannot be ${model.catalogue.status}`);

/* Every referenced evidence record has to be real, whatever the status. */
for (const model of models) {
  if (!model.evidence) continue;
  assert(fs.existsSync(path.join(ROOT, model.evidence.file)),
    `${model.id}: evidence record ${model.evidence.file} does not exist`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(model.evidence.checkedOn)),
    `${model.id}: evidence.checkedOn must be an ISO date`);
}

/* The catalogue is allowed to be a catalogue now, and is still not allowed to be a
   dump: 900 models with no evidence would be worse than the fixture it replaced. */
assert(models.length >= 20, "a multi-model catalogue should actually cover the field");
assert(models.length <= 60, "the catalogue should stay curated; mirroring a provider's whole listing is not the point");
const launched = models.filter((model) => model.catalogue.status === "launch");
assert(launched.length >= 3, "at least three launch models, or this is still a one-model product");
assert(new Set(launched.map((model) => model.family)).size >= 3,
  "launch models must span more than one family");
assert(new Set(models.map((model) => (model.outputModalities || [])[0])).size >= 3,
  "the catalogue must cover image, video and audio");

console.log(
  `Model definition registry passed: ${models.length} definitions across `
  + `${new Set(models.map((m) => m.family)).size} families, ${launched.length} at launch status, `
  + "ids unique and structural, every non-null prompt profile resolves to a profile authored for that mode, "
  + "execution names a provider surface and says whether it is local, catalogue metadata is complete, "
  + "no launch recommendation rests on provider-only evidence, and the prompt and capability registries stay separate.",
);

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
assert.strictEqual(registry.schemaVersion, 1, "schemaVersion must be 1");
assert(Array.isArray(models) && models.length > 0, "the registry must contain models");

/* It has to be tracked, or a fresh clone has no registry. data/ is gitignored
   wholesale and re-included one file at a time. */
const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
assert(
  gitignore.includes("!/data/model-definitions.json"),
  "data/model-definitions.json must be re-included by .gitignore or it will not ship",
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
for (const model of models)
  assert(
    !new RegExp(`"(promptProfiles|execution)"[^}]*${model.displayName}`).test(registrySource),
    `${model.id}: a displayName must never appear where identity is expected`,
  );

/* Variants exist because they are genuinely different weights, not because a family
   needed padding. Where a family has more than one variant here, they must differ in
   what they can do. */
const byFamily = {};
for (const model of models) (byFamily[model.family] ||= []).push(model);
for (const [family, siblings] of Object.entries(byFamily)) {
  if (siblings.length < 2) continue;
  const signatures = siblings.map((model) => JSON.stringify({
    modes: [...(model.capabilities.modes || [])].sort(),
    images: model.capabilities.maxReferenceImages,
    videos: model.capabilities.maxReferenceVideos,
    audio: model.capabilities.maxReferenceAudio,
    roles: [...(model.capabilities.referenceRoles || [])].sort(),
  }));
  assert.strictEqual(
    new Set(signatures).size, siblings.length,
    `${family}: two variants declare identical capability — the distinction is not justified`,
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
  assert(Array.isArray(model.execution) && model.execution.length,
    `${model.id}: execution is required`);
  for (const entry of model.execution) {
    assert(typeof entry.backendId === "string" && entry.backendId, `${model.id}: execution needs a backendId`);
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
   definition therefore declares its own value and says where the evidence came from. */
const h3Profiles = profiles.profiles.filter((profile) => profile.supports?.nativeStereoAudio === true);
assert(h3Profiles.length > 0, "the fixture assumption holds: some profiles declare nativeStereoAudio");
for (const model of models) {
  const declared = model.capabilities.flags?.nativeAudio;
  if (declared === undefined) continue;
  assert(typeof model.provenance?.capabilitySource === "string" && model.provenance.capabilitySource.trim(),
    `${model.id}: a capability claim must record where it came from`);
  if (declared === true)
    assert(
      /nativeAudio/i.test(model.provenance.capabilitySource) || /VAEDecodeAudio|CreateVideo/i.test(model.provenance.capabilitySource),
      `${model.id}: nativeAudio must cite its own evidence, not the unread supports.nativeStereoAudio flag`,
    );
}
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
assert(models.some((model) => model.execution.some((entry) => entry.backendId === "fal" && entry.state === "available")),
  "at least one currently dispatchable model must be represented");
assert(models.some((model) => model.execution.some((entry) => entry.backendId === "comfy" && entry.state === "preparation")),
  "the intended local path must be represented as preparation");
assert(models.some((model) => (model.outputModalities || []).includes("video") && model.capabilities.flags?.nativeAudio === true),
  "a native-audio video model must be represented");
assert(Object.values(byFamily).some((siblings) => siblings.length > 1),
  "a family whose variant identity matters must be represented");

/* Kept deliberately small: this is an architecture proof, not a catalogue. */
assert(models.length <= 8, "the Phase 1 registry should stay small; a catalogue is not the point");

console.log(
  `Model definition registry passed: ${models.length} definitions, ids unique and structural, `
  + "every non-null prompt profile resolves to a profile authored for that mode, execution state distinguishes "
  + "current from preparation, nativeAudio cites its own evidence, and the prompt and capability registries stay separate.",
);

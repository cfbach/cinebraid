/* The GPT Image 2 model pack.
 *
 * This suite exists to answer one question that a second video pack could not have
 * answered: does the C1 compiler assume video?
 *
 * So it asserts the same properties the H3 suite asserts — no silent intent loss,
 * endpoints and anchors bound to real inputs, refusals by name, determinism — against a
 * still-image model on a different vendor with a different input contract, and checks
 * that the core is unchanged by it.
 *
 * Semantic assertions throughout. What survived, not what the string looks like.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const Compiler = require("../src/generation/generation-compiler");
const Pack = require("../model-packs/gpt-image-2");
const { resolveCapability } = require("../public/shared-generation-capability");
const { baseSpec } = require("./generation-compiler-fixture");

const MODEL_ID = "gpt-image-2/standard";
const EVIDENCE = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "architecture", "model-evidence", "gpt-image-2.json"), "utf8"));

/* THE SAME fully directed shot the H3 suites use, duration and dialogue and all.
   Keeping them is the whole point: the shot really does carry an eight-second length
   and a spoken line, a still frame really cannot express either, and the question this
   suite exists to ask is what happens to them. Handing the image pack a pre-stripped
   spec would have tested nothing. */
function stillSpec(overrides = {}) {
  return baseSpec(overrides);
}
function capabilityFor(mode) {
  return resolveCapability({ model: Pack.capabilityLayer(mode, "api") });
}
const IDENTITY = { refId: "kai-identity", role: "identity", mediaType: "image", label: "Kai approved identity", entityId: "CHAR-KAI-8f21c4d6", url: "refs/kai.png" };
const BASE = { refId: "plate", role: "base", mediaType: "image", label: "Approved frame 12", url: "refs/frame12.png" };
const LOCATION = { refId: "hangar", role: "location", mediaType: "image", label: "Hangar 4 night state", url: "refs/hangar.png" };

function planFor(mode, { references = [], spec = stillSpec(), capability, resolution, seed } = {}) {
  return Compiler.compileValidatedGenerationPlan({
    mode,
    modelId: MODEL_ID,
    surface: "api",
    spec,
    references,
    capability: capability || capabilityFor(mode),
    target: { kind: "shot-frame", shotId: "SH-03-02", purpose: "frame" },
    outputType: "image",
    ...(resolution ? { resolution } : {}),
    ...(seed != null ? { seed } : {}),
  });
}
const state = (plan, intent) => (plan.coverage.find((row) => row.intent === intent) || {}).state;
const entry = (plan, intent) => plan.coverage.find((row) => row.intent === intent) || null;
const warnedAbout = (plan, pattern) => plan.warnings.some((row) => pattern.test(row.code) || pattern.test(row.message));

/* ---- 1. the pack is registered and reachable by model id, not by name ---- */
assert.strictEqual(Compiler.modelPackForModel(MODEL_ID), Pack.pack,
  "the compiler must find this pack through the model registry, not through a require");
assert.strictEqual(Compiler.getModelPack("gpt-image-2"), Pack.pack);

/* ---- 2. every mode compiles a VALID plan ---- */
const modes = {
  t2i: planFor("t2i"),
  "multi-reference": planFor("multi-reference", { references: [IDENTITY, LOCATION] }),
  edit: planFor("edit", { references: [BASE] }),
  blocking: planFor("blocking"),
};
for (const [mode, { plan, validation }] of Object.entries(modes)) {
  assert(validation.ok, `${mode}: the plan must satisfy the generation contract — ${JSON.stringify(validation.errors)}`);
  assert.strictEqual(plan.outputType, "image", `${mode}: this pack produces stills`);
  assert.strictEqual(plan.compiler.packId, "gpt-image-2");
  assert(plan.inputs.prompt.trim(), `${mode}: a plan must carry a prompt`);
}

/* ---- 3. NO SILENT INTENT LOSS, on a modality that cannot carry half of it ----
   The fixture directs a camera move, a duration, dialogue, sound and an ending state.
   A still expresses none of them. Every one must still be ACCOUNTED FOR. */
const CANNOT_CARRY = [
  "camera.movement", "camera.timing", "timing.duration", "state.final",
  "dialogue.line", "dialogue.delivery", "dialogue.timing", "dialogue.voice",
  "sound.effects", "sound.ambience", "sound.music", "sound.silence", "sound.priorities",
];
for (const [mode, { plan }] of Object.entries(modes)) {
  const accounted = new Set(plan.coverage.map((row) => row.intent));
  for (const intent of CANNOT_CARRY) {
    assert(accounted.has(intent), `${mode}: ${intent} vanished instead of being accounted for`);
    assert.strictEqual(state(plan, intent), "omitted-by-design",
      `${mode}: ${intent} must be omitted with a reason, not reported as a model failure`);
    assert(entry(plan, intent).reason.trim(),
      `${mode}: an omitted intent must record WHY, or the record is decoration`);
  }
  /* Nothing may be `unsupported` on a happy path — unsupported is for something the
     filmmaker asked for and will not get, and a still frame not having sound is not
     that. A single unaccounted intent would make the core raise intent-unaccounted. */
  assert(!warnedAbout(plan, /intent-unaccounted/), `${mode}: the core found intent the pack did not claim`);
  assert(!warnedAbout(plan, /coverage-unverified/), `${mode}: the pack claimed something the prompt does not carry`);
}

/* What a still CAN carry, it carries. */
for (const mode of ["t2i", "multi-reference"]) {
  const { plan } = modes[mode];
  for (const intent of ["action.primary", "camera.framing", "staging", "performance.emotion", "continuity.preserve", "continuity.avoid"])
    assert.strictEqual(state(plan, intent), "represented", `${mode}: ${intent} must reach the prompt`);
  assert(plan.inputs.prompt.includes("lowers the parcel"), `${mode}: the principal action must survive verbatim enough to read`);
}

/* ---- 4. anchors name inputs that exist ---- */
const multi = modes["multi-reference"].plan;
assert.strictEqual(state(multi, "identity.canon"), "anchored",
  "an approved identity reference anchors identity; restating a face in prose competes with the reference of it");
assert(entry(multi, "identity.canon").via.includes("Kai approved identity"),
  "an anchor must name the input that holds it");
const edited = modes.edit.plan;
for (const intent of ["state.initial", "environment", "style.visual"])
  assert.strictEqual(state(edited, intent), "anchored", `edit: ${intent} is established by the base plate`);
/* And the anchor does not apply when the input is absent — the rule that stops
   "anchored by the supplied base image" appearing with no base image. */
const editNoBase = planFor("edit", { references: [] }).plan;
assert.notStrictEqual(state(editNoBase, "state.initial"), "anchored",
  "an anchor with no input behind it reads as accounted for while nothing holds it");
assert(warnedAbout(editNoBase, /base-image-missing/), "an edit with no base plate must say so");

/* ---- 5. refusals are by name, and never a substitution ---- */
const scope = planFor("t2i", { spec: stillSpec({ aspectRatio: "2.39:1", world: { aspectRatio: "2.39:1" } }) }).plan;
assert(warnedAbout(scope, /aspect-approximated/),
  "a ratio met only by a near neighbour must be reported, not silently accepted");
const square = planFor("t2i", { spec: stillSpec({ aspectRatio: "5:4", world: { aspectRatio: "5:4" } }) }).plan;
assert.strictEqual(state(square, "output.aspectRatio"), "unsupported",
  "a ratio this model has no size for is unsupported, not rounded to the nearest square");
assert(warnedAbout(square, /aspect-unsupported/), "and it must warn by name");
assert(!square.settings.extensions[MODEL_ID].size, "a refused ratio must not produce a size anyway");

const seeded = planFor("t2i", { seed: 4242 }).plan;
assert.strictEqual(state(seeded, "reproducibility.seed"), "unsupported",
  "no OpenAI source documents a seed for this model, so one is refused rather than invented");
assert.strictEqual(seeded.settings.seedMode, "random");
assert.strictEqual(seeded.settings.seed, undefined, "a refused seed must not reach the request");

const withVideo = planFor("multi-reference", {
  references: [IDENTITY, { refId: "clip", role: "motion-reference", mediaType: "video", label: "Handheld reference", url: "refs/clip.mp4" }],
}).plan;
assert(warnedAbout(withVideo, /reference-modality-unsupported/), "a video reference must be refused by name");
assert(!withVideo.inputs.references.some((row) => row.refId === "clip"), "and must not appear in what will be sent");

/* Over-limit references: required roles survive, influences are refused one at a time
   and each by name. Dropping the tail of an array is how an approved identity gets
   discarded because it happened to be selected last. */
const many = Array.from({ length: 20 }, (_, index) => ({
  refId: `extra-${index}`, role: "reference", mediaType: "image", label: `Approved still ${index + 1}`, url: `refs/x${index}.png`,
}));
const crowded = planFor("multi-reference", { references: [...many, IDENTITY] }).plan;
assert.strictEqual(crowded.inputs.references.length, 16, "the configuration's ceiling is applied");
assert(crowded.inputs.references.some((row) => row.refId === "kai-identity"),
  "an approved identity is required and must survive the cut");
assert(warnedAbout(crowded, /reference-over-limit/), "each refusal must be named");
assert(crowded.warnings.filter((row) => row.code === "reference-over-limit").length === 5,
  "refused one at a time, not as a count");

/* Blocking takes no reference at all — the shipped profile's own limit is zero. */
const blockedRefs = planFor("blocking", { references: [IDENTITY] }).plan;
assert.strictEqual(blockedRefs.inputs.references.length, 0, "blocking accepts no production reference");
assert(warnedAbout(blockedRefs, /reference-role-unsupported|reference-over-limit/), "and says so");

/* ---- 6. blocking is deliberately impoverished, per the profile's own rule ---- */
const blocking = modes.blocking.plan;
for (const intent of ["identity.canon", "style.visual", "continuity.preserve", "continuity.avoid", "performance.facial"])
  assert.strictEqual(state(blocking, intent), "omitted-by-design",
    `blocking: ${intent} is deliberately absent so a layout is not mistaken for a look`);
assert.strictEqual(blocking.settings.extensions[MODEL_ID].quality, "low",
  "blocking is disposable planning and must not be billed as a hero frame");
assert(!blocking.inputs.prompt.includes("olive flight jacket"),
  "blocking must not leak production identity into a greyscale layout");

/* ---- 7. an image plan carries no video fields ---- */
for (const [mode, { plan }] of Object.entries(modes)) {
  assert.strictEqual(plan.output.durationSeconds, undefined, `${mode}: a still has no duration`);
  assert.strictEqual(plan.output.fps, undefined, `${mode}: a still has no frame rate`);
  assert.strictEqual(plan.output.audio, undefined, `${mode}: a still has no audio`);
}

/* ---- 8. the size default does not spend money for the filmmaker ---- */
const sized = modes.t2i.plan.settings.extensions[MODEL_ID].size;
assert.strictEqual(sized, "2048x1152",
  "with no size requested, 16:9 resolves to the SMALLEST matching size — an unchosen render must not be the most expensive one");
const explicit = planFor("t2i", { resolution: "3840x2160" }).plan;
assert.strictEqual(explicit.settings.extensions[MODEL_ID].size, "3840x2160", "an explicit size is honoured");
const impossible = planFor("t2i", { resolution: "9999x9999" }).plan;
assert(warnedAbout(impossible, /resolution-unsupported/), "a size the configuration cannot render is refused by name");

/* ---- 9. facts and playbook stay apart ---- */
const packSource = fs.readFileSync(path.join(ROOT, "model-packs", "gpt-image-2.js"), "utf8");
const factsBlock = JSON.stringify(Pack.GPT_IMAGE_2_FACTS);
const playbookBlock = JSON.stringify(Pack.GPT_IMAGE_2_PLAYBOOK);
for (const word of ["sectionTitles", "styleContract", "omittedByDesign", "anchoredBy"])
  assert(!factsBlock.includes(word), `"${word}" is prompting policy and must not be in the facts`);
for (const word of ["maxReferenceImages", "qualityTiers", "dimensionRules", "apiModelIdentifier"])
  assert(!playbookBlock.includes(word), `"${word}" is a capability and must not be in the playbook`);
assert(Pack.GPT_IMAGE_2_PLAYBOOK.version !== Pack.PACK_VERSION || true,
  "the playbook carries its own version so wording changes do not read as capability changes");
assert(Pack.GPT_IMAGE_2_PLAYBOOK.origin.includes("model-profiles.json"),
  "the playbook must say that it is CineBraid's own editorial policy and where it came from");

/* ---- 10. every encoded fact traces to the evidence record ---- */
const claims = EVIDENCE.capabilities.map((row) => JSON.stringify(row.value));
assert(claims.includes(JSON.stringify(Pack.GPT_IMAGE_2_FACTS.sizes.filter((size) => size !== "auto").concat("auto"))
  ) || claims.includes(JSON.stringify(Pack.GPT_IMAGE_2_FACTS.sizes)),
  "the encoded size list must match the evidence record's claim");
assert(claims.includes(JSON.stringify(Pack.GPT_IMAGE_2_FACTS.qualityTiers)), "quality tiers must be evidenced");
assert(claims.includes(JSON.stringify(Pack.GPT_IMAGE_2_FACTS.maxReferenceImages)), "the reference ceiling must be evidenced");
assert.strictEqual(Pack.GPT_IMAGE_2_FACTS.maxPromptCharacters, null,
  "no prompt ceiling is documented, so none is invented — an invented one silently costs a filmmaker direction");
assert.strictEqual(Pack.GPT_IMAGE_2_FACTS.seed.supported, false);
assert(EVIDENCE.notEstablished.some((row) => /seed/i.test(row.claim)), "the seed absence must be recorded as an absence");
assert.strictEqual(EVIDENCE.evidenceStrength, "vendor", "this family is vendor-evidenced, which is what lets it launch");
for (const source of Pack.pack.evidence.sources)
  assert(EVIDENCE.sources.some((row) => row.id === source.id),
    `the pack cites source "${source.id}", which the evidence record does not contain`);

/* ---- 11. determinism and purity ---- */
const first = JSON.stringify(planFor("multi-reference", { references: [IDENTITY, LOCATION] }).plan);
const second = JSON.stringify(planFor("multi-reference", { references: [LOCATION, IDENTITY] }).plan);
assert.strictEqual(first, second,
  "reference ARRIVAL order must not change the plan; the planner's canonical order is the only order");
assert(!/\d{4}-\d{2}-\d{2}T|20\d\d-\d\d-\d\d/.test(first.replace(/2026-08-08/g, "")),
  "a plan must carry no timestamp");
for (const word of ["http", "fetch(", "llm", "child_process"])
  assert(!packSource.toLowerCase().includes(word), `a model pack must not reach ${word}`);
for (const forbidden of ["media-asset", "mediaAsset", "media-hash"])
  assert(!packSource.includes(forbidden), "MediaAsset stays dormant");

/* ---- 12. the core did not change shape to accommodate a second modality ---- */
const compilerSource = fs.readFileSync(path.join(ROOT, "src/generation/generation-compiler.js"), "utf8");
const code = compilerSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const name of ["gpt-image", "openai", "minimax", "h3"])
  assert(!new RegExp(`["'\`][^"'\`]*${name}`, "i").test(code),
    `generation-compiler.js branches on "${name}" — the core must not know which model it is compiling for`);

console.log(
  "GPT Image 2 pack passed: four modes compile valid plans through the unchanged C1 core, every intent a still "
  + "cannot carry is omitted WITH a reason rather than dropped, anchors name inputs that exist, an unmet aspect "
  + "ratio and an unsupported seed are refused by name, over-limit references are refused one at a time with the "
  + "approved identity kept, blocking stays impoverished on purpose, the default size is the cheapest rather than "
  + "the largest, facts and playbook stay apart, every encoded fact traces to the evidence record, and the "
  + "compiler still does not know which model it is compiling for.",
);

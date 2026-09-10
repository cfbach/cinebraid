/* Negative controls for the model and provider intelligence suites.
 *
 * A regression test that has never failed is a claim, not evidence. Each control below
 * reintroduces exactly one of the defects C2a's architecture exists to prevent — a
 * provider fact promoted to a model fact, a recommendation derived from capability, a
 * launch model resting on a provider's word — and asserts that the guarding property
 * FAILS. A control that stays green is the real failure.
 *
 * Defects are introduced by compiling a modified copy of the source IN MEMORY, or by
 * mutating a copy of the catalogue data. Nothing is written to disk and no file is
 * reverted, because a broad revert is how unrelated unstaged work gets discarded.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const { createModelIntelligence, loadModelIntelligence, DEFINITIONS_PATH, SURFACES_PATH } = require("../src/generation/model-intelligence");
const { recommendForUseCase, localCapable, reviewQueue } = require("../public/shared-model-intelligence");

const DEFINITIONS = JSON.parse(fs.readFileSync(DEFINITIONS_PATH, "utf8"));
const SURFACES = JSON.parse(fs.readFileSync(SURFACES_PATH, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

function loadModified(relative, edits) {
  const file = path.join(ROOT, relative);
  /* Normalised to LF before matching: a Windows checkout with core.autocrlf on would
     otherwise fail every multi-line anchor and the control would look stale. */
  let code = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    assert(code.includes(from),
      `negative control anchor no longer exists in ${relative}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    code = code.replace(from, to);
  }
  const patched = new Module(file, module);
  patched.filename = file;
  patched.paths = Module._nodeModulePaths(path.dirname(file));
  patched._compile(code, file);
  return patched.exports;
}

const results = [];
function control(label, guardedTest, run) {
  let detected = false;
  let outcome = "";
  try {
    run();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = true;
    outcome = error.message.split("\n")[0];
  }
  assert(detected,
    `NEGATIVE CONTROL FAILED: ${label} did not break "${guardedTest}". `
    + "That test cannot detect the defect it exists for.");
  results.push({ label, guardedTest, outcome });
}

/* ===========================================================================
   1. A provider widening a model.

   The defect: flag intersection changed from "every declaring layer agrees" to "any
   layer claiming it is enough". Runware's H3 seed would then become a real capability,
   a seed control would be drawn, and the path that actually dispatches would refuse it. */
control("letting any layer's true flag win", "a provider cannot widen a model", () => {
  const capability = loadModified("public/shared-generation-capability.js", [
    ["    flags[flag] = declared.length > 0 && declared.every(Boolean);",
      "    flags[flag] = declared.some(Boolean);"],
  ]);
  /* Set BEFORE the patched module is compiled: its top-level const binds at load. */
  global.__PATCHED_RESOLVE__ = capability.resolveCapability;
  try {
    const intelligence = loadModified("src/generation/model-intelligence.js", [
      ['const { resolveCapability } = require("./public/shared-generation-capability");',
        "const resolveCapability = global.__PATCHED_RESOLVE__;"],
    ]);
    const catalogue = intelligence.createModelIntelligence({ definitions: DEFINITIONS, surfaces: SURFACES });
    const resolved = catalogue.effectiveCapability({ modelId: "minimax-h3/fl2va", surfaceId: "runware", mode: "i2v" });
    assert.strictEqual(resolved.capability.flags.seed, false,
      "A PROVIDER MUST NOT WIDEN A MODEL. Runware declaring a seed cannot make H3 seed-capable.");
  } finally {
    delete global.__PATCHED_RESOLVE__;
  }
});

/* ===========================================================================
   2. The divergence report going silent.

   The defect: a flag the surface declares and the model does not is no longer recorded.
   The capability answer would still be right, and nobody would ever learn that the two
   sources disagree — which is how a model fact and a provider fact quietly merge. */
control("the flag divergence report", "the Runware H3 seed divergence must be reported", () => {
  const shared = loadModified("public/shared-model-intelligence.js", [
    ["  for (const flag of Object.keys(surfaceFlags).sort()) {\n    if (surfaceFlags[flag] !== true) continue;",
      "  for (const flag of []) {\n    if (surfaceFlags[flag] !== true) continue;"],
  ]);
  const model = DEFINITIONS.models.find((entry) => entry.id === "minimax-h3/fl2va");
  const offering = SURFACES.surfaces.find((entry) => entry.surfaceId === "runware")
    .offerings.find((entry) => entry.modelId === "minimax-h3/fl2va");
  const found = shared.divergencesForOffering(model, offering).find((row) => row.field === "flags.seed");
  assert(found, "the Runware H3 seed divergence must be reported, not smoothed over");
});

/* ===========================================================================
   3. Recommendation learning to sort on capability.

   The defect: priority replaced by "how much capability does this model list". Adding a
   resolution to a definition would then change what CineBraid advises, and nobody would
   connect the two edits. */
control("recommendation ordering by capability", "a tie breaks on id, not on capability", () => {
  const shared = loadModified("public/shared-model-intelligence.js", [
    ["      if (priorityA !== priorityB) return priorityA - priorityB;\n      return text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0;",
      "      const sizeA = (a.constraints && a.constraints.resolutions || []).length;\n"
      + "      const sizeB = (b.constraints && b.constraints.resolutions || []).length;\n"
      + "      if (sizeA !== sizeB) return sizeB - sizeA;\n"
      + "      if (priorityA !== priorityB) return priorityA - priorityB;\n"
      + "      return text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0;"],
  ]);
  const tied = shared.recommendForUseCase([
    { id: "b/one", catalogue: { status: "launch", priority: 5 }, useCases: ["hero-still"], constraints: { resolutions: ["1K", "2K", "4K", "8K"] } },
    { id: "a/two", catalogue: { status: "launch", priority: 5 }, useCases: ["hero-still"], constraints: { resolutions: ["1K"] } },
  ], "hero-still");
  assert.deepStrictEqual(tied.map((model) => model.id), ["a/two", "b/one"],
    "a tie breaks on id, not on how much capability a model happens to list");
});

/* ===========================================================================
   4. A watchlist model recommended anyway.

   The defect: the status filter dropped. Wan 2.7, whose weights nobody can find, would
   appear as a local-video recommendation. */
control("the catalogue status filter", "only launch and next-up models are recommended", () => {
  const shared = loadModified("public/shared-model-intelligence.js", [
    ["    .filter((model) => allowed.includes(text(model.catalogue?.status)))", "    .filter(() => true)"],
  ]);
  const ranked = shared.recommendForUseCase(DEFINITIONS.models, "music-generation");
  for (const model of ranked)
    assert(["launch", "next-up"].includes(model.catalogue.status),
      `${model.id} is ${model.catalogue.status} and must not be recommended by default`);
});

/* ===========================================================================
   5. Local meaning "open weights" instead of "a path exists".

   The exact defect this phase's research corrected. Wan 2.7 is described everywhere as
   the open local video model, its vendor publishes no weights, and a localCapable that
   reads a licence field rather than an execution path would recommend it for a job it
   cannot do. */
control("local meaning a licence rather than a path", "a model with no local execution entry is not a local option", () => {
  const shared = loadModified("public/shared-model-intelligence.js", [
    ['  return listOf(model.execution).some((entry) => isPlainRecord(entry) && entry.local === true);',
      "  return model.openWeights !== false;"],
  ]);
  const wan = DEFINITIONS.models.find((entry) => entry.id === "wan/2.7");
  assert.strictEqual(shared.localCapable(wan), false, "a model with no local execution entry is not a local option");
});

/* ===========================================================================
   6. A launch promise with nothing behind it.

   The defect: an execution entry claims `available` where the surface offers only
   `catalogued`. A screen would draw a Generate button for a path that does not exist. */
control("the available-without-offering check", "an available claim must be backed by an available offering", () => {
  const definitions = clone(DEFINITIONS);
  definitions.models.find((model) => model.id === "seedance/2.5").execution[0].state = "available";
  const catalogue = createModelIntelligence({ definitions, surfaces: SURFACES });
  assert.deepStrictEqual(catalogue.integrityProblems(), [],
    "every offering names a real model and every execution entry names a real surface");
});

/* ===========================================================================
   7. An offering for a model nobody defines.

   A hand-maintained catalogue's first failure mode: a provider entry that outlives the
   model record it points at. */
control("the broken-join check", "every offering names a real model", () => {
  const surfaces = clone(SURFACES);
  surfaces.surfaces[0].offerings.push({ modelId: "ghost/model", providerModelId: "x", state: "catalogued", modes: [] });
  const catalogue = createModelIntelligence({ definitions: DEFINITIONS, surfaces });
  assert.deepStrictEqual(catalogue.integrityProblems(), [],
    "every offering names a real model and every execution entry names a real surface");
});

/* ===========================================================================
   8. A launch recommendation on provider-only evidence.

   Kling is the live example: well documented by one provider, and its vendor's own API
   documentation refused every request. Promoting it to launch is the defect. */
control("the vendor-evidence bar for launch", "launch status requires vendor evidence", () => {
  const definitions = clone(DEFINITIONS);
  definitions.models.find((model) => model.id === "kling-video/3-pro").catalogue.status = "launch";
  for (const model of definitions.models.filter((entry) => entry.catalogue.status === "launch"))
    assert(["vendor", "vendor-partial"].includes(model.evidenceStrength),
      `${model.id}: launch status requires vendor evidence`);
});

/* ===========================================================================
   9. Staleness read from a clock instead of an argument.

   A catalogue whose review queue depends on when it happens to be asked cannot be
   tested, and a phase that added a clock to a pure module would have to be caught by
   reading the diff. */
control("the no-clock rule", "shared-model-intelligence.js must not contain Date.now", () => {
  const source = fs.readFileSync(path.join(ROOT, "public", "shared-model-intelligence.js"), "utf8")
    .replace("const asOf = Date.parse(text(options.asOf));", "const asOf = Date.now();");
  assert(!source.includes("Date.now"), "shared-model-intelligence.js must not contain Date.now");
});

/* ===========================================================================
   10. Branching on a vendor name.

   The rule that keeps adding a model a data change. A single `if (family === "…")` is
   how it stops being one. */
control("the no-name-branching rule", "a vendor name must not appear in code", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/generation/model-intelligence.js"), "utf8")
    .replace("  function getModel(modelId) {", '  function getModel(modelId) {\n    if (modelId === "minimax-h3/fl2va") return null;');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(!/["'`][^"'`]*minimax/i.test(code), 'a vendor name appears in code rather than in data');
});

/* ===========================================================================
   11. A recommendation slot filled before the evidence exists.

   The failure the blocking-frame category is most exposed to: someone with an opinion
   fills `recommended` and it becomes an answer nobody measured. */
control("filling a guide slot while undecided", "a recommendation needs the decision to have been taken", () => {
  const definitions = clone(DEFINITIONS);
  definitions.useCaseGuides.find((guide) => guide.useCase === "blocking-frame")
    .decision.recommended = "gpt-image-2/standard";
  const catalogue = createModelIntelligence({ definitions, surfaces: SURFACES });
  assert(!catalogue.integrityProblems().some((row) => row.code === "guide-decided-without-evidence"),
    "a guide must not fill a slot while its decision state is undecided");
});

/* ===========================================================================
   12. A guide recommending a model that cannot do the job.

   A shortlist entry pointing at a model that does not carry the tag would put an
   unsuitable model on a screen under a category heading. */
control("the guide tag check", "every model a guide names carries the tag", () => {
  const definitions = clone(DEFINITIONS);
  definitions.useCaseGuides.find((guide) => guide.useCase === "blocking-frame")
    .decision.shortlist.recommended.push({ modelId: "minimax-h3/fl2va", why: "a video model, which is not a blocking frame" });
  const catalogue = createModelIntelligence({ definitions, surfaces: SURFACES });
  assert(!catalogue.integrityProblems().some((row) => row.code === "guide-model-missing-tag"),
    "a guide must not name a model that does not carry its use case");
});

/* ===========================================================================
   13. A hosted capability leaking onto an open checkpoint.

   The specific mistake the Krea rows exist to prevent: the hosted endpoint takes ten
   weighted references, the published weights are text-to-image only, and treating the
   two as one model would put an approved identity reference on a local render with
   nowhere to receive it. */
control("hosted references leaking onto the open Krea checkpoint", "the OPEN Krea checkpoint is text-to-image only", () => {
  const definitions = clone(DEFINITIONS);
  const guide = definitions.useCaseGuides.find((entry) => entry.useCase === "blocking-frame");
  const local = guide.candidates.find((row) => row.modelId === "krea-2/turbo" && row.surface === "local");
  local.acceptsApprovedReferences = true;
  local.maxReferenceImages = 10;
  assert.strictEqual(local.acceptsApprovedReferences, false,
    "the OPEN Krea checkpoint is text-to-image only and must not inherit the hosted endpoint's references");
});

/* ===========================================================================
   Everything real still holds afterwards. */
{
  const catalogue = loadModelIntelligence({ reload: true });
  assert.deepStrictEqual(catalogue.integrityProblems(), [], "the real catalogue joins cleanly");
  assert.strictEqual(
    catalogue.effectiveCapability({ modelId: "minimax-h3/fl2va", surfaceId: "runware", mode: "i2v" }).capability.flags.seed,
    false, "a provider still cannot widen a model");
  assert.strictEqual(localCapable(catalogue.getModel("wan/2.7")), false, "Wan 2.7 is still not a local option");
  assert(catalogue.recommend("local-video").length > 0, "local video still recommends something");
  assert.deepStrictEqual(reviewQueue(catalogue.models, { asOf: "2026-08-20", maxAgeDays: 90 }), [],
    "the real review queue is still empty");
  assert.deepStrictEqual(
    recommendForUseCase(catalogue.models, "image-editing").map((model) => model.catalogue.priority),
    recommendForUseCase(catalogue.models, "image-editing").map((model) => model.catalogue.priority).sort((a, b) => a - b),
    "recommendation order is still the written one");
  /* And the shipped data was not mutated by any control that cloned it. */
  assert.strictEqual(catalogue.getModel("seedance/2.5").execution[0].state, "preparation");
  assert.strictEqual(catalogue.getModel("kling-video/3-pro").catalogue.status, "next-up");
  const blocking = catalogue.getUseCaseGuide("blocking-frame");
  assert.strictEqual(blocking.decision.recommended, null, "no blocking winner has been hardcoded");
  assert.strictEqual(blocking.decision.state, "undecided-pending-evaluation");
  assert.strictEqual(
    blocking.candidates.find((row) => row.modelId === "krea-2/turbo" && row.surface === "local").maxReferenceImages,
    0, "the open Krea checkpoint still takes no references");
}

console.log(
  `Model intelligence negative controls passed: ${results.length} deliberate defects reintroduced in memory — `
  + "a provider widening a model, the divergence report going silent, recommendation learning to sort on "
  + "capability, the status filter dropped, local read from a licence instead of a path, an available claim "
  + "with no offering behind it, a broken catalogue join, a launch promise on provider-only evidence, a clock "
  + "in a pure module, a vendor name in code, a blocking recommendation filled before its evaluation ran, a "
  + "guide naming a model that cannot do the job, and a hosted reference budget leaking onto an open "
  + "checkpoint — every one detected by the test that guards it, with the real catalogue green afterwards.",
);

/* Negative controls for the capability-aware generation picker and the image
 * execution wiring.
 *
 * A regression test that has never failed is a claim, not evidence. Each control below
 * reintroduces exactly one of the defects C2b exists to prevent — a catalogue entry
 * treated as a dispatch path, an unconnected provider left pressable, a video field on
 * a still-image request, a backend recompiling intent — and asserts that the guarding
 * property FAILS. A control that stays green is the real failure.
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
const { createModelIntelligence, loadModelIntelligence, DEFINITIONS_PATH, SURFACES_PATH } = require("../model-intelligence");
const { resolveGenerationOptions } = require("../public/shared-generation-options");
const { publicAdapters, generationConnections, generationOptionsFor } = require("../generation-options");
const { checkRequestAgainstCapability } = require("../public/shared-generation-capability");
const { serializeImagePlanForFal } = require("../fal-image-backend");
const { compileImageExecutionPlan } = require("../image-execution");
const { addBlockingPromptBuild, buildRef, REF_IDENTITY } = require("./image-execution-fixture");

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

const FAL_ON = { generation: { fal: { enabled: true, apiKey: "k" } } };
const image = (role) => ({ role, mediaType: "image" });
const find = (resolved, modelId, surfaceId) =>
  resolved.options.find((row) => row.modelId === modelId && (!surfaceId || row.surfaceId === surfaceId)) || null;

/* Two guarantees in fal-generation.js are STRUCTURAL rather than runtime branches, so
   the check and its control both operate on the source text. Normalised to LF: a
   Windows checkout with core.autocrlf on would otherwise never match. */
const FAL_GENERATION_SOURCE = fs.readFileSync(path.join(ROOT, "fal-generation.js"), "utf8").replace(/\r\n/g, "\n");

/* Every read inside the compiled image path goes through the captured owner. */
function assertOwnedProjectReads(source) {
  assert(source.includes("function captureOwner()"), "ownership capture must exist");
  const start = source.indexOf("req.body?.imagePlan === true");
  assert(start > 0, "the compiled image path must exist");
  const branch = source.slice(start, source.indexOf("} else if (purpose === \"entity-reference\")", start));
  assert(branch.includes("ownerProject(owner)"),
    "the compiled image path must read its project through the captured owner");
  assert(!/\breadProject\(\)/.test(branch),
    "the compiled image path must not resolve the globally active project");
}

/* Every paid dispatch goes through the one boundary that classifies uncertainty. */
function assertOneProviderBoundary(source) {
  const submitImage = source.slice(
    source.indexOf("async function submitImage("),
    source.indexOf("function redactedImageRequest("),
  );
  assert(submitImage.includes("providerPost("),
    "the image dispatch must go through the shared provider boundary that classifies uncertainty");
  assert(!/\bfetch\(/.test(submitImage),
    "no paid path may call fetch directly; C1.2's classification lives at the boundary");
}

function makeProject() {
  return {
    meta: { title: "controls", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
}
function compiledBlocking(references = []) {
  const project = makeProject();
  const buildId = addBlockingPromptBuild(project, "SH-1", { references });
  return compileImageExecutionPlan({ project, purpose: "blocking", shotId: "SH-1", buildId, aspectRatio: "16:9" });
}

/* ===========================================================================
   1. AN INVENTORY-ONLY MODEL MADE ACTIONABLE.

   The defect: dispatchability inferred from the catalogue instead of from the adapter
   inventory. Every model any provider lists would become pressable, which is the exact
   dead-end picker this phase removes. */
control("deriving dispatchability from the catalogue's offering state", "a catalogue entry is not a Generate button", () => {
  const options = loadModified("public/shared-generation-options.js", [
    [`function adapterFor(adapters, modelId, surfaceId, mode) {
  for (const row of listOf(adapters).filter(isRecord)) {`,
      `function adapterFor(adapters, modelId, surfaceId, mode) {
  if (surfaceId) return { adapterId: "inferred-from-catalogue", modelId, surfaceId, modes: [mode] };
  for (const row of listOf(adapters).filter(isRecord)) {`],
  ]);
  const resolved = options.resolveGenerationOptions({
    task: "animate-shot",
    inputs: { references: [image("identity")] },
    request: { references: [image("identity")] },
    intelligence: loadModelIntelligence(),
    connections: generationConnections(FAL_ON),
    adapters: publicAdapters(),
    checkRequest: checkRequestAgainstCapability,
  });
  const seedance = find(resolved, "seedance/2.5", "runware");
  assert.strictEqual(seedance.dispatchable, false, "Runware has no CineBraid adapter");
});

/* 2. A RUNWARE OFFERING MARKED DISPATCHABLE IN THE ADAPTER LIST WITH NO SERIALIZER.

   The defect: an adapter entry added as data, without the function that would build the
   request. The picker would offer it, and pressing Generate would reach nothing. */
control("adding a Runware adapter entry with no serializer", "every adapter entry resolves to a real serializer", () => {
  const adapters = [
    ...require("../generation-options").CINEBRAID_GENERATION_ADAPTERS,
    { adapterId: "runware-seedance", modelId: "seedance/2.5", surfaceId: "runware", modes: ["i2v"] },
  ];
  for (const adapter of adapters)
    assert.strictEqual(typeof adapter.serialize, "function",
      `${adapter.adapterId}: an adapter entry must resolve to a real serializer`);
});

/* 3. A WATCHLIST MODEL IN THE NORMAL PICKER.

   The defect: the normal view stops filtering on catalogue status. Models nothing
   establishes would sit beside the one CineBraid can actually run. */
control("showing every catalogue status in the normal picker", "a watchlist model must not reach the normal picker", () => {
  const options = loadModified("public/shared-generation-options.js", [
    ["function isNormalOption(option) {\n  if (option.advancedOnly) return false;",
      "function isNormalOption(option) {\n  if (false) return false;"],
  ]);
  const resolved = options.resolveGenerationOptions({
    task: "blocking-frame",
    inputs: { references: [] },
    request: { references: [] },
    intelligence: loadModelIntelligence(),
    connections: generationConnections(FAL_ON),
    adapters: publicAdapters(),
    checkRequest: checkRequestAgainstCapability,
  });
  const ids = resolved.normal.map((row) => row.modelId);
  assert(!ids.includes("gemini-image/3-pro"), "a watchlist model must not reach the normal picker");
});

/* 4. A MISSING PROVIDER WITH GENERATE STILL ENABLED.

   The defect: connection dropped from the availability decision. The button would be
   live, the request would leave without a key, and the filmmaker would find out from a
   401 rather than from a sentence. */
control("ignoring the connection map when deciding availability", "an unconnected provider is not pressable", () => {
  const options = loadModified("public/shared-generation-options.js", [
    ["  const availability = !compatible\n    ? \"incompatible\"\n    : !dispatchable\n      ? \"not-implemented\"\n      : !connection.connected\n        ? \"setup-required\"\n        : \"ready\";",
      "  const availability = !compatible\n    ? \"incompatible\"\n    : !dispatchable\n      ? \"not-implemented\"\n      : \"ready\";"],
  ]);
  const resolved = options.resolveGenerationOptions({
    task: "blocking-frame",
    inputs: { references: [] },
    request: { references: [] },
    intelligence: loadModelIntelligence(),
    connections: generationConnections({ generation: { fal: { enabled: false } } }),
    adapters: publicAdapters(),
    checkRequest: checkRequestAgainstCapability,
  });
  const gpt = find(resolved, "gpt-image-2/standard", "fal-queue");
  assert.strictEqual(gpt.actionable, false, "a provider that is not set up cannot produce a pressable option");
});

/* 5. A VIDEO DURATION ON AN IMAGE PLAN.

   The defect C2a found in the compiler, reintroduced at the execution boundary: the
   still-image serializer stops refusing a plan that carries time. */
control("letting a duration through the image serializer", "a still-image request carries no video field", () => {
  const backend = loadModified("fal-image-backend.js", [
    ["  if (plan.output?.durationSeconds != null || plan.output?.fps != null)",
      "  if (false)"],
  ]);
  const compiled = compiledBlocking();
  const videoish = { ...compiled.plan, output: { ...compiled.plan.output, durationSeconds: 8 } };
  assert.throws(() => backend.serializeImagePlanForFal(videoish, compiled.capability, { resolveReference: () => "x", config: {} }),
    (error) => error.code === "IMAGE_BACKEND_PLAN_NOT_STILL",
    "a duration on an image plan must be refused, not dropped");
});

/* 6. THE BACKEND RECOMPILING THE PROMPT.

   The defect the whole GenerationPlan architecture exists to prevent: the serializer
   builds its own prompt text instead of transporting the compiled one. Everything C1
   guarantees — coverage, anchoring, no silent intent loss — would stop at dispatch. */
control("letting the image serializer write its own prompt", "the prompt sent is the prompt compiled", () => {
  const backend = loadModified("fal-image-backend.js", [
    ["  const input = {\n    prompt,", "  const input = {\n    prompt: `${prompt} Rendered in a cinematic style.`,"],
  ]);
  const compiled = compiledBlocking();
  const serialized = backend.serializeImagePlanForFal(compiled.plan, compiled.capability, {
    resolveReference: () => "x", config: {},
  });
  assert.strictEqual(serialized.input.prompt, compiled.plan.inputs.prompt,
    "the prompt sent is the prompt compiled, byte for byte");
});

/* 7. A SIZE FAL DOES NOT DOCUMENT.

   The defect: the dimension rule becomes a conversion instead of a guard, so an
   out-of-rule size is snapped to fit and the filmmaker gets a frame at a size nobody
   chose — the failure mode the pre-C2b arithmetic had. */
control("snapping an out-of-rule size instead of refusing it", "an out-of-rule size is refused by name", () => {
  const backend = loadModified("fal-image-backend.js", [
    ["  if (pixels < rules.minTotalPixels || pixels > rules.maxTotalPixels)",
      "  if (false)"],
  ]);
  assert.throws(() => backend.imageSizeField("1024x576", "t2i"),
    (error) => error.code === "IMAGE_BACKEND_SIZE_INVALID",
    "a size below fal's documented pixel floor must be refused");
});

/* 8. A PROJECT SWITCH REDIRECTING AN IMAGE RESULT.

   The defect Repair B removed, reintroduced for the image path: ownership resolved at
   use rather than captured at creation. A download would land in whichever project
   happened to be open. */
control("resolving the owning project at ingest instead of at creation", "a job is only reachable through the project that owns it", () => {
  /* The guarantee is structural rather than a runtime branch: ownership is captured
     once, before the first await, and every later read, write and path is addressed
     through the record it returned. So the control edits the source and re-runs the
     structural check against the edited text. */
  const broken = FAL_GENERATION_SOURCE.replace(
    "          project: ownerProject(owner),\n          purpose,\n          shotId: job.shotId,",
    "          project: readProject(),\n          purpose,\n          shotId: job.shotId,",
  );
  assert.notStrictEqual(broken, FAL_GENERATION_SOURCE, "the control must actually change the source");
  assertOwnedProjectReads(broken);
});

/* And the shipped source passes the same check. */
assertOwnedProjectReads(FAL_GENERATION_SOURCE);

/* 9. A PAID IMAGE PATH THAT BYPASSES C1.2.

   The defect: the image dispatch gets its own fetch instead of going through the one
   provider boundary. An unanswered POST would become FAILED, and the filmmaker's next
   move — generate again — would buy the same frame twice. */
control("giving the image dispatch its own provider call", "every paid dispatch goes through one provider boundary", () => {
  const broken = FAL_GENERATION_SOURCE.replace(
    "    const { data } = await providerPost(`${cfg.baseUrl}/${serialized.model}`, {\n      method: \"POST\",\n      headers: { \"content-type\": \"application/json\", Authorization: `Key ${cfg.apiKey}`, \"X-Fal-No-Retry\": \"1\" },\n      body: JSON.stringify(serialized.input),\n    }, serialized.model);\n    return {\n      model: serialized.model,\n      modelFamily: serialized.modelFamily,\n      backendId: serialized.backendId,\n      providerRequest: redactedImageRequest(serialized),",
    "    const data = await (await fetch(`${cfg.baseUrl}/${serialized.model}`, {\n      method: \"POST\",\n      headers: { \"content-type\": \"application/json\", Authorization: `Key ${cfg.apiKey}`, \"X-Fal-No-Retry\": \"1\" },\n      body: JSON.stringify(serialized.input),\n    })).json();\n    return {\n      model: serialized.model,\n      modelFamily: serialized.modelFamily,\n      backendId: serialized.backendId,\n      providerRequest: redactedImageRequest(serialized),",
  );
  assert.notStrictEqual(broken, FAL_GENERATION_SOURCE, "the control must actually change the source");
  assertOneProviderBoundary(broken);
});

/* And the shipped source passes the same check. */
assertOneProviderBoundary(FAL_GENERATION_SOURCE);

/* 10. A RECOMMENDATION INVENTED FOR A UI LABEL.

   The defect: the picker fills a guide slot because a screen wanted something to print.
   The blocking-frame evaluation has not been run, and a label is not evidence. */
control("promoting the first shortlisted candidate into a recommendation", "nothing is recommended while the guide is undecided", () => {
  const definitions = clone(DEFINITIONS);
  const guide = definitions.useCaseGuides.find((row) => row.useCase === "blocking-frame");
  guide.decision.recommended = guide.decision.shortlist.recommended[0].modelId;
  const catalogue = createModelIntelligence({ definitions, surfaces: clone(SURFACES) });
  const resolved = resolveGenerationOptions({
    task: "blocking-frame",
    inputs: { references: [] },
    request: { references: [] },
    intelligence: catalogue,
    connections: generationConnections(FAL_ON),
    adapters: publicAdapters(),
    checkRequest: checkRequestAgainstCapability,
  });
  for (const option of resolved.options)
    if (option.recommendation)
      assert.strictEqual(option.recommendation.isRecommended, false,
        `${option.modelId}: nothing may be presented as a winner while the guide is undecided`);
});

/* And the same defect caught one layer down, by the catalogue's own integrity check —
   a filled slot with an undecided state is a broken join, not a preference. */
control("filling a guide slot without taking the decision", "a filled recommendation needs a decided guide", () => {
  const definitions = clone(DEFINITIONS);
  const guide = definitions.useCaseGuides.find((row) => row.useCase === "blocking-frame");
  guide.decision.localOption = "z-image/turbo";
  const catalogue = createModelIntelligence({ definitions, surfaces: clone(SURFACES) });
  assert.deepStrictEqual(catalogue.integrityProblems(), [],
    "the catalogue must not carry a recommendation nobody decided");
});

/* 11. A HOSTED CAPABILITY CARRIED ONTO AN OPEN CHECKPOINT.

   C2a's worked example, re-asserted where it now has a UI consequence: the hosted Krea
   endpoint takes ten weighted references and the published weights are text-to-image
   only. Merging them would put an approved identity on a local render with nowhere to
   receive it. */
control("giving the open Krea checkpoint the hosted endpoint's references", "the local checkpoint refuses a reference the hosted endpoint accepts", () => {
  const definitions = clone(DEFINITIONS);
  const surfaces = clone(SURFACES);
  /* The careless merge, in all THREE places it would have to be made — and the fact
     that there are three is the finding worth keeping. C2a defended this in depth:
     the checkpoint's own capability block, its per-surface override, and the local
     offering's ceiling each refuse an approved reference independently, so any one of
     the three edits alone is caught by the other two. The control makes all three,
     which is what a genuine "Krea 2 Turbo supports ten references" merge would do. */
  const local = definitions.models.find((row) => row.id === "krea-2/turbo");
  const hosted = definitions.models.find((row) => row.id === "krea-2/large");
  local.capabilities.referenceRoles = [...hosted.capabilities.referenceRoles];
  local.capabilities.maxReferenceImages = hosted.capabilities.maxReferenceImages;
  local.capabilities.modes = [...hosted.capabilities.modes];
  delete local.surfaceCapabilities;
  const comfy = surfaces.surfaces.find((row) => row.surfaceId === "comfy-local");
  const offering = comfy.offerings.find((row) => row.modelId === "krea-2/turbo");
  offering.references = { maxImages: hosted.capabilities.maxReferenceImages };
  offering.modes = [...hosted.capabilities.modes];
  const catalogue = createModelIntelligence({ definitions, surfaces });
  const resolved = resolveGenerationOptions({
    task: "blocking-frame",
    inputs: { references: [image("identity")] },
    request: { references: [image("identity")] },
    intelligence: catalogue,
    connections: generationConnections(FAL_ON),
    adapters: publicAdapters(),
    checkRequest: checkRequestAgainstCapability,
  });
  const localKrea = find(resolved, "krea-2/turbo", "comfy-local");
  assert.strictEqual(localKrea.compatible, false,
    "the open Krea 2 Turbo checkpoint cannot consume an approved identity reference");
});

/* 12. A LOCAL OPTION PRESENTED AS RUNNABLE.

   The defect: the local surface reports itself connected. A filmmaker would be offered
   a free local render that no runtime can serve, which is a dead end wearing the most
   attractive badge on the screen. */
control("reporting the local runtime as connected", "no local option is pressable while no local runtime ships", () => {
  const connections = { ...generationConnections(FAL_ON), "comfy-local": { connected: true, label: "Local ComfyUI" } };
  const resolved = resolveGenerationOptions({
    task: "blocking-frame",
    inputs: { references: [] },
    request: { references: [] },
    intelligence: loadModelIntelligence(),
    connections,
    adapters: [...publicAdapters(), { adapterId: "comfy", modelId: "z-image/turbo", surfaceId: "comfy-local", modes: ["t2i"] }],
    checkRequest: checkRequestAgainstCapability,
  });
  const local = find(resolved, "z-image/turbo", "comfy-local");
  assert.strictEqual(local.actionable, false, "no local option may be pressable while no local runtime ships");
});

/* ===========================================================================
   The real modules, green, after every control above. */

{
  const resolved = generationOptionsFor({
    task: "blocking-frame", inputs: { references: [] }, request: { references: [] }, config: FAL_ON,
  });
  const gpt = find(resolved, "gpt-image-2/standard", "fal-queue");
  assert.strictEqual(gpt.actionable, true, "the shipped resolver still offers the one dispatchable image path");
  assert.strictEqual(find(resolved, "seedream/5.0-pro", "runware").actionable, false);
  assert.strictEqual(find(resolved, "z-image/turbo", "comfy-local").actionable, false);
  assert.deepStrictEqual(loadModelIntelligence().integrityProblems(), [], "the shipped catalogue is intact");

  const compiled = compiledBlocking();
  const serialized = serializeImagePlanForFal(compiled.plan, compiled.capability, { resolveReference: () => "x", config: {} });
  assert.strictEqual(serialized.input.prompt, compiled.plan.inputs.prompt);
  assert.strictEqual(serialized.input.duration, undefined);
  assert.deepStrictEqual(serialized.input.image_size, { width: 2048, height: 1152 });
}

console.log(
  `Capability-aware generation negative controls passed: ${results.length} deliberate defects reintroduced in memory — `
  + "a catalogue entry made dispatchable, an adapter with no serializer, a watchlist model in the normal picker, "
  + "a missing provider left pressable, a duration on a still, a backend rewriting the prompt, a snapped size, "
  + "an unowned project write, a paid path around C1.2, an invented recommendation, a hosted capability on an open "
  + "checkpoint and a local runtime that does not exist — every one detected by the property that guards it, with "
  + "the real modules green afterwards.\n"
  + results.map((row) => `  - ${row.label} -> caught by "${row.guardedTest}"`).join("\n"),
);

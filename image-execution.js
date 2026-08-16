/* GPT Image 2 execution wiring.
 *
 * The single place a live still-image request is compiled. Everything downstream —
 * the fal serializer, the durable job, the preview the filmmaker confirms — reads the
 * plan this module produces, and nothing downstream is given the material to compile
 * a second one.
 *
 *     durable prompt build (spec + approved references)
 *         -> generation-compiler + model-packs/gpt-image-2   (C1/C2a, unchanged)
 *         -> GenerationPlan
 *         -> validated against the plan contract
 *         -> effective capability = model ∩ fal image backend
 *
 * WHY THIS EXISTS. C2a shipped a GPT Image 2 model pack and nothing dispatched
 * through it. The live path built its own fal request from the job record: it took
 * the browser's finished prompt string, derived pixel dimensions from an aspect ratio
 * and a "1k" long edge, and posted the result. That is the shape C1 exists to
 * remove — shot -> backend-specific compiler -> provider — and it produced request
 * sizes outside the ones fal documents, 1024x576 among them.
 *
 * Compiling from the stored provider-neutral spec is what makes the request
 * explainable: the same production state compiles to the same plan, here, in the
 * preview, and after a restart. The prompt build is the durable record of that
 * state — it has carried `spec` and `references` since guided frames shipped — so
 * nothing new has to be persisted and an existing project needs no migration.
 *
 * NO LLM. NO NETWORK. Compilation is the C1 compiler's, which is pure. This module
 * adds a project read, and nothing else.
 *
 * SCOPE. Two filmmaker tasks: create a blocking frame, and create or edit a frame.
 * Blocking REVISION, candidate correction and entity-reference generation still use
 * the pre-C2b path; they are named in the phase report rather than half-converted,
 * because a blocking revision compiled as an ordinary edit would write production
 * identity into a frame whose whole contract is that it carries none.
 */

const { resolvePromptBuild } = require("./public/shared-build-history");
const { compileValidatedGenerationPlan, checkPromptCoverage } = require("./generation-compiler");
const ImagePack = require("./model-packs/gpt-image-2");
const { resolveImageFalCapability, FAL_IMAGE_MODES } = require("./fal-image-backend");

/* Registering the pack is a side effect of requiring it; naming it here makes the
   dependency explicit rather than incidental. */
const IMAGE_PACK_ID = ImagePack.PACK_ID;
const IMAGE_MODEL_ID = "gpt-image-2/standard";

/* The filmmaker tasks this module compiles, and the CineBraid modes each can become.
   A task is not a mode: "Create frame" is t2i with nothing attached, multi-reference
   with approved references, and edit when one of them is the frame being changed. */
const IMAGE_TASK_PURPOSES = { blocking: "blocking", frame: "frame" };

class ImageExecutionError extends Error {
  constructor(code, message, detail = {}, status = 400) {
    super(message);
    this.name = "ImageExecutionError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

function text(value) {
  return String(value == null ? "" : value).trim();
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/* ---------------------------------------------------------------------------
   Source intent.

   Read, never rebuilt. The build the filmmaker looked at when they pressed Generate
   is the build that compiles, so a shot edited in another tab between building and
   submitting cannot change what was approved without the build changing too.

   CONTAINMENT. A build id is only usable through the shot that owns it. Blocking
   builds are stored inline on the shot; frame builds live in the project-wide store
   and are REFERENCED from the shot. Resolving straight out of the store would let
   one shot's request compile another shot's approved package, so every candidate
   entry is gathered from this shot first and resolved second. */
function shotBuildEntries(shot, purpose) {
  const brief = isRecord(shot.creationBrief) ? shot.creationBrief : {};
  if (purpose === "blocking") return listOf(brief.blockingBuilds);
  const entries = [...listOf(brief.promptBuilds), ...listOf(shot.promptBuilds)];
  const workflows = isRecord(brief.frameWorkflows) ? brief.frameWorkflows : {};
  for (const workflow of Object.values(workflows))
    if (isRecord(workflow)) entries.push(...listOf(workflow.promptBuilds));
  for (const frame of listOf(shot.keyframes))
    if (isRecord(frame)) entries.push(...listOf(frame.generationPackages));
  return entries;
}

function readSourceIntent(project, shotId, buildId, purpose) {
  const shot = listOf(project?.shots).find((row) => text(row?.id) === text(shotId));
  if (!shot)
    throw new ImageExecutionError("IMAGE_SHOT_NOT_FOUND", "That shot no longer exists in this project.", { shotId }, 404);

  const entries = shotBuildEntries(shot, purpose);
  const resolved = entries.map((entry) => resolvePromptBuild(project, entry)).filter(isRecord);
  const usable = resolved.filter((build) => !build.missing);
  const build = buildId
    ? usable.find((row) => [text(row.id), text(row.buildId), text(row.packageId)].includes(text(buildId)))
    : usable[usable.length - 1];
  if (!build)
    throw new ImageExecutionError(
      "IMAGE_BUILD_NOT_FOUND",
      buildId
        ? "That prompt package is not on this shot any more. Rebuild the prompt before generating."
        : `Build a ${purpose === "blocking" ? "blocking" : "frame"} prompt before generating.`,
      { shotId, buildId },
      404,
    );
  if (!isRecord(build.spec))
    /* An older build predates structured spec storage. It cannot be compiled, and
       guessing a spec back out of its finished prompt would be exactly the second
       compilation this layer exists to remove. */
    throw new ImageExecutionError(
      "IMAGE_SPEC_MISSING",
      "This prompt package was built before CineBraid stored structured shot direction, so it cannot be compiled for generation. Rebuild the prompt on this shot and generate from the new package.",
      { shotId, buildId: build.id || buildId },
    );
  return { shot, build };
}

/* Approved references, in the order the build recorded them. Reference SELECTION is
   a production decision made before this point; nothing here adds, drops or reorders
   one. The planner applies the canonical ordering, and the pack applies the limits. */
function buildReferences(build) {
  return listOf(build.references)
    .filter((row) => isRecord(row) && text(row.url))
    .map((row, index) => ({
      refId: text(row.key) || text(row.token) || `ref-${index + 1}`,
      role: text(row.role) || "reference",
      mediaType: text(row.mediaType).toLowerCase() || "image",
      label: text(row.label || row.name),
      entityId: text(row.entityId),
      entityName: text(row.entityName),
      entityType: text(row.entityType),
      instruction: text(row.instruction),
      continuityState: text(row.continuityState || row.stateName),
      /* The address the bytes live at. It is not model-facing and never reaches the
         prompt; the fal serializer turns it into something the provider can fetch. */
      path: text(row.url),
      order: index,
    }));
}

/* WHICH MODE THIS IS, decided from what the package actually carries rather than
   from a client-declared string. A blocking package is blocking. A frame package
   with the frame it is changing attached is an edit, and one with a mask beside it
   is an inpaint; with approved references and no plate it is multi-reference, and
   with nothing at all it is text-to-image.

   Deciding here rather than in the browser is what makes the preview and the
   dispatch the same request: both call this function with the same package. */
function resolveImageMode(purpose, references) {
  if (purpose === "blocking") return "blocking";
  const roles = new Set(references.map((row) => text(row.role)));
  if (roles.has("mask")) return "inpaint";
  if (roles.has("base")) return "edit";
  if (references.length) return "multi-reference";
  return "t2i";
}

/* ---------------------------------------------------------------------------
   Compilation.

   One call, one plan. The preview route and the submit route both come through here,
   and because the compiler is deterministic they get the same answer — which is what
   lets a filmmaker confirm a prompt and know it is the prompt that will be sent. */
function compileImageExecutionPlan(request = {}) {
  const project = isRecord(request.project) ? request.project : null;
  if (!project) throw new ImageExecutionError("IMAGE_PROJECT_MISSING", "No project was supplied.", {}, 500);

  const purpose = IMAGE_TASK_PURPOSES[text(request.purpose)] || "frame";
  const { shot, build } = readSourceIntent(project, text(request.shotId), text(request.buildId), purpose);
  const references = buildReferences(build);
  const mode = resolveImageMode(purpose, references);
  if (!FAL_IMAGE_MODES.includes(mode))
    throw new ImageExecutionError(
      "IMAGE_MODE_UNSUPPORTED",
      `CineBraid cannot dispatch GPT Image 2 ${mode || "generation"} through fal.`,
      { mode, supported: FAL_IMAGE_MODES },
    );

  const surface = text(request.surface) || "api";
  const capability = resolveImageFalCapability(mode, ImagePack.capabilityLayer(mode, surface));

  /* Output settings the filmmaker chose in the generation dialog, applied to a COPY
     of the stored spec. The durable package is production state and is never edited
     by a dispatch. A still image has no duration whatever the shot's length is, and
     the compiler already refuses to seed one onto an image plan's output block —
     this deletes it from the spec too, so the intent inventory records the shot's
     length as omitted-by-design rather than silently carrying it. */
  const spec = { ...build.spec, shotId: text(build.spec.shotId) || text(shot.id) };
  const requestedAspect = text(request.aspectRatio);
  if (requestedAspect) spec.aspectRatio = requestedAspect;

  const requestedCount = Number(request.candidateCount);
  const candidateCount = Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : 1;

  const { plan, validation } = compileValidatedGenerationPlan({
    mode,
    modelId: IMAGE_MODEL_ID,
    surface,
    spec,
    references,
    capability,
    outputType: "image",
    resolution: text(request.resolution),
    quality: text(request.quality),
    candidateCount,
    target: {
      kind: purpose === "blocking" ? "shot-blocking" : "shot-frame",
      shotId: text(shot.id),
      purpose,
      ...(text(build.frameId) ? { frameId: text(build.frameId) } : {}),
    },
    /* Seed stays exactly as C1 left it: offered only where the resolved capability
       accepts one. Neither OpenAI nor fal documents a GPT Image 2 seed, so this
       refuses and warns rather than inventing a number. */
    ...(request.seed != null && request.seed !== "" ? { seed: request.seed } : {}),
  });
  if (!validation.ok)
    throw new ImageExecutionError(
      "IMAGE_PLAN_INVALID",
      "CineBraid could not compile a valid GPT Image 2 request from this shot. Nothing was sent and nothing was charged.",
      { errors: validation.errors },
    );

  const compiledPrompt = plan.inputs.prompt;
  /* A manual edit replaces the TEXT and nothing else. It is recorded beside the
     compiled prompt rather than in place of it, so a reviewer can always see both
     what CineBraid wrote and what the filmmaker chose to send. */
  const edited = typeof request.submittedPrompt === "string" ? request.submittedPrompt.trim() : "";
  const submittedPrompt = edited || compiledPrompt;
  const promptEdited = submittedPrompt !== compiledPrompt;
  /* The plan's coverage describes what the COMPILER wrote, and it stays that way.
     When the text sent is not the text compiled, the same deterministic check is
     re-run over the submitted words so the record cannot claim an intent is in a
     prompt it is no longer in. Nothing is refused on this basis — the words are the
     filmmaker's — but the difference is recorded rather than absorbed. */
  const editedCoverage = promptEdited
    ? checkPromptCoverage({ spec, references, coverage: plan.coverage }, submittedPrompt)
    : null;

  const extensions = plan.settings?.extensions?.[IMAGE_MODEL_ID] || {};
  return {
    plan,
    capability,
    validation,
    /* The rows the plan was compiled FROM. The plan keeps ids out of a reference's
       production block by contract, so the dispatcher reads a reference's entityId here
       rather than parsing it back out of a label or a key. */
    sourceReferences: references,
    mode,
    purpose,
    modelId: IMAGE_MODEL_ID,
    surface,
    profile: {
      id: text(build.profileId),
      name: text(build.profileName) || text(build.profileId),
      mode,
      family: "gpt-image-2",
      version: text(build.profileVersion),
    },
    source: {
      shotId: text(shot.id),
      buildId: text(build.id || build.buildId || request.buildId),
      packageId: text(build.packageId),
      frameId: text(build.frameId),
      frameLabel: text(build.frameLabel),
      builtAt: text(build.date),
    },
    compiledPrompt,
    submittedPrompt,
    promptEdited,
    editedCoverage,
    /* What the plan will actually ask fal for, surfaced so a dialog can show it
       without reading inside settings.extensions. */
    size: text(extensions.size),
    quality: text(extensions.quality),
    candidateCount,
    aspectRatio: text(spec.aspectRatio || spec.world?.aspectRatio),
    /* The MODEL's own limits, carried alongside the effective ones so a screen can
       name which layer narrowed what without hard-coding either number. */
    model: {
      sizes: ImagePack.GPT_IMAGE_2_FACTS.sizes,
      qualityTiers: ImagePack.GPT_IMAGE_2_FACTS.qualityTiers,
      maxReferenceImages: ImagePack.GPT_IMAGE_2_FACTS.maxReferenceImages,
      maxPromptCharacters: ImagePack.GPT_IMAGE_2_FACTS.maxPromptCharacters,
    },
  };
}

/* The durable provenance a job keeps.
 *
 * Enough to answer, months later and without the project open: what did CineBraid
 * compile, which compiler and pack version produced it, what prompt was used, which
 * references were selected and what each one was FOR, which model and backend were
 * chosen, what settings were asked for, what the configuration refused, and what was
 * actually sent.
 *
 * The same shape planProvenance() produces for MiniMax H3, deliberately: a support
 * bundle that has to know which modality a job was before it can read its provenance
 * is a support bundle nobody reads. */
function imagePlanProvenance(compiled) {
  const { plan, capability } = compiled;
  return {
    plan,
    surface: compiled.surface,
    source: compiled.source,
    profile: compiled.profile,
    compiledPrompt: compiled.compiledPrompt,
    compiledPromptCharacters: compiled.compiledPrompt.length,
    ...(compiled.editedCoverage ? { editedCoverage: compiled.editedCoverage } : {}),
    capability: {
      layers: capability.layers,
      modes: capability.modes,
      resolutions: capability.resolutions,
      aspectRatios: capability.aspectRatios,
      maxPromptCharacters: capability.maxPromptCharacters,
      maxReferenceImages: capability.maxReferenceImages,
      maxReferenceVideos: capability.maxReferenceVideos,
      maxReferenceAudio: capability.maxReferenceAudio,
      flags: capability.flags,
      blockedBy: capability.blockedBy,
    },
  };
}

module.exports = {
  IMAGE_MODEL_ID,
  IMAGE_PACK_ID,
  IMAGE_TASK_PURPOSES,
  ImageExecutionError,
  buildReferences,
  compileImageExecutionPlan,
  imagePlanProvenance,
  readSourceIntent,
  resolveImageMode,
};

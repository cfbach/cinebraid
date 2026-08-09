/* The fal backend for GPT Image 2.
 *
 * The still-image sibling of fal-h3-backend.js, and separate from
 * model-packs/gpt-image-2.js for the same reason that file is separate from the H3
 * pack:
 *
 *     model-packs/gpt-image-2.js   what GPT Image 2 objectively is, from OpenAI's
 *                                  own model page and image guide.
 *     fal-image-backend.js         what fal's queue accepts, from fal's own schema.
 *
 * The divergence that made this file necessary is not a rounding difference. fal's
 * custom `image_size` accepts any {width, height} that satisfies four rules — both
 * edges a multiple of 16, longest edge at most 3840, aspect ratio at most 3:1, and a
 * TOTAL PIXEL COUNT between 655,360 and 8,294,400. CineBraid's pre-C2b image path
 * derived its own dimensions from an aspect ratio and a "1k" long edge, so a 16:9
 * frame at the default resolution asked for 1024x576 — 589,824 pixels, under fal's
 * documented floor, on the most common format in the product. It also asked for a
 * 4096px long edge at "4k", above fal's documented 3840 ceiling.
 *
 * Whether fal enforces either rule in practice is NOT established: that path ships
 * and generates, so something upstream is evidently tolerant, and finding out costs
 * a paid render. What is established is that CineBraid was asking for sizes the
 * provider does not document, which is a thing to stop doing whether or not it has
 * been caught. Every one of OpenAI's documented named sizes satisfies all four rules,
 * so the fix is not better arithmetic: it is to send the sizes the model actually
 * documents, which is what the model pack has computed since C2a and what this
 * serializer transports. The rules are enforced here as a guard rather than as a
 * conversion — nothing is snapped to fit, and an out-of-rule size is refused by name
 * before anything is charged.
 *
 * The serializer's input is a compiled GenerationPlan and a resolved capability, and
 * NOTHING else: no shot, no spec, no project, no profile. It cannot re-read
 * filmmaking intent because it is never handed any. It renames fields, chooses an
 * endpoint and resolves reference bytes — transport, and only transport.
 */

const {
  CINEBRAID_REFERENCE_ROLES,
  resolveCapability,
} = require("./public/shared-generation-capability");

/* ===========================================================================
   A. VERIFIED BACKEND FACTS

   Read from fal's own published endpoint schema on the date below. Where fal
   documents nothing the field says so rather than inheriting the model's answer. */
const FAL_IMAGE_BACKEND = {
  backendId: "fal-queue",
  checkedOn: "2026-08-09",
  evidence: [
    { id: "fal-gpt-image-2-schema", url: "https://fal.ai/models/openai/gpt-image-2/api", checkedOn: "2026-08-09" },
    { id: "fal-gpt-image-2-edit-schema", url: "https://fal.ai/models/openai/gpt-image-2/edit/api", checkedOn: "2026-08-09" },
  ],

  /* Which fal endpoint serves which CineBraid mode.
     There are only two, and the split is not by "is this an edit" but by whether the
     endpoint HAS an image input at all: fal's text-to-image route carries no
     image_urls field, so every mode that sends a reference — including
     multi-reference, which nobody would call an edit — goes through /edit. Choosing
     by role rather than by counting the array is what stops a reference-guided frame
     from being posted to a route with nowhere to put the reference. */
  endpoints: {
    t2i: { configKey: "textModel", defaultModel: "openai/gpt-image-2", carriesImages: false, carriesMask: false },
    blocking: { configKey: "textModel", defaultModel: "openai/gpt-image-2", carriesImages: false, carriesMask: false },
    "multi-reference": { configKey: "editModel", defaultModel: "openai/gpt-image-2/edit", carriesImages: true, carriesMask: false },
    edit: { configKey: "editModel", defaultModel: "openai/gpt-image-2/edit", carriesImages: true, carriesMask: true },
    inpaint: { configKey: "editModel", defaultModel: "openai/gpt-image-2/edit", carriesImages: true, carriesMask: true },
  },

  /* fal's own dimension rules for a custom image_size. A RULE, not a legal-value
     grid — which is why nothing here declares a `resolutions` list and narrows the
     model's. A backend that has no fixed list imposes no list; it imposes a test,
     and the test is applied by the serializer where a refusal can name the number. */
  dimensionRules: {
    edgeMultiple: 16,
    maxEdge: 3840,
    maxLongToShortRatio: 3,
    minTotalPixels: 655360,
    maxTotalPixels: 8294400,
  },
  /* fal's named presets, kept for completeness. CineBraid does not send them: the
     model documents its own sizes and those are what a plan carries, so translating
     through a provider's alias would put a second naming scheme between the model
     and the request. `auto` is the exception — it is a genuine instruction rather
     than a size, and both the model and fal spell it the same way. */
  namedSizes: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9", "auto"],

  qualityTiers: ["auto", "low", "medium", "high"],
  outputFormats: ["png", "jpeg", "webp"],

  /* fal's edit schema documents "max 16 images", the same number OpenAI documents.
     No narrowing, and recording it anyway keeps this file an honest account of the
     backend rather than a filtered one. */
  maxReferenceImages: 16,
  /* One mask, and only on the edit route. */
  mask: { supported: true, field: "mask_url", maxCount: 1 },

  /* fal exposes no seed on either GPT Image 2 route, and neither does OpenAI. Seed
     is unsupported at both layers and the generic reproducibility architecture is
     left exactly as C1 built it — no invented field, no fabricated value. */
  seed: { supported: false, establishedBy: "absence-in-fal-endpoint-schema" },

  /* fal documents no maxLength on `prompt` for either route, and OpenAI's guide
     states no explicit prompt limit. An invented ceiling would silently cost a
     filmmaker the direction they wrote. */
  maxPromptCharacters: null,

  /* fal's schema types num_images as an integer with a default of 1 and publishes no
     ceiling. CineBraid's own dialog has offered 1-4 since image generation shipped
     and that stays a CineBraid choice, recorded here as such rather than presented
     as a provider limit. */
  candidateCount: { min: 1, max: 4, establishedBy: "cinebraid-product-choice" },
};

const FAL_IMAGE_MODES = Object.keys(FAL_IMAGE_BACKEND.endpoints);

/* ---------------------------------------------------------------------------
   The BackendCapability descriptor, in the shape the existing four-layer resolver
   already consumes. One layer of the intersection, never the whole answer. */
function falImageBackendLayer(mode) {
  const key = String(mode || "");
  const endpoint = FAL_IMAGE_BACKEND.endpoints[key];
  if (!endpoint) return { modes: [] };
  /* A backend constrains roles only by what it can carry BYTES for. Which reference
     means what is the model pack's and the planner's business; fal only knows
     whether this route has an array to put an image in and a slot for a mask. */
  const roles = endpoint.carriesImages
    ? CINEBRAID_REFERENCE_ROLES.filter((role) => (role === "mask" ? endpoint.carriesMask : true))
    : [];
  return {
    modes: [key],
    referenceRoles: roles,
    maxReferenceImages: endpoint.carriesImages ? FAL_IMAGE_BACKEND.maxReferenceImages : 0,
    /* No image route on any provider carries motion or sound. Stated rather than
       omitted, so a plan that somehow acquired one is refused by the intersection
       instead of by a surprise at dispatch. */
    maxReferenceVideos: 0,
    maxReferenceAudio: 0,
    flags: {
      mask: endpoint.carriesMask,
      seed: FAL_IMAGE_BACKEND.seed.supported,
      candidateBatching: true,
      firstFrame: false,
      lastFrame: false,
      nativeAudio: false,
    },
  };
}

/* Model ∩ backend, using the resolver that already exists rather than a second limit
   system. A node or a recipe layer slots in here unchanged when one exists. */
function resolveImageFalCapability(mode, modelLayer, extraLayers = {}) {
  return resolveCapability({ model: modelLayer, backend: falImageBackendLayer(mode), ...extraLayers });
}

/* ===========================================================================
   B. TYPED REFUSALS

   Every one happens BEFORE a paid request. The message is written for a filmmaker;
   `code` is what a screen or a test switches on. */
class FalImageBackendError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "FalImageBackendError";
    this.code = code;
    this.detail = detail;
    this.status = code === "IMAGE_BACKEND_SERIALIZATION_FAILED" ? 500 : 400;
  }
}

/* ===========================================================================
   C. THE SERIALIZER

   plan + capability -> fal request. No third argument carries intent. */

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function endpointFor(mode, config = {}) {
  const entry = FAL_IMAGE_BACKEND.endpoints[String(mode)];
  if (!entry)
    throw new FalImageBackendError(
      "IMAGE_BACKEND_MODE_UNSUPPORTED",
      `The fal backend has no GPT Image 2 endpoint for ${mode || "this mode"}.`,
      { mode, supported: FAL_IMAGE_MODES },
    );
  return String(config[entry.configKey] || entry.defaultModel);
}

/* The plan's own ordering, never the array's. `order` is what the planner computed
   and recorded, so two references that arrive in a different array order still
   serialize identically. */
function orderedReferences(plan) {
  return [...(Array.isArray(plan?.inputs?.references) ? plan.inputs.references : [])]
    .filter(isRecord)
    .sort((a, b) => {
      const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.refId) < String(b.refId) ? -1 : String(a.refId) > String(b.refId) ? 1 : 0;
    });
}

/* A documented model size becomes a provider dimension pair, and is checked against
   fal's four rules on the way. Reported by NAME and by NUMBER, because "1024x576 is
   589,824 pixels and fal's floor is 655,360" is something an operator can act on and
   "invalid image size" is not. */
function imageSizeField(size, mode) {
  const value = String(size || "").trim();
  if (!value || value === "auto") return "auto";
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (!match)
    throw new FalImageBackendError(
      "IMAGE_BACKEND_SIZE_INVALID",
      `CineBraid compiled an output size of "${value}", which is not a pixel size fal can be asked for.`,
      { size: value, mode },
    );
  const width = Number(match[1]);
  const height = Number(match[2]);
  const rules = FAL_IMAGE_BACKEND.dimensionRules;
  const pixels = width * height;
  const long = Math.max(width, height);
  const short = Math.min(width, height);

  if (width % rules.edgeMultiple || height % rules.edgeMultiple)
    throw new FalImageBackendError(
      "IMAGE_BACKEND_SIZE_INVALID",
      `fal renders GPT Image 2 at sizes whose edges are multiples of ${rules.edgeMultiple}; ${width}x${height} is not. Nothing was sent and nothing was charged.`,
      { size: value, width, height, rule: "edgeMultiple" },
    );
  if (long > rules.maxEdge)
    throw new FalImageBackendError(
      "IMAGE_BACKEND_SIZE_INVALID",
      `fal's longest edge for GPT Image 2 is ${rules.maxEdge}px; this asks for ${long}px.`,
      { size: value, width, height, rule: "maxEdge" },
    );
  if (short > 0 && long / short > rules.maxLongToShortRatio)
    throw new FalImageBackendError(
      "IMAGE_BACKEND_SIZE_INVALID",
      `fal renders GPT Image 2 no wider than ${rules.maxLongToShortRatio}:1; ${width}x${height} is wider than that.`,
      { size: value, width, height, rule: "maxLongToShortRatio" },
    );
  if (pixels < rules.minTotalPixels || pixels > rules.maxTotalPixels)
    throw new FalImageBackendError(
      "IMAGE_BACKEND_SIZE_INVALID",
      `fal renders GPT Image 2 between ${rules.minTotalPixels.toLocaleString()} and ${rules.maxTotalPixels.toLocaleString()} pixels; ${width}x${height} is ${pixels.toLocaleString()}. Choose a different output size — nothing was sent and nothing was charged.`,
      { size: value, width, height, pixels, rule: pixels < rules.minTotalPixels ? "minTotalPixels" : "maxTotalPixels" },
    );
  return { width, height };
}

function serializeImagePlanForFal(plan, capability, options = {}) {
  const { resolveReference, config = {}, promptOverride } = options;
  if (!isRecord(plan))
    throw new FalImageBackendError("IMAGE_PLAN_INVALID", "No compiled generation plan was supplied.");
  if (typeof resolveReference !== "function")
    throw new FalImageBackendError("IMAGE_BACKEND_SERIALIZATION_FAILED", "No reference resolver was supplied to the fal image serializer.");

  const mode = String(plan.mode || "");
  const endpoint = FAL_IMAGE_BACKEND.endpoints[mode];
  if (!endpoint)
    throw new FalImageBackendError(
      "IMAGE_BACKEND_MODE_UNSUPPORTED",
      `fal does not offer GPT Image 2 ${mode || "generation"} through CineBraid.`,
      { mode, supported: FAL_IMAGE_MODES },
    );
  if (Array.isArray(capability?.modes) && !capability.modes.includes(mode))
    throw new FalImageBackendError(
      "IMAGE_BACKEND_MODE_UNSUPPORTED",
      `This configuration cannot produce ${mode}.`,
      { mode, supported: capability.modes },
    );
  /* A still image plan that acquired a duration is a plan that came from somewhere
     else. Refused rather than sent with the field quietly dropped, because a request
     nobody can explain is worse than one that failed loudly. */
  if (plan.output?.durationSeconds != null || plan.output?.fps != null)
    throw new FalImageBackendError(
      "IMAGE_BACKEND_PLAN_NOT_STILL",
      "This plan carries a duration or a frame rate, so it is not a still-image request. Nothing was sent.",
      { durationSeconds: plan.output?.durationSeconds, fps: plan.output?.fps },
    );

  /* The prompt. `promptOverride` exists for exactly one reason — a filmmaker edited
     the compiled prompt before submitting — and it replaces the TEXT only. It cannot
     add a reference, change a size or reach any other field. */
  const compiledPrompt = typeof plan.inputs?.prompt === "string" ? plan.inputs.prompt : "";
  const prompt = typeof promptOverride === "string" ? promptOverride : compiledPrompt;
  if (!prompt.trim())
    throw new FalImageBackendError("IMAGE_PROMPT_EMPTY", "GPT Image 2 needs a prompt. Nothing was submitted.");
  const promptCeiling = Number.isFinite(Number(capability?.maxPromptCharacters))
    ? Number(capability.maxPromptCharacters)
    : null;
  if (promptCeiling && prompt.length > promptCeiling)
    /* Refused, never trimmed. A prompt cut to fit is a frame the filmmaker did not
       direct, delivered as though they had. */
    throw new FalImageBackendError(
      "IMAGE_PROMPT_OVER_LIMIT",
      `The prompt is ${prompt.length.toLocaleString()} characters; this configuration accepts ${promptCeiling.toLocaleString()}. Shorten it before submitting — nothing was sent and nothing was charged.`,
      { length: prompt.length, limit: promptCeiling },
    );

  const references = orderedReferences(plan);
  const extensions = isRecord(plan.settings?.extensions)
    ? plan.settings.extensions[String(plan.model?.modelId)] || {}
    : {};

  /* Size comes from the plan's compiled parameters, which the pack has already
     chosen from the model's documented list and warned about where the shot's format
     had no exact match. Re-deriving it from an aspect ratio here would be the second
     compilation this layer exists to prevent — and is precisely what produced a
     sub-minimum pixel count on every 16:9 frame. */
  const size = String(extensions.size || "");
  if (size && size !== "auto" && Array.isArray(capability?.resolutions) && !capability.resolutions.includes(size))
    throw new FalImageBackendError(
      "IMAGE_SIZE_UNSUPPORTED",
      `This configuration cannot render ${size}.`,
      { size, supported: capability.resolutions },
    );

  const quality = String(extensions.quality || "auto");
  if (!FAL_IMAGE_BACKEND.qualityTiers.includes(quality))
    throw new FalImageBackendError(
      "IMAGE_QUALITY_UNSUPPORTED",
      `fal accepts GPT Image 2 quality ${FAL_IMAGE_BACKEND.qualityTiers.join(", ")}; the plan asks for ${quality}.`,
      { quality, supported: FAL_IMAGE_BACKEND.qualityTiers },
    );

  const requestedCount = Number(plan.output?.candidateCount);
  const count = Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : 1;
  if (count > FAL_IMAGE_BACKEND.candidateCount.max)
    throw new FalImageBackendError(
      "IMAGE_CANDIDATE_COUNT_UNSUPPORTED",
      `CineBraid generates at most ${FAL_IMAGE_BACKEND.candidateCount.max} options per request; this plan asks for ${count}.`,
      { count, limit: FAL_IMAGE_BACKEND.candidateCount.max },
    );

  const format = String(config.outputFormat || "png");
  if (!FAL_IMAGE_BACKEND.outputFormats.includes(format))
    throw new FalImageBackendError(
      "IMAGE_FORMAT_UNSUPPORTED",
      `fal writes GPT Image 2 output as ${FAL_IMAGE_BACKEND.outputFormats.join(", ")}; this installation asks for ${format}.`,
      { format, supported: FAL_IMAGE_BACKEND.outputFormats },
    );

  const input = {
    prompt,
    image_size: imageSizeField(size, mode),
    quality,
    num_images: count,
    output_format: format,
  };

  /* Which reference landed in which provider field, recorded as it is built so the
     job can answer the question later without re-deriving it. */
  const bindings = [];
  const bind = (row, field, index = null) => {
    bindings.push({ refId: row.refId, role: row.role, mediaType: row.mediaType, field, index, order: row.order });
  };

  const masks = references.filter((row) => String(row.role) === "mask");
  const images = references.filter((row) => String(row.role) !== "mask");

  for (const row of references)
    if (String(row.mediaType || "image") !== "image")
      throw new FalImageBackendError(
        "IMAGE_REFERENCE_MODALITY_UNSUPPORTED",
        `GPT Image 2 accepts images only; ${row.production?.label || row.refId} is ${row.mediaType}.`,
        { refId: row.refId, mediaType: row.mediaType },
      );

  if (!endpoint.carriesImages) {
    if (references.length)
      throw new FalImageBackendError(
        "IMAGE_REFERENCE_UNSUPPORTED",
        `fal's GPT Image 2 ${mode} endpoint takes no reference images; the plan carries ${references.length}.`,
        { mode, count: references.length, refused: references.map((row) => ({ refId: row.refId, role: row.role })) },
      );
  } else {
    if (!images.length)
      throw new FalImageBackendError(
        "IMAGE_BASE_MISSING",
        mode === "edit" || mode === "inpaint"
          ? "An edit needs the approved frame it is editing. Nothing was sent."
          : "A reference-guided frame needs at least one approved reference image. Nothing was sent.",
        { mode },
      );
    const limit = Number.isFinite(Number(capability?.maxReferenceImages))
      ? Number(capability.maxReferenceImages)
      : FAL_IMAGE_BACKEND.maxReferenceImages;
    if (images.length > limit)
      throw new FalImageBackendError(
        "IMAGE_REFERENCE_OVER_LIMIT",
        `fal accepts ${limit} reference image${limit === 1 ? "" : "s"} for GPT Image 2; the plan carries ${images.length}.`,
        { count: images.length, limit },
      );
    input.image_urls = images.map((row, index) => {
      bind(row, "image_urls", index);
      return resolveReference(row);
    });
  }

  if (masks.length) {
    if (!endpoint.carriesMask)
      throw new FalImageBackendError(
        "IMAGE_MASK_UNSUPPORTED",
        `fal's GPT Image 2 ${mode} endpoint has no mask input; ${masks[0].production?.label || masks[0].refId} cannot be sent.`,
        { mode, refId: masks[0].refId },
      );
    if (masks.length > FAL_IMAGE_BACKEND.mask.maxCount)
      throw new FalImageBackendError(
        "IMAGE_MASK_UNSUPPORTED",
        `fal accepts one mask for GPT Image 2; the plan carries ${masks.length}.`,
        { count: masks.length, limit: FAL_IMAGE_BACKEND.mask.maxCount },
      );
    input.mask_url = resolveReference(masks[0]);
    bind(masks[0], "mask_url");
  }

  return {
    backendId: FAL_IMAGE_BACKEND.backendId,
    model: endpointFor(mode, config),
    modelFamily: "gpt-image-2",
    input,
    bindings,
    /* True when the text sent is not the text compiled. The plan is unchanged either
       way; this is how a reader tells the two apart without diffing them. */
    promptEdited: prompt !== compiledPrompt,
    compiledPromptCharacters: compiledPrompt.length,
    submittedPromptCharacters: prompt.length,
  };
}

module.exports = {
  FAL_IMAGE_BACKEND,
  FAL_IMAGE_MODES,
  FalImageBackendError,
  falImageBackendLayer,
  imageSizeField,
  resolveImageFalCapability,
  serializeImagePlanForFal,
};

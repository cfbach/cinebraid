/* The fal backend for MiniMax H3.
 *
 * fal is a BACKEND. It is not the model, and the difference is the whole reason this
 * file is separate from model-packs/minimax-h3.js:
 *
 *     model-packs/minimax-h3.js   what H3 objectively is, from MiniMax's own sources.
 *     fal-h3-backend.js           what fal's queue accepts, from fal's own schema.
 *
 * A backend may NARROW a model through the existing capability intersection. It may
 * never rewrite what the model is. H3 renders from 4 seconds; fal documents 5 to 15.
 * The intersection is 5 to 15, H3's fact stays 4, and a future backend without that
 * floor gets 4 back for free. Encoding fal's number as the model's would have followed
 * it everywhere and been wrong everywhere else.
 *
 * The serializer at the bottom is deliberately narrow. Its input is a compiled
 * GenerationPlan and a resolved capability, and NOTHING else: no shot, no spec, no
 * project, no profile. It cannot re-read filmmaking intent because it is never handed
 * any. What it does is rename fields, choose an endpoint and resolve reference bytes —
 * transport, and only transport.
 */

const {
  CINEBRAID_REFERENCE_ROLES,
  resolveCapability,
} = require("./public/shared-generation-capability");

/* ===========================================================================
   A. VERIFIED BACKEND FACTS

   Every value here was read from fal's own published endpoint schema on the date
   below. Where fal documents nothing, the field says so rather than inheriting the
   model's answer — an absence in a backend schema is not permission.

   `observed` marks a constraint that fal does NOT document but that CineBraid's
   shipped adapter has enforced against the live service. It is kept because removing
   a working guard on the strength of a doc gap would be a paid experiment, and it is
   labelled because it is not evidence of the same quality as the rest. */
const FAL_H3_BACKEND = {
  backendId: "fal-queue",
  checkedOn: "2026-08-08",
  evidence: [
    { id: "fal-t2v-schema", url: "https://fal.ai/models/minimax/h3/text-to-video/api", checkedOn: "2026-08-08" },
    { id: "fal-i2v-schema", url: "https://fal.ai/models/minimax/h3/image-to-video/api", checkedOn: "2026-08-08" },
    { id: "fal-r2v-schema", url: "https://fal.ai/models/minimax/h3/reference-to-video/api", checkedOn: "2026-08-08" },
  ],

  /* Which fal endpoint serves which CineBraid mode. First/last-frame is NOT a separate
     endpoint: fal's image-to-video schema carries an optional `end_image_url`, and that
     is the whole of FLF support. */
  endpoints: {
    t2v: { configKey: "h3TextModel", defaultModel: "minimax/h3/text-to-video" },
    i2v: { configKey: "h3ImageModel", defaultModel: "minimax/h3/image-to-video" },
    flf: { configKey: "h3ImageModel", defaultModel: "minimax/h3/image-to-video" },
    r2v: { configKey: "h3ReferenceModel", defaultModel: "minimax/h3/reference-to-video" },
  },

  /* fal's documented duration wording, on all three schemas: an integer, default 5,
     described as "durations from 5 to 15 seconds". The floor is the one real
     divergence from the model and is why this file exists. */
  durationSeconds: [5, 15],

  /* fal's ResolutionEnum. 4K is offered here and is NOT established by any MiniMax
     source, so the intersection with the model layer correctly withholds it: CineBraid
     will not sell a resolution it cannot show evidence for. Listing it anyway keeps
     this file an honest record of the backend rather than a filtered one. */
  resolutions: ["768P", "2K", "4K"],

  /* Per mode, because the three schemas genuinely differ. image-to-video has NO
     aspect_ratio field at all — the output follows the supplied image. */
  aspectRatios: {
    t2v: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    i2v: null,
    flf: null,
    r2v: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  },

  /* NOT NARROWED. fal's queue schema documents no maxLength on `prompt` for any of the
     three H3 endpoints, and fal's own model page states prompts may run to 7,000
     characters — the same number MiniMax documents.
     CineBraid previously refused at 2,000 with the comment "the current fal queue
     schema enforces 2,000". That is no longer what the schema says, so the number is
     retired rather than carried forward: a stale refusal costs a filmmaker the
     direction they wrote, and does it silently at the moment of dispatch. */
  maxPromptCharacters: 7000,

  /* fal exposes no seed on any H3 endpoint. Neither does MiniMax. So H3-on-fal is seed
     unsupported at both layers and the generic reproducibility architecture is left
     exactly as C1 built it — no invented field, no fabricated value. */
  seed: { supported: false, establishedBy: "absence-in-fal-endpoint-schema" },

  references: {
    /* fal documents the combined ceiling explicitly: "Reference images, videos, and
       audio clips must add up to at most 12 files." */
    maxTotal: 12,
    /* fal does not publish the per-modality split. CineBraid's shipped adapter has
       enforced 9/3/3 against the live service since H3 support landed, and MiniMax's
       Ref2VA checkpoint documents the same numbers, so the guard stays. */
    maxImages: 9,
    maxVideos: 3,
    maxAudio: 3,
    observed: ["maxImages", "maxVideos", "maxAudio"],
    /* fal: "Audio requires at least one image or video reference." */
    audioRequiresVisual: true,
  },

  /* Which modes fal serves at all, and with what. A mode absent from this table is
     unavailable on this backend and must refuse rather than be faked. */
  modeSupport: {
    t2v: { referenceMedia: [], firstFrame: false, lastFrame: false },
    i2v: { referenceMedia: ["image"], firstFrame: true, lastFrame: false },
    flf: { referenceMedia: ["image"], firstFrame: true, lastFrame: true },
    r2v: { referenceMedia: ["image", "video", "audio"], firstFrame: false, lastFrame: false },
  },
};

const FAL_H3_MODES = Object.keys(FAL_H3_BACKEND.modeSupport);

/* ---------------------------------------------------------------------------
   The BackendCapability descriptor, in the shape the existing four-layer resolver
   already consumes. One layer of the intersection, never the whole answer. */
function falH3BackendLayer(mode) {
  const key = String(mode || "");
  const support = FAL_H3_BACKEND.modeSupport[key];
  if (!support) return { modes: [] };
  const media = support.referenceMedia;
  const roleFilter = (role) => {
    if (role === "first-frame") return support.firstFrame || media.includes("image");
    if (role === "last-frame") return support.lastFrame || media.includes("image");
    return media.length > 0;
  };
  const aspect = FAL_H3_BACKEND.aspectRatios[key];
  return {
    modes: [key],
    /* A backend constrains roles only by what it can carry BYTES for. Which reference
       means what is the model pack's and the planner's business; fal only knows
       whether it has a field to put an image, a video or an audio clip in. */
    referenceRoles: CINEBRAID_REFERENCE_ROLES.filter(roleFilter),
    maxReferenceImages: media.includes("image") ? FAL_H3_BACKEND.references.maxImages : 0,
    maxReferenceVideos: media.includes("video") ? FAL_H3_BACKEND.references.maxVideos : 0,
    maxReferenceAudio: media.includes("audio") ? FAL_H3_BACKEND.references.maxAudio : 0,
    maxPromptCharacters: FAL_H3_BACKEND.maxPromptCharacters,
    resolutions: FAL_H3_BACKEND.resolutions,
    ...(Array.isArray(aspect) ? { aspectRatios: aspect } : {}),
    durationSeconds: FAL_H3_BACKEND.durationSeconds,
    flags: {
      firstFrame: support.firstFrame,
      lastFrame: support.lastFrame,
      seed: FAL_H3_BACKEND.seed.supported,
    },
  };
}

/* Model ∩ backend, using the resolver that already exists rather than a second
   limit system. A node or a recipe layer slots in here unchanged when one exists. */
function resolveH3FalCapability(mode, modelLayer, extraLayers = {}) {
  return resolveCapability({ model: modelLayer, backend: falH3BackendLayer(mode), ...extraLayers });
}

/* ===========================================================================
   B. TYPED REFUSALS

   Every one of these happens BEFORE a paid request. The message is written for a
   filmmaker; `code` is what a screen or a test switches on. */
class H3BackendError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "H3BackendError";
    this.code = code;
    this.detail = detail;
    /* A refusal about what was asked for is the caller's, not the server's. */
    this.status = code === "H3_BACKEND_SERIALIZATION_FAILED" ? 500 : 400;
  }
}

/* ===========================================================================
   C. THE SERIALIZER

   plan + capability -> fal request. No third argument carries intent.

   `resolveReference` is supplied by the caller and turns a plan reference's SOURCE
   into something fal can fetch — a hosted URL or a data URI. It is the only part of
   this that touches a filesystem, which is why it is injected rather than imported. */

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function endpointFor(mode, config = {}) {
  const entry = FAL_H3_BACKEND.endpoints[String(mode)];
  if (!entry)
    throw new H3BackendError(
      "H3_BACKEND_MODE_UNSUPPORTED",
      `The fal backend has no MiniMax H3 endpoint for ${mode || "this mode"}.`,
      { mode, supported: FAL_H3_MODES },
    );
  return String(config[entry.configKey] || entry.defaultModel);
}

/* The plan's own ordering, never the array's. `order` is what the planner computed and
   recorded; two references that arrive in a different array order still serialize
   identically, which is the property the FLF endpoint swap violated. */
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

/* Bound by ROLE through the plan's structured endpoint contract, never by position.
   The plan validator has already proved endpoints.firstFrame names a reference whose
   role really is first-frame, so this is a lookup and not a decision. */
function endpointReference(plan, field, references) {
  const binding = plan?.endpoints?.[field];
  if (!isRecord(binding) || !binding.refId) return null;
  return references.find((row) => String(row.refId) === String(binding.refId)) || null;
}

function serializeH3PlanForFal(plan, capability, options = {}) {
  const { resolveReference, config = {}, promptOverride } = options;
  if (!isRecord(plan))
    throw new H3BackendError("H3_PLAN_INVALID", "No compiled generation plan was supplied.");
  if (typeof resolveReference !== "function")
    throw new H3BackendError("H3_BACKEND_SERIALIZATION_FAILED", "No reference resolver was supplied to the fal serializer.");

  const mode = String(plan.mode || "");
  const support = FAL_H3_BACKEND.modeSupport[mode];
  if (!support)
    throw new H3BackendError(
      "H3_BACKEND_MODE_UNSUPPORTED",
      `fal does not offer MiniMax H3 ${mode || "generation"} through CineBraid.`,
      { mode, supported: FAL_H3_MODES },
    );
  if (Array.isArray(capability?.modes) && !capability.modes.includes(mode))
    throw new H3BackendError(
      "H3_BACKEND_MODE_UNSUPPORTED",
      `This configuration cannot produce ${mode}.`,
      { mode, supported: capability.modes },
    );

  /* The prompt. `promptOverride` exists for exactly one reason — a filmmaker edited
     the compiled prompt before submitting — and it replaces the TEXT only. It cannot
     add a reference, move an endpoint, change a duration or reach any other field. */
  const compiledPrompt = typeof plan.inputs?.prompt === "string" ? plan.inputs.prompt : "";
  const prompt = typeof promptOverride === "string" ? promptOverride : compiledPrompt;
  if (!prompt.trim())
    throw new H3BackendError("H3_PROMPT_EMPTY", "MiniMax H3 needs a prompt. Nothing was submitted.");
  const promptCeiling = Number.isFinite(Number(capability?.maxPromptCharacters))
    ? Number(capability.maxPromptCharacters)
    : FAL_H3_BACKEND.maxPromptCharacters;
  if (prompt.length > promptCeiling)
    /* Refused, never trimmed. A prompt cut to fit is a shot the filmmaker did not
       direct, delivered as though they had. */
    throw new H3BackendError(
      "H3_PROMPT_OVER_LIMIT",
      `The prompt is ${prompt.length.toLocaleString()} characters; this configuration accepts ${promptCeiling.toLocaleString()}. Shorten it before submitting — nothing was sent and nothing was charged.`,
      { length: prompt.length, limit: promptCeiling },
    );

  const references = orderedReferences(plan);
  const extensions = isRecord(plan.settings?.extensions)
    ? plan.settings.extensions[String(plan.model?.modelId)] || {}
    : {};

  /* Duration comes from the plan's compiled output, which the pack has already snapped
     onto the effective range. Re-deriving it from a request field here would be the
     second compilation this layer exists to prevent. */
  const duration = Number(plan.output?.durationSeconds) || Number(extensions.duration) || 0;
  const range = Array.isArray(capability?.durationSeconds) && capability.durationSeconds.length === 2
    ? capability.durationSeconds.map(Number)
    : FAL_H3_BACKEND.durationSeconds;
  if (!Number.isInteger(duration) || duration < range[0] || duration > range[1])
    throw new H3BackendError(
      "H3_DURATION_UNSUPPORTED",
      `This configuration renders whole seconds from ${range[0]} to ${range[1]}; the plan asks for ${duration || "none"}.`,
      { duration, range },
    );

  const resolution = String(extensions.resolution || "").toUpperCase();
  if (resolution && Array.isArray(capability?.resolutions) && !capability.resolutions.includes(resolution))
    throw new H3BackendError(
      "H3_RESOLUTION_UNSUPPORTED",
      `This configuration cannot render ${resolution}.`,
      { resolution, supported: capability.resolutions },
    );

  const input = { prompt, duration };
  if (resolution) input.resolution = resolution;

  /* Aspect ratio, only where fal has a field for it. i2v and flf take the ratio from
     the supplied image, so sending one would be inventing a parameter. */
  const aspectField = FAL_H3_BACKEND.aspectRatios[mode];
  if (Array.isArray(aspectField)) {
    const ratio = String(extensions.ratio || "");
    if (!ratio)
      throw new H3BackendError(
        "H3_ASPECT_REQUIRED",
        `MiniMax H3 ${mode} needs an explicit aspect ratio and the plan carries none.`,
        { mode, supported: aspectField },
      );
    if (!aspectField.includes(ratio))
      throw new H3BackendError(
        "H3_ASPECT_UNSUPPORTED",
        `fal's MiniMax H3 ${mode} endpoint cannot deliver ${ratio}.`,
        { mode, requested: ratio, supported: aspectField },
      );
    input.aspect_ratio = ratio;
  }

  /* Which reference landed in which provider field, recorded as it is built so the
     job can answer the question later without re-deriving it. */
  const bindings = [];
  const bind = (row, field, index = null) => {
    bindings.push({ refId: row.refId, role: row.role, mediaType: row.mediaType, field, index, order: row.order });
  };

  if (mode === "t2v") {
    if (references.length)
      throw new H3BackendError(
        "H3_REFERENCE_UNSUPPORTED",
        `MiniMax H3 text-to-video takes no reference inputs; the plan carries ${references.length}.`,
        { count: references.length },
      );
  } else if (mode === "i2v" || mode === "flf") {
    const first = endpointReference(plan, "firstFrame", references);
    if (!first)
      throw new H3BackendError(
        "H3_FIRST_FRAME_MISSING",
        "MiniMax H3 needs an approved opening frame bound to the plan's first-frame endpoint.",
        { mode },
      );
    input.image_url = resolveReference(first);
    bind(first, "image_url");
    if (mode === "flf") {
      const last = endpointReference(plan, "lastFrame", references);
      if (!last)
        throw new H3BackendError(
          "H3_LAST_FRAME_MISSING",
          "MiniMax H3 first/last-frame generation needs an approved final frame bound to the plan's last-frame endpoint.",
          { mode },
        );
      input.end_image_url = resolveReference(last);
      bind(last, "end_image_url");
    }
    /* Anything the plan carried beyond the endpoints has no field on this endpoint.
       Refusing names it; sending the first two images by position is what produced a
       shot that ended on its own opening frame. */
    const extra = references.filter((row) => !bindings.some((entry) => entry.refId === row.refId));
    if (extra.length)
      throw new H3BackendError(
        "H3_REFERENCE_UNSUPPORTED",
        `fal's MiniMax H3 ${mode} endpoint accepts only its endpoint frames; ${extra.map((row) => row.production?.label || row.refId).join(", ")} cannot be sent.`,
        { mode, refused: extra.map((row) => ({ refId: row.refId, role: row.role })) },
      );
  } else {
    const buckets = { image: [], video: [], audio: [] };
    for (const row of references) {
      const media = String(row.mediaType || "image");
      if (!support.referenceMedia.includes(media))
        throw new H3BackendError(
          "H3_REFERENCE_MODALITY_UNSUPPORTED",
          `fal's MiniMax H3 ${mode} endpoint cannot carry a ${media} reference (${row.production?.label || row.refId}).`,
          { refId: row.refId, mediaType: media, supported: support.referenceMedia },
        );
      buckets[media].push(row);
    }
    const limits = {
      image: FAL_H3_BACKEND.references.maxImages,
      video: FAL_H3_BACKEND.references.maxVideos,
      audio: FAL_H3_BACKEND.references.maxAudio,
    };
    for (const [media, rows] of Object.entries(buckets))
      if (rows.length > limits[media])
        throw new H3BackendError(
          "H3_REFERENCE_OVER_LIMIT",
          `fal accepts ${limits[media]} ${media} reference${limits[media] === 1 ? "" : "s"} for MiniMax H3; the plan carries ${rows.length}.`,
          { mediaType: media, count: rows.length, limit: limits[media] },
        );
    const total = references.length;
    if (total > FAL_H3_BACKEND.references.maxTotal)
      throw new H3BackendError(
        "H3_REFERENCE_OVER_LIMIT",
        `fal accepts ${FAL_H3_BACKEND.references.maxTotal} MiniMax H3 reference files in total; the plan carries ${total}.`,
        { count: total, limit: FAL_H3_BACKEND.references.maxTotal },
      );
    if (!buckets.image.length && !buckets.video.length)
      throw new H3BackendError(
        buckets.audio.length ? "H3_REFERENCE_MODALITY_UNSUPPORTED" : "H3_REFERENCE_MISSING",
        buckets.audio.length
          ? "MiniMax H3 cannot generate from audio references alone; add at least one approved image or video."
          : "MiniMax H3 reference-to-video needs at least one approved image or video reference.",
        { images: buckets.image.length, videos: buckets.video.length, audio: buckets.audio.length },
      );
    for (const [media, field] of [["image", "reference_image_urls"], ["video", "reference_video_urls"], ["audio", "reference_audio_urls"]]) {
      if (!buckets[media].length) continue;
      input[field] = buckets[media].map((row, index) => {
        bind(row, field, index);
        return resolveReference(row);
      });
    }
  }

  return {
    backendId: FAL_H3_BACKEND.backendId,
    model: endpointFor(mode, config),
    modelFamily: "minimax-h3",
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
  FAL_H3_BACKEND,
  FAL_H3_MODES,
  H3BackendError,
  falH3BackendLayer,
  resolveH3FalCapability,
  serializeH3PlanForFal,
};

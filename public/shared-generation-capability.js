/* Effective generation capability, shared by the browser and the Node server.
 *
 * What a generation request may ask for is not one fact. It is the intersection of
 * four independent ones:
 *
 *     ModelCapability     what the weights can do
 *         ∩
 *     BackendCapability   what this adapter implements at all
 *         ∩
 *     NodeCapability      what THIS machine has installed and can stage
 *         ∩
 *     RecipeCapability    what THIS validated graph actually wires up
 *         =
 *     EffectiveCapability what a screen may offer and a dispatcher may accept
 *
 * Collapsing those into one flag is how a control gets offered and then refused
 * after the user pressed it. Krea 2's style reference needs a different checkpoint
 * from Krea 2's plain text-to-image, so the same model is capable on one machine and
 * not on another; MiniMax H3's reference-to-video runs on a different checkpoint from
 * its image-to-video, so the same model is capable under one recipe and not another.
 * Neither fact belongs to the model, and neither can be inferred from a model name.
 *
 * This module answers only "what is possible". It never decides what to run, never
 * reaches a network, and never edits its inputs. It is loaded by the browser so a
 * control can be disabled with a reason, and required by the server so the same
 * refusal is produced before a job record exists — the pattern shared-aspect.js
 * already established, for the same reason: two sides that compute separately are two
 * sides that eventually disagree.
 *
 * Nothing here is Phase 1 wiring. No backend, node or recipe inventory exists yet;
 * the resolver takes descriptors and is exercised by fixtures.
 */

/* ---------------------------------------------------------------------------
   Vocabulary.

   These strings are CineBraid's existing ones. data/model-profiles.json has used
   them across 47 profiles since long before this module, so they are adopted rather
   than replaced — a parallel `text_to_image` spelling would mean every reader has to
   know both. The additions are the modes and roles RFC v2 introduced.

   Both lists are DATA. A model, backend, node or recipe declares which of them it
   supports; no code may branch on a model name to decide. */
const CINEBRAID_GENERATION_MODES = [
  /* image — existing */
  "t2i", "edit", "multi-reference", "style-reference", "moodboard", "blocking",
  /* video — existing */
  "t2v", "i2v", "flf", "r2v", "video-edit", "audio-video", "retake",
  /* added by RFC v2 */
  "variation", "inpaint", "outpaint", "control-guided", "v2v", "upscale", "restore",
];

/* Semantic reference roles. The first block is what public/media.js mediaPromptRole()
   already produces; the second is RFC v2's seven additions. A role says what a
   reference MEANS to the shot, never where a graph binds it — a recipe alone knows
   that `identity` lands on ref_images.ref_image_0 here and on image1 there. */
const CINEBRAID_REFERENCE_ROLES = [
  "composition", "reference", "reference-sheet", "identity", "expression", "body",
  "outfit", "pose", "turnaround", "detail", "location", "alternate-view", "lighting",
  "continuity-state", "prop", "scale", "style", "base", "motion-reference",
  "camera-reference", "performance-reference", "audio-timing", "sound-reference",
  /* added by RFC v2 */
  "first-frame", "last-frame", "depth", "edge", "mask", "voice", "colour-palette",
];

/* The four layers, in the order a refusal should name them: the most specific thing
   that removed a capability is the most useful thing to tell someone. */
const CINEBRAID_CAPABILITY_LAYERS = ["model", "backend", "node", "recipe"];

/* Flags are tri-state in the descriptors — declared true, declared false, or not
   mentioned. Not mentioned means "this layer has no opinion", which is not the same
   as "no". */
const CINEBRAID_CAPABILITY_FLAGS = [
  "firstFrame", "lastFrame", "mask", "controlNet", "lora", "multiLora",
  "nativeAudio", "seed", "candidateBatching", "referenceWeights",
];

const CINEBRAID_ENUM_FIELDS = ["modes", "referenceRoles", "resolutions", "aspectRatios", "fps"];
const CINEBRAID_MAXIMUM_FIELDS = ["maxReferenceImages", "maxReferenceVideos", "maxReferenceAudio"];
const CINEBRAID_RANGE_FIELDS = ["durationSeconds"];

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function uniqueSorted(values) {
  /* Sorted so an intersection is the same set in the same order no matter which
     order the layers arrived in. The order is canonical, not a preference ranking —
     nothing downstream may read meaning into it. */
  return Array.from(new Set(values.map((x) => String(x)))).sort();
}

/* ---------------------------------------------------------------------------
   Quantisers.

   A legal-value grid is not a range and must not be modelled as one. MiniMax H3's
   duration is snapped in-graph to a 17-frame block grid offset by 5 at 24fps; LTX's
   frame count is duration × fps + 1. Silently rounding either is how a job is
   accepted and then rejected, so a quantiser always reports BOTH the requested value
   and the proposed legal one, and never returns the proposal alone. */
function quantiseDuration(quantiser, requestedSeconds) {
  const requested = Number(requestedSeconds);
  if (!isPlainRecord(quantiser) || !Number.isFinite(requested))
    return { ok: false, requested: requestedSeconds, proposed: null, frames: null, exact: false };
  const fps = Number(quantiser.fps) || 0;
  if (fps <= 0)
    return { ok: false, requested, proposed: null, frames: null, exact: false };

  let frames = null;
  if (quantiser.kind === "block") {
    /* frames = base·k + offset, at or above the offset floor. */
    const base = Number(quantiser.base) || 0;
    const offset = Number(quantiser.offset) || 0;
    if (base <= 0) return { ok: false, requested, proposed: null, frames: null, exact: false };
    const floor = Math.max(offset, Math.round(requested * fps));
    frames = floor + (((offset - (floor % base)) % base) + base) % base;
  } else if (quantiser.kind === "linear") {
    /* frames = round(seconds · fps) + plus. */
    const plus = Number(quantiser.plus) || 0;
    frames = Math.round(requested * fps) + plus;
  } else {
    return { ok: false, requested, proposed: null, frames: null, exact: false };
  }

  const proposed = quantiser.kind === "linear" ? (frames - (Number(quantiser.plus) || 0)) / fps : frames / fps;
  /* Float seconds compared at frame resolution: a half-frame apart is not equal. */
  const exact = Math.abs(proposed - requested) < 1 / (fps * 2);
  return { ok: true, requested, proposed, frames, exact };
}

/* ---------------------------------------------------------------------------
   Intersection.

   A layer that omits a field imposes no constraint on it. A layer that declares null
   for an enum means "unrestricted". A layer that declares [] means "none", and an
   empty result is a real answer, not a missing one. */
function presentLayers(layers) {
  return CINEBRAID_CAPABILITY_LAYERS
    .map((name) => ({ name, value: layers[name] }))
    .filter((entry) => isPlainRecord(entry.value));
}

function blocked(field, layer, reason, message, action) {
  return { field, layer, reason, message, action: action || "" };
}

function intersectEnum(field, entries, blockedBy) {
  const constraining = entries.filter(
    (entry) => Array.isArray(entry.value[field]),
  );
  if (!constraining.length) return null; /* nobody constrained it */
  let result = uniqueSorted(constraining[0].value[field]);
  for (const entry of constraining.slice(1)) {
    const next = new Set(uniqueSorted(entry.value[field]));
    result = result.filter((item) => next.has(item));
  }
  if (!result.length) {
    /* Name the layer that emptied it — the last one that removed everything is the
       most specific thing to tell someone. */
    const culprit = constraining[constraining.length - 1];
    blockedBy.push(blocked(
      field,
      culprit.name,
      "empty-intersection",
      `No ${field} value is supported by every layer of this configuration.`,
      "Choose a different model, backend, node or recipe.",
    ));
  }
  return result;
}

function intersectMaximum(field, entries, blockedBy) {
  const numbers = entries
    .map((entry) => ({ name: entry.name, n: Number(entry.value[field]) }))
    .filter((entry) => Number.isFinite(entry.n));
  if (!numbers.length) return null;
  let winner = numbers[0];
  for (const entry of numbers) if (entry.n < winner.n) winner = entry;
  if (winner.n < 0) {
    blockedBy.push(blocked(field, winner.name, "negative-maximum", `${field} cannot be negative.`, ""));
    return 0;
  }
  return winner.n;
}

function intersectRange(field, entries, blockedBy) {
  const ranges = entries
    .map((entry) => ({ name: entry.name, range: entry.value[field] }))
    .filter((entry) => Array.isArray(entry.range) && entry.range.length === 2
      && Number.isFinite(Number(entry.range[0])) && Number.isFinite(Number(entry.range[1])));
  if (!ranges.length) return null;
  let lo = -Infinity;
  let hi = Infinity;
  let loLayer = ranges[0].name;
  let hiLayer = ranges[0].name;
  for (const entry of ranges) {
    const [a, b] = [Number(entry.range[0]), Number(entry.range[1])];
    if (a > lo) { lo = a; loLayer = entry.name; }
    if (b < hi) { hi = b; hiLayer = entry.name; }
  }
  if (lo > hi) {
    blockedBy.push(blocked(
      field,
      hiLayer === loLayer ? hiLayer : `${loLayer}+${hiLayer}`,
      "incompatible-range",
      `The ${field} limits of this configuration do not overlap.`,
      "Choose a different model, backend, node or recipe.",
    ));
    return null;
  }
  return [lo, hi];
}

function intersectFlags(entries) {
  const flags = {};
  for (const flag of CINEBRAID_CAPABILITY_FLAGS) {
    const declared = entries
      .filter((entry) => isPlainRecord(entry.value.flags) && flag in entry.value.flags)
      .map((entry) => entry.value.flags[flag] === true);
    /* Undeclared everywhere is false: a capability nothing claims is not available.
       Declared anywhere makes every OTHER declaring layer a veto. */
    flags[flag] = declared.length > 0 && declared.every(Boolean);
  }
  return flags;
}

function intersectQuantisers(entries, blockedBy) {
  const quantisers = {};
  for (const entry of entries) {
    if (!isPlainRecord(entry.value.quantisers)) continue;
    for (const axis of Object.keys(entry.value.quantisers).sort()) {
      const declared = entry.value.quantisers[axis];
      if (!isPlainRecord(declared)) continue;
      const existing = quantisers[axis];
      if (!existing) {
        quantisers[axis] = { ...declared, declaredBy: entry.name };
        continue;
      }
      const same = JSON.stringify({ ...existing, declaredBy: undefined })
        === JSON.stringify({ ...declared, declaredBy: undefined });
      if (!same) {
        /* Two different legal-value grids cannot be composed into a third. Saying so
           is better than picking one and producing a value neither accepts. */
        blockedBy.push(blocked(
          `quantisers.${axis}`,
          entry.name,
          "conflicting-quantiser",
          `Two layers of this configuration snap ${axis} to different legal values.`,
          "Choose a recipe whose frame grid matches the model.",
        ));
      }
    }
  }
  return quantisers;
}

/* The whole point of the module. Pure, deterministic, and it does not touch its
   arguments. */
function resolveCapability(layers) {
  const source = isPlainRecord(layers) ? layers : {};
  const entries = presentLayers(source);
  const blockedBy = [];

  const resolved = {
    ok: false,
    modes: null,
    referenceRoles: null,
    maxReferenceImages: null,
    maxReferenceVideos: null,
    maxReferenceAudio: null,
    resolutions: null,
    aspectRatios: null,
    fps: null,
    durationSeconds: null,
    quantisers: {},
    flags: intersectFlags(entries),
    layers: entries.map((entry) => entry.name),
    blockedBy,
  };

  if (!entries.length) {
    blockedBy.push(blocked(
      "layers",
      "model",
      "no-layers",
      "No model, backend, node or recipe capability was supplied.",
      "Choose a model.",
    ));
    return resolved;
  }

  for (const field of CINEBRAID_ENUM_FIELDS) resolved[field] = intersectEnum(field, entries, blockedBy);
  for (const field of CINEBRAID_MAXIMUM_FIELDS) resolved[field] = intersectMaximum(field, entries, blockedBy);
  for (const field of CINEBRAID_RANGE_FIELDS) resolved[field] = intersectRange(field, entries, blockedBy);
  resolved.quantisers = intersectQuantisers(entries, blockedBy);
  resolved.ok = blockedBy.length === 0;
  return resolved;
}

/* Does one concrete request fit a resolved capability? Separate from resolution so a
   screen can render what is possible once and validate many requests against it.
   Returns the same blockedBy shape, so one renderer handles both. */
function checkRequestAgainstCapability(request, capability) {
  const req = isPlainRecord(request) ? request : {};
  const cap = isPlainRecord(capability) ? capability : resolveCapability({});
  const blockedBy = [];

  if (req.mode != null && Array.isArray(cap.modes) && !cap.modes.includes(String(req.mode)))
    blockedBy.push(blocked("mode", "recipe", "mode-unsupported",
      `This configuration cannot produce ${req.mode}.`,
      "Choose a different mode, model, or backend."));

  const references = Array.isArray(req.references) ? req.references : [];
  const counts = { image: 0, video: 0, audio: 0 };
  references.forEach((reference, index) => {
    const role = String(reference?.role || "");
    if (role && Array.isArray(cap.referenceRoles) && !cap.referenceRoles.includes(role))
      blockedBy.push(blocked(`references[${index}].role`, "recipe", "role-unsupported",
        `This configuration does not accept a ${role} reference.`,
        "Remove the reference, or choose a model that accepts it."));
    const mediaType = String(reference?.mediaType || "image");
    if (mediaType in counts) counts[mediaType] += 1;
    if (isPlainRecord(reference?.controls) && "weight" in reference.controls && !cap.flags.referenceWeights)
      /* Dropping an unsupported control silently is how a shot is generated with
         settings the user believes were applied. */
      blockedBy.push(blocked(`references[${index}].controls.weight`, "model", "control-unsupported",
        "This model cannot weight references.",
        "Remove the weight, or choose a model that supports reference weights."));
  });

  const maxima = {
    image: ["maxReferenceImages", "image references"],
    video: ["maxReferenceVideos", "video references"],
    audio: ["maxReferenceAudio", "audio references"],
  };
  for (const [mediaType, [field, label]] of Object.entries(maxima)) {
    const limit = cap[field];
    if (Number.isFinite(limit) && counts[mediaType] > limit)
      blockedBy.push(blocked(field, "recipe", "too-many-references",
        `This configuration accepts ${limit} ${label}; ${counts[mediaType]} were supplied.`,
        `Remove ${counts[mediaType] - limit}.`));
  }

  for (const [field, key] of [["resolutions", "resolutionPreset"], ["aspectRatios", "aspectRatio"]]) {
    const wanted = req[key];
    if (wanted != null && Array.isArray(cap[field]) && !cap[field].includes(String(wanted)))
      blockedBy.push(blocked(key, "model", "value-unsupported",
        `This configuration cannot produce ${wanted}.`,
        `Choose one of: ${cap[field].join(", ")}.`));
  }

  if (req.durationSeconds != null && Array.isArray(cap.durationSeconds)) {
    const seconds = Number(req.durationSeconds);
    const [lo, hi] = cap.durationSeconds;
    if (!Number.isFinite(seconds) || seconds < lo || seconds > hi)
      blockedBy.push(blocked("durationSeconds", "model", "out-of-range",
        `This configuration accepts ${lo}–${hi} seconds.`,
        `Choose a duration between ${lo} and ${hi}.`));
  }

  /* A quantised duration is reported, never applied. The caller decides whether to
     accept the proposal; nothing here rewrites the request. */
  let duration = null;
  if (req.durationSeconds != null && isPlainRecord(cap.quantisers) && cap.quantisers.frames) {
    duration = quantiseDuration(cap.quantisers.frames, req.durationSeconds);
    if (duration.ok && !duration.exact)
      blockedBy.push(blocked("durationSeconds", "recipe", "quantised",
        `This configuration renders on a fixed frame grid; ${duration.requested}s becomes ${duration.proposed}s.`,
        `Accept ${duration.proposed}s, or choose a duration on the grid.`));
  }

  if (req.seed != null && !cap.flags.seed)
    blockedBy.push(blocked("seed", "model", "seed-unsupported",
      "This configuration cannot accept a seed.",
      "Leave the seed unset."));

  return { ok: blockedBy.length === 0, duration, blockedBy };
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    CINEBRAID_GENERATION_MODES,
    CINEBRAID_REFERENCE_ROLES,
    CINEBRAID_CAPABILITY_LAYERS,
    CINEBRAID_CAPABILITY_FLAGS,
    quantiseDuration,
    resolveCapability,
    checkRequestAgainstCapability,
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CINEBRAID_GENERATION_MODES,
    CINEBRAID_REFERENCE_ROLES,
    CINEBRAID_CAPABILITY_LAYERS,
    CINEBRAID_CAPABILITY_FLAGS,
    CINEBRAID_ENUM_FIELDS,
    CINEBRAID_MAXIMUM_FIELDS,
    CINEBRAID_RANGE_FIELDS,
    quantiseDuration,
    resolveCapability,
    checkRequestAgainstCapability,
  };
}

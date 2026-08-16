/* GPT Image 2 model pack — the proof that the compiler is not video-shaped.
 *
 * MiniMax H3 was CineBraid's first pack and, until now, its only one. A compiler with
 * one pack is not an architecture; it is an implementation with a seam drawn on it. So
 * the useful question for C2a was not "can a second video model be added" but "does
 * anything in the core assume video at all".
 *
 * This pack answers it. Different vendor, different modality, different input contract,
 * different failure modes — and generation-compiler.js, generation-contracts.js and
 * shared-generation-capability.js are unchanged by it. What a still image needs that a
 * video does not is expressed entirely in here.
 *
 * The two objects are separated exactly as they are for H3, and for the same reason:
 *
 *   FACTS     what GPT Image 2 objectively is, from OpenAI's own model page and image
 *             guide. See docs/architecture/model-evidence/gpt-image-2.json.
 *
 *   PLAYBOOK  how to write for it. CineBraid's OWN editorial policy, carried over from
 *             the four profiles data/model-profiles.json has shipped for this family
 *             since long before this pack — NOT vendor prompting guidance, because no
 *             OpenAI prompt-writing guide was read. That distinction is recorded in the
 *             evidence file rather than blurred here.
 *
 * WHAT A STILL CANNOT CARRY, and why it is `omitted-by-design` rather than `unsupported`.
 * A shot carries a camera move, a duration, a required ending state and a line of
 * dialogue. A still frame expresses none of them — but not because the model failed.
 * CineBraid directs those on the motion pass, from this frame; the still is the opening
 * state the move departs from. So each is omitted WITH THAT REASON, and the reason is
 * the workflow rather than an apology. `unsupported` is reserved for the case where the
 * filmmaker asked for something and will not get it: an aspect ratio this model has no
 * size for, a seed it does not accept, a reference it cannot carry.
 *
 * NOTHING DISPATCHES THROUGH THIS PACK YET. GPT Image 2 is reached today by the existing
 * fal path, which builds its own request from the prompt registry, exactly as before.
 * This compiles a plan; wiring it to a route is a separate, bounded change of the same
 * shape as C1.1 was for H3.
 */

const { registerModelPack } = require("../generation-compiler");

const PACK_ID = "gpt-image-2";
const PACK_VERSION = "1.0.0";

/* ===========================================================================
   A. OBJECTIVE CAPABILITY FACTS

   Every value traceable to docs/architecture/model-evidence/gpt-image-2.json.
   `null` means no official source establishes it; it does not mean "none". */

const GPT_IMAGE_2_FACTS = {
  family: "gpt-image-2",
  vendor: "OpenAI",
  apiModelIdentifier: "gpt-image-2",
  modes: ["t2i", "edit", "multi-reference", "blocking", "inpaint"],
  /* The documented named sizes. This is a legal-value SET, not a range: 1600x900 is
     inside every published bound and is not on the list. */
  sizes: ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840", "auto"],
  /* The bounds a custom size must satisfy. Recorded even though CineBraid only offers
     named sizes, because a later phase that offers custom dimensions must not have to
     re-derive them from prose. */
  dimensionRules: {
    maxEdge: 3840,
    edgeMultiple: 16,
    maxLongToShortRatio: 3,
    totalPixels: [655360, 8294400],
  },
  qualityTiers: ["low", "medium", "high", "auto"],
  outputFormats: ["png", "jpeg", "webp"],
  maxReferenceImages: 16,
  mask: { supported: true, requires: "an alpha channel, matching the input's format and size, under 50MB" },
  transparentBackground: { supported: false, establishedBy: "explicit-statement-in-official-guide" },
  /* Not established. No OpenAI image documentation read for this model documents a
     seed. Recorded as an absence, which is why the flag below is explicitly false: a
     caller that supplies one gets a warning rather than silence. */
  seed: { supported: false, establishedBy: "absence-in-official-model-page-and-guide" },
  /* Not established. The guide states no explicit prompt length limit, so nothing here
     refuses on length — an invented ceiling would silently cost a filmmaker direction. */
  maxPromptCharacters: null,
  inputFidelity: { settable: false, note: "Every image input is processed at high fidelity and the parameter must be omitted." },
};

/* Which named size delivers which aspect ratio. Derived once from the documented size
   list rather than computed at call time, so the answer cannot drift with a rounding
   rule. Ordered smallest first WITHIN a ratio; the order is a size ladder and is read
   as one only by pickSize, which says so. */
const SIZES_BY_RATIO = {
  "1:1": ["1024x1024", "2048x2048"],
  "3:2": ["1536x1024"],
  "2:3": ["1024x1536"],
  "16:9": ["2048x1152", "3840x2160"],
  "9:16": ["2160x3840"],
};
/* The ratios a shot may legitimately ask for and this model has no size for. Listed so
   the refusal can name them rather than saying "unsupported" and stopping. */
const RATIO_ALIASES = { "4:3": "3:2", "3:4": "2:3", "21:9": "16:9", "2.39:1": "16:9", "1.85:1": "16:9" };

/* The size TIERS a filmmaker saves in Settings, and which documented size each one
   means at a given ratio.

   Settings stores a tier — "1k", "2k", "4k" — because a filmmaker chooses how much to
   spend, not a pixel pair; the pixel pair is this model's business and depends on the
   shot's format. The tier of a named size is read off its long edge rather than kept in
   a second table, so adding a size to GPT_IMAGE_2_FACTS.sizes cannot leave a table
   behind disagreeing with it.

   The boundaries are the documented long edges themselves: 1024 and 1536 are the 1K
   sizes, 2048 the 2K sizes, 3840 the 4K sizes. */
const SIZE_TIERS = ["1k", "2k", "4k"];
function sizeTier(size) {
  const [width, height] = String(size).split("x").map((value) => Number(value) || 0);
  const longEdge = Math.max(width, height);
  if (!longEdge) return "";
  if (longEdge <= 1536) return "1k";
  if (longEdge <= 2048) return "2k";
  return "4k";
}

function checkpointForMode(mode) {
  return GPT_IMAGE_2_FACTS.modes.includes(String(mode)) ? { name: "standard", modes: GPT_IMAGE_2_FACTS.modes } : null;
}

/* The ModelCapability descriptor this pack contributes to the four-layer resolver. One
   layer, never the whole answer: a backend still gets its say, which is how a route that
   caps output at 2K correctly stops offering 4K without this file changing. */
function capabilityLayer(mode, surface = "api") {
  const key = String(mode || "");
  if (!GPT_IMAGE_2_FACTS.modes.includes(key)) return { modes: [] };
  /* No local surface exists for this model — the weights are not published — so the
     surface argument is accepted for interface symmetry and deliberately changes
     nothing. Pretending a local face existed would be the mirror of the H3 mistake. */
  const referenceRoles = key === "blocking"
    /* Blocking is a labelled greyscale layout. It takes no production reference at all,
       and the shipped profile's limits say so: maxReferences 0. */
    ? []
    : ["identity", "location", "prop", "style", "composition", "base", "reference", "mask"];
  return {
    modes: [key],
    referenceRoles,
    maxReferenceImages: key === "blocking" ? 0 : GPT_IMAGE_2_FACTS.maxReferenceImages,
    maxReferenceVideos: 0,
    maxReferenceAudio: 0,
    resolutions: GPT_IMAGE_2_FACTS.sizes,
    aspectRatios: Object.keys(SIZES_BY_RATIO).sort(),
    flags: {
      mask: GPT_IMAGE_2_FACTS.mask.supported && ["edit", "inpaint"].includes(key),
      firstFrame: false,
      lastFrame: false,
      nativeAudio: false,
      seed: GPT_IMAGE_2_FACTS.seed.supported,
      referenceWeights: false,
      candidateBatching: true,
      lora: false,
      controlNet: false,
      multiLora: false,
    },
    ...(GPT_IMAGE_2_FACTS.maxPromptCharacters ? { maxPromptCharacters: GPT_IMAGE_2_FACTS.maxPromptCharacters } : {}),
  };
}

/* ===========================================================================
   B. PROMPTING POLICY

   CineBraid's own, versioned independently of the facts above so that improving the
   wording never looks like a capability change. Every rule here is carried from the
   four gpt-image-2 profiles already in data/model-profiles.json. */

const GPT_IMAGE_2_PLAYBOOK = {
  version: "2026-08-08",
  origin: "data/model-profiles.json gpt-image-2/{t2i,edit,multi-reference,blocking}",
  sectionTitles: {
    purpose: "PURPOSE",
    references: "REFERENCE LEGEND",
    subject: "SUBJECT AND PERFORMANCE",
    composition: "COMPOSITION AND CAMERA",
    environment: "ENVIRONMENT AND PROPS",
    style: "LIGHTING AND STYLE",
    continuity: "CONTINUITY",
    exclusions: "EXCLUSIONS",
    layout: "LAYOUT",
    labels: "LABELS",
  },
  /* The division of labour the shipped profile states outright, and the reason this
     model is worth a pack: references carry identity, the prompt carries everything
     that is not identity. Restating a face in prose competes with the reference of it. */
  referencesCarryIdentity: true,
  /* What a still frame does not express, with the reason it does not. These are
     `omitted-by-design` and not `unsupported` because CineBraid directs each of them
     elsewhere in its own workflow — the omission is a decision, not a limitation. */
  omittedByDesign: {
    "camera.movement": "A still frame holds one instant. The camera move is directed on the motion pass that departs from this frame.",
    "camera.timing": "Move timing belongs to the motion pass, not to the frame it starts from.",
    "timing.duration": "A still has no duration. The shot's length is set on the motion pass.",
    "state.final": "This frame is the shot's opening state; the required ending state is directed on the last-frame or motion pass.",
    "dialogue.line": "A still frame carries no sound. The line is directed through expression and mouth position instead.",
    "dialogue.delivery": "Delivery is audible, not visible. What it does to the face is directed as performance.",
    "dialogue.timing": "Timing belongs to a result that occupies time.",
    "dialogue.voice": "Voice design belongs to the audio pass.",
    "sound.effects": "A still frame carries no sound.",
    "sound.ambience": "A still frame carries no sound; what the ambience looks like is directed as environment and light.",
    "sound.music": "A still frame carries no sound.",
    "sound.silence": "A still frame carries no sound.",
    "sound.priorities": "A still frame carries no sound.",
    /* Both arrived with the intent inventory, and both are directed elsewhere in
       CineBraid's own workflow rather than being beyond the model. */
    "performance.lipSync": "A still frame holds one instant. Whether the mouth has to match the words is directed on the motion pass.",
    "subjects.count": "A still frame has no subject-count control; each subject is named individually in the description instead.",
  },
  /* Blocking is deliberately impoverished. The shipped profile's rule is explicit:
     labelled placeholders, no production identity, wardrobe, materials, colour,
     texture, lighting or era detail. Recorded so the reason survives a rewrite. */
  blockingOmits: {
    "identity.canon": "Blocking uses labelled placeholders; production identity is deliberately absent so the layout is not mistaken for a look.",
    "style.visual": "Blocking is flat greyscale. Style is directed on the frame pass.",
    "continuity.drift": "Blocking carries no continuity state; it is a disposable layout.",
    "continuity.preserve": "Blocking carries no continuity state; it is a disposable layout.",
    "continuity.avoid": "Blocking carries no continuity state; it is a disposable layout.",
    "performance.facial": "Blocking shows silhouettes and masses, not faces.",
    "performance.gaze": "Blocking shows silhouettes and masses, not faces.",
    "production.risks": "Blocking is a layout study; production risks are addressed on the frame pass.",
  },
  /* What an existing base image already establishes, so restating it in prose would
     compete with the image itself. The same anchoring principle H3 applies to a first
     frame, applied to an edit's base plate. */
  anchoredBy: {
    edit: {
      "state.initial": { via: "the supplied base image", requires: "base" },
      environment: { via: "the supplied base image", requires: "base" },
      "identity.canon": { via: "the supplied base image", requires: "base" },
      "style.visual": { via: "the supplied base image", requires: "base" },
    },
    inpaint: {
      "state.initial": { via: "the supplied base image", requires: "base" },
      environment: { via: "the supplied base image", requires: "base" },
      "identity.canon": { via: "the supplied base image", requires: "base" },
      "style.visual": { via: "the supplied base image", requires: "base" },
    },
    "multi-reference": {
      "identity.canon": { via: "the approved identity references", requires: "identity" },
    },
  },
  blocking: {
    styleContract: "Flat greyscale storyboard blocking. Simple masses, clear silhouettes, readable depth separation.",
    quality: "low",
  },
};

/* ---------------------------------------------------------------------------
   Small helpers. Local, so the pack stays loadable without the compiler's internals. */
function text(value) {
  return String(value == null ? "" : value).trim();
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function intentValue(intent, key) {
  const row = (Array.isArray(intent) ? intent : []).find((entry) => entry && entry.key === key);
  return row ? text(row.value) : "";
}
function sentence(value) {
  const body = text(value);
  if (!body) return "";
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

/* ---------------------------------------------------------------------------
   Reference limits.

   Refused one at a time and each by name, after a fixed priority: required roles before
   influences, then the planner's canonical order. Dropping the tail of an array is how
   an approved identity gets silently discarded because it happened to be selected last. */
function applyReferenceLimits(manifest, capability, coverage) {
  const rows = Array.isArray(manifest) ? manifest : [];
  const roles = Array.isArray(capability?.referenceRoles) ? capability.referenceRoles : null;
  const limit = Number.isFinite(Number(capability?.maxReferenceImages))
    ? Number(capability.maxReferenceImages)
    : GPT_IMAGE_2_FACTS.maxReferenceImages;

  const kept = [];
  for (const row of rows) {
    if (row.mediaType !== "image") {
      coverage.warn({
        code: "reference-modality-unsupported",
        field: `inputs.references.${row.refId}`,
        message: `${row.production.label} is ${row.mediaType} and GPT Image 2 accepts images only.`,
        action: "Remove it, or choose a model that accepts this input.",
      });
      continue;
    }
    if (roles && !roles.includes(row.role)) {
      coverage.warn({
        code: "reference-role-unsupported",
        field: `inputs.references.${row.refId}`,
        message: `${row.production.label} is a ${row.role} reference and this configuration does not accept one.`,
        action: "Remove it, or choose a model that accepts this role.",
      });
      continue;
    }
    kept.push(row);
  }

  if (kept.length <= limit) return kept;
  const ordered = [...kept].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.order - b.order;
  });
  const survivors = ordered.slice(0, Math.max(0, limit));
  for (const row of ordered.slice(Math.max(0, limit)))
    coverage.warn({
      code: "reference-over-limit",
      field: `inputs.references.${row.refId}`,
      message: `${row.production.label} cannot be sent: this configuration accepts ${limit} reference images and the shot supplies ${kept.length}.`,
      action: "Deselect a reference, or choose a model that accepts more.",
    });
  /* Re-sorted into the planner's canonical order, not the refusal order. */
  return survivors.sort((a, b) => a.order - b.order);
}

/* ---------------------------------------------------------------------------
   Size selection.

   Reports rather than substitutes. A ratio the model has no size for is refused by
   name; the request is never quietly rendered square. */
function pickSize(requestedSize, requestedRatio, capability, coverage) {
  const allowed = Array.isArray(capability?.resolutions) ? capability.resolutions : GPT_IMAGE_2_FACTS.sizes;

  /* An explicit size wins where the configuration allows it. */
  const size = text(requestedSize);
  const tier = SIZE_TIERS.includes(size.toLowerCase()) ? size.toLowerCase() : "";
  if (size && !tier) {
    if (allowed.includes(size)) return { size, via: "explicit" };
    coverage.warn({
      code: "resolution-unsupported",
      field: "settings.resolution",
      message: `This configuration cannot render ${size}.`,
      action: `Choose one of: ${allowed.join(", ")}.`,
    });
  }

  const ratio = text(requestedRatio);
  if (!ratio) {
    /* Without a ratio a tier still narrows the field, and taking the tier's own
       smallest is the same spending rule the ladder below applies. */
    const tierOnly = tier ? allowed.filter((value) => sizeTier(value) === tier) : [];
    if (tierOnly.length) return { size: tierOnly[0], via: "tier" };
    return { size: allowed.includes("auto") ? "auto" : allowed[0], via: "default" };
  }

  const resolved = SIZES_BY_RATIO[ratio] ? ratio : RATIO_ALIASES[ratio];
  const candidates = (SIZES_BY_RATIO[resolved] || []).filter((value) => allowed.includes(value));
  if (!candidates.length) {
    coverage.unsupported(
      "output.aspectRatio",
      `GPT Image 2 has no output size at ${ratio}.`,
      {
        code: "aspect-unsupported",
        field: "output.aspectRatio",
        message: `This shot is ${ratio} and GPT Image 2 offers no size at that ratio; the frame would not match the production format.`,
        action: `Choose one of: ${Object.keys(SIZES_BY_RATIO).sort().join(", ")}, or generate this frame with a different model.`,
      },
    );
    return { size: null, via: "refused" };
  }
  if (resolved !== ratio)
    /* A near neighbour is still not the requested ratio, and saying so is the whole
       difference between an informed choice and a surprise in the edit. */
    coverage.warn({
      code: "aspect-approximated",
      field: "output.aspectRatio",
      message: `This shot is ${ratio}; GPT Image 2's nearest available ratio is ${resolved}, so the frame will need reframing to the production format.`,
      action: `Accept ${resolved}, or generate this frame with a model that offers ${ratio}.`,
    });
  else coverage.represent("output.aspectRatio", "parameter");

  /* A SAVED TIER, resolved against this ratio's own sizes.
     "1k" is not a pixel pair until a format is known: at 3:2 it is 1536x1024, at 1:1 it
     is 1024x1024, and at 16:9 this model documents no 1K size at all. Resolving here
     rather than in the dialog is what lets the saved setting mean the same thing in
     every format without the browser holding a copy of this model's size list. */
  if (tier) {
    const atTier = candidates.filter((value) => sizeTier(value) === tier);
    if (atTier.length) return { size: atTier[0], via: "tier" };
    /* The tier is real and this ratio has nothing at it. Named rather than silently
       swapped: the filmmaker asked to spend at one tier and is about to spend at
       another, and that is a sentence they are owed BEFORE the paid button. */
    coverage.warn({
      code: "resolution-tier-unavailable",
      field: "settings.resolution",
      message: `Your saved ${tier.toUpperCase()} frame size is not one GPT Image 2 offers at ${resolved}; ${candidates[0]} is the closest it documents at this format.`,
      action: `Generate at ${candidates[0]}, save a different frame size in Settings, or generate this frame with a model that offers ${tier.toUpperCase()} at ${resolved}.`,
    });
  }

  /* THE SMALLEST at this ratio, not the largest.
     SIZES_BY_RATIO is a size ladder and is read as one only here — it is not a
     capability list and nothing sorts one. Taking the last entry would have been the
     obvious move and is the wrong one: it makes every render where nobody chose a size
     the most expensive render available, and does it silently. A filmmaker who wants
     4K asks for it; spending is opt-in. */
  return { size: candidates[0], via: resolved === ratio ? "ratio" : "approximated" };
}

/* The cost-and-speed tier. A filmmaker's explicit choice wins where the model
   documents it; anything else is refused BY NAME rather than silently replaced, for
   the same reason an unsupported size is. The defaults are unchanged: a blocking
   frame is a disposable layout and renders at the cheapest tier the vendor
   documents, and everything else lets the model decide. */
function pickQuality(requested, mode, coverage) {
  const fallback = mode === "blocking" ? GPT_IMAGE_2_PLAYBOOK.blocking.quality : "auto";
  const wanted = text(requested);
  if (!wanted) return fallback;
  if (GPT_IMAGE_2_FACTS.qualityTiers.includes(wanted)) return wanted;
  coverage.warn({
    code: "quality-unsupported",
    field: "settings.quality",
    message: `GPT Image 2 has no "${wanted}" quality tier, so ${fallback} was used instead.`,
    action: `Choose one of: ${GPT_IMAGE_2_FACTS.qualityTiers.join(", ")}.`,
  });
  return fallback;
}

/* ---------------------------------------------------------------------------
   Section builders. */

function referenceLegend(manifest, coverage) {
  if (!manifest.length) return null;
  const lines = manifest.map((row, index) => {
    const token = `#image${index + 1}`;
    const who = text(row.production.entityName);
    const purpose = text(row.production.purpose) || "an approved visual reference";
    const state = text(row.production.continuityState);
    return `${token} — ${who || text(row.production.label)}: ${purpose}${state ? `, in its approved ${state} state` : ""}.`;
  });
  /* Identity is carried by the references, and the coverage record says so rather than
     claiming the prompt describes a face it deliberately does not describe. */
  const identity = manifest.find((row) => row.role === "identity");
  if (identity) coverage.anchor("identity.canon", `${identity.production.label} (#image${manifest.indexOf(identity) + 1})`);
  return { title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.references, body: lines.join("\n") };
}

function subjectSection(ctx) {
  const { intent, coverage } = ctx;
  const parts = [];
  for (const key of ["action.primary", "action.secondary", "action.environment"]) {
    const value = intentValue(intent, key);
    if (!value) continue;
    parts.push(sentence(value));
    coverage.represent(key, "prompt");
  }
  for (const key of ["performance.emotion", "performance.facial", "performance.body", "performance.gaze"]) {
    const value = intentValue(intent, key);
    if (!value) continue;
    parts.push(sentence(value));
    coverage.represent(key, "prompt");
  }
  const initial = intentValue(intent, "state.initial");
  if (initial && !coverage.has("state.initial")) {
    parts.push(sentence(initial));
    coverage.represent("state.initial", "prompt");
  }
  /* Identity canon reaches the PROMPT only when no reference is holding it.
     The shipped profile's rule — references carry identity, the prompt carries geometry,
     action, lighting and grade — is about what to do when a reference exists. With none
     selected, saying nothing about who this is does not preserve the character; it
     leaves them unspecified. So the canon is written, and the coverage record says
     `represented` rather than pretending an absent reference anchored it. */
  const canon = intentValue(intent, "identity.canon");
  if (canon && !coverage.has("identity.canon")) {
    parts.push(sentence(canon));
    coverage.represent("identity.canon", "prompt");
  }
  const drift = intentValue(intent, "continuity.drift");
  if (drift && !coverage.has("continuity.drift")) {
    parts.push(sentence(drift));
    coverage.represent("continuity.drift", "prompt");
  }
  if (!parts.length) return null;
  return { title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.subject, body: parts.join(" ") };
}

function compositionSection(ctx) {
  const { intent, coverage } = ctx;
  const parts = [];
  for (const key of ["camera.framing", "staging", "camera.lens"]) {
    const value = intentValue(intent, key);
    if (!value) continue;
    parts.push(sentence(value));
    coverage.represent(key, "prompt");
  }
  if (!parts.length) return null;
  return { title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.composition, body: parts.join(" ") };
}

function environmentSection(ctx) {
  const { intent, coverage } = ctx;
  const value = intentValue(intent, "environment");
  if (!value || coverage.has("environment")) return null;
  coverage.represent("environment", "prompt");
  return { title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.environment, body: sentence(value) };
}

function styleSection(ctx) {
  const { intent, coverage } = ctx;
  const value = intentValue(intent, "style.visual");
  if (!value || coverage.has("style.visual")) return null;
  coverage.represent("style.visual", "prompt");
  return { title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.style, body: sentence(value) };
}

function continuitySection(ctx) {
  const { intent, coverage } = ctx;
  const parts = [];
  for (const key of ["continuity.drift", "continuity.preserve"]) {
    const value = intentValue(intent, key);
    if (!value) continue;
    parts.push(sentence(value));
    coverage.represent(key, "prompt");
  }
  const risks = intentValue(intent, "production.risks");
  if (risks) {
    parts.push(sentence(risks));
    coverage.represent("production.risks", "prompt");
  }
  if (!parts.length) return null;
  return { title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.continuity, body: parts.join(" ") };
}

function exclusionsSection(ctx) {
  const { intent, coverage } = ctx;
  const value = intentValue(intent, "continuity.avoid");
  if (!value) return null;
  coverage.represent("continuity.avoid", "prompt");
  return { title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.exclusions, body: sentence(value) };
}

/* Anchors, applied the way the compiler doc requires: an anchor may only name an input
   that is actually in the package. "Anchored by the supplied base image" with no base
   image reads as accounted for while nothing holds it. */
function applyAnchors(ctx, mode) {
  const table = GPT_IMAGE_2_PLAYBOOK.anchoredBy[mode];
  if (!table) return;
  for (const [key, anchor] of Object.entries(table)) {
    if (!intentValue(ctx.intent, key)) continue;
    const holder = ctx.manifest.find((row) => row.role === anchor.requires);
    if (!holder) continue;
    ctx.coverage.anchor(key, `${anchor.via} (${holder.production.label})`);
  }
}

/* The omissions, applied last so a section that DID express something wins. */
function applyOmissions(ctx, table) {
  for (const [key, reason] of Object.entries(table)) {
    if (!intentValue(ctx.intent, key)) continue;
    if (ctx.coverage.has(key)) continue;
    ctx.coverage.omit(key, reason);
  }
}

/* ---------------------------------------------------------------------------
   Mode compilers. */

function compileStill(ctx, { purpose, mode }) {
  const sections = [];
  sections.push({ title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.purpose, body: purpose });
  const legend = referenceLegend(ctx.manifest, ctx.coverage);
  if (legend) sections.push(legend);
  applyAnchors(ctx, mode);
  for (const build of [subjectSection, compositionSection, environmentSection, styleSection, continuitySection, exclusionsSection]) {
    const section = build(ctx);
    if (section) sections.push(section);
  }
  applyOmissions(ctx, GPT_IMAGE_2_PLAYBOOK.omittedByDesign);
  return sections;
}

function compileT2I(ctx) {
  return compileStill(ctx, {
    mode: "t2i",
    purpose: "A single production still for this shot, rendered as a finished frame.",
  });
}

function compileEdit(ctx) {
  const base = ctx.manifest.find((row) => row.role === "base");
  if (!base)
    ctx.coverage.warn({
      code: "base-image-missing",
      field: "inputs.references",
      message: "An edit needs the frame it is editing, supplied as a base reference.",
      action: "Select the approved frame to edit.",
    });
  return compileStill(ctx, {
    mode: ctx.mode === "inpaint" ? "inpaint" : "edit",
    purpose: base
      ? `Edit the supplied base frame. Change only what this brief asks for; everything else in ${base.production.label} stays exactly as it is.`
      : "Edit the supplied base frame. Change only what this brief asks for; everything else stays exactly as it is.",
  });
}

function compileMultiReference(ctx) {
  return compileStill(ctx, {
    mode: "multi-reference",
    purpose: "A single production still built from the approved references below. The references carry identity and appearance; this brief carries geometry, action, lighting and grade.",
  });
}

function compileBlocking(ctx) {
  const { intent, coverage } = ctx;
  const sections = [{
    title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.purpose,
    body: GPT_IMAGE_2_PLAYBOOK.blocking.styleContract,
  }];
  const layout = [];
  for (const key of ["camera.framing", "staging", "action.primary", "action.secondary"]) {
    const value = intentValue(intent, key);
    if (!value) continue;
    layout.push(sentence(value));
    coverage.represent(key, "prompt");
  }
  if (layout.length) sections.push({ title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.layout, body: layout.join(" ") });

  const environment = intentValue(intent, "environment");
  if (environment) {
    sections.push({ title: GPT_IMAGE_2_PLAYBOOK.sectionTitles.environment, body: sentence(environment) });
    coverage.represent("environment", "prompt");
  }
  for (const key of ["performance.emotion", "performance.body", "action.environment", "camera.lens", "state.initial"]) {
    if (!intentValue(intent, key) || coverage.has(key)) continue;
    coverage.omit(key, "Blocking records position and mass only; this is directed on the frame pass.");
  }
  applyOmissions(ctx, GPT_IMAGE_2_PLAYBOOK.blockingOmits);
  applyOmissions(ctx, GPT_IMAGE_2_PLAYBOOK.omittedByDesign);
  return sections;
}

const MODE_COMPILERS = {
  t2i: compileT2I,
  edit: compileEdit,
  inpaint: compileEdit,
  "multi-reference": compileMultiReference,
  blocking: compileBlocking,
};

/* ---------------------------------------------------------------------------
   Pack entry point. */
function compileMode(context) {
  const mode = text(context.mode);
  const build = MODE_COMPILERS[mode];
  if (!build) throw new Error(`GPT Image 2 has no compiler for mode ${mode || "(none)"}.`);

  const capability = context.capability || capabilityLayer(mode, context.surface);
  const manifest = applyReferenceLimits(context.manifest || [], capability, context.coverage);
  const ctx = { ...context, mode, manifest, capability };

  const sections = build(ctx);
  const chosen = pickSize(context.resolution, ctx.aspectRatio, capability, context.coverage);
  const quality = pickQuality(context.quality, mode, context.coverage);

  /* Which reference fills which model input, namespaced by model in the plan's
     settings.extensions, because it is adapter knowledge and production intent must
     stay portable without it. */
  const bindings = {};
  manifest.forEach((row, index) => {
    bindings[row.refId] = row.role === "mask" ? "mask" : `image[${index}]`;
  });

  const parameters = { model: GPT_IMAGE_2_FACTS.apiModelIdentifier, quality, referenceBindings: bindings };
  if (chosen.size) parameters.size = chosen.size;

  return {
    sections,
    references: manifest,
    model: { family: GPT_IMAGE_2_FACTS.family, variant: "standard" },
    /* No duration, no fps, no audio. A still image result carries none of them, and the
       job contract refuses each one on an image job — which is the check that proves
       this pack is not quietly copying a video pack's output block. */
    output: { candidateCount: Number(context.candidateCount) > 0 ? Number(context.candidateCount) : undefined },
    parameters,
  };
}

const pack = registerModelPack({
  packId: PACK_ID,
  packVersion: PACK_VERSION,
  playbook: GPT_IMAGE_2_PLAYBOOK,
  facts: GPT_IMAGE_2_FACTS,
  models: { "gpt-image-2/standard": { variant: "standard" } },
  evidence: {
    record: "docs/architecture/model-evidence/gpt-image-2.json",
    sources: [{ id: "model-page" }, { id: "image-guide" }, { id: "cinebraid-profiles" }],
  },
  capabilityLayer,
  checkpointForMode,
  compileMode,
});

module.exports = {
  PACK_ID,
  PACK_VERSION,
  GPT_IMAGE_2_FACTS,
  GPT_IMAGE_2_PLAYBOOK,
  SIZES_BY_RATIO,
  capabilityLayer,
  checkpointForMode,
  compileMode,
  pack,
  pickQuality,
  pickSize,
};

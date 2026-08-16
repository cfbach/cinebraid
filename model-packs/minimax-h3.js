/* MiniMax H3 model pack — CineBraid's first complete reference implementation.
 *
 * A model pack is two things that must never be confused, so they are two objects in
 * this file and nothing reads across the line:
 *
 *   FACTS     what H3 objectively is and can do, taken from primary MiniMax sources
 *             and recorded with them. A fact that no official source establishes is
 *             absent, not guessed.
 *             See docs/architecture/model-evidence/minimax-h3.json.
 *
 *   PLAYBOOK  how to write FOR H3, taken from MiniMax's own prompt-writing guides.
 *             Editorial policy. Versioned separately so improving the wording never
 *             looks like a capability change.
 *
 * The distinction matters in a specific way here. Three separate boundaries run through
 * this model and collapsing any of them produces a wrong answer:
 *
 *   model vs provider     H3 accepts a 7,000-character prompt. fal's queue schema
 *                         accepts 2,000. The first is a model fact; the second belongs
 *                         to a backend and is applied where the backend is known.
 *
 *   local vs hosted       the open weights are H3-Base and render 768p. 2K comes from
 *                         H3-Regenerate-2K, which is not open-sourced. A local install
 *                         is not a smaller version of the API; it is a different set
 *                         of capabilities, so `surface` is part of the question.
 *
 *   checkpoint vs family  FL2VA and Ref2VA are different released checkpoints. What
 *                         one can do says nothing about the other, which is why
 *                         variant is part of model identity rather than a label.
 *
 * H3-Context-IR is deliberately NOT integrated, and it is worth being precise about what
 * it is, because "the hosted API runs it for you" would be wrong. It is a SEPARATE
 * hosted endpoint — POST /v2/h3_context_ir — that interprets multimodal inputs and
 * returns an enhanced prompt. MiniMax's own reference states it does not create a video
 * generation task. Nothing documents it as a prerequisite: POST /v2/video_generation
 * takes a plain natural-language text item directly, for every mode.
 *
 * So Context-IR is one optional way to turn loose intent into a well-formed prompt.
 * CineBraid does that job itself, deterministically, from production state — which is
 * the entire point of this layer, and why a baseline plan needs no LLM and no network.
 */

const { registerModelPack } = require("../generation-compiler");

const PACK_ID = "minimax-h3";
const PACK_VERSION = "1.0.0";

/* ===========================================================================
   A. OBJECTIVE CAPABILITY FACTS

   Every value here is traceable to an entry in data/model-evidence/minimax-h3.json.
   `null` means no official source establishes it; it does not mean "none". */

const H3_FACTS = {
  family: "minimax-h3",
  vendor: "MiniMax",
  /* Two task-specific checkpoints were released. They are not interchangeable. */
  checkpoints: {
    fl2va: {
      /* Zero, one or two images: the same checkpoint covers text-to-video,
         first-frame, last-frame-only and first-and-last. */
      modes: ["t2v", "i2v", "flf"],
      maxReferenceImages: 2,
      maxReferenceVideos: 0,
      maxReferenceAudio: 0,
      referenceRoles: ["first-frame", "last-frame"],
    },
    ref2va: {
      modes: ["r2v"],
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      maxReferenceAudio: 3,
      /* Ref2VA's own vocabulary is Subject / Picture / Video / Audio; these are the
         CineBraid production roles that map onto it. */
      referenceRoles: [
        "identity", "outfit", "expression", "body", "pose", "turnaround",
        "continuity-state", "location", "prop", "scale", "style", "reference",
        "reference-sheet", "alternate-view", "detail",
        "first-frame", "last-frame",
        /* Ref2VA's Picture inputs are ordered, and CineBraid's multi-frame workflow
           is the thing that orders them. */
        "sequential-keyframe", "waypoint",
        "composition", "base",
        "motion-reference", "camera-reference", "performance-reference",
        "voice", "audio-timing", "sound-reference",
      ],
      maxReferenceFilesTotal: 12,
      audioRequiresVisual: true,
      referenceClipSeconds: [2, 15],
      referenceClipTotalSeconds: 15,
    },
  },
  durationSeconds: [4, 15],
  durationIsInteger: true,
  fps: 24,
  aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  /* Text-to-video must name a ratio and may not use adaptive; a mode with an image
     input takes its ratio from that image. */
  textToVideoRequiresExplicitRatio: true,
  imageInputRatioIsAdaptive: true,
  nativeAudio: { supported: true, channels: "stereo", sampleRateHz: 32000 },
  speechLanguages: [
    "Arabic", "Chinese", "English", "French", "German", "Italian",
    "Japanese", "Korean", "Portuguese", "Russian", "Spanish",
  ],
  maxPromptCharacters: 7000,
  /* Not established. No MiniMax source — model card, API reference or prompt guide —
     documents a seed, a random-seed field or any other reproducibility control. That
     is recorded as an absence rather than assumed to be false, and it is why the
     capability flag below is explicitly false rather than merely missing: a caller
     that supplies a seed gets a warning instead of silence. */
  seed: { supported: false, establishedBy: "absence-in-official-api-reference" },
  surfaces: {
    local: {
      /* Open weights, H3-Base. */
      resolutions: ["768P"],
      note: "Open-weight H3-Base renders at 768p. H3-Regenerate-2K is not open-sourced.",
    },
    api: {
      resolutions: ["768P", "2K"],
      note: "Hosted MiniMax-H3. 2K is produced by the hosted H3-Regenerate-2K module.",
    },
  },
};

/* Which checkpoint serves a mode. Data, not a conditional on a model name. */
function checkpointForMode(mode) {
  for (const [name, checkpoint] of Object.entries(H3_FACTS.checkpoints))
    if (checkpoint.modes.includes(String(mode))) return { name, ...checkpoint };
  return null;
}

/* The ModelCapability descriptor this pack contributes to the existing four-layer
   resolver. It is one layer of the intersection, never the whole answer: a backend, a
   node and a recipe still get their say, which is how a locally installed H3 that
   cannot reach the 2K module ends up correctly unable to offer 2K. */
function capabilityLayer(mode, surface = "api") {
  const checkpoint = checkpointForMode(mode);
  const face = H3_FACTS.surfaces[String(surface)] || H3_FACTS.surfaces.api;
  if (!checkpoint) return { modes: [] };
  return {
    modes: checkpoint.modes,
    referenceRoles: checkpoint.referenceRoles,
    maxReferenceImages: checkpoint.maxReferenceImages,
    maxReferenceVideos: checkpoint.maxReferenceVideos,
    maxReferenceAudio: checkpoint.maxReferenceAudio,
    resolutions: face.resolutions,
    aspectRatios: H3_FACTS.aspectRatios,
    fps: [String(H3_FACTS.fps)],
    durationSeconds: H3_FACTS.durationSeconds,
    /* The MODEL's ceiling. A backend that accepts less declares its own and the
       intersection takes the smaller — which is how fal's 2,000-character queue schema
       narrows this without ever being mistaken for what H3 can read. */
    maxPromptCharacters: H3_FACTS.maxPromptCharacters,
    flags: {
      firstFrame: checkpoint.referenceRoles.includes("first-frame"),
      lastFrame: checkpoint.referenceRoles.includes("last-frame"),
      nativeAudio: H3_FACTS.nativeAudio.supported,
      seed: H3_FACTS.seed.supported,
      mask: false,
      referenceWeights: false,
    },
  };
}

/* ===========================================================================
   B. PROMPTING POLICY

   From MiniMax's own guides: VIDEO_PROMPT_WRITING_GUIDE_base_en.md for T2VA / I2VA /
   FL2VA and VIDEO_PROMPT_WRITING_GUIDE_ref_en.md for Ref2VA. Editorial, versioned
   independently of the facts above. */

const H3_PLAYBOOK = {
  version: "2026-08-08",
  /* H3's documented camera description is three-part — motion type, amplitude, speed —
     written as prose inside the shot rather than stacked as labels after it. */
  camera: {
    amplitude: { small: "with small amplitude", large: "with large amplitude" },
    speed: { slow: "at slow speed", fast: "at fast speed" },
    smallWords: /\b(slight|subtle|gentle|restrained|small|slow|micro|minimal)\b/i,
    largeWords: /\b(sweep|whip|crash|wide|large|strong|aggressive|fast|rapid)\b/i,
    slowWords: /\b(slow|gradual|gentle|creep|drift|measured)\b/i,
    fastWords: /\b(fast|rapid|quick|snap|whip|sudden)\b/i,
    lockedWords: /\b(locked|static|stationary|fixed|no camera movement|does not move)\b/i,
  },
  /* MiniMax's I2VA guidance is more specific than "do not repeat the image", and getting
     this wrong in either direction costs quality. Section 3.1 of the base guide says the
     description should FIRST establish the style, subjects, composition and scene anchors
     in the image, and THEN describe the next action.

     That is not a contradiction of the anchoring principle, it is the distinction between
     what the model can see and what the prompt has committed to: naming the anchors in
     language is what stops the generation drifting off them. What it does not license is
     reconstructing the frame in prose, which competes with the frame itself.

     So the orientation is deliberately CLIPPED — enough words to name each anchor, not
     enough to reproduce it — and it changes nothing about coverage. These intents stay
     `anchored`, because the frame is still what establishes them; the sentence is a
     pointer, not the carrier. */
  anchorOrientation: {
    /* The guide's own order: style, subjects, composition, scene. */
    order: ["style.visual", "state.initial", "identity.canon", "environment"],
    maxWordsPerAnchor: 10,
  },
  /* The intents an image input makes authoritative, per mode; the compiler marks them
     anchored rather than dropping them. */
  anchoredBy: {
    i2v: {
      "state.initial": { via: "the supplied first frame", requires: "first-frame" },
      environment: { via: "the supplied first frame", requires: "first-frame" },
      "identity.canon": { via: "the supplied first frame", requires: "first-frame" },
      "style.visual": { via: "the supplied first frame", requires: "first-frame" },
    },
    flf: {
      "state.initial": { via: "the supplied first frame", requires: "first-frame" },
      "state.final": { via: "the supplied final frame", requires: "last-frame" },
      environment: { via: "the supplied first frame", requires: "first-frame" },
      "identity.canon": { via: "the supplied first frame", requires: "first-frame" },
      "style.visual": { via: "the supplied first frame", requires: "first-frame" },
    },
  },
  /* The soundscape field must not restate dialogue or music the characters can hear;
     both are directed elsewhere. Recorded as policy so the reason survives a rewrite. */
  soundscapeExcludes: ["dialogue.line", "sound.music"],
  sectionTitles: {
    shot: "SHOT",
    subject: "SUBJECT AND ENVIRONMENT",
    framing: "FRAMING AND STAGING",
    alignment: "IMAGE ALIGNMENT",
    endpoints: "ENDPOINT CONTRACT",
    definitions: "REFERENCE DEFINITIONS",
    retention: "WHAT EACH REFERENCE FIXES",
    action: "ACTION",
    change: "WHAT CHANGES",
    trajectory: "TRAJECTORY",
    camera: "CAMERA",
    performance: "PERFORMANCE",
    dialogue: "DIALOGUE",
    soundscape: "SOUNDSCAPE",
    music: "MUSIC",
    continuity: "CONTINUITY",
  },
  /* Two surfaces, two documented input contracts.

     LOCAL: an open-weight H3-Base deployment is given the prompt directly, and the base
     guide documents the document it expects — an image-alignment instruction followed by
     integrated_multimodal_description, overall_soundscape and non_diegetic_music.

     API: POST /v2/video_generation documents a plain natural-language text item, up to
     7,000 characters, with no required structure. Readable prose sections are what that
     contract asks for.

     Note what this is NOT: it is not "the API runs Context-IR so it wants prose". Nothing
     documents Context-IR as part of a /v2/video_generation call. The two serialisations
     exist because MiniMax documents two different input contracts, and collapsing them
     would send one surface a document the other was specified for. */
  serialisation: {
    local: "h3-base-fields",
    api: "sections",
  },
};

/* ---------------------------------------------------------------------------
   Text helpers. */
function text(value) {
  return String(value == null ? "" : value).trim();
}
function sentence(value) {
  /* Production fields are authored by hand and arrive punctuated inconsistently, and
     several are concatenated upstream before they reach here. Normalising the run-on
     stops "…with both hands.. Object interaction:" reaching a model. */
  const clean = text(value).replace(/\.{2,}(?!\.)/g, ".").replace(/\s+([,.;:])/g, "$1");
  return clean && !/[.!?]$/.test(clean) ? `${clean}.` : clean;
}
function lowerFirst(value) {
  const clean = text(value);
  /* An identifier-shaped token must keep its case; lowering the first letter of one
     would also defeat the compiler's identifier scrub, which matches exactly. */
  if (/^[A-Z0-9]{2,}[-_]/.test(clean)) return clean;
  return clean ? clean.charAt(0).toLowerCase() + clean.slice(1) : "";
}
function upperFirst(value) {
  const clean = text(value);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "";
}
function article(count) {
  return /^(8|11|18|8\d|11\d|18\d)/.test(String(count)) ? "An" : "A";
}
/* Several production fields are already written as instructions ("preserve medium-wide
   framing"). Wrapping one in a second instruction produces "Hold the preserve medium-wide
   framing", so a field that already commands is used as it stands. */
const ALREADY_IMPERATIVE = /^(preserve|hold|keep|maintain|retain|stay|remain|lock|do not|don't|avoid|no\b)/i;
function instruct(lead, value) {
  const clean = text(value);
  if (!clean) return "";
  return ALREADY_IMPERATIVE.test(clean) ? sentence(upperFirst(clean)) : sentence(`${lead} ${lowerFirst(clean)}`);
}
function intentValue(intent, key) {
  const row = (intent || []).find((item) => item.key === key);
  return row ? row.value : "";
}
function joinClauses(parts) {
  return parts.map(text).filter(Boolean).join(" ");
}

/* H3's documented camera form: motion, then amplitude, then speed, as one sentence. */
function cameraSentence(movement, stability) {
  const raw = text(movement);
  if (!raw) return "";
  const policy = H3_PLAYBOOK.camera;
  if (policy.lockedWords.test(raw)) return "The camera holds a static shot with no movement.";
  const context = `${raw} ${text(stability)}`;
  const amplitude = policy.largeWords.test(context)
    ? policy.amplitude.large
    : policy.smallWords.test(context)
      ? policy.amplitude.small
      : "";
  const speed = policy.fastWords.test(context)
    ? policy.speed.fast
    : policy.slowWords.test(context)
      ? policy.speed.slow
      : "";
  const lead = /^(the\s+)?camera\b/i.test(raw) ? lowerFirst(raw.replace(/^the\s+/i, "")) : `camera ${lowerFirst(raw)}`;
  return sentence(joinClauses([`The ${lead}`, amplitude, speed]));
}

/* Beats in chronological order. The first carries no timestamp; the rest do, strictly
   increasing, which is the documented shot-list form.

   The declared windows cannot be trusted to be a timeline. Several upstream writers
   legitimately push a beat with the shot's full span — a structured motion plan, a
   motion brief, the shot synopsis — so a shot routinely arrives with three beats all
   claiming 0 to 8 seconds. Emitting those verbatim gives the model three simultaneous
   instructions at the same instant, which is not what any of the three writers meant.
   So declared times are used only while they genuinely advance, and an even spread
   takes over the moment they stop. */
function beatLines(specOrBeats, durationSeconds) {
  const actions = (Array.isArray(specOrBeats?.actions) ? specOrBeats.actions : [])
    .filter((item) => text(item?.action));
  if (!actions.length) return [];
  const duration = Number(durationSeconds) > 0 ? Number(durationSeconds) : 5;
  const strictlyIncreasing = actions.every((item, index) =>
    !index || (Number.isFinite(Number(item.start)) && Number(item.start) > Number(actions[index - 1].start)));

  /* The same beat reaches the spec from more than one writer — a structured motion plan,
     a motion brief and the shot synopsis all contribute — so a beat already stated
     inside an earlier one is a restatement, not a second event. Dropped by containment,
     which is deterministic and cannot remove anything the model has not already been
     told. */
  const kept = [];
  for (const item of actions) {
    const clean = sentence(text(item.action));
    const normal = clean.toLowerCase();
    if (kept.some((row) => row.normal.includes(normal))) continue;
    kept.push({ item, clean, normal });
  }
  return kept.map((row, index) => {
    if (!index) return row.clean;
    const start = strictlyIncreasing
      ? Math.min(duration, Math.max(0, Number(row.item.start)))
      : (duration * index) / kept.length;
    return `At ${start.toFixed(2)}s, ${row.clean}`;
  });
}

/* ---------------------------------------------------------------------------
   Reference presentation.

   Ref2VA's guide numbers references within each modality and states their production
   meaning in words. That is exactly what the planner's manifest already carries, so the
   pack only has to render it — and rendering from the manifest rather than from array
   position is what keeps a reference's job attached to the reference. */
function referenceToken(row, counters) {
  const kind = row.mediaType === "video" ? "Video" : row.mediaType === "audio" ? "Audio" : "Picture";
  counters[kind] = (counters[kind] || 0) + 1;
  return `<${kind} ${counters[kind]}>`;
}

function describeReference(row, token) {
  const who = text(row.production.entityName);
  const label = text(row.production.label);
  const purpose = text(row.production.purpose);
  const state = text(row.production.continuityState);
  const subject = who || label;
  return `${token} is ${subject}${state ? ` in its ${state} state` : ""} — ${purpose || "an approved reference"}.`;
}

/* Capability decides how many of each modality may travel. When more are selected than
   the configuration accepts, the excess is chosen by a fixed policy — required roles
   first, then the planner's canonical order — and every dropped reference produces a
   warning naming it. Nothing is discarded quietly. */
function applyReferenceLimits(manifest, capability, coverage) {
  const limits = {
    image: capability?.maxReferenceImages,
    video: capability?.maxReferenceVideos,
    audio: capability?.maxReferenceAudio,
  };
  /* Decided in priority order — a required role before an influence, then the planner's
     canonical order — so a voice or an identity reference is never the one dropped to
     make room for a mood board. Reported and returned in canonical order, so the plan
     still reads the same way whichever references survived. */
  const byPriority = [...manifest].sort((a, b) =>
    (a.required === b.required ? a.order - b.order : (a.required ? -1 : 1)));
  const keptIds = new Set();
  const refused = new Map();
  const counts = { image: 0, video: 0, audio: 0 };
  for (const row of byPriority) {
    const limit = limits[row.mediaType];
    if (Array.isArray(capability?.referenceRoles) && !capability.referenceRoles.includes(row.role)) {
      refused.set(row.refId, {
        code: "reference-role-unsupported",
        field: `references.${row.refId}`,
        message: `${row.production.label} was not sent: this configuration does not accept a ${row.role} reference.`,
        action: "Remove the reference, or choose a mode that accepts it.",
      });
      continue;
    }
    if (Number.isFinite(limit) && counts[row.mediaType] >= limit) {
      refused.set(row.refId, {
        code: "reference-over-limit",
        field: `references.${row.refId}`,
        message: `${row.production.label} was not sent: this configuration accepts ${limit} ${row.mediaType} reference${limit === 1 ? "" : "s"}.`,
        action: `Deselect a ${row.mediaType} reference, or choose a configuration that accepts more.`,
      });
      continue;
    }
    counts[row.mediaType] += 1;
    keptIds.add(row.refId);
  }
  const kept = manifest.filter((row) => keptIds.has(row.refId));
  for (const row of manifest) if (refused.has(row.refId)) coverage.warn(refused.get(row.refId));
  /* Ref2VA refuses audio as the only input. Saying so before dispatch is better than a
     provider error after it. */
  if (kept.length && kept.every((row) => row.mediaType === "audio"))
    coverage.warn({
      code: "audio-only-reference-package",
      field: "references",
      message: "MiniMax H3 cannot generate from audio references alone; at least one image or video reference is required.",
      action: "Add an approved image or video reference.",
    });
  return kept;
}

/* ---------------------------------------------------------------------------
   Shared section builders. Every mode uses these for the things that are the same and
   diverges where the filmmaking contract genuinely differs. */

function performanceSection(intent, coverage, titles) {
  const parts = [
    intentValue(intent, "performance.emotion"),
    intentValue(intent, "performance.facial"),
    intentValue(intent, "performance.body"),
    intentValue(intent, "performance.gaze") ? `gaze ${intentValue(intent, "performance.gaze")}` : "",
  ].filter(Boolean);
  for (const key of ["performance.emotion", "performance.facial", "performance.body", "performance.gaze"])
    if (intentValue(intent, key)) coverage.represent(key, "prompt");
  return parts.length ? { title: titles.performance, body: sentence(upperFirst(parts.join("; "))) } : null;
}

/* `includeFraming` is false in the modes that already stated framing alongside the
   staging. Saying it twice is not emphasis; it is two instructions the model has to
   reconcile. The coverage entry is recorded where it was said. */
function cameraSection(intent, spec, coverage, titles, { includeFraming = true } = {}) {
  const movement = intentValue(intent, "camera.movement");
  const framing = intentValue(intent, "camera.framing");
  const timing = intentValue(intent, "camera.timing");
  const lens = intentValue(intent, "camera.lens");
  const parts = [];
  if (movement) {
    parts.push(cameraSentence(movement, spec.camera?.stability));
    coverage.represent("camera.movement", "prompt");
  }
  if (timing) {
    parts.push(sentence(`The move ${lowerFirst(timing)}`));
    coverage.represent("camera.timing", "prompt");
  }
  if (framing && includeFraming) {
    parts.push(instruct("Hold the", framing));
    coverage.represent("camera.framing", "prompt");
  }
  if (lens) {
    parts.push(sentence(upperFirst(lens)));
    coverage.represent("camera.lens", "prompt");
  }
  return parts.length ? { title: titles.camera, body: joinClauses(parts) } : null;
}

/* Framing and staging together: where the frame sits and how the subjects move through
   it. Both are director's decisions and both were being dropped entirely before this
   pack existed, so they are stated once, early, and recorded. */
function framingSection(intent, coverage, titles, extra = []) {
  const framing = intentValue(intent, "camera.framing");
  const staging = intentValue(intent, "staging");
  const parts = [];
  if (framing) {
    parts.push(instruct("Hold the", framing));
    coverage.represent("camera.framing", "prompt");
  }
  if (staging) {
    parts.push(sentence(upperFirst(staging)));
    coverage.represent("staging", "prompt");
  }
  for (const part of extra) if (text(part)) parts.push(sentence(upperFirst(part)));
  return parts.length ? { title: titles.framing, body: joinClauses(parts) } : null;
}

function dialogueSection(intent, spec, coverage, titles) {
  const line = intentValue(intent, "dialogue.line");
  if (!line) return null;
  const speaker = text(spec.audio?.speakerName) || "the speaking character";
  const delivery = intentValue(intent, "dialogue.delivery");
  const timing = intentValue(intent, "dialogue.timing");
  const voice = intentValue(intent, "dialogue.voice");
  /* Speaker identity, delivery and timing sit OUTSIDE the quoted content; the words
     themselves are reproduced exactly. Both are documented requirements. */
  const parts = [`(S1) ${speaker} says, exactly: “${line.replace(/^["“']|["”']$/g, "")}”`];
  if (delivery) {
    parts.push(sentence(`Delivery: ${delivery}`));
    coverage.represent("dialogue.delivery", "prompt");
  }
  if (voice) {
    parts.push(sentence(`Voice: ${voice}`));
    coverage.represent("dialogue.voice", "prompt");
  }
  if (timing) {
    parts.push(sentence(`The line runs ${timing.replace("-", " to ")}`));
    coverage.represent("dialogue.timing", "prompt");
  }
  coverage.represent("dialogue.line", "prompt");
  return { title: titles.dialogue, body: joinClauses(parts) };
}

function soundSections(intent, coverage, titles) {
  const sections = [];
  const ambient = [
    intentValue(intent, "sound.effects"),
    intentValue(intent, "sound.ambience"),
    intentValue(intent, "sound.silence"),
    intentValue(intent, "sound.priorities"),
  ].filter(Boolean);
  for (const key of ["sound.effects", "sound.ambience", "sound.silence", "sound.priorities"])
    if (intentValue(intent, key)) coverage.represent(key, "prompt");
  if (ambient.length) sections.push({ title: titles.soundscape, body: sentence(ambient.join("; ")) });
  const music = intentValue(intent, "sound.music");
  if (music) {
    /* Kept out of the soundscape on purpose, and the reason is recorded rather than
       implied: the guides treat music the audience hears and sound the characters hear
       as different fields, and merging them is a documented mistake. */
    sections.push({ title: titles.music, body: sentence(music) });
    coverage.represent("sound.music", "prompt");
  }
  return sections;
}

function continuitySection(intent, coverage, titles, { includeCanon = true } = {}) {
  const parts = [];
  if (includeCanon && intentValue(intent, "identity.canon")) {
    parts.push(sentence(intentValue(intent, "identity.canon")));
    coverage.represent("identity.canon", "prompt");
  }
  for (const [key, lead] of [
    ["continuity.drift", ""],
    ["continuity.preserve", "Keep unchanged:"],
    ["continuity.avoid", "Do not introduce:"],
  ]) {
    const value = intentValue(intent, key);
    if (!value) continue;
    parts.push(sentence(joinClauses([lead, value])));
    coverage.represent(key, "prompt");
  }
  return parts.length ? { title: titles.continuity, body: joinClauses(parts) } : null;
}

/* Duration, aspect ratio and resolution are parameters, not prose. Recording them as
   `parameter` coverage is what stops a compiler from "expressing" a duration by
   writing the number into a sentence and calling the intent handled. */
function outputParameters(ctx, coverage) {
  const { mode, spec, capability, surface } = ctx;
  const requested = Number(ctx.durationSeconds) || Number(spec.durationSeconds) || 0;
  /* The EFFECTIVE range, not the model's. H3 itself renders from 4 seconds; a backend
     that starts at 5 has already narrowed that through the capability intersection, and
     snapping to the model's floor here would compile a plan the backend must reject.
     H3_FACTS stays the model fact and is the fallback when nothing has narrowed it. */
  const range = Array.isArray(capability?.durationSeconds) && capability.durationSeconds.length === 2
    && capability.durationSeconds.every((value) => Number.isFinite(Number(value)))
    ? capability.durationSeconds.map(Number)
    : H3_FACTS.durationSeconds;
  const [floor, ceiling] = range;
  const [modelFloor, modelCeiling] = H3_FACTS.durationSeconds;
  let duration = Math.min(ceiling, Math.max(floor, requested || floor));
  if (H3_FACTS.durationIsInteger) duration = Math.round(duration);
  if (requested && duration !== requested)
    coverage.warn({
      code: "duration-adjusted",
      field: "output.durationSeconds",
      /* Named honestly: when the configuration is tighter than the model, saying "H3
         renders 5 to 15" would be false about H3 and would follow the number to a
         backend that has no such rule. */
      message: floor === modelFloor && ceiling === modelCeiling
        ? `MiniMax H3 renders whole seconds from ${floor} to ${ceiling}; ${requested}s becomes ${duration}s.`
        : `This configuration renders whole seconds from ${floor} to ${ceiling} (MiniMax H3 itself renders ${modelFloor} to ${modelCeiling}); ${requested}s becomes ${duration}s.`,
      action: `Set the shot to ${duration} seconds to remove this adjustment.`,
    });
  if (requested) coverage.represent("timing.duration", "parameter");

  const face = H3_FACTS.surfaces[String(surface)] || H3_FACTS.surfaces.api;
  const allowed = Array.isArray(capability?.resolutions) && capability.resolutions.length
    ? capability.resolutions
    : face.resolutions;
  /* The REQUESTED resolution, checked against what the configuration allows.
     `capability.resolutions` arrives in the resolver's canonical sort, which its own
     documentation says carries no preference — reading the last entry of it picked
     "768P" out of ["2K","768P"] and quietly downgraded every render. The fallback is
     the surface's own authored list, which IS written low-to-high. */
  const wantedResolution = text(ctx.resolution).toUpperCase();
  const preferred = face.resolutions.filter((value) => allowed.includes(value));
  const fallbackResolution = preferred[preferred.length - 1] || allowed[allowed.length - 1];
  let resolution = fallbackResolution;
  if (wantedResolution && allowed.includes(wantedResolution)) {
    resolution = wantedResolution;
  } else if (wantedResolution) {
    coverage.warn({
      code: "resolution-unsupported",
      field: "output.resolution",
      message: `This configuration cannot render ${wantedResolution}; ${fallbackResolution} is used instead.`,
      action: `Choose one of ${allowed.join(", ")}.`,
    });
  }
  const parameters = { duration, resolution, fps: H3_FACTS.fps };

  const aspect = text(ctx.aspectRatio);
  const unsupportedAspect = () => {
    coverage.unsupported("output.aspectRatio", `MiniMax H3 does not offer ${aspect}.`, {
      code: "aspect-unsupported",
      field: "output.aspectRatio",
      message: `MiniMax H3 does not offer ${aspect}; supported ratios are ${H3_FACTS.aspectRatios.join(", ")}.`,
      action: `Set the project aspect ratio to one of ${H3_FACTS.aspectRatios.join(", ")}.`,
    });
    /* Recorded as asked for, not silently replaced. The plan is a faithful record of
       what the production wanted; refusing it is the backend's job, and it can only
       refuse a ratio by name if the ratio is still there to name. */
    parameters.ratio = aspect;
  };
  if (mode === "t2v") {
    /* Text-to-video must name a ratio and may not be adaptive. */
    if (aspect && H3_FACTS.aspectRatios.includes(aspect)) {
      parameters.ratio = aspect;
      coverage.represent("output.aspectRatio", "parameter");
    } else if (aspect) {
      unsupportedAspect();
    }
  } else if (mode === "r2v") {
    /* Ref2VA is the one media-carrying mode with a real ratio field AND a documented
       "adaptive" value. A production that has declared a format keeps it; only a
       production that declared none, or asked for adaptive, lets the references decide.
       Forcing adaptive here would deliver a vertical production as whatever shape its
       first keyframe happened to be, which is the same class of defect as substituting
       16:9 for 2.39:1. */
    const wantsAdaptive = !aspect || aspect === "adaptive";
    if (!wantsAdaptive && H3_FACTS.aspectRatios.includes(aspect)) {
      parameters.ratio = aspect;
      coverage.represent("output.aspectRatio", "parameter");
    } else if (!wantsAdaptive) {
      unsupportedAspect();
    } else {
      parameters.ratio = "adaptive";
      anchorAspectToMedia(ctx, coverage, mode);
    }
  } else if (aspect) {
    parameters.ratio = "adaptive";
    anchorAspectToMedia(ctx, coverage, mode);
  }
  return parameters;
}

/* Every mode with supplied media takes its ratio from that media, so the project's
   ratio is genuinely established elsewhere rather than ignored — but only if there is
   media to establish it. Naming the actual reference keeps the anchor checkable;
   claiming "the supplied image" when none was selected would read as accounted for
   while nothing held it. */
function anchorAspectToMedia(ctx, coverage, mode) {
  const visual = (ctx.manifest || []).find((row) => row.mediaType === "image")
    || (ctx.manifest || []).find((row) => row.mediaType === "video");
  if (visual) coverage.anchor("output.aspectRatio", `${visual.production.label}, whose ratio the shot adopts`);
  else coverage.omit("output.aspectRatio",
    `MiniMax H3 derives the ratio from the supplied media in ${mode}; with no visual reference selected there is nothing for the project ratio to apply to.`);
}

/* ---------------------------------------------------------------------------
   The four mode contracts. */

function compileT2V(ctx) {
  const { intent, spec, coverage } = ctx;
  const titles = H3_PLAYBOOK.sectionTitles;
  const sections = [];
  const parameters = outputParameters(ctx, coverage);

  /* Nothing is anchored: there is no image. Everything the shot knows about who and
     where has to be constructed, which is what makes T2V a different document rather
     than the same one with a frame removed. */
  const subject = [
    intentValue(intent, "state.initial"),
    intentValue(intent, "identity.canon"),
    /* The identity canon block already restates a location's approved description when
       the shot has one, so repeating it as the environment produces the same paragraph
       twice. Deduplicated by containment rather than by guessing which field wins. */
    dedupe(intentValue(intent, "environment"), intentValue(intent, "identity.canon")),
    intentValue(intent, "style.visual"),
  ].filter(Boolean);
  for (const key of ["state.initial", "identity.canon", "environment", "style.visual"])
    if (intentValue(intent, key)) coverage.represent(key, "prompt");
  if (subject.length) sections.push({ title: titles.subject, body: sentence(subject.join(" ")) });

  const framing = framingSection(intent, coverage, titles);
  if (framing) sections.push(framing);

  sections.push(...actionSections(ctx, titles.action));
  const camera = cameraSection(intent, spec, coverage, titles, { includeFraming: false });
  if (camera) sections.push(camera);
  const performance = performanceSection(intent, coverage, titles);
  if (performance) sections.push(performance);
  const dialogue = dialogueSection(intent, spec, coverage, titles);
  if (dialogue) sections.push(dialogue);
  sections.push(...soundSections(intent, coverage, titles));
  const continuity = continuitySection(intent, coverage, titles, { includeCanon: false });
  if (continuity) sections.push(continuity);

  closeProductionOnlyIntent(ctx, "t2v");
  return { sections, parameters, header: `${titles.shot}\n${article(parameters.duration)} ${parameters.duration}-second single shot.` };
}

function compileI2V(ctx) {
  const { intent, spec, coverage, manifest } = ctx;
  const titles = H3_PLAYBOOK.sectionTitles;
  const sections = [];
  const parameters = outputParameters(ctx, coverage);
  const first = manifest.find((row) => row.role === "first-frame");

  anchorFor(ctx, "i2v");
  sections.push({
    title: titles.alignment,
    body: joinClauses([
      `The supplied first frame is the exact opening frame${first ? ` — ${first.production.label}` : ""}.`,
      anchorOrientation(ctx),
      "Hold those exactly as the frame shows them; do not restage, mirror, reframe or re-invent them, and do not reconstruct the image in words.",
      "Everything below describes what changes from there.",
    ]),
  });

  /* The whole document is about change, because everything static is already fixed by
     the frame. Staging survives here even though the frame anchors the opening: where a
     subject MOVES to is not something a still can establish. */
  sections.push(...actionSections(ctx, titles.change));
  const staging = intentValue(intent, "staging");
  if (staging) {
    sections.push({ title: titles.framing, body: sentence(upperFirst(staging)) });
    coverage.represent("staging", "prompt");
  }
  const camera = cameraSection(intent, spec, coverage, titles);
  if (camera) sections.push(camera);
  const performance = performanceSection(intent, coverage, titles);
  if (performance) sections.push(performance);
  const dialogue = dialogueSection(intent, spec, coverage, titles);
  if (dialogue) sections.push(dialogue);
  sections.push(...soundSections(intent, coverage, titles));
  /* Identity canon is anchored by the frame, so the continuity section carries only the
     requirements that are about holding it there. */
  const continuity = continuitySection(intent, coverage, titles, { includeCanon: false });
  if (continuity) sections.push(continuity);

  closeProductionOnlyIntent(ctx, "i2v");
  return { sections, parameters, header: `${titles.shot}\n${article(parameters.duration)} ${parameters.duration}-second continuation of the supplied frame.` };
}

function compileFLF(ctx) {
  const { intent, spec, coverage, manifest } = ctx;
  const titles = H3_PLAYBOOK.sectionTitles;
  const sections = [];
  const parameters = outputParameters(ctx, coverage);
  const first = manifest.find((row) => row.role === "first-frame");
  const last = manifest.find((row) => row.role === "last-frame");

  anchorFor(ctx, "flf");
  if (!last)
    coverage.warn({
      code: "missing-endpoint",
      field: "endpoints.lastFrame",
      message: "First/last-frame generation needs an approved final frame; none is selected.",
      action: "Approve and select the ending frame.",
    });

  /* Both endpoints are inputs. The prompt describes the route between them and says so
     explicitly; it never substitutes a description of the ending for the ending. */
  /* The same verbal anchoring the I2VA guidance asks for, and the FL2VA structure the
     guide documents — first-frame state, intermediate change, last-frame state. The
     orientation names the FIRST frame only: describing the ending in prose is the exact
     failure the endpoint binding exists to prevent. */
  sections.push({
    title: titles.endpoints,
    body: joinClauses([
      `The supplied first and final frames are fixed endpoints${first ? ` — ${first.production.label}` : ""}${last ? ` and ${last.production.label}` : ""}.`,
      anchorOrientation(ctx),
      "Describe only the continuous physical change between them: first-frame state, intermediate change, then convergence onto the supplied final frame.",
      "Build it as a single continuous shot with no cut, dissolve or detour unless one is explicitly requested.",
    ]),
  });

  sections.push(...actionSections(ctx, titles.trajectory, {
    tail: "The movement settles as it converges on the supplied final frame.",
  }));
  const staging = intentValue(intent, "staging");
  if (staging) {
    sections.push({ title: titles.framing, body: sentence(upperFirst(staging)) });
    coverage.represent("staging", "prompt");
  }
  const camera = cameraSection(intent, spec, coverage, titles);
  if (camera) sections.push(camera);
  const performance = performanceSection(intent, coverage, titles);
  if (performance) sections.push(performance);
  const dialogue = dialogueSection(intent, spec, coverage, titles);
  if (dialogue) sections.push(dialogue);
  sections.push(...soundSections(intent, coverage, titles));
  const continuity = continuitySection(intent, coverage, titles, { includeCanon: false });
  if (continuity) sections.push(continuity);

  closeProductionOnlyIntent(ctx, "flf");
  return { sections, parameters, header: `${titles.shot}\n${article(parameters.duration)} ${parameters.duration}-second bridge between two fixed frames.` };
}

function compileR2V(ctx) {
  const { intent, spec, coverage, manifest } = ctx;
  const titles = H3_PLAYBOOK.sectionTitles;
  const sections = [];
  const parameters = outputParameters(ctx, coverage);
  const counters = {};
  const tokens = new Map();
  const definitions = [];
  const retention = [];

  /* An ordered waypoint's job is its POSITION in the sequence, so the numbering is
     counted over the keyframes themselves rather than over every Picture — an identity
     reference sitting between two beats must not be announced as beat two. */
  const waypointRoles = ["sequential-keyframe", "waypoint"];
  const waypoints = manifest.filter((row) => waypointRoles.includes(row.role));
  let waypointIndex = 0;
  for (const row of manifest) {
    const token = referenceToken(row, counters);
    tokens.set(row.refId, token);
    definitions.push(describeReference(row, token));
    if (waypointRoles.includes(row.role)) {
      waypointIndex += 1;
      const position = waypointIndex === 1
        ? "Open on"
        : waypointIndex === waypoints.length
          ? "Resolve onto"
          : "Pass through";
      retention.push(
        `${position} ${token} as beat ${waypointIndex} of ${waypoints.length}${waypointIndex === 1 || waypointIndex === waypoints.length ? "" : ", settling briefly without holding on it"}.`,
      );
      continue;
    }
    if (row.role === "identity" || row.role === "continuity-state" || row.role === "outfit")
      retention.push(`Keep ${row.production.entityName || row.production.label} exactly as ${token} shows.`);
    else if (row.role === "location")
      retention.push(`Keep the geometry, materials and lighting logic of ${token}.`);
    else if (row.role === "prop")
      retention.push(`Keep the design and scale of ${token}.`);
    else if (row.role === "motion-reference")
      retention.push(`Follow the movement quality in ${token}; do not copy its subject or setting.`);
    else if (row.role === "voice")
      retention.push(`Use the voice in ${token} for the speaking character; reference its timbre rather than copying its words.`);
    else if (row.role === "first-frame")
      retention.push(`Open on ${token}.`);
    else if (row.role === "last-frame")
      retention.push(`Land on ${token}.`);
  }
  if (definitions.length) sections.push({ title: titles.definitions, body: definitions.join("\n") });
  /* Two or more ordered beats are a trajectory, and saying only what each one fixes
     invites the model to cut between them. The contract has to say "continuous". */
  if (waypoints.length > 1)
    retention.unshift(
      `Treat ${waypoints.map((row) => tokens.get(row.refId)).join(", ")} as ${waypoints.length} sequential beats in that exact order, with continuous motion between each pair and no cut, dissolve or slideshow.`,
    );
  if (retention.length) sections.push({ title: titles.retention, body: retention.join("\n") });

  /* References carry identity and place, so those intents are anchored by a named
     input rather than restated as competing prose. */
  const anchors = [
    ["identity.canon", ["identity", "continuity-state", "outfit"]],
    ["environment", ["location"]],
    ["style.visual", ["style"]],
  ];
  for (const [key, roles] of anchors) {
    const row = manifest.find((entry) => roles.includes(entry.role));
    if (row && intentValue(intent, key)) coverage.anchor(key, `${row.production.label} (${tokens.get(row.refId)})`);
  }

  /* Whatever the references did not fix still has to be said. A reference-driven shot
     is not automatically a shot with no description. */
  const subject = [];
  for (const key of ["state.initial", "environment", "style.visual"]) {
    const value = intentValue(intent, key);
    if (!value || coverage.has(key)) continue;
    subject.push(value);
    coverage.represent(key, "prompt");
  }
  if (subject.length) sections.push({ title: titles.subject, body: sentence(subject.join(" ")) });

  const framing = framingSection(intent, coverage, titles);
  if (framing) sections.push(framing);

  sections.push(...actionSections(ctx, titles.action));
  const camera = cameraSection(intent, spec, coverage, titles, { includeFraming: false });
  if (camera) sections.push(camera);
  const performance = performanceSection(intent, coverage, titles);
  if (performance) sections.push(performance);
  const dialogue = dialogueSection(intent, spec, coverage, titles);
  if (dialogue) sections.push(dialogue);
  sections.push(...soundSections(intent, coverage, titles));
  const continuity = continuitySection(intent, coverage, titles, { includeCanon: !coverage.has("identity.canon") });
  if (continuity) sections.push(continuity);

  closeProductionOnlyIntent(ctx, "r2v");
  return { sections, parameters, header: `${titles.shot}\n${article(parameters.duration)} ${parameters.duration}-second shot built from the references below.` };
}

/* Action is the one thing a motion package cannot be without. If the shot carries none,
   that is a refusal, not a shorter prompt: a video request with no described movement
   returns whatever the model invents. */
function actionSections(ctx, title, options = {}) {
  const { intent, coverage, spec } = ctx;
  const primary = intentValue(intent, "action.primary");
  const secondary = intentValue(intent, "action.secondary");
  const environment = intentValue(intent, "action.environment");
  if (!primary) {
    coverage.warn({
      code: "no-action",
      field: "actions",
      message: "This shot describes no action, so the generated motion is entirely the model's invention.",
      action: "Describe the principal visible action in the shot's motion brief.",
    });
    return [];
  }
  const lines = beatLines(spec, ctx.durationSeconds);
  coverage.represent("action.primary", "prompt");
  if (secondary) coverage.represent("action.secondary", "prompt");
  if (environment) {
    coverage.represent("action.environment", "prompt");
    lines.push(sentence(environment));
  }
  if (options.tail) lines.push(options.tail);
  return [{ title, body: lines.join(" ") }];
}

/* The intents an anchoring frame makes authoritative, recorded from the playbook so a
   mode cannot quietly decide something is anchored that no input establishes.

   The `requires` check is the load-bearing part. "Anchored" is a claim that some input
   already carries this, and a claim about an input that was never selected is worse than
   the silence it replaced: it reads as accounted for. So an anchor only applies when the
   reference it names is actually in the package — and where it is not, the intent falls
   through to the core's unaccounted check and surfaces. */
function anchorFor(ctx, mode) {
  const anchors = H3_PLAYBOOK.anchoredBy[mode] || {};
  for (const [key, anchor] of Object.entries(anchors)) {
    if (!intentValue(ctx.intent, key)) continue;
    if (!(ctx.manifest || []).some((row) => row.role === anchor.requires)) continue;
    ctx.coverage.anchor(key, anchor.via);
  }
}

/* Two intents are deliberately not sent to the model, and the reasons are different.

   A required ending state is meaningful in first/last-frame work, where the final frame
   fixes it. In every other mode there is no ending input to hold it, so restating it as
   a second description competes with the action beats that actually produce it.

   Production risks are notes to the crew — "watch for identity drift on the torn cuff"
   — written to be read by a person deciding whether to approve a take. Feeding a list
   of feared failures to a generator invites them. Both are recorded as omitted with the
   reason rather than dropped, so the record shows a decision instead of a gap. */
function closeProductionOnlyIntent(ctx, mode) {
  if (intentValue(ctx.intent, "state.final") && !ctx.coverage.has("state.final"))
    ctx.coverage.omit(
      "state.final",
      `${mode} generation has no ending-frame input, so the required ending state is directed through the action beats rather than as a second description of the last frame.`,
    );
  if (intentValue(ctx.intent, "production.risks") && !ctx.coverage.has("production.risks"))
    ctx.coverage.omit(
      "production.risks",
      "Production risks are review notes for the crew. Naming a feared failure to a generative model tends to produce it, so the risk stays in the production record and the corresponding must-avoid requirement is what reaches the model.",
    );
}

/* Clip a production field to a naming length. Cut back to the last clause boundary in
   the tail of the slice where there is one, so the result ends on a complete idea
   instead of mid-phrase, and never add an ellipsis — this is a pointer to something the
   frame already carries, not a truncated copy of it. */
function compactClause(value, maxWords) {
  const words = text(value).replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!words.length) return "";
  if (words.length <= maxWords) return text(value).replace(/[.,;:]+$/, "");
  const slice = words.slice(0, maxWords).join(" ");
  const boundary = Math.max(slice.lastIndexOf(","), slice.lastIndexOf(";"), slice.lastIndexOf(":"));
  const cut = boundary > slice.length * 0.55 ? slice.slice(0, boundary) : slice;
  /* A clip that lands on "…sets the parcel on the" reads as a sentence someone forgot to
     finish. Dropping the dangling function words leaves a complete phrase. */
  return cut
    .replace(/[\s.,;:]+$/, "")
    .replace(/(?:\s+(?:the|a|an|and|or|of|to|on|in|at|by|for|with|from|into|onto|as|that|its|his|her|their))+$/i, "");
}

/* The verbal anchor MiniMax's I2VA guidance asks for: the style, subjects and scene the
   supplied frame establishes, named briefly so the generation commits to them, then out
   of the way. Clipped per anchor, in the guide's own order, and only for intents that
   are actually anchored — so it can never quietly become a second description of a frame
   nobody selected. */
function anchorOrientation(ctx) {
  const { order, maxWordsPerAnchor } = H3_PLAYBOOK.anchorOrientation;
  const named = [];
  for (const key of order) {
    const entry = ctx.coverage.get(key);
    if (!entry || entry.state !== "anchored") continue;
    const clipped = compactClause(intentValue(ctx.intent, key), maxWordsPerAnchor);
    if (clipped) named.push(clipped);
  }
  return named.length ? `It establishes ${named.join("; ")}.` : "";
}

/* Containment de-duplication: two production fields legitimately overlap when one
   quotes the other, and repeating a paragraph is not emphasis. */
function dedupe(value, against) {
  const clean = text(value);
  if (!clean) return "";
  const other = text(against);
  return other && other.includes(clean) ? "" : clean;
}

/* ---------------------------------------------------------------------------
   Serialisation.

   The hosted API documents a plain-text prompt item; an open-weight H3-Base deployment
   is given the document the base guide specifies. Same compiled content either way —
   only the envelope differs. */
function serialise(surface, header, sections) {
  const body = [header, ...sections.filter((section) => section && text(section.body))
    .map((section) => (text(section.title) ? `${section.title}\n${text(section.body)}` : text(section.body)))]
    .filter(Boolean)
    .join("\n\n");
  if (H3_PLAYBOOK.serialisation[String(surface)] !== "h3-base-fields") return body;

  const titles = H3_PLAYBOOK.sectionTitles;
  const pick = (title) => sections.find((section) => section && section.title === title);
  const soundscape = pick(titles.soundscape);
  const music = pick(titles.music);
  const alignment = [pick(titles.alignment), pick(titles.endpoints)].filter(Boolean);
  const described = sections.filter((section) =>
    section && text(section.body) && ![titles.soundscape, titles.music, titles.alignment, titles.endpoints].includes(section.title));
  return [
    alignment.length ? alignment.map((section) => text(section.body)).join(" ") : "",
    "",
    `integrated_multimodal_description: ${[header.replace(/^[A-Z ]+\n/, ""), ...described.map((section) => text(section.body))].filter(Boolean).join(" ")}`,
    `overall_soundscape: ${soundscape ? text(soundscape.body) : "Natural ambience appropriate to the scene, with no added emphasis."}`,
    `non_diegetic_music: ${music ? text(music.body) : "No non-diegetic music."}`,
  ].filter((part, index) => part !== "" || index === 1).join("\n");
}

/* ---------------------------------------------------------------------------
   Intent H3 receives and deliberately does not send as its own instruction.
 *
 * These are `omitted-by-design` rather than `unsupported` because nothing is lost: the
 * fact reaches the pack, the pack states why it does not become a separate instruction,
 * and the record says so. `unsupported` is reserved for something the filmmaker asked
 * for and will not get, which is a sentence worth showing them.
 *
 * Both arrived with the intent inventory. They are read by routing and by review, and
 * they were previously invisible to every layer — which is the point of inventorying
 * them — but MiniMax H3 exposes no control for either. */
const H3_OMITTED_BY_DESIGN = {
  "subjects.count": "MiniMax H3 has no subject-count control; each subject is named individually in the description instead.",
  /* H3 speaks the supplied line with native audio and synchronises it structurally.
     There is no flag that could assert the requirement or relax it, so CineBraid neither
     claims to have sent one nor reports a capability the model never offered. */
  "performance.lipSync": "MiniMax H3 speaks the supplied line with its own native audio; there is no separate lip-sync control to set.",
};

/* THE ONE AUDIO REQUEST THIS ROUTE CANNOT HONOUR.
 *
 * H3 is a video-and-audio checkpoint: every mode renders its own track, and fal
 * publishes no field on any of the three endpoints that could switch that off. So a
 * shot asking for no generated audio is asking for something it will not get — which is
 * what `unsupported` is for, and it is the opposite of the two rows above, where nothing
 * is lost.
 *
 * Reported HERE rather than left to the core's backstop so the sentence is written for a
 * filmmaker. The backstop's wording is a note to whoever maintains this pack, and this
 * is not a maintenance gap: the pack is behaving correctly and the model cannot comply.
 *
 * Nothing is serialised. Inventing `generate_audio` to carry the refusal would put a
 * parameter fal never offered into a paid request, and the plan's own output block keeps
 * recording `audio: "native"` because that remains the true fact about what arrives. */
function reportUnsatisfiedAudioRequest(context) {
  if (!intentValue(context.intent, "output.nativeAudio")) return;
  if (context.coverage.has("output.nativeAudio")) return;
  context.coverage.unsupported(
    "output.nativeAudio",
    "MiniMax H3 renders its own audio track in every mode and fal exposes no field to switch it off.",
    {
      code: "native-audio-unsupported",
      field: "output.nativeAudio",
      message: "This shot asks for no generated audio, but MiniMax H3 always renders a native audio track and there is no way to turn it off. The video will arrive with sound, and the track is charged for whether it is used or not.",
      action: "Mute or replace the track in the finish pass, or choose a model that can render silent.",
    },
  );
}

const MODE_COMPILERS = { t2v: compileT2V, i2v: compileI2V, flf: compileFLF, r2v: compileR2V };

function compileMode(context) {
  const mode = text(context.mode);
  const build = MODE_COMPILERS[mode];
  if (!build) throw new Error(`MiniMax H3 has no compiler for mode ${mode || "(none)"}.`);

  const checkpoint = checkpointForMode(mode);
  const capability = context.capability || capabilityLayer(mode, context.surface);
  const manifest = applyReferenceLimits(context.manifest || [], capability, context.coverage);
  const ctx = { ...context, manifest, capability };

  const { sections, parameters, header } = build(ctx);
  /* Applied AFTER the mode compiler, so a section that genuinely expressed one of these
     keeps its stronger claim; `omit` is the fallback, never an override. */
  for (const [key, reason] of Object.entries(H3_OMITTED_BY_DESIGN))
    if (intentValue(context.intent, key) && !context.coverage.has(key)) context.coverage.omit(key, reason);
  reportUnsatisfiedAudioRequest(context);
  const prompt = serialise(context.surface, header, sections);

  /* The effective ceiling, whoever set it. When only the model has an opinion this is
     H3's 7,000; when a backend has narrowed it through the capability intersection this
     is the backend's number, and the warning names the smaller one honestly instead of
     asserting either as "the H3 limit". */
  const promptCeiling = Number.isFinite(capability?.maxPromptCharacters)
    ? capability.maxPromptCharacters
    : H3_FACTS.maxPromptCharacters;
  if (prompt.length > promptCeiling)
    context.coverage.warn({
      code: "prompt-over-limit",
      field: "inputs.prompt",
      message: `The compiled prompt is ${prompt.length} characters; this configuration accepts ${promptCeiling}.`,
      action: "Shorten the shot's direction, or choose a backend with a longer prompt limit.",
    });

  /* Which reference fills which model input lives here, namespaced by model, because
     it is adapter knowledge and production intent must stay portable without it. */
  const bindings = {};
  for (const row of manifest) {
    /* An endpoint is an endpoint only where the mode HAS endpoints. Ref2VA takes no
       first/last frame field — its opening and closing beats are ordered Picture
       inputs — so binding one there would name a field the request does not have. */
    if (row.role === "first-frame" && mode !== "r2v") bindings[row.refId] = "first_frame";
    else if (row.role === "last-frame" && mode !== "r2v") bindings[row.refId] = "last_frame";
    else if (row.mediaType === "video") bindings[row.refId] = "reference_video";
    else if (row.mediaType === "audio") bindings[row.refId] = "reference_audio";
    else bindings[row.refId] = "reference_image";
  }

  return {
    prompt,
    /* What will actually be sent, after the configuration's limits were applied and
       every refusal warned about. */
    references: manifest,
    model: { family: H3_FACTS.family, variant: checkpoint ? checkpoint.name : "", checkpoint: checkpoint ? checkpoint.name : "" },
    output: {
      durationSeconds: parameters.duration,
      fps: H3_FACTS.fps,
      audio: H3_FACTS.nativeAudio.supported ? "native" : "none",
    },
    parameters: { ...parameters, referenceBindings: bindings },
  };
}

const pack = registerModelPack({
  packId: PACK_ID,
  packVersion: PACK_VERSION,
  playbook: H3_PLAYBOOK,
  facts: H3_FACTS,
  models: {
    "minimax-h3/fl2va": { variant: "fl2va" },
    "minimax-h3/ref2va": { variant: "ref2va" },
  },
  /* Named here as well as in the record so a compiled plan can state which sources its
     facts came from without this module reading a file — a pure compiler cannot do
     I/O, and a plan that cannot say where its capability claims came from is one a
     reviewer has to take on trust. A test keeps the two lists in step. */
  evidence: {
    record: "docs/architecture/model-evidence/minimax-h3.json",
    sources: [
      { id: "model-card" },
      { id: "api-reference" },
      { id: "prompt-guide-base" },
      { id: "prompt-guide-ref" },
    ],
  },
  capabilityLayer,
  checkpointForMode,
  compileMode,
});

module.exports = {
  PACK_ID,
  PACK_VERSION,
  H3_FACTS,
  H3_PLAYBOOK,
  cameraSentence,
  capabilityLayer,
  checkpointForMode,
  compileMode,
  pack,
};

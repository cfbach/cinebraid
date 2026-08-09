/* Deterministic generation compilation.
 *
 * The layer between "what the production wants" and "what a specific model is asked
 * for". It reads the provider-neutral prompt spec CineBraid already builds, plans the
 * approved references into a semantic manifest, hands both to a model pack, and
 * returns a GenerationPlan.
 *
 *     PROJECT BIBLE + SHOT + APPROVED REFERENCES + DIRECTOR INTENT
 *         -> prompt-engine spec            (provider-neutral, already exists)
 *         -> planReferences()              (semantic manifest, here)
 *         -> model pack compileMode()      (model-specific, per pack)
 *         -> GenerationPlan                (generation-contracts.js)
 *         -> GenerationJob                 (unchanged)
 *
 * Two rules make this worth having as its own layer.
 *
 * NO LLM, NO NETWORK, NO CLOCK. A baseline generation must be producible with Local AI
 * off and the machine offline. Nothing in here reads Date, Math.random, the filesystem
 * or a socket, and every ordering is explicit — so the same production state compiles
 * to the same plan today and after a restart. A seed, if one is wanted, is generated
 * by a caller and arrives as an input.
 *
 * NO SILENT INTENT LOSS. Every piece of filmmaking intent the shot actually carries
 * ends in exactly one recorded coverage state. A model pack declares what it took; the
 * core checks the remainder and records anything unclaimed as unsupported WITH a
 * warning, so a pack that forgets a field produces a visible gap rather than a quietly
 * shorter prompt. That check is the reason coverage is computed here and not inside
 * each pack: a pack cannot be the only witness to its own omissions.
 */

const {
  GENERATION_PLAN_VERSION,
  MODE_OUTPUT_TYPES,
  validateGenerationPlan,
} = require("./generation-contracts");
const {
  CINEBRAID_REFERENCE_ROLES,
  checkRequestAgainstCapability,
} = require("./public/shared-generation-capability");

const COMPILER_VERSION = 1;

/* ---------------------------------------------------------------------------
   Small helpers. Deliberately duplicated from prompt-engine.js rather than imported:
   this module must stay loadable without the profile registry and its filesystem
   read, so that a plan can be compiled in a test, a worker or an offline check. */
function text(value) {
  return String(value == null ? "" : value).trim();
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function list(value) {
  return (Array.isArray(value) ? value : []).map(text).filter(Boolean);
}
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/* ---------------------------------------------------------------------------
   The intent inventory.

   What counts as a meaningful piece of filmmaking intent, and where it already lives
   in the spec. This table is the whole definition — there is no second list anywhere,
   so adding a concept to the spec and forgetting to account for it is impossible once
   its reader is added here.

   `read` returns the value if the shot genuinely carries it, and "" / [] if it does
   not. An absent field is not intent and is never inventoried: a plan is not required
   to explain why it did not express a blank. */
const INTENT_FIELDS = [
  { key: "action.primary", label: "principal action", read: (s) => text(firstAction(s)) },
  { key: "action.secondary", label: "secondary beats", read: (s) => secondaryActions(s).join(" | ") },
  { key: "action.environment", label: "environment motion", read: (s) => list(s.environmentMotion).join("; ") },
  { key: "staging", label: "blocking and staging", read: (s) => list(s.stagingLines).join(" ") },
  { key: "camera.framing", label: "framing", read: (s) => text(s.camera?.framing) },
  { key: "camera.movement", label: "camera movement", read: (s) => meaningfulCamera(s) },
  { key: "camera.timing", label: "camera move timing", read: (s) => text(s.camera?.timing) },
  { key: "camera.lens", label: "lens and focus behaviour", read: (s) => text(s.camera?.lensIntent) },
  { key: "performance.emotion", label: "performance emotion", read: (s) => text(s.performance?.emotion) },
  { key: "performance.facial", label: "facial performance", read: (s) => text(s.performance?.facial) },
  { key: "performance.body", label: "body language", read: (s) => text(s.performance?.bodyLanguage) },
  { key: "performance.gaze", label: "gaze", read: (s) => text(s.performance?.gaze) },
  { key: "timing.duration", label: "shot duration", read: (s) => (Number(s.durationSeconds) > 0 ? String(Number(s.durationSeconds)) : "") },
  { key: "dialogue.line", label: "dialogue", read: (s) => text(s.audio?.dialogue) },
  { key: "dialogue.delivery", label: "dialogue delivery", read: (s) => text(s.audio?.delivery) },
  { key: "dialogue.timing", label: "dialogue timing", read: (s) => [text(s.audio?.startTime), text(s.audio?.endTime)].filter(Boolean).join("-") },
  { key: "dialogue.voice", label: "persistent voice design", read: (s) => text(s.audio?.voiceDesign) },
  { key: "sound.effects", label: "sound effects", read: (s) => text(s.audio?.sfx) },
  { key: "sound.ambience", label: "ambience", read: (s) => text(s.audio?.ambience) },
  { key: "sound.music", label: "music", read: (s) => text(s.audio?.music) },
  { key: "sound.silence", label: "required silence", read: (s) => text(s.audio?.silence) },
  { key: "sound.priorities", label: "audio priority", read: (s) => text(s.audio?.priorities) },
  { key: "state.initial", label: "opening state", read: (s) => text(s.initialState?.subject) },
  { key: "state.final", label: "required ending state", read: (s) => text(s.finalState?.subject) },
  { key: "environment", label: "environment", read: (s) => text(s.initialState?.environment) },
  { key: "identity.canon", label: "approved identity canon", read: (s) => list(s.identityCanon).join(" ") },
  { key: "continuity.drift", label: "drift restatements", read: (s) => list(s.driftRestatements).join(" ") },
  { key: "continuity.preserve", label: "must-preserve requirements", read: (s) => list(s.mustPreserve).join("; ") },
  { key: "continuity.avoid", label: "must-avoid requirements", read: (s) => list(s.mustAvoid).join("; ") },
  { key: "style.visual", label: "visual style", read: (s) => list(s.visualStyle).join(" ") },
  { key: "production.risks", label: "production risks", read: (s) => list(s.productionRisks).join("; ") },
  { key: "output.aspectRatio", label: "aspect ratio", read: (s) => text(s.aspectRatio || s.world?.aspectRatio) },
];

function firstAction(spec) {
  const actions = Array.isArray(spec.actions) ? spec.actions.filter((item) => text(item?.action)) : [];
  return actions.length ? text(actions[0].action) : "";
}
function secondaryActions(spec) {
  const actions = Array.isArray(spec.actions) ? spec.actions.filter((item) => text(item?.action)) : [];
  return actions.slice(1).map((item) => text(item.action));
}
/* defaultSpec seeds camera.movement with a placeholder sentence so image compilers have
   something to say. Treating that placeholder as director intent would make every shot
   look as though a camera move was requested, and would let a real move go unnoticed
   among the noise. */
const PLACEHOLDER_CAMERA = /^(no camera movement unless specified|use the approved shot framing)/i;
function meaningfulCamera(spec) {
  const movement = text(spec.camera?.movement);
  return PLACEHOLDER_CAMERA.test(movement) ? "" : movement;
}

function inventoryIntent(spec, sanitize) {
  const source = isRecord(spec) ? spec : {};
  const rows = [];
  for (const field of INTENT_FIELDS) {
    const raw = field.read(source);
    /* Sanitised BEFORE a pack ever sees it. Scrubbing only the finished prompt is not
       enough: a pack reasonably reshapes what it is given — lowercases a clause to join
       it into a sentence, splits on punctuation — and a mangled identifier no longer
       matches the string the scrubber is looking for. Clean input, then clean output as
       a backstop. */
    const value = typeof sanitize === "function" ? sanitize(raw) : text(raw);
    if (text(value)) rows.push({ key: field.key, label: field.label, value: text(value) });
  }
  return rows;
}

/* ---------------------------------------------------------------------------
   The deterministic reference planner.

   An approved reference is not a file with a number on it. It is a production decision
   — "this is Kai's approved identity", "this is the hangar in its approved night
   state", "this clip is the motion we want" — and the decision has to survive into the
   package or the model is guessing. The manifest carries that decision; a model pack
   decides how to say it, and only the pack knows whether this model wants
   `<Subject 1>`, `Image 1`, or a named API field.

   MediaAsset stays dormant. The planner reads the reference objects the prompt engine
   already receives and the entity records already resolved onto the spec; it mints no
   asset identity and calls nothing in the ledger. */

/* Order matters to some models and not to others, so the planner produces ONE
   canonical order and records it. Temporal contracts lead, because a first or last
   frame is an endpoint rather than an influence; identity and place come next because
   they are what a shot is about; then the modalities that shape motion and sound. */
const ROLE_PRIORITY = [
  "first-frame", "last-frame",
  /* Ordered waypoints sit with the endpoints because they are the same kind of thing:
     a temporal contract rather than an influence. Within the band they keep the
     director's supplied order, which is the whole meaning of a keyframe sequence. */
  "sequential-keyframe", "waypoint",
  "identity", "expression", "body", "outfit", "pose", "turnaround",
  "continuity-state", "location", "prop", "scale",
  "composition", "base", "reference", "reference-sheet", "alternate-view", "detail",
  "motion-reference", "camera-reference", "performance-reference",
  "voice", "audio-timing", "sound-reference",
  "style", "colour-palette", "lighting",
  "depth", "edge", "mask",
];
/* What a role MEANS in production terms, in filmmaker language. This is the text a
   pack may put in front of a model; it is never an internal key. */
const ROLE_PURPOSE = {
  "first-frame": "the exact opening frame",
  "last-frame": "the exact final frame",
  "sequential-keyframe": "an approved beat the shot passes through, in order",
  waypoint: "an approved beat the shot passes through, in order",
  identity: "approved identity and appearance",
  outfit: "approved wardrobe state",
  expression: "approved expression",
  body: "approved proportions",
  pose: "approved pose",
  turnaround: "approved turnaround",
  "continuity-state": "the approved continuity state",
  location: "approved location and its geometry, materials and lighting logic",
  prop: "approved prop design, scale and placement",
  scale: "approved scale relationship",
  composition: "the composition guide",
  base: "the base plate",
  "alternate-view": "an approved alternate angle",
  detail: "an approved detail",
  "reference-sheet": "the approved reference sheet",
  reference: "an approved visual reference",
  "motion-reference": "the motion and movement quality to follow",
  "camera-reference": "the camera behaviour to follow",
  "performance-reference": "the performance to follow",
  voice: "the speaking voice to use",
  "audio-timing": "the timing to synchronise to",
  "sound-reference": "the sound character to follow",
  style: "the visual style to follow",
  "colour-palette": "the colour palette to follow",
  lighting: "the lighting logic to follow",
  depth: "a depth control input",
  edge: "an edge control input",
  mask: "a mask",
};

function referenceMediaType(reference) {
  const declared = text(reference?.mediaType).toLowerCase();
  if (["image", "video", "audio"].includes(declared)) return declared;
  const url = text(reference?.url || reference?.path);
  if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(url)) return "video";
  if (/\.(wav|mp3|m4a|aac|flac|ogg)$/i.test(url)) return "audio";
  return "image";
}

/* A reference's source, in the identity order generation-contracts.js already fixes:
   assetId, then contentHash, then a project-relative path. Nothing here mints one. */
function referenceSource(reference) {
  if (text(reference?.assetId)) return { kind: "media-asset", assetId: text(reference.assetId) };
  if (text(reference?.contentHash)) return { kind: "project-asset", contentHash: text(reference.contentHash) };
  const path = text(reference?.path || reference?.url);
  if (path.startsWith("data:")) return { kind: "data-uri", dataUri: path };
  return { kind: "project-asset", path };
}

/* Entity records already resolved onto the spec, so the manifest can say "Kai" rather
   than repeating an id, and so a pack can group two references that describe the same
   character. */
function entityIndex(spec) {
  const index = new Map();
  for (const entity of Array.isArray(spec?.promptEntities) ? spec.promptEntities : [])
    if (text(entity?.id)) index.set(text(entity.id), { name: text(entity.name), type: text(entity.type) || "character" });
  for (const ground of Array.isArray(spec?.visualGrounding) ? spec.visualGrounding : [])
    if (text(ground?.entityId) && !index.has(text(ground.entityId)))
      index.set(text(ground.entityId), { name: text(ground.name), type: text(ground.type) });
  return index;
}

function planReferences(spec, references, options = {}) {
  const source = isRecord(spec) ? spec : {};
  const entities = entityIndex(source);
  const roles = options.referenceRoles || CINEBRAID_REFERENCE_ROLES;
  const rows = (Array.isArray(references) ? references : [])
    .filter(isRecord)
    .map((reference, index) => {
      const role = text(reference.role) || "reference";
      const entityId = text(reference.entityId);
      const entity = entities.get(entityId) || null;
      /* refId is the reference's own key where it has one, and its ordinal otherwise.
         Deterministic, stable across runs, and never derived from a hash of bytes —
         that identity belongs to MediaAsset and MediaAsset is dormant. */
      const refId = text(reference.refId || reference.key) || `ref-${index + 1}`;
      return {
        refId,
        role,
        mediaType: referenceMediaType(reference),
        source: referenceSource(reference),
        production: {
          /* Filmmaker-facing. A label, a name and a purpose — never an id. */
          label: text(reference.label || reference.name) || (entity ? entity.name : "") || ROLE_PURPOSE[role] || "approved reference",
          entityName: entity ? entity.name : text(reference.entityName),
          entityType: entity ? entity.type : text(reference.entityType),
          purpose: text(reference.instruction) || ROLE_PURPOSE[role] || "",
          continuityState: text(reference.continuityState || reference.stateName),
        },
        /* An endpoint contract and an identity reference are not optional; an influence
           is. A pack that must drop something needs to know which is which. */
        required: ["first-frame", "last-frame", "sequential-keyframe", "waypoint", "identity", "voice"].includes(role),
        roleKnown: roles.includes(role),
        entityId,
        suppliedOrder: Number.isFinite(Number(reference.order)) ? Number(reference.order) : index,
        order: 0,
      };
    });

  /* One canonical order, applied explicitly. Sorting by supplied order within a role
     band keeps a director's chosen keyframe sequence intact while still putting the
     endpoints first. */
  rows.sort((a, b) => {
    const rankA = ROLE_PRIORITY.indexOf(a.role);
    const rankB = ROLE_PRIORITY.indexOf(b.role);
    const priorityA = rankA < 0 ? ROLE_PRIORITY.length : rankA;
    const priorityB = rankB < 0 ? ROLE_PRIORITY.length : rankB;
    if (priorityA !== priorityB) return priorityA - priorityB;
    if (a.suppliedOrder !== b.suppliedOrder) return a.suppliedOrder - b.suppliedOrder;
    return a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0;
  });
  rows.forEach((row, index) => { row.order = index; });
  return rows;
}

/* ---------------------------------------------------------------------------
   Coverage recording. */
function createCoverage() {
  const entries = new Map();
  const warnings = [];
  return {
    represent(intent, via = "prompt") { entries.set(intent, { intent, state: "represented", via }); },
    anchor(intent, via) { entries.set(intent, { intent, state: "anchored", via }); },
    omit(intent, reason) { entries.set(intent, { intent, state: "omitted-by-design", reason }); },
    unsupported(intent, reason, warning) {
      entries.set(intent, { intent, state: "unsupported", reason });
      warnings.push({
        code: warning?.code || "intent-unsupported",
        intent,
        field: warning?.field || intent,
        message: warning?.message || reason,
        action: warning?.action || "",
      });
    },
    warn(warning) { warnings.push({ code: "compilation", ...warning }); },
    has(intent) { return entries.has(intent); },
    get(intent) { return entries.get(intent) || null; },
    /* Insertion order is not stable across packs, so the plan is emitted in the
       inventory's declaration order and only then anything a pack invented. */
    toArray(order) {
      const known = (order || []).filter((intent) => entries.has(intent)).map((intent) => entries.get(intent));
      const extra = [...entries.values()].filter((entry) => !(order || []).includes(entry.intent));
      return [...known, ...extra];
    },
    warningsArray() { return warnings.slice(); },
  };
}

/* ---------------------------------------------------------------------------
   Coverage verification.

   "Represented in the prompt" is a claim, and a claim a pack makes about its own work.
   A pack that records the claim and then returns without writing the sentence produces
   a plan that looks complete and is not — which is the original defect wearing a
   coverage entry. So the claim is checked against the finished prompt.

   Checked by substance, not by string equality: a pack legitimately rewrites what it is
   given, and "slow dolly push-in" correctly becomes "The camera slow dolly push-in with
   small amplitude at slow speed." Distinctive words are extracted from the intent's
   value and at least half of them must survive into the prompt. Below that, the entry
   is downgraded to unsupported and warned about, because a value that mostly did not
   arrive did not arrive. */
const COVERAGE_SURVIVAL_RATIO = 0.5;
function distinctiveWords(value) {
  return unique(
    String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((word) => word.replace(/[^a-z]/g, "").length >= 4),
  );
}
function survivedIntoPrompt(value, prompt) {
  const words = distinctiveWords(value);
  if (!words.length) return true; /* nothing distinctive to look for */
  const lower = String(prompt || "").toLowerCase();
  const found = words.filter((word) => lower.includes(word)).length;
  return found >= Math.max(1, Math.ceil(words.length * COVERAGE_SURVIVAL_RATIO));
}

/* ---------------------------------------------------------------------------
   Raw-identifier sanitation.

   A UUID in prose is not cosmetic — the model will try to render it, and it tells the
   reader nothing. Structured provenance keeps the machine identity; the prompt gets
   the production name. Replacement is preferred over deletion so the sentence survives:
   losing the subject of an action is a worse outcome than a leaked id. */
function internalIdentifiers(spec, manifest) {
  const ids = [];
  for (const entity of Array.isArray(spec?.promptEntities) ? spec.promptEntities : []) ids.push(text(entity?.id));
  for (const ground of Array.isArray(spec?.visualGrounding) ? spec.visualGrounding : []) ids.push(text(ground?.entityId));
  for (const entity of Array.isArray(spec?.blockingEntities) ? spec.blockingEntities : []) ids.push(text(entity?.id));
  for (const row of manifest || []) {
    ids.push(text(row.entityId));
    ids.push(text(row.refId));
  }
  if (isRecord(spec?.audio)) {
    ids.push(text(spec.audio.speakerId));
    ids.push(text(spec.audio.voiceEntityId));
  }
  /* Identifier-shaped only. A reference key is free-form, so a project could plausibly
     name one "base" or "wide" — scrubbing those would mangle ordinary prose to remove
     something that was never an identifier. A real one carries a separator, a digit, or
     length no production label has.

     Longest first, so replacing CHAR-KAI-1 inside CHAR-KAI-12 cannot happen. */
  const identifierShaped = (id) => id.length >= 3 && (/[-_]/.test(id) || /\d/.test(id) || id.length >= 12);
  return unique(ids.filter(identifierShaped)).sort((a, b) => b.length - a.length);
}

function displayNameFor(identifier, spec, manifest) {
  for (const entity of Array.isArray(spec?.promptEntities) ? spec.promptEntities : [])
    if (text(entity?.id) === identifier && text(entity?.name)) return text(entity.name);
  for (const ground of Array.isArray(spec?.visualGrounding) ? spec.visualGrounding : [])
    if (text(ground?.entityId) === identifier && text(ground?.name)) return text(ground.name);
  for (const entity of Array.isArray(spec?.blockingEntities) ? spec.blockingEntities : [])
    if (text(entity?.id) === identifier && text(entity?.name)) return text(entity.name);
  for (const row of manifest || []) {
    if (row.entityId === identifier && text(row.production?.entityName)) return text(row.production.entityName);
    if (row.refId === identifier && text(row.production?.label)) return text(row.production.label);
  }
  return "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizePromptText(prompt, spec, manifest) {
  let out = String(prompt == null ? "" : prompt);
  for (const identifier of internalIdentifiers(spec, manifest)) {
    if (!out.includes(identifier)) continue;
    const name = displayNameFor(identifier, spec, manifest);
    /* A name that still contains the identifier cannot be the replacement for it — the
       substitution would put back exactly what it was removing, and the contract check
       downstream would then refuse the plan outright. A reference labelled after its own
       key is unusual but entirely possible, and losing the whole generation to it is a
       far worse outcome than a slightly flatter sentence. */
    const usable = name && !name.includes(identifier) ? name : "";
    /* Whole tokens only: an identifier that happens to be a substring of a longer word
       is not that identifier. */
    const pattern = new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "g");
    out = usable
      ? out.replace(pattern, usable)
      /* No usable production name exists for it, so the id is described rather than
         printed. Tidying the spacing keeps the sentence readable. */
      : out.replace(pattern, "the referenced element");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------------------------------------------------------------------------
   The model-pack registry.

   Deliberately tiny. A pack is data plus one compile function; registering one is a
   data change and touches nothing else. Nothing here branches on a family name. */
const packs = new Map();
function registerModelPack(pack) {
  if (!isRecord(pack) || !text(pack.packId)) throw new Error("A model pack needs a packId.");
  if (!text(pack.packVersion)) throw new Error(`Model pack ${pack.packId} needs a packVersion.`);
  if (typeof pack.compileMode !== "function") throw new Error(`Model pack ${pack.packId} needs a compileMode function.`);
  packs.set(text(pack.packId), pack);
  return pack;
}
function getModelPack(packId) {
  return packs.get(text(packId)) || null;
}
function modelPackForModel(modelId) {
  for (const pack of packs.values())
    if (isRecord(pack.models) && pack.models[text(modelId)]) return pack;
  return null;
}

/* ---------------------------------------------------------------------------
   Compilation. */

/* A pack returns sections; the core joins them. Keeping the join here means every pack
   produces the same shape of document and the length policy is applied once. */
function joinSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .filter((section) => isRecord(section) && text(section.body))
    .map((section) => (text(section.title) ? `${text(section.title)}\n${text(section.body)}` : text(section.body)))
    .join("\n\n");
}

function compileGenerationPlan(request) {
  const input = isRecord(request) ? request : {};
  const spec = isRecord(input.spec) ? input.spec : {};
  const mode = text(input.mode);
  const modelId = text(input.modelId);
  const pack = input.pack || modelPackForModel(modelId);
  if (!pack) throw new Error(`No model pack is registered for ${modelId || "the requested model"}.`);

  const surface = text(input.surface) || "api";
  const capability = isRecord(input.capability) ? input.capability : null;
  const manifest = planReferences(spec, input.references, input);
  const coverage = createCoverage();
  const scrub = (value) => sanitizePromptText(value, spec, manifest);
  const inventory = inventoryIntent(spec, scrub);
  const inventoryKeys = inventory.map((row) => row.key);

  /* Capability first, so a pack is never asked to express something the configuration
     already refused. This consumes the existing four-layer resolver's output; it does
     not compute capability itself.

     Deliberately narrow: mode and duration only. References, aspect ratio and resolution
     are adjudicated downstream — which reference to drop when there are too many is a
     policy only the pack can decide, and the seed is settled here a few lines below.
     Asking the generic checker as well would report each refusal twice in two
     vocabularies, and a reader would have to work out that they are the same event. */
  const capabilityCheck = capability
    ? checkRequestAgainstCapability(
        { mode, durationSeconds: Number(spec.durationSeconds) || undefined },
        capability,
      )
    : { ok: true, duration: null, blockedBy: [] };
  for (const block of capabilityCheck.blockedBy)
    coverage.warn({
      code: block.reason,
      field: block.field,
      message: block.message,
      action: block.action,
      layer: block.layer,
    });

  /* Seed. The architecture is generic and the answer is per-model: a plan carries a
     seed only where the resolved capability says the configuration accepts one, and
     records an honest refusal where it does not. No pack may invent seed support by
     writing a number into its own parameters. */
  const seedRequested = input.seed != null && input.seed !== "";
  const seedSupported = Boolean(capability?.flags?.seed);
  let settings = { seedMode: "random" };
  if (seedRequested && seedSupported) {
    settings = { seedMode: "explicit", seed: Number(input.seed) };
    coverage.represent("reproducibility.seed", "parameter");
  } else if (seedRequested) {
    coverage.unsupported(
      "reproducibility.seed",
      `${modelId || "This model"} does not accept a seed in ${mode || "this mode"}.`,
      {
        code: "seed-unsupported",
        field: "settings.seed",
        message: `A seed was supplied but ${modelId || "this model"} does not accept one; the result will not be reproducible from it.`,
        action: "Generate without a seed, or choose a model that supports one.",
      },
    );
  }

  /* The pack's turn. It gets sanitised, already-inventoried intent and a manifest with
     production meaning attached; it decides wording, section order, parameter names and
     which reference binds to which model input. */
  const compiled = pack.compileMode({
    mode,
    modelId,
    surface,
    spec,
    intent: inventory,
    manifest,
    capability,
    coverage,
    durationSeconds: Number(spec.durationSeconds) || null,
    aspectRatio: text(spec.aspectRatio || spec.world?.aspectRatio),
    /* What the production ASKED for. A pack validates it against the resolved
       capability and says so when it cannot be met; it is not a pack's job to guess
       which of the allowed values the filmmaker meant. */
    resolution: text(input.resolution || spec.resolution),
    /* The other two output requests, carried the same way and for the same reason.
       `quality` is a cost-and-speed tier where a model documents one and is ignored
       where it does not, and `candidateCount` is how many options to return — the
       image pack has read it since C2a and nothing was passing it, so a dialog
       offering four options produced one. Neither is interpreted here: a pack that
       has no such control simply does not look. */
    quality: text(input.quality),
    candidateCount: input.candidateCount,
  }) || {};

  /* The check a pack cannot do for itself. Anything the shot carried and the pack did
     not claim becomes an explicit gap rather than a shorter prompt. */
  for (const row of inventory)
    if (!coverage.has(row.key))
      coverage.unsupported(
        row.key,
        `The ${pack.packId} pack does not express ${row.label} in ${mode || "this mode"}.`,
        {
          code: "intent-unaccounted",
          field: row.key,
          message: `${row.label} is set on this shot but the ${pack.packId} ${mode} compiler does not carry it.`,
          action: "Record it as anchored or omitted by design, or express it, in the model pack.",
        },
      );

  const prompt = sanitizePromptText(
    text(compiled.prompt) || joinSections(compiled.sections),
    spec,
    manifest,
  );

  /* The second half of the same check: a claim to have written something is verified
     against what was actually written. */
  for (const row of inventory) {
    const entry = coverage.get(row.key);
    if (!entry || entry.state !== "represented" || entry.via !== "prompt") continue;
    if (survivedIntoPrompt(row.value, prompt)) continue;
    coverage.unsupported(
      row.key,
      `The ${pack.packId} pack recorded ${row.label} as written into the prompt, but it is not there.`,
      {
        code: "coverage-unverified",
        field: row.key,
        message: `${row.label} is set on this shot and was claimed as represented, but the compiled prompt does not carry it.`,
        action: "Express it in the model pack, or record it as anchored or omitted by design.",
      },
    );
  }

  /* A pack may refuse references the configuration cannot carry — it has just warned
     about each one. The plan lists what will actually be sent, because a plan that
     claims twelve references and dispatches nine is a plan nobody can trust. */
  const sent = Array.isArray(compiled.references) ? compiled.references : manifest;

  const endpoints = {};
  for (const [field, role] of [["firstFrame", "first-frame"], ["lastFrame", "last-frame"]]) {
    /* The binding comes from the ROLE, never from a position in the array. Ordering a
       reference list differently must not change which frame ends the shot. */
    const row = sent.find((entry) => entry.role === role);
    if (row) endpoints[field] = { refId: row.refId, source: row.source };
  }

  const plan = {
    planVersion: GENERATION_PLAN_VERSION,
    compilerVersion: COMPILER_VERSION,
    target: isRecord(input.target) ? input.target : { kind: "shot-motion", shotId: text(spec.shotId) },
    mode,
    outputType: text(input.outputType) || MODE_OUTPUT_TYPES[mode] || "video",
    model: { modelId, ...(isRecord(compiled.model) ? compiled.model : {}) },
    compiler: {
      packId: pack.packId,
      packVersion: pack.packVersion,
      playbookVersion: text(pack.playbook?.version) || pack.packVersion,
      surface,
    },
    inputs: {
      prompt,
      /* No model-input binding on a reference. Which field a reference lands in is an
         adapter's business, and generation-contracts.js refuses graph structure inside
         intent for exactly that reason; a pack that needs to record one puts it in
         settings.extensions, which is namespaced by modelId and deliberately opaque. */
      references: sent.map((row) => ({
        refId: row.refId,
        role: row.role,
        mediaType: row.mediaType,
        source: row.source,
        production: row.production,
        required: row.required,
        order: row.order,
      })),
    },
    endpoints,
    /* The pack's duration wins where it produced one: it has already snapped the request
       onto what the model will actually render and warned about the difference, so
       carrying the unadjusted request forward would make the plan disagree with itself.
       And the shot's duration is seeded only where the MODE produces something that
       occupies time. A directed shot carries a length whichever pass is being compiled;
       putting that length on a still frame's output block makes the plan claim a
       three-second photograph, which the job contract then correctly refuses. Nothing
       caught it while every pack was a video pack. */
    output: {
      ...(["video", "audio"].includes(text(input.outputType) || MODE_OUTPUT_TYPES[mode])
        ? { durationSeconds: Number(spec.durationSeconds) || undefined }
        : {}),
      ...(isRecord(compiled.output) ? compiled.output : {}),
    },
    settings: {
      ...settings,
      ...(isRecord(compiled.parameters) ? { extensions: { [modelId]: compiled.parameters } } : {}),
    },
    coverage: coverage.toArray([...inventoryKeys, "reproducibility.seed"]),
    warnings: [...coverage.warningsArray(), ...(Array.isArray(compiled.warnings) ? compiled.warnings : [])],
    provenance: {
      /* Kept so a reviewer, a support bundle or a future LLM reviewer can prove what
         the compiler was working from — and so the contract can check that none of it
         reached the prose. */
      entityIdentifiers: internalIdentifiers(spec, manifest),
      capabilityLayers: Array.isArray(capability?.layers) ? capability.layers : [],
      capabilityBlocked: capabilityCheck.blockedBy,
      quantisedDuration: capabilityCheck.duration,
      sources: Array.isArray(pack.evidence?.sources) ? pack.evidence.sources.map((row) => row.id) : [],
    },
  };
  if (plan.output.durationSeconds == null) delete plan.output.durationSeconds;
  return plan;
}

/* Compile and validate in one call, for callers that want the contract enforced rather
   than merely available. */
function compileValidatedGenerationPlan(request) {
  const plan = compileGenerationPlan(request);
  const validation = validateGenerationPlan(plan);
  return { plan, validation };
}

/* ---------------------------------------------------------------------------
   Coverage against a prompt the compiler did not write.

   A filmmaker may edit the compiled prompt before sending it, and they should be able
   to — the words that reach the model are theirs. What must not happen is the plan's
   coverage record silently transferring to text it was never computed from: the plan
   would go on saying "camera movement: represented in the prompt" about a prompt that
   no longer mentions the move.

   So the SAME deterministic check the compiler applies to its own output is applied to
   the edited text, and anything that no longer survives is reported. This is not a
   review and makes no judgement about whether the edit was a good one; it answers one
   narrow question — which of the intents the compiler claimed to have written are still
   there. The compiler's own coverage is left exactly as compiled, because it remains a
   true record of what CineBraid wrote. */
function checkPromptCoverage(request, prompt) {
  const input = isRecord(request) ? request : {};
  const spec = isRecord(input.spec) ? input.spec : {};
  const manifest = planReferences(spec, input.references, input);
  const scrub = (value) => sanitizePromptText(value, spec, manifest);
  const inventory = inventoryIntent(spec, scrub);
  const claimed = new Set(
    (Array.isArray(input.coverage) ? input.coverage : [])
      .filter((row) => isRecord(row) && row.state === "represented" && row.via === "prompt")
      .map((row) => text(row.intent)),
  );
  const checked = [];
  const lost = [];
  for (const row of inventory) {
    if (!claimed.has(row.key)) continue;
    const survived = survivedIntoPrompt(row.value, prompt);
    checked.push({ intent: row.key, label: row.label, survived });
    if (!survived) lost.push({ intent: row.key, label: row.label });
  }
  return { checked, lost };
}

module.exports = {
  COMPILER_VERSION,
  INTENT_FIELDS,
  ROLE_PRIORITY,
  ROLE_PURPOSE,
  checkPromptCoverage,
  compileGenerationPlan,
  compileValidatedGenerationPlan,
  createCoverage,
  getModelPack,
  internalIdentifiers,
  inventoryIntent,
  joinSections,
  modelPackForModel,
  planReferences,
  registerModelPack,
  sanitizePromptText,
};

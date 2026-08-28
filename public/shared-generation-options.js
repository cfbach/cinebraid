/* What a filmmaker can actually generate right now, shared by the browser and Node.
 *
 * public/shared-generation-capability.js answers "what is possible for THIS
 * configuration". public/shared-model-intelligence.js answers "what models and
 * providers exist". This module answers the question a screen asks:
 *
 *     I want to create a blocking frame for this shot, with these approved
 *     references. What can I press, what needs setting up, and what is CineBraid
 *     simply not able to do yet — and why?
 *
 * THE SIX WORDS THAT ARE NOT SYNONYMS, and the reason this file exists. The Deep
 * Pre-Alpha audit found models that could be selected and then could not generate.
 * Every one of those was a screen treating one of these as another:
 *
 *     KNOWN                 it is in the model catalogue.
 *     CAPABILITY-COMPATIBLE model ∩ surface can do this mode with these inputs.
 *     BACKEND-AVAILABLE     some provider surface lists it.
 *     CONNECTED             the account or local runtime that surface needs is
 *                           configured on THIS installation.
 *     DISPATCHABLE          CineBraid owns code that can serialise and send it.
 *     RECOMMENDED           evidence says it is the one to use for this job.
 *
 * A model becomes a pressable Generate button only when it is compatible AND
 * connected AND dispatchable. Everything else is shown with the reason it is not,
 * because "GPT Image 2 — needs a fal key" is useful and a missing row is not.
 *
 * RECOMMENDED IS NOT COMPUTED HERE. Ordering inside a band comes from
 * `catalogue.priority`, an integer a human wrote with a reason beside it. Nothing in
 * this file derives a quality score from a capability list, and where a use-case
 * guide's decision is `undecided-pending-evaluation` these options say exactly that
 * rather than promoting whichever candidate sorted first.
 *
 * Pure. No network, no filesystem, no clock. The connection map and the adapter
 * inventory arrive as arguments so the browser and the server produce the identical
 * answer from the identical facts.
 */

/* ---------------------------------------------------------------------------
   A. WHAT A FILMMAKER IS TRYING TO DO.

   Four tasks, in production language. A task is NOT a mode: "Animate shot" becomes
   i2v, flf or r2v depending on what the shot actually has attached, and choosing
   between them is CineBraid's job rather than the filmmaker's. */
const CINEBRAID_FILMMAKER_TASKS = [
  {
    task: "blocking-frame",
    label: "Create blocking frame",
    summary: "A fast, cheap layout that fixes composition, framing, staging and who is where.",
    outputType: "image",
    useCase: "blocking-frame",
    modes: ["blocking"],
  },
  {
    task: "create-frame",
    label: "Create frame",
    summary: "A production still for this shot, built from the approved references.",
    outputType: "image",
    useCase: "hero-still",
    modes: ["t2i", "multi-reference"],
  },
  {
    task: "edit-frame",
    label: "Edit frame",
    summary: "Change part of an approved frame and leave the rest exactly as it is.",
    outputType: "image",
    useCase: "image-editing",
    modes: ["edit", "inpaint"],
  },
  {
    task: "animate-shot",
    label: "Animate shot",
    summary: "Turn this shot into motion, from whatever it already has approved.",
    outputType: "video",
    useCase: null,
    modes: ["t2v", "i2v", "flf", "r2v"],
  },
];

/* Presentation language, and ONLY presentation language. The internal contracts keep
   their names — a plan is still `flf`, an endpoint is still fl2va — because renaming
   a contract to make a screen read better is how two halves of a system stop
   agreeing. An advanced panel shows the mode; a normal one shows this. */
const CINEBRAID_MODE_LANGUAGE = {
  t2i: "Create from a written description",
  blocking: "Lay the shot out",
  "multi-reference": "Create from approved references",
  "style-reference": "Create in an approved look",
  moodboard: "Create a moodboard",
  edit: "Edit an existing frame",
  inpaint: "Change part of a frame",
  outpaint: "Extend a frame",
  variation: "Make a variation",
  "control-guided": "Create from a pose or depth guide",
  upscale: "Enlarge a frame",
  restore: "Restore a frame",
  t2v: "Create from scratch",
  i2v: "Animate from first frame",
  flf: "Animate between frames",
  r2v: "Animate using references",
  "video-edit": "Edit an existing clip",
  "audio-video": "Animate with sound",
  retake: "Retake the shot",
  v2v: "Restyle an existing clip",
  tts: "Speak a line",
  music: "Write music",
  sfx: "Make a sound effect",
};

/* How far CineBraid has got with one choice, in the order a screen should rank them.
   Exactly one of these is pressable. */
const CINEBRAID_OPTION_AVAILABILITY = [
  /* compatible, connected, and CineBraid owns the adapter. Press Generate. */
  "ready",
  /* everything works except this installation: no key, no local runtime. */
  "setup-required",
  /* the catalogue knows it and CineBraid has no code that can send it. */
  "not-implemented",
  /* this model cannot do what this shot is asking for. */
  "incompatible",
];

/* Catalogue statuses a NORMAL picker may show. `watchlist` means nothing establishes
   what the model does, `deprecated` and `not-recommended` mean CineBraid has decided
   against it — none of the three belongs in front of someone trying to make a shot.
   They stay in the catalogue and stay visible in the advanced view. */
const CINEBRAID_NORMAL_STATUSES = ["launch", "next-up"];

/* These three are declared identically in shared-model-intelligence.js, which is
   deliberate and safe: every shared file is a plain script in ONE global scope, so a
   duplicate `function` silently overrides and a duplicate `const` is a SyntaxError that
   stops the whole bundle. Identical bodies make the override a no-op. A suite asserts
   the const case can never recur; keep these byte-identical if either file changes. */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return String(value == null ? "" : value).trim();
}
function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function filmmakerTask(task) {
  return CINEBRAID_FILMMAKER_TASKS.find((row) => row.task === text(task)) || null;
}
function modeLanguage(mode) {
  return CINEBRAID_MODE_LANGUAGE[text(mode)] || text(mode);
}

/* ---------------------------------------------------------------------------
   B. WHAT THE SHOT ACTUALLY HAS.

   The filmmaker asks to animate a shot. Whether that is i2v, flf or r2v is decided
   by what is attached to it, and deciding it here rather than making them choose is
   the whole difference between production language and endpoint language.

   Order matters and is deliberate: a shot with a first AND a last frame is a
   first/last-frame shot, not an image-to-video shot that happens to carry a spare
   reference. The most specific reading of the inputs wins. */
function describeInputs(inputs = {}) {
  const references = listOf(inputs.references).filter(isRecord);
  const roles = new Set(references.map((row) => text(row.role)));
  const counts = { image: 0, video: 0, audio: 0 };
  for (const row of references) {
    const media = text(row.mediaType) || "image";
    if (media in counts) counts[media] += 1;
  }
  return {
    references,
    roles: [...roles].sort(),
    counts,
    hasFirstFrame: roles.has("first-frame"),
    hasLastFrame: roles.has("last-frame"),
    hasBase: roles.has("base"),
    hasMask: roles.has("mask"),
    /* An "influence" is any reference that is not a temporal endpoint or a plate.
       It is what distinguishes "animate using references" from "animate from a
       frame", and it is counted rather than named because which influences a model
       accepts is the model's business, not this function's. */
    influences: references.filter((row) => !["first-frame", "last-frame", "base", "mask"].includes(text(row.role))).length,
  };
}

/* Which modes this task WANTS, given what the shot has. A task may want more than
   one — "Create frame" is t2i with nothing attached and multi-reference with
   approved references — and each wanted mode becomes its own option per model, so a
   model that can do one and not the other says so per row rather than as a whole. */
function resolveTaskModes(task, inputs = {}) {
  const definition = filmmakerTask(task);
  if (!definition) return [];
  const shape = describeInputs(inputs);
  /* A blocking frame is a PRODUCTION concept, not a model feature. `blocking` is a
     CineBraid mode that one model in the catalogue declares; every other image model
     would produce the same frame from an ordinary text-to-image call given a
     blocking brief. Offering only the declared mode would have made a blocking frame
     look like something only GPT Image 2 can do, and hidden both local candidates
     behind the wrong word. Preference order: the dedicated mode where a model has
     one, plain generation where it does not. */
  if (definition.task === "blocking-frame") return ["blocking", "t2i"];
  if (definition.task === "edit-frame") return shape.hasMask ? ["inpaint", "edit"] : ["edit"];
  if (definition.task === "create-frame") return shape.references.length ? ["multi-reference", "t2i"] : ["t2i"];
  /* animate-shot */
  if (shape.hasFirstFrame && shape.hasLastFrame) return ["flf"];
  if (shape.hasFirstFrame) return ["i2v"];
  if (shape.references.length) return ["r2v"];
  return ["t2v"];
}

/* ---------------------------------------------------------------------------
   C. CONNECTION.

   Whether the thing a surface needs is present on THIS machine. Deliberately not
   the same question as whether an account exists: a Civitai connection is a real,
   authenticated account and is irrelevant to dispatching a fal render, and a screen
   that cannot tell the two apart eventually offers a Generate button backed by the
   wrong credential.

   The caller supplies the map because only the server can read a key, and only the
   browser knows what the settings page currently shows. */
function connectionFor(connections, surfaceId) {
  const map = isRecord(connections) ? connections : {};
  const row = isRecord(map[text(surfaceId)]) ? map[text(surfaceId)] : null;
  return {
    connected: row ? row.connected === true : false,
    label: row ? text(row.label) : "",
    /* What a filmmaker would have to do. Named by the caller, because "add a fal API
       key in Settings" and "start ComfyUI on this machine" are different sentences
       and neither belongs hard-coded in a resolver. */
    action: row ? text(row.action) : "",
    reason: row ? text(row.reason) : "",
  };
}

/* ---------------------------------------------------------------------------
   D. DISPATCH.

   The one fact the catalogue cannot supply. `state: "available"` in
   data/provider-surfaces.json is a claim about the PROVIDER — that this provider
   serves this model today. Whether CineBraid can build the request is a fact about
   CineBraid's own code, and the two are independent: Runware genuinely serves
   Seedance 2.5 and CineBraid has no Runware adapter, so a screen that read the
   catalogue alone would draw a Generate button with nothing behind it.

   So the adapter inventory is passed in, minted by whoever owns the serializers, and
   a suite asserts every entry resolves to a real one. Nothing here is allowed to
   infer dispatchability from a data file. */
function adapterFor(adapters, modelId, surfaceId, mode) {
  for (const row of listOf(adapters).filter(isRecord)) {
    if (text(row.modelId) !== text(modelId)) continue;
    if (text(row.surfaceId) !== text(surfaceId)) continue;
    if (!listOf(row.modes).map(text).includes(text(mode))) continue;
    return row;
  }
  return null;
}

/* ---------------------------------------------------------------------------
   E. REASONS.

   Every unavailable choice explains itself in words a filmmaker can act on. The
   `code` is what a test or a screen switches on; the `message` is what a person
   reads, and it never contains an endpoint, a mode abbreviation or an intersection. */
function reason(code, message, action = "") {
  return { code, message, action };
}

/* A capability refusal, translated.
 *
 * The generic resolver's own words are correct and unreadable — "No modes value is
 * supported by every layer of this configuration" is a true sentence that tells a
 * filmmaker nothing. Its messages are written for whoever is debugging an
 * intersection; these are written for whoever is trying to make a shot, and the
 * untranslated text is kept in `detail` for the advanced panel rather than shown.
 *
 * The request checker's messages ARE already about the request — "this configuration
 * accepts 9 image references; 12 were supplied" — so those pass through. */
function translateBlock(block, modelName, modeLabel) {
  const field = text(block?.field);
  const code = text(block?.reason);
  const supplied = text(block?.message);
  const action = text(block?.action);
  const job = String(modeLabel || "do this").toLowerCase();

  /* From resolveCapability: a whole capability is absent. Never passed through. */
  if (code === "empty-intersection" || code === "incompatible-range" || code === "no-layers") {
    if (field === "modes")
      return reason("mode-unsupported", `${modelName} cannot ${job}.`, "Choose another model for this step.");
    if (field === "referenceRoles")
      return reason("reference-role-unsupported", `${modelName} cannot take the kind of references this shot is carrying.`, "Remove them, or choose a model that accepts them.");
    if (field === "resolutions")
      return reason("resolution-unavailable", `CineBraid and this provider do not agree on any output size for ${modelName}, so it cannot be used from here.`, "");
    if (field === "aspectRatios")
      return reason("aspect-unsupported", `${modelName} cannot deliver this production's format through this provider.`, "");
    if (field === "durationSeconds")
      return reason("duration-unsupported", `${modelName} and this provider do not agree on any shot length.`, "");
    return reason("unsupported", `${modelName} cannot be used for this here.`, "");
  }
  if (code === "conflicting-quantiser")
    return reason("unsupported", `${modelName} and this provider round shot length onto different frame grids.`, "");

  /* From checkRequestAgainstCapability: it is about THIS request, and it already
     says so in words. */
  if (field.startsWith("references") && field.endsWith("role"))
    return reason("reference-role-unsupported", supplied || `${modelName} does not accept one of the references this shot is carrying.`, action);
  if (["maxReferenceImages", "maxReferenceVideos", "maxReferenceAudio"].includes(field))
    return reason("too-many-references", supplied, action);
  if (field === "durationSeconds")
    return reason("duration-unsupported", supplied, action);
  if (field === "aspectRatio" || field === "aspectRatios")
    return reason("aspect-unsupported", supplied, action);
  if (field === "mode")
    return reason("mode-unsupported", `${modelName} cannot ${job}.`, "Choose another model for this step.");
  return reason(code || "unsupported", supplied || `${modelName} cannot be used for this.`, action);
}

/* ---------------------------------------------------------------------------
   F. ONE OPTION.

   Model × surface × mode, with every one of the six words answered separately. */
function buildOption(context) {
  const {
    model, surface, offering, mode, task, intelligence, connections, adapters, request,
  } = context;
  const modelId = text(model.id);
  const modelName = text(model.displayName) || modelId;
  const surfaceId = surface ? text(surface.surfaceId) : "";
  const surfaceKind = surface ? text(surface.executionSurface) || "api" : "";
  const local = surfaceKind === "local";
  const reasons = [];

  /* 1. CAPABILITY. model ∩ surface, through the resolver that already exists. */
  const effective = surface
    ? intelligence.effectiveCapability({ modelId, surfaceId, mode })
    : { ok: false, capability: null, reason: "no-surface", divergences: [] };
  const capability = effective.capability;
  let compatible = Boolean(effective.ok && capability);
  /* "mode" when the model does not do this kind of job at all, "request" when it
     does but not with these inputs. Null while it still fits. */
  let capabilityMismatch = null;

  if (!surface)
    reasons.push(reason(
      "no-backend",
      `CineBraid knows ${modelName}, but no provider it can reach offers it.`,
      "",
    ));
  else if (!compatible) {
    /* A model that accepts NO references has an empty role set, and the generic
       resolver reports an empty intersection as a block — correctly, because it is
       answering "what is possible" with no request in front of it. Here there IS a
       request, and a model that takes no references is perfectly able to serve one
       that carries none. Z-Image Turbo and Krea 2 Turbo are both text-to-image only,
       and reading that as "incompatible" would have hidden the two local blocking
       candidates behind the wrong sentence: the true answer is that CineBraid cannot
       run them yet, not that they cannot do the job. */
    const suppliedReferences = listOf(isRecord(request) ? request.references : []).length;
    const blocked = listOf(capability?.blockedBy)
      .filter((block) => !(text(block?.field) === "referenceRoles" && suppliedReferences === 0));
    if (!blocked.length) compatible = true;
    else {
      for (const block of blocked) reasons.push(translateBlock(block, modelName, modeLanguage(mode)));
      /* WHY it does not fit, which decides whether it is worth showing at all.
         "This model does not do this kind of job" is noise in front of someone
         choosing how to make a shot; "this model could, but not with the twelve
         references you attached" is something they can act on. */
      capabilityMismatch = blocked.some((block) => text(block.field) === "modes") ? "mode" : "request";
    }
  }

  /* 2. THE REQUEST. A model that supports the mode may still not accept THIS shot's
     references, duration or format. Checked against the same shared checker the
     compiler and the dispatcher use, so a screen and a submission cannot disagree. */
  if (compatible && isRecord(request) && typeof context.checkRequest === "function") {
    const check = context.checkRequest({ ...request, mode }, capability);
    if (!check.ok) {
      compatible = false;
      capabilityMismatch = "request";
      for (const block of listOf(check.blockedBy)) reasons.push(translateBlock(block, modelName, modeLanguage(mode)));
    }
  }

  /* 3. BACKEND-AVAILABLE. A surface that merely CATALOGUES a model is a research
     source, not an execution path, and saying so is the difference between an
     honest list and a dead end. */
  const offeringState = offering ? text(offering.state) : "";
  const backendAvailable = offeringState === "available";

  /* 4. CONNECTED. */
  const connection = connectionFor(connections, surfaceId);

  /* 5. DISPATCHABLE. */
  const adapter = adapterFor(adapters, modelId, surfaceId, mode);
  const dispatchable = Boolean(adapter);

  if (surface && !dispatchable)
    reasons.push(local
      ? reason(
        "local-not-implemented",
        `CineBraid can describe ${modelName} but cannot run it locally yet — no local generation path ships.`,
        "Use an API option for now.",
      )
      : reason(
        "adapter-missing",
        /* An OFFERING means this provider serves this model — that is what a catalogue
           entry records. So the sentence is always about CineBraid's missing code and
           never about the provider's missing model, because the second would be false
           and is the exact confusion that produced a dead-end picker. */
        `${text(surface.displayName) || surfaceId} serves ${modelName}, but CineBraid has no way to send a request to it yet.`,
        "",
      ));
  else if (surface && dispatchable && !connection.connected)
    reasons.push(reason(
      "not-connected",
      connection.reason || `${text(surface.displayName) || surfaceId} is not set up on this CineBraid yet.`,
      connection.action,
    ));

  const availability = !compatible
    ? "incompatible"
    : !dispatchable
      ? "not-implemented"
      : !connection.connected
        ? "setup-required"
        : "ready";

  const catalogue = isRecord(model.catalogue) ? model.catalogue : {};
  const useCases = listOf(model.useCases).map(text);
  const guide = task && task.useCase ? intelligence.getUseCaseGuide(task.useCase) : null;
  const decision = guide && isRecord(guide.decision) ? guide.decision : null;

  return {
    /* Minted here and read back by generationOptionIdentity() a few lines below, so the
       two halves of this identity cannot drift apart. */
    optionId: `${modelId}::${surfaceId || "none"}::${mode}`,
    modelId,
    modelName,
    vendor: text(model.vendor),
    surfaceId,
    surfaceName: surface ? text(surface.displayName) || surfaceId : "",
    surfaceKind,
    /* The badge a filmmaker reads. Two words, and they are the two that decide
       whether a render costs money. */
    where: local ? "Local" : surface ? "API" : "",
    costClass: surface ? text(surface.costClass) : "",
    mode,
    modeLabel: modeLanguage(mode),
    /* Where this mode sits in the task's preference order, so collapsing two modes
       for one model keeps the one CineBraid would actually use rather than whichever
       sorted first alphabetically. */
    modeIndex: Number.isFinite(Number(context.modeIndex)) ? Number(context.modeIndex) : 0,
    availability,
    actionable: availability === "ready",
    capabilityMismatch,
    /* Every one of the six, separately, so nothing downstream has to collapse them
       and no test has to infer one from another. */
    known: true,
    compatible,
    backendAvailable,
    connected: connection.connected,
    dispatchable,
    /* Deliberately never a boolean this module computed. Where a guide has taken a
       decision this names it; where it has not, `state` says so and a screen shows
       "awaiting evaluation" instead of inventing a winner. */
    recommendation: decision
      ? {
        state: text(decision.state),
        isRecommended: text(decision.recommended) === modelId,
        isLocalOption: text(decision.localOption) === modelId,
        isPremiumAlternative: text(decision.premiumAlternative) === modelId,
        shortlisted: guideShortlists(decision, modelId),
      }
      : null,
    reasons,
    /* Advanced-only detail. A normal screen must not print any of this. */
    detail: {
      catalogueStatus: text(catalogue.status),
      maturity: text(catalogue.maturity),
      priority: Number.isFinite(Number(catalogue.priority)) ? Number(catalogue.priority) : null,
      evidenceStrength: text(model.evidenceStrength),
      offeringState,
      openWeights: model.openWeights === true,
      useCases,
      adapterId: adapter ? text(adapter.adapterId) : "",
      divergences: listOf(effective.divergences),
      capability: capability
        ? {
          modes: capability.modes,
          referenceRoles: capability.referenceRoles,
          maxReferenceImages: capability.maxReferenceImages,
          maxReferenceVideos: capability.maxReferenceVideos,
          maxReferenceAudio: capability.maxReferenceAudio,
          maxPromptCharacters: capability.maxPromptCharacters,
          resolutions: capability.resolutions,
          aspectRatios: capability.aspectRatios,
          durationSeconds: capability.durationSeconds,
          flags: capability.flags,
          layers: capability.layers,
        }
        : null,
    },
    /* Kept out of the normal picker: nothing establishes what it does, or CineBraid
       has decided against it. Still in the catalogue, still visible in advanced. */
    advancedOnly: !CINEBRAID_NORMAL_STATUSES.includes(text(catalogue.status)),
  };
}

function guideShortlists(decision, modelId) {
  const out = [];
  const shortlist = isRecord(decision.shortlist) ? decision.shortlist : {};
  for (const slot of Object.keys(shortlist).sort())
    for (const row of listOf(shortlist[slot]))
      if (isRecord(row) && text(row.modelId) === text(modelId)) out.push({ slot, why: text(row.why) });
  return out;
}

/* ---------------------------------------------------------------------------
   G. ORDERING.

   Four bands, then the catalogue's own priority inside a band, then the model id so
   the same catalogue always produces the same list. There is no derived score of any
   kind: a longer resolution list is not a better model, and a resolver that learned
   to sort on one would silently change CineBraid's advice every time a definition
   gained a field. */
function optionRank(option) {
  return CINEBRAID_OPTION_AVAILABILITY.indexOf(option.availability);
}
/* Inside the incompatible band, how CLOSE it came. A model that does this job and
   cannot take the twelve references attached to it is nearer to usable than one that
   does not do this job at all — and this is also what decides which of a task's two
   modes represents a model when the rows are collapsed: reporting "Krea 2 Turbo cannot
   lay the shot out" when the real answer is "it cannot take an approved identity
   reference" would name the wrong obstacle. */
function mismatchRank(option) {
  if (option.capabilityMismatch === "request") return 0;
  if (option.capabilityMismatch === "mode") return 1;
  return 0;
}
function compareOptions(a, b) {
  const bandA = optionRank(a);
  const bandB = optionRank(b);
  if (bandA !== bandB) return bandA - bandB;
  const nearA = mismatchRank(a);
  const nearB = mismatchRank(b);
  if (nearA !== nearB) return nearA - nearB;
  const priorityA = Number.isFinite(a.detail.priority) ? a.detail.priority : Number.MAX_SAFE_INTEGER;
  const priorityB = Number.isFinite(b.detail.priority) ? b.detail.priority : Number.MAX_SAFE_INTEGER;
  if (priorityA !== priorityB) return priorityA - priorityB;
  if (a.modelId !== b.modelId) return a.modelId < b.modelId ? -1 : 1;
  if (a.modeIndex !== b.modeIndex) return a.modeIndex - b.modeIndex;
  return a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0;
}

/* What a NORMAL picker shows. Two exclusions, and both are about noise rather than
   about hiding a refusal:

     - a model nothing establishes, or one CineBraid has decided against;
     - a model that simply does not do this kind of job. "Kling 3 Pro cannot animate
       using references" is true and is not a choice anybody was considering.

   An option that could do the job but not with THESE inputs stays, disabled, with
   the reason — because that one is actionable: remove a reference, change a length,
   and it becomes available. */
function isNormalOption(option) {
  if (option.advancedOnly) return false;
  return option.capabilityMismatch !== "mode";
}

/* ---------------------------------------------------------------------------
   H. THE RESOLVER. */
function resolveGenerationOptions(input = {}) {
  const intelligence = input.intelligence;
  const definition = filmmakerTask(input.task);
  if (!intelligence || !definition)
    return { task: text(input.task), modes: [], options: [], normal: [], guide: null, shape: describeInputs(input.inputs) };

  const shape = describeInputs(input.inputs);
  const modes = listOf(input.modes).map(text).filter(Boolean).length
    ? listOf(input.modes).map(text)
    : resolveTaskModes(definition.task, input.inputs);

  /* The models a screen may consider AT ALL for this task. Modality first, because a
     video model is never an answer to "create a frame"; then the use-case tag where
     the task has one, so the list is the models somebody has said can do this job
     rather than every model of the right medium.

     A model with no tag is not excluded outright — it is included only when it can
     actually be dispatched, which is how the one model CineBraid can really run
     never disappears because of a missing tag. */
  const byModality = intelligence.listModels({ modality: definition.outputType });
  const tagged = definition.useCase
    ? byModality.filter((model) => listOf(model.useCases).map(text).includes(definition.useCase))
    : byModality;
  const taggedIds = new Set(tagged.map((model) => text(model.id)));
  const adapters = listOf(input.adapters).filter(isRecord);
  const dispatchableIds = new Set(adapters.map((row) => text(row.modelId)));
  const models = byModality.filter((model) => taggedIds.has(text(model.id)) || dispatchableIds.has(text(model.id)));

  const options = [];
  for (const model of models) {
    const offerings = intelligence.offeringsForModel(model.id);
    modes.forEach((mode, modeIndex) => {
      const shared = {
        model, mode, modeIndex, task: definition,
        intelligence, connections: input.connections, adapters, request: input.request,
        checkRequest: input.checkRequest,
      };
      if (!offerings.length) {
        options.push(buildOption({ ...shared, surface: null, offering: null }));
        return;
      }
      for (const { surface, offering } of offerings)
        options.push(buildOption({ ...shared, surface, offering }));
    });
  }

  /* One row per model×surface. A task that wants two modes — "Create frame" wants
     multi-reference and t2i — must not print the same model twice; the mode that got
     furthest is the one the filmmaker would actually get. */
  const best = new Map();
  for (const option of options.sort(compareOptions)) {
    const key = `${option.modelId}::${option.surfaceId}`;
    if (!best.has(key)) best.set(key, option);
  }
  const collapsed = [...best.values()].sort(compareOptions);

  return {
    task: definition.task,
    taskLabel: definition.label,
    taskSummary: definition.summary,
    outputType: definition.outputType,
    modes,
    shape,
    options: collapsed,
    normal: collapsed.filter(isNormalOption),
    /* The use-case guide verbatim, decision state included. A screen renders
       "awaiting evaluation" from this; it never fills a slot itself. */
    guide: definition.useCase ? intelligence.getUseCaseGuide(definition.useCase) : null,
  };
}

/* Named for this module rather than `EXPORTS`: every shared file is a plain script in
   one global scope, and a second top-level `const EXPORTS` is a SyntaxError that stops
   the whole bundle. shared-model-intelligence.js already had that name and had never
   been loaded in the browser before this phase. */
/* WHAT AN OPTION ID SAYS ABOUT ITSELF.
 *
 * An option id is minted above as `modelId::surfaceId::mode` and is a CineBraid identity,
 * not client prose - reading it here, in the module that writes it, is the opposite of
 * inferring intent from an arbitrary payload. This exists because the paid boundary needs
 * to check one thing it could not check before: that a request naming BOTH an option and
 * a model is naming a consistent pair.
 *
 * The route cannot re-run resolveGenerationOptions() to answer that - resolving needs a
 * filmmaker task and the shot inputs, and a dispatch body carries neither. What it can do
 * is ask the minting owner what identity a given id carries.
 *
 * A model id may itself contain "/" (gpt-image-2/standard) but never "::", so the split
 * is unambiguous. Anything that is not exactly three segments is not an id this system
 * minted, and the answer is `known: false` rather than a guess. */
function generationOptionIdentity(optionId) {
  const raw = text(optionId);
  if (!raw) return { known: false, optionId: "", modelId: "", surfaceId: "", mode: "" };
  const parts = raw.split("::");
  if (parts.length !== 3 || !text(parts[0]) || !text(parts[2]))
    return { known: false, optionId: raw, modelId: "", surfaceId: "", mode: "" };
  return {
    known: true,
    optionId: raw,
    modelId: text(parts[0]),
    surfaceId: text(parts[1]) === "none" ? "" : text(parts[1]),
    mode: text(parts[2]),
  };
}

/* EVERY MODE ANY FILMMAKER TASK CAN ASK FOR, from the task table above and nothing
   else. resolveTaskModes() returns a subset of these for a given task and input shape —
   it narrows by shape, it never invents a mode a task does not declare — so the union of
   the declared arrays IS the mode vocabulary this module can mint. That relationship is
   asserted in tests/paid-request-truth.js against the live table rather than trusted,
   because a task that started returning an undeclared mode would make this quietly
   incomplete. */
function generationOptionModes() {
  return [...new Set(CINEBRAID_FILMMAKER_TASKS.flatMap((task) => listOf(task.modes).map(text)).filter(Boolean))];
}

/* COULD CINEBRAID HAVE MINTED THIS OPTION IDENTITY?
 *
 * generationOptionIdentity() answers whether a string has the SHAPE of an id. That is
 * not the same question, and an independent reviewer proved the gap: `gpt-image-2/
 * standard::not-a-real-surface::not-a-real-mode` has three segments, passed, dispatched,
 * and was recorded durably as the option a filmmaker had chosen.
 *
 * So every component is checked against the source resolveGenerationOptions() mints from,
 * and nothing here holds a list of its own:
 *
 *   model    intelligence.getModel() — the catalogue.
 *   surface  intelligence.offeringsForModel() — the surfaces that actually OFFER this
 *            model. A real surface that does not carry this model could never have
 *            produced this id, which is the "valid mode on the wrong surface" case.
 *            An empty surface segment is legal and means exactly what the minter means
 *            by it: a model no reachable provider offers.
 *   mode     the filmmaker task table above.
 *
 * MINTABLE IS NOT AVAILABLE, deliberately. The picker mints an option for every
 * model x surface x mode a task considers, INCLUDING ones the model cannot do — that is
 * how it shows a filmmaker why something is unavailable. An id for an unsupported
 * combination is a real id and stays mintable here; whether that option can be
 * dispatched is a different question, asked by a different owner, further on. */
function generationOptionMintable(optionId, intelligence) {
  const identity = generationOptionIdentity(optionId);
  if (!identity.known) return { ...identity, mintable: false, reason: "not-an-option-identity" };
  if (!intelligence || typeof intelligence.getModel !== "function")
    return { ...identity, mintable: false, reason: "no-catalogue" };
  if (!intelligence.getModel(identity.modelId))
    return { ...identity, mintable: false, reason: "model-not-in-catalogue" };
  const offerings = typeof intelligence.offeringsForModel === "function"
    ? listOf(intelligence.offeringsForModel(identity.modelId))
    : [];
  const offered = offerings.map((row) => text(row?.surface?.surfaceId)).filter(Boolean);
  if (identity.surfaceId ? !offered.includes(identity.surfaceId) : offered.length)
    return { ...identity, mintable: false, reason: "surface-does-not-offer-this-model", offeredSurfaces: offered };
  if (!generationOptionModes().includes(identity.mode))
    return { ...identity, mintable: false, reason: "not-a-filmmaker-task-mode" };
  return { ...identity, mintable: true, reason: "" };
}

const GENERATION_OPTION_EXPORTS = {
  CINEBRAID_FILMMAKER_TASKS,
  CINEBRAID_MODE_LANGUAGE,
  CINEBRAID_NORMAL_STATUSES,
  CINEBRAID_OPTION_AVAILABILITY,
  adapterFor,
  compareOptions,
  connectionFor,
  describeInputs,
  filmmakerTask,
  generationOptionIdentity,
  generationOptionMintable,
  generationOptionModes,
  isNormalOption,
  modeLanguage,
  resolveGenerationOptions,
  resolveTaskModes,
};

if (typeof window !== "undefined") Object.assign(window, GENERATION_OPTION_EXPORTS);
if (typeof module !== "undefined" && module.exports) module.exports = GENERATION_OPTION_EXPORTS;

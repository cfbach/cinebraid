/* What CineBraid can actually dispatch, and what this installation is set up for.
 *
 * public/shared-generation-options.js is the pure resolver: it takes a catalogue, a
 * connection map and an adapter inventory and produces the list a screen renders.
 * This module supplies the two things only the server can know.
 *
 * THE ADAPTER INVENTORY is the answer to the one question the catalogue cannot
 * answer. `state: "available"` in data/provider-surfaces.json is a claim about the
 * PROVIDER — that fal serves GPT Image 2 today, that Runware serves Seedance 2.5
 * today. Both are true. Neither says CineBraid owns code that can build the request,
 * and conflating the two is exactly how a model becomes selectable and then cannot
 * generate.
 *
 * So dispatchability is declared HERE, beside the serializers, with each entry
 * holding the function it names. A suite asserts every entry resolves to a real
 * serializer and that nothing outside this list is ever reported as dispatchable —
 * which is what stops a catalogue edit from drawing a Generate button.
 *
 * CONNECTION is separate again, and deliberately not the same question as whether an
 * account exists. A Civitai connection is a real authenticated account and is
 * irrelevant to dispatching a fal render. What matters per surface is whether the
 * specific thing that surface needs is present: a fal key for fal, a local runtime
 * for ComfyUI.
 */

const { serializeH3PlanForFal } = require("./fal-h3-backend");
const { serializeImagePlanForFal } = require("./fal-image-backend");
const { H3_MODEL_IDS } = require("./h3-execution");
const { IMAGE_MODEL_ID } = require("./image-execution");
const { getModelPack } = require("./generation-compiler");
const { loadModelIntelligence } = require("./model-intelligence");
const { checkRequestAgainstCapability } = require("./public/shared-generation-capability");
const { generationOptionMintable, resolveGenerationOptions, resolveTaskModes } = require("./public/shared-generation-options");

/* Every model×surface×mode CineBraid can serialise and send today. Three entries,
   two serializers, one provider — and saying so plainly is the point. Adding a
   fourth is a code change beside a real adapter, never a data edit. */
const CINEBRAID_GENERATION_ADAPTERS = [
  {
    adapterId: "fal-h3-fl2va",
    modelId: H3_MODEL_IDS.i2v,
    surfaceId: "fal-queue",
    modes: ["t2v", "i2v", "flf"],
    serialize: serializeH3PlanForFal,
  },
  {
    adapterId: "fal-h3-ref2va",
    modelId: H3_MODEL_IDS.r2v,
    surfaceId: "fal-queue",
    modes: ["r2v"],
    serialize: serializeH3PlanForFal,
  },
  {
    adapterId: "fal-gpt-image-2",
    modelId: IMAGE_MODEL_ID,
    surfaceId: "fal-queue",
    /* Blocking revision, candidate correction and entity-reference generation still
       run on the pre-C2b image path and are NOT claimed here: an adapter entry is a
       promise that a compiled plan can be dispatched, and those three do not compile
       one yet. */
    modes: ["t2i", "blocking", "multi-reference", "edit", "inpaint"],
    serialize: serializeImagePlanForFal,
  },
];

/* Stripped of its functions, because the browser receives this and a function is not
   JSON. The shape the pure resolver reads is exactly what survives. */
function publicAdapters() {
  return CINEBRAID_GENERATION_ADAPTERS.map((row) => ({
    adapterId: row.adapterId,
    modelId: row.modelId,
    surfaceId: row.surfaceId,
    modes: [...row.modes],
  }));
}

/* ---------------------------------------------------------------------------
   WHICH PROMPT PROFILES THIS BUILD CAN ACTUALLY EXECUTE.

   data/model-profiles.json is the PROMPT catalogue: how to write for a model. It is
   deliberately larger than what CineBraid can run, because a profile is worth having
   before an adapter exists. The motion picker read that catalogue directly, so every
   profile in it looked equally usable — and the ones with no wiring behind them
   became a dead end discovered only after a prompt had been built.

   Dispatching a profile needs TWO pieces of CineBraid's own code, and they are
   separate facts:

     a model pack   can COMPILE for this family (model-packs/*.js, registered).
     an adapter     can SERIALISE and SEND that model in this mode (the list above).

   Both are code, neither is inferred from a data file, and nothing here branches on a
   model name: the pack is looked up by the profile's own family and the adapter by the
   model ids that pack declares. A new family becomes selectable when its pack and its
   adapter ship, which is exactly when it can really run. */
function profileModelIds(profile) {
  const pack = getModelPack(String(profile?.family || ""));
  return pack && pack.models && typeof pack.models === "object" ? Object.keys(pack.models) : [];
}

function profileExecutionSupport(profile, adapters = publicAdapters()) {
  const family = String(profile?.family || "");
  const mode = String(profile?.mode || "");
  const name = String(profile?.name || profile?.id || "This model");
  const rows = Array.isArray(adapters) ? adapters : [];
  const modelIds = profileModelIds(profile);
  const adapter = rows.find((row) => modelIds.includes(String(row.modelId)) && (row.modes || []).map(String).includes(mode));
  if (adapter) return { dispatchable: true, adapterId: String(adapter.adapterId), modelId: String(adapter.modelId), reason: "", action: "" };
  /* The two refusals are different facts and a filmmaker can act on the difference:
     one family has no code at all here, the other has code that does not cover this
     workflow. Neither sentence claims the provider is missing the model. */
  return modelIds.length
    ? {
      dispatchable: false,
      adapterId: "",
      modelId: "",
      reason: `CineBraid can write for ${name}, but it cannot send this kind of request to it yet.`,
      action: "",
    }
    : {
      dispatchable: false,
      adapterId: "",
      modelId: "",
      reason: `CineBraid can write prompts for ${name}, but this build has no way to generate with it — no adapter for ${family || "this model"} ships yet.`,
      action: "",
    };
}

/* The same answer for a whole profile library, with the alternatives filled in from
   the library itself so a refusal can name a model that really is wired for the same
   job. Returns a copy: the catalogue on disk is never annotated. */
function annotateProfileLibraryExecution(library, adapters = publicAdapters()) {
  const source = library && typeof library === "object" ? library : {};
  const profiles = Array.isArray(source.profiles) ? source.profiles : [];
  const support = profiles.map((profile) => profileExecutionSupport(profile, adapters));
  return {
    ...source,
    profiles: profiles.map((profile, index) => {
      const row = support[index];
      const alternatives = row.dispatchable
        ? []
        : profiles
          .map((other, otherIndex) => ({ other, ok: support[otherIndex].dispatchable }))
          .filter((entry) => entry.ok
            && String(entry.other.mediaType || "") === String(profile.mediaType || "")
            && String(entry.other.mode || "") === String(profile.mode || ""))
          .map((entry) => ({ id: String(entry.other.id || ""), name: String(entry.other.name || entry.other.id || "") }));
      return {
        ...profile,
        execution: {
          ...row,
          alternatives,
          action: row.dispatchable
            ? ""
            : alternatives.length
              ? `Use ${alternatives[0].name} for this step — it is wired and can generate today.`
              : "Nothing in this build can generate this kind of result yet.",
        },
      };
    }),
  };
}

/* What this installation is actually set up for, per surface.
 *
 * `connected` is answered only for surfaces CineBraid could dispatch to. Everything
 * else is honestly `false` with the reason being that no credential path exists —
 * which is a different sentence from "you have not added a key", and a filmmaker who
 * reads the first and goes looking for a settings field deserves not to. */
function generationConnections(config = {}) {
  const fal = (config.generation && config.generation.fal) || {};
  const falKey = Boolean(process.env.FAL_KEY || fal.apiKey);
  const falOn = fal.enabled === true;
  return {
    "fal-queue": {
      connected: falOn && falKey,
      label: "fal",
      reason: !falOn
        ? "fal generation is switched off in Settings."
        : !falKey
          ? "fal is switched on but has no API key on this CineBraid."
          : "",
      action: !falOn || !falKey ? "Open Settings and connect fal." : "",
    },
    "comfy-local": {
      connected: false,
      label: "Local ComfyUI",
      reason: "CineBraid has no local generation runtime yet, so nothing can run on this machine.",
      action: "",
    },
    runware: {
      connected: false,
      label: "Runware",
      reason: "CineBraid has no Runware connection.",
      action: "",
    },
    "openai-images": { connected: false, label: "OpenAI", reason: "CineBraid has no OpenAI image connection.", action: "" },
    "bfl-api": { connected: false, label: "Black Forest Labs", reason: "CineBraid has no Black Forest Labs connection.", action: "" },
    "elevenlabs-api": { connected: false, label: "ElevenLabs", reason: "CineBraid has no ElevenLabs connection.", action: "" },
    "minimax-api": { connected: false, label: "MiniMax", reason: "CineBraid has no MiniMax connection.", action: "" },
  };
}

/* The one call a route makes. Everything variable arrives as an argument so a test
   can ask the same question with a different catalogue, a different connection map
   or a different adapter list, and get an answer computed the same way. */
/* THE USE-CASE GUIDE, ON THE WIRE.
 *
 * Named and exported rather than written inline in the route, because what it drops is
 * invisible from either end: the identity of a recommendation survived this mapping while
 * its REASON did not, so a genuinely decided recommendation arrived at the screen with a
 * model id and nothing to justify it — and the presentation layer, given nothing,
 * substituted a generic sentence CineBraid never wrote.
 *
 * `note` is the field data/model-definitions.json records a decision's reasoning in. It
 * travels with the decision it explains. A recommendation without its reason is an
 * assertion of authority, which is the one thing this catalogue is careful never to be. */
function guidePayload(guide) {
  if (!guide || typeof guide !== "object") return null;
  const decision = guide.decision && typeof guide.decision === "object" ? guide.decision : {};
  return {
    useCase: guide.useCase,
    headline: guide.headline,
    decisionState: decision.state || "",
    recommended: decision.recommended || null,
    /* The authority's own words, verbatim and unabridged. */
    note: decision.note || "",
    localOption: decision.localOption || null,
    premiumAlternative: decision.premiumAlternative || null,
  };
}

function generationOptionsFor(input = {}) {
  return resolveGenerationOptions({
    task: input.task,
    inputs: input.inputs,
    request: input.request,
    intelligence: input.intelligence || loadModelIntelligence(),
    connections: input.connections || generationConnections(input.config || {}),
    adapters: input.adapters || publicAdapters(),
    checkRequest: checkRequestAgainstCapability,
  });
}

/* THE MINTABILITY QUESTION, WITH THE CATALOGUE SUPPLIED.
 *
 * public/shared-generation-options.js owns the rule and holds no data; this hands it the
 * same `intelligence` that generationOptionsFor() hands resolveGenerationOptions() a few
 * lines above, so an identity is judged against exactly the source it would have been
 * minted from. The paid boundary calls this rather than reasoning about option ids
 * itself — there is no second option taxonomy anywhere. */
function generationOptionIdentityFor(optionId, input = {}) {
  return generationOptionMintable(optionId, input.intelligence || loadModelIntelligence());
}

module.exports = {
  CINEBRAID_GENERATION_ADAPTERS,
  generationOptionIdentityFor,
  annotateProfileLibraryExecution,
  generationConnections,
  generationOptionsFor,
  guidePayload,
  profileExecutionSupport,
  publicAdapters,
  resolveTaskModes,
};

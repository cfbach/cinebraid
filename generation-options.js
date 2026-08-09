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
const { loadModelIntelligence } = require("./model-intelligence");
const { checkRequestAgainstCapability } = require("./public/shared-generation-capability");
const { resolveGenerationOptions, resolveTaskModes } = require("./public/shared-generation-options");

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

module.exports = {
  CINEBRAID_GENERATION_ADAPTERS,
  generationConnections,
  generationOptionsFor,
  publicAdapters,
  resolveTaskModes,
};

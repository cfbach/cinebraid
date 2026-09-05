/* The capability-aware generation picker.
 *
 * The Deep Pre-Alpha audit's most damaging finding was a model list that could be
 * selected and then could not generate. This suite is the boundary that removes it, and
 * everything it asserts reduces to one property:
 *
 *     A choice is pressable ONLY when it is capability-compatible AND the provider it
 *     needs is connected AND CineBraid owns code that can serialise it. Every other
 *     choice carries the sentence explaining which of the three is missing.
 *
 * The six words the audit found collapsed — known, compatible, backend-available,
 * connected, dispatchable, recommended — are asserted SEPARATELY throughout, because a
 * suite that checks only the collapsed answer cannot tell which one was wrong.
 */
const assert = require("assert");

const {
  CINEBRAID_FILMMAKER_TASKS,
  CINEBRAID_NORMAL_STATUSES,
  describeInputs,
  isNormalOption,
  modeLanguage,
  resolveGenerationOptions,
  resolveTaskModes,
} = require("../public/shared-generation-options");
const { CINEBRAID_GENERATION_ADAPTERS, generationConnections, generationOptionsFor, publicAdapters } = require("../generation-options");
const { loadModelIntelligence } = require("../model-intelligence");
const { checkRequestAgainstCapability } = require("../public/shared-generation-capability");

const notes = [];
const note = (line) => notes.push(line);

const catalogue = loadModelIntelligence();

const FAL_ON = { generation: { fal: { enabled: true, apiKey: "k" } } };
const FAL_OFF = { generation: { fal: { enabled: false } } };
const FAL_NO_KEY = { generation: { fal: { enabled: true } } };

const image = (role) => ({ role, mediaType: "image" });
const options = (task, references = [], config = FAL_ON, extra = {}) => generationOptionsFor({
  task,
  inputs: { references },
  request: { references, ...extra },
  config,
});
const find = (resolved, modelId, surfaceId) =>
  resolved.options.find((row) => row.modelId === modelId && (!surfaceId || row.surfaceId === surfaceId)) || null;
const normalIds = (resolved) => resolved.normal.map((row) => row.modelId);

/* ===========================================================================
   1. THE SIX WORDS ARE NOT SYNONYMS. */

{
  const resolved = options("blocking-frame");
  const gpt = find(resolved, "gpt-image-2/standard", "fal-queue");
  assert(gpt, "GPT Image 2 on fal must be among the blocking-frame options");
  for (const key of ["known", "compatible", "backendAvailable", "connected", "dispatchable"])
    assert.strictEqual(gpt[key], true, `a ready option must be ${key}`);
  assert.strictEqual(gpt.actionable, true);
  assert.strictEqual(gpt.availability, "ready");
  /* And recommendation is a SEPARATE, independent field that nothing here computed. */
  assert(gpt.recommendation, "an option in a guided use case carries the guide's decision");
  assert.strictEqual(gpt.recommendation.state, "undecided-pending-evaluation",
    "the blocking-frame winner is still undecided and the resolver must say so");
  assert.strictEqual(gpt.recommendation.isRecommended, false,
    "no model may be marked recommended while the guide's decision is undecided");

  /* Runware: catalogued, genuinely served, and not dispatchable. */
  const seedream = find(resolved, "seedream/5.0-pro", "runware");
  assert(seedream, "a Runware offering is KNOWN and must appear");
  assert.strictEqual(seedream.known, true);
  assert.strictEqual(seedream.dispatchable, false, "Runware has no CineBraid adapter");
  assert.strictEqual(seedream.actionable, false, "a catalogue entry is not a Generate button");

  note(`the six words stay apart: GPT Image 2 on fal is compatible+connected+dispatchable, Seedream on Runware is known and none of the three`);
}

/* ===========================================================================
   2. THE AVAILABILITY MATRIX. */

/* A. fal configured + GPT Image 2 dispatchable -> actionable. */
{
  const resolved = options("blocking-frame", [], FAL_ON);
  const gpt = find(resolved, "gpt-image-2/standard", "fal-queue");
  assert.strictEqual(gpt.actionable, true, "A: with fal connected the one dispatchable image model is pressable");
  assert.deepStrictEqual(gpt.reasons, [], "a ready option needs no excuse");
}

/* B. fal absent -> setup-required, WITH the reason and the action. Never hidden: a
   filmmaker who cannot see the option cannot discover what to connect. */
for (const [label, config, fragment] of [["off", FAL_OFF, /switched off/i], ["no key", FAL_NO_KEY, /no API key/i]]) {
  const resolved = options("blocking-frame", [], config);
  const gpt = find(resolved, "gpt-image-2/standard", "fal-queue");
  assert.strictEqual(gpt.availability, "setup-required", `B(${label}): an unconnected provider is setup-required, not missing`);
  assert.strictEqual(gpt.compatible, true, `B(${label}): connection has nothing to do with capability`);
  assert.strictEqual(gpt.dispatchable, true, `B(${label}): connection has nothing to do with whether an adapter exists`);
  assert.strictEqual(gpt.connected, false);
  assert(fragment.test(gpt.reasons[0].message), `B(${label}): the reason must say what is wrong — got "${gpt.reasons[0].message}"`);
  assert(/Settings/i.test(gpt.reasons[0].action), `B(${label}): the reason must say what to do`);
  assert(normalIds(resolved).includes("gpt-image-2/standard"), `B(${label}): it stays in the normal picker`);
}

/* C. H3 with a first frame -> the first-frame option, executable. */
{
  const resolved = options("animate-shot", [image("first-frame")], FAL_ON, { durationSeconds: 8 });
  assert.deepStrictEqual(resolved.modes, ["i2v"], "C: a shot with only an opening frame animates from it");
  const h3 = find(resolved, "minimax-h3/fl2va", "fal-queue");
  assert.strictEqual(h3.actionable, true, "C: H3 must remain executable");
  assert.strictEqual(h3.modeLabel, "Animate from first frame", "C: the filmmaker sees the job, not the mode");
}

/* D. H3 with first AND last -> the between-frames option, executable. */
{
  const resolved = options("animate-shot", [image("first-frame"), image("last-frame")], FAL_ON, { durationSeconds: 8 });
  assert.deepStrictEqual(resolved.modes, ["flf"], "D: two endpoint frames is a first/last-frame shot, not an i2v with a spare");
  const h3 = find(resolved, "minimax-h3/fl2va", "fal-queue");
  assert.strictEqual(h3.actionable, true, "D: H3 must remain executable for first/last frame");
  assert.strictEqual(h3.modeLabel, "Animate between frames");
}

/* E. An incompatible input -> disabled, with a reason naming the input rather than an
   intersection. */
{
  const tooMany = Array.from({ length: 14 }, () => image("identity"));
  const resolved = options("animate-shot", tooMany, FAL_ON, { durationSeconds: 8 });
  const h3 = find(resolved, "minimax-h3/ref2va", "fal-queue");
  assert.strictEqual(h3.actionable, false, "E: 14 image references exceed what fal accepts for H3");
  assert.strictEqual(h3.compatible, false);
  assert.strictEqual(h3.capabilityMismatch, "request", "E: this is a problem with the request, not with the model");
  assert(/references/i.test(h3.reasons[0].message), `E: the reason must name the input — got "${h3.reasons[0].message}"`);
  assert(isNormalOption(h3), "E: a request-shaped refusal stays visible, because removing a reference fixes it");
}

/* F. A Runware catalogue offering -> not actionable without an adapter, and the reason
   distinguishes "Runware does not have it" from "CineBraid cannot send to Runware". */
{
  const resolved = options("animate-shot", [image("identity"), image("location")], FAL_ON, { durationSeconds: 8 });
  const seedance = find(resolved, "seedance/2.5", "runware");
  assert(seedance, "F: Seedance on Runware is catalogued and must be listed");
  assert.strictEqual(seedance.compatible, true, "F: Seedance genuinely can do this job");
  assert.strictEqual(seedance.connected, false);
  assert.strictEqual(seedance.dispatchable, false, "F: no Runware adapter exists");
  assert.strictEqual(seedance.actionable, false);
  assert.strictEqual(seedance.reasons[0].code, "adapter-missing");
  assert(/Runware serves Seedance 2\.5/i.test(seedance.reasons[0].message),
    `F: the reason must say the provider has it and CineBraid cannot reach it — got "${seedance.reasons[0].message}"`);
}

/* F2. And the same model on fal, which C2b established genuinely serves it. The
   distinction that matters: a NEW provider surface changes what the sentence says and
   does NOT change whether the button works. */
{
  const resolved = options("animate-shot", [image("first-frame")], FAL_ON, { durationSeconds: 8 });
  const seedanceFal = find(resolved, "seedance/2.5", "fal-queue");
  assert(seedanceFal, "F2: C2b established fal serves Seedance 2.5, so the catalogue must show it there");
  assert.strictEqual(seedanceFal.dispatchable, false, "F2: reading a provider's schema is not the same as owning an adapter");
  assert.strictEqual(seedanceFal.actionable, false);
  assert.strictEqual(seedanceFal.connected, true, "F2: fal IS connected — which is exactly why the refusal must not be about connection");
  assert.strictEqual(seedanceFal.reasons[0].code, "adapter-missing");
}

/* G. A local model known with no runtime -> shown honestly as unavailable, and NOT as
   incompatible. Both local blocking candidates are text-to-image only, which is a
   capability fact and not a reason to hide them. */
for (const modelId of ["z-image/turbo", "krea-2/turbo"]) {
  const resolved = options("blocking-frame", [], FAL_ON);
  const local = find(resolved, modelId, "comfy-local");
  assert(local, `G: ${modelId} is the catalogue's local blocking candidate and must be listed`);
  assert.strictEqual(local.where, "Local", "G: local and API must be distinguishable at a glance");
  assert.strictEqual(local.compatible, true, "G: a text-to-image model can make a blocking frame from a written brief");
  assert.strictEqual(local.dispatchable, false, "G: no local generation path ships");
  assert.strictEqual(local.availability, "not-implemented");
  assert.strictEqual(local.reasons[0].code, "local-not-implemented");
  assert(/cannot run it locally yet/i.test(local.reasons[0].message),
    `G: the reason must be about CineBraid's missing runtime — got "${local.reasons[0].message}"`);
  assert(normalIds(resolved).includes(modelId), "G: the local option is visible and honest, not hidden");
}

/* H. A watchlist model is absent from the normal picker and present in the full list. */
{
  const resolved = options("blocking-frame");
  const watch = find(resolved, "gemini-image/3-pro");
  assert(watch, "H: a watchlist model stays in the catalogue and in the advanced list");
  assert.strictEqual(watch.detail.catalogueStatus, "watchlist");
  assert.strictEqual(watch.advancedOnly, true);
  assert(!normalIds(resolved).includes("gemini-image/3-pro"), "H: a watchlist model must not reach the normal picker");
}

/* I. A deprecated model is absent from the normal picker too, and is not deleted. */
{
  const resolved = options("animate-shot", [], FAL_ON, { durationSeconds: 8 });
  const dead = find(resolved, "seedance/2.0");
  assert(dead, "I: a deprecated model stays in the catalogue for provenance");
  assert.strictEqual(dead.detail.catalogueStatus, "deprecated");
  assert(!normalIds(resolved).includes("seedance/2.0"), "I: a deprecated model must not reach the normal picker");
  const notRecommended = find(resolved, "wan/3.0");
  assert(notRecommended && !normalIds(resolved).includes("wan/3.0"),
    "I: a researched-and-declined model is kept and is not offered either");
}

/* J. Advanced mode exposes more, and exposes the technical identity the normal view
   deliberately withholds. */
{
  const resolved = options("blocking-frame");
  assert(resolved.options.length > resolved.normal.length, "J: the advanced list must be strictly larger");
  const gpt = find(resolved, "gpt-image-2/standard", "fal-queue");
  assert.strictEqual(gpt.detail.adapterId, "fal-gpt-image-2", "J: advanced detail names the adapter");
  assert(Array.isArray(gpt.detail.capability.resolutions) && gpt.detail.capability.resolutions.includes("1536x1024"),
    "J: advanced detail carries the effective capability");
  assert.strictEqual(gpt.detail.offeringState, "available");
  note(`normal vs advanced: blocking-frame shows ${resolved.normal.length} of ${resolved.options.length} model/provider rows`);
}

/* ===========================================================================
   3. NO DEAD ENDS, AND NO FLAT DUMP. */

{
  /* The registry has 32 models. A picker that showed them all would be the defect this
     phase exists to remove, and one that showed only what works would hide the answer
     to "why can I not use X". Both bounds are asserted. */
  assert(catalogue.models.length >= 30, "the intelligence registry is large — that is the point");
  for (const task of ["blocking-frame", "create-frame", "animate-shot"]) {
    const resolved = options(task, task === "animate-shot" ? [image("first-frame")] : [], FAL_ON, task === "animate-shot" ? { durationSeconds: 8 } : {});
    assert(resolved.normal.length <= 10,
      `${task}: the normal picker showed ${resolved.normal.length} rows; a filmmaker is not choosing from the registry`);
    assert(resolved.normal.length >= 1, `${task}: something relevant must be offered`);
    for (const option of resolved.options) {
      if (option.actionable) continue;
      assert(option.reasons.length, `${task}/${option.optionId}: an unavailable choice must explain itself`);
      for (const row of option.reasons) {
        assert(row.message.trim(), "a reason must be a sentence");
        /* No jargon, no intersections, no endpoint strings. */
        assert(!/intersection|layer|CAPABILITY_|empty-intersection/i.test(row.message),
          `${task}/${option.optionId}: reason leaks resolver vocabulary — "${row.message}"`);
        assert(!/\/(text|image|reference)-to-|fal-queue|minimax\/h3/.test(row.message),
          `${task}/${option.optionId}: reason leaks a provider route — "${row.message}"`);
      }
    }
  }
  note(`no dead ends: every non-actionable option across three tasks carries a filmmaker-readable reason`);
}

/* ===========================================================================
   4. ORDERING IS A BAND AND A WRITTEN PRIORITY — NEVER A DERIVED SCORE. */

{
  const resolved = options("blocking-frame", [], FAL_ON);
  const bands = resolved.options.map((row) => row.availability);
  const rank = { ready: 0, "setup-required": 1, "not-implemented": 2, incompatible: 3 };
  for (let i = 1; i < bands.length; i++)
    assert(rank[bands[i]] >= rank[bands[i - 1]], `ordering must be banded: ${bands[i - 1]} came before ${bands[i]}`);

  /* The negative half, and the one that matters: nothing may be promoted by having a
     longer capability list. Two options in the same band with the same written
     priority must order by id, not by how much they can do. */
  const sameBand = resolved.options.filter((row) => row.availability === "not-implemented");
  const byPriority = [...sameBand].sort((a, b) => {
    const pa = a.detail.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.detail.priority ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || (a.modelId < b.modelId ? -1 : 1);
  });
  assert.deepStrictEqual(sameBand.map((r) => r.optionId), byPriority.map((r) => r.optionId),
    "inside a band the order is the catalogue's written priority, then the model id");
}

/* ===========================================================================
   5. THE BLOCKING-FRAME DECISION IS STILL UNDECIDED. */

{
  const guide = catalogue.getUseCaseGuide("blocking-frame");
  assert(guide, "the blocking-frame guide must exist");
  assert.strictEqual(guide.decision.state, "undecided-pending-evaluation",
    "C2b must not have filled the blocking-frame decision");
  for (const slot of ["recommended", "localOption", "premiumAlternative"])
    assert.strictEqual(guide.decision[slot], null, `${slot} must remain unfilled until the evaluation runs`);
  const resolved = options("blocking-frame");
  for (const option of resolved.options)
    if (option.recommendation)
      for (const key of ["isRecommended", "isLocalOption", "isPremiumAlternative"])
        assert.strictEqual(option.recommendation[key], false,
          `${option.modelId}: nothing may be presented as a winner while the guide is undecided`);
  note(`blocking-frame recommendation remains undecided-pending-evaluation; ${guide.candidates.length} candidates carry capability facts and no ranking`);
}

/* ===========================================================================
   6. THE ADAPTER INVENTORY IS CODE, NOT DATA. */

{
  for (const adapter of CINEBRAID_GENERATION_ADAPTERS) {
    assert.strictEqual(typeof adapter.serialize, "function",
      `${adapter.adapterId}: an adapter entry must resolve to a real serializer`);
    assert(catalogue.getModel(adapter.modelId), `${adapter.adapterId}: names a model that is not in the catalogue`);
    assert(catalogue.getSurface(adapter.surfaceId), `${adapter.adapterId}: names a surface that is not in the catalogue`);
    const offering = catalogue.offeringsForModel(adapter.modelId)
      .find((row) => row.surface.surfaceId === adapter.surfaceId);
    assert(offering, `${adapter.adapterId}: the surface does not offer this model`);
    assert.strictEqual(offering.offering.state, "available",
      `${adapter.adapterId}: CineBraid claims an adapter for an offering the catalogue does not present as available`);
  }
  /* Exactly three, on one provider, for two serializers — and saying the number out
     loud is what makes a fourth appearing an event rather than a drift. */
  assert.strictEqual(CINEBRAID_GENERATION_ADAPTERS.length, 3, "C2b ships three adapters; a fourth is a deliberate change");
  assert.deepStrictEqual([...new Set(CINEBRAID_GENERATION_ADAPTERS.map((row) => row.surfaceId))], ["fal-queue"],
    "fal is still the only surface CineBraid dispatches to");
  /* And the browser copy carries no functions. */
  for (const row of publicAdapters())
    assert.deepStrictEqual(Object.keys(row).sort(), ["adapterId", "modelId", "modes", "surfaceId"],
      "the browser adapter list must be plain data");
}

/* ===========================================================================
   7. ADVERSARIAL: THE SHAPES A REAL BLOCKING FRAME ARRIVES IN. */

{
  const shapes = [
    ["no references", []],
    ["one character", [image("identity")]],
    ["two characters", [image("identity"), image("identity")]],
    ["a location", [image("location")]],
    ["a prop", [image("prop")]],
    ["character + location + prop", [image("identity"), image("location"), image("prop")]],
  ];
  for (const [label, references] of shapes) {
    const resolved = options("blocking-frame", references, FAL_ON);
    const gpt = find(resolved, "gpt-image-2/standard", "fal-queue");
    assert(gpt, `${label}: GPT Image 2 must be offered`);
    assert.strictEqual(gpt.actionable, true, `${label}: the one dispatchable image path must stay pressable`);
    assert(resolved.normal.length >= 1 && resolved.normal.length <= 10, `${label}: the picker stays small`);
  }
  note(`blocking shapes: ${shapes.length} reference combinations all resolve to a pressable option and a bounded list`);
}

/* An input modality the local candidates cannot take. The distinction C2a insisted on —
   the OPEN Krea checkpoint is text-to-image and the HOSTED endpoint takes ten weighted
   references — must survive into the picker. */
{
  const resolved = options("blocking-frame", [image("identity")], FAL_ON);
  const localKrea = find(resolved, "krea-2/turbo", "comfy-local");
  const hostedKrea = find(resolved, "krea-2/large", "runware");
  assert.strictEqual(localKrea.compatible, false,
    "the open Krea 2 Turbo checkpoint cannot consume an approved identity reference");
  assert.strictEqual(localKrea.reasons[0].code, "reference-role-unsupported");
  assert.strictEqual(hostedKrea.compatible, true,
    "the hosted Krea 2 Large endpoint documents ten references and must not be narrowed to the checkpoint's zero");
  assert.strictEqual(hostedKrea.dispatchable, false, "and it still has no adapter");
  /* The local Krea row also carries a DIFFERENT model id from the hosted one, which is
     the structural reason the two cannot be confused. */
  assert.notStrictEqual(localKrea.modelId, hostedKrea.modelId);
  note("Krea local vs hosted stays separate: the checkpoint refuses an identity reference the hosted endpoint accepts");
}

/* Z-Image the same way: fast local text-to-image, and nothing about editing or
   reference composition is claimed for it. */
{
  const zImage = catalogue.getModel("z-image/turbo");
  assert.deepStrictEqual(zImage.capabilities.modes, ["t2i", "variation"],
    "no editing or reference mode may be claimed for the local Z-Image checkpoint");
  assert.strictEqual(zImage.capabilities.maxReferenceImages, 0);
  const resolved = options("blocking-frame", [image("identity")], FAL_ON);
  const local = find(resolved, "z-image/turbo", "comfy-local");
  assert.strictEqual(local.compatible, false, "Z-Image Turbo cannot take an approved reference");
  assert.strictEqual(local.reasons[0].code, "reference-role-unsupported");
}

/* ===========================================================================
   8. TASK, MODE AND LANGUAGE. */

{
  assert.deepStrictEqual(resolveTaskModes("animate-shot", { references: [] }), ["t2v"]);
  assert.deepStrictEqual(resolveTaskModes("animate-shot", { references: [image("first-frame")] }), ["i2v"]);
  assert.deepStrictEqual(resolveTaskModes("animate-shot", { references: [image("first-frame"), image("last-frame")] }), ["flf"]);
  assert.deepStrictEqual(resolveTaskModes("animate-shot", { references: [image("identity")] }), ["r2v"]);
  assert.deepStrictEqual(resolveTaskModes("edit-frame", { references: [image("base")] }), ["edit"]);
  assert.deepStrictEqual(resolveTaskModes("edit-frame", { references: [image("base"), image("mask")] }), ["inpaint", "edit"]);
  assert.deepStrictEqual(resolveTaskModes("create-frame", { references: [] }), ["t2i"]);
  /* Blocking is a production concept, not a model feature: a model without the
     dedicated mode still makes a blocking frame from a written brief. */
  assert.deepStrictEqual(resolveTaskModes("blocking-frame", { references: [] }), ["blocking", "t2i"]);

  /* Filmmaker language everywhere the picker speaks, and the internal contract names
     untouched underneath. */
  assert.strictEqual(modeLanguage("t2v"), "Create from scratch");
  assert.strictEqual(modeLanguage("i2v"), "Animate from first frame");
  assert.strictEqual(modeLanguage("flf"), "Animate between frames");
  assert.strictEqual(modeLanguage("r2v"), "Animate using references");
  for (const task of CINEBRAID_FILMMAKER_TASKS)
    assert(task.label && task.summary && !/[a-z]2[a-z]/.test(task.label), `${task.task}: a task label must be production language`);

  const shape = describeInputs({ references: [image("first-frame"), image("last-frame"), image("identity")] });
  assert.strictEqual(shape.hasFirstFrame, true);
  assert.strictEqual(shape.hasLastFrame, true);
  assert.strictEqual(shape.influences, 1, "an influence is anything that is not an endpoint or a plate");
  assert.strictEqual(shape.counts.image, 3);
}

/* ===========================================================================
   9. THE RESOLVER IS PURE AND DETERMINISTIC. */

{
  const once = resolveGenerationOptions({
    task: "blocking-frame",
    inputs: { references: [] },
    request: { references: [] },
    intelligence: catalogue,
    connections: generationConnections(FAL_ON),
    adapters: publicAdapters(),
    checkRequest: checkRequestAgainstCapability,
  });
  const twice = resolveGenerationOptions({
    task: "blocking-frame",
    inputs: { references: [] },
    request: { references: [] },
    intelligence: catalogue,
    connections: generationConnections(FAL_ON),
    adapters: publicAdapters(),
    checkRequest: checkRequestAgainstCapability,
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(once)), JSON.parse(JSON.stringify(twice)),
    "the same catalogue, connections and adapters must produce byte-identical options");

  /* An unknown task is an empty answer, not a throw and not a guess. */
  const unknown = resolveGenerationOptions({ task: "make-a-film", intelligence: catalogue });
  assert.deepStrictEqual(unknown.options, []);
}

/* ===========================================================================
   10. CONNECTION IS NOT ACCOUNT IDENTITY. */

{
  const connections = generationConnections({
    generation: { fal: { enabled: true, apiKey: "k" } },
    /* A real, authenticated Civitai account. It has nothing to do with dispatching a
       fal render, and the two must never be read as one "is the user connected". */
    accounts: { "conn-1": { providerId: "civitai", status: "connected" } },
  });
  assert.strictEqual(connections["fal-queue"].connected, true);
  assert.strictEqual(connections.runware.connected, false, "an unrelated account never connects a provider");
  /* ComfyUI V1 shipped a local runtime, so the old sentence — "CineBraid has no local
     generation runtime yet" — is no longer true and is no longer asserted. What replaces
     it is the SAME claim this block is about: a connection is what this installation is
     set up for, never an account it happens to hold. A real Civitai account still
     connects nothing here, and a fal key still connects nothing here. */
  assert.strictEqual(connections["comfy-local"].connected, false,
    "a fal key and a Civitai account connect nothing on the local surface");
  assert(/switched off in Settings/i.test(connections["comfy-local"].reason),
    "the local reason must name what is missing on the local surface, not a provider key");
  assert(/Settings/i.test(connections["comfy-local"].action),
    "and it must say where to go, because there is now something a filmmaker can do about it");

  /* Both halves are necessary, and neither alone is a connection. */
  const comfyOnNoFolder = generationConnections({ generation: { comfy: { enabled: true, workflowFolder: "" } } });
  assert.strictEqual(comfyOnNoFolder["comfy-local"].connected, false,
    "a ComfyUI switched on with no workflow folder has nothing to run");
  assert(/workflow folder/i.test(comfyOnNoFolder["comfy-local"].reason));
  const comfyFolderOff = generationConnections({ generation: { comfy: { enabled: false, workflowFolder: "D:/wf" } } });
  assert.strictEqual(comfyFolderOff["comfy-local"].connected, false,
    "a workflow folder on a switched-off integration is not a connection");
  const comfyReady = generationConnections({ generation: { comfy: { enabled: true, workflowFolder: "D:/wf" } } });
  assert.strictEqual(comfyReady["comfy-local"].connected, true);
  assert.strictEqual(comfyReady["comfy-local"].reason, "");
  assert.strictEqual(comfyReady["comfy-local"].action, "");
  /* AND IT IS STILL NOT A PROBE. Nothing above contacted anything: the same answer is
     produced for a machine whose ComfyUI is not running, which is why Settings tests the
     address separately and this does not pretend to. */
  assert.strictEqual(comfyReady["fal-queue"].connected, false,
    "and configuring ComfyUI connects nothing at fal");
}

/* ===========================================================================
   11. CATALOGUE STATUS VOCABULARY. */

assert.deepStrictEqual(CINEBRAID_NORMAL_STATUSES, ["launch", "next-up"],
  "only established and wanted models reach a normal picker");

/* ===========================================================================
   12. ONE GLOBAL SCOPE.

   Every public script is a plain <script> tag, so they all share one global scope. Two
   files declaring the same top-level `const` is a SyntaxError that stops the ENTIRE
   bundle at load — every later file, every handler, the whole application. C2b loaded
   shared-model-intelligence.js into the browser for the first time and hit exactly
   that: two files with `const EXPORTS`, and a blank screen.

   Nothing in a unit suite can see it, because Node gives each file its own module
   scope. So it is checked here, statically, against the scripts index.html actually
   loads — which is the only place the constraint is real. */
{
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.join(__dirname, "..");
  /* Per PAGE, because each page is its own global scope — app.js and bible.js both
     declare `esc`, and that is fine precisely because no page loads both. */
  let checked = 0;
  for (const page of ["index.html", "bible.html"]) {
    const html = fs.readFileSync(path.join(ROOT, "public", page), "utf8");
    const loaded = [...html.matchAll(/<script src="([^"?]+\.js)/g)].map((match) => match[1]);
    if (page === "index.html") {
      assert(loaded.length > 20, "the script list must have been found");
      assert(loaded.includes("shared-generation-options.js") && loaded.includes("generation-picker.js"),
        "the C2b browser modules must be loaded by the page");
    }
    const declaredIn = new Map();
    const collisions = [];
    for (const file of loaded) {
      const source = fs.readFileSync(path.join(ROOT, "public", file), "utf8").replace(/\r\n/g, "\n");
      for (const match of source.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        const name = match[1];
        const owner = declaredIn.get(name);
        if (owner && owner !== file) collisions.push(`${name} in ${owner} and ${file}`);
        else declaredIn.set(name, file);
      }
    }
    assert.deepStrictEqual(collisions, [],
      `${page}: two scripts on one page declare the same top-level const/let/class, which is a SyntaxError that stops the whole bundle — ${collisions.join("; ")}`);
    checked += loaded.length;
  }
  note(`one global scope per page: ${checked} script loads across two pages and no page declares a top-level binding twice`);
}

console.log(
  `Capability-aware generation options passed: ${catalogue.models.length} models across ${catalogue.surfaces.length} provider surfaces `
  + `resolved into bounded, banded pickers where known, compatible, connected, dispatchable and recommended stay five separate answers.\n`
  + notes.map((line) => `  - ${line}`).join("\n"),
);

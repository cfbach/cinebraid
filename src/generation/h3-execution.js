/* MiniMax H3 execution wiring.
 *
 * The single place a live H3 request is compiled. Everything downstream — the fal
 * serializer, the durable job, the preview the filmmaker confirms — reads the plan this
 * module produces, and nothing downstream is given the material to compile a second one.
 *
 *     durable prompt build (spec + approved references)
 *         -> generation-compiler + model-packs/minimax-h3   (C1, unchanged)
 *         -> GenerationPlan
 *         -> validated against the plan contract
 *         -> effective capability = model ∩ fal backend
 *
 * WHY THE SPEC AND NOT THE PROMPT. The browser used to post a finished prompt string
 * and the server dispatched it. That made the prompt the contract, so every guarantee
 * C1 established — endpoints bound by role, references carrying production meaning,
 * intent accounted for — stopped at the moment of dispatch, and the provider request was
 * assembled a second time from whatever happened to be in the array. Compiling from the
 * stored provider-neutral spec is what makes the request explainable: the same
 * production state compiles to the same plan, here, in the preview, and after a restart.
 *
 * The prompt build is the durable record of that state. It already carries `spec` and
 * `references` — the prompt engine has stored both since guided motion shipped — so
 * nothing new has to be persisted for this to work, and an existing project needs no
 * migration.
 *
 * NO LLM. NO NETWORK. Compilation is the C1 compiler's, which is pure. This module adds
 * a project read and a profile lookup, and nothing else.
 */

const { resolvePromptBuild } = require("../../public/shared-build-history");
const { compileValidatedGenerationPlan, checkPromptCoverage } = require("./generation-compiler");
const H3Pack = require("../../model-packs/minimax-h3");
const { resolveH3FalCapability, FAL_H3_MODES } = require("./fal/fal-h3-backend");
const { h3AspectSupport } = require("../../public/shared-aspect");
const { checkRequestAgainstCapability } = require("../../public/shared-generation-capability");

/* Quoted in refusals so a filmmaker can see that the limit they hit is the backend's
   and not the model's. Read from the pack rather than restated. */
const H3_NATIVE_DURATION = H3Pack.H3_FACTS.durationSeconds;

/* Registering the pack is a side effect of requiring it; naming it here makes the
   dependency explicit rather than incidental. */
const H3_PACK_ID = H3Pack.PACK_ID;

const H3_MODEL_IDS = { t2v: "minimax-h3/fl2va", i2v: "minimax-h3/fl2va", flf: "minimax-h3/fl2va", r2v: "minimax-h3/ref2va" };

class H3ExecutionError extends Error {
  constructor(code, message, detail = {}, status = 400) {
    super(message);
    this.name = "H3ExecutionError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

function text(value) {
  return String(value == null ? "" : value).trim();
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/* Lazily required. prompt-engine reads the profile registry from disk on every call,
   and a caller that wants to compile without it — a test, an offline check — supplies
   its own lookup instead. */
function defaultProfileLookup(profileId) {
  return require("./prompt-engine").getProfile(profileId);
}

/* ---------------------------------------------------------------------------
   Source intent.

   Read, never rebuilt. The build the filmmaker looked at when they pressed Generate is
   the build that compiles, so a shot edited in another tab between building and
   submitting cannot change what was approved without the build changing too. */
function readSourceIntent(project, shotId, buildId) {
  const shot = (Array.isArray(project?.shots) ? project.shots : []).find((row) => String(row?.id) === String(shotId));
  if (!shot)
    throw new H3ExecutionError("H3_SHOT_NOT_FOUND", "That shot no longer exists in this project.", { shotId }, 404);

  const brief = isRecord(shot.creationBrief) ? shot.creationBrief : {};
  const entries = Array.isArray(brief.motionPromptBuilds) ? brief.motionPromptBuilds : [];
  /* Containment: a build id is only usable through the shot that owns it. Resolving
     straight out of the project-wide store would let one shot's request compile
     another shot's approved package. */
  const entry = buildId
    ? entries.find((row) => String(row?.buildId || row?.id || row) === String(buildId))
    : entries[entries.length - 1];
  if (!entry)
    throw new H3ExecutionError(
      "H3_BUILD_NOT_FOUND",
      buildId
        ? "That motion prompt package is not on this shot any more. Rebuild the prompt before generating."
        : "Build a MiniMax H3 motion prompt before generating.",
      { shotId, buildId },
      404,
    );

  const build = resolvePromptBuild(project, entry);
  if (!build || build.missing)
    throw new H3ExecutionError(
      "H3_BUILD_NOT_FOUND",
      "That motion prompt package is no longer stored. Rebuild the prompt before generating.",
      { shotId, buildId },
      404,
    );
  if (!isRecord(build.spec))
    /* An older build predates structured spec storage. It cannot be compiled, and
       guessing a spec back out of its finished prompt would be exactly the second
       compilation this layer exists to remove. */
    throw new H3ExecutionError(
      "H3_SPEC_MISSING",
      "This motion prompt package was built before CineBraid stored structured shot direction, so it cannot be compiled for generation. Rebuild the prompt on this shot and generate from the new package.",
      { shotId, buildId: build.id || buildId },
    );
  return { shot, build };
}

/* Approved references, in the order the build recorded them. Reference SELECTION is a
   production decision made before this point; nothing here adds, drops or reorders one.
   The planner applies the canonical ordering, and the pack applies the limits. */
function buildReferences(build) {
  return (Array.isArray(build.references) ? build.references : [])
    .filter((row) => isRecord(row) && text(row.url))
    .map((row, index) => ({
      refId: text(row.key) || text(row.token) || `ref-${index + 1}`,
      role: text(row.role) || "reference",
      mediaType: text(row.mediaType).toLowerCase(),
      label: text(row.label || row.name),
      entityId: text(row.entityId),
      entityName: text(row.entityName),
      entityType: text(row.entityType),
      instruction: text(row.instruction),
      continuityState: text(row.continuityState || row.stateName),
      /* The address the bytes live at. It is not model-facing and never reaches the
         prompt; the fal serializer turns it into something the provider can fetch. */
      path: text(row.url),
      order: index,
    }));
}

/* ---------------------------------------------------------------------------
   Compilation.

   One call, one plan. The preview route and the submit route both come through here,
   and because the compiler is deterministic they get the same answer — which is what
   lets a filmmaker confirm a prompt and know it is the prompt that will be sent. */
function compileH3ExecutionPlan(request = {}) {
  const project = isRecord(request.project) ? request.project : null;
  if (!project) throw new H3ExecutionError("H3_PROJECT_MISSING", "No project was supplied.", {}, 500);

  const { shot, build } = readSourceIntent(project, text(request.shotId), text(request.buildId));
  const getProfile = typeof request.getProfile === "function" ? request.getProfile : defaultProfileLookup;
  const profile = getProfile(text(build.profileId));
  if (!profile)
    throw new H3ExecutionError(
      "H3_PROFILE_UNKNOWN",
      `The model target this package was built for (${text(build.profileId) || "unknown"}) is no longer available.`,
      { profileId: text(build.profileId) },
    );
  if (text(profile.family) !== "minimax-h3")
    throw new H3ExecutionError(
      "H3_PROFILE_NOT_MINIMAX",
      `MiniMax H3 generation needs a MiniMax H3 package; this one targets ${text(profile.name) || text(profile.family) || "another model"}.`,
      { profileId: profile.id, family: profile.family },
    );

  /* The MODE comes from the profile, not from the caller. A client-declared mode is a
     claim about what was built; the profile is the record of it. Where the caller says
     otherwise, that is a stale screen and refusing is better than compiling one mode
     and dispatching another. */
  const mode = text(profile.mode);
  const declared = text(request.mode);
  if (declared && declared !== mode)
    throw new H3ExecutionError(
      "H3_MODE_MISMATCH",
      `This package was built for ${mode}, but the request asks for ${declared}. Reopen the shot and generate again.`,
      { built: mode, requested: declared },
    );
  if (!FAL_H3_MODES.includes(mode))
    throw new H3ExecutionError(
      "H3_MODE_UNSUPPORTED",
      `CineBraid cannot dispatch MiniMax H3 ${mode || "generation"} through fal.`,
      { mode, supported: FAL_H3_MODES },
      400,
    );

  const surface = text(request.surface) || "api";
  const capability = resolveH3FalCapability(mode, H3Pack.capabilityLayer(mode, surface));

  /* Output settings the filmmaker chose in the generation dialog, applied to a COPY of
     the stored spec. The durable package is production state and is never edited by a
     dispatch. */
  const requestedDuration = Number(request.durationSeconds);
  const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : Number(build.durationSeconds) || Number(build.spec.durationSeconds) || 0;
  const spec = {
    ...build.spec,
    shotId: text(build.spec.shotId) || text(shot.id),
    durationSeconds: duration,
  };

  /* DURATION IS NOT NEGOTIATED DURING A PAID SUBMISSION.
   *
   * MiniMax H3 renders from 4 seconds; the fal backend accepts 5 to 15. Both are true,
   * and the compiler's own behaviour — snap onto the effective range and warn — is right
   * for a preview, where the filmmaker is still choosing and the adjustment is on screen
   * in front of them.
   *
   * It is wrong at the moment of dispatch. A 4-second shot that becomes a 5-second shot
   * because of which backend happens to be selected is a different shot than the one
   * that was directed, and the fact that a warning existed somewhere does not make it a
   * decision the filmmaker took. So a submission takes the duration it was given or
   * refuses it, and the refusal says what to choose instead.
   *
   * This asks the SHARED capability checker rather than re-deriving a floor here, so the
   * model ∩ backend intersection stays the only place a limit lives. */
  if (request.enforceDuration && duration > 0) {
    const check = checkRequestAgainstCapability({ mode, durationSeconds: duration }, capability);
    const blocked = check.blockedBy.find((row) => row.field === "durationSeconds");
    const [floor, ceiling] = Array.isArray(capability.durationSeconds) ? capability.durationSeconds : [];
    if (blocked || !Number.isInteger(duration))
      throw new H3ExecutionError(
        "H3_DURATION_UNSUPPORTED",
        blocked
          ? `This shot asks for ${duration} seconds. MiniMax H3 itself renders ${H3_NATIVE_DURATION[0]}–${H3_NATIVE_DURATION[1]} seconds, but the fal backend accepts ${floor}–${ceiling}. Choose a duration between ${floor} and ${ceiling} seconds and generate again — nothing was sent and nothing was charged.`
          : `This shot asks for ${duration} seconds. MiniMax H3 renders whole seconds only. Choose ${Math.max(floor || 1, Math.round(duration))} seconds and generate again — nothing was sent and nothing was charged.`,
        { requested: duration, range: capability.durationSeconds, modelRange: H3_NATIVE_DURATION },
      );
  }

  /* Aspect ratio goes through the one resolver every H3 path already shares, so a
     format the model cannot deliver is refused here rather than substituted. i2v and
     flf carry no ratio at all and the resolver says so. */
  const requestedAspect = text(request.aspectRatio) || text(build.spec.aspectRatio || build.spec.world?.aspectRatio);
  const aspectGate = h3AspectSupport(mode, requestedAspect);
  if (!aspectGate.ok)
    throw new H3ExecutionError(
      "H3_ASPECT_UNSUPPORTED",
      aspectGate.message,
      { mode, requested: aspectGate.requested, supported: aspectGate.supported },
    );
  if (aspectGate.carriesAspectRatio) spec.aspectRatio = aspectGate.value;
  else delete spec.aspectRatio;

  /* Resolved ONCE. The plan is compiled from these rows, the coverage re-check reads
     the same rows, and the dispatcher's generation binding needs them because the plan
     does not project a reference's entityId. Three readers of one resolution rather
     than three resolutions that could differ. */
  const sourceReferences = buildReferences(build);

  const { plan, validation } = compileValidatedGenerationPlan({
    mode,
    modelId: H3_MODEL_IDS[mode],
    surface,
    spec,
    references: sourceReferences,
    capability,
    resolution: text(request.resolution),
    target: { kind: "shot-motion", shotId: text(shot.id), purpose: "motion-h3" },
    /* Seed stays exactly as C1 left it: offered only where the resolved capability
       accepts one. Neither MiniMax nor fal documents an H3 seed, so this refuses and
       warns rather than inventing a number. */
    ...(request.seed != null && request.seed !== "" ? { seed: request.seed } : {}),
  });
  if (!validation.ok)
    throw new H3ExecutionError(
      "H3_PLAN_INVALID",
      "CineBraid could not compile a valid MiniMax H3 request from this shot. Nothing was sent and nothing was charged.",
      { errors: validation.errors },
    );

  const compiledPrompt = plan.inputs.prompt;
  /* A manual edit replaces the TEXT and nothing else. It is recorded beside the
     compiled prompt rather than in place of it, so a reviewer can always see both what
     CineBraid wrote and what the filmmaker chose to send. */
  const edited = typeof request.submittedPrompt === "string" ? request.submittedPrompt.trim() : "";
  const submittedPrompt = edited || compiledPrompt;
  const promptEdited = submittedPrompt !== compiledPrompt;
  /* The plan's coverage describes what the COMPILER wrote, and it stays that way. When
     the text sent is not the text compiled, the same deterministic check is re-run over
     the submitted words so the record cannot claim an intent is in a prompt it is no
     longer in. Nothing is refused on this basis — the words are the filmmaker's — but
     the difference is recorded rather than absorbed. */
  const editedCoverage = promptEdited
    ? checkPromptCoverage({ spec, references: sourceReferences, coverage: plan.coverage }, submittedPrompt)
    : null;

  return {
    plan,
    capability,
    validation,
    /* The rows the plan was compiled FROM, surfaced for the one caller that needs a
       fact the plan deliberately does not carry: which entity a reference belongs to.
       generation-contracts.js keeps ids out of a reference's production block, so the
       dispatcher reads it here instead of parsing it back out of a label or a key. */
    sourceReferences,
    mode,
    modelId: H3_MODEL_IDS[mode],
    surface,
    profile: { id: text(profile.id), name: text(profile.name), mode, family: text(profile.family), version: text(profile.profileVersion) },
    source: {
      shotId: text(shot.id),
      buildId: text(build.id || build.buildId || request.buildId),
      packageId: text(build.packageId),
      builtAt: text(build.date),
    },
    compiledPrompt,
    submittedPrompt,
    promptEdited,
    editedCoverage,
    aspect: aspectGate,
    /* What was ASKED for, kept beside what the plan compiled to. Without enforcement —
       the preview — these differ whenever the backend's floor is above the shot's
       duration, and the dialog says so instead of quietly showing the adjusted number
       as though it had always been the request. */
    durationRequested: duration || null,
    /* The MODEL's own limits, carried alongside the effective ones so a screen can name
       which layer narrowed what without hard-coding either number. */
    model: { durationSeconds: H3_NATIVE_DURATION, maxPromptCharacters: H3Pack.H3_FACTS.maxPromptCharacters },
  };
}

/* The durable provenance a job keeps.
 *
 * Enough to answer, months later and without the project open: what did CineBraid
 * compile, which compiler and pack version produced it, what prompt was used, which
 * endpoints were bound, which references were selected and what each one was FOR,
 * which model and backend were chosen, what settings were asked for, what the
 * configuration refused, and what was actually sent.
 *
 * Deliberately not the whole project. The bible, the shot list and the entity records
 * are not copied in — the plan already carries the compiled result of them, and a job
 * ledger that duplicates production state becomes a second source of truth that drifts. */
function planProvenance(compiled) {
  const { plan, capability } = compiled;
  return {
    /* The plan verbatim. It already carries the compiler identity, the endpoint
       bindings, every reference with its production meaning, the settings, the coverage
       record and the warnings — so keeping it whole is both smaller and more honest
       than a hand-picked subset that will fall behind the contract. */
    plan,
    surface: compiled.surface,
    source: compiled.source,
    profile: compiled.profile,
    /* What CineBraid wrote, kept whether or not it is what was sent. */
    compiledPrompt: compiled.compiledPrompt,
    compiledPromptCharacters: compiled.compiledPrompt.length,
    /* Present only when the submitted text differs from the compiled text. `lost` names
       the intents the compiler wrote and the edit removed — a record, not a refusal. */
    ...(compiled.editedCoverage ? { editedCoverage: compiled.editedCoverage } : {}),
    /* The effective capability this request was validated against, so a later reader
       can tell a refusal caused by the model from one caused by the backend without
       re-resolving anything against whatever the code says today. */
    capability: {
      layers: capability.layers,
      modes: capability.modes,
      durationSeconds: capability.durationSeconds,
      resolutions: capability.resolutions,
      aspectRatios: capability.aspectRatios,
      maxPromptCharacters: capability.maxPromptCharacters,
      maxReferenceImages: capability.maxReferenceImages,
      maxReferenceVideos: capability.maxReferenceVideos,
      maxReferenceAudio: capability.maxReferenceAudio,
      flags: capability.flags,
      blockedBy: capability.blockedBy,
    },
  };
}

/* WHAT THE CONTROL PLAN MAY DRAW for this route, resolved WITHOUT compiling - the
   motion twin of image-execution.js's imageControlCapability(), and there for the same
   reason: the payload gate at the money boundary runs before compilation, because
   compilation consumes duration, resolution and aspect ratio.

   Every value is read off the record resolveH3FalCapability() produces, which is the
   same record compileH3ExecutionPlan() resolves four lines into its own body and the
   same one POST /api/generation/fal/h3/plan reports as `resolutions`, `durationRange`
   and `seedSupported`. The MODE still comes from the profile rather than the caller,
   exactly as the compiler insists. */
function h3ControlCapability(request = {}) {
  const project = isRecord(request.project) ? request.project : null;
  if (!project) throw new H3ExecutionError("H3_PROJECT_MISSING", "No project was supplied.", {}, 500);
  const { build } = readSourceIntent(project, text(request.shotId), text(request.buildId));
  const getProfile = typeof request.getProfile === "function" ? request.getProfile : defaultProfileLookup;
  const profile = getProfile(text(build.profileId));
  if (!profile)
    throw new H3ExecutionError(
      "H3_PROFILE_UNKNOWN",
      `The model target this package was built for (${text(build.profileId) || "unknown"}) is no longer available.`,
      { profileId: text(build.profileId) },
    );
  const mode = text(profile.mode);
  if (!FAL_H3_MODES.includes(mode))
    throw new H3ExecutionError(
      "H3_MODE_UNSUPPORTED",
      `CineBraid cannot dispatch MiniMax H3 ${mode || "generation"} through fal.`,
      { mode, supported: FAL_H3_MODES },
      400,
    );
  const surface = text(request.surface) || "api";
  const capability = resolveH3FalCapability(mode, H3Pack.capabilityLayer(mode, surface));
  return {
    /* WHICH PACKAGE THIS ANSWER IS ABOUT — see the same field on
       imageControlCapability(). readSourceIntent() has already chosen it, empty-buildId
       fallback included; reporting it is what lets the paid boundary's freshness gate
       examine the package the compiler will actually use. */
    buildId: text(build.id) || text(build.buildId),
    resolutions: capability.resolutions,
    /* An empty ARRAY where the mode carries no aspect_ratio field at all, which is the
       same answer public/fal-generation.js's falH3ControlPlan() gives from
       `carriesAspectRatio`: null would mean "nobody constrained it" and would leave a
       control drawable for a field the request has no room for. */
    aspectRatios: Array.isArray(capability.aspectRatios) ? capability.aspectRatios : [],
    durationSeconds: capability.durationSeconds,
    qualityTiers: null,
    flags: { seed: capability.flags?.seed === true },
  };
}

module.exports = {
  H3ExecutionError,
  H3_MODEL_IDS,
  H3_PACK_ID,
  buildReferences,
  compileH3ExecutionPlan,
  h3ControlCapability,
  planProvenance,
  readSourceIntent,
};

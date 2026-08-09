/* Shared fixture for the GPT Image 2 execution-wiring suites.
 *
 * A live still-image request is compiled from a DURABLE PROMPT BUILD — the package the
 * prompt engine stores when a filmmaker builds a blocking or frame prompt, carrying the
 * provider-neutral spec and the approved references.
 *
 * The two build kinds are stored DIFFERENTLY in a real project and the difference is
 * load-bearing, so the fixture reproduces it rather than smoothing it out: a blocking
 * build is an inline object on the shot's creation brief, and a frame build is
 * registered in the project-wide store and referenced from the shot. A containment bug
 * that let one shot compile another shot's package would only be visible against the
 * second shape.
 *
 * The spec is the generation-compiler fixture's, so the C1, C2a and C2b suites are all
 * reasoning about the same shot — a fully directed one, with a duration, a camera move
 * and a spoken line that a still frame cannot carry.
 */
const { registerPromptBuild, promptBuildRef } = require("../public/shared-build-history");
const { baseSpec, FRAME_A, FRAME_B, REF_IDENTITY, REF_LOCATION, REF_PROP, REF_STATE, REF_MOTION, KAI, HANGAR, PARCEL } = require("./generation-compiler-fixture");

/* The prompt-engine reference shape, which is what a stored build actually holds:
   a key, a role, a media type and a project-relative URL. Deliberately NOT the
   compiler's manifest shape — converting between them is part of what is under test. */
function buildRef(reference, url) {
  return {
    key: reference.key,
    token: "",
    label: reference.label,
    role: reference.role,
    instruction: reference.instruction || "",
    mediaType: reference.mediaType,
    entityId: reference.entityId || "",
    continuityState: reference.continuityState || "",
    url,
  };
}

function ensureBrief(project, shotId) {
  const shot = (project.shots || []).find((row) => String(row.id) === String(shotId));
  if (!shot) throw new Error(`fixture: no shot ${shotId}`);
  shot.creationBrief = shot.creationBrief && typeof shot.creationBrief === "object" ? shot.creationBrief : {};
  return shot;
}

/* A BLOCKING build: stored inline on the shot, exactly as buildBlockingPrompt() does. */
function addBlockingPromptBuild(project, shotId, options = {}) {
  const shot = ensureBrief(project, shotId);
  shot.creationBrief.blockingBuilds = Array.isArray(shot.creationBrief.blockingBuilds) ? shot.creationBrief.blockingBuilds : [];
  const build = {
    id: options.id || `blocking-${shotId}-${shot.creationBrief.blockingBuilds.length + 1}`,
    packageId: options.packageId || `${shotId}-BLOCKING-R01`,
    date: "2026-08-09T00:00:00.000Z",
    profileId: options.profileId || "gpt-image-2/blocking",
    profileName: "GPT Image 2 — blocking",
    kind: "blocking-frame",
    /* The legacy prompt-engine text. Distinctive on purpose: a test can ask whether
       this string reached the provider, and the answer must be no. */
    prompt: options.prompt || "LEGACY-BLOCKING-PROMPT-TEXT: this must never reach the provider.",
    spec: options.spec === undefined ? baseSpec({ shotId }) : options.spec,
    references: options.references || [],
    warnings: [],
    confirmations: [],
  };
  shot.creationBrief.blockingBuilds.push(build);
  return build.id;
}

/* A FRAME build: registered in the project-wide store and referenced from the shot,
   exactly as buildGuidedFramePrompt() does. */
function addFramePromptBuild(project, shotId, options = {}) {
  const shot = ensureBrief(project, shotId);
  shot.creationBrief.promptBuilds = Array.isArray(shot.creationBrief.promptBuilds) ? shot.creationBrief.promptBuilds : [];
  const build = {
    id: options.id || `guided-frame-${shotId}-${shot.creationBrief.promptBuilds.length + 1}`,
    packageId: options.packageId || `${shotId}-FRAME-A-R01`,
    date: "2026-08-09T00:00:00.000Z",
    frameId: options.frameId || "FR-A",
    frameLabel: options.frameLabel || "A",
    mode: options.mode || "create",
    profileId: options.profileId || "gpt-image-2/multi-reference",
    profileName: "GPT Image 2 — multi-reference",
    kind: "guided-frame",
    prompt: options.prompt || "LEGACY-FRAME-PROMPT-TEXT: this must never reach the provider.",
    spec: options.spec === undefined ? baseSpec({ shotId }) : options.spec,
    references: options.references || [],
    warnings: [],
    confirmations: [],
  };
  const buildId = registerPromptBuild(project, build);
  shot.creationBrief.promptBuilds.push(promptBuildRef(buildId, { kind: "guided-frame" }));
  return buildId;
}

module.exports = {
  KAI, HANGAR, PARCEL,
  FRAME_A, FRAME_B, REF_IDENTITY, REF_LOCATION, REF_PROP, REF_STATE, REF_MOTION,
  addBlockingPromptBuild,
  addFramePromptBuild,
  baseSpec,
  buildRef,
};

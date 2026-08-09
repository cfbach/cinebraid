/* Shared fixture for the MiniMax H3 execution-wiring suites.
 *
 * A live H3 request is compiled from a DURABLE PROMPT BUILD — the package the prompt
 * engine stores when a filmmaker builds a motion prompt, carrying the provider-neutral
 * spec and the approved references. Every suite that exercises the real dispatch needs
 * one, so minting it lives here rather than being copied four times with four slightly
 * different shapes.
 *
 * The spec is the generation-compiler fixture's, so the C1 suites and the execution
 * suites are reasoning about the same shot.
 */
const { registerPromptBuild, promptBuildRef } = require("../public/shared-build-history");
const { baseSpec, FRAME_A, FRAME_B, REF_IDENTITY, REF_LOCATION, REF_MOTION, REF_VOICE, KAI, HANGAR } = require("./generation-compiler-fixture");

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
    url,
  };
}

const H3_PROFILE_FOR_MODE = {
  t2v: "minimax-h3/t2v",
  i2v: "minimax-h3/i2v",
  flf: "minimax-h3/flf",
  r2v: "minimax-h3/multi-frame",
};

/* Registers a motion prompt build on `shotId` and returns its durable id.
 *
 * `references` are (fixtureReference, url) pairs. `prompt` is what the LEGACY prompt
 * engine would have produced — stored because a real build stores it, and useful
 * precisely because it must NOT be what reaches the provider. */
function addMotionPromptBuild(project, shotId, options = {}) {
  const mode = options.mode || "i2v";
  const shot = (project.shots || []).find((row) => String(row.id) === String(shotId));
  if (!shot) throw new Error(`fixture: no shot ${shotId}`);
  shot.creationBrief = shot.creationBrief && typeof shot.creationBrief === "object" ? shot.creationBrief : {};
  shot.creationBrief.motionPromptBuilds = Array.isArray(shot.creationBrief.motionPromptBuilds)
    ? shot.creationBrief.motionPromptBuilds
    : [];

  const spec = options.spec || baseSpec({ shotId, durationSeconds: options.durationSeconds || 8 });
  if (options.aspectRatio !== undefined) {
    spec.aspectRatio = options.aspectRatio;
    spec.world = { ...(spec.world || {}), aspectRatio: options.aspectRatio };
  }
  const build = {
    id: options.id || `guided-motion-${mode}-${shotId}`,
    packageId: options.packageId || `${shotId}-MOTION-R01`,
    date: "2026-08-08T00:00:00.000Z",
    profileId: options.profileId || H3_PROFILE_FOR_MODE[mode],
    profileName: `MiniMax H3 — ${mode.toUpperCase()}`,
    kind: "guided-motion",
    /* The legacy prompt-engine text. Distinctive on purpose: a test can ask whether
       this string reached the provider, and the answer must be no. */
    prompt: options.prompt || "LEGACY-PROMPT-ENGINE-TEXT: this must never reach the provider.",
    spec,
    references: options.references || [],
    durationSeconds: options.durationSeconds || 8,
    warnings: [],
    confirmations: [],
  };
  const buildId = registerPromptBuild(project, build);
  shot.creationBrief.motionPromptBuilds.push(promptBuildRef(buildId, { kind: "guided-motion" }));
  return buildId;
}

module.exports = {
  H3_PROFILE_FOR_MODE,
  KAI,
  HANGAR,
  FRAME_A,
  FRAME_B,
  REF_IDENTITY,
  REF_LOCATION,
  REF_MOTION,
  REF_VOICE,
  addMotionPromptBuild,
  baseSpec,
  buildRef,
};

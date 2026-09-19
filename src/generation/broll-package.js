/* B-ROLL / STYLE-ONLY PACKAGES.
 *
 * A B-roll shot is generated from two things: the project's established look and the
 * shot's own written prompt. No reference image, no identity reference and no
 * continuity state travels with it, so the package this module compiles carries none —
 * and says so, in `referenceMode: "style-only"`, which the image and motion execution
 * modules enforce and the job ledger records.
 *
 * WHO DECIDES WHAT, in this order:
 *   1. the shot's written prompt decides which subjects, objects and actions are present;
 *   2. the project and scene LOOK decide the visual treatment, and nothing else;
 *   3. project continuity and identity language never adds anything the prompt did not
 *      ask for — B-roll means no reference input, not that the project's cast may walk in.
 *
 * WHAT IS KEPT. The Look — the global style and the scene's own style blocks — framed as
 * treatment only; the scene's feeling, as the Look's tone; the shot's composition and
 * camera direction, its motion plan and its duration; and the generic exclusions every
 * shot carries. Read through the same buildContext() and defaultSpec() as every shot.
 *
 * WHAT IS REMOVED, and only this. The entity descriptors, the entities' canon text and
 * the frame's presence declarations: the inputs that make a prompt reference-led. The
 * scene beat, because it is written about the cast and would re-introduce them by name;
 * the shot's own prompt is the intent here. Dialogue — a style-only package has no
 * speaker to voice. And the project WORLD: its premise and its exclusions exist to keep
 * named production entities consistent ("no redesign of Rex or the folding chair…"),
 * so in a reference-free package they did the opposite — they named the cast into an
 * empty shot, and a real MiniMax H3 B-roll of an empty swamp came back with an armored
 * figure and a chair (GENERATION_INTEGRATION_PROOF_V1, D3). Decided by SOURCE, never by
 * reading the text for names.
 *
 * The package is an ordinary prompt build. It compiles through the ordinary GenerationPlan
 * path (image-execution.js / h3-execution.js) as text-to-image or text-to-video, and its
 * results land as ordinary shot candidates. Nothing here is a second media system.
 *
 * NO LLM. NO NETWORK. Deterministic, like every compiler it feeds. */

const PromptEngine = require("./prompt-engine");

const STYLE_ONLY = "style-only";
/* One target per output. Both are prompt-only modes, and they are the only ones a
   style-only package may be built for: every other image or video mode needs an image
   or reference input, which B-roll by definition does not have. */
const BROLL_PROFILE_IDS = Object.freeze({ image: "gpt-image-2/t2i", video: "minimax-h3/t2v" });
const BROLL_PROMPT_ONLY_MODES = Object.freeze({ image: "t2i", video: "t2v" });
/* Leads the Look in every B-roll package: treatment only, and the shot's own content —
   including an empty scene — outranks anything the style text happens to mention. */
const BROLL_LOOK_AUTHORITY = "Treatment only: the look below changes how this shot is rendered, never what is in it. "
  + "The shot prompt alone decides which people, creatures, objects, vehicles and actions appear; "
  + "if it asks for an empty scene or for no one to be present, keep it empty. "
  + "Any figure, object or motif named in the look is an example of the style, not content to add.";
const MODE_WORDS = Object.freeze({
  t2i: "text-to-image", t2v: "text-to-video", edit: "Image editing", inpaint: "Inpainting",
  "multi-reference": "Multi-reference image generation", i2v: "Image-to-video",
  flf: "First-and-last-frame video", r2v: "Reference-to-video",
});

class BrollPackageError extends Error {
  constructor(code, message, detail = {}, status = 400) {
    super(message);
    this.name = "BrollPackageError";
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

/* The shot's written B-roll prompt, or its description where none has been written. */
function brollPromptFor(shot) {
  const brief = isRecord(shot?.creationBrief) ? shot.creationBrief : {};
  return text(brief.brollPrompt) || text(shot?.desc);
}

function styleOnlyContext(project, shotId, prompt) {
  const context = PromptEngine.buildContext(project, shotId);
  return {
    ...context,
    promptEntities: [],
    references: [],
    framePresence: { frameId: "", declarations: [], absent: [], withheldNarrative: [] },
    /* No world: its setting would become this shot's environment and its reject list its
       exclusions, both written to keep the production's entities consistent. The Look
       (project.styleBlocks) is untouched. */
    project: { ...context.project, world: {} },
    scene: { ...context.scene, beat: "" },
    shot: {
      ...context.shot,
      description: prompt,
      /* The authored reference-led motion direction is not this package's direction;
         the B-roll prompt is. It still reaches a video as its action, and the shot's
         motion plan (camera, timing) still applies below. */
      motionDirection: "",
      audio: {
        line: "", dialogue: "", speakerId: "", speakerName: "", note: "", legacyVo: "",
        voiceEntityId: "", voiceEntityName: "", voiceRelationship: "", cleanMaster: false,
        voiceDesign: "", sfx: "", clipDialogue: [],
      },
    },
  };
}

function compileBrollPackage(request = {}) {
  const project = isRecord(request.project) ? request.project : null;
  if (!project) throw new BrollPackageError("BROLL_PROJECT_MISSING", "No project was supplied.", {}, 500);
  const output = text(request.output);
  if (!Object.hasOwn(BROLL_PROFILE_IDS, output))
    throw new BrollPackageError("BROLL_OUTPUT_UNKNOWN", "Choose Image or Video for this B-roll shot.", { output });
  const shot = (Array.isArray(project.shots) ? project.shots : []).find((row) => text(row?.id) === text(request.shotId));
  if (!shot) throw new BrollPackageError("BROLL_SHOT_NOT_FOUND", "That shot no longer exists in this project.", { shotId: request.shotId }, 404);
  const prompt = text(request.prompt) || brollPromptFor(shot);
  if (!prompt) throw new BrollPackageError("BROLL_PROMPT_MISSING", "Write this shot's prompt before generating B-roll.", { shotId: shot.id });

  const getProfile = typeof request.getProfile === "function" ? request.getProfile : PromptEngine.getProfile;
  const profile = getProfile(BROLL_PROFILE_IDS[output]);
  if (!profile || profile.mode !== BROLL_PROMPT_ONLY_MODES[output])
    throw new BrollPackageError("BROLL_TARGET_UNAVAILABLE", `No prompt-only ${output} target is available in this build.`, { output });

  const purpose = output === "video" ? "motion" : "shot-still";
  const context = styleOnlyContext(project, shot.id, prompt);
  let spec = PromptEngine.defaultSpec(context, purpose, profile.mode, [], null);
  spec = PromptEngine.applyStructuredDirection(spec, context.shot.composition, output === "video" ? context.shot.motionPlan : null, []);
  /* ONE PROMPT, STATED ONCE. defaultSpec() writes the shot's description into the
     narrative purpose, the subject AND the action, because for a reference-led shot those
     are three different authored texts. Here they are all the same written prompt, and
     the compilers would print it two or three times. So it is written into the one field
     both the prompt engine and the model pack read for this output: the SUBJECT of a
     still (which has no action timeline), and the ACTION of a clip. */
  spec.narrativePurpose = "";
  if (output === "video") spec.initialState = { ...spec.initialState, subject: "" };
  else {
    spec.initialState = { ...spec.initialState, subject: prompt };
    spec.actions = [];
  }
  /* THE LOOK RENDERS; THE SHOT DECIDES. The Look is carried whole, led by one sentence
     that says what it is for, because a style block written for a scene with a cast
     ("simplified armor … walk cycles") reads to a video model as a request for one. The
     scene's feeling moves from performance direction, which presumes a performer, to the
     Look's tone. Nothing is parsed out of any of this text. */
  const tone = text(spec.performance?.emotion);
  spec.performance = { ...spec.performance, emotion: "" };
  spec.visualStyle = [BROLL_LOOK_AUTHORITY, ...(Array.isArray(spec.visualStyle) ? spec.visualStyle : []), tone ? `Tone: ${tone}` : ""]
    .filter(Boolean);
  spec.referenceMode = STYLE_ONLY;
  const built = PromptEngine.compile(profile, spec, []);
  return {
    referenceMode: STYLE_ONLY,
    output,
    prompt,
    profile: { id: profile.id, name: profile.name, mode: profile.mode, family: profile.family, profileVersion: profile.profileVersion || "" },
    spec,
    compiledPrompt: built.prompt,
    durationSeconds: output === "video" ? Number(spec.durationSeconds) || null : null,
    warnings: built.warnings || [],
  };
}

/* THE GATE BOTH EXECUTION MODULES ASK. A package that says it is style-only must be
   prompt-only in fact: no reference of any kind, and a mode that needs none. Anything
   else is refused before compilation, so a style-only request can never be sent with a
   reference silently attached or a dummy one invented to satisfy a mode. */
function styleOnlyRefusal(build, mode, references, output) {
  if (text(build?.referenceMode) !== STYLE_ONLY) return null;
  const expected = BROLL_PROMPT_ONLY_MODES[output];
  if (mode !== expected)
    return {
      code: "BROLL_MODE_NEEDS_INPUT",
      message: `${output === "video" ? "B-roll video is" : "B-roll images are"} made from the prompt alone. ${MODE_WORDS[mode] || "This method"} needs an image or reference input, so it cannot run for a B-roll shot; use ${MODE_WORDS[expected]}. Nothing was sent and nothing was charged.`,
      detail: { mode, expected },
    };
  if (Array.isArray(references) && references.length)
    return {
      code: "BROLL_REFERENCES_REFUSED",
      message: "This B-roll package carries a reference, and a B-roll request never sends one. Build the B-roll prompt again. Nothing was sent and nothing was charged.",
      detail: { references: references.length },
    };
  return null;
}

module.exports = {
  STYLE_ONLY,
  BROLL_LOOK_AUTHORITY,
  BROLL_PROFILE_IDS,
  BROLL_PROMPT_ONLY_MODES,
  BrollPackageError,
  brollPromptFor,
  compileBrollPackage,
  styleOnlyContext,
  styleOnlyRefusal,
};

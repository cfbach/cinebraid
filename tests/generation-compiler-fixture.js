/* Shared production fixture for the generation-compiler suites.
 *
 * One shot, fully directed: action, secondary beats, staging, framing, camera move with
 * timing and lens intent, performance, locked dialogue with delivery and timing, sound,
 * a required ending state, continuity locks, identity canon, style and a production
 * risk. Everything a compiler could drop is present, so a suite can ask whether it did.
 *
 * Entity identifiers are deliberately UUID-shaped. A compiler that leaks one has to
 * leak something a test can see.
 */
const { resolveCapability } = require("../public/shared-generation-capability");
const H3 = require("../model-packs/minimax-h3");

const KAI = "CHAR-KAI-8f21c4d6";
const HANGAR = "LOC-HANGAR-2b9e77";
const PARCEL = "PROP-PARCEL-77aa3c";

function baseSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    purpose: "motion",
    shotId: "SH-03-02",
    durationSeconds: 8,
    narrativePurpose: "Kai leaves the parcel and walks out.",
    initialState: {
      subject: "Kai stands inside the east door holding a sealed parcel.",
      staging: "",
      camera: "",
      environment: "Hangar 4 at night: corrugated walls, one sodium lamp, a chalk line across the floor.",
    },
    finalState: { subject: "standing one pace back from the parcel, facing the east door", staging: "", camera: "", environment: "" },
    actions: [{ start: 0, end: 8, action: "Kai crosses the chalk line and lowers the parcel to the floor with both hands." }],
    camera: {
      framing: "medium-wide framing",
      movement: "slow dolly push-in",
      stability: "smooth",
      lensIntent: "focus stays on the parcel",
      timing: "begins at 1.0s and settles by 6.0s",
    },
    performance: {
      emotion: "controlled dread",
      facial: "jaw set, eyes down",
      bodyLanguage: "shoulders squared, deliberate steps",
      gaze: "from the parcel to the east door",
      movementIntensity: "restrained and readable",
    },
    environmentMotion: ["the sodium lamp flickers once after he steps back"],
    stagingLines: ["Kai enters camera-left and crosses to centre frame."],
    mustPreserve: ["hangar geometry, chalk line position and parcel design"],
    mustAvoid: ["no new gestures, no object morphing"],
    identityCanon: ["Kai: olive flight jacket with a torn left cuff, steel-toed boots."],
    driftRestatements: ["Kai: do not lengthen the hair or clean up the torn cuff."],
    visualGrounding: [],
    promptEntities: [{ id: KAI, name: "Kai", type: "character", descriptor: "Kai" }],
    productionRisks: ["identity drift on the torn cuff"],
    promptWarnings: [],
    audio: {
      dialogue: "It's done.",
      speakerId: KAI,
      speakerName: "Kai",
      voiceDesign: "Low, dry, slight rasp; never theatrical.",
      delivery: "quiet, almost swallowed",
      startTime: "5.2s",
      endTime: "6.4s",
      mode: "generate-voice",
      sfx: "4.6s: parcel settling on concrete",
      ambience: "distant surf, hangar hum",
      music: "a single sustained low string under the last two seconds",
      silence: "leave 0.4s of near-silence after the line",
      priorities: "dialogue first",
    },
    references: [],
    visualStyle: ["Anamorphic night photography, practical sodium sources, restrained grade."],
    blockingEntities: [],
    world: { setting: "A decommissioned cargo hangar.", aspectRatio: "16:9" },
    aspectRatio: "16:9",
    ...overrides,
  };
}

const FRAME_A = { key: "kf-a", label: "Approved opening frame", mediaType: "image", role: "first-frame", url: "/assets/shots/SH-03-02/A.png" };
const FRAME_B = { key: "kf-b", label: "Approved ending frame", mediaType: "image", role: "last-frame", url: "/assets/shots/SH-03-02/B.png" };
const REF_IDENTITY = { key: "id-kai", label: "Kai — approved identity", mediaType: "image", role: "identity", entityId: KAI, url: "/assets/entities/kai.png" };
const REF_STATE = { key: "st-kai", label: "Kai — jacket torn", mediaType: "image", role: "continuity-state", entityId: KAI, continuityState: "jacket torn", url: "/assets/entities/kai-torn.png" };
const REF_LOCATION = { key: "loc-hangar", label: "Hangar 4 — approved night state", mediaType: "image", role: "location", entityId: HANGAR, url: "/assets/entities/hangar.png" };
const REF_PROP = { key: "pr-parcel", label: "Sealed parcel — open state", mediaType: "image", role: "prop", entityId: PARCEL, url: "/assets/entities/parcel.png" };
const REF_MOTION = { key: "mo-track", label: "tracking-reference-02.mp4", mediaType: "video", role: "motion-reference", url: "/assets/motion/track02.mp4" };
const REF_VOICE = { key: "vo-kai", label: "Kai voice", mediaType: "audio", role: "voice", url: "/assets/voice/kai.wav" };

function modelIdFor(mode) {
  return mode === "r2v" ? "minimax-h3/ref2va" : "minimax-h3/fl2va";
}
function capabilityFor(mode, surface = "api", extraLayers = {}) {
  return resolveCapability({ model: H3.capabilityLayer(mode, surface), ...extraLayers });
}
/* A capability identical to H3's except that it accepts a seed. The generic
   reproducibility path is proven against this rather than by broadening a provider or
   by claiming H3 supports something MiniMax does not document. */
function seedCapableCapability(mode = "t2v") {
  const layer = H3.capabilityLayer(mode, "api");
  return resolveCapability({ model: { ...layer, flags: { ...layer.flags, seed: true } } });
}

/* Semantic readers. `covered` is the question every assertion is really asking: did this
   intent end somewhere, and where. */
function covered(plan, intent) {
  return plan.coverage.find((row) => row.intent === intent) || null;
}
function state(plan, intent) {
  const row = covered(plan, intent);
  return row ? row.state : "MISSING";
}
function warnedAbout(plan, pattern) {
  return plan.warnings.some((row) => pattern.test(`${row.code} ${row.message}`));
}
function carries(plan, fragment) {
  return plan.inputs.prompt.toLowerCase().includes(String(fragment).toLowerCase());
}

module.exports = {
  KAI, HANGAR, PARCEL,
  FRAME_A, FRAME_B, REF_IDENTITY, REF_STATE, REF_LOCATION, REF_PROP, REF_MOTION, REF_VOICE,
  baseSpec, capabilityFor, seedCapableCapability, modelIdFor,
  carries, covered, state, warnedAbout,
};

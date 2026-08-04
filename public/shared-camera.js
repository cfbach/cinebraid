/* Shared camera-control vocabulary for the browser composer and Node prompt compiler. */
const CINEBRAID_CAMERA_OPTIONS = Object.freeze({
  shotSize: Object.freeze([
    ["extreme-wide", "Extreme wide"],
    ["wide", "Wide"],
    ["medium-wide", "Medium wide"],
    ["medium", "Medium"],
    ["medium-close", "Medium close"],
    ["close-up", "Close-up"],
    ["extreme-close", "Extreme close-up"],
  ]),
  height: Object.freeze([
    ["ground-level", "Ground level"],
    ["low", "Low"],
    ["eye-level", "Eye level"],
    ["high", "High"],
    ["overhead", "Overhead"],
  ]),
  angle: Object.freeze([
    ["level", "Level"],
    ["low-angle", "Low angle"],
    ["high-angle", "High angle"],
    ["dutch-left", "Dutch left"],
    ["dutch-right", "Dutch right"],
  ]),
  lens: Object.freeze([
    ["ultra-wide", "Ultra wide"],
    ["wide", "Wide"],
    ["normal", "Normal"],
    ["telephoto", "Telephoto"],
  ]),
  view: Object.freeze([
    ["front", "Front"],
    ["three-quarter-left", "3/4 left"],
    ["three-quarter-right", "3/4 right"],
    ["profile-left", "Profile left"],
    ["profile-right", "Profile right"],
    ["rear", "Rear"],
    ["over-the-shoulder", "Over shoulder"],
  ]),
  layout: Object.freeze([
    ["rule-of-thirds", "Rule of thirds"],
    ["centered", "Centered"],
    ["symmetrical", "Symmetrical"],
    ["negative-left", "Negative space left"],
    ["negative-right", "Negative space right"],
    ["foreground-frame", "Foreground framing"],
  ]),
  crop: Object.freeze([
    ["full-scene", "Full scene"],
    ["full-body", "Full body"],
    ["knees-up", "Knees up"],
    ["waist-up", "Waist up"],
    ["bust", "Bust"],
    ["detail", "Detail insert"],
  ]),
  reframe: Object.freeze([
    ["preserve-exact", "Preserve exactly"],
    ["preserve-loosely", "Preserve loosely"],
    ["reinterpret", "Reinterpret"],
  ]),
});

const CINEBRAID_CAMERA_PHRASES = Object.freeze({
  shotSize: Object.freeze({
    "extreme-wide": "Extreme-wide shot",
    wide: "Wide shot",
    "medium-wide": "Medium-wide shot",
    medium: "Medium shot",
    "medium-close": "Medium close-up",
    "close-up": "Close-up",
    "extreme-close": "Extreme close-up",
  }),
  height: Object.freeze({
    "ground-level": "from ground level",
    low: "from a low camera height",
    "eye-level": "at the subject's eye line",
    high: "from a high camera position",
    overhead: "from directly overhead",
  }),
  angle: Object.freeze({
    level: "with no vertical tilt",
    "low-angle": "at a low angle",
    "high-angle": "at a high angle",
    "dutch-left": "with a left-leaning Dutch angle",
    "dutch-right": "with a right-leaning Dutch angle",
  }),
  view: Object.freeze({
    front: "front-facing view",
    "three-quarter-left": "three-quarter view from the left",
    "three-quarter-right": "three-quarter view from the right",
    "profile-left": "left-facing profile view",
    "profile-right": "right-facing profile view",
    rear: "rear view",
    "over-the-shoulder": "over-the-shoulder view",
  }),
  layout: Object.freeze({
    "rule-of-thirds": "Use a rule-of-thirds composition.",
    centered: "Center the primary subject.",
    symmetrical: "Use a symmetrical composition.",
    "negative-left": "Leave deliberate negative space at frame left.",
    "negative-right": "Leave deliberate negative space at frame right.",
    "foreground-frame": "Use a foreground element to frame the composition.",
  }),
  crop: Object.freeze({
    "full-scene": "Keep the full scene in frame.",
    "full-body": "Frame the primary subject full-body.",
    "knees-up": "Frame the primary subject from the knees up.",
    "waist-up": "Frame the primary subject waist-up.",
    bust: "Frame the primary subject as a bust portrait.",
    detail: "Use a tight detail insert.",
  }),
  lens: Object.freeze({
    "ultra-wide": "Use an ultra-wide lens.",
    wide: "Use a wide lens.",
    normal: "Use a normal lens.",
    telephoto: "Use a telephoto lens.",
  }),
});

function cameraControlOptions(key) {
  return (CINEBRAID_CAMERA_OPTIONS[key] || []).map((pair) => pair.slice());
}

function cameraControlLabel(value) {
  return String(value || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cameraPhrase(group, value) {
  const key = String(value || "").trim();
  if (!key) return "";
  const mapped = CINEBRAID_CAMERA_PHRASES[group]?.[key];
  if (mapped) return mapped;
  const label = cameraControlLabel(key).toLowerCase();
  if (!label) return "";
  if (group === "shotSize") return `${cameraControlLabel(key)} shot`;
  if (group === "height") return `from a ${label} camera height`;
  if (group === "angle") return `with a ${label} camera angle`;
  if (group === "view") return `${label} view`;
  if (group === "layout") return `Use a ${label} composition.`;
  if (group === "crop") return `Frame for ${label}.`;
  if (group === "lens") return `Use a ${label} lens.`;
  return cameraControlLabel(key);
}

function buildCameraPhrases(camera = {}) {
  const primary = [
    cameraPhrase("shotSize", camera.shotSize),
    cameraPhrase("height", camera.height),
    cameraPhrase("angle", camera.angle),
    cameraPhrase("view", camera.view),
  ].filter(Boolean);
  const sentences = [];
  if (primary.length) sentences.push(`${primary.join(", ")}.`);
  const layout = cameraPhrase("layout", camera.layout);
  const crop = cameraPhrase("crop", camera.crop);
  if (layout) sentences.push(layout);
  if (crop) sentences.push(crop);
  return {
    framing: sentences.join(" "),
    lensIntent: cameraPhrase("lens", camera.lens),
  };
}

if (typeof window !== "undefined") {
  window.CINEBRAID_CAMERA_OPTIONS = CINEBRAID_CAMERA_OPTIONS;
  window.cameraControlOptions = cameraControlOptions;
  window.cameraControlLabel = cameraControlLabel;
  window.buildCameraPhrases = buildCameraPhrases;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CINEBRAID_CAMERA_OPTIONS,
    cameraControlOptions,
    cameraControlLabel,
    buildCameraPhrases,
  };
}

const fs = require("fs");
const path = require("path");
const { resolveShotEntities, entityVisualDescription, resolveShotDuration } = require("./public/shared-entities");
const { buildCameraPhrases } = require("./public/shared-camera");
const { deriveLipSync, lipSyncRequiredFrom } = require("./public/shared-lip-sync");
/* One parser for the whole product. It lives in the shared module so the browser can use
   the same rule the prompt compiler does; this re-export keeps the Node API unchanged. */
const { parseAspectRatio } = require("./public/shared-aspect");
/* Frame-specific presence. The compiler is where whole-shot membership stopped
   overriding a frame's declared absence — see resolveFramePresenceContext. */
const FramePresence = require("./public/shared-frame-presence");

const PROFILE_FILE = path.join(__dirname, "data", "model-profiles.json");

const IMAGE_PURPOSE_LABELS = Object.freeze({
  "first-frame": "opening frame",
  "last-frame": "ending frame",
  "shot-still": "shot still",
  edit: "edited production frame",
  "reference-sheet": "production reference sheet",
  "continuity-fix": "continuity-corrected frame",
  blocking: "blocking frame",
});
const SUPPORTED_PROMPT_PURPOSES = Object.freeze([...Object.keys(IMAGE_PURPOSE_LABELS), "motion"]);

function profileLibrary() {
  const data = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8"));
  return data;
}

function getProfile(id) {
  return profileLibrary().profiles.find((p) => p.id === id) || null;
}

function cleanText(v) {
  return String(v || "").trim();
}
function sentence(v) {
  const t = cleanText(v);
  return t && !/[.!?]$/.test(t) ? t + "." : t;
}
function clause(v) {
  return cleanText(v).replace(/[.!?,;:]+$/g, "");
}
function unique(xs) {
  return [...new Set(xs.filter(Boolean))];
}
function isoNow() {
  return new Date().toISOString();
}
function compactCanon(value, maxWords = 42) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (!text) return "";
  const words = text.split(" ");
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ").replace(/[,;:]?$/, "") + "…";
}

function escapeRegExp(value) {
  return cleanText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function characterPromptDescriptor(ref) {
  const names = unique([cleanText(ref?.name), cleanText(ref?.id)]).sort((a, b) => b.length - a.length);
  let text = compactCanon(ref?.canon || ref?.notes || "", 30);
  for (const name of names) {
    if (!name) continue;
    text = text.replace(new RegExp(`\\b${escapeRegExp(name)}(?:[’\']s)?\\b`, "gi"), " ");
  }
  text = text
    .replace(/^\s*(?:is|—|-|:|,)+\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^an?\s+/i, "")
    .trim();
  if (!text) return "the character assigned to this shot";
  return `the ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function blockingPlaceholder(ref, inline = false) {
  const id = cleanText(ref?.id || ref?.name || "ELEMENT");
  const note = cleanText(ref?.blockingNote);
  if (ref?.type === "character") return note || `a simple figure labelled "${id}"`;
  if (ref?.type === "location") return inline ? cleanText(ref?.name || id) : note || `${cleanText(ref?.name || id)} as the surrounding environment`;
  return note || `${cleanText(ref?.name || "prop")} labelled "${id}"`;
}
function sanitizeBlockingText(value, refs = []) {
  let text = cleanText(value).replace(/\s+/g, " ");
  if (!text) return "";
  const replacements = [];
  const ordered = [...refs].sort((a, b) => Math.max(cleanText(b.name).length, cleanText(b.id).length) - Math.max(cleanText(a.name).length, cleanText(a.id).length));
  for (const ref of ordered) {
    const tokens = unique([cleanText(ref.name), cleanText(ref.id)])
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (!tokens.length) continue;
    const marker = `__CB_BLOCK_${replacements.length}__`;
    const pattern = tokens
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    text = text.replace(new RegExp(`\\b(?:${pattern})\\b`, "gi"), marker);
    replacements.push([marker, blockingPlaceholder(ref, true)]);
  }
  for (const [marker, replacement] of replacements)
    text = text.split(marker).join(replacement);
  text = text
    .replace(/\b(?:wearing|dressed in|clad in|costumed in)\b[^,.;]*/gi, "")
    .replace(/\b(?:photorealistic|cinematic realism|cinematic|film grain|grainy|high[- ]contrast|colour grade|color grade|texture detail|material detail|dramatic lighting|found[- ]footage|retro[- ]?futuristic|1970s[- ]industrial|riveted|weathered|worn|pristine|intact)\b/gi, "")
    .replace(/\b(?:slight )?lens distortion\b/gi, "")
    .replace(/\b(?:corner )?timestamp\b/gi, "")
    .replace(/\b(?:visual|exterior|camera) grammar\b/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/,{2,}/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[,;:-]+|\s*[,;:-]+$/g, "")
    .trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean).filter((part) =>
    !/\b(?:audio|sound|sfx|music|score|voice[- ]?over|dialogue|lip[- ]?sync|audio post|post layer|motif seeded)\b/i.test(part) &&
    !/\b(?:bookend dependency|mirrored at the end|derives from it|continuity note|approval note)\b/i.test(part) &&
    !/\bEstablishes\b.*\bthe\s*[.!?]?$/i.test(part),
  );
  return sentences.join(" ")
    .replace(/\.\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/,{2,}/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[,;:-]+|\s*[,;:-]+$/g, "")
    .trim();
}
function blockingEntityForKey(spec, key, fallback = "") {
  const entities = spec.blockingEntities || [];
  const value = cleanText(key);
  const byId = entities.find((item) => value.includes(`:${item.id}:`) || value.endsWith(`:${item.id}`) || value === item.id);
  if (byId) return byId;
  const label = cleanText(fallback).toLowerCase();
  return entities.find((item) => label === cleanText(item.name).toLowerCase() || label.includes(cleanText(item.id).toLowerCase())) || null;
}

const BLOCKING_EMPHASIS_VALUES = new Set(["auto", "full-scene", "balanced", "action-insert"]);
const BLOCKING_CAMERA_KEYS = {
  shotSize: new Set(["extreme-wide", "wide", "medium-wide", "medium", "medium-close", "close-up", "extreme-close"]),
  height: new Set(["ground-level", "low", "eye-level", "high", "overhead"]),
  angle: new Set(["level", "low-angle", "high-angle", "dutch-left", "dutch-right"]),
  lens: new Set(["ultra-wide", "wide", "normal", "telephoto"]),
  view: new Set(["front", "three-quarter-left", "three-quarter-right", "profile-left", "profile-right", "rear", "over-the-shoulder"]),
  layout: new Set(["rule-of-thirds", "centered", "symmetrical", "negative-left", "negative-right", "foreground-frame"]),
  crop: new Set(["full-scene", "full-body", "knees-up", "waist-up", "bust", "detail"]),
};
function normalizeBlockingEmphasis(value) {
  const key = cleanText(value).toLowerCase().replace(/\s+/g, "-");
  return BLOCKING_EMPHASIS_VALUES.has(key) ? key : "auto";
}
function blockingText(context, options = {}) {
  return [
    cleanText(options.frameBrief),
    cleanText(options.direction),
    cleanText(context?.shot?.positioning),
    cleanText(context?.shot?.description),
    cleanText(context?.scene?.beat),
    cleanText(context?.shot?.title),
  ].filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
}
function inferBlockingEmphasis(value, requested = "auto") {
  const explicit = normalizeBlockingEmphasis(requested);
  if (explicit !== "auto") return explicit;
  const text = cleanText(value);
  if (/\b(?:tight(?:ly)?\s+(?:on|framed)|close[- ]?up|close\s+on|extreme\s+close|ecu\b|insert\b|detail\s+(?:shot|insert)|macro\b)\b/i.test(text))
    return "action-insert";
  if (/\b(?:crush(?:es|ed|ing)?|roll(?:s|ed|ing)?\s+(?:over|onto)|revers(?:es|ed|ing)?\s+onto|press(?:es|ed|ing)?\s+(?:against|onto)|impact(?:s|ed|ing)?|contact\s+point|grabs?|strikes?|cuts?|pierces?)\b/i.test(text) && !/\b(?:establishing|extreme\s+wide|wide\s+establishing)\b/i.test(text))
    return "action-insert";
  if (/\b(?:establishing|extreme\s+wide|wide\s+establishing|full\s+scene|entire\s+(?:room|street|location|landscape))\b/i.test(text))
    return "full-scene";
  return "balanced";
}
function firstContactRelationship(value) {
  const text = cleanText(value).replace(/\s+/g, " ");
  const patterns = [
    /(?:tight(?:ly)?\s+on\s+|close\s+on\s+|insert\s+of\s+)?(.{2,80}?)\s+(revers(?:es|ed|ing)?\s+onto|roll(?:s|ed|ing)?\s+(?:onto|over)|crush(?:es|ed|ing)?|press(?:es|ed|ing)?\s+(?:onto|against)|strik(?:es|ing)|hits?|grabs?|cuts?|pierces?)\s+(.{2,80}?)(?:[.!?]|$)/i,
    /(.{2,80}?)\s+(?:makes?|at)\s+(?:physical\s+)?contact\s+with\s+(.{2,80}?)(?:[.!?]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (match.length === 4) return { subject: clause(match[1]), action: clause(match[2]), target: clause(match[3]) };
    return { subject: clause(match[1]), action: "makes physical contact with", target: clause(match[2]) };
  }
  return null;
}
function cleanBlockingAction(value, refs = []) {
  return sanitizeBlockingText(value, refs)
    .replace(/\b(?:skulls?)\s+CRUNCH\b/gi, "the skull visibly compresses at the contact point")
    .replace(/\s+/g, " ")
    .trim();
}
function blockingCameraFromText(value, emphasis, current = {}) {
  const text = cleanText(value);
  const camera = { ...(current || {}) };
  if (emphasis === "action-insert") {
    camera.shotSize = /\b(?:extreme\s+close|ecu\b|macro\b)\b/i.test(text) ? "extreme-close" : "close-up";
    camera.crop = "detail";
    camera.layout = /\b(?:left|right)\s+(?:third|side)\b/i.test(text) ? camera.layout || "rule-of-thirds" : "centered";
    camera.lens = /\btelephoto\b/i.test(text) ? "telephoto" : "normal";
  } else if (emphasis === "full-scene") {
    camera.shotSize = /\bextreme\s+wide\b/i.test(text) ? "extreme-wide" : "wide";
    camera.crop = "full-scene";
  } else {
    if (/\bmedium\s+close\b/i.test(text)) camera.shotSize = "medium-close";
    else if (/\bmedium\b/i.test(text) && (!camera.shotSize || ["wide", "extreme-wide"].includes(camera.shotSize))) camera.shotSize = "medium";
  }
  if (/\b(?:ground[- ]level|at\s+ground\s+level|tire|tyre|wheel|feet|floor)\b/i.test(text) && emphasis === "action-insert") camera.height = "ground-level";
  else if (/\b(?:low\s+camera|camera\s+low|low[- ]angle|medium\s+low)\b/i.test(text)) camera.height = "low";
  if (/\boverhead\b/i.test(text)) { camera.height = "overhead"; camera.angle = "high-angle"; }
  else if (/\blow[- ]angle\b/i.test(text)) camera.angle = "low-angle";
  else if (/\bhigh[- ]angle\b/i.test(text)) camera.angle = "high-angle";
  if (/\bthree[- ]quarter\s+(?:from\s+the\s+)?left\b/i.test(text)) camera.view = "three-quarter-left";
  else if (/\bthree[- ]quarter\s+(?:from\s+the\s+)?right\b/i.test(text)) camera.view = "three-quarter-right";
  else if (/\bprofile\s+left\b/i.test(text)) camera.view = "profile-left";
  else if (/\bprofile\s+right\b/i.test(text)) camera.view = "profile-right";
  return camera;
}
function normalizeBlockingPlan(raw, fallback = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const emphasis = normalizeBlockingEmphasis(source.emphasis || base.emphasis || "auto");
  const cameraSource = source.camera && typeof source.camera === "object" ? source.camera : {};
  const baseCamera = base.camera && typeof base.camera === "object" ? base.camera : {};
  const camera = {};
  for (const [key, allowed] of Object.entries(BLOCKING_CAMERA_KEYS)) {
    const value = cleanText(cameraSource[key] || baseCamera[key]);
    if (allowed.has(value)) camera[key] = value;
  }
  const environmentEmphasis = ["minimal", "supporting", "full"].includes(source.environmentEmphasis)
    ? source.environmentEmphasis
    : ["minimal", "supporting", "full"].includes(base.environmentEmphasis)
      ? base.environmentEmphasis
      : emphasis === "action-insert" ? "minimal" : emphasis === "full-scene" ? "full" : "supporting";
  return {
    emphasis,
    camera,
    environmentEmphasis,
    primaryAction: cleanText(source.primaryAction || base.primaryAction),
    layoutLines: unique((Array.isArray(source.layoutLines) ? source.layoutLines : Array.isArray(base.layoutLines) ? base.layoutLines : []).map((item) => cleanText(item)).filter(Boolean)).slice(0, 8),
    conflictsResolved: unique((Array.isArray(source.conflictsResolved) ? source.conflictsResolved : Array.isArray(base.conflictsResolved) ? base.conflictsResolved : []).map((item) => cleanText(item)).filter(Boolean)).slice(0, 8),
    source: cleanText(source.source || base.source || "deterministic"),
  };
}
function buildBlockingPlan(context, composition, options = {}) {
  const text = blockingText(context, options);
  const emphasis = inferBlockingEmphasis(text, options.emphasis);
  const currentCamera = composition?.camera && typeof composition.camera === "object" ? composition.camera : {};
  const camera = blockingCameraFromText(text, emphasis, currentCamera);
  const refs = context?.references || [];
  const action = cleanBlockingAction(options.frameBrief || context?.shot?.description || context?.scene?.beat || context?.shot?.title, refs);
  const direction = cleanBlockingAction(options.direction, refs);
  const combined = [action, direction].filter(Boolean).join(" ");
  const relationship = firstContactRelationship([options.frameBrief, context?.shot?.description, options.direction].filter(Boolean).join(". "));
  const layoutLines = [];
  const conflictsResolved = [];
  if (emphasis === "action-insert") {
    if (relationship) {
      const subjectLabel = clause(relationship.subject).replace(/^./, (letter) => letter.toUpperCase());
      const targetLabel = clause(relationship.target).replace(/^./, (letter) => letter.toUpperCase());
      const subjectPlural = /s$/i.test(subjectLabel) && !/ss$/i.test(subjectLabel);
      const targetPlural = /s$/i.test(targetLabel) && !/ss$/i.test(targetLabel);
      layoutLines.push(`${subjectLabel} ${subjectPlural ? "dominate" : "dominates"} the foreground and ${subjectPlural ? "occupy" : "occupies"} most of the frame.`);
      layoutLines.push(`${targetLabel} ${targetPlural ? "are" : "is"} positioned directly at the physical contact point with ${clause(relationship.subject)}.`);
      layoutLines.push(`The physical action of ${clause(relationship.subject)} ${clause(relationship.action)} ${clause(relationship.target)} is the single visual focus.`);
    } else {
      layoutLines.push("The primary action and its physical contact point dominate the foreground in a tight crop.");
    }
    if (combined) layoutLines.push(sentence(combined));
    layoutLines.push("Show only enough of the surrounding body, vehicle, or object to explain the action; keep the wider environment out of focus or out of frame.");
    if (["wide", "extreme-wide"].includes(currentCamera.shotSize) || currentCamera.crop === "full-scene")
      conflictsResolved.push("Replaced wide/full-scene framing with a close detail insert because the shot direction prioritizes a tight physical action.");
    if ((context?.references || []).some((ref) => ref.type === "location"))
      conflictsResolved.push("Reduced the named location to minimal background context so it cannot overpower the action insert.");
  } else if (emphasis === "full-scene") {
    if (combined) layoutLines.push(sentence(combined));
    layoutLines.push("Keep the principal subjects readable within the wider environment and preserve clear foreground, midground, and background separation.");
  } else {
    if (combined) layoutLines.push(sentence(combined));
    layoutLines.push("Keep the primary action clearly readable while retaining only enough environment to establish spatial context.");
  }
  return normalizeBlockingPlan({
    emphasis,
    camera,
    environmentEmphasis: emphasis === "action-insert" ? "minimal" : emphasis === "full-scene" ? "full" : "supporting",
    primaryAction: combined || action,
    layoutLines,
    conflictsResolved,
    source: "deterministic",
  });
}
function applyBlockingPlan(spec, context, composition, options = {}) {
  const out = validateSpec(spec, spec);
  if (out.purpose !== "blocking") return out;
  const fallback = buildBlockingPlan(context, composition, options);
  const plan = normalizeBlockingPlan(options.plan || {}, fallback);
  out.blockingPlan = plan;
  out.blockingEmphasis = plan.emphasis;
  out.blockingDirection = cleanText(options.direction);
  const cameraPhrases = buildCameraPhrases(plan.camera);
  if (cameraPhrases.framing) out.camera.framing = cameraPhrases.framing;
  if (cameraPhrases.lensIntent) out.camera.lensIntent = cameraPhrases.lensIntent;
  const structuralLines = (out.stagingLines || []).filter((line) => /approximately\s+\d+\s+percent|Base-frame adjustment:/i.test(line));
  out.stagingLines = unique([...plan.layoutLines.map(sentence), ...structuralLines]);
  const location = (out.blockingEntities || []).find((item) => item.type === "location");
  if (plan.environmentEmphasis === "minimal") out.initialState.environment = "";
  else if (plan.environmentEmphasis === "supporting" && location?.descriptor)
    out.initialState.environment = `${clause(location.descriptor)} remains secondary, simplified background context and must not become the subject.`;
  else if (plan.environmentEmphasis === "full" && location?.descriptor)
    out.initialState.environment = location.descriptor;
  out.promptWarnings = unique([...(out.promptWarnings || []), ...plan.conflictsResolved.map((item) => `Blocking conflict resolved: ${item}`)]);
  return out;
}

function shotRefs(P, shot) {
  const resolved = resolveShotEntities(P, shot);
  const out = [];
  for (const x of resolved.characters)
    out.push({
      type: "character",
      id: x.id,
      name: x.name || x.id,
      role: "identity",
      approvedFile: x.approvedFile || "",
      canon: entityVisualDescription(x, "character"),
      drift: x.driftNotes || "",
      notes: x.notes || "",
      blockingNote: x.blockingNote || "",
    });
  for (const [type, list, role] of [
    ["location", resolved.locations, "location"],
    ["prop", resolved.props, "prop"],
    ["audio", resolved.audio, "audio"],
  ])
    for (const x of list)
      if (!out.some((item) => item.type === type && item.id === x.id))
        out.push({
          type,
          id: x.id,
          name: x.name || x.id,
          role,
          approvedFile: x.approvedFile || "",
          canon: entityVisualDescription(x, type),
          drift: x.driftNotes || "",
          notes: x.notes || "",
          blockingNote: x.blockingNote || "",
        });
  return out;
}

function styleBlocks(P, scene) {
  const blocks = (P.meta?.styleBlocks || [])
    .filter((b) => !b.stage || String(b.stage) === String(scene?.stage ?? ""))
    .map((b) => ({ id: b.id, name: b.name, text: b.text }));
  const global = cleanText(P.meta?.globalStylePrompt);
  if (global && !blocks.some((b) => b.id === "global-style"))
    blocks.unshift({ id: "global-style", name: "Global visual style", text: global });
  return blocks;
}


function normalizeAudioMode(value, legacyLipSync = false, hasLine = false) {
  const mode = cleanText(value);
  if (["none", "generate-voice", "lip-sync-reference"].includes(mode)) return mode;
  if (legacyLipSync) return "lip-sync-reference";
  return hasLine ? "generate-voice" : "none";
}
function compactVoiceDesign(value, maxWords = 36) {
  const clean = cleanText(value).replace(/\s+/g, " ");
  if (!clean) return "";
  const sentences = (clean.match(/[^.!?]+[.!?]?/g) || [clean])
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = sentences.slice(0, 2).join(" ");
  const words = selected.split(/\s+/).filter(Boolean);
  return sentence(words.slice(0, maxWords).join(" ").replace(/[,:;]+$/g, ""));
}
function audioEntityById(P, id) {
  return (P.audio || []).find((item) => cleanText(item.id) === cleanText(id)) || null;
}
function audioEntityRelationship(P, entity) {
  if (!entity?.sameObjectAs) return "";
  const canonical = audioEntityById(P, entity.sameObjectAs);
  return canonical
    ? `${entity.name || entity.id} is the same source voice as ${canonical.name || canonical.id}${entity.role ? ` (${entity.role})` : ""}`
    : `${entity.name || entity.id} is the same source voice as ${entity.sameObjectAs}${entity.role ? ` (${entity.role})` : ""}`;
}
function audioEntityUsesCleanMaster(P, entity) {
  if (!entity) return false;
  if (entity.cleanMaster) return true;
  return !!audioEntityById(P, entity.sameObjectAs)?.cleanMaster;
}
function profileAcceptsAudioReference(profile) {
  return !!profile?.supports?.audio && (
    profile.refSyntax === "typed-omni" ||
    profile.mode === "audio-video" ||
    Number(profile.limits?.maxAudio || 0) > 0
  );
}

function promptCharactersForContext(P, shot, scene, segment, resolvedCharacters = []) {
  const selected = new Set((resolvedCharacters || []).map((item) => cleanText(item.id)).filter(Boolean));
  const text = [
    scene?.whatHappens,
    scene?.howItFeels,
    shot?.title,
    shot?.desc,
    shot?.positioning,
    shot?.motionPrompt,
    shot?.audio?.speakerId,
    shot?.audio?.speakerName,
    segment?.title,
    segment?.motionPrompt,
    segment?.note,
    segment?.speakerId,
  ].map(cleanText).filter(Boolean).join(" ");
  return (P.characters || []).filter((character) => {
    if (selected.has(cleanText(character.id))) return true;
    return unique([cleanText(character.name), cleanText(character.id)]).filter(Boolean).some((token) => new RegExp(`\b${escapeRegExp(token)}(?:[’']s)?\b`, "i").test(text));
  }).map((character) => ({
    id: character.id,
    name: character.name || character.id,
    type: "character",
    canon: entityVisualDescription(character, "character"),
    notes: character.notes || "",
  }));
}

/* FRAME PRESENCE, resolved into the shape defaultSpec needs.

   Dogfood #2 A3 / forensic F6. buildContext() had no frame at all: it assembled
   the WHOLE shot's cast, description, beat and references, and server.js then
   APPENDED the frame directive to the result. So a frame authored as "no
   Chimbley Sweep visible" still compiled the Sweep's identity canon, the Sweep's
   subject descriptor and a shot description that put him in the composition —
   and GPT Image 2 obeyed, on a paid render.

   `frameId` is optional and absent means exactly what it always meant: no frame
   declares anything, so nothing changes. Only an explicit per-frame declaration
   overrides shot membership. */
function resolveFramePresenceContext(P, shot, frameId) {
  const id = cleanText(frameId);
  if (!id) return { frameId: "", declarations: [], absent: [] };
  const declarations = FramePresence.framePresenceDeclarations(shot, id);
  if (!declarations.length) return { frameId: id, declarations: [], absent: [] };
  const byId = new Map();
  for (const list of ["characters", "locations", "props", "vehicles"]) {
    for (const entity of Array.isArray(P[list]) ? P[list] : []) {
      if (entity && entity.id && !byId.has(entity.id)) byId.set(entity.id, { entity, list });
    }
  }
  const absent = declarations
    .filter((entry) => FramePresence.FRAME_PRESENCE_FORBIDDING_VALUES.includes(entry.presence))
    .map((entry) => {
      const found = byId.get(entry.entityId);
      return {
        id: entry.entityId,
        name: cleanText(found?.entity?.name) || entry.entityId,
        aliases: [cleanText(found?.entity?.prefix), cleanText(found?.entity?.anchorPrefix)].filter(Boolean),
        type: found ? { characters: "character", locations: "location", props: "prop", vehicles: "prop" }[found.list] || "reference" : "reference",
      };
    });
  return { frameId: id, declarations, absent };
}

function buildContext(P, shotId, segmentId = "", options = {}) {
  const shot = (P.shots || []).find((s) => s.id === shotId);
  if (!shot) {
    const error = new Error("Shot not found");
    error.code = "SHOT_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  const scene = (P.scenes || []).find((s) => s.id === shot.scene) || {};
  const segment = segmentId
    ? (shot.clips || []).find(
        (c) => String(c.id || c.suffix || "") === String(segmentId),
      )
    : null;
  const resolvedForPrompt = resolveShotEntities(P, shot);
  const duration = resolveShotDuration(shot, segment);
  const framePresence = resolveFramePresenceContext(P, shot, (options && options.frameId) || "");
  const absentIds = new Set(framePresence.absent.map((entry) => entry.id));
  /* WHOLE-SHOT NARRATIVE THAT NAMES AN ABSENT ENTITY IS NOT FRAME TRUTH. It is
     withheld in full rather than edited, because a partial redaction of authored
     prose produces a sentence nobody wrote — and the frame's own description,
     which server.js overlays as the directive, is the authority for this frame.
     `withheldNarrative` records that it happened so the build can say so. */
  const shotNarrative = FramePresence.narrativeForFrame(shot.desc || "", framePresence.absent);
  const sceneBeat = FramePresence.narrativeForFrame(scene.whatHappens || "", framePresence.absent);
  const shotPositioning = FramePresence.narrativeForFrame(shot.positioning || "", framePresence.absent);
  return {
    /* An entity declared absent contributes no positive subject descriptor. The
       reference itself is untouched — attachment and presence are different
       facts, and the identity anchor may legitimately stay attached. */
    promptEntities: promptCharactersForContext(P, shot, scene, segment, resolvedForPrompt.characters)
      .filter((entry) => !absentIds.has(entry.id)),
    framePresence: {
      frameId: framePresence.frameId,
      declarations: framePresence.declarations,
      absent: framePresence.absent,
      withheldNarrative: [
        ...(shotNarrative.withheldFor.length ? [{ field: "shot.desc", entityIds: shotNarrative.withheldFor }] : []),
        ...(sceneBeat.withheldFor.length ? [{ field: "scene.whatHappens", entityIds: sceneBeat.withheldFor }] : []),
        ...(shotPositioning.withheldFor.length ? [{ field: "shot.positioning", entityIds: shotPositioning.withheldFor }] : []),
      ],
    },
    project: {
      title: P.meta?.title || "",
      format: P.meta?.format || "",
      world: {
        ...(P.meta?.world || {}),
        reject: P.meta?.globalNegativePrompt || P.meta?.world?.reject || "",
      },
      styleBlocks: styleBlocks(P, scene),
      qcChecklist: P.qcChecklist || [],
      aspectRatio: parseAspectRatio(P.meta?.aspectRatio || "") || parseAspectRatio(P.meta?.format || ""),
    },
    scene: {
      id: scene.id || shot.scene,
      title: scene.title || "",
      beat: sceneBeat.text,
      feeling: scene.howItFeels || "",
      stage: scene.stage ?? "",
    },
    shot: {
      id: shot.id,
      parentShotId: shot.id,
      segmentId: segment ? String(segment.id || segment.suffix || "") : "",
      title: segment
        ? `${shot.title || shot.id} — ${segment.title || segment.suffix || "segment"}`
        : shot.title || "",
      description: segment
        ? segment.motionPrompt ||
          segment.note ||
          segment.title ||
          shotNarrative.text ||
          ""
        : shotNarrative.text,
      positioning: segment
        ? segment.positioning || shotPositioning.text || ""
        : shotPositioning.text,
      /* One resolver, so a duration stored under any supported alias is the
         duration generation compiles against. Reading only `shot.dur` turned
         the sample's declared 4-second shot into a defaulted 5-second one. */
      durationSeconds: duration.seconds,
      durationWasDefaulted: duration.wasDefaulted,
      motionDirection: segment
        ? segment.motionPrompt || segment.note || ""
        : shot.motionPrompt || "",
      outputPlan: segment
        ? segment.kind || "i2v"
        : shot.clips?.length > 1
          ? "sequence"
          : shot.clips?.[0]?.kind || "hold",
      clips: shot.clips || [],
      risks: segment
        ? [...(shot.risks || []), ...(segment.risks || [])]
        : shot.risks || [],
      safeVersion: segment ? segment.safe || shot.safe || "" : shot.safe || "",
      composition: shot.creationBrief?.composition || null,
      motionPlan: shot.creationBrief?.motionPlan || null,
      audio: (() => {
        const shotAudio = shot.audio && typeof shot.audio === "object" ? shot.audio : {};
        const line = cleanText(segment ? segment.line || shotAudio.line : shotAudio.line);
        const speakerId = cleanText(segment ? segment.speakerId || shotAudio.speakerId : shotAudio.speakerId);
        const note = cleanText(segment ? segment.audioNote || segment.vo || shotAudio.note || shotAudio.vo : shotAudio.note || shotAudio.vo);
        const voiceEntityId = cleanText(segment ? segment.voiceEntityId || shotAudio.voiceEntityId : shotAudio.voiceEntityId);
        const speaker = (P.characters || []).find((item) => item.id === speakerId) || null;
        const voiceEntity = audioEntityById(P, voiceEntityId);
        return {
          line,
          dialogue: line,
          speakerId,
          speakerName: speaker?.name || speakerId,
          note,
          legacyVo: cleanText(segment ? segment.vo : shotAudio.vo),
          voiceEntityId,
          voiceEntityName: voiceEntity?.name || voiceEntityId,
          voiceRelationship: audioEntityRelationship(P, voiceEntity),
          cleanMaster: audioEntityUsesCleanMaster(P, voiceEntity),
          voiceDesign: cleanText(speaker?.audio?.voiceDesignPrompt),
          sfx: segment ? segment.sfx || shotAudio.sfx || "" : shotAudio.sfx || "",
          clipDialogue: (shot.clips || [])
            .filter((c) => cleanText(c.line))
            .map((c) => ({ clip: c.suffix || c.id || "", line: cleanText(c.line), speakerId: cleanText(c.speakerId || shotAudio.speakerId) })),
        };
      })(),
    },
    references: shotRefs(P, shot),
  };
}

function defaultSpec(context, purpose, mode, references, mediaAnalysis) {
  const duration = Math.max(1, Number(context.shot.durationSeconds || 5));
  const blockingPurpose = purpose === "blocking" || mode === "blocking";
  const motionPurpose = purpose === "motion" || ["i2v", "flf", "r2v", "audio-video"].includes(mode);
  // In first/last-frame video modes, the approved frame already carries the
  // complete visual identity and environment. Repeating missing-canon warnings
  // here is noise and incorrectly suggests that extra still-image references
  // should be attached to a motion-only package.
  const frameCarriesVisualState = motionPurpose && ["i2v", "flf"].includes(mode);
  const action = cleanText(
    motionPurpose
      ? context.shot.motionDirection || context.shot.description || context.scene.beat || context.shot.title
      : context.shot.description || context.scene.beat || context.shot.title,
  );
  const positioning = cleanText(context.shot.positioning);
  const dialogue = cleanText(context.shot.audio.line || context.shot.audio.dialogue);
  const sfx = cleanText(context.shot.audio.sfx);
  const visualReferenceForEntity = (entityId) => (references || []).find((candidate) => {
    if (referenceMediaType(candidate) !== "image" || !(candidate.url || candidate.approved)) return false;
    const resolvedId = cleanText(candidate.entityId || candidate.id);
    if (resolvedId === cleanText(entityId)) return true;
    const keyParts = cleanText(candidate.key).split(":").filter(Boolean);
    return keyParts.includes(cleanText(entityId));
  });
  const identityCanon = [];
  const driftRestatements = [];
  const visualGrounding = [];
  const promptWarnings = [];
  const mustPreserve = [];
  /* THE FRAME'S OWN TRUTH, applied where the positive facts are assembled.

     An entity this frame declares absent still keeps its reference — attachment
     and presence are different facts, and an identity anchor may legitimately
     stay attached so the model knows who NOT to draw and so the rest of the
     frame stays consistent. What it loses is every POSITIVE assertion: no
     identity canon, no drift restatement, no visual grounding, no
     must-preserve, no blocking descriptor, no subject descriptor. */
  const framePresence = context.framePresence || { absent: [], declarations: [], withheldNarrative: [] };
  const absentEntities = Array.isArray(framePresence.absent) ? framePresence.absent : [];
  const absentIds = new Set(absentEntities.map((entry) => cleanText(entry.id)).filter(Boolean));
  for (const ref of context.references || []) {
    if (blockingPurpose) continue;
    if (absentIds.has(cleanText(ref.id))) continue;
    const canon = cleanText(ref.canon);
    const drift = cleanText(ref.drift);
    const selectedVisual = visualReferenceForEntity(ref.id);
    if (selectedVisual) {
      visualGrounding.push({
        entityId: ref.id,
        name: ref.name,
        type: ref.type,
        referenceKey: selectedVisual.key || "",
        referenceLabel: selectedVisual.label || selectedVisual.name || ref.name,
      });
    }
    if (canon) {
      const hasApprovedVisual = !!ref.approvedFile || !!selectedVisual;
      identityCanon.push(`${ref.name}: ${hasApprovedVisual ? compactCanon(canon) : canon}`);
    } else if (ref.type !== "audio" && !selectedVisual && !frameCarriesVisualState) {
      const generic = ref.type === "character"
        ? `${ref.name}'s approved identity, proportions and wardrobe state`
        : ref.type === "location"
          ? `${ref.name}'s approved geometry, materials and lighting logic`
          : `${ref.name}'s approved design, scale and placement`;
      mustPreserve.push(generic);
      promptWarnings.push(`${ref.name} has neither canon text nor a selected approved visual reference; attach or enable an image reference, or add canon text.`);
    }
    if (drift) driftRestatements.push(`${ref.name}: ${drift}`);
  }
  if (!blockingPurpose) mustPreserve.push("screen direction and continuity with adjacent shots");
  /* The model is TOLD about the absence rather than merely not told about the
     presence. Generic "avoid unrequested characters" was already here and did
     not save S01-01, because the Sweep was not unrequested — the compiled prompt
     had asked for him. */
  const mustAvoid = unique([
    context.project.world?.reject ? `world violations: ${context.project.world.reject}` : "",
    ...FramePresence.absenceRequirements(absentEntities),
    "unrequested characters, props, text or camera moves",
    "identity drift, anatomy deformation and geometry warping",
  ]);
  const location = (context.references || []).find((ref) => ref.type === "location");
  const environment = cleanText(location?.canon || context.project.world?.setting);
  const refRoles = (references || []).map((r, i) => ({
    token: r.token || `#image${i + 1}`,
    role: r.role || "reference",
    label: r.label || r.name || `Reference ${i + 1}`,
    sourceType: r.sourceType || "",
    instruction: r.instruction || "",
  }));
  const blockingEntities = (context.references || [])
    .filter((ref) => ref.type !== "audio" && !absentIds.has(cleanText(ref.id)))
    .map((ref) => ({ id: ref.id, name: ref.name, type: ref.type, blockingNote: ref.blockingNote || "", descriptor: blockingPlaceholder(ref) }));
  const blockingNarrative = sanitizeBlockingText(context.shot.description || context.scene.beat || context.shot.title, context.references || []);
  const blockingEnvironment = blockingEntities.find((item) => item.type === "location")?.descriptor || cleanText(context.project.world?.setting);
  return {
    schemaVersion: 1,
    purpose: purpose || (mode === "flf" ? "motion" : "first-frame"),
    mode,
    shotId: context.shot.id,
    durationSeconds: duration,
    durationWasDefaulted: !!context.shot.durationWasDefaulted,
    narrativePurpose: blockingPurpose ? blockingNarrative : cleanText(context.scene.beat || context.shot.description || context.shot.title),
    initialState: {
      subject: blockingPurpose ? blockingNarrative : cleanText(context.shot.description || context.shot.title),
      staging: blockingPurpose ? sanitizeBlockingText(positioning, context.references || []) : positioning,
      camera: cleanText(mediaAnalysis?.camera?.summary || "Use the approved shot framing and screen direction."),
      environment: blockingPurpose ? blockingEnvironment : environment,
    },
    finalState: {
      subject: cleanText(
        mediaAnalysis?.lastFrame?.subject ||
          (["last-frame", "edit", "continuity-fix"].includes(purpose) ? action : ""),
      ),
      staging: cleanText(mediaAnalysis?.lastFrame?.staging || ""),
      camera: cleanText(mediaAnalysis?.lastFrame?.camera || ""),
      environment: cleanText(mediaAnalysis?.lastFrame?.environment || ""),
    },
    actions: action ? [{ start: 0, end: duration, action }] : [],
    camera: {
      framing: cleanText(mediaAnalysis?.camera?.shotSize || ""),
      movement: cleanText(mediaAnalysis?.camera?.movement || "No camera movement unless specified by the shot."),
      stability: "controlled and physically plausible",
      lensIntent: cleanText(mediaAnalysis?.camera?.lensIntent || ""),
    },
    performance: {
      emotion: cleanText(context.scene.feeling),
      movementIntensity: duration <= 5 ? "restrained and readable" : "controlled",
      gaze: "",
    },
    environmentMotion: [],
    stagingLines: positioning ? [blockingPurpose ? sanitizeBlockingText(positioning, context.references || []) : positioning] : [],
    mustInclude: [],
    mustPreserve: unique(mustPreserve),
    mustAvoid,
    identityCanon: unique(identityCanon),
    driftRestatements: unique(driftRestatements),
    visualGrounding,
    /* The fallback arm matters as much as the primary one: with no promptEntities
       the compiler used every character reference on the shot, which is the exact
       path that put the Sweep's descriptor into a frame that excluded him. */
    promptEntities: ((context.promptEntities || []).length ? context.promptEntities : (context.references || []).filter((ref) => ref.type === "character"))
      .filter((ref) => !absentIds.has(cleanText(ref.id)))
      .map((ref) => ({
        id: ref.id,
        name: ref.name,
        type: "character",
        descriptor: characterPromptDescriptor(ref),
      })),
    /* The declaration, carried on the spec so the preflight can check the
       compiled result against it without re-reading the project. */
    framePresence: {
      frameId: cleanText(framePresence.frameId),
      declarations: Array.isArray(framePresence.declarations) ? framePresence.declarations : [],
      absent: absentEntities,
      withheldNarrative: Array.isArray(framePresence.withheldNarrative) ? framePresence.withheldNarrative : [],
    },
    productionRisks: unique(context.shot.risks || []),
    promptWarnings: unique(promptWarnings),
    audio: {
      dialogue,
      transcript: "",
      speakerId: cleanText(context.shot.audio.speakerId),
      speakerName: cleanText(context.shot.audio.speakerName),
      note: cleanText(context.shot.audio.note),
      voiceEntityId: cleanText(context.shot.audio.voiceEntityId),
      voiceEntityName: cleanText(context.shot.audio.voiceEntityName),
      voiceRelationship: cleanText(context.shot.audio.voiceRelationship),
      cleanMaster: !!context.shot.audio.cleanMaster,
      voiceDesign: compactVoiceDesign(context.shot.audio.voiceDesign),
      mode: dialogue ? "generate-voice" : "none",
      referenceKey: "",
      referenceLabel: "",
      delivery: "",
      sfx,
      ambience: "",
    },
    references: refRoles,
    visualStyle: blockingPurpose ? [] : context.project.styleBlocks.map((b) => b.text),
    blockingEntities,
    blockingLabels: true,
    blockingSourceAvailable: !!cleanText(context.shot.description || context.shot.positioning || context.scene.beat || context.shot.title),
    blockingGuideAdherence: cleanText(context.shot.composition?.blockingGuideAdherence || "strict"),
    blockingEmphasis: "auto",
    blockingDirection: "",
    blockingPlan: {},
    world: { ...(context.project.world || {}), aspectRatio: context.project.aspectRatio || "" },
    aspectRatio: context.project.aspectRatio || "",
    mediaAnalysis: mediaAnalysis || null,
    createdAt: isoNow(),
  };
}


function normalizedLabel(value) { return cleanText(value).replace(/-/g, " "); }
function applyStructuredDirection(spec, composition, motionPlan, refs = []) {
  const out = validateSpec(spec, spec);
  const comp = composition && typeof composition === "object" ? composition : null;
  if (comp) {
    const camera = comp.camera || {};
    const cameraPhrases = buildCameraPhrases(camera);
    out.camera.framing = cameraPhrases.framing || out.camera.framing;
    out.camera.lensIntent = cameraPhrases.lensIntent || out.camera.lensIntent;
    const base = comp.baseFrame || {};
    if (base.source && base.source !== "blank") {
      const baseAdjustments = [];
      if (Math.abs(Number(base.zoom || 1) - 1) > .01) baseAdjustments.push(`${Number(base.zoom) > 1 ? "zoom in" : "zoom out"} to ${Math.round(Number(base.zoom) * 100)} percent`);
      if (Math.abs(Number(base.panX || 0)) > .5 || Math.abs(Number(base.panY || 0)) > .5) baseAdjustments.push(`shift the base crop ${Number(base.panX || 0) > 0 ? "right" : Number(base.panX || 0) < 0 ? "left" : ""}${Number(base.panX || 0) && Number(base.panY || 0) ? " and " : ""}${Number(base.panY || 0) > 0 ? "down" : Number(base.panY || 0) < 0 ? "up" : ""}`.trim());
      if (Math.abs(Number(base.rotation || 0)) > .1) baseAdjustments.push(`rotate ${Math.abs(Number(base.rotation))} degrees ${Number(base.rotation) > 0 ? "clockwise" : "counterclockwise"}`);
      if (baseAdjustments.length) out.stagingLines = unique([...(out.stagingLines || []), `Base-frame adjustment: ${baseAdjustments.join(", ")}`]);
    }
    const guidePlacements = [];
    const elementLines = (comp.elements || []).filter((element) => {
      if (element.hidden) return false;
      const ref = refs.find((item) => item.key === element.referenceKey);
      const blockingEntity = out.purpose === "blocking" ? blockingEntityForKey(out, element.referenceKey, element.label || ref?.label) : null;
      if (blockingEntity?.type === "location") return false;
      return !ref || (!["base", "location", "composition"].includes(ref.role) && ref.sourceType !== "location");
    }).sort((a,b) => (+a.order || 0) - (+b.order || 0)).map((element) => {
      const ref = refs.find((item) => item.key === element.referenceKey);
      const blockingEntity = out.purpose === "blocking" ? blockingEntityForKey(out, element.referenceKey, element.label || ref?.label) : null;
      const label = blockingEntity?.descriptor || ref?.entityName || ref?.displayName || ref?.label || element.label || "element";
      const horizontal = +element.x < .34 ? "camera-left" : +element.x > .66 ? "camera-right" : "center frame";
      const vertical = +element.y < .35 ? "upper frame" : +element.y > .68 ? "lower frame" : "mid-height";
      if (ref) guidePlacements.push({
        referenceKey: ref.key || element.referenceKey,
        label: ref.entityName || ref.displayName || ref.label || element.label || "Reference",
        horizontal,
        vertical,
        depth: element.depth || "midground",
        widthPercent: Math.round((+element.w || .25) * 100),
        heightPercent: Math.round((+element.h || .25) * 100),
        facing: normalizedLabel(element.facing || "camera"),
        view: normalizedLabel(element.view || "reference view"),
        crop: element.crop && element.crop !== "none" ? normalizedLabel(element.crop) : "",
        notes: cleanText(element.notes),
      });
      return sentence(`${label} in the ${element.depth || "midground"}, ${horizontal}, ${vertical}, approximately ${Math.round((+element.w || .25)*100)} percent of frame width by ${Math.round((+element.h || .25)*100)} percent of frame height, facing ${normalizedLabel(element.facing || "camera")}, shown from ${normalizedLabel(element.view || "reference view")}${element.crop && element.crop !== "none" ? `, ${normalizedLabel(element.crop)}` : ""}${element.notes ? `; ${sanitizeBlockingText(element.notes, out.blockingEntities || [])}` : ""}`);
    });
    if (elementLines.length) out.stagingLines = unique([...(out.stagingLines || []), ...elementLines]);
    out.guidePlacements = guidePlacements;
    if (camera.reframe === "preserve-exact") out.mustPreserve = unique([...out.mustPreserve, "the exact source framing and staged screen positions"]);
    if (comp.mustInclude) out.mustInclude = unique([...(out.mustInclude || []), comp.mustInclude]);
    if (comp.mustAvoid) out.mustAvoid = unique([...out.mustAvoid, comp.mustAvoid]);
  }
  const plan = motionPlan && typeof motionPlan === "object" ? motionPlan : null;
  if (plan) {
    const camera = plan.camera || {};
    out.camera.movement = camera.move === "locked" ? "locked-off camera with no drift" : [normalizedLabel(camera.move), normalizedLabel(camera.direction)].filter(Boolean).join(" ") || out.camera.movement;
    out.camera.stability = [normalizedLabel(camera.style), normalizedLabel(camera.intensity), camera.framing === "allow-reframe" ? "reframing allowed" : "preserve staged framing"].filter(Boolean).join(", ");
    const actions = [];
    for (const [id, item] of Object.entries(plan.subjects || {})) {
      const target = cleanText(item.targetLabel || item.targetId || "");
      actions.push(`${id} ${normalizedLabel(item.action || "still")}${target ? ` toward or in relation to ${target}` : item.direction ? ` toward ${normalizedLabel(item.direction)}` : ""}${item.destination ? `, ending ${cleanText(item.destination)}` : ""}${item.look ? ` while looking ${normalizedLabel(item.look)}` : ""}${item.notes ? `; ${item.notes}` : ""}`);
    }
    for (const [id, item] of Object.entries(plan.props || {})) {
      const target = cleanText(item.targetLabel || item.targetId || "");
      actions.push(`${id} ${normalizedLabel(item.action || "static")}${target ? ` in relation to ${target}` : item.direction ? ` ${normalizedLabel(item.direction)}` : ""}${item.destination ? `, ending ${cleanText(item.destination)}` : ""}${item.notes ? `; ${item.notes}` : ""}`);
    }
    if (actions.length) {
      const structuredAction = actions.join(". ");
      const normalizedStructured = cleanText(structuredAction).toLowerCase();
      const existing = (out.actions || [])
        .filter((item) => cleanText(item.action))
        .filter((item) => cleanText(item.action).toLowerCase() !== normalizedStructured);
      // Structured controls are the director's explicit choices. Put them first
      // so compact I2V compilers cannot trim them behind a generic shot synopsis.
      out.actions = [{ start: 0, end: out.durationSeconds, action: structuredAction }, ...existing];
    }
    const audioPlan = plan.audio || {};
    const audioMode = normalizeAudioMode(audioPlan.mode, !!audioPlan.lipSync, !!out.audio?.dialogue);
    const ref = refs.find((item) => item.key === audioPlan.referenceKey);
    const speakerId = cleanText(audioPlan.speakerId || out.audio?.speakerId);
    const speakerName = cleanText(audioPlan.speakerName || out.audio?.speakerName || speakerId || "Selected character");
    const voiceEntityId = cleanText(audioPlan.voiceEntityId || out.audio?.voiceEntityId);
    if (audioMode === "lip-sync-reference") {
      out.audio = {
        ...out.audio,
        mode: audioMode,
        transcript: cleanText(out.audio?.dialogue),
        dialogue: "",
        referenceKey: cleanText(audioPlan.referenceKey),
        referenceLabel: cleanText(ref?.label || ref?.name || "the assigned audio reference"),
        speakerId,
        speakerName,
        voiceEntityId,
        delivery: cleanText(audioPlan.direction),
      };
    } else if (audioMode === "generate-voice") {
      out.audio = {
        ...out.audio,
        mode: audioMode,
        referenceKey: "",
        referenceLabel: "",
        speakerId,
        speakerName,
        voiceEntityId,
        delivery: cleanText(audioPlan.direction),
      };
    } else {
      out.audio = { ...out.audio, mode: "none", dialogue: "", transcript: "", referenceKey: "", referenceLabel: "", delivery: "" };
    }
    const env = plan.environment || {};
    if (env.action && env.action !== "static") out.environmentMotion = unique([...out.environmentMotion, `${normalizedLabel(env.action)}, ${normalizedLabel(env.intensity || "subtle")}${env.notes ? `; ${env.notes}` : ""}`]);
    const timing = plan.timing || {};
    if (timing.secondary) out.actions.push({ start: Math.max(0, out.durationSeconds * .5), end: out.durationSeconds, action: timing.secondary });
    if (timing.holdEnd) out.mustPreserve = unique([...out.mustPreserve, "settle into and briefly hold the final state"]);
  }
  return out;
}


function motionBriefSfxText(events) {
  return (Array.isArray(events) ? events : [])
    .filter((item) => cleanText(item?.event || item?.sound || item?.description))
    .map((item) => {
      const timing = cleanText(item.timing);
      const event = cleanText(item.event || item.sound || item.description);
      const detail = [cleanText(item.intensity), cleanText(item.distance), cleanText(item.source), item.diegetic === false ? "non-diegetic" : "diegetic"].filter(Boolean).join(", ");
      return `${timing ? `${timing}: ` : ""}${event}${detail ? ` (${detail})` : ""}`;
    })
    .join("; ");
}
function applyMotionAudioBrief(spec, rawBrief) {
  const out = validateSpec(spec, spec);
  const brief = rawBrief && typeof rawBrief === "object" ? rawBrief : null;
  if (!brief) return out;
  const performance = brief.performance && typeof brief.performance === "object" ? brief.performance : {};
  const camera = brief.camera && typeof brief.camera === "object" ? brief.camera : {};
  const dialogue = brief.dialogue && typeof brief.dialogue === "object" ? brief.dialogue : {};
  const sound = brief.sound && typeof brief.sound === "object" ? brief.sound : {};
  const output = brief.output && typeof brief.output === "object" ? brief.output : {};
  const actionParts = [
    cleanText(performance.action),
    cleanText(performance.objectInteraction) ? `Object interaction: ${cleanText(performance.objectInteraction)}` : "",
    cleanText(performance.secondaryMotion) ? `Secondary motion: ${cleanText(performance.secondaryMotion)}` : "",
  ].filter(Boolean);
  if (actionParts.length) {
    const canonical = actionParts.join(". ");
    const existing = (out.actions || []).filter((item) => cleanText(item.action) && cleanText(item.action).toLowerCase() !== canonical.toLowerCase());
    out.actions = [{ start: 0, end: out.durationSeconds, action: canonical }, ...existing];
  }
  out.performance = {
    ...out.performance,
    emotion: cleanText(dialogue.emotion || performance.emotion || out.performance?.emotion),
    gaze: cleanText(performance.gaze || out.performance?.gaze),
    delivery: cleanText(dialogue.delivery || performance.delivery),
    facial: cleanText(performance.facial),
    bodyLanguage: cleanText(performance.bodyLanguage),
  };
  if (cleanText(performance.endingState)) out.finalState.subject = cleanText(performance.endingState);
  if (cleanText(camera.movement)) out.camera.movement = cleanText(camera.movement);
  if (cleanText(camera.timing)) out.camera.timing = cleanText(camera.timing);
  if (cleanText(camera.framing)) out.camera.framing = cleanText(camera.framing);
  if (cleanText(camera.lensBehavior)) out.camera.lensIntent = cleanText(camera.lensBehavior);
  if (cleanText(performance.staticConstraints)) out.mustPreserve = unique([...out.mustPreserve, cleanText(performance.staticConstraints)]);
  if (cleanText(performance.prohibitedMotion)) out.mustAvoid = unique([...out.mustAvoid, cleanText(performance.prohibitedMotion)]);
  const nativeAudio = output.nativeAudio !== false;
  const line = cleanText(dialogue.line);
  const delivery = [
    cleanText(dialogue.language) ? `Language: ${cleanText(dialogue.language)}` : "",
    cleanText(dialogue.emotion) ? `Emotion: ${cleanText(dialogue.emotion)}` : "",
    cleanText(dialogue.delivery),
    cleanText(dialogue.pace) ? `Pace: ${cleanText(dialogue.pace)}` : "",
    cleanText(dialogue.volume) ? `Volume: ${cleanText(dialogue.volume)}` : "",
    cleanText(dialogue.startTime) || cleanText(dialogue.endTime) ? `Timing: ${cleanText(dialogue.startTime) || "start"} to ${cleanText(dialogue.endTime) || "end"}` : "",
  ].filter(Boolean).join("; ");
  out.audio = {
    ...out.audio,
    dialogue: line,
    transcript: line,
    speakerId: cleanText(dialogue.speakerId || out.audio?.speakerId),
    speakerName: cleanText(dialogue.speakerName || out.audio?.speakerName || dialogue.speakerId),
    voiceDesign: compactVoiceDesign(dialogue.voiceDesign || out.audio?.voiceDesign),
    delivery,
    language: cleanText(dialogue.language),
    emotion: cleanText(dialogue.emotion),
    pace: cleanText(dialogue.pace),
    volume: cleanText(dialogue.volume),
    startTime: cleanText(dialogue.startTime),
    endTime: cleanText(dialogue.endTime),
    locked: dialogue.locked !== false,
    /* Carried as the level, not only as the boolean. The compiler inventories
       `performance.lipSync`, and a spec that dropped the tri-state on the way would
       hand it a value re-derived from a flag — which is how `implied` becomes
       indistinguishable from `none` again. */
    lipSync: deriveLipSync({ ...dialogue, line }),
    lipSyncRequired: lipSyncRequiredFrom({ ...dialogue, line }),
    mode: nativeAudio && line ? "generate-voice" : "none",
    sfx: motionBriefSfxText(sound.sfxEvents) || cleanText(out.audio?.sfx),
    ambience: cleanText(sound.ambience || out.audio?.ambience),
    music: cleanText(sound.music),
    silence: cleanText(sound.silence),
    priorities: cleanText(sound.priorities),
  };
  out.output = { ...(out.output || {}), resolution: cleanText(output.resolution || "model-default"), nativeAudio };
  out.motionBrief = JSON.parse(JSON.stringify(brief));
  return out;
}

function extractJsonObject(text) {
  const clean = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch {}
  const start = clean.indexOf("{"),
    end = clean.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
  throw new Error("Local model returned invalid JSON");
}

function validateSpec(raw, fallback) {
  const s = raw && typeof raw === "object" ? raw : {};
  const out = { ...fallback, ...s };
  out.initialState = { ...fallback.initialState, ...(s.initialState || {}) };
  out.finalState = { ...fallback.finalState, ...(s.finalState || {}) };
  out.camera = { ...fallback.camera, ...(s.camera || {}) };
  out.performance = { ...fallback.performance, ...(s.performance || {}) };
  out.promptEntities = Array.isArray(fallback.promptEntities) ? fallback.promptEntities.map((item) => ({ ...item })) : [];
  out.audio = {
    ...fallback.audio,
    ...(s.audio || {}),
    dialogue: fallback.audio?.dialogue || "",
    transcript: fallback.audio?.transcript || "",
    speakerId: fallback.audio?.speakerId || "",
    speakerName: fallback.audio?.speakerName || "",
    voiceEntityId: fallback.audio?.voiceEntityId || "",
    voiceEntityName: fallback.audio?.voiceEntityName || "",
    voiceRelationship: fallback.audio?.voiceRelationship || "",
    cleanMaster: !!fallback.audio?.cleanMaster,
    voiceDesign: fallback.audio?.voiceDesign || "",
    mode: normalizeAudioMode(fallback.audio?.mode, false, !!fallback.audio?.dialogue),
    referenceKey: fallback.audio?.referenceKey || "",
    referenceLabel: fallback.audio?.referenceLabel || "",
    language: fallback.audio?.language || "",
    emotion: fallback.audio?.emotion || "",
    pace: fallback.audio?.pace || "",
    volume: fallback.audio?.volume || "",
    startTime: fallback.audio?.startTime || "",
    endTime: fallback.audio?.endTime || "",
    locked: fallback.audio?.locked !== false,
    lipSync: deriveLipSync(fallback.audio),
    lipSyncRequired: lipSyncRequiredFrom(fallback.audio),
    music: fallback.audio?.music || "",
    silence: fallback.audio?.silence || "",
    priorities: fallback.audio?.priorities || "",
  };
  out.actions = Array.isArray(s.actions)
    ? s.actions
        .filter((a) => a && cleanText(a.action))
        .map((a) => ({
          start: Number(a.start || 0),
          end: Number(a.end || fallback.durationSeconds),
          action: cleanText(a.action),
        }))
    : fallback.actions;
  out.environmentMotion = Array.isArray(s.environmentMotion)
    ? s.environmentMotion.map(cleanText).filter(Boolean)
    : fallback.environmentMotion;
  out.mustPreserve = unique(
    Array.isArray(s.mustPreserve)
      ? s.mustPreserve.map(cleanText)
      : fallback.mustPreserve,
  );
  out.mustAvoid = unique(
    Array.isArray(s.mustAvoid) ? s.mustAvoid.map(cleanText) : fallback.mustAvoid,
  );
  out.mustInclude = unique(
    Array.isArray(s.mustInclude) ? s.mustInclude.map(cleanText) : fallback.mustInclude || [],
  );
  out.stagingLines = unique(
    Array.isArray(s.stagingLines) ? s.stagingLines.map(cleanText) : fallback.stagingLines || [],
  );
  out.identityCanon = unique(fallback.identityCanon || []);
  out.driftRestatements = unique(fallback.driftRestatements || []);
  out.visualGrounding = Array.isArray(fallback.visualGrounding) ? fallback.visualGrounding.map((item) => ({ ...item })) : [];
  out.guidePlacements = Array.isArray(s.guidePlacements) ? s.guidePlacements.map((item) => ({ ...item })) : (fallback.guidePlacements || []).map((item) => ({ ...item }));
  out.productionRisks = unique(fallback.productionRisks || []);
  out.promptWarnings = unique(fallback.promptWarnings || []);
  out.references = fallback.references;
  out.visualStyle = fallback.visualStyle;
  out.world = fallback.world;
  out.aspectRatio = fallback.aspectRatio || fallback.world?.aspectRatio || "";
  out.mediaAnalysis = fallback.mediaAnalysis;
  out.blockingEntities = Array.isArray(s.blockingEntities) ? s.blockingEntities : fallback.blockingEntities || [];
  out.blockingLabels = s.blockingLabels == null ? fallback.blockingLabels !== false : s.blockingLabels !== false;
  out.blockingSourceAvailable = s.blockingSourceAvailable == null ? !!fallback.blockingSourceAvailable : !!s.blockingSourceAvailable;
  out.blockingGuideAdherence = cleanText(s.blockingGuideAdherence || fallback.blockingGuideAdherence || "strict");
  out.blockingEmphasis = normalizeBlockingEmphasis(s.blockingEmphasis || fallback.blockingEmphasis || "auto");
  out.blockingDirection = cleanText(s.blockingDirection || fallback.blockingDirection || "");
  out.blockingPlan = normalizeBlockingPlan(s.blockingPlan || {}, fallback.blockingPlan || {});
  /* THE DECLARATION IS NOT NEGOTIABLE. A supplied spec — including one an
     assistant rewrote — may not soften, drop or invent a frame presence
     declaration; it is production truth read from the project, and the fallback
     is the only source of it. */
  out.framePresence = fallback.framePresence || { frameId: "", declarations: [], absent: [], withheldNarrative: [] };
  out.schemaVersion = 1;
  out.shotId = fallback.shotId;
  out.durationWasDefaulted = !!fallback.durationWasDefaulted;
  out.durationSeconds = Math.max(
    1,
    Number(out.durationSeconds || fallback.durationSeconds),
  );
  return out;
}

function buildSpecSystem(profile) {
  const requiredShape = {
    narrativePurpose: "",
    initialState: { subject: "", staging: "", camera: "", environment: "" },
    finalState: { subject: "", staging: "", camera: "", environment: "" },
    actions: [{ start: 0, end: 5, action: "" }],
    camera: { framing: "", movement: "", stability: "", lensIntent: "" },
    performance: { emotion: "", movementIntensity: "", gaze: "" },
    environmentMotion: [],
    mustInclude: [],
    mustPreserve: [],
    mustAvoid: [],
    audio: { dialogue: "", transcript: "", speakerId: "", speakerName: "", mode: "none", delivery: "", voiceDesign: "", sfx: "", ambience: "" },
  };

  const modeRules = [];
  if (profile.mediaType === "image") {
    modeRules.push(
      "- For text-to-image or multi-reference stills, initialState must describe the exact final still image and not actions that happen before or after the frame.",
      "- For edit profiles, initialState describes the current approved base image and finalState captures only the intended delta; mustPreserve must explicitly lock all unmentioned content.",
      "- If references include a composition guide, treat it as geometry only. Do not import background design, materials, or lighting from the guide unless canon explicitly authorizes it.",
      "- If the task is a derived continuity state, define the target-state delta precisely and move contradictory base-state instructions into mustAvoid rather than repeating them as active direction."
    );
  }
  if (profile.mediaType === "video") {
    modeRules.push(
      "- For image-to-video profiles, the first frame already carries the visual world. Do not re-describe identity, location, wardrobe, or style except when needed to protect continuity or clarify a targeted motion change.",
      "- For first/last-frame mode, both endpoints are fixed contracts. actions must describe only the physical bridge that can plausibly connect the supplied frames.",
      "- For reference/omni video mode, references carry source authority and the spec must separate opening state, subject performance, background motion, camera behavior, and audio synchronization.",
      "- Fit the action count to the duration; prefer one dominant action with light ambient motion for very short clips."
    );
  }
  if (profile.family === "wan-2.7") {
    modeRules.push("- For Wan targets, put unstable or unwanted behavior into mustAvoid so the adapter can route it into Wan's true negative field.");
  }
  if (profile.family === "seedance-2") {
    modeRules.push("- For Seedance targets, keep one continuous shot and separate performance, camera motion, and environment motion so the adapter can stay compact.");
  }

  return [
    "You are CineBraid's production prompt planner.",
    "Convert project canon, approved references, and shot direction into a MODEL-NEUTRAL Shot Specification.",
    "Do not write the final model prompt.",
    "Output ONLY one valid JSON object, with no markdown.",
    "",
    "Required keys:",
    JSON.stringify(requiredShape),
    "",
    "Core rules:",
    "- Use only facts supplied in the project context or visible media analysis.",
    "- Do not invent new props, characters, dialogue, wardrobe, location changes, camera moves, or story beats.",
    "- Dialogue is locked source material. Reproduce audio.dialogue byte-for-byte; improve delivery direction only.",
    "- Resolve the shot into one continuous, physically plausible action sequence fitting its duration.",
    "- Preserve approved identity, geometry, style, continuity state, and screen direction.",
    "- Translate failure tags and review notes into concrete mustPreserve and mustAvoid items whenever relevant.",
    "- Keep warnings and exclusions concrete, observable, and production-usable.",
    "- Prior successful prompts are examples of adapter discipline only; never copy their story content, characters, or locations.",
    `- The selected target profile is ${profile.name}; its final adapter strategy is ${profile.strategy}.`,
    "",
    "Mode-sensitive rules:",
    ...modeRules,
  ].join("\n");
}

function buildSpecUser(
  context,
  profile,
  purpose,
  mode,
  references,
  mediaAnalysis,
  directive,
) {
  return JSON.stringify(
    {
      target: {
        profile: profile.id,
        profileName: profile.name,
        purpose,
        mode,
        durationSeconds: context.shot.durationSeconds,
      },
      project: context.project,
      scene: context.scene,
      shot: context.shot,
      approvedReferences: context.references,
      selectedReferenceRoles: references,
      mediaAnalysis: mediaAnalysis || null,
      priorPromptExperience: context.promptExperience || {
        successfulExamples: [],
        commonFailureTags: [],
      },
      userDirective: cleanText(directive),
    },
    null,
    2,
  );
}

function referenceMediaType(ref) {
  const explicit = String(ref?.mediaType || ref?.kind || "").toLowerCase();
  if (["image", "video", "audio"].includes(explicit)) return explicit;
  const source = String(ref?.url || ref?.asset || ref?.label || ref?.name || "");
  if (/\.(mp4|webm|mov|mkv)(?:$|[?#])/i.test(source)) return "video";
  if (/\.(wav|mp3|m4a|flac|ogg|aac)(?:$|[?#])/i.test(source)) return "audio";
  return "image";
}
function tokenFor(profile, i, supplied) {
  if (supplied && /^[#@](?:image|video|audio)\d+$/i.test(supplied))
    return supplied;
  const syntax = profile.refSyntax || "#imageN";
  if (syntax === "@imageN") return `@image${i}`;
  if (syntax === "Image N") return `Image ${i}`;
  if (syntax === "#videoN") return `#video${i}`;
  return `#image${i}`;
}
function tokenForReference(profile, refs, index) {
  const ref = (refs || [])[index] || {};
  const kind = referenceMediaType(ref);
  // MiniMax H3 does not use legacy #imageN / @imageN tokens. Its provider
  // contract addresses inputs by modality and order: Image 1, Video 1,
  // Audio 1. Always normalize here, even when an imported or older build
  // carries a supplied token from another adapter.
  if (profile.refSyntax === "typed-h3") {
    let n = 0;
    for (let i = 0; i <= index; i++)
      if (referenceMediaType((refs || [])[i]) === kind) n++;
    return `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`;
  }
  if (ref.token && /^[#@](?:image|video|audio)\d+$/i.test(ref.token))
    return ref.token;
  if (profile.refSyntax !== "typed-omni")
    return tokenFor(profile, index + 1, ref.token);
  let n = 0;
  for (let i = 0; i <= index; i++)
    if (referenceMediaType((refs || [])[i]) === kind) n++;
  return `@${kind}${n}`;
}

function promptReferenceMatchesEntity(ref, entity) {
  if (!ref || !entity || referenceMediaType(ref) !== "image" || !(ref.url || ref.approved)) return false;
  const entityId = cleanText(entity.id);
  const entityName = cleanText(entity.name);
  const values = [ref.entityId, ref.id, ref.key, ref.entityName, ref.displayName, ref.label, ref.name].map(cleanText).filter(Boolean);
  if (values.some((value) => value === entityId || value === entityName)) return true;
  return values.some((value) => {
    const parts = value.split(/[:/|]/).map(cleanText).filter(Boolean);
    return parts.includes(entityId) || parts.includes(entityName);
  });
}
function replaceCharacterMention(value, entity, replacement) {
  let text = String(value || "");
  const tokens = unique([cleanText(entity?.name), cleanText(entity?.id)]).sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    if (!token) continue;
    text = text.replace(new RegExp(`\\b${escapeRegExp(token)}(?:[’\']s)?\\b`, "gi"), replacement);
  }
  return text.replace(/\s{2,}/g, " ").trim();
}
function referenceAwarePromptSpec(profile, spec, refs) {
  const out = JSON.parse(JSON.stringify(spec || {}));
  if (spec?.purpose === "blocking" || profile?.mode === "blocking") return out;
  const entities = Array.isArray(spec?.promptEntities) ? spec.promptEntities.filter((item) => item?.type === "character") : [];
  if (!entities.length) return out;
  const base = (refs || []).find((ref) => referenceMediaType(ref) === "image" && ["base", "first-frame", "composition"].includes(ref.role));
  /* CAN THIS TARGET ACCEPT ANOTHER IMAGE AT ALL?
   *
   * Read from the profile's own declared limits, never from a mode or family name.
   * It decides whether "attach an approved character image" is advice or an
   * impossibility: MiniMax H3's fl2va checkpoint carries first-frame and last-frame
   * and nothing else, so at i2v its single image slot and at flf both of them are
   * already spent on the approved endpoints, and t2v declares no reference slots at
   * all. Telling a filmmaker to attach a reference the selected route cannot hold is
   * the same failure as offering a model that cannot run. */
  const imageCount = (refs || []).filter((ref) => referenceMediaType(ref) === "image").length;
  const imageCeiling = Number(profile?.limits?.maxImages ?? profile?.limits?.maxReferences);
  const canAttachAnotherImage = !Number.isFinite(imageCeiling) || imageCount < imageCeiling;
  const replacements = [];
  for (const entity of entities) {
    const index = (refs || []).findIndex((ref) => promptReferenceMatchesEntity(ref, entity));
    const visual = index >= 0 ? refs[index] : null;
    const token = visual ? tokenForReference(profile, refs, index) : "";
    const descriptor = cleanText(entity.descriptor) || "the character assigned to this shot";
    /* An approved endpoint image grounds every character standing in it, not only a
       lone one. Restricting that to a single-character shot made a two-hander read as
       ungrounded while its own opening frame was carrying both identities. */
    const replacement = visual
      ? `${cleanText(entity.name || entity.id)} shown in ${token}`
      : base
        ? `${descriptor} shown in the supplied starting image`
        : descriptor;
    replacements.push({ entity, replacement, visual: !!visual, anchored: !visual && !!base });
  }
  const apply = (value) => replacements.reduce((text, row) => replaceCharacterMention(text, row.entity, row.replacement), String(value || ""));
  const applyArray = (items) => (Array.isArray(items) ? items.map(apply) : []);
  if (out.narrativePurpose != null) out.narrativePurpose = apply(out.narrativePurpose);
  for (const stateKey of ["initialState", "finalState"]) {
    out[stateKey] = out[stateKey] && typeof out[stateKey] === "object" ? out[stateKey] : {};
    for (const key of ["subject", "staging", "camera", "environment"]) if (out[stateKey][key] != null) out[stateKey][key] = apply(out[stateKey][key]);
  }
  out.actions = (out.actions || []).map((item) => ({ ...item, action: apply(item.action) }));
  out.stagingLines = applyArray(out.stagingLines);
  out.mustInclude = applyArray(out.mustInclude);
  out.mustPreserve = applyArray(out.mustPreserve);
  out.mustAvoid = applyArray(out.mustAvoid);
  out.identityCanon = applyArray(out.identityCanon);
  out.driftRestatements = applyArray(out.driftRestatements);
  out.environmentMotion = applyArray(out.environmentMotion);
  out.visualStyle = applyArray(out.visualStyle);
  out.productionRisks = applyArray(out.productionRisks);
  out.guidePlacements = (out.guidePlacements || []).map((item) => ({ ...item, label: apply(item.label), notes: apply(item.notes) }));
  if (out.camera && typeof out.camera === "object") {
    for (const key of ["framing", "movement", "stability", "lensIntent"]) if (out.camera[key] != null) out.camera[key] = apply(out.camera[key]);
  }
  if (out.performance && typeof out.performance === "object") {
    for (const key of Object.keys(out.performance)) if (typeof out.performance[key] === "string") out.performance[key] = apply(out.performance[key]);
  }
  if (out.audio && typeof out.audio === "object") {
    const speakerEntity = entities.find((entity) => cleanText(entity.id) === cleanText(out.audio.speakerId) || cleanText(entity.name) === cleanText(out.audio.speakerName));
    if (speakerEntity) {
      const row = replacements.find((item) => item.entity === speakerEntity);
      out.audio.speakerName = row?.replacement || "the visible speaker";
    } else if (out.audio.speakerName) out.audio.speakerName = apply(out.audio.speakerName);
    for (const key of ["note", "delivery", "voiceDesign", "sfx", "ambience", "music", "silence", "priorities"]) if (out.audio[key] != null) out.audio[key] = apply(out.audio[key]);
  }
  /* TWO DIFFERENT THINGS, AND THEY WERE ONE SENTENCE.
   *
   * The DISCLOSURE — "your character's story name was replaced in the prompt" — is
   * owed in every case: the filmmaker wrote a name and the model will not see it.
   * That is stated whether or not anything can be done about it.
   *
   * The INSTRUCTION was where this misled. "Attach an approved character image" was
   * appended unconditionally, including in the endpoint-only workflows where the
   * selected target has no slot left to attach one to — the dogfood read it during a
   * first/last-frame shot and took it for advice to change reference strategy. So the
   * action is chosen from what the target can actually accept, and where the approved
   * starting image is already carrying the identity, that is what it says. */
  const ungrounded = replacements.filter((row) => !row.visual);
  if (ungrounded.length) {
    const names = ungrounded.map((row) => row.entity.name || row.entity.id).filter(Boolean);
    const lead = `Reference-aware identity language replaced ungrounded character name${names.length === 1 ? "" : "s"}: ${names.join(", ")}.`;
    const action = ungrounded.every((row) => row.anchored)
      ? "Identity is carried by the approved starting image in this workflow; attach a character reference only on a target that accepts one."
      : canAttachAnotherImage
        ? "Attach an approved character image to use the story name in the model prompt."
        : `${profile?.name || "This target"} has no image reference slot left in this workflow, so the story name cannot be grounded here. Choose a reference-capable target if identity must come from an approved image.`;
    out.promptWarnings = unique([...(out.promptWarnings || []), `${lead} ${action}`]);
  }
  return out;
}

function refLegend(profile, refs) {
  return (refs || [])
    .map(
      (r, i) =>
        `${tokenForReference(profile, refs, i)} — ${String(r.role || "reference").toUpperCase()}: ${r.label || r.name || "Reference"}${r.instruction ? `; ${r.instruction}` : ""}`,
    )
    .join("\n");
}
function actionParagraph(spec) {
  const xs = (spec.actions || [])
    .map((a) => cleanText(a.action))
    .filter(Boolean);
  return xs.length ? xs.join(" Then, ") : cleanText(spec.narrativePurpose);
}
function styleText(spec) {
  return (spec.visualStyle || []).filter(Boolean).join(" ");
}
function preserveText(spec) {
  return (spec.mustPreserve || []).join("; ");
}
function avoidText(spec) {
  return (spec.mustAvoid || []).join("; ");
}
function voiceText(spec) {
  if (spec.audio?.mode !== "generate-voice") return "";
  const design = compactVoiceDesign(spec.audio?.voiceDesign);
  const relationship = cleanText(spec.audio?.voiceRelationship);
  return [design, relationship].filter(Boolean).join(" ");
}
function audioText(spec) {
  const bits = [];
  const mode = normalizeAudioMode(spec.audio?.mode, false, !!spec.audio?.dialogue);
  if (mode === "generate-voice" && spec.audio?.dialogue) {
    const speaker = cleanText(spec.audio?.speakerName || spec.audio?.speakerId || "Selected character");
    bits.push(`${speaker} says exactly: “${cleanText(spec.audio.dialogue).replace(/^['\"]|['\"]$/g, "")}”`);
    const voice = voiceText(spec);
    if (voice) bits.push(`Voice: ${voice}`);
    if (spec.audio?.delivery) bits.push(`Delivery: ${cleanText(spec.audio.delivery)}`);
  }
  if (mode === "lip-sync-reference") {
    const speaker = cleanText(spec.audio?.speakerName || spec.audio?.speakerId || "Selected character");
    const source = cleanText(spec.audio?.referenceLabel || "the assigned audio reference");
    bits.push(`${speaker} is the only speaking character and lip-syncs to ${source}`);
    if (spec.audio?.transcript) bits.push(`Transcript for timing only — do not generate a second voice: “${cleanText(spec.audio.transcript).replace(/^['\"]|['\"]$/g, "")}”`);
    if (spec.audio?.delivery) bits.push(`Preserve the recording's voice and timing; performance direction: ${cleanText(spec.audio.delivery)}`);
  }
  if (spec.audio?.sfx) bits.push(`Sound effects: ${spec.audio.sfx}`);
  if (spec.audio?.ambience) bits.push(`Ambience: ${spec.audio.ambience}`);
  if (spec.audio?.music) bits.push(`Music: ${spec.audio.music}`);
  if (spec.audio?.silence) bits.push(`Silence: ${spec.audio.silence}`);
  if (spec.audio?.priorities) bits.push(`Audio priority: ${spec.audio.priorities}`);
  return bits.join(" ");
}

function compactSentences(v, maxWords = 55, maxSentences = 3) {
  const clean = cleanText(v).replace(/\s+/g, " ");
  if (!clean) return "";
  const parts = (clean.match(/[^.!?]+[.!?]?/g) || [clean])
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, maxSentences)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1));
  const words = parts.join(" ").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return sentence(parts.join(" "));
  return sentence(
    words
      .slice(0, maxWords)
      .join(" ")
      .replace(/[,;:]?$/, ""),
  );
}
function explicitCameraMotion(spec) {
  const movement = cleanText(spec.camera?.movement);
  const stability = cleanText(spec.camera?.stability);
  const raw = [movement, stability].filter(Boolean).join(" ");
  if (
    !movement ||
    /no camera movement unless specified|use the approved|physically plausible|controlled and physically plausible/i.test(
      movement,
    )
  )
    return "";
  if (
    /\b(?:none|static|locked(?: off)?|stationary|rigid feed|does not move|holds steady|completely stable)\b/i.test(
      raw,
    )
  )
    return "Camera remains locked.";
  if (
    /^(?:camera\s+)?(?:remains\s+)?(?:locked|static|stationary)[.!]?$/i.test(
      raw,
    )
  )
    return "Camera remains locked.";
  const clean = movement.replace(/^none\s*(?:\([^)]*\))?$/i, "").trim();
  if (!clean)
    return stability && /stable|locked|static|rigid/i.test(stability)
      ? "Camera remains locked."
      : "";
  return /^camera\b/i.test(clean)
    ? compactSentences(clean, 18, 1)
    : compactSentences("Camera " + clean, 18, 1);
}
function simplifyMotionLanguage(v) {
  return cleanText(v)
    .replace(
      /\b(?:executes|undergoes)\s+an?\s+imperceptibly slow axial rotation\b/gi,
      "rotates almost imperceptibly",
    )
    .replace(
      /\b(?:executes|undergoes)\s+an?\s+(?:very\s+)?slow axial rotation\b/gi,
      "rotates slowly around its axis",
    )
    .replace(/\ba single\b/gi, "one")
    .replace(
      /\bcompletes?\s+(?:a|one)\s+steady\s+on\s*(?:and|\/)\s*off\s+flicker cycle and stabilizes\b/gi,
      "blinks steadily, then settles",
    )
    .replace(
      /\bcompletes?\s+(?:an?|one)\s+on\s*(?:and|\/)\s*off\s+flicker cycle and stabilizes\b/gi,
      "blinks once, then settles",
    )
    .replace(/\bcontinues to remain\b/gi, "remains")
    .replace(/\bslowly begins to\b/gi, "slowly")
    .replace(
      /\b(he|she|they) does not move except a slow breath and one blink\b/gi,
      (m, subject) =>
        `${subject} breathes slowly and blinks once, otherwise remaining still`,
    )
    .replace(
      /\b([A-Z][a-z]+|he|she|they) does not move except\s+([^.!?]+)/gi,
      (m, subject, action) =>
        `${subject} makes only ${action}, otherwise remaining still`,
    )
    .replace(/\bno new objects?\b[.!]?/gi, " ")
    .replace(
      /\bno expression change\b[.!]?/gi,
      "The expression remains unchanged.",
    )
    .replace(/\bno reaction\b[.!]?/gi, "The subject remains unreactive.")
    .replace(/;\s+(?=[A-Za-z])/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanMotionDirection(spec, maxWords = 60, maxSentences = 2) {
  let source = cleanText(actionParagraph(spec) || spec.narrativePurpose);
  const motionBlock = source.match(
    /(?:^|\n)\s*MOTION\s*:\s*([\s\S]*?)(?=\n\s*(?:RISKS?|REFS?|REFERENCES?|POS|POSITION|NOTES?|SETTINGS?)\s*:|$)/i,
  );
  if (motionBlock) source = motionBlock[1];
  else
    source = source.split(
      /\n\s*(?:RISKS?|REFS?|REFERENCES?|POS|POSITION|NOTES?|SETTINGS?)\s*:/i,
    )[0];
  let raw = source.replace(/\s*\/\s*/g, " and ");
  const cameraMatch = raw.match(
    /(?:^|[.!?]\s*)((?:the\s+)?camera(?:\s*\([^)]*\))?\s+(?:(?:is|remains)\s+)?(?:fixed|locked(?:\s+off)?|static|stationary|does not move|holds steady)[^.!?]*[.!?]?)/i,
  );
  if (cameraMatch) raw = raw.replace(cameraMatch[1], " ");
  raw = simplifyMotionLanguage(raw)
    .replace(
      /\b(?:no\s+vo|no\s+voiceover|no\s+dialogue|no\s+audio|no\s+other\s+motion)\b[.!]?/gi,
      " ",
    )
    .replace(
      /\b(?:preserve|maintain)\s+(?:the\s+)?(?:exact\s+)?(?:composition|appearance|location|lighting|identity)[^.!?]*[.!?]?/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
  const cameraFromText = cameraMatch
    ? /fixed|locked|static|stationary|does not move|holds steady/i.test(
        cameraMatch[1],
      )
      ? "Camera remains locked."
      : sentence(cameraMatch[1])
    : "";
  return {
    action: compactSentences(raw, maxWords, maxSentences),
    cameraFromText,
  };
}

// Motion directions are editable project data. Earlier CineBraid releases could
// accidentally save compiler boilerplate back into that field after the user
// accepted an assistant revision. Recover the observable motion intent before
// compiling or asking another model to improve it so prompts do not become a
// stack of nested "preserve / intensity / synchronization" wrappers.
function normalizeMotionDirective(value) {
  let raw = cleanText(value)
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\"/g, '"')
    .trim();
  if (!raw) return "";

  const structured = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(SUBJECT MOTION|ENVIRONMENT MOTION|CAMERA|MOTION|DIRECTIVE)\s*:\s*(.+)$/i,
    );
    if (match) structured[match[1].toUpperCase()] = match[2].trim();
  }
  if (structured["SUBJECT MOTION"] || structured.MOTION || structured.DIRECTIVE) {
    raw = [
      structured["SUBJECT MOTION"] || structured.MOTION || structured.DIRECTIVE,
      structured["ENVIRONMENT MOTION"],
      structured.CAMERA
        ? /^camera\b/i.test(structured.CAMERA)
          ? structured.CAMERA
          : `Camera ${structured.CAMERA}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  raw = raw
    .replace(/^\s*(?:DIRECTIVE|REVISED (?:MOTION )?DIRECTION|MOTION PROMPT)\s*[:=-]\s*/i, "")
    .replace(/^Opening state matches the supplied frame exactly\.\s*Motion:\s*/i, "")
    .replace(/^The shot begins exactly from the supplied image\.\s*/i, "")
    .replace(/^From the supplied opening frame,\s*/i, "")
    .replace(/^Primary motion:\s*/i, "")
    .replace(/^Visible motion only:\s*/i, "")
    .replace(/^Motion:\s*/i, "")
    .replace(
      /\s+(?:Motion level|Motion intensity|Intensity)\s*:\s*(?:nearly still|subtle|moderate|active|highly dynamic|[\w -]+)\.?[\s\S]*$/i,
      "",
    )
    .replace(
      /\s+Keep (?:subject motion, environmental motion, and camera behavior explicit and physically coherent|the movement chronological and physically coherent)[\s\S]*$/i,
      "",
    )
    .replace(
      /\s+The movement develops naturally across the duration with [\w -]+ energy\.[\s\S]*$/i,
      "",
    )
    .replace(
      /\s+Preserve (?:the approved composition, character identity, environment geometry, and object design|the supplied (?:frame's )?composition, identity, geometry, wardrobe, props, and lighting)[\s\S]*$/i,
      "",
    )
    .replace(
      /\s+(?:Synchronization|Audio timing intent|Audio and synchronization intent|Audio \/ timing)\s*:\s*Synchronization:\s*natural\.?/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();
  return raw;
}

function deterministicMotionRevision(profile, directive) {
  const normalized = normalizeMotionDirective(directive);
  if (!normalized) return "";
  const limits = {
    "kling-3": [62, 3],
    "happy-horse-1.1": [72, 3],
    "wan-2.7": [68, 3],
    "seedance-2": [82, 4],
    "ltx-2.3": [92, 4],
  };
  const [maxWords, maxSentences] = limits[profile?.family] || [72, 3];
  const motion = cleanMotionDirection(
    {
      narrativePurpose: normalized,
      actions: [{ start: 0, end: 5, action: normalized }],
      camera: { movement: "", stability: "" },
    },
    maxWords,
    maxSentences,
  );
  return [motion.action, motion.cameraFromText]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
function motionWords(v) {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "then",
    "while",
    "with",
    "from",
    "into",
    "its",
    "their",
    "his",
    "her",
    "one",
    "very",
    "slowly",
    "steadily",
  ]);
  return (
    cleanText(v)
      .toLowerCase()
      .match(/[a-z0-9]+/g) || []
  )
    .map((x) => x.replace(/(?:ing|ed|ly|s)$/, ""))
    .filter((x) => x.length > 3 && !stop.has(x));
}
function compactEnvironmentMotion(spec, maxWords = 22, action = "") {
  const actionWords = new Set(motionWords(action));
  const parts = (spec.environmentMotion || [])
    .map(cleanText)
    .filter(Boolean)
    .filter(
      (x) =>
        !/static atmospheric|keep the environment stable|no environment movement/i.test(
          x,
        ),
    )
    .filter((x) => {
      const words = motionWords(x);
      if (!words.length) return false;
      const overlap = words.filter((w) => actionWords.has(w)).length;
      return overlap / words.length < 0.45;
    });
  return compactSentences(parts.join("; "), maxWords, 1);
}
function compactNativeAudio(spec) {
  const bits = [];
  const dialogue = cleanText(spec.audio?.dialogue);
  const sfx = cleanText(spec.audio?.sfx);
  const ambience = cleanText(spec.audio?.ambience);
  const voice = compactVoiceDesign(spec.audio?.voiceDesign);
  const relationship = cleanText(spec.audio?.voiceRelationship);
  const delivery = cleanText(spec.audio?.delivery);
  const music = cleanText(spec.audio?.music);
  const silence = cleanText(spec.audio?.silence);
  const priorities = cleanText(spec.audio?.priorities);
  if (dialogue) bits.push(`${cleanText(spec.audio?.speakerName || spec.audio?.speakerId || "Speaker")} says exactly: “${dialogue.replace(/^['"]|['"]$/g, "")}”`);
  if (voice) bits.push(`Voice: ${voice}`);
  if (relationship) bits.push(`Voice relationship: ${relationship}`);
  if (delivery) bits.push(`Delivery: ${delivery}`);
  if (sfx) bits.push(`Sound: ${sfx}`);
  if (ambience) bits.push(`Ambience: ${ambience}`);
  if (music) bits.push(`Music: ${music}`);
  if (silence) bits.push(`Silence: ${silence}`);
  if (priorities) bits.push(`Priority: ${priorities}`);
  return bits.join(" ");
}
function lowerFirst(v) {
  const t = cleanText(v);
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : "";
}
function requestedStillness(spec) {
  return /\b(?:no other motion|everything else (?:remains|stays) still|otherwise (?:remaining|remains|stays) still|all other (?:motion|elements?) (?:remain|stays?) still)\b/i.test(
    actionParagraph(spec),
  );
}
function cameraLabel(v) {
  const raw = cleanText(v);
  if (/camera remains locked|camera does not move|locked(?: off)?|static|stationary/i.test(raw))
    return "locked; no camera movement";
  return raw.replace(/^Camera\s*/i, "").replace(/[.!?]+$/, "");
}
function compileSeedanceI2VCompact(spec) {
  const motion = cleanMotionDirection(spec, 62, 3);
  const env = compactEnvironmentMotion(spec, 24, motion.action)
    .replace(/\bflicker(?:s|ing)?\b/gi, "holds a steady even glow")
    .replace(/\bstrobes?\b/gi, "holds steady");
  const camera = explicitCameraMotion(spec) || motion.cameraFromText;
  const audio = compactNativeAudio(spec);
  const calm = requestedStillness(spec) ? "Everything else stays calm and visually stable." : "";
  return [motion.action, env, camera, audio ? `Native audio: ${audio}` : "", calm].filter(Boolean).join(" ");
}
function compileKlingI2VCompact(spec) {
  const motion = cleanMotionDirection(spec, 55, 2);
  const env = compactEnvironmentMotion(spec, 18, motion.action);
  const camera = explicitCameraMotion(spec) || motion.cameraFromText;
  const action = motion.action
    ? `From the supplied starting image, ${lowerFirst(motion.action)}`
    : "Animate only the intended visible movement from the supplied starting image.";
  const cameraSentence =
    camera === "Camera remains locked."
      ? "The camera does not move."
      : camera;
  const audio = compactNativeAudio(spec);
  const visual = compactSentences([action, env, cameraSentence].filter(Boolean).join(" "), 72, 3);
  return [visual, audio ? `Native audio: ${audio}` : ""].filter(Boolean).join(" ");
}
function compileLtxI2VFlowing(spec) {
  const motion = cleanMotionDirection(spec, 85, 3);
  const env = compactEnvironmentMotion(spec, 28, motion.action);
  const camera = explicitCameraMotion(spec) || motion.cameraFromText;
  const duration = Math.max(1, Number(spec.durationSeconds || 5));
  const action = motion.action
    ? `Across the ${duration}-second shot, ${lowerFirst(motion.action)}`
    : `Across the ${duration}-second shot, hold the supplied first-frame composition with only natural micro-motion.`;
  const audio = compactNativeAudio(spec);
  const stillness = requestedStillness(spec)
    ? "The surrounding scene remains still except for the named action."
    : "";
  return [
    "The supplied first frame is the exact opening composition.",
    action,
    env,
    camera,
    stillness,
    audio ? `Synchronize the native audio with the visible action: ${audio}` : "",
    "Maintain the starting identity, geometry, lighting logic, and screen direction throughout.",
  ]
    .filter(Boolean)
    .join(" ");
}
function compileHappyHorseI2VCompact(spec) {
  const motion = cleanMotionDirection(spec, 70, 2);
  const camera = explicitCameraMotion(spec) || motion.cameraFromText;
  const env = compactEnvironmentMotion(spec, 20, motion.action);
  const audio = compactNativeAudio(spec);
  return [
    motion.action
      ? `Visible motion only: ${motion.action}`
      : "Visible motion only: hold the starting pose with restrained natural movement.",
    env ? `Background motion: ${env}` : "",
    camera ? `Camera instruction: ${cameraLabel(camera)}.` : "",
    audio ? `Native audio: ${audio}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
function compileWanI2VCompact(spec) {
  const motion = cleanMotionDirection(spec, 60, 2);
  const env = compactEnvironmentMotion(spec, 20, motion.action);
  const camera = explicitCameraMotion(spec) || motion.cameraFromText;
  const lines = [
    `SUBJECT MOTION: ${motion.action || "Hold the supplied first-frame subject with restrained natural micro-motion."}`,
  ];
  if (env) lines.push(`ENVIRONMENT MOTION: ${env}`);
  else if (requestedStillness(spec))
    lines.push("ENVIRONMENT MOTION: Keep the surrounding scene stable.");
  if (camera) lines.push(`CAMERA: ${cameraLabel(camera)}.`);
  return lines.join("\n");
}
function wanNegative(spec) {
  const base = [
    "unwanted camera movement",
    "warping",
    "morphing",
    "geometry drift",
    "text distortion",
    "motion blur",
  ];
  const custom = (spec.mustAvoid || [])
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 8);
  return unique([...base, ...custom]).join(", ");
}
function wanSettings(spec) {
  const textCritical = /text|document|memo|letter|page|screen|readout/i.test(
    [
      spec.narrativePurpose,
      spec.initialState?.subject,
      actionParagraph(spec),
    ].join(" "),
  );
  return {
    resolution: textCritical ? "1080p" : "project default",
    motionStrength: textCritical ? "low" : "low to medium",
    enhance: false,
    note: textCritical
      ? "Keep text-bearing surfaces flat, still and legible."
      : "Use the lowest motion strength that preserves the intended action.",
  };
}
function compileGenericI2VCompact(spec) {
  const motion = cleanMotionDirection(spec, 65, 2);
  const camera = explicitCameraMotion(spec) || motion.cameraFromText;
  const audio = compactNativeAudio(spec);
  return [motion.action, camera, audio].filter(Boolean).join(" ");
}
function compileCompactFLF(profile, spec) {
  const motion = cleanMotionDirection(spec, 85, 3);
  const env = compactEnvironmentMotion(spec, 22, motion.action);
  const camera = explicitCameraMotion(spec) || motion.cameraFromText;
  const end = cleanText(spec.finalState?.subject);
  const ending =
    end && !motion.action.toLowerCase().includes(end.toLowerCase())
      ? `End in the final-frame state: ${compactSentences(end, 24, 1)}`
      : "End exactly on the supplied final frame.";
  const start =
    profile.family === "kling-3"
      ? "Starting from the supplied first frame,"
      : "From the first frame,";
  const action = motion.action
    ? `${start} ${motion.action.charAt(0).toLowerCase() + motion.action.slice(1)}`
    : `${start} transition naturally to the final frame.`;
  return [action, ending, env, camera].filter(Boolean).join(" ");
}

function canonBlock(spec) {
  return (spec.identityCanon || []).filter(Boolean).join("\n");
}
function driftBlock(spec) {
  return (spec.driftRestatements || []).filter(Boolean).join("\n");
}
function stagingBlock(spec) {
  const lines = (spec.stagingLines || []).map(sentence).filter(Boolean);
  if (!lines.length && cleanText(spec.initialState?.staging)) lines.push(sentence(spec.initialState.staging));
  return unique(lines).join("\n");
}
function mustIncludeText(spec) {
  return (spec.mustInclude || []).filter(Boolean).join("; ");
}
function outputInstruction(spec, fallback = "") {
  const ratio = cleanText(spec.aspectRatio || spec.world?.aspectRatio);
  return ratio ? `Output at ${ratio} and return one production-usable clean frame.` : fallback;
}

function compositionGuideReferences(profile, refs) {
  return (refs || [])
    .map((ref, index) => ({ ref, token: tokenForReference(profile, refs, index) }))
    .filter(({ ref }) => ref.role === "composition");
}
function compositionGuideAdherence(spec, refs) {
  const guide = (refs || []).find((ref) => ref.role === "composition");
  return cleanText(guide?.blockingAdherence || spec.blockingGuideAdherence || "strict");
}
function compositionGuideBlock(profile, spec, refs) {
  const guides = compositionGuideReferences(profile, refs);
  if (!guides.length || spec.purpose === "blocking") return "";
  const adherence = compositionGuideAdherence(spec, refs);
  const adherenceLine = adherence === "loose"
    ? "Use the broad arrangement as inspiration while preserving the intended subject relationships."
    : adherence === "balanced"
      ? "Preserve the major layout and camera structure, allowing only small natural adjustments for anatomy and perspective."
      : "Treat the guide as the authoritative base canvas. Preserve its exact crop, camera position, staged screen positions, relative scale, depth order, facing directions, spacing, and visible boundaries.";
  const labels = guides.map(({ token, ref }) => `${token} (${ref.label || "blocking guide"})`).join(", ");
  return `COMPOSITION GUIDE\n${labels} ${guides.length === 1 ? "is" : "are"} blocking or animatic geometry guidance, not visual identity or location-design reference${guides.length === 1 ? "" : "s"}. ${adherenceLine}\nUse ${guides.length === 1 ? "it" : "them"} only for crop, camera, horizon, broad depth bands, subject positions, relative scale, rough pose/facing, spacing, overlap, silhouette occupancy, and key contact points. Take no identity, wardrobe, anatomy detail, material, colour, texture, lighting, style, era, architecture, fence or gate pattern, terrain detail, set dressing, background-object arrangement, window placement, or door placement from ${guides.length === 1 ? "it" : "them"}. Reconstruct the finished location from approved location references and location canon. Do not render any text, labels, lettering, guide marks, or storyboard notation from ${guides.length === 1 ? "it" : "them"} into the output.`;
}
function referenceViewPhrase(ref) {
  const value = cleanText(ref?.selectedView || ref?.angleTag);
  if (!value) return "";
  const normalized = value.replace(/-/g, " ");
  return normalized === "multi angle" ? "the shot-matching view" : `the ${normalized} view`;
}
function referenceMetadataFence(ref) {
  const kind = cleanText(ref?.referenceKind || "");
  const view = referenceViewPhrase(ref);
  const detail = cleanText(ref?.detailRegion);
  const available = cleanText(ref?.availableAngles);
  const lines = [];
  if (kind === "contact-sheet" || kind === "turnaround") {
    lines.push(`This is a ${kind === "contact-sheet" ? "multi-angle contact sheet" : "turnaround reference"}.`);
    if (view) lines.push(`Use only ${view} or its corresponding panel for this shot.`);
    if (available) lines.push(`Available views are ${available}.`);
    lines.push("Do not reproduce the sheet layout, panel borders, labels, or multiple angles in the output.");
  } else if (kind === "detail") {
    lines.push(`Use only for ${detail || view || "the specified detail region"}.`);
    lines.push("Do not inherit the source image's wider framing or background.");
  } else if (view) {
    lines.push(`Use ${view} for this shot.`);
  }
  if (detail && kind !== "detail") lines.push(`Prioritize the ${detail} region.`);
  if (cleanText(ref?.guideRegion)) lines.push(`Apply this reference only to the ${cleanText(ref.guideRegion)} region defined by the composition guide.`);
  return lines.join(" ");
}
function appearanceReferenceInstruction(ref) {
  const label = cleanText(ref.entityName || ref.displayName || ref.label || ref.name || "the referenced element");
  const role = cleanText(ref.role || "reference");
  const metadata = referenceMetadataFence(ref);
  const original = cleanText(ref.instruction);
  let contract = "";
  if (role === "composition")
    contract = "Blocking/animatic geometry only. Use for canvas, crop, camera, horizon, broad depth bands, subject position, relative scale, rough pose/facing, spacing, overlap, silhouette occupancy, and contact points. Do not use for identity, finished anatomy, style, material, lighting, colour, architecture, fence or gate pattern, terrain, set dressing, background-object arrangement, or visible text. Rebuild the finished location from approved location references and canon.";
  else if (["prop", "scale", "alternate-view"].includes(role) || (["detail", "turnaround", "reference-sheet"].includes(role) && ref.sourceType === "prop"))
    contract = `Appearance only for ${label}: preserve the exact design, proportions, materials, colour, wear, and relevant view. Do not copy this reference's full-object framing, camera, crop, background, or scale-in-frame; place it only where the composition guide specifies.`;
  else if (["base", "location", "lighting"].includes(role) || ref.sourceType === "location")
    contract = `Location design authority for ${label}: use this reference for the finished architecture, fence or gate design, terrain, surfaces, set dressing, materials, colour, texture, and lighting inside the background area visible in the composition guide. Replace any rough environmental shapes, repeated patterns, or placeholder structure shown by the blocking guide. Keep only the guide's crop, horizon, broad occupancy, and depth relationship; do not widen the shot or copy this reference's camera framing.`;
  else if (["identity", "body", "outfit", "costume", "expression", "pose", "turnaround", "detail", "reference-sheet", "continuity-state"].includes(role))
    contract = `Appearance only for ${label}: preserve the assigned identity, anatomy, wardrobe, expression, or continuity details. Do not copy this reference's camera, crop, scale-in-frame, background, or layout; place the character only where the composition guide specifies.`;
  else contract = `Use ${label} only for its assigned appearance details. Do not copy its camera, crop, background, or composition.`;
  return unique([contract, metadata, original]).join(" ");
}
function prepareImageReferences(spec, refs) {
  if (spec.purpose === "blocking") return [];
  const source = refs || [];
  const hasGuide = source.some((ref) => ref.role === "composition");
  if (!hasGuide) return source.map((ref) => ({ ...ref }));
  const mapped = source.map((ref) => ({
    ...ref,
    instruction: appearanceReferenceInstruction(ref),
  }));
  const guides = mapped.filter((ref) => ref.role === "composition");
  return [...guides, ...mapped.filter((ref) => ref.role !== "composition")];
}
function visualGroundingBlock(profile, spec, refs) {
  const lines = (spec.visualGrounding || []).map((item) => {
    const index = (refs || []).findIndex((ref) => ref.key === item.referenceKey || cleanText(ref.entityId) === cleanText(item.entityId));
    if (index < 0) return "";
    const token = tokenForReference(profile, refs, index);
    return `${token} is the visual canon for ${item.name}. Use that image instead of generic text for the entity's visible design.`;
  }).filter(Boolean);
  return unique(lines).join("\n");
}
function isMotionOnlyStillConstraint(value) {
  const text = cleanText(value);
  return /\bduration\b/i.test(text) || /\b\d+(?:\.\d+)?\s*(?:second|seconds|sec|s)\b.*\b(?:motion|action|continuous|clip|shot)\b/i.test(text) || /\bcontinuous\s+(?:reverse\s+)?(?:crush\s+)?action\b/i.test(text) || /\blip[ -]?sync\b/i.test(text);
}
function stillPreserveText(spec) {
  return (spec.mustPreserve || []).filter((item) => !isMotionOnlyStillConstraint(item)).join("; ");
}
function stillAvoidText(spec) {
  return (spec.mustAvoid || []).filter((item) => !isMotionOnlyStillConstraint(item)).join("; ");
}
function guidePlacementInstruction(profile, spec, refs, ref, index) {
  const placement = (spec.guidePlacements || []).find((item) => item.referenceKey === ref.key);
  if (!placement) {
    if (cleanText(ref.guideRegion))
      return `Apply only to the ${cleanText(ref.guideRegion)} region defined by the composition guide. Preserve that region's boundary, crop, scale, and depth; do not copy the source framing or background.`;
    if (ref.role === "location" || ref.sourceType === "location")
      return `Reconstruct the true environment inside the limited background region visible in the guide. Use this reference for architecture, fence or gate pattern, terrain, surfaces, set dressing, materials, colour, texture, and lighting. Replace the guide's rough environmental shapes and repeated patterns; preserve only its broad occupancy, horizon, depth, and crop. Do not expand the location.`;
    return `Control only the corresponding ${ref.role || "subject"} placeholder's finished appearance; do not copy its source framing or reveal more of the element than the guide shows.`;
  }
  const size = placement.widthPercent ? `, occupying about ${placement.widthPercent} percent of frame width` : "";
  const view = placement.view ? `, shown from ${placement.view}` : "";
  const note = placement.notes ? ` ${sentence(placement.notes)}` : "";
  const locationRule = ref.role === "location" || ref.sourceType === "location"
    ? " Rebuild the location's actual architecture, fence or gate pattern, terrain, surfaces, and set dressing from this reference rather than tracing the blocking guide's rough background pattern."
    : "";
  return `Apply only to ${placement.label} region in the ${placement.depth}, ${placement.horizontal}, ${placement.vertical}${size}${view}. Preserve the guide's broad region boundary and crop.${locationRule}${note}`;
}
function guideAppearanceAssignments(profile, spec, refs) {
  return (refs || []).map((ref, index) => {
    if (ref.role === "composition") return "";
    const token = tokenForReference(profile, refs, index);
    const label = cleanText(ref.entityName || ref.displayName || ref.label || ref.name || "Reference");
    return `${token} — ${label}: ${guidePlacementInstruction(profile, spec, refs, ref, index)}`;
  }).filter(Boolean).join("\n");
}
function cleanStillSubject(value) {
  return compactSentences(cleanText(value)
    .replace(/\bDuration constrained to exactly[^.;]*[.;]?/gi, " ")
    .replace(/\bexactly\s+\d+(?:\.\d+)?\s*seconds?[^.;]*[.;]?/gi, " ")
    .replace(/\s+/g, " "), 95, 4);
}
function compileGuideBasedImage(profile, spec, refs) {
  const guides = compositionGuideReferences(profile, refs);
  if (!guides.length) return "";
  const guideToken = guides[0].token;
  const adherence = compositionGuideAdherence(spec, refs);
  const strict = adherence === "strict";
  const structure = strict
    ? `Use ${guideToken} as an editable geometric scaffold and transform it into the final production frame. Preserve its exact crop, camera position, horizon, broad depth bands, dominant subject scale, key contact points, screen positions, spacing, rough pose/facing, overlap, and depth order. The guide overrides conflicting camera, crop, layout, or full-scene wording elsewhere in project metadata. Do not widen, zoom out, reframe, reveal more of an object, or expand the location beyond the visible area. The guide does not define finished architecture, fence or gate pattern, terrain, set dressing, or background-object arrangement.`
    : adherence === "balanced"
      ? `Use ${guideToken} as a geometric scaffold. Preserve its major crop, camera, horizon, subject positions, relative scale, contact points, and depth order, allowing small natural corrections for anatomy and perspective. Do not substantially widen or recompose the shot. Rebuild all finished location structure from approved location references and canon rather than tracing the guide's rough background shapes.`
      : `Use ${guideToken} only for the broad composition and subject relationships while retaining the shot's intended close/medium/wide emphasis. Do not inherit its environment design or background patterns.`;
  const grounding = visualGroundingBlock(profile, spec, refs);
  const assignments = guideAppearanceAssignments(profile, spec, refs);
  const subject = cleanStillSubject(spec.initialState?.subject || actionParagraph(spec));
  const include = (spec.mustInclude || []).filter((item) => !isMotionOnlyStillConstraint(item)).join("; ");
  const environment = cleanStillSubject(spec.initialState?.environment);
  const style = cleanText(styleText(spec));
  const preserve = stillPreserveText(spec);
  const avoid = stillAvoidText(spec);
  const ratio = cleanText(spec.aspectRatio || spec.world?.aspectRatio);
  return [
    `EDIT THE BLOCKING GUIDE — shot ${spec.shotId}`,
    `COMPOSITION GUIDE\n${structure}`,
    `REFERENCE ASSIGNMENT\n${refLegend(profile, refs)}`,
    grounding ? `VISUAL GROUNDING\n${grounding}` : "",
    assignments ? `REPLACE GUIDE PLACEHOLDERS\n${assignments}` : "",
    subject ? `FINISHED FRAME CONTENT\n${sentence(subject)}` : "",
    include ? `MUST INCLUDE\n${include}. Include each required element only within the area and crop established by ${guideToken}; do not widen the frame to make it more visible.` : "",
    environment ? `VISIBLE ENVIRONMENT ONLY\n${sentence(environment)} Apply this only inside the background area already visible in ${guideToken}; do not reveal more of the location.` : "",
    style ? `RENDERING\n${style}` : "",
    preserve ? `PRESERVE\n${preserve}.` : "",
    `GUIDE EXCLUSIONS\nTake no identity, wardrobe, anatomy detail, material, colour, texture, lighting, style, era, architecture, fence spacing, gate pattern, terrain detail, set dressing, background-object arrangement, window placement, door placement, labels, lettering, or guide marks from ${guideToken}. Do not trace or preserve rough environmental shapes or repeated background patterns from the guide. Rebuild the finished location from approved location references and location canon while retaining only the guide's crop, horizon, broad occupancy, depth, subject geometry, and contact points. Do not render any text, labels, lettering, guide marks, or storyboard notation from the guide. Do not copy the framing or background of any appearance reference.`,
    avoid ? `AVOID\n${avoid}.` : "",
    `OUTPUT\n${ratio ? `${ratio}. ` : ""}Return one clean production still matching the guide's structure.`,
  ].filter(Boolean).join("\n\n");
}
function blockingLayoutBlock(spec) {
  const labelPattern = /\s+labelled\s+"[^"]+"/gi;
  const cleanBlockingLine = (value) => sentence(spec.blockingLabels === false ? cleanText(value).replace(labelPattern, "") : value);
  const lines = (spec.stagingLines || []).map(cleanBlockingLine).filter(Boolean);
  if (!(spec.blockingPlan?.layoutLines || []).length) {
    const narrative = cleanBlockingLine(spec.initialState?.subject || spec.narrativePurpose);
    if (narrative && !lines.some((line) => clause(line).toLowerCase() === clause(narrative).toLowerCase()))
      lines.unshift(narrative);
  }
  const environment = cleanBlockingLine(spec.initialState?.environment);
  if (environment) lines.push(environment);
  return unique(lines).join("\n");
}

function compileImage(profile, spec, refs) {
  const legend = refLegend(profile, refs);
  const guide = compositionGuideBlock(profile, spec, refs);
  const base = (refs || []).find((r) => r.role === "composition") || (refs || []).find((r) => r.role === "base" || r.role === "first-frame") || refs?.[0];
  const baseToken = base ? tokenFor(profile, refs.indexOf(base) + 1, base.token) : "#image1";
  const purposeLabel = IMAGE_PURPOSE_LABELS[spec.purpose] || "production frame";
  const camera = [spec.camera?.framing, spec.camera?.lensIntent].map(clause).filter(Boolean).join(". ");
  const staging = stagingBlock(spec);
  const canon = canonBlock(spec);
  const drift = driftBlock(spec);
  const include = mustIncludeText(spec);
  const preserve = stillPreserveText(spec);
  const avoid = stillAvoidText(spec);
  const ratio = cleanText(spec.aspectRatio || spec.world?.aspectRatio);
  const output = outputInstruction(spec, ratio ? `Output at ${ratio} and return one clean production-usable image.` : `Return one clean production-usable image.`);
  if (spec.purpose === "blocking" || profile.mode === "blocking") {
    const layout = blockingLayoutBlock(spec);
    const labels = spec.blockingLabels === false
      ? "Do not render text or labels. Use distinct simple silhouettes for each element."
      : "Render each requested element label exactly as written, in small plain block capitals, placed on or directly beside the element it names. Render no other text anywhere in the frame.";
    return [
      `BLOCKING FRAME — shot ${spec.shotId}`,
      `STYLE CONTRACT\nFlat greyscale storyboard blocking. Simple masses, clear silhouettes, readable depth separation. No texture, material detail, lighting design, photographic rendering, facial detail, production wardrobe, or finished visual style.`,
      camera
        ? `FRAME\n${sentence(camera)}`
        : `FRAME\nUse a clear, readable storyboard camera position appropriate to the shot beat.`,
      layout
        ? `LAYOUT\n${layout}`
        : `LAYOUT\nArrange simple labelled placeholders to communicate the shot beat and spatial relationships.`,
      `LABELS\n${labels}`,
      `OUTPUT\n${ratio ? `${ratio}. ` : ""}One flat greyscale blocking frame.`,
    ].filter(Boolean).join("\n\n");
  }
  const guideBased = compileGuideBasedImage(profile, spec, refs);
  if (guideBased) return guideBased;

  if (profile.strategy.includes("change") || profile.mode === "edit") {
    const change = sentence(actionParagraph(spec) || spec.finalState?.subject || spec.narrativePurpose);
    const keep = preserve || "the composition, crop, lighting, background, subject identity, pose, geometry, color, texture, props, and every unmentioned detail";
    if (profile.family === "flux-2") {
      return [
        legend ? `REFERENCES\n${legend}` : "",
        guide,
        `BASE\n${baseToken} is the editable source frame.`,
        canon ? `CANON\n${canon}` : "",
        drift ? `VERIFY\n${drift}` : "",
        `CHANGE\n${change}`,
        staging ? `PLACEMENT\n${staging}` : "",
        camera ? `CAMERA\n${sentence(camera)}` : "",
        include ? `MUST INCLUDE\n${include}` : "",
        `PRESERVE\n${keep}. Keep every unmentioned object, texture, and screen position stable.`,
        `CONSTRAINTS\nDo not mirror, restage, or reframe. Do not replace unaffected content.${avoid ? ` Avoid: ${avoid}.` : ""}`,
        `OUTPUT\nReturn one clean production frame at the source aspect ratio.`,
      ].filter(Boolean).join("\n\n");
    }
    return [
      legend ? `ATTACHED REFERENCES\n${legend}` : "",
      guide,
      canon ? `IDENTITY CANON\n${canon}` : "",
      drift ? `RESTATE (drift-prone, verify in output)\n${drift}` : "",
      `BASE IMAGE\nEdit ${baseToken}. Keep everything identical and change ONLY this: ${change}`,
      staging ? `STAGING\n${staging}` : "",
      camera ? `CAMERA\n${sentence(camera)}` : "",
      include ? `MUST INCLUDE\n${include}` : "",
      `KEEP UNCHANGED\n${keep}.`,
      `EDIT CONSTRAINTS\nDo NOT mirror the image. Do NOT move the subject or create replacement objects unless the requested change explicitly requires it.`,
      avoid ? `ALSO AVOID\n${avoid}.` : "",
      `OUTPUT\nReturn one clean production frame at the source aspect ratio.`,
    ].filter(Boolean).join("\n\n");
  }

  if (profile.family === "gpt-image-2") {
    return [
      legend ? `REFERENCE LEGEND\n${legend}` : "",
      guide,
      `PURPOSE\nCreate the ${purposeLabel} for shot ${spec.shotId}.`,
      canon ? `IDENTITY CANON\n${canon}` : "",
      drift ? `VERIFY DRIFT-PRONE DETAILS\n${drift}` : "",
      spec.narrativePurpose ? `SUBJECT AND PERFORMANCE\n${sentence(spec.narrativePurpose)}` : "",
      spec.initialState?.subject ? sentence(spec.initialState.subject) : "",
      staging ? `COMPOSITION AND STAGING\n${staging}` : "",
      camera ? `CAMERA\n${sentence(camera)}` : "",
      include ? `MUST INCLUDE\n${include}` : "",
      spec.initialState?.environment ? `ENVIRONMENT AND PROPS\n${sentence(spec.initialState.environment)}` : "",
      styleText(spec) ? `LIGHTING AND STYLE\n${styleText(spec)}` : "",
      preserve ? `CONTINUITY\nPreserve exactly: ${preserve}.` : "",
      avoid ? `EXCLUSIONS\nDo not include or change: ${avoid}.` : "",
      `OUTPUT\n${output}`,
    ].filter(Boolean).join("\n\n");
  }

  if (["nano-banana-2", "nano-banana-pro"].includes(profile.family)) {
    return [
      legend ? `REFERENCE ASSIGNMENT\n${legend}` : "",
      guide,
      `PRODUCTION OBJECTIVE\nCreate the ${purposeLabel} for shot ${spec.shotId}. ${sentence(spec.narrativePurpose || spec.initialState?.subject || "")}`.trim(),
      canon ? `CANON CONSTRAINTS\n${canon}` : "",
      staging ? `COMPOSITION\n${staging}` : "",
      camera ? `CAMERA\n${sentence(camera)}` : "",
      spec.initialState?.environment ? `ENVIRONMENT\n${sentence(spec.initialState.environment)}` : "",
      include ? `REQUIRED DETAILS\n${include}` : "",
      styleText(spec) ? `ART DIRECTION\n${styleText(spec)}` : "",
      preserve ? `PRESERVATION\n${preserve}.` : "",
      avoid ? `AVOID\n${avoid}.` : "",
      `OUTPUT\n${output}`,
    ].filter(Boolean).join("\n\n");
  }

  if (profile.family === "flux-2") {
    return [
      legend ? `REFERENCE ROLES\n${legend}` : "",
      guide,
      `SCENE\n${sentence(spec.initialState?.subject || spec.narrativePurpose || `Create the ${purposeLabel} for shot ${spec.shotId}`)}`,
      staging ? `SPATIAL COMPOSITION\n${staging}` : "",
      include ? `SUBJECTS AND REQUIRED OBJECTS\n${include}` : "",
      spec.initialState?.environment ? `MATERIALS AND ENVIRONMENT\n${sentence(spec.initialState.environment)}` : "",
      camera ? `CAMERA\n${sentence(camera)}` : "",
      styleText(spec) ? `LIGHTING / STYLE\n${styleText(spec)}` : "",
      canon ? `CONTINUITY ANCHORS\n${canon}` : "",
      drift ? `VERIFY\n${drift}` : "",
      preserve ? `PRESERVE\n${preserve}.` : "",
      avoid ? `CONSTRAINTS\n${avoid}.` : "",
      `OUTPUT\n${output}`,
    ].filter(Boolean).join("\n\n");
  }

  if (profile.family === "seedream-5-pro") {
    return [
      legend ? `REFERENCE ASSIGNMENT\n${legend}` : "",
      guide,
      `OBJECTIVE\nCreate the ${purposeLabel} for shot ${spec.shotId}.`,
      spec.initialState?.subject ? `SUBJECTS\n${sentence(spec.initialState.subject)}` : "",
      staging ? `LAYOUT\n${staging}` : "",
      camera ? `CAMERA\n${sentence(camera)}` : "",
      spec.initialState?.environment ? `ENVIRONMENT\n${sentence(spec.initialState.environment)}` : "",
      styleText(spec) ? `ART DIRECTION\n${styleText(spec)}` : "",
      canon ? `CONTINUITY\n${canon}` : "",
      preserve ? `PRESERVE\n${preserve}.` : "",
      avoid ? `AVOID\n${avoid}.` : "",
      `OUTPUT\n${output}`,
    ].filter(Boolean).join("\n\n");
  }

  if (profile.family === "krea-2" && !["edit", "multi-reference"].includes(profile.mode)) {
    return [
      legend ? `STYLE / CONTENT REFERENCES\n${legend}` : "",
      guide,
      canon ? `IDENTITY CANON\n${canon}` : "",
      drift ? `RESTATE (drift-prone, verify in output)\n${drift}` : "",
      `CONTENT\n${spec.initialState?.subject || spec.narrativePurpose}`,
      staging ? `COMPOSITION\n${staging}` : "",
      camera ? `CAMERA\n${sentence(camera)}` : "",
      include ? `MUST INCLUDE\n${include}` : "",
      `ART DIRECTION\n${styleText(spec) || spec.initialState?.environment || ""}`,
      `CONTINUITY\n${preserve || canon || "Preserve approved content references and do not import subjects from style-only references."}`,
      `AVOID\n${avoid || "Do not reproduce subjects or objects from style-only references."}\nDo not reproduce subjects or objects from style-only references.`,
      `OUTPUT\n${ratio ? `Aspect ratio: ${ratio}. ` : ""}One clean production-usable image.`,
    ].filter(Boolean).join("\n\n");
  }

  const common = [
    `Create the ${purposeLabel} for shot ${spec.shotId}.`,
    guide,
    canon ? `IDENTITY CANON\n${canon}` : "",
    drift ? `RESTATE (drift-prone, verify in output)\n${drift}` : "",
    spec.narrativePurpose ? sentence(spec.narrativePurpose) : "",
    spec.initialState?.subject ? sentence(spec.initialState.subject) : "",
    staging ? `STAGING\n${staging}` : "",
    camera ? `CAMERA\n${sentence(camera)}` : "",
    include ? `MUST INCLUDE\n${include}` : "",
    spec.initialState?.environment ? `ENVIRONMENT\n${sentence(spec.initialState.environment)}` : "",
    styleText(spec) ? `APPROVED VISUAL STYLE\n${styleText(spec)}` : "",
    preserve ? `PRESERVE EXACTLY\n${preserve}.` : "",
    avoid ? `DO NOT INCLUDE OR CHANGE\n${avoid}.` : "",
    output,
  ].filter(Boolean).join("\n\n");
  return [legend ? `REFERENCE ASSIGNMENT\n${legend}` : "", common].filter(Boolean).join("\n\n");
}
function seedanceOmniTokens(profile, refs, roles = [], mediaType = "") {
  return (refs || [])
    .map((r, i) => ({ r, token: tokenForReference(profile, refs, i) }))
    .filter(({ r }) => (!roles.length || roles.includes(r.role)) && (!mediaType || referenceMediaType(r) === mediaType))
    .map(({ token }) => token);
}
function compileSeedanceOmni(profile, spec, refs) {
  const legend = refLegend(profile, refs),
    duration = Math.max(1, Number(spec.durationSeconds || 5)),
    action = sentence(actionParagraph(spec) || spec.narrativePurpose),
    camera = explicitCameraMotion(spec),
    staging = clause(spec.initialState?.staging),
    env = (spec.environmentMotion || []).filter(Boolean).join("; "),
    audio = audioText(spec),
    preserve = preserveText(spec),
    avoid = avoidText(spec),
    opening = seedanceOmniTokens(profile, refs, ["base", "first-frame", "composition"]),
    ending = seedanceOmniTokens(profile, refs, ["last-frame", "end-frame"]),
    identity = seedanceOmniTokens(profile, refs, ["identity", "costume", "outfit", "expression", "body", "pose", "turnaround", "detail", "reference-sheet", "prop", "scale", "location", "alternate-view", "lighting", "continuity-state"]),
    motion = seedanceOmniTokens(profile, refs, ["motion-reference", "source-video", "camera-reference", "performance-reference"], "video"),
    sound = seedanceOmniTokens(profile, refs, ["audio-timing", "sound-reference"], "audio"),
    soundDirection = sound.length
      ? (/lip-sync|speaks? the lines|speaking character/i.test(audio)
          ? `${sentence(audio)} Use ${sound.join(", ")} as dialogue audio. Lip-sync only the selected speaking character to its words; every other visible character remains silent.`
          : `Synchronize performance, rhythm, and sound events to ${sound.join(", ")}. ${audio ? sentence(audio) : "Use only the timing or sound relationship assigned to each audio reference."}`)
      : audio ? `Audio: ${sentence(audio)}` : "";
  const director = [
    `Create one continuous ${duration}-second shot.`,
    opening.length ? `Use ${opening.join(", ")} as the approved opening composition.` : "",
    !opening.length && staging ? `Stage the shot as follows: ${sentence(staging)}` : "",
    ending.length ? `Progress naturally toward the endpoint composition assigned to ${ending.join(", ")}; do not cut or dissolve unless explicitly requested.` : "",
    action,
    camera,
    env ? `Environmental motion: ${sentence(env)}` : "",
    identity.length ? `Use ${identity.join(", ")} only for their assigned identity, wardrobe, expression, anatomy, pose, prop, location, lighting, or continuity details; do not copy their framing unless the role says composition.` : "",
    motion.length ? `Use ${motion.join(", ")} only for the assigned performance, physical motion, effect timing, or camera behavior; adapt the movement to this shot rather than copying its subjects or setting.` : "",
    preserve ? `Preserve: ${sentence(preserve)}` : "",
    avoid ? `Avoid: ${sentence(avoid)}` : "",
  ].filter(Boolean).join(" ");
  // Audio is an operational input. Append it after compaction so the native
  // audio assignment and speaker lock can never be trimmed from the package.
  const compactDirector = compactSentences(director, soundDirection ? 180 : 210, soundDirection ? 8 : 9);
  const finalDirector = [compactDirector, soundDirection].filter(Boolean).join(" ");
  return [legend ? `OMNI REFERENCE CONTRACT\n${legend}` : "", `DIRECTOR PROMPT\n${finalDirector}`]
    .filter(Boolean)
    .join("\n\n");
}



function compactCharacters(value, maxCharacters = 120) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (!text || text.length <= maxCharacters) return text;
  const slice = text.slice(0, Math.max(1, maxCharacters - 1));
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf(", "), slice.lastIndexOf(" "));
  return `${(boundary > maxCharacters * 0.55 ? slice.slice(0, boundary) : slice).replace(/[\s,;:.]+$/g, "")}…`;
}
function minimaxH3SectionParts(chunk) {
  const text = cleanText(chunk);
  const newline = text.indexOf("\n");
  return newline < 0
    ? { title: text, body: "" }
    : { title: text.slice(0, newline).trim(), body: text.slice(newline + 1).trim() };
}
function minimaxH3TrimBody(title, body, limit) {
  if (!body || body.length <= limit) return body;
  const lines = body.split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  if (lines.length > 1 && /REFERENCE JOB MAP|TIMED|SHOT LIST/i.test(title)) {
    const perLine = Math.max(24, Math.floor((limit - Math.max(0, lines.length - 1)) / lines.length));
    return lines.map((line) => compactCharacters(line, perLine)).join("\n");
  }
  return compactCharacters(body, limit);
}
/* ONE INSTRUCTION, EMITTED ONCE.
 *
 * The founder smoke reported the H3 motion/transition instruction appearing twice
 * in one compiled prompt. It can: the shot's written motion direction and the H3
 * sequence/transition note are separate fields that a filmmaker reasonably fills in
 * with the same sentence, and they are concatenated into one directive before
 * compilation — after which a section body can repeat an earlier one verbatim.
 *
 * Duplicate instruction emission is a defect, so it is refused at the compiler,
 * which is the one place every H3 mode passes through. Comparison is on the
 * normalised body: an identical body under a different heading is still the model
 * being told the same thing twice, and it costs prompt budget that the character
 * allocation below then has to take from something that was said only once.
 *
 * A heading with no body is never dropped — those are contracts, not instructions,
 * and two of them are never the same string anyway. */
function minimaxH3DedupeSections(sections) {
  const seen = new Set();
  return sections.filter((section) => {
    const body = String(section.body || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!body) return true;
    if (seen.has(body)) return false;
    seen.add(body);
    return true;
  });
}
function finalizeMinimaxH3Prompt(chunks, maxCharacters = 2000) {
  const sections = minimaxH3DedupeSections((chunks || []).filter(Boolean).map(minimaxH3SectionParts));
  const direct = sections.map(({ title, body }) => body ? `${title}\n${body}` : title).join("\n\n");
  if (direct.length <= maxCharacters) return direct;

  // Keep every semantic section present while compacting verbose planning text.
  // Reference maps and timed lists are line-aware so all numbered inputs and
  // beats survive instead of being cut off at the end of the prompt.
  const weights = (title) => {
    if (/REFERENCE JOB MAP/i.test(title)) return 2.2;
    if (/SEQUENTIAL KEYFRAME|ENDPOINT|OPENING FRAME/i.test(title)) return 1.7;
    if (/TIMED|SHOT LIST|ACTION|MOTION|TRANSITION/i.test(title)) return 2.0;
    if (/AUDIO/i.test(title)) return 1.35;
    if (/PRESERVE|CONTINUITY|AVOID/i.test(title)) return 1.45;
    if (/CAMERA|PERFORMANCE/i.test(title)) return 1.1;
    return 0.9;
  };
  const titleOverhead = sections.reduce((sum, section, index) => sum + section.title.length + (section.body ? 1 : 0) + (index ? 2 : 0), 0);
  const bodyBudget = Math.max(0, maxCharacters - titleOverhead);
  const rows = sections.map((section) => ({ ...section, weight: weights(section.title), allocation: 0 }));
  let remaining = bodyBudget;
  let active = rows.filter((row) => row.body.length);
  while (remaining > 0 && active.length) {
    const totalWeight = active.reduce((sum, row) => sum + row.weight, 0) || 1;
    let used = 0;
    for (const row of active) {
      const share = Math.max(1, Math.floor(remaining * row.weight / totalWeight));
      const need = row.body.length - row.allocation;
      const add = Math.min(need, share);
      row.allocation += add;
      used += add;
    }
    if (!used) break;
    remaining -= used;
    active = active.filter((row) => row.allocation < row.body.length);
  }
  let compacted = rows.map(({ title, body, allocation }) => {
    const trimmed = body ? minimaxH3TrimBody(title, body, Math.max(1, allocation)) : "";
    return trimmed ? `${title}\n${trimmed}` : title;
  }).join("\n\n");
  if (compacted.length > maxCharacters) compacted = compacted.slice(0, maxCharacters).replace(/[\s,;:.]+$/g, "");
  return compacted;
}

const MINIMAX_H3_SEQUENCE_ROLES = new Set([
  "sequential-keyframe",
  "keyframe",
  "first-frame",
  "last-frame",
  "end-frame",
  "mid-frame",
  "waypoint",
]);
function minimaxH3IsSequenceReference(ref) {
  return referenceMediaType(ref) === "image" && MINIMAX_H3_SEQUENCE_ROLES.has(cleanText(ref?.role));
}

function minimaxH3TimedBlocks(spec) {
  const duration = Math.max(5, Math.min(15, Number(spec.durationSeconds || 5)));
  const actions = Array.isArray(spec.actions) ? spec.actions.filter((item) => cleanText(item?.action)) : [];
  if (!actions.length) return sentence(actionParagraph(spec) || spec.narrativePurpose);
  return actions.map((item, index) => {
    const start = Math.max(0, Number(item.start ?? (index * duration / actions.length)) || 0);
    const end = Math.max(start, Math.min(duration, Number(item.end ?? ((index + 1) * duration / actions.length)) || duration));
    return `[${Number.isInteger(start) ? start : start.toFixed(1)}–${Number.isInteger(end) ? end : end.toFixed(1)} seconds] ${sentence(item.action)}`;
  }).join("\n");
}
function minimaxH3ReferenceMap(profile, refs) {
  return (refs || []).map((ref, index) => {
    const token = tokenForReference(profile, refs, index);
    const role = cleanText(ref.role || "reference").replace(/-/g, " ");
    const label = compactCharacters(ref.label || ref.name || role, 34);
    const job = compactCharacters(ref.instruction || `Use only for ${role}.`, 76);
    return `${token} — ${label}: ${job}`;
  }).join("\n");
}
function compileMinimaxH3(profile, spec, refs) {
  const duration = Math.max(5, Math.min(15, Number(spec.durationSeconds || 5)));
  const action = sentence(actionParagraph(spec) || spec.narrativePurpose);
  const timed = minimaxH3TimedBlocks(spec);
  const camera = explicitCameraMotion(spec);
  const env = (spec.environmentMotion || []).filter(Boolean).join("; ");
  const preserve = preserveText(spec);
  const avoid = avoidText(spec);
  const audio = audioText(spec);
  const voice = voiceText(spec);
  const map = minimaxH3ReferenceMap(profile, refs);
  const imageRefs = (refs || []).filter((ref) => referenceMediaType(ref) === "image");
  const videoRefs = (refs || []).filter((ref) => referenceMediaType(ref) === "video");
  const audioRefs = (refs || []).filter((ref) => referenceMediaType(ref) === "audio");
  const sequence = imageRefs.filter(minimaxH3IsSequenceReference);
  const hasMultipleBeats = (spec.actions || []).filter((item) => cleanText(item?.action)).length > 1 || sequence.length > 2;
  if (profile.mode === "t2v") {
    return finalizeMinimaxH3Prompt([
      `MINIMAX H3 SHOT — ${duration} SECONDS`,
      spec.narrativePurpose ? `PRODUCTION OBJECTIVE\n${sentence(spec.narrativePurpose)}` : "",
      hasMultipleBeats ? `TIMED SHOT LIST\n${timed}` : `ACTION\n${action}`,
      camera ? `CAMERA\n${camera}` : "",
      env ? `ENVIRONMENT MOTION\n${sentence(env)}` : "",
      audio || voice ? `NATIVE STEREO AUDIO\n${[audio, voice].filter(Boolean).join(" ")}` : "",
      preserve ? `CONTINUITY\nPreserve: ${sentence(preserve)}` : "",
      avoid ? `AVOID\n${sentence(avoid)}` : "",
    ].filter(Boolean), Number(profile.limits?.maxPromptCharacters || 2000));
  }
  if (profile.mode === "i2v") {
    return finalizeMinimaxH3Prompt([
      `MINIMAX H3 IMAGE-TO-VIDEO — ${duration} SECONDS`,
      `OPENING FRAME CONTRACT\nImage 1 is the exact opening frame. Begin from it without replacing, restaging, mirroring, or reframing the composition.`,
      hasMultipleBeats ? `TIMED MOTION\n${timed}` : `MOTION\n${action}`,
      camera ? `CAMERA\n${camera}` : "",
      env ? `ENVIRONMENT MOTION\n${sentence(env)}` : "",
      audio || voice ? `NATIVE STEREO AUDIO\n${[audio, voice].filter(Boolean).join(" ")}` : "",
      preserve ? `PRESERVE\n${sentence(preserve)}` : "",
      avoid ? `AVOID\n${sentence(avoid)}` : "",
    ].filter(Boolean), Number(profile.limits?.maxPromptCharacters || 2000));
  }
  if (profile.mode === "flf") {
    return finalizeMinimaxH3Prompt([
      `MINIMAX H3 FIRST / LAST FRAME — ${duration} SECONDS`,
      `ENDPOINT CONTRACT\nImage 1 is the exact first frame. Image 2 is the exact final frame. Create one physically plausible continuous bridge between them and finish on Image 2 without a cut, dissolve, or unrelated detour unless explicitly requested.`,
      hasMultipleBeats ? `TRANSITION TIMING\n${timed}` : `TRANSITION\n${action}`,
      camera ? `CAMERA PATH\n${camera}` : "",
      env ? `ENVIRONMENT CHANGE\n${sentence(env)}` : "",
      audio || voice ? `NATIVE STEREO AUDIO\n${[audio, voice].filter(Boolean).join(" ")}` : "",
      preserve ? `PRESERVE\n${sentence(preserve)}` : "",
      avoid ? `AVOID\n${sentence(avoid)}` : "",
    ].filter(Boolean), Number(profile.limits?.maxPromptCharacters || 2000));
  }
  const sequenceTokens = (refs || []).map((ref, index) => ({ ref, token: tokenForReference(profile, refs, index) }))
    .filter(({ ref }) => minimaxH3IsSequenceReference(ref));
  const sequenceLine = sequenceTokens.length > 1
    ? `Use ${sequenceTokens.map((item) => item.token).join(", ")} as sequential keyframes in this exact order. Treat them as temporal waypoints, not a slideshow. Create continuous motion between each pair, settle briefly into each required beat, and preserve identity, wardrobe, props, location geometry, lighting logic, and screen direction across the whole sequence.`
    : sequenceTokens.length === 1
      ? `Use ${sequenceTokens[0].token} as the opening visual anchor.`
      : "";
  const assigned = [
    videoRefs.length ? `Use ${videoRefs.map((_, i) => `Video ${i + 1}`).join(", ")} only for their assigned motion, performance, camera rhythm, or source-video edit.` : "",
    audioRefs.length ? `Use ${audioRefs.map((_, i) => `Audio ${i + 1}`).join(", ")} only for their assigned dialogue, voice, music, rhythm, or sound timing.` : "",
  ].filter(Boolean).join(" ");
  return finalizeMinimaxH3Prompt([
    `MINIMAX H3 MULTIMODAL SHOT — ${duration} SECONDS`,
    map ? `REFERENCE JOB MAP\n${map}` : "",
    sequenceLine ? `SEQUENTIAL KEYFRAME CONTRACT\n${sequenceLine}` : "",
    spec.narrativePurpose ? `PRODUCTION OBJECTIVE\n${sentence(spec.narrativePurpose)}` : "",
    hasMultipleBeats ? `TIMED SHOT LIST\n${timed}` : `ACTION\n${action}`,
    camera ? `CAMERA AND PERFORMANCE\n${camera}` : "",
    env ? `ENVIRONMENT MOTION\n${sentence(env)}` : "",
    assigned ? `REFERENCE USE\n${assigned}` : "",
    audio || voice ? `NATIVE STEREO AUDIO\n${[audio, voice].filter(Boolean).join(" ")}` : "",
    preserve ? `PRESERVE\n${sentence(preserve)}` : "",
    avoid ? `AVOID\n${sentence(avoid)}` : "",
  ].filter(Boolean), Number(profile.limits?.maxPromptCharacters || 2000));
}

function compileVideo(profile, spec, refs) {
  const legend = refLegend(profile, refs);
  const action = actionParagraph(spec);
  const env = (spec.environmentMotion || []).join("; ");
  const audio = audioText(spec);
  const preserve = preserveText(spec);
  const avoid = avoidText(spec);
  const voice = profile.supports?.audio ? voiceText(spec) : "";
  const withVoice = (prompt) => voice ? [prompt, `VOICE\n${voice}`].filter(Boolean).join("\n\n") : prompt;

  if (profile.family === "minimax-h3") return compileMinimaxH3(profile, spec, refs);
  if (profile.family === "seedance-2" && (profile.id.includes("/omni") || profile.strategy === "typed-omni-multimodal"))
    return compileSeedanceOmni(profile, spec, refs);

  // I2V models already receive the complete visual state in the start image.
  // The most reliable prompt is therefore only the motion, optional camera move,
  // and intentional audio. Reference maps and canon blocks are deliberately omitted.
  if (profile.mode === "i2v") {
    if (profile.family === "seedance-2") return compileSeedanceI2VCompact(spec);
    if (profile.family === "kling-3") return compileKlingI2VCompact(spec);
    if (profile.family === "ltx-2.3") return compileLtxI2VFlowing(spec);
    if (profile.family === "happy-horse-1.1") return compileHappyHorseI2VCompact(spec);
    if (profile.family === "wan-2.7") return compileWanI2VCompact(spec);
    return withVoice(compileGenericI2VCompact(spec));
  }

  if (profile.mode === "flf") return withVoice(compileCompactFLF(profile, spec));

  if (profile.mode === "audio-video") {
    const visual = unique([
      cleanText(spec.initialState?.subject),
      cleanText(action),
      cleanText(explicitCameraMotion(spec)),
      cleanText(env),
    ]).filter(Boolean).join(" ");
    return [
      legend ? `REFERENCES\n${legend}` : "",
      `AUDIOVISUAL SHOT\n${compactSentences(visual, 105, 4)}`,
      audio ? `AUDIO\n${audio}` : "",
      preserve ? `PRESERVE\n${preserve}` : "",
    ].filter(Boolean).join("\n\n");
  }

  if (profile.family === "kling-3") {
    const map = legend ? `REFERENCES\n${legend}` : "";
    const motion = compileKlingI2VCompact(spec);
    return [map, motion].filter(Boolean).join("\n\n");
  }

  if (profile.family === "ltx-2.3") {
    const para = unique([
      cleanText(spec.initialState?.subject),
      cleanText(action),
      cleanText(explicitCameraMotion(spec)),
      cleanText(env),
      cleanText(audio),
    ]).filter(Boolean).join(" ");
    return [
      legend ? `REFERENCES\n${legend}` : "",
      compactSentences(para, 150, 6),
    ].filter(Boolean).join("\n\n");
  }

  if (profile.family === "happy-horse-1.1") {
    const map = legend ? `REFERENCES\n${legend}` : "";
    const motion = compileHappyHorseI2VCompact(spec);
    return withVoice([map, motion].filter(Boolean).join("\n\n"));
  }

  return [
    legend ? `REFERENCES\n${legend}` : "",
    `SHOT — ${spec.durationSeconds} SECONDS\n${sentence(action || spec.narrativePurpose)}`,
    explicitCameraMotion(spec),
    audio ? `AUDIO\n${audio}` : "",
    preserve ? `PRESERVE\n${preserve}` : "",
    avoid ? `AVOID\n${avoid}` : "",
  ].filter(Boolean).join("\n\n");
}

function checks(profile, spec, refs) {
  const warnings = [];
  const confirmations = [];
  const count = (refs || []).length;
  const max = profile.limits?.maxReferences ?? 0;
  if (count > max)
    warnings.push(
      `${profile.name} profile allows ${max} references; ${count} are selected.`,
    );
  else confirmations.push(`${count} of ${max || 0} reference slots used.`);
  if (["typed-omni", "typed-h3"].includes(profile.refSyntax)) {
    const counts = { image: 0, video: 0, audio: 0 };
    (refs || []).forEach((r) => counts[referenceMediaType(r)]++);
    for (const [kind, limitKey] of [["image", "maxImages"], ["video", "maxVideos"], ["audio", "maxAudio"]]) {
      const limit = Number(profile.limits?.[limitKey] || 0);
      if (limit && counts[kind] > limit)
        warnings.push(`${profile.name} allows up to ${limit} ${kind} reference${limit === 1 ? "" : "s"}; ${counts[kind]} are selected.`);
    }
    confirmations.push(`${counts.image} image · ${counts.video} video · ${counts.audio} audio reference${count === 1 ? "" : "s"}.`);
    if (profile.family === "minimax-h3" && profile.mode === "r2v") {
      const images = (refs || []).filter((ref) => referenceMediaType(ref) === "image");
      const sequenceImages = images.filter(minimaxH3IsSequenceReference);
      const excluded = images.filter((ref) => !minimaxH3IsSequenceReference(ref));
      if (sequenceImages.length > 1)
        confirmations.push(`${sequenceImages.length} ordered MiniMax H3 image waypoints will be named in the sequential keyframe contract.`);
      if (excluded.length)
        warnings.push(`MiniMax H3 has ${excluded.length} image reference${excluded.length === 1 ? "" : "s"} outside the sequential keyframe contract: ${excluded.map((ref) => ref.label || ref.name || ref.key || ref.role || "unnamed image").join(", ")}. Assign a keyframe/waypoint role or give each image an explicit non-temporal job.`);
    }
    const range = profile.limits?.durationSeconds;
    if (Array.isArray(range) && (spec.durationSeconds < range[0] || spec.durationSeconds > range[1]))
      warnings.push(`${profile.name} is planned for ${range[0]}–${range[1]} second outputs; this package is ${spec.durationSeconds} seconds.`);
    if ((refs || []).some((r) => referenceMediaType(r) === "video" && !["motion-reference", "source-video", "camera-reference", "performance-reference"].includes(r.role)))
      warnings.push("A video reference lacks a motion, camera, performance, or source-video role.");
    if ((refs || []).some((r) => referenceMediaType(r) === "audio" && !["audio-timing", "sound-reference"].includes(r.role)))
      warnings.push("An audio reference lacks an audio-timing or sound-reference role.");
  }
  const roles = (refs || []).map((r) => r.role);
  for (const item of spec.visualGrounding || []) {
    const index = (refs || []).findIndex((ref) => ref.key === item.referenceKey || cleanText(ref.entityId) === cleanText(item.entityId));
    if (index >= 0)
      confirmations.push(`${tokenForReference(profile, refs, index)} supplies the visual canon for ${item.name}.`);
  }
  const strictGuide = (refs || []).some((ref) => ref.role === "composition") && compositionGuideAdherence(spec, refs) === "strict";
  if (strictGuide && profile.mediaType === "image" && profile.mode !== "edit")
    warnings.push("Strict blocking-guide adherence is most reliable with this model family's edit/base-image target; CineBraid compiled an authoritative guide prompt, but reference-only adherence may still be approximate.");
  if (
    profile.mode === "i2v" &&
    profile.supports?.firstFrame &&
    !roles.some((r) => ["base", "first-frame"].includes(r))
  )
    warnings.push(
      "A first-frame or base-image reference is required for this mode.",
    );
  if (
    profile.mode === "flf" &&
    profile.supports?.firstFrame &&
    !roles.some((r) => ["base", "first-frame"].includes(r))
  )
    warnings.push("A first-frame reference is required for FLF mode.");
  if (
    profile.mode === "flf" &&
    profile.supports?.lastFrame &&
    !roles.some((r) => ["last-frame", "end-frame"].includes(r))
  )
    warnings.push("A last-frame reference is required for FLF mode.");
  const duplicatePrimary = roles.filter(
    (r) => r === "base" || r === "first-frame",
  ).length;
  if (duplicatePrimary > 1)
    warnings.push(
      "More than one base/first-frame reference is selected. Choose one visual ground truth.",
    );
  const actionCount = (spec.actions || []).length;
  if (spec.durationSeconds <= 5 && actionCount > 3)
    warnings.push(
      `${actionCount} actions may be too many for a ${spec.durationSeconds}-second clip.`,
    );
  if (
    profile.mediaType === "image" &&
    spec.purpose === "first-frame" &&
    /after|then|finally|turns|walks|opens/i.test(actionParagraph(spec))
  )
    warnings.push(
      "The first-frame brief may depict motion that should happen after the opening state.",
    );
  if (!count && profile.supports?.multipleReferences && spec.purpose !== "blocking")
    warnings.push(
      "No reference images are selected; identity and location continuity may be weaker.",
    );
  if (spec.purpose === "blocking" && !spec.blockingSourceAvailable)
    warnings.push("This shot has no description, positioning, title, or scene beat to block from.");
  if (spec.purpose !== "blocking" && (refs || []).some((r) => !r.approved))
    warnings.push(
      "One or more selected references are not explicitly approved.",
    );
  warnings.push(...(spec.promptWarnings || []));
  const audioMode = normalizeAudioMode(spec.audio?.mode, false, !!spec.audio?.dialogue);
  const hasSpeech = !!cleanText(spec.audio?.dialogue || spec.audio?.transcript);
  if (hasSpeech && profile.mediaType === "video" && !profile.supports?.audio)
    warnings.push(`${profile.name} does not generate or accept dialogue audio; the spoken line will be dropped and this shot needs post-production lip sync.`);
  if (hasSpeech && spec.durationWasDefaulted)
    warnings.push("Dialogue is assigned, but this shot or motion unit has no explicit duration.");
  if (hasSpeech && !spec.durationWasDefaulted) {
    const words = cleanText(spec.audio?.dialogue || spec.audio?.transcript).split(/\s+/).filter(Boolean).length;
    const naturalSeconds = Math.max(1, words / 2.5 + 0.5);
    if (naturalSeconds > Number(spec.durationSeconds || 0))
      warnings.push(`The spoken line is approximately ${naturalSeconds.toFixed(1)} seconds at a natural pace, longer than this ${spec.durationSeconds}-second motion unit.`);
  }
  if (audioMode === "generate-voice" && spec.audio?.cleanMaster)
    warnings.push(`${spec.audio?.voiceEntityName || "The selected voice"} is marked as a clean master; generating a new per-shot voice may break the single-master workflow.`);
  if (audioMode === "lip-sync-reference") {
    if (!profileAcceptsAudioReference(profile))
      warnings.push(`${profile.name} cannot use a native dialogue-audio reference; use post-production lip sync or choose an audio-reference-capable target.`);
    if (!cleanText(spec.audio?.referenceKey)) warnings.push("Lip-sync to reference is selected, but no audio reference is assigned.");
  }
  if (!cleanText(spec.aspectRatio || spec.world?.aspectRatio) && profile.mediaType === "image")
    warnings.push("No aspect ratio is set; choose one before generation.");
  return { warnings: unique(warnings), confirmations: unique(confirmations) };
}

function payloadPreview(profile, prompt, refs, spec) {
  const payload = {
    adapter: profile.id,
    profileVersion: profile.profileVersion,
    modelFamily: profile.family,
    mediaType: profile.mediaType,
    mode: profile.mode,
    prompt,
    durationSeconds:
      profile.mediaType === "video" ? spec.durationSeconds : undefined,
    references: (refs || []).map((r, i) => ({
      token: tokenForReference(profile, refs, i),
      mediaType: referenceMediaType(r),
      role: r.role,
      asset: r.label || r.name,
      url: r.url || "",
      instruction: r.instruction || "",
    })),
    note: "This is a planning package. Translate it into the selected tool manually or through an optional connection.",
  };
  if (profile.mode === "blocking") {
    payload.recommendedSettings = {
      ...(profile.blockingSettings || {}),
      aspectRatio: cleanText(spec.aspectRatio || spec.world?.aspectRatio) || "Set the project aspect ratio before generation",
      disposableScaffolding: true,
    };
  }
  if (profile.family === "wan-2.7") {
    payload.negativePrompt = wanNegative(spec);
    payload.recommendedSettings = wanSettings(spec);
  }
  if (profile.family === "seedance-2")
    payload.recommendedSettings = profile.refSyntax === "typed-omni"
      ? {
          inputLimit: "12 total · up to 9 images · 3 videos · 3 audio clips",
          duration: "4–15 seconds on the official open-platform specification",
          nativeAudio: true,
          negativeField: false,
          note: "Assign one job to every reference and keep the desired shot action, geometry, camera and synchronization explicit.",
        }
      : {
          dynamics: "mid-range for subtle-life shots",
          negativeField: false,
          note: "Name desired ambient motion positively; scope stillness to the subject rather than freezing the whole frame.",
        };
  if (profile.family === "minimax-h3") {
    const imageUrls = (refs || []).filter((r) => referenceMediaType(r) === "image").map((r) => r.url || "");
    const videoUrls = (refs || []).filter((r) => referenceMediaType(r) === "video").map((r) => r.url || "");
    const audioUrls = (refs || []).filter((r) => referenceMediaType(r) === "audio").map((r) => r.url || "");
    payload.fal = {
      endpoint: profile.falEndpoint || (profile.mode === "t2v" ? "minimax/h3/text-to-video" : profile.mode === "r2v" ? "minimax/h3/reference-to-video" : "minimax/h3/image-to-video"),
      input: profile.mode === "t2v"
        ? { prompt, duration: spec.durationSeconds, resolution: profile.defaultResolution || "2K", aspect_ratio: cleanText(spec.aspectRatio || spec.world?.aspectRatio) || "16:9" }
        : profile.mode === "i2v"
          ? { prompt, duration: spec.durationSeconds, resolution: profile.defaultResolution || "2K", image_url: imageUrls[0] || "" }
          : profile.mode === "flf"
            ? { prompt, duration: spec.durationSeconds, resolution: profile.defaultResolution || "2K", image_url: imageUrls[0] || "", end_image_url: imageUrls[1] || "" }
            : { prompt, duration: spec.durationSeconds, resolution: profile.defaultResolution || "2K", aspect_ratio: cleanText(spec.aspectRatio || spec.world?.aspectRatio) || "adaptive", reference_image_urls: imageUrls, reference_video_urls: videoUrls, reference_audio_urls: audioUrls },
    };
    payload.recommendedSettings = {
      duration: "5–15 seconds",
      resolution: "2K default; 768P available",
      nativeStereoAudio: true,
      /* CineBraid's own budget for this written package, not a provider ceiling. fal's
         queue schema documents no prompt maxLength for any H3 endpoint, and both fal
         and MiniMax state 7,000 characters; the dispatch ceiling is resolved from model
         and backend capability when a generation plan is compiled. */
      promptLimit: "2,000 characters in this written package; dispatch is limited by model ∩ backend capability (currently 7,000)",
      referenceLimit: profile.mode === "r2v" ? "12 total · up to 9 images · 3 videos · 3 audio clips" : profile.mode === "flf" ? "first and optional last frame" : profile.mode === "i2v" ? "one opening frame" : "prompt only",
      note: profile.mode === "r2v" ? "Give every reference one explicit job. Multiple approved frames are ordered as sequential keyframes in the prompt." : "Use timed shot-list blocks when the shot contains more than one beat.",
    };
  }
  if (profile.family === "gpt-image-2" && profile.mode === "edit")
    payload.recommendedSettings = {
      workflow: "single surgical edit",
      note: "Avoid edit-of-edit chains; fidelity-upscale or restart from the clean source when the frame becomes tired.",
    };
  return payload;
}

function compile(profile, spec, refs) {
  const effectiveRefs = profile.mediaType === "image" ? prepareImageReferences(spec, refs) : refs;
  const promptSpec = referenceAwarePromptSpec(profile, spec, effectiveRefs);
  const prompt =
    profile.mediaType === "image"
      ? compileImage(profile, promptSpec, effectiveRefs)
      : compileVideo(profile, promptSpec, effectiveRefs);
  const result = checks(profile, promptSpec, effectiveRefs);
  /* NAME THE STAGE THIS NUMBER BELONGS TO.
   *
   * `limits.maxPromptCharacters` is CineBraid's budget for the WRITTEN PACKAGE — this
   * file says so twenty lines up, in `recommendedSettings.promptLimit`. It is not a
   * provider ceiling, and calling it "the provider schema limit" here contradicted
   * that in the same output: a filmmaker read "close to the provider schema limit:
   * 1,991 / 2,000" at this stage and "4,894 / 7,000" in the paid dialog, and had no
   * way to tell which number the request would actually be held to.
   *
   * The dispatch ceiling is resolved from model ∩ backend capability when a
   * generation plan is compiled, and it is stated there. The number here keeps its
   * value and loses the claim it was never entitled to make. */
  const promptLimit = Number(profile.limits?.maxPromptCharacters || 0);
  if (promptLimit) {
    const usage = `${prompt.length.toLocaleString()} / ${promptLimit.toLocaleString()} characters`;
    if (prompt.length > promptLimit)
      result.warnings.unshift(`${profile.name} prompt exceeds CineBraid's written-package budget: ${usage}. The dispatch limit is resolved separately from model and backend capability.`);
    else if (prompt.length >= promptLimit * 0.9)
      result.warnings.unshift(`${profile.name} prompt is close to CineBraid's written-package budget: ${usage}. The dispatch limit is resolved separately from model and backend capability.`);
    else result.confirmations.unshift(`${profile.name} prompt length validated against CineBraid's written-package budget: ${usage}.`);
  }
  return {
    prompt,
    ...result,
    references: effectiveRefs,
    payload: payloadPreview(profile, prompt, effectiveRefs, promptSpec),
  };
}

module.exports = {
  IMAGE_PURPOSE_LABELS,
  SUPPORTED_PROMPT_PURPOSES,
  profileLibrary,
  getProfile,
  buildContext,
  defaultSpec,
  parseAspectRatio,
  resolveShotEntities,
  normalizeBlockingEmphasis,
  normalizeBlockingPlan,
  buildBlockingPlan,
  applyBlockingPlan,
  normalizeMotionDirective,
  deterministicMotionRevision,
  buildSpecSystem,
  buildSpecUser,
  extractJsonObject,
  validateSpec,
  applyMotionAudioBrief,
  applyStructuredDirection,
  compile,
  checks,
  tokenFor,
  normalizeAudioMode,
  compactVoiceDesign,
  referenceAwarePromptSpec,
  profileAcceptsAudioReference,
};

/* Shared character-to-voice resolver for browser and Node, the same way
   public/shared-entities.js and public/shared-continuity.js are shared.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: a character and its voice
   cannot give two different answers to "is this voice ready?", because only one
   of them is allowed to hold the answer.

   Before this module, CineBraid held voice in four runtime places:

     1. P.audio[]                        name, notes, language, approvedFile,
                                         status, workflowStatus
     2. character.audio.status           a SECOND lifecycle, on the character,
                                         editable from the character page and
                                         read by nothing else
     3. character.voiceId                the durable link — read by M017, and
                                         written by no part of the app
     4. shot.audio.voiceEntityId         the per-shot dialogue binding

   (1) and (2) are the pair that disagree. A character could be set to APPROVED
   while the voice entity it is meant to describe had never been started, and
   nothing anywhere reconciled the two, because (3) — the link that would let
   anything compare them — could not be authored.

   The ownership rule this module implements:

     the voice entity owns the voice record;
     the character points at it;
     every character-facing voice state is DERIVED from the entity.

   Three properties are structural here rather than merely tested:

   * NO CONFIGURATION IS AN INPUT. resolveCharacterVoice() takes a project and a
     character and nothing else — no CONFIG, no provider, no model, no clock, no
     I/O. Which voice belongs to a character therefore cannot be moved by
     changing a synthesis provider, because the provider is not reachable from
     here.

   * NOTHING IS MUTATED. Every function returns a fresh value and writes nothing
     back, so reading a legacy project never rewrites it. Persisting any
     conversion stays the explicit business of the migration framework.

   * NO UI WORDING. Outcomes are tokens; the browser renders the words. This is
     the same line shared-continuity.js holds, and a test forbids crossing it. */

const VOICE_OUTCOME = {
  /* The character names no voice at all. Legal, and not a defect: a character
     who never speaks is a normal thing for a film to contain. */
  UNLINKED: "unlinked",
  /* The character names a voice that this project does not contain. Never
     silently downgraded to UNLINKED — a dangling pointer is information, and
     M017 preserves it as a disputed statement for exactly the same reason. */
  UNRESOLVED: "unresolved",
  NOT_STARTED: "not-started",
  IN_PROGRESS: "in-progress",
  NEEDS_REVIEW: "needs-review",
  CHANGES_REQUESTED: "changes-requested",
  READY: "ready",
};

/* The legacy ENT_STATUSES / WORKFLOW_STATES storage vocabulary, restated here so
   this module stays free of app.js. tests/voice-runtime-ownership.js asserts
   these agree with app.js's entityWorkflowState() across every combination, so
   the restatement cannot drift into a second opinion. */
const VOICE_WORKFLOW_STATES = ["DRAFT", "IN PROGRESS", "READY FOR REVIEW", "CHANGES REQUESTED", "APPROVED"];

const WORKFLOW_KEY_OUTCOME = {
  DRAFT: VOICE_OUTCOME.NOT_STARTED,
  "IN PROGRESS": VOICE_OUTCOME.IN_PROGRESS,
  "READY FOR REVIEW": VOICE_OUTCOME.NEEDS_REVIEW,
  "CHANGES REQUESTED": VOICE_OUTCOME.CHANGES_REQUESTED,
  APPROVED: VOICE_OUTCOME.READY,
};

function voiceText(value) {
  return String(value == null ? "" : value).trim();
}

function voiceRecordObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/* The workflow key of an entity, by the rule already in app.js:1996. Explicit
   workflowStatus wins; otherwise the legacy `status` is interpreted. */
function voiceWorkflowKey(voice) {
  const record = voiceRecordObject(voice);
  const explicit = voiceText(record.workflowStatus);
  if (VOICE_WORKFLOW_STATES.includes(explicit)) return explicit;
  const status = voiceText(record.status);
  if (status === "APPROVED") return "APPROVED";
  if (voiceText(record.reviewStatus) === "CHANGES REQUESTED") return "CHANGES REQUESTED";
  if (["CANDIDATE", "REVIEW"].includes(status)) return "READY FOR REVIEW";
  if (status === "IN PROGRESS") return "IN PROGRESS";
  return "DRAFT";
}

/* The lifecycle answer for a voice entity, on its own terms. This is the ONLY
   place a voice lifecycle is computed; the character surface calls through it
   rather than deriving anything of its own. */
function voiceEntityOutcome(voice) {
  if (!voice) return VOICE_OUTCOME.UNRESOLVED;
  return WORKFLOW_KEY_OUTCOME[voiceWorkflowKey(voice)] || VOICE_OUTCOME.NOT_STARTED;
}

function voiceCollection(project) {
  const source = voiceRecordObject(project).audio;
  return Array.isArray(source) ? source.filter((row) => row && typeof row === "object") : [];
}

function voiceById(project, voiceId) {
  const id = voiceText(voiceId);
  if (!id) return null;
  return voiceCollection(project).find((row) => voiceText(row.id) === id) || null;
}

/* Has this voice an approved recording? Reported separately from the outcome
   rather than folded into it: the approval decision and the material evidence
   are different facts, and collapsing them would invent a rule neither the
   entity page nor OFP states. */
function voiceHasApprovedRecording(voice) {
  return !!voiceText(voiceRecordObject(voice).approvedFile);
}

/* The legacy character-side lifecycle, read but never obeyed and never erased.

   `character.audio.status` is preserved verbatim by migration rule M070 as a
   value open-film-project does not model. It stays on the record so no existing
   project loses information, but it is reported as legacy evidence, not as an
   answer. */
function legacyCharacterVoiceState(character) {
  const audio = voiceRecordObject(voiceRecordObject(character).audio);
  const status = voiceText(audio.status);
  if (!status) return { present: false, status: "", outcome: "" };
  return { present: true, status, outcome: voiceEntityOutcome({ status }) };
}

/* Which vendor-specific fields on the character are provider CONFIGURATION
   rather than voice identity. Listed explicitly so the character surface can
   label them honestly, and so a test can assert none of them reaches the
   lifecycle derivation. */
const VOICE_PROVIDER_CONFIG_FIELDS = ["voiceDesignPrompt", "voiceTool", "sunoAltPrompt"];

function characterVoiceProviderConfig(character) {
  const audio = voiceRecordObject(voiceRecordObject(character).audio);
  const config = {};
  for (const field of VOICE_PROVIDER_CONFIG_FIELDS) config[field] = voiceText(audio[field]);
  return config;
}

/* THE ONE ANSWER. Everything character-facing goes through this.

   Returns, for a character:
     voiceId    the link as written ("" when there is none)
     voice      the resolved P.audio[] record, or null
     outcome    a VOICE_OUTCOME token, derived from the VOICE ENTITY ONLY
     hasApprovedRecording
     legacy     { present, status, outcome } — the old character-side value
     conflict   null, or { characterOutcome, voiceOutcome } when the stored
                character-side lifecycle disagrees with the authority

   `conflict` is disclosure, not resolution. When the two disagree the
   authoritative outcome is still the voice entity's — but the disagreement is
   surfaced rather than hidden, so a project carrying contradictory old data
   says so instead of quietly picking whichever was easier to read. */
function resolveCharacterVoice(project, character) {
  const record = voiceRecordObject(character);
  const voiceId = voiceText(record.voiceId);
  const voice = voiceById(project, voiceId);
  const legacy = legacyCharacterVoiceState(record);

  let outcome;
  if (!voiceId) outcome = VOICE_OUTCOME.UNLINKED;
  else if (!voice) outcome = VOICE_OUTCOME.UNRESOLVED;
  else outcome = voiceEntityOutcome(voice);

  /* A conflict needs two opinions about the same thing. With no resolvable
     voice entity there is only the legacy value, which is reported through
     `legacy` and is not a contradiction of anything. */
  const conflict =
    voice && legacy.present && legacy.outcome !== outcome
      ? { characterOutcome: legacy.outcome, characterStatus: legacy.status, voiceOutcome: outcome }
      : null;

  return {
    voiceId,
    voice: voice || null,
    outcome,
    hasApprovedRecording: voiceHasApprovedRecording(voice),
    legacy,
    conflict,
  };
}

/* Every voice a character is bound to anywhere in the project, for display.
   The durable link and the per-shot dialogue bindings are reported SEPARATELY:
   a shot binding is evidence about one line, never a character's identity, and
   merging them would recreate the ambiguity this module removes. */
function characterVoiceBindings(project, characterId) {
  const id = voiceText(characterId);
  const bindings = [];
  if (!id) return bindings;
  const seen = new Set();
  for (const shot of Array.isArray(voiceRecordObject(project).shots) ? project.shots : []) {
    const audio = voiceRecordObject(voiceRecordObject(shot).audio);
    if (voiceText(audio.speakerId) !== id) continue;
    const voiceId = voiceText(audio.voiceEntityId);
    if (!voiceId || seen.has(voiceId)) continue;
    seen.add(voiceId);
    bindings.push({ voiceId, shotId: voiceText(shot.id), voice: voiceById(project, voiceId) });
  }
  return bindings;
}

if (typeof window !== "undefined") {
  window.VOICE_OUTCOME = VOICE_OUTCOME;
  window.voiceWorkflowKey = voiceWorkflowKey;
  window.voiceEntityOutcome = voiceEntityOutcome;
  window.voiceById = voiceById;
  window.voiceHasApprovedRecording = voiceHasApprovedRecording;
  window.characterVoiceProviderConfig = characterVoiceProviderConfig;
  window.resolveCharacterVoice = resolveCharacterVoice;
  window.characterVoiceBindings = characterVoiceBindings;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    VOICE_OUTCOME,
    VOICE_WORKFLOW_STATES,
    VOICE_PROVIDER_CONFIG_FIELDS,
    voiceWorkflowKey,
    voiceEntityOutcome,
    voiceCollection,
    voiceById,
    voiceHasApprovedRecording,
    legacyCharacterVoiceState,
    characterVoiceProviderConfig,
    resolveCharacterVoice,
    characterVoiceBindings,
  };
}

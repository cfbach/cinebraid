/* CINEBRAID — FRAME-SPECIFIC TEMPORAL PRESENCE, and the contradiction that must
   never reach a provider.

   Browser and Node, the same way public/shared-continuity-binding.js is shared,
   and deliberately its sibling: that file owns WHICH STATE an entity is in for a
   given frame, this one owns WHETHER IT IS IN THE FRAME AT ALL.

   ---------------------------------------------------------------------------
   THE DEFECT THIS ENDS (Dogfood #2 A3 / forensic F6).

   Shot S01-01, "The Illustration Breathes". Frame A was authored as: no Chimbley
   Sweep visible. Frame B: the Sweep revealed. The compiled Frame A blocking
   language explicitly included a tiny Sweep figure, and GPT Image 2 did exactly
   what it was told, on a paid render.

   Nothing was wrong with the model and nothing was wrong with the review. The
   frame request was assembled from WHOLE-SHOT truth — the shot's cast, the
   shot's description, the shot's references — and the frame directive was then
   APPENDED rather than allowed to override. A reviewer could not have rescued
   it, because the reviewer would have been checking a candidate against a
   requirement that was already corrupted.

   ---------------------------------------------------------------------------
   THE RULE, and it is the whole module.

       Entities attached to a SHOT describe what the shot is about.
       They do not describe what is visible in a GIVEN FRAME.
       Frame-specific presence — INCLUDING REQUIRED ABSENCE — overrides
       shot-level membership in every compiled prompt.

   ABSENCE MEANS INHERIT, exactly as in the state binding: a frame that declares
   nothing inherits the shot's membership and behaves as it always has. Only an
   explicit per-frame declaration overrides.

   PRESENCE AND REFERENCE ATTACHMENT ARE DIFFERENT FACTS. A character reference
   may legitimately stay attached for identity continuity while that character is
   explicitly absent from the current frame — the H3 correction path depends on
   exactly that. This module never removes a reference. It removes the entity's
   POSITIVE SUBJECT AND ACTION FACTS from the frame being compiled, and says so.

   ---------------------------------------------------------------------------
   THE VOCABULARY, smallest set that is honest about a moment in time.

     absent    not visible in this frame at all
     present   visible and readable throughout this frame
     enters    becomes visible during this frame's moment
     exits     leaves visibility during this frame's moment

   Only `absent` forbids positive presence. `enters` and `exits` are moments in
   which the entity IS on screen for part of the frame, so a positive subject
   fact about them is truthful. The set is extensible; the FORBIDDING set is
   deliberately not.

   Deliberately absent, and required to stay absent:
     - file or network I/O
     - provider or model awareness
     - Date.now(), new Date(), Math.random()
     - any mutation of the shot, frame or spec passed in
     - UI wording. The values above are TOKENS. */

/* The declared vocabulary. */
const FRAME_PRESENCE_VALUES = ["absent", "present", "enters", "exits"];

/* The one value that forbids positive subject/action facts. A list, so the
   question "which values forbid presence" has an answer a caller can read
   rather than a conditional it has to copy. */
const FRAME_PRESENCE_FORBIDDING_VALUES = ["absent"];

/* The runtime storage, named once. It lives beside the per-frame state
   selections that public/shared-continuity-binding.js already reads, in the same
   `frameWorkflows[frameId]` record, because they are two properties of one
   declaration and splitting them across two homes is how they drift. */
const RUNTIME_FRAME_PRESENCE_KEY = "entityPresence";

function presenceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function presenceText(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function presenceList(value) {
  return Array.isArray(value) ? value : [];
}
function escapeForPresenceRegExp(value) {
  return presenceText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------- reading the declaration --------------------------------------- */

function normalizeFramePresence(value) {
  const word = presenceText(value).trim().toLowerCase();
  return FRAME_PRESENCE_VALUES.includes(word) ? word : "";
}

/* Returns "" for "this frame declares nothing about this entity", which the
   caller resolves as inherit. Deliberately NOT "present": a frame that says
   nothing has not said the entity is there, and manufacturing a declaration is
   the mistake this module exists to end. */
function resolveFramePresence(shot, frameId, entityId) {
  const creation = presenceObject(presenceObject(shot).creationBrief);
  const workflow = presenceObject(presenceObject(creation.frameWorkflows)[presenceText(frameId)]);
  const map = presenceObject(workflow[RUNTIME_FRAME_PRESENCE_KEY]);
  return normalizeFramePresence(map[presenceText(entityId)]);
}

/* Every presence this frame declares, in a shape a caller can iterate without
   knowing the storage. Undeclared entities are simply not present in the list. */
function framePresenceDeclarations(shot, frameId) {
  const creation = presenceObject(presenceObject(shot).creationBrief);
  const workflow = presenceObject(presenceObject(creation.frameWorkflows)[presenceText(frameId)]);
  const map = presenceObject(workflow[RUNTIME_FRAME_PRESENCE_KEY]);
  const out = [];
  for (const entityId of Object.keys(map)) {
    const presence = normalizeFramePresence(map[entityId]);
    if (!entityId || !presence) continue;
    out.push({ entityId, presence });
  }
  return out;
}

/* The set the compiler has to act on. */
function absentEntityIdsForFrame(shot, frameId) {
  return framePresenceDeclarations(shot, frameId)
    .filter((entry) => FRAME_PRESENCE_FORBIDDING_VALUES.includes(entry.presence))
    .map((entry) => entry.entityId);
}

/* Every frame's declaration for one shot, ordered by the shot's own frames when
   the caller supplies them. The parallel of readShotStateBindings, and the
   shape a future OFP `continuity` extension would serialize. */
function readShotPresenceBindings(shot, options = {}) {
  const s = presenceObject(shot);
  const shotId = presenceText(presenceObject(options).shotId || s.id);
  const requested = presenceList(presenceObject(options).frameIds).map(presenceText).filter(Boolean);
  const creation = presenceObject(s.creationBrief);
  const workflows = presenceObject(creation.frameWorkflows);
  const workflowIds = Object.keys(workflows);
  const orderedIds = requested.length
    ? [...requested.filter((id) => workflowIds.includes(id)), ...workflowIds.filter((id) => !requested.includes(id))]
    : workflowIds;
  const frames = [];
  for (const frameId of orderedIds) {
    const declarations = framePresenceDeclarations(s, frameId);
    if (!declarations.length) continue;
    frames.push({ frameId, entityPresence: declarations });
  }
  return { shotId, frames };
}

/* ---------- naming an entity in text -------------------------------------- */

/* The tokens that identify one entity in prose. The id is included because
   CineBraid's own compiled surfaces print ids, and a creator's directive may
   too. Aliases are supplied by the caller when an entity has a short name the
   project actually uses.

   THE SHORT FORM IS DERIVED, and it has to be. Dogfood #2's own staging line
   read "The Sweep is upper-left of frame" while the entity is named "Chimbley
   Sweep" — a full-name-only scan would have passed that sentence straight into
   the frame that excludes him, which is the exact defect.

   The rule is narrow on purpose: a whitespace-separated part of the NAME, at
   least four characters, and capitalised in the name as written. A capitalised
   word inside a proper name is what people shorten to; a lowercase one
   ("Flight case" -> "case") is an ordinary English word and would fire on
   "in case of rain". The id is never split — its parts are structural
   ("CHAR", "SWEEP"), and "CHAR" belongs to every character in the project. */
function presenceNameParts(name) {
  return presenceText(name)
    .split(/[\s/]+/)
    .map((part) => part.replace(/[^A-Za-z0-9'’-]/g, ""))
    .filter((part) => part.length >= 4 && /^[A-Z]/.test(part));
}
function presenceTokensFor(entity) {
  const it = presenceObject(entity);
  const name = presenceText(it.name);
  const parts = presenceNameParts(name);
  const tokens = [name, presenceText(it.id), ...presenceList(it.aliases).map(presenceText), ...(parts.length > 1 ? parts : [])];
  const seen = new Set();
  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !seen.has(token.toLowerCase()) && seen.add(token.toLowerCase()));
}

function textNamesEntity(value, entity) {
  const haystack = presenceText(value);
  if (!haystack) return false;
  return presenceTokensFor(entity).some((token) => new RegExp(`(^|[^A-Za-z0-9_-])${escapeForPresenceRegExp(token)}(?:['’]s)?($|[^A-Za-z0-9_-])`, "i").test(haystack));
}

/* Words that turn a mention into a statement of ABSENCE. A creator writing
   "the rooftops are empty; the Sweep is not yet visible" is describing the
   absence correctly and must not be blocked for naming what is missing.

   This list only ever WEAKENS the check, and only inside free prose. The
   machine-generated positive lists below are checked without it, because
   CineBraid never writes a negation into an identity-canon entry. */
const FRAME_ABSENCE_MARKERS = [
  "no ", "not ", "n't", "never", "without", "absent", "absence", "unseen", "invisible",
  "hidden", "off-screen", "offscreen", "off screen", "out of frame", "out-of-frame",
  "out of shot", "empty", "nobody", "no one", "none", "exclude", "excluded", "avoid",
  "before ", "yet to", "has yet", "prior to", "must not", "do not", "cannot",
];

function clauseDeniesPresence(clause) {
  const lower = presenceText(clause).toLowerCase();
  return FRAME_ABSENCE_MARKERS.some((marker) => lower.includes(marker));
}

/* Prose is judged clause by clause. A whole paragraph is too coarse — one
   negation anywhere would excuse a positive sentence elsewhere in it. */
function presenceClauses(value) {
  return presenceText(value)
    .split(/\r?\n|(?<=[.;!?])\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/* ---------- the contradiction check --------------------------------------- */

/* Fields CineBraid itself generates as pure positive assertions. A declared-
   absent entity appearing in ANY of them is a contradiction with no ambiguity
   to weigh: the compiler does not write negations into an identity canon. */
const PRESENCE_STRUCTURED_SOURCES = [
  ["identityCanon", "identity canon"],
  ["mustPreserve", "must-preserve list"],
  ["mustInclude", "must-include list"],
  ["promptEntities", "compiled subject list"],
  ["visualGrounding", "visual grounding list"],
  ["blockingEntities", "blocking entity list"],
];

function structuredValues(spec, key) {
  const rows = presenceList(presenceObject(spec)[key]);
  const out = [];
  for (const row of rows) {
    if (typeof row === "string") { out.push(row); continue; }
    const it = presenceObject(row);
    for (const field of ["name", "descriptor", "referenceLabel", "blockingNote"]) if (presenceText(it[field])) out.push(presenceText(it[field]));
  }
  return out;
}

/* Free prose CineBraid compiled from creator input. Judged with the negation
   allowance, because a creator legitimately names what is missing. */
function freeTextValues(spec, prompt) {
  const it = presenceObject(spec);
  const initial = presenceObject(it.initialState);
  const final = presenceObject(it.finalState);
  const out = [
    presenceText(it.narrativePurpose),
    presenceText(initial.subject), presenceText(initial.staging),
    presenceText(final.subject), presenceText(final.staging),
    ...presenceList(it.stagingLines).map(presenceText),
    ...presenceList(it.actions).map((action) => presenceText(presenceObject(action).action)),
    presenceText(prompt),
  ];
  return out.filter(Boolean);
}

/* THE PREFLIGHT. Every finding names the entity, the surface, and the exact
   fragment, because "a contradiction was detected" is not actionable and a
   creator staring at a blocked paid render deserves the sentence that caused it.

   `absentEntities` are the entities this frame declared absent, each with
   whatever names it is known by. Callers that have no declared absence get an
   empty list back without doing any scanning. */
function framePresenceContradictions(options = {}) {
  const it = presenceObject(options);
  const absent = presenceList(it.absentEntities).map(presenceObject).filter((entity) => presenceTokensFor(entity).length);
  if (!absent.length) return [];
  const spec = presenceObject(it.spec);
  const findings = [];
  for (const entity of absent) {
    const label = presenceText(entity.name) || presenceText(entity.id);
    for (const [key, surface] of PRESENCE_STRUCTURED_SOURCES) {
      for (const value of structuredValues(spec, key)) {
        if (!textNamesEntity(value, entity)) continue;
        findings.push({
          entityId: presenceText(entity.id),
          entityName: label,
          surface,
          fragment: value.slice(0, 240),
          reason: `${label} is declared absent from this frame, but the compiled ${surface} still asserts it is there.`,
        });
      }
    }
    for (const value of freeTextValues(spec, it.prompt)) {
      for (const clause of presenceClauses(value)) {
        if (!textNamesEntity(clause, entity) || clauseDeniesPresence(clause)) continue;
        findings.push({
          entityId: presenceText(entity.id),
          entityName: label,
          surface: "compiled frame direction",
          fragment: clause.slice(0, 240),
          reason: `${label} is declared absent from this frame, but the compiled direction states it positively: "${clause.slice(0, 160)}".`,
        });
      }
    }
  }
  /* One finding per entity/surface/fragment. The same sentence reaching both the
     spec subject and the final prompt string is one problem, not two. */
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.entityId}|${finding.surface}|${finding.fragment}`;
    return !seen.has(key) && seen.add(key);
  });
}

/* ---------- what the compiler does with a declared absence ---------------- */

/* Whole-shot narrative that names an entity this frame excludes is NOT frame
   truth, and appending a frame directive after it does not repair it. It is
   withheld in full rather than edited: a partial redaction of authored prose
   produces a sentence nobody wrote, and the frame's own description is the
   authority for this frame anyway.

   Returns the text to use plus which entities caused it to be withheld, so the
   build can tell the creator what happened instead of silently dropping their
   description. */
function narrativeForFrame(value, absentEntities) {
  const source = presenceText(value);
  const absent = presenceList(absentEntities).map(presenceObject).filter((entity) => presenceTokensFor(entity).length);
  if (!source || !absent.length) return { text: source, withheldFor: [] };
  const withheldFor = [];
  for (const entity of absent) {
    for (const clause of presenceClauses(source)) {
      if (textNamesEntity(clause, entity) && !clauseDeniesPresence(clause)) { withheldFor.push(presenceText(entity.id)); break; }
    }
  }
  return withheldFor.length ? { text: "", withheldFor } : { text: source, withheldFor: [] };
}

/* The explicit requirement CineBraid adds to the compiled package so the model
   is TOLD about the absence rather than merely not told about the presence.
   Phrased as a prohibition because that is the field it lands in. */
function absenceRequirements(absentEntities) {
  return presenceList(absentEntities)
    .map(presenceObject)
    .filter((entity) => presenceTokensFor(entity).length)
    .map((entity) => `${presenceText(entity.name) || presenceText(entity.id)} must not appear anywhere in this frame, in any form, at any size, including reflections, shadows, silhouettes and background figures`);
}

const FRAME_PRESENCE_EXPORTS = {
  FRAME_PRESENCE_VALUES,
  FRAME_PRESENCE_FORBIDDING_VALUES,
  RUNTIME_FRAME_PRESENCE_KEY,
  FRAME_ABSENCE_MARKERS,
  presenceNameParts,
  normalizeFramePresence,
  resolveFramePresence,
  framePresenceDeclarations,
  absentEntityIdsForFrame,
  readShotPresenceBindings,
  presenceTokensFor,
  textNamesEntity,
  clauseDeniesPresence,
  presenceClauses,
  framePresenceContradictions,
  narrativeForFrame,
  absenceRequirements,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(FRAME_PRESENCE_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = FRAME_PRESENCE_EXPORTS;

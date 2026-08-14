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

/* ==========================================================================
   BATCH 1B — NEGATION IS SCOPED TO THE MENTION, NOT TO THE CLAUSE.

   The shipped detector asked whether a clause CONTAINED any of a list of
   markers, anywhere. `before ` was on that list, so:

       "The Chimbley Sweep stands before the chimney."

   was read as a statement of absence, the sentence was allowed through into a
   frame that excludes him, and the preflight reported no contradiction. The
   acceptance audit executed exactly that string. `without` did the same to "he
   moves without hesitation", and `not ` to "not only is the Sweep visible".

   The mistake is that a marker's presence says nothing about WHAT it negates.
   "before" is a temporal absence marker in "before the Sweep appears" and a
   spatial preposition in "stands before the chimney" — same word, opposite
   meaning, and the difference is entirely in what follows it.

   So the question is asked per mention:

       DOES SOMETHING IN THIS CLAUSE NEGATE *THIS* MENTION OF *THIS* ENTITY?

   Only the text governing the mention is consulted — the span immediately
   before it, back to the nearest clause break, and the predicate immediately
   after it. A clause contradicts the declared absence when at least one mention
   survives that test, which is also what makes "the rooftops are empty and the
   Sweep is nowhere to be seen" correctly safe while "the Sweep is absent, but
   the Sweep's shadow falls across the tiles" is correctly caught.

   THE STRUCTURED DECLARATION IS STILL THE TRUTH. This is the last safety check
   on prose CineBraid did not write, not the mechanism by which absence is
   honoured — the compiler already removes an absent entity from every positive
   list before this runs. */

/* Kept exported under its shipped name: the vocabulary is still useful to a
   surface explaining itself, and the negative controls name it. */
const FRAME_ABSENCE_MARKERS = [
  "no ", "not ", "n't", "never", "without", "absent", "absence", "unseen", "invisible",
  "hidden", "off-screen", "offscreen", "off screen", "out of frame", "out-of-frame",
  "out of shot", "empty", "nobody", "no one", "none", "exclude", "excluded", "avoid",
  "before ", "yet to", "has yet", "prior to", "must not", "do not", "cannot",
];

/* Words that negate what FOLLOWS them. Matched as whole words inside the span
   that governs the mention, never as substrings of a longer word. */
const PRESENCE_NEGATION_WORDS = /\b(?:no|not|never|nor|neither|without|sans|minus|excluding|except|omit|omitting|exclude|avoid|avoiding|hide|hiding|remove|removing|lacking|absent|devoid)\b|\w+n['’]t\b/i;

/* `not only` and `no less` are intensifiers, not denials: "not only is the
   Sweep visible, he is central" ASSERTS presence twice. Stripped before the
   negation scan so the word `not` in them cannot excuse the mention. */
const PRESENCE_NEGATION_IDIOMS = /\bnot\s+(?:only|just|merely|simply)\b|\bno\s+less\b|\bnone\s+other\s+than\b|\bnothing\s+(?:if\s+not|short\s+of)\b/gi;

/* A temporal qualifier is only an absence when the thing it governs is the
   entity's ARRIVAL. "before the Sweep appears" is absence; "before the chimney"
   is a place. So the marker has to be immediately followed by the mention, AND
   the mention has to be followed by a verb of appearing. */
const PRESENCE_TEMPORAL_LEAD = /\b(?:before|prior\s+to|ahead\s+of|until|up\s+to|leading\s+up\s+to|earlier\s+than)\s+(?:the|a|an|any|this|that|his|her|their|its|our)?\s*$/i;
const PRESENCE_ARRIVAL_VERB = /^\s*(?:['’]s\s+)?(?:\w+\s+){0,3}?(?:appears?|appearing|arrives?|arriving|enters?|entering|emerges?|emerging|is\s+revealed|becomes?\s+visible|comes?\s+into\s+(?:view|frame|shot)|shows?\s+up|steps?\s+in(?:to)?)\b/i;

/* Predicates that deny presence when they follow the mention. */
const PRESENCE_DENYING_PREDICATE = new RegExp(
  "^\\s*(?:['’]s)?\\s*(?:" +
  /* "X is not visible", "X does not appear", "X must not appear", "X isn't seen" */
  "(?:is|are|was|were|has|have|had|does|do|did|will|would|shall|should|must|can|could|may|might|remains?|stays?)\\s*(?:not|n['’]t|never|no\\s+longer)\\b" +
  "|(?:isn|aren|wasn|weren|doesn|don|didn|won|wouldn|shouldn|mustn|can|couldn|hasn|haven|hadn)['’]t\\b" +
  /* "X is absent", "X remains unseen", "X is off-screen", "X is nowhere" */
  "|(?:is|are|was|were|remains?|stays?|becomes?)\\s+(?:still\\s+|entirely\\s+|completely\\s+|wholly\\s+)?(?:absent|unseen|invisible|hidden|obscured|concealed|off[-\\s]?screen|out\\s+of\\s+(?:frame|shot|view|sight)|nowhere|gone|missing)\\b" +
  /* "X has yet to appear", "X is yet to be seen" */
  "|(?:has|have|had|is|are|was|were)\\s+yet\\s+to\\b" +
  /* bare copular absence: "X: absent", "X — absent" */
  "|[:\\u2014-]\\s*(?:absent|unseen|not\\s+visible|off[-\\s]?screen)\\b" +
  ")",
  "i",
);

/* Clause breaks that end a negation's reach. "The Sweep is absent, and the
   chimney smokes" negates the Sweep; "the chimney is absent, and the Sweep
   stands on the ridge" does not. */
const PRESENCE_SCOPE_BREAK = /[,;:—–]|\b(?:and|but|while|whilst|although|though|however|yet|then|as|when|whereas|because|since)\b/gi;

/* The span that governs a mention: everything from the nearest clause break
   back-to-front, so an earlier independent statement cannot lend its negation. */
function presenceGoverningSpan(before) {
  const text = presenceText(before);
  let start = 0;
  PRESENCE_SCOPE_BREAK.lastIndex = 0;
  for (let match = PRESENCE_SCOPE_BREAK.exec(text); match; match = PRESENCE_SCOPE_BREAK.exec(text)) start = match.index + match[0].length;
  return text.slice(start);
}

/* Is THIS occurrence of the entity denied by the text around it. */
function mentionIsDenied(clause, matchStart, matchEnd) {
  const text = presenceText(clause);
  const rawBefore = text.slice(0, matchStart);
  const after = text.slice(matchEnd);
  const span = presenceGoverningSpan(rawBefore).replace(PRESENCE_NEGATION_IDIOMS, " ");
  /* "before the Sweep appears" — the lead word must govern the mention directly
     AND the mention must be arriving. Checked before the plain negation scan so
     "before" never counts on its own. */
  if (PRESENCE_TEMPORAL_LEAD.test(span) && PRESENCE_ARRIVAL_VERB.test(after)) return true;
  if (PRESENCE_TEMPORAL_LEAD.test(span)) return false;
  if (PRESENCE_NEGATION_WORDS.test(span)) return true;
  if (PRESENCE_DENYING_PREDICATE.test(after)) return true;
  return false;
}

/* Every position at which this entity is named in the clause.

   OVERLAPPING TOKENS ARE MERGED, and that is load-bearing rather than tidiness.
   An entity named "Chimbley Sweep" is matched by three tokens — the full name,
   "Chimbley" and "Sweep" — so "The Chimbley Sweep is absent" produced a mention
   ending after "Chimbley", whose following text is " Sweep is absent" and which
   therefore looked un-negated. Merging to the maximal span puts " is absent"
   immediately after the mention, which is where the predicate test can see it. */
function presenceMentions(clause, entity) {
  const haystack = presenceText(clause);
  const found = [];
  if (!haystack) return found;
  for (const token of presenceTokensFor(entity)) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])(${escapeForPresenceRegExp(token)})(?:['’]s)?($|[^A-Za-z0-9_-])`, "gi");
    for (let match = pattern.exec(haystack); match; match = pattern.exec(haystack)) {
      const start = match.index + match[1].length;
      found.push({ start, end: start + match[2].length });
      pattern.lastIndex = start + match[2].length;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const mention of found) {
    const last = merged[merged.length - 1];
    /* Adjacent as well as overlapping: "Chimbley" and "Sweep" are separated by
       one space and are one mention of one person. */
    if (last && mention.start <= last.end + 1) { last.end = Math.max(last.end, mention.end); continue; }
    merged.push({ ...mention });
  }
  return merged;
}

/* DOES THIS CLAUSE ASSERT THAT THIS ENTITY IS PRESENT. True when at least one
   mention survives its own negation test — a single positive mention is a
   contradiction however many negated ones surround it. */
function clauseAssertsPresence(clause, entity) {
  const mentions = presenceMentions(clause, entity);
  if (!mentions.length) return false;
  return mentions.some((mention) => !mentionIsDenied(clause, mention.start, mention.end));
}

/* Retained under its shipped name and now entity-aware. Called without an
   entity it answers the old, entity-blind question — kept only so an existing
   caller cannot crash, and no production path uses that form. */
function clauseDeniesPresence(clause, entity) {
  if (entity) return !clauseAssertsPresence(clause, entity);
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
        if (!clauseAssertsPresence(clause, entity)) continue;
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
      if (clauseAssertsPresence(clause, entity)) { withheldFor.push(presenceText(entity.id)); break; }
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

/* ==========================================================================
   THE UNIVERSAL FINAL PRE-PROVIDER GATE.

   The first repair enforced presence inside `/api/prompt/compile`. The audit's
   answer was that compilation is not the boundary anybody has to cross: the
   paid FAL route re-compiles only requests carrying `imagePlan: true` and only
   for `blocking` and `frame`, the automation dispatcher never sets that flag,
   and `correction` is excluded from the branch entirely. Every one of those
   requests fell through to `submit()`, which sends `job.prompt` verbatim.

   A check on a path a caller may decline to take is a suggestion.

   THIS runs at the one place every paid image request must pass — immediately
   before the durable job row is created and before anything leaves the machine.
   It reads:

     the CURRENT project              (not the one compilation saw)
     the resolved shot and frame      (identity, or a refusal)
     the EXACT FINAL PROMPT           (after every edit, improvement,
                                       correction and adapter addition)

   and it returns a refusal, never a repair. A contradicted request costs
   nothing: no job row, no provider call, no retry budget.

   FAIL CLOSED ON IDENTITY. A frame-specific paid request that cannot say which
   frame it is for, on a shot that declares presence for any frame, is refused —
   because the alternative is to apply no policy and call it success. That is
   the case `v626DerivativeBlockingBuild()` was in. */

/* The purposes that produce an image OF A FRAME. `entity-reference` has no
   frame and `motion-h3` is video built from already-approved stills, so neither
   carries a frame presence contract. */
const FRAME_SPECIFIC_PAID_PURPOSES = ["frame", "blocking", "correction"];

const FRAME_PRESENCE_REFUSAL_CODE = "FRAME_PRESENCE_CONTRADICTION";
const FRAME_IDENTITY_REFUSAL_CODE = "FRAME_PRESENCE_TARGET_UNRESOLVED";

/* Does this shot declare presence for ANY frame. When it does not, the contract
   is opt-in and absent, and a request without a frame id is the ordinary
   pre-contract case rather than a policy hole. */
function shotDeclaresFramePresence(shot) {
  const creation = presenceObject(presenceObject(shot).creationBrief);
  const workflows = presenceObject(creation.frameWorkflows);
  for (const frameId of Object.keys(workflows)) if (framePresenceDeclarations(shot, frameId).length) return true;
  return false;
}

/* The entity records for the ids a frame declares absent, resolved against the
   project so the gate knows every name each one answers to. */
function absentEntitiesForFrame(project, shot, frameId, lists = ["characters", "locations", "props", "vehicles"]) {
  const P = presenceObject(project);
  const wanted = absentEntityIdsForFrame(shot, frameId);
  if (!wanted.length) return [];
  const out = [];
  for (const id of wanted) {
    let found = null;
    for (const listName of presenceList(lists)) {
      found = presenceList(P[listName]).map(presenceObject).find((item) => presenceText(item.id) === id) || found;
      if (found) break;
    }
    out.push(found ? { id: presenceText(found.id), name: presenceText(found.name), aliases: presenceList(found.aliases) } : { id, name: "", aliases: [] });
  }
  return out;
}

/* THE GATE. Returns `{ok:true}` or a typed refusal. Pure: no I/O, no clock, no
   mutation, so the same call answers identically on the server, in a test and
   in a negative control. */
function finalDispatchPresenceGate(options = {}) {
  const it = presenceObject(options);
  const purpose = presenceText(it.purpose);
  if (!FRAME_SPECIFIC_PAID_PURPOSES.includes(purpose)) return { ok: true, applied: false, reason: "purpose-carries-no-frame-contract", contradictions: [] };
  const project = presenceObject(it.project);
  const shotId = presenceText(it.shotId);
  const frameId = presenceText(it.frameId);
  const shot = presenceList(project.shots).map(presenceObject).find((item) => presenceText(item.id) === shotId) || null;
  if (!shot) {
    /* No shot means no declaration can be read. Refused rather than waved
       through: a frame-specific paid request naming a shot that is not in the
       project is not a request this gate can clear. */
    return {
      ok: false,
      code: FRAME_IDENTITY_REFUSAL_CODE,
      classification: "local-preflight",
      contradictions: [],
      message: shotId
        ? `${shotId} is not in this project, so CineBraid cannot check which characters this frame excludes. No paid request was submitted.`
        : "This frame-specific generation did not name a shot, so CineBraid cannot check which characters the frame excludes. No paid request was submitted.",
    };
  }
  if (!shotDeclaresFramePresence(shot)) return { ok: true, applied: false, reason: "shot-declares-no-presence", contradictions: [] };
  if (!frameId) {
    /* FAIL CLOSED. The shot has a presence contract and this request cannot say
       which frame it is for. Answering "no contradictions" here is the audit's
       `v626DerivativeBlockingBuild` hole exactly. */
    return {
      ok: false,
      code: FRAME_IDENTITY_REFUSAL_CODE,
      classification: "local-preflight",
      contradictions: [],
      message: `${shotId} declares which characters are present in which frames, and this generation did not name a frame — so CineBraid cannot tell which contract applies. Generate from the frame you are working on. No paid request was submitted.`,
    };
  }
  const absent = absentEntitiesForFrame(project, shot, frameId, presenceList(it.entityLists).length ? it.entityLists : undefined);
  if (!absent.length) return { ok: true, applied: true, reason: "no-declared-absence", contradictions: [] };
  /* THE EXACT SUBMITTED TEXT, plus any structured spec the caller has. Reference
     labels and per-reference instructions travel with the request and are read
     by the model, so they are inspected too. */
  const referenceText = presenceList(it.references)
    .map(presenceObject)
    .flatMap((ref) => [presenceText(ref.label), presenceText(ref.instruction)])
    .filter(Boolean);
  const contradictions = framePresenceContradictions({
    absentEntities: absent,
    spec: presenceObject(it.spec),
    prompt: [presenceText(it.prompt), ...referenceText].filter(Boolean).join("\n"),
  });
  if (!contradictions.length) return { ok: true, applied: true, reason: "checked", contradictions: [] };
  return {
    ok: false,
    code: FRAME_PRESENCE_REFUSAL_CODE,
    classification: "local-preflight",
    contradictions,
    absentEntityIds: absent.map((entity) => entity.id),
    message: `This frame declares ${absent.map((entity) => entity.name || entity.id).join(", ")} absent, but the text about to be sent still puts ${contradictions.length === 1 ? "it" : "them"} in the picture. Nothing was sent to the provider and nothing was charged.`,
  };
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
  clauseAssertsPresence,
  presenceMentions,
  presenceGoverningSpan,
  presenceClauses,
  framePresenceContradictions,
  narrativeForFrame,
  absenceRequirements,
  FRAME_SPECIFIC_PAID_PURPOSES,
  FRAME_PRESENCE_REFUSAL_CODE,
  FRAME_IDENTITY_REFUSAL_CODE,
  shotDeclaresFramePresence,
  absentEntitiesForFrame,
  finalDispatchPresenceGate,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(FRAME_PRESENCE_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = FRAME_PRESENCE_EXPORTS;

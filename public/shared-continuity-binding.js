/* CINEBRAID — the declared entity-state binding, stated once.

   Browser and Node, the same way public/shared-entities.js and
   public/shared-coverage.js are shared.

   ONE FACT, ONE OWNER. A shot may declare which state of an entity it uses, and
   an individual frame may override that shot default. CineBraid has resolved
   that chain in the runtime since 6.7 — frame, then shot, then the entity's own
   default — but the fact lived only in two ad-hoc legacy shapes on the shot
   record, and OFP had no home for it, so a migrated project carried a
   director's declared state change as an opaque blob inside the legacy
   extension. P4-SEM-B makes it canonical inside the `continuity` profile.

   THE RULE, and it is the whole module:

       a frame-level binding for this entity
         beats a shot-level binding for this entity
         beats the entity's own default state

   ABSENCE MEANS INHERIT. There is no `inherit: true`, no "same as shot" marker
   and no stored copy of the inherited value. An explicit frame override does
   not touch the shot default and changing the shot default does not touch an
   explicit frame override, because neither is ever written into the other.

   STATE IDS ARE OWNER-SCOPED. This is the constraint that shapes everything
   here. In the real corpus all twelve state records across every entity of
   overfit-18 carry the id `state-default`, which is legal — `id.duplicate` is
   defined per collection — and permanent. So a binding NEVER says `stateId`
   alone: it always says `{ entityId, stateId }` and the state is resolved
   within that entity and nowhere else. Nothing in this file, and nothing that
   uses it, may look a state id up globally.

   TWO REPRESENTATIONS, ONE MEANING. CineBraid's live project record and an OFP
   document store the same fact in different shapes, so this file owns the
   translation as well as the rule:

     runtime   shot.continuityStateSelections{entityId: stateId}
               shot.creationBrief.frameWorkflows[frameId].{character,location,
               prop,vehicle}StateSelections{entityId: stateId}
               shot.creationBrief.frameWorkflows[frameId].locationStateId

     canonical continuity.shots[].entityStates[]{entityId, stateId}
               continuity.shots[].frames[].entityStates[]{entityId, stateId}

   `readShotStateBindings` is the ONLY reader of the runtime shape and
   `buildContinuityProfile` is the ONLY writer of the canonical one, so the two
   cannot drift into disagreeing about what a project declares. A test resolves
   the same question through both and asserts they answer identically.

   Deliberately absent, and required to stay absent:
     - file or network I/O
     - provider or model awareness
     - Date.now(), new Date(), Math.random()

   ONE NARROW MUTATION. `applyShotStateDeclaration` is the product boundary for
   writing the runtime shot binding. It validates the same owner-scoped fact this
   module reads, including that the entity is genuinely attached to the shot,
   before changing `shot.continuityStateSelections`. No UI caller gets to restate
   those rules. Every other function in this module remains read-only. */

/* The profile name as it appears in `format.profiles`. */
const CONTINUITY_PROFILE_ID = "continuity";

/* The legacy runtime storage, named in one place so a reader elsewhere is a
   spelling mistake rather than a second opinion. */
const RUNTIME_SHOT_SELECTION_KEY = "continuityStateSelections";
const RUNTIME_VISUAL_ENTITY_LISTS = ["characters", "locations", "props", "vehicles"];
const SHOT_STATE_DECLARATION_RESULTS = [
  "applied",
  "shot-not-found",
  "entity-not-found",
  "entity-not-attached",
  "state-not-found",
  "state-owned-by-different-entity",
  "invalid-declaration",
];
const RUNTIME_FRAME_SELECTION_KEYS = {
  character: "characterStateSelections",
  location: "locationStateSelections",
  prop: "propStateSelections",
  vehicle: "vehicleStateSelections",
};
/* Locations kept their own shape: a single state id on the frame record with no
   entity beside it, because the frame has one location. It is what server.js
   has always read when assembling a frame's design authorities, so it is
   honoured rather than deprecated - but it can only become a canonical binding
   when the shot's location is known, which is why every entry point that reads
   it takes the location entity id explicitly. */
const RUNTIME_FRAME_LOCATION_KEY = "locationStateId";

const RUNTIME_FRAME_SELECTION_KEY_LIST = Object.values(RUNTIME_FRAME_SELECTION_KEYS);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

/* Locale-independent, the same ordering the OFP serializer uses. */
function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------- the canonical in-memory model ---------------------------------

   A BINDING SET is what one shot declares:

       { shotId, entityStates: [{entityId, stateId}], frames: [{frameId, entityStates}] }

   It is the same object whether it came from a live CineBraid project or from
   an OFP document, which is what makes one resolver enough for both. */

/* Normalize to exactly the two canonical fields. `from` - the relative source
   pointer a runtime reading carries - is deliberately dropped here: it is
   provenance for the migration report and must never reach the document. */
function bindingList(source) {
  const out = [];
  if (!Array.isArray(source)) return out;
  for (const entry of source) {
    if (!isObject(entry)) continue;
    const entityId = text(entry.entityId);
    const stateId = text(entry.stateId);
    if (!entityId || !stateId) continue;
    out.push({ entityId, stateId });
  }
  return out;
}

/* RFC 6901 encoding, so a `from` pointer and a migration ledger key are the
   same string and compare without normalising either. */
function pointerToken(token) {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

/* First wins. Duplicates at one scope are a validation ERROR rather than a
   merge, and a resolver that picked the last would make the reported error and
   the resolved value disagree about which one is live. */
function pickBinding(entityStates, entityId) {
  const wanted = text(entityId);
  if (!wanted) return "";
  for (const entry of entityStates || []) if (entry && entry.entityId === wanted) return entry.stateId;
  return "";
}

/* THE RULE. Everything else in this file exists to hand this function the same
   binding set no matter which representation the caller started from.

   Returns "" for "nothing is declared here", which the caller resolves against
   the entity's own default - deliberately NOT the default itself, because this
   function has no entity and must never guess one. */
function resolveBoundStateId(bindingSet, frameId, entityId) {
  if (!isObject(bindingSet)) return "";
  const wantedFrame = text(frameId);
  if (wantedFrame) {
    const frame = (bindingSet.frames || []).find((entry) => entry && entry.frameId === wantedFrame);
    if (frame) {
      const fromFrame = pickBinding(frame.entityStates, entityId);
      if (fromFrame) return fromFrame;
    }
  }
  return pickBinding(bindingSet.entityStates, entityId);
}

function isEmptyBindingSet(bindingSet) {
  if (!isObject(bindingSet)) return true;
  if ((bindingSet.entityStates || []).length) return false;
  return !(bindingSet.frames || []).some((frame) => frame && (frame.entityStates || []).length);
}

/* ---------- reading the runtime shape -------------------------------------

   Read-only by construction: nothing here creates a key, normalizes a workflow
   record or repairs a shot. A binding set built from a project must be usable
   during a migration preview, where touching the source is the defect.

   `locationEntityId` is the entity a bare `locationStateId` belongs to. The
   caller supplies it because this file cannot resolve a shot's location without
   knowing the project, and inventing one would attach a director's declared
   state to whichever location happened to sort first. Absent, a bare
   locationStateId produces NO binding and the caller is told, which is the
   §11 rule: migration does not manufacture what the source does not say. */
function readShotStateBindings(shot, options = {}) {
  const s = isObject(shot) ? shot : {};
  const shotId = text(options.shotId || s.id);
  const locationEntityId = text(options.locationEntityId);
  const frameIds = Array.isArray(options.frameIds) ? options.frameIds.map(text).filter(Boolean) : null;

  const entityStates = [];
  const shotSelections = isObject(s[RUNTIME_SHOT_SELECTION_KEY]) ? s[RUNTIME_SHOT_SELECTION_KEY] : {};
  for (const entityId of Object.keys(shotSelections)) {
    const stateId = text(shotSelections[entityId]);
    if (!entityId || !stateId) continue;
    entityStates.push({ entityId, stateId, from: `/${RUNTIME_SHOT_SELECTION_KEY}/${pointerToken(entityId)}` });
  }

  const creation = isObject(s.creationBrief) ? s.creationBrief : {};
  const workflows = isObject(creation.frameWorkflows) ? creation.frameWorkflows : {};
  const frames = [];
  /* Frame order follows the shot's own frames when the caller supplies them, so
     a three-frame shot reads A, B, C rather than whatever order the workflow
     map happens to have been written in. Any workflow key the shot has no frame
     for still appears - dropping it would hide a stale selection the caller has
     to be told about. */
  const workflowIds = Object.keys(workflows);
  const orderedIds = frameIds
    ? [...frameIds.filter((id) => workflowIds.includes(id)), ...workflowIds.filter((id) => !frameIds.includes(id))]
    : workflowIds;
  for (const frameId of orderedIds) {
    const workflow = workflows[frameId];
    if (!isObject(workflow)) continue;
    const perFrame = [];
    const seen = new Set();
    const frameBase = `/creationBrief/frameWorkflows/${pointerToken(frameId)}`;
    for (const key of RUNTIME_FRAME_SELECTION_KEY_LIST) {
      const map = workflow[key];
      if (!isObject(map)) continue;
      for (const entityId of Object.keys(map)) {
        const stateId = text(map[entityId]);
        if (!entityId || !stateId || seen.has(entityId)) continue;
        seen.add(entityId);
        perFrame.push({ entityId, stateId, from: `${frameBase}/${key}/${pointerToken(entityId)}` });
      }
    }
    /* The bare location id is honoured only where an explicit per-entity
       selection has not already spoken for that location - the same precedence
       the runtime resolver has always applied. */
    const bare = text(workflow[RUNTIME_FRAME_LOCATION_KEY]);
    if (bare && locationEntityId && !seen.has(locationEntityId)) {
      seen.add(locationEntityId);
      perFrame.push({ entityId: locationEntityId, stateId: bare, from: `${frameBase}/${RUNTIME_FRAME_LOCATION_KEY}` });
    }
    if (!perFrame.length) continue;
    frames.push({ frameId, entityStates: perFrame });
  }

  return { shotId, entityStates, frames };
}

/* Where a bare locationStateId exists that this reading could NOT attribute to
   an entity. Reported, never guessed. */
function unattributedFrameLocationStates(shot, options = {}) {
  const s = isObject(shot) ? shot : {};
  const locationEntityId = text(options.locationEntityId);
  const creation = isObject(s.creationBrief) ? s.creationBrief : {};
  const workflows = isObject(creation.frameWorkflows) ? creation.frameWorkflows : {};
  const out = [];
  for (const frameId of Object.keys(workflows)) {
    const workflow = workflows[frameId];
    if (!isObject(workflow)) continue;
    const bare = text(workflow[RUNTIME_FRAME_LOCATION_KEY]);
    if (!bare) continue;
    const explicit = isObject(workflow[RUNTIME_FRAME_SELECTION_KEYS.location])
      ? workflow[RUNTIME_FRAME_SELECTION_KEYS.location]
      : {};
    if (locationEntityId && !text(explicit[locationEntityId])) continue;
    out.push({ frameId, stateId: bare, reason: locationEntityId ? "a per-entity location selection already speaks for this frame" : "the shot names no location, so the state has no owner" });
  }
  return out;
}

/* ---------- the canonical OFP shape ---------------------------------------- */

/* Build the `continuity` block from binding sets. Returns null when there is
   nothing to declare, so a caller can honour the rule that the profile is not
   declared for data that does not exist.

   Shot and frame order come from the caller - they are ORDERED collections and
   array order is data. `entityStates` is sorted by entity id, because it is a
   set with no natural order and two projects that declare the same bindings
   must produce the same document. */
function buildContinuityProfile(bindingSets) {
  const shots = [];
  for (const bindingSet of Array.isArray(bindingSets) ? bindingSets : []) {
    if (!isObject(bindingSet)) continue;
    const shotId = text(bindingSet.shotId);
    if (!shotId || isEmptyBindingSet(bindingSet)) continue;
    const record = { shotId };
    const entityStates = bindingList(bindingSet.entityStates).sort((a, b) => compareIds(a.entityId, b.entityId));
    if (entityStates.length) record.entityStates = entityStates;
    const frames = [];
    for (const frame of bindingSet.frames || []) {
      if (!isObject(frame)) continue;
      const frameId = text(frame.frameId);
      const bindings = bindingList(frame.entityStates).sort((a, b) => compareIds(a.entityId, b.entityId));
      if (!frameId || !bindings.length) continue;
      frames.push({ frameId, entityStates: bindings });
    }
    if (frames.length) record.frames = frames;
    shots.push(record);
  }
  return shots.length ? { shots } : null;
}

/* Read one shot's binding set back out of an OFP `continuity` block. The
   inverse of buildContinuityProfile, and the reason the drift guard can ask the
   same question of a live project and of a serialized document. */
function continuityProfileBindings(profile, shotId) {
  const wanted = text(shotId);
  const shots = isObject(profile) && Array.isArray(profile.shots) ? profile.shots : [];
  const record = shots.find((entry) => isObject(entry) && text(entry.shotId) === wanted);
  if (!record) return { shotId: wanted, entityStates: [], frames: [] };
  const frames = [];
  for (const frame of Array.isArray(record.frames) ? record.frames : []) {
    if (!isObject(frame)) continue;
    const frameId = text(frame.frameId);
    if (!frameId) continue;
    frames.push({ frameId, entityStates: bindingList(frame.entityStates) });
  }
  return { shotId: wanted, entityStates: bindingList(record.entityStates), frames };
}

/* The same resolution rule, entered from an OFP document. */
function resolveProfileStateId(profile, shotId, frameId, entityId) {
  return resolveBoundStateId(continuityProfileBindings(profile, shotId), frameId, entityId);
}

/* ---------- shared with the validator -------------------------------------

   Duplicate detection is here rather than in ofp-validate.js so that "two
   bindings for one entity at one scope" means the same thing to the thing that
   REPORTS it and the thing that RESOLVES it. `pickBinding` takes the first;
   this names every entity that has more than one, in document order. */
function duplicateBindingEntityIds(entityStates) {
  const seen = new Set();
  const duplicates = [];
  for (const entry of Array.isArray(entityStates) ? entityStates : []) {
    if (!isObject(entry)) continue;
    const entityId = text(entry.entityId);
    if (!entityId) continue;
    if (seen.has(entityId)) { if (!duplicates.includes(entityId)) duplicates.push(entityId); continue; }
    seen.add(entityId);
  }
  return duplicates;
}

/* Owner-scoped state resolution, stated once for every caller that has a list
   of an entity's states in hand. `states` is the entity's OWN catalogue and
   nothing else: the OFP core `entities.*[].states[]`, or the runtime
   `entity.continuityStates[]`. There is no global lookup and there must never
   be one - twelve entities in the real corpus all declare `state-default`. */
function stateIdBelongsToEntity(states, stateId) {
  const wanted = text(stateId);
  if (!wanted) return false;
  return (Array.isArray(states) ? states : []).some((state) => isObject(state) && text(state.id) === wanted);
}

/* ---------- the one runtime shot-binding mutation -------------------------

   A declaration is `{ shotId, entityId, stateId }`. `stateId: ""` is the
   explicit cleanup operation used when an attachment is removed; the rendered
   assignment control never offers it as a state.

   Failure is closed and non-mutating. In particular, the selection map is not
   created until every entity/attachment/state check has passed. A foreign-state
   diagnostic may inspect the other catalogues only to explain the refusal; it
   never resolves through them. If the requested entity owns the id, that
   owner-scoped fact wins even when another entity legally uses the same id. */
function shotStateDeclarationResult(status, declaration, extra = {}) {
  const result = {
    status: SHOT_STATE_DECLARATION_RESULTS.includes(status) ? status : "invalid-declaration",
    shotId: text(declaration && declaration.shotId),
    entityId: text(declaration && declaration.entityId),
    stateId: text(declaration && declaration.stateId),
    ...extra,
  };
  return Object.freeze(result);
}

function runtimeVisualEntityEntries(project) {
  const P = isObject(project) ? project : {};
  const rows = [];
  for (const list of RUNTIME_VISUAL_ENTITY_LISTS) {
    for (const entity of Array.isArray(P[list]) ? P[list] : []) {
      if (!isObject(entity) || !text(entity.id)) continue;
      rows.push({ list, entity });
    }
  }
  return rows;
}

function shotEntityResolverOwner() {
  if (typeof resolveShotEntities === "function") return resolveShotEntities;
  const global = typeof globalThis !== "undefined" ? globalThis : {};
  if (typeof global.resolveShotEntities === "function") return global.resolveShotEntities;
  if (typeof module !== "undefined" && module.exports) {
    const shared = require("./shared-entities");
    if (typeof shared.resolveShotEntities === "function") return shared.resolveShotEntities;
  }
  return null;
}

function applyShotStateDeclaration(project, declaration = {}) {
  const P = isObject(project) ? project : null;
  if (!P || !isObject(declaration)) return shotStateDeclarationResult("invalid-declaration", declaration);
  const shotId = text(declaration.shotId);
  const entityId = text(declaration.entityId);
  const stateId = text(declaration.stateId);
  if (!shotId || !entityId) return shotStateDeclarationResult("invalid-declaration", declaration);

  const shot = (Array.isArray(P.shots) ? P.shots : []).find((row) => isObject(row) && text(row.id) === shotId);
  if (!shot) return shotStateDeclarationResult("shot-not-found", declaration);

  const entries = runtimeVisualEntityEntries(P).filter((row) => text(row.entity.id) === entityId);
  if (!entries.length) return shotStateDeclarationResult("entity-not-found", declaration);
  if (entries.length !== 1) return shotStateDeclarationResult("invalid-declaration", declaration);

  const resolver = shotEntityResolverOwner();
  if (!resolver) return shotStateDeclarationResult("invalid-declaration", declaration);
  const attached = resolver(P, shot);
  const attachedIds = [
    ...(attached.characters || []),
    ...(attached.locations || []),
    ...(attached.props || []),
    ...(attached.vehicles || []),
  ].map((entity) => text(entity && entity.id)).filter(Boolean);
  if (!attachedIds.includes(entityId)) return shotStateDeclarationResult("entity-not-attached", declaration);

  const current = shot[RUNTIME_SHOT_SELECTION_KEY];
  if (current !== undefined && current !== null && !isObject(current))
    return shotStateDeclarationResult("invalid-declaration", declaration);

  /* Attachment cleanup is part of this owner so a detach cannot leave a valid
     binding behind that later masquerades as an attachment of its own. */
  if (!stateId) {
    const existed = isObject(current) && Object.prototype.hasOwnProperty.call(current, entityId);
    if (existed) delete current[entityId];
    return shotStateDeclarationResult("applied", declaration, { changed: existed, operation: "cleared" });
  }

  const entity = entries[0].entity;
  const states = Array.isArray(entity.continuityStates) ? entity.continuityStates : [];
  if (!stateIdBelongsToEntity(states, stateId)) {
    const foreign = runtimeVisualEntityEntries(P).some((row) => row.entity !== entity
      && stateIdBelongsToEntity(row.entity.continuityStates, stateId));
    return shotStateDeclarationResult(foreign ? "state-owned-by-different-entity" : "state-not-found", declaration);
  }

  const selections = isObject(current) ? current : {};
  const changed = text(selections[entityId]) !== stateId;
  if (!isObject(current)) shot[RUNTIME_SHOT_SELECTION_KEY] = selections;
  selections[entityId] = stateId;
  return shotStateDeclarationResult("applied", declaration, { changed, operation: "selected" });
}

const CONTINUITY_BINDING_EXPORTS = {
  CONTINUITY_PROFILE_ID,
  RUNTIME_SHOT_SELECTION_KEY,
  RUNTIME_VISUAL_ENTITY_LISTS,
  SHOT_STATE_DECLARATION_RESULTS,
  RUNTIME_FRAME_SELECTION_KEYS,
  RUNTIME_FRAME_SELECTION_KEY_LIST,
  RUNTIME_FRAME_LOCATION_KEY,
  readShotStateBindings,
  unattributedFrameLocationStates,
  resolveBoundStateId,
  isEmptyBindingSet,
  buildContinuityProfile,
  continuityProfileBindings,
  resolveProfileStateId,
  duplicateBindingEntityIds,
  stateIdBelongsToEntity,
  applyShotStateDeclaration,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(CONTINUITY_BINDING_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = CONTINUITY_BINDING_EXPORTS;

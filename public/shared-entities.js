/* Shared shot-entity resolver for browser and Node. */
function shotEntityTokenMatches(token, entityId) {
  const value = String(token || "");
  const id = String(entityId || "");
  return !!id && (value === id || value.startsWith(id + "-") || value.startsWith(id + "_"));
}

function entityTextValue(value) {
  return String(value == null ? "" : value).trim();
}
/* Is this list/type name a character? Callers hold either a project list key
   ("characters") or an entity type ("character"), so both are accepted. */
function entityKindIsCharacter(kind) {
  return /^character/i.test(String(kind || ""));
}
/* One production visual description for the whole product.

   Before this existed, five consumers each guessed their own order and
   Creation Studio's own field was missing from the one that matters most:
   the prompt compiler resolved `block || description`, so a description
   authored through the current UI reached continuity but never reached
   image generation.

   Precedence, from what actually writes each field today:

     creationDescription  the field Creation Studio writes (setCreationDescription)
     visualDescription    the Project Builder import contract's name for it
     block                characters only — the historical canon block, and
                          already first for characters in every current reader
     description          the generic legacy visual description, and already
                          first for non-characters in the prompt compiler
     notes                the legacy production note the non-character editors
                          wrote, and the last-resort description elsewhere

   The final entry re-checks the other type's field so no stored text is ever
   unreachable. Order beyond the first entry is chosen so that every entity
   that resolves to something today keeps resolving to the same text; the only
   change is that entities which resolved to nothing can now resolve. */
function entityVisualDescription(entity, kind = "") {
  const record = entity && typeof entity === "object" ? entity : {};
  const ordered = entityKindIsCharacter(kind)
    ? [record.creationDescription, record.visualDescription, record.block, record.description, record.notes]
    : [record.creationDescription, record.visualDescription, record.description, record.notes, record.block];
  for (const value of ordered) {
    const text = entityTextValue(value);
    if (text) return text;
  }
  return "";
}

/* Shot duration carries three historical aliases. `dur` is what every current
   writer produces (Project Builder normalization, the shot editor, the guided
   composer), so it wins. `sec` precedes `duration` because the two report
   readers that consult both — the scene beat sheet and the shot list — have
   always read `shot.sec || shot.duration`.

   Only a positive finite number counts as supplied; anything else falls
   through, which is what keeps a stored 0 or "" meaning "not declared". */
const SHOT_DURATION_ALIASES = Object.freeze(["dur", "sec", "duration"]);
function shotDurationAlias(source) {
  const record = source && typeof source === "object" ? source : {};
  for (const field of SHOT_DURATION_ALIASES) {
    const seconds = Number(record[field]);
    if (Number.isFinite(seconds) && seconds > 0) return { seconds, field };
  }
  return null;
}
/* Seconds declared by any supported alias, or 0 when none of them did. */
function shotDurationSeconds(source) {
  return shotDurationAlias(source)?.seconds || 0;
}
/* The effective duration of a shot or one of its segments, plus whether the
   number had to be invented. A shot's own aliases lose to its motion units,
   because a shot split into clips is as long as its clips — that ordering is
   unchanged from the original expression this replaced. */
function resolveShotDuration(shot, segment = null, fallbackSeconds = 5) {
  const fallback = Number(fallbackSeconds) > 0 ? Number(fallbackSeconds) : 5;
  if (segment) {
    const declared = shotDurationAlias(segment);
    return {
      seconds: declared ? declared.seconds : fallback,
      wasDefaulted: !declared,
      field: declared ? declared.field : "",
      source: declared ? "segment" : "default",
    };
  }
  const record = shot && typeof shot === "object" ? shot : {};
  const clips = Array.isArray(record.clips) ? record.clips : [];
  const planned = clips.reduce((total, clip) => total + shotDurationSeconds(clip), 0);
  if (planned > 0) return { seconds: planned, wasDefaulted: false, field: "clips", source: "clips" };
  const declared = shotDurationAlias(record);
  if (declared) return { seconds: declared.seconds, wasDefaulted: false, field: declared.field, source: "shot" };
  return { seconds: fallback, wasDefaulted: true, field: "", source: "default" };
}

function resolveShotEntities(project, shot) {
  const P = project && typeof project === "object" ? project : {};
  const s = shot && typeof shot === "object" ? shot : {};
  const codes = Array.isArray(s.codes) ? s.codes : [];
  const characterTokens = [...(Array.isArray(s.characters) ? s.characters : []), ...codes];
  const locationTokens = [...codes, s.creationBrief?.locationId || ""];
  const propTokens = [...codes, ...(Array.isArray(s.creationBrief?.propIds) ? s.creationBrief.propIds : [])];
  const audioTokens = codes;
  const resolve = (list, tokens) => (Array.isArray(list) ? list : []).filter((entity) =>
    tokens.some((token) => shotEntityTokenMatches(token, entity?.id)),
  );
  const props = resolve(P.props, propTokens);
  const vehicles = resolve(P.vehicles, propTokens);
  return {
    characters: resolve(P.characters, characterTokens),
    locations: resolve(P.locations, locationTokens),
    props: [...props, ...vehicles],
    vehicles,
    audio: resolve(P.audio, audioTokens),
  };
}


/* What each `codes[]` token actually resolved to, so the loss becomes visible.

   `codes[]` is an undeclared union namespace: one token is offered to every
   entity list, and shotEntityTokenMatches accepts an exact id, or an id
   followed by "-" or "_". So LOC-HULL-A resolves to LOC-HULL and the "-A"
   — which carried a reference view in real productions — is discarded, and
   STAGE-3 resolves to nothing at all. Both happen silently today.

   This classifies; it does not resolve. The winner is still whatever the
   existing resolvers pick, and no token is rewritten. */
function classifyShotCodeTokens(project, shot) {
  const P = project && typeof project === "object" ? project : {};
  const s = shot && typeof shot === "object" ? shot : {};
  const lists = [
    ["character", Array.isArray(P.characters) ? P.characters : []],
    ["location", Array.isArray(P.locations) ? P.locations : []],
    ["prop", Array.isArray(P.props) ? P.props : []],
    ["vehicle", Array.isArray(P.vehicles) ? P.vehicles : []],
    ["audio", Array.isArray(P.audio) ? P.audio : []],
  ];
  return (Array.isArray(s.codes) ? s.codes : []).map((raw) => {
    const token = String(raw == null ? "" : raw);
    const matches = [];
    for (const [type, list] of lists)
      for (const entity of list)
        if (shotEntityTokenMatches(token, entity?.id))
          matches.push({ type, id: String(entity.id), name: String(entity.name || entity.id) });
    const exact = matches.find((match) => match.id === token) || null;
    const primary = exact || matches[0] || null;
    const status = !primary
      ? "unresolved"
      : matches.length > 1
        ? "ambiguous"
        : exact
          ? "exact"
          : "reinterpreted";
    return {
      token,
      status,
      type: primary ? primary.type : shotDependencyTokenType(token),
      id: primary ? primary.id : "",
      name: primary ? primary.name : "",
      /* The specificity the compatibility rule threw away, when it threw any away. */
      discarded: primary && primary.id !== token ? token.slice(primary.id.length) : "",
      matches,
    };
  });
}
/* Tokens whose stored specificity did not survive resolution, or that named
   nothing at all. Exact matches are quiet by design. */
function lossyShotCodeTokens(project, shot) {
  return classifyShotCodeTokens(project, shot).filter((row) => row.status !== "exact");
}

function shotDependencyTokenType(token) {
  const value = String(token || "").trim().toUpperCase();
  if (/^(CHAR|CHARACTER)[-_]/.test(value)) return "character";
  if (/^(LOC|LOCATION|PLATE)[-_]/.test(value)) return "location";
  if (/^(VEH|VEHICLE|SHIP|CAR)[-_]/.test(value)) return "vehicle";
  if (/^(PROP|PR)[-_]/.test(value)) return "prop";
  if (/^(AUDIO|VOICE|SFX|MUSIC)[-_]/.test(value)) return "audio";
  return "";
}

function shotDependencyRecords(project, shot) {
  const P = project && typeof project === "object" ? project : {};
  const s = shot && typeof shot === "object" ? shot : {};
  const creation = s.creationBrief && typeof s.creationBrief === "object" ? s.creationBrief : {};
  const records = [];
  const seen = new Map();
  const lists = {
    character: Array.isArray(P.characters) ? P.characters : [],
    location: Array.isArray(P.locations) ? P.locations : [],
    prop: Array.isArray(P.props) ? P.props : [],
    vehicle: Array.isArray(P.vehicles) ? P.vehicles : [],
    audio: Array.isArray(P.audio) ? P.audio : [],
  };
  const add = (type, id, source, options = {}) => {
    const rawId = String(id || "").trim();
    if (!rawId || !type) return;
    const candidates = type === "prop-or-vehicle" ? [...lists.prop, ...lists.vehicle] : lists[type] || [];
    /* Some authored attachment fields are established token namespaces: they
       preserve a canonical entity id plus a view/variant suffix. Resolve those
       exact-first through the same matcher as resolveShotEntities; exact-ID
       relationships such as speakerId deliberately do not opt into this. */
    const exact = candidates.find((item) => String(item?.id || "") === rawId) || null;
    const entity = exact || (options.tokenNamespace
      ? candidates.find((item) => shotEntityTokenMatches(rawId, item?.id)) || null
      : null);
    const resolvedType = entity && type === "prop-or-vehicle"
      ? (lists.vehicle.includes(entity) ? "vehicle" : "prop")
      : type;
    const canonicalId = entity ? String(entity.id) : rawId;
    const key = `${resolvedType}:${canonicalId}`;
    const existing = seen.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    const row = {
      type: resolvedType,
      requestedType: type,
      id: canonicalId,
      entity,
      resolved: !!entity,
      sources: [source],
      inferred: !!options.inferred,
    };
    seen.set(key, row);
    records.push(row);
  };

  for (const id of Array.isArray(s.characters) ? s.characters : []) add("character", id, "characters", { tokenNamespace: true });
  add("location", creation.locationId, "creationBrief.locationId", { tokenNamespace: true });
  for (const id of Array.isArray(creation.propIds) ? creation.propIds : []) add("prop-or-vehicle", id, "creationBrief.propIds", { tokenNamespace: true });
  for (const id of Array.isArray(creation.vehicleIds) ? creation.vehicleIds : []) add("vehicle", id, "creationBrief.vehicleIds", { tokenNamespace: true });

  const audio = s.audio && typeof s.audio === "object" ? s.audio : {};
  add("character", audio.speakerId, "audio.speakerId");
  add("audio", audio.voiceEntityId, "audio.voiceEntityId");
  for (const clip of Array.isArray(s.clips) ? s.clips : []) {
    add("character", clip?.speakerId, `clips.${clip?.id || clip?.suffix || "clip"}.speakerId`);
    add("character", clip?.motionBrief?.dialogue?.speakerId, `clips.${clip?.id || clip?.suffix || "clip"}.motionBrief.dialogue.speakerId`);
    add("audio", clip?.voiceEntityId, `clips.${clip?.id || clip?.suffix || "clip"}.voiceEntityId`);
  }
  const motionAudio = creation.motionPlan?.audio || {};
  add("character", motionAudio.speakerId, "creationBrief.motionPlan.audio.speakerId");
  add("audio", motionAudio.voiceEntityId, "creationBrief.motionPlan.audio.voiceEntityId");

  for (const id of Object.keys(s.continuityStateSelections || {})) {
    const type = lists.character.some((item) => item.id === id) ? "character"
      : lists.location.some((item) => item.id === id) ? "location"
      : lists.prop.some((item) => item.id === id) ? "prop"
      : lists.vehicle.some((item) => item.id === id) ? "vehicle"
      : shotDependencyTokenType(id);
    if (type) add(type, id, "continuityStateSelections", { inferred: true });
  }

  for (const token of Array.isArray(s.codes) ? s.codes : []) {
    const known = [
      ...lists.character.map((entity) => ["character", entity]),
      ...lists.location.map((entity) => ["location", entity]),
      ...lists.prop.map((entity) => ["prop", entity]),
      ...lists.vehicle.map((entity) => ["vehicle", entity]),
      ...lists.audio.map((entity) => ["audio", entity]),
    ].find(([, entity]) => shotEntityTokenMatches(token, entity?.id));
    if (known) add(known[0], known[1].id, "codes");
    else {
      const inferredType = shotDependencyTokenType(token);
      if (inferredType) {
        const existing = records.find((row) => !row.resolved && row.type === inferredType && shotEntityTokenMatches(token, row.id));
        if (existing) {
          if (!existing.sources.includes("codes")) existing.sources.push("codes");
        } else add(inferredType, token, "codes", { inferred: true });
      }
    }
  }
  return records;
}

/* The deterministic relationship truth for shot-scoped continuity state.

   This is deliberately narrower than `shotDependencyRecords`: audio/voice
   records are production dependencies, but they cannot own visual continuity
   state. It is deliberately broader than `resolveShotEntities`: speakers and
   creation-brief vehicles are real product relationships even when they are
   absent from the primary attachment fields that composer-oriented callers
   use. Most importantly, a continuity declaration is never evidence for its
   own relationship. */
const SHOT_STATE_BEARING_ENTITY_TYPES = Object.freeze(["character", "location", "prop", "vehicle"]);
const SHOT_STATE_BEARING_RELATIONSHIP_SOURCES = Object.freeze([
  "characters",
  "creationBrief.locationId",
  "creationBrief.propIds",
  "creationBrief.vehicleIds",
  "audio.speakerId",
  "creationBrief.motionPlan.audio.speakerId",
  "codes",
]);
function shotDependencySourceIsStateBearing(source) {
  const value = String(source || "");
  return SHOT_STATE_BEARING_RELATIONSHIP_SOURCES.includes(value)
    || (value.startsWith("clips.") && value.endsWith(".speakerId"));
}
function shotStateBearingEntityRecords(project, shot) {
  return shotDependencyRecords(project, shot).filter((record) =>
    SHOT_STATE_BEARING_ENTITY_TYPES.includes(record.type)
      && (record.sources || []).some(shotDependencySourceIsStateBearing),
  );
}

function unresolvedShotDependencies(project, shot) {
  return shotDependencyRecords(project, shot).filter((row) => !row.resolved);
}

/* ==========================================================================
   IS THIS REFERENCE CURRENTLY DEMANDED BY PRODUCTION?

   THE QUESTION THIS ANSWERS, and the one it deliberately does not.

     answers      does any shot in this project currently relate to this entity
                  in a way that makes its visual reference an input?
     does not     is that reference approved, required, satisfied, or good.
                  Those are requirement and authority questions and they have
                  their own owners — public/shared-coverage.js and the kernel.

   WHY IT EXISTS. Reference requirements were being read off EXISTENCE. Adding a
   character seeded four required coverage slots, and the reference surface
   immediately reported "4 required references still needed" — in the same
   sentence as "No shot references this yet". Two true facts, and the loud one
   was a backlog the production had never asked for.

   WHY IT IS THE STATE-BEARING PROJECTION AND NOT shotDependencyRecords().

   public/shared-shot-readiness.js gates every entity-state requirement it
   raises on exactly this set — `context.attachedIds` is
   shotStateBearingEntityRecords() filtered to resolved rows. So a reference
   surface that asks the same question can never disagree with Production about
   which entities are dormant, which is the whole of the agreement requirement.
   The broader dependency record deliberately includes sources that readiness
   refuses as inputs — a continuity declaration is "a stale relationship
   decision, not an input to every unit" — and a demand derived from those would
   manufacture the backlog again through a second door.

   `known: false` for a type this build does not recognise. The caller then says
   nothing about demand rather than asserting an absence it cannot support,
   which is the same refusal entityProductionUse() already makes for an
   unrecognised collection.

   DERIVED, NEVER STORED, and pure: no clock, no filesystem, no network, and no
   write of any kind to the project it reads. */
function entityReferenceDemand(project, type, entityId) {
  const P = project && typeof project === "object" ? project : {};
  const wanted = String(entityId || "").trim();
  const kind = String(type || "").trim();
  if (!wanted || !SHOT_STATE_BEARING_ENTITY_TYPES.includes(kind)) {
    return { known: false, demanded: false, shotIds: [], total: (Array.isArray(P.shots) ? P.shots : []).length };
  }
  const shots = Array.isArray(P.shots) ? P.shots : [];
  const shotIds = [];
  for (const shot of shots) {
    if (!shot || typeof shot !== "object") continue;
    const uses = shotStateBearingEntityRecords(P, shot).some((row) =>
      row && row.resolved && row.type === kind && String((row.entity && row.entity.id) || row.id) === wanted);
    if (uses) shotIds.push(String(shot.id || ""));
  }
  return { known: true, demanded: shotIds.length > 0, shotIds, total: shots.length };
}

if (typeof window !== "undefined") {
  window.shotEntityTokenMatches = shotEntityTokenMatches;
  window.entityVisualDescription = entityVisualDescription;
  window.resolveShotDuration = resolveShotDuration;
  window.shotDurationSeconds = shotDurationSeconds;
  window.resolveShotEntities = resolveShotEntities;
  window.classifyShotCodeTokens = classifyShotCodeTokens;
  window.lossyShotCodeTokens = lossyShotCodeTokens;
  window.shotDependencyTokenType = shotDependencyTokenType;
  window.shotDependencyRecords = shotDependencyRecords;
  window.shotStateBearingEntityRecords = shotStateBearingEntityRecords;
  window.entityReferenceDemand = entityReferenceDemand;
  window.unresolvedShotDependencies = unresolvedShotDependencies;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    shotEntityTokenMatches,
    entityKindIsCharacter,
    entityVisualDescription,
    SHOT_DURATION_ALIASES,
    shotDurationSeconds,
    resolveShotDuration,
    resolveShotEntities,
    classifyShotCodeTokens,
    lossyShotCodeTokens,
    shotDependencyTokenType,
    shotDependencyRecords,
    SHOT_STATE_BEARING_ENTITY_TYPES,
    SHOT_STATE_BEARING_RELATIONSHIP_SOURCES,
    shotDependencySourceIsStateBearing,
    shotStateBearingEntityRecords,
    entityReferenceDemand,
    unresolvedShotDependencies,
  };
}

/* Shared shot-entity resolver for browser and Node. */
function shotEntityTokenMatches(token, entityId) {
  const value = String(token || "");
  const id = String(entityId || "");
  return !!id && (value === id || value.startsWith(id + "-") || value.startsWith(id + "_"));
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
    const entity = candidates.find((item) => String(item?.id || "") === rawId) || null;
    const resolvedType = entity && type === "prop-or-vehicle"
      ? (lists.vehicle.includes(entity) ? "vehicle" : "prop")
      : type;
    const key = `${resolvedType}:${rawId}`;
    const existing = seen.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    const row = {
      type: resolvedType,
      requestedType: type,
      id: rawId,
      entity,
      resolved: !!entity,
      sources: [source],
      inferred: !!options.inferred,
    };
    seen.set(key, row);
    records.push(row);
  };

  for (const id of Array.isArray(s.characters) ? s.characters : []) add("character", id, "characters");
  add("location", creation.locationId, "creationBrief.locationId");
  for (const id of Array.isArray(creation.propIds) ? creation.propIds : []) add("prop-or-vehicle", id, "creationBrief.propIds");
  for (const id of Array.isArray(creation.vehicleIds) ? creation.vehicleIds : []) add("vehicle", id, "creationBrief.vehicleIds");

  const audio = s.audio && typeof s.audio === "object" ? s.audio : {};
  add("character", audio.speakerId, "audio.speakerId");
  add("audio", audio.voiceEntityId, "audio.voiceEntityId");
  for (const clip of Array.isArray(s.clips) ? s.clips : []) {
    add("character", clip?.speakerId, `clips.${clip?.id || clip?.suffix || "clip"}.speakerId`);
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

function unresolvedShotDependencies(project, shot) {
  return shotDependencyRecords(project, shot).filter((row) => !row.resolved);
}

if (typeof window !== "undefined") {
  window.shotEntityTokenMatches = shotEntityTokenMatches;
  window.resolveShotEntities = resolveShotEntities;
  window.shotDependencyTokenType = shotDependencyTokenType;
  window.shotDependencyRecords = shotDependencyRecords;
  window.unresolvedShotDependencies = unresolvedShotDependencies;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { shotEntityTokenMatches, resolveShotEntities, shotDependencyTokenType, shotDependencyRecords, unresolvedShotDependencies };
}

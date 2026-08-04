/* ---------- shared planning records ----------
   v6 exposes one frame workflow. This file retains only the small record helpers
   needed by provenance, finishing, and existing project compatibility. */

function plannerState(s) {
  s.packagePlanner = s.packagePlanner || {};
  const state = s.packagePlanner;
  normalizeShotV5(s);
  state.tab = state.tab || "frames";
  state.frameId = state.frameId || s.keyframes?.[0]?.id || "";
  state.unit = state.unit || (s.clips || [])[0]?.id || (s.clips || [])[0]?.suffix || "shot";
  return state;
}

function unitKey(unit) {
  return unit ? String(unit.id || unit.suffix) : "shot";
}

function promptReferenceMediaType(value = "") {
  if (isVideo(value)) return "video";
  if (isAudio(value)) return "audio";
  return "image";
}

function entityMediaForReference(entity) {
  if (entity.type === "Character")
    return mediaByPrefix(SCAN.anchors, entity.prefix || entity.anchorPrefix || entity.id);
  if (entity.type === "Location")
    return mediaByPrefix(SCAN.plates, entity.prefix || entity.id);
  if (entity.type === "Prop")
    return mediaByPrefix(SCAN.props, entity.prefix || entity.id);
  if (entity.type === "Audio")
    return mediaByPrefix(SCAN.audio, entity.prefix || entity.id);
  return [];
}

/* Resolve current files for an immutable saved package. The guided frame flow
   owns selection and compilation; provenance uses this resolver only to detect
   moved, replaced, or stale inputs. */
function promptReferenceOptions(s, takes = takesFor(s.id)) {
  const out = [];

  takes.forEach((take, index) => {
    const mediaType = promptReferenceMediaType(take.url || take.name);
    out.push({
      key: "take:" + take.name,
      label: take.name,
      url: take.url,
      sourceType: "shot",
      mediaType,
      approved: takeBadges(s, take.name).length > 0,
      defaultRole:
        mediaType === "video"
          ? "motion-reference"
          : mediaType === "audio"
            ? "audio-timing"
            : index === 0
              ? "first-frame"
              : "reference",
      thumbnail: mediaType === "image" ? take.url : "",
    });
  });

  const canonical = referenceRecordsForShot(s);
  canonical.forEach((entity) => {
    const media = entityMediaForReference(entity);
    const selectedState =
      entity.type === "Audio" ? null : selectedEntityStateForShot(s, entity);
    const approvedFile = selectedState?.approvedFile || entity.approvedFile || "";
    const chosen =
      (approvedFile && media.find((item) => item.name === approvedFile)) || media[0];
    if (!chosen) return;
    const mediaType = promptReferenceMediaType(chosen.url || chosen.name);
    out.push({
      key: entity.type.toLowerCase() + ":" + entity.id,
      label:
        (entity.name || entity.id) +
        (selectedState ? ` · ${selectedState.name || "Default"}` : "") +
        " · " +
        chosen.name,
      url: chosen.url,
      sourceType: entity.type.toLowerCase(),
      mediaType,
      approved: entityWorkflowState(entity).key === "APPROVED",
      defaultRole:
        entity.type === "Character"
          ? "identity"
          : entity.type === "Location"
            ? "location"
            : entity.type === "Audio"
              ? "audio-timing"
              : "prop",
      thumbnail: mediaType === "image" ? chosen.url : "",
    });
  });

  const linked = [...shotMediaLinks(s)];
  canonical.forEach((entity) => {
    const targetType =
      entity.type === "Character"
        ? "character"
        : entity.type === "Location"
          ? "location"
          : entity.type === "Prop"
            ? "prop"
            : entity.type === "Audio"
              ? "audio"
              : "";
    if (targetType) linked.push(...mediaLinksForTarget(targetType, entity.id));
  });

  linked
    .filter(({ link }) => link.generationInput)
    .forEach(({ asset, link }) => {
      const key = `media:${asset.id}:${link.id}`;
      if (out.some((item) => item.key === key)) return;
      const mediaType = promptReferenceMediaType(asset.file || asset.kind);
      out.push({
        key,
        label: asset.title || asset.originalName || asset.file,
        url: mediaAssetUrl(asset),
        sourceType: "project-media",
        mediaType,
        approved: true,
        defaultRole: mediaPromptRole(link.role),
        thumbnail: mediaType === "image" ? mediaAssetUrl(asset) : "",
        planningRole: link.role,
      });
    });

  return out;
}

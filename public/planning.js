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

/* The prompt-provenance reader, routed through the SAME exact-ownership rule as
   entityMedia(). A second prefix reader here would have let a child's asset
   resolve as a parent's package input long after the review pool stopped
   offering it. */
const REFERENCE_ENTITY_LISTS = { Character: "characters", Location: "locations", Prop: "props", Vehicle: "vehicles", Audio: "audio" };
function entityMediaForReference(entity) {
  const list = REFERENCE_ENTITY_LISTS[entity?.type] || "";
  if (!list) return [];
  const rows = Array.isArray(SCAN[ENTITY_MEDIA[list]]) ? SCAN[ENTITY_MEDIA[list]] : [];
  return filterEntityMedia(buildEntityOwnerIndex(P, list), entity.id, rows);
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
    /* WORKFLOW: which image travels with the prompt. Not a claim that anybody
       approved it — an unreceipted pointer is historic and still useful here. */
    const referenceFile = selectedState?.approvedFile || entity.approvedFile || "";
    /* A SHEET IS NOT A FALLBACK IDENTITY. With no pointer at all this took
       `media[0]`, and for a reference whose only upload was a turnaround that is
       the sheet — published below with `defaultRole: "identity"`. The pointer is
       still honoured when there is one (an unreceipted pointer is historic and
       still useful here, as the note above says); only the blind fallback is
       narrowed to media this project can actually treat as one view. */
    const singleViewMedia = typeof projectCandidateIsCoverageSheet === "function"
      ? media.filter((item) => !projectCandidateIsCoverageSheet(entity, item.name))
      : media;
    const chosen =
      (referenceFile && media.find((item) => item.name === referenceFile)) || singleViewMedia[0];
    if (!chosen) return;
    const mediaType = promptReferenceMediaType(chosen.url || chosen.name);
    const canonFiles = typeof entityIdentityCanonFiles === "function"
      ? entityIdentityCanonFiles(entity) : new Set();
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
      /* APPROVED MEANS A RECEIPT FOR THESE BYTES. This read
         entityWorkflowState() — the design-review word — so accepting a coverage
         sheet as a source published it as an approved identity reference. The
         claim is now scoped to the exact file being sent, and it comes from the
         authority owner. */
      approved: canonFiles.has(chosen.name),
      defaultRole:
        entity.type === "Character"
          ? (typeof projectCandidateIsCoverageSheet === "function" && projectCandidateIsCoverageSheet(entity, chosen.name)
            ? "reference"
            : "identity")
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

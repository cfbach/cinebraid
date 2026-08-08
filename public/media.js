/* CineBraid project media
 * Reusable planning assets and target links. Kept separate from app.js so the
 * core project/workflow module stays readable.
 */

const PROJECT_MEDIA_ROLES = [
  ["blocking-frame", "Blocking frame"],
  ["animatic-frame", "Animatic frame"],
  ["storyboard", "Storyboard"],
  ["planning-reference", "Planning reference"],
  ["reference-sheet", "Reference sheet"],
  ["character-reference", "Character identity reference"],
  ["expression-reference", "Expression reference"],
  ["body-reference", "Body / anatomy reference"],
  ["outfit-reference", "Outfit / costume reference"],
  ["pose-reference", "Pose / performance reference"],
  ["turnaround-reference", "Turnaround / multi-angle reference"],
  ["detail-reference", "Face / material detail reference"],
  ["location-reference", "Location primary reference"],
  ["alternate-view", "Alternate angle / reverse view"],
  ["lighting-reference", "Lighting / atmosphere reference"],
  ["state-reference", "Continuity-state reference"],
  ["prop-reference", "Prop primary reference"],
  ["vehicle-reference", "Vehicle reference"],
  ["scale-reference", "Scale / interaction reference"],
  ["style-reference", "Visual style reference"],
  ["source-plate", "Source plate"],
  ["motion-reference", "Motion reference video"],
  ["camera-reference", "Camera reference video"],
  ["performance-reference", "Performance reference video"],
  ["post-reference", "Post-production reference"],
  ["audio-reference", "Audio timing reference"],
  ["sound-reference", "Sound / music reference"],
  ["do-not-use", "Do not use"],
];
const PROJECT_MEDIA_BEATS = [
  ["", "Beat not specified"],
  ["start", "Start"],
  ["middle", "Middle"],
  ["end", "End"],
];
function projectMediaAssets() {
  P.mediaAssets = Array.isArray(P.mediaAssets) ? P.mediaAssets : [];
  return P.mediaAssets;
}
function mediaAssetById(id) {
  return projectMediaAssets().find((x) => x.id === id) || null;
}
function mediaAssetUrl(asset) {
  if (!asset) return "";
  const storagePath = String(asset.storagePath || "").replace(/^\/+/, "");
  if (storagePath)
    return "/assets/" + storagePath.split("/").map(encodeURIComponent).join("/");
  return asset.file ? "/assets/media/" + encodeURIComponent(asset.file) : "";
}
function mediaLinksForTarget(targetType, targetId) {
  return projectMediaAssets()
    .flatMap((asset) =>
      (asset.links || [])
        .filter(
          (link) =>
            link.targetType === targetType &&
            String(link.targetId) === String(targetId),
        )
        .map((link) => ({ asset, link })),
    )
    .sort(
      (a, b) =>
        (+a.link.order || 0) - (+b.link.order || 0) ||
        String(a.asset.title || a.asset.file).localeCompare(
          String(b.asset.title || b.asset.file),
        ),
    );
}
function shotMediaLinks(s) {
  return mediaLinksForTarget("shot", s.id);
}
function targetMediaRole(targetType) {
  return (
    {
      shot: "animatic-frame",
      character: "character-reference",
      location: "location-reference",
      prop: "prop-reference",
      vehicle: "vehicle-reference",
      audio: "audio-reference",
      scene: "planning-reference",
    }[targetType] || "planning-reference"
  );
}
function mediaPromptRole(role) {
  return (
    {
      "blocking-frame": "composition",
      "animatic-frame": "composition",
      storyboard: "composition",
      "planning-reference": "reference",
      "reference-sheet": "reference-sheet",
      "character-reference": "identity",
      "expression-reference": "expression",
      "body-reference": "body",
      "outfit-reference": "outfit",
      "pose-reference": "pose",
      "turnaround-reference": "turnaround",
      "detail-reference": "detail",
      "location-reference": "location",
      "alternate-view": "alternate-view",
      "lighting-reference": "lighting",
      "state-reference": "continuity-state",
      "prop-reference": "prop",
      "vehicle-reference": "prop",
      "scale-reference": "scale",
      "style-reference": "style",
      "source-plate": "base",
      "motion-reference": "motion-reference",
      "camera-reference": "camera-reference",
      "performance-reference": "performance-reference",
      "post-reference": "reference",
      "audio-reference": "audio-timing",
      "sound-reference": "sound-reference",
    }[role] || "reference"
  );
}
function mediaRoleOptions(current) {
  return PROJECT_MEDIA_ROLES.map(
    ([value, label]) =>
      `<option value="${value}" ${current === value ? "selected" : ""}>${esc(label)}</option>`,
  ).join("");
}
function referenceKindOptions(current) {
  const rows = typeof REFERENCE_KIND_OPTIONS !== "undefined" ? REFERENCE_KIND_OPTIONS : [
    ["single-angle", "Single angle"], ["detail", "Detail / region"], ["turnaround", "Turnaround"],
    ["contact-sheet", "Multi-angle contact sheet"], ["general", "General appearance reference"],
  ];
  return rows.map(([value, label]) => `<option value="${value}" ${current === value ? "selected" : ""}>${esc(label)}</option>`).join("");
}
function referenceViewOptions(current) {
  const rows = typeof REFERENCE_VIEW_OPTIONS !== "undefined" ? REFERENCE_VIEW_OPTIONS : [
    ["", "View not specified"], ["front", "Front"], ["left-profile", "Left profile"], ["rear", "Rear"],
    ["right-profile", "Right profile"], ["detail", "Detail view"], ["multi-angle", "Multiple angles"], ["custom", "Custom / notes"],
  ];
  return rows.map(([value, label]) => `<option value="${value}" ${current === value ? "selected" : ""}>${esc(label)}</option>`).join("");
}
function defaultReferenceKind(role) {
  if (role === "turnaround-reference") return "turnaround";
  if (role === "detail-reference") return "detail";
  if (["alternate-view", "character-reference", "prop-reference", "vehicle-reference", "location-reference"].includes(role)) return "single-angle";
  return "general";
}
function defaultReferencePriority(role) {
  return ["source-plate", "character-reference", "location-reference", "prop-reference", "vehicle-reference", "audio-reference"].includes(role)
    ? "primary"
    : "supporting";
}
function referenceMetadataInstruction(link) {
  const kind = link?.referenceKind || defaultReferenceKind(link?.role);
  const angle = link?.angleTag || "";
  const angleLabel = typeof referenceViewLabel === "function" ? referenceViewLabel(angle) : String(angle || "").replace(/-/g, " ");
  const detail = String(link?.detailRegion || "").trim();
  const available = String(link?.availableAngles || "").trim();
  const parts = [];
  if (kind === "contact-sheet" || kind === "turnaround") {
    parts.push(`This is a ${kind === "contact-sheet" ? "multi-angle contact sheet" : "turnaround reference"}.`);
    if (angle) parts.push(`Use only the ${angleLabel} view or panel for this shot.`);
    if (available) parts.push(`Available views: ${available}.`);
    parts.push("Do not reproduce the sheet layout, panel borders, labels, or multiple views in the output.");
  } else if (kind === "detail") {
    parts.push(`Use only for the ${detail || angleLabel || "specified detail region"}.`);
    parts.push("Do not inherit the source image's wider framing or background.");
  } else if (angle) {
    parts.push(`Reference view: ${angleLabel}.`);
  }
  if (detail && kind !== "detail") parts.push(`Important visible region: ${detail}.`);
  return parts.join(" ");
}
function referenceMetadataSummary(link) {
  const kind = link?.referenceKind || defaultReferenceKind(link?.role);
  const kindLabel = (typeof REFERENCE_KIND_OPTIONS !== "undefined" ? REFERENCE_KIND_OPTIONS : []).find(([value]) => value === kind)?.[1] || kind.replace(/-/g, " ");
  const angle = link?.angleTag ? (typeof referenceViewLabel === "function" ? referenceViewLabel(link.angleTag) : link.angleTag) : "";
  return [kindLabel, angle, link?.detailRegion || ""].filter(Boolean).join(" · ");
}
function mediaPreview(asset) {
  const url = mediaAssetUrl(asset),
    name = asset.file || asset.originalName || asset.title || "media";
  if (isVideo(name))
    return `<video muted preload="metadata" src="${attr(url)}#t=0.1"></video>`;
  if (isAudio(name))
    return `<div class="project-media-audio">AUDIO</div>`;
  return `<img loading="lazy" src="${attr(url)}" alt="">`;
}
function mediaIsImage(asset) {
  return /\.(png|jpe?g|webp)$/i.test(asset?.file || asset?.originalName || "");
}
function summarizeProjectMediaAnalysis(analysis) {
  const frame = analysis?.frames?.[0] || {},
    subjects = (frame.subjects || [])
      .map((x) =>
        [x.identity, x.screenPosition, x.orientation, x.pose, x.gaze, x.hands]
          .filter(Boolean)
          .join("; "),
      )
      .filter(Boolean),
    camera = [
      frame.camera?.summary,
      frame.camera?.shotSize,
      frame.camera?.height,
      frame.camera?.angle,
      frame.camera?.lensIntent,
      analysis?.camera?.summary,
    ].filter(Boolean),
    environment = [
      frame.environment?.summary,
      ...(frame.environment?.importantGeometry || []),
    ].filter(Boolean),
    risks = [
      ...(frame.continuityRisks || []),
      ...(analysis?.globalRisks || []),
    ].filter(Boolean),
    parts = [];
  if (subjects.length) parts.push("Subjects: " + subjects.join(" | "));
  if (camera.length) parts.push("Camera: " + [...new Set(camera)].join("; "));
  if (environment.length)
    parts.push("Environment: " + environment.join("; "));
  if (risks.length) parts.push("Continuity risks: " + risks.join("; "));
  return parts.join("\n") || "Vision analysis completed, but no structured production details were returned.";
}
function projectMediaCard(targetType, targetId, row) {
  const { asset, link } = row;
  const roleLabel = PROJECT_MEDIA_ROLES.find((x) => x[0] === link.role)?.[1] || link.role || "Reference";
  const advanced = ["shot", "scene", "character", "location", "prop", "vehicle"].includes(targetType) && mediaIsImage(asset);
  const metadata = referenceMetadataSummary(link);
  return `<article class="project-media-card compact ${advanced ? "composer-media-card" : ""}">
    <div class="project-media-thumb">${mediaPreview(asset)}</div>
    <div class="project-media-summary"><b>${esc(asset.title || asset.originalName || asset.file || "Media")}</b><small>${esc(roleLabel)}${metadata ? ` · ${esc(metadata)}` : ""}</small></div>
    <label class="project-media-use"><input type="checkbox" ${link.generationInput ? "checked" : ""} onchange="setProjectMediaLink('${attr(asset.id)}','${attr(link.id)}','generationInput',this.checked)"> Use in prompts</label>
    ${advanced ? `<button class="chip" onclick="openReferenceMetadataEditor('${attr(asset.id)}','${attr(link.id)}')">Name & tag</button>` : ""}
    <button class="chip" onclick="unlinkProjectMedia('${attr(asset.id)}','${attr(link.id)}')">Remove</button>
  </article>`;
}
function mediaTargetPanel(targetType, targetId, options = {}) {
  const links = mediaLinksForTarget(targetType, targetId),
    ordered = !!options.ordered,
    inputId = `project-media-${String(targetType + "-" + targetId).replace(/[^a-z0-9_-]/gi, "-")}`,
    defaultRole = options.defaultRole || targetMediaRole(targetType),
    cards = links
      .map((row, index) =>
        projectMediaCard(targetType, targetId, row, index, links.length, ordered),
      )
      .join("");
  return `<div class="project-media-panel">
    <div class="project-media-head"><div><b>${esc(options.title || "Planning media")}</b><span>${esc(options.subtitle || "Reusable project files linked here without duplicating the original.")}</span></div><div><button class="ghost-btn" onclick="openLinkMediaModal('${attr(targetType)}','${attr(targetId)}')">Link</button><button class="add-btn" onclick="document.getElementById('${attr(inputId)}').click()">Upload</button><input id="${attr(inputId)}" type="file" multiple accept="image/*,video/*,audio/*" hidden onchange="uploadProjectMedia('${attr(targetType)}','${attr(targetId)}',this.files,'${attr(defaultRole)}');this.value=''" /></div></div>
    ${links.length ? `<div class="project-media-strip ${ordered ? "ordered" : ""}">${cards}</div>` : `<div class="reference-empty"><b>No source media yet</b><span>Add an animatic, storyboard, plate, audio cue, or reference video.</span></div>`}
  </div>`;
}

function shotMediaPanel(s) {
  return mediaTargetPanel("shot", s.id, {
    ordered: true,
    defaultRole: "animatic-frame",
    title: "Animatic & planning media",
    subtitle:
      "Ordered shot context. These files can inform planning without automatically becoming generation inputs.",
  });
}
function entityPlanningMediaPanel(list, item) {
  const type =
    list === "characters"
      ? "character"
      : list === "locations"
        ? "location"
        : list === "props"
          ? "prop"
          : list === "vehicles"
            ? "vehicle"
            : "audio";
  return mediaTargetPanel(type, item.id, {
    defaultRole: targetMediaRole(type),
    title: type === "character" ? "Character reference pack" : type === "location" ? "Location reference pack" : type === "prop" ? "Prop reference pack" : type === "vehicle" ? "Vehicle reference pack" : "Linked audio references",
    subtitle: type === "character"
      ? "Add approved generation inputs for expressions, body features, outfits, poses, turnarounds, and details. The primary identity anchor remains canonical."
      : type === "location"
        ? "Add alternate views, lighting references, state references, and architectural details alongside the primary plate."
        : type === "prop"
          ? "Add scale, interaction, alternate-state, and material-detail references alongside the primary prop design."
          : type === "vehicle"
            ? "Add alternate angles, scale, interior, functional-detail, material, and continuity-state references alongside the primary vehicle design."
            : "Link timing, dialogue, ambience, music, and sound references for compatible motion packages.",
  });
}
function newProjectMediaLink(targetType, targetId, role, order) {
  return {
    id: "link-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    targetType,
    targetId,
    role: role || targetMediaRole(targetType),
    order,
    beat: "",
    timecode: "",
    notes: "",
    agentContext: role !== "do-not-use",
    generationInput: false,
    angleTag: "",
    referenceKind: defaultReferenceKind(role || targetMediaRole(targetType)),
    detailRegion: "",
    availableAngles: "",
    priority: defaultReferencePriority(role || targetMediaRole(targetType)),
    blockingState: "",
    blockingAdherence: "strict",
  };
}
window.uploadProjectMedia = async (targetType, targetId, fileList, role) => {
  const files = [...(fileList || [])];
  if (!files.length) return;
  let added = 0;
  const metadataQueue = [];
  const baseOrder = mediaLinksForTarget(targetType, targetId).length;
  for (let i = 0; i < files.length; i++) {
    const file = files[i],
      ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "",
      storedName = `MEDIA-${String(targetId).replace(/[^a-z0-9]/gi, "-")}-${Date.now().toString(36)}-${i + 1}${ext}`;
    try {
      const r = await fetch(
          "/api/media/upload?type=media&name=" + encodeURIComponent(storedName) + projectSlugParam(),
          {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          },
        ),
        d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");
      const link = newProjectMediaLink(targetType, targetId, role, baseOrder + added);
      const asset = {
        id: "media-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        file: d.name,
        originalName: file.name,
        title: file.name.replace(/\.[^.]+$/, ""),
        kind: isVideo(file.name) ? "video" : isAudio(file.name) ? "audio" : "image",
        notes: "",
        provenance: "",
        createdAt: new Date().toISOString(),
        links: [link],
      };
      projectMediaAssets().push(asset);
      metadataQueue.push({ assetId: asset.id, linkId: link.id });
      added++;
    } catch (e) {
      toast(`Could not upload ${file.name}: ${e.message}`);
    }
  }
  if (added) {
    SCAN = await fetch("/api/scan").then((r) => r.json());
    dirty();
    route();
    toast(`${added} planning media file${added === 1 ? "" : "s"} linked`);
    window._referenceMetadataQueue = metadataQueue;
    if (metadataQueue.length && files.every((file) => /\.(png|jpe?g|webp)$/i.test(file.name))) setTimeout(openReferenceMetadataBatch, 0);
  }
};
window.openLinkMediaModal = (targetType, targetId) => {
  const linked = new Set(mediaLinksForTarget(targetType, targetId).map((x) => x.asset.id)),
    available = projectMediaAssets().filter((x) => !linked.has(x.id));
  openModal(`<h3>Link existing project media</h3><div class="modal-sub">THE FILE STAYS IN ONE PROJECT-WIDE RECORD</div><div class="link-media-list">${
    available.length
      ? available
          .map(
            (asset) =>
              `<button onclick="linkExistingProjectMedia('${attr(targetType)}','${attr(targetId)}','${attr(asset.id)}')"><span>${mediaPreview(asset)}</span><div><b>${esc(asset.title || asset.originalName || asset.file)}</b><small>${(asset.links || []).length} existing link${(asset.links || []).length === 1 ? "" : "s"}</small></div><i>+</i></button>`,
          )
          .join("")
      : '<div class="reference-empty"><b>No unlinked media available</b><span>Upload a new file from the target panel first.</span></div>'
  }</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
};
window.linkExistingProjectMedia = (targetType, targetId, assetId) => {
  const asset = mediaAssetById(assetId);
  if (!asset) return;
  asset.links = asset.links || [];
  if (
    asset.links.some(
      (x) => x.targetType === targetType && String(x.targetId) === String(targetId),
    )
  )
    return;
  asset.links.push(
    newProjectMediaLink(
      targetType,
      targetId,
      targetMediaRole(targetType),
      mediaLinksForTarget(targetType, targetId).length,
    ),
  );
  dirty();
  closeModal();
  route();
  toast("Existing project media linked");
};
window._referenceMetadataQueue = window._referenceMetadataQueue || [];
window.openReferenceMetadataEditor = (assetId, linkId) => {
  window._referenceMetadataQueue = [{ assetId, linkId }];
  openReferenceMetadataBatch();
};
function openReferenceMetadataBatch() {
  const rows = (window._referenceMetadataQueue || []).map((item, index) => {
    const asset = mediaAssetById(item.assetId);
    const link = asset?.links?.find((entry) => entry.id === item.linkId);
    if (!asset || !link) return "";
    return `<fieldset class="reference-metadata-row" data-reference-metadata-index="${index}">
      <legend>${esc(asset.title || asset.originalName || asset.file || `Reference ${index + 1}`)}</legend>
      <div class="project-media-control-grid">
        <label class="wide"><span>Reference name</span><input id="refmeta-title-${index}" value="${attr(asset.title || asset.originalName || asset.file || "")}" placeholder="Character — rear-right three-quarter"></label>
        <label><span>Role</span><select id="refmeta-role-${index}">${mediaRoleOptions(link.role)}</select></label>
        <label><span>Reference format</span><select id="refmeta-kind-${index}">${referenceKindOptions(link.referenceKind || defaultReferenceKind(link.role))}</select></label>
        <label><span>Angle / direction</span><select id="refmeta-angle-${index}">${referenceViewOptions(link.angleTag || "")}</select></label>
        <label class="wide"><span>Detail / region</span><input id="refmeta-detail-${index}" value="${attr(link.detailRegion || "")}" placeholder="rear wheel and fender, face, hands…"></label>
        <label class="wide"><span>Use instruction</span><input id="refmeta-notes-${index}" value="${attr(link.notes || "")}" placeholder="Use only this angle or detail; ignore source framing."></label>
        <label class="checkline"><input id="refmeta-use-${index}" type="checkbox" ${link.generationInput ? "checked" : ""}> Use in generation prompts</label>
      </div>
    </fieldset>`;
  }).filter(Boolean).join("");
  if (!rows) return;
  openModal(`<h3>Name and tag reference images</h3><div class="modal-sub">IDENTIFY THE VIEW ONCE SO CINEBRAID CAN SELECT THE RIGHT ANGLE PER SHOT</div><div class="reference-metadata-list">${rows}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Later</button><button class="approve-btn" onclick="saveReferenceMetadataBatch()">SAVE REFERENCE TAGS</button></div>`);
}
window.openReferenceMetadataBatch = openReferenceMetadataBatch;
window.saveReferenceMetadataBatch = () => {
  for (const [index, item] of (window._referenceMetadataQueue || []).entries()) {
    const asset = mediaAssetById(item.assetId);
    const link = asset?.links?.find((entry) => entry.id === item.linkId);
    if (!asset || !link) continue;
    asset.title = document.getElementById(`refmeta-title-${index}`)?.value.trim() || asset.title || asset.originalName || asset.file;
    link.role = document.getElementById(`refmeta-role-${index}`)?.value || link.role;
    link.referenceKind = document.getElementById(`refmeta-kind-${index}`)?.value || link.referenceKind || defaultReferenceKind(link.role);
    link.angleTag = document.getElementById(`refmeta-angle-${index}`)?.value || "";
    link.detailRegion = document.getElementById(`refmeta-detail-${index}`)?.value.trim() || "";
    link.notes = document.getElementById(`refmeta-notes-${index}`)?.value.trim() || "";
    link.generationInput = !!document.getElementById(`refmeta-use-${index}`)?.checked;
    if (link.generationInput) link.agentContext = true;
  }
  window._referenceMetadataQueue = [];
  dirty();
  closeModal();
  route();
  toast("Reference names and angles saved");
};
window.setProjectMediaTitle = (assetId, value) => {
  const asset = mediaAssetById(assetId);
  if (!asset) return;
  asset.title = value;
  dirty();
};
window.setProjectMediaLink = (assetId, linkId, key, value) => {
  const asset = mediaAssetById(assetId),
    link = asset?.links?.find((x) => x.id === linkId);
  if (!link) return;
  link[key] = value;
  if (key === "role" && (!link.referenceKind || link.referenceKind === "general"))
    link.referenceKind = defaultReferenceKind(value);
  if (key === "role" && value === "do-not-use") {
    link.agentContext = false;
    link.generationInput = false;
  }
  if (key === "generationInput" && value) {
    link.agentContext = true;
    if (link.role === "do-not-use") link.role = "planning-reference";
  }
  dirty();
  route();
};
window.analyzeProjectMedia = async (assetId, linkId) => {
  const asset = mediaAssetById(assetId),
    link = asset?.links?.find((x) => x.id === linkId);
  if (!asset || !link || !mediaIsImage(asset)) return;
  if (!capabilityState("vision").ready) {
    toast([capabilityState("vision").message, capabilityState("vision").action].filter(Boolean).join(" "));
    return;
  }
  link.analysisBusy = true;
  route();
  try {
    const result = await request("/api/prompt/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        references: [
          {
            url: mediaAssetUrl(asset),
            role: mediaPromptRole(link.role),
            label: asset.title || asset.originalName || asset.file,
          },
        ],
      }),
    });
    link.visualAnalysis = summarizeProjectMediaAnalysis(result.analysis || {});
    link.visualAnalysisRaw = result.analysis || {};
    link.analyzedAt = new Date().toISOString();
    dirty();
    toast("Visual context saved for this media link");
  } catch (e) {
    toast(e.message || "Media analysis failed");
  } finally {
    delete link.analysisBusy;
    route();
  }
};
window.moveProjectMediaLink = (targetType, targetId, assetId, linkId, delta) => {
  const rows = mediaLinksForTarget(targetType, targetId),
    index = rows.findIndex((x) => x.asset.id === assetId && x.link.id === linkId),
    swap = index + delta;
  if (index < 0 || swap < 0 || swap >= rows.length) return;
  rows.forEach((row, i) => (row.link.order = i));
  const a = rows[index].link.order;
  rows[index].link.order = rows[swap].link.order;
  rows[swap].link.order = a;
  dirty();
  route();
};
window.unlinkProjectMedia = (assetId, linkId) => {
  const asset = mediaAssetById(assetId);
  if (!asset) return;
  asset.links = (asset.links || []).filter((x) => x.id !== linkId);
  dirty();
  route();
  toast("Media unlinked; the project file remains available for reuse");
};
window.draftKeyframeFromMedia = (shotId, assetId, linkId) => {
  const shot = shotById(shotId),
    asset = mediaAssetById(assetId),
    link = asset?.links?.find((x) => x.id === linkId);
  if (!shot || !asset || !link) return;
  normalizeShotV5(shot);
  const frame = newKeyframe(shot.keyframes.length, asset.title || "Animatic frame");
  frame.description =
    link.notes ||
    asset.notes ||
    `Match the composition and story beat shown in ${asset.title || asset.originalName || asset.file}.`;
  frame.notes = [link.beat ? `Animatic beat: ${link.beat}.` : "", link.timecode ? `Source timecode: ${link.timecode}.` : ""]
    .filter(Boolean)
    .join(" ");
  frame.sourceMediaId = asset.id;
  shot.keyframes.push(frame);
  dirty();
  route();
  toast("Draft keyframe added from planning media — it is not approved yet");
};

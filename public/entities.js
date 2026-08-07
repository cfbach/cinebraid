/* ---------- phase 1 & ref helpers ---------- */
window.copyEntityAutomationReport = async (list, id, index) => {
  const entity = P[list]?.find((item) => item.id === id), report = entity?.made?.[index]?.automationReport;
  if (!report) return toast("No automation report is attached");
  const text = JSON.stringify(report, null, 2);
  try { await navigator.clipboard.writeText(text); toast("Attached automation report copied"); }
  catch { openModal(`<h3>Automation generation record</h3><textarea class="automation-debug-text" readonly>${esc(text)}</textarea><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`); }
};

function modelById(id) {
  return (P.meta.models || []).find((m) => m.id === id);
}
function shotStillModel(s) {
  return modelById(s.stillModel || P.meta.defaults.stillModel);
}
function refToken(i, syntax) {
  const s = syntax || P.meta.refSyntax || "@imageN";
  return s === "#imageN"
    ? "#image" + i
    : s === "Image N"
      ? "Image " + i
      : "@image" + i;
}
function universalBlocks() {
  return (P.meta.styleBlocks || [])
    .filter((b) => !b.stage)
    .map((b) => b.text.trim());
}
function savePrompts(list, id, prompts) {
  const e = P[list].find((x) => x.id === id);
  e.prompts = prompts;
  dirty();
  route();
  openModal(`<h3>Phase 1 prompts — ${esc(e.id)}</h3>
    <div class="modal-sub">GENERATE CLEAN · ITERATE TO APPROVAL · FILE BY CODE · SAVED TO THE CARD</div>
    ${prompts
      .map(
        (
          pr,
        ) => `<div class="block-row"><div class="block-row-head"><span class="opt-id">${esc(pr.id)}</span>
      <button class="copy-btn" style="margin-left:auto" onclick="copyText(${JSON.stringify(pr.text).replace(/"/g, "&quot;")})">COPY</button></div>
      <div class="opt-refs" style="white-space:pre-wrap;color:var(--muted)">${esc(pr.text)}</div></div>`,
      )
      .join("")}
    <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
}
window.buildCharSheets = (id) => {
  const c = P.characters.find((x) => x.id === id);
  if (!(c.block || "").trim())
    return toast(
      "Write the identity block first — sheets are built FROM it, verbatim",
    );
  const B = c.block.trim();
  const ex = (
    c.expressions ||
    "neutral, subtle concern, quiet resolve, speaking mouth open mid-word"
  ).trim();
  savePrompts("characters", id, [
    {
      id: c.id + "-ANCHOR-01",
      text:
        B +
        "\n\nCharacter reference sheet, full body, three views of the SAME character: front, left profile, and rear. Neutral standing pose, arms relaxed. Plain neutral grey background, even soft lighting, no shadows on the background. Generated CLEAN: no damage effects, no degradation, no heavy grade — identity only.",
    },
    {
      id: c.id + "-EXPR-01",
      text:
        B +
        "\n\nExpression sheet: a grid of head-and-shoulders panels of the SAME character, identical framing and lighting in every panel, one expression per panel: " +
        ex +
        ". Plain neutral background. Generated CLEAN: no damage effects, no degradation.",
    },
    {
      id: c.id + "-HANDS-01",
      text:
        B +
        "\n\nHands detail sheet: separated panels showing ONLY the character's hands, one pose per panel: resting flat on a surface; gripping a small tool; fingertip pressing down onto a surface. Clear separation between panels, plain background, even light. NOTE FOR USE: when referencing later, crop to a single panel — multi-pose sheets contaminate.",
    },
  ]);
};
window.buildLocPlate = (id) => {
  const l = P.locations.find((x) => x.id === id);
  const w = P.meta.world;
  const parts = [
    (l.name + ". " + (l.notes || "")).trim(),
    w.setting,
    w.include ? "Period-true details: " + w.include + "." : "",
    ...universalBlocks(),
    "Master plate: wide establishing framing of the empty space. No people, no characters, no figures.",
    w.reject ? "Do not include: " + w.reject + "." : "",
  ].filter(Boolean);
  savePrompts("locations", id, [
    { id: (l.prefix || l.id) + "-A", text: parts.join("\n\n") },
  ]);
};
window.buildVehiclePlate = (id) => {
  const vehicle = P.vehicles.find((x) => x.id === id);
  const w = P.meta.world;
  const parts = [
    (vehicle.name + ". " + (vehicle.notes || "")).trim(),
    "Vehicle design plate: full vehicle visible at a useful three-quarter angle, clear silhouette, wheels and functional details unobstructed. No driver, passengers, people, dramatic action, or unrelated objects.",
    w.setting,
    ...universalBlocks(),
    w.reject ? "Do not include: " + w.reject + "." : "",
  ].filter(Boolean);
  savePrompts("vehicles", id, [{ id: vehicle.id + "-PLATE", text: parts.join("\n\n") }]);
};
window.buildPropPlate = (id) => {
  const pr = P.props.find((x) => x.id === id);
  const w = P.meta.world;
  const parts = [
    (pr.name + ". " + (pr.notes || "")).trim(),
    "Hero prop plate: the object centered and filling most of the frame, resting on a plain period-appropriate surface. No hands, no people.",
    w.setting,
    ...universalBlocks(),
    w.reject ? "Do not include: " + w.reject + "." : "",
  ].filter(Boolean);
  savePrompts("props", id, [
    { id: pr.id + "-PLATE", text: parts.join("\n\n") },
  ]);
};

/* ---------- entity views (characters / locations / props) ---------- */
const ENTITY_ROUTE = {
  characters: "character",
  locations: "location",
  props: "prop",
  vehicles: "vehicle",
  audio: "sound",
};
const ENTITY_MEDIA = {
  characters: "anchors",
  locations: "plates",
  props: "props",
  vehicles: "vehicles",
  audio: "audio",
};
function entityMedia(list, it) {
  return mediaByPrefix(
    SCAN[ENTITY_MEDIA[list]],
    it.prefix || it.anchorPrefix || it.id,
  );
}
function entityCandidateRow(entity, fileName, create = false) {
  entity.candidateFiles = Array.isArray(entity.candidateFiles) ? entity.candidateFiles : [];
  let row = entity.candidateFiles.find((item) => (item.stored || item.name) === fileName);
  if (!row && create) {
    row = { stored: fileName, original: fileName, addedAt: new Date().toISOString(), decision: "unreviewed" };
    entity.candidateFiles.push(row);
  }
  return row || null;
}
const ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION = "reference-authority-v2";
function entityCandidateReviewForState(entity, fileName, stateId = "state-default") {
  const row = entityCandidateRow(entity, fileName, false);
  return row?.structuredReviews?.[stateId] || null;
}
function entityCandidateReviewIsCurrent(review) {
  return !!review && String(review.contractVersion || "") === ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION;
}
function entityLatestCandidateReviewRaw(entity, fileName) {
  const row = entityCandidateRow(entity, fileName, false);
  const reviews = Object.values(row?.structuredReviews || {}).filter(Boolean);
  return reviews.sort((a, b) => String(b.reviewedAt || "").localeCompare(String(a.reviewedAt || "")))[0] || null;
}
function entityLatestCandidateReview(entity, fileName) {
  const row = entityCandidateRow(entity, fileName, false);
  const reviews = Object.values(row?.structuredReviews || {}).filter(entityCandidateReviewIsCurrent);
  return reviews.sort((a, b) => String(b.reviewedAt || "").localeCompare(String(a.reviewedAt || "")))[0] || null;
}
function entityCandidateIsCoverageSheet(entity, fileName) {
  const row = entityCandidateRow(entity, fileName, false) || {};
  return row.coverageJobType === "sheet" || !!row.coverageSheetType || /(?:SHEET|TURNAROUND|CONTACT)/i.test(String(fileName || ""));
}
const ENTITY_CANDIDATE_FILTERS = [
  { id: "all", label: "All" },
  { id: "primary-state", label: "Primary / State" },
  { id: "coverage", label: "Coverage Views" },
  { id: "sheets", label: "Sheets" },
  { id: "expressions", label: "Expressions" },
];
function entityCandidateWorkflowType(entity, fileName) {
  const row = entityCandidateRow(entity, fileName, false) || {};
  if (entityCandidateIsCoverageSheet(entity, fileName)) return row.coverageSheetType === "expressions" ? "expressions" : "sheets";
  if (row.targetCoverageSlotId) return row.coverageGroup === "expressions" ? "expressions" : "coverage";
  return "primary-state";
}
function entityCandidateFilterKey(list, id) {
  return `cinebraid-candidate-filter:${ACTIVE_PROJECT_SLUG || "project"}:${list}:${id}`;
}
function entityCandidateFilter(list, id) {
  try {
    const value = localStorage.getItem(entityCandidateFilterKey(list, id)) || "all";
    return ENTITY_CANDIDATE_FILTERS.some((item) => item.id === value) ? value : "all";
  } catch { return "all"; }
}
function entityCandidateMatchesFilter(entity, fileName, filter) {
  return !filter || filter === "all" || entityCandidateWorkflowType(entity, fileName) === filter;
}
window.setEntityCandidateFilter = (list, id, value) => {
  try { localStorage.setItem(entityCandidateFilterKey(list, id), value); } catch {}
  if (typeof boundedWriteState === "function") boundedWriteState("page:candidates", `${list}:${id}:active:${value}`, 0);
  route();
};
function entityCandidateTargetStateId(entity, fileName) {
  const row = entityCandidateRow(entity, fileName, false) || {};
  return String(row.targetStateId || "state-default");
}
function entityCandidateTargetReviewRaw(entity, fileName) {
  return entityCandidateReviewForState(entity, fileName, entityCandidateTargetStateId(entity, fileName));
}
function entityCandidateTargetReview(entity, fileName) {
  const review = entityCandidateTargetReviewRaw(entity, fileName);
  return entityCandidateReviewIsCurrent(review) ? review : null;
}
function entityCandidateWorkflowLabel(entity, fileName) {
  const type = entityCandidateWorkflowType(entity, fileName);
  return ({ "primary-state": "PRIMARY / STATE", coverage: "COVERAGE VIEW", sheets: "REFERENCE SHEET", expressions: "EXPRESSION" })[type] || "CANDIDATE";
}
function entityCandidateReviewOverlay(entity, fileName) {
  const review = entityCandidateTargetReviewRaw(entity, fileName) || entityLatestCandidateReviewRaw(entity, fileName);
  if (!review) return "";
  const current = entityCandidateReviewIsCurrent(review);
  const score = Math.round(Number(review.score || 0));
  return `<span class="entity-ai-score-overlay ${!current ? "stale" : review.pass ? "pass" : "flag"}"><b>${score}</b><small>${!current ? "REVIEW OLD" : review.pass ? "PASS" : "FLAG"}</small></span>`;
}
function entityCoverageSectionKey(list, id, group = "angles") {
  return `entity:${list}:${id}:${group === "expressions" ? "expression-board" : "coverage-board"}`;
}
function entityCoverageActiveJobs(list, id, group = "angles") {
  return (Array.isArray(FAL_GENERATION_JOBS) ? FAL_GENERATION_JOBS : []).filter((job) => job.entityList === list && job.entityId === id && job.purpose === "entity-reference" && !["COMPLETED", "FAILED", "CANCELLED"].includes(String(job.status || "").toUpperCase()) && (group === "expressions" ? job.coverageSheetType === "expressions" : job.coverageSheetType !== "expressions"));
}
function entityCoverageRunStatusMarkup(list, entity, group = "angles") {
  const run = entity?.coverageAutomation;
  if (!run || (group === "expressions") !== (run.sheetType === "expressions")) return "";
  const status = String(run.status || "").toLowerCase();
  if (!status || ["starting","sheet-running","individual-running"].includes(status)) return "";
  const tone = status === "completed" ? "complete" : ["failed","cancelled","needs-attention"].includes(status) ? "attention" : "pending";
  const label = status.replace(/-/g, " ");
  const detail = status === "sheet-ready-for-review" ? "Sheet returned. Review it, then extract useful panels." : status === "slot-candidates-ready" ? "Individual view candidates returned and await review." : status === "completed" ? "All required slots are approved." : run.error || `${run.missingRequired ?? "Some"} required slots still need attention.`;
  return `<div class="coverage-run-status tone-${attr(tone)}"><div><span>COVERAGE RUN</span><b>${esc(label.toUpperCase())}</b><small>${esc(detail)}</small></div>${status === "needs-attention" ? `<button class="ghost-btn" onclick="openCoverageAutomationModal('${attr(list)}','${attr(entity.id)}','individual')">RESUME MISSING VIEWS</button>` : ""}</div>`;
}
function entityCoverageActivityMarkup(list, entity, group = "angles") {
  const jobs = entityCoverageActiveJobs(list, entity.id, group);
  if (!jobs.length) return entityCoverageRunStatusMarkup(list, entity, group);
  const latest = jobs.at(-1);
  const title = latest.coverageJobType === "slot" ? (latest.targetCoverageSlotName || "Coverage view") : group === "expressions" ? "Expression sheet" : "Coverage sheet";
  return `<div class="coverage-inline-activity"><span class="spin">◌</span><div><b>${esc(title)} generation in progress</b><small>${esc(String(latest.status || "queued").replace(/_/g, " "))}${latest.queuePosition != null ? ` · queue ${latest.queuePosition}` : ""} · this section will remain open</small></div><button class="ghost-btn" onclick="openGlobalAutomationActivity()">VIEW ACTIVITY</button></div>`;
}
function entityCandidateReviewBadge(entity, fileName) {
  const row = entityCandidateRow(entity, fileName, false) || {};
  const review = entityCandidateTargetReviewRaw(entity, fileName) || entityLatestCandidateReviewRaw(entity, fileName);
  if (!review) return "";
  if (!entityCandidateReviewIsCurrent(review)) return `<span class="entity-ai-review-badge stale">AI ${Math.round(+review.score || 0)} · ${review.pass ? "PASS" : "FLAG"} · ${esc(review.stateName || "Default")} · PREVIOUS REVIEW / RE-RUN REQUIRED</span>`;
  const tone = review.pass ? "pass" : "flag";
  const assignment = review.pass && row.targetCoverageSlotId && row.decision !== "approved-coverage" && row.decision !== "approved-expression" ? " · NOT ASSIGNED" : "";
  return `<span class="entity-ai-review-badge ${tone}">AI ${Math.round(+review.score || 0)} · ${review.pass ? "PASS" : "FLAG"}${assignment} · ${esc(review.stateName || "Default")}</span>`;
}

function entityStateParentSummary(entity, state) {
  if (!entity || !state || state.isDefault) return { parent: null, fileName: "", label: "Primary identity" };
  const states = entityStateList(entity, true);
  const parent = states.find((item) => item.id === state.parentStateId && item.id !== state.id)
    || states.find((item) => item.isDefault)
    || states.find((item) => item.id !== state.id)
    || null;
  const fileName = parent?.approvedFile || (parent?.isDefault ? entity.approvedFile || "" : "");
  return { parent, fileName, label: parent?.name || "Default" };
}
window.openContinuityStateVariant = async (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  if (!entity || !state || state.isDefault) return toast("Choose a non-default continuity state");
  const parentInfo = entityStateParentSummary(entity, state);
  let changed = false;
  if (!state.parentStateId && parentInfo.parent?.id) { state.parentStateId = parentInfo.parent.id; changed = true; }
  if (state.generationMode !== "derive") { state.generationMode = "derive"; changed = true; }
  if (changed) dirty();
  closeModal();
  window.boundedWriteState?.("selected:entity-coverage-view", `${list}:${id}`, "states");
  window.boundedWriteState?.("selected:continuity-state", `${list}:${id}`, stateId);
  window.selectBoundedTask?.("entity-task", `${list}:${id}`, "coverage");
  setTimeout(() => {
    revealEntityContinuityState?.(stateId);
    const card = [...document.querySelectorAll?.("[data-continuity-state-id]") || []].find((item) => item.dataset.continuityStateId === stateId);
    const generation = card?.querySelector?.("details.entity-state-generation");
    if (generation) generation.open = true;
    card?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    const delta = card?.querySelector?.(".continuity-state-delta textarea");
    if (!String(state.notes || "").trim()) delta?.focus?.();
  }, 120);
};
window.openContinuityStateVariantHub = (list, id) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  const states = entityStateList(entity, true).filter((state) => !state.isDefault);
  if (!states.length) {
    window.boundedWriteState?.("selected:entity-coverage-view", `${list}:${id}`, "states");
    window.selectBoundedTask?.("entity-task", `${list}:${id}`, "coverage");
    return toast("Add a continuity state first, then describe what changes from the primary appearance");
  }
  openModal(`<div class="state-variant-hub-modal"><header><div><span>CONTINUITY-STATE VARIANTS</span><h3>Generate another version of ${esc(entity.name || entity.id)}</h3><p>Choose the costume, damage, lighting, age or condition variant to derive from an approved parent reference.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="state-variant-hub-list">${states.map((state) => { const parentInfo = entityStateParentSummary(entity, state); const ready = !!parentInfo.fileName; return `<article class="${state.approvedFile ? "complete" : ready ? "ready" : "attention"}"><div><span>${state.approvedFile ? "APPROVED VARIANT" : ready ? "READY TO DERIVE" : "PARENT MISSING"}</span><b>${esc(state.name || "State")}</b><small>${esc(state.appliesTo || "No scene or shot range assigned")}</small></div><div class="state-variant-relationship"><span>Parent</span><b>${esc(parentInfo.label)}</b><small>${ready ? esc(parentInfo.fileName) : "Approve the parent state first"}</small></div><div class="state-variant-delta"><span>Change only</span><p>${esc(state.notes || "Describe the exact state change before generation.")}</p></div><button class="${state.approvedFile ? "ghost-btn" : "approve-btn"}" onclick="openContinuityStateVariant('${attr(list)}','${attr(id)}','${attr(state.id)}')">${state.approvedFile ? "EDIT / REGENERATE" : "OPEN STATE WORKFLOW"}</button></article>`; }).join("")}</div></div>`);
};
window.openStateReferenceUpload = (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  if (!entity || !state) return;
  window._pendingEntityStateUpload = { list, id, stateId };
  document.getElementById("entity-file")?.click?.();
};
function entityCandidateCard(list, entity, media, index, mediaJson, rejected = false) {
  const row = entityCandidateRow(entity, media.name, false) || {};
  const targetState = row.targetStateId ? entityStateById(entity, row.targetStateId) : null;
  const targetName = row.targetStateName || targetState?.name || "";
  const coverageName = row.targetCoverageSlotName || "";
  const isSheet = entityCandidateIsCoverageSheet(entity, media.name);
  const targetReview = entityCandidateTargetReview(entity, media.name);
  const passed = !!targetReview?.pass;
  const workflowType = entityCandidateWorkflowType(entity, media.name);
  const continuation = isSheet ? "extract" : row.targetCoverageSlotId ? "coverage" : "entity";
  const humanLabel = isSheet
    ? "USE AS SHEET SOURCE"
    : row.targetCoverageSlotId
      ? `ASSIGN TO ${String(coverageName || "VIEW").toUpperCase()}`
      : "APPROVE…";
  const targetStateId = row.targetStateId || "state-default";
  const batchStatus = typeof entityCandidateBatchStatusMarkup === "function" ? entityCandidateBatchStatusMarkup(list, entity.id, media.name) : "";
  const visionReady = typeof capabilityState === "function" && !!capabilityState("vision")?.ready;
  const aiAction = visionReady || targetReview
    ? `<button class="ghost-btn optional-ai-action" onclick="openEntityCandidateReview('${list}','${entity.id}','${attr(media.name)}','${attr(targetStateId)}')">${targetReview ? "AI CHECK DETAILS" : "OPTIONAL AI CHECK"}</button>`
    : "";
  const generationJob = (FAL_GENERATION_JOBS || []).find((job) => job.id === row.generationJobId) || null;
  const parentName = generationJob?.parentStateName || "";
  const sourceDescription = row.generationProvider
    ? `${esc(String(row.generationProvider).toUpperCase())} candidate${targetName ? ` for continuity state ${esc(targetName)}` : coverageName ? ` for ${esc(coverageName)}` : isSheet ? " · multi-view source" : ""}${parentName ? ` · derived from approved ${esc(parentName)}` : ""}`
    : "Imported candidate";
  const reviewDescription = targetReview
    ? `${targetReview.pass ? "AI check passed" : "AI check flagged issues"} · human approval remains explicit`
    : "Choose, assign, or approve by human judgment; AI checking is optional";
  return `<article class="entity-candidate-card ${rejected ? "is-rejected" : ""} ${isSheet ? "is-coverage-sheet" : ""}" data-candidate-file="${attr(media.name)}" data-candidate-type="${attr(workflowType)}"><a class="entity-candidate-preview" href="javascript:void 0" onclick="openLBMedia('${mediaJson}',${index},'${attr(entity.id)}')" title="${attr(media.name)}">${isVideo(media.name) ? `<video muted src="${attr(media.url)}"></video>` : `<img src="${attr(media.url)}" alt="">`}${entityCandidateReviewOverlay(entity, media.name)}${targetName ? `<span class="entity-candidate-target">CONTINUITY · ${esc(targetName.toUpperCase())}</span>${parentName ? `<span class="entity-candidate-parent">FROM · ${esc(parentName.toUpperCase())}</span>` : ""}` : coverageName ? `<span class="entity-candidate-target">COVERAGE · ${esc(coverageName.toUpperCase())}</span>` : isSheet ? `<span class="entity-candidate-target">COVERAGE SHEET</span>` : ""}<span class="entity-tile-name">${esc(media.name)}</span></a><div class="entity-candidate-meta"><span class="entity-candidate-workflow-type">${esc(entityCandidateWorkflowLabel(entity, media.name))}</span>${entityCandidateReviewBadge(entity, media.name)}${batchStatus}<small>${rejected ? "Rejected candidate · kept on disk" : `${sourceDescription} · ${reviewDescription}`}</small></div><div class="entity-candidate-actions">${rejected ? `<button class="chip" onclick="setEntityCandidateDecision('${list}','${entity.id}','${attr(media.name)}','unreviewed')">RESTORE</button>` : `<button class="approve-tile-btn human-approval-action" onclick="requestHumanEntityCandidateApproval('${list}','${entity.id}','${attr(media.name)}','${attr(targetStateId)}','${continuation}')">${humanLabel}</button>${aiAction}<button class="chip danger" onclick="setEntityCandidateDecision('${list}','${entity.id}','${attr(media.name)}','rejected')">REJECT</button>`}</div></article>`;
}

function entityView(title, list, mediaList, extra) {
  return `<div class="view-head"><span class="view-title">${title}</span>
    <span class="view-sub">media matched from disk by code prefix — click a card for the full page</span>
    <button class="add-btn" onclick="addEntity('${list}')">+ Add</button></div>
    <div class="card-grid">${P[list]
      .map((it) => {
        const media = entityMedia(list, it);
        const strip = media.length
          ? media
              .slice(0, 4)
              .map((m) =>
                isVideo(m.name)
                  ? `<video muted src="${m.url}"></video>`
                  : `<img src="${m.url}" alt="">`,
              )
              .join("")
          : `<span class="no-take">NO FILES · ${esc(it.prefix || it.anchorPrefix || it.id)}*</span>`;
        return `<a class="canon-card canon-card-link" href="#/${ENTITY_ROUTE[list]}/${it.id}">
        <div class="canon-strip">${strip}</div>
        <div class="canon-body">
          <div style="display:flex;align-items:center;gap:8px"><span class="canon-code">${esc(it.id)}</span>
            <span class="stamp ${skey(it.status || "NOT STARTED")}" style="margin-left:auto">${esc(it.status || "NOT STARTED")}</span></div>
          <div class="canon-name">${esc(it.name)}</div>
          <div class="hint">${media.length} file(s) · ${(it.prompts || []).length} saved prompt(s) · ${(it.continuityStates || []).length} continuity state${(it.continuityStates || []).length === 1 ? "" : "s"}${it.sameObjectAs ? ` · = ${esc(it.sameObjectAs)}${it.role ? " (" + esc(it.role) + ")" : ""}` : ""}</div>
        </div></a>`;
      })
      .join("")}</div>`;
}
function continuityStateCandidateTray(list, entity, state, media) {
  if (!state) return "";
  const approvedNames = new Set([state.approvedFile, state.isDefault ? entity.approvedFile : ""].filter(Boolean));
  const rows = (media || []).filter((item) => {
    if (approvedNames.has(item.name)) return false;
    const candidate = entityCandidateRow(entity, item.name, false) || {};
    return String(candidate.targetStateId || "state-default") === String(state.id || "state-default") && candidate.decision !== "rejected";
  });
  const mediaJson = encodeURIComponent(JSON.stringify(rows));
  const parent = entityStateParentSummary(entity, state);
  const heading = state.isDefault ? "Primary-state candidates" : `${state.name || "State"} candidates`;
  const source = state.isDefault ? "Main approved image" : parent?.fileName ? `Derived from approved ${parent.label}` : "Generated independently — approved parent unavailable";
  return `<section class="continuity-candidate-tray"><header><div><span>GENERATED FOR THIS STATE</span><b>${esc(heading)}</b><small>${esc(source)} · review and approve here without leaving the Continuity tab.</small></div><strong>${rows.length}</strong></header>${rows.length ? `<div class="entity-media entity-candidate-grid continuity-candidate-grid">${rows.map((item,index)=>entityCandidateCard(list,entity,item,index,mediaJson,false)).join("")}</div>` : `<div class="entity-candidate-empty"><b>No unapproved candidates for ${esc(state.name || "this state")}</b><span>Generate or upload a state reference and it will appear here automatically.</span></div>`}</section>`;
}


function continuityStateValidationCurrent(entity, state) {
  if (!entity || !state || state.isDefault) return null;
  const validation = state.parentValidation || null;
  if (!validation) return null;
  const parentInfo = entityStateParentSummary(entity, state);
  const targetFile = state.approvedFile || "";
  const parentFile = parentInfo.fileName || "";
  const delta = String(state.notes || "").trim();
  return validation.targetFile === targetFile && validation.parentFile === parentFile && validation.stateDelta === delta ? validation : null;
}
function continuityStateValidationMarkup(list, entity, state, media = []) {
  if (!state || state.isDefault) return "";
  const parentInfo = entityStateParentSummary(entity, state);
  const targetMedia = media.find((item) => item.name === state.approvedFile) || null;
  const parentMedia = media.find((item) => item.name === parentInfo.fileName) || null;
  const validation = continuityStateValidationCurrent(entity, state);
  const capability = typeof capabilityState === "function" ? capabilityState("vision") : { ready: false, message: "Vision assistant unavailable" };
  const ready = !!(targetMedia && parentMedia && String(state.notes || "").trim());
  const thumbs = targetMedia && parentMedia ? `<div class="state-validation-thumbs"><button type="button" onclick="openMediaTheatre('${attr(encodeURIComponent(parentMedia.url))}','${attr(encodeURIComponent(`${parentInfo.label} parent image · ${parentInfo.fileName}`))}','image')"><img src="${attr(parentMedia.url)}" alt="Parent approved image"><span>${esc(parentInfo.label)} · parent</span></button><i>→</i><button type="button" onclick="openMediaTheatre('${attr(encodeURIComponent(targetMedia.url))}','${attr(encodeURIComponent(`${state.name || "State"} approved image · ${state.approvedFile}`))}','image')"><img src="${attr(targetMedia.url)}" alt="Approved image for this state"><span>${esc(state.name || "State")} · target</span></button></div>` : "";
  if (validation?.status === "working") return `<section class="state-parent-validation state-working"><header><div><span>PARENT-TO-STATE VALIDATION</span><b>Checking ${esc(state.name || "state")} against ${esc(parentInfo.label)}</b><small>The vision assistant is separating the intended delta from identity, geometry, material and lighting drift.</small></div><i class="spin">◌</i></header>${thumbs}</section>`;
  if (!validation) return `<section class="state-parent-validation state-pending"><header><div><span>PARENT-TO-STATE VALIDATION</span><b>Validate the approved state against its parent</b><small>The parent is authority. The state description is the allowed delta. Everything else stays locked.</small></div><button class="approve-btn" onclick="validateContinuityStateAgainstParent('${attr(list)}','${attr(entity.id)}','${attr(state.id)}')" ${ready && capability.ready ? "" : "disabled"}>VALIDATE AGAINST PARENT</button></header>${thumbs}${!ready ? `<p class="prompt-check warn">Approve both the parent and target state, then describe the exact visual delta.</p>` : !capability.ready ? `<p class="prompt-check warn">${esc(capability.message || "Connect a vision assistant to validate this state.")}</p>` : ""}</section>`;
  const review = validation.review || {};
  const pass = validation.accepted === true || review.pass === true;
  const hardLabels = { sameUnderlyingEntity: "Same underlying asset", onlyRequestedDelta: "Only requested delta changed", sameEmbeddedContent: "Embedded content preserved", sameSpatialGeometry: "Same physical geometry", requestedViewCorrect: "Requested view remains correct" };
  const expected = review.hardChecks?.onlyRequestedDelta || null;
  const hardRows = (review.requiredHardChecks || []).map((key) => { const row = review.hardChecks?.[key] || {}; return `<article class="${row.pass ? "pass" : "fail"}"><b>${esc(hardLabels[key] || key)}</b><span>${esc(row.note || (row.pass ? "Passed." : "Failed or missing evidence."))}</span></article>`; }).join("");
  const categories = Object.entries(review.categories || {}).map(([key,row]) => `<article class="severity-${attr(row.severity || "pass")}"><b>${esc(key.replace(/([A-Z])/g," $1"))}</b><span>${esc(String(row.severity || "pass").toUpperCase())}</span><p>${esc(row.note || "")}</p></article>`).join("");
  const acceptedNote = validation.accepted ? `<div class="state-validation-accepted"><b>Accepted as intentional canon</b><span>${esc(validation.acceptedNote || "The difference was added to the state definition.")}</span></div>` : "";
  const actions = pass ? `<button class="ghost-btn" onclick="validateContinuityStateAgainstParent('${attr(list)}','${attr(entity.id)}','${attr(state.id)}')">VALIDATE AGAIN</button>` : `<button class="approve-btn large" onclick="correctContinuityStateFromParent('${attr(list)}','${attr(entity.id)}','${attr(state.id)}')">CORRECT FROM PARENT</button><button class="ghost-btn" onclick="openStateReferenceUpload('${attr(list)}','${attr(entity.id)}','${attr(state.id)}')">UPLOAD CORRECTED STATE</button><button class="ghost-btn" onclick="approveEntityFile('${attr(list)}','${attr(entity.id)}','','${attr(state.id)}')">CHOOSE ANOTHER CANDIDATE</button><button class="chip" onclick="openAcceptStateDifference('${attr(list)}','${attr(entity.id)}','${attr(state.id)}')">ACCEPT DIFFERENCE AS INTENTIONAL</button><button class="ghost-btn" onclick="validateContinuityStateAgainstParent('${attr(list)}','${attr(entity.id)}','${attr(state.id)}')">VALIDATE AGAIN</button>`;
  return `<section class="state-parent-validation ${pass ? "state-pass" : "state-fail"}"><header><div><span>${pass ? "PARENT CONTINUITY PASSED" : "PARENT CONTINUITY FAILED"}</span><b>${esc(review.summary || (pass ? "State matches the parent image." : "The approved state contains unintended drift."))}</b><small>${esc(review.recommendation ? `Recommendation: ${review.recommendation}` : "")}</small></div><div class="state-validation-score"><strong>${Math.round(Number(review.score || 0))}</strong><span>/100</span></div></header>${thumbs}${acceptedNote}${expected ? `<div class="state-expected-delta ${expected.pass ? "pass" : "fail"}"><b>Expected state change</b><span>${esc(expected.note || "")}</span></div>` : ""}${hardRows ? `<div class="state-validation-hard-checks">${hardRows}</div>` : ""}${categories ? `<div class="state-validation-categories">${categories}</div>` : ""}<footer><div class="state-validation-actions">${actions}</div><small>Reviewed ${esc(String(validation.reviewedAt || "").slice(0,16).replace("T"," "))}</small></footer></section>`;
}
window.validateContinuityStateAgainstParent = async (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  const parentInfo = entityStateParentSummary(entity, state);
  if (!entity || !state || state.isDefault) return toast("Choose a derived continuity state");
  if (!state.approvedFile || !parentInfo.fileName) return toast("Approve both the parent and target state first");
  if (!String(state.notes || "").trim()) return toast("Describe the allowed state delta first");
  const capability = capabilityState("vision");
  if (!capability.ready) return toast(capability.message || "Vision assistant is unavailable");
  state.parentValidation = { status: "working", targetFile: state.approvedFile, parentFile: parentInfo.fileName, stateDelta: String(state.notes || "").trim(), reviewedAt: new Date().toISOString() };
  dirty(); route();
  try {
    if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
    const response = await fetch("/api/llm/review-entity-candidate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list, id, fileName: state.approvedFile, stateId: state.id }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "State validation failed");
    state.parentValidation = { status: "complete", review: data.review, targetFile: state.approvedFile, parentFile: parentInfo.fileName, stateDelta: String(state.notes || "").trim(), reviewedAt: new Date().toISOString(), inputLabels: data.inputLabels || [], authoritySignature: data.authoritySignature || data.review?.authoritySignature || "" };
    dirty(); route();
    toast(data.review?.pass ? `${state.name || "State"} passed parent continuity` : `${state.name || "State"} needs continuity correction`);
  } catch (error) {
    state.parentValidation = null;
    dirty(); route(); toast("State validation failed: " + error.message);
  }
};
window.correctContinuityStateFromParent = async (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  const parentInfo = entityStateParentSummary(entity, state);
  if (!entity || !state || state.isDefault || !parentInfo.fileName) return toast("Approve the parent state first");
  state.generationMode = "derive";
  if (parentInfo.parent?.id) state.parentStateId = parentInfo.parent.id;
  const validation = continuityStateValidationCurrent(entity, state);
  const findings = [validation?.review?.summary, ...(validation?.review?.hardGateFailures || []), ...Object.values(validation?.review?.categories || {}).map((row) => row?.note)].filter(Boolean).join("\n");
  if (findings && !String(state.assetPromptNotes || "").includes("PARENT VALIDATION CORRECTION")) state.assetPromptNotes = [state.assetPromptNotes, `PARENT VALIDATION CORRECTION\n${findings}`].filter(Boolean).join("\n\n");
  state.parentValidation = null;
  dirty();
  const build = await buildEntityStatePrompt(list, id, stateId, true);
  if (!build) return;
  if (typeof falGenerationReady === "function" && falGenerationReady()) return openFalEntityGenerationModal(list, id, build.id, stateId);
  route();
  setTimeout(() => openContinuityStateVariant(list, id, stateId), 80);
};
window.openAcceptStateDifference = (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  const validation = continuityStateValidationCurrent(entity, state);
  if (!entity || !state || !validation || validation.review?.pass) return toast("A failed current validation is required");
  openModal(`<div class="accept-state-difference-modal"><header><div><span>EXPAND THE APPROVED STATE DELTA</span><h3>Accept a difference as intentional</h3><p>This does not silently bypass continuity. The note is added to the state definition, then the parent validation runs again against the expanded allowed delta.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><label><span>Intentional difference to add to ${esc(state.name || "this state")}</span><textarea id="accepted-state-difference" placeholder="Example: the vertical status strip activates in this state and is allowed to emit teal light."></textarea></label><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="acceptContinuityStateDifference('${attr(list)}','${attr(id)}','${attr(stateId)}')">ADD TO STATE & REVALIDATE</button></div></div>`);
};
window.acceptContinuityStateDifference = async (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  const note = String(document.getElementById("accepted-state-difference")?.value || "").trim();
  if (!entity || !state || !note) return toast("Describe the intentional difference first");
  const line = `INTENTIONAL APPROVED DELTA: ${note}`;
  if (!String(state.notes || "").includes(line)) state.notes = [state.notes, line].filter(Boolean).join("\n");
  state.parentValidation = null;
  dirty(); closeModal(); route();
  setTimeout(() => validateContinuityStateAgainstParent(list, id, stateId), 160);
};

/* ---------- continuity tracking ------------------------------------------

   What CineBraid is allowed to judge about this reference when it checks two
   frames against each other. Deliberately small: these are production
   decisions, not model settings, and the contract's own machinery — the state
   vocabulary, the coordinate frame, the schema — is derived and stays derived.

   Absent means inherit, so an entity that has never been configured stores
   nothing and behaves exactly as it did before 6.7. */
const CONTINUITY_TRACK_FIELDS = [
  ["presence", "Present or absent", "Whether it is in the frame at all."],
  ["movement", "Position", "Whether it stays where it was, when the camera is locked."],
  ["state", "Continuity state", "Which of its declared states it is in."],
  ["color", "Colour", "One colour name per frame. Leave off for anything multi-tone."],
  ["markings", "Markings", "Text, logos or patterns on its surface."],
];
const CONTINUITY_UNIT_WORDS = [
  ["self", "On its own"],
  ["composite-parent", "One unit, including its parts"],
  ["child", "A tracked part of another reference"],
];
function continuityTrackingPanel(list, it) {
  if (list === "audio") return "";
  const defaults = typeof DEFAULT_TRACKING !== "undefined" ? DEFAULT_TRACKING : { enabled: true, presence: true, movement: true, color: false, state: true, markings: false, unit: "self", parentEntityId: "", identityCues: "" };
  const tracking = typeof resolveEntityTracking === "function" ? resolveEntityTracking(it, null) : { ...defaults };
  const key = `entity:${list}:${it.id}:continuity-tracking`;
  const on = CONTINUITY_TRACK_FIELDS.filter(([name]) => tracking[name]).length;
  const set = (name) => `setEntityContinuityTracking('${attr(list)}','${attr(it.id)}','${attr(name)}'`;
  const others = ["characters", "locations", "props", "vehicles"]
    .flatMap((other) => (P[other] || []).map((entity) => entity))
    .filter((entity) => entity && entity.id !== it.id);
  const checks = CONTINUITY_TRACK_FIELDS.map(([name, label, hint]) =>
    `<label class="continuity-track-option"><input type="checkbox" ${tracking[name] ? "checked" : ""} ${tracking.enabled === false ? "disabled" : ""} onchange="${set(name)},this.checked)"><span><b>${esc(label)}</b><small>${esc(hint)}</small></span></label>`,
  ).join("");
  const parentField = tracking.unit === "child"
    ? `<label class="continuity-track-parent"><span>Part of</span><select onchange="${set("parentEntityId")},this.value)"><option value="">Not chosen</option>${others.map((entity) => `<option value="${attr(entity.id)}" ${tracking.parentEntityId === entity.id ? "selected" : ""}>${esc(entity.name || entity.id)}</option>`).join("")}</select></label>`
    : "";
  return `<details class="fold continuity-tracking" ${workspaceSectionOpen(key, false) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Continuity tracking <span>${tracking.enabled === false ? "off" : `${on}/${CONTINUITY_TRACK_FIELDS.length}`}</span></summary>
    <p class="hint">Track only what genuinely has to stay the same between frames — every extra attribute is another thing that can be reported as a break. Colour is off by default because multi-tone objects rarely survive being reduced to one colour name.</p>
    <label class="checkline continuity-track-enabled"><input type="checkbox" ${tracking.enabled === false ? "" : "checked"} onchange="${set("enabled")},this.checked)"> Check this reference for continuity</label>
    <div class="continuity-track-options">${checks}</div>
    <div class="continuity-track-unit">
      <label><span>Judge it as</span><select ${tracking.enabled === false ? "disabled" : ""} onchange="${set("unit")},this.value)">${CONTINUITY_UNIT_WORDS.map(([value, label]) => `<option value="${attr(value)}" ${tracking.unit === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      ${parentField}
    </div>
    <label class="continuity-track-cues"><span>How to recognise it</span><input value="${attr(tracking.identityCues || "")}" placeholder="Two-tone by design — do not report a single colour" ${tracking.enabled === false ? "disabled" : ""} onchange="${set("identityCues")},this.value)"><small class="hint">One short line. Left blank, CineBraid uses this reference's own description.</small></label>
  </details>`;
}
/* Only the key the user touched is written. An absent key still means inherit,
   so switching one attribute on cannot quietly freeze the rest at today's
   defaults, and an entity reset to its defaults stores nothing at all. */
window.setEntityContinuityTracking = (list, id, key, value) => {
  const entity = (P[list] || []).find((row) => row.id === id);
  if (!entity) return toast("Reference is unavailable");
  const defaults = typeof DEFAULT_TRACKING !== "undefined" ? DEFAULT_TRACKING : {};
  entity.tracking = entity.tracking && typeof entity.tracking === "object" && !Array.isArray(entity.tracking) ? entity.tracking : {};
  if (typeof value === "string" && !value && (key === "identityCues" || key === "parentEntityId")) delete entity.tracking[key];
  else entity.tracking[key] = value;
  if (key === "unit" && value !== "child") delete entity.tracking.parentEntityId;
  for (const [name, fallback] of Object.entries(defaults))
    if (entity.tracking[name] === fallback && name !== "allowedStateValues") delete entity.tracking[name];
  if (!Object.keys(entity.tracking).length) delete entity.tracking;
  markContinuitySchema();
  dirty();
  route();
};

function continuityStatesPanel(list, it, media = []) {
  if (list === "audio") return "";
  const states = entityStateList(it, true);
  const ids = states.map((state) => state.id);
  const activePromptState = states.find((state) => typeof guidedPromptOp === "function" && guidedPromptOp("asset-state", `${list}:${it.id}`, state.id)?.status === "busy");
  const fallback = activePromptState?.id || states.find((state) => !state.approvedFile && !state.isDefault)?.id || ids[0] || "";
  const selectedId = boundedSelected("continuity-state", `${list}:${it.id}`, ids, fallback);
  const selectedIndex = Math.max(0, states.findIndex((state) => state.id === selectedId));
  const st = states[selectedIndex] || states[0];
  const parentInfo = st ? entityStateParentSummary(it, st) : null;
  const selectedApprovedFile = st ? (st.approvedFile || (st.isDefault ? it.approvedFile || "" : "")) : "";
  const selectedApprovedMedia = selectedApprovedFile ? (media || []).find((item) => item.name === selectedApprovedFile) : null;
  const selectedApprovedHero = st ? `<section class="state-approved-hero ${selectedApprovedMedia ? "is-approved" : "is-missing"}"><div class="state-approved-hero-copy"><span>${selectedApprovedMedia ? "CURRENT APPROVED IMAGE" : "APPROVED IMAGE REQUIRED"}</span><b>${esc(st.name || "State")}</b><small>${selectedApprovedFile ? esc(selectedApprovedFile) : "No image has been approved for this state."}</small>${!st.isDefault && parentInfo?.label ? `<em>Derived from ${esc(parentInfo.label)}</em>` : ""}</div>${selectedApprovedMedia ? `<button type="button" class="state-approved-preview" onclick="openMediaTheatre('${attr(encodeURIComponent(selectedApprovedMedia.url))}','${attr(encodeURIComponent(`${st.name || "State"} approved image · ${selectedApprovedFile}`))}','${isVideo(selectedApprovedMedia.name) ? "video" : "image"}')">${isVideo(selectedApprovedMedia.name) ? `<video muted src="${attr(selectedApprovedMedia.url)}"></video>` : `<img src="${attr(selectedApprovedMedia.url)}" alt="Approved ${attr(st.name || "state")}">`}<span>VIEW LARGE</span></button>` : `<button type="button" class="approve-btn" onclick="approveEntityFile('${attr(list)}','${attr(it.id)}','','${attr(st.id)}')">CHOOSE APPROVED IMAGE</button>`}</section>` : "";
  const sectionKey = `entity:${list}:${it.id}:continuity-states`;
  const rail = `<nav class="continuity-state-rail" aria-label="Continuity states">${states.map((state, index) => {
    const approved = !!(state.approvedFile || (state.isDefault && it.approvedFile));
    const requirement = referenceRequirement(state, state.isDefault);
    const tone = approved ? "complete" : requirement === "required" ? "attention" : requirement === "planned" ? "pending" : "optional";
    const status = state.isDefault ? "Main approved image" : approved ? "Approved" : referenceRequirementLabel(state);
    return `<button type="button" class="tone-${tone} ${state.id===selectedId?"selected":""}" onclick="selectBoundedItem('continuity-state','${attr(list+":"+it.id)}','${attr(state.id)}')"><i></i><span><b>${esc(state.name || `State ${index+1}`)}</b><small>${status}</small></span></button>`;
  }).join("")}</nav>`;
  const editor = st ? `<article class="continuity-state-card continuity-state-card-focused ${st.isDefault ? "is-default" : ""}" data-continuity-state-id="${attr(st.id)}"><div class="continuity-state-head"><span>${selectedIndex + 1}</span><input value="${attr(st.name || "")}" placeholder="Clean suit / Damaged sleeve / Night lighting" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'name',this.value)" ${st.isDefault ? 'data-default="1"' : ''}><div class="continuity-state-head-actions">${st.isDefault ? `<button class="chip" onclick="approveEntityFile('${list}','${it.id}','${attr(st.approvedFile || '')}','${attr(st.id)}')">CHOOSE AUTHORITY</button>` : `<button class="chip" onclick="openContinuityStateVariant('${attr(list)}','${attr(it.id)}','${attr(st.id)}')">${st.approvedFile ? "EDIT / REGENERATE" : `GENERATE FROM ${esc(parentInfo.label.toUpperCase())}`}</button><button class="ghost-btn" onclick="openStateReferenceUpload('${attr(list)}','${attr(it.id)}','${attr(st.id)}')">UPLOAD STATE REFERENCE</button><button class="chip" onclick="approveEntityFile('${attr(list)}','${attr(it.id)}','','${attr(st.id)}')">CHOOSE CANDIDATE</button><button class="icon-danger" onclick="removeContinuityState('${list}','${it.id}',${selectedIndex})">×</button>`}</div></div>${selectedApprovedHero}${continuityStateValidationMarkup(list,it,st,media)}<div class="continuity-state-scope"><label>Applies to scenes / shots<input value="${attr(st.appliesTo || "")}" placeholder="Scenes 1–2 or L2-01, L2-02" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'appliesTo',this.value)"></label>${st.isDefault ? `<label>Reference requirement<input value="Required — the main approved image" disabled></label>` : `<label>Reference requirement${referenceRequirementSelect(referenceRequirement(st), `setContinuityState('${list}','${it.id}',${selectedIndex},'referenceRequirement',this.value);dirty();route()`)}</label>`}<div class="state-approved-readout"><span>Approved image</span><b>${esc(st.approvedFile || (st.isDefault ? it.approvedFile || "None selected" : "None selected"))}</b><small>Use Upload State Reference or Choose Candidate above.</small></div></div><label class="continuity-state-delta"><span>${st.isDefault ? "Base-state notes" : "State change / delta"}</span><textarea placeholder="${st.isDefault ? "Primary appearance and any details that must always remain true." : "What changes from the parent state? Also name anything that must remain unchanged."}" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'notes',this.value)">${esc(st.notes || "")}</textarea></label>${typeof assetStatePromptStudio === "function" ? assetStatePromptStudio(list, it, st) : ""}${continuityStateCandidateTray(list,it,st,media)}</article>` : '<div class="canon-notes">No continuity states yet.</div>';
  return `<details class="fold continuity-states" data-entity-continuity="${attr(list + ":" + it.id)}" ${workspaceSectionOpen(sectionKey, true) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(sectionKey)}',this.open)"><summary>Continuity states <span>${states.length}</span></summary><div class="entity-coverage-intro"><div><b>Edit one state at a time</b><small>Other states stay compact so the workflow remains readable.</small></div></div>${continuityTrackingPanel(list, it)}${rail}<details class="state-chain-tools"><summary><span>State tools</span><small>Add another state or automate several parent-first</small></summary><div class="state-tool-actions"><button class="add-btn" onclick="addContinuityState('${list}','${it.id}')">+ Add continuity state</button></div>${typeof entityChainAutomationPanel === "function" ? entityChainAutomationPanel(list, it) : ""}</details><div class="continuity-state-list bounded-single-state">${editor}</div></details>`;
}
window.addContinuityState = (list, id) => {
  const x = P[list].find((e) => e.id === id);
  x.continuityStates = entityStateList(x, true);
  const defaultState = x.continuityStates.find((item) => item.isDefault) || x.continuityStates[0];
  x.continuityStates.push({
    id: "state-" + Date.now().toString(36),
    name: "New state",
    appliesTo: "",
    approvedFile: "",
    notes: "",
    isDefault: false,
    parentStateId: defaultState?.id || "state-default",
    generationMode: "derive",
    referenceRequirement: "planned",
    assetPromptProfile: "",
    assetPromptNotes: "",
    assetPromptBuilds: [],
  });
  dirty();
  route();
};
window.setContinuityState = (list, id, i, k, v) => {
  const x = P[list].find((e) => e.id === id);
  const state = x?.continuityStates?.[i];
  if (!state) return;
  state[k] = v;
  if (["notes", "parentStateId", "name"].includes(k)) state.parentValidation = null;
  dirty();
};
window.removeContinuityState = (list, id, i) => {
  const x = P[list].find((e) => e.id === id);
  if (x.continuityStates[i]?.isDefault) return toast("The default state remains available for every continuity record");
  x.continuityStates.splice(i, 1);
  dirty();
  route();
};
window.requestHumanEntityCandidateApproval = (list, id, fileName, stateId = "state-default", continuation = "entity") => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return toast("Candidate is unavailable");
  const row = entityCandidateRow(entity, fileName, false) || {};
  if (continuation === "coverage") return approveCoverageCandidate(list, id, fileName, row.targetCoverageSlotId, true);
  if (continuation === "extract") return approveEntityFile(list, id, fileName, stateId);
  return approveEntityFile(list, id, fileName, stateId);
};

window.setEntityCandidateDecision = (list, id, fileName, decision) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  const row = entityCandidateRow(entity, fileName, true);
  row.decision = decision || "unreviewed";
  row.decidedAt = new Date().toISOString();
  dirty();
  route();
  toast(decision === "rejected" ? "Candidate moved to Rejected" : "Candidate restored");
};

function coverageTemplateForList(list) {
  const presets = {
    characters: [
      ["front", "Front", true],
      ["front-three-quarter", "3/4 front", true],
      ["profile", "Profile", true],
      ["rear", "Rear", true],
      ["detail-face", "Face / detail", false],
      ["expression", "Expression / optional detail", false],
    ],
    props: [
      ["hero", "Front / hero", true],
      ["three-quarter", "3/4 view", true],
      ["side", "Side", true],
      ["rear", "Rear", false],
      ["top", "Top", false],
      ["detail", "Detail / function close-up", true],
    ],
    vehicles: [
      ["front", "Front", true],
      ["rear", "Rear", true],
      ["left-side", "Left side", true],
      ["right-side", "Right side", true],
      ["front-three-quarter", "Front 3/4", true],
      ["rear-three-quarter", "Rear 3/4", false],
      ["interior", "Interior / cockpit", false],
      ["detail", "Detail", false],
    ],
    locations: [
      ["establishing", "Master establishing", true],
      ["reverse", "Reverse angle", true],
      ["left-coverage", "Left-facing coverage", false],
      ["right-coverage", "Right-facing coverage", false],
      ["action-zone", "Key action zone", true],
      ["entrance-exit", "Entrance / exit", false],
      ["detail-zone", "Detail zone", false],
      ["overhead", "Overhead / layout", false],
    ],
  }
  return (presets[list] || []).map(([id, label, required]) => ({ id, label, required, approvedFile: '', notes: '', status: 'missing' }));
}
function ensureCoverageSlots(list, entity) {
  // v6.5.3.3: explicit project migration owns schema repair. Rendering is read-only.
  return Array.isArray(entity?.coverageSlots) ? entity.coverageSlots : coverageTemplateForList(list);
}
function ensureExpressionSlots(entity) {
  // v6.5.3.3: expression reconciliation runs once during project normalization.
  return Array.isArray(entity?.expressionSlots) ? entity.expressionSlots : [];
}
window.setExpressionSlotField = (id, index, key, value) => {
  const entity = P.characters?.find((item) => item.id === id);
  if (!entity) return;
  const slot = ensureExpressionSlots(entity)[index];
  if (!slot) return;
  if (key !== "approvedFile") { slot[key] = value; dirty(); return; }
  const next = String(value || ""), previous = String(slot.approvedFile || "");
  if (next && entityCandidateIsCoverageSheet(entity, next)) return toast("A full sheet cannot be assigned to a single expression. Extract the panel first.");
  const apply = () => {
    if (previous !== next) recordCoverageReplacement(slot, previous, next, previous ? "expression-replacement" : "expression-assignment");
    slot.approvedFile = next; slot.status = next ? "approved" : "missing"; slot.approvedAt = next ? new Date().toISOString() : "";
    dirty(); route();
  };
  if (previous && next && previous !== next) return confirmModal(`Replace ${slot.label}? ${previous} will remain in replacement history.`, apply, { title: "Replace approved expression", confirmLabel: "REPLACE EXPRESSION" });
  apply();
};
function referenceRequirement(item, isDefault = false) {
  if (isDefault) return "required";
  const explicit = String(item?.referenceRequirement || item?.requirement || "").toLowerCase();
  if (["required", "planned", "not-required"].includes(explicit)) return explicit;
  return item?.required === false ? "planned" : "required";
}
function referenceRequirementLabel(item, isDefault = false) {
  const value = referenceRequirement(item, isDefault);
  return value === "not-required" ? "Not required" : value === "planned" ? "Planned" : "Required";
}
function referenceSlotStatus(slot) {
  if (slot?.approvedFile) return { tone: "complete", label: "Approved" };
  const requirement = referenceRequirement(slot);
  if (requirement === "not-required") return { tone: "optional", label: "Not required" };
  if (requirement === "planned") return { tone: "pending", label: "Planned" };
  return { tone: "attention", label: "Missing" };
}
window.setCoverageSlotRequirement = (list, id, index, value) => {
  const entity = P[list]?.find((item) => item.id === id);
  const slot = entity ? ensureCoverageSlots(list, entity)[index] : null;
  if (!slot) return;
  slot.requirement = ["required", "planned", "not-required"].includes(value) ? value : "required";
  slot.required = slot.requirement === "required";
  dirty();
  route();
};
window.setExpressionSlotRequirement = (id, index, value) => {
  const entity = P.characters?.find((item) => item.id === id);
  const slot = entity ? ensureExpressionSlots(entity)[index] : null;
  if (!slot) return;
  slot.requirement = ["required", "planned", "not-required"].includes(value) ? value : "required";
  slot.required = slot.requirement === "required";
  dirty();
  route();
};
function referenceRequirementSelect(value, onchange) {
  return `<select class="status-select reference-requirement-select" onchange="${onchange}"><option value="required" ${value === "required" ? "selected" : ""}>Required for this project</option><option value="planned" ${value === "planned" ? "selected" : ""}>Planned / useful later</option><option value="not-required" ${value === "not-required" ? "selected" : ""}>Not required</option></select>`;
}

function referenceSlotRailMarkup(scope, entityId, slots, selectedId) {
  return `<nav class="bounded-slot-rail" aria-label="Reference coverage slots">${slots.map((slot) => {
    const state = referenceSlotStatus(slot);
    return `<button type="button" class="tone-${state.tone} ${slot.id === selectedId ? "selected" : ""}" onclick="selectBoundedItem('${attr(scope)}','${attr(entityId)}','${attr(slot.id)}')"><i></i><span>${esc(slot.label)}</span><small>${state.label}</small></button>`;
  }).join("")}</nav>`;
}
function expressionBoardMarkup(entity, mediaByName, media) {
  const sourceSlots = ensureExpressionSlots(entity);
  const slots = sourceSlots.map((slot, sourceIndex) => ({ slot, sourceIndex })).filter((row) => !row.slot.retired);
  const stats = coverageStats(slots.map((row) => row.slot));
  const active = entityCoverageActiveJobs("characters", entity.id, "expressions").length > 0;
  const key = entityCoverageSectionKey("characters", entity.id, "expressions");
  const open = workspaceSectionOpen(key, active || stats.missingRequired > 0);
  const ids = slots.map((row) => row.slot.id);
  const fallback = slots.find((row) => referenceRequirement(row.slot) === "required" && !row.slot.approvedFile)?.slot.id || ids[0] || "";
  const selectedId = boundedSelected("expression-slot", entity.id, ids, fallback);
  const selected = slots.find((row) => row.slot.id === selectedId) || slots[0];
  const slot = selected?.slot;
  const item = slot ? mediaByName.get(slot.approvedFile || "") : null;
  const slotState = slot ? referenceSlotStatus(slot) : null;
  const requirement = slot ? referenceRequirement(slot) : "planned";
  const editor = slot ? `<article class="coverage-slot-card focused-slot-selected ${slot.approvedFile ? "is-ready" : requirement === "required" ? "needs-attention" : ""}"><header><div><span>${esc(referenceRequirementLabel(slot).toUpperCase())} EXPRESSION</span><b>${esc(slot.label)}</b></div><span class="coverage-slot-state">${slotState.label}</span></header><div class="coverage-slot-preview">${item ? `<img src="${attr(item.url)}" alt="">` : `<div class="coverage-slot-empty">${requirement === "not-required" ? "No reference needed" : "No approved expression"}</div>`}</div><label><span>Project need</span>${referenceRequirementSelect(requirement, `setExpressionSlotRequirement('${entity.id}',${selected.sourceIndex},this.value)`)}</label><label><span>Approved file</span><select onchange="setExpressionSlotField('${entity.id}',${selected.sourceIndex},'approvedFile',this.value)">${coverageSlotOptions(media,slot.approvedFile||"",entity)}</select></label><label><span>Performance notes</span><textarea placeholder="Physical expression, intensity, and what must remain unchanged." onchange="setExpressionSlotField('${entity.id}',${selected.sourceIndex},'notes',this.value)">${esc(slot.notes||"")}</textarea></label></article>` : `<div class="entity-candidate-empty"><b>No expression slots configured</b><span>Add expressions only when this project needs them.</span></div>`;
  const manual = `<div class="compact-section-actions coverage-board-actions manual-coverage-actions"><button class="approve-btn" onclick="openCoverageSheetPicker('characters','${entity.id}')">Crop expression sheet</button></div>`;
  const assisted = `<details class="coverage-assisted-actions" ${manualFirstWorkflow() ? "" : "open"}><summary>Optional assisted creation</summary><div class="compact-section-actions coverage-board-actions"><button class="approve-btn" onclick="openCoverageExpressionAutomation('${entity.id}')">Generate expression sheet</button></div></details>`;
  return `<details class="fold compact-entity-section entity-expression-section bounded-source-section" ${open ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Expression board <span>${stats.approvedRequired}/${stats.required} required approved${stats.planned ? ` · ${stats.planned} planned` : ""}${active ? " · generating" : ""}</span></summary>${entityCoverageActivityMarkup("characters", entity, "expressions")}<div class="entity-coverage-intro"><div><b>${stats.approvedTotal} of ${stats.total} expressions assigned</b><small>Mark each expression Required, Planned, or Not required. Only required gaps affect project attention.</small></div></div>${referenceSlotRailMarkup("expression-slot", entity.id, slots.map((row) => row.slot), selectedId)}<div class="coverage-slot-grid bounded-single-slot">${editor}</div>${manual}${assisted}</details>`;
}

function coverageStats(slots) {
  const active = slots.filter((slot) => !slot.retired);
  const required = active.filter((slot) => referenceRequirement(slot) === "required");
  const planned = active.filter((slot) => referenceRequirement(slot) === "planned");
  const notRequired = active.filter((slot) => referenceRequirement(slot) === "not-required");
  const approvedRequired = required.filter((slot) => slot.approvedFile).length;
  const approvedTotal = active.filter((slot) => slot.approvedFile).length;
  const missingRequired = required.filter((slot) => !slot.approvedFile).length;
  return { required: required.length, planned: planned.length, notRequired: notRequired.length, approvedRequired, approvedTotal, total: active.length, missingRequired };
}
function coverageSlotOptions(media, selected = '', entity = null) {
  const eligible = (media || []).filter((item) => !entity || !entityCandidateIsCoverageSheet(entity, item.name));
  return [`<option value="">— no approved view assigned —</option>`].concat(eligible.map((item) => `<option value="${attr(item.name)}" ${item.name === selected ? 'selected' : ''}>${esc(item.name)}</option>`)).join('');
}
function recordCoverageReplacement(slot, previousFile, nextFile, source = "manual") {
  slot.replacementHistory = Array.isArray(slot.replacementHistory) ? slot.replacementHistory : [];
  slot.replacementHistory.push({ at: new Date().toISOString(), previousFile: previousFile || "", nextFile: nextFile || "", source });
  slot.replacementHistory = slot.replacementHistory.slice(-20);
}
function applyCoverageAssignment(list, entity, slot, fileName, source = "manual") {
  if (fileName && entityCandidateIsCoverageSheet(entity, fileName)) return toast("A multi-view sheet cannot be approved as a single angle. Extract a panel first.");
  const previous = String(slot.approvedFile || "");
  if (previous !== String(fileName || "")) recordCoverageReplacement(slot, previous, fileName, source);
  slot.approvedFile = String(fileName || "");
  slot.status = slot.approvedFile ? "approved" : "missing";
  slot.approvedAt = slot.approvedFile ? new Date().toISOString() : "";
  if (slot.approvedFile) slot.provenance = { ...(slot.provenance || {}), source, approvedAt: slot.approvedAt };
  dirty();
  route();
}
window.setCoverageSlotField = (list, id, index, key, value) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  const slot = ensureCoverageSlots(list, entity)[index];
  if (!slot) return;
  if (key !== "approvedFile") { slot[key] = value; dirty(); return; }
  const previous = String(slot.approvedFile || ""), next = String(value || "");
  if (previous && next && previous !== next) {
    return confirmModal(`Replace ${slot.label}?`, () => applyCoverageAssignment(list, entity, slot, next, "manual-replacement"), { title: "Replace the approved image for this view", confirmLabel: "REPLACE VIEW", body: `${previous} will remain in history, but ${next} becomes the new approved image for this view.` });
  }
  applyCoverageAssignment(list, entity, slot, next, "manual-assignment");
};
window.approveCoverageCandidate = (list, id, fileName, slotId, directOverride = false) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  const row = entityCandidateRow(entity, fileName, false) || {};
  const slots = row.coverageGroup === "expressions" ? ensureExpressionSlots(entity).filter((item) => !item.retired) : ensureCoverageSlots(list, entity);
  const slot = slots.find((item) => item.id === slotId);
  if (!slot) return toast("Coverage slot is unavailable");
  const review = entityCandidateTargetReview(entity, fileName);
  if (!directOverride && !review?.pass) return toast("Run and pass AI review before approving this coverage view.");
  const commit = () => {
    if (row.coverageGroup === "expressions") {
      const previous = String(slot.approvedFile || "");
      if (previous !== fileName) recordCoverageReplacement(slot, previous, fileName, directOverride ? "human-expression-approval" : "reviewed-expression-candidate");
      slot.approvedFile = fileName; slot.status = "approved"; slot.approvedAt = new Date().toISOString();
    } else {
      const previous = String(slot.approvedFile || "");
      if (previous !== fileName) recordCoverageReplacement(slot, previous, fileName, directOverride ? "human-coverage-approval" : "reviewed-coverage-candidate");
      slot.approvedFile = fileName; slot.status = "approved"; slot.approvedAt = new Date().toISOString();
      slot.provenance = { ...(slot.provenance || {}), source: directOverride ? "human-coverage-approval" : "reviewed-coverage-candidate", approvedAt: slot.approvedAt };
    }
    row.decision = row.coverageGroup === "expressions" ? "approved-expression" : "approved-coverage";
    row.reviewRequired = false;
    row.directApprovalOverride = !!directOverride;
    row.humanApproved = true;
    row.humanApprovedWithoutAI = !!directOverride;
    row.approvalProvenance = { source: "human", aiReviewed: !directOverride, approvedAt: slot.approvedAt };
    row.decidedAt = slot.approvedAt;
    row.approvedCoverageSlotId = slot.id;
    dirty(); route(); toast(`${slot.label} ${row.coverageGroup === "expressions" ? "expression" : "coverage"} approved`);
  };
  const replaceOrCommit = () => {
    if (slot.approvedFile && slot.approvedFile !== fileName) return confirmModal(`Replace ${slot.label}? ${slot.approvedFile} will remain in replacement history.`, commit, { title: "Replace the approved image for this view", confirmLabel: "REPLACE VIEW" });
    commit();
  };
  if (directOverride) return confirmModal(`Assign ${fileName} to ${slot.label} based on human judgment? CineBraid will record that no current AI check authorized this assignment.`, replaceOrCommit, { title: "Human approval", confirmLabel: "ASSIGN VIEW" });
  replaceOrCommit();
};
window.addCoverageSlot = (list, id) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  const slots = ensureCoverageSlots(list, entity);
  slots.push({ id: 'custom-' + Date.now().toString(36), label: 'Custom slot', required: false, approvedFile: '', notes: '', status: 'missing' });
  dirty();
  route();
};
function coveragePassingAssignmentQueue(entity, group = "angles") {
  return (entity.candidateFiles || []).filter((row) => {
    if (!row?.targetCoverageSlotId || row.decision === "approved-coverage" || row.decision === "approved-expression" || row.decision === "rejected") return false;
    if ((group === "expressions") !== (row.coverageGroup === "expressions")) return false;
    const fileName = row.stored || row.name || row.original || "";
    return entityCandidateTargetReview(entity, fileName)?.pass === true;
  });
}
window.openCoverageReviewQueue = (list, id, group = "angles") => {
  try { localStorage.setItem(entityCandidateFilterKey(list, id), group === "expressions" ? "expressions" : "coverage"); } catch {}
  window.selectBoundedTask?.("entity-task", `${list}:${id}`, "review");
};
function coverageBoardMarkup(list, entity, mediaByName, media) {
  if (list === "audio") return "";
  const slots = ensureCoverageSlots(list, entity);
  const stats = coverageStats(slots);
  const active = entityCoverageActiveJobs(list, entity.id, "angles").length > 0;
  const waitingAssignments = coveragePassingAssignmentQueue(entity, "angles");
  const assignmentNotice = waitingAssignments.length ? `<div class="coverage-assignment-notice"><div><span>AI CHECK PASSED · HUMAN ASSIGNMENT REQUIRED</span><b>${waitingAssignments.length} checked candidate${waitingAssignments.length === 1 ? "" : "s"} waiting to fill a view slot</b><small>An AI check never assigns authority by itself. Choose the final view based on human judgment.</small></div><button class="approve-btn" onclick="openCoverageReviewQueue('${attr(list)}','${attr(entity.id)}','angles')">Open candidates</button></div>` : "";
  const key = entityCoverageSectionKey(list, entity.id, "angles");
  const open = workspaceSectionOpen(key, active || stats.missingRequired > 0);
  const ids = slots.map((slot) => slot.id);
  const fallback = slots.find((slot) => referenceRequirement(slot) === "required" && !slot.approvedFile)?.id || ids[0] || "";
  const selectedId = boundedSelected("coverage-slot", `${list}:${entity.id}`, ids, fallback);
  const selectedIndex = Math.max(0, slots.findIndex((slot) => slot.id === selectedId));
  const slot = slots[selectedIndex];
  const mediaItem = slot ? mediaByName.get(slot.approvedFile || "") : null;
  const slotState = slot ? referenceSlotStatus(slot) : null;
  const requirement = slot ? referenceRequirement(slot) : "planned";
  const editor = slot ? `<article class="coverage-slot-card focused-slot-selected ${slot.approvedFile ? "is-ready" : requirement === "required" ? "needs-attention" : ""}"><header><div><span>${esc(referenceRequirementLabel(slot).toUpperCase())} SLOT</span><b>${esc(slot.label)}</b></div><span class="coverage-slot-state">${slotState.label}</span></header><div class="coverage-slot-preview">${mediaItem ? (isVideo(mediaItem.name) ? `<video muted src="${attr(mediaItem.url)}"></video>` : `<img src="${attr(mediaItem.url)}" alt="">`) : `<div class="coverage-slot-empty">${requirement === "not-required" ? "No reference needed" : "No approved reference"}</div>`}</div><label><span>Project need</span>${referenceRequirementSelect(requirement, `setCoverageSlotRequirement('${list}','${entity.id}',${selectedIndex},this.value)`)}</label><label><span>Approved file</span><select onchange="setCoverageSlotField('${list}','${entity.id}',${selectedIndex},'approvedFile',this.value)">${coverageSlotOptions(media, slot.approvedFile || "", entity)}</select></label>${slot.approvedFile ? `<div class="approval-provenance-note">${String(slot.provenance?.source || "").includes("human") ? "Human approved" : "Approved image"}${String(slot.provenance?.source || "").includes("human") && !entityCandidateTargetReview(entity, slot.approvedFile)?.pass ? " · not AI checked" : ""}</div>` : ""}<label><span>Notes</span><textarea placeholder="When to use this slot, framing constraints, or what makes this view the right one to approve." onchange="setCoverageSlotField('${list}','${entity.id}',${selectedIndex},'notes',this.value)">${esc(slot.notes || "")}</textarea></label></article>` : `<div class="entity-candidate-empty"><b>No coverage slots configured</b><span>Add only the views this project actually needs.</span></div>`;
  const manualActions = `<div class="compact-section-actions coverage-board-actions manual-coverage-actions"><button class="approve-btn" onclick="openImportedReferenceMapper('${list}','${entity.id}')">Map imported references</button><button class="ghost-btn" onclick="openCoverageSheetPicker('${list}','${entity.id}')">Crop reference sheet</button><button class="add-btn" onclick="addCoverageSlot('${list}','${entity.id}')">+ Add custom slot</button></div>`;
  const assistedActions = `<details class="coverage-assisted-actions" ${manualFirstWorkflow() ? "" : "open"}><summary>Optional assisted creation</summary><div class="compact-section-actions coverage-board-actions"><button class="approve-btn" onclick="openCoverageAutomationModal('${list}','${entity.id}','hybrid')">Generate missing angles</button></div></details>`;
  return `<details class="fold compact-entity-section entity-coverage-section bounded-source-section" ${open ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Coverage board <span>${stats.approvedRequired}/${stats.required} required approved${stats.planned ? ` · ${stats.planned} planned` : ""}${active ? " · generating" : ""}</span></summary>${entityCoverageActivityMarkup(list, entity, "angles")}${assignmentNotice}<div class="entity-coverage-intro"><div><b>${stats.approvedTotal} of ${stats.total} views assigned</b><small>Mark each view Required, Planned, or Not required. Imported references can fill slots directly; generation is optional.</small></div></div>${referenceSlotRailMarkup("coverage-slot", `${list}:${entity.id}`, slots, selectedId)}<div class="coverage-slot-grid bounded-single-slot">${editor}</div>${manualActions}${assistedActions}</details>`;
}



function referenceCreationHub(list, entity) {
  if (list === "audio") return "";
  const states = entityStateList(entity, true);
  const primary = states.find((state) => state.isDefault) || states[0];
  const primaryFile = primary?.approvedFile || entity.approvedFile || "";
  const mediaCount = entityMedia(list, entity).length;
  const coverage = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : (entity.coverageSlots || []);
  const approvedViews = coverage.filter((slot) => slot.approvedFile).length;
  const approvedStates = states.filter((state) => state.approvedFile || (state.isDefault && entity.approvedFile)).length;
  return `<section class="reference-manual-hub"><header><div><span>UPLOAD & ORGANIZE</span><h2>Build the approved reference pack</h2><p>Import work made anywhere, choose which images are approved, split reference sheets into usable angles, then attach them to shots. AI review and generation are optional.</p></div><span class="reference-manual-status">${primaryFile ? "PRIMARY READY" : "PRIMARY NEEDED"} · ${approvedViews}/${coverage.length || 0} VIEWS · ${approvedStates}/${states.length || 0} STATES</span></header><div class="reference-manual-actions"><button class="approve-btn recommended" onclick="document.getElementById('entity-file').click()"><span>Upload reference files</span><small>Add existing images or video from disk</small></button><button class="ghost-btn" onclick="openImportedReferenceMapper('${attr(list)}','${attr(entity.id)}')"><span>Map imported references</span><small>Assign a single image to primary, state, angle, or expression</small></button><button class="ghost-btn" ${mediaCount ? "" : "disabled"} onclick="openCoverageSheetPicker('${attr(list)}','${attr(entity.id)}')"><span>Crop reference sheet</span><small>Cut a turnaround or contact sheet into individual angle files</small></button><button class="ghost-btn" ${mediaCount ? "" : "disabled"} onclick="approveEntityFile('${attr(list)}','${attr(entity.id)}','${attr(primaryFile)}','${attr(primary?.id || "state-default")}')"><span>Choose the main approved image</span><small>${primaryFile ? `Currently ${esc(primaryFile)}` : mediaCount ? "Select one uploaded image" : "Upload a reference first"}</small></button></div><div class="reference-manual-principle"><b>CineBraid stores the production truth.</b><span>Human approval is enough. Optional AI checks can be run later without changing the image you approved.</span></div></section>`;
}
function referenceAssistedToolsMarkup(list, entity) {
  if (list === "audio") return "";
  const coverage = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : (entity.coverageSlots || []);
  const missingRequired = coverage.filter((slot) => referenceRequirement(slot) === "required" && !slot.approvedFile && !slot.retired).length;
  const primaryReady = !!(entity.approvedFile || (entity.continuityStates || []).find((state) => state.isDefault)?.approvedFile);
  const alternateStates = entityStateList(entity, true).filter((state) => !state.isDefault && referenceRequirement(state) === "required");
  const missingStates = alternateStates.filter((state) => !state.approvedFile).length;
  const expressionButton = list === "characters" ? `<button class="ghost-btn" onclick="openCoverageExpressionAutomation('${attr(entity.id)}')"><span>Generate expression sheet</span><small>Optional faces and performance coverage</small></button>` : "";
  const sectionKey = `reference-assisted:${list}:${entity.id}`;
  const open = workspaceSectionOpen(sectionKey, !manualFirstWorkflow());
  return `<details class="reference-assisted-tools" data-ui-state-key="${attr(sectionKey)}" ${open ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(sectionKey)}',this.open)"><summary><div><span>OPTIONAL ASSISTED TOOLS</span><b>Prompt building, generation, and automation</b><small>Open this only when CineBraid should help create material you do not already have.</small></div><span>${primaryReady ? `${missingRequired + missingStates} missing` : "primary first"}</span></summary><div class="reference-assisted-tools-body"><div class="reference-creation-actions reference-creation-actions-expanded"><button class="ghost-btn" onclick="openEntityCreationSection('${attr(list)}','${attr(entity.id)}')"><span>Build primary prompt</span><small>Compile a prompt without submitting generation</small></button><button class="ghost-btn" ${primaryReady ? "" : "disabled"} onclick="openCoverageAutomationModal('${attr(list)}','${attr(entity.id)}','hybrid')"><span>Generate angle / viewpoint coverage</span><small>${missingRequired ? `${missingRequired} required view${missingRequired === 1 ? "" : "s"} remain` : "Coverage is already complete or optional"}</small></button>${expressionButton}<button class="ghost-btn" ${primaryReady ? "" : "disabled"} onclick="openContinuityStateVariantHub('${attr(list)}','${attr(entity.id)}')"><span>Generate continuity-state variant</span><small>${missingStates ? `${missingStates} state reference${missingStates === 1 ? "" : "s"} remain` : "No required state reference is missing"}</small></button></div>${assetPromptStudio(list, entity)}</div></details>`;
}
function referenceWorkspaceMarkup(list, entity) {
  return `${referenceCreationHub(list, entity)}${referenceAssistedToolsMarkup(list, entity)}`;
}
window.openEntityCreationSection = (list, id) => {
  window.selectBoundedTask?.("entity-task", `${list}:${id}`, "reference");
  const outer = document.querySelector(`.reference-assisted-tools`);
  const section = document.querySelector(`.asset-creation-card`);
  if (!section) return toast("Primary reference builder is unavailable");
  if (outer?.tagName === "DETAILS") {
    outer.open = true;
    rememberWorkspaceSection(`reference-assisted:${list}:${id}`, true);
  }
  if (section.tagName === "DETAILS") {
    section.open = true;
    rememberWorkspaceSection(`asset-prompt:${list}:${id}`, true);
  }
  section.hidden = false;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  section.classList.add("focus-flash");
  setTimeout(() => section.classList.remove("focus-flash"), 1200);
};
function entityGenerationRecordsMarkup(list, entity) {
  const id = entity.id;
  return `<details class="fold compact-entity-section" open><summary>Generation records — provenance <span>${(entity.made || []).length}</span></summary><div class="section-label">Generation record — model + prompt that made the approved files</div>${(entity.made || []).map((g,gi) => `<div class="block-row"><div class="block-row-head"><select class="status-select" onchange="P['${list}'].find(x=>x.id==='${id}').made[${gi}].model=this.value;dirty()"><option value="">model…</option>${(P.meta.models || []).map((m) => `<option value="${m.id}" ${g.model === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select><input style="width:200px" placeholder="file(s)" value="${attr(g.files || "")}" onchange="P['${list}'].find(x=>x.id==='${id}').made[${gi}].files=this.value;dirty()"><span class="dur-chip">${esc(g.date || "")}</span>${g.automationRunId ? `<span class="dur-chip">AUTOMATION · ${esc(g.approval || "approved")}</span><button class="chip" onclick="copyEntityAutomationReport('${list}','${id}',${gi})">COPY RUN REPORT</button>` : ""}<button class="copy-btn" style="margin-left:auto" onclick="copyText(P['${list}'].find(x=>x.id==='${id}').made[${gi}].prompt||'')">COPY</button><button class="chip" onclick="P['${list}'].find(x=>x.id==='${id}').made.splice(${gi},1);dirty();route()">remove</button></div><textarea placeholder="the exact prompt used" onchange="P['${list}'].find(x=>x.id==='${id}').made[${gi}].prompt=this.value;dirty()">${esc(g.prompt || "")}</textarea></div>`).join("")}<button class="add-btn" onclick="(P['${list}'].find(x=>x.id==='${id}').made=P['${list}'].find(x=>x.id==='${id}').made||[]).push({model:'',files:'',prompt:'',date:new Date().toISOString().slice(0,10)});dirty();route()">+ Add generation record</button></details>`;
}
function entitySavedPromptsMarkup(list, entity) {
  const id=entity.id, prompts=entity.prompts || [];
  if (!prompts.length) return `<div class="entity-candidate-empty"><b>No saved Phase 1 prompts</b><span>Build a plate or sheet prompt from the primary creation task.</span></div>`;
  return `<details class="fold compact-entity-section" open><summary>Saved Phase 1 prompts <span>${prompts.length}</span></summary>${prompts.map((pr,pi) => `<div class="block-row"><div class="block-row-head"><span class="opt-id">${esc(pr.id)}</span><button class="copy-btn" style="margin-left:auto" onclick="copyText(P['${list}'].find(x=>x.id==='${id}').prompts[${pi}].text)">COPY</button><button class="chip" onclick="P['${list}'].find(x=>x.id==='${id}').prompts.splice(${pi},1);dirty();route()">remove</button></div><div class="opt-refs" style="white-space:pre-wrap">${esc(pr.text)}</div></div>`).join("")}</details>`;
}
function entityReconciliationMarkup(list, entity) {
  const id=entity.id;
  return `<details class="fold compact-entity-section" open><summary>Reconciliation & coverage</summary><div class="two-col">${field("Same object as (canonical id — for inserts/variants across chats)", `<input list="entity-ids" value="${attr(entity.sameObjectAs || "")}" onchange="setVal('${list}','${id}','sameObjectAs',this.value)" placeholder="e.g. PROP-SPOON">`)}${field("Role (if variant)", `<input value="${attr(entity.role || "")}" onchange="setVal('${list}','${id}','role',this.value)" placeholder="e.g. insert / state B / degraded">`)}</div><datalist id="entity-ids">${[...P.characters,...P.locations,...P.props,...(P.vehicles||[])].map((e)=>`<option value="${attr(e.id)}">`).join("")}</datalist>${list === "locations" ? field("Coverage policy", `<select class="status-select" onchange="setVal('${list}','${id}','coveragePolicy',this.value)">${["","locked-setup-only (reuse the plate, never re-angle)","re-frame-safe (generic geometry)"].map((o)=>`<option value="${attr(o)}" ${entity.coveragePolicy===o?"selected":""}>${esc(o||"— unset —")}</option>`).join("")}</select><div class="hint">New framings are derived from the original locked plate, never from a derivation.</div>`) : ""}</details>`;
}
function boundedEntityTaskStatus(list, entity, taskId, activeCandidates, states) {
  /* Same status vocabulary as the shot taskbar (STAGE_STATUS), for the same reason:
     the two taskbars look identical, so they must not speak different languages.
     Counts live in `note`, which the taskbar prints in the description line. */
  const primary = !!(entity.approvedFile || states.find((state)=>state.isDefault)?.approvedFile);
  if (taskId === "reference") return primary ? {tone:"complete",label:STAGE_STATUS.approved} : {tone:"attention",label:STAGE_STATUS.incomplete,note:"no approved image yet"};
  if (taskId === "review") return activeCandidates.length ? {tone:"attention",label:STAGE_STATUS.needsReview,note:`${plural(activeCandidates.length, "file")} to choose from`} : {tone:"optional",label:STAGE_STATUS.nothingWaiting};
  if (taskId === "coverage") {
    const coverage = coverageStats(ensureCoverageSlots(list,entity));
    const expressions = list === "characters" ? coverageStats(ensureExpressionSlots(entity).filter((slot)=>!slot.retired)) : {missingRequired:0};
    const missingStates = states.filter((state)=>!state.isDefault && referenceRequirement(state) === "required" && !state.approvedFile).length;
    const planned = states.filter((state)=>!state.isDefault && referenceRequirement(state) === "planned" && !state.approvedFile).length + coverage.planned + expressions.planned;
    const active = entityCoverageActiveJobs(list,entity.id,"angles").length + (list === "characters" ? entityCoverageActiveJobs("characters",entity.id,"expressions").length : 0);
    const missing = coverage.missingRequired + expressions.missingRequired + missingStates;
    return active ? {tone:"active",label:STAGE_STATUS.running} : missing ? {tone:"attention",label:STAGE_STATUS.incomplete,note:`${plural(missing, "required view")} missing`} : planned ? {tone:"pending",label:STAGE_STATUS.inProgress,note:`${plural(planned, "view")} planned`} : {tone:"complete",label:STAGE_STATUS.complete};
  }
  if (taskId === "details") {
    const hasDetails = String(entity.block || entity.notes || entity.creationDescription || "").trim() || (entity.planningMedia || []).length;
    return hasDetails ? {tone:"complete",label:STAGE_STATUS.complete} : {tone:"pending",label:STAGE_STATUS.notStarted};
  }
  if (taskId === "history") {
    const count=(entity.made || []).length + (entity.prompts || []).length;
    return count ? {tone:"complete",label:STAGE_STATUS.complete,note:plural(count, "record")} : {tone:"optional",label:STAGE_STATUS.notStarted};
  }
  return {tone:"pending",label:STAGE_STATUS.notStarted};
}
function boundedEntityTaskbarMarkup(list, entity, specs, selectedId, activeCandidates, states) {
  const context=`${list}:${entity.id}`;
  return `<nav class="focused-taskbar bounded-entity-taskbar clarity-taskbar" aria-label="Reference workspaces">${specs.map((spec)=>{const status=boundedEntityTaskStatus(list,entity,spec.id,activeCandidates,states);return `<button type="button" class="focused-task-button tone-${status.tone} ${spec.id===selectedId?"selected":""}" onclick="selectBoundedTask('entity-task','${attr(context)}','${attr(spec.id)}')" title="${attr(spec.label + " — " + status.label)}"><i></i><span><b>${esc(spec.label)}</b><small>${esc(status.note ? `${spec.detail || ""} · ${status.note}` : spec.detail || "")}</small></span><em>${esc(status.label)}</em></button>`;}).join("")}</nav>`;
}
function entityAuthoritySummaryMarkup(list, entity, states, mediaByName, selectedTask = "") {
  if (list === "audio") return "";
  const approvedCount = states.filter((state)=>state.approvedFile || (state.isDefault && entity.approvedFile)).length;
  const authorityStatus = `<b class="entity-authority-status"><strong>${approvedCount}/${states.length}</strong><span>${pluralWord(states.length, "state has", "states have")} an approved image</span></b>`;
  if (selectedTask === "coverage") return `<section class="entity-authority-summary is-compact"><header><div><span class="entity-authority-label">APPROVED IMAGES</span>${authorityStatus}<small>Approved images for each state are chosen in the editor below.</small></div></header></section>`;
  const rows = states.map((state) => {
    const fileName = state.approvedFile || (state.isDefault ? entity.approvedFile || "" : "");
    const media = mediaByName.get(fileName);
    const candidate = fileName ? entityCandidateRow(entity, fileName, false) : null;
    const approvalNote = candidate?.humanApprovedWithoutAI ? " · Human approved, not AI checked" : candidate?.humanApproved ? " · Human approved" : "";
    const isSheet = !!(media && entityCandidateIsCoverageSheet(entity, fileName));
    const openState = `boundedWriteState('selected:entity-coverage-view','${attr(list+":"+entity.id)}','states');boundedWriteState('selected:continuity-state','${attr(list+":"+entity.id)}','${attr(state.id)}');selectBoundedTask('entity-task','${attr(list+":"+entity.id)}','coverage')`;
    const previewAction = media ? `openMediaTheatre('${attr(encodeURIComponent(media.url))}','${attr(encodeURIComponent(`${state.name || "Default"} approved image · ${fileName}`))}','${isVideo(media.name) ? "video" : "image"}')` : openState;
    return `<article class="entity-authority-row ${media?"ready":"missing"} ${isSheet?"is-sheet":""}"><button type="button" class="entity-authority-thumb-button" onclick="${previewAction}" aria-label="${media ? `Preview approved ${attr(state.name || "state")} authority` : `Open ${attr(state.name || "state")}`}"><span class="entity-authority-thumb">${media ? (isVideo(media.name) ? `<video muted src="${attr(media.url)}"></video>` : `<img src="${attr(media.url)}" alt="">`) : "—"}</span><small>${media ? "VIEW LARGE" : "MISSING"}</small></button><button type="button" class="entity-authority-details" onclick="${openState}"><span><b>${esc(state.name || "Default")}</b><small>${fileName ? `${esc(fileName)}${esc(approvalNote)}` : "No approved image yet"}</small></span><em>${isSheet?"MULTI-VIEW SHEET":media?"APPROVED":"MISSING"}</em></button>${isSheet ? `<button type="button" class="chip entity-authority-extract" onclick="openCoverageSheetExtractor('${attr(list)}','${attr(entity.id)}','${attr(fileName)}')">EXTRACT VIEWS</button>` : ""}</article>`;
  }).join("");
  return `<section class="entity-authority-summary"><header><div><span class="entity-authority-label">APPROVED IMAGES</span>${rows ? authorityStatus : `<b class="entity-authority-status"><span>No states</span></b>`}</div></header><div>${rows}</div></section>`;
}
function entityCoverageStatesMarkup(list, entity, mediaByName, media) {
  const views = [{id:"coverage",label:"Angles / views",render:()=>coverageBoardMarkup(list,entity,mediaByName,media)}];
  if (list === "characters") views.push({id:"expressions",label:"Expressions",render:()=>expressionBoardMarkup(entity,mediaByName,media)});
  views.push({id:"states",label:"Continuity states",render:()=>continuityStatesPanel(list,entity,media)});
  const ids=views.map((view)=>view.id), context=`${list}:${entity.id}`;
  const fallback = entityStateList(entity,true).some((state)=>!state.isDefault && !state.approvedFile) ? "states" : "coverage";
  const selectedId=boundedSelected("entity-coverage-view",context,ids,fallback), selected=views.find((view)=>view.id===selectedId)||views[0];
  return `<section class="entity-subworkspace"><nav class="entity-subworkspace-tabs" aria-label="Coverage and state tools">${views.map((view)=>`<button type="button" class="${view.id===selectedId?"selected":""}" onclick="selectBoundedItem('entity-coverage-view','${attr(context)}','${attr(view.id)}')">${esc(view.label)}</button>`).join("")}</nav><div data-entity-subworkspace="${attr(selected.id)}">${selected.render()}</div></section>`;
}
function entityDetailsHistoryMarkup(list, entity, extra) {
  const dangerZone = `<details class="entity-danger-zone"><summary>Advanced reference actions</summary><div><p class="hint">Deleting a reference removes it from this project. Media files remain on disk.</p><button class="danger-btn" onclick="delEntity('${list}','${entity.id}');location.hash='#/library/${list}'">Delete reference</button></div></details>`;
  const views=[
    {id:"details",label:"Details",render:()=>`<details open class="fold compact-entity-section"><summary>Identity & production notes</summary>${extra(entity)}</details>${entityPlanningMediaPanel(list,entity)}${list === "audio" ? "" : entityReconciliationMarkup(list,entity)}`},
    {id:"history",label:"History",render:()=>`${entityGenerationRecordsMarkup(list,entity)}${entitySavedPromptsMarkup(list,entity)}`},
  ];
  const context=`${list}:${entity.id}`, ids=views.map((view)=>view.id), selectedId=boundedSelected("entity-detail-view",context,ids,"details"), selected=views.find((view)=>view.id===selectedId)||views[0];
  return `<section class="entity-subworkspace"><nav class="entity-subworkspace-tabs" aria-label="Details and history"><button type="button" class="${selected.id==="details"?"selected":""}" onclick="selectBoundedItem('entity-detail-view','${attr(context)}','details')">Details</button><button type="button" class="${selected.id==="history"?"selected":""}" onclick="selectBoundedItem('entity-detail-view','${attr(context)}','history')">History</button></nav>${selected.render()}${dangerZone}</section>`;
}
function entityPage(list, id, extra) {
  const rows = Array.isArray(P[list]) ? P[list] : [];
  const it=rows.find((x)=>x.id===id);
  if(!it) {
    const typeLabel={characters:"Character",locations:"Location",props:"Prop",vehicles:"Vehicle",audio:"Audio reference"}[list] || "Reference";
    return sharedNotFoundView(typeLabel,id,`#/library/${list}`,`${typeLabel}s`,rows.map((row)=>row.id),`#/${list === "characters" ? "character" : list === "locations" ? "location" : list === "props" ? "prop" : list === "vehicles" ? "vehicle" : "audio"}`);
  }
  const media=entityMedia(list,it), wf=entityWorkflowState(it), states=list === "audio" ? [] : entityStateList(it,true), mediaByName=new Map(media.map((item)=>[item.name,item]));
  const approvedNames=new Set([...states.map((state)=>state.approvedFile || (state.isDefault ? it.approvedFile || "" : "")),...(it.coverageSlots||[]).map((slot)=>slot.approvedFile),...(it.expressionSlots||[]).map((slot)=>slot.approvedFile)].filter(Boolean));
  const activeCandidates=media.filter((item)=>!approvedNames.has(item.name) && entityCandidateRow(it,item.name,false)?.decision !== "rejected"), rejectedCandidates=media.filter((item)=>!approvedNames.has(item.name) && entityCandidateRow(it,item.name,false)?.decision === "rejected");
  const candidateFilter=entityCandidateFilter(list,id), filteredCandidates=activeCandidates.filter((item)=>entityCandidateMatchesFilter(it,item.name,candidateFilter));
  const candidatePage=boundedPage(filteredCandidates,"candidates",`${list}:${id}:active:${candidateFilter}`,BOUNDED_PAGE_SIZES.candidates), rejectedPage=boundedPage(rejectedCandidates,"candidates",`${list}:${id}:rejected`,BOUNDED_PAGE_SIZES.candidates), audioPage=boundedPage(media,"candidates",`${list}:${id}:audio`,BOUNDED_PAGE_SIZES.candidates);
  const candidateJson=encodeURIComponent(JSON.stringify(candidatePage.rows)), rejectedJson=encodeURIComponent(JSON.stringify(rejectedPage.rows));
  const approvedTask = `<details class="fold compact-entity-section bounded-source-section" open><summary>${list === "audio" ? "Audio candidates" : "Approved references"} <span>${media.length}</span></summary><div class="entity-media">${audioPage.rows.map((m)=>`<div class="entity-tile-wrap"><div class="entity-tile ${list === "audio" ? "audio-tile" : ""}">${list === "audio" ? `<span class="audio-icon">🔈</span><audio controls src="${m.url}"></audio>` : (isVideo(m.name)?`<video muted src="${m.url}"></video>`:`<img src="${m.url}" alt="">`)}<span class="entity-tile-name">${esc(m.name)}</span></div><button class="approve-tile-btn" onclick="approveEntityFile('${list}','${id}','${attr(m.name)}')">APPROVE</button></div>`).join("") || `<div class="hint">No candidates yet.</div>`}</div>${boundedPagerMarkup("candidates",`${list}:${id}:audio`,audioPage,"candidates")}</details>`;
  const filterCounts=Object.fromEntries(ENTITY_CANDIDATE_FILTERS.map((filter)=>[filter.id,filter.id === "all" ? activeCandidates.length : activeCandidates.filter((item)=>entityCandidateMatchesFilter(it,item.name,filter.id)).length]));
  const filterMarkup=`<nav class="entity-candidate-filters" aria-label="Candidate workflow filters">${ENTITY_CANDIDATE_FILTERS.map((filter)=>`<button type="button" class="${candidateFilter===filter.id?"selected":""}" onclick="setEntityCandidateFilter('${list}','${id}','${filter.id}')"><span>${esc(filter.label)}</span><b>${filterCounts[filter.id] || 0}</b></button>`).join("")}</nav>`;
  const batchPanelRaw=typeof entityBatchReviewPanelMarkup === "function" ? entityBatchReviewPanelMarkup(list,it,filteredCandidates,candidatePage.rows) : "";
  const visionReady=typeof capabilityState === "function" ? !!capabilityState("vision")?.ready : false;
  const batchPanel=batchPanelRaw && visionReady
    ? (manualFirstWorkflow()
      ? `<details class="manual-optional-batch-review"><summary>Optional batch AI check</summary><p>Review several visible files as supporting evidence. Human approval remains available without it.</p>${batchPanelRaw}</details>`
      : batchPanelRaw)
    : "";
  const candidatesTask = `<details class="fold compact-entity-section entity-candidate-section bounded-source-section" open><summary>Candidate files <span>${activeCandidates.length} to organize</span></summary><header><div><span>CHOOSE & APPROVE</span><b>${filteredCandidates.length} shown in ${esc(ENTITY_CANDIDATE_FILTERS.find((item)=>item.id===candidateFilter)?.label || "All")}</b><small>Choose the approved image directly by human judgment. Optional AI checks remain separate and never approve on their own.</small></div></header>${filterMarkup}${batchPanel}<div class="entity-media entity-candidate-grid">${candidatePage.rows.length ? candidatePage.rows.map((m,i)=>entityCandidateCard(list,it,m,i,candidateJson,false)).join("") : `<div class="entity-candidate-empty"><b>${activeCandidates.length ? "No candidates in this filter" : media.length ? "No undecided candidates" : "No candidates yet"}</b><span>${activeCandidates.length ? "Choose another workflow filter." : "Upload or map another file."}</span></div>`}</div>${boundedPagerMarkup("candidates",`${list}:${id}:active:${candidateFilter}`,candidatePage,"reference candidates")}${rejectedCandidates.length ? `<details class="entity-rejected-candidates"><summary>Rejected candidates <span>${rejectedCandidates.length}</span></summary><div class="entity-media entity-candidate-grid">${rejectedPage.rows.map((m,i)=>entityCandidateCard(list,it,m,i,rejectedJson,true)).join("")}</div>${boundedPagerMarkup("candidates",`${list}:${id}:rejected`,rejectedPage,"rejected candidates")}</details>` : ""}</details>`;
  const specs = list === "audio" ? [
    {id:"reference",label:"Audio",detail:"Candidates and the approved file",render:()=>approvedTask},
    {id:"details",label:"Details & history",detail:"Mix intent, media and records",render:()=>entityDetailsHistoryMarkup(list,it,extra)},
  ] : [
    {id:"reference",label:"Reference",detail:"Approved files and manual organization",render:()=>referenceWorkspaceMarkup(list,it)},
    {id:"review",label:manualFirstWorkflow()?"Choose & approve":"Review",detail:manualFirstWorkflow()?"Imported files and human decisions":"Candidates and approvals",render:()=>candidatesTask},
    {id:"coverage",label:"Coverage & states",detail:"Views, expressions and variants",render:()=>entityCoverageStatesMarkup(list,it,mediaByName,media)},
    {id:"details",label:"Details & history",detail:"Notes, media and records",render:()=>entityDetailsHistoryMarkup(list,it,extra)},
  ];
  const legacyMap={primary:"reference",approved:"reference",candidates:"review",coverage:"coverage",expressions:"coverage",states:"coverage",planning:"details",notes:"details",reconciliation:"details",records:"details",prompts:"details"};
  const context=`${list}:${id}`, allowed=specs.map((spec)=>spec.id);
  const defaultTask = typeof manualFirstWorkflow === "function" && manualFirstWorkflow() && allowed.includes("reference")
    ? "reference"
    : specs.find((spec)=>boundedEntityTaskStatus(list,it,spec.id,activeCandidates,states).tone === "attention")?.id || specs[0].id;
  let selectedId=boundedFocusedTask("entity-task",context,allowed,defaultTask);
  try {
    const stored=localStorage.getItem(`cinebraid-focused:${((typeof ACTIVE_PROJECT_SLUG !== "undefined" && ACTIVE_PROJECT_SLUG) || window.ACTIVE_PROJECT_SLUG || P.meta?.id || "project")}:entity-task:${context}`);
    if (legacyMap[stored] && allowed.includes(legacyMap[stored])) {
      selectedId=legacyMap[stored];
      if (["expressions","states"].includes(stored)) boundedWriteState("selected:entity-coverage-view",context,stored);
      if (["notes","planning","reconciliation"].includes(stored)) boundedWriteState("selected:entity-detail-view",context,"details");
      if (["records","prompts"].includes(stored)) boundedWriteState("selected:entity-detail-view",context,"history");
    }
  } catch {}
  const selected=specs.find((spec)=>spec.id===selectedId)||specs[0];
  const integrityWarnings=(P.meta?.dataIntegrityWarnings||[]).filter((warning)=>String(warning).includes(it.id)||String(warning).includes(list.slice(0,-1)));
  return `<div class="bounded-entity-page clarity-entity-page" data-bounded-entity="1" data-selected-task="${attr(selected.id)}"><div class="crumb"><a href="#/library/${list}">References</a> / ${esc(it.id)}</div>${integrityWarnings.length ? `<div class="data-integrity-warning"><b>Project data needs attention</b><small>${integrityWarnings.map((warning)=>esc(warning)).join(" · ")}</small></div>` : ""}<header class="entity-clarity-head"><div><input class="page-title-input" value="${attr(it.name)}" onchange="setVal('${list}','${id}','name',this.value)"><div class="entity-head-meta"><span class="canon-code">${esc(it.id)}</span><select class="workflow-select wf-${wf.cls}" onchange="setEntityWorkflow('${list}','${id}',this.value)">${WORKFLOW_STATES.filter((x)=>x!=="APPROVED"||wf.key==="APPROVED").map((st)=>`<option value="${st}" ${wf.key===st?"selected":""}>${st}</option>`).join("")}</select></div></div><div class="entity-head-actions"><button class="ghost-btn" onclick="document.getElementById('entity-file').click()">${manualFirstWorkflow()?"UPLOAD REFERENCES":"UPLOAD CANDIDATES"}</button></div></header><input type="file" id="entity-file" multiple accept="image/*,video/*" style="display:none">${entityAuthoritySummaryMarkup(list,it,states,mediaByName,selected.id)}${boundedEntityTaskbarMarkup(list,it,specs,selected.id,activeCandidates,states)}<div class="bounded-selected-task" data-bounded-task="${attr(selected.id)}">${selected.render()}</div><div class="submission-bar"><div><b>${esc(wf.label)}</b><span>${it.reviewNote ? esc(it.reviewNote) : it.submissionNote ? esc(it.submissionNote) : "Work remains editable until submitted for review."}</span></div>${wf.key === "READY FOR REVIEW" ? `<button class="changes-btn" onclick="requestEntityChanges('${list}','${id}')">Request changes</button>` : ""}${wf.key !== "APPROVED" ? `<button class="submit-btn" onclick="submitEntity('${list}','${id}')">SUBMIT FOR REVIEW</button>` : ""}</div></div>`;
}

/* ---------- the assembler: canon → prompt option ---------- */
function assembleText(id) {
  const s = shotById(id);
  const sc = sceneById(s.scene);
  /* build the reference set with roles: characters → anchors, LOC codes → environment, PROP codes → object */
  const refs = []; // { code, role }
  (s.characters || []).forEach((cid) => {
    const c = P.characters.find((x) => x.id === cid);
    if (!c) return;
    const code = c.anchors?.length
      ? c.anchors[0].split(" ")[0]
      : c.id + "-ANCHOR-01";
    refs.push({
      code,
      role:
        c.name +
        "'s appearance, wardrobe, and identity — reference for the character only, not the pose",
    });
  });
  (s.codes || []).forEach((code) => {
    if (refs.some((r) => r.code === code)) return;
    const role = code.startsWith("LOC")
      ? "the environment and background — match this location exactly"
      : code.startsWith("PROP")
        ? "this exact object — match its design, wear, and materials"
        : code.includes("HANDS")
          ? "hand reference — crop to the single relevant pose panel"
          : code.includes("EXPR")
            ? "expression reference — crop to the single relevant panel"
            : "reference asset";
    refs.push({ code, role });
  });
  const sm = shotStillModel(s);
  const syntax = sm?.refSyntax || null;
  const refLines = refs.map(
    (r, i) =>
      "Use " +
      refToken(i + 1, syntax) +
      " (" +
      r.code +
      ") for " +
      r.role +
      ".",
  );
  const parts = [];
  if (refLines.length) parts.push(refLines.join("\n"));
  if (s.desc) parts.push(s.desc.trim().replace(/\.?$/, "."));
  if (s.positioning) parts.push(s.positioning.trim().replace(/\.?$/, "."));
  const drift = (s.characters || [])
    .map((cid) => {
      const c = P.characters.find((x) => x.id === cid);
      return c?.driftNotes
        ? "CONTINUITY (" +
            c.name +
            "): " +
            c.driftNotes.trim().replace(/\.?$/, ".")
        : "";
    })
    .filter(Boolean);
  parts.push(...drift);
  const blocks = (P.meta.styleBlocks || []).filter(
    (b) => !b.stage || String(b.stage) === String(sc?.stage ?? ""),
  );
  parts.push(...blocks.map((b) => b.text.trim()));
  return {
    text: parts.join("\n\n"),
    refs: refs.map((r, i) => refToken(i + 1, syntax) + " = " + r.code),
    model: sm?.id || "",
    modelName: sm?.name || "default model",
  };
}
window.assemble = (id) => {
  const s = shotById(id),
    built = assembleText(id);
  s.promptOptions = s.promptOptions || [];
  s.promptOptions.forEach((o) => (o.favorite = false));
  s.promptOptions.push({
    id: "prompt-" + (s.promptOptions.length + 1),
    text: built.text,
    refs: built.refs,
    favorite: true,
    model: built.model,
    origin: "canon-assembly",
    date: new Date().toISOString(),
  });
  if (workflowState(s).key === "DRAFT") {
    s.workflowStatus = "IN PROGRESS";
    s.status = "BUILT";
  }
  dirty();
  route();
  toast("Current prompt rebuilt from approved canon");
};
window.draftVariants = async (id) => {
  const s = shotById(id);
  const sc = sceneById(s.scene);
  const built = assembleText(id);
  openModal(
    `<h3>Drafting 3 variants — local model</h3><div class="modal-sub"><span class="spin">◌</span> RUNNING ON THE SPARK · SUGGEST-ONLY · NOTHING IS WRITTEN UNTIL YOU ADD IT</div>`,
  );
  try {
    const r = await fetch("/api/llm/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: s.title,
        beat: sc?.whatHappens || "",
        base: built.text,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    window._drafts = {
      id,
      variants: d.variants,
      refs: built.refs,
      model: built.model,
    };
    openModal(`<h3>3 drafts — ${esc(s.id)}</h3>
      <div class="modal-sub">SUGGESTIONS ONLY · LOCKED BLOCKS SHOULD BE UNTOUCHED — VERIFY BEFORE USING</div>
      ${d.variants
        .map(
          (v, i) => `<div class="block-row"><div class="block-row-head">
        <span class="opt-id">${["TIGHTER", "ATMOSPHERE", "ALT COVERAGE"][i] || "VARIANT " + (i + 1)}</span>
        <button class="copy-btn" style="margin-left:auto" onclick="copyText(window._drafts.variants[${i}])">COPY</button>
        <button class="add-btn" onclick="acceptDraft(${i})">USE AS CURRENT</button></div>
        <div class="opt-refs" style="white-space:pre-wrap;max-height:150px;overflow:auto">${esc(v)}</div></div>`,
        )
        .join("")}
      <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
  } catch (e) {
    openModal(`<h3>Draft failed</h3><div class="import-review" style="color:var(--red)">${esc(e.message)}</div>
      <div class="hint">Is Ollama running on the Spark and reachable at the URL in Settings?</div>
      <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
  }
};
window.acceptDraft = (i) => {
  const { id, variants, refs, model } = window._drafts;
  const s = shotById(id);
  s.promptOptions = s.promptOptions || [];
  s.promptOptions.forEach((o) => (o.favorite = false));
  s.promptOptions.push({
    id: "prompt-" + (s.promptOptions.length + 1),
    text: variants[i],
    refs,
    favorite: true,
    model,
    origin: "local-draft",
    date: new Date().toISOString(),
  });
  if (workflowState(s).key === "DRAFT") {
    s.workflowStatus = "IN PROGRESS";
    s.status = "BUILT";
  }
  dirty();
  route();
  toast("Alternative set as the current working prompt");
};

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
/* EXACT OWNERSHIP, NOT PREFIX OVERLAP.

   Dogfood #2 A4 / forensic F4. This was `mediaByPrefix(SCAN[dir], entity.prefix
   || entity.anchorPrefix || entity.id)`, a `startsWith` test — so every
   `CHAR-SWEEP-YOUNG…` file matched `CHAR-SWEEP` and all three of Young Sweep's
   candidates appeared in the adult Chimbley Sweep's review pool. The Widow stayed
   clean because nothing overlaps her id, which is what proved it was string
   collision rather than parent/child expansion.

   public/shared-entity-ownership.js owns the rule: an uncontested durable claim
   decides it, and only an UNCLAIMED file falls back to the most specific declared
   prefix. This is the single reader every entity surface goes through — display,
   review pool, approval, coverage automation — so none of them can disagree.

   The index is rebuilt per call rather than cached: entityMedia() runs inside
   renders that follow a mutation, and a stale ownership index would be a worse
   defect than the one it replaces. */
function entityOwnerIndex(list) {
  return buildEntityOwnerIndex(P, list);
}
function entityMediaPool(list) {
  return Array.isArray(SCAN[ENTITY_MEDIA[list]]) ? SCAN[ENTITY_MEDIA[list]] : [];
}
/* BATCH 1B: THIS READER IS THE APPROVAL-CAPABLE POOL, and nothing else.

   The acceptance audit approved an unclaimed `SWEEP_CHILD_UNCLAIMED.png` into an
   entity's canon pool because the most-specific prefix guessed an owner and the
   guess was returned through this function — the same function review, approval,
   coverage automation and the server batch reviewer all consume. A guess became
   canon eligibility because one reader answered two different questions.

   It answers one now: WHICH FILES MAY BECOME CANON FOR THIS ENTITY. A file
   qualifies only through a unique durable claim. */
function entityMedia(list, it) {
  return filterEntityMedia(entityOwnerIndex(list), it?.id, entityMediaPool(list));
}
/* The other question, kept separate on purpose. Files whose NAME matches this
   entity's declared prefix but which nothing durable claims: a reference dropped
   into the folder by hand, or a row left behind by the pre-repair prefix leak.
   Visible so a creator can find them, quarantined so they cannot be approved,
   and claimable in one act. */
function entityUnassignedMedia(list, it) {
  return unassignedEntityMedia(entityOwnerIndex(list), it?.id, entityMediaPool(list));
}
/* Files two references both durably claim. No owner, no eligibility, and a
   blocking conflict the entity page states rather than settles. */
function entityContestedMedia(list, it) {
  return contestedEntityMedia(entityOwnerIndex(list), it?.id, entityMediaPool(list));
}
/* THE CLAIM ACT. A person says these bytes belong to this reference, and the
   candidate row that records it is the same durable claim generation and upload
   already write — so a claimed file needs no special case anywhere downstream. */
window.claimEntityMedia = (list, id, fileName) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return toast("Reference is unavailable");
  const decision = planEntityMediaClaim(entityOwnerIndex(list), id, fileName);
  if (!decision.claim) {
    return toast(decision.reason === "contested"
      ? `${fileName} is claimed by more than one reference. Resolve that conflict before claiming it here.`
      : decision.reason === "claimed-by-another"
        ? `${fileName} already belongs to ${decision.resolution.ownerId}.`
        : decision.reason === "already-claimed"
          ? `${fileName} already belongs to this reference.`
          : "That file cannot be claimed.");
  }
  const row = entityCandidateRow(entity, fileName, true);
  row.ownershipClaim = { actor: "human", via: "entity-unassigned-media", at: new Date().toISOString() };
  if (entityWorkflowState(entity).key === "DRAFT") { entity.workflowStatus = "IN PROGRESS"; entity.status = "IN PROGRESS"; }
  dirty();
  route();
  toast(`${fileName} is now a candidate for ${entity.name || id}`);
};
function entityCandidateRow(entity, fileName, create = false) {
  entity.candidateFiles = Array.isArray(entity.candidateFiles) ? entity.candidateFiles : [];
  let row = entity.candidateFiles.find((item) => (item.stored || item.name) === fileName);
  if (!row && create) {
    row = { stored: fileName, original: fileName, addedAt: new Date().toISOString(), decision: "unreviewed" };
    entity.candidateFiles.push(row);
  }
  return row || null;
}
const ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION = "reference-authority-v3";
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
  /* One vocabulary, from shared-entity-slots.js. This pair of literals is why a
     candidate the creator had just selected went on being badged NOT ASSIGNED. */
  const assignment = review.pass && row.targetCoverageSlotId && !decisionIsSlotSelection(row.decision) ? " · NOT ASSIGNED" : "";
  return `<span class="entity-ai-review-badge ${tone}">AI ${Math.round(+review.score || 0)} · ${review.pass ? "PASS" : "FLAG"}${assignment} · ${esc(review.stateName || "Default")}</span>`;
}

/* MB-PT-02 — THE ONE ENTITY-SIDE READER OF PRODUCTION TRUTH.
 *
 * The entity page used to answer "is this approved?" itself, three times, from
 * `state.approvedFile || (state.isDefault && entity.approvedFile)`. A prop with
 * a raw pointer and no receipt therefore headlined APPROVED IMAGES, counted
 * "1/1 state has an approved image", and rendered an APPROVED row — while the
 * projection classified the same pointer as Historic. Two truths, one screen.
 *
 * There is one reader now and it is the projection. A pointer with no receipt
 * is HISTORIC: still shown, still named, still one click from being approved,
 * and never counted or badged as canon. */
function entityStateTruth(list, entity) {
  const truth = typeof entityProductionTruth === "function"
    ? entityProductionTruth(P, list, entity && entity.id)
    : { canon: [], references: [], historic: [] };
  const canon = new Map(truth.canon.map((row) => [row.stateId, row]));
  const historic = new Map(truth.historic.map((row) => [row.stateId, row]));
  return {
    canonCount: canon.size,
    historicCount: historic.size,
    of(state) {
      const id = (state && state.id) || "";
      if (canon.has(id)) return { standing: "canon", file: canon.get(id).value };
      if (historic.has(id)) return { standing: "historic", file: historic.get(id).value };
      return { standing: "missing", file: "" };
    },
  };
}
/* MB-PT-04, the entity-side twin. Same fallback, same defect: a state whose
   recorded parent is missing was OPERATIONALLY REPARENTED onto the default for
   every read this summary feeds. An existing state has the parent it records or
   it has none, and "none" is what the surface must say. */
function entityStateParentSummary(entity, state) {
  if (!entity || !state || state.isDefault) return { parent: null, fileName: "", label: "Primary identity" };
  const parentId = String(state.parentStateId || "");
  const parent = parentId
    ? entityStateListRead(entity, true).find((item) => item.id === parentId && item.id !== state.id) || null
    : null;
  if (!parent) {
    return {
      parent: null,
      fileName: "",
      label: parentId ? `Missing state ${parentId}` : "No declared parent",
      broken: !!parentId,
    };
  }
  const fileName = parent.approvedFile || (parent.isDefault ? entity.approvedFile || "" : "");
  return { parent, fileName, label: parent.name || "Default" };
}
window.openContinuityStateVariant = async (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  if (!entity || !state || state.isDefault) return toast("Choose a non-default continuity state");
  const parentInfo = entityStateParentSummary(entity, state);
  /* OPENING THE VARIANT EDITOR WRITES NOTHING AT ALL.
   *
   * Batch 1C stopped it establishing a PARENT and left it establishing a
   * generation MODE: `state.generationMode = "derive"` on the way past. That is
   * still a production write performed by navigation — a creator who had
   * deliberately marked a state independent found it silently switched back by
   * looking at it, and a cancelled inspection left the project dirty.
   *
   * Nothing here mutates. The mode a state generates in is decided at the
   * generation action, which is where the creator actually asks for one. */
  /* Cancelling or navigating away drops any generation choice the creator was
     comparing. Nothing was written, so there is nothing to undo — this only
     stops a stale draft from being honoured by a later render. */
  if (typeof discardPendingStateGeneration === "function") discardPendingStateGeneration(entity, state);
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
  const states = entityStateListRead(entity, true).filter((state) => !state.isDefault);
  const hubTruth = entityStateTruth(list, entity);
  if (!states.length) {
    window.boundedWriteState?.("selected:entity-coverage-view", `${list}:${id}`, "states");
    window.selectBoundedTask?.("entity-task", `${list}:${id}`, "coverage");
    return toast("Add a continuity state first, then describe what changes from the primary appearance");
  }
  openModal(`<div class="state-variant-hub-modal"><header><div><span>CONTINUITY-STATE VARIANTS</span><h3>Generate another version of ${esc(entity.name || entity.id)}</h3><p>Choose the costume, damage, lighting, age or condition variant to derive from an approved parent reference.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="state-variant-hub-list">${states.map((state) => { const parentInfo = entityStateParentSummary(entity, state);
      /* TRUTH, PRESENTATION AND READINESS FROM ONE STANDING. `state.approvedFile`
         said APPROVED VARIANT and `parentInfo.fileName` said READY TO DERIVE —
         two raw pointers deciding two authority-bearing labels on one card. */
      const standing = hubTruth.of(state).standing;
      const parentStanding = parentInfo.parent ? hubTruth.of(parentInfo.parent).standing : "missing";
      const ready = parentStanding === "canon";
      const tone = standing === "canon" ? "complete" : ready ? "ready" : "attention";
      const label = standing === "canon" ? "CANON VARIANT"
        : standing === "historic" ? "HISTORIC · NOT APPROVED"
          : ready ? "READY TO DERIVE"
            : parentStanding === "historic" ? "PARENT NOT APPROVED" : "PARENT MISSING";
      return `<article class="${tone}"><div><span>${label}</span><b>${esc(state.name || "State")}</b><small>${esc(state.appliesTo || "No scene or shot range assigned")}</small></div><div class="state-variant-relationship"><span>Parent</span><b>${esc(parentInfo.label)}</b><small>${ready ? esc(parentInfo.fileName) : parentStanding === "historic" ? `${esc(parentInfo.fileName)} — not approved as canon` : "Approve the parent state first"}</small></div><div class="state-variant-delta"><span>Change only</span><p>${esc(state.notes || "Describe the exact state change before generation.")}</p></div><button class="${standing === "canon" ? "ghost-btn" : "approve-btn"}" onclick="openContinuityStateVariant('${attr(list)}','${attr(id)}','${attr(state.id)}')">${standing === "canon" ? "EDIT / REGENERATE" : "OPEN STATE WORKFLOW"}</button></article>`; }).join("")}</div></div>`);
};
window.openStateReferenceUpload = (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  if (!entity || !state) return;
  window._pendingEntityStateUpload = { list, id, stateId };
  document.getElementById("entity-file")?.click?.();
};
/* `disposition` is the row public/shared-media-disposition.js resolved for this
   media. It is optional so the existing rejected/active callers are unchanged,
   and it is what lets an APPROVED authority appear on a selector at all — before
   P4-SEM-C2 this function was never called with one, because approved media was
   filtered out before it got here. */
function entityCandidateCard(list, entity, media, index, mediaJson, rejected = false, disposition = null) {
  const row = entityCandidateRow(entity, media.name, false) || {};
  /* 1D-04 — TWO QUESTIONS, AND THEY HAD BEEN ONE.
     WHAT IS THIS IMAGE USED FOR is answered by the edges, always, and a creator
     choosing between images needs it whether or not anyone has approved
     anything. DID A PERSON APPROVE IT is answered only by the receipt, through
     the same predicate Results and the Inspector use, so this card cannot
     disagree with them. */
  const usedFor = disposition?.role === "approved"
    ? (disposition.targets || []).map((target) => target.label || target.kind).filter(Boolean).join(" · ")
    : "";
  const approved = !!usedFor
    && edgesAreReceiptBacked(P, disposition.targets, { list, entityId: entity && entity.id });
  const authorityFor = usedFor;
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
  const storedReview = targetReview || (typeof entityLatestCandidateReviewRaw === "function" ? entityLatestCandidateReviewRaw(entity, media.name) : null);
  const aiAction = visionReady || targetReview
    ? `<button class="ghost-btn optional-ai-action" onclick="openEntityCandidateReview('${list}','${entity.id}','${attr(media.name)}','${attr(targetStateId)}')">${targetReview ? "AI CHECK DETAILS" : "OPTIONAL AI CHECK"}</button>`
    : "";
  /* Rejection is a decision about the image, not a decision to forget why it was
     flagged. The review was always still on disk; the card simply stopped
     offering a way in, so the only route to it was to un-reject the candidate. */
  const rejectedReviewAction = storedReview
    ? `<button class="ghost-btn optional-ai-action rejected-review-action" onclick="openEntityCandidateReview('${list}','${entity.id}','${attr(media.name)}','${attr(targetStateId)}')">VIEW REVIEW · ${Math.round(Number(storedReview.score || 0))} ${storedReview.pass ? "PASS" : "FLAG"}</button>`
    : "";
  const generationJob = (FAL_GENERATION_JOBS || []).find((job) => job.id === row.generationJobId) || null;
  const parentName = generationJob?.parentStateName || "";
  const sourceDescription = row.generationProvider
    ? `${esc(String(row.generationProvider).toUpperCase())} candidate${targetName ? ` for continuity state ${esc(targetName)}` : coverageName ? ` for ${esc(coverageName)}` : isSheet ? " · multi-view source" : ""}${parentName ? ` · derived from approved ${esc(parentName)}` : ""}`
    : "Imported candidate";
  const reviewDescription = targetReview
    ? `${targetReview.pass ? "AI check passed" : "AI check flagged issues"} · human approval remains explicit`
    : "Choose, assign, or approve by human judgment; AI checking is optional";
  return `<article class="entity-candidate-card ${rejected ? "is-rejected" : ""} ${approved ? "is-approved-authority" : ""} ${isSheet ? "is-coverage-sheet" : ""}" data-candidate-file="${attr(media.name)}" data-candidate-type="${attr(workflowType)}" data-media-role="${attr(disposition?.role || (rejected ? "rejected" : "candidate"))}"${authorityFor ? ` data-approved-for="${attr(authorityFor)}"` : ""}${disposition?.assetId ? ` data-asset-id="${attr(disposition.assetId)}"` : ""}><a class="entity-candidate-preview" href="javascript:void 0" onclick="openLBMedia('${mediaJson}',${index},'${attr(entity.id)}')" title="${attr(media.name)}">${isVideo(media.name) ? `<video muted src="${attr(media.url)}"></video>` : `<img src="${attr(media.url)}" alt="">`}${entityCandidateReviewOverlay(entity, media.name)}${targetName ? `<span class="entity-candidate-target">CONTINUITY · ${esc(targetName.toUpperCase())}</span>${parentName ? `<span class="entity-candidate-parent">FROM · ${esc(parentName.toUpperCase())}</span>` : ""}` : coverageName ? `<span class="entity-candidate-target">COVERAGE · ${esc(coverageName.toUpperCase())}</span>` : isSheet ? `<span class="entity-candidate-target">COVERAGE SHEET</span>` : ""}<span class="entity-tile-name">${esc(media.name)}</span></a><div class="entity-candidate-meta"><span class="entity-candidate-workflow-type">${esc(entityCandidateWorkflowLabel(entity, media.name))}</span>${entityCandidateReviewBadge(entity, media.name)}${batchStatus}<small>${approved ? `Approved by you${authorityFor ? ` · authority for ${esc(authorityFor)}` : ""}${storedReview ? ` · AI ${Math.round(Number(storedReview.score || 0))} ${storedReview.pass ? "PASS" : "FLAG"} recorded` : " · approved without an AI review on record"}` : rejected ? `Rejected by you · kept on disk${storedReview ? ` · AI ${Math.round(Number(storedReview.score || 0))} ${storedReview.pass ? "PASS" : "FLAG"} recorded before the rejection` : " · no AI review was recorded"}` : `${sourceDescription} · ${reviewDescription}`}</small></div><div class="entity-candidate-actions">${approved ? `${aiAction}` : rejected ? `${rejectedReviewAction}<button class="chip" onclick="setEntityCandidateDecision('${list}','${entity.id}','${attr(media.name)}','unreviewed')">RESTORE</button>` : `<button class="approve-tile-btn human-approval-action" onclick="requestHumanEntityCandidateApproval('${list}','${entity.id}','${attr(media.name)}','${attr(targetStateId)}','${continuation}')">${humanLabel}</button>${aiAction}<button class="chip danger" onclick="setEntityCandidateDecision('${list}','${entity.id}','${attr(media.name)}','rejected')">REJECT</button>`}</div></article>`;
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
  /* "Derived from approved X" from a pointer was the copy half of the same
     defect. The word waits on the receipt; the image is still named. */
  const parentStanding = parent?.parent ? entityStateTruth(entityListOf(entity), entity).of(parent.parent) : { standing: "missing" };
  const source = state.isDefault
    ? "Main canon image"
    : parentStanding.standing === "canon"
      ? `Derived from approved ${parent.label}`
      : parent?.fileName
        ? `Generated independently — ${parent.label} has not been approved as canon`
        : "Generated independently — no approved parent";
  return `<section class="continuity-candidate-tray"><header><div><span>GENERATED FOR THIS STATE</span><b>${esc(heading)}</b><small>${esc(source)} · review and approve here without leaving the Continuity tab.</small></div><strong>${rows.length}</strong></header>${rows.length ? `<div class="entity-media entity-candidate-grid continuity-candidate-grid">${rows.map((item,index)=>entityCandidateCard(list,entity,item,index,mediaJson,false)).join("")}</div>` : `<div class="entity-candidate-empty"><b>No unapproved candidates for ${esc(state.name || "this state")}</b><span>Generate or upload a state reference and it will appear here automatically.</span></div>`}</section>`;
}


function continuityStateValidationCurrent(entity, state) {
  if (!entity || !state || state.isDefault) return null;
  const validation = state.parentValidation || null;
  if (!validation) return null;
  const parentInfo = entityStateParentSummary(entity, state);
  /* A stored validation describes an APPROVED pair. It stays current only
     while both sides are still canon and still the same bytes — a pointer
     that lost its receipt invalidates the finding it produced. */
  const truth = entityStateTruth(entityListOf(entity), entity);
  const targetStanding = truth.of(state);
  const parentStanding = parentInfo.parent ? truth.of(parentInfo.parent) : { standing: "missing", file: "" };
  if (targetStanding.standing !== "canon" || parentStanding.standing !== "canon") return null;
  const targetFile = targetStanding.file;
  const parentFile = parentStanding.file;
  const delta = String(state.notes || "").trim();
  return validation.targetFile === targetFile && validation.parentFile === parentFile && validation.stateDelta === delta ? validation : null;
}
/* THE WAY OUT OF THE LINEAGE DEAD END.
 *
 * An imported state that describes a delta and records no source is a state
 * CineBraid can neither generate nor validate — "Heavy soot has no valid parent
 * state" — and until now there was no surface that could give it one, because
 * every ancestry write was create or delete. This is the human decision
 * shared-state-lineage.js's 1D-06 note says must be SURFACED rather than guessed.
 *
 * It offers, it never picks. No default is preselected, the sources are the
 * module's own eligible list (self and descendants excluded), and recording a
 * source approves nothing — the derived variant remains a candidate exactly as
 * before. A state that already records a source never reaches here. */
function continuityStateDerivationMarkup(list, entity, state) {
  if (!state || state.isDefault || String(state.parentStateId || "")) return "";
  if (typeof eligibleDerivationSourceIds !== "function") return "";
  const states = entityStateListRead(entity, true);
  const ids = eligibleDerivationSourceIds(states, state.id);
  const byId = new Map(states.map((row) => [row.id, row]));
  const truth = entityStateTruth(list, entity);
  const options = ids.map((id) => {
    const row = byId.get(id);
    const standing = truth.of(row);
    const note = standing.standing === "canon" ? "approved" : standing.standing === "historic" ? "not approved" : "no image";
    return `<option value="${attr(id)}">${esc(row?.name || id)} — ${esc(note)}</option>`;
  }).join("");
  const selectId = `derivation-source-${attr(list)}-${attr(entity.id)}-${attr(state.id)}`;
  const body = options
    ? `<label>Derives from<select id="${selectId}"><option value="">Choose the state this one comes from…</option>${options}</select></label><button class="add-btn" onclick="recordContinuityStateDerivation('${attr(list)}','${attr(entity.id)}','${attr(state.id)}',document.getElementById('${selectId}').value)">RECORD SOURCE STATE</button>`
    : `<p>There is no other state this one could derive from yet.</p>`;
  return `<section class="state-derivation-missing" data-derivation-unrecorded="${attr(state.id)}"><header><div><span>SOURCE STATE NOT RECORDED</span><b>${esc(state.name || "This state")} does not record what it derives from</b><small>CineBraid will not guess. Generation and parent-to-state validation stay blocked until you say which approved state this one comes from. Recording it approves nothing.</small></div></header>${body}</section>`;
}
window.recordContinuityStateDerivation = (list, entityId, stateId, sourceStateId) => {
  const entity = P[list]?.find((item) => item.id === entityId);
  const states = entity && entityStateListRead(entity, true);
  if (!states) return toast("That reference no longer exists");
  if (!String(sourceStateId || "")) return toast("Choose the state this one derives from");
  const outcome = applyDerivationRecord(entity.continuityStates, stateId, sourceStateId, { dirty });
  if (!outcome.applied) {
    return toast(outcome.reason === "reparenting-unsupported"
      ? reparentingUnsupported().detail
      : outcome.reason === "source-is-descendant"
        ? "That state derives from this one. Choosing it would make the chain point at itself."
        : outcome.reason === "parent-missing"
          ? "That state no longer exists. Choose one that does."
          : outcome.reason === "collection-invalid"
            ? "This reference's continuity states need repair before a source can be recorded."
            : "The source state could not be recorded.");
  }
  route();
  const source = states.find((row) => row.id === sourceStateId);
  toast(`Recorded: this state derives from ${source?.name || sourceStateId}. Nothing was approved.`);
};
function continuityStateValidationMarkup(list, entity, state, media = []) {
  if (!state || state.isDefault) return "";
  /* Before anything else the card can say about validation: with no recorded
     source there is nothing to validate against, and the chooser is the action. */
  const unrecorded = continuityStateDerivationMarkup(list, entity, state);
  if (unrecorded) return unrecorded;
  const parentInfo = entityStateParentSummary(entity, state);
  /* VALIDATION ASSERTS APPROVAL ON BOTH SIDES, so readiness is canon on both
     sides. `!!(targetMedia && parentMedia)` made two historic pointers look
     ready, offered the button, and framed the pair as approved. */
  const truth = entityStateTruth(list, entity);
  const targetStanding = truth.of(state);
  const parentStanding = parentInfo.parent ? truth.of(parentInfo.parent) : { standing: "missing", file: "" };
  const targetIsCanon = targetStanding.standing === "canon";
  const parentIsCanon = parentStanding.standing === "canon";
  const targetMedia = media.find((item) => item.name === targetStanding.file) || null;
  const parentMedia = media.find((item) => item.name === parentStanding.file) || null;
  const validation = continuityStateValidationCurrent(entity, state);
  const capability = typeof capabilityState === "function" ? capabilityState("vision") : { ready: false, message: "Vision assistant unavailable" };
  const ready = !!(targetIsCanon && parentIsCanon && targetMedia && parentMedia && String(state.notes || "").trim());
  /* What is missing, in the creator’s words, so the disabled button is not a
     dead end. Historic media is named — it is real work, one click from canon. */
  const blockedReason = targetIsCanon && parentIsCanon ? ""
    : !parentInfo.parent ? "This state does not record a parent to validate against."
      : parentStanding.standing === "historic" && targetStanding.standing === "historic"
        ? `Neither ${esc(parentInfo.label)} nor this state has been approved as canon. Approve both, then validate them against each other.`
        : parentStanding.standing === "historic"
          ? `${esc(parentInfo.label)} shows ${esc(parentStanding.file)}, which has never been approved as canon. Approve it first.`
          : targetStanding.standing === "historic"
            ? `This state shows ${esc(targetStanding.file)}, which has never been approved as canon. Approve it first.`
            : "Approve both the parent and this state as canon, then describe the exact visual delta.";
  const thumbs = targetMedia && parentMedia ? `<div class="state-validation-thumbs"><button type="button" onclick="openMediaTheatre('${attr(encodeURIComponent(parentMedia.url))}','${attr(encodeURIComponent(`${parentInfo.label} ${parentIsCanon ? "canon" : "historic"} parent image · ${parentStanding.file}`))}','image')"><img src="${attr(parentMedia.url)}" alt="${parentIsCanon ? `Approved parent image for ${attr(parentInfo.label)}` : `Historic parent image for ${attr(parentInfo.label)}, not approved`}"><span>${esc(parentInfo.label)} · parent</span></button><i>→</i><button type="button" onclick="openMediaTheatre('${attr(encodeURIComponent(targetMedia.url))}','${attr(encodeURIComponent(`${state.name || "State"} ${targetIsCanon ? "canon" : "historic"} image · ${targetStanding.file}`))}','image')"><img src="${attr(targetMedia.url)}" alt="${targetIsCanon ? `Approved image for ${attr(state.name || "this state")}` : `Historic image for ${attr(state.name || "this state")}, not approved`}"><span>${esc(state.name || "State")} · target</span></button></div>` : "";
  if (validation?.status === "working") return `<section class="state-parent-validation state-working"><header><div><span>PARENT-TO-STATE VALIDATION</span><b>Checking ${esc(state.name || "state")} against ${esc(parentInfo.label)}</b><small>The vision assistant is separating the intended delta from identity, geometry, material and lighting drift.</small></div><i class="spin">◌</i></header>${thumbs}</section>`;
  if (!validation) return `<section class="state-parent-validation state-pending"><header><div><span>PARENT-TO-STATE VALIDATION</span><b>${ready ? "Validate the approved state against its parent" : "Approve both sides before validating"}</b><small>${ready ? "The parent is canon. The state description is the allowed delta. Everything else stays locked." : "Validation compares one approved image against another, so both have to be canon before it can say anything."}</small></div><button class="approve-btn" onclick="validateContinuityStateAgainstParent('${attr(list)}','${attr(entity.id)}','${attr(state.id)}')" ${ready && capability.ready ? "" : "disabled"}>VALIDATE AGAINST PARENT</button></header>${thumbs}${!ready ? `<p class="prompt-check warn">${blockedReason || "Approve both the parent and target state, then describe the exact visual delta."}</p>` : !capability.ready ? `<p class="prompt-check warn">${esc(capability.message || "Connect a vision assistant to validate this state.")}</p>` : ""}</section>`;
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
  /* VALIDATION ASSERTS APPROVAL ON BOTH SIDES, so both sides must actually be
     approved. This checked pointer presence and then submitted the pair to the
     reviewer as the approved target and its approved parent. */
  const stateTruth = entityStateTruth(list, entity);
  const targetStanding = stateTruth.of(state);
  const parentStanding = parentInfo.parent ? stateTruth.of(parentInfo.parent) : { standing: "missing", file: "" };
  if (targetStanding.standing !== "canon" || parentStanding.standing !== "canon") {
    return toast(targetStanding.standing === "historic" || parentStanding.standing === "historic"
      ? "Approve both the parent and this state as canon before validating them against each other"
      : "Approve both the parent and target state first");
  }
  if (!String(state.notes || "").trim()) return toast("Describe the allowed state delta first");
  const capability = capabilityState("vision");
  if (!capability.ready) return toast(capability.message || "Vision assistant is unavailable");
  state.parentValidation = { status: "working", targetFile: targetStanding.file, parentFile: parentStanding.file, stateDelta: String(state.notes || "").trim(), reviewedAt: new Date().toISOString() };
  dirty(); route();
  try {
    if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
    const response = await fetch("/api/llm/review-entity-candidate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list, id, fileName: state.approvedFile, stateId: state.id }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "State validation failed");
    state.parentValidation = { status: "complete", review: data.review, targetFile: targetStanding.file, parentFile: parentStanding.file, stateDelta: String(state.notes || "").trim(), reviewedAt: new Date().toISOString(), inputLabels: data.inputLabels || [], authoritySignature: data.authoritySignature || data.review?.authoritySignature || "" };
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
  if (!entity || !state || state.isDefault) return toast("Choose a derived continuity state");
  /* CORRECTION SWITCHES THE STATE INTO DERIVE, which is a derivation decision
     and needs the same canon the generation path needs. It read
     `parentInfo.fileName` — pointer presence — and set `generationMode` from a
     parent nobody had approved. */
  const correctionParent = parentInfo.parent ? entityStateTruth(list, entity).of(parentInfo.parent) : { standing: "missing", file: "" };
  if (correctionParent.standing !== "canon") {
    return toast(correctionParent.standing === "historic"
      ? `${correctionParent.file} is on ${parentInfo.label} but has never been approved as canon. Approve it before correcting from it.`
      : "Approve the parent state first");
  }
  state.generationMode = "derive";
  /* BATCH 1C: correcting from the parent READS the parent; it does not declare
     one. The correction runs against whatever derivation the state really has. */
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
  const states = entityStateListRead(it, true);
  const ids = states.map((state) => state.id);
  const activePromptState = states.find((state) => typeof guidedPromptOp === "function" && guidedPromptOp("asset-state", `${list}:${it.id}`, state.id)?.status === "busy");
  const fallback = activePromptState?.id || states.find((state) => !state.approvedFile && !state.isDefault)?.id || ids[0] || "";
  const selectedId = boundedSelected("continuity-state", `${list}:${it.id}`, ids, fallback);
  const selectedIndex = Math.max(0, states.findIndex((state) => state.id === selectedId));
  const st = states[selectedIndex] || states[0];
  const parentInfo = st ? entityStateParentSummary(it, st) : null;
  const stateTruth = entityStateTruth(list, it);
  const selectedStanding = st ? stateTruth.of(st) : { standing: "missing", file: "" };
  const selectedApprovedFile = selectedStanding.file;
  const selectedIsCanon = selectedStanding.standing === "canon";
  /* The PARENT’s standing, for every claim this card makes about derivation. */
  const selectedParentIsCanon = !!(parentInfo?.parent && stateTruth.of(parentInfo.parent).standing === "canon");
  const selectedApprovedMedia = selectedApprovedFile ? (media || []).find((item) => item.name === selectedApprovedFile) : null;
  const selectedApprovedHero = st ? `<section class="state-approved-hero ${selectedApprovedMedia ? (selectedIsCanon ? "is-approved" : "is-historic") : "is-missing"}"><div class="state-approved-hero-copy"><span>${!selectedApprovedMedia ? "CANON IMAGE REQUIRED" : selectedIsCanon ? "CANON IMAGE" : "HISTORIC IMAGE · NOT APPROVED"}</span><b>${esc(st.name || "State")}</b><small>${!selectedApprovedFile ? "No image has been approved for this state." : selectedIsCanon ? esc(selectedApprovedFile) : `${esc(selectedApprovedFile)} — previously selected, never approved. Approve it to make it canon.`}</small>${!st.isDefault && parentInfo?.parent ? `<em>${selectedParentIsCanon ? `Derived from ${esc(parentInfo.label)}` : `${esc(parentInfo.label)} is not approved as canon — this state cannot derive from it yet`}</em>` : ""}</div>${selectedApprovedMedia ? `<button type="button" class="state-approved-preview" onclick="openMediaTheatre('${attr(encodeURIComponent(selectedApprovedMedia.url))}','${attr(encodeURIComponent(`${st.name || "State"} ${selectedIsCanon ? "canon" : "historic"} image · ${selectedApprovedFile}`))}','${isVideo(selectedApprovedMedia.name) ? "video" : "image"}')">${isVideo(selectedApprovedMedia.name) ? `<video muted src="${attr(selectedApprovedMedia.url)}"></video>` : `<img src="${attr(selectedApprovedMedia.url)}" alt="${selectedIsCanon ? `Approved canon image for ${attr(st.name || "state")}` : `Historic image for ${attr(st.name || "state")}, not approved`}">`}<span>VIEW LARGE</span></button>` : `<button type="button" class="approve-btn" onclick="approveEntityFile('${attr(list)}','${attr(it.id)}','','${attr(st.id)}')">CHOOSE APPROVED IMAGE</button>`}</section>` : "";
  const sectionKey = `entity:${list}:${it.id}:continuity-states`;
  const rail = `<nav class="continuity-state-rail" aria-label="Continuity states">${states.map((state, index) => {
    const standing = stateTruth.of(state).standing;
    const requirement = referenceRequirement(state, state.isDefault);
    const tone = standing === "canon" ? "complete" : standing === "historic" ? "pending" : requirement === "required" ? "attention" : requirement === "planned" ? "pending" : "optional";
    const status = standing === "canon" ? (state.isDefault ? "Main canon image" : "Canon") : standing === "historic" ? "Historic · not approved" : referenceRequirementLabel(state);
    return `<button type="button" class="tone-${tone} ${state.id===selectedId?"selected":""}" onclick="selectBoundedItem('continuity-state','${attr(list+":"+it.id)}','${attr(state.id)}')"><i></i><span><b>${esc(state.name || `State ${index+1}`)}</b><small>${status}</small></span></button>`;
  }).join("")}</nav>`;
  const editor = st ? `<article class="continuity-state-card continuity-state-card-focused ${st.isDefault ? "is-default" : ""}" data-continuity-state-id="${attr(st.id)}"><div class="continuity-state-head"><span>${selectedIndex + 1}</span><input value="${attr(st.name || "")}" placeholder="Clean suit / Damaged sleeve / Night lighting" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'name',this.value)" ${st.isDefault ? 'data-default="1"' : ''}><div class="continuity-state-head-actions">${st.isDefault ? `<button class="chip" onclick="approveEntityFile('${list}','${it.id}','${attr(st.approvedFile || '')}','${attr(st.id)}')">CHOOSE AUTHORITY</button>` : `<button class="chip" onclick="openContinuityStateVariant('${attr(list)}','${attr(it.id)}','${attr(st.id)}')">${selectedIsCanon ? "EDIT / REGENERATE" : selectedParentIsCanon ? `GENERATE FROM ${esc(parentInfo.label.toUpperCase())}` : "OPEN STATE WORKFLOW"}</button><button class="ghost-btn" onclick="openStateReferenceUpload('${attr(list)}','${attr(it.id)}','${attr(st.id)}')">UPLOAD STATE REFERENCE</button><button class="chip" onclick="approveEntityFile('${attr(list)}','${attr(it.id)}','','${attr(st.id)}')">CHOOSE CANDIDATE</button><button class="icon-danger" onclick="removeContinuityState('${list}','${it.id}',${selectedIndex})">×</button>`}</div></div>${selectedApprovedHero}${continuityStateValidationMarkup(list,it,st,media)}<div class="continuity-state-scope"><label>Applies to scenes / shots<input value="${attr(st.appliesTo || "")}" placeholder="Scenes 1–2 or L2-01, L2-02" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'appliesTo',this.value)"></label>${st.isDefault ? `<label>Reference requirement<input value="Required — the main approved image" disabled></label>` : `<label>Reference requirement${referenceRequirementSelect(referenceRequirement(st), `setContinuityState('${list}','${it.id}',${selectedIndex},'referenceRequirement',this.value);dirty();route()`)}</label>`}<div class="state-approved-readout"><span>${selectedIsCanon ? "Canon image" : selectedApprovedFile ? "Historic image · not approved" : "Canon image"}</span><b>${esc(selectedApprovedFile || "None selected")}</b><small>${selectedIsCanon ? "Approved by you as this state’s production truth." : selectedApprovedFile ? "Previously selected. Approve it to make it canon." : "Use Upload State Reference or Choose Candidate above."}</small></div></div><label class="continuity-state-delta"><span>${st.isDefault ? "Base-state notes" : "State change / delta"}</span><textarea placeholder="${st.isDefault ? "Primary appearance and any details that must always remain true." : "What changes from the parent state? Also name anything that must remain unchanged."}" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'notes',this.value)">${esc(st.notes || "")}</textarea></label>${typeof assetStatePromptStudio === "function" ? assetStatePromptStudio(list, it, st) : ""}${continuityStateCandidateTray(list,it,st,media)}</article>` : '<div class="canon-notes">No continuity states yet.</div>';
  return `<details class="fold continuity-states" data-entity-continuity="${attr(list + ":" + it.id)}" ${workspaceSectionOpen(sectionKey, true) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(sectionKey)}',this.open)"><summary>Continuity states <span>${states.length}</span></summary><div class="entity-coverage-intro"><div><b>Edit one state at a time</b><small>Other states stay compact so the workflow remains readable.</small></div></div>${continuityTrackingPanel(list, it)}${rail}<details class="state-chain-tools"><summary><span>State tools</span><small>Add another state or automate several parent-first</small></summary><div class="state-tool-actions"><button class="add-btn" onclick="addContinuityState('${list}','${it.id}')">+ Add continuity state</button></div>${typeof entityChainAutomationPanel === "function" ? entityChainAutomationPanel(list, it) : ""}</details><div class="continuity-state-list bounded-single-state">${editor}</div></details>`;
}
/* CREATION IS THE ONE MOMENT LINEAGE IS DECIDED.
 *
 * BATCH 1C. The re-audit found this function pushing an object literal with
 * `parentStateId` set directly, entirely outside the mutation boundary — and it
 * was right that a caller inventory searching for ASSIGNMENTS could never have
 * found it. Creation now goes through the same validator as everything else,
 * which is also the only place a parent is ever chosen.
 *
 * `parentStateId` may be supplied by the caller; it defaults to the root. The
 * validator refuses a parent that does not exist and a duplicate id, and it
 * validates the exact resulting collection — so a project already carrying
 * damage is not added to. */
window.addContinuityState = (list, id, parentStateId = "") => {
  const x = P[list].find((e) => e.id === id);
  x.continuityStates = ensureEntityStateList(x, true);
  const defaultState = x.continuityStates.find((item) => item.isDefault) || x.continuityStates[0];
  const outcome = applyStateCreation(x.continuityStates, {
    id: "state-" + Date.now().toString(36),
    parentStateId: String(parentStateId || "") || defaultState?.id || "state-default",
    isDefault: false,
    dirty,
    record: {
      name: "New state",
      appliesTo: "",
      approvedFile: "",
      notes: "",
      generationMode: "derive",
      referenceRequirement: "planned",
      assetPromptProfile: "",
      assetPromptNotes: "",
      assetPromptBuilds: [],
    },
  });
  if (!outcome.applied) {
    return toast(outcome.reason === "parent-missing"
      ? "That parent reference no longer exists. Choose one that does."
      : outcome.reason === "collection-invalid"
        ? "This reference's continuity states need repair before another can be added."
        : "The state could not be created.");
  }
  route();
};
window.setContinuityState = (list, id, i, k, v) => {
  const x = P[list].find((e) => e.id === id);
  const state = x?.continuityStates?.[i];
  if (!state) return;
  /* BATCH 1B: THE GENERIC SETTER IS NOT AN EXCEPTION.

     `state[k] = v` accepted `parentStateId` from anywhere, which made this a
     second, unvalidated ancestry writer sitting beside the validated one. A
     generic setter is exactly where a bypass hides, so the one field that can
     damage the graph is routed and the rest are untouched. */
  if (k === "parentStateId") return toast(reparentingUnsupported().detail);
  state[k] = v;
  if (["notes", "name"].includes(k)) state.parentValidation = null;
  dirty();
};
/* DELETION SAYS WHAT HAPPENS TO THE CHILDREN.
 *
 * BATCH 1C. This used to `splice` the array. The re-audit removed `child` from
 * `root -> child -> grand` and left `grand.parentStateId === "child"` pointing
 * at a state that no longer existed — and the old integrity check reported the
 * result acyclic, because a dangling parent is not a loop.
 *
 * BATCH 1D. And the "creator who means it" escape is gone with it. This used to
 * offer "Delete it and attach those states to the base reference instead?",
 * which the 1C audit accepted — and reparenting a grandchild is exactly what
 * this module claims cannot happen. A derivation chosen at creation is not
 * rewritten by a delete confirmation.
 *
 * What the creator is told instead is the truth and the next step: which states
 * derive from this one, and that those go first. Each of those is its own
 * decision, visible and refusable, and none of them silently re-roots anything
 * the filmmaker built on. */
window.removeContinuityState = (list, id, i) => {
  const x = P[list].find((e) => e.id === id);
  const state = x?.continuityStates?.[i];
  if (!state) return;
  const outcome = applyStateDeletion(x.continuityStates, state.id, { dirty });
  if (!outcome.applied) {
    if (outcome.reason === "default-state-is-the-root") return toast("The base state remains available for every continuity record");
    if (outcome.reason === "has-children") {
      const names = outcome.children
        .map((childId) => (x.continuityStates.find((row) => row && row.id === childId) || {}).name || childId)
        .join(", ");
      const many = outcome.children.length !== 1;
      return toast(
        `${state.name || "This state"} cannot be removed while ${many ? "these states derive" : "another state derives"} from it: ${names}. `
        + `Remove ${many ? "them" : "it"} first. A state's derivation is chosen when it is created and CineBraid will not re-point it.`,
      );
    }
    return toast("That state could not be removed.");
  }
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
  /* The preset table still reads as booleans because that is how a template
     naturally reads — "front: yes, detail: no" — but what it SEEDS is the enum,
     through the one function that decides what a template boolean means. */
  return (presets[list] || []).map(([id, label, required]) => ({ id, label, requirement: templateRequirement(required), selectedFile: '', notes: '', status: 'missing' }));
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
  if (key !== "selectedFile" && key !== "approvedFile") { slot[key] = value; dirty(); return; }
  const next = String(value || ""), previous = slotSelectedFile(slot);
  if (next && entityCandidateIsCoverageSheet(entity, next)) return toast("A full sheet cannot be assigned to a single expression. Extract the panel first.");
  /* K1C/K-alpha — THE EXPRESSION SETTER, ROUTED. This is the coverage setter's
     twin and it was missed by both earlier passes: it wrote `approvedFile`,
     `status: "approved"` and `approvedAt` straight onto the slot, with no
     commit-time ownership question and an approval claim on a supporting
     reference. An expression slot is the same kind of thing a coverage slot is,
     so it goes through the same one writer. */
  const apply = () => {
    const at = new Date().toISOString();
    if (previous !== next) recordCoverageReplacement(slot, previous, next, previous ? "expression-replacement" : "expression-assignment");
    if (!next) { clearSlotReference(slot, { at, via: "expression-clear" }); dirty(); route(); return; }
    const outcome = assignSlotReference(slot, {
      fileName: next,
      at,
      via: previous ? "expression-replacement" : "expression-assignment",
      owner: { project: P, list: "characters", entityId: entity.id },
    });
    if (!outcome.assigned) return toast(outcome.message || `${next} could not be assigned to ${slot.label || slot.id}`);
    dirty(); route();
  };
  if (previous && next && previous !== next) return confirmModal(`Replace ${slot.label}? ${previous} will remain in replacement history.`, apply, { title: "Replace the selected expression", confirmLabel: "REPLACE EXPRESSION" });
  apply();
};
/* The precedence chain that used to live here now lives in
   public/shared-coverage.js, because it was never only this file's answer: three
   other surfaces were deciding the same question from the boolean alone and
   printing a different fraction. These two are thin delegations so every existing
   call site keeps working while there is exactly one implementation. */
function referenceRequirement(item, isDefault = false) {
  return coverageRequirement(item, isDefault);
}
function referenceRequirementLabel(item, isDefault = false) {
  return requirementLabel(item, isDefault);
}
function referenceSlotStatus(slot) {
  /* S7 — "Selected", never "Approved". A slot holding a file is a supporting
     reference the creator chose; the word that used to be here is the one every
     downstream surface read as production truth. */
  if (slotSelectedFile(slot)) return { tone: "complete", label: "Selected" };
  const requirement = referenceRequirement(slot);
  if (requirement === "not-required") return { tone: "optional", label: "Not required" };
  if (requirement === "planned") return { tone: "pending", label: "Planned" };
  return { tone: "attention", label: "Missing" };
}
/* Both writers used to set `requirement` AND mirror it into `required`, keeping
   the retired boolean alive as a second authored copy of one fact — which is
   what let an importer, a hand edit or an older build reintroduce the
   disagreement one field at a time. They now write through the single
   authoritative writer, which sets the enum and removes the retired encodings
   from the record the filmmaker is editing. */
window.setCoverageSlotRequirement = (list, id, index, value) => {
  const entity = P[list]?.find((item) => item.id === id);
  const slot = entity ? ensureCoverageSlots(list, entity)[index] : null;
  if (!slot) return;
  writeCoverageRequirement(slot, value);
  dirty();
  route();
};
window.setExpressionSlotRequirement = (id, index, value) => {
  const entity = P.characters?.find((item) => item.id === id);
  const slot = entity ? ensureExpressionSlots(entity)[index] : null;
  if (!slot) return;
  writeCoverageRequirement(slot, value);
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
  const fallback = slots.find((row) => referenceRequirement(row.slot) === "required" && !slotSelectedFile(row.slot))?.slot.id || ids[0] || "";
  const selectedId = boundedSelected("expression-slot", entity.id, ids, fallback);
  const selected = slots.find((row) => row.slot.id === selectedId) || slots[0];
  const slot = selected?.slot;
  const item = slot ? mediaByName.get(slotSelectedFile(slot)) : null;
  const slotState = slot ? referenceSlotStatus(slot) : null;
  const requirement = slot ? referenceRequirement(slot) : "planned";
  const editor = slot ? `<article class="coverage-slot-card focused-slot-selected ${slotSelectedFile(slot) ? "is-ready" : requirement === "required" ? "needs-attention" : ""}"><header><div><span>${esc(referenceRequirementLabel(slot).toUpperCase())} EXPRESSION</span><b>${esc(slot.label)}</b></div><span class="coverage-slot-state">${slotState.label}</span></header><div class="coverage-slot-preview">${item ? `<img src="${attr(item.url)}" alt="">` : `<div class="coverage-slot-empty">${requirement === "not-required" ? "No reference needed" : "No expression selected"}</div>`}</div><label><span>Project need</span>${referenceRequirementSelect(requirement, `setExpressionSlotRequirement('${entity.id}',${selected.sourceIndex},this.value)`)}</label><label><span>Selected file</span><select onchange="setExpressionSlotField('${entity.id}',${selected.sourceIndex},'selectedFile',this.value)">${coverageSlotOptions(media,slotSelectedFile(slot),entity)}</select></label><label><span>Performance notes</span><textarea placeholder="Physical expression, intensity, and what must remain unchanged." onchange="setExpressionSlotField('${entity.id}',${selected.sourceIndex},'notes',this.value)">${esc(slot.notes||"")}</textarea></label></article>` : `<div class="entity-candidate-empty"><b>No expression slots configured</b><span>Add expressions only when this project needs them.</span></div>`;
  const manual = `<div class="compact-section-actions coverage-board-actions manual-coverage-actions"><button class="approve-btn" onclick="openCoverageSheetPicker('characters','${entity.id}')">Crop expression sheet</button></div>`;
  const assisted = `<details class="coverage-assisted-actions" ${manualFirstWorkflow() ? "" : "open"}><summary>Optional assisted creation</summary><div class="compact-section-actions coverage-board-actions"><button class="approve-btn" onclick="openCoverageExpressionAutomation('${entity.id}')">Generate expression sheet</button></div></details>`;
  return `<details class="fold compact-entity-section entity-expression-section bounded-source-section" ${open ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Expression board <span>${stats.approvedRequired}/${stats.required} required approved${stats.planned ? ` · ${stats.planned} planned` : ""}${active ? " · generating" : ""}</span></summary>${entityCoverageActivityMarkup("characters", entity, "expressions")}<div class="entity-coverage-intro"><div><b>${stats.approvedTotal} of ${stats.total} expressions assigned</b><small>Mark each expression Required, Planned, or Not required. Only required gaps affect project attention.</small></div></div>${referenceSlotRailMarkup("expression-slot", entity.id, slots.map((row) => row.slot), selectedId)}<div class="coverage-slot-grid bounded-single-slot">${editor}</div>${manual}${assisted}</details>`;
}

/* Every coverage fraction CineBraid prints comes from here, and here is now one
   line long: the derivation is shared so the Reference Inspector cannot compute
   a second answer. Nothing on this object is ever written back to the project —
   the slots are the facts and these are the numbers read off them. */
function coverageStats(slots) {
  return summariseCoverage(slots);
}
/* P4-SEM-C2. A bare filename list is what Dogfood Pass #1 §7.1 reported: a
   coverage selector showing several candidates with nothing saying which one was
   already approved, so a creator can pick an unapproved image believing they are
   working from canon. The option now carries its role, and an approved one says
   what it is already authority for — which is the fact that makes the difference
   between "pick a file" and "replace a canon decision". */
/* Which list an entity lives in. The selector is handed the entity alone, and
   the ownership question is list-scoped, so this is the one place that answers
   it rather than each caller threading a parameter through. */
function entityListOf(entity) {
  if (!entity) return "";
  for (const list of ["characters", "locations", "props", "vehicles"]) {
    if ((P[list] || []).some((row) => row && row.id === entity.id)) return list;
  }
  return "";
}
function coverageSlotOptions(media, selected = '', entity = null) {
  const eligible = (media || []).filter((item) => !entity || !entityCandidateIsCoverageSheet(entity, item.name));
  const roles = entity ? partitionEntityMedia(entity, eligible).byName : new Map();
  return [`<option value="">— no view selected —</option>`].concat(eligible.map((item) => {
    const row = roles.get(item.name);
    /* 1D-04: same split as the candidate card. WHAT the option is already used
       for is always named — replacing it is a real decision either way — and
       only the word "approved" waits on a receipt. */
    const usedFor = row?.role === "approved" ? row.targets.map((target) => target.label || target.kind).filter(Boolean).join(" · ") : "";
    const backed = !!usedFor && edgesAreReceiptBacked(P, row.targets, { list: entityListOf(entity), entityId: entity && entity.id });
    const marker = usedFor
      ? `${backed ? " — approved" : " — selected, not approved"} · ${usedFor}`
      : row?.role === "rejected" ? " — rejected" : "";
    return `<option value="${attr(item.name)}" data-media-role="${attr(row?.role || "candidate")}" ${item.name === selected ? 'selected' : ''}>${esc(item.name)}${esc(marker)}</option>`;
  })).join('');
}
function recordCoverageReplacement(slot, previousFile, nextFile, source = "manual") {
  slot.replacementHistory = Array.isArray(slot.replacementHistory) ? slot.replacementHistory : [];
  slot.replacementHistory.push({ at: new Date().toISOString(), previousFile: previousFile || "", nextFile: nextFile || "", source });
  slot.replacementHistory = slot.replacementHistory.slice(-20);
}
/* K4: THE OTHER DIRECT SETTER, ROUTED. The re-audit named this one alongside
   the batch writer: manual assignment and manual replacement both wrote the
   slot with no commit-time ownership question, so UI filtering was the only
   protection and stale state walked straight past it. */
function applyCoverageAssignment(list, entity, slot, fileName, source = "manual") {
  if (fileName && entityCandidateIsCoverageSheet(entity, fileName)) return toast("A multi-view sheet cannot be assigned as a single angle. Extract a panel first.");
  const at = new Date().toISOString();
  if (!String(fileName || "")) {
    clearSlotReference(slot, { at, via: source });
    delete slot[APPROVED_ASSET_ID_FIELD];
    dirty();
    route();
    return;
  }
  const outcome = assignSlotReference(slot, {
    fileName: String(fileName),
    at,
    via: source,
    owner: { project: P, list, entityId: entity.id },
  });
  if (!outcome.assigned) return toast(outcome.message || `${fileName} could not be assigned to ${slot.label || slot.id}`);
  /* P4-SEM-C2. The slot records WHICH BYTES it selected, so a later rename
     cannot leave it pointing at a filename that no longer exists. */
  stampApprovalIdentity(slot, (entityMedia(list, entity).find((item) => item.name === slotSelectedFile(slot)) || {}).assetId || "");
  dirty();
  route();
}
window.setCoverageSlotField = (list, id, index, key, value) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  const slot = ensureCoverageSlots(list, entity)[index];
  if (!slot) return;
  if (key !== "selectedFile" && key !== "approvedFile") { slot[key] = value; dirty(); return; }
  const previous = slotSelectedFile(slot), next = String(value || "");
  if (previous && next && previous !== next) {
    return confirmModal(`Replace ${slot.label}?`, () => applyCoverageAssignment(list, entity, slot, next, "manual-replacement"), { title: "Replace the image selected for this view", confirmLabel: "REPLACE VIEW", body: `${previous} will remain in history, but ${next} becomes the image selected for this view.` });
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
  if (!directOverride && !review?.pass) return toast("Run and pass AI review before selecting this coverage view.");
  /* K4 + K-alpha: ONE SLOT WRITER, OWNERSHIP RE-RESOLVED AT COMMIT, AND NO
     APPROVAL CLAIM. A slot is a supporting reference — see
     public/shared-entity-slots.js — so this SELECTS a file for it, refuses a
     contested or unowned one against current state, and asserts nothing about
     canon. */
  const commit = () => {
    const outcome = assignSlotReference(slot, {
      fileName,
      at: new Date().toISOString(),
      via: directOverride ? "human-coverage-selection" : "reviewed-coverage-candidate",
      owner: { project: P, list, entityId: entity.id },
    });
    if (!outcome.assigned) return toast(outcome.message || `${fileName} could not be assigned to ${slot.label || slot.id}`);
    /* K-alpha, THE ROW HALF. The slot itself was demoted above, but the
       CANDIDATE ROW went on claiming `humanApproved` and a human approval
       provenance — and shared-production-media.js reads exactly those two
       fields to decide that a file is human-approved production media. So the
       authority the slot stopped asserting was still leaving through the row.
       A selection is recorded as a selection on both sides of the boundary.

       `decidedAt` reads from `selectedAt`, because `approvedAt` is one of the
       three claims assignSlotReference withdraws — a person did decide, and the
       timestamp of that decision is not an approval timestamp. */
    row.decision = row.coverageGroup === "expressions" ? "selected-expression" : "selected-coverage";
    row.reviewRequired = false;
    row.directApprovalOverride = !!directOverride;
    row.humanApproved = false;
    row.humanApprovedWithoutAI = false;
    row.selectionProvenance = { source: "human", aiReviewed: !directOverride, authoritative: false, selectedAt: slot.selectedAt };
    row.decidedAt = slot.selectedAt;
    row.approvedCoverageSlotId = slot.id;
    dirty(); route(); toast(`${slot.label} ${row.coverageGroup === "expressions" ? "expression" : "coverage"} selected`);
  };
  const replaceOrCommit = () => {
    const held = slotSelectedFile(slot);
    if (held && held !== fileName) return confirmModal(`Replace ${slot.label}? ${held} will remain in replacement history.`, commit, { title: "Replace the image selected for this view", confirmLabel: "REPLACE VIEW" });
    commit();
  };
  if (directOverride) return confirmModal(`Assign ${fileName} to ${slot.label} based on human judgment? CineBraid will record that no current AI check authorized this assignment.`, replaceOrCommit, { title: "Human approval", confirmLabel: "ASSIGN VIEW" });
  replaceOrCommit();
};
window.addCoverageSlot = (list, id) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  const slots = ensureCoverageSlots(list, entity);
  /* `requirement: "planned"`, not `required: false`. Same meaning — a new custom
     slot is a view somebody may want, not one the project demands — written in
     the one encoding this build authors. */
  slots.push({ id: 'custom-' + Date.now().toString(36), label: 'Custom slot', requirement: templateRequirement(false), selectedFile: '', notes: '', status: 'missing' });
  dirty();
  route();
};
function coveragePassingAssignmentQueue(entity, group = "angles") {
  return (entity.candidateFiles || []).filter((row) => {
    if (!row?.targetCoverageSlotId || decisionIsSlotSelection(row.decision) || row.decision === "rejected") return false;
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
  const fallback = slots.find((slot) => referenceRequirement(slot) === "required" && !slotSelectedFile(slot))?.id || ids[0] || "";
  const selectedId = boundedSelected("coverage-slot", `${list}:${entity.id}`, ids, fallback);
  const selectedIndex = Math.max(0, slots.findIndex((slot) => slot.id === selectedId));
  const slot = slots[selectedIndex];
  const mediaItem = slot ? mediaByName.get(slotSelectedFile(slot)) : null;
  const slotState = slot ? referenceSlotStatus(slot) : null;
  const requirement = slot ? referenceRequirement(slot) : "planned";
  const editor = slot ? `<article class="coverage-slot-card focused-slot-selected ${slotSelectedFile(slot) ? "is-ready" : requirement === "required" ? "needs-attention" : ""}"><header><div><span>${esc(referenceRequirementLabel(slot).toUpperCase())} SLOT</span><b>${esc(slot.label)}</b></div><span class="coverage-slot-state">${slotState.label}</span></header><div class="coverage-slot-preview">${mediaItem ? (isVideo(mediaItem.name) ? `<video muted src="${attr(mediaItem.url)}"></video>` : `<img src="${attr(mediaItem.url)}" alt="">`) : `<div class="coverage-slot-empty">${requirement === "not-required" ? "No reference needed" : "No reference selected"}</div>`}</div><label><span>Project need</span>${referenceRequirementSelect(requirement, `setCoverageSlotRequirement('${list}','${entity.id}',${selectedIndex},this.value)`)}</label><label><span>Selected file</span><select onchange="setCoverageSlotField('${list}','${entity.id}',${selectedIndex},'selectedFile',this.value)">${coverageSlotOptions(media, slotSelectedFile(slot), entity)}</select></label>${slotSelectedFile(slot) ? `<div class="approval-provenance-note">Supporting reference${String(slot.provenance?.source || "").includes("human") ? " chosen by you" : ""} — context for generation, not production truth.</div>` : ""}<label><span>Notes</span><textarea placeholder="When to use this slot, framing constraints, or what makes this view the right one to approve." onchange="setCoverageSlotField('${list}','${entity.id}',${selectedIndex},'notes',this.value)">${esc(slot.notes || "")}</textarea></label></article>` : `<div class="entity-candidate-empty"><b>No coverage slots configured</b><span>Add only the views this project actually needs.</span></div>`;
  const manualActions = `<div class="compact-section-actions coverage-board-actions manual-coverage-actions"><button class="approve-btn" onclick="openImportedReferenceMapper('${list}','${entity.id}')">Map imported references</button><button class="ghost-btn" onclick="openCoverageSheetPicker('${list}','${entity.id}')">Crop reference sheet</button><button class="add-btn" onclick="addCoverageSlot('${list}','${entity.id}')">+ Add custom slot</button></div>`;
  const assistedActions = `<details class="coverage-assisted-actions" ${manualFirstWorkflow() ? "" : "open"}><summary>Optional assisted creation</summary><div class="compact-section-actions coverage-board-actions"><button class="approve-btn" onclick="openCoverageAutomationModal('${list}','${entity.id}','hybrid')">Generate missing angles</button></div></details>`;
  return `<details class="fold compact-entity-section entity-coverage-section bounded-source-section" ${open ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Coverage board <span>${stats.approvedRequired}/${stats.required} required approved${stats.planned ? ` · ${stats.planned} planned` : ""}${active ? " · generating" : ""}</span></summary>${entityCoverageActivityMarkup(list, entity, "angles")}${assignmentNotice}<div class="entity-coverage-intro"><div><b>${stats.approvedTotal} of ${stats.total} views assigned</b><small>Mark each view Required, Planned, or Not required. Imported references can fill slots directly; generation is optional.</small></div></div>${referenceSlotRailMarkup("coverage-slot", `${list}:${entity.id}`, slots, selectedId)}<div class="coverage-slot-grid bounded-single-slot">${editor}</div>${manualActions}${assistedActions}</details>`;
}



function referenceCreationHub(list, entity) {
  if (list === "audio") return "";
  const states = entityStateListRead(entity, true);
  const primary = states.find((state) => state.isDefault) || states[0];
  /* MB-PT-02: canon, not pointer presence. A raw pointer is historic and the
     hub reports it as work still to do. */
  const hubTruth = entityStateTruth(list, entity);
  const primaryFile = primary ? hubTruth.of(primary).file : "";
  const primaryIsCanon = primary ? hubTruth.of(primary).standing === "canon" : false;
  const mediaCount = entityMedia(list, entity).length;
  const coverage = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : (entity.coverageSlots || []);
  const selectedViews = coverage.filter((slot) => slotSelectedFile(slot)).length;
  const approvedStates = states.filter((state) => hubTruth.of(state).standing === "canon").length;
  return `<section class="reference-manual-hub"><header><div><span>UPLOAD & ORGANIZE</span><h2>Build the reference pack</h2><p>Import work made anywhere, choose which images are approved, split reference sheets into usable angles, then attach them to shots. AI review and generation are optional.</p></div><span class="reference-manual-status">${primaryIsCanon ? "PRIMARY CANON" : primaryFile ? "PRIMARY HISTORIC · APPROVE IT" : "PRIMARY NEEDED"} · ${selectedViews}/${coverage.length || 0} VIEWS · ${approvedStates}/${states.length || 0} STATES</span></header><div class="reference-manual-actions"><button class="approve-btn recommended" onclick="document.getElementById('entity-file').click()"><span>Upload reference files</span><small>Add existing images or video from disk</small></button><button class="ghost-btn" onclick="openImportedReferenceMapper('${attr(list)}','${attr(entity.id)}')"><span>Map imported references</span><small>Assign a single image to primary, state, angle, or expression</small></button><button class="ghost-btn" ${mediaCount ? "" : "disabled"} onclick="openCoverageSheetPicker('${attr(list)}','${attr(entity.id)}')"><span>Crop reference sheet</span><small>Cut a turnaround or contact sheet into individual angle files</small></button><button class="ghost-btn" ${mediaCount ? "" : "disabled"} onclick="approveEntityFile('${attr(list)}','${attr(entity.id)}','${attr(primaryFile)}','${attr(primary?.id || "state-default")}')"><span>Choose the main approved image</span><small>${primaryFile ? `${primaryIsCanon ? "Currently" : "Historic, not approved:"} ${esc(primaryFile)}` : mediaCount ? "Select one uploaded image" : "Upload a reference first"}</small></button></div><div class="reference-manual-principle"><b>CineBraid stores the production truth.</b><span>Human approval is enough. Optional AI checks can be run later without changing the image you approved.</span></div></section>`;
}
function referenceAssistedToolsMarkup(list, entity) {
  if (list === "audio") return "";
  const coverage = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : (entity.coverageSlots || []);
  const missingRequired = coverage.filter((slot) => referenceRequirement(slot) === "required" && !slotSelectedFile(slot) && !slot.retired).length;
  /* The assisted tools are gated on CANON, which is also what coverage
     automation itself requires — so the button and the action now agree instead
     of the button offering something the action refuses. */
  const toolsTruth = entityStateTruth(list, entity);
  const primaryReady = entityStateListRead(entity, true).some((state) => state.isDefault && toolsTruth.of(state).standing === "canon");
  const alternateStates = entityStateListRead(entity, true).filter((state) => !state.isDefault && referenceRequirement(state) === "required");
  const missingStates = alternateStates.filter((state) => toolsTruth.of(state).standing !== "canon").length;
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
  const taskTruth = entityStateTruth(list, entity);
  const primary = states.some((state) => state.isDefault && taskTruth.of(state).standing === "canon");
  /* An audio entity has no image. It inherited this taskbar because it is an
     entity, and inherited the word "image" with it — so a voice reference used
     to report that it had "no approved image yet". The material a voice is
     missing is a recording. */
  if (taskId === "reference") return primary ? {tone:"complete",label:STAGE_STATUS.approved} : {tone:"attention",label:STAGE_STATUS.incomplete,note:list === "audio" ? "no approved recording yet" : "no approved image yet"};
  if (taskId === "review") return activeCandidates.length ? {tone:"attention",label:STAGE_STATUS.needsReview,note:`${plural(activeCandidates.length, "file")} to choose from`} : {tone:"optional",label:STAGE_STATUS.nothingWaiting};
  if (taskId === "coverage") {
    const coverage = coverageStats(ensureCoverageSlots(list,entity));
    const expressions = list === "characters" ? coverageStats(ensureExpressionSlots(entity).filter((slot)=>!slot.retired)) : {missingRequired:0};
    const missingStates = states.filter((state)=>!state.isDefault && referenceRequirement(state) === "required" && taskTruth.of(state).standing !== "canon").length;
    const planned = states.filter((state)=>!state.isDefault && referenceRequirement(state) === "planned" && taskTruth.of(state).standing !== "canon").length + coverage.planned + expressions.planned;
    const active = entityCoverageActiveJobs(list,entity.id,"angles").length + (list === "characters" ? entityCoverageActiveJobs("characters",entity.id,"expressions").length : 0);
    const missing = coverage.missingRequired + expressions.missingRequired + missingStates;
    return active ? {tone:"active",label:STAGE_STATUS.running} : missing ? {tone:"attention",label:STAGE_STATUS.incomplete,note:`${plural(missing, "required view")} missing`} : planned ? {tone:"pending",label:STAGE_STATUS.inProgress,note:`${plural(planned, "view")} planned`} : {tone:"complete",label:STAGE_STATUS.complete};
  }
  if (taskId === "details") {
    const hasDetails = entityVisualDescription(entity, list) || String(entity.notes || "").trim() || (entity.planningMedia || []).length;
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
  /* MB-PT-02: counted and headlined from the projection, not from pointer
     presence. A state whose pointer nobody approved is HISTORIC and is reported
     as work still to do, which is what it is. */
  const stateTruth = entityStateTruth(list, entity);
  const approvedCount = states.filter((state) => stateTruth.of(state).standing === "canon").length;
  const authorityStatus = `<b class="entity-authority-status"><strong>${approvedCount}/${states.length}</strong><span>${pluralWord(states.length, "state has", "states have")} a canon image</span></b>`;
  if (selectedTask === "coverage") return `<section class="entity-authority-summary is-compact"><header><div><span class="entity-authority-label">CANON IMAGES</span>${authorityStatus}<small>Approved images for each state are chosen in the editor below.</small></div></header></section>`;
  const rows = states.map((state) => {
    const standing = stateTruth.of(state);
    const fileName = standing.file;
    const isCanon = standing.standing === "canon";
    const media = mediaByName.get(fileName);
    const candidate = fileName ? entityCandidateRow(entity, fileName, false) : null;
    /* The note describes the CURRENT standing. A cached humanApproved that no
       receipt supports reads as history, never as an approval. */
    const approvalNote = !isCanon ? (fileName ? " · Historic, not approved" : "")
      : candidate?.humanApprovedWithoutAI ? " · Human approved, not AI checked"
        : candidate?.humanApproved ? " · Human approved" : "";
    const isSheet = !!(media && entityCandidateIsCoverageSheet(entity, fileName));
    const openState = `boundedWriteState('selected:entity-coverage-view','${attr(list+":"+entity.id)}','states');boundedWriteState('selected:continuity-state','${attr(list+":"+entity.id)}','${attr(state.id)}');selectBoundedTask('entity-task','${attr(list+":"+entity.id)}','coverage')`;
    /* O5: this thumbnail is an APPROVED AUTHORITY — the image that defines a
       continuity state. Inspecting it is the question a filmmaker actually has here
       ("what is this the authority for, and who approved it"), so the click opens the
       Inspector; its own Open-full-preview covers the old behaviour. */
    const previewAction = media ? `inspectMediaFile('${attr(encodeURIComponent(media.url))}','${attr(media.assetId || "")}','${attr(encodeURIComponent(`${state.name || "Default"} ${isCanon ? "canon" : "historic"} image · ${fileName}`))}','${isVideo(media.name) ? "video" : "image"}')` : openState;
    return `<article class="entity-authority-row ${media && isCanon ? "ready" : media ? "historic" : "missing"} ${isSheet?"is-sheet":""}"><button type="button" class="entity-authority-thumb-button" onclick="${previewAction}" aria-label="${!media ? `Open ${attr(state.name || "state")}` : isCanon ? `Preview the approved ${attr(state.name || "state")} canon image` : `Preview the historic ${attr(state.name || "state")} image, which has not been approved`}"><span class="entity-authority-thumb">${media ? (isVideo(media.name) ? `<video muted src="${attr(media.url)}"></video>` : `<img src="${attr(media.url)}" alt="">`) : "—"}</span><small>${media ? "INSPECT" : "MISSING"}</small></button><button type="button" class="entity-authority-details" onclick="${openState}"><span><b>${esc(state.name || "Default")}</b><small>${fileName ? `${esc(fileName)}${esc(approvalNote)}` : "No approved image yet"}</small></span><em>${isSheet?"MULTI-VIEW SHEET":!media?"MISSING":isCanon?"CANON":"HISTORIC"}</em></button>${isSheet ? `<button type="button" class="chip entity-authority-extract" onclick="openCoverageSheetExtractor('${attr(list)}','${attr(entity.id)}','${attr(fileName)}')">EXTRACT VIEWS</button>` : ""}</article>`;
  }).join("");
  return `<section class="entity-authority-summary"><header><div><span class="entity-authority-label">CANON IMAGES</span>${rows ? authorityStatus : `<b class="entity-authority-status"><span>No states</span></b>`}</div></header><div>${rows}</div></section>`;
}
function entityCoverageStatesMarkup(list, entity, mediaByName, media) {
  const views = [{id:"coverage",label:"Angles / views",render:()=>coverageBoardMarkup(list,entity,mediaByName,media)}];
  if (list === "characters") views.push({id:"expressions",label:"Expressions",render:()=>expressionBoardMarkup(entity,mediaByName,media)});
  views.push({id:"states",label:"Continuity states",render:()=>continuityStatesPanel(list,entity,media)});
  const ids=views.map((view)=>view.id), context=`${list}:${entity.id}`;
  const fallback = entityStateListRead(entity,true).some((state)=>!state.isDefault && !state.approvedFile) ? "states" : "coverage";
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
  const media=entityMedia(list,it), wf=entityWorkflowState(it), states=list === "audio" ? [] : entityStateListRead(it,true), mediaByName=new Map(media.map((item)=>[item.name,item]));
  /* P4-SEM-C2. This surface no longer decides for itself what its media IS.

     It used to build an `approvedNames` Set inline and subtract it from BOTH the
     active and the rejected list, so an approved image left the screen entirely
     — while public/coverage-automation.js read the same approvedFile and treated
     it as the ranking authority. Dogfood Pass #1 hit exactly that split: the
     approved London Rooftops source was resolvable to automation and
     unreachable here. One resolver owns the question now, and `approvedMedia` is
     the authority this screen used to throw away. */
  const disposition=partitionEntityMedia(it,media,{states}), approvedMedia=disposition.approved;
  const activeCandidates=disposition.candidates.map((row)=>row.item), rejectedCandidates=disposition.rejected.map((row)=>row.item);
  const candidateFilter=entityCandidateFilter(list,id), filteredCandidates=activeCandidates.filter((item)=>entityCandidateMatchesFilter(it,item.name,candidateFilter));
  const candidatePage=boundedPage(filteredCandidates,"candidates",`${list}:${id}:active:${candidateFilter}`,BOUNDED_PAGE_SIZES.candidates), rejectedPage=boundedPage(rejectedCandidates,"candidates",`${list}:${id}:rejected`,BOUNDED_PAGE_SIZES.candidates), audioPage=boundedPage(media,"candidates",`${list}:${id}:audio`,BOUNDED_PAGE_SIZES.candidates);
  const candidateJson=encodeURIComponent(JSON.stringify(candidatePage.rows)), rejectedJson=encodeURIComponent(JSON.stringify(rejectedPage.rows));
  /* The approved authority, ON the selector rather than subtracted from it.

     Bounded the same way every other media grid on this page is bounded, and
     placed above the undecided work because that is the order the question is
     asked in: what is already canon, then what am I choosing between. How this
     eventually LOOKS — pinned, chipped, sectioned — belongs to the shot-workspace
     UX batch. What C2 owes it is that the information is here at all. */
  const approvedPage=boundedPage(approvedMedia,"candidates",`${list}:${id}:approved`,BOUNDED_PAGE_SIZES.candidates);
  const approvedJson=encodeURIComponent(JSON.stringify(approvedPage.rows.map((row)=>row.item)));
  const approvedAuthorityMarkup=approvedMedia.length
    ? `<section class="entity-approved-authority" data-approved-count="${approvedMedia.length}"><header><span>APPROVED AUTHORITY</span><b>${plural(approvedMedia.length,"approved reference")}</b><small>Already canon for this reference. Kept in view so approval makes an image easier to reach, not harder.</small></header><div class="entity-media entity-candidate-grid">${approvedPage.rows.map((row,i)=>entityCandidateCard(list,it,row.item,i,approvedJson,false,row)).join("")}</div>${boundedPagerMarkup("candidates",`${list}:${id}:approved`,approvedPage,"approved references")}</section>`
    : "";
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
  /* OWNERSHIP THAT CINEBRAID CANNOT PROVE, STATED RATHER THAN GUESSED.
     Two conditions the approval pool above deliberately excludes, surfaced here
     so nothing disappears and neither one can be approved by accident: a
     filename that merely LOOKS like this reference's, and a file two references
     both durably claim. The first is one click from becoming real ownership;
     the second is a conflict only a person can settle. */
  const unassignedMedia=entityUnassignedMedia(list,it), contestedMedia=entityContestedMedia(list,it);
  const ownershipMarkup=`${contestedMedia.length ? `<section class="entity-media-contested" data-contested-count="${contestedMedia.length}"><header><span>OWNERSHIP CONFLICT</span><b>${plural(contestedMedia.length,"file")} claimed by more than one reference</b><small>No reference owns these while the conflict stands, and none of them can be approved. Remove the incorrect claim from whichever reference should not hold it.</small></header><ul>${contestedMedia.map((m)=>`<li><b>${esc(m.name)}</b><span>claimed by ${esc(resolveMediaOwnership(entityOwnerIndex(list),m.name).claimants.join(", "))}</span></li>`).join("")}</ul></section>` : ""}${unassignedMedia.length ? `<details class="entity-media-unassigned" data-unassigned-count="${unassignedMedia.length}"><summary>Possible matches, not yet claimed <span>${unassignedMedia.length}</span></summary><p class="hint">These filenames start with this reference's prefix, but nothing in the project records them as belonging to it. A name is a possible match, not ownership — claim one to make it a candidate you can review and approve.</p><div class="entity-media entity-candidate-grid">${unassignedMedia.map((m)=>`<div class="entity-tile-wrap"><div class="entity-tile">${isVideo(m.name)?`<video muted src="${attr(m.url)}"></video>`:`<img src="${attr(m.url)}" alt="">`}<span class="entity-tile-name">${esc(m.name)}</span></div><button class="ghost-btn" onclick="claimEntityMedia('${list}','${id}','${attr(m.name)}')">CLAIM FOR THIS REFERENCE</button></div>`).join("")}</div></details>` : ""}`;
  const candidatesTask = `<details class="fold compact-entity-section entity-candidate-section bounded-source-section" open><summary>Candidate files <span>${activeCandidates.length} to organize</span></summary><header><div><span>CHOOSE & APPROVE</span><b>${filteredCandidates.length} shown in ${esc(ENTITY_CANDIDATE_FILTERS.find((item)=>item.id===candidateFilter)?.label || "All")}</b><small>Choose the approved image directly by human judgment. Optional AI checks remain separate and never approve on their own.</small></div></header>${approvedAuthorityMarkup}${ownershipMarkup}${filterMarkup}${batchPanel}<div class="entity-media entity-candidate-grid">${candidatePage.rows.length ? candidatePage.rows.map((m,i)=>entityCandidateCard(list,it,m,i,candidateJson,false)).join("") : `<div class="entity-candidate-empty"><b>${activeCandidates.length ? "No candidates in this filter" : media.length ? "No undecided candidates" : "No candidates yet"}</b><span>${activeCandidates.length ? "Choose another workflow filter." : "Upload or map another file."}</span></div>`}</div>${boundedPagerMarkup("candidates",`${list}:${id}:active:${candidateFilter}`,candidatePage,"reference candidates")}${rejectedCandidates.length ? `<details class="entity-rejected-candidates"><summary>Rejected candidates <span>${rejectedCandidates.length}</span></summary><div class="entity-media entity-candidate-grid">${rejectedPage.rows.map((m,i)=>entityCandidateCard(list,it,m,i,rejectedJson,true)).join("")}</div>${boundedPagerMarkup("candidates",`${list}:${id}:rejected`,rejectedPage,"rejected candidates")}</details>` : ""}</details>`;
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

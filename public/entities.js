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
/* ONE READER, ASKED — not a third copy of the answer. The body was
   `coverageJobType === "sheet" || !!coverageSheetType || /(?:SHEET|TURNAROUND|
   CONTACT)/i.test(fileName)`, and public/app.js and public/coverage-automation.js
   each carried their own drifting copy of it. shared-coverage.js explains why the
   filename half could never work and why the two declared fields are not
   interchangeable. */
function entityCandidateIsCoverageSheet(entity, fileName) {
  return isCoverageSheetArtifact(entity, fileName);
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
/* THE COVERAGE RUN, SAID IN THE PRESENT TENSE.
 *
 * This banner used to render `run.status` and `run.missingRequired` — two fields a
 * machine wrote when it last looked. The coverage board three inches away counts
 * through summariseCoverage() on every render. On Aug 26 a creator satisfied the
 * last required view by hand: the board said 0 missing, this banner said NEEDS
 * ATTENTION, and the button it drew opened a paid generation dialog for work that
 * no longer existed.
 *
 * There is one answer now and it is the reconciliation in public/shared-coverage.js,
 * asked through public/coverage-automation.js so the run's own slot set (angles vs
 * expressions) is the one that decides. What the machine actually recorded is not
 * thrown away — it is named underneath when it differs, because the run happening
 * is still history and history is evidence.
 *
 * RESUME MISSING VIEWS IS DRAWN FROM THE LIVE ANSWER, never from the stored status.
 * A satisfied goal has no missing views to resume, so there is no control to press
 * and no paid dialog behind it. */
function entityCoverageRunStatusMarkup(list, entity, group = "angles") {
  const run = entity?.coverageAutomation;
  if (!run || (group === "expressions") !== (run.sheetType === "expressions")) return "";
  const live = typeof coverageRunState === "function" ? coverageRunState(list, entity, run) : null;
  const status = String((live ? live.status : run.status) || "").toLowerCase();
  const recorded = String((live ? live.recordedStatus : run.status) || "").toLowerCase();
  if (!status || ["starting","sheet-running","individual-running"].includes(status)) return "";
  const satisfied = live?.goal === "satisfied";
  const tone = satisfied || status === "completed" ? "complete" : ["failed","cancelled","needs-attention"].includes(status) ? "attention" : "pending";
  const label = satisfied ? "goal satisfied" : status.replace(/-/g, " ");
  const missing = live?.known ? live.missingRequired : run.missingRequired;
  const detail = satisfied
    ? "Every required view has an image selected. No action is needed here."
    : status === "sheet-ready-for-review" ? "Sheet returned. Review it, then extract useful panels."
      : status === "slot-candidates-ready" ? "Individual view candidates returned and await review."
        : status === "completed" ? "Every required view has an image selected."
          : run.error || `${missing ?? "Some"} required ${missing === 1 ? "slot still needs" : "slots still need"} attention.`;
  /* Reconciled, and it says so. A creator who watched this banner say NEEDS
     ATTENTION five minutes ago is owed the sentence that explains why it does not
     any more, rather than a silent swap. */
  const history = live?.reconciled && recorded && recorded !== status
    ? `<small class="coverage-run-recorded" data-coverage-run-recorded="${attr(recorded)}">This run last recorded ${esc(recorded.replace(/-/g, " "))}. Current coverage has moved past it.</small>`
    : "";
  /* THE CONTROL IS DRAWN FROM THE LIVE GOAL. With no live answer, or one that
     could not be established, the recorded status governs exactly as it always
     did — withholding a repair action on an unknown is the wrong direction to be
     wrong in. */
  const resume = status === "needs-attention" && (!live || !live.known || live.goal === "outstanding");
  return `<div class="coverage-run-status tone-${attr(tone)}" data-coverage-run-goal="${attr(live?.goal || "unknown")}"><div><span>COVERAGE RUN</span><b>${esc(label.toUpperCase())}</b><small>${esc(detail)}</small>${history}</div>${resume ? `<button class="ghost-btn" onclick="openCoverageAutomationModal('${attr(list)}','${attr(entity.id)}','individual')">RESUME MISSING VIEWS</button>` : ""}</div>`;
}
function entityCoverageActivityMarkup(list, entity, group = "angles") {
  const jobs = entityCoverageActiveJobs(list, entity.id, group);
  if (!jobs.length) return entityCoverageRunStatusMarkup(list, entity, group);
  const latest = jobs.at(-1);
  const title = latest.coverageJobType === "slot" ? (latest.targetCoverageSlotName || "Coverage view") : group === "expressions" ? "Expression sheet" : "Coverage sheet";
  return `<div class="coverage-inline-activity"><span class="spin">◌</span><div><b>${esc(title)} generation in progress</b><small>${esc(String(latest.status || "queued").replace(/_/g, " "))}${latest.queuePosition != null ? ` · queue ${latest.queuePosition}` : ""} · this section will remain open</small></div><button class="ghost-btn" onclick="window.CineBraidCreatorSurfaces.expandTerminal()">VIEW ACTIVITY</button></div>`;
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
  return `<article class="entity-candidate-card ${rejected ? "is-rejected" : ""} ${approved ? "is-approved-authority" : ""} ${isSheet ? "is-coverage-sheet" : ""}" data-candidate-file="${attr(media.name)}" data-candidate-type="${attr(workflowType)}" data-media-role="${attr(disposition?.role || (rejected ? "rejected" : "candidate"))}"${authorityFor ? ` data-approved-for="${attr(authorityFor)}"` : ""}${disposition?.assetId ? ` data-asset-id="${attr(disposition.assetId)}"` : ""}><a class="entity-candidate-preview" href="javascript:void 0" onclick="openLBMedia('${mediaJson}',${index},'${attr(entity.id)}')" title="${attr(media.name)}">${isVideo(media.name) ? `<video muted src="${attr(media.url)}"></video>` : `<img src="${attr(media.url)}" alt="">`}${entityCandidateReviewOverlay(entity, media.name)}${targetName ? `<span class="entity-candidate-target">CONTINUITY · ${esc(targetName.toUpperCase())}</span>${parentName ? `<span class="entity-candidate-parent">FROM · ${esc(parentName.toUpperCase())}</span>` : ""}` : coverageName ? `<span class="entity-candidate-target">COVERAGE · ${esc(coverageName.toUpperCase())}</span>` : isSheet ? `<span class="entity-candidate-target">COVERAGE SHEET</span>` : ""}<span class="entity-tile-name">${esc(media.name)}</span></a><div class="entity-candidate-meta"><span class="entity-candidate-workflow-type">${esc(usedFor || entityCandidateWorkflowLabel(entity, media.name))}</span>${entityCandidateReviewBadge(entity, media.name)}${batchStatus}<small>${approved ? `Approved by you${authorityFor ? ` · authority for ${esc(authorityFor)}` : ""}${storedReview ? ` · AI ${Math.round(Number(storedReview.score || 0))} ${storedReview.pass ? "PASS" : "FLAG"} recorded` : " · approved without an AI review on record"}` : rejected ? `Rejected by you · kept on disk${storedReview ? ` · AI ${Math.round(Number(storedReview.score || 0))} ${storedReview.pass ? "PASS" : "FLAG"} recorded before the rejection` : " · no AI review was recorded"}` : `${sourceDescription} · ${reviewDescription}`}</small></div><div class="entity-candidate-actions">${approved ? `${aiAction}` : rejected ? `${rejectedReviewAction}<button class="chip" onclick="setEntityCandidateDecision('${list}','${entity.id}','${attr(media.name)}','unreviewed')">RESTORE</button>` : `<button class="approve-tile-btn human-approval-action" onclick="requestHumanEntityCandidateApproval('${list}','${entity.id}','${attr(media.name)}','${attr(targetStateId)}','${continuation}')">${humanLabel}</button>${aiAction}<button class="chip danger" onclick="setEntityCandidateDecision('${list}','${entity.id}','${attr(media.name)}','rejected')">REJECT</button>`}</div></article>`;
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

/* CORRECTION 1 — THE STATE RAIL RUNS THE SAME JOIN, and it is the one reference
   surface where "the production requires this now" can be TRUE: readiness raises
   exactly one kind of row about an entity, `entity-state`, and none at all for a
   coverage or expression slot (public/shared-shot-readiness.js: "a required
   coverage slot is an ENTITY completeness fact, not a shot prerequisite"). So a
   declared state a shot is actually waiting on reads Required — missing in amber
   here, and the same state with nothing waiting on it reads Planned. */
function continuityStatesPanel(list, it, media = [], demand = null) {
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
  const owedStates = states.filter((state) => stateTruth.of(state).standing !== "canon"
    && effectiveReferenceRequirement(state, demand, { isDefault: state.isDefault, family: "state" }) === "required").length;
  const rail = `<nav class="continuity-state-rail" aria-label="Continuity states" data-states-outstanding="${owedStates}">${states.map((state, index) => {
    const standing = stateTruth.of(state).standing;
    const requirement = effectiveReferenceRequirement(state, demand, { isDefault: state.isDefault, family: "state" });
    const tone = standing === "canon" ? "complete" : standing === "historic" ? "pending" : requirement === "required" ? "attention" : requirement === "planned" ? "pending" : "optional";
    const status = standing === "canon" ? (state.isDefault ? "Main canon image" : "Canon") : standing === "historic" ? "Historic · not approved" : effectiveRequirementLabel(state, demand, { isDefault: state.isDefault, family: "state" });
    return `<button type="button" class="tone-${tone} ${state.id===selectedId?"selected":""}" onclick="selectBoundedItem('continuity-state','${attr(list+":"+it.id)}','${attr(state.id)}')"><i></i><span><b>${esc(state.name || `State ${index+1}`)}</b><small>${status}</small></span></button>`;
  }).join("")}</nav>`;
  const editor = st ? `<article class="continuity-state-card continuity-state-card-focused ${st.isDefault ? "is-default" : ""}" data-continuity-state-id="${attr(st.id)}"><div class="continuity-state-head"><span>${selectedIndex + 1}</span><input value="${attr(st.name || "")}" placeholder="Clean suit / Damaged sleeve / Night lighting" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'name',this.value)" ${st.isDefault ? 'data-default="1"' : ''}><div class="continuity-state-head-actions">${st.isDefault ? `<button class="chip" onclick="approveEntityFile('${list}','${it.id}','${attr(st.approvedFile || '')}','${attr(st.id)}')">CHOOSE AUTHORITY</button>` : `<button class="chip" onclick="openContinuityStateVariant('${attr(list)}','${attr(it.id)}','${attr(st.id)}')">${selectedIsCanon ? "EDIT / REGENERATE" : selectedParentIsCanon ? `GENERATE FROM ${esc(parentInfo.label.toUpperCase())}` : "OPEN STATE WORKFLOW"}</button><button class="ghost-btn" onclick="openStateReferenceUpload('${attr(list)}','${attr(it.id)}','${attr(st.id)}')">UPLOAD STATE REFERENCE</button><button class="chip" onclick="approveEntityFile('${attr(list)}','${attr(it.id)}','','${attr(st.id)}')">CHOOSE CANDIDATE</button><button class="icon-danger" onclick="removeContinuityState('${list}','${it.id}',${selectedIndex})">×</button>`}</div></div>${typeof actionRefusalMarkup === "function" ? actionRefusalMarkup(`continuity-state:${list}:${it.id}:${st.id}`) : ""}${selectedApprovedHero}${continuityStateValidationMarkup(list,it,st,media)}<div class="continuity-state-scope"><label>Applies to scenes / shots<input value="${attr(st.appliesTo || "")}" placeholder="Scenes 1–2 or L2-01, L2-02" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'appliesTo',this.value)"></label>${st.isDefault ? `<label>Reference requirement<input value="Required — the main approved image" disabled></label>` : `<label>Reference requirement${referenceRequirementSelect(referenceRequirement(st), `setContinuityState('${list}','${it.id}',${selectedIndex},'referenceRequirement',this.value);dirty();route()`)}</label>`}<div class="state-approved-readout"><span>${selectedIsCanon ? "Canon image" : selectedApprovedFile ? "Historic image · not approved" : "Canon image"}</span><b>${esc(selectedApprovedFile || "None selected")}</b><small>${selectedIsCanon ? "Approved by you as this state’s production truth." : selectedApprovedFile ? "Previously selected. Approve it to make it canon." : "Use Upload State Reference or Choose Candidate above."}</small></div></div><label class="continuity-state-delta"><span>${st.isDefault ? "Base-state notes" : "State change / delta"}</span><textarea placeholder="${st.isDefault ? "Primary appearance and any details that must always remain true." : "What changes from the parent state? Also name anything that must remain unchanged."}" onchange="setContinuityState('${list}','${it.id}',${selectedIndex},'notes',this.value)">${esc(st.notes || "")}</textarea></label>${typeof assetStatePromptStudio === "function" ? assetStatePromptStudio(list, it, st) : ""}${continuityStateCandidateTray(list,it,st,media)}</article>` : '<div class="canon-notes">No continuity states yet.</div>';
  /* R21 — A CONTINUITY STATE IS A STORY VARIANT, NOT A CONFIGURATION RECORD.
   *
   * Glasses on, wet, bloodied, helmet off, thirty years older. That is what this
   * panel is for, and the human pass could not find how to add one: the single
   * "+ Add continuity state" button was the third thing inside a closed
   * `<details>` called "State tools", underneath a tracking-configuration fold
   * and a rail. Two disclosures and a scroll to reach the primary verb of the
   * section.
   *
   * The verb now sits beside the heading, which is the whole of the fix; the
   * writer, the validator, the lineage rule and the label are all untouched
   * (`addContinuityState()` is called with exactly the arguments it was called
   * with before). Chain automation stays behind "Advanced state tools" — that IS
   * the parent-first tooling the finding asks to demote — and continuity tracking
   * keeps its own closed fold but moves BELOW the state it configures, so it no
   * longer stands between a filmmaker and the list of states.
   *
   * The tracking fold deliberately stays a VISIBLE closed disclosure rather than
   * being nested inside "Advanced state tools": tests/continuity-workflow-real-browser.py
   * step 14 waits for `.continuity-tracking` to be visible and clicks it open, and
   * burying it inside a second closed fold would make it unreachable. */
  return `<details class="fold continuity-states" data-entity-continuity="${attr(list + ":" + it.id)}" ${workspaceSectionOpen(sectionKey, true) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(sectionKey)}',this.open)"><summary>Continuity states <span>${states.length}</span></summary><div class="continuity-states-lead"><div><b>${states.length === 1 ? "Default only" : `${states.length} states`}</b><small>A persistent story variant — glasses on, wet, damaged, older. Add one only when the story needs it.</small></div><button class="add-btn" onclick="addContinuityState('${list}','${it.id}')">+ Add continuity state</button></div>${rail}<div class="continuity-state-list bounded-single-state">${editor}</div><details class="state-chain-tools"><summary><span>Advanced state tools</span><small>Automate several states parent-first</small></summary>${typeof entityChainAutomationPanel === "function" ? entityChainAutomationPanel(list, it) : ""}</details>${continuityTrackingPanel(list, it)}</details>`;
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
/* AT1-E — REMOVING A STATE THAT HOLDS CANON REVOKES THE RECEIPT FIRST.
 *
 * THE DEFECT, AND IT STRANDED THE DOCUMENT. applyStateDeletion() splices the
 * state out of `continuityStates`. That is a structural operation and it knows
 * nothing about the authority ledger, so deleting a non-default state that held
 * CURRENT Canon took its EDGE away with the record and left the RECEIPT saying
 * `status: "current"` about a target that no longer existed. The write seam
 * compares the two on every save, found a declared Canon edge with no matching
 * receipt, and refused the transition with AUTHORITY_EDGE_RECEIPT_MISMATCH
 * (authority-write-seam.js). The refusal is correct — that is the seam doing
 * exactly its job — but the document could not be saved afterwards at all, so
 * every UNRELATED edit made in the same session was stuck behind a receipt the
 * filmmaker had no way to see or withdraw. Reload was the only exit.
 *
 * THE SEQUENCE, AND IT IS THE ONE THE SHOT SIDE ALREADY USES.
 * revokeShotCanonForRemoval() in public/mutations.js is the accepted template
 * for exactly this situation, and this is that function for entity states:
 *
 *   1. PLAN the deletion. Nothing is revoked for a removal that will not happen.
 *      A state with children, or the default state, is REFUSED by the planner —
 *      revoking first and discovering that second would withdraw a filmmaker's
 *      approval and then leave the state sitting there without it.
 *   2. For each state that will actually be removed and that holds current human
 *      authority, revoke through the canonical writer. No receipt is edited, no
 *      ledger row is deleted, and no check is bypassed: revokeEntityStateCanon()
 *      is the kernel's own command and it validates the ledger before and marks
 *      the row `revoked` with provenance.
 *   3. Only then remove the state.
 *
 * `reason: "target-removed"` and `clearEdge: false`, both matching the shot-side
 * call and both load-bearing. The target is being REMOVED, not cleared — the
 * kernel's revocation vocabulary distinguishes those — and clearing an edge on a
 * record that is about to be spliced out would be a write with no reader.
 *
 * NO `await` ANYWHERE IN THIS PATH. revokeCanon() requires the trusted gesture to
 * be the event currently dispatching, and a suspension would end it partway
 * through, leaving some states revoked and others not.
 *
 * IF THE REVOCATION IS REFUSED, NOTHING IS REMOVED. The state keeps its Canon,
 * the project stays consistent, and the refusal is recorded where the filmmaker
 * pressed rather than only in a toast that clears itself. */
function revokeEntityStateCanonForRemoval(list, entity, stateIds) {
  if (typeof hasCurrentHumanAuthority !== "function" || typeof revokeEntityStateCanon !== "function") return;
  const at = new Date().toISOString();
  for (const stateId of stateIds) {
    const target = authorityTarget({ kind: "entity-state", list, entityId: entity.id, stateId });
    if (!target || !hasCurrentHumanAuthority(P, target)) continue;
    revokeEntityStateCanon(P, {
      list, entityId: entity.id, stateId,
      at, via: "confirmed-target-removal", reason: "target-removed", clearEdge: false,
    });
  }
}
window.removeContinuityState = (list, id, i) => {
  const x = P[list].find((e) => e.id === id);
  const state = x?.continuityStates?.[i];
  if (!state) return;
  const refusalKey = `continuity-state:${list}:${id}:${state.id}`;
  clearActionRefusal(refusalKey);
  /* PLANNED FIRST, so authority is only withdrawn for a removal that is going to
     happen. The planner is pure and applyStateDeletion() runs it again. */
  const planned = planStateDeletion(x.continuityStates, state.id, { dirty });
  if (planned.remove === true) {
    try {
      revokeEntityStateCanonForRemoval(list, x, planned.removedIds || [state.id]);
    } catch (error) {
      /* The state still holds its Canon and is still here. Say so where the
         filmmaker pressed, and change nothing. */
      recordActionRefusal(refusalKey, error.message || "That state's approval could not be withdrawn, so it was not removed.", error.code || "");
      route();
      return toast(error.message || "That state could not be removed");
    }
  }
  const outcome = applyStateDeletion(x.continuityStates, state.id, { dirty });
  if (!outcome.applied) {
    /* AT1-G. Every one of these was a toast and only a toast: the filmmaker
       pressed ×, the row stayed, and 2.2 seconds later the reason was gone. The
       sentences are unchanged — they were already the truthful ones — and they
       now stay beside the state they are about. */
    const refuse = (message) => {
      recordActionRefusal(refusalKey, message, `state-deletion:${outcome.reason || "refused"}`);
      route();
      return toast(message);
    };
    if (outcome.reason === "default-state-is-the-root") return refuse("The base state remains available for every continuity record");
    if (outcome.reason === "has-children") {
      const names = outcome.children
        .map((childId) => (x.continuityStates.find((row) => row && row.id === childId) || {}).name || childId)
        .join(", ");
      const many = outcome.children.length !== 1;
      return refuse(
        `${state.name || "This state"} cannot be removed while ${many ? "these states derive" : "another state derives"} from it: ${names}. `
        + `Remove ${many ? "them" : "it"} first. A state's derivation is chosen when it is created and CineBraid will not re-point it.`,
      );
    }
    return refuse("That state could not be removed.");
  }
  route();
};
window.requestHumanEntityCandidateApproval = (list, id, fileName, stateId = "state-default", continuation = "entity") => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return toast("Candidate is unavailable");
  const row = entityCandidateRow(entity, fileName, false) || {};
  if (continuation === "coverage") return approveCoverageCandidate(list, id, fileName, row.targetCoverageSlotId, true);
  /* THE INTENT TRAVELS THE LAST HOP. This card already decided which operation
     the filmmaker pressed — the button reads USE AS SHEET SOURCE and sets
     `extract` — and that answer used to stop here, leaving the modal to guess
     from the file's classification. Guessing turns an eligibility failure into a
     workflow; naming the mode does not. */
  if (continuation === "extract") return approveEntityFile(list, id, fileName, stateId, "sheet-source");
  return approveEntityFile(list, id, fileName, stateId, "primary-authority");
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
/* CORRECTION 1 — THE WORD "REQUIRED" MEANS THE PRODUCTION REQUIRES IT NOW.
 *
 * The first pass at R7 kept the structural answer as the STATE and softened only
 * the tone and the wording, so a fresh character's views read
 * `data-slot-state="required-missing"` / "Required — not needed yet" / pending —
 * a fifth semantic state that told the filmmaker Required, Planned, Not needed
 * and Not-attention-worthy in one chip. The display contract has four states and
 * only one of them is an attention state; this is the join that keeps it to four.
 *
 * TWO QUESTIONS, TWO OWNERS, AND ONLY ONE OF THEM IS USER-FACING HERE:
 *
 *   STRUCTURAL   coverageRequirement() over requirementTrace(). What the project's
 *                coverage plan declares, seeded by coverageTemplateForList(). It is
 *                UNCHANGED and is still what coverage automation reads through
 *                isRequiredCoverage() — see missingCoverageSlots(), coverageRunSlots()
 *                and coverageSheetSlots(), none of which call this function.
 *   EFFECTIVE    that answer softened by current production truth, through
 *                referenceDemandResolution() — the one function permitted to soften
 *                it, and only ever toward claiming LESS.
 *
 * So a structurally required target the production is not waiting on is displayed
 * as PLANNED, in the vocabulary that already exists for exactly that: real
 * material, listed and reachable, that nothing is owed on. "Required — missing"
 * survives for the case where it is true, and for the case where the demand answer
 * cannot be obtained at all, because failing closed means keeping work visible.
 *
 * `demand` is optional. Without it this returns exactly what it returned before
 * the join existed, which is what keeps every one-argument caller honest. */
function effectiveReferenceRequirement(item, demand = null, options = {}) {
  const isDefault = options.isDefault === true;
  const requirement = referenceRequirement(item, isDefault);
  /* The primary reference is the identity. It is not softened by anything: an
     entity that exists has a main approved image as its own requirement. */
  if (requirement !== "required" || isDefault || !demand) return requirement;
  const family = options.family === "state" ? "state" : "coverage";
  const resolved = referenceDemandResolution(
    { family, id: String(item?.id || ""), tier: "required", requirement: "required", satisfied: false },
    demand.production, obligationStateIds(demand.obligations));
  return resolved.state === "required-now" ? "required" : "planned";
}
/* The same answer as a word, through the same label owner the structural
   requirement uses, so there is one vocabulary and not two. */
function effectiveRequirementLabel(item, demand = null, options = {}) {
  return requirementLabel({ requirement: effectiveReferenceRequirement(item, demand, options) });
}
function referenceSlotStatus(slot, demand = null) {
  /* S7 — "Selected", never "Approved". A slot holding a file is a supporting
     reference the creator chose; the word that used to be here is the one every
     downstream surface read as production truth. */
  /* FOUR ANSWERS, AND ALL FOUR ARE ALREADY HERE. This function has distinguished
     them since Slice 3; what did not survive the trip to the screen was the
     DIFFERENCE. `.coverage-slot-state` had one rule — `color:var(--muted)` — so
     Planned, Not required and Missing printed identical grey, and the slot rail
     defined dots only for `tone-complete` and `tone-attention`, leaving pending
     and optional on the same fallback grey. A filmmaker reading the board could
     not tell a view the production is waiting on from one it will never need.
     `state` is the machine token the markup and the tests key on; `tone` stays
     the styling hook it already was, and `label` stays the filmmaker's word —
     "Selected", never "Approved", for the reason S7 gives below. */
  if (slotSelectedFile(slot)) return { state: "satisfied", tone: "complete", label: "Selected" };
  const requirement = effectiveReferenceRequirement(slot, demand);
  if (requirement === "not-required") return { state: "optional", tone: "optional", label: "Not required" };
  if (requirement === "planned") return { state: "planned", tone: "pending", label: "Planned" };
  return { state: "required-missing", tone: "attention", label: "Required — missing" };
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
/* R7 — TWO AXES, AND THE BOARD NOW SAYS WHICH ONE IT IS SPEAKING.
 *
 * The human pass read "No shot uses this character yet, so nothing is required
 * now" at the top of the screen and "Required — missing" on four slots below it,
 * and concluded — reasonably — that the app was contradicting itself.
 *
 * It was not. Those are two different questions with two different owners, and
 * both answers were correct:
 *
 *   REQUIREMENT   coverageRequirement() — what THIS PROJECT'S COVERAGE PLAN says
 *                 about the slot. Authored by the filmmaker in the "Project need"
 *                 control on the very card that prints it. `referenceSlotStatus`
 *                 reads this and nothing else, which is why it can say Required.
 *   DEMAND        referenceDemandState() over entityReferenceDemand() — whether
 *                 any shot is actually waiting on this reference right now.
 *                 Slice 5 added it BESIDE the requirement without re-filing it.
 *
 * What was missing was any sentence saying so. This is that sentence, and it
 * reads the SAME demand projection the panel above reads — handed down, not
 * resolved again — so the two surfaces are incapable of disagreeing about
 * whether the production is waiting. No state, tone, label or count changes:
 * `referenceSlotStatus` still returns exactly the four answers it returned, and
 * a required slot is still Required. */
function coveragePlanAxisNote(list, entity, production, noun = "view") {
  const kind = entityKindLabel(list).toLowerCase();
  const plan = `Mark each ${noun} Required, Planned, or Not required — that is this project's coverage plan for the reference, not a claim that a shot is waiting for it.`;
  if (production && production.known === true && production.demanded === false) {
    return `${plan} No shot uses this ${kind} yet, so nothing here is required right now.`;
  }
  return `${plan} What the production is actually waiting on is listed under What this production needs, above.`;
}
/* CORRECTION 1, THE FOLD HALF. `${approvedRequired}/${required} required approved`
   is a statement about the coverage PLAN, and a fold summary is exactly where a
   filmmaker reads a fraction as an obligation — so beside chips that now read
   Planned it said "required" about the same targets, which is the contradiction
   one level up.

   The fold counts the SAME answers the chips print, from the same function, so
   the two cannot disagree by construction. Nothing is hidden: every slot is still
   listed and `data-board-outstanding` publishes the count so a reader does not
   have to parse the sentence. */
function coverageBoardOutstanding(slots, demand = null) {
  const live = (slots || []).filter((slot) => slot && !slot.retired);
  const production = demand?.production || null;
  const states = live.map((slot) => referenceSlotStatus(slot, demand).state);
  const count = (state) => states.filter((value) => value === state).length;
  return {
    total: live.length,
    satisfied: count("satisfied"),
    outstanding: count("required-missing"),
    planned: count("planned"),
    optional: count("optional"),
    demand: production && production.known === true ? (production.demanded ? "demanded" : "dormant") : "unknown",
  };
}
function coverageBoardTally(owed, noun = "view") {
  const progress = `${owed.satisfied}/${owed.total} selected`;
  const planned = owed.planned ? ` · ${plural(owed.planned, "planned " + noun)}` : "";
  /* The word "required" appears only when something currently is. */
  return owed.outstanding
    ? `${progress} · ${plural(owed.outstanding, "required " + noun)} missing${planned}`
    : `${progress}${planned} · none needed now`;
}
function referenceRequirementSelect(value, onchange) {
  return `<select class="status-select reference-requirement-select" onchange="${onchange}"><option value="required" ${value === "required" ? "selected" : ""}>Required for this project</option><option value="planned" ${value === "planned" ? "selected" : ""}>Planned / useful later</option><option value="not-required" ${value === "not-required" ? "selected" : ""}>Not required</option></select>`;
}

function referenceSlotRailMarkup(scope, entityId, slots, selectedId, demand = null) {
  return `<nav class="bounded-slot-rail" aria-label="Reference coverage slots">${slots.map((slot) => {
    const state = referenceSlotStatus(slot, demand);
    return `<button type="button" class="tone-${state.tone} ${slot.id === selectedId ? "selected" : ""}" data-slot-state="${attr(state.state)}" onclick="selectBoundedItem('${attr(scope)}','${attr(entityId)}','${attr(slot.id)}')"><i></i><span>${esc(slot.label)}</span><small>${state.label}</small></button>`;
  }).join("")}</nav>`;
}
function expressionBoardMarkup(entity, mediaByName, media, demand = null) {
  const production = demand?.production || null;
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
  const slotState = slot ? referenceSlotStatus(slot, demand) : null;
  /* THE SELECT AUTHORS THE PLAN, so it shows and writes the STRUCTURAL answer.
     Everything else on this card describes the current state, so it shows the
     EFFECTIVE one. Two words for two questions, from one join. */
  const requirement = slot ? referenceRequirement(slot) : "planned";
  const effective = slot ? effectiveReferenceRequirement(slot, demand) : "planned";
  const editor = slot ? `<article class="coverage-slot-card focused-slot-selected ${slotSelectedFile(slot) ? "is-ready" : slotState.tone === "attention" ? "needs-attention" : ""}"><header><div><span>${esc(effectiveRequirementLabel(slot, demand).toUpperCase())} EXPRESSION</span><b>${esc(slot.label)}</b></div><span class="coverage-slot-state tone-${slotState.tone}" data-slot-state="${attr(slotState.state)}">${slotState.label}</span></header><div id="expression-slot-preview" class="coverage-slot-preview" data-slot-preview="committed">${item ? `<img src="${attr(item.url)}" alt="">` : `<div class="coverage-slot-empty">${effective === "not-required" ? "No reference needed" : "No expression selected"}</div>`}</div><div class="coverage-slot-staged-note">PREVIEWING — nothing is written to this expression until you use it</div><label><span>Project need</span>${referenceRequirementSelect(requirement, `setExpressionSlotRequirement('${entity.id}',${selected.sourceIndex},this.value)`)}</label><div class="slot-commit-row"><button type="button" class="approve-btn" onclick="openReferenceMediaChooser('characters','${attr(entity.id)}','expression',${selected.sourceIndex})">Browse visually</button><button type="button" id="expression-slot-use" class="approve-btn" disabled onclick="useExpressionSlotSelection('${attr(entity.id)}',${selected.sourceIndex})">${slotSelectedFile(slot) ? "IN USE" : "SELECT AN IMAGE"}</button><small>Choosing an image previews it above. Nothing is written to this expression until you use it.</small></div><details class="coverage-slot-filename"><summary>Choose by filename</summary><label><span>Selected file</span><select id="expression-slot-file" data-committed="${attr(slotSelectedFile(slot))}" data-slot-list="characters" data-slot-entity="${attr(entity.id)}" onchange="stageSlotSelection('expression-slot-file','expression-slot-use')">${coverageSlotOptions(media,slotSelectedFile(slot),entity)}</select></label></details><label><span>Performance notes</span><textarea placeholder="Physical expression, intensity, and what must remain unchanged." onchange="setExpressionSlotField('${entity.id}',${selected.sourceIndex},'notes',this.value)">${esc(slot.notes||"")}</textarea></label></article>` : `<div class="entity-candidate-empty"><b>No expression slots configured</b><span>Add expressions only when this project needs them.</span></div>`;
  const manual = `<div class="compact-section-actions coverage-board-actions manual-coverage-actions"><button class="approve-btn" onclick="openCoverageSheetPicker('characters','${entity.id}')">Crop expression sheet</button></div>`;
  const owed = coverageBoardOutstanding(slots.map((row) => row.slot), demand);
  const assisted = `<details class="coverage-assisted-actions" ${manualFirstWorkflow() ? "" : "open"}><summary>Optional assisted creation</summary><div class="compact-section-actions coverage-board-actions"><button class="approve-btn" onclick="openCoverageExpressionAutomation('${entity.id}')">Generate expression sheet</button></div></details>`;
  return `<details class="fold compact-entity-section entity-expression-section bounded-source-section" data-board-outstanding="${owed.outstanding}" data-board-demand="${attr(owed.demand)}" ${open ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Expression board <span>${esc(coverageBoardTally(owed, "expression"))}${active ? " · generating" : ""}</span></summary>${entityCoverageActivityMarkup("characters", entity, "expressions")}<div class="entity-coverage-intro"><div><b>${stats.approvedTotal} of ${stats.total} expressions assigned</b><small>${esc(coveragePlanAxisNote("characters", entity, production, "expression"))}</small></div></div>${referenceSlotRailMarkup("expression-slot", entity.id, slots.map((row) => row.slot), selectedId, demand)}<div class="coverage-slot-grid bounded-single-slot">${editor}</div>${manual}${assisted}</details>`;
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
/* SELECTION SELECTS. USE COMMITS.
 *
 * The dogfood report called this auto-advance; it is not. The defect is that a
 * bare `onchange` on the file dropdown WROTE THE SLOT. Opening the list, arrowing
 * through it to look at what was there, and tabbing away assigned whichever
 * option the key landed on — and when the slot was empty there was not even a
 * replace confirmation in the way, because setCoverageSlotField() only asks when
 * it is displacing an existing file.
 *
 * So the dropdown now stages, and a named button commits THROUGH THE SAME
 * WRITERS. Nothing about slot semantics moves: applyCoverageAssignment() is still
 * the one slot writer, the replace confirmation still fires on displacement, and
 * a slot is still not authoritative — see public/shared-entity-slots.js.
 *
 * Only one slot editor is on screen at a time (`bounded-single-slot`), which is
 * what makes the fixed element ids safe here. */
/* R8/R9 — STAGING THAT THE FILMMAKER CAN SEE.
 *
 * Staging without a preview is a filename and a promise. The human pass chose a
 * file, the large preview area stayed exactly as it was — blank, for an empty
 * slot — and the only way to find out what had been chosen was to commit it. So
 * the choice looked like it had not registered, and "Use this image" became a
 * guess rather than a confirmation.
 *
 * WHAT THIS DOES AND DOES NOT DO. It paints the chosen image into the preview
 * the slot already had, and it labels that state PREVIEWING. It writes nothing:
 * no slot field, no candidate row, no revision, no authority. The commit is
 * still the named button, still applyCoverageAssignment() behind it, still the
 * replace confirmation on displacement, and closing or re-selecting still leaves
 * the slot exactly as it was — which is what `data-slot-preview="committed"`
 * restores when the selection returns to the committed file.
 *
 * WHY THE MEDIA IS RESOLVED FROM THE PROJECT rather than read off the chosen
 * <option>. The select's options carry a filename, and this needs a URL. Reading
 * it back out of `P` through entityMedia() means the picture shown here is the
 * same picture every other surface would show for that name — there is no second
 * media lookup, and a name that resolves to nothing simply previews nothing
 * rather than inventing a path. `data-slot-list` / `data-slot-entity` carry the
 * scope for exactly the reason `data-committed` already carries the baseline: the
 * handler string is fixed, so the element states its own context. */
window.stageSlotSelection = (selectId, buttonId) => {
  const select = document.getElementById(selectId);
  const button = document.getElementById(buttonId);
  if (!select || !button) return;
  const committed = select.dataset.committed || "";
  const chosen = select.value || "";
  button.disabled = chosen === committed;
  button.textContent = chosen === committed
    ? (committed ? "IN USE" : "SELECT AN IMAGE")
    : chosen ? "USE THIS IMAGE" : "CLEAR THIS VIEW";
  renderStagedSlotPreview(select, chosen, committed);
};
/* The preview half, separate so the commit path and the chooser both reach the
   same renderer and there is one place that decides what "Previewing" looks
   like. Every lookup below is optional: an absent preview element is a surface
   that has none, not an error. */
function renderStagedSlotPreview(select, chosen, committed) {
  const preview = document.getElementById(String(select?.id || "").replace(/-file$/, "-preview"));
  if (!preview) return;
  const staged = chosen !== committed;
  preview.dataset.slotPreview = staged ? "staged" : "committed";
  if (!staged) return;
  const list = select.dataset.slotList || "";
  const entity = list && select.dataset.slotEntity
    ? (P[list] || []).find((row) => row && row.id === select.dataset.slotEntity)
    : null;
  const item = entity && chosen ? entityMedia(list, entity).find((row) => row.name === chosen) : null;
  preview.innerHTML = item
    ? (isVideo(item.name) ? `<video muted src="${attr(item.url)}"></video>` : `<img src="${attr(item.url)}" alt="">`)
    : `<div class="coverage-slot-empty">${chosen ? "That file is not available to preview" : "This view will be cleared"}</div>`;
}
window.renderStagedSlotPreview = renderStagedSlotPreview;
/* THE VISUAL CHOOSER — A THIRD CONSUMER OF THE ONE PROJECTION, NOT A SECOND
 * MEDIA SYSTEM.
 *
 * A filename dropdown asks a filmmaker to pick a picture by reading its name.
 * This shows the pictures. Everything it knows comes from machinery that already
 * exists and is already the single owner of its answer:
 *
 *   which media exists, and what each one IS   CineBraidMediaInspector.projection()
 *                                              — the same productionMediaRecords()
 *                                              projection Generated Media and the
 *                                              Inspector read. Nothing is re-derived.
 *   approved first, then newest                CineBraidResults.orderRecords(rows, true)
 *   rejected hidden                            CineBraidResults.tabRecords(rows, "current")
 *   how the card looks and what it claims      CineBraidResults.cardMarkup
 *   which view a candidate is FOR              the row's own `referenceView`, ranked
 *                                              by shared-reference-views.js's
 *                                              referenceViewScore() — the same scorer
 *                                              coverageReferencePackage() uses
 *
 * TWO THINGS IT REFUSES TO DO.
 *
 * It does not INVENT AUTHORITY. Picking a card stages the choice into the same
 * dropdown and the same explicit use button; the commit still goes through
 * applyCoverageAssignment(), the slot is still not authority, and closing this
 * modal without pressing use writes nothing at all.
 *
 * It does not offer a SHEET for a single view, for the reason shared-coverage.js
 * gives: a sheet is several views, and a slot holds one. */
window.openReferenceMediaChooser = (list, id, scope, index) => {
  const entity = P[list]?.find((item) => item.id === id);
  const results = window.CineBraidResults;
  const built = window.CineBraidMediaInspector?.projection?.() || null;
  if (!entity || !results || !built) return toast("The media projection is unavailable");
  const slots = scope === "expression" ? ensureExpressionSlots(entity) : ensureCoverageSlots(list, entity);
  const slot = slots[index];
  if (!slot) return toast("That view is unavailable");
  const selectId = scope === "expression" ? "expression-slot-file" : "coverage-slot-file";
  const buttonId = scope === "expression" ? "expression-slot-use" : "coverage-slot-use";
  const desired = typeof coverageSlotViewTag === "function" ? coverageSlotViewTag(list, slot) : "";
  const mine = built.records.filter((row) => row.scope === "entity"
    && row.context?.entityId?.value === id
    && row.context?.entityList?.value === list
    && !entityCandidateIsCoverageSheet(entity, row.file.name));
  /* Approved first (orderRecords), rejected gone (tabRecords), and only then
     nudged by how well each candidate matches THIS view — a stable sort, so the
     authority ordering above is never overturned by a score. */
  const ranked = results.orderRecords(results.tabRecords(mine, "current"), true);
  const scoreOf = (row) => {
    if (!desired || typeof referenceViewScore !== "function") return 0;
    const candidate = entityCandidateRow(entity, row.file.name, false) || {};
    return referenceViewScore(desired, candidate.referenceView || "", { referenceKind: "single-angle" }) || 0;
  };
  const ordered = ranked
    .map((row, position) => ({ row, position, score: scoreOf(row) }))
    .sort((a, b) => (b.score - a.score) || (a.position - b.position))
    .map((entry) => entry.row);
  const cards = ordered
    .map((row) => results.cardMarkup(row, {
      action: (item) => `pickReferenceMediaForSlot('${attr(selectId)}','${attr(buttonId)}','${attr(item.file.name)}')`,
    }))
    .join("");
  openModal(`<div class="reference-media-chooser"><header><div><span>CHOOSE AN IMAGE</span><h3>${esc(slot.label || slot.id)}</h3><p>Approved media is listed first. Choosing here only selects &mdash; nothing is written to this view until you use it.</p></div><button class="cancel" onclick="closeModal()">Close</button></header>${cards
    ? `<div class="results-grid reference-media-chooser-grid" data-chooser-count="${ordered.length}">${cards}</div>`
    : `<div class="entity-candidate-empty"><b>No eligible media</b><span>Upload or generate a single-view reference for this ${esc(list === "characters" ? "character" : "reference")} first. Multi-view sheets are not offered here &mdash; extract a panel from one instead.</span></div>`}</div>`);
};
/* Staging, and only staging. The commit control this hands back to is the same
   one the dropdown drives. */
window.pickReferenceMediaForSlot = (selectId, buttonId, fileName) => {
  const select = document.getElementById(selectId);
  closeModal();
  if (!select) return;
  select.value = String(fileName || "");
  stageSlotSelection(selectId, buttonId);
};
window.useCoverageSlotSelection = (list, id, index) => {
  const select = document.getElementById("coverage-slot-file");
  if (!select) return;
  setCoverageSlotField(list, id, index, "selectedFile", select.value || "");
};
window.useExpressionSlotSelection = (id, index) => {
  const select = document.getElementById("expression-slot-file");
  if (!select) return;
  setExpressionSlotField(id, index, "selectedFile", select.value || "");
};
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
/* `options.confirmed` says the caller ALREADY carried an explicit, specific
   confirmation for this exact act — see extractCoverageCrop's "save crop & use".
   It suppresses only the generic are-you-sure below; it changes no write, and the
   REPLACE question (a different question, about displacing a view the slot
   already holds) still fires. Every other caller is untouched. */
window.approveCoverageCandidate = (list, id, fileName, slotId, directOverride = false, options = {}) => {
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
  /* THE FILMMAKER IS NOT ASKED TO CONFIRM THE SAME ACT TWICE. Pressing a button
     that names the slot and says "use it" IS the human judgment this modal was
     collecting; raising it again after that press asked the same question in
     weaker words, and until it was answered the slot the action named stayed
     empty. It still guards every caller whose gesture was NOT specific. */
  if (directOverride && options.confirmed !== true) {
    return confirmModal(`Assign ${fileName} to ${slot.label} based on human judgment? CineBraid will record that no current AI check authorized this assignment.`, replaceOrCommit, { title: "Human approval", confirmLabel: "ASSIGN VIEW" });
  }
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
function coverageBoardMarkup(list, entity, mediaByName, media, demand = null) {
  const production = demand?.production || null;
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
  const slotState = slot ? referenceSlotStatus(slot, demand) : null;
  /* Same split as the expression card above: the select authors the plan and shows
     the structural word; the header and the empty state describe now. */
  const requirement = slot ? referenceRequirement(slot) : "planned";
  const effective = slot ? effectiveReferenceRequirement(slot, demand) : "planned";
  const editor = slot ? `<article class="coverage-slot-card focused-slot-selected ${slotSelectedFile(slot) ? "is-ready" : slotState.tone === "attention" ? "needs-attention" : ""}"><header><div><span>${esc(effectiveRequirementLabel(slot, demand).toUpperCase())} SLOT</span><b>${esc(slot.label)}</b></div><span class="coverage-slot-state tone-${slotState.tone}" data-slot-state="${attr(slotState.state)}">${slotState.label}</span></header><div id="coverage-slot-preview" class="coverage-slot-preview" data-slot-preview="committed">${mediaItem ? (isVideo(mediaItem.name) ? `<video muted src="${attr(mediaItem.url)}"></video>` : `<img src="${attr(mediaItem.url)}" alt="">`) : `<div class="coverage-slot-empty">${effective === "not-required" ? "No reference needed" : "No reference selected"}</div>`}</div><div class="coverage-slot-staged-note">PREVIEWING — nothing is written to this view until you use it</div><label><span>Project need</span>${referenceRequirementSelect(requirement, `setCoverageSlotRequirement('${list}','${entity.id}',${selectedIndex},this.value)`)}</label><div class="slot-commit-row"><button type="button" class="approve-btn" onclick="openReferenceMediaChooser('${attr(list)}','${attr(entity.id)}','coverage',${selectedIndex})">Browse visually</button><button type="button" id="coverage-slot-use" class="approve-btn" disabled onclick="useCoverageSlotSelection('${attr(list)}','${attr(entity.id)}',${selectedIndex})">${slotSelectedFile(slot) ? "IN USE" : "SELECT AN IMAGE"}</button><small>Choosing an image previews it above. Nothing is written to this view until you use it.</small></div><details class="coverage-slot-filename"><summary>Choose by filename</summary><label><span>Selected file</span><select id="coverage-slot-file" data-committed="${attr(slotSelectedFile(slot))}" data-slot-list="${attr(list)}" data-slot-entity="${attr(entity.id)}" onchange="stageSlotSelection('coverage-slot-file','coverage-slot-use')">${coverageSlotOptions(media, slotSelectedFile(slot), entity)}</select></label></details>${slotSelectedFile(slot) ? `<div class="approval-provenance-note">Supporting reference${String(slot.provenance?.source || "").includes("human") ? " chosen by you" : ""} — context for generation, not production truth.</div>` : ""}<label><span>Notes</span><textarea placeholder="When to use this slot, framing constraints, or what makes this view the right one to approve." onchange="setCoverageSlotField('${list}','${entity.id}',${selectedIndex},'notes',this.value)">${esc(slot.notes || "")}</textarea></label></article>` : `<div class="entity-candidate-empty"><b>No coverage slots configured</b><span>Add only the views this project actually needs.</span></div>`;
  const manualActions = `<div class="compact-section-actions coverage-board-actions manual-coverage-actions"><button class="approve-btn" onclick="openImportedReferenceMapper('${list}','${entity.id}')">Map imported references</button><button class="ghost-btn" onclick="openCoverageSheetPicker('${list}','${entity.id}')">Crop reference sheet</button><button class="add-btn" onclick="addCoverageSlot('${list}','${entity.id}')">+ Add custom slot</button></div>`;
  const assistedActions = `<details class="coverage-assisted-actions" ${manualFirstWorkflow() ? "" : "open"}><summary>Optional assisted creation</summary><div class="compact-section-actions coverage-board-actions"><button class="approve-btn" onclick="openCoverageAutomationModal('${list}','${entity.id}','hybrid')">Generate missing angles</button></div></details>`;
  const owed = coverageBoardOutstanding(slots, demand);
  return `<details class="fold compact-entity-section entity-coverage-section bounded-source-section" data-board-outstanding="${owed.outstanding}" data-board-demand="${attr(owed.demand)}" ${open ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary>Coverage board <span>${esc(coverageBoardTally(owed))}${active ? " · generating" : ""}</span></summary>${entityCoverageActivityMarkup(list, entity, "angles")}${assignmentNotice}<div class="entity-coverage-intro"><div><b>${stats.approvedTotal} of ${stats.total} views assigned</b><small>${esc(coveragePlanAxisNote(list, entity, production))} Imported references can fill slots directly; generation is optional.</small></div></div>${referenceSlotRailMarkup("coverage-slot", `${list}:${entity.id}`, slots, selectedId, demand)}<div class="coverage-slot-grid bounded-single-slot">${editor}</div>${manualActions}${assistedActions}</details>`;
}



/* ===========================================================================
   BATCH 2 · SLICE 3 — THE REFERENCE REFRAME.

   PRIMARY REFERENCE  ->  WHAT THIS PRODUCTION NEEDS  ->  DETAILS & HISTORY.

   This is a presentation change over accepted Production Truth. It moves no
   authority, adds no persisted field, and re-decides nothing:

     * Canon / Reference / Historic still come from entityStateTruth(), which
       still comes from entityProductionTruth(). This file asks; it never judges.
     * Whether a coverage slot is REQUIRED is still coverageRequirement()'s
       answer alone, and an unspecified slot still reads as required. Slice 3
       relabels and re-orders that answer; it does not change it. The projection
       used below is shared-coverage.js's own coverageDemand(), which is a pure
       function of requirementTrace().
     * A continuity state's parent is still whatever the state RECORDS. Nothing
       here guesses one, and offering the generate action writes nothing.

   What actually changed is which question the default screen asks first. It
   used to be "here are four equal filing cabinets"; it is now "here is your
   approved primary reference, and here is what this production still needs".
   =========================================================================== */

const ENTITY_KIND_LABELS = { characters: "Character", locations: "Location", props: "Prop", vehicles: "Vehicle", audio: "Audio reference" };
function entityKindLabel(list) { return ENTITY_KIND_LABELS[list] || "Reference"; }

/* AN ENTITY ID IS NOT AN ENTITY IDENTITY.

   A project may legitimately carry the same id in more than one collection —
   nothing forbids a character and a prop both called PARCEL — so `id` alone
   names a string, not a thing. shared-entities.js has always known this: it
   de-duplicates dependency rows on `${resolvedType}:${rawId}` and hands every
   row its resolved `type`. The composite is the identity; the id is half of it.

   This is the complete existing vocabulary rather than a new one: `type` is the
   value shotDependencyRecords() already resolves (including narrowing a
   `prop-or-vehicle` request to whichever collection actually holds the entity),
   and the pair below is the same key that module keys its own `seen` map on. */
const ENTITY_DEPENDENCY_TYPES = {
  characters: "character",
  locations: "location",
  props: "prop",
  vehicles: "vehicle",
  audio: "audio",
};
/* "" for anything unrecognised, which is what makes an unknown collection
   answer NOTHING rather than guessing a neighbouring one: no dependency row
   carries an empty type, so nothing can match. */
function entityDependencyType(list) {
  return ENTITY_DEPENDENCY_TYPES[String(list || "")] || "";
}

/* HOW MUCH THIS PRODUCTION ACTUALLY USES THIS REFERENCE.

   Section C asks the default screen to justify coverage by the actual
   production rather than by what the schema can imagine. The only production
   fact available at this slice — Slice 5 owns declared shot routes and must not
   be pre-implemented — is which shots already depend on this entity, and that
   question already has exactly one owner: shared-entities.js's
   shotDependencyRecords(). It is asked here, never re-derived: scanning
   `s.characters` locally would be a second dependency resolver, and the whole
   point of that module is that there is only one.

   THE DEFECT THIS NOW REFUSES (Codex acceptance, Slice 3). This matched
   `String(row.id) === wanted` and ignored `row.type`, so a shot that referenced
   only the CHARACTER `X` made the PROP `X` and the LOCATION `X` each report
   "Used by 1 shot in this production" on their own default Reference surface.
   The first line a filmmaker read about a reference was a claim about a
   different entity that happened to share a name.

   Both halves of the identity are required now, and `resolved` still is too: a
   shot naming an id the project does not have is an unresolved dependency, not
   a use of anything.

   This is CONTEXT, not requirement. Nothing here lets a shot count change what
   coverageRequirement() answers. */
function entityProductionUse(list, entity) {
  const shots = Array.isArray(P.shots) ? P.shots : [];
  const wanted = String((entity && entity.id) || "");
  const type = entityDependencyType(list);
  /* `known: false` for a collection this build does not recognise. The surface
     then says nothing about usage, which is the honest answer — claiming "no
     shot references this yet" would be an assertion nothing supports. */
  if (!wanted || !type || typeof shotDependencyRecords !== "function") return { shots: 0, total: shots.length, known: false };
  let used = 0;
  for (const shot of shots) {
    if (shotDependencyRecords(P, shot).some((row) => row.resolved && row.type === type && String(row.id) === wanted)) used += 1;
  }
  return { shots: used, total: shots.length, known: true };
}

/* The primary reference, resolved through the SAME standing every other surface
   on this page reads. `entity.approvedFile` is deliberately not consulted: a raw
   pointer is historic until a receipt says otherwise, and that distinction is
   what MB-PT-02 exists to keep. */
function entityPrimaryStanding(list, entity) {
  const states = entityStateListRead(entity, true);
  const primary = states.find((state) => state.isDefault) || states[0] || null;
  const truth = entityStateTruth(list, entity);
  const standing = primary ? truth.of(primary) : { standing: "missing", file: "" };
  return { primary, primaryId: (primary && primary.id) || "state-default", states, standing: standing.standing, file: standing.file, isCanon: standing.standing === "canon" };
}

/* SECTION A — the surface that opens when a filmmaker opens a reference.

   Three facts and one action, in that order: what the approved primary IS,
   whether one is still needed, and the single most useful next thing. Deliberately
   NOT here: the provenance table, the coverage matrix, the generation records and
   the approval machinery. All four remain one click away and none of them leads. */
function referencePrimaryHeroMarkup(list, entity, media, mediaByName, activeCandidates) {
  if (list === "audio") return "";
  const it = entityPrimaryStanding(list, entity);
  const heroMedia = it.file ? mediaByName.get(it.file) : null;
  const kind = entityKindLabel(list).toLowerCase();
  const candidates = activeCandidates.length;
  const use = entityProductionUse(list, entity);
  const band = it.isCanon ? "PRIMARY REFERENCE · CANON" : it.file ? "PRIMARY REFERENCE · NOT APPROVED" : "PRIMARY REFERENCE NEEDED";
  /* Every count and every filename lives in this sentence rather than on a
     button, so the action labels below stay fixed. A button label that grows a
     new variant per file, per count and per state is how an app ends up with a
     vocabulary nobody can keep consistent, and tests/current-behavior.js budgets
     exactly that. */
  const line = it.isCanon
    ? `${esc(it.file)} is the approved primary reference for this ${esc(kind)}.${candidates ? ` ${plural(candidates, "candidate")} still waiting for your decision.` : ""}`
    : it.file
      ? `${esc(it.file)} is on this ${esc(kind)} but has never been approved. Approve it to make it the image every shot uses.`
      : media.length
        ? `Nothing is approved yet. Choose which of the ${plural(media.length, "file")} on this reference is the primary.`
        : `No reference material has been added yet.`;
  /* THE NEXT ACTION, derived from the standing above and from nothing else.
     There is no second readiness opinion here: each branch is a direct
     consequence of the canon/historic/missing answer already resolved. */
  const next = !media.length
    ? { label: `Upload reference files`, hint: `Add existing images or video from disk`, run: `document.getElementById('entity-file').click()`, primary: true }
    : !it.file
      ? { label: `Choose the approved primary`, hint: `Pick from the files already on this reference`, run: `approveEntityFile('${attr(list)}','${attr(entity.id)}','','${attr(it.primaryId)}')`, primary: true }
      : !it.isCanon
        ? { label: `Approve as primary reference`, hint: `Make this the image every shot uses`, run: `approveEntityFile('${attr(list)}','${attr(entity.id)}','${attr(it.file)}','${attr(it.primaryId)}')`, primary: true }
        : candidates
          ? { label: `Review candidates`, hint: `Waiting for your decision, below`, run: `document.querySelector('.entity-candidate-section')?.scrollIntoView({behavior:'smooth',block:'start'})`, primary: false }
          : { label: `See what this production needs`, hint: `Required views, states and variants`, run: `selectBoundedTask('entity-task','${attr(list + ":" + entity.id)}','coverage')`, primary: false };
  const usage = use.known
    ? (use.shots ? `Used by ${plural(use.shots, "shot")} in this production.` : `No shot references this ${esc(kind)} yet.`)
    : "";
  /* WHAT THIS IMAGE STANDS FOR. The state it is the image of, plus any view it
     was selected for -- the same edges the candidate cards print as `usedFor`,
     read here from the records that hold them rather than restated. */
  const heroStates = typeof entityStateListRead === "function" ? entityStateListRead(entity, true) : [];
  const heroState = heroStates.find((state) => state.id === it.primaryId) || heroStates.find((state) => state.isDefault) || null;
  const heroSlots = typeof ensureCoverageSlots === "function" ? ensureCoverageSlots(list, entity) : (entity.coverageSlots || []);
  const heroViews = it.file ? heroSlots.filter((slot) => !slot.retired && slotSelectedFile(slot) === it.file) : [];
  const roleLine = [heroState ? heroState.name || heroState.id : "", ...heroViews.map((slot) => slot.label || slot.id)]
    .filter(Boolean).join(" · ");
  /* AND WHAT IS STILL OUTSTANDING AFTERWARDS. Deliberately not phrased as a
     consequence of the decision above: approving a primary does not fill a view
     that has no image, and saying "after this" would imply it did. */
  const heroMissing = heroSlots.filter((slot) => !slot.retired
    && referenceRequirement(slot) === "required" && !slotSelectedFile(slot));
  /* CORRECTION 3 — AND IT SAYS SO IN THE WORDS THE REST OF THE PAGE USES.
   *
   * This line named the STRUCTURAL coverage plan and called it "still needed", so
   * the top of the reference read "Views still needed: Front, 3/4 front, Profile"
   * over a board whose every chip said Planned, a fold that said "none needed now"
   * and a strip that said NEEDED NOW · None. Last surface, same contradiction.
   *
   * WHAT THE PLAN CONTAINS IS UNCHANGED. `heroMissing` is still the structural
   * answer — coverageRequirement() over the slots the template seeded — and the
   * same views are still named, in the same order, up to the same three. Only the
   * sentence around them moves, and it moves by asking the presentation owner the
   * boards, the strip and the automation dialog already ask:
   * effectiveReferenceRequirement() over entityDemandContext(). No demand is
   * inferred here and no set is re-derived.
   *
   * The count in the attention branch stays `heroMissing.length` so that sentence
   * is byte-identical to the one that shipped: where the demand answer cannot be
   * obtained the hero keeps its warning, because cannot-prove-safe is not
   * known-no-demand. */
  const heroDemand = entityDemandContext(list, entity);
  const heroOwed = heroMissing.filter((slot) => effectiveReferenceRequirement(slot, heroDemand) === "required").length;
  const heroNames = `${heroMissing.slice(0, 3).map((slot) => esc(slot.label || slot.id)).join(", ")}${heroMissing.length > 3 ? ` and ${heroMissing.length - 3} more` : ""}.`;
  const remainingLine = !heroMissing.length
    ? ""
    : heroOwed
      ? `${pluralWord(heroMissing.length, "View", "Views")} still needed: ${heroNames}`
      : `${pluralWord(heroMissing.length, "Planned view", "Planned views")}: ${heroNames}`;
  return `<section class="reference-primary-hero ${it.isCanon ? "is-canon" : it.file ? "is-historic" : "is-missing"}" data-primary-standing="${attr(it.standing)}"><div class="reference-primary-visual">${heroMedia
    ? `<button type="button" class="reference-primary-preview" onclick="inspectMediaFile('${attr(encodeURIComponent(heroMedia.url))}','${attr(heroMedia.assetId || "")}','${attr(encodeURIComponent(`${entity.name || entity.id} primary reference · ${it.file}`))}','${isVideo(heroMedia.name) ? "video" : "image"}')" aria-label="${it.isCanon ? "Inspect the approved primary reference" : "Inspect the selected but unapproved primary reference"}">${isVideo(heroMedia.name) ? `<video muted src="${attr(heroMedia.url)}"></video>` : `<img src="${attr(heroMedia.url)}" alt="">`}<span>INSPECT</span></button>`
    : `<div class="reference-primary-empty">No primary image</div>`}</div><div class="reference-primary-copy"><span>${band}</span><h2>${esc(entity.name || entity.id)}</h2>${roleLine ? `<small class="reference-primary-role">${esc(roleLine)}</small>` : ""}<p>${line}</p>${usage ? `<small class="reference-primary-usage">${usage}</small>` : ""}<div class="reference-primary-actions"><button class="${next.primary ? "approve-btn recommended" : "ghost-btn"}" onclick="${next.run}"><span>${esc(next.label)}</span><small>${next.hint}</small></button></div>${remainingLine ? `<small class="reference-primary-remaining">${remainingLine}</small>` : ""}</div></section>`;
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
  /* COUNTED THE SAME WAY, REPORTED THROUGH THE SAME GATE. The tools themselves are
     unchanged and every one of them still runs: what changes is that a dormant
     reference no longer advertises a number of outstanding required views. */
  const assistedDemand = entityReferenceDemandFor(list, entity);
  const assistedOwed = entityCurrentObligations(list, entity, assistedDemand);
  /* NOT CURRENT WORK covers both cases the tools care about: a reference no shot
     uses, and a reference whose current obligations are already settled. Either
     way the coverage below is material to build ahead, not a backlog. */
  const assistedDormant = assistedOwed.known === true && !(assistedOwed.rows || []).length;
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
  return `<details class="reference-assisted-tools" data-ui-state-key="${attr(sectionKey)}" ${open ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(sectionKey)}',this.open)"><summary><div><span>OPTIONAL ASSISTED TOOLS</span><b>Prompt building, generation, and automation</b><small>Open this only when CineBraid should help create material you do not already have.</small></div><span>${!primaryReady ? "primary first" : assistedDormant ? "optional" : assistedOwed.known === true ? plural((assistedOwed.rows || []).length, "waiting") : `${missingRequired + missingStates} missing`}</span></summary><div class="reference-assisted-tools-body"><div class="reference-creation-actions reference-creation-actions-expanded"><button class="ghost-btn" onclick="openEntityCreationSection('${attr(list)}','${attr(entity.id)}')"><span>Build primary prompt</span><small>Compile a prompt without submitting generation</small></button><button class="ghost-btn" ${primaryReady ? "" : "disabled"} onclick="openCoverageAutomationModal('${attr(list)}','${attr(entity.id)}','hybrid')"><span>Generate angle / viewpoint coverage</span><small>${assistedDormant ? `${plural(missingRequired, "view")} available to build when you want ${pluralWord(missingRequired, "it", "them")}` : missingRequired ? `${missingRequired} required view${missingRequired === 1 ? "" : "s"} remain` : "Coverage is already complete or optional"}</small></button>${expressionButton}<button class="ghost-btn" ${primaryReady ? "" : "disabled"} onclick="openContinuityStateVariantHub('${attr(list)}','${attr(entity.id)}')"><span>Generate continuity-state variant</span><small>${assistedDormant ? `${plural(missingStates, "state reference")} available to build when you want ${pluralWord(missingStates, "it", "them")}` : missingStates ? `${missingStates} state reference${missingStates === 1 ? "" : "s"} remain` : "No required state reference is missing"}</small></button></div>${assetPromptStudio(list, entity)}</div></details>`;
}
/* SECTIONS A AND B, in the order they are asked.

   The primary hero leads. The candidate grid follows IN THE SAME SURFACE, which
   is the whole of Section B: candidate review is no longer a peer stage a
   filmmaker navigates to independently of the thing being referenced, it is the
   second half of the reference that owns it. `candidatesMarkup` is passed in
   rather than rebuilt because entityPage() already resolved the disposition,
   the filters, the pagination and the ownership conflicts — building a second
   copy here is how a screen ends up disagreeing with itself about which media is
   approved, which is exactly the P4-SEM-C2 defect.

   Upload/organise and the assisted tools keep their existing markup and simply
   stop being the first thing on the page. */
function referenceWorkspaceMarkup(list, entity, context = {}) {
  const media = Array.isArray(context.media) ? context.media : [];
  const mediaByName = context.mediaByName instanceof Map ? context.mediaByName : new Map(media.map((item) => [item.name, item]));
  const activeCandidates = Array.isArray(context.activeCandidates) ? context.activeCandidates : [];
  const candidatesMarkup = typeof context.candidatesMarkup === "string" ? context.candidatesMarkup : "";
  return `${referencePrimaryHeroMarkup(list, entity, media, mediaByName, activeCandidates)}${candidatesMarkup}${referenceCreationHub(list, entity)}${referenceAssistedToolsMarkup(list, entity)}`;
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
/* R1, THE SURFACE THE FIRST PASS DID NOT REACH.
 *
 * "Made with (optional provenance)" was hidden when the project had no model
 * list of its own (public/library-tools.js, the intake modal) — and the fold
 * below, headed "Generation records — provenance", went on rendering the same
 * empty chooser one file over: a <select> whose only option was the placeholder
 * "model…". Same control, same question, same non-answer, on the reference's own
 * page rather than in a dialog. R1's rule was applied where it was reported and
 * nowhere else, which is how a vocabulary defect survives a fix.
 *
 * The rule itself is unchanged and is applied here as stated: two or more real
 * answers is a CHOICE and gets a dropdown; one recorded answer with nothing to
 * change it to is a FACT and is printed as one; nothing at all is not a control.
 *
 * NOTHING IS LOST IN EITHER DIRECTION. `made[i].model` is still written by the
 * select whenever the project has models, so the capability is untouched; and a
 * model recorded by a project whose list has since been emptied is still shown,
 * because hiding the field unconditionally would have silently swallowed a
 * provenance fact this fold exists to display. */
function entityProvenanceModelControl(list, id, index, record) {
  const models = P.meta.models || [];
  const recorded = String(record?.model || "");
  if (!models.length) {
    return recorded ? `<span class="opt-id" data-provenance-model="static">${esc(recorded)}</span>` : "";
  }
  return `<select class="status-select" data-provenance-model="choice" onchange="P['${list}'].find(x=>x.id==='${id}').made[${index}].model=this.value;dirty()"><option value="">model…</option>${models.map((m) => `<option value="${m.id}" ${recorded === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>`;
}
function entityGenerationRecordsMarkup(list, entity) {
  const id = entity.id;
  /* SECTION G. Provenance is production evidence and none of it is deleted —
     the records, their prompts, their models and their run reports are all still
     here, one click away. What changed is that a wall of prompt text no longer
     opens by default underneath the reference, which is the same progressive
     disclosure the freeze asks of the Project Bible. */
  return `<details class="fold compact-entity-section"><summary>Generation records — provenance <span>${(entity.made || []).length}</span></summary><div class="section-label">Generation record — model + prompt that made the approved files</div>${(entity.made || []).map((g,gi) => `<div class="block-row"><div class="block-row-head">${entityProvenanceModelControl(list, id, gi, g)}<input style="width:200px" placeholder="file(s)" value="${attr(g.files || "")}" onchange="P['${list}'].find(x=>x.id==='${id}').made[${gi}].files=this.value;dirty()"><span class="dur-chip">${esc(g.date || "")}</span>${g.automationRunId ? `<span class="dur-chip">AUTOMATION · ${esc(g.approval || "approved")}</span><button class="chip" onclick="copyEntityAutomationReport('${list}','${id}',${gi})">COPY RUN REPORT</button>` : ""}<button class="copy-btn" style="margin-left:auto" onclick="copyText(P['${list}'].find(x=>x.id==='${id}').made[${gi}].prompt||'')">COPY</button><button class="chip" onclick="P['${list}'].find(x=>x.id==='${id}').made.splice(${gi},1);dirty();route()">remove</button></div><textarea placeholder="the exact prompt used" onchange="P['${list}'].find(x=>x.id==='${id}').made[${gi}].prompt=this.value;dirty()">${esc(g.prompt || "")}</textarea></div>`).join("")}<button class="add-btn" onclick="(P['${list}'].find(x=>x.id==='${id}').made=P['${list}'].find(x=>x.id==='${id}').made||[]).push({model:'',files:'',prompt:'',date:new Date().toISOString().slice(0,10)});dirty();route()">+ Add generation record</button></details>`;
}
function entitySavedPromptsMarkup(list, entity) {
  const id=entity.id, prompts=entity.prompts || [];
  if (!prompts.length) return `<div class="entity-candidate-empty"><b>No saved Phase 1 prompts</b><span>Build a plate or sheet prompt from the primary creation task.</span></div>`;
  return `<details class="fold compact-entity-section"><summary>Saved Phase 1 prompts <span>${prompts.length}</span></summary>${prompts.map((pr,pi) => `<div class="block-row"><div class="block-row-head"><span class="opt-id">${esc(pr.id)}</span><button class="copy-btn" style="margin-left:auto" onclick="copyText(P['${list}'].find(x=>x.id==='${id}').prompts[${pi}].text)">COPY</button><button class="chip" onclick="P['${list}'].find(x=>x.id==='${id}').prompts.splice(${pi},1);dirty();route()">remove</button></div><div class="opt-refs" style="white-space:pre-wrap">${esc(pr.text)}</div></div>`).join("")}</details>`;
}
function entityReconciliationMarkup(list, entity) {
  const id=entity.id;
  /* R23 — the label said "SAME OBJECT AS (CANONICAL ID — FOR INSERTS/VARIANTS
     ACROSS CHATS)", which is the schema's own name for the field shouted at a
     filmmaker. The field, the writer and the datalist are unchanged; what it is
     FOR now reads as a sentence underneath instead of as a heading. */
  return `<details class="fold compact-entity-section" open><summary>Reconciliation & coverage</summary><div class="two-col">${field("Same object as", `<input list="entity-ids" value="${attr(entity.sameObjectAs || "")}" onchange="setVal('${list}','${id}','sameObjectAs',this.value)" placeholder="e.g. PROP-SPOON">`)}${field("Role (if variant)", `<input value="${attr(entity.role || "")}" onchange="setVal('${list}','${id}','role',this.value)" placeholder="e.g. insert / state B / degraded">`)}<p class="hint">Use these when one physical thing appears in the project more than once — an insert, a variant, or the same object re-created in another chat. Naming the canonical id keeps them recognisably the same object.</p></div><datalist id="entity-ids">${[...P.characters,...P.locations,...P.props,...(P.vehicles||[])].map((e)=>`<option value="${attr(e.id)}">`).join("")}</datalist>${list === "locations" ? field("Coverage policy", `<select class="status-select" onchange="setVal('${list}','${id}','coveragePolicy',this.value)">${["","locked-setup-only (reuse the plate, never re-angle)","re-frame-safe (generic geometry)"].map((o)=>`<option value="${attr(o)}" ${entity.coveragePolicy===o?"selected":""}>${esc(o||"— unset —")}</option>`).join("")}</select><div class="hint">New framings are derived from the original locked plate, never from a derivation.</div>`) : ""}</details>`;
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
  /* SLICE 3: this task absorbed the candidate grid, so it also absorbed the
     signal the retired `review` task used to carry. Without this, a reference
     with an approved primary and three candidates waiting would report a flat
     "complete" and the waiting work would be invisible on the taskbar — the
     information the reframe is supposed to surface, lost by the reframe. The
     primary question still comes first: nothing is "needs review" while the
     primary itself is still missing. */
  if (taskId === "reference") {
    if (!primary) return {tone:"attention",label:STAGE_STATUS.incomplete,note:list === "audio" ? "no approved recording yet" : "no approved image yet"};
    return activeCandidates.length
      ? {tone:"attention",label:STAGE_STATUS.needsReview,note:`${plural(activeCandidates.length, "candidate")} to choose from`}
      : {tone:"complete",label:STAGE_STATUS.approved};
  }
  /* Retired as a peer stage, kept as an answerable id: legacyMap resolves a
     stored `review` onto `reference`, and focused-workspaces.js may still ask
     about it. Returning the candidate count keeps that answer truthful. */
  if (taskId === "review") return activeCandidates.length ? {tone:"attention",label:STAGE_STATUS.needsReview,note:`${plural(activeCandidates.length, "file")} to choose from`} : {tone:"optional",label:STAGE_STATUS.nothingWaiting};
  if (taskId === "coverage") {
    const coverage = coverageStats(ensureCoverageSlots(list,entity));
    const expressions = list === "characters" ? coverageStats(ensureExpressionSlots(entity).filter((slot)=>!slot.retired)) : {missingRequired:0};
    const missingStates = states.filter((state)=>!state.isDefault && referenceRequirement(state) === "required" && taskTruth.of(state).standing !== "canon").length;
    const planned = states.filter((state)=>!state.isDefault && referenceRequirement(state) === "planned" && taskTruth.of(state).standing !== "canon").length + coverage.planned + expressions.planned;
    const active = entityCoverageActiveJobs(list,entity.id,"angles").length + (list === "characters" ? entityCoverageActiveJobs("characters",entity.id,"expressions").length : 0);
    const missing = coverage.missingRequired + expressions.missingRequired + missingStates;
    /* THE SAME DEMAND GATE THE PANEL BELOW APPLIES. The taskbar used to read the
       requirement count straight off the slot template, so a reference no shot had
       cast reported "Incomplete · 8 required views missing" — the fake backlog,
       stated in the one place a filmmaker reads before opening anything. The
       requirement is unchanged and the panel still lists every item; what the strip
       stops doing is calling a dormant capability outstanding work. */
    const demanded = entityReferenceDemandFor(list, entity);
    const obligations = entityCurrentObligations(list, entity, demanded);
    const owed = obligations.known === true ? (obligations.rows || []).length : null;
    const kind = entityKindLabel(list).toLowerCase();
    if (active) return {tone:"active",label:STAGE_STATUS.running};
    /* THE STRIP COUNTS OBLIGATIONS, NOT SLOTS, and it counts the same ones the
       panel does. It used to read `missing` — the coverage template — so an
       entity whose Canon already satisfied every readiness requirement still read
       "Incomplete · 8 required views missing" while Production said MARK SHOT
       FINAL. With no confident obligation answer the old reading stands, because
       failing closed means keeping work visible. */
    if (owed !== null) {
      if (owed) return {tone:"attention",label:STAGE_STATUS.incomplete,note:`${plural(owed, "reference decision")} waiting`};
      if (missing) return {tone:"optional",label:STAGE_STATUS.nothingWaiting,note:demanded.demanded ? `${plural(missing, "view")} available to build` : `no shot uses this ${kind} yet`};
      return planned ? {tone:"pending",label:STAGE_STATUS.inProgress,note:`${plural(planned, "view")} planned`} : {tone:"complete",label:STAGE_STATUS.complete};
    }
    return missing ? {tone:"attention",label:STAGE_STATUS.incomplete,note:`${plural(missing, "required view")} missing`} : planned ? {tone:"pending",label:STAGE_STATUS.inProgress,note:`${plural(planned, "view")} planned`} : {tone:"complete",label:STAGE_STATUS.complete};
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
/* THE ENTITY EQUIVALENT OF selectGuidedPanelTask, and it exists for the same reason.

   A cross-workspace action has to change which of the four declared entity tasks the
   bounded workspace renders, and it must do that through the SAME keys the taskbar
   reads: `boundedFocusedTask("entity-task", `${list}:${id}`, ...)` for the task, and
   `boundedWriteState` for the coverage sub-view and the selected continuity state.
   Those three writes are exactly what the shipped "open this state" control at
   entityCoverageStatesMarkup already performs; this is that incantation, named.

   It WRITES AND DOES NOT RENDER, unlike selectBoundedTask. The caller decides whether a
   navigation or a re-render follows, because assigning an unchanged hash fires no
   hashchange and would otherwise leave the selection written and the page unmoved.

   Task selection goes through boundedWriteFocusedTask, never boundedWriteState: they
   are different key namespaces and a task written through the latter is silent. */
function selectEntityResultTask(list, id, taskId, view = "", stateId = "") {
  if (!list || !id || !taskId || typeof boundedWriteFocusedTask !== "function") return "";
  const context = `${list}:${id}`;
  boundedWriteFocusedTask("entity-task", context, taskId);
  if (typeof boundedWriteState === "function") {
    if (view) boundedWriteState("selected:entity-coverage-view", context, view);
    if (stateId) boundedWriteState("selected:continuity-state", context, stateId);
  }
  return taskId;
}
window.selectEntityResultTask = selectEntityResultTask;

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
  /* THIS HEADLINE IS NOT COPY. Dogfood #2 P0 guards the word CANON here and the
     fraction it prints: an unreceipted pointer must count 0/1 and never 1/1, and
     `APPROVED IMAGES` is explicitly refused as the looser word a pointer could be
     argued into satisfying. The screenshot-review confusion this region caused was
     never the headline -- it was this headline sitting directly above a row badged
     HISTORIC on the very task whose hero states the same thing in full. That is
     fixed below, by not printing the rows twice, not by rewording the count. */
  const authorityStatus = `<b class="entity-authority-status"><strong>${approvedCount}/${states.length}</strong><span>${pluralWord(states.length, "state", "states")} with a canon image</span></b>`;
  if (selectedTask === "coverage") return `<section class="entity-authority-summary is-compact"><header><div><span class="entity-authority-label">CANON IMAGES</span>${authorityStatus}<small>Approved images for each state are chosen in the editor below.</small></div></header></section>`;
  const rows = states.map((state) => {
    const standing = stateTruth.of(state);
    const fileName = standing.file;
    const isCanon = standing.standing === "canon";
    const media = mediaByName.get(fileName);
    const candidate = fileName ? entityCandidateRow(entity, fileName, false) : null;
    /* The note describes the CURRENT standing. A cached humanApproved that no
       receipt supports reads as history, never as an approval. */
    const approvalNote = !isCanon ? (fileName ? " · Historic, not approved for production" : "")
      : candidate?.humanApprovedWithoutAI ? " · Human approved, not AI checked"
        : candidate?.humanApproved ? " · Human approved" : "";
    /* DETECT AND TELL, FOR AUTHORITY THAT WAS WRITTEN BEFORE THE GATE EXISTED.
       The kernel now refuses to make a sheet an entity's identity, but it cannot
       un-write the receipts that were minted while it could. Those are real
       decisions a person really made and they are NOT revoked here — the row
       below reads the ledger and writes nothing.
       What changes is that the entity says so. `standing` still comes from the
       one projection, so CANON still reads CANON underneath; the correction is
       reported beside it rather than in place of it, because "this is approved"
       and "this approval points at the wrong kind of image" are two facts and
       the filmmaker needs both to act. */
    const isSheet = !!(media && entityCandidateIsCoverageSheet(entity, fileName));
    const standingWord = !media ? "MISSING" : isCanon ? "CANON" : "HISTORIC";
    const correctionNote = isSheet
      ? ` · This is a coverage sheet, not a single identity view — ${isCanon ? "the approval stands, but production should not use it as identity" : "it was never approved"}`
      : "";
    const openState = `boundedWriteState('selected:entity-coverage-view','${attr(list+":"+entity.id)}','states');boundedWriteState('selected:continuity-state','${attr(list+":"+entity.id)}','${attr(state.id)}');selectBoundedTask('entity-task','${attr(list+":"+entity.id)}','coverage')`;
    /* O5: this thumbnail is an APPROVED AUTHORITY — the image that defines a
       continuity state. Inspecting it is the question a filmmaker actually has here
       ("what is this the authority for, and who approved it"), so the click opens the
       Inspector; its own Open-full-preview covers the old behaviour. */
    const previewAction = media ? `inspectMediaFile('${attr(encodeURIComponent(media.url))}','${attr(media.assetId || "")}','${attr(encodeURIComponent(`${state.name || "Default"} ${isCanon ? "canon" : "historic"} image · ${fileName}`))}','${isVideo(media.name) ? "video" : "image"}')` : openState;
    return `<article class="entity-authority-row ${media && isCanon ? "ready" : media ? "historic" : "missing"} ${isSheet?"is-sheet needs-correction":""}" ${isSheet ? `data-authority-correction="coverage-sheet" data-authority-standing="${attr(standingWord.toLowerCase())}"` : ""}><button type="button" class="entity-authority-thumb-button" onclick="${previewAction}" aria-label="${!media ? `Open ${attr(state.name || "state")}` : isCanon ? `Preview the approved ${attr(state.name || "state")} canon image` : `Preview the historic ${attr(state.name || "state")} image, which has not been approved`}"><span class="entity-authority-thumb">${media ? (isVideo(media.name) ? `<video muted src="${attr(media.url)}"></video>` : `<img src="${attr(media.url)}" alt="">`) : "—"}</span><small>${media ? "INSPECT" : "MISSING"}</small></button><button type="button" class="entity-authority-details" onclick="${openState}"><span><b>${esc(state.name || "Default")}</b><small>${fileName ? `${esc(fileName)}${esc(approvalNote)}${esc(correctionNote)}` : "No approved image yet"}</small></span><em>${isSheet?`NEEDS CORRECTION · ${esc(standingWord)}`:standingWord}</em></button>${isSheet ? `<button type="button" class="chip entity-authority-extract" onclick="openCoverageSheetExtractor('${attr(list)}','${attr(entity.id)}','${attr(fileName)}')">EXTRACT VIEWS</button><button type="button" class="chip entity-authority-replace" onclick="approveEntityFile('${attr(list)}','${attr(entity.id)}','','${attr(state.id)}')">CHOOSE REPLACEMENT</button>` : ""}</article>`;
  }).join("");
  return `<section class="entity-authority-summary"><header><div><span class="entity-authority-label">CANON IMAGES</span>${rows ? authorityStatus : `<b class="entity-authority-status"><span>No states</span></b>`}</div></header><div>${rows}</div></section>`;
}
/* SECTIONS C, E AND F — "what this production needs", in one demand list.

   THE SEMANTIC POINT, stated where an implementer will trip over it: `tier` here
   is shared-coverage.js's coverageDemand(), which is a RENAME of the answer
   coverageRequirement() already gives. required -> Required,
   planned -> Recommended, not-required -> Not currently needed. An unauthored
   slot still resolves to `required` and therefore still appears under Required,
   because Slice 3 did not change that default and must not appear to have. What
   `confirmed` records is only whether anybody ASSERTED the value — it orders the
   list and it never re-decides it.

   Three families are gathered because a filmmaker does not think of them as
   three filing systems: a missing costume state and a missing rear angle are the
   same sentence, "this production still needs a picture of that". */
function entityReferenceDemandFor(list, entity) {
  const type = entityDependencyType(list);
  if (!type || !entity || typeof entityReferenceDemand !== "function") return { known: false, demanded: false, shotIds: [], uncertain: [], total: 0 };
  return entityReferenceDemand(P, type, entity.id);
}
/* WHAT THIS PRODUCTION CURRENTLY OWES ON THIS REFERENCE.
 *
 * Read from public/app.js's entityReadinessObligations(), which filters the
 * SHIPPED readiness rows through the SAME outstanding-row predicate
 * projectSharedBlockers uses. Nothing is re-derived here and no second readiness
 * exists: this surface consumes the one that already answers for Production.
 *
 * `known: false` when the derivation is unavailable or the demand answer is
 * uncertain, and every caller below then keeps required work required. */
function entityCurrentObligations(list, entity, production) {
  if (list === "audio" || !entity || typeof entityReadinessObligations !== "function") return { known: false, rows: [] };
  return entityReadinessObligations(list, entity.id, production);
}
/* `production` is a parameter with a default rather than a lookup, because the
   panel below already has the answer and asking twice would walk every shot in
   the project a second time for a fact that cannot have changed between the two
   calls. Demand is a fact about the REFERENCE, never about a slot, so it is
   resolved once per render and handed down. */
function entityDemandRows(list, entity, production = entityReferenceDemandFor(list, entity),
  obligations = entityCurrentObligations(list, entity, production)) {
  if (list === "audio" || !entity) return [];
  const truth = entityStateTruth(list, entity);
  const rows = [];
  for (const state of entityStateListRead(entity, true)) {
    /* The default state is the primary reference, and the primary reference has
       its own surface. It is not a "need" to list beside a costume variant. */
    if (state.isDefault) continue;
    const demand = coverageDemand(state, false);
    const standing = truth.of(state).standing;
    const parentInfo = entityStateParentSummary(entity, state);
    rows.push({
      family: "state", id: state.id, label: state.name || "Continuity state",
      tier: demand.tier, confirmed: demand.confirmed, requirement: demand.requirement,
      satisfied: standing === "canon", standing,
      parentLabel: parentInfo.label,
      /* RECORDED, not guessed. A state whose parentStateId names something that
         no longer exists has `broken: true` and no parent, and it must read as
         "no parent" rather than silently borrowing the default's. */
      parentRecorded: !!parentInfo.parent,
      parentIsCanon: !!(parentInfo.parent && truth.of(parentInfo.parent).standing === "canon"),
    });
  }
  for (const slot of ensureCoverageSlots(list, entity)) {
    if (!slot || slot.retired) continue;
    const demand = coverageDemand(slot);
    rows.push({ family: "coverage", id: slot.id, label: slot.label || slot.id, tier: demand.tier, confirmed: demand.confirmed, requirement: demand.requirement, satisfied: !!slotSelectedFile(slot) });
  }
  if (list === "characters") for (const slot of ensureExpressionSlots(entity)) {
    if (!slot || slot.retired) continue;
    const demand = coverageDemand(slot);
    rows.push({ family: "expression", id: slot.id, label: slot.label || slot.id, tier: demand.tier, confirmed: demand.confirmed, requirement: demand.requirement, satisfied: !!slotSelectedFile(slot) });
  }
  /* THE SECOND AXIS, applied in ONE place over all three families, so no family
     can acquire its own idea of what "needed now" means. Every `tier` above is
     untouched: this adds a field, it does not re-file one.

     The rule itself is referenceDemandResolution(), below — one implementation,
     because the coverage board's slot chip now draws the same answer and a second
     copy of the reasoning is how the two surfaces would come to disagree again. */
  const owed = obligationStateIds(obligations);
  return rows.map((row) => {
    const resolved = referenceDemandResolution(
      { ...row, satisfied: row.family === "state" ? row.standing === "canon" : row.satisfied },
      production, owed);
    return { ...row, demandState: resolved.state, demandBasis: resolved.basis, productionDemanded: resolved.demanded };
  });
}

/* THE DEMAND CONTEXT, RESOLVED THROUGH THE TWO SHIPPED OWNERS AND NOWHERE ELSE.
 *
 * `entityCoverageStatesMarkup()` built this pair inline for the boards it renders.
 * The coverage automation dialog needs the same pair to describe its work set
 * truthfully, and a second inline copy in another file is how two surfaces come to
 * disagree — so the pair has one constructor, and public/coverage-automation.js
 * calls it rather than deriving demand of its own. It reads; it decides nothing. */
function entityDemandContext(list, entity) {
  if (list === "audio" || !entity) return { production: null, obligations: null };
  const production = entityReferenceDemandFor(list, entity);
  return { production, obligations: entityCurrentObligations(list, entity, production) };
}
window.entityDemandContext = entityDemandContext;
/* THE OBLIGATION SET, BUILT ONCE. `null` means the readiness answer is not
   available, and every reader below then leaves required work required. */
function obligationStateIds(obligations) {
  return obligations && obligations.known === true
    ? new Set((obligations.rows || []).map((row) => String(row.stateId || "")))
    : null;
}
/* ALPHA R7 — ONE IMPLEMENTATION OF "IS THIS CURRENT WORK", FOR EVERY SURFACE
   THAT DRAWS AN ANSWER TO IT.
 *
 * This is the two-step rule entityDemandRows() has run since Slice 5, lifted out
 * unchanged so the coverage board's slot chip runs the same code rather than a
 * second copy of the reasoning:
 *
 *   1. referenceDemandState() — shared-coverage.js's projection, the one function
 *      allowed to let a production fact soften a requirement, and only ever
 *      toward claiming LESS.
 *   2. the obligation gate — a row is current work only when a CURRENT PRODUCTION
 *      OBLIGATION names it. Readiness raises no requirement for a coverage or
 *      expression slot, ever, so a slot is never current work: it is the entity's
 *      coverage plan, listed, labelled and reachable, and not a claim on the
 *      filmmaker's attention. With no confident obligation answer the unsoftened
 *      state stands, because failing closed means keeping work visible.
 *
 * It re-decides nothing. `tier` and `requirement` arrive resolved and leave
 * untouched; this only says whether the production is waiting. */
function referenceDemandResolution(row, production, owed) {
  const resolved = referenceDemandState({ tier: row.tier, requirement: row.requirement }, {
    satisfied: row.satisfied === true,
    production: production || {},
  });
  if (owed && resolved.state === "required-now") {
    const isOwed = row.family === "state" && owed.has(String(row.id));
    if (!isOwed) return { state: "available", basis: row.family === "state" ? "not-currently-required" : "coverage-plan", demanded: resolved.demanded };
  }
  return { state: resolved.state, basis: resolved.basis, demanded: resolved.demanded };
}

/* AN OBLIGATION THAT HAS NO ROW OF ITS OWN.
 *
 * Readiness's obligation for `state-default` is about the PRIMARY REFERENCE, and
 * the primary reference has its own surface — entityDemandRows() deliberately
 * skips the default state so a costume variant is not listed beside it. But an
 * unconfirmed or unapproved primary IS a current decision, and the panel that
 * answers "what does this production need" must not be the one screen that omits
 * it. So it is carried as its own row, with the action that opens the surface
 * that owns it. */
function entityObligationRows(list, entity, rows, obligations) {
  if (!obligations || obligations.known !== true) return [];
  const covered = new Set(rows.filter((row) => row.family === "state").map((row) => String(row.id)));
  return (obligations.rows || [])
    .filter((row) => !covered.has(String(row.stateId || "")))
    .map((row) => ({
      family: "primary", id: String(row.stateId || "state-default"),
      label: String(row.label || entity.name || entity.id),
      tier: "required", confirmed: true, requirement: "required",
      satisfied: false, standing: row.state === "needs-decision" ? "historic" : "missing",
      demandState: "required-now", demandBasis: `readiness:${row.reason || row.state}`,
      productionDemanded: true, obligationReason: String(row.reason || ""),
      shotIds: Array.isArray(row.shotIds) ? row.shotIds : [],
    }));
}

/* SECTION F — the contextual action, and the four answers it can give.

   Only the first one generates, and it can only appear when a parent is BOTH
   recorded and canon. The other three explain the exact obstacle instead of
   offering an action that would have to guess: an unapproved parent is not a
   parent to derive from yet, an unrecorded source is a human decision
   shared-state-lineage.js refuses to make, and a satisfied need needs nothing.
   openContinuityStateVariant() writes nothing, so none of these mutates by
   being rendered or by being looked at. */
function entityDemandActionMarkup(list, entity, row) {
  const context = `${list}:${entity.id}`;
  const openState = `boundedWriteState('selected:entity-coverage-view','${attr(context)}','states');selectBoundedItem('continuity-state','${attr(context)}','${attr(row.id)}')`;
  /* The primary reference has its own stage, and it is the one that owns this
     decision. The action goes there rather than growing a second approval
     surface on this panel — the single-owning-surface line Slice 3 drew. */
  if (row.family === "primary") return `<button class="approve-btn" onclick="selectBoundedTask('entity-task','${attr(context)}','reference')">Open the primary reference</button>`;
  if (row.family === "state") {
    if (row.satisfied) return "";
    /* THE ONE DELIBERATELY DYNAMIC LABEL ON THIS SCREEN. Section F asks for
       "Use approved [parent] reference to generate [state]" verbatim, because
       naming the parent IS the reassurance — a generic "Generate" gives the
       filmmaker no way to see WHICH approved image is about to be inherited
       from. Every other action below keeps a fixed label and lets the row it
       sits in carry the identity, so the app's button vocabulary does not grow
       by one phrase per continuity state. */
    if (row.parentIsCanon) return `<button class="approve-btn" onclick="openContinuityStateVariant('${attr(list)}','${attr(entity.id)}','${attr(row.id)}')">Use approved ${esc(row.parentLabel)} reference to generate ${esc(row.label)}</button>`;
    if (row.parentRecorded) return `<button class="ghost-btn" onclick="${openState}">Approve the parent state first</button>`;
    return `<button class="ghost-btn" onclick="${openState}">Record what this state derives from</button>`;
  }
  if (row.satisfied) return "";
  const view = row.family === "expression" ? "expressions" : "coverage";
  /* Two different bounded scopes with two different context keys — the
     expression rail is keyed on the entity id alone and the coverage rail on
     `list:id`. Getting this wrong writes a selection nothing reads. */
  const scope = row.family === "expression" ? "expression-slot" : "coverage-slot";
  const scopeContext = row.family === "expression" ? entity.id : context;
  return `<button class="ghost-btn" onclick="boundedWriteState('selected:entity-coverage-view','${attr(context)}','${view}');selectBoundedItem('${scope}','${attr(scopeContext)}','${attr(row.id)}')">${row.family === "expression" ? "Open this expression" : "Open this view"}</button>`;
}

/* R6/R11 — THE SAME ROW, TWO DENSITIES.
 *
 * `compact` drops the family kicker (the summary strip above names the family
 * and the count) and lays the row out on one line. It removes NO information a
 * decision needs: the label, the status sentence, every data attribute and the
 * contextual action are all still here, which is what keeps the compact plan
 * strip a presentation of the same rows rather than a summary that hides them.
 * Only rows nobody is currently waiting on are ever drawn this way. */
function entityDemandRowMarkup(list, entity, row, options = {}) {
  const compact = options.compact === true;
  const what = row.family === "primary" ? "Primary reference" : row.family === "state" ? "Continuity state" : row.family === "expression" ? "Expression" : "View";
  /* THE PRIMARY'S OBLIGATION SAYS WHAT READINESS SAYS, in readiness's own words
     rather than in a second vocabulary invented here. */
  const status = row.family === "primary"
    ? (row.obligationReason === "historic-selection-unconfirmed" ? "Chosen but never approved — confirm it"
      : row.obligationReason === "authority-revoked-pointer-remains" ? "Its approval was withdrawn — decide again"
        : "This production is waiting on it")
    : row.satisfied
      ? (row.family === "state" ? "Canon" : "Selected")
      : row.family === "state"
      /* The parent is named HERE rather than on the button, so its identity is
         still on screen for the cases whose action label is deliberately fixed. */
      ? (row.standing === "historic" ? "Image not approved" : row.parentIsCanon ? `Derives from ${row.parentLabel}` : row.parentRecorded ? `${row.parentLabel} is not approved` : "Source not recorded — CineBraid will not guess")
      : "Nothing selected yet";
  /* R6 asks a blocker to say WHO is blocked on it. The shots are already carried
     on the obligation row by readiness — this prints them and derives nothing. */
  const shots = Array.isArray(row.shotIds) ? row.shotIds.filter(Boolean) : [];
  const because = shots.length
    ? ` — required by ${shots.length <= 2 ? shots.map((id) => `Shot ${id}`).join(" and ") : plural(shots.length, "shot")}`
    : "";
  return `<article class="entity-demand-row ${compact ? "is-compact " : ""}${row.satisfied ? "is-satisfied" : "is-open"}" data-demand-family="${attr(row.family)}" data-demand-tier="${attr(row.tier)}" data-demand-confirmed="${row.confirmed ? "1" : "0"}" data-demand-id="${attr(row.id)}"><div>${compact ? "" : `<span>${esc(what)}</span>`}<b>${esc(row.label)}</b><small>${esc(status + because)}</small></div>${entityDemandActionMarkup(list, entity, row)}</article>`;
}

/* SECTION E — what the default screen leads with, and what it declines to dump.

   Required-and-still-missing leads, because that is the only group that is an
   answer to "what does this production still need". Required-and-done,
   Recommended, and Not-currently-needed are all present, all counted, and all
   collapsed: nothing is deleted and nothing is hidden, but the schema's full
   catalogue of conceivable angles and expressions no longer arrives uninvited. */
function entityDemandMarkup(list, entity, production = entityReferenceDemandFor(list, entity),
  obligations = entityCurrentObligations(list, entity, production)) {
  if (list === "audio") return "";
  const rows = entityDemandRows(list, entity, production, obligations);
  /* THE SLICE 3 GROUPS, UNCHANGED AND STILL PUBLISHED. `tier` is the rename of
     coverageRequirement() and these four counts are what a reader — and
     tests/reference-reframe.js — may keep reading them as. Slice 5 adds a
     second axis beside them; it does not re-file the first one. */
  const required = rows.filter((row) => row.tier === "required");
  const missing = required.filter((row) => !row.satisfied);
  const covered = required.filter((row) => row.satisfied);
  const recommended = rows.filter((row) => row.tier === "recommended");
  const notNeeded = rows.filter((row) => row.tier === "not-currently-needed");
  /* SLICE 5 — WHAT IS WORK RIGHT NOW, and it is the production's answer.
     `now` is the set of CURRENT PRODUCTION OBLIGATIONS: outstanding readiness
     requirements naming this reference, plus — carried separately because the
     panel deliberately skips the default state — the obligation on the primary.
     Everything else the entity can hold is the COVERAGE PLAN. */
  const now = [...entityObligationRows(list, entity, rows, obligations), ...rows.filter((row) => row.demandState === "required-now")];
  const plan = missing.filter((row) => row.demandState === "available");
  const dormant = plan.filter((row) => row.demandBasis === "no-current-production-demand");
  const kind = entityKindLabel(list).toLowerCase();
  const headline = now.length
    ? `${plural(now.length, "required reference")} still needed`
    : dormant.length
      /* NOT "everything is covered", which would be false, and not a count of
         work, which would be the backlog this slice removes. The requirement is
         real and it is listed below; what is absent is the demand. */
      ? `No shot uses this ${kind} yet, so nothing is required now`
      : plan.length
        /* USED, AND NOT WAITING ON ANY OF THIS. The second half of the same
           defect: a reference whose Canon already satisfies every readiness
           requirement was told it owed eight references, while Production told
           the same filmmaker to mark the shot final. The plan below is real
           material and it is listed; it is not an obligation. */
        ? `Nothing is required right now — this is coverage you can build ahead`
        : required.length
          ? `Everything this production requires is covered`
          : `This production has not asked for anything beyond the primary reference`;
  /* THE USAGE SENTENCE COMES FROM THE SAME DERIVATION AS THE HEADLINE.
     This section answers "what does production need", so both halves of it read
     the demand projection rather than one reading it and the other reading the
     broader relationship count that drives the primary-reference hero. */
  const usage = production.known
    ? (production.demanded ? `Used by ${plural(production.shotIds.length, "shot")}.` : `No shot uses this ${kind} yet.`)
    : "";
  const group = (label, items, tone) => items.length
    ? `<details class="entity-demand-group tone-${tone}" data-demand-group="${attr(tone)}"><summary>${esc(label)} <span>${items.length}</span></summary><div class="entity-demand-rows">${items.map((row) => entityDemandRowMarkup(list, entity, row)).join("")}</div></details>`
    : "";
  /* WHAT LEADS, AND WHY DORMANT MATERIAL IS NOT PUT BEHIND A DISCLOSURE.
   *
   * `now` and `dormant` are mutually exclusive by construction — demand is a fact
   * about the reference, so either the production is asking for this reference's
   * material or it is not — which means exactly one of them can lead, and there is
   * never a second list competing with it.
   *
   * The first version of this collapsed the dormant list, on the reasoning that
   * Slice 3 collapses Recommended. That was the wrong reading of the audit. The
   * defect was a FALSE CLAIM OF URGENCY, not the presence of the material: a
   * filmmaker building their Project Bible before the shot list exists has a
   * reference where everything is dormant, and folding their whole workspace shut
   * answers "you owe 8 required references" with "there is nothing here". The
   * real-browser gate found this immediately — the contextual "Use approved
   * <parent> reference to generate <state>" button, which is the most useful
   * control on the screen, became unclickable behind the disclosure.
   *
   * So the list leads either way, and the HONESTY MOVES INTO THE LABEL rather than
   * into visibility: the caption says this material is Available and says when it
   * becomes required, the headline does not count a backlog, and the reference
   * strip says Nothing waiting. Recommended and Not-currently-needed keep the
   * Slice 3 treatment, unchanged, because those are statements about the
   * REQUIREMENT and this is a statement about the DEMAND. */
  /* R6/R11 — THE SUMMARY THAT REPLACES A SECOND COVERAGE BOARD.
   *
   * The human pass found this panel rendering a full-width row for Front, 3/4
   * front, Profile, Rear, Neutral, Focused, Worried and Determined — and then the
   * editable Coverage board rendering the same eight again, twenty inches further
   * down. Two full-size representations of one piece of work, and the one on top
   * could not be acted on except by scrolling to the one below.
   *
   * The counts come out of `rows` — the very array the list beneath prints — so
   * the strip and the rows cannot disagree, and there is no second walk of the
   * project to produce them. What it publishes is the shape of the plan and
   * whether anything is owed; the ONE editable slot workspace is still the
   * Coverage board, and the button goes there. */
  const familyTally = (family) => {
    const items = rows.filter((row) => row.family === family);
    return { total: items.length, satisfied: items.filter((row) => row.satisfied).length };
  };
  const views = familyTally("coverage"), expressionTally = familyTally("expression"), stateTally = familyTally("state");
  const fractions = [
    views.total ? `Views ${views.satisfied}/${views.total}` : "",
    expressionTally.total ? `Expressions ${expressionTally.satisfied}/${expressionTally.total}` : "",
    stateTally.total ? `States ${stateTally.satisfied}/${stateTally.total}` : "",
  ].filter(Boolean).join(" · ");
  const asides = [
    recommended.length ? `${recommended.length} recommended` : "",
    notNeeded.length ? `${notNeeded.length} not currently needed` : "",
  ].filter(Boolean).join(" · ");
  const summaryMarkup = `<div class="entity-demand-summary${now.length ? " has-blockers" : ""}" data-demand-summary="1" data-demand-summary-now="${now.length}"><div><span>COVERAGE</span><b>${esc(fractions || "Nothing planned beyond the primary reference")}</b>${asides ? `<small>${esc(asides)}</small>` : ""}</div><div class="entity-demand-summary-now"><span>NEEDED NOW</span><b>${esc(now.length ? plural(now.length, "required reference") : "None")}</b></div><button type="button" onclick="selectBoundedItem('entity-coverage-view','${attr(`${list}:${entity.id}`)}','coverage')">Open coverage</button></div>`;
  const leading = now.length ? now : plan;
  const leadingState = now.length ? "required-now" : plan.length ? "available" : "";
  const leadCaption = leadingState === "available"
    ? `<p class="entity-demand-lead-note">${esc(dormant.length
      ? `${referenceDemandStateLabel("available")} — this is what the production will need once a shot uses this ${kind}. None of it is required now.`
      : `${referenceDemandStateLabel("available")} — the current production is not waiting on any of this. Build it when you want broader coverage.`)}</p>`
    : "";
  /* WHICH ROWS KEEP THEIR FULL SIZE, AND WHY IT IS DECIDED BY FAMILY.
   *
   * Anything the production is waiting on is drawn full — that is R6's "only
   * actual required-now production blockers deserve expanded rows".
   *
   * When nothing is owed, the plan leads (Slice 5's rule, and the reason for it
   * is above), but a coverage or expression row is drawn compact: its only action
   * is "open this view", which is a shortcut to the board directly below, so a
   * full-width block was buying vertical space with a duplicate. A CONTINUITY
   * STATE row is drawn full whatever else is true, because its action — "Use
   * approved <parent> reference to generate <state>" — exists nowhere else on
   * this screen, and the real-browser gate has already caught one attempt to
   * make that control harder to reach. */
  const leadDensity = (row) => ({ compact: !now.length && (row.family === "coverage" || row.family === "expression") });
  return `<section class="entity-demand" data-demand-required="${required.length}" data-demand-missing="${missing.length}" data-demand-recommended="${recommended.length}" data-demand-not-needed="${notNeeded.length}" data-demand-now="${now.length}" data-demand-plan="${plan.length}" data-demand-dormant="${dormant.length}" data-demand-lead="${attr(leadingState)}" data-demand-obligations="${obligations.known === true ? "readiness" : "unknown"}" data-demand-production="${production.known ? (production.demanded ? "demanded" : "dormant") : "unknown"}"><header><div><span>WHAT THIS PRODUCTION NEEDS</span><b>${esc(headline)}</b><small>${esc(`${coverageDemandLabel("required")} material is listed first. ${coverageDemandLabel("recommended")} and ${coverageDemandLabel("not-currently-needed")} material stays available below.`)}${usage ? ` ${esc(usage)}` : ""}</small></div></header>${summaryMarkup}${leading.length ? `${leadCaption}<div class="entity-demand-rows entity-demand-open">${leading.map((row) => entityDemandRowMarkup(list, entity, row, leadDensity(row))).join("")}</div>` : `<div class="entity-demand-clear">Nothing required is outstanding.</div>`}${group(`${coverageDemandLabel("required")} · already covered`, covered, "covered")}${group(coverageDemandLabel("recommended"), recommended, "recommended")}${group(coverageDemandLabel("not-currently-needed"), notNeeded, "not-needed")}</section>`;
}

function entityCoverageStatesMarkup(list, entity, mediaByName, media) {
  /* R7 — ONE RESOLUTION OF DEMAND FOR THE WHOLE STAGE. Demand is a fact about
     the REFERENCE, so the summary panel and both boards read the same answer
     rather than each walking the project for its own copy of it. */
  /* ALPHA R7 — ONE READINESS WALK, ONE PAIR, THREE CONSUMERS. The panel resolved
     this for itself and the boards did not have it at all, which is exactly how the
     chip came to claim attention over a panel that said nothing was waiting. */
  const demand = entityDemandContext(list, entity);
  const { production, obligations } = demand;
  const views = [{id:"coverage",label:"Angles / views",render:()=>coverageBoardMarkup(list,entity,mediaByName,media,demand)}];
  if (list === "characters") views.push({id:"expressions",label:"Expressions",render:()=>expressionBoardMarkup(entity,mediaByName,media,demand)});
  views.push({id:"states",label:"Continuity states",render:()=>continuityStatesPanel(list,entity,media,demand)});
  const ids=views.map((view)=>view.id), context=`${list}:${entity.id}`;
  const fallback = entityStateListRead(entity,true).some((state)=>!state.isDefault && !state.approvedFile) ? "states" : "coverage";
  const selectedId=boundedSelected("entity-coverage-view",context,ids,fallback), selected=views.find((view)=>view.id===selectedId)||views[0];
  /* WHY THE DETAIL BOARDS ARE BEHIND A TOGGLE, AND WHY IT IS NOT A `<details>`.

     Section E says the boards must not dominate merely because the schema knows
     they can exist, so they start closed. But Slice 1's result hand-off reaches a
     specific continuity state by writing `selected:entity-coverage-view` and then
     selecting this task, and a hand-off that lands on a shut door has delivered
     the filmmaker nowhere.

     A `<details>` CANNOT KEEP THAT PROMISE HERE, and the real-browser suite is
     what proved it. app.js captureRouteViewState() records every disclosure's
     open state before a re-render and applyRouteDisclosureState() puts it back
     afterwards — deliberately, so disclosures do not snap shut under the
     filmmaker on every redraw. On a SAME-ROUTE re-render that restore overrides
     the freshly computed `open` attribute, so the hand-off wrote the right
     selection and the boards stayed closed anyway.

     So the open state is derived from the selection itself rather than from DOM
     memory: explicitly selected sub-view means open, no selection means closed,
     and the toggle writes through the same shipped key the hand-off writes. One
     fact, one home, and nothing to restore over. boundedSelected() cannot answer
     the question because it substitutes a fallback and reports the same value
     either way, which is why this reads the stored value directly. */
  const explicitView = typeof boundedReadState === "function" ? String(boundedReadState("selected:entity-coverage-view", context, "") || "") : "";
  const detailOpen = ids.includes(explicitView);
  const toggle = `<button type="button" class="entity-coverage-detail-toggle" aria-expanded="${detailOpen ? "true" : "false"}" onclick="selectBoundedItem('entity-coverage-view','${attr(context)}','${detailOpen ? "" : attr(selectedId)}')"><span>Coverage detail</span><small>Angles, expressions and continuity states</small></button>`;
  const board = detailOpen
    ? `<nav class="entity-subworkspace-tabs" aria-label="Coverage and state tools">${views.map((view)=>`<button type="button" class="${view.id===selectedId?"selected":""}" onclick="selectBoundedItem('entity-coverage-view','${attr(context)}','${attr(view.id)}')">${esc(view.label)}</button>`).join("")}</nav><div data-entity-subworkspace="${attr(selected.id)}">${selected.render()}</div>`
    : "";
  /* R23 — the reference pack lands here, with the coverage it supports, rather
     than under Details. Same renderer, same links, same writers; only its home
     changed. Collapsed, because it is supporting material and not the question
     this stage is asking. */
  const pack = list === "audio" || typeof entityPlanningMediaPanel !== "function" ? "" : `<details class="entity-details-advanced entity-reference-pack"><summary>Supporting reference pack</summary><div>${entityPlanningMediaPanel(list, entity)}</div></details>`;
  return `<section class="entity-subworkspace">${entityDemandMarkup(list, entity, production || undefined, obligations || undefined)}<section class="entity-coverage-detail" data-coverage-detail="1" data-coverage-detail-open="${detailOpen ? "1" : "0"}">${toggle}${board}</section>${pack}</section>`;
}
function entityDetailsHistoryMarkup(list, entity, extra) {
  const dangerZone = `<details class="entity-danger-zone"><summary>Advanced reference actions</summary><div><p class="hint">Deleting a reference removes it from this project. Media files remain on disk.</p><button class="danger-btn" onclick="delEntity('${list}','${entity.id}');location.hash='#/library/${list}'">Delete reference</button></div></details>`;
  /* R23 — DETAILS WAS SEVEN UNRELATED JOBS SHARING ONE SCROLL.
   *
   * Identity notes, drift notes, a blocking label, the expression-sheet builder
   * config, voice design, voice synthesis settings, an alternate voice prompt,
   * voice notes, the character reference pack, reconciliation ids, a variant
   * role and a coverage policy — all open, all at once, under a heading called
   * "Details". A filmmaker looking for the one line of design notes read eleven
   * fields to find it, most of them named in the app's internal vocabulary.
   *
   * Nothing here is deleted and no field is dropped from the record. The change
   * is which of them the screen leads with:
   *
   *   NORMAL      the identity and production notes the extra() renderer owns —
   *               the fields a filmmaker edits while writing the reference.
   *   VOICE       its own collapsed section, with the SHIPPED voice outcome word
   *               (resolveCharacterVoice) on the summary so a linked or missing
   *               voice is visible without opening it. Characters only, because
   *               nothing else has one.
   *   ADVANCED    reconciliation / canonical id / variant role, and the saved
   *               Phase 1 prompt library — reference metadata and a reusable
   *               store, neither of them a daily edit.
   *   COVERAGE    the reference pack moves out of Details entirely, to the stage
   *               that owns supporting media. Same renderer, same links, same
   *               writers; it is beside the coverage it supports now.
   *
   * HISTORY IS NOW ONLY HISTORY. The saved-prompt library was editable
   * configuration filed under History; it is a library, so it moved to Advanced.
   * What remains is the generation provenance record, which is the one thing on
   * that tab that is actually a record of what happened. */
  const voiceSection = list === "characters" && typeof voicePanel === "function"
    ? (() => {
      const outcome = typeof resolveCharacterVoice === "function" ? resolveCharacterVoice(P, entity) : null;
      const word = outcome ? (outcome.voice ? (outcome.voice.name || outcome.voice.id) : outcome.voiceId ? "reference not found" : "none linked") : "";
      return `<details class="entity-details-advanced entity-voice-section"><summary>Voice${word ? ` · ${esc(word)}` : ""}</summary><div>${voicePanel(entity)}</div></details>`;
    })()
    : "";
  const advancedSection = `<details class="entity-details-advanced"><summary>Advanced reference metadata</summary><div>${list === "audio" ? "" : entityReconciliationMarkup(list,entity)}${entitySavedPromptsMarkup(list,entity)}</div></details>`;
  const views=[
    {id:"details",label:"Details",render:()=>`<details open class="fold compact-entity-section"><summary>Identity & production notes</summary>${extra(entity)}</details>${voiceSection}${advancedSection}`},
    {id:"history",label:"History",render:()=>entityGenerationRecordsMarkup(list,entity)},
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
    ? `<section class="entity-approved-authority" data-approved-count="${approvedMedia.length}"><header><span>ALREADY IN USE</span><b>${plural(approvedMedia.length,"image")} already assigned</b><small>Each of these is attached to a view or state on this reference — every card says which. Being assigned is not the same as being approved for production. They stay here so approving or replacing one is easier to reach, not harder.</small></header><div class="entity-media entity-candidate-grid">${approvedPage.rows.map((row,i)=>entityCandidateCard(list,it,row.item,i,approvedJson,false,row)).join("")}</div>${boundedPagerMarkup("candidates",`${list}:${id}:approved`,approvedPage,"approved references")}</section>`
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
  /* SECTION B. Same grid, same approvals, same authority — named for the thing
     it belongs to. The header used to announce a production stage ("CHOOSE &
     APPROVE") that the filmmaker reached independently of the reference; it now
     says whose candidates these are, because this section renders inside the
     reference that owns them. Nothing about how an approval is made changed. */
  const candidateKind = entityKindLabel(list).toLowerCase();
  const candidatesTask = `<details class="fold compact-entity-section entity-candidate-section bounded-source-section" open><summary>Images waiting for your decision <span>${activeCandidates.length ? `${activeCandidates.length} waiting` : "none waiting"}</span></summary><header><div><span>WAITING FOR YOUR DECISION</span><b>${activeCandidates.length ? `${filteredCandidates.length} shown in ${esc(ENTITY_CANDIDATE_FILTERS.find((item)=>item.id===candidateFilter)?.label || "All")}` : "Nothing is waiting for a decision"}</b><small>${activeCandidates.length ? `Images on ${esc(it.name || it.id)} that are not assigned to a view or state yet. Choose the approved image directly by human judgment; optional AI checks stay separate and never approve on their own.` : `Every image on ${esc(it.name || it.id)} is already assigned to a view or state. Uploaded or generated images land here when they are not.`}</small></div></header>${approvedAuthorityMarkup}${ownershipMarkup}${filterMarkup}${batchPanel}<div class="entity-media entity-candidate-grid">${candidatePage.rows.length ? candidatePage.rows.map((m,i)=>entityCandidateCard(list,it,m,i,candidateJson,false)).join("") : `<div class="entity-candidate-empty"><b>${activeCandidates.length ? "No candidates in this filter" : media.length ? "No undecided candidates" : "No candidates yet"}</b><span>${activeCandidates.length ? "Choose another workflow filter." : "Upload or map another file."}</span></div>`}</div>${boundedPagerMarkup("candidates",`${list}:${id}:active:${candidateFilter}`,candidatePage,"reference candidates")}${rejectedCandidates.length ? `<details class="entity-rejected-candidates"><summary>Rejected candidates <span>${rejectedCandidates.length}</span></summary><div class="entity-media entity-candidate-grid">${rejectedPage.rows.map((m,i)=>entityCandidateCard(list,it,m,i,rejectedJson,true)).join("")}</div>${boundedPagerMarkup("candidates",`${list}:${id}:rejected`,rejectedPage,"rejected candidates")}</details>` : ""}</details>`;
  const specs = list === "audio" ? [
    {id:"reference",label:"Audio",detail:"Candidates and the approved file",render:()=>approvedTask},
    {id:"details",label:"Details & history",detail:"Mix intent, media and records",render:()=>entityDetailsHistoryMarkup(list,it,extra)},
  ] : [
    /* BATCH 2 SLICE 3 — THREE STAGES, NOT FOUR.

       `review` is gone as a peer. It was the stage a filmmaker had to navigate to
       in order to look at candidates for a reference they were already standing
       in, and it is now the second half of `reference` itself. Its id survives in
       legacyMap below, so a stored selection, a cross-surface writer, or a Slice 1
       result hand-off that still names it resolves here rather than falling back
       to an unrelated task. */
    {id:"reference",label:"Primary reference",detail:"The approved image and its candidates",render:()=>referenceWorkspaceMarkup(list,it,{media,mediaByName,activeCandidates,candidatesMarkup:candidatesTask})},
    {id:"coverage",label:"What this production needs",detail:"Required views, states and variants",render:()=>entityCoverageStatesMarkup(list,it,mediaByName,media)},
    {id:"details",label:"Details & history",detail:"Notes, provenance and records",render:()=>entityDetailsHistoryMarkup(list,it,extra)},
  ];
  const legacyMap={primary:"reference",approved:"reference",candidates:"reference",review:"reference",coverage:"coverage",expressions:"coverage",states:"coverage",planning:"details",notes:"details",reconciliation:"details",records:"details",prompts:"details"};
  const context=`${list}:${id}`, allowed=specs.map((spec)=>spec.id);
  /* SECTION A — the primary reference is where a reference opens.

     This used to jump to whichever stage reported "attention", which meant an
     entity with a missing required view opened on the coverage matrix. That is
     precisely what Section A forbids leading with, and it also answered a
     question the filmmaker had not asked yet: you cannot judge what else a
     production needs before you know what the primary IS. The taskbar still
     shows every stage's tone, so nothing that needs attention is hidden — it is
     one click away instead of being the front door. */
  const defaultTask = specs[0].id;
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
  return `<div class="bounded-entity-page clarity-entity-page" data-bounded-entity="1" data-selected-task="${attr(selected.id)}"><div class="crumb"><a href="#/library/${list}">References</a> / ${esc(it.id)}</div>${integrityWarnings.length ? `<div class="data-integrity-warning"><b>Project data needs attention</b><small>${integrityWarnings.map((warning)=>esc(warning)).join(" · ")}</small></div>` : ""}<header class="entity-clarity-head"><div><input class="page-title-input" value="${attr(it.name)}" onchange="setVal('${list}','${id}','name',this.value)"><div class="entity-head-meta"><span class="canon-code">${esc(it.id)}</span><span class="entity-head-review"><label class="entity-head-review-label" for="entity-review-status">Design review</label><select id="entity-review-status" class="workflow-select wf-${wf.cls}" onchange="setEntityWorkflow('${list}','${id}',this.value)">${WORKFLOW_STATES.filter((x)=>x!=="APPROVED"||wf.key==="APPROVED").map((st)=>`<option value="${st}" ${wf.key===st?"selected":""}>${workflowStatusLabel(st)}</option>`).join("")}</select></span></div></div><div class="entity-head-actions"><button class="ghost-btn" onclick="document.getElementById('entity-file').click()">${manualFirstWorkflow()?"UPLOAD REFERENCES":"UPLOAD CANDIDATES"}</button></div></header><input type="file" id="entity-file" multiple accept="image/*,video/*" style="display:none">${entityAuthoritySummaryMarkup(list,it,states,mediaByName,selected.id)}${boundedEntityTaskbarMarkup(list,it,specs,selected.id,activeCandidates,states)}<div class="bounded-selected-task" data-bounded-task="${attr(selected.id)}">${selected.render()}</div><div class="submission-bar"><div><b>${esc(wf.label)}</b><span>${it.reviewNote ? esc(it.reviewNote) : it.submissionNote ? esc(it.submissionNote) : "Work remains editable until submitted for review."}</span></div>${wf.key === "READY FOR REVIEW" ? `<button class="changes-btn" onclick="requestEntityChanges('${list}','${id}')">Request changes</button>` : ""}${wf.key !== "APPROVED" ? `<button class="submit-btn" onclick="submitEntity('${list}','${id}')">SUBMIT FOR REVIEW</button>` : ""}</div></div>`;
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

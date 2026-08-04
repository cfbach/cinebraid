/* ---------- vision review (adaptive batches; triage, not verdict) ---------- */
window.visionReview = async (kind, list, id) => {
  const capability = capabilityState("vision");
  if (!capability.ready) {
    toast(`${capability.message} ${capability.action}`.trim());
    return;
  }
  openModal(
    `<h3>Vision review — ${esc(id)}</h3><div class="modal-sub"><span class="spin">◌</span> REVIEWING IN SMALL BATCHES FOR RELIABLE LOCAL VISION TRIAGE</div><div class="hint">Large candidate sets take several passes. CineBraid will compare the strongest finalists again before suggesting a pick.</div>`,
  );
  const activityId = typeof v641StartManualActivity === "function" ? v641StartManualActivity("VISION AI · CANDIDATE REVIEW", `Vision review — ${id}`, "Sending candidate batches and production criteria to the configured vision model.") : "";
  try {
    const r = await fetch("/api/llm/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, list, id }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    const rv = d.review || {};
    const strategy = d.strategy || {};
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "completed", `${strategy.reviewed || d.files?.length || 0} candidate${(strategy.reviewed || d.files?.length || 0) === 1 ? "" : "s"} reviewed; finalist comparison completed.`);
    if (kind === "shot" && typeof storeCandidateAIReview === "function")
      storeCandidateAIReview(id, d);
    if (rv.raw) {
      openModal(`<h3>Vision review — ${esc(id)}</h3><div class="modal-sub">MODEL RETURNED UNSTRUCTURED NOTES</div>
        <div class="import-review" style="white-space:pre-wrap;max-height:340px;overflow:auto">${esc(rv.raw)}</div>
        <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
      return;
    }
    const name = (n) => d.files?.[n - 1] || "?";
    const byN = new Map((rv.reviews || []).map((x) => [+x.n, x]));
    const ranked = (rv.ranking || []).map(Number).filter((n) => byN.has(n));
    const top = ranked.slice(0, 3).map((n) => byN.get(n));
    const rest = (rv.reviews || [])
      .filter((x) => !top.some((t) => +t.n === +x.n))
      .sort((a, b) => (+b.score || 0) - (+a.score || 0));
    const row = (
      x,
    ) => `<div class="block-row review-result-row" style="${+x.n === +rv.suggested ? "border-color:var(--green)" : ""}">
      <div class="block-row-head"><span class="opt-id">${x.n}. ${esc(name(x.n))}</span>
        ${Number.isFinite(+x.score) ? `<span class="dur-chip">${Math.round(+x.score)}/100</span>` : ""}
        <span class="dur-chip" style="color:${x.pass ? "var(--green)" : "var(--red)"}">${x.pass ? "PASS" : "FLAG"}</span>
        ${kind === "shot" ? `<button class="add-btn" onclick="closeModal();setWinner('${id}','${attr(name(x.n))}')">MARK WINNER</button>` : ""}</div>
      <div class="opt-refs">${esc(x.notes || "")}</div></div>`;
    const reviewedNote = `${strategy.reviewed || d.files?.length || 0} candidate${(strategy.reviewed || d.files?.length || 0) === 1 ? "" : "s"} · ${strategy.batches || 1} batch${(strategy.batches || 1) === 1 ? "" : "es"}${strategy.finalists?.length ? ` · ${strategy.finalists.length} finalists rechecked` : ""}`;
    const omitted = strategy.omitted
      ? ` · ${strategy.omitted} additional candidate${strategy.omitted === 1 ? "" : "s"} not reviewed in this pass`
      : "";
    openModal(`<div class="review-modal-compact"><h3>Vision review — ${esc(id)}</h3>
      <div class="modal-sub">SUGGESTED: <b style="color:var(--green)">${esc(name(rv.suggested))}</b> · ${esc(rv.rationale || "")} · YOU MAKE THE PICK</div>
      <div class="hint">${esc(reviewedNote + omitted)}</div>
      <div class="section-label">Top matches</div>
      ${top.map(row).join("") || '<div class="hint">No structured finalist ranking was returned.</div>'}
      ${rest.length ? `<details class="nested-fold review-all"><summary>All reviewed candidates <span>${rv.reviews?.length || 0}</span></summary><div class="review-scroll">${rest.map(row).join("")}</div></details>` : ""}
      <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div></div>`);
  } catch (e) {
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "failed", e?.message || "Vision review failed.");
    openModal(`<h3>Review failed</h3><div class="import-review" style="color:var(--red)">${esc(e.message)}</div>
      <div class="hint">Confirm the selected vision assistant is running and the model name is correct, for example qwen3-vl:30b-a3b-instruct.</div>
      <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
  }
};

/* ---------- structured entity candidate review ---------- */
const ENTITY_REVIEW_FACTOR_LABELS = {
  characters: {
    design: "Identity & design",
    state: "Target state / wardrobe",
    requirements: "Anatomy & required details",
    usefulness: "Production-reference clarity",
    cleanliness: "Cleanliness & artifacts",
  },
  locations: {
    design: "Architecture & layout",
    state: "Target state / time / weather",
    requirements: "World, materials & set dressing",
    usefulness: "Production-reference clarity",
    cleanliness: "Cleanliness & artifacts",
  },
  props: {
    design: "Design, scale & materials",
    state: "Target condition / continuity state",
    requirements: "Functional & required details",
    usefulness: "Production-reference clarity",
    cleanliness: "Cleanliness & artifacts",
  },
  vehicles: {
    design: "Silhouette & vehicle identity",
    state: "Target condition / continuity state",
    requirements: "Components, proportions & details",
    usefulness: "Production-reference clarity",
    cleanliness: "Cleanliness & artifacts",
  },
};
const ENTITY_BATCH_REVIEW_RUNTIME = window.__cinebraidEntityBatchReviews || (window.__cinebraidEntityBatchReviews = new Map());
const ENTITY_BATCH_REVIEW_CONCURRENCY = 2;
function entityBatchReviewKey(list, id) {
  return `${list}:${id}`;
}
function entityBatchReviewHistory(entity) {
  entity.candidateReviewBatches = Array.isArray(entity.candidateReviewBatches) ? entity.candidateReviewBatches : [];
  return entity.candidateReviewBatches;
}
function entityBatchTarget(entity, fileName) {
  const row = entityCandidateRow(entity, fileName, false) || {};
  const type = entityCandidateWorkflowType(entity, fileName);
  const stateId = String(row.targetStateId || "state-default");
  const state = entityStateById(entity, stateId) || entityStateList(entity, true)[0];
  if (type === "coverage" || type === "expressions") {
    const group = row.coverageGroup === "expressions" ? "expressions" : "angles";
    return {
      type,
      stateId: state?.id || "state-default",
      key: `${group}:${row.targetCoverageSlotId || fileName}`,
      label: row.targetCoverageSlotName || (group === "expressions" ? "Expression" : "Coverage view"),
      slotId: row.targetCoverageSlotId || "",
      approvable: true,
    };
  }
  if (type === "sheets") {
    return {
      type,
      stateId: state?.id || "state-default",
      key: `sheet:${row.coverageSheetType || "angles"}`,
      label: row.coverageSheetType === "expressions" ? "Expression sheet" : "Reference sheet",
      slotId: "",
      approvable: false,
    };
  }
  return {
    type,
    stateId: state?.id || "state-default",
    key: `state:${state?.id || "state-default"}`,
    label: state?.name || "Default reference",
    slotId: "",
    approvable: true,
  };
}
function entityBatchRunById(entity, batchId = "") {
  const rows = entityBatchReviewHistory(entity);
  return batchId ? rows.find((item) => item.id === batchId) || null : rows.at(-1) || null;
}
function entityBatchShortlist(run) {
  const groups = new Map();
  for (const result of run?.results || []) {
    const group = groups.get(result.targetKey) || { key: result.targetKey, label: result.targetLabel, type: result.type, approvable: result.approvable !== false, candidates: [] };
    group.candidates.push(result);
    groups.set(result.targetKey, group);
  }
  return [...groups.values()].map((group) => {
    const passing = group.candidates.filter((item) => item.status === "completed" && item.pass && String(item.contractVersion || "") === ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return { ...group, best: passing[0] || null, reviewed: group.candidates.length };
  }).sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
}
function entityBatchStatusText(status) {
  if (!status) return "";
  if (status.status === "reviewing") return "Reviewing…";
  if (status.status === "pending") return "Pending";
  if (status.status === "failed") return "Review failed";
  if (status.status === "completed") return `${Math.round(Number(status.score || 0))} · ${status.pass ? "PASS" : "FLAG"}`;
  return "";
}
window.entityCandidateBatchStatusMarkup = (list, id, fileName) => {
  const runtime = ENTITY_BATCH_REVIEW_RUNTIME.get(entityBatchReviewKey(list, id));
  const status = runtime?.items?.[fileName];
  if (!status) return "";
  return `<span class="entity-batch-card-status state-${attr(status.status || "pending")}" data-batch-review-status="${attr(fileName)}">${esc(entityBatchStatusText(status))}</span>`;
};
function entityBatchLatestStatus(run) {
  if (!run) return "";
  const completed = Number(run.completed || 0), total = Number(run.total || 0), failed = Number(run.failed || 0);
  if (run.status === "running") return `${completed}/${total} complete${failed ? ` · ${failed} failed` : ""}`;
  if (run.status === "partial") return `${completed}/${total} reviewed · ${failed} failed`;
  return `${completed}/${total} reviewed`;
}
window.entityBatchReviewPanelMarkup = (list, entity, filteredCandidates = [], visibleCandidates = []) => {
  const runtime = ENTITY_BATCH_REVIEW_RUNTIME.get(entityBatchReviewKey(list, entity.id));
  const latest = runtime?.run || entityBatchRunById(entity);
  const running = latest?.status === "running";
  const shortlist = latest && latest.status !== "running" ? entityBatchShortlist(latest) : [];
  const passing = shortlist.filter((item) => item.best && item.approvable);
  const summary = latest
    ? `<div class="entity-batch-review-summary state-${attr(latest.status || "completed")}"><div><span>${running ? "BATCH REVIEW RUNNING" : latest.status === "partial" ? "BATCH REVIEW PARTIAL" : "LATEST BATCH REVIEW"}</span><b>${esc(entityBatchLatestStatus(latest))}</b><small>${esc(latest.filterLabel || "Current filter")} · bounded concurrency ${latest.concurrency || ENTITY_BATCH_REVIEW_CONCURRENCY}</small></div>${latest.status !== "running" ? `<button class="approve-btn" ${passing.length ? "" : "disabled"} onclick="openEntityBatchApproval('${list}','${entity.id}','${attr(latest.id)}')">APPROVE SELECTED PASSING CANDIDATES</button>` : `<span class="spin">◌</span>`}</div>`
    : `<div class="entity-batch-review-empty"><b>No batch review yet</b><span>Reviews run as small independent calls so partial results survive a failure.</span></div>`;
  const shortlistMarkup = shortlist.length
    ? `<div class="entity-batch-shortlist">${shortlist.map((item) => item.best ? `<article class="pass"><span>${esc(item.label)}</span><b>${esc(item.best.fileName)} · ${Math.round(Number(item.best.score || 0))}</b><small>${item.approvable ? "Passing candidate selected" : "Reviewed sheet · extract views manually"}</small></article>` : `<article class="missing"><span>${esc(item.label)}</span><b>No passing candidate</b><small>${item.reviewed} reviewed</small></article>`).join("")}</div>`
    : "";
  return `<section class="entity-batch-review-panel" data-entity-batch-panel="${attr(entityBatchReviewKey(list, entity.id))}"><header><div><span>BATCH AI REVIEW</span><b>Review candidates as one bounded run</b><small>Results appear independently; already-reviewed candidates are skipped unless you choose re-review.</small></div><div class="entity-batch-review-actions"><button class="approve-btn" ${running || !visibleCandidates.length ? "disabled" : ""} onclick="reviewEntityCandidatesBatch('${list}','${entity.id}','visible',false)"${aiDisabledAttrs("vision")}>REVIEW ALL VISIBLE</button><button class="ghost-btn" ${running || !filteredCandidates.length ? "disabled" : ""} onclick="reviewEntityCandidatesBatch('${list}','${entity.id}','unreviewed',false)"${aiDisabledAttrs("vision")}>REVIEW UNREVIEWED</button><button class="ghost-btn" ${running || !filteredCandidates.length ? "disabled" : ""} onclick="reviewEntityCandidatesBatch('${list}','${entity.id}','all',true)"${aiDisabledAttrs("vision")}>RE-REVIEW ALL</button></div></header>${summary}${shortlistMarkup}</section>`;
};
function entityBatchCssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(String(value || "")) : String(value || "").replace(/(["\\])/g, "\\$1");
}
function refreshEntityBatchReviewUi(list, entity) {
  const panel = document.querySelector?.(`[data-entity-batch-panel="${entityBatchCssEscape(entityBatchReviewKey(list, entity.id))}"]`);
  if (panel) {
    const media = entityMedia(list, entity);
    const approvedNames = new Set([...entityStateList(entity, true).map((state) => state.approvedFile || (state.isDefault ? entity.approvedFile || "" : "")), ...(entity.coverageSlots || []).map((slot) => slot.approvedFile), ...(entity.expressionSlots || []).map((slot) => slot.approvedFile)].filter(Boolean));
    const active = media.filter((item) => !approvedNames.has(item.name) && entityCandidateRow(entity, item.name, false)?.decision !== "rejected");
    const filter = entityCandidateFilter(list, entity.id);
    const filtered = active.filter((item) => entityCandidateMatchesFilter(entity, item.name, filter));
    const visibleNames = [...document.querySelectorAll?.(".entity-candidate-card:not(.is-rejected)[data-candidate-file]") || []].map((card) => card.dataset.candidateFile);
    const visible = filtered.filter((item) => visibleNames.includes(item.name));
    panel.outerHTML = entityBatchReviewPanelMarkup(list, entity, filtered, visible);
  }
  const runtime = ENTITY_BATCH_REVIEW_RUNTIME.get(entityBatchReviewKey(list, entity.id));
  for (const [fileName, status] of Object.entries(runtime?.items || {})) {
    const card = [...document.querySelectorAll?.(".entity-candidate-card[data-candidate-file]") || []].find((item) => item.dataset.candidateFile === fileName && !item.classList.contains("is-rejected"));
    if (!card) continue;
    let badge = card.querySelector?.(`[data-batch-review-status="${entityBatchCssEscape(fileName)}"]`);
    if (!badge) {
      badge = document.createElement("span");
      badge.dataset.batchReviewStatus = fileName;
      card.querySelector?.(".entity-candidate-meta")?.appendChild(badge);
    }
    badge.className = `entity-batch-card-status state-${status.status || "pending"}`;
    badge.textContent = entityBatchStatusText(status);
  }
}
async function reviewEntityCandidateOnce(list, entity, fileName) {
  const target = entityBatchTarget(entity, fileName);
  const response = await fetch("/api/llm/review-entity-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ list, id: entity.id, fileName, stateId: target.stateId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Review failed (${response.status})`);
  const row = entityCandidateRow(entity, fileName, true);
  row.structuredReviews = row.structuredReviews && typeof row.structuredReviews === "object" ? row.structuredReviews : {};
  row.structuredReviews[target.stateId] = { ...data.review, contractVersion: data.review?.contractVersion || data.contractVersion || ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION, authoritySignature: data.review?.authoritySignature || data.authoritySignature || "", stateId: target.stateId, stateName: entityStateById(entity, target.stateId)?.name || "Default", reviewedAt: new Date().toISOString(), inputLabels: data.inputLabels || [] };
  row.decision = row.decision === "rejected" ? "unreviewed" : row.decision || "unreviewed";
  return { target, review: row.structuredReviews[target.stateId] };
}
window.reviewEntityCandidatesBatch = async (list, id, scope = "visible", force = false) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return toast("Candidate inbox is unavailable");
  const capability = capabilityState("vision");
  if (!capability.ready) return toast(`${capability.message} ${capability.action}`.trim());
  const key = entityBatchReviewKey(list, id);
  if (ENTITY_BATCH_REVIEW_RUNTIME.get(key)?.run?.status === "running") return toast("A candidate batch review is already running");
  const media = entityMedia(list, entity);
  const approvedNames = new Set([...entityStateList(entity, true).map((state) => state.approvedFile || (state.isDefault ? entity.approvedFile || "" : "")), ...(entity.coverageSlots || []).map((slot) => slot.approvedFile), ...(entity.expressionSlots || []).map((slot) => slot.approvedFile)].filter(Boolean));
  const filter = entityCandidateFilter(list, id);
  let candidates = media.filter((item) => !approvedNames.has(item.name) && entityCandidateRow(entity, item.name, false)?.decision !== "rejected" && entityCandidateMatchesFilter(entity, item.name, filter));
  if (scope === "visible") {
    const visibleNames = [...document.querySelectorAll?.(".entity-candidate-card:not(.is-rejected)[data-candidate-file]") || []].map((card) => card.dataset.candidateFile);
    candidates = candidates.filter((item) => visibleNames.includes(item.name));
  }
  if (!force) candidates = candidates.filter((item) => !entityCandidateTargetReview(entity, item.name));
  if (!candidates.length) return toast(force ? "No candidates are visible in this workflow filter" : "All matching candidates are already reviewed");
  const run = {
    id: `entity-batch-${Date.now().toString(36)}`,
    startedAt: new Date().toISOString(),
    status: "running",
    scope,
    force: !!force,
    filter,
    filterLabel: ENTITY_CANDIDATE_FILTERS.find((item) => item.id === filter)?.label || "All",
    concurrency: ENTITY_BATCH_REVIEW_CONCURRENCY,
    total: candidates.length,
    completed: 0,
    failed: 0,
    results: [],
  };
  const items = Object.fromEntries(candidates.map((item) => [item.name, { status: "pending", score: 0, pass: false }]));
  const history = entityBatchReviewHistory(entity);
  history.push(run);
  if (history.length > 30) history.splice(0, history.length - 30);
  ENTITY_BATCH_REVIEW_RUNTIME.set(key, { run, items });
  dirty();
  refreshEntityBatchReviewUi(list, entity);
  const activityId = typeof v641StartManualActivity === "function" ? v641StartManualActivity("VISION AI · BATCH REFERENCE REVIEW", `Review ${candidates.length} ${entity.name || entity.id} candidates`, `Processing ${run.filterLabel} candidates with bounded concurrency ${ENTITY_BATCH_REVIEW_CONCURRENCY}. One failed review will not stop the remaining calls.`) : "";
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      const candidate = candidates[index];
      items[candidate.name] = { status: "reviewing", score: 0, pass: false };
      refreshEntityBatchReviewUi(list, entity);
      const target = entityBatchTarget(entity, candidate.name);
      try {
        const result = await reviewEntityCandidateOnce(list, entity, candidate.name);
        const score = Math.round(Number(result.review?.score || 0));
        const pass = !!result.review?.pass;
        items[candidate.name] = { status: "completed", score, pass };
        run.results.push({ fileName: candidate.name, status: "completed", score, pass, targetKey: result.target.key, targetLabel: result.target.label, type: result.target.type, stateId: result.target.stateId, slotId: result.target.slotId, approvable: result.target.approvable, contractVersion: result.review?.contractVersion || ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION, authoritySignature: result.review?.authoritySignature || "", reviewedAt: new Date().toISOString() });
      } catch (error) {
        items[candidate.name] = { status: "failed", score: 0, pass: false, error: error.message };
        run.failed += 1;
        run.results.push({ fileName: candidate.name, status: "failed", score: 0, pass: false, targetKey: target.key, targetLabel: target.label, type: target.type, stateId: target.stateId, slotId: target.slotId, approvable: target.approvable, error: error.message, reviewedAt: new Date().toISOString() });
      }
      run.completed += 1;
      dirty();
      refreshEntityBatchReviewUi(list, entity);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ENTITY_BATCH_REVIEW_CONCURRENCY, candidates.length) }, () => worker()));
  run.status = run.failed ? "partial" : "completed";
  run.finishedAt = new Date().toISOString();
  run.shortlist = entityBatchShortlist(run).map((item) => ({ key: item.key, label: item.label, type: item.type, approvable: item.approvable, bestFileName: item.best?.fileName || "", bestScore: item.best?.score || 0 }));
  dirty();
  if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, run.failed ? "completed" : "completed", `${run.completed - run.failed} completed, ${run.failed} failed. ${run.shortlist.filter((item) => item.bestFileName).length} target shortlist result${run.shortlist.filter((item) => item.bestFileName).length === 1 ? "" : "s"}.`);
  await route();
  toast(run.failed ? `Batch review finished with ${run.failed} failed candidate${run.failed === 1 ? "" : "s"}` : `Batch review complete · ${run.completed} candidates`);
};
window.openEntityBatchApproval = (list, id, batchId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const run = entity ? entityBatchRunById(entity, batchId) : null;
  if (!entity || !run) return toast("Batch shortlist is unavailable");
  const shortlist = entityBatchShortlist(run).filter((item) => item.best && item.approvable);
  if (!shortlist.length) return toast("No passing candidates are available for approval");
  window._entityBatchApproval = { list, id, batchId };
  openModal(`<div class="entity-batch-approval-modal"><header><span>BATCH APPROVAL</span><h3>Approve selected passing candidates</h3><p>This is the human confirmation step. Current filenames are kept; each selected image becomes the authority for only its listed target.</p></header><div class="entity-batch-approval-list">${shortlist.map((item, index) => { const current = item.type === "coverage" || item.type === "expressions" ? [...(entity.coverageSlots || []), ...(entity.expressionSlots || [])].find((slot) => slot.id === item.best.slotId)?.approvedFile : entityStateById(entity, item.best.stateId)?.approvedFile || (item.best.stateId === "state-default" ? entity.approvedFile : ""); return `<label><input type="checkbox" data-batch-approval-index="${index}" checked><span><b>${esc(item.label)}</b><small>${esc(item.best.fileName)} · ${Math.round(Number(item.best.score || 0))}/100${current && current !== item.best.fileName ? ` · replaces ${esc(current)}` : ""}</small></span></label>`; }).join("")}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="confirmEntityBatchApproval()">CONFIRM SELECTED APPROVALS</button></div></div>`);
};
window.confirmEntityBatchApproval = async () => {
  const current = window._entityBatchApproval || {};
  const entity = P[current.list]?.find((item) => item.id === current.id);
  const run = entity ? entityBatchRunById(entity, current.batchId) : null;
  if (!entity || !run) return toast("Batch shortlist is unavailable");
  const shortlist = entityBatchShortlist(run).filter((item) => item.best && item.approvable);
  const selected = [...document.querySelectorAll?.("[data-batch-approval-index]:checked") || []].map((input) => shortlist[Number(input.dataset.batchApprovalIndex)]).filter(Boolean);
  if (!selected.length) return toast("Select at least one passing candidate");
  const approvedAt = new Date().toISOString();
  const approvals = [];
  for (const item of selected) {
    const best = item.best;
    const row = entityCandidateRow(entity, best.fileName, true);
    if (item.type === "coverage" || item.type === "expressions") {
      const slots = item.type === "expressions" ? ensureExpressionSlots(entity).filter((slot) => !slot.retired) : ensureCoverageSlots(current.list, entity);
      const slot = slots.find((candidate) => candidate.id === best.slotId);
      if (!slot) continue;
      const previous = String(slot.approvedFile || "");
      if (previous !== best.fileName) recordCoverageReplacement(slot, previous, best.fileName, "batch-reviewed-candidate");
      slot.approvedFile = best.fileName;
      slot.status = "approved";
      slot.approvedAt = approvedAt;
      slot.provenance = { ...(slot.provenance || {}), source: "batch-reviewed-candidate", approvedAt, batchId: run.id };
      row.decision = item.type === "expressions" ? "approved-expression" : "approved-coverage";
      row.approvedCoverageSlotId = slot.id;
      row.reviewRequired = false;
      row.decidedAt = approvedAt;
    } else {
      const state = entityStateById(entity, best.stateId) || entityStateList(entity, true)[0];
      if (!state) continue;
      state.approvedFile = best.fileName;
      state.approvedAt = approvedAt;
      if (state.isDefault || state.id === "state-default") {
        entity.approvedFile = best.fileName;
        if (current.list === "characters") entity.primaryAngleAssignment = { status: "unassigned", sourceFile: best.fileName, updatedAt: approvedAt, note: "Primary identity references are not silently assigned to an angle slot." };
      }
      row.decision = "approved-reference";
      row.decidedAt = approvedAt;
      entity.workflowStatus = "APPROVED";
      entity.status = "APPROVED";
    }
    approvals.push({ target: item.label, fileName: best.fileName, score: best.score });
  }
  run.approvedAt = approvedAt;
  run.approvals = approvals;
  dirty();
  closeModal();
  await route();
  toast(`Approved ${approvals.length} passing candidate${approvals.length === 1 ? "" : "s"}`);
};
window.requestEntityCandidateApproval = (list, id, fileName, stateId = "state-default", continuation = "entity") => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return toast("Candidate is unavailable");
  const rawReview = entityCandidateReviewForState(entity, fileName, stateId || "state-default");
  const review = entityCandidateReviewIsCurrent(rawReview) ? rawReview : null;
  const row = entityCandidateRow(entity, fileName, false) || {};
  if (!review?.pass) return openEntityCandidateReview(list, id, fileName, stateId, continuation);
  if (continuation === "extract") return openCoverageSheetExtractor(list, id, fileName);
  if (continuation === "coverage") return approveCoverageCandidate(list, id, fileName, row.targetCoverageSlotId);
  return approveEntityFile(list, id, fileName, stateId);
};

function entityReviewSeverity(value) {
  const normalized = String(value || "pass").toLowerCase();
  return ["pass", "minor", "major", "blocking"].includes(normalized) ? normalized : "pass";
}
function entityReviewModalMarkup(list, entity, media, state, review, busy = false, error = "") {
  const factors = ENTITY_REVIEW_FACTOR_LABELS[list] || ENTITY_REVIEW_FACTOR_LABELS.props;
  const score = Math.round(+review?.score || 0);
  const pass = !!review?.pass;
  const statusLabel = review ? (pass ? "PASS" : "FLAG") : busy ? "REVIEWING" : "NOT REVIEWED";
  const statusTone = review ? (pass ? "pass" : "flag") : busy ? "busy" : "pending";
  const categories = review?.categories || {};
  const row = entityCandidateRow(entity, media.name, false) || {};
  const isSheet = typeof entityCandidateIsCoverageSheet === "function" && entityCandidateIsCoverageSheet(entity, media.name);
  const categoriesMarkup = Object.entries(factors).map(([key, label]) => {
    const item = categories[key] || {};
    const severity = entityReviewSeverity(item.severity);
    return `<article class="entity-review-factor severity-${severity}"><header><span>${esc(label)}</span><b>${esc(severity.toUpperCase())}</b></header><p>${esc(item.note || (review ? "No specific note returned." : "Run the vision review to check this factor."))}</p></article>`;
  }).join("");
  const hardCheckLabels = { sameUnderlyingEntity: "Same underlying asset", onlyRequestedDelta: "Only requested delta changed", sameEmbeddedContent: "Embedded content preserved", sameSpatialGeometry: "Same physical location", requestedViewCorrect: "Requested view is correct" };
  const hardChecksMarkup = review?.requiredHardChecks?.length ? `<section class="entity-review-hard-checks"><header><div><span>AUTHORITY GATES</span><b>${review.hardGateFailures?.length ? `${review.hardGateFailures.length} blocking issue${review.hardGateFailures.length === 1 ? "" : "s"}` : "All required gates passed"}</b></div></header>${review.requiredHardChecks.map((key) => { const row = review.hardChecks?.[key] || {}; return `<article class="${row.pass ? "pass" : "fail"}"><b>${esc(hardCheckLabels[key] || key)}</b><span>${esc(row.note || (row.returned === false ? "The reviewer did not return this mandatory check." : row.pass ? "Passed." : "Failed."))}</span></article>`; }).join("")}</section>` : "";
  const states = entityStateList(entity, true);
  const isCoverageCrop = !!row.targetCoverageSlotId;
  const primaryAction = isSheet
    ? `<button class="approve-btn large" onclick="closeModal();approveEntityFile('${list}','${entity.id}','${attr(media.name)}','${attr(state.id)}')">USE AS SHEET SOURCE</button>`
    : isCoverageCrop
      ? `<button class="approve-btn large" onclick="closeModal();approveCoverageCandidate('${list}','${entity.id}','${attr(media.name)}','${attr(row.targetCoverageSlotId)}',${review?.pass ? "false" : "true"})">ASSIGN TO ${esc(String(row.targetCoverageSlotName || "VIEW").toUpperCase())}</button>`
      : `<button class="approve-btn large" onclick="closeModal();approveEntityFile('${list}','${entity.id}','${attr(media.name)}','${attr(state.id)}')">APPROVE FOR ${esc((state.name || "DEFAULT").toUpperCase())}</button>`;
  return `<div class="entity-candidate-review-modal"><header class="entity-candidate-review-title"><div><span>${esc(list.slice(0, -1).toUpperCase())} · ${isSheet ? "SHEET REVIEW" : "CANDIDATE REVIEW"}</span><h3>${esc(media.name)}</h3><p>${isSheet ? "Judge identity consistency and panel usefulness, then extract each angle into its own approved slot." : isCoverageCrop ? `Judge angle accuracy, identity, crop quality, and usefulness for ${esc(row.targetCoverageSlotName || "the selected coverage slot")}.` : "Judge this image for one explicit continuity state before approving it."}</p></div><div class="entity-candidate-review-title-actions"><span class="entity-review-score state-${statusTone}">${review ? `${score}/100 · ${statusLabel}` : statusLabel}</span><button class="cancel" onclick="closeModal()">Close</button></div></header><div class="entity-candidate-review-layout"><section class="entity-candidate-review-visual">${isVideo(media.name) ? `<video controls muted src="${attr(media.url)}"></video>` : `<img src="${attr(media.url)}" alt="Entity candidate">`}<div class="entity-review-target"><span>${isSheet ? "SHEET AUTHORITY" : "REVIEW TARGET"}</span>${isSheet ? `<b>${esc(row.coverageSheetType === "expressions" ? "Expression sheet" : "Angle / viewpoint sheet")}</b><small>The sheet remains a source artifact. Individual panels become the approved coverage references.</small>` : `<select id="entity-review-state" onchange="changeEntityCandidateReviewState(this.value)">${states.map((item) => `<option value="${attr(item.id)}" ${item.id === state.id ? "selected" : ""}>${esc(item.name || "Default")}${item.appliesTo ? ` · ${esc(item.appliesTo)}` : ""}</option>`).join("")}</select><small>${esc(state.notes || (state.isDefault ? "Primary project-wide appearance and design." : "No state-specific notes have been entered."))}</small>`}</div></section><section class="entity-candidate-review-results">${busy ? (typeof assistantWorkingCard === "function" ? assistantWorkingCard("Qwen is reviewing this candidate…", isSheet ? "Checking cross-panel identity, angle clarity, crop usefulness, and artifacts. Automatic recovery is enabled." : `Checking all five factors against ${state.name || "Default"}. Automatic recovery is enabled if the vision response fails or is incomplete.`, { mode: "vision" }) : `<div class="guided-assistant-progress"><span class="spin">◌</span><div><b>Qwen is reviewing this candidate…</b></div></div>`) : error ? `<div class="guided-prompt-error"><b>Review failed</b><span>${esc(error)}</span></div>` : ""}${review ? `<section class="entity-review-summary state-${statusTone}"><div><span>OVERALL RESULT</span><b>${score}/100 · ${statusLabel}</b><small>${esc(review.summary || "No summary returned.")}</small></div><span>${esc(String(review.recommendation || "review").toUpperCase())}</span></section>` : `<section class="entity-review-summary state-pending"><div><span>OVERALL RESULT</span><b>${isSheet ? "Sheet not reviewed" : `Not reviewed for ${esc(state.name || "Default")}`}</b><small>The assistant result is advisory. Approval and extraction remain human decisions.</small></div></section>`}${hardChecksMarkup}<div class="entity-review-factor-grid">${categoriesMarkup}</div>${review?.referenceNotes?.length ? `<details class="entity-review-reference-notes"><summary>Reference comparisons <span>${review.referenceNotes.length}</span></summary>${review.referenceNotes.map((item) => `<div><b>${esc(item.label || "Reference")}</b><span>${esc(item.note || "")}</span></div>`).join("")}</details>` : ""}</section></div><footer class="entity-candidate-review-actions"><div><button class="ghost-btn" ${busy ? "disabled" : ""} onclick="runEntityCandidateVisionReview()"${aiDisabledAttrs("vision")}>${busy ? `<span class="spin">◌</span> REVIEWING…` : review ? "RUN REVIEW AGAIN" : "RUN AI REVIEW"}</button><button class="chip danger" onclick="setEntityCandidateDecision('${list}','${entity.id}','${attr(media.name)}','rejected');closeModal()">REJECT CANDIDATE</button></div>${primaryAction}</footer></div>`;
}

window.openEntityCandidateReview = (list, id, fileName, stateId = "", continueAction = "") => {
  const entity = P[list]?.find((item) => item.id === id);
  const media = entity ? entityMedia(list, entity).find((item) => item.name === fileName) : null;
  if (!entity || !media) return toast("Candidate image is unavailable");
  const row = entityCandidateRow(entity, fileName, false);
  const state = entityStateById(entity, stateId || row?.targetStateId || "state-default") || entityStateList(entity, true)[0];
  window._entityCandidateReview = { list, id, fileName, stateId: state.id, continueAction };
  const rawReview = entityCandidateReviewForState(entity, fileName, state.id);
  const review = entityCandidateReviewIsCurrent(rawReview) ? rawReview : null;
  openModal(entityReviewModalMarkup(list, entity, media, state, review));
};
window.changeEntityCandidateReviewState = (stateId) => {
  const current = window._entityCandidateReview || {};
  openEntityCandidateReview(current.list, current.id, current.fileName, stateId, current.continueAction || "");
};
window.runEntityCandidateVisionReview = async () => {
  const current = window._entityCandidateReview || {};
  const entity = P[current.list]?.find((item) => item.id === current.id);
  const media = entity ? entityMedia(current.list, entity).find((item) => item.name === current.fileName) : null;
  const state = entity ? entityStateById(entity, current.stateId || "state-default") : null;
  if (!entity || !media || !state) return toast("Review target is unavailable");
  const capability = capabilityState("vision");
  if (!capability.ready) return toast(`${capability.message} ${capability.action}`.trim());
  openModal(entityReviewModalMarkup(current.list, entity, media, state, null, true));
  const activityId = typeof v641StartManualActivity === "function" ? v641StartManualActivity("VISION AI · REFERENCE REVIEW", `Review ${current.fileName}`, `Comparing the candidate against ${state.name || "the selected continuity state"}.`) : "";
  try {
    const response = await fetch("/api/llm/review-entity-candidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list: current.list, id: current.id, fileName: current.fileName, stateId: state.id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Review failed (${response.status})`);
    const row = entityCandidateRow(entity, current.fileName, true);
    row.structuredReviews = row.structuredReviews && typeof row.structuredReviews === "object" ? row.structuredReviews : {};
    row.structuredReviews[state.id] = { ...data.review, contractVersion: data.review?.contractVersion || data.contractVersion || ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION, authoritySignature: data.review?.authoritySignature || data.authoritySignature || "", stateId: state.id, stateName: state.name || "Default", reviewedAt: new Date().toISOString(), inputLabels: data.inputLabels || [] };
    row.decision = row.decision === "rejected" ? "unreviewed" : row.decision || "unreviewed";
    dirty();
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "completed", `Review complete: ${Math.round(Number(data.review?.score || 0))}/100 · ${data.review?.pass ? "pass" : "flagged"}.`);
    await route();
    if (current.continueAction && data.review?.pass) {
      closeModal();
      if (current.continueAction === "extract") return openCoverageSheetExtractor(current.list, current.id, current.fileName);
      if (current.continueAction === "coverage") return approveCoverageCandidate(current.list, current.id, current.fileName, row.targetCoverageSlotId);
      return approveEntityFile(current.list, current.id, current.fileName, state.id);
    }
    openModal(entityReviewModalMarkup(current.list, entity, media, state, row.structuredReviews[state.id]));
  } catch (error) {
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "failed", error?.message || "Reference review failed.");
    openModal(entityReviewModalMarkup(current.list, entity, media, state, null, false, error.message));
  }
};

/* ---------- lightbox ---------- */
let LB = null; // { title, list, idx, shotId? }
window.openLB = (shotId, idx) => {
  LB = { shotId, title: shotId, list: takesFor(shotId), idx };
  renderLB();
};
window.openLBMedia = (json, idx, title) => {
  LB = { list: JSON.parse(decodeURIComponent(json)), idx, title };
  renderLB();
};
function renderLB() {
  let el = document.getElementById("lb");
  if (!LB) {
    el?.remove();
    return;
  }
  const s = LB.shotId ? shotById(LB.shotId) : null;
  const takes = LB.list || [];
  if (!takes.length) {
    LB = null;
    el?.remove();
    return;
  }
  LB.idx = (LB.idx + takes.length) % takes.length;
  const t = takes[LB.idx];
  if (!el) {
    el = document.createElement("div");
    el.id = "lb";
    el.className = "lb";
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="lb-top">
      <span class="slate-id">${esc(LB.title)}</span>
      <span class="lb-name">${esc(t.name)}</span>
      <span class="lb-count">${LB.idx + 1} / ${takes.length}</span>
      ${
        !s
          ? ""
          : s.winner === t.name
            ? '<span class="win-badge">WINNER</span>'
            : `<button onclick="setWinner('${LB.shotId}','${attr(t.name)}');LB.list=takesFor('${LB.shotId}');renderLB()">MARK WINNER</button>`
      }
      <a href="${t.url}" download="${attr(t.name)}">DOWNLOAD ⭳</a>
      <a href="${t.url}" target="_blank">OPEN FILE ↗</a>
      <button class="lb-close" onclick="closeLB()">✕</button>
    </div>
    <div class="lb-stage">
      ${isVideo(t.name) ? `<video controls autoplay muted src="${t.url}"></video>` : `<img src="${t.url}" alt="">`}
      <button class="lb-arrow lb-prev" onclick="lbNav(-1)">‹</button>
      <button class="lb-arrow lb-next" onclick="lbNav(1)">›</button>
    </div>`;
}
window.lbNav = (d) => {
  if (LB) {
    LB.idx += d;
    renderLB();
  }
};
window.closeLB = () => {
  LB = null;
  renderLB();
};

/* ---------- stamp ceremony ---------- */
function stampCeremony(text) {
  const o = document.createElement("div");
  o.className = "stamp-overlay";
  o.innerHTML = `<div class="stamp-big">${esc(text)}</div>`;
  document.body.appendChild(o);
  setTimeout(() => o.remove(), 950);
}

/* ---------- global semantic search ---------- */
let SEARCH_T = null;
function wireSearch() {
  const el = document.getElementById("global-search");
  if (!el || el._wired) return;
  el._wired = true;
  el.addEventListener("input", () => {
    clearTimeout(SEARCH_T);
    SEARCH_T = setTimeout(() => runSearch(el.value), 350);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      el.value = "";
      closeModal();
      el.blur();
    }
  });
}
async function runSearch(q) {
  if (!q.trim()) {
    closeModal();
    return;
  }
  const r = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q }),
  });
  const d = await r.json();
  const go = {
    shot: "#/shot/",
    character: "#/character/",
    location: "#/location/",
    prop: "#/prop/",
    style: "#/settings",
    session: "#/activity",
  };
  openModal(`<h3>Search</h3><div class="modal-sub">${esc(d.mode || "").toUpperCase()}</div>
    ${
      d.results.length
        ? d.results
            .map(
              (
                x,
              ) => `<a class="qc-item" style="text-decoration:none" href="${go[x.type] ? (x.type === "style" || x.type === "session" ? go[x.type] : go[x.type] + x.id) : "#"}" onclick="closeModal()">
      <span class="dur-chip" style="min-width:64px">${esc(x.type.toUpperCase())}</span>
      <span><b>${esc(x.title)}</b><br><span class="hint">${esc(x.snippet)}…</span></span></a>`,
            )
            .join("")
        : '<div class="canon-notes">Nothing found.</div>'
    }
    <div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
}

document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !/input|textarea|select/i.test(document.activeElement?.tagName || "")
  ) {
    e.preventDefault();
    document.getElementById("global-search")?.focus();
    return;
  }
  if (LB) {
    if (e.key === "Escape") return closeLB();
    if (e.key === "ArrowLeft") return lbNav(-1);
    if (e.key === "ArrowRight") return lbNav(1);
    return;
  }
  if (e.key === "Escape") closeModal();
});


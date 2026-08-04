/* ---------- scene continuity review ---------- */
const SCENE_REVIEW_BUSY = Object.create(null);

function sceneReviewApprovedStill(shot) {
  if (!shot) return null;
  const takes = typeof takesFor === "function" ? takesFor(shot.id) : [];
  if (typeof guidedCurrentShotStill === "function") return guidedCurrentShotStill(shot, takes);
  const openingFrame = (shot.keyframes || [])[0];
  const names = [shot.winner, openingFrame?.winner].filter(Boolean);
  for (const name of [...new Set(names)]) {
    if (typeof isVideo === "function" && isVideo(name)) continue;
    if (typeof isAudio === "function" && isAudio(name)) continue;
    const take = takes.find((item) => item.name === name);
    if (take) return { name: take.name, url: take.url, source: "Approved still" };
  }
  return null;
}
function sceneReviewRows(sceneId) {
  return (P.shots || [])
    .filter((shot) => String(shot.scene) === String(sceneId))
    .map((shot) => ({ shot, media: sceneReviewApprovedStill(shot) }))
    .filter((row) => row.media);
}
function sceneReviewOverrides(sc) {
  const report = sc?.continuityReview || {};
  report.overrides = report.overrides || { intentional: {}, notes: {} };
  report.overrides.intentional = report.overrides.intentional || {};
  report.overrides.notes = report.overrides.notes || {};
  return report.overrides;
}
function sceneReviewFlag(overrides, key) {
  return !!(overrides?.intentional || {})[key];
}
function sceneReviewStatusTone(verdict) {
  const key = String(verdict || "").toLowerCase();
  if (key.includes("pass") || key.includes("approved")) return "pass";
  if (key.includes("major") || key.includes("fail") || key.includes("broken")) return "fail";
  return "warn";
}
function sceneReviewLabel(key) {
  return String(key || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (ch) => ch.toUpperCase());
}
function sceneReviewScoreGrid(scores = {}) {
  const keys = ["visualQuality", "narrativeReadability", "characterConsistency", "locationConsistency", "propContinuity", "geography"];
  const values = keys.map((key) => Number(scores[key])).filter(Number.isFinite);
  const scale = values.length && Math.max(...values) <= 5 ? 20 : values.length && Math.max(...values) <= 10 ? 10 : 1;
  return `<div class="scene-review-score-grid">${keys.map((key) => `<article><span>${esc(sceneReviewLabel(key))}</span><b>${Number.isFinite(Number(scores[key])) ? Math.round(Number(scores[key]) * scale) : "—"}</b><small>/100</small></article>`).join("")}</div>`;
}
function sceneReviewFindingActions(sceneId, type, ref, recommendation) {
  return `<div class="scene-review-actions"><button class="ghost-btn" onclick="toggleSceneReviewIntentional('${attr(sceneId)}','${attr(type)}','${attr(ref)}')">MARK INTENTIONAL</button><button class="ghost-btn" onclick="openSceneReviewNote('${attr(sceneId)}','${attr(type)}','${attr(ref)}')">ADD NOTE</button><button class="changes-btn" onclick="openSceneContinuityCorrection('${attr(sceneId)}','${attr(type)}','${attr(ref)}')">BUILD CORRECTION</button></div>`;
}
function renderSceneReviewPriority(sceneId, report, overrides) {
  const list = Array.isArray(report.priorityIssues) ? report.priorityIssues : [];
  if (!list.length) return `<div class="scene-review-empty">No high-priority scene findings were returned.</div>`;
  return `<div class="scene-review-priority-list">${list.map((item, index) => {
    const key = `priority:${item.id || index}`;
    const intentional = sceneReviewFlag(overrides, key);
    return `<article class="scene-review-finding severity-${attr(String(item.severity || "medium").toLowerCase())} ${intentional ? "intentional" : ""}"><header><span>${esc(String(item.severity || "medium").toUpperCase())}</span><b>${esc(item.summary || item.title || `Issue ${index + 1}`)}</b>${intentional ? `<i>Intentional</i>` : ""}</header><p>${esc(item.detail || item.summary || "")}</p>${item.shotIds?.length ? `<small>Shots: ${esc(item.shotIds.join(", "))}</small>` : ""}${sceneReviewFindingActions(sceneId, "priority", item.id || String(index), item.recommendation || item.detail || item.summary || "")}</article>`;
  }).join("")}</div>`;
}
function renderSceneReviewShots(sceneId, report, overrides) {
  const rows = Array.isArray(report.shotFindings) ? report.shotFindings : [];
  if (!rows.length) return `<div class="scene-review-empty">No shot-specific continuity flags were returned.</div>`;
  return `<div class="scene-review-shot-grid">${rows.map((item) => {
    const key = `shot:${item.shotId}`;
    const intentional = sceneReviewFlag(overrides, key);
    return `<article class="scene-review-card severity-${attr(String(item.severity || "medium").toLowerCase())} ${intentional ? "intentional" : ""}"><header><div><span>${esc(item.shotId || "SHOT")}</span><b>${esc(item.title || item.shotTitle || item.shotId || "Shot finding")}</b></div><span>${esc(String(item.severity || "medium").toUpperCase())}</span></header><p>${esc(item.summary || "")}</p>${item.compareShotIds?.length ? `<small>Compare with: ${esc(item.compareShotIds.join(", "))}</small>` : ""}${item.recommendation ? `<div class="scene-review-recommendation"><b>Recommendation</b><span>${esc(item.recommendation)}</span></div>` : ""}<div class="scene-review-actions"><a class="ghost-btn" href="#/shot/${attr(item.shotId || "")}">OPEN SHOT</a>${sceneReviewFindingActions(sceneId, "shot", item.shotId || "", item.recommendation || item.summary || "")}</div></article>`;
  }).join("")}</div>`;
}
function renderSceneReviewPairs(sceneId, report, overrides) {
  const rows = Array.isArray(report.pairFindings) ? report.pairFindings : [];
  if (!rows.length) return `<div class="scene-review-empty">No adjacent-shot transition issues were returned.</div>`;
  return `<div class="scene-review-pair-list">${rows.map((item, index) => {
    const ref = `${item.fromShotId || "from"}__${item.toShotId || "to"}`;
    const key = `pair:${ref}`;
    const intentional = sceneReviewFlag(overrides, key);
    return `<article class="scene-review-card severity-${attr(String(item.severity || "medium").toLowerCase())} ${intentional ? "intentional" : ""}"><header><div><span>TRANSITION</span><b>${esc(item.fromShotId || "?" )} → ${esc(item.toShotId || "?")}</b></div><span>${esc(String(item.severity || "medium").toUpperCase())}</span></header><p>${esc(item.summary || item.detail || `Transition finding ${index + 1}`)}</p>${item.recommendation ? `<div class="scene-review-recommendation"><b>Recommendation</b><span>${esc(item.recommendation)}</span></div>` : ""}${sceneReviewFindingActions(sceneId, "pair", ref, item.recommendation || item.summary || "")}</article>`;
  }).join("")}</div>`;
}
window.toggleSceneReviewIntentional = (sceneId, type, ref) => {
  const sc = sceneById(sceneId);
  if (!sc || !sc.continuityReview) return;
  const overrides = sceneReviewOverrides(sc);
  const key = `${type}:${ref}`;
  overrides.intentional[key] = !overrides.intentional[key];
  dirty();
  route();
};
window.openSceneReviewNote = (sceneId, type, ref) => {
  const sc = sceneById(sceneId);
  if (!sc || !sc.continuityReview) return;
  const overrides = sceneReviewOverrides(sc);
  const key = `${type}:${ref}`;
  const value = String(overrides.notes[key] || "");
  openModal(`<div class="scene-review-note-modal"><h3>Continuity note</h3><p>Add a director note to explain why this issue is acceptable, intentional, or still unresolved.</p><textarea id="scene-review-note-body">${esc(value)}</textarea><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="saveSceneReviewNote('${attr(sceneId)}','${attr(type)}','${attr(ref)}')">Save note</button></div></div>`);
};
window.saveSceneReviewNote = (sceneId, type, ref) => {
  const sc = sceneById(sceneId);
  if (!sc || !sc.continuityReview) return closeModal();
  const overrides = sceneReviewOverrides(sc);
  const key = `${type}:${ref}`;
  const value = document.getElementById("scene-review-note-body")?.value || "";
  overrides.notes[key] = value;
  dirty();
  closeModal();
  route();
};
function sceneCorrectionContextMarkup(sceneId, targetShotId) {
  const shots = sceneReviewRows(sceneId), index = shots.findIndex((row) => row.shot.id === targetShotId);
  const rows = [shots[index - 1], shots[index], shots[index + 1]].filter(Boolean);
  return `<div class="scene-correction-context-grid">${rows.map((row) => `<article class="${row.shot.id === targetShotId ? "target" : ""}"><span>${row.shot.id === targetShotId ? "TARGET" : row === shots[index - 1] ? "PREVIOUS" : "NEXT"}</span><img src="${attr(row.media.url)}" alt="${attr(row.shot.id)} approved still"><b>${esc(row.shot.id)} · ${esc(row.shot.title || "Untitled")}</b></article>`).join("")}</div>`;
}
window.updateSceneCorrectionTargetContext = (sceneId) => {
  const select = document.getElementById("scene-correction-target"), targetId = select?.value || "";
  const note = document.getElementById("scene-correction-target-note"), target = shotById(targetId);
  if (note) note.textContent = target?.title || "";
  const context = document.getElementById("scene-correction-context");
  if (context) context.innerHTML = sceneCorrectionContextMarkup(sceneId, targetId);
  const textarea = document.getElementById("scene-review-correction-text");
  if (textarea && targetId) textarea.value = textarea.value.replace(/Target shot:[^\n]*/, `Target shot: ${targetId} · ${target?.title || ""}`);
};
window.openSceneContinuityCorrection = (sceneId, type, ref) => {
  const sc = sceneById(sceneId);
  if (!sc || !sc.continuityReview) return;
  const report = sc.continuityReview;
  let item = null;
  if (type === "shot") item = (report.shotFindings || []).find((row) => String(row.shotId) === String(ref));
  else if (type === "pair") item = (report.pairFindings || []).find((row) => `${row.fromShotId || "from"}__${row.toShotId || "to"}` === String(ref));
  else if (type === "priority") item = (report.priorityIssues || []).find((row, index) => String(row.id || index) === String(ref));
  if (!item) return toast("Scene review finding not found.");
  const candidateIds = type === "shot" ? [item.shotId] : type === "pair" ? [item.fromShotId, item.toShotId].filter(Boolean) : (item.shotIds || []).filter(Boolean);
  const targetIds = [...new Set(candidateIds.filter((id) => shotById(id)))];
  const recommendation = item.recommendation || item.detail || item.summary || "Correct the visible scene continuity break.";
  const text = `${recommendation} ${item.summary || ""}`;
  const named = targetIds.find((id) => text.includes(id));
  const defaultTarget = named || targetIds.at(-1) || "";
  const target = shotById(defaultTarget);
  const baseText = [
    `SCENE CONTINUITY CORRECTION`,
    `Scene: ${sc.title || sc.id}`,
    defaultTarget ? `Target shot: ${defaultTarget} · ${target?.title || ""}` : "Target shot: choose below",
    type === "pair" ? `Transition: ${item.fromShotId || "?"} → ${item.toShotId || "?"}` : "",
    item.summary ? `Visible continuity problem: ${item.summary}` : "",
    item.detail && item.detail !== item.summary ? `Detailed finding: ${item.detail}` : "",
    `Required repair: ${recommendation}`,
    sc.whatHappens ? `Scene beat: ${sc.whatHappens}` : "",
    ((sc.continuityReviewSettings || {}).expectedChanges) ? `Expected progression: ${(sc.continuityReviewSettings || {}).expectedChanges}` : "",
    "Edit the current approved target still. Preserve character identity, wardrobe, location architecture, prop construction, art style, camera intent, and every detail not required by this correction. The result must connect naturally to the approved previous and next shots.",
  ].filter(Boolean).join("\n\n");
  openModal(`<div class="scene-review-correction-modal"><header><div><span>SCENE CONTINUITY CORRECTION</span><h3>${esc(item.summary || item.title || "Scene finding")}</h3><p>Choose the shot to repair, refine the strategy, then create a persistent package or run a bounded FAL correction loop.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="scene-correction-target-row"><label><span>Repair target</span><select id="scene-correction-target" onchange="updateSceneCorrectionTargetContext('${attr(sceneId)}')">${targetIds.map((id) => { const shot = shotById(id); return `<option value="${attr(id)}" data-note="${attr(shot?.title || "")}" ${id === defaultTarget ? "selected" : ""}>${esc(id)} · ${esc(shot?.title || "Untitled")}</option>`; }).join("")}</select><small id="scene-correction-target-note">${esc(target?.title || "")}</small></label><label><span>Candidates per pass</span><select id="scene-correction-outputs">${[1,2,3,4].map((n) => `<option value="${n}" ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><span>Maximum passes</span><select id="scene-correction-passes">${[1,2,3,4,5,6,7,8].map((n) => `<option value="${n}" ${n === 4 ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><div id="scene-correction-context">${sceneCorrectionContextMarkup(sceneId, defaultTarget)}</div><label class="scene-correction-brief"><span>Correction strategy</span><textarea id="scene-review-correction-text">${esc(baseText)}</textarea><small>CineBraid will use the target still as the editable base, then add the previous shot, next shot, and approved entity references automatically.</small></label><div class="scene-correction-destination"><b>Where this goes</b><span>The package is stored on this scene. Automate Correction sends it into CineBraid's FAL generation → scene-context review → revise/retry → approval flow.</span></div><div class="modal-actions scene-correction-actions"><details><summary>Export</summary><div><button class="ghost-btn" onclick="copyText(document.getElementById('scene-review-correction-text').value)">Copy text</button></div></details><button class="ghost-btn" onclick="saveSceneFindingCorrectionPackage('${attr(sceneId)}','${attr(type)}','${attr(ref)}',false)">CREATE PACKAGE</button><button class="approve-btn large" onclick="saveSceneFindingCorrectionPackage('${attr(sceneId)}','${attr(type)}','${attr(ref)}',true)">AUTOMATE CORRECTION</button></div></div>`);
};
window.runSceneContinuityReview = async (sceneId) => {
  const sc = sceneById(sceneId);
  if (!sc) return;
  const rows = sceneReviewRows(sceneId);
  if (rows.length < 2) return toast("Approve at least two stills in this scene before running a scene continuity review.");
  SCENE_REVIEW_BUSY[sceneId] = true;
  route();
  const activityId = typeof v641StartManualActivity === "function" ? v641StartManualActivity("VISION AI · SCENE CONTINUITY", `Review scene ${sc.title || sc.id}`, `Comparing ${rows.length} approved stills in narrative order, including adjacent-shot transitions and approved production references.`) : "";
  try {
    const expectedChanges = String(((sc.continuityReviewSettings || {}).expectedChanges) || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const response = await fetch("/api/llm/review-scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId, expectedChanges }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Scene continuity review failed.");
    const fresh = sceneById(sceneId);
    if (fresh) {
      const priorOverrides = fresh.continuityReview?.overrides || { intentional: {}, notes: {} };
      fresh.continuityReview = Object.assign({}, data.review || {}, { overrides: priorOverrides });
      dirty();
    }
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "completed", `Scene review complete: ${String(data.review?.verdict || "reviewed").replace(/_/g, " ")}.`);
    toast("Scene continuity review complete.");
  } catch (error) {
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "failed", error?.message || "Scene continuity review failed.");
    toast(error?.message || "Scene continuity review failed.");
  } finally {
    delete SCENE_REVIEW_BUSY[sceneId];
    route();
  }
};
window.renderSceneContinuityPanel = (sc, shots) => {
  const rows = sceneReviewRows(sc.id);
  const report = sc.continuityReview || null;
  const overrides = sceneReviewOverrides(sc);
  const busy = !!SCENE_REVIEW_BUSY[sc.id];
  const verdict = report?.verdict || "Not reviewed";
  const verdictTone = sceneReviewStatusTone(verdict);
  const strengths = Array.isArray(report?.strengths) ? report.strengths : [];
  const expectedField = typeof taN === "function"
    ? taN(sc, "continuityReviewSettings", "expectedChanges", "scenes", sc.id, "List the intended progression for this scene, one change per line. Example: chamber powered → blackout → relit; braid severed → loose strands → repaired.")
    : `<textarea>${esc((sc.continuityReviewSettings || {}).expectedChanges || "")}</textarea>`;
  return `<section class="scene-review-panel"><header class="scene-review-head"><div><span>SCENE CONTINUITY REVIEW</span><h3>Check the scene as a sequence, not just as isolated shots</h3><p>The assistant compares approved stills in scene order and flags viewer-facing continuity breaks in identity, props, location, geography, and progression.</p></div><div class="scene-review-head-actions"><button class="ghost-btn" onclick="runSceneContinuityReview('${attr(sc.id)}')" ${busy ? "disabled" : ""}${typeof aiDisabledAttrs === "function" ? aiDisabledAttrs("vision") : ""}>${busy ? "REVIEWING…" : report ? "RE-RUN SCENE REVIEW" : "REVIEW SCENE CONTINUITY"}</button></div></header><div class="scene-review-plan"><div class="field"><label>Expected continuity progression</label>${expectedField}<small>These are intentional changes. The assistant should treat anything outside them as drift unless it is clearly camera-driven.</small></div><div class="scene-review-approved-strip">${rows.map((row, index) => `<article><span>${index + 1}. ${esc(row.shot.id)}</span><img src="${attr(row.media.url)}" alt="${attr(row.shot.id)} approved still"><b>${esc(row.shot.title || row.shot.id)}</b></article>`).join("") || `<div class="scene-review-empty">No approved stills yet.</div>`}</div></div>${report ? `<div class="scene-review-report"><section class="scene-review-summary state-${attr(verdictTone)}"><div><span>SCENE VERDICT</span><b>${esc(String(verdict).replace(/_/g, " ").toUpperCase())}</b><small>${esc(report.summary || "No summary returned.")}</small></div><span>${rows.length} approved still${rows.length === 1 ? "" : "s"} reviewed</span></section>${sceneReviewScoreGrid(report.scores || {})}${strengths.length ? `<details class="scene-review-strengths"><summary>What is already working <span>${strengths.length}</span></summary><ul>${strengths.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></details>` : ""}<details class="scene-review-section" open><summary>Priority issues <span>${(report.priorityIssues || []).length}</span></summary>${renderSceneReviewPriority(sc.id, report, overrides)}</details><details class="scene-review-section" open><summary>Adjacent-shot transitions <span>${(report.pairFindings || []).length}</span></summary>${renderSceneReviewPairs(sc.id, report, overrides)}</details><details class="scene-review-section" open><summary>Shot-specific findings <span>${(report.shotFindings || []).length}</span></summary>${renderSceneReviewShots(sc.id, report, overrides)}</details><div class="scene-review-footer"><small>Last reviewed ${report.updatedAt ? esc(new Date(report.updatedAt).toLocaleString()) : "just now"}</small></div></div>` : `<div class="scene-review-empty large"><b>No scene review yet.</b><span>Run the review once multiple approved stills exist. CineBraid will compare the sequence and return a fix list.</span></div>`}</section>`;
};

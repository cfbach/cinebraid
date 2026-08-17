/* CineBraid v6.4.3 — scene automation, continuity correction recovery, and diagnostic provenance. */

function v640SceneShots(sceneId) {
  return (P.shots || []).filter((shot) => String(shot.scene) === String(sceneId));
}
function v640SceneOpeningFrame(shot) {
  return typeof guidedFrames === "function" ? guidedFrames(shot)[0] || null : (shot?.keyframes || [])[0] || null;
}
/* THE SAME QUESTION, WITHOUT TOUCHING ANYTHING.
 *
 * BATCH 1C / re-audit A6. `guidedFrames` is a NORMALISER: it calls
 * `normalizeShotV5` and, when a shot has no keyframes, CREATES one. Correction
 * preflight called it, so a shot with zero frames did not fail preflight — it
 * silently GREW a frame, reported no error, and the real runner carried on to
 * the dispatch boundary. The audit observed `keyframeCountBefore: 0,
 * keyframeCountAfter: 1` and a mocked dispatch reached once.
 *
 * A preflight that repairs the thing it is checking is not a preflight. This is
 * a structural read: it looks at what is there and answers, and a malformed
 * `keyframes` value is a fact to report rather than a shape to fix. */
function v640SceneOpeningFrameRead(shot) {
  const s = shot && typeof shot === "object" ? shot : null;
  if (!s) return { ok: false, frame: null, reason: "no-shot" };
  const frames = s.keyframes;
  if (frames === undefined || frames === null) return { ok: false, frame: null, reason: "no-frames" };
  if (!Array.isArray(frames)) return { ok: false, frame: null, reason: "frames-malformed" };
  if (!frames.length) return { ok: false, frame: null, reason: "no-frames" };
  const first = frames[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return { ok: false, frame: null, reason: "frame-malformed" };
  if (!String(first.id || "")) return { ok: false, frame: null, reason: "frame-has-no-id" };
  return { ok: true, frame: first, reason: "" };
}
/* A MISSING NEIGHBOUR IS NOT A SHOT. Dogfood #2 A5 / forensic F7: the reference
   builder always asked for a previous AND a next shot, and boundary packages
   carry "" for one of them. `shotById("")` returns undefined, and this function
   read `shot.id` off it — so `Generate 3 S04-03 continuity corrections · round 1`
   threw `Cannot read properties of undefined (reading 'id')` before any provider
   request was ever built. Every first shot, every last shot, every single-shot
   scene and every deleted neighbour hit the same line.

   Answering "" with null is the whole repair at this level: a neighbour that does
   not exist has no approved still, which is a fact, not an error. */
function v640SceneApprovedStill(shot) {
  const id = shot && typeof shot === "object" ? String(shot.id || "") : "";
  if (!id) return null;
  return typeof guidedCurrentShotStill === "function" ? guidedCurrentShotStill(shot, takesFor(id)) : null;
}
/* A package CineBraid itself built wrong, or a project that cannot supply the
   structural context a correction needs. Distinguished from a provider fault
   because the two need opposite handling: a provider fault may clear on its own,
   and this one is identical every time it is reconstructed. Retrying it spends
   an attempt to reproduce the same exception. */
function v640CorrectionPackageError(message, details = {}) {
  const error = new Error(message);
  error.localPackageError = true;
  error.failureClass = "local-package";
  error.remediation = String(details.remediation || "");
  error.packageId = String(details.packageId || "");
  return error;
}
function v640SceneShotPreflight(shot) {
  const frame = v640SceneOpeningFrame(shot);
  if (!frame) return { errors: [`${shot.id} has no opening frame.`], warnings: [] };
  return typeof v626ShotPreflight === "function" ? v626ShotPreflight(shot, [frame.id]) : { errors: [], warnings: [] };
}
function v640SceneOrder(sceneId, shotIds, mode = "sequential") {
  const selected = new Set(shotIds || []);
  const rows = v640SceneShots(sceneId).filter((shot) => selected.has(shot.id));
  if (mode !== "hybrid") return rows.map((shot) => shot.id);
  const anchor = [], rest = [];
  rows.forEach((shot, index) => {
    const text = `${shot.title || ""} ${shot.desc || ""} ${shot.positioning || ""}`.toLowerCase();
    const isAnchor = index === 0 || index === rows.length - 1 || /\b(wide|master|establish|hero|full room|overview)\b/.test(text);
    (isAnchor ? anchor : rest).push(shot.id);
  });
  return [...new Set([...anchor, ...rest])];
}
function v640SceneContinuityThreshold(strictness = "normal") {
  return { lenient: 65, normal: 75, strict: 85 }[strictness] || 75;
}
function v640SceneReviewPass(review, strictness = "normal") {
  if (!review) return false;
  const threshold = v640SceneContinuityThreshold(strictness);
  const scores = review.scores || {};
  const required = [scores.narrativeReadability, scores.characterConsistency, scores.locationConsistency, scores.propContinuity, scores.geography]
    .map(Number).filter(Number.isFinite);
  const highs = [...(review.priorityIssues || []), ...(review.pairFindings || []), ...(review.shotFindings || [])]
    .filter((item) => String(item.severity || "").toLowerCase() === "high");
  return !highs.length && required.length >= 3 && Math.min(...required) >= threshold;
}
function v640SceneEstimate(config) {
  const outputs = Math.max(1, Math.min(4, Number(config.outputsPerRequest || 3)));
  const shotCount = Math.max(0, Number(config.shotCount || 0));
  const shotMax = shotCount * outputs * (Number(config.openingBlockingRounds || 3) + Number(config.frameRounds || 5));
  const correctionMax = config.correctionLoop
    ? Number(config.maxCorrectionRounds || 0) * Number(config.maxCorrectionTargets || 3) * Number(config.correctionPasses || 3) * outputs
    : 0;
  return { shotMax, correctionMax, total: shotMax + correctionMax };
}
function v640ScenePreflight(sceneId, shotIds, options = {}) {
  const errors = [], warnings = [];
  const reviewOnly = options.reviewOnly === true;
  const correctionLoop = options.correctionLoop !== false;
  const needsGeneration = !reviewOnly && (shotIds || []).length > 0;
  if ((needsGeneration || correctionLoop) && !falGenerationReady()) errors.push("FAL GPT Image 2 generation is not enabled.");
  if ((needsGeneration || correctionLoop) && !capabilityState("text").ready) errors.push(capabilityState("text").message || "The text assistant is unavailable.");
  if (!capabilityState("vision").ready) errors.push(capabilityState("vision").message || "The vision assistant is unavailable.");
  if (!reviewOnly && !(shotIds || []).length) errors.push("Choose at least one unfinished shot, or switch the scope to Review current scene only.");
  if (reviewOnly && v640SceneShots(sceneId).filter((shot) => v640SceneApprovedStill(shot)).length < 2) errors.push("Approve at least two scene stills before running review-only automation.");
  for (const id of shotIds || []) {
    const shot = shotById(id);
    if (!shot) { errors.push(`${id} no longer exists.`); continue; }
    if (options.reuseApproved !== false && v640SceneApprovedStill(shot)) {
      warnings.push(`${id} already has an approved still and will be reused as scene context.`);
      continue;
    }
    const preflight = v640SceneShotPreflight(shot);
    errors.push(...preflight.errors.map((item) => `${id}: ${item}`));
    warnings.push(...preflight.warnings.map((item) => `${id}: ${item}`));
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
function v640SceneRunChildren(run) {
  return Object.values(run?.steps || []).filter((step) => step.kind === "scene-shot").map((step) => ({
    shotId: step.shotId || step.result?.shotId || "",
    childRunId: step.result?.childRunId || "",
    status: step.result?.childStatus || step.status || "pending",
    winner: step.winner || "",
    usage: step.result?.usage || null,
  }));
}
function v640SceneAutomationExtra(run) {
  if (!run) return "";
  const children = v640SceneRunChildren(run);
  const review = run.result?.sceneReview || sceneById(run.targetId)?.continuityReview || null;
  const packages = Array.isArray(run.result?.correctionPackages) ? run.result.correctionPackages : [];
  return `${children.length ? `<div class="scene-auto-child-grid">${children.map((row) => `<a href="#/shot/${attr(row.shotId)}" class="scene-auto-child state-${attr(row.status)}"><span>${esc(row.shotId)}</span><b>${esc(row.status.replace(/-/g, " "))}</b><small>${row.winner ? esc(row.winner) : row.childRunId ? `Child run ${esc(row.childRunId)}` : "Not started"}</small></a>`).join("")}</div>` : ""}${review ? `<div class="scene-auto-continuity-status"><b>Latest continuity review</b><span>${esc(String(review.verdict || "reviewed").replace(/_/g, " "))}</span><small>${esc(review.summary || "")}</small></div>` : ""}${packages.length ? `<details class="scene-auto-packages"><summary>Correction packages <span>${packages.length}</span></summary>${packages.map((item) => `<article><b>${esc(item.targetShotId || "Target pending")}</b><span>${esc(item.summary || item.finding || "Continuity correction")}</span><small>${esc(item.status || "planned")}</small></article>`).join("")}</details>` : ""}`;
}
window.renderSceneAutomationPanel = (scene, shots = []) => {
  const run = v626LatestRun("scene-chain", scene.id, "stills");
  const description = "Build the scene's approved opening stills, carry approved shot context forward, review the assembled sequence, and run bounded continuity corrections without generating video.";
  const panel = v626AutomationPanel(run, "Full scene automation & continuity", description, "scene-chain", scene.id, "stills", `<button class="approve-btn" onclick="openSceneAutomationModal('${attr(scene.id)}')">AUTOMATE / REVIEW SCENE</button>`, v640SceneAutomationExtra(run));
  const active = ["running", "awaiting-review", "failed", "interrupted"].includes(String(run?.status || ""));
  if (typeof manualFirstWorkflow !== "function" || !manualFirstWorkflow()) return panel;
  return `<details class="guided-assisted-tools scene-assisted-tools" ${active ? "open" : ""}><summary><div><span>OPTIONAL ASSISTED SCENE</span><b>Automate stills or review scene continuity</b><small>Manual scene organization remains primary. Open this when CineBraid should generate or compare the scene's approved stills.</small></div></summary><div class="guided-assisted-tools-body">${panel}</div></details>`;
};
function v642ScenePlannerScope() {
  return document.getElementById("v640-scene-scope")?.value || "continue";
}
function v642ScenePlannerSelectedIds() {
  return [...document.querySelectorAll(".v640-scene-shot:checked")].map((input) => input.value);
}
function v642ScenePlannerShotCard(shot, index, scope = "continue") {
  const approved = v640SceneApprovedStill(shot), preflight = v640SceneShotPreflight(shot);
  const checked = scope === "review-only" ? false : scope === "rebuild" ? !preflight.errors.length : !approved && !preflight.errors.length;
  const status = approved ? "approved" : preflight.errors.length ? "blocked" : "missing";
  const statusLabel = approved ? "READY · CONTEXT" : preflight.errors.length ? "NEEDS SETUP" : "GENERATE";
  const detail = approved ? `Approved still will be reused: ${approved.name}` : preflight.errors.length ? preflight.errors.join(" ") : "No approved still yet. This shot will be generated.";
  return `<label class="scene-auto-shot-card state-${status}"><input type="checkbox" class="v640-scene-shot" value="${attr(shot.id)}" ${checked ? "checked" : ""} ${preflight.errors.length ? "disabled" : ""} onchange="updateSceneAutomationEstimate()"><span class="scene-auto-shot-index">${index + 1}</span><span class="scene-auto-shot-copy"><b>${esc(shot.id)} · ${esc(shot.title || "Untitled")}</b><small>${esc(detail)}</small></span><span class="scene-auto-shot-status">${statusLabel}</span></label>`;
}
window.v642ApplySceneScope = () => {
  const draft = window._v640SceneDraft || {}, scene = sceneById(draft.sceneId), scope = v642ScenePlannerScope();
  if (!scene) return;
  const picker = document.getElementById("v640-scene-shot-picker");
  if (picker) picker.innerHTML = v640SceneShots(scene.id).map((shot, index) => v642ScenePlannerShotCard(shot, index, scope)).join("");
  const reviewOnly = scope === "review-only";
  document.querySelectorAll("[data-scene-generation-setting]").forEach((node) => { node.classList.toggle("disabled", reviewOnly); node.querySelectorAll("input,select").forEach((input) => input.disabled = reviewOnly); });
  const button = document.getElementById("v640-start-scene");
  if (button) button.textContent = reviewOnly ? "REVIEW CURRENT SCENE" : scope === "continue" ? "CONTINUE SCENE AUTOMATION" : "REBUILD SELECTED SHOTS";
  updateSceneAutomationEstimate();
};
window.v642SelectIncompleteSceneShots = () => {
  document.querySelectorAll(".v640-scene-shot").forEach((input) => { const shot = shotById(input.value); input.checked = !input.disabled && !v640SceneApprovedStill(shot); });
  updateSceneAutomationEstimate();
};
window.v642SelectAllSceneShots = () => {
  document.querySelectorAll(".v640-scene-shot").forEach((input) => { if (!input.disabled) input.checked = true; });
  updateSceneAutomationEstimate();
};
window.openSceneAutomationModal = (sceneId) => {
  const scene = sceneById(sceneId), shots = v640SceneShots(sceneId);
  if (!scene) return;
  const generationSettings = v6211AutomationGenerationSettings();
  window._v640SceneDraft = { sceneId, shotIds: shots.filter((shot) => !v640SceneApprovedStill(shot)).map((shot) => shot.id), generationSettings };
  openModal(`<div class="automation-plan-modal scene-automation-plan"><header><div><span>SCENE AUTOMATION</span><h3>${esc(scene.title || scene.id)}</h3><p>Continue from the work already approved, review the assembled scene, and repair only the shots that need attention.</p></div><button class="cancel" onclick="closeModal()">Close</button></header>${v6211GenerationProfileMarkup(generationSettings)}<section class="scene-auto-scope"><label><span>Automation scope</span><select id="v640-scene-scope" onchange="v642ApplySceneScope()"><option value="continue" selected>Continue from current scene — generate only unfinished shots</option><option value="review-only">Review current approved scene only</option><option value="rebuild">Rebuild selected shots</option></select></label><div><button class="chip" onclick="v642SelectIncompleteSceneShots()">SELECT UNFINISHED</button><button class="chip" onclick="v642SelectAllSceneShots()">SELECT ALL ELIGIBLE</button></div><p>Approved shots remain available as continuity context even when they are not selected for regeneration.</p></section><div id="v640-scene-shot-picker" class="scene-auto-shot-picker">${shots.map((shot, index) => v642ScenePlannerShotCard(shot, index, "continue")).join("")}</div><div class="scene-auto-settings-grid" data-scene-generation-setting><label><span>Execution mode</span><select id="v640-scene-mode" onchange="updateSceneAutomationEstimate()"><option value="hybrid" selected>Hybrid — anchors first</option><option value="sequential">Sequential — edit order</option></select></label><label><span>Candidates per pass</span><select id="v640-scene-outputs" onchange="updateSceneAutomationEstimate()">${[1,2,3,4].map((n) => `<option value="${n}" ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><span>Max frame passes per shot</span><select id="v640-scene-shot-passes" onchange="updateSceneAutomationEstimate()">${[1,2,3,4,5,6,7,8].map((n) => `<option value="${n}" ${n === 5 ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><span>Opening blocking passes</span><select id="v640-scene-blocking-passes" onchange="updateSceneAutomationEstimate()">${[1,2,3,4,5,6].map((n) => `<option value="${n}" ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><div class="scene-auto-settings-grid"><label><span>Correction passes per target</span><select id="v640-scene-correction-passes" onchange="updateSceneAutomationEstimate()">${[1,2,3,4,5,6,7,8].map((n) => `<option value="${n}" ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><span>Scene correction cycles</span><select id="v640-scene-correction-rounds" onchange="updateSceneAutomationEstimate()">${[0,1,2,3,4,5].map((n) => `<option value="${n}" ${n === 2 ? "selected" : ""}>${n}</option>`).join("")}</select></label><label><span>Continuity strictness</span><select id="v640-scene-strictness"><option value="lenient">Lenient</option><option value="normal" selected>Normal</option><option value="strict">Strict</option></select></label><label><span>Recommendation threshold</span><select id="v640-scene-auto-score">${[75,80,85,90,95].map((n) => `<option value="${n}" ${n === 85 ? "selected" : ""}>${n}/100</option>`).join("")}</select><small>A review at or above this score stops further paid passes and recommends its best candidate. Approval stays yours.</small></label><label><span>Maximum total images</span><input id="v640-scene-max-images" type="number" min="0" max="1000" step="1" value="60"></label></div><div class="scene-auto-toggle-grid"><label><input id="v640-scene-reuse" type="checkbox" checked onchange="updateSceneAutomationEstimate()"><span><b>Reuse approved stills and guides</b><small>Completed shots are context, not regenerated work.</small></span></label><label><input id="v640-scene-review" type="checkbox" checked onchange="updateSceneAutomationEstimate()"><span><b>Review scene continuity</b><small>Check the entire approved sequence after generation.</small></span></label><label><input id="v640-scene-corrections" type="checkbox" checked onchange="updateSceneAutomationEstimate()"><span><b>Automate high-priority corrections</b><small>Build bounded correction packages and review the results.</small></span></label><label><input id="v640-scene-auto-target" type="checkbox" checked><span><b>Auto-select repair target</b><small>Choose the most likely shot when a finding names several.</small></span></label></div><div id="v640-scene-preflight" class="scene-auto-preflight"></div><div id="v640-scene-estimate" class="automation-cost-guard"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="v640-start-scene" class="approve-btn large" onclick="startPlannedSceneAutomation()">CONTINUE SCENE AUTOMATION</button></div></div>`);
  updateSceneAutomationEstimate();
};
window.updateSceneAutomationEstimate = () => {
  const draft = window._v640SceneDraft || {}, scope = v642ScenePlannerScope(), reviewOnly = scope === "review-only";
  const selectedIds = reviewOnly ? [] : v642ScenePlannerSelectedIds();
  const reuseApproved = document.getElementById("v640-scene-reuse")?.checked !== false;
  const generationIds = selectedIds.filter((id) => !(reuseApproved && v640SceneApprovedStill(shotById(id))));
  const approvedContext = v640SceneShots(draft.sceneId).filter((shot) => v640SceneApprovedStill(shot)).length;
  const config = {
    shotCount: generationIds.length,
    outputsPerRequest: Number(document.getElementById("v640-scene-outputs")?.value || 3),
    frameRounds: Number(document.getElementById("v640-scene-shot-passes")?.value || 5),
    openingBlockingRounds: Number(document.getElementById("v640-scene-blocking-passes")?.value || 3),
    correctionPasses: Number(document.getElementById("v640-scene-correction-passes")?.value || 3),
    maxCorrectionRounds: Number(document.getElementById("v640-scene-correction-rounds")?.value || 2),
    maxCorrectionTargets: 3,
    correctionLoop: document.getElementById("v640-scene-corrections")?.checked !== false,
  };
  const estimate = v640SceneEstimate(config), maxInput = document.getElementById("v640-scene-max-images");
  if (maxInput && !maxInput.dataset.edited) maxInput.value = String(Math.max(0, Math.min(1000, Math.ceil(estimate.total / 3) * 3)));
  if (maxInput && !maxInput.dataset.bound) { maxInput.dataset.bound = "1"; maxInput.addEventListener("input", () => { maxInput.dataset.edited = "1"; }); }
  const cap = Number(maxInput?.value || estimate.total || 0);
  const preflight = v640ScenePreflight(draft.sceneId, selectedIds, { reviewOnly, reuseApproved, correctionLoop: config.correctionLoop });
  const preflightEl = document.getElementById("v640-scene-preflight");
  if (preflightEl) preflightEl.innerHTML = v627PreflightMarkup(preflight);
  const estimateEl = document.getElementById("v640-scene-estimate");
  const modeLabel = reviewOnly ? "review-only" : scope === "continue" ? "continue current scene" : "rebuild selected";
  if (estimateEl) estimateEl.innerHTML = `<b>${generationIds.length} generation target${generationIds.length === 1 ? "" : "s"} · ${approvedContext} approved context shot${approvedContext === 1 ? "" : "s"} · cap ${cap}${v628CostEstimateText(cap)}</b><span>Mode: ${modeLabel}. Worst-case paid image plan: ${estimate.total}. Reused approved shots do not consume generation passes.</span>`;
  const button = document.getElementById("v640-start-scene");
  if (button) button.disabled = !!preflight.errors.length || (!reviewOnly && !selectedIds.length) || !Number.isFinite(cap) || cap < 0;
  window._v640SceneDraft = { ...draft, scope, reviewOnly, shotIds: selectedIds, generationShotIds: generationIds, estimatedMax: estimate.total, maxImages: cap, generationSettings: draft.generationSettings || v6211AutomationGenerationSettings() };
};
window.startPlannedSceneAutomation = async () => {
  updateSceneAutomationEstimate();
  const draft = window._v640SceneDraft || {}, scene = sceneById(draft.sceneId);
  if (!scene) return;
  const reviewOnly = draft.reviewOnly === true;
  if (!reviewOnly && !draft.shotIds?.length) return toast("Choose at least one eligible shot.");
  const reuseApproved = document.getElementById("v640-scene-reuse")?.checked !== false;
  const correctionLoop = document.getElementById("v640-scene-corrections")?.checked !== false;
  const preflight = v640ScenePreflight(scene.id, draft.shotIds || [], { reviewOnly, reuseApproved, correctionLoop });
  if (preflight.errors.length) return toast(preflight.errors[0]);
  const mode = document.getElementById("v640-scene-mode")?.value || "hybrid";
  const allSceneShots = v640SceneShots(scene.id);
  const config = {
    shotIds: reviewOnly ? [] : v640SceneOrder(scene.id, draft.shotIds, mode),
    narrativeShotIds: allSceneShots.filter((shot) => v640SceneApprovedStill(shot) || (draft.shotIds || []).includes(shot.id)).map((shot) => shot.id),
    mode, reviewOnly, continueExisting: draft.scope === "continue",
    reuseApproved,
    derivativeBlocking: true,
    openingBlockingRounds: Number(document.getElementById("v640-scene-blocking-passes")?.value || 3),
    derivativeBlockingRounds: Math.min(4, Number(document.getElementById("v640-scene-blocking-passes")?.value || 3)),
    frameRounds: Number(document.getElementById("v640-scene-shot-passes")?.value || 5),
    outputsPerRequest: Number(document.getElementById("v640-scene-outputs")?.value || 3),
    continuityReview: document.getElementById("v640-scene-review")?.checked !== false || reviewOnly,
    correctionLoop,
    autoSelectCorrectionTarget: document.getElementById("v640-scene-auto-target")?.checked !== false,
    correctionPasses: Number(document.getElementById("v640-scene-correction-passes")?.value || 3),
    maxCorrectionRounds: Number(document.getElementById("v640-scene-correction-rounds")?.value || 2),
    maxCorrectionTargets: 3,
    strictness: document.getElementById("v640-scene-strictness")?.value || "normal",
    autoApproveScore: Number(document.getElementById("v640-scene-auto-score")?.value || 85),
    maxImages: Math.max(0, Number(document.getElementById("v640-scene-max-images")?.value || draft.maxImages || 0)),
    generationSettings: draft.generationSettings || v6211AutomationGenerationSettings(),
  };
  const label = reviewOnly ? `${scene.title || scene.id} scene review` : `${scene.title || scene.id} scene stills`;
  const run = v626NewRun("scene-chain", scene.id, "stills", label, reviewOnly ? "review-only" : mode, config);
  run.result = { correctionPackages: [], continuityRounds: [] };
  closeModal();
  const saved = await v626CreateRun(run);
  location.hash = `#/scene/${scene.id}`;
  setTimeout(() => typeof openGlobalAutomationActivity === "function" && openGlobalAutomationActivity(saved.id), 120);
  runSceneAutomation(saved.id);
};

function v640SceneRemainingBudget(run) {
  return Math.max(0, Number(run.config?.maxImages || 0) - Number(run.usage?.imagesGenerated || 0));
}
function v640SceneApplyContext(sceneId, shotId, approvedShotIds = []) {
  const shot = shotById(shotId), sceneShots = v640SceneShots(sceneId), index = sceneShots.findIndex((item) => item.id === shotId);
  if (!shot) return;
  const candidates = [];
  const add = (sourceShot, label) => {
    if (!sourceShot || sourceShot.id === shotId || !approvedShotIds.includes(sourceShot.id)) return;
    const media = v640SceneApprovedStill(sourceShot);
    if (!media?.url) return;
    candidates.push({ key: `scene-continuity:${sourceShot.id}`, label: `${label} · ${sourceShot.id} ${sourceShot.title || ""}`.trim(), role: "continuity", instruction: "Use only as scene continuity authority for recurring location design, character identity, props, lighting state, and screen geography. Follow the target shot brief for composition.", url: media.url, file: media.name });
  };
  add(sceneShots[index - 1], "Previous approved shot");
  add(sceneShots[index + 1], "Next approved shot");
  for (const id of approvedShotIds.slice(-2)) add(sceneShots.find((item) => item.id === id), "Approved scene anchor");
  const creation = ensureShotCreation(shot);
  creation.sceneAutomationReferences = candidates.slice(0, 4);
  dirty();
}
function v640SceneChildConfig(run, shot, remaining) {
  const frame = v640SceneOpeningFrame(shot), outputs = v640OutputsPerRequest(run);
  const theoretical = outputs * (Number(run.config.openingBlockingRounds || 3) + Number(run.config.frameRounds || 5));
  return {
    frameIds: [frame.id], frameLabels: [frame.label || "A"], derivativeBlocking: false,
    reuseApproved: run.config.reuseApproved !== false,
    openingBlockingRounds: Number(run.config.openingBlockingRounds || 3),
    derivativeBlockingRounds: Number(run.config.derivativeBlockingRounds || 2),
    frameRounds: Number(run.config.frameRounds || 5), outputsPerRequest: outputs,
    autoApproveScore: Number(run.config.autoApproveScore || 85),
    maxImages: Math.max(outputs, Math.min(theoretical, remaining)),
    generationSettings: v6211RunGenerationSettings(run), parentSceneRunId: run.id,
  };
}
async function v640RunSceneShot(run, shotId, approvedShotIds) {
  const shot = shotById(shotId), frame = v640SceneOpeningFrame(shot), key = `scene-shot:${shotId}`;
  if (!shot || !frame) throw new Error(`${shotId} is unavailable.`);
  const step = v626Step(run, key, "scene-shot", `Build ${shotId} approved still`);
  step.shotId = shotId; step.frameId = frame.id;
  if (run.config.reuseApproved && v640SceneApprovedStill(shot)) {
    const media = v640SceneApprovedStill(shot);
    await v626CompleteStep(run, key, { kind: "scene-shot", label: `${shotId} reused`, shotId, frameId: frame.id, winner: media.name, result: { ...(step.result || {}), shotId, reused: true, childStatus: "completed", usage: step.result?.usage || { imagesGenerated: 0, imageRequests: 0 } } });
    return media.name;
  }
  const remaining = v640SceneRemainingBudget(run);
  if (remaining < v640OutputsPerRequest(run)) throw new Error(`Scene image cap has only ${remaining} image slots remaining.`);
  await v626BeginStep(run, key, "scene-shot", `Generate ${shotId} · ${shot.title || "shot"}`, { shotId, frameId: frame.id });
  await v641SetStepActivity(run, key, "preparing child run", `Preparing the durable shot automation for ${shotId} and carrying approved scene context forward.`, { system: "CINEBRAID · SCENE ORCHESTRATOR" });
  v640SceneApplyContext(run.targetId, shotId, approvedShotIds);
  await flushPendingProjectSave();
  let childRunId = step.result?.childRunId || "", child = childRunId ? await v626RefreshRun(childRunId, false).catch(() => null) : null;
  if (!child) {
    const childRun = v626NewRun("shot-chain", shotId, "stills", `${shotId} scene child`, "opening-frame", v640SceneChildConfig(run, shot, remaining));
    childRun.parentRunId = run.id;
    child = await v626CreateRun(childRun);
    childRunId = child.id;
    step.result = { ...(step.result || {}), childRunId, shotId, childStatus: child.status };
    step.activity = { ...(step.activity || {}), state: "child run active", detail: `${shotId} is running its own prompt, FAL, review, and approval timeline. Expand the child timeline below for live detail.`, system: "CINEBRAID · SCENE ORCHESTRATOR", childRunId, updatedAt: v626Now() };
    await v626SaveRun(run, false);
  }
  if (child.status === "failed" && Number(step.retryCount || 0) > 0) {
    const failedChildStep = Object.values(child.steps || {}).find((item) => item.status === "failed");
    if (failedChildStep) {
      const response = await fetch(`/api/automation/runs/${encodeURIComponent(child.id)}/retry-step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepKey: failedChildStep.key }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not retry ${shotId} child step.`);
      child = data.run;
    }
  }
  if (!["completed", "awaiting-review", "failed"].includes(child.status)) await runShotAutomation(child.id);
  child = await v626RefreshRun(child.id, false);
  step.result = { ...(step.result || {}), childRunId: child.id, shotId, childStatus: child.status, usage: child.usage || {} };
  if (!step.result.usageCounted && ["completed", "awaiting-review", "failed", "interrupted"].includes(child.status)) {
    run.usage.imagesGenerated = Number(run.usage.imagesGenerated || 0) + Number(child.usage?.imagesGenerated || 0);
    run.usage.imageRequests = Number(run.usage.imageRequests || 0) + Number(child.usage?.imageRequests || 0);
    run.usage.assistantCalls = Number(run.usage.assistantCalls || 0) + Number(child.usage?.assistantCalls || 0);
    run.usage.reviewCalls = Number(run.usage.reviewCalls || 0) + Number(child.usage?.reviewCalls || 0);
    step.result.usageCounted = true;
  }
  await v626SaveRun(run, false);
  if (child.status === "awaiting-review") {
    /* Same gate, same reason as v627PauseForHumanReview: the child run stopped and is
       waiting for a director, so the parent step records when its machine work ended
       instead of leaving the activity clock to run against Date.now(). */
    step.status = "needs-review"; step.completedAt = step.completedAt || v626Now(); step.updatedAt = v626Now();
    run.status = "interrupted"; run.stage = `${shotId} needs director approval`; run.phase = "child-review";
    run.summary = `${shotId} generated candidates but needs a director choice. Open the shot, approve the child run candidate, then Resume Scene Automation.`;
    await v626SaveRun(run, false);
    const error = new Error(`${shotId} needs director approval.`); error.childAttention = true; throw error;
  }
  if (child.status !== "completed") throw new Error(`${shotId} child automation ${child.status}: ${child.summary || "open the shot run for details"}`);
  const winner = v640SceneApprovedStill(shotById(shotId));
  await v626CompleteStep(run, key, { kind: "scene-shot", label: `${shotId} approved`, shotId, frameId: frame.id, winner: winner?.name || "", result: { ...(step.result || {}), childStatus: child.status } });
  return winner?.name || "";
}
async function v640RunSceneReview(run, round = 0) {
  const key = `scene-review:round-${round}`, step = v626Step(run, key, "scene-review", `Scene continuity review · pass ${round + 1}`);
  if (step.status === "completed" && step.review) return step.review;
  await v626BeginStep(run, key, "scene-review", `Review scene continuity · pass ${round + 1}`, { attempt: round + 1, maxAttempts: Number(run.config.maxCorrectionRounds || 0) + 1 });
  run.usage.reviewCalls = Number(run.usage.reviewCalls || 0) + 1;
  await v626SaveRun(run, false);
  const scene = sceneById(run.targetId), expectedChanges = String(scene?.continuityReviewSettings?.expectedChanges || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  await v641SetStepActivity(run, key, "assembling scene context", "Preparing the approved scene sequence, expected progression, and production authorities for the continuity reviewer.", { system: "VISION AI · SCENE CONTINUITY", model: CONFIG?.ai?.vision?.model || CONFIG?.ai?.model || "Configured vision model" });
  await v641SetStepActivity(run, key, "waiting for vision model", "The scene sequence was sent to the vision model for whole-scene, adjacent-shot, and shot-specific continuity analysis.", { system: "VISION AI · SCENE CONTINUITY", model: CONFIG?.ai?.vision?.model || CONFIG?.ai?.model || "Configured vision model" });
  const response = await fetch("/api/llm/review-scene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sceneId: run.targetId, expectedChanges }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Scene continuity review failed.");
  scene.continuityReview = { ...(data.review || {}), overrides: scene.continuityReview?.overrides || { intentional: {}, notes: {} }, automationRunId: run.id, automationRound: round };
  run.result = run.result || {}; run.result.sceneReview = data.review; run.result.continuityRounds = [...(run.result.continuityRounds || []), { round, review: data.review, at: v626Now() }];
  dirty(); await flushPendingProjectSave();
  await v626CompleteStep(run, key, { kind: "scene-review", label: `Scene continuity review · pass ${round + 1}`, pass: v640SceneReviewPass(data.review, run.config.strictness), score: Math.min(...Object.values(data.review?.scores || {}).map(Number).filter(Number.isFinite)), review: data.review, result: { verdict: data.review?.verdict || "", strictness: run.config.strictness } });
  return data.review;
}
function v640FindingTarget(finding, type, auto = true) {
  if (type === "shot") return finding.shotId || "";
  const ids = type === "pair" ? [finding.fromShotId, finding.toShotId].filter(Boolean) : (finding.shotIds || []).filter(Boolean);
  if (!ids.length) return "";
  const text = `${finding.recommendation || ""} ${finding.summary || ""}`;
  const named = ids.find((id) => new RegExp(`(?:modify|change|correct|fix|in|to)\\s+${String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text));
  return named || (auto ? ids.at(-1) : ids.length === 1 ? ids[0] : "");
}
function v643ApprovedCorrectionSource(shot) {
  if (!shot) return null;
  const media = v640SceneApprovedStill(shot);
  if (media?.name) return media;
  const frame = v640SceneOpeningFrame(shot);
  const name = String(shot.winner || frame?.winner || "").trim();
  if (!name) return null;
  const take = takesFor(shot.id).find((item) => item.name === name);
  return take ? { name: take.name, url: take.url } : null;
}
function v643CorrectionSourceRecord(shot, fileName) {
  return (shot?.candidateFiles || []).find((item) => String(item.stored || item.name || "") === String(fileName || "")) || null;
}
function v643HydrateSceneCorrectionPackage(pkg, run = null) {
  /* BATCH 1B: HYDRATION VALIDATES BEFORE IT DEREFERENCES.

     `const shot = shotById(...), frame = v640SceneOpeningFrame(shot), source =
     v643ApprovedCorrectionSource(shot)` ran on one line, and the guard that
     checked `!shot` was on the NEXT one. A stale target id therefore reached
     `guidedFrames(undefined)` and threw a bare `TypeError: Cannot read
     properties of undefined (reading 'clips')` — the exact error the acceptance
     audit produced from the real runner. Bare, it defaulted to the `provider`
     class and entered provider retry handling for a fault no provider could
     have caused and no retry could repair.

     Each dereference is now behind the check that makes it safe, and every
     refusal is the typed local-package error. */
  const targetShotId = String(pkg?.targetShotId || "");
  if (!targetShotId) throw v640CorrectionPackageError("This correction package names no target shot.", { packageId: pkg?.id, remediation: "Rebuild the correction from the scene continuity review." });
  const shot = shotById(targetShotId);
  if (!shot) throw v640CorrectionPackageError(`${targetShotId} no longer exists in this project.`, { packageId: pkg.id, remediation: "Remove the stale correction package and re-run the scene continuity review." });
  /* Hydration runs AFTER preflight, so the frame is known to exist — but it
     reads rather than normalises for the same reason preflight does: a hydrator
     that creates the structure it needs cannot report that it was missing. */
  const frameRead = v640SceneOpeningFrameRead(shot);
  const frame = frameRead.frame;
  if (!frameRead.ok) throw v640CorrectionPackageError(`${targetShotId} has no opening frame to correct.`, { packageId: pkg.id, remediation: `Open ${targetShotId} and add an opening frame before correcting it.` });
  const source = v643ApprovedCorrectionSource(shot);
  if (!source?.name) throw v640CorrectionPackageError(`${targetShotId} has no approved base still for correction.`, { packageId: pkg.id, remediation: `Approve a still for ${targetShotId} first — a correction edits an approved image.` });
  const record = v643CorrectionSourceRecord(shot, source.name);
  pkg.sourceCandidate = String(pkg.sourceCandidate || source.name);
  pkg.approvedTargetFilename = String(pkg.approvedTargetFilename || source.name);
  pkg.targetFrameId = String(pkg.targetFrameId || frame.id || "");
  pkg.sourceBuildId = String(pkg.sourceBuildId || record?.sourceBuildId || record?.sourcePackageId || pkg.id || "");
  pkg.sourcePackageId = String(pkg.sourcePackageId || record?.sourcePackageId || record?.sourceBuildId || pkg.id || "");
  pkg.parentBuildId = String(pkg.parentBuildId || record?.sourceBuildId || "");
  pkg.parentPackageId = String(pkg.parentPackageId || record?.sourcePackageId || "");
  pkg.provenanceRepairedAt = pkg.provenanceRepairedAt || v626Now();
  pkg.provenanceStatus = "ready";
  if (run) {
    run.result = run.result || {};
    const resultPkg = (run.result.correctionPackages || []).find((item) => item.id === pkg.id);
    if (resultPkg && resultPkg !== pkg) Object.assign(resultPkg, pkg);
    const initialPkg = (run.config?.initialCorrectionPackages || []).find((item) => item.id === pkg.id);
    if (initialPkg && initialPkg !== pkg) Object.assign(initialPkg, pkg);
  }
  const scene = sceneById(shot.scene);
  const scenePkg = (scene?.continuityCorrectionPackages || []).find((item) => item.id === pkg.id);
  if (scenePkg && scenePkg !== pkg) Object.assign(scenePkg, pkg);
  return pkg;
}
window.v643RepairSceneCorrectionRun = async (run, failedStep = null) => {
  if (!run || run.type !== "scene-chain") return run;
  const packages = [...(run.config?.initialCorrectionPackages || []), ...(run.result?.correctionPackages || [])];
  const packageId = failedStep?.packageId || String(failedStep?.key || "").match(/^scene-correction:(.+?):round-/)?.[1] || "";
  const targets = packageId ? packages.filter((item) => item.id === packageId) : packages;
  let repaired = 0;
  for (const pkg of targets) {
    const before = pkg.sourceCandidate;
    /* BATCH 1B: a provenance repair pass runs over EVERY package in the run, and
       one unrepairable package must not abort the repair of the others. The
       typed refusal is skipped here rather than thrown: this function's job is
       to fix what can be fixed, and the runner will name the rest when it
       reaches them. */
    try { v643HydrateSceneCorrectionPackage(pkg, run); }
    catch (error) { if (!error?.localPackageError) throw error; continue; }
    if (!before && pkg.sourceCandidate) repaired += 1;
  }
  if (repaired) {
    run.logs = [...(run.logs || []), { at: v626Now(), tone: "success", message: `Repaired source-candidate provenance for ${repaired} scene correction package${repaired === 1 ? "" : "s"} before retry.` }];
    run.summary = "Correction package provenance repaired. The failed generation step can now be retried without rebuilding completed work.";
    await flushPendingProjectSave();
    await v626SaveRun(run, false, false);
  }
  return run;
};
function v640SceneCorrectionPackages(run, review, cycle) {
  const candidates = [];
  (review.priorityIssues || []).forEach((item, index) => candidates.push({ type: "priority", id: item.id || `priority-${index}`, finding: item }));
  (review.pairFindings || []).forEach((item, index) => candidates.push({ type: "pair", id: `pair-${index}-${item.fromShotId}-${item.toShotId}`, finding: item }));
  (review.shotFindings || []).forEach((item, index) => candidates.push({ type: "shot", id: `shot-${index}-${item.shotId}`, finding: item }));
  const highFirst = candidates.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[String(a.finding.severity || "medium").toLowerCase()] ?? 1) - ({ high: 0, medium: 1, low: 2 }[String(b.finding.severity || "medium").toLowerCase()] ?? 1));
  const packages = [], targets = new Set();
  for (const row of highFirst) {
    if (packages.length >= Number(run.config.maxCorrectionTargets || 3)) break;
    const targetShotId = v640FindingTarget(row.finding, row.type, run.config.autoSelectCorrectionTarget !== false);
    if (!targetShotId || targets.has(targetShotId) || !shotById(targetShotId)) continue;
    targets.add(targetShotId);
    const sceneShots = v640SceneShots(run.targetId), index = sceneShots.findIndex((shot) => shot.id === targetShotId), target = sceneShots[index];
    const summary = row.finding.summary || row.finding.detail || "Scene continuity issue";
    const recommendation = row.finding.recommendation || row.finding.detail || summary;
    const pkg = {
      id: `${run.id}-cycle-${cycle}-${row.id}`,
      cycle, type: row.type, findingId: row.id, targetShotId,
      previousShotId: sceneShots[index - 1]?.id || "", nextShotId: sceneShots[index + 1]?.id || "",
      summary, recommendation, severity: row.finding.severity || "medium", status: "planned", sourceReviewAt: review.updatedAt || v626Now(),
      prompt: `SCENE CONTINUITY CORRECTION\nScene: ${sceneById(run.targetId)?.title || run.targetId}\nTarget shot: ${targetShotId} · ${target.title || ""}\nVisible continuity problem: ${summary}\nRequired repair: ${recommendation}\nEdit the current approved target still rather than redesigning the shot. Preserve character identity, wardrobe, location architecture, prop construction, art style, camera intent, and every detail not required by this correction. The result must connect logically to the approved previous and next shots.`,
    };
    /* BATCH 1B: a target that cannot be hydrated is not a package. Building one
       anyway is how an unusable row reached the runner, and the runner is where
       the crash was. Skipped and recorded here instead. */
    try { packages.push(v643HydrateSceneCorrectionPackage(pkg, run)); }
    catch (error) {
      if (!error?.localPackageError) throw error;
      targets.delete(targetShotId);
      run.logs = [...(run.logs || []), { at: v626Now(), tone: "warn", message: `${targetShotId} was skipped for correction: ${error.message}` }];
    }
  }
  run.result = run.result || {}; run.result.correctionPackages = [...(run.result.correctionPackages || []), ...packages];
  const scene = sceneById(run.targetId); scene.continuityCorrectionPackages = [...(scene.continuityCorrectionPackages || []), ...packages]; dirty();
  return packages;
}
/* PREVIOUS AND NEXT ARE OPTIONAL. The target is not.

   Every reason a neighbour can be absent — first shot, last shot, single-shot
   scene, deleted neighbour, a neighbour that exists but has no approved still —
   produces the same safe outcome here: the anchor is omitted, every valid anchor
   is preserved, and WHY it was omitted is recorded on the package so the run
   report can say so instead of the creator inferring it from a shorter list. */
function v640SceneCorrectionOptionalAnchor(shotId) {
  const id = String(shotId || "");
  if (!id) return { id: "", present: false, reason: "scene-boundary" };
  const shot = shotById(id);
  if (!shot) return { id, present: false, reason: "shot-no-longer-exists" };
  const media = v640SceneApprovedStill(shot);
  if (!media?.url) return { id, present: false, reason: "no-approved-still" };
  return { id, present: true, reason: "", shot, media };
}
function v640SceneCorrectionReferences(pkg) {
  const target = shotById(pkg.targetShotId), refs = [], omitted = [];
  const addStill = (shotId, role, label) => {
    const anchor = v640SceneCorrectionOptionalAnchor(shotId);
    if (!anchor.present) {
      if (role !== "base") omitted.push({ role, shotId: anchor.id, reason: anchor.reason });
      return;
    }
    const media = anchor.media;
    refs.push({ key: `${role}:${anchor.id}:${media.name}`, label, role, instruction: role === "base" ? "Editable target still. Preserve everything except the requested continuity correction." : "Scene continuity authority only. Do not copy its camera angle into the target shot.", url: media.url });
  };
  addStill(pkg.targetShotId, "base", `Current approved ${pkg.targetShotId}`);
  if (pkg.previousShotId) addStill(pkg.previousShotId, "continuity", `Previous shot ${pkg.previousShotId}`);
  else omitted.push({ role: "continuity", shotId: "", reason: "scene-boundary", position: "previous" });
  if (pkg.nextShotId) addStill(pkg.nextShotId, "continuity", `Next shot ${pkg.nextShotId}`);
  else omitted.push({ role: "continuity", shotId: "", reason: "scene-boundary", position: "next" });
  pkg.omittedAnchors = omitted;
  /* ==========================================================================
     THE SMALLEST TRUTHFUL INPUT PACKAGE FOR A TARGETED REPAIR.

     This used to append EVERY reference the shot's creation flow would use to
     build a frame from nothing — the location plate plus each of its coverage
     angles, every character's identity plus their coverage slots and supplemental
     media, and the shot's blocking and planning images — up to sixteen ordered
     inputs for what is a small edit to one already-approved image. The founder
     smoke reported exactly that.

     A correction is not a build. Composition, framing, lighting and staging are
     already settled BY THE BASE IMAGE, which is the editable target. What the
     repair still needs is identity that must not drift while the edit is made:
     the primary approved reference for the location, each declared character, and
     each declared prop or vehicle, plus any continuity state those declarations
     resolve to. That is the whole of it.

     WHAT IS DROPPED AND WHY:
       - `supplemental` references (coverage angles, extra media links). They exist
         to give a NEW composition alternative views. The composition is not being
         chosen here.
       - blocking / animatic / planning images. They are greyscale composition
         scaffolds for building a frame; handing one to a photographic repair of an
         approved still is an instruction to redesign the shot.

     NOTHING IS GUESSED AND NO PROVENANCE IS LOST. The filter uses the markers the
     reference builders already set — `supplemental`, `blocking`, and the role — and
     every dropped reference is recorded on the package with its role and the reason,
     so the run report can say what was not sent and why. `referenceManifest` remains
     the exact record of what WAS sent. */
  const CORRECTION_PRIMARY_ROLES = ["base", "location", "identity", "prop", "continuity-state"];
  const omittedReferences = [];
  if (target && typeof shotCreationReferences === "function") {
    for (const ref of shotCreationReferences(target).filter((item) => item.url)) {
      const role = ref.role === "base" ? "location" : ref.role;
      if (ref.supplemental === true || ref.blocking === true) {
        omittedReferences.push({ key: ref.key, label: ref.label || "", role, reason: ref.blocking === true ? "blocking-guide-not-consumed-by-a-repair" : "supplemental-view-not-needed-to-edit-an-approved-still" });
        continue;
      }
      if (!CORRECTION_PRIMARY_ROLES.includes(role)) {
        omittedReferences.push({ key: ref.key, label: ref.label || "", role, reason: "planning-input-not-consumed-by-a-repair" });
        continue;
      }
      refs.push({ ...ref, role });
    }
  }
  const seen = new Set(), finalRefs = refs.filter((ref) => ref.url && !seen.has(ref.key) && seen.add(ref.key)).slice(0, 16);
  pkg.omittedReferences = omittedReferences;
  pkg.referenceManifest = finalRefs.map((ref, index) => ({ order: index + 1, key: ref.key, label: ref.label, role: ref.role, instruction: ref.instruction || "", url: ref.url }));
  return finalRefs;
}
async function v641ReviewSceneCorrectionIncremental(run, step, payload) {
  const files = Array.isArray(payload?.fileNames) ? payload.fileNames : [];
  const reviews = [];
  step.activity = { ...(step.activity || {}), system: "VISION AI · SCENE CORRECTION", state: "reviewing candidate 1", detail: `Reviewing ${files.length} correction candidate${files.length === 1 ? "" : "s"} against the previous, target, and next approved shots.`, model: CONFIG?.ai?.vision?.model || CONFIG?.ai?.model || "Configured vision model", reviewProgress: { current: 0, total: files.length, items: files.map((file, index) => ({ file, status: index === 0 ? "reviewing" : "pending" })) }, updatedAt: v626Now() };
  await v626SaveRun(run, false);
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    step.activity.state = `reviewing candidate ${index + 1}`;
    step.activity.detail = `Vision AI is comparing ${file} with the adjacent approved shots and the scene correction requirement.`;
    step.activity.reviewProgress.current = index;
    step.activity.reviewProgress.items = files.map((name, itemIndex) => {
      const done = reviews[itemIndex];
      return done ? { file: name, status: "completed", score: Number(done.score || 0), pass: done.pass === true, note: done.notes || "" } : { file: name, status: itemIndex === index ? "reviewing" : "pending" };
    });
    step.activity.updatedAt = v626Now();
    run.usage.reviewCalls = Number(run.usage.reviewCalls || 0) + 1;
    await v626SaveRun(run, false);
    const response = await fetch("/api/llm/review-scene-correction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, fileNames: [file] }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Scene correction review failed for ${file}`);
    const row = Array.isArray(data?.review?.reviews) ? data.review.reviews[0] || {} : {};
    reviews.push({ ...row, n: index + 1 });
    step.activity.reviewProgress.current = index + 1;
    step.activity.reviewProgress.items[index] = { file, status: "completed", score: Number(row.score || 0), pass: row.pass === true, note: row.notes || "" };
    step.activity.updatedAt = v626Now();
    await v626SaveRun(run, false, false);
    if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
  }
  const ranking = [...reviews].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).map((row) => row.n);
  step.activity.state = "review complete";
  step.activity.detail = `All ${files.length} scene-correction candidate${files.length === 1 ? "" : "s"} were reviewed in context.`;
  step.activity.updatedAt = v626Now();
  await v626SaveRun(run, false, false);
  return { files, review: { reviews, ranking, suggested: ranking[0] || 1, rationale: reviews.find((row) => row.n === ranking[0])?.notes || "Scene correction candidates reviewed in context." } };
}
/* THE LOCAL GATE, before any provider code is reached.

   Only the target is structurally required: a correction edits ONE approved
   still, and the neighbours are context. This states that explicitly so the
   run fails with the missing thing named rather than with a dereference, and so
   the failure is classified as a package error that a retry cannot repair. */
function v640SceneCorrectionPreflight(pkg) {
  const errors = [];
  const targetShotId = String(pkg?.targetShotId || "");
  if (!targetShotId) errors.push({ message: "This correction package names no target shot.", remediation: "Rebuild the correction from the scene continuity review." });
  const shot = targetShotId ? shotById(targetShotId) : null;
  if (targetShotId && !shot) errors.push({ message: `${targetShotId} no longer exists in this project.`, remediation: "Remove the stale correction package and re-run the scene continuity review." });
  /* PURE READ. See v640SceneOpeningFrameRead: the old call created the frame it
     was checking for, so "missing opening frame" could not be reported. */
  const read = shot ? v640SceneOpeningFrameRead(shot) : { ok: false, frame: null, reason: "no-shot" };
  const frame = read.frame;
  if (shot && !read.ok) {
    errors.push(read.reason === "frames-malformed" || read.reason === "frame-malformed" || read.reason === "frame-has-no-id"
      ? { message: `${targetShotId} has a damaged frame record and cannot be corrected.`, remediation: `Open ${targetShotId} and rebuild its frames before correcting it.` }
      : { message: `${targetShotId} has no opening frame to correct.`, remediation: `Open ${targetShotId} and add an opening frame before correcting it.` });
  }
  if (shot && read.ok && !v640SceneApprovedStill(shot)) errors.push({ message: `${targetShotId} has no approved base still for correction.`, remediation: `Approve a still for ${targetShotId} first — a correction edits an approved image.` });
  return { errors, shot, frame };
}
/* WHAT A CORRECTION IS AIMED AT, resolved WITHOUT touching the project.

   BATCH 1B step 1. Pure string reading: no `shotById`, no `guidedFrames`, no
   `takesFor`. Its whole purpose is to exist before anything can be dereferenced,
   so a malformed package is named rather than crashed on. */
function v640CorrectionTargetIdentity(pkg) {
  const it = pkg && typeof pkg === "object" ? pkg : {};
  return {
    packageId: String(it.id || ""),
    targetShotId: String(it.targetShotId || ""),
    previousShotId: String(it.previousShotId || ""),
    nextShotId: String(it.nextShotId || ""),
    hasPrompt: !!String(it.prompt || "").trim(),
  };
}
/* WHICH NEIGHBOURS ARE USABLE, and why each unusable one is not. Runs after the
   target is known to be valid and never dereferences the target itself. */
function v640ClassifyCorrectionNeighbours(identity) {
  const omissions = [];
  for (const [position, shotId] of [["previous", identity.previousShotId], ["next", identity.nextShotId]]) {
    const anchor = v640SceneCorrectionOptionalAnchor(shotId);
    if (!anchor.present) omissions.push({ position, shotId: anchor.id, reason: anchor.reason });
  }
  return omissions;
}
/* ==========================================================================
   SCORING WHAT THE FILMMAKER ALREADY APPROVED.

   The correction reviewer's question is "does image 1 fix the stated break while
   preserving everything else". Asked of the APPROVED ORIGINAL it answers what that
   question scores when nothing was changed — which is exactly the number a
   correction has to beat to be called an improvement. Same route, same rubric,
   same adjacent shots, so the two scores are comparable by construction.

   ONE LOCAL VISION CALL PER PACKAGE. No provider request, no credits, no
   generation: the file already exists and is already approved. It is recorded as a
   run step so the creator can see the comparison was made and what it cost.

   IT FAILS CLOSED AND NEVER FAILS THE RUN. If the approved still cannot be scored
   — it is not on disk where the reviewer looks, or the reviewer errored — the
   baseline is recorded as unavailable, every candidate classifies as NOT
   COMPARABLE, and nothing may be recommended. A correction whose improvement
   cannot be demonstrated is not offered as the fix. */
async function v670EstablishCorrectionBaseline(run, pkg) {
  if (pkg.baseline && pkg.baseline.at) return pkg.baseline;
  const file = String(pkg.approvedTargetFilename || pkg.sourceCandidate || "");
  const key = `scene-correction:${pkg.id}:baseline`;
  if (!file) {
    pkg.baseline = { available: false, reason: "no-approved-original", file: "", score: null, pass: false, at: v626Now() };
    return pkg.baseline;
  }
  const existing = v626Step(run, key);
  if (existing?.status === "completed" && existing.result?.baseline) {
    pkg.baseline = existing.result.baseline;
    return pkg.baseline;
  }
  try {
    await v626BeginStep(run, key, "scene-correction-baseline", `Score the approved ${pkg.targetShotId} still for comparison`, { shotId: pkg.targetShotId, packageId: pkg.id });
    const data = await v641ReviewSceneCorrectionIncremental(run, v626Step(run, key), { sceneId: run.targetId, targetShotId: pkg.targetShotId, fileNames: [file], package: pkg });
    const row = (data.review?.reviews || [])[0] || {};
    /* SCORED, OR NOT AVAILABLE. Asked of shared-continuity.js so the baseline is
       admitted by exactly the rule that later compares it — `Number.isFinite(Number(...))`
       here was the same coercion that let a null score become a zero baseline. */
    const scored = correctionScore({ score: row.score, explicitScore: row.explicitScore });
    pkg.baseline = {
      available: scored !== null,
      reason: scored !== null ? "" : "reviewer-returned-no-score",
      file, score: scored === null ? null : Math.round(scored),
      pass: row.pass === true, notes: String(row.notes || ""), at: v626Now(),
    };
    await v626CompleteStep(run, key, { kind: "scene-correction-baseline", shotId: pkg.targetShotId, files: [file], result: { baseline: pkg.baseline, targetShotId: pkg.targetShotId, packageId: pkg.id } });
    await v626Log(run, `Approved ${pkg.targetShotId} still scored ${pkg.baseline.score}/100 on the correction review. Every candidate is compared against that.`, "info");
  } catch (error) {
    pkg.baseline = { available: false, reason: "baseline-review-failed", detail: error?.message || "", file, score: null, pass: false, at: v626Now() };
    await v626CompleteStep(run, key, { kind: "scene-correction-baseline", shotId: pkg.targetShotId, files: [file], result: { baseline: pkg.baseline, targetShotId: pkg.targetShotId, packageId: pkg.id } });
    await v626Log(run, `The approved ${pkg.targetShotId} still could not be scored for comparison (${error?.message || "review failed"}). No correction candidate can be recommended without it.`, "warn");
  }
  dirty();
  return pkg.baseline;
}
/* Every reviewed candidate against the baseline, as data on the step. The gate
   renders these words; it does not derive them. */
function v670ClassifyCorrectionCandidates(pkg, reviewStep) {
  const baseline = pkg.baseline || null;
  const files = reviewStep.files || [];
  const rows = Array.isArray(reviewStep.review?.reviews) ? reviewStep.review.reviews : [];
  const verdicts = {};
  for (let index = 0; index < files.length; index++) {
    const row = rows.find((item) => Number(item.n) === index + 1) || {};
    /* `explicitScore` travels with the score. The server clamps an unstated score
       to 0 and flags it here; without the flag a reviewer that returned nothing
       would look like a candidate that genuinely scored zero. */
    verdicts[files[index]] = classifyCorrectionOutcome(baseline, { score: row.score, pass: row.pass === true, explicitScore: row.explicitScore });
  }
  return { baseline, verdicts };
}
async function v640AutomateSceneCorrection(run, pkg) {
  /* THE ORDER, and it is the whole repair.

     The acceptance audit executed this function with a stale target and got an
     unclassified `TypeError` out of hydration, because hydration ran FIRST and
     the typed preflight ran second. Validation cannot come after the thing it
     is meant to protect.

       1  resolve identity              — pure, cannot throw on bad state
       2  validate target shot/frame    — typed refusal, no dereference before it
       3  validate package shape        — typed refusal
       4  resolve optional neighbours   — never required
       5  classify omissions            — recorded, never fatal
       6  hydrate                       — now provably safe
       7  final local preflight         — the last check before spend
       8  submit

     Steps 1-7 contact nothing, create no job row and consume no retry budget. */
  const identity = v640CorrectionTargetIdentity(pkg);
  const preflight = v640SceneCorrectionPreflight(pkg);
  if (preflight.errors.length) {
    throw v640CorrectionPackageError(
      preflight.errors.map((item) => item.message).join(" "),
      { packageId: identity.packageId, remediation: preflight.errors.map((item) => item.remediation).filter(Boolean).join(" ") },
    );
  }
  if (!identity.hasPrompt) {
    throw v640CorrectionPackageError(
      `The ${identity.targetShotId} correction package carries no correction instruction.`,
      { packageId: identity.packageId, remediation: "Re-run the scene continuity review so the correction is rebuilt with its finding and recommendation." },
    );
  }
  /* Steps 4-5. Recorded on the package so the run report can say which anchors
     were dropped and why, instead of the creator inferring it from a short list. */
  pkg.omittedAnchors = v640ClassifyCorrectionNeighbours(identity);
  /* Step 6. Safe now: the target has been proved to exist, to have an opening
     frame, and to have an approved still. */
  pkg = v643HydrateSceneCorrectionPackage(pkg, run);
  /* Step 7. Re-asked against the hydrated package, because hydration is the
     step that resolves the source candidate the submission depends on. */
  const hydratedPreflight = v640SceneCorrectionPreflight(pkg);
  if (hydratedPreflight.errors.length) {
    throw v640CorrectionPackageError(
      hydratedPreflight.errors.map((item) => item.message).join(" "),
      { packageId: pkg.id, remediation: hydratedPreflight.errors.map((item) => item.remediation).filter(Boolean).join(" ") },
    );
  }
  const shot = hydratedPreflight.shot, frame = hydratedPreflight.frame;
  /* THE BASELINE. Scored once per package, before any candidate exists, so every
     round of this correction is measured against the same number. */
  await v670EstablishCorrectionBaseline(run, pkg);
  let revision = "";
  for (let round = 1; round <= Number(run.config.correctionPasses || 3); round++) {
    const baseKey = `scene-correction:${pkg.id}:round-${round}`, genKey = `${baseKey}:generate`, reviewKey = `${baseKey}:review`;
    const genStep = v626Step(run, genKey, "generation", `Correct ${pkg.targetShotId} · round ${round}`);
    if (genStep.status !== "completed") {
      await v626BeginStep(run, genKey, "generation", `Generate ${v640OutputsPerRequest(run)} ${pkg.targetShotId} continuity corrections · round ${round}`, { shotId: pkg.targetShotId, frameId: frame.id, attempt: round, maxAttempts: run.config.correctionPasses, packageId: pkg.id, buildId: pkg.sourceBuildId || pkg.id });
      const prompt = `${pkg.prompt}${revision ? `\n\nPREVIOUS REVIEW REVISION\n${revision}` : ""}`;
      const references = v640SceneCorrectionReferences(pkg);
      const job = await v626WaitFalJob(run, genStep, { purpose: "correction", shotId: pkg.targetShotId, frameId: frame.id, frameLabel: frame.label || "A", sourceBuildId: pkg.sourceBuildId || pkg.id, packageId: pkg.id, parentBuildId: pkg.parentBuildId || "", parentPackageId: pkg.parentPackageId || "", sourceCandidate: pkg.sourceCandidate, prompt, references, outputCount: v640OutputsPerRequest(run), quality: v6211RunGenerationSettings(run).frameQuality, resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: ensureShotCreation(shot).composition?.aspectRatio || P.meta?.aspectRatio || "16:9" });
      await v626CompleteStep(run, genKey, { kind: "generation", shotId: pkg.targetShotId, frameId: frame.id, childJobId: job.id, files: (job.outputs || []).map((item) => item.name), result: { targetShotId: pkg.targetShotId, outputs: job.outputs || [], usageCounted: true } });
    }
    const files = v626Step(run, genKey).files || [];
    if (!files.length) throw new Error(`${pkg.targetShotId} correction candidates are unavailable.`);
    const reviewStep = v626Step(run, reviewKey, "scene-correction-review", `Review ${pkg.targetShotId} continuity correction · round ${round}`);
    if (reviewStep.status !== "completed") {
      await v626BeginStep(run, reviewKey, "scene-correction-review", `Review ${pkg.targetShotId} correction in scene context · round ${round}`, { shotId: pkg.targetShotId, frameId: frame.id, attempt: round, maxAttempts: run.config.correctionPasses });
      const data = await v641ReviewSceneCorrectionIncremental(run, reviewStep, { sceneId: run.targetId, targetShotId: pkg.targetShotId, fileNames: files, package: pkg });
      const picked = v626Pick(data, run);
      /* THE COMPARISON, RECORDED BEFORE THE STEP CLOSES. `recommend` now requires
         the picked candidate to be a demonstrated improvement on the approved
         original, not merely the best of this pass. A pass that only produced
         regressions recommends nothing at all. */
      const comparison = v670ClassifyCorrectionCandidates(pkg, { files, review: data.review });
      const pickedVerdict = comparison.verdicts[picked.file] || { outcome: "unknown", delta: null };
      const recommend = picked.recommend && recommendableCorrection(pickedVerdict);
      await v626CompleteStep(run, reviewKey, { kind: "scene-correction-review", shotId: pkg.targetShotId, frameId: frame.id, pass: picked.pass, score: picked.score, winner: picked.file, files, review: data.review, revision: picked.pass ? "" : picked.note || picked.rationale, result: { targetShotId: pkg.targetShotId, rationale: picked.rationale, recommend, explicitPass: picked.explicitPass, explicitScore: picked.explicitScore, threshold: v640RecommendationScore(run), baseline: comparison.baseline, correctionVerdicts: comparison.verdicts, winnerOutcome: pickedVerdict.outcome } });
      if (!recommend && picked.recommend) {
        await v626Log(run, `${picked.file} scored ${picked.score}/100 but is not an improvement on the approved ${pkg.targetShotId} still (${pickedVerdict.outcome}). It is not offered as the fix.`, "warn");
      }
    }
    const reviewed = v626Step(run, reviewKey);
    /* CORRECTION AUTOMATION IS SUBJECT TO THE SAME INVARIANT. This branch used to
       fire on `autoApprove` OR `humanApproved` and stamped `approval: "automatic"`
       on the package — a correction becoming canon with nobody in the loop, on
       exactly the same terms as the frame path. Only a human decision reaches it
       now, and the package records `director` because that is the only actor that
       can get here. */
    /* BATCH 1C: AUTOMATION MINTS NOTHING. This branch read a cached
       `result.humanApproved` and then built itself a credential from it — the
       re-audit cited this exact line as proof the builder was not confined to a
       trusted human event. A correction is approved the way everything else is:
       at the gate, by a person, in the run modal. The branch is unreachable now
       because automation cannot obtain a capability, so it is removed rather
       than left as a trap. */
    if (reviewed.pass && reviewed.winner && reviewed.result?.recommend) {
      pkg.recommendation = automationRecommendation({
        file: reviewed.winner, score: reviewed.score, threshold: v640RecommendationScore(run),
        rationale: reviewed.result?.rationale || "", runId: run.id, stepKey: reviewKey, at: v626Now(),
      });
      dirty();
      await v626Log(run, `${pkg.targetShotId} correction has a strong candidate: ${reviewed.winner} (${Math.round(Number(reviewed.score || 0))}/100). Your approval is what makes it canon.`, "success");
    }
    if ((reviewed.pass && reviewed.winner) || round >= Number(run.config.correctionPasses || 3)) {
      pkg.status = "needs-review"; pkg.candidateFiles = reviewed.files || files;
      reviewed.status = "needs-review"; reviewed.shotId = pkg.targetShotId; reviewed.frameId = frame.id; reviewed.result = { ...(reviewed.result || {}), targetShotId: pkg.targetShotId, packageId: pkg.id };
      await v627PauseForHumanReview(run, reviewed, `Approve ${pkg.targetShotId} scene correction`);
    }
    revision = reviewed.revision || "Strengthen the requested continuity repair while preserving all unaffected details.";
  }
  throw new Error(`${pkg.targetShotId} correction did not pass after ${Number(run.config.correctionPasses || 3)} rounds.`);
}
async function runSceneAutomation(runId) {
  if (V626_ACTIVE_AUTOMATION_RUNS.has(runId)) return;
  let run;
  try { run = await v627AcquireAutomationLease(runId); }
  catch (error) { toast(error.code === "RUN_LEASED" ? "This scene run is active in another CineBraid window" : error.message); return; }
  try {
    const scene = sceneById(run.targetId); if (!scene) throw new Error("Scene no longer exists.");
    const approvedShotIds = v640SceneShots(run.targetId).filter((shot) => v640SceneApprovedStill(shot)).map((shot) => shot.id);
    if (run.config.correctionOnly) {
      const packages = Array.isArray(run.config.initialCorrectionPackages) ? run.config.initialCorrectionPackages : [];
      if (!packages.length) throw new Error("Correction-only run has no correction package.");
      await v626Log(run, `Starting correction-only scene run for ${packages.map((item) => item.targetShotId).join(", ")} with a ${run.config.maxImages}-image cap.`, "info");
      for (const pkg of packages) {
        await v626SetStage(run, `Correct ${pkg.targetShotId}`, "scene-correction", pkg.summary || "Scene continuity correction");
        await v640AutomateSceneCorrection(run, pkg);
      }
      const review = await v640RunSceneReview(run, 0);
      await v626FinishRun(run, "completed", v640SceneReviewPass(review, run.config.strictness) ? "Correction approved and the scene continuity review now passes." : "Correction approved. The scene review was re-run and still contains continuity notes for director review.");
      return toast("Scene correction automation completed");
    }
    if (run.config.reviewOnly) {
      await v626Log(run, `Starting review-only scene automation with ${approvedShotIds.length} approved stills and a ${run.config.maxImages}-image correction cap.`, "info");
    } else {
      await v626Log(run, `Continuing ${run.config.mode || "hybrid"} scene automation for ${(run.config.shotIds || []).length} selected shots; ${approvedShotIds.length} approved stills are already available as continuity context.`, "info");
    }
    for (const shotId of run.config.shotIds || []) {
      await v626CheckCancelled(run);
      await v626SetStage(run, `${shotId} still`, "scene-shot", `Building approved scene stills. ${v640SceneRemainingBudget(run)} image slots remain.`);
      await v640RunSceneShot(run, shotId, approvedShotIds);
      if (!approvedShotIds.includes(shotId)) approvedShotIds.push(shotId);
    }
    if (!run.config.continuityReview) {
      await v626FinishRun(run, "completed", `${approvedShotIds.length} scene shot${approvedShotIds.length === 1 ? "" : "s"} processed. Continuity review was disabled.`);
      return toast("Scene still automation completed");
    }
    for (let cycle = 0; cycle <= Number(run.config.maxCorrectionRounds || 0); cycle++) {
      await v626SetStage(run, `Continuity review ${cycle + 1}`, "scene-review", "Reviewing the approved sequence for viewer-facing continuity breaks.");
      const review = await v640RunSceneReview(run, cycle);
      if (v640SceneReviewPass(review, run.config.strictness)) {
        await v626FinishRun(run, "completed", `Scene continuity passed after ${cycle + 1} review pass${cycle ? "es" : ""}. ${run.usage.imagesGenerated} images generated within the ${run.config.maxImages}-image cap.`);
        return toast("Scene automation completed with continuity pass");
      }
      if (!run.config.correctionLoop || cycle >= Number(run.config.maxCorrectionRounds || 0)) {
        await v626FinishRun(run, "completed", `Scene stills are approved, but continuity review still has flagged issues after ${cycle + 1} pass${cycle ? "es" : ""}. Open the scene report for director decisions.`);
        return toast("Scene automation completed with continuity flags");
      }
      const packages = v640SceneCorrectionPackages(run, review, cycle + 1);
      if (!packages.length) {
        await v626FinishRun(run, "completed", "Continuity review found issues, but no safe automatic correction target could be selected. Use the scene report to choose a repair strategy.");
        return toast("Scene needs a correction target decision");
      }
      await v626SaveRun(run, false); await flushPendingProjectSave();
      for (const pkg of packages) {
        await v626CheckCancelled(run);
        if (v640SceneRemainingBudget(run) < v640OutputsPerRequest(run)) throw new Error("Scene image cap reached before the next continuity correction.");
        await v626SetStage(run, `Correct ${pkg.targetShotId}`, "scene-correction", pkg.summary);
        await v640AutomateSceneCorrection(run, pkg);
      }
    }
  } catch (error) {
    if (error?.reviewRequired || error?.childAttention) toast(error?.childAttention ? "A shot needs director approval before the scene can continue" : "Scene correction paused for your approval");
    else {
      const interrupted = error?.cancelled || error?.leaseLost || error?.pollDeferred || v626RunCancelled(run);
      if (!interrupted && run.current?.stepKey) await v626FailStep(run, run.current.stepKey, error);
      const summary = error?.leaseLost ? "Scene automation lease was lost. Progress is preserved; choose Resume Run." : error?.pollDeferred ? "Provider work is still active. Resume later without resubmitting." : interrupted ? "Scene run stopped safely. Resume later without repeating completed work." : `${error.message || "Scene automation stopped"} Use Retry Failed Step to retry only the failed operation.`;
      await v628FinishRunAfterError(run, interrupted ? "interrupted" : "failed", summary, error);
      toast(interrupted ? "Scene automation paused safely" : `Scene automation stopped: ${error.message}`);
    }
  } finally { await v627ReleaseAutomationLease(run); route(); }
}
window.runSceneAutomation = runSceneAutomation;

function v640SceneFinding(sceneId, type, ref) {
  const scene = sceneById(sceneId), report = scene?.continuityReview || {};
  if (type === "shot") return (report.shotFindings || []).find((row) => String(row.shotId) === String(ref)) || null;
  if (type === "pair") return (report.pairFindings || []).find((row) => `${row.fromShotId || "from"}__${row.toShotId || "to"}` === String(ref)) || null;
  if (type === "priority") return (report.priorityIssues || []).find((row, index) => String(row.id || index) === String(ref)) || null;
  return null;
}
function v640ManualCorrectionPackage(sceneId, type, ref, targetShotId, promptText) {
  const scene = sceneById(sceneId), item = v640SceneFinding(sceneId, type, ref), sceneShots = v640SceneShots(sceneId);
  if (!scene || !item || !targetShotId) return null;
  const index = sceneShots.findIndex((shot) => shot.id === targetShotId), target = sceneShots[index];
  if (!target) return null;
  const pkg = {
    id: `scene-correction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    cycle: 0, type, findingId: ref, targetShotId,
    previousShotId: sceneShots[index - 1]?.id || "", nextShotId: sceneShots[index + 1]?.id || "",
    summary: item.summary || item.detail || "Scene continuity issue",
    recommendation: item.recommendation || item.detail || item.summary || "Correct the visible scene continuity break.",
    severity: item.severity || "medium", status: "planned", sourceReviewAt: scene.continuityReview?.updatedAt || v626Now(),
    prompt: String(promptText || "").trim() || `SCENE CONTINUITY CORRECTION\nScene: ${scene.title || scene.id}\nTarget shot: ${targetShotId} · ${target.title || ""}\nVisible continuity problem: ${item.summary || item.detail || "Scene continuity issue"}\nRequired repair: ${item.recommendation || item.detail || item.summary || "Correct the continuity break."}\nEdit the current approved target still. Preserve character identity, wardrobe, location architecture, prop construction, art style, camera intent, and every detail not required by this correction.`,
  };
  return v643HydrateSceneCorrectionPackage(pkg);
}
window.saveSceneFindingCorrectionPackage = async (sceneId, type, ref, automate = false) => {
  const targetShotId = document.getElementById("scene-correction-target")?.value || "";
  const promptText = document.getElementById("scene-review-correction-text")?.value || "";
  const pkg = v640ManualCorrectionPackage(sceneId, type, ref, targetShotId, promptText);
  if (!pkg) return toast("Choose the shot that should be repaired.");
  const scene = sceneById(sceneId);
  scene.continuityCorrectionPackages = [...(scene.continuityCorrectionPackages || []), pkg];
  dirty(); await flushPendingProjectSave();
  if (!automate) { closeModal(); route(); return toast(`Correction package created for ${targetShotId}.`); }
  if (!falGenerationReady()) return toast("Enable FAL image generation before automating the correction.");
  const generationSettings = v6211AutomationGenerationSettings();
  const outputs = Math.max(1, Math.min(4, Number(document.getElementById("scene-correction-outputs")?.value || 3)));
  const passes = Math.max(1, Math.min(8, Number(document.getElementById("scene-correction-passes")?.value || 4)));
  const maxImages = outputs * passes;
  const run = v626NewRun("scene-chain", sceneId, `correction:${pkg.id}`, `${scene.title || sceneId} correction`, "correction-only", {
    shotIds: [], narrativeShotIds: v640SceneShots(sceneId).map((shot) => shot.id), mode: "correction-only", correctionOnly: true,
    reuseApproved: true, continuityReview: true, correctionLoop: true, initialCorrectionPackages: [pkg], correctionPasses: passes,
    maxCorrectionRounds: 0, maxCorrectionTargets: 1, outputsPerRequest: outputs, autoApproveScore: 85, strictness: "normal",
    maxImages, generationSettings,
  });
  run.result = { correctionPackages: [pkg], continuityRounds: [] };
  closeModal();
  const saved = await v626CreateRun(run);
  location.hash = `#/shot/${targetShotId}`;
  setTimeout(() => typeof openGlobalAutomationActivity === "function" && openGlobalAutomationActivity(saved.id), 150);
  runSceneAutomation(saved.id);
};

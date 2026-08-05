/* CineBraid v6.6.4-studio.4 — manual, stage, full-shot, and scene still automation with blocking review, budgets, continuity review, and bounded correction loops. Motion generation remains manual. */
const V626_ACTIVE_AUTOMATION_RUNS = new Set();
const V627_AUTOMATION_AUTO_APPROVE_SCORE = 85;
const V627_AUTOMATION_HEARTBEATS = new Map();
const V628_AUTOMATION_LEASE_LOST_RUNS = new Set();
const V628_AUTOMATION_HEARTBEAT_MS = 60_000;
const V628_FAL_POLL_TIMEOUT_MS = Math.max(60_000, Number(globalThis.CINEBRAID_AUTOMATION_POLL_TIMEOUT_MS || 30 * 60_000));
const V627_AUTOMATION_RUNNER_ID = (() => {
  try {
    const existing = sessionStorage.getItem("cinebraid-automation-runner-id");
    if (existing) return existing;
    const created = `runner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem("cinebraid-automation-runner-id", created);
    return created;
  } catch {
    return `runner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
})();

function v6211AutomationGenerationSettings() {
  const cfg = CONFIG?.generation?.fal || {};
  const quality = (value, fallback) => ["low", "medium", "high"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : fallback;
  const resolution = (value, fallback) => ["1k", "2k", "4k"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : fallback;
  return {
    blockingQuality: quality(cfg.blockingQuality, "low"),
    blockingResolution: resolution(cfg.blockingResolution, "1k"),
    frameQuality: quality(cfg.frameQuality, "high"),
    frameResolution: resolution(cfg.frameResolution, "1k"),
  };
}
function v6211RunGenerationSettings(run) {
  return { ...v6211AutomationGenerationSettings(), ...(run?.config?.generationSettings || {}) };
}
function v640OutputsPerRequest(run) {
  return Math.max(1, Math.min(4, Math.round(Number(run?.config?.outputsPerRequest || 3))));
}
function v640AutoApproveScore(run) {
  return Math.max(50, Math.min(100, Math.round(Number(run?.config?.autoApproveScore || V627_AUTOMATION_AUTO_APPROVE_SCORE))));
}
function v640RunDispatch(run) {
  if (!run) return;
  if (run.type === "shot-chain") return runShotAutomation(run.id);
  if (run.type === "scene-chain" && typeof runSceneAutomation === "function") return runSceneAutomation(run.id);
  return runEntityAutomation(run.id);
}
function v6211GenerationLabel(settings, kind = "frame") {
  const quality = kind === "blocking" ? settings.blockingQuality : settings.frameQuality;
  const resolution = kind === "blocking" ? settings.blockingResolution : settings.frameResolution;
  return `${String(resolution || "1k").toUpperCase()} / ${String(quality || "low").replace(/^./, (c) => c.toUpperCase())}`;
}
function v6211GenerationProfileMarkup(settings) {
  return `<div class="automation-generation-profile"><span><b>Blocking</b>${esc(v6211GenerationLabel(settings, "blocking"))}</span><span><b>Frames & references</b>${esc(v6211GenerationLabel(settings, "frame"))}</span></div>`;
}

function v6211GenerationControlsMarkup(settings, scope, options = {}) {
  const includeBlocking = options.includeBlocking !== false;
  const includeFrame = options.includeFrame !== false;
  const includeOutputs = options.includeOutputs !== false;
  const outputs = Math.max(1, Math.min(4, Number(options.outputs || 3)));
  const qualityOptions = (selected) => ["low","medium","high"].map((value) => `<option value="${value}" ${value===selected?"selected":""}>${value[0].toUpperCase()+value.slice(1)}</option>`).join("");
  const resolutionOptions = (selected) => ["1k","2k","4k"].map((value) => `<option value="${value}" ${value===selected?"selected":""}>${value.toUpperCase()}</option>`).join("");
  const rows = [];
  if (includeOutputs) rows.push(`<label><span>Images per pass</span><select id="${attr(scope)}-auto-outputs" onchange="v6211SyncGenerationControls('${attr(scope)}')">${[1,2,3,4].map((n)=>`<option value="${n}" ${n===outputs?"selected":""}>${n}</option>`).join("")}</select></label>`);
  if (includeBlocking) {
    rows.push(`<label><span>Blocking quality</span><select id="${attr(scope)}-auto-blocking-quality" onchange="v6211SyncGenerationControls('${attr(scope)}')">${qualityOptions(settings.blockingQuality || "low")}</select></label>`);
    rows.push(`<label><span>Blocking resolution</span><select id="${attr(scope)}-auto-blocking-resolution" onchange="v6211SyncGenerationControls('${attr(scope)}')">${resolutionOptions(settings.blockingResolution || "1k")}</select></label>`);
  }
  if (includeFrame) {
    rows.push(`<label><span>Frame / reference quality</span><select id="${attr(scope)}-auto-frame-quality" onchange="v6211SyncGenerationControls('${attr(scope)}')">${qualityOptions(settings.frameQuality || "high")}</select></label>`);
    rows.push(`<label><span>Frame / reference resolution</span><select id="${attr(scope)}-auto-frame-resolution" onchange="v6211SyncGenerationControls('${attr(scope)}')">${resolutionOptions(settings.frameResolution || "1k")}</select></label>`);
  }
  return `<section class="automation-generation-controls"><header><span>GENERATION SETTINGS</span><b>Choose cost and output settings before automation starts</b></header><div>${rows.join("")}</div></section>`;
}
function v6211DraftForScope(scope) {
  if (scope === "blocking") return window._v626BlockingAutomationDraft;
  if (scope === "shot") return window._v626ShotAutomationDraft;
  if (scope === "entity") return window._v626EntityAutomationDraft;
  if (scope === "scene") return window._v640SceneDraft;
  return null;
}
window.v6211SyncGenerationControls = (scope) => {
  const draft = v6211DraftForScope(scope);
  if (!draft) return;
  const settings = { ...(draft.generationSettings || v6211AutomationGenerationSettings()) };
  const read = (id, fallback) => document.getElementById(id)?.value || fallback;
  settings.blockingQuality = read(`${scope}-auto-blocking-quality`, settings.blockingQuality);
  settings.blockingResolution = read(`${scope}-auto-blocking-resolution`, settings.blockingResolution);
  settings.frameQuality = read(`${scope}-auto-frame-quality`, settings.frameQuality);
  settings.frameResolution = read(`${scope}-auto-frame-resolution`, settings.frameResolution);
  draft.generationSettings = settings;
  draft.outputsPerRequest = Math.max(1, Math.min(4, Number(read(`${scope}-auto-outputs`, draft.outputsPerRequest || 3))));
  if (scope === "blocking" && typeof updateBlockingAutomationEstimate === "function") updateBlockingAutomationEstimate();
  if (scope === "shot" && typeof updateShotAutomationEstimate === "function") updateShotAutomationEstimate();
  if (scope === "entity" && typeof updateEntityChainEstimate === "function" && document.getElementById("v626-entity-chain-note")) updateEntityChainEstimate();
  if (scope === "scene" && typeof updateSceneAutomationEstimate === "function") updateSceneAutomationEstimate();
};

function v626Runs() { return Array.isArray(AUTOMATION_RUNS) ? AUTOMATION_RUNS : []; }
function v626LatestRun(type, targetId, scope = "main") {
  return v626Runs().filter((run) => run.type === type && run.targetId === targetId && (run.scope || "main") === (scope || "main") && run.status !== "archived")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}
function v626ReplaceRun(run) {
  AUTOMATION_RUNS = [...v626Runs().filter((item) => item.id !== run.id), run];
  if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
  return run;
}
async function v626SaveRun(run, create = false, render = true) {
  if (!run) return null;
  const response = await fetch(create ? "/api/automation/runs" : `/api/automation/runs/${encodeURIComponent(run.id)}`, {
    method: create ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(run),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.run) {
      Object.assign(run, data.run);
      v626ReplaceRun(data.run);
      if (render) route();
    }
    const error = new Error(data.error || "Could not save automation run");
    error.code = data.code || "RUN_SAVE_FAILED";
    if (data.run?.cancelRequested) error.cancelled = true;
    throw error;
  }
  Object.assign(run, data.run);
  v626ReplaceRun(data.run);
  if (render) route();
  return data.run;
}
async function v626RefreshRun(runId, render = true) {
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(runId)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load automation run");
  v626ReplaceRun(data.run);
  if (render) route();
  return data.run;
}
function v626Now() { return new Date().toISOString(); }
function v626NewRun(type, targetId, scope, label, mode, config = {}) {
  return {
    schemaVersion: 2,
    revision: 1,
    id: `automation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type, targetId, scope: scope || "main", label, mode,
    status: "running", stage: "Starting", phase: "preflight", summary: "",
    current: {}, config, result: {}, usage: { imageRequests: 0, imagesGenerated: 0, assistantCalls: 0, reviewCalls: 0 },
    steps: {}, logs: [], cancelRequested: false, runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "", leaseDiagnostics: {}, createdAt: v626Now(), updatedAt: v626Now(), completedAt: "",
  };
}
async function v626CreateRun(run) { return v626SaveRun(run, true); }
function v627LeaseActive(run) {
  const expires = Date.parse(run?.leaseExpiresAt || "");
  return !!run?.runnerId && Number.isFinite(expires) && expires > Date.now();
}
function v627LeaseHeldHere(run) { return v627LeaseActive(run) && run.runnerId === V627_AUTOMATION_RUNNER_ID; }
async function v628MarkAutomationLeaseLost(run, error) {
  if (!run?.id) return;
  const timer = V627_AUTOMATION_HEARTBEATS.get(run.id);
  if (timer) clearInterval(timer);
  V627_AUTOMATION_HEARTBEATS.delete(run.id);
  V626_ACTIVE_AUTOMATION_RUNS.delete(run.id);
  V628_AUTOMATION_LEASE_LOST_RUNS.add(run.id);
  run.current = { ...(run.current || {}), leaseLost: true };
  run.summary = `Automation lease lost — progress is preserved. Return to this run and choose Resume Run before any further paid request or approval. ${String(error?.message || "").trim()}`.trim();
  v626ReplaceRun(run);
  try { route(); } catch {}
  try { toast("Automation lease lost — Resume Run is required"); } catch {}
}
async function v628HeartbeatAutomationLease(run, options = {}) {
  if (!run?.id) return false;
  try {
    const heartbeat = await fetch(`/api/automation/runs/${encodeURIComponent(run.id)}/heartbeat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runnerId: V627_AUTOMATION_RUNNER_ID }),
    });
    const payload = await heartbeat.json();
    if (!heartbeat.ok) {
      const error = new Error(payload.error || "Automation lease was lost");
      error.code = payload.code || "LEASE_LOST";
      if (payload.run) { Object.assign(run, payload.run); v626ReplaceRun(payload.run); }
      throw error;
    }
    Object.assign(run, payload.run || {});
    run.current = { ...(run.current || {}), leaseLost: false };
    v626ReplaceRun(payload.run || run);
    V628_AUTOMATION_LEASE_LOST_RUNS.delete(run.id);
    return true;
  } catch (error) {
    if (options.visibleFailure !== false) await v628MarkAutomationLeaseLost(run, error);
    return false;
  }
}
async function v628RequireAutomationLease(run) {
  if (!run?.id || V628_AUTOMATION_LEASE_LOST_RUNS.has(run.id) || !v627LeaseHeldHere(run)) {
    const error = new Error("Automation lease is not held. Progress is preserved; choose Resume Run.");
    error.code = "LEASE_LOST";
    error.leaseLost = true;
    await v628MarkAutomationLeaseLost(run, error);
    throw error;
  }
  const verified = await v628HeartbeatAutomationLease(run, { visibleFailure: true });
  if (!verified) {
    const error = new Error("Automation lease could not be revalidated. Progress is preserved; choose Resume Run.");
    error.code = "LEASE_LOST";
    error.leaseLost = true;
    throw error;
  }
  return true;
}
function v628StartAutomationHeartbeat(run, heartbeatMs = V628_AUTOMATION_HEARTBEAT_MS) {
  if (V627_AUTOMATION_HEARTBEATS.has(run.id)) clearInterval(V627_AUTOMATION_HEARTBEATS.get(run.id));
  const timer = setInterval(() => { v628HeartbeatAutomationLease(run); }, Math.max(30_000, Number(heartbeatMs || V628_AUTOMATION_HEARTBEAT_MS)));
  V627_AUTOMATION_HEARTBEATS.set(run.id, timer);
}
async function v627AcquireAutomationLease(runId) {
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(runId)}/lease`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runnerId: V627_AUTOMATION_RUNNER_ID }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.run) v626ReplaceRun(data.run);
    route();
    const error = new Error(data.error || "Could not acquire automation run");
    error.code = data.code || "RUN_LEASE_FAILED";
    throw error;
  }
  const run = v626ReplaceRun(data.run);
  V626_ACTIVE_AUTOMATION_RUNS.add(run.id);
  V628_AUTOMATION_LEASE_LOST_RUNS.delete(run.id);
  v628StartAutomationHeartbeat(run, data.heartbeatMs || Math.min(V628_AUTOMATION_HEARTBEAT_MS, Math.floor(Number(data.leaseMs || 300_000) / 3)));
  return run;
}

async function v6211RevalidatePaidStepLease(run, step) {
  if (!run?.id) throw Object.assign(new Error("Automation run is unavailable."), { code: "LEASE_LOST", leaseLost: true });
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(run.id)}/lease/revalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runnerId: V627_AUTOMATION_RUNNER_ID, stepKey: step?.key || "" }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.run) { Object.assign(run, data.run); v626ReplaceRun(data.run); }
    const error = new Error(data.error || "Automation lease could not be revalidated before the paid request.");
    error.code = data.code || "LEASE_LOST";
    error.leaseLost = true;
    await v628MarkAutomationLeaseLost(run, error);
    throw error;
  }
  Object.assign(run, data.run || {});
  v626ReplaceRun(data.run || run);
  V626_ACTIVE_AUTOMATION_RUNS.add(run.id);
  V628_AUTOMATION_LEASE_LOST_RUNS.delete(run.id);
  return data.run || run;
}

async function v627ReleaseAutomationLease(run) {
  if (!run?.id) return;
  const leaseWasLost = V628_AUTOMATION_LEASE_LOST_RUNS.has(run.id) || run.current?.leaseLost;
  const timer = V627_AUTOMATION_HEARTBEATS.get(run.id);
  if (timer) clearInterval(timer);
  V627_AUTOMATION_HEARTBEATS.delete(run.id);
  V626_ACTIVE_AUTOMATION_RUNS.delete(run.id);
  try {
    const response = await fetch(`/api/automation/runs/${encodeURIComponent(run.id)}/release`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runnerId: V627_AUTOMATION_RUNNER_ID, reason: leaseWasLost ? "lease-lost" : String(run.status || "normal") }),
    });
    const data = await response.json();
    if (response.ok && data.run) {
      Object.assign(run, data.run);
      v626ReplaceRun(data.run);
    }
  } catch {}
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    for (const runId of [...V626_ACTIVE_AUTOMATION_RUNS]) {
      const run = v626Runs().find((item) => item.id === runId);
      if (run) v628HeartbeatAutomationLease(run);
    }
  });
}

function v626Step(run, key, kind = "task", label = "") {
  run.steps = run.steps || {};
  run.steps[key] = run.steps[key] || { key, operationKey: key, kind, label, status: "pending", files: [], updatedAt: v626Now() };
  return run.steps[key];
}
async function v641SetStepActivity(run, key, state, detail, extra = {}, save = true) {
  const step = v626Step(run, key);
  step.activity = { ...(step.activity || {}), state: String(state || "working"), detail: String(detail || ""), updatedAt: v626Now(), ...extra };
  step.updatedAt = v626Now();
  run.current = { ...(run.current || {}), stepKey: key, label: step.label || key, phase: step.kind || run.phase };
  if (save) await v626SaveRun(run, false, false);
  if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
  return step;
}
async function v626BeginStep(run, key, kind, label, extra = {}) {
  const step = v626Step(run, key, kind, label);
  if (step.status === "completed" || step.status === "skipped") return step;
  Object.assign(step, extra, { kind, label, status: "running", error: "", startedAt: step.startedAt || v626Now(), updatedAt: v626Now() });
  step.activity = { ...(step.activity || {}), state: "starting", detail: step.activity?.detail || `Starting ${label || key}.`, startedAt: step.activity?.startedAt || v626Now(), updatedAt: v626Now() };
  run.current = { ...(run.current || {}), stepKey: key, label, phase: kind };
  run.stage = label;
  run.phase = kind;
  return v626SaveRun(run, false);
}
async function v626CompleteStep(run, key, result = {}) {
  const step = v626Step(run, key);
  Object.assign(step, result, { status: result.status || "completed", completedAt: v626Now(), updatedAt: v626Now(), error: "" });
  step.activity = { ...(step.activity || {}), ...(result.activity || {}), state: result.status === "needs-review" ? "awaiting approval" : "completed", detail: result.activity?.detail || step.activity?.detail || `${step.label || key} completed.`, updatedAt: v626Now() };
  run.current = { ...(run.current || {}), stepKey: "", label: "" };
  return v626SaveRun(run, false);
}
async function v626FailStep(run, key, error) {
  const step = v626Step(run, key);
  step.status = "failed";
  step.error = String(error?.message || error || "Automation step failed");
  step.activity = { ...(step.activity || {}), state: "failed", detail: step.error, updatedAt: v626Now() };
  step.updatedAt = v626Now();
  run.current = { ...(run.current || {}), stepKey: key, label: step.label || key };
  return v626SaveRun(run, false);
}
async function v626Log(run, message, tone = "info") {
  run.logs = Array.isArray(run.logs) ? run.logs : [];
  run.logs.push({ at: v626Now(), tone, message: String(message || "") });
  if (run.logs.length > 200) run.logs = run.logs.slice(-200);
  return v626SaveRun(run, false);
}
async function v626SetStage(run, stage, phase = "", summary = "") {
  run.stage = stage;
  if (phase) run.phase = phase;
  if (summary) run.summary = summary;
  return v626SaveRun(run, false);
}
async function v626FinishRun(run, status, summary) {
  run.status = status;
  run.stage = status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : "Needs attention";
  run.summary = summary || run.summary || "";
  run.completedAt = status === "completed" ? v626Now() : run.completedAt || "";
  run.current = { ...(run.current || {}), stepKey: "" };
  V626_ACTIVE_AUTOMATION_RUNS.delete(run.id);
  return v626SaveRun(run, false);
}
function v628FinishRunLocally(run, status, summary) {
  run.status = status;
  run.stage = status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : "Needs attention";
  run.summary = summary || run.summary || "";
  run.completedAt = status === "completed" ? v626Now() : run.completedAt || "";
  run.current = { ...(run.current || {}), stepKey: "", leaseLost: true };
  V626_ACTIVE_AUTOMATION_RUNS.delete(run.id);
  V628_AUTOMATION_LEASE_LOST_RUNS.add(run.id);
  v626ReplaceRun(run);
  try { route(); } catch {}
  return run;
}
async function v628FinishRunAfterError(run, status, summary, error) {
  if (error?.leaseLost) return v628FinishRunLocally(run, status, summary);
  try { return await v626FinishRun(run, status, summary); }
  catch (saveError) {
    if (saveError?.code === "RUN_LEASED" || saveError?.code === "LEASE_LOST" || saveError?.code === "STALE_RUN") {
      return v628FinishRunLocally(run, status, `${summary} The final status could not be saved after the lease changed; Resume Run will reconcile it.`);
    }
    throw saveError;
  }
}
function v626RunCancelled(run) { return !!run?.cancelRequested; }
async function v626CheckCancelled(run) {
  const refreshed = await v626RefreshRun(run.id, false).catch(() => run);
  Object.assign(run, refreshed || {});
  if (v626RunCancelled(run)) throw Object.assign(new Error("Automation cancelled"), { cancelled: true });
  if (V626_ACTIVE_AUTOMATION_RUNS.has(run.id) && !v627LeaseHeldHere(run)) {
    const error = Object.assign(new Error("Automation lease expired or moved to another window. Progress is preserved; choose Resume Run."), { code: "LEASE_LOST", leaseLost: true });
    await v628MarkAutomationLeaseLost(run, error);
    throw error;
  }
}
function v626ToneClass(tone) { return tone === "success" ? "ok" : tone === "warn" ? "warn" : tone === "error" ? "danger" : ""; }
function v626StatusLabel(run) {
  if (!run) return "IDLE";
  if (V628_AUTOMATION_LEASE_LOST_RUNS.has(run.id) || run.current?.leaseLost) return "LEASE LOST — RESUME REQUIRED";
  if (run.status === "awaiting-review") return "HUMAN REVIEW REQUIRED";
  if (v627LeaseActive(run) && !v627LeaseHeldHere(run)) return "ACTIVE IN ANOTHER WINDOW";
  if (run.status === "running" && !V626_ACTIVE_AUTOMATION_RUNS.has(run.id)) return "READY TO RESUME";
  return String(run.status || "idle").replace(/-/g, " ").toUpperCase();
}
function v628EstimatedCostPerImage() {
  const value = Number(CONFIG?.generation?.fal?.estimatedCostPerImage || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function v628Usd(value) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
  catch { return `$${Number(value || 0).toFixed(2)}`; }
}
function v628CostEstimateText(imageCount) {
  const rate = v628EstimatedCostPerImage();
  return rate ? ` · estimated worst case ${v628Usd(Math.max(0, Number(imageCount || 0)) * rate)} at ${v628Usd(rate)} per image` : "";
}
function v626RunUsageMarkup(run) {
  const usage = run?.usage || {};
  const max = Number(run?.config?.maxImages || 0);
  const rate = v628EstimatedCostPerImage();
  const estimate = rate ? `<span><b>${v628Usd(Number(usage.imagesGenerated || 0) * rate)}</b>${max ? ` / ${v628Usd(max * rate)}` : ""} estimated</span>` : "";
  return `<div class="automation-usage"><span><b>${Number(usage.imagesGenerated || 0)}</b>${max ? ` / ${max}` : ""} images</span><span><b>${Number(usage.imageRequests || 0)}</b> paid request${Number(usage.imageRequests || 0) === 1 ? "" : "s"}</span><span><b>${Number(usage.reviewCalls || 0)}</b> review call${Number(usage.reviewCalls || 0) === 1 ? "" : "s"}</span>${estimate}</div>`;
}
function v626RunWinners(run) {
  return Object.values(run?.steps || {}).filter((step) => step.status === "completed" && step.winner).sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));
}
function v627StepSystem(step) {
  return { prompt: "Prompt Advisor", generation: "FAL Image Generation", review: "Vision Review", "frame-review": "Vision Review", "entity-review": "Vision Review", "frame-approval": "Saving Approval", "entity-approval": "Saving Approval", "blocking-approval": "Saving Guide" }[step?.kind] || "CineBraid Runner";
}
function v627StepTone(step) {
  if (step.status === "completed" || step.status === "skipped") return "done";
  if (step.status === "running") return "active";
  if (step.status === "needs-review") return "review";
  if (step.status === "failed") return "failed";
  return "pending";
}
function v627RunConsoleMarkup(run) {
  const steps = Object.values(run?.steps || {}).sort((a, b) => String(a.startedAt || a.updatedAt || "").localeCompare(String(b.startedAt || b.updatedAt || "")));
  if (!steps.length) return `<div class="automation-console-empty"><b>Run plan ready</b><span>Steps will appear here as prompting, generation, review, and approval begin.</span></div>`;
  return `<div class="automation-run-console">${steps.map((step) => { const tone = v627StepTone(step); return `<article class="${tone}"><i>${tone === "done" ? "✓" : tone === "active" ? "●" : tone === "review" ? "!" : tone === "failed" ? "×" : "○"}</i><div><b>${esc(step.label || step.key)}</b><span>${esc(v627StepSystem(step))}${Number(step.attempt || 0) ? ` · attempt ${Number(step.attempt)}` : ""}</span></div><small>${tone === "active" ? "WORKING" : tone === "review" ? "APPROVAL" : tone.toUpperCase()}</small></article>`; }).join("")}</div>`;
}
function v627AwaitingReviewStep(run) {
  const current = run?.steps?.[run?.current?.stepKey || ""];
  if (current?.status === "needs-review") return current;
  return Object.values(run?.steps || {}).find((step) => step.status === "needs-review") || null;
}
function v627ReviewCandidates(run, step) {
  if (!step) return [];
  if (step.kind === "entity-review") return (step.review?.candidates || []).map((item) => ({ file: item.file, score: Math.round(Number(item.review?.score || 0)), pass: item.review?.pass === true, note: item.review?.summary || "" }));
  const rows = Array.isArray(step.review?.reviews) ? step.review.reviews : [];
  return (step.files || []).map((file, index) => { const row = rows.find((item) => Number(item.n) === index + 1) || {}; return { file, score: Math.round(Number(row.score || 0)), pass: row.pass === true, note: row.notes || "" }; });
}
function v627CandidateUrl(run, step, file) {
  if (run.type === "shot-chain") return takesFor(run.targetId).find((item) => item.name === file)?.url || "";
  if (run.type === "scene-chain") {
    const shotId = step?.shotId || step?.result?.targetShotId || "";
    return shotId ? takesFor(shotId).find((item) => item.name === file)?.url || "" : "";
  }
  const list = run.config?.list || run.entityList, entityId = run.config?.entityId || run.entityId;
  const entity = P[list]?.find((item) => item.id === entityId);
  return entity ? entityMedia(list, entity).find((item) => item.name === file)?.url || "" : "";
}
function v627HumanReviewMarkup(run) {
  const step = v627AwaitingReviewStep(run);
  if (!step) return "";
  const candidates = v627ReviewCandidates(run, step);
  const canNextRound = Number(step.attempt || 0) < Number(step.maxAttempts || 0);
  return `<section class="automation-human-review"><header><div><span>HUMAN REVIEW GATE</span><b>${esc(step.label || "Candidate approval required")}</b><small>The assistant suggestion is not canon until you approve it.</small></div><span>${Math.round(Number(step.score || 0))}/100 suggested</span></header><div class="automation-review-grid">${candidates.map((candidate) => { const url = v627CandidateUrl(run, step, candidate.file); const suggested = candidate.file === step.winner; return `<article class="${suggested ? "suggested" : ""}">${url ? `<img src="${attr(url)}" alt="${attr(candidate.file)}">` : `<div class="automation-review-placeholder">IMAGE</div>`}<div><b>${esc(candidate.file)}</b><small>${candidate.score}/100 · ${candidate.pass ? "assistant pass" : "flagged"}</small>${candidate.note ? `<p>${esc(candidate.note)}</p>` : ""}</div><button class="${suggested ? "approve-btn" : "ghost-btn"}" onclick="approveAutomationCandidate('${run.id}','${attr(step.key)}','${attr(candidate.file)}')">${suggested ? "APPROVE SUGGESTED" : "APPROVE THIS"}</button></article>`; }).join("")}</div><footer>${canNextRound ? `<button class="changes-btn" onclick="continueAutomationRevision('${run.id}')">REVISE AND TRY NEXT ROUND</button>` : `<button class="changes-btn" onclick="startFreshAutomationRun('${run.id}','${run.type}','${attr(run.targetId)}')">START A FRESH RUN</button>`}<button class="ghost-btn" onclick="archiveAutomationRun('${run.id}')">STOP AND ARCHIVE</button></footer></section>`;
}
function v626RunReportMarkup(run) {
  if (!run) return "";
  const winners = v626RunWinners(run);
  const report = winners.length ? `<div class="automation-report">${winners.map((step) => `<article><span>${esc(step.label || step.kind || "Result")}</span><b>${esc(step.winner)}</b><small>${Number.isFinite(Number(step.score)) ? `${Math.round(Number(step.score))}/100` : "Approved"}${step.result?.rationale ? ` · ${esc(step.result.rationale)}` : ""}</small></article>`).join("")}</div>` : "";
  const logs = run.logs?.length ? `<details class="automation-run-log" ${run.status === "running" ? "open" : ""}><summary>Run log <span>${run.logs.length}</span></summary><div>${run.logs.map((entry) => `<p class="${v626ToneClass(entry.tone)}"><b>${esc(new Date(entry.at).toLocaleTimeString())}</b> ${esc(entry.message)}</p>`).join("")}</div></details>` : "";
  return `${v6211GenerationProfileMarkup(v6211RunGenerationSettings(run))}${v626RunUsageMarkup(run)}${typeof v641LiveActivityMarkup === "function" ? "" : v627RunConsoleMarkup(run)}${v627HumanReviewMarkup(run)}${report}${logs}<div class="automation-debug-actions"><a class="chip" href="#/reports/${encodeURIComponent(run.id)}">VIEW REPORT</a></div>`;
}
function v626RunActions(run, type, targetId, scope, startMarkup) {
  if (!run) return startMarkup;
  const active = V626_ACTIVE_AUTOMATION_RUNS.has(run.id);
  const failed = Object.values(run.steps || {}).find((step) => step.status === "failed");
  if (v627LeaseActive(run) && !v627LeaseHeldHere(run)) return `<button class="ghost-btn" disabled>RUNNING IN ANOTHER WINDOW</button>`;
  if (run.status === "running" && active) return `<button class="chip danger" onclick="pauseAutomationRun('${type}','${targetId}','${scope}')">STOP AFTER SAFE STEP</button>${run.current?.stepKey && run.steps?.[run.current.stepKey]?.childJobId ? `<button class="chip danger" onclick="cancelAutomationProviderJob('${run.id}')">CANCEL PROVIDER JOB</button>` : ""}`;
  if (run.status === "awaiting-review") return `<button class="ghost-btn" onclick="archiveAutomationRun('${run.id}')">ARCHIVE</button>`;
  if (run.status === "failed") {
    const repairLabel = run.type === "scene-chain" && (failed?.kind === "generation" || String(failed?.key || "").includes("scene-correction")) ? "REPAIR & RETRY FAILED STEP" : "RETRY FAILED STEP";
    return `${failed ? `<button class="approve-btn" onclick="retryFailedAutomationStep('${run.id}','${attr(failed.key)}')">${repairLabel}</button>` : ""}<button class="ghost-btn" onclick="startFreshAutomationRun('${run.id}','${type}','${attr(targetId)}')">START FRESH</button><button class="ghost-btn" onclick="archiveAutomationRun('${run.id}')">ARCHIVE</button>`;
  }
  if (["running", "cancelled", "interrupted"].includes(run.status)) return `<button class="approve-btn" onclick="resumeAutomationRun('${run.id}')">RESUME RUN</button><button class="ghost-btn" onclick="startFreshAutomationRun('${run.id}','${type}','${attr(targetId)}')">START FRESH</button><button class="ghost-btn" onclick="archiveAutomationRun('${run.id}')">ARCHIVE</button>`;
  return `<button class="ghost-btn" onclick="archiveAutomationRun('${run.id}')">ARCHIVE REPORT</button>${startMarkup}`;
}
function v626AutomationPanel(run, title, description, type, targetId, scope, startMarkup, extra = "") {
  return `<section class="creation-card automation-card durable-automation-card"><div class="creation-card-head"><div><span class="creation-kicker">EXPERIMENTAL · DURABLE</span><h3>${esc(title)}</h3><p>${esc(description)}</p></div><span class="creation-state">Stills only</span></div><div class="automation-run-status"><b>${esc(v626StatusLabel(run))}</b><span>${esc(run?.stage || "Ready to plan an automation run")}</span></div>${run?.summary ? `<div class="automation-run-summary ${v626ToneClass(run.status === "completed" ? "success" : run.status === "failed" ? "warn" : "info")}">${esc(run.summary)}</div>` : ""}${run && typeof v641LiveActivityMarkup === "function" ? v641LiveActivityMarkup(run) : ""}${extra}<div class="automation-persistence-note">Progress is saved to this project. Closing the tab pauses browser orchestration; reopen the same target and choose Resume Run.</div><div class="creation-actions automation-actions">${v626RunActions(run, type, targetId, scope, startMarkup)}</div>${v626RunReportMarkup(run)}</section>`;
}


const V664_BLOCKING_REVIEW_THRESHOLD = 75;
function v664BlockingReviewKey(frameId = "") { return String(frameId || "opening"); }
function v664BlockingFileName(asset) { return String(asset?.file || asset?.originalName || asset?.storagePath || "").split(/[\\/]/).pop(); }
function v664BlockingReviewStore(shot) {
  const creation = ensureShotCreation(shot);
  creation.blockingAttemptReviews = creation.blockingAttemptReviews && typeof creation.blockingAttemptReviews === "object" ? creation.blockingAttemptReviews : {};
  return creation.blockingAttemptReviews;
}
function v664BlockingRowsForReview(shot, frameId = "") {
  const target = String(frameId || "");
  return blockingMediaRows(shot).filter(({ link }) => target ? String(link.blockingFrameId || "") === target : !String(link.blockingFrameId || ""));
}
window.blockingAttemptReviewFor = (shot, assetId, frameId = "") => {
  const record = v664BlockingReviewStore(shot)[v664BlockingReviewKey(frameId)] || {};
  return (record.items || {})[assetId] || null;
};
window.blockingAttemptReviewSummary = (shot, frameId = "") => {
  const rows = v664BlockingRowsForReview(shot, frameId), record = v664BlockingReviewStore(shot)[v664BlockingReviewKey(frameId)] || {};
  const reviewed = rows.filter(({ asset }) => record.items?.[asset.id]).length;
  const recommended = rows.find(({ asset }) => asset.id === record.suggestedAssetId) || null;
  const recommendation = recommended ? record.items?.[recommended.asset.id] || null : null;
  return { rows, record, reviewed, recommended, recommendation, stale: String(record.assetSignature || "") !== rows.map(({ asset }) => asset.id).sort().join("|") };
};
function v664StoreBlockingReview(shot, frameId, data) {
  const rows = v664BlockingRowsForReview(shot, frameId), byFile = new Map(rows.map((row) => [v664BlockingFileName(row.asset), row]));
  const items = {};
  for (const review of data?.review?.reviews || []) {
    const file = data?.files?.[Math.max(0, Number(review.n || 1) - 1)] || "";
    const row = byFile.get(file);
    if (!row) continue;
    const score = Math.round(Number(review.score || 0));
    items[row.asset.id] = {
      assetId: row.asset.id, file, score,
      pass: review.pass === true && score >= V664_BLOCKING_REVIEW_THRESHOLD,
      explicitPass: review.explicitPass === true,
      explicitScore: review.explicitScore === true,
      notes: String(review.notes || ""), reviewedAt: new Date().toISOString(),
    };
  }
  const suggestedFile = data?.files?.[Math.max(0, Number(data?.review?.suggested || 1) - 1)] || "";
  let suggested = byFile.get(suggestedFile) || null;
  if (!suggested || !items[suggested.asset.id]?.pass) {
    suggested = rows.map((row) => ({ row, review: items[row.asset.id] })).filter((item) => item.review?.pass).sort((a,b) => b.review.score - a.review.score)[0]?.row || rows.map((row) => ({ row, review: items[row.asset.id] })).filter((item) => item.review).sort((a,b) => b.review.score - a.review.score)[0]?.row || null;
  }
  const record = {
    contractVersion: "blocking-authority-v2", frameId: String(frameId || ""),
    reviewedAt: new Date().toISOString(), items,
    suggestedAssetId: suggested?.asset?.id || "",
    rationale: String(data?.review?.rationale || ""),
    strategy: data?.strategy || {},
    assetSignature: rows.map(({ asset }) => asset.id).sort().join("|"),
  };
  v664BlockingReviewStore(shot)[v664BlockingReviewKey(frameId)] = record;
  return record;
}
window.reviewBlockingAttempts = async (shotId, frameId = "", autoUse = false) => {
  const shot = shotById(shotId);
  if (!shot) return toast("Shot is unavailable");
  const rows = v664BlockingRowsForReview(shot, frameId);
  if (!rows.length) return toast("Add at least one blocking attempt first");
  if (!capabilityState("vision").ready) return toast(capabilityState("vision").message || "Vision review is unavailable");
  const creation = ensureShotCreation(shot);
  creation.blockingReviewBusy = v664BlockingReviewKey(frameId);
  keepGuidedPanelOpen(shot, "blocking");
  dirty(); route();
  const activityId = typeof v641StartManualActivity === "function" ? v641StartManualActivity("VISION AI · BLOCKING REVIEW", `Review ${shot.id} blocking attempts`, `Comparing ${rows.length} grayscale composition option${rows.length === 1 ? "" : "s"} against camera, pose, spacing, scale, depth and contact points.`) : "";
  try {
    const response = await fetch("/api/llm/review", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ kind:"blocking", id:shot.id, frameId:String(frameId || ""), fileNames:rows.map(({asset}) => v664BlockingFileName(asset)) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Blocking review failed");
    const fresh = shotById(shotId), record = v664StoreBlockingReview(fresh, frameId, data);
    const recommended = v664BlockingRowsForReview(fresh, frameId).find(({asset}) => asset.id === record.suggestedAssetId);
    const review = recommended ? record.items?.[recommended.asset.id] : null;
    if (autoUse && recommended && review?.pass) {
      if (frameId) useFrameBlockingGuide(fresh.id, frameId, recommended.asset.id);
      else useBlockingGuide(fresh.id, recommended.asset.id);
    }
    dirty(); await flushPendingProjectSave();
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "completed", recommended ? `Blocking review complete. Recommended ${recommended.asset.title || recommended.asset.file} at ${review?.score || 0}/100.` : "Blocking review complete.");
    toast(recommended ? `Blocking review complete — recommended ${recommended.asset.title || recommended.asset.file}` : "Blocking review complete");
  } catch (error) {
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "failed", error.message || "Blocking review failed");
    toast(error.message || "Blocking review failed");
  } finally {
    const fresh = shotById(shotId); if (fresh) delete ensureShotCreation(fresh).blockingReviewBusy;
    dirty(); route();
  }
};
const V664_AUTO_BLOCKING_REVIEW_PENDING = window.__cinebraidAutoBlockingReviewPending || (window.__cinebraidAutoBlockingReviewPending = new Set());
window.maybeAutoReviewBlockingAttempts = (shotId, frameId = "") => {
  const shot = shotById(shotId);
  if (!shot) return;
  const creation = ensureShotCreation(shot);
  if (!creation.autoReviewBlocking) return;
  const summary = blockingAttemptReviewSummary(shot, frameId);
  if (!summary.rows.length || !summary.stale || creation.blockingReviewBusy || !capabilityState("vision").ready) return;
  const signature = summary.rows.map(({ asset }) => asset.id).sort().join("|");
  const key = `${shotId}:${frameId || "opening"}:${signature}`;
  if (V664_AUTO_BLOCKING_REVIEW_PENDING.has(key)) return;
  V664_AUTO_BLOCKING_REVIEW_PENDING.add(key);
  setTimeout(async () => {
    try { await reviewBlockingAttempts(shotId, frameId, false); }
    finally { V664_AUTO_BLOCKING_REVIEW_PENDING.delete(key); }
  }, 80);
};
window.setAutoBlockingReview = (shotId, enabled) => {
  const shot = shotById(shotId);
  if (!shot) return;
  ensureShotCreation(shot).autoReviewBlocking = !!enabled;
  keepGuidedPanelOpen(shot, "blocking");
  dirty();
  route();
  if (enabled) maybeAutoReviewBlockingAttempts(shotId, "");
  toast(enabled ? "New blocking options will be reviewed automatically" : "Automatic blocking review disabled");
};

window.useRecommendedBlockingAttempt = (shotId, frameId = "") => {
  const shot = shotById(shotId), summary = shot ? blockingAttemptReviewSummary(shot, frameId) : null;
  if (!shot || !summary?.recommended) return toast("Run blocking review first");
  if (!summary.recommendation?.pass) return toast("The recommended attempt is flagged; choose a guide manually or generate another round");
  if (frameId) useFrameBlockingGuide(shot.id, frameId, summary.recommended.asset.id);
  else useBlockingGuide(shot.id, summary.recommended.asset.id);
  toast(`Using recommended blocking guide: ${summary.recommended.asset.title || summary.recommended.asset.file}`);
};
function v664SceneApprovedCount(shot) {
  const sceneId = shot?.scene || "";
  return (P.shots || []).filter((row) => String(row.scene) === String(sceneId) && typeof guidedCurrentShotStill === "function" && guidedCurrentShotStill(row, takesFor(row.id))).length;
}
window.shotAutomationHub = (shot, placement = "look") => {
  const frames = guidedFrames(shot), required = frames.filter((frame) => frame.required !== false), approved = required.filter((frame) => guidedFrameApproved(shot, frame, takesFor(shot.id), frames.indexOf(frame))).length;
  const blocking = blockingAttemptReviewSummary(shot), active = activeBlockingRow(shot), scene = sceneById(shot.scene), sceneApproved = v664SceneApprovedCount(shot), sceneReview = scene?.continuityReview || null;
  const currentRun = v626LatestRun("shot-chain", shot.id, "stills"), blockingRun = v626LatestRun("shot-chain", shot.id, "blocking-only");
  const open = !manualFirstWorkflow() || [currentRun?.status, blockingRun?.status].some((status) => ["running","awaiting-review","failed","interrupted"].includes(status));
  return `<details class="shot-automation-hub" ${open ? "open" : ""}><summary><div><span>OPTIONAL ASSISTED PRODUCTION</span><b>Review blocking, automate this shot, or check the scene</b><small>Manual work remains first-class. These tools reuse approved references and existing results before spending credits.</small></div><span>${currentRun ? esc(String(currentRun.status || "run").replace(/-/g," ").toUpperCase()) : "OPTIONAL"}</span></summary><div class="shot-automation-hub-body"><div class="shot-automation-status-grid"><article><span>BLOCKING</span><b>${active ? "Guide active" : `${blocking.rows.length} attempt${blocking.rows.length === 1 ? "" : "s"}`}</b><small>${blocking.reviewed ? `${blocking.reviewed}/${blocking.rows.length} AI reviewed` : blocking.rows.length ? "Ready for AI review" : "No attempts yet"}</small></article><article><span>REQUIRED FRAMES</span><b>${approved}/${required.length} approved</b><small>${approved === required.length ? "Still package ready" : "Full-shot automation can continue the chain"}</small></article><article><span>SCENE CONTINUITY</span><b>${sceneReview ? esc(String(sceneReview.verdict || "reviewed").replace(/_/g," ")) : `${sceneApproved} approved still${sceneApproved === 1 ? "" : "s"}`}</b><small>${sceneApproved >= 2 ? "Ready for sequence review" : "Available after two scene stills are approved"}</small></article></div><div class="shot-automation-primary-actions">${blocking.recommended && blocking.recommendation?.pass ? `<button class="approve-btn" onclick="useRecommendedBlockingAttempt('${attr(shot.id)}')">USE RECOMMENDED GUIDE · ${Number(blocking.recommendation.score || 0)}</button>` : ""}<button class="approve-btn large" onclick="openShotAutomationModal('${attr(shot.id)}')">AUTOMATE FULL SHOT</button></div><div class="shot-automation-scene-actions"><a class="text-link-btn" href="#/scene/${attr(shot.scene)}">Scene continuity & automation · ${esc(scene?.title || shot.scene)} →</a></div></div></details>`;
};

window.shotAutomationPanel = (shot) => {
  const frames = guidedFrames(shot), required = frames.filter((frame) => frame.required !== false);
  const run = v626LatestRun("shot-chain", shot.id, "stills");
  const description = required.length > 1
    ? `Run the complete still pipeline: review or create the opening blocking guide, generate and review every selected required frame parent-first, approve strong passes, and optionally review the assembled scene against the Project Bible. Motion generation remains manual.`
    : "Run the complete still pipeline: review or create blocking, generate and review the opening frame, approve a strong pass, and optionally review the assembled scene against the Project Bible. Motion generation remains manual.";
  return v626AutomationPanel(run, "Full shot still automation", description, "shot-chain", shot.id, "stills", `<button class="approve-btn large" onclick="openShotAutomationModal('${shot.id}')">AUTOMATE FULL SHOT</button>`, run?.status === "completed" ? `<button class="automation-motion-handoff" onclick="openAutomationMotionHandoff('${shot.id}')">Open manual motion setup →</button>` : "");
};
window.blockingAutomationPanel = (shot) => {
  const run = v626LatestRun("shot-chain", shot.id, "blocking-only");
  const description = "Build or improve the grayscale blocking prompt, generate bounded options, review composition and contact points, revise when needed, and select the best passing result as the active guide. No finished still is generated.";
  return `<div class="automation-inline-card blocking-only-automation"><div><b>Automate blocking creation</b><small>Runs build → generate → review → revise → retry, then installs the best passing grayscale guide.</small></div>${v626AutomationPanel(run, "Blocking automation", description, "shot-chain", shot.id, "blocking-only", `<button class="approve-btn" onclick="openBlockingAutomationModal('${shot.id}')">AUTOMATE BLOCKING</button>`)}</div>`;
};
window.assetAutomationPanel = (list, entity) => {
  const run = v626LatestRun("entity-chain", `${list}:${entity.id}`, "default-only");
  return `<div class="automation-inline-card durable-automation-inline"><div><b>Automate the default reference</b><small>Build, improve, generate, review, and approve the base state. The run is resumable and never generates motion.</small></div>${v626AutomationPanel(run, "Default reference", "One approved base reference with bounded retries.", "entity-chain", `${list}:${entity.id}`, "default-only", `<button class="ghost-btn" onclick="openAssetAutomationModal('${list}','${entity.id}')">AUTOMATE DEFAULT</button>`)}</div>`;
};
window.entityStateAutomationPanel = (list, entity, state) => {
  const scope = `state:${state.id}`, run = v626LatestRun("entity-chain", `${list}:${entity.id}`, scope);
  return `<div class="automation-inline-card durable-automation-inline"><div><b>Automate ${esc(state.name || "this state")}</b><small>Derive this state from its approved parent when available, review the visible delta, and approve the best passing reference.</small></div>${v626AutomationPanel(run, `${state.name || "State"} reference`, "State-specific still automation with parent continuity checks.", "entity-chain", `${list}:${entity.id}`, scope, `<button class="ghost-btn" onclick="openEntityStateAutomationModal('${list}','${entity.id}','${state.id}')">AUTOMATE STATE</button>`)}</div>`;
};
window.entityChainAutomationPanel = (list, entity) => {
  const run = v626LatestRun("entity-chain", `${list}:${entity.id}`, "state-chain");
  return v626AutomationPanel(run, "Continuity-state chain", "Create missing states parent-first: default → outfit/dirt/corruption/damage variants. Each child edits from its approved parent and is reviewed for both identity preservation and the requested delta.", "entity-chain", `${list}:${entity.id}`, "state-chain", `<button class="approve-btn" onclick="openEntityChainAutomationModal('${list}','${entity.id}')">PLAN STATE CHAIN</button>`);
};

function v626BlockingPreflight(shot) {
  const errors = [], warnings = [];
  if (!falGenerationReady()) errors.push("FAL GPT Image 2 generation is not enabled.");
  if (!capabilityState("text").ready) errors.push(capabilityState("text").message || "The text assistant is unavailable.");
  if (!capabilityState("vision").ready) errors.push(capabilityState("vision").message || "The vision assistant is unavailable.");
  if (!String(blockingFrameBrief(shot) || "").trim()) errors.push("Describe the shot or opening frame before automating blocking.");
  if (!activeBlockingRow(shot)) warnings.push("No active guide exists yet; the run will create a fresh grayscale blocking set.");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
window.openBlockingAutomationModal = (shotId) => {
  const shot = shotById(shotId);
  if (!shot) return toast("Shot is unavailable");
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626BlockingAutomationDraft = { shotId, rounds: 3, outputsPerRequest: 3, reuseApproved: true, generationSettings };
  openModal(`<div class="automation-plan-modal"><h3>Plan blocking automation — ${esc(shotId)}</h3><div class="modal-sub">GRAYSCALE COMPOSITION GUIDE ONLY · NO FINISHED STILL</div>${v6211GenerationControlsMarkup(generationSettings,"blocking",{includeOutputs:false,includeFrame:false})}<p class="modal-confirm-message">CineBraid will build and improve the blocking prompt, generate options, review camera/pose/scale/contact points, revise failed rounds, and install the best passing result as the active guide.</p><div class="two-col"><label><span>Maximum review rounds</span><select id="v626-blocking-rounds" onchange="updateBlockingAutomationEstimate()">${[1,2,3].map((n)=>`<option value="${n}" ${n===3?"selected":""}>${n}</option>`).join("")}</select></label><label><span>Options per round</span><select id="v626-blocking-outputs" onchange="updateBlockingAutomationEstimate()">${[1,2,3,4].map((n)=>`<option value="${n}" ${n===3?"selected":""}>${n}</option>`).join("")}</select></label></div><label class="checkline"><input id="v626-blocking-reuse" type="checkbox" checked onchange="updateBlockingAutomationEstimate()"> Reuse the current active guide instead of spending credits again when one already exists</label><div id="v626-blocking-auto-preflight"></div><div id="v626-blocking-auto-estimate" class="automation-cost-guard"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="v626-start-blocking-auto" class="approve-btn" onclick="startPlannedBlockingAutomation()">START BLOCKING AUTOMATION</button></div></div>`);
  updateBlockingAutomationEstimate();
};
window.updateBlockingAutomationEstimate = () => {
  const draft = window._v626BlockingAutomationDraft || {}, shot = shotById(draft.shotId);
  if (!shot) return;
  const rounds = Math.max(1, Math.min(3, Number(document.getElementById("v626-blocking-rounds")?.value || 3)));
  const outputsPerRequest = Math.max(1, Math.min(4, Number(document.getElementById("v626-blocking-outputs")?.value || 3)));
  const reuseApproved = document.getElementById("v626-blocking-reuse")?.checked !== false;
  const settings = { ...(draft.generationSettings || v6211AutomationGenerationSettings()) };
  settings.blockingQuality = document.getElementById("blocking-auto-blocking-quality")?.value || settings.blockingQuality;
  settings.blockingResolution = document.getElementById("blocking-auto-blocking-resolution")?.value || settings.blockingResolution;
  const preflight = v626BlockingPreflight(shot), maxImages = rounds * outputsPerRequest;
  const preflightEl = document.getElementById("v626-blocking-auto-preflight");
  if (preflightEl) preflightEl.innerHTML = `${preflight.errors.length ? `<div class="guided-prompt-error"><b>Cannot start yet</b><span>${esc(preflight.errors.join(" "))}</span></div>` : `<div class="prompt-check ok">Preflight passed for blocking-only automation.</div>`}${preflight.warnings.length ? `<div class="prompt-check warn">${esc(preflight.warnings.join(" "))}</div>` : ""}`;
  const estimate = document.getElementById("v626-blocking-auto-estimate");
  if (estimate) estimate.innerHTML = `<b>Maximum ${maxImages} generated blocking image${maxImages === 1 ? "" : "s"}${v628CostEstimateText(maxImages)}</b><span>${outputsPerRequest} option${outputsPerRequest === 1 ? "" : "s"} per round · up to ${rounds} round${rounds === 1 ? "" : "s"}. The run stops early on a passing guide.</span>`;
  const button = document.getElementById("v626-start-blocking-auto");
  if (button) button.disabled = !!preflight.errors.length;
  window._v626BlockingAutomationDraft = { ...draft, shotId: shot.id, rounds, outputsPerRequest, reuseApproved, maxImages, generationSettings: settings };
};
window.startPlannedBlockingAutomation = async () => {
  const draft = window._v626BlockingAutomationDraft || {}, shot = shotById(draft.shotId);
  if (!shot) return toast("Shot is unavailable");
  const preflight = v626BlockingPreflight(shot);
  if (preflight.errors.length) return toast(preflight.errors[0]);
  const run = v626NewRun("shot-chain", shot.id, "blocking-only", `Shot ${shot.id} blocking guide`, "blocking-only", {
    blockingOnly: true,
    frameIds: [],
    reuseApproved: draft.reuseApproved !== false,
    openingBlockingRounds: Number(draft.rounds || 3),
    derivativeBlockingRounds: 0,
    frameRounds: 0,
    outputsPerRequest: Number(draft.outputsPerRequest || 3),
    maxImages: Number(draft.maxImages || 9),
    generationSettings: draft.generationSettings || v6211AutomationGenerationSettings(),
  });
  closeModal();
  keepGuidedPanelOpen(shot, "blocking");
  const saved = await v626CreateRun(run);
  runShotAutomation(saved.id);
};

function v626ShotPreflight(shot, frameIds) {
  const errors = [], warnings = [];
  if (!falGenerationReady()) errors.push("FAL GPT Image 2 generation is not enabled.");
  if (!capabilityState("text").ready) errors.push(capabilityState("text").message || "The text assistant is unavailable.");
  if (!capabilityState("vision").ready) errors.push(capabilityState("vision").message || "The vision assistant is unavailable.");
  const frames = guidedFrames(shot), selected = frameIds.map((id) => frames.find((frame) => frame.id === id)).filter(Boolean);
  if (!selected.length) errors.push("Choose at least one frame.");
  for (const frame of selected) {
    const index = frames.indexOf(frame), state = guidedFrameState(shot, frame, index);
    if (!String(state.action || frame.description || "").trim()) errors.push(`Frame ${frame.label} needs a description.`);
    if (index > 0 && !frameIds.includes(frames[index - 1].id) && !guidedFrameApproved(shot, frames[index - 1], takesFor(shot.id), index - 1)) errors.push(`Frame ${frame.label} needs approved Frame ${frames[index - 1].label} or that parent frame included in this run.`);
  }
  const resolved = typeof resolveShotEntities === "function" ? resolveShotEntities(P, shot) : null;
  const groups = [["location", resolved?.locations || [], "locations"], ["character", resolved?.characters || [], "characters"], ["prop", resolved?.props || [], "props"], ["vehicle", resolved?.vehicles || [], "vehicles"]];
  for (const [label, items, list] of groups) for (const item of items) {
    const stateId = shot.continuityStateSelections?.[item.id] || "";
    if (!entityApprovedFileForState(item, stateId)) errors.push(`${item.name || item.id} needs an approved ${label} reference.`);
  }
  if (!resolved?.locations?.length) warnings.push("No location is attached; the automation will rely on the written shot description.");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
window.openShotAutomationModal = (shotId) => {
  const shot = shotById(shotId), frames = guidedFrames(shot), required = frames.filter((frame) => frame.required !== false);
  const unfinished = required.filter((frame, index) => !guidedFrameApproved(shot, frame, takesFor(shot.id), frames.indexOf(frame)));
  const defaultIds = (unfinished.length ? unfinished : required.slice(0, 1)).map((frame) => frame.id);
  const maxWithBlocking = 9 + defaultIds.length * 6 + Math.max(0, defaultIds.filter((id) => frames.findIndex((frame) => frame.id === id) > 0).length) * 6;
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626ShotAutomationDraft = { shotId, frameIds: defaultIds, reviewExistingBlocking: true, reviewSceneAfterShot: true, generationSettings };
  const existingBlocking = v664BlockingRowsForReview(shot).length;
  openModal(`<div class="automation-plan-modal"><h3>Automate the full shot — ${esc(shotId)}</h3><div class="modal-sub">BLOCKING → AI REVIEW / SELECTION → REQUIRED FRAMES → OPTIONAL SCENE CONTINUITY · VIDEO REMAINS MANUAL</div>${v6211GenerationControlsMarkup(generationSettings,"shot",{outputs:3})}<section class="automation-pipeline-summary"><b>Full still pipeline</b><span>CineBraid first reviews the ${existingBlocking || "existing"} blocking attempt${existingBlocking === 1 ? "" : "s"}. If none passes, it generates and reviews new grayscale guides. It then creates selected frames parent-first and can review the scene against approved references and Project Bible text.</span></section><div class="automation-frame-picker">${required.map((frame, index) => { const approved = guidedFrameApproved(shot, frame, takesFor(shot.id), frames.indexOf(frame)); return `<label><input type="checkbox" class="v626-auto-frame" value="${attr(frame.id)}" ${defaultIds.includes(frame.id) ? "checked" : ""} onchange="updateShotAutomationEstimate()"><span><b>Frame ${esc(frame.label)}</b><small>${approved ? `Already approved · ${esc(approved.name)}` : esc(frame.description || "No description")}${index ? ` · derives from Frame ${esc(required[index - 1]?.label || "previous")}` : ""}</small></span></label>`; }).join("")}</div><label class="checkline"><input id="v626-review-existing-blocking" type="checkbox" checked onchange="updateShotAutomationEstimate()"> Review and reuse existing blocking attempts before generating more${existingBlocking ? ` · ${existingBlocking} available` : ""}</label><label class="checkline"><input id="v626-derivative-blocking" type="checkbox" checked onchange="updateShotAutomationEstimate()"> Generate and review a frame-specific blocking edit for later frames</label><label class="checkline"><input id="v626-reuse-approved" type="checkbox" checked> Reuse existing approved frames and guides instead of spending credits again</label><label class="checkline"><input id="v626-review-scene-after" type="checkbox" checked> Review scene continuity after this shot completes when at least two scene stills are approved</label><div id="v626-shot-auto-preflight"></div><div id="v626-shot-auto-estimate" class="automation-cost-guard"><b>Maximum ${maxWithBlocking} images</b><span>3 options per request · up to 3 opening-blocking rounds · up to 2 frame and derivative-blocking rounds</span></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="v626-start-shot-auto" class="approve-btn large" onclick="startPlannedShotAutomation()">START FULL SHOT AUTOMATION</button></div></div>`);
  updateShotAutomationEstimate();
};
window.updateShotAutomationEstimate = () => {
  const shotId = window._v626ShotAutomationDraft?.shotId, shot = shotById(shotId), frames = guidedFrames(shot);
  const ids = [...document.querySelectorAll(".v626-auto-frame:checked")].map((input) => input.value);
  const derivative = !!document.getElementById("v626-derivative-blocking")?.checked;
  const reviewExistingBlocking = document.getElementById("v626-review-existing-blocking")?.checked !== false;
  const reviewSceneAfterShot = document.getElementById("v626-review-scene-after")?.checked !== false;
  const draft = window._v626ShotAutomationDraft || {};
  const settings = { ...(draft.generationSettings || v6211AutomationGenerationSettings()) };
  const outputsPerRequest = Math.max(1, Math.min(4, Number(document.getElementById("shot-auto-outputs")?.value || draft.outputsPerRequest || 3)));
  settings.blockingQuality = document.getElementById("shot-auto-blocking-quality")?.value || settings.blockingQuality;
  settings.blockingResolution = document.getElementById("shot-auto-blocking-resolution")?.value || settings.blockingResolution;
  settings.frameQuality = document.getElementById("shot-auto-frame-quality")?.value || settings.frameQuality;
  settings.frameResolution = document.getElementById("shot-auto-frame-resolution")?.value || settings.frameResolution;
  const later = ids.filter((id) => frames.findIndex((frame) => frame.id === id) > 0).length;
  const includesOpening = ids.some((id) => frames.findIndex((frame) => frame.id === id) === 0);
  const max = (includesOpening ? 3 * outputsPerRequest : 0) + ids.length * 2 * outputsPerRequest + (derivative ? later * 2 * outputsPerRequest : 0);
  const preflight = v626ShotPreflight(shot, ids);
  const preflightEl = document.getElementById("v626-shot-auto-preflight");
  if (preflightEl) preflightEl.innerHTML = `${preflight.errors.length ? `<div class="guided-prompt-error"><b>Cannot start yet</b><span>${esc(preflight.errors.join(" "))}</span></div>` : `<div class="prompt-check ok">Preflight passed for ${ids.length} frame${ids.length === 1 ? "" : "s"}.</div>`}${preflight.warnings.length ? `<div class="prompt-check warn">${esc(preflight.warnings.join(" "))}</div>` : ""}`;
  const estimate = document.getElementById("v626-shot-auto-estimate");
  if (estimate) estimate.innerHTML = `<b>Maximum ${max} generated image${max === 1 ? "" : "s"}${v628CostEstimateText(max)}</b><span>The run stops early on passing results and cannot exceed this confirmed cap. Cost is an estimate only when configured in Settings.</span>`;
  const button = document.getElementById("v626-start-shot-auto");
  if (button) button.disabled = !ids.length || !!preflight.errors.length;
  window._v626ShotAutomationDraft = { ...draft, shotId, frameIds: ids, derivativeBlocking: derivative, reviewExistingBlocking, reviewSceneAfterShot, outputsPerRequest, maxImages: max, generationSettings: settings };
};
window.startPlannedShotAutomation = async () => {
  const draft = window._v626ShotAutomationDraft || {}, shot = shotById(draft.shotId), frames = guidedFrames(shot);
  const frameIds = draft.frameIds || [];
  const preflight = v626ShotPreflight(shot, frameIds);
  if (preflight.errors.length) return toast(preflight.errors[0]);
  const run = v626NewRun("shot-chain", shot.id, "stills", `Shot ${shot.id} still chain`, frameIds.length > 1 ? "required-frames" : "opening-frame", {
    frameIds,
    derivativeBlocking: draft.derivativeBlocking !== false,
    reviewExistingBlocking: draft.reviewExistingBlocking !== false,
    reviewSceneAfterShot: draft.reviewSceneAfterShot !== false,
    reuseApproved: document.getElementById("v626-reuse-approved")?.checked !== false,
    openingBlockingRounds: 3,
    derivativeBlockingRounds: 2,
    frameRounds: 2,
    outputsPerRequest: Number(draft.outputsPerRequest || 3),
    maxImages: Number(draft.maxImages || ((3 + frameIds.length * 2) * Number(draft.outputsPerRequest || 3))),
    frameLabels: frameIds.map((id) => frames.find((frame) => frame.id === id)?.label || id),
    generationSettings: draft.generationSettings || v6211AutomationGenerationSettings(),
  });
  closeModal();
  const saved = await v626CreateRun(run);
  runShotAutomation(saved.id);
};

function v627EntityPreflight(list, entity, stateIds) {
  const errors = [], warnings = [], selected = new Set(stateIds || []), states = entityStateList(entity, true), byId = new Map(states.map((state) => [state.id, state]));
  if (!falGenerationReady()) errors.push("FAL GPT Image 2 generation is not enabled.");
  if (!capabilityState("text").ready) errors.push(capabilityState("text").message || "The text assistant is unavailable.");
  if (!capabilityState("vision").ready) errors.push(capabilityState("vision").message || "The vision assistant is unavailable.");
  if (!selected.size) errors.push("Choose at least one continuity state.");
  const media = new Set(entityMedia(list, entity).map((item) => item.name));
  for (const id of selected) {
    const state = byId.get(id);
    if (!state) { errors.push(`Continuity state ${id} no longer exists.`); continue; }
    if (!state.isDefault && !continuityStateDeltaText(state)) errors.push(`${state.name || "State"} needs a state change / delta. “Applies to scenes / shots” only controls where the state is used.`);
    const seen = new Set([state.id]); let current = state;
    while (current && !current.isDefault) {
      const parent = assetStateParent(entity, current);
      if (!parent) { errors.push(`${current.name || "State"} has no valid parent state.`); break; }
      if (seen.has(parent.id)) { errors.push(`${state.name || "State"} has a circular parent chain.`); break; }
      seen.add(parent.id);
      const parentFile = parent.approvedFile || (parent.isDefault ? entity.approvedFile : "");
      if (!selected.has(parent.id) && !parentFile) errors.push(`${state.name || "State"} needs ${parent.name || "its parent"} approved or included in this run.`);
      if (parentFile && !media.has(parentFile)) errors.push(`${parent.name || "Parent"} approval file is missing from project media: ${parentFile}.`);
      current = parent;
    }
  }
  if (states.length > 1 && !states.some((state) => !state.isDefault)) warnings.push("This entity currently has only its default state.");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
function v627PreflightMarkup(preflight) {
  return `${preflight.errors.length ? `<div class="guided-prompt-error"><b>Cannot start yet</b><span>${esc(preflight.errors.join(" "))}</span></div>` : `<div class="prompt-check ok">Automation preflight passed.</div>`}${preflight.warnings.length ? `<div class="prompt-check warn">${esc(preflight.warnings.join(" "))}</div>` : ""}`;
}
window.openAssetAutomationModal = (list, id) => {
  const entity = P[list]?.find((item) => item.id === id), state = entityStateList(entity, true).find((item) => item.isDefault);
  if (!entity) return;
  const stateIds = [state?.id || "state-default"], preflight = v627EntityPreflight(list, entity, stateIds);
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626EntityAutomationDraft = { list, id, stateIds, scope: "default-only", generationSettings };
  openModal(`<div class="automation-plan-modal compact"><h3>Automate default reference — ${esc(entity.name || id)}</h3><div class="modal-sub">DURABLE STILL AUTOMATION · THREE PASSES MAXIMUM${v628CostEstimateText(9)}</div>${v6211GenerationControlsMarkup(generationSettings,"entity",{includeBlocking:false,outputs:3})}<p class="hint">CineBraid builds and improves the reference prompt, generates the selected number of candidates per pass, reviews each against canon, and pauses for you unless a candidate earns an explicit strong pass.</p><label class="checkline"><input id="v626-reuse-approved-states" type="checkbox" checked> Reuse the existing approved default instead of spending credits again</label><div>${v627PreflightMarkup(preflight)}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" ${preflight.errors.length ? "disabled" : ""} onclick="startPlannedEntityAutomation()">START</button></div></div>`);
};
window.openEntityStateAutomationModal = (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id), state = entityStateById(entity, stateId);
  if (!entity || !state) return;
  const stateIds = [state.id], preflight = v627EntityPreflight(list, entity, stateIds);
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626EntityAutomationDraft = { list, id, stateIds, scope: `state:${state.id}`, generationSettings };
  const parent = assetStateParent(entity, state);
  openModal(`<div class="automation-plan-modal compact"><h3>Automate ${esc(state.name || "state")} — ${esc(entity.name || id)}</h3><div class="modal-sub">DERIVED REFERENCE · THREE PASSES MAXIMUM${v628CostEstimateText(9)}</div>${v6211GenerationControlsMarkup(generationSettings,"entity",{includeBlocking:false,outputs:3})}<p class="hint">The approved ${esc(parent?.name || "base")} reference becomes the editable input. Review checks identity preservation and only the requested visible state delta. If no candidate passes, automation revises the prompt and retries within the confirmed cap.</p><label class="checkline"><input id="v626-reuse-approved-states" type="checkbox" checked> Reuse this state when it is already approved</label><div>${v627PreflightMarkup(preflight)}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" ${preflight.errors.length ? "disabled" : ""} onclick="startPlannedEntityAutomation()">START</button></div></div>`);
};
window.openEntityChainAutomationModal = (list, id) => {
  const entity = P[list]?.find((item) => item.id === id), states = entityStateList(entity, true);
  if (!entity) return;
  const defaultIds = states.filter((state) => !(state.approvedFile || (state.isDefault && entity.approvedFile))).map((state) => state.id);
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626EntityAutomationDraft = { list, id, stateIds: defaultIds, scope: "state-chain", generationSettings };
  openModal(`<div class="automation-plan-modal"><h3>Plan continuity-state chain — ${esc(entity.name || id)}</h3><div class="modal-sub">PARENT-FIRST DERIVED REFERENCES</div>${v6211GenerationControlsMarkup(generationSettings,"entity",{includeBlocking:false,outputs:3})}<div class="automation-frame-picker">${states.map((state) => { const parent = assetStateParent(entity, state); return `<label><input type="checkbox" class="v626-auto-state" value="${attr(state.id)}" ${defaultIds.includes(state.id) ? "checked" : ""} onchange="updateEntityChainEstimate()"><span><b>${esc(state.name || "State")}</b><small>${state.approvedFile ? `Approved · ${esc(state.approvedFile)}` : "Needs reference"}${state.isDefault ? " · base state" : ` · derives from ${esc(parent?.name || "Default")}`}</small></span></label>`; }).join("")}</div><label class="checkline"><input id="v626-reuse-approved-states" type="checkbox" checked> Reuse already approved states</label><div id="v627-entity-chain-preflight"></div><div id="v626-entity-chain-note" class="automation-cost-guard"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="v626-start-entity-chain" class="approve-btn" onclick="startPlannedEntityAutomation()">START STATE CHAIN</button></div></div>`);
  updateEntityChainEstimate();
};
function v626ExpandStateDependencies(entity, stateIds) {
  const selected = new Set(stateIds), states = entityStateList(entity, true);
  const visit = (id) => {
    const state = entityStateById(entity, id);
    if (!state || state.isDefault) return;
    const parent = assetStateParent(entity, state);
    if (parent && !parent.approvedFile && !(parent.isDefault && entity.approvedFile)) { selected.add(parent.id); visit(parent.id); }
  };
  [...selected].forEach(visit);
  return [...selected];
}
function v626StateOrder(entity, stateIds) {
  const selected = new Set(v626ExpandStateDependencies(entity, stateIds)), ordered = [], visiting = new Set(), done = new Set();
  const visit = (state) => {
    if (!state || done.has(state.id) || visiting.has(state.id)) return;
    visiting.add(state.id);
    const parent = assetStateParent(entity, state);
    if (parent && selected.has(parent.id)) visit(parent);
    visiting.delete(state.id); done.add(state.id); if (selected.has(state.id)) ordered.push(state.id);
  };
  entityStateList(entity, true).forEach(visit);
  return ordered;
}
window.updateEntityChainEstimate = () => {
  const draft = window._v626EntityAutomationDraft || {}, entity = P[draft.list]?.find((item) => item.id === draft.id);
  const selected = [...document.querySelectorAll(".v626-auto-state:checked")].map((input) => input.value);
  const expanded = entity ? v626StateOrder(entity, selected) : selected;
  const note = document.getElementById("v626-entity-chain-note");
  const outputsPerRequest = Math.max(1, Math.min(4, Number(document.getElementById("entity-auto-outputs")?.value || draft.outputsPerRequest || 3)));
  const settings = { ...(draft.generationSettings || v6211AutomationGenerationSettings()) };
  settings.frameQuality = document.getElementById("entity-auto-frame-quality")?.value || settings.frameQuality;
  settings.frameResolution = document.getElementById("entity-auto-frame-resolution")?.value || settings.frameResolution;
  const maxImages = expanded.length * 3 * outputsPerRequest;
  if (note) note.innerHTML = `<b>Up to ${maxImages} generated images${v628CostEstimateText(maxImages)}</b><span>${expanded.length} state${expanded.length === 1 ? "" : "s"} · ${outputsPerRequest} image${outputsPerRequest === 1 ? "" : "s"} per pass · three rounds maximum per state</span>`;
  const preflight = entity ? v627EntityPreflight(draft.list, entity, expanded) : { errors: ["Entity unavailable."], warnings: [] };
  const preflightEl = document.getElementById("v627-entity-chain-preflight");
  if (preflightEl) preflightEl.innerHTML = v627PreflightMarkup(preflight);
  const button = document.getElementById("v626-start-entity-chain");
  if (button) button.disabled = !expanded.length || !!preflight.errors.length;
  window._v626EntityAutomationDraft = { ...draft, stateIds: expanded, outputsPerRequest, maxImages, generationSettings: settings };
};
window.startPlannedEntityAutomation = async () => {
  const draft = window._v626EntityAutomationDraft || {}, entity = P[draft.list]?.find((item) => item.id === draft.id);
  if (!entity || !draft.stateIds?.length) return toast("Choose at least one continuity state");
  const stateIds = v626StateOrder(entity, draft.stateIds);
  const preflight = v627EntityPreflight(draft.list, entity, stateIds);
  if (preflight.errors.length) return toast(preflight.errors[0]);
  const run = v626NewRun("entity-chain", `${draft.list}:${entity.id}`, draft.scope || "state-chain", `${entity.name || entity.id} continuity references`, stateIds.length > 1 ? "state-chain" : "single-state", {
    list: draft.list, entityId: entity.id, stateIds,
    reuseApproved: document.getElementById("v626-reuse-approved-states")?.checked !== false,
    stateRounds: 3, outputsPerRequest: Number(draft.outputsPerRequest || 3), maxImages: Number(draft.maxImages || stateIds.length * 3 * Number(draft.outputsPerRequest || 3)),
    generationSettings: draft.generationSettings || v6211AutomationGenerationSettings(),
  });
  run.entityList = draft.list; run.entityId = entity.id;
  closeModal();
  const saved = await v626CreateRun(run);
  runEntityAutomation(saved.id);
};

async function v626FindFalJob(jobId) {
  let job = (FAL_GENERATION_JOBS || []).find((item) => item.id === jobId) || null;
  if (!job) {
    const data = await fetch("/api/generation/fal/jobs").then((response) => response.ok ? response.json() : { jobs: [] });
    FAL_GENERATION_JOBS = data.jobs || [];
    job = FAL_GENERATION_JOBS.find((item) => item.id === jobId) || null;
  }
  return job;
}
async function v626RefreshFalJob(jobId) {
  const response = await fetch(`/api/generation/fal/jobs/${encodeURIComponent(jobId)}/refresh`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not refresh generation");
  const job = data.job;
  FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((item) => item.id !== job.id), job];
  if (job.status === "COMPLETED") await load();
  return job;
}
async function v626WaitFalJob(run, step, body) {
  await v626CheckCancelled(run);
  await v628RequireAutomationLease(run);
  await v641SetStepActivity(run, step.key, "preparing request", "Preparing the FAL request and checking the confirmed image budget. No paid request has been submitted yet.", {
    system: "FAL · GPT IMAGE 2",
    model: "GPT Image 2",
    providerAccepted: false,
    outputCount: Number(body.outputCount || 1),
    quality: String(body.quality || ""),
    resolution: String(body.resolution || ""),
  });
  let job = step.childJobId ? await v626FindFalJob(step.childJobId) : null;
  if (!job) {
    const count = Number(body.outputCount || 1);
    const max = Number(run.config?.maxImages);
    const used = Number(run.usage?.imagesGenerated);
    if (!Number.isInteger(max) || max <= 0) throw new Error("Credit guard is not configured with a valid positive image cap. No paid request was submitted.");
    if (!Number.isFinite(used) || used < 0) throw new Error("Credit guard usage is invalid. No paid request was submitted.");
    if (!Number.isInteger(count) || count <= 0) throw new Error("Requested image count is invalid. No paid request was submitted.");
    if (used + count > max) throw new Error(`Credit guard stopped the run before exceeding its ${max}-image cap.`);
    const durableOperationKey = step.retryCount ? `${step.key}:retry-${step.retryCount}` : step.key;
    await v6211RevalidatePaidStepLease(run, step);
    step = run.steps?.[step.key] || step;
    await v641SetStepActivity(run, step.key, "submitting", "Lease revalidated. Submitting the paid image request to FAL now.", {
      system: "FAL · GPT IMAGE 2", providerAccepted: false,
      outputCount: count, quality: String(body.quality || ""), resolution: String(body.resolution || ""),
    });
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, automationRunId: run.id, automationStepKey: durableOperationKey, automationRunnerId: V627_AUTOMATION_RUNNER_ID }) });
    const data = await response.json();
    if (!response.ok) {
      step.activity = { ...(step.activity || {}), state: "request rejected", detail: `${data.error || `FAL submission returned HTTP ${response.status}` } No paid request was accepted.`, system: "FAL · GPT IMAGE 2", providerAccepted: false, paidRequestSubmitted: false, httpStatus: response.status, errorCode: data.code || "", updatedAt: v626Now() };
      step.error = data.error || `FAL submission returned HTTP ${response.status}`;
      await v626SaveRun(run, false, false);
      if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
      throw new Error(data.error || "Could not start FAL generation");
    }
    job = data.job;
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((item) => item.id !== job.id), job];
    step.childJobId = job.id;
    step.activity = { ...(step.activity || {}), state: "provider accepted", detail: data.reused ? "Reattached to the previously accepted paid request; no duplicate request was submitted." : "FAL accepted the paid request. Waiting in the provider queue.", system: "FAL · GPT IMAGE 2", providerAccepted: true, providerStatus: job.status || "SUBMITTED", providerRequestId: job.providerRequestId || job.requestId || "", model: job.model || "GPT Image 2", outputCount: count, quality: String(body.quality || ""), resolution: String(body.resolution || ""), acceptedAt: v626Now(), updatedAt: v626Now() };
    if (!data.reused) run.usage.imageRequests = Number(run.usage.imageRequests || 0) + 1;
    await v626SaveRun(run, false);
  }
  const pollStartedAt = Date.now();
  while (job && falJobActive(job)) {
    await v626CheckCancelled(run);
    if (Date.now() - pollStartedAt >= V628_FAL_POLL_TIMEOUT_MS) {
      step.result = { ...(step.result || {}), providerStillActive: true, pollPausedAt: v626Now(), pollTimeoutMs: V628_FAL_POLL_TIMEOUT_MS };
      await v626SaveRun(run, false);
      const error = new Error("Provider job is still active. Progress and the accepted job ID are preserved; Resume Run later to check it again without resubmitting.");
      error.pollDeferred = true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 3500));
    job = await v626RefreshFalJob(job.id);
    step.activity = { ...(step.activity || {}), state: String(job.status || "in progress").toLowerCase().replace(/_/g, " "), detail: job.status === "IN_QUEUE" ? `FAL is holding the request in queue${job.queuePosition != null ? ` at position ${job.queuePosition}` : ""}.` : job.status === "IN_PROGRESS" ? "FAL is generating the requested candidates." : "Checking the provider job status.", system: "FAL · GPT IMAGE 2", providerAccepted: true, providerStatus: job.status || "", queuePosition: job.queuePosition, providerRequestId: job.providerRequestId || job.requestId || step.activity?.providerRequestId || "", model: job.model || step.activity?.model || "GPT Image 2", updatedAt: v626Now() };
    await v626SaveRun(run, false, false);
    if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
  }
  if (!job || job.status !== "COMPLETED") throw new Error(job?.error || "FAL generation did not complete");
  if (!step.result?.usageCounted) {
    run.usage.imagesGenerated = Number(run.usage.imagesGenerated || 0) + Number((job.outputs || []).length || body.outputCount || 0);
    step.result = { ...(step.result || {}), usageCounted: true, providerStillActive: false };
  }
  step.activity = { ...(step.activity || {}), state: "results returned", detail: `${(job.outputs || []).length || body.outputCount || 0} candidate${((job.outputs || []).length || body.outputCount || 0) === 1 ? "" : "s"} returned from FAL and saved to the project.`, providerAccepted: true, providerStatus: "COMPLETED", returnedCount: (job.outputs || []).length, completedAt: v626Now(), updatedAt: v626Now() };
  await v626SaveRun(run, false, false);
  if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
  return job;
}

function v626Pick(reviewData, run = null) {
  const review = reviewData?.review || {}, files = reviewData?.files || [];
  const rows = [...(review.reviews || [])].sort((a, b) => (+b.score || 0) - (+a.score || 0));
  const picked = rows.find((row) => row.pass === true) || rows[0] || null;
  const pass = picked?.pass === true;
  const score = Math.round(+picked?.score || 0);
  const explicitPass = picked?.explicitPass === true;
  const explicitScore = picked?.explicitScore === true;
  return { file: picked ? files[Number(picked.n) - 1] || "" : "", pass, explicitPass, explicitScore, autoApprove: pass && explicitPass && explicitScore && score >= v640AutoApproveScore(run), score, note: String(picked?.notes || review.rationale || ""), rationale: String(review.rationale || ""), review };
}
async function v627PauseForHumanReview(run, step, label) {
  step.status = "needs-review";
  step.updatedAt = v626Now();
  run.status = "awaiting-review";
  run.stage = label || "Human approval required";
  run.phase = "human-review";
  run.current = { ...(run.current || {}), stepKey: step.key, label: step.label || label, phase: "human-review" };
  run.summary = `CineBraid paused before approval. Review the returned candidates and choose which result becomes canon.`;
  await v626SaveRun(run, false);
  const error = new Error("Human approval required");
  error.reviewRequired = true;
  throw error;
}
async function v626ReviewBatch(run, endpoint, body) {
  const stepKey = run.current?.stepKey || "";
  const step = stepKey ? v626Step(run, stepKey) : null;
  const files = Array.isArray(body?.fileNames) ? body.fileNames : [];
  if (step) {
    step.activity = { ...(step.activity || {}), system: endpoint.includes("scene") ? "VISION AI · SCENE REVIEW" : "VISION AI · CANDIDATE REVIEW", state: "sending context", detail: `Preparing ${files.length || "the"} candidate${files.length === 1 ? "" : "s"} and approved reference context for vision review.`, model: CONFIG?.ai?.vision?.model || CONFIG?.ai?.model || "Configured vision model", reviewProgress: { current: 0, total: files.length, items: files.map((file, index) => ({ file, status: index === 0 ? "reviewing" : "pending" })) }, updatedAt: v626Now() };
  }
  run.usage.reviewCalls = Number(run.usage.reviewCalls || 0) + 1;
  await v626SaveRun(run, false);
  if (step) await v641SetStepActivity(run, step.key, "waiting for vision model", `Vision review is running for ${files.length || "the returned"} candidate${files.length === 1 ? "" : "s"}.`, step.activity || {});
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Assistant review failed");
  if (step) {
    const rows = Array.isArray(data?.review?.reviews) ? data.review.reviews : [];
    step.activity = { ...(step.activity || {}), state: "review complete", detail: `Vision review returned ${rows.length || files.length} structured candidate assessment${(rows.length || files.length) === 1 ? "" : "s"}.`, reviewProgress: { current: rows.length || files.length, total: files.length || rows.length, items: files.map((file, index) => { const row = rows.find((item) => Number(item.n) === index + 1) || {}; return { file, status: "completed", score: Number(row.score || 0), pass: row.pass === true, note: row.notes || "" }; }) }, updatedAt: v626Now() };
    await v626SaveRun(run, false, false);
    if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
  }
  return data;
}
function v626BlockingRowsFromJob(shotId, job) {
  const ids = new Set((job.outputs || []).map((item) => item.assetId).filter(Boolean));
  return blockingMediaRows(shotById(shotId)).filter((row) => ids.has(row.asset.id));
}
function v626FrameRowsFromJob(shotId, frameId, job) {
  const shot = shotById(shotId), frames = guidedFrames(shot), index = frames.findIndex((frame) => frame.id === frameId), names = new Set((job.outputs || []).map((item) => item.name || item.file).filter(Boolean));
  return guidedFrameCandidateRows(shot, frames[index], takesFor(shotId), index).filter((take) => names.has(take.name));
}
function v626GetBlockingBuild(shot, id) { return ensureShotCreation(shot).blockingBuilds.find((item) => item.id === id) || null; }
async function v626OpeningBlockingBuild(run, shotId, round, revision = "", sourceAssetId = "") {
  const key = `blocking:opening:round-${round}:prompt`, step = v626Step(run, key, "prompt", `Opening blocking prompt · round ${round}`);
  if (step.status === "completed") {
    const existing = v626GetBlockingBuild(shotById(shotId), step.buildId);
    if (existing) return existing;
  }
  await v626BeginStep(run, key, "prompt", `Build and improve opening blocking prompt · round ${round}`, { attempt: round, maxAttempts: run.config.openingBlockingRounds });
  const shot = shotById(shotId), creation = ensureShotCreation(shot);
  creation.blockingRevisionRequest = revision || ""; creation.blockingRevisionSourceAssetId = sourceAssetId || "";
  await v641SetStepActivity(run, key, "compiling", "CineBraid is assembling the deterministic blocking prompt from the shot brief, composition, and approved references.", { system: "CINEBRAID · PROMPT COMPILER" });
  await buildBlockingPrompt(shotId, false);
  run.usage.assistantCalls = Number(run.usage.assistantCalls || 0) + 1;
  await v641SetStepActivity(run, key, "waiting for local AI", "The compiled blocking prompt was sent to the local prompt advisor for improvement. Empty or malformed responses will retry automatically.", { system: "LOCAL AI · PROMPT ADVISOR", model: CONFIG?.ai?.text?.model || CONFIG?.ai?.model || "Configured local model" });
  await buildBlockingPrompt(shotId, true);
  await flushPendingProjectSave();
  const refreshed = shotById(shotId), build = ensureShotCreation(refreshed).blockingBuilds.at(-1);
  if (!build?.prompt) throw new Error("Opening blocking prompt was not built");
  if (!build.llmUsed) await v626Log(run, "Blocking advisor was unavailable after its retries; continuing with the deterministic blocking prompt.", "warn");
  await v626CompleteStep(run, key, { buildId: build.id, packageId: build.packageId || "", result: { llmUsed: !!build.llmUsed } });
  return build;
}
async function v626DerivativeBlockingBuild(run, shotId, frameId, round, revision = "") {
  const key = `blocking:${frameId}:round-${round}:prompt`, step = v626Step(run, key, "prompt", `Derivative blocking prompt · round ${round}`);
  const shot = shotById(shotId), frame = guidedFrames(shot).find((item) => item.id === frameId);
  if (step.status === "completed") { const existing = v626GetBlockingBuild(shot, step.buildId); if (existing) return existing; }
  await v626BeginStep(run, key, "prompt", `Build and improve Frame ${frame?.label || ""} derivative blocking · round ${round}`, { frameId, attempt: round, maxAttempts: run.config.derivativeBlockingRounds });
  const frames = guidedFrames(shot), index = frames.findIndex((item) => item.id === frameId), state = guidedFrameState(shot, frame, index), profileId = preferredCreationProfile("blocking", ensureShotCreation(shot).blockingProfileId);
  run.usage.assistantCalls = Number(run.usage.assistantCalls || 0) + 1;
  await v641SetStepActivity(run, key, "waiting for local AI", `The Frame ${frame?.label || ""} derivative blocking brief was sent to the local prompt advisor.`, { system: "LOCAL AI · PROMPT ADVISOR", model: CONFIG?.ai?.text?.model || CONFIG?.ai?.model || "Configured local model" });
  const data = await guidedPromptRequest("/api/prompt/compile", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      shotId, profileId, purpose: "blocking", references: [], useLLM: false, improveBlocking: true,
      blockingLabels: true, blockingEmphasis: "balanced",
      blockingFrameBrief: state.action || frame.description || shot.desc || "",
      blockingDirection: [state.staging, state.camera, state.notes, revision ? `Requested derivative-blocking changes: ${revision}` : "", `This is Frame ${frame.label}. Preserve the approved previous frame's camera and unchanged environment while staging only the new endpoint action.`].filter(Boolean).join("\n"),
      composition: ensureShotCreation(shot).composition,
    }),
  }, GUIDED_PROMPT_TIMEOUTS.improve, `Frame ${frame.label} derivative blocking improvement`);
  const creation = ensureShotCreation(shot), build = {
    id: `blocking-${Date.now().toString(36)}`, packageId: `${shotId}-FRAME-${frame.label}-BLOCKING-R${String(round).padStart(2, "0")}`,
    date: v626Now(), profileId, profileName: data.profile?.name || profileId, profileVersion: data.profile?.profileVersion || "",
    prompt: `${data.compiledPrompt}\n\nDERIVATIVE FRAME CONTRACT\nEdit the supplied approved previous frame into a flat grayscale blocking scaffold for Frame ${frame.label}. Preserve identity, location, camera logic, and every feature not explicitly changed by the Frame ${frame.label} brief.`,
    spec: data.spec, warnings: data.warnings || [], confirmations: data.confirmations || [], providerPayload: data.providerPayload || null,
    references: [], blockingPlan: data.blockingPlan || data.spec?.blockingPlan || null, blockingImprovementNotes: data.blockingImprovementNotes || [], llmUsed: !!data.llmUsed,
    inputBrief: state.action || frame.description || "", additionalDirection: [state.staging, state.camera, state.notes].filter(Boolean).join("\n"), revisionRequest: revision,
    kind: "blocking-frame", frameId, frameLabel: frame.label, derivative: true, revision: creation.blockingBuilds.length + 1,
  };
  creation.blockingBuilds.push(build); dirty(); await flushPendingProjectSave();
  if (!build.llmUsed) await v626Log(run, `Frame ${frame.label} blocking advisor fell back to deterministic compilation.`, "warn");
  await v626CompleteStep(run, key, { buildId: build.id, packageId: build.packageId, frameId, result: { llmUsed: !!build.llmUsed } });
  return build;
}

async function v664ReviewExistingBlockingForRun(run, shotId) {
  const shot = shotById(shotId), rows = v664BlockingRowsForReview(shot);
  if (!rows.length || run.config?.reviewExistingBlocking === false) return null;
  const key = "blocking:existing:review", prior = v626Step(run, key, "review", "Review existing blocking attempts");
  if (prior.status === "completed") {
    const row = rows.find(({asset}) => asset.id === prior.result?.assetId || v664BlockingFileName(asset) === prior.winner);
    if (prior.pass && row) { useBlockingGuide(shotId, row.asset.id); return row; }
    return null;
  }
  await v626BeginStep(run, key, "review", `Review ${rows.length} existing blocking attempt${rows.length === 1 ? "" : "s"}`, { attempt:1, maxAttempts:1 });
  const data = await v626ReviewBatch(run, "/api/llm/review", { kind:"blocking", id:shotId, frameId:guidedFrames(shot)[0]?.id || "", fileNames:rows.map(({asset}) => v664BlockingFileName(asset)) });
  const record = v664StoreBlockingReview(shotById(shotId), "", data), recommended = v664BlockingRowsForReview(shotById(shotId)).find(({asset}) => asset.id === record.suggestedAssetId), review = recommended ? record.items?.[recommended.asset.id] : null;
  await v626CompleteStep(run, key, { pass: review?.pass === true, score:Number(review?.score || 0), winner:recommended ? v664BlockingFileName(recommended.asset) : "", files:rows.map(({asset}) => v664BlockingFileName(asset)), review:data.review, revision:review?.pass ? "" : review?.notes || data.review?.rationale || "Existing blocking did not pass.", result:{ assetId:recommended?.asset?.id || "", rationale:data.review?.rationale || "", existing:true } });
  if (recommended && review?.pass) {
    useBlockingGuide(shotId, recommended.asset.id); dirty(); await flushPendingProjectSave();
    await v626Log(run, `Existing blocking approved: ${recommended.asset.title || recommended.asset.file} (${review.score}/100). No new blocking images were needed.`, "success");
    return recommended;
  }
  await v626Log(run, `Existing blocking attempts did not produce a passing guide. ${review?.notes || data.review?.rationale || "Generating a fresh round."}`, "warn");
  return null;
}

async function v626OpeningBlocking(run, shotId) {
  const shot = shotById(shotId), existing = activeBlockingRow(shot);
  if (run.config.reuseApproved && existing) {
    const key = "blocking:opening:reuse";
    if (v626Step(run, key).status !== "completed") await v626CompleteStep(run, key, { kind: "blocking-approval", label: "Opening blocking guide", status: "completed", winner: existing.asset.file, result: { assetId: existing.asset.id, reused: true } });
    return existing;
  }
  const reviewedExisting = await v664ReviewExistingBlockingForRun(run, shotId);
  if (reviewedExisting) return reviewedExisting;
  let revision = "", sourceAssetId = "";
  for (let round = 1; round <= Number(run.config.openingBlockingRounds || 3); round++) {
    await v626CheckCancelled(run);
    const reviewKey = `blocking:opening:round-${round}:review`, prior = v626Step(run, reviewKey);
    if (prior.status === "completed" && prior.pass && prior.result?.assetId) {
      const row = blockingMediaRows(shotById(shotId)).find(({ asset }) => asset.id === prior.result.assetId); if (row) { useBlockingGuide(shotId, row.asset.id); return row; }
    }
    if (round > 1) {
      const previous = v626Step(run, `blocking:opening:round-${round - 1}:review`);
      revision = previous.revision || ""; sourceAssetId = previous.result?.assetId || "";
    }
    const build = await v626OpeningBlockingBuild(run, shotId, round, revision, sourceAssetId);
    const genKey = `blocking:opening:round-${round}:generate`, genStep = v626Step(run, genKey, "generation", `Generate opening blocking candidates · round ${round}`);
    if (genStep.status !== "completed") {
      await v626BeginStep(run, genKey, "generation", `Generate ${v640OutputsPerRequest(run)} opening blocking candidates · round ${round}`, { attempt: round, maxAttempts: run.config.openingBlockingRounds });
      const source = sourceAssetId ? blockingMediaRows(shotById(shotId)).find(({ asset }) => asset.id === sourceAssetId) : null;
      const job = await v626WaitFalJob(run, genStep, { purpose: "blocking", shotId, frameId: guidedFrames(shotById(shotId))[0]?.id || "", frameLabel: guidedFrames(shotById(shotId))[0]?.label || "A", sourceBuildId: build.id, packageId: build.packageId || "", prompt: falBlockingRevisionPrompt(shotById(shotId), build, sourceAssetId, revision), references: source ? [{ key: `blocking-revision:${source.asset.id}`, label: source.asset.title || source.asset.file, role: "base", url: mediaAssetUrl(source.asset) }] : [], outputCount: v640OutputsPerRequest(run), quality: v6211RunGenerationSettings(run).blockingQuality, resolution: v6211RunGenerationSettings(run).blockingResolution, aspectRatio: ensureShotCreation(shotById(shotId)).composition?.aspectRatio || P.meta?.aspectRatio || "16:9", revisionRequest: revision, revisedFromAssetId: sourceAssetId });
      await v626CompleteStep(run, genKey, { childJobId: job.id, files: (job.outputs || []).map((item) => item.name), result: { ...(genStep.result || {}), outputs: job.outputs || [], usageCounted: true } });
    }
    const currentGen = v626Step(run, genKey), job = await v626FindFalJob(currentGen.childJobId), rows = v626BlockingRowsFromJob(shotId, job || { outputs: currentGen.result?.outputs || [] });
    if (!rows.length) throw new Error("Opening blocking candidates are unavailable");
    if (prior.status !== "completed") {
      await v626BeginStep(run, reviewKey, "review", `Review opening blocking candidates · round ${round}`, { attempt: round, maxAttempts: run.config.openingBlockingRounds });
      const data = await v626ReviewBatch(run, "/api/llm/review", { kind: "blocking", id: shotId, frameId: guidedFrames(shotById(shotId))[0]?.id || "", fileNames: rows.map((row) => row.asset.file) });
      const picked = v626Pick(data, run), row = rows.find((item) => item.asset.file === picked.file) || rows[0];
      await v626CompleteStep(run, reviewKey, { pass: picked.pass, score: picked.score, winner: picked.file || row.asset.file, files: rows.map((item) => item.asset.file), review: data.review, revision: picked.pass ? "" : picked.note || picked.rationale, result: { assetId: row.asset.id, rationale: picked.rationale } });
    }
    const reviewed = v626Step(run, reviewKey), row = rows.find((item) => item.asset.id === reviewed.result?.assetId) || rows.find((item) => item.asset.file === reviewed.winner) || rows[0];
    if (reviewed.pass && row) {
      useBlockingGuide(shotId, row.asset.id); dirty(); await flushPendingProjectSave();
      await v626Log(run, `Opening blocking approved: ${row.asset.file} (${Math.round(Number(reviewed.score || 0))}/100).`, "success");
      return row;
    }
    await v626Log(run, `Opening blocking round ${round} did not pass. ${reviewed.revision || "A tighter structural revision will be tried."}`, "warn");
  }
  throw new Error(`Opening blocking did not pass after ${Number(run.config.openingBlockingRounds || 3)} rounds`);
}
async function v626DerivativeBlocking(run, shotId, frameId) {
  const shot = shotById(shotId), frames = guidedFrames(shot), index = frames.findIndex((frame) => frame.id === frameId), frame = frames[index], state = guidedFrameState(shot, frame, index);
  if (run.config.reuseApproved && state.automationBlockingAssetId) {
    const row = blockingMediaRows(shot).find(({ asset }) => asset.id === state.automationBlockingAssetId); if (row) return row;
  }
  const previous = frames[index - 1], previousTake = guidedFrameApproved(shot, previous, takesFor(shotId), index - 1);
  if (!previousTake) throw new Error(`Frame ${frame.label} needs approved Frame ${previous?.label || "previous"}`);
  let revision = "", sourceAssetId = "";
  for (let round = 1; round <= Number(run.config.derivativeBlockingRounds || 2); round++) {
    const reviewKey = `blocking:${frameId}:round-${round}:review`, prior = v626Step(run, reviewKey);
    if (prior.status === "completed" && prior.pass && prior.result?.assetId) {
      const row = blockingMediaRows(shotById(shotId)).find(({ asset }) => asset.id === prior.result.assetId); if (row) { guidedFrameState(shotById(shotId), guidedFrames(shotById(shotId))[index], index).automationBlockingAssetId = row.asset.id; return row; }
    }
    if (round > 1) { const p = v626Step(run, `blocking:${frameId}:round-${round - 1}:review`); revision = p.revision || ""; sourceAssetId = p.result?.assetId || ""; }
    const build = await v626DerivativeBlockingBuild(run, shotId, frameId, round, revision);
    const genKey = `blocking:${frameId}:round-${round}:generate`, genStep = v626Step(run, genKey, "generation", `Generate Frame ${frame.label} blocking candidates · round ${round}`);
    if (genStep.status !== "completed") {
      await v626BeginStep(run, genKey, "generation", `Generate ${v640OutputsPerRequest(run)} Frame ${frame.label} derivative blocking candidates · round ${round}`, { frameId, attempt: round, maxAttempts: run.config.derivativeBlockingRounds });
      const sourceRow = sourceAssetId ? blockingMediaRows(shotById(shotId)).find(({ asset }) => asset.id === sourceAssetId) : null;
      const refs = sourceRow ? [{ key: `blocking-revision:${sourceRow.asset.id}`, label: sourceRow.asset.title || sourceRow.asset.file, role: "base", url: mediaAssetUrl(sourceRow.asset) }] : [{ key: `previous-frame:${previous.id}:${previousTake.name}`, label: `Approved Frame ${previous.label}`, role: "base", url: previousTake.url }];
      const prompt = `${build.prompt}\n\n${revision ? `REVISION\n${revision}\n` : ""}Preserve the supplied previous frame wherever the target Frame ${frame.label} description does not require a change.`;
      const job = await v626WaitFalJob(run, genStep, { purpose: "blocking", shotId, frameId, frameLabel: frame.label || "", sourceBuildId: build.id, packageId: build.packageId || "", prompt, references: refs, outputCount: v640OutputsPerRequest(run), quality: v6211RunGenerationSettings(run).blockingQuality, resolution: v6211RunGenerationSettings(run).blockingResolution, aspectRatio: ensureShotCreation(shotById(shotId)).composition?.aspectRatio || P.meta?.aspectRatio || "16:9", revisionRequest: revision, revisedFromAssetId: sourceAssetId });
      await v626CompleteStep(run, genKey, { childJobId: job.id, frameId, files: (job.outputs || []).map((item) => item.name), result: { ...(genStep.result || {}), outputs: job.outputs || [], usageCounted: true } });
    }
    const currentGen = v626Step(run, genKey), job = await v626FindFalJob(currentGen.childJobId), rows = v626BlockingRowsFromJob(shotId, job || { outputs: currentGen.result?.outputs || [] });
    if (!rows.length) throw new Error(`Frame ${frame.label} blocking candidates are unavailable`);
    if (prior.status !== "completed") {
      await v626BeginStep(run, reviewKey, "review", `Review Frame ${frame.label} derivative blocking · round ${round}`, { frameId, attempt: round, maxAttempts: run.config.derivativeBlockingRounds });
      const data = await v626ReviewBatch(run, "/api/llm/review", { kind: "blocking", id: shotId, frameId, fileNames: rows.map((row) => row.asset.file) });
      const picked = v626Pick(data, run), row = rows.find((item) => item.asset.file === picked.file) || rows[0];
      await v626CompleteStep(run, reviewKey, { frameId, pass: picked.pass, score: picked.score, winner: picked.file || row.asset.file, files: rows.map((item) => item.asset.file), review: data.review, revision: picked.pass ? "" : picked.note || picked.rationale, result: { assetId: row.asset.id, rationale: picked.rationale } });
    }
    const reviewed = v626Step(run, reviewKey), row = rows.find((item) => item.asset.id === reviewed.result?.assetId) || rows[0];
    if (reviewed.pass && row) {
      const currentShot = shotById(shotId), currentFrame = guidedFrames(currentShot).find((item) => item.id === frameId), currentIndex = guidedFrames(currentShot).indexOf(currentFrame), currentState = guidedFrameState(currentShot, currentFrame, currentIndex);
      currentState.automationBlockingAssetId = row.asset.id;
      for (const item of blockingMediaRows(currentShot)) if (item.asset.id === row.asset.id) { item.link.blockingFrameId = frameId; item.link.blockingState = "frame-active"; item.link.generationInput = true; }
      dirty(); await flushPendingProjectSave();
      await v626Log(run, `Frame ${frame.label} derivative blocking approved: ${row.asset.file}.`, "success");
      return row;
    }
    await v626Log(run, `Frame ${frame.label} blocking round ${round} did not pass. ${reviewed.revision || "Revising the endpoint layout."}`, "warn");
  }
  throw new Error(`Frame ${frame.label} derivative blocking did not pass after ${Number(run.config.derivativeBlockingRounds || 2)} rounds`);
}
async function v626FrameBuild(run, shotId, frameId, round, revision = "") {
  const key = `frame:${frameId}:round-${round}:prompt`, step = v626Step(run, key, "prompt", `Frame prompt · round ${round}`);
  let shot = shotById(shotId), frames = guidedFrames(shot), index = frames.findIndex((frame) => frame.id === frameId), frame = frames[index], state = guidedFrameState(shot, frame, index);
  if (step.status === "completed") { const existing = resolvePromptBuild(P, step.buildId); if (existing && !existing.missing) return existing; }
  await v626BeginStep(run, key, "prompt", `Build and improve Frame ${frame.label} prompt · round ${round}`, { frameId, attempt: round, maxAttempts: run.config.frameRounds });
  state.automationRevisionRequest = revision || "";
  if (index > 0) { state.usePreviousFrame = true; state.mode = "edit"; }
  await v641SetStepActivity(run, key, "compiling", `CineBraid is assembling the Frame ${frame?.label || ""} image prompt and numbered reference package.`, { system: "CINEBRAID · PROMPT COMPILER" });
  await buildGuidedFramePrompt(shotId, frameId, false);
  run.usage.assistantCalls = Number(run.usage.assistantCalls || 0) + 1;
  await v641SetStepActivity(run, key, "waiting for local AI", `The Frame ${frame?.label || ""} prompt was sent to the local prompt advisor for model-ready improvement.`, { system: "LOCAL AI · PROMPT ADVISOR", model: CONFIG?.ai?.text?.model || CONFIG?.ai?.model || "Configured local model" });
  await buildGuidedFramePrompt(shotId, frameId, true); await flushPendingProjectSave();
  shot = shotById(shotId); frames = guidedFrames(shot); index = frames.findIndex((item) => item.id === frameId); frame = frames[index]; state = guidedFrameState(shot, frame, index);
  const build = latestPromptBuild(P, state.promptBuilds || []);
  if (!build?.prompt || build.missing) throw new Error(`Frame ${frame.label} prompt was not built`);
  if (!build.llmUsed) await v626Log(run, `Frame ${frame.label} prompt advisor fell back to the deterministic compiler.`, "warn");
  await v626CompleteStep(run, key, { buildId: build.id, packageId: build.packageId || "", frameId, result: { llmUsed: !!build.llmUsed } });
  return build;
}
function v628AutomationReportSnapshot(run, stepKey, target = {}) {
  const steps = Object.fromEntries(Object.entries(run?.steps || {}).map(([key, step]) => [key, {
    key, kind: step.kind || "", status: step.status || "", label: step.label || "", attempt: Number(step.attempt || 0),
    childJobId: step.childJobId || "", winner: step.winner || "", score: Number.isFinite(Number(step.score)) ? Number(step.score) : null,
    pass: typeof step.pass === "boolean" ? step.pass : null, error: step.error || "", completedAt: step.completedAt || "", result: step.result || null,
  }]));
  return {
    schemaVersion: 1, runId: run.id, runRevision: run.revision, stepKey, type: run.type, targetId: run.targetId, scope: run.scope,
    status: run.status, stage: run.stage, capturedAt: v626Now(), target, config: run.config || {}, usage: run.usage || {}, steps, logs: run.logs || [],
    reportEndpoint: `/api/automation/runs/${encodeURIComponent(run.id)}`,
  };
}
function v628AttachShotAutomationProvenance(run, frameId, fileName, stepKey, details = {}) {
  const shotId = details.shotId || run?.targetId;
  const shot = shotById(shotId), frame = frameById(shot, frameId);
  if (!shot || !fileName) return;
  const candidate = typeof candidateRecord === "function" ? candidateRecord(shot, fileName) : (shot.candidateFiles || []).find((item) => (item.stored || item.name) === fileName);
  const job = (FAL_GENERATION_JOBS || []).find((item) => item.id === candidate?.generationJobId) || null;
  const report = v628AutomationReportSnapshot(run, stepKey, { kind: "shot-frame", shotId: shot.id, frameId, frameLabel: frame?.label || "", fileName });
  const record = {
    id: `${run.id}:${stepKey}`, kind: "automation-still", automationRunId: run.id, automationStepKey: stepKey,
    file: fileName, files: fileName, frameId, frameLabel: frame?.label || "", model: job?.model || candidate?.generationModel || "",
    prompt: job?.prompt || "", generationJobId: job?.id || candidate?.generationJobId || "", score: Number(details.score || 0),
    approval: details.humanApproved ? "director" : details.reused ? "reused" : "automatic", date: v626Now(), automationReport: report,
  };
  if (candidate) { candidate.automationRunId = run.id; candidate.automationStepKey = stepKey; candidate.automationReport = report; }
  shot.generationRecords = Array.isArray(shot.generationRecords) ? shot.generationRecords : [];
  const index = shot.generationRecords.findIndex((item) => item.id === record.id);
  if (index >= 0) shot.generationRecords[index] = record; else shot.generationRecords.push(record);
  dirty();
}
function v628AttachEntityAutomationProvenance(run, list, entityId, stateId, fileName, stepKey, details = {}) {
  const entity = P[list]?.find((item) => item.id === entityId), state = entityStateById(entity, stateId);
  if (!entity || !fileName) return;
  const candidate = typeof entityCandidateRow === "function" ? entityCandidateRow(entity, fileName, false) : null;
  const job = (FAL_GENERATION_JOBS || []).find((item) => item.id === candidate?.generationJobId) || null;
  const report = v628AutomationReportSnapshot(run, stepKey, { kind: "entity-state", entityList: list, entityId, stateId, stateName: state?.name || "", fileName });
  if (candidate) { candidate.automationRunId = run.id; candidate.automationStepKey = stepKey; candidate.automationReport = report; }
  entity.made = Array.isArray(entity.made) ? entity.made : [];
  const record = { id: `${run.id}:${stepKey}`, model: job?.model || candidate?.generationModel || "", files: fileName, prompt: job?.prompt || candidate?.prompt || "", date: v626Now().slice(0, 10), automationRunId: run.id, automationStepKey: stepKey, stateId, stateName: state?.name || "", score: Number(details.score || 0), approval: details.humanApproved ? "director" : details.reused ? "reused" : "automatic", automationReport: report };
  const index = entity.made.findIndex((item) => item.id === record.id || (item.automationRunId === run.id && item.automationStepKey === stepKey));
  if (index >= 0) entity.made[index] = record; else entity.made.push(record);
  dirty();
}
function v626ApproveFrame(shotId, frameId, fileName) {
  const shot = shotById(shotId), frame = frameById(shot, frameId), previous = frame?.winner || "";
  if (!shot || !frame || !fileName) throw new Error("Frame approval target is unavailable");
  frame.winner = fileName;
  if ((shot.keyframes || [])[0]?.id === frame.id) shot.winner = fileName;
  if (typeof markCandidateApproved === "function") markCandidateApproved(shot, fileName, `frame:${frame.id}`);
  if (previous && previous !== fileName && typeof guidedFrameApprovalChanged === "function") guidedFrameApprovalChanged(shotId, `frame:${frame.id}`, previous, fileName);
  shot.workflowStatus = "IN PROGRESS"; shot.status = "BUILT";
  ensureShotCreation(shot).activeGuidedFrameId = frame.id;
  dirty();
}
async function v626AutomateFrame(run, shotId, frameId) {
  let shot = shotById(shotId), frames = guidedFrames(shot), index = frames.findIndex((frame) => frame.id === frameId), frame = frames[index];
  const approved = guidedFrameApproved(shot, frame, takesFor(shotId), index);
  if (run.config.reuseApproved && approved) {
    const key = `frame:${frameId}:reuse`;
    if (v626Step(run, key).status !== "completed") await v626CompleteStep(run, key, { kind: "frame-approval", label: `Frame ${frame.label} approved`, frameId, winner: approved.name, result: { reused: true } });
    v628AttachShotAutomationProvenance(run, frameId, approved.name, key, { reused: true });
    await flushPendingProjectSave();
    return approved.name;
  }
  if (index === 0) await v626OpeningBlocking(run, shotId);
  else if (run.config.derivativeBlocking) await v626DerivativeBlocking(run, shotId, frameId);
  let revision = "";
  for (let round = 1; round <= Number(run.config.frameRounds || 2); round++) {
    const reviewKey = `frame:${frameId}:round-${round}:review`, prior = v626Step(run, reviewKey);
    if (prior.status === "completed" && prior.pass && prior.winner) { await v628RequireAutomationLease(run); v626ApproveFrame(shotId, frameId, prior.winner); v628AttachShotAutomationProvenance(run, frameId, prior.winner, prior.key, { score: prior.score }); await flushPendingProjectSave(); return prior.winner; }
    if (round > 1) revision = v626Step(run, `frame:${frameId}:round-${round - 1}:review`).revision || "";
    const build = await v626FrameBuild(run, shotId, frameId, round, revision);
    const genKey = `frame:${frameId}:round-${round}:generate`, genStep = v626Step(run, genKey, "generation", `Generate Frame ${frame.label} candidates · round ${round}`);
    if (genStep.status !== "completed") {
      await v626BeginStep(run, genKey, "generation", `Generate ${v640OutputsPerRequest(run)} Frame ${frame.label} candidates · round ${round}`, { frameId, attempt: round, maxAttempts: run.config.frameRounds });
      const refs = (build.references || []).filter((ref) => ref.url).map((ref) => ({ key: ref.key, label: ref.label, role: ref.role, instruction: ref.instruction || "", url: ref.url }));
      const job = await v626WaitFalJob(run, genStep, { purpose: "frame", shotId, frameId, frameLabel: frame.label || "A", sourceBuildId: build.id, packageId: build.packageId || "", prompt: build.prompt, references: refs, outputCount: v640OutputsPerRequest(run), quality: v6211RunGenerationSettings(run).frameQuality, resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: shotAspectLabel(P, shotById(shotId)) });
      await v626CompleteStep(run, genKey, { childJobId: job.id, frameId, files: (job.outputs || []).map((item) => item.name), result: { ...(genStep.result || {}), outputs: job.outputs || [], usageCounted: true } });
    }
    shot = shotById(shotId); frames = guidedFrames(shot); index = frames.findIndex((item) => item.id === frameId); frame = frames[index];
    const currentGen = v626Step(run, genKey), job = await v626FindFalJob(currentGen.childJobId), rows = v626FrameRowsFromJob(shotId, frameId, job || { outputs: currentGen.result?.outputs || [] });
    if (!rows.length) throw new Error(`Frame ${frame.label} candidates are unavailable`);
    if (prior.status !== "completed") {
      await v626BeginStep(run, reviewKey, "review", `Review Frame ${frame.label} candidates · round ${round}`, { frameId, attempt: round, maxAttempts: run.config.frameRounds });
      const endpoint = index > 0 ? "/api/llm/review-derived-frame" : "/api/llm/review";
      const body = index > 0 ? { shotId, frameId, fileNames: rows.map((row) => row.name) } : { kind: "shot", id: shotId, frameId, fileNames: rows.map((row) => row.name) };
      const data = await v626ReviewBatch(run, endpoint, body);
      if (typeof storeCandidateAIReview === "function") storeCandidateAIReview(shotId, data);
      const picked = v626Pick(data, run);
      await v626CompleteStep(run, reviewKey, { kind: "frame-review", label: `Frame ${frame.label} review`, frameId, pass: picked.pass, score: picked.score, winner: picked.file, files: rows.map((row) => row.name), review: data.review, revision: picked.pass ? "" : picked.note || picked.rationale, result: { rationale: picked.rationale, context: data.context || [], autoApprove: picked.autoApprove, explicitPass: picked.explicitPass, explicitScore: picked.explicitScore, threshold: V627_AUTOMATION_AUTO_APPROVE_SCORE } });
    }
    const reviewed = v626Step(run, reviewKey);
    if (reviewed.pass && reviewed.winner && reviewed.result?.autoApprove) {
      await v628RequireAutomationLease(run);
      v626ApproveFrame(shotId, frameId, reviewed.winner);
      const approvalKey = `frame:${frameId}:approval`;
      v628AttachShotAutomationProvenance(run, frameId, reviewed.winner, approvalKey, { score: reviewed.score });
      await flushPendingProjectSave();
      await v626CompleteStep(run, approvalKey, { kind: "frame-approval", label: `Frame ${frame.label} approved`, frameId, winner: reviewed.winner, score: reviewed.score, pass: true, result: { rationale: reviewed.result?.rationale || "Best passing candidate" } });
      await v626Log(run, `Frame ${frame.label} approved: ${reviewed.winner} (${Math.round(Number(reviewed.score || 0))}/100).`, "success");
      return reviewed.winner;
    }
    if ((reviewed.pass && reviewed.winner) || round >= Number(run.config.frameRounds || 2)) await v627PauseForHumanReview(run, reviewed, `Approve Frame ${frame.label}`);
    await v626Log(run, `Frame ${frame.label} round ${round} did not pass. ${reviewed.revision || "Revising the prompt from review findings."}`, "warn");
  }
  throw new Error(`Frame ${frame.label} did not pass after ${Number(run.config.frameRounds || 2)} rounds`);
}

async function v664ReviewSceneAfterShot(run, shot) {
  const scene = sceneById(shot?.scene || "");
  if (!scene || run.config?.reviewSceneAfterShot === false) return null;
  const approvedCount = v664SceneApprovedCount(shot);
  if (approvedCount < 2) {
    await v626Log(run, "Scene continuity review skipped until at least two approved stills exist in the scene.", "info");
    return null;
  }
  const key = "scene:continuity-review", prior = v626Step(run, key, "scene-review", "Review scene continuity against Project Bible");
  if (prior.status === "completed" && prior.review) return prior.review;
  await v626BeginStep(run, key, "scene-review", `Review ${scene.title || scene.id} continuity`, { attempt:1, maxAttempts:1 });
  await v641SetStepActivity(run, key, "assembling scene and Project Bible context", `Comparing ${approvedCount} approved stills in sequence against approved character, location, prop and vehicle authorities.`, { system:"VISION AI · SCENE CONTINUITY", model:CONFIG?.ai?.vision?.model || CONFIG?.ai?.model || "Configured vision model" });
  const expectedChanges = String(scene.continuityReviewSettings?.expectedChanges || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const response = await fetch("/api/llm/review-scene", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ sceneId:scene.id, expectedChanges }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Scene continuity review failed");
  const fresh = sceneById(scene.id), priorOverrides = fresh?.continuityReview?.overrides || { intentional:{}, notes:{} };
  if (fresh) fresh.continuityReview = { ...(data.review || {}), overrides:priorOverrides };
  run.result = run.result || {}; run.result.sceneReview = data.review || null;
  dirty(); await flushPendingProjectSave();
  const pass = typeof v640SceneReviewPass === "function" ? v640SceneReviewPass(data.review, "normal") : String(data.review?.verdict || "").toLowerCase() === "pass";
  await v626CompleteStep(run, key, { pass, score:Math.min(...Object.values(data.review?.scores || {}).map(Number).filter(Number.isFinite), 100), review:data.review, result:{ verdict:data.review?.verdict || "reviewed", sceneId:scene.id } });
  await v626Log(run, pass ? "Scene continuity review passed against the approved production authorities." : `Scene continuity review completed with flagged issues: ${data.review?.summary || "Open the scene review for details."}`, pass ? "success" : "warn");
  return data.review;
}

async function runShotAutomation(runId) {
  if (V626_ACTIVE_AUTOMATION_RUNS.has(runId)) return;
  let run;
  try { run = await v627AcquireAutomationLease(runId); }
  catch (error) { toast(error.code === "RUN_LEASED" ? "This run is already active in another CineBraid window" : error.message); return; }
  try {
    const shot = shotById(run.targetId), frames = guidedFrames(shot), ids = run.config?.frameIds || [];
    if (run.config?.blockingOnly || run.scope === "blocking-only") {
      await v626Log(run, "Starting durable blocking-only automation.", "info");
      await v626SetStage(run, "Opening blocking", "blocking", "Building, generating, reviewing, and selecting a grayscale composition guide. No finished still will be generated.");
      const guide = await v626OpeningBlocking(run, run.targetId);
      const currentShot = shotById(run.targetId);
      keepGuidedPanelOpen(currentShot, "blocking");
      try { boundedWriteState("selected:shot-task", currentShot.id, "look"); boundedWriteState("selected:shot-look-view", currentShot.id, "blocking"); } catch {}
      dirty(); await flushPendingProjectSave();
      await v626FinishRun(run, "completed", `Blocking guide approved: ${guide?.asset?.title || guide?.asset?.file || "active guide"}. The shot is ready for manual frame work or optional still automation.`);
      toast("Blocking automation completed — active guide selected");
      return;
    }
    await v626Log(run, `Starting durable still chain for ${ids.length} frame${ids.length === 1 ? "" : "s"}.`, "info");
    for (const frameId of ids) {
      await v626CheckCancelled(run);
      const frame = frames.find((item) => item.id === frameId);
      await v626SetStage(run, `Frame ${frame?.label || frameId}`, "frame", `Creating the approved still chain. Motion generation remains manual.`);
      await v626AutomateFrame(run, run.targetId, frameId);
    }
    const currentShot = shotById(run.targetId), required = guidedFrames(currentShot).filter((frame) => frame.required !== false), approvedLabels = required.filter((frame, index) => guidedFrameApproved(currentShot, frame, takesFor(currentShot.id), guidedFrames(currentShot).indexOf(frame))).map((frame) => frame.label);
    ensureShotCreation(currentShot).automationReadyForMotion = true;
    ensureShotCreation(currentShot).automationCompletedFrameIds = ids;
    keepGuidedPanelOpen(currentShot, "motion"); dirty(); await flushPendingProjectSave();
    const sceneReview = await v664ReviewSceneAfterShot(run, currentShot);
    const sceneNote = sceneReview ? ` Scene continuity review: ${String(sceneReview.verdict || "reviewed").replace(/_/g," ")}.` : "";
    await v626FinishRun(run, "completed", `${approvedLabels.length} required frame${approvedLabels.length === 1 ? "" : "s"} approved (${approvedLabels.join(", ") || "none"}).${sceneNote} The still package is ready for manual motion setup; no video was generated.`);
    toast("Still automation completed — open Motion to generate video manually");
  } catch (error) {
    if (error?.reviewRequired) { toast("Automation paused for your approval"); }
    else {
      const interrupted = error?.cancelled || error?.leaseLost || error?.pollDeferred || v626RunCancelled(run);
      if (!interrupted && run.current?.stepKey) await v626FailStep(run, run.current.stepKey, error);
      const summary = error?.leaseLost
        ? "Automation lease was lost. Progress is preserved; choose Resume Run before continuing."
        : error?.pollDeferred
          ? "Provider job is still active. Progress and the accepted job ID are preserved; Resume Run later to check it again without resubmitting."
          : interrupted
            ? "Run stopped safely. Resume later without repeating completed paid work."
            : `${error.message || "Automation stopped"} Use Retry Failed Step to retry only the failed operation.`;
      await v628FinishRunAfterError(run, interrupted ? "interrupted" : "failed", summary, error);
      toast(interrupted ? (error?.pollDeferred ? "Provider is still working — resume later" : error?.leaseLost ? "Lease lost — Resume Run required" : "Automation stopped safely") : `Automation stopped: ${error.message}`);
    }
  } finally { await v627ReleaseAutomationLease(run); route(); }
}

function v626EntityTarget(run) { const list = run.config?.list || run.entityList, id = run.config?.entityId || run.entityId; return { list, id, entity: P[list]?.find((item) => item.id === id) }; }
function v626ApproveEntity(list, entityId, stateId, fileName) {
  const entity = P[list]?.find((item) => item.id === entityId), state = entityStateById(entity, stateId);
  if (!entity || !state || !fileName) throw new Error("Entity approval target is unavailable");
  state.approvedFile = fileName; state.approvedAt = v626Now();
  if (state.isDefault) entity.approvedFile = fileName;
  const row = entityCandidateRow(entity, fileName, false); if (row?.decision === "rejected") row.decision = "unreviewed";
  entity.workflowStatus = "APPROVED"; entity.status = "APPROVED"; entity.approvedAt = v626Now(); dirty();
}
async function v626EntityBuild(run, list, entityId, stateId, round, revision = "") {
  const key = `entity:${stateId}:round-${round}:prompt`, step = v626Step(run, key, "prompt", `State prompt · round ${round}`);
  let entity = P[list]?.find((item) => item.id === entityId), state = entityStateById(entity, stateId);
  if (!entity || !state) throw new Error("Continuity-state prompt target is unavailable");
  if (!state.isDefault && !continuityStateDeltaText(state)) throw new Error(`${state.name || "State"} needs a state change / delta before automation can build its prompt. Open Continuity States and describe the visible change; “Applies to scenes / shots” is not a visual delta.`);
  if (step.status === "completed") {
    const existing = state.isDefault ? assetPromptBuilds(entity).find((item) => item.id === step.buildId) : assetStatePromptBuilds(state).find((item) => item.id === step.buildId);
    if (existing) return existing;
  }
  await v626BeginStep(run, key, "prompt", `Build and improve ${state.name || "state"} prompt · round ${round}`, { stateId, attempt: round, maxAttempts: run.config.stateRounds });
  await v641SetStepActivity(run, key, "compiling", `CineBraid is assembling the ${state.name || "reference"} prompt from entity canon and continuity-state requirements.`, { system: "CINEBRAID · PROMPT COMPILER" });
  let compiledBuild = null;
  if (state.isDefault) {
    entity.assetAutomationRevisionRequest = revision;
    const before = assetPromptBuilds(entity).length;
    await buildAssetCreationPrompt(list, entityId, false);
    compiledBuild = assetPromptBuilds(entity).length > before ? assetPromptBuilds(entity).at(-1) : null;
  } else {
    state.assetAutomationRevisionRequest = revision; state.generationMode = "derive";
    compiledBuild = await buildEntityStatePrompt(list, entityId, stateId, false);
  }
  if (!compiledBuild?.prompt) {
    const operation = state.isDefault ? guidedPromptOp("asset", `${list}:${entityId}`, "") : guidedPromptOp("asset-state", `${list}:${entityId}`, stateId);
    throw new Error(operation?.error || `${state.name || "State"} deterministic prompt compilation failed`);
  }
  run.usage.assistantCalls = Number(run.usage.assistantCalls || 0) + 1;
  await v641SetStepActivity(run, key, "waiting for local AI", `The ${state.name || "reference"} prompt was sent to the local prompt advisor for improvement.`, { system: "LOCAL AI · PROMPT ADVISOR", model: CONFIG?.ai?.text?.model || CONFIG?.ai?.model || "Configured local model" });
  let improvedBuild = null;
  if (state.isDefault) {
    const before = assetPromptBuilds(entity).length;
    await buildAssetCreationPrompt(list, entityId, true);
    improvedBuild = assetPromptBuilds(entity).length > before ? assetPromptBuilds(entity).at(-1) : null;
  } else improvedBuild = await buildEntityStatePrompt(list, entityId, stateId, true);
  let build = improvedBuild?.prompt ? improvedBuild : compiledBuild;
  if (!improvedBuild?.prompt) {
    const operation = state.isDefault ? guidedPromptOp("asset", `${list}:${entityId}`, "") : guidedPromptOp("asset-state", `${list}:${entityId}`, stateId);
    await v626Log(run, `${state.name || "State"} prompt advisor could not return an improved prompt${operation?.error ? `: ${operation.error}` : ""}. Continuing with the saved deterministic prompt.`, "warn");
    if (!state.isDefault) setGuidedPromptOp("asset-state", `${list}:${entityId}`, stateId, null);
  }
  await flushPendingProjectSave();
  entity = P[list]?.find((item) => item.id === entityId); state = entityStateById(entity, stateId);
  if (!build?.prompt) throw new Error(`${state.name || "State"} prompt was not built`);
  if (!build.llmUsed) await v626Log(run, `${state.name || "State"} automation is using deterministic prompt compilation.`, "warn");
  await v626CompleteStep(run, key, { buildId: build.id, stateId, result: { llmUsed: !!build.llmUsed, deterministicFallback: !improvedBuild?.prompt } });
  return build;
}
function v663StoreEntityAutomationReview(entity, state, fileName, data) {
  if (!entity || !state || !fileName) return null;
  const row = entityCandidateRow(entity, fileName, true);
  row.structuredReviews = row.structuredReviews && typeof row.structuredReviews === "object" ? row.structuredReviews : {};
  const review = {
    ...(data?.review || {}),
    contractVersion: data?.review?.contractVersion || data?.contractVersion || ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
    authoritySignature: data?.review?.authoritySignature || data?.authoritySignature || "",
    stateId: state.id,
    stateName: state.name || "Default",
    reviewedAt: new Date().toISOString(),
    inputLabels: Array.isArray(data?.inputLabels) ? data.inputLabels : [],
    source: "state-automation",
  };
  row.structuredReviews[state.id] = review;
  row.targetStateId = state.id;
  row.targetStateName = state.name || "Default";
  row.decision = row.decision === "rejected" ? "unreviewed" : row.decision || "unreviewed";
  return review;
}
function v663EntityReviewCorrection(review, list = "") {
  const source = review && typeof review === "object" ? review : {};
  const lines = [];
  const hardLabels = {
    sameUnderlyingEntity: "Keep the exact same underlying subject/design as the approved authority",
    onlyRequestedDelta: "Apply only the requested state delta and no unrelated changes",
    sameEmbeddedContent: "Preserve the exact embedded photograph, artwork, print, text, map, or screen content pixel-for-pixel in identity and composition",
    sameSpatialGeometry: "Preserve the exact spatial geometry, topology, openings, fixtures, and object placement established by the approved location authorities",
    requestedViewCorrect: "Use the requested viewpoint while remaining spatially consistent with the approved views",
  };
  for (const key of source.hardGateFailures || []) {
    if (hardLabels[key]) lines.push(hardLabels[key]);
  }
  for (const [key, row] of Object.entries(source.hardChecks || {})) {
    if (row?.required && row?.pass !== true && row?.note) lines.push(`${hardLabels[key] || key}: ${row.note}`);
  }
  for (const [key, row] of Object.entries(source.categories || {})) {
    if (["major", "blocking"].includes(String(row?.severity || "").toLowerCase()) && row?.note) lines.push(`${key}: ${row.note}`);
  }
  if (source.summary) lines.push(source.summary);
  if (list === "locations") lines.push("Do not redesign or invent a different room. Treat every approved angle as one shared 3D space and solve the requested camera from that same space.");
  if (list === "props") lines.push("Do not replace, redraw, restage, or reinterpret any photograph, mural, artwork, printed material, label, or other content carried by the prop.");
  lines.push("Start again from the approved parent authority, preserve everything not named in the state delta, and make the correction visibly verifiable.");
  return [...new Set(lines.map((line) => String(line || "").trim()).filter(Boolean))].join("\n");
}

async function v626AutomateEntityState(run, list, entityId, stateId) {
  let entity = P[list]?.find((item) => item.id === entityId), state = entityStateById(entity, stateId);
  if (run.config.reuseApproved && state.approvedFile) {
    const key = `entity:${stateId}:reuse`;
    if (v626Step(run, key).status !== "completed") await v626CompleteStep(run, key, { kind: "entity-approval", label: `${state.name || "State"} approved`, stateId, winner: state.approvedFile, result: { reused: true } });
    v628AttachEntityAutomationProvenance(run, list, entityId, stateId, state.approvedFile, key, { reused: true });
    await flushPendingProjectSave();
    return state.approvedFile;
  }
  if (!state.isDefault) {
    const parent = assetStateParent(entity, state), parentFile = parent?.approvedFile || (parent?.isDefault ? entity.approvedFile : "");
    if (!parentFile) throw new Error(`${state.name || "State"} needs approved parent state ${parent?.name || "Default"}`);
    state.parentStateId = parent.id; state.generationMode = "derive"; dirty(); await flushPendingProjectSave();
  }
  let revision = "";
  for (let round = 1; round <= Number(run.config.stateRounds || 2); round++) {
    const reviewKey = `entity:${stateId}:round-${round}:review`, prior = v626Step(run, reviewKey);
    if (prior.status === "completed" && prior.pass && prior.winner) { v626ApproveEntity(list, entityId, stateId, prior.winner); await flushPendingProjectSave(); return prior.winner; }
    if (round > 1) revision = v626Step(run, `entity:${stateId}:round-${round - 1}:review`).revision || "";
    const build = await v626EntityBuild(run, list, entityId, stateId, round, revision);
    entity = P[list]?.find((item) => item.id === entityId); state = entityStateById(entity, stateId);
    const genKey = `entity:${stateId}:round-${round}:generate`, genStep = v626Step(run, genKey, "generation", `Generate ${state.name || "state"} candidates · round ${round}`);
    if (genStep.status !== "completed") {
      await v626BeginStep(run, genKey, "generation", `Generate ${v640OutputsPerRequest(run)} ${state.name || "state"} candidates · round ${round}`, { stateId, attempt: round, maxAttempts: run.config.stateRounds });
      const parentInfo = state.isDefault ? null : assetStateParentMedia(list, entity, state), derivationMode = state.isDefault ? "independent" : "derive";
      const references = state.isDefault ? [] : entityGenerationReferences(list, entity, { state, mode: derivationMode });
      const prompt = state.isDefault ? build.prompt : entityGenerationPrompt(list, entity, build, references, { state, mode: derivationMode });
      const job = await v626WaitFalJob(run, genStep, { purpose: "entity-reference", entityList: list, entityId, entityType: { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list] || "entity", continuityStateId: state.id, continuityStateName: state.name || "", parentStateId: parentInfo?.parent?.id || "", parentStateName: parentInfo?.parent?.name || "", parentApprovedFile: derivationMode === "derive" ? parentInfo?.file || "" : "", derivationMode, sourceBuildId: build.id, prompt, references, outputCount: v640OutputsPerRequest(run), quality: v6211RunGenerationSettings(run).frameQuality, resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: list === "characters" ? "3:4" : list === "locations" ? "16:9" : "4:3" });
      await v626CompleteStep(run, genKey, { childJobId: job.id, stateId, files: (job.outputs || []).map((item) => item.name), result: { ...(genStep.result || {}), outputs: job.outputs || [], usageCounted: true } });
    }
    entity = P[list]?.find((item) => item.id === entityId); state = entityStateById(entity, stateId);
    const currentGen = v626Step(run, genKey), job = await v626FindFalJob(currentGen.childJobId), files = (job?.outputs || currentGen.result?.outputs || []).map((item) => item.name).filter(Boolean), media = entityMedia(list, entity).filter((item) => files.includes(item.name));
    if (!media.length) throw new Error(`${state.name || "State"} candidates are unavailable`);
    if (prior.status !== "completed") {
      await v626BeginStep(run, reviewKey, "review", `Review ${state.name || "state"} candidates · round ${round}`, { stateId, attempt: round, maxAttempts: run.config.stateRounds });
      const results = [];
      const reviewStep = v626Step(run, reviewKey);
      reviewStep.activity = { ...(reviewStep.activity || {}), system: "VISION AI · REFERENCE REVIEW", state: "reviewing candidate 1", detail: `Reviewing ${media.length} returned reference candidates one at a time against ${state.name || "the target state"}.`, model: CONFIG?.ai?.vision?.model || CONFIG?.ai?.model || "Configured vision model", reviewProgress: { current: 0, total: media.length, items: media.map((item, index) => ({ file: item.name, status: index === 0 ? "reviewing" : "pending" })) }, updatedAt: v626Now() };
      await v626SaveRun(run, false);
      for (let mediaIndex = 0; mediaIndex < media.length; mediaIndex++) {
        const item = media[mediaIndex];
        reviewStep.activity.reviewProgress.items = media.map((row, index) => {
          const existing = results.find((result) => result.file === row.name);
          return existing ? { file: row.name, status: "completed", score: Number(existing.review?.score || 0), pass: existing.review?.pass === true, note: existing.review?.summary || "" } : { file: row.name, status: index === mediaIndex ? "reviewing" : "pending" };
        });
        reviewStep.activity.reviewProgress.current = mediaIndex;
        reviewStep.activity.state = `reviewing candidate ${mediaIndex + 1}`;
        reviewStep.activity.detail = `Vision AI is reviewing ${item.name} against the approved identity and ${state.name || "continuity-state"} requirements.`;
        reviewStep.activity.updatedAt = v626Now();
        run.usage.reviewCalls = Number(run.usage.reviewCalls || 0) + 1; await v626SaveRun(run, false);
        const response = await fetch("/api/llm/review-entity-candidate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list, id: entityId, fileName: item.name, stateId }) });
        const data = await response.json().catch(() => ({}));
        entity = P[list]?.find((candidate) => candidate.id === entityId);
        state = entityStateById(entity, stateId);
        let persistedReview;
        if (response.ok) {
          persistedReview = v663StoreEntityAutomationReview(entity, state, item.name, data) || data.review || {};
          dirty();
          await flushPendingProjectSave();
        } else {
          persistedReview = {
            score: 0,
            pass: false,
            autoApprove: false,
            reviewUnavailable: true,
            recommendation: "human-review",
            summary: `AI review unavailable: ${data.error || "The vision model did not return a structured review."}`,
            hardGateFailures: ["review-unavailable"],
          };
          await v626Log(run, `${item.name} was generated successfully, but optional AI review was unavailable. Keeping it for human review.`, "warn");
        }
        results.push({ file: item.name, review: persistedReview });
        reviewStep.activity.reviewProgress.current = mediaIndex + 1;
        reviewStep.activity.reviewProgress.items[mediaIndex] = { file: item.name, status: persistedReview.reviewUnavailable ? "attention" : "completed", score: Number(persistedReview.score || 0), pass: persistedReview.pass === true, note: persistedReview.summary || "" };
        reviewStep.activity.updatedAt = v626Now();
        await v626SaveRun(run, false, false);
        if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
      }
      results.sort((a, b) => (+b.review.score || 0) - (+a.review.score || 0));
      const picked = results.find((item) => item.review.pass) || results[0];
      const reviewUnavailable = results.length > 0 && results.every((item) => item.review?.reviewUnavailable);
      const correction = picked?.review?.pass || reviewUnavailable ? "" : v663EntityReviewCorrection(picked?.review, list);
      await v626CompleteStep(run, reviewKey, { kind: "entity-review", label: `${state.name || "State"} review`, stateId, pass: !!picked?.review?.pass, score: Math.round(+picked?.review?.score || 0), winner: picked?.file || "", files: media.map((item) => item.name), review: { contractVersion: ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION, candidates: results }, revision: correction || (reviewUnavailable ? "" : "Preserve the parent identity more strictly and apply only the requested state delta."), result: { rationale: picked?.review?.summary || "", hardGateFailures: picked?.review?.hardGateFailures || [], autoApprove: picked?.review?.autoApprove === true, explicitPass: picked?.review?.explicitPass === true, explicitScore: picked?.review?.explicitScore === true, reviewUnavailable, threshold: V627_AUTOMATION_AUTO_APPROVE_SCORE } });
      if (reviewUnavailable) await v627PauseForHumanReview(run, v626Step(run, reviewKey), `Review ${state.name || "state"} candidates`);
    }
    const reviewed = v626Step(run, reviewKey);
    if (reviewed.pass && reviewed.winner && reviewed.result?.autoApprove) {
      await v628RequireAutomationLease(run);
      v626ApproveEntity(list, entityId, stateId, reviewed.winner);
      const approvalKey = `entity:${stateId}:approval`;
      v628AttachEntityAutomationProvenance(run, list, entityId, stateId, reviewed.winner, approvalKey, { score: reviewed.score });
      await flushPendingProjectSave();
      await v626CompleteStep(run, approvalKey, { kind: "entity-approval", label: `${state.name || "State"} approved`, stateId, winner: reviewed.winner, score: reviewed.score, pass: true, result: { rationale: reviewed.result?.rationale || "Best passing state candidate" } });
      await v626Log(run, `${state.name || "State"} approved: ${reviewed.winner} (${Math.round(Number(reviewed.score || 0))}/100).`, "success");
      return reviewed.winner;
    }
    if ((reviewed.pass && reviewed.winner) || round >= Number(run.config.stateRounds || 2)) await v627PauseForHumanReview(run, reviewed, `Approve ${state.name || "state"}`);
    await v626Log(run, `${state.name || "State"} round ${round} did not pass. ${reviewed.revision || "Revising the state delta prompt."}`, "warn");
  }
  throw new Error(`${state.name || "State"} did not pass after ${Number(run.config.stateRounds || 3)} rounds`);
}
async function runEntityAutomation(runId) {
  if (V626_ACTIVE_AUTOMATION_RUNS.has(runId)) return;
  let run;
  try { run = await v627AcquireAutomationLease(runId); }
  catch (error) { toast(error.code === "RUN_LEASED" ? "This run is already active in another CineBraid window" : error.message); return; }
  try {
    const { list, id, entity } = v626EntityTarget(run); if (!entity) throw new Error("Entity no longer exists");
    const stateIds = v626StateOrder(entity, run.config?.stateIds || []);
    for (const stateId of stateIds) {
      await v626CheckCancelled(run);
      const currentEntity = P[list]?.find((item) => item.id === id), state = entityStateById(currentEntity, stateId);
      await v626SetStage(run, state?.name || stateId, "entity-state", `Building the approved ${currentEntity.name || id} continuity chain.`);
      await v626AutomateEntityState(run, list, id, stateId);
    }
    await v626FinishRun(run, "completed", `${stateIds.length} continuity state${stateIds.length === 1 ? "" : "s"} processed parent-first. Approved references are ready for shot use.`);
    toast("Continuity-state automation completed");
  } catch (error) {
    if (error?.reviewRequired) { toast("State automation paused for your approval"); }
    else {
      const interrupted = error?.cancelled || error?.leaseLost || error?.pollDeferred || v626RunCancelled(run);
      if (!interrupted && run.current?.stepKey) await v626FailStep(run, run.current.stepKey, error);
      const summary = error?.leaseLost
        ? "Automation lease was lost. Progress is preserved; choose Resume Run before continuing."
        : error?.pollDeferred
          ? "Provider job is still active. Progress and the accepted job ID are preserved; Resume Run later to check it again without resubmitting."
          : interrupted
            ? "Run stopped safely. Resume later without repeating completed generation."
            : `${error.message || "Automation stopped"} Use Retry Failed Step to retry only the failed operation.`;
      await v628FinishRunAfterError(run, interrupted ? "interrupted" : "failed", summary, error);
      toast(interrupted ? (error?.pollDeferred ? "Provider is still working — resume later" : error?.leaseLost ? "Lease lost — Resume Run required" : "Automation stopped safely") : `State automation stopped: ${error.message}`);
    }
  } finally { await v627ReleaseAutomationLease(run); route(); }
}

window.resumeAutomationRun = async (runId) => {
  const run = await v626RefreshRun(runId, false);
  if (run.status === "failed") return toast("Use Retry Failed Step so only the failed operation is reset.");
  v640RunDispatch(run);
};
window.retryFailedAutomationStep = async (runId, stepKey = "") => {
  let run = await v626RefreshRun(runId, false).catch(() => null);
  const failedStep = run?.steps?.[stepKey || run?.current?.stepKey || ""] || Object.values(run?.steps || {}).find((step) => step.status === "failed") || null;
  try {
    if (run?.type === "scene-chain" && typeof v643RepairSceneCorrectionRun === "function" && (failedStep?.kind === "generation" || String(failedStep?.key || "").includes("scene-correction"))) {
      run = await v643RepairSceneCorrectionRun(run, failedStep);
      toast("Correction package checked and repaired before retry.");
    }
  } catch (error) {
    return toast(`Could not repair the correction package: ${error.message}`);
  }
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(runId)}/retry-step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepKey: failedStep?.key || stepKey }) });
  const data = await response.json(); if (!response.ok) return toast(data.error || "Could not reset failed step");
  v626ReplaceRun(data.run); route();
  v640RunDispatch(data.run);
};
window.pauseAutomationRun = async (type, targetId, scope = "main") => {
  const run = v626LatestRun(type, targetId, scope); if (!run) return;
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST" });
  const data = await response.json(); if (response.ok) v626ReplaceRun(data.run);
  route(); toast("The run will stop at the next safe boundary");
};
window.cancelAutomationRun = window.pauseAutomationRun;
window.cancelAutomationProviderJob = async (runId) => {
  const run = await v626RefreshRun(runId, false), current = run.steps?.[run.current?.stepKey || ""];
  if (!current?.childJobId) return toast("No active provider job is attached to this step");
  const response = await fetch(`/api/generation/fal/jobs/${encodeURIComponent(current.childJobId)}/cancel`, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  toast(response.ok ? "Provider cancellation requested" : data.error || "Could not cancel provider job");
};
window.archiveAutomationRun = async (runId) => {
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(runId)}/archive`, { method: "POST" });
  const data = await response.json(); if (!response.ok) return toast(data.error || "Could not archive run");
  v626ReplaceRun(data.run); route();
};
window.startFreshAutomationRun = async (runId, type, targetId) => {
  const previous = await v626RefreshRun(runId, false).catch(() => null);
  await archiveAutomationRun(runId);
  if (type === "shot-chain") return previous?.scope === "blocking-only" || previous?.config?.blockingOnly ? openBlockingAutomationModal(targetId) : openShotAutomationModal(targetId);
  if (type === "scene-chain" && typeof openSceneAutomationModal === "function") return openSceneAutomationModal(targetId);
  const list = previous?.config?.list || previous?.entityList || String(targetId || "").split(":")[0];
  const id = previous?.config?.entityId || previous?.entityId || String(targetId || "").split(":")[1];
  const scope = previous?.scope || previous?.config?.scope || "state-chain";
  if (scope === "default-only") return openAssetAutomationModal(list, id);
  if (scope.startsWith("state:")) return openEntityStateAutomationModal(list, id, scope.slice(6));
  return openEntityChainAutomationModal(list, id);
};
window.continueAutomationRevision = async (runId) => {
  const run = await v626RefreshRun(runId, false), step = v627AwaitingReviewStep(run);
  if (!step) return toast("No review gate is waiting");
  step.status = "completed";
  step.pass = false;
  run.status = "interrupted";
  run.summary = "Human review requested the next bounded revision round.";
  const saved = await v626SaveRun(run, false);
  v640RunDispatch(saved);
};
window.approveAutomationCandidate = async (runId, stepKey, fileName) => {
  const run = await v626RefreshRun(runId, false), step = run.steps?.[stepKey];
  if (!step || step.status !== "needs-review") return toast("This review gate is no longer active");
  const candidates = v627ReviewCandidates(run, step), candidate = candidates.find((item) => item.file === fileName);
  if (!candidate) return toast("Candidate is unavailable");
  if (run.type === "shot-chain" || run.type === "scene-chain") {
    const shotId = run.type === "scene-chain" ? (step.shotId || step.result?.targetShotId || "") : run.targetId;
    if (!shotId) return toast("Correction shot is unavailable");
    v626ApproveFrame(shotId, step.frameId, fileName);
    const frame = frameById(shotById(shotId), step.frameId);
    const approvalKey = run.type === "scene-chain" ? `scene-correction:${shotId}:${step.frameId}:approval` : `frame:${step.frameId}:approval`;
    run.steps[approvalKey] = { key: approvalKey, kind: "frame-approval", label: `Frame ${frame?.label || step.frameId} approved by director`, status: "completed", shotId, frameId: step.frameId, winner: fileName, score: candidate.score, pass: true, result: { humanApproved: true, targetShotId: shotId, rationale: candidate.note || "Director-selected candidate" }, completedAt: v626Now(), updatedAt: v626Now() };
    v628AttachShotAutomationProvenance(run, step.frameId, fileName, approvalKey, { shotId, score: candidate.score, humanApproved: true });
  } else {
    const list = run.config?.list || run.entityList, entityId = run.config?.entityId || run.entityId;
    v626ApproveEntity(list, entityId, step.stateId, fileName);
    const entity = P[list]?.find((item) => item.id === entityId), state = entityStateById(entity, step.stateId);
    const approvalKey = `entity:${step.stateId}:approval`;
    run.steps[approvalKey] = { key: approvalKey, kind: "entity-approval", label: `${state?.name || "State"} approved by director`, status: "completed", stateId: step.stateId, winner: fileName, score: candidate.score, pass: true, result: { humanApproved: true, rationale: candidate.note || "Director-selected candidate" }, completedAt: v626Now(), updatedAt: v626Now() };
    v628AttachEntityAutomationProvenance(run, list, entityId, step.stateId, fileName, approvalKey, { score: candidate.score, humanApproved: true });
  }
  await flushPendingProjectSave();
  Object.assign(step, { status: "completed", pass: true, winner: fileName, score: candidate.score, completedAt: v626Now(), updatedAt: v626Now(), result: { ...(step.result || {}), humanApproved: true, autoApprove: false, rationale: candidate.note || step.result?.rationale || "Director-selected candidate" } });
  run.logs = [...(run.logs || []), { at: v626Now(), tone: "success", message: `Director approved ${fileName}.` }];
  run.status = "interrupted"; run.cancelRequested = false; run.summary = `${fileName} was approved by the director. Continuing from the next unfinished step.`;
  const saved = await v626SaveRun(run, false);
  v640RunDispatch(saved);
};
window.copyAutomationDebugReport = async (runId) => {
  const run = await v626RefreshRun(runId, false), text = JSON.stringify(run, null, 2);
  try { await navigator.clipboard.writeText(text); toast("Automation debug report copied"); }
  catch { openModal(`<h3>Automation debug report</h3><textarea class="automation-debug-text" readonly>${esc(text)}</textarea><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`); }
};
window.downloadAutomationRunReport = async (runId) => {
  const run = await v626RefreshRun(runId, false), blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `${run.id}-report.json`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.downloadAutomationDiagnosticBundle = (runId) => {
  const link = document.createElement("a");
  link.href = `/api/automation/runs/${encodeURIComponent(runId)}/diagnostic.zip`;
  link.download = `${runId}-diagnostic.zip`;
  document.body.appendChild(link); link.click(); link.remove();
};
window.copyAutomationSupportSummary = async (runId) => {
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(runId)}/support-summary`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return toast(data.error || "Could not build support summary");
  try { await navigator.clipboard.writeText(data.summary || ""); toast("Support summary copied"); }
  catch { openModal(`<h3>Support summary</h3><textarea class="automation-debug-text" readonly>${esc(data.summary || "")}</textarea><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`); }
};
window.flagAutomationRunInefficient = (runId) => {
  openModal(`<div class="automation-feedback-modal"><h3>Flag this run as inefficient</h3><p>Describe what seemed wasteful: repeated review feedback, unnecessary passes, weak first-round prompting, wrong references, or anything else useful for improving CineBraid.</p><textarea id="automation-efficiency-note" placeholder="Example: It took three passes because the approved prop reference was not prioritized until round three."></textarea><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="saveAutomationEfficiencyFeedback('${attr(runId)}')">Save feedback</button></div></div>`);
};
window.saveAutomationEfficiencyFeedback = async (runId) => {
  const note = document.getElementById("automation-efficiency-note")?.value || "";
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(runId)}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inefficient: true, note }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return toast(data.error || "Could not save run feedback");
  v626ReplaceRun(data.run); closeModal(); route(); toast("Run feedback saved and included in future diagnostic bundles.");
};
window.openAutomationMotionHandoff = (shotId) => {
  const shot = shotById(shotId); keepGuidedPanelOpen(shot, "motion"); route();
  setTimeout(() => document.querySelector('[data-guided-panel="motion"]')?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 80);
};

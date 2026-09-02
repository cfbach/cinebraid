/* CineBraid v6.6.4-studio.4 — manual, stage, full-shot, and scene still automation with blocking review, budgets, continuity review, and bounded correction loops. Motion generation remains manual. */
const V626_ACTIVE_AUTOMATION_RUNS = new Set();
/* THE STRONG-PASS THRESHOLD, and what it is now allowed to do.

   Dogfood #2 A1 / forensic F1. This constant used to be spelled
   V627_AUTOMATION_AUTO_APPROVE_SCORE, and a review that explicitly passed at or
   above it called v626ApproveFrame() and RETURNED — writing frame.winner,
   shot.winner, the approval identity and the approved candidate disposition, and
   skipping the human gate entirely. The record kept `approval: "automatic"`, but
   the authority edge it wrote was the same one a director writes.

   The number is unchanged and the setting still exists, because "which score is
   strong enough to stop spending money and ask a person" is a real and useful
   decision. What it may DO is what changed: it now decides whether the run
   RECOMMENDS a candidate and parks, never whether it approves one. The name says
   so, so the next reader cannot mistake the threshold for a permission. */
const V627_AUTOMATION_RECOMMENDATION_SCORE = 85;
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
/* v667 — the run's chosen quality has to survive every pass, not just the first.
   A blind spread let a stored key whose value is undefined overwrite the
   default with undefined; the request then omitted `quality` entirely and the
   provider default silently decided what the director was paying for. Re-run
   the same validation over the merged result so a resolved setting is always a
   real tier. */
function v6211RunGenerationSettings(run) {
  const merged = { ...v6211AutomationGenerationSettings(), ...(run?.config?.generationSettings || {}) };
  const defaults = v6211AutomationGenerationSettings();
  const quality = (value, fallback) => ["low", "medium", "high"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : fallback;
  const resolution = (value, fallback) => ["1k", "2k", "4k"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : fallback;
  return {
    ...merged,
    blockingQuality: quality(merged.blockingQuality, defaults.blockingQuality),
    blockingResolution: resolution(merged.blockingResolution, defaults.blockingResolution),
    frameQuality: quality(merged.frameQuality, defaults.frameQuality),
    frameResolution: resolution(merged.frameResolution, defaults.frameResolution),
  };
}
/* The last gate before money moves. Every automation FAL request passes through
   v626WaitFalJob, so an explicit, valid quality is asserted exactly once, here,
   and a missing one fails closed instead of inheriting a provider default. */
const V667_FAL_QUALITY_TIERS = ["low", "medium", "high", "auto"];
function v667AssertRequestQuality(body, run) {
  const quality = String(body?.quality || "").toLowerCase();
  if (!V667_FAL_QUALITY_TIERS.includes(quality)) {
    throw new Error(`Generation quality is missing or invalid ("${body?.quality ?? ""}"). No paid request was submitted. Set the quality on this run before generating.`);
  }
  const required = String(run?.config?.requiredQuality || "").toLowerCase();
  if (required && quality !== required) {
    throw new Error(`This run is pinned to ${required} quality but the request asked for ${quality}. No paid request was submitted.`);
  }
  return quality;
}
function v640OutputsPerRequest(run) {
  return Math.max(1, Math.min(4, Math.round(Number(run?.config?.outputsPerRequest || 3))));
}
/* v668 — how many rounds this run can actually afford. stateRounds is the
   configured ceiling, but a round it cannot pay for is not a round: building and
   dispatching it only to have the credit guard refuse turns ordinary configured
   exhaustion into a failed generation step. Bounding the loop here lets the
   run end through its own exhaustion path with the reason named. The credit
   guard is unchanged and still refuses anything that reaches it. */
function v668EffectiveStateRounds(run) {
  const configured = Math.max(1, Number(run?.config?.stateRounds || 2));
  const maxImages = Number(run?.config?.maxImages);
  if (!Number.isFinite(maxImages) || maxImages <= 0) return configured;
  const affordable = Math.floor(maxImages / v640OutputsPerRequest(run));
  return Math.max(1, Math.min(configured, affordable));
}
/* The stored config key keeps its old spelling on purpose: renaming it would
   orphan the setting on every run already on disk and in every saved scene
   plan. The newer spelling is accepted first so a future writer can migrate
   without a second reader appearing. */
function v640RecommendationScore(run) {
  const configured = Number(run?.config?.recommendationScore ?? run?.config?.autoApproveScore ?? V627_AUTOMATION_RECOMMENDATION_SCORE);
  return Math.max(50, Math.min(100, Math.round(configured || V627_AUTOMATION_RECOMMENDATION_SCORE)));
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

/* THE PLANNER'S CONTROLS, tiered by the same rule as every other generation surface.
 *
 * A planner has two scopes of the same two controls — blocking and frame each have a
 * quality and a resolution — so the vocabulary maps onto the KIND rather than onto the
 * instance: quality is a production decision in both scopes, resolution is a machine
 * setting in both. What a word means must not change with which dialog is showing.
 *
 * A control the active view does not render is simply absent, and v6211SyncGenerationControls()
 * falls back to the saved setting for anything absent — so a Simple plan runs at the
 * defaults chosen in Settings rather than at whatever was last typed under Advanced. */
function v6211GenerationControlsMarkup(settings, scope, options = {}) {
  const includeBlocking = options.includeBlocking !== false;
  const includeFrame = options.includeFrame !== false;
  const includeOutputs = options.includeOutputs !== false;
  const outputs = Math.max(1, Math.min(4, Number(options.outputs || 3)));
  const plan = options.plan || falFixedImageControlPlan(generationViewMode(options.mode || generationViewPreference()), {});
  const rendered = new Set(plan.rendered || []);
  const qualityOptions = (selected) => ["low","medium","high"].map((value) => `<option value="${value}" ${value===selected?"selected":""}>${value[0].toUpperCase()+value.slice(1)}</option>`).join("");
  const resolutionOptions = (selected) => ["1k","2k","4k"].map((value) => `<option value="${value}" ${value===selected?"selected":""}>${value.toUpperCase()}</option>`).join("");
  const rows = [];
  if (includeOutputs && rendered.has("outputCount")) rows.push(`<label><span>Images per pass</span><select id="${attr(scope)}-auto-outputs" onchange="v6211SyncGenerationControls('${attr(scope)}')">${[1,2,3,4].map((n)=>`<option value="${n}" ${n===outputs?"selected":""}>${n}</option>`).join("")}</select></label>`);
  if (includeBlocking && rendered.has("quality"))
    rows.push(`<label><span>Blocking quality</span><select id="${attr(scope)}-auto-blocking-quality" onchange="v6211SyncGenerationControls('${attr(scope)}')">${qualityOptions(settings.blockingQuality || "low")}</select></label>`);
  if (includeBlocking && rendered.has("resolution"))
    rows.push(`<label><span>Blocking resolution</span><select id="${attr(scope)}-auto-blocking-resolution" onchange="v6211SyncGenerationControls('${attr(scope)}')">${resolutionOptions(settings.blockingResolution || "1k")}</select></label>`);
  if (includeFrame && rendered.has("quality"))
    rows.push(`<label><span>Frame / reference quality</span><select id="${attr(scope)}-auto-frame-quality" onchange="v6211SyncGenerationControls('${attr(scope)}')">${qualityOptions(settings.frameQuality || "high")}</select></label>`);
  if (includeFrame && rendered.has("resolution"))
    rows.push(`<label><span>Frame / reference resolution</span><select id="${attr(scope)}-auto-frame-resolution" onchange="v6211SyncGenerationControls('${attr(scope)}')">${resolutionOptions(settings.frameResolution || "1k")}</select></label>`);
  return rows.length ? `<section class="automation-generation-controls"><div>${rows.join("")}</div></section>` : "";
}

/* WHAT EACH OPEN PLANNER IS CURRENTLY SHOWING, so a redraw triggered by the Simple/
   Advanced switch and a redraw triggered by changing the round count both produce the
   same panel. Keyed by scope because a planner is identified by its scope everywhere
   else in this file. */
window._v6211GenerationViewState = {};
function v6211DrawGenerationView(scope, options) {
  const state = { ...(window._v6211GenerationViewState[scope] || {}), ...(options || {}) };
  window._v6211GenerationViewState[scope] = state;
  const host = document.getElementById(`${scope}-generation-view`);
  if (!host) return;
  const draft = v6211DraftForScope(scope);
  const settings = (draft && draft.generationSettings) || v6211AutomationGenerationSettings();
  host.innerHTML = v6211GenerationViewMarkup(settings, scope, state);
}
/* Registered when a planner opens. The switch redraws THIS planner and nothing else. */
function v6211RegisterGenerationView(scope, options) {
  window._v6211GenerationViewState[scope] = { ...(options || {}) };
  window._generationViewRefresh = (mode) => v6211DrawGenerationView(scope, { mode });
  setTimeout(() => v6211DrawGenerationView(scope, {}), 0);
}

/* The planner's shared Simple/Advanced block. Same shell, same words and the same one
   rate as the frame, entity and motion dialogs — a planner that priced work differently
   from the dialog that dispatches the same work would be the original defect in a
   different room. */
function v6211GenerationViewMarkup(settings, scope, options = {}) {
  const view = generationViewMode(options.mode || generationViewPreference());
  const plan = falFixedImageControlPlan(view, {});
  return generationViewMarkup({
    mode: view,
    plan,
    /* A planner resolves no picker, so it names no model — the fixed fal image route is
       what it dispatches to and that is what the shell reports. */
    option: typeof falFixedImageRoute === "function" ? falFixedImageRoute() : null,
    recommendation: generationRecommendation({ guide: null, options: [] }),
    rate: configuredImageRate(typeof CONFIG === "object" ? CONFIG : {}),
    /* The WORST CASE this plan can reach, which is the number a filmmaker needs before
       starting an unattended run — not the number it will probably cost. */
    quantity: Math.max(0, Number(options.maxImages || 0)),
    limits: options.limits || null,
    controlsMarkup: v6211GenerationControlsMarkup(settings, scope, { ...options, plan }),
  });
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
/* WHAT THE FILMMAKER AUTHORISED IN MONEY, recorded beside what they authorised in
   images, at the moment they authorise it.
 *
 * `maxImages` has been the run's ceiling and the server has enforced it since the credit
 * guard landed. A count is not a budget: the same nine images cost one thing at $0.02
 * and another at $0.20, and the number the planner actually put in front of the person
 * pressing the button was the DOLLAR figure - the shared shell has quoted
 * maxImages x the configured rate there for a while now.
 *
 * So the figure they were shown is the figure that gets recorded, from the SAME owner
 * that drew it. Not a second multiplication: costEstimateFromRate() is the one place
 * this arithmetic happens, here and in the price line and in submissionAccounting().
 *
 * Recorded at CREATION and never recomputed. Editing the rate in Settings tomorrow
 * changes what tomorrow's run is authorised to spend and changes nothing about this one,
 * for the same reason a job keeps the estimate it was submitted with. An unconfigured
 * rate records an honest `priced: false` and the server then has no spend ceiling to
 * enforce - it still has the image cap, and claiming a dollar ceiling nobody quoted
 * would be worse than having none. */
function v626AuthorizedSpend(config) {
  const maxImages = Math.max(0, Number(config?.maxImages || 0));
  const derived = costEstimateFromRate({
    rate: configuredImageRate(typeof CONFIG === "object" ? CONFIG : {}),
    quantity: maxImages,
  });
  return {
    priced: derived.priced,
    amount: derived.priced ? derived.estimate.amount : null,
    quantity: maxImages,
    unitBasis: derived.basis.unitBasis,
    ratePerUnit: derived.basis.ratePerUnit,
    rateSource: derived.basis.rateSource,
    ...(derived.priced ? {} : { unpricedReason: derived.basis.unpricedReason || "no-configured-rate" }),
  };
}

function v626NewRun(type, targetId, scope, label, mode, config = {}) {
  return {
    schemaVersion: 2,
    revision: 1,
    id: `automation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type, targetId, scope: scope || "main", label, mode,
    status: "running", stage: "Starting", phase: "preflight", summary: "",
    current: {}, config: { ...config, maxSpend: v626AuthorizedSpend(config) }, result: {}, usage: { imageRequests: 0, imagesGenerated: 0, assistantCalls: 0, reviewCalls: 0 },
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

async function v6211RevalidatePaidStepLease(run, step, scope, stepKey) {
  if (!run?.id) throw Object.assign(new Error("Automation run is unavailable."), { code: "LEASE_LOST", leaseLost: true });
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(run.id)}/lease/revalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    /* THE SCOPE OF THE REQUEST THIS CALL IS BEING MADE FOR. It narrows what the permit
       the server is about to mint may buy; it cannot choose the permit's class, its run,
       its step or its ceiling, all of which the server establishes from the run record it
       has just validated. */
    /* THE DURABLE OPERATION KEY, not the plain step key. A retry is a different paid
       attempt with its own idempotency key, and the permit has to name the same one the
       generation POST will carry or the boundary would rewrite a retry back onto the
       original step and collide with the job that step already has. */
    body: JSON.stringify({ runnerId: V627_AUTOMATION_RUNNER_ID, stepKey: stepKey || step?.key || "", paidScope: scope || {} }),
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
  /* The permit travels back beside the run, because this call is the only server touch a
     paid automation step makes before it dispatches, and the run it just proved is the
     authorization the permit names. */
  return { run: data.run || run, paidPermitId: data.paidPermitId || "" };
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
/* WHOSE FAULT WAS THIS, and therefore whether retrying can possibly help.

   `local-package` is a deterministic fault in what CineBraid assembled, or in
   the project state it assembled from: the same inputs produce the same
   exception every time, so a retry spends an attempt to reproduce it. Dogfood #2
   A5 is the case — a boundary correction package dereferenced a neighbour that
   does not exist, and automatic retry could never have repaired the input.

   Everything else stays `provider`, which is what the retry path was built for.

   BATCH 1B: a deterministic LOCAL PREFLIGHT refusal is added to the local class.
   The frame-presence gate and the frame-identity gate both refuse before any
   provider is contacted and before a paid job row exists, so nothing was spent
   and nothing about the provider changed — reconstructing the same request will
   reproduce the same refusal exactly. Classifying it `provider` (which is what
   an unrecognised error defaulted to) both misnames the fault and spends an
   attempt from a budget the director authorised for real generation. */
const V6_LOCAL_PREFLIGHT_CODES = ["FRAME_PRESENCE_CONTRADICTION", "FRAME_PRESENCE_TARGET_UNRESOLVED"];
function v626FailureClass(error) {
  if (error?.localPackageError === true || error?.failureClass === "local-package") return "local-package";
  if (error?.authorityViolation === true || error?.code === "HUMAN_AUTHORITY_REQUIRED") return "local-package";
  if (error?.localPreflightError === true || error?.classification === "local-preflight") return "local-preflight";
  if (V6_LOCAL_PREFLIGHT_CODES.includes(String(error?.code || ""))) return "local-preflight";
  /* THE PROPERTY, RATHER THAN A LIST OF THE CODES THAT HAPPEN TO HAVE IT.
   *
   * The two codes above were the only pre-provider refusals the boundary emitted when this
   * was written. It emits nine now — package staleness, model and option identity, surface
   * mismatch, aspect authority, the spend guards — and every one of them states
   * `providerContacted: false` on the wire. Enumerating codes meant each new refusal
   * silently inherited the `provider` default: misnamed as a provider fault, written to the
   * durable run as `providerContacted: true`, and — because the retry gate reads
   * failureClass — spending an attempt from a budget authorised for real generation, on a
   * request that reached no provider. Asking the fact directly is what stops the next one
   * inheriting it too. */
  if (error?.providerContacted === false) return "local-preflight";
  return "provider";
}
/* The two local classes share one property that matters operationally: a retry
   reconstructs the same input and reaches the same refusal, so the attempt
   counter must not advance and no provider budget may be charged. */
function v626IsDeterministicLocalFailure(error) {
  return ["local-package", "local-preflight"].includes(v626FailureClass(error));
}
async function v626FailStep(run, key, error) {
  const step = v626Step(run, key);
  step.status = "failed";
  step.error = String(error?.message || error || "Automation step failed");
  step.failureClass = v626FailureClass(error);
  step.remediation = String(error?.remediation || "");
  /* Recorded once, here, so no surface has to re-derive the union of the two
     local classes to answer "can retrying this possibly help". */
  const deterministic = v626IsDeterministicLocalFailure(error);
  step.activity = { ...(step.activity || {}), state: "failed", failureClass: step.failureClass, deterministic, providerContacted: !deterministic, detail: [step.error, step.remediation].filter(Boolean).join(" "), updatedAt: v626Now() };
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
/* ONE RATE READER for the whole application. This used to reach into CONFIG itself,
   which meant the automation planner, the motion dialog and the ledger were three
   readers of two different numbers. */
function v628EstimatedCostPerImage() {
  const rate = configuredImageRate(typeof CONFIG === "object" ? CONFIG : {});
  return rate.configured ? Number(rate.amount) : 0;
}
function v628Usd(value) {
  return formatRateUsd(value);
}
/* v628CostEstimateText() USED TO LIVE HERE and has been deleted rather than kept.
 *
 * It appended " · estimated worst case $X at $Y per image" to five different planner
 * sentences, and returned an EMPTY STRING when no rate was configured — which silently
 * removed the cost line from a paid automation planner altogether. Both problems are
 * answered by the shared price block the planners now render: one statement per screen,
 * from the one configured rate, and an unconfigured rate says so instead of vanishing.
 *
 * Deleted rather than left unused because a dormant second cost renderer is one a future
 * caller finds; check:behavior enforces that rule and caught this on the first run. */
function v626RunUsageMarkup(run) {
  const usage = run?.usage || {};
  const max = Number(run?.config?.maxImages || 0);
  const rate = v628EstimatedCostPerImage();
  /* A LIVE PROJECTION AT TODAY'S RATE, and worded so it cannot be mistaken for the
     historical record. This multiplies the CURRENT Settings rate by the run's image
     count, so it moves when that setting moves. For a run in progress that is the
     useful question — "what is this about to cost me" — and for history it is exactly
     the defect that was fixed elsewhere: the recorded figure is the estimate each job
     stored at submission, it lives in Reports, and it does not move. Two different
     numbers answering two different questions, so they must not share a word. */
  const estimate = rate ? `<span title="Projected from the current Settings rate — not the estimate recorded when each job was submitted. Reports shows the recorded figure."><b>${v628Usd(Number(usage.imagesGenerated || 0) * rate)}</b>${max ? ` / ${v628Usd(max * rate)}` : ""} projected at today's rate</span>` : "";
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
/* ==========================================================================
   APPROVAL REQUIRES SOMETHING TO LOOK AT.

   The founder smoke found a candidate reading 90/100 · APPROVE SUGGESTED whose
   thumbnail was blank: the markup rendered a placeholder reading "IMAGE" when
   v627CandidateUrl() came back empty, and rendered the approve button anyway. A
   human approval is a statement that a person INSPECTED these bytes and accepts
   them as production truth. Media the page cannot resolve was never inspected, so
   that statement cannot honestly be made.

   REVIEW SUCCESS AND DISPLAY SUCCESS ARE DIFFERENT FACTS, and both are kept. The
   AI score, the pass flag and the note stay exactly as they are — the review did
   run, and discarding its result because a file went missing would throw away
   real work. What is withdrawn is the OFFER to approve, and the candidate stays
   in the gate with a recovery action rather than disappearing from it.

   The refusal lives in the command as well as the markup, so a surface that
   regresses cannot mint an approval this rule exists to prevent — the same
   reason the ownership veto sits in the kernel and not in its callers. */
function v670CandidateInspectable(run, step, file) {
  return !!v627CandidateUrl(run, step, file);
}
function v670UnresolvedCandidateMarkup(file) {
  return `<div class="automation-review-unavailable" data-candidate-unresolved="${attr(file)}"><b>Image unavailable</b><span>CineBraid cannot resolve ${esc(file)} in this project's media, so it cannot be shown for inspection. It has not been discarded, and its review result is kept.</span><button class="ghost-btn" onclick="document.getElementById('rescan')?.click()">SYNC LOCAL FOLDERS &amp; RETRY</button></div>`;
}
/* ==========================================================================
   THE CORRECTION VERDICT, RENDERED AND NEVER DERIVED.

   `winner` means "highest score among this pass's own candidates". For a
   continuity correction that is not the question — the question is whether it beat
   the frame the filmmaker already approved — so a correction step carries a verdict
   per candidate, computed by shared-continuity.js against a baseline score for the
   approved original. This file looks the verdict up and prints its words.

   A step with no verdicts is any other kind of review (an entity or frame gate) and
   behaves exactly as before. */
function v670CorrectionVerdictFor(step, file) {
  const verdicts = step?.result?.correctionVerdicts;
  return verdicts && verdicts[file] ? verdicts[file] : null;
}
/* SUGGESTED IS A RECOMMENDATION, SO IT NEEDS ONE. A correction candidate is only
   the suggestion if the run recommended it AND it is a demonstrated improvement.
   The founder smoke approved-suggested a frame that failed continuity and was worse
   than the original, because this was `file === step.winner` and nothing else. */
function v670CandidateIsSuggested(step, candidate) {
  if (candidate.file !== step.winner) return false;
  const verdict = v670CorrectionVerdictFor(step, candidate.file);
  if (!verdict) return true;
  return step.result?.recommend === true && recommendableCorrection(verdict);
}
function v670CorrectionVerdictMarkup(step, file) {
  const verdict = v670CorrectionVerdictFor(step, file);
  if (!verdict) return "";
  const label = CORRECTION_OUTCOME_LABELS[verdict.outcome] || String(verdict.outcome || "").toUpperCase();
  return `<div class="correction-verdict tone-${attr(verdict.outcome)}" data-correction-outcome="${attr(verdict.outcome)}" data-correction-file="${attr(file)}"><b>${esc(label)}</b><span>${esc(describeCorrectionOutcome(verdict))}</span></div>`;
}
function v627HumanReviewMarkup(run) {
  const step = v627AwaitingReviewStep(run);
  if (!step) return "";
  const candidates = v627ReviewCandidates(run, step);
  /* Whether ANY candidate at this gate may honestly be called the fix. */
  const correctionGate = !!step.result?.correctionVerdicts;
  const anySuggested = candidates.some((candidate) => v670CandidateIsSuggested(step, candidate));
  /* Two separate facts: another pass is inside the confirmed pass count, AND the
     confirmed image cap still has room for it. Offering a continuation the credit
     guard would refuse is how a bounded run starts feeling unbounded. */
  const canNextRound = Number(step.attempt || 0) < Number(step.maxAttempts || 0);
  const remaining = v666RemainingImageBudget(run), perPass = v640OutputsPerRequest(run);
  const canSpendNextRound = canNextRound && remaining >= perPass;
  const continuation = canSpendNextRound
    ? `<button class="changes-btn" onclick="continueAutomationRevision('${run.id}')">IMPROVE PROMPT &amp; RUN NEXT PASS · ${perPass} MORE</button>`
    : `<button class="changes-btn" onclick="startFreshAutomationRun('${run.id}','${run.type}','${attr(run.targetId)}')">START A FRESH RUN</button>`;
  const budgetNote = canSpendNextRound
    ? `<small class="automation-review-budget">Pass ${Number(step.attempt || 0) + 1} of ${Number(step.maxAttempts || 0)} is already authorized · ${remaining} of ${Number(run.config?.maxImages || 0)} candidate generations remain.</small>`
    : `<small class="automation-review-budget">No further pass is authorized in this run. Starting more generation is a new decision.</small>`;
  /* If the best candidate of the run came from an earlier pass, the gate has to
     say so and offer it. Presenting only the newest pass is how a pass-3
     regression quietly buried the pass-2 image that scored higher. */
  const currentFiles = new Set(candidates.map((row) => String(row.file)));
  const champion = Object.values(run.result?.referenceChampions || {})
    .filter((row) => row && row.file && row.stepKey)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0] || null;
  const championElsewhere = champion && !currentFiles.has(String(champion.file));
  const championInspectable = champion && v670CandidateInspectable(run, run.steps?.[champion.stepKey] || step, champion.file);
  const championMarkup = championElsewhere
    ? `<div class="automation-review-champion"><div><span>BEST CANDIDATE OF THE WHOLE RUN</span><b>${esc(champion.file)} · ${Number(champion.score || 0)}/100</b><small>From pass ${Number(champion.passNumber || 1)}. A later pass scored lower; this one was kept${championInspectable ? " and is still approvable" : ""}.</small></div>${championInspectable ? `<button class="approve-btn" onclick="approveAutomationCandidate('${run.id}','${attr(champion.stepKey)}','${attr(champion.file)}')">APPROVE PASS ${Number(champion.passNumber || 1)} BEST</button>` : v670UnresolvedCandidateMarkup(champion.file)}</div>`
    : "";
  /* WHAT THE HEADER MAY CLAIM. On a correction gate with nothing recommendable,
     "N/100 suggested" is the lie the founder smoke read as an endorsement of a
     worse frame. It says what is actually true instead, and the approved original
     stays protected either way — approving a challenger is still the person's
     explicit act. */
  const headerNote = correctionGate && !anySuggested
    ? `<span class="automation-review-none">NO CANDIDATE IMPROVED ON THE APPROVED FRAME</span>`
    : `<span>${Math.round(Number(step.score || 0))}/100 suggested</span>`;
  const correctionIntro = correctionGate
    ? `<p class="automation-correction-intro">${step.result?.baseline?.available === false
      ? "The approved original could not be scored by the same reviewer, so none of these can be shown to be better than it. Your approved frame is unchanged."
      : `Each candidate is scored against the approved ${esc(step.result?.baseline?.file || "original")} (${Number(step.result?.baseline?.score ?? 0)}/100) on the same review. Your approved frame stays in place unless you approve a replacement.`}</p>`
    : "";
  return `<section class="automation-human-review"><header><div><span>HUMAN REVIEW GATE</span><b>${esc(step.label || "Candidate approval required")}</b><small>The assistant suggestion is not canon until you approve it. CineBraid never approves a reference on its own.</small></div>${headerNote}</header>${correctionIntro}${championMarkup}<div class="automation-review-grid">${candidates.map((candidate) => { const url = v627CandidateUrl(run, step, candidate.file); const suggested = v670CandidateIsSuggested(step, candidate); const verdict = v670CorrectionVerdictFor(step, candidate.file); return `<article class="${url && suggested ? "suggested" : ""}${url ? "" : " unresolved"}${verdict ? ` verdict-${attr(verdict.outcome)}` : ""}">${url ? `<img src="${attr(url)}" alt="${attr(candidate.file)}">` : `<div class="automation-review-placeholder">NO IMAGE</div>`}<div><b>${esc(candidate.file)}</b><small>${candidate.score}/100 · ${candidate.pass ? "assistant pass" : "flagged"}</small>${candidate.note ? `<p>${esc(candidate.note)}</p>` : ""}</div>${v670CorrectionVerdictMarkup(step, candidate.file)}${url ? `<button class="${suggested ? "approve-btn" : "ghost-btn"}" onclick="approveAutomationCandidate('${run.id}','${attr(step.key)}','${attr(candidate.file)}')">${suggested ? "APPROVE SUGGESTED" : verdict && verdict.outcome === "regression" ? "APPROVE ANYWAY" : "APPROVE THIS"}</button>` : v670UnresolvedCandidateMarkup(candidate.file)}</article>`; }).join("")}</div><footer>${continuation}<button class="ghost-btn" onclick="archiveAutomationRun('${run.id}')">STOP AND ARCHIVE</button>${budgetNote}</footer></section>`;
}
/* How many candidate generations the confirmed authorization still allows. The
   cap is run.config.maxImages and it is the same number v626WaitFalJob refuses
   to cross; reading it here keeps the offer and the guard in agreement. */
function v666RemainingImageBudget(run) {
  const max = Number(run?.config?.maxImages), used = Number(run?.usage?.imagesGenerated);
  if (!Number.isFinite(max) || !Number.isFinite(used)) return 0;
  return Math.max(0, max - used);
}
function v666PassCorrectionListMarkup(rows, kind) {
  const empty = kind === "preserve"
    ? "No criterion was confirmed clean across every candidate."
    : kind === "correct"
      ? "No generation-correctable fault was found in this pass."
      : "None.";
  if (!rows?.length) return `<p class="automation-pass-empty">${empty}</p>`;
  return `<ul class="automation-pass-${attr(kind)}">${rows.map((row) => `<li><b>${esc(row.label || "Finding")}</b>${row.note ? `<span>${esc(row.note)}</span>` : ""}${kind === "correct" && Number(row.candidateCount) ? `<em>seen on ${Number(row.candidateCount)} candidate${Number(row.candidateCount) === 1 ? "" : "s"}${row.onChampion ? " · including the best candidate so far" : ""}</em>` : ""}</li>`).join("")}</ul>`;
}
/* The audit trail a director can read: what each pass asked for, what came back,
   why it failed, and the exact correction carried into the next prompt. Results
   and production reasoning only — never the reviewer's internal deliberation. */
function v666ReferenceProgressionMarkup(run) {
  const passes = v666RunPasses(run);
  if (!passes.length) return "";
  const maxPasses = Math.max(...passes.map((row) => Number(row.maxPasses || row.passNumber || 1)));
  const used = Number(run.usage?.imagesGenerated || 0), cap = Number(run.config?.maxImages || 0);
  const exhaustion = run.result?.referenceExhaustion || null;
  const items = passes.map((pass) => {
    const delta = pass.promptDelta || {};
    const changed = (delta.added || []).filter(Boolean);
    /* Non-generative findings are shown, and shown apart: a director must be
       able to see that CineBraid noticed them AND that it did not pay to
       regenerate against them. */
    const blocked = (pass.prerequisites || []).length
      ? `<section><h5>Not a generation problem — never retried</h5>${v666PassCorrectionListMarkup(pass.prerequisites, "prerequisite")}</section>`
      : "";
    const decisions = (pass.decisions || []).length
      ? `<section><h5>Your decision</h5>${v666PassCorrectionListMarkup(pass.decisions, "decision")}</section>`
      : "";
    return `<li class="automation-pass ${pass.passed ? "passed" : "failed"}"><header><span>PASS ${Number(pass.passNumber)} OF ${maxPasses}</span><b>${Number(pass.candidates?.length || 0)} candidate${Number(pass.candidates?.length || 0) === 1 ? "" : "s"} · best ${Number(pass.bestScore || 0)}/100</b><small>${pass.passed ? "A candidate met the strong-pass rule; your approval is required." : pass.reviewUnavailable ? "AI review was unavailable for this pass." : "No candidate was approvable."}</small></header><div class="automation-pass-scores">${(pass.candidates || []).map((row) => `<span class="${row.pass ? "pass" : "flag"}"><b>${esc(row.file)}</b><em>${Number(row.score || 0)} · ${row.pass ? "PASS" : "FLAG"}</em></span>`).join("")}</div>${changed.length ? `<details class="automation-pass-delta"><summary>What changed from pass ${Number(pass.passNumber) - 1} <span>${changed.length}</span></summary><ul>${changed.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></details>` : ""}<details class="automation-pass-plan"><summary>Why it failed and what pass ${Number(pass.passNumber) + 1} was told to change</summary><div class="automation-pass-plan-body"><section><h5>Preserve — already correct</h5>${v666PassCorrectionListMarkup(pass.preserve, "preserve")}</section><section><h5>Correct — recurring reasons first</h5>${v666PassCorrectionListMarkup(pass.correct, "correct")}</section>${blocked}${decisions}</div></details><details class="automation-pass-prompt"><summary>Pass ${Number(pass.passNumber)} prompt</summary><pre>${esc(pass.prompt || "No prompt was recorded.")}</pre></details></li>`;
  }).join("");
  const exhaustionMarkup = exhaustion
    ? `<div class="automation-pass-exhaustion"><b>No candidate passed after ${Number(exhaustion.passes)} pass${Number(exhaustion.passes) === 1 ? "" : "es"} / ${Number(exhaustion.candidates)} candidate${Number(exhaustion.candidates) === 1 ? "" : "s"}.</b><small>Recurring issues: ${esc(exhaustion.recurring?.join(" · ") || "no structured findings were returned")}</small><span>Every candidate and every review above stays available. Generating more requires a new authorization.</span></div>`
    : "";
  /* The champion. A later pass that scores worse must never be mistaken for the
     run's best work simply because it came last. */
  const champions = Object.values(run.result?.referenceChampions || {}).filter((row) => row && row.file);
  const championMarkup = champions.length
    ? `<div class="automation-pass-champion"><b>Best across every pass</b>${champions.map((row) => `<span><em>${esc(row.stateName || "State")}</em><b>${esc(row.file)}</b><small>${Number(row.score || 0)}/100 · pass ${Number(row.passNumber || 1)}${Number(row.passNumber || 1) < passes.length ? " · a later pass scored lower and did not replace it" : ""}</small></span>`).join("")}</div>`
    : "";
  return `<section class="automation-pass-progression"><header><div><span>PASS PROGRESSION</span><b>${passes.length} of ${maxPasses} authorized pass${maxPasses === 1 ? "" : "es"} used${cap ? ` · ${used} of ${cap} candidates` : ""}</b><small>What CineBraid changed between passes, and the review evidence it changed it for.</small></div></header>${championMarkup}${exhaustionMarkup}<ol class="automation-pass-list">${items}</ol></section>`;
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
  /* A1 — THE TASK PAGE IS THE TASK.
     This block used to be a process console: an orchestration kicker, a status line
     and a summary that the compact status already says, an always-open persistence
     paragraph, and v626RunReportMarkup() — the full run report, on the creative
     surface. Starting AI help replaced the workspace with a dashboard, which is what
     the 2026-09-01 dogfood recorded.
     What stays is one compact current-run status and the run's own action set. The
     run report moves to Reports, which already owns deep evidence, and the
     persistence note keeps its MEANING behind a disclosure instead of a paragraph.
     v626RunActions is untouched and stays here: it is the only thing that holds this
     run's type/targetId/scope and its lease, and it is not duplicated anywhere. */
  const persistence = `<details class="automation-persistence-fold"><summary>What happens if I close this tab?</summary><p class="automation-persistence-note">Progress is saved to this project. Closing the tab pauses browser orchestration; reopen the same target and choose Resume Run.</p></details>`;
  const status = run
    ? (typeof v670CompactRunStatusMarkup === "function" ? v670CompactRunStatusMarkup(run) : "")
    : `<div class="automation-run-status"><b>${esc(v626StatusLabel(run))}</b><span>Ready to plan an automation run</span></div>`;
  return `<section class="creation-card automation-card durable-automation-card"><div class="creation-card-head"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div></div>${status}${extra}${persistence}<div class="creation-actions automation-actions">${v626RunActions(run, type, targetId, scope, startMarkup)}</div></section>`;
}


const V664_BLOCKING_REVIEW_THRESHOLD = 75;
function v664BlockingReviewKey(frameId = "") { return String(frameId || "opening"); }
function v664BlockingFileName(asset) { return String(asset?.file || asset?.originalName || asset?.storagePath || "").split(/[\\/]/).pop(); }
function v664BlockingReviewStore(shot) {
  const creation = ensureShotCreation(shot);
  creation.blockingAttemptReviews = creation.blockingAttemptReviews && typeof creation.blockingAttemptReviews === "object" ? creation.blockingAttemptReviews : {};
  return creation.blockingAttemptReviews;
}
/* THE PARTITION IS REAL, AND IT IS NOT A BUG - but it is not "everything with an empty
   string" either. An unassigned attempt is a candidate for the SHOT-WIDE opening guide,
   which is what useBlockingGuide() sets and what v664ReviewExistingBlockingForRun()
   promotes. An attempt bound to a frame is a candidate for that frame's endpoint guide
   only, set by useFrameBlockingGuide(). Reviewing the two pools together would let a
   Frame B endpoint image be recommended as the shot's opening composition, so they
   stay apart.

   What was wrong was never this function - it was that the shot-level console DISPLAYED
   every attempt, GATED itself on that full list, and then asked this reader for the
   unassigned pool alone. With every attempt bound to a frame the console rendered a
   REVIEW ALL WITH AI button over an empty set, and answered a click with "Add at least
   one blocking attempt first" while the attempts sat visible underneath it. The console
   is fixed where it is wrong, in guidedBlockingPanel. */
function v664BlockingRowsForReview(shot, frameId = "") {
  const target = String(frameId || "");
  return blockingMediaRows(shot).filter(({ link }) => target ? String(link.blockingFrameId || "") === target : !String(link.blockingFrameId || ""));
}
/* Every attempt on the shot, labelled with the pool it can be reviewed in. The console
   uses this to say what it is not reviewing rather than silently dropping it. */
window.blockingAttemptPools = (shot) => {
  const rows = blockingMediaRows(shot);
  const opening = rows.filter(({ link }) => !String(link.blockingFrameId || ""));
  const framed = new Map();
  for (const row of rows) {
    const frameId = String(row.link.blockingFrameId || "");
    if (!frameId) continue;
    if (!framed.has(frameId)) framed.set(frameId, []);
    framed.get(frameId).push(row);
  }
  return { rows, opening, framed };
};
window.blockingAttemptReviewFor = (shot, assetId, frameId = "") => {
  const store = v664BlockingReviewStore(shot);
  const scoped = frameId ? (store[v664BlockingReviewKey(frameId)] || {}).items?.[assetId] : null;
  /* A frame's own review first; otherwise the shot-level record, which is where an
     attempt reviewed before it was bound to a frame still lives. */
  return scoped || (store[v664BlockingReviewKey("")] || {}).items?.[assetId] || null;
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
/* WHAT STILL FRAMES THIS SHOT ACTUALLY OWES, AND WHETHER THAT WORK IS DONE.
   TWO DIFFERENT QUESTIONS, and this file used to answer neither.

   Every automation surface below derived its own frame requirement from

       frames.filter((frame) => frame.required !== false)

   which is not a requirement at all: newKeyframe() writes `required: true` on every
   frame of every project, normalizeShotV5() back-fills it onto any frame that lacks
   it, and NO filmmaker-facing control writes it. So automation carried a second,
   route-blind opinion about what a shot owes — and then reused it for the REQUIRED
   FRAMES card, the picker defaults, the run plan and the completion summary. A shot
   whose workspace correctly said "0/0 required" had a hub card reading "0/1 approved",
   a picker with Frame A preselected, and a run that would finish by announcing that
   its still package was ready.

   THE OBLIGATION HALF IS CONSUMED, NEVER DERIVED. `currentlyRequiredFrames()`
   (public/app.js) is the existing projection that maps the canonical readiness units
   onto this shot's own frame records; readiness in turn asks shotRouteInputNeeds()
   where a route is declared and the shot's other declarations where one is not. This
   adds no third opinion — it composes that answer with the route reading and the
   shipped approval reader, which is exactly what the automation surfaces need and
   none of them should compute twice.

   THE COMPLETION HALF IS SEPARATE, and collapsing it was the second defect.
   `approved === required.length` is true when BOTH are zero, so "owes nothing" and
   "has finished everything it owed" were the same boolean. They are four states:

     route-undeclared     owes nothing because nobody has said how the shot is made.
                          Not 0/1, not complete, and not a reason to preselect a frame.
     frames-not-required  a declared route legitimately owes no still. Not missing
                          work, and not a still package either.
     frames-incomplete    owed > 0 and at least one owed frame is unsatisfied.
     frames-complete      owed > 0 and every owed frame is satisfied. The ONLY state
                          that may say the still package is ready.
     unknown              the canonical projection could not be reached. Reported as
                          such rather than guessed, because a guess here is the whole
                          defect.

   `route-undeclared` is decided LAST, after the owed count, on purpose: a shot with a
   still delivery and no route legitimately owes its opening frame, and asking the
   route first would have called that shot undeclared and dropped its debt. */
function shotStillObligation(shot) {
  const frames = guidedFrames(shot);
  const known = typeof currentlyRequiredFrames === "function" && typeof shotReadinessFor === "function";
  /* No canonical projection, no requirement. The fallback is deliberately NOT the
     stored flag: reaching for it here is how this file acquired its own opinion in
     the first place. app.js's own documented fallback still applies inside
     currentlyRequiredFrames(), which is where it is argued for. */
  const owed = known ? currentlyRequiredFrames(shot, shotReadinessFor(shot)) : [];
  const approvedOwed = owed.filter((frame) => guidedFrameApproved(shot, frame, takesFor(shot.id), frames.indexOf(frame)));
  const routeDeclared = typeof readShotRoute === "function" && readShotRoute(shot).reading === "declared";
  const stillRequirementState = !known
    ? "unknown"
    : owed.length
      ? approvedOwed.length >= owed.length ? "frames-complete" : "frames-incomplete"
      : routeDeclared ? "frames-not-required" : "route-undeclared";
  return {
    routeDeclared,
    owedFrameIds: owed.map((frame) => frame.id),
    owedFrameCount: owed.length,
    approvedOwedFrameIds: approvedOwed.map((frame) => frame.id),
    approvedOwedCount: approvedOwed.length,
    stillRequirementState,
  };
}

/* HAS A ROUTE-REQUIRED STILL OBLIGATION BEEN COMPLETED. The one question the
   "STILL AUTOMATION COMPLETE" receipt is allowed to answer.

   THIS ASKED THE WRONG QUESTION. It asked whether the shot was still WAITING on a
   still — `stillRequirementState !== "frames-incomplete"` — and the two zero states
   answered yes, because a shot that owes nothing is indeed not waiting. But the flag
   this gates is read as COMPLETION, not as absence of waiting, and those are not the
   same claim:

     route-undeclared     owes nothing because nobody has said how the shot is made.
                          There is no obligation to have completed.
     frames-not-required  a declared route legitimately owes no still. Again there is
                          no obligation to have completed.

   Both are "no current still debt" and NEITHER is "the still work is done". Only a
   shot that owed stills and has satisfied all of them has completed anything, so
   `frames-complete` is the only state that may say so — and `unknown` cannot, because
   a receipt written on an unreadable obligation is the guess this file exists to
   refuse. An optional frame run on a zero-owed shot still finishes, still keeps its
   media and still reports itself in the run summary; what it does not do is turn a
   shot that owed nothing into a shot that has completed something. */
function stillObligationSettled(obligation) {
  return obligation.stillRequirementState === "frames-complete";
}

/* MAY THE SHIPPED "STILL AUTOMATION COMPLETE" BANNER BE DRAWN FOR THIS SHOT.

   TWO THINGS, and the persisted half alone was never enough. `automationReadyForMotion`
   is a RECEIPT — a run finished and the obligation it was for was complete — and a
   receipt keeps saying what it said on the day it was written. The obligation does not:
   declaring a reference-driven route on a shot whose opening frame was approved under
   an image route leaves the receipt true and the claim false, and the banner went on
   announcing a completed still package for a route that requires no still at all.

   So the claim is re-checked against current truth every time it is read. Nothing is
   deleted and nothing is reconciled on write: the historical frames stay, the receipt
   stays, and declaring the frame-owing route again makes the banner correct again
   because it was always the CURRENT obligation being asked. That is the same shape as
   every other derivation in this product — the stage model stores no status either. */
function stillAutomationCompletionClaim(shot) {
  const creation = shot && typeof shot.creationBrief === "object" && shot.creationBrief ? shot.creationBrief : {};
  if (!creation.automationReadyForMotion) return false;
  return stillObligationSettled(shotStillObligation(shot));
}

/* WHAT A COMPLETED STILL RUN MAY CLAIM. Extracted so the sentence can be asserted
   per state rather than only through a live run: the old one was produced whatever
   happened, so a run on a shot that owed no still announced a ready still package,
   and so did a run that left an owed frame unapproved. `produced` is how many frames
   the run was actually asked to make, which is the only honest thing to report when
   nothing was owed. */
function shotStillAutomationSummary(obligation, produced, approvedLabels) {
  const names = approvedLabels.join(", ") || "none";
  if (obligation.owedFrameCount === 0)
    return `${produced} frame${produced === 1 ? " was" : "s were"} produced as optional work; this shot owes no still frame${obligation.routeDeclared ? " in the way it is made" : " until an execution route is chosen"}.`;
  if (obligation.stillRequirementState === "frames-complete")
    return `${approvedLabels.length} required frame${approvedLabels.length === 1 ? "" : "s"} approved (${names}). The still package is ready for manual motion setup.`;
  return `${approvedLabels.length} of ${obligation.owedFrameCount} required frame${obligation.owedFrameCount === 1 ? "" : "s"} approved (${names}). The still package is not complete yet.`;
}

/* The hub card's two lines, one pair per state. Only `frames-complete` may say the
   package is ready, and only the two owed states may print a fraction. */
function shotStillObligationCard(obligation) {
  const done = obligation.approvedOwedCount, owed = obligation.owedFrameCount;
  switch (obligation.stillRequirementState) {
    case "frames-complete": return { value: `${done}/${owed} approved`, note: "Still package ready" };
    case "frames-incomplete": return { value: `${done}/${owed} approved`, note: "Full-shot automation can continue the chain" };
    case "frames-not-required": return { value: "None", note: "This shot is made in a way that needs no still frame" };
    case "route-undeclared": return { value: "None yet", note: "No still is required until you say how this shot is made" };
    default: return { value: "—", note: "CineBraid cannot read this shot's still requirement" };
  }
}

window.shotAutomationHub = (shot, placement = "look") => {
  const stillObligation = shotStillObligation(shot), stillCard = shotStillObligationCard(stillObligation);
  const blocking = blockingAttemptReviewSummary(shot), active = activeBlockingRow(shot), scene = sceneById(shot.scene), sceneApproved = v664SceneApprovedCount(shot), sceneReview = scene?.continuityReview || null;
  /* Counted over every attempt on the shot, scored over the opening pool. Reporting
     the opening pool alone said "No attempts yet" on a shot whose attempts were all
     bound to frames and plainly visible in the panel below. */
  const blockingPools = blockingAttemptPools(shot), blockingFramed = blockingPools.rows.length - blocking.rows.length;
  const blockingCount = blockingPools.rows.length
    ? `${plural(blockingPools.rows.length, "attempt")}`
    : "No attempts yet";
  const blockingDetail = blocking.reviewed
    ? `${blocking.reviewed}/${blocking.rows.length} opening AI reviewed${blockingFramed ? ` · ${blockingFramed} frame-bound` : ""}`
    : blocking.rows.length
      ? `Ready for AI review${blockingFramed ? ` · ${blockingFramed} frame-bound` : ""}`
      : blockingFramed
        ? `${plural(blockingFramed, "attempt")} reviewed with their frame`
        : "No attempts yet";
  const currentRun = v626LatestRun("shot-chain", shot.id, "stills"), blockingRun = v626LatestRun("shot-chain", shot.id, "blocking-only");
  const open = !manualFirstWorkflow() || [currentRun, blockingRun].some((row) => (typeof v670RunUnsettled === "function" ? v670RunUnsettled(row) : ["running","awaiting-review","failed","interrupted"].includes(row?.status)));
  return `<details class="shot-automation-hub" ${open ? "open" : ""}><summary><div><span>OPTIONAL ASSISTED PRODUCTION</span><b>Review blocking, automate this shot, or check the scene</b><small>Manual work remains first-class. These tools reuse approved references and existing results before spending credits.</small></div><span>${currentRun ? esc(String(currentRun.status || "run").replace(/-/g," ").toUpperCase()) : "OPTIONAL"}</span></summary><div class="shot-automation-hub-body"><div class="shot-automation-status-grid"><article><span>BLOCKING</span><b>${active ? "Guide active" : esc(blockingCount)}</b><small>${esc(blockingDetail)}</small></article><article><span>REQUIRED FRAMES</span><b>${esc(stillCard.value)}</b><small>${esc(stillCard.note)}</small></article><article><span>SCENE CONTINUITY</span><b>${sceneReview ? esc(String(sceneReview.verdict || "reviewed").replace(/_/g," ")) : `${sceneApproved} approved still${sceneApproved === 1 ? "" : "s"}`}</b><small>${sceneApproved >= 2 ? "Ready for sequence review" : "Available after two scene stills are approved"}</small></article></div><div class="shot-automation-primary-actions">${blocking.recommended && blocking.recommendation?.pass ? `<button class="approve-btn" onclick="useRecommendedBlockingAttempt('${attr(shot.id)}')">USE RECOMMENDED GUIDE · ${Number(blocking.recommendation.score || 0)}</button>` : ""}<button class="approve-btn large" onclick="openShotAutomationModal('${attr(shot.id)}')">AUTOMATE FULL SHOT</button></div><div class="shot-automation-scene-actions"><a class="text-link-btn" href="#/scene/${attr(shot.scene)}">Scene continuity & automation · ${esc(scene?.title || shot.scene)} →</a></div></div></details>`;
};

window.shotAutomationPanel = (shot) => {
  /* The wording follows the obligation, so a shot that owes no still is not told the
     pipeline will "generate and review the opening frame" it never asked for. */
  const stillObligation = shotStillObligation(shot);
  const run = v626LatestRun("shot-chain", shot.id, "stills");
  const description = stillObligation.owedFrameCount === 0
    ? (stillObligation.routeDeclared
      ? "This shot is made in a way that requires no still frame. Full-shot automation will produce only the frames you select here, as optional work, and motion generation remains manual."
      : "This shot has not said how it is made, so no still frame is required yet. Choose an execution route first, or select the frames you want produced as optional work. Motion generation remains manual.")
    : stillObligation.owedFrameCount > 1
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
  v6211RegisterGenerationView("blocking", { includeOutputs: false, includeFrame: false, maxImages: 9 });
  openModal(`<div class="automation-plan-modal"><h3>Plan blocking automation — ${esc(shotId)}</h3><div class="modal-sub">GRAYSCALE COMPOSITION GUIDE ONLY · NO FINISHED STILL</div><div id="blocking-generation-view"></div><p class="modal-confirm-message">CineBraid will build and improve the blocking prompt, generate options, review camera/pose/scale/contact points, revise failed rounds, and install the best passing result as the active guide.</p><div class="two-col"><label><span>Maximum review rounds</span><select id="v626-blocking-rounds" onchange="updateBlockingAutomationEstimate()">${[1,2,3].map((n)=>`<option value="${n}" ${n===3?"selected":""}>${n}</option>`).join("")}</select></label><label><span>Options per round</span><select id="v626-blocking-outputs" onchange="updateBlockingAutomationEstimate()">${[1,2,3,4].map((n)=>`<option value="${n}" ${n===3?"selected":""}>${n}</option>`).join("")}</select></label></div><label class="checkline"><input id="v626-blocking-reuse" type="checkbox" checked onchange="updateBlockingAutomationEstimate()"> Reuse the current active guide instead of spending credits again when one already exists</label><div id="v626-blocking-auto-preflight"></div><div id="v626-blocking-auto-estimate" class="automation-cost-guard"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="v626-start-blocking-auto" class="approve-btn" onclick="startPlannedBlockingAutomation()">START BLOCKING AUTOMATION</button></div></div>`);
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
  if (estimate) estimate.innerHTML = `<b>Maximum ${maxImages} generated blocking image${maxImages === 1 ? "" : "s"}</b><span>${outputsPerRequest} option${outputsPerRequest === 1 ? "" : "s"} per round · up to ${rounds} round${rounds === 1 ? "" : "s"}. The run stops early on a passing guide.</span>`;
  /* The worst case moved, so the price moves with it. One statement of the cost per
     screen, from the one configured rate — a planner that priced a nine-image run
     differently from the dialog that dispatches those nine images would be the original
     two-authorities defect in a different room. */
  v6211DrawGenerationView("blocking", {
    includeOutputs: false, includeFrame: false, maxImages,
    limits: {
      rows: [
        { value: rounds, label: rounds === 1 ? "review round at most" : "review rounds at most" },
        { value: outputsPerRequest, label: "options per round" },
        { value: maxImages, label: "images at the very most" },
      ],
      stopEarly: `The run stops as soon as a guide passes review, so it usually spends less than the worst case.${reuseApproved ? " An existing active guide is reused instead of generating again." : ""}`,
    },
  });
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

/* The approved reference ONE continuity state actually has.

   A state's approval is its OWN approvedFile. `entity.approvedFile` stands in
   only for the DEFAULT state, because that is the file the default is seeded
   from and synced to in ensureEntityStateList() - it is the default's image, and it
   cannot answer for "rain-soaked". Without that distinction a declared state
   with no reference of its own silently reports the default's, which is the
   second half of the false READY: resolving the frame's state correctly is not
   enough if the authority lookup then hands back the clean image anyway.

   This is not a new rule. v627EntityPreflight below has read parent states this
   way since state chains existed; naming it once makes the two preflights share
   the reading instead of each keeping a copy of it.

   The rule itself now lives in public/shared-continuity.js as
   stateApprovedFile(), which server.js's authority selection and the browser's
   reference package read too — so the preflight's verdict and the image a
   generation is actually handed cannot disagree. This wrapper survives for its
   null guard and its name, which the preflight suites assert on. */
function v626StateApprovedFile(entity, state) {
  if (!entity || !state) return "";
  return stateApprovedFile(entity, state);
}
/* The state a given frame of this shot declares for one entity, as a record on
   THAT entity.

   The id comes from resolveDeclaredStateId() - the P4-SEM-B canonical rule,
   frame then shot then entity default - and never from a second reading of the
   runtime maps. State ids are owner-scoped, so the record is looked up on this
   entity and nowhere else. An id naming no state on this entity resolves to the
   entity's default, which is what resolveStateRecord() already does for the
   continuity manifest; a binding that names a state the entity does not declare
   is the format layer's `disputed` statement to report, not the preflight's. */
function v626DeclaredState(shot, frameId, kind, entity) {
  if (!entity) return null;
  const stateId = resolveDeclaredStateId(shot, frameId, kind, entity.id);
  return entityStateById(entity, stateId) || entityStateById(entity, "");
}

/* The absent entities one frame declares, resolved to the names they are known
   by so the contradiction check can look for them in prose. */
function v670FrameAbsentEntities(shot, frame, resolved) {
  const ids = absentEntityIdsForFrame(shot, frame?.id || "");
  if (!ids.length) return [];
  const pool = [
    ...(resolved?.characters || []),
    ...(resolved?.locations || []),
    ...(resolved?.props || []),
    ...(resolved?.vehicles || []),
  ];
  return ids.map((id) => {
    const entity = pool.find((item) => item && item.id === id) || null;
    return { id, name: entity?.name || id, aliases: [entity?.prefix, entity?.anchorPrefix].filter(Boolean) };
  });
}
function v670FramePresenceContradictions(shot, frame, resolved, description) {
  const absentEntities = v670FrameAbsentEntities(shot, frame, resolved);
  if (!absentEntities.length) return [];
  return framePresenceContradictions({ absentEntities, spec: { narrativePurpose: description }, prompt: "" });
}
/* K6, APPLIED BEYOND THE CORRECTION RUNNER.
 *
 * The post-green source audit asked for anything named preflight/validate/check
 * that mutates project state, and found this one: it called `guidedFrames`,
 * which normalises the shot and CREATES an opening frame when none exists, and
 * `guidedFrameState`, which rebuilds the per-frame workflow record. Opening the
 * automation planner therefore edited the project.
 *
 * Neither creates authority, so this is not the correction-runner defect — but
 * it is the same principle, and a check that repairs what it is checking cannot
 * report that it was missing. Both reads are non-mutating now. */
function v626ShotFramesRead(shot) {
  const frames = shot && Array.isArray(shot.keyframes) ? shot.keyframes.filter((frame) => frame && typeof frame === "object") : [];
  return frames;
}
function v626FrameStateRead(shot, frame) {
  const creation = shot && typeof shot.creationBrief === "object" && shot.creationBrief ? shot.creationBrief : {};
  const workflows = creation.frameWorkflows && typeof creation.frameWorkflows === "object" ? creation.frameWorkflows : {};
  const state = workflows[frame?.id];
  return state && typeof state === "object" ? state : {};
}
function v626ShotPreflight(shot, frameIds) {
  const errors = [], warnings = [];
  if (!falGenerationReady()) errors.push("FAL GPT Image 2 generation is not enabled.");
  if (!capabilityState("text").ready) errors.push(capabilityState("text").message || "The text assistant is unavailable.");
  if (!capabilityState("vision").ready) errors.push(capabilityState("vision").message || "The vision assistant is unavailable.");
  const frames = v626ShotFramesRead(shot), selected = frameIds.map((id) => frames.find((frame) => frame.id === id)).filter(Boolean);
  if (!frames.length) errors.push(`${shot?.id || "This shot"} has no frames yet. Open it and add an opening frame before automating it.`);
  if (!selected.length) errors.push("Choose at least one frame.");
  const stateBearing = typeof shotStateBearingEntityRecords === "function"
    ? shotStateBearingEntityRecords(P, shot).filter((record) => record?.resolved && record.entity)
    : [];
  const entitiesOfType = (type) => stateBearing.filter((record) => record.type === type).map((record) => record.entity);
  const resolved = {
    locations: entitiesOfType("location"),
    characters: entitiesOfType("character"),
    props: entitiesOfType("prop"),
    vehicles: entitiesOfType("vehicle"),
  };
  for (const frame of selected) {
    const index = frames.indexOf(frame), state = v626FrameStateRead(shot, frame);
    const description = String(state.action || frame.description || "").trim();
    if (!description) errors.push(`Frame ${frame.label} needs a description.`);
    if (index > 0 && !frameIds.includes(frames[index - 1].id) && !guidedFrameApproved(shot, frames[index - 1], takesFor(shot.id), index - 1)) errors.push(`Frame ${frame.label} needs approved Frame ${frames[index - 1].label} or that parent frame included in this run.`);
    /* FRAME PRESENCE CONTRADICTION, caught before the run is authorized rather
       than at compile time when a paid pass has already been paid for. The
       server refuses the compile too — that is the hard gate — but a run that
       cannot possibly compile should never be startable. */
    for (const finding of v670FramePresenceContradictions(shot, frame, resolved, description)) {
      errors.push(`Frame ${frame.label} declares ${finding.entityName} absent, but its description states ${finding.entityName} positively: "${finding.fragment}".`);
    }
  }
  const groups = [["location", resolved?.locations || []], ["character", resolved?.characters || []], ["prop", resolved?.props || []], ["vehicle", resolved?.vehicles || []]];
  /* Per FRAME, not once per shot. This used to read `shot.continuityStateSelections`
     directly - the SHOT-level runtime map and nothing else - so a frame that
     declared its own state was checked against the shot's. A run whose Frame B
     needs the rain-soaked authority reported READY because the clean one exists,
     and only the generator found out. The declared state and the reference the
     preflight cleared were two truths.

     `v626DeclaredState` asks the canonical resolver instead, so this reads the
     same answer as the continuity manifest, the frame workspace and server.js's
     authority selection. With no frame selected the question is still the shot's,
     which is exactly what frame id "" asks - so an empty picker keeps reporting
     the references it always did rather than falling silent. */
  const scope = selected.length ? selected : [{ id: "", label: "" }];
  for (const [label, items] of groups) for (const item of items) {
    const shotState = v626DeclaredState(shot, "", label, item);
    for (const frame of scope) {
      const state = v626DeclaredState(shot, frame.id, label, item);
      if (v626StateApprovedFile(item, state)) continue;
      /* The default's wording is unchanged on purpose: a project that declares no
         state is the whole existing corpus, and it must read exactly as before. */
      if (!state || state.isDefault) { errors.push(`${item.name || item.id} needs an approved ${label} reference.`); continue; }
      errors.push(state.id === shotState?.id
        ? `${item.name || item.id} needs an approved ${label} reference for its declared state ${state.name || state.id}.`
        : `Frame ${frame.label} declares ${item.name || item.id} as ${state.name || state.id}, which has no approved ${label} reference.`);
    }
  }
  if (!resolved?.locations?.length) warnings.push("No location is attached; the automation will rely on the written shot description.");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
window.openShotAutomationModal = (shotId) => {
  const shot = shotById(shotId), frames = guidedFrames(shot);
  /* THE PLAN'S DEFAULTS ARE THE CANONICAL OWED SET, AND CAN NEVER EXCEED IT.

     This used to preselect `unfinished.length ? unfinished : required.slice(0, 1)`
     over the stored flag — so a shot that owed nothing still opened with Frame A
     ticked, and a run started from that plan would have produced a frame no
     declaration had asked for. Every frame record stays LISTED, because choosing to
     make one is a decision the filmmaker is allowed to take; none is CHOSEN for them.
     An owed frame that is already approved is not preselected either: there is
     nothing left to do about it. */
  const stillObligation = shotStillObligation(shot);
  const owedFrames = frames.filter((frame) => stillObligation.owedFrameIds.includes(frame.id));
  const defaultIds = owedFrames
    .filter((frame) => !guidedFrameApproved(shot, frame, takesFor(shot.id), frames.indexOf(frame)))
    .map((frame) => frame.id);
  const maxWithBlocking = 9 + defaultIds.length * 6 + Math.max(0, defaultIds.filter((id) => frames.findIndex((frame) => frame.id === id) > 0).length) * 6;
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626ShotAutomationDraft = { shotId, frameIds: defaultIds, reviewExistingBlocking: true, reviewSceneAfterShot: true, generationSettings };
  const existingBlocking = v664BlockingRowsForReview(shot).length;
  v6211RegisterGenerationView("shot", { outputs: 3, maxImages: maxWithBlocking });
  openModal(`<div class="automation-plan-modal"><h3>Automate the full shot — ${esc(shotId)}</h3><div class="modal-sub">BLOCKING → AI REVIEW / SELECTION → REQUIRED FRAMES → OPTIONAL SCENE CONTINUITY · VIDEO REMAINS MANUAL</div><div id="shot-generation-view"></div><section class="automation-pipeline-summary"><b>Full still pipeline</b><span>CineBraid first reviews the ${existingBlocking || "existing"} blocking attempt${existingBlocking === 1 ? "" : "s"}. If none passes, it generates and reviews new grayscale guides. It then creates selected frames parent-first and can review the scene against approved references and Project Bible text.</span></section><div class="automation-frame-picker">${frames.map((frame, index) => { const approved = guidedFrameApproved(shot, frame, takesFor(shot.id), frames.indexOf(frame)); return `<label><input type="checkbox" class="v626-auto-frame" value="${attr(frame.id)}" ${defaultIds.includes(frame.id) ? "checked" : ""} onchange="updateShotAutomationEstimate()"><span><b>Frame ${esc(frame.label)}</b><small>${approved ? `Already approved · ${esc(approved.name)}` : esc(frame.description || "No description")}${index ? ` · derives from Frame ${esc(frames[index - 1]?.label || "previous")}` : ""}</small></span></label>`; }).join("")}</div><label class="checkline"><input id="v626-review-existing-blocking" type="checkbox" checked onchange="updateShotAutomationEstimate()"> Review and reuse existing blocking attempts before generating more${existingBlocking ? ` · ${existingBlocking} available` : ""}</label><label class="checkline"><input id="v626-derivative-blocking" type="checkbox" checked onchange="updateShotAutomationEstimate()"> Generate and review a frame-specific blocking edit for later frames</label><label class="checkline"><input id="v626-reuse-approved" type="checkbox" checked> Reuse existing approved frames and guides instead of spending credits again</label><label class="checkline"><input id="v626-review-scene-after" type="checkbox" checked> Review scene continuity after this shot completes when at least two scene stills are approved</label><div id="v626-shot-auto-preflight"></div><div id="v626-shot-auto-estimate" class="automation-cost-guard"><b>Maximum ${maxWithBlocking} images</b><span>3 options per request · up to 3 opening-blocking rounds · up to 2 frame and derivative-blocking rounds</span></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="v626-start-shot-auto" class="approve-btn large" onclick="startPlannedShotAutomation()">START FULL SHOT AUTOMATION</button></div></div>`);
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
  if (estimate) estimate.innerHTML = `<b>Maximum ${max} generated image${max === 1 ? "" : "s"}</b><span>The run stops early on passing results and cannot exceed this confirmed cap.</span>`;
  v6211DrawGenerationView("shot", {
    outputs: 3, maxImages: max,
    limits: {
      rows: [{ value: max, label: "images at the very most" }],
      stopEarly: "The run stops as soon as results pass review and can never exceed this confirmed cap, so it usually spends less than the worst case.",
    },
  });
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

/* 1D — PURE. The 1C audit found this calling `ensureEntityStateList(entity, true)`,
   which inserts a default state, migrates notes, adds generation fields and
   syncs the entity's approved file. Opening the planner edited the project.
   `entityStateListRead` answers the same question and writes nothing. */
function v627EntityPreflight(list, entity, stateIds) {
  const errors = [], warnings = [], lineageGaps = [], selected = new Set(stateIds || []), states = entityStateListRead(entity, true), byId = new Map(states.map((state) => [state.id, state]));
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
      if (!parent) {
        /* TWO DIFFERENT DEAD ENDS, AND ONLY ONE OF THEM IS FIXABLE FROM HERE.
           A state that records NOTHING is missing a human decision, and this run
           is exactly where the filmmaker is standing when they need to make it —
           so the gap travels to the markup and the chooser is offered inline. A
           state that records a parent which no longer exists is damage, and
           choosing a different source would be the reparent this build refuses. */
        if (String(current.parentStateId || "")) errors.push(`${current.name || "State"} records a source state that no longer exists (${current.parentStateId}). Repair its lineage before generating from it.`);
        else {
          lineageGaps.push(current.id);
          errors.push(`${current.name || "State"} does not record what it derives from. Choose its source state below.`);
        }
        break;
      }
      if (seen.has(parent.id)) { errors.push(`${state.name || "State"} has a circular parent chain.`); break; }
      seen.add(parent.id);
      const parentFile = v626StateApprovedFile(entity, parent);
      if (!selected.has(parent.id) && !parentFile) errors.push(`${state.name || "State"} needs ${parent.name || "its parent"} approved or included in this run.`);
      if (parentFile && !media.has(parentFile)) errors.push(`${parent.name || "Parent"} approval file is missing from project media: ${parentFile}.`);
      current = parent;
    }
  }
  if (states.length > 1 && !states.some((state) => !state.isDefault)) warnings.push("This entity currently has only its default state.");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], lineageGaps: [...new Set(lineageGaps)] };
}
/* `list` and `entity` are optional so the scene planner, which has neither, keeps
   working unchanged. When they are supplied, a blocked run offers the source-state
   decision here instead of sending the filmmaker away to find it. */
function v627PreflightMarkup(preflight, list = "", entity = null) {
  const gaps = (preflight.lineageGaps || []);
  const chooser = list && entity && gaps.length && typeof continuityStateDerivationMarkup === "function"
    ? gaps.map((stateId) => continuityStateDerivationMarkup(list, entity, entityStateById(entity, stateId))).join("")
    : "";
  return `${preflight.errors.length ? `<div class="guided-prompt-error"><b>Cannot start yet</b><span>${esc(preflight.errors.join(" "))}</span></div>` : `<div class="prompt-check ok">Automation preflight passed.</div>`}${chooser}${preflight.warnings.length ? `<div class="prompt-check warn">${esc(preflight.warnings.join(" "))}</div>` : ""}`;
}
/* S12 — OPENING A PLANNER READS. IT DOES NOT BUILD.
 *
 * `v627EntityPreflight` was made pure in Batch 1D and the audit confirmed it —
 * then found the modal wrapper calling the mutating list builder one line
 * earlier, so merely opening this dialog created a default state, generation
 * fields, prompt fields and a build array on a bare entity. The guard had moved;
 * the reachable surface had not.
 *
 * The reader answers the same question. When there is nothing to read, the
 * preflight SAYS the default state is not initialized rather than quietly
 * initializing one — initialization is a decision, and it belongs to the act
 * that starts the run. */
window.openAssetAutomationModal = (list, id) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  const state = entityStateListRead(entity, true).find((item) => item.isDefault);
  const stateIds = [state?.id || "state-default"], preflight = v627EntityPreflight(list, entity, stateIds);
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626EntityAutomationDraft = { list, id, stateIds, scope: "default-only", generationSettings };
  v6211RegisterGenerationView("entity", { includeBlocking: false, outputs: 3, maxImages: 9, limits: { rows: [{ value: 3, label: "passes at most" }, { value: 3, label: "candidates per pass" }, { value: 9, label: "images at the very most" }], stopEarly: "The run stops as soon as a candidate earns a strong pass. Nothing becomes canon without your approval." } });
  openModal(`<div class="automation-plan-modal compact"><h3>Automate default reference — ${esc(entity.name || id)}</h3><div class="modal-sub">DURABLE STILL AUTOMATION · THREE PASSES MAXIMUM</div><div id="entity-generation-view"></div><p class="hint">CineBraid builds and improves the reference prompt, generates the selected number of candidates per pass, and reviews each against canon. When a pass produces nothing approvable it aggregates why every candidate failed, corrects the prompt, and runs the next authorized pass. It stops as soon as a candidate earns a strong pass — and always waits for your approval before anything becomes canon.</p><label class="checkline"><input id="v626-reuse-approved-states" type="checkbox" checked> Reuse the existing approved default instead of spending credits again</label><div>${v627PreflightMarkup(preflight, list, entity)}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" ${preflight.errors.length ? "disabled" : ""} onclick="startPlannedEntityAutomation()">START</button></div></div>`);
};
window.openEntityStateAutomationModal = (list, id, stateId) => {
  const entity = P[list]?.find((item) => item.id === id), state = entityStateById(entity, stateId);
  if (!entity || !state) return;
  const stateIds = [state.id], preflight = v627EntityPreflight(list, entity, stateIds);
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626EntityAutomationDraft = { list, id, stateIds, scope: `state:${state.id}`, generationSettings };
  const parent = assetStateParent(entity, state);
  v6211RegisterGenerationView("entity", { includeBlocking: false, outputs: 3, maxImages: 9, limits: { rows: [{ value: 3, label: "passes at most" }, { value: 3, label: "candidates per pass" }, { value: 9, label: "images at the very most" }], stopEarly: "The run stops as soon as a candidate passes review within the confirmed cap. Approval always stays with you." } });
  openModal(`<div class="automation-plan-modal compact"><h3>Automate ${esc(state.name || "state")} — ${esc(entity.name || id)}</h3><div class="modal-sub">DERIVED REFERENCE · THREE PASSES MAXIMUM</div><div id="entity-generation-view"></div><p class="hint">The approved ${esc(parent?.name || "base")} reference becomes the editable input. Review checks identity preservation and only the requested visible state delta. If no candidate passes, automation aggregates why they failed, corrects the prompt, and retries within the confirmed cap. Approval always stays with you.</p><label class="checkline"><input id="v626-reuse-approved-states" type="checkbox" checked> Reuse this state when it is already approved</label><div>${v627PreflightMarkup(preflight, list, entity)}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" ${preflight.errors.length ? "disabled" : ""} onclick="startPlannedEntityAutomation()">START</button></div></div>`);
};
window.openEntityChainAutomationModal = (list, id) => {
  const entity = P[list]?.find((item) => item.id === id);
  if (!entity) return;
  /* Reads. See openAssetAutomationModal for why. */
  const states = entityStateListRead(entity, true);
  /* PRE-TICKED = STILL OWES A DECISION. A state whose pointer nobody approved
     is HISTORIC and still owes one, so the planner offers it rather than
     treating a pointer as work already done. */
  const planTruth = typeof entityProductionTruth === "function"
    ? entityProductionTruth(P, list, id)
    : { canon: [] };
  const planCanon = new Set(planTruth.canon.map((row) => row.stateId));
  const defaultIds = states.filter((state) => !planCanon.has(state.id)).map((state) => state.id);
  const generationSettings = v6211AutomationGenerationSettings();
  window._v626EntityAutomationDraft = { list, id, stateIds: defaultIds, scope: "state-chain", generationSettings };
  v6211RegisterGenerationView("entity", { includeBlocking: false, outputs: 3, maxImages: 0 });
  openModal(`<div class="automation-plan-modal"><h3>Plan continuity-state chain — ${esc(entity.name || id)}</h3><div class="modal-sub">PARENT-FIRST DERIVED REFERENCES</div><div id="entity-generation-view"></div><div class="automation-frame-picker">${states.map((state) => { const parent = assetStateParent(entity, state); return `<label><input type="checkbox" class="v626-auto-state" value="${attr(state.id)}" ${defaultIds.includes(state.id) ? "checked" : ""} onchange="updateEntityChainEstimate()"><span><b>${esc(state.name || "State")}</b><small>${state.approvedFile ? `Approved · ${esc(state.approvedFile)}` : "Needs reference"}${state.isDefault ? " · base state" : ` · derives from ${esc(parent?.name || "Default")}`}</small></span></label>`; }).join("")}</div><label class="checkline"><input id="v626-reuse-approved-states" type="checkbox" checked> Reuse already approved states</label><div id="v627-entity-chain-preflight"></div><div id="v626-entity-chain-note" class="automation-cost-guard"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="v626-start-entity-chain" class="approve-btn" onclick="startPlannedEntityAutomation()">START STATE CHAIN</button></div></div>`);
  updateEntityChainEstimate();
};
/* Planners READ. They are called from render paths and from estimate updaters,
   which are informational surfaces. */
function v626ExpandStateDependencies(entity, stateIds) {
  const selected = new Set(stateIds), states = entityStateListRead(entity, true);
  const visit = (id) => {
    const state = entityStateById(entity, id);
    if (!state || state.isDefault) return;
    const parent = assetStateParent(entity, state);
    /* A parent whose image nobody approved is not a satisfied dependency. */
    const expandTruth = typeof entityProductionTruth === "function"
      ? entityProductionTruth(P, typeof entityListOf === "function" ? entityListOf(entity) : "characters", entity && entity.id)
      : { canon: [] };
    if (parent && !expandTruth.canon.some((row) => row.stateId === parent.id)) { selected.add(parent.id); visit(parent.id); }
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
  entityStateListRead(entity, true).forEach(visit);
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
  if (note) note.innerHTML = `<b>Up to ${maxImages} generated images</b><span>${expanded.length} state${expanded.length === 1 ? "" : "s"} · ${outputsPerRequest} image${outputsPerRequest === 1 ? "" : "s"} per pass · three rounds maximum per state</span>`;
  v6211DrawGenerationView("entity", {
    includeBlocking: false, outputs: outputsPerRequest, maxImages,
    limits: {
      rows: [
        { value: expanded.length, label: expanded.length === 1 ? "state" : "states" },
        { value: outputsPerRequest, label: "images per pass" },
        { value: maxImages, label: "images at the very most" },
      ],
      stopEarly: "Each state stops as soon as a candidate passes review, and approval always stays with you.",
    },
  });
  const preflight = entity ? v627EntityPreflight(draft.list, entity, expanded) : { errors: ["Entity unavailable."], warnings: [] };
  const preflightEl = document.getElementById("v627-entity-chain-preflight");
  if (preflightEl) preflightEl.innerHTML = v627PreflightMarkup(preflight, draft.list, entity);
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
  const generationSettings = draft.generationSettings || v6211AutomationGenerationSettings();
  const run = v626NewRun("entity-chain", `${draft.list}:${entity.id}`, draft.scope || "state-chain", `${entity.name || entity.id} continuity references`, stateIds.length > 1 ? "state-chain" : "single-state", {
    list: draft.list, entityId: entity.id, stateIds,
    reuseApproved: document.getElementById("v626-reuse-approved-states")?.checked !== false,
    stateRounds: 3, outputsPerRequest: Number(draft.outputsPerRequest || 3), maxImages: Number(draft.maxImages || stateIds.length * 3 * Number(draft.outputsPerRequest || 3)),
    generationSettings,
    /* The tier chosen at authorization is the tier every pass of this run may
       spend at. A later pass that arrives at the FAL boundary asking for
       anything else is refused before the request is made, rather than quietly
       costing more than the director agreed to. */
    requiredQuality: String(generationSettings.frameQuality || ""),
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
  /* Persist before the server ingests, for the same reason refreshFalGeneration()
     does: the re-read that follows is a refresh and will decline to replace a
     record that still holds unsaved authored work. */
  await flushPendingProjectSave();
  /* Captured before the request, exactly as refreshFalGeneration() captures it. */
  const owner = ACTIVE_PROJECT_SLUG;
  const response = await fetch(`/api/generation/fal/jobs/${encodeURIComponent(jobId)}/refresh`, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  /* A DURABLE MUTATION AND A FAILED REQUEST ARE TWO SEPARATE TRUTHS. This route
     sets the entity's coverage-automation status before answering 502, and says
     so in the body — so the payload is read and acted on BEFORE the failure is
     surfaced. Throwing first treated `!response.ok` as proof that project.json
     had not changed, which it never was. */
  if (!response.ok) {
    await applyProjectMutationResult(owner, data);
    throw new Error(data.error || "Could not refresh generation");
  }
  const job = data.job;
  FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((item) => item.id !== job.id), job];
  if (job.status === "COMPLETED") {
    /* The same declaration, through the same helper, in the same order: the
       ingest advanced the project document, then the refresh reads it. The
       invariant lives in app.js and neither completion path owns a copy of it. */
    if (noteCurrentProjectDurableAdvance(owner)) await load({ intent: "refresh" });
  }
  return job;
}
async function v626WaitFalJob(run, step, body) {
  await v626CheckCancelled(run);
  await v628RequireAutomationLease(run);
  v667AssertRequestQuality(body, run);
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
    /* THE SAME FIELDS THE MONEY BOUNDARY WILL FINGERPRINT, from the body about to be
       submitted rather than from a second description of it. */
    const paidScope = {
      purpose: body.purpose, shotId: body.shotId, frameId: body.frameId,
      entityList: body.entityList, entityId: body.entityId,
      surface: CINEBRAID_REQUEST_SURFACE_IDS.automationRun, viewMode: "simple",
      buildId: body.sourceBuildId || "", outputCount: count,
    };
    const revalidated = await v6211RevalidatePaidStepLease(run, step, paidScope, durableOperationKey);
    step = run.steps?.[step.key] || step;
    await v641SetStepActivity(run, step.key, "submitting", "Lease revalidated. Submitting the paid image request to FAL now.", {
      system: "FAL · GPT IMAGE 2", providerAccepted: false,
      outputCount: count, quality: String(body.quality || ""), resolution: String(body.resolution || ""),
    });
    /* WHAT THIS DISPATCHER IS. Same declaration as the coverage path and for the same
       reason: without it the money boundary has no plan to enforce. The runner sends the
       generation settings the planner already stored on this run - which the filmmaker
       approved as a block when they authorised it - so quality, size and images-per-pass
       are a recorded authorisation here rather than live controls. `simple` is lossless
       for this surface: it owns the candidate count and quality, both production-tier,
       and the run's stored resolution is a route input the gate leaves alone. */
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, generationRequest: generationRequestDeclaration({ surface: CINEBRAID_REQUEST_SURFACE_IDS.automationRun, viewMode: "simple" }), automationRunId: run.id, automationStepKey: durableOperationKey, automationRunnerId: V627_AUTOMATION_RUNNER_ID, paidPermitId: revalidated.paidPermitId }) });
    const data = await response.json();
    if (!response.ok) {
      step.activity = { ...(step.activity || {}), state: "request rejected", detail: `${data.error || `FAL submission returned HTTP ${response.status}` } No paid request was accepted.`, system: "FAL · GPT IMAGE 2", providerAccepted: false, paidRequestSubmitted: false, httpStatus: response.status, errorCode: data.code || "", updatedAt: v626Now() };
      step.error = data.error || `FAL submission returned HTTP ${response.status}`;
      await v626SaveRun(run, false, false);
      if (typeof v641NotifyAutomationActivity === "function") v641NotifyAutomationActivity(run);
      /* BATCH 1B: the typed refusal from the universal pre-provider gate travels
         with the error. Thrown bare, it reached v626FailureClass() anonymous and
         was classified `provider` — so a deterministic local contradiction was
         recorded as a provider fault and could spend an authorised retry. The
         gate runs before any job row exists, so `providerContacted: false` is a
         fact this dispatcher can assert rather than infer. */
      const submissionError = new Error(data.error || "Could not start FAL generation");
      submissionError.httpStatus = response.status;
      if (data.code) submissionError.code = data.code;
      if (data.classification) submissionError.classification = data.classification;
      if (data.contradictions) submissionError.contradictions = data.contradictions;
      /* The boundary states this on every refusal it makes before dispatch, so it is read
         rather than inferred from a code list that only knew about two of them. */
      if (data.providerContacted === false || data.classification === "local-preflight" || V6_LOCAL_PREFLIGHT_CODES.includes(String(data.code || ""))) {
        submissionError.localPreflightError = true;
        submissionError.providerContacted = false;
        /* The presence-specific sentence stays scoped to the presence gate. Telling a
           filmmaker whose package went stale, or whose run met its spend ceiling, to
           "correct the frame's presence declaration" would be worse than saying nothing —
           so everything else carries the boundary's own explanation, which already says
           what happened and that nothing was submitted. */
        submissionError.remediation = V6_LOCAL_PREFLIGHT_CODES.includes(String(data.code || ""))
          ? "Correct the frame's presence declaration or the prompt text that contradicts it, then run this step again. No paid request was submitted and no attempt was spent."
          : "";
      }
      throw submissionError;
    }
    job = data.job;
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((item) => item.id !== job.id), job];
    step.childJobId = job.id;
    step.activity = { ...(step.activity || {}), state: "provider accepted", detail: data.reused ? "Reattached to the previously accepted paid request; no duplicate request was submitted." : "FAL accepted the paid request. Waiting in the provider queue.", system: "FAL · GPT IMAGE 2", providerAccepted: true, providerStatus: job.status || "SUBMITTED", providerRequestId: falJobProviderRequestId(job), model: job.model || "GPT Image 2", outputCount: count, quality: String(body.quality || ""), resolution: String(body.resolution || ""), acceptedAt: v626Now(), updatedAt: v626Now() };
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
    step.activity = { ...(step.activity || {}), state: String(job.status || "in progress").toLowerCase().replace(/_/g, " "), detail: job.status === "IN_QUEUE" ? `FAL is holding the request in queue${job.queuePosition != null ? ` at position ${job.queuePosition}` : ""}.` : job.status === "IN_PROGRESS" ? "FAL is generating the requested candidates." : "Checking the provider job status.", system: "FAL · GPT IMAGE 2", providerAccepted: true, providerStatus: job.status || "", queuePosition: job.queuePosition, providerRequestId: falJobProviderRequestId(job) || step.activity?.providerRequestId || "", model: job.model || step.activity?.model || "GPT Image 2", updatedAt: v626Now() };
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
  /* `recommend` REPLACES `autoApprove`. Same arithmetic, different authority: it
     names the run's own strongest candidate so the run can stop generating and
     show that candidate first. It has never been, and may never be, a decision. */
  const recommend = pass && explicitPass && explicitScore && score >= v640RecommendationScore(run);
  return { file: picked ? files[Number(picked.n) - 1] || "" : "", pass, explicitPass, explicitScore, recommend, score, note: String(picked?.notes || review.rationale || ""), rationale: String(review.rationale || ""), review };
}
async function v627PauseForHumanReview(run, step, label) {
  step.status = "needs-review";
  /* THE MACHINE STOPS HERE, so the record says so. Without this the step carried no
     completedAt, the activity clock fell back to Date.now(), and a run parked at an
     approval gate counted upward for as long as the director took to look at it.
     Kept if one is already stamped: v626CompleteStep may have recorded the boundary a
     moment earlier, and that one is the more accurate of the two. */
  step.completedAt = step.completedAt || v626Now();
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
/* P4-SEM-C4: which takes this job delivered, resolved IDENTITY FIRST. This used
   to build a Set of output filenames, so a take the approval rename had moved
   stopped matching the job that produced it — and a resumed run then reported
   its own candidates unavailable. jobOutputMatcher() prefers the ledger identity
   the rename recorded and falls back to the filename, which is what every
   pre-C4 project still resolves by. */
function v626FrameRowsFromJob(shotId, frameId, job) {
  const shot = shotById(shotId), frames = guidedFrames(shot), index = frames.findIndex((frame) => frame.id === frameId), delivered = jobOutputMatcher(job);
  return guidedFrameCandidateRows(shot, frames[index], takesFor(shotId), index).filter(delivered);
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
      const job = await v626WaitFalJob(run, genStep, { purpose: "blocking", shotId, frameId: guidedFrames(shotById(shotId))[0]?.id || "", frameLabel: guidedFrames(shotById(shotId))[0]?.label || "A", sourceBuildId: build.id, packageId: build.packageId || "", prompt: falBlockingRevisionPrompt(shotById(shotId), build, sourceAssetId, revision), references: source ? [{ key: `blocking-revision:${source.asset.id}`, label: source.asset.title || source.asset.file, role: "base", url: mediaAssetUrl(source.asset) }] : [], outputCount: v640OutputsPerRequest(run), quality: v6211RunGenerationSettings(run).blockingQuality, resolution: v6211RunGenerationSettings(run).blockingResolution, aspectRatio: shotAspectLabel(P, shotById(shotId)), revisionRequest: revision, revisedFromAssetId: sourceAssetId });
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
      const job = await v626WaitFalJob(run, genStep, { purpose: "blocking", shotId, frameId, frameLabel: frame.label || "", sourceBuildId: build.id, packageId: build.packageId || "", prompt, references: refs, outputCount: v640OutputsPerRequest(run), quality: v6211RunGenerationSettings(run).blockingQuality, resolution: v6211RunGenerationSettings(run).blockingResolution, aspectRatio: shotAspectLabel(P, shotById(shotId)), revisionRequest: revision, revisedFromAssetId: sourceAssetId });
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
  /* THE GATE. Dogfood #2 A1 / forensic F1: this function is the shot-side writer
     of production authority, and until this batch anything inside automation
     could call it. The comment below used to claim "the run still reaches a
     human gate" — on the auto-approve branch it did not, and the claim was the
     only thing standing between a score and canon.

     It is a guard now, not a claim. `grant` must be an explicit human approval
     command; assertHumanAuthority throws for everything else, including an
     omitted argument, which is what every machine call site looked like. */
  const shot = shotById(shotId), frame = frameById(shot, frameId), previous = frame?.winner || "";
  if (!shot || !frame || !fileName) throw new Error("Frame approval target is unavailable");
  /* P4-SEM-C3. The edge records identity as well as the filename, so an approval
     survives the rename it performs. */
  const approvedAssetId = (takesFor(shotId).find((item) => item.name === fileName) || {}).assetId || "";
  /* BATCH 1B: THE EDGE AND THE RECEIPT ARE ONE STATEMENT. The grant check, the
     winner write and the durable receipt happen inside a single command, so
     there is no ordering of calls that produces a winner with nobody's name on
     it.
     BATCH 1D: AND THE CALLER NO LONGER WRITES THE EDGE AT ALL. The kernel's
     installed writer does, so there is no callback here to close over the live
     project — the mutation route the 1C audit exercised. Workflow bookkeeping
     that used to ride along inside that callback now runs after the approval
     lands, which is where it belongs: it is not part of the Canon statement. */
  const receipt = approveFrameCanon(P, {
    shotId, frameId, value: fileName, assetId: approvedAssetId, at: v626Now(), via: "automation-run-approval-modal",
  });
  /* Side effects that are NOT the authority edge run after the commit, against
     the live document, exactly as they always did. 1D-07 moved three more of
     them out here — workflow status and the active-frame pointer — because they
     were inside the deleted edge callback and were never part of the Canon
     statement the receipt makes. */
  const approvedShot = shotById(shotId);
  if (approvedShot) {
    approvedShot.workflowStatus = "IN PROGRESS";
    approvedShot.status = "BUILT";
    approvedShot.creationBrief = approvedShot.creationBrief && typeof approvedShot.creationBrief === "object" ? approvedShot.creationBrief : {};
    approvedShot.creationBrief.activeGuidedFrameId = frameId;
  }
  if (typeof markCandidateApproved === "function") markCandidateApproved(approvedShot, fileName, `frame:${frameId}`);
  if (previous && previous !== fileName && typeof guidedFrameApprovalChanged === "function") guidedFrameApprovalChanged(shotId, `frame:${frameId}`, previous, fileName);
  dirty();
  return receipt;
}
/* WHAT AUTOMATION IS ALLOWED TO WRITE INSTEAD OF AN APPROVAL.

   A nomination, and the run's own internal selection. Everything a strong pass
   knows is preserved — file, score, threshold, reasoning, which run and step
   produced it — under a field whose every reader can see it is not a decision.
   `selectedCandidate` is the existing, non-authoritative "show this one first"
   pointer the frame card already honours, so the creator lands on the candidate
   the reviewer liked and approves it in one act if they agree.

   Deliberately NOT written here: frame.winner, shot.winner, any approval
   identity stamp, markCandidateApproved, shot.workflowStatus. */
function v627RecordFrameRecommendation(run, shotId, frameId, reviewed) {
  const shot = shotById(shotId), frames = guidedFrames(shot), index = frames.findIndex((item) => item.id === frameId), frame = frames[index];
  if (!shot || !frame || !reviewed?.winner) return null;
  const recommendation = automationRecommendation({
    file: reviewed.winner,
    assetId: (takesFor(shotId).find((item) => item.name === reviewed.winner) || {}).assetId || "",
    score: reviewed.score,
    threshold: v640RecommendationScore(run),
    rationale: reviewed.result?.rationale || "",
    runId: run.id,
    stepKey: reviewed.key || "",
    at: v626Now(),
  });
  frame[AUTOMATION_RECOMMENDATION_FIELD] = recommendation;
  guidedFrameState(shot, frame, index).selectedCandidate = reviewed.winner;
  ensureShotCreation(shot).activeGuidedFrameId = frame.id;
  dirty();
  return recommendation;
}
async function v626AutomateFrame(run, shotId, frameId) {
  let shot = shotById(shotId), frames = guidedFrames(shot), index = frames.findIndex((frame) => frame.id === frameId), frame = frames[index];
  const approved = guidedFrameApproved(shot, frame, takesFor(shotId), index);
  /* BATCH 1B: REUSE IS A CONSUMER OF AUTHORITY, so it asks the same question the
     gate asks. Reusing an existing image skips a paid pass AND advances the shot
     chain past a human checkpoint — so a pre-repair automatic winner reaching
     this branch is the audit's "downstream work unblocked by machine authority"
     in its purest form. A frame whose selection nobody ever confirmed goes to
     the gate instead, carrying that selection as the recommendation. */
  const reuseReceipt = approved ? resumeAuthority(P, { kind: "shot-frame-approval", shotId, frameId }) : null;
  if (run.config.reuseApproved && approved && reuseReceipt) {
    const key = `frame:${frameId}:reuse`;
    if (v626Step(run, key).status !== "completed") await v626CompleteStep(run, key, { kind: "frame-approval", label: `Frame ${frame.label} approved`, frameId, winner: approved.name, result: { reused: true, authorityReceiptId: reuseReceipt.id } });
    v628AttachShotAutomationProvenance(run, frameId, approved.name, key, { reused: true });
    await flushPendingProjectSave();
    return approved.name;
  }
  if (run.config.reuseApproved && approved && !reuseReceipt) {
    const historic = historicSelection(P, { targetType: "shot-frame", shotId, frameId });
    await v626Log(run, `Frame ${frame.label} already shows ${approved.name}, but no human approval of it is on record${historic?.basis === "authority-revoked" ? " — the earlier approval was withdrawn" : ""}. It is offered for your decision rather than reused as canon.`, "warn");
    const gateStep = v626Step(run, `frame:${frameId}:existing-selection`, "review", `Approve Frame ${frame.label}`);
    Object.assign(gateStep, { frameId, pass: true, winner: approved.name, files: [approved.name], result: { ...(gateStep.result || {}), targetShotId: shotId, historicSelection: true, rationale: "This image was already selected for the frame, but no human approval of it is recorded." } });
    await v627PauseForHumanReview(run, gateStep, `Approve Frame ${frame.label}`);
  }
  if (index === 0) await v626OpeningBlocking(run, shotId);
  else if (run.config.derivativeBlocking) await v626DerivativeBlocking(run, shotId, frameId);
  let revision = "";
  for (let round = 1; round <= Number(run.config.frameRounds || 2); round++) {
    const reviewKey = `frame:${frameId}:round-${round}:review`, prior = v626Step(run, reviewKey);
    /* RESUMING A COMPLETED REVIEW IS NOT AN APPROVAL. This branch used to
       re-approve any completed passing review step, which is how a run resumed
       after the auto-approve branch wrote authority a second time — and how a
       run resumed after a plain strong pass wrote it for the first time with
       nobody in the loop. `humanApproved` is the only completion that carries a
       decision, and it is the same reading v626AutomateEntityState has always
       used. */
    /* BATCH 1B: RESUME READS THE RECEIPT, NOT THE STEP.

       `prior.result.humanApproved` describes what was true when the step closed.
       The audit turned that into a resurrection: revoke the approval, resume the
       run, and the stale boolean handed authority straight back — because resume
       both trusted it AND issued itself a fresh grant to act on it. Resume now
       asks whether a human decision EXISTS RIGHT NOW, and re-states nothing: a
       live receipt means the edge is already in place, so there is nothing to
       write. No receipt means the gate is open, whatever the step remembers. */
    const priorReceipt = prior.status === "completed" && prior.pass && prior.winner
      ? resumeAuthority(P, { kind: "shot-frame-approval", shotId, frameId })
      : null;
    if (priorReceipt) {
      v628AttachShotAutomationProvenance(run, frameId, priorReceipt.value, prior.key, { score: prior.score, humanApproved: true });
      await flushPendingProjectSave();
      return priorReceipt.value;
    }
    /* A completed review that no live human decision stands behind is EVIDENCE,
       not canon. The run re-parks on it rather than walking past it. */
    if (prior.status === "completed" && prior.pass && prior.winner) {
      await v627PauseForHumanReview(run, prior, `Approve Frame ${frame.label}`);
    }
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
      await v626CompleteStep(run, reviewKey, { kind: "frame-review", label: `Frame ${frame.label} review`, frameId, pass: picked.pass, score: picked.score, winner: picked.file, files: rows.map((row) => row.name), review: data.review, revision: picked.pass ? "" : picked.note || picked.rationale, result: { rationale: picked.rationale, context: data.context || [], recommend: picked.recommend, explicitPass: picked.explicitPass, explicitScore: picked.explicitScore, threshold: v640RecommendationScore(run) } });
    }
    const reviewed = v626Step(run, reviewKey);
    /* WHAT A STRONG PASS DOES NOW. It stops the loop, so no further paid pass is
       bought, records a NON-AUTHORITATIVE nomination the workspace can show
       first, and parks at the human gate. It writes no winner, marks no
       candidate approved and completes no approval step. */
    if (reviewed.pass && reviewed.winner && reviewed.result?.recommend) {
      v627RecordFrameRecommendation(run, shotId, frameId, reviewed);
      await flushPendingProjectSave();
      await v626Log(run, `Frame ${frame.label} has a strong candidate: ${reviewed.winner} (${Math.round(Number(reviewed.score || 0))}/100). No further pass will be generated. Your approval is what makes it canon.`, "success");
      await v627PauseForHumanReview(run, v626Step(run, reviewKey), `Approve Frame ${frame.label}`);
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
      /* Through the declared stage model, which is the only writer of shot stage
         selection the workspace actually reads. This used to call boundedWriteState,
         which writes `cinebraid-bounded:…` — while boundedShotSelectedTask reads
         `cinebraid-focused:…`. The two keys never met, so a completed blocking run
         left the shot on whatever stage it was already showing. */
      try { selectGuidedPanelTask(currentShot, "blocking"); } catch {}
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
    const currentShot = shotById(run.targetId), completedObligation = shotStillObligation(currentShot);
    const approvedLabels = guidedFrames(currentShot)
      .filter((frame) => completedObligation.approvedOwedFrameIds.includes(frame.id))
      .map((frame) => frame.label);
    /* THE FLAG IS A CLAIM, so it waits for the claim to be true. It was written
       unconditionally, which put "STILL AUTOMATION COMPLETE" on the motion workspace
       of a shot whose owed frames were still unapproved — and then, once gated on
       "not waiting", on a shot that had never owed a still at all. */
    /* AND THE RECEIPT IS NOT LEFT SAYING SOMETHING ELSE. A run that completes on a
       shot with no route-required still obligation writes nothing at all: absence is
       "no completed obligation is being claimed", which is what an optional frame run
       on a zero-owed shot honestly leaves behind. A stale `true` from an earlier route
       is removed here rather than reconciled somewhere else. */
    if (stillObligationSettled(completedObligation))
      ensureShotCreation(currentShot).automationReadyForMotion = true;
    else delete ensureShotCreation(currentShot).automationReadyForMotion;
    ensureShotCreation(currentShot).automationCompletedFrameIds = ids;
    keepGuidedPanelOpen(currentShot, "motion"); dirty(); await flushPendingProjectSave();
    const sceneReview = await v664ReviewSceneAfterShot(run, currentShot);
    const sceneNote = sceneReview ? ` Scene continuity review: ${String(sceneReview.verdict || "reviewed").replace(/_/g," ")}.` : "";
    /* ZERO OWED IS NOT "FINISHED EVERYTHING IT OWED", which is what
       `approved === required.length` said when both were zero. */
    const stillSummary = shotStillAutomationSummary(completedObligation, ids.length, approvedLabels);
    await v626FinishRun(run, "completed", `${stillSummary}${sceneNote} No video was generated.`);
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

/* THE DURABLE CLAIM A GENERATION LEAVES BEHIND.

   Dogfood #2 A4 / Batch 1B. Ownership is decided by what the project RECORDS,
   never by what a filename resembles — so the moment CineBraid receives media it
   generated FOR a named entity, that fact has to become a record. The request
   carried the owner; the outputs carry the filenames; this joins them.

   Deliberately not an approval, not a decision, and not a review: a candidate
   row with `decision: "unreviewed"` says only "these bytes belong to this
   reference", which is precisely the question ownership asks. */
function v627ClaimGeneratedEntityCandidates(list, entityId, job, details = {}) {
  const entity = P[list]?.find((item) => item.id === entityId);
  if (!entity || typeof entityCandidateRow !== "function") return 0;
  let claimed = 0;
  for (const output of (job?.outputs || [])) {
    const fileName = String(output?.name || "");
    if (!fileName) continue;
    const existing = entityCandidateRow(entity, fileName, false);
    const row = entityCandidateRow(entity, fileName, true);
    if (!existing) {
      row.decision = row.decision || "unreviewed";
      row.generationJobId = job?.id || "";
      row.generationModel = job?.model || "";
      row.targetStateId = String(details.stateId || "");
      row.automationRunId = String(details.runId || "");
      row.automationStepKey = String(details.stepKey || "");
      row.ownershipClaim = { actor: "automation", basis: "generated-for-this-reference", via: "entity-reference-generation", at: v626Now() };
      claimed += 1;
    }
  }
  if (claimed) dirty();
  return claimed;
}
function v626EntityTarget(run) { const list = run.config?.list || run.entityList, id = run.config?.entityId || run.entityId; return { list, id, entity: P[list]?.find((item) => item.id === id) }; }
/* The entity-side twin of v626ApproveFrame, guarded on the same terms. The
   entity chain never had the auto-approve defect — it has always required
   `result.humanApproved` before re-stating an approval — but "this path happens
   to be correct today" is not an invariant, and one writer that can be called by
   a machine is enough to lose the property again. */
function v626ApproveEntity(list, entityId, stateId, fileName) {
  const entity = P[list]?.find((item) => item.id === entityId), state = entityStateById(entity, stateId);
  if (!entity || !state || !fileName) throw new Error("Entity approval target is unavailable");
  /* The exact bytes, stated rather than omitted. An entity whose media ledger
     has not been indexed genuinely has no identity for this file, and "" says
     so; the kernel refuses a request that leaves the question unanswered. */
  const approvedAssetId = (entityMedia(list, entity).find((item) => item.name === fileName) || {}).assetId || "";
  const receipt = approveEntityStateCanon(P, {
    list, entityId, stateId: state.id, value: fileName, assetId: approvedAssetId, at: v626Now(), via: "automation-run-approval-modal",
  });
  /* 1D-07: the entity's workflow status is bookkeeping, not the Canon edge, so
     it is written after the approval rather than inside it. */
  const approvedEntity = P[list]?.find((item) => item.id === entityId);
  if (approvedEntity) {
    approvedEntity.workflowStatus = "APPROVED";
    approvedEntity.status = "APPROVED";
    approvedEntity.approvedAt = v626Now();
  }
  const row = entityCandidateRow(approvedEntity, fileName, false);
  if (row?.decision === "rejected") row.decision = "unreviewed";
  dirty();
  return receipt;
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
  await v626BeginStep(run, key, "prompt", `Build and improve ${state.name || "state"} prompt · round ${round}`, { stateId, attempt: round, maxAttempts: v668EffectiveStateRounds(run) });
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
  /* The compiled prompt is recorded on the step itself. The run report already
     renders step.result.prompt, so "what exactly did PASS 2 ask for?" is
     answerable without reopening the entity and guessing which build was used. */
  await v626CompleteStep(run, key, { buildId: build.id, stateId, revision: String(revision || ""), result: { llmUsed: !!build.llmUsed, deterministicFallback: !improvedBuild?.prompt, prompt: String(build.prompt || "").slice(0, 8000) } });
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
    /* Same rule as the manual path: whoever actually served this review, from
       this response. Never the currently configured provider or model. */
    reviewer: { provider: String(data?.reviewer?.provider || ""), model: String(data?.reviewer?.model || "") },
    source: "state-automation",
  };
  row.structuredReviews[state.id] = review;
  row.targetStateId = state.id;
  row.targetStateName = state.name || "Default";
  /* Same rule on the automation path: the reviewer records a finding, it does
     not restore a candidate the director already turned down. */
  row.decision = row.decision || "unreviewed";
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

/* ------------------------------------------------------------------------- *
   V666 — the closed loop between one failed pass and the next one.

   A pass that produces no approvable reference is evidence, not a dead end. The
   three things below turn the reviews CineBraid already received into the next
   prompt, and they are deliberately separate:

     v666ReviewFindings   one review  → the individual attributable findings
     v666PassCorrectionPlan  every review in the pass → PRESERVE / CORRECT
     v666CorrectionPlanText  that plan → the directive the compiler receives

   Every CORRECT line is traceable to a criterion a reviewer actually failed and
   carries the candidates it was seen on; nothing is authored here. That is what
   keeps the next prompt a correction rather than a rewrite of canon.          */

const V666_HARD_GATE_LABELS = {
  sameUnderlyingEntity: "Keep the exact same underlying subject/design as the approved authority",
  onlyRequestedDelta: "Apply only the requested state delta and no unrelated changes",
  sameEmbeddedContent: "Preserve the exact embedded photograph, artwork, print, text, map, or screen content pixel-for-pixel in identity and composition",
  sameSpatialGeometry: "Preserve the exact spatial geometry, topology, openings, fixtures, and object placement established by the approved location authorities",
  requestedViewCorrect: "Use the requested viewpoint while remaining spatially consistent with the approved views",
};
/* The reviewer scores these five criteria for every reference. A criterion that
   no candidate flagged is a thing the prompt already gets right, which is what
   makes it eligible for PRESERVE rather than silently drifting next pass. */
function v666ReviewFactorLabels(list) {
  const table = typeof ENTITY_REVIEW_FACTOR_LABELS === "object" && ENTITY_REVIEW_FACTOR_LABELS ? ENTITY_REVIEW_FACTOR_LABELS : {};
  return table[list] || table.props || { design: "Identity & design", state: "Target state", requirements: "Required details", usefulness: "Production-reference clarity", cleanliness: "Cleanliness & artifacts" };
}
/* v667 — a finding carries WHO CAN ACT on it, not just how bad it is.

   The review contract classifies every blocker it returns. This reads that
   classification when it is present and falls back to the same rules locally so
   an older or partial review still sorts correctly. Only generation-correctable
   findings are ever allowed to become a prompt correction and buy another paid
   pass; "no approved authority exists" cannot be regenerated into existence. */
const V666_COMPARISON_GATES = ["sameUnderlyingEntity", "onlyRequestedDelta", "sameEmbeddedContent", "sameSpatialGeometry"];
const V666_ACTIONABILITY = { correctable: "generation-correctable", prerequisite: "workflow-prerequisite", decision: "human-decision" };
function v666FindingActionability(review, key) {
  const source = review && typeof review === "object" ? review : {};
  const declared = (source.blockers || []).find((row) => String(row?.key) === String(key));
  if (declared && [V666_ACTIONABILITY.correctable, V666_ACTIONABILITY.prerequisite, V666_ACTIONABILITY.decision].includes(String(declared.actionability))) {
    return String(declared.actionability);
  }
  if (key === "gate:review-unavailable" || key === "review-unavailable") return V666_ACTIONABILITY.prerequisite;
  if (key === "authority:establish") return V666_ACTIONABILITY.decision;
  const gate = String(key).startsWith("gate:") ? String(key).slice(5) : "";
  /* Establishing the first authority cannot answer a comparison gate. Wanting
     it answered is a request for project data, not for a different image. */
  if (gate && V666_COMPARISON_GATES.includes(gate) && String(source.authorityMode || "") === "establish") return V666_ACTIONABILITY.prerequisite;
  return V666_ACTIONABILITY.correctable;
}
function v666ReviewFindings(review, list = "") {
  const source = review && typeof review === "object" ? review : {};
  const factors = v666ReviewFactorLabels(list), findings = [];
  const push = (key, label, note) => {
    if (findings.some((item) => item.key === key)) return;
    findings.push({ key, label: String(label || key), note: String(note || "").trim(), actionability: v666FindingActionability(source, key) });
  };
  for (const row of source.blockers || []) {
    if (row?.key) push(String(row.key), row.label || row.key, row.note || "");
  }
  for (const [key, row] of Object.entries(source.hardChecks || {})) {
    if (row?.required && row?.pass !== true) push(`gate:${key}`, V666_HARD_GATE_LABELS[key] || key, row.note || "");
  }
  for (const key of source.hardGateFailures || []) {
    if (V666_HARD_GATE_LABELS[key]) push(`gate:${key}`, V666_HARD_GATE_LABELS[key], "");
  }
  if (source.stateMatch && source.stateMatch.matchesRequestedState === false) {
    push("state:mismatch", source.stateMatch.closerState ? `Candidate matches the related state "${source.stateMatch.closerState}" rather than the requested state` : "Candidate does not depict the requested continuity state", source.stateMatch.note || "");
  }
  if (source.reviewUnavailable === true) push("gate:review-unavailable", "AI review was unavailable for this candidate", String(source.summary || ""));
  for (const [key, row] of Object.entries(source.categories || {})) {
    if (["major", "blocking"].includes(String(row?.severity || "").toLowerCase())) push(`category:${key}`, factors[key] || key, row.note || "");
  }
  return findings;
}
/* Criteria this review left unflagged, so the aggregate can tell the next pass
   what it must not disturb while fixing what it must. */
function v666ReviewStrengths(review, list = "") {
  const source = review && typeof review === "object" ? review : {};
  const factors = v666ReviewFactorLabels(list), strengths = [];
  for (const [key, row] of Object.entries(source.categories || {})) {
    if (["pass", "minor"].includes(String(row?.severity || "pass").toLowerCase())) strengths.push({ key: `category:${key}`, label: factors[key] || key, note: String(row?.note || "").trim() });
  }
  return strengths;
}
function v666CleanLine(value, limit = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
/* The aggregate. `results` is the whole pass — every candidate and its review —
   so a fault seen on all three candidates outranks one seen on the weakest, and
   a fault only the top scorer had can no longer be the only thing acted on. */
function v666PassCorrectionPlan(results, options = {}) {
  const list = String(options.list || ""), state = options.state || null, entity = options.entity || null;
  const rows = (Array.isArray(results) ? results : []).filter((row) => row && row.file);
  const candidates = rows.map((row) => ({
    file: String(row.file),
    score: Math.round(Number(row.review?.score || 0)),
    pass: row.review?.pass === true,
    reviewUnavailable: row.review?.reviewUnavailable === true,
    /* v668 — workflow eligibility, kept separate from scoring quality. A score
       says how good the image is; these say whether a human can act on it. The
       required gates are the reviewer's own required list, NOT hardGateFailures,
       which also absorbs score-below-85 and would mark a gate-clearing candidate
       failed purely for scoring low. */
    requiredGatesPassed: v668RequiredGatesPassed(row.review),
    outcome: String(row.review?.outcome || ""),
    summary: v666CleanLine(row.review?.summary, 600),
  }));
  const reviewed = rows.filter((row) => !row.review?.reviewUnavailable);
  /* The champion is the best candidate seen in ANY pass, supplied by the caller.
     Its remaining correctable faults lead the next prompt: they are the shortest
     distance between what already works and an approvable reference. */
  const championFile = String(options.championFile || "");
  const championFaults = new Set(options.championFaultKeys || []);
  const findingMap = new Map();
  for (const row of reviewed) {
    for (const finding of v666ReviewFindings(row.review, list)) {
      const entry = findingMap.get(finding.key) || { key: finding.key, label: finding.label, notes: [], files: [], actionability: finding.actionability };
      if (finding.note && !entry.notes.includes(finding.note)) entry.notes.push(v666CleanLine(finding.note));
      if (!entry.files.includes(row.file)) entry.files.push(row.file);
      /* Prerequisite beats correctable when the same criterion was blocked for
         a missing input on any candidate: a paid pass cannot answer it there. */
      if (finding.actionability === V666_ACTIONABILITY.prerequisite) entry.actionability = V666_ACTIONABILITY.prerequisite;
      findingMap.set(finding.key, entry);
    }
  }
  /* Recurring first, but a fault the champion still carries outranks a tie: the
     next pass should close the gap on the best image, not re-fight a weaker one.
     Ties below that keep the reviewer's own ordering. */
  const shape = (entry) => ({
    key: entry.key,
    label: entry.label,
    note: entry.notes.join(" ").trim(),
    files: entry.files,
    candidateCount: entry.files.length,
    recurring: entry.files.length > 1,
    /* On the champion whether it is in this pass or an earlier one: the same
       criterion still failing is the same unfinished work. */
    onChampion: (!!championFile && entry.files.includes(championFile)) || championFaults.has(entry.key),
    actionability: entry.actionability,
  });
  const ordered = [...findingMap.values()].map(shape).sort((a, b) =>
    (b.onChampion ? 1 : 0) - (a.onChampion ? 1 : 0) || b.candidateCount - a.candidateCount);
  /* The split that stops a non-generative fault from buying a paid pass. */
  const correct = ordered.filter((entry) => entry.actionability === V666_ACTIONABILITY.correctable).slice(0, 8);
  const prerequisites = ordered.filter((entry) => entry.actionability === V666_ACTIONABILITY.prerequisite);
  const decisions = ordered.filter((entry) => entry.actionability === V666_ACTIONABILITY.decision);
  /* A criterion is preserved only when no candidate flagged it. One flag is
     enough to disqualify it: the next pass has to be free to change it. */
  const flaggedKeys = new Set(ordered.map((entry) => entry.key));
  const strengthCounts = new Map();
  for (const row of reviewed) {
    for (const strength of v666ReviewStrengths(row.review, list)) {
      if (flaggedKeys.has(strength.key)) continue;
      const entry = strengthCounts.get(strength.key) || { ...strength, count: 0 };
      entry.count += 1;
      strengthCounts.set(strength.key, entry);
    }
  }
  const preserve = [];
  const stateName = String(state?.name || "").trim();
  const stateDelta = v666CleanLine(state?.notes || (typeof continuityStateDeltaText === "function" && state && !state.isDefault ? continuityStateDeltaText(state) : ""), 600);
  if (stateName) preserve.push({ key: "canon:state", label: `Target state — ${stateName}`, note: stateDelta || "Keep the target state exactly as the brief already defines it." });
  if (entity?.name) preserve.push({ key: "canon:identity", label: `${entity.name} as already established`, note: "Identity, design, wardrobe, age, hair, setting and props stay exactly as the current brief describes them." });
  for (const entry of [...strengthCounts.values()].filter((item) => item.count === reviewed.length && reviewed.length > 0)) {
    preserve.push({ key: entry.key, label: entry.label, note: entry.note || "No candidate was flagged on this criterion." });
  }
  const bestScore = candidates.reduce((best, row) => Math.max(best, Number(row.score || 0)), 0);
  /* Whether another paid pass can accomplish anything is a property of the
     evidence, not of the remaining budget. The loop reads this before spending. */
  const readyToEstablish = reviewed.length > 0 && reviewed.some((row) => row.review?.readyToEstablishAuthority === true || String(row.review?.outcome || "") === "ready-to-establish-authority");
  return {
    stateId: String(state?.id || options.stateId || ""),
    stateName: stateName || "Default",
    passNumber: Math.max(1, Number(options.passNumber || 1)),
    maxPasses: Math.max(1, Number(options.maxPasses || 1)),
    candidates,
    candidateCount: candidates.length,
    reviewedCount: reviewed.length,
    bestScore,
    passed: candidates.some((row) => row.pass),
    championFile,
    preserve,
    correct,
    prerequisites,
    decisions,
    generationCorrectable: correct.length > 0,
    readyToEstablish,
    authorityMode: String(reviewed[0]?.review?.authorityMode || ""),
    recurring: correct.filter((item) => item.recurring).map((item) => item.label),
  };
}
/* v668 — did this candidate clear every hard check the reviewer marked REQUIRED?
   Read from the reviewer's own required list rather than hardGateFailures: that
   array also carries score-below-85 and model-did-not-pass, so a candidate which
   cleared identity and delta but scored 68 appears failed there. An empty
   required list (establish mode) is vacuously cleared. */
function v668RequiredGatesPassed(review) {
  const source = review && typeof review === "object" ? review : {};
  if (source.reviewUnavailable === true) return false;
  const required = Array.isArray(source.requiredHardChecks) ? source.requiredHardChecks : [];
  const checks = source.hardChecks && typeof source.hardChecks === "object" ? source.hardChecks : {};
  return required.every((key) => checks[key]?.returned === true && checks[key]?.pass === true);
}
/* v668 — the candidate a human can actually act on, which is not always the one
   with the highest score. A validated strong pass is the approval candidate; if
   none exists, the candidate that cleared every required gate and reached
   human-decision is the closest thing the run produced to an approvable
   reference, and a higher-scoring candidate still carrying a failed required
   gate must not hide it. Ranking within a tier is still by score. */
const V668_ACTIONABLE_TIERS = ["validated", "human-decision"];
function v668CandidateTier(candidate) {
  if (candidate?.reviewUnavailable === true) return "";
  if (candidate?.pass === true) return "validated";
  if (candidate?.requiredGatesPassed === true && String(candidate?.outcome || "") === "human-decision") return "human-decision";
  return "";
}
function v668BestActionable(run, stateId) {
  let best = null;
  for (const pass of v666RunPasses(run, stateId)) {
    for (const candidate of pass.candidates || []) {
      const tier = v668CandidateTier(candidate);
      if (!tier) continue;
      const rank = V668_ACTIONABLE_TIERS.indexOf(tier), score = Number(candidate.score || 0);
      if (!best || rank < best.rank || (rank === best.rank && score > best.score)) {
        best = { rank, tier, file: String(candidate.file || ""), score, pass: candidate.pass === true,
          requiredGatesPassed: candidate.requiredGatesPassed === true, outcome: String(candidate.outcome || ""),
          passNumber: Number(pass.passNumber || 0), stepKey: String(pass.stepKey || ""), note: String(candidate.summary || "") };
      }
    }
  }
  if (!best || !best.file) return null;
  const { rank, ...row } = best;
  return row;
}
/* v667 — the champion. Best candidate across every pass of this state, so a
   pass-3 regression can never hide the pass-2 image that scored higher.
   Deliberately still score-ranked: it orders the correction plan, where the
   question is which image is closest to good, not which is approvable. The
   approvable one is v668BestActionable and is recorded alongside it. */
function v666Champion(run, stateId) {
  let best = null;
  for (const pass of v666RunPasses(run, stateId)) {
    for (const candidate of pass.candidates || []) {
      const score = Number(candidate.score || 0);
      if (!best || score > best.score || (score === best.score && candidate.pass && !best.pass)) {
        best = { file: String(candidate.file || ""), score, pass: candidate.pass === true, passNumber: Number(pass.passNumber || 0), stepKey: String(pass.stepKey || ""), note: String(candidate.summary || "") };
      }
    }
  }
  return best && best.file ? best : null;
}
/* The champion's own unresolved faults, by criterion. Correction ordering wants
   these first: they are the shortest distance between the best image the run
   has produced and an approvable one. Recorded plans already say which files
   each finding was seen on, so nothing new has to be stored to answer this. */
function v666ChampionFaultKeys(run, stateId, champion) {
  if (!champion?.file) return [];
  const pass = v666RunPasses(run, stateId).find((row) => Number(row.passNumber) === Number(champion.passNumber));
  return (pass?.correct || []).filter((row) => (row.files || []).includes(champion.file)).map((row) => row.key);
}
function v666RecordChampion(run, stateId, stateName) {
  const champion = v666Champion(run, stateId);
  run.result = run.result && typeof run.result === "object" ? run.result : {};
  const table = run.result.referenceChampions && typeof run.result.referenceChampions === "object" ? run.result.referenceChampions : {};
  if (champion) table[stateId] = { ...champion, stateId, stateName: stateName || "Default" };
  run.result.referenceChampions = table;
  /* v668 — recorded separately so the highest score stays available while the
     candidate a human can act on is the one surfaced for approval. */
  const actionable = v668BestActionable(run, stateId);
  const actionableTable = run.result.referenceActionable && typeof run.result.referenceActionable === "object" ? run.result.referenceActionable : {};
  if (actionable) actionableTable[stateId] = { ...actionable, stateId, stateName: stateName || "Default" };
  run.result.referenceActionable = actionableTable;
  return champion;
}
/* The directive the prompt compiler receives. It is the plan in the compiler's
   own register: what to keep, what to fix, and an explicit refusal to invent
   anything the brief did not already contain. */
function v666CorrectionPlanText(plan, options = {}) {
  /* No generation-correctable finding means there is nothing for a prompt to
     do. Returning "" here is what keeps a workflow prerequisite or a pending
     human decision from being dressed up as a correction and spending money. */
  if (!plan || !plan.correct?.length) return "";
  const list = String(options.list || "");
  const header = `PASS ${plan.passNumber} REVIEW EVIDENCE — ${plan.candidateCount} candidate${plan.candidateCount === 1 ? "" : "s"} reviewed, none approvable (best ${plan.bestScore}/100).`;
  const preserve = plan.preserve.map((item) => `- ${item.label}${item.note ? `: ${item.note}` : ""}`);
  const correct = plan.correct.map((item) => `- ${item.label}${item.note ? `: ${item.note}` : ""} [seen on ${item.candidateCount} of ${plan.candidateCount} candidate${plan.candidateCount === 1 ? "" : "s"}]`);
  const guards = [];
  if (list === "locations") guards.push("Do not redesign or invent a different room. Treat every approved angle as one shared 3D space and solve the requested camera from that same space.");
  if (list === "props") guards.push("Do not replace, redraw, restage, or reinterpret any photograph, mural, artwork, printed material, label, or other content carried by the prop.");
  guards.push("Change only what the CORRECT list names. Do not introduce new wardrobe, age, hair, location, props, mood or story facts that the brief above does not already contain.");
  return [
    header,
    preserve.length ? `\nPRESERVE — already correct, do not change:\n${preserve.join("\n")}` : "",
    correct.length ? `\nCORRECT — why every candidate failed, most recurring first:\n${correct.join("\n")}` : "",
    `\n${guards.join("\n")}`,
  ].filter(Boolean).join("\n");
}
/* One filmmaker-readable line for the run log. Production reasoning, not a trace. */
function v666CorrectionLogLine(plan) {
  const reasons = plan.correct.slice(0, 3).map((item) => item.label).join("; ");
  const blocked = (plan.prerequisites || []).slice(0, 2).map((item) => item.label).join("; ");
  const prerequisiteNote = blocked ? ` Not a generation problem and therefore not retried: ${blocked}.` : "";
  if (!plan.correct.length) {
    return `Pass ${plan.passNumber}: ${plan.candidateCount} candidate${plan.candidateCount === 1 ? "" : "s"} reviewed, best ${plan.bestScore}/100. No generation-correctable fault was found, so no further pass is spent.${prerequisiteNote}`;
  }
  return `Pass ${plan.passNumber}: ${plan.candidateCount} candidate${plan.candidateCount === 1 ? "" : "s"} reviewed, best ${plan.bestScore}/100, none approvable. Recurring: ${reasons}. Pass ${plan.passNumber + 1} will preserve ${plan.preserve.length} confirmed element${plan.preserve.length === 1 ? "" : "s"} and correct ${plan.correct.length} named issue${plan.correct.length === 1 ? "" : "s"}.${prerequisiteNote}`;
}
/* The per-pass ledger the workspace reads. It lives in run.result, which the run
   store already passes through untouched, so this needs no schema of its own. */
function v666RecordPass(run, entry) {
  run.result = run.result && typeof run.result === "object" ? run.result : {};
  const passes = Array.isArray(run.result.referencePasses) ? run.result.referencePasses : [];
  const index = passes.findIndex((row) => row.stateId === entry.stateId && Number(row.passNumber) === Number(entry.passNumber));
  const merged = index >= 0 ? { ...passes[index], ...entry } : entry;
  if (index >= 0) passes[index] = merged; else passes.push(merged);
  run.result.referencePasses = passes.sort((a, b) => String(a.stateId).localeCompare(String(b.stateId)) || Number(a.passNumber) - Number(b.passNumber));
  return merged;
}
function v666RunPasses(run, stateId = "") {
  const passes = Array.isArray(run?.result?.referencePasses) ? run.result.referencePasses : [];
  return stateId ? passes.filter((row) => String(row.stateId) === String(stateId)) : passes;
}
/* What actually changed between two prompts, in the terms the director cares
   about: the correction directive that was injected, and the compiled length. */
function v666PromptDelta(previous, current) {
  const before = String(previous || ""), after = String(current || "");
  if (!before || !after) return { added: [], removed: [], changed: before !== after };
  const beforeLines = new Set(before.split(/\n+/).map((line) => line.trim()).filter(Boolean));
  const afterLines = after.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const added = afterLines.filter((line) => !beforeLines.has(line));
  const afterSet = new Set(afterLines);
  const removed = [...beforeLines].filter((line) => !afterSet.has(line));
  return { added: added.slice(0, 12), removed: removed.slice(0, 12), changed: before !== after };
}

async function v626AutomateEntityState(run, list, entityId, stateId) {
  let entity = P[list]?.find((item) => item.id === entityId), state = entityStateById(entity, stateId);
  /* BATCH 1B: the entity-side twin of the frame reuse rule. An approved file
     with no live human receipt behind it is a historic selection, and reusing it
     would advance the reference chain on machine authority. */
  const entityReuseReceipt = state.approvedFile ? resumeAuthority(P, { kind: "entity-state-approval", list, entityId, stateId }) : null;
  if (run.config.reuseApproved && state.approvedFile && entityReuseReceipt) {
    const key = `entity:${stateId}:reuse`;
    if (v626Step(run, key).status !== "completed") await v626CompleteStep(run, key, { kind: "entity-approval", label: `${state.name || "State"} approved`, stateId, winner: state.approvedFile, result: { reused: true, authorityReceiptId: entityReuseReceipt.id } });
    v628AttachEntityAutomationProvenance(run, list, entityId, stateId, state.approvedFile, key, { reused: true });
    await flushPendingProjectSave();
    return state.approvedFile;
  }
  if (run.config.reuseApproved && state.approvedFile && !entityReuseReceipt) {
    await v626Log(run, `${state.name || "State"} already shows ${state.approvedFile}, but no human approval of it is on record. It is offered for your decision rather than reused as canon.`, "warn");
    const gateStep = v626Step(run, `entity:${stateId}:existing-selection`, "review", `Approve ${state.name || "State"}`);
    Object.assign(gateStep, { stateId, pass: true, winner: state.approvedFile, files: [state.approvedFile], result: { ...(gateStep.result || {}), historicSelection: true, rationale: "This reference was already selected for the state, but no human approval of it is recorded." } });
    await v627PauseForHumanReview(run, gateStep, `Approve ${state.name || "State"}`);
  }
  if (!state.isDefault) {
    /* MB-PT-02 / MB-PT-04: a paid run derives only from a parent the creator
       APPROVED, and only from the parent this state actually records. A missing
       parent is broken lineage and blocks; a historic parent is not canon and
       blocks with the reason the creator can act on. */
    const parent = assetStateParent(entity, state);
    if (!parent) throw new Error(`${state.name || "State"} records a parent state that no longer exists (${state.parentStateId || "none"}). Repair its lineage before generating from it.`);
    const parentStanding = assetStateParentMedia(list, entity, state);
    if (parentStanding.standing !== "canon") {
      throw new Error(parentStanding.file
        ? `${state.name || "State"} derives from ${parent.name || "its parent"}, whose image ${parentStanding.file} has never been approved as canon. Approve it first.`
        : `${state.name || "State"} needs approved parent state ${parent.name || "Default"}`);
    }
    const parentFile = parentStanding.file;
    /* BATCH 1C: AUTOMATION DOES NOT TOUCH LINEAGE AT ALL.
       It used to assign the parent it had just resolved. A state's derivation is
       chosen when the state is created; a run reads it and generates from it. A
       state that declares no parent is a project question for a person, not
       something a run repairs on its way past. */
    state.generationMode = "derive"; dirty(); await flushPendingProjectSave();
  }
  let revision = "";
  const maxRounds = v668EffectiveStateRounds(run);
  for (let round = 1; round <= maxRounds; round++) {
    const reviewKey = `entity:${stateId}:round-${round}:review`, prior = v626Step(run, reviewKey);
    /* The only route to completed + pass + winner is a director approving at the
       human gate, which stamps humanApproved. Resuming after that re-states the
       approval it already made; it never invents one. */
    /* BATCH 1B: the entity-side twin of the frame resume rule — the receipt is
       asked, the stale step result is not, and nothing is re-written. */
    if (prior.status === "completed" && prior.pass && prior.winner) {
      const priorEntityReceipt = resumeAuthority(P, { kind: "entity-state-approval", list, entityId, stateId });
      if (priorEntityReceipt) { await flushPendingProjectSave(); return priorEntityReceipt.value; }
    }
    if (round > 1) revision = v626Step(run, `entity:${stateId}:round-${round - 1}:review`).revision || "";
    const build = await v626EntityBuild(run, list, entityId, stateId, round, revision);
    entity = P[list]?.find((item) => item.id === entityId); state = entityStateById(entity, stateId);
    const genKey = `entity:${stateId}:round-${round}:generate`, genStep = v626Step(run, genKey, "generation", `Generate ${state.name || "state"} candidates · round ${round}`);
    if (genStep.status !== "completed") {
      await v626BeginStep(run, genKey, "generation", `Generate ${v640OutputsPerRequest(run)} ${state.name || "state"} candidates · round ${round}`, { stateId, attempt: round, maxAttempts: v668EffectiveStateRounds(run) });
      /* THE FINAL DISPATCH BOUNDARY RE-DECIDES CANON FOR ITSELF.
       *
       * `derivationMode` was hard-coded to "derive" for any non-default state,
       * so the paid request derived from whatever the parent happened to hold.
       * The build step checks standing, but that check ran earlier — a receipt
       * can be revoked between building a prompt and spending money on it, and a
       * run resumed from a stored step never re-ran it at all.
       *
       * This reads the receipt-backed standing immediately before the request is
       * constructed, through the same one reader every other surface uses. It
       * does not recompute derive from parent presence and it does not trust an
       * earlier decision. */
      const parentInfo = state.isDefault ? null : assetStateParentMedia(list, entity, state);
      const dispatchDerivation = state.isDefault ? null : assetStateDerivation(list, entity, state);
      if (dispatchDerivation && !dispatchDerivation.canDerive && dispatchDerivation.reason === "parent-not-canon") {
        throw new Error(`${state.name || "State"} derives from ${parentInfo?.parent?.name || "its parent"}, whose image ${dispatchDerivation.contextFile} is no longer approved as canon. Approve it before generating from it.`);
      }
      const derivationMode = dispatchDerivation && dispatchDerivation.canDerive ? "derive" : "independent";
      const references = state.isDefault ? [] : entityGenerationReferences(list, entity, { state, mode: derivationMode });
      const prompt = state.isDefault ? build.prompt : entityGenerationPrompt(list, entity, build, references, { state, mode: derivationMode });
      /* THE SIBLING PRODUCER DECLARES THE SAME FACT. This path and
         startFalEntityGeneration() are the two writers that produce an
         entity-reference candidate for a known continuity state; fixing one and
         leaving the other undeclared would make approval work or refuse depending
         on which button started the run. See public/fal-generation.js for why the
         declaration is authored here rather than inferred at ingest. */
      const job = await v626WaitFalJob(run, genStep, { purpose: "entity-reference", entityList: list, entityId, entityType: { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list] || "entity", artifactStructure: "single-reference", continuityStateId: state.id, continuityStateName: state.name || "", parentStateId: parentInfo?.parent?.id || "", parentStateName: parentInfo?.parent?.name || "", parentApprovedFile: dispatchDerivation ? dispatchDerivation.file : "", derivationMode, sourceBuildId: build.id, prompt, references, outputCount: v640OutputsPerRequest(run), quality: v6211RunGenerationSettings(run).frameQuality, resolution: v6211RunGenerationSettings(run).frameResolution, aspectRatio: referenceAspectLabel(list) });
      /* BATCH 1B: THE RUN RECORDS WHAT IT ASKED FOR, ON BEHALF OF WHOM.

         Ownership authority requires a durable claim, and a file CineBraid
         generated for this entity, in a run the director authorised for this
         entity, is claimed by definition — the job named the owner in its own
         request. The server writes the same row at ingest, so in production
         this is idempotent; what it removes is the runtime's dependence on
         that write having landed before the next read. Without it a generated
         candidate is momentarily indistinguishable from a file somebody dropped
         in the folder, which is a distinction that must never rest on timing. */
      v627ClaimGeneratedEntityCandidates(list, entityId, job, { stateId, runId: run.id, stepKey: genKey });
      await v626CompleteStep(run, genKey, { childJobId: job.id, stateId, files: (job.outputs || []).map((item) => item.name), result: { ...(genStep.result || {}), outputs: job.outputs || [], usageCounted: true } });
    }
    entity = P[list]?.find((item) => item.id === entityId); state = entityStateById(entity, stateId);
    /* P4-SEM-C4: identity first, filename second — the same resolution the frame
       reader uses, so an approved reference the rename moved still reads as the
       output of the job that generated it. */
    const currentGen = v626Step(run, genKey), job = await v626FindFalJob(currentGen.childJobId), delivered = jobOutputMatcher(job || { outputs: currentGen.result?.outputs || [] }), media = entityMedia(list, entity).filter(delivered);
    if (!media.length) throw new Error(`${state.name || "State"} candidates are unavailable`);
    if (prior.status !== "completed") {
      await v626BeginStep(run, reviewKey, "review", `Review ${state.name || "state"} candidates · round ${round}`, { stateId, attempt: round, maxAttempts: v668EffectiveStateRounds(run) });
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
      /* Every candidate in the pass feeds the plan, not just the top scorer. A
         fault the weakest two shared is the one most worth correcting, and it
         used to leave no trace at all. */
      const priorChampion = v666Champion(run, stateId);
      const plan = v666PassCorrectionPlan(results, {
        list, state, entity, stateId, passNumber: round, maxPasses: maxRounds,
        championFile: priorChampion?.file || "",
        championFaultKeys: v666ChampionFaultKeys(run, stateId, priorChampion),
      });
      const correction = picked?.review?.pass || reviewUnavailable ? "" : v666CorrectionPlanText(plan, { list });
      await v626CompleteStep(run, reviewKey, { kind: "entity-review", label: `${state.name || "State"} review`, stateId, pass: !!picked?.review?.pass, score: Math.round(+picked?.review?.score || 0), winner: picked?.file || "", files: media.map((item) => item.name), review: { contractVersion: ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION, candidates: results }, revision: correction || (reviewUnavailable ? "" : "Preserve the parent identity more strictly and apply only the requested state delta."), result: { rationale: picked?.review?.summary || "", hardGateFailures: picked?.review?.hardGateFailures || [], recommend: picked?.review?.autoApprove === true, explicitPass: picked?.review?.explicitPass === true, explicitScore: picked?.review?.explicitScore === true, reviewUnavailable, threshold: v640RecommendationScore(run), correctionPlan: plan } });
      /* The pass ledger: what this pass was asked for, what came back, why it
         failed, and what the next pass was told to change. */
      const previousPass = v666RunPasses(run, stateId).find((row) => Number(row.passNumber) === round - 1) || null;
      v666RecordPass(run, {
        stateId, stateName: plan.stateName, passNumber: round, maxPasses: maxRounds, stepKey: reviewKey,
        at: v626Now(), promptBuildId: build.id || "", prompt: String(build.prompt || "").slice(0, 4000),
        promptDelta: previousPass ? v666PromptDelta(previousPass.prompt, build.prompt) : { added: [], removed: [], changed: false },
        appliedRevision: String(revision || ""), candidates: plan.candidates,
        bestScore: plan.bestScore, passed: plan.passed, reviewUnavailable,
        preserve: plan.preserve, correct: plan.correct, recurring: plan.recurring,
        prerequisites: plan.prerequisites, decisions: plan.decisions,
        authorityMode: plan.authorityMode, readyToEstablish: plan.readyToEstablish,
        nextRevision: correction,
      });
      /* Recomputed after the pass is recorded so the champion always reflects
         every pass so far, including this one. */
      v666RecordChampion(run, stateId, state.name || "Default");
      await v626SaveRun(run, false, false);
      if (reviewUnavailable) await v627PauseForHumanReview(run, v626Step(run, reviewKey), `Review ${state.name || "state"} candidates`);
    }
    const reviewed = v626Step(run, reviewKey);
    /* A strong pass stops the loop and spends nothing further, but it does not
       approve. Canon is a director's decision; the reviewer only nominates. */
    if (reviewed.pass && reviewed.winner) {
      await v626Log(run, `${state.name || "State"} pass ${round} produced a strong candidate: ${reviewed.winner} (${Math.round(Number(reviewed.score || 0))}/100). Remaining authorized passes will not be generated. Your approval makes it canon.`, "success");
      /* Re-read the step: saving the log replaced run.steps with the stored copy,
         and pausing a detached object would leave the gate open on disk. */
      await v627PauseForHumanReview(run, v626Step(run, reviewKey), `Approve ${state.name || "state"}`);
    }
    /* v667 — the stop rule. Another paid pass is only ever bought by a fault a
       prompt can actually repair. A missing project prerequisite and a pending
       human decision both end the loop here, with the reason named, rather than
       regenerating an image against a problem that is not in the image. */
    const currentPlan = reviewed.result?.correctionPlan || null;
    if (currentPlan && !currentPlan.generationCorrectable && !reviewed.pass) {
      const prerequisiteRows = currentPlan.prerequisites || [];
      if (prerequisiteRows.length) {
        run.result = run.result && typeof run.result === "object" ? run.result : {};
        run.result.referencePrerequisites = {
          stateId, stateName: state.name || "Default", passNumber: round, at: v626Now(),
          items: prerequisiteRows.map((item) => ({ label: item.label, note: item.note })),
        };
        await v626Log(run, `${state.name || "State"} pass ${round} is blocked by something generation cannot fix: ${prerequisiteRows.map((item) => item.label).join("; ")}. No further pass is spent on it.`, "warn");
      } else if (currentPlan.readyToEstablish) {
        await v626Log(run, `${state.name || "State"} pass ${round} found no generation-correctable fault and no approved authority exists yet. The best candidate is ready to establish the first authority — that is your decision, so nothing further is generated.`, "success");
      } else {
        await v626Log(run, `${state.name || "State"} pass ${round} returned no generation-correctable fault. Another pass would be a guess, so none is spent.`, "warn");
      }
      await v627PauseForHumanReview(run, v626Step(run, reviewKey), `Approve ${state.name || "state"}`);
    }
    if (round >= maxRounds) {
      /* Exhaustion is a distinct outcome, not a generic pause: it names what was
         spent and what kept failing so the next decision is an informed one. The
         best score is the champion's across every pass, never just this one's. */
      const plan = currentPlan;
      const reasons = (plan?.correct || []).slice(0, 3).map((item) => item.label);
      const champion = v666RecordChampion(run, stateId, state.name || "Default");
      run.result = run.result && typeof run.result === "object" ? run.result : {};
      run.result.referenceExhaustion = {
        stateId, stateName: state.name || "Default", passes: round, candidates: Number(run.usage?.imagesGenerated || 0),
        bestScore: Number(champion?.score || plan?.bestScore || reviewed.score || 0),
        bestFile: champion?.file || "", bestPassNumber: Number(champion?.passNumber || round),
        recurring: reasons, at: v626Now(),
      };
      const championNote = champion && Number(champion.passNumber) !== round
        ? ` The best candidate across the whole run is still ${champion.file} from pass ${champion.passNumber} (${champion.score}/100); it is unchanged and still available.`
        : "";
      await v626Log(run, `No ${state.name || "state"} candidate passed after ${round} authorized pass${round === 1 ? "" : "es"} and ${Number(run.usage?.imagesGenerated || 0)} generated candidate${Number(run.usage?.imagesGenerated || 0) === 1 ? "" : "s"}. Recurring: ${reasons.join("; ") || "no structured findings were returned"}. No further pass is authorized.${championNote}`, "warn");
      await v627PauseForHumanReview(run, v626Step(run, reviewKey), `Approve ${state.name || "state"}`);
    }
    await v626Log(run, v666CorrectionLogLine(currentPlan || v666PassCorrectionPlan([], { list, state, entity, stateId, passNumber: round, maxPasses: maxRounds })), "warn");
  }
  throw new Error(`${state.name || "State"} did not pass after ${v668EffectiveStateRounds(run)} rounds`);
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
  /* Captured before the request, exactly as cancelFalGeneration() captures it. */
  const owner = ACTIVE_PROJECT_SLUG;
  const response = await fetch(`/api/generation/fal/jobs/${encodeURIComponent(current.childJobId)}/cancel`, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  /* The SAME result handler as the ordinary cancel button. This route is the same
     route; the two callers must not develop two opinions about what it did. */
  if (response.ok) await applyProjectMutationResult(owner, data);
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
  /* The offer is gated in the markup; the action is gated again here, because a
     continuation reached any other way still spends real credits. */
  if (Number(step.attempt || 0) >= Number(step.maxAttempts || 0)) return toast("Every authorized pass in this run is used. Start a fresh run to authorize more generation.");
  if (v666RemainingImageBudget(run) < v640OutputsPerRequest(run)) return toast(`This run's confirmed ${Number(run.config?.maxImages || 0)}-image cap has no room for another pass. Start a fresh run to authorize more generation.`);
  step.status = "completed";
  step.pass = false;
  run.status = "interrupted";
  run.summary = "Human review requested the next bounded revision round.";
  const saved = await v626SaveRun(run, false);
  v640RunDispatch(saved);
};
/* THE RUN APPROVAL GATE — the one place in automation a person decides.
 *
 * THE CANON WRITE HAPPENS FIRST, SYNCHRONOUSLY, INSIDE THE CLICK.
 *
 * Batch 1D minted a capability here, refreshed the run from the server, and
 * then resolved the candidate and spent the token — the exact "approve target
 * now, decide what was approved later" shape the acceptance audit reproduced by
 * committing CHANGED.png/asset-B against a modal displaying DISPLAYED.png.
 *
 * The order is inverted. `fileName` is the file on the button the person
 * pressed and `cachedRun`/`cachedStep` are the run they are looking at, so the
 * decision is fully known before any I/O: it is committed in the synchronous
 * prologue, against exactly those bytes. Everything after the first `await` is
 * run-ledger bookkeeping, which is not Canon and never was.
 *
 * If the gate has moved on server-side, the person still made a real decision
 * about a real frame; reconciliation is what settles the run. */
window.approveAutomationCandidate = async (runId, stepKey, fileName) => {
  const cachedRun = v626Runs().find((item) => item.id === runId) || null;
  const cachedStep = cachedRun?.steps?.[stepKey] || null;
  if (!cachedStep || cachedStep.status !== "needs-review") return toast("This review gate is no longer active");
  if (!fileName) return toast("Candidate is unavailable");
  /* THE GUARD, NOT A SECOND OPINION ABOUT THE MARKUP. Approving is a statement
     that a person looked at these bytes; if the page cannot resolve them there
     was nothing to look at. Nothing is discarded — the candidate and its review
     stay in the gate, and the recovery action is offered beside it. */
  if (!v670CandidateInspectable(cachedRun, cachedStep, fileName))
    return toast(`${fileName} cannot be displayed for inspection, so it cannot be approved. Sync local folders and try again.`);
  const cachedShotId = cachedRun.type === "scene-chain"
    ? (cachedStep.shotId || cachedStep.result?.targetShotId || "")
    : cachedRun.targetId;
  const cachedList = cachedRun.config?.list || cachedRun.entityList;
  const cachedEntityId = cachedRun.config?.entityId || cachedRun.entityId;
  try {
    if (cachedRun.type === "entity-chain") v626ApproveEntity(cachedList, cachedEntityId, cachedStep.stateId, fileName);
    else if (cachedShotId) v626ApproveFrame(cachedShotId, cachedStep.frameId, fileName);
    else return toast("Correction shot is unavailable");
  } catch (error) {
    return toast(error.message || "That candidate could not be approved");
  }
  const run = await v626RefreshRun(runId, false), step = run.steps?.[stepKey];
  if (!step) return toast("This review gate is no longer active");
  const candidates = v627ReviewCandidates(run, step), candidate = candidates.find((item) => item.file === fileName) || { score: 0, note: "" };
  if (run.type === "shot-chain" || run.type === "scene-chain") {
    const shotId = cachedShotId;
    const frame = frameById(shotById(shotId), step.frameId);
    const approvalKey = run.type === "scene-chain" ? `scene-correction:${shotId}:${step.frameId}:approval` : `frame:${step.frameId}:approval`;
    run.steps[approvalKey] = { key: approvalKey, kind: "frame-approval", label: `Frame ${frame?.label || step.frameId} approved by director`, status: "completed", shotId, frameId: step.frameId, winner: fileName, score: candidate.score, pass: true, result: { humanApproved: true, targetShotId: shotId, rationale: candidate.note || "Director-selected candidate" }, completedAt: v626Now(), updatedAt: v626Now() };
    v628AttachShotAutomationProvenance(run, step.frameId, fileName, approvalKey, { shotId, score: candidate.score, humanApproved: true });
  } else {
    const list = cachedList, entityId = cachedEntityId;
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
  /* Same cross-panel rule as every other one: the bounded workspace renders one task,
     so the handoff selects it rather than only marking the legacy panel open. */
  const shot = shotById(shotId); keepGuidedPanelOpen(shot, "motion"); selectGuidedPanelTask(shot, "motion"); route();
  setTimeout(() => document.querySelector('[data-guided-panel="motion"]')?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 80);
};

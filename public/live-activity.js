/* CineBraid v6.6.0.2 — live activity and accessible drawer behavior. */
const V641_ACTIVITY_REFRESH_MS = 3500;
let V641_ACTIVITY_DRAWER_OPEN = false;
let V641_ACTIVITY_REFRESHING = false;
let V641_ACTIVITY_TIMER = null;
let V641_ACTIVITY_TRIGGER = null;
const V641_MANUAL_ACTIVITIES = new Map();

function v641SelectorValue(value) { return String(value || "").replace(/["\\]/g, "\\$&"); }
function v641RunById(id) {
  return (Array.isArray(AUTOMATION_RUNS) ? AUTOMATION_RUNS : []).find((run) => run.id === id) || null;
}
function v641StepSystem(step) {
  const kind = String(step?.kind || "task");
  const explicit = step?.activity?.system || step?.result?.activity?.system;
  if (explicit) return explicit;
  return {
    prompt: "LOCAL AI · PROMPT ADVISOR",
    generation: "FAL · GPT IMAGE 2",
    review: "VISION AI · CANDIDATE REVIEW",
    "frame-review": "VISION AI · FRAME REVIEW",
    "entity-review": "VISION AI · REFERENCE REVIEW",
    "scene-review": "VISION AI · SCENE CONTINUITY",
    "scene-correction-review": "VISION AI · SCENE CORRECTION",
    "frame-approval": "CINEBRAID · APPROVAL",
    "entity-approval": "CINEBRAID · APPROVAL",
    "blocking-approval": "CINEBRAID · GUIDE APPROVAL",
    "scene-shot": "CINEBRAID · CHILD SHOT RUN",
    "scene-correction": "CINEBRAID · SCENE CORRECTION",
  }[kind] || "CINEBRAID · RUNNER";
}
function v641StepState(step) {
  const state = step?.activity?.state || step?.result?.activity?.state;
  if (state) return state;
  return step?.status === "running" ? "working" : step?.status || "pending";
}
function v641StepDetail(step, run) {
  const activity = step?.activity || step?.result?.activity || {};
  if (activity.detail) return activity.detail;
  if (step?.error) return step.error;
  if (step?.kind === "generation" && step?.childJobId) return "Provider request accepted; waiting for status updates.";
  if (step?.kind?.includes("review")) return "Comparing returned candidates against the approved production authorities.";
  if (step?.kind === "prompt") return "Building and improving the production prompt.";
  if (step?.kind === "scene-shot") return "Running the selected shot as a durable child automation.";
  return run?.summary || "Automation work is in progress.";
}
function v641CurrentStep(run) {
  const direct = run?.steps?.[run?.current?.stepKey || ""];
  if (direct) return direct;
  return Object.values(run?.steps || {}).find((step) => step.status === "running")
    || Object.values(run?.steps || {}).find((step) => step.status === "needs-review")
    || null;
}
function v641ChildRunForStep(step) {
  const id = step?.result?.childRunId || step?.childRunId || "";
  return id ? v641RunById(id) : null;
}
function v641DisplayedRunAndStep(run) {
  const parentStep = v641CurrentStep(run);
  const child = run?.type === "scene-chain" ? v641ChildRunForStep(parentStep) : null;
  const childStep = child ? v641CurrentStep(child) : null;
  return childStep ? { displayRun: child, step: childStep, parentStep, child } : { displayRun: run, step: parentStep, parentStep: null, child: null };
}
function v641FalJobForStep(step) {
  const id = step?.childJobId || step?.result?.childJobId || "";
  return id ? (FAL_GENERATION_JOBS || []).find((job) => job.id === id) || null : null;
}
function v641ElapsedLabel(startedAt, completedAt = "") {
  const start = Date.parse(startedAt || "");
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const total = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(total / 60), seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function v641StatusTone(status) {
  return status === "completed" || status === "skipped" ? "done"
    : status === "failed" ? "failed"
    : status === "needs-review" || status === "awaiting-review" ? "review"
    : status === "running" ? "active" : "pending";
}
function v641ProviderMarkup(step) {
  const job = v641FalJobForStep(step);
  const activity = step?.activity || step?.result?.activity || {};
  if (!job && !activity.providerAccepted && !step?.childJobId) return "";
  const status = job?.status || activity.providerStatus || "PREPARING";
  const queue = job?.queuePosition != null ? ` · queue ${job.queuePosition}` : "";
  const model = job?.model || activity.model || "GPT Image 2";
  const settings = [activity.resolution, activity.quality, activity.outputCount ? `${activity.outputCount} candidates` : ""].filter(Boolean).join(" · ");
  const requestId = job?.providerRequestId || job?.requestId || activity.providerRequestId || "";
  return `<div class="automation-live-provider"><span>${activity.providerAccepted || job ? "PAID REQUEST ACCEPTED" : "PREPARING · NO CREDITS SUBMITTED"}</span><b>${esc(model)} · ${esc(String(status).replace(/_/g, " "))}${esc(queue)}</b>${settings ? `<small>${esc(settings)}</small>` : ""}${requestId ? `<code>${esc(requestId)}</code>` : ""}</div>`;
}
function v641ReviewProgressMarkup(step) {
  const progress = step?.activity?.reviewProgress || step?.result?.activity?.reviewProgress || step?.result?.reviewProgress || null;
  const reviews = Array.isArray(progress?.items) ? progress.items : [];
  const finalRows = Array.isArray(step?.review?.reviews) ? step.review.reviews : [];
  const files = step?.files || [];
  const rows = reviews.length ? reviews : finalRows.map((row) => ({ file: files[Number(row.n) - 1] || `Candidate ${row.n}`, status: "completed", score: row.score, pass: row.pass, note: row.notes }));
  if (!rows.length && !progress) return "";
  const total = Number(progress?.total || rows.length || files.length || 0);
  const current = Number(progress?.current || rows.filter((row) => row.status === "completed").length || 0);
  return `<div class="automation-live-reviews"><header><b>Candidate review</b><span>${current}${total ? ` / ${total}` : ""}</span></header>${rows.map((row, index) => `<article class="state-${attr(row.status || "pending")}"><i>${row.status === "completed" ? "✓" : row.status === "reviewing" ? '<span class="spin">◌</span>' : "○"}</i><div><b>${esc(row.file || `Candidate ${index + 1}`)}</b><small>${row.status === "completed" ? `${Math.round(Number(row.score || 0))}/100 · ${row.pass ? "pass" : "flagged"}` : row.status === "reviewing" ? "Reviewing in scene context…" : "Pending"}</small>${row.note ? `<p>${esc(row.note)}</p>` : ""}</div></article>`).join("")}</div>`;
}
function v641ReturnedThumbnails(step) {
  const files = step?.files || [];
  if (!files.length) return "";
  const shotId = step?.shotId || step?.result?.targetShotId || "";
  const rows = shotId ? takesFor(shotId).filter((take) => files.includes(take.name)) : [];
  if (!rows.length) return `<div class="automation-live-returned"><span>${files.length} returned file${files.length === 1 ? "" : "s"}</span></div>`;
  return `<div class="automation-live-returned"><span>RETURNED CANDIDATES</span><div>${rows.map((take) => `<figure><img src="${attr(take.url)}" alt="${attr(take.name)}"><figcaption>${esc(take.name)}</figcaption></figure>`).join("")}</div></div>`;
}
function v641CurrentOperationMarkup(run) {
  if (!run) return "";
  const { displayRun, step, parentStep, child } = v641DisplayedRunAndStep(run);
  if (!step) return `<section class="automation-live-current state-${attr(v641StatusTone(run.status))}"><header><span>CURRENT OPERATION</span><b>${esc(run.stage || v626StatusLabel(run))}</b></header><p>${esc(run.summary || "No operation is active right now.")}</p></section>`;
  const tone = v641StatusTone(step.status);
  const activity = step.activity || step.result?.activity || {};
  const attempt = Number(step.attempt || 0), max = Number(step.maxAttempts || 0);
  const elapsed = v641ElapsedLabel(step.startedAt, step.completedAt);
  const phase = [attempt ? `attempt ${attempt}${max ? ` of ${max}` : ""}` : "", elapsed ? `${elapsed} elapsed` : ""].filter(Boolean).join(" · ");
  return `<section class="automation-live-current state-${attr(tone)}"><header><div><span>${esc(v641StepSystem(step))}</span><b>${esc(step.label || displayRun.stage || step.key)}</b>${parentStep && child ? `<small>${esc(run.label || run.targetId)} → ${esc(child.label || child.targetId)}</small>` : ""}</div><i>${tone === "active" ? '<span class="spin">◌</span>' : tone === "done" ? "✓" : tone === "failed" ? "!" : tone === "review" ? "!" : "○"}</i></header><p>${esc(v641StepDetail(step, displayRun))}</p><div class="automation-live-meta"><span>${esc(String(v641StepState(step)).replace(/-/g, " "))}</span>${phase ? `<span>${esc(phase)}</span>` : ""}${activity.model && step.kind !== "generation" ? `<span>${esc(activity.model)}</span>` : ""}</div>${v641ProviderMarkup(step)}${v641ReviewProgressMarkup(step)}${v641ReturnedThumbnails(step)}</section>`;
}
function v641StepTimelineRow(step, run, nested = false) {
  const tone = v641StatusTone(step.status), elapsed = v641ElapsedLabel(step.startedAt, step.completedAt);
  const activity = step.activity || step.result?.activity || {};
  const detail = activity.detail || (step.error ? step.error : "");
  const provider = step.kind === "generation" ? v641FalJobForStep(step) : null;
  return `<article class="automation-live-step ${tone} ${nested ? "nested" : ""}"><i>${tone === "done" ? "✓" : tone === "active" ? '<span class="spin">◌</span>' : tone === "failed" ? "×" : tone === "review" ? "!" : "○"}</i><div><b>${esc(step.label || step.key)}</b><span>${esc(v641StepSystem(step))}${Number(step.attempt || 0) ? ` · attempt ${Number(step.attempt)}${Number(step.maxAttempts || 0) ? `/${Number(step.maxAttempts)}` : ""}` : ""}${elapsed ? ` · ${elapsed}` : ""}</span>${detail ? `<small>${esc(detail)}</small>` : ""}${provider ? `<small>${esc(provider.model || "GPT Image 2")} · ${esc(String(provider.status || "queued").replace(/_/g, " "))}${provider.queuePosition != null ? ` · queue ${provider.queuePosition}` : ""}</small>` : ""}</div><em>${tone === "active" ? "WORKING" : tone === "review" ? "APPROVAL" : tone.toUpperCase()}</em></article>`;
}
function v641TimelineMarkup(run) {
  const steps = Object.values(run?.steps || {}).sort((a, b) => String(a.startedAt || a.updatedAt || "").localeCompare(String(b.startedAt || b.updatedAt || "")));
  if (!steps.length) return `<div class="automation-console-empty"><b>Run plan ready</b><span>Prompt, provider, review, and approval operations will appear here.</span></div>`;
  return `<div class="automation-live-timeline">${steps.map((step) => {
    const child = run.type === "scene-chain" ? v641ChildRunForStep(step) : null;
    const childSteps = child ? Object.values(child.steps || {}).sort((a, b) => String(a.startedAt || a.updatedAt || "").localeCompare(String(b.startedAt || b.updatedAt || ""))) : [];
    return `${v641StepTimelineRow(step, run)}${childSteps.length ? `<div class="automation-live-child"><header><span>${esc(child.label || child.targetId)}</span><b>${esc(v626StatusLabel(child))}</b></header>${childSteps.map((row) => v641StepTimelineRow(row, child, true)).join("")}</div>` : ""}`;
  }).join("")}</div>`;
}
window.v641LiveActivityMarkup = (run) => {
  if (!run) return "";
  return `<section class="automation-live-activity" data-automation-live-run="${attr(run.id)}"><div class="automation-live-heading"><div><span>LIVE AUTOMATION ACTIVITY</span><b>Every AI, provider, review, and approval operation</b></div><button class="chip" onclick="openGlobalAutomationActivity('${attr(run.id)}')">OPEN ACTIVITY DRAWER</button></div>${v641CurrentOperationMarkup(run)}<details class="automation-live-details" open><summary>Detailed timeline <span>${Object.keys(run.steps || {}).length}</span></summary>${v641TimelineMarkup(run)}</details></section>`;
};
window.v641StartManualActivity = (system, title, detail = "", meta = {}) => {
  const id = `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  V641_MANUAL_ACTIVITIES.set(id, { id, system, title, detail, meta, status: "running", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  v641UpdateActivityButton(); if (V641_ACTIVITY_DRAWER_OPEN) v641RenderActivityDrawer();
  return id;
};
window.v641UpdateManualActivity = (id, patch = {}) => {
  const row = V641_MANUAL_ACTIVITIES.get(id); if (!row) return;
  Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  v641UpdateActivityButton(); if (V641_ACTIVITY_DRAWER_OPEN) v641RenderActivityDrawer();
};
/* A finished row stays in the drawer for ten minutes so the user can still read what
   happened, then removes itself. The pending timer is tracked per activity so finishing the
   same activity twice replaces it instead of stacking a second one, and it is unref'd where
   the host supports that. A ref'd timer keeps Node's event loop alive, which is why a
   completed headless run used to sit for the full ten minutes before exiting; browsers
   return a plain numeric id with no unref, so drawer behaviour is unchanged there. */
const V641_MANUAL_RETENTION_MS = 10 * 60_000;
const V641_MANUAL_RETENTION_TIMERS = new Map();
function v641ClearManualRetention(id) {
  const pending = V641_MANUAL_RETENTION_TIMERS.get(id);
  if (pending === undefined) return;
  clearTimeout(pending);
  V641_MANUAL_RETENTION_TIMERS.delete(id);
}
function v641ScheduleManualRetention(id) {
  v641ClearManualRetention(id);
  const timer = setTimeout(() => {
    V641_MANUAL_RETENTION_TIMERS.delete(id);
    V641_MANUAL_ACTIVITIES.delete(id);
    v641UpdateActivityButton();
    if (V641_ACTIVITY_DRAWER_OPEN) v641RenderActivityDrawer();
  }, V641_MANUAL_RETENTION_MS);
  if (timer && typeof timer.unref === "function") timer.unref();
  V641_MANUAL_RETENTION_TIMERS.set(id, timer);
}
window.v641FinishManualActivity = (id, status = "completed", detail = "") => {
  const row = V641_MANUAL_ACTIVITIES.get(id); if (!row) return;
  Object.assign(row, { status, detail: detail || row.detail, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  v641UpdateActivityButton(); if (V641_ACTIVITY_DRAWER_OPEN) v641RenderActivityDrawer();
  v641ScheduleManualRetention(id);
};
function v641ManualActivityMarkup(row) {
  return `<article class="automation-drawer-run manual state-${attr(v641StatusTone(row.status))}"><header><div><span>${esc(row.system || "CINEBRAID ACTIVITY")}</span><b>${esc(row.title || "Manual operation")}</b></div><i>${row.status === "running" ? '<span class="spin">◌</span>' : row.status === "completed" ? "✓" : "!"}</i></header><p>${esc(row.detail || "Working…")}</p><small>${esc(v641ElapsedLabel(row.startedAt, row.completedAt || ""))} elapsed</small></article>`;
}
function v641StandaloneFalJobs() {
  const runJobIds = new Set((AUTOMATION_RUNS || []).flatMap((run) => Object.values(run.steps || {}).map((step) => step.childJobId).filter(Boolean)));
  return (FAL_GENERATION_JOBS || []).filter((job) => falJobActive(job) && !runJobIds.has(job.id));
}
function v641StandaloneFalMarkup(job) {
  return `<article class="automation-drawer-run state-active"><header><div><span>FAL · GPT IMAGE 2</span><b>${esc(job.purpose || "Manual image generation")}</b></div><i><span class="spin">◌</span></i></header><p>${esc(String(job.status || "working").replace(/_/g, " "))}${job.queuePosition != null ? ` · queue ${job.queuePosition}` : ""}</p><small>${esc(job.model || "GPT Image 2")} · ${Number(job.outputCount || 0)} candidate${Number(job.outputCount || 0) === 1 ? "" : "s"}</small></article>`;
}
function v641RunRoute(run) {
  if (run?.type === "scene-chain") return `#/scene/${run.targetId}`;
  if (run?.type === "shot-chain") return `#/shot/${run.targetId}`;
  if (run?.type === "entity-chain") {
    const [list, id] = String(run.targetId || "").split(":");
    const route = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list] || "library";
    return `#/${route}/${id || ""}`;
  }
  return "#/production";
}
function v641DrawerRunMarkup(run, duplicateCount = 1) {
  const { displayRun, step, child } = v641DisplayedRunAndStep(run);
  const active = run.status === "running" || run.status === "awaiting-review";
  const failed = Object.values(run.steps || {}).find((item) => item.status === "failed") || null;
  const repairable = run.status === "failed" && run.type === "scene-chain" && (failed?.kind === "generation" || String(failed?.key || "").includes("scene-correction"));
  const primary = repairable
    ? `<button class="approve-btn" onclick="retryFailedAutomationStep('${attr(run.id)}','${attr(failed.key)}')">REPAIR & RETRY</button>`
    : run.status === "failed" && failed
      ? `<button onclick="retryFailedAutomationStep('${attr(run.id)}','${attr(failed.key)}')">RETRY</button>`
      : `<button onclick="closeGlobalAutomationActivity();location.hash='${attr(v641RunRoute(run))}'">OPEN WORKSPACE</button>`;
  return `<article class="automation-drawer-run state-${attr(v641StatusTone(run.status))}" data-run-id="${attr(run.id)}"><header><div><span>${esc(run.type.replace(/-/g, " ").toUpperCase())}</span><b>${esc(run.label || run.targetId)}${duplicateCount > 1 ? ` <em class="automation-duplicate-count">×${duplicateCount}</em>` : ""}</b></div><i>${active ? '<span class="spin">◌</span>' : run.status === "completed" ? "✓" : run.status === "failed" ? "!" : "○"}</i></header><p>${esc(step ? `${v641StepSystem(step)} · ${step.label || displayRun.stage}` : run.stage || run.summary || v626StatusLabel(run))}</p>${failed?.error ? `<small class="automation-drawer-error">${esc(failed.error)}</small>` : child ? `<small>Child run: ${esc(child.label || child.targetId)}</small>` : ""}<footer>${primary}<button onclick="closeGlobalAutomationActivity();openAutomationReport('${attr(run.id)}')">VIEW REPORT</button>${["failed","interrupted","cancelled"].includes(run.status) ? `<button class="ghost-btn" onclick="dismissAutomationActivityRun('${attr(run.id)}')">DISMISS</button>` : ""}</footer></article>`;
}
function v641ActiveAndRecentRuns() {
  const runs = [...(AUTOMATION_RUNS || [])].filter((run) => run.status !== "archived");
  return runs.sort((a, b) => {
    const activeA = ["running", "awaiting-review"].includes(a.status) ? 1 : 0;
    const activeB = ["running", "awaiting-review"].includes(b.status) ? 1 : 0;
    return activeB - activeA || String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
  }).slice(0, 12);
}
function v641GroupAttentionRuns(runs) {
  const groups = new Map();
  for (const run of runs) {
    const failed = Object.values(run.steps || {}).find((item) => item.status === "failed") || {};
    const key = [run.type, run.targetId, failed.kind || "", failed.error || run.summary || run.stage || ""].join("|");
    const group = groups.get(key) || { run, count: 0 };
    group.count += 1;
    if (String(run.updatedAt || run.createdAt || "") > String(group.run.updatedAt || group.run.createdAt || "")) group.run = run;
    groups.set(key, group);
  }
  return [...groups.values()];
}
function v6602EnsureActivityBackdrop() {
  let backdrop = document.getElementById("automation-activity-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("button");
    backdrop.id = "automation-activity-backdrop";
    backdrop.type = "button";
    backdrop.className = "automation-activity-backdrop";
    backdrop.setAttribute("aria-label", "Close activity drawer");
    backdrop.onclick = () => closeGlobalAutomationActivity();
    document.body.appendChild(backdrop);
  }
  backdrop.hidden = !V641_ACTIVITY_DRAWER_OPEN;
  return backdrop;
}
function v6602ActivityStatus() {
  const runs = Array.isArray(AUTOMATION_RUNS) ? AUTOMATION_RUNS : [];
  const activeRuns = runs.filter((run) => ["running", "awaiting-review"].includes(run.status));
  const activeManual = [...V641_MANUAL_ACTIVITIES.values()].filter((row) => row.status === "running");
  const activeFal = v641StandaloneFalJobs();
  const attention = runs.filter((run) => ["failed", "interrupted", "cancelled"].includes(run.status));
  const count = activeRuns.length + activeManual.length + activeFal.length;
  if (count) return { tone: "active", label: `Activity · ${count} active`, detail: activeManual[0]?.title || activeFal[0]?.purpose || activeRuns[0]?.stage || "Working" };
  if (attention.length) return { tone: "attention", label: `Activity · ${attention.length} need attention`, detail: "Open activity" };
  return { tone: "idle", label: "Activity · Idle", detail: "No active operation" };
}
window.dismissAutomationActivityRun = async (runId) => {
  const response = await fetch(`/api/automation/runs/${encodeURIComponent(runId)}/archive`, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return toast(data.error || "Could not dismiss this alert");
  const index = (AUTOMATION_RUNS || []).findIndex((run) => run.id === runId);
  if (index >= 0) AUTOMATION_RUNS[index] = data.run;
  v641UpdateActivityButton();
  v641RenderActivityDrawer();
  toast("Alert dismissed. The run remains available in Reports.");
};
window.archivePreviousAutomationFailures = async () => {
  const ids = (AUTOMATION_RUNS || []).filter((run) => ["failed", "interrupted", "cancelled"].includes(run.status)).map((run) => run.id);
  if (!ids.length) return toast("No previous automation alerts to dismiss");
  const apply = async () => {
    let archived = 0;
    for (const id of ids) {
      const response = await fetch(`/api/automation/runs/${encodeURIComponent(id)}/archive`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) continue;
      const index = (AUTOMATION_RUNS || []).findIndex((run) => run.id === id);
      if (index >= 0) AUTOMATION_RUNS[index] = data.run;
      archived += 1;
    }
    v641UpdateActivityButton();
    v641RenderActivityDrawer();
    toast(`${archived} previous alert${archived === 1 ? "" : "s"} archived. Reports are unchanged.`);
  };
  if (typeof confirmModal === "function") return confirmModal(`Dismiss ${ids.length} previous automation alert${ids.length === 1 ? "" : "s"}?`, apply, { title: "Clear previous alerts", confirmLabel: "DISMISS ALERTS", body: "This removes them from Global Activity but keeps every run and diagnostic in Reports." });
  await apply();
};
function v641RenderActivityDrawer(focusRunId = "") {
  const drawer = document.getElementById("automation-activity-drawer");
  if (!drawer) return;
  const runs = v641ActiveAndRecentRuns();
  const manual = [...V641_MANUAL_ACTIVITIES.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const standaloneFal = v641StandaloneFalJobs();
  const activeRuns = runs.filter((run) => ["running", "awaiting-review"].includes(run.status));
  const attentionRuns = runs.filter((run) => ["failed", "interrupted", "cancelled"].includes(run.status));
  const attentionGroups = v641GroupAttentionRuns(attentionRuns);
  const completedRuns = runs.filter((run) => run.status === "completed");
  const activeManual = manual.filter((row) => row.status === "running");
  const recentManual = manual.filter((row) => row.status !== "running");
  const activeCount = activeRuns.length + activeManual.length + standaloneFal.length;
  const section = (title, rows, empty = "") => `<section class="automation-drawer-section"><header><b>${esc(title)}</b><span>${rows.length}</span></header>${rows.join("") || (empty ? `<div class="automation-console-empty"><span>${esc(empty)}</span></div>` : "")}</section>`;
  const content = [
    section("ACTIVE NOW", [...activeManual.map(v641ManualActivityMarkup), ...standaloneFal.map(v641StandaloneFalMarkup), ...activeRuns.map(v641DrawerRunMarkup)], "No operation is currently running."),
    section("PREVIOUS FAILURES / NEEDS ATTENTION", [...recentManual.filter((row) => row.status === "failed").map(v641ManualActivityMarkup), ...attentionGroups.map((group) => v641DrawerRunMarkup(group.run, group.count))], "No blocked or failed work."),
    section("RECENT COMPLETED", [...recentManual.filter((row) => row.status === "completed").map(v641ManualActivityMarkup), ...completedRuns.map(v641DrawerRunMarkup)].slice(0, 12), "No completed activity yet."),
  ].join("");
  drawer.innerHTML = `<div class="automation-drawer-shell"><header><div><span>GLOBAL ACTIVITY</span><h2>${activeCount ? `${activeCount} operation${activeCount === 1 ? "" : "s"} active` : attentionRuns.length ? `${attentionRuns.length} previous attempt${attentionRuns.length === 1 ? "" : "s"} need attention` : "No active operation"}</h2><p>Every live local-AI call, paid request, review, retry, approval, and recovery action remains visible from any workspace. Detailed diagnostics live in Reports.</p></div><div class="automation-drawer-header-actions">${attentionRuns.length ? `<button class="ghost-btn" onclick="archivePreviousAutomationFailures()">DISMISS PREVIOUS ALERTS</button>` : ""}<button class="cancel" onclick="closeGlobalAutomationActivity()">Close</button></div></header><div class="automation-drawer-list">${content}</div></div>`;
  drawer.classList.toggle("open", V641_ACTIVITY_DRAWER_OPEN);
  drawer.setAttribute("aria-hidden", V641_ACTIVITY_DRAWER_OPEN ? "false" : "true");
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  v6602EnsureActivityBackdrop();
  if (focusRunId) setTimeout(() => drawer.querySelector(`[data-run-id="${v641SelectorValue(focusRunId)}"]`)?.scrollIntoView({ block: "center" }), 20);
}
function v642EnsureGlobalActivityStrip() {
  let strip = document.getElementById("automation-global-live-strip");
  if (!strip) {
    strip = document.createElement("button");
    strip.id = "automation-global-live-strip";
    strip.type = "button";
    strip.onclick = () => openGlobalAutomationActivity();
    strip.setAttribute("aria-label", "Open live activity");
    strip.setAttribute("aria-live", "polite");
    const workspace = document.getElementById("workspace");
    const main = document.getElementById("main");
    if (workspace && main && typeof workspace.insertBefore === "function") workspace.insertBefore(strip, main);
    else document.body.appendChild(strip);
  }
  return strip;
}
function v642UpdateGlobalActivityStrip() {
  const strip = v642EnsureGlobalActivityStrip();
  const status = v6602ActivityStatus();
  const visible = status.tone !== "idle";
  strip.hidden = !visible;
  strip.className = `state-${status.tone}`;
  strip.innerHTML = visible ? `${status.tone === "active" ? '<i class="spin">◌</i>' : '<i>!</i>'}<span><b>${esc(status.label)}</b><small>${esc(status.detail)}</small></span><em>OPEN</em>` : "";
  strip.setAttribute("aria-label", visible ? status.label : "No active operation");
}

function v641UpdateActivityButton() {
  const button = document.getElementById("automation-activity-toggle");
  if (!button) return;
  const activeRuns = (AUTOMATION_RUNS || []).filter((run) => ["running", "awaiting-review"].includes(run.status));
  const activeManual = [...V641_MANUAL_ACTIVITIES.values()].filter((row) => row.status === "running");
  const activeFal = v641StandaloneFalJobs();
  const count = activeRuns.length + activeManual.length + activeFal.length;
  const activeStep = activeRuns.map((run) => v641DisplayedRunAndStep(run).step).find(Boolean);
  const detail = activeManual[0]?.system || (activeFal[0] ? "FAL Image Generation" : activeStep ? v641StepSystem(activeStep).replace(/^.*·\s*/, "") : "");
  button.classList.toggle("active", count > 0);
  const status = v6602ActivityStatus();
  button.innerHTML = `<span>${count ? '<i class="spin">◌</i>' : "◉"}</span><b>${esc(status.label.replace("Activity · ", ""))}</b>${detail ? `<small>${esc(detail)}</small>` : ""}`;
  button.title = status.label;
  v642UpdateGlobalActivityStrip();
}
window.refreshGlobalAutomationActivity = async (force = false) => {
  if (V641_ACTIVITY_REFRESHING) return;
  const activeExists = (AUTOMATION_RUNS || []).some((run) => ["running", "awaiting-review"].includes(run.status));
  if (!force && !V641_ACTIVITY_DRAWER_OPEN && !activeExists) return;
  V641_ACTIVITY_REFRESHING = true;
  try {
    const [runData, falData] = await Promise.all([
      fetch("/api/automation/runs").then((response) => response.ok ? response.json() : { runs: AUTOMATION_RUNS || [] }),
      fetch("/api/generation/fal/jobs").then((response) => response.ok ? response.json() : { jobs: FAL_GENERATION_JOBS || [] }),
    ]);
    AUTOMATION_RUNS = runData.runs || AUTOMATION_RUNS || [];
    FAL_GENERATION_JOBS = falData.jobs || FAL_GENERATION_JOBS || [];
  } catch {}
  finally {
    V641_ACTIVITY_REFRESHING = false;
    v641UpdateActivityButton();
    if (V641_ACTIVITY_DRAWER_OPEN) v641RenderActivityDrawer();
    document.querySelectorAll("[data-automation-live-run]").forEach((node) => {
      const run = v641RunById(node.dataset.automationLiveRun);
      if (run) node.outerHTML = v641LiveActivityMarkup(run);
    });
  }
};
window.v641NotifyAutomationActivity = (run) => {
  if (run) {
    const node = document.querySelector(`[data-automation-live-run="${v641SelectorValue(run.id)}"]`);
    if (node) node.outerHTML = v641LiveActivityMarkup(run);
  }
  v641UpdateActivityButton();
  if (V641_ACTIVITY_DRAWER_OPEN) v641RenderActivityDrawer();
};
window.openGlobalAutomationActivity = (focusRunId = "") => {
  V641_ACTIVITY_TRIGGER = document.activeElement;
  V641_ACTIVITY_DRAWER_OPEN = true;
  document.body.classList.add("automation-activity-open");
  v641RenderActivityDrawer(focusRunId);
  const closeButton = document.querySelector("#automation-activity-drawer .cancel");
  closeButton?.focus?.();
  refreshGlobalAutomationActivity(true);
};
window.closeGlobalAutomationActivity = () => {
  V641_ACTIVITY_DRAWER_OPEN = false;
  document.body.classList.remove("automation-activity-open");
  v641RenderActivityDrawer();
  const trigger = V641_ACTIVITY_TRIGGER;
  V641_ACTIVITY_TRIGGER = null;
  if (trigger && typeof trigger.focus === "function") setTimeout(() => trigger.focus(), 0);
};
function v641TickElapsedLabels() {
  document.querySelectorAll("[data-live-start]").forEach((node) => { node.textContent = v641ElapsedLabel(node.dataset.liveStart, node.dataset.liveEnd || ""); });
}

function v642ActivityDescriptor(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const path = typeof url === "string" ? url : String(url?.url || "");
  if (method === "POST" && path.includes("/api/generation/fal/jobs") && !/\/refresh|\/cancel/.test(path)) return { system: "FAL · GPT IMAGE 2", title: "Submit image generation", detail: "Preparing and submitting an image-generation request. CineBraid will distinguish preparation from provider acceptance as soon as the job record is returned." };
  if (method === "POST" && path.includes("/api/prompt/critique")) return { system: "LOCAL AI · PROMPT CRITIC", title: "Review production prompt", detail: "Sending the prompt, profile rules, and reference roles to the configured local AI for model-specific critique." };
  if (method === "POST" && path.includes("/api/llm/")) {
    const review = path.includes("review");
    const audio = path.includes("audio-prompts");
    const system = audio ? "LOCAL AI · AUDIO PROMPT BUILDER" : review ? "VISION AI · REVIEW" : "LOCAL AI · ASSISTANT";
    const title = audio ? "Build scene audio prompts" : review ? "Run visual review" : "Run assistant task";
    return { system, title, detail: review ? "Preparing production context and waiting for the configured vision model." : "Preparing production context and waiting for the configured local AI." };
  }
  return null;
}
function v642InstallUniversalActivityFetch() {
  if (window.__cinebraidActivityFetchInstalled || typeof window.fetch !== "function") return;
  window.__cinebraidActivityFetchInstalled = true;
  const original = window.fetch.bind(window);
  window.__cinebraidOriginalFetch = original;
  window.fetch = async (url, options = {}) => {
    const descriptor = options?.cinebraidActivity === false ? null : v642ActivityDescriptor(url, options);
    let activityId = "";
    if (descriptor) {
      const recent = [...V641_MANUAL_ACTIVITIES.values()].find((row) => row.status === "running" && row.system === descriptor.system && Date.now() - Date.parse(row.startedAt || 0) < 1500);
      if (!recent) activityId = v641StartManualActivity(descriptor.system, descriptor.title, descriptor.detail, { url: String(url), route: location.hash });
    }
    try {
      const response = await original(url, options);
      if (activityId) {
        const ok = response.ok;
        let detail = ok ? "The request completed and CineBraid received a response." : `The request returned HTTP ${response.status}.`;
        if (!ok) {
          try {
            const data = await response.clone().json();
            if (data?.error) detail = `${data.error}${String(url).includes("/api/generation/fal/jobs") ? " No paid request was accepted." : ""}`;
          } catch {}
        }
        v641FinishManualActivity(activityId, ok ? "completed" : "failed", detail);
      }
      return response;
    } catch (error) {
      if (activityId) v641FinishManualActivity(activityId, "failed", error?.message || "The request failed before CineBraid received a response.");
      throw error;
    }
  };
}

function v641InitActivity() {
  v642InstallUniversalActivityFetch();
  const toggle = document.getElementById("automation-activity-toggle");
  if (toggle) toggle.onclick = () => V641_ACTIVITY_DRAWER_OPEN ? closeGlobalAutomationActivity() : openGlobalAutomationActivity();
  if (!window.__cinebraidActivityEscapeInstalled) {
    window.__cinebraidActivityEscapeInstalled = true;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && V641_ACTIVITY_DRAWER_OPEN) {
        event.preventDefault();
        closeGlobalAutomationActivity();
      }
    });
  }
  v641UpdateActivityButton();
  v641RenderActivityDrawer();
  if (V641_ACTIVITY_TIMER) clearInterval(V641_ACTIVITY_TIMER);
  V641_ACTIVITY_TIMER = setInterval(() => { refreshGlobalAutomationActivity(false); v641TickElapsedLabels(); }, V641_ACTIVITY_REFRESH_MS);
}
if (typeof window !== "undefined") setTimeout(v641InitActivity, 0);

/* v6.4.2 — surface scene correction activity inside the affected shot workspace. */
window.v642RelatedShotActivityMarkup = (shotId) => {
  const runs = [...(AUTOMATION_RUNS || [])]
    .filter((run) => run.type === "scene-chain" && run.status !== "archived")
    .filter((run) => {
      const packages = [...(run.config?.initialCorrectionPackages || []), ...(run.result?.correctionPackages || [])];
      if (packages.some((item) => String(item.targetShotId) === String(shotId))) return true;
      return Object.values(run.steps || {}).some((step) => String(step.shotId || step.result?.targetShotId || "") === String(shotId));
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const run = runs[0];
  if (!run) return "";
  return `<section class="shot-related-activity"><header><div><span>RELATED SCENE AUTOMATION</span><b>${esc(run.label || "Scene correction")}</b><small>This work was launched from the scene but targets ${esc(shotId)}. Progress stays visible here.</small></div><button class="chip" onclick="openGlobalAutomationActivity('${attr(run.id)}')">OPEN GLOBAL ACTIVITY</button></header>${typeof v641LiveActivityMarkup === "function" ? v641LiveActivityMarkup(run) : ""}</section>`;
};

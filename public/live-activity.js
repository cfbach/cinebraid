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

/* ------------------------------------------------------------------------------
   IS MACHINE WORK ACTUALLY HAPPENING?

   One predicate, asked by every activity surface, because six copies of the list
   `["running", "awaiting-review"]` is what made CineBraid claim two operations were
   active while both had stopped. `awaiting-review` is not machine work: the runner
   has parked and is waiting for the director. A run left at `running` by a closed
   tab is not machine work either - nobody is driving it, and its lease says so.

   The lease is the honest cross-window signal and it is already the authority
   v626StatusLabel uses to say ACTIVE IN ANOTHER WINDOW / READY TO RESUME. This
   reuses it rather than inventing a second opinion:

     driven in this window   V626_ACTIVE_AUTOMATION_RUNS holds the id
     driven somewhere else   the server lease is still in the future
     nobody is driving it    a runner was recorded and its lease has lapsed

   A run that has never recorded a runnerId is brand new and mid-claim, so it counts
   as active: v627AcquireAutomationLease adds to the set and stores the lease in the
   same step, and treating the gap as idle would flash "waiting for you" at run start.

   Read lexically, not off window - these are script-scope bindings from
   public/automation.js, which index.html loads before this file. The window.*
   aliases below exist so tests and other surfaces can ask the same question. */
function v670RunLeaseLapsed(run) {
  if (!run?.runnerId) return false;
  const expires = Date.parse(run.leaseExpiresAt || "");
  return !Number.isFinite(expires) || expires <= Date.now();
}
function v670MachineActiveRun(run) {
  if (run?.status !== "running") return false;
  if (typeof V626_ACTIVE_AUTOMATION_RUNS !== "undefined" && V626_ACTIVE_AUTOMATION_RUNS.has(run.id)) return true;
  return !v670RunLeaseLapsed(run);
}
function v670WaitingForHumanRun(run) {
  if (run?.status === "awaiting-review") return true;
  /* Orchestration stopped and only a person can restart it. The run record still
     says "running"; the truthful sentence is "waiting for you". */
  return run?.status === "running" && v670RunLeaseLapsed(run);
}
/* Unfinished, so the poller keeps asking - deliberately NOT the active predicate.
   A run parked at a human gate still needs refreshing, because the approval may
   arrive in another window. */
function v670RunUnsettled(run) {
  return v670MachineActiveRun(run) || v670WaitingForHumanRun(run) || run?.status === "awaiting-review";
}
function v670MachineActiveStep(step) {
  return step?.status === "running";
}
/* WHEN DID THE MACHINE STOP? Not "now" for anything that has stopped.

   v627PauseForHumanReview and the scene child-review gate now stamp completedAt, so
   a fresh run carries the real boundary. Runs already on disk from before this batch
   do not, and they must not tick either - updatedAt is the last moment the runner
   touched the step, which is the boundary for those. */
function v670StepEndTimestamp(step) {
  if (v670MachineActiveStep(step)) return "";
  return step?.completedAt || step?.updatedAt || step?.startedAt || "";
}
function v670StepElapsedLabel(step) {
  return v641ElapsedLabel(step?.startedAt, v670StepEndTimestamp(step));
}
function v670ManualElapsedLabel(row) {
  const end = row?.status === "running" ? "" : row?.completedAt || row?.updatedAt || "";
  return v641ElapsedLabel(row?.startedAt, end);
}
window.v670MachineActiveRun = v670MachineActiveRun;
window.v670WaitingForHumanRun = v670WaitingForHumanRun;
window.v670RunLeaseLapsed = v670RunLeaseLapsed;
window.v670StepElapsedLabel = v670StepElapsedLabel;
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
  /* The job's own persisted handle first, then the id the step recorded at submission. */
  const requestId = falJobProviderRequestId(job) || activity.providerRequestId || "";
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
  const elapsed = v670StepElapsedLabel(step);
  const phase = [attempt ? `attempt ${attempt}${max ? ` of ${max}` : ""}` : "", elapsed ? `${elapsed} elapsed` : ""].filter(Boolean).join(" · ");
  return `<section class="automation-live-current state-${attr(tone)}"><header><div><span>${esc(v641StepSystem(step))}</span><b>${esc(step.label || displayRun.stage || step.key)}</b>${parentStep && child ? `<small>${esc(run.label || run.targetId)} → ${esc(child.label || child.targetId)}</small>` : ""}</div><i>${tone === "active" ? '<span class="spin">◌</span>' : tone === "done" ? "✓" : tone === "failed" ? "!" : tone === "review" ? "!" : "○"}</i></header><p>${esc(v641StepDetail(step, displayRun))}</p><div class="automation-live-meta"><span>${esc(String(v641StepState(step)).replace(/-/g, " "))}</span>${phase ? `<span>${esc(phase)}</span>` : ""}${activity.model && step.kind !== "generation" ? `<span>${esc(activity.model)}</span>` : ""}</div>${v641ProviderMarkup(step)}${v641ReviewProgressMarkup(step)}${v641ReturnedThumbnails(step)}</section>`;
}
function v641StepTimelineRow(step, run, nested = false) {
  const tone = v641StatusTone(step.status), elapsed = v670StepElapsedLabel(step);
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
  return `<article class="automation-drawer-run manual state-${attr(v641StatusTone(row.status))}" data-activity-key="manual:${attr(row.id)}"><header><div><span>${esc(row.system || "CINEBRAID ACTIVITY")}</span><b>${esc(row.title || "Manual operation")}</b></div><i>${row.status === "running" ? '<span class="spin">◌</span>' : row.status === "completed" ? "✓" : "!"}</i></header><p>${esc(row.detail || "Working…")}</p><small>${esc(v670ManualElapsedLabel(row))} elapsed</small></article>`;
}
function v641StandaloneFalJobs() {
  const runJobIds = new Set((AUTOMATION_RUNS || []).flatMap((run) => Object.values(run.steps || {}).map((step) => step.childJobId).filter(Boolean)));
  return (FAL_GENERATION_JOBS || []).filter((job) => falJobActive(job) && !runJobIds.has(job.id));
}
function v641StandaloneFalMarkup(job) {
  return `<article class="automation-drawer-run state-active" data-activity-key="fal:${attr(job.id)}"><header><div><span>FAL · GPT IMAGE 2</span><b>${esc(job.purpose || "Manual image generation")}</b></div><i><span class="spin">◌</span></i></header><p>${esc(String(job.status || "working").replace(/_/g, " "))}${job.queuePosition != null ? ` · queue ${job.queuePosition}` : ""}</p><small>${esc(job.model || "GPT Image 2")} · ${Number(job.outputCount || 0)} candidate${Number(job.outputCount || 0) === 1 ? "" : "s"}</small></article>`;
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
  const active = v670MachineActiveRun(run);
  const waiting = v670WaitingForHumanRun(run);
  const failed = Object.values(run.steps || {}).find((item) => item.status === "failed") || null;
  const repairable = run.status === "failed" && run.type === "scene-chain" && (failed?.kind === "generation" || String(failed?.key || "").includes("scene-correction"));
  const primary = repairable
    ? `<button class="approve-btn" onclick="retryFailedAutomationStep('${attr(run.id)}','${attr(failed.key)}')">REPAIR & RETRY</button>`
    : run.status === "failed" && failed
      ? `<button onclick="retryFailedAutomationStep('${attr(run.id)}','${attr(failed.key)}')">RETRY</button>`
      : `<button onclick="closeGlobalAutomationActivity();location.hash='${attr(v641RunRoute(run))}'">OPEN WORKSPACE</button>`;
  return `<article class="automation-drawer-run state-${attr(v670RunTone(run))}" data-run-id="${attr(run.id)}" data-activity-key="run:${attr(run.id)}"><header><div><span>${esc(run.type.replace(/-/g, " ").toUpperCase())}</span><b>${esc(run.label || run.targetId)}${duplicateCount > 1 ? ` <em class="automation-duplicate-count">×${duplicateCount}</em>` : ""}</b></div><i>${active ? '<span class="spin">◌</span>' : waiting ? "!" : run.status === "completed" ? "✓" : run.status === "failed" ? "!" : "○"}</i></header><p>${esc(waiting ? v670WaitingDetail(run, step) : step ? `${v641StepSystem(step)} · ${step.label || displayRun.stage}` : run.stage || run.summary || v626StatusLabel(run))}</p>${failed?.error ? `<small class="automation-drawer-error">${esc(failed.error)}</small>` : child ? `<small>Child run: ${esc(child.label || child.targetId)}</small>` : ""}<footer>${primary}<button onclick="closeGlobalAutomationActivity();openAutomationReport('${attr(run.id)}')">VIEW REPORT</button>${["failed","interrupted","cancelled"].includes(run.status) ? `<button class="ghost-btn" onclick="dismissAutomationActivityRun('${attr(run.id)}')">DISMISS</button>` : ""}</footer></article>`;
}
/* WAITING FOR YOU, said in the run's own terms. A run parked at an approval gate and
   a run whose runner went away need different things from the director, and the
   drawer used to describe both as whatever step was last touched. */
function v670WaitingDetail(run, step) {
  if (run?.status === "awaiting-review") return `Waiting for you · ${run.stage || step?.label || "approve a result to continue"}`;
  return `Waiting for you · orchestration stopped, choose Resume Run to continue${step?.label ? ` from ${step.label}` : ""}`;
}
/* The drawer row's own tone. Identical to v641StatusTone except that a `running` run
   nobody is driving reads as an approval-style pause rather than as live work, which
   is what its row now says in words. */
function v670RunTone(run) {
  return v670WaitingForHumanRun(run) ? "review" : v641StatusTone(run?.status);
}
function v641ActiveAndRecentRuns() {
  const runs = [...(AUTOMATION_RUNS || [])].filter((run) => run.status !== "archived");
  /* Unsettled work sorts first - both the machine's and the director's, because a run
     waiting on a person is just as much "still open" as one mid-request. Which of the
     two it is gets said in the section it lands in, not by hiding it down the list. */
  return runs.sort((a, b) => {
    const openA = v670RunUnsettled(a) ? 1 : 0;
    const openB = v670RunUnsettled(b) ? 1 : 0;
    return openB - openA || String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
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
  const activeRuns = runs.filter(v670MachineActiveRun);
  const waitingRuns = runs.filter(v670WaitingForHumanRun);
  const activeManual = [...V641_MANUAL_ACTIVITIES.values()].filter((row) => row.status === "running");
  const activeFal = v641StandaloneFalJobs();
  const attention = runs.filter((run) => ["failed", "interrupted", "cancelled"].includes(run.status));
  const count = activeRuns.length + activeManual.length + activeFal.length;
  if (count) return { tone: "active", label: `Activity · ${count} active`, detail: activeManual[0]?.title || activeFal[0]?.purpose || activeRuns[0]?.stage || "Working" };
  /* Nothing is running. A pending approval outranks an old failure here, because it
     is the one thing the director can finish right now. */
  if (waitingRuns.length) return { tone: "waiting", label: `Activity · ${waitingRuns.length} waiting for you`, detail: waitingRuns[0].stage || "Your approval is needed" };
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
  /* Not "remains available in Reports": archiving moves a run out of the active set and
     into the finished ones, which the server keeps only up to its run-history limit. The
     old sentence promised a permanence CineBraid does not offer. */
  toast("Alert dismissed. The run is archived and stays in Reports until it ages out of the run history.");
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
    toast(`${archived} previous alert${archived === 1 ? "" : "s"} archived. Nothing was deleted here.`);
  };
  if (typeof confirmModal === "function") return confirmModal(`Dismiss ${ids.length} previous automation alert${ids.length === 1 ? "" : "s"}?`, apply, { title: "Clear previous alerts", confirmLabel: "DISMISS ALERTS", body: "This removes them from Global Activity. Each run and its diagnostics stay in Reports until they age out of the run history CineBraid keeps." });
  await apply();
};
/* ------------------------------------------------------------------------------
   PAINT THE DRAWER WITHOUT DESTROYING WHAT THE USER IS TOUCHING.

   The drawer re-renders every V641_ACTIVITY_REFRESH_MS whether or not anything
   changed, and it did so by replacing its whole innerHTML. Every control in it was
   therefore a new element every 3.5 seconds, and a click that began before a tick
   landed on a node that no longer existed - reproduced in Phase 2 as a DISMISS button
   detaching under the pointer, and the cause of the intermittent check:browser-real
   timeout.

   So: build the same markup, then reconcile instead of replacing. Rows carry
   data-activity-key, and a row that is already on screen keeps its node - same node,
   same pending click, same focus - whether or not its contents changed.

   THAT LAST CLAUSE IS THE POINT, and the first version of this repair got it wrong: it
   kept the node only when the new markup was byte-identical and replaced the whole row
   otherwise. A run row changes its label, its step text or its error EXACTLY when the
   director is reaching for its DISMISS button, so "identical rows survive" is the one
   case that never needed protecting. v670PatchElement patches the row in place instead,
   and replaces only a descendant that cannot become its counterpart.

   This is a rendering repair, not a redesign: the markup produced is unchanged.

   The wholesale path is kept for two cases that genuinely need it - the first paint,
   and a DOM that does not parse innerHTML (the Node render harness's FakeElement,
   where reconciliation would silently no-op and leave the drawer stale). The probe
   asks the document itself rather than sniffing for a test environment. */
function v670DomCanReconcile(document_) {
  try {
    const probe = document_.createElement("div");
    probe.innerHTML = '<i data-activity-key="probe"></i>';
    return typeof probe.querySelectorAll === "function"
      && probe.querySelectorAll("[data-activity-key]").length === 1
      && typeof probe.replaceChild === "function";
  } catch { return false; }
}
/* A section's rows are its children MINUS its own header.

   Counting the header as a row is how the first version of this repair quietly did
   nothing: every section child had to carry data-activity-key for the keyed path to be
   taken, the header never does, so the keyed path was unreachable and every section
   fell through to a whole-body rewrite. Unchanged rows still survived - but only
   because the rewrite was skipped when the markup matched - and a row whose content
   changed was destroyed along with its controls. */
function v670SectionRows(node) {
  return [...(node?.children || [])].filter((row) => row.nodeName !== "HEADER");
}
function v670KeyedRows(rows) {
  return rows.length && rows.every((row) => row.getAttribute?.("data-activity-key")) ? rows : null;
}
/* Make `live` look like `next` WITHOUT replacing `live`.

   Attributes are synced in both directions - one that disappeared from the new markup
   is removed, not left behind - and children are walked pairwise. A child is replaced
   only when it cannot become its counterpart: a different node type, or a different
   tag. Everything else is patched in place, so a control the user is pointing at
   survives any change to the text beside it.

   Deliberately small and deliberately not general. This is not a virtual DOM: it has no
   keying of its own below the row, no component model and no lifecycle. It reconciles
   the fixed, shallow markup this file emits, and nothing else. Form state (value,
   checked) is not synced because the drawer renders none - if that ever changes, this
   function has to grow with it. */
function v670PatchElement(live, next) {
  for (const name of live.getAttributeNames()) if (!next.hasAttribute(name)) live.removeAttribute(name);
  for (const name of next.getAttributeNames()) {
    const value = next.getAttribute(name);
    if (live.getAttribute(name) !== value) live.setAttribute(name, value);
  }
  /* Snapshot both sides: appending a node from `next` moves it out of `next`, which
     would shift a live NodeList underneath the walk. */
  const liveKids = [...live.childNodes], nextKids = [...next.childNodes];
  for (let index = 0; index < nextKids.length; index += 1) {
    const liveKid = liveKids[index], nextKid = nextKids[index];
    if (!liveKid) { live.appendChild(nextKid); continue; }
    if (liveKid.nodeType !== nextKid.nodeType || liveKid.nodeName !== nextKid.nodeName) {
      live.replaceChild(nextKid, liveKid);
      continue;
    }
    if (liveKid.nodeType === 1) { v670PatchElement(liveKid, nextKid); continue; }
    if (liveKid.nodeValue !== nextKid.nodeValue) liveKid.nodeValue = nextKid.nodeValue;
  }
  for (let index = nextKids.length; index < liveKids.length; index += 1) live.removeChild(liveKids[index]);
}
function v670PatchSection(current, next) {
  const currentHeader = current.querySelector(":scope > header"), nextHeader = next.querySelector(":scope > header");
  if (currentHeader && nextHeader && currentHeader.outerHTML !== nextHeader.outerHTML) v670PatchElement(currentHeader, nextHeader);
  const currentRowNodes = v670SectionRows(current), nextRowNodes = v670SectionRows(next);
  const currentRows = v670KeyedRows(currentRowNodes), nextRows = v670KeyedRows(nextRowNodes);
  /* An empty-state placeholder carries no key and no control. Sections holding one on
     either side swap their body wholesale - never their header, which carries the
     section's own count and, in the shell, its controls. */
  if (!currentRows || !nextRows) {
    const currentBody = currentRowNodes.map((row) => row.outerHTML).join("");
    const nextBody = nextRowNodes.map((row) => row.outerHTML).join("");
    if (currentBody === nextBody) return;
    for (const row of currentRowNodes) current.removeChild(row);
    for (const row of nextRowNodes) current.appendChild(row);
    return;
  }
  const existing = new Map(currentRows.map((row) => [row.getAttribute("data-activity-key"), row]));
  const keep = new Set();
  let anchor = currentHeader || null;
  for (const nextRow of nextRows) {
    const key = nextRow.getAttribute("data-activity-key");
    const found = existing.get(key);
    let live = found;
    if (found) {
      /* The row keeps its node whatever changed inside it. This is the line that stops
         a DISMISS button vanishing while the run's own label or error is rewritten. */
      if (found.outerHTML !== nextRow.outerHTML) v670PatchElement(found, nextRow);
    } else {
      current.insertBefore(nextRow, anchor ? anchor.nextSibling : current.firstChild);
      live = nextRow;
    }
    if (anchor && live.previousSibling !== anchor) current.insertBefore(live, anchor.nextSibling);
    anchor = live;
    keep.add(key);
  }
  for (const [key, row] of existing) if (!keep.has(key)) row.remove();
}
function v670PaintDrawer(drawer, shell) {
  const currentShell = typeof drawer.querySelector === "function" ? drawer.querySelector(".automation-drawer-shell") : null;
  if (!currentShell || !v670DomCanReconcile(document)) {
    drawer.innerHTML = shell;
    return;
  }
  const staging = document.createElement("div");
  staging.innerHTML = shell;
  const nextShell = staging.querySelector(".automation-drawer-shell");
  if (!nextShell) { drawer.innerHTML = shell; return; }
  /* The shell header is not inert either: it holds Close and DISMISS PREVIOUS ALERTS
     beside a heading that changes whenever a count does. Patched, not rewritten. */
  const currentHeader = currentShell.querySelector(":scope > header"), nextHeader = nextShell.querySelector(":scope > header");
  if (currentHeader && nextHeader && currentHeader.outerHTML !== nextHeader.outerHTML) v670PatchElement(currentHeader, nextHeader);
  const currentList = currentShell.querySelector(".automation-drawer-list"), nextList = nextShell.querySelector(".automation-drawer-list");
  if (!currentList || !nextList) { drawer.innerHTML = shell; return; }
  const currentSections = [...currentList.children], nextSections = [...nextList.children];
  /* The section list is fixed and ordered, so a length change means the markup itself
     changed shape rather than its contents - repaint rather than guess. */
  if (currentSections.length !== nextSections.length) { currentList.innerHTML = nextList.innerHTML; return; }
  nextSections.forEach((nextSection, index) => v670PatchSection(currentSections[index], nextSection));
}
function v641RenderActivityDrawer(focusRunId = "") {
  const drawer = document.getElementById("automation-activity-drawer");
  if (!drawer) return;
  const runs = v641ActiveAndRecentRuns();
  const manual = [...V641_MANUAL_ACTIVITIES.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const standaloneFal = v641StandaloneFalJobs();
  const activeRuns = runs.filter(v670MachineActiveRun);
  const waitingRuns = runs.filter(v670WaitingForHumanRun);
  const attentionRuns = runs.filter((run) => ["failed", "interrupted", "cancelled"].includes(run.status));
  const attentionGroups = v641GroupAttentionRuns(attentionRuns);
  const completedRuns = runs.filter((run) => run.status === "completed");
  const activeManual = manual.filter((row) => row.status === "running");
  const recentManual = manual.filter((row) => row.status !== "running");
  const activeCount = activeRuns.length + activeManual.length + standaloneFal.length;
  const section = (title, rows, empty = "") => `<section class="automation-drawer-section"><header><b>${esc(title)}</b><span>${rows.length}</span></header>${rows.join("") || (empty ? `<div class="automation-console-empty"><span>${esc(empty)}</span></div>` : "")}</section>`;
  /* WAITING FOR YOU is its own section rather than a tone inside ACTIVE NOW. The
     question a director asks the drawer is "is anything happening, or is it me?", and
     a list that answers both at once is the thing that read as a stalled machine. */
  const content = [
    section("ACTIVE NOW", [...activeManual.map(v641ManualActivityMarkup), ...standaloneFal.map(v641StandaloneFalMarkup), ...activeRuns.map(v641DrawerRunMarkup)], "No operation is currently running."),
    section("WAITING FOR YOU", waitingRuns.map((run) => v641DrawerRunMarkup(run)), "Nothing is waiting on you."),
    section("PREVIOUS FAILURES / NEEDS ATTENTION", [...recentManual.filter((row) => row.status === "failed").map(v641ManualActivityMarkup), ...attentionGroups.map((group) => v641DrawerRunMarkup(group.run, group.count))], "No blocked or failed work."),
    section("RECENT COMPLETED", [...recentManual.filter((row) => row.status === "completed").map(v641ManualActivityMarkup), ...completedRuns.map(v641DrawerRunMarkup)].slice(0, 12), "No completed activity yet."),
  ].join("");
  const heading = activeCount
    ? `${activeCount} operation${activeCount === 1 ? "" : "s"} active`
    : waitingRuns.length
      ? `${waitingRuns.length} run${waitingRuns.length === 1 ? "" : "s"} waiting for you`
      : attentionRuns.length
        ? `${attentionRuns.length} previous attempt${attentionRuns.length === 1 ? "" : "s"} need attention`
        : "No active operation";
  const shell = `<div class="automation-drawer-shell"><header><div><span>GLOBAL ACTIVITY</span><h2>${heading}</h2><p>Every live local-AI call, paid request, review, retry, approval, and recovery action remains visible from any workspace. Detailed diagnostics live in Reports.</p></div><div class="automation-drawer-header-actions">${attentionRuns.length ? `<button class="ghost-btn" onclick="archivePreviousAutomationFailures()">DISMISS PREVIOUS ALERTS</button>` : ""}<button class="cancel" onclick="closeGlobalAutomationActivity()">Close</button></div></header><div class="automation-drawer-list">${content}</div></div>`;
  v670PaintDrawer(drawer, shell);
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
  const activeRuns = (AUTOMATION_RUNS || []).filter(v670MachineActiveRun);
  const activeManual = [...V641_MANUAL_ACTIVITIES.values()].filter((row) => row.status === "running");
  const activeFal = v641StandaloneFalJobs();
  const count = activeRuns.length + activeManual.length + activeFal.length;
  const activeStep = activeRuns.map((run) => v641DisplayedRunAndStep(run).step).find(Boolean);
  const detail = activeManual[0]?.system || (activeFal[0] ? "FAL Image Generation" : activeStep ? v641StepSystem(activeStep).replace(/^.*·\s*/, "") : "");
  button.classList.toggle("active", count > 0);
  const status = v6602ActivityStatus();
  /* The spinner is reserved for work that is running. A pending approval gets a
     standing mark, because a spinning icon over a stopped runner is the whole
     defect this batch exists to remove. */
  button.classList.toggle("waiting", status.tone === "waiting");
  button.innerHTML = `<span>${count ? '<i class="spin">◌</i>' : status.tone === "waiting" ? "<i>!</i>" : "◉"}</span><b>${esc(status.label.replace("Activity · ", ""))}</b>${detail ? `<small>${esc(detail)}</small>` : ""}`;
  button.title = status.label;
  v642UpdateGlobalActivityStrip();
}
window.refreshGlobalAutomationActivity = async (force = false) => {
  if (V641_ACTIVITY_REFRESHING) return;
  /* Unsettled, not active: a run parked at an approval gate must keep being polled so
     an approval made in another window lands here. */
  const openExists = (AUTOMATION_RUNS || []).some(v670RunUnsettled);
  if (!force && !V641_ACTIVITY_DRAWER_OPEN && !openExists) return;
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

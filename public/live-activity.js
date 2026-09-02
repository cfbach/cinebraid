/* CineBraid v6.6.0.2 — live activity and accessible drawer behavior. */
const V641_ACTIVITY_REFRESH_MS = 3500;
let V641_ACTIVITY_REFRESHING = false;
let V641_ACTIVITY_TIMER = null;
const V641_MANUAL_ACTIVITIES = new Map();

/* ==========================================================================
   WHICH PROJECT THIS ACTIVITY STATE DESCRIBES.

   AUTOMATION_RUNS and FAL_GENERATION_JOBS are re-read from the server on every
   project open, so they follow the project by construction. V641_MANUAL_ACTIVITIES
   did not: it is a module-level Map that outlives load(), and a finished row is
   retained for ten minutes on purpose. Switching projects therefore left the
   previous project's rows — "Review scene SC-01", "Review ROOFTOP_STATE.png",
   every vision review behind a continuity or reference approval — sitting in the
   new project's drawer under RECENT COMPLETED and PREVIOUS FAILURES / NEEDS
   ATTENTION, and counted by the Activity button, as if they were its own work.

   Two mechanisms, because they answer two different questions:

   - Every row records the project it was started for. Readers present only rows
     whose stamp matches the project on screen, so a row can never be re-attributed
     — including in the window between the switch route returning and load()
     finishing, where ACTIVE_PROJECT_SLUG has already moved.
   - load() calls v670ScopeActivityToProject(), which DROPS the rows when the slug
     actually changes. It is deliberately a no-op when the slug is unchanged:
     load() is also the same-project refresh that automation.js, fal-generation.js
     and creation-studio.js call when work completes, and purging there would
     delete the live rows describing that very work.

   Nothing here is a second opinion about which project is open. The slug comes
   from ACTIVE_PROJECT_SLUG, which load() sets from the server's own
   x-cinebraid-project-slug header, read through typeof because this file is also
   evaluated in suites where app.js is absent. */
let V641_ACTIVITY_PROJECT_SLUG = "";
function v670ActiveProjectSlug() {
  if (typeof ACTIVE_PROJECT_SLUG !== "undefined" && ACTIVE_PROJECT_SLUG) return String(ACTIVE_PROJECT_SLUG);
  if (typeof window !== "undefined" && window.ACTIVE_PROJECT_SLUG) return String(window.ACTIVE_PROJECT_SLUG);
  return "";
}
/* Every manual-activity reader goes through here. A row with no stamp belongs to
   no project and is shown only when no project is open, which is the state it was
   started in — an unstamped row that followed the reader's slug would be the leak
   again, wearing a different name. */
function v670ManualActivityRows() {
  const slug = v670ActiveProjectSlug();
  return [...V641_MANUAL_ACTIVITIES.values()].filter((row) => String(row.projectSlug || "") === slug);
}
window.v670ScopeActivityToProject = (slug = v670ActiveProjectSlug()) => {
  const next = String(slug || "");
  if (next === V641_ACTIVITY_PROJECT_SLUG) return false;
  V641_ACTIVITY_PROJECT_SLUG = next;
  for (const id of [...V641_MANUAL_ACTIVITIES.keys()]) v641ClearManualRetention(id);
  V641_MANUAL_ACTIVITIES.clear();
  V641_ACTIVITY_FOREIGN_PROJECT = "";
  v641UpdateActivityButton();
 
  return true;
};
/* Set when a ledger the server answers with belongs to a different project than
   the one this window has open — which happens when the active project is switched
   somewhere else (a second tab, another machine on the LAN). The rows are not
   adopted; the drawer says so instead of quietly presenting them as this project's,
   and offers the one action that makes the window current again. */
let V641_ACTIVITY_FOREIGN_PROJECT = "";
/* ==========================================================================
   EVERY ACTIVITY PAYLOAD PROVES ITS OWN OWNER.

   The first repair tied BOTH ledgers to one ownership answer — the automation-run
   payload's — and then adopted the FAL payload on the strength of it. Independent
   review reproduced the hole that leaves: a FAL response for project A, arriving
   beside a run response that agrees with project B, was adopted, rendered in the
   drawer and counted by the Activity button. One payload cannot vouch for another;
   they are separate routes over separate ledgers and each can be answered for a
   different project.

   So admission is asked once per payload, of that payload:

     - a payload whose stated owner disagrees with the project on screen is
       REFUSED, and the drawer names the project it belongs to.
     - a payload that states an owner that agrees is ADMITTED. This is the ordinary
       same-project poll and it must keep working.
     - a payload that states NO owner is admitted only when it carries NO ROWS.
       Rows that cannot prove where they came from must not be presented as this
       project's work, and an empty list has nothing to attribute either way — which
       is what keeps every route stub and any older server answering harmlessly
       instead of being silently trusted.

   WHO "THE PROJECT ON SCREEN" IS can be stated by the caller. The drawer's poll
   means the live global, which is the default. The project load transaction's
   PREPARE phase means the OWNER OF THE SNAPSHOT IT IS BUILDING - during a
   replacement the live global is still the OUTGOING project, so asking it there
   would refuse the incoming project's own ledger. The admission rule itself is
   unchanged; only who it is asked about is now explicit.

   Returns the rows to adopt, or null to leave the current ones alone. */
function v670AdmitActivityRows(payload, key, expected = v670ActiveProjectSlug()) {
  const here = String(expected || "");
  const rows = payload && Array.isArray(payload[key]) ? payload[key] : null;
  const owner = String((payload && payload.projectSlug) || "");
  if (owner && here && owner !== here) return { rows: null, foreign: owner };
  if (!owner && rows && rows.length) return { rows: null, foreign: "" };
  return { rows, foreign: "" };
}
window.v670AdmitActivityRows = v670AdmitActivityRows;

/* Is a dialog currently on top of the drawer? The shipped modal host is a single
   `#modal` element that carries `hidden` when closed, so this is a read of the
   product's own state rather than a second flag to keep in step. */
function v670DialogIsOpen() {
  const modal = typeof document !== "undefined" ? document.getElementById("modal") : null;
  return !!(modal && modal.classList && !modal.classList.contains("hidden"));
}
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
/* IS THE THING THIS RUN IS PARKED ON STILL UNSATISFIED?

   Dogfood #2 A2. The run ledger records that it stopped and what it stopped for;
   it does not record whether that requirement has since been met somewhere else.
   Approving the same frame or state through an entity or media workspace writes
   PROJECT truth and never touches the ledger, so the drawer, the Assistant and
   the Terminal all kept asserting a decision the creator had already made.

   The server reconciles the durable record on every read — see
   reconcileParkedGates in automation-runs.js — and this asks the SAME shared
   question of the live project so the surfaces converge on the current render
   rather than on the next poll. One boundary, two entry points; neither holds an
   opinion of its own.

   A gate whose requirement cannot be identified is treated as OUTSTANDING. The
   failure mode of guessing wrong in that direction is one extra item in "waiting
   for you"; the other direction hides real work. */
function v670RunGateOutstanding(run) {
  /* BATCH 1B: the SAME function the server's reconciliation asks, rather than a
     re-implementation of half of it. `runHasActionableGate` answers both
     directions — a parked gate whose authority has arrived, and a CLOSED gate
     whose authority has since been revoked — so a render agrees with a poll
     before the ledger has caught up. The local re-derivation below stays only as
     the answer for a composition where the shared module is absent, and it errs
     toward actionable for the reason stated above. */
  if (typeof runHasActionableGate === "function" && typeof P !== "undefined" && P) return runHasActionableGate(run, P);
  if (typeof runGateRequirements !== "function" || typeof gateSatisfied !== "function") return true;
  const project = typeof P !== "undefined" ? P : null;
  if (!project) return true;
  const requirements = runGateRequirements(run);
  if (!requirements.length) return true;
  return requirements.some((requirement) => !gateSatisfied(requirement, project));
}
/* DID THIS RUN LOSE ITS ACTIVE RUNNER?
 *
 * Answered from the release code alone, which records that the lease expired with no
 * heartbeat. WHY the runner stopped renewing is not knowable - a closed tab, a suspended
 * one, a sleeping machine and a lost network are the same record - so nothing here may
 * say a window closed or that nobody was watching.
 *
 * `interrupted` has always meant two things - a run that stopped for a reason of its
 * own, and a run that lost its runner - and until the server started reconciling stale
 * leases, only the second one existed as `running` with a lapsed lease, which
 * v670WaitingForHumanRun read below. Now that the durable record says `interrupted`
 * (automation-runs.js reconcileStaleLeases), the two halves arrive wearing the same
 * status and the surfaces have to tell them apart.
 *
 * The reconciliation stamps WHY it released the lease. Reading that code rather than the
 * sentence beside it means rewording the message is not a behaviour change. */
function v670RunnerWentAway(run) {
  return run?.status === "interrupted" && String(run?.leaseDiagnostics?.lastReleaseCode || "") === "lease-expired";
}
function v670WaitingForHumanRun(run) {
  if (run?.status === "awaiting-review") return v670RunGateOutstanding(run);
  /* Nothing failed and nothing is running: the runner went away and only a person can
     start it again. Exactly what the `running`-with-a-lapsed-lease branch below says,
     for the same run after the server has written its ending. */
  if (v670RunnerWentAway(run)) return true;
  /* BATCH 1B: an INTERRUPTED run one of whose recorded approvals has since been
     WITHDRAWN is waiting again. Narrow on purpose — `runHasRevokedAuthority`
     answers only that second direction, so an ordinary interrupted run is not
     swept into "waiting for you" by this. Reconciliation moves the run back to
     `awaiting-review` on the next ledger read; this makes the current render
     agree without waiting for it. */
  if (run?.status === "interrupted" && typeof runHasRevokedAuthority === "function" && typeof P !== "undefined" && P && runHasRevokedAuthority(run, P)) return true;
  /* Orchestration stopped and only a person can restart it. The run record still
     says "running"; the truthful sentence is "waiting for you". */
  return run?.status === "running" && v670RunLeaseLapsed(run);
}
/* IS SOMETHING ALREADY PUTTING THIS RIGHT WITHOUT ASKING THE DIRECTOR?

   DOGFOOD SLICE 0. A scene run drives its shots as durable CHILD runs. When a child
   fails, v640RunSceneShot posts the child's failed step for retry and resumes it -
   automatic recovery, entirely inside a parent that is still `running`. In the window
   between those two calls the child's durable record says `failed` or `interrupted`,
   and every activity surface read that as a previous failure needing a person: a red
   NEEDS ATTENTION row for work the machine was already repairing, beside the parent
   run reporting normal progress.

   THE RULE THIS ENCODES: parent-run health governs the primary severity, and a child
   stage failure is detailed evidence underneath it. A director cannot act on the child
   anyway - retrying it by hand would race the runner that owns it.

   THE LINK IS DERIVED, NOT STORED. public/scene-automation.js sets `parentRunId` on a
   child before creating it and automation-runs.js's sanitizer does not carry that
   field, so the durable record has no parent pointer. The parent's own step DOES record
   `result.childRunId`, is preserved, and exists on every scene run already on disk -
   so the relationship is read from the side that survives.

   NARROW ON PURPOSE. The parent must be machine-active by the shipped predicate:
   a parent that has itself failed, been interrupted, or finished is NOT recovering
   anything, and its child goes straight back to needing attention. */
function v670ParentRunFor(run) {
  const id = String(run?.id || "");
  if (!id) return null;
  const rows = (typeof AUTOMATION_RUNS !== "undefined" ? AUTOMATION_RUNS : window.AUTOMATION_RUNS) || [];
  return rows.find((row) => row && row.id !== id
    && Object.values(row.steps || {}).some((step) => String(step?.result?.childRunId || step?.childRunId || "") === id)) || null;
}
function v670RunRecovering(run) {
  const parent = v670ParentRunFor(run);
  return !!parent && v670MachineActiveRun(parent);
}
/* DOES THIS RUN NEED A PERSON TO LOOK AT IT BECAUSE SOMETHING WENT WRONG?

   The third member of the pair above, extracted for the same reason the first two
   were: the list `["failed","interrupted","cancelled"]` was stated four times in this
   file - the drawer row's DISMISS gate, the toolbar aggregate, the bulk-archive list
   and the drawer's own section - and the creator workspace surfaces would have made a
   fifth. Four copies of one idea is how the idea drifts from its meaning, which is the
   whole lesson of the machine-active predicate.

   THE SEMANTICS ARE UNCHANGED for every run the browser itself interrupts. `interrupted`
   is known to be overloaded upstream - it means both "the director approved, resuming
   now" and "a child run needs a director" - and those are passed through here unchanged
   rather than split, because splitting them touches the dispatch path and is a different
   piece of work.

   THE FIRST EXCLUSION is the half the server can now name: a run whose lease lapsed with
   no heartbeat. Nothing went wrong with it, so calling it a previous failure is false,
   and it is already counted where it belongs - waiting for a person to press Resume Run.
   Without this it would sit in BOTH sections at once, which is how it would have
   arrived.

   THE SECOND is Dogfood Slice 0's: a run a healthy parent is already re-driving. See
   v670RunRecovering directly above. Both exclusions are the same idea - a run nobody
   is being asked to act on is not a claim on the director - and neither hides anything
   permanently, because both go back to needing attention the moment their reason for
   not needing it ends. */
function v670AttentionRun(run) {
  return ["failed", "interrupted", "cancelled"].includes(run?.status) && !v670RunnerWentAway(run) && !v670RunRecovering(run);
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
window.v670RunnerWentAway = v670RunnerWentAway;
window.v670AttentionRun = v670AttentionRun;
window.v670RunRecovering = v670RunRecovering;
window.v670ParentRunFor = v670ParentRunFor;
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
  return `<section class="automation-live-activity" data-automation-live-run="${attr(run.id)}"><div class="automation-live-heading"><div><span>LIVE AUTOMATION ACTIVITY</span><b>Every AI, provider, review, and approval operation</b></div><button class="chip" onclick="window.CineBraidCreatorSurfaces.expandTerminal('${attr(run.id)}')">OPEN ACTIVITY DRAWER</button></div>${v641CurrentOperationMarkup(run)}<details class="automation-live-details" open><summary>Detailed timeline <span>${Object.keys(run.steps || {}).length}</span></summary>${v641TimelineMarkup(run)}</details></section>`;
};
window.v641StartManualActivity = (system, title, detail = "", meta = {}) => {
  const id = `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  V641_MANUAL_ACTIVITIES.set(id, { id, system, title, detail, meta, projectSlug: v670ActiveProjectSlug(), status: "running", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  v641UpdateActivityButton();
  return id;
};
window.v641UpdateManualActivity = (id, patch = {}) => {
  const row = V641_MANUAL_ACTIVITIES.get(id); if (!row) return;
  Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  v641UpdateActivityButton();
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
   
  }, V641_MANUAL_RETENTION_MS);
  if (timer && typeof timer.unref === "function") timer.unref();
  V641_MANUAL_RETENTION_TIMERS.set(id, timer);
}
window.v641FinishManualActivity = (id, status = "completed", detail = "") => {
  const row = V641_MANUAL_ACTIVITIES.get(id); if (!row) return;
  Object.assign(row, { status, detail: detail || row.detail, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  v641UpdateActivityButton();
  v641ScheduleManualRetention(id);
};
function v641StandaloneFalJobs() {
  const runJobIds = new Set((AUTOMATION_RUNS || []).flatMap((run) => Object.values(run.steps || {}).map((step) => step.childJobId).filter(Boolean)));
  return (FAL_GENERATION_JOBS || []).filter((job) => falJobActive(job) && !runJobIds.has(job.id));
}
/* The four reference collections an entity-chain run can target, and the route each
   one is read at. Hoisted out of v641RunRoute so that "which collections exist" has ONE
   statement: the router reads it to build a hash, and v670RunResultTarget reads the same
   keys to refuse a collection that does not exist. */
const V641_ENTITY_ROUTES = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" };

function v641RunRoute(run) {
  if (run?.type === "scene-chain") return `#/scene/${run.targetId}`;
  if (run?.type === "shot-chain") return `#/shot/${run.targetId}`;
  if (run?.type === "entity-chain") {
    const [list, id] = String(run.targetId || "").split(":");
    const route = V641_ENTITY_ROUTES[list] || "library";
    return `#/${route}/${id || ""}`;
  }
  return "#/production";
}
/* THE ONE SENTENCE A RUN IS DESCRIBED BY, wherever it is described.

   Lifted verbatim out of v641DrawerRunMarkup so that the drawer row and the compact
   status a working page now shows are not two renderings of the same idea but two
   callers of one function. That is the whole answer to "does the compact status use
   the same classification as the drawer": there is nothing left to disagree with.

   It asks v670WaitingForHumanRun and nothing else. It does not read run.status - the
   fallback chain at the end is the run's OWN recorded prose (stage, summary) and
   v626StatusLabel, which is the shipped label function, not a classification made
   here. */
function v670RunHeadline(run) {
  const { displayRun, step } = v641DisplayedRunAndStep(run);
  if (v670WaitingForHumanRun(run)) return v670WaitingDetail(run, step);
  if (step) return `${v641StepSystem(step)} · ${step.label || displayRun.stage}`;
  return run?.stage || run?.summary || v626StatusLabel(run);
}

/* WHAT A WORKING PAGE SAYS ABOUT A RUN. Batch 2, Slice 1.

   Replaces the full LIVE AUTOMATION ACTIVITY timeline that v626AutomationPanel used to
   embed in six task pages and v642RelatedShotActivityMarkup embedded in a seventh. The
   drawer owns the detail; a task page owns the task.

   EVERY WORD AND EVERY TONE HERE IS BORROWED, none is decided:

     v670RunTone            - the drawer row's own tone function
     v670MachineActiveRun   - the shipped active predicate
     v670WaitingForHumanRun - the shipped waiting predicate
     v670AttentionRun       - the shipped attention predicate
     v670RunHeadline        - the sentence the drawer row prints

   There is no `run.status` test in this function, deliberately: a second reading of a
   raw status is exactly how a working page and the drawer come to claim different
   things about one run.

   It carries ONE control, and that control only opens the drawer. No approval, no
   retry, no resume, no paid submission - those live in v626RunActions, which
   v626AutomationPanel still renders, untouched, right where it always did. */
window.v670CompactRunStatusMarkup = (run) => {
  if (!run) return "";
  const tone = v670RunTone(run);
  const active = v670MachineActiveRun(run);
  const waiting = v670WaitingForHumanRun(run);
  const attention = v670AttentionRun(run);
  const glyph = active ? '<span class="spin">◌</span>' : waiting || attention ? "!" : tone === "done" ? "✓" : "○";
  return `<div class="automation-compact-status state-${attr(tone)}" data-automation-compact-run="${attr(run.id)}" data-compact-tone="${attr(tone)}"><i aria-hidden="true">${glyph}</i><p>${esc(v670RunHeadline(run))}</p><button type="button" class="chip automation-compact-open" onclick="window.CineBraidCreatorSurfaces.expandTerminal('${attr(run.id)}')">OPEN ACTIVITY →</button></div>`;
};

/* Repainted from the SAME tick that repaints the drawer, so a task page and the drawer
   never show two ages of one run.

   PATCHED, NOT REPLACED, where the DOM can be reconciled: swapping outerHTML every 3.5
   seconds detaches OPEN ACTIVITY from under the pointer, which is precisely the defect
   the drawer was repaired for and which still shows up as a flake in
   check:browser-real. The wholesale swap stays as the fallback for a DOM that cannot
   parse innerHTML, probed with the shipped v670DomCanReconcile rather than by sniffing
   for a test environment. */
function v670RepaintCompactRunStatuses(only = "") {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
  document.querySelectorAll("[data-automation-compact-run]").forEach((node) => {
    const id = node.dataset?.automationCompactRun || node.getAttribute?.("data-automation-compact-run") || "";
    if (!id || (only && id !== only)) return;
    const run = v641RunById(id);
    if (!run) return;
    const markup = v670CompactRunStatusMarkup(run);
    if (typeof v670DomCanReconcile === "function" && typeof v670PatchElement === "function" && v670DomCanReconcile(document)) {
      const staging = document.createElement("div");
      staging.innerHTML = markup;
      const next = staging.firstElementChild;
      if (next) { v670PatchElement(node, next); return; }
    }
    node.outerHTML = markup;
  });
}

/* WHERE A COMPLETED RUN'S RESULT ACTUALLY IS. Batch 2, Slice 1.

   v641RunRoute answers "which workspace owns this run" and is unchanged. It is not a
   wrong answer, it is an incomplete one: it lands the filmmaker at the top of a shot
   and leaves them to find what finished.

   This adds the missing half WITHOUT inventing a panel map. The run records its own
   scope; the scope names a shipped `data-guided-panel` key; and which stage owns that
   panel is a question asked of shared-stage-model.js, which is the module that owns
   the answer. Two of CineBraid's five stages are reachable this way because two are
   the ones automation runs actually produce results in.

   WHY THE HASH IS NOT QUALIFIED. public/app.js's route() reads the id as
   `location.hash.split("/")[2]`, so `#/shot/L1-01?panel=still` would make the shot id
   `L1-01?panel=still` and resolve to no shot at all. The stage selection therefore
   travels the way every other cross-panel action in CineBraid sends it - written
   through the canonical selector before the hash changes - and the hash stays exactly
   the string it has always been.

   IT FAILS CLOSED. Anything this cannot resolve to a declared stage returns the
   existing workspace route with resolved:false, which is the shipped behaviour
   unchanged. Guessing a stage is worse than landing at the top of one. */
/* A RUN SCOPE THAT IS NOT ALREADY A PANEL KEY, translated to one.

   Only two entries, and neither is a stage list: `stills` and `blocking-only` are the
   two shot-chain scopes the shipped automation actually writes, and each names the
   panel its result lands in. Every OTHER scope is resolved by asking the declared stage
   model whether the scope IS a panel it owns — see below — so this table never has to
   grow to keep pace with the model. */
const V670_RUN_SCOPE_PANELS = { stills: "still", "blocking-only": "blocking" };

/* The entity workspace's four declared tasks, addressed by the scopes the entity-chain
   automation writes. These are the same task ids entities.js declares in its `specs`
   array and the same sub-view keys its coverage control writes; nothing here is a new
   name for anything.

     default-only   the run built and approved the BASE reference, so the result is a
                    candidate decision -> Choose & approve.
     state:<id>     the run derived ONE continuity state, so the result is that state ->
                    Coverage & states, states view, that state selected.
     state-chain    the run derived SEVERAL states and names none of them, so the result
                    surface is the states view with no state singled out. Choosing one
                    would be a guess about which of them the director wants. */
/* BATCH 2 SLICE 3 — SAME CONTRACT, MOVED TARGET.

   Slice 1's rule is unchanged and is the reason this map exists: a completed run
   hands off to the surface that OWNS its result, named in the entity workspace's
   own task vocabulary, applied through selectEntityResultTask. Slice 3 retired
   `review` as a peer stage and moved the candidate grid into `reference`, so the
   surface that owns a finished base-reference generation is `reference` now.

   This had to move in the same commit as the task set. A hand-off naming a task
   the workspace no longer declares does not fail loudly — boundedFocusedTask
   silently substitutes a fallback, and the filmmaker lands somewhere plausible
   and wrong, which is the exact "hunt for what finished" Slice 1 removed. */
const V670_ENTITY_SCOPE_TASKS = {
  "default-only": { task: "reference" },
  "state-chain": { task: "coverage", view: "states" },
};

window.v670RunResultTarget = (run) => {
  const base = { route: v641RunRoute(run), kind: "", panel: "", stage: "", view: "", task: "", state: "", resolved: false };
  /* SETTLED, AND NOT ASKING FOR ATTENTION. The shipped predicates already partition
     runs exactly this way, so this asks them instead of re-reading run.status and
     becoming a second opinion about what "finished" means. A run still working, still
     waiting on the director, or sitting in needs-attention has no result to hand
     over. */
  if (!run || v670RunUnsettled(run) || v670AttentionRun(run)) return base;

  if (run.type === "shot-chain") {
    if (typeof shotStageForPanel !== "function") return base;
    const scope = String(run.scope || "");
    /* TWO WAYS IN, ONE VOCABULARY. Either the scope is one of the two shipped scopes
       above, or the scope IS a panel key the declared stage model already owns — which
       is how a motion-scoped run reaches Motion & sound without a second map and
       without this file learning that a stage called "motion" exists. `motion`,
       `motionCreate`, `motionAudio` and `finish` are all declared panels, so all four
       resolve the moment a run carries one; asking shotStageForPanel is what makes that
       the MODEL's answer rather than this file's. */
    const panel = V670_RUN_SCOPE_PANELS[scope] || (shotStageForPanel(scope) ? scope : "");
    if (!panel) return base;
    const stage = shotStageForPanel(panel);
    if (!stage) return base;
    const view = typeof shotStagePanelView === "function" ? shotStagePanelView(panel) || "" : "";
    return { ...base, kind: "shot-stage", panel, stage: stage.id, view, resolved: true };
  }

  if (run.type === "entity-chain") {
    /* RESOLVED MEANS THE REQUESTED IDENTITY EXISTS, not that it parsed.

       The first version of this checked the shape of `list:id` and stopped there, so a
       target naming a collection CineBraid does not have, a reference that was deleted,
       or a continuity state that was never declared all came back resolved:true — and
       the workspace then rendered the state closed, because the thing the run asked for
       was not there. A hand-off that claims to know where a result is, and is wrong, is
       worse than one that admits it does not: the filmmaker stops trusting the button.

       So every half of the identity is verified against the project before this says
       yes, and anything it cannot verify — including a project it cannot read — falls
       back to the workspace route with resolved:false. That is the same fallback a
       scene-chain run gets, and it is honest rather than empty-handed: the route is
       still the right workspace, it simply makes no claim about where inside it. */
    const parts = String(run.targetId || "").split(":");
    /* EXACTLY two segments. `characters:KAI:extra` is not a target with a stray
       suffix — it is a target this build does not understand, and quietly using its
       first two segments is guessing. */
    if (parts.length !== 2) return base;
    const [list, id] = parts;
    if (!list || !id) return base;
    if (!Object.prototype.hasOwnProperty.call(V641_ENTITY_ROUTES, list)) return base;

    const project = typeof P !== "undefined" ? P : null;
    const rows = project && Array.isArray(project[list]) ? project[list] : null;
    if (!rows) return base;
    const entity = rows.find((row) => row && String(row.id) === id) || null;
    if (!entity) return base;

    const scope = String(run.scope || "");
    const perState = /^state:(.+)$/.exec(scope);
    let target = null;
    if (perState) {
      /* The DECLARED states, read without materialising anything. ensureEntityStateList
         would create a default as a side effect of being asked, which would make this
         check able to invent the very state it is verifying. */
      const stateId = perState[1];
      const states = Array.isArray(entity.continuityStates) ? entity.continuityStates : [];
      if (!states.some((state) => state && String(state.id) === stateId)) return base;
      target = { task: "coverage", view: "states", state: stateId };
    } else {
      target = V670_ENTITY_SCOPE_TASKS[scope] || null;
    }
    if (!target) return base;
    return { ...base, kind: "entity-task", task: target.task, view: target.view || "", state: target.state || "", resolved: true };
  }

  /* A scene-chain run fans out across many shots and names no single result, and an
     unknown type names nothing at all. Both keep the workspace route. */
  return base;
};

/* The drawer's hand-off. Selects the stage that owns the result through
   selectGuidedPanelTask - the SAME writer every in-app cross-panel action uses, which
   goes through boundedWriteFocusedTask rather than boundedWriteState, because task
   selection written through the latter is silent and does nothing - and then navigates
   to the route v641RunRoute already returned. */
window.openRunResult = (runId) => {
  const run = v641RunById(runId);
  const target = v670RunResultTarget(run);
  if (target.kind === "shot-stage" && typeof selectGuidedPanelTask === "function" && typeof shotById === "function") {
    const shot = shotById(run.targetId);
    if (shot) selectGuidedPanelTask(shot, target.panel);
  } else if (target.kind === "entity-task" && typeof selectEntityResultTask === "function") {
    const [list, id] = String(run.targetId || "").split(":");
    selectEntityResultTask(list, id, target.task, target.view, target.state);
  }
  /* NAVIGATE WHEN THE ROUTE CHANGES, RENDER WHEN IT DOES NOT.

     Assigning location.hash the value it already holds fires no hashchange, and
     selectGuidedPanelTask writes the selection without redrawing - deliberately, because
     its in-app callers redraw themselves. A filmmaker already standing in the shot the
     run belongs to would therefore have the right stage selected and be left looking at
     the old one, which is the exact "hunt for what finished" this item exists to end. */
  if (location.hash !== target.route) location.hash = target.route;
  else if (typeof route === "function") route();
};

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
function v6602ActivityStatus() {
  const runs = Array.isArray(AUTOMATION_RUNS) ? AUTOMATION_RUNS : [];
  const activeRuns = runs.filter(v670MachineActiveRun);
  const waitingRuns = runs.filter(v670WaitingForHumanRun);
  const activeManual = v670ManualActivityRows().filter((row) => row.status === "running");
  const activeFal = v641StandaloneFalJobs();
  const attention = runs.filter(v670AttentionRun);
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
  /* Not "remains available in Reports": archiving moves a run out of the active set and
     into the finished ones, which the server keeps only up to its run-history limit. The
     old sentence promised a permanence CineBraid does not offer. */
  toast("Alert dismissed. The run is archived and stays in Reports until it ages out of the run history.");
};
/* RECHECK STATUS. The manual entry into the same reconciliation the server
   performs on every read — offered because a creator who suspects a stale gate
   should be able to settle it rather than wait for the next poll, and because a
   surface whose only recovery is "reload and hope" trains people to distrust it.

   It is NOT a dismissal. Nothing here hides an item; the route re-derives every
   parked gate against current project truth and returns the reconciled ledger.
   An item that leaves did so because the work it named is genuinely done. */
window.recheckAutomationGateStatus = async () => {
  let data;
  try {
    const response = await fetch("/api/automation/runs/recheck", { method: "POST" });
    data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Could not recheck automation status");
  } catch (error) {
    return toast(error.message || "Could not recheck automation status");
  }
  AUTOMATION_RUNS = Array.isArray(data.runs) ? data.runs : AUTOMATION_RUNS;
  v641UpdateActivityButton();
  v670AnnounceActivityUpdate();
  const resolved = (data.resolvedRunIds || []).length;
  toast(resolved
    ? `${resolved} gate${resolved === 1 ? "" : "s"} ${resolved === 1 ? "was" : "were"} already satisfied and ${resolved === 1 ? "has" : "have"} been cleared.`
    : `Rechecked ${Number(data.checked || 0)} parked gate${Number(data.checked || 0) === 1 ? "" : "s"}. Everything still waiting genuinely needs you.`);
};
window.archivePreviousAutomationFailures = async () => {
  const ids = (AUTOMATION_RUNS || []).filter(v670AttentionRun).map((run) => run.id);
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
/* THE FLOATING GLOBAL ACTIVITY STRIP IS RETIRED. Batch 2, Slice 1.

   `#automation-global-live-strip` and the topbar chip `#automation-activity-toggle`
   rendered the IDENTICAL v6602ActivityStatus() answer. Two persistent global
   indicators for one derivation is not redundancy, it is a second place to look
   for the same sentence — and the strip sat at the bottom of the screen, where the
   Activity Terminal already lives.

   The chip is now the single persistent global indicator and the single gateway to
   the drawer. Nothing was learned or unlearned by this: v6602ActivityStatus() is
   unchanged and still the only classifier, and v641UpdateActivityButton() still
   renders exactly what it says.

   WHAT DID NOT GO WITH IT: v670AnnounceActivityUpdate(), immediately below. The
   strip carried aria-live="polite"; the announcement is a separate mechanism that
   the persistent creator surfaces repaint from, and removing the strip must not
   remove the app's only spoken notice that activity changed. */

function v641UpdateActivityButton() {
  const button = document.getElementById("automation-activity-toggle");
  if (!button) return;
  const activeRuns = (AUTOMATION_RUNS || []).filter(v670MachineActiveRun);
  const activeManual = v670ManualActivityRows().filter((row) => row.status === "running");
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
  v670AnnounceActivityUpdate();
}
/* WHAT A SCREEN READER IS TOLD, in the classification vocabulary everything else uses.

   v6602ActivityStatus() is the single derivation the topbar chip renders. This turns
   the same answer into one sentence, so an announcement and the chip can never describe
   different states - they are the same object read twice. */
function v670ActivityAnnouncement() {
  const status = v6602ActivityStatus();
  return status.tone === "idle" || !status.detail ? status.label : `${status.label} · ${status.detail}`;
}

/* The last sentence SPOKEN, not the last state seen.

   Activity is recomputed on every 3.5s poll and on every manual row that starts,
   updates or finishes, and most of those recomputations produce the identical sentence.
   Writing an unchanged string into a live region makes a screen reader say it again,
   which turns a useful announcement into a metronome. So the region is written only
   when the sentence itself changes. */
let V670_LAST_ANNOUNCEMENT = null;

/* THE ONE SIGNAL O3 REPAINTS FROM, AND THE ONE THING ASSISTIVE TECHNOLOGY HEARS.

   Every path that changes activity already ends here - the 3.5s refresh, a manual
   activity starting, updating or finishing, a run notification, and init. It does two
   separate things, and the separation is the point:

   1. IT SPEAKS. `#activity-live-region` is a visually-hidden role="status" element
      declared in public/index.html. It is NOT a second visual indicator and carries no
      control: the topbar chip remains the only persistent visual surface for activity.
      The retired floating strip used to carry aria-live="polite" as a side effect of
      being visible, which meant deleting the visible thing silently deleted the spoken
      one. They are now independent, and only one of them has pixels.

   2. IT ANNOUNCES TO THE APP. The event is what the persistent creator surfaces repaint
      from, instead of running a second timer over the same data.

   The DOM write happens FIRST and is not guarded by the CustomEvent probe: a host
   without CustomEvent must still be able to speak. */
function v670AnnounceActivityUpdate() {
  if (typeof document !== "undefined" && typeof document.getElementById === "function") {
    const region = document.getElementById("activity-live-region");
    if (region) {
      let sentence = "";
      try { sentence = v670ActivityAnnouncement(); } catch { sentence = ""; }
      if (sentence && sentence !== V670_LAST_ANNOUNCEMENT) {
        V670_LAST_ANNOUNCEMENT = sentence;
        region.textContent = sentence;
      }
    }
  }
  if (typeof window === "undefined" || typeof CustomEvent !== "function") return;
  try { window.dispatchEvent(new CustomEvent("cinebraid:activity-updated")); } catch {}
}
window.v670ActivityAnnouncement = v670ActivityAnnouncement;
window.refreshGlobalAutomationActivity = async (force = false) => {
  if (V641_ACTIVITY_REFRESHING) return;
  /* Unsettled, not active: a run parked at an approval gate must keep being polled so
     an approval made in another window lands here. */
  const openExists = (AUTOMATION_RUNS || []).some(v670RunUnsettled);
  if (!force && !openExists) return;
  V641_ACTIVITY_REFRESHING = true;
  try {
    const [runData, falData] = await Promise.all([
      fetch("/api/automation/runs").then((response) => response.ok ? response.json() : { runs: AUTOMATION_RUNS || [] }),
      fetch("/api/generation/fal/jobs").then((response) => response.ok ? response.json() : { jobs: FAL_GENERATION_JOBS || [] }),
    ]);
    /* EACH LEDGER IS ADMITTED ON ITS OWN OWNERSHIP — see v670AdmitActivityRows.
       Both routes answer for the server's active project, which is one value for the
       whole machine, so a second tab or another creator on the LAN switching projects
       makes this 3.5-second poll return a DIFFERENT project's rows to a window still
       showing this one. Adopting them is the leak in its most dangerous form, because
       those rows carry working actions. */
    const runs = v670AdmitActivityRows(runData, "runs");
    const jobs = v670AdmitActivityRows(falData, "jobs");
    if (runs.rows) AUTOMATION_RUNS = runs.rows;
    if (jobs.rows) FAL_GENERATION_JOBS = jobs.rows;
    V641_ACTIVITY_FOREIGN_PROJECT = runs.foreign || jobs.foreign || "";
  } catch {}
  finally {
    V641_ACTIVITY_REFRESHING = false;
    v641UpdateActivityButton();
   
    document.querySelectorAll("[data-automation-live-run]").forEach((node) => {
      const run = v641RunById(node.dataset.automationLiveRun);
      if (run) node.outerHTML = v641LiveActivityMarkup(run);
    });
    v670RepaintCompactRunStatuses();
  }
};
/* EVENT-DRIVEN RECONCILIATION. Called by every human approval or rejection that
   writes project authority outside a run's own modal — the entity approval, the
   shot/frame approval — so a gate that has just become satisfied leaves the
   surfaces immediately rather than at the next poll.

   The project is flushed FIRST. The server reconciles against project.json, and
   asking it to re-derive before the approval has reached disk would return the
   stale answer and cache it in the run ledger. */
window.v670ReconcileAfterApproval = async () => {
  try {
    if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
    if (typeof refreshGlobalAutomationActivity === "function") await refreshGlobalAutomationActivity(true);
    v670AnnounceActivityUpdate();
  } catch { /* reconciliation is convergent: the next read performs it anyway */ }
};
window.v641NotifyAutomationActivity = (run) => {
  if (run) {
    const node = document.querySelector(`[data-automation-live-run="${v641SelectorValue(run.id)}"]`);
    if (node) node.outerHTML = v641LiveActivityMarkup(run);
    v670RepaintCompactRunStatuses(run.id);
  }
  v641UpdateActivityButton();
 
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
      const recent = v670ManualActivityRows().find((row) => row.status === "running" && row.system === descriptor.system && Date.now() - Date.parse(row.startedAt || 0) < 1500);
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
  if (toggle) toggle.onclick = () => window.CineBraidCreatorSurfaces?.expandTerminal?.();
  v641UpdateActivityButton();
  if (V641_ACTIVITY_TIMER) clearInterval(V641_ACTIVITY_TIMER);
  /* THE UNIVERSAL REVISION WATCH RIDES THIS TIMER. It is not activity and it is
     not a drawer concern; it is here because this is the lightweight tick the
     application already runs, and a second interval for one HEAD-sized request
     would be a second thing to reason about. What it means lives in public/app.js
     — see watchProjectRevision(). */
  V641_ACTIVITY_TIMER = setInterval(() => {
    refreshGlobalAutomationActivity(false);
    v641TickElapsedLabels();
    if (typeof watchProjectRevision === "function") watchProjectRevision();
  }, V641_ACTIVITY_REFRESH_MS);
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
  return `<section class="shot-related-activity"><header><div><span>RELATED SCENE AUTOMATION</span><b>${esc(run.label || "Scene correction")}</b><small>This work was launched from the scene but targets ${esc(shotId)}. Progress stays visible here.</small></div><button class="chip" onclick="window.CineBraidCreatorSurfaces.expandTerminal('${attr(run.id)}')">OPEN GLOBAL ACTIVITY</button></header>${typeof v670CompactRunStatusMarkup === "function" ? v670CompactRunStatusMarkup(run) : ""}</section>`;
};

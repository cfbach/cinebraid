/* CineBraid — the server-side generation ingest reaper.
 *
 * WHAT IT IS FOR
 *
 * A generation is a paid request that CineBraid hands to a provider and then has to go
 * back for. Every part of going back for it already existed on the server — ask the
 * status URL, fetch the result, download the assets, write them into the project,
 * commit the job row — and every part of DECIDING WHEN to go back for it lived in a
 * browser tab: public/fal-generation.js polls each active job every 3.5 seconds, and
 * public/app.js restarts that loop on load.
 *
 * So the result of a paid render was collected only while a window happened to be open
 * on it. Close the tab during a two-minute video, switch projects, sleep the laptop,
 * and the render completes at the provider, the result sits there, and CineBraid's own
 * record says IN_QUEUE until somebody reopens the exact workspace. The money was spent
 * either way. This closes that gap and nothing else.
 *
 * THE INVARIANT, WHICH IS THE WHOLE DESIGN
 *
 *   IT MAY INGEST EXISTING PROVIDER WORK. IT MUST NEVER SUBMIT NEW PROVIDER WORK.
 *
 * This is not enforced by care, it is enforced by reach. The reaper is handed the
 * `recovery` handle from fal-generation.js — providerReady, ownerFor, jobsFor, collect
 * — and that object contains no submit, no retry, no repair-and-retry and no job
 * constructor. There is no expression in this file that could dispatch a request,
 * because there is no function in scope that dispatches one. `collect` reaches the
 * network only through refresh(), which fetches a status URL this job already carries,
 * fetches the result URL that status names, and downloads the assets in it.
 *
 * IT IS NOT A RUNNER. It does not start work, choose work, order work or retry work. It
 * asks about requests already in flight and takes delivery. A job with nothing to ask
 * about is left exactly as it is — including a job whose submission outcome is unknown,
 * which only a person can settle (see generation-lifecycle.js reconcileUnresolved).
 *
 * WHAT IT REFUSES TO WRITE. "I could not ask right now" is not "the provider failed".
 * A transient network fault, a provider 500, a paused laptop — none of them establish
 * anything about a render that may well be running and has certainly been charged for.
 * The reaper therefore commits NOTHING on a failed poll: it backs off and asks later.
 * (The browser's Refresh button still records the failure, because a person asked and
 * is owed an answer. See collectJob's markFailureOnError in fal-generation.js.)
 */

const Lifecycle = require("./generation-lifecycle");

/* Deliberately slower than the browser's 3.5 seconds. A tab polls to keep a progress bar
   moving; this sweep answers to nothing on screen and has no reason to be that eager.
   Twenty seconds is far below any provider's queue latency and costs one status request
   per unfinished job. */
const DEFAULTS = {
  intervalMs: 20_000,
  /* Long enough that a boot sweep never competes with the first page load. */
  bootDelayMs: 1_500,
  /* Stop ASKING about a job nothing has touched in a day. Nothing is written and no
     status is invented — an abandoned job keeps whatever it truthfully says. This only
     stops CineBraid spending a request every twenty seconds, forever, on a queue entry
     the provider has long since discarded. A person can still press Refresh. */
  abandonAfterMs: 24 * 60 * 60 * 1_000,
  /* Bounded backoff for a job whose status request keeps failing. */
  backoffStartMs: 60_000,
  backoffMaxMs: 15 * 60_000,
  /* How long shutdown may wait for a collection already in flight. Deliberately inside
     server.js's existing 5s force-exit envelope, so waiting for recovery can never be
     what makes CineBraid fail to exit. See stop(). */
  stopGraceMs: 4_000,
};

/* Statuses that describe a request whose RESULT may still be owed to CineBraid.
 *
 *   SUBMITTING            included because the handle test below is the real gate: a row
 *                         with a provider request id names a request the provider
 *                         demonstrably took, and one without is refused there.
 *   SUBMITTED/IN_QUEUE/
 *   IN_PROGRESS           a render the provider is working on.
 *   UNRESOLVED            we do not know whether it was accepted. If it carries a
 *                         request id and a status URL we can ASK — which is not the same
 *                         as deciding, and is the only thing that could ever settle it
 *                         without guessing. Reconciliation stays a person's job.
 *   COMPLETED             the provider is finished and CineBraid has not taken delivery.
 *                         Terminal, but undelivered — which is the exact shape of paid
 *                         work this exists to collect. The already-delivered test above
 *                         is what stops a delivered result being re-collected, not this.
 *
 * FAILED and CANCELLED are absent: both are settled outcomes with nothing owed. ORPHANED
 * is absent because it means a person found the render at the provider and CineBraid has
 * no identifier for it — there is nothing to ask with. */
const COLLECTABLE_STATUSES = new Set(["SUBMITTING", "SUBMITTED", "IN_QUEUE", "IN_PROGRESS", "COMPLETED", Lifecycle.UNRESOLVED]);

function refuse(reason) { return { eligible: false, reason }; }
function lastTouchedAt(job) {
  for (const value of [job?.updatedAt, job?.createdAt]) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/* MAY THE REAPER ASK THE PROVIDER ABOUT THIS JOB?
 *
 * Pure, and derived entirely from fields the durable ledger already persists — no new
 * state, no poller-owned flags on the row. Each refusal names itself so a sweep can be
 * explained without re-deriving it, and so the negative controls can assert on the
 * reason rather than on the absence of a side effect.
 *
 * Order matters: the strongest fact first. A delivered result is delivered whatever the
 * status field says, and a job a person has reconciled is settled whatever it was. */
function pollEligibility(job, options = {}) {
  const at = Number.isFinite(Number(options.at)) ? Number(options.at) : Date.now();
  const abandonAfterMs = Number(options.abandonAfterMs) > 0 ? Number(options.abandonAfterMs) : DEFAULTS.abandonAfterMs;

  if (!job || typeof job !== "object") return refuse("not-a-job");
  /* Delivered is the strongest fact on the row and it outranks the status field: the
     bytes are in the project, the candidate rows are written, and collecting again
     would duplicate both. */
  if (job.ingestedAt) return refuse("already-delivered");
  /* A person went and looked and recorded what they found. That answer stands, and a
     background sweep does not get to reopen it. */
  if (job.reconciliation) return refuse("reconciled-by-hand");
  if (!COLLECTABLE_STATUSES.has(String(job.status || ""))) return refuse("nothing-to-collect");
  /* THE HANDLE. Without the provider's own request id there is no evidence it ever took
     this request, and without a status URL there is nowhere to ask. Polling anyway
     would fetch an empty address and report the resulting error as though the provider
     had answered — a failure invented out of not being able to look. */
  if (!Lifecycle.providerRequestId(job)) return refuse("no-provider-request-id");
  if (!String(job.statusUrl || "")) return refuse("no-status-handle");
  const touched = lastTouchedAt(job);
  if (touched !== null && at - touched >= abandonAfterMs) return refuse("abandoned");
  return { eligible: true, reason: "pollable" };
}

/* The eligible rows of one ledger, in ledger order. Separated from the sweep so the
   decision can be tested against a ledger without a provider, a clock or a filesystem. */
function eligibleJobs(jobs, options = {}) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => pollEligibility(job, options).eligible);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
function resolveOptions(options = {}) {
  return {
    intervalMs: positiveNumber(options.intervalMs ?? process.env.CINEBRAID_GENERATION_POLL_MS, DEFAULTS.intervalMs),
    bootDelayMs: positiveNumber(options.bootDelayMs ?? process.env.CINEBRAID_GENERATION_POLL_BOOT_MS, DEFAULTS.bootDelayMs),
    abandonAfterMs: positiveNumber(options.abandonAfterMs, DEFAULTS.abandonAfterMs),
    backoffStartMs: positiveNumber(options.backoffStartMs, DEFAULTS.backoffStartMs),
    backoffMaxMs: positiveNumber(options.backoffMaxMs, DEFAULTS.backoffMaxMs),
    stopGraceMs: positiveNumber(options.stopGraceMs, DEFAULTS.stopGraceMs),
  };
}
/* CINEBRAID_GENERATION_POLL=off switches the sweep off entirely. It exists for suites
   that spawn a server to observe one exact thing and must not have a background sweep
   moving underneath them; it is not a product setting. */
function pollerEnabled() {
  return String(process.env.CINEBRAID_GENERATION_POLL || "").toLowerCase() !== "off";
}

/* ---------------------------------------------------------------------------
   THE SWEEP

   One tick walks every project's durable ledger, decides eligibility from the rows
   themselves, and collects. Deliberately sequential: two paid results downloading at
   once buys nothing and a background task must not be the reason a save is slow.

   TICKS DO NOT OVERLAP. `running` holds for the whole sweep, so a slow provider cannot
   stack sweeps on top of each other. That is the first of the two guards against
   double delivery; the second is the per-job serialised turn inside collect(), which is
   also what makes a browser tab and this sweep safe on the same job at the same time —
   whichever arrives second re-reads the row and finds the first one's ingest stamp. */
function createGenerationPoller(deps = {}) {
  const listProjectSlugs = typeof deps.listProjectSlugs === "function" ? deps.listProjectSlugs : () => [];
  const recovery = deps.recovery || {};
  const reconcileStaleRuns = typeof deps.reconcileStaleRuns === "function" ? deps.reconcileStaleRuns : null;
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const options = resolveOptions(deps.options);

  /* Failure backoff, per job, in memory. NOT on the job row: a durable "the poller could
     not reach the provider" field would be a second lifecycle, and would outlive the
     process that observed it. Losing it on restart is correct — a fresh process has no
     reason to believe a request it has never made will fail. */
  const backoff = new Map();
  let bootTimer = null;
  let tickTimer = null;
  let running = false;
  let stopped = false;
  /* The sweep in flight, or null when idle. This is what stop() waits on, and it is the
     only reason the tick is split into `sweep` and `runOnce` below. */
  let active = null;

  function backoffKey(slug, jobId) { return `${slug}::${jobId}`; }
  function recordFailure(key, at) {
    const previous = backoff.get(key);
    const failures = (previous?.failures || 0) + 1;
    const delay = Math.min(options.backoffMaxMs, options.backoffStartMs * 2 ** (failures - 1));
    backoff.set(key, { failures, until: at + delay });
  }

  async function sweep() {
    const at = Date.now();
    const summary = {
      ran: true, at, projects: 0, examined: 0, polled: 0, collected: 0, results: 0,
      failed: 0, skipped: 0, staleRuns: [], providerReady: true, unreadable: [],
    };
    try {
      /* STATE TRUTH FIRST, and independently of the provider. A run whose lease has
         lapsed is a lie in the ledger whether or not generation is configured, and
         correcting it neither starts nor resumes anything. */
      if (reconcileStaleRuns) {
        try {
          const reconciled = reconcileStaleRuns(at) || [];
          summary.staleRuns = reconciled;
          if (reconciled.length)
            /* Lease language, not browser language: the server observes an expired lease
               and a missing heartbeat, and never whether a window is open. See
               automation-runs.js reconcileStaleLeases. */
            log(`  CineBraid recorded ${reconciled.length} automation run${reconciled.length === 1 ? "" : "s"} as interrupted: ${reconciled.length === 1 ? "its lease" : "their leases"} expired with no heartbeat. Nothing was resumed.`);
        } catch { /* a run ledger that cannot be read is not a reason to skip generation */ }
      }
      /* Generation switched off, or no key: there is nothing this can ask, and nothing
         it may conclude from that. No row is touched and no failure is recorded. */
      if (typeof recovery.providerReady !== "function" || !recovery.providerReady()) {
        summary.providerReady = false;
        return summary;
      }
      const live = new Set();
      for (const slug of listProjectSlugs()) {
        let owner;
        let jobs;
        try {
          owner = recovery.ownerFor(slug);
          jobs = recovery.jobsFor(owner);
        } catch (error) {
          /* A missing project, or a ledger whose primary and backup are both unreadable.
             Both are somebody else's refusal to answer; a sweep skips and never writes. */
          summary.unreadable.push({ slug, error: String(error?.message || error) });
          continue;
        }
        summary.projects += 1;
        summary.examined += jobs.length;
        /* Decided for the whole ledger before anything is asked, so what the sweep
           collects is a function of the rows it read and nothing it did afterwards. */
        const collectable = eligibleJobs(jobs, { at, abandonAfterMs: options.abandonAfterMs });
        summary.skipped += jobs.length - collectable.length;
        for (const job of collectable) {
          if (stopped) return summary;
          const key = backoffKey(slug, job.id);
          live.add(key);
          const gate = backoff.get(key);
          if (gate && gate.until > at) {
            summary.skipped += 1;
            continue;
          }
          let result;
          try {
            /* markFailureOnError:false — see the header. unattended:true says only that
               THIS sweep is the collector, which is what makes the result countable as
               background recovery. It is not, and cannot be, a statement about whether
               a window is open: nothing on the server observes browsers. */
            result = await recovery.collect(owner, job.id, { markFailureOnError: false, unattended: true });
          } catch (error) {
            summary.failed += 1;
            recordFailure(key, at);
            continue;
          }
          summary.polled += 1;
          if (result?.ok) {
            backoff.delete(key);
            if (result.collected) {
              summary.collected += 1;
              summary.results += Math.max(0, Number(result.outputs) || 0);
            }
          } else if (result?.outcome === "provider-error") {
            summary.failed += 1;
            recordFailure(key, at);
          } else {
            /* not-found or no-handle: nothing to back off from and nothing to retry.
               Eligibility already answers for it on the next sweep. */
            backoff.delete(key);
          }
        }
      }
      /* A job that is no longer eligible cannot be retried, so its backoff entry can
         only grow the map. Dropped here rather than on completion, because a job may
         become ineligible without this sweep ever touching it. */
      for (const key of [...backoff.keys()]) if (!live.has(key)) backoff.delete(key);
      if (summary.collected)
        log(`  CineBraid collected ${summary.results} generation result${summary.results === 1 ? "" : "s"} from ${summary.collected} request${summary.collected === 1 ? "" : "s"} through background recovery.`);
      return summary;
    } finally {
      running = false;
      active = null;
    }
  }

  /* ONE TICK. Ticks do not overlap: a sweep already in flight is reported rather than a
     second one started. Split from `sweep` only so the in-flight promise is reachable —
     `active` is what stop() waits on, and without a handle on it a shutdown could exit
     underneath a collection that had already begun. */
  function runOnce() {
    if (running) return Promise.resolve({ ran: false, reason: "already-running" });
    running = true;
    active = sweep();
    return active;
  }

  function schedule() {
    if (stopped || tickTimer) return;
    tickTimer = setInterval(() => { runOnce().catch(() => {}); }, options.intervalMs);
    /* Unref'd on purpose. A background sweep must never be the reason a process stays
       alive — see tests/browser-workflow-exit.js for what a ref'd background timer
       costs. The HTTP listener is what keeps the server up. */
    if (typeof tickTimer.unref === "function") tickTimer.unref();
  }

  /* The boot scan. Delayed so it never competes with the first page load, and it is the
     answer to "what finished while CineBraid was not running at all". */
  function start() {
    if (stopped || bootTimer || tickTimer || !pollerEnabled()) return false;
    bootTimer = setTimeout(() => {
      bootTimer = null;
      runOnce().catch(() => {}).then(schedule, schedule);
    }, options.bootDelayMs);
    if (typeof bootTimer.unref === "function") bootTimer.unref();
    return true;
  }
  /* STOP SCHEDULING, AND WAIT FOR A COLLECTION ALREADY UNDER WAY.
   *
   * Clearing the timers stops the NEXT sweep; it does nothing to the one already
   * running. A sweep in flight can be between the project write and the ledger's ingest
   * stamp — a moment where the candidate rows and their files exist and the job row does
   * not yet record that it delivered them. A process that exits there leaves the next
   * boot to collect the same already-paid result a second time.
   *
   * WHAT IT WAITS FOR: exactly the sweep in flight, and nothing more. `stopped` is set
   * before the wait and the sweep checks it between jobs, so at most the ONE collection
   * already in progress runs to its boundary; every other eligible row is left for the
   * next process, which is the correct answer for work nobody has started.
   *
   * BOUNDED, AND SAFE WHEN THE BOUND IS HIT. `stopGraceMs` caps the wait so a provider
   * that never answers cannot hold CineBraid open. Exceeding it is safe rather than
   * merely tolerated: the download phase in fal-generation.js writes nothing to disk and
   * holds no project state, so an abandoned download leaves no file to orphan and no
   * half-applied project mutation — the collection simply did not happen.
   *
   * A SWEEP THAT REJECTS IS NOT A REASON TO REFUSE TO SHUT DOWN. A rejection is absorbed
   * here and reported as settled; the shutdown path has no use for the distinction and
   * an unhandled rejection during exit would be worse than the error it names.
   *
   * Timers are cleared BEFORE the first await, so a caller that never awaits the result
   * still gets the whole of the old synchronous behaviour. */
  async function stop({ graceMs } = {}) {
    const grace = positiveNumber(graceMs, options.stopGraceMs);
    stopped = true;
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    const inFlight = active;
    if (!inFlight) return { waited: false, timedOut: false };
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timed-out"), grace);
      if (typeof timer.unref === "function") timer.unref();
    });
    const outcome = await Promise.race([inFlight.then(() => "settled", () => "settled"), deadline]);
    if (timer) clearTimeout(timer);
    return { waited: true, timedOut: outcome === "timed-out" };
  }

  return { start, stop, runOnce, options, isRunning: () => running };
}

module.exports = {
  COLLECTABLE_STATUSES,
  DEFAULTS,
  createGenerationPoller,
  eligibleJobs,
  pollEligibility,
  pollerEnabled,
};

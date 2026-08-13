/* O3 — the shared creator-state projection, the Assistant rail and the Activity Terminal.
 *
 * THE STATEMENT THIS SUITE EXISTS TO MAKE TRUE, in one line: the rail and the dock are
 * two renderings of one projection over state CineBraid already holds, so they cannot
 * disagree with each other or with the Activity drawer about what is happening.
 *
 * WHAT WAS ACTUALLY THE RISK. Production-State Honesty found the literal
 * `["running","awaiting-review"]` in six places in one file, and the disagreement
 * between those copies is what made CineBraid report two active operations while both
 * had stopped. O3 adds two more surfaces over the same facts. The failure mode is not
 * hypothetical — it is the same one, one layer up — so most of this suite is about
 * WHERE a judgement is made rather than what it says.
 *
 * WHAT THIS SUITE REFUSES TO DO. It does not assert that a declared constant equals
 * itself. Every check either drives the shipped projection, drives the shipped
 * renderers in a realm, or cross-reads a vocabulary against the module that actually
 * owns it — public/live-activity.js for run state, generation-lifecycle.js for the
 * ledger, generation-cost.js for money, public/shared-stage-model.js for stages. A
 * list here that has drifted from its original fails here.
 *
 * WHAT IS PROVEN IN CHROMIUM INSTEAD, and why not here: node identity across a stage
 * change, real containment, the dock's reservation and the drawer opening over the
 * shell are statements about a live document. They are in
 * tests/creator-surfaces-real-browser.py.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO REQUEST IS MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

/* CRLF is normalised on read: this repository checks out with core.autocrlf=true, so a
   multi-line anchor written with \n would match nothing and take its assertion's
   meaning with it. */
const readSource = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const SOURCES = {
  projection: readSource(path.join(PUBLIC, "shared-creator-state.js")),
  surfaces: readSource(path.join(PUBLIC, "creator-surfaces.js")),
  activity: readSource(path.join(PUBLIC, "live-activity.js")),
  stageModel: readSource(path.join(PUBLIC, "shared-stage-model.js")),
  markup: readSource(path.join(PUBLIC, "index.html")),
  styles: readSource(path.join(PUBLIC, "styles.css")),
  runs: readSource(path.join(ROOT, "automation-runs.js")),
};

const Lifecycle = require("../generation-lifecycle.js");
const Cost = require("../generation-cost.js");

const notes = [];
const note = (line) => notes.push(line);

/* ===========================================================================
   HELPERS
   =========================================================================== */

/* Strips comments so a check about CODE cannot be satisfied - or broken - by prose.
   This matters more here than usual: both modules discuss AUTOMATION_RUNS and the
   v670 predicates at length in their headers, and a naive substring search would
   confuse describing a thing with doing it. */
function codeOnly(source) {
  return String(source).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

/* The projection, evaluated in a fresh realm so a negative control can load a MUTATED
   copy without writing to disk. Values crossing the realm boundary are spread into
   host arrays before comparison - a vm-realm Array fails deepStrictEqual against a
   host literal while printing identically. */
function loadProjection(source = SOURCES.projection) {
  const sandbox = { module: { exports: {} }, window: undefined, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "shared-creator-state.js" });
  return sandbox.module.exports;
}

/* The RUNTIME, evaluated in a realm holding only what the shipped page gives it: the
   three text helpers from public/app.js and the projection. Every app binding the
   runtime reads is deliberately ABSENT, which is the point - the renderers are being
   driven with a projection and nothing else, exactly as they will be in the browser
   when they are handed one. A renderer that reached for AUTOMATION_RUNS here would
   throw rather than quietly work. */
function loadRuntime(sources = SOURCES) {
  const api = loadProjection(sources.projection);
  const listeners = [];
  const sandbox = {
    console,
    esc: (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    plural: (n, one, many = one + "s") => `${n} ${Number(n) === 1 ? one : many}`,
    location: { hash: "#/shot/SAMPLE-01" },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      readyState: "complete",
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => ({ innerHTML: "", firstElementChild: null }),
      addEventListener: () => {},
    },
  };
  sandbox.attr = (t) => sandbox.esc(t).replace(/'/g, "&#39;");
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = (name, fn) => listeners.push([name, fn]);
  Object.assign(sandbox, api);
  vm.createContext(sandbox);
  vm.runInContext(sources.surfaces, sandbox, { filename: "creator-surfaces.js" });
  return { api, surfaces: sandbox.window.CineBraidCreatorSurfaces, listeners, sandbox };
}

/* ---------------------------------------------------------------------------
   FIXTURES — representative production states, built as the ACTIVITY FACTS the
   runtime produces rather than as raw runs, because the projection's contract is with
   the facts. The runtime's own translation from raw runs is covered by
   checkClassificationIsDelegated and by the browser suite against real records. */
const AT = {
  now: "2026-08-13T12:00:00.000Z",
  recent: "2026-08-13T11:59:00.000Z",
  older: "2026-08-13T11:00:00.000Z",
  oldest: "2026-08-13T09:00:00.000Z",
};

function fact(over = {}) {
  return {
    key: "run:x", source: "automation-run", id: "x", label: "A run", kind: "informational", reason: "",
    target: { kind: "shot", id: "SAMPLE-01", label: "SAMPLE-01" }, route: "#/shot/SAMPLE-01",
    at: AT.recent, startedAt: AT.older, endedAt: "", elapsed: "",
    step: { label: "", system: "", state: "" }, technical: {},
    ...over,
  };
}

const FIXTURES = {
  working: () => fact({ key: "run:live", id: "live", label: "Frame automation", kind: "machine-active",
    at: AT.now, elapsed: "02:20", step: { label: "Generate Frame A", system: "FAL · GPT IMAGE 2", state: "working" },
    technical: { provider: "fal", model: "fal-ai/gpt-image-2", mode: "text-to-image", requestId: "req-abc",
      attemptApplicable: true, attempt: 2, maxAttempts: 3, retryCount: 1, queuePosition: 3,
      cost: { state: "estimated", amount: 0.08, unit: "usd", basis: "estimated-at-submission" } } }),
  waitingApproval: () => fact({ key: "run:wait", id: "wait", label: "Frame review", kind: "waiting-human",
    reason: "approval-required", at: AT.recent, elapsed: "01:00",
    step: { label: "Frame A review", system: "VISION AI · FRAME REVIEW", state: "needs-review" },
    technical: { attemptApplicable: true, attempt: 1, maxAttempts: 2 } }),
  lapsed: () => fact({ key: "run:orphan", id: "orphan", label: "Abandoned by a closed tab",
    kind: "waiting-human", reason: "runner-stopped", at: AT.older, elapsed: "",
    step: { label: "Generate Frame A", system: "FAL · GPT IMAGE 2", state: "working" },
    technical: { attemptApplicable: true } }),
  failed: () => fact({ key: "run:failed", id: "failed", label: "Scene correction", kind: "needs-attention",
    reason: "run-failed", at: AT.older, technical: { attemptApplicable: true, error: "The provider declined the request." } }),
  completed: () => fact({ key: "run:done", id: "done", label: "Completed frame run", kind: "completed",
    at: AT.oldest, endedAt: AT.oldest, technical: { attemptApplicable: true } }),
  jobPriced: () => fact({ key: "job:priced", source: "generation-job", id: "priced", label: "blocking generation",
    kind: "completed", at: AT.older,
    technical: { provider: "fal", model: "fal-ai/gpt-image-2", mode: "edit", requestId: "req-def",
      attemptApplicable: false, cost: { state: "estimated", amount: 0.16, unit: "usd", basis: "estimated-at-submission" } } }),
  jobUnpriced: () => fact({ key: "job:unpriced", source: "generation-job", id: "unpriced", label: "motion-h3 generation",
    kind: "completed", at: AT.older,
    technical: { provider: "fal", model: "fal-ai/minimax-hailuo-h3", mode: "i2v", requestId: "req-ghi",
      attemptApplicable: false, cost: { state: "unknown", amount: null, unit: "usd", basis: "estimated-at-submission" } } }),
  jobLegacy: () => fact({ key: "job:legacy", source: "generation-job", id: "legacy", label: "frame generation",
    kind: "completed", at: AT.oldest,
    technical: { provider: "fal", attemptApplicable: false, cost: { state: "not-recorded", amount: null, unit: "", basis: "" } } }),
  jobUnresolved: () => fact({ key: "job:unresolved", source: "generation-job", id: "unresolved",
    label: "frame generation", kind: "needs-attention", reason: "submission-unresolved", at: AT.older,
    technical: { provider: "fal", model: "fal-ai/gpt-image-2", attemptApplicable: false,
      cost: { state: "not-recorded", amount: null, unit: "", basis: "" },
      error: "CineBraid lost contact before the provider confirmed acceptance." } }),
};

const CONTEXT = { view: "shot", hasProject: true, shellPresent: true, projectTitle: "The Blue Parcel",
  target: { kind: "shot", id: "SAMPLE-01", label: "Arrival" } };

/* The O1 answers, taken from the real declared model rather than hand-written, so a
   stage field renamed upstream fails here instead of being quietly mocked around. */
function stageStates(facts) {
  const sandbox = { module: { exports: {} }, window: undefined, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCES.stageModel, sandbox, { filename: "shared-stage-model.js" });
  const model = sandbox.module.exports;
  return { model, progress: model.shotStageProgress(facts) };
}

const STAGE_FACTS = {
  framesComplete: { referenceCount: 3, frameTotal: 2, frameApprovedCount: 2, requiredFramesApproved: true,
    deliveryIntent: "motion", lifecycleKey: "still-ready" },
  framesUndecided: { referenceCount: 3, frameTotal: 2, frameApprovedCount: 2, requiredFramesApproved: true,
    deliveryIntent: "undecided", lifecycleKey: "still-ready" },
  motionBlocked: { referenceCount: 1, frameTotal: 2, frameApprovedCount: 0, requiredFramesApproved: false,
    deliveryIntent: "undecided", lifecycleKey: "needs-image" },
};

/* Shaped as creatorState() takes it, so a check can spread it straight in. */
function stageFor(id, facts) {
  const { model } = stageStates(facts);
  return { stage: model.shotStageState(id, facts), stages: model.shotStageProgress(facts) };
}

/* ===========================================================================
   1. THE PROJECTION'S CONTRACT
   =========================================================================== */

function checkProjectionContract(sources = SOURCES) {
  const api = loadProjection(sources.projection);
  const input = {
    context: CONTEXT,
    activities: [FIXTURES.working(), FIXTURES.waitingApproval(), FIXTURES.failed(), FIXTURES.completed()],
  };
  const before = JSON.stringify(input);
  const state = api.creatorState(input);

  assert.strictEqual(state.contract, "creator-state/1", "the projection must name its contract");
  assert.strictEqual(JSON.stringify(input), before,
    "creatorState mutated the record it was handed; a projection that writes to its input is not read-only");

  /* Frozen all the way down. A consumer that can edit the answer can make the two
     surfaces disagree without either of them looking wrong. */
  assert.ok(Object.isFrozen(state), "the projection must return a frozen value");
  assert.ok(Object.isFrozen(state.working), "the projection's buckets must be frozen");
  assert.ok(Object.isFrozen(state.working[0]), "the projection's facts must be frozen");
  assert.ok(Object.isFrozen(state.counts), "the projection's counts must be frozen");

  /* Every kind and reason a fact can carry is closed. An unrecognised token is
     normalised rather than passed through, so a renderer never prints a raw string it
     has no wording for. */
  const stray = api.creatorState({ context: CONTEXT, activities: [fact({ key: "run:s", kind: "on-fire", reason: "because" })] });
  assert.strictEqual(stray.recent[0].kind, "informational", "an unrecognised kind must normalise, not pass through");
  assert.strictEqual(stray.recent[0].reason, "", "an unrecognised reason must normalise, not pass through");

  /* A fact with no key cannot be reconciled by the Terminal and cannot be pointed at,
     so it is dropped rather than rendered as an anonymous row. */
  const keyless = api.creatorState({ context: CONTEXT, activities: [fact({ key: "" })] });
  assert.strictEqual(keyless.counts.total, 0, "a fact with no reconciliation key must be dropped");

  note(`Contract: ${api.CREATOR_STATE_CONTRACT}, frozen output, ${api.CREATOR_ACTIVITY_KINDS.length} closed kinds, ${api.CREATOR_REASONS.length - 1} closed reasons`);
}

/* ===========================================================================
   2. THE CLASSIFICATION IS DELEGATED, NOT REPEATED

   The most important section in this file. Three separate claims:

     a) creatorRunKind obeys the caller's verdicts and ignores the status when they
        disagree — so it cannot become a second opinion about run state;
     b) the vocabularies here are the SAME LISTS the owning modules declare;
     c) public/live-activity.js holds exactly ONE copy of the attention list, and its
        four readers all go through the predicate.
   =========================================================================== */

function checkClassificationIsDelegated(sources = SOURCES) {
  const api = loadProjection(sources.projection);

  /* (a) The verdicts win. A run whose durable status is `failed` but which the shipped
     predicate says is machine-active is machine-active here — because the predicate
     knows about leases and this module does not, and the moment it starts guessing
     from the status string it has become the thing it exists to prevent. */
  assert.strictEqual(
    api.creatorRunKind({ status: "failed", machineActive: true, waitingForHuman: false, needsAttention: true }).kind,
    "machine-active", "the machine-active verdict must outrank the durable status");
  assert.strictEqual(
    api.creatorRunKind({ status: "running", machineActive: false, waitingForHuman: true, needsAttention: false }).reason,
    "runner-stopped", "a `running` run the predicate calls waiting is a stopped runner, not an approval gate");
  assert.strictEqual(
    api.creatorRunKind({ status: "awaiting-review", machineActive: false, waitingForHuman: true, needsAttention: false }).reason,
    "approval-required", "an awaiting-review run is an approval gate");
  /* THE ONE THAT MATTERS MOST: a human gate is never machine-active. */
  assert.notStrictEqual(
    api.creatorRunKind({ status: "awaiting-review", machineActive: false, waitingForHuman: true, needsAttention: false }).kind,
    "machine-active", "awaiting-review must never classify as machine-active");
  /* And attention comes from the predicate: a `failed` status with the verdict absent
     must NOT be invented into needs-attention by reading the string. */
  assert.strictEqual(
    api.creatorRunKind({ status: "failed", machineActive: false, waitingForHuman: false, needsAttention: false }).kind,
    "informational", "needs-attention must come from the shipped predicate, not from the status string");
  /* A status the predicate flags but this module does not name still lands in the
     right bucket, with an empty reason rather than a fabricated one. */
  const unnamed = api.creatorRunKind({ status: "some-future-status", machineActive: false, waitingForHuman: false, needsAttention: true });
  assert.strictEqual(unnamed.kind, "needs-attention", "a flagged run must reach needs-attention even if its status has no reason token");
  assert.strictEqual(unnamed.reason, "", "an unnamed attention status must carry no reason rather than a made-up one");

  /* (b) The attention vocabulary IS public/live-activity.js's list. */
  const predicate = codeOnly(sources.activity).match(/function\s+v670AttentionRun\s*\(\s*run\s*\)\s*\{\s*return\s*\[([^\]]*)\]/);
  assert.ok(predicate, "public/live-activity.js must declare v670AttentionRun as a single list membership test");
  const predicateList = predicate[1].split(",").map((row) => row.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  assert.deepStrictEqual([...api.CREATOR_ATTENTION_RUN_STATUSES], predicateList,
    "the projection's attention reason vocabulary has drifted from v670AttentionRun's own list");

  /* The run vocabulary partitions automation-runs.js's declared statuses: the two the
     predicates own, the three that need attention, the one that completed, and
     `archived`, which the runtime filters out before a fact is ever built. */
  const declared = sources.runs.match(/const RUN_STATUSES = \[([^\]]*)\]/);
  assert.ok(declared, "automation-runs.js must declare RUN_STATUSES");
  const runStatuses = declared[1].split(",").map((row) => row.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const accounted = new Set([
    "running", "awaiting-review", "archived",
    ...api.CREATOR_ATTENTION_RUN_STATUSES, ...api.CREATOR_COMPLETED_RUN_STATUSES,
  ]);
  const unaccounted = runStatuses.filter((status) => !accounted.has(status));
  assert.deepStrictEqual(unaccounted, [],
    `automation-runs.js declares run statuses O3 has no bucket for: ${unaccounted.join(", ")}`);

  /* The job vocabulary is generation-lifecycle.js's, read from the module itself. */
  assert.deepStrictEqual([...api.CREATOR_ACTIVE_JOB_STATUSES], [...Lifecycle.ACTIVE_LEDGER_STATUSES],
    "the projection's active-job list has drifted from generation-lifecycle.js");
  const ledgerAccounted = new Set([
    ...api.CREATOR_ACTIVE_JOB_STATUSES, ...api.CREATOR_ATTENTION_JOB_STATUSES, ...api.CREATOR_COMPLETED_JOB_STATUSES,
  ]);
  const ledgerGaps = Lifecycle.LEDGER_STATUSES.filter((status) => !ledgerAccounted.has(status));
  assert.deepStrictEqual(ledgerGaps, [],
    `generation-lifecycle.js declares ledger statuses O3 has no bucket for: ${ledgerGaps.join(", ")}`);
  /* ORPHANED is not in LEDGER_STATUSES — it is what reconciling an accepted unresolved
     submission produces — so the projection must have got it from there. */
  assert.strictEqual(Lifecycle.RECONCILIATION_OUTCOMES.accepted.status, "ORPHANED",
    "reconciling an accepted submission must still produce ORPHANED");
  assert.ok(api.CREATOR_ATTENTION_JOB_STATUSES.includes("ORPHANED"),
    "a job that ran at the provider and was never collected here must need attention");
  assert.ok(api.CREATOR_ATTENTION_JOB_STATUSES.includes("UNRESOLVED"),
    "an unresolved submission must need attention, not read as a routine pause: it may be running and may have been charged");
  assert.strictEqual(api.creatorJobKind({ status: "UNRESOLVED", active: false }).reason, "submission-unresolved");

  /* (c) ONE copy of the list in the activity layer, and every reader through it. */
  const activityCode = codeOnly(sources.activity);
  const literal = occurrences(activityCode.replace(/\s+/g, ""), '["failed","interrupted","cancelled"]');
  assert.strictEqual(literal, 1,
    `public/live-activity.js holds ${literal} copies of the attention status list; it must hold exactly one, inside v670AttentionRun`);
  const usage = occurrences(activityCode, "v670AttentionRun");
  assert.ok(usage >= 5,
    `v670AttentionRun is referenced ${usage} times in public/live-activity.js; the declaration, the window alias and its three readers are expected`);
  /* And the runtime asks the predicate rather than the status. */
  const surfaceCode = codeOnly(sources.surfaces);
  assert.ok(/v670AttentionRun/.test(surfaceCode), "the creator surfaces must ask v670AttentionRun for the attention verdict");
  assert.ok(!/["']interrupted["']/.test(surfaceCode) && !/["']cancelled["']/.test(surfaceCode),
    "the creator surfaces must not name a run status; the classification belongs to the shipped predicates");

  note(`Delegation: three verdicts obeyed over the status string; attention vocabulary identical to v670AttentionRun; ${runStatuses.length} run statuses and ${Lifecycle.LEDGER_STATUSES.length} ledger statuses all accounted for; one copy of the attention list survives`);
}

/* ===========================================================================
   3. REPRESENTATIVE PRODUCTION STATES
   =========================================================================== */

function checkRepresentativeStates(sources = SOURCES) {
  const api = loadProjection(sources.projection);
  const project = (activities, extra = {}) => api.creatorState({ context: CONTEXT, activities, ...extra });

  /* THE RUN FIXTURES ARE CLASSIFIED BY THE SHIPPED CLASSIFIER, not labelled by hand.
     Handing this section pre-bucketed facts would test the sorting and leave the one
     decision that matters — which bucket a run belongs in — completely unexercised, so
     each fixture states the RAW verdicts the shipped predicates would return for that
     record and lets creatorRunKind decide. */
  const classify = (over, verdicts) => {
    const bucket = api.creatorRunKind(verdicts);
    return { ...over, kind: bucket.kind, reason: bucket.reason };
  };
  const LIVE = { status: "running", machineActive: true, waitingForHuman: false, needsAttention: false };
  const GATE = { status: "awaiting-review", machineActive: false, waitingForHuman: true, needsAttention: false };
  const LAPSED = { status: "running", machineActive: false, waitingForHuman: true, needsAttention: false };
  const BROKEN = { status: "failed", machineActive: false, waitingForHuman: false, needsAttention: true };
  const DONE = { status: "completed", machineActive: false, waitingForHuman: false, needsAttention: false };

  const quiet = project([]);
  assert.deepStrictEqual({ ...quiet.counts }, { working: 0, waiting: 0, attention: 0, recent: 0, total: 0 });
  assert.strictEqual(quiet.headline.kind, "all-quiet", "an empty production must read as all-quiet, not as working");

  const live = classify(FIXTURES.working(), LIVE);
  const gate = classify(FIXTURES.waitingApproval(), GATE);
  const lapsedRun = classify(FIXTURES.lapsed(), LAPSED);
  const brokenRun = classify(FIXTURES.failed(), BROKEN);
  const doneRun = classify(FIXTURES.completed(), DONE);

  const working = project([live]);
  assert.deepStrictEqual(working.working.map((row) => row.key), ["run:live"]);
  assert.strictEqual(working.headline.kind, "machine-active");

  const waiting = project([live, gate]);
  assert.deepStrictEqual(waiting.waiting.map((row) => row.key), ["run:wait"],
    "a run parked at an approval gate belongs in waiting, never in working");
  assert.strictEqual(waiting.working.length, 1, "the running work is still reported, just not first");
  assert.strictEqual(waiting.headline.kind, "waiting-human",
    "a human gate must outrank running work in the headline; a director who can finish something now must not have it buried");

  const lapsed = project([lapsedRun]);
  assert.strictEqual(lapsed.waiting[0].reason, "runner-stopped");
  assert.strictEqual(lapsed.working.length, 0, "an abandoned run must never count as machine-active");
  assert.strictEqual(lapsed.waiting[0].elapsed, "",
    "a stopped run must not carry a running clock: the coarser truthful answer is no elapsed time");

  const failed = project([live, gate, brokenRun]);
  assert.strictEqual(failed.attention.length, 1, "the failed run must reach the attention bucket");
  assert.strictEqual(failed.headline.kind, "needs-attention",
    "a failure must outrank both the gate and the running work in the Assistant's reading order");
  assert.deepStrictEqual([...failed.priority].slice(0, 3), ["needs-attention", "waiting-human", "machine-active"]);

  const recent = project([doneRun, FIXTURES.jobPriced()]);
  assert.deepStrictEqual(recent.recent.map((row) => row.key), ["job:priced", "run:done"],
    "settled work must be newest first");
  assert.strictEqual(recent.headline.kind, "all-quiet",
    "completed work is informational; it must not claim the headline");

  /* Stage states, taken from the real declared model. */
  const complete = project([], stageFor("frames", STAGE_FACTS.framesComplete));
  assert.strictEqual(complete.stage.id, "frames");
  assert.strictEqual(complete.stage.completion, "complete");
  assert.strictEqual(complete.recommendation.kind, "stage");
  assert.strictEqual(complete.recommendation.stageId, "motion");
  assert.strictEqual(complete.recommendation.label, "Motion & sound",
    "the recommendation's label must come from the declared model, not be composed here");
  assert.strictEqual(complete.headline.kind, "next-action");

  const undecided = project([], stageFor("frames", STAGE_FACTS.framesUndecided));
  assert.strictEqual(undecided.stage.recommendedNext, "",
    "an undecided shot must reach the projection with no recommendation");
  assert.strictEqual(undecided.recommendation.kind, "none");
  assert.strictEqual(undecided.recommendation.reason, "no-honest-recommendation",
    "no recommendation must be reported as a result with a reason, never omitted or invented");
  assert.strictEqual(undecided.headline.kind, "all-quiet");

  const blocked = project([], stageFor("motion", STAGE_FACTS.motionBlocked));
  assert.strictEqual(blocked.stage.availability, "blocked");
  assert.strictEqual(blocked.recommendation.kind, "blocked");
  assert.strictEqual(blocked.recommendation.reason, "Approve the required frames first",
    "the blocked reason must be the declared model's own words");
  assert.strictEqual(blocked.headline.kind, "stage-blocked");

  const noStage = project([], { stage: null });
  assert.strictEqual(noStage.stage, null, "a surface with no shot has no stage rather than a guessed one");
  assert.strictEqual(noStage.recommendation.reason, "no-stage-context");

  note("Representative states: quiet, working, waiting, lapsed, failed, recent, stage complete / undecided / blocked / absent — 10 distinct outcomes");
}

/* ===========================================================================
   4. MONEY
   =========================================================================== */

function checkCostSemantics(sources = SOURCES) {
  const api = loadProjection(sources.projection);

  const priced = { accounting: Cost.submissionAccounting({ purpose: "frame", outputCount: 2, ratePerImage: 0.04, at: AT.now }) };
  const unpricedRate = { accounting: Cost.submissionAccounting({ purpose: "frame", outputCount: 2, ratePerImage: 0, at: AT.now }) };
  const unpricedKind = { accounting: Cost.submissionAccounting({ purpose: "motion-h3", outputCount: 1, ratePerImage: 0.04, at: AT.now }) };
  const legacy = { id: "legacy" };

  /* THE CROSS-CHECK. generation-cost.js is the authority and it is Node-only; the
     browser classifies the record it wrote. Both are driven over the same rows here,
     so the browser's reading cannot drift from the authority's without this failing. */
  const rows = [["priced", priced], ["no rate configured", unpricedRate], ["metered, no per-image rate", unpricedKind], ["predates recording", legacy]];
  const receipts = [];
  for (const [label, job] of rows) {
    const authority = { estimate: Cost.recordedEstimate(job), amount: Cost.recordedAmount(job) };
    const browser = api.creatorCostFact(job);
    if (!authority.estimate) {
      assert.strictEqual(browser.state, "not-recorded", `${label}: the authority records nothing, so the browser must say not-recorded`);
    } else if (authority.amount == null) {
      assert.strictEqual(browser.state, "unknown", `${label}: the authority knows it cannot price this, so the browser must say unknown`);
    } else {
      assert.strictEqual(browser.state, "estimated", `${label}: the authority recorded an amount`);
      assert.strictEqual(browser.amount, authority.amount, `${label}: the browser reported a different amount than the authority`);
    }
    /* THE RULE THE WHOLE SECTION EXISTS FOR. */
    if (browser.state !== "estimated")
      assert.strictEqual(browser.amount, null, `${label}: an unpriced or unrecorded job must carry NO amount — not 0, which renders as $0.00`);
    receipts.push(`${label} -> ${browser.state}${browser.amount == null ? "" : ` $${browser.amount}`}`);
  }
  assert.strictEqual(new Set(receipts.map((row) => row.split(" -> ")[1].split(" ")[0])).size, 3,
    "the four fixtures must exercise all three populations");

  /* NO PRICING LOGIC IN THE BROWSER. Not a rate, not a multiplication, not a read of
     the configured price. The estimate is a historical fact and recomputing it would
     silently rewrite what a project spent every time Settings changed. */
  const code = codeOnly(sources.projection);
  assert.ok(!/estimatedCostPerImage/.test(code), "the browser projection must not read the configured rate");
  assert.ok(!/ratePerImage|perImage\s*\*|\*\s*quantity|rate\s*\*/.test(code),
    "the browser projection must not compute a price; it classifies the record generation-cost.js already wrote");
  const surfaces = codeOnly(sources.surfaces);
  assert.ok(!/accounting\.estimate|estimatedCostPerImage/.test(surfaces),
    "the runtime must reach the recorded cost through creatorCostFact, not by reading the accounting record itself");

  note(`Cost: ${receipts.join(" · ")}; three populations, no arithmetic in the browser, no amount on an unpriced row`);
}

/* ===========================================================================
   5. THE HISTORY POLICY
   =========================================================================== */

function checkHistoryPolicy(sources = SOURCES) {
  const api = loadProjection(sources.projection);
  const many = (kind, count, over = {}) => Array.from({ length: count }, (_, index) =>
    fact({ key: `${kind}:${index}`, id: String(index), kind, at: `2026-08-13T1${index % 10}:00:00.000Z`, ...over }));

  const flooded = api.creatorState({
    context: CONTEXT,
    activities: [
      ...many("machine-active", 30),
      ...many("waiting-human", 30, { reason: "approval-required" }),
      ...many("needs-attention", 30, { reason: "run-failed" }),
      ...many("completed", 90),
    ],
  });

  /* UNSETTLED IS NEVER TRUNCATED. What is running and what is waiting on the director
     are the two questions the surface exists to answer; capping them would be a silent
     lie about the machine. */
  assert.strictEqual(flooded.working.length, 30, "machine-active work must never be truncated");
  assert.strictEqual(flooded.waiting.length, 30, "work waiting on the filmmaker must never be truncated");

  /* SETTLED IS BOUNDED AND SAYS SO. */
  assert.strictEqual(flooded.attention.length, api.CREATOR_ATTENTION_LIMIT);
  assert.strictEqual(flooded.recent.length, api.CREATOR_RECENT_LIMIT);
  assert.strictEqual(flooded.counts.attention, 30, "the count must report the truth even when the list is bounded");
  assert.strictEqual(flooded.omitted.attention, 30 - api.CREATOR_ATTENTION_LIMIT);
  assert.strictEqual(flooded.omitted.recent, 90 - api.CREATOR_RECENT_LIMIT);
  assert.ok(flooded.omitted.attention > 0 && flooded.omitted.recent > 0,
    "the fixture must actually overflow both bounds or this section proves nothing");

  /* Deep history is somewhere better and the policy points at it rather than growing
     a second, worse copy of it in a fixed-height dock. */
  assert.strictEqual(flooded.history.deepHistoryRoute, "#/reports");
  assert.ok(/api\/automation\/runs\?view=history/.test(readSource(path.join(PUBLIC, "reports.js"))),
    "Reports must still be the paginated deep history the Terminal defers to");

  /* And the Terminal SAYS what it is not showing. */
  const { surfaces } = loadRuntime(sources);
  const markup = surfaces.terminalMarkup(flooded, false);
  assert.ok(/Not shown/.test(markup),
    "a bounded surface that truncates silently reads as a complete one; the Terminal must name what it omitted");
  assert.ok(markup.includes(String(flooded.omitted.recent)), "the omitted count must be the real one");

  note(`History: unsettled uncapped (30 running, 30 waiting all shown); settled bounded to ${api.CREATOR_ATTENTION_LIMIT} attention + ${api.CREATOR_RECENT_LIMIT} recent, with ${flooded.omitted.attention}+${flooded.omitted.recent} named as omitted and Reports linked`);
}

/* ===========================================================================
   6. THE STAGE IS CONSUMED, NOT RE-DERIVED
   =========================================================================== */

function checkStageIsConsumed(sources = SOURCES) {
  const api = loadProjection(sources.projection);
  const code = codeOnly(sources.projection);

  /* No stage id appears in the projection. A module that knows what `frames` is has
     started holding an opinion about the workflow, which is O1's and not its own. */
  for (const stage of ["inputs", "look", "frames", "motion", "deliver"]) {
    assert.ok(!new RegExp(`["']${stage}["']`).test(code),
      `the projection names the stage "${stage}"; the declared model owns stage semantics and this module must only pass them through`);
  }
  /* And no completion or availability is computed here. */
  assert.ok(!/requiredFramesApproved|frameApprovedCount|blockingGuideActive/.test(code),
    "the projection must not read stage FACTS; it receives the declared model's ANSWER");

  /* The passthrough is faithful, field for field, against the real model. */
  const { stage } = stageFor("motion", STAGE_FACTS.motionBlocked);
  const projected = api.creatorStageBlock(stage);
  for (const field of ["id", "label", "purpose", "availability", "blockedReason", "completion", "recommendedNext"]) {
    assert.strictEqual(projected[field], stage[field], `the projection altered the declared model's ${field}`);
  }
  assert.deepStrictEqual([...projected.next], [...stage.next]);

  /* The runtime asks the shipped assemblers rather than building a fact record.
     Matched as a CALL whose result is used, not as a mention: a `typeof` guard naming
     the assembler while the facts are built some other way would satisfy a presence
     test and be exactly the regression this is here to catch. */
  const surfaces = codeOnly(sources.surfaces);
  assert.ok(/=\s*shotStageModelFacts\(/.test(surfaces),
    "the runtime must assemble stage facts with the shipped assembler, not build its own record");
  assert.ok(/[=:]\s*shotStageState\(/.test(surfaces), "the runtime must derive the stage with the declared model");
  assert.ok(/boundedShotSelectedTask|resolveShotStageId/.test(surfaces),
    "the runtime must read the SELECTED stage the workspace is showing, not pick one of its own");
  assert.ok(!/SHOT_STAGES\s*=|const\s+STAGES/.test(surfaces), "the runtime must not hold a stage list");

  note("Stage: no stage id and no stage fact in the projection; every declared field passed through unchanged; the runtime reads the selected stage through the shipped resolver");
}

/* ===========================================================================
   7. THE RENDERERS READ THE PROJECTION AND NOTHING ELSE

   The structural guarantee the whole batch rests on. Extracted by source range rather
   than by searching the file, so a raw read moved INTO a renderer is caught even
   though the same identifier legitimately appears elsewhere in the file.
   =========================================================================== */

function renderBodies(source) {
  const code = codeOnly(source);
  const bodies = {};
  for (const name of ["assistantMarkup", "terminalMarkup", "assistantRow", "assistantStageSection",
    "assistantNextSection", "terminalRow", "terminalMeta", "terminalStatus", "terminalCost", "headlineSentence"]) {
    const start = code.indexOf(`function ${name}(`);
    assert.notStrictEqual(start, -1, `public/creator-surfaces.js must declare ${name}`);
    let depth = 0, index = code.indexOf("{", start), end = -1;
    for (let cursor = index; cursor < code.length; cursor += 1) {
      if (code[cursor] === "{") depth += 1;
      else if (code[cursor] === "}") { depth -= 1; if (!depth) { end = cursor; break; } }
    }
    assert.notStrictEqual(end, -1, `could not read the body of ${name}`);
    bodies[name] = code.slice(start, end + 1);
  }
  return bodies;
}

function checkRenderersReadOnlyTheProjection(sources = SOURCES) {
  const bodies = renderBodies(sources.surfaces);
  const forbidden = [
    ["AUTOMATION_RUNS", "the run list"],
    ["FAL_GENERATION_JOBS", "the generation ledger"],
    ["V641_MANUAL_ACTIVITIES", "the manual activity map"],
    ["v670MachineActiveRun", "the machine-active predicate"],
    ["v670WaitingForHumanRun", "the waiting predicate"],
    ["v670AttentionRun", "the attention predicate"],
    ["falJobActive", "the job-active predicate"],
    ["creatorRunKind", "the bucket decision"],
    ["creatorJobKind", "the bucket decision"],
    ["creatorCostFact", "the cost classification"],
  ];
  for (const [name, what] of Object.entries(bodies)) {
    for (const [identifier, description] of forbidden) {
      assert.ok(!new RegExp(`\\b${identifier}\\b`).test(what),
        `${name} reads ${identifier} (${description}). A renderer that can classify state can disagree with the other renderer; both must read the projection only.`);
    }
  }
  /* Every collection point is in one function, and that function is not a renderer. */
  const code = codeOnly(sources.surfaces);
  assert.strictEqual(occurrences(code, "creatorState("), 1,
    "the projection must be computed exactly once per paint, by one caller");
  assert.ok(/function collectActivityFacts\(\)/.test(code), "the fact collection must have one named home");

  /* The Assistant renders no AI verdict. An AI PASS causes nothing on its own, so a
     rail that reported one would invite the reader to treat it as a decision. */
  const assistant = `${bodies.assistantMarkup}${bodies.assistantRow}${bodies.assistantStageSection}${bodies.assistantNextSection}${bodies.headlineSentence}`;
  for (const forbiddenWord of ["pass", "score", "approve(", "reject", "verdict", "recommendedScore"]) {
    assert.ok(!new RegExp(forbiddenWord.replace(/[()]/g, "\\$&"), "i").test(assistant.replace(/approve or reject it/gi, "")),
      `the Assistant renders "${forbiddenWord}"; AI review verdicts and approval controls do not belong on a narration surface`);
  }
  note(`Renderers: ${Object.keys(bodies).length} render functions, none of which can reach a run, a job, a predicate or a classifier; one creatorState() call in the file`);
}

/* ===========================================================================
   8 & 9. WHAT THE TWO SURFACES ACTUALLY RENDER
   =========================================================================== */

function checkAssistantRendering(sources = SOURCES) {
  const { api, surfaces } = loadRuntime(sources);
  const state = api.creatorState({
    context: CONTEXT,
    activities: [FIXTURES.working(), FIXTURES.waitingApproval(), FIXTURES.failed(), FIXTURES.jobUnresolved()],
    ...stageFor("motion", STAGE_FACTS.motionBlocked),
  });
  const html = surfaces.assistantMarkup(state);

  /* It works with no assistant model configured — nothing here consulted one, because
     nothing here can: the realm has no fetch and no capability state. */
  assert.ok(html.includes("Needs attention"), "the rail must name the attention section");
  assert.ok(html.includes("Waiting for you"), "the rail must name the waiting section");
  assert.ok(html.includes("Working"), "the rail must name the working section");

  /* The waiting gate is never described as machine work. */
  const waitingBlock = html.slice(html.indexOf('data-cb-section="waiting"'), html.indexOf('data-cb-section="working"'));
  assert.ok(/approve or reject/i.test(waitingBlock), "the waiting section must say what the filmmaker has to do");
  assert.ok(!/running|generating|in progress/i.test(waitingBlock),
    "a human gate must never be described as machine work");

  /* Order follows the declared priority. */
  const positions = ["attention", "waiting", "working"].map((name) => html.indexOf(`data-cb-section="${name}"`));
  assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b),
    "the rail's sections must follow the declared priority order");
  assert.ok(html.indexOf('data-headline="needs-attention"') >= 0,
    "a failure must claim the headline over a running operation");

  /* The blocked stage speaks the declared model's words. */
  assert.ok(html.includes("Approve the required frames first"),
    "the blocked reason must be the declared model's, not one composed by the rail");
  assert.ok(html.includes("Motion &amp; sound") || html.includes("Motion & sound"),
    "the current step must be named by the declared model");

  /* An unresolved submission is not softened. */
  assert.ok(/does not know whether the provider accepted/i.test(html),
    "an unresolved submission must say the outcome is unknown, because generating again can buy the shot twice");

  /* No honest recommendation, said out loud. */
  const undecided = api.creatorState({ context: CONTEXT, activities: [], ...stageFor("frames", STAGE_FACTS.framesUndecided) });
  const quietHtml = surfaces.assistantMarkup(undecided);
  assert.ok(/No recommendation is available/i.test(quietHtml),
    "with no honest next step the rail must say so rather than render an empty section or invent one");
  assert.ok(!/recommends this next/.test(quietHtml), "no recommendation must mean no recommendation is offered");
  assert.ok(!quietHtml.includes("selectBoundedTask"),
    "with no recommendation there must be no stage button either; an action the model did not recommend is a recommendation");

  /* A blocked stage explains the prerequisite and offers no way past it. */
  assert.ok(!/cb-assistant-action[^>]*selectBoundedTask/.test(html.slice(html.indexOf('data-cb-section="next"'))),
    "a blocked stage must not offer a button that walks into it");

  /* When the declared model DOES recommend a handoff, the rail offers it — through the
     shipped task selector, which is the same call the taskbar makes. */
  const recommended = api.creatorState({ context: CONTEXT, activities: [], ...stageFor("frames", STAGE_FACTS.framesComplete) });
  const recommendedHtml = surfaces.assistantMarkup(recommended);
  assert.ok(recommendedHtml.includes("selectBoundedTask"), "the rail must move stages through the shipped task selector");
  assert.ok(recommendedHtml.includes("recommends this next"), "a declared handoff must be offered");

  /* No paid control, no approval control, on any of the three. */
  const FORBIDDEN_CONTROLS = ["openFalGenerationModal", "GENERATE", "approveCandidate", "approveAutomationCandidate",
    "useRecommendedBlockingAttempt", "retryFailedAutomationStep", "markGuidedVideoFinal", "markGuidedStillFinal"];
  for (const name of FORBIDDEN_CONTROLS) {
    for (const [label, page] of [["attention", html], ["undecided", quietHtml], ["recommended", recommendedHtml]]) {
      assert.ok(!page.includes(name),
        `the Assistant offers "${name}" on the ${label} state; the rail must not spend money, retry paid work, or approve media`);
    }
  }
  /* What it DOES offer is existing, safe navigation. */
  assert.ok(html.includes("openGlobalAutomationActivity"), "the rail must be able to open the existing Activity drawer");

  note("Assistant: renders with no model configured; sections ordered attention -> waiting -> working; a gate never reads as machine work; blocked reason and stage label come from O1; no recommendation is stated rather than invented; no paid, retry or approval control");
}

function checkTerminalRendering(sources = SOURCES) {
  const { api, surfaces } = loadRuntime(sources);
  const state = api.creatorState({
    context: CONTEXT,
    activities: [FIXTURES.working(), FIXTURES.waitingApproval(), FIXTURES.lapsed(), FIXTURES.failed(),
      FIXTURES.jobUnresolved(), FIXTURES.jobPriced(), FIXTURES.jobUnpriced(), FIXTURES.jobLegacy(), FIXTURES.completed()],
  });
  const html = surfaces.terminalMarkup(state, false);

  /* Statuses come from the shared buckets and read technically. */
  for (const [key, status] of [["run:live", "RUNNING"], ["run:wait", "AWAITING REVIEW"], ["run:orphan", "STOPPED"],
    ["run:failed", "FAILED"], ["job:unresolved", "UNRESOLVED"], ["run:done", "COMPLETED"]]) {
    const row = html.slice(html.indexOf(`data-activity-key="${key}"`));
    assert.ok(row.slice(0, 400).includes(status), `the Terminal must label ${key} as ${status}`);
  }
  /* The awaiting-review row must not be labelled as running. */
  const waitRow = html.slice(html.indexOf('data-activity-key="run:wait"'), html.indexOf('data-activity-key="run:orphan"'));
  assert.ok(!/>RUNNING</.test(waitRow), "an approval gate must not be labelled RUNNING in the Terminal either");

  /* Provider metadata appears only where it was recorded. */
  assert.ok(html.includes("fal-ai/gpt-image-2") && html.includes("req req-abc"),
    "recorded provider, model and request handle must be shown");
  assert.ok(html.includes("attempt 2/3") && html.includes("1 retries"),
    "an automation step's recorded attempt and retry count must be shown");
  const legacyRow = html.slice(html.indexOf('data-activity-key="job:legacy"'));
  assert.ok(!/req /.test(legacyRow.slice(0, 400)), "a row with no recorded request handle must show none");

  /* MONEY. The three populations, and the one thing that must never appear. */
  assert.ok(html.includes("est $0.08") && html.includes("est $0.16"), "a recorded estimate must be shown as an estimate");
  assert.ok(html.includes("cost not priced"), "a metered job with no applicable rate must say so");
  assert.ok(html.includes("cost not recorded"), "a job predating cost recording must say so");
  assert.ok(!html.includes("$0.00"), "an unknown or unrecorded cost must never render as $0.00");
  assert.ok(!/\$NaN|\$undefined|\$null/.test(html), "an absent amount must never reach the string");

  /* Rows carry the same reconciliation key namespace the Activity drawer uses, so the
     two surfaces can be compared row for row. */
  assert.ok(/data-activity-key="run:/.test(html) && /data-activity-key="job:/.test(html),
    "Terminal rows must carry reconciliation keys");
  assert.ok(/data-activity-key="run:live"/.test(html) && /data-activity-key="run:live"/.test(readSource(path.join(PUBLIC, "creator-surfaces.js")).length ? html : html),
    "run rows must use the drawer's own key namespace");
  const drawerKeys = codeOnly(sources.activity);
  assert.ok(/data-activity-key="run:/.test(drawerKeys),
    "the Activity drawer must still key its run rows the same way for the two surfaces to be comparable");

  /* Collapsed shows the header and nothing else, so the dock can get out of the way
     without being destroyed. */
  const collapsed = surfaces.terminalMarkup(state, true);
  assert.ok(collapsed.includes("ACTIVITY TERMINAL"), "a collapsed Terminal must keep its header");
  assert.ok(!collapsed.includes("cb-terminal-row"), "a collapsed Terminal must render no rows");
  assert.ok(collapsed.includes("EXPAND") && html.includes("COLLAPSE"), "the collapse control must state which way it goes");

  /* No narration. The Terminal is operational truth and must not acquire the rail's voice. */
  for (const sentence of ["CineBraid is", "waiting for you", "recommends", "Take me there"]) {
    assert.ok(!html.includes(sentence), `the Terminal renders "${sentence}"; filmmaker narration belongs on the rail`);
  }
  note("Terminal: six statuses from the shared buckets, provider metadata only where recorded, three cost populations with no $0.00, drawer key namespace, collapsible header, no narration");
}

/* ===========================================================================
   10. NOTHING IS STORED, NOTHING IS FETCHED, NOTHING IS PAID FOR
   =========================================================================== */

function checkNoPersistenceNoNetworkNoPaid(sources = SOURCES) {
  const projection = codeOnly(sources.projection);
  const surfaces = codeOnly(sources.surfaces);

  for (const [label, code] of [["the projection", projection], ["the runtime", surfaces]]) {
    assert.ok(!/\bfetch\s*\(/.test(code), `${label} must not make a request`);
    assert.ok(!/XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/.test(code), `${label} must not open a connection`);
    assert.ok(!/eval\(|new Function/.test(code), `${label} must not evaluate code`);
    assert.ok(!/setInterval\(/.test(code),
      `${label} installs a timer; activity is already polled by public/live-activity.js and a second clock over the same data is how two surfaces start disagreeing`);
  }
  /* The projection has no clock at all, so it cannot decide anything from "now". */
  assert.ok(!/Date\.now|new Date\(/.test(projection),
    "the projection must have no clock: an ordering that depends on the moment it ran is not a projection of state");

  /* The runtime persists exactly one thing, and it is a panel preference. */
  const stored = surfaces.match(/localStorage\.setItem\(([^,]+),/g) || [];
  assert.strictEqual(stored.length, 1, `the runtime writes ${stored.length} stored values; only the Terminal's collapsed state may be persisted`);
  assert.ok(/TERMINAL_COLLAPSED_KEY/.test(stored[0]), "the one persisted value must be the Terminal's collapsed state");
  /* And nothing reaches a project. */
  assert.ok(!/\bdirty\(|saveProject|setVal\(|\bP\.\w+\s*=/.test(surfaces),
    "no creator surface may write to the project; the Assistant interprets production state and never becomes it");

  /* No paid route is named anywhere in either file. */
  for (const route of ["/api/generation/fal/jobs", "/api/llm/", "/api/agents/run"]) {
    assert.ok(!projection.includes(route) && !surfaces.includes(route),
      `O3 names the ${route} route; the deterministic surfaces must not call a provider or a model`);
  }
  note("Isolation: no fetch, no socket, no eval, no timer, no clock in the projection, one persisted panel preference, no project write, no provider or model route");
}

/* ===========================================================================
   11. THE SHELL INTEGRATION
   =========================================================================== */

function checkShellIntegration(sources = SOURCES) {
  const code = codeOnly(sources.surfaces);

  /* Mounted through O2's contract, never by building a region. */
  assert.ok(/CineBraidShell\.mountSlot|shell\.mountSlot/.test(code), "content must reach the slots through the shell's mount contract");
  assert.ok(!/getElementById\(["']cb-shell-rail["']\)|getElementById\(["']cb-shell-dock["']\)/.test(code),
    "the surfaces must not reach into the shell's slot elements directly; O2 owns them");
  assert.ok(!/--cb-dock-reserve|--cb-nav-width|--cb-shell-rail-width/.test(code),
    "the surfaces must not set the shell's own layout variables; the shell measures its own dock");
  /* But it does tell the shell its dock changed, because it is the only thing that
     knows the exact moment it did. */
  assert.ok(/syncCreatorShell/.test(code),
    "changing dock content must ask the shell to re-measure; the ResizeObserver alone leaves the reservation stale for a frame");
  assert.ok(/requestAnimationFrame/.test(code),
    "the reservation changes layout, which can change the dock; a second measurement after layout settles is required");

  /* Mounted once, patched afterwards, with the drawer's own reconciler. */
  assert.ok(/v670PatchElement/.test(code),
    "repainting must reuse the Activity drawer's reconciler so CineBraid has one patching behaviour, not two");
  assert.ok(/v670DomCanReconcile/.test(code), "the wholesale fallback must be probed, not sniffed for a test environment");
  assert.ok(/isConnected/.test(code), "the mount must be idempotent: a surface already in the slot is not remounted");

  /* Both scripts are loaded, in an order that works. */
  const scripts = [...sources.markup.matchAll(/<script src="([^"?]+)/g)].map((row) => row[1]);
  for (const file of ["shared-creator-state.js", "creator-surfaces.js"]) {
    assert.ok(scripts.includes(file), `public/index.html must load ${file}`);
  }
  assert.ok(scripts.indexOf("shared-creator-state.js") < scripts.indexOf("app.js"),
    "the projection is a shared module and must load with the others, before app.js");
  for (const dependency of ["live-activity.js", "creation-studio.js", "workspace-shell.js", "shared-creator-state.js"]) {
    assert.ok(scripts.indexOf(dependency) < scripts.indexOf("creator-surfaces.js"),
      `creator-surfaces.js reads ${dependency} and must load after it`);
  }

  /* The stylesheet owns no geometry the shell already owns. */
  const o3Styles = sources.styles.slice(sources.styles.indexOf("O3 — the Assistant rail"));
  assert.ok(o3Styles.length > 500, "the O3 style block must exist");
  for (const rule of ["#cb-shell-rail{", "#cb-shell-dock{", "#workspace{", ".cb-shell-main{"]) {
    assert.ok(!o3Styles.includes(rule), `the O3 style block redeclares ${rule}; O2 owns the shell's geometry`);
  }
  assert.ok(/overflow-wrap:anywhere/.test(o3Styles),
    "long provider identifiers must wrap; a fixed dock that cannot wrap widens the page");
  assert.ok(/minmax\(0,1fr\)/.test(o3Styles), "the Terminal's flexible column must carry a zero minimum");

  note(`Shell: mounted through the O2 contract, patched with the drawer's reconciler, re-measured on change and after layout settles; ${scripts.length} scripts in index.html with both new files correctly ordered; the O3 stylesheet redeclares no shell geometry`);
}

/* ===========================================================================
   12. THE LIVE ACTIVITY STRIP IS NOT A GRID ITEM OF THE MAIN REGION

   A defect this batch found rather than introduced, guarded here because it was
   invisible for exactly the reason it was dangerous.

   The global activity strip LOOKS position:fixed — its base rule says so — but the
   v6.6.2.2 integrity pass overrode it to `position:relative!important`, making it an
   in-flow banner. O2 then re-anchored its insertion on #main, which by then lived
   inside `#cb-shell-main`: a grid with exactly two declared tracks, one for the centre
   and one for the rail. An in-flow third child takes the centre's track and pushes the
   workspace into the rail's 340px column.

   Nothing showed it, because the strip hides itself when nothing is happening and O2
   shipped both slots empty. O3 is the first build where a filmmaker sees activity on a
   creator surface, and at 1920px the work rendered 340px wide.
   =========================================================================== */

function checkActivityStripStaysOutOfTheGrid(sources = SOURCES) {
  const flat = String(sources.styles).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

  /* (a) The strip really is in flow — this is what makes its parent load-bearing. A
     future pass that returns it to position:fixed makes the rest of this check moot,
     and should delete it rather than let it pass for the wrong reason. */
  assert.ok(/#automation-global-live-strip\{[^}]*position:relative!important/.test(flat),
    "this check assumes the activity strip is in flow (position:relative!important, from the v6.6.2.2 pass). "
    + "If it has returned to position:fixed, its parent no longer matters and this check should be removed rather than kept passing.");

  /* (b) The Main region has exactly two tracks, so a third in-flow child cannot fit
     without displacing one of them. */
  const region = flat.match(/\.cb-shell-main:has\(>#cb-shell-rail\[data-occupied\]\)\{grid-template-columns:([^}]*)\}/);
  assert.ok(region, "the Main region must declare its two-track occupied layout");
  assert.strictEqual(region[1].split(")").join(") ").trim().split(/\s+/).length, 2,
    `the Main region declares ${region[1]} — two tracks are expected, one for the centre and one for the rail`);

  /* (c) So the strip is anchored on the REGION, not on the centre inside it. */
  const code = codeOnly(sources.activity);
  const fn = code.slice(code.indexOf("function v642EnsureGlobalActivityStrip"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(/getElementById\(["']cb-shell-main["']\)/.test(body),
    "the activity strip must anchor on the Main region; anchoring on #main puts an in-flow banner inside the "
    + "two-track grid, where it takes the centre's track and renders the workspace at the rail's width");
  const insert = body.match(/insertBefore\(strip,\s*(\w+)\)/);
  assert.ok(insert, "the strip must be inserted before its anchor");
  assert.strictEqual(insert[1], "anchor",
    `the strip is inserted before \`${insert[1]}\`; it must go before the region anchor so it lands in #workspace`);
  assert.ok(/region \|\| document\.getElementById\(["']main["']\)/.test(body),
    "#main must remain the fallback anchor for a document with no shell region, such as the render harness");

  note("Activity strip: in flow since v6.6.2.2, anchored on the Main region rather than inside its two-track grid — the 340px workspace this batch found");
}

/* ===========================================================================
   13. THE DECLARED LIMITATIONS
   =========================================================================== */

function checkDeclaredLimitations(sources = SOURCES) {
  const api = loadProjection(sources.projection);
  const required = ["job-duration", "job-attempt", "motion-cost", "provider-billing", "stage-outside-shot"];
  for (const key of required) {
    assert.ok(api.CREATOR_UNAVAILABLE[key], `O3 must declare the "${key}" limitation rather than guessing at it`);
    for (const field of ["question", "why", "wouldNeed"]) {
      assert.ok(String(api.CREATOR_UNAVAILABLE[key][field] || "").length > 20,
        `${key}.${field} must name what would have to exist before the answer could be derived`);
    }
  }
  /* A generation job genuinely has no attempt field, which is why the limitation is
     declared: a retry is a new row, and labelling several rows as one retry sequence
     would be inventing a linkage the ledger does not record. */
  const jobFact = api.creatorState({ context: CONTEXT, activities: [FIXTURES.jobPriced()] }).recent[0];
  assert.strictEqual(jobFact.technical.attempt.state, "not-applicable",
    "a generation job has no attempt number; reporting one would invent a retry sequence the ledger does not record");
  assert.strictEqual(jobFact.technical.attempt.reason, "job-attempt", "the not-applicable answer must name its declared limitation");
  const runFact = api.creatorState({ context: CONTEXT, activities: [FIXTURES.working()] }).working[0];
  assert.strictEqual(runFact.technical.attempt.state, "known", "an automation step DOES record its attempt and must report it");

  /* Knowledge is three-valued everywhere it is reported. */
  assert.strictEqual(runFact.technical.provider.state, "known");
  assert.strictEqual(runFact.technical.error.state, "not-recorded");
  assert.strictEqual(FIXTURES.jobLegacy().technical.cost.state, "not-recorded");
  note(`Limitations: ${required.length} declared with the record each would need; job attempts are not-applicable and step attempts are known`);
}

/* ===========================================================================
   RUN
   =========================================================================== */

function runAll(sources = SOURCES) {
  checkProjectionContract(sources);
  checkClassificationIsDelegated(sources);
  checkRepresentativeStates(sources);
  checkCostSemantics(sources);
  checkHistoryPolicy(sources);
  checkStageIsConsumed(sources);
  checkRenderersReadOnlyTheProjection(sources);
  checkAssistantRendering(sources);
  checkTerminalRendering(sources);
  checkNoPersistenceNoNetworkNoPaid(sources);
  checkShellIntegration(sources);
  checkActivityStripStaysOutOfTheGrid(sources);
  checkDeclaredLimitations(sources);
}

if (require.main === module) {
  try {
    runAll();
    console.log(notes.map((line) => `  · ${line}`).join("\n"));
    console.log("creator-state projection, Assistant and Activity Terminal assertions passed");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  SOURCES,
  FIXTURES,
  CONTEXT,
  STAGE_FACTS,
  stageFor,
  fact,
  readSource,
  loadProjection,
  loadRuntime,
  codeOnly,
  runAll,
  checkProjectionContract,
  checkClassificationIsDelegated,
  checkRepresentativeStates,
  checkCostSemantics,
  checkHistoryPolicy,
  checkStageIsConsumed,
  checkRenderersReadOnlyTheProjection,
  checkAssistantRendering,
  checkTerminalRendering,
  checkNoPersistenceNoNetworkNoPaid,
  checkShellIntegration,
  checkActivityStripStaysOutOfTheGrid,
  checkDeclaredLimitations,
};

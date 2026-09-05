/* The server-side generation ingest reaper.
 *
 * THE GAP THIS CLOSES. Everything needed to collect a finished render already lived on
 * the server — ask the status URL, fetch the result, download, ingest, commit — and the
 * decision to go and ask lived in a browser tab polling every 3.5 seconds. Close the
 * tab during a two-minute video and the render finishes at the provider, the money is
 * spent, and CineBraid's own record says IN_QUEUE until somebody reopens that exact
 * workspace.
 *
 * THE INVARIANT THIS SUITE EXISTS TO HOLD.
 *
 *     THE REAPER MAY INGEST EXISTING PROVIDER WORK.
 *     IT MUST NEVER SUBMIT NEW PROVIDER WORK.
 *
 * The submission endpoints on the mock below are REAL and they WORK: a POST to one
 * returns a valid request_id, a status URL and a response URL, exactly as fal does. The
 * suite proves that first, against itself, so "the reaper never submitted" is a
 * measurement rather than an absence of evidence. If a submission path ever becomes
 * reachable from the sweep, that POST lands on this mock and is counted.
 *
 * NO PAID CALL AND NO PROVIDER CALL. Every endpoint is a local express mock on
 * 127.0.0.1. The only network this suite performs is to itself.
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const express = require("express");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");

/* EVERY GENERATION BACKEND IN THE PRODUCT. The structural half of the overlap proof
   below asserts that none of them opens a project-commit chain of its own — a chain only
   orders the callers that share its Map, so a backend holding a private one would not be
   a second chain, it would be the absence of one, and the snapshot-clobbering defect this
   suite proves is closed would return through it. A backend added without being listed
   here is a backend nobody checked, so the list is asserted to be complete rather than
   maintained by hand. */
const BACKEND_MODULES = fs.readdirSync(ROOT)
  .filter((name) => /^[a-z0-9-]+-generation\.js$/.test(name))
  .sort();
const { registerFalGeneration, CLAIM_RECOVERY_HEADER } = require(path.join(ROOT, "fal-generation"));
const { registerAutomationRuns, runnerAbandoned, LEASE_MS } = require(path.join(ROOT, "automation-runs"));
const { createGenerationPoller, pollEligibility, eligibleJobs } = require(path.join(ROOT, "generation-poller"));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");

const notes = [];
const note = (line) => notes.push(line);
const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

/* ---------------------------------------------------------------------------
   1. ELIGIBILITY — decided from the durable row alone.

   Pure, so it is asserted directly rather than inferred from what a sweep did or did
   not touch. Each refusal names itself; a wrong name here is a wrong reason in the
   sweep summary a person reads. */
function eligibilityChecks() {
  const handle = { externalId: "req-1", statusUrl: "https://queue.example/status/req-1" };
  const table = [
    ["a queued request with a handle", { status: "IN_QUEUE", ...handle }, true, "pollable"],
    ["a request the provider is rendering", { status: "IN_PROGRESS", ...handle }, true, "pollable"],
    ["a submitted request", { status: "SUBMITTED", ...handle }, true, "pollable"],
    /* Terminal at the provider and UNDELIVERED here. This is the exact shape of paid
       work nobody has collected, and refusing it would leave the result at fal. */
    ["a completed request nobody collected", { status: "COMPLETED", ...handle }, true, "pollable"],
    /* We do not know whether it was accepted, but we can ASK. Asking is not deciding. */
    ["an unresolved request that carries a handle", { status: "UNRESOLVED", ...handle }, true, "pollable"],

    ["a delivered result", { status: "COMPLETED", ingestedAt: ago(60), ...handle }, false, "already-delivered"],
    ["a provider refusal", { status: "FAILED", ...handle }, false, "nothing-to-collect"],
    ["a cancelled request", { status: "CANCELLED", ...handle }, false, "nothing-to-collect"],
    ["a request a person reconciled", { status: "ORPHANED", reconciliation: { outcome: "accepted" }, ...handle }, false, "reconciled-by-hand"],
    /* The two halves of "there is nothing to ask with", kept apart because they are
       different failures: no evidence the provider took it, and nowhere to ask. */
    ["a request with no provider request id", { status: "IN_QUEUE", statusUrl: handle.statusUrl }, false, "no-provider-request-id"],
    ["a request with no status URL", { status: "IN_QUEUE", externalId: "req-1" }, false, "no-status-handle"],
    ["a preflight row that never reached the provider", { status: "SUBMITTING" }, false, "no-provider-request-id"],
    ["an unresolved request with no handle", { status: "UNRESOLVED", externalId: "" }, false, "no-provider-request-id"],
    ["a queue entry nothing has touched in days", { status: "IN_QUEUE", ...handle, updatedAt: ago(3 * 86400) }, false, "abandoned"],
    ["nothing at all", null, false, "not-a-job"],
  ];
  for (const [label, job, eligible, reason] of table) {
    const verdict = pollEligibility(job, { at: Date.now() });
    assert.strictEqual(verdict.eligible, eligible, `${label}: expected eligible=${eligible}, got ${verdict.eligible} (${verdict.reason})`);
    assert.strictEqual(verdict.reason, reason, `${label}: expected reason "${reason}", got "${verdict.reason}"`);
  }
  /* A SUBMITTING row that DOES carry a handle is a request the provider demonstrably
     took, and asking about it is the whole point. */
  assert.strictEqual(pollEligibility({ status: "SUBMITTING", ...handle }).eligible, true,
    "an in-flight row carrying a provider request id must still be askable");
  assert.deepStrictEqual(
    eligibleJobs([{ id: "a", status: "IN_QUEUE", ...handle }, { id: "b", status: "FAILED", ...handle }]).map((job) => job.id),
    ["a"],
    "eligibleJobs must filter a ledger without reordering it",
  );
  note(`eligibility: ${table.length} durable shapes classified, each with its own reason`);
}

/* ---------------------------------------------------------------------------
   2. THE HARNESS — a real provider mock and a real fal-generation registration.

   The CineBraid side is the shipped module, registered on a bare express app. The
   reaper is the shipped poller, handed the same `recovery` handle server.js hands it.
   Nothing is stubbed on the CineBraid side of the boundary. */
function projectFixture() {
  return {
    meta: { title: "Ingest reaper", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", keyframes: [{ id: "FR-A", label: "A" }], candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    jobs: [], agentRuns: [], decisions: [], sessions: [],
  };
}

async function harness({ enabled = true, apiKey = "fal-test-key" } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-reaper-"));
  const projects = path.join(tmp, "projects");
  const dir = path.join(projects, "reaper-project");
  const brokenDir = path.join(projects, "broken-project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(projectFixture(), null, 2));
  fs.writeFileSync(path.join(brokenDir, "project.json"), JSON.stringify(projectFixture(), null, 2));
  /* A ledger whose primary and backup are both unreadable. A sweep must skip this
     project and keep going, and must never write to it. */
  fs.writeFileSync(path.join(brokenDir, "generation-jobs.json"), "{ not json");
  fs.writeFileSync(path.join(brokenDir, "generation-jobs.json.bak"), "also not json");

  /* ---- the provider ---- */
  const calls = { submissions: [], status: [], result: [], download: [], cancel: [] };
  const statusFor = new Map();          // request id -> the status the provider reports
  /* `outputs` lets one request answer with more than one asset, which is what a job that
     returns several candidates looks like. `holds` lets a single asset download be held
     open, so a collection can be observed mid-flight rather than only before or after —
     the only way to assert what a shutdown or an overlapping collection actually sees. */
  const behaviour = { statusHttp: new Map(), stallMs: 0, outputs: new Map(), holds: new Map() };
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let origin = "";
  mock.get("/status/:id", async (req, res) => {
    calls.status.push(req.params.id);
    if (behaviour.stallMs) await new Promise((resolve) => setTimeout(resolve, behaviour.stallMs));
    const http = behaviour.statusHttp.get(req.params.id);
    if (http) return res.status(http).json({ detail: "the provider is having a bad day" });
    res.json({ status: statusFor.get(req.params.id) || "IN_QUEUE", response_url: `${origin}/result/${req.params.id}` });
  });
  mock.get("/result/:id", (req, res) => {
    calls.result.push(req.params.id);
    const count = behaviour.outputs.get(req.params.id) || 1;
    res.json({
      images: Array.from({ length: count }, (_, index) => {
        const name = count === 1 ? `${req.params.id}.png` : `${req.params.id}-${index + 1}.png`;
        return { url: `${origin}/file/${name}`, content_type: "image/png", file_name: name };
      }),
    });
  });
  mock.get("/file/:name", async (req, res) => {
    calls.download.push(req.params.name);
    const hold = behaviour.holds.get(req.params.name);
    /* One-shot: a LATER process asking for the same asset is not held, which is what
       makes "the first attempt died mid-download and the next one started clean"
       expressible. */
    if (hold) { behaviour.holds.delete(req.params.name); hold.reached(); await hold.released; }
    res.set("content-type", "image/png").send(PNG);
  });
  mock.put("/cancel/:id", (req, res) => { calls.cancel.push(req.params.id); res.json({ ok: true }); });
  /* THE SUBMISSION ENDPOINT, and it works. Anything the reaper POSTs anywhere lands
     here, is counted, and is answered the way fal answers an accepted paid request. */
  mock.post("*", (req, res) => {
    calls.submissions.push({ path: req.path, body: req.body });
    const id = `req-submitted-${calls.submissions.length}`;
    res.json({ request_id: id, status_url: `${origin}/status/${id}`, response_url: `${origin}/result/${id}`, cancel_url: `${origin}/cancel/${id}` });
  });
  const provider = await listen(mock);
  origin = originOf(provider);

  /* ---- CineBraid ---- */
  const config = {
    generation: { fal: {
      enabled, apiKey, baseUrl: origin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit", maxConcurrent: 4,
    } },
  };
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  const slugs = ["broken-project", "reaper-project"];
  const dirFor = (slug) => (slug === "broken-project" ? brokenDir : dir);
  const context = {
    readConfig: () => JSON.parse(JSON.stringify(config)),
    readProject: (slug = "reaper-project") => {
      if (!slugs.includes(slug)) throw new Error(`No such project: ${slug}`);
      return JSON.parse(fs.readFileSync(path.join(dirFor(slug), "project.json"), "utf8"));
    },
    writeProject: (project, slug = "reaper-project") => {
      if (!slugs.includes(slug)) throw new Error(`No such project: ${slug}`);
      fs.writeFileSync(path.join(dirFor(slug), "project.json"), JSON.stringify(project, null, 2));
    },
    activeSlug: () => "reaper-project",
    projectDirForSlug: (slug) => {
      if (!slugs.includes(slug)) throw new Error(`No such project: ${slug}`);
      return { slug, dir: dirFor(slug), file: path.join(dirFor(slug), "project.json") };
    },
  };
  const FalGeneration = registerFalGeneration(app, context);
  const AutomationRuns = registerAutomationRuns(app, {
    projectDir: () => dir,
    readProject: context.readProject,
    activeSlug: context.activeSlug,
    projectReadinessIssues: () => [],
  });
  const cinebraid = await listen(app);

  const ledgerFile = path.join(dir, "generation-jobs.json");
  const writeLedger = (jobs) => fs.writeFileSync(ledgerFile, JSON.stringify(jobs, null, 2));
  const readLedger = () => JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const runsFile = path.join(dir, "automation-runs.json");

  const poller = createGenerationPoller({
    listProjectSlugs: () => slugs,
    recovery: FalGeneration.recovery,
    reconcileStaleRuns: AutomationRuns.reconcileStaleRuns,
    log: () => {},
    options: { bootDelayMs: 5, intervalMs: 5_000 },
  });

  /* Hold one asset download open. Returns { reached, release } — `reached` resolves when
     the collection has actually asked for those bytes, so a test can act at a precise
     point inside an in-flight collection instead of guessing with a timer. */
  const hold = (name) => {
    let reached, released;
    const reachedPromise = new Promise((resolve) => { reached = resolve; });
    const releasedPromise = new Promise((resolve) => { released = resolve; });
    behaviour.holds.set(name, { reached, released: releasedPromise });
    return { reached: reachedPromise, release: released };
  };

  return {
    tmp, dir, origin, calls, statusFor, behaviour, config, poller, ledgerFile, writeLedger, readLedger, runsFile, hold,
    recovery: FalGeneration.recovery,
    reconcileStaleRuns: AutomationRuns.reconcileStaleRuns,
    /* A second registration against the same directories: what the NEXT process sees. */
    restart: () => registerFalGeneration(express(), context),
    base: originOf(cinebraid),
    project: () => JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")),
    takes: () => (fs.existsSync(path.join(dir, "shots", "SH-1", "takes")) ? fs.readdirSync(path.join(dir, "shots", "SH-1", "takes")).sort() : []),
    /* Connections are destroyed, not merely refused. A download this suite deliberately
       held open would otherwise keep its socket — and so the whole process — alive after
       the last assertion. Destroying it is also the truthful ending for a held request:
       the collection that was fetching it is gone, which is exactly what the shutdown
       case is describing. */
    close: () => {
      poller.stop();
      provider.closeAllConnections?.();
      cinebraid.closeAllConnections?.();
      provider.close();
      cinebraid.close();
    },
  };
}

function queued(id, requestId, origin, overrides = {}) {
  return {
    id, provider: "fal", purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
    prompt: "a shot of the hangar", outputCount: 1, references: [],
    status: "IN_QUEUE", externalId: requestId,
    statusUrl: `${origin}/status/${requestId}`,
    responseUrl: `${origin}/result/${requestId}`,
    cancelUrl: `${origin}/cancel/${requestId}`,
    model: "openai/gpt-image-2", modelFamily: "gpt-image-2",
    quality: "high", resolution: "1k", aspectRatio: "16:9",
    createdAt: ago(600), updatedAt: ago(30), outputs: [],
    ...overrides,
  };
}

/* ---------------------------------------------------------------------------
   3. THE SWEEP — collect what is owed, touch nothing else, submit nothing. */
async function sweepChecks() {
  const h = await harness();
  try {
    /* PROVE THE CONTROL CAN FAIL, before relying on it. If the reaper submitted, this
       is the endpoint it would reach, and this is what reaching it looks like. */
    const proof = await fetch(`${h.origin}/openai/gpt-image-2`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "proof" }),
    }).then((response) => response.json());
    assert.strictEqual(h.calls.submissions.length, 1, "the submission endpoint must record a POST — otherwise the negative control measures nothing");
    assert(proof.request_id, "the submission endpoint must answer like a real accepted request");
    h.calls.submissions.length = 0;

    h.statusFor.set("req-collect", "COMPLETED");
    h.statusFor.set("req-unresolved", "COMPLETED");
    h.statusFor.set("req-working", "IN_PROGRESS");
    const before = [
      queued("job-collect", "req-collect", h.origin),
      queued("job-working", "req-working", h.origin),
      /* Accepted, outcome unknown, and it carries a handle: asking is allowed. */
      queued("job-unresolved", "req-unresolved", h.origin, { status: "UNRESOLVED", unresolvedReason: "no response came back", unresolvedAt: ago(400) }),
      /* Sent and lost with no handle at all. Only a person can settle this one. */
      queued("job-no-handle", "", h.origin, { status: "UNRESOLVED", externalId: "", statusUrl: "", responseUrl: "" }),
      /* Delivered. Its bytes are already in the project. */
      queued("job-delivered", "req-delivered", h.origin, { status: "COMPLETED", ingestedAt: ago(900), outputs: [{ type: "candidate", name: "already.png" }] }),
      queued("job-refused", "req-refused", h.origin, { status: "FAILED", error: "the provider declined it" }),
      queued("job-orphaned", "req-orphaned", h.origin, { status: "ORPHANED", reconciliation: { outcome: "accepted", previousStatus: "UNRESOLVED", at: ago(800), by: "user" } }),
      queued("job-abandoned", "req-abandoned", h.origin, { updatedAt: ago(4 * 86400), createdAt: ago(5 * 86400) }),
    ];
    h.writeLedger(before);

    const summary = await h.poller.runOnce();

    /* --- THE CRITICAL NEGATIVE CONTROL --- */
    assert.deepStrictEqual(h.calls.submissions, [],
      `the reaper submitted ${h.calls.submissions.length} provider request(s): ${JSON.stringify(h.calls.submissions)}`);
    assert.strictEqual(h.readLedger().length, before.length,
      "the reaper must not create a generation job");

    /* --- only the askable jobs were asked about --- */
    assert.deepStrictEqual([...h.calls.status].sort(), ["req-collect", "req-unresolved", "req-working"],
      `exactly the collectable requests must be asked about; got ${JSON.stringify(h.calls.status)}`);
    assert.strictEqual(summary.polled, 3, "three rows were eligible");
    assert.strictEqual(summary.collected, 2, "two of them had a result waiting");
    assert.strictEqual(summary.results, 2, "each delivered one image");

    /* --- a corrupt ledger in another project is skipped, not rewritten --- */
    assert.strictEqual(summary.unreadable.length, 1, "the unreadable project must be reported");
    assert.strictEqual(summary.unreadable[0].slug, "broken-project", "and named");
    assert.strictEqual(fs.readFileSync(path.join(h.dir, "..", "broken-project", "generation-jobs.json"), "utf8"), "{ not json",
      "an unreadable ledger must be left untouched");

    /* --- the result actually arrived --- */
    const ledger = h.readLedger();
    const byId = Object.fromEntries(ledger.map((job) => [job.id, job]));
    assert.strictEqual(byId["job-collect"].status, "COMPLETED", "a finished render is recorded as finished");
    assert(byId["job-collect"].ingestedAt, "and delivered");
    assert.strictEqual((byId["job-collect"].outputs || []).length, 1, "with its output recorded");
    const takes = h.takes();
    assert.strictEqual(takes.length, 2, `two files were collected; found ${JSON.stringify(takes)}`);
    for (const name of takes)
      assert.deepStrictEqual(fs.readFileSync(path.join(h.dir, "shots", "SH-1", "takes", name)), PNG, `${name} must hold the provider's bytes`);
    const candidates = h.project().shots[0].candidateFiles;
    assert.strictEqual(candidates.length, 2, "the project records both candidates");
    assert(candidates.every((row) => row.generationProvider === "fal"), "with their generation provenance");

    /* --- an unresolved job the provider answered for is resolved AUTHORITATIVELY --- */
    assert.strictEqual(byId["job-unresolved"].status, "COMPLETED",
      "a provider answer is the one thing allowed to resolve an unresolved job");
    assert(byId["job-unresolved"].ingestedAt, "and its result is collected");

    /* --- everything else is exactly as it was --- */
    for (const id of ["job-no-handle", "job-delivered", "job-refused", "job-orphaned", "job-abandoned"]) {
      assert.deepStrictEqual(byId[id], before.find((job) => job.id === id),
        `${id} must be byte-for-byte unchanged by a sweep that had no business touching it`);
    }
    assert.strictEqual(byId["job-working"].status, "IN_PROGRESS", "a render still running keeps its provider status");
    assert(!byId["job-working"].ingestedAt, "and nothing was ingested for it");

    /* --- A SECOND SWEEP DELIVERS NOTHING TWICE --- */
    h.calls.download.length = 0;
    h.calls.result.length = 0;
    const second = await h.poller.runOnce();
    assert.strictEqual(second.collected, 0, "a second sweep collects nothing");
    assert.deepStrictEqual(h.calls.result, [], "and fetches no result a second time");
    assert.deepStrictEqual(h.calls.download, [], "and downloads nothing a second time");
    assert.deepStrictEqual(h.takes().sort(), takes.sort(), "the takes folder is unchanged");
    assert.strictEqual(h.project().shots[0].candidateFiles.length, 2, "and no candidate row is duplicated");
    assert.deepStrictEqual(h.calls.submissions, [], "and still nothing was submitted");
    /* A delivered job is no longer asked about at all. */
    assert(!h.calls.status.slice(3).includes("req-collect"), "a delivered job stops being polled");

    note("sweep: 3 of 8 durable rows asked about, 2 results collected, 0 submissions, 5 rows byte-identical");
    note("sweep: a second pass re-downloaded nothing and duplicated no candidate row");
  } finally { h.close(); }
}

/* ---------------------------------------------------------------------------
   4. COEXISTENCE — a browser tab and the reaper on the same job at the same time.

   The browser still polls POST /refresh every 3.5 seconds while a tab is open. Both
   observers go through the same per-job serialised turn and both re-read the row inside
   it, so whichever arrives second finds the first one's ingest stamp. */
async function coexistenceChecks() {
  const h = await harness();
  try {
    h.statusFor.set("req-race", "COMPLETED");
    /* The provider takes its time answering, so the overlap is real rather than lucky. */
    h.behaviour.stallMs = 120;
    h.writeLedger([queued("job-race", "req-race", h.origin)]);

    const browser = () => fetch(`${h.base}/api/generation/fal/jobs/job-race/refresh`, { method: "POST" })
      .then((response) => response.json().then((body) => ({ status: response.status, body })));
    const [sweep, ...refreshes] = await Promise.all([
      h.poller.runOnce(), browser(), browser(), browser(),
    ]);

    assert(refreshes.every((row) => row.status === 200), `every browser refresh must succeed: ${JSON.stringify(refreshes.map((r) => r.status))}`);
    assert.deepStrictEqual(h.calls.submissions, [], "no observer may submit");
    assert.strictEqual(h.calls.result.length, 1, `the result must be fetched exactly once; got ${h.calls.result.length}`);
    assert.strictEqual(h.calls.download.length, 1, `the output must be downloaded exactly once; got ${h.calls.download.length}`);
    assert.strictEqual(h.takes().length, 1, `exactly one file may be written; got ${JSON.stringify(h.takes())}`);
    assert.strictEqual(h.project().shots[0].candidateFiles.length, 1, "and exactly one candidate row");

    const ledger = h.readLedger();
    assert.strictEqual(ledger.length, 1, "no duplicate job row");
    assert.strictEqual((ledger[0].outputs || []).length, 1, "and one output on it");
    const ingestedAt = ledger[0].ingestedAt;
    assert(ingestedAt, "the job is delivered");
    /* One delivery, one authority: every observer reports the SAME ingest stamp. */
    for (const row of refreshes)
      assert.strictEqual(row.body.job.ingestedAt, ingestedAt, "every observer must report the one delivery, not its own");
    /* Exactly one of the four observers took delivery, and the reaper knows whether it
       was the one — which is what stops the recovery notice counting a browser's work. */
    assert(sweep.collected <= 1, "the sweep may take delivery at most once");
    /* THE REPRODUCED CASE. The sweep enters the per-job turn in-process while the three
       refreshes are still crossing a socket, so it takes delivery. Structural rather
       than lucky — but if this ever flips, the assertions below describe a browser
       collection and the failure is a race outcome, not a wording regression. */
    assert.strictEqual(sweep.collected, 1,
      "the sweep is expected to win this race; the notice assertions below describe the case where it did");

    /* ---- AND WHAT THE NEXT WINDOW IS TOLD ABOUT IT ------------------------------
     *
     * THIS IS WHERE THE FALSE CLAIM WAS PROVABLY FALSE. The notice used to read
     * "Collected 1 result while no CineBraid window was open." — asserted at the exact
     * moment three CineBraid windows had just refreshed this job hard enough to race
     * the server for it. The server cannot know either way: pollEligibility is derived
     * from durable job fields alone and nothing on the server observes browsers, so
     * "no window was open" was never a fact it was entitled to state.
     *
     * The boot section asserts the same wording with no browser at all. Together they
     * pin the sentence as a statement about the COLLECTOR, which the server does know,
     * and never about the user, which it does not. */
    const claimed = await fetch(`${h.base}/api/generation/fal/jobs`, { headers: { [CLAIM_RECOVERY_HEADER]: "1" } })
      .then((response) => response.json());
    assert(claimed.backgroundRecovery, "the sweep took delivery, so the next window must be told how the result arrived");
    assert.strictEqual(claimed.backgroundRecovery.results, 1, "one result, counted once — the three browsers collected nothing to count");
    assert.strictEqual(claimed.backgroundRecovery.jobs, 1, "from one job");
    assert.strictEqual(claimed.backgroundRecovery.message, "Collected 1 result through background recovery.",
      `the notice must say how the result was collected: ${claimed.backgroundRecovery.message}`);
    /* The claim the server is not entitled to make, forbidden by shape rather than by
       exact string, so a reworded version of the same falsehood cannot slip back. */
    assert(!/window|windows|tab|nobody|unattended|no one|closed/i.test(claimed.backgroundRecovery.message),
      `the notice must make no claim about what was open or who was watching: ${claimed.backgroundRecovery.message}`);
    /* Everything above happened with no provider submission, which is the boundary the
       reaper is built on and the one a recovery notice must never imply was crossed. */
    assert.deepStrictEqual(h.calls.submissions, [], "and still no observer submitted anything");

    note(`coexistence: 1 sweep + 3 browser refreshes on one job -> ${h.calls.download.length} download, 1 file, 1 candidate row, `
      + `0 submissions, and a notice that names background recovery while three windows were demonstrably open`);
  } finally { h.close(); }
}

/* ---------------------------------------------------------------------------
   5. "I COULD NOT ASK" IS NOT "THE PROVIDER FAILED".

   The asymmetry that makes this safe: a wrongly-unresolved job costs a click; a wrongly
   FAILED job unblocks Generate and buys the same render twice. The reaper therefore
   writes nothing at all when a status request fails — while the browser's Refresh, which
   a person pressed and is owed an answer to, keeps recording it. */
async function transientFailureChecks() {
  const h = await harness();
  try {
    h.behaviour.statusHttp.set("req-flaky", 503);
    const before = queued("job-flaky", "req-flaky", h.origin);
    h.writeLedger([before]);

    const first = await h.poller.runOnce();
    assert.strictEqual(first.failed, 1, "the sweep saw the failure");
    assert.deepStrictEqual(h.readLedger()[0], before,
      "a status request that failed must leave the durable row byte-for-byte unchanged");

    /* Backoff: the next sweep does not immediately ask again. */
    const asked = h.calls.status.length;
    const second = await h.poller.runOnce();
    assert.strictEqual(h.calls.status.length, asked, "a failing job is not re-asked on the very next sweep");
    assert.strictEqual(second.polled, 0, "it is skipped, not polled");
    assert.deepStrictEqual(h.readLedger()[0], before, "and it is still unchanged");

    /* The browser's own Refresh still records what a person asked for. That contrast is
       what proves the reaper's silence is a decision rather than an accident. */
    const refreshed = await fetch(`${h.base}/api/generation/fal/jobs/job-flaky/refresh`, { method: "POST" })
      .then((response) => response.json().then((body) => ({ status: response.status, body })));
    assert.strictEqual(refreshed.status, 502, "a person's refresh reports the provider failure");
    assert.strictEqual(h.readLedger()[0].status, "FAILED", "and records it, as it always has");
    assert.deepStrictEqual(h.calls.submissions, [], "neither path submitted anything");

    note("transient failure: reaper wrote nothing and backed off; the browser's Refresh still records it");
  } finally { h.close(); }
}

/* ---------------------------------------------------------------------------
   6. GENERATION NOT CONFIGURED.

   No key, or switched off: there is nothing the reaper can ask and nothing it may
   conclude. It must not reach the provider and must not mark a single row. */
async function unconfiguredChecks() {
  for (const [label, patch] of [["disabled", { enabled: false }], ["no key", { apiKey: "" }]]) {
    const h = await harness(patch);
    try {
      const before = [queued("job-idle", "req-idle", h.origin)];
      h.writeLedger(before);
      const summary = await h.poller.runOnce();
      assert.strictEqual(summary.providerReady, false, `${label}: the sweep must report the provider as unavailable`);
      assert.strictEqual(summary.polled, 0, `${label}: nothing may be polled`);
      assert.deepStrictEqual(h.calls.status, [], `${label}: the provider must not be contacted`);
      assert.deepStrictEqual(h.calls.submissions, [], `${label}: and certainly not submitted to`);
      assert.deepStrictEqual(h.readLedger(), before, `${label}: the ledger must be untouched`);
    } finally { h.close(); }
  }
  note("unconfigured: with fal off or keyless the sweep contacts nothing and writes nothing");
}

/* ---------------------------------------------------------------------------
   7. STALE AUTOMATION RUNS — a state correction, never a resume. */
function staleRunFixtures() {
  const step = (status) => ({
    "frame:frame-a:round-1:generate": {
      key: "frame:frame-a:round-1:generate", kind: "generation", status,
      label: "Generate Frame A", startedAt: ago(1200), updatedAt: ago(900),
    },
  });
  return [
    {
      id: "run-orphan", type: "shot-chain", targetId: "SH-1", scope: "stills", label: "Lease lapsed mid-run",
      status: "running", stage: "Generating Frame A", summary: "", revision: 4,
      runnerId: "runner-that-stopped-renewing", leaseAcquiredAt: ago(1200), heartbeatAt: ago(900), leaseExpiresAt: ago(600),
      current: { stepKey: "frame:frame-a:round-1:generate" }, config: { maxImages: 21 },
      usage: { imagesGenerated: 3 }, steps: step("running"), logs: [],
      createdAt: ago(1200), updatedAt: ago(900), completedAt: "",
    },
    {
      id: "run-live", type: "shot-chain", targetId: "SH-1", scope: "stills", label: "Driven right now",
      status: "running", stage: "Generating", summary: "", revision: 2,
      runnerId: "runner-alive", leaseAcquiredAt: ago(120), heartbeatAt: ago(20), leaseExpiresAt: new Date(Date.now() + 240_000).toISOString(),
      current: { stepKey: "frame:frame-a:round-1:generate" }, config: { maxImages: 21 },
      usage: { imagesGenerated: 1 }, steps: step("running"), logs: [],
      createdAt: ago(120), updatedAt: ago(20), completedAt: "",
    },
    {
      id: "run-claiming", type: "shot-chain", targetId: "SH-1", scope: "stills", label: "Starting up",
      status: "running", stage: "Preparing", summary: "", revision: 1,
      runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "",
      current: { stepKey: "" }, config: { maxImages: 21 }, usage: {}, steps: {}, logs: [],
      createdAt: ago(2), updatedAt: ago(2), completedAt: "",
    },
    {
      id: "run-parked", type: "shot-chain", targetId: "SH-1", scope: "stills", label: "Waiting for the director",
      status: "awaiting-review", stage: "Approve Frame A", summary: "", revision: 3,
      runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "",
      current: { stepKey: "frame:frame-a:round-1:review" }, config: { maxImages: 21 }, usage: {},
      steps: step("needs-review"), logs: [], createdAt: ago(600), updatedAt: ago(540), completedAt: "",
    },
  ];
}

function abandonmentPredicateChecks() {
  const live = { status: "running", runnerId: "r", leaseExpiresAt: new Date(Date.now() + 240_000).toISOString(), heartbeatAt: ago(20) };
  assert.strictEqual(runnerAbandoned(live), false, "a run whose lease is in the future is not abandoned");
  assert.strictEqual(runnerAbandoned({ ...live, status: "awaiting-review" }), false, "only a `running` run can be abandoned");
  assert.strictEqual(runnerAbandoned({ status: "running", runnerId: "", leaseExpiresAt: "" }), false,
    "a run that has never claimed a lease is mid-start, not abandoned");
  /* Expiry alone is not enough: the grace absorbs clock skew between the window that
     wrote the record and the process reading it. */
  assert.strictEqual(runnerAbandoned({ status: "running", runnerId: "r", leaseExpiresAt: ago(1), heartbeatAt: ago(300) }), false,
    "a lease that lapsed one second ago is inside the grace window");
  assert.strictEqual(runnerAbandoned({ status: "running", runnerId: "r", leaseExpiresAt: ago(600), heartbeatAt: ago(900) }), true,
    "a lapsed lease with a stale heartbeat is abandoned");
  /* Both signals have to agree. A record whose lease lapsed but whose heartbeat is
     recent is contradictory, and interrupting a run that may still be beating is the
     expensive direction to be wrong in. */
  assert.strictEqual(runnerAbandoned({ status: "running", runnerId: "r", leaseExpiresAt: ago(600), heartbeatAt: ago(10) }), false,
    "a recent heartbeat protects a run whose lease record disagrees");
  assert.strictEqual(runnerAbandoned({ status: "running", runnerId: "r", leaseExpiresAt: "", heartbeatAt: "" }), true,
    "a recorded runner with no readable lease owns nothing");
  assert(LEASE_MS > 0, "the lease window is what the heartbeat test is measured against");
  note("abandonment: lease, heartbeat, grace and the never-claimed case each decided separately");
}

async function staleRunChecks() {
  const h = await harness();
  try {
    const before = staleRunFixtures();
    fs.writeFileSync(h.runsFile, JSON.stringify({ schemaVersion: 2, updatedAt: ago(0), runs: before }, null, 2));
    /* A generation job the abandoned run was waiting on, still queued at the provider.
       A "resume" would submit; a state correction must not, and must not collect on the
       run's behalf either beyond the ordinary ingest. */
    h.statusFor.set("req-orphan-job", "IN_QUEUE");
    h.writeLedger([queued("job-orphan", "req-orphan-job", h.origin, { automationRunId: "run-orphan", automationStepKey: "frame:frame-a:round-1:generate" })]);

    const summary = await h.poller.runOnce();
    assert.deepStrictEqual(summary.staleRuns, ["run-orphan"], `exactly the abandoned run must be reconciled; got ${JSON.stringify(summary.staleRuns)}`);

    const after = JSON.parse(fs.readFileSync(h.runsFile, "utf8")).runs;
    const byId = Object.fromEntries(after.map((run) => [run.id, run]));

    /* --- the truth correction --- */
    assert.strictEqual(byId["run-orphan"].status, "interrupted", "an abandoned run stops claiming to be running");
    assert.strictEqual(byId["run-orphan"].stage, "Interrupted — resume required", "and says what it needs");
    assert(/Resume Run/.test(byId["run-orphan"].summary), "in the product's own words");
    assert.strictEqual(byId["run-orphan"].runnerId, "", "the dead runner's claim is released");
    assert.strictEqual(byId["run-orphan"].leaseExpiresAt, "", "along with its lease");
    assert.strictEqual(byId["run-orphan"].leaseDiagnostics.lastRunnerId, "runner-that-stopped-renewing",
      "and what was released is preserved for diagnosis");
    assert(byId["run-orphan"].revision > before[0].revision, "the record moved, so its revision moved");

    /* --- IT IS NOT A RESUME --- */
    assert.deepStrictEqual(h.calls.submissions, [], "reconciling a stale run must not submit anything");
    /* Compared field by field rather than whole: every write goes through sanitizeRun,
       which fills a step's absent optional fields with their defaults. Those defaults
       are what the fixture omitted, not work the reconciliation did — so the assertion
       is about the fields that would MOVE if anything had been resumed. */
    assert.deepStrictEqual(Object.keys(byId["run-orphan"].steps), Object.keys(before[0].steps), "no step was added or removed");
    for (const [key, step] of Object.entries(byId["run-orphan"].steps)) {
      assert.strictEqual(step.status, before[0].steps[key].status, `${key} must keep its status`);
      assert.strictEqual(step.completedAt || "", "", `${key} must not have been completed`);
      assert.strictEqual((step.files || []).length, 0, `${key} must not have gained results`);
      assert.strictEqual(Number(step.attempt || 0), 0, `${key} must not have been attempted again`);
      assert.strictEqual(String(step.childJobId || ""), "", `${key} must not have acquired a provider job`);
    }
    assert.strictEqual(Number(byId["run-orphan"].usage?.imagesGenerated || 0), 3, "no usage was spent");
    assert.strictEqual(byId["run-orphan"].completedAt || "", "", "nothing was completed on its behalf");
    assert.strictEqual(h.readLedger().length, 1, "and no generation job was created");

    /* --- everything else is left alone --- */
    assert.strictEqual(byId["run-live"].status, "running", "a run being driven right now is untouched");
    assert.strictEqual(byId["run-live"].revision, before[1].revision, "and not even bumped");
    assert.strictEqual(byId["run-claiming"].status, "running", "a run mid-claim is not interrupted at the instant it starts");
    assert.strictEqual(byId["run-parked"].status, "awaiting-review", "a run parked at a human gate keeps its own status");

    /* --- and it is idempotent --- */
    const repeat = await h.poller.runOnce();
    assert.deepStrictEqual(repeat.staleRuns, [], "an already-reconciled run is not reconciled again");
    assert.strictEqual(JSON.parse(fs.readFileSync(h.runsFile, "utf8")).runs.find((run) => run.id === "run-orphan").revision,
      byId["run-orphan"].revision, "and its revision does not creep on every sweep");

    /* --- the same correction happens on an ordinary read, for a window that IS open --- */
    fs.writeFileSync(h.runsFile, JSON.stringify({ schemaVersion: 2, updatedAt: ago(0), runs: before }, null, 2));
    const listed = await fetch(`${h.base}/api/automation/runs`).then((response) => response.json());
    assert.strictEqual(listed.runs.find((run) => run.id === "run-orphan").status, "interrupted",
      "reading the run ledger reconciles it too, so a browser and the sweep agree");
    assert.strictEqual(JSON.parse(fs.readFileSync(h.runsFile, "utf8")).runs.find((run) => run.id === "run-orphan").status, "interrupted",
      "and the correction is durable, not a display trick");

    note("stale runs: 1 of 4 reconciled to `interrupted`, 0 submissions, 0 steps advanced, idempotent");
  } finally { h.close(); }
}

/* ---------------------------------------------------------------------------
   8. THE RECONCILED RUN, AS THE ACTIVITY SURFACES READ IT.

   The durable correction changes what a run's status STRING is, and every activity
   surface partitions on that string. Before it, an abandoned run was `running` with a
   lapsed lease and v670WaitingForHumanRun said "waiting for you · choose Resume Run".
   After it the run is `interrupted`, which v670AttentionRun counts as a previous
   failure — so without the release code the correction would have moved a resumable run
   into the failures section AND left it in neither honestly.

   Asserted here, in Node, against the real public/live-activity.js under the render
   harness, so the guarantee does not depend on a Playwright environment being present.
   tests/production-state-honesty-real-browser.py proves the same thing in Chromium. */
async function reconciledRunSurfaceChecks() {
  const { render, buildFixture } = require("./render-harness");
  const view = await render("#/production", buildFixture());
  const runs = [
    /* What reconcileStaleLeases actually writes, including the diagnostics it preserves. */
    {
      id: "run-abandoned", type: "shot-chain", targetId: "L1-01", scope: "stills", label: "Lease lapsed",
      status: "interrupted", stage: "Interrupted — resume required",
      /* The sentence reconcileStaleLeases actually writes. It names the lease and the
         heartbeat, which the record establishes, and never a window — see
         unobservableClaimChecks, which is what forbids the older wording rather than
         this fixture, which merely has to match it. */
      summary: "This run lost its active runner: its lease expired with no heartbeat.",
      runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "",
      leaseDiagnostics: { lastRunnerId: "runner-that-stopped-renewing", lastReleasedAt: ago(60), lastReleaseCode: "lease-expired" },
      current: { stepKey: "" }, config: {}, usage: {}, steps: {}, logs: [],
      createdAt: ago(1200), updatedAt: ago(60), completedAt: "",
    },
    /* A run the BROWSER interrupted for a reason of its own. Same status, and it must
       keep reading as something that needs attention. */
    {
      id: "run-stopped", type: "shot-chain", targetId: "L1-02", scope: "stills", label: "Stopped safely",
      status: "interrupted", stage: "Automation stopped", summary: "Automation stopped safely.",
      runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "", leaseDiagnostics: {},
      current: { stepKey: "" }, config: {}, usage: {}, steps: {}, logs: [],
      createdAt: ago(1200), updatedAt: ago(60), completedAt: "",
    },
  ];
  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(runs)};`, view.context);
  const partition = vm.runInContext(`(() => ({
    active: AUTOMATION_RUNS.filter(v670MachineActiveRun).map((run) => run.id),
    waiting: AUTOMATION_RUNS.filter(v670WaitingForHumanRun).map((run) => run.id),
    attention: AUTOMATION_RUNS.filter(v670AttentionRun).map((run) => run.id),
    unsettled: AUTOMATION_RUNS.filter(v670RunUnsettled).map((run) => run.id),
  }))()`, view.context);

  assert.deepStrictEqual(Array.from(partition.active).map(String), [],
    "a reconciled run is not machine work — nothing is driving it");
  assert.deepStrictEqual(Array.from(partition.waiting).map(String), ["run-abandoned"],
    "a run whose lease lapsed still reads as waiting for the director");
  assert.deepStrictEqual(Array.from(partition.attention).map(String), ["run-stopped"],
    "and is NOT filed as a previous failure — nothing about it failed");
  assert.deepStrictEqual(Array.from(partition.unsettled).map(String), ["run-abandoned"],
    "so the poll gate stays open for it");
  const detail = vm.runInContext(`v670WaitingDetail(AUTOMATION_RUNS[0], null)`, view.context);
  assert(/Resume Run/.test(detail), `the drawer must offer the resume, got ${JSON.stringify(detail)}`);
  note("surfaces: a reconciled run reads as waiting-for-you with a Resume Run, never as a previous failure");
}

/* ---------------------------------------------------------------------------
   ACCEPTANCE BLOCKER 1 — TWO DIFFERENT JOBS, ONE PROJECT.

   Per-job serialisation is keyed on the JOB, so it orders two collections of the SAME
   job and does nothing for two collections of different jobs in the same project. Both
   ingests used to read the whole project document, await their downloads for seconds,
   mutate their own copy and write it back whole — so whichever saved last silently
   dropped the other's candidate row, while both ledger rows still recorded `ingestedAt`
   and their outputs. A paid result became an unreferenced file that the record claimed
   had been delivered.

   THE SCHEDULE IS FORCED, NOT HOPED FOR. Job A's asset download is held open, so A is
   demonstrably holding project state it read before B existed. B is then collected end
   to end THROUGH THE REAL HTTP ROUTE, and only then is A released. Without the project
   turn, A's stale write lands last and B disappears. */
async function differentJobOverlapChecks() {
  const h = await harness();
  try {
    h.statusFor.set("req-A", "COMPLETED");
    h.statusFor.set("req-B", "COMPLETED");
    h.writeLedger([queued("job-A", "req-A", h.origin), queued("job-B", "req-B", h.origin)]);
    const owner = h.recovery.ownerFor("reaper-project");

    const gate = h.hold("req-A.png");
    /* A: collected by background recovery. */
    const collectingA = h.recovery.collect(owner, "job-A", { markFailureOnError: false, unattended: true });
    await gate.reached;
    assert.deepStrictEqual(h.project().shots[0].candidateFiles, [],
      "precondition: A is mid-download and has committed nothing, so its snapshot predates B entirely");

    /* B: collected by an explicit refresh, entirely inside A's window. */
    const refreshed = await fetch(`${h.base}/api/generation/fal/jobs/job-B/refresh`, { method: "POST" }).then((r) => r.json());
    assert(refreshed.ok, `the explicit refresh of B must succeed: ${JSON.stringify(refreshed)}`);
    const afterB = h.project().shots[0].candidateFiles.map((row) => row.stored);
    assert.strictEqual(afterB.length, 1, "B must be in the project before A's write lands — otherwise this schedule proves nothing");

    gate.release();
    const collectedA = await collectingA;
    assert(collectedA.ok && collectedA.collected, `A must have collected: ${JSON.stringify(collectedA)}`);

    /* --- THE PROPERTY --- */
    const stored = h.project().shots[0].candidateFiles.map((row) => row.stored);
    assert.strictEqual(stored.length, 2,
      `both candidate rows must survive; ${stored.length} did: ${JSON.stringify(stored)}`);
    assert.strictEqual(new Set(stored).size, 2, `and be distinct rows, not one row twice: ${JSON.stringify(stored)}`);

    /* --- ledger and project must agree, in both directions --- */
    const files = h.takes();
    assert.deepStrictEqual(files, [...stored].sort(), `every candidate row must name a file that exists, and no file may be unreferenced: rows=${JSON.stringify(stored)} files=${JSON.stringify(files)}`);
    const ledger = h.readLedger();
    for (const id of ["job-A", "job-B"]) {
      const row = ledger.find((item) => item.id === id);
      assert(row.ingestedAt, `${id} must record that it delivered`);
      assert.strictEqual((row.outputs || []).length, 1, `${id} must record exactly one output`);
      const named = row.outputs[0].name;
      assert(stored.includes(named), `${id} claims it delivered ${named}, which the project does not reference — the exact defect`);
    }

    /* --- repeated recovery stays idempotent, and nothing was submitted --- */
    const again = await h.poller.runOnce();
    assert.strictEqual(again.collected, 0, "a delivered result must not be collected twice");
    assert.deepStrictEqual(h.takes(), files, "and a second sweep must not add a file");
    assert.deepStrictEqual(h.project().shots[0].candidateFiles.map((row) => row.stored), stored, "nor a candidate row");
    assert.deepStrictEqual(h.calls.submissions, [],
      `the reaper submitted ${h.calls.submissions.length} provider request(s): ${JSON.stringify(h.calls.submissions)}`);

    /* --- THE STRUCTURAL HALF ---
       The schedule above proves ONE race is closed. This proves there is no second way
       to write the project document at all: `commitProject` is the only caller of
       `saveOwnerProject`, so a future ingest, repair or error path cannot reintroduce a
       snapshot write without deleting this assertion. Asserted against the source
       because it is a statement about the module's shape, not about one execution. */
    const source = fs.readFileSync(path.join(ROOT, "fal-generation.js"), "utf8").replace(/\r\n/g, "\n");
    /* Comments are stripped first, deliberately: commitProject's own header quotes the
       defective snapshot-write it replaced, and a scan that counted prose would be
       measuring the documentation rather than the code. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const writers = code
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter((row) => /(^|[^\w.])saveOwnerProject\(/.test(row.line))
      .filter((row) => !row.line.startsWith("function saveOwnerProject"));
    assert.strictEqual(writers.length, 1,
      `the project document must have exactly one writer; found ${writers.length}: ${JSON.stringify(writers.map((row) => row.line))}`);
    const commitBody = source.slice(source.indexOf("function commitProject("), source.indexOf("function commitProject(") + 400);
    assert(commitBody.includes("saveOwnerProject(owner, project)"),
      "and that writer must be commitProject, which re-reads the document inside its own turn");

    /* THE TURN ITSELF NOW LIVES IN generation-commit.js.
     *
     * ComfyUI V1 moved it there, unchanged, and the reason is this assertion's own
     * argument taken one step further: a chain only orders the callers that share its
     * Map. While fal was the only backend, a Map inside registerFalGeneration() was a
     * chain. A second backend with its own Map would not be a second chain — it would
     * be the absence of one, and the snapshot-clobbering defect proven above would
     * return through the door marked "new provider".
     *
     * So the mechanism is asserted where it now lives, and fal is asserted to reach it
     * rather than to reimplement it. The claim is strictly stronger than before: it is
     * now made about the writer EVERY backend uses, not about fal's private copy. */
    const commitModule = fs.readFileSync(path.join(ROOT, "generation-commit.js"), "utf8").replace(/\r\n/g, "\n");
    assert(/commitProjectDocument\(owner, mutate, \{/.test(commitBody),
      "fal's commitProject must delegate to the shared project turn, not open one of its own");
    assert(commitModule.includes("const project = read(owner);"),
      "re-reading inside the turn is the whole mechanism: a turn that trusted the caller's copy would be the snapshot write again");
    assert(commitModule.includes("write(owner, project);"),
      "and the write must happen inside the same turn as the read");
    /* THE KEY IS THE NARROWEST ONE THAT PROTECTS THE RECORD. Per project, so a slow
       background collection in one project can never be why a save in another waits. */
    assert(/function commitProjectDocument\(owner, mutate, io\) \{[\s\S]{0,400}?chain\(projectChains, owner\.dir,/.test(commitModule),
      "the project turn must be keyed on owner.dir, so unrelated projects never block each other");
    /* ONE Map, AT MODULE SCOPE. A chain declared inside a function is a new chain per
       call, which orders nothing. */
    assert(/^const projectChains = new Map\(\);$/m.test(commitModule),
      "the project chain's Map must be module-scoped, so every backend that requires it shares one");
    /* AND NO BACKEND MAY KEEP ITS OWN. This is the assertion that actually protects the
       invariant now: fal, and anything added later, must reach the shared turn. The list
       is discovered from the tree rather than typed, so a new backend is covered the day
       it lands rather than the day someone remembers this file. */
    assert(BACKEND_MODULES.includes("fal-generation.js"), `the backend census found ${JSON.stringify(BACKEND_MODULES)}`);
    for (const file of BACKEND_MODULES) {
      const backend = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      assert(!/projectChains\s*=\s*new Map\(/.test(backend),
        `${file} must not hold a second project-commit chain; it must use generation-commit.js`);
    }
    note("overlap: a held sweep of job A and a live refresh of job B in one project — both candidates survive, ledger and project agree, 0 submissions, and the project has exactly one writer");
  } finally { h.close(); }
}

/* ---------------------------------------------------------------------------
   ACCEPTANCE BLOCKER 2 — SHUTDOWN UNDER AN IN-FLIGHT COLLECTION.

   Two things were wrong and both are asserted here.

   THE FILES. Ingest used to write each asset to disk as it arrived, so a collection
   interrupted between two outputs left the first file on disk with no candidate row and
   no ingest stamp. The next boot collected the same paid result again, `nextFile` renamed
   around the orphan, and the project ended up referencing a duplicate while the original
   sat unreferenced forever. Downloads now complete before anything is written, so an
   interrupted collection leaves nothing at all.

   THE LIFECYCLE. `stop()` cleared timers and returned, so the process could exit while a
   collection was between its project write and its ledger stamp. It now waits for the
   sweep in flight, bounded. */
async function shutdownCoordinationChecks() {
  /* --- (a) shutdown with NO active sweep must not wait --- */
  const idle = await harness();
  try {
    const outcome = await idle.poller.stop();
    assert.deepStrictEqual(outcome, { waited: false, timedOut: false }, "stopping an idle poller must not wait for anything");
  } finally { idle.close(); }

  /* --- (b) shutdown with a sweep that completes normally --- */
  const normal = await harness();
  try {
    normal.statusFor.set("req-n", "COMPLETED");
    normal.writeLedger([queued("job-n", "req-n", normal.origin)]);
    const sweeping = normal.poller.runOnce();
    const stopped = await normal.poller.stop();
    await sweeping;
    assert.strictEqual(stopped.timedOut, false, "a sweep that finishes inside the grace window must not report a timeout");
    assert.strictEqual(normal.readLedger()[0].ingestedAt ? true : false, true,
      "and the collection it was running must be durably recorded before the process could exit");
    assert.deepStrictEqual(normal.calls.submissions, [], "shutdown must not submit anything");
  } finally { normal.close(); }

  /* --- (c) the reproduction: interrupted between two outputs of one paid job --- */
  const h = await harness();
  try {
    h.statusFor.set("req-two", "COMPLETED");
    h.behaviour.outputs.set("req-two", 2);
    h.writeLedger([queued("job-two", "req-two", h.origin, { outputCount: 2 })]);
    const owner = h.recovery.ownerFor("reaper-project");

    const gate = h.hold("req-two-2.png");     // hold the SECOND asset
    const collecting = h.recovery.collect(owner, "job-two", { markFailureOnError: false, unattended: true });
    collecting.catch(() => {});
    await gate.reached;

    /* THE STATE A SHUTDOWN WOULD FIND. The first asset has been fetched; nothing about
       it may be on disk, because nothing references it yet. */
    assert.deepStrictEqual(h.takes(), [],
      `an interrupted collection must leave no file to orphan; found ${JSON.stringify(h.takes())}`);
    assert.deepStrictEqual(h.project().shots[0].candidateFiles, [], "and no candidate row");
    assert(!h.readLedger()[0].ingestedAt, "and no ingest stamp");

    /* The process dies here: the held download is never released, exactly as a killed
       process never resumes one. The NEXT process starts clean. */
    const next = h.restart();
    const recollected = await next.recovery.collect(next.recovery.ownerFor("reaper-project"), "job-two", { markFailureOnError: false, unattended: true });
    assert(recollected.ok && recollected.collected, `the next process must collect the paid result: ${JSON.stringify(recollected)}`);

    const stored = h.project().shots[0].candidateFiles.map((row) => row.stored);
    const files = h.takes();
    assert.strictEqual(stored.length, 2, `exactly the two intended candidates must exist; got ${JSON.stringify(stored)}`);
    assert.deepStrictEqual(files, [...stored].sort(),
      `no unreferenced file may remain: rows=${JSON.stringify(stored)} files=${JSON.stringify(files)}`);
    assert.strictEqual(h.readLedger()[0].outputs.length, 2, "and the ledger must record both");
    assert.deepStrictEqual(h.calls.submissions, [], "and nothing was submitted");

    /* --- (d) a collection already committed is not fetched again --- */
    const downloadsBefore = h.calls.download.length;
    const third = await next.recovery.collect(next.recovery.ownerFor("reaper-project"), "job-two", { markFailureOnError: false, unattended: true });
    assert.strictEqual(third.collected, false, "an already-delivered job must not be collected a second time");
    assert.strictEqual(h.calls.download.length, downloadsBefore, "and must not be downloaded again");
    note("shutdown: idle stop waits for nothing; a normal sweep is awaited; an interrupted two-output collection leaves no orphan and the next process delivers exactly two");
  } finally { h.close(); }
}

/* ---------------------------------------------------------------------------
   ACCEPTANCE BLOCKER 3 — WHAT THE SERVER MAY SAY ABOUT WHY A RUN STOPPED.

   A lapsed lease establishes that the lease expired and no heartbeat renewed it. It does
   NOT establish that a browser closed, a tab went away, or that nobody was watching: a
   suspended tab, a sleeping machine and a lost network all produce the identical record
   with the window still open. Every surface the correction writes — the durable summary,
   the run log, the diagnostics sentence and the server console line — is checked here
   against one rule, so the ban cannot be satisfied on one surface and violated on
   another. */
const BROWSER_STATE_CLAIM = /\b(window|windows|tab|tabs|browser|nobody|no one|watching|onscreen|on-screen)\b/i;

async function unobservableClaimChecks() {
  const h = await harness();
  try {
    /* One run whose lease lapsed, reconciled through the real entry point. */
    const stale = staleRunFixtures().find((run) => run.id === "run-orphan");
    assert(stale, "the stale-lease fixture must exist");
    fs.writeFileSync(h.runsFile, JSON.stringify({ schemaVersion: 2, updatedAt: ago(0), runs: [stale] }, null, 2));

    const logged = [];
    const poller = createGenerationPoller({
      listProjectSlugs: () => [],
      recovery: h.recovery,
      reconcileStaleRuns: h.reconcileStaleRuns,
      log: (line) => logged.push(line),
      options: { bootDelayMs: 5, intervalMs: 5_000 },
    });
    await poller.runOnce();
    await poller.stop();

    const runs = JSON.parse(fs.readFileSync(h.runsFile, "utf8")).runs;
    const run = runs.find((item) => item.id === "run-orphan");
    assert(run, `the reconciled run must still be in the ledger: ${JSON.stringify(runs.map((r) => r.id))}`);
    assert.strictEqual(run.status, "interrupted", "the lapsed run must be recorded as interrupted");

    /* EVERY durable surface the correction writes. */
    const surfaces = {
      summary: run.summary,
      stage: run.stage,
      "leaseDiagnostics.lastReleaseReason": run.leaseDiagnostics?.lastReleaseReason,
      ...Object.fromEntries((run.logs || []).map((entry, index) => [`logs[${index}].message`, entry.message])),
      ...Object.fromEntries(logged.map((line, index) => [`console[${index}]`, line])),
    };
    for (const [where, text] of Object.entries(surfaces)) {
      const match = BROWSER_STATE_CLAIM.exec(String(text || ""));
      assert(!match, `${where} claims unobservable browser state ("${match?.[0]}"): ${text}`);
    }

    /* NON-VACUOUS: the surfaces must actually say something, and say the observable
       thing, rather than passing by being empty. */
    assert(/lease/i.test(run.summary), `the summary must name the lease: ${run.summary}`);
    assert(/heartbeat/i.test(run.summary), `and the missing heartbeat: ${run.summary}`);
    assert(logged.some((line) => /lease/i.test(line)), `the console line must name the lease: ${JSON.stringify(logged)}`);
    assert(Object.keys(surfaces).length >= 5, `all four surface kinds must have been examined: ${JSON.stringify(Object.keys(surfaces))}`);
    note(`wording: ${Object.keys(surfaces).length} durable/console surfaces carry lease-and-heartbeat language and none claims a window, tab, browser or watcher`);
  } finally { h.close(); }
}

/* ---------------------------------------------------------------------------
   9. THE ONE BROWSER EDIT, AND THE URL IT MUST NOT CHANGE.

   Asserted against the source, which this suite otherwise never does, because the
   surface it protects is reachable only in a real Chromium: several real-browser
   suites match "/api/generation/fal/jobs" EXACTLY — tests/ui-state-stability-real-browser.py
   fulfils that suffix and proxies anything else upstream, and every paid-call guard
   tests the route string against the method. Claiming the recovery notice with a query
   parameter would silently change what all of them matched, in a place no Node suite
   can execute. So the claim travels in a header, and the URL stays as it was. */
function browserClaimChecks() {
  const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
  const app = readLF(path.join("public", "app.js"));
  /* The ledger read moved into the project load transaction's PREPARE phase: it
     is an INPUT to the open, gathered before anything authoritative moves, rather
     than an await sitting between the record being installed and the save
     indicator being settled. What this section pins is unchanged - the URL is
     byte-identical, the claim rides a header, and the drawer never claims. */
  const call = app.match(/await fetch\((["'`]\/api\/generation\/fal\/jobs[^\n]*)\)\n/);
  assert(call, "public/app.js must still load the generation ledger on open");
  assert(app.includes("FAL_GENERATION_JOBS = prepared.falJobs;"),
    "and install what it read into the ledger the workspace reads");
  assert(call[1].startsWith('"/api/generation/fal/jobs"'), `the initial ledger load must keep its exact URL: ${call[1]}`);
  assert(!/["'`]\/api\/generation\/fal\/jobs\?/.test(app), "no query string may be added to the ledger route");
  assert(call[1].includes("x-cinebraid-claim-recovery"), `the initial load must carry the claim header: ${call[1]}`);
  assert.strictEqual(CLAIM_RECOVERY_HEADER, "x-cinebraid-claim-recovery", "and the server must read that same header");
  assert(app.includes("backgroundRecovery?.message"), "and must announce what it claimed");

  /* The other half: the drawer re-reads this route every 3.5 seconds and must never be
     the request that consumes the notice. */
  const activity = readLF(path.join("public", "live-activity.js"));
  assert(activity.includes('fetch("/api/generation/fal/jobs")'), "the drawer refresh must read the ledger plainly");
  assert(!activity.includes("x-cinebraid-claim-recovery"), "the drawer refresh must never claim the recovery notice");
  note("browser: the claim rides a header; the ledger URL is byte-identical and the drawer never claims");
}

/* ---------------------------------------------------------------------------
   10. BOOT RECOVERY IN THE REAL SERVER, WITH NO BROWSER AT ALL.

   Everything above drives the poller directly. This spawns server.js the way a
   filmmaker's machine does and never opens a page: no /refresh is ever posted, no
   ledger is ever fetched until the assertions. If the reaper were not wired into the
   server, nothing here would happen. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function bootRecoveryChecks() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-reaper-boot-"));
  const projectsRoot = path.join(tmp, "projects");
  const dir = path.join(projectsRoot, "boot-project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(projectFixture(), null, 2));
  const configPath = path.join(tmp, "config.json");

  const calls = { submissions: [], status: [], download: [] };
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let origin = "";
  mock.get("/status/:id", (req, res) => {
    calls.status.push(req.params.id);
    res.json({ status: "COMPLETED", response_url: `${origin}/result/${req.params.id}` });
  });
  mock.get("/result/:id", (req, res) => res.json({ images: [{ url: `${origin}/file/${req.params.id}.png`, content_type: "image/png" }] }));
  mock.get("/file/:name", (req, res) => { calls.download.push(req.params.name); res.set("content-type", "image/png").send(PNG); });
  mock.post("*", (req, res) => {
    calls.submissions.push({ path: req.path });
    res.json({ request_id: "req-should-never-exist", status_url: `${origin}/status/x`, response_url: `${origin}/result/x` });
  });
  const provider = await listen(mock);
  origin = originOf(provider);

  fs.writeFileSync(configPath, JSON.stringify({
    activeProject: "boot-project",
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: true, apiKey: "boot-test-key", baseUrl: origin, maxConcurrent: 2 } },
  }, null, 2));
  fs.writeFileSync(path.join(dir, "generation-jobs.json"), JSON.stringify([queued("job-boot", "req-boot", origin)], null, 2));
  /* A run the closed tab left claiming to be running, in the same project. */
  fs.writeFileSync(path.join(dir, "automation-runs.json"), JSON.stringify({
    schemaVersion: 2, updatedAt: ago(0), runs: [staleRunFixtures()[0]],
  }, null, 2));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CINEBRAID_CONFIG_PATH: configPath,
      CINEBRAID_PROJECTS_ROOT: projectsRoot,
      CINEBRAID_GENERATION_POLL_BOOT_MS: "150",
      CINEBRAID_GENERATION_POLL_MS: "400",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    const deadline = Date.now() + 25000;
    for (;;) {
      try { if ((await fetch(`${base}/api/me`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`Server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    /* NOTHING BELOW ASKS THE SERVER TO COLLECT. The wait watches the filesystem, so the
       only thing that could produce the file is the server's own sweep. */
    const collected = Date.now() + 20000;
    for (;;) {
      const takes = fs.readdirSync(path.join(dir, "shots", "SH-1", "takes"));
      if (takes.length) break;
      if (Date.now() > collected) throw new Error(`The server never collected the finished render:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    assert.deepStrictEqual(calls.submissions, [], `a booting server must not submit: ${JSON.stringify(calls.submissions)}`);
    const ledger = JSON.parse(fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8"));
    assert.strictEqual(ledger.length, 1, "no job was created");
    assert.strictEqual(ledger[0].status, "COMPLETED", "the finished render is recorded as finished");
    assert(ledger[0].ingestedAt, "and delivered, with no browser involved");
    assert.strictEqual(calls.download.length, 1, "the output was downloaded exactly once");

    /* The stale run was corrected by the SWEEP: this reads the file, not a route, so no
       read-time reconciliation can be what did it. */
    const runs = JSON.parse(fs.readFileSync(path.join(dir, "automation-runs.json"), "utf8")).runs;
    assert.strictEqual(runs[0].status, "interrupted", "the abandoned run was corrected on disk before anything read it");

    /* --- the recovery notice, through the ledger route the first window loads --- */
    const claim = { headers: { [CLAIM_RECOVERY_HEADER]: "1" } };
    const claimed = await fetch(`${base}/api/generation/fal/jobs`, claim).then((response) => response.json());
    assert(claimed.backgroundRecovery, "the first window must be told what arrived while it was closed");
    assert.strictEqual(claimed.backgroundRecovery.results, 1, "one result");
    assert.strictEqual(claimed.backgroundRecovery.message, "Collected 1 result through background recovery.",
      `unexpected notice: ${claimed.backgroundRecovery.message}`);
    /* The same sentence with no browser in existence as with three of them racing the
       sweep (see the coexistence section). That is the point: it describes the
       collector, which the server knows, and not the user, which it does not. */
    assert(!/window|windows|tab|nobody|unattended|no one|closed/i.test(claimed.backgroundRecovery.message),
      `even here, with no browser at all, the server may not claim one was absent: ${claimed.backgroundRecovery.message}`);
    const again = await fetch(`${base}/api/generation/fal/jobs`, claim).then((response) => response.json());
    assert(!again.backgroundRecovery, "and told once — a claimed notice must not repeat");
    /* The drawer re-reads this route every 3.5 seconds and must never have consumed it. */
    const drawer = await fetch(`${base}/api/generation/fal/jobs`).then((response) => response.json());
    assert(Array.isArray(drawer.jobs), "the ordinary read still answers with the ledger");
    assert(!drawer.backgroundRecovery, "and carries no unclaimed notice");

    note("boot: a spawned server with no browser collected 1 result, corrected 1 stale run, submitted 0 requests");
  } finally {
    child.kill();
    provider.close();
  }
}

async function main() {
  eligibilityChecks();
  abandonmentPredicateChecks();
  await sweepChecks();
  await coexistenceChecks();
  await differentJobOverlapChecks();
  await shutdownCoordinationChecks();
  await unobservableClaimChecks();
  await transientFailureChecks();
  await unconfiguredChecks();
  await staleRunChecks();
  await reconciledRunSurfaceChecks();
  browserClaimChecks();
  await bootRecoveryChecks();
  console.log("Generation ingest reaper suite passed:\n" + notes.map((line) => `  - ${line}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

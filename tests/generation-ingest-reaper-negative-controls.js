/* Negative controls for the server-side ingest reaper.
 *
 * Each control puts one defect back — a submission path reachable from the sweep,
 * eligibility that stops requiring a provider handle, the per-job serialisation that
 * makes a browser tab and the sweep safe together, a background poll that records a
 * provider failure it never received, a run mid-start interrupted at the instant it
 * claims its lease, a "correction" that corrects nothing, a recovery notice announced
 * on every read, and the sweep simply not running — and asserts the property guarding
 * it FAILS.
 *
 * A control that stays green is the real failure: the test it guards would not notice
 * the defect coming back.
 *
 * Defects are compiled IN MEMORY. Nothing on disk is modified or reverted.
 *
 * NO PAID CALL AND NO PROVIDER CALL. Every endpoint is a local express mock.
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const Module = require("module");
const vm = require("vm");
const express = require("express");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

/* Compile one module with a defect put back. Anchors are matched against LF-normalised
   source, because a Windows checkout with core.autocrlf on would otherwise fail every
   multi-line anchor and the failure would look like a source change. */
function loadModified(relative, edits) {
  const file = path.join(ROOT, relative);
  let code = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    assert(code.includes(from),
      `negative control anchor no longer exists in ${relative}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    code = code.replace(from, to);
  }
  const patched = new Module(file, module);
  patched.filename = file;
  patched.paths = Module._nodeModulePaths(path.dirname(file));
  patched._compile(code, file);
  return patched.exports;
}

const results = [];
async function control(label, guardedTest, run) {
  let detected = false;
  let outcome = "";
  try {
    await run();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = true;
    outcome = error.message.split("\n")[0];
  }
  assert(detected,
    `NEGATIVE CONTROL FAILED: reintroducing ${label} did not break "${guardedTest}". `
    + "That test cannot detect the defect it exists for.");
  results.push({ label, guardedTest, outcome });
}

/* ---------------------------------------------------------------------------
   The same shape the positive suite runs against: a real provider mock, the real
   fal-generation registration, and the real poller — except for whichever module the
   control replaced with a defective compilation. */
function projectFixture() {
  return {
    meta: { title: "Reaper controls", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", keyframes: [{ id: "FR-A", label: "A" }], candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    jobs: [], agentRuns: [], decisions: [], sessions: [],
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
function staleRuns() {
  return [
    {
      id: "run-orphan", type: "shot-chain", targetId: "SH-1", scope: "stills", label: "Abandoned",
      status: "running", stage: "Generating Frame A", summary: "", revision: 4,
      runnerId: "runner-that-went-away", leaseAcquiredAt: ago(1200), heartbeatAt: ago(900), leaseExpiresAt: ago(600),
      current: { stepKey: "" }, config: { maxImages: 21 }, usage: { imagesGenerated: 3 }, steps: {}, logs: [],
      createdAt: ago(1200), updatedAt: ago(900), completedAt: "",
    },
    {
      id: "run-claiming", type: "shot-chain", targetId: "SH-1", scope: "stills", label: "Starting up",
      status: "running", stage: "Preparing", summary: "", revision: 1,
      runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "",
      current: { stepKey: "" }, config: { maxImages: 21 }, usage: {}, steps: {}, logs: [],
      createdAt: ago(2), updatedAt: ago(2), completedAt: "",
    },
  ];
}

async function scenario(modules = {}) {
  const { registerFalGeneration } = modules.falGeneration || require(path.join(ROOT, "fal-generation"));
  const { registerAutomationRuns } = modules.automation || require(path.join(ROOT, "automation-runs"));
  const { createGenerationPoller } = modules.poller || require(path.join(ROOT, "generation-poller"));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-reaper-ctrl-"));
  const dir = path.join(tmp, "projects", "reaper-project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(projectFixture(), null, 2));

  const calls = { submissions: [], status: [], result: [], download: [] };
  const statusFor = new Map();
  const behaviour = { statusHttp: new Map(), stallMs: 0 };
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let origin = "";
  mock.get("/status/:id", async (req, res) => {
    calls.status.push(req.params.id);
    if (behaviour.stallMs) await new Promise((resolve) => setTimeout(resolve, behaviour.stallMs));
    const http = behaviour.statusHttp.get(req.params.id);
    if (http) return res.status(http).json({ detail: "provider error" });
    res.json({ status: statusFor.get(req.params.id) || "IN_QUEUE", response_url: `${origin}/result/${req.params.id}` });
  });
  mock.get("/result/:id", (req, res) => {
    calls.result.push(req.params.id);
    res.json({ images: [{ url: `${origin}/file/${req.params.id}.png`, content_type: "image/png" }] });
  });
  mock.get("/file/:name", (req, res) => { calls.download.push(req.params.name); res.set("content-type", "image/png").send(PNG); });
  mock.put("/cancel/:id", (req, res) => res.json({ ok: true }));
  mock.post("*", (req, res) => {
    calls.submissions.push({ path: req.path });
    const id = `req-submitted-${calls.submissions.length}`;
    res.json({ request_id: id, status_url: `${origin}/status/${id}`, response_url: `${origin}/result/${id}`, cancel_url: `${origin}/cancel/${id}` });
  });
  const provider = await listen(mock);
  origin = originOf(provider);

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  const context = {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "fal-test-key", baseUrl: origin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit", maxConcurrent: 4,
    } } }),
    readProject: () => JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")),
    writeProject: (project) => fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2)),
    activeSlug: () => "reaper-project",
    projectDirForSlug: () => ({ slug: "reaper-project", dir, file: path.join(dir, "project.json") }),
  };
  const FalGeneration = registerFalGeneration(app, context);
  const AutomationRuns = registerAutomationRuns(app, {
    projectDir: () => dir, readProject: context.readProject, activeSlug: context.activeSlug, projectReadinessIssues: () => [],
  });
  const cinebraid = await listen(app);
  const poller = createGenerationPoller({
    listProjectSlugs: () => ["reaper-project"],
    recovery: FalGeneration.recovery,
    reconcileStaleRuns: AutomationRuns.reconcileStaleRuns,
    log: () => {},
    options: { bootDelayMs: 5, intervalMs: 5_000 },
  });

  return {
    dir, origin, calls, statusFor, behaviour, poller,
    base: originOf(cinebraid),
    writeLedger: (jobs) => fs.writeFileSync(path.join(dir, "generation-jobs.json"), JSON.stringify(jobs, null, 2)),
    readLedger: () => JSON.parse(fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8")),
    writeRuns: (runs) => fs.writeFileSync(path.join(dir, "automation-runs.json"), JSON.stringify({ schemaVersion: 2, updatedAt: ago(0), runs }, null, 2)),
    readRuns: () => JSON.parse(fs.readFileSync(path.join(dir, "automation-runs.json"), "utf8")).runs,
    takes: () => fs.readdirSync(path.join(dir, "shots", "SH-1", "takes")),
    close: () => { poller.stop(); provider.close(); cinebraid.close(); },
  };
}

/* The guarded assertions, lifted verbatim in meaning from the positive suite so a
   control proves something about THAT suite rather than about a private copy. */
async function guardTheSweepNeverSubmits(modules) {
  const h = await scenario(modules);
  try {
    h.statusFor.set("req-collect", "COMPLETED");
    h.writeLedger([queued("job-collect", "req-collect", h.origin)]);
    await h.poller.runOnce();
    assert.deepStrictEqual(h.calls.submissions, [],
      `the reaper submitted ${h.calls.submissions.length} provider request(s)`);
  } finally { h.close(); }
}
async function guardOnlyAskableJobsAreAsked(modules) {
  const h = await scenario(modules);
  try {
    h.writeLedger([
      queued("job-working", "req-working", h.origin),
      queued("job-no-handle", "", h.origin, { status: "UNRESOLVED", externalId: "", statusUrl: "", responseUrl: "" }),
    ]);
    const summary = await h.poller.runOnce();
    assert.strictEqual(summary.polled, 1, "only the row with a provider handle is askable");
  } finally { h.close(); }
}
async function guardOneDeliveryUnderOverlap(modules) {
  const h = await scenario(modules);
  try {
    h.statusFor.set("req-race", "COMPLETED");
    h.behaviour.stallMs = 120;
    h.writeLedger([queued("job-race", "req-race", h.origin)]);
    const browser = () => fetch(`${h.base}/api/generation/fal/jobs/job-race/refresh`, { method: "POST" }).then((r) => r.json());
    await Promise.all([h.poller.runOnce(), browser(), browser(), browser()]);
    assert.strictEqual(h.calls.download.length, 1, `the output must be downloaded exactly once; got ${h.calls.download.length}`);
    assert.strictEqual(h.takes().length, 1, `exactly one file may be written; got ${JSON.stringify(h.takes())}`);
  } finally { h.close(); }
}
async function guardAFailedPollWritesNothing(modules) {
  const h = await scenario(modules);
  try {
    h.behaviour.statusHttp.set("req-flaky", 503);
    const before = queued("job-flaky", "req-flaky", h.origin);
    h.writeLedger([before]);
    await h.poller.runOnce();
    assert.deepStrictEqual(h.readLedger()[0], before,
      "a status request that failed must leave the durable row byte-for-byte unchanged");
  } finally { h.close(); }
}
async function guardStaleRunReconciliation(modules) {
  const h = await scenario(modules);
  try {
    h.writeRuns(staleRuns());
    h.writeLedger([]);
    await h.poller.runOnce();
    const byId = Object.fromEntries(h.readRuns().map((run) => [run.id, run]));
    assert.strictEqual(byId["run-orphan"].status, "interrupted", "an abandoned run stops claiming to be running");
    assert.strictEqual(byId["run-claiming"].status, "running", "a run mid-claim is not interrupted at the instant it starts");
  } finally { h.close(); }
}
async function guardTheRecoveryNoticeIsToldOnce(modules) {
  const h = await scenario(modules);
  try {
    h.statusFor.set("req-notice", "COMPLETED");
    h.writeLedger([queued("job-notice", "req-notice", h.origin)]);
    await h.poller.runOnce();
    const claim = { headers: { "x-cinebraid-claim-recovery": "1" } };
    const claimed = await fetch(`${h.base}/api/generation/fal/jobs`, claim).then((r) => r.json());
    assert(claimed.backgroundRecovery, "the first window must be told what arrived while it was closed");
    const again = await fetch(`${h.base}/api/generation/fal/jobs`, claim).then((r) => r.json());
    assert(!again.backgroundRecovery, "and told once — a claimed notice must not repeat");
  } finally { h.close(); }
}

/* THE NOTICE SAYS HOW IT WAS COLLECTED, NEVER WHO WAS WATCHING.
 *
 * Run the reproduced concurrency case — one sweep against three simultaneous browser
 * refreshes — and read the notice the next window is handed. The sweep takes delivery,
 * so a notice exists; three CineBraid windows demonstrably existed too, so a sentence
 * claiming none was open is false at the moment it is written.
 *
 * The server cannot know either way: pollEligibility is derived from durable job fields
 * alone and nothing on the server observes browsers. So this guard forbids the whole
 * SHAPE of the claim rather than one exact string — a reworded version of the same
 * falsehood must not pass it. */
async function guardTheNoticeClaimsOnlyBackgroundRecovery(modules) {
  const h = await scenario(modules);
  try {
    h.statusFor.set("req-notice-race", "COMPLETED");
    h.behaviour.stallMs = 120;
    h.writeLedger([queued("job-notice-race", "req-notice-race", h.origin)]);
    const browser = () => fetch(`${h.base}/api/generation/fal/jobs/job-notice-race/refresh`, { method: "POST" }).then((r) => r.json());
    const [sweep] = await Promise.all([h.poller.runOnce(), browser(), browser(), browser()]);
    assert.strictEqual(sweep.collected, 1, "precondition: the sweep must be the collector, or there is no notice to judge");
    assert.deepStrictEqual(h.calls.submissions, [], "precondition: no observer may submit");

    const claimed = await fetch(`${h.base}/api/generation/fal/jobs`, { headers: { "x-cinebraid-claim-recovery": "1" } }).then((r) => r.json());
    assert(claimed.backgroundRecovery, "precondition: the sweep collected, so a notice must exist to judge");
    assert.strictEqual(claimed.backgroundRecovery.message, "Collected 1 result through background recovery.",
      `the notice must say how the result was collected: ${claimed.backgroundRecovery.message}`);
    assert(!/window|windows|tab|nobody|unattended|no one|closed/i.test(claimed.backgroundRecovery.message),
      `the notice must make no claim about what was open or who was watching: ${claimed.backgroundRecovery.message}`);
  } finally { h.close(); }
}

/* The reconciled run as the activity surfaces read it, against the real
   public/live-activity.js under the render harness. Its `modules` parameter is the
   RELEASE CODE the reconciliation stamps: drop it and the surfaces lose the only thing
   that tells a run whose window went away from a run that stopped on its own. */
async function guardTheReconciledRunStillReadsAsWaiting(releaseCode = "lease-expired") {
  const { render, buildFixture } = require("./render-harness");
  const view = await render("#/production", buildFixture());
  const runs = [{
    id: "run-abandoned", type: "shot-chain", targetId: "L1-01", scope: "stills", label: "Window went away",
    status: "interrupted", stage: "Interrupted — resume required", summary: "The lease expired with no heartbeat.",
    runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "",
    leaseDiagnostics: { lastRunnerId: "runner-that-went-away", lastReleasedAt: ago(60), lastReleaseCode: releaseCode },
    current: { stepKey: "" }, config: {}, usage: {}, steps: {}, logs: [],
    createdAt: ago(1200), updatedAt: ago(60), completedAt: "",
  }];
  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(runs)};`, view.context);
  const partition = vm.runInContext(`(() => ({
    waiting: AUTOMATION_RUNS.filter(v670WaitingForHumanRun).map((run) => run.id),
    attention: AUTOMATION_RUNS.filter(v670AttentionRun).map((run) => run.id),
  }))()`, view.context);
  assert.deepStrictEqual(Array.from(partition.waiting).map(String), ["run-abandoned"],
    "a run whose window went away still reads as waiting for the director");
  assert.deepStrictEqual(Array.from(partition.attention).map(String), [],
    "and is NOT filed as a previous failure — nothing about it failed");
}

/* ---------------------------------------------------------------------------
   The boot guard, spawned exactly as the positive suite spawns it. The control here is
   not a patched module: it is the sweep not running at all, which is what would happen
   if the wiring in server.js were dropped. */
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
async function guardTheServerCollectsOnBoot(env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-reaper-boot-ctrl-"));
  const projectsRoot = path.join(tmp, "projects");
  const dir = path.join(projectsRoot, "boot-project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(projectFixture(), null, 2));

  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let origin = "";
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED", response_url: `${origin}/result/${req.params.id}` }));
  mock.get("/result/:id", (req, res) => res.json({ images: [{ url: `${origin}/file/${req.params.id}.png`, content_type: "image/png" }] }));
  mock.get("/file/:name", (req, res) => res.set("content-type", "image/png").send(PNG));
  mock.post("*", (req, res) => res.json({ request_id: "req-never", status_url: `${origin}/status/x`, response_url: `${origin}/result/x` }));
  const provider = await listen(mock);
  origin = originOf(provider);

  const configPath = path.join(tmp, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    activeProject: "boot-project",
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: true, apiKey: "boot-test-key", baseUrl: origin, maxConcurrent: 2 } },
  }, null, 2));
  fs.writeFileSync(path.join(dir, "generation-jobs.json"), JSON.stringify([queued("job-boot", "req-boot", origin)], null, 2));

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot,
      CINEBRAID_GENERATION_POLL_BOOT_MS: "150", CINEBRAID_GENERATION_POLL_MS: "400", ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const started = Date.now() + 25000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/me`)).ok) break; } catch {}
      if (Date.now() > started) throw new Error(`Server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    /* Deliberately short. The positive suite allows 20 seconds because it must never be
       flaky; a control only has to establish that nothing is coming, and four seconds is
       ten sweep intervals. */
    const deadline = Date.now() + 4000;
    let collected = false;
    while (Date.now() < deadline) {
      if (fs.readdirSync(path.join(dir, "shots", "SH-1", "takes")).length) { collected = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    assert(collected, "a spawned server with no browser must collect the finished render on its own");
  } finally {
    child.kill();
    provider.close();
  }
}

async function main() {
  /* 1. A submission path becomes reachable from the sweep. This is the invariant the
        whole pass exists for, and the control is what makes "0 submissions" evidence. */
  await control(
    "a submission reachable from the sweep",
    "the reaper never submits a provider request",
    () => guardTheSweepNeverSubmits({
      poller: loadModified("generation-poller.js", [[
        "            result = await recovery.collect(owner, job.id, { markFailureOnError: false, unattended: true });",
        "            await fetch(String(job.statusUrl).replace(/\\/status\\/.*$/, \"/openai/gpt-image-2\"), {\n"
        + "              method: \"POST\", headers: { \"content-type\": \"application/json\" }, body: JSON.stringify({ prompt: job.prompt }),\n"
        + "            }).catch(() => {});\n"
        + "            result = await recovery.collect(owner, job.id, { markFailureOnError: false, unattended: true });",
      ]]),
    }),
  );

  /* 2. Eligibility stops requiring evidence that the provider ever took the request. */
  await control(
    "eligibility that does not require a provider handle",
    "only jobs the provider demonstrably took are asked about",
    () => guardOnlyAskableJobsAreAsked({
      poller: loadModified("generation-poller.js", [[
        '  if (!Lifecycle.providerRequestId(job)) return refuse("no-provider-request-id");\n'
        + '  if (!String(job.statusUrl || "")) return refuse("no-status-handle");',
        "",
      ]]),
    }),
  );

  /* 3. The per-job serialisation that makes a browser tab and the sweep safe together. */
  await control(
    "collections that no longer take their turn",
    "one delivery even when a tab and the sweep observe the same job at once",
    () => guardOneDeliveryUnderOverlap({
      falGeneration: loadModified("fal-generation.js", [[
        "    const next = previous.catch(() => {}).then(run);\n    jobOperationChains.set(key, next.catch(() => {}));",
        "    const next = Promise.resolve().then(run);\n    jobOperationChains.set(key, next.catch(() => {}));",
      ]]),
    }),
  );

  /* 4. "I could not ask" recorded as "the provider failed" — the write that unblocks
        Generate and buys the same render a second time. */
  await control(
    "a background poll that records a provider failure it never received",
    "a failed status request leaves the durable row untouched",
    () => guardAFailedPollWritesNothing({
      falGeneration: loadModified("fal-generation.js", [[
        "    const markFailureOnError = options.markFailureOnError !== false;",
        "    const markFailureOnError = true;",
      ]]),
    }),
  );

  /* 5. A run interrupted at the instant it claims its lease. */
  await control(
    "abandonment that forgets a run mid-claim has not claimed yet",
    "a run that has never recorded a runner is left alone",
    () => guardStaleRunReconciliation({
      automation: loadModified("automation-runs.js", [[
        '  if (!String(run?.runnerId || "")) return false;',
        "",
      ]]),
    }),
  );

  /* 6. A "truth correction" that corrects nothing — the shipped defect itself. */
  await control(
    "a reconciliation that leaves the run claiming to be running",
    "an abandoned run stops claiming to be running",
    () => guardStaleRunReconciliation({
      automation: loadModified("automation-runs.js", [[
        '        status: "interrupted",\n        stage: "Interrupted — resume required",',
        '        stage: "Interrupted — resume required",',
      ]]),
    }),
  );

  /* 7. A recovery notice announced on every read, including the drawer's 3.5-second one. */
  await control(
    "a recovery notice that is never claimed",
    "the notice is announced once, to the window that opens",
    () => guardTheRecoveryNoticeIsToldOnce({
      falGeneration: loadModified("fal-generation.js", [[
        "    if (claim) unattendedCollections.delete(slug);",
        "",
      ]]),
    }),
  );

  /* 8. The correction landing WITHOUT the release code that names which half of
        `interrupted` it is. This is the shape the first version of the change actually
        had, and tests/production-state-honesty-real-browser.py caught it: a resumable
        run left WAITING FOR YOU for PREVIOUS FAILURES. */
  await control(
    "a stale-lease correction that does not say why the lease was released",
    "a reconciled run still reads as waiting for you, not as a failure",
    () => guardTheReconciledRunStillReadsAsWaiting(""),
  );

  /* 9. The false wording put back: a notice telling the filmmaker no CineBraid window
        was open, asserted at the exact moment three of them had just raced the server
        for this job. The server has no browser observation of any kind, so this is a
        claim it is not entitled to make — and the shipped defect it actually made. */
  await control(
    "a recovery notice that claims no CineBraid window was open",
    "the notice names background recovery and claims nothing about what was open",
    () => guardTheNoticeClaimsOnlyBackgroundRecovery({
      falGeneration: loadModified("fal-generation.js", [[
        '      message: `Collected ${results} result${results === 1 ? "" : "s"} through background recovery.`,',
        '      message: `Collected ${results} result${results === 1 ? "" : "s"} while no CineBraid window was open.`,',
      ]]),
    }),
  );

  /* 10. The sweep not running at all — what dropping the wiring in server.js looks like
        from outside. Without this control, the boot test could be passing on something
        other than the reaper. */
  await control(
    "a server whose sweep never runs",
    "a spawned server collects a finished render with no browser open",
    () => guardTheServerCollectsOnBoot({ CINEBRAID_GENERATION_POLL: "off" }),
  );

  console.log(
    `Ingest reaper negative controls passed: ${results.length} reintroduced defects, each detected.\n`
    + results.map((row) => `  - ${row.label}\n      breaks: ${row.guardedTest}\n      via: ${row.outcome}`).join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

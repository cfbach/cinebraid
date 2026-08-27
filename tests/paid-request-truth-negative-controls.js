/* PAID REQUEST TRUTH — negative controls.
 *
 * tests/paid-request-truth.js asserts that the money boundary enforces the request. Every
 * one of those assertions is worthless if it would still pass with the enforcement gone,
 * so each control below REINTRODUCES the exact defect the slice removed — in memory, into
 * a private module instance — runs the real property, and requires it to break.
 *
 * The CineBraid standard, applied here:
 *   1. the mutation is proved to have landed (loadModified() refuses a stale anchor and
 *      refuses a non-unique one, so a control cannot quietly patch nothing);
 *   2. the unsafe path is genuinely executed — every control below drives a real POST
 *      through a real express app against a real mock provider;
 *   3. the bad state is exposed literally, in the failure message;
 *   4. the named detector is what fires;
 *   5. only an AssertionError counts as detection — a TypeError from a broken mutation is
 *      re-thrown, because a control that crashes has proved nothing;
 *   6. bytes are never touched: the mutation exists only in the string handed to
 *      Module._compile, so there is nothing to restore and the tree cannot drift.
 *
 * ZERO PAID CALLS. Every provider here is a local express mock.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const express = require("express");

const Presentation = require("../public/shared-generation-presentation");
const BuildHistory = require("../public/shared-build-history");
const { IMAGE_MODEL_ID } = require("../image-execution");
const { addFramePromptBuild, baseSpec, buildRef, REF_IDENTITY } = require("./image-execution-fixture");
const { declaredGenerationBody } = require("./generation-request-fixture");

const ROOT = path.join(__dirname, "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const KAI_PNG = "/assets/anchors/KAI.png";

/* Compile a private copy of a module with the named substitutions applied.
 *
 * Normalised to LF before matching: this repository is checked out with core.autocrlf on,
 * so a multi-line anchor containing \n matches ZERO times against the bytes on disk — and
 * the control would abort with "anchor no longer exists" while the source was perfectly
 * fine. That failure looks like a source change and is not one. */
function loadModified(relative, edits) {
  const file = path.join(ROOT, relative);
  let code = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    assert(code.includes(from),
      `negative control anchor no longer exists in ${relative}; the control must be UPDATED, not deleted:\n${from}`);
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
    /* ONLY AN ASSERTION COUNTS. A TypeError means the mutation broke the module rather
       than reintroducing the defect, and a control that crashes has proved nothing about
       the property it claims to guard. */
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = true;
    outcome = error.message.split("\n")[0];
  }
  assert(detected,
    `NEGATIVE CONTROL FAILED: reintroducing ${label} did not break "${guardedTest}". `
    + "That test cannot detect the defect it exists for.");
  results.push({ label, guardedTest, outcome });
}

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;

function makeProject() {
  return {
    meta: { title: "Paid request truth controls", aspectRatio: "16:9" },
    shots: [{
      id: "SH-1",
      candidateFiles: [],
      frames: [{ id: "FR-A", label: "A", description: "Kai sets the parcel down.", winner: "" }],
      clips: [],
      creationBrief: {},
    }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
}

/* The same server the real suite drives, built from whichever fal-generation.js the
   caller hands in — the real one, or a mutated private copy. */
async function harness(falGeneration, options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-paid-truth-ctrl-"));
  const dir = path.join(tmp, "project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "anchors"), { recursive: true });
  fs.writeFileSync(path.join(dir, "anchors", "KAI.png"), PNG);
  fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "A.png"), PNG);
  const file = path.join(dir, "project.json");
  fs.writeFileSync(file, JSON.stringify(makeProject(), null, 2));

  const calls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    const id = `img-${calls.length + 1}`;
    calls.push({ endpoint: req.path, body: req.body });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "IN_QUEUE" }));
  mock.get("/result/:id", (req, res) => res.json({ images: [] }));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  falGeneration.registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "fal-secret-test-key", baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit",
      maxConcurrent: 8, frameResolution: "1k", blockingResolution: "1k",
      frameQuality: "high", blockingQuality: "low", frameOutputs: 1, blockingOutputs: 1,
      estimatedCostPerImage: options.ratePerImage === undefined ? 0.06 : options.ratePerImage,
    } } }),
    readProject: () => JSON.parse(fs.readFileSync(file, "utf8")),
    writeProject: (project) => fs.writeFileSync(file, JSON.stringify(project, null, 2)),
    activeSlug: () => "ctrl",
    projectDirForSlug: () => ({ slug: "ctrl", dir, file }),
  });
  const appServer = await listen(app);
  const appOrigin = originOf(appServer);

  return {
    dir, file, calls, appOrigin,
    plan: async (body) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/image/plan`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    },
    post: async (body) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/jobs`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    },
    settle: async (jobId) => {
      if (!jobId) return;
      await fetch(`${appOrigin}/api/generation/fal/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" },
      });
    },
    project: () => JSON.parse(fs.readFileSync(file, "utf8")),
    saveProject: (project) => fs.writeFileSync(file, JSON.stringify(project, null, 2)),
    saveRuns: (rows) => fs.writeFileSync(path.join(dir, "automation-runs.json"), JSON.stringify(rows, null, 2)),
    ledger: () => {
      const raw = path.join(dir, "generation-jobs.json");
      if (!fs.existsSync(raw)) return [];
      const parsed = JSON.parse(fs.readFileSync(raw, "utf8"));
      return Array.isArray(parsed) ? parsed : (parsed.jobs || []);
    },
    close: () => { appServer.close(); mockServer.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

function seedFramePackage(h) {
  const project = h.project();
  const buildId = addFramePromptBuild(project, "SH-1", {
    frameId: "FR-A",
    spec: baseSpec({ shotId: "SH-1" }),
    references: [buildRef(REF_IDENTITY, KAI_PNG)],
  });
  h.saveProject(project);
  return buildId;
}

function framePlanBody(buildId, extra = {}) {
  return {
    purpose: "frame", imagePlan: true, shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
    sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
    aspectRatio: "16:9", ...extra,
  };
}

/* The size the compiled path resolves for the 4K tier at 16:9. Named once so a control
   asserting "the 4K size reached the adapter" is comparing against a value the real
   suite also observed rather than a number written from memory. */
const FOUR_K = JSON.stringify({ width: 3840, height: 2160 });

async function main() {
  /* =======================================================================
     1. THE GATE ITSELF, GONE.

     The defect the slice exists to remove: the money boundary accepting whatever arrives.
     With the gate removed, a Simple request carrying an expert size reaches the adapter
     with that size — which is the exact bypass a replayed POST performed before. */
  await control("a money boundary that does not restrict the payload it was handed",
    "a control the active view never rendered cannot reach the adapter", async () => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    const planGate = enforceRequestPlan(owner, req, purpose);",
        `    const planGate = { ok: true, surface: "compiled-frame", declaration: { viewMode: "simple", selectedOptionId: "", selectedModelId: "" }, payload: req.body, removed: [] };`,
      ]]);
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post({
          ...framePlanBody(buildId, { resolution: "4k" }),
          generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" }),
        });
        assert.strictEqual(result.status, 200, `the unsafe path must actually run: ${JSON.stringify(result.data)}`);
        assert.strictEqual(h.calls.length, 1, "and must actually reach the provider");
        assert.notStrictEqual(JSON.stringify(h.calls[0].body.image_size), FOUR_K,
          `THE DEFECT: a Simple request reached the adapter carrying the 4K size the view never rendered — image_size ${JSON.stringify(h.calls[0].body.image_size)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     2. AN UNDECLARED BODY, DEFAULTED INSTEAD OF REFUSED.

     The tempting wrong answer. Defaulting an absent declaration to Advanced is what a
     "be lenient with old clients" instinct produces, and it hands every replayed body the
     widest vocabulary in the system — silently, with no code and no record. */
  await control("an absent declaration defaulted to the widest view instead of refused",
    "a paid request that does not say what built it is refused", async () => {
      const falGeneration = loadModified("fal-generation.js", [[
        `    if (!declaration.declared)
      return {
        ok: false,
        status: 400,
        code: "GENERATION_PLAN_REQUIRED",`,
        `    if (!declaration.declared)
      return enforceRequestPlan(owner, { ...req, body: { ...req.body, generationRequest: { surface: legal[0], viewMode: "advanced" } } }, purpose) || {
        ok: false,
        status: 400,
        code: "GENERATION_PLAN_REQUIRED",`,
      ]]);
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post(framePlanBody(buildId, { resolution: "4k" }));
        assert.strictEqual(h.calls.length <= 1, true, "the unsafe path runs at most once");
        assert.notStrictEqual(result.status, 200,
          `THE DEFECT: an undeclared paid request was accepted and dispatched — HTTP ${result.status}, adapter received ${JSON.stringify(h.calls[0] && h.calls[0].body.image_size)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     3. A DECLARATION TAKEN ON TRUST.

     If the boundary accepts whichever surface a body names, the declaration stops being
     evidence and becomes a menu: a request picks the vocabulary that governs it least and
     the gate politely applies it. */
  await control("a declared surface accepted without checking the request could be it",
    "a request cannot choose the vocabulary that governs it least", async () => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    if (!legal.includes(declaration.surface))",
        "    if (false && !legal.includes(declaration.surface))",
      ]]);
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post({
          ...framePlanBody(buildId, { resolution: "4k" }),
          /* `reference-automation` leaves resolution out of its vocabulary, so naming it
             is how a Simple request smuggles an expert size past the gate. */
          generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        });
        assert.strictEqual(result.status, 200, `the unsafe path must actually run: ${JSON.stringify(result.data)}`);
        assert.notStrictEqual(JSON.stringify(h.calls[0].body.image_size), FOUR_K,
          `THE DEFECT: a compiled-frame request called itself reference-automation and its 4K size reached the adapter — image_size ${JSON.stringify(h.calls[0].body.image_size)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     4. THE STALE REPLAY, UNGUARDED.

     Slice 0's freshness gates are browser code. Remove the boundary's own check and a
     package the shot has already moved past is compiled and dispatched — which is what a
     replayed POST did before this slice, and what a second CineBraid window can still do
     to a dialog left open. */
  await control("a money boundary that does not check whether the package is still current",
    "a package the shot no longer stands behind is refused before dispatch", async () => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    const staleRefusal = packageFreshnessRefusal(owner, job);",
        "    const staleRefusal = null;",
      ]]);
      const h = await harness(falGeneration);
      try {
        const project = h.project();
        const buildId = addFramePromptBuild(project, "SH-1", {
          frameId: "FR-A", spec: baseSpec({ shotId: "SH-1" }), references: [buildRef(REF_IDENTITY, KAI_PNG)],
        });
        const shot = project.shots[0];
        const pack = project.promptBuildsById[buildId];
        pack.dependencySnapshot = {
          ...BuildHistory.packageProjectInputs(project, shot, pack, BuildHistory.packageDirection(shot, pack)),
          references: [],
        };
        h.saveProject(project);
        /* The shot moves on, exactly as the real suite's reproduction does. */
        const moved = h.project();
        moved.shots[0].frames[0].winner = "A.png";
        h.saveProject(moved);

        const result = await h.post(declaredGenerationBody(framePlanBody(buildId)));
        assert.notStrictEqual(result.status, 200,
          `THE DEFECT: an out-of-date package was dispatched — HTTP ${result.status}, ${h.calls.length} provider call(s), and the job row claims ${JSON.stringify((h.ledger()[0] || {}).sourceBuildId)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     5. THE COMPARATOR'S SKIP RULE, REMOVED.

     The subtler half of freshness, and the one that would make the boundary WRONG rather
     than merely quiet. The server supplies no `references` field — it cannot enumerate
     what the production may currently supply without a second reference catalogue. Remove
     the "compare only what both sides have" rule and every package on the system reads
     stale, for a difference nobody has evidence for. */
  await control("a freshness comparator that compares fields one side never supplied",
    "a comparison nobody has evidence for is not a finding", async () => {
      const history = loadModified("public/shared-build-history.js", [[
        `  function comparable(saved, now, key) {
    return saved?.[key] !== undefined && now?.[key] !== undefined;
  }`,
        `  function comparable(saved, now, key) {
    return saved?.[key] !== undefined;
  }`,
      ]]);
      const project = makeProject();
      const shot = project.shots[0];
      const pack = { frameId: "FR-A" };
      pack.dependencySnapshot = {
        ...history.packageProjectInputs(project, shot, pack, history.packageDirection(shot, pack)),
        /* A saved snapshot always records its references. The server's `now` never does. */
        references: [["kai", KAI_PNG, "identity", "image", ""]],
      };
      const freshness = history.packageProjectFreshness(project, shot, pack);
      assert.deepStrictEqual(freshness.reasons, [],
        `THE DEFECT: a current package was declared stale for a field the server never supplied — ${JSON.stringify(freshness.reasons)}`);
    });

  /* =======================================================================
     6. THE MODEL MISMATCH, WAVED THROUGH.

     A picker that offers a model and a route that dispatches a different one is a screen
     telling a filmmaker something untrue about what they are buying. Remove the refusal
     and the request proceeds with the ledger recording a selection the dispatch ignored. */
  await control("a boundary that dispatches its own model whatever the screen named",
    "the model the screen named is dispatched or the request is refused", async () => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    const identityRefusal = modelIdentityRefusal(job, cfg);",
        "    const identityRefusal = null;",
      ]]);
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post({
          ...framePlanBody(buildId),
          generationRequest: Presentation.generationRequestDeclaration({
            surface: "compiled-frame", viewMode: "advanced",
            selectedOptionId: "some-other-model::fal-queue::t2i", selectedModelId: "some-other-model",
          }),
        });
        assert.notStrictEqual(result.status, 200,
          `THE DEFECT: a request set up for "some-other-model" was dispatched to ${IMAGE_MODEL_ID} — HTTP ${result.status}, and the job row records selectedModelId ${JSON.stringify((h.ledger()[0] || {}).selectedModelId)} beside model ${JSON.stringify((h.ledger()[0] || {}).model)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     7. THE SPEND CAP, READING A COUNT AS A TOTAL.

     This one is not hypothetical: it is the defect the real suite caught in this slice's
     own first draft. `summarizeRecordedCost()` returns `amount` (the summed total) beside
     `priced` (how many jobs it came from). Read the count where the total belongs and the
     guard never fires — while looking, in every review and in every log, exactly like a
     guard that is working. */
  await control("a spend guard that reads the priced-job COUNT where the total belongs",
    "a bounded run cannot exceed the spend it was authorised for", async () => {
      const falGeneration = loadModified("fal-generation.js", [[
        "      const projected = Number(spent.amount || 0) + (Number.isFinite(pendingAmount) ? pendingAmount : 0);",
        "      const projected = Number(spent.priced?.amount || 0) + (Number.isFinite(pendingAmount) ? pendingAmount : 0);",
      ]]);
      const h = await harness(falGeneration, { ratePerImage: 0.06 });
      try {
        const buildId = seedFramePackage(h);
        const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        h.saveRuns([{
          id: "run-1", schemaVersion: 2, revision: 1, status: "running",
          runnerId: "runner-1", leaseExpiresAt: lease,
          config: { maxImages: 4, outputsPerRequest: 1, maxSpend: { priced: true, amount: 0.12, quantity: 2, unitBasis: "image", ratePerUnit: 0.06 } },
          usage: { imagesGenerated: 0 }, steps: {}, logs: [],
        }]);
        const runBody = (step) => ({
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
          sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
          aspectRatio: "16:9", outputCount: 1, quality: "high", resolution: "1k", clientRequestId: step,
          automationRunId: "run-1", automationStepKey: step, automationRunnerId: "runner-1",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
        });
        const first = await h.post(runBody("step-1"));
        const second = await h.post(runBody("step-2"));
        assert.strictEqual(first.status, 200, `the authorised work must actually run: ${JSON.stringify(first.data)}`);
        assert.strictEqual(second.status, 200, `and the second: ${JSON.stringify(second.data)}`);
        await h.settle(first.data.job.id);
        await h.settle(second.data.job.id);
        const third = await h.post(runBody("step-3"));
        assert.notStrictEqual(third.status, 200,
          `THE DEFECT: a run authorised for $0.12 dispatched a third $0.06 job — HTTP ${third.status}, ${h.calls.length} provider calls, total estimated ${h.ledger().reduce((sum, row) => sum + Number(row.accounting?.estimate?.amount || 0), 0)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     8. THE COVERAGE JOIN, TURNED INTO AN OPINION.

     The dialog renders the compiler's coverage record and judges nothing. The way that
     stops being true is not a rewrite — it is a filter that looks like tidying: drop the
     entries with nothing good to say, and a request missing a piece of the filmmaker's
     direction presents a clean bill of health. */
  await control("a coverage projection that quietly drops what the model cannot do",
    "the boundary reports the compiler's record whole", async () => {
      const falGeneration = loadModified("fal-generation.js", [[
        `function labelledCoverage(coverage) {
  return (Array.isArray(coverage) ? coverage : []).map((entry) => ({`,
        `function labelledCoverage(coverage) {
  return (Array.isArray(coverage) ? coverage : []).filter((entry) => entry?.state !== "unsupported").map((entry) => ({`,
      ]]);
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        /* The still-image plan preview is where a filmmaker reads coverage before paying.
           A frame plan for a fully directed shot always carries unsupported intents: a
           still cannot render a camera move or a spoken line, and the compiler says so. */
        const preview = await h.plan({ purpose: "frame", shotId: "SH-1", sourceBuildId: buildId });
        assert.strictEqual(preview.status, 200, `the plan preview must compile: ${JSON.stringify(preview.data)}`);
        const coverage = preview.data.coverage || [];
        assert(coverage.length > 0, "the unsafe path must actually produce a coverage record");
        assert(coverage.some((entry) => entry.state === "unsupported"),
          `THE DEFECT: every intent this still image cannot carry was filtered out of the record the dialog reads — ${coverage.length} entries survived and not one of them says anything is missing`);
      } finally { h.close(); }
    });

  console.log("");
  console.log(`Paid request truth negative controls passed: ${results.length} deliberate defects reintroduced in memory —`);
  for (const row of results) console.log(`  - ${row.label} → detected by "${row.guardedTest}"`);
  console.log("  - every mutation lived only in a private module instance; no file on disk was written, and 0 paid calls were made");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

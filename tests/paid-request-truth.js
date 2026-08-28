/* PAID REQUEST TRUTH — the money boundary enforces the request, not the screen.
 *
 * Batch 2 Slice 4 gave every generation dialog a control plan and made each one restrict
 * its own body through restrictPayloadToPlan(). That was a real guarantee about the
 * SCREEN and no guarantee at all about the REQUEST: the gate ran in the browser, and
 * POST /api/generation/fal/jobs — the one line in CineBraid where money is committed —
 * had never been told a view mode existed. It could not distinguish a body a dialog had
 * built from one typed by hand, replayed from a log, or sent by a client that had simply
 * not been updated.
 *
 * Everything below is about that one line. The properties it asserts:
 *
 *   1. A paid request that does not say what built it is REFUSED. Not defaulted to the
 *      narrow reading, not passed through — refused, with a code, before any row exists.
 *   2. A declaration cannot choose the vocabulary that governs it least.
 *   3. Simple's guarantee holds at the boundary: an expert key the active view never
 *      rendered does not reach the adapter, whoever sent it.
 *   4. Advanced is not over-stripped. The gate removes what the view hides, not what the
 *      route dislikes.
 *   5. The dispatchers that previously sent no plan at all now declare one, and the
 *      unsupported machine settings they could always have carried are stripped.
 *   6. The model the screen named is the model dispatched, or the request is refused.
 *   7. A package the shot no longer stands behind is refused server-side, from the SAME
 *      comparator the browser gate uses.
 *   8. A bounded run cannot exceed the spend it was authorised for, not only the count.
 *   9. What the screen was showing is recorded on the job.
 *
 * ZERO PAID CALLS. Every provider in this suite is a local express mock; the assertions
 * about "reached the adapter" are assertions about what that mock received.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const express = require("express");

const Module = require("module");
const { registerFalGeneration } = require("../fal-generation");

/* FAULT INJECTION FOR THE DURABILITY SEAMS.
 *
 * A durable step is made to fail by compiling a private copy of the route with that step
 * replaced. This is not a try/catch test dressed up: what each seam asserts afterwards is
 * read straight off the two files on disk, which is the only thing a stopped process
 * leaves behind. Nothing is written to the repository — the mutation exists only in the
 * string handed to Module._compile, and the anchor is proved unique so a control cannot
 * silently patch nothing. */
function loadRouteWithFault(edits) {
  const file = path.join(__dirname, "..", "fal-generation.js");
  let code = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    assert(code.includes(from), `durability fault anchor no longer exists in fal-generation.js:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the fault anchor must be unique:\n${from}`);
    code = code.replace(from, to);
  }
  const patched = new Module(file, module);
  patched.filename = file;
  patched.paths = Module._nodeModulePaths(path.dirname(file));
  patched._compile(code, file);
  return patched.exports;
}
const Presentation = require("../public/shared-generation-presentation");
const BuildHistory = require("../public/shared-build-history");
const { imageControlCapability, IMAGE_MODEL_ID } = require("../image-execution");
const Options = require("../public/shared-generation-options");
const CoverageOwnership = require("../public/shared-coverage");
const Lifecycle = require("../generation-lifecycle");
const { addFramePromptBuild, baseSpec, buildRef, REF_IDENTITY } = require("./image-execution-fixture");
const { declaredGenerationBody } = require("./generation-request-fixture");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const KAI_PNG = "/assets/anchors/KAI.png";

const notes = [];
const note = (line) => notes.push(line);

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;

function makeProject() {
  return {
    meta: { title: "Paid request truth", aspectRatio: "16:9" },
    shots: [{
      id: "SH-1",
      candidateFiles: [],
      frames: [{ id: "FR-A", label: "A", description: "Kai sets the parcel down.", winner: "" }],
      clips: [],
      creationBrief: {},
    }],
    characters: [], locations: [], props: [], vehicles: [],
    mediaAssets: [],
  };
}

/* One server, one mock provider, one project on disk. Deliberately the same shape as
   tests/image-execution-wiring.js's harness so a reader comparing the two is comparing
   the assertions rather than the scaffolding. */
async function harness(options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-paid-truth-"));
  const dir = path.join(tmp, "project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "blocking"), { recursive: true });
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
    /* A provider that refuses, for the one reproduction that needs submission to fail
       AFTER the dispatch-commit point. Still loopback; still no paid call. */
    if (options.providerStatus && options.providerStatus !== 200)
      return res.status(options.providerStatus).json({ detail: "provider refused" });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}` });
  });
  /* A cancel the provider actually receives. Recorded apart from `calls` on purpose:
     every assertion in this suite reads `calls.length` as "paid submissions", and a
     cancel is not one. */
  const cancelCalls = [];
  mock.put("/cancel/:id", (req, res) => { cancelCalls.push(req.params.id); res.json({ status: "CANCELLED" }); });
  mock.get("/status/:id", (req, res) => res.json({ status: "IN_QUEUE" }));
  mock.get("/result/:id", (req, res) => res.json({ images: [] }));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  const runs = { file: path.join(dir, "automation-runs.json") };
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  (options.falGeneration || { registerFalGeneration }).registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "fal-secret-test-key", baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit",
      maxConcurrent: 8, frameResolution: "1k", blockingResolution: "1k",
      frameQuality: "high", blockingQuality: "low", frameOutputs: 1, blockingOutputs: 1,
      estimatedCostPerImage: options.ratePerImage === undefined ? 0.06 : options.ratePerImage,
    } } }),
    readProject: () => JSON.parse(fs.readFileSync(file, "utf8")),
    writeProject: (project) => fs.writeFileSync(file, JSON.stringify(project, null, 2)),
    activeSlug: () => "truth",
    projectDirForSlug: () => ({ slug: "truth", dir, file }),
  });
  const appServer = await listen(app);
  const appOrigin = originOf(appServer);

  /* RAW. This suite is the one place that must be able to post an undeclared body, so it
     deliberately does not go through tests/generation-request-fixture.js's stamp. */
  const post = async (body) => {
    const response = await fetch(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };

  /* The route caps concurrency at two, and this suite's mock leaves every job IN_QUEUE
     on purpose — nothing here is about ingest. Retiring a job between requests is what
     lets one harness make a third one; it is bookkeeping, not part of any assertion. */
  const settle = async (jobId) => {
    if (!jobId) return;
    await fetch(`${appOrigin}/api/generation/fal/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST", headers: { "content-type": "application/json" },
    });
  };

  return {
    dir, file, calls, cancelCalls, post, runs, settle, appOrigin,
    project: () => JSON.parse(fs.readFileSync(file, "utf8")),
    saveProject: (project) => fs.writeFileSync(file, JSON.stringify(project, null, 2)),
    saveRuns: (rows) => fs.writeFileSync(runs.file, JSON.stringify(rows, null, 2)),
    /* WHAT THE STORES HOLD, read straight off disk rather than through any route — the
       only honest way to ask what survived an interruption. */
    durable: () => ({
      jobs: (() => {
        const raw = path.join(dir, "generation-jobs.json");
        if (!fs.existsSync(raw)) return [];
        const parsed = JSON.parse(fs.readFileSync(raw, "utf8"));
        return Array.isArray(parsed) ? parsed : (parsed.jobs || []);
      })(),
      coverage: (JSON.parse(fs.readFileSync(file, "utf8")).characters || [])
        .map((row) => row.coverageAutomation).filter(Boolean),
    }),
    /* THE COVERAGE OPERATION'S OWN ENTRY POINT. The browser asks the server to run
       coverage; the server establishes the run and dispatches through the same boundary. */
    mockOrigin,
    reconcile: async (jobId, outcome, note) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/jobs/${encodeURIComponent(jobId)}/reconcile`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome, note }),
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    },
    cancel: async (jobId) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" },
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    },
    refresh: async (jobId) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/jobs/${encodeURIComponent(jobId)}/refresh`, {
        method: "POST", headers: { "content-type": "application/json" },
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    },
    coverage: async (body) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/coverage/jobs`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    },
    /* WHAT A GENERIC PROJECT SAVE IS ALLOWED TO AUTHOR, applied exactly as server.js
       applies it inside prepareSuccessor() for a NORMAL_SAVE. The end-to-end proof that
       the real PUT route runs this is reproduction 20b, which drives the shipped server. */
    genericSave: (mutate) => {
      const current = JSON.parse(fs.readFileSync(file, "utf8"));
      const successor = JSON.parse(JSON.stringify(current));
      mutate(successor);
      CoverageOwnership.preserveServerOwnedCoverageRuns(successor, current);
      fs.writeFileSync(file, JSON.stringify(successor, null, 2));
      return successor;
    },
    /* A ledger written directly, for the one thing a live submission cannot produce on
       demand: a child of THIS run whose recorded cost is honestly unknown. The shape is
       generation-job-store.js's — a bare array of job rows. */
    seedLedger: (rows) => fs.writeFileSync(path.join(dir, "generation-jobs.json"), JSON.stringify(rows, null, 2)),
    ledger: () => {
      const raw = path.join(dir, "generation-jobs.json");
      if (!fs.existsSync(raw)) return [];
      const parsed = JSON.parse(fs.readFileSync(raw, "utf8"));
      return Array.isArray(parsed) ? parsed : (parsed.jobs || []);
    },
    close: () => {
      appServer.close();
      mockServer.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/* A compiled frame package on SH-1, with one approved identity reference. */
function seedFramePackage(h, options = {}) {
  const project = h.project();
  const buildId = addFramePromptBuild(project, "SH-1", {
    frameId: "FR-A",
    spec: baseSpec({ shotId: "SH-1" }),
    references: [buildRef(REF_IDENTITY, KAI_PNG)],
    ...options,
  });
  h.saveProject(project);
  return buildId;
}

/* The body a compiled-frame dialog builds, minus the declaration — so each test can
   attach the declaration it is actually making a point about. */
function framePlanBody(buildId, extra = {}) {
  return {
    purpose: "frame",
    imagePlan: true,
    shotId: "SH-1",
    frameId: "FR-A",
    frameLabel: "A",
    sourceBuildId: buildId,
    prompt: "Kai sets the parcel down in the hangar.",
    aspectRatio: "16:9",
    ...extra,
  };
}

async function main() {
  /* =======================================================================
     1. THE DECLARATION IS REQUIRED.

     The reproduction the slice exists for. A body with no `generationRequest` is a body
     CineBraid cannot restrict — it does not know which controls the filmmaker was
     offered — and the route now says so instead of proceeding on a guess. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const undeclared = await h.post(framePlanBody(buildId));
      assert.strictEqual(undeclared.status, 400, `an undeclared paid request must be refused: ${JSON.stringify(undeclared.data)}`);
      assert.strictEqual(undeclared.data.code, "GENERATION_PLAN_REQUIRED", "the refusal must be typed");
      assert.strictEqual(undeclared.data.providerContacted, false, "and must assert that no provider was contacted");
      assert.strictEqual(h.calls.length, 0, "no provider call may be made");
      assert.strictEqual(h.ledger().length, 0, "and no durable job row may be created");

      const declared = await h.post(declaredGenerationBody(framePlanBody(buildId)));
      assert.strictEqual(declared.status, 200, `the same body WITH a declaration must be accepted: ${JSON.stringify(declared.data)}`);
      assert.strictEqual(h.calls.length, 1, "exactly one provider call");
      note("1. an undeclared paid request is refused with GENERATION_PLAN_REQUIRED, creates no row and contacts no provider; the identical body carrying a declaration is accepted");
    } finally { h.close(); }
  }

  /* =======================================================================
     2. A DECLARATION CANNOT PICK ITS OWN VOCABULARY.

     `motion-h3` owns no candidate count and `reference-automation` leaves resolution out
     of its vocabulary entirely. If a body could name whichever surface suited it, the
     declaration would be a way around the gate rather than the input to it. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const lying = await h.post({
        ...framePlanBody(buildId),
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert.strictEqual(lying.status, 400, `a surface the request cannot be must be refused: ${JSON.stringify(lying.data)}`);
      assert.strictEqual(lying.data.code, "GENERATION_PLAN_SURFACE_MISMATCH", "the refusal must be typed");
      assert.deepStrictEqual(lying.data.expectedSurfaces, ["compiled-frame"], "and must name what the request actually is");
      assert.strictEqual(h.calls.length, 0, "no provider call may be made");
      note("2. a compiled-frame request declaring itself `reference-automation` is refused with GENERATION_PLAN_SURFACE_MISMATCH; the legal set is named and no provider is contacted");
    } finally { h.close(); }
  }

  /* =======================================================================
     3. THE BROWSER-GATE BYPASS, CLOSED.

     `resolution` is an expert control: Simple does not render it, so Simple does not send
     it, and the route falls back to the size saved in Settings. A replayed POST that
     carries `resolution: "4k"` under a Simple declaration is asking the money boundary to
     honour a control the filmmaker was never shown — and it costs more.

     Asserted at the ADAPTER, not at the gate. What matters is the payload the provider
     received, and the mock is what received it. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      /* The SAME body twice, differing only in the declared view. Run in one harness so
         the two adapter payloads can be compared directly — an assertion that Simple
         "did not send 4K" is only worth anything beside proof that Advanced did. */
      const send = (viewMode) => h.post({
        ...framePlanBody(buildId, { resolution: "4k", clientRequestId: `view-${viewMode}` }),
        generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode }),
      });
      const simple = await send("simple");
      assert.strictEqual(simple.status, 200, `the request itself is legitimate and is accepted: ${JSON.stringify(simple.data)}`);
      const advanced = await send("advanced");
      assert.strictEqual(advanced.status, 200, `and so is the Advanced one: ${JSON.stringify(advanced.data)}`);
      assert.strictEqual(h.calls.length, 2, "two provider calls");

      /* fal's custom image_size is a {width, height} record, so the comparison is on the
         serialised pair rather than on a string that would compare equal as [object Object]. */
      const sizeOf = (call) => JSON.stringify(call.body.image_size);
      const simpleSize = sizeOf(h.calls[0]);
      const advancedSize = sizeOf(h.calls[1]);
      assert.notStrictEqual(simpleSize, advancedSize,
        `the two views must reach the adapter with DIFFERENT sizes, or the gate is doing nothing (both were ${simpleSize})`);
      const simpleRow = h.ledger().find((item) => item.clientRequestId === "view-simple");
      const advancedRow = h.ledger().find((item) => item.clientRequestId === "view-advanced");
      assert.deepStrictEqual(simpleRow.removedPayloadKeys, ["resolution"],
        "Simple must record WHICH key was removed rather than dropping it silently");
      assert.strictEqual(simpleRow.generationViewMode, "simple", "and the view it was removed under");

      /* AND IT LANDED ON THE SAVED DEFAULT, proved rather than assumed: a third request
         that carries no resolution at all must reach the adapter with the identical size.
         "It was not 4K" leaves open the possibility of a third value nobody chose. */
      await h.settle(simple.data.job.id);
      const bare = await h.post({
        ...framePlanBody(buildId, { clientRequestId: "view-bare" }),
        generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" }),
      });
      assert.strictEqual(bare.status, 200, `a Simple request carrying no size at all: ${JSON.stringify(bare.data)}`);
      assert.strictEqual(sizeOf(h.calls[2]), simpleSize,
        "the stripped request must land exactly where a request that never carried a size lands");
      note(`3. a replayed Simple request carrying resolution:"4k" is stripped at the money boundary — the adapter received ${JSON.stringify(simpleSize)} and the job records removedPayloadKeys ["resolution"] against the saved 1k default`);

      /* =====================================================================
         4. ADVANCED IS NOT OVER-STRIPPED. The same key, the same route, the same
         package — and under Advanced it travels, because Advanced renders it. A gate
         that removed it in both views would be enforcing a route preference rather than
         the filmmaker's view, and would be just as wrong. */
      assert.deepStrictEqual(advancedRow.removedPayloadKeys, [], "nothing may be removed under Advanced");
      /* The row records the size the PLAN settled on rather than the tier that was asked
         for — the compiled path resolves "4k" against GPT Image 2's ladder for this shot's
         aspect ratio, and recording the request instead of the dispatch is exactly the
         drift the accounting comment on this route warns about. So the assertion is that
         the recorded size is the one the adapter received. */
      assert.strictEqual(JSON.stringify({ width: Number(String(advancedRow.resolution).split("x")[0]), height: Number(String(advancedRow.resolution).split("x")[1]) }), advancedSize,
        "the size recorded on the job must be the size the adapter received");
      assert.notStrictEqual(advancedRow.resolution, simpleRow.resolution,
        "and it must differ from the one Simple landed on");
      note(`4. the identical body under an Advanced declaration keeps it — the adapter received ${JSON.stringify(advancedSize)} — so the gate removes what the VIEW hides, not what the route dislikes`);
    } finally { h.close(); }
  }

  /* =======================================================================
     5. UNSUPPORTED MACHINE SETTINGS NEVER TRAVEL, IN EITHER VIEW.

     Neither shipped image model declares a seed, so a seed is not an Advanced control
     that Simple is hiding — it is a control that does not exist. `restrictPayloadToPlan`
     has always removed those regardless of vocabulary, and this asserts that the server
     applies the same rule as the dialog. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      for (const viewMode of ["simple", "advanced"]) {
        const result = await h.post({
          ...framePlanBody(buildId, { seed: 4242, cfgScale: 7, steps: 40, clientRequestId: `seed-${viewMode}` }),
          generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode }),
        });
        assert.strictEqual(result.status, 200, `${viewMode}: ${JSON.stringify(result.data)}`);
        const row = h.ledger().find((item) => item.clientRequestId === `seed-${viewMode}`);
        for (const key of ["seed", "cfgScale", "steps"])
          assert(row.removedPayloadKeys.includes(key), `${viewMode}: ${key} must be removed as unsupported`);
      }
      for (const call of h.calls)
        for (const key of ["seed", "guidance_scale", "cfg_scale", "steps"])
          assert.strictEqual(call.body[key], undefined, `${key} must never reach the adapter`);
      note("5. seed, cfgScale and steps are removed in BOTH views — a control no model declares is not an Advanced control, and none of them reached the adapter");
    } finally { h.close(); }
  }

  /* =======================================================================
     6. THE FORMERLY UNDECLARED DISPATCHERS.

     Coverage automation and the automation runner posted bodies that had never been
     through a control plan at all — the browser gate did not run on them, so there was
     nothing for a server gate to reproduce. They declare now, and what they gain is the
     guarantee they never had: their route inputs are untouched and a machine setting the
     route cannot honour is removed. */
  {
    const h = await harness();
    try {
      const entityProject = h.project();
      /* Only the entity. The coverage ROUTE establishes the run record itself — that is
         the correction: the run is server-owned, so no fixture and no browser writes it. */
      entityProject.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
      h.saveProject(entityProject);
      const result = await h.coverage({
        purpose: "entity-reference",
        entityList: "characters",
        entityId: "KAI",
        entityType: "character",
        sourceBuildId: "coverage-fixture",
        prompt: "A four-panel angle sheet of Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1,
        quality: "high",
        /* The sheet resolution: a route input on this surface, not a tiered control. */
        resolution: "4k",
        aspectRatio: "16:9",
        coverageJobType: "sheet",
        coverageSheetType: "angles",
        /* And a machine setting nothing declares, which is what must not survive. */
        seed: 99,
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert.strictEqual(result.status, 200, `coverage automation must still dispatch: ${JSON.stringify(result.data)}`);
      const row = h.ledger()[0];
      assert.strictEqual(row.resolution, "4k",
        "the sheet resolution is a route input on this surface and must survive — stripping it would silently substitute the saved default");
      assert.deepStrictEqual(row.removedPayloadKeys, ["seed"],
        "and the machine setting nothing declares must be the only thing removed");
      assert.strictEqual(row.generationSurface, "reference-automation", "the surface is recorded");
      note("6. the coverage dispatcher now declares `reference-automation`: its 4K sheet resolution survives as a route input and the undeclarable seed is stripped — a guarantee that path never had");
    } finally { h.close(); }
  }

  /* =======================================================================
     7. THE MODEL THE SCREEN NAMED.

     The compiled still path compiles for one model id and always has. A picker that
     offered another and dispatched this one would be a screen telling a filmmaker
     something untrue about what they were buying. The route does not silently substitute
     and it does not silently proceed: it refuses. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const wrong = await h.post({
        ...framePlanBody(buildId),
        generationRequest: Presentation.generationRequestDeclaration({
          surface: "compiled-frame", viewMode: "advanced",
          /* A REAL CATALOGUED OPTION this route cannot dispatch — seedream/5.0-pro is in
             the shipped catalogue and runware offers it. A made-up id would be refused
             one step earlier, as an identity CineBraid could not have minted, and this
             case is about the ROUTE rather than about the identity. */
          selectedOptionId: "seedream/5.0-pro::runware::t2i", selectedModelId: "seedream/5.0-pro",
        }),
      });
      assert.strictEqual(wrong.status, 409, `a model this route cannot dispatch must be refused: ${JSON.stringify(wrong.data)}`);
      assert.strictEqual(wrong.data.code, "GENERATION_MODEL_MISMATCH", "the refusal must be typed");
      assert.strictEqual(wrong.data.dispatchModelId, IMAGE_MODEL_ID, "and must name what this route would actually dispatch");
      assert.strictEqual(h.calls.length, 0, "no provider call may be made");

      const right = await h.post({
        ...framePlanBody(buildId, { clientRequestId: "right-model" }),
        generationRequest: Presentation.generationRequestDeclaration({
          surface: "compiled-frame", viewMode: "advanced",
          selectedOptionId: `${IMAGE_MODEL_ID}::fal-queue::t2i`, selectedModelId: IMAGE_MODEL_ID,
        }),
      });
      assert.strictEqual(right.status, 200, `the model this route does dispatch must be accepted: ${JSON.stringify(right.data)}`);
      const row = h.ledger()[0];
      assert.strictEqual(row.selectedModelId, IMAGE_MODEL_ID, "and the job records the model the screen named");
      assert.strictEqual(row.selectedOptionId, `${IMAGE_MODEL_ID}::fal-queue::t2i`, "and the option id it was selected as");

      /* THE LEGACY FALLBACK, TESTED HONESTLY. A request that names no model is not
         refused — the route's configured model is a well-defined truthful answer — and
         the ledger records an empty selection rather than claiming one. */
      const silent = await h.post(declaredGenerationBody(framePlanBody(buildId, { clientRequestId: "no-model-named" })));
      assert.strictEqual(silent.status, 200, `a request naming no model is not refused: ${JSON.stringify(silent.data)}`);
      const silentRow = h.ledger().find((item) => item.clientRequestId === "no-model-named");
      assert.strictEqual(silentRow.selectedModelId, "", "and it claims no selection rather than inventing one");
      note(`7. a request naming a catalogued model this route cannot dispatch is refused with GENERATION_MODEL_MISMATCH naming ${IMAGE_MODEL_ID}; naming the right one is accepted and recorded; naming none is accepted and records nothing`);
    } finally { h.close(); }
  }

  /* =======================================================================
     8. STALE REPLAY, REFUSED SERVER-SIDE.

     public/fal-generation.js refuses an out-of-date package in three places and all three
     are browser code. This is the same refusal at the boundary, from the same comparator
     — public/shared-build-history.js's packageDependencyDrift(), which the browser also
     calls — over the evidence a Node process can read out of the project document.

     The sequence is the audit's: compile V1, let the shot move on, replay V1. */
  {
    const h = await harness();
    try {
      const project = h.project();
      const buildId = addFramePromptBuild(project, "SH-1", {
        frameId: "FR-A",
        spec: baseSpec({ shotId: "SH-1" }),
        references: [buildRef(REF_IDENTITY, KAI_PNG)],
      });
      /* The snapshot a guided build records when it is compiled. Written through the same
         shared reader the browser writes it with, so this is V1 as the app would store it. */
      const shot = project.shots[0];
      const pack = project.promptBuildsById[buildId];
      pack.dependencySnapshot = {
        ...BuildHistory.packageProjectInputs(project, shot, pack, BuildHistory.packageDirection(shot, pack)),
        references: [],
      };
      h.saveProject(project);

      const fresh = await h.post(declaredGenerationBody(framePlanBody(buildId, { clientRequestId: "v1-fresh" })));
      assert.strictEqual(fresh.status, 200, `a current package dispatches: ${JSON.stringify(fresh.data)}`);
      assert.strictEqual(h.calls.length, 1, "one provider call");

      /* THE SHOT MOVES ON. An approved frame is chosen — a change the compiled prompt
         cannot know about, and exactly the kind the browser gate already refuses. */
      const moved = h.project();
      moved.shots[0].frames[0].winner = "A.png";
      h.saveProject(moved);

      const stale = await h.post(declaredGenerationBody(framePlanBody(buildId, { clientRequestId: "v1-replay" })));
      assert.strictEqual(stale.status, 409, `the stale replay must be refused: ${JSON.stringify(stale.data)}`);
      assert.strictEqual(stale.data.code, "GENERATION_PACKAGE_STALE", "the refusal must be typed");
      assert(stale.data.reasons.includes("approved frame changed"),
        `and must name the drift in the comparator's own words: ${JSON.stringify(stale.data.reasons)}`);
      assert.strictEqual(stale.data.evidence, "project-document",
        "and must say what evidence it looked at, so a partial verdict is not read as the whole one");
      assert.strictEqual(h.calls.length, 1, "no second provider call");

      /* REBUILT TO V2 — the same package with its snapshot recompiled — is accepted. */
      const rebuilt = h.project();
      const rebuiltShot = rebuilt.shots[0];
      const rebuiltPack = rebuilt.promptBuildsById[buildId];
      rebuiltPack.dependencySnapshot = {
        ...BuildHistory.packageProjectInputs(rebuilt, rebuiltShot, rebuiltPack, BuildHistory.packageDirection(rebuiltShot, rebuiltPack)),
        references: [],
      };
      h.saveProject(rebuilt);
      const v2 = await h.post(declaredGenerationBody(framePlanBody(buildId, { clientRequestId: "v2" })));
      assert.strictEqual(v2.status, 200, `the rebuilt package must be accepted: ${JSON.stringify(v2.data)}`);
      assert.strictEqual(h.calls.length, 2, "and reaches the provider");
      note("8. a package whose shot has moved on is refused at the money boundary with GENERATION_PACKAGE_STALE naming \"approved frame changed\" and its evidence scope; rebuilding the snapshot makes the same request dispatch");
    } finally { h.close(); }
  }

  /* =======================================================================
     9. A PACKAGE THAT RECORDED NOTHING IS NOT REFUSED.

     The other half of the freshness rule, and the one that is easy to get wrong. Every
     blocking package and every package compiled before dependency capture carries no
     snapshot. Refusing those would block real work on evidence nobody has. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const project = h.project();
      assert.strictEqual(project.promptBuildsById[buildId].dependencySnapshot, undefined,
        "the fixture must genuinely carry no snapshot, or this asserts nothing");
      const result = await h.post(declaredGenerationBody(framePlanBody(buildId)));
      assert.strictEqual(result.status, 200, `a package with no recorded snapshot must dispatch: ${JSON.stringify(result.data)}`);
      note("9. a package that recorded no dependency snapshot is dispatched, not refused — an absence of evidence is not evidence of staleness");
    } finally { h.close(); }
  }

  /* =======================================================================
     10. THE AUTHORISED SPEND.

     One press authorises a bounded run. Until now the boundary understood only the image
     count; the dollar ceiling the planner quoted was enforced nowhere. Here the run is
     authorised for $0.12 — two images at the configured $0.06 — and the third request is
     refused for spend while still inside the image cap. */
  {
    const h = await harness({ ratePerImage: 0.06 });
    try {
      const buildId = seedFramePackage(h);
      const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      h.saveRuns([{
        id: "run-1", schemaVersion: 2, revision: 1, status: "running",
        runnerId: "runner-1", leaseExpiresAt: lease,
        /* A count cap of FOUR and a spend cap of $0.12. The two disagree on purpose:
           without the spend cap the fourth image would be authorised. */
        config: { maxImages: 4, outputsPerRequest: 1, maxSpend: { priced: true, amount: 0.12, quantity: 2, unitBasis: "image", ratePerUnit: 0.06 } },
        usage: { imagesGenerated: 0 },
        steps: {}, logs: [],
      }]);
      /* The body the runner actually sends: the legacy fixed-image shape, with the run's
         own stored generation settings and no compiled-plan marker. */
      const runBody = (step) => ({
        purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
        sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
        aspectRatio: "16:9", outputCount: 1, quality: "high", resolution: "1k",
        clientRequestId: step,
        automationRunId: "run-1", automationStepKey: step, automationRunnerId: "runner-1",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
      });
      const first = await h.post(runBody("step-1"));
      assert.strictEqual(first.status, 200, `inside both caps: ${JSON.stringify(first.data)}`);
      const second = await h.post(runBody("step-2"));
      assert.strictEqual(second.status, 200, `still inside both caps: ${JSON.stringify(second.data)}`);
      assert.strictEqual(h.calls.length, 2, "two provider calls so far");
      /* Retired so the concurrency cap is not what refuses the third. A cancelled job
         still counts toward the run's spend — it was submitted and may have been
         charged — which is exactly the population summarizeRecordedCost() reports. */
      await h.settle(first.data.job.id);
      await h.settle(second.data.job.id);
      /* No repeated confirmation was required for either — the run authorised them. */
      const third = await h.post(runBody("step-3"));
      assert.strictEqual(third.status, 409, `over the authorised spend, inside the image cap: ${JSON.stringify(third.data)}`);
      assert.strictEqual(third.data.code, "AUTOMATION_SPEND_CAP", "the refusal must be typed");
      assert(/\$0\.12/.test(String(third.data.error)), `and must name what was authorised: ${third.data.error}`);
      assert.strictEqual(h.calls.length, 2, "and no third provider call");
      note("10. a run authorised for $0.12 dispatches two child jobs with no repeated confirmation and refuses the third with AUTOMATION_SPEND_CAP — while still inside its four-image count cap");
    } finally { h.close(); }
  }

  /* =======================================================================
     11. AN UNPRICED RUN KEEPS ITS COUNT CAP.

     A run authorised when no rate was configured has no dollar ceiling to enforce, and
     inventing one the filmmaker was never quoted would be worse than having none. The
     image cap still stands. */
  {
    const h = await harness({ ratePerImage: 0 });
    try {
      const buildId = seedFramePackage(h);
      const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      h.saveRuns([{
        id: "run-2", schemaVersion: 2, revision: 1, status: "running",
        runnerId: "runner-2", leaseExpiresAt: lease,
        config: { maxImages: 1, outputsPerRequest: 1, maxSpend: { priced: false, amount: null, quantity: 1, unpricedReason: "no-configured-rate" } },
        usage: { imagesGenerated: 0 },
        steps: {}, logs: [],
      }]);
      const runBody = (step) => ({
        purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
        sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
        aspectRatio: "16:9", outputCount: 1, quality: "high", resolution: "1k",
        clientRequestId: step,
        automationRunId: "run-2", automationStepKey: step, automationRunnerId: "runner-2",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
      });
      const inside = await h.post(runBody("s1"));
      assert.strictEqual(inside.status, 200, `the first is inside the cap: ${JSON.stringify(inside.data)}`);
      await h.settle(inside.data.job.id);
      const over = await h.post(runBody("s2"));
      assert.strictEqual(over.status, 409, `the second exceeds the image cap: ${JSON.stringify(over.data)}`);
      assert(/1-image cap/.test(String(over.data.error)), `and is refused for the count: ${over.data.error}`);
      note("11. an unpriced run enforces its image cap and claims no dollar ceiling — the absence of a rate removes the spend guard, not the count guard");
    } finally { h.close(); }
  }

  /* =======================================================================
     12. THE PLAN IS BUILT FROM THE SAME TABLE ON BOTH SIDES.

     Not a route test: a statement about where the vocabulary lives. If a dialog's `only`
     list and the boundary's could ever differ, everything above would be testing two
     implementations that happen to agree today. */
  {
    for (const [surface, row] of Object.entries(Presentation.CINEBRAID_GENERATION_REQUEST_SURFACES)) {
      assert(Array.isArray(row.only) && row.only.length, `${surface} must declare a control vocabulary`);
      for (const key of row.only)
        assert(Presentation.CINEBRAID_GENERATION_CONTROLS.some((control) => control.key === key),
          `${surface} declares ${key}, which is not a control`);
    }
    const simple = Presentation.generationRequestPlan({ surface: "fixed-image", mode: "simple" });
    const advanced = Presentation.generationRequestPlan({ surface: "fixed-image", mode: "advanced" });
    assert(!simple.rendered.includes("resolution"), "Simple must not render an expert control");
    assert(advanced.rendered.includes("resolution"), "Advanced must");
    assert.strictEqual(Presentation.generationRequestPlan({ surface: "no-such-surface", mode: "simple" }), null,
      "an unknown surface must yield NO plan rather than a permissive one");
    assert.strictEqual(Presentation.generationRequestPlan({ surface: "compiled-frame", mode: "simple" }), null,
      "and a known surface with no capability to judge by must fail closed too");
    note("12. every surface's vocabulary is a subset of the one control table, an unknown surface yields no plan rather than a permissive one, and a known surface with no capability fails closed");
  }

  /* =======================================================================
     13. THE CAPABILITY THE GATE USES IS THE ROUTE'S OWN.

     imageControlCapability() exists so the boundary can restrict a payload BEFORE
     compiling — compilation consumes the very keys the restriction decides about. It must
     be the same answer the compiler resolves, not a lookalike. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const capability = imageControlCapability({ project: h.project(), purpose: "frame", shotId: "SH-1", buildId });
      assert(Array.isArray(capability.resolutions) && capability.resolutions.length,
        "the route must report real sizes, or Simple/Advanced is deciding about nothing");
      assert(Array.isArray(capability.qualityTiers) && capability.qualityTiers.length, "and real quality tiers");
      assert.strictEqual(capability.flags.seed, false, "and GPT Image 2's documented absence of a seed");
      note(`13. the gate's capability comes from the route's own resolver — ${capability.resolutions.length} sizes, ${capability.qualityTiers.length} quality tiers, seed false`);
    } finally { h.close(); }
  }

  /* =======================================================================
     14. THE COVERAGE RECORD, END TO END.

     plan.coverage has been computed since C1 and has travelled on the wire from both
     plan preview routes since C2b. It had no reader: a filmmaker pressing a paid button
     could see the compiled prompt and could NOT see which of their decisions were in it.

     This drives the real preview route on a real package and renders the real response
     through the shipped renderer. Nothing is re-derived on the way: the states, the
     reasons and the labels are all the compiler's. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const preview = await fetch(`${h.appOrigin}/api/generation/fal/image/plan`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "frame", shotId: "SH-1", sourceBuildId: buildId }),
      });
      const plan = await preview.json();
      assert.strictEqual(preview.status, 200, `the plan preview must compile: ${JSON.stringify(plan)}`);
      const coverage = plan.coverage || [];
      assert(coverage.length > 0, "the compiled plan must carry a coverage record");

      /* THE LABEL IS THE COMPILER'S. Every entry names a filmmaker-facing field, joined
         from generation-compiler.js's INTENT_FIELDS rather than prettified from the key. */
      for (const entry of coverage) {
        assert(entry.label && entry.label !== entry.intent || entry.intent === entry.label,
          `every coverage entry must carry a label: ${JSON.stringify(entry)}`);
        assert(["represented", "anchored", "omitted-by-design", "unsupported"].includes(entry.state),
          `and a state from the compiler's own vocabulary: ${JSON.stringify(entry)}`);
      }
      /* The compiler's own answers, not the ones a reader might expect. A camera move on
         a STILL frame is `omitted-by-design` with a reason — CineBraid left it out because
         it belongs to the motion pass — and not `unsupported`, which would claim the model
         refused something. The distinction is the compiler's and this reports it. */
      const camera = coverage.find((entry) => entry.intent === "camera.movement");
      assert(camera, "a fully directed shot carries a camera move");
      assert.strictEqual(camera.label, "camera movement", "and the dialog reads the compiler's word for it");
      assert.strictEqual(camera.state, "omitted-by-design",
        "a still frame holds one instant, and the compiler says so as a decision rather than a refusal");
      assert(/motion/i.test(String(camera.reason)), `and gives its reason: ${JSON.stringify(camera.reason)}`);
      const identity = coverage.find((entry) => entry.intent === "identity.canon");
      assert.strictEqual(identity.state, "anchored",
        "and Kai's identity is carried by the approved reference rather than restated in words");
      assert(/Kai/.test(String(identity.via)), `naming which one: ${JSON.stringify(identity.via)}`);

      /* AND THE SHIPPED RENDERER SHOWS IT. public/generation-view.js is browser-lexical,
         so it is evaluated here with the small set of helpers it actually uses — the
         alternative is asserting against a copy of the markup, which proves nothing. */
      const context = {
        window: {},
        localStorage: { getItem: () => null, setItem: () => {} },
        esc: (value) => String(value == null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
        attr: (value) => String(value == null ? "" : value).replace(/"/g, "&quot;"),
        ...Presentation,
      };
      vm.createContext(context);
      vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "generation-view.js"), "utf8"), context, { filename: "public/generation-view.js" });

      /* SIMPLE IS CONCISE ABOUT A LONG RECORD AND NEVER SILENT ABOUT ONE. This shot's
         plan carries around thirty entries and roughly half are deliberate omissions —
         a still has no duration and carries no sound. Listing them in front of a paid
         button is the wall the one row that matters would hide in. */
      const simpleMarkup = context.generationCoverageMarkup(coverage, "simple");
      assert(/data-coverage-summary="clear"/.test(simpleMarkup),
        `nothing in this request was refused by the model, and Simple says so plainly: ${simpleMarkup}`);
      assert.strictEqual((simpleMarkup.match(/data-coverage-state=/g) || []).length, 0,
        "with no row to raise, Simple lists none");
      assert(/left out on purpose/.test(simpleMarkup) && /carried into this request/.test(simpleMarkup),
        `but it still accounts for every entry by count: ${simpleMarkup}`);

      /* AND IT DOES RAISE THE ONE STATE THAT COSTS MONEY TO DISCOVER LATE. */
      const refused = [...coverage, { intent: "reproducibility.seed", label: "seed", state: "unsupported", reason: "This model does not accept a seed." }];
      const raised = context.generationCoverageMarkup(refused, "simple");
      assert(/data-coverage-summary="unsupported"/.test(raised), `an unsupported intent changes the summary: ${raised}`);
      assert(/not supported by this model/.test(raised), "in words a filmmaker reads");
      assert.strictEqual((raised.match(/data-coverage-state=/g) || []).length, 1,
        "and Simple raises exactly the one row, not the other thirty-three");

      /* ADVANCED IS THE WHOLE RECORD, unfiltered. */
      const advancedMarkup = context.generationCoverageMarkup(refused, "advanced");
      const rendered = (advancedMarkup.match(/data-coverage-state=/g) || []).length;
      assert.strictEqual(rendered, refused.length,
        `Advanced must render every entry the compiler emitted — ${rendered} of ${refused.length}`);
      assert(/anchored by a reference/.test(advancedMarkup),
        "including the answer to \"why is Kai not described in here\"");

      /* THE ORDER IS THE COMPILER'S, IN BOTH VIEWS.
       *
       * plan.coverage is emitted in the compiler's own inventory order. A renderer that
       * regroups it by state is quietly asserting a different sequence is the true one,
       * and a filmmaker comparing this panel against the plan or a support bundle would
       * see two different documents.
       *
       * Asserted against the LIVE plan's order, never against a copy of INTENT_FIELDS:
       * a hard-coded expected list in a test is a second declaration of the intent order
       * and would go on passing after the compiler changed its own. */
      const labelsOf = (markup) => [...markup.matchAll(/<li data-coverage-state="[^"]*"><span>([^<]*)<\/span>/g)].map((m) => m[1]);
      assert.deepStrictEqual(labelsOf(advancedMarkup), refused.map((entry) => entry.label),
        "Advanced must render the compiler's rows in the compiler's own order");

      /* And Simple's surviving rows keep their relative order too — proved on a record
         carrying more than one refusal, since one row can be in any order. */
      const twoRefused = [
        ...coverage.slice(0, 3),
        { intent: "reproducibility.seed", label: "seed", state: "unsupported", reason: "No seed." },
        ...coverage.slice(3, 6),
        { intent: "output.upscale", label: "upscale", state: "unsupported", reason: "No upscale." },
        ...coverage.slice(6),
      ];
      const simpleTwo = context.generationCoverageMarkup(twoRefused, "simple");
      assert.deepStrictEqual(labelsOf(simpleTwo), ["seed", "upscale"],
        "Simple keeps its surviving rows in the order the compiler emitted them");
      const omitted = coverage.filter((entry) => entry.state === "omitted-by-design").length;
      note(`14. the compiled plan's ${coverage.length}-entry coverage record reaches the browser labelled in the compiler's own words; Simple raises only what the model refused and accounts for the other ${omitted} omissions by count, and Advanced renders all ${refused.length}`);
    } finally { h.close(); }
  }

  /* =======================================================================
     15. A SURFACE IS PROVED BY STATE THE REQUEST CANNOT CARRY.  [reviewer blocker 1]

     `reference-automation` leaves resolution out of its vocabulary — a coverage sheet's
     size is a route input, not a control a view hides — which makes it the MORE permissive
     surface for that one key. Two independent reviewers in a row got past a guard on it,
     and both were right about why: a declared surface name and then a declared
     `coverageJobType` are both just fields in the body being judged.

     The corroboration is `entity.coverageAutomation`, the durable coverage-run record the
     coverage dispatcher writes into the project document before it dispatches and this
     route already reads when it reports failures. A request cannot put it in its own body.

     THE HONEST LIMIT, stated because overclaiming it would be worse than the original
     defect: this is same-origin single-user software with no per-route authentication, so
     a client that can write the project document can create the record. What this stops is
     the thing the reviewers actually did — gaining a more permissive paid surface by adding
     fields to the generation request — and it makes the alternative a persisted, auditable
     act that shows on the entity's coverage board rather than a string in one POST. */
  {
    const h = await harness();
    try {
      const entityBody = (extra) => ({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey, three-quarter view.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9", ...extra,
      });
      const character = (coverageAutomation) => {
        const project = h.project();
        project.characters = [{
          id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [],
          ...(coverageAutomation ? { coverageAutomation } : {}),
        }];
        h.saveProject(project);
      };
      const LIVE_RUN = { id: "coverage:characters:KAI:run:angles", list: "characters", entityId: "KAI", mode: "sheet", sheetType: "angles", status: "starting", startedAt: "2026-08-27T00:00:00.000Z", jobs: [], requestCount: 1, maximumImages: 1 };

      /* A. THE PUBLIC ROUTE CANNOT GRANT THE PRIVILEGED SURFACE AT ALL.
       *
       * Not "cannot prove it" — cannot request it. `trusted` is an argument of
       * legalRequestSurfaces(), supplied by the coverage operation and by nothing else,
       * so there is no body field, header or project value that reaches it. */
      character(null);
      const forged = await h.post(entityBody({
        clientRequestId: "forged",
        coverageJobType: "sheet", coverageSheetType: "angles",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      }));
      assert.strictEqual(forged.status, 400, `copying every client field must not buy the surface: ${JSON.stringify(forged.data)}`);
      assert.strictEqual(forged.data.code, "GENERATION_PLAN_SURFACE_MISMATCH", "the refusal must be typed");
      assert.deepStrictEqual(forged.data.expectedSurfaces, ["fixed-image"],
        "and the only surface a public request can have");
      assert.strictEqual(h.calls.length, 0, "no provider call may be made");
      assert.strictEqual(h.ledger().length, 0, "and no durable row is created");

      /* B. AND NOT EVEN WITH A GENUINE LIVE RUN IN THE DOCUMENT.
       *
       * This is the correction the second hold missed. Under the previous candidate a
       * real run was sufficient — so anything that could write one could promote itself.
       * The run is necessary now and is not sufficient: the public route has no trusted
       * context whatever the project says. */
      character(LIVE_RUN);
      const withRealRun = await h.post(entityBody({
        clientRequestId: "with-real-run",
        coverageJobType: "sheet", coverageSheetType: "angles",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      }));
      assert.strictEqual(withRealRun.status, 400,
        `a public request cannot claim the surface even beside a real live run: ${JSON.stringify(withRealRun.data)}`);
      assert.deepStrictEqual(withRealRun.data.expectedSurfaces, ["fixed-image"], "the public route offers one surface here");
      assert.strictEqual(h.calls.length, 0, "still no provider call");

      /* C-F. WHAT A GENERIC PROJECT SAVE MAY SAY ABOUT A COVERAGE RUN: nothing.
       *
       * The previous candidate left one direction open — a run the browser could see
       * could be moved to a TERMINAL state, on the reasoning that terminating removes
       * privilege. An independent reviewer wrote `id: OLD, status: completed,
       * completedAt: <stale>` against the CURRENT ETag and the authoritative run took the
       * status and the stale timestamp while keeping the server's identity. Removing
       * privilege is still writing lifecycle. There is no field list now: the stored run
       * wins wholesale, and each case below is asserted BYTE-EQUIVALENT rather than
       * field by field, because a field-by-field assertion is how the last exception
       * survived review. */
      const RUN_JSON = JSON.stringify(LIVE_RUN);

      /* C. The reviewer's exact reproduction: a stale OLD/completed over a live NEW. */
      character(LIVE_RUN);
      h.genericSave((project) => {
        project.characters[0].coverageAutomation = {
          id: "OLD", list: "characters", entityId: "KAI", status: "completed",
          completedAt: "2020-01-01T00:00:00.000Z", jobs: ["ghost"],
        };
      });
      assert.strictEqual(JSON.stringify(h.project().characters[0].coverageAutomation), RUN_JSON,
        "a stale OLD/completed save must leave the authoritative live run byte-equivalent");

      /* D. AND A MATCHING ID GRANTS NO LIFECYCLE AUTHORITY EITHER. */
      character(LIVE_RUN);
      h.genericSave((project) => {
        project.characters[0].coverageAutomation = { ...LIVE_RUN, status: "completed", completedAt: "2020-01-01T00:00:00.000Z" };
      });
      assert.strictEqual(JSON.stringify(h.project().characters[0].coverageAutomation), RUN_JSON,
        "knowing the run's id does not make a generic save its lifecycle writer");

      /* E. NOR MAY IT AUTHOR ONE WHERE THE SERVER RECORDED NONE. */
      character(null);
      h.genericSave((project) => {
        project.characters[0].coverageAutomation = {
          id: "fabricated", list: "characters", entityId: "KAI", mode: "sheet",
          sheetType: "angles", status: "starting", startedAt: "2026-08-27T00:00:00.000Z", jobs: [],
        };
      });
      assert.strictEqual(h.project().characters[0].coverageAutomation, undefined,
        "a generic save must not be able to author a coverage run where the server recorded none");

      /* F. NOR RESURRECT A FINISHED ONE, NOR HIJACK ITS IDENTITY. */
      const DONE = { ...LIVE_RUN, status: "completed", completedAt: "2026-08-27T09:00:00.000Z" };
      character(DONE);
      h.genericSave((project) => {
        project.characters[0].coverageAutomation = {
          id: "hijacked", list: "props", entityId: "SOMEONE-ELSE", status: "starting", jobs: ["fake"],
        };
      });
      assert.strictEqual(JSON.stringify(h.project().characters[0].coverageAutomation), JSON.stringify(DONE),
        "a finished run survives a resurrection attempt byte-equivalent");

      /* G. AND A SAVE THAT SAYS NOTHING ABOUT THE RUN DOES NOT ERASE IT, while the
            filmmaker's own edit in the same save persists normally. */
      character(LIVE_RUN);
      h.genericSave((project) => { delete project.characters[0].coverageAutomation; project.characters[0].name = "Kai (renamed)"; });
      const survived = h.project().characters[0];
      assert.strictEqual(JSON.stringify(survived.coverageAutomation), RUN_JSON, "the legitimate run survives an ordinary save");
      assert.strictEqual(survived.name, "Kai (renamed)", "and the filmmaker's own edit is saved");

      /* E. THE ORDINARY REQUEST ON ITS OWN SURFACE, accepted — 4K stripped, because on
            `fixed-image` under Simple that is exactly a control the view did not render. */
      character(null);
      const honest = await h.post(entityBody({
        clientRequestId: "honest",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "fixed-image", viewMode: "simple" }),
      }));
      assert.strictEqual(honest.status, 200, `the same request on its own surface is accepted: ${JSON.stringify(honest.data)}`);
      const honestRow = h.ledger().find((row) => row.clientRequestId === "honest");
      assert.deepStrictEqual(honestRow.removedPayloadKeys, ["resolution"], "and Simple strips the size it never offered");
      await h.settle(honest.data.job.id);

      /* G. THE SERVER'S OWN COVERAGE OPERATION. It establishes the run and dispatches
            through the same boundary with its own context — no fixture writes the run. */
      character(null);
      const coverage = await h.coverage(entityBody({
        clientRequestId: "coverage",
        coverageJobType: "sheet", coverageSheetType: "angles",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      }));
      assert.strictEqual(coverage.status, 200, `the coverage operation must dispatch: ${JSON.stringify(coverage.data)}`);
      const coverageRow = h.ledger().find((row) => row.clientRequestId === "coverage");
      assert.strictEqual(coverageRow.resolution, "4k", "and keep the sheet resolution its panels depend on");
      assert.deepStrictEqual(coverageRow.removedPayloadKeys, [], "with nothing stripped");
      assert.strictEqual(coverageRow.generationSurface, "reference-automation", "and record the surface the server selected");
      const established = h.project().characters[0].coverageAutomation;
      assert(established && established.status === "sheet-running",
        `and the server must have established the run itself: ${JSON.stringify(established)}`);
      assert(String(established.id).startsWith("coverage:characters:KAI:"), "with an id it minted");

      /* H. THE COVERAGE ROUTE IS NOT A BYPASS. It refuses work that is not coverage work,
            so it cannot be used to launder an ordinary request into the surface. */
      const notCoverage = await h.coverage(entityBody({ clientRequestId: "not-coverage" }));
      assert.strictEqual(notCoverage.status, 400, `the coverage route needs a coverage job type: ${JSON.stringify(notCoverage.data)}`);
      assert.strictEqual(notCoverage.data.code, "COVERAGE_JOB_TYPE_REQUIRED", "typed as such");
      note("15. a public request cannot obtain `reference-automation` even carrying every coverage marker AND beside a genuine live run — the surface is the server operation's, not the body's; and a generic project save leaves the authoritative run BYTE-EQUIVALENT through a stale OLD/completed write, a same-id terminalization, a fabrication, a resurrection and an omission, while the filmmaker's own edit in the same save persists");
    } finally { h.close(); }
  }

  /* =======================================================================
     15b. A REFUSED COVERAGE REQUEST LEAVES NO LIVE RUN.

     The coverage route used to establish its run and THEN enter the shared boundary. An
     independent reviewer sent a valid coverage request with no generation plan: the
     boundary answered 400 GENERATION_PLAN_REQUIRED, no provider was called, no ledger row
     was written — and `sheet-running` was left on the entity with no jobs. A machine-owned
     claim that work was under way that never began.

     The run is established at the DISPATCH-COMMIT point now: after every pre-submission
     refusal has passed, immediately before the durable job row and the adapter. This walks
     the refusal gates that sit above that point and requires the same thing of each one —
     no provider call, and no live run left behind. */
  {
    const h = await harness();
    try {
      const project = h.project();
      project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
      h.saveProject(project);
      const coverageBody = (extra) => ({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "angles",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        ...extra,
      });
      const runOf = () => h.project().characters[0].coverageAutomation;

      /* THE REVIEWER'S REPRODUCTION, first and by name. */
      const noPlan = await h.coverage({ ...coverageBody({ clientRequestId: "no-plan" }), generationRequest: undefined });
      assert.strictEqual(noPlan.status, 400, `a coverage request with no plan is refused: ${JSON.stringify(noPlan.data)}`);
      assert.strictEqual(noPlan.data.code, "GENERATION_PLAN_REQUIRED", "by the shared boundary, for the shared reason");
      assert.strictEqual(h.calls.length, 0, "no provider call");
      assert.strictEqual(h.ledger().length, 0, "no ledger row");
      assert.strictEqual(runOf(), undefined,
        `and NO LIVE RUN — this is the defect: ${JSON.stringify(runOf())}`);

      /* THE REST OF THE GATES THAT SIT ABOVE THE DISPATCH-COMMIT POINT. Each is reached
         with a request that is otherwise a valid coverage operation, and each must leave
         the same nothing behind. */
      const REFUSALS = [
        ["a mismatched declared surface", { clientRequestId: "bad-surface", generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" }) }, "GENERATION_PLAN_SURFACE_MISMATCH"],
        ["an impossible option identity", { clientRequestId: "bad-option", generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple", selectedOptionId: `${IMAGE_MODEL_ID}::not-a-real-surface::not-a-real-mode`, selectedModelId: IMAGE_MODEL_ID }) }, "GENERATION_OPTION_IDENTITY_INVALID"],
        ["a model this route cannot dispatch", { clientRequestId: "bad-model", generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple", selectedOptionId: "seedream/5.0-pro::runware::t2i", selectedModelId: "seedream/5.0-pro" }) }, "GENERATION_MODEL_MISMATCH"],
        /* Capability/preparation: the entity-reference branch requires the approved parent
           as an editable base for a derived state, and refuses without it. */
        ["a preparation refusal", { clientRequestId: "bad-prep", derivationMode: "derive", continuityStateId: "" }, undefined],
        ["a request with no prompt", { clientRequestId: "no-prompt", prompt: "" }, undefined],
        ["an entity that does not exist", { clientRequestId: "no-entity", entityId: "GHOST" }, "COVERAGE_ENTITY_MISSING"],
      ];
      for (const [what, extra, code] of REFUSALS) {
        const before = h.calls.length;
        const result = await h.coverage(coverageBody(extra));
        assert.notStrictEqual(result.status, 200, `${what} must be refused: ${JSON.stringify(result.data)}`);
        if (code) assert.strictEqual(result.data.code, code, `${what}: typed`);
        assert.strictEqual(h.calls.length, before, `${what}: no provider call`);
        assert.strictEqual(runOf(), undefined, `${what}: NO LIVE RUN may be left behind — found ${JSON.stringify(runOf())}`);
      }

      /* CONCURRENCY, which sits above the commit point too. Two live jobs fill the cap,
         and the third coverage request is refused with nothing recorded. */
      /* Distinct slots, so the entity-reference duplicate guard — which correctly reuses
         an in-flight request for the SAME coverage target — does not answer instead of
         the cap this is about. */
      const slotBody = (n) => coverageBody({ clientRequestId: `cap-${n}`, coverageJobType: "slot", targetCoverageSlotId: `slot-${n}` });
      const first = await h.coverage(slotBody(1));
      assert.strictEqual(first.status, 200, `the first coverage request dispatches: ${JSON.stringify(first.data)}`);
      const runAfterFirst = runOf();
      assert(runAfterFirst && runAfterFirst.status === "individual-running", `and NOW the run is live: ${JSON.stringify(runAfterFirst)}`);
      assert.deepStrictEqual(runAfterFirst.jobs, [first.data.job.id],
        "carrying the job it was established for, in the same durable turn");
      const second = await h.coverage(slotBody(2));
      assert.strictEqual(second.status, 200, `and the second: ${JSON.stringify(second.data)}`);
      const capped = await h.coverage(slotBody(3));
      assert.strictEqual(capped.status, 409, `the third exceeds the concurrency cap: ${JSON.stringify(capped.data)}`);
      assert.strictEqual(h.calls.length, 2, "and reaches no provider");
      assert.deepStrictEqual(runOf().jobs, [first.data.job.id, second.data.job.id],
        "and adds nothing to the run it was refused from");
      note(`15b. a coverage request refused for a missing plan leaves no run, no row and no provider call — and so does every other pre-submit gate above the dispatch-commit point (${REFUSALS.length + 1} of them plus the concurrency cap); the run becomes live only with the job it was established for`);
    } finally { h.close(); }
  }

  /* =======================================================================
     15c. A COVERAGE RUN THAT REACHES THE ADAPTER AND FAILS IS NOT LEFT LIVE.

     The dispatch-commit point opens exactly one window: the run is true and the provider
     has not answered yet. Every failure after it must transition the run truthfully
     through the lifecycle owner that already writes those states. */
  {
    const h = await harness({ providerStatus: 500 });
    try {
      const project = h.project();
      project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
      h.saveProject(project);
      const failed = await h.coverage({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "angles", clientRequestId: "adapter-fails",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert.strictEqual(failed.status, 502, `the adapter refused, so the request fails: ${JSON.stringify(failed.data)}`);
      const run = h.project().characters[0].coverageAutomation;
      assert(run, "the run was established before submission, so it exists");
      assert.strictEqual(run.status, "needs-attention",
        `and a submission that failed must not leave it live: ${JSON.stringify(run)}`);
      assert(run.needsAttentionAt, "with the lifecycle owner's own timestamp");
      note("15c. when the adapter refuses after the dispatch-commit point, the established run is transitioned to needs-attention by the existing lifecycle owner — no path leaves a run live with no valid submission behind it");
    } finally { h.close(); }
  }

  /* =======================================================================
     16. AN IDENTITY PAIR HAS TO AGREE WITH ITSELF.  [reviewer blocker 2]

     The reviewer reproduced a request naming an unsupported option B beside the supported
     model A: only the model half was read, A dispatched, and the ledger recorded a B/A
     pair describing a screen that cannot have existed. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const send = (optionId, modelId, tag) => h.post({
        ...framePlanBody(buildId, { clientRequestId: tag }),
        generationRequest: Presentation.generationRequestDeclaration({
          surface: "compiled-frame", viewMode: "advanced",
          ...(optionId ? { selectedOptionId: optionId } : {}),
          ...(modelId ? { selectedModelId: modelId } : {}),
        }),
      });
      const OPTION_A = `${IMAGE_MODEL_ID}::fal-queue::t2i`;
      /* A REAL CATALOGUED OPTION THIS ROUTE CANNOT DISPATCH. seedream/5.0-pro is in the
         shipped model catalogue and runware genuinely offers it, so this id is one
         CineBraid could have minted — which is what makes the cases below about the PAIR
         and about the ROUTE rather than about a string that never existed. */
      const OPTION_B = "seedream/5.0-pro::runware::t2i";
      const MODEL_B = "seedream/5.0-pro";

      /* A. The consistent, dispatchable pair. */
      const aa = await send(OPTION_A, IMAGE_MODEL_ID, "pair-aa");
      assert.strictEqual(aa.status, 200, `A option + A model must dispatch: ${JSON.stringify(aa.data)}`);
      const aaRow = h.ledger().find((row) => row.clientRequestId === "pair-aa");
      assert.strictEqual(aaRow.selectedOptionId, OPTION_A, "and record the option");
      assert.strictEqual(aaRow.selectedModelId, IMAGE_MODEL_ID, "beside the model it names");
      await h.settle(aa.data.job.id);

      /* B. The consistent pair this route cannot dispatch — the existing refusal. */
      const bb = await send(OPTION_B, MODEL_B, "pair-bb");
      assert.strictEqual(bb.status, 409, `B option + B model must still be refused: ${JSON.stringify(bb.data)}`);
      assert.strictEqual(bb.data.code, "GENERATION_MODEL_MISMATCH", "for the model this route dispatches");

      /* C. THE REVIEWER'S CASE. The two names disagree with each other. */
      const ba = await send(OPTION_B, IMAGE_MODEL_ID, "pair-ba");
      assert.strictEqual(ba.status, 409, `B option + A model must be refused: ${JSON.stringify(ba.data)}`);
      assert.strictEqual(ba.data.code, "GENERATION_OPTION_MODEL_MISMATCH", "for contradicting itself, not for the route");
      assert.strictEqual(ba.data.optionModelId, MODEL_B, "and the refusal names what the option actually is");
      assert.strictEqual(h.calls.length, 1, "no provider call beyond the one legitimate dispatch");
      assert.strictEqual(h.ledger().find((row) => row.clientRequestId === "pair-ba"), undefined,
        "and no contradictory pair is written to the ledger");

      /* D. Both absent — the deterministic legacy fallback, unchanged. */
      const none = await send("", "", "pair-none");
      assert.strictEqual(none.status, 200, `naming neither must still dispatch: ${JSON.stringify(none.data)}`);
      const noneRow = h.ledger().find((row) => row.clientRequestId === "pair-none");
      assert.strictEqual(noneRow.selectedOptionId, "", "and claim no option");
      assert.strictEqual(noneRow.selectedModelId, "", "and claim no model");
      /* The route's own configured endpoint is what is recorded as dispatched. This
         package carries an approved identity reference, so the compiled plan is an edit
         and the edit endpoint is the truthful answer — which is exactly why the ledger
         records what was DISPATCHED rather than echoing a selection nobody made. */
      assert.strictEqual(noneRow.model, "openai/gpt-image-2/edit",
        "while the route's own configured endpoint is what is recorded as dispatched");

      /* E. SHAPE IS NOT MINTABILITY.
       *
       * Every one of these has three colon-separated segments and is impossible. The
       * second reviewer dispatched the first of them and had it recorded durably as the
       * option a filmmaker had chosen, because the check only counted segments. Each is
       * refused for its own reason, from the catalogue the picker mints from. */
      const IMPOSSIBLE = [
        [`${IMAGE_MODEL_ID}::not-a-real-surface::not-a-real-mode`, "surface-does-not-offer-this-model", "a surface and a mode that do not exist"],
        [`${IMAGE_MODEL_ID}::fal-queue::not-a-real-mode`, "not-a-filmmaker-task-mode", "a real surface and an impossible mode"],
        /* comfy-local is a real surface and t2i is a real mode; comfy-local simply does
           not offer GPT Image 2, so this triple could never have been minted. */
        [`${IMAGE_MODEL_ID}::comfy-local::t2i`, "surface-does-not-offer-this-model", "a real mode on a surface that does not carry this model"],
        ["no-such-model/v1::fal-queue::t2i", "model-not-in-catalogue", "a model that is not in the catalogue"],
        ["not-an-option-id", "not-an-option-identity", "a string that is not an identity at all"],
      ];
      const before = h.calls.length;
      for (const [optionId, reason, description] of IMPOSSIBLE) {
        const impossible = await send(optionId, IMAGE_MODEL_ID, `pair-${reason}-${optionId.length}`);
        assert.strictEqual(impossible.status, 409, `${description} must be refused: ${JSON.stringify(impossible.data)}`);
        assert.strictEqual(impossible.data.code, "GENERATION_OPTION_IDENTITY_INVALID", `${description}: typed as an identity refusal`);
        assert.strictEqual(impossible.data.reason, reason, `${description}: refused for the right reason`);
      }
      assert.strictEqual(h.calls.length, before, "and none of them reached the provider");
      assert.strictEqual(h.ledger().filter((row) => IMPOSSIBLE.some(([id]) => row.selectedOptionId === id)).length, 0,
        "and none of them was recorded as an option a filmmaker chose");
      note(`16. ${IMPOSSIBLE.length} well-formed but impossible option identities are each refused for their own catalogue reason with no dispatch and no ledger row; B-option + A-model is refused with GENERATION_OPTION_MODEL_MISMATCH naming ${MODEL_B}; A/A dispatches and records both, B/B keeps its existing route refusal, and both-absent keeps the legacy fallback`);
    } finally { h.close(); }
  }

  /* =======================================================================
     16b. THE MODE VOCABULARY IS THE TASK TABLE'S, AND STAYS THAT WAY.

     generationOptionMintable() judges a mode against generationOptionModes(), which is
     the union of what the filmmaker tasks DECLARE. That is only sound while
     resolveTaskModes() — the function that actually decides which modes a task offers for
     a given input shape — returns a subset of them. It narrows by shape today; a task
     that started returning an undeclared mode would make the validator quietly reject
     real option ids. Asserted against the live table across every input shape
     resolveTaskModes branches on, so the relationship cannot rot silently. */
  {
    const declared = new Set(Options.generationOptionModes());
    const shapes = [
      {}, { hasMask: true },
      { references: [{ role: "identity", mediaType: "image" }] },
      { firstFrame: true }, { firstFrame: true, lastFrame: true },
      { references: [{ role: "reference", mediaType: "image" }], firstFrame: true },
    ];
    const seen = new Set();
    for (const task of Options.CINEBRAID_FILMMAKER_TASKS)
      for (const inputs of shapes)
        for (const mode of Options.resolveTaskModes(task.task, inputs)) {
          seen.add(mode);
          assert(declared.has(mode),
            `resolveTaskModes(${task.task}) offers "${mode}", which no filmmaker task declares — generationOptionModes() would refuse a real option id`);
        }
    assert(seen.size >= 5, `the probe must actually exercise the branches: only ${seen.size} modes were reached`);
    note(`16b. every mode resolveTaskModes() can offer across ${shapes.length} input shapes (${[...seen].sort().join(", ")}) is declared by a filmmaker task, so the mintability vocabulary cannot silently narrow`);
  }

  /* =======================================================================
     17. EQUALITY IS NOT AN EXCESS.  [reviewer blocker 3]

     Three $0.10 children against a $0.30 ceiling. `0.1 + 0.1 + 0.1` is
     0.30000000000000004 in binary floating point, so the third was refused while both
     figures displayed as $0.30 — a filmmaker told they had exceeded a budget they had
     exactly met. */
  {
    const h = await harness({ ratePerImage: 0.1 });
    try {
      const buildId = seedFramePackage(h);
      const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      h.saveRuns([{
        id: "run-exact", schemaVersion: 2, revision: 1, status: "running",
        runnerId: "runner-exact", leaseExpiresAt: lease,
        config: { maxImages: 9, outputsPerRequest: 1, maxSpend: { priced: true, amount: 0.3, quantity: 3, unitBasis: "image", ratePerUnit: 0.1 } },
        usage: { imagesGenerated: 0 }, steps: {}, logs: [],
      }]);
      const runBody = (step) => ({
        purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
        sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
        aspectRatio: "16:9", outputCount: 1, quality: "high", resolution: "1k", clientRequestId: step,
        automationRunId: "run-exact", automationStepKey: step, automationRunnerId: "runner-exact",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
      });
      for (const step of ["e1", "e2", "e3"]) {
        const result = await h.post(runBody(step));
        assert.strictEqual(result.status, 200,
          `${step}: three $0.10 children exactly meet a $0.30 ceiling and must all dispatch: ${JSON.stringify(result.data)}`);
        await h.settle(result.data.job.id);
      }
      assert.strictEqual(h.calls.length, 3, "all three reach the provider");
      const total = h.ledger().reduce((sum, row) => sum + Number(row.accounting?.estimate?.amount || 0), 0);
      assert.notStrictEqual(total, 0.3,
        `the reproduction is only meaningful while the raw sum is NOT exactly 0.3 — it is ${total}`);

      /* One more priced child is a real excess and is refused. */
      const over = await h.post(runBody("e4"));
      assert.strictEqual(over.status, 409, `a fourth $0.10 child exceeds $0.30: ${JSON.stringify(over.data)}`);
      assert.strictEqual(over.data.code, "AUTOMATION_SPEND_CAP", "for the ceiling");
      assert.strictEqual(h.calls.length, 3, "and reaches no provider");
      note(`17. three $0.10 children dispatch against a $0.30 ceiling whose raw float sum is ${total} — equality is not an excess — and the fourth is refused with AUTOMATION_SPEND_CAP`);
    } finally { h.close(); }
  }

  /* =======================================================================
     18. UNKNOWN COST IS NOT ZERO.  [reviewer blocker 4]

     A monetary ceiling that cannot be checked has not been honoured; it has been skipped.
     The reviewer reproduced an unpriced child dispatching under a numeric ceiling because
     an unknown amount fell back to 0, and zero never moves a total. */
  {
    /* No configured rate, so the cost owner honestly answers `unknown` for every child. */
    const h = await harness({ ratePerImage: 0 });
    try {
      const buildId = seedFramePackage(h);
      const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      h.saveRuns([{
        id: "run-unknown", schemaVersion: 2, revision: 1, status: "running",
        runnerId: "runner-unknown", leaseExpiresAt: lease,
        /* A NUMERIC ceiling, recorded when a rate existed. The rate is gone now. */
        config: { maxImages: 9, outputsPerRequest: 1, maxSpend: { priced: true, amount: 0.3, quantity: 3, unitBasis: "image", ratePerUnit: 0.1 } },
        usage: { imagesGenerated: 0 }, steps: {}, logs: [],
      }]);
      const body = {
        purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
        sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
        aspectRatio: "16:9", outputCount: 1, quality: "high", resolution: "1k", clientRequestId: "u1",
        automationRunId: "run-unknown", automationStepKey: "u1", automationRunnerId: "runner-unknown",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
      };
      const refused = await h.post(body);
      assert.strictEqual(refused.status, 409, `an unpriceable child under a numeric ceiling must be refused: ${JSON.stringify(refused.data)}`);
      assert.strictEqual(refused.data.code, "AUTOMATION_SPEND_UNKNOWN", "and typed as a cost-unavailable refusal");
      assert(/cannot price this request/.test(String(refused.data.error)), `saying so honestly: ${refused.data.error}`);
      assert(!/\$0\.00/.test(String(refused.data.error)) && !/free/i.test(String(refused.data.error)),
        `and never calling an unknown cost zero or free: ${refused.data.error}`);
      assert.strictEqual(h.calls.length, 0, "no provider call may be made");
      assert.strictEqual(h.ledger().length, 0, "and no durable row is created");
      note("18. under a numeric ceiling an unpriceable child is refused with AUTOMATION_SPEND_UNKNOWN before dispatch — unknown is never read as $0, and the refusal says neither zero nor free");
    } finally { h.close(); }
  }

  /* =======================================================================
     19. AN INCOMPLETE TOTAL CANNOT AUTHORISE MORE SPEND.  [reviewer blocker 4b]

     The other half. A run already holding a child whose cost is unknown has a true spend
     of at least the priced sum and possibly much more, so authorising another paid child
     on the strength of the known subtotal is a guess dressed as a budget check. */
  {
    const h = await harness({ ratePerImage: 0.1 });
    try {
      const buildId = seedFramePackage(h);
      const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      h.saveRuns([{
        id: "run-partial", schemaVersion: 2, revision: 1, status: "running",
        runnerId: "runner-partial", leaseExpiresAt: lease,
        config: { maxImages: 9, outputsPerRequest: 1, maxSpend: { priced: true, amount: 0.3, quantity: 3, unitBasis: "image", ratePerUnit: 0.1 } },
        usage: { imagesGenerated: 0 }, steps: {}, logs: [],
      }]);
      /* One child of this run whose recorded cost is honestly unknown — the state a run
         reaches when a rate was removed part-way through, or an output whose billing
         basis CineBraid does not know. The known subtotal is $0.10, well under $0.30. */
      h.seedLedger([{
        id: "job-priced", provider: "fal", purpose: "frame", status: "COMPLETED", outputCount: 1,
        automationRunId: "run-partial", automationStepKey: "seeded-priced", shotId: "SH-1",
        accounting: { costClass: "metered_api", recordedAt: "2026-08-27T00:00:00.000Z",
          estimate: { costClass: "metered_api", unit: "usd", confidence: "estimated", amount: 0.1, breakdown: [] },
          basis: { unitBasis: "image", quantity: 1, ratePerUnit: 0.1, rateSource: "generation.fal.estimatedCostPerImage" } },
      }, {
        id: "job-unknown", provider: "fal", purpose: "frame", status: "COMPLETED", outputCount: 1,
        automationRunId: "run-partial", automationStepKey: "seeded-unknown", shotId: "SH-1",
        accounting: { costClass: "metered_api", recordedAt: "2026-08-27T00:00:00.000Z",
          estimate: { costClass: "metered_api", unit: "usd", confidence: "unknown" },
          basis: { unitBasis: "image", quantity: 1, ratePerUnit: null, rateSource: null, unpricedReason: "no-configured-rate" } },
      }]);
      const refused = await h.post({
        purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
        sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
        aspectRatio: "16:9", outputCount: 1, quality: "high", resolution: "1k", clientRequestId: "p1",
        automationRunId: "run-partial", automationStepKey: "p1", automationRunnerId: "runner-partial",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
      });
      assert.strictEqual(refused.status, 409,
        `a run whose committed spend is not fully known must not authorise another paid child: ${JSON.stringify(refused.data)}`);
      assert.strictEqual(refused.data.code, "AUTOMATION_SPEND_UNKNOWN", "and typed as a cost-unavailable refusal");
      assert(/no priced estimate/.test(String(refused.data.error)), `naming the gap: ${refused.data.error}`);
      assert.strictEqual(h.calls.length, 0, "no provider call may be made");
      note("19. a run holding one $0.10 child and one child of unknown cost refuses the next request under its $0.30 ceiling — a known subtotal below a ceiling is not proof, because the unknown child is excluded from it");
    } finally { h.close(); }
  }

  /* =======================================================================
     15d. CROSS-STORE DURABILITY: WHAT SURVIVES AN INTERRUPTION AT EVERY SEAM.

     The coverage run and the generation ledger are two files with two persistence
     chains, and an earlier version of this route wrote the run first and called the pair
     "one durable turn". An independent reviewer interrupted the process between them and
     got `sheet-running` carrying a job id no ledger had ever heard of.

     THESE ARE NOT try/catch TESTS. Each seam is exercised by stopping the process from
     completing the NEXT durable step — the module is loaded with that step replaced by
     one that never returns a written result — and then the two files are read straight
     off disk. What is asserted is what a cold reader would find, which is the only thing
     a crash leaves behind.

     Every seam must have a truthful reading, and the ordering must make the ONE
     unreachable state the one that lies: coverage claiming live with no job. */
  {
    const interrupt = async (what, mutations, drive) => {
      const h = await harness({ falGeneration: loadRouteWithFault(mutations) });
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        return { state: await drive(h), h, what };
      } finally { h.close(); }
    };
    const coverageRequest = (extra = {}) => ({
      purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
      sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
      references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
      outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
      coverageJobType: "sheet", coverageSheetType: "angles",
      generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      ...extra,
    });

    /* B1. THE PROCESS STOPS IMMEDIATELY AFTER THE LEDGER ROW.
           The reviewer's seam, in the order that makes it safe. Nothing after the commit
           runs at all: no projection, no provider call. This is what a crash there
           leaves, read off both files. */
    {
      const { state } = await interrupt("the process stops after the ledger write",
        [["    if (typeof trusted?.onDispatchCommit === \"function\") {",
          "    if (true) throw new Error(\"process stopped after the ledger write\");\n    if (typeof trusted?.onDispatchCommit === \"function\") {"]],
        async (h) => { await h.coverage(coverageRequest({ clientRequestId: "seam-b1" })); return { ...h.durable(), calls: h.calls.length }; });
      assert.strictEqual(state.jobs.length, 1, `the ledger row is durable: ${JSON.stringify(state.jobs.map((j) => j.id))}`);
      assert.strictEqual(state.calls, 0, "and no provider was contacted");
      assert.strictEqual(state.coverage.length, 0,
        `and NO coverage record claims anything — the state the old order made unreachable is now this one: ${JSON.stringify(state.coverage)}`);
      assert.strictEqual(state.jobs[0].status, "SUBMITTING", "the surviving row reads as intent");
      assert(!state.jobs[0].externalId, "with no provider handle, which is what makes it uncertain");
    }

    /* B2. THE PROJECTION WRITE ITSELF FAILS, and the process lives.
           Different from a crash and answered differently: the job is already durable, so
           refusing now would report "nothing happened" about a row that exists. The
           dispatch continues and the absence is recorded on the row. */
    {
      const { state } = await interrupt("the projection write fails",
        [["        await trusted.onDispatchCommit(owner, job);",
          "        await Promise.reject(new Error(\"coverage store unavailable\"));"]],
        async (h) => { await h.coverage(coverageRequest({ clientRequestId: "seam-b2" })); return h.durable(); });
      assert.strictEqual(state.jobs.length, 1, "the job is durable");
      assert.strictEqual(state.coverage.length, 0, "and still no coverage record claims anything");
      assert.strictEqual(state.jobs[0].status, "IN_QUEUE", "the dispatch completed, because the job was real");
      assert(state.jobs[0].coverageProjectionError,
        `and the missing projection is explained on the row rather than silent: ${JSON.stringify(state.jobs[0].coverageProjectionError)}`);
    }

    /* B2. AND THAT SURVIVING ROW REFUSES ITS OWN DUPLICATE, so recovery never bills
           twice. This is what makes leaving it behind safe. */
    {
      const h = await harness();
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        h.seedLedger([{
          id: "interrupted-1", provider: "fal", purpose: "entity-reference", status: "SUBMITTING",
          entityList: "characters", entityId: "KAI", coverageJobType: "sheet", coverageSheetType: "angles",
          sourceBuildId: "entity-fixture", outputCount: 1, createdAt: "2026-08-28T00:00:00.000Z",
        }]);
        const before = h.durable().jobs.length;
        const again = await h.coverage(coverageRequest({ clientRequestId: "after-interruption" }));
        /* THE PROPERTY IS "NO SECOND PAID REQUEST", not which guard says so. Two of them
           can answer here and both are correct: the entity-reference duplicate guard
           REATTACHES to the interrupted job (200, reused, duplicatePrevented), and the
           unresolved-twin guard REFUSES (409, GENERATION_UNRESOLVED). Asserting one by
           name would make this pass or fail on guard ordering rather than on the bill. */
        const reattached = again.status === 200 && again.data.reused === true && again.data.duplicatePrevented === true;
        const refused = again.status === 409 && again.data.code === "GENERATION_UNRESOLVED";
        assert(reattached || refused,
          `an interrupted submission must be reattached or refused, never re-sent: ${again.status} ${JSON.stringify(again.data)}`);
        assert.strictEqual(h.calls.length, 0, "and no provider is contacted — no second bill");
        assert.strictEqual(h.durable().jobs.length, before, "and no second job row is created");
        if (reattached) assert.strictEqual(again.data.job.id, "interrupted-1", "the reattachment names the interrupted job");
      } finally { h.close(); }
    }

    /* C. THE PROVIDER ACCEPTED AND BOTH ACKNOWLEDGEMENT WRITES FAIL.
          The reviewer's second reproduction. */
    {
      /* Both acknowledgement persistence attempts fail — the reviewer's exact
         reproduction. The provider has already accepted and returned its request id; the
         only place that id ever existed is the response object in memory. */
      const ackFails = loadRouteWithFault([[
        "      const outcome = await submit(owner, job, job.references, preparedLegacy);\n      try {\n        await commit(owner, (current) => {",
        "      const outcome = await submit(owner, job, job.references, preparedLegacy);\n      try {\n        await Promise.reject(new Error(\"acknowledgement store unavailable\"));\n        await commit(owner, (current) => {",
      ], [
        "          Object.assign(job, row);\n        }).catch(() => {});",
        "          Object.assign(job, row);\n        }).then(() => { throw new Error(\"second acknowledgement write also failed\"); }).catch(() => {});",
      ]]);
      const h = await harness({ falGeneration: ackFails });
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        const result = await h.coverage(coverageRequest({ clientRequestId: "ack-fails" }));
        assert.strictEqual(result.status, 502, `the request answers 502: ${JSON.stringify(result.data)}`);
        assert.strictEqual(result.data.code, "GENERATION_UNRESOLVED", "as unresolved");
        assert.strictEqual(h.calls.length, 1, "the provider WAS contacted — one paid submission may exist");
        const state = h.durable();
        assert.strictEqual(state.coverage.length, 1, "the coverage record exists");
        assert.strictEqual(state.coverage[0].status, "needs-attention",
          `and must NOT go on reading as running: ${JSON.stringify(state.coverage[0])}`);
        assert(state.coverage[0].error, "carrying why a person has to look");
      } finally { h.close(); }
    }

    /* D. THE JOB IS ACKNOWLEDGED AND DURABLE; THE PROJECTION WAS NEVER WRITTEN.
          The job is the truth, and the record is rebuilt from it — no browser state, no
          new field: the row already carries the entity, the coverage kind and the sheet. */
    {
      const h = await harness();
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        h.seedLedger([{
          id: "acknowledged-1", provider: "fal", purpose: "entity-reference", status: "IN_QUEUE",
          externalId: "img-1", statusUrl: `${h.mockOrigin}/status/img-1`, responseUrl: `${h.mockOrigin}/result/img-1`,
          entityList: "characters", entityId: "KAI", coverageJobType: "sheet", coverageSheetType: "angles",
          sourceBuildId: "entity-fixture", outputCount: 1, createdAt: "2026-08-28T00:00:00.000Z",
        }]);
        assert.strictEqual(h.durable().coverage.length, 0, "the projection is genuinely missing to begin with");
        await h.refresh("acknowledged-1");
        const rebuilt = h.durable().coverage;
        assert.strictEqual(rebuilt.length, 1, `the projection is rebuilt from the job row: ${JSON.stringify(rebuilt)}`);
        assert.strictEqual(rebuilt[0].entityId, "KAI", "for the entity the row names");
        assert.strictEqual(rebuilt[0].sheetType, "angles", "carrying the coverage kind the row names");
        assert.deepStrictEqual(rebuilt[0].jobs, ["acknowledged-1"], "and the job that justifies it");
        assert(rebuilt[0].rebuiltFromJobAt, "and says it was reconstructed rather than dispatched");
      } finally { h.close(); }
    }

    /* E. THE ORDINARY SUCCESSFUL LIFECYCLE, for contrast: both stores agree, and the
          record names exactly the job that justifies it. */
    {
      const h = await harness();
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        const ok = await h.coverage(coverageRequest({ clientRequestId: "healthy" }));
        assert.strictEqual(ok.status, 200, `a healthy coverage dispatch: ${JSON.stringify(ok.data)}`);
        const state = h.durable();
        assert.strictEqual(state.jobs.length, 1, "one durable job");
        assert.strictEqual(state.coverage.length, 1, "one coverage record");
        assert.deepStrictEqual(state.coverage[0].jobs, [state.jobs[0].id],
          "and the record names exactly the job that justifies it");
        assert.strictEqual(state.jobs[0].resolution, "4k", "with the coverage 4K intact");
      } finally { h.close(); }
    }
      note("15d. at every durable seam the two stores read truthfully OFF DISK: a stop after the ledger write leaves a SUBMITTING row with no coverage record and no provider call (never the reverse); a failed projection write leaves the real job dispatching with the absence recorded on the row; that surviving row is reattached rather than re-sent, with no second provider call and no second row; a doubly-failed acknowledgement leaves the run needs-attention rather than running; an acknowledged job rebuilds its projection from the row alone; and a healthy dispatch has both stores naming the same job");
  }

  /* =======================================================================
     15e. REFRESH MUST NOT TURN UNCERTAINTY INTO FAILURE.

     A durable `SUBMITTING` row with no provider handle is the state a process death
     leaves behind, and it has TWO possible histories that nothing on disk can tell apart:
     the process stopped before the provider was contacted, or the provider accepted and
     the answer was lost. Only one of them is free.

     An independent reviewer followed what refresh did with it: the no-handle guard only
     covered UNRESOLVED, so this row fell through to a provider poll built out of an
     absent URL, the poll failed, and the catch persisted FAILED. FAILED does not block
     resubmission — so a refresh converted "we do not know whether we were billed" into
     "it definitely failed", and the next request with the same context and a fresh
     clientRequestId was free to send a second paid submission.

     The refresh-then-retry chain below is the whole defect, end to end. */
  {
    const h = await harness();
    try {
      const project = h.project();
      project.characters.push({
        id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [],
        /* The projection that survived alongside it, as it would after an interruption. */
        coverageAutomation: { id: "coverage:characters:KAI:run", list: "characters", entityId: "KAI", mode: "sheet", sheetType: "angles", status: "sheet-running", startedAt: "2026-08-28T00:00:00.000Z", jobs: ["uncertain-1"] },
      });
      h.saveProject(project);
      const UNCERTAIN = {
        id: "uncertain-1", provider: "fal", purpose: "entity-reference", status: "SUBMITTING",
        entityList: "characters", entityId: "KAI", entityType: "character",
        coverageJobType: "sheet", coverageSheetType: "angles",
        sourceBuildId: "entity-fixture", outputCount: 1, clientRequestId: "original-press",
        prompt: "Kai against neutral grey.", createdAt: "2026-08-28T00:00:00.000Z",
      };
      h.seedLedger([UNCERTAIN]);
      /* THE CONTEXT KEY IS WHAT A RETRY WOULD COLLIDE ON, and it is the same for both
         requests below — the identity is the production result, not the press. */
      const contextKey = Lifecycle.generationContextKey(UNCERTAIN);
      assert(contextKey, "the fixture must have a real context key or the retry proves nothing");
      assert.strictEqual(Lifecycle.blocksResubmission(UNCERTAIN), true,
        "and the seeded row must genuinely be one that blocks a duplicate before refresh");

      /* 1. THE NORMAL REFRESH PATH. */
      const refreshed = await h.refresh("uncertain-1");
      assert.strictEqual(refreshed.status, 409, `refresh answers truthfully rather than polling nothing: ${JSON.stringify(refreshed.data)}`);
      assert.strictEqual(refreshed.data.code, "GENERATION_UNRESOLVED_NO_HANDLE", "with the existing no-handle vocabulary");
      assert.strictEqual(h.calls.length, 0, "and contacts no provider — refresh never guesses by asking");

      const afterRefresh = h.durable().jobs.find((row) => row.id === "uncertain-1");
      assert.notStrictEqual(afterRefresh.status, "FAILED",
        `THE DEFECT: refresh must not persist FAILED merely because the handle is absent — status is ${JSON.stringify(afterRefresh.status)}`);
      assert.strictEqual(afterRefresh.status, "SUBMITTING", "the uncertainty is preserved exactly as it was");
      assert(!afterRefresh.externalId, "and no provider handle is invented");
      assert.strictEqual(Lifecycle.blocksResubmission(afterRefresh), true,
        "and the row still blocks an equivalent resubmission after refresh");

      /* The projection is allowed to move, because it is only a projection. */
      const coverage = h.durable().coverage[0];
      assert.strictEqual(coverage.status, "needs-attention",
        `and coverage stops presenting it as an ordinary healthy run: ${JSON.stringify(coverage)}`);

      /* 2. THE RETRY: same context, DIFFERENT clientRequestId — the exact shape that
            became eligible once FAILED was persisted. */
      const retry = await h.coverage({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "angles",
        clientRequestId: "a-different-press",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      /* BOTH ESTABLISHED GUARDS ANSWER THIS, and both are correct: the entity-reference
         duplicate guard REATTACHES to the uncertain job when the coverage target is
         identical, and the unresolved-twin guard REFUSES when it is not. What must never
         happen is a second submission, so that is what is asserted rather than a code. */
      const reattached = retry.status === 200 && retry.data.reused === true && retry.data.duplicatePrevented === true;
      assert(reattached, `an identical coverage target reattaches to the uncertain job: ${retry.status} ${JSON.stringify(retry.data)}`);
      assert.strictEqual(retry.data.job.id, "uncertain-1", "naming the job that is already uncertain");

      /* The other arm: same generationContextKey, a target the duplicate guard does not
         match, so the unresolved-twin guard is the one that answers. */
      const twin = await h.coverage({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "expressions",
        clientRequestId: "another-different-press",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert.strictEqual(twin.status, 409, `a same-context request is refused outright: ${JSON.stringify(twin.data)}`);
      assert.strictEqual(twin.data.code, "GENERATION_UNRESOLVED", "through the existing uncertainty guard");
      assert.strictEqual(Lifecycle.generationContextKey(twin.data.job || UNCERTAIN), contextKey,
        "and it is the same production result that is being protected");

      assert.strictEqual(h.calls.length, 0, "ZERO provider submissions across the whole chain");
      assert.strictEqual(h.durable().jobs.length, 1, "and no second generation row exists");

      /* 3. AND THERE IS A WAY OUT. A person looks at the provider and records what they
            found — the existing reconciliation path, which now accepts both ways a job
            can be uncertain rather than only one. */
      const settled = await h.reconcile("uncertain-1", "not-accepted", "Checked fal; the request never arrived.");
      assert.strictEqual(settled.status, 200, `a human can settle it: ${JSON.stringify(settled.data)}`);
      const settledRow = h.durable().jobs.find((row) => row.id === "uncertain-1");
      assert.strictEqual(settledRow.status, "FAILED", "recorded as the person found it");
      assert.strictEqual(settledRow.reconciliation.previousStatus, "SUBMITTING",
        "and the record says what it was when they looked, rather than assuming UNRESOLVED");
      assert.strictEqual(Lifecycle.blocksResubmission(settledRow), false,
        "and only now, on a person's evidence, is an equivalent request allowed again");

      /* 4. AND THE WAY OUT ACTUALLY LEADS SOMEWHERE. A refusal that never lifts is not a
            recovery path, it is a dead end wearing one. The SAME request that was refused
            three lines ago now goes through — which is what makes reconciliation the
            intentional way out rather than a status write with no consequence. */
      const afterSettlement = await h.coverage({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "angles",
        clientRequestId: "after-a-person-looked",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert.strictEqual(afterSettlement.status, 200,
        `a settled uncertainty stops blocking anything: ${JSON.stringify(afterSettlement.data)}`);
      assert.strictEqual(h.calls.length, 1, "and THIS is the first paid submission in the whole reproduction");
      assert.strictEqual(h.durable().jobs.length, 2, "on a second job row, which is what a deliberate retry is");
      note(`15e. refresh leaves an uncertain SUBMITTING/no-handle job SUBMITTING rather than FAILED, contacts no provider, moves only the coverage projection to needs-attention, and still blocks an equivalent retry with a different clientRequestId — 0 provider submissions and 1 job row until a human reconciliation (recorded previousStatus SUBMITTING) releases it, after which the identical request dispatches once`);
    } finally { h.close(); }
  }

  /* =======================================================================
     15f. CANCEL MUST NOT INVENT THE OUTCOME EITHER.

     The same defect as 15e, in the route next door, found by the same reviewer following
     the same state one step further. Refresh had been taught that a durable `SUBMITTING`
     row with no handle is uncertain; cancel had not. It asked `isUnresolved(job) &&
     !job.cancelUrl`, so this row walked straight past the guard, no provider was
     contacted — there was no cancel URL to contact one with — and CANCELLED was persisted
     from local intent alone. CANCELLED does not block resubmission, so pressing Cancel on
     a request that might be rendering was enough to buy it a second time.

     Wanting something cancelled is not evidence that it never happened. */
  {
    const h = await harness();
    try {
      const project = h.project();
      project.characters.push({
        id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [],
        coverageAutomation: { id: "coverage:characters:KAI:run", list: "characters", entityId: "KAI", mode: "sheet", sheetType: "angles", status: "sheet-running", startedAt: "2026-08-28T00:00:00.000Z", jobs: ["uncertain-1"] },
      });
      h.saveProject(project);
      h.seedLedger([{
        id: "uncertain-1", provider: "fal", purpose: "entity-reference", status: "SUBMITTING",
        entityList: "characters", entityId: "KAI", entityType: "character",
        coverageJobType: "sheet", coverageSheetType: "angles",
        sourceBuildId: "entity-fixture", outputCount: 1, clientRequestId: "original-press",
        prompt: "Kai against neutral grey.", createdAt: "2026-08-28T00:00:00.000Z",
      }]);

      /* The reviewer's sequence exactly: refresh first, so the job is already known to be
         uncertain by the time Cancel is pressed. */
      const refreshed = await h.refresh("uncertain-1");
      assert.strictEqual(refreshed.status, 409, "refresh still answers with uncertainty");

      const cancelled = await h.cancel("uncertain-1");
      assert.strictEqual(cancelled.status, 409,
        `THE DEFECT: cancel must refuse rather than write a terminal status it cannot know: ${JSON.stringify(cancelled.data)}`);
      assert.strictEqual(cancelled.data.code, "GENERATION_UNRESOLVED_NO_HANDLE",
        "through the existing no-handle vocabulary, not a new one");
      assert.strictEqual(cancelled.data.blockReason, "in-flight-without-handle",
        "and it says which kind of uncertainty this is");
      assert.strictEqual(h.cancelCalls.length, 0, "with no provider contacted — there is no handle to contact one with");

      const afterCancel = h.durable().jobs.find((row) => row.id === "uncertain-1");
      assert.notStrictEqual(afterCancel.status, "CANCELLED",
        `and the durable row must not be marked cancelled: ${JSON.stringify(afterCancel.status)}`);
      assert.strictEqual(afterCancel.status, "SUBMITTING", "the uncertainty is preserved exactly as it was");
      assert.strictEqual(Lifecycle.blocksResubmission(afterCancel), true,
        "and it still holds the duplicate block, which is the whole point of refusing");
      assert.strictEqual(h.durable().coverage[0].status, "needs-attention",
        "the projection still asks for a person rather than reporting a cancellation that did not happen");

      /* THE BILL. Both established duplicate mechanisms, exactly as reproduction 15e
         exercises them: an identical coverage target REATTACHES to the uncertain job,
         and a target the duplicate guard does not match is REFUSED by the unresolved
         twin guard. Neither may submit anything. */
      const retry = await h.coverage({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "angles",
        clientRequestId: "a-different-press",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert(retry.status === 200 && retry.data.reused === true && retry.data.duplicatePrevented === true,
        `an identical coverage target reattaches to the uncertain job: ${retry.status} ${JSON.stringify(retry.data)}`);
      assert.strictEqual(retry.data.job.id, "uncertain-1", "naming the job that is already uncertain");

      const twin = await h.coverage({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "expressions",
        clientRequestId: "a-third-press",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert.strictEqual(twin.status, 409, `and a differing target is refused outright: ${JSON.stringify(twin.data)}`);
      assert.strictEqual(twin.data.code, "GENERATION_UNRESOLVED", "through the existing uncertainty guard");
      assert.strictEqual(h.calls.length, 0, "ZERO provider submissions across refresh, cancel and retry");
      assert.strictEqual(h.durable().jobs.length, 1, "and one durable job for the whole sequence");
      note(`15f. pressing Cancel on an uncertain SUBMITTING/no-handle job is refused with GENERATION_UNRESOLVED_NO_HANDLE instead of persisting CANCELLED, contacts no provider, leaves the row SUBMITTING and still blocking — refresh then cancel then an equivalent retry produce 0 provider submissions and 1 job row`);
    } finally { h.close(); }
  }

  /* =======================================================================
     15f-matrix. THE STATES CANCEL MUST STILL CANCEL.

     A guard that refuses everything is not a fix. The refusal above is narrow by
     construction — it is the lifecycle's uncertainty predicate, narrowed to the handle
     cancel itself needs — and these are the states on the other side of it. */
  {
    const h = await harness();
    try {
      const mockOrigin = h.mockOrigin;
      h.seedLedger([
        /* B. The classifier's own uncertainty, with nothing to cancel by. */
        { id: "unresolved-no-handle", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "UNRESOLVED", createdAt: "2026-08-28T00:00:00.000Z" },
        /* C. A submission the provider acknowledged, with a real cancel handle. */
        { id: "submitting-handled", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "SUBMITTING", externalId: "req-c", statusUrl: `${mockOrigin}/status/req-c`, cancelUrl: `${mockOrigin}/cancel/req-c`, createdAt: "2026-08-28T00:00:00.000Z" },
        /* D. An ordinary queued job. */
        { id: "queued", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "IN_QUEUE", externalId: "req-d", statusUrl: `${mockOrigin}/status/req-d`, cancelUrl: `${mockOrigin}/cancel/req-d`, createdAt: "2026-08-28T00:00:00.000Z" },
        /* E. Delivered, and already settled by a person. */
        { id: "delivered", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "COMPLETED", externalId: "req-e", ingestedAt: "2026-08-28T00:00:00.000Z", createdAt: "2026-08-28T00:00:00.000Z" },
        { id: "settled", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "FAILED", createdAt: "2026-08-28T00:00:00.000Z", reconciliation: { outcome: "not-accepted", previousStatus: "UNRESOLVED", at: "2026-08-28T00:00:00.000Z", by: "user" } },
      ]);

      const b = await h.cancel("unresolved-no-handle");
      assert.strictEqual(b.status, 409, `B. UNRESOLVED with no handle is refused: ${JSON.stringify(b.data)}`);
      assert.strictEqual(b.data.code, "GENERATION_UNRESOLVED_NO_HANDLE", "with the same vocabulary");
      assert.strictEqual(h.durable().jobs.find((row) => row.id === "unresolved-no-handle").status, "UNRESOLVED",
        "and stays exactly as uncertain as it was");

      const c = await h.cancel("submitting-handled");
      assert.strictEqual(c.status, 200, `C. a submission WITH a cancel handle still cancels: ${JSON.stringify(c.data)}`);
      assert(h.cancelCalls.includes("req-c"), "and the provider is genuinely told — that is what makes it evidence rather than a guess");
      assert.strictEqual(h.durable().jobs.find((row) => row.id === "submitting-handled").status, "CANCELLED",
        "so CANCELLED is the truth here, and is written");

      const d = await h.cancel("queued");
      assert.strictEqual(d.status, 200, `D. an ordinary queued job still cancels: ${JSON.stringify(d.data)}`);
      assert(h.cancelCalls.includes("req-d"), "with the provider contacted");
      assert.strictEqual(h.durable().jobs.find((row) => row.id === "queued").status, "CANCELLED", "and the row updated");

      const e1 = await h.cancel("delivered");
      assert.strictEqual(e1.status, 200, `E. a delivered job answers as before: ${JSON.stringify(e1.data)}`);
      assert.strictEqual(h.durable().jobs.find((row) => row.id === "delivered").status, "COMPLETED",
        "and the delivery the filmmaker paid for is not erased");

      const e2 = await h.cancel("settled");
      assert.strictEqual(e2.status, 200, `E. a reconciled job answers as before: ${JSON.stringify(e2.data)}`);
      assert.strictEqual(h.calls.length, 0, "and nothing in this matrix submitted anything");
      note(`15f-matrix. cancel refuses ONLY uncertain no-handle work: UNRESOLVED/no-handle and SUBMITTING/no-handle are refused untouched, while SUBMITTING and IN_QUEUE with a real cancel handle still contact the provider and persist CANCELLED, a delivered job keeps COMPLETED, and a reconciled job is unchanged`);
    } finally { h.close(); }
  }

  /* =======================================================================
     15g. A REBUILT PROJECTION MUST NOT MAKE UNCERTAIN WORK LOOK HEALTHY.

     The second half of the same review. A crash between the ledger write and the
     projection write leaves the job durable and its coverage record missing, and refresh
     rebuilds the record from the row — deliberately, because that is the earliest moment
     the projection can be recovered. But the rebuild wrote `sheet-running` unconditionally,
     so the recovered board said a sheet was on its way while the only job behind it was
     one nobody could account for.

     The job is ambiguous; the projection is how the project DESCRIBES the job; so the
     projection has to describe the ambiguity. The live dispatch path is untouched — it
     still writes a running record for a SUBMITTING row it is about to submit, because
     there it knows what it is doing. */
  {
    const h = await harness();
    try {
      const project = h.project();
      /* No coverageAutomation at all: the write that would have created it never landed. */
      project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
      h.saveProject(project);
      h.seedLedger([{
        id: "uncertain-1", provider: "fal", purpose: "entity-reference", status: "SUBMITTING",
        entityList: "characters", entityId: "KAI", entityType: "character",
        coverageJobType: "sheet", coverageSheetType: "angles",
        sourceBuildId: "entity-fixture", outputCount: 1, clientRequestId: "original-press",
        prompt: "Kai against neutral grey.", createdAt: "2026-08-28T00:00:00.000Z",
      }]);
      assert.strictEqual(h.durable().coverage.length, 0, "the fixture must genuinely start with no projection");

      const refreshed = await h.refresh("uncertain-1");
      assert.strictEqual(refreshed.status, 409, `refresh answers with uncertainty: ${JSON.stringify(refreshed.data)}`);
      assert.strictEqual(refreshed.data.code, "GENERATION_UNRESOLVED_NO_HANDLE", "with the existing vocabulary");
      assert.strictEqual(h.calls.length, 0, "and contacts no provider");

      const job = h.durable().jobs.find((row) => row.id === "uncertain-1");
      assert.strictEqual(job.status, "SUBMITTING", "the durable job is not touched to make the board easier to draw");
      assert(!job.externalId, "and no provider handle is invented");

      /* THE REBUILD HAPPENED — this is not a test that repair was skipped. */
      const rebuilt = h.durable().coverage[0];
      assert(rebuilt, "the missing projection IS reconstructed; recovery is not abandoned");
      assert(rebuilt.rebuiltFromJobAt, "and it is marked as a reconstruction rather than a dispatch's own record");
      assert(rebuilt.jobs.includes("uncertain-1"), "carrying the job it was rebuilt from");
      assert.notStrictEqual(rebuilt.status, "sheet-running",
        `THE DEFECT: a reconstruction from an uncertain row must not present it as an ordinary running sheet: ${JSON.stringify(rebuilt)}`);
      assert.strictEqual(rebuilt.status, "needs-attention", "it asks for the person it needs");
      assert(rebuilt.needsAttentionAt, "and is stamped like every other record that wants attention");

      /* And the block is still held, which is the property none of this may cost. */
      /* THE BILL. Both established duplicate mechanisms, exactly as reproduction 15e
         exercises them: an identical coverage target REATTACHES to the uncertain job,
         and a target the duplicate guard does not match is REFUSED by the unresolved
         twin guard. Neither may submit anything. */
      const retry = await h.coverage({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "angles",
        clientRequestId: "a-different-press",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert(retry.status === 200 && retry.data.reused === true && retry.data.duplicatePrevented === true,
        `an identical coverage target reattaches to the uncertain job: ${retry.status} ${JSON.stringify(retry.data)}`);
      assert.strictEqual(retry.data.job.id, "uncertain-1", "naming the job that is already uncertain");

      const twin = await h.coverage({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
        references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "expressions",
        clientRequestId: "a-third-press",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert.strictEqual(twin.status, 409, `and a differing target is refused outright: ${JSON.stringify(twin.data)}`);
      assert.strictEqual(twin.data.code, "GENERATION_UNRESOLVED", "through the existing uncertainty guard");
      assert.strictEqual(h.calls.length, 0, "ZERO provider submissions");
      assert.strictEqual(h.durable().jobs.length, 1, "and no second generation row");
      note(`15g. refresh over an uncertain SUBMITTING/no-handle job whose coverage record was lost rebuilds the record as needs-attention rather than sheet-running, leaves the job SUBMITTING with no invented handle, contacts no provider, and still refuses the equivalent retry — 0 provider submissions and 1 job row`);
    } finally { h.close(); }
  }

  console.log("");
  console.log("PAID REQUEST TRUTH — the money boundary enforces the request:");
  for (const line of notes) console.log(`  - ${line}`);
  console.log("  - 0 provider calls outside the local mock, 0 paid calls, nothing written to any project on disk");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

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
const { referenceAspectLabel } = require("../public/shared-aspect");

/* THE FORMAT A COVERAGE DISPATCHER SENDS, read the way the dispatcher reads it.
 *
 * public/coverage-automation.js decides it two different ways and this stands in for both:
 * a SHEET is a contact sheet whose format belongs to the operation (an expression sheet is
 * 4:3, an angle sheet 16:9), while SLOT work is an entity card and takes the list's own
 * format from the shared resolver. Derived here rather than written out so a fixture
 * cannot quietly stand in for a screen that does not exist — which is exactly what a
 * hard-coded 16:9 on a characters entity was doing before the boundary checked. */
const coverageAspectFor = (body) => (String(body?.coverageJobType || "") === "sheet"
  ? (String(body?.coverageSheetType || "") === "expressions" ? "4:3" : "16:9")
  : referenceAspectLabel(String(body?.entityList || "")));
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
  /* A provider that is reachable and refuses. Still loopback; still nothing paid. */
  mock.put("/cancel-503/:id", (req, res) => { cancelCalls.push(req.params.id); res.status(503).json({ detail: "provider unavailable" }); });
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

  /* THE PERMIT A DIALOG WOULD HAVE OBTAINED, from the shipped issuance route on this
     harness's own server. Exposed on its own so a section about permits can mint one
     deliberately - for a scope that does not match, or twice, or not at all. */
  const permitFor = async (scope) => {
    const response = await fetch(`${appOrigin}/api/generation/paid-permit`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scope),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  /* RAW IN THE BODY, REAL IN THE PERMIT. This suite is the one place that must be able to
     post an UNDECLARED body, and since the paid dispatch permit that is two separate
     things a request can be missing. Keeping them separate is the point: a body with no
     declaration but a valid permit still has to be refused by the PLAN gate, which is what
     reproduction 1 is about, and it could not prove that if the permit gate answered
     first for a different reason.

     So the permit is minted from a scope the issuance route will accept - the body's own
     declaration where it has one, a stamped one where it does not - and the body itself is
     posted exactly as written. `options.permit` opts out entirely, for the sections that
     are about the permit rather than about what it protects. */
  const post = async (body, options = {}) => {
    let sent = body;
    if (options.permit !== false && body && typeof body === "object" && !body.paidPermitId) {
      const scope = declaredGenerationBody(body);
      const issued = await permitFor({
        generationRequest: scope?.generationRequest,
        purpose: body.purpose, shotId: body.shotId, frameId: body.frameId,
        entityList: body.entityList, entityId: body.entityId,
        sourceBuildId: body.sourceBuildId, outputCount: body.outputCount,
      });
      assert(issued.data?.paidPermitId, `the harness could not obtain a dispatch permit: ${JSON.stringify(issued.data)}`);
      sent = { ...body, paidPermitId: issued.data.paidPermitId };
    }
    const response = await fetch(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sent),
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
    dir, file, calls, cancelCalls, post, permitFor, runs, settle, appOrigin,
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
    jobs: async () => {
      const response = await fetch(`${appOrigin}/api/generation/fal/jobs`);
      return (await response.json()).jobs || [];
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
    /* THE COVERAGE DISPATCHER'S OWN QUOTE, stamped the way tests/generation-request-
       fixture.js stamps a declaration and for the same reason: a fixture standing in for
       public/coverage-automation.js has to send what that file sends. Every press it makes
       carries `coverageRequestCount` and `coverageMaximumImages` — the two figures the
       dialog showed the filmmaker — and since coverageSubmissionError() those are what the
       money boundary holds the rest of the run to.

       DELIBERATELY LARGER THAN ANY SECTION'S TRAFFIC. A stamp is not the thing under test:
       a default tight enough to bind would answer for the concurrency cap, the duplicate
       guard and the durability seams before those gates could, and each of those sections
       would go on passing while proving something narrower than it says. The sections that
       ARE about the bound pass their own figures and override this. */
    coverage: async (body) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/coverage/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coverageRequestCount: 8, coverageMaximumImages: 32, ...body }),
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
     4b. THE STRIP CANNOT BE UNDONE THROUGH THE PROTOTYPE CHAIN.

     Reproduction 3 proves the gate deletes the key. It deletes an OWN property, and for
     as long as the copy was written with `out[key] = body[key]` that was not the same
     thing as the value being gone: a body is JSON the caller wrote, `__proto__` parses to
     an ordinary own member, and assigning it invokes Object.prototype's setter instead of
     storing it. The deleted control was then readable again on the very next line.

     What made it worth a reproduction of its own rather than a note on 3 is the receipt.
     `removed` is computed from own keys, so the row recorded `removedPayloadKeys:
     ["resolution"]` under `viewMode: "simple"` while 4K went to the provider — the gate
     reporting a strip it had not performed. The two assertions below are therefore about
     different things: what the adapter received, and whether the ledger told the truth
     about it. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const simpleDeclaration = Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" });
      /* The baseline, so "not 4K" is not mistaken for proof — a third value nobody chose
         would satisfy that just as well. This is where a Simple request lands. */
      const bare = await h.post({ ...framePlanBody(buildId, { clientRequestId: "proto-bare" }), generationRequest: simpleDeclaration });
      assert.strictEqual(bare.status, 200, `a Simple request carrying no size: ${JSON.stringify(bare.data)}`);
      const bareSize = JSON.stringify(h.calls[0].body.image_size);
      await h.settle(bare.data.job.id);

      /* Spread rather than a `__proto__:` literal on purpose. A literal key sets the
         prototype and would never survive JSON.stringify, so the body would arrive
         WITHOUT the member and the reproduction would pass while testing nothing. Parsed
         from text, it is an own member — exactly what express's body parser produces. */
      const smuggled = await h.post({
        ...framePlanBody(buildId, { clientRequestId: "proto-smuggled" }),
        ...JSON.parse('{"__proto__":{"resolution":"4k"}}'),
        generationRequest: simpleDeclaration,
      });
      assert.strictEqual(smuggled.status, 200, `the request is accepted, not refused: ${JSON.stringify(smuggled.data)}`);
      assert.strictEqual(h.calls.length, 2, "and it genuinely reaches the adapter, so the size below is a dispatched one");
      const smuggledSize = JSON.stringify(h.calls[1].body.image_size);
      assert.strictEqual(smuggledSize, bareSize,
        `a resolution supplied on the prototype must land exactly where a request carrying no resolution lands, not on 4K (received ${smuggledSize}, expected ${bareSize})`);

      /* THE RECEIPT AGREES WITH THE DISPATCH. The failure this guards against was not
         only over-spend; it was a row that recorded the strip either way. */
      const row = h.ledger().find((item) => item.clientRequestId === "proto-smuggled");
      assert.strictEqual(row.generationViewMode, "simple", "the row records the view it was judged under");
      assert.strictEqual(JSON.stringify({ width: Number(String(row.resolution).split("x")[0]), height: Number(String(row.resolution).split("x")[1]) }), smuggledSize,
        "and the size recorded on the row must be the size the adapter received");

      /* The route must not have been polluted globally either — a leaked prototype write
         would have made every later object in this process answer for `resolution`. */
      assert.strictEqual(({}).resolution, undefined, "no object in this process may have gained a resolution");
      note(`4b. a Simple request smuggling resolution:"4k" as a __proto__ member reaches the adapter at ${smuggledSize} — the same size a request carrying no resolution lands on — the row records that size rather than the one it was refused, and Object.prototype is untouched`);
    } finally { h.close(); }
  }

  /* =======================================================================
     4c. THE OTHER FACTOR OF THE SIZE.

     Reproductions 3 and 4b are about `resolution`, which the plan governs. They were half
     a guarantee, because the provider's image_size has two factors and the plan could not
     reach the other one: `aspectRatio` is declared in the control vocabulary but is in no
     image surface's `only` list, and the image capabilities declare no aspectRatios — so
     the row is filtered out of plan.controls and restrictPayloadToPlan has nothing to
     govern. It survived the gate on every image surface in both views.

     It is not a label. The compiled path lets it overwrite the shot's compiled spec and
     the uncompiled path computes width and height from it, so a Simple request that could
     not ship 4K could still ship a square. No dialog offers it — every one derives it from
     the production format — so it is a route input, and this is it being treated as one. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const declaration = Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" });
      const production = h.project().meta.aspectRatio;
      assert.strictEqual(production, "16:9", "the fixture production must declare a format for this to be about anything");

      /* A. A FORMAT NOTHING ASKED FOR IS REFUSED, before the row and before the provider. */
      const square = await h.post({ ...framePlanBody(buildId, { clientRequestId: "square", aspectRatio: "1:1" }), generationRequest: declaration });
      assert.strictEqual(square.status, 409, `a request naming a format the production does not deliver is refused: ${JSON.stringify(square.data)}`);
      assert.strictEqual(square.data.code, "GENERATION_ASPECT_MISMATCH", "typed as its own refusal");
      assert.strictEqual(square.data.entitledAspectRatio, "16:9", "naming what this shot is entitled to");
      assert.strictEqual(square.data.providerContacted, false, "with the pre-provider evidence every refusal on this route carries");
      assert.strictEqual(h.calls.length, 0, "NO provider call");
      assert.strictEqual(h.ledger().length, 0, "and NO ledger row");

      /* B. NAMING NOTHING IS NOT REFUSED — it lands on the entitled format, which is where
            every dialog was sending it anyway. The rule modelIdentityRefusal already
            applies: a request that names nothing has a truthful fallback. */
      const unnamed = { ...framePlanBody(buildId, { clientRequestId: "unnamed" }) };
      delete unnamed.aspectRatio;
      const unnamedResult = await h.post({ ...unnamed, generationRequest: declaration });
      assert.strictEqual(unnamedResult.status, 200, `naming no format must dispatch: ${JSON.stringify(unnamedResult.data)}`);
      const unnamedRow = h.ledger().find((row) => row.clientRequestId === "unnamed");
      assert.strictEqual(unnamedRow.aspectRatio, "16:9", "on the format the production entitles it to, not a literal");
      await h.settle(unnamedResult.data.job.id);

      /* C. AND NAMING THE ENTITLED ONE — what every shipped dispatcher sends — still
            dispatches, to the identical size. The gate must be a check, not a narrowing. */
      const named = await h.post({ ...framePlanBody(buildId, { clientRequestId: "named", aspectRatio: "16:9" }), generationRequest: declaration });
      assert.strictEqual(named.status, 200, `naming the entitled format must dispatch: ${JSON.stringify(named.data)}`);
      assert.strictEqual(JSON.stringify(h.calls[1].body.image_size), JSON.stringify(h.calls[0].body.image_size),
        "and reach the adapter at exactly the size the request that named nothing did");

      /* D. A SHOT THAT DECLARES ITS OWN FORMAT OVERRIDES THE PRODUCTION, because
            shotAspectLabel reads the shot's override first — so the entitlement follows
            the shot rather than a project-wide literal. */
      await h.settle(named.data.job.id);
      const overridden = h.project();
      overridden.shots[0].creationBrief = { ...(overridden.shots[0].creationBrief || {}), composition: { aspectRatio: "2.39:1" } };
      h.saveProject(overridden);
      const wide = await h.post({ ...framePlanBody(buildId, { clientRequestId: "wide", aspectRatio: "2.39:1" }), generationRequest: declaration });
      assert.strictEqual(wide.status, 200, `the shot's own declared format is what it is entitled to: ${JSON.stringify(wide.data)}`);
      const stillSixteenNine = await h.post({ ...framePlanBody(buildId, { clientRequestId: "stale-format", aspectRatio: "16:9" }), generationRequest: declaration });
      assert.strictEqual(stillSixteenNine.status, 409, `and the production's format is now the wrong one for this shot: ${JSON.stringify(stillSixteenNine.data)}`);
      assert.strictEqual(stillSixteenNine.data.entitledAspectRatio, "2.39:1", "named from the shot's own declaration");
      note(`4c. aspectRatio is the second factor of image_size and no image dialog offers it: a compiled-frame request naming 1:1 on a 16:9 production is refused GENERATION_ASPECT_MISMATCH with no provider call and no ledger row, one naming nothing lands on the entitled 16:9, one naming 16:9 reaches the adapter at the identical size, and a shot declaring 2.39:1 moves the entitlement to 2.39:1`);
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

      /* AND IT IS THE PACKAGE THAT IS REFUSED, NOT THE STRING THAT NAMED IT.
       *
       * The gate keys off job.sourceBuildId, and two ways of referring to the very same
       * package used to miss it entirely — each producing a dispatch where the assertion
       * above produces a 409, on identical project state.
       *
       * OMITTED. sourceBuildId was never a required field, and both compilers read an
       * empty one as "this shot's last usable build" — so leaving the key out compiled and
       * dispatched V1 while the gate returned null without comparing anything. */
      const omitted = { ...framePlanBody(buildId, { clientRequestId: "v1-omitted" }) };
      delete omitted.sourceBuildId;
      const omittedResult = await h.post(declaredGenerationBody(omitted));
      assert.strictEqual(omittedResult.status, 409,
        `naming no package must be refused for the package the route would compile: ${JSON.stringify(omittedResult.data)}`);
      assert.strictEqual(omittedResult.data.code, "GENERATION_PACKAGE_STALE", "with the same typed refusal");
      assert.strictEqual(h.calls.length, 1, "and no provider call");

      /* BY packageId. promptBuildsById is keyed by `id || packageId`, so a guided build
         with both is reachable under one key and not the other — and image-execution.js
         matches all three of id/buildId/packageId, so the compiler found V1 while the
         resolver reported it missing and the gate returned null. */
      const alias = pack.packageId;
      assert(alias && alias !== buildId, "the fixture must give the package a packageId distinct from its key, or this proves nothing");
      const byPackageId = await h.post(declaredGenerationBody(framePlanBody(alias, { clientRequestId: "v1-by-package-id" })));
      assert.strictEqual(byPackageId.status, 409,
        `naming the same package by its packageId must be refused exactly as its id is: ${JSON.stringify(byPackageId.data)}`);
      assert.strictEqual(byPackageId.data.code, "GENERATION_PACKAGE_STALE", "with the same typed refusal");
      assert.strictEqual(h.calls.length, 1, "and no provider call");

      /* A NAME THAT BELONGS TO NOTHING IS STILL A MISS. The alias must not have turned
         the resolver into something that finds a package for any string. */
      const unknown = await h.post(declaredGenerationBody(framePlanBody("no-such-package", { clientRequestId: "v1-unknown" })));
      assert.strictEqual(unknown.status, 404, `an unknown package is still not found: ${JSON.stringify(unknown.data)}`);
      assert.strictEqual(h.calls.length, 1, "and no provider call");

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
      note("8. a package whose shot has moved on is refused at the money boundary with GENERATION_PACKAGE_STALE naming \"approved frame changed\" and its evidence scope — and refused identically when the request names that package by its packageId or names no package at all, the two ways of reaching the same compile that used to skip the comparison entirely; an unknown name is still a 404, and rebuilding the snapshot makes the same request dispatch");
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
        /* 3:4, because that is what the shipped entity-reference dispatcher sends for a
           characters entity — referenceAspectLabel("characters"). A character anchor is a
           full-body portrait and has never been the production delivery format. This
           fixture stands in for that dispatcher, so a 16:9 here would be standing in for
           a screen that does not exist, and the boundary now says so. */
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "3:4", ...extra,
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
        /* A sheet is a contact sheet, not an entity card: the OPERATION decides its
           format, and an angle sheet is 16:9 — which is what the coverage dispatcher
           sends and what the route's own trusted descriptor entitles it to. */
        aspectRatio: "16:9",
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
      const coverageBody = (extra) => {
        /* Merged first, because the format follows the job type and half these callers
           override it to `slot` — a default computed before the override would send an
           angle sheet's 16:9 on entity-card work. */
        const merged = { coverageJobType: "sheet", coverageSheetType: "angles", entityList: "characters", ...extra };
        return {
          purpose: "entity-reference", entityId: "KAI", entityType: "character",
          sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
          references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
          outputCount: 1, quality: "high", resolution: "4k",
          aspectRatio: coverageAspectFor(merged),
          generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
          ...merged,
        };
      };
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
      /* F. THE SAME TABLE, WITH THE OTHER HALF LEFT OUT.
       *
       * E sends both halves, so on its own it proves the check only for requests that
       * happen to carry a model id — and omitting one was the way past it: the guard was
       * scoped to `claimed && optionId`, so a lone option id was recorded by
       * applyRequestTruth and asked nothing. Mintability never needed the model half to
       * answer, which is what made the old scope a gap rather than a limitation. */
      for (const [optionId, reason, description] of IMPOSSIBLE) {
        const alone = await send(optionId, "", `lone-${reason}-${optionId.length}`);
        assert.strictEqual(alone.status, 409, `${description}, named alone, must be refused: ${JSON.stringify(alone.data)}`);
        assert.strictEqual(alone.data.code, "GENERATION_OPTION_IDENTITY_INVALID", `${description} alone: typed as an identity refusal`);
        assert.strictEqual(alone.data.reason, reason, `${description} alone: refused for the right reason`);
      }
      assert.strictEqual(h.calls.length, before, "and none of them reached the provider");
      assert.strictEqual(h.ledger().filter((row) => IMPOSSIBLE.some(([id]) => row.selectedOptionId === id)).length, 0,
        "and none of them was recorded as an option a filmmaker chose, named alone or in a pair");

      /* AND THE WIDENING THAT WAS NOT DONE. A lone option id CineBraid COULD have minted
         still dispatches on the route's own configured model rather than deriving one
         from the option — refusing an impossible id is not the same decision as letting a
         selection choose what to buy, and only the first belongs to this boundary. */
      const loneReal = await send(OPTION_A, "", "lone-real");
      assert.strictEqual(loneReal.status, 200, `a mintable option named alone must still dispatch: ${JSON.stringify(loneReal.data)}`);
      const loneRow = h.ledger().find((row) => row.clientRequestId === "lone-real");
      assert.strictEqual(loneRow.selectedOptionId, OPTION_A, "recording the option it named");
      assert.strictEqual(loneRow.selectedModelId, "", "claiming no model");
      assert.strictEqual(loneRow.model, "openai/gpt-image-2/edit", "and dispatching the route's own configured endpoint, not one derived from the option");
      note(`16. ${IMPOSSIBLE.length} well-formed but impossible option identities are each refused for their own catalogue reason with no dispatch and no ledger row — whether they arrive beside a model id or alone; B-option + A-model is refused with GENERATION_OPTION_MODEL_MISMATCH naming ${MODEL_B}; A/A dispatches and records both, B/B keeps its existing route refusal, both-absent keeps the legacy fallback, and a mintable option named alone still dispatches on the route's configured model rather than deriving one`);
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
     15i. AND IT HAS TO BE REACHABLE FROM THE SCREEN THE WORK IS ON.

     15h put the server's answer on the wire and the frame and H3 strips read it. The
     entity/coverage strip did not: falEntityGenerationInline() had no uncertainty branch
     at all, so it asked falJobActive(), which counts SUBMITTING, and drew a submission
     nobody could account for as ordinary running work — "Submitting", a Refresh, and a
     Cancel the route refuses. The one control that state has was never rendered, so on
     the screen where reference and coverage work actually lives, the way out did not
     exist.

     This runs the shipped browser source rather than asserting on its text: the module is
     evaluated and the renderer is called, so what is asserted is the markup a filmmaker
     would be looking at. */
  {
    const vm = require("vm");
    const escape = (value) => String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const sandbox = {
      window: {}, console, CONFIG: { generation: { fal: { enabled: true, apiKey: "k" } } },
      FAL_GENERATION_JOBS: [], esc: escape, attr: escape, fetch: async () => ({ ok: true, json: async () => ({}) }),
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "fal-generation.js"), "utf8"), sandbox, { filename: "public/fal-generation.js" });
    assert.strictEqual(typeof sandbox.falEntityGenerationInline, "function",
      "the shipped renderer must actually be reachable, or this proves nothing about it");

    const render = (job) => {
      sandbox.FAL_GENERATION_JOBS = [job];
      return sandbox.falEntityGenerationInline("characters", "KAI");
    };
    const base = {
      id: "job-1", purpose: "entity-reference", entityList: "characters", entityId: "KAI",
      model: "gpt-image-2", outputCount: 4, createdAt: "2026-08-28T00:00:00.000Z",
    };

    /* THE DEFECT. Exactly the state the reviewer persisted. */
    const uncertain = render({ ...base, status: "SUBMITTING", uncertain: true });
    assert(uncertain.includes("Check and resolve"),
      `THE DEFECT: an uncertain submission must offer the reconciliation control on this screen too: ${uncertain}`);
    assert(uncertain.includes("openFalUnresolvedModal"), "reaching the EXISTING dialog, not a second recovery flow");
    assert(!uncertain.includes("cancelFalGeneration"), "and it must not offer a Cancel the route refuses");
    assert(!uncertain.includes("refreshFalGeneration"), "nor a Refresh that answers with the same uncertainty");
    assert(uncertain.includes("fal-job-strip unresolved"), "and it is drawn as unresolved rather than active");

    /* IT IS THE SAME EXPERIENCE THE OTHER STRIPS DRAW — the reviewer asked for reuse, so
       this compares the renderers rather than describing them. */
    sandbox.FAL_GENERATION_JOBS = [{ ...base, purpose: "frame", shotId: "SH-1", status: "SUBMITTING", uncertain: true }];
    const frame = sandbox.falGenerationInline("SH-1", "frame");
    for (const token of ["fal-job-strip unresolved", "Check and resolve", "openFalUnresolvedModal"]) {
      assert(frame.includes(token) && uncertain.includes(token),
        `the entity strip must use the frame strip's own uncertainty controls, not new ones (${token})`);
    }

    /* AND EVERY STRIP THAT DRAWS A PAID JOB, not the two that happened to be reported.
       The candidate-correction modal in review-provenance.js is the fourth, and it had
       the identical omission. Asserted on the SOURCE OF EVERY MATCH so a fifth renderer
       added later cannot quietly reintroduce this: each `fal-job-strip` template must
       carry an unresolved arm. */
    for (const file of ["public/fal-generation.js", "public/review-provenance.js"]) {
      const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r\n/g, "\n");
      for (const line of source.split("\n").filter((row) => row.includes('class="fal-job-strip'))) {
        assert(/\$\{unknown \? "unresolved"/.test(line),
          `every strip that draws a paid generation job must have an uncertainty arm — ${file}: ${line.trim().slice(0, 90)}`);
        assert(line.includes("openFalUnresolvedModal"),
          `and must reach the existing reconciliation dialog — ${file}: ${line.trim().slice(0, 90)}`);
      }
    }

    /* AND ORDINARY HEALTHY WORK IS UNTOUCHED. */
    const healthy = render({ ...base, status: "SUBMITTING", externalId: "req-1", uncertain: false });
    assert(healthy.includes("refreshFalGeneration") && healthy.includes("cancelFalGeneration"),
      `a submission with a provider handle keeps its normal controls: ${healthy}`);
    assert(!healthy.includes("Check and resolve"), "and is not presented as needing a person");
    const queued = render({ ...base, status: "IN_QUEUE", externalId: "req-1", uncertain: false });
    assert(queued.includes("refreshFalGeneration") && queued.includes("cancelFalGeneration"), "ordinary queued work is unchanged");
    const done = render({ ...base, status: "COMPLETED", externalId: "req-1", uncertain: false, ingestedAt: "t" });
    assert(!done.includes("Check and resolve") && !done.includes("cancelFalGeneration"), "completed work is unchanged");
    assert(done.includes("fal-job-strip done"), "and still reads as delivered");
    const failed = render({ ...base, status: "FAILED", uncertain: false, error: "the provider declined" });
    assert(failed.includes("Try again") && !failed.includes("Check and resolve"), "an ordinary failure keeps Try again");
    const settled = render({ ...base, status: "FAILED", uncertain: false, reconciliation: { outcome: "not-accepted" } });
    assert(!settled.includes("Check and resolve"), "and a job a person already settled is not asked about again");

    /* THE BOUNDED CONSISTENCY CHECK, at the third place that answered this by status. */
    const CreatorState = require("../public/shared-creator-state");
    assert.deepStrictEqual(
      CreatorState.creatorJobKind({ status: "SUBMITTING", active: true, uncertain: true }),
      { kind: "needs-attention", reason: "submission-unresolved" },
      "the activity classifier must not bucket an uncertain submission as a machine at work",
    );
    assert.strictEqual(CreatorState.creatorJobKind({ status: "SUBMITTING", active: true, uncertain: false }).kind, "machine-active",
      "while ordinary in-flight work is still a machine at work");
    assert.strictEqual(CreatorState.creatorJobKind({ status: "UNRESOLVED", active: false }).reason, "submission-unresolved",
      "and the existing status arm still stands on its own");
    note(`15i. falEntityGenerationInline() renders SUBMITTING+uncertain with the frame strip's own unresolved class, explanation and "Check and resolve" control instead of Refresh/Cancel — proved by evaluating the shipped browser source and comparing the two renderers — while SUBMITTING-with-handle, IN_QUEUE, COMPLETED, FAILED and reconciled work render exactly as before; all FOUR fal-job-strip renderers now carry an uncertainty arm reaching the one existing dialog, and creatorJobKind() stops bucketing an uncertain submission as machine-active`);
  }

  /* =======================================================================
     15j. A CANCELLATION THE PROVIDER DID NOT CONFIRM IS NOT A CANCELLATION.

     The response was discarded outright — `.catch(() => null)`, nothing read — so a 503,
     a 404 and a dropped connection all reached the same write, and CANCELLED was
     persisted for a render that may still be running and still be charged. A CANCELLED
     job does not block resubmission, so a failed cancel handed the filmmaker permission
     to buy the same shot again.

     The criterion is `response.ok`, which is what this module already treats as a usable
     provider answer everywhere else. */
  {
    const h = await harness();
    try {
      const mockOrigin = h.mockOrigin;
      const project = h.project();
      project.characters.push({
        id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [],
        coverageAutomation: { id: "coverage:characters:KAI:run", list: "characters", entityId: "KAI", mode: "sheet", sheetType: "angles", status: "sheet-running", startedAt: "2026-08-28T00:00:00.000Z", jobs: ["refusing-cancel"] },
      });
      h.saveProject(project);
      const COVERAGE = {
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        coverageJobType: "sheet", coverageSheetType: "angles", sourceBuildId: "entity-fixture",
        outputCount: 1, prompt: "Kai against neutral grey.", createdAt: "2026-08-28T00:00:00.000Z",
      };
      h.seedLedger([
        /* A. reachable provider that refuses. */
        { ...COVERAGE, id: "refusing-cancel", provider: "fal", status: Lifecycle.UNRESOLVED, clientRequestId: "original-press", externalId: "req-a", statusUrl: `${mockOrigin}/status/req-a`, cancelUrl: `${mockOrigin}/cancel-503/req-a` },
        /* B. a provider that cannot be reached at all. */
        { id: "unreachable", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: Lifecycle.UNRESOLVED, externalId: "req-b", cancelUrl: "http://127.0.0.1:9/cancel/req-b", createdAt: "2026-08-28T00:00:00.000Z" },
        /* C. the ordinary successful cancel. */
        { id: "cancellable", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "IN_QUEUE", externalId: "req-c", statusUrl: `${mockOrigin}/status/req-c`, cancelUrl: `${mockOrigin}/cancel/req-c`, createdAt: "2026-08-28T00:00:00.000Z" },
      ]);

      /* A. PROVIDER 503. */
      const refused = await h.cancel("refusing-cancel");
      assert.strictEqual(refused.status, 502,
        `THE DEFECT: CineBraid must not report a cancellation the provider refused: ${JSON.stringify(refused.data)}`);
      assert.strictEqual(refused.data.code, "GENERATION_CANCEL_UNCONFIRMED", "with a typed refusal");
      assert(/provider unavailable/.test(refused.data.error), "carrying the provider's own words through the existing normaliser");
      assert.strictEqual(h.cancelCalls.filter((id) => id === "req-a").length, 1, "the provider was contacted exactly once");
      let row = h.durable().jobs.find((item) => item.id === "refusing-cancel");
      assert.notStrictEqual(row.status, "CANCELLED", `and the durable job must not be terminalized: ${JSON.stringify(row.status)}`);
      assert.strictEqual(row.status, Lifecycle.UNRESOLVED, "it is left in the state it was truthfully in");
      assert.strictEqual(Lifecycle.blocksResubmission(row), true, "still holding the duplicate block");
      assert.strictEqual(h.durable().coverage[0].status, "sheet-running",
        "and the projection is not moved either — the job did not change, so neither did what describes it");

      /* B. TRANSPORT FAILURE. */
      const unreachable = await h.cancel("unreachable");
      assert.strictEqual(unreachable.status, 502, `an unreachable provider is not a cancellation either: ${JSON.stringify(unreachable.data)}`);
      assert.strictEqual(unreachable.data.code, "GENERATION_CANCEL_UNCONFIRMED", "with the same typed refusal");
      assert.strictEqual(h.durable().jobs.find((item) => item.id === "unreachable").status, Lifecycle.UNRESOLVED,
        "and the job is untouched");

      /* C. THE SUCCESSFUL CANCEL STILL WORKS — the correction must not make cancelling
            impossible, which is the obvious way to "fix" this and be wrong. */
      const cancelled = await h.cancel("cancellable");
      assert.strictEqual(cancelled.status, 200, `a provider-confirmed cancellation still succeeds: ${JSON.stringify(cancelled.data)}`);
      assert(h.cancelCalls.includes("req-c"), "with the provider contacted exactly as before");
      assert.strictEqual(h.durable().jobs.find((item) => item.id === "cancellable").status, "CANCELLED",
        "and CANCELLED persisted, because this time the provider confirmed it");

      /* THE CHAIN THE REVIEWER REQUIRED: a failed cancel must not become permission. */
      const retry = await h.coverage({
        ...COVERAGE, references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        quality: "high", resolution: "4k", aspectRatio: "16:9", clientRequestId: "a-different-press",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
      });
      assert.strictEqual(retry.status, 409, `the equivalent request is still refused after a failed cancel: ${JSON.stringify(retry.data)}`);
      assert.strictEqual(retry.data.code, "GENERATION_UNRESOLVED", "through the existing uncertainty guard");
      assert.strictEqual(h.calls.length, 0, "ZERO provider generation submissions across the whole chain");
      assert.strictEqual(h.durable().jobs.length, 3, "and no fourth job row — nothing new was created");
      row = h.durable().jobs.find((item) => item.id === "refusing-cancel");
      assert.strictEqual(row.status, Lifecycle.UNRESOLVED, "the original job is still exactly what it was");
      note(`15j. a cancellation the provider refused (503) or could not be asked for (transport failure) is answered 502 GENERATION_CANCEL_UNCONFIRMED and leaves the durable job and its coverage record untouched, still blocking — while a provider-confirmed cancel still contacts the provider and still persists CANCELLED; the failed-cancel-then-equivalent-retry chain produces 0 provider generation submissions and no new job row`);
    } finally { h.close(); }
  }

  /* =======================================================================
     15h. THE WAY OUT HAS TO BE REACHABLE.

     Found while auditing who else interprets this state. The browser was deciding for
     itself which jobs CineBraid cannot account for — its `falJobUnresolved()` asked only
     whether the status was UNRESOLVED — so a durable SUBMITTING row with no request id
     was drawn as an ordinary running job. It offered Cancel, which reproduction 15f shows
     the route now refuses, and it never offered the reconciliation dialog, which is that
     state's only exit. A filmmaker was told to go and record what they found, and given
     nothing to record it with.

     The screen no longer decides. Every job it draws arrives through publicJob(), and
     publicJob() states the lifecycle's answer. This asserts the wire, which is the part a
     Node suite can see; the browser's own read of it is one field. */
  {
    const h = await harness();
    try {
      const mockOrigin = h.mockOrigin;
      h.seedLedger([
        { id: "in-flight-no-handle", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "SUBMITTING", createdAt: "2026-08-28T00:00:00.000Z" },
        { id: "classified-no-handle", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: Lifecycle.UNRESOLVED, createdAt: "2026-08-28T00:00:00.000Z" },
        /* Uncertain, but WITH a handle: still something CineBraid cannot account for, and
           it has always been offered the same dialog. */
        { id: "classified-with-handle", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: Lifecycle.UNRESOLVED, externalId: "req-u", statusUrl: `${mockOrigin}/status/req-u`, createdAt: "2026-08-28T00:00:00.000Z" },
        { id: "healthy", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "IN_QUEUE", externalId: "req-h", statusUrl: `${mockOrigin}/status/req-h`, createdAt: "2026-08-28T00:00:00.000Z" },
        { id: "settled", provider: "fal", purpose: "shot-frame", shotId: "SH-1", status: "FAILED", createdAt: "2026-08-28T00:00:00.000Z", reconciliation: { outcome: "not-accepted", previousStatus: "SUBMITTING", at: "2026-08-28T00:00:00.000Z", by: "user" } },
      ]);
      const byId = Object.fromEntries((await h.jobs()).map((job) => [job.id, job]));
      assert.strictEqual(byId["in-flight-no-handle"].uncertain, true,
        "THE DEFECT: a submission stranded with no request id must reach the screen as uncertain, or it is drawn as ordinary running work with no way out");
      assert.strictEqual(byId["classified-no-handle"].uncertain, true, "and so must a classified one");
      assert.strictEqual(byId["classified-with-handle"].uncertain, true,
        "including one that has a handle — a handle says the request was accepted, never what became of it");
      assert.strictEqual(byId.healthy.uncertain, false, "while an ordinary queued job is not uncertain");
      assert.strictEqual(byId.settled.uncertain, false, "and a job a person has already settled is not uncertain either");
      for (const id of Object.keys(byId)) {
        assert.strictEqual(byId[id].uncertain, Lifecycle.blocksResubmission(byId[id]),
          `and the wire says exactly what the lifecycle says, for ${id} — not an approximation of it`);
      }
      assert.strictEqual(h.calls.length, 0, "reading the job list submits nothing");
      note(`15h. publicJob() states the lifecycle's own uncertainty on the wire, so the screen no longer decides it: a stranded SUBMITTING/no-handle row, a classified UNRESOLVED row and an UNRESOLVED row WITH a handle all arrive uncertain, while a queued job and a reconciled job do not — which is what puts the reconciliation dialog in front of both uncertainties instead of one`);
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

  /* =======================================================================
     20. A REFUSAL THAT REACHED NO PROVIDER IS NOT A PROVIDER FAULT.

     Batch 1B established that a deterministic local refusal must not be classified
     `provider`, because doing so misnames the fault AND spends an attempt from a budget
     the director authorised for real generation — the retry gate reads failureClass.

     It was written as a list of the two codes that existed then. This boundary emits nine
     now, and every one of them states `providerContacted: false` on the wire, so each new
     refusal silently inherited the `provider` default: a stale package or a met spend
     ceiling was written to the durable run as a provider fault, `providerContacted: true`,
     and Retry Failed Step spent an authorised attempt on a request that reached nothing.

     Two halves, asserted separately: that the boundary states the fact, and that the
     runner reads it. The second runs the shipped browser source rather than asserting on
     its text. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const declaration = Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "advanced" });

      /* THE BOUNDARY'S HALF. One refusal per family that can end a paid request before
         dispatch, each read off the wire rather than assumed. */
      const refusals = [];
      const collect = async (what, body) => {
        const result = await h.post(body);
        assert.strictEqual(result.status >= 400, true, `${what} must be a refusal: ${JSON.stringify(result.data)}`);
        assert.strictEqual(result.data.providerContacted, false, `${what} must state that no provider was contacted`);
        assert.strictEqual(result.data.paidRequestSubmitted, false, `${what} must state that nothing was submitted`);
        refusals.push({ what, data: result.data });
      };
      await collect("an undeclared body", framePlanBody(buildId, { clientRequestId: "pc-undeclared" }));
      await collect("a format nothing offered", { ...framePlanBody(buildId, { clientRequestId: "pc-aspect", aspectRatio: "1:1" }), generationRequest: declaration });
      await collect("an option identity CineBraid could not have minted", {
        ...framePlanBody(buildId, { clientRequestId: "pc-option" }),
        generationRequest: Presentation.generationRequestDeclaration({
          surface: "compiled-frame", viewMode: "advanced",
          selectedOptionId: `${IMAGE_MODEL_ID}::not-a-real-surface::not-a-real-mode`,
        }),
      });
      await collect("an automation run that does not exist", {
        ...framePlanBody(buildId, { clientRequestId: "pc-run" }),
        automationRunId: "no-such-run", automationStepKey: "step-1", automationRunnerId: "runner-1",
        generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
      });
      assert.strictEqual(h.calls.length, 0, "NONE of them reached the provider");
      assert.strictEqual(h.ledger().length, 0, "and none of them left a row");

      /* THE RUNNER'S HALF, on the shipped source. */
      const vm = require("vm");
      const sandbox = {
        window: {}, console,
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        setTimeout, clearTimeout, setInterval, clearInterval,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "automation.js"), "utf8"), sandbox, { filename: "public/automation.js" });
      assert.strictEqual(typeof sandbox.v626FailureClass, "function", "the shipped classifier must be reachable, or this proves nothing about it");
      assert.strictEqual(typeof sandbox.v626IsDeterministicLocalFailure, "function", "and so must the retry gate's own predicate");

      for (const { what, data } of refusals) {
        /* Shaped as the dispatcher shapes it: the fields it copies off the response. */
        const error = { code: data.code, classification: data.classification, providerContacted: data.providerContacted };
        assert.strictEqual(sandbox.v626FailureClass(error), "local-preflight",
          `${what} (${data.code}) must be classified local-preflight, not a provider fault`);
        assert.strictEqual(sandbox.v626IsDeterministicLocalFailure(error), true,
          `${what}: and must not spend an authorised attempt`);
      }

      /* AND THE OTHER DIRECTION, so this is a classifier and not a rubber stamp. A twin
         left unresolved DID reach a provider — the route does not claim otherwise — and a
         transport failure is a provider fault by definition. Both must stay `provider`, or
         a real spend would stop advancing the attempt counter. */
      assert.strictEqual(sandbox.v626FailureClass({ code: "GENERATION_UNRESOLVED" }), "provider",
        "an unresolved twin reached a provider and must still be classified as one");
      assert.strictEqual(sandbox.v626FailureClass({ message: "socket hang up" }), "provider",
        "and so must a transport failure");
      note(`20. all ${refusals.length} pre-provider refusal families state providerContacted:false on the wire with 0 provider calls and 0 ledger rows, and the shipped v626FailureClass reads that fact rather than a list of codes — each is local-preflight and spends no authorised attempt, while an unresolved twin and a transport failure are still provider faults`);
    } finally { h.close(); }
  }

  /* =======================================================================
     21. THE OTHER BOUNDED RUN: COVERAGE AUTOMATION, AND WHAT IT BELONGS TO.

     Reproductions 10 and 17-19 prove the automation runner cannot exceed the count or the
     spend one press authorised. Coverage automation is CineBraid's SECOND paid automation
     path and the one that most obviously multiplies a press into several paid requests —
     "generate missing slots individually" submits one per unfilled slot, three candidates
     each — and every one of those guards returned null for it, because they are keyed on
     `automationRunId` and a coverage job carries none.

     Bounding it was half the answer. An independent reviewer took the first version apart
     without touching a single number: with the bounded run's own job still IN_QUEUE, the
     same slot work resubmitted with a BLANK `coverageMode` was read as unrelated, escaped
     the bound, and REPLACED the live run — so the record of an authorisation with paid
     work still in flight was destroyed by a field the bounded work writes for itself.

     Membership is not a comparison of presentation fields any more. The coverage route
     decides which authorization a dispatch belongs to from its own run record and the
     board the results file against, mints that decision into a coverage-class permit, and
     the boundary reads it there. Every request below leaves the first job UNSETTLED,
     because "a live bounded authorization still holding paid work" is exactly the window
     the rule governs. */
  {
    const h = await harness();
    try {
      const project = h.project();
      project.characters = [{ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] }];
      h.saveProject(project);
      const runOf = () => h.project().characters[0].coverageAutomation;
      /* THE PRESS: one paid request, up to three images. The figures public/coverage-
         automation.js derives from missingCoverageWork() and prices in front of the
         filmmaker before the button. */
      const slot = (n, extra = {}) => ({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        prompt: "Kai from the requested angle.", references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 3, quality: "high", resolution: "4k", aspectRatio: referenceAspectLabel("characters"),
        coverageJobType: "slot", coverageSheetType: "", coverageMode: "individual",
        targetCoverageSlotId: `slot-${n}`, clientRequestId: `bounded-${n}`,
        coverageRequestCount: 1, coverageMaximumImages: 3,
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        ...extra,
      });

      const one = await h.coverage(slot(1));
      assert.strictEqual(one.status, 200, `the authorised request dispatches: ${JSON.stringify(one.data)}`);
      const established = runOf();
      assert.strictEqual(established.requestCount, 1, "and establishes the run with the count the press authorised");
      assert.strictEqual(established.maximumImages, 3, "and with its image ceiling");
      /* AND ITS DOLLAR CEILING, from the one owner that multiplies a rate by a quantity —
         three images at the configured $0.06. Not a figure the request supplied. */
      assert.strictEqual(established.maxSpend?.priced, true, `a configured rate prices the run: ${JSON.stringify(established.maxSpend)}`);
      assert.strictEqual(established.maxSpend.amount, 0.18, "three images at $0.06, from costEstimateFromRate()");
      assert.strictEqual(h.ledger()[0].status, "IN_QUEUE", "and its paid work is UNSETTLED, which is the window this rule governs");
      const RUN_JSON = JSON.stringify(established);
      const beforeSecond = h.calls.length;

      /* A. THE HONEST SECOND REQUEST is refused for the count it would break. */
      const honest = await h.coverage(slot(2));
      assert.strictEqual(honest.status, 409, `a second request exceeds the authorised count: ${JSON.stringify(honest.data)}`);
      assert.strictEqual(honest.data.code, "COVERAGE_REQUEST_CAP", "typed for the count it broke");
      assert(/authorised for 1 paid request/.test(String(honest.data.error)), `naming the figure approved: ${honest.data.error}`);
      assert.strictEqual(honest.data.providerContacted, false, "and states it reached no provider");
      assert.strictEqual(h.calls.length, beforeSecond, "PROVIDER INVOCATION COUNT ON REFUSAL = 0");

      /* B. THE REVIEWER'S REPRODUCTION, and the reason this section was rewritten.
         Byte-identical work with a BLANK coverageMode and no quote at all — the exact
         shape the per-slot control sends, which is what made it indistinguishable. It is
         refused for the SAME reason, and the live bounded run is untouched. */
      const reclassified = await h.coverage(slot(3, { coverageMode: "", coverageSheetType: "angles", coverageRequestCount: undefined, coverageMaximumImages: undefined }));
      assert.strictEqual(reclassified.status, 409,
        `reclassifying the same work must not detach it from the authorization: ${JSON.stringify(reclassified.data)}`);
      assert.strictEqual(reclassified.data.code, "COVERAGE_REQUEST_CAP", "and it is refused by the bound, not by a shape rule");
      assert.strictEqual(JSON.stringify(runOf()), RUN_JSON,
        `and the live bounded run must be BYTE-EQUIVALENT — it was previously replaced and destroyed: ${JSON.stringify(runOf())}`);
      assert.strictEqual(h.calls.length, beforeSecond, "still 0 provider calls");
      assert.strictEqual(h.ledger().length, 1, "and no second row was written");

      /* C. INCOMPATIBLE FILING WORK REFUSES TRUTHFULLY rather than replacing the run.
         An expression sheet files against a different board from the angle work in
         flight, so it cannot join this authorization — and it may not end it either. */
      const expression = await h.coverage(slot(4, { coverageJobType: "sheet", coverageSheetType: "expressions", aspectRatio: "4:3", coverageMode: "sheet", coverageRequestCount: 1, coverageMaximumImages: 1 }));
      assert.strictEqual(expression.status, 409, `incompatible filing work is refused: ${JSON.stringify(expression.data)}`);
      assert.strictEqual(expression.data.code, "COVERAGE_RUN_BUSY", "typed for the operation already running");
      assert(/angles/.test(String(expression.data.error)) && /expressions/.test(String(expression.data.error)),
        `naming both boards so the refusal is actionable: ${expression.data.error}`);
      assert.strictEqual(JSON.stringify(runOf()), RUN_JSON, "and the running authorization is untouched");
      assert.strictEqual(h.calls.length, beforeSecond, "PROVIDER INVOCATION COUNT ON REFUSAL = 0");

      /* D. THE IMAGE CEILING binds independently of the count. */
      const g = await harness();
      try {
        const p = g.project();
        p.characters = [{ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] }];
        g.saveProject(p);
        const tight = (n) => ({ ...slot(n), coverageRequestCount: 2, coverageMaximumImages: 4 });
        const firstTight = await g.coverage(tight(1));
        assert.strictEqual(firstTight.status, 200, `three of four images commit: ${JSON.stringify(firstTight.data)}`);
        const before = g.calls.length;
        const overImages = await g.coverage(tight(2));
        assert.strictEqual(overImages.status, 409, `and the second request would take it to six: ${JSON.stringify(overImages.data)}`);
        assert.strictEqual(overImages.data.code, "COVERAGE_IMAGE_CAP", "typed for the ceiling it broke, not the count — the count still allows it");
        assert(/would take it to 6/.test(String(overImages.data.error)), `naming the projection: ${overImages.data.error}`);
        assert.strictEqual(g.calls.length, before, "PROVIDER INVOCATION COUNT ON REFUSAL = 0");
      } finally { g.close(); }

      /* E. AND WHAT THIS DELIBERATELY DOES NOT DO: manufacture a bound for a press that
         never quoted one. The per-slot control on the coverage board sends a single
         request for a single slot and quotes nothing, and two presses on two different
         slots land in the SAME run record because the projection groups by task rather
         than by press. Refusing there would refuse the second slot a filmmaker asked for
         — authorised work stopped on arithmetic nobody performed. */
      const u = await harness();
      try {
        const p = u.project();
        p.characters = [{ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] }];
        u.saveProject(p);
        const manualRun = () => u.project().characters[0].coverageAutomation;
        const manual = (n) => ({ ...slot(n), coverageMode: "", coverageSheetType: "angles", coverageRequestCount: undefined, coverageMaximumImages: undefined });
        const firstManual = await u.coverage(manual(1));
        assert.strictEqual(firstManual.status, 200, `the first slot press dispatches: ${JSON.stringify(firstManual.data)}`);
        const openedRun = manualRun();
        assert.strictEqual(openedRun.requestCount, undefined, "and the run honestly records no bound rather than inventing one");
        assert.deepStrictEqual(openedRun.jobs, [firstManual.data.job.id], "carrying the job it was established for");
        assert.strictEqual(u.ledger()[0].status, "IN_QUEUE",
          "and that job is genuinely still in flight — the projection is being watched while it runs");

        const secondManual = await u.coverage(manual(2));
        assert.strictEqual(secondManual.status, 200,
          `and so does the second slot the filmmaker asks for, with the first still in flight: ${JSON.stringify(secondManual.data)}`);
        assert.strictEqual(u.calls.length, 2, "both single presses reach the provider");

        /* AND THE FIRST PRESS IS STILL THERE.
         *
         * "Both dispatched and no budget exists" was all this asserted, and it was not
         * enough: an independent reviewer found the second press silently REPLACING the
         * first run record, so the run id changed and the job still IN_QUEUE disappeared
         * from the board a filmmaker was watching it on. Two provider calls, one of them
         * represented nowhere. An empty authorization reference means "nothing bounded
         * governs this dispatch" — never "discard the projection". */
        const continuedRun = manualRun();
        assert.strictEqual(continuedRun.id, openedRun.id,
          `the second compatible press must CONTINUE the run, not replace it: ${openedRun.id} -> ${continuedRun.id}`);
        assert.deepStrictEqual(continuedRun.jobs, [firstManual.data.job.id, secondManual.data.job.id],
          `and both jobs must be represented on it: ${JSON.stringify(continuedRun.jobs)}`);
        assert(continuedRun.jobs.includes(firstManual.data.job.id),
          "the first job, still IN_QUEUE, must not vanish from the projection it was dispatched into");
        assert.strictEqual(u.ledger().find((row) => row.id === firstManual.data.job.id).status, "IN_QUEUE",
          "and it is still in flight, which is what makes losing it from the board a lie rather than a tidy-up");

        /* AND NOTHING WAS BORROWED OR INVENTED TO KEEP IT CONTINUOUS. Continuity is a
           filing decision; it grants no ceiling, and it must not acquire one. */
        assert.strictEqual(continuedRun.requestCount, undefined, "no request count was fabricated");
        assert.strictEqual(continuedRun.maximumImages, undefined, "no image ceiling was fabricated");
        assert.strictEqual(continuedRun.maxSpend, undefined, "and no spend ceiling was fabricated");
        /* Asserted on the record rather than by pressing a third time: the route caps
           concurrency at two in-flight jobs, so a third press here would be refused by
           that cap and the assertion would be reading the wrong refusal. */
        assert.deepStrictEqual(
          Object.keys(continuedRun).filter((key) => ["requestCount", "maximumImages", "maxSpend"].includes(key)), [],
          `the continued run carries no bound-shaped key at all: ${JSON.stringify(continuedRun)}`);
      } finally { u.close(); }

      note("21. a coverage press authorised for 1 paid request and 3 images dispatches exactly 1 while its work is unsettled: the honest second request AND the same work reclassified with a blank coverageMode are both COVERAGE_REQUEST_CAP, an expression sheet arriving mid-run is COVERAGE_RUN_BUSY, and in all three the live bounded run stays BYTE-EQUIVALENT with 0 provider calls and no second row — the escape that replaced and destroyed it is closed. The image ceiling binds separately (COVERAGE_IMAGE_CAP), the dollar ceiling is priced once from costEstimateFromRate(), and a press that quoted nothing is given no bound it never declared: two per-slot presses both dispatch");
    } finally { h.close(); }
  }

  /* =======================================================================
     22. AND THE RUNNER'S CEILING IS THE RUN'S, NOT THE RUNNER'S.

     Reproductions 10 and 17-19 prove the spend guard enforces `config.maxSpend` exactly as
     designed. They prove nothing about where that figure came from, and it came from the
     last thing that wrote the run: public/automation.js PUTs the whole run object back on
     every progress update and the merge took `config` wholesale. So the guard was enforcing
     a ceiling handed to it by the work it was capping — a run authorised for one image and
     $0.06 could restate itself at five hundred and $999 through the ordinary progress route
     and go on dispatching, one in-cap job at a time.

     The browser's own note beside v626AuthorizedSpend() already says the intent: "Recorded
     at CREATION and never recomputed." This is that sentence made true of the record. */
  {
    const h = await harness();
    try {
      const RUNNER = "runner-1";
      const AUTHORIZED = { priced: true, amount: 0.06, quantity: 1, unitBasis: "image", ratePerUnit: 0.06, rateSource: "configured" };
      const runRow = () => ({
        id: "automation-bound", schemaVersion: 2, revision: 1, type: "shot-chain", targetId: "SH-1", scope: "main",
        status: "running", runnerId: RUNNER, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        config: { maxImages: 1, maxSpend: AUTHORIZED }, usage: { imagesGenerated: 0 }, steps: {}, logs: [],
      });
      h.saveRuns([runRow()]);
      const buildId = seedFramePackage(h);
      const step = (key) => ({
        ...framePlanBody(buildId, { clientRequestId: `bound-${key}`, outputCount: 1 }),
        imagePlan: undefined,
        automationRunId: "automation-bound", automationStepKey: key, automationRunnerId: RUNNER,
        generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
      });

      const first = await h.post(step("step-1"));
      assert.strictEqual(first.status, 200, `the one authorised image dispatches: ${JSON.stringify(first.data)}`);
      await h.settle(first.data.job.id);
      const second = await h.post(step("step-2"));
      assert.strictEqual(second.status, 409, `and the second is refused by the count cap: ${JSON.stringify(second.data)}`);

      /* THE REPRODUCTION: the run restates its own authorisation through sanitizeRun(),
         which is the one function every run writer on that route goes through — the
         progress PUT, the lease, the heartbeat and the retry all merge through it. */
      const { registerAutomationRuns } = require("../automation-runs");
      const runsApp = express();
      runsApp.use(express.json({ limit: "8mb" }));
      registerAutomationRuns(runsApp, {
        readConfig: () => ({}), readProject: () => h.project(), writeProject: () => {},
        activeSlug: () => "truth", projectDir: () => h.dir, projectDirForSlug: () => ({ slug: "truth", dir: h.dir, file: h.file }),
      });
      const runsServer = await listen(runsApp);
      try {
        const runsOrigin = originOf(runsServer);
        const stored = await (await fetch(`${runsOrigin}/api/automation/runs/automation-bound`)).json();
        const raise = await fetch(`${runsOrigin}/api/automation/runs/automation-bound`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...stored.run, runnerId: RUNNER,
            config: { maxImages: 500, maxSpend: { priced: true, amount: 999, quantity: 500, unitBasis: "image", ratePerUnit: 0.06, rateSource: "configured" } },
          }),
        });
        const raised = await raise.json();
        /* THE UPDATE IS ACCEPTED — a run legitimately reports its own progress, and
           refusing the whole PUT would break every step it writes. What it may not do is
           come back holding a different authorisation. */
        assert.strictEqual(raise.status, 200, `the progress update itself is accepted: ${JSON.stringify(raised)}`);
        assert.strictEqual(raised.run.config.maxImages, 1, "and carries the count it was authorised with");
        assert.deepStrictEqual(raised.run.config.maxSpend, AUTHORIZED, "and the spend it was authorised with");
      } finally { runsServer.close(); }

      const before = h.calls.length;
      const third = await h.post(step("step-3"));
      assert.strictEqual(third.status, 409, `so the guard still refuses: ${JSON.stringify(third.data)}`);
      assert(/1-image cap/.test(String(third.data.error)), `naming the figure the filmmaker actually approved: ${third.data.error}`);
      assert.strictEqual(h.calls.length, before, "PROVIDER INVOCATION COUNT ON REFUSAL = 0");
      assert.strictEqual(h.calls.length, 1, "one authorised image, one provider call, across the whole run");

      note("22. an automation run authorised for 1 image and $0.06 cannot restate itself at 500 and $999 through the ordinary progress route — the PUT is accepted and the authorised figures come back unchanged, the credit guard still names the 1-image cap, and the run makes exactly 1 provider call");
    } finally { h.close(); }
  }

  /* =======================================================================
     23. THE PAID DISPATCH PERMIT.

     Two independent reviews reached the same floor by different routes: an automation run
     capped at one image dispatched a second by omitting `automationRunId`, and a coverage
     run bounded to one request dispatched a second by blanking `coverageMode`. Neither is
     a matching bug. Membership in a bounded authorization was a CLAIM the request made
     about itself, and a claim written by the work being bounded can always be unwritten.

     So a paid dispatch now redeems a permit that a server path minted after establishing
     the authorization from state the request cannot reach. The permit answers exactly one
     question — which authorization is paying for this — and the ceilings, the price, the
     plan and the freshness verdict stay with the owners that already had them. */
  {
    const h = await harness();
    try {
      const buildId = seedFramePackage(h);
      const RUNNER = "runner-1";
      /* The automation half needs the run registry mounted, because the automation permit
         is minted by the route the runner ALREADY calls before every paid step. */
      const { registerAutomationRuns } = require("../automation-runs");
      const runsApp = express();
      runsApp.use(express.json({ limit: "8mb" }));
      registerAutomationRuns(runsApp, {
        readConfig: () => ({}), readProject: () => h.project(), writeProject: () => {},
        activeSlug: () => "truth", projectDir: () => h.dir, projectDirForSlug: () => ({ slug: "truth", dir: h.dir, file: h.file }),
      });
      const runsServer = await listen(runsApp);
      const runsOrigin = originOf(runsServer);
      try {
        const frameScope = (extra = {}) => ({
          generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "advanced" }),
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", sourceBuildId: buildId, outputCount: 1, ...extra,
        });
        const frameBody = (extra = {}) => ({
          ...framePlanBody(buildId, { outputCount: 1, ...extra }),
          generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "advanced" }),
        });
        const rawPost = async (body) => {
          const response = await fetch(`${h.appOrigin}/api/generation/fal/jobs`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
          });
          return { status: response.status, data: await response.json() };
        };

        /* A. A VALID DIRECT PERMIT DISPATCHES ONCE, and the row records what paid. */
        const issued = await h.permitFor(frameScope());
        assert.strictEqual(issued.status, 200, `the direct issuance route mints: ${JSON.stringify(issued.data)}`);
        assert(/^permit-[0-9a-f]{32}$/.test(String(issued.data.paidPermitId)),
          `and the id is server-random rather than anything a caller could construct: ${issued.data.paidPermitId}`);
        const dispatched = await rawPost(frameBody({ clientRequestId: "permit-ok", paidPermitId: issued.data.paidPermitId }));
        assert.strictEqual(dispatched.status, 200, `a valid permit dispatches: ${JSON.stringify(dispatched.data)}`);
        assert.strictEqual(h.calls.length, 1, "exactly one provider call");
        const row = h.ledger().find((item) => item.id === dispatched.data.job.id);
        assert.strictEqual(row.paidPermitId, issued.data.paidPermitId, "the ledger row names the permit it redeemed");
        assert.deepStrictEqual(row.paidAuthorization, { class: "direct", ref: "" },
          `and the authorization the server established, not one the body claimed: ${JSON.stringify(row.paidAuthorization)}`);
        await h.settle(dispatched.data.job.id);

        /* B. FOUR WAYS A PERMIT CAN BE WRONG, and none of them reaches a provider. */
        const refusals = [];
        const collect = async (what, body, expected) => {
          const before = h.calls.length;
          const rows = h.ledger().length;
          const result = await rawPost(body);
          assert.strictEqual(result.status, expected.status, `${what}: ${JSON.stringify(result.data)}`);
          assert.strictEqual(result.data.code, expected.code, `${what}: typed`);
          assert.strictEqual(result.data.providerContacted, false, `${what}: states providerContacted:false`);
          assert.strictEqual(result.data.paidRequestSubmitted, false, `${what}: and that nothing was submitted`);
          assert.strictEqual(h.calls.length, before, `${what}: PROVIDER INVOCATION COUNT = 0`);
          assert.strictEqual(h.ledger().length, rows, `${what}: and no ledger row`);
          refusals.push(what);
        };
        await collect("no permit at all", frameBody({ clientRequestId: "no-permit" }), { status: 400, code: "PAID_PERMIT_REQUIRED" });
        await collect("a fabricated permit", frameBody({ clientRequestId: "fake", paidPermitId: "permit-" + "f".repeat(32) }),
          { status: 409, code: "PAID_PERMIT_UNKNOWN" });
        /* AN EXPIRED PERMIT, aged on disk rather than by waiting. The store is the durable
           record this reads, so editing it is editing the fact the boundary consults. */
        const stale = await h.permitFor(frameScope());
        const permits = JSON.parse(fs.readFileSync(path.join(h.dir, "paid-permits.json"), "utf8"));
        permits.find((item) => item.id === stale.data.paidPermitId).expiresAt = "2020-01-01T00:00:00.000Z";
        fs.writeFileSync(path.join(h.dir, "paid-permits.json"), JSON.stringify(permits, null, 2));
        await collect("an expired permit", frameBody({ clientRequestId: "stale", paidPermitId: stale.data.paidPermitId }),
          { status: 409, code: "PAID_PERMIT_EXPIRED" });
        await collect("a permit already redeemed", frameBody({ clientRequestId: "replay", paidPermitId: issued.data.paidPermitId }),
          { status: 409, code: "PAID_PERMIT_ALREADY_REDEEMED" });

        /* C. THE SCOPE IS BOUND, so a permit is not a licence for the authorization. */
        const forCount = await h.permitFor(frameScope({ outputCount: 1 }));
        await collect("four images bought with a permit minted for one",
          frameBody({ clientRequestId: "count", outputCount: 4, paidPermitId: forCount.data.paidPermitId }),
          { status: 409, code: "PAID_PERMIT_SCOPE_MISMATCH" });
        const forShot = await h.permitFor(frameScope({ shotId: "SH-1" }));
        await collect("a different view than the permit was minted for",
          { ...frameBody({ clientRequestId: "plan", paidPermitId: forShot.data.paidPermitId }),
            generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" }) },
          { status: 409, code: "PAID_PERMIT_SCOPE_MISMATCH" });

        /* D. CONCURRENT REDEMPTION OF ONE PERMIT PRODUCES AT MOST ONE PAID JOB.
           commit() serialises per project and re-reads inside its own turn, so the second
           turn sees what the first wrote. Distinct clientRequestIds, so the answer comes
           from the permit rather than from the duplicate-request guard. */
        const race = await h.permitFor(frameScope());
        const beforeRace = h.calls.length;
        const both = await Promise.all([
          rawPost(frameBody({ clientRequestId: "race-a", paidPermitId: race.data.paidPermitId })),
          rawPost(frameBody({ clientRequestId: "race-b", paidPermitId: race.data.paidPermitId })),
        ]);
        const won = both.filter((result) => result.status === 200);
        assert.strictEqual(won.length, 1, `exactly one concurrent redemption may win: ${JSON.stringify(both.map((r) => [r.status, r.data.code]))}`);
        assert(["PAID_PERMIT_ALREADY_REDEEMED", "PAID_PERMIT_UNKNOWN"].includes(both.find((r) => r.status !== 200).data.code),
          `and the loser is refused for the permit: ${JSON.stringify(both.find((r) => r.status !== 200).data)}`);
        assert.strictEqual(h.calls.length, beforeRace + 1, "exactly one provider call came out of the race");
        await h.settle(won[0].data.job.id);

        /* E. AN AUTOMATION DISPATCH STAYS ITS RUN'S EVEN WHEN THE BODY SAYS OTHERWISE.
           This is the reviewer's reproduction, inverted: the omission that used to detach
           a job from its ceiling now changes nothing, because the ceiling is found through
           the permit and the body is corrected from it. */
        const AUTHORIZED = { priced: true, amount: 0.06, quantity: 1, unitBasis: "image", ratePerUnit: 0.06, rateSource: "configured" };
        h.saveRuns([{
          id: "automation-permit", schemaVersion: 2, revision: 1, type: "shot-chain", targetId: "SH-1", scope: "main",
          status: "running", runnerId: RUNNER, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
          config: { maxImages: 1, maxSpend: AUTHORIZED }, usage: { imagesGenerated: 0 }, steps: {}, logs: [],
        }, {
          /* A SECOND, DIFFERENTLY SCOPED RUN ON THE SAME SHOT. CineBraid supports this and
             the permit must keep the two coherent rather than merging their budgets. */
          id: "automation-blocking", schemaVersion: 2, revision: 1, type: "shot-chain", targetId: "SH-1", scope: "blocking-only",
          status: "running", runnerId: RUNNER, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
          config: { maxImages: 1, maxSpend: AUTHORIZED }, usage: { imagesGenerated: 0 }, steps: {}, logs: [],
        }]);
        const revalidate = async (runId, stepKey, scope) => {
          const response = await fetch(`${runsOrigin}/api/automation/runs/${encodeURIComponent(runId)}/lease/revalidate`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ runnerId: RUNNER, stepKey, paidScope: scope }),
          });
          return { status: response.status, data: await response.json() };
        };
        const runScope = (extra = {}) => ({
          purpose: "frame", surface: "automation-run", viewMode: "simple",
          shotId: "SH-1", frameId: "FR-A", entityList: "", entityId: "", buildId: "", outputCount: 1, ...extra,
        });
        /* `automationRunnerId` is still a body value on purpose, and it is the one
           automation field that does not need to come from the permit: the credit guard
           refuses unless it EQUALS the run's current holder and that lease is unexpired,
           so a wrong or missing one can only refuse this request. A strictly narrowing
           input is not a claim the boundary has to defend against. The run and the step
           are different — those decide which ceiling applies, and they come from the
           permit. */
        const runBody = (extra = {}) => ({
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A", prompt: "Kai sets the parcel down.",
          aspectRatio: "16:9", outputCount: 1, automationRunnerId: RUNNER,
          generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
          ...extra,
        });

        const stepOne = await revalidate("automation-permit", "step-1", runScope());
        assert.strictEqual(stepOne.status, 200, `revalidation mints beside the lease it already checked: ${JSON.stringify(stepOne.data)}`);
        assert(stepOne.data.paidPermitId, "and returns the permit for the step it was called for");
        /* THE BODY OMITS THE RUN ENTIRELY. Under the previous candidate this dispatched as
           independent work and the run's one-image ceiling never saw it. */
        const detached = await rawPost(runBody({ clientRequestId: "detached", paidPermitId: stepOne.data.paidPermitId }));
        assert.strictEqual(detached.status, 200, `it still dispatches — it is authorised work: ${JSON.stringify(detached.data)}`);
        const detachedRow = h.ledger().find((item) => item.id === detached.data.job.id);
        assert.strictEqual(detachedRow.paidAuthorization.class, "automation", "but it is recorded as the run's work");
        assert.strictEqual(detachedRow.paidAuthorization.ref, "automation-permit", "naming the run the permit was minted for");
        assert.strictEqual(detachedRow.paidAuthorization.stepKey, "step-1", "and the step");
        assert.strictEqual(detachedRow.automationRunId, "automation-permit",
          "and the row's own run field is corrected from the permit rather than left as the body wrote it");
        await h.settle(detached.data.job.id);

        /* AND THE CEILING IT COULD NOT SEE BEFORE NOW REFUSES IT. */
        const stepTwo = await revalidate("automation-permit", "step-2", runScope());
        await collect("a second image against a one-image run, with the run omitted from the body",
          runBody({ clientRequestId: "over", automationRunId: "", paidPermitId: stepTwo.data.paidPermitId }),
          { status: 409, code: "AUTOMATION_GUARD" });

        /* AND NAMING A DIFFERENT RUN IN THE BODY BUYS NOTHING. The other run has its own
           untouched one-image budget; the permit says which one is paying. */
        const stepThree = await revalidate("automation-permit", "step-3", runScope());
        await collect("a request naming the other run while holding this run's permit",
          runBody({ clientRequestId: "swap", automationRunId: "automation-blocking", automationStepKey: "b-1", paidPermitId: stepThree.data.paidPermitId }),
          { status: 409, code: "AUTOMATION_GUARD" });

        /* F. TWO SCOPED RUNS ON ONE SHOT STAY COHERENT — the second still has its own
           image, and spends it under its own authorization. */
        const blockingStep = await revalidate("automation-blocking", "b-1", runScope({ purpose: "blocking" }));
        const blocking = await rawPost(runBody({
          purpose: "blocking", clientRequestId: "blocking-1", paidPermitId: blockingStep.data.paidPermitId,
        }));
        assert.strictEqual(blocking.status, 200, `the differently scoped run spends its own budget: ${JSON.stringify(blocking.data)}`);
        assert.strictEqual(h.ledger().find((item) => item.id === blocking.data.job.id).paidAuthorization.ref, "automation-blocking",
          "under its own authorization");
        await h.settle(blocking.data.job.id);

        /* G. AND DIRECT WORK REMAINS POSSIBLE ALONGSIDE IT. This is the accepted product
           decision, asserted rather than assumed: a filmmaker pressing Generate on the same
           shot while a bounded run is live is a separate authorization, not an escape. */
        const alongside = await h.permitFor(frameScope({ outputCount: 1 }));
        const manual = await rawPost(frameBody({ clientRequestId: "alongside", paidPermitId: alongside.data.paidPermitId }));
        assert.strictEqual(manual.status, 200, `direct generation is not blocked by a live run: ${JSON.stringify(manual.data)}`);
        assert.strictEqual(h.ledger().find((item) => item.id === manual.data.job.id).paidAuthorization.class, "direct",
          "and is recorded as the direct authorization it is");
        await h.settle(manual.data.job.id);

        /* H. THE STORE IS DURABLE, so a permit survives a process that does not.
           A second server over the same project directory is what a restart looks like
           from the store's point of view: nothing in memory carries over. */
        const survivor = await h.permitFor(frameScope());
        const restarted = express();
        restarted.use(express.json({ limit: "8mb" }));
        registerFalGeneration(restarted, {
          readConfig: () => ({ generation: { fal: {
            enabled: true, apiKey: "fal-secret-test-key", baseUrl: h.mockOrigin,
            textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit",
            maxConcurrent: 8, frameResolution: "1k", blockingResolution: "1k",
            frameQuality: "high", blockingQuality: "low", frameOutputs: 1, blockingOutputs: 1,
            estimatedCostPerImage: 0.06,
          } } }),
          readProject: () => h.project(), writeProject: (project) => h.saveProject(project),
          activeSlug: () => "truth", projectDirForSlug: () => ({ slug: "truth", dir: h.dir, file: h.file }),
        });
        const restartedServer = await listen(restarted);
        try {
          const restartedOrigin = originOf(restartedServer);
          const afterRestart = async (body) => {
            const response = await fetch(`${restartedOrigin}/api/generation/fal/jobs`, {
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
            });
            return { status: response.status, data: await response.json() };
          };
          const survived = await afterRestart(frameBody({ clientRequestId: "survivor", paidPermitId: survivor.data.paidPermitId }));
          assert.strictEqual(survived.status, 200,
            `a permit issued before the restart is still redeemable: ${JSON.stringify(survived.data)}`);
          /* AND SPENTNESS SURVIVES IT TOO, because spentness is the LEDGER's answer rather
             than a flag in the permit store — the one durable record a restart cannot
             disagree with. */
          const replayed = await afterRestart(frameBody({ clientRequestId: "survivor-replay", paidPermitId: survivor.data.paidPermitId }));
          assert.strictEqual(replayed.status, 409, `and replay after it stays refused: ${JSON.stringify(replayed.data)}`);
          assert.strictEqual(replayed.data.code, "PAID_PERMIT_ALREADY_REDEEMED", "for the redemption the ledger records");
          assert.strictEqual(replayed.data.redeemedByJobId, survived.data.job.id, "naming the job that spent it");
        } finally { restartedServer.close(); }

        note(`23. a paid dispatch redeems a server-minted permit or does not happen: ${refusals.length} refusal families (no permit, fabricated, expired, already redeemed, a count the permit was not minted for, a view it was not minted for, a second image against a one-image run with the run omitted, and a request naming another run) each state providerContacted:false with 0 provider calls and no ledger row; two concurrent redemptions of one permit produce exactly 1 job and 1 provider call; the ledger row carries the server-written paidPermitId and paidAuthorization; an automation dispatch stays bound to its run and step with automationRunId omitted or pointing elsewhere; two differently scoped runs on one shot each spend their own budget; direct generation still dispatches beside a live run; and a permit issued before a restart is redeemable exactly once across it`);
      } finally { runsServer.close(); }
    } finally { h.close(); }
  }

  /* =======================================================================
     24. THE TRANSITION BETWEEN AN UNBOUNDED PROJECTION AND A BOUNDED ONE.

     `entity.coverageAutomation` is the single current coverage-run record, and section 21
     settled what happens inside each kind of run. It did not settle what happens when the
     kind CHANGES while paid work is in flight, and an independent reviewer found the gap
     there: a bounded press arriving over a live unbounded manual run REPLACED it, so the
     ceiling was recorded on a new run while the manual job still IN_QUEUE vanished from the
     projection — two paid calls, one of them represented nowhere. Had the two presses
     shared a task the same request would have been absorbed instead and the quote dropped
     silently. One record, two destructive outcomes, no third one available.

     So the answer is neither: it SERIALISES. A bounded operation cannot be established
     while unbounded work nobody has heard back about is still outstanding, and once that
     work settles it establishes normally, with its own ceiling, enforced. The five rows
     below are the whole matrix. */
  {
    const h = await harness();
    try {
      const project = h.project();
      project.characters = [{ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] }];
      h.saveProject(project);
      const runOf = () => h.project().characters[0].coverageAutomation;
      const press = (extra = {}) => ({
        purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
        prompt: "Kai from the requested angle.", references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
        outputCount: 3, quality: "high", resolution: "4k", aspectRatio: referenceAspectLabel("characters"),
        coverageJobType: "slot", coverageSheetType: "angles", coverageMode: "",
        coverageRequestCount: undefined, coverageMaximumImages: undefined,
        generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        ...extra,
      });
      /* A bounded press is the coverage dialog's: it names a mode and quotes a plan. */
      const boundedPress = (extra = {}) => press({
        coverageMode: "individual", coverageSheetType: "", coverageRequestCount: 1, coverageMaximumImages: 3, ...extra,
      });
      const deliver = (jobId) => {
        const rows = h.ledger();
        const row = rows.find((item) => item.id === jobId);
        assert(row, `the job to deliver must exist: ${jobId}`);
        row.status = "COMPLETED";
        row.ingestedAt = "2026-08-30T00:00:00.000Z";
        h.seedLedger(rows);
      };

      /* THE ROWS ARE ORDERED SO THAT ONE JOB IS IN FLIGHT WHEN ROW 4 RUNS. The route caps
         concurrency at two, and a third live job would be refused by that cap instead —
         the assertion would then be reading the wrong refusal and row 4 would prove
         nothing about the transition it exists for. */
      const manualOne = await h.coverage(press({ clientRequestId: "m1", targetCoverageSlotId: "s1" }));
      assert.strictEqual(manualOne.status, 200, `1: the unbounded press dispatches: ${JSON.stringify(manualOne.data)}`);
      const unboundedRun = runOf();
      assert.strictEqual(h.ledger()[0].status, "IN_QUEUE", "1: and its work is unsettled");
      assert.strictEqual(unboundedRun.requestCount, undefined, "1: with no ceiling of its own");
      const UNBOUNDED_JSON = JSON.stringify(unboundedRun);
      const afterManual = h.calls.length;

      /* ROW 4 — LIVE UNBOUNDED WITH UNSETTLED WORK → NEWLY BOUNDED ACTION: refuse.
         The reviewer's reproduction. It is refused BEFORE the provider, the unbounded run
         is byte-equivalent, and nothing of the bounded authorization is half-written. */
      const blocked = await h.coverage(boundedPress({ clientRequestId: "b1", targetCoverageSlotId: "s3" }));
      assert.strictEqual(blocked.status, 409, `4: a bounded press may not establish over unsettled unbounded work: ${JSON.stringify(blocked.data)}`);
      assert.strictEqual(blocked.data.code, "COVERAGE_RUN_BUSY", "4: through the existing coverage-busy code");
      assert.strictEqual(blocked.data.reason, "unsettled-unbounded-work",
        `4: naming the reason it is busy, so it is distinguishable from the filing refusal: ${JSON.stringify(blocked.data)}`);
      assert.strictEqual(blocked.data.providerContacted, false, "4: and states it reached no provider");
      assert.strictEqual(h.calls.length, afterManual, "4: PROVIDER INVOCATION COUNT DID NOT INCREASE");
      assert.strictEqual(JSON.stringify(runOf()), UNBOUNDED_JSON,
        `4: the live unbounded run is BYTE-EQUIVALENT: ${JSON.stringify(runOf())}`);
      assert(runOf().jobs.includes(manualOne.data.job.id), "4: the first job is still represented");
      assert.strictEqual(h.ledger().find((row) => row.id === manualOne.data.job.id).status, "IN_QUEUE",
        "4: and is still genuinely in flight, which is why it could not be discarded");
      assert.strictEqual(runOf().requestCount, undefined, "4: no bounded authorization was half-created");
      assert.strictEqual(runOf().maxSpend, undefined, "4: and none was half-priced");
      assert.strictEqual(h.ledger().length, 1, "4: and no second row was written");

      /* ROW 1 — UNBOUNDED → COMPATIBLE UNBOUNDED: continue the projection. Proved in full
         at 21E; asserted here as the row of the matrix it is, because the rows either side
         of it are only meaningful beside it — a refusal that also lost the projection would
         satisfy row 4 while destroying what row 1 guarantees. */
      const manualTwo = await h.coverage(press({ clientRequestId: "m2", targetCoverageSlotId: "s2" }));
      assert.strictEqual(manualTwo.status, 200, `1: a compatible unbounded press still dispatches: ${JSON.stringify(manualTwo.data)}`);
      assert.strictEqual(runOf().id, unboundedRun.id, "1: same run id");
      assert.deepStrictEqual(runOf().jobs, [manualOne.data.job.id, manualTwo.data.job.id], "1: both jobs retained");
      assert.strictEqual(runOf().requestCount, undefined, "1: and no ceiling was fabricated");
      assert.strictEqual(h.calls.length, afterManual + 1, "1: and it reached the provider");

      /* ROW 5 — SETTLED UNBOUNDED RUN → NEWLY BOUNDED ACTION: establish, with its ceiling.
         This is what makes row 4 a serialisation rather than a wall. */
      deliver(manualOne.data.job.id);
      deliver(manualTwo.data.job.id);
      const established = await h.coverage(boundedPress({ clientRequestId: "b2", targetCoverageSlotId: "s4" }));
      assert.strictEqual(established.status, 200, `5: once the manual work settles the bounded press establishes: ${JSON.stringify(established.data)}`);
      const boundedRun = runOf();
      assert.notStrictEqual(boundedRun.id, unboundedRun.id, "5: as its own run, not the settled one");
      assert.strictEqual(boundedRun.requestCount, 1, "5: persisting the request count it quoted");
      assert.strictEqual(boundedRun.maximumImages, 3, "5: and its image ceiling");
      assert.strictEqual(boundedRun.maxSpend?.amount, 0.18, "5: and its spend ceiling, priced from costEstimateFromRate()");
      assert.deepStrictEqual(boundedRun.jobs, [established.data.job.id], "5: carrying the job it was established for");
      /* AND NO UNSETTLED JOB DISAPPEARED — both manual jobs are delivered and still on the
         ledger, which is the record that survives a projection yielding to a newer run. */
      assert.strictEqual(h.ledger().length, 3, "5: every job is still on the ledger");
      for (const id of [manualOne.data.job.id, manualTwo.data.job.id])
        assert.strictEqual(h.ledger().find((row) => row.id === id).status, "COMPLETED",
          "5: the previous projection yielded only after its work had settled");

      /* ROW 2 — BOUNDED → COMPATIBLE GOVERNED WORK: the established ceiling is enforced,
         and a request cannot restate it. */
      const overflow = await h.coverage(boundedPress({ clientRequestId: "b3", targetCoverageSlotId: "s5", coverageRequestCount: 99, coverageMaximumImages: 99 }));
      assert.strictEqual(overflow.status, 409, `2: a second bounded job exceeds the authorised count: ${JSON.stringify(overflow.data)}`);
      assert.strictEqual(overflow.data.code, "COVERAGE_REQUEST_CAP", "2: typed for the count it broke");
      assert.strictEqual(runOf().requestCount, 1, "2: and the ceiling it was judged by is the one that was authorised");
      /* AND PRESENTATION CANNOT DETACH IT — the prior escape, re-run inside this matrix. */
      const reclassified = await h.coverage(press({ clientRequestId: "b4", targetCoverageSlotId: "s6" }));
      assert.strictEqual(reclassified.status, 409, `2: nor may reclassified work detach from it: ${JSON.stringify(reclassified.data)}`);
      assert.strictEqual(reclassified.data.code, "COVERAGE_REQUEST_CAP", "2: refused by the bound, not by a shape rule");

      /* ROW 3 — BOUNDED LIVE → INCOMPATIBLE FILING WORK: refuse truthfully, run preserved. */
      const BOUNDED_JSON = JSON.stringify(runOf());
      const expression = await h.coverage(boundedPress({
        clientRequestId: "b5", coverageJobType: "sheet", coverageSheetType: "expressions",
        coverageMode: "sheet", aspectRatio: "4:3", coverageRequestCount: 1, coverageMaximumImages: 1,
      }));
      assert.strictEqual(expression.status, 409, `3: incompatible filing work is refused: ${JSON.stringify(expression.data)}`);
      assert.strictEqual(expression.data.code, "COVERAGE_RUN_BUSY", "3: through the coverage-busy code");
      assert.strictEqual(expression.data.reason, "incompatible-filing-target",
        "3: naming a DIFFERENT reason from row 4, so one refusal cannot stand in for the other");
      assert.strictEqual(JSON.stringify(runOf()), BOUNDED_JSON, "3: and the bounded run is byte-equivalent");
      assert.strictEqual(h.calls.length, 3, "the refusing rows made no further provider call — 2 unbounded presses and 1 bounded establishment");

      note("24. the five-row transition matrix, with `entity.coverageAutomation` the single current record: unbounded work continues its own projection (same run, both jobs, no ceiling); a bounded press arriving over UNSETTLED unbounded work is refused COVERAGE_RUN_BUSY/unsettled-unbounded-work before the provider, leaving the run byte-equivalent, the in-flight job represented and no half-written ceiling; once that work settles the same press establishes its own run and persists 1 request / 3 images / $0.18; the established ceiling then refuses a second job and cannot be restated or detached by presentation; and incompatible filing work is still COVERAGE_RUN_BUSY/incompatible-filing-target with the run preserved — a serialisation, not a wall");
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

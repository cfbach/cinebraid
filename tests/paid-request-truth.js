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
const express = require("express");

const { registerFalGeneration } = require("../fal-generation");
const Presentation = require("../public/shared-generation-presentation");
const BuildHistory = require("../public/shared-build-history");
const { imageControlCapability, IMAGE_MODEL_ID } = require("../image-execution");
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
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "IN_QUEUE" }));
  mock.get("/result/:id", (req, res) => res.json({ images: [] }));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  const runs = { file: path.join(dir, "automation-runs.json") };
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerFalGeneration(app, {
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
    dir, file, calls, post, runs, settle,
    project: () => JSON.parse(fs.readFileSync(file, "utf8")),
    saveProject: (project) => fs.writeFileSync(file, JSON.stringify(project, null, 2)),
    saveRuns: (rows) => fs.writeFileSync(runs.file, JSON.stringify(rows, null, 2)),
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
      entityProject.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
      h.saveProject(entityProject);
      const result = await h.post({
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
          selectedOptionId: "some-other-model::fal-queue::t2i", selectedModelId: "some-other-model",
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
      note(`7. a request naming a model this route cannot dispatch is refused with GENERATION_MODEL_MISMATCH naming ${IMAGE_MODEL_ID}; naming the right one is accepted and recorded; naming none is accepted and records nothing`);
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

  console.log("");
  console.log("PAID REQUEST TRUTH — the money boundary enforces the request:");
  for (const line of notes) console.log(`  - ${line}`);
  console.log("  - 0 provider calls outside the local mock, 0 paid calls, nothing written to any project on disk");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

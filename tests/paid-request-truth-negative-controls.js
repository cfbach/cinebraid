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
const vm = require("vm");
const express = require("express");

const Presentation = require("../public/shared-generation-presentation");
const BuildHistory = require("../public/shared-build-history");
const { IMAGE_MODEL_ID } = require("../image-execution");
const CoverageOwnership = require("../public/shared-coverage");
const { referenceAspectLabel } = require("../public/shared-aspect");
/* The shipped route, for a control whose mutation is in a DIFFERENT module. */
const falGenerationReal = require("../fal-generation");
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
function modifiedSource(relative, edits) {
  const file = path.join(ROOT, relative);
  let code = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    assert(code.includes(from),
      `negative control anchor no longer exists in ${relative}; the control must be UPDATED, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    code = code.replace(from, to);
  }
  return { file, code };
}

function loadModified(relative, edits) {
  const { file, code } = modifiedSource(relative, edits);
  const patched = new Module(file, module);
  patched.filename = file;
  patched.paths = Module._nodeModulePaths(path.dirname(file));
  patched._compile(code, file);
  return patched.exports;
}

/* THE SAME THING, FOR A DEFECT THAT LIVES BELOW THE ROUTE.
 *
 * loadModified() is enough when the mutation and the property share a module, or when the
 * property is a pure function the control can call directly. It is not enough for a defect
 * in public/shared-generation-presentation.js that has to be OBSERVED at the provider: a
 * private copy of the shared module is not the copy the real fal-generation.js already
 * holds, so the route would go on running the correct code and the control would report a
 * green it had not earned.
 *
 * So the patched module is installed in the require cache and fal-generation.js is
 * compiled fresh against it — the pattern tests/continuity-state-binding-negative-controls.js
 * already uses for server.js. Every in-repo cache entry is saved and evicted first so the
 * fresh route cannot pick up a half-original graph, and restored in `finally` so the
 * controls after this one get the shipped modules back. Bytes on disk are still never
 * touched. */
const inRepoScope = (key) => key.startsWith(ROOT + path.sep) && !key.includes(`${path.sep}node_modules${path.sep}`);
async function withPatchedModule(relative, edits, run) {
  const { file, code } = modifiedSource(relative, edits);
  const saved = new Map();
  for (const key of Object.keys(require.cache)) if (inRepoScope(key)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const copy = new Module(file, module);
    copy.filename = file;
    copy.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = copy;
    copy._compile(code, file);
    copy.loaded = true;
    /* Required AFTER the patched entry is in place, so its own `require` of the shared
       module resolves to the copy above rather than compiling a second original. */
    return await run(require(path.join(ROOT, "fal-generation.js")));
  } finally {
    for (const key of Object.keys(require.cache)) if (inRepoScope(key)) delete require.cache[key];
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

/* ===========================================================================
   WHAT COUNTS AS A DETECTION, AND WHY IT IS NOT AN AssertionError.

   The first version of this harness treated ANY AssertionError as "the defect was
   detected". An independent reviewer found what that costs: control 7's mutation anchor
   went stale when the projected-spend line moved, loadModified() raised
   `negative control anchor no longer exists`, and the harness counted that setup failure
   as a successful detection. The control had not mutated anything, had not run the unsafe
   path, and had observed no harm — and reported green. One false green invalidates the
   whole suite's result, because a reader cannot tell which of the fourteen are real.

   MUTATION FAILURE IS NOT UNSAFE BEHAVIOUR DETECTED. So detection now has its own type,
   thrown at exactly one moment: after the unsafe path has run and the literal bad state
   has been observed. Everything else — a stale anchor, a mutation that changed nothing,
   a TypeError from a broken patch, an unrelated assertion, a server error, an import
   failure — propagates and FAILS the control.

   Each control also records the phases it actually reached, and a control that claims
   harm without having recorded that its mutation landed and that the unsafe path ran is
   rejected even if it threw the right type. The phases are proved, not narrated. */
class UnsafeBehaviourObserved extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeBehaviourObserved";
  }
}
/* Called ONLY after the literal bad state has been read back. `condition` is the harm. */
function observeHarm(condition, message) {
  if (condition) throw new UnsafeBehaviourObserved(message);
}
const REQUIRED_PHASES = ["MUTATION_LANDED", "UNSAFE_PATH_EXECUTED"];

const results = [];
async function control(label, guardedTest, run) {
  const reached = new Set();
  const phase = (name) => {
    assert(REQUIRED_PHASES.includes(name) || name === "RESTORED", `unknown control phase: ${name}`);
    reached.add(name);
  };
  let detected = false;
  let outcome = "";
  try {
    await run(phase);
  } catch (error) {
    /* The ONE type that means "the unsafe path ran and the bad state was there". */
    if (!(error instanceof UnsafeBehaviourObserved)) throw error;
    detected = true;
    outcome = error.message.split("\n")[0];
  }
  assert(detected,
    `NEGATIVE CONTROL FAILED: reintroducing ${label} did not break "${guardedTest}". `
    + "That test cannot detect the defect it exists for.");
  for (const required of REQUIRED_PHASES)
    assert(reached.has(required),
      `NEGATIVE CONTROL FAILED: ${label} reported harm without recording ${required}. `
      + "A control that has not proved its mutation landed and its unsafe path ran has proved nothing.");
  results.push({ label, guardedTest, outcome, phases: [...reached].sort() });
}

/* ===========================================================================
   THE HARNESS, TESTED AGAINST ITSELF.

   The two failures that produced the false green are now failures this suite proves it
   rejects, every run — because a discipline nobody exercises is a comment. */
async function assertHarnessRejects(what, body) {
  let threw = null;
  try {
    await control(`self-check: ${what}`, "the harness rejects it", body);
  } catch (error) {
    threw = error;
  }
  assert(threw, `HARNESS SELF-CHECK FAILED: ${what} was accepted as a detection`);
  /* And the rejection must be the harness's own, not an accident of the body. */
  assert(!(threw instanceof UnsafeBehaviourObserved),
    `HARNESS SELF-CHECK FAILED: ${what} produced a real detection instead of being rejected`);
  return String(threw.message).split("\n")[0];
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
  const cancelCalls = [];
  mock.put("/cancel-503/:id", (req, res) => { cancelCalls.push(req.params.id); res.status(503).json({ detail: "provider unavailable" }); });
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
    /* THE PERMIT A DIALOG WOULD HAVE OBTAINED, from the shipped issuance route on this
       control's own server — including when that server is a MUTATED private copy, which
       is the point: a control that minted its permits some other way would be exercising a
       path the product does not have. `options.permit: false` posts without one, for the
       controls that are about the permit rather than about what it protects. */
    permitFor: async (scope) => {
      const response = await fetch(`${appOrigin}/api/generation/paid-permit`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scope),
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    },
    post: async (body, options = {}) => {
      let sent = body;
      if (options.permit !== false && body && typeof body === "object" && !body.paidPermitId) {
        const scope = declaredGenerationBody(body);
        const issued = await fetch(`${appOrigin}/api/generation/paid-permit`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            generationRequest: scope?.generationRequest, purpose: body.purpose,
            shotId: body.shotId, frameId: body.frameId, entityList: body.entityList,
            entityId: body.entityId, sourceBuildId: body.sourceBuildId, outputCount: body.outputCount,
          }),
        }).then((r) => r.json()).catch(() => ({}));
        if (issued?.paidPermitId) sent = { ...body, paidPermitId: issued.paidPermitId };
      }
      const response = await fetch(`${appOrigin}/api/generation/fal/jobs`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent),
      });
      return { status: response.status, data: await response.json() };
    },
    cancelCalls,
    mockOrigin: () => mockOrigin,
    cancel: async (jobId) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" },
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
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
    seedLedger: (rows) => fs.writeFileSync(path.join(dir, "generation-jobs.json"), JSON.stringify(rows, null, 2)),
    /* A GENERIC PROJECT SAVE, applying whichever ownership rule the control hands in —
       the real one, or a mutated copy that has stopped protecting server-owned state. */
    genericSave: (mutate, preserve = CoverageOwnership.preserveServerOwnedCoverageRuns) => {
      const current = JSON.parse(fs.readFileSync(file, "utf8"));
      const successor = JSON.parse(JSON.stringify(current));
      mutate(successor);
      preserve(successor, current);
      fs.writeFileSync(file, JSON.stringify(successor, null, 2));
      return successor;
    },
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

/* A REAL option identity from the shipped catalogue that this route cannot dispatch:
   seedream/5.0-pro is a catalogued image model and runware genuinely offers it. Using a
   made-up id here would make the pair-consistency control pass for the wrong reason —
   the mintability check would refuse it before the pair check ever ran. */
const OTHER_OPTION_ID = "seedream/5.0-pro::runware::t2i";
const OTHER_MODEL_ID = "seedream/5.0-pro";

/* ===========================================================================
   THE HARNESS PROVES ITSELF FIRST.

   Both of these were accepted as detections by the previous harness. Running them every
   time is the only thing that keeps the fix from rotting back. */
async function harnessSelfChecks() {
  const stale = await assertHarnessRejects("a stale mutation anchor", async (phase) => {
    /* Exactly what happened to control 7: the anchor no longer matches the shipped
       source, so loadModified() raises an AssertionError before anything is mutated. */
    loadModified("fal-generation.js", [["a line that has never existed in this file", "x"]]);
    phase("MUTATION_LANDED");
    phase("UNSAFE_PATH_EXECUTED");
  });
  const arbitrary = await assertHarnessRejects("an arbitrary AssertionError as the detector", async (phase) => {
    phase("MUTATION_LANDED");
    phase("UNSAFE_PATH_EXECUTED");
    /* A perfectly ordinary assertion failure. It is not a detection and must not be
       counted as one, however plausible its message looks. */
    assert.strictEqual(1, 2, "this looks like a detector and is not one");
  });
  const unproved = await assertHarnessRejects("harm claimed without running the unsafe path", async () => {
    observeHarm(true, "THE DEFECT: claimed without mutating anything or reaching any path");
  });
  return { stale, arbitrary, unproved };
}

async function main() {
  const selfChecks = await harnessSelfChecks();
  /* =======================================================================
     1. THE GATE ITSELF, GONE.

     The defect the slice exists to remove: the money boundary accepting whatever arrives.
     With the gate removed, a Simple request carrying an expert size reaches the adapter
     with that size — which is the exact bypass a replayed POST performed before. */
  await control("a money boundary that does not restrict the payload it was handed",
    "a control the active view never rendered cannot reach the adapter", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    const planGate = enforceRequestPlan(owner, req, purpose, trusted);",
        `    const planGate = { ok: true, surface: "compiled-frame", declaration: { viewMode: "simple", selectedOptionId: "", selectedModelId: "" }, payload: req.body, removed: [] };`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post({
          ...framePlanBody(buildId, { resolution: "4k" }),
          generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" }),
        });
        assert.strictEqual(result.status, 200, `the unsafe path must actually run: ${JSON.stringify(result.data)}`);
        assert.strictEqual(h.calls.length, 1, "and must actually reach the provider");
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(JSON.stringify(h.calls[0].body.image_size) === FOUR_K,
          `THE DEFECT: a Simple request reached the adapter carrying the 4K size the view never rendered — image_size ${JSON.stringify(h.calls[0].body.image_size)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     1b. THE GATE THAT DELETES A KEY AND HANDS BACK A PROTOTYPE THAT STILL HAS IT.

     Control 1 removes the gate. This one leaves the gate in place and reintroduces the
     single assignment it used to copy with — `out[key] = body[key]`, which for a key named
     `__proto__` calls Object.prototype's setter instead of storing a property. The strip
     above it still runs, `removed` is still computed and still says "resolution"; the
     value is simply readable again one line later, on the chain.

     This is the control that distinguishes "the gate ran" from "the value is gone", and
     the two came apart for exactly as long as the copy was a plain assignment. */
  await control("a payload gate that copies with a plain assignment, so a __proto__ member restores every key it removed",
    "a control the active view never rendered cannot reach the adapter", async (phase) => {
      await withPatchedModule("public/shared-generation-presentation.js", [[
        "    Object.defineProperty(out, key, { value: body[key], writable: true, enumerable: true, configurable: true });",
        "    out[key] = body[key];",
      ]], async (falGeneration) => {
        phase("MUTATION_LANDED");
        const h = await harness(falGeneration);
        try {
          const buildId = seedFramePackage(h);
          const result = await h.post({
            ...framePlanBody(buildId, { resolution: "4k" }),
            /* Own member, not a `__proto__:` literal — a literal would set this object's
               prototype and vanish at JSON.stringify, and the control would be sending an
               ordinary body while claiming otherwise. */
            ...JSON.parse('{"__proto__":{"resolution":"4k"}}'),
            generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" }),
          });
          assert.strictEqual(result.status, 200, `the unsafe path must actually run: ${JSON.stringify(result.data)}`);
          assert.strictEqual(h.calls.length, 1, "and must actually reach the provider");
          phase("UNSAFE_PATH_EXECUTED");
          /* Read back before the harm is declared: the row claiming the strip is half of
             what makes this worse than plain over-spend. */
          const row = h.ledger()[0];
          observeHarm(JSON.stringify(h.calls[0].body.image_size) === FOUR_K,
            `THE DEFECT: a Simple request reached the adapter at 4K through its prototype — image_size ${JSON.stringify(h.calls[0].body.image_size)} `
            + `while the row recorded removedPayloadKeys ${JSON.stringify(row.removedPayloadKeys)} under viewMode "${row.generationViewMode}"`);
        } finally { h.close(); }
      });
    });

  /* =======================================================================
     2. AN UNDECLARED BODY, DEFAULTED INSTEAD OF REFUSED.

     The tempting wrong answer. Defaulting an absent declaration to Advanced is what a
     "be lenient with old clients" instinct produces, and it hands every replayed body the
     widest vocabulary in the system — silently, with no code and no record. */
  await control("an absent declaration defaulted to the widest view instead of refused",
    "a paid request that does not say what built it is refused", async (phase) => {
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
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post(framePlanBody(buildId, { resolution: "4k" }));
        assert.strictEqual(h.calls.length <= 1, true, "the unsafe path runs at most once");
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(result.status === 200,
          `THE DEFECT: an undeclared paid request was accepted and dispatched — HTTP ${result.status}, adapter received ${JSON.stringify(h.calls[0] && h.calls[0].body.image_size)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     3. A DECLARATION TAKEN ON TRUST.

     If the boundary accepts whichever surface a body names, the declaration stops being
     evidence and becomes a menu: a request picks the vocabulary that governs it least and
     the gate politely applies it. */
  await control("a declared surface accepted without checking the request could be it",
    "a request cannot choose the vocabulary that governs it least", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    if (!legal.includes(declaration.surface))",
        "    if (false && !legal.includes(declaration.surface))",
      ]]);
      phase("MUTATION_LANDED");
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
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(JSON.stringify(h.calls[0].body.image_size) === FOUR_K,
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
    "a package the shot no longer stands behind is refused before dispatch", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    const staleRefusal = packageFreshnessRefusal(owner, job);",
        "    const staleRefusal = null;",
      ]]);
      phase("MUTATION_LANDED");
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
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(result.status === 200,
          `THE DEFECT: an out-of-date package was dispatched — HTTP ${result.status}, ${h.calls.length} provider call(s), and the job row claims ${JSON.stringify((h.ledger()[0] || {}).sourceBuildId)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     3b. THE SECOND FACTOR OF THE SIZE, LEFT ON THE CALLER'S WORD.

     Control 1 proves `resolution` cannot get past the plan. That is one of the two factors
     of image_size, and the plan cannot reach the other: no image surface lists
     `aspectRatio` and no image capability declares aspectRatios, so restrictPayloadToPlan
     has nothing to govern and the key survives on every image surface in both views.
     Remove the refusal that treats it as the route input it is, and a Simple request that
     could not ship 4K ships a square instead. */
  await control("a boundary that takes the requested format on the caller's word",
    "a paid request cannot choose a delivery format nothing offered it", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    const aspectRefusal = aspectAuthorityRefusal(owner, req.body, purpose, trusted);",
        "    const aspectRefusal = null;",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post({
          ...framePlanBody(buildId, { aspectRatio: "1:1" }),
          generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" }),
        });
        assert.strictEqual(result.status, 200, `the unsafe path must actually run: ${JSON.stringify(result.data)}`);
        assert.strictEqual(h.calls.length, 1, "and must actually reach the provider");
        phase("UNSAFE_PATH_EXECUTED");
        const size = h.calls[0].body.image_size;
        observeHarm(size && size.width === size.height,
          `THE DEFECT: a request reframed a 16:9 production's paid frame to a square nothing offered — image_size ${JSON.stringify(size)}, and the row records aspectRatio ${JSON.stringify((h.ledger()[0] || {}).aspectRatio)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     4b/4c. THE SAME GATE, REACHED BY A NAME IT DOES NOT RESOLVE.

     Control 4 removes the gate. These two leave it in place and reintroduce the reasons it
     used to return null on a package it was supposed to be judging — one per way of naming
     the same compile. Both are the same harm as control 4 and neither is control 4: the
     refusal is present and simply never asked its question.

     The shared setup is control 4's, to the byte: a package with a recorded snapshot, then
     an approved frame that makes it stale. */
  const seedStalePackage = (h) => {
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
    const moved = h.project();
    moved.shots[0].frames[0].winner = "A.png";
    h.saveProject(moved);
    return { buildId, packageId: pack.packageId };
  };

  await control("a boundary that judges the package the request named instead of the one it will compile",
    "a package the shot no longer stands behind is refused before dispatch", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        `    job.sourceBuildId = job.sourceBuildId || planGate.resolvedBuildId || "";`,
        "",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        seedStalePackage(h);
        /* No sourceBuildId. The compilers read an empty one as the shot's last usable
           build, so this dispatches the very package control 4 refuses. */
        const body = { ...framePlanBody("") };
        delete body.sourceBuildId;
        const result = await h.post(declaredGenerationBody(body));
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(result.status === 200,
          `THE DEFECT: omitting sourceBuildId dispatched an out-of-date package the gate never compared — HTTP ${result.status}, ${h.calls.length} provider call(s), and the row names ${JSON.stringify((h.ledger()[0] || {}).sourceBuildId)} after the fact`);
      } finally { h.close(); }
    });

  await control("a build resolver that answers for one of a package's two names",
    "a package the shot no longer stands behind is refused before dispatch", async (phase) => {
      await withPatchedModule("public/shared-build-history.js", [[
        "    const build = project.promptBuildsById[id] || packageAliasBuild(project, id);",
        "    const build = project.promptBuildsById[id];",
      ]], async (falGeneration) => {
        phase("MUTATION_LANDED");
        const h = await harness(falGeneration);
        try {
          const { packageId } = seedStalePackage(h);
          assert(packageId, "the fixture must give the package a packageId, or the mutation changes nothing");
          const result = await h.post(declaredGenerationBody(framePlanBody(packageId)));
          phase("UNSAFE_PATH_EXECUTED");
          observeHarm(result.status === 200,
            `THE DEFECT: naming the package by its packageId dispatched it while the identical request naming its id is refused — HTTP ${result.status}, ${h.calls.length} provider call(s)`);
        } finally { h.close(); }
      });
    });

  /* =======================================================================
     5. THE COMPARATOR'S SKIP RULE, REMOVED.

     The subtler half of freshness, and the one that would make the boundary WRONG rather
     than merely quiet. The server supplies no `references` field — it cannot enumerate
     what the production may currently supply without a second reference catalogue. Remove
     the "compare only what both sides have" rule and every package on the system reads
     stale, for a difference nobody has evidence for. */
  await control("a freshness comparator that compares fields one side never supplied",
    "a comparison nobody has evidence for is not a finding", async (phase) => {
      const history = loadModified("public/shared-build-history.js", [[
        `  function comparable(saved, now, key) {
    return saved?.[key] !== undefined && now?.[key] !== undefined;
  }`,
        `  function comparable(saved, now, key) {
    return saved?.[key] !== undefined;
  }`,
      ]]);
      phase("MUTATION_LANDED");
      const project = makeProject();
      const shot = project.shots[0];
      const pack = { frameId: "FR-A" };
      pack.dependencySnapshot = {
        ...history.packageProjectInputs(project, shot, pack, history.packageDirection(shot, pack)),
        /* A saved snapshot always records its references. The server's `now` never does. */
        references: [["kai", KAI_PNG, "identity", "image", ""]],
      };
      const freshness = history.packageProjectFreshness(project, shot, pack);
      assert.strictEqual(freshness.recorded, true, "the unsafe path must actually evaluate a recorded snapshot");
      phase("UNSAFE_PATH_EXECUTED");
      observeHarm(freshness.reasons.length > 0,
        `THE DEFECT: a current package was declared stale for a field the server never supplied — ${JSON.stringify(freshness.reasons)}`);
    });

  /* =======================================================================
     6. THE MODEL MISMATCH, WAVED THROUGH.

     A picker that offers a model and a route that dispatches a different one is a screen
     telling a filmmaker something untrue about what they are buying. Remove the refusal
     and the request proceeds with the ledger recording a selection the dispatch ignored. */
  await control("a boundary that dispatches its own model whatever the screen named",
    "the model the screen named is dispatched or the request is refused", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    const identityRefusal = modelIdentityRefusal(job, cfg);",
        "    const identityRefusal = null;",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post({
          ...framePlanBody(buildId),
          generationRequest: Presentation.generationRequestDeclaration({
            surface: "compiled-frame", viewMode: "advanced",
            selectedOptionId: OTHER_OPTION_ID, selectedModelId: OTHER_MODEL_ID,
          }),
        });
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(result.status === 200,
          `THE DEFECT: a request set up for a model this route cannot dispatch was sent to ${IMAGE_MODEL_ID} — HTTP ${result.status}, and the job row records selectedModelId ${JSON.stringify((h.ledger()[0] || {}).selectedModelId)} beside model ${JSON.stringify((h.ledger()[0] || {}).model)}`);
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
    "a bounded run cannot exceed the spend it was authorised for", async (phase) => {
      /* RE-SEATED. The projected-spend line changed shape when the unknown-cost guard
         landed above it, and this anchor kept pointing at the old one — so loadModified()
         raised "anchor no longer exists", the old harness counted that AssertionError as
         a detection, and the control reported green having mutated nothing. That false
         green is what the phase discipline and UnsafeBehaviourObserved above exist to
         make impossible; this is the anchor it was hiding. */
      const falGeneration = loadModified("fal-generation.js", [[
        "      const projected = Number(spent.amount || 0) + pendingAmount;",
        "      const projected = Number(spent.priced?.amount || 0) + pendingAmount;",
      ]]);
      phase("MUTATION_LANDED");
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
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(third.status === 200,
          `THE DEFECT: a run authorised for $0.12 dispatched a third $0.06 job — HTTP ${third.status}, ${h.calls.length} provider calls, total estimated ${h.ledger().reduce((sum, row) => sum + Number(row.accounting?.estimate?.amount || 0), 0)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     8. THE COVERAGE JOIN, TURNED INTO AN OPINION.

     The dialog renders the compiler's coverage record and judges nothing. The way that
     stops being true is not a rewrite — it is a filter that looks like tidying: drop the
     entries with nothing good to say, and a request missing a piece of the filmmaker's
     direction presents a clean bill of health. */
  await control("a coverage projection that quietly drops what CineBraid decided not to send",
    "the boundary reports the compiler's record whole", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        `function labelledCoverage(coverage) {
  return (Array.isArray(coverage) ? coverage : []).map((entry) => ({`,
        `function labelledCoverage(coverage) {
  return (Array.isArray(coverage) ? coverage : []).filter((entry) => entry?.state !== "omitted-by-design").map((entry) => ({`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        /* The still-image plan preview is where a filmmaker reads coverage before paying.
           A frame plan for a fully directed shot always carries deliberate omissions — a
           still has no duration and carries no sound — and each one is a decision the
           compiler recorded with a reason. Dropping them is the tidying that looks
           harmless and turns "here is what I did not send you" into silence. */
        const preview = await h.plan({ purpose: "frame", shotId: "SH-1", sourceBuildId: buildId });
        assert.strictEqual(preview.status, 200, `the plan preview must compile: ${JSON.stringify(preview.data)}`);
        const coverage = preview.data.coverage || [];
        assert(coverage.length > 0, "the unsafe path must actually produce a coverage record");
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(!coverage.some((entry) => entry.state === "omitted-by-design"),
          `THE DEFECT: every intent CineBraid decided not to send was filtered out of the record the dialog reads — ${coverage.length} entries survived and not one of them admits anything was left out`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9. A SURFACE TAKEN ON ITS OWN WORD.  [reviewer blocker 1]

     The exact defect the reviewer reproduced on the held candidate: `reference-automation`
     was legal for any entity-reference request, so naming it was enough to keep a 4K size
     under Simple. Remove the structural proof and the forgery works again. */
  await control("a paid surface any request may promote itself to",
    "a client request cannot promote itself to the coverage surface", async (phase) => {
      /* THE SURFACE GUARD, REMOVED. `reference-automation` becomes available to any
         entity-reference request again, which is what the first two candidates shipped
         and what two reviewers in a row walked straight through. The request below
         carries every client-visible coverage marker; what it does not have — and what no
         request can have — is the trusted operation descriptor the coverage route builds. */
      const falGeneration = loadModified("fal-generation.js", [[
        `    if (trusted?.surface !== "reference-automation") return asked.filter(notCoverageAutomation);
    const sameEntity = String(trusted?.entityList || "") === String(body?.entityList || "")
      && String(trusted?.entityId || "") === String(body?.entityId || "");
    return sameEntity ? asked : asked.filter(notCoverageAutomation);`,
        `    return asked;`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        const result = await h.post({
          purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
          sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
          references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
          /* 3:4 — this posts to the PUBLIC route, where there is no trusted descriptor, so
             the entitled format is the characters list's own. A hand-rolled bypass sends
             whatever gets it through, and 16:9 here would simply be refused by the aspect
             gate before this control could observe its own harm: the surface promotion
             would go unmeasured while the control reported green for another gate's work. */
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "3:4",
          coverageJobType: "sheet", coverageSheetType: "angles",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        });
        assert.strictEqual(result.status, 200, `the unsafe path must actually run: ${JSON.stringify(result.data)}`);
        assert.strictEqual(h.calls.length, 1, "and must actually reach the provider");
        phase("UNSAFE_PATH_EXECUTED");
        const row = h.ledger()[0];
        observeHarm(row.resolution === "4k",
          `THE DEFECT: an ordinary entity request on the PUBLIC route named the coverage surface and kept a 4K size Simple never offered — the job records resolution ${JSON.stringify(row.resolution)}, removedPayloadKeys ${JSON.stringify(row.removedPayloadKeys)} and generationSurface ${JSON.stringify(row.generationSurface)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9a. A GENERIC PROJECT SAVE THAT MAY WRITE THE MACHINE'S OWN RECORD.

     Blocker 1's harm on its own terms, with no surface involved. An independent reviewer
     sent an ordinary project PUT carrying `id: OLD, status: completed, completedAt:
     <stale>` against the CURRENT ETag, and the authoritative run — live, with the
     server's identity and jobs — took the terminal status and the stale timestamp. */
  await control("a generic project save that may write the machine's own coverage lifecycle",
    "the authoritative coverage run survives an ordinary save byte-equivalent", async (phase) => {
      const ownership = loadModified("public/shared-coverage.js", [[
        `        const owned = stored.get(String(entity.id));
        if (owned === undefined) delete entity.coverageAutomation;
        else entity.coverageAutomation = JSON.parse(JSON.stringify(owned));`,
        /* The exception the previous candidate shipped: identity from the server, and
           terminal lifecycle fields from whatever the save happened to carry. */
        `        const owned = stored.get(String(entity.id));
        if (owned === undefined) { delete entity.coverageAutomation; continue; }
        const supplied = entity.coverageAutomation && typeof entity.coverageAutomation === "object" ? entity.coverageAutomation : {};
        const merged = JSON.parse(JSON.stringify(owned));
        for (const field of ["status", "completedAt"]) {
          if (!Object.prototype.hasOwnProperty.call(supplied, field)) continue;
          if (field === "status" && ["starting", "sheet-running", "individual-running"].includes(String(supplied.status || ""))) continue;
          merged[field] = JSON.parse(JSON.stringify(supplied[field]));
        }
        entity.coverageAutomation = merged;`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGenerationReal);
      try {
        const LIVE = { id: "NEW", list: "characters", entityId: "KAI", mode: "sheet", sheetType: "angles", status: "sheet-running", startedAt: "2026-08-27T00:00:00.000Z", jobs: ["job-1"] };
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [], coverageAutomation: LIVE });
        h.saveProject(project);
        /* THE REVIEWER'S PUT: a stale OLD/completed over the live NEW. */
        h.genericSave((successor) => {
          successor.characters[0].coverageAutomation = {
            id: "OLD", list: "characters", entityId: "KAI", status: "completed",
            completedAt: "2020-01-01T00:00:00.000Z", jobs: ["ghost"],
          };
        }, ownership.preserveServerOwnedCoverageRuns);
        const after = h.project().characters[0].coverageAutomation;
        assert(after, "the unsafe path must leave a run to inspect");
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(JSON.stringify(after) !== JSON.stringify(LIVE),
          `THE DEFECT: a generic project save rewrote the machine's own lifecycle — the authoritative run was ${JSON.stringify(LIVE)} and is now ${JSON.stringify(after)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9b. LIVE COVERAGE STATE ESTABLISHED BEFORE THE SHARED BOUNDARY ACCEPTS.

     THE PRODUCTION DEFECT, EXACTLY. The first version of this control only disabled the
     route's shallow job-type validation, and an independent reviewer showed that proved
     nothing about the harm they had found: a coverage route that persists `sheet-running`
     and THEN enters the shared paid boundary leaves a live run behind for every request
     the boundary refuses — a machine-owned claim that work was under way that never began.

     So the mutation moves the establishment back to where it used to be: run first, then
     boundary. The request is then refused for a missing generation plan, which is the
     reviewer's own reproduction, and the false live run is read back off the entity. */
  await control("a coverage run established before the shared paid boundary has accepted",
    "a refused coverage request leaves no live run", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        /* The hook fires at the dispatch-commit point; this makes the route fire it up
           front instead, exactly as the held candidate did. */
        /* The anchor moved with the seam: the descriptor now carries the coverage
           permit the route mints before dispatching. Re-armed at the moved seam rather
           than deleted — a control that quietly stops matching proves nothing. */
        `    return guardRoute(res, dispatchGenerationRequest(req, res, {
      surface: "reference-automation",
      permit: { ...coveragePermit, transition },
      entityList: list,
      entityId,`,
        `    const early = {
      surface: "reference-automation",
      permit: { ...coveragePermit, transition },
      entityList: list,
      entityId,`,
      ], [
        `        });
      },
    }));
  });`,
        `        });
      },
    };
    await early.onDispatchCommit(owner, { id: "early-run-job" });
    return guardRoute(res, dispatchGenerationRequest(req, res, { ...early, onDispatchCommit: undefined }));
  });`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        /* A valid coverage operation whose request the SHARED boundary will refuse: no
           generation plan declaration at all. */
        const result = await h.coverage({
          purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
          sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
          references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
          coverageJobType: "sheet", coverageSheetType: "angles",
        });
        /* The early establishment must ACTUALLY have happened, or the ordering defect is
           not what this control is exercising. */
        const run = h.project().characters[0].coverageAutomation;
        assert(run && run.status === "sheet-running",
          `the unsafe path must actually establish the run early: ${JSON.stringify(run)}`);
        /* And the shared boundary must ACTUALLY refuse, for its own reason. */
        assert.strictEqual(result.status, 400, `the boundary must refuse the request: ${JSON.stringify(result.data)}`);
        assert.strictEqual(result.data.code, "GENERATION_PLAN_REQUIRED", "for the missing plan");
        assert.strictEqual(h.calls.length, 0, "with no provider call");
        assert.strictEqual(h.ledger().length, 0, "and no ledger row");
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(Boolean(run) && run.status === "sheet-running",
          `THE DEFECT: a coverage request the shared boundary refused for a missing plan left a live run behind — ${JSON.stringify(run)} with ${h.calls.length} provider call(s) and ${h.ledger().length} ledger row(s)`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9c. THE PROJECTION WRITTEN BEFORE THE TRUTH IT PROJECTS.

     Two files, two persistence chains, and an earlier version of this route wrote the
     coverage run first and called the pair "one durable turn". An independent reviewer
     stopped the process between them and read `sheet-running` carrying a job id that no
     ledger had ever heard of, with zero provider calls.

     The mutation puts the writes back in that order and stops the process straight after
     the first one. What is observed is what a cold reader finds on disk — not an
     exception, not a log line. */
  await control("a coverage projection written before the job that justifies it",
    "persisted coverage never claims paid generation the ledger cannot justify", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        /* The anchor moved with the seam: the ledger turn now also consumes the dispatch
           permit, because single-use has to be decided inside the same indivisible write.
           Re-armed where the seam went. */
        `    try {
      await commit(owner, (current) => {
        const spent = current.find((item) => String(item?.paidPermitId || "") === String(membership.id || ""));`,
        `    if (typeof trusted?.onDispatchCommit === "function") await trusted.onDispatchCommit(owner, job);
    if (trusted) throw new Error("process stopped between the two durable writes");
    try {
      await commit(owner, (current) => {
        const spent = current.find((item) => String(item?.paidPermitId || "") === String(membership.id || ""));`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        await h.coverage({
          purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
          sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
          references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
          coverageJobType: "sheet", coverageSheetType: "angles", clientRequestId: "ordering",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        });
        /* READ OFF DISK. The inconsistency has to be independently observable, or this is
           an assertion about source order rather than about durable state. */
        const durable = h.durable();
        assert.strictEqual(h.calls.length, 0, "the unsafe path must stop before any provider call");
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(durable.coverage.length > 0 && durable.jobs.length === 0,
          `THE DEFECT: the coverage store claims paid generation is live and the ledger has never heard of it — coverage ${JSON.stringify(durable.coverage)} against ${durable.jobs.length} job(s) and ${h.calls.length} provider call(s)`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9d. AN ACKNOWLEDGEMENT THAT CANNOT BE PERSISTED, LEFT LOOKING HEALTHY.

     The provider accepted and returned its request id; both acknowledgement writes fail;
     the only place that id ever existed is a response object in memory. The job half is
     already handled — an in-flight row with no handle blocks its own duplicate — but the
     coverage board went on presenting the run as running, which is the half that tells a
     filmmaker nothing is wrong. */
  await control("an unpersistable acknowledgement that leaves the coverage run running",
    "a run whose provider answer could not be recorded asks for attention", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        `        await updateEntityCoverageRun(owner, job, "needs-attention",
          job.unresolvedReason || \`CineBraid could not record the provider's answer: \${persistError.message}\`).catch(() => {});`,
        `        /* control: the coverage projection is left saying the run is healthy */`,
      ], [
        `      const outcome = await submit(owner, job, job.references, preparedLegacy);
      try {
        await commit(owner, (current) => {`,
        `      const outcome = await submit(owner, job, job.references, preparedLegacy);
      try {
        await Promise.reject(new Error("acknowledgement store unavailable"));
        await commit(owner, (current) => {`,
      ], [
        `          Object.assign(job, row);
        }).catch(() => {});`,
        `          Object.assign(job, row);
        }).then(() => { throw new Error("second acknowledgement write also failed"); }).catch(() => {});`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        const result = await h.coverage({
          purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
          sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
          references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
          coverageJobType: "sheet", coverageSheetType: "angles", clientRequestId: "ack",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        });
        assert.strictEqual(result.status, 502, `the unsafe path must actually reach the failure: ${JSON.stringify(result.data)}`);
        assert.strictEqual(h.calls.length, 1, "with the provider genuinely contacted — a paid request may exist");
        phase("UNSAFE_PATH_EXECUTED");
        const run = h.durable().coverage[0];
        observeHarm(Boolean(run) && ["starting", "sheet-running", "individual-running"].includes(String(run.status)),
          `THE DEFECT: the provider was told about a paid request CineBraid could not record, and the coverage board still reads ${JSON.stringify(run && run.status)} — ${JSON.stringify(run)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9e. REFRESH THAT READS A MISSING HANDLE AS FAILURE, AND BILLS TWICE FOR IT.

     THE HISTORICAL BUG, end to end. collectJob()'s no-handle guard covered UNRESOLVED
     only, so a durable `SUBMITTING` row with no handle fell through to a provider poll
     built out of an absent URL; the poll failed; the catch persisted FAILED; FAILED does
     not block resubmission; and the next request for the same production result with a
     fresh clientRequestId sent a SECOND paid submission.

     The mutation narrows the guard back to UNRESOLVED. What is observed is the persisted
     FAILED and then the provider actually being contacted a second time — the bill, not
     the status. */
  await control("a refresh that reads a missing provider handle as failure",
    "an uncertain submission is never turned into a failure that permits a retry", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        `      if (Lifecycle.isSubmissionUncertainWithoutHandle(job, "externalId")) {`,
        "      if (Lifecycle.isUnresolved(job) && !job.externalId) {",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
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
        await h.refresh("uncertain-1");
        /* THE PERSISTED INCONSISTENCY, read off disk before anything is retried. */
        const afterRefresh = h.durable().jobs.find((row) => row.id === "uncertain-1");
        assert.strictEqual(afterRefresh.status, "FAILED",
          `the unsafe path must actually persist the false failure: ${JSON.stringify(afterRefresh.status)}`);
        /* And the retry must genuinely be attempted, or the bill is not what is measured. */
        const retry = await h.coverage({
          purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
          sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
          references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
          /* 4:3 — an EXPRESSION sheet, whose format the coverage operation decides and
             which is not the angle sheet's 16:9. */
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "4:3",
          coverageJobType: "sheet", coverageSheetType: "expressions",
          clientRequestId: "a-different-press",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        });
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(retry.status === 200 && h.calls.length > 0,
          `THE DEFECT: refresh persisted ${JSON.stringify(afterRefresh.status)} for a submission that may already have been charged, and the equivalent retry then reached the provider — ${h.calls.length} paid submission(s) for one production result, across ${h.durable().jobs.length} job rows`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9f. A CANCEL THAT DECIDES THE PROVIDER NEVER TOOK THE REQUEST.

     The second half of the refresh defect, in the route next door. Cancel asked
     `isUnresolved(job) && !job.cancelUrl`, so a durable `SUBMITTING` row with no handle
     went past the guard; there was no cancel URL, so no provider was told anything; and
     CANCELLED was written from local intent alone. CANCELLED does not block resubmission.

     The mutation restores that question. What is observed is the persisted CANCELLED and
     then the provider actually being contacted for the same production result — the
     bill, not the status. */
  await control("a cancel that reads local intent as proof the provider never took it",
    "wanting a submission cancelled is never treated as evidence that it did not happen", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        `      if (Lifecycle.isSubmissionUncertainWithoutHandle(job, "cancelUrl"))`,
        `      if (Lifecycle.isUnresolved(job) && !job.cancelUrl)`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
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
        await h.cancel("uncertain-1");
        /* OFF DISK, before anything is retried. */
        const afterCancel = h.durable().jobs.find((row) => row.id === "uncertain-1");
        assert.strictEqual(afterCancel.status, "CANCELLED",
          `the unsafe path must actually persist the false cancellation: ${JSON.stringify(afterCancel.status)}`);
        const retry = await h.coverage({
          purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
          sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
          references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
          coverageJobType: "sheet", coverageSheetType: "angles",
          clientRequestId: "a-different-press",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        });
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(retry.status === 200 && h.calls.length > 0,
          `THE DEFECT: cancel persisted ${JSON.stringify(afterCancel.status)} for a submission that may already have been charged — with no provider contacted to justify it — and the equivalent retry then reached the provider: ${h.calls.length} paid submission(s) across ${h.durable().jobs.length} job rows`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9g. A REBUILT PROJECTION THAT REPORTS UNCERTAIN WORK AS RUNNING.

     A crash between the ledger write and the projection write leaves the job durable and
     its coverage record missing; refresh rebuilds the record from the row. The rebuild
     wrote `sheet-running` unconditionally, so a board recovered from an uncertain row
     told the filmmaker a sheet was on its way when nobody knew whether it existed.

     The mutation restores the unconditional status. What is observed is the pair of
     persisted facts read off disk: an uncertain job, and a projection calling it healthy. */
  await control("a reconstructed coverage record that calls an uncertain job healthy",
    "recovery describes an ambiguous durable row as ambiguous, not as ordinary running work", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        `        status: uncertain ? "needs-attention" : runningStatus,`,
        `        status: runningStatus,`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const project = h.project();
        /* The projection write is the one that never landed. */
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
        await h.refresh("uncertain-1");
        phase("UNSAFE_PATH_EXECUTED");
        const durable = h.durable();
        const job = durable.jobs.find((row) => row.id === "uncertain-1");
        assert.strictEqual(job.status, "SUBMITTING", "the job must still be the uncertain one the projection is describing");
        assert.strictEqual(h.calls.length, 0, "and nothing was asked of the provider");
        observeHarm(durable.coverage.length > 0 && ["sheet-running", "individual-running", "starting"].includes(String(durable.coverage[0].status)),
          `THE DEFECT: the durable job is ${JSON.stringify(job.status)} with no request id to check it by, and the rebuilt coverage record reports ${JSON.stringify(durable.coverage[0] && durable.coverage[0].status)} — ${JSON.stringify(durable.coverage[0])}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     9h. AN ENTITY STRIP THAT DRAWS AN UNCERTAIN SUBMISSION AS RUNNING WORK.

     The screen where reference and coverage work lives had no uncertainty branch, so a
     submission CineBraid could not account for was drawn as an ordinary running job. The
     harm is not cosmetic: the only control that resolves that state was absent, and a
     Cancel the route refuses stood where it should have been.

     The mutation removes the branch. What is observed is the markup itself — the shipped
     browser source, evaluated and called. */
  await control("an entity strip that draws an uncertain submission as running work",
    "every generation surface offers the reconciliation control for an uncertain submission", async (phase) => {
      const vm = require("vm");
      const { code } = modifiedSource("public/fal-generation.js", [[
        /* REFERENCE CREATION REVIEW V1 — the entity strip now computes its delivered
           count between these two lines, so the anchor is the shortest text that is still
           unique to this strip. The mutation and what it proves are unchanged. */
        "  const unknown = falJobUnresolved(job);\n  /* R12",
        "  const unknown = false;\n  /* R12",
      ]]);
      phase("MUTATION_LANDED");
      const escape = (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const uncertainJob = {
        id: "job-1", purpose: "entity-reference", entityList: "characters", entityId: "KAI",
        status: "SUBMITTING", uncertain: true, model: "gpt-image-2", createdAt: "2026-08-28T00:00:00.000Z",
      };
      const sandbox = {
        window: {}, console, CONFIG: { generation: { fal: { enabled: true, apiKey: "k" } } },
        FAL_GENERATION_JOBS: [uncertainJob], esc: escape, attr: escape, fetch: async () => ({ ok: true, json: async () => ({}) }),
      };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(code, sandbox, { filename: "public/fal-generation.js" });
      assert.strictEqual(typeof sandbox.falEntityGenerationInline, "function", "the mutated renderer must still be callable");
      const markup = sandbox.falEntityGenerationInline("characters", "KAI");
      phase("UNSAFE_PATH_EXECUTED");
      observeHarm(!markup.includes("Check and resolve") && markup.includes("cancelFalGeneration"),
        `THE DEFECT: a submission the server reports as uncertain is drawn with no way to resolve it and a Cancel the route refuses — ${markup}`);
    });

  /* =======================================================================
     9i. A CANCELLATION NOBODY CONFIRMED, PERSISTED ANYWAY.

     The cancel route discarded the provider's response entirely, so a 503, a 404 and a
     dropped connection all reached the same write. CANCELLED does not block
     resubmission, so a failed cancel handed the filmmaker permission to buy the same
     shot again while the original render may still have been running and still charged.

     The mutation restores the discard. What is observed is the persisted CANCELLED and
     then the provider actually being contacted for the same production result. */
  await control("a cancellation persisted without the provider confirming it",
    "CineBraid records a cancellation only when the provider confirmed one", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "        if (!response || !response.ok) {",
        "        if (false && !response) {",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const project = h.project();
        project.characters.push({ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] });
        h.saveProject(project);
        h.seedLedger([{
          id: "refusing-cancel", provider: "fal", purpose: "entity-reference", status: "UNRESOLVED",
          entityList: "characters", entityId: "KAI", entityType: "character",
          coverageJobType: "sheet", coverageSheetType: "angles",
          sourceBuildId: "entity-fixture", outputCount: 1, clientRequestId: "original-press",
          prompt: "Kai against neutral grey.", createdAt: "2026-08-28T00:00:00.000Z",
          externalId: "req-a", cancelUrl: `${h.mockOrigin()}/cancel-503/req-a`,
        }]);
        await h.cancel("refusing-cancel");
        /* OFF DISK, before anything is retried. */
        const afterCancel = h.durable().jobs.find((row) => row.id === "refusing-cancel");
        assert.strictEqual(afterCancel.status, "CANCELLED",
          `the unsafe path must actually persist the unconfirmed cancellation: ${JSON.stringify(afterCancel.status)}`);
        assert.strictEqual(h.cancelCalls.length, 1, "with the provider having genuinely refused");
        const retry = await h.coverage({
          purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
          sourceBuildId: "entity-fixture", prompt: "Kai against neutral grey.",
          references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
          coverageJobType: "sheet", coverageSheetType: "angles",
          clientRequestId: "a-different-press",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
        });
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(retry.status === 200 && h.calls.length > 0,
          `THE DEFECT: the provider refused the cancellation and CineBraid recorded ${JSON.stringify(afterCancel.status)} anyway, and the equivalent retry then reached the provider — ${h.calls.length} paid submission(s) across ${h.durable().jobs.length} job rows, while the original render may still be running`);
      } finally { h.close(); }
    });

  /* =======================================================================
     10. AN IDENTITY PAIR NOBODY CHECKS AGAINST ITSELF.  [reviewer blocker 2] */
  await control("a boundary that reads the model half of an identity and ignores the option",
    "a request whose own two names disagree is refused", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    if (optionId) {",
        "    if (false && optionId) {",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post({
          ...framePlanBody(buildId),
          generationRequest: Presentation.generationRequestDeclaration({
            surface: "compiled-frame", viewMode: "advanced",
            selectedOptionId: OTHER_OPTION_ID, selectedModelId: IMAGE_MODEL_ID,
          }),
        });
        assert.strictEqual(result.status, 200, `the unsafe path must actually run: ${JSON.stringify(result.data)}`);
        phase("UNSAFE_PATH_EXECUTED");
        const row = h.ledger()[0];
        observeHarm(row.selectedOptionId === OTHER_OPTION_ID,
          `THE DEFECT: a request naming option ${JSON.stringify(row.selectedOptionId)} beside model ${JSON.stringify(row.selectedModelId)} dispatched to ${JSON.stringify(row.model)}, and the ledger now records a pair describing a screen that cannot have existed`);
      } finally { h.close(); }
    });

  /* =======================================================================
     10b. THE SAME CHECK, SKIPPED BY LEAVING THE OTHER HALF OUT.

     Control 10 proves the pair check catches a disagreeing pair. It cannot say anything
     about a request that names ONE half, and for as long as the guard was scoped to
     `claimed && optionId` that was the way past it: omit selectedModelId and the
     mintability question was never asked, while applyRequestTruth had already written the
     impossible id onto the row. The mutation restores that scope. */
  await control("an option identity checked only when a model id happens to accompany it",
    "an option identity CineBraid could not have issued is refused however it arrives", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "    if (optionId) {",
        "    if (claimed && optionId) {",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration);
      try {
        const buildId = seedFramePackage(h);
        const result = await h.post({
          ...framePlanBody(buildId),
          generationRequest: Presentation.generationRequestDeclaration({
            surface: "compiled-frame", viewMode: "advanced",
            /* Well-formed, and impossible — the same id the reviewer used to break the
               pair check, arriving without the half that used to switch the check on. */
            selectedOptionId: `${IMAGE_MODEL_ID}::not-a-real-surface::not-a-real-mode`,
          }),
        });
        assert.strictEqual(result.status, 200, `the unsafe path must actually run: ${JSON.stringify(result.data)}`);
        assert.strictEqual(h.calls.length, 1, "and must actually reach the provider");
        phase("UNSAFE_PATH_EXECUTED");
        const row = h.ledger()[0];
        observeHarm(String(row.selectedOptionId).includes("not-a-real-surface"),
          `THE DEFECT: a lone option id ${JSON.stringify(row.selectedOptionId)} CineBraid could never have minted was dispatched and durably recorded as the option a filmmaker chose`);
      } finally { h.close(); }
    });

  /* =======================================================================
     10c. A REFUSAL THAT REACHED NO PROVIDER, FILED AS A PROVIDER FAULT.

     The classifier used to enumerate the two refusal codes that existed when Batch 1B
     wrote it. Restore that scope and every refusal this boundary has added since falls
     through to the `provider` default — misnamed on the durable run, recorded as
     `providerContacted: true`, and spending an authorised attempt through a retry gate
     that reads failureClass.

     The mutation is in the shipped browser source and the harm is read from the shipped
     classifier, so this control never leaves the property it is about. */
  await control("a runner that recognises pre-provider refusals by an enumerated code list",
    "a refusal that reached no provider is not a provider fault", async (phase) => {
      const { code } = modifiedSource("public/automation.js", [[
        "  if (error?.providerContacted === false) return \"local-preflight\";\n  return \"provider\";",
        "  return \"provider\";",
      ]]);
      phase("MUTATION_LANDED");
      const sandbox = {
        window: {}, console,
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        setTimeout, clearTimeout, setInterval, clearInterval,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(code, sandbox, { filename: "public/automation.js" });
      assert.strictEqual(typeof sandbox.v626FailureClass, "function", "the mutated classifier must be reachable");
      /* The exact shape the dispatcher builds from a stale-package refusal. */
      const stale = { code: "GENERATION_PACKAGE_STALE", providerContacted: false };
      const failureClass = sandbox.v626FailureClass(stale);
      const deterministic = sandbox.v626IsDeterministicLocalFailure(stale);
      phase("UNSAFE_PATH_EXECUTED");
      observeHarm(failureClass === "provider" && deterministic === false,
        `THE DEFECT: a request the money boundary refused before contacting anything was classified ${JSON.stringify(failureClass)}, `
        + `so the run records providerContacted:${!deterministic} and Retry Failed Step spends an authorised attempt on a request that reached no provider`);
    });

  /* =======================================================================
     11. A BUDGET COMPARED IN BINARY FLOATING POINT.  [reviewer blocker 3] */
  await control("a spend ceiling compared with a raw floating-point greater-than",
    "meeting a budget exactly is not exceeding it", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "      if (usdExceeds(projected, authorized.amount))",
        "      if (projected > Number(authorized.amount))",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration, { ratePerImage: 0.1 });
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
        const first = await h.post(runBody("e1"));
        const second = await h.post(runBody("e2"));
        assert.strictEqual(first.status, 200, `the authorised work must actually run: ${JSON.stringify(first.data)}`);
        assert.strictEqual(second.status, 200, `and the second: ${JSON.stringify(second.data)}`);
        await h.settle(first.data.job.id);
        await h.settle(second.data.job.id);
        const third = await h.post(runBody("e3"));
        const total = h.ledger().reduce((sum, row) => sum + Number(row.accounting?.estimate?.amount || 0), 0);
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(third.status !== 200,
          `THE DEFECT: three $0.10 children exactly meet a $0.30 ceiling and the third was refused — HTTP ${third.status}, ${JSON.stringify(third.data.error)}, raw float total ${total}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     12. AN UNKNOWN COST READ AS ZERO.  [reviewer blocker 4] */
  await control("an unpriceable child whose unknown cost falls back to zero",
    "a ceiling that cannot be checked has not been honoured", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        `      const pendingAmount = pending.estimate?.confidence === "estimated" ? Number(pending.estimate.amount) : null;
      if (!Number.isFinite(pendingAmount))`,
        `      const pendingAmount = Number(pending.estimate?.amount) || 0;
      if (false)`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration, { ratePerImage: 0 });
      try {
        const buildId = seedFramePackage(h);
        const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        h.saveRuns([{
          id: "run-unknown", schemaVersion: 2, revision: 1, status: "running",
          runnerId: "runner-unknown", leaseExpiresAt: lease,
          config: { maxImages: 9, outputsPerRequest: 1, maxSpend: { priced: true, amount: 0.3, quantity: 3, unitBasis: "image", ratePerUnit: 0.1 } },
          usage: { imagesGenerated: 0 }, steps: {}, logs: [],
        }]);
        const result = await h.post({
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
          sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
          aspectRatio: "16:9", outputCount: 1, quality: "high", resolution: "1k", clientRequestId: "u1",
          automationRunId: "run-unknown", automationStepKey: "u1", automationRunnerId: "runner-unknown",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
        });
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(result.status === 200,
          `THE DEFECT: a child CineBraid could not price dispatched under a numeric $0.30 ceiling — HTTP ${result.status}, ${h.calls.length} provider call(s), and the job records ${JSON.stringify(h.ledger()[0]?.accounting?.estimate)}`);
      } finally { h.close(); }
    });

  /* =======================================================================
     13. AN INCOMPLETE TOTAL READ AS A COMPLETE ONE.  [reviewer blocker 4b] */
  await control("a spend bound that omits the run's own children of unknown cost",
    "a known subtotal below a ceiling is not proof the run is inside it", async (phase) => {
      const falGeneration = loadModified("fal-generation.js", [[
        "      if (runJobs.length && spent.complete !== true)",
        "      if (false)",
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(falGeneration, { ratePerImage: 0.1 });
      try {
        const buildId = seedFramePackage(h);
        const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        h.saveRuns([{
          id: "run-partial", schemaVersion: 2, revision: 1, status: "running",
          runnerId: "runner-partial", leaseExpiresAt: lease,
          config: { maxImages: 9, outputsPerRequest: 1, maxSpend: { priced: true, amount: 0.3, quantity: 3, unitBasis: "image", ratePerUnit: 0.1 } },
          usage: { imagesGenerated: 0 }, steps: {}, logs: [],
        }]);
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
            basis: { unitBasis: "image", quantity: 1, unpricedReason: "no-configured-rate" } },
        }]);
        const result = await h.post({
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
          sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
          aspectRatio: "16:9", outputCount: 1, quality: "high", resolution: "1k", clientRequestId: "p1",
          automationRunId: "run-partial", automationStepKey: "p1", automationRunnerId: "runner-partial",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
        });
        phase("UNSAFE_PATH_EXECUTED");
        observeHarm(result.status === 200,
          `THE DEFECT: a run holding a child of unknown cost authorised another paid child on the strength of its $0.10 known subtotal — HTTP ${result.status}, ${h.calls.length} provider call(s)`);
      } finally { h.close(); }
    });

  /* =======================================================================
     14. A RENDERER THAT REORDERS THE COMPILER'S RECORD.  [reviewer blocker 5]

     Not a safety defect and it is here for the same reason the others are: the compiler
     decides what a shot's direction is and in what order, and a panel that regroups it is
     quietly publishing a different sequence as the true one. */
  await control("a coverage panel that groups the compiler's rows by state",
    "the record is rendered in the compiler's own order", async (phase) => {
      const view = fs.readFileSync(path.join(ROOT, "public", "generation-view.js"), "utf8").replace(/\r\n/g, "\n");
      const anchor = `  const shown = view === "advanced" ? rows : unsupported;`;
      assert(view.includes(anchor), "negative control anchor no longer exists in public/generation-view.js");
      const mutated = view.replace(anchor, `  const shown = view === "advanced" ? [...unsupported, ...omitted, ...carried] : unsupported;`);
      assert.notStrictEqual(mutated, view, "the mutation must change something");
      phase("MUTATION_LANDED");

      const context = {
        window: {}, localStorage: { getItem: () => null, setItem: () => {} },
        esc: (value) => String(value == null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
        attr: (value) => String(value == null ? "" : value).replace(/"/g, "&quot;"),
        ...Presentation,
      };
      vm.createContext(context);
      vm.runInContext(mutated, context, { filename: "public/generation-view.js" });

      /* A record whose compiler order deliberately interleaves the states. */
      const coverage = [
        { intent: "action.primary", label: "principal action", state: "represented", via: "prompt" },
        { intent: "camera.movement", label: "camera movement", state: "omitted-by-design", reason: "A still holds one instant." },
        { intent: "reproducibility.seed", label: "seed", state: "unsupported", reason: "No seed." },
        { intent: "identity.canon", label: "approved identity canon", state: "anchored", via: "the approved identity references" },
      ];
      const markup = context.generationCoverageMarkup(coverage, "advanced");
      const rendered = [...markup.matchAll(/<li data-coverage-state="[^"]*"><span>([^<]*)<\/span>/g)].map((m) => m[1]);
      assert.strictEqual(rendered.length, coverage.length, "the unsafe path must actually render every row");
      phase("UNSAFE_PATH_EXECUTED");
      observeHarm(JSON.stringify(rendered) !== JSON.stringify(coverage.map((entry) => entry.label)),
        `THE DEFECT: the panel published its own sequence — the compiler emitted ${JSON.stringify(coverage.map((e) => e.label))} and the screen shows ${JSON.stringify(rendered)}`);
    });

  /* =========================================================================
     THE SECOND BOUNDED RUN, AND THE TWO WAYS ITS BOUND STOPS BEING ONE.

     Coverage automation multiplies one press into several paid requests. A bound on it can
     fail in two independent ways — the boundary can decline to check it, or the work can
     be allowed to restate it — and a suite that only proves the first would go on passing
     while the second put the run back where it started. So there is a control for each. */

  /* A COVERAGE RUN'S PRESS IS QUOTED, AND WHAT THAT PRESS AUTHORISED IS ENFORCED HERE. */
  const coverageSlot = (n, extra = {}) => ({
    purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
    prompt: "Kai from the requested angle.", references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
    /* A character card's own format, from the shared resolver the boundary asks — a
       literal here would be refused by the aspect gate before the bound could answer. */
    outputCount: 3, quality: "high", resolution: "4k", aspectRatio: referenceAspectLabel("characters"),
    coverageJobType: "slot", coverageSheetType: "", coverageMode: "individual",
    targetCoverageSlotId: `slot-${n}`, clientRequestId: `ctrl-${n}`,
    coverageRequestCount: 2, coverageMaximumImages: 6,
    generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
    ...extra,
  });
  /* The entity a coverage run belongs to, and a job the provider DELIVERED. Cancelling
     would terminate the run through updateEntityCoverageRun(), and then the next request
     would be establishing a new run rather than continuing this one — which is the state
     these controls are about. */
  const seedCoverageEntity = (h) => {
    const project = h.project();
    project.characters = [{ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] }];
    h.saveProject(project);
  };
  const deliverJob = (h, jobId) => {
    const rows = h.ledger();
    const row = rows.find((item) => item.id === jobId);
    assert(row, `the job to deliver must exist: ${jobId}`);
    row.status = "COMPLETED";
    row.ingestedAt = "2026-08-29T00:00:00.000Z";
    h.seedLedger(rows);
  };

  await control("a money boundary that never asks what the coverage press authorised",
    "a coverage run cannot exceed the count one press authorised", async (phase) => {
      const mutated = loadModified("fal-generation.js", [[
        `    const coverageGuardError = coverageSubmissionError(owner, jobs, req.body, requestedOutputCount, membership);`,
        `    const coverageGuardError = null;`,
      ]]);
      phase("MUTATION_LANDED");

      const h = await harness(mutated);
      try {
        seedCoverageEntity(h);
        const first = await h.coverage(coverageSlot(1));
        assert.strictEqual(first.status, 200, `the establishing request must dispatch: ${JSON.stringify(first.data)}`);
        assert.strictEqual(h.project().characters[0].coverageAutomation.requestCount, 2,
          "and the run must record the press's own count, or this control is not about enforcement");
        deliverJob(h, first.data.job.id);
        const second = await h.coverage(coverageSlot(2));
        assert.strictEqual(second.status, 200, `and so must the second: ${JSON.stringify(second.data)}`);
        deliverJob(h, second.data.job.id);
        phase("UNSAFE_PATH_EXECUTED");

        const third = await h.coverage(coverageSlot(3));
        observeHarm(third.status === 200,
          `THE DEFECT: a coverage press authorised for 2 paid requests submitted a 3rd — ${h.calls.length} provider calls and ${h.ledger().length} ledger rows for a run quoted at 2 requests and 6 images`);
      } finally { h.close(); }
    });

  await control("a coverage run whose authorised figures are reassigned by every job of it",
    "a request cannot restate the ceiling it is judged by", async (phase) => {
      const mutated = loadModified("fal-generation.js", [[
        `          if (!continuing) {
            if (Number(req.body?.coverageRequestCount) > 0) run.requestCount = Number(req.body.coverageRequestCount);`,
        `          if (true) {
            if (Number(req.body?.coverageRequestCount) > 0) run.requestCount = Number(req.body.coverageRequestCount);`,
      ]]);
      phase("MUTATION_LANDED");

      const h = await harness(mutated);
      try {
        seedCoverageEntity(h);
        const first = await h.coverage(coverageSlot(1));
        assert.strictEqual(first.status, 200, `the establishing request must dispatch: ${JSON.stringify(first.data)}`);
        deliverJob(h, first.data.job.id);
        /* STILL INSIDE THE AUTHORISED COUNT, so it dispatches on its merits — and carries
           a larger quote while it does. Under the defect that is all it takes. */
        const second = await h.coverage(coverageSlot(2, { coverageRequestCount: 999, coverageMaximumImages: 9999 }));
        assert.strictEqual(second.status, 200, `the second authorised request must dispatch: ${JSON.stringify(second.data)}`);
        deliverJob(h, second.data.job.id);
        phase("UNSAFE_PATH_EXECUTED");

        const run = h.project().characters[0].coverageAutomation;
        const third = await h.coverage(coverageSlot(3, { coverageRequestCount: 999, coverageMaximumImages: 9999 }));
        observeHarm(third.status === 200,
          `THE DEFECT: the run's own second request rewrote the bound it was about to be judged by — the record now reads ${run.requestCount} requests / ${run.maximumImages} images against a press quoted at 2 / 6, and a 3rd paid request went out (${h.calls.length} provider calls)`);
      } finally { h.close(); }
    });

  await control("an automation run whose authorised bound is whatever its last progress update said",
    "an authorised run cannot restate its own ceiling through the progress route", async (phase) => {
      const mutatedRuns = loadModified("automation-runs.js", [[
        `    const config = preserveAuthorizedBound(
      source.config && typeof source.config === "object" ? source.config : plainObject(base.config),
      existing,
    );`,
        `    const config = source.config && typeof source.config === "object" ? source.config : plainObject(base.config);`,
      ]]);
      phase("MUTATION_LANDED");

      const h = await harness(falGenerationReal);
      const runsApp = express();
      runsApp.use(express.json({ limit: "8mb" }));
      mutatedRuns.registerAutomationRuns(runsApp, {
        readConfig: () => ({}), readProject: () => h.project(), writeProject: () => {},
        activeSlug: () => "ctrl", projectDir: () => h.dir, projectDirForSlug: () => ({ slug: "ctrl", dir: h.dir, file: h.file }),
      });
      const runsServer = await listen(runsApp);
      try {
        const runsOrigin = originOf(runsServer);
        const RUNNER = "runner-1";
        h.saveRuns([{
          id: "automation-ctrl", schemaVersion: 2, revision: 1, type: "shot-chain", targetId: "SH-1", scope: "main",
          status: "running", runnerId: RUNNER, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
          config: { maxImages: 1, maxSpend: { priced: true, amount: 0.06, quantity: 1, unitBasis: "image", ratePerUnit: 0.06, rateSource: "configured" } },
          usage: { imagesGenerated: 0 }, steps: {}, logs: [],
        }]);
        const buildId = seedFramePackage(h);
        const step = (key) => declaredGenerationBody({
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A", sourceBuildId: buildId,
          prompt: "Kai sets the parcel down in the hangar.", aspectRatio: "16:9", outputCount: 1,
          clientRequestId: `ctrl-bound-${key}`,
          automationRunId: "automation-ctrl", automationStepKey: key, automationRunnerId: RUNNER,
          generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
        });

        const first = await h.post(step("step-1"));
        assert.strictEqual(first.status, 200, `the one authorised image must dispatch: ${JSON.stringify(first.data)}`);
        await h.settle(first.data.job.id);
        const capped = await h.post(step("step-2"));
        assert.strictEqual(capped.status, 409, `and the second must be refused while the bound holds: ${JSON.stringify(capped.data)}`);

        const stored = await (await fetch(`${runsOrigin}/api/automation/runs/automation-ctrl`)).json();
        const raise = await fetch(`${runsOrigin}/api/automation/runs/automation-ctrl`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...stored.run, runnerId: RUNNER,
            config: { maxImages: 500, maxSpend: { priced: true, amount: 999, quantity: 500, unitBasis: "image", ratePerUnit: 0.06, rateSource: "configured" } },
          }),
        });
        const raised = await raise.json();
        assert.strictEqual(raise.status, 200, `the progress update must be accepted: ${JSON.stringify(raised)}`);
        phase("UNSAFE_PATH_EXECUTED");

        const third = await h.post(step("step-3"));
        observeHarm(third.status === 200,
          `THE DEFECT: a run authorised for 1 image and $0.06 restated itself at ${raised.run.config.maxImages} images and $${raised.run.config.maxSpend?.amount} through the ordinary progress route, and the credit guard then let a further paid request through — ${h.calls.length} provider calls`);
      } finally { runsServer.close(); h.close(); }
    });

  /* =========================================================================
     THE PAID DISPATCH PERMIT.

     Membership in a bounded authorization is the thing these protect. Each control removes
     one part of the permit and shows the bound stops being one — which is the only way to
     know the assertions above are measuring the permit rather than something adjacent that
     happens to refuse. */

  const permitFrameBody = (buildId, extra = {}) => ({
    purpose: "frame", imagePlan: true, shotId: "SH-1", frameId: "FR-A", frameLabel: "A",
    sourceBuildId: buildId, prompt: "Kai sets the parcel down in the hangar.",
    aspectRatio: "16:9", outputCount: 1,
    generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "advanced" }),
    ...extra,
  });
  const permitScope = (buildId, extra = {}) => ({
    generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "advanced" }),
    purpose: "frame", shotId: "SH-1", frameId: "FR-A", sourceBuildId: buildId, outputCount: 1, ...extra,
  });

  await control("a money boundary that does not require a dispatch permit",
    "no provider-bound paid dispatch happens without redeeming a server-issued permit", async (phase) => {
      const mutated = loadModified("fal-generation.js", [[
        `    const permitGate = resolveDispatchPermit(owner, jobs, req, trusted);
    if (!permitGate.ok)`,
        `    const permitGate = { ok: true, membership: { id: "", permitClass: "direct", authorizationRef: "", stepKey: "", scopeFingerprint: "" } };
    if (false)`,
      ], [
        `    if (PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
        `    if (false && PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        const buildId = seedFramePackage(h);
        phase("UNSAFE_PATH_EXECUTED");
        const naked = await h.post(permitFrameBody(buildId, { clientRequestId: "no-permit" }), { permit: false });
        observeHarm(naked.status === 200,
          `THE DEFECT: a paid request carrying no dispatch permit reached the provider — ${h.calls.length} provider call(s) and ${h.ledger().length} ledger row(s) for work no authorization claimed`);
      } finally { h.close(); }
    });

  await control("a boundary that takes any well-formed permit id on the caller's word",
    "a permit CineBraid did not issue is refused", async (phase) => {
      const mutated = loadModified("fal-generation.js", [[
        `    if (found.ok) return { ok: true, membership: found.permit };`,
        `    if (found.ok) return { ok: true, membership: found.permit };
    if (found.reason === "unknown") return { ok: true, membership: { id: presented, permitClass: "direct", authorizationRef: "", stepKey: "", scopeFingerprint: PaidPermit.paidScopeFingerprint(dispatchScopeFor(req.body, { surface: "compiled-frame", declaration: { viewMode: "advanced" } }, normalizedPurpose(req.body), effectiveOutputCount(normalizedPurpose(req.body), req.body))) } };`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        const buildId = seedFramePackage(h);
        phase("UNSAFE_PATH_EXECUTED");
        const forged = await h.post(permitFrameBody(buildId, { clientRequestId: "forged", paidPermitId: `permit-${"a".repeat(32)}` }), { permit: false });
        observeHarm(forged.status === 200,
          `THE DEFECT: a permit id the caller invented was accepted as an authorization — ${h.calls.length} provider call(s) for a dispatch no server path minted`);
      } finally { h.close(); }
    });

  await control("a permit consumed outside the serialised ledger turn that writes the job",
    "one permit dispatches at most one paid job", async (phase) => {
      /* The check moves OUT of the commit callback and in front of it, which is where a
         reasonable implementation would put it and is exactly what makes it unsound: two
         requests can both read a ledger with no row before either writes one. */
      const mutated = loadModified("fal-generation.js", [[
        `      await commit(owner, (current) => {
        const spent = current.find((item) => String(item?.paidPermitId || "") === String(membership.id || ""));
        if (spent) {
          const error = new Error(\`This dispatch permit has already been redeemed by generation \${spent.id}. Nothing was submitted.\`);
          error.paidPermitRedeemed = spent.id;
          throw error;
        }
        current.push(job);
      });`,
        `      const preread = readJobs(owner).find((item) => String(item?.paidPermitId || "") === String(membership.id || ""));
      if (preread) {
        const error = new Error(\`This dispatch permit has already been redeemed by generation \${preread.id}. Nothing was submitted.\`);
        error.paidPermitRedeemed = preread.id;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      await commit(owner, (current) => { current.push(job); });`,
      ], [
        /* And the early ledger read has to go too, or it would answer instead. */
        `      const spent = jobs.find((item) => String(item?.paidPermitId || "") === presented);
      if (spent)`,
        `      const spent = null;
      if (spent)`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        const buildId = seedFramePackage(h);
        const issued = await h.permitFor(permitScope(buildId));
        assert(issued.data?.paidPermitId, `the control needs a real permit: ${JSON.stringify(issued.data)}`);
        phase("UNSAFE_PATH_EXECUTED");
        const both = await Promise.all([
          h.post(permitFrameBody(buildId, { clientRequestId: "race-a", paidPermitId: issued.data.paidPermitId }), { permit: false }),
          h.post(permitFrameBody(buildId, { clientRequestId: "race-b", paidPermitId: issued.data.paidPermitId }), { permit: false }),
        ]);
        const won = both.filter((result) => result.status === 200).length;
        observeHarm(won > 1,
          `THE DEFECT: one permit dispatched ${won} paid jobs concurrently — ${h.calls.length} provider calls against a single authorization`);
      } finally { h.close(); }
    });

  await control("automation membership read off the request body, with the scope check that also guards it removed",
    "an automation dispatch cannot detach from its run by omitting automationRunId", async (phase) => {
      /* TWO MUTATIONS, BECAUSE TWO GUARDS SUPPLY THIS PROPERTY. Correcting the body from
         the permit is the one under test; the scope fingerprint independently refuses a
         request whose declared surface is not the one the permit was minted for, and with
         it in place this control would report a green it had not earned — it would be
         measuring the fingerprint. Both come out, which is what makes the remaining
         question "does membership come from the permit". */
      const mutated = loadModified("fal-generation.js", [[
        `    if (membership.permitClass === "automation") {
      req.body = { ...(req.body && typeof req.body === "object" ? req.body : {}) };
      req.body.automationRunId = membership.authorizationRef;
      req.body.automationStepKey = membership.stepKey;
    }`,
        `    if (false) { req.body = { ...req.body }; }`,
      ], [
        `    if (PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
        `    if (false && PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      const runsApp = express();
      runsApp.use(express.json({ limit: "8mb" }));
      const { registerAutomationRuns } = require("../automation-runs");
      registerAutomationRuns(runsApp, {
        readConfig: () => ({}), readProject: () => h.project(), writeProject: () => {},
        activeSlug: () => "ctrl", projectDir: () => h.dir, projectDirForSlug: () => ({ slug: "ctrl", dir: h.dir, file: h.file }),
      });
      const runsServer = await listen(runsApp);
      try {
        const runsOrigin = originOf(runsServer);
        const buildId = seedFramePackage(h);
        const RUNNER = "runner-1";
        h.saveRuns([{
          id: "automation-detach", schemaVersion: 2, revision: 1, type: "shot-chain", targetId: "SH-1", scope: "main",
          status: "running", runnerId: RUNNER, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
          config: { maxImages: 1, maxSpend: { priced: true, amount: 0.06, quantity: 1, unitBasis: "image", ratePerUnit: 0.06, rateSource: "configured" } },
          usage: { imagesGenerated: 0 }, steps: {}, logs: [],
        }]);
        const revalidate = async (stepKey) => {
          const response = await fetch(`${runsOrigin}/api/automation/runs/automation-detach/lease/revalidate`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ runnerId: RUNNER, stepKey, paidScope: {
              purpose: "frame", surface: "automation-run", viewMode: "simple",
              shotId: "SH-1", frameId: "FR-A", entityList: "", entityId: "", buildId: "", outputCount: 1,
            } }),
          });
          return (await response.json()).paidPermitId;
        };
        const runBody = (extra) => ({
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A", prompt: "p",
          aspectRatio: "16:9", outputCount: 1, automationRunnerId: RUNNER,
          generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
          ...extra,
        });
        /* The run's single authorised image, spent honestly. */
        const first = await h.post(runBody({ clientRequestId: "step-1", automationRunId: "automation-detach", automationStepKey: "step-1", paidPermitId: await revalidate("step-1") }), { permit: false });
        assert.strictEqual(first.status, 200, `the authorised image must dispatch: ${JSON.stringify(first.data)}`);
        await h.settle(first.data.job.id);
        phase("UNSAFE_PATH_EXECUTED");
        /* The same work again, with the run omitted from the body. */
        const detached = await h.post(runBody({
          clientRequestId: "detached", paidPermitId: await revalidate("step-2"),
          generationRequest: Presentation.generationRequestDeclaration({ surface: "fixed-image", viewMode: "simple" }),
        }), { permit: false });
        observeHarm(detached.status === 200,
          `THE DEFECT: omitting automationRunId detached a second paid job from a run authorised for one image — ${h.calls.length} provider calls, and the row records ${JSON.stringify(h.ledger().find((item) => item.clientRequestId === "detached")?.paidAuthorization)}`);
      } finally { runsServer.close(); h.close(); }
    });

  await control("a permit accepted for a run or step other than the one it names",
    "a permit buys work only under the authorization it was minted for", async (phase) => {
      const mutated = loadModified("fal-generation.js", [[
        `      req.body.automationRunId = membership.authorizationRef;
      req.body.automationStepKey = membership.stepKey;`,
        `      req.body.automationRunId = String(req.body.automationRunId || membership.authorizationRef);
      req.body.automationStepKey = String(req.body.automationStepKey || membership.stepKey);`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      const runsApp = express();
      runsApp.use(express.json({ limit: "8mb" }));
      const { registerAutomationRuns } = require("../automation-runs");
      registerAutomationRuns(runsApp, {
        readConfig: () => ({}), readProject: () => h.project(), writeProject: () => {},
        activeSlug: () => "ctrl", projectDir: () => h.dir, projectDirForSlug: () => ({ slug: "ctrl", dir: h.dir, file: h.file }),
      });
      const runsServer = await listen(runsApp);
      try {
        const runsOrigin = originOf(runsServer);
        seedFramePackage(h);
        const RUNNER = "runner-1";
        const CAP = { priced: true, amount: 0.06, quantity: 1, unitBasis: "image", ratePerUnit: 0.06, rateSource: "configured" };
        h.saveRuns([
          { id: "run-spent", schemaVersion: 2, revision: 1, type: "shot-chain", targetId: "SH-1", scope: "main", status: "running", runnerId: RUNNER, leaseExpiresAt: "2099-01-01T00:00:00.000Z", config: { maxImages: 1, maxSpend: CAP }, usage: { imagesGenerated: 0 }, steps: {}, logs: [] },
          { id: "run-fresh", schemaVersion: 2, revision: 1, type: "shot-chain", targetId: "SH-1", scope: "blocking-only", status: "running", runnerId: RUNNER, leaseExpiresAt: "2099-01-01T00:00:00.000Z", config: { maxImages: 4, maxSpend: { ...CAP, amount: 0.24, quantity: 4 } }, usage: { imagesGenerated: 0 }, steps: {}, logs: [] },
        ]);
        const permitFor = async (runId) => {
          const response = await fetch(`${runsOrigin}/api/automation/runs/${runId}/lease/revalidate`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ runnerId: RUNNER, stepKey: "s1", paidScope: {
              purpose: "frame", surface: "automation-run", viewMode: "simple",
              shotId: "SH-1", frameId: "FR-A", entityList: "", entityId: "", buildId: "", outputCount: 1,
            } }),
          });
          return (await response.json()).paidPermitId;
        };
        const runBody = (extra) => ({
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A", prompt: "p",
          aspectRatio: "16:9", outputCount: 1, automationRunnerId: RUNNER, automationStepKey: "s1",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
          ...extra,
        });
        const first = await h.post(runBody({ clientRequestId: "spend-1", automationRunId: "run-spent", paidPermitId: await permitFor("run-spent") }), { permit: false });
        assert.strictEqual(first.status, 200, `run-spent's one image must dispatch: ${JSON.stringify(first.data)}`);
        await h.settle(first.data.job.id);
        phase("UNSAFE_PATH_EXECUTED");
        /* run-spent's permit, presented while the body names the run that still has budget. */
        const swapped = await h.post(runBody({ clientRequestId: "swapped", automationRunId: "run-fresh", automationStepKey: "s2", paidPermitId: await permitFor("run-spent") }), { permit: false });
        observeHarm(swapped.status === 200,
          `THE DEFECT: a permit minted for run-spent bought work charged to run-fresh — the row records ${JSON.stringify(h.ledger().find((item) => item.clientRequestId === "swapped")?.paidAuthorization)} and ${h.calls.length} provider calls were made`);
      } finally { runsServer.close(); h.close(); }
    });

  await control("a permit whose class is taken from the request rather than the issuance path",
    "an authorization cannot reclassify itself as independent direct work", async (phase) => {
      /* The scope fingerprint comes out for the same reason as the control above: it
         independently refuses a run-scoped permit presented under a direct surface, so
         leaving it in would measure it instead of the class. */
      const mutated = loadModified("fal-generation.js", [[
        `    if (found.ok) return { ok: true, membership: found.permit };`,
        `    if (found.ok) return { ok: true, membership: { ...found.permit, permitClass: String(req.body?.paidPermitClass || found.permit.permitClass), authorizationRef: req.body?.paidPermitClass === "direct" ? "" : found.permit.authorizationRef } };`,
      ], [
        `    if (PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
        `    if (false && PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      const runsApp = express();
      runsApp.use(express.json({ limit: "8mb" }));
      const { registerAutomationRuns } = require("../automation-runs");
      registerAutomationRuns(runsApp, {
        readConfig: () => ({}), readProject: () => h.project(), writeProject: () => {},
        activeSlug: () => "ctrl", projectDir: () => h.dir, projectDirForSlug: () => ({ slug: "ctrl", dir: h.dir, file: h.file }),
      });
      const runsServer = await listen(runsApp);
      try {
        const runsOrigin = originOf(runsServer);
        seedFramePackage(h);
        const RUNNER = "runner-1";
        h.saveRuns([{
          id: "run-classy", schemaVersion: 2, revision: 1, type: "shot-chain", targetId: "SH-1", scope: "main",
          status: "running", runnerId: RUNNER, leaseExpiresAt: "2099-01-01T00:00:00.000Z",
          config: { maxImages: 1, maxSpend: { priced: true, amount: 0.06, quantity: 1, unitBasis: "image", ratePerUnit: 0.06, rateSource: "configured" } },
          usage: { imagesGenerated: 0 }, steps: {}, logs: [],
        }]);
        const permit = async (stepKey) => {
          const response = await fetch(`${runsOrigin}/api/automation/runs/run-classy/lease/revalidate`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ runnerId: RUNNER, stepKey, paidScope: {
              purpose: "frame", surface: "automation-run", viewMode: "simple",
              shotId: "SH-1", frameId: "FR-A", entityList: "", entityId: "", buildId: "", outputCount: 1,
            } }),
          });
          return (await response.json()).paidPermitId;
        };
        const runBody = (extra) => ({
          purpose: "frame", shotId: "SH-1", frameId: "FR-A", frameLabel: "A", prompt: "p",
          aspectRatio: "16:9", outputCount: 1, automationRunnerId: RUNNER, automationRunId: "run-classy",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "automation-run", viewMode: "simple" }),
          ...extra,
        });
        const first = await h.post(runBody({ clientRequestId: "c1", automationStepKey: "s1", paidPermitId: await permit("s1") }), { permit: false });
        assert.strictEqual(first.status, 200, `the run's one image must dispatch: ${JSON.stringify(first.data)}`);
        await h.settle(first.data.job.id);
        phase("UNSAFE_PATH_EXECUTED");
        /* A run-scoped permit, presented with a body asking to be read as direct work. */
        const reclassified = await h.post(runBody({
          /* Both automation fields cleared: the credit guard refuses a half-named run
             outright, so leaving the step key behind would refuse for that instead and
             the control would never reach the reclassification it is about. */
          clientRequestId: "c2", automationStepKey: "", automationRunId: "", paidPermitClass: "direct",
          generationRequest: Presentation.generationRequestDeclaration({ surface: "compiled-frame", viewMode: "simple" }),
          imagePlan: true, sourceBuildId: h.ledger()[0].sourceBuildId, paidPermitId: await permit("s2"),
        }), { permit: false });
        observeHarm(reclassified.status === 200,
          `THE DEFECT: a run-scoped permit bought a second paid job by asking to be read as direct work — ${h.calls.length} provider calls against a one-image ceiling, recorded as ${JSON.stringify(h.ledger().find((item) => item.clientRequestId === "c2")?.paidAuthorization)}`);
      } finally { runsServer.close(); h.close(); }
    });

  await control("coverage membership restored to a comparison of presentation fields",
    "reclassified coverage work cannot escape or replace a live bounded authorization", async (phase) => {
      const mutated = loadModified("fal-generation.js", [[
        /* Re-armed at the moved seam: the route now resolves one transition rather than an
           authorization, so the defect is reintroduced by making that transition compare
           presentation fields again. */
        `    const transition = coverageTransitionFor(owner, coverageJobs, req.body, sheetType);`,
        `    const liveRun = (ownerProject(owner)[list] || []).find((row) => String(row?.id) === entityId)?.coverageAutomation;
    const presentationMatch = !!liveRun && COVERAGE_RUN_ACTIVE_STATUSES.includes(String(liveRun.status || ""))
      && String(liveRun.sheetType || "") === sheetType && String(liveRun.mode || "") === mode;
    const transition = presentationMatch
      ? { action: "govern", ref: String(liveRun.id || "") }
      : { action: "establish" };`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        seedCoverageEntity(h);
        const bounded = await h.coverage(coverageSlot(1, { coverageRequestCount: 1, coverageMaximumImages: 3 }));
        assert.strictEqual(bounded.status, 200, `the bounded press must dispatch: ${JSON.stringify(bounded.data)}`);
        const liveRun = JSON.stringify(h.project().characters[0].coverageAutomation);
        phase("UNSAFE_PATH_EXECUTED");
        const escaped = await h.coverage(coverageSlot(2, { coverageMode: "", coverageSheetType: "angles", coverageRequestCount: undefined, coverageMaximumImages: undefined }));
        observeHarm(escaped.status === 200,
          `THE DEFECT: blanking coverageMode detached byte-identical work from a run authorised for 1 request — ${h.calls.length} provider calls, and the live bounded run went from ${liveRun} to ${JSON.stringify(h.project().characters[0].coverageAutomation)}`);
      } finally { h.close(); }
    });

  await control("a live bounded coverage run replaced while its paid work is unsettled",
    "an authorization with paid work in flight is never destroyed by a later request", async (phase) => {
      /* Membership still comes from the permit; what is removed is the LIVENESS half — the
         rule that a bounded run holding unsettled work owns the entity's coverage work. */
      const mutated = loadModified("fal-generation.js", [[
        /* The anchor moved with the seam again: the bounded-run arm of the transition
           table is where "still holding unsettled work" is now asked. Re-armed there. */
        `      if (!outstanding) return { action: COVERAGE_TRANSITIONS.ESTABLISH };`,
        `      if (true) return { action: COVERAGE_TRANSITIONS.ESTABLISH };`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        seedCoverageEntity(h);
        const bounded = await h.coverage(coverageSlot(1, { coverageRequestCount: 1, coverageMaximumImages: 3 }));
        assert.strictEqual(bounded.status, 200, `the bounded press must dispatch: ${JSON.stringify(bounded.data)}`);
        const before = h.project().characters[0].coverageAutomation;
        assert.strictEqual(h.ledger()[0].status, "IN_QUEUE", "and its paid work must still be unsettled");
        phase("UNSAFE_PATH_EXECUTED");
        const later = await h.coverage(coverageSlot(2, { coverageMode: "", coverageSheetType: "angles", coverageRequestCount: undefined, coverageMaximumImages: undefined }));
        const after = h.project().characters[0].coverageAutomation;
        observeHarm(later.status === 200 || String(after?.id) !== String(before?.id),
          `THE DEFECT: a bounded run whose job was still IN_QUEUE was replaced — ${JSON.stringify(before)} became ${JSON.stringify(after)}, with ${h.calls.length} provider calls`);
      } finally { h.close(); }
    });

  await control("a scope fingerprint that leaves the paid quantity out",
    "a permit cannot buy more images than it was minted for", async (phase) => {
      /* The mutation is in the permit module, and the route holds its own copy of it — so
         the patched module is installed in the require cache and fal-generation.js is
         compiled fresh against it, or the boundary would go on running the correct code. */
      const permitModule = path.join(ROOT, "paid-dispatch-permit.js");
      const { code } = modifiedSource("paid-dispatch-permit.js", [[
        `  canonical.outputCount = Math.max(0, Math.round(Number(row.outputCount) || 0));`,
        `  canonical.outputCount = 0;`,
      ]]);
      const patched = new Module(permitModule, module);
      patched.filename = permitModule;
      patched.paths = Module._nodeModulePaths(path.dirname(permitModule));
      patched._compile(code, permitModule);
      const previous = require.cache[permitModule];
      require.cache[permitModule] = { id: permitModule, filename: permitModule, loaded: true, exports: patched.exports };
      let mutated;
      try {
        delete require.cache[path.join(ROOT, "fal-generation.js")];
        mutated = require("../fal-generation");
      } finally {
        if (previous) require.cache[permitModule] = previous; else delete require.cache[permitModule];
        delete require.cache[path.join(ROOT, "fal-generation.js")];
        require("../fal-generation");
      }
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        const buildId = seedFramePackage(h);
        const issued = await h.permitFor(permitScope(buildId, { outputCount: 1 }));
        assert(issued.data?.paidPermitId, `the control needs a real permit: ${JSON.stringify(issued.data)}`);
        phase("UNSAFE_PATH_EXECUTED");
        const greedy = await h.post(permitFrameBody(buildId, { clientRequestId: "greedy", outputCount: 4, paidPermitId: issued.data.paidPermitId }), { permit: false });
        const row = h.ledger().find((item) => item.clientRequestId === "greedy");
        observeHarm(greedy.status === 200 && Number(row?.outputCount) > 1,
          `THE DEFECT: a permit minted for 1 image dispatched ${row?.outputCount} — the quantity the filmmaker authorised is not part of what the permit binds`);
      } finally { h.close(); }
    });

  await control("a permit refusal deferred until after the provider has been told",
    "a request refused for its permit reaches no provider and leaves no row", async (phase) => {
      /* THE ORDERING IS THE PROPERTY, and it is distinct from "the permit is required" one
         control above. Here the permit IS checked and the request IS refused — just not
         until the row has been committed and the provider has been asked. The refusal even
         still says providerContacted:false, which is what makes this the worst version:
         the answer is a lie the caller has no way to test. */
      const mutated = loadModified("fal-generation.js", [[
        `    const permitGate = resolveDispatchPermit(owner, jobs, req, trusted);
    if (!permitGate.ok)
      return requestTruthRefusal(res, permitGate.status, permitGate.code, permitGate.error, permitGate.detail || {});
    const membership = permitGate.membership;`,
        `    const permitGate = resolveDispatchPermit(owner, jobs, req, trusted);
    const deferredPermitRefusal = permitGate.ok ? null : permitGate;
    const membership = permitGate.ok ? permitGate.membership : { id: "", permitClass: "direct", authorizationRef: "", stepKey: "", scopeFingerprint: "" };`,
      ], [
        `    if (PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
        `    if (false && PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
      ], [
        `      const outcome = await submit(owner, job, job.references, preparedLegacy);`,
        `      const outcome = await submit(owner, job, job.references, preparedLegacy);
      if (deferredPermitRefusal)
        return requestTruthRefusal(res, deferredPermitRefusal.status, deferredPermitRefusal.code, deferredPermitRefusal.error, deferredPermitRefusal.detail || {});`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        const buildId = seedFramePackage(h);
        phase("UNSAFE_PATH_EXECUTED");
        const refused = await h.post(permitFrameBody(buildId, { clientRequestId: "leak" }), { permit: false });
        observeHarm(h.calls.length > 0 || h.ledger().length > 0,
          `THE DEFECT: a request refused ${refused.status} for its permit still reached the provider ${h.calls.length} time(s) and left ${h.ledger().length} ledger row(s), while answering providerContacted:${refused.data?.providerContacted}`);
      } finally { h.close(); }
    });

  await control("an unbounded coverage run continued only when a bounded authorization names it",
    "a compatible manual press continues the run it joined instead of replacing it", async (phase) => {
      /* THE REGRESSION, EXACTLY. `coverageAuthorizationFor()` correctly answers an empty
         reference for an unbounded manual run — nothing bounded governs that dispatch — and
         this mutation reads that emptiness as "start a fresh run", which is what the first
         version of the permit correction did. The money question and the filing question
         are not the same question, and conflating them loses a job that is still in flight
         from the board a filmmaker is watching it on. */
      const mutated = loadModified("fal-generation.js", [[
        /* Re-armed at the moved seam: the decision is a CELL of the transition table now.
           Row B1 — a compatible unbounded press over live unbounded unsettled work — is the
           one under test, so the mutation makes that cell establish instead of continue,
           which is exactly "only a bounded authorization can make me join something". */
        `    /* B1 — compatible and unbounded: the ordinary per-slot press, which continues.`,
        `    if (true) return { action: COVERAGE_TRANSITIONS.ESTABLISH };
    /* B1 — compatible and unbounded: the ordinary per-slot press, which continues.`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        seedCoverageEntity(h);
        const manual = (n) => coverageSlot(n, {
          coverageMode: "", coverageSheetType: "angles",
          coverageRequestCount: undefined, coverageMaximumImages: undefined,
        });
        const first = await h.coverage(manual(1));
        assert.strictEqual(first.status, 200, `the first manual press must dispatch: ${JSON.stringify(first.data)}`);
        const opened = h.project().characters[0].coverageAutomation;
        assert.strictEqual(h.ledger()[0].status, "IN_QUEUE", "and its job must still be in flight");
        const second = await h.coverage(manual(2));
        assert.strictEqual(second.status, 200, `and so must the second: ${JSON.stringify(second.data)}`);
        phase("UNSAFE_PATH_EXECUTED");

        const after = h.project().characters[0].coverageAutomation;
        observeHarm(String(after?.id) !== String(opened?.id) || !(after?.jobs || []).includes(first.data.job.id),
          `THE DEFECT: the second compatible manual press replaced the projection — run ${opened?.id} carrying ${JSON.stringify(opened?.jobs)} became ${after?.id} carrying ${JSON.stringify(after?.jobs)}, and the first job is still ${h.ledger().find((row) => row.id === first.data.job.id)?.status} with ${h.calls.length} provider calls made`);
      } finally { h.close(); }
    });

  await control("a newly bounded coverage press absorbed into a live unbounded projection",
    "a bounded operation cannot be established over unsettled unbounded work", async (phase) => {
      /* ONE CELL, because the model made it one decision. Row B2 — a press that quotes a
         ceiling arriving over live unbounded work nobody has heard back about — waits.
         Making that cell CONTINUE instead absorbs it into somebody else's unbounded run,
         which is the shape that silently drops the ceiling rather than the shape that
         discards the projection. That the whole defect is now one cell is the point of
         having a table: before the model this took two mutations in two files. */
      const mutated = loadModified("fal-generation.js", [[
        `    if (requestBounded) return { action: COVERAGE_TRANSITIONS.REFUSE, reason: "unsettled-unbounded-work", existingTarget, incomingTarget, outstanding };`,
        `    if (requestBounded) return { action: COVERAGE_TRANSITIONS.CONTINUE, ref: String(run.id || "") };`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        seedCoverageEntity(h);
        const manual = coverageSlot(1, {
          coverageMode: "", coverageSheetType: "angles",
          coverageRequestCount: undefined, coverageMaximumImages: undefined,
        });
        const first = await h.coverage(manual);
        assert.strictEqual(first.status, 200, `the unbounded manual press must dispatch: ${JSON.stringify(first.data)}`);
        assert.strictEqual(h.ledger()[0].status, "IN_QUEUE", "and its work must still be unsettled");
        assert.strictEqual(h.project().characters[0].coverageAutomation.requestCount, undefined,
          "and the run it opened must be genuinely unbounded, or this control is about nothing");
        phase("UNSAFE_PATH_EXECUTED");

        /* The bounded press the filmmaker was quoted 1 request / 3 images for. */
        const bounded = await h.coverage(coverageSlot(2, {
          coverageMode: "", coverageSheetType: "angles",
          coverageRequestCount: 1, coverageMaximumImages: 3,
        }));
        const governing = h.project().characters[0].coverageAutomation;
        const declaredBoundLost = bounded.status === 200 && governing?.requestCount === undefined;
        /* AND THE CONSEQUENCE, not just the shape: with no ceiling on the governing run a
           further press dispatches where the quote said it must not. */
        const beyond = await h.coverage(coverageSlot(3, {
          coverageMode: "", coverageSheetType: "angles",
          coverageRequestCount: 1, coverageMaximumImages: 3,
        }));
        observeHarm(declaredBoundLost || beyond.status === 200,
          `THE DEFECT: a press quoted at 1 request / 3 images was absorbed into a live unbounded run whose work was still in flight — the governing record reads ${JSON.stringify({ id: governing?.id, requestCount: governing?.requestCount, maximumImages: governing?.maximumImages })}, a further press answered ${beyond.status}, and ${h.calls.length} provider calls were made under a ceiling of 3 images`);
      } finally { h.close(); }
    });

  /* =========================================================================
     THE COVERAGE PROJECTION TRANSITION MODEL, CELL BY CELL.

     coverageTransition() is a table, so these mutate CELLS of it rather than lines
     scattered across a route, a guard and a commit callback. Each mutation is a
     defensible-looking implementation that gets exactly one row wrong, and each is driven
     through the real route until the wrong transition is observable in the durable record. */
  const transitionEntity = (h) => {
    const project = h.project();
    project.characters = [{ id: "KAI", name: "Kai", type: "Character", approvedFile: "KAI.png", continuityStates: [] }];
    h.saveProject(project);
  };
  const transitionBody = (extra = {}) => ({
    purpose: "entity-reference", entityList: "characters", entityId: "KAI", entityType: "character",
    prompt: "Kai from the requested angle.", references: [{ key: "base", label: "Approved primary", role: "base", url: KAI_PNG }],
    outputCount: 1, quality: "high", resolution: "4k", aspectRatio: referenceAspectLabel("characters"),
    coverageJobType: "slot", coverageSheetType: "", coverageMode: "",
    coverageRequestCount: undefined, coverageMaximumImages: undefined,
    generationRequest: Presentation.generationRequestDeclaration({ surface: "reference-automation", viewMode: "simple" }),
    ...extra,
  });
  const expressionsBody = (extra = {}) => transitionBody({
    coverageJobType: "sheet", coverageSheetType: "expressions", coverageMode: "sheet", aspectRatio: "4:3", ...extra,
  });
  const settle = (h, jobId) => {
    const rows = h.ledger();
    rows.find((r) => r.id === jobId).status = "COMPLETED";
    rows.find((r) => r.id === jobId).ingestedAt = "2026-08-30T00:00:00.000Z";
    h.seedLedger(rows);
  };

  await control("filing compatibility decided by raw spelling instead of the canonical target",
    "an empty sheetType and the word angles are one projection", async (phase) => {
      /* The predicate this model replaced. Empty and "angles" are the same board by
         coverageFilingTarget() and by every reader in the product, and comparing the raw
         strings makes the second press destroy the first. */
      const mutated = loadModified("fal-generation.js", [[
        `    const existingTarget = coverageFilingTarget(run.sheetType);
    const sameBoard = existingTarget === incomingTarget;`,
        `    const existingTarget = coverageFilingTarget(run.sheetType);
    const sameBoard = String(run.sheetType || "") === String(incomingTarget === "expressions" ? "expressions" : "angles");`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        transitionEntity(h);
        const first = await h.coverage(transitionBody({ clientRequestId: "alias-1", targetCoverageSlotId: "s1", coverageSheetType: "" }));
        assert.strictEqual(first.status, 200, `the opening press must dispatch: ${JSON.stringify(first.data)}`);
        assert.strictEqual(h.ledger()[0].status, "IN_QUEUE", "and stay in flight");
        const opened = h.project().characters[0].coverageAutomation;
        phase("UNSAFE_PATH_EXECUTED");
        const second = await h.coverage(transitionBody({ clientRequestId: "alias-2", targetCoverageSlotId: "s2", coverageSheetType: "angles" }));
        const after = h.project().characters[0].coverageAutomation;
        observeHarm(String(after?.id) !== String(opened?.id) || !(after?.jobs || []).includes(first.data.job.id) || second.status !== 200,
          `THE DEFECT: one angles board spelled two ways was read as two tasks — run ${opened?.id} carrying ${JSON.stringify(opened?.jobs)} became ${after?.id} carrying ${JSON.stringify(after?.jobs)}, the second press answered ${second.status}, and the first job is still ${h.ledger().find((r) => r.id === first.data.job.id)?.status}`);
      } finally { h.close(); }
    });

  await control("incompatible unbounded work allowed to replace a projection with jobs in flight",
    "a run holding unsettled paid work is never replaced", async (phase) => {
      /* Row B3. Replacement looks harmless when the existing run quoted nothing — there is
         no ceiling to lose — and it is not: the record of an in-flight paid job goes with it. */
      const mutated = loadModified("fal-generation.js", [[
        `    if (!sameBoard) return { action: COVERAGE_TRANSITIONS.REFUSE, reason: "incompatible-filing-target", existingTarget, incomingTarget, outstanding };
    /* B2 — compatible, but it quoted a ceiling. Absorbing it drops that ceiling; replacing
       loses the in-flight work. So it waits. */`,
        `    if (!sameBoard) return { action: COVERAGE_TRANSITIONS.ESTABLISH };
    /* B2 */`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        transitionEntity(h);
        const first = await h.coverage(transitionBody({ clientRequestId: "b3-1", targetCoverageSlotId: "s1" }));
        assert.strictEqual(first.status, 200, `the angles press must dispatch: ${JSON.stringify(first.data)}`);
        assert.strictEqual(h.ledger()[0].status, "IN_QUEUE", "and its job must still be in flight");
        const opened = h.project().characters[0].coverageAutomation;
        phase("UNSAFE_PATH_EXECUTED");
        const expressions = await h.coverage(expressionsBody({ clientRequestId: "b3-2" }));
        const after = h.project().characters[0].coverageAutomation;
        observeHarm(expressions.status === 200 && (String(after?.id) !== String(opened?.id) || !(after?.jobs || []).includes(first.data.job.id)),
          `THE DEFECT: expressions work replaced a projection whose angles job was still ${h.ledger().find((r) => r.id === first.data.job.id)?.status} — run ${opened?.id} carrying ${JSON.stringify(opened?.jobs)} became ${after?.id} carrying ${JSON.stringify(after?.jobs)}, with ${h.calls.length} provider calls made`);
      } finally { h.close(); }
    });

  await control("a settled projection that keeps refusing incompatible work forever",
    "serialisation is a wait, not a wall", async (phase) => {
      /* Row C3. Refusing on the FILING TARGET alone — without asking whether anything is
         still outstanding — passes every "must refuse" assertion and quietly makes the
         entity's other coverage board unusable from then on. A guard that only ever refuses
         looks safe and is not. */
      const mutated = loadModified("fal-generation.js", [[
        `    if (!outstanding) {
      if (requestBounded || !sameBoard) return { action: COVERAGE_TRANSITIONS.ESTABLISH };`,
        `    if (!outstanding) {
      if (!sameBoard) return { action: COVERAGE_TRANSITIONS.REFUSE, reason: "incompatible-filing-target", existingTarget, incomingTarget, outstanding };
      if (requestBounded) return { action: COVERAGE_TRANSITIONS.ESTABLISH };`,
      ]]);
      phase("MUTATION_LANDED");
      const h = await harness(mutated);
      try {
        transitionEntity(h);
        const first = await h.coverage(transitionBody({ clientRequestId: "c3-1", targetCoverageSlotId: "s1" }));
        assert.strictEqual(first.status, 200, `the angles press must dispatch: ${JSON.stringify(first.data)}`);
        /* SETTLED — nothing is in flight, so nothing can be lost by moving on. */
        settle(h, first.data.job.id);
        phase("UNSAFE_PATH_EXECUTED");
        const expressions = await h.coverage(expressionsBody({ clientRequestId: "c3-2" }));
        observeHarm(expressions.status !== 200,
          `THE DEFECT: expressions work was refused ${expressions.status}/${expressions.data.reason} although the angles job it was waiting for is ${h.ledger().find((r) => r.id === first.data.job.id)?.status} — the wait never ends and the other board can no longer be generated for this reference`);
      } finally { h.close(); }
    });

  console.log("");
  console.log("Harness self-checks — each of these was counted as a DETECTION by the previous harness:");
  console.log(`  - a stale mutation anchor is rejected: ${selfChecks.stale}`);
  console.log(`  - an arbitrary AssertionError is rejected: ${selfChecks.arbitrary}`);
  console.log(`  - harm claimed without a proved mutation and unsafe path is rejected: ${selfChecks.unproved}`);
  console.log("");
  console.log(`Paid request truth negative controls passed: ${results.length} deliberate defects reintroduced in memory —`);
  for (const row of results) console.log(`  - ${row.label} → detected by "${row.guardedTest}"`);
  for (const row of results)
    assert.deepStrictEqual(row.phases, ["MUTATION_LANDED", "UNSAFE_PATH_EXECUTED"],
      `${row.label} did not record both required phases: ${JSON.stringify(row.phases)}`);
  console.log("  - every control recorded MUTATION_LANDED and UNSAFE_PATH_EXECUTED before its named harm; every mutation lived only in a private module instance; no file on disk was written, and 0 paid calls were made");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

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
    post: async (body) => {
      const response = await fetch(`${appOrigin}/api/generation/fal/jobs`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
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
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
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
        `    return guardRoute(res, dispatchGenerationRequest(req, res, {
      surface: "reference-automation",
      entityList: list,
      entityId,`,
        `    const early = {
      surface: "reference-automation",
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
        `    try {
      await commit(owner, (current) => { current.push(job); });
    } catch (error) {`,
        `    if (typeof trusted?.onDispatchCommit === "function") await trusted.onDispatchCommit(owner, job);
    if (trusted) throw new Error("process stopped between the two durable writes");
    try {
      await commit(owner, (current) => { current.push(job); });
    } catch (error) {`,
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
          outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
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
        "  const unknown = falJobUnresolved(job);\n  return `<div class=\"fal-job-strip ${unknown ? \"unresolved\" : active ? \"active\" : done ? \"done\" : failed ? \"failed\" : \"\"}\"><div><span>${unknown ? \"?\" : active ? '<i class=\"spin\">◌</i>' : done ? \"✓\" : failed ? \"!\" : \"·\"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${unknown ? esc(falUnresolvedExplanation(job)) : `${job.continuityStateName",
        "  const unknown = false;\n  return `<div class=\"fal-job-strip ${unknown ? \"unresolved\" : active ? \"active\" : done ? \"done\" : failed ? \"failed\" : \"\"}\"><div><span>${unknown ? \"?\" : active ? '<i class=\"spin\">◌</i>' : done ? \"✓\" : failed ? \"!\" : \"·\"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${unknown ? esc(falUnresolvedExplanation(job)) : `${job.continuityStateName",
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

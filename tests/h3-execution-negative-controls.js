/* Negative controls for the MiniMax H3 execution-wiring suite.
 *
 * A guard that has never fired is a claim, not evidence. Each control below puts one of
 * the C1.1 defects back — the backend writing its own prompt, endpoints chosen by array
 * position, a prompt trimmed to fit, a reference quietly dropped, a job with no compiler
 * provenance, ownership re-read after an await, the legacy submission path — and then
 * asserts that the property guarding it FAILS. A control that stays green is the real
 * failure: it means the test it guards would not notice the defect coming back.
 *
 * Defects are introduced by compiling a modified copy of the source IN MEMORY. Nothing
 * is written to disk and no file is reverted, because a broad revert is how unrelated
 * unstaged work gets discarded.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const express = require("express");

const RealBackend = require("../fal-h3-backend");
const RealExecution = require("../h3-execution");
const H3Pack = require("../model-packs/minimax-h3");
const { addMotionPromptBuild } = require("./h3-execution-fixture");

const ROOT = path.join(__dirname, "..");
const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PNG_C = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC", "base64");

const A_PNG = "/assets/shots/SH-1/takes/A.png";
const B_PNG = "/assets/shots/SH-1/takes/B.png";
const C_PNG = "/assets/shots/SH-1/takes/C.png";

/* ---------------------------------------------------------------------------
   In-memory patching. */
function loadModified(relative, edits) {
  const file = path.join(ROOT, relative);
  /* Normalised to LF before matching: a Windows checkout with core.autocrlf on would
     otherwise fail every multi-line anchor and the failure would look like a source
     change rather than a line ending. */
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
   A project and a compiled plan the controls can work on. */
function fixtureProject() {
  return {
    meta: { title: "controls", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
}
const ref = (key, role, mediaType, url, label) => ({ key, label, role, mediaType, url, instruction: "" });

function compilePlan(mode, references, execution = RealExecution) {
  const project = fixtureProject();
  const buildId = addMotionPromptBuild(project, "SH-1", { mode, id: `ctrl-${mode}`, durationSeconds: 8, references });
  return execution.compileH3ExecutionPlan({
    project, shotId: "SH-1", buildId, durationSeconds: 8, resolution: "2K", aspectRatio: "16:9",
  });
}

const FLF_REFS = [
  /* Supplied ENDING-FIRST on purpose. Under array-position binding this is the swap. */
  ref("kf-b", "last-frame", "image", B_PNG, "Approved ending frame"),
  ref("kf-a", "first-frame", "image", A_PNG, "Approved opening frame"),
];
const R2V_REFS = [
  ref("kf-1", "sequential-keyframe", "image", A_PNG, "Opening beat"),
  ref("kf-2", "sequential-keyframe", "image", B_PNG, "Closing beat"),
  ref("id-kai", "identity", "image", C_PNG, "Kai — approved identity"),
];

const resolveStub = (row) => `resolved:${row.refId}`;

async function main() {
  /* =========================================================================
     1. The backend writes its own prompt.
        The property: the compiled prompt reaches the provider unchanged. */
  await control("a backend that rebuilds the prompt itself", "the compiled prompt reaches the provider unchanged", () => {
    const backend = loadModified("fal-h3-backend.js", [
      [
        "  const input = { prompt, duration };",
        "  const input = { prompt: `Cinematic shot, ${duration} seconds, high quality.`, duration };",
      ],
    ]);
    const compiled = compilePlan("t2v", []);
    const serialized = backend.serializeH3PlanForFal(compiled.plan, compiled.capability, { resolveReference: resolveStub, config: {} });
    assert.strictEqual(serialized.input.prompt, compiled.plan.inputs.prompt,
      "the compiled prompt reaches the provider unchanged");
  });

  /* =========================================================================
     2. Endpoints chosen by array position.
        The property: reversing the reference array does NOT swap the endpoints. */
  await control("Frame A/B chosen by array position", "reversing the reference array does not swap the endpoints", () => {
    /* The defect faithfully: the plan's canonical ORDER is ignored and the endpoint
       frames are taken by position out of whatever array arrived. Both halves are
       needed — the planner's ordering alone already puts the endpoints right, which is
       why the original defect only ever surfaced on the client's unordered array. */
    const backend = loadModified("fal-h3-backend.js", [
      [
        "function endpointReference(plan, field, references) {\n  const binding = plan?.endpoints?.[field];\n  if (!isRecord(binding) || !binding.refId) return null;\n  return references.find((row) => String(row.refId) === String(binding.refId)) || null;\n}",
        "function endpointReference(plan, field, references) {\n  const images = references.filter((row) => row.mediaType === \"image\");\n  return (field === \"firstFrame\" ? images[0] : images[1]) || null;\n}",
      ],
      [
        "    .sort((a, b) => {\n      const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;",
        "    .sort((a, b) => {\n      return 0;\n      const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;",
      ],
    ]);
    const compiled = compilePlan("flf", FLF_REFS);
    /* Ending-first, the way the reference array reached the old dispatcher. */
    const arrayOrder = {
      ...compiled.plan,
      inputs: { ...compiled.plan.inputs, references: [...compiled.plan.inputs.references].reverse() },
    };
    assert.strictEqual(arrayOrder.inputs.references[0].role, "last-frame", "the fixture must genuinely be ending-first");
    const serialized = backend.serializeH3PlanForFal(arrayOrder, compiled.capability, { resolveReference: resolveStub, config: {} });
    const bind = (field) => serialized.bindings.find((row) => row.field === field);
    assert.strictEqual(bind("image_url").refId, "kf-a", "the opening frame is the first-frame reference, whatever the array order");
    assert.strictEqual(bind("end_image_url").refId, "kf-b");
  });

  /* =========================================================================
     3. The backend silently truncates an over-limit prompt.
        The property: an over-limit prompt REFUSES; nothing is trimmed to fit. */
  await control("a backend that trims a prompt to fit", "an over-limit prompt refuses instead of being truncated", () => {
    const backend = loadModified("fal-h3-backend.js", [
      [
        "  if (prompt.length > promptCeiling)",
        "  if (false)",
      ],
      [
        "  const input = { prompt, duration };",
        "  const input = { prompt: prompt.slice(0, promptCeiling), duration };",
      ],
    ]);
    const compiled = compilePlan("t2v", []);
    const over = "x".repeat(7001);
    let refused = false;
    let serialized = null;
    try {
      serialized = backend.serializeH3PlanForFal(compiled.plan, compiled.capability, { resolveReference: resolveStub, config: {}, promptOverride: over });
    } catch (error) {
      refused = error.code === "H3_PROMPT_OVER_LIMIT";
    }
    assert(refused, "an over-limit prompt must refuse rather than be silently trimmed");
    assert.strictEqual(serialized, null, `nothing may be produced from an over-limit prompt (got ${serialized?.input?.prompt?.length} characters)`);
  });

  /* =========================================================================
     4. The provider request drops one semantic reference.
        The property: every reference the plan lists reaches the request. */
  await control("a request that drops one semantic reference", "every reference in the plan reaches the provider request", () => {
    const backend = loadModified("fal-h3-backend.js", [
      [
        "      input[field] = buckets[media].map((row, index) => {",
        "      input[field] = buckets[media].slice(0, Math.max(1, buckets[media].length - 1)).map((row, index) => {",
      ],
    ]);
    const compiled = compilePlan("r2v", R2V_REFS);
    const serialized = backend.serializeH3PlanForFal(compiled.plan, compiled.capability, { resolveReference: resolveStub, config: {} });
    const planned = compiled.plan.inputs.references.filter((row) => row.mediaType === "image").map((row) => row.refId);
    assert.deepStrictEqual(
      serialized.bindings.filter((row) => row.field === "reference_image_urls").map((row) => row.refId),
      planned,
      "every image reference the plan lists must reach the provider request",
    );
  });

  /* =========================================================================
     5. The job omits compiler provenance.
        The property: the durable job records which pack and version compiled it. */
  await control("a job that omits compiler provenance", "the durable job records what compiled it", () => {
    const execution = loadModified("h3-execution.js", [
      [
        "    plan,\n    surface: compiled.surface,",
        "    plan: { ...plan, compiler: undefined },\n    surface: compiled.surface,",
      ],
    ]);
    const compiled = compilePlan("t2v", [], execution);
    const provenance = execution.planProvenance(compiled);
    assert(provenance.plan.compiler && provenance.plan.compiler.packId,
      "the durable job must record which model pack compiled it");
    assert(provenance.plan.compiler.packVersion, "and which version of it");
  });

  /* =========================================================================
     6. The route consults the globally active project after an await.
        The property: an H3 job belongs to the project it started for, and a switch
        during the request cannot redirect it. */
  await control("activeProject re-read after an async boundary", "a project switch cannot redirect an H3 job", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-h3-ctrl-"));
    const dirs = {};
    for (const slug of ["alpha", "beta"]) {
      const dir = path.join(tmp, slug);
      fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
      fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "A.png"), PNG_A);
      const project = fixtureProject();
      project.meta.title = slug;
      addMotionPromptBuild(project, "SH-1", {
        mode: "i2v", id: `pkg-${slug}`, durationSeconds: 8,
        references: [ref("kf-a", "first-frame", "image", A_PNG, `${slug} opening frame`)],
      });
      const file = path.join(dir, "project.json");
      fs.writeFileSync(file, JSON.stringify(project, null, 2));
      dirs[slug] = { slug, dir, file };
    }

    /* The defect: ownership resolved from whatever is active AT THE MOMENT OF USE
       rather than captured once before the first await. */
    const falGeneration = loadModified("fal-generation.js", [
      [
        "        compiled = compileH3ExecutionPlan({\n          project: ownerProject(owner),",
        "        compiled = compileH3ExecutionPlan({\n          project: readProject(activeSlug()),",
      ],
    ]);

    let active = "alpha";
    const mock = express();
    mock.use(express.json({ limit: "25mb" }));
    let mockOrigin = "";
    /* The switch happens while the request is in flight, which is what the real defect
       needed: an await between capturing ownership and using it. */
    mock.post(["/minimax/h3/image-to-video"], (req, res) => {
      res.json({ request_id: "x", status_url: `${mockOrigin}/s`, response_url: `${mockOrigin}/r` });
    });
    const mockServer = await new Promise((resolve) => { const s = mock.listen(0, "127.0.0.1", () => resolve(s)); });
    mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

    const app = express();
    app.use(express.json({ limit: "8mb" }));
    falGeneration.registerFalGeneration(app, {
      readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "k", baseUrl: mockOrigin, h3ImageModel: "minimax/h3/image-to-video", h3TextModel: "minimax/h3/text-to-video", h3ReferenceModel: "minimax/h3/reference-to-video", h3Resolution: "2K", maxConcurrent: 2 } } }),
      readProject: (slug = active) => JSON.parse(fs.readFileSync(dirs[slug].file, "utf8")),
      writeProject: (project, slug = active) => fs.writeFileSync(dirs[slug].file, JSON.stringify(project, null, 2)),
      /* Switches the moment ownership is captured, so a later re-read lands on beta. */
      activeSlug: () => { const current = active; active = "beta"; return current; },
      projectDirForSlug: (slug) => dirs[slug],
    });
    const appServer = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const origin = `http://127.0.0.1:${appServer.address().port}`;

    try {
      const response = await fetch(`${origin}/api/generation/fal/jobs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "motion-h3", shotId: "SH-1", sourceBuildId: "pkg-alpha", profileFamily: "minimax-h3", profileMode: "i2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9" }),
      });
      const data = await response.json();
      assert.strictEqual(response.status, 200, `the job must belong to the project that started it: ${JSON.stringify(data)}`);
      assert.strictEqual(data.job.compilation.source.buildId, "pkg-alpha",
        "the plan must be compiled from the OWNING project's package, not from whichever project is active now");
    } finally {
      mockServer.close();
      appServer.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  /* =========================================================================
     7. The legacy submission path used for a new request.
        The property: a posted prompt cannot originate a new H3 generation. */
  await control("the legacy raw-prompt submission path", "a posted prompt cannot originate a new H3 request", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-h3-legacy-"));
    const dir = path.join(tmp, "project");
    fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
    fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "A.png"), PNG_A);
    fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "B.png"), PNG_B);
    const file = path.join(dir, "project.json");
    fs.writeFileSync(file, JSON.stringify(fixtureProject(), null, 2));

    /* The defect: the pre-compilation dispatcher, restored. It builds its own request
       from the posted prompt and picks the endpoint frames by array position. */
    const falGeneration = loadModified("fal-generation.js", [
      [
        "  async function submitH3(owner, job, cfg) {\n    const compilation = job.compilation;",
        `  async function submitH3(owner, job, cfg) {
    if (!job.compilation) {
      const images = (job.references || []).filter((row) => row.mediaType === "image");
      const legacy = { prompt: job.prompt, duration: 8, resolution: "2K" };
      if (images[0]) legacy.image_url = planReferenceInput(owner, { refId: images[0].key, source: { kind: "project-asset", path: images[0].url } });
      if (images[1]) legacy.end_image_url = planReferenceInput(owner, { refId: images[1].key, source: { kind: "project-asset", path: images[1].url } });
      const legacyResponse = await fetch(\`\${cfg.baseUrl}/\${cfg.h3ImageModel}\`, { method: "POST", headers: { "content-type": "application/json", Authorization: \`Key \${cfg.apiKey}\` }, body: JSON.stringify(legacy) });
      const legacyData = await legacyResponse.json().catch(() => ({}));
      return { model: cfg.h3ImageModel, modelFamily: "minimax-h3", providerRequest: legacy, externalId: legacyData.request_id || "", statusUrl: legacyData.status_url || "", responseUrl: legacyData.response_url || "", cancelUrl: legacyData.cancel_url || "", status: "IN_QUEUE" };
    }
    const compilation = job.compilation;`,
      ],
      /* …and the route stops compiling, so the legacy branch is reachable. */
      [
        "      let compiled;\n      try {\n        compiled = compileH3ExecutionPlan({",
        "      let compiled;\n      if (!req.body?.sourceBuildId) { /* legacy passthrough */ } else\n      try {\n        compiled = compileH3ExecutionPlan({",
      ],
      /* …AND the request-truth gate stops standing in front of it.
       *
       * Paid Request Truth V1 put a second guard between a posted body and this
       * dispatcher: enforceRequestPlan() resolves the route's control capability from
       * the shot's own package, so a body with no package cannot get past it either.
       * That is a real second guarantee and it is welcome - but with only the first two
       * mutations applied, the property this control exists for went on holding for a
       * reason that had nothing to do with the legacy path, and the control correctly
       * reported itself vacuous.
       *
       * A control has to remove EVERY guard that supplies the property, or it is
       * measuring the guards it forgot. So the gate is neutralised here too, and what
       * this control now proves is the original claim in full: with nothing standing in
       * the way, a hand-written prompt WOULD originate a paid H3 request. */
      [
        "    const planGate = enforceRequestPlan(owner, req, purpose, trusted);",
        "    const planGate = { ok: true, surface: \"motion-h3\", declaration: { viewMode: \"advanced\", selectedOptionId: \"\", selectedModelId: \"\" }, payload: req.body, removed: [] };",
      ],
      /* …AND the paid dispatch permit, for the third time and the same reason.
       *
       * The permit is a THIRD guard that now stands in front of this dispatcher: a paid
       * request that redeems nothing is refused before a control key is read, so with only
       * the first three mutations this control went vacuous again — the property held
       * because of the permit rather than because of anything about the legacy path.
       *
       * Each new guard on this boundary makes this control weaker unless it is added here,
       * which is the cost of the pattern and is worth paying: what this proves is that with
       * NOTHING in the way, a hand-written prompt would originate a paid H3 request. */
      [
        `    const permitGate = resolveDispatchPermit(owner, jobs, req, trusted);
    if (!permitGate.ok)`,
        `    const permitGate = { ok: true, membership: { id: "", permitClass: "direct", authorizationRef: "", stepKey: "", scopeFingerprint: "" } };
    if (false)`,
      ],
      [
        `    if (PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
        `    if (false && PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))`,
      ],
    ]);

    const calls = [];
    const mock = express();
    mock.use(express.json({ limit: "25mb" }));
    let mockOrigin = "";
    mock.post(["/minimax/h3/image-to-video", "/minimax/h3/text-to-video", "/minimax/h3/reference-to-video"], (req, res) => {
      calls.push({ endpoint: req.path, body: req.body });
      res.json({ request_id: "legacy-1", status_url: `${mockOrigin}/s`, response_url: `${mockOrigin}/r` });
    });
    const mockServer = await new Promise((resolve) => { const s = mock.listen(0, "127.0.0.1", () => resolve(s)); });
    mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

    const app = express();
    app.use(express.json({ limit: "8mb" }));
    falGeneration.registerFalGeneration(app, {
      readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "k", baseUrl: mockOrigin, h3ImageModel: "minimax/h3/image-to-video", h3TextModel: "minimax/h3/text-to-video", h3ReferenceModel: "minimax/h3/reference-to-video", h3Resolution: "2K", maxConcurrent: 2 } } }),
      readProject: () => JSON.parse(fs.readFileSync(file, "utf8")),
      writeProject: (project) => fs.writeFileSync(file, JSON.stringify(project, null, 2)),
      activeSlug: () => "ctrl",
      projectDirForSlug: () => ({ slug: "ctrl", dir, file }),
    });
    const appServer = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const origin = `http://127.0.0.1:${appServer.address().port}`;

    try {
      const response = await fetch(`${origin}/api/generation/fal/jobs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "motion-h3", shotId: "SH-1", profileFamily: "minimax-h3", profileMode: "flf",
          prompt: "A hand-written prompt posted straight to the dispatcher.",
          durationSeconds: 8, resolution: "2K", aspectRatio: "16:9",
          references: [
            { key: "kf-b", label: "Approved ending frame", role: "last-frame", mediaType: "image", url: B_PNG },
            { key: "kf-a", label: "Approved opening frame", role: "first-frame", mediaType: "image", url: A_PNG },
          ],
        }),
      });
      const data = await response.json();
      assert(response.status >= 400, `a posted prompt must not originate a new H3 request (got ${response.status})`);
      assert.strictEqual(calls.length, 0, "and must reach no provider");
      assert.notStrictEqual(data.code, undefined, "the refusal must be typed");
    } finally {
      mockServer.close();
      appServer.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  /* =========================================================================
     8. The backend narrows the model's own documented ceiling.
        The property: a backend fact never overwrites a model fact. */
  await control("a backend that rewrites the model's prompt ceiling", "the model's 7,000-character fact is not overwritten", () => {
    const pack = loadModified("model-packs/minimax-h3.js", [
      ["  maxPromptCharacters: 7000,", "  maxPromptCharacters: 2000,"],
    ]);
    assert.strictEqual(pack.H3_FACTS.maxPromptCharacters, 7000,
      "MiniMax H3's own documented ceiling must not be replaced by a backend's number");
  });

  /* =========================================================================
     9. The pack ignores the effective duration range and uses the model's floor.
        The property: the effective (model ∩ backend) floor is what compiles. */
  await control("a pack that ignores the backend's duration floor", "the effective duration floor is applied", () => {
    const pack = loadModified("model-packs/minimax-h3.js", [
      [
        "  const range = Array.isArray(capability?.durationSeconds) && capability.durationSeconds.length === 2\n    && capability.durationSeconds.every((value) => Number.isFinite(Number(value)))\n    ? capability.durationSeconds.map(Number)\n    : H3_FACTS.durationSeconds;",
        "  const range = H3_FACTS.durationSeconds;",
      ],
    ]);
    const project = fixtureProject();
    const buildId = addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: "ctrl-4s", durationSeconds: 4, references: [] });
    const compiled = RealExecution.compileH3ExecutionPlan({
      project, shotId: "SH-1", buildId, durationSeconds: 4, resolution: "2K", aspectRatio: "16:9",
      /* The patched pack, injected through the registry the compiler already consults. */
      getProfile: require("../prompt-engine").getProfile,
    });
    /* The real pack is still registered, so this asserts the property directly against
       what the patched copy WOULD have produced. */
    const patched = pack.compileMode({
      mode: "t2v", modelId: "minimax-h3/fl2va", surface: "api",
      spec: { durationSeconds: 4 }, intent: [], manifest: [],
      capability: compiled.capability,
      coverage: { represent() {}, anchor() {}, omit() {}, unsupported() {}, warn() {}, has: () => false, get: () => null },
      durationSeconds: 4, aspectRatio: "16:9", resolution: "2K",
    });
    assert.strictEqual(patched.output.durationSeconds, 5,
      "a 4-second request must be snapped to the effective 5-second floor, not the model's 4");
  });

  /* =========================================================================
     10. The plan's reference ORDER is ignored and the array order used instead.
         The property: serialisation follows the plan's canonical order. */
  await control("a serializer that follows array order rather than the plan's", "reference order comes from the plan", () => {
    const backend = loadModified("fal-h3-backend.js", [
      [
        "    .sort((a, b) => {\n      const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;",
        "    .sort((a, b) => {\n      return 0;\n      const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;",
      ],
    ]);
    /* A plan whose canonical order differs from its array order: the identity reference
       is listed first but belongs after the two ordered beats. */
    const compiled = compilePlan("r2v", [
      ref("id-kai", "identity", "image", C_PNG, "Kai — approved identity"),
      ref("kf-1", "sequential-keyframe", "image", A_PNG, "Opening beat"),
      ref("kf-2", "sequential-keyframe", "image", B_PNG, "Closing beat"),
    ]);
    const shuffled = {
      ...compiled.plan,
      inputs: { ...compiled.plan.inputs, references: [...compiled.plan.inputs.references].reverse() },
    };
    const serialized = backend.serializeH3PlanForFal(shuffled, compiled.capability, { resolveReference: resolveStub, config: {} });
    assert.deepStrictEqual(
      serialized.bindings.filter((row) => row.field === "reference_image_urls").map((row) => row.refId),
      compiled.plan.inputs.references.map((row) => row.refId),
      "the provider order must be the plan's canonical order, whatever order the array is in",
    );
  });

  /* =========================================================================
     11. The paid POST happens before the durable row exists.
         The property: at the instant the request reaches the provider, the ledger
         already contains a row representing that attempt. */
  await control("committing the job only after the provider answers", "the durable row exists before the paid POST", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-h3-order-"));
    const dir = path.join(tmp, "project");
    fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
    fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "A.png"), PNG_A);
    const file = path.join(dir, "project.json");
    const project = fixtureProject();
    addMotionPromptBuild(project, "SH-1", {
      mode: "i2v", id: "order-pkg", durationSeconds: 8,
      references: [ref("kf-a", "first-frame", "image", A_PNG, "Approved opening frame")],
    });
    fs.writeFileSync(file, JSON.stringify(project, null, 2));

    /* The defect: nothing durable until the provider has answered. */
    const falGeneration = loadModified("fal-generation.js", [
      [
        "      await commit(owner, (current) => { current.push(job); });",
        "      await Promise.resolve(); /* control: no durable row before the POST */",
      ],
      [
        "        if (row) mergeJobOutcome(row, { ...outcome, status: outcome.status, updatedAt: now() });",
        "        if (row) mergeJobOutcome(row, { ...outcome, status: outcome.status, updatedAt: now() });\n        else current.push(Object.assign(job, outcome, { status: outcome.status, updatedAt: now() }));",
      ],
    ]);

    const calls = [];
    const mock = express();
    mock.use(express.json({ limit: "25mb" }));
    let mockOrigin = "";
    mock.post(["/minimax/h3/image-to-video"], (req, res) => {
      /* The same barrier the real suite uses: what is on disk with the paid request
         received and unanswered. */
      let ledgerAtRequest = [];
      try { ledgerAtRequest = JSON.parse(fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8")); } catch { ledgerAtRequest = []; }
      calls.push({ ledgerAtRequest });
      res.json({ request_id: "x", status_url: `${mockOrigin}/s`, response_url: `${mockOrigin}/r` });
    });
    const mockServer = await new Promise((resolve) => { const s = mock.listen(0, "127.0.0.1", () => resolve(s)); });
    mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

    const app = express();
    app.use(express.json({ limit: "8mb" }));
    falGeneration.registerFalGeneration(app, {
      readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "k", baseUrl: mockOrigin, h3ImageModel: "minimax/h3/image-to-video", h3TextModel: "minimax/h3/text-to-video", h3ReferenceModel: "minimax/h3/reference-to-video", h3Resolution: "2K", maxConcurrent: 2 } } }),
      readProject: () => JSON.parse(fs.readFileSync(file, "utf8")),
      writeProject: (next) => fs.writeFileSync(file, JSON.stringify(next, null, 2)),
      activeSlug: () => "ctrl",
      projectDirForSlug: () => ({ slug: "ctrl", dir, file }),
    });
    const appServer = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const origin = `http://127.0.0.1:${appServer.address().port}`;

    try {
      const response = await fetch(`${origin}/api/generation/fal/jobs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "motion-h3", shotId: "SH-1", sourceBuildId: "order-pkg", profileFamily: "minimax-h3", profileMode: "i2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9" }),
      });
      const data = await response.json();
      assert.strictEqual(response.status, 200, JSON.stringify(data));
      const atRequest = (calls[0]?.ledgerAtRequest || []).find((row) => row.id === data.job.id);
      assert(atRequest, "the durable row must already exist when the paid request arrives at the provider");
      assert.strictEqual(atRequest.status, "SUBMITTING");
    } finally {
      mockServer.close();
      appServer.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  /* =========================================================================
     12. Duration silently normalised during a paid submission.
         The property: a duration this backend cannot render is refused, not converted. */
  await control("silent 4s→5s normalisation at submission", "a 4-second shot is refused on fal rather than converted", () => {
    const execution = loadModified("h3-execution.js", [
      ["  if (request.enforceDuration && duration > 0) {", "  if (false) {"],
    ]);
    const project = fixtureProject();
    const buildId = addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: "ctrl-dur", durationSeconds: 4, references: [] });
    let refused = null;
    try {
      execution.compileH3ExecutionPlan({
        project, shotId: "SH-1", buildId, durationSeconds: 4, resolution: "2K", aspectRatio: "16:9",
        enforceDuration: true,
      });
    } catch (error) {
      refused = error;
    }
    assert(refused && refused.code === "H3_DURATION_UNSUPPORTED",
      "a 4-second shot must be refused on the fal backend, not quietly rendered as 5");
  });

  /* =========================================================================
     Everything real, afterwards. A control that leaves the process damaged would make
     every later suite unreliable in a way nobody would attribute to this file. */
  {
    assert.strictEqual(RealBackend.FAL_H3_BACKEND.maxPromptCharacters, 7000);
    assert.deepStrictEqual(RealBackend.FAL_H3_BACKEND.durationSeconds, [5, 15]);
    assert.strictEqual(H3Pack.H3_FACTS.maxPromptCharacters, 7000);
    assert.deepStrictEqual(H3Pack.H3_FACTS.durationSeconds, [4, 15]);
    const compiled = compilePlan("flf", FLF_REFS);
    const serialized = RealBackend.serializeH3PlanForFal(compiled.plan, compiled.capability, { resolveReference: resolveStub, config: {} });
    assert.strictEqual(serialized.bindings.find((row) => row.field === "image_url").refId, "kf-a");
    assert.strictEqual(serialized.bindings.find((row) => row.field === "end_image_url").refId, "kf-b");
    assert.strictEqual(serialized.input.prompt, compiled.plan.inputs.prompt);
  }

  console.log(
    `\nH3 execution negative controls passed: ${results.length} deliberate defects reintroduced in memory — `
    + `${results.map((row) => row.label).join("; ")} — every one detected by the property that guards it, `
    + "with the real modules green afterwards.\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

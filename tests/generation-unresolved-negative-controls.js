/* Negative controls for the unresolved paid-submission suite.
 *
 * Each control puts one of the C1.2 defects back — ambiguity collapsed into FAILED,
 * uncertainty lost on reload, the duplicate retry allowed, reconciliation erasing
 * history, a stale write resolving what nobody resolved, the state made H3-specific —
 * and asserts the property guarding it FAILS. A control that stays green is the real
 * failure: the test it guards would not notice the defect coming back.
 *
 * Defects are compiled IN MEMORY. Nothing on disk is modified or reverted.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const express = require("express");

const RealLifecycle = require("../generation-lifecycle");
const { addMotionPromptBuild } = require("./h3-execution-fixture");
const { withGenerationDeclaration } = require("./generation-request-fixture");

const ROOT = path.join(__dirname, "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");

function loadModified(relative, edits) {
  const file = path.join(ROOT, relative);
  /* Normalised to LF before matching: a Windows checkout with core.autocrlf on would
     otherwise fail every multi-line anchor, and the failure would look like a source
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

/* A project, a package, a provider that behaves however the control needs. */
async function scenario(falGeneration, behaviour) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-unresolved-ctrl-"));
  const dir = path.join(tmp, "project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "A.png"), PNG);
  const file = path.join(dir, "project.json");
  const project = {
    meta: { title: "ctrl", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
  addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: "pkg-1", durationSeconds: 8, references: [] });
  fs.writeFileSync(file, JSON.stringify(project, null, 2));

  const calls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/minimax/h3/text-to-video"], (req, res) => {
    calls.push({});
    if (behaviour === "drop") return req.socket.destroy();
    res.json({ request_id: "ok-1", status_url: `${mockOrigin}/s`, response_url: `${mockOrigin}/r`, cancel_url: `${mockOrigin}/c` });
  });
  const mockServer = await new Promise((resolve) => { const s = mock.listen(0, "127.0.0.1", () => resolve(s)); });
  mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  falGeneration.registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "k", baseUrl: mockOrigin, h3TextModel: "minimax/h3/text-to-video", h3ImageModel: "minimax/h3/image-to-video", h3ReferenceModel: "minimax/h3/reference-to-video", h3Resolution: "2K", maxConcurrent: 2 } } }),
    readProject: () => JSON.parse(fs.readFileSync(file, "utf8")),
    writeProject: (next) => fs.writeFileSync(file, JSON.stringify(next, null, 2)),
    activeSlug: () => "ctrl",
    projectDirForSlug: () => ({ slug: "ctrl", dir, file }),
  });
  const appServer = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const origin = `http://127.0.0.1:${appServer.address().port}`;

  const api = async (url, body, method = "POST") => {
    const response = await fetch(`${origin}${url}`, {
      method, headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(await withGenerationDeclaration(url, body, { origin })) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const submit = (tag) => api("/api/generation/fal/jobs", {
    purpose: "motion-h3", shotId: "SH-1", sourceBuildId: "pkg-1", profileFamily: "minimax-h3",
    profileMode: "t2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9", clientRequestId: `req-${tag}`,
  });
  const ledger = () => {
    const raw = path.join(dir, "generation-jobs.json");
    return fs.existsSync(raw) ? JSON.parse(fs.readFileSync(raw, "utf8")) : [];
  };
  return {
    api, submit, ledger, calls, dir,
    row: (id) => ledger().find((r) => r.id === id) || null,
    close: () => { mockServer.close(); appServer.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

/* The same scenario, driven through the plain image path instead of H3 — a different
   endpoint, a different adapter and no GenerationPlan, which is the point. */
async function scenarioImage(falGeneration) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-unresolved-img-"));
  const dir = path.join(tmp, "project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  const file = path.join(dir, "project.json");
  fs.writeFileSync(file, JSON.stringify({
    meta: { title: "ctrl-img" }, shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  }, null, 2));

  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req) => req.socket.destroy());
  const mockServer = await new Promise((resolve) => { const s = mock.listen(0, "127.0.0.1", () => resolve(s)); });
  const mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  falGeneration.registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "k", baseUrl: mockOrigin, textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit", frameOutputs: 1, frameQuality: "high", frameResolution: "1k", maxConcurrent: 2 } } }),
    readProject: () => JSON.parse(fs.readFileSync(file, "utf8")),
    writeProject: (next) => fs.writeFileSync(file, JSON.stringify(next, null, 2)),
    activeSlug: () => "ctrl-img",
    projectDirForSlug: () => ({ slug: "ctrl-img", dir, file }),
  });
  const appServer = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const origin = `http://127.0.0.1:${appServer.address().port}`;
  const ledger = () => {
    const raw = path.join(dir, "generation-jobs.json");
    return fs.existsSync(raw) ? JSON.parse(fs.readFileSync(raw, "utf8")) : [];
  };
  return {
    submitImage: async (tag) => {
      const response = await fetch(`${origin}/api/generation/fal/jobs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "frame", shotId: "SH-1", frameId: "frame-a", frameLabel: "A", prompt: "A still frame.", outputCount: 1, quality: "high", aspectRatio: "16:9", clientRequestId: tag }),
      });
      return { status: response.status, data: await response.json() };
    },
    row: (id) => ledger().find((r) => r.id === id) || null,
    close: () => { mockServer.close(); appServer.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

async function main() {
  /* =========================================================================
     1. Ambiguous transport failure mapped to FAILED. */
  await control("an ambiguous transport failure recorded as FAILED", "a post-contact transport loss is UNRESOLVED", async () => {
    const lifecycle = loadModified("generation-lifecycle.js", [
      [
        "  if (httpStatus == null)\n    return {\n      status: UNRESOLVED,",
        "  if (httpStatus == null)\n    return {\n      status: \"FAILED\",",
      ],
    ]);
    const verdict = lifecycle.describeSubmissionFailure(
      Object.assign(new Error("socket hang up"), { providerEvidence: { transmitted: true, httpStatus: null } }),
    );
    assert.strictEqual(verdict.status, "UNRESOLVED",
      "a request that was sent and never answered must not be recorded as a known failure");
  });

  /* =========================================================================
     2. UNRESOLVED lost on reload. */
  await control("UNRESOLVED collapsing to FAILED on read", "UNRESOLVED survives a reload", async () => {
    /* The defect: the ledger vocabulary forgets the state, so reading normalises it. */
    const lifecycle = loadModified("generation-lifecycle.js", [
      ["function isUnresolved(job) {\n  return String(job?.status || \"\") === UNRESOLVED;\n}", "function isUnresolved() {\n  return false;\n}"],
    ]);
    const stored = { id: "j1", status: "UNRESOLVED", providerContacted: true };
    assert.strictEqual(lifecycle.isUnresolved(stored), true,
      "a stored unresolved job must still read as unresolved after a reload");
  });

  /* =========================================================================
     3. Duplicate Generate allowed immediately. */
  await control("resubmission allowed while a submission is unresolved", "a duplicate paid retry is refused", async () => {
    const falGeneration = loadModified("fal-generation.js", [
      [
        "    const unresolvedTwin = jobs.find((item) =>\n      Lifecycle.blocksResubmission(item) && Lifecycle.generationContextKey(item) === requestContext);",
        "    const unresolvedTwin = null;",
      ],
    ]);
    const s = await scenario(falGeneration, "drop");
    try {
      const first = await s.submit("one");
      assert.strictEqual(s.row(first.data.job.id).status, "UNRESOLVED");
      const before = s.calls.length;
      const retry = await s.submit("two");
      assert.strictEqual(retry.status, 409, "a second paid submission of an unresolved generation must be refused");
      assert.strictEqual(s.calls.length, before, "and must not reach the provider");
    } finally {
      s.close();
    }
  });

  /* =========================================================================
     4. Reconciliation erasing provenance. */
  await control("reconciliation that erases what happened", "reconciliation preserves the record", async () => {
    const lifecycle = loadModified("generation-lifecycle.js", [
      [
        "    status: resolution.status,\n    reconciliation: {\n      outcome: String(outcome),",
        "    status: resolution.status,\n    compilation: undefined,\n    unresolvedReason: \"\",\n    reconciliation: {\n      outcome: String(outcome),",
      ],
    ]);
    const job = {
      status: "UNRESOLVED", providerContacted: true, providerAnswered: false,
      unresolvedReason: "no answer came back", compilation: { plan: { compiler: { packId: "minimax-h3" } } },
    };
    const mutation = lifecycle.reconcileUnresolved(job, "not-accepted", { at: "now" });
    const after = { ...job, ...mutation };
    assert(after.compilation && after.compilation.plan, "the compiled plan must survive reconciliation");
    assert(after.unresolvedReason, "as must the reason it was unresolved");
    assert.strictEqual(after.reconciliation.previousStatus, "UNRESOLVED", "and that it was once unresolved");
  });

  /* =========================================================================
     5. A stale FAILED overwriting UNRESOLVED. */
  await control("a stale write resolving an unresolved job", "only an authoritative outcome may resolve uncertainty", async () => {
    const lifecycle = loadModified("generation-lifecycle.js", [
      ["  if (from === UNRESOLVED && !options.authoritative) return from;", "  /* control: uncertainty is displaced by anything */"],
    ]);
    assert.strictEqual(lifecycle.nextStatus("UNRESOLVED", "FAILED", {}), "UNRESOLVED",
      "a stale, non-authoritative FAILED must not turn 'we do not know' into 'we know it failed'");
  });

  /* =========================================================================
     6. The state made H3-specific. */
  await control("uncertainty handled only for one model family", "the state is generic, not per-model", async () => {
    /* The defect: the shared provider boundary bypassed for the image path, so only the
       H3 route can ever produce the state. */
    const falGeneration = loadModified("fal-generation.js", [
      [
        "    const { data } = await providerPost(`${cfg.baseUrl}/${model}`, {\n      method: \"POST\",\n      headers: {\n        \"content-type\": \"application/json\",\n        Authorization: `Key ${cfg.apiKey}`,\n        \"X-Fal-No-Retry\": \"1\",\n      },\n      body: JSON.stringify(input),\n    }, model);",
        "    const legacyResponse = await fetch(`${cfg.baseUrl}/${model}`, { method: \"POST\", headers: { \"content-type\": \"application/json\", Authorization: `Key ${cfg.apiKey}` }, body: JSON.stringify(input) });\n    const data = await legacyResponse.json().catch(() => ({}));\n    if (!legacyResponse.ok) throw new Error(normalizeError(data, legacyResponse.status));",
      ],
    ]);
    const s = await scenarioImage(falGeneration);
    try {
      const result = await s.submitImage("generic-check");
      const row = s.row(result.data.job?.id);
      assert(row, "the image submission produced a durable row");
      assert.strictEqual(row.status, "UNRESOLVED",
        "the plain image path must produce the same uncertainty state — it is a generation-safety contract, not an H3 feature");
    } finally {
      s.close();
    }
  });

  /* =========================================================================
     Everything real, afterwards. */
  {
    assert.strictEqual(RealLifecycle.classifyProviderFailure({ transmitted: true, httpStatus: null }).status, "UNRESOLVED");
    assert.strictEqual(RealLifecycle.classifyProviderFailure({ transmitted: true, httpStatus: 422 }).status, "FAILED");
    assert.strictEqual(RealLifecycle.nextStatus("UNRESOLVED", "FAILED", {}), "UNRESOLVED");
    assert.strictEqual(RealLifecycle.blocksResubmission({ status: "UNRESOLVED" }), true);
    assert.strictEqual(RealLifecycle.blocksResubmission({ status: "UNRESOLVED", reconciliation: { outcome: "not-accepted" } }), false);
  }

  console.log(
    `\nUnresolved-state negative controls passed: ${results.length} deliberate defects reintroduced in memory — `
    + `${results.map((row) => row.label).join("; ")} — every one detected by the property that guards it, `
    + "with the real modules green afterwards.\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

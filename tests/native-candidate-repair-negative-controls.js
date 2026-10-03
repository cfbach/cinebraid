const assert = require("assert"), fs = require("fs"), path = require("path"), express = require("express");
const { registerFalGeneration } = require("../src/generation/fal/fal-generation");
const { declaredGenerationBody, paidPermitFor } = require("./generation-request-fixture");
const Repair = require("../src/generation/candidate-repair");
const { fixture } = require("./helpers/native-candidate-repair-fixture");
const listen = app => new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
(async () => {
  const f = fixture(), file = path.join(f.owner.dir, "project.json"), app = express(); let server;
  const calls = [], provider = express(); provider.use(express.json({ limit: "25mb" }));
  provider.use((req, res) => { calls.push(req.path); res.status(500).json({ error: "Unexpected dispatch" }); });
  const mock = await listen(provider), mockOrigin = `http://127.0.0.1:${mock.address().port}`;
  try {
    app.use(express.json({ limit: "25mb" }));
    registerFalGeneration(app, { readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "repair-local-fixture", baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit", frameResolution: "2k", frameQuality: "high", maxConcurrent: 1 } } }),
      readProject: () => JSON.parse(fs.readFileSync(file)), writeProject: p => fs.writeFileSync(file, JSON.stringify(p)),
      activeSlug: () => f.owner.slug, projectDirForSlug: () => ({ ...f.owner, file }) });
    server = await listen(app); const origin = `http://127.0.0.1:${server.address().port}`;
    const post = async (url, body) => { const r = await fetch(origin + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
    const before = fs.readFileSync(file);
    const rejected = await post("/api/generation/candidate-repair/build", { ...f.body, mask: { ...f.body.mask, sourceConvention: "" } });
    assert.strictEqual(rejected.status, 400); assert.deepStrictEqual(fs.readFileSync(file), before);
    const built = await post("/api/generation/candidate-repair/build", f.body); assert.strictEqual(built.status, 200, JSON.stringify(built.data));
    const buildId = built.data.buildId;
    const planBody = { purpose: "correction", shotId: "SH-1", sourceBuildId: buildId, frameId: "FR-A", resolution: "2048x1152", quality: "high", outputCount: 1 };
    const preview = await post("/api/generation/fal/image/plan", planBody);
    assert.strictEqual(preview.status, 200); assert.strictEqual(preview.data.ok, true, JSON.stringify(preview.data.refusal));
    assert.strictEqual(preview.data.references[0].assetId, f.base.assetId);
    assert(preview.data.references.every(r => r.authority));
    const textPreview = await post("/api/generation/fal/image/plan", { ...planBody, prompt: preview.data.compiledPrompt + " Preserve the sticker." });
    assert.notStrictEqual(textPreview.data.planFingerprint, preview.data.planFingerprint, "final text is part of review identity");
    const changedSize = await post("/api/generation/fal/image/plan", { ...planBody, resolution: "1024x1024" });
    assert.notStrictEqual(changedSize.data.planFingerprint, preview.data.planFingerprint);
    for (const delta of [{ planFingerprint: "stale" }, { planFingerprint: "" }, { imagePlan: false }, { frameId: "wrong-frame" },
      { prompt: preview.data.compiledPrompt + " changed after review" }, { resolution: "1024x1024" }, { purpose: "frame", imagePlan: false }]) {
      const body = declaredGenerationBody({ ...planBody, imagePlan: true, prompt: preview.data.compiledPrompt, planFingerprint: preview.data.planFingerprint, ...delta });
      const permitted = await paidPermitFor("/api/generation/fal/jobs", body, origin);
      const result = await post("/api/generation/fal/jobs", permitted);
      assert(result.status >= 400, JSON.stringify(result));
      assert(!/PERMIT/.test(result.data.code || ""), "negative control must reach repair/fingerprint protection, not fail because its permit fixture is invalid");
      assert(["IMAGE_PLAN_CHANGED", "REPAIR_PLAN_REQUIRED", "REPAIR_TARGET_CHANGED"].includes(result.data.code), JSON.stringify(result));
      assert.strictEqual(calls.length, 0);
      const ledgerFile = path.join(f.owner.dir, "generation-jobs.json");
      if (fs.existsSync(ledgerFile)) { const ledger = JSON.parse(fs.readFileSync(ledgerFile)); assert.strictEqual((Array.isArray(ledger) ? ledger : ledger.jobs || []).length, 0); }
    }
    const current = JSON.parse(fs.readFileSync(file)), other = JSON.parse(JSON.stringify(current.shots[0]));
    other.id = "SH-2"; current.shots.push(other); fs.writeFileSync(file, JSON.stringify(current));
    const crossed = await post("/api/generation/fal/image/plan", { ...planBody, shotId: "SH-2" });
    assert.strictEqual(crossed.data.code, "REPAIR_TARGET_CHANGED");
    const crossBody = declaredGenerationBody({ ...planBody, shotId: "SH-2", imagePlan: true, prompt: preview.data.compiledPrompt, planFingerprint: preview.data.planFingerprint });
    const crossResult = await post("/api/generation/fal/jobs", await paidPermitFor("/api/generation/fal/jobs", crossBody, origin));
    assert.strictEqual(crossResult.data.code, "REPAIR_TARGET_CHANGED");
    assert.strictEqual(calls.length, 0);
    current.shots[0].candidateFiles[0].currentCorrectionBuildId = "newer-repair"; fs.writeFileSync(file, JSON.stringify(current));
    const superseded = await post("/api/generation/fal/image/plan", planBody);
    assert.strictEqual(superseded.data.code, "REPAIR_PACKAGE_CHANGED");
    const oldBody = declaredGenerationBody({ ...planBody, imagePlan: true, prompt: preview.data.compiledPrompt, planFingerprint: preview.data.planFingerprint });
    const oldResult = await post("/api/generation/fal/jobs", await paidPermitFor("/api/generation/fal/jobs", oldBody, origin));
    assert.strictEqual(oldResult.data.code, "REPAIR_PACKAGE_CHANGED");
    current.shots[0].candidateFiles[0].currentCorrectionBuildId = buildId;
    current.shots[0].desc = "Changed after Build"; fs.writeFileSync(file, JSON.stringify(current));
    const stale = await post("/api/generation/fal/image/plan", planBody); assert.strictEqual(stale.data.code, "REPAIR_CANON_CHANGED");
    assert.deepStrictEqual(current.productionAuthority, f.project.productionAuthority);
    assert.strictEqual(calls.length, 0);
    console.log("native-candidate-repair-negative: normal Build/preview, text/settings fingerprints, 9 paid-route refusals including purpose/legacy escape, cross-shot and superseded build, Canon staleness PASS; jobs = 0; provider calls = 0");
  } finally { if (server) await new Promise(r => server.close(r)); await new Promise(r => mock.close(r)); f.cleanup(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

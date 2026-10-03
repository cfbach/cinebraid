const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Repair = require("../src/generation/candidate-repair");
const { compileImageExecutionPlan } = require("../src/generation/image-execution");
const { serializeImagePlanForFal } = require("../src/generation/fal/fal-image-backend");
const { fixture } = require("./helpers/native-candidate-repair-fixture");
const Kernel = require("../public/shared-authority-kernel");
const { generationBindingRecord } = require("../src/generation/generation-binding");
const clone = v => JSON.parse(JSON.stringify(v));
(async () => {
  const f = fixture();
  try {
    const original = clone(f.project), inventory = Repair.inventory(f.project, f.owner, f.body);
    assert.strictEqual(inventory.appearances.length, 3);
    const prepared = Repair.prepare(f.project, f.owner, f.body);
    assert.deepStrictEqual(f.project, original, "draft preparation is pure");
    assert.strictEqual(prepared.files.length, 3, "guide, original mask and normalized mask are durable");
    await Repair.persistTechnical(f.owner, prepared);
    const id = Repair.register(f.project, prepared.build);
    Repair.verify(f.project, f.owner, prepared.build);
    assert.strictEqual(Kernel.currentHumanAuthority(f.project, { kind: "shot-frame", shotId: "SH-1", frameId: "FR-A" }), null);
    assert.deepStrictEqual(f.project.productionAuthority, original.productionAuthority);
    assert.strictEqual(f.project.shots[0].desc, original.shots[0].desc);
    assert.deepStrictEqual(f.project.shots[0].keyframes[0].approvedAssetId, original.shots[0].keyframes[0].approvedAssetId);
    const request = { project: f.project, owner: f.owner, purpose: "correction", shotId: "SH-1", buildId: id, resolution: "2048x1152", candidateCount: 1 };
    const compiled = compileImageExecutionPlan(request);
    const refs = compiled.plan.inputs.references;
    assert.deepStrictEqual(refs.map(r => r.role), ["base", "identity", "prop", "prop", "composition", "mask"]);
    assert.strictEqual(refs[0].source.assetId, f.base.assetId);
    assert(refs.every(r => r.source.assetId && r.source.contentHash && r.source.path));
    assert(!refs.some(r => /guardian|gate/i.test(r.production.label)), "nothing inherited from history");
    assert(compiled.compiledPrompt.includes("duplicate hilt"));
    assert(!compiled.compiledPrompt.includes("giant horned guardian"), "cast and historical context cannot donate an unselected appearance");
    assert(compiled.plan.warnings.some(r => r.code === "repair-context-scoped"));
    assert(compiled.plan.coverage.find(r => r.intent === "identity.canon").via.includes("#image2"), "selected appearance, not the unapproved canvas, holds identity intent");
    assert(!compiled.compiledPrompt.includes("full-shot transformation"));
    assert(JSON.stringify(prepared.build.spec.intentScope.excludedContext).includes("full-shot transformation"), "excluded broad context remains inspectable, not lost");
    const serialized = serializeImagePlanForFal(compiled.plan, compiled.capability, { resolveReference: r => r.source.path, config: {} });
    assert.strictEqual(serialized.model, "openai/gpt-image-2/edit");
    assert.strictEqual(serialized.input.image_urls.length, 5);
    assert.strictEqual(serialized.input.image_urls[0], refs[0].source.path);
    assert.strictEqual(serialized.input.mask_url, refs[5].source.path);
    assert(!("mask_image_url" in serialized.input));
    const maskBinding = serialized.bindings.find(b => b.field === "mask_url");
    assert.strictEqual(maskBinding.appliesTo, refs[0].refId);
    const provenance = generationBindingRecord({ plan: compiled.plan, serialized, sourceReferences: compiled.sourceReferences,
      project: f.project, shot: f.project.shots[0], frameId: "FR-A", resolveFile: address => path.join(f.owner.dir, address.replace(/^\/assets\//, "")) }).generationBinding;
    assert(provenance[0].file.includes("BASE.png"));
    assert.strictEqual(provenance[0].frameId, "FR-A");
    assert.strictEqual(provenance[0].assetId, f.base.assetId);
    assert.strictEqual(provenance.find(r => r.entityId === "SWORD").stateId, "state-carried");
    const ratio = compiled.plan.coverage.find(r => r.intent === "output.aspectRatio");
    assert.strictEqual(ratio.state, "represented");
    assert.strictEqual(compileImageExecutionPlan({ ...request, resolution: "1024x1024" }).plan.coverage.find(r => r.intent === "output.aspectRatio").state, "unsupported");
    fs.writeFileSync(path.join(f.owner.dir, "project.json"), JSON.stringify(f.project));
    const reopened = JSON.parse(fs.readFileSync(path.join(f.owner.dir, "project.json")));
    Repair.verify(reopened, f.owner, reopened.promptBuildsById[id]);
    const backup = path.join(f.workspace.home, "restored-projects"); fs.mkdirSync(backup);
    const restoredDir = path.join(backup, f.owner.slug); fs.cpSync(f.owner.dir, restoredDir, { recursive: true });
    const restoredOwner = { slug: f.owner.slug, dir: restoredDir };
    Repair.verify(reopened, restoredOwner, reopened.promptBuildsById[id]);
    assert.deepStrictEqual(compileImageExecutionPlan({ ...request, project: reopened, owner: restoredOwner }).plan, compiled.plan);
    for (const mutate of [p => p.shots[0].desc = "Changed Canon", p => p.promptBuildsById[id].spec.mustAvoid.push("New exclusion"),
      p => { p.props[0].continuityStates[0].approvedAssetId = "wrong-asset"; p.props[0].approvedAssetId = "wrong-asset"; },
      p => p.productionAuthority.receipts[0].id = "changed-receipt", p => p.shots[0].candidateFiles = []]) {
      const changed = clone(f.project); mutate(changed); assert.throws(() => Repair.verify(changed, f.owner, changed.promptBuildsById[id]), undefined, String(mutate));
    }
    for (const mutate of [b => { delete b.references[1].approvalTarget; b.references[1].approvalReceiptId = "fictional"; },
      b => b.references[0].assetId = f.body.appearances[0].assetId,
      b => b.references.find(r => r.role === "composition").authority = "current-human-receipt",
      b => b.references.find(r => r.role === "mask").baseAssetId = "another-base"]) {
      const changed = clone(f.project), build = changed.promptBuildsById[id]; mutate(build);
      build.repair.packageDigest = Repair.packageDigest(build);
      assert.throws(() => Repair.verify(changed, f.owner, build), undefined, "a rewritten checksum cannot fabricate input authority or class");
    }
    for (const r of prepared.build.references) {
      for (const address of ["/assets/unselected.png", "https://example.invalid/unselected.png"]) {
        const changed = clone(f.project), build = changed.promptBuildsById[id];
        build.references.find(row => row.key === r.key).url = address;
        build.repair.packageDigest = Repair.packageDigest(build);
        assert.throws(() => compileImageExecutionPlan({ ...request, project: changed }), undefined,
          "rewritten checksums cannot redirect any input class away from its verified bytes");
      }
      const file = path.join(f.owner.dir, r.path), bytes = fs.readFileSync(file);
      fs.writeFileSync(file, Buffer.from("changed"));
      assert.throws(() => Repair.verify(f.project, f.owner, prepared.build)); fs.writeFileSync(file, bytes);
    }
    assert.throws(() => Repair.prepare(f.project, f.owner, { ...f.body, baseAssetId: f.body.appearances[0].assetId }));
    assert.throws(() => Repair.prepare(f.project, f.owner, { ...f.body, appearances: [{ ...f.body.appearances[0], approvalReceiptId: "old-receipt" }] }));
    assert.throws(() => compileImageExecutionPlan({ ...request, purpose: "frame" }));
    const crossShot = clone(f.project), other = clone(crossShot.shots[0]); other.id = "SH-2";
    crossShot.shots.push(other);
    assert.throws(() => compileImageExecutionPlan({ ...request, project: crossShot, shotId: "SH-2" }),
      e => e.code === "REPAIR_TARGET_CHANGED", "another shot cannot borrow this build even with the same frame ID");
    const newer = clone(f.project); newer.shots[0].candidateFiles[0].currentCorrectionBuildId = "newer-repair";
    assert.throws(() => compileImageExecutionPlan({ ...request, project: newer }), e => e.code === "REPAIR_PACKAGE_CHANGED",
      "a newer explicit package invalidates the older review; historical inputs remain readable, not current");
    console.log("native-candidate-repair: current authority, exact ordered plan/mask, pure draft, durable reopen/restore and freshness refusals PASS; provider calls = 0");
  } finally { f.cleanup(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

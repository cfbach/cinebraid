const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  annotateProfileLibraryExecution,
  profileExecutionSupport,
  publicAdapters,
} = require("../src/generation/generation-options");
const { loadModelIntelligence } = require("../src/generation/model-intelligence");
const { getModelPack } = require("../src/generation/generation-compiler");
const { resolveImageMode, compileImageExecutionPlan, ImageExecutionError } = require("../src/generation/image-execution");
const { addFramePromptBuild, buildRef, REF_PROP } = require("./image-execution-fixture");

const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/model-profiles.json"), "utf8")).profiles;
const annotated = annotateProfileLibraryExecution({ profiles }).profiles;
const byId = (id) => annotated.find((row) => row.id === id);
const qualified = annotated.filter((row) => row.execution.promptQualification.status === "qualified");
const expected = new Map([
  ["gpt-image-2/t2i", "gpt-image-2/standard"],
  ["gpt-image-2/blocking", "gpt-image-2/standard"],
  ["gpt-image-2/edit", "gpt-image-2/standard"],
  ["gpt-image-2/inpaint", "gpt-image-2/standard"],
  ["gpt-image-2/multi-reference", "gpt-image-2/standard"],
  ["minimax-h3/t2v", "minimax-h3/fl2va"],
  ["minimax-h3/i2v", "minimax-h3/fl2va"],
  ["minimax-h3/flf", "minimax-h3/fl2va"],
  ["minimax-h3/multi-frame", "minimax-h3/ref2va"],
]);
assert.deepStrictEqual(new Set(qualified.map((row) => row.id)), new Set(expected.keys()),
  "Only the nine exact dispatchable prompt targets are qualified");
for (const [id, modelId] of expected) {
  const row = byId(id);
  assert(row.execution.dispatchable, id);
  assert.strictEqual(row.execution.modelId, modelId, id);
  const pack = getModelPack(row.family);
  assert.strictEqual(row.execution.promptQualification.packVersion, pack.packVersion, id);
  assert.strictEqual(row.execution.promptQualification.playbookVersion, pack.playbook.version, id);
}

const legacy = annotated.filter((row) => !expected.has(row.id));
assert.strictEqual(legacy.length, 39, "The historical prompt catalogue remains intact");
for (const row of legacy) {
  assert.strictEqual(row.execution.dispatchable, false, row.id);
  assert.strictEqual(row.execution.promptQualification.status, "legacy-unqualified", row.id);
  assert(row.execution.reason, row.id);
}
assert(/no adapter for seedance-2 ships/i.test(byId("seedance-2/i2v").execution.reason),
  "A historical profile keeps the existing clear refusal");

const clone = (row) => JSON.parse(JSON.stringify(row));
const i2v = profiles.find((row) => row.id === "minimax-h3/i2v");
const edit = profiles.find((row) => row.id === "gpt-image-2/edit");
const stale = (row) => {
  const support = profileExecutionSupport(row);
  assert.strictEqual(support.dispatchable, false);
  assert.strictEqual(support.promptQualification.status, "stale-unqualified");
};
{
  const wrongVariant = clone(i2v);
  wrongVariant.promptQualification.modelId = "minimax-h3/ref2va";
  stale(wrongVariant);
  const wrongPack = clone(i2v);
  wrongPack.promptQualification.packVersion = "historical";
  stale(wrongPack);
  const wrongPlaybook = clone(i2v);
  wrongPlaybook.promptQualification.playbookVersion = "historical";
  stale(wrongPlaybook);
  const noQualification = clone(edit);
  delete noQualification.promptQualification;
  assert.strictEqual(profileExecutionSupport(noQualification).promptQualification.status, "legacy-unqualified",
    "A pack and adapter alone do not qualify a historical profile");
  const noAdapter = profileExecutionSupport(edit, publicAdapters().filter((row) => row.adapterId !== "fal-gpt-image-2"));
  assert.strictEqual(noAdapter.dispatchable, false);
  assert.strictEqual(noAdapter.promptQualification.status, "stale-unqualified");
}
{
  const intelligence = loadModelIntelligence();
  const model = intelligence.getModel("gpt-image-2/standard");
  const withoutMode = {
    ...intelligence,
    getModel(id) {
      return id === model.id
        ? { ...model, capabilities: { ...model.capabilities, modes: model.capabilities.modes.filter((mode) => mode !== "inpaint") } }
        : intelligence.getModel(id);
    },
  };
  staleWith(byId("gpt-image-2/inpaint"), withoutMode);
  const noOffering = {
    ...intelligence,
    offeringsForModel(id) {
      return intelligence.offeringsForModel(id).map((entry) =>
        entry.surface.surfaceId === "fal-queue"
          ? { ...entry, offering: { ...entry.offering, state: "catalogued" } }
          : entry);
    },
  };
  staleWith(edit, noOffering);
}
function staleWith(row, intelligence) {
  const result = profileExecutionSupport(row, publicAdapters(), intelligence);
  assert.strictEqual(result.dispatchable, false, row.id);
  assert.strictEqual(result.promptQualification.status, "stale-unqualified", row.id);
}

const inpaint = byId("gpt-image-2/inpaint");
assert.strictEqual(inpaint.mode, "inpaint");
assert.strictEqual(inpaint.execution.adapterId, "fal-gpt-image-2");
assert.strictEqual(resolveImageMode("frame", [{ role: "base" }, { role: "mask" }]), "inpaint",
  "Base and mask resolve to the explicit inpaint mode");
assert.throws(() => resolveImageMode("frame", [{ role: "mask" }]),
  (error) => error instanceof ImageExecutionError && error.code === "IMAGE_MASK_WITHOUT_BASE");
{
  const project = {
    meta: { title: "Disposable inpaint provenance", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
  const base = {
    ...buildRef(REF_PROP, "/assets/shots/SH-1/base.png"),
    key: "base-1", role: "base", label: "Approved base",
  };
  const mask = {
    ...buildRef(REF_PROP, "/assets/shots/SH-1/mask.png"),
    key: "mask-1", role: "mask", label: "Matching mask",
  };
  const buildId = addFramePromptBuild(project, "SH-1", {
    profileId: "gpt-image-2/edit", references: [base, mask],
  });
  const compiled = compileImageExecutionPlan({
    project, purpose: "frame", shotId: "SH-1", buildId, aspectRatio: "16:9",
  });
  assert.strictEqual(compiled.mode, "inpaint");
  assert.strictEqual(compiled.profile.id, "gpt-image-2/inpaint",
    "The provider plan names its effective qualified inpaint policy");
  assert.strictEqual(compiled.profile.sourceProfileId, "gpt-image-2/edit",
    "The authored source profile survives the effective-mode mapping");
  assert.deepStrictEqual(compiled.plan.inputs.references.map((row) => row.role), ["base", "mask"],
    "The provenance mapping must not reorder or remove the approved base and mask");
}
const h3 = qualified.filter((row) => row.family === "minimax-h3");
for (const row of h3) {
  assert.strictEqual(row.limits.writingTargetCharacters, 2000, row.id);
  assert.strictEqual(row.limits.publishedGuidePromptCharacters, 7000, row.id);
  assert.strictEqual(row.limits.maxPromptCharacters, undefined,
    "The editorial writing target must not masquerade as a provider maximum");
}
console.log("Model-profile qualification passed: 9 exact qualified targets, 39 legacy/unqualified profiles, inpaint base/mask mapping, stale variant/pack/playbook/model/offering/adapter refusals, and separate H3 writing target.");

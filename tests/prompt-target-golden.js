/* Same production intent, nine currently qualified prompt targets.
 *
 * This is a cross-pack witness, not a screenshot or a frozen paragraph. The same
 * director's shot must become different, valid target packages while every piece of
 * intent is accounted for. Image and motion prompts must never borrow each other's
 * input, sound, timing or approval semantics.
 */
const assert = require("assert");
const Compiler = require("../src/generation/generation-compiler");
const Contracts = require("../src/generation/generation-contracts");
const { resolveCapability } = require("../public/shared-generation-capability");
const Image2 = require("../model-packs/gpt-image-2");
const H3 = require("../model-packs/minimax-h3");
const {
  baseSpec, FRAME_A, FRAME_B, REF_IDENTITY, REF_LOCATION, REF_PROP,
  REF_MOTION, REF_VOICE,
} = require("./generation-compiler-fixture");

const canon = baseSpec();
const canonBytes = JSON.stringify(canon);
const base = { ...FRAME_A, key: "edit-base", role: "base", label: "Approved edit base" };
const mask = { key: "edit-mask", role: "mask", mediaType: "image", label: "Approved edit mask", url: "/assets/shots/SH-03-02/mask.png" };
const targets = [
  ["gpt-image-2/t2i", "t2i", Image2, []],
  ["gpt-image-2/blocking", "blocking", Image2, []],
  ["gpt-image-2/edit", "edit", Image2, [base]],
  ["gpt-image-2/inpaint", "inpaint", Image2, [mask, base]],
  ["gpt-image-2/multi-reference", "multi-reference", Image2, [REF_PROP, REF_LOCATION, REF_IDENTITY]],
  ["minimax-h3/t2v", "t2v", H3, []],
  ["minimax-h3/i2v", "i2v", H3, [FRAME_A]],
  ["minimax-h3/flf", "flf", H3, [FRAME_B, FRAME_A]],
  ["minimax-h3/multi-frame", "r2v", H3, [REF_VOICE, REF_MOTION, REF_LOCATION, REF_IDENTITY]],
];
const plans = new Map();
const coverage = (plan, intent) => plan.coverage.find((row) => row.intent === intent);
const roles = (plan) => plan.inputs.references.map((row) => row.role);
const refs = (plan) => plan.inputs.references.map((row) => row.refId);
const warn = (plan, pattern) => plan.warnings.some((row) => pattern.test(`${row.code} ${row.message}`));

for (const [profileId, mode, pack, references] of targets) {
  const modelId = pack === H3
    ? mode === "r2v" ? "minimax-h3/ref2va" : "minimax-h3/fl2va"
    : "gpt-image-2/standard";
  const plan = Compiler.compileGenerationPlan({
    spec: canon, references, mode, modelId, surface: "api",
    capability: resolveCapability({ model: pack.capabilityLayer(mode, "api") }),
  });
  const validation = Contracts.validateGenerationPlan(plan);
  assert(validation.ok, `${profileId}: ${JSON.stringify(validation.errors)}`);
  assert.strictEqual(plan.model.modelId, modelId, `${profileId}: exact model identity`);
  assert.strictEqual(plan.compiler.packId, pack.PACK_ID, `${profileId}: exact pack identity`);
  assert.strictEqual(plan.compiler.packVersion, pack.PACK_VERSION, `${profileId}: exact pack version`);
  assert.strictEqual(plan.compiler.playbookVersion, pack.pack.playbook.version, `${profileId}: exact playbook version`);
  assert(plan.inputs.prompt.includes("lowers the parcel"), `${profileId}: director's action survives`);
  assert(!warn(plan, /intent-unaccounted|coverage-unverified/), `${profileId}: no silent intent loss`);
  for (const row of Compiler.inventoryIntent(canon)) {
    const entry = coverage(plan, row.key);
    assert(entry, `${profileId}: ${row.key} must be accounted for`);
    assert(["represented", "anchored", "omitted-by-design", "unsupported"].includes(entry.state),
      `${profileId}: ${row.key} has an explicit coverage state`);
    if (entry.state === "unsupported")
      assert(plan.warnings.some((warning) => warning.intent === row.key),
        `${profileId}: unsupported ${row.key} must have a warning`);
  }
  plans.set(profileId, plan);
}
assert.strictEqual(JSON.stringify(canon), canonBytes, "target compilation never edits Canon");
assert.strictEqual(new Set([...plans.values()].map((plan) => plan.inputs.prompt)).size, targets.length,
  "one shot becomes nine materially target-specific prompts");

const image = (id) => plans.get(`gpt-image-2/${id}`);
const motion = (id) => plans.get(`minimax-h3/${id}`);
for (const id of ["t2i", "blocking", "edit", "inpaint", "multi-reference"]) {
  const plan = image(id);
  assert.strictEqual(plan.outputType, "image", `${id}: still-image output`);
  assert.strictEqual(plan.output.durationSeconds, undefined, `${id}: no video duration on a still`);
  assert.strictEqual(coverage(plan, "camera.movement").state, "omitted-by-design", `${id}: movement belongs to motion pass`);
  assert.strictEqual(coverage(plan, "dialogue.line").state, "omitted-by-design", `${id}: dialogue belongs to motion pass`);
}
assert(!image("blocking").inputs.prompt.includes("olive flight jacket"), "blocking does not become an identity look");
assert(image("t2i").inputs.prompt.includes("olive flight jacket"), "unanchored T2I constructs identity");
assert.deepStrictEqual(roles(image("multi-reference")), ["identity", "location", "prop"],
  "multi-reference retains production roles in canonical order");
assert.strictEqual(coverage(image("multi-reference"), "identity.canon").state, "anchored",
  "the approved identity image, not prompt prose, carries visual identity");
assert.deepStrictEqual(roles(image("edit")), ["base"], "edit retains the exact base");
assert.deepStrictEqual(roles(image("inpaint")), ["base", "mask"], "inpaint sorts base ahead of mask");
assert.deepStrictEqual(refs(image("inpaint")), ["edit-base", "edit-mask"], "inpaint preserves exact asset selection");
assert.deepStrictEqual(image("inpaint").settings.extensions["gpt-image-2/standard"].referenceBindings,
  { "edit-base": "image[0]", "edit-mask": "mask->image[0]" },
  "the mask applies to the selected base, not an incidental image");
assert(image("inpaint").inputs.prompt.includes("inside the masked region"), "inpaint uses a distinct policy");

for (const id of ["t2v", "i2v", "flf", "multi-frame"]) {
  const plan = motion(id);
  assert.strictEqual(plan.outputType, "video", `${id}: video output`);
  assert.strictEqual(coverage(plan, "camera.movement").state, "represented", `${id}: camera move reaches prompt`);
  assert.strictEqual(coverage(plan, "performance.emotion").state, "represented", `${id}: actor performance reaches prompt`);
  assert.strictEqual(coverage(plan, "dialogue.line").state, "represented", `${id}: actual dialogue reaches prompt`);
  assert(!/The camera one slow|The move continue\b/i.test(plan.inputs.prompt), `${id}: no malformed camera grammar`);
}
assert.deepStrictEqual(roles(motion("i2v")), ["first-frame"], "I2V uses only the opening frame");
assert.deepStrictEqual(refs(motion("flf")), ["kf-a", "kf-b"], "FLF binds by role, not supplied array position");
assert.strictEqual(motion("flf").endpoints.firstFrame.refId, "kf-a");
assert.strictEqual(motion("flf").endpoints.lastFrame.refId, "kf-b");
assert.deepStrictEqual(motion("flf").settings.extensions["minimax-h3/fl2va"].referenceBindings,
  { "kf-a": "first_frame", "kf-b": "last_frame" });
assert.deepStrictEqual(roles(motion("multi-frame")), ["identity", "location", "motion-reference", "voice"],
  "R2V preserves image, video and voice roles in canonical order");
assert.deepStrictEqual(refs(motion("multi-frame")), ["id-kai", "loc-hangar", "mo-track", "vo-kai"],
  "R2V keeps exact selected inputs, not inferred replacements");
assert.strictEqual(motion("multi-frame").model.modelId, "minimax-h3/ref2va",
  "reference-led generation uses Ref2VA, not the FL2VA checkpoint");

/* Last Seat-shaped Frame A uses one copied whole-shot directive in two
   structured intent fields. The provider request prints it once while both
   fields remain represented; two references keep their planner order. */
const longDirective = "WHOLE-SHOT STORY INTENT: Rex remains with the folding chair. FRAME A ONLY. "
  + "Hold his stance, coat folds, chair geometry, room axis, and practical lighting without inventing the excluded gate or sword. ".repeat(23)
  + "Motion method remains undecided.";
const copiedIntent = baseSpec({
  actions: [{ start: 0, end: 8, action: longDirective }],
  initialState: { ...canon.initialState, subject: longDirective },
});
const copiedBytes = JSON.stringify(copiedIntent);
const copiedPlan = Compiler.compileGenerationPlan({
  spec: copiedIntent,
  references: [REF_PROP, REF_IDENTITY],
  mode: "multi-reference",
  modelId: "gpt-image-2/standard",
  surface: "api",
  capability: resolveCapability({ model: Image2.capabilityLayer("multi-reference", "api") }),
});
assert.strictEqual(JSON.stringify(copiedIntent), copiedBytes, "provider compiler never revises copied Canon");
assert.deepStrictEqual(refs(copiedPlan), ["id-kai", "pr-parcel"], "two inputs retain canonical identity-then-prop order");
assert.strictEqual((copiedPlan.inputs.prompt.match(/WHOLE-SHOT STORY INTENT/g) || []).length, 1,
  "copied directive appears once in the exact provider request");
assert.strictEqual((copiedPlan.inputs.prompt.match(/FRAME A ONLY/g) || []).length, 1,
  "the copied frame restriction appears once");
assert(copiedPlan.inputs.prompt.includes("Motion method remains undecided."),
  "the long directive's last qualification is retained");
assert.strictEqual(coverage(copiedPlan, "action.primary").state, "represented");
assert.strictEqual(coverage(copiedPlan, "state.initial").state, "represented",
  "one printed sentence explicitly covers both equivalent intent fields");
const extraState = Compiler.compileGenerationPlan({
  spec: { ...copiedIntent, initialState: { ...copiedIntent.initialState,
    subject: longDirective + " The folding chair edge remains visible." } },
  references: [REF_PROP, REF_IDENTITY],
  mode: "multi-reference",
  modelId: "gpt-image-2/standard",
  surface: "api",
  capability: resolveCapability({ model: Image2.capabilityLayer("multi-reference", "api") }),
});
assert(extraState.inputs.prompt.includes("The folding chair edge remains visible."),
  "distinct initial-state detail is not removed by exact-copy dedup");
assert.strictEqual(coverage(extraState, "state.initial").state, "represented");
console.log("Prompt target golden matrix passed: one unchanged canonical shot compiled into nine qualified target packages with exact role/order, structural FLF and mask bindings, modality-specific movement/dialogue coverage, and no silent intent loss.");

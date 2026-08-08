/* Negative controls for the generation-compiler suite.
 *
 * A regression test that has never failed is a claim, not evidence. Each control below
 * reintroduces exactly one of the defects the C1 work fixed, then asserts that the
 * corresponding property FAILS. A control that stays green is the real failure: it means
 * the test it guards would not notice the defect coming back.
 *
 * The defect is introduced by compiling a modified copy of the source IN MEMORY. Nothing
 * is written to disk and no file is reverted, because a broad revert is how unrelated
 * unstaged work gets discarded. The module registry is restored explicitly afterwards,
 * and the final block re-runs the real modules to prove the process ends clean.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const Compiler = require("../generation-compiler");
const Contracts = require("../generation-contracts");
const H3 = require("../model-packs/minimax-h3");
const {
  PARCEL, FRAME_A, FRAME_B, REF_IDENTITY,
  baseSpec, capabilityFor, seedCapableCapability, modelIdFor,
  covered, state, warnedAbout,
} = require("./generation-compiler-fixture");

/* ---------------------------------------------------------------------------
   In-memory patching. */
function loadModified(relative, edits) {
  const file = path.join(__dirname, "..", relative);
  /* Normalised to LF before matching. Several anchors span two lines, and a Windows
     checkout with core.autocrlf on would give them \r\n — so the anchor would not match,
     the control would report itself as stale, and the failure would look like a source
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

/* Loading a modified pack re-runs its registerModelPack call against the real registry.
   Restoring the pristine object afterwards keeps the damage inside the control. */
const PRISTINE_PACK = H3.pack;
function restoreRegistry() {
  Compiler.registerModelPack(PRISTINE_PACK);
  assert.strictEqual(Compiler.getModelPack("minimax-h3"), PRISTINE_PACK, "the real pack must be back in the registry");
}

function planWith({ compiler = Compiler, pack = PRISTINE_PACK, mode, references = [], spec = baseSpec(), capability, seed } = {}) {
  return compiler.compileGenerationPlan({
    spec, references, mode, pack,
    modelId: modelIdFor(mode),
    surface: "api",
    capability: capability || capabilityFor(mode),
    seed,
  });
}

const results = [];
/* `assertion` is the exact property the real suite asserts. It must throw here. */
function control(label, guardedTest, run) {
  let detected = false;
  let outcome = "";
  try {
    run();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = true;
    outcome = error.message.split("\n")[0];
  } finally {
    restoreRegistry();
  }
  assert(detected,
    `NEGATIVE CONTROL FAILED: removing ${label} did not break "${guardedTest}". `
    + "That test cannot detect the defect it exists for.");
  results.push({ label, guardedTest, outcome });
}

/* ===========================================================================
   1. Action propagation -> the motion tests must fail. */
control("action propagation", "meaningful action survives", () => {
  const pack = loadModified("model-packs/minimax-h3.js", [
    ["  return kept.map((row, index) => {", "  return [];\n  return kept.map((row, index) => {"],
  ]);
  const plan = planWith({ pack: pack.pack, mode: "i2v", references: [FRAME_A] });
  assert(plan.inputs.prompt.toLowerCase().includes("lowers the parcel"), "meaningful action survives");
});

/* ===========================================================================
   2. Frame B binding -> the first/last-frame endpoint contract must fail. */
control("the last-frame binding", "both endpoints survive as structured inputs", () => {
  const compiler = loadModified("generation-compiler.js", [
    ['for (const [field, role] of [["firstFrame", "first-frame"], ["lastFrame", "last-frame"]]) {\n    /* The binding comes from the ROLE',
      'for (const [field, role] of [["firstFrame", "first-frame"]]) {\n    /* The binding comes from the ROLE'],
  ]);
  const plan = planWith({ compiler, mode: "flf", references: [FRAME_A, FRAME_B] });
  assert(plan.endpoints.firstFrame && plan.endpoints.lastFrame, "both endpoints survive as structured inputs");
});
/* And the contract, independently of the compiler, must refuse the result. */
control("the last-frame binding", "an FLF plan satisfies the GenerationPlan contract", () => {
  const compiler = loadModified("generation-compiler.js", [
    ['for (const [field, role] of [["firstFrame", "first-frame"], ["lastFrame", "last-frame"]]) {\n    /* The binding comes from the ROLE',
      'for (const [field, role] of [["firstFrame", "first-frame"]]) {\n    /* The binding comes from the ROLE'],
  ]);
  const plan = planWith({ compiler, mode: "flf", references: [FRAME_A, FRAME_B] });
  const validation = Contracts.validateGenerationPlan(plan);
  assert(validation.ok, `flf plan must satisfy the GenerationPlan contract: ${JSON.stringify(validation.errors)}`);
});

/* ===========================================================================
   3. Camera propagation -> the coverage and semantic camera tests must fail. */
control("camera propagation", "camera direction survives and is recorded as represented", () => {
  const pack = loadModified("model-packs/minimax-h3.js", [
    ["  return parts.length ? { title: titles.camera, body: joinClauses(parts) } : null;",
      "  return null;"],
  ]);
  const plan = planWith({ pack: pack.pack, mode: "t2v" });
  assert.strictEqual(state(plan, "camera.movement"), "represented", "camera direction survives");
});
/* The core's own check is the backstop: an unclaimed intent must still surface. */
control("the unaccounted-intent check", "an intent no pack claims becomes a visible gap", () => {
  const compiler = loadModified("generation-compiler.js", [
    ["  for (const row of inventory)\n    if (!coverage.has(row.key))", "  for (const row of [])\n    if (!coverage.has(row.key))"],
  ]);
  const forgetful = { packId: "t", packVersion: "1", playbook: { version: "1" }, models: {}, compileMode: () => ({ prompt: "Do something." }) };
  const plan = planWith({ compiler, pack: forgetful, mode: "t2v" });
  assert.strictEqual(state(plan, "action.primary"), "unsupported", "a dropped intent becomes a visible gap");
});

/* ===========================================================================
   4. The unsupported-reference warning -> the reference tests must fail. */
control("the over-limit reference warning", "the excess warns and nothing is silently discarded", () => {
  const pack = loadModified("model-packs/minimax-h3.js", [
    ["      coverage.warn({\n        code: \"reference-over-limit\",", "      if (false) coverage.warn({\n        code: \"reference-over-limit\","],
  ]);
  const many = Array.from({ length: 11 }, (_, index) => ({
    key: `extra-${index}`, label: `Approved still ${index + 1}`, mediaType: "image", role: "reference", url: `/x${index}.png`,
  }));
  const plan = planWith({ pack: pack.pack, mode: "r2v", references: [REF_IDENTITY, ...many] });
  assert(warnedAbout(plan, /reference-over-limit/), "the excess warns");
});

/* ===========================================================================
   5. Raw-identifier sanitation -> the prompt hygiene tests must fail. */
control("raw-identifier sanitation", "internal identifiers never reach model-facing prose", () => {
  const compiler = loadModified("generation-compiler.js", [
    ["  for (const identifier of internalIdentifiers(spec, manifest)) {", "  for (const identifier of []) {"],
  ]);
  const spec = baseSpec({
    actions: [{ start: 0, end: 8, action: `${PARCEL} settles flat on the chalk line.` }],
    promptEntities: [{ id: PARCEL, name: "the sealed parcel", type: "prop", descriptor: "the sealed parcel" }],
  });
  const plan = planWith({ compiler, mode: "i2v", references: [FRAME_A], spec });
  assert(!plan.inputs.prompt.includes(PARCEL), `${PARCEL} must not appear in the i2v prompt`);
});
/* The contract refuses it too, so a pack that hand-builds a prompt cannot get around it. */
control("raw-identifier sanitation", "the contract refuses an identifier in the prompt", () => {
  const compiler = loadModified("generation-compiler.js", [
    ["  for (const identifier of internalIdentifiers(spec, manifest)) {", "  for (const identifier of []) {"],
  ]);
  const spec = baseSpec({
    actions: [{ start: 0, end: 8, action: `${PARCEL} settles flat on the chalk line.` }],
    promptEntities: [{ id: PARCEL, name: "the sealed parcel", type: "prop", descriptor: "the sealed parcel" }],
  });
  const plan = planWith({ compiler, mode: "i2v", references: [FRAME_A], spec });
  const validation = Contracts.validateGenerationPlan(plan);
  assert(validation.ok, `the plan must satisfy the contract: ${JSON.stringify(validation.errors)}`);
});

/* ===========================================================================
   6. Seed persistence on a supporting capability -> reproducibility must fail. */
control("seed persistence", "a supported seed survives into the plan", () => {
  const compiler = loadModified("generation-compiler.js", [
    ['    settings = { seedMode: "explicit", seed: Number(input.seed) };', '    settings = { seedMode: "random" };'],
  ]);
  const plan = planWith({ compiler, mode: "t2v", capability: seedCapableCapability("t2v"), seed: 90210 });
  assert.strictEqual(plan.settings.seed, 90210, "the seed survives compile");
  assert.strictEqual(state(plan, "reproducibility.seed"), "represented");
});
/* Losing it further along the chain is caught too: a job minted from the plan must
   still carry it. */
control("seed persistence into the job", "the seed survives compile -> job", () => {
  const compiler = loadModified("generation-compiler.js", [
    ["      ...(isRecord(compiled.parameters) ? { extensions: { [modelId]: compiled.parameters } } : {}),",
      "      ...(isRecord(compiled.parameters) ? { extensions: { [modelId]: compiled.parameters } } : {}),\n      seed: undefined,"],
  ]);
  const plan = planWith({ compiler, mode: "t2v", capability: seedCapableCapability("t2v"), seed: 90210 });
  const job = { ...plan, jobId: "job-1", status: "draft", outputType: "video" };
  assert.strictEqual(job.settings.seed, 90210, "the seed survives compile -> job");
});

/* ===========================================================================
   Restoration. Every control ran against a copy; the real modules must be untouched and
   the real properties must hold. */
{
  restoreRegistry();
  const flf = planWith({ mode: "flf", references: [FRAME_A, FRAME_B] });
  assert(flf.endpoints.firstFrame && flf.endpoints.lastFrame, "the real compiler still binds both endpoints");
  assert(Contracts.validateGenerationPlan(flf).ok, "and the real plan still satisfies the contract");
  assert.strictEqual(state(flf, "camera.movement"), "represented", "camera propagation is intact");
  assert(flf.inputs.prompt.toLowerCase().includes("lowers the parcel"), "action propagation is intact");

  const leaky = baseSpec({
    actions: [{ start: 0, end: 8, action: `${PARCEL} settles flat on the chalk line.` }],
    promptEntities: [{ id: PARCEL, name: "the sealed parcel", type: "prop", descriptor: "the sealed parcel" }],
  });
  assert(!planWith({ mode: "i2v", references: [FRAME_A], spec: leaky }).inputs.prompt.includes(PARCEL),
    "identifier sanitation is intact");

  const seeded = planWith({ mode: "t2v", capability: seedCapableCapability("t2v"), seed: 90210 });
  assert.strictEqual(seeded.settings.seed, 90210, "seed propagation is intact");

  const many = Array.from({ length: 11 }, (_, index) => ({
    key: `extra-${index}`, label: `Approved still ${index + 1}`, mediaType: "image", role: "reference", url: `/x${index}.png`,
  }));
  assert(warnedAbout(planWith({ mode: "r2v", references: [REF_IDENTITY, ...many] }), /reference-over-limit/),
    "over-limit warning is intact");

  /* And the H3 facts were not mutated by any patched copy. */
  assert.strictEqual(H3.H3_FACTS.maxPromptCharacters, 7000);
  assert.strictEqual(H3.H3_FACTS.seed.supported, false);
}

console.log(
  `Negative controls passed: ${results.length} deliberate defects reintroduced in memory — action propagation, `
  + "both halves of the last-frame binding, camera propagation, the core's unaccounted-intent backstop, the "
  + "over-limit reference warning, identifier sanitation at the compiler and at the contract, and seed persistence "
  + "into the plan and into the job — every one detected by the test that guards it, with the registry restored and "
  + "all real properties green afterwards.",
);

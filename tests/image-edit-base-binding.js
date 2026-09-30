/* Edit base binding — one ordered request from the compiled prompt to the provider.
 *
 * THE DEFECT THIS GUARDS (TLS-005 prompt review, U25, reproduced on public main
 * 5187b7f). A frame package carrying an explicitly selected edit base, an approved prop
 * reference and a gesture guide compiled in two wrong ways at once:
 *
 *   - the prompt engine moved every composition guide to Image 1 and took the
 *     "EDIT THE BLOCKING GUIDE" branch, so the approved frame was prompted as
 *     "location design authority" for its own guide;
 *   - the dispatch planner's canonical order put `base` behind identity, place, prop
 *     AND `composition`, so the frame being edited went to fal as image_urls[2] — and
 *     OpenAI applies a mask to the FIRST image, which would have been the chair.
 *
 * The contract now: an explicitly selected edit base is Image 1 everywhere; its mask
 * binds to it and to nothing else; a composition or gesture guide keeps a supporting
 * role; "edit this frame" and "turn a guide into a frame" are distinct operations; and
 * the numbered inputs a screen shows, the `#imageN` legend the prompt carries and the
 * `image_urls` order the provider receives are one list. Every assertion below holds
 * without a network, a provider or a clock; the negative controls at the end reintroduce
 * each half of the defect in memory and prove the suite would catch it.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PROMPT_ENGINE_FILE = path.join(ROOT, "src", "generation", "prompt-engine.js");
const COMPILER_FILE = path.join(ROOT, "src", "generation", "generation-compiler.js");
const BACKEND_FILE = path.join(ROOT, "src", "generation", "fal", "fal-image-backend.js");

const PromptEngine = require("../src/generation/prompt-engine");
const Compiler = require("../src/generation/generation-compiler");
const Pack = require("../model-packs/gpt-image-2");
const { compileImageExecutionPlan, resolveImageMode, resolveImageOperation, ImageExecutionError } = require("../src/generation/image-execution");
const { FalImageBackendError, resolveImageFalCapability, serializeImagePlanForFal } = require("../src/generation/fal/fal-image-backend");
const BuildHistory = require("../public/shared-build-history");
const { baseSpec } = require("./generation-compiler-fixture");
const { addFramePromptBuild, buildRef } = require("./image-execution-fixture");

const MODEL_ID = "gpt-image-2/standard";
const notes = [];
const note = (line) => notes.push(line);
const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* The TLS-005 shape, synthetic. An approved frame being edited, an approved prop that
   controls one object's construction, an UNAPPROVED gesture guide for where a hand
   goes, and — for the inpaint half — an alpha mask over the region being changed. */
const V002 = { key: "EXACT_V002", label: "Exact V002 edit base", role: "base", mediaType: "image", url: "/assets/shots/TLS-005/takes/V002.png", instruction: "Edit this production image; preserve untouched content." };
const CHAIR = { key: "APPROVED_CHAIR", label: "Approved standalone chair", role: "prop", sourceType: "prop", mediaType: "image", url: "/assets/props/CHAIR.png", instruction: "Construction only, not scene composition." };
const GUIDE = { key: "LEFT_GRIP_GUIDE", label: "Unapproved left-grip placement guide", role: "composition", mediaType: "image", url: "/assets/shots/TLS-005/blocking/GUIDE.png", instruction: "Gesture/placement only; not editable source.", blocking: true, blockingAdherence: "strict" };
const MASK = { key: "GRIP_MASK", label: "Left-grip edit mask", role: "mask", mediaType: "image", url: "/assets/shots/TLS-005/blocking/GRIP_MASK.png", instruction: "Alpha mask over the grip and folded chair only." };
const FIRST = { key: "KF_A", label: "Approved opening frame", role: "first-frame", mediaType: "image", url: "/assets/shots/TLS-005/takes/A.png" };

function editSpec(overrides = {}) {
  return baseSpec({
    purpose: "edit",
    shotId: "TLS-005",
    narrativePurpose: "Correct only the left wrist grip and remove the folded chair.",
    initialState: { subject: "Rex in rear three-quarter, crossing into the gate screen-right.", staging: "", camera: "", environment: "The existing V002 gate." },
    actions: [{ start: 0, end: 0, action: "Correct only the left wrist grip and remove the folded chair." }],
    mustPreserve: ["Exact V002 outside the chair and contact region, gate, feet, camera and pose"],
    mustAvoid: ["no new objects"],
    visualStyle: ["Flat hand-drawn cel fills."],
    identityCanon: [],
    driftRestatements: [],
    promptEntities: [],
    ...overrides,
  });
}
function capabilityFor(mode) {
  return resolveImageFalCapability(mode, Pack.capabilityLayer(mode, "api"));
}
function planFor(mode, references, spec = editSpec()) {
  return Compiler.compileValidatedGenerationPlan({
    mode, modelId: MODEL_ID, surface: "api", spec, references,
    capability: capabilityFor(mode),
    target: { kind: "shot-frame", shotId: "TLS-005", purpose: "frame" },
    outputType: "image",
  });
}
/* The legend in a compiled prompt names `#imageN — <label>`; this asserts that every
   image input the provider will receive at index N-1 is the one the prompt calls #imageN. */
function assertNumbersAgree(prompt, bindings, references) {
  const byRef = new Map(references.map((row) => [row.refId, row]));
  const images = bindings.filter((row) => row.field === "image_urls");
  assert(images.length, "no image bindings to compare");
  for (const row of images) {
    const label = byRef.get(row.refId).production.label;
    assert.match(prompt, new RegExp(`#image${row.index + 1} — ${escapeRe(label)}`),
      `the prompt must call ${label} #image${row.index + 1}, the slot the request carries it in`);
  }
}

/* ===========================================================================
   1. THE PROMPT ENGINE — the compile route that writes the durable package. */
{
  const profile = PromptEngine.getProfile("gpt-image-2/edit");
  assert(profile, "the gpt-image-2/edit profile must exist");

  const edit = PromptEngine.compile(profile, editSpec(), [V002, CHAIR, GUIDE]);
  assert.deepStrictEqual(edit.references.map((row) => row.key), ["EXACT_V002", "APPROVED_CHAIR", "LEFT_GRIP_GUIDE"],
    "an explicitly selected edit base stays Image 1 and the rest keep their selected order");
  assert.strictEqual(edit.operation, "edit-frame", "a package with an edit base IS the edit-frame operation");
  assert.doesNotMatch(edit.prompt, /EDIT THE BLOCKING GUIDE/, "an edit of an approved frame is never compiled as an edit of its guide");
  assert.match(edit.prompt, /#image1 — BASE: Exact V002 edit base/, "the legend numbers the base #image1");
  assert.match(edit.prompt, /BASE IMAGE\nEdit #image1\./, "the edit instruction names the base's token");
  assert.match(edit.prompt, /PLACEMENT GUIDE\n#image3 \(Unapproved left-grip placement guide\) is a placement or gesture guide for the requested change only\. #image1 remains the frame being edited/,
    "the guide keeps a separate, supporting role and says which image is the canvas");
  assert.doesNotMatch(edit.prompt, /authoritative base canvas/, "with a base present the guide is never called the base canvas");
  assert.doesNotMatch(edit.prompt, /Location design authority for Exact V002/, "the frame being edited is not recast as a location swatch for its guide");
  assert.match(edit.prompt, /#image1 — BASE: Exact V002 edit base; The exact frame being edited and the canvas for the whole output/);
  /* The guide's OWN legend line agrees with its supporting role: beside an edit base it
     is never told it owns the canvas, the crop or the camera. */
  assert.match(edit.prompt, /#image3 — COMPOSITION: Unapproved left-grip placement guide; Placement and gesture guide for the requested change only\./);
  assert.doesNotMatch(edit.prompt, /Use for canvas, crop, camera/, "an edit never hands the canvas to its guide");
  assert.doesNotMatch(edit.prompt, /where the composition guide specifies/, "an appearance reference is applied to the changed element, not placed on a scaffold");
  assert.match(edit.prompt, /#image2 — PROP: Approved standalone chair; Appearance only for Approved standalone chair: .*apply it only to the element the brief changes, in the frame being edited\./);
  edit.references.forEach((ref, index) =>
    assert.match(edit.prompt, new RegExp(`#image${index + 1} — ${ref.role.toUpperCase()}: ${escapeRe(ref.label)}`),
      "the legend is written from the same ordered list the package stores"));
  note("prompt engine: base + prop + guide compiles as an edit of #image1 with the guide demoted to PLACEMENT GUIDE");

  /* Arrival order is not the contract; the base leads however the selection arrived,
     and everything else keeps the order it was selected in. */
  const arrivedGuideFirst = PromptEngine.compile(profile, editSpec(), [GUIDE, CHAIR, V002]);
  assert.deepStrictEqual(arrivedGuideFirst.references.map((row) => row.key), ["EXACT_V002", "LEFT_GRIP_GUIDE", "APPROVED_CHAIR"]);
  assert.match(arrivedGuideFirst.prompt, /#image1 — BASE: Exact V002 edit base/);
  assert.match(arrivedGuideFirst.prompt, /PLACEMENT GUIDE\n#image2 \(Unapproved left-grip placement guide\)/,
    "the guide's number follows its place in the stored list, not a fixed slot");

  /* The OTHER operation survives intact: a guide with no base is the scaffold. */
  const guideOnly = PromptEngine.compile(profile, editSpec(), [GUIDE, CHAIR]);
  assert.strictEqual(guideOnly.operation, "guide-to-frame");
  assert.match(guideOnly.prompt, /^EDIT THE BLOCKING GUIDE — shot TLS-005/, "turning a guide into a frame still compiles the guide-scaffold prompt");
  assert.strictEqual(guideOnly.references[0].key, "LEFT_GRIP_GUIDE", "with no base the guide leads");
  assert.match(guideOnly.prompt, /#image1 — COMPOSITION: Unapproved left-grip placement guide; Blocking\/animatic geometry only\. Use for canvas, crop, camera/,
    "and there the guide does own the canvas: the two operations word the same reference differently");
  assert.match(guideOnly.prompt, /place it only where the composition guide specifies/);
  note("prompt engine: guide + prop with no base is still the guide-to-frame operation, unchanged");

  const baseOnly = PromptEngine.compile(profile, editSpec(), [V002]);
  assert.strictEqual(baseOnly.operation, "edit-frame");
  assert.doesNotMatch(baseOnly.prompt, /PLACEMENT GUIDE/, "no guide, no guide block");
  assert.strictEqual(PromptEngine.compile(profile, editSpec(), [CHAIR]).operation, "create-frame");
  assert.strictEqual(PromptEngine.compile(profile, editSpec(), []).operation, "text-to-image");
  assert.strictEqual(PromptEngine.imageOperation({ purpose: "blocking" }, []), "blocking-frame");
  /* A blocking-frame reference that a client marks `blocking: true` under role `base`
     is a guide by another name, never an edit base. */
  assert.strictEqual(PromptEngine.imageOperation(editSpec(), [{ ...V002, blocking: true }]), "create-frame");
}

/* ===========================================================================
   2. THE PLANNER — one canonical order, and the base leads it. */
{
  const planned = Compiler.planReferences(editSpec(), [CHAIR, GUIDE, V002, MASK]);
  assert.deepStrictEqual(planned.map((row) => `${row.order}:${row.refId}`),
    ["0:EXACT_V002", "1:APPROVED_CHAIR", "2:LEFT_GRIP_GUIDE", "3:GRIP_MASK"],
    "the edit base is order 0 whatever position it was selected in; the guide stays a supporting influence; the mask trails");
  const withFirstFrame = Compiler.planReferences(editSpec(), [V002, FIRST]);
  assert.deepStrictEqual(withFirstFrame.map((row) => row.refId), ["KF_A", "EXACT_V002"],
    "a temporal endpoint still leads the base: the motion contract is untouched");
  assert(Compiler.ROLE_PRIORITY.indexOf("base") < Compiler.ROLE_PRIORITY.indexOf("identity"));
  assert(Compiler.ROLE_PRIORITY.indexOf("base") < Compiler.ROLE_PRIORITY.indexOf("composition"));
  assert(Compiler.ROLE_PRIORITY.indexOf("last-frame") < Compiler.ROLE_PRIORITY.indexOf("base"));
  note("planner: base sorts first among image inputs and after temporal endpoints");
}

/* ===========================================================================
   3. THE PACK — the legend, the purpose line and the bindings count image inputs only. */
let inpaintPlan;
{
  const { plan, validation } = planFor("inpaint", [CHAIR, GUIDE, V002, MASK]);
  assert(validation.ok, `the inpaint plan must satisfy the contract — ${JSON.stringify(validation.errors)}`);
  inpaintPlan = plan;
  assert.strictEqual(plan.inputs.references[0].role, "base");
  assert.match(plan.inputs.prompt, /Edit #image1 \(Exact V002 edit base\)\. Change only what this brief asks for, inside the masked region; everything else in Exact V002 edit base stays exactly as it is\./,
    "the purpose line names the base by its request number");
  assert.match(plan.inputs.prompt, /#image3 \(Unapproved left-grip placement guide\) is a placement guide for that change only/,
    "the guide is named as a placement guide, not as the frame being edited");
  assert.match(plan.inputs.prompt, /#image1 — Exact V002 edit base:/);
  assert.match(plan.inputs.prompt, /#image2 — Approved standalone chair:/);
  assert.match(plan.inputs.prompt, /#image3 — Unapproved left-grip placement guide:/);
  assert.match(plan.inputs.prompt, /MASK — Left-grip edit mask: .*It applies to #image1 \(Exact V002 edit base\) and is not an image input\./,
    "the mask is described as applying to Image 1 and is not numbered as an image");
  assert.doesNotMatch(plan.inputs.prompt, /#image4/, "a mask is not an image input and gets no image number");
  assert.doesNotMatch(plan.inputs.prompt, /\.\.(?!\.)/, "a purpose that ends its own sentence is not given a second full stop");
  const bindings = plan.settings.extensions[MODEL_ID].referenceBindings;
  assert.deepStrictEqual(bindings, { EXACT_V002: "image[0]", APPROVED_CHAIR: "image[1]", LEFT_GRIP_GUIDE: "image[2]", GRIP_MASK: "mask->image[0]" },
    "image indices count image inputs only, and the mask binding names the image it applies to");
  assert(!plan.warnings.some((row) => /base-not-first|mask-without-base/.test(row.code)), "a well-formed edit raises neither base warning");
  note("pack: inpaint legend numbers three image inputs, describes the mask against #image1, and binds mask->image[0]");

  /* The pack's own witnesses, exercised by handing it a manifest the planner did not
     order. Nothing in the live path produces one; this proves the pack would say so. */
  const cap = capabilityFor("edit");
  const intent = Compiler.inventoryIntent(editSpec(), (value) => value);
  const manifest = Compiler.planReferences(editSpec(), [V002, CHAIR]);
  const reversed = [manifest[1], manifest[0]].map((row, index) => ({ ...row, order: index }));
  const coverage = Compiler.createCoverage();
  Pack.compileMode({ mode: "edit", modelId: MODEL_ID, surface: "api", spec: editSpec(), intent, manifest: reversed, capability: cap, coverage, aspectRatio: "16:9" });
  const notFirst = coverage.warningsArray().find((row) => row.code === "base-not-first");
  assert(notFirst, "a manifest whose base is not the first image input is warned about by name");
  assert.match(notFirst.message, /Exact V002 edit base is the frame being edited but would be sent as #image2, not #image1/);

  const orphanCoverage = Compiler.createCoverage();
  const orphan = Compiler.planReferences(editSpec(), [CHAIR, MASK]);
  Pack.compileMode({ mode: "inpaint", modelId: MODEL_ID, surface: "api", spec: editSpec(), intent, manifest: orphan, capability: capabilityFor("inpaint"), coverage: orphanCoverage, aspectRatio: "16:9" });
  assert(orphanCoverage.warningsArray().some((row) => row.code === "mask-without-base"), "a mask with no base to apply to is warned about by name");
  note("pack: base-not-first and mask-without-base are named warnings, not silent renumbering");
}

/* ===========================================================================
   4. THE SERIALIZER — image_urls[0] is the base, mask_url binds to it, or nothing is sent. */
{
  const cap = capabilityFor("inpaint");
  const serialized = serializeImagePlanForFal(inpaintPlan, cap, {
    resolveReference: (row) => `bytes:${row.refId}`, config: { editModel: "openai/gpt-image-2/edit" },
  });
  assert.deepStrictEqual(serialized.input.image_urls, ["bytes:EXACT_V002", "bytes:APPROVED_CHAIR", "bytes:LEFT_GRIP_GUIDE"],
    "the frame being edited is image_urls[0]");
  assert.strictEqual(serialized.input.mask_url, "bytes:GRIP_MASK");
  const maskBinding = serialized.bindings.find((row) => row.field === "mask_url");
  assert.strictEqual(maskBinding.appliesTo, "EXACT_V002", "the mask binding records the base it applies to");
  assert.strictEqual(maskBinding.appliesToIndex, 0);
  assert.strictEqual(maskBinding.index, null, "a mask occupies no image slot");
  assertNumbersAgree(inpaintPlan.inputs.prompt, serialized.bindings, inpaintPlan.inputs.references);
  note("serializer: image_urls[0] is the base, mask_url is recorded as applying to it, and every #imageN in the prompt is image_urls[N-1]");

  /* REORDERED INPUTS. A plan whose base is not first did not come from the planner;
     it is refused before anything is spent, in both modes. */
  const tampered = JSON.parse(JSON.stringify(inpaintPlan));
  for (const row of tampered.inputs.references) if (row.role === "base") row.order = 99;
  assert.throws(
    () => serializeImagePlanForFal(tampered, cap, { resolveReference: (row) => row.refId, config: {} }),
    (error) => error instanceof FalImageBackendError && error.code === "IMAGE_BASE_NOT_FIRST" && /would be sent as Image 3/.test(error.message) && /Nothing was sent/.test(error.message),
    "an inpaint plan with its base displaced is refused by name",
  );
  const { plan: editPlan } = planFor("edit", [CHAIR, V002]);
  const displaced = JSON.parse(JSON.stringify(editPlan));
  for (const row of displaced.inputs.references) if (row.role === "base") row.order = 99;
  assert.throws(
    () => serializeImagePlanForFal(displaced, capabilityFor("edit"), { resolveReference: (row) => row.refId, config: {} }),
    (error) => error instanceof FalImageBackendError && error.code === "IMAGE_BASE_NOT_FIRST",
    "an edit plan with its base displaced is refused by name",
  );
  /* A mask beside no base at all: the pack warned, and the serializer refuses to send a
     mask that would apply to a reference that is not the frame being edited. */
  const { plan: orphanPlan } = planFor("inpaint", [CHAIR, MASK]);
  assert.throws(
    () => serializeImagePlanForFal(orphanPlan, cap, { resolveReference: (row) => row.refId, config: {} }),
    (error) => error instanceof FalImageBackendError && error.code === "IMAGE_MASK_UNBOUND" && /Approved standalone chair \(prop\)/.test(error.message),
    "a mask whose Image 1 is not the base is refused by name",
  );
  note("serializer: IMAGE_BASE_NOT_FIRST and IMAGE_MASK_UNBOUND refuse a reordered or unbound request before the POST");
}

/* ===========================================================================
   5. EXECUTION — mode and operation from the package; an old package still binds right. */
{
  assert.throws(() => resolveImageMode("frame", [{ role: "mask" }, { role: "prop" }]),
    (error) => error instanceof ImageExecutionError && error.code === "IMAGE_MASK_WITHOUT_BASE",
    "a mask with no base is refused before a plan exists");
  assert.strictEqual(resolveImageMode("frame", [{ role: "base" }, { role: "mask" }]), "inpaint");
  assert.strictEqual(resolveImageMode("frame", [{ role: "base" }, { role: "composition" }]), "edit");
  assert.strictEqual(resolveImageMode("frame", [{ role: "composition" }, { role: "prop" }]), "multi-reference",
    "a guide with no base is a reference-guided frame at dispatch, not an edit");
  assert.strictEqual(resolveImageOperation("frame", [{ role: "base" }, { role: "composition" }]), "edit-frame");
  assert.strictEqual(resolveImageOperation("frame", [{ role: "composition" }, { role: "prop" }]), "guide-to-frame");
  assert.strictEqual(resolveImageOperation("frame", [{ role: "prop" }]), "create-frame");
  assert.strictEqual(resolveImageOperation("frame", []), "text-to-image");
  assert.strictEqual(resolveImageOperation("blocking", []), "blocking-frame");
  note("execution: edit-frame and guide-to-frame are distinct operations and a mask needs its base");

  /* A DURABLE PACKAGE WRITTEN IN THE OLD ORDER. Every frame package the old compiler
     stored carries the guide first — TLS-005's do. Dispatch does not trust that array:
     the base is Image 1 and the plan the preview shows is the plan that is sent. */
  const project = {
    meta: { title: "Edit base study", aspectRatio: "16:9" },
    shots: [{ id: "TLS-005", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
  const oldOrder = [GUIDE, V002, CHAIR].map((row) => buildRef(row, row.url));
  const buildId = addFramePromptBuild(project, "TLS-005", { profileId: "gpt-image-2/edit", mode: "edit", references: oldOrder, spec: editSpec() });
  const compiled = compileImageExecutionPlan({ project, purpose: "frame", shotId: "TLS-005", buildId, surface: "api" });
  assert.strictEqual(compiled.mode, "edit");
  assert.strictEqual(compiled.operation, "edit-frame");
  assert.deepStrictEqual(compiled.plan.inputs.references.map((row) => row.refId), ["EXACT_V002", "APPROVED_CHAIR", "LEFT_GRIP_GUIDE"]);
  const dispatched = serializeImagePlanForFal(compiled.plan, compiled.capability, { resolveReference: (row) => row.refId, config: {} });
  assert.deepStrictEqual(dispatched.input.image_urls, ["EXACT_V002", "APPROVED_CHAIR", "LEFT_GRIP_GUIDE"]);
  assertNumbersAgree(compiled.compiledPrompt, dispatched.bindings, compiled.plan.inputs.references);
  const again = compileImageExecutionPlan({ project, purpose: "frame", shotId: "TLS-005", buildId, surface: "api" });
  assert.deepStrictEqual(again.plan, compiled.plan, "the preview and the submission compile the same plan");
  note("execution: a package stored guide-first by the old compiler still dispatches the base as image_urls[0]");

  /* STALE INPUTS. The server-side freshness comparator already refuses a package whose
     approved frame changed after it was built; this pins that an edit package with a
     recorded dependency snapshot is reported stale when the frame it edits is replaced. */
  /* `shot.frames` is the projection the comparator reads (the server's view of the
     shot's frames, each carrying its approved `winner`). */
  const shot = { id: "TLS-005", frames: [{ id: "FR-A", label: "A", winner: "V003.png", description: "Rex at the threshold." }] };
  const stalePack = { frameId: "FR-A", scope: "frame:FR-A", dependencySnapshot: { frameWinner: "V002.png" } };
  const freshness = BuildHistory.packageProjectFreshness({ mediaAssets: [] }, shot, stalePack);
  assert.strictEqual(freshness.recorded, true);
  assert.strictEqual(freshness.current, false, "a package built against V002 is stale once V003 is the approved frame");
  assert(freshness.reasons.includes("approved frame changed"), `the reason names the frame: ${freshness.reasons.join("; ")}`);
  const current = BuildHistory.packageProjectFreshness({ mediaAssets: [] }, { ...shot, frames: [{ ...shot.frames[0], winner: "V002.png" }] }, stalePack);
  assert.strictEqual(current.current, true);
  note("stale inputs: a package whose edit base was replaced is reported stale by the server-side comparator");
}

/* ===========================================================================
   6. NEGATIVE CONTROLS — each half of the defect reintroduced in memory and caught.
   Files are restored from the exact bytes read here, never from git. */
function withMutation(file, mutate, run) {
  const original = fs.readFileSync(file);
  const source = original.toString("utf8");
  const mutated = mutate(source);
  assert.notStrictEqual(mutated, source, `negative control anchor not found in ${path.basename(file)}`);
  const fresh = (target) => { delete require.cache[require.resolve(target)]; return require(target); };
  try {
    fs.writeFileSync(file, mutated);
    run(fresh);
  } finally {
    fs.writeFileSync(file, original);
    for (const target of ["../src/generation/prompt-engine", "../src/generation/generation-compiler", "../src/generation/fal/fal-image-backend"])
      delete require.cache[require.resolve(target)];
  }
  assert(fs.readFileSync(file).equals(original), `${path.basename(file)} must be restored byte for byte`);
}
const caught = (fn) => { try { fn(); return false; } catch (error) { return error instanceof assert.AssertionError; } };
{
  /* NC1: the planner sorts the base back behind identity, place, prop and the guide. */
  withMutation(COMPILER_FILE,
    (src) => src.replace(/  "base",\r?\n  "identity", "expression"/, '  "identity", "expression"').replace(/"composition", "reference", "reference-sheet"/, '"composition", "base", "reference", "reference-sheet"'),
    (fresh) => {
      const Broken = fresh("../src/generation/generation-compiler");
      const planned = Broken.planReferences(editSpec(), [CHAIR, GUIDE, V002, MASK]);
      assert(caught(() => assert.strictEqual(planned[0].refId, "EXACT_V002")), "NC1: the planner order assertion must fail when base sorts late");
      assert.strictEqual(planned.map((row) => row.refId).indexOf("EXACT_V002"), 2, "NC1 reproduces the audited order: prop, guide, base");
    });
  note("negative control 1: the old planner order (prop, guide, base) is caught");

  /* NC2: the prompt engine takes the guide branch whenever a guide is present. */
  withMutation(PROMPT_ENGINE_FILE,
    (src) => src.replace(/const guideBased = explicitEditBase\(refs\) \? "" : compileGuideBasedImage\(profile, spec, refs\);/, "const guideBased = compileGuideBasedImage(profile, spec, refs);"),
    (fresh) => {
      const Broken = fresh("../src/generation/prompt-engine");
      const result = Broken.compile(Broken.getProfile("gpt-image-2/edit"), editSpec(), [V002, CHAIR, GUIDE]);
      assert(caught(() => assert.doesNotMatch(result.prompt, /EDIT THE BLOCKING GUIDE/)), "NC2: the guide-branch assertion must fail");
      assert.match(result.prompt, /^EDIT THE BLOCKING GUIDE/, "NC2 reproduces the audited prompt opening");
    });
  note("negative control 2: an edit compiled as EDIT THE BLOCKING GUIDE is caught");

  /* NC3: the prompt engine moves the guide to Image 1 again. */
  withMutation(PROMPT_ENGINE_FILE,
    (src) => src.replace(/if \(editBase\) return \[editBase, \.\.\.mapped\.filter\(\(ref\) => ref !== editBase\)\];/, ""),
    (fresh) => {
      const Broken = fresh("../src/generation/prompt-engine");
      const result = Broken.compile(Broken.getProfile("gpt-image-2/edit"), editSpec(), [V002, CHAIR, GUIDE]);
      assert(caught(() => assert.strictEqual(result.references[0].key, "EXACT_V002")), "NC3: the base-first assertion must fail");
      assert.strictEqual(result.references[0].key, "LEFT_GRIP_GUIDE", "NC3 reproduces the audited order: guide, base, prop");
    });
  note("negative control 3: the guide promoted to Image 1 is caught");

  /* NC4: the serializer stops refusing a mask whose Image 1 is not the base. */
  withMutation(BACKEND_FILE,
    (src) => src.replace(/if \(!first \|\| String\(first\.role\) !== "base"\)/, "if (false)"),
    (fresh) => {
      const Broken = fresh("../src/generation/fal/fal-image-backend");
      const { plan: orphanPlan } = planFor("inpaint", [CHAIR, MASK]);
      let refused = null;
      try { Broken.serializeImagePlanForFal(orphanPlan, capabilityFor("inpaint"), { resolveReference: (row) => row.refId, config: {} }); } catch (error) { refused = error; }
      assert.strictEqual(refused, null, "NC4: without the guard the unbound mask is sent");
      assert(caught(() => assert.throws(() => Broken.serializeImagePlanForFal(orphanPlan, capabilityFor("inpaint"), { resolveReference: (row) => row.refId, config: {} }))),
        "NC4: the IMAGE_MASK_UNBOUND assertion must fail without the guard");
    });
  note("negative control 4: a mask sent against a non-base Image 1 is caught");

  /* NC5: the serializer stops refusing a displaced base. */
  withMutation(BACKEND_FILE,
    (src) => src.replace(/if \(\(mode === "edit" \|\| mode === "inpaint"\) && base && images\[0\] !== base\)/, "if (false)"),
    (fresh) => {
      const Broken = fresh("../src/generation/fal/fal-image-backend");
      const { plan: editPlan } = planFor("edit", [CHAIR, V002]);
      const displaced = JSON.parse(JSON.stringify(editPlan));
      for (const row of displaced.inputs.references) if (row.role === "base") row.order = 99;
      const sent = Broken.serializeImagePlanForFal(displaced, capabilityFor("edit"), { resolveReference: (row) => row.refId, config: {} });
      assert.deepStrictEqual(sent.input.image_urls, ["APPROVED_CHAIR", "EXACT_V002"], "NC5: without the guard the chair is edited");
    });
  note("negative control 5: a displaced base reaching image_urls is caught");
}

/* The guards are back in place after the controls — checked by their own symbols. */
assert.match(fs.readFileSync(COMPILER_FILE, "utf8"), /"waypoint",\s*(?:\/\*[\s\S]*?\*\/\s*)?"base",/, "ROLE_PRIORITY must lead with base after the temporal roles");
assert.match(fs.readFileSync(PROMPT_ENGINE_FILE, "utf8"), /explicitEditBase\(refs\) \? "" : compileGuideBasedImage/);
assert.match(fs.readFileSync(BACKEND_FILE, "utf8"), /IMAGE_MASK_UNBOUND/);
assert.match(fs.readFileSync(BACKEND_FILE, "utf8"), /IMAGE_BASE_NOT_FIRST/);

console.log("Edit base binding suite passed:");
for (const line of notes) console.log(`  - ${line}`);
console.log("  Provider calls made: 0. Files mutated for negative controls were restored byte for byte.");

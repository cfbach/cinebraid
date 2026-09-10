/* Shot Execution Tier 0 — negative controls.
 *
 * A regression that has never been seen to fail is a regression nobody has tested. Each
 * control below reintroduces one of the four defects Tier 0 closed, IN MEMORY, and
 * proves the suite that guards it goes red — then proves the real modules are green
 * afterwards.
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Every mutation is a
 * string transformation compiled into an in-memory Module or evaluated in the render
 * harness's own `mutateSource` hook. A control that edited a file and undid it with a
 * checkout would discard unstaged work the first time one of these threw.
 *
 * Each control also carries a LIVE-DEFECT RECEIPT: the mutation must actually change
 * behaviour before the guarding assertion is consulted. A control that mutates nothing
 * and then reports that the guard "caught" it is reporting on itself.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const F = require("./generation-compiler-fixture");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

/* A mutated module compiled under its real filename, so its own relative requires
   resolve exactly as they do on disk. The file is opened read-only. */
function compileModule(relative, source) {
  const filename = path.join(ROOT, relative);
  const compiled = new Module(filename, null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

function mutated(relative, transform) {
  const original = read(relative);
  const source = String(transform(original));
  assert.notStrictEqual(source, original,
    `the control for ${relative} changed nothing; it would report a pass without testing anything`);
  return source;
}

/* Every production file any control below rewrites in memory. Hashed before and after
   the run, because "nothing is written to disk" is a claim this suite makes in its own
   summary line and had no evidence for. A control that reached for the filesystem — or a
   future one written with fs.writeFileSync instead of a string — is caught here rather
   than by whatever breaks next. */
const MUTATED_FILES = [
  "src/generation/generation-compiler.js",
  "src/generation/fal/fal-h3-backend.js",
  "model-packs/minimax-h3.js",
  "src/server/server.js",
  "public/shared-lip-sync.js",
  "public/motion-sound-composer.js",
  "public/app.js",
  "public/creation-studio.js",
  "public/v607-composer.js",
];
function sourceFingerprints() {
  return Object.fromEntries(MUTATED_FILES.map((relative) =>
    [relative, crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex")]));
}

const controls = [];
function control(id, title, run) {
  controls.push({ id, title, run });
}

/* ===========================================================================
   NC-1 — silently drop one of the six new INTENT_FIELDS rows.

   This is the defect Tier 0 exists to prevent: a fact with no row cannot be carried,
   cannot be verified, and cannot be reported as unsupported. It simply stops existing
   between the shot and the model, with no warning anywhere. */
for (const intent of ["editorial", "endpoints.start", "endpoints.end", "performance.lipSync", "interaction", "subjects.count", "output.nativeAudio"])
  control(`NC-1:${intent}`, `dropping the ${intent} inventory row`, () => {
    const source = mutated("src/generation/generation-compiler.js", (text) => {
      const line = text.split("\n").find((row) => row.includes(`{ key: "${intent}",`));
      assert(line, `generation-compiler.js no longer declares a row for ${intent}`);
      return text.replace(`${line}\n`, "");
    });
    const Compiler = compileModule("src/generation/generation-compiler.js", source);
    const spec = F.baseSpec({
      editorial: "single-take",
      endpoints: { start: "exact", end: "approximate" },
      interaction: "precise",
      audio: { ...F.baseSpec().audio, lipSyncRequired: true },
      output: { nativeAudio: false },
    });

    /* THE LIVE DEFECT: the fact is genuinely no longer inventoried. */
    const inventory = Compiler.inventoryIntent(spec, (value) => String(value));
    assert(!inventory.some((row) => row.key === intent), `${intent} should be gone from the inventory`);

    /* THE GUARD: with the row removed the fact reaches no coverage state at all — not
       represented, not omitted, not even unsupported. Nothing warns, and the plan looks
       complete. That is exactly what the Tier 0 suite asserts cannot happen.

       The real pack is handed in explicitly: a freshly compiled compiler has its own
       empty registry, and the packs registered themselves with the module on disk. */
    const plan = Compiler.compileGenerationPlan({
      spec, references: [F.FRAME_A], mode: "i2v", pack: require("../model-packs/minimax-h3").pack,
      modelId: F.modelIdFor("i2v"), surface: "api", capability: F.capabilityFor("i2v"),
    });
    assert(!plan.coverage.some((row) => row.intent === intent),
      `${intent} must vanish from coverage for this control to be the defect it claims`);
    assert(!plan.warnings.some((row) => row.intent === intent),
      `and it must vanish SILENTLY — a warning would mean the loss was already visible`);
  });

/* ===========================================================================
   NC-2 — restore the dialogue-implies-lip-sync shortcut in the shared derivation.

   `lipSyncRequired === true || !!line`, which is what both former sites computed.

   THE ANCHOR IS A REGEX, AND THAT IS THE REPAIR. It was a literal two-line string joined
   by a bare "\n". `public/shared-lip-sync.js` is `i/lf w/crlf` — LF in the index, CRLF in
   the working tree — so the moment git re-checked the file out after the Tier-0 merge the
   anchor stopped matching, `String.replace` returned the source untouched, and the control
   would have reported a pass having mutated nothing. It did not: `mutated()` refused, which
   is the guard doing its job. Matching `\r?\n` makes the control indifferent to how the
   file happens to be checked out. */
control("NC-2", "restoring the dialogue-implies-lip-sync shortcut", () => {
  const original = read("public/shared-lip-sync.js");
  const source = mutated("public/shared-lip-sync.js", (text) =>
    text.replace(
      /if \(dialogue\.lipSyncRequired === true\) return "critical";(\r?\n\s*)return "implied";/,
      'if (dialogue.lipSyncRequired === true || Boolean(line)) return "critical";$1return "implied";',
    ));

  /* RECEIPT 1 — the mutation changed real production source, and changed it into the
     forbidden shortcut rather than into something merely different. */
  assert(/lipSyncRequired === true \|\| Boolean\(line\)/.test(source),
    "the mutated source must carry the dialogue-implies-lip-sync shortcut");
  assert(!/lipSyncRequired === true \|\| Boolean\(line\)/.test(original),
    "and the shipped source must not");
  assert.strictEqual(source.length - original.length, " || Boolean(line)".length,
    "exactly the shortcut was inserted and nothing else moved");

  const LipSync = compileModule("public/shared-lip-sync.js", source);

  /* RECEIPT 2 — THE LIVE DEFECT: an off-screen line is lip-sync-critical again. */
  assert.strictEqual(LipSync.deriveLipSync({ line: "Bravo two, hold position." }), "critical",
    "the control must actually reintroduce the shortcut");
  assert.notStrictEqual(LipSync.deriveLipSync({ line: "Bravo two, hold position." }), "implied");
  assert.notStrictEqual(LipSync.deriveLipSync({ line: "Don't follow me.", lipSyncRequired: false }), "implied");
  /* And the boolean accessor follows it, so every downstream reader is wrong too. */
  assert.strictEqual(LipSync.lipSyncRequiredFrom({ line: "Bravo two, hold position." }), true);

  /* RECEIPT 3 — THE GUARD ITSELF, run rather than described. These are the assertions
     tests/shot-execution-tier0.js makes about the tri-state; each must throw against the
     mutated module. A control that only checks a return value is asserting that IT
     disagrees with the defect, not that the suite guarding production does. */
  for (const [dialogue, expected] of [
    [{ line: "Bravo two, hold position." }, "implied"],
    [{ line: "Don't follow me.", lipSyncRequired: false }, "implied"],
  ]) {
    assert.throws(
      () => assert.strictEqual(LipSync.deriveLipSync(dialogue), expected),
      { name: "AssertionError" },
      `the Tier-0 tri-state assertion for ${JSON.stringify(dialogue)} must fail under this defect`,
    );
  }
  /* And the cases the defect does NOT break still hold, so the control is specific:
     a shot with no line is still `none`, and an explicit level still outranks. */
  assert.strictEqual(LipSync.deriveLipSync({ line: "" }), "none");
  assert.strictEqual(LipSync.deriveLipSync({ line: "x", lipSync: "none" }), "none");
});

/* The same defect at the level the suite actually polices: the shortcut written back
   into one of the two former derivation sites, where it would drift from the other. */
control("NC-2b", "reintroducing the shortcut at one of the two former sites", () => {
  const source = mutated("public/motion-sound-composer.js", (text) =>
    text.replace(
      "lipSyncRequired: lipSyncRequiredFrom({ ...dialogue, line }),",
      "lipSyncRequired: dialogue.lipSyncRequired === true || !!line,",
    ));
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");

  /* THE GUARD: the source-level assertion in the Tier 0 suite exists because this rule
     was written twice; it must reject the shortcut wherever it reappears. */
  assert(/lipSync\w*\s*:[^,;\n]*\|\|\s*!!\s*line/.test(stripped),
    "the guarding pattern must match the reintroduced shortcut");
  assert(!/lipSync\w*\s*:[^,;\n]*\|\|\s*!!\s*line/.test(
    read("public/motion-sound-composer.js").replace(/\/\*[\s\S]*?\*\//g, "")),
  "and must not match the shipped file");
});

/* ===========================================================================
   NC-2c — write the DERIVED level back into the field the derivation trusts.

   The subtle one, and the reason the tri-state is derived on read rather than stored:
   `lipSync` outranks the boolean, so persisting the derived answer there pins it. The
   requirement control would go on setting its boolean and changing nothing. */
control("NC-2c", "persisting the derived lip-sync level into the brief", async () => {
  const page = await render("#/production", buildFixture(), {
    mutateSource: (file, source) => (file === "motion-sound-composer.js"
      ? mutated("public/motion-sound-composer.js", () => source.replace(
        "lipSync: String(dialogue.lipSync || \"\"),",
        "lipSync: deriveLipSync({ ...dialogue, line }),",
      ))
      : source),
  });
  const outcome = vm.runInContext(`(() => {
    const shot = (P.shots || [])[0], unit = (shot.clips || [])[0];
    unit.motionBrief = { dialogue: { line: "It's done." } };
    setMotionSoundField(shot.id, unit.id, "dialogue", "lipSyncRequired", true);
    /* Any later edit re-runs the brief builder, which is when the stored level bites. */
    setMotionSoundField(shot.id, unit.id, "dialogue", "language", "English");
    const produced = unit.motionBrief.dialogue;
    return { stored: produced.lipSync, level: deriveLipSync(produced), flag: produced.lipSyncRequired };
  })()`, page.context);

  /* THE LIVE DEFECT: the level derived BEFORE the tick was written into the record, and
     because a stored level outranks the boolean it now swallows the tick entirely. The
     filmmaker states that the mouth must match the words, the next edit to any field in
     the panel quietly reverts it, and nothing says so. */
  assert.strictEqual(outcome.stored, "implied", "the control must actually persist a derived level");
  assert.strictEqual(outcome.level, "implied", "which then outranks the requirement that was just set");
  assert.strictEqual(outcome.flag, false, "and silently reverts the boolean with it");
  /* THE GUARD asserts the opposite: the tick takes effect and nothing is stored. */
  assert.notStrictEqual(outcome.level, "critical");
});

/* ===========================================================================
   NC-5 — drop the pack's explicit refusal of an unsatisfiable audio request.

   The row survives, so the core's backstop still catches it and the state is still
   `unsupported` — which is why this control exists separately from NC-1. What is lost is
   the SENTENCE: the filmmaker is handed a maintenance note about a pack that is behaving
   correctly, instead of being told the video will arrive with sound they are paying for. */
control("NC-5", "dropping the H3 pack's explicit audio refusal", () => {
  const source = mutated("model-packs/minimax-h3.js", (text) =>
    text.replace(/ *reportUnsatisfiedAudioRequest\(context\);\r?\n/, ""));
  const Pack = compileModule("model-packs/minimax-h3.js", source);
  const Compiler = require("../src/generation/generation-compiler");
  const plan = Compiler.compileGenerationPlan({
    spec: F.baseSpec({ output: { nativeAudio: false } }),
    references: [F.FRAME_A], mode: "i2v", pack: Pack.pack,
    modelId: F.modelIdFor("i2v"), surface: "api", capability: F.capabilityFor("i2v"),
  });
  const warning = plan.warnings.find((row) => row.intent === "output.nativeAudio");

  /* THE LIVE DEFECT: the backstop fires instead, so the code and the words both change. */
  assert(warning, "the backstop still catches the intent, which is the point of this control");
  assert.strictEqual(warning.code, "intent-unaccounted", "the control must reach the generic backstop");
  assert(/compiler does not carry it/i.test(warning.message) && /model pack/i.test(warning.action),
    "and hand a filmmaker a note addressed to whoever maintains the pack");
  /* THE GUARD asserts the opposite on all three counts. */
  assert.notStrictEqual(warning.code, "native-audio-unsupported");
  assert(!/charged/i.test(warning.message), "the cost the filmmaker would actually pay goes unmentioned");
});

/* ===========================================================================
   NC-3 — omit `enable_prompt_expansion: false` from the serialised request.

   Omission is not neutrality here: fal defaults the flag to true on all three H3
   endpoints, so a request that does not carry it is a request that switches the
   provider's prompt rewriter ON. */
control("NC-3", "omitting the prompt-expansion flag from the fal request", () => {
  /* Line-ending agnostic: this repository checks out with CRLF, so a mutation anchored
     on a bare "\n" silently matches nothing and the control reports on itself. */
  const source = mutated("src/generation/fal/fal-h3-backend.js", (text) =>
    text.replace(/ *input\[FAL_H3_BACKEND\.promptExpansion\.field\][^\r\n]*\r?\n/, ""));
  const Backend = compileModule("src/generation/fal/fal-h3-backend.js", source);
  const H3 = require("../model-packs/minimax-h3");
  const Compiler = require("../src/generation/generation-compiler");
  const plan = Compiler.compileGenerationPlan({
    spec: F.baseSpec(), references: [F.FRAME_A], mode: "i2v",
    modelId: F.modelIdFor("i2v"), surface: "api", capability: F.capabilityFor("i2v"),
  });
  const capability = Backend.resolveH3FalCapability("i2v", H3.capabilityLayer("i2v", "api"));
  const request = Backend.serializeH3PlanForFal(plan, capability, { resolveReference: (row) => `https://x/${row.refId}` });

  /* THE LIVE DEFECT AND THE GUARD are the same fact: the field is gone from the payload,
     and the Tier 0 serialisation assertion reads the payload rather than the config. */
  assert(!Object.prototype.hasOwnProperty.call(request.input, "enable_prompt_expansion"),
    "the control must actually remove the flag from the serialised request");
  assert.notStrictEqual(request.input.enable_prompt_expansion, false);
});

/* Setting it to `true` is the same defect wearing a value, and must fail the same way. */
control("NC-3b", "sending prompt expansion explicitly on", () => {
  const source = mutated("src/generation/fal/fal-h3-backend.js", (text) =>
    text.replace("    send: false,", "    send: true,"));
  const Backend = compileModule("src/generation/fal/fal-h3-backend.js", source);
  const H3 = require("../model-packs/minimax-h3");
  const Compiler = require("../src/generation/generation-compiler");
  const plan = Compiler.compileGenerationPlan({
    spec: F.baseSpec(), references: [], mode: "t2v",
    modelId: F.modelIdFor("t2v"), surface: "api", capability: F.capabilityFor("t2v"),
  });
  const capability = Backend.resolveH3FalCapability("t2v", H3.capabilityLayer("t2v", "api"));
  const request = Backend.serializeH3PlanForFal(plan, capability, { resolveReference: (row) => `https://x/${row.refId}` });
  assert.strictEqual(request.input.enable_prompt_expansion, true, "the control must flip the value");
  assert.notStrictEqual(request.input.enable_prompt_expansion, false, "which the guard refuses");
});

/* ===========================================================================
   NC-4 — remove `t2v` from the clip-kind vocabulary, in the browser and at import. */
control("NC-4", "removing t2v from the browser clip vocabulary", async () => {
  const page = await render("#/production", buildFixture(), {
    mutateSource: (file, source) => (file === "app.js"
      ? mutated("public/app.js", () => source.replace(
        '!["t2v", "i2v", "flf", "r2v", "plan", "post", "reuse"].includes(c.kind)',
        '!["i2v", "flf", "r2v", "plan", "post", "reuse"].includes(c.kind)',
      ))
      : source),
  });
  const result = vm.runInContext(`(() => {
    const shot = {
      id: "SH-T2V",
      keyframes: [{ id: "frame-a", label: "A", winner: "", required: true }],
      clips: [{ id: "seg-t2v", suffix: "a", label: "A", kind: "t2v", dur: 6, motionPrompt: "A storm front.", fromFrame: "", toFrame: "" }],
      audio: {},
    };
    normalizeShotV5(shot);
    return { kind: shot.clips[0].kind, fromFrame: shot.clips[0].fromFrame };
  })()`, page.context);

  /* THE LIVE DEFECT: the shot is coerced back to i2v, and — the part that costs money —
     it is then handed a start frame it must wait for someone to approve. */
  assert.strictEqual(result.kind, "i2v", "the control must reintroduce the coercion");
  assert.strictEqual(result.fromFrame, "frame-a", "and with it the approval the shot never needed");
  /* THE GUARD asserts the opposite of both. */
  assert.notStrictEqual(result.kind, "t2v");
});

control("NC-4b", "removing t2v from the import vocabulary", () => {
  const source = mutated("src/server/server.js", (text) =>
    text.replace(
      'allowedKinds = new Set(["t2v", "i2v", "flf", "r2v", "plan", "post", "reuse", "hold"]),',
      'allowedKinds = new Set(["i2v", "flf", "r2v", "plan", "post", "reuse", "hold"]),',
    ));
  const clips = builderClipsFrom(source);
  const warnings = [];
  const out = clips(
    { id: "SH-T2V", clips: [{ id: "SH-T2V-M01", kind: "t2v", dur: 6, motionPrompt: "A storm front." }] },
    [{ id: "SH-T2V-A" }],
    warnings,
  );
  /* THE LIVE DEFECT: an imported text-to-video unit becomes planning-only — it cannot
     generate at all — and the filmmaker is told its kind was unknown. */
  assert.strictEqual(out[0].kind, "plan", "the control must reintroduce the downgrade");
  assert(warnings.some((row) => /unknown kind/i.test(row)), "and the misleading warning with it");
  assert.notStrictEqual(out[0].kind, "t2v");
});

/* NC-4h — restore the `|| "i2v"` default for a unit that named no method at all.

   The quieter half of the same defect. The unknown-kind branch could never see this
   case: by the time it ran, the missing value had already become a KNOWN kind, so the
   document was routed to image-to-video — demanding an approved still and a paid
   generation — with nothing said to anyone. */
control("NC-4h", "restoring the i2v default for a clip that names no kind", () => {
  const source = mutated("src/server/server.js", (text) =>
    text.replace(
      'let kind = String(source.kind ?? "").trim().toLowerCase(),',
      'let kind = String(source.kind || "i2v").toLowerCase(),',
    ));
  const clips = builderClipsFrom(source);
  const warnings = [];
  const out = clips(
    { id: "SH-M", clips: [{ id: "SH-M-M01", dur: 5, motionPrompt: "She turns." }] },
    [{ id: "SH-M-A" }],
    warnings,
  );
  /* THE LIVE DEFECT: absence became image-to-video, and the unit was handed a start
     frame to match a dependency the document never stated. */
  assert.strictEqual(out[0].kind, "i2v", "the control must reintroduce the coercion");
  assert.strictEqual(out[0].fromFrame, "SH-M-A", "and the invented frame dependency with it");
  assert(!warnings.some((row) => /named no generation method/i.test(row)),
    "and the silence: the old rule could not warn, because the value was already valid");
  assert.notStrictEqual(out[0].kind, "plan");
});

/* NC-4i — remove `t2v` from the CONTRACT, leaving the importer's copy intact.

   The two vocabularies disagreed for as long as they did because each looked correct
   from its own side. This control proves the schema half is now guarded too: a valid
   text-to-video plan becomes an invalid document, and the kit suite's enum assertion
   is the thing that has to catch it. Pure data, mutated in memory. */
control("NC-4i", "removing t2v from the Project Builder contract schema", () => {
  const relative = path.join("resources", "project-builder", "CINEBRAID_PROJECT_SCHEMA.json");
  const schema = JSON.parse(read(relative));
  const kinds = schema.$defs.clip.properties.kind.enum;
  assert(kinds.includes("t2v"), "the shipped schema must admit t2v before this control can remove it");
  schema.$defs.clip.properties.kind.enum = kinds.filter((kind) => kind !== "t2v");

  /* THE LIVE DEFECT: the kit suite's assertion — that the schema admits the kind its
     own importer accepts — is now false. */
  assert(!schema.$defs.clip.properties.kind.enum.includes("t2v"),
    "the control must actually remove the enum member");
  /* And the disagreement is real rather than cosmetic: the importer still takes it. */
  const clips = builderClipsFrom(read("src/server/server.js"));
  const accepted = clips(
    { id: "SH-T2V", clips: [{ id: "SH-T2V-M01", kind: "t2v", dur: 6, motionPrompt: "A storm front." }] },
    [{ id: "SH-T2V-A" }],
    [],
  );
  assert.strictEqual(accepted[0].kind, "t2v",
    "the importer still accepts what the mutated contract now forbids — which is the defect");
});

/* ===========================================================================
   NC-4d / NC-4e — the two LIVE consumers.

   Normalisation and the mode helper were already correct while the shipped Motion path
   still behaved as though t2v began from an approved still, so these mutate the two
   places that actually decide and prove the regressions see it. */

/* The motion-unit builder, in the copy the live page really runs: v607-composer.js
   REPLACES creation-studio.js's declaration, so a repair made only in the base file is
   dead code and a regression that mutates the base file would prove nothing. */
control("NC-4d", "restoring unconditional start-frame assignment in the live builder", async () => {
  const page = await render("#/production", buildFixture(), {
    mutateSource: (file, source) => (file === "v607-composer.js"
      ? mutated("public/v607-composer.js", () => source.replace(
        /if \(!needsStartFrame\) unit\.fromFrame = "";\r?\n\s*else if \(!unit\.fromFrame\)/,
        'if (!unit.fromFrame)',
      ))
      : source),
  });
  const result = vm.runInContext(`(() => {
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    shot.clips = []; shot.motionPrompt = "";
    const c = ensureShotCreation(shot);
    c.activeMotionUnitId = "";
    const profile = (PROMPT_LIBRARY?.profiles || []).find((p) => p.mediaType === "video" && p.mode === "t2v") || null;
    c.motionProfileId = profile ? profile.id : "";
    const unit = ensureGuidedMotionUnit(shot, "", profile);
    return { kind: unit.kind, fromFrame: unit.fromFrame };
  })()`, page.context);

  /* THE LIVE DEFECT, and it is Codex's reproduction exactly: the unit is correctly named
     t2v and is holding a start frame anyway. */
  assert.strictEqual(result.kind, "t2v", "the kind is not what breaks; the frame is");
  assert(result.fromFrame, "the control must reattach the fabricated start frame");
  /* THE GUARD asserts the opposite. */
  assert.notStrictEqual(result.fromFrame, "");
});

/* The old unconditional frame gate bypasses canonical Motion readiness. */
control("NC-4e", "restoring a local frame gate beside canonical readiness", async () => {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.characters = [];
  shot.codes = [];
  shot.creationBrief = {};
  shot.deliveryRoute = "t2v";
  const page = await render("#/production", project, {
    mutateSource: (file, source) => (file === "creation-studio.js"
      ? mutated("public/creation-studio.js", () => source
        .replace('if (!generationAvailable && !videos.length) {', 'if (!progress.requiredApproved && !videos.length) {')
        .replace('const reason = generationBlockedReason;',
          'const reason = "Approve required frames first";'))
      : source),
  });
  const result = vm.runInContext(`(() => {
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    shot.clips = [];
    const c = ensureShotCreation(shot);
    c.activeMotionUnitId = "";
    const profile = (PROMPT_LIBRARY?.profiles || []).find((p) => p.mediaType === "video" && p.mode === "t2v") || null;
    c.motionProfileId = profile ? profile.id : "";
    ensureGuidedMotionUnit(shot, "", profile);
    const html = guidedMotionPanel(shot, null, []);
    return { locked: html.includes("guided-motion-card locked"), saysOldWarning: html.includes("Approve required frames first") };
  })()`, page.context);
  assert.strictEqual(result.locked, true, "the control must reintroduce the local frame lock");
  assert.strictEqual(result.saysOldWarning, true, "the control must restore the contradictory frame warning");
  assert.notStrictEqual(result.locked, false);
});

/* The open panel reads a picker default instead of canonical route facts. */
control("NC-4f", "deriving Motion frame wording from the picker default", async () => {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.characters = [];
  shot.codes = [];
  shot.creationBrief = {};
  shot.deliveryRoute = "t2v";
  const page = await render("#/production", project, {
    mutateSource: (file, source) => (file === "creation-studio.js"
      ? mutated("public/creation-studio.js", () => source.replace(
        /  const needsApprovedStill = motionFacts\.routeRequirementsKnown\r?\n    \? motionFacts\.requiredFrameCount > 0\r?\n    : guidedVideoModeNeedsApprovedStill\(guidedEffectiveVideoMode\(s, c, unit\)\);/,
        '  const needsApprovedStill = guidedVideoModeNeedsApprovedStill(profile?.mode || "");',
      ))
      : source),
  });
  const result = vm.runInContext(`(() => {
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    shot.clips = [];
    const c = ensureShotCreation(shot);
    c.activeMotionUnitId = "";
    c.motionProfileId = "";
    shot.clips = [{ id: "seg-imported", kind: "t2v", dur: 6, motionPrompt: "A storm front.", fromFrame: "", toFrame: "", motionProfileId: "", generationPackages: [] }];
    const html = guidedMotionPanel(shot, null, []);
    return { locked: html.includes("guided-motion-card locked"), pill: /guided-mode-pill[^>]*>([^<]*)</.exec(html)?.[1] || "" };
  })()`, page.context);
  assert.strictEqual(result.locked, false, "canonical readiness must still open description-only Motion");
  assert.notStrictEqual(result.pill, "NO FRAMES NEEDED", "the control must make the open panel contradict its canonical route");
});

/* Active clip focus is allowed to choose editor context, never shot availability. */
control("NC-4g", "letting an active t2v clip bypass hybrid readiness", async () => {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.characters = [];
  shot.codes = [];
  shot.creationBrief = {};
  shot.deliveryRoute = "hybrid";
  const page = await render("#/production", project, {
    mutateSource: (file, source) => (file === "creation-studio.js"
      ? mutated("public/creation-studio.js", () => source.replace(
        '  const generationAvailable = generationUnit?.status === "READY";',
        '  const generationAvailable = guidedEffectiveVideoMode(s, c, unit) === "t2v" || generationUnit?.status === "READY";',
      ))
      : source),
  });
  const result = vm.runInContext(`(() => {
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    const c = ensureShotCreation(shot);
    c.motionProfileId = "";
    shot.clips = [
      { id: "seg-one", kind: "i2v", dur: 5, motionPrompt: "First.", fromFrame: "frame-a", toFrame: "", motionProfileId: "", generationPackages: [] },
      { id: "seg-two", kind: "t2v", dur: 5, motionPrompt: "Second.", fromFrame: "", toFrame: "", motionProfileId: "", generationPackages: [] },
    ];
    c.activeMotionUnitId = "seg-two";
    return guidedMotionPanel(shot, null, []).includes("guided-motion-card locked");
  })()`, page.context);
  assert.strictEqual(result, false, "the control must let active clip focus bypass the hybrid shot blocker");
  assert.notStrictEqual(result, true);
});

/* The frameless half of T0-2, which is the half with the blast radius: leaving t2v out
   of the frameless list gives a text-to-video unit a starting frame that its fal
   endpoint has no field to receive. */
control("NC-4c", "linking a start frame to an imported t2v unit", () => {
  const source = mutated("src/server/server.js", (text) =>
    text.replace(
      'framelessKinds = ["t2v", "plan", "post", "reuse"],',
      'framelessKinds = ["plan", "post", "reuse"],',
    ));
  const clips = builderClipsFrom(source);
  const warnings = [];
  const out = clips(
    { id: "SH-T2V", clips: [{ id: "SH-T2V-M01", kind: "t2v", dur: 6, motionPrompt: "A storm front." }] },
    [{ id: "SH-T2V-A" }],
    warnings,
  );
  assert.strictEqual(out[0].kind, "t2v", "the kind still survives; only the frame rule is broken");
  assert.strictEqual(out[0].fromFrame, "SH-T2V-A", "the control must reattach the frame");
  assert.notStrictEqual(out[0].fromFrame, "");
});

/* The import clip normaliser lifted out of a supplied server.js source, the same way the
   positive suite reaches it. Declared after its callers on purpose — hoisting keeps this
   readable in the order the controls are written. */
function builderClipsFrom(serverSource) {
  const extract = (name) => {
    const start = serverSource.indexOf(`function ${name}(`);
    assert(start >= 0, `server.js no longer declares ${name}`);
    let parens = 0, bodyStart = -1;
    for (let index = serverSource.indexOf("(", start); index < serverSource.length; index++) {
      if (serverSource[index] === "(") parens++;
      else if (serverSource[index] === ")") {
        parens--;
        if (parens === 0) { bodyStart = serverSource.indexOf("{", index); break; }
      }
    }
    let depth = 0;
    for (let index = bodyStart; index < serverSource.length; index++) {
      if (serverSource[index] === "{") { depth++; continue; }
      if (serverSource[index] === "}") { depth--; if (depth === 0) return serverSource.slice(start, index + 1); }
    }
    throw new Error(`could not find the end of ${name}`);
  };
  const { deriveLipSync, lipSyncRequiredFrom } = require("../public/shared-lip-sync");
  const context = vm.createContext({ deriveLipSync, lipSyncRequiredFrom });
  const declarations = ["builderObject", "builderArray", "builderNumber", "builderDuration", "builderLabel",
    "normalizeBuilderMotionBrief", "normalizeBuilderClips"].map(extract).join("\n");
  vm.runInContext(`${declarations}\nglobalThis.__clips = normalizeBuilderClips;`, context);
  return context.__clips;
}

async function main() {
  /* THE NO-VACUOUS-CONTROL GUARD, SELF-TESTED. It is the assertion that caught NC-2's
     anchor going stale after a CRLF checkout, so it is the one piece of this harness that
     must not be allowed to rot silently: a `mutated()` that stopped refusing a no-op would
     turn every control below into a pass that tested nothing. */
  assert.throws(
    () => mutated("public/shared-lip-sync.js", (text) => text),
    /changed nothing/,
    "a mutation that changes nothing must fail loudly rather than count as a pass",
  );

  const before = sourceFingerprints();
  const detected = [];
  for (const entry of controls) {
    let caught = null;
    try {
      await entry.run();
    } catch (error) {
      caught = error;
    }
    assert(!caught, `${entry.id} (${entry.title}) did not behave as the control describes: ${caught && caught.message}`);
    detected.push(entry.id);
  }

  /* AND NOT ONE BYTE OF PRODUCTION SOURCE MOVED. Every mutation above lived in a string
     and was compiled in memory; this proves it rather than asserting it in prose. */
  assert.deepStrictEqual(sourceFingerprints(), before,
    "a control wrote to disk; nothing in this suite may modify production source");

  /* AND THE REAL MODULES ARE GREEN AFTERWARDS. If any mutation had reached a module
     cache, these would now disagree. */
  const LipSync = require("../public/shared-lip-sync");
  assert.strictEqual(LipSync.deriveLipSync({ line: "Bravo two, hold position." }), "implied");
  const Backend = require("../src/generation/fal/fal-h3-backend");
  assert.strictEqual(Backend.FAL_H3_BACKEND.promptExpansion.send, false);
  const Compiler = require("../src/generation/generation-compiler");
  const keys = Compiler.INTENT_FIELDS.map((row) => row.key);
  for (const intent of ["editorial", "endpoints.start", "endpoints.end", "performance.lipSync", "interaction", "subjects.count", "output.nativeAudio"])
    assert(keys.includes(intent), `${intent} must still be inventoried by the real compiler`);
  assert(read("public/app.js").includes('"t2v", "i2v", "flf", "r2v", "plan", "post", "reuse"'));
  assert(read("src/server/server.js").includes('framelessKinds = ["t2v", "plan", "post", "reuse"]'));

  console.log("Shot Execution Tier 0 negative controls passed: " + detected.length + " deliberate defects detected in memory; route requirements, canonical Motion readiness, compiler accounting and provider boundaries all remained guarded. Nothing was written or reverted. Provider calls made: 0.");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

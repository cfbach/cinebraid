/* CineBraid deterministic generation compilation.
 *
 * The suite exists because the failures it covers were all SILENT. A shot carrying a
 * camera move, a blocking line, a performance note, a required ending state and a
 * visual style compiled to a prompt containing none of them, with no warning, and the
 * package dispatched. Nothing was broken; the intent simply stopped existing between
 * the shot and the model.
 *
 * So the assertions are semantic, not textual. A snapshot of a prompt string proves a
 * prompt did not change; it does not prove a director's decision survived. Every test
 * below asks whether a specific piece of filmmaking intent reached the model, is
 * anchored by an input that already establishes it, was deliberately left out with a
 * reason, or produced a warning — and refuses the fifth possibility, which is silence.
 *
 * The first block reproduces the original defects against the CURRENT compiler, so a
 * regression is a failing test rather than an archaeology exercise.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const Compiler = require("../src/generation/generation-compiler");
const Contracts = require("../src/generation/generation-contracts");
const H3 = require("../model-packs/minimax-h3");
const F = require("./generation-compiler-fixture");

const {
  KAI, HANGAR, PARCEL,
  FRAME_A, FRAME_B, REF_IDENTITY, REF_STATE, REF_LOCATION, REF_PROP, REF_MOTION, REF_VOICE,
  baseSpec, capabilityFor, seedCapableCapability, modelIdFor,
  carries, covered, state, warnedAbout,
} = F;


function compile(mode, references, options = {}) {
  const modelId = modelIdFor(mode);
  const plan = Compiler.compileGenerationPlan({
    spec: options.spec || baseSpec(),
    references,
    mode,
    modelId,
    surface: options.surface || "api",
    capability: options.capability || capabilityFor(mode, options.surface || "api"),
    seed: options.seed,
    pack: options.pack,
  });
  const validation = Contracts.validateGenerationPlan(plan);
  if (!options.allowInvalid)
    assert(validation.ok, `${mode} plan must satisfy the GenerationPlan contract: ${JSON.stringify(validation.errors)}`);
  return plan;
}

/* ===========================================================================
   1. The audit defects, as regressions.

   Each of these was observed against the pre-C1 compiler with this exact production
   state. They are stated as the property that was violated, so a future rewrite has to
   keep the property rather than the wording. */

/* A — a motion package could contain no motion at all, and said nothing about it. */
{
  const spec = baseSpec({ actions: [], narrativePurpose: "" });
  const plan = compile("i2v", [FRAME_A], { spec });
  assert(warnedAbout(plan, /no-action/), "a shot with no action must warn rather than dispatch silently");
  assert(!/^\s*(ACTION|WHAT CHANGES)\s*$/m.test(plan.inputs.prompt), "an empty action section must not be emitted at all");
}
/* And the inverse: action present, camera absent, must still produce action. */
{
  const spec = baseSpec({ camera: { framing: "", movement: "", stability: "", lensIntent: "", timing: "" } });
  const plan = compile("i2v", [FRAME_A], { spec });
  assert(carries(plan, "lowers the parcel"), "action must survive when no camera move is specified");
  assert(!warnedAbout(plan, /no-action/), "a shot with action must not warn about missing action");
}

/* B — the ending contract could be reduced to prose, and reference ORDER decided which
   frame ended the shot. */
{
  const forwards = compile("flf", [FRAME_A, FRAME_B]);
  const backwards = compile("flf", [FRAME_B, FRAME_A]);
  for (const plan of [forwards, backwards]) {
    assert.strictEqual(plan.endpoints.firstFrame.refId, "kf-a", "the first frame is chosen by role, never by array position");
    assert.strictEqual(plan.endpoints.lastFrame.refId, "kf-b", "the last frame is chosen by role, never by array position");
  }
  assert.deepStrictEqual(forwards.endpoints, backwards.endpoints, "reordering references must not change the endpoint contract");
  assert.strictEqual(state(forwards, "state.final"), "anchored", "the required ending state is anchored BY the final frame");
  assert.strictEqual(covered(forwards, "state.final").via, "the supplied final frame");
  assert(!carries(forwards, "standing one pace back from the parcel"),
    "the ending must not be re-described in prose; that competes with the frame that fixes it");
}

/* C — structured intent vanished between the spec and the prompt, with no warning.
   Every field observed lost is now either in the prompt or explained. */
{
  const plan = compile("i2v", [FRAME_A]);
  const observedLost = [
    "camera.framing", "camera.timing", "camera.lens",
    "performance.emotion", "performance.facial", "performance.body", "performance.gaze",
    "staging", "style.visual", "identity.canon", "production.risks", "state.final",
  ];
  for (const intent of observedLost)
    assert(["represented", "anchored", "omitted-by-design", "unsupported"].includes(state(plan, intent)),
      `${intent} was silently lost before C1 and must now be accounted for, not ${state(plan, intent)}`);
}

/* D — no seed reached anything. The architecture now carries one wherever the resolved
   capability accepts it, and refuses honestly where it does not. */
{
  const plan = compile("t2v", [], { seed: 4242 });
  assert.strictEqual(state(plan, "reproducibility.seed"), "unsupported", "no MiniMax source documents a seed");
  assert(warnedAbout(plan, /seed-unsupported/), "an unsupported seed must warn, not disappear");
  assert(!JSON.stringify(plan.settings).includes("4242"), "an unsupported seed must not be written into the request");
}

/* E — reference roles were ambiguous or mis-adjudicated. A voice reference warned that
   it lacked an audio role; identity and location references warned that they were not
   keyframes. */
{
  const plan = compile("r2v", [REF_IDENTITY, REF_LOCATION, REF_MOTION, REF_VOICE]);
  for (const row of plan.inputs.references) {
    assert(row.role, "every planned reference carries a semantic production role");
    assert(row.production.purpose, `${row.refId} must state what it is for in production terms`);
  }
  assert.strictEqual(plan.warnings.length, 0,
    `a legal reference package must not warn: ${JSON.stringify(plan.warnings)}`);
}

/* F — internal identifiers reached model-facing prose. */
{
  for (const [mode, refs] of [["t2v", []], ["i2v", [FRAME_A]], ["flf", [FRAME_A, FRAME_B]], ["r2v", [REF_IDENTITY, REF_LOCATION]]]) {
    const plan = compile(mode, refs);
    for (const identifier of [KAI, HANGAR, PARCEL])
      assert(!plan.inputs.prompt.includes(identifier), `${identifier} must not appear in the ${mode} prompt`);
    assert(plan.provenance.entityIdentifiers.includes(KAI), "machine identity is retained in provenance, not in prose");
  }
}
/* Including when the identifier arrives inside an action sentence, which is how it
   reached the prompt before: a structured motion plan keys its subjects by entity id. */
{
  const spec = baseSpec({
    actions: [{ start: 0, end: 8, action: `${PARCEL} settles flat on the chalk line.` }],
    promptEntities: [{ id: PARCEL, name: "the sealed parcel", type: "prop", descriptor: "the sealed parcel" }],
  });
  const plan = compile("i2v", [FRAME_A], { spec });
  assert(!plan.inputs.prompt.includes(PARCEL), "an identifier inside an action must be replaced, not passed through");
  assert(carries(plan, "the sealed parcel"), "it is replaced by the production name, so the action survives intact");
}

/* G — modes did not compile differently enough. */
{
  const t2v = compile("t2v", []);
  const i2v = compile("i2v", [FRAME_A]);
  const flf = compile("flf", [FRAME_A, FRAME_B]);
  const r2v = compile("r2v", [REF_IDENTITY, REF_LOCATION]);
  const prompts = [t2v, i2v, flf, r2v].map((plan) => plan.inputs.prompt);
  assert.strictEqual(new Set(prompts).size, 4, "the four modes must produce four different documents");

  /* T2V has no anchor, so it must construct the scene. */
  assert(carries(t2v, "torn left cuff"), "T2V must construct identity; nothing else establishes it");
  assert(carries(t2v, "corrugated walls"), "T2V must construct the environment");
  assert(carries(t2v, "anamorphic"), "T2V must construct the visual style");
  assert.strictEqual(state(t2v, "identity.canon"), "represented");

  /* I2V has one, so it names the anchors rather than rebuilding them. See the dedicated
     block below for what "names" is allowed to mean. */
  assert(!carries(i2v, "steel-toed boots"), "I2V must not carry canon detail the first frame already fixes");
  assert(!carries(i2v, "chalk line across the floor"), "nor environment detail the first frame already fixes");
  assert.strictEqual(state(i2v, "identity.canon"), "anchored");
  assert.strictEqual(covered(i2v, "environment").via, "the supplied first frame");
}

/* ===========================================================================
   2. Per-mode filmmaking contracts. */

/* ---- T2V ---- */
{
  const plan = compile("t2v", []);
  assert(carries(plan, "lowers the parcel"), "meaningful action survives");
  assert(carries(plan, "push-in"), "camera direction survives");
  assert(carries(plan, "controlled dread"), "performance survives");
  assert(carries(plan, "camera-left"), "staging survives");
  assert.strictEqual(state(plan, "timing.duration"), "represented");
  assert.strictEqual(covered(plan, "timing.duration").via, "parameter", "duration is a parameter, not a sentence");
  assert.strictEqual(state(plan, "continuity.preserve"), "represented");
  assert.strictEqual(plan.settings.extensions["minimax-h3/fl2va"].ratio, "16:9",
    "text-to-video must name an explicit ratio; MiniMax documents that it cannot be adaptive");
  assert(!plan.endpoints.firstFrame, "text-to-video has no frame contract");
}

/* ---- I2V ---- */
{
  const plan = compile("i2v", [FRAME_A]);
  assert.strictEqual(plan.endpoints.firstFrame.refId, "kf-a", "Frame A is a structured hard input");
  assert.strictEqual(plan.settings.extensions["minimax-h3/fl2va"].referenceBindings["kf-a"], "first_frame");
  assert(carries(plan, "lowers the parcel"), "meaningful action survives");
  assert(carries(plan, "push-in"), "camera survives");
  assert(carries(plan, "jaw set"), "performance survives");
  assert.strictEqual(state(plan, "continuity.preserve"), "represented", "must-preserve intent survives");
  assert(carries(plan, "do not reconstruct the image in words"),
    "the prompt tells the model not to rebuild the anchored frame");
  for (const anchored of ["state.initial", "environment", "identity.canon", "style.visual"])
    assert.strictEqual(state(plan, anchored), "anchored", `${anchored} is established by Frame A`);
  assert.strictEqual(state(plan, "output.aspectRatio"), "anchored",
    "with an image input the ratio comes from the image, which is established rather than ignored");
  assert(covered(plan, "output.aspectRatio").via.includes("Approved opening frame"),
    "and the anchor names the reference that actually carries it");
}
/* An anchor is only legitimate when the input it names is present. A reference package
   with no visual media cannot anchor the ratio, and must say so rather than claim it. */
{
  const plan = compile("r2v", [REF_VOICE], { allowInvalid: true });
  assert.notStrictEqual(state(plan, "output.aspectRatio"), "anchored", "nothing visual, nothing to anchor to");
  assert(warnedAbout(plan, /audio-only-reference-package/), "and the package itself is refused explicitly");
}

/* ---- FLF ---- */
{
  const plan = compile("flf", [FRAME_A, FRAME_B]);
  assert(plan.endpoints.firstFrame && plan.endpoints.lastFrame, "both endpoints survive as structured inputs");
  const bindings = plan.settings.extensions["minimax-h3/fl2va"].referenceBindings;
  assert.strictEqual(bindings["kf-a"], "first_frame");
  assert.strictEqual(bindings["kf-b"], "last_frame");
  assert(carries(plan, "fixed endpoints"), "the endpoint contract is stated");
  assert(carries(plan, "converg"), "the prompt describes the route between the endpoints");
  assert(carries(plan, "lowers the parcel"), "action cannot disappear from a bridge");
  assert(carries(plan, "push-in"), "camera progression survives");
  assert.strictEqual(state(plan, "state.final"), "anchored");
}
/* A first/last plan without a bound ending frame is refused by the contract, not
   quietly compiled into a prose ending. */
{
  const plan = compile("flf", [FRAME_A], { allowInvalid: true });
  const validation = Contracts.validateGenerationPlan(plan);
  assert(!validation.ok, "an FLF plan with no ending binding must fail the contract");
  assert(validation.errors.some((error) => error.field === "endpoints.lastFrame"));
  assert(warnedAbout(plan, /missing-endpoint/), "and it must warn while compiling");
  /* And it must not claim the ending is anchored by a frame nobody selected. A false
     anchor reads as accounted for, which is worse than the silence it replaces. */
  assert.notStrictEqual(state(plan, "state.final"), "anchored",
    "an anchor may only name an input that is actually in the package");
  assert(/no ending-frame input/.test(covered(plan, "state.final").reason),
    "and the record says why the ending state is unheld, alongside the missing-endpoint warning");
}

/* ---- R2V ---- */
{
  const plan = compile("r2v", [REF_IDENTITY, REF_STATE, REF_LOCATION, REF_PROP, REF_MOTION, REF_VOICE]);
  assert(carries(plan, "<Picture 1>"), "references are labelled per modality, as the Ref2VA guide documents");
  assert(carries(plan, "<Video 1>"));
  assert(carries(plan, "<Audio 1>"));
  assert(carries(plan, "Kai"), "character identity survives by name");
  assert(carries(plan, "jacket torn"), "the approved continuity state survives");
  assert(carries(plan, "geometry, materials and lighting logic"), "the location role survives as a production job");
  assert(carries(plan, "movement quality"), "the motion role survives");
  assert(carries(plan, "voice"), "the voice role survives");
  assert.strictEqual(state(plan, "identity.canon"), "anchored", "identity is anchored by a named reference, not restated");
  assert(covered(plan, "identity.canon").via.includes("<Picture 1>"), "and the anchor names which reference");
  assert.strictEqual(plan.warnings.length, 0, JSON.stringify(plan.warnings));
}

/* ===========================================================================
   3. The reference planner. */
{
  const shuffled = [REF_VOICE, REF_MOTION, FRAME_B, REF_LOCATION, FRAME_A, REF_IDENTITY];
  const a = Compiler.planReferences(baseSpec(), shuffled);
  const b = Compiler.planReferences(baseSpec(), [...shuffled].reverse());
  assert.deepStrictEqual(a.map((row) => row.refId), b.map((row) => row.refId),
    "the planner produces one canonical order regardless of how the selection arrived");
  assert.strictEqual(a[0].role, "first-frame", "temporal endpoints lead");
  assert.strictEqual(a[1].role, "last-frame");
  for (const row of a) {
    assert(row.production.label, `${row.refId} must carry a filmmaker-facing label`);
    for (const identifier of [KAI, HANGAR, PARCEL])
      assert(!row.production.label.includes(identifier), `${row.refId}'s label must be a name, not an identifier`);
    assert(["image", "video", "audio"].includes(row.mediaType));
    assert(row.source.kind, "every reference resolves a source without minting a MediaAsset");
  }
  assert.strictEqual(a.find((row) => row.role === "identity").required, true, "an identity reference is not optional");
  assert.strictEqual(a.find((row) => row.role === "motion-reference").required, false, "an influence is");
}
/* MediaAsset stays dormant: the planner reads what it is given and mints nothing. */
{
  const source = fs.readFileSync(path.join(__dirname, "..", "src/generation/generation-compiler.js"), "utf8");
  for (const ledger of ["media-assets", "media-asset-store", "media-asset-indexer", "media-hash", "media-asset-verify"])
    assert(!source.includes(`require("./${ledger}")`), `the compiler must not import ${ledger}`);
}

/* ===========================================================================
   4. Coverage as a contract. */
{
  const plan = compile("i2v", [FRAME_A]);
  const states = new Set(plan.coverage.map((row) => row.state));
  assert(states.has("represented") && states.has("anchored") && states.has("omitted-by-design"),
    "a realistic shot exercises all three non-failing states");
  for (const row of plan.coverage) {
    if (row.state === "represented") assert(Contracts.INTENT_REPRESENTATION_CHANNELS.includes(row.via), `${row.intent} must say where it landed`);
    if (row.state === "anchored") assert(row.via, `${row.intent} must name what anchors it`);
    if (row.state === "omitted-by-design") assert(row.reason, `${row.intent} must record why it was left out`);
    /* Matched on the warning's own `intent` field rather than by pattern-matching its
       prose. The message is written for a filmmaker and says "subjects in frame", not
       "subjects.count", so a regex over the text was quietly unable to confirm the
       pairing it was asserting — it passed only while no intent was unsupported here. */
    if (row.state === "unsupported")
      assert(plan.warnings.some((warning) => warning.intent === row.intent), `${row.intent} must warn`);
  }
  /* Every intent the shot carries appears exactly once. */
  const inventory = Compiler.inventoryIntent(baseSpec(), (value) => String(value));
  for (const row of inventory)
    assert(covered(plan, row.key), `${row.key} is set on the shot and must appear in coverage`);
  assert.strictEqual(new Set(plan.coverage.map((row) => row.intent)).size, plan.coverage.length, "no intent is recorded twice");
}
/* An intent no pack claims becomes a visible gap, not a shorter prompt. */
{
  const forgetful = {
    packId: "test-forgetful", packVersion: "1.0.0",
    models: {}, playbook: { version: "1" },
    compileMode: () => ({ prompt: "Do something." }),
  };
  const plan = Compiler.compileGenerationPlan({
    spec: baseSpec(), references: [FRAME_A], mode: "i2v", modelId: "test/forgetful",
    capability: capabilityFor("i2v"), pack: forgetful,
  });
  assert.strictEqual(state(plan, "action.primary"), "unsupported", "a pack that drops the action produces a gap");
  assert(warnedAbout(plan, /intent-unaccounted/), "and the gap warns");
  assert(plan.coverage.length >= 20, "every carried intent is still enumerated");
}
/* And a pack cannot escape that by CLAIMING the intent while writing nothing. Coverage
   is checked against the finished prompt, because a self-reported claim about your own
   omissions is the one report that cannot be trusted. */
{
  const boastful = {
    packId: "test-boastful", packVersion: "1.0.0", models: {}, playbook: { version: "1" },
    compileMode: (ctx) => {
      ctx.coverage.represent("action.primary", "prompt");
      ctx.coverage.represent("camera.movement", "prompt");
      return { prompt: "The camera performs a slow dolly push-in." };
    },
  };
  const plan = Compiler.compileGenerationPlan({
    spec: baseSpec(), references: [FRAME_A], mode: "i2v", modelId: "test/boastful",
    capability: capabilityFor("i2v"), pack: boastful,
  });
  assert.strictEqual(state(plan, "camera.movement"), "represented", "a claim the prompt supports stands");
  assert.strictEqual(state(plan, "action.primary"), "unsupported", "a claim the prompt does not support is downgraded");
  assert(warnedAbout(plan, /coverage-unverified/), "and the unsupported claim warns");
}

/* ===========================================================================
   5. Generic seed and reproducibility.

   H3 has no documented seed, so the generic path is proven against a synthetic
   capability that declares one. No provider is broadened to demonstrate it. */
{
  const plan = compile("t2v", [], { seed: 90210, capability: seedCapableCapability("t2v") });
  assert.strictEqual(plan.settings.seedMode, "explicit");
  assert.strictEqual(plan.settings.seed, 90210);
  assert.strictEqual(state(plan, "reproducibility.seed"), "represented");
  assert.strictEqual(covered(plan, "reproducibility.seed").via, "parameter");

  /* compile -> job -> provenance. A plan becomes a job by adding a jobId; nothing is
     translated, which is why the seed cannot be lost on the way. */
  const job = { ...plan, jobId: "job-1", status: "draft", outputType: "video" };
  const jobCheck = Contracts.validateGenerationJob(job);
  assert(jobCheck.ok, `a plan must mint a legal job unchanged: ${JSON.stringify(jobCheck.errors)}`);
  assert.strictEqual(job.settings.seed, 90210, "the seed survives compile -> job");
  const result = {
    jobId: "job-1", status: "completed",
    backend: { backendId: "test", executionKind: "hosted_api", orchestratorLocation: "hosted_api", inferenceLocation: "hosted_api", costClass: "metered_api" },
    model: { modelId: plan.model.modelId },
    artifacts: [{ artifactId: "a1", kind: "video", seed: job.settings.seed }],
  };
  assert(Contracts.validateGenerationResult(result).ok, "and a result carrying it validates");
  assert.strictEqual(result.artifacts[0].seed, 90210, "the seed survives job -> stored provenance");
}
/* A seed offered where the configuration refuses it is never quietly accepted. */
{
  const plan = compile("i2v", [FRAME_A], { seed: 7 });
  assert.strictEqual(plan.settings.seedMode, "random");
  assert.strictEqual(plan.settings.seed, undefined);
  assert.strictEqual(state(plan, "reproducibility.seed"), "unsupported");
}

/* ===========================================================================
   6. Determinism, and independence from any assistant or network. */
{
  const references = [REF_IDENTITY, REF_LOCATION, REF_MOTION, REF_VOICE];
  const first = compile("r2v", references);
  const second = compile("r2v", references);
  assert.deepStrictEqual(first, second, "identical input must compile to an identical plan");
  assert.strictEqual(JSON.stringify(first), JSON.stringify(second), "including key order");
  /* A plan carries no timestamp: two runs a second apart must be byte-identical. */
  assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(JSON.stringify(first)), "a plan must contain no clock reading");
}
{
  /* Structural, not behavioural: the compiler and the pack cannot reach an assistant, a
     network or a clock because the code contains nothing that can. Comments are
     stripped first — these modules discuss determinism at length, and a prose mention
     of Math.random is not a call to it. */
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const file of ["src/generation/generation-compiler.js", "model-packs/minimax-h3.js"]) {
    const code = stripComments(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
    for (const forbidden of [
      "require(\"./llm\")", "require(\"../llm\")", "require(\"http", "require(\"node-fetch",
      "fetch(", "Math.random", "Date.now", "new Date", "process.env",
    ])
      assert(!code.includes(forbidden), `${file} must not contain ${forbidden}`);
  }
}

/* ===========================================================================
   7. Model facts versus provider facts, and local versus hosted. */
{
  /* fal's queue schema is narrower than the model. The intersection takes the smaller
     without either layer being rewritten. */
  const modelOnly = capabilityFor("t2v");
  assert.strictEqual(modelOnly.maxPromptCharacters, 7000, "the model's own ceiling is what MiniMax documents");
  const throughFal = capabilityFor("t2v", "api", { backend: { maxPromptCharacters: 2000 } });
  assert.strictEqual(throughFal.maxPromptCharacters, 2000, "a backend narrows it");
  assert.strictEqual(H3.H3_FACTS.maxPromptCharacters, 7000, "and the model fact is not overwritten by the backend's");

  const long = baseSpec({ mustPreserve: [("Preserve every approved surface, marking, edge and material in the shot. ").repeat(60)] });
  const plan = compile("t2v", [], { spec: long, capability: throughFal, allowInvalid: true });
  assert(warnedAbout(plan, /prompt-over-limit/), "exceeding the effective ceiling warns");
  assert(plan.warnings.some((row) => /2000/.test(row.message)), "and names the ceiling that actually applies");
}
{
  /* The open weights are H3-Base and render 768p; 2K comes from a module that is not
     open-sourced. A local install is a different capability set, not a smaller one. */
  const local = capabilityFor("t2v", "local");
  const hosted = capabilityFor("t2v", "api");
  assert.deepStrictEqual(local.resolutions, ["768P"]);
  assert.deepStrictEqual(hosted.resolutions, ["2K", "768P"]);
  const localPlan = compile("t2v", [], { surface: "local", capability: local });
  const hostedPlan = compile("t2v", [], { surface: "api", capability: hosted });
  assert.strictEqual(localPlan.settings.extensions["minimax-h3/fl2va"].resolution, "768P");
  assert.notStrictEqual(localPlan.inputs.prompt, hostedPlan.inputs.prompt,
    "the two surfaces are not silently collapsed into one document");
  assert(localPlan.inputs.prompt.includes("integrated_multimodal_description"),
    "the open-weight path emits the H3-Base document MiniMax documents");
  assert(localPlan.inputs.prompt.includes("overall_soundscape"));
  assert(localPlan.inputs.prompt.includes("non_diegetic_music"));
  assert(!hostedPlan.inputs.prompt.includes("integrated_multimodal_description"),
    "the hosted route is fronted by H3-Context-IR and reads prose");
}
{
  /* Checkpoints are identity, not labels. */
  assert.strictEqual(H3.checkpointForMode("flf").name, "fl2va");
  assert.strictEqual(H3.checkpointForMode("r2v").name, "ref2va");
  assert.strictEqual(H3.capabilityLayer("flf").maxReferenceVideos, 0, "FL2VA takes no video reference");
  assert.strictEqual(H3.capabilityLayer("r2v").maxReferenceVideos, 3, "Ref2VA does");
}

/* ===========================================================================
   8. Documented H3 prompting policy is applied, and separated from the facts. */
{
  /* Camera is written as motion, amplitude and speed in prose, not stacked labels. */
  assert.strictEqual(H3.cameraSentence("slow dolly push-in", "smooth"),
    "The camera slow dolly push-in with small amplitude at slow speed.");
  assert.strictEqual(H3.cameraSentence("locked off", ""), "The camera holds a static shot with no movement.");
  assert.strictEqual(H3.cameraSentence("", ""), "", "no camera intent produces no camera sentence");

  /* Sound the audience hears and sound the characters hear are different fields. */
  const plan = compile("t2v", []);
  const soundscape = plan.inputs.prompt.split("SOUNDSCAPE\n")[1].split("\n\n")[0];
  assert(!soundscape.includes("It's done."), "the soundscape must not restate dialogue");
  assert(!soundscape.includes("sustained low string"), "nor music the characters cannot hear");
  assert(carries(plan, "sustained low string"), "which is directed in its own section instead");
  assert.strictEqual(state(plan, "sound.music"), "represented");

  /* Spoken content verbatim, delivery stated outside it. */
  assert(carries(plan, "“It's done.”"), "the line is reproduced exactly");
  assert(carries(plan, "(S1)"), "with a stable speaker identifier");

  /* The two halves of a pack are versioned separately. */
  assert(H3.H3_PLAYBOOK.version && H3.PACK_VERSION);
  assert(!JSON.stringify(H3.H3_FACTS).includes("amplitude"), "prompting policy must not live in the facts");
  assert(!JSON.stringify(H3.H3_PLAYBOOK).includes("maxReferenceImages"), "capability facts must not live in the playbook");
}

/* ---------------------------------------------------------------------------
   Anchoring is verbal orientation, not reconstruction.

   MiniMax's base guide, section 3.1, is explicit that an image-anchored description
   should FIRST establish the style, subjects, composition and scene anchors visible in
   the frame, and THEN describe the action. Reading "the frame carries it, so say
   nothing" as the whole policy was too absolute: the frame is what the model sees, and
   the prompt is what it has committed to.

   Both halves are load-bearing, so both are asserted. The anchors are NAMED — briefly,
   in the guide's own order — and the detail past the naming stays in the frame. The
   coverage state does not move: the frame is still what establishes them. */
{
  const t2v = compile("t2v", []);
  const i2v = compile("i2v", [FRAME_A]);
  const flf = compile("flf", [FRAME_A, FRAME_B]);
  const alignment = i2v.inputs.prompt.split("IMAGE ALIGNMENT\n")[1].split("\n\n")[0];
  const construction = t2v.inputs.prompt.split("SUBJECT AND ENVIRONMENT\n")[1].split("\n\n")[0];

  /* Established, per the guide. */
  for (const anchor of ["anamorphic", "olive flight jacket", "corrugated walls", "east door"])
    assert(alignment.toLowerCase().includes(anchor), `the orientation must name ${anchor}`);
  /* In the guide's order: style, subjects, scene. */
  assert(alignment.indexOf("Anamorphic") < alignment.indexOf("olive flight jacket"),
    "style is established before subjects");
  assert(alignment.indexOf("olive flight jacket") < alignment.indexOf("corrugated walls"),
    "subjects before scene anchors");

  /* But not reconstructed. Each anchor is clipped to a naming length, and the tail of
     every one of them stays where it already is — in the frame. */
  for (const tail of ["steel-toed boots", "chalk line across the floor"]) {
    assert(!i2v.inputs.prompt.toLowerCase().includes(tail), `${tail} is in the frame and must not be rebuilt in prose`);
    assert(carries(t2v, tail), `whereas T2V, with nothing anchored, must construct ${tail}`);
  }
  /* Brevity asserted against the policy rather than against a length ratio: a ratio
     depends on how long this fixture's canon happens to be, and would pass or fail for
     reasons that have nothing to do with the rule. The rule is that each anchor is
     NAMED, so each named anchor is checked against the naming length. */
  const clause = alignment.slice(alignment.indexOf("It establishes ") + "It establishes ".length);
  const named = clause.slice(0, clause.indexOf(". ")).split("; ");
  assert.strictEqual(named.length, 4, "all four anchors are named");
  for (const anchor of named)
    assert(anchor.split(/\s+/).filter(Boolean).length <= H3.H3_PLAYBOOK.anchorOrientation.maxWordsPerAnchor,
      `"${anchor}" exceeds the naming length; that is reconstruction, not orientation`);
  assert(construction.length > named.join("; ").length, "and T2V still builds more than I2V names");
  assert(carries(i2v, "do not reconstruct the image in words"), "and the instruction is explicit");

  /* Naming changes nothing about what establishes the fact. */
  for (const key of ["style.visual", "state.initial", "identity.canon", "environment"])
    assert.strictEqual(state(i2v, key), "anchored", `${key} is still anchored by the frame, not represented`);

  /* The same guidance applies to the first frame of a first/last pair — and to that
     frame ONLY. Naming the ending in prose is the exact failure the endpoint binding
     exists to prevent, so the orientation must never reach for it. */
  const endpoints = flf.inputs.prompt.split("ENDPOINT CONTRACT\n")[1].split("\n\n")[0];
  assert(endpoints.includes("It establishes"), "the first frame is verbally anchored in FLF too");
  assert(!endpoints.toLowerCase().includes("standing one pace back"),
    "but the required ending state is never named; the bound final frame is the contract");
  assert.strictEqual(state(flf, "state.final"), "anchored");
  assert(!H3.H3_PLAYBOOK.anchorOrientation.order.includes("state.final"),
    "and the policy excludes the ending structurally, not by accident");
}

/* ===========================================================================
   9. The evidence record. Every capability claim the pack relies on is sourced, and
   every unsourced one is declared as such. */
{
  const evidence = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "docs", "architecture", "model-evidence", "minimax-h3.json"), "utf8"));
  const sourceIds = new Set(evidence.sources.map((row) => row.id));
  assert(sourceIds.size >= 3, "at least the model card, the API reference and a prompt guide");
  for (const source of evidence.sources) {
    assert(/^https:\/\//.test(source.url), `${source.id} needs a primary URL`);
    assert(source.checkedOn && source.type.startsWith("official"), `${source.id} must be an official source`);
    assert(!/reddit|medium\.com|blog/i.test(source.url), `${source.id} must not be a third-party write-up`);
  }
  for (const claim of evidence.capabilities) {
    assert(sourceIds.has(claim.source), `"${claim.claim}" cites an unknown source`);
    assert(Array.isArray(claim.appliesTo) && claim.appliesTo.length, `"${claim.claim}" must say whether it is local, API or both`);
  }
  /* The facts the pack encodes must match the evidence, claim for claim. */
  const value = (fragment) => evidence.capabilities.find((row) => row.claim.includes(fragment)).value;
  assert.deepStrictEqual(H3.H3_FACTS.durationSeconds, value("Output duration range"));
  assert.strictEqual(H3.H3_FACTS.fps, value("Frame rate"));
  assert.strictEqual(H3.H3_FACTS.maxPromptCharacters, value("Maximum prompt length accepted by the model"));
  assert.deepStrictEqual(H3.H3_FACTS.aspectRatios, value("Aspect ratios"));
  assert.strictEqual(H3.H3_FACTS.checkpoints.ref2va.maxReferenceImages, value("Reference images per generation"));
  assert.strictEqual(H3.H3_FACTS.checkpoints.ref2va.maxReferenceVideos, value("Reference video clips per generation"));
  assert.strictEqual(H3.H3_FACTS.checkpoints.ref2va.maxReferenceAudio, value("Reference audio clips per generation"));
  assert.deepStrictEqual(H3.H3_FACTS.surfaces.local.resolutions, value("Resolutions available on the open-weight local path"));
  assert.deepStrictEqual(H3.H3_FACTS.surfaces.api.resolutions, value("Resolutions available on the hosted API"));

  /* A fact with no source is declared unestablished, and the pack behaves accordingly. */
  const seedGap = evidence.notEstablished.find((row) => /seed/i.test(row.claim));
  assert(seedGap, "the absence of a documented seed must be recorded, not assumed");
  assert.strictEqual(H3.H3_FACTS.seed.supported, false, "and the pack must not invent one");
  assert(evidence.conflicts.some((row) => /prompt length/i.test(row.topic)),
    "the model/provider prompt-length disagreement is preserved rather than silently resolved");

  /* H3-Context-IR is a separate, optional endpoint, and the record must say so rather
     than treating it as something the hosted API does for you. The distinction decides
     whether CineBraid's deterministic compilation is the point of the layer or a
     duplicate of it, so it is pinned here and not left to prose that can drift. */
  const contextIr = evidence.capabilities.find((row) => /h3-context-ir is a separate endpoint/i.test(row.claim));
  assert(contextIr, "the record must state what Context-IR actually is");
  assert(/does not create a video-generation task/i.test(contextIr.claim));
  assert(evidence.capabilities.some((row) => /plain natural-language text item directly/i.test(row.claim)),
    "and that the hosted API takes a prompt directly, which is why prose is the right serialisation");
  const packSource = fs.readFileSync(path.join(__dirname, "..", "model-packs", "minimax-h3.js"), "utf8");
  for (const overstatement of [/fronted by (?:H3-)?Context-IR/i, /Context-IR (?:runs|is run) (?:before|for)/i])
    assert(!overstatement.test(packSource),
      "the pack must not claim the hosted API is fronted by Context-IR; nothing documents that");

  /* A compiled plan states which sources its capability claims rest on, and every one
     of them exists in the record. */
  const plan = compile("flf", [FRAME_A, FRAME_B]);
  assert(plan.provenance.sources.length, "a plan must record the evidence behind its model facts");
  for (const id of plan.provenance.sources)
    assert(sourceIds.has(id), `the plan cites ${id}, which the evidence record does not contain`);
  for (const source of evidence.sources)
    assert(plan.provenance.sources.includes(source.id), `${source.id} is in the record but the pack does not cite it`);
}

/* ===========================================================================
   10. Adversarial cases. */

/* 1. camera but no action */
{
  const spec = baseSpec({ actions: [], narrativePurpose: "" });
  const plan = compile("t2v", [], { spec });
  assert(warnedAbout(plan, /no-action/));
  assert(carries(plan, "push-in"), "the camera intent still survives");
}
/* 2. action but no camera */
{
  const spec = baseSpec({ camera: { framing: "", movement: "", stability: "", lensIntent: "", timing: "" } });
  const plan = compile("t2v", [], { spec });
  assert(!covered(plan, "camera.movement"), "an absent field is not intent and needs no explanation");
  assert(carries(plan, "lowers the parcel"));
}
/* 3. FLF whose prose final state contradicts the bound frame */
{
  const spec = baseSpec({ finalState: { subject: "Kai has already left the frame entirely", staging: "", camera: "", environment: "" } });
  const plan = compile("flf", [FRAME_A, FRAME_B], { spec });
  assert(!carries(plan, "already left the frame"), "the bound frame wins; the contradicting prose never reaches the model");
  assert.strictEqual(state(plan, "state.final"), "anchored");
}
/* 4. FLF with valid endpoints and intermediate action */
{
  const spec = baseSpec({
    actions: [
      { start: 0, end: 3, action: "Kai crosses the chalk line." },
      { start: 3, end: 6, action: "He lowers the parcel with both hands." },
      { start: 6, end: 8, action: "He steps back one pace." },
    ],
  });
  const plan = compile("flf", [FRAME_A, FRAME_B], { spec });
  for (const beat of ["crosses the chalk line", "lowers the parcel", "steps back one pace"])
    assert(carries(plan, beat), `${beat} must survive`);
  assert(/At 3\.00s,/.test(plan.inputs.prompt), "declared beat times are used when they genuinely advance");
  assert(/At 6\.00s,/.test(plan.inputs.prompt));
}
/* 5. I2V with detailed visual canon that should be anchored, not rebuilt */
{
  const plan = compile("i2v", [FRAME_A]);
  assert.strictEqual(state(plan, "identity.canon"), "anchored");
  assert(!carries(plan, "steel-toed boots"), "canon detail beyond the naming stays in the frame");
  assert(carries(plan, "torn cuff"), "and a drift instruction about it still reaches the model");
}
/* 6. T2V with no visual anchors */
{
  const plan = compile("t2v", []);
  assert.strictEqual(plan.inputs.references.length, 0);
  assert(carries(plan, "olive flight jacket"), "with nothing anchored, everything must be constructed");
}
/* 7. reference mode with identity + location + motion */
{
  const plan = compile("r2v", [REF_IDENTITY, REF_LOCATION, REF_MOTION]);
  assert.strictEqual(plan.inputs.references.length, 3);
  assert.strictEqual(plan.warnings.length, 0);
}
/* 8. reference mode with image + video + audio roles */
{
  const plan = compile("r2v", [REF_IDENTITY, REF_MOTION, REF_VOICE]);
  const kinds = plan.inputs.references.map((row) => row.mediaType);
  assert.deepStrictEqual([...new Set(kinds)].sort(), ["audio", "image", "video"]);
}
/* 9. more references than the verified capability permits */
{
  const many = Array.from({ length: 11 }, (_, index) => ({
    key: `extra-${index}`, label: `Approved still ${index + 1}`, mediaType: "image", role: "reference", url: `/x${index}.png`,
  }));
  const plan = compile("r2v", [REF_IDENTITY, ...many]);
  assert.strictEqual(plan.inputs.references.length, 9, "MiniMax documents nine reference images");
  assert(warnedAbout(plan, /reference-over-limit/), "the excess warns");
  assert.strictEqual(plan.warnings.filter((row) => row.code === "reference-over-limit").length, 3,
    "one warning per dropped reference; nothing is discarded silently");
  assert(plan.inputs.references.some((row) => row.role === "identity"),
    "a required role is kept in preference to an influence");
}
/* A required role wins even when it sorts LAST in canonical order — which is the case
   that a plain first-come cut would get wrong. Voice sits late among the roles, so a
   full audio slate must still keep it. */
{
  const chatter = Array.from({ length: 3 }, (_, index) => ({
    key: `amb-${index}`, label: `Ambience bed ${index + 1}`, mediaType: "audio", role: "sound-reference", url: `/a${index}.wav`,
  }));
  const plan = compile("r2v", [REF_IDENTITY, ...chatter, REF_VOICE]);
  assert(plan.inputs.references.some((row) => row.role === "voice"), "the voice reference survives a full audio slate");
  assert.strictEqual(plan.inputs.references.filter((row) => row.mediaType === "audio").length, 3);
  assert(warnedAbout(plan, /reference-over-limit/), "and the influence that lost its slot is named");
}
/* 10. unsupported reference modality */
{
  const plan = compile("i2v", [FRAME_A, REF_VOICE]);
  assert(warnedAbout(plan, /reference-(role-unsupported|over-limit)/), "FL2VA takes no audio; the refusal is explicit");
  assert(!plan.inputs.references.some((row) => row.mediaType === "audio"));
}
/* 11. raw identifiers embedded in source entity structures — covered in block F. */
/* 12. empty optional fields */
{
  const spec = baseSpec({
    performance: { emotion: "", facial: "", bodyLanguage: "", gaze: "", movementIntensity: "" },
    stagingLines: [], visualStyle: [], productionRisks: [], environmentMotion: [],
    audio: { ...baseSpec().audio, music: "", silence: "", priorities: "", ambience: "" },
  });
  const plan = compile("t2v", [], { spec });
  for (const absent of ["performance.emotion", "staging", "style.visual", "sound.music"])
    assert(!covered(plan, absent), `${absent} is blank and must not be explained`);
  assert(!/\n\n\n/.test(plan.inputs.prompt), "and no empty section is emitted");
}
/* 12b. a duration outside the model's documented range is snapped, warned about, and the
   plan agrees with itself about which number will be rendered. */
{
  const plan = compile("t2v", [], { spec: baseSpec({ durationSeconds: 2 }) });
  assert.strictEqual(plan.output.durationSeconds, 4, "MiniMax documents a four-second floor");
  assert.strictEqual(plan.settings.extensions["minimax-h3/fl2va"].duration, 4, "and the parameter matches the plan");
  assert(warnedAbout(plan, /duration-adjusted/), "the adjustment is stated, not applied silently");
  assert(carries(plan, "4-second"), "and the prompt describes the shot that will exist");
}
/* Compile-and-validate is the same result with the contract enforced rather than merely
   available. */
{
  const { plan, validation } = Compiler.compileValidatedGenerationPlan({
    spec: baseSpec(), references: [FRAME_A, FRAME_B], mode: "flf",
    modelId: modelIdFor("flf"), capability: capabilityFor("flf"), surface: "api",
  });
  assert(validation.ok, JSON.stringify(validation.errors));
  assert.deepStrictEqual(plan, compile("flf", [FRAME_A, FRAME_B]));
}
/* 13. contradictory timing */
{
  const spec = baseSpec({
    actions: [
      { start: 0, end: 8, action: "Kai crosses the chalk line." },
      { start: 0, end: 8, action: "He lowers the parcel." },
      { start: 0, end: 8, action: "He steps back." },
    ],
  });
  const plan = compile("t2v", [], { spec });
  const stamps = [...plan.inputs.prompt.matchAll(/At (\d+\.\d\d)s,/g)].map((match) => Number(match[1]));
  assert.strictEqual(stamps.length, 2, "three beats, two of which need a time");
  assert(stamps[1] > stamps[0], "beat times must strictly increase even when every declared window is identical");
  for (const beat of ["crosses the chalk line", "lowers the parcel", "steps back"]) assert(carries(plan, beat));
}
/* 14 & 15 — seed supported and unsupported — covered in block 5. */
/* 16. compiled twice with identical input — covered in block 6. */
/* 17. the assistant subsystem is off */
{
  const previous = process.env.CINEBRAID_LOCAL_AI;
  process.env.CINEBRAID_LOCAL_AI = "off";
  try {
    const plan = compile("flf", [FRAME_A, FRAME_B]);
    assert(plan.inputs.prompt.length > 200, "a complete baseline plan compiles with no assistant available");
    assert(plan.endpoints.lastFrame, "including its endpoint contract");
  } finally {
    if (previous === undefined) delete process.env.CINEBRAID_LOCAL_AI;
    else process.env.CINEBRAID_LOCAL_AI = previous;
  }
}
/* 18. offline — structural, covered in block 6. */
/* 19. local and hosted differ — covered in block 7. */
/* 20. a fact with no evidence — covered in block 9. */

/* ---- the contract refuses a plan that leaks an identifier, whatever produced it ---- */
{
  const plan = compile("i2v", [FRAME_A]);
  const tampered = { ...plan, inputs: { ...plan.inputs, prompt: `${plan.inputs.prompt}\nSubject: ${KAI}` } };
  const validation = Contracts.validateGenerationPlan(tampered);
  assert(!validation.ok && validation.errors.some((error) => error.code === "internal-identifier-in-prompt"),
    "the contract, not only the compiler, refuses an identifier in model-facing text");
}
/* ---- and a plan whose provider transport leaked into intent ---- */
{
  const plan = compile("i2v", [FRAME_A]);
  const tampered = { ...plan, inputs: { ...plan.inputs, endpoint: "https://queue.fal.run/minimax/h3" } };
  assert(!Contracts.validateGenerationPlan(tampered).ok, "a plan is still production intent and stays provider-neutral");
}

console.log(
  "Generation compiler suite passed: every audit defect reproduced as a regression, four modes compiling to four "
  + "materially different contracts, first and last frames bound by role rather than array position, intent coverage "
  + "complete with no silent loss, references carrying production roles with every refusal named, a generic seed "
  + "surviving compile to job to provenance while H3's absent seed is refused honestly, model facts kept apart from "
  + "fal's and from the open-weight surface, and identical input compiling byte-identically with no clock, network "
  + "or assistant.",
);

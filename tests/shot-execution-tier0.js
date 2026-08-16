/* Shot Execution — Tier 0.
 *
 * Four corrections, each closing a defect that was live and verified at a7b4b8d. They
 * share a suite because they share one premise: CineBraid could not act on facts it
 * could not see, and in three places it was manufacturing a fact it had never been told.
 *
 *   T0-1  six filmmaking facts had no row in the compiler's intent inventory, so they
 *         could not be carried, verified, or reported as unsupported
 *   T0-2  `t2v` was not a clip kind, so a text-to-video shot was coerced to `i2v` and
 *         made to wait for a paid still and a human approval it never needed
 *   T0-3  a dialogue line existing MADE lip sync required, at two independent sites
 *   T0-4  four provider parameters were left at provider defaults, and the defaults are
 *         wrong for CineBraid's use — one of them silently rewrites the prompt
 *
 * The assertions are behavioural rather than textual. Asserting that a source file
 * contains the string "t2v" proves an edit happened; asserting that a t2v clip survives
 * normalisation, is refused a start frame, and does not gate on an approved still proves
 * the thing the edit was for.
 *
 * No provider is contacted and nothing is written to disk.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const Compiler = require("../generation-compiler");
const Contracts = require("../generation-contracts");
const { deriveLipSync, lipSyncRequiredFrom, CINEBRAID_LIP_SYNC_LEVELS } = require("../public/shared-lip-sync");
const { serializeH3PlanForFal, resolveH3FalCapability } = require("../fal-h3-backend");
const H3 = require("../model-packs/minimax-h3");
const F = require("./generation-compiler-fixture");
const { render, buildFixture } = require("./render-harness");

const { baseSpec, capabilityFor, modelIdFor, covered, state, FRAME_A } = F;

const ROOT = path.join(__dirname, "..");
const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

/* server.js exports nothing and starts listening on load, so its import normalisers are
   reached the way every other suite in this repository reaches one: the declaration is
   lifted out of the real file and evaluated in a sandbox. The file is opened read-only.
   This is deliberately NOT a re-implementation — a copy of the rule under test would
   pass while the shipped rule stayed broken, which is the exact failure mode that let
   the same bad derivation exist at two sites for as long as it did. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js no longer declares ${name}; this proof must be updated, not deleted`);
  /* The body is found after the parameter list CLOSES, not at the first brace. A default
     like `shotAudio = {}` is a brace that opens and shuts before the body begins, and
     counting from there returns a two-character "function" that fails to parse — which
     is a confusing way to learn that the extraction, not the product, is broken. */
  let parens = 0, bodyStart = -1;
  for (let index = source.indexOf("(", start); index < source.length; index++) {
    if (source[index] === "(") parens++;
    else if (source[index] === ")") {
      parens--;
      if (parens === 0) { bodyStart = source.indexOf("{", index); break; }
    }
  }
  assert(bodyStart > 0, `could not find the body of ${name} in server.js`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    const character = source[index];
    if (character === "{") { depth++; continue; }
    if (character === "}") { depth--; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`could not find the end of ${name} in server.js`);
}

/* The import normalisers, running as shipped. Only their own helpers and the shared
   derivation are supplied; nothing else from server.js is reachable, so a normaliser
   that started reading global state would fail here rather than pass quietly. */
function builderNormalisers() {
  const context = vm.createContext({ deriveLipSync, lipSyncRequiredFrom });
  const declarations = [
    "builderObject", "builderArray", "builderNumber", "builderLabel",
    "normalizeBuilderMotionBrief", "normalizeBuilderClips",
  ].map((name) => extractFunction(SERVER_SOURCE, name)).join("\n");
  vm.runInContext(
    `${declarations}\nglobalThis.__brief = normalizeBuilderMotionBrief;\nglobalThis.__clips = normalizeBuilderClips;`,
    context,
  );
  return { motionBrief: context.__brief, clips: context.__clips };
}

/* The six facts T0-1 made visible, with the vocabulary the research settled on. */
const TIER0_INTENTS = [
  "editorial",
  "endpoints.start",
  "endpoints.end",
  "performance.lipSync",
  "interaction",
  "subjects.count",
];

/* A shot that carries every one of them, so a suite can ask what happened to each. */
function executionSpec(overrides = {}) {
  return baseSpec({
    editorial: "single-take",
    endpoints: { start: "exact", end: "approximate" },
    interaction: "precise",
    promptEntities: [
      { id: "CHAR-KAI-8f21c4d6", name: "Kai", type: "character", descriptor: "Kai" },
      { id: "CHAR-MARA-3d90ab", name: "Mara", type: "character", descriptor: "Mara" },
    ],
    audio: { ...baseSpec().audio, lipSyncRequired: true },
    ...overrides,
  });
}

function compile(mode, references, options = {}) {
  const plan = Compiler.compileGenerationPlan({
    spec: options.spec || executionSpec(),
    references,
    mode,
    modelId: modelIdFor(mode),
    surface: "api",
    capability: options.capability || capabilityFor(mode),
    pack: options.pack,
    resolution: options.resolution,
  });
  if (!options.allowInvalid) {
    const validation = Contracts.validateGenerationPlan(plan);
    assert(validation.ok, `${mode} plan must satisfy the contract: ${JSON.stringify(validation.errors)}`);
  }
  return plan;
}

async function main() {
/* ===========================================================================
   T0-1 — the six facts are inventoried, carried and accounted for.

   The inventory is the whole definition: there is no second list, so a fact with no row
   cannot be carried into a request, cannot be verified against the finished prompt, and
   cannot be reported as unsupported. It simply stops existing between the shot and the
   model, which is the failure this compiler was built to make impossible. */
{
  const keys = Compiler.INTENT_FIELDS.map((row) => row.key);
  for (const intent of TIER0_INTENTS)
    assert(keys.includes(intent), `${intent} must have a row in the one intent inventory`);
  assert.strictEqual(new Set(keys).size, keys.length, "no intent may be inventoried twice");
  for (const row of Compiler.INTENT_FIELDS)
    assert(row.label && typeof row.read === "function",
      `${row.key} must carry a filmmaker-readable label and a reader`);
}

/* Each one reaches the inventory with the shot's own value. */
{
  const inventory = Compiler.inventoryIntent(executionSpec(), (value) => String(value));
  const byKey = Object.fromEntries(inventory.map((row) => [row.key, row.value]));
  assert.strictEqual(byKey["editorial"], "single-take");
  assert.strictEqual(byKey["endpoints.start"], "exact");
  assert.strictEqual(byKey["endpoints.end"], "approximate");
  assert.strictEqual(byKey["interaction"], "precise");
  assert.strictEqual(byKey["performance.lipSync"], "critical", "an explicit requirement is critical, not a boolean");
  assert.strictEqual(byKey["subjects.count"], "2", "subject count is counted from who this frame may depict");
}

/* And each one ends in exactly one recorded coverage state on a real compiled plan. */
{
  for (const mode of ["t2v", "i2v", "flf", "r2v"]) {
    const references = mode === "i2v" ? [F.FRAME_A]
      : mode === "flf" ? [F.FRAME_A, F.FRAME_B]
        : mode === "r2v" ? [F.REF_IDENTITY, F.REF_LOCATION]
          : [];
    const plan = compile(mode, references);
    for (const intent of TIER0_INTENTS) {
      const row = covered(plan, intent);
      assert(row, `${mode}: ${intent} is set on this shot and must appear in coverage`);
      assert(["represented", "anchored", "omitted-by-design", "unsupported"].includes(row.state),
        `${mode}: ${intent} must land in a real state, not ${row.state}`);
    }
  }
}

/* AN ABSENT FACT IS NOT INTENT. A shot that never declared an editorial form is not
   asked to explain why it did not express one, and no convenient default is invented to
   fill the row — which is the whole reason these are readers rather than defaults. */
{
  const plain = baseSpec();
  const inventory = Compiler.inventoryIntent(plain, (value) => String(value));
  const keys = inventory.map((row) => row.key);
  for (const intent of ["editorial", "endpoints.start", "endpoints.end", "interaction"])
    assert(!keys.includes(intent), `${intent} is unstated on this shot and must stay unknown, not be defaulted`);
  const plan = compile("i2v", [FRAME_A], { spec: plain });
  for (const intent of ["editorial", "endpoints.start", "endpoints.end", "interaction"])
    assert(!covered(plan, intent), `${intent} was never declared and must not appear in coverage`);
}

/* THE BACKSTOP, which is the reason the rows are worth adding at all: a pack that does
   not represent one of them produces a visible gap and a warning naming the field,
   rather than a quietly shorter prompt. Proven against a pack that claims nothing. */
{
  const silent = {
    packId: "tier0-silent",
    packVersion: "1.0.0",
    models: { "minimax-h3/fl2va": {} },
    compileMode: () => ({ prompt: "A shot.", parameters: {}, output: {} }),
  };
  const plan = compile("i2v", [FRAME_A], { pack: silent, allowInvalid: true });
  for (const intent of TIER0_INTENTS) {
    assert.strictEqual(state(plan, intent), "unsupported",
      `${intent} must be reported unsupported when no pack claims it`);
    const warning = plan.warnings.find((row) => row.intent === intent);
    assert(warning && warning.code === "intent-unaccounted",
      `${intent} must warn by name, not disappear`);
    assert(warning.field === intent && warning.message.trim() && warning.action.trim(),
      `${intent}'s warning must name the field and say what to do`);
  }
}

/* TWO OF THE SIX ARE DERIVED AND PRESENT ON ALMOST EVERY SHOT, so a permanent warning
   about them would be noise on every dialogue shot and every shot with a character —
   and a warning channel that is always full is one nobody reads. MiniMax H3 has no
   control for either, and says so once, with a reason, rather than raising it. */
{
  const plan = compile("i2v", [FRAME_A]);
  for (const intent of ["subjects.count", "performance.lipSync"]) {
    assert.strictEqual(state(plan, intent), "omitted-by-design",
      `MiniMax H3 has no control for ${intent} and must say so with a reason`);
    assert(covered(plan, intent).reason.trim(), `${intent} must record WHY, or the record is decoration`);
    assert(!plan.warnings.some((row) => row.intent === intent),
      `${intent} is accounted for and must not also raise a note on every shot`);
  }
}

/* THE OTHER FOUR ARE DECLARED, NEVER DERIVED. A shot only carries them because someone
   recorded a decision, and MiniMax H3 has no control for any of them — no internal-cut
   flag, no endpoint contract, no interaction control. So an explicit decision that this
   route cannot honour is reported as unsupported and named, which is a sentence worth
   showing a filmmaker: it is something they asked for and will not get. */
{
  const plan = compile("i2v", [FRAME_A]);
  for (const intent of ["editorial", "endpoints.start", "endpoints.end", "interaction"]) {
    assert.strictEqual(state(plan, intent), "unsupported",
      `${intent} was explicitly declared and H3 cannot carry it; that must be stated`);
    const warning = plan.warnings.find((row) => row.intent === intent);
    assert(warning && warning.field === intent, `${intent} must warn by name rather than disappear`);
  }
  /* And a shot that declared none of them is silent about all four, so the reporting
     above can never become background noise. */
  const plain = compile("i2v", [FRAME_A], { spec: baseSpec() });
  assert(!plain.warnings.some((row) => row.code === "intent-unaccounted"),
    `an ordinary shot must raise no unaccounted-intent note: ${JSON.stringify(plain.warnings)}`);
}

/* ===========================================================================
   T0-3 — a dialogue line existing does not make lip sync required.

   Kept before T0-2 because the inventory row above reads this derivation, and because
   the two former derivation sites are the reason it exists. */
{
  assert.deepStrictEqual([...CINEBRAID_LIP_SYNC_LEVELS], ["none", "implied", "critical"]);

  /* No line: nothing to synchronise. */
  assert.strictEqual(deriveLipSync({ line: "" }), "none");
  assert.strictEqual(deriveLipSync({}), "none");
  assert.strictEqual(deriveLipSync(null), "none");

  /* Visible, on-camera speech the production actually declared. */
  assert.strictEqual(deriveLipSync({ line: "It's done.", lipSyncRequired: true }), "critical");

  /* AN OFF-SCREEN LINE. This is the case the old rule got wrong on every shot: the
     speaker is not in frame, and CineBraid asserted the mouth had to match. */
  assert.strictEqual(deriveLipSync({ line: "Bravo two, hold position." }), "implied",
    "a line alone establishes that audio exists, never that lip sync is critical");

  /* Back-to-camera, and every other delivery where visibility was never established. */
  assert.strictEqual(deriveLipSync({ line: "Don't follow me.", lipSyncRequired: false }), "implied",
    "an unestablished requirement is implied, not silently promoted or dropped");

  /* An explicit tri-state outranks the legacy boolean in both directions, which is what
     makes the value recordable at all. */
  assert.strictEqual(deriveLipSync({ line: "x", lipSync: "none", lipSyncRequired: true }), "none");
  assert.strictEqual(deriveLipSync({ line: "x", lipSync: "critical", lipSyncRequired: false }), "critical");
  assert.strictEqual(deriveLipSync({ line: "x", lipSync: "nonsense" }), "implied",
    "an unrecognised level is not authority; it falls through to what is established");

  /* The boolean-compatible accessor, so nothing downstream had to be rewritten on the
     same day. `implied` reads as NOT required, which is the safe direction. */
  assert.strictEqual(lipSyncRequiredFrom({ line: "x", lipSyncRequired: true }), true);
  assert.strictEqual(lipSyncRequiredFrom({ line: "x" }), false);
  assert.strictEqual(lipSyncRequiredFrom({ line: "" }), false);

  /* NO DIALOGUE-ONLY SHORTCUT SURVIVES anywhere. The rule was written twice, so the
     regression checks for it twice rather than trusting that one repair found both. */
  for (const file of ["server.js", "public/motion-sound-composer.js"]) {
    /* Comments stripped first, so the prose explaining why the rule was removed is not
       mistaken for the rule. */
    const source = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"));
    assert(!/lipSync\w*\s*:[^,;\n]*\|\|\s*!!\s*line/.test(source),
      `${file} must not derive a lip-sync requirement from line presence`);
    assert(/\b(deriveLipSync|lipSyncRequiredFrom)\(/.test(source),
      `${file} must read the one shared derivation rather than compute its own`);
  }
}

/* THE TWO FORMER DERIVATION SITES MUST AGREE. They drifted apart by being written twice;
   the property that stops it happening again is that identical input produces an
   identical answer at both, exercised through the real functions rather than a copy. */
{
  const cases = [
    { line: "", lipSyncRequired: false },
    { line: "It's done.", lipSyncRequired: true },
    { line: "Bravo two, hold position." },
    { line: "Don't follow me.", lipSyncRequired: false },
    { line: "x", lipSync: "implied", lipSyncRequired: true },
  ];

  /* The server's import normaliser, running as shipped. */
  const normaliseOnServer = builderNormalisers().motionBrief;

  /* The browser composer, driven through its real entry point in the loaded page scope
     rather than by calling the shared module twice — which would compare the derivation
     with itself and prove nothing about either site. */
  const page = await render("#/production", buildFixture());
  for (const dialogue of cases) {
    const expected = deriveLipSync(dialogue);
    const onServer = normaliseOnServer({ motionBrief: { dialogue } }, {}, 5).dialogue;
    const inBrowser = vm.runInContext(`(() => {
      const shot = (P.shots || [])[0], unit = (shot.clips || [])[0];
      unit.motionBrief = { dialogue: ${JSON.stringify(dialogue)} };
      setMotionSoundField(shot.id, unit.id, "dialogue", "language", "English");
      const produced = unit.motionBrief.dialogue;
      return { level: deriveLipSync(produced), required: produced.lipSyncRequired };
    })()`, page.context);
    assert.strictEqual(inBrowser.level, expected,
      `the composer's brief must read ${expected} for ${JSON.stringify(dialogue)}`);
    assert.strictEqual(deriveLipSync(onServer), expected,
      `the imported brief must read ${expected} for ${JSON.stringify(dialogue)}`);
    assert.strictEqual(onServer.lipSyncRequired, expected === "critical",
      "the legacy boolean stays consistent with the level it now reports");
    assert.strictEqual(inBrowser.required, onServer.lipSyncRequired,
      `the two former derivation sites must not drift apart for ${JSON.stringify(dialogue)}`);
  }
}

/* MIGRATION: NOTHING STORED IS REWRITTEN.
 *
 * A stored `lipSyncRequired: true` cannot be trusted as a filmmaker's decision, because
 * the import normaliser wrote exactly that value into durable project data whenever a
 * line existed. So the tri-state is derived on read and no stored byte is converted —
 * an existing project keeps what it had, and nothing retroactively invents `implied`
 * for a shot that could never express it. */
{
  const normalise = builderNormalisers().motionBrief;
  const legacy = { motionBrief: { dialogue: { line: "It's done.", lipSyncRequired: true } } };
  const before = JSON.stringify(legacy);
  const brief = normalise(legacy, {}, 5);
  assert.strictEqual(JSON.stringify(legacy), before, "normalising must not mutate the supplied project data");
  assert.strictEqual(brief.dialogue.lipSyncRequired, true, "an explicit stored requirement survives unchanged");
  assert.strictEqual(brief.dialogue.lipSync, "", "no level is written into the record it did not have");
  assert.strictEqual(deriveLipSync(brief.dialogue), "critical", "and it still READS as critical, derived rather than stored");

  /* The case the old rule manufactured: a line with no recorded requirement. It must no
     longer come back as `true`, and it must not be recorded as a hard requirement. */
  const manufactured = normalise({ motionBrief: { dialogue: { line: "Bravo two, hold position." } } }, {}, 5);
  assert.strictEqual(manufactured.dialogue.lipSyncRequired, false,
    "a line with no recorded requirement must not be written back as one");
  assert.strictEqual(manufactured.dialogue.lipSync, "",
    "and a level the document never declared must not be manufactured into it either");

  /* A level the source DID declare travels through untouched, because that is a
     recorded decision rather than a derived one. */
  const declared = normalise({ motionBrief: { dialogue: { line: "It's done.", lipSync: "implied" } } }, {}, 5);
  assert.strictEqual(declared.dialogue.lipSync, "implied");
  assert.strictEqual(declared.dialogue.lipSyncRequired, false, "and the boolean follows the level it declares");
}

/* THE DERIVED LEVEL IS NEVER WRITTEN BACK INTO THE FIELD THE DERIVATION TRUSTS.
 *
 * `lipSync` outranks the boolean — that is what makes an explicit `none` on a shot with
 * a line expressible at all. Storing the DERIVED answer there would therefore pin the
 * control: once a level had been written, the requirement checkbox would set its boolean
 * and change nothing, because the stored level wins. So the brief preserves a declared
 * level and derives everything else on read, and unticking still takes effect. */
{
  const page = await render("#/production", buildFixture());
  const outcome = vm.runInContext(`(() => {
    const shot = (P.shots || [])[0];
    const unit = (shot.clips || [])[0];
    unit.motionBrief = { dialogue: { line: "It's done." } };
    setMotionSoundField(shot.id, unit.id, "dialogue", "lipSyncRequired", true);
    const ticked = { level: deriveLipSync(unit.motionBrief.dialogue), stored: unit.motionBrief.dialogue.lipSync, flag: unit.motionBrief.dialogue.lipSyncRequired };
    setMotionSoundField(shot.id, unit.id, "dialogue", "lipSyncRequired", false);
    const unticked = { level: deriveLipSync(unit.motionBrief.dialogue), stored: unit.motionBrief.dialogue.lipSync, flag: unit.motionBrief.dialogue.lipSyncRequired };
    return { ticked, unticked };
  })()`, page.context);
  assert.strictEqual(outcome.ticked.level, "critical", "ticking the requirement makes visible speech critical");
  assert.strictEqual(outcome.ticked.stored, "", "and stores no level, so nothing is pinned");
  assert.strictEqual(outcome.unticked.level, "implied", "unticking must take effect rather than be outranked");
  assert.strictEqual(outcome.unticked.flag, false);
}

/* ===========================================================================
   T0-2 — `t2v` is a real clip kind.

   The adapter already dispatched it and the still-gate already exempted it. The only
   missing piece was the enum member, and its absence coerced every atmosphere,
   establishing and B-roll shot into i2v — which then demanded a paid still and a human
   approval the shot never needed. The blast radius is the frame gates, not the enum. */
{
  const page = await render("#/production", buildFixture());
  const result = vm.runInContext(`(() => {
    const shot = {
      id: "SH-T2V", title: "Storm front", desc: "A storm front crosses the ridge.",
      keyframes: [{ id: "frame-a", label: "A", winner: "", required: true }],
      clips: [{ id: "seg-t2v", suffix: "a", label: "A", kind: "t2v", dur: 6, motionPrompt: "The storm front crosses the ridge.", fromFrame: "", toFrame: "" }],
      audio: {},
    };
    normalizeShotV5(shot);
    return { kind: shot.clips[0].kind, fromFrame: shot.clips[0].fromFrame, toFrame: shot.clips[0].toFrame };
  })()`, page.context);
  assert.strictEqual(result.kind, "t2v", "a t2v clip must survive normalisation as t2v, not be coerced to i2v");
  assert.strictEqual(result.fromFrame, "", "text-to-video begins from no frame and must not be handed one");
  assert.strictEqual(result.toFrame, "");

  /* The gate that would demand an approved still already reads from the MODE and already
     exempts t2v. Asserting it stays that way is the point: the enum member is only safe
     because this answer is false. */
  assert.strictEqual(vm.runInContext(`guidedVideoModeNeedsApprovedStill("t2v")`, page.context), false);
  for (const mode of ["i2v", "flf", "r2v"])
    assert.strictEqual(vm.runInContext(`guidedVideoModeNeedsApprovedStill(${JSON.stringify(mode)})`, page.context), true,
      `${mode} still needs an approved still and must be unaffected`);

  /* AND THE EXISTING KINDS ARE UNTOUCHED — including the coercion itself, which must
     still catch a kind that really is unknown rather than being weakened to let t2v
     through. */
  const others = vm.runInContext(`(() => {
    const out = {};
    for (const kind of ["i2v", "flf", "r2v", "plan", "post", "reuse", "wormhole"]) {
      const shot = {
        id: "SH-" + kind, keyframes: [{ id: "frame-a", label: "A", winner: "w.png", required: true }],
        clips: [{ id: "seg-" + kind, suffix: "a", label: "A", kind, dur: 5, motionPrompt: "Movement.", fromFrame: "", toFrame: "" }],
        audio: {},
      };
      normalizeShotV5(shot);
      out[kind] = { kind: shot.clips[0].kind, fromFrame: shot.clips[0].fromFrame };
    }
    return out;
  })()`, page.context);
  for (const kind of ["i2v", "flf", "r2v", "plan", "post", "reuse"])
    assert.strictEqual(others[kind].kind, kind, `${kind} must still survive normalisation unchanged`);
  assert.strictEqual(others.wormhole.kind, "i2v", "a genuinely unknown kind is still coerced");
  assert.strictEqual(others.i2v.fromFrame, "frame-a", "i2v still receives its start frame");
  assert.strictEqual(others.flf.fromFrame, "frame-a", "flf still receives its start frame");
}

/* The import path has its own copy of the vocabulary, and it is the one that decides
   what a Project Builder document is allowed to say. It coerced t2v to `plan` — a
   planning-only unit that cannot generate at all — with a warning saying the kind was
   unknown. */
{
  const normaliseClips = builderNormalisers().clips;
  const warnings = [];
  const clips = normaliseClips(
    { id: "SH-T2V", clips: [{ id: "SH-T2V-M01", kind: "t2v", dur: 6, motionPrompt: "The storm front crosses the ridge." }] },
    [{ id: "SH-T2V-A" }],
    warnings,
  );
  assert.strictEqual(clips[0].kind, "t2v", "an imported t2v unit must survive import as t2v");
  assert.strictEqual(clips[0].fromFrame, "", "and must not be linked to a starting frame it cannot use");
  assert(!warnings.some((row) => /unknown kind/i.test(row)),
    `t2v is a known kind and importing one must not warn: ${JSON.stringify(warnings)}`);

  const unknown = [];
  const coerced = normaliseClips(
    { id: "SH-X", clips: [{ id: "SH-X-M01", kind: "wormhole", dur: 5 }] },
    [{ id: "SH-X-A" }],
    unknown,
  );
  assert.strictEqual(coerced[0].kind, "plan", "a genuinely unknown kind is still refused");
  assert(unknown.some((row) => /unknown kind/i.test(row)), "and still says so");
}

/* ===========================================================================
   T0-4 — the provider parameters CineBraid was leaving at provider defaults.

   Every assertion here reads the SERIALISED REQUEST. Local configuration state proves
   the value was chosen; only the request proves it will be sent, and the whole class of
   defect is a value that exists everywhere except in the payload. */
{
  const plan = compile("i2v", [FRAME_A]);
  const capability = resolveH3FalCapability("i2v", H3.capabilityLayer("i2v", "api"));
  const request = serializeH3PlanForFal(plan, capability, { resolveReference: (row) => `https://x/${row.refId}` });

  /* T0-4a — PROMPT EXPANSION. fal's H3 endpoints default `enable_prompt_expansion` to
     true: a vision-language model rewrites the prompt before generation, and the
     rewritten text is not returned. Every claim CineBraid makes about its own compiler
     is unverifiable while that is on. */
  assert.strictEqual(request.input.enable_prompt_expansion, false,
    "prompt expansion must be explicitly off in the serialised request, not merely intended");
  assert(Object.prototype.hasOwnProperty.call(request.input, "enable_prompt_expansion"),
    "omitting the field is not the same as switching it off; fal's default is on");

  /* T0-4d — RESOLUTION. fal defaults to 2K on this endpoint. A request that omits it
     inherits that, which is a cost and a quality decision nobody made. */
  assert(request.input.resolution, "resolution must be sent explicitly rather than inherited");
  assert(capability.resolutions.includes(request.input.resolution),
    `${request.input.resolution} must be one the resolved capability allows`);
}

/* Every mode, because the flag is on every endpoint and a mode that forgot it would be
   the one shot nobody could reason about. */
{
  for (const [mode, references] of [
    ["t2v", []],
    ["i2v", [F.FRAME_A]],
    ["flf", [F.FRAME_A, F.FRAME_B]],
    ["r2v", [F.REF_IDENTITY, F.REF_LOCATION]],
  ]) {
    const plan = compile(mode, references);
    const capability = resolveH3FalCapability(mode, H3.capabilityLayer(mode, "api"));
    const request = serializeH3PlanForFal(plan, capability, { resolveReference: (row) => `https://x/${row.refId}` });
    assert.strictEqual(request.input.enable_prompt_expansion, false, `${mode} must switch prompt expansion off`);
    assert(request.input.resolution, `${mode} must send an explicit resolution`);
  }
}

/* T0-4d — AND THE CAPABILITY STILL WINS. Setting resolution deliberately must not become
   a universal assumption that overrides what this model in this mode can actually
   render: the open-weight surface offers 768P only, and asking for 2K there is answered
   with 768P and a stated substitution rather than a request fal would refuse. */
{
  const plan = Compiler.compileGenerationPlan({
    spec: executionSpec(),
    references: [],
    mode: "t2v",
    modelId: modelIdFor("t2v"),
    surface: "local",
    capability: capabilityFor("t2v", "local"),
    resolution: "2K",
  });
  const extensions = plan.settings.extensions[modelIdFor("t2v")];
  assert.strictEqual(extensions.resolution, "768P", "the surface's own ceiling still decides");
  assert(plan.warnings.some((row) => row.code === "resolution-unsupported"),
    "and the substitution is stated rather than performed silently");
}

/* T0-4c — AUDIO IS EXPLICIT PER ROUTE, and on this route being explicit means sending
   nothing. fal publishes no audio field on any MiniMax H3 endpoint, so a `generate_audio`
   flag here would be an invented parameter — the distinction the correction has to
   preserve is between "switch it off" and "this route has no such switch". */
{
  const silent = executionSpec({ audio: { ...baseSpec().audio, mode: "silent", dialogue: "", music: "", ambience: "", sfx: "" } });
  const plan = compile("i2v", [FRAME_A], { spec: silent });
  const capability = resolveH3FalCapability("i2v", H3.capabilityLayer("i2v", "api"));
  const request = serializeH3PlanForFal(plan, capability, { resolveReference: (row) => `https://x/${row.refId}` });
  for (const field of ["generate_audio", "audio", "enable_audio", "with_audio"])
    assert(!(field in request.input),
      `MiniMax H3 publishes no ${field}; sending one would be inventing a parameter fal never offered`);
  /* What the route CAN say about audio is said where it is true — on the plan's output
     block, which records that this model produces sound natively. */
  assert.strictEqual(plan.output.audio, "native", "the route's real audio behaviour stays recorded on the plan");
}

console.log(
  "Shot Execution Tier 0 passed: six filmmaking facts inventoried, carried and accounted for with unknowns left unknown; "
  + "a dialogue line no longer manufactures a lip-sync requirement at either former site and nothing stored is rewritten; "
  + "t2v survives normalisation and import as t2v, is refused a start frame and gates on no approved still; "
  + "and the serialised fal request carries prompt expansion off and an explicit, capability-bounded resolution. "
  + "Provider calls made: 0.",
);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

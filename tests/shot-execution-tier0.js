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

  /* The local start-frame predicate applies only to endpoint-driven modes. Canonical
     readiness separately enforces reference-driven inputs. */
  assert.strictEqual(vm.runInContext(`guidedVideoModeNeedsApprovedStill("t2v")`, page.context), false);
  assert.strictEqual(vm.runInContext(`guidedVideoModeNeedsApprovedStill("r2v")`, page.context), false,
    "reference-driven motion requires references, not an unrelated approved start frame");
  for (const mode of ["i2v", "flf"])
    assert.strictEqual(vm.runInContext(`guidedVideoModeNeedsApprovedStill(${JSON.stringify(mode)})`, page.context), true,
      `${mode} still requires its approved start-frame input`);

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

/* AND THE CONTRACT THE MODEL IS GIVEN HAS TO ADMIT IT TOO.
 *
 * The importer accepted `t2v` while the canonical schema's enum did not, so the one
 * document a filmmaker hands an external model declared a valid text-to-video plan
 * invalid. Half a repair reads as a whole one from either side alone. */
{
  const schema = JSON.parse(fs.readFileSync(
    path.join(ROOT, "resources", "project-builder", "CINEBRAID_PROJECT_SCHEMA.json"), "utf8"));
  const kinds = schema.$defs.clip.properties.kind.enum;
  assert(kinds.includes("t2v"), "the Project Builder schema must admit the kind its own importer accepts");
  const framed = schema.$defs.clip.allOf
    .filter((branch) => branch.then?.required?.includes("fromFrame"))
    .flatMap((branch) => branch.if.properties.kind.enum || [branch.if.properties.kind.const]);
  assert(!framed.includes("t2v"), "and must not then require the frame t2v begins without");
}

/* AN OMITTED KIND IS NOT A DECISION EITHER.
 *
 * `String(source.kind || "i2v")` was the other half of the same mistake, and the
 * quieter one: a document that named no generation method at all was imported as one
 * that had named image-to-video, which then demanded an approved still and a paid
 * generation nobody had asked for. No warning was possible, because by the time the
 * unknown-kind branch ran the value was already `i2v` — a known kind.
 *
 * Absence and an unreadable value are different facts, said differently, and both end
 * at `plan`: frameless, generating nothing, and the filmmaker's decision to make. */
{
  const normaliseClips = builderNormalisers().clips;
  for (const [label, unit] of [
    ["an omitted kind", { id: "SH-M-M01", dur: 5, motionPrompt: "She turns." }],
    ["a blank kind", { id: "SH-M-M01", kind: "", dur: 5, motionPrompt: "She turns." }],
    ["a whitespace kind", { id: "SH-M-M01", kind: "   ", dur: 5, motionPrompt: "She turns." }],
  ]) {
    const warnings = [];
    const clips = normaliseClips({ id: "SH-M", clips: [unit] }, [{ id: "SH-M-A" }], warnings);
    assert.notStrictEqual(clips[0].kind, "i2v", `${label} must never come back as image-to-video`);
    assert.strictEqual(clips[0].kind, "plan", `${label} becomes planning-only, which generates nothing`);
    assert.strictEqual(clips[0].fromFrame, "",
      `${label} must not be handed a start frame; plan is frameless and the dependency is not real`);
    assert(warnings.some((row) => /named no generation method/i.test(row)),
      `${label} must be reported, not silently resolved: ${JSON.stringify(warnings)}`);
    assert(!warnings.some((row) => /unknown kind/i.test(row)),
      `${label} is absence, not an unreadable value, and must not be described as one`);
  }

  /* THE EXPLICIT KINDS ARE UNTOUCHED. Removing a default is only a repair if it did
     not also remove the answers people actually wrote down. */
  for (const [kind, frames, expectedFrame] of [
    ["i2v", [{ id: "SH-K-A" }], "SH-K-A"],
    ["t2v", [{ id: "SH-K-A" }], ""],
    ["hold", [{ id: "SH-K-A" }], "SH-K-A"],
    ["flf", [{ id: "SH-K-A" }, { id: "SH-K-B" }], "SH-K-A"],
    ["plan", [{ id: "SH-K-A" }], ""],
    ["post", [{ id: "SH-K-A" }], ""],
    ["reuse", [{ id: "SH-K-A" }], ""],
  ]) {
    const warnings = [];
    const clips = normaliseClips(
      { id: "SH-K", clips: [{ id: "SH-K-M01", kind, dur: 5, motionPrompt: "Movement." }] },
      frames, warnings,
    );
    assert.strictEqual(clips[0].kind, kind, `an explicit ${kind} unit must survive import unchanged`);
    assert.strictEqual(clips[0].fromFrame, expectedFrame, `${kind} start-frame handling must not have moved`);
    assert(!warnings.some((row) => /named no generation method|unknown kind/i.test(row)),
      `${kind} is a decision the document made and must not be questioned`);
  }

  /* Case is a dialect, not a different answer. */
  const shouted = [];
  assert.strictEqual(
    normaliseClips({ id: "SH-U", clips: [{ id: "SH-U-M01", kind: "T2V", dur: 5 }] }, [{ id: "SH-U-A" }], shouted)[0].kind,
    "t2v", "an uppercase kind is the same kind");
}

/* THE LIVE CONSUMERS, which normalisation and the mode helper do not reach.
 *
 * `normalizeShotV5` kept a t2v clip as t2v and `guidedVideoModeNeedsApprovedStill("t2v")`
 * answered false, and both were true while the shipped Motion path still behaved as
 * though t2v began from an approved still:
 *
 *   the motion-unit builder assigned `fromFrame` BEFORE the unit was identified as t2v,
 *   so the route was renamed after it had already been given a frame it cannot use;
 *   and the Motion panel applied its start-frame prerequisite unconditionally, so the
 *   one route in the picker that needs no frame was the one route nobody could open.
 *
 * Asserting a helper's return value could not have caught either. These drive the real
 * functions in the loaded page. */
{
  const project = buildFixture();
  project.shots[0].characters = [];
  project.shots[0].codes = [];
  project.shots[0].creationBrief = {};
  const page = await render("#/production", project);
  /* One case, fully reset: no approved still anywhere, no motion unit, and the route
     selected the way the picker selects it. */
  const install = `globalThis.__t2vCase = (mode) => {
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    shot.clips = [];
    shot.motionPrompt = "";
    shot.characters = [];
    shot.codes = [];
    if (["t2v", "i2v", "flf", "r2v"].includes(mode)) declareShotRoute(shot, mode);
    else clearShotRoute(shot);
    const c = ensureShotCreation(shot);
    c.activeMotionUnitId = "";
    const profile = (PROMPT_LIBRARY?.profiles || []).find((p) => p.mediaType === "video" && p.mode === mode) || null;
    c.motionProfileId = profile ? profile.id : "";
    const unit = ensureGuidedMotionUnit(shot, "", profile);
    const html = guidedMotionPanel(shot, null, []);
    return {
      selected: c.motionProfileId,
      kind: unit.kind,
      fromFrame: unit.fromFrame,
      locked: html.includes("guided-motion-card locked"),
      saysApproveFirst: html.includes("Approve required frames first"),
      pill: /guided-mode-pill[^>]*>([^<]*)</.exec(html)?.[1] || "",
    };
  };`;
  vm.runInContext(install, page.context);
  const probe = (mode) => vm.runInContext(`__t2vCase(${JSON.stringify(mode)})`, page.context);

  /* 1 + 2 — a t2v unit keeps its kind and is given no frame at all. */
  const t2v = probe("t2v");
  assert(t2v.selected, "a t2v profile must be selectable for this proof to mean anything");
  assert.strictEqual(t2v.kind, "t2v", "the selected route must survive unit construction");
  assert.strictEqual(t2v.fromFrame, "",
    "a t2v unit must not be handed a start frame; fal's t2v endpoint has no field to receive one");

  /* 3 + 4 — and the panel opens with no approved still anywhere on the shot. */
  assert.strictEqual(t2v.locked, false,
    "t2v must not be locked behind a start frame it never begins from");
  assert.strictEqual(t2v.saysApproveFirst, false, "and must not ask for one in words either");
  assert.strictEqual(t2v.pill, "NO FRAMES NEEDED",
    "an open panel must stop claiming a start frame is ready when none exists and none is needed");

  /* 5 — AND EVERY OTHER ROUTE IS EXACTLY AS IT WAS. Each still receives its start frame,
     and each is still held behind the approval it genuinely depends on. This is the half
     that makes the fix a correction rather than a hole in the gate. */
  for (const mode of ["i2v", "flf"]) {
    const row = probe(mode);
    assert.strictEqual(row.kind, mode, `${mode} must keep its kind`);
    assert(row.fromFrame, `${mode} begins from a frame and must still be given its endpoint`);
    assert.strictEqual(row.locked, true, `${mode} must stay blocked until its required frame is Canon`);
  }
  const r2v = probe("r2v");
  assert.strictEqual(r2v.kind, "r2v");
  assert.strictEqual(r2v.fromFrame, "", "reference-driven motion must not manufacture a start-frame requirement");
  assert.strictEqual(r2v.locked, true, "reference-driven Motion is blocked until its canonical reference exists");
  assert.strictEqual(r2v.saysApproveFirst, false, "the reference blocker must not be described as a frame blocker");

  /* 6 — an unknown route is treated as needing a frame, which is the safe direction:
     the gate is relaxed only where a route is known not to need one. */
  const unknown = probe("wormhole");
  assert.strictEqual(unknown.selected, "", "no profile exists for an unknown mode");
  assert(unknown.fromFrame, "an unrecognised route keeps the start-frame requirement");
  assert.strictEqual(unknown.locked, true, "and keeps the lock");
}

/* THE ROUTE A SHOT IS ON IS NOT THE PROFILE THE PICKER WOULD SHOW.
 *
 * The panel resolved its prerequisite from `preferredGuidedVideoProfile`, which answers
 * a different question and answers it with a DEFAULT — the wired image-to-video target —
 * because a picker with nothing selected still has to draw something. An imported or
 * previously-built t2v unit carries its kind and no profile id at all, so it read as i2v
 * and was locked behind a frame it never begins from, with the unit sitting right there
 * saying `t2v`. A default nobody chose is not a route decision. */
{
  const routeProject = buildFixture();
  routeProject.shots[0].characters = [];
  routeProject.shots[0].codes = [];
  routeProject.shots[0].creationBrief = {};
  const page = await render("#/production", routeProject);
  const install = `globalThis.__routeCase = (unitKind, unitProfileMode, shotProfileMode) => {
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    shot.motionPrompt = "";
    const c = ensureShotCreation(shot);
    c.activeMotionUnitId = "";
    const idFor = (mode) => (mode ? ((PROMPT_LIBRARY?.profiles || []).find((p) => p.mediaType === "video" && p.mode === mode)?.id || "") : "");
    c.motionProfileId = idFor(shotProfileMode);
    shot.clips = [{ id: "seg-route", suffix: "a", label: "A", title: "Primary motion", dur: 6, kind: unitKind,
      note: "", motionPrompt: "A storm front crosses the ridge.", fromFrame: "", toFrame: "",
      motionProfileId: idFor(unitProfileMode), generationPackages: [] }];
    const effectiveMode = guidedEffectiveVideoMode(shot, c, shot.clips[0]);
    if (["t2v", "i2v", "flf", "r2v"].includes(effectiveMode)) declareShotRoute(shot, effectiveMode);
    const motionStage = shotStageState("motion", shotStageModelFacts(shot, []));
    const html = guidedMotionPanel(shot, null, []);
    const unit = shot.clips[0];
    return {
      canonicalReason: motionStage.blockedReason,
      panelHasCanonicalReason: !!motionStage.blockedReason && html.includes(motionStage.blockedReason),
      /* THE PANEL REFUSES NEW MOTION — which is the claim; the shell it refuses in is
         not. A shot carrying retained motion work now renders that work read-only
         instead of an empty locked shell, and both shapes declare the refusal with
         data-generation-readiness. Reading only the class name would have let a
         "must open" assertion pass against a panel that was still blocked. */
      panelLocked: html.includes("guided-motion-card locked") || /data-generation-readiness="blocked"/.test(html),
      saysApproveFirst: html.includes("Approve required frames first"),
      pill: /guided-mode-pill[^>]*>([^<]*)</.exec(html)?.[1] || "",
      unitKind: unit.kind, unitFromFrame: unit.fromFrame,
      unitProfileId: unit.motionProfileId || "", shotProfileId: c.motionProfileId || "",
      effectiveMode,
    };
  };`;
  vm.runInContext(install, page.context);
  const route = (kind, unitProfile = "", shotProfile = "") =>
    vm.runInContext(`__routeCase(${JSON.stringify(kind)}, ${JSON.stringify(unitProfile)}, ${JSON.stringify(shotProfile)})`, page.context);

  /* THE REPORTED CASE, exactly: a t2v unit with every profile id blank. */
  const imported = route("t2v");
  assert.strictEqual(imported.unitProfileId, "", "this proof is about a unit carrying NO profile id");
  assert.strictEqual(imported.shotProfileId, "", "and a shot carrying none either");
  assert.strictEqual(imported.effectiveMode, "t2v", "the unit's own kind is the route when nothing else states one");
  assert.strictEqual(imported.panelLocked, false, "an imported t2v shot must open");
  assert.strictEqual(imported.saysApproveFirst, false, "and must not ask for a frame it never begins from");
  assert.strictEqual(imported.pill, "NO FRAMES NEEDED", "and must say so truthfully");
  assert.strictEqual(imported.unitKind, "t2v", "the unit stays t2v");
  assert.strictEqual(imported.unitFromFrame, "", "and stays frameless");

  /* PRECEDENCE 1 — an explicit selection outranks a stale kind, in both directions, so
     switching route in the picker still decides. */
  assert.strictEqual(route("i2v", "", "t2v").panelLocked, false,
    "a t2v profile chosen on the shot must open a unit still marked i2v");
  assert.strictEqual(route("i2v", "t2v", "").panelLocked, false,
    "and a t2v profile carried on the unit must do the same");
  assert.strictEqual(route("t2v", "i2v", "").panelLocked, true,
    "an explicit i2v selection outranks a t2v kind and keeps its gate");

  /* PRECEDENCE 2 and 3 — every other kind with no profile anywhere still gates, and an
     unrecognised one gates too. This is what keeps the fix a correction rather than a
     hole: the relaxation reaches exactly one route. */
  for (const kind of ["i2v", "flf", "r2v"]) {
    const row = route(kind);
    assert.strictEqual(row.effectiveMode, kind, `${kind} resolves from its own kind`);
    assert.strictEqual(row.panelLocked, true, `${kind} must stay gated by canonical readiness`);
    assert(row.canonicalReason, `${kind} must name its canonical blocker`);
    assert.strictEqual(row.panelHasCanonicalReason, true, `${kind} panel must project the canonical blocker`);
    assert.strictEqual(row.saysApproveFirst, false, `${kind} must not substitute the obsolete all-routes frame warning`);
  }
  for (const kind of ["plan", "post", "reuse", "wormhole"]) {
    assert.strictEqual(route(kind).panelLocked, true,
      `${kind} is not a recognised video route and must stay fail-safe`);
  }
  /* And with no unit at all there is nothing to read a route from, which is also gated. */
  const empty = vm.runInContext(`(() => {
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    shot.clips = []; shot.motionPrompt = "";
    const c = ensureShotCreation(shot);
    c.activeMotionUnitId = ""; c.motionProfileId = "";
    return { mode: guidedEffectiveVideoMode(shot, c, undefined), locked: guidedMotionPanel(shot, null, []).includes("guided-motion-card locked") };
  })()`, page.context);
  assert.strictEqual(empty.mode, "", "no unit and no selection states no route");
  assert.strictEqual(empty.locked, true, "which stays fail-safe");
}

/* AND ON A SHOT WITH MORE THAN ONE MOTION UNIT, THE PANEL IS ABOUT THE ACTIVE ONE.
 *
 * `activeMotionUnitId` is the existing answer — the composer writes it when a unit is
 * selected and the builders, the sound composer and the profile resolver all read it.
 * The Motion panel took `clips[0]` instead, so the gate, its wording and the pill all
 * followed a unit the filmmaker was not looking at. Both directions were wrong, and the
 * second is the dangerous one: it OPENS a frame-gated route. */
{
  const multiProject = buildFixture();
  multiProject.shots[0].characters = [];
  multiProject.shots[0].codes = [];
  multiProject.shots[0].creationBrief = {};
  const page = await render("#/production", multiProject);
  vm.runInContext(`globalThis.__readPanel = (shot, c) => {
    const html = guidedMotionPanel(shot, null, []);
    const unit = guidedActiveMotionUnit(shot, c);
    return {
      activeId: c.activeMotionUnitId, activeKind: unit ? unit.kind : "",
      effectiveMode: guidedEffectiveVideoMode(shot, c, unit),
      /* THE PANEL REFUSES NEW MOTION — which is the claim; the shell it refuses in is
         not. A shot carrying retained motion work now renders that work read-only
         instead of an empty locked shell, and both shapes declare the refusal with
         data-generation-readiness. Reading only the class name would have let a
         "must open" assertion pass against a panel that was still blocked. */
      panelLocked: html.includes("guided-motion-card locked") || /data-generation-readiness="blocked"/.test(html),
      saysApproveFirst: html.includes("Approve required frames first"),
      pill: /guided-mode-pill[^>]*>([^<]*)</.exec(html)?.[1] || "",
    };
  };
  globalThis.__multi = (firstKind, secondKind, activeIndex) => {
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    shot.motionPrompt = "";
    const c = ensureShotCreation(shot);
    c.motionProfileId = ""; c.motionDirection = ""; c.motionDuration = 0;
    shot.clips = [
      { id: "seg-one", suffix: "a", label: "A", title: "One", dur: 5, kind: firstKind, note: "", motionPrompt: "First unit.", fromFrame: firstKind === "t2v" ? "" : "frame-a", toFrame: "", motionProfileId: "", generationPackages: [] },
      { id: "seg-two", suffix: "b", label: "B", title: "Two", dur: 6, kind: secondKind, note: "", motionPrompt: "Second unit.", fromFrame: secondKind === "t2v" ? "" : "frame-a", toFrame: "", motionProfileId: "", generationPackages: [] },
    ];
    const oneRoute = firstKind === secondKind && ["t2v", "i2v", "flf", "r2v"].includes(firstKind) ? firstKind : "hybrid";
    declareShotRoute(shot, oneRoute);
    c.activeMotionUnitId = shot.clips[activeIndex].id;
    return globalThis.__readPanel(shot, c);
  };`, page.context);
  const multi = (first, second, activeIndex) =>
    vm.runInContext(`__multi(${JSON.stringify(first)}, ${JSON.stringify(second)}, ${activeIndex})`, page.context);

  /* THE TWO WORDS THE PILL USES TO REFUSE. A shot carrying retained motion work says
     HISTORY and shows that work read-only; one with nothing retained says LOCKED and
     shows an empty shell. Both are the shot-level refusal, which is the claim; asserting
     the exact word would make the claim about the shell. */
  const REFUSING_PILLS = ["LOCKED", "HISTORY"];

  /* A — first clip i2v, ACTIVE unit t2v. The active route governs and the panel opens. */
  const a = multi("i2v", "t2v", 1);
  assert.strictEqual(a.activeKind, "t2v", "the active unit is the t2v one");
  assert.strictEqual(a.effectiveMode, "t2v", "and it is what the route resolves to");
  assert.strictEqual(a.panelLocked, true, "selecting a t2v clip cannot bypass the hybrid shot's required inputs");
  assert.strictEqual(a.saysApproveFirst, false, "the panel must explain canonical readiness, not the deleted local frame warning");
  assert(REFUSING_PILLS.includes(a.pill), `the persistent shot-level truth governs the panel, got ${a.pill}`);

  /* B — first clip t2v, ACTIVE unit i2v. The gate must come BACK. This is the direction
     that silently opened a frame-gated route, which is the worse of the two. */
  const b = multi("t2v", "i2v", 1);
  assert.strictEqual(b.activeKind, "i2v", "the active unit is the i2v one");
  assert.strictEqual(b.effectiveMode, "i2v", "and it is what the route resolves to");
  assert.strictEqual(b.panelLocked, true, "an active i2v unit must stay gated behind a t2v first clip");
  assert.strictEqual(b.saysApproveFirst, false, "and must use the canonical blocker rather than the deleted local warning");
  assert(REFUSING_PILLS.includes(b.pill), `and must present its frame status truthfully, got ${b.pill}`);

  /* SINGLE-UNIT BEHAVIOUR IS UNCHANGED, in both directions. */
  const soloT2v = multi("t2v", "t2v", 0), soloI2v = multi("i2v", "i2v", 0);
  assert.strictEqual(soloT2v.panelLocked, false, "a single t2v unit still opens");
  assert.strictEqual(soloT2v.pill, "NO FRAMES NEEDED");
  assert.strictEqual(soloI2v.panelLocked, true, "a single i2v unit is still gated");
  assert.strictEqual(soloI2v.saysApproveFirst, false);

  /* SWITCHING THE ACTIVE UNIT CHANGES THE PANEL, driven through the shipped selector
     rather than by writing the id directly — `selectMotionUnit` is what the composer's
     unit chips call. */
  const swap = vm.runInContext(`(() => {
    __multi("i2v", "t2v", 0);
    const shot = P.shots[0];
    const before = __readPanel(shot, ensureShotCreation(shot));
    selectMotionUnit(shot.id, "seg-two");
    const after = __readPanel(shot, ensureShotCreation(shot));
    selectMotionUnit(shot.id, "seg-one");
    const back = __readPanel(shot, ensureShotCreation(shot));
    return { api: typeof selectMotionUnit, before, after, back };
  })()`, page.context);
  assert.strictEqual(swap.api, "function", "the shipped active-unit selector must exist");
  assert.strictEqual(swap.before.panelLocked, true, "starts on the i2v unit, gated");
  assert.strictEqual(swap.after.activeId, "seg-two", "selecting the t2v unit moves the active id");
  assert.strictEqual(swap.after.panelLocked, true, "clip focus cannot lift the hybrid shot's canonical blocker");
  assert(REFUSING_PILLS.includes(swap.after.pill),
    `the pill remains a shot-level readiness projection, got ${swap.after.pill}`);
  assert.strictEqual(swap.back.panelLocked, true, "selecting back preserves the same shot truth");
  assert.strictEqual(swap.back.saysApproveFirst, false, "the obsolete local warning remains absent");
}

/* THE SAME ANSWERS FROM THE FALLBACK BUILDER.
 *
 * `ensureGuidedMotionUnit` exists twice: creation-studio.js declares it and
 * v607-composer.js REPLACES it, so the live page runs the v607 copy and a repair made
 * only in creation-studio.js is dead code. The v607 composer also disables itself on
 * error and restores the base functions, which makes the base copy a live path too — so
 * both must agree, and this drives the base one through the real restore path. */
{
  const fallbackProject = buildFixture();
  fallbackProject.shots[0].characters = [];
  fallbackProject.shots[0].codes = [];
  fallbackProject.shots[0].creationBrief = {};
  const page = await render("#/production", fallbackProject);
  const result = vm.runInContext(`(() => {
    /* THE SHIPPED RESTORE, not a test-only hook. \`window.disableComposerEnhancements\`
       IS \`restoreComposerOriginals607\`, and it is what the composer's own error handler
       and the ?safe=1 path call. An earlier version of this test reached for a
       \`__cinebraidRestoreComposer607\` that does not exist and silently took its own
       direct-assignment fallback — proving the assignment, not the mechanism. */
    if (typeof window.disableComposerEnhancements !== "function") return { skipped: "no shipped restore mechanism" };
    const before = ensureGuidedMotionUnit.name;
    window.disableComposerEnhancements("tier0 regression: exercising the shipped restore path");
    if (!window.__CINEBRAID_COMPOSER_607_DISABLED) return { skipped: "restore did not disable the composer" };
    const shot = P.shots[0];
    for (const frame of shot.keyframes || []) frame.winner = "";
    shot.clips = [];
    shot.motionPrompt = "";
    const c = ensureShotCreation(shot);
    c.activeMotionUnitId = "";
    const profile = (PROMPT_LIBRARY?.profiles || []).find((p) => p.mediaType === "video" && p.mode === "t2v") || null;
    c.motionProfileId = profile ? profile.id : "";
    const unit = ensureGuidedMotionUnit(shot, "", profile);
    const i2vProfile = (PROMPT_LIBRARY?.profiles || []).find((p) => p.mediaType === "video" && p.mode === "i2v") || null;
    shot.clips = [];
    c.activeMotionUnitId = "";
    const i2vUnit = ensureGuidedMotionUnit(shot, "", i2vProfile);
    return {
      before, after: ensureGuidedMotionUnit.name, disabled: !!window.__CINEBRAID_COMPOSER_607_DISABLED,
      kind: unit.kind, fromFrame: unit.fromFrame, i2vFrom: i2vUnit.fromFrame,
      /* The base panel must resolve the same route from the same unit. */
      importedT2vLocked: (() => {
        const s = P.shots[0];
        for (const frame of s.keyframes || []) frame.winner = "";
        const cc = ensureShotCreation(s);
        cc.activeMotionUnitId = ""; cc.motionProfileId = "";
        s.clips = [{ id: "seg-imported", kind: "t2v", dur: 6, motionPrompt: "A storm front.", fromFrame: "", toFrame: "", motionProfileId: "", generationPackages: [] }];
        declareShotRoute(s, "t2v");
        return guidedMotionPanel(s, null, []).includes("guided-motion-card locked");
      })(),
    };
  })()`, page.context);
  assert(!result.skipped, `the shipped restore must be reachable: ${result.skipped}`);
  assert.strictEqual(result.disabled, true, "the shipped restore must mark the composer disabled");
  assert.strictEqual(result.before, "ensureGuidedMotionUnit607", "the v607 builder must be live before the restore");
  assert.strictEqual(result.after, "ensureGuidedMotionUnit", "and the base builder live after it");
  assert.strictEqual(result.kind, "t2v", "the fallback builder must keep the route too");
  assert.strictEqual(result.fromFrame, "",
    "the fallback builder must not fabricate a start frame either — a repair in one copy only is dead code");
  assert(result.i2vFrom, "and must still give i2v the frame it depends on");
  assert.strictEqual(result.importedT2vLocked, false,
    "and the panel must resolve an imported t2v route the same way with the base builder live");
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

/* T0-4c, second half — AN EXPLICIT REQUEST FOR NO GENERATED AUDIO IS NOT SILENCE.
 *
 * CineBraid ships a control for this: "Include native audio instructions" on the motion
 * package, writing `output.nativeAudio`. Untick it and the request reached the compiler
 * and stopped — byte-identical prompt, no parameter moved, nothing warned, and the plan
 * went on recording `audio: "native"`. The filmmaker was told the opposite of what would
 * happen and was charged for the track regardless.
 *
 * H3 cannot comply and fal offers no field to make it, so the correction is accounting
 * rather than behaviour: the request is visible, refused by name, and explained. */
{
  const silentRequest = executionSpec({ output: { ...(baseSpec().output || {}), nativeAudio: false } });
  const plan = compile("i2v", [FRAME_A], { spec: silentRequest });

  /* 1 — the request resolves to `unsupported`, which is what the contract reserves for
     something the filmmaker asked for and will not get. */
  assert.strictEqual(state(plan, "output.nativeAudio"), "unsupported",
    "a request for no generated audio must not disappear on a route that always renders it");
  assert(covered(plan, "output.nativeAudio").reason.trim(), "and must record why");

  /* …with a warning written for a filmmaker rather than for whoever maintains the pack.
     The core's backstop would have said "the minimax-h3 i2v compiler does not carry it.
     Record it as anchored or omitted by design" — a maintenance note about a pack that
     is in fact behaving correctly. */
  const warning = plan.warnings.find((row) => row.intent === "output.nativeAudio");
  assert(warning, "an unsupported request must warn by name");
  assert.strictEqual(warning.code, "native-audio-unsupported");
  assert.strictEqual(warning.field, "output.nativeAudio");
  assert(/native audio track/i.test(warning.message) && /charged/i.test(warning.message),
    "the warning must say what will actually happen and that it costs money");
  assert(warning.action.trim(), "and offer something the filmmaker can do about it");
  assert(!/model pack|omitted by design|anchored/i.test(warning.message),
    "the sentence a filmmaker reads must not be a note to a developer");

  /* 3 — the route's real behaviour is still recorded truthfully. Refusing the request
     does not license the plan to claim the video arrives silent, because it does not. */
  assert.strictEqual(plan.output.audio, "native",
    "the unsatisfied request must not overwrite the true fact about what arrives");

  /* 2 — AND NOTHING REACHES THE PROVIDER. The refusal is accounting; inventing a field
     to carry it would put a parameter fal never published into a paid request. Proved by
     byte-comparing the payload against the same shot without the request. */
  const capability = resolveH3FalCapability("i2v", H3.capabilityLayer("i2v", "api"));
  const serialize = (input) => serializeH3PlanForFal(input, capability, { resolveReference: (row) => `https://x/${row.refId}` });
  const withRequest = serialize(plan);
  const without = serialize(compile("i2v", [FRAME_A]));
  assert.deepStrictEqual(withRequest.input, without.input,
    "asking for no generated audio must change the request to fal in no way at all");
  for (const field of ["generate_audio", "audio", "enable_audio", "with_audio", "nativeAudio", "native_audio"])
    assert(!(field in withRequest.input), `${field} is not a field fal publishes and must not be invented to carry a refusal`);

  /* Every mode, because every H3 checkpoint renders a track. */
  for (const [mode, references] of [["t2v", []], ["flf", [F.FRAME_A, F.FRAME_B]], ["r2v", [F.REF_IDENTITY, F.REF_LOCATION]]]) {
    const row = compile(mode, references, { spec: silentRequest });
    assert.strictEqual(state(row, "output.nativeAudio"), "unsupported", `${mode} renders audio too and must say so`);
  }
}

/* 4 — AND A SHOT THAT NEVER ASKED IS NEVER ASKED TO EXPLAIN ITSELF. The reader is
   strictly `=== false`, so the default and an explicit `true` are both silent: this
   correction must not put a new note on every shot that simply did not mention audio. */
{
  for (const output of [undefined, {}, { nativeAudio: true }]) {
    const spec = executionSpec(output === undefined ? {} : { output });
    const plan = compile("i2v", [FRAME_A], { spec });
    assert(!covered(plan, "output.nativeAudio"),
      `no audio request was made (${JSON.stringify(output)}) and none may be inventoried`);
    assert(!plan.warnings.some((row) => row.intent === "output.nativeAudio"),
      "and nothing may warn about a decision nobody took");
  }
  /* The still route reaches the same shot differently and must also stay quiet: a frame
     renders no audio, so a request for none is already met. */
  const stillPlan = Compiler.compileGenerationPlan({
    spec: executionSpec({ output: { nativeAudio: false } }),
    references: [], mode: "t2i", modelId: "gpt-image-2/standard", surface: "api",
    capability: require("../public/shared-generation-capability").resolveCapability({
      model: require("../model-packs/gpt-image-2").capabilityLayer("t2i", "api"),
    }),
  });
  assert.strictEqual(state(stillPlan, "output.nativeAudio"), "omitted-by-design",
    "a still renders no audio, so the request is met rather than refused");
  assert(!stillPlan.warnings.some((row) => row.intent === "output.nativeAudio"),
    "and a met request must not warn");
}

console.log("Shot Execution Tier 0 passed: filmmaking facts remain inventoried; declared route requirements and canonical readiness govern Motion availability; t2v remains frameless, endpoint/reference routes retain their blockers, paid boundaries are unchanged, and provider calls made: 0.");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

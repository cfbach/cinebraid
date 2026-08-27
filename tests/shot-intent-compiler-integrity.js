/* CineBraid — DOGFOOD REMEDIATION SLICE 1: SHOT INTENT → PROMPT COMPILATION INTEGRITY.
 *
 * The governing invariant, in one sentence:
 *
 *     A compiled generation prompt may refine the filmmaker's declared intent for a
 *     specific model. It may never contradict it, never replace it with a default, and
 *     never carry a semantic fact from another shot.
 *
 * Two dogfood observations from 2026-08-26 are reproduced here as regressions, and the
 * SECOND one is not the defect it was reported as — the suite says so explicitly rather
 * than quietly testing something else.
 *
 * ---------------------------------------------------------------------------
 * REPRO 1 — MOTION INTENT CONTRADICTED BY THE H3 PROMPT.
 *
 * Shot TLS-002 was a swamp journey with a declared travelling walk. The compiled
 * MiniMax H3 prompt told the model the character holds still with natural breathing and
 * blinking, and the returned video did exactly that.
 *
 * Nothing in the project said "stand still". Three routes put it there, and all three
 * read a control the filmmaker had never touched:
 *
 *   1. structuredMotionSummary() printed a stillness sentence for a cast member with NO
 *      entry in `plan.subjects` at all. With no free-text direction that summary becomes
 *      the motion unit's `note`; buildContext() reads `note` as the shot's description
 *      AND its motionDirection; defaultSpec() turns it into `actions[0]`. No assistant
 *      is involved on that path at all.
 *   2. The same sentence is sent verbatim as the directive on the Improve path.
 *   3. applyStructuredDirection() read `item.action || "still"` for an all-default plan
 *      entry and PREPENDED it, so `action.primary` — the one intent a motion package
 *      cannot be without — became "<id> still" and the declared walk was demoted to a
 *      secondary beat.
 *
 * The repair is at the structured owner boundary, not in the words: public/shared-motion-
 * intent.js decides whether a value was DECLARED or merely DEFAULTED, and a default is
 * allowed to fill an unknown but never to make a statement. There is no phrase list
 * anywhere in this slice, and a DECLARED stillness still compiles in full — asserted
 * below, because a repair that silenced real direction would be a worse defect.
 *
 * ---------------------------------------------------------------------------
 * REPRO 2 — "CROSS-SHOT COMPOSER CONTENT", WHICH IS NOT CROSS-SHOT.
 *
 * The Motion & Sound Composer was reported as holding another context's facts while the
 * swamp shot was open: a coupler, a cable, a status light, a locked connector. All six
 * reported strings are `placeholder` ATTRIBUTES in public/motion-sound-composer.js —
 * static example text compiled into the page, identical for every shot in every project,
 * never read into any value and unable to reach a compiled prompt. There is no
 * contamination path, and this suite proves that mechanically rather than asserting it:
 * an adversarial two-shot fixture with disjoint vocabulary is driven through the real
 * composer in three orders, and shot B is required to carry none of shot A's tokens.
 *
 * The truth defect that WAS real is that grey example text about someone else's scene is
 * indistinguishable from your own writing. Those placeholders now say "e.g.", and that
 * is asserted too — it is the whole of what this slice changes about the composer's
 * appearance.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUITE DELIBERATELY DOES NOT DO.
 *
 *   - no provider, no model, no network, no paid call, and no clock beyond what the
 *     shipped code already reads;
 *   - no natural-language contradiction detection. Every assertion is over structured
 *     values or over text the structured layer put there;
 *   - no arbitration between two DECLARED values that disagree. Two things a filmmaker
 *     wrote are a question for the filmmaker; only default-versus-declared is decided.
 */

const assert = require("assert");
const vm = require("vm");

const PromptEngine = require("../prompt-engine");
const Compiler = require("../generation-compiler");
const Contracts = require("../generation-contracts");
const MotionIntent = require("../public/shared-motion-intent");
const { render, buildFixture } = require("./render-harness");
const F = require("./generation-compiler-fixture");

/* ============================================================== THE BLANK PLAN
   =========================================================================== */

/* TYPED OUT, NOT DERIVED. These are the values public/v607-composer.js
   normalizeMotionPlan607() writes into a plan nobody has touched, and they are the whole
   input to REPRO 1. Building them from MOTION_PLAN_DEFAULTS would make the fixture move
   whenever the table moved, and a probe that follows the thing it is testing cannot
   fail. `sameAsShippedNormalizer()` below checks the two agree, which is the assertion
   that would catch a table edit — a fixture cannot be both the question and the answer. */
const BLANK_SUBJECT = Object.freeze({ action: "still", direction: "", intensity: "subtle", look: "", targetId: "", targetLabel: "", destination: "", notes: "" });
const BLANK_PROP = Object.freeze({ action: "static", direction: "", targetId: "", targetLabel: "", destination: "", notes: "" });
const BLANK_CAMERA = Object.freeze({ move: "locked", direction: "", intensity: "subtle", style: "smooth", framing: "preserve" });
const BLANK_ENVIRONMENT = Object.freeze({ action: "static", intensity: "subtle", notes: "" });
const BLANK_TIMING = Object.freeze({ onset: "immediate", pacing: "natural", holdEnd: true, secondary: "" });

const REX = "CH-REX";
const CHAIR = "PR-FOLDING-CHAIR";

function blankPlan({ subjects = [REX], props = [CHAIR] } = {}) {
  return {
    camera: { ...BLANK_CAMERA },
    subjects: Object.fromEntries(subjects.map((id) => [id, { ...BLANK_SUBJECT }])),
    props: Object.fromEntries(props.map((id) => [id, { ...BLANK_PROP }])),
    environment: { ...BLANK_ENVIRONMENT },
    timing: { ...BLANK_TIMING },
    audio: { mode: "none", referenceKey: "", speakerId: "", voiceEntityId: "", lipSync: false, direction: "" },
  };
}

/* ============================================================ THE SWAMP FIXTURE
   =========================================================================== */

/* The dogfood shot, reduced to the facts that produced the defect: a declared travelling
   walk and a cast member nobody has directed individually. */
const DECLARED_WALK = "Rex wades forward through waist-deep swamp water in a full travelling walk cycle.";

function swampContext(overrides = {}) {
  return {
    project: { world: { setting: "Drowned cypress swamp" }, styleBlocks: [], aspectRatio: "16:9" },
    scene: { title: "The crossing", beat: "Rex crosses the swamp toward the chair.", feeling: "Grim" },
    shot: {
      id: "TLS-002",
      title: "Swamp crossing",
      description: "Rex wades through the swamp toward the folding chair on the far bank.",
      positioning: "Wide, low, water line across the lower third.",
      durationSeconds: 6,
      motionDirection: DECLARED_WALK,
      audio: { dialogue: "", sfx: "" },
      risks: [],
      ...(overrides.shot || {}),
    },
    references: [
      { type: "character", name: "Rex", id: REX },
      { type: "location", name: "Cypress swamp" },
      { type: "prop", name: "Folding chair", id: CHAIR },
    ],
    ...(overrides.top || {}),
  };
}

function motionProfile() {
  return PromptEngine.getProfile("minimax-h3/i2v") || PromptEngine.getProfile("seedance-2/i2v");
}

/* One compilation of the swamp shot, with whatever motion plan the caller hands in.
   Deterministic and offline: defaultSpec, applyStructuredDirection and compile are the
   same three calls the /api/prompt/compile route makes with the assistant disabled. */
function compileSwamp(plan, options = {}) {
  const context = swampContext(options);
  const profile = motionProfile();
  let spec = PromptEngine.defaultSpec(context, "motion", profile.mode || "i2v", [], options.mediaAnalysis || null);
  const before = JSON.parse(JSON.stringify(spec.actions || []));
  spec = PromptEngine.applyStructuredDirection(spec, options.composition || null, plan, []);
  const compiled = PromptEngine.compile(profile, spec, []);
  return { context, profile, spec, compiled, before, beats: (spec.actions || []).map((row) => String(row.action || "")) };
}

function firstBeat(result) {
  return result.beats[0] || "";
}
/* PROVENANCE IS READ PER FIELD, because that is the unit the correction works in. A
   reader that only asked which DIMENSION was taken could not tell "the filmmaker set the
   camera intensity" from "the filmmaker set the camera move", which is exactly the
   distinction the hold correction turns on. */
function withheldFields(spec) {
  return (spec.motionIntent?.withheld || []).map((row) => `${row.dimension}:${row.id}:${row.field}`);
}
function declaredFields(spec) {
  return (spec.motionIntent?.declared || []).map((row) => `${row.dimension}:${row.id}:${row.field}`);
}
function withheldReason(spec, key) {
  const row = (spec.motionIntent?.withheld || []).find((item) => `${item.dimension}:${item.id}:${item.field}` === key);
  return row ? row.reason : "";
}

/* =========================================================== 1. WALK VS STILL
   =========================================================================== */

/* THE CENTRAL ASSERTION OF THE SLICE.

   A shot declares a travelling walk. Every structured motion control is untouched, so
   the plan is exactly what the normalizer wrote. The compiled package must carry the
   walk and must not direct stillness. */
function testWalkVsStillSurvivesCompilation() {
  const result = compileSwamp(blankPlan());

  assert.strictEqual(firstBeat(result), DECLARED_WALK,
    "the declared travelling walk must remain the principal action; a defaulted motion control may not take the front of the beat list");
  for (const beat of result.beats) {
    assert.ok(!new RegExp(`^${REX}\\b`).test(beat),
      `a subject nobody directed must contribute no beat, and the compiler emitted: ${beat}`);
    assert.ok(!new RegExp(`^${CHAIR}\\b`).test(beat),
      `a prop nobody directed must contribute no beat, and the compiler emitted: ${beat}`);
  }
  assert.strictEqual(result.beats.length, 1,
    `a shot with one declared action and no directed subject must compile to one beat, not ${result.beats.length}: ${JSON.stringify(result.beats)}`);

  /* The same claim against the text that would actually be sent. `still` is a normal
     English word and a legitimate compiled prompt may contain it; what may not appear
     is the structured layer's own manufactured sentence, which always names the entity
     identifier because that is what applyStructuredDirection interpolates. */
  assert.ok(result.compiled.prompt.includes("wades forward through waist-deep swamp water"),
    "the compiled prompt must still carry the declared walk");
  assert.ok(!new RegExp(`${REX}\\s+still`).test(result.compiled.prompt),
    `the compiled prompt directs the declared-moving subject to hold still: ${result.compiled.prompt.slice(0, 400)}`);

  /* WITHHELD, NOT DROPPED, AND NAMED BY FIELD. A gap the compiler chose to leave open is
     a decision, and the record has to show which value it declined to publish. */
  assert.deepStrictEqual(withheldFields(result.spec).sort(), [
    "camera::move", "camera::style", "camera::intensity", "camera::framing",
    "environment::action", "environment::intensity", "environment::notes",
    "timing::secondary", "timing::holdEnd",
    "audio::mode",
    `subject:${REX}:`, `prop:${CHAIR}:`,
  ].sort(), "every field the plan carried but did not declare must be recorded as withheld, by name");
  assert.deepStrictEqual(declaredFields(result.spec), [],
    "an untouched motion plan declares nothing");

}

/* THE TIMING HALF, ASKED ON ITS OWN. `holdEnd` normalizes to TRUE, so an untouched plan
   used to add a requirement to settle and hold the final state — the same manufactured
   stillness in the requirement list rather than the beats, and directly opposed to a
   shot that has to end mid-stride. */
function testUndeclaredTimingAddsNoHoldRequirement() {
  const result = compileSwamp(blankPlan());
  assert.ok(!result.spec.mustPreserve.includes("settle into and briefly hold the final state"),
    "a defaulted timing row must not add a hold-the-final-state requirement to a shot that ends in motion");
  /* And the inverse: a filmmaker who asked for the hold still gets it. */
  const declared = blankPlan();
  declared.timing = { ...BLANK_TIMING, holdEnd: true, declaredFields: ["holdEnd"] };
  const held = compileSwamp(declared);
  assert.ok(held.spec.mustPreserve.includes("settle into and briefly hold the final state"),
    "a declared hold must still reach the requirement list");
}

/* THE PROP HALF, ASKED ON ITS OWN so the claim has a detector of its own rather than
   being reported as the subject assertion firing first. `blankPlan({subjects: []})` is a
   shot whose only untouched control is the prop row. */
function testUndirectedPropContributesNoBeat() {
  const result = compileSwamp(blankPlan({ subjects: [] }));
  for (const beat of result.beats)
    assert.ok(!new RegExp(`^${CHAIR}\\b`).test(beat),
      `a prop nobody directed must contribute no beat, and the compiler emitted: ${beat}`);
  assert.strictEqual(firstBeat(result), DECLARED_WALK,
    "the declared walk must remain the principal action beside an undirected prop");
}

/* A LABEL THE COMPOSER WROTE IS NOT A DECISION THE FILMMAKER MADE.
   `targetLabel` is written as a consequence of choosing a target, never on its own, so a
   label left behind after a target was cleared must not resurrect an otherwise blank
   entry. Reading it as evidence would put the manufactured stillness straight back. */
function testDerivedLabelIsNotADeclaration() {
  const plan = blankPlan();
  plan.subjects[REX] = { ...BLANK_SUBJECT, targetLabel: "the folding chair" };
  const result = compileSwamp(plan);
  for (const beat of result.beats)
    assert.ok(!new RegExp(`^${REX}\\b`).test(beat),
      `a derived target label is not a declaration, and the compiler emitted: ${beat}`);
  assert.strictEqual(firstBeat(result), DECLARED_WALK,
    "the declared walk must remain the principal action beside a stale target label");
  /* And the provenance must not claim it either. Under the field-level reading a derived
     label cannot reach a clause on its own, so the record is where the mistake would
     surface: claiming `targetLabel` as taken would be the compiler saying a filmmaker
     decided something the composer decided for them. */
  assert.deepStrictEqual(declaredFields(result.spec), [],
    "a derived label must not be recorded as a filmmaker decision");

  /* And beside a field that IS declared, where a clause does get written. This is where
     the exclusion earns its keep under the field-level reading: the composer writes
     `targetLabel` for the filmmaker when they pick a target, so recording it as one of
     their decisions would be the provenance claiming a choice nobody made — and a target
     cleared afterwards would keep a stale label alive in the record. */
  const walking = blankPlan();
  walking.subjects[REX] = { ...BLANK_SUBJECT, action: "walk", targetLabel: "the folding chair" };
  const walkingResult = compileSwamp(walking);
  assert.strictEqual(firstBeat(walkingResult), `${REX} walk`,
    `a stale label must not reach the beat beside a declared action: ${JSON.stringify(walkingResult.beats)}`);
  assert.deepStrictEqual(declaredFields(walkingResult.spec), [`subject:${REX}:action`],
    "only the filmmaker's own field may be recorded as a decision; a derived label may not");
}

/* THE INVERSE, AND IT MATTERS AS MUCH.

   "Remain still while the water settles" is real direction. A repair that could not tell
   it from a blank form would be a worse defect than the one it replaced. */
function testDeclaredStillnessStillCompiles() {
  /* A note the filmmaker typed is declared; the `action` dropdown they never opened is
     not. So the note speaks and the default `still` beside it stays silent — and the note
     itself may perfectly well be about holding still, which is the filmmaker saying it in
     their own words rather than the compiler saying it for them. */
  const plan = blankPlan();
  plan.subjects[REX] = { ...BLANK_SUBJECT, action: "still", notes: "holds absolutely still while the water settles" };
  const withNote = compileSwamp(plan);
  assert.strictEqual(firstBeat(withNote), `${REX} holds absolutely still while the water settles`,
    `a directed note must compile on its own, without its untouched siblings: ${JSON.stringify(withNote.beats)}`);
  assert.deepStrictEqual(declaredFields(withNote.spec), [`subject:${REX}:notes`],
    "only the field the filmmaker wrote may be recorded as taken");

  /* A NON-default action is declared by divergence, and compiles with its qualifiers. */
  const walking = blankPlan();
  walking.subjects[REX] = { ...BLANK_SUBJECT, action: "walk", direction: "screen-right", notes: "steady pace" };
  const walkingResult = compileSwamp(walking);
  assert.strictEqual(firstBeat(walkingResult), `${REX} walk toward screen right; steady pace`,
    `a fully directed subject must compile the sentence it always did: ${JSON.stringify(walkingResult.beats)}`);

  /* And the harder half: stillness chosen deliberately, with NOTHING else set, so the
     stored entry is byte-identical to the blank one. Only the writer's own mark can tell
     these apart, which is why public/v607-composer.js records it at the moment of the
     edit. */
  const marked = blankPlan();
  marked.subjects[REX] = { ...BLANK_SUBJECT, action: "still", declaredFields: ["action"] };
  const markedResult = compileSwamp(marked);
  assert.ok(firstBeat(markedResult).startsWith(`${REX} still`),
    `a deliberately re-chosen default must be heard: ${JSON.stringify(markedResult.beats)}`);
  assert.deepStrictEqual(declaredFields(markedResult.spec), [`subject:${REX}:action`],
    "a marked field must read as a declaration, and must name itself");
}

/* THE SAME SHOT THROUGH THE MODEL PACK, so the repair is not only true of the legacy
   compile path. `action.primary` is what actionSections() prints first. */
function testWalkVsStillThroughTheModelPack() {
  const result = compileSwamp(blankPlan());
  const plan = Compiler.compileGenerationPlan({
    spec: result.spec,
    references: [],
    mode: "t2v",
    modelId: F.modelIdFor("t2v"),
    surface: "api",
    capability: F.capabilityFor("t2v", "api"),
  });
  const validation = Contracts.validateGenerationPlan(plan);
  assert.ok(validation.ok, `the plan must satisfy the GenerationPlan contract: ${JSON.stringify(validation.errors)}`);
  assert.strictEqual(F.state(plan, "action.primary"), "represented",
    "a motion plan must carry its principal action into the prompt");
  /* actionSections() prints `action.primary` FIRST, so the head of the ACTION section is
     the exact place a defaulted stillness used to stand in front of the declared walk. */
  const action = /\nACTION\n([^\n]+)/.exec(plan.inputs.prompt);
  assert.ok(action, `the model pack prompt must carry an action section: ${plan.inputs.prompt.slice(0, 400)}`);
  assert.ok(action[1].startsWith("Rex wades forward"),
    `the principal action must be the declared walk, not a defaulted stillness: ${action[1]}`);
  assert.ok(!new RegExp(`${REX}\\s+still`).test(plan.inputs.prompt),
    `the model pack prompt directs the declared-moving subject to hold still: ${plan.inputs.prompt.slice(0, 400)}`);
}

/* ============================================ 1b. THE BROWSER HALF OF REPRO 1
   =========================================================================== */

/* THE ROUTE WITH NO ASSISTANT IN IT.
 *
 * buildGuidedMotionPrompt writes `unit.note = writtenDirection || structuredDirection`.
 * With no free-text direction the note IS the structured summary, and buildContext()
 * reads a segment's `note` as both its description and its motionDirection. So whatever
 * structuredMotionSummary() prints for an untouched composer is compiled as the shot's
 * action. This exercises exactly that chain. */
async function walkVsStillThroughTheBrowser() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.desc = "Kai walks the length of the hull.";
  shot.title = "Hull walk";
  /* No free-text motion direction and no per-subject direction: the state of a shot
     whose filmmaker described the action and then opened the motion composer. The unit
     titles are cleared too, because buildContext() reads a segment's title ahead of the
     shot's narrative and a fixture that let "Panel check" stand in for the description
     would be asking a different question than the dogfood shot did. */
  for (const clip of shot.clips) { clip.motionPrompt = ""; clip.title = ""; clip.note = ""; }
  const { context } = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  const summary = vm.runInContext("structuredMotionSummary(P.shots[0])", context);
  const live = vm.runInContext("JSON.parse(JSON.stringify(P))", context);
  return { summary, live, context };
}

/* THE COMPOSER THE FILMMAKER GETS WHEN THE ENHANCED ONE IS OFF.
 *
 * public/v607-composer.js replaces structuredMotionSummary on every normal page, so a
 * repair made only there is invisible on two real paths: safe mode
 * (`?safe=1` / `cinebraid-disable-v607-composer`) returns before any override installs,
 * and restoreComposerOriginals607() puts the base implementation back when the enhanced
 * composer fails a load check. The base function is reachable from a test through the
 * handle v607 publishes for exactly that purpose, so this asks the real thing rather
 * than reading its source. */
function baseComposerSummary(context) {
  return vm.runInContext(`(() => {
    const base = window.__cinebraidComposerOriginals607 && window.__cinebraidComposerOriginals607.structuredMotionSummary;
    if (typeof base !== "function") throw new Error("the base composer summary is not reachable from this harness");
    return base(P.shots[0]);
  })()`, context);
}

function testBrowserSummaryManufacturesNothing(summary) {
  assert.ok(!/remains still except for natural breathing and blinking/i.test(summary),
    `the structured summary states stillness for a cast member nobody directed: ${summary}`);
  assert.ok(!/^Camera:/m.test(summary),
    `the structured summary states a camera move nobody directed: ${summary}`);
  assert.ok(!/Environment remains stable/i.test(summary),
    `the structured summary states an environment fact nobody directed: ${summary}`);
  assert.ok(!/^Timing:/m.test(summary),
    `the structured summary states timing nobody directed: ${summary}`);
}

/* Take the summary the browser produced, put it where buildGuidedMotionPrompt puts it,
   and compile the shot the way the server would. */
function compileFromLiveProject(project, shotId, note) {
  const target = project.shots.find((row) => row.id === shotId);
  const unit = (target.clips || [])[0];
  unit.note = note;
  unit.motionPrompt = "";
  const context = PromptEngine.buildContext(project, shotId, unit.id);
  const profile = motionProfile();
  let spec = PromptEngine.defaultSpec(context, "motion", profile.mode || "i2v", [], null);
  spec = PromptEngine.applyStructuredDirection(spec, null, target.creationBrief?.motionPlan || null, []);
  return { spec, compiled: PromptEngine.compile(profile, spec, []) };
}

/* ================================================= 2. SHOT A → SHOT B TOKENS
   =========================================================================== */

/* DISJOINT VOCABULARY, SO CONTAMINATION IS MECHANICAL RATHER THAN A JUDGEMENT CALL.
   No token below appears in the other shot, in the shared fixture, or in any shipped
   placeholder — the last of which matters, because the reported symptom WAS a shipped
   placeholder. */
const SHOT_A_TOKENS = Object.freeze(["COUPLER", "CABLESPINE", "STATUSLIGHT", "CONNECTORLOCK"]);
const SHOT_B_TOKENS = Object.freeze(["SWAMPWATER", "WALKCYCLE", "FOLDINGCHAIR"]);

const SHOT_A = "L1-01";
const SHOT_B = "L1-02";

function twoShotFixture() {
  const project = buildFixture();
  const a = project.shots[0];
  a.title = "Coupler seat";
  a.desc = `The worker seats the ${SHOT_A_TOKENS[0]} against the ${SHOT_A_TOKENS[1]}.`;
  const b = JSON.parse(JSON.stringify(a));
  b.id = SHOT_B;
  b.title = "Swamp crossing";
  b.desc = `The worker crosses the ${SHOT_B_TOKENS[0]} toward the ${SHOT_B_TOKENS[2]}.`;
  b.keyframes = (b.keyframes || []).map((frame) => ({ ...frame, id: `${frame.id}-b` }));
  b.clips = (b.clips || []).map((clip) => ({ ...clip, id: `${clip.id}-b`, motionPrompt: "", note: "", generationPackages: [] }));
  delete b.creationBrief;
  project.shots.push(b);
  return project;
}

/* Author shot A the way a filmmaker does: through the shipped handlers, in a real
   dispatch, with nothing written directly onto the record. */
function authorShotA(context) {
  vm.runInContext(`(() => {
    const s = shotById("${SHOT_A}");
    const c = ensureShotCreation(s);
    const unit = (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || s.clips[0];
    setMotionSoundField("${SHOT_A}", unit.id, "performance", "action", "Right hand seats the ${SHOT_A_TOKENS[0]}.");
    setMotionSoundField("${SHOT_A}", unit.id, "performance", "objectInteraction", "the ${SHOT_A_TOKENS[1]} is stabilised by the left hand");
    setMotionSoundField("${SHOT_A}", unit.id, "performance", "secondaryMotion", "a ${SHOT_A_TOKENS[2]} goes dark");
    setMotionSoundField("${SHOT_A}", unit.id, "performance", "endingState", "hand resting on the ${SHOT_A_TOKENS[3]}");
    setMotionSubject("${SHOT_A}", "KAI", "action", "gesture");
    setMotionSubject("${SHOT_A}", "KAI", "notes", "reaches for the ${SHOT_A_TOKENS[0]}");
    setMotionPlanField("${SHOT_A}", "camera", "move", "push-in");
  })()`, context);
}

/* What shot B holds, read through the same three surfaces that feed a package. */
function readShotState(context, shotId) {
  return vm.runInContext(`(() => {
    const s = shotById(${JSON.stringify(shotId)});
    const c = ensureShotCreation(s);
    const unit = (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || s.clips[0];
    return JSON.stringify({
      summary: structuredMotionSummary(s),
      brief: motionSoundBriefPayload(s, unit, c),
      plan: JSON.parse(JSON.stringify(c.motionPlan || {})),
      unitPlan: JSON.parse(JSON.stringify(unit.motionPlan || {})),
      note: String(unit.note || ""),
      motionPrompt: String(unit.motionPrompt || ""),
    });
  })()`, context);
}

async function contaminationRun(order) {
  const project = twoShotFixture();
  const { context } = await render(`#/shot/${order[0]}`, project, {
    storage: {
      [`cinebraid-focused:fixture:shot-task:${SHOT_A}`]: "motion",
      [`cinebraid-focused:fixture:shot-task:${SHOT_B}`]: "motion",
    },
  });
  const seen = [];
  for (const shotId of order) {
    vm.runInContext(`location.hash = "#/shot/${shotId}"; route();`, context);
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (shotId === SHOT_A) authorShotA(context);
    seen.push({ shotId, state: readShotState(context, shotId) });
  }
  return { order, seen, context };
}

function assertNoForeignTokens(run) {
  for (const step of run.seen) {
    const foreign = step.shotId === SHOT_B ? SHOT_A_TOKENS : SHOT_B_TOKENS;
    for (const token of foreign) {
      assert.ok(!step.state.includes(token),
        `order ${run.order.join("→")}: shot ${step.shotId} carries ${token}, which belongs to the other shot; ` +
        "composer semantic state must be shot-scoped and no reuse relationship authorised this");
    }
  }
}

/* ================================================================ 3. THE SUITE
   =========================================================================== */

async function main() {
  /* ---- 0. The fixture is the product's own blank, not a guess at it. -------- */
  await sameAsShippedNormalizer();

  /* ---- 1. WALK VS STILL ---------------------------------------------------- */
  testWalkVsStillSurvivesCompilation();
  testUndeclaredTimingAddsNoHoldRequirement();
  testUndirectedPropContributesNoBeat();
  testDerivedLabelIsNotADeclaration();
  testDeclaredStillnessStillCompiles();
  testWalkVsStillThroughTheModelPack();

  const browser = await walkVsStillThroughTheBrowser();
  testBrowserSummaryManufacturesNothing(browser.summary);
  /* The same claim of the composer safe mode falls back to. */
  testBrowserSummaryManufacturesNothing(baseComposerSummary(browser.context));
  const endToEnd = compileFromLiveProject(browser.live, "L1-01", browser.summary);
  assert.ok(!/remains still except for natural breathing and blinking/i.test(endToEnd.compiled.prompt),
    `the composer summary reached the compiled prompt as a stillness directive: ${endToEnd.compiled.prompt.slice(0, 500)}`);
  assert.ok(endToEnd.compiled.prompt.includes("checks the panel") || endToEnd.compiled.prompt.includes("walks the length of the hull"),
    `the shot's own declared action must survive to the compiled prompt: ${endToEnd.compiled.prompt.slice(0, 500)}`);

  /* ---- 2. SHOT A → SHOT B, three orders ------------------------------------ */
  const orders = [[SHOT_A, SHOT_B], [SHOT_B, SHOT_A], [SHOT_A, SHOT_B, SHOT_A]];
  const runs = [];
  for (const order of orders) {
    const run = await contaminationRun(order);
    assertNoForeignTokens(run);
    runs.push(run);
  }
  /* ORDER INDEPENDENCE. The same shot, reached by three different paths, must hold the
     same state — otherwise "clean" is only true of the path this suite happened to walk. */
  const bStates = runs.map((run) => run.seen.filter((step) => step.shotId === SHOT_B).map((step) => step.state)).flat();
  for (const state of bStates)
    assert.strictEqual(state, bStates[0],
      "shot B's composer state must not depend on which shot was open before it");
  const aStates = runs.flatMap((run) => run.seen.filter((step) => step.shotId === SHOT_A).map((step) => step.state));
  for (const state of aStates)
    assert.strictEqual(state, aStates[0],
      "shot A's composer state must be the same whether it was reached first, second or third");
  /* And the positive half: the authored facts really are there, so "no foreign tokens"
     is not passing against an empty composer. */
  for (const token of SHOT_A_TOKENS)
    assert.ok(aStates[0].includes(token), `shot A must actually carry its own ${token}`);

  /* ---- 2b. THE EMPTY-COMPOSER FALLTHROUGH (hold correction, blocker 4) ----- */
  await testEmptyComposerFallsThroughToShotNarrative();
  await testUndirectedShotStillRefuses();
  await testDeclaredPlanFieldAloneAvoidsTheRefusal();

  /* ---- 3. THE REPORTED STRINGS ARE SHIPPED PLACEHOLDERS -------------------- */
  testReportedStringsArePlaceholders();

  /* ---- 4. PRECEDENCE: A, B, C, D ------------------------------------------ */
  testDeclaredCameraFieldDoesNotPromoteItsSiblings();
  testDeclaredTimingFieldDoesNotPromoteItsSiblings();
  testDeclaredEnvironmentFieldDoesNotPromoteItsSiblings();
  testDeclaredSubjectFieldDoesNotPromoteItsSiblings();
  testOrphanedSubjectDoesNotCompile();
  testUnestablishedMembershipFiltersNothing();
  testDeclaredAudioModeSurvivesTheMotionBrief();
  testUnsetAudioModeMayStillBeDerived();
  await testDeclaredAudioModeSurvivesTheServerRoute();
  await testBrowserSummaryDoesNotPromoteSiblings();
  testDeclaredCameraOutranksDefaultedPlan();
  testDeclaredPlanCameraIsApplied();
  testLowerLayerDefaultSurvivesWhenNothingContradictsIt();
  testUnknownDimensionMayStillBeFilled();
  testNoDeclaredActionBecomesAVisibleGap();

  /* ---- 5. INTENT EDIT → STALE → REBUILD ----------------------------------- */
  await testIntentEditRebuildUsesCurrentState();

  console.log("shot-intent compiler integrity: PASS");
}

/* =========================================================== 0. FIXTURE TRUTH
   =========================================================================== */

/* The blank literals above have to be what the SHIPPED normalizer writes, or REPRO 1 is
   being reproduced against a shape the product never produces. Asked of the real browser
   file through the render harness, and of the shared table, so an edit to either is a
   failure here rather than a quietly weaker suite. */
async function sameAsShippedNormalizer() {
  const project = buildFixture();
  const { context } = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  const produced = JSON.parse(vm.runInContext(`(() => {
    /* An empty subject row and an empty prop row, handed to the shipped normalizer.
       What it fills them with IS the definition of "the filmmaker said nothing". */
    const plan = { subjects: { probe: {} }, props: { probe: {} } };
    return JSON.stringify(normalizeMotionPlanForTest(plan));
  })()`, wireNormalizerProbe(context)));
  assert.deepStrictEqual(produced.subjects.probe, { ...BLANK_SUBJECT },
    "the suite's blank subject must be what the shipped normalizer writes");
  assert.deepStrictEqual(produced.props.probe, { ...BLANK_PROP },
    "the suite's blank prop must be what the shipped normalizer writes");
  assert.deepStrictEqual(produced.camera, { ...BLANK_CAMERA },
    "the suite's blank camera must be what the shipped normalizer writes");
  assert.deepStrictEqual(produced.environment, { ...BLANK_ENVIRONMENT },
    "the suite's blank environment must be what the shipped normalizer writes");
  assert.deepStrictEqual(produced.timing, { ...BLANK_TIMING },
    "the suite's blank timing must be what the shipped normalizer writes");
  /* The declaration owner's table is the other half of the same fact. */
  assert.deepStrictEqual({ ...MotionIntent.MOTION_PLAN_DEFAULTS.subject }, { ...BLANK_SUBJECT },
    "the declaration owner and the normalizer must agree about what a blank subject is");
  assert.deepStrictEqual({ ...MotionIntent.MOTION_PLAN_DEFAULTS.camera }, { ...BLANK_CAMERA },
    "the declaration owner and the normalizer must agree about what a blank camera is");
  assert.deepStrictEqual({ ...MotionIntent.MOTION_PLAN_DEFAULTS.timing }, { ...BLANK_TIMING },
    "the declaration owner and the normalizer must agree about what a blank timing row is");
}

/* normalizeMotionPlan607 is a closure inside public/v607-composer.js. It is reached the
   only way it is reachable — by handing a partial plan to a motion-unit reset and reading
   what comes back — rather than by copying its body into this file. */
function wireNormalizerProbe(context) {
  vm.runInContext(`window.normalizeMotionPlanForTest = (plan) => {
    const s = shotById("L1-01");
    const c = ensureShotCreation(s);
    const before = c.motionPlan;
    c.motionPlan = plan;
    const out = JSON.parse(JSON.stringify(ensureShotCreation(s).motionPlan));
    c.motionPlan = before;
    return out;
  };`, context);
  return context;
}

/* ================================================= 3. THE PLACEHOLDER FINDING
   =========================================================================== */

const REPORTED_STRINGS = Object.freeze([
  "frightened but controlled",
  "jaw tightens, eyes track the cable",
  "right hand seats the coupler while the left stabilizes the cable",
  "a status light goes dark after she stops",
  "from the seedling to the relay",
  "finish with her hand resting on the locked connector",
]);

function testReportedStringsArePlaceholders() {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "motion-sound-composer.js"), "utf8").replace(/\r\n/g, "\n");
  for (const reported of REPORTED_STRINGS) {
    assert.ok(source.includes(`placeholder="e.g. ${reported}"`),
      `"${reported}" was reported as another shot's content leaking into the composer. It is a shipped ` +
      "placeholder, and it must be marked as an example so a filmmaker cannot read grey suggestion text " +
      "as their own writing.");
    assert.ok(!new RegExp(`value="[^"]*${reported.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(source),
      `"${reported}" must never be a VALUE; a placeholder is example text and a value is production truth`);
  }
}

/* ==================================================== 4. THE PRECEDENCE RULES
   =========================================================================== */

/* CASE C. The shot establishes a camera move; the plan's camera row is untouched. The
   declared move must survive. This used to be overwritten unconditionally, so an
   untouched control replaced whatever the shot, its media analysis or an assistant spec
   had established with "locked-off camera with no drift". */
function testDeclaredCameraOutranksDefaultedPlan() {
  const declared = { camera: { movement: "slow dolly push-in that begins at 1.0s", shotSize: "medium-wide", lensIntent: "focus stays on Rex" } };
  const result = compileSwamp(blankPlan(), { mediaAnalysis: declared });
  assert.strictEqual(result.spec.camera.movement, "slow dolly push-in that begins at 1.0s",
    `a defaulted camera row must not overwrite a declared camera movement: ${result.spec.camera.movement}`);
  assert.ok(withheldFields(result.spec).includes("camera::move"),
    "the withheld record must name the camera field it declined to apply");
}

/* THE INVERSE. A camera the filmmaker DID direct on the motion pass is the closest
   current-shot declaration and still wins. */
function testDeclaredPlanCameraIsApplied() {
  const plan = blankPlan();
  plan.camera = { ...BLANK_CAMERA, move: "push-in", direction: "toward-camera", intensity: "energetic" };
  const result = compileSwamp(plan, { mediaAnalysis: { camera: { movement: "locked" } } });
  assert.ok(/push in/.test(result.spec.camera.movement),
    `a declared plan camera must reach the spec: ${result.spec.camera.movement}`);
  assert.ok(declaredFields(result.spec).includes("camera::move"),
    "a declared camera move must be recorded as taken, by name");
}

/* CASE B. The shot declares no subject movement of its own, and a LOWER layer supplies
   harmless idle — the compiler's own restrained-movement default, which is the real
   product's version of "add natural breathing and blinking". Nothing declared contradicts
   it, so it must survive untouched.

   This is the assertion that stops the repair becoming the opposite defect. Withholding a
   DEFAULTED plan row must not also strip the legitimate defaults sitting beneath it: the
   whole point of silence is that the layer below gets to answer. */
function testLowerLayerDefaultSurvivesWhenNothingContradictsIt() {
  const context = swampContext({ shot: { motionDirection: "Rex sits on the folding chair and waits." } });
  const profile = motionProfile();
  const seeded = PromptEngine.defaultSpec(context, "motion", profile.mode || "i2v", [], null);
  const beforePerformance = JSON.parse(JSON.stringify(seeded.performance));
  const beforeCamera = JSON.parse(JSON.stringify(seeded.camera));
  assert.ok(beforePerformance.movementIntensity,
    "the fixture must actually carry a lower-layer movement default, or this case proves nothing");
  const after = PromptEngine.applyStructuredDirection(seeded, null, blankPlan(), []);
  assert.deepStrictEqual(after.performance, beforePerformance,
    "withholding a defaulted motion row must not strip the performance defaults beneath it");
  assert.deepStrictEqual(after.camera, beforeCamera,
    "withholding a defaulted motion row must not strip the camera defaults beneath it");
  assert.ok((after.actions || []).some((row) => /sits on the folding chair/.test(String(row.action || ""))),
    `the shot's own declared action must survive alongside the lower-layer default: ${JSON.stringify(after.actions)}`);
}

/* CASE D. A dimension the current shot leaves unset stays open, so a legitimate model or
   compiler default may fill it. The repair must not become a blanket refusal of every
   default — that would be the opposite defect wearing the same coat. */
function testUnknownDimensionMayStillBeFilled() {
  const result = compileSwamp(blankPlan());
  assert.ok(result.spec.camera.movement,
    "a camera nobody declared must still carry the compiler's own default so a model is not left guessing");
  assert.strictEqual(result.spec.camera.movement, "No camera movement unless specified by the shot.",
    `the gap must be filled by defaultSpec's own placeholder, not by the plan: ${result.spec.camera.movement}`);
  /* And the package still compiles: nothing about withholding a default is a refusal. */
  assert.ok(result.compiled.prompt.length > 0, "withholding a defaulted control must not block compilation");
  assert.ok(result.compiled.prompt.includes("unrequested characters, props, text or camera moves"),
    "the shipped must-avoid still tells the model not to invent a camera move, which is what an undeclared camera actually means");
}

/* THE HONEST FAILURE MODE. A shot that declares no action at all used to receive a
   manufactured "<id> still" and compile as though it had been directed. It now reaches
   the model pack's own `no-action` warning — a visible gap in place of a confident lie. */
function testNoDeclaredActionBecomesAVisibleGap() {
  /* Every source defaultSpec() falls back through, emptied: the shot's motion direction,
     its description, the scene beat and the shot title. */
  const result = compileSwamp(blankPlan(), {
    shot: { description: "", motionDirection: "", title: "" },
    top: { scene: { title: "The crossing", beat: "", feeling: "Grim" } },
  });
  assert.deepStrictEqual(result.beats, [],
    `a shot nobody directed must compile no beats, and it produced: ${JSON.stringify(result.beats)}`);
  const plan = Compiler.compileGenerationPlan({
    spec: result.spec,
    references: [],
    mode: "t2v",
    modelId: F.modelIdFor("t2v"),
    surface: "api",
    capability: F.capabilityFor("t2v", "api"),
  });
  assert.ok((plan.warnings || []).some((row) => row.code === "no-action"),
    `an undirected shot must produce a visible no-action warning: ${JSON.stringify(plan.warnings)}`);
}

/* ================================== 5. INTENT EDIT → STALE → REBUILD (V1→V2)
   =========================================================================== */

const INTENT_V1 = "Rex WADES through the SWAMPWATER toward the far bank.";
const INTENT_V2 = "Rex CLIMBS the LADDERWELL out of the water and does not look back.";

/* Slice 0's freshness architecture is reused, not rewritten: packageInputSnapshot()
   records what a package was compiled from, packageStaleReasons() compares that against
   what the shot says now, and currentDirectionForPackage() reads `unit.motionPrompt ||
   unit.note` — the same field the manufactured summary used to land in. */
async function testIntentEditRebuildUsesCurrentState() {
  const project = buildFixture();
  project.shots[0].clips = [project.shots[0].clips[0]];
  const { context } = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });

  const staged = JSON.parse(vm.runInContext(`(() => {
    const s = shotById("L1-01");
    const c = ensureShotCreation(s);
    const unit = s.clips[0];
    unit.motionPrompt = ${JSON.stringify(INTENT_V1)};
    unit.note = ${JSON.stringify(INTENT_V1)};
    c.motionDuration = unit.dur;
    c.motionProfileId = "minimax-h3/i2v";
    const pack = { id: "pack-v1", packageId: "L1-01-MOTION-R01", kind: "guided-motion", segmentId: unit.id, scope: "segment:" + unit.id, durationSeconds: unit.dur, profileId: "minimax-h3/i2v", mode: "i2v", references: [] };
    pack.dependencySnapshot = packageInputSnapshot(s, pack, [], currentDirectionForPackage(s, pack));
    const fresh = packageStaleReasons(s, pack);
    unit.motionPrompt = ${JSON.stringify(INTENT_V2)};
    unit.note = ${JSON.stringify(INTENT_V2)};
    const stale = packageStaleReasons(s, pack);
    const rebuiltDirection = currentDirectionForPackage(s, pack);
    const rebuilt = { ...pack, id: "pack-v2", packageId: "L1-01-MOTION-R02" };
    rebuilt.dependencySnapshot = packageInputSnapshot(s, rebuilt, [], rebuiltDirection);
    return JSON.stringify({ fresh, stale, rebuiltDirection, rebuiltStale: packageStaleReasons(s, rebuilt), project: JSON.parse(JSON.stringify(P)) });
  })()`, context));

  assert.deepStrictEqual(staged.fresh, [],
    `a package compiled from the current intent must read current: ${JSON.stringify(staged.fresh)}`);
  assert.ok(staged.stale.length > 0,
    "changing the shot's declared intent must make the compiled package stale");
  assert.ok(staged.stale.some((row) => /direction/i.test(JSON.stringify(row))),
    `the staleness must name the changed direction: ${JSON.stringify(staged.stale)}`);
  assert.strictEqual(staged.rebuiltDirection, INTENT_V2,
    "a rebuild must read the shot's current intent");
  assert.deepStrictEqual(staged.rebuiltStale, [],
    `the rebuilt package must read current: ${JSON.stringify(staged.rebuiltStale)}`);

  /* The rebuilt PROMPT, not merely the rebuilt snapshot: V1's unique token must be gone
     from the compiled text and V2's must be in it. */
  const rebuilt = compileFromLiveProject(staged.project, "L1-01", INTENT_V2);
  assert.ok(rebuilt.compiled.prompt.includes("LADDERWELL"),
    `the rebuilt prompt must carry the current intent: ${rebuilt.compiled.prompt.slice(0, 400)}`);
  assert.ok(!rebuilt.compiled.prompt.includes("SWAMPWATER"),
    `V1-only semantic content survived the rebuild: ${rebuilt.compiled.prompt.slice(0, 400)}`);
}

/* ============================================ 6. THE HOLD CORRECTION, BLOCKER 1
   ===========================================================================
   ONE DECLARED FIELD MAY NEVER SPEAK FOR ITS UNTOUCHED SIBLINGS.

   The first pass asked "is this camera declared?" and an emitter that got `true` wrote
   the whole row. So the three cases below each set exactly ONE control and got a second,
   third and fourth statement nobody had made — the original defect at a smaller scale,
   and the reason this correction exists. */

/* CASE A. Camera intensity only. The untouched `move` must not become locked-off. */
function testDeclaredCameraFieldDoesNotPromoteItsSiblings() {
  const plan = blankPlan();
  plan.camera = { ...BLANK_CAMERA, intensity: "strong" };
  const declared = { camera: { movement: "slow dolly push-in", shotSize: "medium-wide" } };
  const result = compileSwamp(plan, { mediaAnalysis: declared });
  assert.strictEqual(result.spec.camera.movement, "slow dolly push-in",
    `an untouched camera move must not publish itself beside a declared intensity: ${result.spec.camera.movement}`);
  assert.ok(!/locked/i.test(result.spec.camera.movement),
    `the normalizer's own default reached the compiled camera: ${result.spec.camera.movement}`);
  assert.strictEqual(result.spec.camera.stability, "strong",
    `the declared intensity is the only camera value the plan may contribute: ${result.spec.camera.stability}`);
  assert.deepStrictEqual(declaredFields(result.spec), ["camera::intensity"],
    "provenance must name the field the filmmaker actually set, and only that field");
  assert.strictEqual(withheldReason(result.spec, "camera::move"), "field-carries-no-declaration",
    "the untouched move must be recorded as withheld by name");
}

/* CASE B. Timing pacing only. The untouched `holdEnd` must not require settle-and-hold. */
function testDeclaredTimingFieldDoesNotPromoteItsSiblings() {
  const plan = blankPlan();
  plan.timing = { ...BLANK_TIMING, pacing: "brisk" };
  const result = compileSwamp(plan);
  assert.ok(!result.spec.mustPreserve.includes("settle into and briefly hold the final state"),
    `an untouched holdEnd must not publish itself beside a declared pacing: ${JSON.stringify(result.spec.mustPreserve)}`);
  assert.strictEqual(withheldReason(result.spec, "timing::holdEnd"), "field-carries-no-declaration",
    "the untouched holdEnd must be recorded as withheld by name");
  /* And the inverse, so this is a distinction rather than a blanket refusal. */
  const held = blankPlan();
  held.timing = { ...BLANK_TIMING, pacing: "brisk", declaredFields: ["holdEnd"] };
  const heldResult = compileSwamp(held);
  assert.ok(heldResult.spec.mustPreserve.includes("settle into and briefly hold the final state"),
    "a declared hold must still reach the requirement list");
}

/* CASE C. Environment intensity only. The untouched `action` must not assert stability. */
function testDeclaredEnvironmentFieldDoesNotPromoteItsSiblings() {
  const plan = blankPlan();
  plan.environment = { ...BLANK_ENVIRONMENT, intensity: "strong" };
  const result = compileSwamp(plan);
  assert.deepStrictEqual(result.spec.environmentMotion, [],
    `an untouched environment action must not publish itself beside a declared intensity: ${JSON.stringify(result.spec.environmentMotion)}`);
  assert.strictEqual(withheldReason(result.spec, "environment::intensity"), "environment-qualifier-without-a-declared-action",
    "a qualifier with nothing to qualify must say so rather than be dropped");
  /* Declared action, and the declared qualifier rides with it. */
  const windy = blankPlan();
  windy.environment = { ...BLANK_ENVIRONMENT, action: "wind", intensity: "strong" };
  const windyResult = compileSwamp(windy);
  assert.deepStrictEqual(windyResult.spec.environmentMotion, ["wind, strong"],
    `a declared environment action must compile with its declared qualifier: ${JSON.stringify(windyResult.spec.environmentMotion)}`);
}

/* The same rule inside one subject row: an end position is not permission to publish an
   action nobody chose. */
function testDeclaredSubjectFieldDoesNotPromoteItsSiblings() {
  const plan = blankPlan();
  plan.subjects[REX] = { ...BLANK_SUBJECT, destination: "on the far bank" };
  const result = compileSwamp(plan);
  assert.strictEqual(firstBeat(result), `${REX} ending on the far bank`,
    `only the declared field may compile: ${JSON.stringify(result.beats)}`);
  assert.ok(!/\bstill\b/.test(firstBeat(result)),
    `the untouched action reached the beat: ${firstBeat(result)}`);
  assert.deepStrictEqual(declaredFields(result.spec), [`subject:${REX}:destination`],
    "provenance must name the one field that contributed");
}

/* ============================================ 7. THE HOLD CORRECTION, BLOCKER 3
   ===========================================================================
   A SUBJECT THAT LEFT THE SHOT STOPS DIRECTING IT.

   Its stored row stays on the record — history is not deleted to make a compile succeed —
   but the compiled prompt is about the shot as it stands now. */
function testOrphanedSubjectDoesNotCompile() {
  const GHOST = "CH-GHOST";
  const plan = blankPlan();
  plan.subjects[GHOST] = { ...BLANK_SUBJECT, action: "run", notes: "ORPHANTOKEN" };
  plan.subjects[REX] = { ...BLANK_SUBJECT, action: "walk" };
  /* The shot's cast is Rex and the chair. CH-GHOST is in the stored plan and nowhere
     else, which is exactly what a character removed from the shot leaves behind. */
  const result = compileSwamp(plan);
  assert.ok(!result.beats.some((beat) => beat.includes("ORPHANTOKEN")),
    `a subject that no longer belongs to this shot still directed it: ${JSON.stringify(result.beats)}`);
  assert.ok(!result.compiled.prompt.includes("ORPHANTOKEN"),
    `the orphan reached the compiled prompt: ${result.compiled.prompt.slice(0, 400)}`);
  assert.strictEqual(withheldReason(result.spec, `subject:${GHOST}:`), "not-a-member-of-the-current-shot",
    "the orphan must be recorded as withheld for the reason it was withheld");
  /* The stored row is untouched — the filter is a compilation boundary, not a deletion. */
  assert.ok(plan.subjects[GHOST] && plan.subjects[GHOST].notes === "ORPHANTOKEN",
    "the historic row must remain in the project bytes");
  /* And a current member still compiles normally beside it. */
  assert.ok(result.beats.some((beat) => beat.startsWith(`${REX} walk`)),
    `a current subject must still compile: ${JSON.stringify(result.beats)}`);
}

/* MEMBERSHIP THAT WAS NEVER ESTABLISHED IS NOT AN EMPTY MEMBERSHIP. A caller that
   supplied no entity context cannot be told who belongs, so nothing may be filtered —
   otherwise the correction would silently delete every directed subject in any compile
   built without references. */
function testUnestablishedMembershipFiltersNothing() {
  const context = swampContext();
  context.references = [];
  const profile = motionProfile();
  let spec = PromptEngine.defaultSpec(context, "motion", profile.mode || "i2v", [], null);
  assert.deepStrictEqual([...(spec.promptEntities || []), ...(spec.blockingEntities || [])], [],
    "the fixture must actually establish no membership, or this case proves nothing");
  const plan = blankPlan();
  plan.subjects[REX] = { ...BLANK_SUBJECT, action: "walk" };
  spec = PromptEngine.applyStructuredDirection(spec, null, plan, []);
  assert.ok((spec.actions || []).some((row) => String(row.action).startsWith(`${REX} walk`)),
    `an unestablished membership must filter nothing: ${JSON.stringify((spec.actions || []).map((row) => row.action))}`);
}

/* ============================================ 8. THE HOLD CORRECTION, BLOCKER 2
   ===========================================================================
   A DECLARED AUDIO MODE IS NOT THE MOTION BRIEF'S TO REPLACE.

   A shot set to lip-sync a recorded reference came back as `generate-voice` WITH THE
   REFERENCE STILL ATTACHED: applyMotionAudioBrief() recomputed the mode from "is native
   audio on and is there a line", which is the right derivation for a shot nobody has
   answered for and a silent overwrite of one who has. The reference survived because
   `referenceKey` is not in that assignment; the decision did not. */

const LIP_SYNC_LINE = "You said the coupler would hold.";
const AUDIO_REFERENCE_KEY = "kai-dialogue-take";

function lipSyncPlan() {
  const plan = blankPlan();
  plan.audio = {
    mode: "lip-sync-reference",
    referenceKey: AUDIO_REFERENCE_KEY,
    speakerId: REX,
    voiceEntityId: "",
    lipSync: true,
    direction: "close, unhurried",
  };
  return plan;
}
function lipSyncReferences() {
  return [{ key: AUDIO_REFERENCE_KEY, label: "Rex dialogue take", mediaType: "audio", role: "audio-timing", sourceType: "audio" }];
}
function lipSyncBrief() {
  return {
    schemaVersion: 1,
    performance: { action: "Rex speaks the line without moving from the chair." },
    camera: {},
    dialogue: { line: LIP_SYNC_LINE, speakerId: REX, speakerName: "Rex", language: "English", locked: true },
    sound: { sfxEvents: [] },
    output: { resolution: "model-default", nativeAudio: true },
  };
}

/* THE DIRECT HELPER PATH, in the order server.js calls them. */
function testDeclaredAudioModeSurvivesTheMotionBrief() {
  const context = swampContext({ shot: { audio: { dialogue: LIP_SYNC_LINE, sfx: "" } } });
  const profile = motionProfile();
  let spec = PromptEngine.defaultSpec(context, "motion", profile.mode || "i2v", lipSyncReferences(), null);
  spec = PromptEngine.applyStructuredDirection(spec, null, lipSyncPlan(), lipSyncReferences());
  assert.strictEqual(spec.audio.mode, "lip-sync-reference",
    "the fixture must actually declare lip-sync before the brief runs, or this case proves nothing");
  spec = PromptEngine.applyMotionAudioBrief(spec, lipSyncBrief());
  assert.strictEqual(spec.audio.mode, "lip-sync-reference",
    `a declared audio mode must survive the motion brief: ${spec.audio.mode}`);
  assert.strictEqual(spec.audio.referenceKey, AUDIO_REFERENCE_KEY,
    "the reference the declaration names must still be attached");
  /* The mode is not a label on its own. Lip-sync means the words are a TRANSCRIPT of a
     recording, and an empty `dialogue` is what stops a second voice being generated. */
  assert.strictEqual(spec.audio.dialogue, "",
    `lip-sync mode must not also request a generated voice: ${JSON.stringify(spec.audio.dialogue)}`);
  assert.strictEqual(spec.audio.transcript, LIP_SYNC_LINE,
    `the words belong in the transcript under lip-sync: ${JSON.stringify(spec.audio.transcript)}`);
}

/* AND THE INVERSE: a mode nobody declared is still derived, so this is a precedence rule
   rather than a refusal to answer. */
function testUnsetAudioModeMayStillBeDerived() {
  const context = swampContext();
  const profile = motionProfile();
  let spec = PromptEngine.defaultSpec(context, "motion", profile.mode || "i2v", [], null);
  spec = PromptEngine.applyStructuredDirection(spec, null, blankPlan(), []);
  assert.strictEqual(spec.audio.mode, "none", "an untouched audio plan declares nothing");
  spec = PromptEngine.applyMotionAudioBrief(spec, lipSyncBrief());
  assert.strictEqual(spec.audio.mode, "generate-voice",
    `an unset mode must still be derived from the brief: ${spec.audio.mode}`);
  assert.strictEqual(spec.audio.dialogue, LIP_SYNC_LINE,
    "a derived generate-voice mode still carries the line as dialogue");
}

/* ============================================ 9. THE HOLD CORRECTION, BLOCKER 4
   ===========================================================================
   AN EMPTY HIGHER LAYER FALLS THROUGH; IT DOES NOT REFUSE.

   Once the composer stopped manufacturing a line for every untouched control, the
   "Choose at least one motion direction" refusal became reachable — and started firing on
   shots that ARE directed, because the filmmaker had written the action in the shot
   description instead of the motion composer. /api/prompt/compile never ran.

   These cases drive the shipped handler and watch whether the request is made. */

const NARRATIVE_LOWER_SOURCE_TOKEN = "NARRATIVELOWERSOURCE";

/* One run of buildGuidedMotionPrompt against a recording fetch stub. Returns the compile
   request body if the handler made one, and null if it refused. */
async function motionCompileAttempt(project, { shotId = "L1-01" } = {}) {
  const seen = [];
  const { context } = await render(`#/shot/${shotId}`, project, {
    storage: { [`cinebraid-focused:fixture:shot-task:${shotId}`]: "motion" },
    fetch: async (url, options, respond) => {
      if (url !== "/api/prompt/compile") return null;
      seen.push(JSON.parse(String(options.body || "{}")));
      return respond({
        compiledPrompt: "COMPILED",
        spec: { schemaVersion: 1, actions: [] },
        references: [],
        warnings: [],
        confirmations: [],
        profile: { name: "MiniMax H3", profileVersion: "1" },
      });
    },
  });
  await vm.runInContext(`buildGuidedMotionPrompt(${JSON.stringify(shotId)}, false)`, context);
  await new Promise((resolve) => setTimeout(resolve, 120));
  return { request: seen[0] || null, context };
}

/* The fixture a filmmaker actually has: an action written on the shot, a motion composer
   nobody has opened, and no free-text motion direction anywhere. */
function narrativeOnlyFixture() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.desc = `Kai walks the length of the hull. ${NARRATIVE_LOWER_SOURCE_TOKEN}`;
  shot.motionPrompt = "";
  shot.clips = [{ ...shot.clips[0], motionPrompt: "", note: "", title: "", generationPackages: [] }];
  delete shot.creationBrief;
  return project;
}

/* CASE B. Untouched composer, valid current-shot narrative. No refusal; the compile runs
   and the lower current-shot direction is what reaches it. */
async function testEmptyComposerFallsThroughToShotNarrative() {
  const attempt = await motionCompileAttempt(narrativeOnlyFixture());
  assert.ok(attempt.request,
    "an untouched composer beside a directed shot must fall through to the shot's own narrative, not refuse");
  assert.strictEqual(String(attempt.request.directive || ""), "",
    "the higher layers really are empty here — the request carries no directive of its own");
  assert.strictEqual(String(attempt.request.shotId || ""), "L1-01",
    "the request must name the shot whose narrative will answer for it");
  /* WHERE THE ANSWER ACTUALLY COMES FROM. The browser sends no directive because it has
     none; buildContext() then falls through `motionPrompt || note || title` to the shot's
     own narrative, which is the layer the precedence says should answer. Resolved here
     the way the server resolves it, so the claim is about the compiled prompt rather than
     about the request that asked for it. */
  const live = vm.runInContext("JSON.parse(JSON.stringify(P))", attempt.context);
  const compiled = compileFromLiveProject(live, "L1-01", "");
  assert.ok(compiled.compiled.prompt.includes(NARRATIVE_LOWER_SOURCE_TOKEN),
    `the lower current-shot direction must be what the compile is built from: ${compiled.compiled.prompt.slice(0, 400)}`);
}

/* CASE A. A shot directed at no layer at all still gets the honest refusal. */
async function testUndirectedShotStillRefuses() {
  const project = narrativeOnlyFixture();
  project.shots[0].desc = "";
  project.shots[0].title = "";
  const attempt = await motionCompileAttempt(project);
  assert.strictEqual(attempt.request, null,
    "a shot with no motion intent at any layer must still refuse rather than compile from nothing");
}

/* CASE C. A declared motion-plan field is itself enough; the composer summary is the
   higher layer and it is no longer empty. */
async function testDeclaredPlanFieldAloneAvoidsTheRefusal() {
  const project = narrativeOnlyFixture();
  project.shots[0].desc = "";
  project.shots[0].title = "";
  project.shots[0].creationBrief = {
    motionPlan: { camera: { move: "push-in" }, subjects: {}, props: {}, environment: {}, timing: {}, audio: {} },
  };
  const attempt = await motionCompileAttempt(project);
  assert.ok(attempt.request,
    "a declared motion-plan field must be enough to compile, with no narrative and no free text");
}

/* ================================ 8b. THE REAL SERVER ORDERING, BLOCKER 2
   ===========================================================================
   The helper pair above is the shape of the defect; THIS is the path a filmmaker takes.

   server.js runs applyStructuredDirection() and then applyMotionAudioBrief() on the same
   spec, in that order, inside POST /api/prompt/compile. Asserting the two helpers in
   sequence proves they compose; it does not prove the route composes them the same way,
   and the reviewer reproduced the overwrite through the route. So the route is started
   and asked.

   The server runs against a sandbox in the system temp directory — its own config and its
   own projects root, through the env vars the product already supports — so nothing here
   touches this repository's `data/` or its shipped sample. `useLLM: false` keeps the
   route deterministic and offline: no assistant is contacted, and no provider,
   model or paid call is made by any part of this. */

function freePort() {
  const net = require("net");
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function sandboxProject() {
  return {
    meta: { title: "Motion Intent Sandbox", format: "Test", version: "v1", hubVersion: "v5.5.0", aiPolicy: "disabled" },
    qcChecklist: [],
    characters: [{ id: REX, name: "Rex", canon: "", audio: { voiceDesignPrompt: "" } }],
    locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC-01", title: "The crossing", whatHappens: "Rex crosses the swamp." }],
    shots: [{
      id: "TLS-002",
      scene: "SC-01",
      title: "Swamp crossing",
      desc: "Rex sits on the folding chair and speaks.",
      positioning: "Wide.",
      dur: 6,
      characters: [REX],
      keyframes: [{ id: "frame-a", label: "A", title: "Opening frame", winner: "", generationPackages: [] }],
      clips: [{ id: "seg-a", suffix: "a", label: "A", kind: "i2v", dur: 6, motionPrompt: "", note: "", generationPackages: [] }],
    }],
  };
}

async function withMotionIntentServer(body) {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { spawn } = require("child_process");
  const root = path.join(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-motion-intent-"));
  const projectsRoot = path.join(temp, "projects");
  const projectDir = path.join(projectsRoot, "motion-intent-sandbox");
  fs.mkdirSync(projectDir, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"]) fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(sandboxProject(), null, 2));
  const configPath = path.join(temp, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    activeProject: "motion-intent-sandbox",
    assistant: { provider: "none", visionProvider: "none" },
    agents: { enabled: false, maxConcurrent: 1 },
    generation: { fal: { enabled: false } },
  }, null, 2));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let log = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`the sandbox server did not start:\n${log}`);
      try { if ((await fetch(`${base}/api/me`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    const response = await fetch(`${base}/api/prompt/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch {}
    return { status: response.status, body: parsed, raw: text, log };
  } finally {
    child.kill();
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  }
}

async function testDeclaredAudioModeSurvivesTheServerRoute() {
  const result = await withMotionIntentServer({
    shotId: "TLS-002",
    segmentId: "seg-a",
    profileId: "seedance-2/r2v",
    purpose: "motion",
    durationSeconds: 6,
    useLLM: false,
    directive: "Rex speaks the line without leaving the chair.",
    references: lipSyncReferences(),
    motionPlan: lipSyncPlan(),
    motionBrief: lipSyncBrief(),
    audio: { dialogue: LIP_SYNC_LINE, speakerId: REX, mode: "lip-sync-reference" },
  });
  assert.strictEqual(result.status, 200,
    `the sandbox route must compile the request: ${result.raw.slice(0, 500)}\n${result.log.slice(0, 500)}`);
  assert.strictEqual(result.body.spec?.audio?.mode, "lip-sync-reference",
    `POST /api/prompt/compile replaced a declared lip-sync mode: ${JSON.stringify(result.body.spec?.audio)}`);
  assert.strictEqual(result.body.spec?.audio?.referenceKey, AUDIO_REFERENCE_KEY,
    "the reference the declaration names must still be attached after the route runs");
  assert.strictEqual(result.body.spec?.audio?.dialogue, "",
    `the route must not also request a generated voice: ${JSON.stringify(result.body.spec?.audio?.dialogue)}`);
  assert.strictEqual(result.body.spec?.audio?.transcript, LIP_SYNC_LINE,
    "the words belong in the transcript under lip-sync");
  return result;
}

/* ========================== 6b. THE BROWSER HALF OF BLOCKER 1
   ===========================================================================
   The composer summary manufactured the same sibling defaults, and it is the surface the
   reviewer reproduced case C on: setting the environment INTENSITY published "Environment
   remains stable unless explicitly animated above", which is an assertion about the world
   holding still made by a control nobody opened.

   Driven through the shipped setters, one field at a time, in a real dispatch. */
async function browserSummaryAfter(edits) {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.desc = "Kai walks the length of the hull.";
  for (const clip of shot.clips) { clip.motionPrompt = ""; clip.title = ""; clip.note = ""; }
  const { context } = await render("#/shot/L1-01", project, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  for (const [group, key, value] of edits) {
    vm.runInContext(`setMotionPlanField("L1-01", ${JSON.stringify(group)}, ${JSON.stringify(key)}, ${JSON.stringify(value)})`, context);
  }
  return { summary: vm.runInContext("structuredMotionSummary(P.shots[0])", context), context };
}

async function testBrowserSummaryDoesNotPromoteSiblings() {
  /* CASE A, in the composer. Intensity is declared; the untouched move is not. */
  const camera = await browserSummaryAfter([["camera", "intensity", "strong"]]);
  assert.ok(!/^Camera:/m.test(camera.summary),
    `the summary must not state a camera move nobody chose: ${JSON.stringify(camera.summary)}`);
  /* And with the move itself declared, the line returns, carrying only declared values. */
  const moved = await browserSummaryAfter([["camera", "move", "push-in"], ["camera", "intensity", "strong"]]);
  assert.ok(/^Camera: push in, strong\.$/m.test(moved.summary),
    `a declared camera move must compile with its declared qualifiers and nothing else: ${JSON.stringify(moved.summary)}`);

  /* CASE C, in the composer — the site the reviewer reproduced. */
  const environment = await browserSummaryAfter([["environment", "intensity", "strong"]]);
  assert.ok(!/Environment remains stable/i.test(environment.summary),
    `the summary must not state that the environment holds when nobody said so: ${JSON.stringify(environment.summary)}`);

  /* CASE B, in the composer. */
  const timing = await browserSummaryAfter([["timing", "pacing", "brisk"]]);
  assert.ok(!/settle and hold/i.test(timing.summary),
    `the summary must not state a hold nobody chose: ${JSON.stringify(timing.summary)}`);
  assert.ok(/^Timing: brisk pacing\.$/m.test(timing.summary),
    `a declared pacing must compile on its own: ${JSON.stringify(timing.summary)}`);
}

module.exports = {
  BLANK_SUBJECT, BLANK_PROP, BLANK_CAMERA, BLANK_ENVIRONMENT, BLANK_TIMING,
  REX, CHAIR, DECLARED_WALK, SHOT_A, SHOT_B, SHOT_A_TOKENS, SHOT_B_TOKENS, REPORTED_STRINGS,
  blankPlan, swampContext, compileSwamp, firstBeat, withheldFields, declaredFields, withheldReason,
  walkVsStillThroughTheBrowser, testBrowserSummaryManufacturesNothing, baseComposerSummary,
  compileFromLiveProject, twoShotFixture, contaminationRun, assertNoForeignTokens,
  testWalkVsStillSurvivesCompilation, testUndeclaredTimingAddsNoHoldRequirement,
  testUndirectedPropContributesNoBeat,
  testDerivedLabelIsNotADeclaration, testDeclaredStillnessStillCompiles,
  testWalkVsStillThroughTheModelPack, testReportedStringsArePlaceholders,
  testDeclaredCameraOutranksDefaultedPlan, testDeclaredPlanCameraIsApplied,
  testLowerLayerDefaultSurvivesWhenNothingContradictsIt,
  testUnknownDimensionMayStillBeFilled, testNoDeclaredActionBecomesAVisibleGap,
  testIntentEditRebuildUsesCurrentState, sameAsShippedNormalizer,
  testDeclaredCameraFieldDoesNotPromoteItsSiblings, testDeclaredTimingFieldDoesNotPromoteItsSiblings,
  testDeclaredEnvironmentFieldDoesNotPromoteItsSiblings, testDeclaredSubjectFieldDoesNotPromoteItsSiblings,
  testOrphanedSubjectDoesNotCompile, testUnestablishedMembershipFiltersNothing,
  testDeclaredAudioModeSurvivesTheMotionBrief, testUnsetAudioModeMayStillBeDerived,
  testDeclaredAudioModeSurvivesTheServerRoute, withMotionIntentServer,
  browserSummaryAfter, testBrowserSummaryDoesNotPromoteSiblings,
  lipSyncPlan, lipSyncReferences, lipSyncBrief, LIP_SYNC_LINE, AUDIO_REFERENCE_KEY,
  NARRATIVE_LOWER_SOURCE_TOKEN, narrativeOnlyFixture, motionCompileAttempt,
  testEmptyComposerFallsThroughToShotNarrative, testUndirectedShotStillRefuses,
  testDeclaredPlanFieldAloneAvoidsTheRefusal,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

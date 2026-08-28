/* CineBraid — Dogfood Remediation Slice 1: NEGATIVE CONTROLS.
 *
 * tests/shot-intent-compiler-integrity.js asserts that a defaulted motion control makes
 * no statement and that shot B never carries shot A's semantic facts. Most of those
 * assertions are the shape that most often CANNOT fail:
 *
 *   "no beat asserts stillness"          passes if no beat is produced at all
 *   "shot B carries none of A's tokens"  passes against an empty composer
 *   "the summary states no camera move"  passes if the summary crashed to ""
 *   "the compiled prompt keeps the walk" passes if the compiler happens to say anything
 *
 * So every control below BREAKS THE PRODUCT DELIBERATELY, in a file patched for the
 * duration of the control, and requires the corresponding assertion to catch it. Each
 * control PROVES the break landed and prints the literal bad state BEFORE it judges the
 * detector: a probe guarded by the same assert() it is testing reports success while
 * mutating nothing, which is a lesson this repository has already paid for.
 *
 *   NC-M1   the subject guard is removed, so an untouched control puts "<id> still" in
 *           front of the shot's declared travelling walk — the dogfood defect exactly
 *   NC-M2   the prop guard is removed, so a prop nobody directed contributes a beat
 *   NC-M3   the declaration reader calls every stored entry declared, so the guard is
 *           present and discriminates nothing
 *   NC-M4   the derived-field exclusion is dropped, so a stale target label alone
 *           resurrects an otherwise blank entry
 *   NC-M5   the marked reading is dropped, so a filmmaker who deliberately re-chooses
 *           "Remain still" is silenced — the repair over-blocking instead of under-
 *   NC-M6   the camera guard is removed, so an untouched camera row overwrites a camera
 *           movement the shot had established
 *   NC-M7   the timing guard is removed, so an untouched timing row adds a requirement to
 *           settle and hold the final state to a shot that ends mid-stride
 *   NC-M8   the browser summary states stillness for an undirected cast member again
 *   NC-M9   the browser summary states an undirected camera move again
 *   NC-M10  composer state stops being shot-scoped, so shot B shows shot A's brief and
 *           the A→B contamination fixture reproduces
 *   NC-M11  the composer's example placeholders stop being marked as examples, so grey
 *           suggestion text about someone else's scene reads as the filmmaker's own
 *   NC-M12  package freshness reads the saved snapshot as the current direction, so an
 *           edited Shot Intent leaves the compiled package reading current
 *   NC-M13  the base composer that safe mode falls back to states stillness for an
 *           undirected cast member again
 *
 * THE HOLD-CORRECTION CONTROLS, one per guard the four blockers closed:
 *
 *   NC-M14  the camera guard asks per row again, so one declared intensity publishes an
 *           untouched move as locked-off
 *   NC-M15  the timing guard asks per row again, so one declared pacing requires
 *           settle-and-hold
 *   NC-M16  the subject clause asks per row again, so an end position publishes the
 *           untouched action beside it
 *   NC-M17  the composer's environment guard asks per row again, so one declared
 *           intensity states that the world holds still
 *   NC-M18  the motion brief recomputes the audio mode unconditionally, so a declared
 *           lip-sync becomes generate-voice with the reference still attached
 *   NC-M19  the same, through a live POST /api/prompt/compile rather than the helpers
 *   NC-M20  the current-shot membership boundary is removed, so a subject dropped from
 *           the cast keeps directing the shot it left
 *   NC-M21  the motion refusal ignores the shot's own narrative again, so a directed
 *           shot never reaches /api/prompt/compile
 *
 * THE SECOND HOLD-CORRECTION CONTROLS:
 *
 *   NC-M22  the BASE composer's audio writer stops marking the field, so an explicitly
 *           chosen "No audio" is classified defaulted and derived into generate-voice
 *   NC-M23  the ENHANCED composer's audio writer stops marking it, same outcome — the
 *           half-repair this pair exists to forbid
 *   NC-M24  the motion refusal reads a generated unit title as motion intent, so an
 *           undirected shot buys a package on the strength of a label the product wrote
 *   NC-M25  buildContext reads the same generated title as the shot's subject, ahead of
 *           the narrative the filmmaker actually wrote
 *
 * THE THIRD HOLD-CORRECTION CONTROL:
 *
 *   NC-M26  the composer fallback stops restoring the audio writer, so a real v607 ->
 *           base restoration leaves a hybrid: the enhanced writer storing into the
 *           active unit's plan beside the base reader sending the shot's plan, and an
 *           explicit "no audio" compiles as generate-voice
 *
 * EVERY CONTROL DECLARES WHICH DETECTOR IT EXPECTS. `expect` is a regular expression over
 * the detector's own message, and a failure that does not match it fails THIS suite — a
 * control that armed one defect and tripped an unrelated assertion elsewhere would
 * otherwise report success while the protection it named went untested. The message that
 * actually fired is printed beside every control, so the pairing can be read rather than
 * trusted. This is the `expect:` discipline accepted in Slice 0.
 *
 * Nothing here contacts a provider, spends anything, or writes to a project. The patched
 * files are restored from their ORIGINAL BYTES in a `finally` — never by `git checkout`,
 * which this repository has already lost unstaged work to. Anchors are normalised to LF
 * before matching, because a `\n` in a source anchor matches zero times in a normal
 * Windows checkout and would abort the control while looking like a pass.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const results = [];
const literals = [];
const caughtBy = [];

/* ---------------------------------------------------------------- machinery */

async function expectRed(id, expect, body) {
  assert.ok(expect instanceof RegExp, `${id}: a control must declare which detector it expects to fire`);
  let threw = null;
  try { await body(); } catch (error) { threw = error; }
  assert.ok(threw, `${id}: the defect was introduced and NOTHING caught it — that assertion cannot fail`);
  assert.ok(threw instanceof assert.AssertionError || /AssertionError/.test(String(threw && threw.name)),
    `${id}: the detector must fail by assertion, not by crashing (${threw && threw.message})`);
  const message = String((threw && threw.message) || "");
  assert.ok(expect.test(message),
    `${id}: the suite went red for the WRONG REASON. Expected ${expect} but the detector said: ${message.slice(0, 500)}`);
  return message;
}

/* Every module this suite reaches is loaded through `require` (prompt-engine and the
   shared projection) or evaluated by the render harness from disk (the browser files),
   so a control patches the file itself and restores the original bytes. Both the probe
   and the detector then see the same broken product. */
const CACHE_KEYS = [
  "prompt-engine", "generation-compiler", "shared-motion-intent",
  "render-harness", "shot-intent-compiler-integrity",
];
function dropCaches() {
  for (const key of Object.keys(require.cache)) {
    if (CACHE_KEYS.some((name) => key.includes(name))) delete require.cache[key];
  }
}

async function patchedFiles(editsByFile, body) {
  const originals = new Map();
  try {
    for (const [file, edits] of Object.entries(editsByFile)) {
      const absolute = path.join(ROOT, file);
      const original = fs.readFileSync(absolute, "utf8");
      originals.set(absolute, original);
      let next = original.replace(/\r\n/g, "\n");
      for (const [from, to] of edits) {
        assert.ok(next.includes(from), `patch target not found in ${file}: ${from.slice(0, 110)}`);
        next = next.replace(from, to);
      }
      fs.writeFileSync(absolute, next);
    }
    dropCaches();
    await body();
  } finally {
    for (const [absolute, original] of originals) fs.writeFileSync(absolute, original);
    dropCaches();
  }
}

/* Re-require the suite so its helpers and its detectors are bound to whatever the patched
   files now say. Without this a control judges a detector that closed over the unpatched
   copy. */
function freshSuite() {
  dropCaches();
  return require("./shot-intent-compiler-integrity");
}

/* The compiler, re-required after a patch. A module captured at the top of this file
   would keep pointing at the ORIGINAL bytes however carefully dropCaches() ran, and a
   probe holding one reports that the defect did not land while the defect is sitting on
   disk. It has to be asked for after the patch, every time. */
function freshPromptEngine() {
  dropCaches();
  return require("../prompt-engine");
}

async function control({ id, defect, files, probe, guard, expect }) {
  await patchedFiles(files, async () => {
    const literal = await probe(freshSuite());
    assert.ok(literal, `${id}: the probe must produce the literal bad state, not merely run`);
    literals.push(`${id} → ${literal}`);
    const caught = await expectRed(id, expect, () => guard(freshSuite()));
    caughtBy.push(`${id} ← ${caught.split("\n")[0].slice(0, 160)}`);
  });
  results.push(`${id} · ${defect}`);
}

/* ================================================ THE COMPILER-SIDE DEFECTS
   =========================================================================== */

/* The guard now lives inside the clause assembly: a fragment is written only when its own
   field was declared. Removing it means the action is written whatever the plan says,
   which is exactly the manufactured "<id> still" the dogfood pass received. */
const SUBJECT_GUARD = [
  `        [" ", subjectSays("action") ? normalizedLabel(item.action || "still") : ""],`,
  `        [" ", normalizedLabel(item.action || "still")],`,
];
const PROP_GUARD = [
  `        [" ", propSays("action") ? normalizedLabel(item.action || "static") : ""],`,
  `        [" ", normalizedLabel(item.action || "static")],`,
];

async function nc1() {
  await control({
    id: "NC-M1",
    expect: /the declared travelling walk must remain the principal action/,
    defect: "the subject guard is removed, so an untouched control puts a stillness directive in front of the declared walk",
    files: { "prompt-engine.js": [SUBJECT_GUARD] },
    probe: async (suite) => {
      const result = suite.compileSwamp(suite.blankPlan());
      assert.ok(/^CH-REX still/.test(suite.firstBeat(result)),
        `NC-M1: the defect did not land — the principal action is still ${JSON.stringify(suite.firstBeat(result))}`);
      return `principal action compiled from an untouched control: ${JSON.stringify(suite.firstBeat(result))}`;
    },
    guard: (suite) => suite.testWalkVsStillSurvivesCompilation(),
  });
}

async function nc2() {
  await control({
    id: "NC-M2",
    expect: /a prop nobody directed must contribute no beat/,
    defect: "the prop guard is removed, so a prop nobody directed contributes a beat",
    files: { "prompt-engine.js": [PROP_GUARD] },
    probe: async (suite) => {
      const result = suite.compileSwamp(suite.blankPlan({ subjects: [] }));
      assert.ok(result.beats.some((beat) => beat.startsWith(suite.CHAIR)),
        `NC-M2: the defect did not land — beats are ${JSON.stringify(result.beats)}`);
      return `undirected prop contributed: ${JSON.stringify(result.beats.filter((beat) => beat.startsWith(suite.CHAIR)))}`;
    },
    guard: (suite) => suite.testUndirectedPropContributesNoBeat(),
  });
}

async function nc3() {
  await control({
    id: "NC-M3",
    expect: /the declared travelling walk must remain the principal action/,
    defect: "the declaration reader calls every stored entry declared, so the guard is present and discriminates nothing",
    files: {
      "public/shared-motion-intent.js": [[
        `      if (!motionIntentSame(entry[field], defaults[field])) {`,
        `      if (true) {`,
      ]],
    },
    probe: async (suite) => {
      const result = suite.compileSwamp(suite.blankPlan());
      assert.ok(/^CH-REX still/.test(suite.firstBeat(result)),
        `NC-M3: the defect did not land — the principal action is still ${JSON.stringify(suite.firstBeat(result))}`);
      return `a guard that admits everything compiled: ${JSON.stringify(suite.firstBeat(result))}`;
    },
    guard: (suite) => suite.testWalkVsStillSurvivesCompilation(),
  });
}

async function nc4() {
  await control({
    id: "NC-M4",
    expect: /a derived label may not|a derived target label is not a declaration/,
    defect: "the derived-field exclusion is dropped, so a stale target label alone resurrects an otherwise blank entry",
    files: {
      "public/shared-motion-intent.js": [[
        `      if (derived.includes(field)) continue;`,
        `      if (false && derived.includes(field)) continue;`,
      ]],
    },
    probe: async (suite) => {
      const plan = suite.blankPlan();
      plan.subjects[suite.REX] = { ...suite.BLANK_SUBJECT, action: "walk", targetLabel: "the folding chair" };
      const result = suite.compileSwamp(plan);
      const claimed = suite.declaredFields(result.spec);
      assert.ok(claimed.includes(`subject:${suite.REX}:targetLabel`),
        `NC-M4: the defect did not land — provenance claims ${JSON.stringify(claimed)}`);
      return `a label written by the composer was recorded as a filmmaker decision: ${JSON.stringify(claimed)}`;
    },
    guard: (suite) => suite.testDerivedLabelIsNotADeclaration(),
  });
}

async function nc5() {
  await control({
    id: "NC-M5",
    expect: /a deliberately re-chosen default must be heard/,
    defect: "the marked reading is dropped, so a filmmaker who deliberately re-chooses the default value is silenced",
    files: {
      "public/shared-motion-intent.js": [[
        `      if (marked.has(field)) {
        fields.push(field);
        reasons[field] = "marked";
        continue;
      }
`,
        "",
      ]],
    },
    probe: async (suite) => {
      const plan = suite.blankPlan();
      plan.subjects[suite.REX] = { ...suite.BLANK_SUBJECT, action: "still", declaredFields: ["action"] };
      const result = suite.compileSwamp(plan);
      assert.ok(!result.beats.some((beat) => beat.startsWith(suite.REX)),
        `NC-M5: the defect did not land — beats are ${JSON.stringify(result.beats)}`);
      return `a filmmaker's explicit "Remain still" produced no beat at all: ${JSON.stringify(result.beats)}`;
    },
    guard: (suite) => suite.testDeclaredStillnessStillCompiles(),
  });
}

async function nc6() {
  await control({
    id: "NC-M6",
    expect: /must not overwrite a declared camera movement/,
    defect: "the camera guard is removed, so an untouched camera row overwrites a camera movement the shot had established",
    files: {
      "prompt-engine.js": [[
        `    if (cameraSays("move")) {`,
        `    if (true) {`,
      ]],
    },
    probe: async (suite) => {
      const result = suite.compileSwamp(suite.blankPlan(), { mediaAnalysis: { camera: { movement: "slow dolly push-in that begins at 1.0s" } } });
      assert.strictEqual(result.spec.camera.movement, "locked-off camera with no drift",
        `NC-M6: the defect did not land — camera.movement is ${result.spec.camera.movement}`);
      return `a declared camera move was replaced by an untouched control: ${result.spec.camera.movement}`;
    },
    guard: (suite) => suite.testDeclaredCameraOutranksDefaultedPlan(),
  });
}

async function nc7() {
  await control({
    id: "NC-M7",
    expect: /must not add a hold-the-final-state requirement/,
    defect: "the timing guard is removed, so an untouched timing row requires a shot that ends mid-stride to settle and hold",
    files: {
      "prompt-engine.js": [[
        `    if (timingSays("holdEnd") && timing.holdEnd) {`,
        `    if (timing.holdEnd) {`,
      ]],
    },
    probe: async (suite) => {
      const result = suite.compileSwamp(suite.blankPlan());
      assert.ok(result.spec.mustPreserve.includes("settle into and briefly hold the final state"),
        `NC-M7: the defect did not land — mustPreserve is ${JSON.stringify(result.spec.mustPreserve)}`);
      return "an untouched timing row required the shot to settle and hold the final state";
    },
    guard: (suite) => suite.testUndeclaredTimingAddsNoHoldRequirement(),
  });
}

/* ================================================== THE BROWSER-SIDE DEFECTS
   =========================================================================== */

async function nc8() {
  await control({
    id: "NC-M8",
    expect: /states stillness for a cast member nobody directed/,
    defect: "the browser summary states stillness for an undirected cast member again",
    files: {
      "public/v607-composer.js": [[
        `      if (subjectSays("action") && !directed) lines.push(`,
        `      if (!directed) lines.push(`,
      ]],
    },
    probe: async (suite) => {
      const browser = await suite.walkVsStillThroughTheBrowser();
      assert.ok(/remains still except for natural breathing and blinking/.test(browser.summary),
        `NC-M8: the defect did not land — the summary is ${JSON.stringify(browser.summary)}`);
      /* THE WHOLE POINT, PRINTED: the manufactured sentence does not stay on screen. It
         becomes the motion unit's note and compiles as the shot's action. */
      const compiled = suite.compileFromLiveProject(browser.live, "L1-01", browser.summary);
      assert.ok(/remains still except for natural breathing and blinking/.test(compiled.compiled.prompt),
        "NC-M8: the manufactured sentence did not reach the compiled prompt, so the control proves less than it claims");
      return `manufactured stillness reached the compiled prompt: ${JSON.stringify(compiled.compiled.prompt.split("\n").find((line) => /remains still/.test(line)))}`;
    },
    guard: async (suite) => {
      const browser = await suite.walkVsStillThroughTheBrowser();
      suite.testBrowserSummaryManufacturesNothing(browser.summary);
    },
  });
}

async function nc9() {
  await control({
    id: "NC-M9",
    expect: /states a camera move nobody directed/,
    defect: "the browser summary states an undirected camera move again",
    files: {
      "public/v607-composer.js": [[
        `    if (cameraSays("move") && camera.move && camera.move !== "none") {`,
        `    if (camera.move && camera.move !== "none") {`,
      ]],
    },
    probe: async (suite) => {
      const browser = await suite.walkVsStillThroughTheBrowser();
      assert.ok(/^Camera:/m.test(browser.summary),
        `NC-M9: the defect did not land — the summary is ${JSON.stringify(browser.summary)}`);
      return `undirected camera stated as direction: ${JSON.stringify(browser.summary.split("\n")[0])}`;
    },
    guard: async (suite) => {
      const browser = await suite.walkVsStillThroughTheBrowser();
      suite.testBrowserSummaryManufacturesNothing(browser.summary);
    },
  });
}

/* THE CONTAMINATION CONTROL.
 *
 * There is no contamination path in the shipped product — the reported strings were
 * placeholders. So this control has to CREATE one, and it creates the most plausible
 * one: the composer's active motion unit stops being scoped to the shot it was asked
 * about and finds the first authored brief in the project instead. That is precisely the
 * class of defect the A→B fixture exists to catch, and without it the fixture would be
 * asserting against a mechanism nothing had ever shown could fail. */
async function nc10() {
  await control({
    id: "NC-M10",
    expect: /belongs to the other shot/,
    defect: "composer state stops being shot-scoped, so shot B shows shot A's authored brief",
    files: {
      "public/motion-sound-composer.js": [[
        `  function activeUnit(s) {
    const c = ensureShotCreation(s);
    return (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || (s.clips || [])[0] || ensureGuidedMotionUnit(s, guidedCurrentShotStill(s)?.name || "", null);
  }`,
        `  function activeUnit(s) {
    const c = ensureShotCreation(s);
    const anywhere = (P.shots || []).flatMap((shot) => shot.clips || []).find((item) => item.motionBrief && String(item.motionBrief.performance?.action || ""));
    return anywhere || (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || (s.clips || [])[0] || ensureGuidedMotionUnit(s, guidedCurrentShotStill(s)?.name || "", null);
  }`,
      ]],
    },
    probe: async (suite) => {
      const run = await suite.contaminationRun([suite.SHOT_A, suite.SHOT_B]);
      const b = run.seen.find((step) => step.shotId === suite.SHOT_B);
      const leaked = suite.SHOT_A_TOKENS.filter((token) => b.state.includes(token));
      assert.ok(leaked.length,
        `NC-M10: the defect did not land — shot B carried none of ${JSON.stringify(suite.SHOT_A_TOKENS)}`);
      return `shot B held shot A's tokens: ${leaked.join(", ")}`;
    },
    guard: async (suite) => {
      const run = await suite.contaminationRun([suite.SHOT_A, suite.SHOT_B]);
      suite.assertNoForeignTokens(run);
    },
  });
}

/* THE SAFE-MODE COMPOSER. public/creation-studio.js carries the base implementation that
   restoreComposerOriginals607() puts back and that `?safe=1` never replaces. A repair
   made only in the enhanced composer would leave this one manufacturing stillness, and
   no Node suite that only exercised the normal page would see it. */
async function nc13() {
  await control({
    id: "NC-M13",
    expect: /states stillness for a cast member nobody directed/,
    defect: "the base composer that safe mode falls back to states stillness for an undirected cast member again",
    files: {
      "public/creation-studio.js": [[
        `    if (subjectSays("action") && !directed) lines.push(`,
        `    if (!directed) lines.push(`,
      ]],
    },
    probe: async (suite) => {
      const browser = await suite.walkVsStillThroughTheBrowser();
      const base = suite.baseComposerSummary(browser.context);
      assert.ok(/remains still except for natural breathing and blinking/.test(base),
        `NC-M13: the defect did not land — the base summary is ${JSON.stringify(base)}`);
      return `the safe-mode composer manufactured: ${JSON.stringify(base)}`;
    },
    guard: async (suite) => {
      const browser = await suite.walkVsStillThroughTheBrowser();
      suite.testBrowserSummaryManufacturesNothing(suite.baseComposerSummary(browser.context));
    },
  });
}

async function nc11() {
  await control({
    id: "NC-M11",
    expect: /must be marked as an example/,
    defect: "the composer's example placeholders stop being marked as examples",
    files: {
      "public/motion-sound-composer.js": [[
        `placeholder="e.g. frightened but controlled"`,
        `placeholder="frightened but controlled"`,
      ]],
    },
    probe: async () => {
      const source = fs.readFileSync(path.join(ROOT, "public", "motion-sound-composer.js"), "utf8");
      assert.ok(source.includes(`placeholder="frightened but controlled"`),
        "NC-M11: the defect did not land — the placeholder is still marked as an example");
      return 'an unmarked placeholder reads as authored content: placeholder="frightened but controlled"';
    },
    guard: (suite) => suite.testReportedStringsArePlaceholders(),
  });
}

async function nc12() {
  await control({
    id: "NC-M12",
    expect: /must make the compiled package stale/,
    defect: "package freshness reads the saved snapshot as the current direction, so an edited Shot Intent leaves the package reading current",
    files: {
      /* The body this arms moved into public/shared-build-history.js's packageDirection()
         when the money boundary needed to ask the same question — see Paid Request Truth
         V1. The DEFECT is unchanged and so is the property: read the saved snapshot as
         the current direction and freshness compares a value with itself. Only the host
         line moved, which is why this control was updated rather than deleted. */
      "public/review-provenance.js": [[
        `function currentDirectionForPackage(s, pack) {
  /* Same delegation as packageInputSnapshot, for the same reason: the money boundary
     has to be able to ask this question too. */
  return packageDirection(s, pack);
}`,
        `function currentDirectionForPackage(s, pack) {
  if (pack?.dependencySnapshot) return String(pack.dependencySnapshot.direction || "");
  return packageDirection(s, pack);
}`,
      ]],
    },
    probe: async (suite) => {
      let threw = null;
      try { await suite.testIntentEditRebuildUsesCurrentState(); } catch (error) { threw = error; }
      assert.ok(threw && /must make the compiled package stale/.test(String(threw.message)),
        `NC-M12: the defect did not land — the freshness check still reported drift (${threw && threw.message})`);
      return "an edited Shot Intent left the compiled package reading CURRENT";
    },
    guard: (suite) => suite.testIntentEditRebuildUsesCurrentState(),
  });
}

/* ==================================== THE HOLD-CORRECTION CONTROLS (NC-M14…NC-M21)
   ===========================================================================
   Four blockers, and a control for each guard that closes one. Every one of these armed
   a defect an independent reviewer had already reproduced on the held candidate, so the
   claim being tested here is not hypothetical. */

/* BLOCKER 1. Ask per ROW again, and one declared member speaks for every default beside
   it — which is the whole of what the reviewer sent back. */
async function nc14() {
  await control({
    id: "NC-M14",
    expect: /an untouched camera move must not publish itself beside a declared intensity/,
    defect: "the camera guard asks per row again, so setting only the intensity publishes the untouched move as locked-off",
    files: {
      "prompt-engine.js": [[
        `    if (cameraSays("move")) {`,
        `    if (declaration.camera.declared) {`,
      ]],
    },
    probe: async (suite) => {
      const plan = suite.blankPlan();
      plan.camera = { ...suite.BLANK_CAMERA, intensity: "strong" };
      const result = suite.compileSwamp(plan, { mediaAnalysis: { camera: { movement: "slow dolly push-in" } } });
      assert.strictEqual(result.spec.camera.movement, "locked-off camera with no drift",
        `NC-M14: the defect did not land — camera.movement is ${result.spec.camera.movement}`);
      return `one declared intensity published an untouched move: ${result.spec.camera.movement}`;
    },
    guard: (suite) => suite.testDeclaredCameraFieldDoesNotPromoteItsSiblings(),
  });
}

async function nc15() {
  await control({
    id: "NC-M15",
    expect: /an untouched holdEnd must not publish itself beside a declared pacing/,
    defect: "the timing guard asks per row again, so setting only the pacing requires settle-and-hold",
    files: {
      "prompt-engine.js": [[
        `    if (timingSays("holdEnd") && timing.holdEnd) {`,
        `    if (declaration.timing.declared && timing.holdEnd) {`,
      ]],
    },
    probe: async (suite) => {
      const plan = suite.blankPlan();
      plan.timing = { ...suite.BLANK_TIMING, pacing: "brisk" };
      const result = suite.compileSwamp(plan);
      assert.ok(result.spec.mustPreserve.includes("settle into and briefly hold the final state"),
        `NC-M15: the defect did not land — mustPreserve is ${JSON.stringify(result.spec.mustPreserve)}`);
      return "one declared pacing required the shot to settle and hold the final state";
    },
    guard: (suite) => suite.testDeclaredTimingFieldDoesNotPromoteItsSiblings(),
  });
}

async function nc16() {
  await control({
    id: "NC-M16",
    expect: /only the declared field may compile/,
    defect: "the subject clause asks per row again, so an end position publishes the untouched action beside it",
    files: {
      "prompt-engine.js": [[
        `        [" ", subjectSays("action") ? normalizedLabel(item.action || "still") : ""],`,
        `        [" ", reading.declared ? normalizedLabel(item.action || "still") : ""],`,
      ]],
    },
    probe: async (suite) => {
      const plan = suite.blankPlan();
      plan.subjects[suite.REX] = { ...suite.BLANK_SUBJECT, destination: "on the far bank" };
      const result = suite.compileSwamp(plan);
      assert.ok(/\bstill\b/.test(suite.firstBeat(result)),
        `NC-M16: the defect did not land — the beat is ${JSON.stringify(suite.firstBeat(result))}`);
      return `an end position published an untouched action: ${JSON.stringify(suite.firstBeat(result))}`;
    },
    guard: (suite) => suite.testDeclaredSubjectFieldDoesNotPromoteItsSiblings(),
  });
}

/* CASE C lives in the composer, not the compiler: the server only ever published the
   environment when its action was non-default, so the manufactured "the world holds
   still" sentence is the browser's. This is the guard that stops it. */
async function nc17() {
  await control({
    id: "NC-M17",
    expect: /must not state that the environment holds when nobody said so/,
    defect: "the composer's environment guard asks per row again, so setting only the intensity states that the world holds still",
    files: {
      "public/v607-composer.js": [[
        `    if (envSays("action")) lines.push(env.action && env.action !== "static"`,
        `    if (declaration.environment.declared) lines.push(env.action && env.action !== "static"`,
      ]],
    },
    probe: async (suite) => {
      const seen = await suite.browserSummaryAfter([["environment", "intensity", "strong"]]);
      assert.ok(/Environment remains stable/i.test(seen.summary),
        `NC-M17: the defect did not land — the summary is ${JSON.stringify(seen.summary)}`);
      return `one declared intensity stated: ${JSON.stringify(seen.summary.split("\n").find((line) => /Environment remains stable/i.test(line)))}`;
    },
    guard: (suite) => suite.testBrowserSummaryDoesNotPromoteSiblings(),
  });
}

/* BLOCKER 2. The recomputation that overwrote a declared decision. */
async function nc18() {
  await control({
    id: "NC-M18",
    expect: /a declared audio mode must survive the motion brief/,
    defect: "the motion brief recomputes the audio mode unconditionally, so a declared lip-sync becomes generate-voice",
    files: {
      "prompt-engine.js": [[
        `  const audioMode = declaredAudioMode ? cleanText(out.audio?.mode) || derivedMode : derivedMode;`,
        `  const audioMode = derivedMode;`,
      ]],
    },
    probe: async (suite) => {
      const PE = freshPromptEngine();
      const context = suite.swampContext({ shot: { audio: { dialogue: suite.LIP_SYNC_LINE, sfx: "" } } });
      let spec = PE.defaultSpec(context, "motion", "i2v", suite.lipSyncReferences(), null);
      spec = PE.applyStructuredDirection(spec, null, suite.lipSyncPlan(), suite.lipSyncReferences());
      assert.strictEqual(spec.audio.mode, "lip-sync-reference", "NC-M18: the declaration did not land before the brief ran");
      spec = PE.applyMotionAudioBrief(spec, suite.lipSyncBrief());
      assert.strictEqual(spec.audio.mode, "generate-voice",
        `NC-M18: the defect did not land — the mode is ${spec.audio.mode}`);
      return `a declared lip-sync became ${spec.audio.mode} with reference ${JSON.stringify(spec.audio.referenceKey)} still attached`;
    },
    guard: (suite) => suite.testDeclaredAudioModeSurvivesTheMotionBrief(),
  });
}

/* The same defect, through the route a filmmaker actually reaches. The helper pair going
   red proves the functions compose; only this proves server.js does. */
async function nc19() {
  await control({
    id: "NC-M19",
    expect: /POST \/api\/prompt\/compile replaced a declared lip-sync mode/,
    defect: "the compile route replaces a declared lip-sync mode with a derived one",
    files: {
      "prompt-engine.js": [[
        `  const audioMode = declaredAudioMode ? cleanText(out.audio?.mode) || derivedMode : derivedMode;`,
        `  const audioMode = derivedMode;`,
      ]],
    },
    probe: async (suite) => {
      const result = await suite.withMotionIntentServer({
        shotId: "TLS-002", segmentId: "seg-a", profileId: "seedance-2/r2v", purpose: "motion",
        durationSeconds: 6, useLLM: false, directive: "Rex speaks the line without leaving the chair.",
        references: suite.lipSyncReferences(), motionPlan: suite.lipSyncPlan(), motionBrief: suite.lipSyncBrief(),
        audio: { dialogue: suite.LIP_SYNC_LINE, speakerId: suite.REX, mode: "lip-sync-reference" },
      });
      assert.strictEqual(result.status, 200, `NC-M19: the sandbox route did not compile: ${result.raw.slice(0, 400)}`);
      assert.strictEqual(result.body.spec?.audio?.mode, "generate-voice",
        `NC-M19: the defect did not land — the route returned ${result.body.spec?.audio?.mode}`);
      return `the live route returned mode=${result.body.spec.audio.mode} with reference ${JSON.stringify(result.body.spec.audio.referenceKey)} still attached`;
    },
    guard: (suite) => suite.testDeclaredAudioModeSurvivesTheServerRoute(),
  });
}

/* BLOCKER 3. Without the membership boundary the orphan's stored row directs a shot it
   left. */
async function nc20() {
  await control({
    id: "NC-M20",
    expect: /no longer belongs to this shot still directed it|orphan reached the compiled prompt/,
    defect: "the current-shot membership boundary is removed, so a subject dropped from the cast keeps compiling",
    files: {
      "prompt-engine.js": [[
        `    const isMember = (id) => !membershipKnown || memberIds.has(cleanText(id));`,
        `    const isMember = () => true;`,
      ]],
    },
    probe: async (suite) => {
      const plan = suite.blankPlan();
      plan.subjects["CH-GHOST"] = { ...suite.BLANK_SUBJECT, action: "run", notes: "ORPHANTOKEN" };
      const result = suite.compileSwamp(plan);
      assert.ok(result.compiled.prompt.includes("ORPHANTOKEN"),
        `NC-M20: the defect did not land — beats are ${JSON.stringify(result.beats)}`);
      return `a removed subject's stored row reached the compiled prompt: ${JSON.stringify(result.beats.find((beat) => beat.includes("ORPHANTOKEN")))}`;
    },
    guard: (suite) => suite.testOrphanedSubjectDoesNotCompile(),
  });
}

/* BLOCKER 4. Restore the refusal that could not see the layer beneath it. */
async function nc21() {
  await control({
    id: "NC-M21",
    expect: /must fall through to the shot's own narrative, not refuse/,
    defect: "the motion refusal ignores the shot's own narrative again, so a directed shot never reaches /api/prompt/compile",
    files: {
      "public/creation-studio.js": [[
        `  if (!structuredDirection && !writtenDirection && !narrativeDirection) return toast("Choose at least one motion direction");`,
        `  if (!structuredDirection && !writtenDirection) return toast("Choose at least one motion direction");`,
      ]],
    },
    probe: async (suite) => {
      const attempt = await suite.motionCompileAttempt(suite.narrativeOnlyFixture());
      assert.strictEqual(attempt.request, null,
        "NC-M21: the defect did not land — the compile request was still made");
      return "a shot directed by its own description was refused and /api/prompt/compile never ran";
    },
    guard: (suite) => suite.testEmptyComposerFallsThroughToShotNarrative(),
  });
}

/* ============================ THE SECOND HOLD-CORRECTION CONTROLS (NC-M22…NC-M25)
   ===========================================================================
   Two blockers, four guards. Both defects were reproduced by an independent reviewer on
   5a63117 through the real writers and the real render path, so what these arm is history
   rather than hypothesis. */

/* BLOCKER 1. Take the mark off the real BASE writer and an explicit "No audio" becomes
   indistinguishable from a control nobody opened — which is what the reviewer saw. */
async function nc22() {
  await control({
    id: "NC-M22",
    expect: /^base: the real writer must record that the filmmaker set the audio mode/,
    defect: "the base composer's audio writer stops marking the field, so an explicit default-valued mode reads as untouched",
    files: {
      "public/creation-studio.js": [[
        `  markMotionDeclaration("audio", audio, key);\n`,
        "",
      ]],
    },
    probe: async (suite) => {
      const chosen = await suite.audioModeChosenThrough("base", "none");
      assert.strictEqual(chosen.written.mode, "none", "NC-M22: the writer did not store the chosen mode");
      assert.ok(!suite.MotionIntent.motionFieldDeclared("audio", chosen.written, "mode"),
        `NC-M22: the defect did not land — the mark is still there: ${JSON.stringify(chosen.written)}`);
      const compiled = suite.audioModeAfterTheBrief(chosen.written);
      assert.strictEqual(compiled.mode, "generate-voice",
        `NC-M22: the derivation did not take over — the mode is ${compiled.mode}`);
      return `an explicitly chosen "none" was classified defaulted and compiled as ${compiled.mode}`;
    },
    guard: (suite) => suite.testExplicitDefaultValuedAudioModeIsDeclared(),
  });
}

/* The same, on the enhanced writer. The base case passing while this one fails is exactly
   the half-repair this control exists to forbid. */
async function nc23() {
  await control({
    id: "NC-M23",
    expect: /^v607: the real writer must record that the filmmaker set the audio mode/,
    defect: "the enhanced composer's audio writer stops marking the field, so an explicit default-valued mode reads as untouched",
    files: {
      "public/v607-composer.js": [[
        `audio[key] = value; markMotionDeclaration607("audio", audio, key); if (key === "mode")`,
        `audio[key] = value; if (key === "mode")`,
      ]],
    },
    probe: async (suite) => {
      const chosen = await suite.audioModeChosenThrough("v607", "none");
      assert.ok(!suite.MotionIntent.motionFieldDeclared("audio", chosen.written, "mode"),
        `NC-M23: the defect did not land — the mark is still there: ${JSON.stringify(chosen.written)}`);
      const compiled = suite.audioModeAfterTheBrief(chosen.written);
      assert.strictEqual(compiled.mode, "generate-voice",
        `NC-M23: the derivation did not take over — the mode is ${compiled.mode}`);
      return `an explicitly chosen "none" was classified defaulted and compiled as ${compiled.mode}`;
    },
    guard: (suite) => suite.testExplicitDefaultValuedAudioModeIsDeclared(),
  });
}

/* BLOCKER 2. Put the generated title back into the refusal's source chain and an
   undirected shot buys a generation package with a label the product wrote for it. */
async function nc24() {
  await control({
    id: "NC-M24",
    expect: /the shot is undirected and the refusal must stand/,
    defect: "the motion refusal reads a generated unit title as motion intent, so an undirected shot bypasses it",
    files: {
      "public/creation-studio.js": [[
        `    motionUnitAuthoredDirection(unitForNarrative) || s.desc || "",`,
        `    unitForNarrative?.motionPrompt || unitForNarrative?.note || unitForNarrative?.title || s.desc || "",`,
      ]],
    },
    probe: async (suite) => {
      const attempt = await suite.motionCompileAttempt(suite.undirectedShotFixture());
      assert.ok(attempt.request,
        "NC-M24: the defect did not land — the refusal still stood");
      const unit = JSON.parse(require("vm").runInContext(
        `JSON.stringify((shotById("L1-01").clips || [])[0] || null)`, attempt.context));
      return `an undirected shot compiled a package on the strength of a generated label: ${JSON.stringify(unit && unit.title)}`;
    },
    guard: (suite) => suite.testGeneratedUnitTitleIsNotMotionIntent(),
  });
}

/* And the compiler's half: the same label taken as the shot's subject, ahead of what the
   filmmaker actually wrote. */
async function nc25() {
  await control({
    id: "NC-M25",
    expect: /the filmmaker's narrative must outrank a generated unit label/,
    defect: "buildContext reads a generated unit title as the shot description, ahead of the authored narrative",
    files: {
      "prompt-engine.js": [[
        `        ? MotionIntent.motionUnitAuthoredDirection(segment) || shotNarrative.text || ""`,
        `        ? segment.motionPrompt || segment.note || segment.title || shotNarrative.text || ""`,
      ]],
    },
    probe: async (suite) => {
      const PE = freshPromptEngine();
      const project = suite.twoShotFixture();
      const shot = project.shots.find((row) => row.id === "L1-01");
      shot.desc = "Kai walks the length of the hull.";
      shot.clips = [{ id: "seg-generated", suffix: "a", label: "A", title: "Primary motion", kind: "i2v", dur: 5, motionPrompt: "", note: "", generationPackages: [] }];
      const context = PE.buildContext(project, "L1-01", "seg-generated");
      assert.strictEqual(context.shot.description, "Primary motion",
        `NC-M25: the defect did not land — the description is ${JSON.stringify(context.shot.description)}`);
      return `the compiler took a generated label as the shot's subject: ${JSON.stringify(context.shot.description)}`;
    },
    guard: (suite) => suite.testGeneratedUnitTitleIsNotTheShotDescription(),
  });
}

/* ============================== THE THIRD HOLD-CORRECTION CONTROL (NC-M26)
   ===========================================================================
   Take the audio writer back out of the capture set and the fallback leaves a hybrid
   composer behind: this file's writer storing into the active unit's plan, the base
   composer's reader sending the shot's plan. The filmmaker's explicit "no audio" lands
   where nothing looks, and the compiler derives a voice over it.

   The probe does not merely observe the wrong answer — it proves the MIXED STATE that
   causes it, because "the mode came out wrong" has more than one possible cause and only
   one of them is the defect this control names. */
async function nc26() {
  await control({
    id: "NC-M26",
    expect: /must be restored to the captured base implementation|must store the chosen mode where the base reader looks|must survive a composer fallback all the way to the compiled package/,
    defect: "the composer fallback stops restoring the audio writer, leaving a v607-writer / base-reader hybrid",
    files: {
      "public/v607-composer.js": [[
        `    setSimpleMotionAudio: typeof window.setSimpleMotionAudio === "function" ? window.setSimpleMotionAudio : null,`,
        "",
      ]],
    },
    probe: async (suite) => {
      const run = await suite.afterRealComposerFallback({ chooseMode: "none" });
      /* 1. THE MUTATION LANDED: the writer was not restored with its siblings. */
      assert.ok(!run.state.restoredIsCapturedBase,
        `NC-M26: the defect did not land — every writer was still restored: ${JSON.stringify(run.state.restoredSources)}`);
      /* 2. THE HYBRID ACTUALLY EXISTS: the choice went into the enhanced composer's own
            store while the base composer's store stayed untouched. */
      assert.ok(run.state.unitPlanAudio && run.state.unitPlanAudio.mode === "none",
        `NC-M26: the enhanced writer did not run — unit plan is ${JSON.stringify(run.state.unitPlanAudio)}`);
      assert.ok(!suite.MotionIntent.motionFieldDeclared("audio", run.state.shotPlanAudio, "mode"),
        `NC-M26: the base store carries the declaration after all, so there is no hybrid: ${JSON.stringify(run.state.shotPlanAudio)}`);
      /* 3. THE LITERAL UNSAFE COMPILED MODE. */
      assert.strictEqual(run.spec.audio.mode, "generate-voice",
        `NC-M26: the compile did not go wrong — the mode is ${run.spec.audio.mode}`);
      return `explicit "none" was written to ${JSON.stringify(run.state.unitPlanAudio.declaredFields)} in the unit plan, the base builder sent the shot plan's ${JSON.stringify(run.state.shotPlanAudio.mode)}, and the package compiled as ${JSON.stringify(run.spec.audio.mode)} with dialogue ${JSON.stringify(run.spec.audio.dialogue)}`;
    },
    guard: (suite) => suite.testExplicitNoneSurvivesAComposerFallback(),
  });
}

/* ================================================================== THE RUN
   =========================================================================== */

/* Every file any control below patches, hashed before and after. Restoration is part of
   the claim: a control that leaves a byte behind turns the next suite green or red for
   reasons nobody can see, and `git checkout` is not an acceptable way to find out. */
const PATCHED_FILES = [
  "prompt-engine.js",
  "public/shared-motion-intent.js",
  "public/v607-composer.js",
  "public/motion-sound-composer.js",
  "public/review-provenance.js",
  "public/creation-studio.js",
];
function hashes() {
  const crypto = require("crypto");
  return Object.fromEntries(PATCHED_FILES.map((file) => [
    file,
    crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex"),
  ]));
}

async function main() {
  const before = hashes();

  /* The unpatched product must be green first, or every control below is measuring
     something other than the defect it names. */
  await freshSuite().main();

  await nc1();
  await nc2();
  await nc3();
  await nc4();
  await nc5();
  await nc6();
  await nc7();
  await nc8();
  await nc9();
  await nc10();
  await nc11();
  await nc12();
  await nc13();
  await nc14();
  await nc15();
  await nc16();
  await nc17();
  await nc18();
  await nc19();
  await nc20();
  await nc21();
  await nc22();
  await nc23();
  await nc24();
  await nc25();
  await nc26();

  assert.deepStrictEqual(hashes(), before,
    "a control left a patched file changed; every patched byte must be restored exactly");

  console.log("\nDEFECTS INTRODUCED AND CAUGHT");
  for (const row of results) console.log(`  ${row}`);
  console.log("\nTHE LITERAL BAD STATE EACH CONTROL PRODUCED");
  for (const row of literals) console.log(`  ${row}`);
  console.log("\nWHAT ACTUALLY FIRED");
  for (const row of caughtBy) console.log(`  ${row}`);
  console.log(`\nshot-intent compiler integrity negative controls: PASS (${results.length} controls)`);
}

module.exports = { main };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

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

const SUBJECT_GUARD = [
  `      if (!declaration.subjects[id]?.declared) {
        withheld("subject", id, "subject-plan-carries-no-declaration");
        continue;
      }
`,
  "",
];
const PROP_GUARD = [
  `      if (!declaration.props[id]?.declared) {
        withheld("prop", id, "prop-plan-carries-no-declaration");
        continue;
      }
`,
  "",
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
        `    return motionIntentFreeze({
      dimension: key,
      known: true,
      present: true,
      declared: fields.length > 0,
      fields,
      reasons,
    });`,
        `    return motionIntentFreeze({
      dimension: key,
      known: true,
      present: true,
      declared: true,
      fields,
      reasons,
    });`,
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
    expect: /a derived target label is not a declaration/,
    defect: "the derived-field exclusion is dropped, so a stale target label alone resurrects an otherwise blank entry",
    files: {
      "public/shared-motion-intent.js": [[
        `      if (derived.includes(field)) continue;`,
        `      if (false && derived.includes(field)) continue;`,
      ]],
    },
    probe: async (suite) => {
      const plan = suite.blankPlan();
      plan.subjects[suite.REX] = { ...suite.BLANK_SUBJECT, targetLabel: "the folding chair" };
      const result = suite.compileSwamp(plan);
      assert.ok(result.beats.some((beat) => beat.startsWith(suite.REX)),
        `NC-M4: the defect did not land — beats are ${JSON.stringify(result.beats)}`);
      return `a label written by the composer read as a decision: ${JSON.stringify(result.beats[0])}`;
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
        `    if (declaration.camera.declared) {
      out.camera.movement = camera.move === "locked"`,
        `    if (true) {
      out.camera.movement = camera.move === "locked"`,
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
        `    if (declaration.timing.declared) {
      if (timing.secondary)`,
        `    if (true) {
      if (timing.secondary)`,
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
        `      if (!declaration.subjects[id]?.declared) continue;\n`,
        "",
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
        `    if (declaration.camera.declared && camera.move && camera.move !== "none")`,
        `    if (camera.move && camera.move !== "none")`,
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
        `    if (!declaration.subjects[id]?.declared) continue;
`,
        "",
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
      "public/review-provenance.js": [[
        `function currentDirectionForPackage(s, pack) {
  const directive = s.packagePlanner?.directiveByScope?.[pack.scope] || "";`,
        `function currentDirectionForPackage(s, pack) {
  if (pack?.dependencySnapshot) return String(pack.dependencySnapshot.direction || "");
  const directive = s.packagePlanner?.directiveByScope?.[pack.scope] || "";`,
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

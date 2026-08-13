/* Generation truth: what CineBraid says it will generate, and what it would send.
 *
 * P4 made CineBraid truthful about MEDIA. This suite guards the equivalent property
 * for GENERATION: every route offered is one that can run, every control that writes
 * production state is one the live compiler reads, and every limit shown belongs to
 * the stage it names.
 *
 * Four defects, each of them a READER AND A WRITER THAT STOPPED AGREEING — the same
 * shape as the alpha-loop batch, arriving this time through script shadowing:
 *
 *   A  MULTI-FRAME KEYFRAMES WERE DECORATIVE. public/creation-studio.js is the only
 *      producer of the `sequential-keyframe` role in the browser, and the H3 keyframe
 *      panel exists to author it: an enable flag, an order and a beat note per
 *      approved frame, under the promise that those images are "sent to FAL in this
 *      exact order as Image 1, Image 2, and onward". public/v607-composer.js replaces
 *      that collector wholesale — it captured the original on one line and never
 *      called it — so every multi-frame package compiled with ONE approved frame and
 *      the panel's ordering, enable flags and beat notes reached nothing at all.
 *
 *   B  T2V WAS EXECUTABLE AND UNREACHABLE. minimax-h3/t2v resolves to the wired
 *      fal-h3-fl2va adapter exactly as i2v and flf do — same checkpoint, same
 *      serializer — and guidedVideoProfiles() filtered mode `t2v` out of the picker.
 *      A working route with no way to select it.
 *
 *   C  THE PROMPT EDITOR ENFORCED A RETIRED LIMIT. It hard-coded 2,000 for
 *      `minimax-h3` and labelled it "current MiniMax H3 FAL limit". fal-h3-backend.js
 *      records that fal's queue schema documents no prompt maxLength on any H3
 *      endpoint and retired that refusal, so the same prompt read 1,991/2,000 in the
 *      editor and 4,894/7,000 in the paid dialog — and the editor threw on direction
 *      the provider would have taken.
 *
 *   D  GROUNDING ADVICE WAS IMPOSSIBLE TO FOLLOW. "Attach an approved character
 *      image" was appended whenever a name went ungrounded, including in the
 *      endpoint-only workflows whose target has no slot left to attach one to.
 *
 * NO PAID PROVIDER CALL IS MADE. The render harness serves every route from fixtures
 * and the dispatch facts are read from the declared adapter inventory.
 *
 * THE COMPOSER STACK IS LOADED. tests/render-harness.js evaluates v607-composer.js and
 * motion-sound-composer.js in their shipped order, so the functions exercised here are
 * the ones the page really runs and not the definitions they shadow. Several
 * assertions below check exactly that, because a suite that silently tested the
 * shadowed implementation would have passed against the defect.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");
const Options = require("../generation-options");
const PromptEngine = require("../prompt-engine");

const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const notes = [];
function note(line) { notes.push(line); }

/* Values that came out of the render harness were built by the vm realm's own Array,
   so assert.deepStrictEqual refuses them against a host literal while printing two
   identical lists. Copying into a host array is what makes the comparison about the
   contents rather than about which realm allocated them. */
const hostList = (value) => Array.from(value || []).map(String);

const PROFILE_LIBRARY = JSON.parse(readLF("data/model-profiles.json"));

/* A shot the H3 multi-frame workflow applies to: two approved frames, which is the
   shape the dogfood shot had and the smallest sequence the panel can order. */
function multiFrameFixture() {
  const fixture = buildFixture();
  const shot = fixture.shots[0];
  shot.keyframes[0].description = "Worker at the panel.";
  shot.keyframes[1].description = "Worker steps away.";
  return fixture;
}

async function inPage(fixture, expression, mutateSource = null) {
  const rendered = await render(`#/shot/${fixture.shots[0].id}`, fixture, mutateSource ? { mutateSource } : {});
  return vm.runInContext(expression, rendered.context);
}

/* ---------------------------------------------------------------------------
   The live-ownership premise every other assertion rests on. */

async function testTheComposerStackIsTheOneUnderTest(mutateSource = null) {
  const owners = await inPage(multiFrameFixture(), `(() => ({
    composerReady: !!globalThis.__CINEBRAID_COMPOSER_607_READY,
    motionReferences: guidedMotionReferences.name,
    videoProfiles: guidedVideoProfiles.name,
    capturedOriginal: typeof globalThis.__cinebraidComposerOriginals607?.guidedMotionReferences,
  }))()`, mutateSource);
  assert(owners.composerReady, "the v6.0.7 composer must be active, or this suite tests the shadowed definitions");
  assert.strictEqual(owners.motionReferences, "guidedMotionReferences607",
    `the live motion-reference collector must be the composer's, got ${owners.motionReferences}`);
  assert.strictEqual(owners.capturedOriginal, "function",
    "the composer must still hold the creation-studio original it delegates to");
  note(`ownership: guidedMotionReferences resolves to ${owners.motionReferences}, guidedVideoProfiles to ${owners.videoProfiles}`);
  return owners;
}

/* ---------------------------------------------------------------------------
   A — multi-frame keyframes reach the package. */

/* Drives the H3 keyframe panel with the app's OWN writers, then asks the LIVE
   collector what the request would carry. Nothing here rebuilds a reference list. */
const MULTI_FRAME_PROBE = `(() => {
  const s = shotById("L1-01");
  const target = guidedVideoProfiles().find((p) => p.family === "minimax-h3" && p.mode === "r2v");
  if (!target) return { error: "no minimax-h3 r2v profile in the guided picker" };
  setGuidedMotionField("L1-01", "motionProfileId", target.id);
  setH3KeyframeEnabled("L1-01", "frame-a", true);
  setH3KeyframeEnabled("L1-01", "frame-b", true);
  setH3KeyframeNote("L1-01", "frame-a", "OPENING BEAT: hand still on the panel");
  setH3KeyframeNote("L1-01", "frame-b", "CLOSING BEAT: clear of the panel");
  const c = ensureShotCreation(s);
  const rows = h3ApprovedFrameRows(s);
  const refs = guidedMotionReferences(s, guidedCurrentShotStill(s), target) || [];
  return {
    profileId: target.id,
    panelRows: rows.map((r) => ({ id: r.frame.id, label: r.frame.label, enabled: r.enabled, note: r.note })),
    storedOrder: (c.h3KeyframeOrder || []).slice(),
    roles: refs.map((r) => r.role),
    waypoints: refs.filter((r) => r.role === "sequential-keyframe")
      .map((r) => ({ label: r.label, file: String(r.url || "").split("/").pop(), instruction: String(r.instruction || "") })),
  };
})()`;

async function multiFramePackage(mutateSource = null) {
  return inPage(multiFrameFixture(), MULTI_FRAME_PROBE, mutateSource);
}

async function testMultiFrameSendsTheOrderedKeyframes(mutateSource = null) {
  const result = await multiFramePackage(mutateSource);
  assert(!result.error, `the H3 multi-frame target must be selectable: ${result.error}`);
  assert.strictEqual(result.waypoints.length, 2,
    `both approved frames must travel as ordered waypoints, got ${result.waypoints.length} from roles ${result.roles.join(", ")}`);
  /* Order is the production decision the panel captures, so it is asserted as an
     ordered list rather than a set. */
  assert.deepStrictEqual(hostList(result.waypoints.map((w) => w.file)), ["FRAME_A.png", "FRAME_B.png"],
    "waypoints must travel in the order the keyframe panel stores");
  assert.deepStrictEqual(hostList(result.storedOrder), ["frame-a", "frame-b"], "the panel's stored order must be the shot's frames");
  note(`A: the live package carries ${result.waypoints.length} ordered sequential keyframes — ${result.waypoints.map((w) => w.file).join(" then ")}`);
}

async function testEachWaypointCarriesItsDirectedBeat(mutateSource = null) {
  const result = await multiFramePackage(mutateSource);
  assert(!result.error, "the H3 multi-frame target must be selectable");
  const first = result.waypoints[0] || {};
  const last = result.waypoints[result.waypoints.length - 1] || {};
  assert(/OPENING BEAT/.test(first.instruction),
    `the beat written against Frame A must reach the reference, got ${JSON.stringify(first.instruction)}`);
  assert(/CLOSING BEAT/.test(last.instruction),
    `the beat written against Frame B must reach the reference, got ${JSON.stringify(last.instruction)}`);
  /* The waypoint's position in the sequence is what tells the model it is a beat to
     pass through rather than one more loose reference. */
  assert(/waypoint 1 of 2/i.test(first.instruction), "a waypoint must state its place in the sequence");
  note("A: every waypoint carries the beat the director wrote against that frame, and its place in the sequence");
}

/* ---------------------------------------------------------------------------
   B — T2V is reachable, and carries nothing. */

const T2V_PROBE = `(() => {
  const t2v = guidedVideoProfiles().find((p) => p.family === "minimax-h3" && p.mode === "t2v");
  if (!t2v) return { inPicker: false };
  const markup = guidedVideoProfileOptions(t2v.id);
  const row = markup.match(/<option value="minimax-h3\\/t2v"[^>]*>[^<]*/);
  setGuidedMotionField("L1-01", "motionProfileId", t2v.id);
  const s = shotById("L1-01");
  return {
    inPicker: true,
    id: t2v.id,
    dispatchable: t2v.execution && t2v.execution.dispatchable === true,
    optionRow: row ? row[0] : null,
    optionDisabled: row ? / disabled/.test(row[0]) : null,
    roles: (guidedMotionReferences(s, guidedCurrentShotStill(s), t2v) || []).map((r) => r.role),
    needsApprovedStill: guidedVideoModeNeedsApprovedStill(t2v.mode),
  };
})()`;

async function t2vReachability(mutateSource = null) {
  return inPage(multiFrameFixture(), T2V_PROBE, mutateSource);
}

async function testEveryDispatchableVideoRouteIsReachable(mutateSource = null) {
  /* The server's own annotator is the authority on what can run; the picker is
     checked against it rather than against a list restated here. */
  const annotated = Options.annotateProfileLibraryExecution(PROFILE_LIBRARY);
  const dispatchable = annotated.profiles
    .filter((profile) => profile.mediaType === "video" && profile.execution.dispatchable === true)
    .map((profile) => profile.id);
  assert(dispatchable.length, "the fixture library must contain at least one dispatchable video route");
  const guided = await inPage(multiFrameFixture(), `guidedVideoProfiles().map((p) => p.id)`, mutateSource);
  const hidden = dispatchable.filter((id) => !guided.includes(id));
  assert.deepStrictEqual(hostList(hidden), [],
    `every route CineBraid can dispatch must be reachable from the motion picker; hidden: ${hidden.join(", ")}`);
  note(`B: all ${dispatchable.length} dispatchable video routes are reachable from the picker (${dispatchable.join(", ")})`);
}

async function testT2vIsSelectableAndNotDisabled(mutateSource = null) {
  const result = await t2vReachability(mutateSource);
  assert(result.inPicker, "minimax-h3/t2v must appear in the guided motion picker");
  assert(result.dispatchable, "minimax-h3/t2v must be annotated dispatchable by the server");
  assert(result.optionRow, "the picker must render a t2v option row");
  assert.strictEqual(result.optionDisabled, false, `a wired route must stay selectable, got ${result.optionRow}`);
  note(`B: the picker renders t2v selectable — ${result.optionRow.replace(/<option[^>]*>/, "").trim()}`);
}

async function testT2vCarriesNoReferenceImages(mutateSource = null) {
  const result = await t2vReachability(mutateSource);
  assert(result.inPicker, "minimax-h3/t2v must appear in the guided motion picker");
  /* fal's H3 t2v schema declares no reference media at all, so a package preview
     listing references the request cannot hold would be the same lie as a picker
     offering a model that cannot run. */
  assert.deepStrictEqual(hostList(result.roles), [],
    `text-to-video must gather no references, got ${result.roles.join(", ")}`);
  assert.strictEqual(result.needsApprovedStill, false,
    "the approved-still gates must not be applied to a mode with no visual anchor");
  /* Two independent things keep this package empty and both are worth pinning: the
     collector declines to gather, and the profile declares a reference budget of
     zero so nothing could be assigned even if it did. */
  const declared = PROFILE_LIBRARY.profiles.find((p) => p.id === "minimax-h3/t2v");
  assert.strictEqual(Number(declared.limits.maxReferences), 0,
    "the t2v profile must declare a zero reference budget, which is the second thing keeping the package empty");
  note("B: text-to-video gathers no references, declares a zero reference budget, and is not gated on an approved still");
}

/* ---------------------------------------------------------------------------
   C — the limit shown belongs to the stage it names. */

/* The ceiling the prompt editor would refuse above, read out of the running page. */
async function editorCeilingFor(profileId, mutateSource = null) {
  return inPage(multiFrameFixture(), `motionPromptCharacterLimit({ profileId: ${JSON.stringify(profileId)} })`, mutateSource);
}

async function testTheEditorCeilingIsNotKeyedOnAFamilyName(mutateSource = null) {
  const limits = await inPage(multiFrameFixture(), `(() => {
    const rows = ["minimax-h3/multi-frame", "minimax-h3/i2v", "seedance-2/i2v"].map((id) => {
      const profile = guidedVideoProfiles().find((p) => p.id === id) || null;
      return { id, limit: motionPromptCharacterLimit({ profileId: id }), declared: profile ? profile.limits : null };
    });
    return rows;
  })()`, mutateSource);
  for (const row of limits) {
    if (!row.declared) continue;
    const expected = Number(row.declared.publishedGuidePromptCharacters) || Number(row.declared.maxPromptCharacters) || 12000;
    assert.strictEqual(row.limit, expected,
      `${row.id}: the editor must enforce the declared ceiling ${expected}, got ${row.limit}`);
  }
  const h3 = limits.find((row) => row.id === "minimax-h3/multi-frame");
  assert(h3 && h3.limit > 2000,
    `the retired 2,000 refusal must not come back — the editor enforced ${h3 && h3.limit}`);
  note(`C: the editor enforces each target's declared ceiling (H3 ${h3.limit.toLocaleString()}), not a hard-coded family number`);
}

function testTheCompilerBudgetDoesNotClaimToBeAProviderRule(engine = PromptEngine) {
  const profile = engine.getProfile("minimax-h3/multi-frame");
  const refs = [
    { key: "kf-1", label: "Beat 1", role: "sequential-keyframe", mediaType: "image", url: "/a.png", approved: true },
    { key: "kf-2", label: "Beat 2", role: "sequential-keyframe", mediaType: "image", url: "/b.png", approved: true },
  ];
  const spec = engine.defaultSpec(promptContext(), "motion", "r2v", refs, null);
  spec.narrativePurpose = "A long production objective with detailed requirements. ".repeat(60);
  const compiled = engine.compile(profile, spec, refs);
  const all = [...(compiled.warnings || []), ...(compiled.confirmations || [])].join(" ");
  assert(/written-package budget/i.test(all),
    `the compiler must name its own budget, got ${JSON.stringify(all.slice(0, 200))}`);
  assert(!/provider schema limit/i.test(all),
    "CineBraid's written-package budget must not be described as a provider schema limit");
  note("C: the compiler's length report names CineBraid's written-package budget and claims no provider rule");
}

/* ---------------------------------------------------------------------------
   D — grounding advice matches what the target can accept. */

/* The smallest context defaultSpec accepts, with one named character so a story name
   exists to be grounded or replaced. */
function promptContext() {
  return {
    project: { world: { setting: "Maintenance bay" }, styleBlocks: [], aspectRatio: "16:9" },
    scene: { title: "Hull", beat: "Kai checks the panel.", feeling: "Procedural" },
    shot: {
      id: "L1-01",
      title: "Hull check",
      description: "Kai checks the hull panel and steps away.",
      positioning: "Locked wide.",
      durationSeconds: 5,
      motionDirection: "Kai steps away from the panel.",
      characters: ["KAI"],
      audio: { dialogue: "", sfx: "" },
      risks: [],
    },
    references: [{ type: "character", id: "KAI", name: "Kai", canon: "Kai is an adult technician." }],
  };
}

function groundingWarning(profileId, refs, engine = PromptEngine) {
  const profile = engine.getProfile(profileId);
  const spec = engine.defaultSpec(promptContext(), "motion", profile.mode, refs, null);
  const compiled = engine.compile(profile, spec, refs);
  return {
    prompt: compiled.prompt,
    warning: (compiled.warnings || []).find((row) => /reference-aware identity language/i.test(row)) || "",
  };
}

function testAReplacedStoryNameIsAlwaysDisclosed(engine = PromptEngine) {
  const endpoint = { key: "shot-start", label: "Approved starting frame", mediaType: "image", role: "first-frame", url: "/frame.png", approved: true };
  const withAnchor = groundingWarning("minimax-h3/i2v", [endpoint], engine);
  const withNothing = groundingWarning("minimax-h3/t2v", [], engine);
  assert(withAnchor.warning, "a replaced story name must be disclosed even when an endpoint image carries the identity");
  assert(withNothing.warning, "a replaced story name must be disclosed when nothing carries the identity");
  assert(!/\bKai\b/.test(withAnchor.prompt), "the story name must not reach the model prompt ungrounded");
  note("D: a replaced story name is disclosed in both the anchored and the unanchored case");
}

function testTheAdviceMatchesWhatTheTargetCanAccept(engine = PromptEngine) {
  const endpoint = { key: "shot-start", label: "Approved starting frame", mediaType: "image", role: "first-frame", url: "/frame.png", approved: true };
  /* i2v: the checkpoint's single image slot is spent on the approved opening frame,
     so "attach an approved character image" is not advice, it is impossible. */
  const i2v = groundingWarning("minimax-h3/i2v", [endpoint], engine);
  assert(!/attach an approved character image/i.test(i2v.warning),
    `an endpoint-only workflow must not advise attaching a reference it cannot hold: ${i2v.warning}`);
  assert(/starting image/i.test(i2v.warning),
    `it must say where the identity is actually coming from: ${i2v.warning}`);
  /* r2v: the reference checkpoint really does take an identity image, so the advice
     stands and must not be lost along with the impossible one. */
  const r2v = groundingWarning("minimax-h3/multi-frame", [
    { key: "kf-1", label: "Beat 1", role: "sequential-keyframe", mediaType: "image", url: "/a.png", approved: true },
  ], engine);
  assert(/attach an approved character image/i.test(r2v.warning),
    `a reference-capable workflow must keep the actionable advice: ${r2v.warning}`);
  note("D: endpoint-only workflows name the starting image; reference-capable workflows keep the actionable advice");
}

/* ---------------------------------------------------------------------------
   The route guard, reading where the live writer writes. */

async function explicitTargetHandoff(mutateSource = null) {
  return inPage(multiFrameFixture(), `(() => {
    const s = shotById("L1-01");
    const r2v = guidedVideoProfiles().find((p) => p.family === "minimax-h3" && p.mode === "r2v");
    setGuidedMotionField("L1-01", "motionProfileId", r2v.id);
    setGuidedMotionField("L1-01", "motionDirection", "Slow push in as he steps away.");
    const c = ensureShotCreation(s);
    const unit = (s.clips || []).find((u) => u.id === c.activeMotionUnitId) || (s.clips || [])[0];
    return {
      chosen: r2v.id,
      storedOnUnit: unit ? unit.motionProfileId : null,
      directionOnUnit: unit ? unit.motionPrompt : null,
      suggestedAtTwoApproved: suggestedMotionProfileForApprovedFrames(s, 2),
    };
  })()`, mutateSource);
}

async function testAnExplicitTargetSurvivesTheFramesHandoff(mutateSource = null) {
  const result = await explicitTargetHandoff(mutateSource);
  assert.strictEqual(result.storedOnUnit, result.chosen, "the live writer must store the choice on the active motion unit");
  assert(result.directionOnUnit, "the live writer must store typed direction on the active motion unit");
  /* The guard exists so a directed shot keeps its own target instead of being moved
     by a frame count. It was reading the shot-level fields the live writer stopped
     touching, so it could never fire. */
  assert.strictEqual(result.suggestedAtTwoApproved, result.chosen,
    `a directed shot must keep its chosen target, got ${result.suggestedAtTwoApproved}`);
  note("route guard: an explicit target plus typed direction survives the frame-count suggestion");
}

/* ------------------------------------------------------------------------ */

async function main() {
  await testTheComposerStackIsTheOneUnderTest();
  await testMultiFrameSendsTheOrderedKeyframes();
  await testEachWaypointCarriesItsDirectedBeat();
  await testEveryDispatchableVideoRouteIsReachable();
  await testT2vIsSelectableAndNotDisabled();
  await testT2vCarriesNoReferenceImages();
  await testTheEditorCeilingIsNotKeyedOnAFamilyName();
  testTheCompilerBudgetDoesNotClaimToBeAProviderRule();
  testAReplacedStoryNameIsAlwaysDisclosed();
  testTheAdviceMatchesWhatTheTargetCanAccept();
  await testAnExplicitTargetSurvivesTheFramesHandoff();

  console.log("Generation truth / routing passed: the multi-frame keyframe sequence reaches the live package in order and with its directed beats, every dispatchable video route is reachable, text-to-video carries nothing and is gated on nothing, prompt ceilings belong to the stage that names them, and grounding advice matches what the selected target can accept. Provider calls made: 0.");
  for (const line of notes) console.log(`  - ${line}`);
}

module.exports = {
  editorCeilingFor,
  explicitTargetHandoff,
  groundingWarning,
  multiFrameFixture,
  promptContext,
  multiFramePackage,
  t2vReachability,
  testAReplacedStoryNameIsAlwaysDisclosed,
  testAnExplicitTargetSurvivesTheFramesHandoff,
  testEachWaypointCarriesItsDirectedBeat,
  testEveryDispatchableVideoRouteIsReachable,
  testMultiFrameSendsTheOrderedKeyframes,
  testT2vCarriesNoReferenceImages,
  testT2vIsSelectableAndNotDisabled,
  testTheAdviceMatchesWhatTheTargetCanAccept,
  testTheComposerStackIsTheOneUnderTest,
  testTheCompilerBudgetDoesNotClaimToBeAProviderRule,
  testTheEditorCeilingIsNotKeyedOnAFamilyName,
};

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

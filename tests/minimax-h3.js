const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PromptEngine = require('../src/generation/prompt-engine');
const { render, buildFixture, withCanon } = require('./render-harness');

function contextFixture() {
  return {
    project: { world: { setting: 'Orbital greenhouse' }, styleBlocks: [], aspectRatio: '16:9' },
    scene: { title: 'Signal Bloom', beat: 'The dormant greenhouse wakes.', feeling: 'Quiet wonder' },
    shot: {
      id: 'S02-01',
      title: 'Activation travels',
      description: 'Three strands of teal light travel through dead vines and wake a single flower.',
      durationSeconds: 10,
      motionDirection: 'The activation travels in a controlled sequence while the camera slowly pushes in.',
      audio: { dialogue: '', sfx: 'low electrical hum, glass resonance' },
      risks: ['identity drift', 'greenhouse geometry drift'],
    },
    references: [],
  };
}

function sequentialRefs(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    key: `kf-${index + 1}`,
    label: `Approved Frame ${String.fromCharCode(65 + index)}`,
    mediaType: 'image',
    role: 'sequential-keyframe',
    approved: true,
    url: `/assets/shots/S02-01/takes/FRAME_${String.fromCharCode(65 + index)}.png`,
    instruction: [
      'Dormant opening state',
      'First light reaches the vines',
      'Glow fills the greenhouse',
      'The flower opens and the movement settles',
    ][index] || `Beat ${index + 1}`,
  }));
}

function h3Spec(mode, refs) {
  const spec = PromptEngine.defaultSpec(contextFixture(), 'motion', mode, refs, null);
  spec.durationSeconds = 10;
  spec.actions = [
    { start: 0, end: 3, action: 'The first teal strand moves through the dormant vines.' },
    { start: 3, end: 7, action: 'The remaining strands spread through the greenhouse in sequence.' },
    { start: 7, end: 10, action: 'One flower opens and the motion settles into a brief hold.' },
  ];
  spec.camera = { ...(spec.camera || {}), movement: 'slow push in', stability: 'smooth' };
  spec.audio = { ...(spec.audio || {}), sfx: 'low electrical hum, glass resonance', ambience: 'quiet greenhouse room tone' };
  return spec;
}

function testProfiles() {
  const expected = {
    'minimax-h3/t2v': 'minimax/h3/text-to-video',
    'minimax-h3/i2v': 'minimax/h3/image-to-video',
    'minimax-h3/flf': 'minimax/h3/image-to-video',
    'minimax-h3/multi-frame': 'minimax/h3/reference-to-video',
  };
  for (const [id, endpoint] of Object.entries(expected)) {
    const profile = PromptEngine.getProfile(id);
    assert(profile, `${id} should exist`);
    assert.strictEqual(profile.family, 'minimax-h3');
    assert.strictEqual(profile.falEndpoint, endpoint);
  }
  const multi = PromptEngine.getProfile('minimax-h3/multi-frame');
  assert.strictEqual(multi.limits.maxImages, 9);
  assert.strictEqual(multi.limits.maxVideos, 3);
  assert.strictEqual(multi.limits.maxAudio, 3);
  assert.strictEqual(multi.limits.maxReferences, 12);
  assert.strictEqual(multi.limits.writingTargetCharacters, 2000);
}

function testMultiFrameCompile() {
  const refs = sequentialRefs(4);
  const profile = PromptEngine.getProfile('minimax-h3/multi-frame');
  const compiled = PromptEngine.compile(profile, h3Spec('r2v', refs), refs);
  assert(compiled.prompt.includes('SEQUENTIAL KEYFRAME CONTRACT'));
  assert(compiled.prompt.includes('Use Image 1, Image 2, Image 3, Image 4 as sequential keyframes in this exact order'));
  assert(compiled.prompt.includes('[0–3 seconds]'));
  assert(compiled.prompt.includes('NATIVE STEREO AUDIO'));
  assert.strictEqual(compiled.payload.fal.endpoint, 'minimax/h3/reference-to-video');
  assert.deepStrictEqual(compiled.payload.fal.input.reference_image_urls, refs.map((ref) => ref.url));
  assert.strictEqual(compiled.payload.fal.input.duration, 10);
  assert.strictEqual(compiled.payload.fal.input.resolution, '2K');
  assert(!compiled.warnings.some((row) => /first-frame|last-frame/i.test(row)), 'multi-frame R2V should not require FLF role labels');
}


function testMixedKeyframeRolesRemainSequential() {
  const refs = sequentialRefs(4).map((ref, index) => ({
    ...ref,
    role: index === 0 ? "first-frame" : index === 3 ? "last-frame" : "keyframe",
  }));
  const profile = PromptEngine.getProfile("minimax-h3/multi-frame");
  const compiled = PromptEngine.compile(profile, h3Spec("r2v", refs), refs);
  assert(compiled.prompt.includes("Use Image 1, Image 2, Image 3, Image 4 as sequential keyframes in this exact order"));
  assert(compiled.confirmations.some((row) => /4 ordered MiniMax H3 image waypoints/i.test(row)));
  assert(!compiled.warnings.some((row) => /outside the sequential keyframe contract/i.test(row)));
}

function testPromptLimitAndLegacyTokenNormalization() {
  const refs = sequentialRefs(9).map((ref, index) => ({
    ...ref,
    token: `#image${index + 1}`,
    label: `Verbose approved keyframe ${index + 1}`,
    instruction: (`Detailed waypoint ${index + 1}: preserve identity, wardrobe, architecture, camera geometry, lighting logic, and the exact approved visual beat. `).repeat(8),
  }));
  const profile = PromptEngine.getProfile('minimax-h3/multi-frame');
  const spec = h3Spec('r2v', refs);
  spec.durationSeconds = 15;
  spec.narrativePurpose = 'A long production objective with detailed visual, performance, transition, typography, and audio requirements. '.repeat(80);
  spec.actions = Array.from({ length: 9 }, (_, index) => ({
    start: index,
    end: index + 1,
    action: (`Detailed action beat ${index + 1} with controlled performance, camera, and environment motion. `).repeat(10),
  }));
  spec.mustPreserve = ['Preserve identity, wardrobe, location geometry, props, lighting logic, and screen direction. '.repeat(50)];
  spec.mustAvoid = ['Avoid drift, warping, morphing, invented props, unwanted cuts, text corruption, and camera discontinuity. '.repeat(50)];
  spec.mustAvoid[0] += " Never replace the final blue seal with a red seal.";
  const compiled = PromptEngine.compile(profile, spec, refs);
  assert(compiled.prompt.length > 2000, `H3 written package must preserve intent beyond its 2,000-character preference, got ${compiled.prompt.length}`);
  assert(compiled.prompt.includes('Image 9'), 'the complete package preserves all numbered keyframe references');
  assert(!compiled.prompt.includes('#image'), 'legacy adapter tokens must be normalized to H3 modality/order syntax');
  assert(compiled.prompt.includes("Never replace the final blue seal with a red seal"),
    "a soft writing target cannot silently truncate a late owner constraint");
  /* The preferred authoring length warns but never clips owner intent or claims
     that fal's much larger hard provider ceiling is 2,000 characters. */
  assert(compiled.warnings.some((row) => /exceeds CineBraid's writing target/i.test(row)),
    'the compiler warns above its advisory writing target');
  assert(!compiled.warnings.some((row) => /provider schema limit/i.test(row)),
    "and must not describe CineBraid's writing target as a provider schema limit");
}

function testFirstLastCompile() {
  const refs = [
    { ...sequentialRefs(1)[0], role: 'first-frame', label: 'Opening frame' },
    { ...sequentialRefs(2)[1], role: 'last-frame', label: 'Closing frame' },
  ];
  const profile = PromptEngine.getProfile('minimax-h3/flf');
  const compiled = PromptEngine.compile(profile, h3Spec('flf', refs), refs);
  assert(compiled.prompt.includes('MINIMAX H3 FIRST / LAST FRAME'));
  assert(compiled.prompt.includes('ENDPOINT CONTRACT'));
  assert(compiled.prompt.includes('Image 1'));
  assert(compiled.prompt.includes('Image 2'));
  assert.strictEqual(compiled.payload.fal.endpoint, 'minimax/h3/image-to-video');
  assert.strictEqual(compiled.payload.fal.input.image_url, refs[0].url);
  assert.strictEqual(compiled.payload.fal.input.end_image_url, refs[1].url);
}

/* This is the saved, user-visible Build compiler used by /api/prompt/compile,
   not only the later exact fal provider-plan compiler. R03 arrived with an
   owner paragraph and a structured summary occupying the same 0–5s window. */
function testNativeI2VBuildKeepsOneOwnerDirection() {
  const firstFrame = {
    ...sequentialRefs(1)[0],
    role: "first-frame",
    label: "SAMPLE-03-OPEN.png",
    url: "/assets/shots/SAMPLE-03/SAMPLE-03-OPEN.png",
  };
  const ownerDirection = "Continue the approved Frame A of the opened blue parcel on the platform bench for five seconds. Keep the parcel's blue paper, open folds, bench, platform, and 16:9 composition stable. Make one slow, steady camera push-in with subtle ambient movement only. No new character or object, cut, location change, closing of the parcel, added text, dialogue, or music. Preserve the flat illustrated style.";
  const spec = h3Spec("i2v", [firstFrame]);
  spec.durationSeconds = 5;
  spec.narrativePurpose = "The opened blue parcel remains on the platform bench.";
  spec.actions = [
    { start: 0, end: 5, action: "Continue the approved Frame A of the opened blue parcel on the platform bench for five seconds; the parcel stays open.. Secondary motion: Subtle ambient movement on the platform only." },
    { start: 0, end: 5, action: ownerDirection },
  ];
  spec.motionBrief = { additionalDirection: ownerDirection };
  spec.camera = { movement: "One slow, steady camera push-in", stability: "steady" };
  spec.audio = { mode: "none", dialogue: "", transcript: "", delivery: "Language: English; Pace: natural; Volume: normal", language: "English", pace: "Normal", volume: "Normal", sfx: "", ambience: "" };
  spec.mustPreserve = ["Blue paper, open folds, bench, platform, 16:9 composition, and flat illustrated style."];
  spec.mustAvoid = ["No new character or object, cut, location change, closing of the parcel, added text, dialogue, or music."];
  const source = JSON.stringify(spec);
  const compiled = PromptEngine.compile(PromptEngine.getProfile("minimax-h3/i2v"), spec, [firstFrame]);
  assert.strictEqual(JSON.stringify(spec), source, "the compiler must not revise Canon or source spec");
  assert.strictEqual((compiled.prompt.match(/Continue the approved Frame A of the opened blue parcel on the platform bench for five seconds/g) || []).length, 1,
    "the saved Build must contain the owner's opening direction once");
  assert(/the parcel stays open/i.test(compiled.prompt), "distinct structured continuity must survive deduplication");
  assert(compiled.prompt.includes("Subtle ambient movement on the platform only"), "distinct secondary motion must survive deduplication");
  assert(!compiled.prompt.includes("open.."), "punctuation from a structured summary must be normalized");
  assert(!compiled.prompt.includes("Camera One"), "noun-phrase camera wording must not be prepended with a bare Camera");
  assert(!/\nCAMERA\n/.test(compiled.prompt), "a camera move already in the owner direction must not be restated");
  assert(!compiled.prompt.includes("Courier"), "a parcel-only target must not invent a character");
  assert(!compiled.warnings.some((warning) => /dialogue/i.test(String(warning))), "unused dialogue defaults must not become a warning");
  assert.strictEqual(compiled.payload.fal.input.image_url, firstFrame.url, "Frame A remains the only opening input");
  assert(!compiled.payload.fal.input.end_image_url && !compiled.payload.fal.input.reference_image_urls,
    "I2V must not acquire an end frame or R2V references");
}
function testSemicolonAuthoredDirectionSurvivesDedup() {
  const authored = "Rain sheets across the empty platform canopy at dusk; puddles ripple under the sodium lamps.";
  const style = "Clean graphic storyboard placeholders for a manual production-organizing sample.";
  const spec = h3Spec("t2v", []);
  spec.durationSeconds = 5;
  spec.visualStyle = [style];
  spec.actions = [
    { start: 0, end: 5, action: authored },
    { start: 0, end: 5, action: "Puddles ripple under the sodium lamps." },
  ];
  const compiled = PromptEngine.compile(PromptEngine.getProfile("minimax-h3/t2v"), spec, []);
  /* The provider-plan B-roll suites separately assert that the project look reaches fal. */
  assert.strictEqual(compiled.prompt.split(authored).length - 1, 1,
    "the exact semicolon-joined owner direction survives once");
  assert.strictEqual((compiled.prompt.match(/puddles ripple under the sodium lamps/gi) || []).length, 1,
    "the overlapping second action is deduplicated without changing the owner direction");
  assert(!compiled.prompt.includes(";."), "deduplication cannot create malformed semicolon-period punctuation");
}
function testNativeMotionDedupPreservesRelationsAndNegation() {
  const frame = { ...sequentialRefs(1)[0], role: "first-frame" };
  const profile = PromptEngine.getProfile("minimax-h3/i2v");
  for (const [first, second] of [
    ["Place the parcel in the box.", "Place the parcel on the box."],
    ["Move his hand.", "Move her hand."],
    ["Do not under any circumstances keep the parcel open.", "Keep the parcel open."],
  ]) {
    const spec = h3Spec("i2v", [frame]);
    spec.actions = [{ start: 0, end: 5, action: first }];
    const withBrief = PromptEngine.applyMotionAudioBrief(spec, { performance: { action: second } });
    assert.strictEqual(withBrief.actions.length, 2,
      "structured direction must retain a distinct spatial, ownership, or opposite-polarity clause");
    const compiled = PromptEngine.compile(profile, withBrief, [frame]);
    assert(compiled.prompt.includes(first), "native Build must retain the first exact clause: " + first);
    assert(compiled.prompt.includes(second), "native Build must retain the second exact clause: " + second);
  }
  const cameraConflict = h3Spec("i2v", [frame]);
  cameraConflict.actions = [{ start: 0, end: 5,
    action: "Do not under any circumstances make one slow, steady camera push-in." }];
  cameraConflict.camera = { movement: "One slow, steady camera push-in", stability: "steady" };
  const cameraBuild = PromptEngine.compile(profile, cameraConflict, [frame]);
  assert(cameraBuild.prompt.includes("Do not under any circumstances make one slow, steady camera push-in."),
    "native Build retains the negative authored camera clause");
  assert(cameraBuild.prompt.includes("The camera makes one slow, steady push-in"),
    "the positive camera control remains visible despite distant negation");
}
function testSourceIntegration() {
  const root = path.join(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'public', 'creation-studio.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public', 'fal-generation.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'src/generation/fal/fal-generation.js'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'src/generation/fal/fal-h3-backend.js'), 'utf8');
  const motionComposer = fs.readFileSync(path.join(root, 'public', 'motion-sound-composer.js'), 'utf8');
  assert(ui.includes('MINIMAX H3 · MULTI-FRAME INPUT'));
  assert(ui.includes('setH3KeyframeEnabled'));
  assert(ui.includes('setH3KeyframeNote'));
  assert(ui.includes('setH3SequenceNote'));
  assert(client.includes('openFalH3MotionModal'));
  assert(client.includes('startFalH3MotionGeneration'));
  assert(client.includes('clientRequestId'));
  assert(client.includes('_falH3Submitting'));
  assert(client.includes('fal-h3-cost-estimate'));
  assert(ui.includes('REVIEW ALL WITH AI'));
  assert(ui.includes('Automatically review new options'));
  assert(ui.includes('openMediaTheatre'));
  assert(client.includes('h3-generation-scroll'));
  assert(client.includes('h3-generation-actions'));
  /* The provider endpoints and the reference ceilings moved into the backend module
     when execution started consuming the compiled plan. They are asserted where they
     now live rather than dropped. */
  assert(backend.includes('minimax/h3/reference-to-video'));
  assert(backend.includes('maxTotal: 12'));
  assert(backend.includes('H3_REFERENCE_OVER_LIMIT'));
  /* The 2,000-character refusal is GONE, and its absence is the assertion. fal's queue
     schema documents no maxLength on any H3 endpoint and fal's own model page states
     7,000 — the same number MiniMax documents — so refusing at 2,000 destroyed
     direction a filmmaker had written for a limit that no longer exists. The ceiling is
     now the model ∩ backend intersection, and it refuses rather than truncating. */
  assert(!server.includes('current fal queue schema accepts at most 2,000'),
    'the stale 2,000-character dispatch refusal must not come back');
  assert(backend.includes('maxPromptCharacters: 7000'));
  assert(server.includes('H3_PROMPT_OVER_LIMIT') || backend.includes('H3_PROMPT_OVER_LIMIT'));
  assert(server.includes('ingestMotion'));
  assert(motionComposer.includes('\"minimax-h3\"') || motionComposer.includes('\"minimax-h3\"'.replace(/\\/g,'')), 'Motion & Sound Composer must allow MiniMax H3 profiles');
}

async function testRenderedMultiFrameWorkspace() {
  const project = withCanon(buildFixture(), [
    { kind: 'entity-state', list: 'characters', entityId: 'KAI', stateId: 'state-default', value: 'KAI-ANCHOR.png' },
    { kind: 'entity-state', list: 'locations', entityId: 'LOC-HULL', stateId: 'state-default', value: 'LOC-HULL-PLATE.png' },
    { kind: 'entity-state', list: 'props', entityId: 'PR-TOOL', stateId: 'state-default', value: 'PR-TOOL-PLATE.png' },
  ]);
  /* THE FIXTURE DECLARES THAT IT DELIVERS MOTION. The Motion workspace no longer
     offers NEW generation to a shot that has declared no delivery, and this case is
     about the H3 multi-frame controls that workspace draws once it is creating one. */
  project.shots[0].creationBrief = {
    deliveryIntent: 'motion',
    motionProfileId: 'minimax-h3/multi-frame',
    motionDuration: 10,
    h3Keyframes: {
      'frame-a': { enabled: true, note: 'Opening beat' },
      'frame-b': { enabled: true, note: 'Closing beat' },
    },
    h3SequenceNote: 'Move continuously between the two approved frames.',
  };
  const result = await render('#/shot/L1-01', project, {
    storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'motion' },
  });
  const motionState = vm.runInContext(`shotStageState("motion", shotStageModelFacts(P.shots[0], takesFor(P.shots[0].id)))`, result.context);
  assert.strictEqual(motionState.availability, 'available',
    'fixture precondition: canonical readiness, not an H3-specific rule, must open Motion');
  assert(result.html.includes('MINIMAX H3 · MULTI-FRAME INPUT'));
  assert(result.html.includes('Sequence / transition direction'));
  assert(result.html.includes('2/9 ACTIVE'));
  assert(result.html.includes('Use as sequential keyframe'));
}

async function main() {
  testProfiles();
  testMultiFrameCompile();
  testMixedKeyframeRolesRemainSequential();
  testPromptLimitAndLegacyTokenNormalization();
  testFirstLastCompile();
  testNativeI2VBuildKeepsOneOwnerDirection();
  testSemicolonAuthoredDirectionSurvivesDedup();
  testNativeMotionDedupPreservesRelationsAndNegation();
  testSourceIntegration();
  await testRenderedMultiFrameWorkspace();
  console.log('MiniMax H3 suite passed profile registration, first/last-frame packaging, ordered multi-frame prompting, provider prompt limits, legacy-token normalization, spend/idempotency hooks, FAL payload previews, rendered keyframe UI, and server integration hooks.');
}

main().catch((error) => { console.error(error); process.exit(1); });

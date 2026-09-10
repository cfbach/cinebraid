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
  assert.strictEqual(multi.limits.maxPromptCharacters, 2000);
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
  const compiled = PromptEngine.compile(profile, spec, refs);
  assert(compiled.prompt.length <= 2000, `H3 written package must fit CineBraid's 2,000-character budget, got ${compiled.prompt.length}`);
  assert(compiled.prompt.includes('Image 9'), 'compaction must preserve all numbered keyframe references');
  assert(!compiled.prompt.includes('#image'), 'legacy adapter tokens must be normalized to H3 modality/order syntax');
  /* The near-limit warning still fires; what changed is what it CLAIMS the limit is.
     2,000 is CineBraid's budget for the written package - fal-h3-backend.js records
     that fal's queue schema documents no prompt maxLength on any H3 endpoint and
     retired the 2,000 refusal - so a warning calling it "the provider schema limit"
     asserted a provider rule that does not exist. The number stays; the claim goes. */
  assert(compiled.warnings.some((row) => /close to CineBraid's written-package budget/i.test(row)),
    'the compiler must still warn near its written-package budget');
  assert(!compiled.warnings.some((row) => /provider schema limit/i.test(row)),
    "and must not describe CineBraid's own budget as a provider schema limit");
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
  testSourceIntegration();
  await testRenderedMultiFrameWorkspace();
  console.log('MiniMax H3 suite passed profile registration, first/last-frame packaging, ordered multi-frame prompting, provider prompt limits, legacy-token normalization, spend/idempotency hooks, FAL payload previews, rendered keyframe UI, and server integration hooks.');
}

main().catch((error) => { console.error(error); process.exit(1); });

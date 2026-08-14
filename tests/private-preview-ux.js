const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, buildFixture } = require('./render-harness');

const ROOT = path.join(__dirname, '..');

function previewScan(project) {
  const shot = project.shots[0];
  return {
    anchors: [...new Set((project.characters || []).flatMap((x) => [x.approvedFile, ...(x.continuityStates || []).map((state) => state.approvedFile)].filter(Boolean)))].map((name) => ({ name, url: `/assets/anchors/${name}` })),
    plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
    props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
    vehicles: [], audio: [], media: [],
    shots: {
      [shot.id]: {
        takes: [
          { name: 'FRAME_A.png', url: `/assets/shots/${shot.id}/takes/FRAME_A.png` },
          { name: 'FRAME_B.png', url: `/assets/shots/${shot.id}/takes/FRAME_B.png` },
          { name: 'MOTION_REVIEW.mp4', url: `/assets/shots/${shot.id}/takes/MOTION_REVIEW.mp4` },
        ],
        locked: [],
      },
    },
  };
}

async function main() {
  const project = buildFixture();
  project.meta.workflowEmphasis = 'manual';
  project.characters[0].continuityStates = [
    { id: 'state-default', name: 'Offline', isDefault: true, approvedFile: 'KAI-ANCHOR.png', referenceRequirement: 'required', notes: 'Offline state.' },
    { id: 'state-active', name: 'Active', isDefault: false, parentStateId: 'state-default', approvedFile: 'KAI-ACTIVE.png', referenceRequirement: 'required', notes: 'Active state.' },
  ];
  project.shots[0].creationBrief = project.shots[0].creationBrief || {};
  project.mediaAssets.push(
    {
      id: 'blocking-preview-a', file: 'BLOCK_A.png', storagePath: 'shots/L1-01/blocking/BLOCK_A.png', title: 'Blocking A', kind: 'image',
      links: [{ id: 'blocking-preview-link-a', targetType: 'shot', targetId: 'L1-01', role: 'blocking-frame', blockingState: 'returned', order: 1 }],
    },
    {
      id: 'blocking-preview-b', file: 'BLOCK_B.png', storagePath: 'shots/L1-01/blocking/BLOCK_B.png', title: 'Blocking B', kind: 'image',
      links: [{ id: 'blocking-preview-link-b', targetType: 'shot', targetId: 'L1-01', role: 'blocking-frame', blockingState: 'returned', order: 2 }],
    },
  );
  const look = await render('#/shot/L1-01', project, { storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'look' } });
  assert(look.html.includes('blocking-review-console'), 'blocking review must be visible outside the assisted disclosure');
  assert(look.html.includes('REVIEW ALL WITH AI'), 'blocking review must expose one manual group-review action');
  assert(look.html.includes('Automatically review new options'), 'blocking review must expose automatic scoring for newly returned attempts');
  assert(look.html.includes('openBlockingAttemptViewer'), 'blocking thumbnails must remain inspectable');

  const scan = previewScan(project);
  const framesStorage = { 'cinebraid-focused:fixture:shot-task:L1-01': 'frames' };
  const framesPending = await render('#/shot/L1-01', project, { scan, storage: framesStorage });
  assert(framesPending.html.includes('PAIR CONTINUITY CHECK REQUIRED'), 'two approved anchors must require a sequence continuity review');
  assert(framesPending.html.includes('REVIEW FRAME SEQUENCE'), 'frame sequence review must be directly available in Frames');
  assert(framesPending.html.includes('Review sequence first'), 'per-frame motion handoff must stay locked until the sequence passes');

  /* P1-2 -- MOTION READINESS TRUTH.
     Two separate lies lived in this one CTA and each gets its own assertion.

     1. THE COPY. It claimed first/last and multi-frame motion "stay locked until camera,
        environment, lighting, character and prop continuity pass". The shipped runtime
        declares exactly ONE motion prerequisite -- required-frames-approved, in
        public/shared-stage-model.js -- so the stage bar reaches Motion, FLF is selectable
        and Generate is present with this check never run. The claim is cross-read against
        the model that owns it rather than pinned to a sentence, so rewording the copy
        cannot quietly restore the falsehood.
     2. THE CONTROL. `CHECK MOTION READINESS` is a vision call. It was primary, enabled
        and refused in a toast AFTER the click, while its two siblings on the same screen
        read the same capability and disable themselves with the reason showing. */
  const motionStages = require(path.join(ROOT, 'public', 'shared-stage-model.js'));
  const motionPrereqs = motionStages.SHOT_STAGES.find((stage) => stage.id === 'motion').prerequisites.map((item) => item.id);
  assert.deepStrictEqual(motionPrereqs, ['required-frames-approved'],
    'precondition: the shipped runtime gates Motion on approved required frames and nothing else -- if that changed, this copy has to be rewritten, not this assertion');
  assert(!/motion stay locked until|stay locked until camera/i.test(framesPending.html),
    'the motion readiness CTA must not claim motion is locked by a check the runtime does not gate motion on');
  assert(framesPending.html.includes('It does not lock Motion & sound: that stage opens once the required frames are approved.'),
    'the CTA must state what the executable runtime actually requires');

  const visionOff = {
    capabilities: {
      text: { ready: true, label: 'Text assistance', message: '', action: '' },
      verifier: { ready: true, label: 'Prompt verification', message: '', action: '' },
      vision: { ready: false, label: 'Vision assistance', message: 'Vision assistance is disabled in AI Assistant settings.', action: 'Open Settings to enable it.' },
      continuity: { ready: true, label: 'Continuity observation', message: '', action: '' },
      embedding: { ready: true, label: 'Local semantic search', message: '', action: '' },
      technical: { ready: true, label: 'Technical analysis', message: '', action: '' },
    },
  };
  const framesNoVision = await render('#/shot/L1-01', project, { scan, storage: framesStorage, agentStatus: visionOff });
  const readinessButton = /<button[^>]*reviewGuidedFrameSequence\('L1-01'\)[^>]*>\s*CHECK MOTION READINESS/.exec(framesNoVision.html);
  assert(readinessButton, 'the motion readiness control must still render when vision is off');
  assert(readinessButton[0].includes(' disabled'),
    'CHECK MOTION READINESS must be disabled when the capability it invokes is unavailable, not enabled and refused in a toast');
  assert(framesNoVision.html.includes('id="motion-readiness-unavailable-L1-01"')
    && framesNoVision.html.includes('Vision assistance is disabled in AI Assistant settings. Open Settings to enable it.'),
    'the reason must be readable inline, from the capability record, not only in a toast after the click');
  assert(readinessButton[0].includes('aria-describedby="motion-readiness-unavailable-L1-01"'),
    'the disabled control must point at its own reason');
  /* The per-frame chip runs the SAME handler. A fix that left it enabled would leave the
     identical defect one panel away. */
  assert(/<button[^>]*reviewGuidedFrameSequence\('L1-01'\)[^>]*disabled[^>]*>Review sequence first/.test(framesNoVision.html),
    'the per-frame sequence-review chip invokes the same capability and must answer to it too');
  /* And the control is untouched when the capability IS ready -- a gate that is always
     shut is not a gate. */
  assert(!/<button[^>]*reviewGuidedFrameSequence\('L1-01'\)[^>]*disabled/.test(framesPending.html),
    'a ready vision capability must leave the readiness check enabled');

  /* NEGATIVE CONTROLS, IN MEMORY. The two assertions above have to be watched failing or
     they are claims, not evidence. Both reintroduce the shipped defect by patching the
     source the harness evaluates -- nothing is written to disk, so no checkout can be
     what restores the product code, and no unstaged work can be discarded doing it. */
  const mutateOnce = (file, needle, replacement, label) => (name, source) => {
    if (name !== file) return source;
    const hits = source.split(needle).length - 1;
    assert.strictEqual(hits, 1, `negative control ${label}: anchor matched ${hits} times, expected 1 -- the control is stale and must be rewritten`);
    return source.split(needle).join(replacement);
  };

  /* NC-1: the readiness control goes back to enabled-and-toast-afterwards. */
  const enabledAgain = await render('#/shot/L1-01', project, {
    scan, storage: framesStorage, agentStatus: visionOff,
    mutateSource: mutateOnce('creation-studio.js',
      '${motionReadinessDescribedBy}${aiDisabledAttrs("vision")}>${sequenceReview ? "CHECK AGAIN"',
      '>${sequenceReview ? "CHECK AGAIN"', 'NC-1'),
  });
  const enabledButton = /<button[^>]*reviewGuidedFrameSequence\('L1-01'\)[^>]*>\s*CHECK MOTION READINESS/.exec(enabledAgain.html);
  assert(enabledButton && !enabledButton[0].includes(' disabled'),
    'NC-1 did not reintroduce the defect: the readiness control must be observed ENABLED with vision off before its guard proves anything');

  /* NC-2: the false locking sentence comes back. */
  const lockedAgain = await render('#/shot/L1-01', project, {
    scan, storage: framesStorage,
    mutateSource: mutateOnce('creation-studio.js',
      'This check compares the approved anchors before they drive a first/last or multi-frame generation. It does not lock Motion & sound: that stage opens once the required frames are approved.',
      'First/last and multi-frame motion stay locked until camera, environment, lighting, character, and prop continuity pass.', 'NC-2'),
  });
  assert(/stay locked until camera/i.test(lockedAgain.html),
    'NC-2 did not reintroduce the defect: the false locking copy must be observed on screen before its guard proves anything');
  project.shots[0].creationBrief = project.shots[0].creationBrief || {};
  project.shots[0].creationBrief.frameSequenceReview = {
    pass: true, score: 92, files: ['FRAME_A.png','FRAME_B.png'], reviewedAt: '2026-08-03T10:00:00Z',
    summary: 'Camera, environment, and lighting remain stable.', nextAction: 'Proceed to motion.',
    categories: { camera:{score:94,note:'Stable'}, environment:{score:92,note:'Stable'}, lighting:{score:91,note:'Stable'}, character:{score:93,note:'Stable'}, props:{score:90,note:'Stable'}, intendedProgression:{score:94,note:'Clear'} }, blockingIssues: []
  };
  const framesPassed = await render('#/shot/L1-01', project, { scan, storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'frames' } });
  assert(framesPassed.html.includes('PAIR CONTINUITY PASSED'), 'passed frame sequence review must be visible');
  assert(framesPassed.html.includes('First / last-frame motion is ready'), 'motion readiness must require the passed sequence review');
  const motion = await render('#/shot/L1-01', project, { scan, storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'motion' } });
  assert(motion.html.includes('motion-workflow-map'), 'motion must expose a three-stage navigation map');
  for (const text of ['1 · APPROVED FRAMES', '2 · RETURNED VIDEO', '3 · ASSISTED MOTION']) assert(motion.html.includes(text), `${text} heading missing`);
  assert(motion.html.includes('guided-motion-frame-preview'), 'approved motion frames must open larger previews');
  assert(motion.html.includes('Larger preview'), 'returned videos must expose a non-fullscreen larger player');
  assert(motion.html.includes('openMediaTheatre'), 'motion media must use the in-app theatre preview');
  motion.context.openMediaTheatre(encodeURIComponent('/assets/shots/L1-01/takes/FRAME_A.png'), encodeURIComponent('Frame A'), 'image');
  const modal = motion.context.document.getElementById('modal').innerHTML;
  assert(modal.includes('media-theatre-modal') && modal.includes('media-theatre-stage'), 'larger preview must render in the bounded theatre modal');

  const entity = await render('#/character/KAI', project, { scan });
  assert(entity.html.includes('entity-authority-thumb-button'), 'approved authority thumbnails must be separate preview controls');
  /* O5 CHANGED WHAT THIS THUMBNAIL OPENS, and the assertion changed with it rather than
     being dropped. The image behind an approved authority thumbnail is the one that
     DEFINES a continuity state, so "what is this the authority for, and who approved it"
     is the question a filmmaker has there -- it now opens the Universal Media Inspector,
     which offers the larger view as one of its own actions.
     The property this line exists for is unchanged: the control must go through the ONE
     bounded hand-off rather than opening a viewer of its own, and that hand-off resolves
     to the single shipped theatre (proven in tests/image-review-scale.js against
     public/media-inspector.js). */
  assert(entity.html.includes('inspectMediaFile('), 'authority thumbnails must open the Universal Media Inspector through the one bounded hand-off');
  assert(!/entity-authority-thumb-button[^>]*openMediaTheatre/.test(entity.html), 'the authority thumbnail must not bypass the Inspector by opening the theatre directly');
  entity.context.boundedWriteState('selected:entity-coverage-view','characters:KAI','states');
  entity.context.boundedWriteState('selected:continuity-state','characters:KAI','state-active');
  entity.context.selectBoundedTask('entity-task','characters:KAI','coverage');
  await new Promise((resolve) => setTimeout(resolve, 10));
  const entityStateHtml = entity.context.document.getElementById('main').innerHTML;
  assert(entityStateHtml.includes('CURRENT APPROVED IMAGE') && entityStateHtml.includes('state-approved-preview'), 'selected state must show its approved image near the top with a large-preview control');

  look.context.openShotAutomationModal('L1-01');
  const automationModal = look.context.document.getElementById('modal').innerHTML;
  for (const id of ['shot-auto-outputs','shot-auto-blocking-quality','shot-auto-blocking-resolution','shot-auto-frame-quality','shot-auto-frame-resolution']) assert(automationModal.includes(id), `${id} missing from full-shot automation`);
  assert(automationModal.includes('Images per pass') && automationModal.includes('GENERATION SETTINGS'), 'automation must expose grouped generation settings');
  const outputSelect = look.context.document.getElementById('shot-auto-outputs');
  outputSelect.value = '4';
  look.context.v6211SyncGenerationControls('shot');
  assert.strictEqual(look.context._v626ShotAutomationDraft.outputsPerRequest, 4, 'images-per-pass must persist into the automation draft');

  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'public', 'fal-generation.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(app.includes('restoreTrashedProject') && app.includes('Recently deleted projects'), 'project management must restore recoverable trash');
  assert(styles.includes('--media-well') && styles.includes('#app[data-surf="light"]{--media-well:'), 'dark and light themes must define media-well colors');
  assert(styles.includes('.modal-box:has(.h3-generation-modal)') && styles.includes('.h3-generation-scroll'), 'H3 modal must use a bounded shell with an internal scroll area');
  assert(styles.includes('.motion-workflow-map') && styles.includes('.motion-workflow-section'), 'motion hierarchy styles must be present');
  assert(styles.includes('.guided-frame-approved-preview{width:300px!important') && styles.includes('height:220px!important'), 'approved inline frame previews must stay bounded');
  assert(styles.includes('.frame-sequence-review') && styles.includes('.frame-sequence-category-grid'), 'frame-pair continuity review must have a readable UI');
  assert(styles.includes('.state-approved-hero') && styles.includes('.entity-authority-thumb-button'), 'approved continuity-state authority must be prominent and previewable');
  assert(styles.includes('.automation-generation-controls') && styles.includes('.automation-plan-modal>.checkline'), 'automation generation controls and aligned checkboxes must be styled');
  assert(client.includes('h3-generation-head') && client.includes('h3-generation-actions'), 'H3 modal markup must have fixed header/footer regions');
  assert(server.includes('WORKSPACE_SETTINGS_ENDPOINT_REQUIRED'), 'unsafe storage-path changes must be rejected by the general config endpoint');
  assert(server.includes('/api/projects/trash/:trashName/restore'), 'trashed project restore endpoint must exist');

  console.log('Private-preview UX suite passed blocking AI review, gated frame-sequence continuity, motion-readiness capability truth (2 negative controls), bounded approved previews, media theatre, motion hierarchy, approved-state authority previews, automation controls, H3 modal containment, storage-route protection, and trash restoration hooks.');
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });

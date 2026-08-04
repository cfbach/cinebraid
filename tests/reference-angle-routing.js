const assert = require('assert');
const { render, buildFixture } = require('./render-harness');
const {
  inferReferenceViewFromText,
  referenceViewCompatibility,
  referenceViewScore,
} = require('../public/shared-reference-views');

async function main() {
  assert.strictEqual(inferReferenceViewFromText('The character stands with their back to the camera, facing away.'), 'rear');
  assert.strictEqual(inferReferenceViewFromText('Rear three-quarter view from camera right.'), 'rear-three-quarter-right');
  assert.strictEqual(referenceViewCompatibility('rear', 'front'), 'opposite');
  assert.strictEqual(referenceViewCompatibility('rear', 'rear-three-quarter-left'), 'near');
  assert(referenceViewScore('rear', 'rear', { referenceKind: 'single-angle' }) > referenceViewScore('rear', 'front', { referenceKind: 'single-angle' }));
  assert(referenceViewScore('rear', 'rear-three-quarter-left', { referenceKind: 'single-angle' }) > referenceViewScore('rear', 'front', { referenceKind: 'single-angle' }));

  const project = buildFixture();
  project.mediaAssets.push({
    id: 'media-kai-rear',
    file: 'KAI-REAR.png',
    title: 'Kai rear view',
    originalName: 'KAI-REAR.png',
    links: [{
      id: 'link-kai-rear',
      targetType: 'character',
      targetId: 'KAI',
      role: 'alternate-view',
      angleTag: 'rear',
      referenceKind: 'single-angle',
      priority: 'supporting',
      notes: 'Rear identity view.',
      agentContext: true,
      generationInput: true,
      order: 1,
    }],
  });
  const shot = project.shots[0];
  shot.desc = 'Kai stands with his back to the camera, facing away down the corridor.';
  shot.positioning = 'Rear view. Camera sees Kai from behind.';
  shot.creationBrief = {
    ...(shot.creationBrief || {}),
    locationId: 'LOC-HULL',
    propIds: ['PR-TOOL'],
    composition: {
      camera: {
        shotSize: 'medium',
        height: 'eye-level',
        angle: 'level',
        lens: 'normal',
        // Reproduce the legacy default that previously forced the front reference.
        view: 'front',
        layout: 'centered',
        crop: 'full-body',
        reframe: 'reinterpret',
      },
      elements: [],
      referenceSets: {},
      baseFrame: { source: 'auto', zoom: 1, panX: 0, panY: 0, rotation: 0, fit: 'cover' },
      guides: { grid: true, snap: true },
    },
  };

  const rendered = await render('#/shot/L1-01', project, {
    storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'composer' },
  });
  assert(rendered.html.includes('shot wants Rear'), 'the shot workspace should identify the rear-facing contextual view');
  assert(rendered.html.includes('Auto-selected from shot context: Rear'), 'the reference tray should explain the automatic angle choice');
  assert(!/Panel tool[\s\S]{0,220}shot wants Rear/.test(rendered.html), 'character-facing language should not force unrelated props to use the rear angle');
  assert(/Kai rear view[\s\S]{0,650}checked/.test(rendered.html), 'the approved rear reference should be selected as primary');

  const promptRefs = rendered.context.shotCreationPromptReferences(shot).filter((ref) => ref.entityId === 'KAI');
  assert(promptRefs.some((ref) => ref.angleTag === 'rear'), 'the generation package should contain the rear reference');
  assert(!promptRefs.some((ref) => ref.angleTag === 'front' || /primary approved authority/i.test(ref.label || '')), 'the front authority should not be sent as an automatic supporting reference for a rear shot');

  console.log('Reference angle routing suite passed contextual rear inference, circular scoring, opposite-angle exclusion, UI labeling, and prompt-package selection.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const RELEASE_VERSION = require("../package.json").version;


const creation = read('public/creation-studio.js');
const provenance = read('public/review-provenance.js');
const entities = read('public/entities.js');
const library = read('public/library-tools.js');
const styles = read('public/styles.css');

assert(creation.includes('FIX CONTINUITY'), 'failed frame sequence review must expose a primary correction action');
assert(creation.includes('prepareFrameSequenceCorrectionUpload'), 'failed frame sequence review must support corrected-frame upload');
assert(creation.includes('chooseFrameSequenceCorrectionCandidate'), 'failed frame sequence review must support choosing an alternate candidate');
assert(creation.includes('frameSequenceCorrection?.autoReviewOnApproval'), 'replacement approval must be able to trigger sequence re-review');

assert(provenance.includes('window.openFrameSequenceCorrection'), 'guided sequence correction modal must exist');
assert(provenance.includes('FRAME-SEQUENCE CONTINUITY CORRECTION'), 'sequence correction must build a dedicated correction prompt');
assert(provenance.includes('#image1 is the editable approved target frame'), 'correction target must remain the editable base');
assert(provenance.includes('#image2 is the structural continuity authority'), 'anchor frame must be explicit structural authority');
assert(provenance.includes('MARK DIFFERENCE INTENTIONAL'), 'intentional differences must be added to the written progression rather than silently bypassed');
assert(provenance.includes('registerCandidateCorrectionBuild'), 'sequence corrections must enter immutable prompt provenance');

assert(entities.includes('PARENT-TO-STATE VALIDATION'), 'derived states must expose parent validation');
assert(entities.includes('validateContinuityStateAgainstParent'), 'derived states must be reviewable against their parent');
assert(entities.includes('CORRECT FROM PARENT'), 'failed derived states must provide a parent-first correction path');
assert(entities.includes('ACCEPT DIFFERENCE AS INTENTIONAL'), 'derived state differences must be explicitly addable to canon');
assert(entities.includes('INTENTIONAL APPROVED DELTA'), 'accepted differences must modify the state delta before revalidation');
assert(entities.includes('/api/llm/review-entity-candidate'), 'state validation must use the strict authority reviewer');

/* The loop variable was renamed targetState -> childState when `targetState` became
   the outer name for the state being approved. The invariant is the same one and is
   still in library-tools.js: approving a new default authority clears every derived
   child's parentValidation, so a stale answer about the previous parent image cannot
   survive the replacement. */
assert(library.includes('childState.parentValidation = null'), 'replacing a state authority must invalidate stale validation');
assert(library.includes('validateContinuityStateAgainstParent'), 'approved derived states should schedule validation when vision is ready');

assert(styles.includes('.frame-sequence-correction-modal'), 'sequence correction UI must be styled');
assert(styles.includes('.state-parent-validation'), 'parent validation UI must be styled');
assert(styles.includes('@media(max-width:760px)'), 'new correction UI must include mobile behavior');

console.log('repair.13 continuity correction workflow suite passed frame-pair correction, immutable correction provenance, parent-state validation, explicit canon expansion, invalidation, and responsive styling.');

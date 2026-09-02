const fs = require('fs');
const path = require('path');
const assert = require('assert');
const RELEASE_VERSION = require("../package.json").version;
const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const index = read('public/index.html');
const entities = read('public/entities.js');
const creation = read('public/creation-studio.js');
const review = read('public/review.js');
const focused = read('public/focused-workspaces.js');
const activity = read('public/live-activity.js');
const app = read('public/app.js');
const css = read('public/styles.css');
const coverage = read('public/coverage-automation.js');
const libraryTools = read('public/library-tools.js');

assert(index.includes(`focused-workspaces.js?v=${RELEASE_VERSION}`));
/* AMENDED BY BATCH 2 SLICE 3. The workspace is still rendered on the entity page
   and that is still what this line guards; it now receives the candidate markup
   as well, because candidate review moved out of a peer stage and into the
   reference that owns it. Asserting the argument is the point: a call that
   dropped it would render a reference with no candidates and no error. */
assert(/referenceWorkspaceMarkup\(list,\s*it\s*,\s*\{/.test(entities), 'manual-first reference workspace must be rendered on the entity page');
assert(/referenceWorkspaceMarkup\(list,\s*it\s*,\s*\{[^}]*candidatesMarkup:candidatesTask/.test(entities), 'the reference workspace must own the candidate grid rather than a peer stage');
assert(entities.includes('reference-manual-hub') && entities.includes('reference-assisted-tools'), 'manual intake must lead while assisted creation remains available');
assert(entities.includes('Generate angle / viewpoint coverage') && entities.includes('Generate expression sheet') && entities.includes('Map imported references'), 'reference workspace must expose manual mapping and optional assisted workflows');
assert(creation.includes('OUTPUT TYPE — LOCKED'));
assert(creation.includes('enforceLockedAssetSheetPrompt'));
assert(creation.includes('The assistant dropped the locked sheet structure; CineBraid restored it automatically.'), 'sheet structure must survive prompt improvement');
assert(review.indexOf('await route();') < review.indexOf('if (current.continueAction && data.review?.pass)'), 'AI review completion must rerender candidate thumbnails before review-to-approval continuation');
assert(review.indexOf('await route();') < review.indexOf('openModal(entityReviewModalMarkup(current.list, entity, media, state, row.structuredReviews[state.id]))'), 'AI review completion must rerender before reopening a non-continuing review');
assert(focused.includes('!root.querySelector(".focused-entity-shell")'), 'focused entity enhancement must recover after route rerenders');
assert(focused.includes('ensureDisclosureLabels(root)'), 'all disclosures must receive readable labels');
assert(focused.includes('aria-pressed'), 'coverage slot rail must expose selection state');
assert(css.includes('.coverage-slot-card[hidden]'), 'hidden coverage cards must stay hidden under author CSS');
assert(css.includes('.reference-creation-hub'));
/* MIGRATED — the Activity drawer is retired, and this asserted its backdrop existed.
   The invariant underneath it was never about the backdrop: it was the overlay ladder,
   built after a confirmation raised from the activity surface painted UNDERNEATH that
   surface. The activity surface is now the Terminal in the dock, so the same rule is
   read against the numbers that are actually in force. */
{
  /* Read DECLARATIONS, not prose. This stylesheet explains its own history at length —
     including why these two rungs were removed — and a check that searched the raw text
     would be answered by the explanation instead of by the CSS. */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!rules.includes('.automation-activity-backdrop'),
    'the retired Activity drawer must leave no backdrop styling behind');
  assert(!rules.includes('--z-activity-drawer') && !rules.includes('--z-activity-backdrop'),
    'the retired drawer must leave no rungs on the overlay ladder');
  const rung = (name) => {
    const match = rules.match(new RegExp(`${name}:\\s*(\\d+)`));
    return match ? Number(match[1]) : null;
  };
  const dock = rules.match(/#cb-shell-dock\{[^}]*z-index:\s*(\d+)/);
  assert(rung('--z-dialog') !== null && dock,
    'the dialog rung and the dock level must both be declared');
  assert(rung('--z-dialog') > Number(dock[1]),
    `a confirmation (${rung('--z-dialog')}) must still paint above the Activity Terminal (${dock[1]})`);
  assert(rung('--z-side-drawer') !== null,
    'the shot-detail .drawer keeps its rung; it is a different panel from the retired Activity drawer');
}
/* The floating global live strip was retired in Batch 2, Slice 1 — the topbar chip is
   the single persistent global activity indicator now. */
assert(!css.includes('#automation-global-live-strip'), 'the retired global live strip must leave no styling behind');
assert(activity.includes('Activity · Idle'));
assert(!activity.includes('backdrop.onclick = () => closeGlobalAutomationActivity()'),
  'the retired activity overlay must leave no backdrop behind');
assert(!activity.includes('V641_ACTIVITY_TRIGGER'),
  'a docked Terminal never takes focus away, so it must keep no focus-return trigger');
assert(!activity.includes('automation-activity-drawer'),
  'the retired Global Activity drawer must leave no renderer behind');
assert(app.includes('normalizedCoverageAlias'));
assert(app.includes('Imported view detail:'), 'descriptive imported coverage requirements must become slot notes rather than duplicate required slots');

assert(entities.includes('Generate continuity-state variant'), 'optional assisted tools must expose alternate costume/state generation');
assert(entities.includes('GENERATE FROM ${esc(parentInfo.label.toUpperCase())}'), 'empty state cards must expose parent-derived generation');
assert(entities.includes('UPLOAD STATE REFERENCE'), 'empty state cards must expose targeted state upload');
assert(entities.includes('openContinuityStateVariantHub'), 'state variant chooser must be available from the creation hub');
assert(coverage.includes('No automatic guess'), 'character primary references must require explicit angle assignment');
/* The legacy silent angle is still detected on load — that has not changed —
   but it is now reported rather than cleared. Withdrawing an approval the
   filmmaker had never revisited was a destructive migration performed during a
   read, and P-1 ended it; the correction belongs to an explicit migration.
   See tests/intent-loss-safety.js. */
assert(app.includes('wasSilentCharacterSeed'), 'legacy silent angle assignments must still be detected when a project is opened');
assert(app.includes('not chosen. The selection is kept as stored'), 'a detected legacy silent angle must be reported to the filmmaker');
const seedBranch = app.slice(app.indexOf('const wasSilentCharacterSeed'), app.indexOf('return next;'));
assert(seedBranch && !/approvedFile\s*=\s*""/.test(seedBranch), 'opening a project must not clear a legacy silent angle assignment');
assert(!libraryTools.includes('characters: "front-three-quarter"'), 'primary approval must not silently seed character 3/4 coverage');


console.log('Reference workspace UX suite passed manual-first reference intake, optional assisted tools, explicit primary angle assignment, alternate state generation, locked sheet prompts, immediate review refresh, stable focused rerenders, named disclosures, activity accessibility, and coverage normalization.');

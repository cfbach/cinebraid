/* Negative controls for tests/stage-surfaces.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces one specific way the persistent stage strip or its actions could be
 * wrong — IN MEMORY, by mutating a copy of the shipped source, so nothing on disk is
 * touched and no control can be "restored" by a checkout that also discards real work.
 *
 * Each control carries a PROBE RECEIPT: the mutation asserts the text it is replacing was
 * really present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing. That is the specific mistake
 * Production-State Honesty exposed — controls that had drifted onto a dead path and were
 * proving that a line nobody executed could be broken.
 *
 * EVERY CONTROL BREAKS A DIFFERENT MECHANISM, and names the check that has to fail. A
 * control that fires for the same reason as its neighbour is proving one thing twice and
 * nothing once.
 *
 * WHAT IS NOT HERE. Node identity across the five stage transitions, real stage selection
 * through the shipped path, the sticky offsets and the absence of horizontal overflow are
 * properties of a live document; their controls live in
 * tests/stage-surfaces-real-browser.py, which rebuilds the bar per stage, renders a second
 * navigator and re-enables a disabled action inside a running Chromium and requires all
 * three to be caught.
 *
 * NO PROJECT DATA IS TOUCHED, NO PAID CALL AND NO PROVIDER CALL.
 */

const assert = require("assert");
const fs = require("fs");

const suite = require("./stage-surfaces.js");
const { SOURCES } = suite;
const { releaseIdentity } = require("../release-identity.js");

/* THE ASSET STAMP IS DERIVED, NEVER TYPED. index.html's cache-busting stamps are
   re-written from package.json by scripts/sync-version.js on every release, so a
   control that anchors on the literal `?v=<version>` stops matching the moment the
   version moves — and because the probe receipt below is an assertion, that control
   does not merely go quiet, it ABORTS the file before the controls after it run.
   That is exactly what happened between 6.7.0-private.1 and 6.7.0-dev.1 (commit
   407ee0a): C31 threw, and C32/C33/C34 never executed, while `check:ci` stayed green
   because this suite is not in that chain.

   release-identity.js is the same single source tests/version-consistency.js and
   tests/public-exposure.js already derive from, so this control now follows the
   version by construction. The receipt keeps its real job — catching a rename or a
   refactor of the script tag itself — and loses only the brittleness that had
   nothing to do with what C31 controls. */
const ASSET_STAMP = releaseIdentity().version;

const notes = [];
const note = (line) => notes.push(line);

/* A mutation that must find what it is replacing. */
function mutate(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

const EXERCISED = new Set();
let CONTROL_COUNT = 0;

/* Runs one named check against a mutated source record and requires it to fail.
   A control that passes is a control that has stopped controlling anything. */
function control(label, checkName, patch, expectation) {
  CONTROL_COUNT += 1;
  EXERCISED.add(checkName);
  assert.strictEqual(typeof suite[checkName], "function",
    `${label} names ${checkName}, which tests/stage-surfaces.js does not export`);
  const sources = { ...SOURCES, ...patch };
  let failed = false;
  try {
    suite[checkName](sources);
  } catch (error) {
    if (error instanceof assert.AssertionError) failed = true;
    else throw error;
  }
  assert.ok(failed, `${label}: ${checkName} accepted the broken surface. ${expectation}`);
  note(`  ${label} — ${checkName} failed as required`);
}

/* ===========================================================================
   THE ACTION CONTRACT — where a persistent button could come to offer work the
   declaration says cannot be done. This is the section the whole batch rests on.
   =========================================================================== */

function contractControls() {
  note("The action contract:");

  control("C1 availability is re-derived instead of copied", "checkActionContract",
    { contract: mutate(SOURCES.contract,
        "        availability: state.availability,\n        disabledReason: state.blockedReason,\n        emphasis: \"primary\",",
        "        availability: \"available\",\n        disabledReason: state.blockedReason,\n        emphasis: \"primary\",",
        "C1") },
    "A persistent primary that decides its own availability will eventually offer motion on a shot with no approved frames — the exact thing the declaration exists to answer once.");

  control("C2 an empty recommendation becomes the next declared stage", "checkRecommendationSafety",
    { contract: mutate(SOURCES.contract,
        "    const next = actionText(state.recommendedNext);",
        "    const next = actionText(state.recommendedNext) || (stageDeclaration(stageId)?.next || [])[0] || \"\";",
        "C2") },
    "recommendedNext === '' is the model saying it does not know. Falling through to the first declared successor is a guess wearing a recommendation's clothes, and principle 9 forbids it.");

  control("C3 an action's existence depends on a frame count", "checkRecommendationSafety",
    { contract: mutate(SOURCES.contract,
        "    if (next && stageDeclaration(next)) {",
        "    if (next && stageDeclaration(next) && !(state.note && state.note.count >= 2)) {",
        "C3") },
    "Two approved frames are a fact about frames. Letting a count change which actions exist is how CineBraid would start implying a first/last-frame route nobody chose.");

  control("C4 the panel comes from a local map", "checkDeclarationOwnership",
    { contract: mutate(SOURCES.contract,
        "    return stageDeclaration(stageId)?.panels?.[0] || \"\";",
        "    return ({ inputs: \"inputs\", look: \"blocking\", frames: \"still\", motion: \"motion\", deliver: \"finish\" })[stageId] || \"\";",
        "C4") },
    "A stage-to-panel map here is the sixth statement of the stage list O1 was written to delete, and it drifts the first time a workspace moves.");

  control("C5 a paid candidate is rendered rather than dropped", "checkRefusals",
    { contract: mutate(SOURCES.contract,
        "    if (candidate.paid === true || candidate.destructive === true) return null;",
        "    ",
        "C5") },
    "Making actions persistent makes them easier to hit. A paid action that merely LOOKS different is one a filmmaker can still hit by accident from anywhere in the shot.");

  control("C6 a blocked action with no reason is rendered mute", "checkRefusals",
    { contract: mutate(SOURCES.contract,
        "    if (availability === \"blocked\" && !disabledReason) return null;",
        "    ",
        "C6") },
    "An unavailable control with no explanation is worse than no control: it tells the filmmaker they are stuck without telling them what would unstick them.");

  control("C7 the bar grows a third action", "checkActionContract",
    { contract: mutate(SOURCES.contract,
        "    return deepFreeze(candidates.map(acceptAction).filter(Boolean));",
        "    candidates.push({ id: \"extra\", stageId, label: \"More\", availability: state.availability, disabledReason: state.blockedReason, emphasis: \"primary\", advances: false, invoke: { kind: \"open-panel\", shotId: id, panel } });\n    return deepFreeze(candidates.map(acceptAction).filter(Boolean));",
        "C7") },
    "A persistent bar with no bound becomes the junk drawer every action in the app eventually gets moved into, and then nothing on it is primary.");

  control("C8 the action list stops being frozen", "checkActionContract",
    { contract: mutate(SOURCES.contract,
        "    return deepFreeze(candidates.map(acceptAction).filter(Boolean));",
        "    return candidates.map(acceptAction).filter(Boolean);",
        "C8") },
    "A caller that can mutate the returned actions is a caller that can edit the contract from outside it, which is how a rendering becomes production state.");

  control("C9 a declared limitation is hollowed out", "checkActionContract",
    { contract: mutate(SOURCES.contract,
        "      why: \"Every generation CineBraid can dispatch is paid,",
        "      why: \"n/a\", ignored: \"Every generation CineBraid can dispatch is paid,",
        "C9") },
    "A limitation with no reason is an entry somebody can delete without noticing they are also deleting the argument for it.");

  control("C10 the contract declares a kind nothing dispatches", "checkRefusals",
    { contract: mutate(SOURCES.contract,
        "  const STAGE_ACTION_INVOKE_KINDS = deepFreeze([\"open-panel\", \"select-stage\"]);",
        "  const STAGE_ACTION_INVOKE_KINDS = deepFreeze([\"open-panel\", \"select-stage\", \"run-generation\"]);",
        "C10") },
    "The invocation kinds are the whole list of things a persistent button can do. A kind declared here and dispatched nowhere is a promise no button can keep — and the next edit makes it keepable.");
}

/* ===========================================================================
   THE STRIP — where the declaration could stop being what is painted.
   =========================================================================== */

function stripControls() {
  note("The strip:");

  control("C11 the strip sorts the stages it was handed", "checkDeclarationOwnership",
    { surfaces: mutate(SOURCES.surfaces,
        "      + model.states.map((state) => stageButton(model, state)).join(\"\")",
        "      + [...model.states].sort((a, b) => a.label.localeCompare(b.label)).map((state) => stageButton(model, state)).join(\"\")",
        "C11") },
    "Order is a declared integer on each stage. A strip that re-sorts has an order of its own, and alphabetical is exactly the plausible-looking one somebody would reach for.");

  control("C12 a second navigator is rendered beside the first", "checkSingleNavigator",
    { surfaces: mutate(SOURCES.surfaces,
        "  function barMarkup(model) {\n    return `<div class=\"cb-stage-bar\"",
        "  function barMarkup(model) {\n    return `${stripMarkup(model)}` + `<div class=\"cb-stage-bar\"",
        "C12") },
    "Two stage bars can disagree, and the filmmaker has no way to tell which one is lying. The brief names this failure first.");

  control("C13 the current stage is marked by colour alone", "checkStagePresentation",
    { surfaces: mutate(SOURCES.surfaces,
        "${selected ? ' aria-current=\"step\"' : \"\"}",
        "",
        "C13") },
    "A selection expressed only as a CSS class is a selection no assistive technology can read, and 'where am I' is the first question the strip exists to answer.");

  control("C14 availability is painted from the tone", "checkStagePresentation",
    { surfaces: mutate(SOURCES.surfaces,
        "data-availability=\"${attr(state.availability)}\"",
        "data-availability=\"${attr(state.tone === \"optional\" ? \"available\" : state.availability)}\"",
        "C14") },
    "The shipped tone for a blocked stage is `optional` — the one word the declaration is explicit it cannot honestly say. Painting from the tone is how blocked comes to read as 'not needed yet' again.");

  control("C15 completion is painted from the tone", "checkStagePresentation",
    { surfaces: mutate(SOURCES.surfaces,
        "data-completion=\"${attr(state.completion)}\"",
        "data-completion=\"${attr(state.tone === \"complete\" ? \"complete\" : \"not-started\")}\"",
        "C15") },
    "Tone is a presentation projection of completion, not a replacement for it: `in-progress` and `needs-review` both collapse into it and would stop being distinguishable.");

  control("C16 the strip stops emitting the shipped selectors", "checkSingleNavigator",
    { surfaces: mutate(SOURCES.surfaces,
        "`<nav class=\"focused-taskbar bounded-shot-taskbar cb-stage-strip\"",
        "`<nav class=\"cb-stage-strip\"",
        "C16") },
    "Nine shipped browser suites drive the shot workspace by clicking these classes. Renaming them silently turns those suites into tests of a workspace nobody can navigate.");
}

/* ===========================================================================
   THE ACTIONS AS RENDERED — where "disabled" could become decorative.
   =========================================================================== */

function actionRenderControls() {
  note("The rendered actions:");

  control("C17 a disabled action is only styled as disabled", "checkDisabledAndAccess",
    { surfaces: mutate(SOURCES.surfaces,
        "`${reasonId ? ` disabled aria-describedby=\"${attr(reasonId)}\"` : \"\"}`",
        "`${reasonId ? ` data-looks-disabled=\"1\" aria-describedby=\"${attr(reasonId)}\"` : \"\"}`",
        "C17") },
    "A button that only looks unavailable is one the keyboard still reaches and one click still fires — and a persistent bar is precisely where an accidental click lands.");

  control("C18 the reason becomes a tooltip", "checkDisabledAndAccess",
    { surfaces: mutate(SOURCES.surfaces,
        "`<p class=\"cb-stage-action-reason\" id=\"${attr(id)}\">${esc(reason)}</p>`).join(\"\")",
        "`<span class=\"cb-stage-action-reason\" id=\"${attr(id)}\" title=\"${attr(reason)}\"></span>`).join(\"\")",
        "C18") },
    "A reason only a pointer can reveal is a reason a keyboard user and a screen-reader user do not have. The brief asks for it to reach both.");

  control("C19 two blocked actions print the reason twice", "checkDisabledAndAccess",
    { surfaces: mutate(SOURCES.surfaces,
        "      if (action.availability !== \"blocked\" || reasonIds.has(action.disabledReason)) continue;\n      reasonIds.set(action.disabledReason, `cb-stage-reason-${reasonIds.size}`);",
        "      if (action.availability !== \"blocked\") continue;\n      reasonIds.set(action.disabledReason + action.id, `cb-stage-reason-${reasonIds.size}`);",
        "C19") },
    "One prerequisite printed twice reads as two prerequisites, and the filmmaker goes looking for the second one.");

  control("C20 the action surface loses its accessible name", "checkDisabledAndAccess",
    { surfaces: mutate(SOURCES.surfaces,
        " aria-label=\"${attr(`${model.current.label} actions`)}\" role=\"group\">",
        ">",
        "C20") },
    "An unlabelled cluster of buttons in a persistent landmark is announced as a cluster of buttons, with nothing saying what they act on.");
}

/* ===========================================================================
   THE RUNTIME'S OWN REFUSALS AND ITS LIFECYCLE.
   =========================================================================== */

function runtimeControls() {
  note("The runtime:");

  control("C21 the runtime adds a clock of its own", "checkRefusals",
    { surfaces: mutate(SOURCES.surfaces,
        "  window.addEventListener(\"hashchange\", paint);",
        "  setInterval(paint, 3500);\n  window.addEventListener(\"hashchange\", paint);",
        "C21") },
    "Activity is already polled once. A second clock over the same data is exactly how CineBraid came to report two active operations while both had stopped.");

  control("C22 the runtime gains a third dispatch", "checkRefusals",
    { surfaces: mutate(SOURCES.surfaces,
        "    if (target.kind === \"select-stage\" && typeof window.selectBoundedTask === \"function\") {",
        "    if (target.kind === \"approve\" && typeof window.confirmApproveTake === \"function\") { window.confirmApproveTake(); return true; }\n    if (target.kind === \"select-stage\" && typeof window.selectBoundedTask === \"function\") {",
        "C22") },
    "Approval establishes canon and is performed on one named candidate. A persistent surface holds no candidate, so an approve dispatch here can only approve something the filmmaker did not choose.");

  control("C23 the runtime builds its own region", "checkShellIntegration",
    { surfaces: mutate(SOURCES.surfaces,
        "      BAR_NODE = document.createElement(\"div\");",
        "      BAR_NODE = document.createElement(\"section\");",
        "C23") },
    "A region JavaScript creates is a region JavaScript can create twice, and 'the bar is the same node after a stage change' then depends on every future caller remembering to check.");

  control("C24 the runtime stops repainting on activity", "checkLifecycle",
    { surfaces: mutate(SOURCES.surfaces,
        "  window.addEventListener(\"cinebraid:activity-updated\", paint);",
        "  ",
        "C24") },
    "The declared model mirrors a run's status onto the stage it is working on, so the moment activity changes is the moment a stage's tone is wrong and nothing would repaint it.");

  control("C25 the runtime loses its resize reveal", "checkLifecycle",
    { surfaces: mutate(SOURCES.surfaces,
        "  window.addEventListener(\"resize\", revealCurrentStage);",
        "  ",
        "C25") },
    "Measured in Chromium at 390px: after a resize the current stage sat off the right-hand edge of the scrolling strip with no event that would have brought it back.");

  control("C26 the runtime asks nobody whether the workspace exists", "checkLifecycle",
    { surfaces: mutate(SOURCES.surfaces,
        "    const shell = typeof creatorShellState === \"function\"\n      ? creatorShellState({ view, hasProject: !!project })\n      : { present: false, reason: \"no-declaration\" };",
        "    const shell = { present: !!project, reason: \"\" };",
        "C26") },
    "A third opinion about where the creator workspace exists is how three surfaces come to disagree about whether they are on one.");
}

/* ===========================================================================
   THE OTHER FILES O4 DEPENDS ON — the shell declaration, the shipped workspace,
   the markup and the stylesheet.
   =========================================================================== */

function integrationControls() {
  note("The rest of the app:");

  control("C27 the shot workspace builds a taskbar again", "checkSingleNavigator",
    { studio: mutate(SOURCES.studio,
        "  const selectedMarkup = (renderers[selectedTask] || renderers.frames)();",
        "  const legacyBar = `<nav class=\"focused-taskbar\"></nav>`;\n  const selectedMarkup = legacyBar && (renderers[selectedTask] || renderers.frames)();",
        "C27") },
    "The old navigator coming back is not hypothetical: it is one line, in a file that already knows every stage, and it would be destroyed and rebuilt on every stage change while the real one sat above it.");

  control("C28 the bar slot stops collapsing when empty", "checkShellIntegration",
    { shell: mutate(SOURCES.shell,
        "      name: \"bar\",\n      element: \"cb-shell-bar\",\n      owner: \"the persistent workflow navigator and its stage actions\",\n      purpose: \"Persistent horizontal slot between the topbar and the current production task.\",\n      mountable: true,\n      collapsesWhenEmpty: true,",
        "      name: \"bar\",\n      element: \"cb-shell-bar\",\n      owner: \"the persistent workflow navigator and its stage actions\",\n      purpose: \"Persistent horizontal slot between the topbar and the current production task.\",\n      mountable: true,\n      collapsesWhenEmpty: false,",
        "C28") },
    "The bar is honest on one route out of sixteen. A bar that did not collapse would put an empty band under the topbar of Reports, the reference library and every entity page.");

  control("C29 the bar claims vertical scrolling", "checkShellIntegration",
    { shell: mutate(SOURCES.shell,
        "      scroll: \"self-horizontal\",",
        "      scroll: \"self\",",
        "C29") },
    "A bar that owned vertical scrolling would be a bar that could grow, and it sits directly above the workspace it would grow into.");

  control("C30 the bar region is built by JavaScript instead of shipped", "checkShellIntegration",
    { markup: mutate(SOURCES.markup,
        "    <div id=\"cb-shell-bar\" class=\"cb-shell-slot\" data-shell-slot=\"bar\" aria-label=\"Shot workflow\"><div class=\"cb-shell-slot-body\"></div></div>\n",
        "",
        "C30") },
    "The other three regions are static markup precisely so single-instance and cross-render identity are true by construction rather than by convention.");

  control("C31 the contract loads after the runtime that reads it", "checkShellIntegration",
    { markup: mutate(SOURCES.markup,
        `<script src="shared-stage-actions.js?v=${ASSET_STAMP}"></script>\n`,
        "",
        "C31") },
    "A runtime whose contract has not loaded renders no actions at all, silently, on the very first paint of every cold start.");

  control("C32 the rail stops offsetting by the bar", "checkShellIntegration",
    { styles: mutate(SOURCES.styles,
        "#cb-shell-rail{position:sticky;top:calc(var(--cb-topbar-stop) + var(--cb-bar-height,0px));",
        "#cb-shell-rail{position:sticky;top:calc(var(--cb-topbar-stop));",
        "C32") },
    "The bar is sticky and paints above the rail. Without the offset the rail's first ~80px sits permanently behind the strip, which is where the Assistant's headline is.");

  control("C33 the blocked treatment is keyed off the tone", "checkStagePresentation",
    { styles: mutate(SOURCES.styles,
        ".cb-stage-strip .focused-task-button[data-availability=\"blocked\"]{opacity:.76}",
        ".cb-stage-strip .focused-task-button.tone-optional{opacity:.76}",
        "C33") },
    "Keying the blocked look off `tone-optional` reintroduces the claim the declaration refuses to make: that CineBraid can tell a stage this shot will never need from one it has not reached.");

  control("C34 the bar's offset becomes a literal", "checkShellIntegration",
    { styles: mutate(SOURCES.styles,
        "#cb-shell-bar{position:sticky;top:var(--cb-topbar-stop,64px);",
        "#cb-shell-bar{position:sticky;top:64px;",
        "C34") },
    "64px was the number O2 used against a topbar that is 72px. A literal here puts the top of the strip behind the topbar at every width above 980 and disagrees with the rail by 8px.");
  /* THE GLYPH CONTROLS BUILD THEIR CHARACTERS FROM CODEPOINTS. A control that typed
     the mangled byte would put an invisible control character into this suite's own
     source, which is the condition checkStageActionGlyph exists to be sure about. */
  const ARROW = String.fromCodePoint(0x2192);
  const FOLD_MARKER = String.fromCodePoint(0x25b8);
  const MANGLED_ESCAPE = String.fromCharCode(0x11) + "92";

  control("C35 the travel suffix goes back to the mangled escape", "checkStageActionGlyph",
    { styles: mutate(SOURCES.styles,
        `.cb-stage-action[data-action-id="open-stage-work"]::after{content:" ${ARROW}";margin-left:2px}`,
        `.cb-stage-action[data-action-id="open-stage-work"]::after{content:" ${MANGLED_ESCAPE}";margin-left:2px}`,
        "C35") },
    "This is the shipped defect exactly: a repeated, prominent navigation control ending in a control-character box and the digits 92, which a filmmaker reads as breakage or as an unexplained count.");

  control("C36 a mangled escape lands in some other content", "checkStageActionGlyph",
    { styles: mutate(SOURCES.styles,
        `.fold>summary::before{content:"${FOLD_MARKER}"`,
        `.fold>summary::before{content:"${MANGLED_ESCAPE}"`,
        "C36") },
    "The suffix was one instance of a class. A check that only knew about `open-stage-work` would let the identical substitution reach any other pseudo-element in the stylesheet unseen.");

  control("C37 the suffix rule starts resizing the button", "checkStageActionGlyph",
    { styles: mutate(SOURCES.styles,
        `.cb-stage-action[data-action-id="open-stage-work"]::after{content:" ${ARROW}";margin-left:2px}`,
        `.cb-stage-action[data-action-id="open-stage-work"]::after{content:" ${ARROW}";margin-left:2px;font-size:16px}`,
        "C37") },
    "A glyph repair may not change the control it decorates. Anything beyond the content and its gap is a dimension change smuggled in behind a typographical fix.");

}

/* ===========================================================================
   RUN
   =========================================================================== */

/* THE STALE-LITERAL GUARD, and why it is two assertions rather than one.

   The first proves the derivation is LIVE: a stamp that no longer occurs in the
   shipped markup means sync-version.js and this file have diverged, and it says so
   in those terms instead of surfacing as an unexplained probe-receipt miss.

   The second proves the CLASS cannot come back: any future control that types a
   version into an asset stamp is caught here, in this file, at the moment it is
   written — rather than at the next release, silently, by aborting the run. The
   pattern deliberately matches `?v=` followed by a DIGIT, so the derived
   `?v=${ASSET_STAMP}` form above is not itself a hit. */
function assetStampGuard() {
  note("The asset stamp:");

  assert.ok(SOURCES.markup.includes(`?v=${ASSET_STAMP}`),
    `the derived asset stamp ?v=${ASSET_STAMP} does not occur in public/index.html. `
    + "release-identity.js and the shipped cache-busting stamps have diverged; "
    + "run `npm run sync:version` and re-check tests/version-consistency.js.");
  note(`  the derived stamp ?v=${ASSET_STAMP} is present in the shipped markup`);

  const self = fs.readFileSync(__filename, "utf8");
  const typed = self.match(/\?v=\d[^"'\s`]*/g) || [];
  assert.deepStrictEqual(typed, [],
    `these controls type a release version into an asset stamp instead of deriving it: ${typed.join(", ")}. `
    + "A typed stamp stops matching at the next version bump, and because the probe "
    + "receipt is an assertion it aborts this file rather than going quiet. Use ASSET_STAMP.");
  note("  no control types a release version into an asset stamp");
}

contractControls();
stripControls();
actionRenderControls();
runtimeControls();
integrationControls();
assetStampGuard();

for (const line of notes) console.log(line);

/* Every exported check must have been driven to failure by something. A check no control
   can break is a check that may not be able to fail at all. */
const exported = Object.keys(suite).filter((key) => /^check/.test(key));
const undriven = exported.filter((name) => !EXERCISED.has(name));
assert.deepStrictEqual(undriven, [],
  `these checks were never driven to failure and may be incapable of it: ${undriven.join(", ")}`);

console.log(`\n${CONTROL_COUNT} controls, all ${exported.length} exported checks driven to failure.`);
console.log("persistent stage strip and stage action negative controls passed");

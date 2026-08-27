/* The private-alpha production loop: reference -> still -> approval -> motion.
 *
 * Six small defects, each of which stopped a normal pass through that loop, and each
 * of which is a reader and a writer that stopped agreeing:
 *
 *   A  ADD MOTION went nowhere. The bounded shot workspace renders exactly one task,
 *      chosen from the focused-task state; openGuidedPanel() wrote the legacy
 *      `openPanels` map, which decides whether a panel is OPEN and not whether it is
 *      BUILT. The motion panel was never in the DOM, the scroll poll timed out, and
 *      the interface said "Could not find the motion workspace" about a workspace it
 *      had never asked for.
 *
 *   B  the DEFAULT video target could not be dispatched. seedance-2/i2v shipped as the
 *      new-project default with kling-3 and wan-2.7 behind it, and CineBraid owns no
 *      adapter for any of them.
 *
 *   C  and an unwired target said nothing. It was selectable, a prompt could be built
 *      for it, and the absence of a Generate button was the only signal.
 *
 *   D  a BATCH APPROVAL did not read as a human decision. The writer set its own
 *      `decision` vocabulary; the panel reads `humanApproved`, which nothing in that
 *      path wrote.
 *
 *   E  dismissing an alert promised the run "remains available in Reports", which
 *      retention does not guarantee.
 *
 *   F  provider-acceptance readers looked for `providerRequestId` and `requestId`. The
 *      ledger persists `externalId`, so the id check never fired.
 *
 * NO PAID PROVIDER CALL IS MADE. Nothing here reaches a network: the render harness
 * serves every route from fixtures, and the dispatch assertions read the declared
 * adapter inventory rather than exercising it.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");
const Options = require("../generation-options");
const Lifecycle = require("../generation-lifecycle");
const PromptEngine = require("../prompt-engine");
const { H3_MODEL_IDS } = require("../h3-execution");

const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const notes = [];
function note(line) { notes.push(line); }

/* Read from the declaration rather than restated here. This used to be a local literal
   copy of the five stage ids, which meant a stage added to the product and not to this
   file would have gone on passing while never being driven at all. */
const { SHOT_STAGE_IDS, SHOT_STAGE_SCOPE } = require("../public/shared-stage-model.js");
const SHOT_TASKS = [...SHOT_STAGE_IDS];
const focusKey = (shotId) => `cinebraid-focused:fixture:${SHOT_STAGE_SCOPE}:${shotId}`;
const taskOf = (html) => (String(html).match(/data-bounded-task="([^"]+)"/) || [])[1] || "";
const hasPanel = (html, key) => String(html).includes(`data-guided-panel="${key}"`);

/* ==========================================================================
   A — CROSS-PANEL NAVIGATION
   ========================================================================== */

/* Drives the real action on a real render and reports what the workspace actually
   shows afterwards. Deliberately not a source-order check: the defect was invisible in
   the source of openGuidedPanel() and only existed in what the page built.

   Exported so the negative controls can run the identical probe against a copy of the
   studio with the repair removed. */
async function crossPanelNavigation(fromTask, panelKey, mutateSource = null) {
  const fixture = buildFixture();
  const shot = fixture.shots[0];
  const rendered = await render(`#/shot/${shot.id}`, fixture, {
    storage: { [focusKey(shot.id)]: fromTask },
    ...(mutateSource ? { mutateSource } : {}),
  });
  /* The page's own P, read inside the context: `let P` in app.js is a lexical binding
     and never a property of the sandbox object, so reading context.P would be reading
     the fixture nobody rendered. */
  const before = {
    task: taskOf(rendered.html),
    panelBuilt: hasPanel(rendered.html, panelKey),
    ...vm.runInContext(`({ hash: location.hash, shotTitle: P.shots[0].title, projectTitle: P.meta.title, shotIds: P.shots.map((row) => row.id).join(",") })`, rendered.context),
  };
  const after = await vm.runInContext(`(async () => {
    const said = [];
    const original = window.toast;
    window.toast = (message) => { said.push(String(message)); };
    try {
      await openGuidedPanel(${JSON.stringify(shot.id)}, ${JSON.stringify(panelKey)});
    } finally { window.toast = original; }
    const html = document.getElementById("main").innerHTML;
    return {
      said,
      task: (html.match(/data-bounded-task="([^"]+)"/) || [])[1] || "",
      panelBuilt: html.includes('data-guided-panel="' + ${JSON.stringify(panelKey)} + '"'),
      stored: localStorage.getItem(${JSON.stringify(focusKey(shot.id))}),
      hash: location.hash,
      shotTitle: P.shots[0].title,
      projectTitle: P.meta.title,
      shotIds: P.shots.map((row) => row.id).join(","),
      crumbNamesShot: html.includes(${JSON.stringify(shot.id)}),
    };
  })()`, rendered.context);
  return { shotId: shot.id, panelKey, fromTask, before, after };
}

const PANEL_TASKS = { motion: "motion", finish: "deliver", inputs: "inputs", composer: "look" };

async function testAddMotionFromEveryTask(mutateSource = null) {
  for (const from of SHOT_TASKS.filter((task) => task !== "motion")) {
    const result = await crossPanelNavigation(from, "motion", mutateSource);
    assert.strictEqual(result.before.task, from, `the workspace must actually start on ${from}, or nothing is being proved`);
    assert.strictEqual(result.before.panelBuilt, false, `${from} must not already render the motion panel, or this case proves nothing`);
    assert.strictEqual(result.after.task, "motion", `Add motion from ${from} must select the motion task`);
    assert.strictEqual(result.after.panelBuilt, true, `Add motion from ${from} must actually build the motion workspace`);
    assert.strictEqual(result.after.said.join(" | "), "", `Add motion from ${from} must not refuse with a missing-workspace message`);
  }
  note(`A1: Add motion opens the motion workspace from ${SHOT_TASKS.filter((t) => t !== "motion").join(", ")} — no "could not find" refusal from any of them`);
}

async function testAddMotionFromMotionIsStable(mutateSource = null) {
  const result = await crossPanelNavigation("motion", "motion", mutateSource);
  assert.strictEqual(result.before.task, "motion", "the case must start on motion");
  assert.strictEqual(result.after.task, "motion", "Add motion while already on motion must stay on motion");
  assert.strictEqual(result.after.panelBuilt, true, "and the motion workspace must still be built");
  assert.strictEqual(result.after.said.join(" | "), "", "and it must not refuse");
  note("A2: Add motion while already on Motion is a no-op that keeps the workspace open");
}

/* The proof that this is not a Motion-only patch: the same helper carries three other
   panels to three other tasks. */
async function testOtherCrossPanelActions(mutateSource = null) {
  const cases = [
    { from: "frames", key: "finish", task: "deliver" },
    { from: "motion", key: "inputs", task: "inputs" },
    { from: "frames", key: "composer", task: "look" },
  ];
  for (const row of cases) {
    const result = await crossPanelNavigation(row.from, row.key, mutateSource);
    assert.strictEqual(result.before.panelBuilt, false, `${row.from} must not already render the ${row.key} panel`);
    assert.strictEqual(result.after.task, row.task, `openGuidedPanel(${row.key}) from ${row.from} must select ${row.task}`);
    assert.strictEqual(result.after.panelBuilt, true, `openGuidedPanel(${row.key}) from ${row.from} must build the ${row.key} panel`);
    assert.strictEqual(result.after.said.join(" | "), "", `openGuidedPanel(${row.key}) must not refuse`);
  }
  note("A3: finish -> Deliver, inputs -> Inputs and composer -> Look & blocking all navigate through the same helper");
}

async function testNavigationKeepsProjectAndShot() {
  for (const key of Object.keys(PANEL_TASKS)) {
    const result = await crossPanelNavigation("frames", key, null);
    assert.strictEqual(result.after.hash, result.before.hash, `${key}: the route must not move`);
    assert.strictEqual(result.after.shotTitle, result.before.shotTitle, `${key}: the open shot must not change`);
    assert.strictEqual(result.after.projectTitle, result.before.projectTitle, `${key}: the open project must not change`);
    assert.strictEqual(result.after.shotIds, result.before.shotIds, `${key}: no shot may appear or disappear`);
    assert.strictEqual(result.after.crumbNamesShot, true, `${key}: the workspace must still be the same shot's`);
    assert.strictEqual(result.after.stored, PANEL_TASKS[key], `${key}: exactly one task state is written, and it is the canonical one`);
  }
  note("A4: every cross-panel action leaves the route, the project and the open shot exactly where they were");
}

/* One task state, not two. The canonical writer lives in public/bounded-rendering.js;
   a second copy of that storage key anywhere else is the duplicate state this repair
   exists to avoid. */
function testOneTaskStateWriter() {
  const files = fs.readdirSync(path.join(ROOT, "public")).filter((name) => name.endsWith(".js"));
  const writers = files.filter((name) => /localStorage\.setItem\(\s*`cinebraid-focused:/.test(readLF(`public/${name}`)));
  assert.deepStrictEqual(writers, ["bounded-rendering.js"],
    `the focused-task key may only be written in one place; also written by: ${writers.join(", ")}`);
  const studio = readLF("public/creation-studio.js");
  assert(/function selectGuidedPanelTask\(/.test(studio), "the shared cross-panel selector must exist");
  /* The scope is now named by the declaration (SHOT_STAGE_SCOPE) rather than spelled
     out here, so this asserts the call goes through the canonical writer with the
     declared scope — tests/stage-model.js owns the value of that scope. */
  assert(/boundedWriteFocusedTask\(SHOT_STAGE_SCOPE, s\.id, taskId\)/.test(studio), "and must write through the canonical task-selection state");
  assert.strictEqual(SHOT_STAGE_SCOPE, "shot-task", "the declared scope must still be the key real installs carry");
  note("A: one writer for the focused-task key, and cross-panel navigation goes through it");
}

/* The refusal must be decided from state, not from whether a scroll target had
   appeared. A poll that loses a race is not evidence that a workspace is missing. */
function testRefusalIsNotADomRace() {
  const studio = readLF("public/creation-studio.js");
  const opener = studio.slice(studio.indexOf("window.openGuidedPanel"));
  const body = opener.slice(0, opener.indexOf("window.scrollGuidedFrame"));
  assert(/boundedShotSelectedTask\(s, takesFor\(s\.id\)\) !== task/.test(body),
    "the refusal must be decided from the selected task");
  assert(!/const found = await focusGuidedWorkspaceTarget/.test(body),
    "the scroll poll's result must no longer decide whether a workspace exists");
  note("A: the missing-workspace refusal reads the task state; the DOM poll only scrolls");
}

/* ==========================================================================
   B — THE DEFAULT VIDEO TARGET MUST BE DISPATCHABLE
   ========================================================================== */

const ANNOTATED = Options.annotateProfileLibraryExecution(PromptEngine.profileLibrary());
const videoProfiles = () => ANNOTATED.profiles.filter((profile) => profile.mediaType === "video");
const profileById = (id) => ANNOTATED.profiles.find((profile) => profile.id === id) || null;

/* The shipped defaults, read from the two places that declare them. */
function declaredVideoDefaults() {
  const grab = (file) => {
    const match = readLF(file).match(/promptDefaults[\s\S]{0,400}?videoProfile:\s*"([^"]+)"/);
    assert(match, `${file} must declare a default video profile`);
    return match[1];
  };
  return { "server.js": grab("server.js"), "public/app.js": grab("public/app.js") };
}

function testShippedDefaultIsDispatchable(overrides = null) {
  const defaults = overrides || declaredVideoDefaults();
  for (const [file, id] of Object.entries(defaults)) {
    const profile = profileById(id);
    assert(profile, `${file} names ${id}, which is not in the profile catalogue`);
    assert.strictEqual(profile.execution.dispatchable, true,
      `${file} ships ${id} as the default video target, and CineBraid cannot dispatch it`);
    assert.strictEqual(profile.mode, "i2v", `${file}: the default is the first motion pass, which animates an approved frame`);
  }
  assert.strictEqual(defaults["server.js"], defaults["public/app.js"],
    "the new-project default and the in-memory default must be the same target");
  note(`B1: the shipped default video target is ${defaults["server.js"]}, and it is dispatchable`);
  return defaults["server.js"];
}

async function testFreshProjectResolvesToADispatchableTarget(mutateSource = null) {
  const bare = buildFixture();
  delete bare.meta.promptDefaults;
  const stale = buildFixture();
  stale.meta.promptDefaults = { imageProfile: "gpt-image-2/t2i", videoProfile: "seedance-2/i2v" };
  for (const [label, fixture] of [["a project with no defaults at all", bare], ["a project still carrying the old seedance default", stale]]) {
    const rendered = await render(`#/shot/${fixture.shots[0].id}`, fixture, mutateSource ? { mutateSource } : {});
    const resolved = vm.runInContext(`(() => {
      const id = preferredGuidedVideoProfile("");
      const profile = guidedVideoProfiles().find((row) => row.id === id) || null;
      return { id, family: profile && profile.family, mode: profile && profile.mode, dispatchable: !!(profile && profile.execution && profile.execution.dispatchable) };
    })()`, rendered.context);
    assert.strictEqual(resolved.dispatchable, true, `${label}: the resolved default must be dispatchable`);
    assert.strictEqual(resolved.mode, "i2v", `${label}: a first motion pass animates the approved frame`);
  }
  note("B1: with no default and with a stale undispatchable default, the picker still opens on a target that can run");
}

/* The default reaches the wired route, stated through the inventory that owns the
   answer rather than by naming a family here. */
function testDefaultReachesTheWiredDispatchRoute(defaultId) {
  const profile = profileById(defaultId);
  const support = Options.profileExecutionSupport(profile);
  assert.strictEqual(support.dispatchable, true, "the default must resolve to an adapter");
  const adapter = Options.CINEBRAID_GENERATION_ADAPTERS.find((row) => row.adapterId === support.adapterId);
  assert(adapter, `the adapter ${support.adapterId} the default resolves to must exist in the shipped inventory`);
  assert.strictEqual(typeof adapter.serialize, "function", "and must carry a real serializer");
  assert(adapter.modes.includes(profile.mode), `and must cover ${profile.mode}`);
  assert.strictEqual(adapter.modelId, H3_MODEL_IDS[profile.mode],
    "and must be the same model id the H3 execution path compiles for");
  note(`B2: ${defaultId} resolves to ${support.adapterId} -> ${adapter.modelId}, the model h3-execution.js compiles for`);
}

async function testDefaultOffersTheGenerateAction(defaultId) {
  const fixture = buildFixture();
  const rendered = await render(`#/shot/${fixture.shots[0].id}`, fixture);
  const offered = vm.runInContext(`(() => {
    const profile = guidedVideoProfiles().find((row) => row.id === ${JSON.stringify(defaultId)});
    const ready = falGenerationReady;
    globalThis.falGenerationReady = () => true;
    try {
      return { action: falH3MotionPromptAction("L1-01", "build-1", profile), refusal: guidedVideoProfileRefusalMarkup(profile) };
    } finally { globalThis.falGenerationReady = ready; }
  })()`, rendered.context);
  assert(offered.action.includes("openFalH3MotionModal"), "the default target must offer the paid H3 generation dialog");
  assert.strictEqual(offered.refusal, "", "and must not carry an unsupported-target refusal");
  note("B2: with fal connected, the default target renders the H3 generation action and no refusal");
}

async function testExplicitSelectionIsPreserved(mutateSource = null) {
  const fixture = buildFixture();
  const rendered = await render(`#/shot/${fixture.shots[0].id}`, fixture, mutateSource ? { mutateSource } : {});
  const kept = vm.runInContext(`({
    wired: preferredGuidedVideoProfile("minimax-h3/flf"),
    unwired: preferredGuidedVideoProfile("seedance-2/i2v"),
    nonsense: preferredGuidedVideoProfile("not-a-profile/at-all"),
  })`, rendered.context);
  assert.strictEqual(kept.wired, "minimax-h3/flf", "a valid dispatchable selection is kept");
  assert.strictEqual(kept.unwired, "seedance-2/i2v",
    "a valid selection CineBraid cannot dispatch is ALSO kept — it is refused, never silently swapped");
  assert.notStrictEqual(kept.nonsense, "not-a-profile/at-all", "an id that is not a profile is not a selection");
  note("B3: an explicit valid selection survives, including one that will be refused; only a non-existent id falls back");
}

/* ==========================================================================
   C — AN UNWIRED TARGET EXPLAINS ITSELF
   ========================================================================== */

async function motionPickerMarkup(selectedId, mutateSource = null) {
  const fixture = buildFixture();
  const rendered = await render(`#/shot/${fixture.shots[0].id}`, fixture, mutateSource ? { mutateSource } : {});
  return vm.runInContext(`(() => {
    const profile = guidedVideoProfiles().find((row) => row.id === ${JSON.stringify(selectedId)});
    return {
      options: guidedVideoProfileOptions(${JSON.stringify(selectedId)}),
      refusal: guidedVideoProfileRefusalMarkup(profile),
      dispatchable: guidedVideoProfileDispatchable(profile),
      /* What the picker would open on with nothing chosen, from the same page state. */
      preferred: preferredGuidedVideoProfile(""),
      wiredCount: guidedVideoProfileCount(),
      total: guidedVideoProfiles().length,
      generateAction: (() => {
        const ready = falGenerationReady;
        globalThis.falGenerationReady = () => true;
        try { return falH3MotionPromptAction("L1-01", "build-1", profile); }
        finally { globalThis.falGenerationReady = ready; }
      })(),
    };
  })()`, rendered.context);
}

function optionFor(options, id) {
  const match = String(options).match(new RegExp(`<option value="${id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"[^>]*>[^<]*`));
  assert(match, `the picker must still list ${id}`);
  return match[0];
}

async function testUnsupportedTargetIsVisiblyUnavailable(mutateSource = null) {
  const picker = await motionPickerMarkup("minimax-h3/i2v", mutateSource);
  const dead = optionFor(picker.options, "seedance-2/i2v");
  assert(/\sdisabled/.test(dead), "an unwired target must not be selectable");
  assert(/not available in this build/.test(dead), "and must say so where it is listed");
  const wired = optionFor(picker.options, "minimax-h3/i2v");
  assert(!/\sdisabled/.test(wired), "a wired target must stay selectable");
  assert(picker.options.includes("Seedance 2"), "the catalogue stays visible rather than being hidden");
  assert(picker.wiredCount > 0 && picker.wiredCount < picker.total,
    "the count beside the picker must be the runnable targets, not the catalogue size");
  note(`C1: ${picker.wiredCount} of ${picker.total} video targets are selectable; the rest are listed, disabled and labelled`);
}

async function testRefusalCarriesReasonAndAlternative(mutateSource = null) {
  const picker = await motionPickerMarkup("seedance-2/i2v", mutateSource);
  assert.strictEqual(picker.dispatchable, false, "the case must actually be an unwired target");
  assert(picker.refusal, "an unwired selection must produce a stated refusal");
  assert(/cannot generate with/i.test(picker.refusal), "the refusal must say plainly that CineBraid cannot run it");
  assert(/no adapter for seedance-2 ships/i.test(picker.refusal), "and must give the specific reason");
  assert(/MiniMax H3 — Image to Video/.test(picker.refusal), "and must name a target that is wired for the same job");
  assert(/Working alternative/.test(picker.refusal), "and must label that alternative as the next action");
  assert(!/\d+\/100|score/i.test(picker.refusal), "the refusal is not a recommendation and carries no ranking");
  note("C2/C3: an unwired selection refuses in plain language, with the specific reason and a working alternative named");
}

async function testUnsupportedTargetCannotReachSubmission(mutateSource = null) {
  const picker = await motionPickerMarkup("seedance-2/i2v", mutateSource);
  assert.strictEqual(picker.generateAction, "",
    "an unwired target must offer no paid generation action even with fal connected");
  assert(picker.refusal.includes("data-video-profile-unsupported"),
    "and the reason must be on screen in its place rather than a silent absence");
  /* The boundary itself: no adapter in the shipped inventory can serialise any model
     of an unwired family, so nothing upstream can mint a dispatch for it. */
  for (const profile of videoProfiles().filter((row) => !row.execution.dispatchable)) {
    const support = Options.profileExecutionSupport(profile);
    assert.strictEqual(support.dispatchable, false, `${profile.id} must not resolve to an adapter`);
    assert.strictEqual(support.adapterId, "", `${profile.id} must name no adapter`);
  }
  const serverGuard = readLF("fal-generation.js");
  assert(/MiniMax H3 motion generation requires a minimax-h3 prompt profile/.test(serverGuard),
    "the server route must still refuse a motion job whose profile family is not the wired one");
  note("C4: no unwired target has an adapter, the screen offers no paid action for one, and the route still refuses it");
}

/* Every unwired target must explain itself — not only the ones this suite names. */
function testEveryUnwiredTargetHasAReason() {
  const dead = videoProfiles().filter((profile) => !profile.execution.dispatchable);
  assert(dead.length > 0, "the catalogue must still contain targets CineBraid cannot run, or this proves nothing");
  for (const profile of dead) {
    assert(profile.execution.reason, `${profile.id} must carry a reason`);
    assert(profile.execution.action, `${profile.id} must carry a next action`);
    assert(!/adapter|serialise|serialize|dispatch\b/i.test(profile.execution.action),
      `${profile.id}: the next action must be in production language`);
  }
  const withAlternative = dead.filter((profile) => profile.execution.alternatives.length);
  assert(withAlternative.length >= 4, "where a wired target does the same job, the refusal must name it");
  note(`C: all ${dead.length} unwired video targets carry a reason; ${withAlternative.length} of them name a working alternative`);
}

/* ==========================================================================
   D — A BATCH APPROVAL IS A HUMAN APPROVAL
   ========================================================================== */

/* Runs the shipped batch-approval confirmation over a shortlist of one, then reads the
   human-decision panel back. The modal's checkbox query is stubbed because the harness
   document has no selector engine; everything else — the writer, the row, the renderer
   — is the shipped code. */
async function batchApproval(kind, mutateSource = null) {
  const fixture = buildFixture();
  const character = fixture.characters[0];
  character.candidateFiles = [
    { stored: "KAI-BATCH.png", decision: "unreviewed", coverageJobType: "single-reference" },
  ];
  character.coverageSlots = [{ id: "front", label: "Front", required: true, approvedFile: "", notes: "" }];
  character.expressionSlots = [{ id: "smile", label: "Smile", required: true, approvedFile: "", notes: "" }];
  const rendered = await render("#/library", fixture, mutateSource ? { mutateSource } : {});
  /* The confirming click, delivered from Node the way a user agent delivers one.
     The batch writer commits its Canon synchronously inside it; everything after
     the first await is bookkeeping and correctly runs outside the window. */
  /* One confirming click, spanning the vm script the way a real one spans the
     handler it triggers. The batch writer commits its Canon synchronously inside
     it; everything after the first await is bookkeeping and correctly runs
     outside the window. */
  const endGesture = rendered.gesture.begin();
  const pending = vm.runInContext(`(async () => {
    const entity = P.characters[0];
    const kind = ${JSON.stringify(kind)};
    /* Slot ids are read back from the loaded entity: project normalization reconciles
       coverage and expression slots on load, so a hard-coded id would be a slot the
       shipped writer could never find. */
    const coverage = ensureCoverageSlots("characters", entity)[0];
    const expression = ensureExpressionSlots(entity).filter((slot) => !slot.retired)[0];
    const target = kind === "coverage"
      ? { targetKey: "coverage:" + coverage.id, targetLabel: coverage.label, type: "coverage", stateId: "", slotId: coverage.id, approvable: true }
      : kind === "expressions"
        ? { targetKey: "expressions:" + expression.id, targetLabel: expression.label, type: "expressions", stateId: "", slotId: expression.id, approvable: true }
        : { targetKey: "state:state-default", targetLabel: "Kai", type: "reference", stateId: "state-default", slotId: "", approvable: true };
    entity.candidateReviewBatches = [{
      id: "batch-1",
      results: [{
        fileName: "KAI-BATCH.png", status: "completed", pass: true, score: 91,
        contractVersion: ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
        ...target,
      }],
    }];
    window._entityBatchApproval = { list: "characters", id: entity.id, batchId: "batch-1" };
    /* Only the modal's own checkbox query is answered here — the harness document has
       no selector engine, and stubbing every selector would also answer route()'s
       navigation query with a checkbox. */
    const query = document.querySelectorAll;
    document.querySelectorAll = (selector) =>
      (String(selector).includes("data-batch-approval-index") ? [{ dataset: { batchApprovalIndex: "0" } }] : query.call(document, selector));
    const said = [];
    const original = window.toast;
    window.toast = (message) => { said.push(String(message)); };
    try {
      await confirmEntityBatchApproval();
    } finally {
      document.querySelectorAll = query;
      window.toast = original;
    }
    const row = (entity.candidateFiles || []).find((item) => (item.stored || item.name) === "KAI-BATCH.png") || null;
    const passingReview = { pass: true, score: 91 };
    return {
      said,
      decision: row && row.decision,
      humanApproved: row ? row.humanApproved === true : false,
      humanApprovedWithoutAI: row ? row.humanApprovedWithoutAI === true : false,
      rendered: entityReviewHumanDecisionMarkup(row, passingReview),
      unreviewedRendering: entityReviewHumanDecisionMarkup({ decision: "unreviewed" }, passingReview),
      rejectedRendering: entityReviewHumanDecisionMarkup({ decision: "rejected", decidedAt: row && row.decidedAt }, passingReview),
    };
  })()`, rendered.context);
  endGesture();
  return pending;
}

/* CHANGED IN BATCH 1C — D2 AND D3, AND THE CHANGE IS THE REPAIR.

   OLD EXPECTATION: a batch coverage or expression commit recorded
   `decision: "approved-coverage"` / `"approved-expression"` with
   `humanApproved: true`, and rendered as APPROVED BY YOU.

   WHY IT IS NO LONGER VALID: it asserted that a coverage slot is production
   authority. The Batch 1B re-audit's §9 listed five consumers that read slots
   as generation, continuity, export and implicit-human authority while they
   carried no receipt — and this expectation is the fifth, written down as a
   requirement. Alpha resolves the contradiction by REMOVING the authority
   rather than instrumenting it.

   THE NEW INVARIANT: a slot commit is a SELECTION. It is still an explicit
   human act, it is still recorded, it is still shown — and it establishes no
   Canon, so it does not claim `humanApproved` and does not render as an
   approval. D1 is unchanged, because a reference approval IS Canon.

   WHY THIS IS SIMPLER AND TRUER: one authority concept instead of two, and a
   creator can no longer read "APPROVED BY YOU" on something that decides
   nothing. */
async function testBatchApprovalRendersAsHumanApproval(mutateSource = null) {
  const canon = await batchApproval("reference", mutateSource);
  assert.strictEqual(canon.decision, "approved-reference", "D1 reference: the batch writer records its own decision unchanged");
  assert.strictEqual(canon.humanApproved, true, "D1 reference: an explicit batch approval of a reference is a human decision");
  assert.strictEqual(canon.humanApprovedWithoutAI, false, "D1 reference: the batch only offers AI-reviewed candidates");
  assert(/APPROVED BY YOU/.test(canon.rendered), "D1 reference: and must render as one");
  assert(!/NO HUMAN DECISION YET/.test(canon.rendered), "D1 reference: and must not render as undecided");

  for (const row of [
    { kind: "coverage", decision: "selected-coverage", label: "D2 coverage" },
    { kind: "expressions", decision: "selected-expression", label: "D3 expression" },
  ]) {
    const result = await batchApproval(row.kind, mutateSource);
    assert.strictEqual(result.decision, row.decision, `${row.label}: a slot commit records a SELECTION, not an approval`);
    assert.strictEqual(result.humanApproved, false, `${row.label}: and claims no human approval, because a slot establishes no canon`);
    assert(/SELECTED BY YOU/.test(result.rendered), `${row.label}: and renders as a selection — a real human act with no authority`);
    assert(!/APPROVED BY YOU/.test(result.rendered), `${row.label}: never as an approval`);
    assert(!/NO HUMAN DECISION YET/.test(result.rendered), `${row.label}: and never as undecided — a person did choose it`);
  }
  note("D1: a batch-approved reference renders as APPROVED BY YOU. D2/D3: coverage and expression commits render as SELECTED BY YOU — supporting references, not canon.");
}

async function testAiPassAloneIsNotAnApproval(mutateSource = null) {
  const result = await batchApproval("reference", mutateSource);
  assert(/NO HUMAN DECISION YET/.test(result.unreviewedRendering),
    "a passing AI review with no human decision must still render as undecided");
  assert(!/APPROVED BY YOU/.test(result.unreviewedRendering), "and must never render as an approval");
  assert(/REJECTED BY YOU/.test(result.rejectedRendering), "a rejection still stands over a passing AI review");
  note("D4: a passing AI review on its own is still NO HUMAN DECISION YET; a rejection still reads as a rejection");
}

/* THE STATES STAY DISTINCT — AND IN BATCH 1C THERE IS ONE MORE OF THEM.

   OLD EXPECTATION: the reader's label expression, matched verbatim, with three
   outcomes. WHY IT CHANGED: a slot commit is a human act that establishes no
   canon, and it had nowhere to render but APPROVED BY YOU. Collapsing it into
   approval is what let a creator read authority into a supporting view.
   THE NEW INVARIANT: four outcomes, still mutually exclusive, still none of
   them inferred from an AI result. */
function testApprovalStatesStayDistinct() {
  const review = readLF("public/review.js");
  /* The vocabulary lives in shared-entity-slots.js now — this file held one of
     four copies of it, and the copies are why the rename half-landed. So the
     first half of this check is behavioural rather than textual: ask the real
     predicate, including the two legacy words a pre-1C project still has. */
  const Slots = require("../public/shared-entity-slots");
  for (const word of ["selected-coverage", "selected-expression", "approved-coverage", "approved-expression"])
    assert(Slots.decisionIsSlotSelection(word), `${word} is a supporting-reference selection`);
  for (const word of ["approved-reference", "approved", "rejected", "unreviewed", ""])
    assert(!Slots.decisionIsSlotSelection(word), `${word} is not a slot selection`);
  assert(/const selection = decisionIsSlotSelection\(decision\);/.test(review),
    "a supporting-reference selection is its own state, decided by the one shared predicate");
  assert(/const claimed = !selection && \(row\?\.humanApproved \|\| decision === "approved"\);/.test(review),
    "and it is never also an approval");
  /* SIMPLIFICATION PASS: a fifth outcome. A cached `humanApproved` that no
     current receipt supports reads as history, not as production truth. */
  assert(/const current = !canonFiles \|\| !fileName \? claimed : \(claimed && canonFiles\.has\(fileName\)\);/.test(review),
    "a claimed approval is only current while the file is still canon");
  assert(/"APPROVED EARLIER · NOT CURRENT CANON" : "NO HUMAN DECISION YET"/.test(review),
    "the human-decision reader tells rejection, selection, current approval, stale approval and no-decision apart");
  assert(/function markBatchApprovalAsHumanDecision\(row\)/.test(review), "the batch approval must mark the human decision");
  assert(/row\.humanApprovedWithoutAI = false;/.test(review),
    "and must not claim the director approved without an AI result in front of them");
  const reviewers = readLF("reference-review-contract.js");
  assert(!/humanApproved\s*=/.test(reviewers), "no review contract may write the human-approval mark");
  note("D: human approval, AI pass, rejection and unreviewed remain four separate answers");
}

/* ==========================================================================
   E — THE DISMISS COPY MUST BE TRUE
   ========================================================================== */

async function dismissCopy(mutateSource = null) {
  const fixture = buildFixture();
  const run = {
    id: "run-1", type: "shot-chain", targetId: "L1-01", label: "Hull check automation",
    status: "failed", stage: "Failed", summary: "", revision: 1, usage: {}, steps: {},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const rendered = await render("#/production", fixture, {
    ...(mutateSource ? { mutateSource } : {}),
    fetch: async (url, options, response) => {
      if (String(url).includes("/archive")) return response({ run: { ...run, status: "archived" } });
      if (String(url).startsWith("/api/automation/runs")) return response({ runs: [run] });
      return null;
    },
  });
  return vm.runInContext(`(async () => {
    AUTOMATION_RUNS = [${JSON.stringify(run)}];
    const said = [];
    const original = window.toast;
    window.toast = (message) => { said.push(String(message)); };
    let confirmBody = "";
    const originalConfirm = window.confirmModal;
    window.confirmModal = async (message, apply, options) => { confirmBody = String((options && options.body) || ""); await apply(); };
    try {
      await dismissAutomationActivityRun("run-1");
      /* Restored: the single dismiss above archived it, and the bulk path only offers
         runs that still need attention. */
      AUTOMATION_RUNS = [${JSON.stringify(run)}];
      await archivePreviousAutomationFailures();
    } finally { window.toast = original; window.confirmModal = originalConfirm; }
    return { said, confirmBody };
  })()`, rendered.context);
}

async function testDismissCopyDoesNotPromiseIndefiniteReports(mutateSource = null) {
  const copy = await dismissCopy(mutateSource);
  const all = [...copy.said, copy.confirmBody].join(" | ");
  assert(copy.said.length >= 2 && copy.confirmBody, "the dismiss paths must actually have spoken");
  assert(!/remains available in Reports/i.test(all), "the copy must not promise that a dismissed run stays in Reports");
  assert(!/keeps every run and diagnostic in Reports\./i.test(all), "nor promise it unconditionally in the confirmation");
  assert(!/Reports are unchanged/i.test(all), "nor claim Reports is untouched by archiving");
  assert(/ages? out of the run history/i.test(all), "and must say what actually limits how long it stays");
  note("E1: dismiss and bulk-dismiss both state that a run stays in Reports until it ages out of the run history");
}

function testRetentionItselfIsUnchanged() {
  const runs = readLF("automation-runs.js");
  assert(/const MAX_TERMINAL_RUNS = 100;/.test(runs), "the run-history limit must be unchanged");
  assert(/const terminal = runs\.filter\(\(run\) => !active\.includes\(run\)\)\.slice\(-MAX_TERMINAL_RUNS\);/.test(runs),
    "terminal runs must still be retained by the same rule");
  assert(/status: "archived", archivedAt: now\(\)/.test(runs), "archiving must still be the same write");
  note("E2: retention is untouched — same limit, same rule, same archive write. This repair is words only.");
}

/* ==========================================================================
   F — THE PROVIDER REQUEST ID READERS
   ========================================================================== */

function testPersistedExternalIdIsProviderIdentity(lifecycle = Lifecycle) {
  assert.strictEqual(lifecycle.providerRequestId({ externalId: "req-paid-123" }), "req-paid-123",
    "the persisted field is the provider's handle");
  assert.strictEqual(lifecycle.providerRequestId({ providerRequestId: "invented", requestId: "invented" }), "",
    "a field no writer produces is not an identity");
  assert.strictEqual(lifecycle.providerAcceptedRequest({ status: "FAILED", externalId: "req-paid-123" }), true,
    "a failed job that carries a provider handle WAS accepted by the provider");
  note("F1: the ledger's externalId is what provider identity is read from");
}

function testFailureAndUncertaintyClassifyFromRealFields(lifecycle = Lifecycle) {
  const cases = [
    { job: { status: "FAILED", externalId: "" }, accepted: false, why: "a failure with no handle never reached the provider" },
    { job: { status: "FAILED", externalId: "req-1" }, accepted: true, why: "a failure that carries a handle was accepted first" },
    { job: { status: "SUBMITTING", externalId: "" }, accepted: false, why: "an in-flight submission with no handle is not acceptance" },
    { job: { status: "SUBMITTING", externalId: "req-2" }, accepted: true, why: "an in-flight submission that has a handle is" },
    { job: { status: "UNRESOLVED", externalId: "" }, accepted: true, why: "uncertainty is counted as possible spend, not as a clean failure" },
    { job: { status: "COMPLETED", externalId: "req-3" }, accepted: true, why: "a completed job was obviously accepted" },
  ];
  for (const row of cases)
    assert.strictEqual(lifecycle.providerAcceptedRequest(row.job), row.accepted, row.why);
  /* And the diagnostic reader is the one asking. */
  const runs = readLF("automation-runs.js");
  assert(/Lifecycle\.providerAcceptedRequest\(job\)/.test(runs), "the diagnostic must ask the lifecycle module");
  assert(/failed_after_provider_acceptance/.test(runs) && /failed_before_provider_acceptance/.test(runs),
    "and must still classify a failure by whether the provider had accepted it");
  note("F2: acceptance is decided by the persisted handle and the real status vocabulary, including UNRESOLVED");
}

/* The invariant, repo-wide: no reader may test a job field no writer produces. */
function testNoReaderInventsAProviderIdField() {
  const files = [
    "automation-runs.js", "fal-generation.js", "generation-lifecycle.js",
    ...fs.readdirSync(path.join(ROOT, "public")).filter((name) => name.endsWith(".js")).map((name) => `public/${name}`),
  ];
  const offenders = [];
  for (const file of files) {
    /* Comments are prose about the defect, not code that reads it. */
    const source = readLF(file).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const line of source.split("\n")) {
      const code = line.trim();
      if (code.startsWith("//")) continue;
      if (/\bjob\??\.(providerRequestId|requestId)\b/.test(code)) offenders.push(`${file}: ${code.slice(0, 90)}`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `a job's provider handle is persisted as externalId; these read a field nothing writes:\n${offenders.join("\n")}`);
  note("F: no reader anywhere tests job.providerRequestId or job.requestId");
}

async function testHistoricalRowsNeedNoRewrite(mutateSource = null) {
  /* Exactly the shape tests/generation-job-durability.js persists and recovers. */
  const historical = { id: "fal-job-one", status: "COMPLETED", externalId: "req-paid-123", model: "fal-ai/minimax/h3" };
  assert.strictEqual(Lifecycle.providerRequestId(historical), "req-paid-123", "a stored row is already in the right shape");
  const fixture = buildFixture();
  const rendered = await render("#/reports", fixture, {
    ...(mutateSource ? { mutateSource } : {}),
    fetch: async (url, options, response) => {
      if (String(url).startsWith("/api/automation/runs?view=history")) return response({ runs: [], page: 0, pages: 1, pageSize: 50, total: 0, targetOptions: [] });
      if (url === "/api/automation/reports/summary") return response({ summary: { runCount: 0, totals: {}, quality: {}, highestEffortTargets: [], repeatedComplaints: [], inefficientFeedback: [] } });
      return null;
    },
  });
  const browser = vm.runInContext(`({
    stored: falJobProviderRequestId(${JSON.stringify(historical)}),
    invented: falJobProviderRequestId({ providerRequestId: "invented" }),
    activity: (() => {
      const step = { activity: { providerRequestId: "step-recorded" } };
      const job = ${JSON.stringify(historical)};
      return falJobProviderRequestId(job) || step.activity.providerRequestId;
    })(),
  })`, rendered.context);
  assert.strictEqual(browser.stored, "req-paid-123", "the browser reads the same persisted field");
  assert.strictEqual(browser.invented, "", "and does not resurrect the invented one");
  assert.strictEqual(browser.activity, "req-paid-123", "the job's own handle leads the step's recorded id");
  note("F3: a historical row in the current externalId shape is recognised by both sides with no migration");
}

/* ==========================================================================
   THE GATE THIS BATCH MUST NOT HAVE TOUCHED
   ========================================================================== */

/* The FLF motion-readiness gate is not in scope and must be exactly where it was. Fix A
   changes how the motion workspace is REACHED, which runs through the same function,
   so this is pinned here as well as in its own suites. */
function testMotionReadinessGateUntouched() {
  const studio = readLF("public/creation-studio.js");
  const opener = studio.slice(studio.indexOf("window.openGuidedMotionFromFrames"));
  const gate = opener.indexOf('if (approvedCount >= 2 && !sequenceReview?.pass) return toast(');
  const navigates = opener.indexOf('c.deliveryIntent = "motion";');
  assert(gate > 0 && navigates > 0, "the readiness gate and the navigation it protects must both still exist");
  assert(gate < navigates, "the readiness check must still run BEFORE the motion panel opens");
  assert(/const sequenceReview = guidedFrameSequenceReviewState\(s, sequenceInputs\);/.test(opener.slice(0, navigates + 200)),
    "and must still take its go/no-go from the frame-sequence review");
  /* And the new cross-panel selector is not a way around it. */
  assert(opener.indexOf("selectGuidedPanelTask") > gate,
    "the task selection must sit behind the gate, not in front of it");
  note("non-scope: the FLF motion-readiness gate still runs before the motion panel and still decides from the frame-sequence review");
}

/* The same gate, exercised rather than read, through the ONE thing this batch changed
   about it: reaching the motion workspace is now a task selection, so a moved or
   bypassed gate would show up as a selected task rather than as a moved comment.
   Exported so the negative controls can drive it against a reordered studio. */
async function motionGateNavigationBehaviour(mutateSource = null) {
  const fixture = buildFixture();
  const shot = fixture.shots[0];
  const rendered = await render(`#/shot/${shot.id}`, fixture, {
    storage: { [focusKey(shot.id)]: "frames" },
    ...(mutateSource ? { mutateSource } : {}),
  });
  return vm.runInContext(`(() => {
    const s = P.shots[0];
    const said = [];
    const original = window.toast;
    window.toast = (message) => { said.push(String(message)); };
    try {
      const creation = ensureShotCreation(s);
      delete creation.deliveryIntent;
      /* The gate's refusing condition: approved anchors, no passing readiness review. */
      delete (s.creationBrief || {}).frameSequenceReview;
      const inputs = guidedFrameSequenceInputs(s, takesFor(s.id)) || [];
      const review = guidedFrameSequenceReviewState(s, inputs);
      openGuidedMotionFromFrames(s.id, "create");
      return {
        approvedCount: inputs.length,
        reviewPassed: !!(review && review.pass),
        refused: said.length > 0,
        selectedTask: localStorage.getItem(${JSON.stringify(focusKey(shot.id))}),
      };
    } finally { window.toast = original; }
  })()`, rendered.context);
}

async function testMotionGateStillRefusesNavigation(mutateSource = null) {
  const result = await motionGateNavigationBehaviour(mutateSource);
  assert(result.approvedCount >= 2, "the fixture must actually reach the gate's condition, or nothing is being proved");
  assert.strictEqual(result.reviewPassed, false, "and must carry no passing readiness review");
  assert.strictEqual(result.refused, true, "the refusal must be told to the filmmaker");
  assert.strictEqual(result.selectedTask, "frames",
    "and the motion workspace must not be selected ahead of the gate's decision");
  note("non-scope (behaviour): approved anchors with no passing readiness review are refused and the workspace stays on Frames");
}

/* ------------------------------------------------------------------ run */

async function main() {
  await testAddMotionFromEveryTask();
  await testAddMotionFromMotionIsStable();
  await testOtherCrossPanelActions();
  await testNavigationKeepsProjectAndShot();
  testOneTaskStateWriter();
  testRefusalIsNotADomRace();

  const defaultId = testShippedDefaultIsDispatchable();
  await testFreshProjectResolvesToADispatchableTarget();
  testDefaultReachesTheWiredDispatchRoute(defaultId);
  await testDefaultOffersTheGenerateAction(defaultId);
  await testExplicitSelectionIsPreserved();

  await testUnsupportedTargetIsVisiblyUnavailable();
  await testRefusalCarriesReasonAndAlternative();
  await testUnsupportedTargetCannotReachSubmission();
  testEveryUnwiredTargetHasAReason();

  await testBatchApprovalRendersAsHumanApproval();
  await testAiPassAloneIsNotAnApproval();
  testApprovalStatesStayDistinct();

  await testDismissCopyDoesNotPromiseIndefiniteReports();
  testRetentionItselfIsUnchanged();

  testPersistedExternalIdIsProviderIdentity();
  testFailureAndUncertaintyClassifyFromRealFields();
  testNoReaderInventsAProviderIdField();
  await testHistoricalRowsNeedNoRewrite();

  testMotionReadinessGateUntouched();
  await testMotionGateStillRefusesNavigation();

  console.log("Private-alpha production loop suite passed: cross-panel navigation, a dispatchable default video target, "
    + "stated refusals for unwired targets, batch approval as a human decision, truthful dismiss copy, and provider "
    + "identity read from the field the ledger persists. Provider calls made: 0.");
  for (const line of notes) console.log(`  - ${line}`);
}

module.exports = {
  batchApproval,
  crossPanelNavigation,
  dismissCopy,
  motionGateNavigationBehaviour,
  motionPickerMarkup,
  testAddMotionFromEveryTask,
  testAddMotionFromMotionIsStable,
  testAiPassAloneIsNotAnApproval,
  testBatchApprovalRendersAsHumanApproval,
  testDismissCopyDoesNotPromiseIndefiniteReports,
  testExplicitSelectionIsPreserved,
  testFailureAndUncertaintyClassifyFromRealFields,
  testFreshProjectResolvesToADispatchableTarget,
  testHistoricalRowsNeedNoRewrite,
  testMotionGateStillRefusesNavigation,
  testMotionReadinessGateUntouched,
  testNoReaderInventsAProviderIdField,
  testOtherCrossPanelActions,
  testPersistedExternalIdIsProviderIdentity,
  testRefusalCarriesReasonAndAlternative,
  testShippedDefaultIsDispatchable,
  testUnsupportedTargetCannotReachSubmission,
  testUnsupportedTargetIsVisiblyUnavailable,
};

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

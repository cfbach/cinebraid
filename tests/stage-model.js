/* O1 — the declared stage model.
 *
 * THE STATEMENT THIS SUITE EXISTS TO MAKE TRUE, in one line: CineBraid knows what its
 * filmmaking stages are because they are declared in public/shared-stage-model.js, not
 * because somebody can infer them from whatever DOM children happen to render today.
 *
 * WHAT WAS ACTUALLY WRONG BEFORE O1. The five shot stages were stated five separate
 * times inside public/creation-studio.js - `defs`, `ids`, `legacyMap`, the `renderers`
 * keys and GUIDED_PANEL_TASKS - and a sixth time in public/focused-workspaces.js, where
 * a shot's stages were built from [...stack.children]: identity from a CSS class, order
 * from render order, status from a regular expression run over visible text. Nothing
 * kept the six in agreement.
 *
 * A NOTE ON WHAT THIS SUITE REFUSES TO DO. tests/clarity-consolidation.js used to assert
 * the literal source text `const ids=["inputs","look","frames","motion","deliver"]`,
 * which is the purest form of testing a constant against itself: it could not fail for
 * any reason a filmmaker would care about, and it would have passed unchanged while the
 * taskbar, the renderers and the panel map all disagreed. Every assertion below either
 * drives the shipped derivation, renders the shipped workspace, or pins a structural
 * property a negative control can point at.
 *
 * BRANCH COVERAGE IS PROVEN, NOT ASSUMED. The Production-State Honesty closeout shipped
 * a keyed drawer path that every green suite implied was exercised and that was in fact
 * unreachable. Section 5 therefore records which derivation outcome each representative
 * shot state actually produced and asserts the observed set - a stage whose blocked
 * branch never ran is a failure here, not a silent gap.
 *
 * NO PROJECT DATA IS TOUCHED. Every shot state below is a fixture built in memory by
 * tests/render-harness.js. NO PAID CALL AND NO PROVIDER CALL: the harness stubs fetch.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture, withCanon } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const Stage = require(path.join(PUBLIC, "shared-stage-model.js"));
const MODEL_SOURCE = fs.readFileSync(path.join(PUBLIC, "shared-stage-model.js"), "utf8");
const FOCUSED_SOURCE = fs.readFileSync(path.join(PUBLIC, "focused-workspaces.js"), "utf8");
const APP_SOURCE = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const AUTOMATION_SOURCE = fs.readFileSync(path.join(PUBLIC, "automation.js"), "utf8");

const notes = [];
const note = (line) => notes.push(line);
const ids = Stage.SHOT_STAGE_IDS;

/* ===========================================================================
   1 — DECLARATION
   =========================================================================== */

function checkDeclaration() {
  assert(ids.length >= 2, "the model must declare a workflow, not a single stage");
  assert.strictEqual(new Set(ids).size, ids.length, "stage ids must be unique");
  for (const stage of Stage.SHOT_STAGES) {
    assert(/^[a-z][a-z0-9-]*$/.test(stage.id), `stage id ${stage.id} must be a stable slug`);
    assert(stage.label && typeof stage.label === "string", `${stage.id} must carry a user-facing label`);
    assert(stage.purpose && stage.purpose.length > 20, `${stage.id} must state concisely what it is for`);
    assert(typeof stage.optional === "boolean", `${stage.id} must declare whether it may be skipped`);
    assert(Array.isArray(stage.authority) && stage.authority.length, `${stage.id} must name the approved authority that feeds it`);
    assert(stage.task && stage.task.scope === Stage.SHOT_STAGE_SCOPE, `${stage.id} must declare the workspace scope it is selected in`);
    assert(stage.navigation && stage.navigation.kind === "task-selection", `${stage.id} must declare how navigation reaches it`);
    assert(stage.navigation.route.includes(":shotId"), `${stage.id} must declare the route it lives on`);
    assert(Object.isFrozen(stage), `${stage.id} must be frozen — a declaration a reader can edit is not a declaration`);
  }

  /* Order is DETERMINISTIC and DECLARED. Reading order off the array index would make
     the declaration's own layout the source of truth, which is the same mistake one
     abstraction level up from reading it off the DOM. */
  Stage.SHOT_STAGES.forEach((stage, index) => {
    assert.strictEqual(stage.order, index + 1, `${stage.id} must declare its order explicitly`);
  });
  assert.deepStrictEqual([...Stage.SHOT_STAGES].sort((a, b) => a.order - b.order).map((s) => s.id), [...ids],
    "sorting by declared order must reproduce the declared sequence");

  /* No accidental duplicate declarations, in any field a second stage could collide on.
     A duplicated panel key is how a cross-workspace action would start selecting
     whichever stage happened to be declared first. */
  for (const field of ["label", "order"]) {
    const values = Stage.SHOT_STAGES.map((stage) => stage[field]);
    assert.strictEqual(new Set(values).size, values.length, `two stages declare the same ${field}`);
  }
  const taskIds = Stage.SHOT_STAGES.map((stage) => stage.task.id);
  assert.strictEqual(new Set(taskIds).size, taskIds.length, "two stages claim the same workspace task id");
  const seenPanels = new Set(), seenLegacy = new Set();
  for (const stage of Stage.SHOT_STAGES) {
    for (const panel of stage.panels) {
      assert(!seenPanels.has(panel), `panel ${panel} is claimed by more than one stage`);
      seenPanels.add(panel);
    }
    for (const legacy of stage.legacyTaskIds) {
      assert(!seenLegacy.has(legacy), `legacy task id ${legacy} is claimed by more than one stage`);
      assert(!ids.includes(legacy), `${legacy} is a current stage id and must not also be declared legacy`);
      seenLegacy.add(legacy);
    }
    for (const view of Object.keys(stage.panelViews)) {
      assert(stage.panels.includes(view), `${stage.id} declares a sub-view for a panel it does not own`);
    }
  }

  /* Successors are declared ids and they point forward. A model that lets a stage
     declare itself its own next step is a state machine nobody asked for. */
  for (const stage of Stage.SHOT_STAGES) {
    for (const next of stage.next) {
      const target = Stage.shotStage(next);
      assert(target, `${stage.id} declares an undeclared successor ${next}`);
      assert(target.order > stage.order, `${stage.id} declares ${next} as a successor but ${next} comes earlier`);
    }
  }
  assert.strictEqual(Stage.SHOT_STAGES[Stage.SHOT_STAGES.length - 1].next.length, 0, "the final stage must declare no successor");

  /* NO GENERATION ROUTE IS DECLARED HERE. References define what the world is, shot
     direction defines what happens, the route decides how it is executed - and a stage
     is none of the three. This is the assertion that keeps "two approved frames exist"
     from ever becoming "this shot is a first/last-frame shot". */
  for (const token of ["i2v", "flf", "r2v", "t2v", "first-last", "firstlast"]) {
    assert(!MODEL_SOURCE.toLowerCase().includes(token), `the stage model must not name the generation route ${token}`);
  }
  /* Stated as a property rather than a spelling: no derivation may compare a frame
     COUNT against a number. Endpoint control is a directorial decision, not an
     arithmetic consequence of how many frames happen to exist. */
  const body = MODEL_SOURCE.slice(MODEL_SOURCE.indexOf("function inputsState"), MODEL_SOURCE.indexOf("const DERIVATIONS"));
  assert(body.length > 500, "the derivation block must be locatable to be constrained");
  assert(!/(frameApprovedCount|frameTotal)\s*(>=|>|<|<=|===|==)\s*[0-9]/.test(body),
    "no stage derivation may branch on a frame count — that is how a route gets forced");

  /* Limitations are declared rather than guessed at. */
  assert(Object.keys(Stage.SHOT_STAGE_LIMITATIONS).length >= 1, "known limitations must stay declared, not quietly dropped");
  for (const [key, limitation] of Object.entries(Stage.SHOT_STAGE_LIMITATIONS)) {
    assert(limitation.question && limitation.why && limitation.wouldNeed,
      `limitation ${key} must say what it cannot answer, why, and what would fix it`);
  }
  assert(!Stage.SHOT_STAGE_AVAILABILITY.includes("not-applicable"),
    "not-applicable must remain undeclared until an authoritative applicability answer exists for every stage");

  note(`Declaration: ${ids.length} stages, unique ids, explicit order — ${ids.join(" -> ")}`);
  note("Declaration: no generation route and no frame-count arithmetic reaches stage semantics");
}

/* ===========================================================================
   2 — REPRESENTATIVE SHOT STATES

   Facts are assembled by the SHIPPED assembler, public/creation-studio.js's
   shotStageModelFacts, and judged by the SHIPPED model, both reached inside the
   harness realm. A suite that rebuilt either by hand would prove only that two copies
   of the test agree with each other.
   =========================================================================== */

const scanFor = (project, takes) => ({
  anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
  plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
  props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
  vehicles: (project.vehicles || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/vehicles/${x.approvedFile}` })),
  audio: [],
  media: (project.mediaAssets || []).map((asset) => ({ name: asset.file, url: `/assets/media/${asset.file}` })),
  shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: takes.map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })), locked: [] }])),
});

/* `P` is a top-level `let` in a classic script, so it lives in the harness realm's
   lexical scope and is never a property of the sandbox object — reading `context.P`
   would read undefined. Everything below therefore runs INSIDE the realm and returns
   JSON, which also sidesteps the cross-realm deepStrictEqual trap. */
async function stagesFor(project, takes, options = {}) {
  const rendered = await render("#/shot/L1-01", project, { scan: scanFor(project, takes), ...options });
  const payload = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const facts = shotStageModelFacts(shot, takesFor("L1-01"));
    return JSON.stringify({ facts, progress: shotStageProgress(facts) });
  })()`, rendered.context);
  const { facts, progress } = JSON.parse(payload);
  return { rendered, facts, progress, byId: Object.fromEntries(progress.map((state) => [state.id, state])) };
}


function authoritativeFixture(route = "i2v") {
  const project = buildFixture();
  project.shots[0].deliveryRoute = route;
  withCanon(project, [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  return project;
}

const observed = [];
const record = (label, byId) => {
  for (const state of Object.values(byId)) observed.push(`${state.id}:${state.availability}:${state.completion}:${state.tone}`);
  note(`  ${label}`);
};

async function checkRepresentativeStates() {
  /* S1 — an early, incomplete shot. Nothing approved, one linked reference with no
     approved file of its own. */
  const early = authoritativeFixture("i2v");
  early.props.find((row) => row.id === "PR-TOOL").approvedFile = "";
  early.shots[0].keyframes = [{ ...early.shots[0].keyframes[0], winner: null }];
  early.shots[0].clips = [];
  /* No planning media at all, so Look & blocking is genuinely untouched rather than
     merely unresolved — the distinction the two branches exist for. */
  early.mediaAssets = [];
  const S1 = await stagesFor(early, []);
  assert.strictEqual(S1.byId.look.completion, "not-started", "a shot with no blocking media has not started planning");
  assert.strictEqual(S1.byId.inputs.completion, "in-progress", "a shot missing an approved reference has incomplete inputs");
  assert.strictEqual(S1.byId.inputs.availability, "available", "inputs is never blocked — describing the shot has no prerequisite");
  assert.strictEqual(S1.byId.frames.completion, "not-started");
  assert.strictEqual(S1.byId.motion.availability, "blocked", "motion is blocked before any required frame is approved");
  assert.strictEqual(S1.byId.motion.blockedReason, S1.facts.motionReadinessReason, "the stage repeats the canonical motion blocker");
  assert(!/Approve the required frames first/.test(S1.byId.motion.blockedReason), "the stage must not substitute its former all-routes frame gate");
  assert.strictEqual(S1.byId.deliver.availability, "blocked");
  assert.strictEqual(S1.byId.deliver.blockedReason, "Approve a still or a video first");
  /* Blocked is not the same claim as not-started, and the model states both separately. */
  assert.strictEqual(S1.byId.motion.completion, "not-started");
  record("S1 early shot: inputs in-progress, motion + deliver blocked with stated reasons", S1.byId);

  /* S2 — ready for frame work: every reference approved, a blocking guide chosen. */
  const ready = authoritativeFixture("i2v");
  ready.shots[0].keyframes = [{ ...ready.shots[0].keyframes[0], winner: null }];
  ready.mediaAssets.push({
    id: "media-blocking", file: "blocking-guide.png", title: "Blocking guide", originalName: "blocking-guide.png",
    links: [{ id: "link-blocking", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "active", agentContext: true, generationInput: false, order: 0 }],
  });
  const S2 = await stagesFor(ready, []);
  assert.strictEqual(S2.byId.inputs.completion, "complete", "every linked reference has an approved file");
  assert.strictEqual(S2.byId.look.completion, "complete", "an active blocking guide completes Look & blocking");
  assert.strictEqual(S2.byId.frames.availability, "available", "frame work has no unmet prerequisite");
  assert.strictEqual(S2.byId.frames.completion, "not-started");
  assert.strictEqual(S2.byId.motion.availability, "blocked");
  record("S2 ready for frames: inputs + look complete, frames available and not started", S2.byId);

  /* S3 — Frame A approved, and it is the shot's only required frame. */
  const frameA = authoritativeFixture("i2v");
  frameA.shots[0].keyframes = [frameA.shots[0].keyframes[0]];
  frameA.shots[0].clips = [];
  const S3 = await stagesFor(frameA, ["FRAME_A.png"]);
  assert.strictEqual(S3.byId.frames.completion, "complete");
  assert.strictEqual(S3.byId.motion.availability, "available", "one approved required frame opens motion");
  assert.strictEqual(S3.byId.motion.blockedReason, "", "an available stage states no blocker");
  assert.strictEqual(S3.byId.deliver.availability, "available", "an approved still can be finished");
  record("S3 Frame A approved: frames complete, motion and deliver available", S3.byId);

  /* S4 — Frame A and Frame B both approved and both required. Deliberate endpoint
     control: the filmmaker declared the second frame required. */
  const bothFrames = authoritativeFixture("i2v");
  bothFrames.shots[0].keyframes.forEach((frame) => { frame.required = true; });
  bothFrames.shots[0].clips = [];
  const S4 = await stagesFor(bothFrames, ["FRAME_A.png", "FRAME_B.png"]);
  assert.strictEqual(S4.byId.frames.completion, "complete");
  assert.strictEqual(S4.byId.motion.availability, "available");
  /* THE LINE THIS SUITE IS MOST FOR. Two approved frames is a fact about frames. It is
     not a route, not a requirement, and not a difference the stage model is allowed to
     see: S3 and S4 must produce identical stage semantics. */
  const semantic = (state) => ({ id: state.id, availability: state.availability, completion: state.completion, optional: state.optional, blockedReason: state.blockedReason, next: state.next });
  assert.deepStrictEqual(S4.progress.map(semantic), S3.progress.map(semantic),
    "one approved frame and two approved frames must produce identical stage semantics — the stage model does not choose a generation route");
  record("S4 Frame A + Frame B approved: stage semantics identical to S3", S4.byId);

  /* S5 — the reference-rich shot. Frame A approved, a second frame present but declared
     NOT required, because this shot's motion comes from approved references and the
     ending composition is not a directorial constraint. Motion must be reachable. */
  const referenceRich = authoritativeFixture("i2v");
  referenceRich.shots[0].keyframes[1].winner = null;
  referenceRich.shots[0].keyframes[1].required = false;
  referenceRich.shots[0].clips = [];
  const S5 = await stagesFor(referenceRich, ["FRAME_A.png"]);
  assert.strictEqual(S5.facts.requiredFramesApproved, true, "a frame the filmmaker marked not required must not gate the shot");
  assert.strictEqual(S5.facts.frameTotal, 2, "the optional frame must genuinely still be on the shot");
  assert.strictEqual(S5.byId.motion.availability, "available",
    "a reference-rich shot must reach motion without a deliberate ending frame");
  assert.strictEqual(S5.byId.motion.blockedReason, "");
  assert.strictEqual(S5.byId.frames.completion, "complete", "required frames are approved even though an optional frame is not");
  record("S5 reference-rich: optional Frame B unapproved, motion still available", S5.byId);

  /* S6 — delivered. A final still is recorded on the shot. */
  const delivered = authoritativeFixture("i2v");
  delivered.shots[0].keyframes = [delivered.shots[0].keyframes[0]];
  delivered.shots[0].clips = [];
  delivered.shots[0].creationBrief = { finalStillFile: "FRAME_A.png" };
  const S6 = await stagesFor(delivered, ["FRAME_A.png"]);
  assert.strictEqual(S6.facts.lifecycleKey, "final", "the fixture must actually reach the delivered lifecycle");
  assert.strictEqual(S6.byId.deliver.completion, "complete");
  assert.strictEqual(S6.byId.deliver.availability, "available");
  assert.strictEqual(S6.byId.motion.completion, "complete");
  record("S6 delivered: deliver complete", S6.byId);

  /* S7 — a machine is running on the shot. Completion and activity are separate
     answers: an automation run in flight does not make unapproved frames complete.
     Driven through the model directly so the branch is exercised deterministically
     rather than depending on when the harness's run feed lands. */
  const runningFacts = { frameTotal: 2, frameApprovedCount: 0, requiredFramesApproved: false, activityStatus: "running" };
  const runningFrames = Stage.shotStageState("frames", runningFacts);
  assert.strictEqual(runningFrames.activity, "running", "a live run must be reported as activity");
  assert.strictEqual(runningFrames.completion, "not-started", "a running machine does not complete unapproved frames");
  assert.strictEqual(runningFrames.tone, "active");
  assert.strictEqual(runningFrames.statusKey, "running");
  const failedFrames = Stage.shotStageState("frames", { ...runningFacts, activityStatus: "failed" });
  assert.strictEqual(failedFrames.tone, "attention");
  assert.strictEqual(failedFrames.statusKey, "failed");
  const awaiting = Stage.shotStageState("frames", { ...runningFacts, activityStatus: "awaiting-review" });
  assert.strictEqual(awaiting.statusKey, "needsReview");
  assert.strictEqual(awaiting.tone, "active", "the shipped taskbar treats an awaiting-review run as machine activity");
  observed.push("frames:available:not-started:active", "frames:available:not-started:attention");
  note("  S7 machine activity: running, failed and awaiting-review all keep completion separate");

  /* Frames needing a human decision, the one completion state no fixture above reaches. */
  const reviewFrames = Stage.shotStageState("frames", { frameTotal: 2, frameApprovedCount: 1, frameNeedsReview: true });
  assert.strictEqual(reviewFrames.completion, "needs-review");
  assert.strictEqual(reviewFrames.tone, "attention");
  observed.push("frames:available:needs-review:attention");

  /* Returned media cannot satisfy a canonical input blocker, but the review workspace
     must remain reachable. New generation still reads the separate readiness status. */
  const returnedVideo = Stage.shotStageState("motion", {
    motionReadinessStatus: "BLOCKED",
    motionReadinessReason: "Approve the required opening frame",
    motionCandidateCount: 1,
    lifecycleKey: "review-motion",
  });
  assert.strictEqual(returnedVideo.availability, "available", "returned video keeps the Motion review workspace reachable");
  assert.strictEqual(returnedVideo.blockedReason, "", "workspace access must not wear the new-generation blocker");
  assert.strictEqual(returnedVideo.completion, "needs-review");
  observed.push("motion:available:needs-review:attention");

  /* Recommended handoffs: present where one genuinely exists, absent where the shot has
     not said what it wants. */
  assert.strictEqual(Stage.shotStageState("inputs", S3.facts).recommendedNext, "look");
  assert.strictEqual(Stage.shotStageState("look", S3.facts).recommendedNext, "frames");
  assert.strictEqual(Stage.shotStageState("frames", { requiredFramesApproved: true, hasMotionUnit: true }).recommendedNext, "motion");
  assert.strictEqual(Stage.shotStageState("frames", { requiredFramesApproved: true, deliveryIntent: "still" }).recommendedNext, "deliver");
  assert.strictEqual(Stage.shotStageState("frames", { requiredFramesApproved: true, deliveryIntent: "undecided" }).recommendedNext, "",
    "an undecided shot must get no recommendation rather than a guessed one");
  assert.strictEqual(Stage.shotStageState("frames", { requiredFramesApproved: false, deliveryIntent: "motion" }).recommendedNext, "",
    "nothing is recommended out of a stage whose own work is unfinished");
  assert.strictEqual(Stage.shotStageState("deliver", S6.facts).recommendedNext, "", "the final stage recommends nothing");
  note("Handoffs: recommendations exist only where the shot's own state supports one");

  /* Optionality is DECLARED, and is a different question from completion. */
  assert.strictEqual(S1.byId.look.optional, true, "planning may be skipped where appropriate");
  assert.strictEqual(S1.byId.motion.optional, true, "a still shot never needs motion");
  assert.strictEqual(S1.byId.frames.optional, false);
  const description = authoritativeFixture("t2v");
  description.shots[0].clips = [];
  const T2V = await stagesFor(description, ["FRAME_A.png", "FRAME_B.png"]);
  assert.strictEqual(T2V.byId.frames.optional, true, "description-only makes retained Frames optional");
  assert.strictEqual(T2V.byId.motion.availability, "available", "description-only Motion requires no frame input");
}

/* ===========================================================================
   3 — NAVIGATION
   =========================================================================== */

/* THE NAVIGATOR LEFT `#main` IN O4 and its coverage went with it.
 *
 * Until O4 the shot workspace rendered the five-stage taskbar itself, so this suite
 * could read the declared order, the declared labels and the selection off the `#main`
 * render. The navigator is now built by public/stage-surfaces.js into the shell's
 * persistent bar, because `#main` is replaced wholesale on every render and a workflow
 * navigator that is destroyed by moving through the workflow is not one.
 *
 * What this suite still owns, and still asserts below, is everything about `#main`: that
 * the stored selection resolves through the declaration, that each declared stage renders
 * a workspace of its own, and — new here — that the workspace builds NO navigator, which
 * is the O1-relevant half of "there must not be two".
 *
 * The navigator's own order, labels and status rendering are asserted against the shipped
 * renderer in tests/stage-surfaces.js, and in a live document in
 * tests/stage-surfaces-real-browser.py. */
function stageNavigatorsIn(html) {
  return [...html.matchAll(/class="[^"]*\bfocused-taskbar\b[^"]*"/g)].length;
}

async function checkNavigation() {
  /* Every declared stage renders a workspace. The renderer map in
     guidedShotWorkspaceView is not a fourth statement of the stage list: a stage with
     no renderer must fail here rather than fall through to Frames. */
  const probe = buildFixture();
  const scan = scanFor(probe, ["FRAME_A.png", "FRAME_B.png"]);
  const bodies = new Map();
  for (const stage of Stage.SHOT_STAGES) {
    const rendered = await render("#/shot/L1-01", probe, {
      scan,
      storage: { [`cinebraid-focused:fixture:${Stage.SHOT_STAGE_SCOPE}:L1-01`]: stage.id },
    });
    assert(rendered.html.includes(`data-selected-task="${stage.id}"`), `${stage.id} did not become the selected workspace`);
    assert(rendered.html.includes(`data-bounded-task="${stage.id}"`), `${stage.id} did not render its own workspace body`);
    assert.strictEqual(stageNavigatorsIn(rendered.html), 0,
      `${stage.id}: the shot workspace built a stage navigator. Since O4 there is exactly one, it lives in the shell's persistent bar, and a second one built here could disagree with it.`);
    const marker = `data-bounded-task="${stage.id}">`;
    bodies.set(stage.id, rendered.html.slice(rendered.html.indexOf(marker) + marker.length));
  }
  /* A stage with no renderer of its own falls through to Frames, and `data-bounded-task`
     alone cannot see that — it is written from the selection, not from what rendered.
     Two declared stages rendering the SAME workspace is the observable symptom, and it
     is a property rather than a second copy of the stage list. */
  for (const [a, bodyA] of bodies) {
    for (const [b, bodyB] of bodies) {
      if (a >= b) continue;
      assert.notStrictEqual(bodyA, bodyB, `${a} and ${b} render the same workspace — one of them has no renderer of its own`);
    }
  }
  note(`Navigation: all ${ids.length} declared stages resolve to a distinct rendered workspace`);

  /* The workspace states ONE selection and builds no navigator. Order and labels are the
     navigator's, and the navigator is O4's — see the note on stageNavigatorsIn above. */
  const full = await render("#/shot/L1-01", probe, { scan });
  assert.strictEqual(stageNavigatorsIn(full.html), 0, "the shot workspace must render no stage navigator of its own");
  assert.strictEqual((full.html.match(/data-selected-task="/g) || []).length, 1,
    "the shot workspace must state its selected stage exactly once");

  /* Legacy stored values are translated by the DECLARATION. These are the values older
     builds wrote into browser workspace state and that real installs still carry. */
  for (const stage of Stage.SHOT_STAGES) {
    for (const legacy of stage.legacyTaskIds) {
      assert.strictEqual(Stage.resolveShotStageId(legacy, {}), stage.id, `stored '${legacy}' must resolve to ${stage.id}`);
    }
  }
  assert.strictEqual(Stage.resolveShotStageId("motion", {}), "motion", "a current id is honoured unchanged");
  /* The oldest stored form of all is a bare index. It is resolved against the DECLARED
     order — the only reading under which an ordinal was ever meaningful. */
  ids.forEach((id, index) => assert.strictEqual(Stage.resolveShotStageId(String(index), {}), id, `stored index ${index} must resolve by declared order`));
  assert.strictEqual(Stage.resolveShotStageId("99", {}), ids[ids.length - 1], "an out-of-range index is clamped to the declared range");

  /* A legacy value still selects the stage it meant, end to end through the workspace.
     The fixture is chosen so translation is observable: on a shot whose recommendation
     already IS Look & blocking, dropping the translation would land on look anyway and
     this assertion would prove nothing. This shot has no planning media and a reference
     without an approved file, so its recommendation is Inputs. */
  const legacyProbe = buildFixture();
  legacyProbe.mediaAssets = [];
  legacyProbe.props.find((row) => row.id === "PR-TOOL").approvedFile = "";
  assert.strictEqual(Stage.recommendedShotStageId({ referenceCount: 3, missingReferenceCount: 1 }), "inputs",
    "the control fixture must recommend a stage other than the one the legacy value names");
  const legacyRender = await render("#/shot/L1-01", legacyProbe, {
    scan: scanFor(legacyProbe, ["FRAME_A.png", "FRAME_B.png"]),
    storage: { [`cinebraid-focused:fixture:${Stage.SHOT_STAGE_SCOPE}:L1-01`]: "composer" },
  });
  assert(legacyRender.html.includes('data-selected-task="look"'), "a stored 'composer' must still open Look & blocking");
  assert(legacyRender.html.includes("Approved references"), "and must land on the sub-view it named");

  /* Panel targets — the cross-workspace actions — resolve through the declaration. */
  assert.strictEqual(Stage.shotStageForPanel("finish").id, "deliver");
  assert.strictEqual(Stage.shotStageForPanel("motionAudio").id, "motion");
  assert.strictEqual(Stage.shotStagePanelView("composer"), "authority");
  assert.strictEqual(Stage.shotStagePanelView("blocking"), "blocking");
  assert.strictEqual(Stage.shotStagePanelView("motion"), "", "a stage without tabs implies no sub-view");
  assert.strictEqual(Stage.shotStageForPanel("not-a-panel"), null);
  /* The shipped translator is the declared one, not a copy of it. */
  const wired = vm.runInContext("JSON.stringify([guidedPanelTaskId('finish'), guidedPanelTaskId('composer'), guidedPanelTaskId('nope')])", full.context);
  assert.deepStrictEqual(JSON.parse(wired), ["deliver", "look", ""], "the workspace's own panel translator must answer from the declaration");
  note("Navigation: legacy ids, bare indices and panel targets all resolve through the declaration");

  /* DOM CHILD ORDER IS NOT THE SEMANTIC SOURCE OF TRUTH.
     public/focused-workspaces.js still owns the scene and legacy entity routes, which
     answer a different question, so the inference helpers remain in the file. What must
     never come back is their application to a SHOT: enhanceShot may not build a
     taskbar, choose a task, or name a task from the workspace's rendered children. */
  const enhanceShotBody = FOCUSED_SOURCE.slice(FOCUSED_SOURCE.indexOf("function enhanceShot"), FOCUSED_SOURCE.indexOf("function entityListName"));
  assert(enhanceShotBody.length > 100, "enhanceShot must still exist to be constrained");
  for (const inference of ["buildTaskbar", "nextTaskIndex", "resolveTaskSelection", "taskIdForElement", "stack.children"]) {
    assert(!enhanceShotBody.includes(inference), `enhanceShot must not derive shot stages from the DOM (found ${inference})`);
  }
  assert(FOCUSED_SOURCE.includes("function nextTaskIndex"), "the scene and legacy entity routes still need these helpers");
  note("Navigation: enhanceShot no longer derives shot stage identity, order or status from rendered children");

  /* Removing presentation nodes must not change stage identity. Proven against the
     shipped renderer with a shot whose panel CONTENT differs sharply — no clips, one
     frame, no linked media — which must still resolve to a declared stage and still
     build no navigator of its own. The SEQUENCE this used to read off the taskbar is
     asserted against the shipped navigator in tests/stage-surfaces.js, which drives it
     with fixtures this render cannot reach. */
  const sparse = buildFixture();
  sparse.shots[0].clips = [];
  sparse.shots[0].keyframes = [{ ...sparse.shots[0].keyframes[0], winner: null }];
  sparse.mediaAssets = [];
  const sparseRender = await render("#/shot/L1-01", sparse, { scan: scanFor(sparse, []) });
  const sparseSelection = sparseRender.html.match(/data-selected-task="([a-z-]+)"/);
  assert(sparseSelection && ids.includes(sparseSelection[1]),
    `a structurally different shot must still resolve to a declared stage, got ${sparseSelection && sparseSelection[1]}`);
  assert.strictEqual(stageNavigatorsIn(sparseRender.html), 0,
    "and must still build no navigator, whatever its rendered children are");
  note("Navigation: a structurally different shot resolves to a declared stage and builds no navigator");
}

/* ===========================================================================
   4 — ONE DEFINITION OF PRODUCTION TRUTH
   =========================================================================== */

function checkSingleTruth() {
  /* public/app.js still carries an older SEVEN-stage model that persisted stage status
     onto the shot record as `stageApprovals`. It is unreachable — SHOT_STAGE_ORDER has
     no reader and its three writers have no callers — and it is deliberately left in
     place because `stageApprovals` is still carried by server.js and the OFP migration
     rules, so removing it is a persistence change rather than an O1 change. It is
     pinned INERT here: wiring any of it back up is a failing test and a conversation,
     not a silent second answer to "what stage is this shot in". */
  assert.strictEqual((APP_SOURCE.match(/SHOT_STAGE_ORDER/g) || []).length, 1,
    "the legacy seven-stage order must remain unread — it is a rival definition of production truth");
  for (const writer of ["approveShotStage", "markShotStageNotNeeded", "clearShotStage"]) {
    assert.strictEqual((APP_SOURCE.match(new RegExp(writer, "g")) || []).length, 1,
      `${writer} persists stage status and must remain uncalled`);
  }
  /* And the declared model must not have grown a persistent twin of its own. */
  assert(!MODEL_SOURCE.includes("stageStatus"), "the declared model must not introduce a stored stage status");
  assert(!/localStorage|sessionStorage|fetch\(/.test(MODEL_SOURCE), "the declared model must not read or write any store");
  note("Truth: the legacy seven-stage model stays inert; the declared model stores nothing");
}

/* Every writer of shot stage selection must write the key the reader reads.
   public/bounded-rendering.js exposes two storage families that look interchangeable
   and are not: boundedWriteState writes `cinebraid-bounded:…`, while the focused-task
   family - the one boundedShotSelectedTask reads - writes `cinebraid-focused:…`. Two
   callers used the wrong one and were therefore dead for their whole life: blocking-only
   automation never opened Look & blocking, and the project-readiness link never opened
   Shot Inputs. Both failed in silence, which is why this looks for the KEY rather than
   for the intention - and why the assertion these replace, which required the dead call
   as a source string, pinned the defect in place instead of catching it. */
function checkStageWriters() {
  assert(!/boundedWriteState\(\s*["']selected:shot-task["']/.test(AUTOMATION_SOURCE),
    "blocking automation must not write shot stage selection to a key nothing reads");
  assert(AUTOMATION_SOURCE.includes('selectGuidedPanelTask(currentShot, "blocking")'),
    "blocking automation must select its stage through the declared model");
  assert(!/boundedWriteState\(\s*['"]shot-task['"]/.test(APP_SOURCE),
    "the readiness link must not write shot stage selection to a key nothing reads");
  assert(APP_SOURCE.includes("boundedWriteFocusedTask('${SHOT_STAGE_SCOPE}'"),
    "the readiness link must write the declared scope through the canonical writer");
  note("Writers: both previously dead stage handoffs now write the key the reader reads");
}

/* ===========================================================================
   5 — BRANCH COVERAGE, RECORDED RATHER THAN ASSUMED
   =========================================================================== */

function checkCoverage() {
  const seen = new Set(observed);
  for (const id of ids) {
    assert([...seen].some((row) => row.startsWith(`${id}:`)), `${id} was never exercised by any representative shot state`);
  }
  const required = [
    ["inputs:available:in-progress", "an incomplete inputs stage"],
    ["inputs:available:complete", "a complete inputs stage"],
    ["look:available:complete", "a completed blocking stage"],
    ["look:available:not-started", "an untouched blocking stage"],
    ["frames:available:not-started:pending", "frames before any approval"],
    ["frames:available:complete", "frames with the required approvals"],
    ["frames:available:not-started:active", "frames with a machine running on them"],
    ["frames:available:needs-review", "frames waiting on a human decision"],
    ["motion:blocked:not-started", "motion blocked by an unmet prerequisite"],
    ["motion:available:not-started", "motion opened by approved required frames"],
    ["motion:available:needs-review", "returned motion reachable for review while canonical inputs block new work"],
    ["motion:available:complete", "motion after approval"],
    ["deliver:blocked:not-started", "deliver blocked by an unmet prerequisite"],
    ["deliver:available:not-started", "deliver opened by an approved result"],
    ["deliver:available:complete", "a delivered shot"],
  ];
  for (const [prefix, description] of required) {
    assert([...seen].some((row) => row.startsWith(prefix)), `no representative shot state produced ${description} (${prefix})`);
  }
  note(`Coverage: ${seen.size} distinct stage outcomes observed across the representative shot states`);
}

async function main() {
  checkDeclaration();
  await checkRepresentativeStates();
  await checkNavigation();
  checkSingleTruth();
  checkStageWriters();
  checkCoverage();
  console.log(notes.join("\n"));
  console.log("declared stage model assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

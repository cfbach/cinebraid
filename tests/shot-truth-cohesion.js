/* Focused semantic regression for one governing shot truth.
 * No provider or paid-generation call is made; render-harness stubs transport. */
const assert = require("assert");
const vm = require("vm");
const { render, buildFixture, withCanon } = require("./render-harness");

let checks = 0;
function equal(actual, expected, message) {
  checks += 1;
  assert.strictEqual(actual, expected, message);
}
function ok(value, message) {
  checks += 1;
  assert(value, message);
}
function countForFilter(markup, id) {
  const match = new RegExp("setShotActionFilter\\('" + id + "'\\)[\\s\\S]*?<b>(\\d+)</b>").exec(markup);
  return match ? Number(match[1]) : -1;
}

async function blockedShotConsumers() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.deliveryRoute = "r2v";

  const page = await render("#/production", project);
  const payload = JSON.parse(await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const feed = projectShotReadiness();
    const readiness = feed.shots.find((row) => row.shotId === shot.id);
    const local = shotProductionNextAction(shot, readiness);
    const previousFilter = FILTER.action;
    FILTER.action = "ready";
    const readyMatch = shotBoardActionMatches(shot, feed);
    FILTER.action = "review";
    const reviewMatch = shotBoardActionMatches(shot, feed);
    const filterMarkup = shotBoardActionFilters(feed);
    FILTER.action = previousFilter;

    const board = slate(shot, "", readiness);
    const home = await productionHomeView();
    const active = (home.match(/<section class="production-active"[\\s\\S]*?<\\/section>/) || [""])[0];
    const lifecycle = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    const facts = shotStageModelFacts(shot, takesFor(shot.id));
    const motion = shotStageState("motion", facts);
    const motionUnit = readiness.units.find((unit) => unit.kind === "motion" && unit.required);
    const panel = guidedMotionPanel(shot, null, takesFor(shot.id));
    const projectNext = projectNextProductionAction(feed);

    return JSON.stringify({
      winnerCount: (shot.keyframes || []).filter((frame) => frame.winner).length,
      status: readiness.status,
      action: readiness.nextAction,
      local,
      category: shotBoardActionCategory(shot, readiness),
      readyMatch,
      reviewMatch,
      filterMarkup,
      board,
      active,
      lifecycle,
      motion,
      motionUnit,
      panel,
      projectNext,
    });
  })()`, page.context));

  ok(payload.winnerCount > 0, "precondition: the blocked shot retains enough still progression to tempt the old Animate action");
  ok(["BLOCKED", "NEEDS_DECISION"].includes(payload.status), "canonical readiness must block or require a decision");
  equal(payload.local.key, payload.action.code, "shot-local action projects canonical action code");
  equal(payload.local.detail, payload.action.message, "shot-local action projects canonical explanation");
  equal(payload.local.status, payload.status, "shot-local action projects canonical status");
  ok(!/^(animate|add-motion|ready-to-generate)$/.test(payload.local.key), "blocked shot cannot advertise the old forward action");
  ok(!/^(Animate|Add motion|Ready to generate)$/.test(payload.local.label), "blocked shot cannot advertise forward-action words");

  equal(payload.category, "review", "NEEDS_DECISION maps to the board review category");
  equal(payload.readyMatch, false, "Ready filter excludes a canonically blocked shot");
  equal(payload.reviewMatch, true, "Review filter includes the same shot");
  equal(countForFilter(payload.filterMarkup, "ready"), 0, "Ready filter count is canonical");
  equal(countForFilter(payload.filterMarkup, "review"), 1, "Review filter count is canonical");

  ok(payload.board.includes(payload.local.label), "board chip renders the canonical action");
  ok(payload.board.includes(payload.local.detail), "board card renders the canonical explanation");
  ok(!payload.board.includes("next-animate"), "board card does not retain the media-derived Animate key");

  ok(payload.active.includes(payload.local.label), "Production active-shot list renders the canonical action");
  ok(payload.active.includes(payload.local.detail), "Production active-shot list renders the canonical explanation");

  ok(payload.lifecycle.includes('data-shot-readiness="' + payload.status + '"'), "lifecycle card declares canonical readiness");
  ok(payload.lifecycle.includes(payload.local.label), "lifecycle next-action card renders the canonical action");
  ok(payload.lifecycle.includes(payload.local.detail), "lifecycle next-action card renders the canonical explanation");
  ok(!payload.lifecycle.includes(">Add motion<"), "lifecycle card does not bypass the blocker with Add motion");

  equal(payload.motion.availability, "blocked", "persistent Motion stage is blocked");
  equal(payload.motion.blockedReason, payload.motionUnit.nextAction.message, "Motion stage repeats the canonical unit blocker");
  ok(payload.panel.includes("guided-motion-card locked"), "Motion workspace agrees with stage availability");
  ok(payload.panel.includes(payload.motion.blockedReason), "Motion workspace explains the canonical blocker");

  equal(payload.projectNext.kind, "blocker", "project-level Production recommendation remains the stronger blocker projection");
  equal(payload.projectNext.message, payload.action.message, "project and shot-local truth share the canonical explanation");
}

async function descriptionOnlyConsumers() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.deliveryRoute = "t2v";
  shot.characters = [];
  shot.codes = [];
  shot.creationBrief = {};
  shot.clips = [];

  const page = await render("#/shot/L1-01", project);
  const payload = JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const facts = shotStageModelFacts(shot, takesFor(shot.id));
    const frames = shotStageState("frames", facts);
    const motion = shotStageState("motion", facts);
    const frameMarkup = shotFramesWorkspace(shot, takesFor(shot.id));
    const panel = guidedMotionPanel(shot, null, takesFor(shot.id));
    const readinessOwner = shotReadinessFor;
    shotReadinessFor = () => null;
    const unavailableLifecycle = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    shotReadinessFor = readinessOwner;
    return JSON.stringify({
      requiredFrames: readiness.units.filter((unit) => unit.kind === "frame" && unit.required).length,
      retainedFrames: (shot.keyframes || []).length,
      action: readiness.nextAction.code,
      facts,
      frames,
      motion,
      frameMarkup,
      panel,
      unavailableLifecycle,
    });
  })()`, page.context));

  ok(payload.retainedFrames > 0, "description-only keeps existing frames");
  equal(payload.requiredFrames, 0, "description-only requires no frame unit");
  equal(payload.facts.requiredFrameCount, 0, "stage facts carry zero required frames for description-only intent");
  equal(payload.frames.optional, true, "Frames stage projects the no-frame route");
  equal(payload.motion.availability, "available", "Motion is available without frame Canon");
  equal(payload.action, "produce-motion", "next action advances to Motion");
  ok(payload.frameMarkup.includes('data-frames-not-required="1"'), "Shot Intent surface says Frames are not required");
  ok(!payload.panel.includes("guided-motion-card locked"), "Motion workspace is not frame-locked");
  ok(payload.panel.includes("NO FRAMES NEEDED"), "Motion workspace wording agrees with the route");
  ok(payload.unavailableLifecycle.includes("UNAVAILABLE"), "lifecycle card states when canonical readiness is unavailable");
  ok(payload.unavailableLifecycle.includes("Readiness unavailable"), "unavailable lifecycle card projects no media-derived action");
  ok(!payload.unavailableLifecycle.includes(">Add motion<"), "readiness failure cannot revive the old Add motion answer");
}

async function firstLastMissingEndpoint() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.deliveryRoute = "flf";
  shot.characters = [];
  shot.codes = [];
  shot.creationBrief = {};
  shot.clips = [];
  shot.keyframes = [shot.keyframes[0]];

  const page = await render("#/shot/L1-01", project);
  const payload = JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const facts = shotStageModelFacts(shot, takesFor(shot.id));
    const frames = shotStageState("frames", facts);
    const motion = shotStageState("motion", facts);
    const motionUnit = readiness.units.find((unit) => unit.kind === "motion" && unit.required);
    return JSON.stringify({ facts, frames, motion, motionUnit, panel: guidedMotionPanel(shot, null, takesFor(shot.id)) });
  })()`, page.context));

  equal(payload.facts.requiredFrameCount, 2, "first-plus-last stage facts retain both declared endpoints when one record is absent");
  equal(payload.facts.requiredFramesApproved, false, "an absent closing endpoint cannot be erased by an empty-array every check");
  equal(payload.frames.optional, false, "Frames remains required for first-plus-last intent");
  equal(payload.motion.availability, "blocked", "Motion remains blocked while the closing endpoint is absent");
  ok(payload.motionUnit.requirements.some((row) => row.id === "route-input:last-frame" && row.state === "missing"),
    "canonical readiness represents the absent closing endpoint explicitly");
  ok(payload.panel.includes("guided-motion-card locked"), "Motion workspace projects the missing-endpoint blocker");
}

function entityCanonEntries() {
  return [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ];
}

async function actionableNextActionPanels() {
  const project = withCanon(buildFixture(), entityCanonEntries());
  const shot = project.shots[0];
  shot.creationBrief = { deliveryIntent: "still" };
  shot.clips = [];

  const page = await render("#/shot/L1-01", project, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  const payload = await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const cases = [
      ["produce-motion", "motion", "motion"],
      ["produce-frame", "frames", "still"],
      ["approve-parent-frame", "frames", "still"],
      ["approve-required-frames", "frames", "still"],
      ["nothing-outstanding", "deliver", "finish"],
      ["confirm-existing-reference", "inputs", "inputs"],
    ].map(([code, expectedStage, expectedPanel]) => {
      const row = { nextAction: { code } };
      const stage = shotReadinessTargetStage(row);
      const panel = shotReadinessTargetPanel(row);
      return { code, stage, panel, expectedStage, expectedPanel, resolvedStage: guidedPanelTaskId(panel) };
    });
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    const targetPanel = shotReadinessTargetPanel(readiness);
    const before = boundedShotSelectedTask(shot, takesFor(shot.id));
    await openGuidedPanel(shot.id, targetPanel);
    const after = boundedShotSelectedTask(shot, takesFor(shot.id));
    return { status: readiness.status, action: readiness.nextAction.code, targetPanel, before, after, cases, card };
  })()`, page.context);

  equal(payload.status, "COMPLETE", "precondition: the still-only shot has no outstanding declared unit");
  equal(payload.action, "nothing-outstanding", "complete readiness selects the delivery next action");
  for (const row of payload.cases) {
    equal(row.stage, row.expectedStage, row.code + " resolves to the intended stage identity");
    equal(row.panel, row.expectedPanel, row.code + " resolves to the declared navigation panel");
    equal(row.resolvedStage, row.expectedStage, row.code + " panel resolves back to the same declared stage");
  }
  equal(payload.targetPanel, "finish", "complete-shot NEXT ACTION passes the Deliver panel, not the Deliver stage id");
  equal(payload.after, "deliver", "complete-shot NEXT ACTION selects the Deliver workspace");
  ok(payload.before !== payload.after, "the complete-shot primary action changes the selected workspace");
  ok(payload.card.includes("openGuidedPanel('L1-01','finish')"), "the surfaced primary action is wired to an actionable panel");
  ok(!payload.card.includes("openGuidedPanel('L1-01','deliver')"), "the stage id is never consumed as a panel key");
}

function returnedVideoScan(project) {
  const shotId = project.shots[0].id;
  return {
    anchors: project.characters.filter((row) => row.approvedFile).map((row) => ({ name: row.approvedFile, url: "/assets/anchors/" + row.approvedFile })),
    plates: project.locations.filter((row) => row.approvedFile).map((row) => ({ name: row.approvedFile, url: "/assets/plates/" + row.approvedFile })),
    props: project.props.filter((row) => row.approvedFile).map((row) => ({ name: row.approvedFile, url: "/assets/props/" + row.approvedFile })),
    vehicles: [], audio: [], media: [],
    shots: {
      [shotId]: {
        takes: [
          { name: "FRAME_A.png", url: "/assets/shots/" + shotId + "/takes/FRAME_A.png" },
          { name: "FRAME_B.png", url: "/assets/shots/" + shotId + "/takes/FRAME_B.png" },
          { name: "PAID-RETURN.mp4", url: "/assets/shots/" + shotId + "/takes/PAID-RETURN.mp4", assetId: "asset-paid-return" },
        ],
        locked: [],
      },
    },
  };
}

async function returnedMediaOutlivesGenerationReadiness() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.deliveryRoute = "r2v";
  const scan = returnedVideoScan(project);

  const production = await render("#/production", project, { scan });
  ok(production.html.includes("video candidate to review"), "Production inbox still advertises the returned video");
  ok(production.html.includes("#/shot/L1-01"), "the inbox links the returned video back to its shot");

  const page = await render("#/shot/L1-01", project, { scan });
  const before = vm.runInContext(`(() => {
    const shot = P.shots[0];
    const takes = takesFor(shot.id);
    const readiness = shotReadinessFor(shot);
    const facts = shotStageModelFacts(shot, takes);
    const motion = shotStageState("motion", facts);
    const unit = readiness.units.find((row) => row.kind === "motion" && row.required);
    const panel = guidedMotionPanel(shot, null, takes, true);
    return {
      readinessStatus: readiness.status,
      generationStatus: unit.status,
      generationReason: unit.nextAction.message,
      selectedTask: boundedShotSelectedTask(shot, takes),
      motion,
      panel,
    };
  })()`, page.context);

  equal(before.readinessStatus, "NEEDS_DECISION", "route prerequisite is genuinely unmet after output returned");
  equal(before.generationStatus, "NEEDS_DECISION", "canonical motion unit still blocks new work");
  equal(before.motion.availability, "available", "returned work keeps the Motion review workspace reachable");
  await page.gesture.act(() => page.context.openGuidedPanel("L1-01", "motion"));
  const selectedAfterNavigation = vm.runInContext('boundedShotSelectedTask(P.shots[0], takesFor("L1-01"))', page.context);
  equal(selectedAfterNavigation, "motion", "the available Motion stage reaches the returned-media workspace");
  ok(before.panel.includes('data-generation-readiness="blocked"'), "the review panel states that new generation remains blocked");
  ok(before.panel.includes("PAID-RETURN.mp4"), "the returned provider asset remains visible");
  ok(before.panel.includes("openMediaTheatre"), "the returned provider asset remains inspectable");
  ok(before.panel.includes("APPROVE VIDEO"), "the existing approval owner remains reachable");
  ok(before.panel.includes('id="motion-file"'), "the existing video import/ingest control remains reachable");
  ok(before.panel.includes(before.generationReason), "the canonical generation blocker remains visible");
  ok(!before.panel.includes("Build prompt"), "new prompt creation is not offered while readiness blocks new work");
  ok(!before.panel.includes("openFalH3MotionModal"), "no paid provider action is surfaced through the blocked creation section");

  await page.gesture.act(() => page.context.approveGuidedMotion("L1-01", "PAID-RETURN.mp4"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = vm.runInContext(`(() => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const unit = readiness.units.find((row) => row.kind === "motion" && row.required && !row.complete)
      || readiness.units.find((row) => row.kind === "motion" && row.required);
    const receipt = (P.productionAuthority?.receipts || []).find((row) => row.kind === "shot-motion" && row.value === "PAID-RETURN.mp4" && row.status === "current");
    const panel = guidedMotionPanel(shot, guidedApprovedMotion(shot, takesFor(shot.id)), takesFor(shot.id), true);
    return {
      approvedFile: (shot.clips || []).map((row) => row.videoWinner).find(Boolean) || ensureShotCreation(shot).approvedMotionFile,
      receipt: !!receipt,
      generationStatus: unit.status,
      panel,
    };
  })()`, page.context);

  equal(after.approvedFile, "PAID-RETURN.mp4", "the existing motion approval owner accepts the returned asset");
  equal(after.receipt, true, "approval establishes receipt-backed motion Canon");
  ok(["BLOCKED", "NEEDS_DECISION"].includes(after.generationStatus), "approval does not erase the unmet prerequisite for additional generation");
  ok(after.panel.includes("PAID-RETURN.mp4") && after.panel.includes("APPROVED"), "approved returned media remains reachable");
  ok(after.panel.includes('data-generation-readiness="blocked"'), "new generation remains blocked after reviewing and approving returned media");
}

async function main() {
  await blockedShotConsumers();
  await descriptionOnlyConsumers();
  await firstLastMissingEndpoint();
  await actionableNextActionPanels();
  await returnedMediaOutlivesGenerationReadiness();
  console.log(`shot-truth-cohesion: ${checks} assertions passed`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

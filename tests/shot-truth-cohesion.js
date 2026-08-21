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
function deepEqual(actual, expected, message) {
  checks += 1;
  assert.deepStrictEqual(actual, expected, message);
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
    const cases = READINESS_NEXT_ACTIONS.map((code) => {
      const row = { nextAction: { code } };
      const destination = shotReadinessTargetDestination(row);
      const stage = shotReadinessTargetStage(row);
      const panel = shotReadinessTargetPanel(row);
      const route = shotReadinessTargetRoute(row);
      return {
        code, destinationId: destination?.destinationId || "", stage, panel, route,
        navigationKind: destination?.navigation?.kind || "", surface: destination?.surface || "",
        renderer: destination?.renderer || "", control: destination?.control || "", resolvedStage: guidedPanelTaskId(panel),
      };
    });
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    const targetPanel = shotReadinessTargetPanel(readiness);
    const before = boundedShotSelectedTask(shot, takesFor(shot.id));
    await openShotReadinessAction(shot.id, readiness.nextAction.code);
    const after = boundedShotSelectedTask(shot, takesFor(shot.id));
    const unknownBefore = { hash: location.hash, selected: after };
    openShotReadinessAction(shot.id, "unknown-readiness-action");
    const unknownAfter = { hash: location.hash, selected: boundedShotSelectedTask(shot, takesFor(shot.id)) };
    const projectScopedBefore = { ...unknownAfter };
    openShotReadinessAction(shot.id, "repair-authority-ledger");
    const projectScopedAfter = { hash: location.hash, selected: boundedShotSelectedTask(shot, takesFor(shot.id)) };
    const routedCases = [];
    for (const item of cases.filter((row) => row.destinationId)) {
      location.hash = '#/shot/' + shot.id;
      boundedWriteFocusedTask(SHOT_STAGE_SCOPE, shot.id, 'look');
      await openShotReadinessAction(shot.id, item.code);
      routedCases.push({ code: item.code, hash: location.hash, selected: boundedShotSelectedTask(shot, takesFor(shot.id)) });
    }
    return {
      status: readiness.status, action: readiness.nextAction.code, targetPanel, before, after, cases, routedCases,
      actionVocabulary: [...READINESS_NEXT_ACTIONS],
      declaredVocabulary: [...SHOT_READINESS_ACTION_DESTINATIONS.map((row) => row.code), ...NON_SHOT_READINESS_ACTIONS],
      declaredActionability: cases.filter((row) => row.renderer || row.control).map((row) => {
        let rendererAvailable = false, controlAvailable = false, rendererUsesControl = false;
        try {
          const renderer = eval(row.renderer), control = eval(row.control);
          rendererAvailable = typeof renderer === "function";
          controlAvailable = typeof control === "function";
          rendererUsesControl = rendererAvailable && controlAvailable
            && (row.renderer === row.control || Function.prototype.toString.call(renderer).includes(row.control));
        } catch {}
        return { code: row.code, renderer: row.renderer, control: row.control, rendererAvailable, controlAvailable, rendererUsesControl };
      }),
      unknownBefore, unknownAfter, projectScopedBefore, projectScopedAfter, unknownDestination: shotReadinessDestinationForAction("unknown-readiness-action"), card,
    };
  })()`, page.context);

  equal(payload.status, "COMPLETE", "precondition: the still-only shot has no outstanding declared unit");
  equal(payload.action, "nothing-outstanding", "complete readiness selects the delivery next action");
  deepEqual([...payload.declaredVocabulary].sort(), [...payload.actionVocabulary].sort(),
    "declared destinations plus explicit project-only exceptions exhaust the canonical NEXT ACTION vocabulary");
  equal(new Set(payload.declaredVocabulary).size, payload.declaredVocabulary.length,
    "every canonical action is owned by exactly one destination/scope declaration");
  for (const row of payload.cases) {
    if (row.code === "repair-authority-ledger") {
      equal(row.destinationId, "", "the project-only repair action is explicitly not a shot-local destination");
      continue;
    }
    ok(row.destinationId, row.code + " has an explicit declared destination");
    ok(["task-selection", "route"].includes(row.navigationKind), row.code + " has a supported navigation kind");
    ok(row.surface, row.code + " names the destination surface that exposes its work");
    ok(row.renderer, row.code + " names the renderer that exposes its work");
    ok(row.control, row.code + " names the concrete control rendered on that surface");
    const actionability = payload.declaredActionability.find((item) => item.code === row.code);
    ok(actionability?.rendererAvailable, row.code + " names a renderer present in the shipped composition");
    ok(actionability?.controlAvailable, row.code + " names a control present in the shipped composition");
    ok(actionability?.rendererUsesControl,
      row.code + " renderer actually includes its declared control (a mapping to a disconnected function fails)");
    const routed = payload.routedCases.find((item) => item.code === row.code);
    if (row.navigationKind === "task-selection") {
      ok(row.stage && row.panel, row.code + " declares distinct stage and panel identities");
      equal(row.destinationId, row.stage, row.code + " stage is the declared destination");
      equal(row.resolvedStage, row.stage, row.code + " panel resolves back to the same declared stage");
      equal(routed?.selected, row.stage, row.code + " generic router selects its declared stage");
    } else {
      equal(row.stage, "", row.code + " does not invent a shot stage for a route destination");
      equal(row.panel, "", row.code + " does not invent a panel for a route destination");
      ok(row.route.startsWith("#/"), row.code + " has an explicit application route");
      equal(routed?.hash, row.route, row.code + " generic router opens its declared route");
      equal(routed?.selected, "look", row.code + " route navigation does not counterfeit a shot-stage selection");
    }
  }
  equal(payload.targetPanel, "finish", "complete-shot NEXT ACTION passes the Deliver panel, not the Deliver stage id");
  equal(payload.after, "deliver", "complete-shot NEXT ACTION selects the Deliver workspace");
  ok(payload.before !== payload.after, "the complete-shot primary action changes the selected workspace");
  ok(payload.card.includes("openShotReadinessAction('L1-01','nothing-outstanding')"), "the surfaced primary action delegates to the declared action router");
  ok(!payload.card.includes("openGuidedPanel('L1-01','deliver')"), "the stage id is never consumed as a panel key");
  equal(payload.unknownDestination, null, "an unknown action has no declared destination");
  deepEqual(payload.unknownAfter, payload.unknownBefore, "an unknown action changes neither route nor selected stage");
  deepEqual(payload.projectScopedAfter, payload.projectScopedBefore, "the project-only repair action changes neither route nor selected stage");

  /* A malformed frame-presence declaration is a frame-local decision. Its primary
     action must render the Frames workspace where setFramePresence() can repair it,
     not the default Inputs panel that cannot perform the advertised action. */
  const malformedProject = buildFixture();
  delete malformedProject.productionAuthority;
  withCanon(malformedProject, entityCanonEntries());
  const malformedShot = malformedProject.shots[0];
  malformedShot.creationBrief = malformedShot.creationBrief || {};
  malformedShot.creationBrief.frameWorkflows = {
    "frame-a": { entityPresence: { KAI: { state: "absent" } } },
  };
  const malformedPage = await render("#/shot/L1-01", malformedProject, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  const malformed = await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const targetStage = shotReadinessTargetStage(readiness);
    const targetPanel = shotReadinessTargetPanel(readiness);
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    const before = boundedShotSelectedTask(shot, takesFor(shot.id));
    await openShotReadinessAction(shot.id, readiness.nextAction.code);
    const html = document.getElementById("main").innerHTML;
    return {
      status: readiness.status,
      action: readiness.nextAction.code,
      targetStage,
      targetPanel,
      before,
      after: boundedShotSelectedTask(shot, takesFor(shot.id)),
      card,
      presenceControlVisible: html.includes("frame-presence-panel"),
      presenceWriterVisible: html.includes("setFramePresence("),
      inputsVisible: html.includes('data-guided-panel="inputs"'),
    };
  })()`, malformedPage.context);
  equal(malformed.status, "NEEDS_DECISION", "malformed frame presence is a canonical readiness decision");
  equal(malformed.action, "repair-presence-declaration", "readiness emits the established presence-repair action");
  equal(malformed.targetStage, "frames", "presence repair resolves to the declared Frames stage");
  equal(malformed.targetPanel, "still", "presence repair resolves to the Frames stage's declared panel identity");
  equal(malformed.before, "look", "precondition: a different workspace is selected before the primary action");
  equal(malformed.after, "frames", "clicking the surfaced action selects the Frames workspace");
  ok(malformed.card.includes("openShotReadinessAction('L1-01','repair-presence-declaration')"), "the surfaced presence action delegates to the declared action router");
  ok(malformed.presenceControlVisible, "the selected destination exposes the frame-presence repair control");
  ok(malformed.presenceWriterVisible, "the repair control is wired to setFramePresence");
  ok(!malformed.inputsVisible, "the presence action no longer falls through to Inputs");
}


async function historicReadinessActionsReachProduction() {
  /* Historic pointers are already visible bytes. Their canonical action is the
     explicit Production confirmation, not an Inputs toggle or a replacement job. */
  const historicProject = buildFixture();
  historicProject.shots[0].deliveryRoute = "r2v";
  const historicPage = await render("#/shot/L1-01", historicProject, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  const historic = await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const destination = shotReadinessTargetDestination(readiness);
    const before = boundedShotSelectedTask(shot, takesFor(shot.id));
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    await openShotReadinessAction(shot.id, readiness.nextAction.code);
    await route();
    const html = document.getElementById("main").innerHTML;
    const item = projectShotReadiness().historic.items[0];
    return {
      status: readiness.status, action: readiness.nextAction.code,
      destinationId: destination?.destinationId || "", route: destination?.navigation?.route || "",
      hash: location.hash, before, after: boundedShotSelectedTask(shot, takesFor(shot.id)), card,
      key: item?.key || "", inputsVisible: html.includes('data-guided-panel="inputs"'),
      surfaceVisible: html.includes('data-readiness-action-surface="production-historic-confirmation"'),
      controlVisible: html.includes("confirmHistoricSelection("),
    };
  })()`, historicPage.context);
  equal(historic.status, "NEEDS_DECISION", "historic pointer precondition needs a decision");
  equal(historic.action, "confirm-existing-reference", "readiness emits the historic confirmation action");
  equal(historic.destinationId, "production", "historic confirmation has the declared Production destination");
  equal(historic.route, "#/production", "historic confirmation owns the existing Production route");
  equal(historic.hash, "#/production", "the surfaced historic action navigates to Production");
  equal(historic.after, historic.before, "route navigation does not silently select Inputs");
  ok(!historic.inputsVisible, "Production does not render the incorrect Inputs panel");
  ok(historic.surfaceVisible, "Production renders the declared historic-confirmation surface");
  ok(historic.controlVisible, "Production exposes confirmHistoricSelection");
  ok(historic.card.includes("openShotReadinessAction('L1-01','confirm-existing-reference')"),
    "the historic primary action delegates to the declared router");
  ok(historic.key, "the Production confirmation queue exposes the affected authority target");

  await historicPage.gesture.act(() => historicPage.context.confirmHistoricSelection(historic.key));
  await new Promise((resolve) => setTimeout(resolve, 25));
  const historicAfter = vm.runInContext(`(() => ({
    stillQueued: projectShotReadiness().historic.items.some((item) => item.key === ${JSON.stringify(historic.key)}),
    currentReceipt: (P.productionAuthority?.receipts || []).some((row) => row.targetKey === ${JSON.stringify(historic.key)} && row.status === "current"),
  }))()`, historicPage.context);
  equal(historicAfter.stillQueued, false, "using the visible confirmation control removes that Historic decision");
  equal(historicAfter.currentReceipt, true, "the visible control writes receipt-backed Canon through the existing owner");

  /* A retained pointer whose receipt was withdrawn uses the same Production control,
     but readiness keeps its distinct reapproval action and reason. */
  const revokedProject = withCanon(buildFixture(), entityCanonEntries());
  revokedProject.shots[0].deliveryRoute = "r2v";
  const revokedPage = await render("#/shot/L1-01", revokedProject, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  await revokedPage.gesture.act(() => vm.runInContext(`revokeEntityStateCanon(P, {
    list: "characters", entityId: "KAI", stateId: "state-default", reason: "withdrawn",
    at: "2026-08-21T00:00:00.000Z", clearEdge: false,
  })`, revokedPage.context));
  const revoked = await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const destination = shotReadinessTargetDestination(readiness);
    const before = boundedShotSelectedTask(shot, takesFor(shot.id));
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    await openShotReadinessAction(shot.id, readiness.nextAction.code);
    await route();
    const html = document.getElementById("main").innerHTML;
    const item = projectShotReadiness().historic.items.find((row) => row.target?.entityId === "KAI");
    return {
      status: readiness.status, action: readiness.nextAction.code,
      destinationId: destination?.destinationId || "", route: destination?.navigation?.route || "",
      hash: location.hash, before, after: boundedShotSelectedTask(shot, takesFor(shot.id)), card,
      key: item?.key || "", inputsVisible: html.includes('data-guided-panel="inputs"'),
      surfaceVisible: html.includes('data-readiness-action-surface="production-historic-confirmation"'),
      controlVisible: html.includes("confirmHistoricSelection("),
    };
  })()`, revokedPage.context);
  equal(revoked.status, "NEEDS_DECISION", "retained revoked pointer precondition needs a decision");
  equal(revoked.action, "reapprove-revoked-reference", "readiness emits the distinct reapproval action");
  equal(revoked.destinationId, "production", "revoked-reference reapproval has the declared Production destination");
  equal(revoked.route, "#/production", "revoked-reference reapproval owns the existing Production route");
  equal(revoked.hash, "#/production", "the surfaced reapproval action navigates to Production");
  equal(revoked.after, revoked.before, "reapproval route navigation does not silently select Inputs");
  ok(!revoked.inputsVisible, "reapproval does not render the incorrect Inputs panel");
  ok(revoked.surfaceVisible, "Production renders the declared reapproval surface");
  ok(revoked.controlVisible, "Production exposes the reapproval confirmation control");
  ok(revoked.card.includes("openShotReadinessAction('L1-01','reapprove-revoked-reference')"),
    "the reapproval primary action delegates to the declared router");
  ok(revoked.key, "the Production queue exposes the withdrawn authority target");

  await revokedPage.gesture.act(() => revokedPage.context.confirmHistoricSelection(revoked.key));
  await new Promise((resolve) => setTimeout(resolve, 25));
  const revokedAfter = vm.runInContext(`(() => ({
    stillQueued: projectShotReadiness().historic.items.some((item) => item.key === ${JSON.stringify(revoked.key)}),
    currentReceipt: (P.productionAuthority?.receipts || []).some((row) => row.targetKey === ${JSON.stringify(revoked.key)} && row.status === "current"),
  }))()`, revokedPage.context);
  equal(revokedAfter.stillQueued, false, "using the visible reapproval control removes the revoked decision");
  equal(revokedAfter.currentReceipt, true, "reapproval writes a new current Canon receipt through the existing owner");

  /* A corrupt project ledger is one project repair. Its shot projection is still
     shot-local routing input, but the declared destination is the project-wide
     Production diagnostic rather than a fabricated shot panel. */
  const brokenProject = buildFixture();
  brokenProject.productionAuthority = { version: 1, receipts: [{ id: "broken" }] };
  const brokenPage = await render("#/shot/L1-01", brokenProject);
  const broken = await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const destination = shotReadinessTargetDestination(readiness);
    await openShotReadinessAction(shot.id, readiness.nextAction.code);
    await route();
    return {
      action: readiness.nextAction.code, destinationId: destination?.destinationId || "",
      route: destination?.navigation?.route || "", hash: location.hash,
      surfaceVisible: document.getElementById("main").innerHTML.includes('data-readiness-action-surface="production-project-repair"'),
    };
  })()`, brokenPage.context);
  equal(broken.action, "awaiting-project-repair", "a shot blocked by project truth emits only the waiting projection");
  equal(broken.destinationId, "production", "the waiting projection has the declared Production destination");
  equal(broken.route, "#/production", "the waiting projection uses the existing Production route");
  equal(broken.hash, "#/production", "the waiting projection navigates to Production");
  ok(broken.surfaceVisible, "Production renders the project repair diagnostic named by the destination contract");
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
  await historicReadinessActionsReachProduction();
  await returnedMediaOutlivesGenerationReadiness();
  console.log(`shot-truth-cohesion: ${checks} assertions passed`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

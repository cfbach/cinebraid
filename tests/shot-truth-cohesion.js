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
/* EV2-7 B2.2: the board's filters are the options of one Show selector, and each option
   carries its filter id and canonical count as data. The count is read off that hook AND
   must be the number the option shows a filmmaker, so the hook cannot drift from the words. */
function countForFilter(markup, id) {
  const option = new RegExp(`<option\\b([^>]*\\bdata-board-filter="${id}"[^>]*)>([^<]*)</option>`).exec(markup);
  const count = option ? (option[1].match(/\bdata-count="(\d+)"/) || [])[1] : undefined;
  return count !== undefined && option[2].endsWith(` · ${count}`) ? Number(count) : -1;
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

  /* The card's next-action line and its one reason, read as the elements a filmmaker sees:
     where readiness leads, they are the canonical action and explanation word for word. */
  const boardNext = /<span class="slate-next ([^"]*)"([^>]*)>([^<]*)<\/span>\s*<span class="slate-reason"[^>]*>([^<]*)<\/span>/.exec(payload.board) || [];
  const text = (value) => String(value || "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  equal((/data-leading-source="([^"]*)"/.exec(boardNext[2] || "") || [])[1], "readiness", "precondition: canonical readiness leads this board card");
  equal(text(boardNext[3]), payload.local.label, "board card's next-action line renders the canonical action");
  equal(text(boardNext[4]), payload.local.detail, "board card renders the canonical explanation as its one reason");
  ok(payload.board.includes(payload.local.label), "board card renders the canonical action");
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
  /* THE PANEL DECLARES THE BLOCK; the shell it uses to say so is not the claim. A shot
     carrying retained motion work now renders that work READ-ONLY instead of an empty
     locked shell, because being unable to make new motion is not a reason to hide the
     motion direction already written. Both shapes must still refuse production, so the
     refusal is what is asserted, and it is asserted twice as hard as the class name was. */
  ok(/guided-motion-card locked|data-generation-readiness="blocked"/.test(payload.panel),
    "Motion workspace agrees with stage availability");
  ok(!/buildGuidedMotionPrompt|falH3MotionPromptAction|approveGuidedMotion/.test(payload.panel),
    "and a blocked Motion workspace offers no control that would produce motion");
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
  /* EV2-7 dogfood correction: the stage bodies read in sentence case. The words are the
     same words; only the shouting is gone. */
  ok(payload.panel.includes("No frames needed"), "Motion workspace wording agrees with the route");
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

  /* The still-only shot has no outstanding declared unit AND has not been marked
     final, which is the state this fixture has always been in — what changed is that
     readiness now says so. Both codes land on the same Deliver panel, so the
     destination claims below are unaffected; only the word the filmmaker reads is. */
  equal(payload.status, "NEEDS_DECISION", "precondition: no outstanding declared unit, and the shot is not final yet");
  equal(payload.action, "mark-shot-final", "an approved-but-unfinished shot selects the delivery decision, not a completion claim");
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
  equal(payload.targetPanel, "finish", "the delivery NEXT ACTION passes the Deliver panel, not the Deliver stage id");
  equal(payload.after, "deliver", "the delivery NEXT ACTION selects the Deliver workspace");
  ok(payload.before !== payload.after, "the delivery primary action changes the selected workspace");
  ok(payload.card.includes("openShotReadinessAction('L1-01','mark-shot-final')"), "the surfaced primary action delegates to the declared action router");
  ok(!payload.card.includes("Nothing outstanding"), "and an approved-but-unfinished shot never claims nothing is outstanding");
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

/* ===========================================================================
   EV2-7 — THE RESULTS SEAM, AS THE PRODUCT MOUNTS IT.

   Approving a frame or a returned video is done in Results. The Shot Desk exposes that
   work through its Results rail, above every stage. A claim that the work is reachable
   is only worth something when the RENDERED control is followed: so these cases read the
   rail out of #main, run the call that control carries, route to the exact address it
   names with the shipped public/results-desk.js run into the same realm (the harness
   does not load it), and press the rendered Results control through the listener
   results-desk.js registered — which is what reaches the shipped confirmation and its
   writer. The return trail is public/media-return.js's and is proven elsewhere, so
   open() here records the exact scope and key and goes to the same address without it.
   =========================================================================== */
const { harnessAssetId } = require("./render-harness");
const { memoryStore, confirmationDOM, confirmDecision, settleOwedWrites } = require("./helpers/result-confirmation");
const readProjectFile = (file) => require("fs").readFileSync(require("path").join(__dirname, "..", file), "utf8");
const mainOf = (page) => page.context.document.getElementById("main").innerHTML;
function mountResults(page) {
  const before = (page.documentListeners.get("click") || []).length;
  vm.runInContext(readProjectFile("public/results-desk.js"), page.context, { filename: "results-desk.js" });
  const clicks = page.documentListeners.get("click") || [];
  const listener = clicks[before];
  assert.strictEqual(typeof listener, "function", "probe receipt: results-desk.js must register its own click listener");
  /* The harness opens a gesture with a target-less trusted click to every listener; a
     browser click always has a target, so only those reach Results. */
  clicks[before] = (event) => (event && event.target ? listener(event) : undefined);
  const opened = [];
  page.context.CineBraidResults.open = (scope, key = "") => {
    opened.push({ scope: { ...scope }, key });
    page.context.location.hash = page.context.CineBraidResults.href(scope, key);
    return page.context.route();
  };
  return { listener, opened };
}
function resultsOf(html) {
  const control = (id) => (html.match(new RegExp(`<button[^>]*data-rx="${id}"[^>]*>`)) || [""])[0];
  return {
    desk: html.includes("data-results-desk"),
    control,
    authorityOf: (id) => (control(id).match(/data-rx-authority="([a-z]*)"/) || [])[1] || "",
    selected: ((html.match(/data-rx-key="([^"]+)" aria-pressed="true"/) || [])[1] || "").replace(/&amp;/g, "&"),
  };
}
async function pressResults(page, seam, id) {
  assert(resultsOf(mainOf(page)).control(id), `the rendered Results page must offer the ${id} control`);
  const target = { closest: (selector) => (selector === "[data-rx-job]" ? null : { dataset: { rx: id }, hasAttribute: (name) => name === "data-rx" }) };
  /* Approve settles when the shipped confirmation has checked its save context and says so
     in its status line, or asks which motion unit; the status is cleared first so an
     earlier answer cannot count. Any other press settles once its repaint has run. */
  const statusLine = page.context.document.getElementById("rx-confirm-status");
  statusLine.textContent = "";
  page.gesture.act(() => seam.listener({ type: "click", isTrusted: true, target }));
  for (let i = 0; i < 200; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const modal = page.context.document.getElementById("modal").innerHTML;
    if (id !== "approve" ? i >= 4 : statusLine.textContent !== "" || modal.includes("rx-motion-target")) break;
  }
}
/* A fixture that is going to SAVE declares its entities' default states up front, the
   way tests/readiness-action-projection.js does; the write seam refuses a save that would
   introduce them. Setup data, not authority. */
function saveableProject(project) {
  for (const list of ["characters", "locations", "props"])
    for (const entity of project[list] || [])
      if (!entity.continuityStates?.length)
        entity.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: entity.approvedFile || "", notes: "" }];
  return project;
}
const rendersRail = (html) => (html.match(/<section class="shot-results-rail[\s\S]*?<\/section>/) || [""])[0];

/* ===========================================================================
   EV2-7 — FRAME APPROVAL THAT READINESS OWES IS DONE THROUGH THE RESULTS RAIL.

   public/shared-stage-model.js declares that approve-parent-frame and
   approve-required-frames land on the Frames stage and are exposed by the Results rail's
   exact Frame Results entry (shotResultsTargetMarkup → openShotResults). The generic
   completeness check above proves the names resolve and that the renderer's source
   includes the control. This proves the rest, for a shot readiness genuinely says owes
   those approvals: the declared router selects the declared stage, the rail is RENDERED
   there with the entry for the frame that is owed, pressing it opens that frame's exact
   Results with the exact waiting result, and approving there reaches the shipped
   confirmation and writer — after which readiness stops owing it.
   =========================================================================== */
async function frameApprovalReadinessReachesResults() {
  const project = buildFixture();
  const shot = project.shots[0];
  project.productionAuthority = { version: 1, receipts: [] };
  shot.winner = "";
  for (const frame of shot.keyframes) frame.winner = "";
  shot.deliveryRoute = "flf";
  shot.candidateFiles = [{ stored: "FRAME_A.png", original: "FRAME_A.png", frameId: "frame-a", decision: "unreviewed", notes: "", labels: [], addedAt: "2026-08-20T10:00:00.000Z", generationJobId: "job-frame-a", generationProvider: "fal", generationModel: "gpt-image-2" }];
  saveableProject(withCanon(project, entityCanonEntries()));
  const assetId = harnessAssetId("shots/L1-01/takes/FRAME_A.png");
  const scan = returnedVideoScan(project);
  scan.shots["L1-01"].takes = [{ name: "FRAME_A.png", url: "/assets/shots/L1-01/takes/FRAME_A.png", assetId }];
  const store = memoryStore(project);
  const page = await render("#/shot/L1-01", project, { scan, fetch: store.fetch, storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" } });
  const owedCodes = () => vm.runInContext(`(() => { const units = shotReadinessFor(P.shots[0]).units;
    return JSON.stringify({ parent: units.find((row) => row.id === "frame:frame-b").nextAction.code, motion: units.find((row) => row.kind === "motion" && row.required).nextAction.code,
      key: (returnedReviewProjectionForBrowser().queue.find((row) => row.candidate.name === "FRAME_A.png") || {}).key || "" }); })()`, page.context);
  const owed = JSON.parse(owedCodes());
  equal(owed.parent, "approve-parent-frame", "precondition: readiness says Frame A must be approved before Frame B");
  equal(owed.motion, "approve-required-frames", "precondition: and that motion waits on the required frames' approval");
  ok(owed.key, "precondition: Frame A's returned result is waiting for a decision");

  for (const code of ["approve-parent-frame", "approve-required-frames"]) {
    const destination = JSON.parse(vm.runInContext(`JSON.stringify(shotReadinessDestinationForAction(${JSON.stringify(code)}))`, page.context));
    equal(destination.renderer, "shotResultsTargetMarkup", `${code}: declares the Results rail's target renderer`);
    equal(destination.control, "openShotResults", `${code}: and its exact Results handoff as the control`);
    vm.runInContext(`location.hash = "#/shot/L1-01"; boundedWriteFocusedTask(SHOT_STAGE_SCOPE, "L1-01", "look");`, page.context);
    await page.context.route();
    await vm.runInContext(`openShotReadinessAction("L1-01", ${JSON.stringify(code)})`, page.context);
    const html = mainOf(page);
    equal(vm.runInContext(`boundedShotSelectedTask(P.shots[0], takesFor("L1-01"))`, page.context), "frames", `${code}: the declared router selects the Frames stage`);
    ok(html.includes('data-bounded-task="frames"'), `${code}: which is the stage rendered`);
    const rail = rendersRail(html);
    /* EV2-7 dogfood correction — ONE ACTION PER RESULT TARGET. Frame A's returned result is
       waiting, so the hero leads with it and the hero's exact-key review IS Frame A's one
       action; the rail keeps Frame A's card, its count and its Approved state, and says in
       words that the target is being handled above rather than offering a second button
       onto the same Results. The declared destination's own control is exercised below,
       where nothing is waiting any more. */
    const entry = [...rail.matchAll(/<button[^>]*onclick="([^"]*)"[^>]*>Frame A Results<\/button>/g)].map((match) => match[1]);
    deepEqual(entry, [], `${code}: no second Frame A Results button while the hero leads that exact result`);
    const frameA = (rail.match(/<article class="shot-results-target" data-results-target="frame" data-frame-id="frame-a"[\s\S]*?<\/article>/) || [""])[0];
    ok(/data-results-led="1"/.test(frameA) && frameA.includes("Being reviewed above") && !/<button/.test(frameA),
      `${code}: the rail states where Frame A's one action is: ${frameA}`);
    const heroAction = (html.match(/class="assemble-btn shot-primary-action"[^>]*onclick="([^"]*)"[^>]*>([^<]*)/) || []).slice(1);
    deepEqual(heroAction, [`openReturnedResultReview('L1-01','${owed.key}')`, "Review Frame A result"],
      `${code}: and that action opens the owed frame's exact returned result`);
    ok(html.indexOf("shot-results-rail") < html.indexOf("guided-work-stack"), `${code}: above the stage's own work, where it is reached before anything collapsed`);
    ok(/data-frame-id="frame-a"[^>]*data-results-waiting="1"[^>]*data-results-approved="none"/.test(rail), `${code}: stating one waiting result and no Approved image yet`);
  }

  const seam = mountResults(page);
  await vm.runInContext("openShotResults('L1-01','frame','frame-a')", page.context);
  deepEqual(seam.opened, [{ scope: { shotId: "L1-01", kind: "frame", frameId: "frame-a" }, key: owed.key }],
    "pressing the rendered entry opens Frame A's exact Results with the exact waiting result");
  const results = resultsOf(mainOf(page));
  equal(results.selected, owed.key, "Results selects that result");
  equal(results.authorityOf("approve"), "decision", "and offers its approval as a declared decision");
  await confirmDecision(page, confirmationDOM(page), ["L1-01", "FRAME_A.png", "frame", "frame-a"], store, () => pressResults(page, seam, "approve"));

  vm.runInContext(`location.hash = "#/shot/L1-01";`, page.context);
  await page.context.route();
  const paid = JSON.parse(owedCodes());
  ok(paid.parent !== "approve-parent-frame", "approving Frame A through Results pays the approval readiness owed: " + paid.parent);
  ok(/data-frame-id="frame-a"[^>]*data-results-approved="retained"/.test(rendersRail(mainOf(page)))
    && /Approved image<\/small><small class="shot-results-name">FRAME_A\.png<\/small>/.test(rendersRail(mainOf(page))),
    "and the rail keeps the approved Frame A in view");
  /* With nothing waiting for that target any more, its one named entry is the rail's own
     again — the declared destination's renderer and control, rendered and callable. */
  deepEqual([...rendersRail(mainOf(page)).matchAll(/<button[^>]*onclick="([^"]*)"[^>]*>Frame A Results<\/button>/g)].map((match) => match[1]),
    ["openShotResults('L1-01','frame','frame-a')"],
    "and Frame A's named Results entry returns once its returned result has been decided");
}

async function returnedMediaOutlivesGenerationReadiness() {
  const project = saveableProject(buildFixture());
  const shot = project.shots[0];
  shot.deliveryRoute = "r2v";
  const scan = returnedVideoScan(project);

  const production = await render("#/production", project, { scan });
  ok(production.html.includes("video candidate to review"), "Production inbox still advertises the returned video");
  ok(production.html.includes("#/shot/L1-01"), "the inbox links the returned video back to its shot");

  const store = memoryStore(project);
  const page = await render("#/shot/L1-01", project, { scan, fetch: store.fetch });
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
  /* EV2-7 B2.13: NO WALL OF PLAYERS. Playing, comparing and approving a returned video
     happen in Results/Screening; the Motion stage keeps import, history and the reason. */
  ok(!/<video\b/.test(before.panel) && !before.panel.includes("APPROVE VIDEO") && !before.panel.includes("SEND TO FINISHING"),
    "the Motion stage draws no per-result player, approval or finishing control of its own");
  ok(before.panel.includes("1 video returned to this shot"), "it states how many returned videos Results holds");
  ok(before.panel.includes('id="motion-file"'), "the existing video import/ingest control remains reachable");
  ok(before.panel.includes(before.generationReason), "the canonical generation blocker remains visible");
  ok(!before.panel.includes("Build prompt"), "new prompt creation is not offered while readiness blocks new work");
  ok(!before.panel.includes("openFalH3MotionModal"), "no paid provider action is surfaced through the blocked creation section");

  /* THE RETURNED VIDEO IS REACHED THROUGH THE ONE RESULTS RAIL, BY ITS EXACT KEY. */
  const desk = mainOf(page);
  ok(desk.includes('data-bounded-task="motion"'), "precondition: the Motion stage is the one rendered");
  /* EV2-7 dogfood correction — ONE ACTION FOR THIS TARGET. The returned video is what the
     hero leads with, so the Desk's one way into Motion Results is the hero's exact-key
     review; the rail keeps the Motion card, its count and its Approved state, and says the
     target is being handled above rather than repeating the entry under another name. */
  const motionEntry = [...desk.matchAll(/<button[^>]*onclick="([^"]*)"[^>]*>Motion Results<\/button>/g)].map((match) => match[1]);
  deepEqual(motionEntry, [], "no second Motion Results button while the hero leads that returned video");
  const motionTarget = (rendersRail(desk).match(/<article class="shot-results-target" data-results-target="motion"[\s\S]*?<\/article>/) || [""])[0];
  ok(/data-results-waiting="1"/.test(motionTarget) && /No Approved motion · 1 new candidate/.test(motionTarget),
    "the rail counts the returned video and states that no motion is Approved yet: " + motionTarget);
  ok(/data-results-led="1"/.test(motionTarget) && motionTarget.includes("Being reviewed above") && !/<button/.test(motionTarget),
    "and says where its one action is: " + motionTarget);
  const paidKey = vm.runInContext(`returnedReviewProjectionForBrowser().queue.find((row) => row.candidate.name === "PAID-RETURN.mp4").key`, page.context);
  const heroMotion = (desk.match(/class="assemble-btn shot-primary-action"[^>]*onclick="([^"]*)"[^>]*>([^<]*)/) || []).slice(1);
  deepEqual(heroMotion, [`openReturnedResultReview('L1-01','${paidKey}')`, "Review motion result"],
    "the Desk's one motion action is the hero's exact-key review");
  const seam = mountResults(page);
  await vm.runInContext(heroMotion[0], page.context);
  deepEqual(seam.opened, [{ scope: { shotId: "L1-01", kind: "motion", frameId: "" }, key: paidKey }],
    "pressing it opens Motion Results on the exact returned provider asset");
  const results = resultsOf(mainOf(page));
  equal(results.selected, paidKey, "Results selects PAID-RETURN.mp4");
  ok(mainOf(page).includes("/assets/shots/L1-01/takes/PAID-RETURN.mp4"), "where the returned provider asset remains visible and playable");
  equal(results.authorityOf("approve"), "decision", "and the existing approval owner remains reachable");

  /* OPENING APPROVAL ESTABLISHES NOTHING; ONLY THE SHIPPED CONFIRMATION WRITES. */
  const dom = confirmationDOM(page);
  /* Settle the migration write-back the older-schema fixture owes, so the count below measures
     opening approval and nothing that load had already scheduled. */
  ok(await settleOwedWrites(page), "the page owes no write before approval is opened");
  const writes = store.writes();
  await pressResults(page, seam, "approve");
  ok(page.context.document.getElementById("modal").innerHTML.includes("Choose the motion approval target"),
    "a shot with two motion units asks which unit the approval is for, through the shipped chooser");
  page.context.document.getElementById("rx-motion-target").value = "motion-a";
  await page.context.CineBraidResultDecisions.prepareMotion();
  ok(page.context.document.getElementById("modal").innerHTML.includes("rx-confirm"), "then opens the shipped confirmation");
  equal(store.writes(), writes, "opening motion approval cannot itself establish authority");
  dom.load();
  await page.gesture.act(() => page.context.CineBraidResultDecisions.confirm());
  for (let i = 0; i < 100 && vm.runInContext("!!approvalSubmissionPending()", page.context); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const receipt = require("../public/shared-authority-kernel").currentHumanAuthority(store.stored(), { kind: "shot-motion", shotId: "L1-01", unitKey: "motion-a" });
  ok(receipt && receipt.value === "PAID-RETURN.mp4" && receipt.assetId === "asset-paid-return", "confirming writes the exact motion receipt through the shipped writer");

  vm.runInContext(`location.hash = "#/shot/L1-01";`, page.context);
  await page.context.route();
  const after = vm.runInContext(`(() => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const unit = readiness.units.find((row) => row.kind === "motion" && row.required && !row.complete)
      || readiness.units.find((row) => row.kind === "motion" && row.required);
    const panel = guidedMotionPanel(shot, guidedApprovedMotion(shot, takesFor(shot.id)), takesFor(shot.id), true);
    return { generationStatus: unit.status, panel };
  })()`, page.context);
  ok(["BLOCKED", "NEEDS_DECISION"].includes(after.generationStatus), "approval does not erase the unmet prerequisite for additional generation");
  ok(after.panel.includes('data-generation-readiness="blocked"'), "new generation remains blocked after reviewing and approving returned media");
  ok(after.panel.includes('id="motion-file"'), "and video import stays available");
  const approvedTarget = (rendersRail(mainOf(page)).match(/<article class="shot-results-target" data-results-target="motion"[\s\S]*?<\/article>/) || [""])[0];
  ok(/data-results-approved="retained"/.test(approvedTarget) && /<small class="shot-results-name">PAID-RETURN\.mp4<\/small>/.test(approvedTarget),
    "the Results rail keeps the Approved motion in view, whatever stage is selected: " + approvedTarget);
}

async function main() {
  await blockedShotConsumers();
  await descriptionOnlyConsumers();
  await firstLastMissingEndpoint();
  await actionableNextActionPanels();
  await frameApprovalReadinessReachesResults();
  await historicReadinessActionsReachProduction();
  await returnedMediaOutlivesGenerationReadiness();
  console.log(`shot-truth-cohesion: ${checks} assertions passed`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

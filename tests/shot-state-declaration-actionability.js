/* Shot State Declaration Actionability V1.
 *
 * Focused deterministic coverage for the owner-validated mutation and the
 * rendered shot-scoped product path. Provider and paid-generation calls: 0. */
const assert = require("assert");
const vm = require("vm");
const Binding = require("../public/shared-continuity-binding");
const { render, buildFixture } = require("./render-harness");

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

function mutationFixture() {
  return {
    shots: [{
      id: "SH-STATE",
      characters: ["CHAR-KAI"],
      codes: [],
      creationBrief: { propIds: [], vehicleIds: [] },
    }],
    characters: [
      {
        id: "CHAR-KAI",
        name: "Kai",
        continuityStates: [
          { id: "state-kai-clean", name: "Clean", isDefault: true },
          { id: "state-kai-rain", name: "Rain soaked", isDefault: false },
        ],
      },
      {
        id: "CHAR-RHEA",
        name: "Rhea",
        continuityStates: [
          { id: "state-rhea-clean", name: "Clean", isDefault: true },
          { id: "state-rhea-night", name: "Night", isDefault: false },
        ],
      },
    ],
    locations: [],
    props: [],
    vehicles: [],
  };
}

function mutationOwnerSection() {
  deepEqual(Binding.SHOT_STATE_DECLARATION_RESULTS, [
    "applied",
    "shot-not-found",
    "entity-not-found",
    "entity-not-attached",
    "state-not-found",
    "state-owned-by-different-entity",
    "invalid-declaration",
  ], "the mutation has a closed deterministic result vocabulary");

  const valid = mutationFixture();
  const applied = Binding.applyShotStateDeclaration(valid, {
    shotId: "SH-STATE",
    entityId: "CHAR-KAI",
    stateId: "state-kai-rain",
  });
  equal(applied.status, "applied", "an attached entity may select one of its own states");
  equal(applied.operation, "selected", "the successful result names the selection operation");
  deepEqual(valid.shots[0].continuityStateSelections, { "CHAR-KAI": "state-kai-rain" },
    "the owner writes the canonical shot-level selection map");

  const foreign = mutationFixture();
  foreign.shots[0].continuityStateSelections = { "CHAR-KAI": "state-kai-clean" };
  const foreignBefore = JSON.stringify(foreign.shots[0].continuityStateSelections);
  const refusedForeign = Binding.applyShotStateDeclaration(foreign, {
    shotId: "SH-STATE",
    entityId: "CHAR-KAI",
    stateId: "state-rhea-night",
  });
  equal(refusedForeign.status, "state-owned-by-different-entity",
    "a state catalogued by another entity is refused as foreign");
  equal(JSON.stringify(foreign.shots[0].continuityStateSelections), foreignBefore,
    "a foreign-state refusal leaves the declaration semantically unchanged");

  const nonexistent = mutationFixture();
  const refusedMissing = Binding.applyShotStateDeclaration(nonexistent, {
    shotId: "SH-STATE",
    entityId: "CHAR-KAI",
    stateId: "state-does-not-exist",
  });
  equal(refusedMissing.status, "state-not-found", "a nonexistent state is refused");
  equal(Object.prototype.hasOwnProperty.call(nonexistent.shots[0], "continuityStateSelections"), false,
    "a nonexistent-state refusal does not manufacture a selection map");

  const unattached = mutationFixture();
  const refusedUnattached = Binding.applyShotStateDeclaration(unattached, {
    shotId: "SH-STATE",
    entityId: "CHAR-RHEA",
    stateId: "state-rhea-night",
  });
  equal(refusedUnattached.status, "entity-not-attached",
    "an entity in the project but not attached to this shot is refused");
  equal(Object.prototype.hasOwnProperty.call(unattached.shots[0], "continuityStateSelections"), false,
    "an unattached-entity refusal writes no declaration");

  const malformed = mutationFixture();
  malformed.shots[0].continuityStateSelections = [];
  const malformedBefore = JSON.stringify(malformed.shots[0].continuityStateSelections);
  const refusedMalformed = Binding.applyShotStateDeclaration(malformed, {
    shotId: "SH-STATE",
    entityId: "CHAR-KAI",
    stateId: "state-kai-rain",
  });
  equal(refusedMalformed.status, "invalid-declaration", "a malformed canonical storage shape is refused");
  equal(JSON.stringify(malformed.shots[0].continuityStateSelections), malformedBefore,
    "malformed storage is not silently repaired during assignment");

  const clearing = mutationFixture();
  clearing.shots[0].continuityStateSelections = { "CHAR-KAI": "state-kai-rain" };
  const cleared = Binding.applyShotStateDeclaration(clearing, {
    shotId: "SH-STATE",
    entityId: "CHAR-KAI",
    stateId: "",
  });
  equal(cleared.status, "applied", "the same owner accepts explicit attachment cleanup");
  equal(cleared.operation, "cleared", "cleanup is distinguishable from selection");
  deepEqual(clearing.shots[0].continuityStateSelections, {},
    "cleanup removes only the entity's canonical shot declaration");

  const detached = mutationFixture();
  detached.shots[0].continuityStateSelections = { "CHAR-KAI": "state-kai-rain" };
  detached.shots[0].characters = [];
  const clearedDetached = Binding.clearDetachedShotStateDeclaration(detached, {
    shotId: "SH-STATE",
    entityId: "CHAR-KAI",
  });
  equal(clearedDetached.status, "applied", "detached cleanup is owned by the binding contract");
  equal(clearedDetached.operation, "cleared-detached", "the result names why cleanup occurred");
  deepEqual(detached.shots[0].continuityStateSelections, {},
    "a detached entity cannot keep itself attached through its stale state-map key");

  const multiplyAttached = mutationFixture();
  multiplyAttached.shots[0].codes = ["CHAR-KAI"];
  multiplyAttached.shots[0].characters = [];
  multiplyAttached.shots[0].continuityStateSelections = { "CHAR-KAI": "state-kai-rain" };
  const retained = Binding.clearDetachedShotStateDeclaration(multiplyAttached, {
    shotId: "SH-STATE",
    entityId: "CHAR-KAI",
  });
  equal(retained.operation, "retained-attached",
    "removing one relationship does not clear a declaration when another still attaches the entity");
  deepEqual(multiplyAttached.shots[0].continuityStateSelections, { "CHAR-KAI": "state-kai-rain" },
    "a still-attached entity keeps its valid shot declaration");
}

function actionabilityFixture() {
  const project = buildFixture();
  project.characters[0].continuityStates = [
    { id: "state-kai-clean", name: "Clean", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    { id: "state-kai-rain", name: "Rain soaked", isDefault: false, approvedFile: "KAI-RAIN.png" },
  ];
  project.characters.push({
    id: "CHAR-RHEA",
    name: "Rhea",
    approvedFile: "RHEA-ANCHOR.png",
    continuityStates: [
      { id: "state-rhea-clean", name: "Clean", isDefault: true, approvedFile: "RHEA-ANCHOR.png" },
      { id: "state-rhea-night", name: "Night", isDefault: false, approvedFile: "RHEA-NIGHT.png" },
    ],
  });
  project.shots[0].continuityStateSelections = { KAI: "state-does-not-exist" };
  return project;
}

async function renderedControlSection() {
  const project = actionabilityFixture();
  const page = await render("#/shot/L1-01", project, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
  });
  const before = JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const requirements = [...(readiness.requirements || []), ...(readiness.units || []).flatMap((unit) => unit.requirements || [])];
    return JSON.stringify({
      action: readiness.nextAction.code,
      reason: requirements.find((row) => row.reason === "declared-state-not-on-entity")?.reason || "",
      markup: guidedShotStateDeclarations(shot),
    });
  })()`, page.context));
  equal(before.action, "resolve-state-declaration",
    "the representative invalid declaration reproduces the canonical readiness action");
  equal(before.reason, "declared-state-not-on-entity",
    "the representative case is the established missing-state decision");
  ok(before.markup.includes('data-readiness-action-surface="shot-state-declaration"'),
    "the shot Inputs surface renders a named declaration-action surface");
  ok(before.markup.includes('data-shot-state-entity="KAI"'),
    "the control names the implicated attached entity");
  ok(before.markup.includes("Invalid declaration · state-does-not-exist is not owned by Kai"),
    "the current invalid declaration is shown honestly");
  ok(before.markup.includes('data-continuity-state-option="state-kai-clean"')
    && before.markup.includes('data-continuity-state-option="state-kai-rain"'),
  "the chooser lists the implicated entity's actual states");
  ok(!before.markup.includes("state-rhea-night"),
    "a foreign entity's state is absent from the shot chooser");
  ok(before.markup.includes("chooseShotContinuityState('L1-01','KAI',this.value)"),
    "the rendered select calls the validated product mutation path");
  ok(!before.markup.includes("setShotContinuityState("),
    "the rendered control does not call the old compatibility helper");
  ok(before.markup.includes("Creating a state in References does not select it here"),
    "the authoring/assignment separation is explicit on the surface");

  const applied = JSON.parse(vm.runInContext(`JSON.stringify(chooseShotContinuityState("L1-01", "KAI", "state-kai-rain"))`, page.context));
  equal(applied.status, "applied", "choosing the rendered option crosses the shared owner successfully");
  const after = JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const requirements = [...(readiness.requirements || []), ...(readiness.units || []).flatMap((unit) => unit.requirements || [])];
    return JSON.stringify({
      declaration: shot.continuityStateSelections,
      action: readiness.nextAction.code,
      stillInvalid: requirements.some((row) => row.reason === "declared-state-not-on-entity"),
      markup: guidedShotStateDeclarations(shot),
    });
  })()`, page.context));
  deepEqual(after.declaration, { KAI: "state-kai-rain" },
    "the real UI handler writes the canonical shot map");
  equal(after.stillInvalid, false,
    "readiness recomputes from the canonical owner and drops the missing-state problem");
  ok(after.action !== "resolve-state-declaration",
    "the round trip progresses to the next truthful readiness action");
  ok(after.markup.includes("Current declaration · Rain soaked"),
    "the rerendered control reads the newly selected canonical declaration");

  const authoredProject = actionabilityFixture();
  const authoredPage = await render("#/shot/L1-01", authoredProject, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
  });
  const authored = JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots[0];
    const before = JSON.stringify(shot.continuityStateSelections);
    addContinuityState("characters", "KAI");
    const generated = P.characters[0].continuityStates.at(-1).id;
    const afterCreation = JSON.stringify(shot.continuityStateSelections);
    const outcome = chooseShotContinuityState("L1-01", "KAI", generated);
    return JSON.stringify({ before, afterCreation, generated, outcome, final: shot.continuityStateSelections });
  })()`, authoredPage.context));
  equal(authored.afterCreation, authored.before,
    "creating a new catalog state alone does not retarget the shot");
  ok(authored.generated.startsWith("state-") && authored.generated !== "state-does-not-exist",
    "authoring produces and exposes its actual generated state id");
  equal(authored.outcome.status, "applied",
    "the newly authored state is assigned only by a subsequent explicit selection");
  equal(authored.final.KAI, authored.generated,
    "the explicit assignment persists the actual generated id, not the missing requested id");
}

async function nextActionReachabilitySection() {
  const project = actionabilityFixture();
  const page = await render("#/shot/L1-01", project, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  const reached = JSON.parse(await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const destination = shotReadinessTargetDestination(readiness);
    const before = boundedShotSelectedTask(shot, takesFor(shot.id));
    await openShotReadinessAction(shot.id, readiness.nextAction.code);
    const html = document.getElementById("main").innerHTML;
    return JSON.stringify({
      action: readiness.nextAction.code,
      before,
      after: boundedShotSelectedTask(shot, takesFor(shot.id)),
      destinationId: destination?.destinationId || "",
      panel: destination?.panel || "",
      surface: destination?.surface || "",
      renderer: destination?.renderer || "",
      control: destination?.control || "",
      focus: destination?.focus || "",
      controlVisible: html.includes('data-readiness-action-surface="shot-state-declaration"'),
      invalidVisible: html.includes('data-shot-state-declaration-invalid="1"'),
    });
  })()`, page.context));
  equal(reached.action, "resolve-state-declaration",
    "the reproduced readiness row emits the state-declaration action");
  equal(reached.before, "look", "precondition: a different shot stage is selected");
  equal(reached.destinationId, "inputs", "the action has one declared shot-stage destination");
  equal(reached.panel, "inputs", "the destination uses a real Inputs panel key");
  equal(reached.surface, "shot-state-declaration", "the destination names the actual new product surface");
  equal(reached.renderer, "guidedSourceInputsPanel", "the destination names the renderer that includes the control");
  equal(reached.control, "guidedShotStateDeclarations", "the destination names the actual declaration control");
  equal(reached.focus, '[data-shot-state-declaration-invalid="1"] select',
    "the destination declares direct focus on the implicated invalid selector");
  equal(reached.after, "inputs", "NEXT ACTION selects the Inputs stage");
  equal(reached.controlVisible, true, "the selected stage renders the declared control");
  equal(reached.invalidVisible, true, "the selected surface renders the implicated invalid row");
}

async function staleDeclarationSection() {
  const characterProject = actionabilityFixture();
  characterProject.shots[0].continuityStateSelections = { KAI: "state-kai-rain" };
  const characterPage = await render("#/shot/L1-01", characterProject, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
  });
  const detached = JSON.parse(vm.runInContext(`(() => {
    toggleShotCreationCharacter("L1-01", "KAI");
    const shot = P.shots[0];
    return JSON.stringify({
      attached: resolveShotEntities(P, shot).characters.some((entity) => entity.id === "KAI"),
      declaration: shot.continuityStateSelections,
    });
  })()`, characterPage.context));
  equal(detached.attached, false, "the character toggle genuinely detaches the entity");
  deepEqual(detached.declaration, {}, "detaching clears that entity's shot declaration through the shared owner");

  const locationProject = actionabilityFixture();
  locationProject.shots[0].creationBrief = {
    ...(locationProject.shots[0].creationBrief || {}),
    locationId: "LOC-HULL",
  };
  locationProject.locations[0].continuityStates = [
    { id: "state-hull-night", name: "Night", isDefault: true, approvedFile: "LOC-HULL-PLATE.png" },
  ];
  locationProject.locations.push({
    id: "LOC-YARD",
    name: "Service yard",
    approvedFile: "LOC-YARD-PLATE.png",
    continuityStates: [{ id: "state-yard-day", name: "Day", isDefault: true, approvedFile: "LOC-YARD-PLATE.png" }],
  });
  locationProject.shots[0].continuityStateSelections = { "LOC-HULL": "state-hull-night" };
  const locationPage = await render("#/shot/L1-01", locationProject, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
  });
  const replaced = JSON.parse(vm.runInContext(`(() => {
    setShotCreationLocation("L1-01", "LOC-YARD");
    const shot = P.shots[0];
    return JSON.stringify({
      locations: resolveShotEntities(P, shot).locations.map((entity) => entity.id),
      declaration: shot.continuityStateSelections,
    });
  })()`, locationPage.context));
  deepEqual(replaced.locations, ["LOC-YARD"], "location replacement attaches only the new active location");
  deepEqual(replaced.declaration, {},
    "location replacement does not silently carry the previous location's owner-scoped state");

  const removedStateProject = actionabilityFixture();
  removedStateProject.shots[0].continuityStateSelections = { KAI: "state-kai-rain" };
  removedStateProject.characters[0].continuityStates =
    removedStateProject.characters[0].continuityStates.filter((state) => state.id !== "state-kai-rain");
  const removedStatePage = await render("#/shot/L1-01", removedStateProject);
  const removedState = JSON.parse(vm.runInContext(`(() => {
    const readiness = shotReadinessFor(P.shots[0]);
    return JSON.stringify({
      declaration: P.shots[0].continuityStateSelections,
      action: readiness.nextAction.code,
      markup: guidedShotStateDeclarations(P.shots[0]),
    });
  })()`, removedStatePage.context));
  deepEqual(removedState.declaration, { KAI: "state-kai-rain" },
    "deleting a selected catalog state does not silently rewrite the declaration");
  equal(removedState.action, "resolve-state-declaration",
    "readiness truthfully reopens the declaration action after state deletion");
  ok(removedState.markup.includes("Invalid declaration · state-kai-rain"),
    "the rendered control shows the stale deleted-state id honestly");
}

async function main() {
  mutationOwnerSection();
  await renderedControlSection();
  await nextActionReachabilitySection();
  await staleDeclarationSection();
  console.log(`shot-state-declaration-actionability: ${checks} assertions passed`);
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

module.exports = {
  mutationFixture,
  mutationOwnerSection,
  actionabilityFixture,
  renderedControlSection,
  nextActionReachabilitySection,
  staleDeclarationSection,
  main,
};

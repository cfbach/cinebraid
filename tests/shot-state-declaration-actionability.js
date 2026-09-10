/* Shot State Declaration Actionability V1.
 *
 * Focused deterministic coverage for the owner-validated mutation and the
 * rendered shot-scoped product path. Provider and paid-generation calls: 0. */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const vm = require("vm");
const Binding = require("../public/shared-continuity-binding");
const Entities = require("../public/shared-entities");
const { render, buildFixture } = require("./render-harness");

let checks = 0;
const ROOT = path.resolve(__dirname, "..");
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

  const relationshipCases = [
    {
      label: "audio speaker only",
      entityId: "CHAR-RHEA",
      stateId: "state-rhea-night",
      arrange: (project, shot) => { shot.audio = { speakerId: "CHAR-RHEA" }; },
    },
    {
      label: "clip speaker only",
      entityId: "CHAR-RHEA",
      stateId: "state-rhea-night",
      arrange: (project, shot) => { shot.clips = [{ id: "CLIP-RHEA", speakerId: "CHAR-RHEA" }]; },
    },
    {
      label: "nested clip dialogue speaker only",
      entityId: "CHAR-RHEA",
      stateId: "state-rhea-night",
      arrange: (project, shot) => {
        shot.clips = [{ id: "CLIP-DIALOGUE", motionBrief: { dialogue: { speakerId: "CHAR-RHEA" } } }];
      },
    },
    {
      label: "creation-brief motion-plan speaker only",
      entityId: "CHAR-RHEA",
      stateId: "state-rhea-night",
      arrange: (project, shot) => {
        shot.creationBrief = { motionPlan: { audio: { speakerId: "CHAR-RHEA" } } };
      },
    },
    {
      label: "creation-brief vehicle only",
      entityId: "VEH-ROVER",
      stateId: "state-rover-dust",
      arrange: (project, shot) => {
        project.vehicles.push({
          id: "VEH-ROVER",
          name: "Rover",
          continuityStates: [{ id: "state-rover-dust", name: "Dusty", isDefault: true }],
        });
        shot.creationBrief = shot.creationBrief || {};
        shot.creationBrief.vehicleIds = ["VEH-ROVER"];
      },
    },
  ];
  for (const testCase of relationshipCases) {
    const related = mutationFixture();
    const relatedShot = related.shots[0];
    relatedShot.characters = [];
    relatedShot.codes = [];
    testCase.arrange(related, relatedShot);
    const canonicalIds = Entities.shotStateBearingEntityRecords(related, relatedShot)
      .filter((record) => record.resolved)
      .map((record) => record.entity.id);
    ok(canonicalIds.includes(testCase.entityId), `${testCase.label} is canonical state-bearing relationship truth`);
    const primaryIds = [
      ...Entities.resolveShotEntities(related, relatedShot).characters,
      ...Entities.resolveShotEntities(related, relatedShot).vehicles,
    ].map((entity) => entity.id);
    equal(primaryIds.includes(testCase.entityId), false,
      `${testCase.label} remains outside the narrower primary/composer attachment resolver`);
    const relationshipApplied = Binding.applyShotStateDeclaration(related, {
      shotId: relatedShot.id,
      entityId: testCase.entityId,
      stateId: testCase.stateId,
    });
    equal(relationshipApplied.status, "applied", `${testCase.label} accepts an owned declaration`);
    equal(Binding.clearDetachedShotStateDeclaration(related, {
      shotId: relatedShot.id,
      entityId: testCase.entityId,
    }).operation, "retained-attached", `${testCase.label} is not stale`);
  }

  const declarationOnly = mutationFixture();
  declarationOnly.shots[0].characters = [];
  declarationOnly.shots[0].codes = [];
  declarationOnly.shots[0].continuityStateSelections = { "CHAR-RHEA": "state-rhea-night" };
  equal(Entities.shotStateBearingEntityRecords(declarationOnly, declarationOnly.shots[0])
    .some((record) => record.id === "CHAR-RHEA"), false,
  "a declaration key alone never appears in the canonical relationship projection");
  equal(Binding.applyShotStateDeclaration(declarationOnly, {
    shotId: "SH-STATE",
    entityId: "CHAR-RHEA",
    stateId: "state-rhea-night",
  }).status, "entity-not-attached", "removing the relationship gate would fail the declaration-only negative control");

  const multipleRelationships = mutationFixture();
  multipleRelationships.shots[0].characters = [];
  multipleRelationships.shots[0].audio = { speakerId: "CHAR-RHEA" };
  multipleRelationships.shots[0].clips = [{ id: "CLIP-RHEA", speakerId: "CHAR-RHEA" }];
  equal(Binding.applyShotStateDeclaration(multipleRelationships, {
    shotId: "SH-STATE", entityId: "CHAR-RHEA", stateId: "state-rhea-night",
  }).status, "applied", "a declaration can be selected while two state-bearing relationships exist");
  multipleRelationships.shots[0].audio.speakerId = "";
  equal(Binding.clearDetachedShotStateDeclaration(multipleRelationships, {
    shotId: "SH-STATE", entityId: "CHAR-RHEA",
  }).operation, "retained-attached", "removing one of two relationships retains the declaration");
  multipleRelationships.shots[0].clips[0].speakerId = "";
  equal(Binding.clearDetachedShotStateDeclaration(multipleRelationships, {
    shotId: "SH-STATE", entityId: "CHAR-RHEA",
  }).operation, "cleared-detached", "removing the final state-bearing relationship makes cleanup valid");
  deepEqual(multipleRelationships.shots[0].continuityStateSelections, {},
    "final-relationship cleanup removes only the now-stale declaration");

  deepEqual(Binding.SHOT_STATE_DECLARATION_BATCH_RESULTS, ["applied", "refused", "invalid-declarations"],
    "batch application has a closed result vocabulary");
  const batchFixture = () => {
    const project = mutationFixture();
    project.shots.push({
      id: "SH-STATE-2",
      characters: ["CHAR-KAI"],
      codes: [],
      creationBrief: { propIds: [], vehicleIds: [] },
    });
    return project;
  };
  const validBatch = batchFixture();
  const batchApplied = Binding.applyShotStateDeclarationBatch(validBatch, validBatch.shots.map((shot) => ({
    shotId: shot.id, entityId: "CHAR-KAI", stateId: "state-kai-rain",
  })));
  equal(batchApplied.status, "applied", "batch assignment applies owner-valid states");
  equal(batchApplied.atomic, true, "batch semantics are explicitly atomic");
  deepEqual(validBatch.shots.map((shot) => shot.continuityStateSelections), [
    { "CHAR-KAI": "state-kai-rain" }, { "CHAR-KAI": "state-kai-rain" },
  ], "every valid batch item is committed through the canonical owner");

  for (const [stateId, expected] of [
    ["state-rhea-night", "state-owned-by-different-entity"],
    ["state-does-not-exist", "state-not-found"],
  ]) {
    const refused = batchFixture();
    refused.shots[0].continuityStateSelections = { "CHAR-KAI": "state-kai-clean" };
    const before = JSON.stringify(refused.shots.map((shot) => shot.continuityStateSelections));
    const result = Binding.applyShotStateDeclarationBatch(refused, refused.shots.map((shot) => ({
      shotId: shot.id, entityId: "CHAR-KAI", stateId,
    })));
    equal(result.status, "refused", `batch ${expected} is refused`);
    equal(result.failure.status, expected, `batch refusal reports ${expected} from the single-item owner`);
    equal(JSON.stringify(refused.shots.map((shot) => shot.continuityStateSelections)), before,
      `batch ${expected} writes no invalid declaration`);
  }

  const partial = batchFixture();
  partial.shots[1].characters = [];
  const partialResult = Binding.applyShotStateDeclarationBatch(partial, partial.shots.map((shot) => ({
    shotId: shot.id, entityId: "CHAR-KAI", stateId: "state-kai-rain",
  })));
  equal(partialResult.status, "refused", "one unattached batch item refuses the whole operation");
  equal(partialResult.failure.status, "entity-not-attached", "the owner reports the unattached item precisely");
  equal(Object.prototype.hasOwnProperty.call(partial.shots[0], "continuityStateSelections"), false,
    "the earlier valid item is not silently committed before a later refusal");
  equal(Object.prototype.hasOwnProperty.call(partial.shots[1], "continuityStateSelections"), false,
    "the unattached item is not written either");
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

function tokenNamespaceOwnerSection() {
  const cases = [
    {
      label: "suffixed shot.characters",
      source: "characters",
      entityId: "CHAR-RHEA",
      stateId: "state-rhea-night",
      foreignStateId: "state-kai-rain",
      arrange: (project, shot) => { shot.characters = ["CHAR-RHEA-alt"]; },
    },
    {
      label: "suffixed creationBrief.propIds",
      source: "creationBrief.propIds",
      entityId: "PR-TOOL",
      stateId: "state-tool-worn",
      foreignStateId: "state-rhea-night",
      arrange: (project, shot) => {
        project.props[0].continuityStates = [{ id: "state-tool-worn", name: "Worn", isDefault: true, approvedFile: "PR-TOOL-PLATE.png" }];
        shot.creationBrief.propIds = ["PR-TOOL_b"];
      },
    },
    {
      label: "suffixed creationBrief.vehicleIds",
      source: "creationBrief.vehicleIds",
      entityId: "VEH-CART",
      stateId: "state-cart-dust",
      foreignStateId: "state-rhea-night",
      arrange: (project, shot) => {
        project.vehicles[0].continuityStates = [{ id: "state-cart-dust", name: "Dusty", isDefault: true, approvedFile: "VEH-CART.png" }];
        shot.creationBrief.vehicleIds = ["VEH-CART-alt"];
      },
    },
  ];
  const projectFor = (testCase) => {
    const project = actionabilityFixture();
    const shot = project.shots[0];
    shot.characters = [];
    shot.codes = [];
    shot.audio = {};
    shot.clips = [];
    shot.creationBrief = { propIds: [], vehicleIds: [] };
    shot.continuityStateSelections = {};
    testCase.arrange(project, shot);
    return project;
  };
  for (const [index, testCase] of cases.entries()) {
    const project = projectFor(testCase);
    const shot = project.shots[0];
    const record = Entities.shotStateBearingEntityRecords(project, shot)
      .find((row) => row.id === testCase.entityId && row.sources.includes(testCase.source));
    ok(record?.resolved, `${testCase.label} resolves through canonical state-bearing truth`);
    equal(record?.entity?.id, testCase.entityId, `${testCase.label} records the canonical entity identity`);
    equal(record?.id, testCase.entityId, `${testCase.label} is keyed by canonical id, not the authored suffix token`);
    equal(Binding.applyShotStateDeclaration(project, {
      shotId: shot.id, entityId: testCase.entityId, stateId: testCase.stateId,
    }).status, "applied", `${testCase.label} accepts its valid owned declaration`);

    const foreign = projectFor(testCase);
    equal(Binding.applyShotStateDeclaration(foreign, {
      shotId: foreign.shots[0].id, entityId: testCase.entityId, stateId: testCase.foreignStateId,
    }).status, "state-owned-by-different-entity", `${testCase.label} still refuses a foreign state`);

    const missing = projectFor(testCase);
    equal(Binding.applyShotStateDeclaration(missing, {
      shotId: missing.shots[0].id, entityId: `MISSING-${index}`, stateId: testCase.stateId,
    }).status, "entity-not-found", `${testCase.label} does not loosen nonexistent entity identity`);
  }

  const exactFirst = actionabilityFixture();
  exactFirst.characters.push({
    id: "CHAR-RHEA-alt", name: "Rhea alternate entity",
    continuityStates: [{ id: "state-alt-entity", name: "Alternate entity state", isDefault: true }],
  });
  exactFirst.shots[0].characters = ["CHAR-RHEA-alt"];
  exactFirst.shots[0].codes = [];
  const exactRecord = Entities.shotStateBearingEntityRecords(exactFirst, exactFirst.shots[0])
    .find((row) => row.sources.includes("characters"));
  equal(exactRecord?.id, "CHAR-RHEA-alt", "token namespaces prefer an exact entity id before suffix matching");

  const codes = actionabilityFixture();
  codes.shots[0].characters = [];
  codes.shots[0].codes = ["CHAR-RHEA-alt"];
  const codeRecord = Entities.shotStateBearingEntityRecords(codes, codes.shots[0])
    .find((row) => row.sources.includes("codes"));
  equal(codeRecord?.id, "CHAR-RHEA", "the existing codes token namespace still resolves its canonical entity unchanged");

  const exactSpeaker = actionabilityFixture();
  exactSpeaker.shots[0].characters = [];
  exactSpeaker.shots[0].codes = [];
  exactSpeaker.shots[0].audio = { speakerId: "CHAR-RHEA-alt" };
  equal(Entities.shotStateBearingEntityRecords(exactSpeaker, exactSpeaker.shots[0])
    .some((row) => row.resolved && row.id === "CHAR-RHEA"), false,
  "exact-ID speaker fields do not inherit token-namespace matching");
}

async function relationshipTruthSection() {
  const cases = [
    {
      label: "audio speaker only",
      entityId: "CHAR-RHEA",
      arrange: (project, shot) => { shot.audio = { speakerId: "CHAR-RHEA" }; },
    },
    {
      label: "clip speaker only",
      entityId: "CHAR-RHEA",
      arrange: (project, shot) => { shot.audio = {}; shot.clips = [{ id: "CLIP-RHEA", speakerId: "CHAR-RHEA" }]; },
    },
    {
      label: "creation-brief motion-plan speaker only",
      entityId: "CHAR-RHEA",
      stateId: "state-rhea-night",
      arrange: (project, shot) => {
        shot.creationBrief = { motionPlan: { audio: { speakerId: "CHAR-RHEA" } } };
      },
    },
    {
      label: "creation-brief vehicle only",
      entityId: "VEH-ROVER",
      arrange: (project, shot) => {
        project.vehicles.push({
          id: "VEH-ROVER",
          name: "Rover",
          approvedFile: "ROVER.png",
          continuityStates: [{ id: "state-rover-dust", name: "Dusty", isDefault: true, approvedFile: "ROVER.png" }],
        });
        shot.creationBrief = shot.creationBrief || {};
        shot.creationBrief.vehicleIds = ["VEH-ROVER"];
      },
    },
    {
      label: "suffixed character relationship",
      entityId: "CHAR-RHEA",
      stateId: "state-rhea-night",
      arrange: (project, shot) => { shot.characters = ["CHAR-RHEA-alt"]; },
    },
    {
      label: "suffixed prop relationship",
      entityId: "PR-TOOL",
      stateId: "state-tool-worn",
      arrange: (project, shot) => {
        project.props[0].continuityStates = [{ id: "state-tool-worn", name: "Worn", isDefault: true, approvedFile: "PR-TOOL-PLATE.png" }];
        shot.codes = (shot.codes || []).filter((token) => !Entities.shotEntityTokenMatches(token, "PR-TOOL"));
        shot.creationBrief = shot.creationBrief || {};
        shot.creationBrief.propIds = ["PR-TOOL_b"];
      },
    },
    {
      label: "suffixed vehicle relationship",
      entityId: "VEH-CART",
      stateId: "state-cart-dust",
      arrange: (project, shot) => {
        project.vehicles[0].status = "APPROVED";
        project.vehicles[0].approvedFile = "VEH-CART.png";
        project.vehicles[0].continuityStates = [{ id: "state-cart-dust", name: "Dusty", isDefault: true, approvedFile: "VEH-CART.png" }];
        shot.creationBrief = shot.creationBrief || {};
        shot.creationBrief.vehicleIds = ["VEH-CART-alt"];
      },
    },
  ];
  for (const testCase of cases) {
    const project = actionabilityFixture();
    const shot = project.shots[0];
    shot.continuityStateSelections = {};
    testCase.arrange(project, shot);
    const stateId = testCase.stateId || (testCase.entityId === "VEH-ROVER" ? "state-rover-dust" : "state-rhea-night");
    const page = await render("#/shot/L1-01", project, {
      storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
    });
    const result = JSON.parse(vm.runInContext(`(() => {
      const shot = P.shots[0];
      const applied = chooseShotContinuityState(shot.id, "${testCase.entityId}", "${stateId}");
      const readiness = shotReadinessFor(shot);
      const requirements = [...(readiness.requirements || []), ...(readiness.units || []).flatMap((unit) => unit.requirements || [])];
      return JSON.stringify({
        applied,
        canonical: shotStateBearingEntityRecords(P, shot).filter((record) => record.resolved).map((record) => record.entity.id),
        requirement: !!requirements.find((row) => row.entityId === "${testCase.entityId}" || String(row.id || "").includes("${testCase.entityId}")),
        action: readiness.nextAction.code,
        stale: guidedStaleShotStateDeclarations(shot),
        selector: guidedShotStateDeclarations(shot),
      });
    })()`, page.context));
    equal(result.applied.status, "applied", `${testCase.label} accepts its valid owned state through the rendered product handler`);
    ok(result.canonical.includes(testCase.entityId), `${testCase.label} is present in rendered canonical relationship truth`);
    equal(result.requirement, true, `${testCase.label} remains a readiness requirement`);
    ok(result.action !== "remove-stale-state-declaration", `${testCase.label} never offers stale cleanup`);
    ok(!result.stale.includes(`data-stale-shot-state-declaration="${testCase.entityId}"`),
      `${testCase.label} is absent from the stale-declaration surface`);
    ok(result.selector.includes(`data-shot-state-entity="${testCase.entityId}"`),
      `${testCase.label} has the normal shot state selector`);
  }
}

async function productDetachSection() {
  const project = actionabilityFixture();
  project.shots[0].continuityStateSelections = {};
  const page = await render("#/shot/L1-01", project, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" },
  });
  const result = JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots[0];
    const motionMarkup = guidedAudioPanel(shot, ensureShotCreation(shot), { supports: { audio: true } }, []);
    const castMarkup = guidedShotAttachmentPicker(shot);
    const applied = chooseShotContinuityState(shot.id, "KAI", "state-kai-rain");

    /* These are the exact onchange handlers used by the shipped Who says it?
       controls. The composer handler writes both the top-level clip speaker and
       its nested dialogue source through syncLegacyFields(). */
    setMotionSoundField(shot.id, "motion-a", "dialogue", "speakerId", "KAI");
    setMotionSoundField(shot.id, "motion-b", "dialogue", "speakerId", "CHAR-RHEA");
    setShotAudioField(shot.id, "speakerId", "KAI");
    setSimpleMotionAudio(shot.id, "speakerId", "KAI");

    const before = {
      top: shot.audio?.speakerId || "",
      clip: shot.clips[0]?.speakerId || "",
      nested: shot.clips[0]?.motionBrief?.dialogue?.speakerId || "",
      motion: shot.creationBrief?.motionPlan?.audio?.speakerId || "",
    };
    toggleShotCreationCharacter(shot.id, "KAI");
    const readiness = shotReadinessFor(shot);
    const requirements = [...(readiness.requirements || []), ...(readiness.units || []).flatMap((unit) => unit.requirements || [])];
    return JSON.stringify({
      applied,
      controls: {
        speaker: motionMarkup.includes("Who says it?") && motionMarkup.includes("setShotAudioField('L1-01','speakerId',this.value)"),
        cast: castMarkup.includes("toggleShotCreationCharacter('L1-01','KAI')"),
      },
      before,
      after: {
        characters: shot.characters,
        top: shot.audio?.speakerId || "",
        clip: shot.clips[0]?.speakerId || "",
        nested: shot.clips[0]?.motionBrief?.dialogue?.speakerId || "",
        motion: shot.creationBrief?.motionPlan?.audio?.speakerId || "",
        unrelatedClip: shot.clips[1]?.speakerId || "",
        unrelatedNested: shot.clips[1]?.motionBrief?.dialogue?.speakerId || "",
        declaration: shot.continuityStateSelections,
        relationships: shotStateBearingEntityRecords(P, shot).filter((row) => row.resolved).map((row) => row.id),
        visibleCharacters: resolveShotEntities(P, shot).characters.map((entity) => entity.id),
        kaiRequirement: requirements.some((row) => row.entityId === "KAI" || String(row.id || "").includes("KAI")),
        action: readiness.nextAction.code,
      },
    });
  })()`, page.context));
  equal(result.controls.speaker, true, "the rendered motion surface exposes the shipped Who says it? mutation handler");
  equal(result.controls.cast, true, "the rendered cast picker exposes the shipped character-removal handler");
  equal(result.applied.status, "applied", "precondition: the attached character owns a valid shot declaration");
  deepEqual(result.before, { top: "KAI", clip: "KAI", nested: "KAI", motion: "KAI" },
    "shipped speaker controls create every covered KAI speaker relationship");
  deepEqual(result.after.characters, [], "the shipped cast control removes KAI from the visible cast");
  equal(result.after.top, "", "cast removal clears the top-level audio speaker relationship");
  equal(result.after.clip, "", "cast removal clears the top-level clip speaker relationship");
  equal(result.after.nested, "", "cast removal clears the nested dialogue speaker relationship");
  equal(result.after.motion, "", "cast removal clears the motion-plan speaker relationship");
  equal(result.after.unrelatedClip, "CHAR-RHEA", "cast removal preserves another entity's clip relationship");
  equal(result.after.unrelatedNested, "CHAR-RHEA", "cast removal preserves another entity's nested dialogue relationship");
  deepEqual(result.after.declaration, {}, "the guarded owner clears KAI's declaration only after its final relationship is gone");
  equal(result.after.relationships.includes("KAI"), false, "no invisible KAI state-bearing relationship remains");
  equal(result.after.visibleCharacters.includes("KAI"), false, "visible attachment truth agrees that KAI is detached");
  equal(result.after.kaiRequirement, false, "readiness no longer blocks on the removed character");
  ok(result.after.action !== "remove-stale-state-declaration", "cast removal does not leave a stale declaration cleanup step behind");
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

async function staleProducerRecoverySection() {
  const project = actionabilityFixture();
  const shot = project.shots[0];
  shot.characters = [];
  shot.codes = (shot.codes || []).filter((token) => !String(token).startsWith("KAI"));
  project.locations[0].continuityStates = [
    { id: "state-hull-night", name: "Night", isDefault: true, approvedFile: "LOC-HULL-PLATE.png" },
  ];
  shot.continuityStateSelections = {
    KAI: "state-kai-rain",
    "LOC-HULL": "state-hull-night",
  };
  const page = await render("#/shot/L1-01", project, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  const before = JSON.parse(await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const destination = shotReadinessTargetDestination(readiness);
    const shotMarkup = guidedShotStateDeclarations(shot);
    const staleMarkup = guidedStaleShotStateDeclarations(shot);
    await openShotReadinessAction(shot.id, readiness.nextAction.code);
    return JSON.stringify({
      action: readiness.nextAction.code,
      message: readiness.nextAction.message,
      destinationId: destination?.destinationId || "",
      surface: destination?.surface || "",
      control: destination?.control || "",
      attached: resolveShotEntities(P, shot).characters.some((entity) => entity.id === "KAI"),
      shotMarkup,
      staleMarkup,
      selected: boundedShotSelectedTask(shot, takesFor(shot.id)),
      rendered: document.getElementById("main").innerHTML,
    });
  })()`, page.context));
  equal(before.action, "remove-stale-state-declaration",
    "a declaration-only known entity emits the explicit stale recovery action");
  ok(before.message.includes("has no state-bearing relationship") && before.message.includes("Remove the stale declaration"),
    "stale readiness copy names the real condition and recovery");
  equal(before.destinationId, "inputs", "stale recovery routes to Inputs");
  equal(before.surface, "shot-stale-state-declaration", "stale recovery has its own semantic surface");
  equal(before.control, "guidedStaleShotStateDeclarations", "stale recovery names the explicit cleanup control");
  equal(before.attached, false, "the state key does not establish attachment truth");
  ok(!before.shotMarkup.includes('data-shot-state-entity="KAI"'),
    "the unusable shot selector still does not render the unattached entity");
  ok(before.staleMarkup.includes('data-stale-shot-state-declaration="KAI"')
    && before.staleMarkup.includes("removeStaleShotStateDeclaration('L1-01','KAI')"),
  "the stale recovery operation is rendered and reachable");
  equal(before.selected, "inputs", "NEXT ACTION selects the stage containing stale recovery");
  ok(before.rendered.includes('data-readiness-action-surface="shot-stale-state-declaration"'),
    "the routed workspace contains the declared stale recovery surface");

  const after = JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots[0];
    shot.audio = { speakerId: "KAI" };
    const raceResult = removeStaleShotStateDeclaration("L1-01", "KAI");
    const declarationAfterRace = { ...shot.continuityStateSelections };
    shot.audio.speakerId = "";
    const result = removeStaleShotStateDeclaration("L1-01", "KAI");
    const readiness = shotReadinessFor(shot);
    return JSON.stringify({
      raceResult,
      declarationAfterRace,
      result,
      declaration: shot.continuityStateSelections,
      attached: resolveShotEntities(P, shot).characters.some((entity) => entity.id === "KAI"),
      action: readiness.nextAction.code,
    });
  })()`, page.context));
  equal(after.raceResult.operation, "retained-attached",
    "stale cleanup rechecks current canonical relationship truth when a speaker is reattached after render");
  deepEqual(after.declarationAfterRace, {
    KAI: "state-kai-rain",
    "LOC-HULL": "state-hull-night",
  }, "the stale-UI race retains the legitimate declaration");
  equal(after.result.status, "applied", "stale recovery crosses the deterministic cleanup owner");
  equal(after.result.operation, "cleared-detached", "stale recovery proves the entity is detached before removal");
  deepEqual(after.declaration, { "LOC-HULL": "state-hull-night" },
    "stale recovery removes only the orphaned key and keeps valid unrelated declarations");
  equal(after.attached, false, "stale recovery never establishes attachment");
  ok(after.action !== "remove-stale-state-declaration", "readiness recomputes after explicit cleanup");
}

async function frameProducerRoutingSection() {
  const project = actionabilityFixture();
  delete project.productionAuthority;
  const shot = project.shots[0];
  shot.continuityStateSelections = { KAI: "state-kai-clean" };
  shot.creationBrief = shot.creationBrief || {};
  shot.creationBrief.frameWorkflows = {
    "frame-a": { characterStateSelections: { KAI: "state-does-not-exist" } },
  };
  const page = await render("#/shot/L1-01", project, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  const reached = JSON.parse(await vm.runInContext(`(async () => {
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const requirement = (readiness.units || []).flatMap((unit) => unit.requirements || [])
      .find((row) => row.reason === "frame-state-not-on-entity");
    const destination = shotReadinessTargetDestination(readiness);
    const frameMarkup = guidedContinuityPanel(shot, takesFor(shot.id));
    const shotMarkup = guidedShotStateDeclarations(shot);
    await openShotReadinessAction(shot.id, readiness.nextAction.code);
    return JSON.stringify({
      action: readiness.nextAction.code,
      message: readiness.nextAction.message,
      reason: requirement?.reason || "",
      scope: requirement?.declarationScope || "",
      frameId: requirement?.frameId || "",
      destinationId: destination?.destinationId || "",
      panel: destination?.panel || "",
      surface: destination?.surface || "",
      control: destination?.control || "",
      focus: destination?.focus || "",
      frameMarkup,
      shotMarkup,
      selected: boundedShotSelectedTask(shot, takesFor(shot.id)),
      rendered: document.getElementById("main").innerHTML,
    });
  })()`, page.context));
  equal(reached.action, "resolve-frame-state-declaration",
    "an invalid frame override emits a frame-specific action token");
  equal(reached.reason, "frame-state-not-on-entity", "readiness distinguishes the frame producer reason");
  equal(reached.scope, "frame", "the requirement retains the declaration scope");
  equal(reached.frameId, "frame-a", "the requirement retains the exact frame owner");
  ok(reached.message.includes("Frame frame-a") && reached.message.includes("state-does-not-exist"),
    "readiness describes the invalid frame override rather than the shot default");
  equal(reached.destinationId, "frames", "the frame action routes to the Frames stage");
  equal(reached.panel, "frames", "the frame action uses the existing Frames panel identity");
  equal(reached.surface, "shot-frame-state-declaration", "the destination names the frame repair surface");
  equal(reached.control, "continuityFrameStatePanelMarkup", "the destination names the existing frame-state control");
  equal(reached.focus, '[data-frame-state-declaration-invalid="1"] select',
    "the frame action focuses the invalid frame selector");
  ok(reached.frameMarkup.includes('data-frame-state-declaration-invalid="1"')
    && reached.frameMarkup.includes("Invalid override · state-does-not-exist is not owned by Kai"),
  "the existing frame surface exposes the actual invalid override honestly");
  ok(reached.shotMarkup.includes("Current declaration · Clean"),
    "the shot selector truthfully remains valid and is not presented as the frame problem");
  equal(reached.selected, "frames", "NEXT ACTION selects the frame repair stage");
  ok(reached.rendered.includes('data-readiness-action-surface="shot-frame-state-declaration"'),
    "the routed stage renders the frame repair surface");
  ok(!reached.rendered.includes('data-readiness-action-surface="shot-state-declaration"'),
    "the routed frame action does not present the shot selector as its repair");

  const falseSuccess = JSON.parse(vm.runInContext(`(() => {
    const shotResult = chooseShotContinuityState("L1-01", "KAI", "state-kai-rain");
    const readiness = shotReadinessFor(P.shots[0]);
    return JSON.stringify({
      shotResult,
      shotState: P.shots[0].continuityStateSelections.KAI,
      frameState: P.shots[0].creationBrief.frameWorkflows["frame-a"].characterStateSelections.KAI,
      action: readiness.nextAction.code,
    });
  })()`, page.context));
  equal(falseSuccess.shotResult.status, "applied", "negative control genuinely changes the shot declaration");
  equal(falseSuccess.shotState, "state-kai-rain", "the shot owner changed only the shot declaration");
  equal(falseSuccess.frameState, "state-does-not-exist", "changing the shot does not rewrite the frame override");
  equal(falseSuccess.action, "resolve-frame-state-declaration",
    "the reviewed false-success blocker remains until the frame owner changes it");

  const failedRepair = JSON.parse(vm.runInContext(`(() => {
    setFrameContinuityState("L1-01", "frame-a", "character", "KAI", "state-rhea-night");
    const readiness = shotReadinessFor(P.shots[0]);
    return JSON.stringify({ action: readiness.nextAction.code, frameState: P.shots[0].creationBrief.frameWorkflows["frame-a"].characterStateSelections.KAI });
  })()`, page.context));
  equal(failedRepair.action, "resolve-frame-state-declaration", "a non-owned frame value cannot clear the blocker");
  equal(failedRepair.frameState, "state-rhea-night", "the failed repair remains visible as the actual stored override");

  const repaired = JSON.parse(vm.runInContext(`(() => {
    setFrameContinuityState("L1-01", "frame-a", "character", "KAI", "state-kai-clean");
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    return JSON.stringify({
      action: readiness.nextAction.code,
      shotState: shot.continuityStateSelections.KAI,
      frameState: shot.creationBrief.frameWorkflows["frame-a"].characterStateSelections.KAI,
      stillBlocked: (readiness.units || []).flatMap((unit) => unit.requirements || []).some((row) => row.reason === "frame-state-not-on-entity"),
    });
  })()`, page.context));
  equal(repaired.frameState, "state-kai-clean", "the real frame owner writes the selected owned frame state");
  equal(repaired.shotState, "state-kai-rain", "frame repair does not silently rewrite the shot declaration");
  equal(repaired.stillBlocked, false, "successful frame repair clears the frame blocker");
  ok(repaired.action !== "resolve-frame-state-declaration", "readiness advances after real frame repair");
}

async function duplicationSection() {
  const mixedProject = actionabilityFixture();
  mixedProject.shots[0].continuityStateSelections = {
    KAI: "state-kai-rain",
    "CHAR-RHEA": "state-rhea-night",
  };
  const mixedPage = await render("#/shot/L1-01", mixedProject);
  const mixed = JSON.parse(await vm.runInContext(`(async () => {
    duplicateShot("L1-01");
    document.getElementById("duplicate-shot-mode").value = "continuity";
    document.getElementById("duplicate-shot-title").value = "Mixed declaration duplicate";
    confirmDuplicateShot("L1-01");
    const copy = P.shots.at(-1);
    return JSON.stringify({
      count: P.shots.length,
      id: copy.id,
      title: copy.title,
      keyframes: copy.keyframes.length,
      copied: copy.continuityStateSelections,
      source: P.shots[0].continuityStateSelections,
    });
  })()`, mixedPage.context));
  equal(mixed.count, 2, "mixed-declaration duplication creates exactly one complete new shot");
  equal(mixed.title, "Mixed declaration duplicate", "the complete duplicate retains the requested title");
  equal(mixed.keyframes, 1, "the duplicate is fully initialized rather than half-created");
  deepEqual(mixed.copied, { KAI: "state-kai-rain" },
    "duplication preserves the valid declaration while filtering the unrelated stale declaration");
  deepEqual(mixed.source, { KAI: "state-kai-rain", "CHAR-RHEA": "state-rhea-night" },
    "duplication filtering does not mutate the source shot");

  const foreignProject = actionabilityFixture();
  foreignProject.shots[0].continuityStateSelections = { KAI: "state-rhea-night" };
  const foreignPage = await render("#/shot/L1-01", foreignProject);
  const foreign = JSON.parse(await vm.runInContext(`(async () => {
    duplicateShot("L1-01");
    document.getElementById("duplicate-shot-mode").value = "continuity";
    confirmDuplicateShot("L1-01");
    return JSON.stringify(P.shots.at(-1).continuityStateSelections);
  })()`, foreignPage.context));
  deepEqual(foreign, {}, "duplication cannot bless a state owned by a different entity");

  const structureProject = actionabilityFixture();
  const source = structureProject.shots[0];
  structureProject.vehicles[0].continuityStates = [{ id: "state-cart-dust", name: "Dusty", isDefault: true }];
  source.continuityStateSelections = { KAI: "state-kai-rain" };
  source.audio = { ...(source.audio || {}), speakerId: "KAI" };
  source.clips[0].speakerId = "KAI";
  source.clips[0].motionBrief = { dialogue: { speakerId: "KAI" } };
  source.creationBrief = {
    ...(source.creationBrief || {}),
    locationId: "LOC-HULL",
    propIds: ["PR-TOOL"],
    vehicleIds: ["VEH-CART"],
    motionPlan: { audio: { speakerId: "KAI" } },
  };

  const structurePage = await render("#/shot/L1-01", structureProject);
  const structure = JSON.parse(await vm.runInContext(`(async () => {
    const sourceBefore = JSON.stringify(P.shots[0]);
    duplicateShot("L1-01");
    document.getElementById("duplicate-shot-mode").value = "structure";
    confirmDuplicateShot("L1-01");
    const copy = P.shots.at(-1);
    const resolved = resolveShotEntities(P, copy);
    return JSON.stringify({
      characters: copy.characters,
      codes: copy.codes,
      locationId: copy.creationBrief?.locationId || "",
      propIds: copy.creationBrief?.propIds || [],
      vehicleIds: copy.creationBrief?.vehicleIds || [],
      audioSpeaker: copy.audio?.speakerId || "",
      clips: copy.clips,
      motionSpeaker: copy.creationBrief?.motionPlan?.audio?.speakerId || "",
      declarations: copy.continuityStateSelections,
      relationships: shotStateBearingEntityRecords(P, copy).filter((row) => row.resolved).map((row) => row.id),
      visible: [...resolved.characters, ...resolved.locations, ...resolved.props, ...resolved.vehicles].map((entity) => entity.id),
      source: P.shots[0],
      sourceBefore,
    });
  })()`, structurePage.context));
  deepEqual(structure.characters, [], "structure duplication strips character attachments");
  deepEqual(structure.codes, [], "structure duplication strips generic attachment tokens");
  equal(structure.locationId, "", "structure duplication strips the primary location relationship");
  deepEqual(structure.propIds, [], "structure duplication strips prop relationships");
  deepEqual(structure.vehicleIds, [], "structure duplication strips vehicle relationships");
  equal(structure.audioSpeaker, "", "structure duplication strips the top-level speaker relationship");
  deepEqual(structure.clips, [], "structure duplication strips clip and nested-dialogue speaker relationships");
  equal(structure.motionSpeaker, "", "structure duplication strips the motion-plan speaker relationship");
  deepEqual(structure.declarations, {}, "structure duplication carries no continuity declarations");
  deepEqual(structure.relationships, [], "canonical state-bearing truth finds no residual structure-only relationship");
  deepEqual(structure.visible, [], "the primary visual attachment projection agrees with the structure-only copy");
  equal(JSON.stringify(structure.source), structure.sourceBefore, "structure filtering leaves the source shot byte-for-byte unchanged");
}

async function batchProductAndCompletenessSection() {
  const validProject = actionabilityFixture();
  validProject.shots[0].continuityStateSelections = {};
  validProject.shots.push({
    ...JSON.parse(JSON.stringify(validProject.shots[0])),
    id: "L1-02",
    title: "Second shot",
  });
  const validPage = await render("#/shots", validProject);
  const applied = JSON.parse(vm.runInContext(`(() => {
    BATCH_SHOTS.add("L1-01");
    BATCH_SHOTS.add("L1-02");
    batchContinuityState();
    document.getElementById("batch-continuity-choice").value = "KAI|state-kai-rain";
    const result = confirmBatchContinuity();
    return JSON.stringify({ result, declarations: P.shots.map((shot) => shot.continuityStateSelections) });
  })()`, validPage.context));
  equal(applied.result.status, "applied", "the reachable batch UI calls the canonical bulk owner");
  equal(applied.result.atomic, true, "the product batch result exposes atomic semantics");
  deepEqual(applied.declarations, [{ KAI: "state-kai-rain" }, { KAI: "state-kai-rain" }],
    "the valid batch UI applies the owned state to every selected attached shot");

  const partialProject = actionabilityFixture();
  partialProject.shots[0].continuityStateSelections = {};
  const unattachedShot = {
    ...JSON.parse(JSON.stringify(partialProject.shots[0])),
    id: "L1-02",
    title: "Unattached second shot",
    characters: [],
    codes: (partialProject.shots[0].codes || []).filter((token) => !String(token).startsWith("KAI")),
    continuityStateSelections: {},
  };
  partialProject.shots.push(unattachedShot);
  const partialPage = await render("#/shots", partialProject);
  const refused = JSON.parse(vm.runInContext(`(() => {
    BATCH_SHOTS.add("L1-01");
    BATCH_SHOTS.add("L1-02");
    batchContinuityState();
    document.getElementById("batch-continuity-choice").value = "KAI|state-kai-rain";
    const result = confirmBatchContinuity();
    return JSON.stringify({ result, declarations: P.shots.map((shot) => shot.continuityStateSelections) });
  })()`, partialPage.context));
  equal(refused.result.status, "refused", "the reachable batch UI refuses an unattached selected shot");
  equal(refused.result.failure.status, "entity-not-attached", "the UI refusal comes from canonical owner validation");
  deepEqual(refused.declarations, [{}, {}], "the reachable batch UI makes no silent partial mutation");

  const tokenPayload = JSON.parse(vm.runInContext(`(() => {
    const tokens = ["remove-stale-state-declaration", "resolve-state-declaration", "resolve-frame-state-declaration"];
    return JSON.stringify({
      tokens: tokens.map((code) => {
        const destination = shotReadinessDestinationForAction(code);
        return {
          code,
          words: readinessActionWords({ code }),
          destinationId: destination?.destinationId || "",
          surface: destination?.surface || "",
          renderer: destination?.renderer || "",
          control: destination?.control || "",
          focus: destination?.focus || "",
        };
      }),
      unknownWords: readinessActionWords({ code: "unmapped-state-action" }),
      unknownDestination: shotReadinessDestinationForAction("unmapped-state-action"),
    });
  })()`, validPage.context));
  for (const row of tokenPayload.tokens) {
    ok(row.words && row.words !== "Next action", `${row.code} has explicit rendered copy`);
    ok(row.destinationId && row.surface && row.renderer && row.control && row.focus,
      `${row.code} has complete semantic routing and focus metadata`);
  }
  equal(tokenPayload.unknownWords, "Next action", "negative control: an unknown token does not borrow another action's copy");
  equal(tokenPayload.unknownDestination, null, "negative control: an unknown token does not fall through to a plausible destination");

  const publicDir = path.join(ROOT, "public");
  const directWriters = fs.readdirSync(publicDir)
    .filter((name) => name.endsWith(".js") && name !== "shared-continuity-binding.js")
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(publicDir, name), "utf8");
      const writes = [
        ...(source.match(/continuityStateSelections\s*\[[^\]]+\]\s*=/g) || []),
        ...(source.match(/delete\s+[^;\n]*continuityStateSelections/g) || []),
      ];
      return writes.map((write) => `${name}: ${write}`);
    });
  deepEqual(directWriters, [],
    "global writer guard: no shipped UI module directly assigns or deletes a shot declaration key outside the canonical owner");
  const objectReplacements = fs.readdirSync(publicDir)
    .filter((name) => name.endsWith(".js") && name !== "shared-continuity-binding.js")
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(publicDir, name), "utf8");
      return (source.match(/[A-Za-z_$][\w$]*\.continuityStateSelections\s*=\s*\{\}/g) || [])
        .map((write) => `${name}: ${write}`);
    });
  deepEqual(objectReplacements, ["mutations.js: copy.continuityStateSelections = {}"],
    "global writer guard: the only UI object replacement is the explicit empty staging map used before owner-validated shot duplication");
  const appSource = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  const batchHandler = appSource.slice(
    appSource.indexOf("window.confirmBatchContinuity ="),
    appSource.indexOf("window.batchHealthCheck ="),
  );
  ok(batchHandler.includes("applyShotStateDeclarationBatch(P, declarations)"),
    "global writer guard: the reachable batch handler delegates to the canonical bulk owner");
  const mutationsSource = fs.readFileSync(path.join(publicDir, "mutations.js"), "utf8");
  const duplicateHandler = mutationsSource.slice(
    mutationsSource.indexOf("window.confirmDuplicateShot ="),
    mutationsSource.indexOf("/* ---------- mutations ---------- */"),
  );
  ok(duplicateHandler.includes("copiedStateDeclarations.map((declaration) => applyShotStateDeclaration(P, declaration))")
    && !duplicateHandler.includes("applyShotStateDeclarationBatch(P, copiedStateDeclarations)"),
  "global writer guard: duplication intentionally filters each cloned declaration through the canonical single-item owner");
  const serverSource = fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8");
  const importedShotNormalizer = serverSource.slice(
    serverSource.indexOf("function normalizeBuilderShot("),
    serverSource.indexOf("function normalizeImportedProject("),
  );
  const importedProjectNormalizer = serverSource.slice(
    serverSource.indexOf("function normalizeImportedProject("),
    serverSource.indexOf("function validateImportedProject("),
  );
  ok(importedShotNormalizer.includes("continuityStateSelections: {}")
    && importedShotNormalizer.includes("stateDeclarations.push("),
  "global writer guard: Project Builder stages imported declarations outside the normalized shot map");
  ok(importedProjectNormalizer.includes("ContinuityBinding.applyShotStateDeclarationBatch(project, shotStateDeclarations)"),
    "global writer guard: Project Builder import delegates the complete declaration set to the canonical atomic owner");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
function waitFor(check, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = async () => {
      try { if (await check()) return resolve(true); } catch { /* not ready yet */ }
      if (Date.now() > deadline) return reject(new Error("timed out waiting for the CineBraid server"));
      setTimeout(tick, 120);
    };
    tick();
  });
}
async function reloadSection() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-shot-state-actionability-"));
  const projectsRoot = path.join(temp, "projects");
  const slug = "state-actionability";
  const projectDir = path.join(projectsRoot, slug);
  for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"])
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(actionabilityFixture(), null, 2));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CINEBRAID_CONFIG_PATH: path.join(temp, "config.json"),
      CINEBRAID_PROJECTS_ROOT: projectsRoot,
      CINEBRAID_AI_TEXT_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitFor(async () => {
      const response = await fetch(`${base}/api/me`).catch(() => null);
      return !!response && response.ok;
    });
    const openedResponse = await fetch(`${base}/api/project`);
    ok(openedResponse.ok, `the real server opens the invalid fixture: ${openedResponse.status}\n${output}`);
    const revision = openedResponse.headers.get("etag")
      || openedResponse.headers.get("x-cinebraid-project-revision")
      || "*";
    const opened = await openedResponse.json();
    const page = await render("#/shot/L1-01", opened, {
      storage: { [`cinebraid-focused:${slug}:shot-task:L1-01`]: "inputs" },
    });
    const applied = JSON.parse(vm.runInContext(
      `JSON.stringify(chooseShotContinuityState("L1-01", "KAI", "state-kai-rain"))`,
      page.context,
    ));
    equal(applied.status, "applied", "the project sent to the real save route was changed through the UI handler");
    const edited = JSON.parse(vm.runInContext("JSON.stringify(P)", page.context));
    const save = await fetch(`${base}/api/projects/${slug}/project`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": revision },
      body: JSON.stringify(edited),
    });
    ok(save.ok, `the real project save accepts the validated declaration: ${save.status} ${await save.text().catch(() => "")}`);
    const reloadedResponse = await fetch(`${base}/api/project`);
    ok(reloadedResponse.ok, "the saved project reloads through the real project route");
    const reloaded = await reloadedResponse.json();
    deepEqual(reloaded.shots[0].continuityStateSelections, { KAI: "state-kai-rain" },
      "the valid selection survives the actual save/reload path");

    const reopenedPage = await render("#/shot/L1-01", reloaded, {
      storage: { [`cinebraid-focused:${slug}:shot-task:L1-01`]: "inputs" },
    });
    const reopened = JSON.parse(vm.runInContext(`(() => {
      const shot = P.shots[0];
      const readiness = shotReadinessFor(shot);
      return JSON.stringify({
        action: readiness.nextAction.code,
        markup: guidedShotStateDeclarations(shot),
      });
    })()`, reopenedPage.context));
    ok(reopened.action !== "resolve-state-declaration",
      "reloaded readiness remains past the missing-state declaration blocker");
    ok(reopened.markup.includes("Current declaration · Rain soaked"),
      "the reloaded rendered control shows the persisted state");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  mutationOwnerSection();
  tokenNamespaceOwnerSection();
  await relationshipTruthSection();
  await productDetachSection();
  await renderedControlSection();
  await nextActionReachabilitySection();
  await staleDeclarationSection();
  await staleProducerRecoverySection();
  await frameProducerRoutingSection();
  await duplicationSection();
  await batchProductAndCompletenessSection();
  await reloadSection();
  console.log(`shot-state-declaration-actionability: ${checks} assertions passed`);
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

module.exports = {
  mutationFixture,
  mutationOwnerSection,
  tokenNamespaceOwnerSection,
  actionabilityFixture,
  relationshipTruthSection,
  productDetachSection,
  renderedControlSection,
  nextActionReachabilitySection,
  staleDeclarationSection,
  staleProducerRecoverySection,
  frameProducerRoutingSection,
  duplicationSection,
  batchProductAndCompletenessSection,
  reloadSection,
  main,
};

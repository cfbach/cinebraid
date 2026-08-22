/* Shot State Declaration Actionability V1.
 *
 * Focused deterministic coverage for the owner-validated mutation and the
 * rendered shot-scoped product path. Provider and paid-generation calls: 0. */
const assert = require("assert");
const Binding = require("../public/shared-continuity-binding");

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
}

async function main() {
  mutationOwnerSection();
  console.log(`shot-state-declaration-actionability: ${checks} assertions passed`);
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

module.exports = { mutationFixture, mutationOwnerSection, main };

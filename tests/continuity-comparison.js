/* CineBraid declared-entity continuity — deterministic comparison and intent.

   Two images are observed independently and compared by stable entity id.
   No model, no network, no geometry matching, no clock — the same inputs must
   always produce a byte-identical result.

   The safety invariants under test are the ones that make the whole design
   trustworthy: an uncertain or heavily occluded reading can NEVER become a
   presence finding, an untracked attribute can never produce a finding, and
   nothing in this core can auto-pass a case that needs a person to look.

   Offline. No provider, no network, no model. */
const assert = require("assert");

const {
  compareObservations,
  applyIntent,
  validateObservationSet,
  buildIntentDescriptors,
  recordState,
  sameColourFamily,
  colourFamily,
  MOVE_THRESHOLD,
  SIZE_RATIO_LO,
  SIZE_RATIO_HI,
  COLOUR_FAMILIES,
} = require("../public/shared-continuity");

/* ---- helpers ---- */
function manifestOf(rows) {
  const entities = [...rows]
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0))
    .map((row) => ({
      entity_id: row.entity_id,
      display_name: row.display_name || row.entity_id,
      entity_type: row.entity_type || "prop",
      parent_entity_id: row.parent_entity_id || null,
      continuity_unit: row.continuity_unit || "self",
      identity_cues: "",
      allowed_state_values: row.allowed_state_values || null,
      track_presence: row.track_presence !== false,
      track_movement: row.track_movement !== false,
      track_color: row.track_color === true,
      track_state: row.track_state === true,
      track_markings: row.track_markings === true,
      cb_declared_state_id: row.cb_declared_state_id || "state-default",
      cb_declared_state_name: row.cb_declared_state_name || "Default",
    }));
  return { manifestVersion: "continuity-manifest-v1", shotId: "S-01", n: entities.length, entities, manifestHash: "hash" };
}
const present = (patch = {}) => ({ presence: "present", occlusion: "none", identifiable: "yes", bbox: [100, 100, 200, 200], color: "not-applicable", state: "not-applicable", markings: "not-applicable", evidence: "seen", ...patch });
const absent = (patch = {}) => ({ presence: "absent", occlusion: "not-applicable", identifiable: "no", bbox: null, color: "not-applicable", state: "not-applicable", markings: "not-applicable", evidence: "gone", ...patch });
const unsure = (patch = {}) => ({ presence: "uncertain", occlusion: "uncertain", identifiable: "uncertain", bbox: null, color: "uncertain", state: "uncertain", markings: "uncertain", evidence: "unclear", ...patch });
/* Builds the validated side the comparison engine consumes. */
function side(entities) {
  const states = {};
  for (const [id, record] of Object.entries(entities)) states[id] = recordState(record);
  return { entities, states };
}
const kinds = (result) => result.changes.map((row) => row.kind).sort();
const MUG = manifestOf([{ entity_id: "prop_mug", display_name: "Enamel mug", track_color: true, track_state: true }]);

/* ---- 1. identical observations are completely stable ---- */
const stable = compareObservations(side({ prop_mug: present({ color: "white", state: "not-applicable" }) }), side({ prop_mug: present({ color: "white" }) }), MUG);
assert.deepStrictEqual(stable.changes, []);
assert.deepStrictEqual(stable.uncertain, []);
assert.deepStrictEqual(stable.shade_drift, []);
assert.deepStrictEqual(stable.attribute_unreadable, []);
assert.deepStrictEqual(stable.presence_uncertain, []);
assert.deepStrictEqual(stable.invalid_records, []);
assert.strictEqual(stable.n_entities, 1);
assert.strictEqual(applyIntent(stable, { manifestA: MUG, manifestB: MUG }).label, "no-change");

/* ---- 2. comparison is pure and byte-deterministic ---- */
const a = side({ prop_mug: present({ color: "white" }) });
const b = side({ prop_mug: present({ color: "blue", bbox: [400, 400, 500, 500] }) });
const snapshotA = JSON.stringify(a);
const first = compareObservations(a, b, MUG);
assert.strictEqual(JSON.stringify(first), JSON.stringify(compareObservations(a, b, MUG)), "the same inputs must produce a byte-identical result");
assert.strictEqual(JSON.stringify(a), snapshotA, "comparison must not mutate its inputs");
assert(!JSON.stringify(first).includes("20260"), "no wall-clock timestamp may appear in a deterministic comparison result");

/* ---- 3. presence: removed and added ---- */
const removed = compareObservations(side({ prop_mug: present() }), side({ prop_mug: absent() }), MUG);
assert.deepStrictEqual(kinds(removed), ["removed"]);
assert.strictEqual(removed.changes[0].attribute, "presence");
assert.strictEqual(removed.changes[0].display_name, "Enamel mug");
const added = compareObservations(side({ prop_mug: absent() }), side({ prop_mug: present() }), MUG);
assert.deepStrictEqual(kinds(added), ["added"]);
/* track_presence:false suppresses the finding entirely. */
const noPresence = manifestOf([{ entity_id: "prop_mug", track_presence: false }]);
assert.deepStrictEqual(compareObservations(side({ prop_mug: present() }), side({ prop_mug: absent() }), noPresence).changes, []);

/* ---- 4. SAFETY INVARIANT: uncertainty can never become a presence finding ----

   This is the rule that keeps false-present at zero. Every combination that
   involves an uncertain reading on either side must land in presence_uncertain
   or invalid_records, and must never produce removed/added. */
const UNCERTAIN_SIDES = [
  ["uncertain vs present", unsure(), present()],
  ["present vs uncertain", present(), unsure()],
  ["uncertain vs absent", unsure(), absent()],
  ["absent vs uncertain", absent(), unsure()],
  ["uncertain vs uncertain", unsure(), unsure()],
  ["uncertain with a remnant box", unsure({ bbox: [10, 10, 20, 20] }), present()],
];
for (const [label, left, right] of UNCERTAIN_SIDES) {
  const result = compareObservations(side({ prop_mug: left }), side({ prop_mug: right }), MUG);
  assert(!result.changes.some((row) => row.kind === "removed" || row.kind === "added"), `${label}: an uncertain reading must never produce a presence finding`);
  assert.strictEqual(result.presence_uncertain.length, 1, `${label}: must be reported as presence-uncertain`);
  assert.strictEqual(applyIntent(result, { manifestA: MUG, manifestB: MUG }).label, "human-review", `${label}: must require human review`);
}

/* ---- 5. SAFETY INVARIANT: occlusion is never evidence of absence ----

   Heavy occlusion is an unsolved model limitation. A record that claims
   absence through an occlusion that would hide the object is not an absence,
   it is an invalid record, and it goes to review rather than to a verdict. */
for (const occlusion of ["partial", "heavy"]) {
  const bogus = absent({ occlusion });
  assert.strictEqual(recordState(bogus), "invalid", `absent behind ${occlusion} occlusion must not be a legal record`);
  const result = compareObservations(side({ prop_mug: present() }), side({ prop_mug: bogus }), MUG);
  assert.deepStrictEqual(result.changes, [], `${occlusion} occlusion must never manufacture a presence finding`);
  assert.strictEqual(result.invalid_records.length, 1);
  assert.strictEqual(applyIntent(result, { manifestA: MUG, manifestB: MUG }).label, "human-review");
}
/* A heavily occluded but honestly present record is comparable for presence
   and still forces review through the occlusion transition. */
const heavyButPresent = compareObservations(side({ prop_mug: present({ occlusion: "none" }) }), side({ prop_mug: present({ occlusion: "heavy" }) }), MUG);
assert.deepStrictEqual(heavyButPresent.changes, []);
assert.strictEqual(heavyButPresent.uncertain.filter((row) => row.kind === "occlusion-transition").length, 1);
assert.strictEqual(applyIntent(heavyButPresent, { manifestA: MUG, manifestB: MUG }).label, "human-review");

/* ---- 6. an invalid record is excluded from every automatic verdict ---- */
const invalid = compareObservations(side({ prop_mug: present({ bbox: null }) }), side({ prop_mug: present() }), MUG);
assert.deepStrictEqual(invalid.changes, []);
assert.strictEqual(invalid.invalid_records[0].entity_id, "prop_mug");
assert.strictEqual(invalid.invalid_records[0].state_a, "invalid");
/* A record the model never returned at all is a missing-record, not a change. */
const missing = compareObservations(side({}), side({ prop_mug: present() }), MUG);
assert.deepStrictEqual(missing.changes, []);
assert.strictEqual(missing.uncertain[0].kind, "missing-record");

/* ---- 7. tracked attributes: colour, state, markings ---- */
const colourChange = compareObservations(side({ prop_mug: present({ color: "white" }) }), side({ prop_mug: present({ color: "green" }) }), MUG);
assert.deepStrictEqual(kinds(colourChange), ["attribute"]);
assert.strictEqual(colourChange.changes[0].attribute, "color");
assert.strictEqual(colourChange.changes[0].value_a, "white");
assert.strictEqual(colourChange.changes[0].value_b, "green");

const DOOR = manifestOf([{ entity_id: "prop_door", track_state: true, allowed_state_values: ["open", "closed"] }]);
const stateChange = compareObservations(side({ prop_door: present({ state: "open" }) }), side({ prop_door: present({ state: "closed" }) }), DOOR);
assert.deepStrictEqual(kinds(stateChange), ["attribute"]);
assert.strictEqual(stateChange.changes[0].attribute, "state");

const SIGN = manifestOf([{ entity_id: "prop_sign", track_markings: true }]);
assert.strictEqual(compareObservations(side({ prop_sign: present({ markings: "text" }) }), side({ prop_sign: present({ markings: "none" }) }), SIGN).changes[0].attribute, "markings");

/* ---- 8. SAFETY INVARIANT: an untracked attribute never produces a finding --

   The multi-tone wristwatch rule. Even if the value differs, and even if
   validation somehow let it through, the comparison is gated on the declared
   policy. */
const WATCH = manifestOf([{ entity_id: "acc_wristwatch", display_name: "Wristwatch", track_color: false, track_state: false, track_markings: false }]);
const watchDiff = compareObservations(
  side({ acc_wristwatch: present({ color: "silver", state: "open", markings: "text" }) }),
  side({ acc_wristwatch: present({ color: "gold", state: "closed", markings: "none" }) }),
  WATCH,
);
assert.deepStrictEqual(watchDiff.changes, [], "a two-tone object read as two different colours must produce no finding when colour is untracked");
assert.deepStrictEqual(watchDiff.attribute_unreadable, []);
assert.deepStrictEqual(watchDiff.shade_drift, []);
assert.strictEqual(applyIntent(watchDiff, { manifestA: WATCH, manifestB: WATCH }).label, "no-change");
/* Validation is the first line of the same defence: it blanks the value. */
const scrubbed = validateObservationSet(WATCH, { coordinate_mode: "permille", entities: { acc_wristwatch: present({ color: "gold" }) } });
assert.strictEqual(scrubbed.entities.acc_wristwatch.color, "not-applicable");

/* ---- 9. shade drift is separated from a real colour change ----

   Neighbouring names inside a family are a lighting or compression artefact
   far more often than a continuity break, so they get their own bucket and do
   not become a change. */
for (const family of COLOUR_FAMILIES) {
  assert(family.length >= 2);
  const drift = compareObservations(side({ prop_mug: present({ color: family[0] }) }), side({ prop_mug: present({ color: family[1] }) }), MUG);
  assert.deepStrictEqual(drift.changes, [], `${family[0]}→${family[1]} must not be a change`);
  assert.strictEqual(drift.shade_drift.length, 1, `${family[0]}→${family[1]} must be recorded as shade drift`);
  assert(sameColourFamily(family[0], family[1]));
}
assert(!sameColourFamily("white", "green"));
assert.strictEqual(colourFamily("chartreuse"), null, "a colour outside every family has no family");
assert(!sameColourFamily("chartreuse", "chartreuse"), "two unfamilied colours are not in the same family");
/* Shade drift alone is not human review: it is a recorded observation. */
const driftOnly = compareObservations(side({ prop_mug: present({ color: "white" }) }), side({ prop_mug: present({ color: "cream" }) }), MUG);
assert.strictEqual(applyIntent(driftOnly, { manifestA: MUG, manifestB: MUG }).label, "no-change");

/* ---- 10. an unreadable attribute is reported as unreadable, not as a change --

   Becoming unreadable is not the same as changing, and it always needs a
   person. */
for (const value of ["uncertain", "not-applicable"]) {
  const result = compareObservations(side({ prop_mug: present({ color: "white" }) }), side({ prop_mug: present({ color: value }) }), MUG);
  assert.deepStrictEqual(result.changes, [], `colour becoming ${value} must not be reported as a colour change`);
  assert.strictEqual(result.attribute_unreadable.length, 1);
  assert.strictEqual(applyIntent(result, { manifestA: MUG, manifestB: MUG }).label, "human-review");
}

/* ---- 11. movement is geometric, and only when the camera is locked ---- */
const far = [100 + Math.ceil(MOVE_THRESHOLD * 1000) + 5, 100, 200 + Math.ceil(MOVE_THRESHOLD * 1000) + 5, 200];
const moved = compareObservations(side({ prop_mug: present() }), side({ prop_mug: present({ bbox: far }) }), MUG);
assert.deepStrictEqual(kinds(moved), ["moved"]);
assert.strictEqual(moved.changes[0].attribute, "centre_displacement");
assert(moved.changes[0].distance > MOVE_THRESHOLD);
/* Below the threshold nothing is reported: a few permille is noise. */
const jitter = compareObservations(side({ prop_mug: present() }), side({ prop_mug: present({ bbox: [105, 100, 205, 200] }) }), MUG);
assert.deepStrictEqual(jitter.changes, [], "sub-threshold jitter must not be a movement finding");
/* Camera and framing continuity is a separate instrument that does not exist
   yet, so an unlocked camera simply suppresses movement rather than guessing. */
assert.deepStrictEqual(compareObservations(side({ prop_mug: present() }), side({ prop_mug: present({ bbox: far }) }), MUG, { cameraLocked: false }).changes, []);
/* track_movement:false suppresses it too. */
const noMove = manifestOf([{ entity_id: "prop_mug", track_movement: false }]);
assert.deepStrictEqual(compareObservations(side({ prop_mug: present() }), side({ prop_mug: present({ bbox: far }) }), noMove).changes, []);

/* ---- 12. an implausible size change is review, never a verdict ---- */
const grew = compareObservations(side({ prop_mug: present({ bbox: [100, 100, 200, 200] }) }), side({ prop_mug: present({ bbox: [100, 100, 400, 400] }) }), MUG);
assert.strictEqual(grew.uncertain.filter((row) => row.kind === "size").length, 1);
assert(grew.uncertain.find((row) => row.kind === "size").ratio < SIZE_RATIO_LO);
const sameSize = compareObservations(side({ prop_mug: present() }), side({ prop_mug: present({ bbox: [110, 110, 210, 210] }) }), MUG);
assert.deepStrictEqual(sameSize.uncertain.filter((row) => row.kind === "size"), []);
assert(SIZE_RATIO_LO < 1 && SIZE_RATIO_HI > 1);

/* ---- 13. identifiability degradation forces review ---- */
const unidentifiable = compareObservations(side({ prop_mug: present() }), side({ prop_mug: present({ identifiable: "uncertain" }) }), MUG);
assert.strictEqual(unidentifiable.uncertain.filter((row) => row.kind === "identifiability").length, 1);
assert.strictEqual(applyIntent(unidentifiable, { manifestA: MUG, manifestB: MUG }).label, "human-review");

/* ---- 14. intent: a declared state change is structural, not textual ---- */
const before = manifestOf([{ entity_id: "char_kai", display_name: "Kai", track_state: true, allowed_state_values: ["jacket-on", "jacket-off"], cb_declared_state_id: "state-a", cb_declared_state_name: "Jacket on" }]);
const after = manifestOf([{ entity_id: "char_kai", display_name: "Kai", track_state: true, allowed_state_values: ["jacket-on", "jacket-off"], cb_declared_state_id: "state-b", cb_declared_state_name: "Jacket off" }]);
const stateShift = compareObservations(side({ char_kai: present({ state: "jacket-on" }) }), side({ char_kai: present({ state: "jacket-off" }) }), before);
assert.deepStrictEqual(kinds(stateShift), ["attribute"]);
const declared = applyIntent(stateShift, { manifestA: before, manifestB: after });
assert.strictEqual(declared.changes[0].label, "intended");
assert.strictEqual(declared.changes[0].intentSource, "declared-state-change");
assert(declared.changes[0].intentReason.includes("Jacket on"), "the provenance must name the declared states");
assert.strictEqual(declared.label, "intended");
/* Expected findings remain VISIBLE — relabelled, never removed. */
assert.strictEqual(declared.changes.length, 1, "an intended change is still reported");
/* Without the declared state change the same difference is a possible break. */
assert.strictEqual(applyIntent(stateShift, { manifestA: before, manifestB: before }).label, "possible-continuity-error");

/* ---- 15. intent: explicit per-entity allowances ---- */
const shotWith = (intent) => ({ id: "S-01", continuityIntent: intent });
const leaveOk = applyIntent(removed, { shot: shotWith({ prop_mug: { allowPresenceChange: "may-leave" } }), manifestA: MUG, manifestB: MUG });
assert.strictEqual(leaveOk.changes[0].label, "intended");
assert.strictEqual(leaveOk.changes[0].intentSource, "allowance");
assert.strictEqual(leaveOk.label, "intended");
/* may-leave does not license an entity appearing. */
assert.strictEqual(applyIntent(added, { shot: shotWith({ prop_mug: { allowPresenceChange: "may-leave" } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "possible-continuity-error");
assert.strictEqual(applyIntent(added, { shot: shotWith({ prop_mug: { allowPresenceChange: "may-enter" } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "intended");
assert.strictEqual(applyIntent(removed, { shot: shotWith({ prop_mug: { allowPresenceChange: "either" } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "intended");
assert.strictEqual(applyIntent(added, { shot: shotWith({ prop_mug: { allowPresenceChange: "either" } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "intended");
assert.strictEqual(applyIntent(moved, { shot: shotWith({ prop_mug: { allowMovement: true } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "intended");
assert.strictEqual(applyIntent(colourChange, { shot: shotWith({ prop_mug: { allowColorChange: true } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "intended");
/* An allowance for one entity never licenses another. */
assert.strictEqual(applyIntent(removed, { shot: shotWith({ other_prop: { allowPresenceChange: "either" } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "possible-continuity-error");
/* An allowance is not a licence for a different kind of change. */
assert.strictEqual(applyIntent(colourChange, { shot: shotWith({ prop_mug: { allowMovement: true } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "possible-continuity-error");

/* ---- 16. intent: constrained free text, and the near-miss rule ---- */
const matched = applyIntent(removed, { shot: shotWith({ prop_mug: { expected: ["the enamel mug is taken away between these frames"] } }), manifestA: MUG, manifestB: MUG });
assert.strictEqual(matched.changes[0].label, "intended");
assert.strictEqual(matched.changes[0].intentSource, "expected-text");
assert(matched.changes[0].intentReason.includes("taken away"));

/* A near miss names the entity but describes a different change. It must NOT
   pass, and it must force human review rather than quietly becoming a break. */
const nearMiss = applyIntent(removed, { shot: shotWith({ prop_mug: { expected: ["the enamel mug is repainted"] } }), manifestA: MUG, manifestB: MUG });
assert.strictEqual(nearMiss.changes[0].label, "possible-continuity-error", "a near-miss intent note must never approve the change");
assert.strictEqual(nearMiss.changes[0].intentSource, "near-miss");
assert.strictEqual(nearMiss.nearMissIntentCount, 1);
assert.strictEqual(nearMiss.label, "human-review", "a near-miss intent note must force human review");
/* Text that never names the entity is not intent about it at all. */
const unrelated = applyIntent(removed, { shot: shotWith({ prop_mug: { expected: ["the lamp is switched off"] } }), manifestA: MUG, manifestB: MUG });
assert.strictEqual(unrelated.changes[0].intentSource, null);
assert.strictEqual(unrelated.label, "possible-continuity-error");
assert.strictEqual(unrelated.nearMissIntentCount, 0);
/* The entity may be named by its display name as well as its id. */
assert.strictEqual(applyIntent(removed, { shot: shotWith({ prop_mug: { expected: ["prop_mug is removed"] } }), manifestA: MUG, manifestB: MUG }).changes[0].label, "intended");

/* ---- 17. intent: a human override, and the declared priority order ---- */
const human = applyIntent(removed, { manifestA: MUG, manifestB: MUG, humanIntentional: { "prop_mug:removed:presence": true } });
assert.strictEqual(human.changes[0].label, "intended");
assert.strictEqual(human.changes[0].intentSource, "human");
/* Structural and allowance descriptors are matched before any prose. */
const both = applyIntent(removed, { shot: shotWith({ prop_mug: { allowPresenceChange: "may-leave", expected: ["the enamel mug is repainted"] } }), manifestA: MUG, manifestB: MUG });
assert.strictEqual(both.changes[0].intentSource, "allowance", "a structured allowance must win over prose");
assert.strictEqual(both.nearMissIntentCount, 0);
/* Descriptors are inspectable data, not hidden behaviour. */
const descriptors = buildIntentDescriptors(shotWith({ prop_mug: { allowPresenceChange: "either", allowMovement: true } }), MUG, MUG);
assert.deepStrictEqual(descriptors.map((row) => row.kind).sort(), ["added", "moved", "removed"]);
for (const row of descriptors) assert.strictEqual(row.source, "allowance");

/* ---- 18. the human-review floor cannot be configured away ----

   No intent declaration of any kind may clear an uncertain presence, an
   unreadable attribute, an invalid record or an occlusion transition. */
const everythingAllowed = { allowPresenceChange: "either", allowMovement: true, allowColorChange: true, allowStateChange: true, expected: ["anything at all may happen to the enamel mug"] };
const FLOOR = [
  ["uncertain presence", compareObservations(side({ prop_mug: unsure() }), side({ prop_mug: present() }), MUG)],
  ["invalid record", compareObservations(side({ prop_mug: present({ bbox: null }) }), side({ prop_mug: present() }), MUG)],
  ["unreadable attribute", compareObservations(side({ prop_mug: present({ color: "white" }) }), side({ prop_mug: present({ color: "uncertain" }) }), MUG)],
  ["occlusion transition", compareObservations(side({ prop_mug: present() }), side({ prop_mug: present({ occlusion: "heavy" }) }), MUG)],
  ["missing record", compareObservations(side({}), side({ prop_mug: present() }), MUG)],
];
for (const [label, result] of FLOOR) {
  const applied = applyIntent(result, { shot: shotWith({ prop_mug: everythingAllowed }), manifestA: MUG, manifestB: MUG });
  assert.strictEqual(applied.label, "human-review", `${label} must reach human review even when every change is declared intended`);
  assert.strictEqual(applied.needsReview, true);
}
/* An explicitly designated occlusion case is review regardless of findings. */
assert.strictEqual(applyIntent(stable, { manifestA: MUG, manifestB: MUG, designatedOcclusion: true }).label, "human-review");

/* ---- 19. applyIntent is pure ---- */
const beforeApply = JSON.stringify(removed);
applyIntent(removed, { shot: shotWith({ prop_mug: { allowPresenceChange: "either" } }), manifestA: MUG, manifestB: MUG });
assert.strictEqual(JSON.stringify(removed), beforeApply, "applyIntent must not mutate the comparison it is given");
assert.strictEqual(
  JSON.stringify(applyIntent(removed, { manifestA: MUG, manifestB: MUG })),
  JSON.stringify(applyIntent(removed, { manifestA: MUG, manifestB: MUG })),
  "applyIntent must be byte-deterministic",
);

/* ---- 20. scale: 500 entities compare without pathological behaviour ----

   The comparison is O(n) by construction — one Map lookup per declared entity,
   no pairwise geometry — so this is a guard against an accidental O(n^2). */
const bulkRows = [];
for (let i = 0; i < 500; i++) bulkRows.push({ entity_id: `prop_${String(i).padStart(4, "0")}`, track_color: true, track_state: true, track_markings: true });
const BULK = manifestOf(bulkRows);
const bulkA = {};
const bulkB = {};
for (let i = 0; i < 500; i++) {
  const id = `prop_${String(i).padStart(4, "0")}`;
  bulkA[id] = present({ color: "white", bbox: [100, 100, 200, 200] });
  /* A representative spread: stable, removed, moved, recoloured, occluded. */
  bulkB[id] = i % 5 === 0 ? present({ color: "white" })
    : i % 5 === 1 ? absent()
      : i % 5 === 2 ? present({ color: "white", bbox: far })
        : i % 5 === 3 ? present({ color: "green" })
          : present({ color: "white", occlusion: "heavy" });
}
const started = process.hrtime.bigint();
const bulk = compareObservations(side(bulkA), side(bulkB), BULK);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
assert.strictEqual(bulk.n_entities, 500);
assert.strictEqual(bulk.changes.filter((row) => row.kind === "removed").length, 100);
assert.strictEqual(bulk.changes.filter((row) => row.kind === "moved").length, 100);
assert.strictEqual(bulk.changes.filter((row) => row.kind === "attribute").length, 100);
assert.strictEqual(bulk.uncertain.filter((row) => row.kind === "occlusion-transition").length, 100);
assert(elapsedMs < 250, `500-entity comparison took ${elapsedMs.toFixed(1)}ms, which suggests worse than linear behaviour`);
/* Repeating it is still byte-identical at scale. */
assert.strictEqual(JSON.stringify(bulk), JSON.stringify(compareObservations(side(bulkA), side(bulkB), BULK)));
const bulkApplied = applyIntent(bulk, { manifestA: BULK, manifestB: BULK });
assert.strictEqual(bulkApplied.label, "human-review", "occlusion transitions in the set force review");
console.log(`500-entity comparison: ${elapsedMs.toFixed(1)}ms, ${bulk.changes.length} changes, ${bulk.uncertain.length} uncertain, byte-identical on repeat.`);

console.log("Continuity comparison suite passed: identical observations are stable; an uncertain or occluded reading can never become a presence finding; invalid and missing records are excluded from every verdict; untracked attributes produce nothing; shade drift is separated from colour change; movement is geometric, thresholded and camera-gated; declared state, allowances, constrained prose and human overrides all resolve deterministically; a near-miss note forces review instead of passing; and no declaration can clear the human-review floor.");

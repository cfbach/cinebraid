/* CineBraid declared-entity continuity — observation validation semantics.

   `validation.ok` means "this response needed no handling of any kind". That is
   the right question for a qualification metric and the wrong one for a UI:
   CineBraid deterministically discarding an attribute it never intended to
   track makes ok false while leaving the evidence perfectly good.

   So there is a second, additive question — is the RECORD SET safe to use — and
   this suite pins exactly what it does and does not mean. It is not a
   continuity verdict: it says nothing about pass/fail, about occlusion, or
   about whether a change was intended. A heavily occluded observation is a
   truthful answer and is usable; the comparison layer is what routes it to
   human review.

   Offline. No provider, no network, no model. */
const assert = require("assert");

const {
  validateObservationSet,
  observationStatus,
  compareObservations,
  applyIntent,
  recordState,
  OBSERVATION_FLAGS,
  OBSERVATION_FLAG_SCOPE,
  OBSERVATION_STATUSES,
} = require("../public/shared-continuity");

function manifestOf(rows) {
  const entities = [...rows]
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0))
    .map((row) => ({
      entity_id: row.entity_id,
      display_name: row.display_name || row.entity_id,
      entity_type: "prop",
      parent_entity_id: null,
      continuity_unit: "self",
      identity_cues: "",
      allowed_state_values: null,
      track_presence: true,
      track_movement: true,
      track_color: row.track_color === true,
      track_state: row.track_state === true,
      track_markings: row.track_markings === true,
      cb_declared_state_id: "state-default",
      cb_declared_state_name: "Default",
    }));
  return { manifestHash: "0123456789abcdef0123", n: entities.length, entities };
}
const present = (patch = {}) => ({ presence: "present", occlusion: "none", identifiable: "yes", bbox: [100, 100, 200, 200], color: "not-applicable", state: "not-applicable", markings: "not-applicable", evidence: "seen", ...patch });
const unsure = (patch = {}) => ({ presence: "uncertain", occlusion: "uncertain", identifiable: "uncertain", bbox: null, color: "uncertain", state: "uncertain", markings: "uncertain", evidence: "unclear", ...patch });
const wrap = (entities) => ({ coordinate_mode: "permille", entities });
const side = (validation, observation) => ({ entities: observation.entities, states: validation.states });

const ONE = manifestOf([{ entity_id: "A" }]);
const TWO = manifestOf([{ entity_id: "A" }, { entity_id: "B" }]);
/* Attributes actually tracked, so a truthful "uncertain" on one of them is a
   legitimate tracked value rather than something policy discards. */
const TRACKED = manifestOf([
  { entity_id: "A", track_color: true, track_state: true, track_markings: true },
  { entity_id: "B", track_color: true, track_state: true, track_markings: true },
]);

/* ---- 0. the classification surface is complete and closed ---- */
assert.deepStrictEqual(OBSERVATION_STATUSES, ["clean", "usable_with_notes", "invalid"]);
for (const code of OBSERVATION_FLAGS)
  assert(["policy", "entity", "set"].includes(OBSERVATION_FLAG_SCOPE[code]), `flag ${code} has no declared scope`);
for (const code of Object.keys(OBSERVATION_FLAG_SCOPE))
  assert(OBSERVATION_FLAGS.includes(code), `scope declared for undeclared flag ${code}`);
/* Exactly two flags are set-wide, and both are unreachable while constrained
   decoding holds: coordinate_mode is a single-value enum and entities is a
   closed object. */
assert.deepStrictEqual(
  Object.keys(OBSERVATION_FLAG_SCOPE).filter((code) => OBSERVATION_FLAG_SCOPE[code] === "set").sort(),
  ["invalid_coordinate_mode", "malformed_response"],
);
assert.deepStrictEqual(
  Object.keys(OBSERVATION_FLAG_SCOPE).filter((code) => OBSERVATION_FLAG_SCOPE[code] === "policy"),
  ["untracked_attribute_discarded"],
);

/* ---- 1. a perfectly clean record ---- */
let result = validateObservationSet(ONE, wrap({ A: present() }));
assert.strictEqual(result.ok, true);
assert.strictEqual(result.status, "clean");
assert.strictEqual(result.usable, true);
assert.deepStrictEqual(result.blockingFlags, []);
assert.deepStrictEqual(result.flags, []);

/* ---- 2. a deterministic policy action: usable, but ok is false ----

   The multi-tone rule. CineBraid asked for no colour on this entity, the model
   volunteered one, and it was discarded before it could reach a comparison.
   Nothing about the evidence is in doubt. */
const colourOff = manifestOf([{ entity_id: "A", track_color: false }]);
result = validateObservationSet(colourOff, wrap({ A: present({ color: "gold" }) }));
assert.strictEqual(result.ok, false, "ok keeps its original meaning: something was handled");
assert.strictEqual(result.status, "usable_with_notes");
assert.strictEqual(result.usable, true, "a discarded untracked attribute must never make the evidence unusable");
assert.deepStrictEqual(result.blockingFlags, []);
assert.deepStrictEqual(result.flags.map((flag) => flag.code), ["untracked_attribute_discarded"]);
assert.strictEqual(result.entities.A.color, "not-applicable");
assert.strictEqual(result.states.A, "present", "the record itself is still a good observation");

/* ---- 3. heavy occlusion is a truthful answer, not a defect ----

   The status describes the record set, not the continuity outcome. Occlusion is
   the comparison layer's problem, and it handles it by requiring a person. */
result = validateObservationSet(TWO, wrap({ A: present(), B: present({ occlusion: "heavy" }) }));
assert.strictEqual(result.ok, true, "a heavily occluded record breaks no rule");
assert.strictEqual(result.status, "clean");
assert.strictEqual(result.usable, true);
assert.strictEqual(result.states.B, "present");

const clear = validateObservationSet(TWO, wrap({ A: present(), B: present() }));
const occluded = validateObservationSet(TWO, wrap({ A: present(), B: present({ occlusion: "heavy" }) }));
let comparison = applyIntent(
  compareObservations(side(clear, clear), side(occluded, occluded), TWO),
  { manifestA: TWO, manifestB: TWO },
);
assert.strictEqual(comparison.label, "human-review", "usable evidence can still demand human review");
assert(comparison.uncertain.some((row) => row.kind === "occlusion-transition"));
assert.deepStrictEqual(comparison.changes, [], "occlusion must never become a change");

/* ---- 4. an uncertain observation is usable and cannot be promoted ---- */
const trackedClear = validateObservationSet(TRACKED, wrap({ A: present({ color: "white", state: "not-applicable", markings: "none" }), B: present({ color: "white", state: "not-applicable", markings: "none" }) }));
const uncertain = validateObservationSet(TRACKED, wrap({ A: present({ color: "white", state: "not-applicable", markings: "none" }), B: unsure() }));
assert.strictEqual(uncertain.ok, true, "uncertainty is a contract value, not a fault");
assert.strictEqual(uncertain.status, "clean");
assert.strictEqual(uncertain.usable, true);
assert.strictEqual(uncertain.states.B, "uncertain");
comparison = applyIntent(
  compareObservations(side(trackedClear, trackedClear), side(uncertain, uncertain), TRACKED),
  { manifestA: TRACKED, manifestB: TRACKED },
);
assert(!comparison.changes.some((row) => ["removed", "added"].includes(row.kind)), "an uncertain reading must never become a hard presence issue");
assert(comparison.presence_uncertain.some((row) => row.entity_id === "B"));
assert.strictEqual(comparison.label, "human-review");

/* An uncertain record on an entity whose attributes are NOT tracked reports
   "uncertain" for them, which policy then discards. That is correct on both
   counts, and the set stays usable — worth pinning, because it is the one place
   a truthful answer and a policy action meet. */
const untrackedUncertain = validateObservationSet(TWO, wrap({ A: present(), B: unsure() }));
assert.strictEqual(untrackedUncertain.ok, false);
assert.strictEqual(untrackedUncertain.status, "usable_with_notes");
assert.strictEqual(untrackedUncertain.usable, true);
assert.deepStrictEqual([...new Set(untrackedUncertain.flags.map((flag) => flag.code))], ["untracked_attribute_discarded"]);
assert.strictEqual(untrackedUncertain.states.B, "uncertain", "the presence reading is untouched by the attribute discard");

/* ---- 5. a structurally unusable response ----

   Nothing left to use, however it happened. */
result = validateObservationSet(ONE, wrap({ A: present({ bbox: null }) }));
assert.strictEqual(result.ok, false);
assert.strictEqual(result.status, "invalid");
assert.strictEqual(result.usable, false);
assert.strictEqual(result.states.A, "invalid");

for (const [label, parsed] of [
  ["no entities object", null],
  ["entities is an array", { coordinate_mode: "permille", entities: [] }],
  ["not an object at all", "text"],
]) {
  const bad = validateObservationSet(ONE, parsed);
  assert.strictEqual(bad.status, "invalid", `${label} must be invalid`);
  assert.strictEqual(bad.usable, false);
  assert.deepStrictEqual(bad.blockingFlags, ["malformed_response"]);
}
/* A wrong coordinate frame silently corrupts every bbox at once, so it poisons
   the set even though each record passes its own shape check. */
const wrongFrame = validateObservationSet(TWO, { coordinate_mode: "pixels", entities: { A: present(), B: present() } });
assert.strictEqual(wrongFrame.status, "invalid");
assert.strictEqual(wrongFrame.usable, false);
assert.deepStrictEqual(wrongFrame.blockingFlags, ["invalid_coordinate_mode"]);
assert.strictEqual(wrongFrame.states.A, "present", "the individual records still pass their own shape check — which is exactly why the set-level flag matters");

/* ---- 6. one bad record does not condemn the whole set ----

   Phase 1 already excludes that entity from automatic verdicts and routes it to
   review. The remaining records are evidence. */
const partly = validateObservationSet(TWO, wrap({ A: present(), B: present({ bbox: null }) }));
assert.strictEqual(partly.ok, false);
assert.strictEqual(partly.status, "usable_with_notes");
assert.strictEqual(partly.usable, true, "a usable record beside a broken one must stay usable");
assert.deepStrictEqual(partly.invalidEntityIds, ["B"]);
assert.strictEqual(partly.states.A, "present");
comparison = compareObservations(side(clear, clear), side(partly, partly), TWO);
assert(comparison.invalid_records.some((row) => row.entity_id === "B"), "the broken entity is excluded, not trusted");
assert.strictEqual(comparison.invalid_records.length, 1);

/* A missing record behaves the same way: noted, excluded, set still usable. */
const missing = validateObservationSet(TWO, wrap({ A: present() }));
assert.strictEqual(missing.status, "usable_with_notes");
assert.strictEqual(missing.usable, true);
assert.deepStrictEqual(missing.flags.map((flag) => flag.code), ["missing_entity_id"]);
/* Unless it is the only entity there was. */
assert.strictEqual(validateObservationSet(ONE, wrap({})).status, "invalid");

/* An undeclared id is dropped; the declared records are unaffected. */
const extra = validateObservationSet(ONE, wrap({ A: present(), Z: present() }));
assert.strictEqual(extra.status, "usable_with_notes");
assert.strictEqual(extra.usable, true);
assert.deepStrictEqual(Object.keys(extra.entities), ["A"]);

/* ---- 7. status is derived, deterministic and recomputable ----

   This is what lets a cache entry written before the field existed gain it on
   read, with no cache format bump and no re-observation. */
for (const value of [ONE, TWO, colourOff]) {
  const sample = validateObservationSet(value, wrap({ A: present({ color: "gold" }) }));
  assert.strictEqual(observationStatus(sample.flags, sample.states), sample.status, "status must be reproducible from flags and states alone");
}
assert.strictEqual(observationStatus([], {}), "clean");
assert.strictEqual(observationStatus(undefined, undefined), "clean");
assert.strictEqual(observationStatus([{ code: "untracked_attribute_discarded" }], { A: "present" }), "usable_with_notes");
assert.strictEqual(observationStatus([{ code: "malformed_response" }], {}), "invalid");
assert.strictEqual(observationStatus([], { A: "invalid", B: "invalid" }), "invalid");
assert.strictEqual(observationStatus([], { A: "invalid", B: "present" }), "clean", "states alone do not invent a flag; only a total loss is invalid");
/* Repeated derivation is byte-identical. */
const twice = validateObservationSet(colourOff, wrap({ A: present({ color: "gold" }) }));
assert.strictEqual(JSON.stringify(twice), JSON.stringify(validateObservationSet(colourOff, wrap({ A: present({ color: "gold" }) }))));

/* ---- 8. ok keeps its original meaning ----

   Nothing may quietly redefine it: the qualification metrics depend on it. */
assert.strictEqual(validateObservationSet(ONE, wrap({ A: present() })).ok, true);
for (const parsed of [wrap({ A: present({ bbox: null }) }), wrap({}), null])
  assert.strictEqual(validateObservationSet(ONE, parsed).ok, false);
assert.strictEqual(validateObservationSet(colourOff, wrap({ A: present({ color: "gold" }) })).ok, false, "ok is still false for a policy action");

/* ---- 9. the status says nothing about continuity ----

   Two clean, usable observations that differ produce a continuity finding; the
   status of each is still clean. */
const before = validateObservationSet(ONE, wrap({ A: present() }));
const after = validateObservationSet(ONE, wrap({ A: { presence: "absent", occlusion: "not-applicable", identifiable: "no", bbox: null, color: "not-applicable", state: "not-applicable", markings: "not-applicable", evidence: "gone" } }));
assert.strictEqual(before.status, "clean");
assert.strictEqual(after.status, "clean");
assert.strictEqual(after.usable, true);
comparison = applyIntent(compareObservations(side(before, before), side(after, after), ONE), { manifestA: ONE, manifestB: ONE });
assert.strictEqual(comparison.changes[0].kind, "removed", "a clean, usable observation set is exactly what a real finding is built from");
assert.strictEqual(comparison.label, "possible-continuity-error");
assert.strictEqual(recordState(after.entities.A), "absent");

/* ---- 10. an illegal TRACKED value can never become a change ---------------

   The distinction that matters: an untracked attribute is one CineBraid never
   asked about, so its value is irrelevant and is discarded. A tracked attribute
   with an illegal value is one CineBraid DID ask about and got an unusable
   answer — it is neutralised to the contract's own word for "could not be
   read", so the comparison reports it unreadable and routes it to review
   instead of inventing a change out of a value that means nothing. */
const TRACKED_ONE = manifestOf([{ entity_id: "A", track_color: true, track_markings: true, track_state: true }]);

/* Baseline: a valid tracked colour comparison still works normally. */
const white = validateObservationSet(TRACKED_ONE, wrap({ A: present({ color: "white", markings: "none" }) }));
const green = validateObservationSet(TRACKED_ONE, wrap({ A: present({ color: "green", markings: "none" }) }));
assert.strictEqual(white.status, "clean");
assert.strictEqual(green.status, "clean");
let cmp = compareObservations(side(white, white), side(green, green), TRACKED_ONE);
assert.strictEqual(cmp.changes.length, 1, "a legitimate colour change is still reported");
assert.strictEqual(cmp.changes[0].attribute, "color");
assert.deepStrictEqual(cmp.attribute_unreadable, []);

for (const [field, legal, illegal, second] of [
  ["color", "white", "bluish-purple?", "also-not-a-colour"],
  ["markings", "none", "squiggles", "doodles"],
  ["state", "not-applicable", "half-open", "half-shut"],
]) {
  const good = validateObservationSet(TRACKED_ONE, wrap({ A: present({ [field]: legal }) }));
  const bad = validateObservationSet(TRACKED_ONE, wrap({ A: present({ [field]: illegal }) }));

  assert.strictEqual(bad.ok, false, `${field}: an illegal tracked value must be flagged`);
  assert.strictEqual(bad.status, "usable_with_notes", `${field}: one bad attribute must not condemn the record`);
  assert.strictEqual(bad.usable, true);
  const flag = bad.flags.find((row) => row.code === "invalid_enum" && row.field === field);
  assert(flag, `${field}: the flag must name the attribute structurally, not only in prose`);
  assert.strictEqual(flag.entityId, "A");
  /* Neutralised, never coerced to a plausible value and never left as-is. */
  assert.strictEqual(bad.entities.A[field], "uncertain", `${field}: an illegal tracked value must be neutralised to unreadable`);
  assert.notStrictEqual(bad.entities.A[field], illegal);
  /* The rest of the record is untouched. */
  assert.strictEqual(bad.states.A, "present", `${field}: presence evidence must survive one bad attribute`);
  assert.deepStrictEqual(bad.entities.A.bbox, [100, 100, 200, 200], `${field}: bbox evidence must survive`);

  /* And the comparison can never turn it into a change, in either direction. */
  for (const [left, right, label] of [[good, bad, "valid -> illegal"], [bad, good, "illegal -> valid"]]) {
    const result = compareObservations(side(left, left), side(right, right), TRACKED_ONE);
    assert(!result.changes.some((row) => row.attribute === field), `${field} (${label}): an illegal value must NEVER produce a ${field} change`);
    assert(result.attribute_unreadable.some((row) => row.attribute === field && row.kind === "attribute-unreadable"), `${field} (${label}): it must surface as unreadable evidence`);
    const applied = applyIntent(result, { manifestA: TRACKED_ONE, manifestB: TRACKED_ONE });
    assert.strictEqual(applied.label, "human-review", `${field} (${label}): unreadable tracked evidence must reach human review`);
  }
  /* Two different illegal values are still not a change between themselves. */
  const alsoBad = validateObservationSet(TRACKED_ONE, wrap({ A: present({ [field]: second }) }));
  const both = compareObservations(side(bad, bad), side(alsoBad, alsoBad), TRACKED_ONE);
  assert(!both.changes.some((row) => row.attribute === field), `${field}: two unreadable values must not be a change`);
}

/* ---- 11. one bad attribute does not spread ---- */
const TRACKED_PAIR = manifestOf([
  { entity_id: "A", track_color: true, track_markings: true },
  { entity_id: "B", track_color: true, track_markings: true },
]);
const mixedGood = validateObservationSet(TRACKED_PAIR, wrap({ A: present({ color: "white", markings: "none" }), B: present({ color: "white", markings: "none" }) }));
const mixedBad = validateObservationSet(TRACKED_PAIR, wrap({ A: present({ color: "not-a-colour", markings: "none" }), B: present({ color: "green", markings: "none" }) }));
assert.strictEqual(mixedBad.entities.A.color, "uncertain");
assert.strictEqual(mixedBad.entities.A.markings, "none", "a sibling attribute on the same entity is untouched");
assert.strictEqual(mixedBad.entities.B.color, "green", "another entity is untouched");
cmp = compareObservations(side(mixedGood, mixedGood), side(mixedBad, mixedBad), TRACKED_PAIR);
assert(!cmp.changes.some((row) => row.entity_id === "A" && row.attribute === "color"));
assert(cmp.attribute_unreadable.some((row) => row.entity_id === "A" && row.attribute === "color"));
assert(cmp.changes.some((row) => row.entity_id === "B" && row.attribute === "color"), "an unaffected entity still produces its real finding");

/* ---- 12. untracked and illegal-tracked stay distinct ---- */
const untrackedColour = manifestOf([{ entity_id: "A", track_color: false }]);
const untracked = validateObservationSet(untrackedColour, wrap({ A: present({ color: "gold" }) }));
assert.strictEqual(untracked.entities.A.color, "not-applicable", "never asked -> discarded");
assert.deepStrictEqual(untracked.flags.map((row) => row.code), ["untracked_attribute_discarded"]);
const trackedIllegal = validateObservationSet(TRACKED_ONE, wrap({ A: present({ color: "gold-ish" }) }));
assert.strictEqual(trackedIllegal.entities.A.color, "uncertain", "asked but unusable -> unreadable");
assert(trackedIllegal.flags.some((row) => row.code === "invalid_enum" && row.field === "color"));
assert(!trackedIllegal.flags.some((row) => row.code === "untracked_attribute_discarded"));
/* An untracked attribute is never validated at all: we did not ask, so its
   value cannot be "wrong". */
const untrackedIllegal = validateObservationSet(untrackedColour, wrap({ A: present({ color: "not-a-colour" }) }));
assert.deepStrictEqual(untrackedIllegal.flags.map((row) => row.code), ["untracked_attribute_discarded"], "an untracked attribute must not also be reported as an illegal value");

/* ---- 13. every flag carries a structured field, so no caller parses prose ---- */
for (const sample of [trackedIllegal, untracked, validateObservationSet(ONE, wrap({})), validateObservationSet(ONE, null)])
  for (const flag of sample.flags) {
    assert.strictEqual(typeof flag.field, "string", "every flag must carry a field, even if empty");
    assert.strictEqual(typeof flag.entityId, "string");
    assert(OBSERVATION_FLAGS.includes(flag.code));
  }

console.log("Continuity validation-status suite passed: ok keeps its original meaning while status/usable answer whether the record set is safe to use; a discarded untracked attribute is usable_with_notes, heavy occlusion and uncertainty stay clean and usable while the comparison layer routes them to review, one broken record does not condemn a set but a total loss or a set-wide integrity failure does, the status is derived deterministically from flags and states so it can be recomputed for evidence stored before it existed, and an illegal value on a TRACKED attribute is neutralised to unreadable so it can never become a colour, markings or state change while presence, bbox, sibling attributes and other entities all stay usable.");

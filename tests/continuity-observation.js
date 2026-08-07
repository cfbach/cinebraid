/* CineBraid declared-entity continuity — observation contract and validation.

   The schema is generated per manifest and is entity-KEYED: `entities` is a
   closed object whose keys are exactly the declared entity ids and whose
   `required` names every one of them. That is what makes "no invented entity,
   no omitted entity, no split, no merge" structural rather than hopeful.

   Cross-field consistency is NOT in the grammar — a oneOf expressing it caused
   constrained-decoding whitespace loops and truncations on the qualified vLLM
   path. It is enforced here after parsing by recordState(), which classifies
   and never coerces.

   Section 20 replays the exact 51-response / 615-record set that qualified this
   contract on the DGX Spark. Offline. No provider, no network, no model. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  validateObservationSet,
  buildObservationSchema,
  recordState,
  bboxIsValid,
  OBSERVATION_FLAGS,
  PRESENCE_VALUES,
  OCCLUSION_VALUES,
  IDENTIFIABLE_VALUES,
  MARKINGS_VALUES,
  COLOR_VALUES,
  EVIDENCE_MAX,
  CONTINUITY_OBSERVATION_CONTRACT_VERSION,
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
      identity_cues: row.identity_cues || "",
      allowed_state_values: row.allowed_state_values || null,
      track_presence: row.track_presence !== false,
      track_movement: row.track_movement !== false,
      track_color: row.track_color === true,
      track_state: row.track_state === true,
      track_markings: row.track_markings === true,
      cb_declared_state_id: "state-default",
      cb_declared_state_name: "Default",
    }));
  return { manifestVersion: "continuity-manifest-v1", shotId: "S-01", frameId: "frame-a", n: entities.length, entities, manifestHash: "0123456789abcdef0123" };
}
const present = (patch = {}) => ({ presence: "present", occlusion: "none", identifiable: "yes", bbox: [10, 10, 100, 100], color: "not-applicable", state: "not-applicable", markings: "not-applicable", evidence: "seen", ...patch });
const absent = (patch = {}) => ({ presence: "absent", occlusion: "not-applicable", identifiable: "no", bbox: null, color: "not-applicable", state: "not-applicable", markings: "not-applicable", evidence: "not visible", ...patch });
const unsure = (patch = {}) => ({ presence: "uncertain", occlusion: "uncertain", identifiable: "uncertain", bbox: null, color: "uncertain", state: "uncertain", markings: "uncertain", evidence: "unclear", ...patch });
const wrap = (entities) => ({ coordinate_mode: "permille", entities });
const codes = (result) => [...new Set(result.flags.map((flag) => flag.code))].sort();

/* ---- 1. the generated schema is closed on the declared entity set ---- */
const twoEntities = manifestOf([{ entity_id: "prop_mug" }, { entity_id: "char_person", entity_type: "character" }]);
const schema = buildObservationSchema(twoEntities);
assert.deepStrictEqual(schema.required, ["coordinate_mode", "entities"]);
assert.deepStrictEqual(schema.properties.coordinate_mode.enum, ["permille"]);
assert.strictEqual(schema.additionalProperties, false);
const entitiesSchema = schema.properties.entities;
assert.strictEqual(entitiesSchema.type, "object", "entities must be an object keyed by entity id, not an array of records");
assert.strictEqual(entitiesSchema.additionalProperties, false, "a closed entity map is what makes an invented entity id impossible");
assert.deepStrictEqual(entitiesSchema.required, ["char_person", "prop_mug"], "every declared entity must be required, which is what makes an omitted id impossible");
assert.deepStrictEqual(Object.keys(entitiesSchema.properties).sort(), ["char_person", "prop_mug"]);

const recordSchema = entitiesSchema.properties.prop_mug;
assert.deepStrictEqual(recordSchema.required, ["presence", "occlusion", "identifiable", "bbox", "color", "state", "markings", "evidence"]);
assert.strictEqual(recordSchema.additionalProperties, false);
assert.deepStrictEqual(recordSchema.properties.presence.enum, ["present", "absent", "uncertain"]);
assert.deepStrictEqual(recordSchema.properties.occlusion.enum, ["none", "partial", "heavy", "uncertain", "not-applicable"]);
assert.deepStrictEqual(recordSchema.properties.identifiable.enum, ["yes", "no", "uncertain"]);
assert.deepStrictEqual(recordSchema.properties.markings.enum, ["none", "text", "pattern", "not-applicable", "uncertain"]);
assert.strictEqual(recordSchema.properties.color.enum.length, 24, "the colour vocabulary is a closed enum, not free text");
assert.strictEqual(recordSchema.properties.evidence.maxLength, EVIDENCE_MAX);
/* presence and occlusion stay separate concepts and neither constrains the
   other in the grammar. */
assert(!recordSchema.properties.presence.enum.includes("occluded"), "occlusion must never be folded into presence");
/* oneOf is the specific construct that broke constrained decoding. anyOf, used
   for the nullable bbox, is the shape the qualification actually ran. */
const schemaText = JSON.stringify(schema);
for (const forbidden of ["oneOf", "if", "then", "else", "not", "dependentSchemas", "dependentRequired"])
  assert(!schemaText.includes(`"${forbidden}"`), `the observation schema must not use ${forbidden}`);
assert(schemaText.includes('"anyOf"'), "bbox is legitimately nullable through anyOf");
assert.deepStrictEqual(recordSchema.properties.bbox.anyOf[0].items, { type: "integer", minimum: 0, maximum: 1000 });
/* Nothing provider-specific may leak into a provider-neutral contract. */
for (const forbidden of ["guided_json", "response_format", "vllm", "nemotron", "ollama", "openai"])
  assert(!schemaText.toLowerCase().includes(forbidden), `the schema must stay provider-neutral (found ${forbidden})`);

/* The per-entity state enum is production's vocabulary plus the two escapes. */
const stateful = manifestOf([{ entity_id: "prop_door", track_state: true, allowed_state_values: ["open", "closed"] }]);
assert.deepStrictEqual(
  buildObservationSchema(stateful).properties.entities.properties.prop_door.properties.state.enum,
  ["open", "closed", "not-applicable", "uncertain"],
);
assert.deepStrictEqual(recordSchema.properties.state.enum, ["not-applicable", "uncertain"], "an entity with no declared vocabulary can still answer not-applicable or uncertain");

/* ---- 2. recordState: the three legal shapes, classified and never coerced ---- */
assert.strictEqual(recordState(present()), "present");
assert.strictEqual(recordState(absent()), "absent");
assert.strictEqual(recordState(unsure()), "uncertain");
assert.strictEqual(recordState(unsure({ bbox: [1, 2, 3, 4] })), "uncertain", "an uncertain record may localise a possible remnant");
for (const occlusion of ["none", "partial", "heavy", "uncertain"])
  assert.strictEqual(recordState(present({ occlusion })), "present");
/* A present record must carry a box; a fabricated box on an absent record and
   a missing box on a present one are both invalid, never repaired. */
assert.strictEqual(recordState(present({ bbox: null })), "invalid");
assert.strictEqual(recordState(present({ occlusion: "not-applicable" })), "invalid");
assert.strictEqual(recordState(absent({ bbox: [1, 2, 3, 4] })), "invalid", "a fabricated bounding box on an absent entity is invalid");
assert.strictEqual(recordState(absent({ occlusion: "heavy" })), "invalid", "absence cannot be reported through an occlusion that would hide it");
assert.strictEqual(recordState(absent({ occlusion: "none" })), "invalid");
assert.strictEqual(recordState(absent({ identifiable: "yes" })), "invalid", "an absent entity cannot also be identifiable");
assert.strictEqual(recordState(unsure({ occlusion: "none" })), "invalid");
assert.strictEqual(recordState(unsure({ identifiable: "yes" })), "invalid");
assert.strictEqual(recordState({ presence: "maybe" }), "invalid");
for (const junk of [null, undefined, "text", 7, []]) assert.strictEqual(recordState(junk), "invalid");
/* bbox validity is exactly four integers in permille range. */
assert(bboxIsValid([0, 0, 1000, 1000]));
for (const bad of [null, [], [1, 2, 3], [1, 2, 3, 4, 5], [1, 2, 3, "4"], [1, 2, 3, 1001], [-1, 0, 1, 2], [1.5, 2, 3, 4]])
  assert(!bboxIsValid(bad), `${JSON.stringify(bad)} must not be a valid bbox`);

/* ---- 3. a clean set validates with no flags ---- */
const cleanResult = validateObservationSet(twoEntities, wrap({ char_person: present(), prop_mug: present() }));
assert.strictEqual(cleanResult.ok, true);
assert.deepStrictEqual(cleanResult.flags, []);
assert.deepStrictEqual(cleanResult.invalidEntityIds, []);
assert.strictEqual(cleanResult.contractVersion, CONTINUITY_OBSERVATION_CONTRACT_VERSION);
assert.strictEqual(cleanResult.manifestHash, twoEntities.manifestHash);
assert.deepStrictEqual(Object.keys(cleanResult.states).sort(), ["char_person", "prop_mug"]);

/* ---- 4. validation is deterministic and non-mutating ---- */
const parsed = wrap({ char_person: present(), prop_mug: absent() });
const snapshot = JSON.stringify(parsed);
assert.strictEqual(
  JSON.stringify(validateObservationSet(twoEntities, parsed)),
  JSON.stringify(validateObservationSet(twoEntities, JSON.parse(snapshot))),
  "repeated validation must be byte-identical",
);
assert.strictEqual(JSON.stringify(parsed), snapshot, "validation must not mutate the parsed model response");

/* ---- 5. a missing entity is recorded, never silently dropped ---- */
const missing = validateObservationSet(twoEntities, wrap({ char_person: present() }));
assert(codes(missing).includes("missing_entity_id"));
assert.strictEqual(missing.states.prop_mug, "invalid", "an unanswered entity must not be automatically judgeable");
assert.strictEqual(missing.entities.prop_mug.presence, "uncertain");
assert.deepStrictEqual(missing.invalidEntityIds, ["prop_mug"]);

/* ---- 6. an undeclared entity id is rejected, never adopted ---- */
const undeclared = validateObservationSet(twoEntities, wrap({ char_person: present(), prop_mug: present(), prop_invented: present() }));
assert(codes(undeclared).includes("undeclared_entity_id"));
assert.deepStrictEqual(Object.keys(undeclared.entities).sort(), ["char_person", "prop_mug"], "an undeclared id must not become a tracked entity");

/* ---- 7. an illegal record shape is flagged and excluded, not repaired ---- */
const broken = validateObservationSet(twoEntities, wrap({ char_person: present(), prop_mug: absent({ bbox: [5, 5, 9, 9] }) }));
assert(codes(broken).includes("invalid_record_shape"));
assert.strictEqual(broken.states.prop_mug, "invalid");
assert.deepStrictEqual(broken.entities.prop_mug.bbox, [5, 5, 9, 9], "the raw record is preserved for review rather than rewritten");

/* ---- 8. out-of-vocabulary values are flagged ----

   Structural fields are always meaningful, so an illegal value there is always
   an invalid_enum and makes the record itself untrustworthy. */
const badStructural = validateObservationSet(twoEntities, wrap({ char_person: present({ occlusion: "mostly" }), prop_mug: present() }));
assert(codes(badStructural).includes("invalid_enum"));
assert.strictEqual(badStructural.states.char_person, "invalid");

/* A TRACKED attribute with an illegal value is flagged and neutralised to
   unreadable, so it can never become a change; the record survives. */
const colourTracked = manifestOf([{ entity_id: "prop_mug", track_color: true }]);
const badEnum = validateObservationSet(colourTracked, wrap({ prop_mug: present({ color: "chartreuse" }) }));
assert(codes(badEnum).includes("invalid_enum"));
assert.strictEqual(badEnum.flags.find((flag) => flag.code === "invalid_enum").field, "color");
assert.strictEqual(badEnum.entities.prop_mug.color, "uncertain", "an illegal tracked value is neutralised, never coerced or kept");
assert.strictEqual(badEnum.states.prop_mug, "present", "one bad attribute must not discard the whole record");

/* An UNTRACKED attribute is never validated at all: CineBraid did not ask, so
   whatever came back is simply discarded rather than judged. */
const untrackedIllegal = validateObservationSet(twoEntities, wrap({ char_person: present({ color: "chartreuse" }), prop_mug: present() }));
assert(!codes(untrackedIllegal).includes("invalid_enum"), "an untracked attribute has no vocabulary to violate");
assert(codes(untrackedIllegal).includes("untracked_attribute_discarded"));
assert.strictEqual(untrackedIllegal.entities.char_person.color, "not-applicable");
const badMode = validateObservationSet(twoEntities, { coordinate_mode: "pixels", entities: { char_person: present(), prop_mug: present() } });
assert(codes(badMode).includes("invalid_coordinate_mode"));

/* ---- 9. an untracked attribute is DISCARDED before comparison ----

   This is the production rule that makes a multi-tone object safe. If the
   value survived validation, a colour finding could still be produced no
   matter what the tracking policy said. */
const watchManifest = manifestOf([{ entity_id: "acc_wristwatch", track_color: false, track_state: false, track_markings: false }]);
const leaked = validateObservationSet(watchManifest, wrap({ acc_wristwatch: present({ color: "gold", state: "uncertain", markings: "text" }) }));
assert(codes(leaked).includes("untracked_attribute_discarded"));
assert.strictEqual(leaked.entities.acc_wristwatch.color, "not-applicable", "an untracked colour must never reach the comparison engine");
assert.strictEqual(leaked.entities.acc_wristwatch.state, "not-applicable");
assert.strictEqual(leaked.entities.acc_wristwatch.markings, "not-applicable");
assert.strictEqual(leaked.states.acc_wristwatch, "present", "discarding an untracked attribute is a repair, not a broken record");
/* A tracked colour survives untouched. */
const trackedColour = manifestOf([{ entity_id: "prop_mug", track_color: true }]);
assert.strictEqual(validateObservationSet(trackedColour, wrap({ prop_mug: present({ color: "white" }) })).entities.prop_mug.color, "white");

/* ---- 10. malformed responses fail conservatively, never quietly ---- */
for (const bad of [null, undefined, {}, [], "text", 42, { entities: null }, { entities: [] }, { coordinate_mode: "permille" }]) {
  const result = validateObservationSet(twoEntities, bad);
  assert.strictEqual(result.ok, false, `a malformed response (${JSON.stringify(bad)}) must not validate`);
  assert(codes(result).includes("malformed_response"));
  assert.deepStrictEqual(result.invalidEntityIds, ["char_person", "prop_mug"], "no entity may be automatically judged from a malformed response");
}
/* An empty manifest with an empty answer is legitimately fine. */
assert.strictEqual(validateObservationSet(manifestOf([]), wrap({})).ok, true);

/* ---- 11. flags are ordered deterministically and all are declared ---- */
const manyFlags = validateObservationSet(
  manifestOf([{ entity_id: "z_ent" }, { entity_id: "a_ent" }, { entity_id: "m_ent" }]),
  wrap({ m_ent: present({ markings: "banana" }), a_ent: absent({ bbox: [1, 1, 2, 2] }), q_ent: present() }),
);
const ordered = manyFlags.flags.map((flag) => `${flag.entityId}:${flag.code}`);
assert.deepStrictEqual(ordered, [...ordered].sort(), "flags must be emitted in a stable sorted order");
for (const result of [missing, undeclared, broken, badEnum, badMode, leaked, manyFlags])
  for (const flag of result.flags) assert(OBSERVATION_FLAGS.includes(flag.code), `validation emitted an undeclared flag code: ${flag.code}`);

/* ---- 12. the exported vocabulary matches the generated schema ---- */
assert.deepStrictEqual(PRESENCE_VALUES, recordSchema.properties.presence.enum);
assert.deepStrictEqual(OCCLUSION_VALUES, recordSchema.properties.occlusion.enum);
assert.deepStrictEqual(IDENTIFIABLE_VALUES, recordSchema.properties.identifiable.enum);
assert.deepStrictEqual(MARKINGS_VALUES, recordSchema.properties.markings.enum);
assert.deepStrictEqual(COLOR_VALUES, recordSchema.properties.color.enum);

/* ---- 20. qualified Spark benchmark replay ---------------------------------

   The exact raw model output that qualified this contract (arm F,
   nemotron_3_nano_omni, 51 responses over 615 declared records), replayed
   offline against this port. The fixture is never regenerated, cleaned or
   reformatted to make the suite agree: the recorded metrics are the assertion.

   Fixture-optional so a checkout without it still runs every rule above. */
const benchmarkPath = path.join(__dirname, "fixtures", "continuity", "spark-51-response-benchmark.json");
if (fs.existsSync(benchmarkPath)) {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
  const recorded = benchmark.recordedMetrics;

  /* The request shape that was actually qualified, asserted from the recorded
     evidence rather than from anybody's memory of it. */
  assert.strictEqual(benchmark.request.responseFormat, "json_schema");
  assert.strictEqual(benchmark.request.strict, true);
  assert.strictEqual(benchmark.request.imagesPerRequest, 1, "the qualified contract is one image per request");
  assert.deepStrictEqual(benchmark.request.chatTemplateKwargs, { enable_thinking: false });

  const metrics = { n: 0, json: 0, schema: 0, empty: 0, truncated: 0, missing: 0, undeclared: 0 };
  let records = 0;
  const invalidCrossField = [];
  for (const item of benchmark.cases) {
    metrics.n += 1;
    const manifest = { ...benchmark.manifests[item.policy], manifestHash: "fixture" };
    const raw = item.response;
    if (!String(raw || "").trim()) metrics.empty += 1;
    let parsed = null;
    try { parsed = JSON.parse(raw); metrics.json += 1; } catch { metrics.truncated += 1; }
    const result = validateObservationSet(manifest, parsed);
    records += manifest.entities.length;
    const seen = new Set(result.flags.map((flag) => flag.code));
    metrics.missing += result.flags.filter((flag) => flag.code === "missing_entity_id").length;
    metrics.undeclared += result.flags.filter((flag) => flag.code === "undeclared_entity_id").length;
    /* "schema valid" is the recorded sense: the response satisfied the
       generated grammar. An untracked-attribute discard is a CineBraid policy
       repair, not a grammar failure, so it does not count against it. */
    if (!seen.has("malformed_response") && !seen.has("invalid_enum") && !seen.has("invalid_coordinate_mode")
      && !seen.has("missing_entity_id") && !seen.has("undeclared_entity_id")) metrics.schema += 1;
    for (const id of result.invalidEntityIds) invalidCrossField.push(`${item.caseId}:${id}`);
  }

  assert.strictEqual(metrics.n, recorded.n, "response count must match the recorded run");
  assert.strictEqual(metrics.n, 51);
  assert.strictEqual(records, 615, "the qualified run covered 615 declared entity records");
  assert.strictEqual(metrics.json, recorded.json, `JSON-valid must reproduce (${recorded.json})`);
  assert.strictEqual(metrics.schema, recorded.schema, `schema-valid must reproduce (${recorded.schema})`);
  assert.strictEqual(metrics.empty, recorded.empty, "empty responses must reproduce (0)");
  assert.strictEqual(metrics.truncated, recorded.truncated, "truncations must reproduce (0)");
  assert.strictEqual(metrics.missing, recorded.missing, "missing entity ids must reproduce (0)");
  assert.strictEqual(metrics.undeclared, recorded.undeclared, "undeclared entity ids must reproduce (0)");
  assert.deepStrictEqual(invalidCrossField, [], "no record in the qualified set may fail the cross-field shape check");

  console.log(`Qualified Spark benchmark replayed offline: ${metrics.n} responses / ${records} records — JSON ${metrics.json}/51, schema ${metrics.schema}/51, empty ${metrics.empty}, truncated ${metrics.truncated}, missing ids ${metrics.missing}, undeclared ids ${metrics.undeclared}, invalid cross-field records 0/615.`);
} else {
  console.log(`Qualified Spark benchmark fixture not present — skipped. Expected at ${benchmarkPath}.`);
}

console.log("Continuity observation suite passed: the generated schema is entity-keyed and closed so invented, omitted, split and merged entities are structurally impossible; recordState classifies the three legal shapes and never coerces; untracked attributes are discarded before comparison; malformed responses fail loudly with every entity marked unjudgeable; and validation is byte-identical on repeat.");

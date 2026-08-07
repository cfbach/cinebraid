/* CineBraid declared-entity continuity — tolerant response deserialization.

   A 167-request Spark qualification found a decoder TERMINATION defect: a
   substantially complete strict-schema observation missing exactly one closing
   brace, followed by thousands of characters of legal whitespace until
   max_tokens. All 27 captured failures were recoverable and every recovered
   response then passed the existing strict validator.

   The whole risk of a repair like this is that it becomes a JSON healer. So
   most of this suite is about what recovery must REFUSE to do, and about the
   guarantee that a valid response is not touched at all.

   Offline. No provider, no network, no model. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  MAX_APPENDED_DELIMITERS,
  RECOVERY_NONE,
  RECOVERY_CONTROL,
  RECOVERY_EOF,
  RECOVERY_BOTH,
  parseContinuityResponse,
} = require("../continuity-json");
const { validateObservationSet, buildObservationSchema } = require("../public/shared-continuity");

const results = [];
const pass = (line) => results.push(line);
const FF = String.fromCharCode(0x0c);

/* A manifest and a well-formed observation of it, shaped exactly as the
   qualified contract produces them. */
const MANIFEST = {
  manifestHash: "fixture",
  entities: [
    {
      entity_id: "CHAR-KAI", display_name: "Kai", entity_type: "character",
      allowed_state_values: null,
      track_presence: true, track_movement: true, track_color: false, track_state: true, track_markings: false,
    },
    {
      entity_id: "PROP-MUG", display_name: "Enamel mug", entity_type: "prop",
      allowed_state_values: null,
      track_presence: true, track_movement: true, track_color: true, track_state: true, track_markings: false,
    },
  ],
};
const record = (patch = {}) => ({
  presence: "present", occlusion: "none", identifiable: "yes", bbox: [100, 100, 200, 200],
  color: "white", state: "not-applicable", markings: "not-applicable", evidence: "visible in frame", ...patch,
});
const VALID = JSON.stringify({
  coordinate_mode: "permille",
  entities: { "CHAR-KAI": record({ color: "not-applicable" }), "PROP-MUG": record() },
});

/* ---- 1. the normal path is untouched ------------------------------------- */
{
  const result = parseContinuityResponse(VALID);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.recovery, RECOVERY_NONE, "a valid response must report no recovery");
  assert.deepStrictEqual(result.value, JSON.parse(VALID), "a valid response must parse to exactly what JSON.parse produces");
  /* Same object graph, and no re-serialization anywhere in the path. */
  assert.strictEqual(JSON.stringify(result.value), JSON.stringify(JSON.parse(VALID)));
  pass("a valid response is parsed normally, unmodified, and reports no recovery");
}

/* ---- 2. the captured failure shapes recover ------------------------------ */
{
  const cases = [
    ["missing exactly one final brace", VALID.slice(0, -1), RECOVERY_EOF, 1],
    ["missing brace then pathological trailing whitespace", VALID.slice(0, -1) + " \n\t\r".repeat(2000), RECOVERY_EOF, 1],
    ["nested: two legal closers outstanding", VALID.slice(0, -2), RECOVERY_EOF, 2],
    ["raw form feed inside a string", VALID.replace("visible in frame", "visible" + FF + " in frame"), RECOVERY_CONTROL, 0],
    ["form feed and a missing brace", VALID.replace("visible in frame", "visible" + FF + " in frame").slice(0, -1), RECOVERY_BOTH, 1],
  ];
  for (const [label, raw, expectedRecovery, appended] of cases) {
    const result = parseContinuityResponse(raw);
    assert.strictEqual(result.ok, true, `${label} must recover`);
    assert.strictEqual(result.recovery, expectedRecovery, `${label} recovery method`);
    if (appended) assert.strictEqual(result.appendedDelimiters, appended, `${label} appended delimiter count`);
    /* Recovery is worthless unless the strict validator then accepts it. */
    const validation = validateObservationSet(MANIFEST, result.value);
    assert.strictEqual(validation.usable, true, `${label} must pass the existing validator`);
    assert.strictEqual(validation.status, "clean", `${label} must not be downgraded for how its JSON arrived`);
    assert.deepStrictEqual(validation.flags, [], `${label} must raise no validation flag`);
  }
  /* The whole point: the evidence survives intact. A form feed is removed from
     the string it corrupted and nothing else about that string changes. */
  const feed = parseContinuityResponse(VALID.replace("visible in frame", "visible" + FF + " in frame"));
  assert.strictEqual(feed.value.entities["CHAR-KAI"].evidence, "visible in frame", "only the illegal byte is removed");
  assert.deepStrictEqual(feed.value.entities["PROP-MUG"].bbox, [100, 100, 200, 200], "no other value is disturbed");
  pass("every captured failure shape recovers and passes the existing validator with no flags");
}

/* ---- 3. what recovery must REFUSE --------------------------------------- */
{
  /* Each of these would need recovery to supply meaning, not punctuation. */
  const refused = [
    ["needs a comma", '{"a":1 "b":2}'],
    ["needs a quote", '{"a":value}'],
    ["needs a colon", '{"a" 1}'],
    ["unterminated string", '{"a":"visible in fra'],
    ["unterminated string with trailing whitespace", '{"a":"visible   \n\n  '],
    ["truncated number", '{"bbox":[1,2,3,12'],
    ["truncated keyword", '{"identifiable":tru'],
    ["trailing comma before EOF", '{"a":1,'],
    ["dangling colon", '{"a":'],
    ["mismatched delimiters", '{"a":[1,2}'],
    ["closer with nothing open", '{"a":1}}'],
    ["array closed as object", '["a"}'],
    ["not JSON at all", "I could not complete this request."],
    ["empty", ""],
    ["whitespace only", "   \n\t  "],
  ];
  for (const [label, raw] of refused) {
    const result = parseContinuityResponse(raw);
    assert.strictEqual(result.ok, false, `${label} must NOT be recovered`);
    assert.strictEqual(result.recovery, RECOVERY_NONE);
    assert.strictEqual(result.value, undefined, `${label} must yield no value`);
  }
  pass("malformed JSON needing a comma, colon, quote, digit, keyword or an unterminated string is refused");

  /* A truncated bbox coordinate is the dangerous one: `[1,2,3,12` would parse
     after appending "]}" and would assert a coordinate the model never
     finished emitting. The last-character rule is what stops it. */
  assert.strictEqual(parseContinuityResponse('{"coordinate_mode":"permille","entities":{"A":{"bbox":[100,100,200,12').ok, false, "a truncated coordinate must never be closed into a value");
  pass("a truncated value is never completed — appending closers can only follow a finished token");
}

/* ---- 4. the appended-delimiter bound ------------------------------------- */
{
  assert.strictEqual(MAX_APPENDED_DELIMITERS, 4, "the bound is the schema's own nesting depth: root, entities, entity, bbox");
  const open = (depth) => '{"a":'.repeat(0) + "{".repeat(depth) + '"k":"v"' + "";
  /* Exactly at the bound recovers; one deeper does not. */
  const atBound = "{" + '"a":{' + '"b":{' + '"c":{' + '"d":"x"';
  const overBound = "{" + '"a":{' + '"b":{' + '"c":{' + '"d":{' + '"e":"x"';
  assert.strictEqual(parseContinuityResponse(atBound).ok, true, "four outstanding closers is within the bound");
  assert.strictEqual(parseContinuityResponse(atBound).appendedDelimiters, 4);
  assert.strictEqual(parseContinuityResponse(overBound).ok, false, "five outstanding closers is beyond the bound and is refused");
  void open;
  pass(`structural completion is bounded at ${MAX_APPENDED_DELIMITERS} delimiters and refuses anything deeper`);
}

/* ---- 5. escaped sequences are text, not control characters --------------- */
{
  const escaped = VALID.replace("visible in frame", "visible\\\\f in frame");
  const result = parseContinuityResponse(escaped);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.recovery, RECOVERY_NONE, "an escaped sequence is legal JSON and needs no recovery");
  /* A legally escaped \f survives as the character it denotes. */
  const legalEscape = parseContinuityResponse('{"a":"vis\\fible"}');
  assert.strictEqual(legalEscape.recovery, RECOVERY_NONE);
  assert.strictEqual(legalEscape.value.a, "vis\fible", "a legally escaped form feed is content and must be preserved");
  /* Whitespace that JSON permits between tokens is never stripped. */
  const spaced = parseContinuityResponse("  \n\t" + VALID + "\n  ");
  assert.strictEqual(spaced.recovery, RECOVERY_NONE);
  assert.deepStrictEqual(spaced.value, JSON.parse(VALID));
  /* A tab inside a string is illegal raw and IS removed — but only there. */
  const rawTab = parseContinuityResponse('{"a":"vis\tible","b":"x"}');
  assert.strictEqual(rawTab.ok, true);
  assert.strictEqual(rawTab.recovery, RECOVERY_CONTROL);
  assert.strictEqual(rawTab.value.a, "visible");
  assert.strictEqual(rawTab.value.b, "x", "other values are untouched");
  pass("escaped sequences and legal inter-token whitespace are preserved; only raw illegal control bytes are removed");
}

/* ---- 6. recovery cannot weaken validation -------------------------------- */
{
  /* Schema-invalid content that happens to be structurally recoverable must
     still be judged exactly as before. */
  const undeclared = JSON.stringify({
    coordinate_mode: "permille",
    entities: { "CHAR-KAI": record({ color: "not-applicable" }), "PROP-MUG": record(), "PROP-GHOST": record() },
  });
  const truncatedUndeclared = parseContinuityResponse(undeclared.slice(0, -1));
  assert.strictEqual(truncatedUndeclared.ok, true, "structural recovery does not care what the content says");
  const undeclaredValidation = validateObservationSet(MANIFEST, truncatedUndeclared.value);
  assert.deepStrictEqual(
    undeclaredValidation.flags.map((flag) => flag.code).filter((code) => code === "undeclared_entity_id"),
    ["undeclared_entity_id"],
    "an invented entity must still be flagged after recovery",
  );

  const missing = JSON.stringify({ coordinate_mode: "permille", entities: { "CHAR-KAI": record({ color: "not-applicable" }) } });
  const truncatedMissing = parseContinuityResponse(missing.slice(0, -1));
  assert.strictEqual(truncatedMissing.ok, true);
  const missingValidation = validateObservationSet(MANIFEST, truncatedMissing.value);
  assert(missingValidation.flags.some((flag) => flag.code === "missing_entity_id"), "a missing entity must still be flagged after recovery");
  assert.strictEqual(missingValidation.entities["PROP-MUG"].presence, "uncertain", "recovery must not invent the absent record");

  const wrongFrame = JSON.stringify({ coordinate_mode: "pixels", entities: { "CHAR-KAI": record({ color: "not-applicable" }), "PROP-MUG": record() } });
  const truncatedFrame = parseContinuityResponse(wrongFrame.slice(0, -1));
  assert.strictEqual(truncatedFrame.ok, true);
  const frameValidation = validateObservationSet(MANIFEST, truncatedFrame.value);
  assert.strictEqual(frameValidation.usable, false, "a set-wide integrity failure stays unusable after recovery");

  const badEnum = JSON.stringify({
    coordinate_mode: "permille",
    entities: { "CHAR-KAI": record({ color: "not-applicable", presence: "maybe" }), "PROP-MUG": record() },
  });
  const truncatedEnum = parseContinuityResponse(badEnum.slice(0, -1));
  const enumValidation = validateObservationSet(MANIFEST, truncatedEnum.value);
  assert(enumValidation.flags.some((flag) => flag.code === "invalid_enum"), "an illegal enum must still be flagged after recovery");
  assert.strictEqual(enumValidation.entities["CHAR-KAI"].presence, "maybe", "recovery must not substitute a legal value");
  pass("recovery repairs serialization only — invented, missing, wrong-frame and illegal-enum content is judged exactly as before");
}

/* ---- 7. the qualified request contract is untouched ---------------------- */
{
  const { OBSERVATION_REQUEST_CONTRACT, OBSERVATION_PROMPT_VERSION, CONTINUITY_OBSERVATION_CONTRACT_VERSION, OBSERVATION_SCHEMA_NAME } = require("../public/shared-continuity");
  assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.temperature, 0.2);
  assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.top_k, 1);
  assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.max_tokens, 4096, "raising max_tokens does not fix this defect and must not be attempted here");
  assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.stream, false);
  assert.deepStrictEqual({ ...OBSERVATION_REQUEST_CONTRACT.chat_template_kwargs }, { enable_thinking: false });
  assert.strictEqual(OBSERVATION_PROMPT_VERSION, "arm-F-anti-confirmation-bias", "the prompt version must not move");
  assert.strictEqual(CONTINUITY_OBSERVATION_CONTRACT_VERSION, "declared_entities_final", "the contract version must not move");
  assert.strictEqual(OBSERVATION_SCHEMA_NAME, "declared_entities_final");
  const schema = buildObservationSchema(MANIFEST);
  assert.deepStrictEqual(schema.properties.coordinate_mode.enum, ["permille"], "the schema must not move");
  assert.strictEqual(schema.properties.entities.properties["CHAR-KAI"].properties.evidence.maxLength, 48);
  /* Recovery must not have needed a new cache component either. */
  const cacheSource = fs.readFileSync(path.join(__dirname, "..", "continuity-cache.js"), "utf8");
  assert(!/recovery/i.test(cacheSource), "the cache must not learn about serialization recovery");
  pass("the qualified request contract, prompt version, schema and cache identity are all untouched");
}

/* ---- 8. the frozen 51-response corpus is a byte-level no-op -------------- */
{
  const benchmarkPath = path.join(__dirname, "fixtures", "continuity", "spark-51-response-benchmark.json");
  if (fs.existsSync(benchmarkPath)) {
    const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
    let records = 0;
    let recovered = 0;
    for (const item of benchmark.cases) {
      const manifest = { ...benchmark.manifests[item.policy], manifestHash: "fixture" };
      records += manifest.entities.length;
      const before = JSON.parse(item.response);
      const after = parseContinuityResponse(item.response);
      assert.strictEqual(after.ok, true, `${item.caseId} must still parse`);
      assert.strictEqual(after.recovery, RECOVERY_NONE, `${item.caseId} must take the untouched path`);
      assert.deepStrictEqual(after.value, before, `${item.caseId} must parse to exactly what JSON.parse produced`);
      if (after.recovery !== RECOVERY_NONE) recovered += 1;
      /* And validation must be identical in every field it reports. */
      assert.deepStrictEqual(validateObservationSet(manifest, after.value), validateObservationSet(manifest, before), `${item.caseId} validation must be unchanged`);
    }
    assert.strictEqual(benchmark.cases.length, 51, "the frozen corpus is 51 responses");
    assert.strictEqual(records, 615, "the frozen corpus covers 615 declared records");
    assert.strictEqual(recovered, 0, "no qualified response may need recovery");
    pass("the frozen 51-response / 615-record corpus takes the untouched path and validates identically");
  } else {
    pass(`frozen corpus fixture not present — skipped (expected at ${benchmarkPath})`);
  }
}

/* ---- 9. determinism ------------------------------------------------------ */
{
  const raw = VALID.replace("visible in frame", "visible" + FF + " in frame").slice(0, -1) + "   \n\n";
  const first = parseContinuityResponse(raw);
  const second = parseContinuityResponse(raw);
  assert.deepStrictEqual(first, second, "recovery must be deterministic");
  assert.strictEqual(JSON.stringify(first.value), JSON.stringify(second.value));
  pass("recovery is deterministic — the same bytes always produce the same result");
}

console.log("Continuity JSON recovery suite passed:\n" + results.map((line) => `  - ${line}`).join("\n"));

/* CineBraid declared-entity continuity — frozen prompt and schema fidelity.

   The observation prompt and the generated schema were part of the system that
   qualified on the DGX Spark. Rewording the prompt or reshaping the schema
   silently invalidates that qualification, and nothing else in the app would
   notice.

   So this suite does what the evaluation's own verify_live_contract.py does,
   offline: it builds the request CineBraid would send for the same manifests
   and compares it, field by field, against the request bodies the qualifying
   run actually recorded.

   Byte identity is asserted, not approximated. No provider, no network, no
   model. */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  buildObservationPrompt,
  buildObservationSchema,
  observationChecklist,
  OBSERVATION_REQUEST_CONTRACT,
  OBSERVATION_SCHEMA_NAME,
  OBSERVATION_USER_MESSAGE,
  EVIDENCE_MAX,
} = require("../public/shared-continuity");
const { structuredVisionBody } = require("../src/assistant/llm");

const FIXTURES = path.join(__dirname, "fixtures", "continuity");
const contractPath = path.join(FIXTURES, "spark-frozen-request-contract.json");
const benchmarkPath = path.join(FIXTURES, "spark-51-response-benchmark.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));

/* ---- 1. the recorded contract is what we think it is ---- */
assert.strictEqual(contract.cases.length, 3, "the fixture must cover all three qualified manifests");
assert.strictEqual(
  contract.provenance.contractSourceSha256,
  "2971e4c2cb6a15506c00f2b5a6a1ee8ca40e1823035460cc1be007d39bf75348",
  "the frozen fin_contract.py this port was written against must be pinned by hash",
);
/* No frame pixels are carried in the repository. */
for (const row of contract.cases) {
  assert.strictEqual(row.imagePartCount, 1, "the qualified request carried exactly one image");
  assert.strictEqual(row.imagePlaceholder, "<1 image redacted>", "the recorded request must not carry image bytes");
}

/* ---- 2. the system prompt is byte-identical for every qualified manifest ----

   Including the composite and split manifests, which exercise the parent,
   COMPOSITE and CHILD checklist lines. */
for (const row of contract.cases) {
  const manifest = benchmark.manifests[row.policy];
  assert(manifest, `benchmark fixture is missing the ${row.policy} manifest`);
  const built = buildObservationPrompt(manifest);

  if (built.system !== row.systemPrompt) {
    const mine = built.system.split("\n");
    const reference = row.systemPrompt.split("\n");
    const diffs = [];
    for (let i = 0; i < Math.max(mine.length, reference.length); i++)
      if (mine[i] !== reference[i]) diffs.push(`  line ${i + 1}\n    built: ${JSON.stringify(mine[i])}\n    frozen: ${JSON.stringify(reference[i])}`);
    assert.fail(`${row.policy}: the generated prompt is not byte-identical to the qualified prompt\n${diffs.slice(0, 8).join("\n")}`);
  }
  assert.strictEqual(built.user, row.userText, `${row.policy}: the user message must be the qualified one`);
  assert.strictEqual(
    crypto.createHash("sha256").update(built.system, "utf8").digest("hex"),
    crypto.createHash("sha256").update(row.systemPrompt, "utf8").digest("hex"),
  );
}
assert.strictEqual(OBSERVATION_USER_MESSAGE, "Check each declared entity against this frame.");

/* ---- 3. the anti-confirmation-bias framing is present and load-bearing ----

   These specific sentences are why a declared entity that was removed is
   reported absent instead of hallucinated back into the frame. */
const sample = buildObservationPrompt(benchmark.manifests["s1-entities"]).system;
for (const clause of [
  "You are shown EXACTLY ONE photographic frame",
  "This list is a\nCHECKLIST, not evidence.",
  "Declaration does NOT mean the entity is present.",
  "Never infer presence merely because an entity id appears in the checklist.",
  "You have not been shown any other image. Do not use comparative language.",
  "Do NOT assume worn accessories are still present.",
  "A declared entity that was removed between shots MUST be reported absent",
  "Never fabricate a bounding box for an absent entity.",
  "PRESENCE AND OCCLUSION ARE DIFFERENT QUESTIONS. Answer them separately.",
]) assert(sample.includes(clause), `the qualified prompt clause is missing: ${JSON.stringify(clause)}`);
assert(sample.includes(`at most ${EVIDENCE_MAX}`), "the evidence budget in the prompt must track the contract constant");

/* ---- 4. the generated schema is identical to the recorded schema ---- */
for (const row of contract.cases) {
  const built = buildObservationSchema(benchmark.manifests[row.policy]);
  assert.strictEqual(
    JSON.stringify(built),
    JSON.stringify(row.schema),
    `${row.policy}: the generated schema is not identical to the qualified schema`,
  );
  /* The structural guarantees, restated against the recorded article. */
  assert.strictEqual(row.schema.properties.entities.additionalProperties, false);
  assert.deepStrictEqual(
    built.properties.entities.required,
    benchmark.manifests[row.policy].entities.map((entity) => entity.entity_id).sort(),
    `${row.policy}: every declared entity id must be required`,
  );
  assert(!JSON.stringify(built).includes('"oneOf"'), "oneOf is the constrained-decoding trap and must never appear");
}

/* ---- 5. checklist rendering: parent, composite and child lines ---- */
const composite = observationChecklist(benchmark.manifests["s2-composite"]);
assert(composite.includes("COMPOSITE: report as ONE record covering the whole unit."), "a composite-parent must be declared as one unit");
const split = observationChecklist(benchmark.manifests["s2-split"]);
assert(split.includes("CHILD: a distinct tracked part of its parent."), "a child unit must be declared as a distinct part");
assert(sample.includes("worn by / part of: char_seated_person"), "a parent relationship must be rendered");
/* Entities render in the order the manifest declares them. */
const ids = benchmark.manifests["s1-entities"].entities.map((entity) => entity.entity_id);
const positions = ids.map((id) => sample.indexOf(`- ${id} (`));
assert(positions.every((value) => value > -1), "every declared entity must appear in the checklist");
assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b), "the checklist must follow manifest order");

/* ---- 6. the qualified request parameters are pinned ---- */
const recorded = contract.cases[0].request;
assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.temperature, recorded.temperature);
assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.temperature, 0.2);
assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.top_k, recorded.top_k);
assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.top_k, 1);
assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.max_tokens, recorded.max_tokens);
assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.max_tokens, 4096, "the 51/51 run was qualified at 4096 tokens");
assert.strictEqual(OBSERVATION_REQUEST_CONTRACT.stream, recorded.stream);
assert.deepStrictEqual(OBSERVATION_REQUEST_CONTRACT.chat_template_kwargs, recorded.chat_template_kwargs);
assert.deepStrictEqual(OBSERVATION_REQUEST_CONTRACT.chat_template_kwargs, { enable_thinking: false });
/* Frozen so a caller cannot mutate the shared contract object in place. */
assert(Object.isFrozen(OBSERVATION_REQUEST_CONTRACT));
assert(Object.isFrozen(OBSERVATION_REQUEST_CONTRACT.chat_template_kwargs));

/* ---- 7. the provider layer emits the recorded response_format ---- */
const schema = buildObservationSchema(benchmark.manifests["s1-entities"]);
const built = structuredVisionBody({ jsonSchema: schema, schemaName: OBSERVATION_SCHEMA_NAME });
assert.strictEqual(built.response_format.type, contract.cases[0].responseFormat.type);
assert.strictEqual(built.response_format.type, "json_schema");
assert.strictEqual(built.response_format.json_schema.name, contract.cases[0].responseFormat.name);
assert.strictEqual(built.response_format.json_schema.name, "declared_entities_final");
assert.strictEqual(built.response_format.json_schema.strict, true);
assert.strictEqual(JSON.stringify(built.response_format.json_schema.schema), JSON.stringify(contract.cases[0].schema));
/* guided_json was never the qualified path and must not appear anywhere. */
assert(!JSON.stringify(built).includes("guided_json"));
assert(!fs.readFileSync(path.join(__dirname, "..", "src/assistant/llm.js"), "utf8").includes("guided_json"));
/* And a caller that asks for nothing structured gets nothing added. */
assert.deepStrictEqual(structuredVisionBody({}), {});
assert.deepStrictEqual(structuredVisionBody(), {});

console.log(`Continuity prompt-contract suite passed: the generated system prompt is byte-identical to the qualified prompt for all ${contract.cases.length} frozen manifests, the generated schema is identical to the recorded schema, the checklist renders parent/composite/child lines in manifest order, and the qualified request parameters and response_format are pinned to the recorded run.`);

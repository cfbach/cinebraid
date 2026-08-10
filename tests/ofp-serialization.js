/* Open Film Project — canonical serialization, and the P0 Q1 decision.
 *
 * Two forms, kept apart: the FILE form (pretty, readable, deterministic) and
 * the HASH form (RFC 8785 JCS, for claim binding). Conflating them is how a
 * format acquires an unreadable serialization for no reason.
 *
 * P0 deferred one question to P1 and asked for it to be settled empirically
 * rather than at a whiteboard: should the file form order keys by the schema's
 * declared property order, or purely by JCS? The experiment is section 6, the
 * decision is recorded there and in docs/architecture, and the drift guard P0
 * N5 asks for is section 7.
 *
 * P1 does not activate canonical persistence. Nothing here writes a project.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { parseJsonStrict } = require("../ofp/ofp-json");
const { serializeCanonical, serializeHashForm, declaredKeyOrder, KEY_ORDER } = require("../ofp/ofp-serialize");
const { CANONICAL_FILENAME } = require("../ofp/ofp-read");
const Schema = require("../ofp/ofp-schema");
const { canonicalJson } = require("../public/shared-continuity");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures", "ofp");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const loadFixture = (name) => parseJsonStrict(readFixture(name));
const CANONICAL_FIXTURES = fs.readdirSync(FIXTURES).filter((name) => name.endsWith(".ofp.json"));

const representative = loadFixture("representative.ofp.json");

/* ===========================================================================
   1. The file form's byte rules (P0 §8, rules 1-4). */

const serialized = serializeCanonical(representative);
assert(!serialized.includes("\r"), "rule 2: LF line endings; the writer can only emit the newlines it writes itself");
assert(serialized.endsWith("}\n"), "rule 4: exactly one trailing newline");
assert(!serialized.endsWith("}\n\n"));
assert.strictEqual(serialized.charCodeAt(0), 0x7b, "rule 1: no BOM - the document starts at the opening brace");
assert(serialized.includes('\n  "format": {'), "rule 3: two-space indent");
assert(serialized.includes('\n      "id": "sh-0100"'), "rule 3: two spaces per level, all the way down");

/* A CR inside prose is data and is escaped, not turned into a line ending. */
const withCarriageReturn = serializeCanonical({ format: representative.format, meta: { title: "a\r\nb" } });
assert(withCarriageReturn.includes('"a\\r\\nb"'), "a CR inside a string is escaped as \\r and preserved");
assert.strictEqual(withCarriageReturn.split("\r").length, 1, "and never reaches the file as a line ending");

/* Every canonical fixture on disk is already in file form. This is where the
   Windows hazard shows up if the .gitattributes pin is ever lost: on a machine
   with core.autocrlf=true, a fixture without the pin comes out of a fresh
   checkout with CRLF and this assertion goes red. */
for (const name of CANONICAL_FIXTURES) {
  const bytes = fs.readFileSync(path.join(FIXTURES, name));
  assert.strictEqual(bytes.indexOf(0x0d), -1, `${name} must be checked out with LF endings; see the *.ofp.json pin in .gitattributes`);
  assert.strictEqual(bytes[bytes.length - 1], 0x0a, `${name} must end with exactly one newline`);
  assert.notStrictEqual(bytes[bytes.length - 2], 0x0a, `${name} must not end with a blank line`);
  assert(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), `${name} must have no BOM`);
}

/* The pin itself, named so that losing it is a test failure rather than a
   surprise on somebody else's clone. */
const gitattributes = fs.readFileSync(path.join(ROOT, ".gitattributes"), "utf8");
assert.match(gitattributes, /^\*\.ofp\.json\s+text\s+eol=lf$/m, "canonical OFP documents must be pinned to LF in .gitattributes");
assert.strictEqual(CANONICAL_FILENAME, "project.ofp.json", "the canonical file name is pinned, because .gitattributes has to name it");
assert(CANONICAL_FILENAME.endsWith(".ofp.json"), "the canonical file name must be covered by the .gitattributes pattern");

/* ===========================================================================
   2. Determinism and idempotence. */

assert.strictEqual(serializeCanonical(loadFixture("representative.ofp.json")), serialized, "same input, same bytes");
assert.strictEqual(serializeCanonical(parseJsonStrict(serialized)), serialized, "serialize(parse(D)) == D, byte for byte");

/* Key insertion order in the SOURCE document must not reach the output. A
   different producer building the same document with its keys inserted in a
   different order must write the same file. */
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).reverse()) out[key] = reverseKeys(value[key]);
    return out;
  }
  return value;
}
assert.strictEqual(serializeCanonical(reverseKeys(loadFixture("representative.ofp.json"))), serialized, "the output must not depend on how the producer happened to build its objects");

for (const name of CANONICAL_FIXTURES) {
  let parsed;
  try { parsed = parseJsonStrict(readFixture(name)); } catch { continue; }
  const once = serializeCanonical(parsed);
  assert.strictEqual(serializeCanonical(parseJsonStrict(once)), once, `${name}: a second serialization must be byte-identical`);
}

/* The serializer never reorders the document it was handed. */
const orderProbe = loadFixture("representative.ofp.json");
const beforeOrder = JSON.stringify(orderProbe);
serializeCanonical(orderProbe);
assert.strictEqual(JSON.stringify(orderProbe), beforeOrder, "serializing must not sort a collection in place");

/* ===========================================================================
   3. Absent, null and present-with-a-default are three different documents
      (rule 9 - the workhorse of INV-R3). */

const base = { format: representative.format };
assert(!serializeCanonical(base).includes('"meta"'), "the writer must not emit a key that was absent on load");
assert(!serializeCanonical(base).includes('"statements"'), "and must not helpfully add an empty collection");
assert(serializeCanonical({ ...base, statements: [] }).includes('"statements": []'), "rule 10: an empty collection present on load is retained as []");
assert(serializeCanonical({ ...base, shots: [{ id: "s", duration: { seconds: null } }] }).includes('"seconds": null'), "a null that was present is written back as null");
assert(!serializeCanonical({ ...base, shots: [{ id: "s", duration: {} }] }).includes('"seconds"'), "an absent key stays absent");
/* Including when the value equals what a default would have been. */
assert(serializeCanonical({ ...base, shots: [{ id: "s", framing: { movement: "static" } }] }).includes('"movement": "static"'), "a present key is never dropped, even when it equals the obvious default");

/* ===========================================================================
   4. Collection order (rule 6). */

/* `set` sorts by id, so the file order of a collection whose order is not data
   cannot drift between two writers. */
const unsorted = {
  format: representative.format,
  sources: [{ id: "src-z" }, { id: "src-a" }],
  assets: [{ id: "asset-z" }, { id: "asset-a" }],
  entities: { voices: [{ id: "voice-z" }, { id: "voice-a" }] },
};
const sortedOut = serializeCanonical(unsorted);
assert(sortedOut.indexOf('"src-a"') < sortedOut.indexOf('"src-z"'), "sources sort by id");
assert(sortedOut.indexOf('"asset-a"') < sortedOut.indexOf('"asset-z"'), "assets sort by id");
assert(sortedOut.indexOf('"voice-a"') < sortedOut.indexOf('"voice-z"'), "entity collections sort by id");

/* `ordinal` sorts by the declared ordinal and then by id, so array order and
   the ordinal can never disagree with each other. */
const ordinal = serializeCanonical({
  format: representative.format,
  shots: [{ id: "sh-c", order: { script: 3 } }, { id: "sh-a", order: { script: 1 } }, { id: "sh-b", order: { script: 2 } }],
});
assert(ordinal.indexOf('"sh-a"') < ordinal.indexOf('"sh-b"'));
assert(ordinal.indexOf('"sh-b"') < ordinal.indexOf('"sh-c"'));
/* A record with no ordinal sorts after every record that has one: "unset" is
   not "first". */
const partialOrdinal = serializeCanonical({ format: representative.format, shots: [{ id: "sh-none" }, { id: "sh-one", order: { script: 1 } }] });
assert(partialOrdinal.indexOf('"sh-one"') < partialOrdinal.indexOf('"sh-none"'));

/* `ordered` collections and within-record scalar arrays are data and are never
   sorted. Sorting `risks` would silently reorder a director's priorities. */
const ordered = serializeCanonical({
  format: representative.format,
  shots: [{ id: "s", risks: ["z-risk", "a-risk"], frames: [{ id: "fr-z" }, { id: "fr-a" }], subjects: [{ entityId: "e-z" }, { entityId: "e-a" }] }],
});
assert(ordered.indexOf('"z-risk"') < ordered.indexOf('"a-risk"'), "scalar arrays inside a record keep their order");
assert(ordered.indexOf('"fr-z"') < ordered.indexOf('"fr-a"'), "a shot's frames are a sequence, not a set");
assert(ordered.indexOf('"e-z"') < ordered.indexOf('"e-a"'), "shot subjects keep their order");
assert(serializeCanonical({ format: { ...representative.format, profiles: ["shot-planning", "core"] } }).indexOf('"shot-planning"') < serializeCanonical({ format: { ...representative.format, profiles: ["shot-planning", "core"] } }).indexOf('"core"'), "declared profiles keep the order they layer in");

/* ===========================================================================
   5. File form and hash form are not the same thing. */

const value = { b: 1, a: [2, 1] };
assert.strictEqual(serializeHashForm(value), '{"a":[2,1],"b":1}', "the hash form is compact JCS");
assert.strictEqual(serializeHashForm(value), canonicalJson(value), "and it is the existing, already-tested helper rather than a second implementation");
assert(serializeCanonical({ format: representative.format }).includes("\n"), "the file form is pretty");
assert(!serializeHashForm({ format: representative.format }).includes("\n"), "the hash form is not");
assert.notStrictEqual(serializeCanonical(representative), serializeHashForm(representative), "two forms, deliberately different");
/* Numbers and strings are ECMAScript's in both, which is what RFC 8785
   specifies - nothing is invented on either side. */
assert(serializeCanonical({ format: representative.format, meta: { title: "q\"\\" } }).includes('"q\\"\\\\\\u0007"'));
assert(serializeCanonical({ format: representative.format, shots: [{ id: "s", duration: { seconds: -0 } }] }).includes('"seconds": 0'), "-0 normalizes to 0");
assert.throws(() => serializeCanonical({ format: representative.format, shots: [{ id: "s", duration: { seconds: Infinity } }] }), /non-finite/);

/* ===========================================================================
   6. P0 Q1 — SETTLED: schema-derived order for the FILE form.

   Measured on the representative fixture, both modes:

     size                        identical (8118 bytes)
     determinism                 identical - one output over ten runs, both
     producer-order independence identical - both immune to insertion order
     git diff for a 1-field edit identical - one line, both
     extension subtrees          identical - both JCS-ordered, by rule 11
     round-trip byte identity    identical - both stable on the second write

   Every dimension ties except one, and on that one the difference is not
   marginal: in schema order a shot opens with its own identity, and the fields
   a reader wants together are together. In JCS order `id` is the fourth key,
   after `duration`, `frames` and `framing` - you read three blocks of a record
   before learning which record it is, and `framing.size` sorts away from
   `framing.angle`'s neighbours for no reason a reader can see.

   So the hypothesis P0 recorded is confirmed rather than merely adopted, and
   the objection to schema-derived order turns out to be weaker than it looked:
   the output does NOT depend on the parsed document's key insertion order, only
   on the schema module's own - which is code under review, not data. Section 7
   is the CI guard that keeps it that way.

   The coupling this accepts, stated plainly: a writer needs the schema to
   produce byte-identical canonical files. That is a property of CineBraid's
   file form, not an interchange requirement - JSON objects are unordered, every
   conforming reader must accept any key order, and the normative form for
   digests is the hash form, which is pure JCS and needs no schema at all. */

const schemaOrdered = serializeCanonical(representative, { keyOrder: KEY_ORDER.SCHEMA });
const jcsOrdered = serializeCanonical(representative, { keyOrder: KEY_ORDER.JCS });
assert.strictEqual(serializeCanonical(representative), schemaOrdered, "schema-derived is the default, and the default is the decision");
assert.notStrictEqual(schemaOrdered, jcsOrdered, "the two modes really do differ, so the experiment compared two different things");
assert.strictEqual(Buffer.byteLength(schemaOrdered), Buffer.byteLength(jcsOrdered), "the choice costs nothing in size");

const shotKeys = (text) => {
  const start = text.indexOf('"shots"');
  return [...text.slice(start, text.indexOf("\n  ],", start)).matchAll(/^ {6}"([a-zA-Z]+)":/gm)].map((match) => match[1]);
};
assert.strictEqual(shotKeys(schemaOrdered)[0], "id", "in schema order a record opens with its own identity");
assert.strictEqual(shotKeys(jcsOrdered).indexOf("id"), 3, "in JCS order the identity is the fourth key, after three other blocks");
assert.deepStrictEqual(shotKeys(schemaOrdered), declaredKeyOrder(Schema.records.SHOT).filter((key) => shotKeys(schemaOrdered).includes(key)), "the file's key order is exactly the schema's declared order, minus the keys this record does not carry");
/* Both modes are equally deterministic and equally stable - the decision was
   made on readability because readability was the only difference. */
for (const mode of [KEY_ORDER.SCHEMA, KEY_ORDER.JCS]) {
  const once = serializeCanonical(representative, { keyOrder: mode });
  assert.strictEqual(serializeCanonical(parseJsonStrict(once), { keyOrder: mode }), once, `${mode}: stable`);
  assert.strictEqual(serializeCanonical(reverseKeys(loadFixture("representative.ofp.json")), { keyOrder: mode }), once, `${mode}: independent of producer key order`);
}

/* Rule 5's second half, and rule 11: undeclared keys sort by JCS after the
   declared ones, and a foreign extension subtree is JCS-ordered in both modes
   because there is no declared order for a subtree this contract does not model. */
const foreign = serializeCanonical({
  format: representative.format,
  shots: [{ id: "s", zzUndeclared: 1, aaUndeclared: 2, title: "t" }],
  extensions: { "com.example.x": { z: 1, a: 2 } },
});
assert(foreign.indexOf('"id"') < foreign.indexOf('"title"'), "declared keys keep their declared order");
assert(foreign.indexOf('"title"') < foreign.indexOf('"aaUndeclared"'), "undeclared keys follow every declared one");
assert(foreign.indexOf('"aaUndeclared"') < foreign.indexOf('"zzUndeclared"'), "and are JCS-ordered among themselves");
assert(foreign.indexOf('"a": 2') < foreign.indexOf('"z": 1'), "rule 11: a foreign subtree is JCS-ordered");
/* Extracted rather than sliced off the end: in JCS mode the top-level keys sort
   too, so `extensions` is no longer the last block. */
const extensionSubtree = (mode) => {
  const text = serializeCanonical({ format: representative.format, extensions: { "com.example.x": { z: 1, a: 2 } } }, { keyOrder: mode });
  const start = text.indexOf('"com.example.x"');
  return text.slice(start, text.indexOf("}", start) + 1);
};
assert.strictEqual(extensionSubtree(KEY_ORDER.JCS), extensionSubtree(KEY_ORDER.SCHEMA), "extension subtrees are identical in both modes");
assert.match(extensionSubtree(KEY_ORDER.SCHEMA), /"a": 2,\n\s+"z": 1/);

/* And the unknown data itself survives the round trip untouched, which is
   gate G2 (a synthetic unknown extension AND an unknown enum value survive). */
const unknownRoundTrip = parseJsonStrict(serializeCanonical(loadFixture("unknown-extension.ofp.json")));
assert.deepStrictEqual(unknownRoundTrip.extensions["com.example.futuretool"], { schedule: { day: 4, notes: ["keep me"] }, opaque: { z: 1, a: 2 } });
assert.deepStrictEqual(unknownRoundTrip.shots[0].futureFieldNobodyDeclared, { nested: [1, 2, { deep: true }] });
assert.strictEqual(parseJsonStrict(serializeCanonical(loadFixture("unknown-enum.ofp.json"))).shots[0].framing.size, "ultra-wide", "an unknown enum value survives a write, uncoerced");

/* ===========================================================================
   7. Schema key-order drift guard (P0 N5).

   Schema-derived file ordering was chosen, so a reorder of these declarations
   silently rewrites the bytes of every project on disk. Pinning the order here
   makes that a reviewed change rather than an invisible one. Adding a field is
   expected and this list is meant to be updated with it; SHUFFLING one is what
   this catches. */

const PINNED_KEY_ORDER = {
  DOCUMENT: ["format", "meta", "sources", "story", "shots", "entities", "assets", "references", "continuity", "statements", "extensions"],
  SHOT: ["id", "sceneId", "title", "description", "order", "framing", "duration", "setting", "subjects", "frames", "motion", "relations", "risks"],
  SCENE: ["id", "title", "summary", "setting", "order"],
  CHARACTER: ["id", "name", "description", "role", "aliases", "voices", "states"],
  VOICE: ["id", "name", "description", "kind", "language"],
  VOICE_LINK: ["voiceId", "role", "language"],
  LOCATION: ["id", "name", "description", "states", "coverage"],
  PROP: ["id", "name", "description", "states", "coverage"],
  VEHICLE: ["id", "name", "description", "states", "coverage"],
  ENTITY_STATE: ["id", "name", "isDefault", "derivesFrom", "delta"],
  COVERAGE: ["id", "name", "description"],
  SOURCE: ["id", "kind", "title", "uri", "anchors"],
  ANCHOR: ["id", "elementKind", "text"],
  FRAME: ["id", "role", "description"],
  MOTION: ["id", "description", "durationSeconds"],
  RELATION: ["id", "kind", "targetShotId", "note"],
  ASSET: ["id", "kind", "mediaType", "digest"],
  REFERENCE: ["id", "purpose", "subject", "assetId", "note"],
  STATEMENT: ["id", "target", "kind", "claim", "actor", "at", "evidence", "candidates", "note"],
};
assert.deepStrictEqual(declaredKeyOrder(Schema.DOCUMENT), PINNED_KEY_ORDER.DOCUMENT, "the document's key order is pinned");
for (const [name, expected] of Object.entries(PINNED_KEY_ORDER)) {
  if (name === "DOCUMENT") continue;
  assert(Schema.records[name], `${name} must be an exported record spec`);
  assert.deepStrictEqual(declaredKeyOrder(Schema.records[name]), expected, `${name}: the writer's key order follows this declaration, so reordering it rewrites every file on disk`);
}
/* Every exported record spec is pinned - a new record type must be added here
   rather than quietly acquiring an unreviewed order. */
assert.deepStrictEqual(
  Object.keys(Schema.records).sort(),
  Object.keys(PINNED_KEY_ORDER).filter((name) => name !== "DOCUMENT").sort(),
  "every record spec must have a pinned key order",
);
/* Identity leads every record that has one. This is the readability property
   the Q1 decision was made for, stated as an assertion rather than left as a
   pleasant side effect. */
for (const [name, order] of Object.entries(PINNED_KEY_ORDER))
  if (order.includes("id")) assert.strictEqual(order[0], "id", `${name}: a record must open with its own identity`);

console.log(`OFP serialization passed: ${CANONICAL_FIXTURES.length} canonical fixtures LF-clean and round-trip stable; P0 Q1 settled as schema-derived file order with ${Object.keys(PINNED_KEY_ORDER).length} pinned key orders.`);

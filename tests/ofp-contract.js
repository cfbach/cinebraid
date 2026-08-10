/* Open Film Project 1.0-draft.1 — contract conformance.
 *
 * Covers the parts of the frozen P0 architecture that P1 implements: format
 * identity and the draft lifecycle, identifier rules, target addressing, claim
 * binding, derived statement state, and the report-only validator over the
 * golden fixtures.
 *
 * Three properties are load-bearing enough to say out loud, because every one
 * of them is a defect this repository has actually shipped in some form:
 *
 *   - inspecting a document must not change it (no defaults at load),
 *   - a stale approval confers no approval but is never dropped,
 *   - unknown extensions and unknown enum values survive untouched.
 *
 * Serialization, INV-R1 and the negative controls live in their own suites.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { parseJsonStrict, OfpJsonError } = require("../ofp/ofp-json");
const Format = require("../ofp/ofp-format");
const Ids = require("../ofp/ofp-identifiers");
const Target = require("../ofp/ofp-target");
const Claim = require("../ofp/ofp-claim");
const Statements = require("../ofp/ofp-statements");
const Schema = require("../ofp/ofp-schema");
const { DIAGNOSTICS } = require("../ofp/ofp-diagnostics");
const { validateOfpDocument, MODES } = require("../ofp/ofp-validate");
const { canonicalJson } = require("../public/shared-continuity");

const FIXTURES = path.join(__dirname, "fixtures", "ofp");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const loadFixture = (name) => parseJsonStrict(readFixture(name));
const codesOf = (result) => result.diagnostics.map((entry) => entry.code);
const has = (result, code) => codesOf(result).includes(code);

/* ===========================================================================
   1. Format identity and the draft lifecycle. */

assert.strictEqual(Format.OFP_FORMAT_ID, "open-film-project");
assert.strictEqual(Format.OFP_CONTRACT_VERSION, "1.0-draft.1", "P1 writes the first draft revision and nothing else");

/* The contract version is not the application version, and the two must not be
   confusable. This is the entire reason format.id exists from the first byte. */
const representative = loadFixture("representative.ofp.json");
assert.strictEqual(representative.format.version, "1.0-draft.1");
assert.strictEqual(representative.format.generator.name, "CineBraid");
assert.notStrictEqual(representative.format.version, representative.format.generator.version);
assert(!/^6\./.test(representative.format.version), "a CineBraid 6.x number must never appear as the OFP format version");

for (const [text, expected] of [
  ["1.0", { major: 1, minor: 0, draft: null }],
  ["1.0-draft.1", { major: 1, minor: 0, draft: 1 }],
  ["12.34-draft.567", { major: 12, minor: 34, draft: 567 }],
]) assert.deepStrictEqual(Format.parseFormatVersion(text), expected, text);
for (const bad of ["1", "1.0.0", "1.0-draft", "1.0-rc.1", "01.0", "1.0-draft.01", "v1.0", "", null])
  assert.strictEqual(Format.parseFormatVersion(bad), null, `${JSON.stringify(bad)} must not parse as a format version`);

/* "6.7" is a grammatically valid MAJOR.MINOR, so the grammar is not what keeps
   a CineBraid application version out of format.version - the contract lane is.
   A document claiming 6.7 is a stable contract from far in the future, and this
   build refuses to write it rather than mistaking it for a CineBraid project. */
const sixSeven = Format.classifyDocument({ format: { id: "open-film-project", version: "6.7" } });
assert.strictEqual(sixSeven.documentClass, Format.DOCUMENT_CLASS.NEWER_STABLE);
assert.strictEqual(sixSeven.access, "read-only");

/* A released MAJOR.MINOR sorts after every draft of the same number, because
   that is the order they happen in. */
const version = (text) => Format.parseFormatVersion(text);
assert.strictEqual(Format.compareFormatVersions(version("1.0-draft.1"), version("1.0-draft.2")), -1);
assert.strictEqual(Format.compareFormatVersions(version("1.0-draft.9"), version("1.0")), -1);
assert.strictEqual(Format.compareFormatVersions(version("1.0"), version("1.1-draft.1")), -1);
assert.strictEqual(Format.compareFormatVersions(version("1.0-draft.1"), version("1.0-draft.1")), 0);

for (const [fixture, expectedClass, expectedAccess] of [
  ["minimal.ofp.json", Format.DOCUMENT_CLASS.SUPPORTED_DRAFT, "read-write"],
  ["older-draft.ofp.json", Format.DOCUMENT_CLASS.OLDER_DRAFT, "read-only"],
  ["newer-draft.ofp.json", Format.DOCUMENT_CLASS.NEWER_DRAFT, "read-only"],
  ["newer-stable.ofp.json", Format.DOCUMENT_CLASS.NEWER_STABLE, "read-only"],
  ["invalid-format.ofp.json", Format.DOCUMENT_CLASS.FORMAT_INVALID, "none"],
  ["legacy-project.json", Format.DOCUMENT_CLASS.LEGACY, "read-only"],
]) {
  const result = validateOfpDocument(readFixture(fixture));
  assert.strictEqual(result.documentClass, expectedClass, `${fixture} class`);
  assert.strictEqual(result.access, expectedAccess, `${fixture} access`);
}

/* Only the revision this build implements may be written. Every other revision
   opens read-only and says so - drafts carry no migration guarantee to one
   another, which is exactly what buys P1-P6 the freedom to restructure. */
for (const fixture of ["older-draft.ofp.json", "newer-draft.ofp.json", "newer-stable.ofp.json"]) {
  const result = validateOfpDocument(readFixture(fixture));
  assert.strictEqual(result.access, "read-only");
  assert(has(result, "format.unsupported"), `${fixture} must report an unsupported contract revision`);
  assert(result.skipped.includes(MODES.STRUCTURAL), "a contract revision this build does not implement is not judged against this build's schema");
}

/* ===========================================================================
   2. Real production projects never enter the draft lane. */

const legacyText = readFixture("legacy-project.json");
const legacyResult = validateOfpDocument(legacyText);
assert.strictEqual(legacyResult.documentClass, Format.DOCUMENT_CLASS.LEGACY);
assert(has(legacyResult, "format.legacy"), "a legacy project is reported as legacy");
assert.strictEqual(legacyResult.counts.error, 0, "a legacy CineBraid project is not an invalid OFP document; it is not an OFP document");
assert(!codesOf(legacyResult).some((code) => code.startsWith("schema.")), "a legacy project must not be judged against the OFP schema");
/* The document itself is untouched: no format block appeared, no version was
   rewritten, nothing was converted. */
assert.strictEqual(legacyResult.document.format, undefined, "inspecting a legacy project must not give it a format block");
assert.strictEqual(legacyResult.document.schemaVersion, 6.7, "the legacy lineage marker is left exactly as it was");
assert.strictEqual(JSON.stringify(legacyResult.document), JSON.stringify(parseJsonStrict(legacyText)), "the legacy document is byte-for-byte the one that was read");

/* ===========================================================================
   3. Identifiers: a floor that is an error, a profile that is a warning. */

/* Written as escape sequences rather than as literal characters. A test whose
   meaning depends on telling a space from a no-break space by eye breaks
   mysteriously the first time an editor normalizes the file - and one of these
   is a NUL, which would turn the whole source into a binary blob to grep. */
const UNSAFE_IDS = ["", "a:b", "a/b", "a#b", "a\u0020b", "a\tb", "a\u0000b", "a\u00a0b", "a\u2003b", "a\u000bb", "A\u0301"];
for (const bad of UNSAFE_IDS)
  assert.strictEqual(Ids.checkIdentifierFloor(bad).ok, false, `${JSON.stringify(bad)} must fail the identifier floor`);
/* The decomposed form is refused for being unnormalized, not for some other
   reason, and the same character precomposed is fine - the rule is NFC, not
   ASCII. */
assert(Ids.checkIdentifierFloor("A\u0301").reason.includes("NFC"));
assert.strictEqual(Ids.checkIdentifierFloor("\u00c1").ok, true);
for (const good of ["sh-0100", "INT-1->2", "char_mara", "état", "shot.0100", "L1-01"])
  assert.strictEqual(Ids.checkIdentifierFloor(good).ok, true, `${JSON.stringify(good)} must satisfy the identifier floor: ${Ids.checkIdentifierFloor(good).reason}`);

/* The measured legacy shape. It is legal, it round-trips verbatim, and nothing
   renames it - but it is reported, because ">" is illegal in a Windows path
   segment and shot IDs are directory names today. */
assert.strictEqual(Ids.checkIdentifierFloor("INT-1->2").ok, true);
assert.strictEqual(Ids.isIdentifierPortable("INT-1->2"), false);
const portability = validateOfpDocument(readFixture("id-not-portable.ofp.json"));
assert.strictEqual(portability.ok, true, "a non-portable identifier is a warning, never an error");
assert(has(portability, "id.not-portable"));
const notPortable = portability.diagnostics.find((entry) => entry.code === "id.not-portable");
assert.strictEqual(notPortable.severity, "warning");
assert(notPortable.message.includes("INT-1->2") && notPortable.message.includes("nothing renames it"));
assert.strictEqual(portability.document.shots[0].id, "INT-1->2", "the identifier survives inspection unchanged");

const invalidIds = validateOfpDocument(readFixture("invalid-id.ofp.json"));
assert.strictEqual(invalidIds.counts.error, 4, "each of the four reserved delimiters is rejected");
assert.strictEqual(codesOf(invalidIds).filter((code) => code === "id.invalid").length, 4);

/* Deterministic ID minting: position may MINT an identity exactly once, and may
   never BE one. P1 defines and tests the rule; P1 migrates nothing. */
const mintInput = () => [{ id: "fr-a" }, {}, {}, { id: "" }];
const firstMint = Ids.mintNestedIdentifiers(mintInput(), { type: "frame", parentSubject: "shot:sh-0100" });
const secondMint = Ids.mintNestedIdentifiers(mintInput(), { type: "frame", parentSubject: "shot:sh-0100" });
assert.deepStrictEqual(firstMint, secondMint, "the same legacy input must always mint the same identifiers");
assert.deepStrictEqual(firstMint, [
  { index: 1, mintedId: "frame-sh-0100-0002" },
  { index: 2, mintedId: "frame-sh-0100-0003" },
  { index: 3, mintedId: "frame-sh-0100-0004" },
]);
assert(firstMint.every((entry) => Ids.checkIdentifierFloor(entry.mintedId).ok && Ids.isIdentifierPortable(entry.mintedId)), "minted identifiers are portable");
/* Position is never identity: a record that already has an ID is untouched no
   matter where it sits, so reordering after minting changes nothing. */
const reordered = [{}, { id: "fr-a" }];
assert.deepStrictEqual(Ids.mintNestedIdentifiers(reordered, { type: "frame", parentSubject: "shot:sh-0100" }), [{ index: 0, mintedId: "frame-sh-0100-0001" }]);
assert.strictEqual(reordered[1].id, "fr-a", "minting must not touch a record that already has an identifier");
/* A positional stem that collides falls back to a content-addressed suffix, and
   that fallback is deterministic too - no counters, no clocks, no UUIDs. */
const collided = Ids.mintNestedIdentifiers([{ id: "frame-sh-0100-0002" }, {}], { type: "frame", parentSubject: "shot:sh-0100" });
assert.notStrictEqual(collided[0].mintedId, "frame-sh-0100-0002");
assert.deepStrictEqual(collided, Ids.mintNestedIdentifiers([{ id: "frame-sh-0100-0002" }, {}], { type: "frame", parentSubject: "shot:sh-0100" }));

/* ===========================================================================
   4. Target addressing. */

assert.deepStrictEqual(Target.parseSubjectRef("shot:sh-0100").steps, [{ type: "shot", id: "sh-0100" }]);
assert.deepStrictEqual(Target.parseSubjectRef("prop:prop-case/state:st-case-open").steps, [{ type: "prop", id: "prop-case" }, { type: "state", id: "st-case-open" }]);
/* An ID may contain "-" and ">" but never the grammar's own delimiters, which
   is what keeps the parse unambiguous. */
assert.deepStrictEqual(Target.parseSubjectRef("shot:INT-1->2").steps, [{ type: "shot", id: "INT-1->2" }]);
for (const bad of ["shot", "shot sh-0100", ":sh-0100", "shot:", "", "1shot:x"])
  assert.strictEqual(Target.parseSubjectRef(bad).ok, false, `${JSON.stringify(bad)} must not parse as a subject`);

assert.deepStrictEqual(Target.parseJsonPointer("").tokens, []);
assert.deepStrictEqual(Target.parseJsonPointer("/framing/size").tokens, ["framing", "size"]);
assert.deepStrictEqual(Target.parseJsonPointer("/a~1b/c~0d").tokens, ["a/b", "c~d"], "RFC 6901 escaping, unchanged");
assert.strictEqual(Target.parseJsonPointer("framing/size").ok, false, "a non-empty pointer must start with a slash");
assert.strictEqual(Target.parseJsonPointer("/a~2b").ok, false, "an invalid tilde escape is malformed");

assert.strictEqual(Target.formatTargetString({ subject: "shot:sh-0100", path: "/framing/size" }), "shot:sh-0100#/framing/size");
assert.strictEqual(Target.formatTargetString({ path: "/meta/title" }), "#/meta/title");
assert.strictEqual(Target.formatTargetString({ subject: "shot:sh-0100" }), "shot:sh-0100#");

/* Resolution, including the one restriction that does all the work. */
assert.strictEqual(Target.resolveTarget(representative, { subject: "shot:sh-0100", path: "/framing/size" }).value, "wide");
assert.strictEqual(Target.resolveTarget(representative, { subject: "shot:sh-0100/frame:fr-a", path: "/role" }).value, "first");
assert.strictEqual(Target.resolveTarget(representative, { subject: "prop:prop-case/state:st-case-open", path: "/delta" }).value, "Seal cut; lid raised.");
assert.strictEqual(Target.resolveTarget(representative, { subject: "source:src-script/anchor:sc-012-action-004" }).ok, true, "a whole record is addressable with no path");
assert.strictEqual(Target.resolveTarget(representative, { path: "/meta/title" }).value, "The Last Ferry");

/* Root-scoped targets are safe for free: /meta/title resolves and /shots/...
   cannot, with no special case for the root. */
const intoShots = Target.resolveTarget(representative, { path: "/shots/0/framing/size" });
assert.strictEqual(intoShots.ok, false);
assert.strictEqual(intoShots.code, "array-traversal");
assert.strictEqual(Target.resolveTarget(representative, { subject: "shot:sh-0100", path: "/risks/0" }).code, "array-traversal", "an array index can never become identity");
/* A whole array is still addressable as a value; only entering one fails. */
assert.deepStrictEqual(Target.resolveTarget(representative, { subject: "shot:sh-0100", path: "/risks" }).value, ["Dusk light changes fast.", "The bench is a practical."]);

/* Subject types are specific, so a type error is caught rather than accepted. */
assert.strictEqual(Target.resolveTarget(representative, { subject: "prop:char-mara" }).code, "unresolvable", "char-mara is a character, not a prop");
assert.strictEqual(Target.resolveTarget(representative, { subject: "entity:char-mara" }).code, "unresolvable", "there is no generic entity subject type");
assert.strictEqual(Target.resolveTarget(representative, { subject: "shot:sh-0100/state:st-mara-default" }).code, "unresolvable", "a state is not contained by a shot");

/* ABSENT is a resolution, not a failure - and it is distinct from null. */
const absent = Target.resolveTarget(representative, { subject: "shot:sh-0100", path: "/framing/nosuchfield" });
assert.strictEqual(absent.ok, true);
assert.strictEqual(absent.present, false);
assert.strictEqual(absent.value, Target.ABSENT);

/* The derived containment table must equal the frozen P0 §3 table exactly. It
   is walked out of the schema so the two cannot drift, and this is the assertion
   that proves the walk still produces the frozen contract. */
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(Schema.CONTAINMENT).map(([type, entry]) => [type, `${entry.scopes.join("/")}:${entry.container}`])),
  {
    scene: "project:story.scenes",
    shot: "project:shots",
    character: "project:entities.characters",
    location: "project:entities.locations",
    prop: "project:entities.props",
    vehicle: "project:entities.vehicles",
    voice: "project:entities.voices",
    source: "project:sources",
    asset: "project:assets",
    reference: "project:references",
    statement: "project:statements",
    frame: "shot:frames",
    motion: "shot:motion",
    relation: "shot:relations",
    state: "character/location/prop/vehicle:states",
    coverage: "location/prop/vehicle:coverage",
    anchor: "source:anchors",
  },
);

/* ===========================================================================
   5. Claim / value binding. */

/* RFC 8785 is reused, not reinvented. These vectors pin the properties the
   claim hash depends on: code-unit key order, ECMAScript numbers, no
   whitespace. */
assert.strictEqual(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
assert.strictEqual(canonicalJson({ "€": 1, $: 2, "é": 3 }), '{"$":2,"é":3,"€":1}', "keys sort by UTF-16 code unit, not by locale");
assert.strictEqual(canonicalJson(-0), "0");
assert.strictEqual(canonicalJson(1e21), "1e+21");
assert.strictEqual(canonicalJson(333333333.33333329), "333333333.3333333");
assert.strictEqual(canonicalJson([2, 1]), "[2,1]", "arrays are ordered data and are never sorted");

/* The correction that is load-bearing: absent OMITS the key, and absent must
   not hash the same as null. */
assert.strictEqual(Claim.claimPayloadJcs(Claim.buildClaimPayload("x#/y", Target.ABSENT)), '{"ofp":"claim/1","t":"x#/y"}');
assert.strictEqual(Claim.claimPayloadJcs(Claim.buildClaimPayload("x#/y", null)), '{"ofp":"claim/1","t":"x#/y","v":null}');
assert.notStrictEqual(Claim.computeClaimHash("x#/y", Target.ABSENT), Claim.computeClaimHash("x#/y", null), "absent and null are two different production facts and must not hash alike");
assert(!("v" in Claim.buildClaimPayload("x#/y", Target.ABSENT)), "the absent case omits the key rather than setting it undefined");

/* The target is inside the hash, so an approval cannot be retargeted onto a
   different field that happens to hold the same value. */
assert.notStrictEqual(Claim.computeClaimHash("shot:sh-0100#/framing/size", "wide"), Claim.computeClaimHash("shot:sh-0100#/framing/angle", "wide"));
assert.match(Claim.computeClaimHash("x#/y", "wide"), /^sha256:[0-9a-f]{64}$/);

/* The whole binding, end to end, against the golden fixture. */
for (const statement of representative.statements) {
  const recomputed = Claim.computeClaimHashForTarget(representative, statement.target);
  assert.strictEqual(recomputed.ok, true, `${statement.id} must resolve`);
  assert.strictEqual(statement.claim.hash, recomputed.hash, `${statement.id} claim hash must bind the current value`);
}

/* ===========================================================================
   6. Statements: five acts, derived state, and the rule that matters most. */

assert.deepStrictEqual(Statements.STATEMENT_KINDS, ["cited", "suggested", "observed", "approved", "disputed"], "five acts, frozen");
assert.deepStrictEqual(Object.keys(Schema.records.STATEMENT.properties), ["id", "target", "kind", "claim", "actor", "at", "evidence", "candidates", "note"]);
assert(!Statements.STATEMENT_KINDS.includes("human-authored"), "ordinary authored data carries no statement at all");
assert(!Statements.STATEMENT_KINDS.includes("superseded"), "supersession is derived, never a kind");
assert(!Statements.STATEMENT_KINDS.includes("unspecified"), "unspecified is field semantics, not evidence");

for (const statement of representative.statements)
  assert.strictEqual(Statements.deriveStatementState(representative, statement).state, "current", `${statement.id} is current in the golden fixture`);

const stale = loadFixture("stale-approval.ofp.json");
const staleApproval = stale.statements.find((entry) => entry.kind === "approved");
assert.strictEqual(Statements.deriveStatementState(stale, staleApproval).state, "stale");

/* A stale approval confers no approval - and is not dropped. */
const badge = Statements.deriveTargetBadge(stale, stale.statements, { subject: "shot:sh-0100", path: "/framing/size" });
assert.strictEqual(badge.badge, "authored", "with every statement stale, the field falls back to plain authored data");
assert.strictEqual(badge.label, "Authored");
assert.strictEqual(stale.statements.length, 2, "stale statements are retained, never silently removed");
const staleResult = validateOfpDocument(readFixture("stale-approval.ofp.json"));
assert(has(staleResult, "statement.stale") && has(staleResult, "statement.stale.approval"));
assert.strictEqual(staleResult.ok, true, "staleness is a warning: the document is legal and the statement is kept");

/* The fold, on the golden fixture, where the statements are current. */
const badgeFor = (target) => Statements.deriveTargetBadge(representative, representative.statements, target).badge;
assert.strictEqual(badgeFor({ subject: "shot:sh-0100", path: "/framing/size" }), "approved");
assert.strictEqual(badgeFor({ subject: "character:char-mara", path: "/name" }), "cited");
assert.strictEqual(badgeFor({ subject: "character:char-mara", path: "/description" }), "suggested");
assert.strictEqual(badgeFor({ subject: "shot:sh-0100", path: "/setting" }), "conflict", "a conflict outranks everything");
assert.strictEqual(badgeFor({ subject: "shot:sh-0100/frame:fr-a", path: "/description" }), "observed");
/* Ordinary authored production data carries no statement, and that is the
   common case rather than an omission. */
assert.strictEqual(badgeFor({ subject: "shot:sh-0100", path: "/title" }), "authored");

/* Statement rules the validator enforces. */
const nonHuman = validateOfpDocument(readFixture("approved-non-human.ofp.json"));
assert(has(nonHuman, "statement.actor.not-human"), "only a human can approve");
assert(has(nonHuman, "statement.actor.missing"), "an approval with no actor at all is also refused");
assert(has(validateOfpDocument(readFixture("disputed-without-candidates.ofp.json")), "statement.candidates.missing"));
assert(has(validateOfpDocument(readFixture("unresolvable-target.ofp.json")), "statement.target.unresolvable"));
assert(has(validateOfpDocument(readFixture("array-traversal-target.ofp.json")), "statement.target.array-traversal"));
assert.strictEqual(codesOf(validateOfpDocument(readFixture("malformed-target.ofp.json"))).filter((code) => code === "statement.target.malformed").length, 2);

/* ===========================================================================
   7. Unspecified is field semantics, not evidence. */

const unspecified = loadFixture("deliberately-unspecified.ofp.json");
assert.strictEqual(unspecified.shots[0].framing.lens, "unspecified");
assert.strictEqual(unspecified.shots[0].duration.basis, "unspecified");
assert.strictEqual(validateOfpDocument(readFixture("deliberately-unspecified.ofp.json")).ok, true);
/* It survives a tool that discards statements[] entirely, which is the whole
   reason it lives in the field rather than in evidence. */
const withoutStatements = JSON.parse(JSON.stringify(unspecified));
delete withoutStatements.statements;
assert.strictEqual(withoutStatements.shots[0].framing.lens, "unspecified", "a deliberate non-decision must survive losing the evidence array");
/* And it is declared only where production genuinely distinguishes it - P0 §5
   names exactly two fields, and widening that list is not P1's call to make. */
const enumsWithUnspecified = [];
(function collect(spec, where) {
  if (!spec || typeof spec !== "object") return;
  if (Array.isArray(spec.enum) && spec.enum.includes("unspecified")) enumsWithUnspecified.push(where);
  for (const [key, child] of Object.entries(spec.properties || {})) collect(child, `${where}/${key}`);
  if (spec.items) collect(spec.items, `${where}[]`);
})(Schema.DOCUMENT, "");
assert.deepStrictEqual(enumsWithUnspecified.sort(), ["/shots[]/duration/basis", "/shots[]/framing/lens"]);

/* Empty string is never a semantic state. */
(function noEmptyStringEnums(spec) {
  if (!spec || typeof spec !== "object") return;
  if (Array.isArray(spec.enum)) assert(!spec.enum.includes(""), "an empty string must never be a declared enum member");
  for (const child of Object.values(spec.properties || {})) noEmptyStringEnums(child);
  if (spec.items) noEmptyStringEnums(spec.items);
})(Schema.DOCUMENT);

/* ===========================================================================
   8. Voice is a first-class entity that a character links to. */

const voices = representative.entities.voices;
const mara = representative.entities.characters.find((entry) => entry.id === "char-mara");

/* A character links several voices, each with its own role: primary, an
   alternate language, and an ADR pass. */
assert.deepStrictEqual(mara.voices.map((link) => link.role), ["primary", "alternate-language", "adr"]);
for (const link of mara.voices)
  assert(voices.some((voice) => voice.id === link.voiceId), `${link.voiceId} must be a real voice entity`);

/* Every linked voice is addressable in its own right - the link is a reference,
   not ownership. */
for (const link of mara.voices)
  assert.strictEqual(Target.resolveTarget(representative, { subject: `voice:${link.voiceId}`, path: "/name" }).ok, true);

/* And the case a child-of-character model could not represent at all: voices
   no character links, which are ordinary valid entities rather than orphans. */
const linkedIds = new Set(representative.entities.characters.flatMap((character) => (character.voices || []).map((link) => link.voiceId)));
const standalone = voices.filter((voice) => !linkedIds.has(voice.id));
assert.deepStrictEqual(standalone.map((voice) => voice.id).sort(), ["voice-narrator", "voice-terminal-pa"]);
assert.deepStrictEqual(standalone.map((voice) => voice.kind).sort(), ["announcer", "narrator"]);
for (const voice of standalone)
  assert.strictEqual(Target.resolveTarget(representative, { subject: `voice:${voice.id}`, path: "/kind" }).ok, true, `${voice.id} is addressable with no character in the picture`);
assert.strictEqual(validateOfpDocument(readFixture("representative.ofp.json")).ok, true, "standalone voices are valid, not dangling references");

/* Structurally: voices live in entities, and a voice carries no owning
   character. Both halves matter - the second is what keeps a voice reusable. */
assert(Schema.DOCUMENT.properties.entities.properties.voices, "voices is a peer entity collection");
assert.strictEqual(Schema.CONTAINMENT.voice.scopes.join(), "project", "a voice is scoped to the project, never to a character");
assert(!("characterId" in Schema.records.VOICE.properties), "a voice must not name an owning character; characters point at voices");

/* ===========================================================================
   9. Unknown data survives, and nothing is coerced. */

const unknownExtension = validateOfpDocument(readFixture("unknown-extension.ofp.json"));
assert.strictEqual(unknownExtension.ok, true, "unknown content is forward compatibility, not an error");
assert.deepStrictEqual(unknownExtension.document.extensions["com.example.futuretool"], { schedule: { day: 4, notes: ["keep me"] }, opaque: { z: 1, a: 2 } }, "a foreign extension subtree is preserved exactly");
assert.deepStrictEqual(unknownExtension.document.shots[0].futureFieldNobodyDeclared, { nested: [1, 2, { deep: true }] });
assert(has(unknownExtension, "schema.unknown-property"), "an undeclared key is reported");
assert.strictEqual(unknownExtension.diagnostics.find((entry) => entry.code === "schema.unknown-property").severity, "warning");
/* The extensions block is foreign by definition and is not picked over key by
   key - reporting a subtree this contract does not model would be noise. */
assert(!unknownExtension.diagnostics.some((entry) => entry.where.startsWith("/extensions")), "declared extension containers are not inspected");

const unknownEnum = validateOfpDocument(readFixture("unknown-enum.ofp.json"));
assert.strictEqual(unknownEnum.ok, true);
assert(has(unknownEnum, "schema.enum.unknown"));
assert.strictEqual(unknownEnum.document.shots[0].framing.size, "ultra-wide", "an unknown enum value is reported and preserved verbatim, never coerced to a declared member");

/* ===========================================================================
   10. Absent, null and set are three different things. */

const absentVsNull = loadFixture("absent-vs-null.ofp.json");
const shotAbsent = absentVsNull.shots.find((shot) => shot.id === "sh-absent");
const shotNull = absentVsNull.shots.find((shot) => shot.id === "sh-null");
assert.strictEqual("seconds" in shotAbsent.duration, false, "absent means the key is not there");
assert.strictEqual("seconds" in shotNull.duration, true);
assert.strictEqual(shotNull.duration.seconds, null, "null means the slot exists and was never set");
assert.notStrictEqual(
  absentVsNull.statements.find((entry) => entry.id === "stm-absent").claim.hash,
  absentVsNull.statements.find((entry) => entry.id === "stm-null").claim.hash,
  "the two states must not hash alike",
);
assert.strictEqual(validateOfpDocument(readFixture("absent-vs-null.ofp.json")).ok, true);

/* ===========================================================================
   11. The validator reports; it never repairs, defaults, coerces or mutates. */

const parsedOnce = loadFixture("representative.ofp.json");
const snapshot = JSON.stringify(parsedOnce);
const validated = validateOfpDocument(parsedOnce);
assert.strictEqual(JSON.stringify(parsedOnce), snapshot, "validating an already-parsed document must not change one byte of it");
assert.strictEqual(validated.document, parsedOnce, "the validator returns the document it was given, not a normalized copy");

/* The same, for every fixture and every document class, because the defect this
   guards against is exactly the one that only shows up on the odd input. */
const fixtureNames = fs.readdirSync(FIXTURES).filter((entry) => entry.endsWith(".json"));
for (const name of fixtureNames) {
  const text = readFixture(name);
  let parsed;
  try { parsed = parseJsonStrict(text); } catch { continue; }
  const before = JSON.stringify(parsed);
  validateOfpDocument(parsed);
  assert.strictEqual(JSON.stringify(parsed), before, `validating ${name} must not mutate it`);
  /* And validating the text form must produce the same document as parsing it,
     with no defaults injected on the way through. */
  assert.strictEqual(JSON.stringify(validateOfpDocument(text).document), before, `${name} must survive text-form validation unchanged`);
}

/* A SPARSE document, explicitly, because that is where a defaulting defect
   actually shows up. Every golden fixture carries a value for nearly every enum
   it declares, so a loader that filled in absent fields would leave them all
   untouched and the loop above would pass while the defect shipped. */
const sparse = {
  format: { id: "open-film-project", version: "1.0-draft.1" },
  shots: [{ id: "sh-0100", framing: { size: "wide" }, duration: {} }],
  entities: { characters: [{ id: "char-a" }] },
};
const sparseBefore = JSON.stringify(sparse);
validateOfpDocument(sparse);
assert.strictEqual(JSON.stringify(sparse), sparseBefore, "an absent optional field must not acquire a value because the document was inspected");
assert.strictEqual("angle" in sparse.shots[0].framing, false, "no camera angle is invented");
assert.strictEqual("lens" in sparse.shots[0].framing, false, "and a deliberate absence is not overwritten with a default");
assert.strictEqual("basis" in sparse.shots[0].duration, false);
assert.deepStrictEqual(Object.keys(sparse.entities.characters[0]), ["id"]);

/* No key acquires a value merely because the document was inspected. */
const minimal = validateOfpDocument(readFixture("minimal.ofp.json"));
assert.deepStrictEqual(Object.keys(minimal.document), ["format", "meta"], "a minimal document gains no collections by being read");
assert.strictEqual(minimal.document.shots, undefined);
assert.strictEqual(minimal.document.statements, undefined);
assert.strictEqual(minimal.document.entities, undefined);

/* ===========================================================================
   12. Strict parsing: duplicate keys and a BOM are refused. */

assert.throws(() => parseJsonStrict('{"id":"a","id":"b"}'), (error) => error instanceof OfpJsonError && error.code === "json.duplicate-key");
assert(has(validateOfpDocument(readFixture("duplicate-key.ofp.json")), "json.duplicate-key"), "a duplicate key is refused at parse, where it is still observable");
assert.strictEqual(JSON.parse('{"id":"a","id":"b"}').id, "b", "the platform parser silently keeps the last, which is why the contract carries its own");
assert.throws(() => parseJsonStrict('﻿{"a":1}'), (error) => error.code === "json.bom");
assert.throws(() => parseJsonStrict('{"a":1,}'), (error) => error.code === "json.syntax");
assert.throws(() => parseJsonStrict("{'a':1}"), (error) => error.code === "json.syntax");
assert.throws(() => parseJsonStrict('{"a":01}'), (error) => error.code === "json.syntax");
assert.throws(() => parseJsonStrict('{"a":1} trailing'), (error) => error.code === "json.syntax");
assert.throws(() => parseJsonStrict('{"a":"raw ' + "\u0001" + ' control"}'), (error) => error.code === "json.syntax", "RFC 8259 forbids a raw control character inside a string");
assert.deepStrictEqual(parseJsonStrict('{"a":[1,2,{"b":null}],"c":"\\u00e9"}'), { a: [1, 2, { b: null }], c: "é" });
/* A key named __proto__ must become ordinary data rather than reassigning the
   prototype, or a document could hide its own content from every later reader. */
const proto = parseJsonStrict('{"__proto__":{"polluted":true},"id":"x"}');
assert.strictEqual(Object.getPrototypeOf(proto), Object.prototype);
assert.deepStrictEqual(Object.getOwnPropertyDescriptor(proto, "__proto__").value, { polluted: true });
assert.strictEqual({}.polluted, undefined);

/* ===========================================================================
   13. Diagnostics are a registry, and severity is part of the contract. */

for (const result of fixtureNames.map((name) => validateOfpDocument(readFixture(name))))
  for (const diagnostic of result.diagnostics) {
    assert(DIAGNOSTICS[diagnostic.code], `${diagnostic.code} must be registered`);
    assert.strictEqual(diagnostic.severity, DIAGNOSTICS[diagnostic.code].severity);
    assert.strictEqual(diagnostic.mode, DIAGNOSTICS[diagnostic.code].mode);
    assert(diagnostic.message.length > 0, `${diagnostic.code} must carry a human-readable message`);
  }

/* Every diagnostic P0 §6 names must exist, at the severity it was frozen at. */
for (const code of ["statement.target.unresolvable", "statement.target.array-traversal", "statement.stale", "statement.stale.approval", "statement.candidates.missing", "statement.actor.missing", "id.not-portable"])
  assert(DIAGNOSTICS[code], `${code} is required by the frozen contract`);
assert.strictEqual(DIAGNOSTICS["id.not-portable"].severity, "warning", "id.not-portable must stay a warning; an error is what would eventually tempt somebody to rename a legacy ID");
assert.strictEqual(DIAGNOSTICS["statement.stale"].severity, "warning", "a stale statement is retained, not rejected");
assert.strictEqual(DIAGNOSTICS["statement.target.unresolvable"].severity, "error", "an unresolvable target means evidence was orphaned by a rename or a delete");

/* Modes are separable, so a caller can act on them differently. */
assert.strictEqual(validateOfpDocument(readFixture("unknown-enum.ofp.json"), { modes: [MODES.SEMANTIC] }).diagnostics.length, 0, "a structural warning must not surface when only semantics were requested");
assert.deepStrictEqual(codesOf(validateOfpDocument(readFixture("id-not-portable.ofp.json"), { modes: [MODES.PORTABILITY] })), ["id.not-portable"]);

/* ===========================================================================
   14. Reserved traditional filmmaking terminology (P0 §12).
   Reserved so these terms cannot acquire a different meaning before the
   profiles that need them exist. The check is against the schema's own property
   names rather than the source text, so the comments explaining a reservation
   do not trip the guard that enforces it. */

const RESERVED = ["take", "takes", "takeNumber", "slug", "slugline", "stage", "plate", "plates", "unit",
  "timecode", "slate", "sceneNumber", "setup", "page", "pages", "eighths", "castNumber", "soundRoll",
  "roll", "board", "stripboard", "day", "shootingOrder"];
const propertyNames = new Set();
(function collectNames(spec) {
  if (!spec || typeof spec !== "object") return;
  for (const [key, child] of Object.entries(spec.properties || {})) { propertyNames.add(key); collectNames(child); }
  if (spec.items) collectNames(spec.items);
})(Schema.DOCUMENT);
for (const term of RESERVED)
  assert(!propertyNames.has(term), `"${term}" is reserved by P0 §12 and must not be a field name in this contract`);
/* `anchor` IS reserved, and sources[].anchors is its correct future home - a
   citation point in a source document. What must not use the name is media
   references, which are references[] with a purpose. */
assert(propertyNames.has("anchors"));
assert.strictEqual(Schema.CONTAINMENT.anchor.scopes.join(), "source", "anchors belong to sources, never to media references");
assert(Schema.records.REFERENCE.properties.purpose.enum.includes("identity-front"), "identity images are a reference purpose, not an anchor");
assert(!("shoot" in Schema.records.SHOT.properties.order.properties), "a third ordinal must mean scheduling and nothing else");

/* ===========================================================================
   15. Schema key-order stability (P0 N5).
   Schema-derived file ordering depends on JS object key-insertion order
   surviving, which holds in V8 for every key that is not integer-like. No OFP
   field name is a number, and this is what keeps it that way. */

for (const name of propertyNames)
  assert(!/^(?:0|[1-9]\d*)$/.test(name), `property name "${name}" is integer-like, which V8 would reorder ahead of every other key`);

console.log(`OFP contract conformance passed: ${fixtureNames.length} fixtures, ${Object.keys(DIAGNOSTICS).length} registered diagnostics, ${Object.keys(Schema.CONTAINMENT).length} addressable record types.`);

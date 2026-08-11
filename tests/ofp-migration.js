/* Open Film Project P2 — the explicit legacy migration framework.
 *
 * P1 proved that opening a project writes nothing. P2 has to hold that while
 * doing something to the project, which is a harder promise, so the properties
 * this suite exists for are:
 *
 *   - the source is never touched, and preview never reaches a filesystem;
 *   - every meaningful source value has exactly one named disposition, and
 *     there is no sixth category called "we forgot about it";
 *   - migration guesses out loud and only where it guesses - a deterministic
 *     authored mapping emits no statement at all;
 *   - the same legacy input always produces the same bytes, the same IDs and
 *     the same report;
 *   - a migration is not successful because serialization completed.
 *
 * Negative controls live in tests/ofp-migration-negative-controls.js.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { parseJsonStrict } = require("../ofp/ofp-json");
const { serializeCanonical } = require("../ofp/ofp-serialize");
const { resolveTarget, formatTargetString } = require("../ofp/ofp-target");
const { computeClaimHash } = require("../ofp/ofp-claim");
const { OFP_CONTRACT_VERSION, OFP_FORMAT_ID } = require("../ofp/ofp-format");
const { withNoWritesUnder } = require("../ofp/ofp-fs-guard");
const { snapshotTree, diffSnapshots, CANONICAL_FILENAME } = require("../ofp/ofp-read");
const Detect = require("../ofp/ofp-migrate-detect");
const { MIGRATION_RULES, RULE_IDS, DETERMINISM, ruleById, keyLooksSecret } = require("../ofp/ofp-migrate-rules");
const { DISPOSITIONS, SourceLedger, enumerateLeaves } = require("../ofp/ofp-migrate-accounting");
const { MIGRATION_DIAGNOSTICS } = require("../ofp/ofp-migrate-diagnostics");
const { scanMigrationOutput } = require("../ofp/ofp-migrate-scan");
const { writeMigratedCopy, checkDestination, MigrationDestinationError } = require("../ofp/ofp-migrate-write");
const Migrate = require("../ofp/ofp-migrate");
const { previewLegacyMigration, migrateLegacyProject, buildMigrationPlan, MIGRATION_STATEMENT_KINDS, TEMPLATE_QC_CHECKLIST } = Migrate;

const FIXTURES = path.join(__dirname, "fixtures", "ofp-legacy");
const AT = "2026-08-10T00:00:00Z";
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const loadFixture = (name) => parseJsonStrict(readFixture(name));
const preview = (name, options = {}) => previewLegacyMigration(loadFixture(name), { at: AT, ...options });
const fixtureNames = fs.readdirSync(FIXTURES).filter((name) => name.endsWith(".json")).sort();
/* Every fixture that is a migratable CineBraid project. The foreign-application
   one is deliberately not, and is exercised separately. */
const MIGRATABLE = fixtureNames.filter((name) => name !== "foreign-application.json");
const codesOf = (result) => result.report.diagnostics.map((entry) => entry.code);
const statementsOf = (result) => (result.candidate && result.candidate.statements) || [];

/* ===========================================================================
   1. The rule registry is explicit, inspectable and stable. */

assert(MIGRATION_RULES.length >= 25, "the registry must actually contain the rules");
assert.strictEqual(new Set(RULE_IDS).size, RULE_IDS.length, "migration rule IDs must be unique");
for (const rule of MIGRATION_RULES) {
  assert(/^M\d{3}$/.test(rule.id), `${rule.id} is not an M### identifier`);
  assert(typeof rule.apply === "function", `${rule.id} has no implementation`);
  assert(rule.name && rule.summary, `${rule.id} must be documented in the registry itself`);
  assert(Object.values(DETERMINISM).includes(rule.determinism), `${rule.id} must declare deterministic, inferential or mixed`);
  assert(Array.isArray(rule.appliesTo) && rule.appliesTo.length, `${rule.id} must declare the generations it applies to`);
  assert.strictEqual(ruleById(rule.id), rule);
}

/* The audit's Part 27 matrix names these IDs with these meanings. P2 uses them
   rather than renumbering, because an ID that moved is an ID that cannot be
   traced back to the decision that created it. */
const AUDIT_RULE_IDS = ["M001", "M002", "M010", "M011", "M012", "M013", "M014", "M015", "M016", "M020", "M021", "M022", "M030", "M031", "M040", "M041", "M042", "M050", "M051", "M052", "M053"];
for (const id of AUDIT_RULE_IDS) {
  const rule = ruleById(id);
  assert(rule, `${id} is named by the frozen audit matrix and must exist`);
  assert.strictEqual(rule.origin, id === "M040" ? "audit Part 27, amended by P0 §10.6" : "audit Part 27", `${id} must be attributed to the record that named it`);
}
/* And the P2 assignments are declared as such rather than passing themselves off
   as audit IDs. */
for (const rule of MIGRATION_RULES)
  if (!AUDIT_RULE_IDS.includes(rule.id)) assert(rule.origin.startsWith("P2"), `${rule.id} is a P2 assignment and must say so`);

/* Registry order is the execution order, and it is stable. */
assert.deepStrictEqual(RULE_IDS.slice(0, 3), ["M080", "M001", "M002"], "the quarantine runs before any rule can carry a value");
assert.strictEqual(RULE_IDS[RULE_IDS.length - 1], "M070", "the unknown-content sweep runs last, after every rule has claimed what it knows");

/* Every registered migration diagnostic is emittable and every emitted code is
   registered - the same discipline P1 holds for the validator's registry. */
for (const [code, entry] of Object.entries(MIGRATION_DIAGNOSTICS))
  assert(["error", "warning", "info"].includes(entry.severity), `${code} has no severity`);

/* ===========================================================================
   2. Source detection keeps the version markers apart. */

{
  const declared = Detect.detectLegacyProject(loadFixture("clean.json"));
  assert.strictEqual(declared.family, Detect.SOURCE_FAMILY.CINEBRAID_LEGACY);
  assert.strictEqual(declared.generation, "6.7");
  assert.strictEqual(declared.confidence, "declared");
  assert.strictEqual(declared.schemaVersion, "6.7");
  assert.strictEqual(declared.hubVersion, "v6.0.0");
  /* The shipped sample stores an APPLICATION version in meta.version. Reading it
     as the film's draft number is the confusion this classification exists to
     stop. */
  assert.strictEqual(declared.metaVersionClass, Detect.META_VERSION_CLASS.APPLICATION_VERSION);
  assert.strictEqual(declared.formatVersion, null, "a legacy project declares no contract version");

  const sniffed = Detect.detectLegacyProject(loadFixture("no-schema-version.json"));
  assert.strictEqual(sniffed.confidence, "sniffed", "13 of 18 measured generations have no marker; shape has to answer");
  assert.strictEqual(sniffed.schemaVersion, null);
  assert.strictEqual(sniffed.generation, "pre-6.6");
  assert(sniffed.shapeMarkers.length, "a sniffed classification must show its evidence");
  assert.strictEqual(sniffed.metaVersionClass, Detect.META_VERSION_CLASS.FILM_DRAFT, "\"v2.1\" is the film's own draft number");

  assert.strictEqual(Detect.detectLegacyProject(loadFixture("template-default.json")).metaVersionClass, Detect.META_VERSION_CLASS.TEMPLATE_DEFAULT);
  assert.strictEqual(Detect.classifyMetaVersion(undefined), Detect.META_VERSION_CLASS.ABSENT);
  assert.strictEqual(Detect.classifyMetaVersion("6.6.4-studio.2"), Detect.META_VERSION_CLASS.APPLICATION_VERSION);
  assert.strictEqual(Detect.classifyMetaVersion("v2.1"), Detect.META_VERSION_CLASS.FILM_DRAFT);
  assert.strictEqual(Detect.classifyMetaVersion("release candidate"), Detect.META_VERSION_CLASS.UNKNOWN, "an unclassifiable label must not be forced into a class");

  const foreign = Detect.detectLegacyProject(loadFixture("foreign-application.json"));
  assert.strictEqual(foreign.family, Detect.SOURCE_FAMILY.FOREIGN_APPLICATION);
  assert.strictEqual(foreign.migratable, false, "the audit names this application by path and says do not migrate it");

  const alreadyOfp = Detect.detectLegacyProject({ format: { id: OFP_FORMAT_ID, version: OFP_CONTRACT_VERSION } });
  assert.strictEqual(alreadyOfp.family, Detect.SOURCE_FAMILY.OPEN_FILM_PROJECT);
  assert.strictEqual(alreadyOfp.migratable, false, "an OFP document is not a migration source");

  assert.strictEqual(Detect.detectLegacyProject({ shots: [] }).migratable, false, "one array is not a project");
  assert.strictEqual(Detect.detectLegacyProject(null).family, Detect.SOURCE_FAMILY.UNKNOWN);
}

/* A non-migratable source produces a refusal, not a partial document. */
for (const [name, code] of [["foreign-application.json", "migration.source.foreign"]]) {
  const result = preview(name);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.candidate, null, "a refusal must not produce a half-migrated document");
  assert(codesOf(result).includes(code));
}

/* ===========================================================================
   3. SCENARIO A — a deterministic clean migration.

   No ambiguity in, so no statements out. This is P0 §10.3's rule, and it is
   what keeps statements[] sparse: migrations emit statements only where they
   guess, and a deterministic authored mapping is not a guess. */

const clean = preview("clean.json");
assert.strictEqual(clean.ok, true, "the clean fixture must migrate without an error");
assert.strictEqual(clean.validation.ok, true, "and the candidate must pass the P1 validator");
assert.strictEqual(statementsOf(clean).length, 0, "a deterministic migration writes NO statements");
assert.strictEqual(clean.report.summary.disputes, 0);
assert.strictEqual(clean.report.summary.inferredMappings, 0);
assert.strictEqual(clean.report.diagnostics.length, 0, "and raises nothing needing review");
assert.strictEqual(clean.candidate.format.id, OFP_FORMAT_ID);
assert.strictEqual(clean.candidate.format.version, OFP_CONTRACT_VERSION);
assert.strictEqual(clean.plan.experimental, true, "the API must make the experimental, copied nature explicit");
assert.strictEqual(clean.report.target.experimental, true);

/* Legacy identity survives verbatim, and the ordinal that legacy stored only as
   array position is now data. */
assert.deepStrictEqual(clean.candidate.shots.map((shot) => shot.id), ["DEPOT-01", "DEPOT-02"]);
assert.deepStrictEqual(clean.candidate.shots.map((shot) => shot.order.script), [1, 2]);
assert.strictEqual(clean.candidate.story.scenes[0].order.script, 1);
assert.strictEqual(clean.candidate.shots[0].duration.seconds, 6);
assert.strictEqual(clean.candidate.shots[0].duration.basis, "authored");
assert.deepStrictEqual(clean.candidate.shots[1].frames.map((frame) => frame.role), ["first", "last"]);
assert.strictEqual(clean.candidate.shots[0].setting.locationId, "LOC-DEPOT");
assert.deepStrictEqual(clean.candidate.shots[0].subjects.map((entry) => entry.entityId), ["CHAR-CLERK", "PROP-CRATE"]);
assert.strictEqual(clean.candidate.entities.characters[0].description, "Middle-aged, grey cardigan, reading glasses pushed up.");
assert.strictEqual(clean.candidate.entities.props[0].states.find((state) => state.id === "state-opened").derivesFrom, "state-sealed");

/* Rule 10: an explicitly empty collection was present, so it is retained as
   empty rather than invented or dropped. */
assert.deepStrictEqual(clean.candidate.shots[0].motion, []);
assert.deepStrictEqual(clean.candidate.entities.vehicles, []);
assert.deepStrictEqual(clean.candidate.shots[1].risks, []);

/* Runtime preference is kept and is out of core. */
assert.strictEqual(clean.candidate.shots[0].stillModel, undefined, "a provider preference is not film semantics");
assert.strictEqual(clean.candidate.extensions["com.cinebraid.workflow"].shots["shot:DEPOT-01"].stillModel, "gpt-image-2");
assert.strictEqual(clean.candidate.extensions["com.cinebraid.workflow"].status["shot:DEPOT-01"].production, "APPROVED");

/* ===========================================================================
   4. NO SILENT LOSS — the central P2 invariant.

   Two independent checks, because each fails vacuously in a different
   direction. The ledger check proves nothing escaped; the pinned table proves
   the rules are still doing the mapping rather than letting the sweep quietly
   preserve everything, which the ledger alone could not tell apart. */

for (const name of MIGRATABLE) {
  const result = preview(name);
  assert.deepStrictEqual(result.report.accounting.unaccounted, [], `${name}: every source value must have a disposition`);
  for (const entry of result.report.accounting.entries) {
    assert(DISPOSITIONS.includes(entry.disposition), `${name}: ${entry.pointer} has no valid disposition`);
    assert(RULE_IDS.includes(entry.rule), `${name}: ${entry.pointer} names ${entry.rule}, which is not in the registry`);
    assert(entry.note, `${name}: ${entry.pointer} was disposed of with no reason recorded`);
    if (entry.disposition !== "dropped") assert(entry.targets.length, `${name}: ${entry.pointer} was ${entry.disposition} with no destination`);
  }
}

/* A claim must name a leaf. Claiming a record container would count as covering
   every value inside it, and one call would then satisfy the accounting for a
   whole shot. */
{
  const ledger = new SourceLedger({ shots: [{ id: "a", title: "t" }] });
  assert.throws(() => ledger.claim("/shots/0", { rule: "M005", disposition: "mapped" }), /not a source leaf/);
  ledger.claim("/shots/0/id", { rule: "M005", disposition: "mapped", note: "n", targets: ["shot:a"] });
  assert.deepStrictEqual(ledger.unaccounted(), ["/shots/0/title"], "the sibling is still outstanding");
}

/* Absence produces no obligation; null and an explicitly empty collection both
   do. That is the distinction the whole format exists to keep. */
{
  const leaves = enumerateLeaves({ a: null, b: [], c: {}, d: "x", e: { f: 1 } });
  assert.deepStrictEqual(leaves.sort(), ["/a", "/b", "/c", "/d", "/e/f"].sort());
  assert(!leaves.includes("/z"), "an absent key is not a value and creates no obligation");
}

/* The pinned accounting table for the clean fixture. Adding a field to the
   fixture is expected and this list moves with it; a MAPPING that silently
   became a preservation is what this catches. */
const PINNED_ACCOUNTING = [
  ["/agentRuns", "M052", "dropped"],
  ["/audio", "M017", "mapped"],
  ["/characters/0/approvedFile", "M030", "mapped"],
  ["/characters/0/continuityStates/0/id", "M007", "mapped"],
  ["/characters/0/continuityStates/0/isDefault", "M007", "mapped"],
  ["/characters/0/continuityStates/0/name", "M007", "mapped"],
  ["/characters/0/continuityStates/0/notes", "M016", "mapped"],
  ["/characters/0/coverageSlots", "M008", "preserved"],
  ["/characters/0/creationDescription", "M011", "mapped"],
  ["/characters/0/id", "M006", "mapped"],
  ["/characters/0/name", "M006", "mapped"],
  ["/characters/0/role", "M006", "mapped"],
  ["/characters/0/workflowStatus", "M012", "preserved"],
  ["/decisions", "M052", "dropped"],
  ["/jobs", "M052", "dropped"],
  ["/locations/0/continuityStates", "M007", "mapped"],
  ["/locations/0/coverageSlots/0/approvedFile", "M030", "mapped"],
  ["/locations/0/coverageSlots/0/id", "M008", "mapped"],
  ["/locations/0/coverageSlots/0/label", "M008", "mapped"],
  ["/locations/0/coverageSlots/0/notes", "M008", "mapped"],
  ["/locations/0/coverageSlots/0/requirement", "M015", "preserved"],
  ["/locations/0/description", "M011", "mapped"],
  ["/locations/0/id", "M006", "mapped"],
  ["/locations/0/name", "M006", "mapped"],
  ["/locations/0/workflowStatus", "M012", "preserved"],
  ["/mediaAssets", "M031", "dropped"],
  ["/meta/aspectRatio", "M003", "mapped"],
  ["/meta/format", "M003", "preserved"],
  ["/meta/hubVersion", "M002", "dropped"],
  ["/meta/promptDefaults/imageProfile", "M050", "preserved"],
  ["/meta/promptDefaults/videoProfile", "M050", "preserved"],
  ["/meta/schemaVersion", "M001", "dropped"],
  ["/meta/title", "M003", "mapped"],
  ["/meta/version", "M002", "dropped"],
  ["/meta/workflowEmphasis", "M050", "preserved"],
  ["/props/0/continuityStates/0/id", "M007", "mapped"],
  ["/props/0/continuityStates/0/isDefault", "M007", "mapped"],
  ["/props/0/continuityStates/0/name", "M007", "mapped"],
  ["/props/0/continuityStates/0/notes", "M016", "mapped"],
  ["/props/0/continuityStates/1/id", "M007", "mapped"],
  ["/props/0/continuityStates/1/name", "M007", "mapped"],
  ["/props/0/continuityStates/1/notes", "M016", "mapped"],
  ["/props/0/continuityStates/1/parentStateId", "M007", "mapped"],
  ["/props/0/coverageSlots", "M008", "mapped"],
  ["/props/0/description", "M011", "mapped"],
  ["/props/0/id", "M006", "mapped"],
  ["/props/0/name", "M006", "mapped"],
  ["/scenes/0/howItFeels", "M004", "preserved"],
  ["/scenes/0/id", "M004", "mapped"],
  ["/scenes/0/tier", "M004", "preserved"],
  ["/scenes/0/title", "M004", "mapped"],
  ["/scenes/0/whatHappens", "M004", "mapped"],
  ["/shots/0/characters/0", "M020", "mapped"],
  ["/shots/0/clips", "M009", "mapped"],
  ["/shots/0/codes/0", "M020", "mapped"],
  ["/shots/0/codes/1", "M020", "mapped"],
  ["/shots/0/desc", "M005", "mapped"],
  ["/shots/0/dur", "M010", "mapped"],
  ["/shots/0/id", "M005", "mapped"],
  ["/shots/0/keyframes/0/description", "M009", "mapped"],
  ["/shots/0/keyframes/0/id", "M009", "mapped"],
  ["/shots/0/keyframes/0/winner", "M030", "mapped"],
  ["/shots/0/reviewStatus", "M012", "preserved"],
  ["/shots/0/risks/0", "M005", "mapped"],
  ["/shots/0/scene", "M005", "mapped"],
  ["/shots/0/stillModel", "M050", "preserved"],
  ["/shots/0/title", "M005", "mapped"],
  ["/shots/0/workflowStatus", "M012", "preserved"],
  ["/shots/1/clips", "M009", "mapped"],
  ["/shots/1/codes/0", "M020", "mapped"],
  ["/shots/1/codes/1", "M020", "mapped"],
  ["/shots/1/desc", "M005", "mapped"],
  ["/shots/1/dur", "M010", "mapped"],
  ["/shots/1/id", "M005", "mapped"],
  ["/shots/1/keyframes/0/description", "M009", "mapped"],
  ["/shots/1/keyframes/0/id", "M009", "mapped"],
  ["/shots/1/keyframes/1/description", "M009", "mapped"],
  ["/shots/1/keyframes/1/id", "M009", "mapped"],
  ["/shots/1/reviewStatus", "M012", "preserved"],
  ["/shots/1/risks", "M005", "mapped"],
  ["/shots/1/scene", "M005", "mapped"],
  ["/shots/1/title", "M005", "mapped"],
  ["/shots/1/workflowStatus", "M012", "preserved"],
  ["/vehicles", "M006", "mapped"],
];
assert.deepStrictEqual(
  clean.report.accounting.entries.map((entry) => [entry.pointer, entry.rule, entry.disposition]),
  PINNED_ACCOUNTING,
  "the clean fixture's accounting table changed; review the diff rather than repinning it",
);
assert.strictEqual(clean.report.accounting.leaves, PINNED_ACCOUNTING.length, "every leaf is claimed exactly once in the clean case");

/* ===========================================================================
   5. SCENARIO B — ambiguity is represented as ambiguity.

   `LOC-HULL-A` must not silently collapse to `LOC-HULL`. Longest-prefix
   matching is what the current build does and it is what discards 28 of 45
   measured tokens; here its answer becomes one candidate of a dispute. */

const ambiguous = preview("codes-ambiguous.json");
assert.strictEqual(ambiguous.ok, true);
assert.strictEqual(ambiguous.validation.ok, true, "an ambiguous migration still has to produce a valid document");

const disputes = statementsOf(ambiguous).filter((statement) => statement.kind === "disputed");
assert.strictEqual(disputes.length, 3, "three ambiguous tokens, three disputes");
for (const dispute of disputes) {
  assert(Array.isArray(dispute.candidates) && dispute.candidates.length >= 2, "a conflict is about competing readings");
  assert(dispute.note.includes("not recoverable"), "the note has to say why a human is needed");
  assert.strictEqual(dispute.actor.kind, "tool");
}

/* The suffix reading and the distinct-record reading are both retained. */
const hullDispute = disputes.find((statement) => statement.target.subject === "shot:L1-01");
assert.deepStrictEqual(hullDispute.candidates.map((entry) => entry.value), [
  { locationId: "LOC-HULL", coverageId: "A" },
  { locationId: "LOC-HULL-A" },
]);
/* And the canonical value asserts only what the document justifies: the
   coverage view is written because that coverage record exists. */
const hullShot = ambiguous.candidate.shots.find((shot) => shot.id === "L1-01");
assert.deepStrictEqual(hullShot.setting, { locationId: "LOC-HULL", coverageId: "A" });
/* Where the suffix names no coverage record, only the location is asserted -
   migration does not invent a coverage view to make the reading tidy. */
const galleyShot = ambiguous.candidate.shots.find((shot) => shot.id === "L1-02");
assert.deepStrictEqual(galleyShot.setting, { locationId: "LOC-GALLEY" });

/* The raw token survives in the document, not only in the report. */
const legacyExtension = ambiguous.candidate.extensions["com.cinebraid.legacy"];
assert.deepStrictEqual(legacyExtension.codes.map((entry) => entry.code).sort(), ["KAI-ANCHOR-01", "LOC-GALLEY-A", "LOC-HULL-A"]);
assert.deepStrictEqual(legacyExtension.unmappedCodes.map((entry) => entry.code), ["STAGE-3"]);
assert(codesOf(ambiguous).includes("migration.code.unresolved"), "a token that resolves to nothing must be reported, not dropped");

/* Ready-for-Edit stays blocked where it should: an unresolved conflict on a
   field a shot depends on folds to Conflict, which is the gate. */
{
  const { deriveTargetBadge } = require("../ofp/ofp-statements");
  const badge = deriveTargetBadge(ambiguous.candidate, ambiguous.candidate.statements, { subject: "shot:L1-01", path: "/setting" });
  assert.strictEqual(badge.badge, "conflict", "an unresolved migration dispute must still read as a conflict");
}

/* Two more inferential cases, each producing a proposal rather than a decision. */
{
  const prose = preview("prose-dependency.json");
  const suggested = statementsOf(prose).filter((statement) => statement.kind === "suggested");
  assert.strictEqual(suggested.length, 1, "one statement for the relations array, not one per relation");
  assert.strictEqual(suggested[0].target.path, "/relations");
  assert(suggested[0].note.includes("bookend"), "the statement must name the reading it made");
  assert(suggested[0].note.includes("L7-03 depends on this plate LOCKED first"), "and quote the prose it read");
  const shot = prose.candidate.shots.find((entry) => entry.id === "L0-01");
  assert(shot.relations.length >= 1, "the relationship becomes structure, so it is queryable and schedulable");
  assert(shot.relations.some((relation) => relation.kind === "bookend-of" && relation.targetShotId === "L7-03"));
  /* The prose itself is retained - the structure is a reading of it, not a
     replacement for it. */
  assert.strictEqual(shot.description, "Wide on the seam. This EXACT framing is mirrored at the end (L7-03).");
  const preserved = prose.candidate.extensions["com.cinebraid.legacy"].preserved;
  assert(preserved.some((entry) => entry.sourcePath === "/shots/0/notes"), "the note prose is preserved verbatim");
  const plain = prose.candidate.shots.find((entry) => entry.id === "L4-01");
  assert.strictEqual(plain.relations, undefined, "an ordinary note must not manufacture a relationship");
}

/* M021's authored structure recovers real data and emits nothing, because
   nobody suggested it and no source cited it. */
{
  const recovered = preview("no-schema-version.json");
  const child = recovered.candidate.shots.find((shot) => shot.id === "L0-02");
  assert.deepStrictEqual(child.relations.map((relation) => relation.kind), ["part-of"]);
  assert.strictEqual(child.relations[0].targetShotId, "L0-01");
  const fallback = recovered.candidate.shots.find((shot) => shot.id === "L0-02-ALT");
  assert.strictEqual(fallback.relations[0].kind, "fallback-for");
  assert.strictEqual(statementsOf(recovered).filter((statement) => statement.rule === "M021").length, 0);
  for (const statement of statementsOf(recovered))
    assert(!statement.id.startsWith("stm-m021"), "recovering authored structure is not a guess and must emit no statement");
}

/* [INFERRED FOR PLANNING] leaves the production value and the evidence moves
   into the statement (P0 §10.6). Leaving it in place would assert the same fact
   twice, and would make deleting the marker stale a suggestion that still
   applies to the surviving text. */
{
  const marked = preview("inferred-marker.json");
  const character = marked.candidate.entities.characters[0];
  assert(!character.description.includes("[INFERRED FOR PLANNING]"), "the marker must not survive in the canonical field");
  assert.strictEqual(character.description, "Canvas coat and a satchel; wardrobe is not described in the script.");
  const shot = marked.candidate.shots[0];
  assert(!shot.description.includes("[INFERRED FOR PLANNING]"));
  const suggestions = statementsOf(marked).filter((statement) => statement.kind === "suggested");
  assert.strictEqual(suggestions.length, 2);
  for (const statement of suggestions) assert(statement.note.includes("[INFERRED FOR PLANNING]"), "the evidence has to be somewhere, and it is here");
  /* The claim binds the CLEANED value, which is the whole point of the
     amendment: editing the prose stales the suggestion, removing the marker
     does not. */
  for (const statement of suggestions) {
    const resolved = resolveTarget(marked.candidate, statement.target);
    assert.strictEqual(statement.claim.hash, computeClaimHash(resolved.targetString, resolved.value));
    assert(!statement.claim.preview.includes("[INFERRED FOR PLANNING]"));
  }
}

/* D1 and D2: two prose fields that differ, and two duration aliases that
   differ. Concatenating or silently picking would each invent a fact. */
{
  const prose = preview("entity-prose.json");
  const dispute = statementsOf(prose).find((statement) => statement.kind === "disputed");
  assert.strictEqual(dispute.target.subject, "character:CHAR-DIVERGENT");
  assert.strictEqual(dispute.candidates.length, 2);
  assert.strictEqual(prose.candidate.entities.characters.find((entry) => entry.id === "CHAR-AGREES").description,
    "Short, round glasses, always carrying the same brown folder.");
  assert.strictEqual(statementsOf(prose).length, 1, "identical text in two spellings is one value, not a conflict");
  assert.strictEqual(prose.candidate.entities.characters.find((entry) => entry.id === "CHAR-EMPTY").description, undefined,
    "an empty string is not a description and must not become one");
}
{
  const durations = preview("duration-aliases.json");
  const byId = Object.fromEntries(durations.candidate.shots.map((shot) => [shot.id, shot.duration]));
  /* F2, measured live in the shipped sample: a declared four-second shot stored
     only in `duration` is rendered as a defaulted five today. */
  assert.deepStrictEqual(byId["DUR-DURATION"], { seconds: 4, basis: "authored" });
  assert.deepStrictEqual(byId["DUR-SEC"], { seconds: 7, basis: "authored" });
  assert.deepStrictEqual(byId["DUR-AGREE"], { seconds: 6, basis: "authored" });
  assert.deepStrictEqual(byId["DUR-DISAGREE"], { seconds: 4, basis: "authored" }, "dur wins because it is what the engine renders today");
  const disputed = statementsOf(durations).filter((statement) => statement.kind === "disputed");
  assert.strictEqual(disputed.length, 1, "only the disagreement is a conflict");
  assert.deepStrictEqual(disputed[0].candidates.map((entry) => entry.value.seconds), [4, 9]);
}

/* ===========================================================================
   6. SCENARIO C — minted identity, and identity that is preserved rather than
   repaired. */

const missing = preview("missing-ids.json");
assert.strictEqual(missing.ok, true);
assert.strictEqual(missing.validation.ok, true);

/* Position may MINT an identity exactly once. It may never BE one. */
const mintedFrames = missing.candidate.shots[0].frames.map((frame) => frame.id);
assert.deepStrictEqual(mintedFrames, ["frame-INT-1->2-0001", "frame-INT-1->2-0002"]);
assert(missing.report.minted.length >= 5, "every mint is recorded in the report");
for (const mint of missing.report.minted) {
  assert(mint.sourcePath !== undefined && mint.type && mint.mintedId, "a mint must say what it minted and from where");
  assert(!/^[0-9a-f]{8}-[0-9a-f]{4}/.test(mint.mintedId), "no random UUIDs; migration must be re-runnable");
}
/* The same legacy input mints the same IDs, and it does not matter when. */
assert.deepStrictEqual(preview("missing-ids.json", { at: "2030-01-01T00:00:00Z" }).candidate.shots[0].frames.map((frame) => frame.id), mintedFrames);

/* A legal-but-non-portable legacy ID round-trips verbatim and is reported. An
   error here is what would eventually tempt a rename, and a rename destroys the
   only link between a shot and its history. */
assert.deepStrictEqual(missing.candidate.shots.map((shot) => shot.id), ["INT-1->2", "INT-2->3"]);
const portability = missing.report.diagnostics.filter((entry) => entry.code === "migration.id.not-portable");
assert(portability.length >= 2);
for (const entry of portability) assert.strictEqual(MIGRATION_DIAGNOSTICS[entry.code].severity, "warning");
assert.strictEqual(missing.report.identity.lost.length, 0, "nothing may be lost, minted or not");
assert(missing.validation.diagnostics.some((entry) => entry.code === "id.not-portable"), "and the validator reports it too");

/* ===========================================================================
   7. SCENARIO D — unknown legacy content has an explicit home. */

const unknown = preview("unknown-fields.json");
assert.strictEqual(unknown.ok, true);
assert.strictEqual(unknown.validation.ok, true);
const preserved = unknown.candidate.extensions["com.cinebraid.legacy"].preserved;
const preservedPaths = preserved.map((entry) => entry.sourcePath);
for (const pointer of ["/meta/someFieldNobodyDocumented/nested/2/deep", "/shots/0/someShotFieldFromTheFuture/0", "/contextDoc", "/iterations"])
  assert(preservedPaths.includes(pointer), `${pointer} must have an explicit home, not merely still exist somewhere`);
for (const entry of preserved) {
  assert(entry.rule && RULE_IDS.includes(entry.rule), "preservation names the rule that decided it");
  assert(entry.note, "and why the value has no OFP representation");
  assert(Object.prototype.hasOwnProperty.call(entry, "value"), "and carries the value itself");
}
assert.strictEqual(preserved.find((entry) => entry.sourcePath === "/shots/0/positioning").value, "Locked, readable composition.");
/* Precise preservation, not a second copy of the project. */
assert(!preservedPaths.includes("/shots/0/id"), "a mapped value must not also be preserved");
assert(!preservedPaths.includes("/meta/title"));

/* ===========================================================================
   8. Statement creation rules. */

for (const name of MIGRATABLE) {
  const result = preview(name);
  for (const statement of statementsOf(result)) {
    assert(MIGRATION_STATEMENT_KINDS.includes(statement.kind), `${name}: migration wrote a ${statement.kind} statement`);
    assert.notStrictEqual(statement.kind, "approved", "approval is a human act and migration may never fabricate one");
    assert.strictEqual(statement.at, AT, "the migration instant is an input, supplied once");
    assert(/^stm-m\d{3}-\d{4}$/.test(statement.id), `${name}: ${statement.id} is not a deterministic migration statement id`);
    assert(statement.actor && statement.actor.kind === "tool" && statement.actor.name.startsWith("migration/"));

    /* The hash is recomputed here from the value as it finally stands. There is
       no field on a rule's draft that could carry one. */
    const resolution = resolveTarget(result.candidate, statement.target);
    assert.strictEqual(resolution.ok, true, `${name}: ${statement.id} targets ${formatTargetString(statement.target)}, which does not resolve`);
    assert.strictEqual(statement.claim.hash, computeClaimHash(resolution.targetString, resolution.value), `${name}: ${statement.id} carries a hash that does not bind its value`);
    assert(/^sha256:[0-9a-f]{64}$/.test(statement.claim.hash));
    if (statement.kind === "disputed") assert(statement.candidates.length >= 1, "a dispute retains values that may exist nowhere else");
  }
  /* Statement targets resolving is a MIGRATION failure, not a document warning. */
  assert(!codesOf(result).includes("migration.statement.unresolvable"), `${name}: a migration-created target did not resolve`);
  assert(!codesOf(result).includes("migration.statement.kind-refused"));
}

/* The refusal is a mechanism, not a convention: ask for an approval and it is
   refused with a diagnostic rather than written. */
{
  const { migrateLegacyProject: run } = Migrate;
  const outcome = run(loadFixture("clean.json"), { at: AT, rules: ["M001"] });
  assert(outcome.candidate, "a rule subset still produces a document");
  assert.strictEqual(outcome.report.rules.find((rule) => rule.id === "M005").status, "deselected", "the plan is inspectable and selectable");
}

/* ===========================================================================
   9. Determinism. Same input, same everything. */

for (const name of MIGRATABLE) {
  const first = preview(name);
  const second = preview(name);
  assert.strictEqual(first.serialized, second.serialized, `${name}: migration is not byte-deterministic`);
  assert.strictEqual(JSON.stringify(first.report.minted), JSON.stringify(second.report.minted), `${name}: minted IDs drifted`);
  assert.strictEqual(JSON.stringify(first.report.accounting.entries), JSON.stringify(second.report.accounting.entries), `${name}: the accounting table drifted`);
  assert.strictEqual(JSON.stringify(first.report.diagnostics), JSON.stringify(second.report.diagnostics), `${name}: diagnostics drifted`);
  assert.strictEqual(JSON.stringify(first.report.statements), JSON.stringify(second.report.statements), `${name}: statements drifted`);
  /* And the output is already in canonical file form, so writing it is a copy
     rather than a second serialization with its own opinions. */
  assert.strictEqual(serializeCanonical(first.candidate), first.serialized);
  assert.strictEqual(first.serialized.includes("\r"), false, "canonical file form is LF");
  assert(first.serialized.endsWith("}\n"), "exactly one trailing newline");
}

/* Only the supplied instant changes the output, and only where an instant
   legitimately appears. */
{
  const pinned = preview("codes-ambiguous.json");
  const later = preview("codes-ambiguous.json", { at: "2027-03-04T05:06:07Z" });
  assert.notStrictEqual(pinned.serialized, later.serialized, "the instant is a real input");
  assert.strictEqual(pinned.serialized.split(AT).length - 1, statementsOf(pinned).length, "and it appears exactly once per statement");
  assert.strictEqual(pinned.serialized.replace(new RegExp(AT, "g"), "2027-03-04T05:06:07Z"), later.serialized, "nothing else moved");
}

/* ===========================================================================
   10. Counts and identity are conserved, or the change is explained. */

for (const name of MIGRATABLE) {
  const result = preview(name);
  assert.strictEqual(result.report.counts.reconciled, true, `${name}: a count changed with no rule to explain it`);
  assert.deepStrictEqual(result.report.identity.lost, [], `${name}: a legacy identifier disappeared`);
  for (const row of result.report.counts.rows) assert(row.explained, `${name}: ${row.category} ${row.before} -> ${row.after}`);
  assert(!codesOf(result).includes("migration.count.unexplained"));
  assert(!codesOf(result).includes("migration.identity.lost"));
}
/* The one declared structural difference, stated rather than hidden. */
{
  const sample = preview("clean.json");
  const adjustment = sample.report.counts.adjustments.find((entry) => entry.category === "coverage");
  assert.strictEqual(adjustment, undefined, "the clean fixture has no character coverage slots to adjust for");
  const withSlots = previewLegacyMigration({
    meta: { title: "t", schemaVersion: "6.7" },
    shots: [], scenes: [], locations: [], props: [], vehicles: [],
    characters: [{ id: "C", name: "C", coverageSlots: [{ id: "front", label: "Front" }] }],
  }, { at: AT });
  const declared = withSlots.report.counts.adjustments.find((entry) => entry.category === "coverage");
  assert(declared && declared.rule === "M008" && declared.delta === -1, "the difference must be declared by the rule that causes it");
  assert.strictEqual(withSlots.report.counts.reconciled, true);
}

/* ===========================================================================
   11. Security: nothing machine-specific or secret reaches the document. */

const traps = preview("secret-traps.json");
assert.strictEqual(traps.ok, true, "a project full of traps still migrates - it just migrates without them");
assert.strictEqual(traps.validation.ok, true);
const serializedTraps = traps.serialized;
for (const value of ["hunter2", "letmein", "sk-should-never-be-serialised", "0123456789abcdef0123456789abcdef", "C:\\Users", "/Users/somebody", "localhost:11434",
  "tok-should-never-be-serialised", "at-should-never-be-serialised", "rt-should-never-be-serialised"])
  assert(!serializedTraps.includes(value), `${value} reached the migrated document`);
assert(!serializedTraps.includes("fal-0000"), "a provider key reached the migrated document");
const quarantined = traps.report.diagnostics.filter((entry) => entry.code.startsWith("migration.secret") || entry.code.startsWith("migration.path"));
assert(quarantined.length >= 8, "and every refusal is reported rather than being silent");
for (const entry of quarantined) assert.strictEqual(entry.rule, "M080");
assert.deepStrictEqual(scanMigrationOutput(traps.candidate), [], "the independent output scan agrees");
/* Clean values in the same records are untouched - the quarantine is precise. */
assert.strictEqual(traps.candidate.entities.characters[0].description, "A clean description.");
assert.strictEqual(traps.candidate.shots[0].description, "The description itself is clean.");

/* The scanner is not vacuous: it catches a planted leak the quarantine never
   saw, which is why both mechanisms exist. */
{
  const planted = JSON.parse(JSON.stringify(traps.candidate));
  planted.meta.title = "Plate at C:\\Users\\somebody\\Desktop\\plate.png";
  const found = scanMigrationOutput(planted);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].code, "migration.output.absolute-path");
  const plantedKey = JSON.parse(JSON.stringify(traps.candidate));
  plantedKey.extensions["com.cinebraid.legacy"].apiKey = "x";
  assert(scanMigrationOutput(plantedKey).some((entry) => entry.code === "migration.output.secret-leak"));
}
for (const name of MIGRATABLE) assert.deepStrictEqual(scanMigrationOutput(preview(name).candidate), [], `${name}: the output scan found something`);

/* ---------------------------------------------------------------------------
   11a. M080 decides by KEY SHAPE, and it is the QUALIFIED word that names a
   credential. P3 recorded the opposite and the cost of it: `token` as a bare
   secret word quarantined `#image1` - a prompt reference placeholder, which is
   film semantics rather than a secret - at
   /shots/0/promptBuilder/spec/references/0/token in overfit-14-hub-v4-3.

   The asymmetry below IS the fix, and both halves are asserted in one document
   so the two sides cannot drift apart: the qualified names still go, the bare
   one now stays. Note what is never consulted - the value. */
{
  for (const key of ["apiToken", "authToken", "accessToken", "refreshToken", "bearerToken", "idToken", "oauthToken",
    "sessionToken", "access_token", "refresh_token", "API-TOKEN", "apiKey", "falApiKey", "authSecret",
    "editorPass", "viewerPass", "clientSecret", "privateKey", "password", "passcode"])
    assert.strictEqual(keyLooksSecret(key), true, `${key} names a credential and must still be refused`);
  for (const key of ["token", "tokenSource", "keyFrames", "description", "promptTokens"])
    assert.strictEqual(keyLooksSecret(key), false, `${key} is project data; a key-name rule must not read it as a credential`);

  /* The legitimate value survives, and it survives WITH its key. A preserved
     value whose path was dropped would be the same loss wearing a different
     disposition, so the source path is asserted rather than the value alone. */
  const preserved = traps.candidate.extensions["com.cinebraid.legacy"].preserved;
  for (const [pointer, value] of [
    ["/shots/0/promptBuilder/spec/references/0/token", "#image1"],
    ["/shots/0/promptBuilder/providerPayload/references/0/token", "@image1"],
  ]) {
    const entry = preserved.find((item) => item.sourcePath === pointer);
    assert(entry, `${pointer}: the prompt reference placeholder was dropped as a credential`);
    assert.strictEqual(entry.value, value, `${pointer}: preserved, but not verbatim`);
    assert.strictEqual(entry.rule, "M070", `${pointer}: preserved by the wrong rule`);
    assert(serializedTraps.includes(value), `${value} must reach the migrated document`);
  }
  for (const entry of quarantined)
    assert(!entry.where.endsWith("/references/0/token"), `${entry.where}: a prompt placeholder was quarantined as a credential`);

  /* A genuinely credential-named token is still refused, by the same rule. */
  for (const pointer of ["/meta/apiToken", "/meta/accessToken", "/meta/refreshToken"])
    assert(quarantined.some((entry) => entry.where === pointer && entry.code === "migration.secret.quarantined" && entry.rule === "M080"),
      `${pointer}: a credential-named token was carried into the document`);

  /* The neighbours of the suspicious field are untouched. A quarantine that took
     the surrounding record with it would satisfy every assertion above. */
  for (const value of ["Hold the established framing.", "The provider note is clean.", "first-frame", "TRAP-01-A.png"])
    assert(serializedTraps.includes(value), `${value}: normal content beside the quarantine was lost`);

  /* Determinism and source-safety, stated for this fixture rather than inferred
     from the corpus-wide loops, because the warning SET is what changed here. */
  const again = preview("secret-traps.json");
  assert.strictEqual(again.serialized, serializedTraps, "the M080 fixture is not byte-deterministic");
  assert.deepStrictEqual(again.report.diagnostics, traps.report.diagnostics, "the M080 warning set is not deterministic");
  const untouched = loadFixture("secret-traps.json");
  const before = JSON.stringify(untouched);
  previewLegacyMigration(untouched, { at: AT });
  assert.strictEqual(JSON.stringify(untouched), before, "migrating the M080 fixture mutated the source document");
}

/* ===========================================================================
   12. The migrated document is validated, not merely serialized. */

for (const name of MIGRATABLE) {
  const result = preview(name);
  assert.strictEqual(result.validation.ok, true, `${name}: the candidate does not pass the P1 validator`);
  assert.strictEqual(result.validation.documentClass, "supported-draft");
  assert.strictEqual(result.validation.counts.error, 0);
  assert.strictEqual(result.ok, true, `${name}: reported ok=${result.ok}`);
}
/* And `ok` is not a synonym for "it parsed": a candidate that fails validation
   drags the whole result down. */
{
  const outcome = migrateLegacyProject(loadFixture("clean.json"), { at: AT });
  outcome.candidate.shots[0].sceneId = "SC-DOES-NOT-EXIST";
  const validation = Migrate.validateMigrationResult(outcome.candidate);
  assert.strictEqual(validation.ok, false);
  assert(validation.diagnostics.some((entry) => entry.code === "ref.unresolved"));
}

/* ===========================================================================
   13. INV-R1 over migration: preview writes nothing, anywhere. */

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-p2-preview-"));
  try {
    fs.writeFileSync(path.join(root, "project.json"), readFixture("clean.json"));
    const before = snapshotTree(root);
    const { attempts } = withNoWritesUnder(root, () => {
      const source = parseJsonStrict(fs.readFileSync(path.join(root, "project.json"), "utf8"));
      const result = previewLegacyMigration(source, { at: AT });
      assert.strictEqual(result.ok, true);
      return result;
    });
    assert.deepStrictEqual(attempts, [], "previewing a migration must attempt no writes under the project root");
    assert.deepStrictEqual(diffSnapshots(before, snapshotTree(root)), [], "and change nothing");
    assert(!fs.existsSync(path.join(root, CANONICAL_FILENAME)), "no OFP file may appear beside the source");
    assert(!fs.existsSync(path.join(root, "project.json.bak")), "no .bak may appear beside the source");
    /* The legacy lineage marker is exactly as it was. */
    const after = parseJsonStrict(fs.readFileSync(path.join(root, "project.json"), "utf8"));
    assert.strictEqual(after.meta.schemaVersion, "6.7");
    assert.strictEqual(after.format, undefined, "a real project is never dragged into the draft lane");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/* The source object itself is not mutated either - rules are handed the real
   document and one that wrote to it would otherwise be found by whoever noticed
   their project had changed. */
for (const name of MIGRATABLE) {
  const source = loadFixture(name);
  const before = JSON.stringify(source);
  previewLegacyMigration(source, { at: AT });
  assert.strictEqual(JSON.stringify(source), before, `${name}: migration mutated the source document`);
}

/* ===========================================================================
   14. SCENARIO E — an explicit migrate-to-copy. */

{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-p2-copy-"));
  const source = path.join(base, "source-project");
  const destination = path.join(base, "migrated-copy");
  try {
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "project.json"), readFixture("clean.json"));
    fs.mkdirSync(path.join(source, "anchors"));
    fs.writeFileSync(path.join(source, "anchors", "CHAR-CLERK-FRONT.png"), "not really a png");
    const before = snapshotTree(source);

    const outcome = writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: destination, at: AT });
    assert.strictEqual(outcome.written, true);
    assert.strictEqual(outcome.file, path.join(destination, CANONICAL_FILENAME));

    /* The source tree is byte-identical, mtimes included. */
    assert.deepStrictEqual(diffSnapshots(before, snapshotTree(source)), [], "the source project must be untouched");
    assert(!fs.existsSync(path.join(source, CANONICAL_FILENAME)));
    assert.strictEqual(fs.readdirSync(source).sort().join(), "anchors,project.json");

    /* The destination carries the canonical document, and nothing else. */
    assert.deepStrictEqual(fs.readdirSync(destination), [CANONICAL_FILENAME], "no temporary file survives an atomic write");
    const written = fs.readFileSync(outcome.file, "utf8");
    assert.strictEqual(written, preview("clean.json").serialized, "the copy is the canonical serialization of the candidate");
    assert.strictEqual(written.includes("\r"), false);
    const reparsed = parseJsonStrict(written);
    assert.strictEqual(reparsed.format.version, OFP_CONTRACT_VERSION);
    assert.strictEqual(Migrate.validateMigrationResult(reparsed).ok, true, "and it validates after a round trip through the disk");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/* ===========================================================================
   15. SCENARIO F — an unsafe destination is refused, with zero writes. */

{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-p2-unsafe-"));
  const source = path.join(base, "source-project");
  try {
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "project.json"), readFixture("clean.json"));
    const before = snapshotTree(source);

    const refusals = [
      [source, "same-path"],
      [path.join(source, "migrated"), "inside-source"],
      [base, "contains-source"],
    ];
    for (const [destination, code] of refusals) {
      assert.throws(
        () => writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: destination, at: AT }),
        (error) => error instanceof MigrationDestinationError && error.code === code,
        `${destination} must be refused as ${code}`,
      );
      assert.deepStrictEqual(diffSnapshots(before, snapshotTree(source)), [], `${code}: the refusal must write nothing`);
    }

    /* An existing document is never overwritten, and a directory holding
       unrelated content is refused unless the caller says otherwise. */
    const occupied = path.join(base, "occupied");
    fs.mkdirSync(occupied);
    fs.writeFileSync(path.join(occupied, CANONICAL_FILENAME), "existing");
    assert.throws(() => writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: occupied, at: AT }),
      (error) => error.code === "exists");
    assert.strictEqual(fs.readFileSync(path.join(occupied, CANONICAL_FILENAME), "utf8"), "existing", "and the existing file is untouched");

    const busy = path.join(base, "busy");
    fs.mkdirSync(busy);
    fs.writeFileSync(path.join(busy, "notes.txt"), "unrelated");
    assert.throws(() => writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: busy, at: AT }),
      (error) => error.code === "not-empty");
    const deliberate = writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: busy, at: AT, allowExistingDirectory: true });
    assert.strictEqual(deliberate.written, true, "and it succeeds when the caller says so in as many words");

    assert.throws(() => writeMigratedCopy({ sourceProjectRoot: source, at: AT }), (error) => error.code === "missing-destination",
      "there is no default destination, and in particular none beside the source");
    assert.deepStrictEqual(diffSnapshots(before, snapshotTree(source)), [], "the source is still untouched after all of it");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/* checkDestination answers without a write, so a caller can ask first. */
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-p2-check-"));
  try {
    assert.throws(() => checkDestination(base, base), (error) => error.code === "same-path");
    assert.deepStrictEqual(Object.keys(checkDestination(path.join(base, "a"), path.join(base, "b"))).sort(), ["destination", "ok", "source", "target"]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/* ===========================================================================
   16. The report is useful to something other than a browser. */

{
  const report = clean.report;
  assert.strictEqual(JSON.parse(JSON.stringify(report)).source.fingerprint, report.source.fingerprint, "the report must cross a process boundary unchanged");
  assert(/^sha256:[0-9a-f]{64}$/.test(report.source.fingerprint));
  assert.strictEqual(report.target.formatId, OFP_FORMAT_ID);
  assert.strictEqual(report.rules.length, MIGRATION_RULES.length, "every rule reports its status, including the ones that did nothing");
  for (const rule of report.rules) {
    assert(["applied", "no-op", "deselected", "not-applicable"].includes(rule.status), `${rule.id} reported ${rule.status}`);
    assert(RULE_IDS.includes(rule.id));
  }
  for (const category of Migrate.COUNT_CATEGORIES) assert(typeof report.counts.source[category] === "number", `${category} is not counted`);
  assert.strictEqual(report.counts.source.shots, 2);
  assert.strictEqual(report.counts.target.shots, 2);
  assert.strictEqual(report.counts.source.frames, 3);
  assert.strictEqual(report.counts.target.frames, 3);
  assert.strictEqual(typeof report.summary.deterministicMappings, "number");
  assert.strictEqual(report.summary.errors, 0);
  /* No CineBraid-browser coupling anywhere in the module tree. */
  const migrationSource = ["ofp-migrate.js", "ofp-migrate-rules.js", "ofp-migrate-detect.js", "ofp-migrate-accounting.js", "ofp-migrate-report.js", "ofp-migrate-scan.js", "ofp-migrate-write.js", "ofp-migrate-diagnostics.js"]
    .filter((name) => fs.existsSync(path.join(__dirname, "..", "ofp", name)))
    .map((name) => fs.readFileSync(path.join(__dirname, "..", "ofp", name), "utf8")).join("\n");
  for (const token of ["document.querySelector", "window.", "require(\"express\")", "openai", "anthropic", "ollama.chat", "fal.run"])
    assert(!migrationSource.includes(token), `the migration framework must not reach for ${token}`);
}

/* The plan is buildable and inspectable without executing anything. */
{
  const detection = Detect.detectLegacyProject(loadFixture("clean.json"));
  const plan = buildMigrationPlan(detection, loadFixture("clean.json"));
  assert.strictEqual(plan.targetFormatVersion, OFP_CONTRACT_VERSION);
  assert.strictEqual(plan.steps.length, MIGRATION_RULES.length);
  assert(plan.steps.every((step) => step.summary), "a plan a human can read");
}

/* ===========================================================================
   17. The template checklist this module compares against is still the one the
   application writes. Two copies of a constant is how a rule quietly stops
   firing. */

{
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  for (const line of TEMPLATE_QC_CHECKLIST)
    assert(serverSource.includes(line), `the BLANK() template no longer contains ${JSON.stringify(line.slice(0, 40))}; M053 would stop recognising a default`);
  const templated = preview("template-default.json");
  const templatedPreserved = templated.candidate.extensions["com.cinebraid.legacy"].preserved || [];
  assert.strictEqual(templatedPreserved.some((entry) => entry.sourcePath.startsWith("/qcChecklist")), false,
    "the defaulted five are dropped, not shipped as production truth");
  assert(templated.report.accounting.entries.some((entry) => entry.pointer.startsWith("/qcChecklist") && entry.rule === "M053" && entry.disposition === "dropped"));
}

console.log(`OFP P2 migration framework passed: ${MIGRATION_RULES.length} rules, ${fixtureNames.length} synthetic legacy fixtures, ${clean.report.accounting.leaves} accounted source values in the clean case, 0 unaccounted across every fixture.`);

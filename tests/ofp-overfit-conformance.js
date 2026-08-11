/* Open Film Project P3 - the sanitized Overfit corpus, migrated for real.
 *
 * P2 proved the migration framework against eighteen synthetic fixtures built to
 * imitate shapes the audit measured. This suite runs it against eighteen
 * sanitized derivatives of the actual historical project, which is a different
 * question: synthetic fixtures contain the hazards somebody remembered.
 *
 * The properties:
 *
 *   - the corpus is the corpus - eighteen distinct documents, and the fixtures
 *     on disk are the ones the manifest says they are;
 *   - sanitizing did not remove the hazards the corpus exists to carry;
 *   - nothing private is committed, checked over keys and values both;
 *   - every generation migrates with zero unaccounted source values and zero
 *     approvals, which is release gate G4;
 *   - the result is pinned, so a change to migration semantics fails here and
 *     has to be re-pinned deliberately rather than absorbed;
 *   - historical loss and migration loss are different things and the corpus can
 *     tell them apart.
 *
 * This suite reads the committed fixtures and nothing else. It does not know
 * where the archive is and must never learn: after P3 the repository is
 * self-contained, and a check that reached for somebody's D: drive would be a
 * check that passes on exactly one machine.
 *
 * Negative controls live in tests/ofp-overfit-negative-controls.js.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { parseJsonStrict } = require("../ofp/ofp-json");
const { deriveTargetBadge } = require("../ofp/ofp-statements");
const { formatTargetString } = require("../ofp/ofp-target");
const { detectLegacyProject } = require("../ofp/ofp-migrate-detect");
const { OFP_CONTRACT_VERSION } = require("../ofp/ofp-format");
const Sanitizer = require("../scripts/overfit-sanitizer");
const Model = require("../scripts/overfit-fixture-model");

const {
  FIXTURE_ROOT, GENERATIONS, FULL_GOLDEN_IDS, MIGRATION_AT, PRIVACY_PATTERNS,
  fixtureFile, goldenFile, readFixture, hazardCensus, goldenFor, migrateFixtureDocument,
} = Model;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readText = (file) => fs.readFileSync(file, "utf8");
/* Fixtures are pinned to LF in .gitattributes. Normalizing here as well means a
   clone that lost the pin fails on the pin rather than on eighteen hashes. */
const readBytes = (file) => Buffer.from(readText(file).replace(/\r\n/g, "\n"), "utf8");
const stable = (value) => JSON.stringify(value, null, 2);

/* Taken before anything runs, so the closing check can prove this suite did not
   rewrite the corpus it is verifying. */
const corpusDigestAtStart = fs.readdirSync(path.join(FIXTURE_ROOT, "generations")).sort()
  .map((name) => sha256(readBytes(path.join(FIXTURE_ROOT, "generations", name)))).join("");

const manifest = parseJsonStrict(readText(path.join(FIXTURE_ROOT, "manifest.json")));
const pinned = parseJsonStrict(readText(path.join(FIXTURE_ROOT, "goldens", "summary.json")));
const byId = new Map(pinned.goldens.map((entry) => [entry.id, entry]));

/* ===========================================================================
   1. The corpus is eighteen distinct documents, and the manifest is about the
   files that are actually here. */

assert.strictEqual(GENERATIONS.length, 18, "the audit measured eighteen successive snapshots");
assert.strictEqual(manifest.generations.length, 18);
assert.strictEqual(pinned.goldens.length, 18);
assert.strictEqual(manifest.contractVersion, OFP_CONTRACT_VERSION, "the manifest was built against this contract");
assert.strictEqual(pinned.contractVersion, OFP_CONTRACT_VERSION);
assert.strictEqual(manifest.migrationAt, MIGRATION_AT);
assert.strictEqual(manifest.sanitizerVersion, Sanitizer.SANITIZER_VERSION,
  "the sanitizer changed without the fixtures being rebuilt; run fixtures:overfit:update");

{
  const sourceDigests = new Set(manifest.generations.map((entry) => entry.sourceSha256));
  assert.strictEqual(sourceDigests.size, 18, "eighteen distinct source documents, by digest and not by directory name");
  const fixtureDigests = new Set(manifest.generations.map((entry) => entry.fixtureSha256));
  assert.strictEqual(fixtureDigests.size, 18, "and eighteen distinct fixtures");
}

/* The manifest may not carry the machine the build ran on. */
for (const entry of manifest.generations) {
  assert(!/^[A-Za-z]:/.test(entry.sourceRelative) && !entry.sourceRelative.startsWith("/"),
    `${entry.id}: the manifest records an absolute source path`);
  for (const relative of entry.alsoObservedAt || [])
    assert(!/^[A-Za-z]:/.test(relative), `${entry.id}: absolute path in alsoObservedAt`);
}

/* ===========================================================================
   2. Fixture bytes are the bytes the manifest pinned. This is the first half of
   the drift gate: an edited fixture fails before anything is migrated. */

for (const generation of GENERATIONS) {
  const entry = manifest.generations.find((row) => row.id === generation.id);
  assert(entry, `${generation.id} is missing from the manifest`);
  assert(fs.existsSync(fixtureFile(generation.id)), `${generation.id} has no committed fixture`);
  const bytes = readBytes(fixtureFile(generation.id));
  assert.strictEqual(sha256(bytes), entry.fixtureSha256,
    `${generation.id}: the committed fixture is not the one the manifest describes. Hand-editing a fixture is not how this changes; run fixtures:overfit:update.`);
  assert.strictEqual(bytes.length, entry.fixtureBytes);
  assert.strictEqual(entry.sourceRelative, generation.sourceRelative, `${generation.id}: provenance moved`);
}

/* ===========================================================================
   3. Sanitizing did not delete the hazards. Measured against the fixtures on
   disk rather than trusted from the build, because the build is the thing that
   might be wrong. */

const census = new Map(GENERATIONS.map((generation) => [generation.id, hazardCensus(readFixture(generation.id))]));

for (const generation of GENERATIONS) {
  const entry = manifest.generations.find((row) => row.id === generation.id);
  const measured = census.get(generation.id);
  assert.strictEqual(stable(measured.counts), stable(entry.counts), `${generation.id}: counts disagree with the manifest`);
  assert.strictEqual(stable(measured.hazards), stable(entry.hazards), `${generation.id}: the hazard census disagrees with the manifest`);
  assert.strictEqual(measured.hazards.durationAliases.dur, measured.counts.shots,
    `${generation.id}: every shot in this archive carries the dur alias; losing it would stop exercising M010`);
}

/* The specific hazards the audit named, at the generations that actually have
   them. Numbers are asserted rather than "> 0" so that a sanitizer that halved
   them still fails. */
{
  const latest = census.get("overfit-18-cinebraid-581").hazards;
  assert(latest.codeTokens["LOC-HULL-A"], "the ambiguous suffixed code must survive sanitization");
  assert(latest.codeTokens["STAGE-3"], "the code that resolves to nothing must survive sanitization");
  assert.deepStrictEqual(latest.nonPortableIds, ["INT-1->2", "INT-2->3", "INT-3->4", "INT-4->5", "INT-5->6"],
    "the non-portable identifiers must survive verbatim, not be tidied into id-portable");
  assert.strictEqual(latest.shotsWithAtomic, 1, "the surviving authored atomic flag");
  assert(latest.identifiers.includes("LOC-HULL"), "the base entity the ambiguous token could collapse onto still exists");

  const relations = census.get("overfit-04-anchorhub-22").hazards;
  assert.strictEqual(relations.shotsWithParentShot, 31, "anchor-hub-22 is the generation that carries the authored relations");
  assert.strictEqual(relations.shotsWithFallbackFor, 1);
  assert.strictEqual(relations.shotsWithAtomic, 2);

  /* Measured, not assumed: the marker the audit expected is in none of the
     eighteen. M040 is exercised by the synthetic P2 fixture and by this suite's
     negative control, and the corpus is honest about not reaching it. */
  for (const generation of GENERATIONS)
    assert.strictEqual(census.get(generation.id).hazards.inferredMarkers, 0,
      `${generation.id}: no archived generation contains the inferred-for-planning marker; if one now does, the corpus changed`);
}

/* The equality relationships M011 reads survive: at least one generation has two
   description-cluster fields that disagree, and sanitization kept them apart. */
{
  const document = readFixture("overfit-18-cinebraid-581");
  const distinct = new Set();
  for (const collection of ["characters", "locations", "props"])
    for (const record of document[collection] || [])
      for (const field of ["notes", "creationDescription", "description"])
        if (typeof record[field] === "string" && record[field]) distinct.add(record[field]);
  assert(distinct.size >= 2, "the description cluster must still hold values that differ from one another");
}

/* ===========================================================================
   4. Nothing private is committed. Keys and values both, over every file in the
   fixture tree - including the manifest and the goldens. */

{
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(FIXTURE_ROOT);
  assert(files.length >= 22, "the fixture tree is smaller than it should be");

  for (const file of files) {
    if (!/\.(json|md)$/i.test(file)) continue;
    const text = readText(file);
    for (const { name, pattern } of PRIVACY_PATTERNS) {
      const match = text.match(pattern);
      assert(!match, `${path.basename(file)} contains ${name}: ${JSON.stringify(String(match && match[0]).slice(0, 60))}`);
    }
    assert(!/Overfit\b.*\\|\\Projects\\/i.test(text), `${path.basename(file)} appears to carry a host archive path`);
  }
}

/* This suite is only self-contained if it never learns where the archive is.
   Asserted against the source of the two modules that could know. */
for (const module of ["overfit-fixture-model.js", "overfit-sanitizer.js"]) {
  const source = readText(path.join(__dirname, "..", "scripts", module));
  assert(!/(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]{2}?[A-Za-z0-9]/m.test(source),
    `scripts/${module} names an absolute path; the corpus must be readable without the archive`);
}

/* ===========================================================================
   5. Detection. Every generation is recognised as a migratable CineBraid
   project, and none of them declares a schema version, which is the whole
   reason detection has to sniff. */

for (const generation of GENERATIONS) {
  const detection = detectLegacyProject(readFixture(generation.id));
  const golden = byId.get(generation.id);
  assert.strictEqual(detection.family, "cinebraid-legacy", `${generation.id}: not recognised as a CineBraid project`);
  assert.strictEqual(detection.migratable, true, `${generation.id}: recognised but refused`);
  assert.strictEqual(detection.schemaVersion, null, `${generation.id}: no archived generation declares a schemaVersion`);
  assert.strictEqual(detection.confidence, "sniffed", `${generation.id}: with no declared marker, confidence must say so`);
  assert.strictEqual(detection.metaVersionClass, "film-draft",
    `${generation.id}: meta.version is the film's own draft number throughout the archive and must not be read as an application version`);
  assert.strictEqual(detection.hubVersion, golden.source.hubVersion);
  assert.notStrictEqual(detection.hubVersion, detection.metaVersion,
    `${generation.id}: the hub version and the film draft must stay separate facts`);
}

/* ===========================================================================
   6. The pinned goldens. This is the drift gate: recompute every generation and
   require it to equal what was pinned, field for field. */

const results = new Map();
for (const generation of GENERATIONS) {
  const document = readFixture(generation.id);
  const golden = goldenFor(generation.id, document);
  const expected = byId.get(generation.id);
  assert(expected, `${generation.id} has no pinned golden`);
  assert.strictEqual(stable(golden), stable(expected),
    `${generation.id}: the migration result no longer matches the pinned golden.\n` +
    `  If this change is intended, re-pin with: npm run fixtures:overfit:update -- --goldens-only\n` +
    `  and put the diff in the pull request. Goldens are never regenerated by a check.`);
  results.set(generation.id, migrateFixtureDocument(document));
}

/* Full canonical output for the three generations a reviewer would open. */
for (const id of FULL_GOLDEN_IDS) {
  const file = goldenFile(id);
  assert(fs.existsSync(file), `${id}: the full golden is missing`);
  const { serialized } = results.get(id);
  assert.strictEqual(readBytes(file).toString("utf8"), serialized,
    `${id}: the full golden document drifted from what migration now produces`);
  assert.strictEqual(sha256(readBytes(file)), byId.get(id).candidateSha256,
    `${id}: the full golden and the pinned digest disagree with each other`);
}

/* ===========================================================================
   7. Release gate G4 - zero silent drops, with a complete account. */

const RULE_IDS_SEEN = new Set();
for (const generation of GENERATIONS) {
  const { result } = results.get(generation.id);
  const { accounting, summary } = result.report;

  assert.strictEqual(accounting.unaccounted.length, 0,
    `${generation.id}: ${accounting.unaccounted.length} source value(s) nobody claimed`);
  assert.strictEqual(summary.unmappedValues, 0, `${generation.id}: a value reached the end with no disposition`);

  const disposed = Object.values(accounting.byDisposition).reduce((total, count) => total + count, 0);
  assert(disposed >= accounting.leaves,
    `${generation.id}: ${accounting.leaves} leaves but only ${disposed} dispositions`);

  /* Every entry names a rule that exists, and every drop is a decision somebody
     made rather than an omission. */
  for (const entry of accounting.entries) {
    assert(/^M\d{3}$/.test(entry.rule), `${generation.id}: ${entry.pointer} is disposed by ${entry.rule}, which is not a rule ID`);
    assert(entry.disposition, `${generation.id}: ${entry.pointer} has no disposition`);
    if (entry.disposition === "dropped") assert(entry.note, `${generation.id}: ${entry.pointer} was dropped with no reason given`);
    RULE_IDS_SEEN.add(entry.rule);
  }

  /* Migration may not approve. Approval is a human act and no rule may perform
     one on a document nobody has looked at. */
  for (const statement of result.candidate.statements || [])
    assert(["suggested", "disputed", "cited"].includes(statement.kind),
      `${generation.id}: migration emitted a ${statement.kind} statement`);

  assert.strictEqual(result.report.identity.lost.length, 0, `${generation.id}: a source identity disappeared`);
}

/* The rule IDs the Overfit corpus actually reaches, pinned so that a rule
   silently ceasing to fire against real data is visible. */
{
  const expected = new Set();
  for (const golden of pinned.goldens) for (const rule of golden.rulesApplied) expected.add(rule);
  const applied = [...expected].sort();
  assert(applied.includes("M021"), "the corpus must reach the authored-relation rule");
  assert(applied.includes("M020"), "the corpus must reach the shot dependency codes rule");
  assert(applied.includes("M022"), "the corpus must reach the prose dependency rule");
  assert(!applied.includes("M040"), "no archived generation carries the inferred marker; if M040 now fires, the corpus changed");
  /* The useful direction is the other one. A rule may legitimately apply while
     claiming no source leaf - M001 writes the format shell, M060 mints
     identifiers and records them in `minted[]` - but a rule that disposed of
     something while the report says it did not run would be the report lying. */
  for (const rule of RULE_IDS_SEEN)
    assert(expected.has(rule), `${rule} disposed of source values but is not reported as applied by any generation`);
}

/* ===========================================================================
   8. Determinism. The same fixture migrated twice is the same bytes, the same
   identifiers and the same report. */

for (const generation of GENERATIONS) {
  const first = migrateFixtureDocument(readFixture(generation.id));
  const second = migrateFixtureDocument(readFixture(generation.id));
  assert.strictEqual(first.serialized, second.serialized, `${generation.id}: migration is not deterministic`);
  assert.strictEqual(stable(first.report), stable(second.report), `${generation.id}: the report is not deterministic`);
  assert.strictEqual(stable(goldenFor(generation.id, readFixture(generation.id))), stable(byId.get(generation.id)));
}

/* ===========================================================================
   9. Scenario A - the earliest generation. The simplest real document in the
   archive still exercises the machinery end to end. */

{
  const { result } = results.get("overfit-01-anchorhub-v1");
  assert.strictEqual(result.ok, true, "the earliest generation must migrate to a valid candidate");
  assert.strictEqual(result.validation.ok, true);
  assert.strictEqual(result.report.accounting.unaccounted.length, 0);
  assert.strictEqual(result.report.source.generation, "pre-6.6");
  assert.strictEqual(result.report.counts.rows.find((row) => row.category === "shots").after, 11);
  /* Nothing is minted here, and that is the correct answer rather than a gap:
     the earliest generation has no nested records, so every identity in the
     result came from the source. Minting is checked where it happens. */
  assert.strictEqual(result.report.minted.length, 0);
  assert.strictEqual(result.report.identity.preserved, result.report.identity.source,
    "every identity the source had must survive verbatim");
}

/* Minting, at the generations that need it. Array position may mint an identity
   once and may never be one, so every mint has to name where it came from. */
for (const generation of GENERATIONS) {
  const { result } = results.get(generation.id);
  assert.strictEqual(result.report.identity.preserved, result.report.identity.source,
    `${generation.id}: a source identity was not preserved verbatim`);
  for (const mint of result.report.minted) {
    /* `parentSubject` is empty for a top-level record: M030's assets are not
       nested under anything, so there is no parent to name. */
    assert(mint.mintedId && mint.type, `${generation.id}: a mint with no identity or type`);
    assert(/^M\d{3}$/.test(mint.rule), `${generation.id}: ${mint.mintedId} was minted by ${mint.rule}, which is not a rule ID`);
    /* P2 §7 says every mint records its source path. M022 used to be the single
       exception - a relation read out of prose was minted with
       `sourcePath: null`, even though the accounting claim for the same relation
       already named the sentence it came from - and this assertion was scoped to
       that one rule so a second could not join it quietly. The rule now passes
       the pointer it always had, so the exception is gone and the property reads
       as the flat rule P2 §7 states.
       Absence, not null, is how "never known" would be spelled if it ever
       occurred: a present-but-null field would satisfy a `!== undefined` test
       while carrying no provenance at all. */
    assert(typeof mint.sourcePath === "string" && mint.sourcePath.trim() !== "",
      `${generation.id}: ${mint.rule} minted ${mint.mintedId} with no source path (${JSON.stringify(mint.sourcePath)})`);
    assert(mint.sourcePath.startsWith("/"),
      `${generation.id}: ${mint.rule} minted ${mint.mintedId} from ${JSON.stringify(mint.sourcePath)}, which is not a JSON pointer into the source document`);
  }
}
assert(results.get("overfit-18-cinebraid-581").result.report.minted.length > 0,
  "the newest generation has nested records that still need identifiers");

/* ===========================================================================
   10. Scenario B - a representative middle generation is stable and adds what
   the lineage says it adds. */

{
  const { result } = results.get("overfit-11-hub-v4-0");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.report.source.hubVersion, "v4");
  assert.strictEqual(census.get("overfit-11-hub-v4-0").counts.shots, 22);
  /* meta.aiPolicy appears at v4.2 and not before; the lineage is a fact the
     corpus can check rather than a story the document tells. */
  assert(!census.get("overfit-11-hub-v4-0").hazards.metaKeys.includes("aiPolicy"));
  assert(census.get("overfit-13-hub-v4-2").hazards.metaKeys.includes("aiPolicy"),
    "meta.aiPolicy is the v4.2 addition and must be present from there on");
  assert(census.get("overfit-18-cinebraid-581").hazards.metaKeys.includes("promptDefaults"));
}

/* ===========================================================================
   11. Scenario C - the newest generation, which is where the hard cases live. */

{
  const { result } = results.get("overfit-18-cinebraid-581");
  const legacy = result.candidate.extensions["com.cinebraid.legacy"];
  assert.strictEqual(result.ok, true, "the newest generation must migrate to a valid candidate");

  /* The ambiguous code is a dispute, not an answer. Longest-prefix matching is
     what the live build does and what silently discards the suffix; here its
     reading is one candidate among others and the raw token is kept. */
  const hull = (legacy.codes || []).filter((entry) => entry.code === "LOC-HULL-A");
  assert(hull.length >= 1, "LOC-HULL-A must be retained raw in the document, not only in the report");
  for (const entry of hull) assert.strictEqual(entry.code, "LOC-HULL-A", "the raw token keeps its suffix");
  const disputes = (result.candidate.statements || []).filter((entry) => entry.kind === "disputed");
  assert(disputes.length > 0, "a suffixed code that names nothing must produce a dispute");
  const hullShot = result.candidate.shots.find((shot) => shot.id === "L0-01");
  assert(hullShot, "L0-01 carries the LOC-HULL-A token");
  assert.notStrictEqual(JSON.stringify(hullShot.setting), JSON.stringify({ locationId: "LOC-HULL", coverageId: "A" }),
    "migration must not invent a coverage view to make the reading tidy");

  /* The token that names nothing at all is preserved and reported. */
  const unmapped = (legacy.unmappedCodes || []).map((entry) => entry.code);
  assert(unmapped.includes("STAGE-3"), "STAGE-3 resolves to nothing and must survive in the legacy preservation block");
  assert(result.report.diagnostics.some((entry) => entry.code === "migration.code.unresolved"),
    "an unresolved token must be reported as well as preserved");

  /* The production relationship that exists as English and not as structure. */
  const prose = [];
  for (const shot of result.candidate.shots) for (const relation of shot.relations || []) if (relation.kind === "bookend-of") prose.push(`${shot.id}->${relation.targetShotId}`);
  assert.deepStrictEqual(prose.sort(), ["L0-01->L7-03", "L7-03->L0-01"],
    "the bookend dependency the archive states three times in English must reach relations[]");
  const m022 = result.report.rules.find((rule) => rule.id === "M022");
  assert.strictEqual(m022.statements, 2, "reading a relationship out of prose is a guess and must say so");
  for (const statement of result.candidate.statements || [])
    if (formatTargetString(statement.target).endsWith("#/relations"))
      assert.strictEqual(statement.kind, "suggested", "a prose reading is suggested, never approved");

  /* Non-portable identifiers survive verbatim and are reported twice. */
  const shotIds = result.candidate.shots.map((shot) => shot.id);
  for (const id of ["INT-1->2", "INT-2->3", "INT-3->4", "INT-4->5", "INT-5->6"])
    assert(shotIds.includes(id), `${id} must round-trip unchanged; renaming it destroys the only link to its history`);
  assert.strictEqual(result.report.diagnostics.filter((entry) => entry.code === "migration.id.not-portable").length, 5);
  assert.strictEqual(result.validation.diagnostics.filter((entry) => entry.code === "id.not-portable").length, 5,
    "the validator reports portability independently of the migration report");

  /* The film's draft number is not the application's version. */
  assert.strictEqual(result.report.source.metaVersion, "v2.1");
  assert.strictEqual(result.report.source.metaVersionClass, "film-draft");
  assert.strictEqual(result.report.source.hubVersion, "v5.8.1");
  const draft = (result.candidate.statements || []).filter((entry) => formatTargetString(entry.target).endsWith("#/meta/draft"));
  assert.strictEqual(draft.length, 1, "reading meta.version as a film draft is a heuristic and says so exactly once");
  assert.strictEqual(draft[0].kind, "suggested");
}

/* Ready-for-Edit stays blocked where an unresolved dispute lands. P3 tests the
   readiness semantics P1 and P2 already defined; it does not add any. */
{
  const { result } = results.get("overfit-18-cinebraid-581");
  const dispute = (result.candidate.statements || []).find((entry) => entry.kind === "disputed");
  assert(dispute, "the newest generation must carry at least one dispute");
  const badge = deriveTargetBadge(result.candidate, result.candidate.statements, dispute.target);
  assert.strictEqual(badge.badge, "conflict",
    "an unresolved migration dispute must read as a conflict, or migration would quietly hand back a project that looks ready");
}

/* ===========================================================================
   12. Scenario D - telling historical loss apart from migration loss.
 *
 * `parentShot` and `fallbackFor` exist at anchor-hub-22 and are gone from the
 * next generation onward. That happened in 2026, inside CineBraid, years before
 * this migrator existed. The corpus has to be able to say so, because the
 * alternative is P2 being blamed for data it never saw. */

{
  const withRelations = "overfit-04-anchorhub-22";
  const sourceHas = (id) => {
    const hazards = census.get(id).hazards;
    return hazards.shotsWithParentShot + hazards.shotsWithFallbackFor;
  };

  assert.strictEqual(sourceHas(withRelations), 32, "anchor-hub-22 carries 31 parentShot and 1 fallbackFor");

  /* Present in the source, therefore present in the result - all thirty-two,
     including the two shots the archive records as being part of themselves.
     M021 maps what was authored; deciding that a self-reference is a mistake is
     a human's call and not a migrator's. */
  const AUTHORED = ["part-of", "fallback-for"];
  const recovered = [];
  for (const shot of results.get(withRelations).result.candidate.shots)
    for (const relation of shot.relations || []) if (AUTHORED.includes(relation.kind)) recovered.push(relation.kind);
  assert.strictEqual(recovered.length, 32, `authored relations must be recovered where they exist: got ${recovered.length}`);
  assert.strictEqual(recovered.filter((kind) => kind === "fallback-for").length, 1);
  assert.strictEqual(results.get(withRelations).result.report.rules.find((rule) => rule.id === "M021").statements, 0,
    "recovering authored structure is not a guess and must emit no statement at all");

  /* Absent from the source, therefore absent from the result. Migration does not
     reach back into an earlier generation to refill a later one. */
  const later = GENERATIONS.map((entry) => entry.id).slice(GENERATIONS.findIndex((entry) => entry.id === withRelations) + 1);
  assert(later.length === 14, "there are fourteen generations after the one that carries the relations");
  for (const id of later) {
    assert.strictEqual(sourceHas(id), 0, `${id}: the archive lost the authored relations before this generation`);
    for (const shot of results.get(id).result.candidate.shots)
      for (const relation of shot.relations || [])
        assert(!AUTHORED.includes(relation.kind),
          `${id}: migration fabricated a ${relation.kind} relation the source generation does not contain`);
  }

  /* And the report says which of the two happened: for the later generations
     M021 finds only the surviving `atomic` flag, and reports no loss, because
     from its point of view there was nothing there. */
  for (const id of later) {
    const m021 = results.get(id).result.report.rules.find((rule) => rule.id === "M021");
    assert.strictEqual(m021.sourceTargets, census.get(id).hazards.shotsWithAtomic,
      `${id}: M021 must account for exactly what the source generation still has`);
    assert.strictEqual(results.get(id).result.report.identity.lost.length, 0,
      `${id}: nothing was lost by migration here; the loss is historical`);
  }
}

/* ===========================================================================
   13. Statement volume. P0 Q2 asked whether statements[] scales; this is the
   first measurement against real documents, and the guard is a ceiling with
   headroom rather than a pinned number - the pinned goldens already hold the
   exact counts. */

const VOLUME = { perShot: 3.0, perSourceValue: 0.1 };
{
  const rows = [];
  for (const generation of GENERATIONS) {
    const golden = byId.get(generation.id);
    const shots = census.get(generation.id).counts.shots;
    const perShot = golden.statements.total / shots;
    const perValue = golden.statements.total / golden.accounting.leaves;
    rows.push({ id: generation.id, shots, statements: golden.statements.total, perShot, perValue });
    assert(perShot <= VOLUME.perShot,
      `${generation.id}: ${perShot.toFixed(2)} statements per shot exceeds the documented guard of ${VOLUME.perShot}`);
    assert(perValue <= VOLUME.perSourceValue,
      `${generation.id}: ${perValue.toFixed(3)} statements per source value exceeds the documented guard of ${VOLUME.perSourceValue}`);
    assert(!golden.statements.kinds.approved, `${generation.id}: migration emitted an approval`);
    assert(!golden.statements.kinds.observed, `${generation.id}: migration emitted an observation`);
  }
  const worst = rows.reduce((a, b) => (b.perShot > a.perShot ? b : a));
  assert(worst.perShot < VOLUME.perShot, `the worst case (${worst.id}) has no headroom left under the guard`);
}

/* ===========================================================================
   14. The README exists and says what these files are, because a directory of
   sanitized real-world data is exactly the thing somebody will find later and
   misread as synthetic. */

{
  const readme = readText(path.join(FIXTURE_ROOT, "README.md"));
  for (const phrase of ["sanitized", "not OFP documents", "no media", "fixtures:overfit:update"])
    assert(readme.toLowerCase().includes(phrase.toLowerCase()), `the fixture README must explain: ${phrase}`);
}

/* ===========================================================================
   15. Verification and regeneration stay separate commands. The day a check
   rebuilds the goldens is the day a golden stops meaning anything, so no
   `check:*` script may run the build tool. `check:syntax` node --checks it,
   which is a mention rather than a run, and the predicate says so. */

{
  const scripts = JSON.parse(readText(path.join(__dirname, "..", "package.json"))).scripts;
  const runsBuilder = /(?:^|&&\s*)node\s+scripts\/build-overfit-golden-fixtures\.js/;
  const offenders = Object.entries(scripts).filter(([name, body]) => name.startsWith("check") && runsBuilder.test(body));
  assert.strictEqual(offenders.length, 0,
    `no check:* script may regenerate the fixtures it verifies, found: ${offenders.map(([name]) => name).join(", ")}`);
  assert(scripts["fixtures:overfit:verify"], "the verify command must exist");
  assert(scripts["fixtures:overfit:update"], "and so must the separate update command");
  assert(!runsBuilder.test(scripts["fixtures:overfit:verify"]), "verify must not be the build tool wearing a different name");
}

/* And the mechanism behind it: running this suite must leave the corpus exactly
   as it found it. */
{
  const digest = () => fs.readdirSync(path.join(FIXTURE_ROOT, "generations")).sort()
    .map((name) => sha256(readBytes(path.join(FIXTURE_ROOT, "generations", name)))).join("");
  assert.strictEqual(digest(), corpusDigestAtStart, "verifying the corpus must not rewrite it");
}

const totals = GENERATIONS.reduce((sum, generation) => sum + byId.get(generation.id).accounting.leaves, 0);
const statements = GENERATIONS.reduce((sum, generation) => sum + byId.get(generation.id).statements.total, 0);
console.log(`OFP P3 Overfit conformance passed: ${GENERATIONS.length} sanitized historical generations, ${totals} source values accounted, 0 unaccounted, ${statements} statements, 0 approved, ${FULL_GOLDEN_IDS.length} full goldens byte-identical.`);

/* Negative controls for the Open Film Project P2 migration framework.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * below reintroduces exactly one defect the migration framework exists to
 * prevent, then asserts the corresponding property FAILS. A control that stays
 * green is the real failure: it means the test it guards would not notice the
 * defect coming back.
 *
 * Two rules, both inherited from the P1 suite and both learned the hard way:
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. The defect is
 *   introduced by compiling a modified copy of the source IN MEMORY and
 *   installing it in the module cache, so a broad `git checkout` can never be
 *   the thing that undoes it.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt:
 *   the anchor must exist, must be unique, must actually change the source, and
 *   the DEFECT ITSELF must be observable through a probe before the guarded
 *   assertion is allowed to count as detection.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const OFP_DIR = path.join(__dirname, "..", "ofp");
const FIXTURES = path.join(__dirname, "fixtures", "ofp-legacy");
const AT = "2026-08-10T00:00:00Z";
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

/* Re-required inside each control so the patched modules are the ones under
   test, rather than a copy captured before the patch was installed. */
const migrate = () => require("../ofp/ofp-migrate");
const parse = (text) => require("../ofp/ofp-json").parseJsonStrict(text);
const load = (name) => parse(readFixture(name));
const preview = (name, options = {}) => migrate().previewLegacyMigration(load(name), { at: AT, ...options });
const statementsOf = (result) => (result.candidate && result.candidate.statements) || [];
const codesOf = (result) => result.report.diagnostics.map((entry) => entry.code);

/* A legacy project whose only defect is a shot pointing at a scene that is not
   there. Every value is accounted for, so migration completes - and the result
   does not validate, which is the distinction between "it serialized" and "it
   worked". */
const DANGLING_SOURCE = () => ({
  meta: { title: "Dangling", schemaVersion: "6.7" },
  scenes: [],
  shots: [{ id: "S1", scene: "SC-NOT-HERE", desc: "A shot bound to a scene nobody wrote.", dur: 3 }],
  characters: [], locations: [], props: [], vehicles: [],
});

function sandboxProject(fixture) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-p2-nc-"));
  const source = path.join(base, "source-project");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "project.json"), readFixture(fixture));
  return { base, source, destination: path.join(base, "destination") };
}

/* ---------------------------------------------------------------------------
   In-memory patching. The whole ofp/ cache is cleared and the patched module is
   installed under its own resolved filename, so a dependent that requires it
   afterwards picks up the patched copy rather than the real one. */
function patchedOfp(relative, edits, run) {
  const file = require.resolve(path.join(__dirname, "..", relative));
  /* Normalised to LF before matching. Anchors span lines, and on a Windows
     checkout with core.autocrlf on they would arrive as \r\n - so the anchor
     would not match, the control would report itself as stale, and the failure
     would look like a source change rather than a line ending. */
  const original = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${relative}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${relative}; the control would test the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${relative} was not modified at all`);

  const saved = new Map();
  for (const key of Object.keys(require.cache))
    if (key.startsWith(OFP_DIR)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const patched = new Module(file, module);
    patched.filename = file;
    patched.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = patched;
    patched._compile(code, file);
    patched.loaded = true;
    return run({ patchedSource: code, originalSource: original });
  } finally {
    for (const key of Object.keys(require.cache)) if (key.startsWith(OFP_DIR)) delete require.cache[key];
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

const results = [];

function control({ id, label, guards, module: relative, edits, defect, guarded, expect = assert.AssertionError }) {
  const run = (context = {}) => {
    let defectObserved = false;
    if (defect) { defect(context); defectObserved = true; }
    let detected = null;
    try {
      guarded();
    } catch (error) {
      /* `expect` may be a class or a class NAME, because patching clears the
         whole ofp/ require cache and a class defined in ofp/ is re-created
         inside the patched context - so `instanceof` against the outer copy is
         false even though the error is exactly the right one. */
      const matches = typeof expect === "string" ? error.name === expect : error instanceof expect;
      if (!matches) throw error;
      detected = error;
    }
    assert(detected, `NEGATIVE CONTROL ${id} FAILED: with "${label}" reintroduced, "${guards}" still passed. That test cannot detect the defect it exists for.`);
    assert(defectObserved || !defect, `NEGATIVE CONTROL ${id}: the defect probe did not run`);
    results.push({ id, label, guards, outcome: String(detected.message).split("\n")[0].slice(0, 96) });
  };
  if (relative) patchedOfp(relative, edits, run);
  else run();
}

/* ===========================================================================
   1. The source project must never be written. */
control({
  id: "NC-P2-01",
  label: "writing a log file inside the source project during migration",
  guards: "INV-R1: the fs guard refuses any write under the source project root",
  module: "ofp/ofp-migrate-write.js",
  edits: [[
    `    const text = fs.readFileSync(legacyFile, "utf8");`,
    `    const text = fs.readFileSync(legacyFile, "utf8");
    fs.writeFileSync(path.join(source, "migration.log"), "migrated", "utf8");`,
  ]],
  expect: "InvR1Violation",
  defect: ({ patchedSource, originalSource }) => {
    const injected = `fs.writeFileSync(path.join(source, "migration.log"), "migrated", "utf8");`;
    assert(patchedSource.includes(injected), "receipt: the injected write is in the source that was compiled");
    assert(!originalSource.includes(injected), "receipt: and is not in the real source");
    const { source, destination, base } = sandboxProject("clean.json");
    let violation = null;
    try { require("../ofp/ofp-migrate-write").writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: destination, at: AT }); }
    catch (error) { violation = error; }
    finally { fs.rmSync(base, { recursive: true, force: true }); }
    assert(violation, "receipt: the patched migration must actually attempt the write");
    assert.strictEqual(violation.method, "writeFileSync", "receipt: refused at the expected call");
    assert(violation.target.endsWith("migration.log"), `receipt: refused the expected path, got ${violation.target}`);
  },
  guarded: () => {
    const { source, destination, base } = sandboxProject("clean.json");
    try {
      const outcome = require("../ofp/ofp-migrate-write").writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: destination, at: AT });
      assert.strictEqual(outcome.written, true);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
});

/* ===========================================================================
   2. Inspecting a project must not upgrade it. */
control({
  id: "NC-P2-02",
  label: "stamping the draft format block onto the source while migrating it",
  guards: "the source document is not mutated by migrating it",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `  const context = new MigrationContext(source, detection, { at, generatorVersion });`,
    `  source.format = { id: OFP_FORMAT_ID, version: OFP_CONTRACT_VERSION };
  if (source.meta) delete source.meta.schemaVersion;
  const context = new MigrationContext(source, detection, { at, generatorVersion });`,
  ]],
  defect: () => {
    const source = load("clean.json");
    assert.strictEqual(source.meta.schemaVersion, "6.7", "receipt: the source is on the legacy lineage before migration");
    migrate().migrateLegacyProject(source, { at: AT });
    assert.strictEqual(source.format.version, "1.0-draft.1", "receipt: a real project has been dragged into the draft lane");
    assert.strictEqual(source.meta.schemaVersion, undefined, "receipt: and its legacy marker is gone");
  },
  guarded: () => {
    const source = load("clean.json");
    const before = JSON.stringify(source);
    migrate().migrateLegacyProject(source, { at: AT });
    assert.strictEqual(JSON.stringify(source), before, "migrating must not change one byte of the source document");
  },
});

/* ===========================================================================
   3. A source value must never disappear without a disposition. */
control({
  id: "NC-P2-03",
  label: "letting the unknown-content sweep skip what no rule claimed",
  guards: "every meaningful source value has a disposition",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[`      for (const pointer of context.unaccounted())`, `      for (const pointer of [])`]],
  defect: () => {
    const result = preview("unknown-fields.json");
    assert(result.report.accounting.unaccounted.length > 0, "receipt: source values now reach no rule at all");
    assert(result.report.accounting.unaccounted.includes("/contextDoc"), "receipt: including a field with real content");
    assert(codesOf(result).includes("migration.unaccounted-source-value"), "receipt: and the engine says so");
  },
  guarded: () => {
    for (const name of ["unknown-fields.json", "clean.json", "frame-stores.json"])
      assert.deepStrictEqual(preview(name).report.accounting.unaccounted, [], `${name}: there is no sixth category`);
  },
});

/* ===========================================================================
   4. An ambiguous code must not silently prefix-collapse. */
control({
  id: "NC-P2-04",
  label: "resolving a suffixed code by longest prefix and calling it the answer",
  guards: "a suffixed legacy code produces a dispute with both readings and keeps the raw token",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `            const split = context.splitSuffix(token);
            if (!split) {`,
    `            const split = context.splitSuffix(token);
            if (split) {
              if (split.entity.type === "location") context.setSetting(shot, { locationId: split.base }, pointer, "prefix match");
              else addSubject(split.base, pointer, "prefix match");
              return;
            }
            if (!split) {`,
  ]],
  defect: () => {
    const result = preview("codes-ambiguous.json");
    const shot = result.candidate.shots.find((entry) => entry.id === "L1-01");
    assert.deepStrictEqual(shot.setting, { locationId: "LOC-HULL" }, "receipt: LOC-HULL-A silently became LOC-HULL and the suffix is gone");
    assert.strictEqual(statementsOf(result).filter((entry) => entry.kind === "disputed").length, 0, "receipt: and nothing records that a choice was made");
  },
  guarded: () => {
    const result = preview("codes-ambiguous.json");
    const disputes = statementsOf(result).filter((entry) => entry.kind === "disputed");
    assert.strictEqual(disputes.length, 3, "each ambiguous token must produce an addressable, blocking question");
    const hull = disputes.find((entry) => entry.target.subject === "shot:L1-01");
    assert.deepStrictEqual(hull.candidates.map((entry) => entry.value), [{ locationId: "LOC-HULL", coverageId: "A" }, { locationId: "LOC-HULL-A" }]);
    assert(result.candidate.extensions["com.cinebraid.legacy"].codes.some((entry) => entry.code === "LOC-HULL-A"), "and the raw token survives in the document");
  },
});

/* ===========================================================================
   5. Migration may never fabricate an approval. */
control({
  id: "NC-P2-05",
  label: "promoting a migration suggestion to an approval by a human who never saw it",
  guards: "migration writes only suggested, disputed and cited",
  module: "ofp/ofp-migrate.js",
  edits: [
    [`const MIGRATION_STATEMENT_KINDS = ["suggested", "disputed", "cited"];`,
      `const MIGRATION_STATEMENT_KINDS = ["suggested", "disputed", "cited", "approved"];`],
    [`    this.statementDrafts.push(entry);`,
      `    if (entry.kind === "suggested") { entry.kind = "approved"; entry.actor = { kind: "human", name: "Director" }; }
    this.statementDrafts.push(entry);`],
  ],
  defect: () => {
    const result = preview("film-draft.json");
    const approved = statementsOf(result).filter((entry) => entry.kind === "approved");
    assert.strictEqual(approved.length, 1, "receipt: migration has written an approval");
    assert.strictEqual(approved[0].actor.kind, "human", "receipt: attributed to a human who never saw it");
    assert.strictEqual(result.validation.ok, true, "receipt: and the document validates, so nothing downstream would notice");
  },
  guarded: () => {
    for (const name of ["film-draft.json", "inferred-marker.json", "prose-dependency.json", "codes-ambiguous.json"])
      for (const statement of statementsOf(preview(name))) {
        assert.notStrictEqual(statement.kind, "approved", `${name}: approval is a human act`);
        assert.strictEqual(statement.actor.kind, "tool");
      }
  },
});

/* ===========================================================================
   6. The claim hash must be recomputed against the value that finally exists. */
control({
  id: "NC-P2-06",
  label: "binding a statement to something other than the value it resolves to",
  guards: "a migration statement's claim hash binds the value at its target",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `      ? { hash: computeClaimHash(resolution.targetString, value), preview: buildClaimPreview(value) }`,
    `      ? { hash: computeClaimHash(resolution.targetString, draft.note), preview: buildClaimPreview(value) }`,
  ]],
  defect: () => {
    const { deriveStatementState } = require("../ofp/ofp-statements");
    const result = preview("film-draft.json");
    const statement = statementsOf(result)[0];
    assert(statement, "receipt: there is a statement to bind");
    assert.strictEqual(deriveStatementState(result.candidate, statement).state, "stale",
      "receipt: the statement is born stale, so it confers nothing and the validator reports it");
  },
  guarded: () => {
    const { computeClaimHash } = require("../ofp/ofp-claim");
    const { resolveTarget } = require("../ofp/ofp-target");
    for (const name of ["film-draft.json", "codes-ambiguous.json", "inferred-marker.json"]) {
      const result = preview(name);
      for (const statement of statementsOf(result)) {
        const resolution = resolveTarget(result.candidate, statement.target);
        assert.strictEqual(statement.claim.hash, computeClaimHash(resolution.targetString, resolution.value),
          `${name}: ${statement.id} carries a hash that does not bind its value`);
      }
    }
  },
});

/* ===========================================================================
   7. A migration-created target must resolve in the result. */
control({
  id: "NC-P2-07",
  label: "targeting a subject the migrated document does not contain",
  guards: "every migration-created statement target resolves before the result is accepted",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `                target: { subject: shot.subject, path: "/setting" },`,
    `                target: { subject: shot.subject + "-MISSING", path: "/setting" },`,
  ]],
  defect: () => {
    const result = preview("codes-ambiguous.json");
    assert(codesOf(result).includes("migration.statement.unresolvable"), "receipt: the engine sees an unresolvable migration target");
    assert.strictEqual(result.ok, false, "receipt: and refuses to call the migration successful");
  },
  guarded: () => {
    const { resolveTarget } = require("../ofp/ofp-target");
    const result = preview("codes-ambiguous.json");
    assert(!codesOf(result).includes("migration.statement.unresolvable"));
    for (const statement of statementsOf(result))
      assert.strictEqual(resolveTarget(result.candidate, statement.target).ok, true, `${statement.id} must resolve`);
    assert.strictEqual(result.validation.ok, true);
  },
});

/* ===========================================================================
   8. A minted identity must be deterministic. */
control({
  id: "NC-P2-08",
  label: "minting a nested identifier from a random source",
  guards: "the same legacy input always mints the same identifiers",
  module: "ofp/ofp-identifiers.js",
  edits: [[
    `  if (!taken.has(base)) return base;`,
    `  if (!taken.has(base)) return base + "-" + Math.random().toString(36).slice(2, 8);`,
  ]],
  defect: () => {
    const first = preview("missing-ids.json").candidate.shots[0].frames.map((frame) => frame.id);
    const second = preview("missing-ids.json").candidate.shots[0].frames.map((frame) => frame.id);
    assert.notDeepStrictEqual(first, second, "receipt: two runs over one input now mint different identities");
    assert(first[0].startsWith("frame-INT-1->2-0001-"), `receipt: and the identity is no longer derived from the record, got ${first[0]}`);
  },
  guarded: () => {
    const first = preview("missing-ids.json");
    const second = preview("missing-ids.json");
    assert.strictEqual(first.serialized, second.serialized, "migration must be re-runnable, so a mint cannot read a clock or a random source");
  },
});

/* ===========================================================================
   9. A non-portable legacy identifier must never be renamed. */
control({
  id: "NC-P2-09",
  label: "sanitising a legacy identifier into the id-portable profile",
  guards: "a legal-but-non-portable legacy identifier survives verbatim",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `        const id = context.identityOf(from, shot);`,
    `        const id = context.identityOf(from, shot).replace(/[^A-Za-z0-9._-]/g, "-");`,
  ]],
  defect: () => {
    const result = preview("missing-ids.json");
    assert.deepStrictEqual(result.candidate.shots.map((shot) => shot.id), ["INT-1--2", "INT-2--3"],
      "receipt: the shots have been renamed, and the link between each shot and its takes directory is gone");
    assert.strictEqual(result.report.diagnostics.filter((entry) => entry.code === "migration.id.not-portable").length, 3,
      "receipt: and the warning that would have told somebody is now mostly silent");
  },
  guarded: () => {
    const result = preview("missing-ids.json");
    assert.deepStrictEqual(result.candidate.shots.map((shot) => shot.id), ["INT-1->2", "INT-2->3"], "nothing renames a legacy identifier");
    assert.strictEqual(result.report.identity.lost.length, 0);
  },
});

/* ===========================================================================
   10. The planning marker must leave the production value. */
control({
  id: "NC-P2-10",
  label: "leaving [INFERRED FOR PLANNING] embedded in the canonical field",
  guards: "the marker is stripped from the value and the evidence moves into the statement",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[`        context.rewrite(written, cleaned);`, `        context.rewrite(written, written.value);`]],
  defect: () => {
    const result = preview("inferred-marker.json");
    assert(result.candidate.entities.characters[0].description.includes("[INFERRED FOR PLANNING]"),
      "receipt: the marker is still inside the production value");
    assert(statementsOf(result)[0].claim.preview.includes("[INFERRED FOR PLANNING]"),
      "receipt: so the claim binds prose-plus-marker, and deleting just the marker would wrongly stale the suggestion");
  },
  guarded: () => {
    const result = preview("inferred-marker.json");
    for (const entity of result.candidate.entities.characters)
      assert(!String(entity.description).includes("[INFERRED FOR PLANNING]"), "the marker must not survive in a production value");
    for (const shot of result.candidate.shots)
      assert(!String(shot.description || "").includes("[INFERRED FOR PLANNING]"));
    for (const statement of statementsOf(result))
      assert(statement.note.includes("[INFERRED FOR PLANNING]"), "and the evidence must be in the statement");
  },
});

/* ===========================================================================
   11. Unknown legacy content must not be silently discarded. */
control({
  id: "NC-P2-11",
  label: "recording a preservation without preserving the value",
  guards: "unknown legacy content is preserved with its source path, its value and its reason",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `    this.legacyPreserved.push({ sourcePath: pointer, rule: this.rule, note, value });`,
    `    if (value === undefined) this.legacyPreserved.push({ sourcePath: pointer, rule: this.rule, note, value });`,
  ]],
  defect: () => {
    const result = preview("unknown-fields.json");
    assert.strictEqual(result.candidate.extensions["com.cinebraid.legacy"].preserved, undefined,
      "receipt: the accounting still says preserved, and there is nothing there");
    assert.strictEqual(result.report.accounting.unaccounted.length, 0, "receipt: which the ledger alone cannot tell apart from a real preservation");
    assert.strictEqual(result.ok, true, "receipt: and the migration reports success");
  },
  guarded: () => {
    const result = preview("unknown-fields.json");
    const preserved = result.candidate.extensions["com.cinebraid.legacy"].preserved || [];
    const paths = preserved.map((entry) => entry.sourcePath);
    for (const pointer of ["/contextDoc", "/shots/0/positioning", "/meta/someFieldNobodyDocumented/nested/2/deep"])
      assert(paths.includes(pointer), `${pointer} must survive in the document, not only in the report`);
    assert.strictEqual(preserved.find((entry) => entry.sourcePath === "/contextDoc").value, "A workflow-era field with no current consumer.");
  },
});

/* ===========================================================================
   12. A migration is not successful because serialization completed. */
control({
  id: "NC-P2-12",
  label: "reporting a migration successful while its result fails the contract validator",
  guards: "a candidate that does not validate is not a successful migration",
  module: "ofp/ofp-migrate.js",
  /* Two edits, because the property is held two ways: a failing validation
     raises an error diagnostic AND is a term of `ok`. Removing one alone leaves
     the other still catching it, so the control removes both - which is itself
     the evidence that the belt and the braces are independent. */
  edits: [
    [`  if (outcome.candidate && !validation.ok)`, `  if (false && outcome.candidate && !validation.ok)`],
    [`    ok: errors.length === 0 && validation.ok,`, `    ok: errors.length === 0,`],
  ],
  defect: () => {
    const result = migrate().previewLegacyMigration(DANGLING_SOURCE(), { at: AT });
    assert.strictEqual(result.validation.ok, false, "receipt: the candidate does not validate");
    assert(result.validation.diagnostics.some((entry) => entry.code === "ref.unresolved"), "receipt: it names a scene that is not there");
    assert.strictEqual(result.ok, true, "receipt: and the migration calls itself successful anyway");
  },
  guarded: () => {
    const result = migrate().previewLegacyMigration(DANGLING_SOURCE(), { at: AT });
    assert.strictEqual(result.ok, false, "a migration whose result fails validation has not succeeded");
  },
});

/* ===========================================================================
   13. The destination may not be the source. */
control({
  id: "NC-P2-13",
  label: "accepting the source project as its own migration destination",
  guards: "a migration always has a separate source and target",
  module: "ofp/ofp-migrate-write.js",
  /* Both refusals that stand between a caller and writing into the project it is
     migrating. Removing one leaves the other catching it, which is the point of
     having two - so the control removes both and the guarded assertion has to be
     what notices. */
  edits: [
    [`  if (source === destination)`, `  if (false)`],
    [`  if (contains(source, destination))`, `  if (false && contains(source, destination))`],
    [`  if (contains(destination, source))`, `  if (false && contains(destination, source))`],
  ],
  defect: () => {
    const { base, source } = sandboxProject("clean.json");
    try {
      const check = require("../ofp/ofp-migrate-write").checkDestination(source, source, { allowExistingDirectory: true });
      assert.strictEqual(check.ok, true, "receipt: writing a project on top of itself is now permitted");
      assert.strictEqual(check.target, path.join(source, "project.ofp.json"), "receipt: and the target is inside the source project");
      require("../ofp/ofp-migrate-write").writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: source, at: AT, allowExistingDirectory: true });
      assert(fs.existsSync(path.join(source, "project.ofp.json")), "receipt: and the write really lands in the source project");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
  guarded: () => {
    const { base, source } = sandboxProject("clean.json");
    try {
      assert.throws(() => require("../ofp/ofp-migrate-write").checkDestination(source, source), (error) => error.code === "same-path");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
});

/* ===========================================================================
   14. The destination may not be inside the source. */
control({
  id: "NC-P2-14",
  label: "overwriting a document that is already at the destination",
  guards: "migration never overwrites an existing document",
  module: "ofp/ofp-migrate-write.js",
  edits: [[`  if (fs.existsSync(target))`, `  if (false)`]],
  defect: () => {
    const { base, source, destination } = sandboxProject("clean.json");
    try {
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, "project.ofp.json"), "somebody else's work", "utf8");
      require("../ofp/ofp-migrate-write").writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: destination, at: AT, allowExistingDirectory: true });
      assert.notStrictEqual(fs.readFileSync(path.join(destination, "project.ofp.json"), "utf8"), "somebody else's work",
        "receipt: an existing document at the destination has been destroyed");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
  guarded: () => {
    const { base, source, destination } = sandboxProject("clean.json");
    try {
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, "project.ofp.json"), "somebody else's work", "utf8");
      assert.throws(() => require("../ofp/ofp-migrate-write").writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: destination, at: AT, allowExistingDirectory: true }),
        (error) => error.code === "exists");
      assert.strictEqual(fs.readFileSync(path.join(destination, "project.ofp.json"), "utf8"), "somebody else's work", "and it is still there");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
});

/* ===========================================================================
   15. An absolute host path must never reach the document. */
control({
  id: "NC-P2-15",
  label: "carrying absolute host paths and local endpoints into the migrated document",
  guards: "no machine-specific path survives into OFP",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `function valueLooksSensitive(value) {
  if (typeof value !== "string" || value === "") return null;`,
    `function valueLooksSensitive(value) {
  return null;
  if (typeof value !== "string" || value === "") return null;`,
  ]],
  defect: () => {
    const result = preview("secret-traps.json");
    assert(result.serialized.includes("C:\\\\Users\\\\somebody"), "receipt: a Windows host path is now in the portable document");
    assert(result.serialized.includes("localhost:11434"), "receipt: and so is a machine-local endpoint");
    assert(result.serialized.includes("hunter2"), "receipt: including a password inside a provider URL");
  },
  guarded: () => {
    const result = preview("secret-traps.json");
    for (const value of ["C:\\Users", "/Users/somebody", "localhost:11434", "hunter2"])
      assert(!result.serialized.includes(value), `${value} reached the migrated document`);
    assert.deepStrictEqual(require("../ofp/ofp-migrate-scan").scanMigrationOutput(result.candidate), []);
  },
});

/* ===========================================================================
   16. A credential must never reach the document. */
control({
  id: "NC-P2-16",
  label: "carrying credential-named fields into the migrated document",
  guards: "no API key, auth secret or passcode survives into OFP",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `function keyLooksSecret(key) {
  const words = keyWords(key);`,
    `function keyLooksSecret(key) {
  if (key !== null) return false;
  const words = keyWords(key);`,
  ]],
  defect: () => {
    const result = preview("secret-traps.json");
    assert(result.serialized.includes("sk-should-never-be-serialised"), "receipt: a provider key is now in the portable document");
    assert(result.serialized.includes("letmein"), "receipt: and an editor passcode with it");
    assert(result.serialized.includes("fal-0000000000000000000000000000000000000000"), "receipt: and a FAL key");
  },
  guarded: () => {
    const result = preview("secret-traps.json");
    for (const value of ["sk-should-never-be-serialised", "letmein", "fal-0000", "0123456789abcdef0123456789abcdef"])
      assert(!result.serialized.includes(value), `${value} reached the migrated document`);
    const planted = JSON.parse(JSON.stringify(result.candidate));
    planted.meta.apiKey = "x";
    assert(require("../ofp/ofp-migrate-scan").scanMigrationOutput(planted).some((entry) => entry.code === "migration.output.secret-leak"),
      "and the independent output scan still catches one that was planted after the fact");
  },
});

/* ===========================================================================
   17. A count or identity change must be explained by a rule. */
control({
  id: "NC-P2-17",
  label: "dropping a continuity state on the way through without a rule to explain it",
  guards: "counts and identities are conserved, or the change is explained",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[`        entity.record.states = states;`, `        entity.record.states = states.slice(1);`]],
  defect: () => {
    const result = preview("state-coverage-aliases.json");
    assert.strictEqual(result.report.counts.reconciled, false, "receipt: a state disappeared and nothing explains it");
    assert(codesOf(result).includes("migration.count.unexplained"), "receipt: the count check sees it");
    assert(codesOf(result).includes("migration.identity.lost"), "receipt: and so does the identity check");
  },
  guarded: () => {
    for (const name of ["state-coverage-aliases.json", "clean.json"]) {
      const result = preview(name);
      assert.strictEqual(result.report.counts.reconciled, true, `${name}: a count changed with no rule to explain it`);
      assert.deepStrictEqual(result.report.identity.lost, [], `${name}: a legacy identifier disappeared`);
    }
  },
});

/* ===========================================================================
   18. A clock must not make an identical migration drift. */
control({
  id: "NC-P2-18",
  label: "stamping a statement with a time read inside the migration",
  guards: "the same legacy input produces byte-identical output",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `      actor: draft.actor,
      at: context.at,`,
    `      actor: draft.actor,
      at: context.at,
      migratedAt: new Date(Number(process.hrtime.bigint() / 1000000n)).toISOString(),`,
  ]],
  defect: () => {
    const first = preview("codes-ambiguous.json");
    const second = preview("codes-ambiguous.json");
    assert(statementsOf(first)[0].migratedAt, "receipt: a time was read inside the migration");
    assert.notStrictEqual(first.serialized, second.serialized, "receipt: and two identical migrations now differ");
  },
  guarded: () => {
    for (const name of ["codes-ambiguous.json", "inferred-marker.json"])
      assert.strictEqual(preview(name).serialized, preview(name).serialized, `${name}: migration must be byte-deterministic`);
  },
});

/* ===========================================================================
   19. A draft document must never be written into the real source project. */
control({
  id: "NC-P2-19",
  label: "writing project.ofp.json beside the source after the guard has been released",
  guards: "the source tree is unchanged and no OFP document appears inside it",
  module: "ofp/ofp-migrate-write.js",
  edits: [[
    `  fs.renameSync(temporary, target);`,
    `  fs.renameSync(temporary, target);
  fs.writeFileSync(path.join(source, CANONICAL_FILENAME), result.serialized, "utf8");`,
  ]],
  defect: () => {
    const { base, source, destination } = sandboxProject("clean.json");
    try {
      require("../ofp/ofp-migrate-write").writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: destination, at: AT });
      assert(fs.existsSync(path.join(source, "project.ofp.json")),
        "receipt: a 1.0-draft.1 document has been written into a real project, which is the one thing the draft lane forbids");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
  guarded: () => {
    const { snapshotTree, diffSnapshots } = require("../ofp/ofp-read");
    const { base, source, destination } = sandboxProject("clean.json");
    try {
      const before = snapshotTree(source);
      require("../ofp/ofp-migrate-write").writeMigratedCopy({ sourceProjectRoot: source, destinationRoot: destination, at: AT });
      assert.deepStrictEqual(diffSnapshots(before, snapshotTree(source)), [], "the source project must be byte-identical afterwards");
      assert(!fs.existsSync(path.join(source, "project.ofp.json")), "and carry no OFP document");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
});

/* ===========================================================================
   20. A deterministic authored mapping must emit no statement. */
control({
  id: "NC-P2-20",
  label: "marking recovered authored structure as a migration suggestion",
  guards: "migrations emit statements only where they guess",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `          context.addRelation(shot, { kind, targetShotId, note: \`Recovered from legacy shot.\${field}.\` }, pointer, \`authored \${field} recovered as a \${kind} relation\`);`,
    `          context.addRelation(shot, { kind, targetShotId, note: \`Recovered from legacy shot.\${field}.\` }, pointer, \`authored \${field} recovered as a \${kind} relation\`);
          context.statement({ target: { subject: shot.subject, path: "/relations" }, kind: "suggested", note: "migrated", from: pointer });`,
  ]],
  defect: () => {
    const result = preview("no-schema-version.json");
    const fromM021 = statementsOf(result).filter((entry) => entry.id.startsWith("stm-m021"));
    assert.strictEqual(fromM021.length, 2, "receipt: authored production data now carries migration suggestions");
    assert.strictEqual(fromM021[0].kind, "suggested", "receipt: which makes it a proposal nobody proposed, and blocks Ready-for-Edit on it");
  },
  guarded: () => {
    const recovered = preview("no-schema-version.json");
    for (const statement of statementsOf(recovered))
      assert(!statement.id.startsWith("stm-m021"), "recovering authored structure is not a guess and must emit no statement");
    assert.strictEqual(statementsOf(preview("clean.json")).length, 0, "and a wholly deterministic migration emits nothing at all");
  },
});

/* ===========================================================================
   21-25. M080 has two failure directions, and a control for each.

   P3 recorded the quarantine eating `#image1` - a prompt reference placeholder
   filed under a bare `token` key. The fix moved `token` from the single secret
   words to the qualified pairs. That creates a NEW way to be wrong (a real
   credential walking through), so both directions are held here, plus the three
   wrong fixes that would each look like a repair. */

/* The property the M080 fix exists for, restated so five controls can share it
   rather than five copies drifting apart. */
const m080Preserved = () => {
  const result = preview("secret-traps.json");
  const preserved = result.candidate.extensions["com.cinebraid.legacy"].preserved || [];
  for (const [pointer, value] of [
    ["/shots/0/promptBuilder/spec/references/0/token", "#image1"],
    ["/shots/0/promptBuilder/providerPayload/references/0/token", "@image1"],
  ]) {
    const entry = preserved.find((item) => item.sourcePath === pointer);
    assert(entry, `${pointer}: the prompt reference placeholder was dropped as a credential`);
    assert.strictEqual(entry.value, value, `${pointer}: preserved, but not verbatim`);
    assert(result.serialized.includes(value), `${value} must reach the migrated document`);
  }
};
const m080NoLeak = () => {
  const result = preview("secret-traps.json");
  for (const value of ["tok-should-never-be-serialised", "at-should-never-be-serialised", "rt-should-never-be-serialised",
    "sk-should-never-be-serialised", "letmein", "fal-0000"])
    assert(!result.serialized.includes(value), `${value} reached the migrated document`);
};

control({
  id: "NC-P2-21",
  label: "reading a bare `token` key as a credential on the key name alone",
  guards: "legitimate project data is not quarantined because its field name looks secret",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `const SECRET_WORDS = new Set(["secret", "password",`,
    `const SECRET_WORDS = new Set(["secret", "token", "password",`,
  ]],
  defect: () => {
    const result = preview("secret-traps.json");
    assert(!result.serialized.includes("#image1"), "receipt: the prompt reference placeholder is gone from the document again");
    assert(!result.serialized.includes("@image1"), "receipt: and so is its provider-payload twin");
    const where = result.report.diagnostics.filter((entry) => entry.code === "migration.secret.quarantined").map((entry) => entry.where);
    assert(where.includes("/shots/0/promptBuilder/spec/references/0/token"), "receipt: dropped by the KEY-NAME branch, which is the P3 defect exactly");
    assert.strictEqual(result.ok, true, "receipt: and the migration still reports success, which is what made it quiet");
  },
  guarded: m080Preserved,
});

control({
  id: "NC-P2-22",
  label: "dropping the qualified token pairs, so a real credential walks through",
  guards: "a credential-named token is still refused entry to the OFP document",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `"secret key", "access token", "refresh token", "api token", "auth token", "bearer token", "id token", "oauth token", "session token", "editor pass"`,
    `"secret key", "editor pass"`,
  ]],
  defect: () => {
    const result = preview("secret-traps.json");
    for (const value of ["tok-should-never-be-serialised", "at-should-never-be-serialised", "rt-should-never-be-serialised"])
      assert(result.serialized.includes(value), `receipt: ${value} is now in the portable document`);
    assert.strictEqual(result.ok, true, "receipt: reported as a successful migration while carrying credentials");
  },
  guarded: m080NoLeak,
});

control({
  id: "NC-P2-23",
  label: "inspecting ordinary values and quarantining whatever looks token-shaped",
  guards: "the quarantine decides by key shape and never by guessing about a value",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `function valueLooksSensitive(value) {
  if (typeof value !== "string" || value === "") return null;
  if (CREDENTIAL_URL_PATTERN.test(value)) return "a URL carrying credentials";`,
    `function valueLooksSensitive(value) {
  if (typeof value !== "string" || value === "") return null;
  if (/[#@][A-Za-z]+\\d+/.test(value)) return "a token-shaped value";
  if (CREDENTIAL_URL_PATTERN.test(value)) return "a URL carrying credentials";`,
  ]],
  defect: () => {
    const result = preview("secret-traps.json");
    assert(!result.serialized.includes("#image1"), "receipt: innocent project text removed because a scanner thought it looked like a secret");
    const paths = result.report.diagnostics.filter((entry) => entry.code === "migration.path.quarantined").map((entry) => entry.where);
    assert(paths.includes("/shots/0/promptBuilder/spec/references/0/token"),
      "receipt: removed by the VALUE branch this time, which is the wrong fix rather than the old bug");
  },
  guarded: m080Preserved,
});

control({
  id: "NC-P2-24",
  label: "preserving the value while dropping the key it was preserved from",
  guards: "a preserved value keeps its source path, not only its contents",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `    this.legacyPreserved.push({ sourcePath: pointer, rule: this.rule, note, value });`,
    `    this.legacyPreserved.push({ rule: this.rule, note, value });`,
  ]],
  defect: () => {
    const result = preview("secret-traps.json");
    assert(result.serialized.includes("#image1"), "receipt: the value itself is still there, so a value-only test would pass");
    const preserved = result.candidate.extensions["com.cinebraid.legacy"].preserved || [];
    assert(preserved.length > 0, "receipt: and there are preserved entries");
    assert(preserved.every((entry) => entry.sourcePath === undefined),
      "receipt: but nothing records where any of them came from - the structure went silently");
  },
  guarded: m080Preserved,
});

control({
  id: "NC-P2-25",
  label: "quarantining on the first migration and not on the ones after it",
  guards: "identical input produces an identical document and an identical warning set",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `    apply(context) {
      const quarantine = (value, pointer, keyName) => {`,
    `    apply(context) {
      globalThis.__ncM080Pass = (globalThis.__ncM080Pass || 0) + 1;
      if (globalThis.__ncM080Pass % 2 === 0) return;
      const quarantine = (value, pointer, keyName) => {`,
  ]],
  defect: () => {
    const first = preview("secret-traps.json");
    const second = preview("secret-traps.json");
    assert.notStrictEqual(first.serialized, second.serialized, "receipt: the same input produced two different documents");
    assert.notStrictEqual(first.report.diagnostics.length, second.report.diagnostics.length, "receipt: and two different warning sets");
    assert(second.serialized.includes("sk-should-never-be-serialised"), "receipt: with a credential in the second one");
  },
  guarded: () => {
    const first = preview("secret-traps.json");
    const second = preview("secret-traps.json");
    assert.strictEqual(first.serialized, second.serialized, "migration is not byte-deterministic");
    assert.deepStrictEqual(first.report.diagnostics, second.report.diagnostics, "the warning set is not deterministic");
  },
});
delete globalThis.__ncM080Pass;

/* ===========================================================================
   26-30. M022 provenance: a mint says where it came from, or does not claim to.

   M022 reads a shot dependency out of English prose. It has always known which
   sentence it read - the accounting claim names it - but it minted the relation
   with `sourcePath: null`, a field present and carrying nothing. The five
   controls below cover the five ways that can come back: the null itself, the
   over-correction that drops known paths, the false provenance that fills the
   gap from the destination, the blank string standing in for "unknown", and the
   neighbouring provenance lost while fixing the one field. */

const m022Provenance = () => {
  const prose = preview("prose-dependency.json");
  const mints = prose.report.minted.filter((mint) => mint.type === "relation");
  assert.strictEqual(mints.length, 2, "two readings of two different sentences");
  for (const mint of mints) {
    assert(Object.prototype.hasOwnProperty.call(mint, "sourcePath"),
      `${mint.mintedId}: a source path this rule knew was dropped rather than recorded`);
    assert(typeof mint.sourcePath === "string" && mint.sourcePath.trim() !== "",
      `${mint.mintedId}: sourcePath is ${JSON.stringify(mint.sourcePath)}; unknown provenance is spelled by omitting the field, never by a blank value`);
    assert(mint.sourcePath.startsWith("/"),
      `${mint.mintedId}: ${JSON.stringify(mint.sourcePath)} is not a JSON pointer into the source document`);
    assert(mint.parentSubject, `${mint.mintedId}: the mint no longer says what it was minted under`);
  }
  assert.deepStrictEqual(mints.map((mint) => mint.sourcePath).sort(), ["/shots/0/desc", "/shots/0/notes"],
    "each relation must name the sentence it was actually read from");
  const claims = prose.report.accounting.entries.filter((entry) => entry.rule === "M022");
  assert.strictEqual(claims.length, 2, "the accounting claim for each sentence survives");
  for (const claim of claims)
    assert.strictEqual(claim.disposition, "stated", "a reading is a guess, not a mapping");
};

/* NC-A. The original defect, reassembled from both halves: the mint writer stops
   omitting an unknown path, and the inferential branch stops passing the one it
   has. Both live in ofp-migrate.js, so one patched module reproduces exactly what
   P3 pinned. */
control({
  id: "NC-P2-26",
  label: "minting a prose-read relation with sourcePath: null",
  guards: "no mint carries a present-but-empty source path",
  module: "ofp/ofp-migrate.js",
  edits: [
    [`    if (nonEmptyString(sourcePath)) mint.sourcePath = sourcePath;`,
     `    mint.sourcePath = sourcePath;`],
    [`    this.recordMint({ sourcePath: pointer, type: "relation", parentSubject: shot.subject, mintedId: id });`,
     `    this.recordMint({ sourcePath: claimSource ? pointer : null, type: "relation", parentSubject: shot.subject, mintedId: id });`],
  ],
  defect: () => {
    const mints = preview("prose-dependency.json").report.minted.filter((mint) => mint.rule === "M022");
    assert.strictEqual(mints.length, 2, "receipt: the relations are still minted");
    for (const mint of mints) {
      assert(Object.prototype.hasOwnProperty.call(mint, "sourcePath"), "receipt: the field is present");
      assert.strictEqual(mint.sourcePath, null, "receipt: and its value is null - the defect itself, observed in migrated output");
    }
    assert(mints.every((mint) => mint.sourcePath !== undefined),
      "receipt: so a `!== undefined` test would pass while no provenance is recorded at all");
  },
  guarded: m022Provenance,
});

/* NC-B. The lazy fix: stop emitting the field entirely. The null is gone and so
   is every real source path, including M021's and M060's, which were never
   wrong. */
control({
  id: "NC-P2-27",
  label: "solving the null by dropping every source path, known ones included",
  guards: "a mint that knows where it came from still records it",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `    if (nonEmptyString(sourcePath)) mint.sourcePath = sourcePath;`,
    `    void sourcePath;`,
  ]],
  defect: () => {
    const prose = preview("prose-dependency.json");
    assert(prose.report.minted.length > 0, "receipt: mints are still produced");
    assert(prose.report.minted.every((mint) => !Object.prototype.hasOwnProperty.call(mint, "sourcePath")),
      "receipt: and not one of them says where it came from");
    const missing = preview("missing-ids.json");
    assert(missing.report.minted.length >= 5, "receipt: including the deterministic identity mints");
    assert(missing.report.minted.every((mint) => mint.sourcePath === undefined),
      "receipt: whose source paths were never in doubt and are now gone too");
  },
  guarded: m022Provenance,
});

/* NC-C. The dangerous fix: fill the gap from where the record now lives. It
   removes the null and replaces missing provenance with false provenance, which
   is strictly worse - nothing downstream can tell it from a real reading. */
control({
  id: "NC-P2-28",
  label: "filling an unknown source path from the destination the record now lives at",
  guards: "a source path is a pointer into the source document, never the address it migrated to",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `    this.recordMint({ sourcePath: pointer, type: "relation", parentSubject: shot.subject, mintedId: id });`,
    `    this.recordMint({ sourcePath: claimSource ? pointer : \`\${shot.subject}#/relations\`, type: "relation", parentSubject: shot.subject, mintedId: id });`,
  ]],
  defect: () => {
    const mints = preview("prose-dependency.json").report.minted.filter((mint) => mint.rule === "M022");
    assert.strictEqual(mints.length, 2, "receipt: the relations are still minted");
    for (const mint of mints)
      assert.strictEqual(mint.sourcePath, "shot:L0-01#/relations",
        "receipt: every reading now claims to come from the place it was written to");
    assert.strictEqual(new Set(mints.map((mint) => mint.sourcePath)).size, 1,
      "receipt: and two different sentences have become one indistinguishable origin");
  },
  guarded: m022Provenance,
});

/* NC-D. The other wrong spelling of "unknown": a blank string. It satisfies a
   presence check and a `!== null` check while carrying no more information than
   the null did. */
control({
  id: "NC-P2-29",
  label: "spelling an unknown source path as an empty string instead of omitting it",
  guards: "unknown provenance is an absent field, not a blank value",
  module: "ofp/ofp-migrate.js",
  edits: [
    [`    if (nonEmptyString(sourcePath)) mint.sourcePath = sourcePath;`,
     `    mint.sourcePath = nonEmptyString(sourcePath) ? sourcePath : "";`],
    [`    this.recordMint({ sourcePath: pointer, type: "relation", parentSubject: shot.subject, mintedId: id });`,
     `    this.recordMint({ sourcePath: claimSource ? pointer : null, type: "relation", parentSubject: shot.subject, mintedId: id });`],
  ],
  defect: () => {
    const mints = preview("prose-dependency.json").report.minted.filter((mint) => mint.rule === "M022");
    assert.strictEqual(mints.length, 2, "receipt: the relations are still minted");
    for (const mint of mints) {
      assert.strictEqual(mint.sourcePath, "", "receipt: the field is present and blank - the defect, observed in migrated output");
      assert.notStrictEqual(mint.sourcePath, null, "receipt: so a null-only test would pass");
      assert.notStrictEqual(mint.sourcePath, undefined, "receipt: and so would a presence test");
    }
  },
  guarded: m022Provenance,
});

/* NC-E. Fixing the one field and quietly taking a neighbour with it. The source
   path is correct and the mint no longer says what it was minted under, so a
   test that only looked at `sourcePath` would call this a success. */
control({
  id: "NC-P2-30",
  label: "recording the source path while dropping the subject the record was minted under",
  guards: "fixing one provenance field does not cost a neighbouring one",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `    mint.parentSubject = parentSubject;`,
    `    void parentSubject;`,
  ]],
  defect: () => {
    const mints = preview("prose-dependency.json").report.minted.filter((mint) => mint.rule === "M022");
    assert.strictEqual(mints.length, 2, "receipt: the relations are still minted");
    assert.deepStrictEqual(mints.map((mint) => mint.sourcePath).sort(), ["/shots/0/desc", "/shots/0/notes"],
      "receipt: with correct source paths, so the field this batch fixed looks right");
    assert(mints.every((mint) => mint.parentSubject === undefined),
      "receipt: while the subject each was minted under went silently");
  },
  guarded: m022Provenance,
});

/* ===========================================================================
   The process must end on the real modules, not the patched ones. */
for (const key of Object.keys(require.cache)) if (key.startsWith(OFP_DIR)) delete require.cache[key];
{
  const real = preview("clean.json");
  assert.strictEqual(real.ok, true, "the real modules must be back in place");
  assert.strictEqual(statementsOf(real).length, 0);
  assert.deepStrictEqual(preview("missing-ids.json").candidate.shots.map((shot) => shot.id), ["INT-1->2", "INT-2->3"]);
  assert.strictEqual(require("../ofp/ofp-migrate").MIGRATION_STATEMENT_KINDS.includes("approved"), false);
}

assert.strictEqual(results.length, 30, "every control must have run");
console.log(`OFP P2 migration negative controls passed: ${results.length} defects reintroduced, each observed live by a probe and then caught by the property it guards.`);
for (const entry of results) console.log(`  ${entry.id.padEnd(10)} ${entry.label}\n             caught by: ${entry.guards}\n             failure:   ${entry.outcome}`);

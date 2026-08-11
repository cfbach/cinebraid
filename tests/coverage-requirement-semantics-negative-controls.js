/* Negative controls for P4-SEM-A canonical coverage requirement semantics.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * below reintroduces exactly one of the defects this batch exists to remove —
 * a surface reading the legacy boolean alone, a contract that ignores legacy
 * input, `required: false` being read as the more specific "not required", the
 * writer maintaining two encodings again, a primary image silently satisfying a
 * named view, character coverage failing to reach the canonical document, a
 * stored coverage rollup, and a legacy project being canonicalised merely by
 * being opened — and asserts that the guarding suite FAILS.
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Node modules are
 *   patched by compiling a modified copy IN MEMORY; the shipped browser scripts
 *   are patched through the render harness's `mutateSource` hook, which mutates
 *   the string it is about to evaluate and never the file. A broad `git checkout`
 *   can therefore never be the thing that undoes a control.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt:
 *   each anchor must exist, must be unique, and must actually change the source,
 *   and the DEFECT ITSELF must be observed through a behavioural probe before the
 *   guarded suite's failure is allowed to count as detection. A control whose
 *   anchor has gone stale reports itself as stale rather than passing quietly.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE, for the same reasons as the positive
 * suite: the render harness stubs fetch, and the one real server runs against a
 * temporary projects root with no credentials.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
/* Normalised to LF before matching. Anchors span lines, and on a Windows checkout
   with core.autocrlf on they would arrive as \r\n — the anchor would not match,
   the control would report itself as stale, and the failure would look like a
   source change rather than a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* Everything a patch may invalidate, including the positive suite itself: it
   captures its module references at require time, so a stale copy would exercise
   the real code and the control would report a false pass. */
const IN_SCOPE = [
  path.join(PUBLIC, "shared-coverage.js"),
  path.join(ROOT, "ofp", "ofp-migrate-rules.js"),
  path.join(ROOT, "ofp", "ofp-migrate.js"),
  path.join(__dirname, "coverage-requirement-semantics.js"),
];
const inScope = (key) => IN_SCOPE.includes(key);

function applyEdits(label, original, edits) {
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${label}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${label}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${label}; the control would test the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${label} was not modified at all`);
  return code;
}

function evict() {
  for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
}

/* Compile a modified copy of a Node module IN MEMORY, install it in the cache,
   run, restore. Every in-scope module is evicted first so the positive suite
   resolves to the patched copy rather than the one it captured at require time. */
async function patchedModule(relative, edits, run) {
  const file = require.resolve(path.join(ROOT, relative));
  const code = applyEdits(relative, readLF(file), edits);
  const saved = new Map();
  for (const key of Object.keys(require.cache)) if (inScope(key)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const copy = new Module(file, module);
    copy.filename = file;
    copy.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = copy;
    copy._compile(code, file);
    copy.loaded = true;
    return await run();
  } finally {
    evict();
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

/* The same edits, applied to the shipped browser scripts as the render harness
   evaluates them. `applied` is the receipt that the file was actually reached —
   a typo in a filename would otherwise mutate nothing and look like a pass. */
function sourceMutator(editsByFile) {
  const applied = new Set();
  const mutate = (file, original) => {
    const edits = editsByFile[file];
    if (!edits) return original;
    applied.add(file);
    return applyEdits(file, original.replace(/\r\n/g, "\n"), edits);
  };
  mutate.applied = applied;
  mutate.expected = Object.keys(editsByFile);
  return mutate;
}

/* The positive suite, freshly compiled against whatever is currently in the
   cache. Only the suite itself is dropped: evicting the whole in-scope set here
   would delete the module patchedModule() just installed and quietly restore the
   real code. */
function freshSuite() {
  delete require.cache[path.join(__dirname, "coverage-requirement-semantics.js")];
  return require("./coverage-requirement-semantics");
}

/* Did the guarded phase actually fail? An assertion failure is detection; any
   other error is the control breaking, and is reported as such. */
async function expectRed(label, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message.split("\n")[0];
    throw new Error(`${label}: the guard threw something that is not an assertion failure, so this is not a valid receipt:\n${error.stack || error.message}`);
  }
  throw new Error(`${label}: the guarded suite PASSED with the defect reintroduced. The regression test does not detect it.`);
}

const results = [];
async function control({ id, defect, mutatesModule, mutatesBrowser, probe, guard }) {
  const mutate = mutatesBrowser ? sourceMutator(mutatesBrowser) : null;
  const body = async () => {
    const suite = freshSuite();
    /* The probe must OBSERVE the reintroduced defect. Without this receipt an
       anchor that silently stopped matching, or a patch that changed nothing that
       runs, would throw somewhere unrelated and be counted as the guard working. */
    await probe(suite, mutate);
    const detected = await expectRed(id, () => guard(suite, mutate));
    if (mutate)
      for (const file of mutate.expected)
        assert(mutate.applied.has(file), `${id}: ${file} was never evaluated, so the browser-side defect never ran`);
    results.push({ id, defect, detected });
  };
  if (mutatesModule) await patchedModule(mutatesModule.file, mutatesModule.edits, body);
  else await body();
}

/* A location carrying the mixed example, which is the shape every count-based
   control is measured against. */
function mixedProject(suite) {
  const { buildFixture } = require("./render-harness");
  const project = buildFixture();
  const location = project.locations[0];
  location.coverageSlots = suite.MIXED.map((slot) => ({ ...slot }));
  return { project, locationId: location.id };
}

async function main() {
  /* ---------------------------------------------------------------- NC-A
     A major surface reads the legacy boolean alone again — the exact line
     public/focused-workspaces.js used to carry. */
  await control({
    id: "NC-A",
    defect: "the Reference Inspector counts required views from the legacy boolean alone",
    mutatesBrowser: {
      "focused-workspaces.js": [[
        `    const summary = window.summariseCoverage ? window.summariseCoverage(slots) : { required: 0, approvedRequired: 0 };
    return { required: summary.required, approved: summary.approvedRequired };`,
        `    const required = slots.filter((slot) => slot.required !== false);
    return { required: required.length, approved: required.filter((slot) => slot.approvedFile).length };`,
      ]],
    },
    probe: async (suite, mutate) => {
      const { project, locationId } = mixedProject(suite);
      const seen = await suite.renderedCoverage(project, "locations", locationId, { mutateSource: mutate });
      assert.notStrictEqual(seen.inspector.required, seen.board.required,
        "NC-A probe: the inspector was expected to disagree with the coverage board");
      assert.strictEqual(seen.inspector.required, 8,
        "NC-A probe: reading the boolean alone counts every slot, because none of them carries one any more");
    },
    guard: (suite, mutate) => suite.surfacesSection({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-B
     The contract stops reading legitimate legacy input: the boolean is ignored,
     so a project written before the enum existed loses its declared intent. */
  await control({
    id: "NC-B",
    defect: "the canonical contract ignores legacy boolean input entirely",
    mutatesModule: {
      file: "public/shared-coverage.js",
      edits: [[
        `    if (declared) return { requirement: declared, source: "declared", declared, unknown, legacy };
    if (legacy === false) return { requirement: LEGACY_FALSE_REQUIREMENT, source: "legacy-boolean", declared: "", unknown, legacy };
    if (legacy === true) return { requirement: LEGACY_TRUE_REQUIREMENT, source: "legacy-boolean", declared: "", unknown, legacy };`,
        `    if (declared) return { requirement: declared, source: "declared", declared, unknown, legacy };`,
      ]],
    },
    probe: () => {
      const Coverage = require("../public/shared-coverage");
      assert.strictEqual(Coverage.coverageRequirement({ required: false }), "required",
        "NC-B probe: a legacy planned view was expected to read as required once the boolean is ignored");
      assert.strictEqual(Coverage.requirementTrace({ required: false }).source, "unspecified",
        "NC-B probe: and the boolean it carries is no longer consulted at all");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-C
     `required: false` is read as the more specific "not required" — the exact
     mapping the migration used to make, and the one the brief warns against.
     Nothing in the repository justifies it: the boolean is what every template
     seeds for an offered-but-not-demanded view. */
  await control({
    id: "NC-C",
    defect: "a legacy `required: false` is translated to not-required rather than planned",
    mutatesModule: {
      file: "public/shared-coverage.js",
      edits: [[`  const LEGACY_FALSE_REQUIREMENT = "planned";`, `  const LEGACY_FALSE_REQUIREMENT = "not-required";`]],
    },
    probe: () => {
      const Coverage = require("../public/shared-coverage");
      assert.strictEqual(Coverage.coverageRequirement({ required: false }), "not-required",
        "NC-C probe: the boolean now manufactures a specificity it cannot carry");
      const { previewLegacyMigration } = require("../ofp/ofp-migrate");
      const migrated = previewLegacyMigration(
        JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ofp-legacy", "character-coverage.json"), "utf8")),
        { at: "2026-08-11T00:00:00.000Z" },
      );
      const rear = migrated.candidate.entities.characters.find((row) => row.id === "CHAR-LEGACY").coverage.find((row) => row.id === "rear");
      assert.strictEqual(rear.requirement, "not-required",
        "NC-C probe: and the invention reaches the canonical document, which is where it would become permanent");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-D
     The writer maintains two independently authored encodings again — the
     arrangement that let an importer, a hand edit or an older build reintroduce
     the disagreement one field at a time. */
  await control({
    id: "NC-D",
    defect: "a canonical write maintains the enum AND the boolean",
    mutatesModule: {
      file: "public/shared-coverage.js",
      edits: [[
        `    slot.requirement = next;
    delete slot.required;`,
        `    slot.requirement = next;
    slot.required = next === "required";`,
      ]],
    },
    probe: () => {
      const Coverage = require("../public/shared-coverage");
      const slot = { id: "rear" };
      Coverage.writeCoverageRequirement(slot, "planned");
      assert.strictEqual(slot.required, false, "NC-D probe: the retired boolean is being authored again");
      assert.deepStrictEqual(Object.keys(slot).sort(), ["id", "required", "requirement"],
        "NC-D probe: one fact, two independently written homes");
    },
    guard: (suite) => suite.writerSection(),
  });

  /* ---------------------------------------------------------------- NC-E
     An approved primary identity image is silently seeded into a required view
     while the project is merely being opened, so an entity that has done no
     coverage work reports one view complete. */
  await control({
    id: "NC-E",
    defect: "an approved primary image automatically satisfies a required view",
    mutatesBrowser: {
      "app.js": [[
        `        next.approvedFile = String(next.approvedFile || "");
        next.notes = String(next.notes || "");`,
        `        next.approvedFile = String(next.approvedFile || "");
        if (!next.approvedFile && entity.approvedFile && templateRequirement(true) === coverageRequirement(next)) next.approvedFile = String(entity.approvedFile);
        next.notes = String(next.notes || "");`,
      ]],
    },
    probe: async (suite, mutate) => {
      const { buildFixture } = require("./render-harness");
      const project = buildFixture();
      const character = project.characters[0];
      character.approvedFile = "KAI-PRIMARY.png";
      character.coverageSlots = [
        { id: "front", label: "Front", requirement: "required", approvedFile: "", notes: "", status: "missing" },
        { id: "profile", label: "Profile", requirement: "required", approvedFile: "", notes: "", status: "missing" },
      ];
      const seen = await suite.renderedCoverage(project, "characters", character.id, { mutateSource: mutate });
      assert(seen.board.approvedRequired > 0,
        "NC-E probe: the primary image was expected to start counting as completed coverage");
      assert(seen.stored.some((slot) => slot.approvedFile === "KAI-PRIMARY.png"),
        "NC-E probe: and to have been written into a named view nobody assigned it to");
    },
    guard: (suite, mutate) => suite.surfacesSection({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-F
     Character coverage stops reaching the canonical document: M008 goes back to
     parking it in the legacy extension, so a character round-trips as an opaque
     blob no other client can read. */
  await control({
    id: "NC-F",
    defect: "character coverage is lost from the canonical document on the way through",
    mutatesModule: {
      file: "ofp/ofp-migrate-rules.js",
      edits: [[
        `        if (list.length === 0) { context.claim(listPointer, DISPOSITION.MAPPED, [\`\${entity.subject}#/coverage\`], "explicitly empty collection, preserved as empty"); entity.record.coverage = []; continue; }`,
        `        if (entity.type === "character") {
          context.claimSubtree(listPointer, DISPOSITION.PRESERVED, ["#/extensions/com.cinebraid.legacy/preserved"], "characters have no coverage container");
          context.preserveValue(listPointer, "character coverage slots", { alreadyClaimed: true });
          continue;
        }
        if (list.length === 0) { context.claim(listPointer, DISPOSITION.MAPPED, [\`\${entity.subject}#/coverage\`], "explicitly empty collection, preserved as empty"); entity.record.coverage = []; continue; }`,
      ]],
    },
    probe: () => {
      const { previewLegacyMigration } = require("../ofp/ofp-migrate");
      const migrated = previewLegacyMigration(
        JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ofp-legacy", "character-coverage.json"), "utf8")),
        { at: "2026-08-11T00:00:00.000Z" },
      );
      const mara = migrated.candidate.entities.characters.find((row) => row.id === "CHAR-MARA");
      assert.strictEqual(mara.coverage, undefined,
        "NC-F probe: the character's declared view requirements no longer reach core");
      assert(JSON.stringify(migrated.candidate.extensions || {}).includes("detail-face"),
        "NC-F probe: they survive only as an opaque preserved blob");
      /* And the loss is not merely undetected — it is now UNEXPLAINED. Removing
         the M008 count adjustment was part of this batch, so a rule that quietly
         stops producing coverage records can no longer point at a declaration
         that says it meant to. */
      assert.strictEqual(migrated.report.counts.reconciled, false,
        "NC-F probe: the count reconciliation sees coverage records disappear with no rule declaring it");
    },
    guard: (suite) => suite.ofpSection(),
  });

  /* ---------------------------------------------------------------- NC-G
     A derived count is persisted beside the facts it came from, so the project
     now carries a rollup that can disagree with its own slots. */
  await control({
    id: "NC-G",
    defect: "a coverage rollup is stored on the entity",
    mutatesBrowser: {
      "entities.js": [[
        `function coverageStats(slots) {
  return summariseCoverage(slots);
}`,
        `function coverageStats(slots) {
  const summary = summariseCoverage(slots);
  for (const list of ["characters", "locations", "props", "vehicles"])
    for (const entity of P[list] || [])
      if (entity.coverageSlots === slots) entity.coverageSummary = { totalRequired: summary.required, completedRequired: summary.approvedRequired };
  return summary;
}`,
      ]],
    },
    probe: async (suite, mutate) => {
      const { project, locationId } = mixedProject(suite);
      const seen = await suite.renderedCoverage(project, "locations", locationId, { mutateSource: mutate });
      assert(seen.entity.coverageSummary, "NC-G probe: a rollup was persisted onto the entity");
      assert.strictEqual(seen.entity.coverageSummary.totalRequired, 2,
        "NC-G probe: and it is a frozen copy of a number the slots already answer");
    },
    guard: (suite, mutate) => suite.surfacesSection({ mutateSource: mutate }),
  });

  /* ---------------------------------------------------------------- NC-H
     Opening a legacy project canonicalises it: the template's requirement is
     minted onto stored slots that never carried one. This is the load-time
     rewrite P0 §8 rule 1 forbids, and it is the shape the pre-fix defect took —
     the old line minted the template's BOOLEAN, which is what then made the two
     screens disagree. */
  await control({
    id: "NC-H",
    defect: "merely opening a project writes canonicalised requirement data into it",
    mutatesBrowser: {
      "app.js": [[
        `  const merged = { ...base, ...(prior || {}) };
  if (!("requirement" in merged) && !("referenceRequirement" in merged) && !("required" in merged)) merged.requirement = seeded;
  return merged;`,
        `  const merged = { ...base, ...(prior || {}) };
  merged.requirement = coverageRequirement(merged);
  delete merged.required;
  return merged;`,
      ]],
    },
    probe: async (suite, mutate) => {
      const { buildFixture } = require("./render-harness");
      const project = buildFixture();
      const prop = project.props[0];
      prop.coverageSlots = [
        { id: "hero", label: "Front / hero", required: true, approvedFile: "", notes: "", status: "missing" },
        { id: "top", label: "Top", required: false, approvedFile: "", notes: "", status: "missing" },
      ];
      const seen = await suite.renderedCoverage(project, "props", prop.id, { mutateSource: mutate });
      const stored = Object.fromEntries(seen.stored.map((slot) => [slot.id, slot]));
      assert.strictEqual(stored.hero.requirement, "required",
        "NC-H probe: a canonical value was minted onto a slot that only ever stored a boolean");
      assert(!("required" in stored.top),
        "NC-H probe: and the stored encoding was rewritten, not merely read");
    },
    guard: (suite, mutate) => suite.surfacesSection({ mutateSource: mutate }),
  });

  /* Every control must have produced a receipt. */
  assert.strictEqual(results.length, 8, "every control must have run");
  for (const row of results) {
    assert(row.detected, `${row.id} produced no failure message`);
    console.log(`  ${row.id.padEnd(6)} detected: ${row.detected.slice(0, 110)}`);
  }
  console.log(`\nP4-SEM-A negative controls passed: ${results.length} defects reintroduced, ${results.length} caught, every one with a live-defect receipt. Nothing was written to disk and nothing was reverted with git. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

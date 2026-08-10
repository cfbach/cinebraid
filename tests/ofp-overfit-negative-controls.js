/* Negative controls for the OFP P3 sanitized Overfit corpus.
 *
 * Same discipline as P1 and P2, for a corpus with a second failure mode. A
 * migration suite can be wrong by not noticing a bad migration; a *fixture*
 * suite can also be wrong by sanitizing the hazard away and then passing
 * triumphantly on a corpus with nothing in it. Both directions are controlled
 * here: half of these break the sanitizer and half break the migrator.
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
const crypto = require("crypto");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const OFP_DIR = path.join(ROOT, "ofp");
const SCRIPTS_DIR = path.join(ROOT, "scripts");
const AT = "2026-08-10T00:00:00Z";

const model = () => require("../scripts/overfit-fixture-model");
const sanitizer = () => require("../scripts/overfit-sanitizer");
const migrateOf = (id) => model().migrateFixtureDocument(model().readFixture(id));
const isProseKey = (key) => sanitizer().PROSE_KEYS.has(key);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => JSON.stringify(value, null, 2);
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* The M021 loop header, used as the anchor by four controls. Quoted once so a
   change to that loop breaks all four visibly instead of one silently. */
const M021_LOOP = `      for (const shot of context.shots()) {
        for (const [field, kind] of [["parentShot", "part-of"], ["fallbackFor", "fallback-for"]]) {`;

const formatTarget = (statement) => require("../ofp/ofp-target").formatTargetString(statement.target);

/* A check that RUNS the build tool, as opposed to check:syntax, which only
   node --checks it. */
const RUNS_BUILDER = /(?:^|&&\s*)node\s+scripts\/build-overfit-golden-fixtures\.js/;
const regenerators = (scripts) => Object.entries(scripts)
  .filter(([name, body]) => name.startsWith("check") && RUNS_BUILDER.test(body))
  .map(([name]) => name);

const REAL_SCRIPTS = JSON.parse(readLF(path.join(ROOT, "package.json"))).scripts;
const MUTATED_SCRIPTS = { ...REAL_SCRIPTS, "check:ofp-overfit": "node scripts/build-overfit-golden-fixtures.js --goldens-only" };

const LATEST = "overfit-18-cinebraid-581";
const RELATIONS = "overfit-04-anchorhub-22";
const EARLIEST = "overfit-01-anchorhub-v1";

/* A small legacy document carrying the hazards the archive does and does not
   have. Used where a control needs a defect the real corpus cannot show it -
   no archived generation contains `[INFERRED FOR PLANNING]`, so the control
   that proves the marker is protected has to bring its own. */
const PROBE_SOURCE = () => ({
  meta: { title: "Probe reel one", version: "v2.1", hubVersion: "v4.7" },
  qcChecklist: [],
  characters: [{ id: "KAI", name: "Kai", notes: "A weary technician alone on a failing station." }],
  locations: [{ id: "LOC-HULL", name: "Hull", notes: "Exterior plate seen from the docking camera." }],
  props: [], vehicles: [],
  scenes: [{ id: "L0", title: "Opening" }],
  shots: [
    { id: "INT-1->2", scene: "L0", desc: "Interstitial card between the first and second logs.", dur: 2, codes: [], positioning: "held wide" },
    { id: "L0-01", scene: "L0", desc: "The station hangs in the dark. [INFERRED FOR PLANNING]", dur: 8,
      codes: ["LOC-HULL-A", "STAGE-3"], notes: "The clean bookend. L7-03 depends on this plate.", risks: [] },
    { id: "L7-03", scene: "L0", desc: "The third bookend layer, and the only one that is wrong.", dur: 6, codes: ["LOC-HULL-A"], risks: [] },
  ],
});

/* ---------------------------------------------------------------------------
   In-memory patching. Both the ofp/ and scripts/ caches are cleared, because a
   P3 defect may live in either and a dependent must pick up the patched copy. */
function patched(relative, edits, run) {
  const file = require.resolve(path.join(ROOT, relative));
  /* Normalised to LF before matching. Anchors span lines, and on a Windows
     checkout with core.autocrlf on they would arrive as \r\n - so the anchor
     would not match, the control would report itself as stale, and the failure
     would look like a source change rather than a line ending. */
  const original = readLF(file);
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${relative}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${relative}; the control would test the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${relative} was not modified at all`);

  const inScope = (key) => key.startsWith(OFP_DIR) || key.startsWith(SCRIPTS_DIR);
  const saved = new Map();
  for (const key of Object.keys(require.cache))
    if (inScope(key)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const copy = new Module(file, module);
    copy.filename = file;
    copy.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = copy;
    copy._compile(code, file);
    copy.loaded = true;
    return run({ patchedSource: code, originalSource: original });
  } finally {
    for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

const results = [];

function control({ id, label, guards, module: relative, edits, defect, guarded, expect = assert.AssertionError }) {
  const run = (context = {}) => {
    let observed = false;
    if (defect) { defect(context); observed = true; }
    let detected = null;
    try {
      guarded();
    } catch (error) {
      /* `expect` may be a class or a class NAME, because patching clears the
         whole cache and a class defined in ofp/ or scripts/ is re-created inside
         the patched context - so `instanceof` against the outer copy is false
         even though the error is exactly the right one. */
      const matches = typeof expect === "string" ? error.name === expect : error instanceof expect;
      if (!matches) throw error;
      detected = error;
    }
    assert(detected, `NEGATIVE CONTROL ${id} FAILED: with "${label}" reintroduced, "${guards}" still passed. That test cannot detect the defect it exists for.`);
    assert(observed || !defect, `NEGATIVE CONTROL ${id}: the defect probe did not run`);
    results.push({ id, label, guards, outcome: String(detected.message).split("\n")[0].slice(0, 96) });
  };
  if (relative) patched(relative, edits, run);
  else run();
}

/* The sanitization gate, run the way the build tool runs it. */
const gateOn = (document) => {
  const S = sanitizer();
  return model().verifySanitization("probe", document, S.sanitizeDocument(document).document, (key) => S.PROSE_KEYS.has(key));
};

/* ===========================================================================
   PART ONE - the sanitizer must not delete the hazards it is preserving. */

/* 1. An ambiguous code is the single most valuable token in the corpus. */
control({
  id: "NC-P3-01",
  label: "the sanitizer trimming the suffix off an ambiguous code",
  guards: "the hazard census is identical before and after sanitization",
  module: "scripts/overfit-sanitizer.js",
  edits: [[
    `    if (typeof value !== "string" || !value) return value;

    if (hasOpaqueSegment(value)) {`,
    `    if (typeof value !== "string" || !value) return value;
    if (key === "codes") return value.replace(/-[A-Z]$/, "");

    if (hasOpaqueSegment(value)) {`,
  ]],
  expect: "FixtureGateError",
  defect: () => {
    const sanitized = sanitizer().sanitizeDocument(PROBE_SOURCE()).document;
    assert(sanitized.shots[1].codes.includes("LOC-HULL"), "receipt: the suffix has actually been trimmed");
    assert(!sanitized.shots[1].codes.includes("LOC-HULL-A"), "receipt: and the ambiguous token is gone");
  },
  guarded: () => gateOn(PROBE_SOURCE()),
});

/* 2. The marker no archived generation carries. The corpus cannot demonstrate
   this one, so the control brings a document that can - which is the honest
   way to guard a rule the real data never reaches. */
control({
  id: "NC-P3-02",
  label: "the sanitizer rewriting [INFERRED FOR PLANNING] as ordinary prose",
  guards: "the hazard census is identical before and after sanitization",
  module: "scripts/overfit-sanitizer.js",
  edits: [[
    `  if (staged.includes(INFERRED_MARKER)) staged = staged.split(INFERRED_MARKER).join(hold(INFERRED_MARKER));`,
    `  /* defect: the marker is no longer lifted out, so the tokenizer eats it */`,
  ]],
  expect: "FixtureGateError",
  defect: () => {
    const source = PROBE_SOURCE();
    assert(source.shots[1].desc.includes("[INFERRED FOR PLANNING]"), "receipt: the probe carries the marker");
    const sanitized = sanitizer().sanitizeDocument(source).document;
    assert(!sanitized.shots[1].desc.includes("[INFERRED FOR PLANNING]"), "receipt: sanitization destroyed it");
  },
  guarded: () => gateOn(PROBE_SOURCE()),
});

/* 3. Tidying `INT-1->2` into something portable is the exact cosmetic rename the
   two-tier identifier rule exists to prevent. */
control({
  id: "NC-P3-03",
  label: "the sanitizer normalising a non-portable identifier",
  guards: "the hazard census is identical before and after sanitization",
  module: "scripts/overfit-sanitizer.js",
  edits: [[
    `    if (typeof value !== "string" || !value) return value;

    if (hasOpaqueSegment(value)) {`,
    `    if (typeof value !== "string" || !value) return value;
    if (key === "id") return value.replace(/->/g, "-to-");

    if (hasOpaqueSegment(value)) {`,
  ]],
  expect: "FixtureGateError",
  defect: () => {
    const sanitized = sanitizer().sanitizeDocument(PROBE_SOURCE()).document;
    assert.strictEqual(sanitized.shots[0].id, "INT-1-to-2", "receipt: the identifier has been renamed");
  },
  guarded: () => gateOn(PROBE_SOURCE()),
});

/* 4. An unknown legacy field is what M070 exists for. A fixture that dropped one
   would test the sweep against nothing. */
control({
  id: "NC-P3-04",
  label: "the sanitizer discarding a legacy field it does not model",
  guards: "the sanitized document has exactly the source's leaves, in order",
  module: "scripts/overfit-sanitizer.js",
  edits: [[
    `      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);`,
    `      for (const [k, v] of Object.entries(value)) { if (k === "positioning") continue; out[k] = walk(v, k); }`,
  ]],
  expect: "FixtureGateError",
  defect: () => {
    const sanitized = sanitizer().sanitizeDocument(PROBE_SOURCE()).document;
    assert.strictEqual(sanitized.shots[0].positioning, undefined, "receipt: the unmodelled field is gone");
  },
  guarded: () => gateOn(PROBE_SOURCE()),
});

/* 5. Array order is migration semantics: `order` is minted from array position
   exactly once, and reordering rewrites the film. */
control({
  id: "NC-P3-05",
  label: "the sanitizer reordering an array",
  guards: "the sanitized document has exactly the source's leaves, in order",
  module: "scripts/overfit-sanitizer.js",
  edits: [[
    `    if (Array.isArray(value)) return value.map((item) => walk(item, key));`,
    `    if (Array.isArray(value)) return value.map((item) => walk(item, key)).reverse();`,
  ]],
  expect: "FixtureGateError",
  defect: () => {
    const sanitized = sanitizer().sanitizeDocument(PROBE_SOURCE()).document;
    assert.strictEqual(sanitized.shots[0].id, "L7-03", "receipt: the shots came back in the wrong order");
  },
  guarded: () => gateOn(PROBE_SOURCE()),
});

/* 16. Sanitization must be a function of the source and nothing else. Listed
   here because it is a sanitizer control, numbered as the brief numbers it. */
control({
  id: "NC-P3-16",
  label: "the sanitizer drawing a pseudo-word from a random source",
  guards: "sanitizing the same document twice produces the same bytes",
  module: "scripts/overfit-sanitizer.js",
  edits: [[
    `  const digest = crypto.createHash("sha256").update(\`\${SALT} \${word.toLowerCase()}\`).digest();
  let out = "";`,
    `  const digest = crypto.randomBytes(32);
  let out = "";`,
  ]],
  defect: () => {
    assert.notStrictEqual(sanitizer().pseudoWord("station"), sanitizer().pseudoWord("station"),
      "receipt: the same word now sanitizes two different ways");
  },
  guarded: () => {
    const first = stable(sanitizer().sanitizeDocument(PROBE_SOURCE()).document);
    const second = stable(sanitizer().sanitizeDocument(PROBE_SOURCE()).document);
    assert.strictEqual(first, second, "sanitization must be deterministic");
  },
});

/* ===========================================================================
   PART TWO - what may never reach a committed file.

   These two guard the scanner rather than the corpus. The committed fixtures are
   clean, so scanning them proves nothing about whether the scanner works; what
   has to hold is that a file which *did* leak would be refused. Each control
   removes one pattern, shows the weakened scanner accepting the leak, and then
   requires the refusal to fail. */

const LEAKED_PATH = stable({ sourceRelative: "D:\\Projects\\Overfit\\app_archive\\anchor-hub\\project.json" });
const LEAKED_KEY = stable({ meta: { falApiKey: "sk-live-0000" } });

/* 14. A fixture that records the drive it was built from leaks the machine. */
control({
  id: "NC-P3-14",
  label: "the privacy scan no longer recognising an absolute source path",
  guards: "no committed fixture may carry a drive-qualified path",
  module: "scripts/overfit-fixture-model.js",
  edits: [[
    `  { name: "a drive-qualified absolute path", pattern: /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\\\/]{1,2}[A-Za-z0-9._-]/ },`,
    `  /* defect: the drive-qualified path pattern has been removed */`,
  ]],
  defect: () => {
    let refused = false;
    try { model().verifyPrivacy("probe", LEAKED_PATH); } catch { refused = true; }
    assert(!refused, "receipt: the weakened scan must actually accept a document naming the archive drive");
  },
  guarded: () => {
    assert.throws(() => model().verifyPrivacy("probe", LEAKED_PATH), /drive-qualified/,
      "a committed file naming the build machine's drive must be refused");
  },
});

/* 15. And the same for anything credential-shaped, checked on keys as well as
   values, because a key named `falApiKey` is the giveaway. */
control({
  id: "NC-P3-15",
  label: "the privacy scan no longer recognising a credential-named key",
  guards: "no committed fixture may carry credential-shaped data",
  module: "scripts/overfit-fixture-model.js",
  edits: [[
    `  { name: "a credential-named key", pattern: /"[A-Za-z0-9_]*(?:api[_-]?key|apikey|secret|password|passcode|passphrase|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer|private[_-]?key|credential)[A-Za-z0-9_]*"\\s*:/i },`,
    `  /* defect: the credential-named key pattern has been removed */`,
  ]],
  defect: () => {
    let refused = false;
    try { model().verifyPrivacy("probe", LEAKED_KEY); } catch { refused = true; }
    assert(!refused, "receipt: the weakened scan must actually accept a document carrying an API key");
  },
  guarded: () => {
    assert.throws(() => model().verifyPrivacy("probe", LEAKED_KEY), /credential-named key/,
      "a committed file carrying a credential-named field must be refused");
  },
});

/* 13. The archive is evidence. Every read runs inside the INV-R1 guard, and the
   guard is a mechanism rather than a promise. */
control({
  id: "NC-P3-13",
  label: "the fs guard letting a write through to the source archive",
  guards: "INV-R1: nothing may be written under the source root while it is read",
  module: "ofp/ofp-fs-guard.js",
  edits: [[
    `function withNoWritesUnder(root, work, { collectOnly = false } = {}) {
  const resolvedRoot = path.resolve(root);`,
    `function withNoWritesUnder(root, work, { collectOnly = false } = {}) {
  return { result: work(), attempts: [] };`,
  ]],
  defect: () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-p3-nc-"));
    const victim = path.join(base, "project.json");
    fs.writeFileSync(victim, "{}", "utf8");
    try {
      require("../ofp/ofp-fs-guard").withNoWritesUnder(base, () => fs.writeFileSync(path.join(base, "migration.log"), "x", "utf8"));
      assert(fs.existsSync(path.join(base, "migration.log")), "receipt: the write reached the archive unopposed");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
  guarded: () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-p3-nc-"));
    try {
      const { attempts } = require("../ofp/ofp-fs-guard").withNoWritesUnder(base, () => {
        try { fs.writeFileSync(path.join(base, "migration.log"), "x", "utf8"); } catch { /* the guard is expected to refuse */ }
      });
      assert(attempts.length > 0 || !fs.existsSync(path.join(base, "migration.log")),
        "a write under the guarded root must be refused or recorded");
      assert(!fs.existsSync(path.join(base, "migration.log")), "and must not land on disk");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
});

/* ===========================================================================
   PART THREE - the migrator, against the real corpus. */

/* 6. Longest-prefix matching is what the live build does and what silently
   discarded 28 of 45 measured tokens. Here it may be a candidate, never the
   answer. */
control({
  id: "NC-P3-06",
  label: "resolving the real LOC-HULL-A token by longest prefix and calling it the answer",
  guards: "a suffixed code in the archive produces a dispute and keeps its raw token",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `                target: { subject: shot.subject, path: "/setting" },
                kind: "disputed",`,
    `                target: { subject: shot.subject, path: "/setting" },
                kind: "cited",`,
  ]],
  defect: () => {
    const { result } = migrateOf(LATEST);
    const settings = (result.candidate.statements || []).filter((entry) => formatTarget(entry).endsWith("#/setting"));
    assert(settings.length > 0, "receipt: the setting statements are still being produced");
    assert(settings.every((entry) => entry.kind !== "disputed"),
      "receipt: the ambiguous location token now reads as settled fact rather than a dispute");
  },
  guarded: () => {
    const { result } = migrateOf(LATEST);
    const settingDisputes = (result.candidate.statements || [])
      .filter((entry) => entry.kind === "disputed" && formatTarget(entry).endsWith("#/setting"));
    assert(settingDisputes.length > 0,
      "LOC-HULL-A names a coverage view that does not exist; the longest-prefix reading must be one candidate of a dispute, never the answer");
  },
});

/* 7. A token that matches nothing is preserved, never dropped. */
control({
  id: "NC-P3-07",
  label: "dropping a code token that resolves to nothing",
  guards: "STAGE-3 survives in the legacy preservation block and is reported",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `  if (context.legacyUnmappedCodes.length) legacy.unmappedCodes = [...context.legacyUnmappedCodes].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : 1));`,
    `  /* defect: the unresolved raw tokens never reach the document */`,
  ]],
  defect: () => {
    const { result } = migrateOf(LATEST);
    const legacy = result.candidate.extensions["com.cinebraid.legacy"];
    assert.strictEqual((legacy.unmappedCodes || []).length, 0, "receipt: the unresolved tokens have been discarded");
  },
  guarded: () => {
    const { result } = migrateOf(LATEST);
    const legacy = result.candidate.extensions["com.cinebraid.legacy"];
    const codes = (legacy.unmappedCodes || []).map((entry) => entry.code);
    assert(codes.includes("STAGE-3"), "STAGE-3 resolves to nothing and must be preserved rather than dropped");
  },
});

/* 8. A migrator may not reach back into an earlier generation to refill a later
   one. `parentShot` is gone from v3 onward and must stay gone. */
control({
  id: "NC-P3-08",
  label: "fabricating a part-of relation from an identifier that merely looks like a child",
  guards: "migration invents no authored relation the source generation does not contain",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    M021_LOOP,
    `      for (const shot of context.shots()) {
        const others = context.shotIds().filter((other) => other !== shot.record.id);
        if (others.length)
          context.addRelation(shot, { kind: "part-of", targetShotId: others[0], note: "guessed by the control" }, null, null);
        for (const [field, kind] of [["parentShot", "part-of"], ["fallbackFor", "fallback-for"]]) {`,
  ]],
  defect: () => {
    const { result } = migrateOf(LATEST);
    const guessed = [];
    for (const shot of result.candidate.shots) for (const relation of shot.relations || []) if (relation.note === "guessed by the control") guessed.push(shot.id);
    assert(guessed.length > 0, "receipt: relations are now being invented in a generation whose source has none");
  },
  guarded: () => {
    for (const id of [LATEST, "overfit-11-hub-v4-0"]) {
      const { result } = migrateOf(id);
      for (const shot of result.candidate.shots)
        for (const relation of shot.relations || [])
          assert.notStrictEqual(relation.kind, "part-of", `${id}: migration fabricated a relation the source does not contain`);
    }
  },
});

/* 9. And the converse: where the relation IS authored, losing it is a migrator
   defect and not a historical one. */
control({
  id: "NC-P3-09",
  label: "failing to recover an authored parentShot that the source generation still has",
  guards: "anchor-hub-22's 32 authored relations all reach relations[]",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    M021_LOOP,
    `      for (const shot of context.shots()) {
        for (const [field, kind] of [["fallbackFor", "fallback-for"]]) {`,
  ]],
  defect: () => {
    const { result } = migrateOf(RELATIONS);
    const recovered = [];
    for (const shot of result.candidate.shots) for (const relation of shot.relations || []) if (relation.kind === "part-of") recovered.push(shot.id);
    assert(recovered.length < 31, `receipt: authored relations are being lost, ${recovered.length} of 31 survive`);
  },
  guarded: () => {
    const { result } = migrateOf(RELATIONS);
    const recovered = [];
    for (const shot of result.candidate.shots)
      for (const relation of shot.relations || []) if (relation.kind === "part-of" || relation.kind === "fallback-for") recovered.push(relation.kind);
    assert.strictEqual(recovered.length, 32, `authored relations must all be recovered: got ${recovered.length}`);
  },
});

/* 10. Approval is a human act. */
control({
  id: "NC-P3-10",
  label: "migration promoting its own reading to an approval",
  guards: "no generation in the corpus produces an approved statement",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `const MIGRATION_STATEMENT_KINDS = ["suggested", "disputed", "cited"];`,
    `const MIGRATION_STATEMENT_KINDS = ["suggested", "disputed", "cited", "approved"];`,
  ], [
    `      kind: draft.kind,`,
    `      kind: draft.kind === "suggested" ? "approved" : draft.kind,`,
  ]],
  defect: () => {
    const { result } = migrateOf(LATEST);
    assert((result.candidate.statements || []).some((entry) => entry.kind === "approved"),
      "receipt: migration is now approving its own guesses");
  },
  guarded: () => {
    for (const generation of model().GENERATIONS) {
      const { result } = migrateOf(generation.id);
      for (const statement of result.candidate.statements || [])
        assert.notStrictEqual(statement.kind, "approved", `${generation.id}: migration emitted an approval`);
    }
  },
});

/* 11. Release gate G4. A source value nobody claimed is the failure the whole
   accounting inversion exists to make impossible. */
control({
  id: "NC-P3-11",
  label: "letting the final sweep skip what no rule claimed",
  guards: "G4: every source value in every generation has a disposition",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `      for (const pointer of context.unaccounted())
        context.preserve(pointer, `,
    `      for (const pointer of [])
        context.preserve(pointer, `,
  ]],
  defect: () => {
    const { result } = migrateOf(LATEST);
    assert.strictEqual(result.report.accounting.entries.filter((entry) => entry.rule === "M070").length, 0,
      "receipt: the sweep now claims nothing");
    assert(result.report.accounting.unaccounted.length > 0,
      `receipt: and ${result.report.accounting.unaccounted.length} real source values are reaching the end with no disposition`);
  },
  guarded: () => {
    for (const generation of model().GENERATIONS) {
      const { result } = migrateOf(generation.id);
      assert.strictEqual(result.report.accounting.unaccounted.length, 0,
        `${generation.id}: ${result.report.accounting.unaccounted.length} source value(s) reached the end with no disposition`);
    }
  },
});

/* 12. The drift gate. A change in migration semantics must fail against the
   pinned golden rather than being absorbed. */
control({
  id: "NC-P3-12",
  label: "migration output changing without the golden being re-pinned",
  guards: "every generation still equals its pinned golden",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    `        context.preserve(pointer, \`no rule in this registry maps this value into \${context.formatId} \${context.contractVersion}; preserved verbatim so nothing is lost while the contract is incomplete\`);`,
    `        context.preserve(pointer, "drifted preservation note");`,
  ]],
  defect: () => {
    const { serialized } = migrateOf(EARLIEST);
    assert(serialized.includes("drifted preservation note"),
      "receipt: the migrated document now carries different content than the pinned run produced");
  },
  guarded: () => {
    const pinned = JSON.parse(readLF(path.join(model().FIXTURE_ROOT, "goldens", "summary.json")));
    const byId = new Map(pinned.goldens.map((entry) => [entry.id, entry]));
    for (const generation of model().GENERATIONS) {
      const golden = model().goldenFor(generation.id, model().readFixture(generation.id));
      assert.strictEqual(stable(golden), stable(byId.get(generation.id)), `${generation.id}: drifted from its pinned golden`);
    }
  },
});

/* A second drift control, on the bytes rather than the summary: the three full
   goldens must match what migration produces right now. */
control({
  id: "NC-P3-12b",
  label: "a full golden document drifting from what migration produces",
  guards: "the pinned OFP documents are byte-identical to the current output",
  module: "ofp/ofp-serialize.js",
  edits: [[
    `  return \`\${emit(DOCUMENT, document, 0)}\\n\`;`,
    `  return \`\${emit(DOCUMENT, document, 0)}\\n\\n\`;`,
  ]],
  defect: () => {
    const { serialized } = migrateOf(EARLIEST);
    assert(serialized.endsWith("}\n\n"), "receipt: serialization now emits different bytes for the same document");
  },
  guarded: () => {
    for (const id of model().FULL_GOLDEN_IDS) {
      const { serialized } = migrateOf(id);
      assert.strictEqual(readLF(model().goldenFile(id)), serialized, `${id}: the committed golden document no longer matches`);
    }
  },
});

/* 17. Migrating the same fixture twice must produce the same bytes. */
control({
  id: "NC-P3-17",
  label: "migration reading a clock instead of the instant it was given",
  guards: "migrating a fixture twice produces identical bytes and an identical report",
  module: "ofp/ofp-migrate.js",
  edits: [[
    `function previewLegacyMigration(source, options = {}) {`,
    `function previewLegacyMigration(source, options = {}) {
  /* A clock read inside the migration, in the second-resolution form the
     contract accepts - migrateLegacyProject falls back to the default instant
     for anything else, so a naive toISOString() would install no defect at all.
     The offset makes the two runs land in different seconds without the control
     depending on how fast the machine is. */
  globalThis.__ofpP3Clock = (globalThis.__ofpP3Clock || 0) + 1000;
  options = { ...options, at: new Date(Date.now() + globalThis.__ofpP3Clock).toISOString().replace(/\\.\\d+Z$/, "Z") };`,
  ]],
  defect: () => {
    const first = migrateOf(EARLIEST);
    const second = migrateOf(EARLIEST);
    assert.notStrictEqual(first.result.report.target.at, AT, "receipt: the supplied instant has been ignored");
    assert(first.result.report.target.at !== second.result.report.target.at || first.serialized !== second.serialized,
      "receipt: two runs of the same input now differ");
  },
  guarded: () => {
    const first = migrateOf(EARLIEST);
    const second = migrateOf(EARLIEST);
    assert.strictEqual(first.serialized, second.serialized, "migration must be deterministic");
    assert.strictEqual(stable(first.result.report), stable(second.result.report), "and so must its report");
  },
});

/* 18. P0 Q2. Statements are evidence where migration guessed, and a rule that
   emits one per field would drown the document it is annotating. */
control({
  id: "NC-P3-18",
  label: "a rule emitting a statement for every mapping instead of every guess",
  guards: "statement volume stays under the documented per-shot guard",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    M021_LOOP,
    `      for (const shot of context.shots()) {
        for (let copy = 0; copy < 4; copy++)
          context.statement({ target: { subject: shot.subject, path: "/title" }, kind: "suggested", note: "volume probe " + copy, from: shot.from + ptr("title") });
        for (const [field, kind] of [["parentShot", "part-of"], ["fallbackFor", "fallback-for"]]) {`,
  ]],
  defect: () => {
    const { result } = migrateOf(LATEST);
    assert(result.candidate.statements.length > 80, `receipt: statement volume has exploded to ${result.candidate.statements.length}`);
  },
  guarded: () => {
    const PER_SHOT = 3.0;
    for (const generation of model().GENERATIONS) {
      const { result } = migrateOf(generation.id);
      const shots = (model().readFixture(generation.id).shots || []).length;
      const perShot = (result.candidate.statements || []).length / shots;
      assert(perShot <= PER_SHOT, `${generation.id}: ${perShot.toFixed(2)} statements per shot exceeds the guard of ${PER_SHOT}`);
    }
  },
});

/* 19. The corpus must never let P2 be blamed for data CineBraid lost in 2026. */
control({
  id: "NC-P3-19",
  label: "the report claiming a later generation still had relations for migration to lose",
  guards: "M021 accounts for exactly what the source generation actually contains",
  module: "ofp/ofp-migrate-rules.js",
  edits: [[
    M021_LOOP,
    `      for (const shot of context.shots()) {
        context.claim(shot.from + ptr("id"), DISPOSITION.MAPPED, [shot.subject + "#/relations"], "overreported by the control");
        for (const [field, kind] of [["parentShot", "part-of"], ["fallbackFor", "fallback-for"]]) {`,
  ]],
  defect: () => {
    const { result } = migrateOf(LATEST);
    const m021 = result.report.rules.find((rule) => rule.id === "M021");
    assert(m021.sourceTargets > 1, `receipt: M021 now claims ${m021.sourceTargets} source values in a generation that has one`);
  },
  guarded: () => {
    for (const id of [LATEST, "overfit-11-hub-v4-0", "overfit-09-anchorhub-33"]) {
      const { result } = migrateOf(id);
      const m021 = result.report.rules.find((rule) => rule.id === "M021");
      const census = model().hazardCensus(model().readFixture(id));
      assert.strictEqual(m021.sourceTargets, census.hazards.shotsWithAtomic,
        `${id}: M021 reports ${m021.sourceTargets} source values where the generation has ${census.hazards.shotsWithAtomic}; historical loss is being reported as migration work`);
    }
  },
});

/* 20. Normal CI verifies. Regeneration is a separate command, and the day it
   becomes reachable from a check is the day a golden stops meaning anything. */
control({
  id: "NC-P3-20",
  label: "a check script regenerating the fixtures instead of verifying them",
  guards: "no check:* script runs the fixture build tool",
  expect: "AssertionError",
  /* There is no module to patch here - the defect would live in package.json -
     so the mutated manifest is built in memory and the real guarded assertion is
     run against it. `node --check scripts/build-overfit-golden-fixtures.js` in
     check:syntax mentions the tool without running it, so the predicate matches
     execution rather than the filename. */
  defect: () => {
    assert.strictEqual(regenerators(REAL_SCRIPTS).length, 0, "receipt: no check runs the builder before the mutation");
    assert.strictEqual(regenerators(MUTATED_SCRIPTS).length, 1, "receipt: and exactly one does after it");
  },
  guarded: () => {
    const found = regenerators(MUTATED_SCRIPTS);
    assert.strictEqual(found.length, 0, `no check:* script may regenerate fixtures, found: ${found.join(", ")}`);
  },
});

/* And the mechanism behind it: running the conformance suite must leave the
   fixture tree byte-identical. Not a patched control - a measurement. */
{
  const tree = () => fs.readdirSync(path.join(model().FIXTURE_ROOT, "generations")).sort()
    .map((name) => `${name}:${sha256(readLF(path.join(model().FIXTURE_ROOT, "generations", name)))}`).join("\n");
  const before = tree();
  for (const generation of model().GENERATIONS) model().goldenFor(generation.id, model().readFixture(generation.id));
  assert.strictEqual(tree(), before, "verifying the corpus must not rewrite it");
}

/* =========================================================================== */

/* Twenty controls, plus NC-P3-12b: golden drift is guarded twice, once on the
   pinned summary and once on the committed bytes, because the two would not
   catch the same change. NC-P3-12's defect moves a value the summary records;
   NC-P3-12b's moves only the serialization, which the summary would miss. */
assert.strictEqual(results.length, 21, `expected 21 negative controls, ran ${results.length}`);
assert.strictEqual(new Set(results.map((entry) => entry.id)).size, results.length, "control IDs must be unique");
for (const entry of results) console.log(`  ${entry.id.padEnd(11)} detected: ${entry.outcome}`);
console.log(`\nOFP P3 negative controls passed: ${results.length} defects reintroduced, ${results.length} caught, every one with a live-defect receipt. Nothing was written to disk and nothing was reverted with git.`);

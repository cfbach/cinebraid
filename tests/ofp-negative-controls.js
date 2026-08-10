/* Negative controls for the Open Film Project P1 suites.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * below reintroduces exactly one defect the frozen P0 contract exists to
 * prevent, then asserts the corresponding property FAILS. A control that stays
 * green is the real failure: it means the test it guards would not notice the
 * defect coming back.
 *
 * Two rules, both learned the hard way in this repository:
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. The defect is
 *   introduced by compiling a modified copy of the source IN MEMORY and
 *   installing it in the module cache. A broad `git checkout` to undo a
 *   temporary edit is how unrelated unstaged work gets discarded.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. A recent incident had a control
 *   whose multiline anchor silently failed to match under core.autocrlf=true,
 *   and the harness counted the resulting throw as success. So every control
 *   carries a receipt: the anchor must exist, must be unique, must actually
 *   change the source, and the DEFECT ITSELF must then be observable through a
 *   probe - before the guarded assertion is allowed to count as detection.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const OFP_DIR = path.join(__dirname, "..", "ofp");
const FIXTURES = path.join(__dirname, "fixtures", "ofp");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

/* ---------------------------------------------------------------------------
   In-memory patching, with the module cache swapped so that dependents pick up
   the patched module rather than the real one they already required. */
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
    /* The compiled source is handed to the probe so a receipt can name the
       exact injected line, rather than grepping the file on disk - where a
       phrase like ".bak" also appears in the comment explaining why no .bak is
       ever written. */
    return run({ patchedSource: code, originalSource: original });
  } finally {
    /* Restore by putting the real modules back, not by touching a file. */
    for (const key of Object.keys(require.cache)) if (key.startsWith(OFP_DIR)) delete require.cache[key];
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

const results = [];

/* `defect` proves the mutation actually reached the code path - the receipt.
   `guarded` is the property a real suite asserts, and it must throw here. */
function control({ id, label, guards, module: relative, edits, defect, guarded, expect = assert.AssertionError }) {
  const run = (context = {}) => {
    let defectObserved = false;
    if (defect) { defect(context); defectObserved = true; }
    let detected = null;
    try {
      guarded();
    } catch (error) {
      /* `expect` may be a class or a class NAME. It has to allow a name because
         patching clears the whole ofp/ require cache, so a class defined in
         ofp/ is re-created inside the patched context and `instanceof` against
         the outer copy is false even though the error is exactly the right one.
         Matching on `name` is still specific - it is not "any exception". */
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

/* Shared documents. Rebuilt per use so a control cannot leak state into the
   next one. */
const doc = () => require("../ofp/ofp-json").parseJsonStrict(readFixture("representative.ofp.json"));

/* ===========================================================================
   1. Array indexes must never be identity. */
control({
  id: "NC-01",
  label: "allowing a path to enter an array",
  guards: "resolution fails if traversing path would enter an array",
  module: "ofp/ofp-target.js",
  edits: [[
    `    if (Array.isArray(current))
      return {
        ok: false,
        code: "array-traversal",`,
    `    if (false)
      return {
        ok: false,
        code: "array-traversal",`,
  ]],
  defect: () => {
    const { resolveTarget } = require("../ofp/ofp-target");
    const resolved = resolveTarget(doc(), { subject: "shot:sh-0100", path: "/risks/0" });
    assert.strictEqual(resolved.ok, true, "receipt: with the check removed, an array index now resolves");
    assert.strictEqual(resolved.value, "Dusk light changes fast.", "receipt: and it resolves to the indexed element");
  },
  guarded: () => {
    const { resolveTarget } = require("../ofp/ofp-target");
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    assert.strictEqual(resolveTarget(doc(), { subject: "shot:sh-0100", path: "/risks/0" }).code, "array-traversal");
    assert(validateOfpDocument(readFixture("array-traversal-target.ofp.json")).diagnostics.some((entry) => entry.code === "statement.target.array-traversal"));
  },
});

/* ===========================================================================
   2. An approval must not transfer to a different field holding the same value. */
const SAME_VALUE_DOC = {
  format: { id: "open-film-project", version: "1.0-draft.1" },
  shots: [{ id: "sh-0100", framing: { size: "wide", movement: "wide" } }],
};
control({
  id: "NC-02",
  label: "dropping the target from the claim payload",
  guards: "an approval cannot be retargeted onto another field with the same value",
  module: "ofp/ofp-claim.js",
  edits: [[
    `  const payload = { ofp: CLAIM_PAYLOAD_VERSION, t: targetString };`,
    `  const payload = { ofp: CLAIM_PAYLOAD_VERSION };`,
  ]],
  defect: () => {
    const { computeClaimHash } = require("../ofp/ofp-claim");
    assert.strictEqual(
      computeClaimHash("shot:sh-0100#/framing/size", "wide"),
      computeClaimHash("shot:sh-0100#/framing/movement", "wide"),
      "receipt: without the target in the payload, two different fields now hash identically",
    );
  },
  guarded: () => {
    const { computeClaimHashForTarget } = require("../ofp/ofp-claim");
    const boundToSize = computeClaimHashForTarget(SAME_VALUE_DOC, { subject: "shot:sh-0100", path: "/framing/size" }).hash;
    const retargeted = computeClaimHashForTarget(SAME_VALUE_DOC, { subject: "shot:sh-0100", path: "/framing/movement" });
    assert.notStrictEqual(boundToSize, retargeted.hash, "moving a statement to another same-valued target must break its hash");
  },
});

/* ===========================================================================
   3. Changing an approved value must make the approval stale. */
control({
  id: "NC-03",
  label: "reporting every statement as current",
  guards: "a changed value makes its statement stale, and a stale approval confers no approval",
  module: "ofp/ofp-statements.js",
  edits: [[
    `  if (stored !== recomputed.hash)`,
    `  if (false)`,
  ]],
  defect: () => {
    const { deriveStatementState } = require("../ofp/ofp-statements");
    const stale = require("../ofp/ofp-json").parseJsonStrict(readFixture("stale-approval.ofp.json"));
    assert.strictEqual(deriveStatementState(stale, stale.statements[0]).state, "current", "receipt: a statement about a changed value now reports itself current");
  },
  guarded: () => {
    const { deriveStatementState, deriveTargetBadge } = require("../ofp/ofp-statements");
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const stale = require("../ofp/ofp-json").parseJsonStrict(readFixture("stale-approval.ofp.json"));
    assert.strictEqual(deriveStatementState(stale, stale.statements.find((entry) => entry.kind === "approved")).state, "stale");
    assert.strictEqual(deriveTargetBadge(stale, stale.statements, { subject: "shot:sh-0100", path: "/framing/size" }).badge, "authored", "a stale approval confers no approval");
    assert(validateOfpDocument(readFixture("stale-approval.ofp.json")).diagnostics.some((entry) => entry.code === "statement.stale.approval"));
  },
});

/* ===========================================================================
   4. Absent and null are two different production facts. */
control({
  id: "NC-04",
  label: "setting v to undefined instead of omitting it",
  guards: "an absent value and a null value do not hash alike",
  module: "ofp/ofp-claim.js",
  edits: [[
    `  if (value !== ABSENT) payload.v = value;`,
    `  payload.v = value === ABSENT ? undefined : value;`,
  ]],
  defect: () => {
    const { computeClaimHash, buildClaimPayload, claimPayloadJcs } = require("../ofp/ofp-claim");
    const { ABSENT } = require("../ofp/ofp-target");
    assert.strictEqual(claimPayloadJcs(buildClaimPayload("x#/y", ABSENT)), '{"ofp":"claim/1","t":"x#/y","v":null}', "receipt: canonicalJson maps the undefined straight to null, exactly as P0 N3 predicted");
    assert.strictEqual(computeClaimHash("x#/y", ABSENT), computeClaimHash("x#/y", null), "receipt: absent and null now collide");
  },
  guarded: () => {
    const { computeClaimHash } = require("../ofp/ofp-claim");
    const { ABSENT } = require("../ofp/ofp-target");
    assert.notStrictEqual(computeClaimHash("x#/y", ABSENT), computeClaimHash("x#/y", null));
    const absentVsNull = require("../ofp/ofp-json").parseJsonStrict(readFixture("absent-vs-null.ofp.json"));
    assert.notStrictEqual(
      absentVsNull.statements.find((entry) => entry.id === "stm-absent").claim.hash,
      absentVsNull.statements.find((entry) => entry.id === "stm-null").claim.hash,
    );
  },
});

/* ===========================================================================
   5. Validation must not apply defaults - the normalizeProjectV5 defect. */
control({
  id: "NC-05",
  label: "injecting enum defaults during validation",
  guards: "validating a document does not mutate it",
  module: "ofp/ofp-validate.js",
  edits: [[
    `      for (const key of spec.required || [])
        if (!Object.prototype.hasOwnProperty.call(value, key))
          report("schema.required.missing",`,
    `      for (const [defaultKey, defaultSpec] of Object.entries(spec.properties || {}))
        if (!Object.prototype.hasOwnProperty.call(value, defaultKey) && defaultSpec && defaultSpec.enum) value[defaultKey] = defaultSpec.enum[0];
      for (const key of spec.required || [])
        if (!Object.prototype.hasOwnProperty.call(value, key))
          report("schema.required.missing",`,
  ]],
  defect: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    /* Probed on a document with genuinely ABSENT enum fields. The golden
       fixture carries a value for almost every enum it has, so probing it would
       assert that present values are still present - a receipt that passes
       whether or not the mutation did anything, which is the exact vacuous
       control this whole file exists to rule out. */
    const sparse = { format: { id: "open-film-project", version: "1.0-draft.1" }, shots: [{ id: "sh-0100", framing: { size: "wide" } }] };
    assert.strictEqual("angle" in sparse.shots[0].framing, false, "receipt: the key is absent before validation");
    assert.strictEqual("lens" in sparse.shots[0].framing, false);
    validateOfpDocument(sparse);
    assert.strictEqual(sparse.shots[0].framing.angle, "eye", "receipt: validation invented a camera angle nobody authored");
    assert.strictEqual(sparse.shots[0].framing.lens, "wide-angle", "receipt: and a lens, overwriting the deliberate absence");
    assert.strictEqual(sparse.shots[0].framing.size, "wide", "receipt: while leaving the authored value alone, which is what makes it look harmless");
  },
  guarded: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    /* Mirrors the real suite: the golden fixtures AND an explicitly sparse
       document. The fixtures alone are not enough - this control is what
       demonstrated that, by passing against the representative fixture while
       the probe above proved the defect was live. */
    for (const parsed of [doc(), { format: { id: "open-film-project", version: "1.0-draft.1" }, shots: [{ id: "sh-0100", framing: { size: "wide" }, duration: {} }] }]) {
      const before = JSON.stringify(parsed);
      validateOfpDocument(parsed);
      assert.strictEqual(JSON.stringify(parsed), before, "validating must not change one byte of the document");
    }
  },
});

/* ===========================================================================
   6. INV-R1, both halves: the guard refuses the write, and the tree snapshot
      sees a file that appears outside the guard's reach. */
function sandboxProject(fixture, file = "project.ofp.json") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-nc-"));
  fs.writeFileSync(path.join(root, file), fs.readFileSync(path.join(FIXTURES, fixture)));
  return root;
}

control({
  id: "NC-06a",
  label: "writing a .bak beside the project on open",
  guards: "INV-R1: the fs guard refuses any write under the project root",
  module: "ofp/ofp-read.js",
  edits: [[
    `    const text = fs.readFileSync(resolved, "utf8");`,
    `    const text = fs.readFileSync(resolved, "utf8");
    fs.writeFileSync(\`\${resolved}.bak\`, text, "utf8");`,
  ]],
  expect: "InvR1Violation",
  defect: ({ patchedSource, originalSource }) => {
    const injected = "fs.writeFileSync(`${resolved}.bak`, text, \"utf8\");";
    assert(patchedSource.includes(injected), "receipt: the injected write is in the source that was compiled");
    assert(!originalSource.includes(injected), "receipt: and is not in the real source");
    /* And it genuinely reaches the guard: the violation must name the .bak and
       the call that made it, not merely be some exception from somewhere. */
    const root = sandboxProject("minimal.ofp.json");
    let violation = null;
    try { require("../ofp/ofp-read").inspectProject(root); } catch (error) { violation = error; }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
    assert(violation, "receipt: the patched loader must actually attempt the write");
    assert.strictEqual(violation.method, "writeFileSync", "receipt: refused at the expected call");
    assert(violation.target.endsWith(".bak"), `receipt: refused the expected path, got ${violation.target}`);
  },
  guarded: () => {
    const { inspectProject } = require("../ofp/ofp-read");
    const root = sandboxProject("minimal.ofp.json");
    try {
      const result = inspectProject(root);
      assert.deepStrictEqual(result.writeAttempts, [], "opening must attempt no writes");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
});

control({
  id: "NC-06b",
  label: "rebuilding an index inside the project directory before the guard is armed",
  guards: "INV-R1: the tree snapshot sees any file that appears under the project root",
  module: "ofp/ofp-read.js",
  edits: [[
    `  const file = fs.existsSync(canonical) ? canonical : fs.existsSync(legacy) ? legacy : null;`,
    `  const file = fs.existsSync(canonical) ? canonical : fs.existsSync(legacy) ? legacy : null;
  if (file) fs.writeFileSync(path.join(root, "index.cache"), "rebuilt", "utf8");`,
  ]],
  defect: () => {
    const { inspectProject } = require("../ofp/ofp-read");
    const root = sandboxProject("minimal.ofp.json");
    try {
      inspectProject(root);
      assert(fs.existsSync(path.join(root, "index.cache")), "receipt: the patched loader really did create a file inside the project directory");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  guarded: () => {
    const { inspectProject, snapshotTree, diffSnapshots } = require("../ofp/ofp-read");
    const root = sandboxProject("minimal.ofp.json");
    try {
      const before = snapshotTree(root);
      inspectProject(root);
      assert.deepStrictEqual(diffSnapshots(before, snapshotTree(root)), [], "opening must change nothing under the project root");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
});

/* ===========================================================================
   7. Unknown extension content must survive a write. */
control({
  id: "NC-07",
  label: "dropping undeclared keys when writing",
  guards: "an unknown extension and an undeclared field survive serialization",
  module: "ofp/ofp-serialize.js",
  edits: [[
    `  return [...declaredPresent, ...unknown];`,
    `  return [...declaredPresent];`,
  ]],
  defect: () => {
    const { serializeCanonical } = require("../ofp/ofp-serialize");
    const written = serializeCanonical(require("../ofp/ofp-json").parseJsonStrict(readFixture("unknown-extension.ofp.json")));
    assert(!written.includes("futureFieldNobodyDeclared"), "receipt: the undeclared field is gone from the output");
  },
  guarded: () => {
    const { serializeCanonical } = require("../ofp/ofp-serialize");
    const { parseJsonStrict } = require("../ofp/ofp-json");
    const round = parseJsonStrict(serializeCanonical(parseJsonStrict(readFixture("unknown-extension.ofp.json"))));
    assert.deepStrictEqual(round.shots[0].futureFieldNobodyDeclared, { nested: [1, 2, { deep: true }] });
    assert.deepStrictEqual(round.extensions["com.example.futuretool"], { schedule: { day: 4, notes: ["keep me"] }, opaque: { z: 1, a: 2 } });
  },
});

/* ===========================================================================
   8. An unknown enum value must never be coerced to a declared member. */
control({
  id: "NC-08",
  label: "coercing an unknown enum value to the first declared member on write",
  guards: "an unknown enum value survives a write verbatim",
  module: "ofp/ofp-serialize.js",
  edits: [[
    `    if (type === "string" || type === "boolean") return JSON.stringify(value);`,
    `    if (type === "string" || type === "boolean") return JSON.stringify(spec && Array.isArray(spec.enum) && typeof value === "string" && !spec.enum.includes(value) ? spec.enum[0] : value);`,
  ]],
  defect: () => {
    const { serializeCanonical } = require("../ofp/ofp-serialize");
    const written = serializeCanonical(require("../ofp/ofp-json").parseJsonStrict(readFixture("unknown-enum.ofp.json")));
    assert(!written.includes("ultra-wide"), "receipt: the unknown value is gone");
    assert(written.includes('"size": "extreme-wide"'), "receipt: and was replaced by a declared member the document never carried");
  },
  guarded: () => {
    const { serializeCanonical } = require("../ofp/ofp-serialize");
    const { parseJsonStrict } = require("../ofp/ofp-json");
    assert.strictEqual(parseJsonStrict(serializeCanonical(parseJsonStrict(readFixture("unknown-enum.ofp.json")))).shots[0].framing.size, "ultra-wide");
  },
});

/* ===========================================================================
   9. A real production project must never be converted to a draft. */
control({
  id: "NC-09",
  label: "converting a legacy project to the draft lineage on inspection",
  guards: "a legacy CineBraid project stays legacy and is not given a format block",
  module: "ofp/ofp-validate.js",
  edits: [[
    `  if (classification.documentClass === DOCUMENT_CLASS.LEGACY) {`,
    `  if (classification.documentClass === DOCUMENT_CLASS.LEGACY) {
    document.format = { id: "open-film-project", version: "1.0-draft.1" };
    delete document.schemaVersion;`,
  ]],
  defect: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const parsed = require("../ofp/ofp-json").parseJsonStrict(readFixture("legacy-project.json"));
    assert.strictEqual(parsed.schemaVersion, 6.7);
    validateOfpDocument(parsed);
    assert.strictEqual(parsed.format.version, "1.0-draft.1", "receipt: a real project has been dragged into the draft lane");
    assert.strictEqual(parsed.schemaVersion, undefined, "receipt: and its legacy lineage marker is gone");
  },
  guarded: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const legacyText = readFixture("legacy-project.json");
    const result = validateOfpDocument(legacyText);
    assert.strictEqual(result.document.format, undefined, "inspecting a legacy project must not give it a format block");
    assert.strictEqual(result.document.schemaVersion, 6.7);
    assert.strictEqual(JSON.stringify(result.document), JSON.stringify(require("../ofp/ofp-json").parseJsonStrict(legacyText)));
  },
});

/* ===========================================================================
   10. A CRLF checkout must break conformance.

   A data control, not a source mutation: the defect P0 N4 measured is not a bug
   in any function, it is what `core.autocrlf=true` does to a file that is not
   pinned in .gitattributes. Measured on this machine at 372 CR bytes on the
   shipped sample. */
control({
  id: "NC-10",
  label: "a canonical document checked out with CRLF endings",
  guards: "canonical fixtures are LF and a second serialization is byte-identical",
  defect: () => {
    const asLf = readFixture("representative.ofp.json");
    const asCrlf = asLf.replace(/\n/g, "\r\n");
    assert.strictEqual((asLf.match(/\r/g) || []).length, 0, "receipt: the fixture on disk has no CR to begin with");
    assert.strictEqual((asCrlf.match(/\r/g) || []).length, asLf.split("\n").length - 1, "receipt: the injected form really does carry a CR on every line");
    assert.notStrictEqual(asCrlf, asLf, "receipt: the mutation changed the bytes");
    /* And the injected form still parses, which is the trap: a CRLF document is
       semantically fine and only fails on bytes. A conformance check that
       compared parsed values rather than bytes would miss it entirely. */
    const { parseJsonStrict } = require("../ofp/ofp-json");
    assert.deepStrictEqual(parseJsonStrict(asCrlf), parseJsonStrict(asLf), "receipt: CRLF is invisible to a semantic comparison");
  },
  guarded: () => {
    const { serializeCanonical } = require("../ofp/ofp-serialize");
    const asCrlf = readFixture("representative.ofp.json").replace(/\n/g, "\r\n");
    assert.strictEqual(asCrlf.indexOf("\r"), -1, "a canonical document must be LF; see the *.ofp.json pin in .gitattributes");
    assert.strictEqual(serializeCanonical(require("../ofp/ofp-json").parseJsonStrict(asCrlf)), asCrlf, "and must round-trip byte-identically");
  },
});

/* ===========================================================================
   11. Approval is a human act. */
control({
  id: "NC-11",
  label: "accepting an approval from a non-human actor",
  guards: "an approved statement requires a human actor",
  module: "ofp/ofp-validate.js",
  edits: [[
    `      if (statement.kind === "approved") {
        const actor = statement.actor;`,
    `      if (false) {
        const actor = statement.actor;`,
  ]],
  defect: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const codes = validateOfpDocument(readFixture("approved-non-human.ofp.json")).diagnostics.map((entry) => entry.code);
    assert(!codes.includes("statement.actor.not-human"), "receipt: a model-authored approval now passes unremarked");
    assert(!codes.includes("statement.actor.missing"), "receipt: so does an approval with no actor at all");
  },
  guarded: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const codes = validateOfpDocument(readFixture("approved-non-human.ofp.json")).diagnostics.map((entry) => entry.code);
    assert(codes.includes("statement.actor.not-human"), "only a human can approve");
    assert(codes.includes("statement.actor.missing"));
  },
});

/* ===========================================================================
   12. A conflict is about competing values. */
control({
  id: "NC-12",
  label: "accepting a disputed statement with no candidates",
  guards: "a disputed statement requires at least one candidate",
  module: "ofp/ofp-validate.js",
  edits: [[
    `      if (statement.kind === "disputed" && !(Array.isArray(statement.candidates) && statement.candidates.length))`,
    `      if (false)`,
  ]],
  defect: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const result = validateOfpDocument(readFixture("disputed-without-candidates.ofp.json"));
    assert(!result.diagnostics.some((entry) => entry.code === "statement.candidates.missing"), "receipt: an empty conflict now passes");
    assert.strictEqual(result.ok, true, "receipt: and the document is reported valid");
  },
  guarded: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    assert(validateOfpDocument(readFixture("disputed-without-candidates.ofp.json")).diagnostics.some((entry) => entry.code === "statement.candidates.missing"));
  },
});

/* ===========================================================================
   13. Duplicate object keys are refused at parse. */
control({
  id: "NC-13",
  label: "accepting duplicate object keys",
  guards: "a duplicate object key is rejected at parse",
  module: "ofp/ofp-json.js",
  edits: [[
    `      if (seen.has(key))
        throw new OfpJsonError("json.duplicate-key", \`duplicate object key \${JSON.stringify(key)}\`, keyOffset, text);`,
    `      if (false)
        throw new OfpJsonError("json.duplicate-key", \`duplicate object key \${JSON.stringify(key)}\`, keyOffset, text);`,
  ]],
  defect: () => {
    const { parseJsonStrict } = require("../ofp/ofp-json");
    assert.strictEqual(parseJsonStrict('{"id":"a","id":"b"}').id, "b", "receipt: the last duplicate silently wins, exactly as JSON.parse does");
  },
  guarded: () => {
    const { parseJsonStrict } = require("../ofp/ofp-json");
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    assert.throws(() => parseJsonStrict('{"id":"a","id":"b"}'), (error) => error.code === "json.duplicate-key");
    assert(validateOfpDocument(readFixture("duplicate-key.ofp.json")).diagnostics.some((entry) => entry.code === "json.duplicate-key"));
  },
});

/* ===========================================================================
   14. The identifier floor excludes the grammar's own delimiters. */
control({
  id: "NC-14",
  label: "accepting the subject grammar's delimiters inside an identifier",
  guards: "an identifier containing : / or # is an error",
  module: "ofp/ofp-identifiers.js",
  edits: [[
    `  for (const character of ID_RESERVED_CHARACTERS)
    if (id.includes(character)) return { ok: false, reason: \`identifier contains the reserved delimiter \${JSON.stringify(character)}\` };`,
    `  for (const character of [])
    if (id.includes(character)) return { ok: false, reason: \`identifier contains the reserved delimiter \${JSON.stringify(character)}\` };`,
  ]],
  defect: () => {
    const { checkIdentifierFloor } = require("../ofp/ofp-identifiers");
    for (const unsafe of ["sh:0100", "sh/0101", "sh#0103"])
      assert.strictEqual(checkIdentifierFloor(unsafe).ok, true, `receipt: ${unsafe} is now accepted, and would make its own subject reference unparseable`);
  },
  guarded: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const result = validateOfpDocument(readFixture("invalid-id.ofp.json"));
    assert.strictEqual(result.diagnostics.filter((entry) => entry.code === "id.invalid").length, 4);
  },
});

/* ===========================================================================
   15. id-portable is a warning, and must never become destructive.

   The failure mode this guards is subtle and is the reason the two-tier rule
   exists: if `INT-1->2` were an ERROR, the pressure would be to rename it, and
   renaming a legacy identifier destroys the only link between a shot and its
   history. The control makes it an error and asserts the suites notice. */
control({
  id: "NC-15",
  label: "promoting id.not-portable from a warning to an error",
  guards: "a legacy identifier outside id-portable is reported without invalidating the document",
  module: "ofp/ofp-diagnostics.js",
  edits: [[
    `  "id.not-portable": { severity: SEVERITY.WARNING, mode: MODES.PORTABILITY,`,
    `  "id.not-portable": { severity: SEVERITY.ERROR, mode: MODES.PORTABILITY,`,
  ]],
  defect: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const result = validateOfpDocument(readFixture("id-not-portable.ofp.json"));
    assert.strictEqual(result.ok, false, "receipt: a document whose only finding is a legacy identifier is now invalid");
    assert.strictEqual(result.counts.error, 1, "receipt: and the finding counts as an error");
  },
  guarded: () => {
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const { DIAGNOSTICS } = require("../ofp/ofp-diagnostics");
    const result = validateOfpDocument(readFixture("id-not-portable.ofp.json"));
    assert.strictEqual(DIAGNOSTICS["id.not-portable"].severity, "warning");
    assert.strictEqual(result.ok, true, "a legacy identifier must not invalidate a document; an error is what would tempt a rename");
    assert.strictEqual(result.document.shots[0].id, "INT-1->2", "and nothing renames it");
  },
});

/* ===========================================================================
   16. A voice must be able to exist without a character. */
control({
  id: "NC-16",
  label: "removing the standalone voice collection so voices exist only under characters",
  guards: "a voice with no character link is a valid, addressable entity",
  module: "ofp/ofp-schema.js",
  edits: [[
    `        voices: { type: "array", record: "voice", collection: "set", items: VOICE },`,
    ``,
  ]],
  defect: () => {
    const { CONTAINMENT } = require("../ofp/ofp-schema");
    assert.strictEqual(CONTAINMENT.voice, undefined, "receipt: voice is no longer an addressable record type at all");
    const { resolveTarget } = require("../ofp/ofp-target");
    assert.strictEqual(resolveTarget(doc(), { subject: "voice:voice-narrator", path: "/kind" }).ok, false, "receipt: a narrator can no longer be addressed");
  },
  guarded: () => {
    const { resolveTarget } = require("../ofp/ofp-target");
    const { CONTAINMENT } = require("../ofp/ofp-schema");
    const { validateOfpDocument } = require("../ofp/ofp-validate");
    const parsed = doc();
    assert(CONTAINMENT.voice, "voice must be an addressable record type in its own right");
    assert.strictEqual(CONTAINMENT.voice.scopes.join(), "project", "a voice is scoped to the project, never to a character");
    for (const id of ["voice-narrator", "voice-terminal-pa"])
      assert.strictEqual(resolveTarget(parsed, { subject: `voice:${id}`, path: "/kind" }).ok, true, `${id} must be addressable with no character in the picture`);
    assert.strictEqual(validateOfpDocument(readFixture("representative.ofp.json")).ok, true);
  },
});

/* ===========================================================================
   The process must end on the real modules, not the patched ones. */
delete require.cache[require.resolve("../ofp/ofp-target")];
const { resolveTarget } = require("../ofp/ofp-target");
assert.strictEqual(resolveTarget(doc(), { subject: "shot:sh-0100", path: "/risks/0" }).code, "array-traversal", "the real modules must be back in place");
assert.strictEqual(require("../ofp/ofp-diagnostics").DIAGNOSTICS["id.not-portable"].severity, "warning");
assert.strictEqual(require("../ofp/ofp-validate").validateOfpDocument(readFixture("representative.ofp.json")).ok, true);

assert.strictEqual(results.length, 17, "every control must have run");
console.log(`OFP negative controls passed: ${results.length} defects reintroduced, each observed live by a probe and then caught by the property it guards.`);
for (const entry of results) console.log(`  ${entry.id.padEnd(7)} ${entry.label}\n          caught by: ${entry.guards}\n          failure:   ${entry.outcome}`);

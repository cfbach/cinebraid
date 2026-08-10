/* INV-R1 — opening or validating a project writes nothing.
 *
 *   project.json is byte-identical, no .bak is produced, and no file is created
 *   inside the project directory. Legacy, canonical, draft, newer-than-supported
 *   and structurally invalid documents alike.
 *
 * P-1 repaired one destructive load path: coverage normalization was clearing
 * approvedFile and dirtying the project on open. Repairing one path is not the
 * same as holding the invariant, so this suite proves it two independent ways,
 * because each one alone fails vacuously in a different direction:
 *
 *   the fs guard      proves no write was ATTEMPTED, including to files that did
 *                     not exist before and would therefore hash to nothing on
 *                     the way in - but a guard that was never armed passes
 *                     trivially, so section 1 proves it bites.
 *   the tree snapshot proves nothing changed and nothing appeared - but it
 *                     cannot see a file that was written and then deleted.
 *
 * Everything runs in a temp directory outside the repository. No project in this
 * working tree is opened, and the shipped sample is never touched.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { withNoWritesUnder, InvR1Violation, WRITE_METHODS, PROMISES_WRITE_METHODS, isInside } = require("../ofp/ofp-fs-guard");
const { readOfpDocument, inspectProject, snapshotTree, diffSnapshots, CANONICAL_FILENAME, LEGACY_FILENAME } = require("../ofp/ofp-read");
const { DOCUMENT_CLASS } = require("../ofp/ofp-format");

const FIXTURES = path.join(__dirname, "fixtures", "ofp");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-invr1-"));

/* ===========================================================================
   1. The guard bites.

   Every assertion below is worthless if the guard silently allows writes, so
   this is established first and against the real fs, not a stub. */

const armed = path.join(sandbox, "armed");
fs.mkdirSync(armed);
fs.writeFileSync(path.join(armed, "project.json"), "{}", "utf8");

assert.throws(
  () => withNoWritesUnder(armed, () => fs.writeFileSync(path.join(armed, "new-file.txt"), "x")),
  InvR1Violation,
  "the guard must refuse a write inside the root",
);
assert.strictEqual(fs.existsSync(path.join(armed, "new-file.txt")), false, "and the write must not have happened");
assert.throws(() => withNoWritesUnder(armed, () => fs.writeFileSync(path.join(armed, "project.json.bak"), "x")), InvR1Violation, "a .bak is the classic violation");
assert.throws(() => withNoWritesUnder(armed, () => fs.appendFileSync(path.join(armed, "project.json"), "x")), InvR1Violation);
assert.throws(() => withNoWritesUnder(armed, () => fs.mkdirSync(path.join(armed, "cache"))), InvR1Violation, "an index or cache directory is still a write");
assert.throws(() => withNoWritesUnder(armed, () => fs.unlinkSync(path.join(armed, "project.json"))), InvR1Violation);
assert.throws(() => withNoWritesUnder(armed, () => fs.openSync(path.join(armed, "project.json"), "w")), InvR1Violation, "opening for writing counts");
assert.throws(() => withNoWritesUnder(armed, () => fs.createWriteStream(path.join(armed, "streamed.txt"))), InvR1Violation);
assert.throws(() => withNoWritesUnder(armed, () => fs.writeFileSync(path.join(armed, "nested", "deep", "file.txt"), "x")), InvR1Violation, "depth is not an escape");

/* Reads are untouched, and so is anything outside the root - config bootstrap
   elsewhere on disk is explicitly not a violation. */
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ofp-outside-"));
const readBack = withNoWritesUnder(armed, () => {
  assert.strictEqual(fs.readFileSync(path.join(armed, "project.json"), "utf8"), "{}", "reads still work inside the guard");
  fs.writeFileSync(path.join(outside, "sidecar.json"), "{}", "utf8");
  return "done";
});
assert.strictEqual(readBack.result, "done");
assert.strictEqual(fs.existsSync(path.join(outside, "sidecar.json")), true, "a sidecar outside the project root is unaffected");
assert.deepStrictEqual(readBack.attempts, [], "no refusals when nothing tried to write inside the root");

/* fs is restored afterwards, including when the guarded work throws. */
const beforePatch = fs.writeFileSync;
try { withNoWritesUnder(armed, () => { throw new Error("boom"); }); } catch { /* expected */ }
assert.strictEqual(fs.writeFileSync, beforePatch, "a throw inside the guard must not leave the process with a patched fs");
fs.writeFileSync(path.join(armed, "proof-restored.txt"), "x", "utf8");
assert.strictEqual(fs.readFileSync(path.join(armed, "proof-restored.txt"), "utf8"), "x");
fs.unlinkSync(path.join(armed, "proof-restored.txt"));

/* collectOnly records violations instead of throwing, so a caller can see all
   of them in one run rather than only the first. */
const collected = withNoWritesUnder(armed, () => {
  fs.writeFileSync(path.join(armed, "a.txt"), "x");
  fs.writeFileSync(path.join(armed, "b.txt"), "x");
}, { collectOnly: true });
assert.deepStrictEqual(collected.attempts.map((entry) => path.basename(entry.target)), ["a.txt", "b.txt"]);
assert.strictEqual(fs.existsSync(path.join(armed, "a.txt")), false, "collectOnly still refuses the write");

/* The guard's coverage is a list, not a guess. */
for (const method of ["writeFile", "writeFileSync", "mkdir", "rename", "rm", "unlink", "copyFile", "cp", "truncate", "chmod", "createWriteStream", "open"])
  assert(WRITE_METHODS.includes(method), `fs.${method} must be guarded`);
for (const method of ["writeFile", "mkdir", "rm", "rename", "unlink"])
  assert(PROMISES_WRITE_METHODS.includes(method), `fs.promises.${method} must be guarded`);
assert.strictEqual(isInside(armed, path.join(armed, "x")), true);
assert.strictEqual(isInside(armed, path.join(armed, "..", "elsewhere")), false, "climbing out with .. leaves the root");
assert.strictEqual(isInside(armed, armed), true, "the root itself counts");

/* fs.promises is guarded too, since an async write is still a write. The guard
   refuses synchronously, before the promise is ever created, so this is a plain
   throws() rather than a rejects() - which also keeps the assertion inside the
   suite's synchronous run instead of in a microtask that would fire after the
   sandbox has already been removed. */
assert.throws(
  () => withNoWritesUnder(armed, () => fs.promises.writeFile(path.join(armed, "async.txt"), "x")),
  InvR1Violation,
  "fs.promises.writeFile must be refused inside the root",
);
assert.strictEqual(fs.existsSync(path.join(armed, "async.txt")), false);

/* ===========================================================================
   2. Opening every document class writes nothing.

   The classes are the ones P0 names: legacy, canonical draft, newer than
   supported, structurally invalid, and unknown extension content - plus an
   invalid document of each lineage, because an invalid document is exactly the
   input a loader is most tempted to "fix". */

const CLASSES = [
  { label: "valid OFP draft", file: CANONICAL_FILENAME, from: "representative.ofp.json", expect: DOCUMENT_CLASS.SUPPORTED_DRAFT },
  { label: "minimal OFP draft", file: CANONICAL_FILENAME, from: "minimal.ofp.json", expect: DOCUMENT_CLASS.SUPPORTED_DRAFT },
  { label: "invalid OFP draft", file: CANONICAL_FILENAME, from: "unresolvable-target.ofp.json", expect: DOCUMENT_CLASS.SUPPORTED_DRAFT },
  { label: "newer-than-supported OFP", file: CANONICAL_FILENAME, from: "newer-draft.ofp.json", expect: DOCUMENT_CLASS.NEWER_DRAFT },
  { label: "newer stable OFP", file: CANONICAL_FILENAME, from: "newer-stable.ofp.json", expect: DOCUMENT_CLASS.NEWER_STABLE },
  { label: "unknown extension content", file: CANONICAL_FILENAME, from: "unknown-extension.ofp.json", expect: DOCUMENT_CLASS.SUPPORTED_DRAFT },
  { label: "structurally invalid JSON", file: CANONICAL_FILENAME, from: "malformed-json.ofp.json", expect: DOCUMENT_CLASS.UNRECOGNIZED },
  { label: "duplicate object key", file: CANONICAL_FILENAME, from: "duplicate-key.ofp.json", expect: DOCUMENT_CLASS.UNRECOGNIZED },
  { label: "another format entirely", file: CANONICAL_FILENAME, from: "invalid-format.ofp.json", expect: DOCUMENT_CLASS.FORMAT_INVALID },
  { label: "valid legacy project", file: LEGACY_FILENAME, from: "legacy-project.json", expect: DOCUMENT_CLASS.LEGACY },
];

let inspected = 0;
for (const { label, file, from, expect } of CLASSES) {
  const projectRoot = path.join(sandbox, `case-${inspected++}`);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(projectRoot, file), fs.readFileSync(path.join(FIXTURES, from)));
  /* A neighbour file, so "nothing was created" is distinguishable from "the
     directory was empty and stayed empty". */
  fs.writeFileSync(path.join(projectRoot, "notes.txt"), "a file that was already here\n", "utf8");
  fs.mkdirSync(path.join(projectRoot, "shots"));
  fs.writeFileSync(path.join(projectRoot, "shots", "existing.txt"), "x", "utf8");

  const before = snapshotTree(projectRoot);
  const result = inspectProject(projectRoot);
  const after = snapshotTree(projectRoot);

  assert.deepStrictEqual(diffSnapshots(before, after), [], `${label}: opening must change nothing under the project root`);
  assert.deepStrictEqual(result.writeAttempts, [], `${label}: no write was even attempted`);
  assert.strictEqual(result.validation.documentClass, expect, `${label}: classification`);
  assert.strictEqual(fs.existsSync(path.join(projectRoot, `${file}.bak`)), false, `${label}: no .bak`);
  assert.strictEqual(fs.readdirSync(projectRoot).sort().join(","), [file, "notes.txt", "shots"].sort().join(","), `${label}: no new file appeared in the project directory`);
  /* Byte identity of the document itself, stated separately from the tree
     comparison because it is the promise a user would recognise. */
  assert.deepStrictEqual(
    fs.readFileSync(path.join(projectRoot, file)),
    fs.readFileSync(path.join(FIXTURES, from)),
    `${label}: the document is byte-identical to what was written`,
  );

  /* Inspecting twice must be as inert as inspecting once. */
  inspectProject(projectRoot);
  assert.deepStrictEqual(diffSnapshots(before, snapshotTree(projectRoot)), [], `${label}: a second open is equally inert`);
}

/* ===========================================================================
   3. A legacy project stays legacy: no conversion, no draft file. */

const legacyRoot = path.join(sandbox, "legacy-lane");
fs.mkdirSync(legacyRoot);
fs.writeFileSync(path.join(legacyRoot, LEGACY_FILENAME), fs.readFileSync(path.join(FIXTURES, "legacy-project.json")));
const legacyBefore = snapshotTree(legacyRoot);
const legacy = inspectProject(legacyRoot);
assert.strictEqual(legacy.validation.documentClass, DOCUMENT_CLASS.LEGACY);
assert.strictEqual(legacy.validation.document.schemaVersion, 6.7, "the legacy lineage marker is untouched");
assert.strictEqual(legacy.validation.document.format, undefined, "no format block was invented");
assert.strictEqual(fs.existsSync(path.join(legacyRoot, CANONICAL_FILENAME)), false, "opening a real project must not create an OFP draft beside it");
assert.deepStrictEqual(diffSnapshots(legacyBefore, snapshotTree(legacyRoot)), []);
assert.deepStrictEqual(fs.readdirSync(legacyRoot), [LEGACY_FILENAME], "the directory holds exactly what it held before");

/* The canonical document wins when both are present, and the legacy one is
   still not touched. */
const bothRoot = path.join(sandbox, "both");
fs.mkdirSync(bothRoot);
fs.writeFileSync(path.join(bothRoot, LEGACY_FILENAME), fs.readFileSync(path.join(FIXTURES, "legacy-project.json")));
fs.writeFileSync(path.join(bothRoot, CANONICAL_FILENAME), fs.readFileSync(path.join(FIXTURES, "minimal.ofp.json")));
const bothBefore = snapshotTree(bothRoot);
assert.strictEqual(path.basename(inspectProject(bothRoot).file), CANONICAL_FILENAME);
assert.deepStrictEqual(diffSnapshots(bothBefore, snapshotTree(bothRoot)), []);

/* A directory with neither is reported, not created into. */
const emptyRoot = path.join(sandbox, "empty");
fs.mkdirSync(emptyRoot);
const empty = inspectProject(emptyRoot);
assert.strictEqual(empty.file, null);
assert(empty.reason.includes(CANONICAL_FILENAME));
assert.deepStrictEqual(fs.readdirSync(emptyRoot), [], "nothing was created to make the read succeed");

/* ===========================================================================
   4. readOfpDocument guards the file's own directory by default. */

const single = path.join(sandbox, "single");
fs.mkdirSync(single);
fs.writeFileSync(path.join(single, CANONICAL_FILENAME), fs.readFileSync(path.join(FIXTURES, "representative.ofp.json")));
const direct = readOfpDocument(path.join(single, CANONICAL_FILENAME));
assert.strictEqual(direct.guardRoot, single, "the file's directory is guarded when no root is given");
assert.deepStrictEqual(direct.writeAttempts, []);
assert.strictEqual(direct.validation.ok, true);
assert.strictEqual(direct.validation.document.meta.title, "The Last Ferry");
/* And the text it validated is the text on disk, unmodified. */
assert.strictEqual(direct.text, fs.readFileSync(path.join(single, CANONICAL_FILENAME), "utf8"));

fs.rmSync(sandbox, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });

console.log(`INV-R1 proven: ${CLASSES.length} document classes opened with zero writes attempted and zero tree changes, guard verified armed against ${WRITE_METHODS.length} fs write entry points.`);

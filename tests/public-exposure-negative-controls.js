/* Negative controls for the public-exposure credential scan.

   tests/public-exposure.js asserts the scan is clean. A clean answer is only
   worth something if the same machinery can be shown to report a dirty one, and
   the audit that opened this work found a scan that had literally never run:
   `npm run check:secrets` invoked the scanner with no target, printed usage and
   exited 2, and no gate noticed because 2 looks like "nothing to say".

   Five things are proved here, each by making the guarantee false and watching
   the right thing fail for the right reason:

     1. a known synthetic fixture value does NOT fail the scan;
     2. a fake secret in a location the allowlist does not cover IS detected -
        including inside a file the allowlist does cover, because suppression is
        per matched value and not per file;
     3. removing a rule, or broadening suppression back to whole-file, makes the
        control fail;
     4. an invocation failure is distinguishable from a clean result;
     5. the publication-tree target really reads `git archive` output, not the
        working tree.

   No mutation is written into this repository. Source mutations are compiled in
   memory under the real filename, and the two git-backed targets are proved
   against a throwaway repository in the OS temp area - so this suite is safe to
   run beside the three other suites that read the same files.

   No real credential appears here. The fake keys are assembled from pieces at
   runtime, so no line of this file matches a detector. */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SCANNER_FILE = path.join(ROOT, "scripts", "scan-secrets.js");
/* Two copies on purpose. The mutation anchors below are written with `\n`, and a
   clone with core.autocrlf=true materialises the scanner with CRLF - so an anchor
   matched against the raw bytes finds nothing and the control reports itself
   broken rather than testing anything. Mutations run against the normalised copy;
   the "nothing was written" check compares the raw one. */
const SCANNER_BYTES = fs.readFileSync(SCANNER_FILE, "utf8");
const SCANNER_SOURCE = SCANNER_BYTES.replace(/\r\n/g, "\n");
const scanner = require(SCANNER_FILE);

const notes = [];

/* Fake credentials, assembled so that no line of this source is itself a match. */
const FAKE_KEY = ["sk", "NEGATIVECONTROL", "0".repeat(16)].join("-");
const OTHER_FAKE_KEY = ["sk", "SECONDCONTROL", "1".repeat(18)].join("-");
const ALLOWED_FILE = "tests/fixtures/ofp-legacy/secret-traps.json";
const ALLOWED_VALUE = scanner.ALLOW.find((a) => a.file === ALLOWED_FILE && a.rule === "openai-key").values[0];

/* ---- the control harness ------------------------------------------------- */

function mutate(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

/* The mutated scanner, compiled in memory under its real filename so its own
   requires resolve normally. The file on disk is opened read-only. */
function compile(source) {
  const compiled = new Module(SCANNER_FILE, null);
  compiled.filename = SCANNER_FILE;
  compiled.paths = Module._nodeModulePaths(path.dirname(SCANNER_FILE));
  compiled._compile(source, SCANNER_FILE);
  return compiled.exports;
}

function report(label, because, failure) {
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
  notes.push(`${label} — caught: ${because}`);
}

function caught(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

function findingsFor(result, file) {
  return result.findings.filter((f) => f.file === file);
}

/* ---- 1. a known synthetic fixture value does not fail ------------------- */

function testAllowedFixturePasses() {
  const result = scanner.scanEntries(scanner.workingTreeEntries());
  assert.deepStrictEqual(
    result.findings.map((f) => `${f.file}:${f.line} ${f.rule}`),
    [],
    "the tracked working tree is not clean, so nothing below is measuring what it claims",
  );
  const trap = result.suppressed.filter((s) => s.file === ALLOWED_FILE);
  assert(trap.length >= 4, `expected the trap fixture's four synthetic values to be suppressed, saw ${trap.length}`);
  for (const s of trap) {
    assert(s.allowedBecause && s.allowedBecause.length > 20, `suppression of ${s.file}:${s.line} carries no stated reason`);
  }
  notes.push(`allowed fixture: ${trap.length} synthetic values in ${ALLOWED_FILE} suppressed with a stated reason, 0 findings`);
}

/* ---- 2. a planted secret is detected, including in an allowed file ------ */

function testPlantedSecretIsDetected() {
  /* A file the allowlist says nothing about. */
  const plain = scanner.scanEntries([{ name: "docs/GETTING_STARTED.md", text: `provider key: ${FAKE_KEY}\n` }]);
  const hits = findingsFor(plain, "docs/GETTING_STARTED.md");
  assert.strictEqual(hits.length, 1, "a planted key in an un-allowed file was not reported exactly once");
  assert.strictEqual(hits[0].rule, "openai-key", `the wrong rule fired: ${hits[0].rule}`);
  notes.push("planted key in an un-allowed file: detected as openai-key");

  /* The same key inside a file the allowlist DOES cover. The allowlist forgives
     one exact value, not a file, so this must still be reported. */
  const inAllowed = scanner.scanEntries([{ name: ALLOWED_FILE, text: `"apiKey": "${FAKE_KEY}"\n` }]);
  const allowedHits = findingsFor(inAllowed, ALLOWED_FILE);
  assert.strictEqual(allowedHits.length, 1, "a NEW key planted in an allowlisted file was not reported; the allowlist is exempting the file");
  notes.push("planted key inside an allowlisted file: still detected");

  /* And on the same line as the value that IS forgiven: one finding, not zero. */
  const sameLine = scanner.scanEntries([{ name: ALLOWED_FILE, text: `{"a":"${ALLOWED_VALUE}","b":"${OTHER_FAKE_KEY}"}\n` }]);
  const sameLineHits = findingsFor(sameLine, ALLOWED_FILE);
  assert.strictEqual(sameLineHits.length, 1, "suppression is per line, not per match: a real key beside a forgiven one was hidden");
  assert.strictEqual(sameLine.suppressed.length, 1, "the forgiven value should still have been suppressed");
  notes.push("forgiven value and a planted key on ONE line: 1 suppressed, 1 reported");
}

/* ---- 3. removing or broadening the detector fails the control ----------- */

function testDetectorRemovalFails() {
  /* Remove a rule: the positive control must refuse to certify the scanner. */
  const withoutRule = compile(mutate(
    SCANNER_SOURCE,
    `  { id: "openai-key", why: "OpenAI API key", re: /\\bsk-[A-Za-z0-9_-]{20,}/ },\n`,
    "",
    "detector removal",
  ));
  report(
    "removing the openai-key rule",
    "no longer covers",
    caught(() => withoutRule.positiveControl()),
  );

  /* Broaden the private-key rule so it matches nothing real, without deleting it:
     the rule is still listed, so a "did we keep all nine rules" check would pass.
     The positive control is what notices. */
  const weakened = compile(mutate(
    SCANNER_SOURCE,
    "re: /-----BEGIN (RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/",
    "re: /-----BEGIN NOTHING-----/",
    "detector weakening",
  ));
  report(
    "weakening the private-key rule while leaving it listed",
    "blind to",
    caught(() => weakened.positiveControl()),
  );

  /* Broaden suppression from per-match back to per-file - the shape the allowlist
     had before this work. Nothing throws; the guarantee simply stops holding, so
     the control has to observe the missing finding itself. */
  const perFile = compile(mutate(
    SCANNER_SOURCE,
    "const entryFor = allowed.find((a) => a.values.includes(text));",
    "const entryFor = allowed[0];",
    "allowlist broadening",
  ));
  const broadened = perFile.scanEntries([{ name: ALLOWED_FILE, text: `"apiKey": "${FAKE_KEY}"\n` }]);
  assert.strictEqual(
    findingsFor(broadened, ALLOWED_FILE).length, 0,
    "the broadening mutation did not change behaviour, so it is not proving anything",
  );
  const narrow = scanner.scanEntries([{ name: ALLOWED_FILE, text: `"apiKey": "${FAKE_KEY}"\n` }]);
  assert.strictEqual(
    findingsFor(narrow, ALLOWED_FILE).length, 1,
    "the shipped scanner must still report a planted key in an allowlisted file",
  );
  notes.push("broadening suppression to whole-file hides a planted key; the shipped per-value form does not");
}

/* ---- 4. an invocation failure is not a clean result -------------------- */

function runScanner(args) {
  const result = spawnSync(process.execPath, [SCANNER_FILE, ...args], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout || ""}${result.stderr || ""}` };
}

function testInvocationFailureIsNotClean() {
  /* The original defect, pinned: no target is exit 2, and it must not look green. */
  const bare = runScanner([]);
  assert.strictEqual(bare.status, 2, `no-target invocation must exit 2, got ${bare.status}`);
  assert(/usage:/.test(bare.output), "a no-target invocation must print usage");
  assert(!/scan passed|^clean /m.test(bare.output), "a no-target invocation must not read as a clean scan");

  const bogus = runScanner(["--not-a-flag"]);
  assert.strictEqual(bogus.status, 2, `an unknown option must exit 2, got ${bogus.status}`);
  assert(!/scan passed/.test(bogus.output), "an unknown option must not read as a clean scan");

  const missing = runScanner([path.join(os.tmpdir(), "cinebraid-directory-that-does-not-exist")]);
  assert.notStrictEqual(missing.status, 0, "a missing scan target must not exit 0");
  assert(!/scan passed/.test(missing.output), "a missing scan target must not read as a clean scan");

  /* And the package script cannot fall back into the defect: it names its targets. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const stripped = pkg.scripts["check:secrets"].replace(/^node \S+/, "").trim();
  assert(stripped.length > 0, "check:secrets passes no target and would exit 2 on every run");

  notes.push("invocation failure: exit 2 with usage, unknown option 2, missing directory non-zero, none of them 'passed'");
}

/* ---- 5. the publication target reads the archive, not the working tree -- */

/* Proved against a throwaway repository rather than this one, so nothing here
   depends on the state of a checkout that other suites are reading. */
function testPublicationTargetReadsTheArchive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-publication-target-"));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "CineBraid Control");
    git("config", "user.email", "control@example.invalid");
    git("config", "commit.gpgsign", "false");
    /* The scratch repository is byte-compared, so line-ending translation would
       add noise to every run on a Windows checkout. */
    git("config", "core.autocrlf", "false");

    write(".gitattributes", "/private-notes.md export-ignore\n");
    write("shipped.md", "nothing to see here\n");
    write("private-notes.md", "excluded from every archive\n");
    git("add", "-A");
    git("commit", "-q", "-m", "control commit");

    /* export-ignore is applied by `git archive` and by nothing else, so its effect
       is the fingerprint that tells the two targets apart. */
    const committedNames = new Set(scanner.publicationTreeEntries("HEAD", dir).map((e) => e.name));
    const trackedNames = new Set(scanner.workingTreeEntries(dir).map((e) => e.name));
    assert(committedNames.has("shipped.md"), "the publication target did not read the archive at all");
    assert(!committedNames.has("private-notes.md"), "the publication target is not honouring export-ignore, so it is not the archive");
    assert(trackedNames.has("private-notes.md"), "the working-tree target should still see an export-ignored file");
    notes.push("publication target honours export-ignore; working-tree target does not — they are different sources");

    /* An uncommitted secret: the working tree sees it, the archive cannot. */
    write("shipped.md", `key: ${FAKE_KEY}\n`);
    const working = scanner.scanEntries(scanner.workingTreeEntries(dir));
    assert.strictEqual(findingsFor(working, "shipped.md").length, 1, "the working-tree target did not read the file from disk");
    const published = scanner.scanEntries(scanner.publicationTreeEntries("HEAD", dir));
    assert.strictEqual(findingsFor(published, "shipped.md").length, 0, "the publication target read the working tree instead of the commit");
    notes.push("uncommitted planted key: seen by the working-tree target, absent from the publication target");

    /* Once committed, the archive carries it and the scan must fail. */
    git("add", "-A");
    git("commit", "-q", "-m", "control: commit the planted key");
    const afterCommit = scanner.scanEntries(scanner.publicationTreeEntries("HEAD", dir));
    assert.strictEqual(findingsFor(afterCommit, "shipped.md").length, 1, "a committed planted key was not found in the publication tree");
    assert.strictEqual(afterCommit.findings[0].rule, "openai-key", "the wrong rule fired on the publication tree");
    notes.push("committed planted key: found in the publication tree as openai-key");

    /* And the release build's own entry point reads those same archive bytes. */
    const archiveTar = execFileSync("git", ["archive", "--format=tar", "--prefix=pkg/", "HEAD"], { cwd: dir, maxBuffer: 1 << 26 });
    const fromTar = scanner.scanEntries(scanner.tarTextEntries(archiveTar, "pkg/"));
    assert.strictEqual(findingsFor(fromTar, "shipped.md").length, 1, "scanning a prefixed tar buffer did not reproduce the finding");
    notes.push("the same finding is reproduced from a prefixed tar buffer, which is what build-release.js hands the scanner");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---- the repository was not modified ------------------------------------- */

/* Compared against a snapshot taken before the controls ran, not against an empty
   status: this suite has to pass on a working branch, and the point is that IT
   changed nothing - not that nobody else has. Scoped to the two directories a
   mutation here could reach, because the runner puts three other suites on the
   same checkout. */
function sourceStatus() {
  return execFileSync("git", ["status", "--porcelain", "--", "scripts", "tests"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").map((line) => line.trim()).filter(Boolean).sort();
}

const STATUS_BEFORE = sourceStatus();

function testNothingWasWritten() {
  assert.strictEqual(
    fs.readFileSync(SCANNER_FILE, "utf8"),
    SCANNER_BYTES,
    "the scanner on disk was modified; every mutation in this suite must be compiled in memory",
  );
  assert.deepStrictEqual(
    sourceStatus(),
    STATUS_BEFORE,
    "this suite changed the working tree; every mutation must be compiled in memory and every scratch repository removed",
  );
  notes.push(`working tree unchanged: scripts/ and tests/ status identical before and after (${STATUS_BEFORE.length} entries)`);
}

testAllowedFixturePasses();
testPlantedSecretIsDetected();
testDetectorRemovalFails();
testInvocationFailureIsNotClean();
testPublicationTargetReadsTheArchive();
testNothingWasWritten();

console.log(`Public exposure negative controls passed (${notes.length} receipts):`);
for (const note of notes) console.log(`  - ${note}`);

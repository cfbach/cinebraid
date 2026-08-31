/* Negative controls for the public-exposure credential scan.

   tests/public-exposure.js asserts the scan is clean. A clean answer is only
   worth something if the same machinery can be shown to report a dirty one, and
   the audit that opened this work found a scan that had literally never run:
   `npm run check:secrets` invoked the scanner with no target, printed usage and
   exited 2, and no gate noticed because 2 looks like "nothing to say".

   Each control makes the guarantee false and watches the right thing fail for
   the right reason:

     1. a known synthetic fixture value does NOT fail the scan;
     2. a fake secret in a location the allowlist does not cover IS detected -
        including inside a file the allowlist does cover, because suppression is
        per matched value and not per file;
     3. removing a rule, or broadening suppression back to whole-file, makes the
        control fail;
     4. an invocation failure is distinguishable from a clean result;
     5. the publication-tree target really reads `git archive` output, not the
        working tree;
     6. a credential committed and then DELETED before the tip is still published
        by a `main` push, and the history range is what sees it;
     7. removing that history scan makes the publication guard clear an unsafe
        candidate;
     8. path identity survives history enumeration, so one blob at two paths is
        forgiven at the allowlisted one and reported at the other;
     9. every exit code is asserted exactly - 0 clean, 1 findings, 2 could not
        scan - because the defect being fixed was three operational failures
        arriving dressed as findings, which "assert non-zero" cannot see;
    10. an inability is never rewritten into a clean answer.

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

const PREFLIGHT_FILE = path.join(ROOT, "scripts", "publication-preflight.js");
const PREFLIGHT_BYTES = fs.readFileSync(PREFLIGHT_FILE, "utf8");
const PREFLIGHT_SOURCE = PREFLIGHT_BYTES.replace(/\r\n/g, "\n");
const { preflight } = require(PREFLIGHT_FILE);

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

function compilePreflight(source) {
  const compiled = new Module(PREFLIGHT_FILE, null);
  compiled.filename = PREFLIGHT_FILE;
  compiled.paths = Module._nodeModulePaths(path.dirname(PREFLIGHT_FILE));
  compiled._compile(source, PREFLIGHT_FILE);
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

/* ---- 6. a secret deleted before the tip is still published --------------- */

/* The gap this section exists for, reproduced exactly:

     A  clean baseline
     B  commit a fake credential
     C  delete the file and commit the deletion

   At C the working tree is clean and `git archive HEAD` is clean, so a tip-only
   scan certifies the branch - and pushing A..C hands the reader a repository from
   which `git cat-file` still returns the credential. Every assertion below is
   about that one fact. */

function makeRepo(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cinebraid-${label}-`));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 1 << 26 });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "CineBraid Control");
  git("config", "user.email", "control@example.invalid");
  git("config", "commit.gpgsign", "false");
  /* Byte comparisons below, so no line-ending translation. */
  git("config", "core.autocrlf", "false");
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = (message) => { git("add", "-A"); git("commit", "-q", "-m", message); return git("rev-parse", "HEAD").trim(); };
  return { dir, git, write, commit };
}

function buildABC() {
  const repo = makeRepo("abc");
  repo.write("shipped.md", "clean baseline\n");
  const A = repo.commit("A: clean baseline");
  repo.write("leaked.env", `OPENAI_API_KEY=${FAKE_KEY}\n`);
  const B = repo.commit("B: a credential lands");
  fs.rmSync(path.join(repo.dir, "leaked.env"));
  const C = repo.commit("C: and is deleted again");
  return { ...repo, A, B, C };
}

function testDeletedSecretIsStillPublished() {
  const repo = buildABC();
  try {
    /* The tip is genuinely clean, which is what makes this dangerous. */
    const working = scanner.scanEntries(scanner.workingTreeEntries(repo.dir));
    assert.deepStrictEqual(working.findings, [], "the working tree at C should be clean; the control is not set up as described");
    const archive = scanner.scanEntries(scanner.publicationTreeEntries("HEAD", repo.dir));
    assert.deepStrictEqual(archive.findings, [], "the HEAD archive at C should be clean; the control is not set up as described");
    notes.push("A→B→C: working tree and HEAD archive at C both clean — a tip-only scan certifies this branch");

    /* And the credential is one command away in the repository a push produces. */
    const blob = repo.git("rev-parse", `${repo.B}:leaked.env`).trim();
    const recovered = execFileSync("git", ["cat-file", "blob", blob], { cwd: repo.dir, encoding: "utf8" });
    assert(recovered.includes(FAKE_KEY), "the planted credential is not recoverable from C; the control proves nothing");

    /* The history range is what sees it. */
    const range = scanner.historyRangeEntries(repo.A, repo.C, repo.dir);
    const history = scanner.scanEntries(range.entries);
    const hits = history.findings.filter((f) => f.file === "leaked.env");
    assert.strictEqual(hits.length, 1, `the history scan of A..C did not report the deleted credential (${history.findings.length} findings)`);
    assert.strictEqual(hits[0].rule, "openai-key", `the wrong rule fired: ${hits[0].rule}`);
    assert.strictEqual(hits[0].commit, repo.B, "the finding must name commit B, which is the only place the content exists");
    notes.push("A→B→C: the history range A..C reports leaked.env as openai-key and names commit B");

    /* Deleting it before the tip changed nothing about what publishing exposes. */
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-abc-bare-"));
    try {
      execFileSync("git", ["init", "-q", "--bare", bare]);
      execFileSync("git", ["push", "-q", bare, "main:refs/heads/main"], { cwd: repo.dir });
      const published = execFileSync("git", ["cat-file", "blob", blob], { cwd: bare, encoding: "utf8" });
      assert(published.includes(FAKE_KEY), "the pushed repository did not carry the deleted blob; the premise is wrong");
      notes.push("A→B→C: pushing main:refs/heads/main into a bare repository transfers the deleted blob intact");
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }

    /* And the preflight refuses C, which is the seam that matters. */
    const lines = [];
    const code = preflight(["--repo", repo.dir, "--candidate", "HEAD", "--public-sha", repo.A], (line) => lines.push(line));
    assert.strictEqual(code, 1, `the publication preflight cleared an unsafe candidate (exit ${code})`);
    const printed = lines.join("\n");
    assert(/REFUSED/.test(printed), "the preflight refusal must say so");
    assert(printed.includes("leaked.env"), "the preflight must name the file it refused for");
    assert(!/git push https/.test(printed), "a refused preflight must not print the push command");
    notes.push("A→B→C: the publication preflight exits 1 on C, names leaked.env, and prints no push command");
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
}

/* ---- 7. removing the history gate makes the guard accept C --------------- */

function testRemovingTheHistoryGateIsObservable() {
  const repo = buildABC();
  try {
    /* Bypass the history scan the way a well-meaning refactor would: keep every
       other step, drop the one that reads history. */
    const bypassed = compilePreflight(mutate(
      PREFLIGHT_SOURCE,
      "  const history = scanner.scanEntries(range.entries);",
      "  const history = { findings: [], suppressed: [], files: 0 };",
      "history gate bypass",
    ));
    const cleared = [];
    const code = bypassed.preflight(["--repo", repo.dir, "--candidate", "HEAD", "--public-sha", repo.A], (l) => cleared.push(l));
    assert.strictEqual(code, 0, "the bypass mutation did not change behaviour, so it is not proving anything");
    assert(/CLEARED/.test(cleared.join("\n")), "the bypassed preflight should have cleared the unsafe candidate");

    /* The shipped one does not. */
    const shipped = [];
    assert.strictEqual(
      preflight(["--repo", repo.dir, "--candidate", "HEAD", "--public-sha", repo.A], (l) => shipped.push(l)),
      1,
      "the shipped preflight must refuse C",
    );
    notes.push("removing the history scan clears an unsafe candidate; the shipped preflight refuses it");

    /* And the same for the enumeration itself: a range that only looks at the tip
       tree - the mistake the first version of this work shipped - sees nothing. */
    const tipOnly = scanner.scanEntries(scanner.publicationTreeEntries(repo.C, repo.dir));
    assert.deepStrictEqual(tipOnly.findings, [], "the tip tree at C is clean, which is the whole point");
    const full = scanner.scanEntries(scanner.historyRangeEntries(repo.A, repo.C, repo.dir).entries);
    assert.strictEqual(full.findings.length, 1, "the history range must see what the tip cannot");
    notes.push("tip tree: 0 findings; newly exposed history: 1 — the two boundaries are not interchangeable");
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
}

/* ---- 8. path identity survives history enumeration ---------------------- */

/* The allowlist forgives an exact value at an exact path. `rev-list --objects`
   prints one path per blob, so an enumeration built on it would forgive the
   allowlisted path and then stay silent about the identical content sitting
   somewhere it is not allowed. */
function testPathIdentityInHistory() {
  const repo = makeRepo("path-identity");
  const ALLOWED = "tests/fixtures/ofp-legacy/secret-traps.json";
  try {
    repo.write("README.md", "baseline\n");
    const A = repo.commit("A: baseline");

    /* One blob, two paths: the allowlisted fixture and an ordinary source file. */
    const body = `{"apiKey": "${ALLOWED_VALUE}"}\n`;
    repo.write(ALLOWED, body);
    repo.write("server.js", body);
    const B = repo.commit("B: the same content at an allowed path and an ordinary one");

    const range = scanner.historyRangeEntries(A, B, repo.dir);
    const paths = range.entries.map((e) => e.name).sort();
    assert(paths.includes(ALLOWED) && paths.includes("server.js"),
      `both paths must be enumerated separately, got: ${paths.join(", ")}`);
    const blobs = new Set(range.entries.filter((e) => e.name === ALLOWED || e.name === "server.js").map((e) => e.blob));
    assert.strictEqual(blobs.size, 1, "the control needs one blob at two paths to be meaningful");

    const scanned = scanner.scanEntries(range.entries);
    assert.strictEqual(scanned.findings.filter((f) => f.file === ALLOWED).length, 0,
      "the allowlisted path must stay suppressed inside a history scan");
    assert.strictEqual(scanned.suppressed.filter((s) => s.file === ALLOWED).length, 1,
      "the allowlisted path's suppression must be recorded");
    assert.strictEqual(scanned.findings.filter((f) => f.file === "server.js").length, 1,
      "identical content at a path the allowlist does not cover must still be reported");
    notes.push("history: one blob at two paths — suppressed at the allowlisted path, reported at the other");

    /* And a second, different secret at the allowed path is still reported. */
    repo.write(ALLOWED, `{"a": "${ALLOWED_VALUE}", "b": "${OTHER_FAKE_KEY}"}\n`);
    const C = repo.commit("C: a second, unlisted key at the allowed path");
    const later = scanner.scanEntries(scanner.historyRangeEntries(B, C, repo.dir).entries);
    assert.strictEqual(later.findings.filter((f) => f.file === ALLOWED).length, 1,
      "a NEW key at an allowlisted path must be reported in history, exactly as it is at the tip");
    assert.strictEqual(later.suppressed.length, 1, "the forgiven value must still be suppressed on that line");
    notes.push("history: a second unlisted key at the allowlisted path is reported, the forgiven one suppressed");
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
}

/* ---- 9. exact exit codes, not "non-zero" -------------------------------- */

/* The defect this replaces: clean 0, finding 1, and then an empty directory, a
   missing directory and an invalid ref ALSO 1 - so every operational failure
   arrived dressed as a finding. Asserting `!== 0` would have passed throughout. */
function testExactExitCodes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-exit-"));
  const repo = buildABC();
  /* A second repository whose range is non-empty AND clean, so exit 0 is proved
     over real history rather than over an empty range - which is exit 2. */
  const calm = makeRepo("exit-clean");
  calm.write("one.md", "first\n");
  const calmA = calm.commit("first");
  calm.write("two.md", "second\n");
  const calmB = calm.commit("second");
  try {
    const clean = path.join(dir, "clean");
    fs.mkdirSync(clean);
    fs.writeFileSync(path.join(clean, "a.txt"), "nothing here\n");

    const dirty = path.join(dir, "dirty");
    fs.mkdirSync(dirty);
    fs.writeFileSync(path.join(dirty, "a.txt"), `key: ${FAKE_KEY}\n`);

    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty);

    const cases = [
      [0, "a clean target", [clean]],
      [1, "a target containing a fake secret", [dirty]],
      [1, "a history range containing a deleted secret", ["--repo", repo.dir, "--history-range", `${repo.A}..${repo.C}`]],
      [0, "a non-empty history range containing nothing disallowed", ["--repo", calm.dir, "--history-range", `${calmA}..${calmB}`]],
      [2, "a missing target", [path.join(dir, "not-here")]],
      [2, "an existing but empty target", [empty]],
      [2, "an invalid publication ref", ["--publication-tree", "no-such-ref-at-all"]],
      [2, "an invalid history range", ["--repo", repo.dir, "--history-range", "nope..alsonope"]],
      [2, "a malformed history range", ["--history-range", "notarange"]],
      [2, "an empty history range", ["--repo", repo.dir, "--history-range", `${repo.C}..${repo.C}`]],
      [2, "a missing --repo", ["--repo", path.join(dir, "not-here"), "--working-tree"]],
      [2, "no target at all", []],
      [2, "an unknown option", ["--not-a-flag"]],
    ];

    for (const [want, label, args] of cases) {
      const result = runScanner(args);
      assert.strictEqual(result.status, want,
        `${label} must exit ${want}, got ${result.status}\n${result.output.split("\n").slice(-4).join("\n")}`);
      if (want === 2) {
        assert(!/scan passed/.test(result.output), `${label} exited 2 but printed a passing line`);
        assert(!/^clean /m.test(result.output), `${label} exited 2 but printed a clean line`);
      }
      if (want === 0) assert(/scan passed/.test(result.output), `${label} exited 0 without saying it passed`);
      if (want === 1) assert(/scan failed with/.test(result.output), `${label} exited 1 without naming its findings`);
    }
    notes.push(`exact exit codes: ${cases.length} invocations, each asserted against one code — 0 clean, 1 findings, 2 could not scan`);

    /* The preflight speaks the same three codes. */
    const quiet = () => {};
    assert.strictEqual(
      caught(() => preflight(["--repo", repo.dir, "--candidate", "HEAD", "--public-sha", repo.C], quiet)) ? 2 : 0,
      2, "an empty publication range must be a refusal",
    );
    const notAncestor = caught(() => preflight(["--repo", repo.dir, "--candidate", repo.A, "--public-sha", repo.C], quiet));
    assert(notAncestor && /not an ancestor|checkout is at/.test(notAncestor.message),
      `a non-ancestor baseline must be refused, got: ${notAncestor && notAncestor.message}`);
    const unknownBase = caught(() => preflight(["--repo", repo.dir, "--candidate", "HEAD", "--public-sha", "0".repeat(40)], quiet));
    assert(unknownBase, "an unknown baseline must be refused");
    const noBase = caught(() => preflight(["--repo", repo.dir, "--candidate", "HEAD"], quiet));
    assert(noBase && /name the baseline/.test(noBase.message), "the preflight must refuse without a baseline");
    notes.push("preflight refusals: empty range, non-ancestor baseline, unknown baseline and absent baseline all refuse rather than clear");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(calm.dir, { recursive: true, force: true });
  }
}

/* ---- 10. inability is never rewritten as a clean answer ----------------- */

function testInabilityIsNeverClean() {
  /* Every failure mode the scanner can hit inside a completed run must raise,
     not return an empty result that scanEntries would happily call clean. */
  const repo = makeRepo("inability");
  try {
    repo.write("a.md", "x\n");
    repo.commit("only commit");

    for (const [label, fn] of [
      ["an invalid ref", () => scanner.publicationTreeEntries("no-such-ref", repo.dir)],
      ["an invalid history head", () => scanner.historyRangeEntries(null, "no-such-ref", repo.dir)],
      ["an invalid history base", () => scanner.historyRangeEntries("no-such-base", "HEAD", repo.dir)],
      ["a directory that does not exist", () => scanner.directoryEntries(path.join(repo.dir, "nope"))],
      ["a working tree outside any repository", () => scanner.workingTreeEntries(os.tmpdir())],
    ]) {
      const failure = caught(fn);
      assert(failure, `${label} returned a value instead of raising; an empty answer would read as clean`);
      assert(failure instanceof scanner.ScanError, `${label} raised ${failure.name}, not a ScanError`);
    }
    notes.push("inability: five failure modes each raise ScanError rather than returning an empty, clean-looking result");
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
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
  assert.strictEqual(
    fs.readFileSync(PREFLIGHT_FILE, "utf8"),
    PREFLIGHT_BYTES,
    "the preflight on disk was modified; every mutation in this suite must be compiled in memory",
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
testDeletedSecretIsStillPublished();
testRemovingTheHistoryGateIsObservable();
testPathIdentityInHistory();
testExactExitCodes();
testInabilityIsNeverClean();
testNothingWasWritten();

console.log(`Public exposure negative controls passed (${notes.length} receipts):`);
for (const note of notes) console.log(`  - ${note}`);

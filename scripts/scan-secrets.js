/* Credential and privacy scan for what CineBraid actually publishes.

   Usage:
     node scripts/scan-secrets.js --working-tree
     node scripts/scan-secrets.js --publication-tree [<commit-ish>]
     node scripts/scan-secrets.js --history-range <base>..<head>
     node scripts/scan-secrets.js <dir> [<dir> ...]
     ... any of the above with --repo <dir> to act on another repository

   Any combination may be given; every named target is scanned and the process
   exits non-zero if any of them reports a finding.

     --working-tree      every TRACKED file as it currently sits on disk. Tracked,
                         not "everything under the root": a developer's real
                         data/config.json holds provider keys and is gitignored, so
                         a filesystem walk would fail on a machine that is working
                         correctly and teach everyone to ignore this scan.
     --publication-tree  the exact bytes `git archive` produces for a commit, which
                         is what scripts/build-release.js ships and what a public
                         push would carry. This honours .gitattributes export-ignore,
                         so it is the publication tree rather than the source tree.
     --history-range     every file version made newly reachable by publishing
                         <head> when <base> is already published. Base exclusive,
                         head inclusive. See "history range" below for why the two
                         targets above cannot stand in for this one.
     <dir>               a staged package or an extracted archive on disk.

   THE TWO BOUNDARIES ARE DIFFERENT, and both are needed.

   The working tree and the publication tree answer "what do the current bytes
   contain". A public `main` push transfers HISTORY, so it also answers for every
   commit it makes reachable. Measured: commit a fake key, delete the file, commit
   the deletion. The working tree is clean, `git archive HEAD` is clean, and both
   scans report clean - yet pushing that branch hands the reader a repository from
   which `git cat-file` still returns the key. Deleting a secret before HEAD does
   not unpublish it, so a HEAD-only scan cannot be the publication gate.

   Exit codes, and they are load-bearing:

     0  the requested scan completed and found nothing disallowed
     1  the requested scan completed and found something disallowed
     2  the scan could not truthfully be completed

   2 covers an invalid or missing target, an invalid ref or range, a git
   enumeration failure, an unreadable source, and a target that resolved to no
   content when the request said content must exist. Anything unexpected is also
   2. A caller may treat 1 as "there is something to fix" only because 2 exists to
   mean "I do not know" - collapsing the two, which this scanner used to do, turns
   every operational failure into a finding and every reader into someone who
   stops reading exit codes.

   A scanner that reports "clean" is worthless unless it can be shown to report
   anything at all, so every run first proves itself against a synthetic
   positive control: a throwaway directory of fake credentials written to the
   OS temp area, never inside the repository or the package. If the control
   does not trip every rule, the scan fails rather than reporting a clean run.
   Every target additionally reports how many files it read, and a target that
   read none fails: a clean answer over zero files is the other way this check
   could silently stop working.

   The synthetic values below are invented for this control. They are not real
   credentials and are never written into any release artifact. */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const RULES = [
  /* `fal-` alone is not a signal: the tree is full of fal-generation.js,
     .fal-settings, fal-diagnostic-job-1 and fal-h3-prompt-edit-reason. A key is
     one long token carrying digits; those are hyphenated words. Disallowing the
     hyphen after the prefix separates them. */
  { id: "fal-key", why: "FAL API key", re: /\bfal-(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{20,}\b/ },
  { id: "openai-key", why: "OpenAI API key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { id: "anthropic-key", why: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: "github-token", why: "GitHub token", re: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { id: "aws-key", why: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private-key", why: "private key block", re: /-----BEGIN (RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "bearer", why: "hard-coded bearer token", re: /\bBearer\s+[A-Za-z0-9._-]{24,}/ },
  { id: "git-credential", why: "credential URL with a password", re: /https?:\/\/[^\s/:@]+:[^\s/@]+@/ },
  { id: "personal-path", why: "a personal filesystem path", re: /(^|[^A-Za-z0-9])[A-Za-z]:\\Users\\(?!(Public|Default|All Users)\b)[A-Za-z0-9._-]+|\/(?:home|Users)\/(?!(?:runner|shared|Shared)\b)[A-Za-z0-9._-]+\// },
];

const BINARY = /\.(png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|m4a|flac|ogg|zip|gz|tgz|ico|woff2?|ttf|otf|pdf)$/i;

/* Known synthetic values, allowed by exact file, exact rule and exact matched
   text - never by file alone and never by pattern.

   Three properties make this list safe to have:

     1. Suppression is per MATCH, not per line. A line carrying a listed fixture
        value AND a real credential still reports the real one, because only the
        matched substring that equals a listed value is dropped.
     2. The value is the exact text the rule matched. Edit the fixture and the
        suppression stops applying, which fails closed.
     3. tests/public-exposure.js asserts every entry still suppresses something.
        A stale entry is a dead entry, and a dead entry is how an allowlist grows
        into a blanket.

   There is deliberately no "anything under tests/" rule, and the list is not a
   tests-only list either: the last entry is production source, `ofp/ofp-migrate-scan.js`,
   whose comment names the already-elided shape of the leak that module exists to
   catch. It is listed one exact value at a time like everything else. */
const ALLOW = [
  {
    file: "tests/automation-diagnostics.js",
    rule: "openai-key",
    values: ["sk-SECRETERRORKEY123456789012345678901234"],
    why: "a synthetic key the suite feeds through the diagnostic redactor to prove secrets are stripped from support bundles",
  },
  {
    file: "tests/readiness-feedback.js",
    rule: "openai-key",
    values: ["sk-abcdefghijklmnopqrstuvwxyz1234567890"],
    why: "a synthetic key posted to /api/test-feedback to prove feedback notes are redacted before they are stored",
  },
  {
    file: "tests/readiness-feedback.js",
    rule: "personal-path",
    values: ["/home/tester/"],
    why: "a synthetic local path posted alongside that key, asserting personal paths are redacted too",
  },
  {
    file: "tests/local-only-policy.js",
    rule: "git-credential",
    values: ["http://127.0.0.1:11436@"],
    why: "a URL whose user info is shaped like a loopback address, asserting the local-only check reads the host and not the credentials",
  },
  {
    file: "tests/fixtures/ofp-legacy/secret-traps.json",
    rule: "fal-key",
    values: ["fal-0000000000000000000000000000000000000000"],
    why: "the OFP migration trap document: an all-zero placeholder the migration must refuse to serialise",
  },
  {
    file: "tests/fixtures/ofp-legacy/secret-traps.json",
    rule: "openai-key",
    values: ["sk-should-never-be-serialised"],
    why: "the trap document's provider key, named after the assertion it exists to make",
  },
  {
    file: "tests/fixtures/ofp-legacy/secret-traps.json",
    rule: "git-credential",
    values: ["https://user:hunter2@"],
    why: "the trap document's credential URL, on the reserved example.invalid domain",
  },
  {
    file: "tests/fixtures/ofp-legacy/secret-traps.json",
    rule: "personal-path",
    values: ["/Users/somebody/"],
    why: "the trap document's machine-specific media root, which the migration must strip",
  },
  {
    file: "tests/ofp-migration.js",
    rule: "openai-key",
    values: ["sk-should-never-be-serialised"],
    why: "the migration suite asserting the trap document's key is absent from the portable output",
  },
  {
    file: "tests/ofp-migration-negative-controls.js",
    rule: "openai-key",
    values: ["sk-should-never-be-serialised"],
    why: "the negative controls asserting a broken redactor lets the trap document's key through",
  },
  {
    file: "tests/ofp-migration-negative-controls.js",
    rule: "fal-key",
    values: ["fal-0000000000000000000000000000000000000000"],
    why: "the same negative control for the trap document's FAL placeholder",
  },
  {
    file: "tests/media-asset-identity.js",
    rule: "personal-path",
    values: ["/home/user/"],
    why: "a generic absolute path in the table of paths isProjectRelativePath must reject",
  },
  {
    file: "ofp/ofp-migrate-scan.js",
    rule: "personal-path",
    values: ["`C:\\Users\\..."],
    why: "a doc comment naming the already-elided shape of the leak that scan exists to catch; there is no account name in it",
  },
];

/* ---- inability is not a finding ------------------------------------------ */

/* Everything that means "I could not do what you asked" is this error, and the
   CLI maps it - and any other unexpected throw - to exit 2. Nothing may reach
   exit 1 except a scan that ran to completion and found something. */
class ScanError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScanError";
  }
}

/* ---- reading targets ----------------------------------------------------- */

/* `cwd` is a parameter because the negative controls prove the difference between
   the git-backed targets against a throwaway repository, rather than by mutating
   this one while other suites are reading it. */
/* stderr is captured rather than inherited, so a deliberately invalid ref in a
   control does not print `fatal:` into a passing suite's output as if something
   had gone wrong. gitOrFail reads it back out of the error. */
function git(args, cwd = ROOT, opts = {}) {
  return execFileSync("git", args, { cwd, maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...opts });
}

/* Any git failure is an inability to scan, never a finding. The stderr is kept
   because "invalid ref" and "not a repository" need different fixes. */
function gitOrFail(args, cwd, what, opts = {}) {
  try {
    return git(args, cwd, opts);
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim().split("\n")[0];
    throw new ScanError(`${what}: git ${args.slice(0, 2).join(" ")} failed — ${detail}`);
  }
}

function revParse(rev, cwd, what) {
  return gitOrFail(["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`], cwd, what)
    .toString("utf8").trim();
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function walk(root, current = root, out = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const file = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(root, file, out);
    } else if (!BINARY.test(entry.name)) {
      out.push(file);
    }
  }
  return out;
}

/* A directory on disk: a staged package, or an extracted archive. */
function directoryEntries(root) {
  if (!fs.existsSync(root)) throw new ScanError(`scan target does not exist: ${root}`);
  let files;
  try {
    files = walk(root);
  } catch (error) {
    throw new ScanError(`scan target could not be read: ${root} — ${error.message}`);
  }
  const entries = [];
  for (const file of files) {
    const text = readText(file);
    if (text == null) continue;
    entries.push({ name: path.relative(root, file).replace(/\\/g, "/"), text });
  }
  return entries;
}

/* Every tracked file as it currently sits on disk. */
function workingTreeEntries(root = ROOT) {
  const listed = gitOrFail(["ls-files", "-z"], root, "working tree")
    .toString("utf8").split("\0").filter(Boolean);
  const entries = [];
  for (const rel of listed) {
    if (BINARY.test(rel)) continue;
    const text = readText(path.join(root, rel));
    if (text == null) continue;
    entries.push({ name: rel, text });
  }
  return entries;
}

/* ustar: a 512-byte header, then the body padded to 512. A path longer than 100
   bytes is split across `prefix` and `name`; reading only `name` would reduce a
   deep path to its basename and silently mis-attribute every finding in it. */
function tarTextEntries(buffer, stripPrefix = "") {
  const entries = [];
  for (let off = 0; off + 512 <= buffer.length; ) {
    const field = (start, len) => buffer.toString("utf8", off + start, off + start + len).replace(/\0.*$/, "");
    const name = field(0, 100);
    if (!name) break;
    const size = parseInt(field(124, 12).trim(), 8) || 0;
    const typeflag = buffer.toString("ascii", off + 156, off + 157);
    const prefix = field(345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    const body = off + 512;
    off = body + Math.ceil(size / 512) * 512;
    /* "0" and NUL are regular files. "5" is a directory; "g"/"x" are pax headers,
       which git emits and which are not package contents. */
    if (typeflag !== "0" && typeflag !== "\0") continue;
    if (BINARY.test(full)) continue;
    const rel = stripPrefix && full.startsWith(stripPrefix) ? full.slice(stripPrefix.length) : full;
    entries.push({ name: rel, text: buffer.toString("utf8", body, body + size) });
  }
  return entries;
}

/* Exactly what `git archive` would ship for a commit. */
function publicationTreeEntries(ref = "HEAD", root = ROOT) {
  return tarTextEntries(gitOrFail(["archive", "--format=tar", ref], root, `publication tree ${ref}`));
}

/* ---- history range ------------------------------------------------------- */

/* Every (path, blob) pair in one commit's whole tree.

   Whole tree, not a diff. A merge commit's diff against a chosen parent hides
   whatever the other parent brought, and there is no parent choice that is right
   for every topology - so the enumeration below asks each newly reachable commit
   what it CONTAINS and subtracts what the base already contained. That is
   independent of merge shape by construction. */
function treePairs(commit, root) {
  const out = [];
  /* The default `<mode> SP <type> SP <object> TAB <path>` form, not --format,
     which git only learned in 2.36. --full-tree so paths are repository-relative
     whatever directory this was invoked from - the allowlist is written in
     repository-relative paths and nothing else would match it. */
  const listing = gitOrFail(["ls-tree", "-r", "-z", "--full-tree", commit], root, `tree of ${commit}`)
    .toString("utf8");
  for (const row of listing.split("\0")) {
    if (!row) continue;
    const tab = row.indexOf("\t");
    if (tab < 0) throw new ScanError(`unreadable tree row for ${commit}: ${row.slice(0, 60)}`);
    const [, type, blob] = row.slice(0, tab).split(/\s+/);
    if (type !== "blob") continue;
    out.push({ blob, path: row.slice(tab + 1) });
  }
  return out;
}

/* Blob contents, one git process per chunk rather than one per blob. */
function catFileBatch(shas, root) {
  const out = new Map();
  const unique = [...new Set(shas)];
  const CHUNK = 512;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const buffer = gitOrFail(["cat-file", "--batch"], root, "reading historical blobs", { input: `${batch.join("\n")}\n` });
    let off = 0;
    while (off < buffer.length) {
      const nl = buffer.indexOf(0x0a, off);
      if (nl < 0) break;
      const [sha, type, size] = buffer.toString("utf8", off, nl).split(" ");
      /* `<sha> missing` means the enumeration and the object store disagree. That
         is an inability to scan, not an empty answer. */
      if (type !== "blob") throw new ScanError(`git cat-file could not read ${sha}: ${type || "unknown"}`);
      const start = nl + 1;
      const length = Number(size);
      if (!Number.isFinite(length)) throw new ScanError(`git cat-file returned an unreadable size for ${sha}`);
      out.set(sha, buffer.toString("utf8", start, start + length));
      off = start + length + 1;
    }
    for (const sha of batch) {
      if (!out.has(sha)) throw new ScanError(`git cat-file returned nothing for ${sha}`);
    }
  }
  return out;
}

/* Every file version made newly reachable by publishing `head` over `base`.

   Keyed by (path, blob), never by blob alone. The allowlist forgives an exact
   value at an exact path, so two paths sharing one blob are two different
   questions and de-duplicating on the blob would answer only one of them - the
   same flaw the earlier audit found in `rev-list --objects`, which prints one
   path per object. (path, blob) is safe to de-duplicate on because a finding is a
   function of exactly those two things.

   `base` may be null, which means "no published baseline": everything reachable
   from head is newly exposed. */
function historyRangeEntries(base, head, root = ROOT) {
  const headSha = revParse(head, root, `history head ${head}`);
  const baseSha = base ? revParse(base, root, `history base ${base}`) : null;

  const range = baseSha ? `${baseSha}..${headSha}` : headSha;
  const commits = gitOrFail(["rev-list", "--reverse", range], root, `history range ${range}`)
    .toString("utf8").split("\n").map((s) => s.trim()).filter(Boolean);

  /* Seed with what the baseline already published, so an established public
     repository is not re-reported for content it has carried for months. */
  const seen = new Set();
  let treeRows = 0;
  if (baseSha) {
    for (const { blob, path: p } of treePairs(baseSha, root)) {
      seen.add(`${p}\0${blob}`);
      treeRows += 1;
    }
  }

  const wanted = [];
  for (const commit of commits) {
    const rows = treePairs(commit, root);
    treeRows += rows.length;
    for (const { blob, path: p } of rows) {
      const key = `${p}\0${blob}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (BINARY.test(p)) continue;
      wanted.push({ blob, path: p, commit });
    }
  }

  /* A range with commits in it must have produced tree rows. Zero here means the
     enumeration failed quietly, which must never read as a clean scan. */
  if (commits.length && !treeRows) {
    throw new ScanError(`history range ${range} enumerated ${commits.length} commit(s) and no tree content`);
  }

  const texts = catFileBatch(wanted.map((w) => w.blob), root);
  return {
    base: baseSha,
    head: headSha,
    commits,
    treeRows,
    entries: wanted.map((w) => ({ name: w.path, text: texts.get(w.blob), commit: w.commit, blob: w.blob })),
  };
}

/* ---- scanning ------------------------------------------------------------ */

const SELF = path.basename(__filename);

function allowedFor(rel, ruleId) {
  return ALLOW.filter((a) => a.file === rel && a.rule === ruleId);
}

/* Returns { findings, suppressed, files }. `suppressed` records which ALLOW
   entry fired, so a run can be read for what it dropped as well as what it kept,
   and so a test can prove no entry has gone stale. */
function scanEntries(entries) {
  const findings = [];
  const suppressed = [];
  let files = 0;

  for (const entry of entries) {
    const rel = entry.name;
    /* The rule table necessarily contains every pattern the scanner looks for,
       and the allowlist necessarily contains every value it forgives, so scanning
       this file would report a finding on each. Matched by name, because the copy
       inside a package is not this running file. */
    if (path.basename(rel) === SELF) continue;
    files += 1;

    const lines = entry.text.split(/\r?\n/);
    for (const rule of RULES) {
      if (!rule.re.test(entry.text)) continue;
      const allowed = allowedFor(rel, rule.id);
      const global = new RegExp(rule.re.source, "g");
      lines.forEach((line, i) => {
        for (const match of line.matchAll(global)) {
          const text = match[0];
          const entryFor = allowed.find((a) => a.values.includes(text));
          /* `commit` is present only for history entries; it tells an operator
             which commit to look at, which matters most for content that no
             longer exists at the tip. */
          const hit = { file: rel, line: i + 1, rule: rule.id, why: rule.why, ...(entry.commit ? { commit: entry.commit } : {}) };
          if (entryFor) suppressed.push({ ...hit, allowedBecause: entryFor.why, value: text });
          else findings.push(hit);
        }
      });
    }
  }

  return { findings, suppressed, files };
}

function scanDirectory(root) {
  return scanEntries(directoryEntries(root));
}

/* ---- positive control ---------------------------------------------------- */

/* One synthetic line per rule the scanner is required to have.

   The corpus is the specification and RULES is the implementation, which is what
   makes deleting a rule detectable. Deriving the expected set from RULES itself -
   the shape this control had - cannot see a deletion at all: remove the rule and
   there is nothing left to be blind about, and the control certifies a scanner
   that has stopped looking for OpenAI keys. A rule that is deleted no longer has
   a line to catch; a rule that is weakened has one it can no longer catch. */
const CONTROL_CORPUS = [
  ["fal-key", "FAL_KEY=fal-KZQ9WVTNAHRUEXAMPLE0000"],
  ["openai-key", "OPENAI_API_KEY=sk-EXAMPLEEXAMPLEEXAMPLEEXAMPLE00"],
  ["anthropic-key", "ANTHROPIC_API_KEY=sk-ant-EXAMPLEEXAMPLEEXAMPLE0000"],
  ["github-token", "GITHUB_TOKEN=ghp_EXAMPLEEXAMPLEEXAMPLEEXAMPLE0"],
  ["aws-key", "AWS_ACCESS_KEY_ID=AKIAEXAMPLEEXAMPLE00"],
  ["private-key", "-----BEGIN RSA PRIVATE KEY-----"],
  ["bearer", "Authorization: Bearer EXAMPLEEXAMPLEEXAMPLEEXAMPLE00"],
  ["git-credential", "https://someone:hunter2@example.invalid/repo.git"],
  ["personal-path", "C:\\Users\\someone\\CineBraid\\notes.txt"],
];

/* Written to and read back from the filesystem rather than assembled in memory:
   this proves the directory walk, the read and the rules together, so a broken
   walk cannot pass a control that only ever exercised the regexes. */
function positiveControl() {
  const required = CONTROL_CORPUS.map(([id]) => id);
  const uncovered = required.filter((id) => !RULES.some((rule) => rule.id === id));
  assert.deepStrictEqual(uncovered, [], `the rule table no longer covers: ${uncovered.join(", ")}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-scanner-control-"));
  try {
    fs.writeFileSync(path.join(dir, "control.txt"), CONTROL_CORPUS.map(([, line]) => line).join("\n"));

    const result = scanDirectory(dir);
    assert.strictEqual(result.files, 1, "the positive control did not read its own file");
    const found = new Set(result.findings.map((f) => f.rule));
    const blind = required.filter((id) => !found.has(id));
    assert.deepStrictEqual(blind, [], `the scanner is blind to: ${blind.join(", ")}`);
    return required.length;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  RULES,
  ALLOW,
  BINARY,
  CONTROL_CORPUS,
  ScanError,
  scanEntries,
  scanDirectory,
  directoryEntries,
  workingTreeEntries,
  publicationTreeEntries,
  historyRangeEntries,
  treePairs,
  revParse,
  tarTextEntries,
  positiveControl,
  run,
};

/* ---- run ----------------------------------------------------------------- */

const USAGE =
  "usage: node scripts/scan-secrets.js [--repo <dir>] [--working-tree] " +
  "[--publication-tree [<commit-ish>]] [--history-range <base>..<head>] [<dir> ...]";

function parseTargets(argv) {
  const targets = [];
  let repo = ROOT;

  /* --repo is read first, so it applies to every target however they are
     ordered on the command line. */
  const repoAt = argv.indexOf("--repo");
  if (repoAt >= 0) {
    const value = argv[repoAt + 1];
    if (!value || value.startsWith("--")) throw new ScanError("--repo needs a directory");
    repo = path.resolve(value);
    if (!fs.existsSync(repo)) throw new ScanError(`--repo does not exist: ${repo}`);
    argv = argv.filter((_, i) => i !== repoAt && i !== repoAt + 1);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--working-tree") {
      targets.push({
        label: "working tree (tracked files)",
        read: () => ({ entries: workingTreeEntries(repo) }),
        requiresContent: true,
      });
      continue;
    }
    if (arg === "--publication-tree") {
      const next = argv[i + 1];
      const ref = next && !next.startsWith("--") ? (i += 1, next) : "HEAD";
      targets.push({
        label: `publication tree (git archive ${ref})`,
        read: () => ({ entries: publicationTreeEntries(ref, repo) }),
        requiresContent: true,
      });
      continue;
    }
    if (arg === "--history-range") {
      const spec = argv[i + 1];
      if (!spec || spec.startsWith("--")) throw new ScanError("--history-range needs <base>..<head>");
      i += 1;
      const parts = spec.split("..");
      if (parts.length !== 2 || !parts[1]) throw new ScanError(`--history-range must be <base>..<head>, got: ${spec}`);
      const [base, head] = parts;
      targets.push({
        label: `newly exposed history (${spec})`,
        read: () => {
          const range = historyRangeEntries(base || null, head, repo);
          /* An empty range is not a clean answer: nothing was examined, so there
             is nothing to certify. Asking to scan history means expecting some. */
          if (!range.commits.length) {
            throw new ScanError(`history range ${spec} contains no commits; there is nothing to scan`);
          }
          return { entries: range.entries, note: `${range.commits.length} commit(s), ${range.treeRows} tree rows` };
        },
        /* A range CAN legitimately introduce no new text - a run of commits that
           only touch images, say - so content is not required here. `treeRows`
           inside the reader is what proves the enumeration actually ran. */
        requiresContent: false,
      });
      continue;
    }
    if (arg.startsWith("--")) throw new ScanError(`unknown option: ${arg}`);
    const dir = path.resolve(arg);
    targets.push({
      label: dir,
      read: () => ({ entries: directoryEntries(dir) }),
      requiresContent: true,
    });
  }
  return targets;
}

function run(argv) {
  const targets = parseTargets(argv);
  if (!targets.length) throw new ScanError("no scan target was named");

  const proven = positiveControl();
  console.log(`scanner validated against a synthetic positive control: ${proven}/${RULES.length} rules fired`);

  let total = 0;
  for (const target of targets) {
    const { entries, note } = target.read();
    const { findings, suppressed, files } = scanEntries(entries);
    /* A clean answer over zero files is the failure this line exists to catch,
       and it is an inability rather than a finding: nothing was read, so nothing
       is known. */
    if (target.requiresContent && !files) {
      throw new ScanError(`scan target read no files: ${target.label}`);
    }
    total += findings.length;
    for (const s of suppressed) {
      console.log(`  allowed ${s.file}:${s.line}  ${s.rule} — ${s.allowedBecause}`);
    }
    const scope = note ? `${files} files, ${note}` : `${files} files`;
    if (findings.length) {
      console.error(`FAIL ${target.label} (${scope})`);
      for (const f of findings) {
        const where = f.commit ? `${f.file}:${f.line} in ${f.commit.slice(0, 8)}` : `${f.file}:${f.line}`;
        console.error(`  ${where}  ${f.rule} — ${f.why}`);
      }
    } else {
      console.log(`clean ${target.label} (${scope})`);
    }
  }

  if (total) {
    console.error(`credential/privacy scan failed with ${total} finding(s)`);
    return 1;
  }
  console.log("credential/privacy scan passed");
  return 0;
}

function main() {
  let code;
  try {
    code = run(process.argv.slice(2));
  } catch (error) {
    /* Every path out of here is 2. A ScanError is an inability we named; anything
       else is an inability we did not, and guessing "clean" or "findings" about
       an unknown failure is exactly the habit this contract exists to break. */
    console.error(error instanceof ScanError ? error.message : `scan aborted: ${error && error.message}`);
    if (!(error instanceof ScanError)) console.error(error && error.stack);
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(code);
}

if (require.main === module) main();

/* Credential and privacy scan for what CineBraid actually publishes.

   Usage:
     node scripts/scan-secrets.js --working-tree
     node scripts/scan-secrets.js --publication-tree [<commit-ish>]
     node scripts/scan-secrets.js <dir> [<dir> ...]

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
     <dir>               a staged package or an extracted archive on disk.

   Exit codes: 0 clean, 1 findings, 2 the scan could not be performed. A caller
   must treat 2 as a failure - "no target" is not "nothing to report".

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

/* ---- reading targets ----------------------------------------------------- */

/* `cwd` is a parameter because the negative controls prove the difference between
   the two git-backed targets against a throwaway repository, rather than by
   mutating this one while other suites are reading it. */
function git(args, cwd = ROOT, opts = {}) {
  return execFileSync("git", args, { cwd, maxBuffer: 512 * 1024 * 1024, ...opts });
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
  const entries = [];
  for (const file of walk(root)) {
    const text = readText(file);
    if (text == null) continue;
    entries.push({ name: path.relative(root, file).replace(/\\/g, "/"), text });
  }
  return entries;
}

/* Every tracked file as it currently sits on disk. */
function workingTreeEntries(root = ROOT) {
  const listed = git(["ls-files", "-z"], root, { encoding: "utf8" }).split("\0").filter(Boolean);
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
  return tarTextEntries(git(["archive", "--format=tar", ref], root));
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
          const hit = { file: rel, line: i + 1, rule: rule.id, why: rule.why };
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
  scanEntries,
  scanDirectory,
  directoryEntries,
  workingTreeEntries,
  publicationTreeEntries,
  tarTextEntries,
  positiveControl,
};

/* ---- run ----------------------------------------------------------------- */

function usage(message) {
  if (message) console.error(message);
  console.error("usage: node scripts/scan-secrets.js [--working-tree] [--publication-tree [<commit-ish>]] [<dir> ...]");
  process.exit(2);
}

function parseTargets(argv) {
  const targets = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--working-tree") {
      targets.push({ label: "working tree (tracked files)", read: workingTreeEntries });
      continue;
    }
    if (arg === "--publication-tree") {
      const next = argv[i + 1];
      const ref = next && !next.startsWith("--") ? (i += 1, next) : "HEAD";
      targets.push({ label: `publication tree (git archive ${ref})`, read: () => publicationTreeEntries(ref) });
      continue;
    }
    if (arg.startsWith("--")) usage(`unknown option: ${arg}`);
    const root = path.resolve(arg);
    targets.push({ label: root, read: () => directoryEntries(root), exists: root });
  }
  return targets;
}

function main() {
  const targets = parseTargets(process.argv.slice(2));
  if (!targets.length) usage();

  const proven = positiveControl();
  console.log(`scanner validated against a synthetic positive control: ${proven}/${RULES.length} rules fired`);

  let total = 0;
  for (const target of targets) {
    if (target.exists) assert(fs.existsSync(target.exists), `scan target does not exist: ${target.exists}`);
    const { findings, suppressed, files } = target.read ? scanEntries(target.read()) : { findings: [], suppressed: [], files: 0 };
    /* A clean answer over zero files is the failure this line exists to catch. */
    assert(files > 0, `scan target read no files: ${target.label}`);
    total += findings.length;
    for (const s of suppressed) {
      console.log(`  allowed ${s.file}:${s.line}  ${s.rule} — ${s.allowedBecause}`);
    }
    if (findings.length) {
      console.error(`FAIL ${target.label} (${files} files)`);
      for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule} — ${f.why}`);
    } else {
      console.log(`clean ${target.label} (${files} files)`);
    }
  }

  if (total) {
    console.error(`credential/privacy scan failed with ${total} finding(s)`);
    process.exit(1);
  }
  console.log("credential/privacy scan passed");
}

if (require.main === module) main();

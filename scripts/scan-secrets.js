/* Credential and privacy scan for a staged package or an extracted archive.

   Usage:
     node scripts/scan-secrets.js <dir> [<dir> ...]

   A scanner that reports "clean" is worthless unless it can be shown to report
   anything at all, so every run first proves itself against a synthetic
   positive control: a throwaway directory of fake credentials written to the
   OS temp area, never inside the repository or the package. If the control
   does not trip every rule, the scan fails rather than reporting a clean run.

   The synthetic values below are invented for this control. They are not real
   credentials and are never written into any release artifact. */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

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

/* Known synthetic values, allowed by exact file and rule with a stated reason.
   Every suppression is printed, so this can never quietly hide a real finding. */
const ALLOW = [
  {
    file: "tests/automation-diagnostics.js",
    rule: "openai-key",
    why: "a synthetic key the suite feeds through the diagnostic redactor to prove secrets are stripped from support bundles",
  },
  {
    file: "tests/readiness-feedback.js",
    rule: "openai-key",
    why: "a synthetic key posted to /api/test-feedback to prove feedback notes are redacted before they are stored",
  },
  {
    file: "tests/readiness-feedback.js",
    rule: "personal-path",
    why: "a synthetic local path posted alongside that key, asserting personal paths are redacted too",
  },
];

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

function scan(root, suppressed = []) {
  const findings = [];
  for (const file of walk(root)) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(root, file).replace(/\\/g, "/");

    /* The scanner's own rule table necessarily contains every pattern it looks
       for, so scanning it would report a finding on every rule. Matched by name,
       because the copy inside a package is not this running file. */
    if (path.basename(file) === path.basename(__filename)) continue;

    const lines = text.split(/\r?\n/);
    for (const rule of RULES) {
      const allowed = ALLOW.find((a) => a.file === rel && a.rule === rule.id);
      lines.forEach((line, i) => {
        if (!rule.re.test(line)) return;
        const hit = { file: rel, line: i + 1, rule: rule.id, why: rule.why };
        if (allowed) suppressed.push({ ...hit, allowedBecause: allowed.why });
        else findings.push(hit);
      });
    }
  }
  return findings;
}

/* ---- positive control ---------------------------------------------------- */

function positiveControl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-scanner-control-"));
  try {
    fs.writeFileSync(path.join(dir, "control.txt"), [
      "FAL_KEY=fal-KZQ9WVTNAHRUEXAMPLE0000",
      "OPENAI_API_KEY=sk-EXAMPLEEXAMPLEEXAMPLEEXAMPLE00",
      "ANTHROPIC_API_KEY=sk-ant-EXAMPLEEXAMPLEEXAMPLE0000",
      "GITHUB_TOKEN=ghp_EXAMPLEEXAMPLEEXAMPLEEXAMPLE0",
      "AWS_ACCESS_KEY_ID=AKIAEXAMPLEEXAMPLE00",
      "-----BEGIN RSA PRIVATE KEY-----",
      "Authorization: Bearer EXAMPLEEXAMPLEEXAMPLEEXAMPLE00",
      "https://someone:hunter2@example.invalid/repo.git",
      "C:\\Users\\someone\\CineBraid\\notes.txt",
    ].join("\n"));

    const found = new Set(scan(dir).map((f) => f.rule));
    const blind = RULES.map((r) => r.id).filter((id) => !found.has(id));
    assert.deepStrictEqual(blind, [], `the scanner is blind to: ${blind.join(", ")}`);
    return RULES.length;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---- run ----------------------------------------------------------------- */

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error("usage: node scripts/scan-secrets.js <dir> [<dir> ...]");
  process.exit(2);
}

const proven = positiveControl();
console.log(`scanner validated against a synthetic positive control: ${proven}/${RULES.length} rules fired`);

let total = 0;
for (const target of targets) {
  const root = path.resolve(target);
  assert(fs.existsSync(root), `scan target does not exist: ${root}`);
  const suppressed = [];
  const findings = scan(root, suppressed);
  total += findings.length;
  for (const s of suppressed) {
    console.log(`  allowed ${s.file}:${s.line}  ${s.rule} — ${s.allowedBecause}`);
  }
  if (findings.length) {
    console.error(`FAIL ${root}`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule} — ${f.why}`);
  } else {
    console.log(`clean ${root}`);
  }
}

if (total) {
  console.error(`credential/privacy scan failed with ${total} finding(s)`);
  process.exit(1);
}
console.log("credential/privacy scan passed");

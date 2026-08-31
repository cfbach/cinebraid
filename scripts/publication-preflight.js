/* The gate a CineBraid commit has to pass before anyone pushes it to the public
   repository.

   Usage:
     node scripts/publication-preflight.js --first-publication [--candidate <rev>]
     node scripts/publication-preflight.js --public-sha <sha> [--candidate <rev>]
     ... with [--repo <dir>] to run against another repository

   THIS SCRIPT CANNOT PUSH. It contains no push, no remote configuration and no
   network call; it reads the repository, runs the scans, and prints the command a
   human then runs. That is deliberate: a script that could push is a script that
   can push by accident, and the whole publication contract is one branch, named
   explicitly, by a person who meant it.

   Why a history range and not just the tip:

     A public `main` push transfers HISTORY. Commit a credential, delete the file,
     commit the deletion, and the tip is clean while the credential is still one
     `git cat-file` away in the repository you just handed the world. So the gate
     asks a different question from `npm run check:secrets` alone: what does
     publishing this commit make newly READABLE, including everything that was
     deleted again before the tip.

   Exit codes match the scanner's, and mean the same things:

     0  everything checked, nothing disallowed - a human may now publish
     1  a scan completed and found something disallowed - do not publish
     2  the preflight could not decide - do not publish

   2 is not a softer 1. It covers an unknown baseline, a baseline that is not an
   ancestor of the candidate, an invalid candidate, a dirty or mismatched
   checkout, an empty range, and any git enumeration failure. Refusing to answer
   is the safe answer; guessing is not. */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const scanner = require("./scan-secrets");
const { ScanError } = scanner;

const ROOT = path.resolve(__dirname, "..");

/* ---- the already-audited baseline ---------------------------------------- */

/* `cfbach/cinebraid` has no published CineBraid `main` yet, so the FIRST
   publication has no public SHA to diff against. It does have something better
   than nothing and better than a rescan: this commit's reachable history was the
   subject of an independent full-history exposure audit (2026-08-30, 505 commits,
   5,089 unique blobs, 16,036 paths across 88 refs and 3 tags) which found no
   credential, no private key and no token anywhere in it.

   So the first publication treats this commit as the baseline and scans every
   commit introduced after it. The alternative - rescanning all history at first
   publication - is also sound and is what `--history-range ..<candidate>` does,
   but measured on this repository it reports four `personal-path` hits in
   documentation prose (an account name in two audit records, and the literal
   placeholder `C:\Users\<name>\My CineBraid Builds\` in a v6.6.5 install note). None
   is a credential, all four were reviewed and accepted as low-risk developer
   identifiers not warranting a history rewrite, and the only ways to make a full
   rescan pass would be to rewrite history or to widen the allowlist. Both are
   worse than recording, here, exactly which evidence this baseline rests on.

   Once public `main` exists this constant stops being used: --public-sha is the
   baseline from then on, and it is the SHA the public repository actually has. */
const AUDITED_BASELINE = {
  sha: "25054fa1dde7979b66186f144a5fc84b77e591f4",
  why: "independent full-history public-exposure audit, 2026-08-30: 505 commits / 5,089 blobs / 16,036 paths, no credential found",
};

/* ---- arguments ----------------------------------------------------------- */

function fail(message) {
  throw new ScanError(message);
}

function parse(argv) {
  const options = { candidate: "main", repo: ROOT, first: false, publicSha: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) fail(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === "--first-publication") { options.first = true; continue; }
    if (arg === "--public-sha") { options.publicSha = value(); continue; }
    if (arg === "--candidate") { options.candidate = value(); continue; }
    if (arg === "--repo") { options.repo = path.resolve(value()); continue; }
    fail(`unknown option: ${arg}`);
  }
  if (options.first && options.publicSha) fail("--first-publication and --public-sha are mutually exclusive");
  if (!options.first && !options.publicSha) {
    fail("name the baseline: --public-sha <sha> for an established public main, or --first-publication");
  }
  if (!fs.existsSync(options.repo)) fail(`--repo does not exist: ${options.repo}`);
  return options;
}

function git(args, cwd, what) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim().split("\n")[0];
    fail(`${what}: git ${args.slice(0, 2).join(" ")} failed — ${detail}`);
    return "";
  }
}

/* ---- the gate ------------------------------------------------------------ */

const PUBLIC_REPOSITORY = "https://github.com/cfbach/cinebraid.git";

function preflight(argv, log = console.log) {
  const options = parse(argv);
  const repo = options.repo;
  const step = (n, text) => log(`  ${n}. ${text}`);

  log("CineBraid publication preflight — read-only; this script cannot push.");

  /* 1. the exact candidate. */
  const candidate = scanner.revParse(options.candidate, repo, `candidate ${options.candidate}`);
  step(1, `candidate         ${candidate}  (${options.candidate})`);

  /* The working-tree scan below only means something if the checkout IS the
     candidate, and a dirty checkout is not any commit at all. */
  const head = scanner.revParse("HEAD", repo, "HEAD");
  if (head !== candidate) {
    fail(`the checkout is at ${head} but the candidate is ${candidate}; check out the candidate before publishing from it`);
  }
  const dirty = git(["status", "--porcelain"], repo, "checkout state");
  if (dirty) fail(`refusing to publish from a dirty checkout:\n${dirty}`);

  /* 2. the baseline, and where the trust in it comes from. */
  let baseline;
  if (options.first) {
    baseline = scanner.revParse(AUDITED_BASELINE.sha, repo, "audited baseline");
    if (baseline !== AUDITED_BASELINE.sha) fail("the audited baseline did not resolve to itself");
    step(2, `baseline          ${baseline}  (first publication; ${AUDITED_BASELINE.why})`);
  } else {
    baseline = scanner.revParse(options.publicSha, repo, `public baseline ${options.publicSha}`);
    step(2, `baseline          ${baseline}  (published main)`);
  }

  /* 3. ancestry: the public history is append-only, so anything else is a force
        push wearing a different hat. */
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseline, candidate], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    fail(`the baseline ${baseline.slice(0, 12)} is not an ancestor of the candidate ${candidate.slice(0, 12)}; publication is fast-forward only`);
  }
  step(3, "ancestry          baseline is an ancestor of the candidate");

  /* 4. an empty range means there is nothing to publish - which is a refusal,
        not a pass. */
  const commits = git(["rev-list", "--count", `${baseline}..${candidate}`], repo, "range size");
  if (!Number(commits)) fail(`nothing to publish: ${baseline.slice(0, 12)}..${candidate.slice(0, 12)} contains no commits`);
  step(4, `range             ${commits} commit(s) newly exposed`);

  /* 5. the bytes this commit ships. */
  const tracked = scanner.scanEntries(scanner.workingTreeEntries(repo));
  if (!tracked.files) fail("the working-tree scan read no files");
  const archive = scanner.scanEntries(scanner.publicationTreeEntries(candidate, repo));
  if (!archive.files) fail("the publication-tree scan read no files");
  step(5, `current content   ${tracked.files} tracked + ${archive.files} archive files, ${tracked.findings.length + archive.findings.length} finding(s)`);

  /* 6. the history this commit makes readable. */
  const range = scanner.historyRangeEntries(baseline, candidate, repo);
  if (!range.commits.length) fail("the history range enumerated no commits");
  if (!range.treeRows) fail("the history range enumerated no tree content");
  const history = scanner.scanEntries(range.entries);
  step(6, `newly exposed     ${history.files} file versions over ${range.commits.length} commit(s), ${range.treeRows} tree rows, ${history.findings.length} finding(s)`);

  const findings = [...tracked.findings, ...archive.findings, ...history.findings];
  if (findings.length) {
    log("");
    log(`REFUSED: ${findings.length} finding(s). Do not publish.`);
    for (const f of findings) {
      log(`  ${f.file}:${f.line}${f.commit ? ` in ${f.commit.slice(0, 8)}` : ""}  ${f.rule} — ${f.why}`);
    }
    return 1;
  }

  /* 7. the command, printed rather than run. */
  log("");
  log("CLEARED. Publication is one branch, named on both sides, by a human:");
  log("");
  log(`  git push --dry-run ${PUBLIC_REPOSITORY} main:refs/heads/main`);
  log(`  git push ${PUBLIC_REPOSITORY} main:refs/heads/main`);
  log("");
  log(`Record ${candidate} as the published SHA; the next preflight takes it as --public-sha.`);
  return 0;
}

module.exports = { preflight, AUDITED_BASELINE, PUBLIC_REPOSITORY };

if (require.main === module) {
  let code;
  try {
    code = preflight(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof ScanError ? `REFUSED: ${error.message}` : `preflight aborted: ${error && error.message}`);
    if (!(error instanceof ScanError)) console.error(error && error.stack);
    process.exit(2);
  }
  process.exit(code);
}

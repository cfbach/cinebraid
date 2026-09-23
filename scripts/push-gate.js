/* The gate every push from a CineBraid checkout passes before it leaves the machine.

   Usage (normally run by .githooks/pre-push, installed with `npm run hooks:install`):
     node scripts/push-gate.js <remote> <url>   < git's pre-push lines on stdin

   CineBraid is developed in one public repository, `cfbach/cinebraid`. There is no
   private staging copy any more, so there is no later moment at which a reviewer
   decides what becomes public: a push IS the publication. Every branch pushed to
   the public repository is readable by anyone the moment the push lands, whether
   or not a pull request is ever opened for it.

   So this gate answers, for each ref git is about to send, the same question the
   old two-repository preflight answered once per release: what does this push
   make newly READABLE - including file versions that were added and deleted again
   before the tip - and is any of it a credential or a personal path?

   What is scanned is exactly what git says it will send. The pre-push protocol
   hands the gate "<local ref> <local sha> <remote ref> <remote sha>" for every
   update, and the scan is anchored on that local sha - never on HEAD, never on
   a branch name that might have moved.

   Policy for the canonical repository (github.com/cfbach/cinebraid):

     - `main` changes only through a reviewed pull request merged on GitHub. A
       direct push to `main` is refused, even when the account pushing could bypass
       branch protection on the server.
     - A branch update must be a fast-forward. Published history is append-only.
     - A tag is published only by an explicit release decision: the push must
       carry exactly one tag, CINEBRAID_RELEASE_TAG must name it, and it must point
       at a commit already on the remote's `main`.

   On every remote, a tag is scanned like a branch: its annotation, the tree of
   the commit it names, and every file version that commit's history makes newly
   readable. The canonical on-main rule is policy on top of that scan, never a
   substitute for it.
     - Only branches and that one tag. Notes, pull refs and anything else are
       refused, which also makes a stray `--mirror` fail loudly.

   Exit codes match the scanner's:

     0  every update is allowed and nothing it exposes is disallowed
     1  a scan completed and found something disallowed - do not push
     2  refused by policy, or the gate could not decide - do not push

   The baseline is read from the PUSH DESTINATION: the URL git hands the hook as
   its second argument. That is not always where the remote fetches from - with
   `remote.<name>.pushurl` set, `git ls-remote <name>` reads the fetch URL, whose
   main can already hold commits the destination has never seen. A baseline read
   that way excludes exactly the history the push is about to publish.

   THIS SCRIPT CANNOT PUSH. It reads the repository and asks the push destination
   which commit its `main` is at (`git ls-remote <url>`), and that is all it does. */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const scanner = require("./scan-secrets");
const { ScanError } = scanner;

const ROOT = path.resolve(__dirname, "..");
const ZERO = /^0{40}$/;
const CANONICAL = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)cfbach\/cinebraid(?:\.git)?\/?$/i;
const RELEASE_TAG_ENV = "CINEBRAID_RELEASE_TAG";

function fail(message) {
  throw new ScanError(message);
}

function git(args, repo, what) {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim().split("\n")[0];
    fail(`${what}: git ${args.slice(0, 2).join(" ")} failed — ${detail}`);
    return "";
  }
}

function isAncestor(ancestor, descendant, repo) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/* null when the two share no history: git answers that with a non-zero exit,
   which is an answer here and not a failure. */
function mergeBase(a, b, repo) {
  try {
    return execFileSync("git", ["merge-base", a, b], { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() || null;
  } catch {
    return null;
  }
}

function hasCommit(sha, repo) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/* git's pre-push stdin: one "<local ref> <local sha> <remote ref> <remote sha>"
   line per update. Anything else is a protocol we do not understand, and a gate
   that cannot read its input must not wave the push through. */
function parseUpdates(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/\s+/);
    if (parts.length !== 4 || !/^[0-9a-f]{40}$/.test(parts[1]) || !/^[0-9a-f]{40}$/.test(parts[3])) {
      fail(`unreadable pre-push line: ${line}`);
    }
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

/* Which commit main is at on the push destination, asked of that URL rather than
   read from a remote-tracking ref that may be days stale, or from the remote's
   name, which resolves to its fetch URL. null when the destination has no main. */
function remoteMainOf(destination, repo) {
  const line = git(["ls-remote", destination, "refs/heads/main"], repo, `reading main from ${destination}`);
  const sha = line.split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(sha || "") ? sha : null;
}

/* Everything pushing `head` makes readable when the remote already serves `base`
   (null: nothing): the bytes of the commit itself, and every file version in the
   range - including ones deleted again before `head`. One implementation for
   branches and tags, so neither can drift into scanning less than the other. */
function newlyReadable({ name, head, base, repo, log, note = "" }) {
  const commits = Number(git(["rev-list", "--count", base ? `${base}..${head}` : head], repo, `range of ${name}`));
  if (!commits) {
    log(`  ${name}  ${head.slice(0, 12)}  ${note}nothing newly readable (the remote already serves every commit)`);
    return [];
  }
  const archive = scanner.scanEntries(scanner.publicationTreeEntries(head, repo));
  if (!archive.files) fail(`the publication tree of ${name} read no files`);
  const range = scanner.historyRangeEntries(base, head, repo);
  if (!range.commits.length) fail(`the history range of ${name} enumerated no commits`);
  if (!range.treeRows) fail(`the history range of ${name} enumerated no tree content`);
  const history = scanner.scanEntries(range.entries);
  log(`  ${name}  ${head.slice(0, 12)}  ${note}${range.commits.length} commit(s), ${history.files} file versions newly readable, `
    + `${archive.files} files at the tip, ${archive.findings.length + history.findings.length} finding(s)`);
  return [...archive.findings, ...history.findings];
}

function gate({ repo = ROOT, remote, url, updates, remoteMain, readRemoteMain, env = process.env, log = console.log }) {
  if (!remote) fail("no remote was named; the gate cannot tell what the remote already holds");
  /* git passes both the remote's name and the URL it is pushing to. Everything the
     gate decides - which repository this is, and what it already serves - is
     about the URL. The name is only a label. */
  const destination = url || remote;
  const canonical = CANONICAL.test(String(destination));
  log(`CineBraid push gate — ${canonical ? "canonical public repository" : "remote"} ${destination}`);

  if (!updates.length) {
    log("  nothing to push");
    return 0;
  }

  const readMain = readRemoteMain || ((target) => remoteMainOf(target, repo));
  const main = remoteMain === undefined ? readMain(destination) : remoteMain;
  if (main && !hasCommit(main, repo)) {
    fail(`main on the push destination is at ${main.slice(0, 12)}, which this checkout does not have. Fetch it first: git fetch ${destination} main`);
  }

  const tags = updates.filter((u) => u.remoteRef.startsWith("refs/tags/"));
  if (canonical && tags.length > 1) fail(`refusing to publish ${tags.length} tags in one push; a release is one tag, named explicitly`);

  const findings = [];
  for (const u of updates) {
    const name = u.remoteRef;
    const deleting = ZERO.test(u.localSha);

    if (!name.startsWith("refs/heads/") && !name.startsWith("refs/tags/")) {
      fail(`refusing to push ${name}: only branches, and one explicitly approved release tag, may be published`);
    }

    if (canonical && name === "refs/heads/main") {
      fail(deleting
        ? "refusing to delete main on the public repository"
        : "refusing a direct push to main: main changes only through a reviewed pull request merged on GitHub");
    }

    if (name.startsWith("refs/tags/")) {
      const tag = name.slice("refs/tags/".length);
      if (canonical) {
        if (deleting) fail(`refusing to delete the published tag ${tag}; a published release tag is permanent`);
        if (env[RELEASE_TAG_ENV] !== tag) {
          fail(`refusing to publish tag ${tag}: a tag is a release decision. Set ${RELEASE_TAG_ENV}=${tag} to publish exactly this one`);
        }
      }
      if (deleting) { log(`  ${name}  deleted`); continue; }
      if (!ZERO.test(u.remoteSha)) fail(`refusing to move the published tag ${tag}`);

      /* A tag publishes the commit it names and all of that commit's history, not
         just its own annotation. Policy on the canonical repository keeps release
         tags on commits main already serves, but the scan does not rely on that:
         the history is read exactly as a branch's would be, on every remote. */
      const target = scanner.revParse(u.localSha, repo, `tag ${tag}`);
      if (canonical && (!main || !isAncestor(target, main, repo))) {
        fail(`refusing to publish tag ${tag}: it must name a commit already on the remote's main`);
      }
      const type = git(["cat-file", "-t", u.localSha], repo, `tag ${tag}`);
      const annotation = type === "tag" ? git(["cat-file", "tag", u.localSha], repo, `tag ${tag}`) : "";
      const notes = scanner.scanEntries(annotation ? [{ name: `${name} (annotation)`, text: annotation }] : []);
      findings.push(...notes.findings);

      let base = null;
      if (main) {
        base = mergeBase(target, main, repo);
        if (!base) fail(`refusing ${name}: it shares no history with the remote's main`);
      }
      findings.push(...newlyReadable({ name, head: target, base, repo, log, note: `annotation ${notes.findings.length} finding(s); ` }));
      continue;
    }

    if (deleting) {
      log(`  ${name}  deleted (a deletion exposes nothing, and unpublishes nothing)`);
      continue;
    }

    /* The baseline is what the remote provably already serves. For an existing
       branch that is its current tip, and the update must build on it; for a new
       branch it is where the branch left the remote's main. Anything the baseline
       does not contain is newly readable once this push lands. */
    let base;
    if (!ZERO.test(u.remoteSha)) {
      if (!hasCommit(u.remoteSha, repo)) {
        fail(`${name} is at ${u.remoteSha.slice(0, 12)} on the remote, which this checkout does not have. Fetch it first`);
      }
      if (!isAncestor(u.remoteSha, u.localSha, repo)) {
        fail(`refusing ${name}: ${u.localSha.slice(0, 12)} is not a fast-forward of ${u.remoteSha.slice(0, 12)}; published history is append-only`);
      }
      base = u.remoteSha;
    } else if (main) {
      base = mergeBase(u.localSha, main, repo);
      if (!base) fail(`refusing ${name}: it shares no history with the remote's main`);
    } else {
      base = null;
    }

    findings.push(...newlyReadable({ name, head: u.localSha, base, repo, log }));
  }

  if (findings.length) {
    log("");
    log(`REFUSED: ${findings.length} finding(s). This push would publish them. Do not push.`);
    for (const f of findings) {
      log(`  ${f.file}:${f.line}${f.commit ? ` in ${f.commit.slice(0, 8)}` : ""}  ${f.rule} — ${f.why}`);
    }
    log("A finding in a commit that is not the tip is still published by the push; rewrite the unpushed branch or start it again.");
    return 1;
  }
  log("CLEARED: nothing this push makes readable is disallowed.");
  return 0;
}

module.exports = { gate, parseUpdates, CANONICAL, RELEASE_TAG_ENV };

if (require.main === module) {
  let code;
  try {
    scanner.positiveControl();
    const [remote, url] = process.argv.slice(2);
    code = gate({ repo: process.cwd(), remote, url, updates: parseUpdates(fs.readFileSync(0, "utf8")) });
  } catch (error) {
    console.error(error instanceof ScanError ? `REFUSED: ${error.message}` : `push gate aborted: ${error && error.message}`);
    if (!(error instanceof ScanError)) console.error(error && error.stack);
    process.exit(2);
  }
  process.exit(code);
}

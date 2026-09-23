/* Public source exposure: what a public checkout of CineBraid says about itself.

   CineBraid is developed in one public repository, where every push publishes
   history (docs/PUBLICATION.md). Everything this suite pins is
   something that was wrong at least once, and each one is only visible from the
   outside:

     - the tracked LICENCE described a private build and a Community repository
       that no longer exists as a plan;
     - the version identity made a public checkout call itself "Private Test 1"
       in its own browser title;
     - the README claimed a version two releases old, and one runtime dependency
       while the server probes a second binary;
     - all three HTML pages, the pre-authentication login page included, fetched
       web fonts from a CDN while the product told users nothing leaves the
       machine;
     - `npm run check:secrets` invoked the scanner with no target, printed usage
       and exited 2, so it had never scanned anything at all.

   The negative controls for the credential scan live in
   tests/public-exposure-negative-controls.js: this file asserts the guarantees,
   that one proves they can fail. */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const lf = (text) => text.replace(/\r\n/g, "\n");
/* Normalised on the way in. `.gitattributes` sets `* text=auto`, so a clone with
   core.autocrlf=true - Windows CI, and every ordinary Windows clone - gets CRLF
   working files, and a `\n` in an anchor then matches nothing. This suite is about
   what a document says, never about its line endings. */
const read = (rel) => lf(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const pkg = JSON.parse(read("package.json"));
const { releaseIdentity } = require(path.join(ROOT, "src/server/release-identity"));
const scanner = require(path.join(ROOT, "scripts", "scan-secrets"));

/* The commit whose whole reachable history was independently audited for public
   exposure, and therefore the baseline the first publication may start from. */
const FOUNDATION = "25054fa1dde7979b66186f144a5fc84b77e591f4";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/* ---- 1. the licence is standard, unmodified Apache-2.0 ------------------- */

/* Pinned by hash rather than by keyword. "Contains the word Apache" survives a
   quietly inserted noncommercial clause; a hash of the terms does not. The pin
   covers the licence through the end of the appendix instructions - everything
   the Apache Software Foundation publishes - and stops short of the boilerplate
   fields, which are the only part meant to be filled in. */
const APACHE_2_0_THROUGH_APPENDIX =
  "f4c1d7ba32ef5bcf5cf03e2eefec5825ebafedf50fa330a36700a49c605c1ef4";

function testLicence() {
  const license = lf(read("LICENSE"));
  const lines = license.split("\n");
  const canonical = `${lines.slice(0, 187).join("\n")}\n`;
  assert.strictEqual(
    crypto.createHash("sha256").update(canonical, "utf8").digest("hex"),
    APACHE_2_0_THROUGH_APPENDIX,
    "LICENSE is not the standard, unmodified Apache License 2.0 text",
  );

  /* The boilerplate fields are filled in, which is what the appendix instructs,
     and the copyright owner is identified rather than invented per file. */
  assert(/^ {3}Copyright \d{4} Frombach Studios$/m.test(license), "LICENSE does not identify the copyright owner");

  /* Terms that were considered and deliberately not taken. A reviewer should be
     able to see from one assertion that none of them crept back in. */
  for (const forbidden of [
    "noncommercial", "non-commercial", "Commons Clause", "field of use",
    "Server Side Public", "Business Source", "Affero", "dual licen",
    "All rights reserved", "Community edition", "Community repository",
  ]) {
    assert(
      !new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(license),
      `LICENSE carries "${forbidden}", which is not part of standard Apache-2.0`,
    );
  }

  assert.strictEqual(pkg.license, "Apache-2.0", "package.json must declare the SPDX identifier Apache-2.0");
  assert.notStrictEqual(pkg.private, true, "a published package must not be marked private");
}

/* ---- 2. the repository files a public project is read for ---------------- */

function testRepositoryFiles() {
  const contributing = read("CONTRIBUTING.md");
  assert(/Developer Certificate of Origin/i.test(contributing), "CONTRIBUTING.md must name the DCO");
  assert(/Signed-off-by/.test(contributing), "CONTRIBUTING.md must show the Signed-off-by trailer");
  assert(/git commit -s/.test(contributing), "CONTRIBUTING.md must show how to sign off");
  assert(/does \*\*not\*\* use a Contributor Licence Agreement|no CLA/i.test(contributing), "CONTRIBUTING.md must state that there is no CLA");
  assert(/You keep the copyright/i.test(contributing), "CONTRIBUTING.md must state that contributors keep their copyright");
  assert(/Apache License 2\.0/.test(contributing), "CONTRIBUTING.md must name the licence contributions are made under");
  assert(/check:quick|check:ci/.test(contributing), "CONTRIBUTING.md must say what to run before submitting");
  assert(/SECURITY\.md/.test(contributing), "CONTRIBUTING.md must route security reports to SECURITY.md");
  /* A CLA is the thing this project has decided against; it must not arrive by
     someone adding the file that usually carries one. */
  for (const rel of ["CLA.md", "cla.md", ".github/CLA.md", "CONTRIBUTOR_LICENSE_AGREEMENT.md"]) {
    assert(!exists(rel), `${rel} exists; CineBraid takes DCO sign-off, not a CLA`);
  }

  const security = read("SECURITY.md");
  assert(/private/i.test(security) && /report/i.test(security), "SECURITY.md must describe private reporting");
  assert(/do not open a public issue/i.test(security), "SECURITY.md must ask reporters not to file publicly first");
  assert(/normal bug/i.test(security), "SECURITY.md must separate vulnerabilities from ordinary bugs");
  /* Truthfulness: no response-time or support-level promise we have not made. */
  assert(
    !/within \d+\s*(hour|day|business)/i.test(security),
    "SECURITY.md must not promise a response time the project has not established",
  );

  const trademarks = read("TRADEMARKS.md");
  assert(/Frombach Studios/.test(trademarks), "TRADEMARKS.md must name the brand owner");
  assert(/does not grant|not.*grant/i.test(trademarks), "TRADEMARKS.md must state that the code licence grants no trademark rights");
  assert(/endors/i.test(trademarks), "TRADEMARKS.md must address implied endorsement by forks");
  for (const asset of ["public/cinebraid-mark.svg", "public/cinebraid-logo-xs.png"]) {
    assert(exists(asset), `${asset} is missing`);
    assert(trademarks.includes(asset), `TRADEMARKS.md must name ${asset} explicitly`);
  }
  /* Trademark restrictions belong here and nowhere near the licence text. */
  assert(!/trademark/i.test(lf(read("LICENSE")).split("\n").slice(187).join("\n")),
    "trademark terms must not be appended to the LICENSE file");
}

/* ---- 3. NOTICE is absent because nothing obliges one -------------------- */

/* Apache-2.0 section 4(d) only requires a NOTICE if a Work you received carried
   one. Rather than asserting "there is no NOTICE" - which would pass even after
   someone vendored an Apache library - this asserts the condition that makes the
   absence correct: nothing third-party is redistributed from this repository. */
function testNoNoticeObligation() {
  for (const rel of ["NOTICE", "NOTICE.txt", "NOTICE.md"]) {
    assert(!exists(rel), `${rel} exists; add the obligation that requires it to this suite, or remove the file`);
  }

  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  const vendored = tracked.filter((f) => /(^|\/)(node_modules|vendor|third[_-]?party|thirdparty)\//i.test(f));
  assert.deepStrictEqual(vendored, [], `third-party source is vendored into the tree: ${vendored.slice(0, 5).join(", ")}`);

  /* A second copy of a licence body anywhere in the tree is the shape a vendored
     dependency takes when it arrives without a directory named after it. */
  const licenceBodies = tracked.filter((f) => {
    if (f === "LICENSE") return false;
    if (!/^[^/]*(LICENSE|LICENCE|COPYING)/i.test(path.basename(f))) return false;
    return true;
  });
  assert.deepStrictEqual(licenceBodies, [], `a second licence file is tracked: ${licenceBodies.join(", ")}`);

  /* One runtime dependency, installed on the destination rather than shipped. */
  assert.deepStrictEqual(Object.keys(pkg.dependencies || {}), ["express"], "the runtime dependency set changed; re-check the NOTICE obligation");
}

/* ---- 4. the local-only shell fetches nothing from the network ------------ */

/* The product tells users it is local-only. A font CDN request from login.html
   contradicted that before anyone had signed in, which is why this reads the
   pre-authentication page as well as the application. */
const SHELL_FILES = ["public/index.html", "public/bible.html", "public/login.html", "public/styles.css"];

function testNoRemoteAssets() {
  for (const rel of SHELL_FILES) {
    const text = read(rel);

    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com"]) {
      assert(!text.includes(host), `${rel} contacts ${host}; typography must resolve locally`);
    }

    /* Any absolute remote URL in a fetching position: a <link>, a <script>, an
       @import, or a CSS url(). `data:` is inline and does not leave the machine;
       the SVG namespace on an xmlns attribute is an identifier, not a request. */
    const remote = [
      ...text.matchAll(/<link\b[^>]*\bhref=["'](https?:\/\/[^"']+)["']/gi),
      ...text.matchAll(/<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi),
      ...text.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi),
      ...text.matchAll(/@import\s+(?:url\()?["']?(https?:\/\/[^"')\s;]+)/gi),
      ...text.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)/gi),
    ].map((m) => m[1]);
    assert.deepStrictEqual(remote, [], `${rel} loads remote assets: ${remote.join(", ")}`);

    /* preconnect/dns-prefetch fetch nothing themselves but announce the intent to,
       and leaving one behind is how the font links came back last time. */
    assert(
      !/rel=["'](preconnect|dns-prefetch|preload|prefetch)["'][^>]*https?:\/\//i.test(text),
      `${rel} still declares a remote connection hint`,
    );
  }

  /* Every font family the shell asks for must have a real local fallback, or the
     removal of the CDN would have silently changed how CineBraid looks. */
  const css = read("public/styles.css");
  const stacks = [...css.matchAll(/--(?:body|display|mono)\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert(stacks.length >= 6, `expected the font tokens to be declared; found ${stacks.length}`);
  const GENERIC = /(?:^|,)\s*(?:sans-serif|serif|monospace|system-ui|ui-monospace|ui-sans-serif|-apple-system)\s*$/;
  for (const stack of stacks) {
    assert(GENERIC.test(stack), `font stack has no generic fallback: ${stack}`);
  }

  /* No font binary was added, so nothing was self-hosted under unresolved rights. */
  const fonts = git(["ls-files"]).split("\n").filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f));
  assert.deepStrictEqual(fonts, [], `font binaries are tracked: ${fonts.join(", ")}`);
  assert(!/@font-face/i.test(css), "styles.css declares @font-face; a self-hosted face needs its redistribution rights recorded first");
}

/* ---- 5. release identity is not a private test build -------------------- */

function testPublicIdentity() {
  const identity = releaseIdentity(pkg.version);
  assert.notStrictEqual(identity.channel, "private", "a public checkout must not carry the private pre-release channel");
  assert(!/private/i.test(pkg.version), `the version still says private: ${pkg.version}`);
  assert(!/private test/i.test(identity.displayName), `the display name still says private test: ${identity.displayName}`);
  assert(!/private/i.test(pkg.description), "the package description still describes a private build");

  const title = (read("public/index.html").match(/<title>([^<]*)<\/title>/) || [])[1];
  assert.strictEqual(title, identity.displayName, "the browser title is not the derived display name");

  /* Neutral, and no more: a development identity must not imply a stable or
     announced release either. */
  assert(identity.isPrerelease, "a development identity must remain a pre-release");

  /* Public-facing documents must not carry an identity the build no longer has. */
  for (const rel of ["README.md", "SETUP.md", "SPARK_SETUP.md", "docs/GETTING_STARTED.md"]) {
    assert(!/private test/i.test(read(rel)), `${rel} still calls this a private test build`);
  }
}

/* ---- 6. the README describes this build ---------------------------------- */

function testReadmeTruth() {
  const readme = read("README.md");

  /* Current build claims must match package.json. Explicit published-release
     links and their pinned install command remain historical: advancing main
     must not relabel an immutable release as a release that does not exist. */
  const published = new Set([...readme.matchAll(/https:\/\/github\.com\/cfbach\/cinebraid\/releases\/tag\/v([^\s)]+)/g)].map(m=>m[1]));
  const currentCopy = readme.replace(/\[[^\]]*\]\((?:https:\/\/github\.com\/cfbach\/cinebraid\/releases\/tag\/v|docs\/releases\/v)([^/)]+)[^)]*\)/g, (link, version) => {
    assert(published.has(version), `README release notes must name a linked published release: ${version}`);
    assert(fs.existsSync(path.join(ROOT, "docs", "releases", "v"+version)), `README release has no historical record: ${version}`);
    return "";
  }).replace(/^git clone --branch v(\S+) --depth 1 https:\/\/github\.com\/cfbach\/cinebraid\.git\r?$/gm, (command, version) => {
    assert(published.has(version), `README pinned install must name its published release: ${version}`);
    return "";
  });
  const versions = [...currentCopy.matchAll(/\b6\.\d+\.\d+(?:-[A-Za-z0-9.]+)?/g)].map((m) => m[0]);
  const wrong = [...new Set(versions)].filter((v) => v !== pkg.version);
  assert.deepStrictEqual(wrong, [], `README names versions that are not ${pkg.version}: ${wrong.join(", ")}`);

  /* Runtime truth: the server probes ffmpeg, so a README that lists one
     dependency and stops is misleading about what the machine needs. */
  assert(/ffmpeg/i.test(readme), "README must say what ffmpeg is for");
  assert(/optional/i.test(readme.slice(readme.search(/ffmpeg/i) - 400, readme.search(/ffmpeg/i) + 400)),
    "README must say ffmpeg is optional");
  assert(execFileSync("node", ["-e", "process.stdout.write(String(require('fs').readFileSync('src/server/server.js','utf8').includes('spawnSync(\"ffmpeg\"')))"], { cwd: ROOT, encoding: "utf8" }) === "true",
    "server.js no longer probes ffmpeg; the README claim about it is now the stale one");

  const deps = Object.keys(pkg.dependencies || {});
  for (const dep of deps) assert(readme.includes(dep), `README must name the runtime dependency ${dep}`);

  /* Credentials are optional until a provider-backed feature is used. */
  assert(/no credential is needed|keys are optional|API keys are optional/i.test(readme),
    "README must say provider credentials are optional");
  assert(/local-only/i.test(readme), "README must state the default local-only posture");
  assert(/in development/i.test(readme), "README must state the current development status");
  assert(/Apache License 2\.0/.test(readme), "README must state the licence");
  assert(/TRADEMARKS\.md/.test(readme) && /CONTRIBUTING\.md/.test(readme) && /SECURITY\.md/.test(readme),
    "README must point at the contributor, security and trademark documents");

  /* Positioning that is deliberate, and claims that are deliberately not made. */
  assert(readme.includes("The production layer that keeps AI cinema tied together"), "README must keep the product positioning line");
  assert(readme.includes("Your production, your control"), "README must keep the product positioning line");
  /* A claim, not a mention: "not a production-ready build" is exactly the honest
     sentence this rule exists to encourage, so a term is only a finding when the
     sentence carrying it does not deny it. */
  const sentences = readme.split(/(?<=[.!?])\s+|\n{2,}/);
  for (const overclaim of ["production-ready", "generally available", "stable release", "local generation", "generates locally", "runs models locally"]) {
    for (const sentence of sentences) {
      if (!new RegExp(overclaim, "i").test(sentence)) continue;
      assert(/\b(not|no|never|without)\b/i.test(sentence), `README claims "${overclaim}", which product truth does not support: ${sentence.trim()}`);
    }
  }

  /* Every document the README sends a reader to must exist. */
  for (const [, target] of readme.matchAll(/`((?:docs\/|[A-Z])[A-Za-z0-9_./-]+\.md)`/g)) {
    assert(exists(target), `README points at ${target}, which is not tracked`);
  }
  for (const [, dir] of readme.matchAll(/`(docs\/releases\/[A-Za-z0-9_.-]+)\/`/g)) {
    assert(exists(dir), `README points at ${dir}, which does not exist`);
  }
}

/* ---- 7. the credential scan runs, and guards the publication tree -------- */

function testSecretScanContract() {
  /* The defect: `node scripts/scan-secrets.js` with no target printed usage and
     exited 2. The package script must name what it scans. */
  const script = pkg.scripts["check:secrets"];
  assert(script.includes("--working-tree"), "check:secrets must scan the working tree");
  assert(script.includes("--publication-tree"), "check:secrets must scan the publication tree");

  /* Every allowlist entry is one file, one rule and exact values - never a path
     prefix, never a pattern, never "anything under tests/". */
  for (const entry of scanner.ALLOW) {
    assert(typeof entry.file === "string" && entry.file.length, "an allowlist entry has no file");
    assert(!entry.file.includes("*") && !entry.file.endsWith("/"), `allowlist entry ${entry.file} is not one exact file`);
    assert(exists(entry.file), `allowlist entry names ${entry.file}, which is not in the tree`);
    assert(scanner.RULES.some((r) => r.id === entry.rule), `allowlist entry names unknown rule ${entry.rule}`);
    assert(Array.isArray(entry.values) && entry.values.length, `allowlist entry ${entry.file}/${entry.rule} has no exact values`);
    for (const value of entry.values) {
      assert(typeof value === "string" && value.length >= 8, `allowlist value is too short to be exact: ${JSON.stringify(value)}`);
    }
    assert(typeof entry.why === "string" && entry.why.length > 20, `allowlist entry ${entry.file}/${entry.rule} has no stated reason`);
  }

  /* Nothing outside the scanner may suppress a rule. */
  const source = read("scripts/scan-secrets.js");
  assert(!/\/\btests\b\/\*|startsWith\(["']tests\//.test(source), "the scanner must not exempt a directory");

  const working = scanner.scanEntries(scanner.workingTreeEntries());
  assert(working.files > 100, `the working-tree scan read only ${working.files} files`);
  assert.deepStrictEqual(
    working.findings.map((f) => `${f.file}:${f.line} ${f.rule}`),
    [],
    "the tracked working tree carries credential or privacy findings",
  );

  /* A dead allowlist entry is how an allowlist stops describing anything and
     starts being a blanket nobody rereads. Each one must still suppress. */
  const fired = new Set(working.suppressed.map((s) => `${s.file}|${s.rule}|${s.value}`));
  for (const entry of scanner.ALLOW) {
    const live = entry.values.some((v) => fired.has(`${entry.file}|${entry.rule}|${v}`));
    assert(live, `allowlist entry ${entry.file}/${entry.rule} no longer suppresses anything; remove it`);
  }

  /* The publication tree is the archive, not the working tree: export-ignore is
     applied, so CI wiring is absent here and present there. */
  const archive = scanner.publicationTreeEntries("HEAD");
  assert(archive.length > 100, `the publication tree read only ${archive.length} files`);
  const names = new Set(archive.map((e) => e.name));
  for (const required of ["package.json", "server.js", "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "TRADEMARKS.md"]) {
    assert(names.has(required), `the publication tree is missing ${required}`);
  }
  assert(!names.has(".github/workflows/windows-ci.yml"), "the publication tree is not honouring export-ignore");
  assert(fs.existsSync(path.join(ROOT, ".github/workflows/windows-ci.yml")), "the working tree should still carry the CI wiring");

  /* And it is really the committed content. Compared with line endings
     normalised: `git archive` applies the eol conversion a checkout would get -
     CRLF on this repository's Windows checkouts, because .gitattributes sets
     `* text=auto` - while `git show` dumps the LF blob. A byte comparison would
     pass on a Linux runner and fail on every Windows one. */
  const archived = archive.find((e) => e.name === "package.json");
  assert.strictEqual(
    lf(archived.text),
    lf(git(["show", "HEAD:package.json"])),
    "the publication tree text is not the committed content",
  );

  /* The release build reads the archive before it writes either artifact. */
  const release = read("scripts/build-release.js");
  assert(/require\(["']\.\/scan-secrets["']\)/.test(release), "build-release.js must use the credential scanner");
  const scanAt = release.indexOf("scanEntries(");
  const writeAt = release.indexOf("fs.writeFileSync(windowsArchive");
  assert(scanAt > 0 && writeAt > scanAt, "build-release.js must scan the archive before writing it");

  /* And a recurring gate runs it, so this is not release-only. */
  assert(pkg.scripts["check:ci"].includes("check:secrets"), "check:ci must run the credential scan");
}

/* ---- 7b. the history a push makes readable is scanned too ---------------- */

/* A public `main` push transfers history. A file version deleted before the tip
   is still one `git cat-file` away in the repository the reader clones, so a
   tip-only scan cannot be the publication gate - which is exactly what the first
   version of this work shipped. */
function testHistoryRangeScan() {
  const range = scanner.historyRangeEntries(FOUNDATION, "HEAD", ROOT);
  assert(range.commits.length > 0, "the candidate introduces no commits over the audited foundation");
  assert(range.treeRows > 0, "the history enumeration produced no tree content");
  assert(range.entries.length > 0, "the candidate introduces no file versions over the audited foundation");

  /* Path identity, not blob identity. The allowlist forgives an exact value at an
     exact path, so an enumeration that collapsed two paths sharing one blob into
     one row - which `rev-list --objects` does - would answer only one of the two
     questions the allowlist asks. */
  for (const entry of range.entries) {
    assert(entry.name && !entry.name.startsWith("/"), `history entry has no repository-relative path: ${entry.name}`);
    assert(typeof entry.text === "string", `history entry ${entry.name} carries no content`);
    assert(/^[0-9a-f]{40}$/.test(entry.commit), `history entry ${entry.name} names no commit`);
  }
  /* Matched on the argument list rather than on the prose, which explains why
     `rev-list --objects` is the wrong tool and would otherwise trip this. */
  const source = read("scripts/scan-secrets.js");
  assert(!/\[\s*"rev-list"[^\]]*"--objects"/.test(source),
    "the history enumeration must not pass --objects to rev-list: it prints one path per blob and loses path identity");

  /* Behaviourally: one blob at two paths is two questions, and the enumeration
     must ask both. Proved here on the candidate's own history, and again against
     a purpose-built repository in the negative controls. */
  const byBlob = new Map();
  for (const entry of range.entries) {
    if (!byBlob.has(entry.blob)) byBlob.set(entry.blob, new Set());
    byBlob.get(entry.blob).add(entry.name);
  }
  /* JSON.stringify rather than a separator character: a path may contain almost
     anything, and a key built by concatenation can collide across two different
     pairs that happen to line up around the separator. */
  const pairs = range.entries.map((e) => JSON.stringify([e.name, e.blob]));
  assert.strictEqual(new Set(pairs).size, pairs.length, "the history enumeration returned a duplicate (path, blob) pair");

  const scanned = scanner.scanEntries(range.entries);
  assert.deepStrictEqual(
    scanned.findings.map((f) => `${f.file}:${f.line} ${f.rule} in ${f.commit}`),
    [],
    "the history this candidate would newly expose carries credential or privacy findings",
  );

  /* A finding found in history must say which commit to look at, because the
     whole point is content that is no longer at the tip. */
  const planted = scanner.scanEntries([{ name: "docs/x.md", text: `k: ${["sk", "HISTORYSHAPE", "0".repeat(18)].join("-")}\n`, commit: "0".repeat(40) }]);
  assert.strictEqual(planted.findings.length, 1, "a planted history entry was not reported");
  assert.strictEqual(planted.findings[0].commit, "0".repeat(40), "a history finding must name its commit");
}

/* One stray NUL byte makes git call a source file binary. `.gitattributes` sets
   `* text=auto`, and git skips LF normalisation on anything it thinks is binary -
   so the file stops being normalised, a CRLF checkout starts differing from what
   the author wrote, and the line-ending defect this suite already had to fix once
   comes back with nothing pointing at it. It cost a real debugging session here;
   the four files this work owns are checked so it cannot cost another. */
function testNoStrayNulBytes() {
  for (const rel of [
    "scripts/scan-secrets.js",
    "scripts/push-gate.js",
    "tests/public-exposure.js",
    "tests/public-exposure-negative-controls.js",
  ]) {
    const bytes = fs.readFileSync(path.join(ROOT, rel));
    const at = bytes.indexOf(0);
    assert.strictEqual(at, -1,
      `${rel} carries a NUL byte at offset ${at}; git will treat it as binary and stop normalising its line endings`);
  }
}

/* ---- 7c. the pre-push gate and the server-side publication scan ----------- */

/* Every push to the public repository publishes history, so the gate that matters
   runs before git sends anything. Its behaviour - refusals, bindings and the
   history it reads - is proved against throwaway repositories in
   tests/public-exposure-negative-controls.js. This asserts the wiring: that the
   gate exists, cannot push, is what the tracked hook runs, is what the contract
   documents, and that the server-side scan guards every pull request. */
function testPushGateWiring() {
  assert(!exists("scripts/publication-preflight.js"),
    "the two-repository publication preflight is retired; its only job was a direct push to main, which the contract now forbids");
  assert(!pkg.scripts["publication:preflight"], "package.json still exposes the retired publication preflight");

  assert.strictEqual(pkg.scripts["hooks:install"], "git config core.hooksPath .githooks",
    "hooks:install must point this clone's hooks at the tracked .githooks directory, and do nothing else");

  const hook = read(".githooks/pre-push");
  assert(/^#!\/bin\/sh\n/.test(hook), ".githooks/pre-push must be a POSIX shell hook");
  assert(/exec node "\$\(git rev-parse --show-toplevel\)\/scripts\/push-gate\.js" "\$@"/.test(hook),
    ".githooks/pre-push must exec scripts/push-gate.js with git's arguments, so stdin reaches the gate");
  /* Executable in the index, or every non-Windows clone silently skips it. */
  const mode = git(["ls-files", "-s", "--", ".githooks/pre-push"]).split(/\s+/)[0];
  if (mode) assert.strictEqual(mode, "100755", ".githooks/pre-push must be committed executable");

  const source = read("scripts/push-gate.js");
  assert(!/\[\s*["']push["']/.test(source), "the push gate must not be able to push");
  for (const forbidden of ['require("https")', 'require("http")', "fetch("]) {
    assert(!source.includes(forbidden), `the push gate must make no network call of its own: ${forbidden}`);
  }
  /* Anchored on the sha git says it will send, never on HEAD - and one scan for
     branches and tags alike, so an allowed tag cannot publish history unread. */
  assert(/historyRangeEntries\(base, head, repo\)/.test(source), "the gate must scan the range ending at the pushed commit");
  assert(/publicationTreeEntries\(head, repo\)/.test(source), "the gate must scan the tree of the pushed commit");
  assert(/newlyReadable\(\{ name, head: u\.localSha, base,/.test(source), "a branch must be scanned at the sha git will send");
  assert(/newlyReadable\(\{ name, head: target, base,/.test(source), "a tag must be scanned at the commit it names, not only its annotation");
  assert(!/historyRangeEntries\([^)]*"HEAD"/.test(source), "the gate must never scan HEAD in place of the pushed sha");

  const { CANONICAL, RELEASE_TAG_ENV } = require(path.join(ROOT, "scripts", "push-gate"));
  for (const url of ["https://github.com/cfbach/cinebraid.git", "https://github.com/cfbach/cinebraid", "git@github.com:cfbach/cinebraid.git"]) {
    assert(CANONICAL.test(url), `the gate does not recognise the canonical repository at ${url}`);
  }
  for (const url of ["https://github.com/cfbach/cinebraid-app.git", "https://github.com/someone/cinebraid.git"]) {
    assert(!CANONICAL.test(url), `the gate mistakes ${url} for the canonical repository`);
  }
  assert.strictEqual(RELEASE_TAG_ENV, "CINEBRAID_RELEASE_TAG", "the release-tag variable is part of the documented contract");

  const doc = read("docs/PUBLICATION.md");
  for (const needle of ["npm run hooks:install", ".githooks/", "scripts/push-gate.js", "CINEBRAID_RELEASE_TAG", "Publication scan", "--history-range", "--no-verify"]) {
    assert(doc.includes(needle), `PUBLICATION.md must document ${needle}`);
  }
  assert(/every push publishes/i.test(doc), "PUBLICATION.md must state that every push publishes");
  assert(doc.includes(FOUNDATION), "PUBLICATION.md must name the audited foundation the history scan starts from");
  /* The ordered steps, so the document cannot drift from what the gate does. */
  for (const step of ["exact commit", "ls-remote", "direct push to `main`", "baseline", "publication tree", "newly readable"]) {
    assert(doc.toLowerCase().includes(step.toLowerCase()), `PUBLICATION.md must document the "${step}" step`);
  }

  /* The server side: a job of its own, on every pull request, over the range the
     event names and the head's archive, with the history it needs. */
  const workflow = read(".github/workflows/windows-ci.yml");
  const job = (workflow.split(/\n  publication-scan:\n/)[1] || "").split(/\n  [a-z][a-z-]*:\n/)[0];
  assert(job, "the workflow must carry a publication-scan job");
  assert(/name: Publication scan/.test(job), "the publication-scan job must report as 'Publication scan'");
  assert(/fetch-depth: 0/.test(job), "a range scan needs full history; a shallow checkout has no range to read");
  assert(/--history-range \$\{\{ github\.event\.pull_request\.base\.sha \}\}\.\.\$\{\{ github\.event\.pull_request\.head\.sha \}\}/.test(job),
    "the CI range must come from the pull_request event rather than being inferred");
  assert(/--publication-tree \$\{\{ github\.event\.pull_request\.head\.sha \}\}/.test(job),
    "the publication scan must read the head's archive as well as its history");
  assert(!/\$\{\{[^}]*\bsecrets\./.test(job) && !/npm ci/.test(job), "the publication scan needs no secrets and no dependencies");
}

/* A public repository takes pull requests from forks, so every job must be one
   that untrusted code can run safely: GitHub-hosted, read-only, secret-free, and
   with no token left behind in the checkout. */
function testWorkflowIsForkSafe() {
  const workflow = read(".github/workflows/windows-ci.yml");
  const live = workflow.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  assert(!/pull_request_target|workflow_run|repository_dispatch/.test(live),
    "a trigger that runs with the base repository's privileges must never be added");
  assert(/^permissions:\n  contents: read\n/m.test(live), "the workflow token must be read-only");
  assert(!/^ +permissions:/m.test(live), "no job may widen the workflow's permissions");
  assert(!/\$\{\{[^}]*\bsecrets\./.test(live), "the workflow must read no secret");
  const runners = [...live.matchAll(/runs-on:\s*(.+)/g)].map((m) => m[1].trim());
  assert(runners.length >= 3, `expected every job to name its runner, found ${runners.length}`);
  for (const runner of runners) {
    assert(/^(windows|ubuntu|macos)-latest$/.test(runner), `a job runs on ${runner}; public jobs use standard GitHub-hosted runners only`);
  }
  const checkouts = live.split(/\n\s+- (?:name: [^\n]*\n\s+)?uses: /).filter((b) => b.startsWith("actions/checkout@"));
  assert(checkouts.length >= 3, `expected a checkout in every job, found ${checkouts.length}`);
  for (const block of checkouts) {
    assert(/persist-credentials: false/.test(block.split(/\n\s+- /)[0]), "every checkout must set persist-credentials: false");
  }
}

/* ---- 8. one repository, named branches only, and no research material ----- */

function testPublicationContract() {
  const doc = read("docs/PUBLICATION.md");
  assert(doc.includes("cfbach/cinebraid"), "PUBLICATION.md must name the public repository");
  assert(/cfbach\/cinebraid-app`?[^\n]*archived/.test(doc), "PUBLICATION.md must record that the former private origin is archived");
  assert(doc.includes("e31d9b370f348764cbf6c2183095a30099672a0b"), "PUBLICATION.md must record the cutover SHA both repositories carry");
  assert(/only through a reviewed pull request/i.test(doc), "PUBLICATION.md must state that main changes only through a reviewed pull request");
  for (const forbidden of ["--mirror", "--all", "wildcard", "force push"]) {
    assert(new RegExp(`no\\s+\`?${forbidden.replace(/[-]/g, "\\-")}`, "i").test(doc),
      `PUBLICATION.md must rule out ${forbidden}`);
  }

  /* Prose can say anything; the commands are what someone will paste. Every push
     in this document must name one ref on both sides, and none may target main. */
  const blocks = [...doc.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert(blocks.length > 0, "PUBLICATION.md has no commands");
  const pushes = blocks.join("\n").split(/\r?\n/).filter((line) => /\bgit push\b/.test(line));
  assert(pushes.length > 0, "PUBLICATION.md must show how to push a branch");
  for (const line of pushes) {
    const command = line.trim().replace(/^[A-Z_]+=\S+ /, "");
    assert(
      /^git push (--dry-run )?\S+ (\S+:refs\/heads\/\S+|refs\/tags\/(\S+):refs\/tags\/\3)$/.test(command),
      `PUBLICATION.md contains a push that does not name one ref on both sides: ${line.trim()}`,
    );
    assert(!/:refs\/heads\/main$/.test(command), `PUBLICATION.md must not show a direct push to main: ${line.trim()}`);
  }
  for (const line of blocks.join("\n").split(/\r?\n/)) {
    assert(!/git push[^\n]*(--mirror|--all|--force|-f\b|--follow-tags|--tags|--no-verify|refs\/\*|\*:)/.test(line),
      `PUBLICATION.md contains an unsafe push form: ${line.trim()}`);
  }

  /* The private research corpus was never merged, so it is not in main's history.
     Proved from the history that is actually public, not from a .gitignore rule
     for paths that are not here. */
  const paths = new Set(git(["log", "--pretty=format:", "--name-only", "HEAD"]).split("\n").map((s) => s.trim()).filter(Boolean));
  assert(paths.size > 100, `the history walk found only ${paths.size} paths; it is not reading what it thinks`);
  const research = [...paths].filter((p) => p.startsWith("braidy/") || p.startsWith("research/"));
  assert.deepStrictEqual(research, [], `research material is reachable from HEAD: ${research.slice(0, 5).join(", ")}`);
}

testLicence();
testRepositoryFiles();
testNoNoticeObligation();
testNoRemoteAssets();
testPublicIdentity();
testReadmeTruth();
testSecretScanContract();
testHistoryRangeScan();
testNoStrayNulBytes();
testPushGateWiring();
testWorkflowIsForkSafe();
testPublicationContract();

console.log(
  "Public exposure suite passed: standard Apache-2.0 pinned by hash, DCO without a CLA, " +
  "coordinated disclosure, trademark carve-out for both brand assets, no NOTICE obligation, " +
  "no remote font or CDN in any shell page including pre-auth login, non-private release identity, " +
  "README runtime truth, the credential scan wired to the working tree and the publication tree, " +
  "no research material reachable, the history since the audited foundation scanned, a pre-push " +
  "gate wired to the tracked hook, a fork-safe workflow, and a server-side publication scan on every pull request.",
);

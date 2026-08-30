/* Public source exposure: what a public checkout of CineBraid says about itself.

   CineBraid is developed in a private origin and published, one reviewed branch
   at a time, to a separate public repository. Everything this suite pins is
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
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const lf = (text) => text.replace(/\r\n/g, "\n");

const pkg = JSON.parse(read("package.json"));
const { releaseIdentity } = require(path.join(ROOT, "release-identity"));
const scanner = require(path.join(ROOT, "scripts", "scan-secrets"));

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

  /* A version literal in the README must be this version. The stale "6.6.5"
     heading survived two releases because nothing compared it to anything. */
  const versions = [...readme.matchAll(/\b6\.\d+\.\d+(?:-[A-Za-z0-9.]+)?/g)].map((m) => m[0]);
  const wrong = [...new Set(versions)].filter((v) => v !== pkg.version);
  assert.deepStrictEqual(wrong, [], `README names versions that are not ${pkg.version}: ${wrong.join(", ")}`);

  /* Runtime truth: the server probes ffmpeg, so a README that lists one
     dependency and stops is misleading about what the machine needs. */
  assert(/ffmpeg/i.test(readme), "README must say what ffmpeg is for");
  assert(/optional/i.test(readme.slice(readme.search(/ffmpeg/i) - 400, readme.search(/ffmpeg/i) + 400)),
    "README must say ffmpeg is optional");
  assert(execFileSync("node", ["-e", "process.stdout.write(String(require('fs').readFileSync('server.js','utf8').includes('spawnSync(\"ffmpeg\"')))"], { cwd: ROOT, encoding: "utf8" }) === "true",
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

/* ---- 8. only main travels, and main carries no research material --------- */

function testPublicationContract() {
  const doc = read("docs/PUBLICATION.md");
  assert(doc.includes("cfbach/cinebraid"), "PUBLICATION.md must name the public repository");
  assert(/only\s+`?main`?/i.test(doc), "PUBLICATION.md must state that only main is published");
  for (const forbidden of ["--mirror", "--all", "wildcard", "force push"]) {
    assert(new RegExp(`no\\s+\`?${forbidden.replace(/[-]/g, "\\-")}`, "i").test(doc) || new RegExp(`No ${forbidden}`, "i").test(doc),
      `PUBLICATION.md must rule out ${forbidden}`);
  }

  /* Prose can say anything; the commands are what someone will paste. Every push
     in this document must name one branch on both sides. */
  const blocks = [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert(blocks.length > 0, "PUBLICATION.md has no commands");
  const pushes = blocks.join("\n").split(/\r?\n/).filter((line) => line.trim().startsWith("git push"));
  assert(pushes.length > 0, "PUBLICATION.md must show the publication command");
  for (const line of pushes) {
    assert(
      /^git push (--dry-run )?\S+ main:refs\/heads\/main$/.test(line.trim()),
      `PUBLICATION.md contains a push that is not one explicit branch: ${line.trim()}`,
    );
  }
  for (const line of blocks.join("\n").split(/\r?\n/)) {
    assert(!/git push[^\n]*(--mirror|--all|--force|-f\b|--follow-tags|--tags|refs\/\*|\*:)/.test(line),
      `PUBLICATION.md contains an unsafe push form: ${line.trim()}`);
  }

  /* The private research corpus is on unmerged branches, so publishing only main
     cannot carry it. Proved from the history that would actually travel, not
     from a .gitignore rule for paths that are not here. */
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
testPublicationContract();

console.log(
  "Public exposure suite passed: standard Apache-2.0 pinned by hash, DCO without a CLA, " +
  "coordinated disclosure, trademark carve-out for both brand assets, no NOTICE obligation, " +
  "no remote font or CDN in any shell page including pre-auth login, non-private release identity, " +
  "README runtime truth, the credential scan wired to the working tree and the publication tree, " +
  "and only main reachable with no research material.",
);

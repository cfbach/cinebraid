/* Build the CineBraid release archives.

   Usage:
     node scripts/build-release.js [--ref <commit-ish>] [--out <dir>]

   Both archives are produced by `git archive` from one commit, so they are the
   same clean tracked source state by construction: nothing untracked, ignored
   or locally modified can reach them, and the two archives cannot drift apart.

   What that gives us for free, from .gitignore and .gitattributes:
     excluded  .git/, node_modules/, .env, API keys, runtime config under data/,
               local worktrees, QA evidence and backups, generated output,
               .claude/settings.local.json, any project other than the sample,
               and release artifacts (dist/ and *.zip are ignored)
     included  application source, package.json + lockfile, public/,
               data/model-profiles.json, projects/cinebraid-sample/,
               Windows/macOS/Linux startup scripts, docs and LICENCE
     endings   *.sh and *.command LF, *.bat CRLF, on every build host
     modes     start.sh and start.command keep their executable bit

   Neither archive carries node_modules. Dependencies are installed on the
   destination platform with `npm ci`, which is what makes the runtime tarball
   architecture-neutral and therefore usable on the DGX Spark's arm64 Linux. */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const { scanEntries, tarTextEntries } = require("./scan-secrets");

const ROOT = path.resolve(__dirname, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REF = arg("--ref", "HEAD");
const OUT = path.resolve(arg("--out", path.join(ROOT, "dist", "release")));

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, ...opts });
}
function gitText(args) {
  return git(args, { encoding: "utf8" }).trim();
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/* ---- the source state must be clean and identified ---------------------- */

const dirty = gitText(["status", "--porcelain"]);
assert.strictEqual(dirty, "", `refusing to build from a dirty working tree:\n${dirty}`);

const commit = gitText(["rev-parse", REF]);
const shortCommit = commit.slice(0, 7);

/* The version comes from the commit being packaged, not from the working tree,
   so `--ref` can never mislabel an archive. */
const pkgAtRef = JSON.parse(gitText(["show", `${commit}:package.json`]));
const identityModule = path.join(ROOT, "release-identity");
const { releaseIdentity } = require(identityModule);
const identity = releaseIdentity(pkgAtRef.version);

const PREFIX = `${identity.archiveBase}/`;

fs.mkdirSync(OUT, { recursive: true });

/* ---- archives ------------------------------------------------------------ */

/* tar first: the runtime tarball is gzipped here rather than by `git archive`
   so no build timestamp lands in the gzip header. Same commit in, same bytes
   out, which is what lets the pre-merge and post-merge hashes be compared. */
const tar = git(["archive", "--format=tar", `--prefix=${PREFIX}`, commit]);
const tarGz = zlib.gzipSync(tar, { level: 9 });
const zip = git(["archive", "--format=zip", "-9", `--prefix=${PREFIX}`, commit]);

/* ---- nothing ships until the archive itself has been read ---------------- */

/* The credential and privacy scan runs on the tar buffer that is about to become
   both artifacts, not on the working tree: `git archive` has already applied
   .gitattributes export-ignore, so this is the exact byte set a publication would
   carry. Placed before the writes, so a finding leaves no artifact on disk to be
   uploaded by mistake. */
const scanned = scanEntries(tarTextEntries(tar, PREFIX));
assert(scanned.files > 0, "the credential scan read no files out of the release archive");
for (const s of scanned.suppressed) console.log(`  allowed ${s.file}:${s.line}  ${s.rule} — ${s.allowedBecause}`);
assert.deepStrictEqual(
  scanned.findings.map((f) => `${f.file}:${f.line}  ${f.rule} — ${f.why}`),
  [],
  "the release archive carries credential or privacy findings",
);
console.log(`Credential/privacy scan clean over ${scanned.files} archive files`);

const windowsArchive = path.join(OUT, identity.windowsArchive);
const runtimeArchive = path.join(OUT, identity.runtimeArchive);
fs.writeFileSync(windowsArchive, zip);
fs.writeFileSync(runtimeArchive, tarGz);

/* ---- what actually went in ----------------------------------------------- */

/* export-ignore is applied by `git archive`, not by `git ls-tree`, so the
   contents are read back out of the archive that actually shipped. */
function tarEntries(buffer) {
  const entries = [];
  for (let off = 0; off + 512 <= buffer.length; ) {
    const field = (start, len) => buffer.toString("utf8", off + start, off + start + len).replace(/\0.*$/, "");
    const name = field(0, 100);
    if (!name) break;
    const size = parseInt(field(124, 12).trim(), 8) || 0;
    const typeflag = buffer.toString("ascii", off + 156, off + 157);
    const mode = field(100, 8).trim();
    /* ustar splits a path longer than 100 bytes across `prefix` and `name`.
       Reading only `name` would reduce deep paths to their basename, which
       would quietly weaken every exclusion check below. */
    const prefix = field(345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    /* "0" and NUL are regular files. "5" is a directory; "g"/"x" are pax
       headers, which git emits and which are not package contents. */
    if (typeflag === "0" || typeflag === "\0") entries.push({ name: full, size, mode });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const contents = tarEntries(tar);
const stray = contents.filter((e) => !e.name.startsWith(PREFIX)).map((e) => e.name);
assert.deepStrictEqual(stray, [], `archive contains entries outside ${PREFIX}: ${stray.join(", ")}`);
const relative = contents.map((e) => e.name.slice(PREFIX.length)).sort();

/* ---- exclusion and content assertions ------------------------------------ */

const FORBIDDEN = [
  [/(^|\/)\.git(\/|$)/, ".git metadata"],
  [/(^|\/)node_modules(\/|$)/, "node_modules"],
  [/(^|\/)\.env($|\.)/, ".env credentials"],
  [/^\.claude\//, "local agent state"],
  [/(^|\/)\.claude\/settings\.local\.json$/, ".claude/settings.local.json"],
  [/^data\/config\.json$/, "runtime configuration"],
  [/\.(zip|tar\.gz|tgz)$/, "a nested release artifact"],
  [/(^|\/)(qa-backups|screenshots|exports|my-output)\//, "QA evidence or generated output"],
  [/(^|\/)backups\//, "project backups"],
  [/\.(log|bak|tmp|pid)$/, "logs, backups or temporary files"],
  [/^\.github\//, "continuous-integration wiring"],
  [/^docs\/release-audit-relocated\//, "relocated QA audit evidence"],
];

const violations = [];
for (const file of relative) {
  for (const [pattern, why] of FORBIDDEN) {
    if (pattern.test(file)) violations.push(`${file} (${why})`);
  }
}
assert.deepStrictEqual(violations, [], `release archive contains excluded material:\n  ${violations.join("\n  ")}`);

const projectDirs = [...new Set(
  relative.filter((f) => f.startsWith("projects/")).map((f) => f.split("/")[1])
)].sort();
assert.deepStrictEqual(projectDirs, ["cinebraid-sample"], `projects/ must contain only cinebraid-sample; found: ${projectDirs.join(", ") || "none"}`);

const REQUIRED = [
  "package.json",
  "package-lock.json",
  "server.js",
  "release-identity.js",
  "public/index.html",
  "data/model-profiles.json",
  "projects/cinebraid-sample/project.json",
  "start.bat",
  "start.sh",
  "start.command",
  "LICENSE",
  "README.md",
  "SETUP.md",
  "docs/SPARK_QA_SETUP.md",
  `docs/releases/${identity.tag}/CINEBRAID_${identity.tag}_RELEASE_NOTES.md`,
];
const missing = REQUIRED.filter((f) => !relative.includes(f));
assert.deepStrictEqual(missing, [], `release archive is missing required files:\n  ${missing.join("\n  ")}`);

/* Line endings and permissions, read back out of the archive that shipped. */
function fileBytes(name) {
  let off = 0;
  while (off + 512 <= tar.length) {
    const field = (start, len) => tar.toString("utf8", off + start, off + start + len).replace(/\0.*$/, "");
    const entryName = field(0, 100);
    if (!entryName) break;
    const size = parseInt(field(124, 12).trim(), 8) || 0;
    const prefix = field(345, 155);
    if ((prefix ? `${prefix}/${entryName}` : entryName) === PREFIX + name) {
      return tar.subarray(off + 512, off + 512 + size);
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

for (const script of ["start.sh", "start.command"]) {
  const bytes = fileBytes(script);
  assert(bytes, `${script} is missing from the archive`);
  assert(!bytes.includes(Buffer.from("\r\n")), `${script} must use LF endings in the archive`);
  const entry = contents.find((e) => e.name === PREFIX + script);
  const ownerBits = parseInt(entry.mode.slice(-3, -2), 8);
  assert(ownerBits & 1, `${script} lost its executable bit (mode ${entry.mode})`);
}
const bat = fileBytes("start.bat");
assert(bat && bat.includes(Buffer.from("\r\n")), "start.bat must use CRLF endings in the archive");

/* An architecture-neutral runtime: no compiled or platform-specific payload. */
const NATIVE = relative.filter((f) => /\.(node|dll|so|dylib|exe)$/i.test(f));
assert.deepStrictEqual(NATIVE, [], `runtime archive is not architecture-neutral: ${NATIVE.join(", ")}`);

/* ---- manifest, checksums and release notes ------------------------------- */

const notesName = `CINEBRAID_${identity.tag}_RELEASE_NOTES.md`;
fs.writeFileSync(path.join(OUT, notesName), git(["show", `${commit}:docs/releases/${identity.tag}/${notesName}`]));

function describe(file) {
  const bytes = fs.readFileSync(file);
  return { name: path.basename(file), bytes: bytes.length, sha256: sha256(bytes) };
}

const assets = [describe(windowsArchive), describe(runtimeArchive), describe(path.join(OUT, notesName))];

const manifest = {
  product: "CineBraid",
  version: identity.version,
  displayName: identity.displayName,
  tag: identity.tag,
  channel: identity.channel,
  prerelease: identity.isPrerelease,
  commit,
  sourceState: "clean tracked tree via git archive",
  requires: { node: pkgAtRef.engines?.node || ">=18", dependenciesInstalledOnDestination: true },
  architectureNeutral: true,
  fileCount: relative.length,
  projects: projectDirs,
  assets,
  excluded: FORBIDDEN.map(([, why]) => why),
  isolation: {
    port: "PORT",
    host: "CINEBRAID_HOST",
    projectsRoot: "CINEBRAID_PROJECTS_ROOT",
    configPath: "CINEBRAID_CONFIG_PATH",
  },
};

const manifestName = `${identity.archiveBase}-manifest.json`;
fs.writeFileSync(path.join(OUT, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);

const sums = [...assets, describe(path.join(OUT, manifestName))]
  .map((a) => `${a.sha256}  ${a.name}`)
  .join("\n");
fs.writeFileSync(path.join(OUT, "SHA256SUMS.txt"), `${sums}\n`);

console.log(`Built ${identity.displayName} from ${shortCommit} (${relative.length} files)`);
for (const a of assets) console.log(`  ${a.name}  ${a.bytes} bytes  ${a.sha256}`);
console.log(`  ${manifestName}`);
console.log(`  SHA256SUMS.txt`);
console.log(`Output: ${OUT}`);

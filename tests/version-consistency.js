/* One authoritative version source, enforced.

   CineBraid has shipped releases where package.json, the browser title and the
   asset cache-busting query strings disagreed, so a tester could not tell which
   build they were running. This suite makes package.json "version" the only
   hand-edited version and fails the build the moment a derived surface drifts.

   It also asserts the inverse: the project schema markers must NOT track the
   application version. `meta.hubVersion`, `meta.schemaVersion` and a project's
   own `meta.version` describe stored project data. A release that renumbered
   them would silently claim every existing project had been migrated. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const { releaseIdentity } = require(path.join(ROOT, "release-identity"));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const identity = releaseIdentity(pkg.version);

/* --- the derived surfaces are in step ------------------------------------ */

const check = execFileSync(process.execPath, [path.join(ROOT, "scripts", "sync-version.js"), "--check"], {
  cwd: ROOT,
  encoding: "utf8",
});
assert(/^Version surfaces match/m.test(check), `sync-version --check did not confirm a match:\n${check}`);

const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");

const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
assert.strictEqual(title, identity.displayName, "the browser title is not the derived display name");

const stamps = [...html.matchAll(/\?v=([^"']*)/g)].map((m) => m[1]);
assert(stamps.length > 0, "index.html has no cache-busting version stamps");
const wrong = [...new Set(stamps)].filter((v) => v !== identity.version);
assert.deepStrictEqual(wrong, [], `index.html cache-busting stamps disagree with package.json: ${wrong.join(", ")}`);

const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
assert.strictEqual(lock.version, identity.version, "package-lock.json version does not match package.json");
assert.strictEqual(lock.packages[""].version, identity.version, "package-lock.json root package version does not match");
assert.strictEqual(lock.name, pkg.name, "package-lock.json name does not match package.json");

/* --- the release documentation this version claims to have ---------------- */

const releaseDir = path.join(ROOT, "docs", "releases", identity.tag);
assert(fs.existsSync(releaseDir), `release documentation folder is missing: docs/releases/${identity.tag}`);

/* --- schema markers must not follow the application version --------------- */

const SCHEMA_MARKERS = { hubVersion: "v6.0.0", schemaVersion: "6.6" };
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
for (const [marker, expected] of Object.entries(SCHEMA_MARKERS)) {
  const found = [...server.matchAll(new RegExp(`${marker}:\\s*"([^"]*)"`, "g"))].map((m) => m[1]);
  assert(found.length > 0, `server.js no longer declares ${marker}`);
  const moved = [...new Set(found)].filter((v) => v !== expected);
  assert.deepStrictEqual(moved, [], `${marker} changed to ${moved.join(", ")}; schema markers must not track the release version`);
  assert(!found.includes(identity.version), `${marker} was renumbered to the application version`);
}

const sample = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "cinebraid-sample", "project.json"), "utf8"));
assert(sample.meta, "the shipped sample has no meta block");
assert.notStrictEqual(sample.meta.version, identity.version, "the shipped sample was renumbered to advertise the application version");
assert.notStrictEqual(sample.meta.hubVersion, identity.version, "the sample hubVersion was renumbered to the application version");
assert.notStrictEqual(sample.meta.schemaVersion, identity.version, "the sample schemaVersion was renumbered to the application version");

/* --- the identity derivation itself --------------------------------------- */

assert.strictEqual(identity.tag, `v${pkg.version}`, "the Git tag is not derived from the package version");
assert.strictEqual(identity.windowsArchive, `cinebraid-${pkg.version}-windows.zip`, "unexpected Windows archive name");
assert.strictEqual(identity.runtimeArchive, `cinebraid-${pkg.version}-runtime.tar.gz`, "unexpected runtime archive name");

console.log(
  `version consistency: OK\n` +
  `  authoritative: package.json ${identity.version}\n` +
  `  display name:  ${identity.displayName}\n` +
  `  git tag:       ${identity.tag}\n` +
  `  derived:       public/index.html title + ${stamps.length} cache stamps, package-lock.json\n` +
  `  schema markers unchanged: hubVersion ${SCHEMA_MARKERS.hubVersion}, schemaVersion ${SCHEMA_MARKERS.schemaVersion}, sample meta.version ${sample.meta.version}`
);

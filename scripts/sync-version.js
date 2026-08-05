/* Stamp every derived version surface from the authoritative source.

   Usage:
     node scripts/sync-version.js          rewrite the derived surfaces
     node scripts/sync-version.js --check  report drift, change nothing

   The only hand-edited version is `package.json` "version". This script keeps
   the lockfile and the browser shell in step with it so a release never ships a
   title, a cache-busting query string and a package version that disagree. */

const fs = require("fs");
const path = require("path");
const { releaseIdentity } = require("../release-identity");

const ROOT = path.resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

/* Writes with the exact bytes given. Line endings are left to .gitattributes,
   which normalises them on checkout and on `git archive`. */
function writeText(file, text) {
  fs.writeFileSync(path.join(ROOT, file), text);
}

function stampIndexHtml(identity, html) {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${identity.displayName}</title>`)
    .replace(/(\?v=)[^"']*/g, `$1${identity.version}`);
}

function stampLockfile(identity, json) {
  const lock = JSON.parse(json);
  lock.version = identity.version;
  if (lock.packages && lock.packages[""]) lock.packages[""].version = identity.version;
  return `${JSON.stringify(lock, null, 2)}\n`;
}

const SURFACES = [
  { file: "public/index.html", stamp: stampIndexHtml },
  { file: "package-lock.json", stamp: stampLockfile },
];

function main() {
  const identity = releaseIdentity();
  const drifted = [];

  for (const surface of SURFACES) {
    const current = readText(surface.file);
    const stamped = surface.stamp(identity, current);
    if (stamped === current) continue;
    drifted.push(surface.file);
    if (!CHECK_ONLY) writeText(surface.file, stamped);
  }

  if (CHECK_ONLY) {
    if (drifted.length) {
      console.error(
        `Version surfaces are out of step with package.json ${identity.version}:\n` +
        drifted.map((file) => `  ${file}`).join("\n") +
        "\nRun: npm run sync:version"
      );
      process.exit(1);
    }
    console.log(`Version surfaces match ${identity.displayName} (${identity.version}).`);
    return;
  }

  if (!drifted.length) {
    console.log(`Version surfaces already match ${identity.displayName} (${identity.version}).`);
    return;
  }
  console.log(`Stamped ${identity.displayName} (${identity.version}) into:`);
  for (const file of drifted) console.log(`  ${file}`);
}

main();

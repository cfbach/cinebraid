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

function writeText(file, text) {
  fs.writeFileSync(path.join(ROOT, file), text);
}

/* `.gitattributes` sets `* text=auto`, so a checkout with core.autocrlf=true —
   Windows CI, and most Windows clones — materialises these files with CRLF.
   Re-serialising the lockfile through JSON.stringify always emits LF, so a
   byte comparison would report drift on every Windows checkout and none on
   Linux. Compare and write in whatever ending the file already uses. */
function matchEol(text, original) {
  const lf = text.replace(/\r\n/g, "\n");
  return /\r\n/.test(original) ? lf.replace(/\n/g, "\r\n") : lf;
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
    const stamped = matchEol(surface.stamp(identity, current), current);
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

module.exports = { stampIndexHtml, stampLockfile, matchEol, SURFACES };

if (require.main === module) main();

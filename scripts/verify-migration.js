/* Prove a workspace migration carried everything, byte for byte.
 *
 *   node scripts/verify-migration.js --manifest <root> [--out <file>] [--stat-only]
 *   node scripts/verify-migration.js --compare <source> <destination> [--stat-only] [--documents-republished]
 *   node scripts/verify-migration.js --compare-manifests <before.json> <after.json> [--documents-republished]
 *
 * WHY THIS IS NOT PART OF THE SERVER. The migration endpoint reports a verification
 * of its own, and that one is deliberately cheap: it walks both roots with readdir
 * and stat and never opens a file, because `projectsRoot` is user-configurable and
 * reading a Windows Files-on-Demand placeholder downloads it. Proof by content costs
 * a full read of every byte on both sides, and that is a decision an operator makes
 * deliberately for a migration they are about to accept — not something a settings
 * save should do to a workspace behind someone's back.
 *
 * WHY IT TAKES NO SERVER, NO CONFIG AND NO PROJECT MODEL. This is the witness for a
 * change to the thing the server reads. A verifier that loaded the server's own root
 * resolution would agree with the server about where the files are, which is the one
 * thing it must not assume. It takes two paths and compares two directory trees.
 *
 * READ-ONLY, BY CONSTRUCTION. It calls readdir, stat, lstat and createReadStream and
 * nothing else. The single write it can perform is the manifest named by --out, which
 * must not be inside either root — a manifest written into the tree it describes is
 * a file the next run would then have to describe.
 *
 * WHAT A MANIFEST IS FOR. Two of them, taken of the SOURCE before and after a
 * migration, are how "the originals were not touched" stops being a promise. Since
 * migration is create-only and never writes to the source, those two manifests must
 * be identical; if they are not, the migration is not what it says it is.
 *
 * SHORTCUTS ARE NAMED, NEVER FOLLOWED. A symlink, junction, device, pipe or socket is
 * recorded as unsupported and reported. Following one would let a manifest describe
 * bytes that are not in the tree, and a comparison then passes for the wrong reason.
 *
 * Exit codes: 0 verified, 1 differences found, 2 usage or I/O error.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TOOL = "cinebraid-verify-migration";
const FORMAT = 1;
const REPORT_LIMIT = 40;

function fail(message) {
  console.error(message);
  process.exit(2);
}

/* One spelling for every recorded path: forward slashes, relative to the root. A
   manifest taken on one machine and compared on another must not differ because of
   a separator, and `C:\a\b` and `C:/a/b` are the same file. */
function relativeKey(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  /* Streamed rather than read whole: a project holds video, and a manifest of a
     production must not be bounded by how much of it fits in memory at once. */
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function direntKind(entry) {
  if (entry.isSymbolicLink()) return "a shortcut to somewhere else";
  if (entry.isBlockDevice() || entry.isCharacterDevice()) return "a device";
  if (entry.isFIFO()) return "a pipe";
  if (entry.isSocket()) return "a socket";
  return "neither an ordinary file nor a folder";
}

/* Walks one tree into { files, unsupported, totals }. `hash` false makes it a
   stat-only pass, which is the fast triage; the default proves content. */
function manifestOf(root, { hash = true } = {}) {
  let real;
  try { real = fs.realpathSync.native(path.resolve(root)); }
  catch (error) { fail(`Cannot read ${root}: ${error.message}`); }

  const files = {}, unsupported = [];
  let directories = 0, bytes = 0;

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) {
      unsupported.push({ path: relativeKey(real, dir) || ".", detail: error.message });
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) { directories += 1; walk(absolute); continue; }
      if (!entry.isFile()) {
        unsupported.push({ path: relativeKey(real, absolute), detail: direntKind(entry) });
        continue;
      }
      let stat;
      try { stat = fs.statSync(absolute); }
      catch (error) {
        unsupported.push({ path: relativeKey(real, absolute), detail: error.message });
        continue;
      }
      const record = { bytes: stat.size };
      if (hash) {
        try { record.sha256 = sha256(absolute); }
        catch (error) {
          unsupported.push({ path: relativeKey(real, absolute), detail: error.message });
          continue;
        }
      }
      files[relativeKey(real, absolute)] = record;
      bytes += stat.size;
    }
  };
  walk(real);

  return {
    tool: TOOL,
    format: FORMAT,
    root: real,
    hashed: hash,
    generatedAt: new Date().toISOString(),
    totals: { files: Object.keys(files).length, directories, bytes },
    files,
    unsupported,
  };
}

/* A TOP-LEVEL project document: `<slug>/project.json` and nothing else. A document
   deeper than that — inside .archive/<stamp>/ or .trash/<name>/ — is carried as bytes
   and is held to the same standard as the media beside it. */
const TOP_LEVEL_DOCUMENT = /^[^/]+\/project\.json$/;

/* Comparison is one-directional on purpose: every file in `before` must be in
   `after`, identical. Extra files at the destination are counted and named but do
   not fail the comparison — a destination that already held unrelated material is
   the create-only guarantee working, not a migration defect. Reversing the arguments
   is how you ask the opposite question.

   `republishedDocuments` is OFF by default, and that default is the important one.
   A migration does not copy a live project's document; the Authority Write Seam
   publishes a successor of it carrying a fresh revision, so `<slug>/project.json`
   legitimately differs on the two sides of a real migration. Passing the flag moves
   those — and only those — into their own reported bucket.

   It stays off by default because the strictest and most valuable use of this tool is
   comparing the SOURCE against ITSELF, before and after a migration. Migration never
   writes to the source, so that comparison must be exact down to the byte, and an
   allowance switched on by default would be an allowance in the one comparison that
   must not have one. The operator turns it on for source-versus-destination, where it
   is true, and leaves it off for source-versus-source, where it is not. */
function compareManifests(before, after, { republishedDocuments = false } = {}) {
  const missing = [], mismatched = [], extra = [], republished = [];
  const afterFiles = after.files || {}, beforeFiles = before.files || {};
  const comparable = before.hashed && after.hashed;

  for (const [key, expected] of Object.entries(beforeFiles)) {
    const found = afterFiles[key];
    if (!found) { missing.push(key); continue; }
    const exempt = republishedDocuments && TOP_LEVEL_DOCUMENT.test(key);
    if (found.bytes !== expected.bytes) {
      if (exempt) republished.push(key);
      else mismatched.push({ path: key, reason: "size", expected: expected.bytes, found: found.bytes });
      continue;
    }
    if (comparable && found.sha256 !== expected.sha256) {
      if (exempt) republished.push(key);
      else mismatched.push({ path: key, reason: "content", expected: expected.sha256, found: found.sha256 });
    }
  }
  for (const key of Object.keys(afterFiles)) if (!beforeFiles[key]) extra.push(key);

  const unsupported = [...(before.unsupported || []), ...(after.unsupported || [])];
  return {
    ok: missing.length === 0 && mismatched.length === 0 && unsupported.length === 0,
    comparedBy: comparable ? "sha256" : "size",
    republishedDocuments,
    before: before.totals, after: after.totals,
    missing, mismatched, extra, republished, unsupported,
  };
}

function report(result) {
  console.log(`  compared by     ${result.comparedBy}`);
  console.log(`  source          ${result.before.files} files, ${result.before.bytes} bytes`);
  console.log(`  destination     ${result.after.files} files, ${result.after.bytes} bytes`);
  console.log(`  missing         ${result.missing.length}`);
  console.log(`  mismatched      ${result.mismatched.length}`);
  console.log(`  extra at dest   ${result.extra.length}`);
  console.log(`  unsupported     ${result.unsupported.length}`);
  if (result.republishedDocuments)
    console.log(`  republished     ${result.republished.length} project documents differ and were allowed to (--documents-republished)`);
  for (const item of result.republished.slice(0, REPORT_LIMIT)) console.log(`    REPUBLISHED  ${item}`);
  for (const item of result.missing.slice(0, REPORT_LIMIT)) console.log(`    MISSING      ${item}`);
  for (const item of result.mismatched.slice(0, REPORT_LIMIT)) console.log(`    ${item.reason.toUpperCase().padEnd(12)} ${item.path}`);
  for (const item of result.unsupported.slice(0, REPORT_LIMIT)) console.log(`    UNSUPPORTED  ${item.path} — ${item.detail}`);
  const hidden = Math.max(0, result.missing.length - REPORT_LIMIT) + Math.max(0, result.mismatched.length - REPORT_LIMIT);
  if (hidden) console.log(`    …and ${hidden} more`);
  /* The closing line may not round off what the buckets above just said. A run with
     exemptions did not verify that everything is unchanged; it verified everything
     except the documents it was told to allow, and it says so. */
  if (!result.ok) { console.log("\nNOT VERIFIED: the destination does not carry the source faithfully.\n"); return; }
  console.log(result.republished.length
    ? `\nVERIFIED: every file at the source is present at the destination, unchanged, except ${result.republished.length} project ${result.republished.length === 1 ? "document" : "documents"} republished by the migration.\n`
    : "\nVERIFIED: every file at the source is present at the destination, unchanged.\n");
}

function readManifest(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { fail(`Cannot read manifest ${file}: ${error.message}`); }
  if (parsed?.tool !== TOOL || parsed.format !== FORMAT)
    fail(`${file} is not a ${TOOL} format-${FORMAT} manifest.`);
  return parsed;
}

function writeManifest(manifest, out) {
  const target = path.resolve(out);
  /* A manifest inside the tree it describes changes that tree, and the next run
     would have to describe the manifest. Refused rather than tidied up afterwards. */
  const inside = (root) => {
    const rel = path.relative(root, target);
    return rel && !path.isAbsolute(rel) && !rel.startsWith("..");
  };
  if (inside(manifest.root)) fail(`Refusing to write the manifest inside the tree it describes (${target}).`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`  manifest written to ${target}`);
}

const USAGE = `usage:
  node scripts/verify-migration.js --manifest <root> [--out <file>] [--stat-only]
  node scripts/verify-migration.js --compare <source-root> <destination-root> [--stat-only] [--documents-republished]
  node scripts/verify-migration.js --compare-manifests <before.json> <after.json> [--documents-republished]

  --stat-only               compare by size alone; the default proves content with SHA-256
  --documents-republished   allow <slug>/project.json to differ, because a migration
                            republishes a live project's document rather than copying it.
                            Use for source-versus-destination. Never for source-versus-source.`;

function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) { console.log(USAGE); return 0; }
  const hash = !args.includes("--stat-only");
  const options = { republishedDocuments: args.includes("--documents-republished") };
  const positional = (flag, count) => {
    const at = args.indexOf(flag);
    const values = args.slice(at + 1, at + 1 + count).filter((value) => !value.startsWith("--"));
    if (values.length !== count) fail(USAGE);
    return values;
  };

  if (args.includes("--manifest")) {
    const [root] = positional("--manifest", 1);
    const manifest = manifestOf(root, { hash });
    console.log(`\n  ${TOOL} — manifest\n`);
    console.log(`  root            ${manifest.root}`);
    console.log(`  files           ${manifest.totals.files}`);
    console.log(`  directories     ${manifest.totals.directories}`);
    console.log(`  bytes           ${manifest.totals.bytes}`);
    console.log(`  hashed          ${manifest.hashed}`);
    console.log(`  unsupported     ${manifest.unsupported.length}`);
    for (const item of manifest.unsupported.slice(0, REPORT_LIMIT)) console.log(`    ${item.path} — ${item.detail}`);
    const out = args.includes("--out") ? positional("--out", 1)[0] : "";
    if (out) writeManifest(manifest, out);
    console.log("");
    return manifest.unsupported.length ? 1 : 0;
  }

  if (args.includes("--compare")) {
    const [source, destination] = positional("--compare", 2);
    console.log(`\n  ${TOOL} — compare\n`);
    const result = compareManifests(manifestOf(source, { hash }), manifestOf(destination, { hash }), options);
    report(result);
    return result.ok ? 0 : 1;
  }

  if (args.includes("--compare-manifests")) {
    const [before, after] = positional("--compare-manifests", 2);
    console.log(`\n  ${TOOL} — compare manifests\n`);
    const result = compareManifests(readManifest(before), readManifest(after), options);
    report(result);
    return result.ok ? 0 : 1;
  }

  fail(USAGE);
  return 2;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { manifestOf, compareManifests };

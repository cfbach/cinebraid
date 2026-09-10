/* CineBraid Phase 2b — the default index must never open a media file.
 *
 * This is the structural cloud-sync requirement, and it is the reason the whole
 * ledger design tolerates a null contentHash.
 *
 * `projectsRoot` is user-configurable and Windows puts Desktop and Documents inside
 * OneDrive, so a project may sit in a Files-on-Demand folder where READING a file
 * downloads it. Node's fs.Stats exposes no Windows file attributes, so CineBraid
 * cannot even detect that a file is a placeholder — hydration has to be avoided by
 * construction rather than by checking. An index that hashed everything would pull
 * an entire media corpus over the network on first open, with no warning and no way
 * for the user to tell what was happening.
 *
 * So this suite instruments every byte-reading primitive the indexer could
 * plausibly reach and asserts the count is exactly zero. A design that can only be
 * asserted by reading the source tends to regress; this one cannot.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const I = require("../src/media/media-asset-indexer");
const S = require("../src/media/media-asset-store");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-no-hydration-"));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/* A project with enough media that an accidental read would be obvious. */
function buildProject(dir, shotCount = 12, perShot = 20) {
  const shots = [];
  for (let s = 1; s <= shotCount; s += 1) {
    const shotId = `S-${String(s).padStart(2, "0")}`;
    const takes = path.join(dir, "shots", shotId, "takes");
    fs.mkdirSync(takes, { recursive: true });
    const candidateFiles = [];
    for (let t = 1; t <= perShot; t += 1) {
      const name = `${shotId}_FRAME_A_FAL_${t}.png`;
      fs.writeFileSync(path.join(takes, name), PNG);
      candidateFiles.push({ stored: name, decision: t === 1 ? "shortlist" : "unreviewed", addedAt: "t" });
    }
    shots.push({ id: shotId, winner: `${shotId}_FRAME_A_FAL_1.png`, keyframes: [], clips: [], candidateFiles });
  }
  fs.mkdirSync(path.join(dir, "anchors"), { recursive: true });
  fs.writeFileSync(path.join(dir, "anchors", "CHAR-KAI.png"), PNG);
  return { shots, characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [] };
}

/* Every primitive that would move bytes. `stat` and `readdir` are deliberately NOT
   instrumented as violations — the pass is allowed, and required, to use them. */
function instrument(projectDir) {
  const reads = [];
  const original = {
    readFileSync: fs.readFileSync,
    createReadStream: fs.createReadStream,
    openSync: fs.openSync,
    open: fs.open,
    readFile: fs.readFile,
    promisesReadFile: fs.promises.readFile,
    promisesOpen: fs.promises.open,
    createHash: crypto.createHash,
  };
  const isMedia = (target) => {
    const value = typeof target === "string" ? target : "";
    if (!value.startsWith(projectDir)) return false;
    return I.MEDIA_EXT.has(path.extname(value).toLowerCase());
  };
  const trap = (name, fn) => function trapped(target, ...rest) {
    if (isMedia(target)) reads.push(`${name}:${String(target).slice(projectDir.length)}`);
    return fn.call(this, target, ...rest);
  };
  fs.readFileSync = trap("readFileSync", original.readFileSync);
  fs.createReadStream = trap("createReadStream", original.createReadStream);
  fs.openSync = trap("openSync", original.openSync);
  fs.open = trap("open", original.open);
  fs.readFile = trap("readFile", original.readFile);
  fs.promises.readFile = trap("promises.readFile", original.promisesReadFile);
  fs.promises.open = trap("promises.open", original.promisesOpen);

  const hashes = [];
  crypto.createHash = function trappedHash(algorithm, ...rest) {
    hashes.push(String(algorithm));
    return original.createHash.call(this, algorithm, ...rest);
  };

  return {
    reads,
    hashes,
    restore() {
      fs.readFileSync = original.readFileSync;
      fs.createReadStream = original.createReadStream;
      fs.openSync = original.openSync;
      fs.open = original.open;
      fs.readFile = original.readFile;
      fs.promises.readFile = original.promisesReadFile;
      fs.promises.open = original.promisesOpen;
      crypto.createHash = original.createHash;
    },
  };
}

async function main() {
  const projectDir = path.join(TEMP, "hydration-project");
  const project = buildProject(projectDir);
  const mediaCount = 12 * 20 + 1;

  /* ---- 1. the module cannot hash, structurally ----
     The strongest form of this proof is not a counter: the indexer does not import
     a hasher at all, so it has nothing to call. */
  const indexerSource = fs.readFileSync(path.join(__dirname, "..", "src/media/media-asset-indexer.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const forbidden of ["media-hash", "hashMediaFile", "hashImageFile", "readFileSync", "createReadStream", "readFile("])
    assert(!indexerSource.includes(forbidden),
      `the indexer must not reference ${forbidden} — it must be unable to read bytes`);

  /* ---- 2. the default pass reads zero media bytes ---- */
  let probe = instrument(projectDir);
  let result;
  try {
    result = await I.indexProject({ projectDir, slug: "hydration-project", project, chunkSize: 50 });
  } finally {
    probe.restore();
  }

  assert.strictEqual(result.status, "complete");
  assert.strictEqual(result.indexed, mediaCount, `all ${mediaCount} media files must be indexed`);
  assert.strictEqual(result.minted, mediaCount, "and all minted on the first pass");
  assert.deepStrictEqual(
    probe.reads, [],
    `the default pass must read ZERO media bytes. It read: ${probe.reads.slice(0, 5).join(", ")}`,
  );
  assert.deepStrictEqual(probe.hashes, [], "no hash may be computed during a default index");
  assert(result.chunks > 1, "a project this size must be chunked, not walked in one go");

  /* ---- 3. every row is unhashed, and that is a complete identity ---- */
  const stored = S.readLedger(projectDir);
  assert.strictEqual(stored.exists, true, "the ledger must have been written");
  assert.strictEqual(stored.ledger.assets.length, mediaCount);
  for (const asset of stored.ledger.assets) {
    assert.strictEqual(asset.hashState, "unhashed", "a stat-only pass produces unhashed rows");
    assert.strictEqual(asset.contentHash, null, "and no fabricated digest");
    assert.match(asset.assetId, /^asset-[0-9a-f]{32}$/, "identity is complete without a hash");
    assert(asset.storage.path.startsWith("shots/") || asset.storage.path.startsWith("anchors/"),
      "paths are project-relative");
  }

  /* ---- 4. a second pass is still zero-read, and still zero-write ---- */
  probe = instrument(projectDir);
  let second;
  try {
    second = await I.indexProject({ projectDir, slug: "hydration-project", project, chunkSize: 50 });
  } finally {
    probe.restore();
  }
  assert.deepStrictEqual(probe.reads, [], "a second pass must also read zero media bytes");
  assert.deepStrictEqual(probe.hashes, [], "and compute no hash");
  assert.strictEqual(second.minted, 0, "a second pass mints nothing");
  assert.strictEqual(second.reused, mediaCount, "it reuses every identity");
  assert.strictEqual(second.wrote, false, "and does not rewrite an unchanged ledger");

  /* ---- 5. stat and readdir DID happen — the pass is real, not a no-op ---- */
  assert(stored.ledger.assets.every((asset) => Number.isFinite(asset.storage.bytes)),
    "sizes come from stat, which proves the pass genuinely inspected the files");
  assert(stored.ledger.assets.every((asset) => Number.isFinite(asset.storage.mtimeMs)));

  console.log(
    `No-hydration suite passed: ${mediaCount} media files indexed across ${result.chunks} chunks with ZERO media-byte `
    + "reads and zero hash computations, on the first pass and on a repeat, every row unhashed with a complete "
    + "identity, and the indexer structurally unable to read bytes because it imports no hasher.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

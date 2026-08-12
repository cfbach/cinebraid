/* CineBraid MediaAsset activation — durable identity for real project media.
 *
 * P4-SEM-C1. The ledger is now reachable from the running product through
 * media-asset-service.js, and this suite is the account of what that means.
 *
 * The one sentence it exists to prove: every supported media file a project holds
 * acquires an assetId that is independent of its filename, survives the rename its
 * own approval performs, distinguishes replaced bytes from moved ones, and is never
 * attached to a legacy owner nothing proved.
 *
 * The boundary itself — one owner, three entry points, no hashing on a backfill —
 * is tests/media-asset-activation-boundary.js. This suite is the semantics.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const Service = require("../media-asset-service");
const Store = require("../media-asset-store");
const Indexer = require("../media-asset-indexer");
const { clearMediaHashMemo, sha256Hex } = require("../media-hash");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const bytesOf = (tag) => Buffer.concat([PNG, Buffer.from(String(tag))]);

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-activation-"));
let made = 0;
const notes = [];
const note = (line) => notes.push(line);

/* Git normalises to CRLF on this checkout, so any source byte comparison has to
   normalise back or it is a test of the working tree's line endings. */
const readLF = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const SUBDIRS = ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"];

function makeRoot() {
  const root = path.join(TEMP, `root${made += 1}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}
function makeProject(root, slug, { project = {}, files = {} } = {}) {
  const dir = path.join(root, slug);
  for (const sub of SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
    meta: { title: slug },
    scenes: [], shots: [], characters: [], locations: [], props: [], vehicles: [], audio: [],
    mediaAssets: [],
    ...project,
  }, null, 2));
  return dir;
}
const activate = (root, slug, extra = {}) =>
  Service.activateProject({ projectsRoot: root, slug, reason: "explicit", throttleMs: 0, ...extra });
const ledgerOf = (dir) => Store.readLedger(dir).ledger.assets;
const rowFor = (dir, relativePath) => ledgerOf(dir).find((a) => a.storage.path === relativePath);
const liveRow = (dir, relativePath) =>
  ledgerOf(dir).find((a) => a.storage.path === relativePath && a.storage.missing !== true);
const idMap = (dir) => Object.fromEntries(ledgerOf(dir).map((a) => [`${a.storage.path}#${a.assetId}`, a.assetId]));

async function main() {
  /* ======================================================================
     1-4. BACKFILL: the media a project already has acquires identity
     ====================================================================== */
  {
    const root = makeRoot();
    /* Every supported bucket the product enumerates, plus files it must ignore. */
    const dir = makeProject(root, "buckets", {
      files: {
        "anchors/CHAR-KAI.png": bytesOf("kai"),
        "plates/LOC-BAR.jpg": bytesOf("bar"),
        "props/PROP-CUP.webp": bytesOf("cup"),
        "vehicles/VEH-VAN.png": bytesOf("van"),
        "audio/VO.wav": bytesOf("vo"),
        "media/LIB.png": bytesOf("lib"),
        "shots/S-01/takes/TAKE.png": bytesOf("take"),
        "shots/S-01/locked/LOCK.png": bytesOf("lock"),
        "shots/S-01/blocking/BLOCK.png": bytesOf("block"),
        "shots/S-01/takes/CLIP.mp4": bytesOf("clip"),
        /* 16. unsupported extension, and non-media directories */
        "shots/S-01/takes/notes.txt": "not media",
        "media/readme.md": "not media",
        "docs/brief.md": "not media",
        "media-assets-decoy.png": bytesOf("decoy"),          /* project root: not a media dir */
        "shots/S-01/takes/deeper/NESTED.png": bytesOf("deep"), /* deeper than the layout */
      },
      project: { shots: [{ id: "S-01", keyframes: [], clips: [], candidateFiles: [] }] },
    });

    const first = await activate(root, "buckets");
    assert.strictEqual(first.status, "complete");
    assert.strictEqual(first.ledgerExisted, false, "a first pass is a backfill");
    assert.deepStrictEqual(ledgerOf(dir).map((a) => a.storage.path).sort(), [
      "anchors/CHAR-KAI.png", "audio/VO.wav", "media/LIB.png", "plates/LOC-BAR.jpg",
      "props/PROP-CUP.webp", "shots/S-01/blocking/BLOCK.png", "shots/S-01/locked/LOCK.png",
      "shots/S-01/takes/CLIP.mp4", "shots/S-01/takes/TAKE.png", "vehicles/VEH-VAN.png",
    ], "every supported bucket is indexed; unsupported extensions, non-media folders, the project root and deeper nesting are not");
    for (const asset of ledgerOf(dir))
      assert(/^asset-[0-9a-f]{32}$/.test(asset.assetId), `${asset.storage.path} carries a durable assetId`);
    assert.strictEqual(new Set(ledgerOf(dir).map((a) => a.assetId)).size, 10, "and the identities are distinct");
    assert.strictEqual(rowFor(dir, "shots/S-01/takes/CLIP.mp4").mediaType, "video");
    assert.strictEqual(rowFor(dir, "audio/VO.wav").mediaType, "audio");
    /* A backfill reads nothing. This is the cloud-sync guarantee, at the service. */
    assert.strictEqual(first.verified, null, "a backfill runs no verification");
    for (const asset of ledgerOf(dir)) assert.strictEqual(asset.hashState, "unhashed");
    note("1-4 · backfill: 10 files across every supported bucket acquire distinct durable assetIds with zero media bytes read");
    note("16 · an unsupported extension, a non-media folder, the project root and a deeper path are all ignored");

    /* ==================================================================
       5-6. an unchanged repeat preserves identity and changes no byte
       ================================================================== */
    const idsBefore = idMap(dir);
    const ledgerBytes = fs.readFileSync(path.join(dir, "media-assets.json"));
    const second = await activate(root, "buckets");
    const third = await activate(root, "buckets");
    assert.deepStrictEqual(idMap(dir), idsBefore, "repeated activation must preserve every assetId");
    assert.strictEqual(second.indexed.minted, 0);
    assert.strictEqual(second.indexed.wrote, false, "an unchanged pass writes nothing");
    assert.strictEqual(third.indexed.wrote, false);
    assert(ledgerBytes.equals(fs.readFileSync(path.join(dir, "media-assets.json"))),
      "and the persisted ledger is byte-identical across unchanged passes");
    assert.strictEqual(second.verified, null, "an unchanged pass reads no bytes either");
    note("5-6 · three passes over an unchanged project: same ids, no write, byte-identical sidecar, zero byte reads");
  }

  /* ======================================================================
     21 + 7. new media after open acquires identity — and a rename keeps it
     ====================================================================== */
  {
    const root = makeRoot();
    /* 1. a project with no media at all. */
    const empty = makeProject(root, "empty", {});
    const emptyPass = await activate(root, "empty");
    assert.strictEqual(emptyPass.status, "complete");
    assert.strictEqual(emptyPass.indexed.indexed, 0);
    assert.strictEqual(Store.readLedger(empty).exists, false, "1 · a project with no media creates no ledger");
    note("1 · an empty project produces no sidecar at all");

    const dir = makeProject(root, "rename", {
      project: { shots: [{ id: "SH010", keyframes: [], clips: [], candidateFiles: [] }] },
      files: { "media/SEED.png": bytesOf("seed") },
    });
    /* The backfill. It reads nothing, so SEED.png carries identity and no digest —
       the honest consequence of the byte-read policy, asserted here rather than
       described: media that was already present when CineBraid first indexed the
       project is byte-anchored only by a deliberate verifyNow. */
    const backfill = await activate(root, "rename");
    assert.strictEqual(backfill.verified, null);
    assert.strictEqual(rowFor(dir, "media/SEED.png").hashState, "unhashed");

    /* 21. media appears while CineBraid is already running. */
    fs.mkdirSync(path.join(dir, "shots", "SH010", "takes"), { recursive: true });
    fs.writeFileSync(path.join(dir, "shots", "SH010", "takes", "FRAME_A_FAL_1.png"), bytesOf("frame-a"));
    const arrival = await activate(root, "rename");
    const original = rowFor(dir, "shots/SH010/takes/FRAME_A_FAL_1.png");
    assert(original, "21 · media added after the project was opened acquires identity without a restart");
    /* A ledger already existed, so this is an INCREMENTAL pass: the new arrival is
       verified, which is what makes a later rename provable. */
    assert.strictEqual(arrival.verified.verified, 1, "and a new arrival is hashed while it still exists");
    assert.strictEqual(original.hashState, "hashed");
    assert.strictEqual(original.contentHash, `sha256:${sha256Hex(bytesOf("frame-a"))}`);
    const keptId = original.assetId;
    const keptHash = original.contentHash;
    note("21 · a file that appears after project open is indexed and hashed on the next pass — no restart needed");

    /* 7. THE CENTRAL RENAME PROOF. */
    fs.renameSync(
      path.join(dir, "shots", "SH010", "takes", "FRAME_A_FAL_1.png"),
      path.join(dir, "shots", "SH010", "takes", "PROJECT_SH010_FRAME_A_V001.png"),
    );
    const renamed = await activate(root, "rename");
    assert.strictEqual(renamed.verified.renames.length, 1, "the pass reports one reconciled rename");
    const moved = rowFor(dir, "shots/SH010/takes/PROJECT_SH010_FRAME_A_V001.png");
    assert.strictEqual(moved.assetId, keptId, "7 · the same bytes at a new path are the SAME MediaAsset");
    assert.strictEqual(moved.contentHash, keptHash, "with the digest it was verified against");
    assert.strictEqual(moved.renamedFrom, "shots/SH010/takes/FRAME_A_FAL_1.png", "and a record of where it was");
    assert.strictEqual(ledgerOf(dir).length, 2, "the placeholder identity is absorbed, not left as a third row");
    assert(moved.absorbedAssetIds.length === 1 && moved.absorbedAssetIds[0] !== keptId,
      "the absorbed id is recorded so an assetId observed before the association still resolves");
    note("7 · CENTRAL RENAME PROOF — same bytes, new filename, same assetId and same contentHash at the new path");
  }

  /* ======================================================================
     8-9. same path, new bytes: a successor, and the old asset survives
     ====================================================================== */
  {
    const root = makeRoot();
    const dir = makeProject(root, "replace", {
      files: { "anchors/CHAR-RHEA.png": bytesOf("rhea-v1") },
      project: { characters: [{ id: "CHAR-RHEA", approvedFile: "CHAR-RHEA.png", continuityStates: [], candidateFiles: [] }] },
    });
    await activate(root, "replace");
    await Service.verifyNow({ projectsRoot: root, slug: "replace" });
    const before = rowFor(dir, "anchors/CHAR-RHEA.png");
    const originalId = before.assetId;
    const originalHash = before.contentHash;
    assert.strictEqual(originalHash, `sha256:${sha256Hex(bytesOf("rhea-v1"))}`);

    /* Same filename, different pixels — the case an authoritySignature over labels
       cannot see and a filename-keyed record cannot represent at all. */
    await new Promise((resolve) => setTimeout(resolve, 15));
    fs.writeFileSync(path.join(dir, "anchors", "CHAR-RHEA.png"), bytesOf("rhea-v2"));
    clearMediaHashMemo();
    const replaced = await activate(root, "replace");
    assert.strictEqual(replaced.verified.replaced, 1, "the drifted row was verified and found to differ");

    const retired = ledgerOf(dir).find((a) => a.assetId === originalId);
    const successor = ledgerOf(dir).find((a) => a.replacedAssetId === originalId);
    assert(retired, "9 · the old asset is RETAINED, not mutated away");
    assert.strictEqual(retired.contentHash, originalHash, "and keeps the digest it was verified against");
    assert.strictEqual(retired.storage.missing, true, "marked as no longer present at that path");
    assert.strictEqual(retired.lifecycle, "approved", "byte replacement is not approval, rejection or supersede");
    assert(successor, "8 · the new bytes get a NEW assetId");
    assert.notStrictEqual(successor.assetId, originalId);
    assert.strictEqual(successor.contentHash, `sha256:${sha256Hex(bytesOf("rhea-v2"))}`);
    assert.strictEqual(successor.storage.path, "anchors/CHAR-RHEA.png", "and occupies the path");
    assert.strictEqual(successor.lifecycle, "candidate", "nothing has approved these bytes");
    note("8-9 · same path + new bytes mints a successor with replacedAssetId; the previous content identity stays historically distinguishable");

    /* And the rename rule did not also fire on the record retired a moment ago. */
    assert.strictEqual((replaced.verified.renames || []).length, 0,
      "a record retired by replacement is excluded from rename reconciliation in the same pass");
  }

  /* ======================================================================
     10-12. missing, and the three ways a file comes back
     ====================================================================== */
  {
    const root = makeRoot();
    const dir = makeProject(root, "gone", {
      files: { "media/A.png": bytesOf("a"), "media/B.png": bytesOf("b") },
    });
    await activate(root, "gone");
    await Service.verifyNow({ projectsRoot: root, slug: "gone" });
    const idA = rowFor(dir, "media/A.png").assetId;
    const hashA = rowFor(dir, "media/A.png").contentHash;

    /* 10. it vanishes. */
    fs.unlinkSync(path.join(dir, "media", "A.png"));
    await activate(root, "gone");
    const missing = ledgerOf(dir).find((a) => a.assetId === idA);
    assert(missing, "10 · a vanished file does NOT lose its durable identity");
    assert.strictEqual(missing.storage.missing, true, "it is marked, not deleted");
    assert.strictEqual(missing.contentHash, hashA, "and keeps its established byte identity");

    /* 11. it comes back at the same path. */
    fs.writeFileSync(path.join(dir, "media", "A.png"), bytesOf("a"));
    await activate(root, "gone");
    const back = rowFor(dir, "media/A.png");
    assert.strictEqual(back.assetId, idA, "11 · a file returning to its own path reuses its assetId");
    assert.strictEqual(back.storage.missing, undefined);
    assert.strictEqual(ledgerOf(dir).length, 2, "and no second row is created");

    /* 12. it comes back somewhere else, with hash evidence that is unique. */
    fs.unlinkSync(path.join(dir, "media", "A.png"));
    await activate(root, "gone");
    fs.writeFileSync(path.join(dir, "media", "A_RENAMED.png"), bytesOf("a"));
    const returned = await activate(root, "gone");
    assert.strictEqual(returned.verified.renames.length, 1);
    const elsewhere = rowFor(dir, "media/A_RENAMED.png");
    assert.strictEqual(elsewhere.assetId, idA, "12 · unique digest evidence reconciles a return at a new path");
    note("10-12 · a missing file keeps its identity and its digest; it reconciles on return at the same path, and at a new path when the digest is unique");
  }

  /* ======================================================================
     13-15. the three ways identity must REFUSE to collapse
     ====================================================================== */
  {
    const root = makeRoot();
    const dir = makeProject(root, "collapse", {
      files: {
        /* 13. one basename, four directories. */
        "anchors/take.png": bytesOf("anchor-take"),
        "props/take.png": bytesOf("prop-take"),
        "shots/S-01/takes/take.png": bytesOf("s01-take"),
        "shots/S-02/takes/take.png": bytesOf("s02-take"),
        /* 14. two live files, byte-identical. */
        "media/twin-left.png": bytesOf("twin"),
        "media/twin-right.png": bytesOf("twin"),
      },
      project: {
        shots: [
          { id: "S-01", keyframes: [], clips: [], candidateFiles: [{ stored: "take.png", generationJobId: "gen-s01" }] },
          { id: "S-02", keyframes: [], clips: [], candidateFiles: [] },
        ],
        /* The bare basename that used to be enough to claim a file. */
        characters: [{ id: "CHAR-RHEA", continuityStates: [], candidateFiles: [{ stored: "take.png", generationJobId: "gen-rhea" }] }],
      },
    });
    await activate(root, "collapse");
    await Service.verifyNow({ projectsRoot: root, slug: "collapse" });

    const paths = ["anchors/take.png", "props/take.png", "shots/S-01/takes/take.png", "shots/S-02/takes/take.png"];
    const ids = paths.map((p) => rowFor(dir, p).assetId);
    assert.strictEqual(new Set(ids).size, 4, "13 · one basename in four directories is four MediaAssets");

    /* And the owner is only ever the one the source proves. */
    assert.strictEqual(rowFor(dir, "anchors/take.png").scope.entityId, "CHAR-RHEA",
      "the characters row owns the file in the characters directory");
    assert.strictEqual(rowFor(dir, "props/take.png").scope.entityId, null,
      "13 · a props file does NOT acquire a character's identity because the basenames match");
    assert.strictEqual(rowFor(dir, "props/take.png").legacy.candidateArray, null,
      "and claims no candidate row it cannot prove");
    assert.strictEqual(rowFor(dir, "props/take.png").source, "unknown",
      "and does not inherit the other entity's generationJobId as proof it was generated");
    assert.strictEqual(rowFor(dir, "shots/S-01/takes/take.png").source, "generated",
      "while a shot-scoped candidate row IS proof, because it is keyed by shot AND filename");
    assert.strictEqual(rowFor(dir, "shots/S-02/takes/take.png").source, "unknown",
      "and does not reach into the other shot");
    note("13 · four same-named files in four directories are four assets; a props file never inherits a character's row, and a shot row never reaches another shot");

    /* 14. identical content is not permission to merge. */
    const left = rowFor(dir, "media/twin-left.png");
    const right = rowFor(dir, "media/twin-right.png");
    assert.notStrictEqual(left.assetId, right.assetId, "14 · two live files with identical bytes stay two MediaAssets");
    assert.strictEqual(left.contentHash, right.contentHash, "even though the digests are equal");
    note("14 · two independent current files with equal digests are not merged — a shared contentHash is legal");

    /* 15. ambiguous rename: two missing and two present sharing one digest. */
    fs.unlinkSync(path.join(dir, "media", "twin-left.png"));
    fs.unlinkSync(path.join(dir, "media", "twin-right.png"));
    await activate(root, "collapse");
    fs.writeFileSync(path.join(dir, "media", "twin-one.png"), bytesOf("twin"));
    fs.writeFileSync(path.join(dir, "media", "twin-two.png"), bytesOf("twin"));
    const ambiguous = await activate(root, "collapse");
    assert.strictEqual(ambiguous.verified.renames.length, 0, "15 · an ambiguous match reconciles NOTHING");
    assert.strictEqual(ambiguous.verified.ambiguous.length, 1, "and says so");
    assert(rowFor(dir, "media/twin-one.png").renameAmbiguous, "the ambiguity is recorded on the row");
    assert(ledgerOf(dir).some((a) => a.assetId === left.assetId && a.storage.missing),
      "and neither missing identity is transplanted onto whichever file happens to hold a copy of its bytes");
    note("15 · two missing and two present rows sharing one digest stay ambiguous — no rename is guessed");
  }

  /* ======================================================================
     THE INDEXER LEGACY-LINK AUDIT — the cases activation had to be safe for
     ====================================================================== */
  {
    const root = makeRoot();
    const dir = makeProject(root, "legacy", {
      files: {
        "anchors/RHEA.png": bytesOf("rhea"),
        "anchors/SHARED.png": bytesOf("shared"),
        "plates/RHEA.png": bytesOf("plate-rhea"),
        "shots/S-01/blocking/BLOCK.png": bytesOf("block-1"),
        "shots/S-02/blocking/BLOCK.png": bytesOf("block-2"),
        "media/PATHLESS.png": bytesOf("pathless"),
        "shots/S-03/blocking/LEGACY.png": bytesOf("legacy-block"),
        "anchors/JANE-DOE.png": bytesOf("jane-doe"),
      },
      project: {
        shots: [
          { id: "S-01", keyframes: [], clips: [], candidateFiles: [], creationBrief: { activeBlockingAssetId: "blk-1" } },
          { id: "S-02", keyframes: [], clips: [], candidateFiles: [] },
          { id: "S-03", keyframes: [], clips: [], candidateFiles: [] },
          /* 5. a project record naming a file that is not on disk. */
          { id: "S-04", winner: "NEVER_EXISTED.png", keyframes: [], clips: [], candidateFiles: [{ stored: "NEVER_EXISTED.png" }] },
        ],
        characters: [
          /* 3. prefix-colliding entity ids — the JANE / JANE-DOE absorption. */
          { id: "JANE", continuityStates: [], candidateFiles: [] },
          { id: "JANE-DOE", approvedFile: "JANE-DOE.png", continuityStates: [], candidateFiles: [{ stored: "JANE-DOE.png" }] },
          /* 2. same basename in two entity collections. */
          { id: "CHAR-RHEA", approvedFile: "RHEA.png", continuityStates: [], candidateFiles: [{ stored: "RHEA.png" }] },
          /* Two characters claiming one filename: ambiguous, and neither wins. */
          { id: "CHAR-A", continuityStates: [], candidateFiles: [{ stored: "SHARED.png" }] },
          { id: "CHAR-B", continuityStates: [], candidateFiles: [{ stored: "SHARED.png" }] },
        ],
        locations: [{ id: "LOC-RHEA", continuityStates: [], candidateFiles: [{ stored: "RHEA.png" }] }],
        mediaAssets: [
          /* 9. storagePath is the evidence, and it disagrees with a bare basename. */
          { id: "blk-1", file: "BLOCK.png", storagePath: "shots/S-01/blocking/BLOCK.png", links: [{ targetType: "shot", targetId: "S-01", role: "blocking-frame", blockingState: "active" }] },
          /* 8. a legacy row naming only a basename, with a link that proves its shot. */
          { id: "blk-legacy", file: "LEGACY.png", links: [{ targetType: "shot", targetId: "S-03", role: "blocking-frame" }] },
          /* A pathless row with no shot link resolves to media/, the product's own convention. */
          { id: "lib-pathless", file: "PATHLESS.png", generationRecord: { provider: "fal" }, links: [] },
        ],
      },
    });
    await activate(root, "legacy");

    /* 2. cross-collection basename claim is refused. */
    assert.strictEqual(rowFor(dir, "anchors/RHEA.png").scope.entityId, "CHAR-RHEA");
    assert.strictEqual(rowFor(dir, "plates/RHEA.png").scope.entityId, "LOC-RHEA",
      "a plates file is owned by the LOCATIONS row of that name, not the characters row");
    /* Same-list collision: recorded, not resolved. */
    const shared = rowFor(dir, "anchors/SHARED.png");
    assert.strictEqual(shared.scope.entityId, null, "two characters claiming one filename own it jointly, so neither owns it");
    assert.deepStrictEqual(shared.legacy.unresolved, ["entity.candidateFiles"], "and the ambiguity is recorded rather than dropped");

    /* 3. a prefix-colliding id does not absorb the longer one's file. */
    assert.strictEqual(rowFor(dir, "anchors/JANE-DOE.png").scope.entityId, "JANE-DOE",
      "JANE must not absorb JANE-DOE's library — ownership comes from a candidate row, never from a prefix");

    /* 1/10. same basename in two shot blocking folders, one of them active. */
    assert.strictEqual(rowFor(dir, "shots/S-01/blocking/BLOCK.png").legacy.libraryAssetId, "blk-1");
    assert.strictEqual(rowFor(dir, "shots/S-01/blocking/BLOCK.png").lifecycle, "approved");
    assert.strictEqual(rowFor(dir, "shots/S-02/blocking/BLOCK.png").legacy.libraryAssetId, null,
      "9 · a library row's storagePath is the evidence; a same-named file in another shot is not that row");
    assert.strictEqual(rowFor(dir, "shots/S-02/blocking/BLOCK.png").lifecycle, "candidate",
      "and an ACTIVE blocking guide in one shot does not mark another shot's same-named file approved");

    /* 8. a pathless legacy row still links, through the shot its own link names. */
    assert.strictEqual(rowFor(dir, "shots/S-03/blocking/LEGACY.png").legacy.libraryAssetId, "blk-legacy",
      "8 · a row written before storagePath existed still proves its shot through its link");
    assert.strictEqual(rowFor(dir, "media/PATHLESS.png").legacy.libraryAssetId, "lib-pathless",
      "and a pathless row with no shot link resolves to media/, which is what the product itself renders");
    assert.strictEqual(rowFor(dir, "media/PATHLESS.png").source, "generated");

    /* 4/5. files with no record, and records with no file. */
    assert.strictEqual(rowFor(dir, "anchors/JANE-DOE.png").legacy.candidateArray, "entity.candidateFiles");
    assert.strictEqual(ledgerOf(dir).some((a) => a.storage.path.includes("NEVER_EXISTED")), false,
      "5 · a project record naming a file that is not on disk creates no ledger row");
    note("legacy-link audit · cross-collection basenames, same-list collisions, prefix-colliding ids, storagePath disagreement, pathless legacy rows, records with no file and files with no record all resolve to the proven owner or to none");
  }

  /* ======================================================================
     17. the filesystem universe cannot be widened
     ====================================================================== */
  {
    const root = makeRoot();
    makeProject(root, "contained", { files: { "media/IN.png": bytesOf("in") } });
    fs.mkdirSync(path.join(root, "..", "outside-root"), { recursive: true });

    for (const slug of ["..", ".", "../outside-root", "nested/child", "C:\\Windows", "/etc", ""]) {
      assert.strictEqual(Service.resolveProjectDir(root, slug), "",
        `17 · "${slug}" must not resolve to a project directory`);
      const refused = await activate(root, slug);
      assert.strictEqual(refused.status, "skipped");
      assert.strictEqual(refused.reasonDetail, "no-contained-project");
    }
    /* And a ledger row whose path escapes the project is refused at write. */
    assert.throws(
      () => Store.writeLedgerSync(path.join(root, "contained"), {
        schemaVersion: 1,
        assets: [{
          assetId: "asset-".padEnd(38, "0"), contentHash: null, hashState: "unhashed",
          scope: {}, mediaType: "image", role: "unknown", source: "unknown", lifecycle: "candidate",
          storage: { path: "../outside-root/STOLEN.png" }, legacy: {}, indexedAt: "t",
        }],
      }),
      /not-project-relative|LEDGER_INVALID|Refusing/,
      "a storage path that escapes the project never reaches disk",
    );
    note("17 · '..', '.', a nested path, a drive-qualified path and an absolute path all refuse to resolve, and an escaping storage.path is refused at write");
  }

  /* ======================================================================
     18. project A -> B -> A isolation
     ====================================================================== */
  {
    const root = makeRoot();
    const a = makeProject(root, "alpha", { files: { "media/A.png": bytesOf("alpha") } });
    const b = makeProject(root, "beta", { files: { "media/B.png": bytesOf("beta") } });
    await activate(root, "alpha", { reason: "switch" });
    const alphaIds = idMap(a);
    await activate(root, "beta", { reason: "switch" });
    await activate(root, "alpha", { reason: "switch" });
    assert.deepStrictEqual(idMap(a), alphaIds, "18 · returning to a project finds its original identities");
    assert.deepStrictEqual(ledgerOf(a).map((x) => x.storage.path), ["media/A.png"], "and only its own media");
    assert.deepStrictEqual(ledgerOf(b).map((x) => x.storage.path), ["media/B.png"], "with no leakage the other way");
    assert.strictEqual(
      ledgerOf(a).filter((x) => ledgerOf(b).some((y) => y.assetId === x.assetId)).length, 0,
      "and no identity appears in both ledgers",
    );

    /* A pass that starts on one project and finds another active abandons the rest
       of its chunks rather than writing into the project the user moved to. */
    const c = makeProject(root, "gamma", {
      files: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`media/G${i}.png`, bytesOf(`g${i}`)])),
    });
    let current = "gamma";
    const aborted = await Service.activateProject({
      projectsRoot: root, slug: "gamma", reason: "explicit", throttleMs: 0,
      chunkSize: 5, activeSlug: () => { const value = current; current = "alpha"; return value; },
    });
    assert.strictEqual(aborted.indexed.status, "aborted-project-switch", "a mid-pass switch abandons the pass");
    assert(ledgerOf(c).length < 40, "leaving only what it had already established");
    assert.deepStrictEqual(idMap(a), alphaIds, "and the project switched TO is untouched by it");
    note("18 · A -> B -> A keeps A's original identities, neither ledger sees the other's rows, and a mid-pass switch abandons rather than contaminating");
  }

  /* ======================================================================
     19-20. a corrupt ledger recovers, and an unrecoverable one fails honestly
     ====================================================================== */
  {
    const root = makeRoot();
    const dir = makeProject(root, "corrupt", { files: { "media/A.png": bytesOf("a"), "media/B.png": bytesOf("b") } });
    await activate(root, "corrupt");
    /* Force a second write so a .bak exists. */
    fs.writeFileSync(path.join(dir, "media", "C.png"), bytesOf("c"));
    await activate(root, "corrupt");
    const goodIds = idMap(dir);
    assert(fs.existsSync(path.join(dir, "media-assets.json.bak")), "the store keeps a backup");

    /* 19. primary corrupt, backup readable. */
    fs.writeFileSync(path.join(dir, "media-assets.json"), "{ this is not json");
    const recovered = await activate(root, "corrupt");
    assert.strictEqual(recovered.status, "complete", "19 · a corrupt primary with a good backup recovers");
    assert(recovered.warning.includes("backup"), "and says it loaded the backup");
    for (const [key, id] of Object.entries(goodIds))
      if (!key.startsWith("media/C.png")) assert.strictEqual(idMap(dir)[key], id, "with every identity intact");

    /* 20. both copies unreadable. */
    fs.writeFileSync(path.join(dir, "media-assets.json"), "{ still not json");
    fs.writeFileSync(path.join(dir, "media-assets.json.bak"), "{ nor is this");
    const failed = await activate(root, "corrupt");
    assert.strictEqual(failed.status, "failed", "20 · both copies unreadable is a failure, not an empty ledger");
    assert.strictEqual(failed.error.code, "LEDGER_UNREADABLE");
    assert.strictEqual(fs.readFileSync(path.join(dir, "media-assets.json"), "utf8"), "{ still not json",
      "and both files are left exactly as they were found");
    assert.throws(() => Service.readAssets(root, "corrupt"), /LEDGER_UNREADABLE|unreadable/,
      "a reader is refused rather than told the project has no media");
    note("19-20 · a corrupt primary recovers from .bak with identities intact; both corrupt fails loudly, changes nothing, and never reads as zero assets");
  }

  /* ======================================================================
     CONCURRENCY, COALESCING AND THROTTLING
     ====================================================================== */
  {
    const root = makeRoot();
    const dir = makeProject(root, "concurrent", {
      files: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`media/F${i}.png`, bytesOf(`f${i}`)])),
    });
    Service.resetActivationState();
    /* Two overlapping activations. indexProject reads, mutates and writes across an
       await and does not take the store's write chain, so two concurrent passes
       would lose rows. */
    const [one, two] = await Promise.all([
      activate(root, "concurrent", { chunkSize: 5 }),
      activate(root, "concurrent", { chunkSize: 5 }),
    ]);
    assert.strictEqual(one.status, "complete");
    assert.strictEqual(two.status, "complete");
    assert.strictEqual(ledgerOf(dir).length, 60, "every file has exactly one row after overlapping activations");
    assert.strictEqual(new Set(ledgerOf(dir).map((a) => a.storage.path)).size, 60, "and no path is duplicated");
    const status = Service.activationStatus(root, "concurrent");
    assert(status.passes <= 2, "the second request coalesced into a follow-up rather than a second writer");

    /* The throttle: /api/scan fires after most mutations. */
    Service.resetActivationState();
    await Service.activateProject({ projectsRoot: root, slug: "concurrent", reason: "scan" });
    await Service.activateProject({ projectsRoot: root, slug: "concurrent", reason: "scan" });
    await Service.activateProject({ projectsRoot: root, slug: "concurrent", reason: "scan" });
    const throttled = Service.activationStatus(root, "concurrent");
    assert.strictEqual(throttled.passes, 1, "a burst of scans is one pass");
    assert.strictEqual(throttled.throttled, 2, "and the rest are throttled, not queued");
    /* A switch is the user moving, and is never throttled. */
    await Service.activateProject({ projectsRoot: root, slug: "concurrent", reason: "switch" });
    assert.strictEqual(Service.activationStatus(root, "concurrent").passes, 2, "a switch bypasses the throttle");

    /* An activation that arrives while an explicit verification holds the per-project
       slot must be DELAYED, never dropped. verifyNow runs no follow-up loop of its
       own, so a request that parked itself on the slot has to be drained by whoever
       releases it. */
    Service.resetActivationState();
    await activate(root, "concurrent");
    const before = Service.activationStatus(root, "concurrent").passes;
    const verifying = Service.verifyNow({ projectsRoot: root, slug: "concurrent", limit: 1 });
    const parked = Service.activateProject({ projectsRoot: root, slug: "concurrent", reason: "explicit", throttleMs: 0 });
    await verifying;
    await parked;
    const deadline = Date.now() + 5000;
    while (Service.activationStatus(root, "concurrent").passes <= before && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert(Service.activationStatus(root, "concurrent").passes > before,
      "an activation parked behind a verification runs after it, rather than being silently dropped");
    note("concurrency · overlapping activations produce one row per file; a burst of scans coalesces to one pass; a project switch is never throttled; an activation parked behind an explicit verification is delayed rather than dropped");
  }

  /* ======================================================================
     PERFORMANCE AND THE BYTE BUDGET
     ====================================================================== */
  {
    const root = makeRoot();
    const timings = [];
    for (const count of [10, 100, 1000]) {
      const dir = makeProject(root, `perf${count}`, {
        files: Object.fromEntries(Array.from({ length: count }, (_, i) => [`media/P${i}.png`, PNG])),
      });
      const started = Date.now();
      const first = await activate(root, `perf${count}`);
      const backfillMs = Date.now() - started;
      const repeatStarted = Date.now();
      const second = await activate(root, `perf${count}`);
      const repeatMs = Date.now() - repeatStarted;
      assert.strictEqual(ledgerOf(dir).length, count);
      assert.strictEqual(first.verified, null, `a ${count}-file backfill reads no media bytes`);
      assert.strictEqual(second.indexed.wrote, false, `and a repeat over ${count} unchanged files writes nothing`);
      assert.strictEqual(second.verified, null, "and reads nothing");
      timings.push(`${count} files: backfill ${backfillMs}ms, unchanged repeat ${repeatMs}ms, 0 bytes read`);
    }
    note(`performance · ${timings.join(" · ")}`);

    /* The incremental budget is bounded and never silent about what it deferred. */
    const dir = path.join(root, "perf1000");
    for (let i = 0; i < 40; i += 1) fs.writeFileSync(path.join(dir, "media", `NEW${i}.png`), bytesOf(`new${i}`));
    const burst = await activate(root, "perf1000");
    assert.strictEqual(burst.verified.verified, Service.VERIFY_FILE_LIMIT,
      "an incremental pass verifies at most VERIFY_FILE_LIMIT files");
    assert.strictEqual(burst.verificationDeferred, 40 - Service.VERIFY_FILE_LIMIT,
      "and reports exactly how many it left for the next pass rather than dropping them silently");
    assert.strictEqual(ledgerOf(dir).length, 1040, "while every one of them still acquired identity immediately");
    note(`byte budget · 40 new files in one pass: ${Service.VERIFY_FILE_LIMIT} verified, ${burst.verificationDeferred} deferred and reported, all 40 identified`);
  }

  /* ======================================================================
     22-25. what this phase must NOT have done
     ====================================================================== */
  {
    const root = makeRoot();
    const projectDoc = {
      shots: [{
        id: "S-01", winner: "WIN.png", canonicalName: "WIN.png",
        keyframes: [{ id: "frame-a", winner: "WIN.png" }],
        clips: [{ id: "clip-1", videoWinner: "CLIP.mp4" }],
        candidateFiles: [{ stored: "WIN.png", decision: "shortlist", generationJobId: "gen-1" }],
      }],
      characters: [{ id: "CHAR-KAI", approvedFile: "KAI.png", continuityStates: [{ id: "s1", approvedFile: "KAI.png" }], candidateFiles: [{ stored: "KAI.png" }] }],
    };
    const dir = makeProject(root, "untouched", {
      project: projectDoc,
      files: {
        "shots/S-01/takes/WIN.png": bytesOf("win"),
        "shots/S-01/takes/CLIP.mp4": bytesOf("clip"),
        "anchors/KAI.png": bytesOf("kai"),
      },
    });
    const projectBefore = fs.readFileSync(path.join(dir, "project.json"));
    await activate(root, "untouched");
    await Service.verifyNow({ projectsRoot: root, slug: "untouched" });
    fs.renameSync(path.join(dir, "shots", "S-01", "takes", "WIN.png"), path.join(dir, "shots", "S-01", "takes", "APPROVED.png"));
    await activate(root, "untouched");

    /* 25. project.json is byte-identical after a backfill, a verification and a
       reconciled rename. */
    assert(projectBefore.equals(fs.readFileSync(path.join(dir, "project.json"))),
      "25 · nothing in activation writes project.json");
    const after = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
    /* 22. the approval pointers still say exactly what they said. */
    assert.strictEqual(after.shots[0].winner, "WIN.png", "22 · a winner is still the filename it was");
    assert.strictEqual(after.shots[0].keyframes[0].winner, "WIN.png");
    assert.strictEqual(after.characters[0].approvedFile, "KAI.png");
    assert.strictEqual(after.characters[0].continuityStates[0].approvedFile, "KAI.png");
    /* 23. no candidate identity was invented. */
    assert.strictEqual("candidateId" in after.shots[0].candidateFiles[0], false, "23 · no candidateId exists");
    assert.strictEqual("assetId" in after.shots[0].candidateFiles[0], false,
      "24 · and no assetId was propagated into a legacy record — that is C2");
    assert(!/candidateId/.test(readLF("media-asset-service.js") + readLF("media-asset-indexer.js")),
      "23 · and none is minted anywhere in this phase");

    /* Legacy-link audit case 6: renamed bytes while the old filename row remains.
       This is the C1/C2 boundary made visible — the IDENTITY survived the rename,
       and the legacy link did not, because `candidateFiles[].stored` still names
       WIN.png and nothing proves that row describes APPROVED.png. Saying so is the
       correct answer; inventing the link is what C2 will do properly, by carrying
       the assetId rather than by matching a string. */
    const renamedRow = liveRow(dir, "shots/S-01/takes/APPROVED.png");
    assert(renamedRow, "the renamed file is still in the ledger");
    assert.strictEqual(renamedRow.legacy.candidateKey, null,
      "a stale candidate pointer is reported as no link, not matched to the new filename");
    assert.strictEqual(renamedRow.lifecycle, "candidate",
      "and the row does not claim approval that now points at a filename which no longer exists");
    assert.strictEqual(after.shots[0].candidateFiles[0].stored, "WIN.png",
      "while the legacy record itself is left exactly as it was");
    note("legacy-link audit case 6 · after a rename the assetId and digest survive while the stale candidate pointer resolves to NO link — identity outlives the filename, and C2 is what reconnects the record");
    note("22-25 · after a backfill, an explicit verification and a reconciled rename, project.json is byte-identical, every approval pointer is unchanged, and no candidateId or assetId was written into a legacy record");

    /* The service is structurally incapable of writing a project. */
    const serviceSource = readLF("media-asset-service.js");
    for (const forbidden of ["writeFileSync", "writeProject", "atomicWriteJson", "renameSync", "unlinkSync"])
      assert(!new RegExp(`\\b${forbidden}\\s*\\(`).test(serviceSource),
        `media-asset-service.js must not call ${forbidden} — it schedules and reads, and the store is the only writer`);
  }

  /* ======================================================================
     26-29. the surrounding foundation, pinned by source
     ====================================================================== */
  {
    /* 29. The FLF motion-readiness gate, pinned exactly as its own suites pin it. */
    const studio = readLF("public/creation-studio.js");
    const opener = studio.slice(studio.indexOf("window.openGuidedMotionFromFrames"));
    const gate = opener.indexOf('if (approvedCount >= 2 && !sequenceReview?.pass) return toast(');
    const navigates = opener.indexOf('c.deliveryIntent = "motion";');
    assert(gate > 0 && navigates > 0 && gate < navigates,
      "29 · the FLF motion-readiness gate still runs before the motion panel opens");
    assert(/const sequenceReview = guidedFrameSequenceReviewState\(s, sequenceInputs\);/.test(opener.slice(0, navigates + 200)),
      "and still takes its go/no-go from the frame-sequence review");

    /* 24/26-28. The subsystems this phase must not have reached. */
    /* Comments stripped first: generation-job-store.js cites media-asset-store.js in
       prose as the durability discipline it shares, which is a reference to be kept,
       not a dependency to be caught. What must not exist is an import. */
    const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const rel of ["fal-generation.js", "generation-job-store.js", "generation-lifecycle.js", "automation-runs.js", "public/library-tools.js", "public/review-provenance.js"]) {
      const source = stripComments(readLF(rel));
      for (const moduleName of ["media-asset-service", "media-assets", "media-asset-store", "media-asset-indexer", "media-asset-verify"])
        assert(!new RegExp(`require\\(["'.\\/]*${moduleName}["']\\)`).test(source),
          `${rel} must not import ${moduleName} — generation, approval and run semantics are unchanged by C1`);
      for (const symbol of ["activateProject", "indexProject", "verifyAssets", "mintAssetId"])
        assert(!new RegExp(`\\b${symbol}\\s*\\(`).test(source),
          `${rel} must not call ${symbol} — C1 does not reach into generation, approval or run semantics`);
    }
    note("26-29 · the FLF motion gate is byte-for-byte where it was, and generation, job-ledger, run and approval modules reference nothing in this phase");
  }

  /* ======================================================================
     30. no paid provider call is reachable from activation
     ====================================================================== */
  {
    const http = require("http");
    const https = require("https");
    const realFetch = global.fetch;
    const realHttp = http.request;
    const realHttps = https.request;
    const attempts = [];
    global.fetch = (...args) => { attempts.push(`fetch ${args[0]}`); throw new Error("network is not reachable from activation"); };
    http.request = (...args) => { attempts.push(`http ${args[0]}`); throw new Error("network is not reachable from activation"); };
    https.request = (...args) => { attempts.push(`https ${args[0]}`); throw new Error("network is not reachable from activation"); };
    try {
      const root = makeRoot();
      const dir = makeProject(root, "offline", { files: { "media/A.png": bytesOf("offline-a") } });
      const offline = await activate(root, "offline");
      assert.strictEqual(offline.status, "complete", "activation completes with the network unusable");
      fs.writeFileSync(path.join(dir, "media", "B.png"), bytesOf("offline-b"));
      const incremental = await activate(root, "offline");
      assert.strictEqual(incremental.verified.verified, 1, "including the hashing pass");
      await Service.verifyNow({ projectsRoot: root, slug: "offline" });
    } finally {
      global.fetch = realFetch;
      http.request = realHttp;
      https.request = realHttps;
    }
    assert.deepStrictEqual(attempts, [], "30 · activation, indexing, hashing and reconciliation make no outbound request of any kind");
    /* And structurally: the ledger pipeline imports fs, path and crypto, nothing else. */
    for (const rel of ["media-assets.js", "media-asset-store.js", "media-asset-indexer.js", "media-asset-verify.js", "media-asset-service.js", "media-hash.js"]) {
      const requires = [...readLF(rel).matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
      for (const dependency of requires)
        assert(dependency.startsWith("./") || ["fs", "path", "crypto"].includes(dependency),
          `${rel} requires ${dependency} — the ledger pipeline reaches nothing but the filesystem`);
    }
    note("30 · with fetch, http.request and https.request all armed to record and throw, a full activation cycle makes zero outbound requests; the pipeline imports only fs, path and crypto");
  }

  console.log(`MediaAsset activation suite passed (${notes.length} findings):`);
  for (const line of notes) console.log(`  · ${line}`);
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch {}
  });

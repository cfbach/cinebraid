/* CineBraid MediaAsset identity and schema.
 *
 * Two properties carry the whole media layer, and both are easy to get backwards:
 *
 *   assetId is independent of content. Minted from randomness, so an asset has a
 *   complete identity before anything reads its bytes — which is what lets a
 *   cloud-synced project be indexed without downloading it. Two assets may share a
 *   contentHash legitimately, and a content-derived id would make that state
 *   unrepresentable.
 *
 *   A verified hash survives unavailability. Dropping it when a file becomes
 *   temporarily unreadable would discard the only durable statement about those
 *   bytes at exactly the moment nothing can re-derive it.
 */
const assert = require("assert");
const A = require("../media-assets");

/* ---- 1. format ---- */
const sample = A.mintAssetId();
assert.match(sample, /^asset-[0-9a-f]{32}$/, "an assetId is 'asset-' + 32 lowercase hex");
assert.strictEqual(sample.length, 38, "asset- (6) + 32 hex");
assert(A.isValidAssetId(sample));

for (const good of [
  "asset-0123456789abcdef0123456789abcdef",
  "asset-" + "a".repeat(32),
  "asset-" + "0".repeat(32),
  "asset-ffffffffffffffffffffffffffffffff",
]) assert(A.isValidAssetId(good), `${good} must validate`);

for (const bad of [
  "asset-0123456789ABCDEF0123456789abcdef",   /* uppercase hex */
  "ASSET-0123456789abcdef0123456789abcdef",   /* uppercase prefix */
  "asset-0123456789abcdef0123456789abcde",    /* 31 hex */
  "asset-0123456789abcdef0123456789abcdef0",  /* 33 hex */
  "asset-0123456789abcdef",                   /* the superseded 16-hex shape */
  "asset-8f21c4a9b3d0",                       /* the superseded 12-hex shape */
  "media-0123456789abcdef0123456789abcdef",   /* wrong prefix */
  "0123456789abcdef0123456789abcdef",         /* no prefix */
  "asset-0123456789abcdef0123456789abcdeg",   /* non-hex */
  "asset-",
  "asset",
  "",
  null, undefined, 42, {}, [],
]) assert.strictEqual(A.isValidAssetId(bad), false, `${JSON.stringify(bad)} must be rejected`);

/* ---- 2. uniqueness over a useful sample ----
   Not a proof — 128 bits makes a collision a programming error rather than an
   expected branch — but it would catch a mint that is not actually random. */
const SAMPLE_SIZE = 100000;
const minted = new Set();
for (let i = 0; i < SAMPLE_SIZE; i += 1) {
  const id = minted.size === 0 ? sample : A.mintAssetId();
  assert(A.isValidAssetId(id), "every minted id must validate");
  minted.add(id);
}
assert.strictEqual(minted.size, SAMPLE_SIZE, `${SAMPLE_SIZE} mints must produce ${SAMPLE_SIZE} distinct ids`);

/* ---- 3. identity is never derived from content ---- */
const SHARED_HASH = "sha256:" + "be31".repeat(16);
assert.strictEqual(SHARED_HASH.length, "sha256:".length + 64);
const first = A.mintAssetId();
const second = A.mintAssetId();
assert.notStrictEqual(first, second, "two mints differ even for identical content");

function asset(overrides = {}) {
  return {
    assetId: A.mintAssetId(),
    contentHash: null,
    hashState: "unhashed",
    scope: { shotId: "SC-01-01", frameId: null, clipId: null, entityList: null, entityId: null },
    mediaType: "image",
    role: "frame-candidate",
    source: "unknown",
    lifecycle: "candidate",
    storage: { path: "shots/SC-01-01/takes/SC-01-01_FRAME_A_FAL_1.png", bytes: 1839221, mtimeMs: 1 },
    legacy: { candidateArray: "shot.candidateFiles", candidateKey: "SC-01-01_FRAME_A_FAL_1.png", libraryAssetId: null },
    indexedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}
function ok(a, label) {
  const result = A.validateMediaAsset(a);
  assert(result.ok, `${label} must validate. Errors: ${JSON.stringify(result.errors)}`);
}
function rejects(a, code, label) {
  const result = A.validateMediaAsset(a);
  assert(!result.ok, `${label} must be rejected`);
  assert(result.errors.some((e) => e.code === code),
    `${label} must be rejected with ${code}, got ${JSON.stringify(result.errors)}`);
}

/* The same bytes, two production records — the case a content-derived id could not
   express. Both are valid, and they carry different identities. */
const twinA = asset({ assetId: first, hashState: "hashed", contentHash: SHARED_HASH, scope: { shotId: "SC-01-01" } });
const twinB = asset({ assetId: second, hashState: "hashed", contentHash: SHARED_HASH, scope: { shotId: "SC-02-01" } });
ok(twinA, "an asset with a shared content hash");
ok(twinB, "its twin in another shot");
assert.strictEqual(twinA.contentHash, twinB.contentHash, "the fixture must actually share a hash");
assert.notStrictEqual(twinA.assetId, twinB.assetId, "identical content must not collapse identity");
assert.strictEqual(A.validateLedger({ schemaVersion: 1, assets: [twinA, twinB] }).ok, true,
  "a ledger holding both must validate — sharing a contentHash is legal");

/* ---- 4. the three legal hash states ---- */
ok(asset(), "unhashed + null");
ok(asset({ hashState: "hashed", contentHash: SHARED_HASH }), "hashed + a digest");
ok(asset({ hashState: "unavailable", contentHash: null }), "unavailable + null (never hashed)");
ok(asset({ hashState: "unavailable", contentHash: SHARED_HASH }), "unavailable + a retained digest");

/* ---- 5. every illegal pairing ---- */
rejects(asset({ hashState: "hashed", contentHash: null }), "contradiction", "hashed with no digest");
rejects(asset({ hashState: "unhashed", contentHash: SHARED_HASH }), "contradiction", "unhashed carrying a digest");
rejects(asset({ hashState: "hashed", contentHash: "sha256:" + "a".repeat(63) }), "malformed-digest", "a short digest");
rejects(asset({ hashState: "hashed", contentHash: "sha256:" + "A".repeat(64) }), "malformed-digest", "an uppercase digest");
rejects(asset({ hashState: "hashed", contentHash: "a".repeat(64) }), "malformed-digest", "a digest with no algorithm prefix");
rejects(asset({ hashState: "hashed", contentHash: "md5:" + "a".repeat(32) }), "malformed-digest", "a non-sha256 digest");
rejects(asset({ hashState: "settled" }), "unsupported-value", "an unknown hashState");
rejects(asset({ hashState: null }), "unsupported-value", "a null hashState");

/* ---- 6. a verified hash survives unavailability ----
   The invariant that stops a network hiccup erasing byte identity. */
const wasHashed = asset({ hashState: "hashed", contentHash: SHARED_HASH });
const nowGone = A.markUnavailable(wasHashed);
assert.strictEqual(nowGone.hashState, "unavailable");
assert.strictEqual(nowGone.contentHash, SHARED_HASH, "a verified hash is RETAINED through unavailability");
assert.strictEqual(nowGone.assetId, wasHashed.assetId, "unavailability never re-mints an assetId");
ok(nowGone, "the unavailable form of a previously hashed asset");

const beforeMark = asset();
const neverHashed = A.markUnavailable(beforeMark);
assert.strictEqual(neverHashed.contentHash, null, "an asset that was never hashed stays null");
assert.strictEqual(neverHashed.assetId, beforeMark.assetId, "marking unavailable never changes the assetId");
assert.strictEqual(beforeMark.hashState, "unhashed", "markUnavailable must not mutate its input");
ok(neverHashed, "the unavailable form of a never-hashed asset");

/* And a round trip back: the same asset returning is the same asset. */
const returned = { ...nowGone, hashState: "hashed" };
ok(returned, "an asset that became readable again");
assert.strictEqual(returned.assetId, wasHashed.assetId, "recovery reuses the same assetId");
assert.strictEqual(returned.contentHash, SHARED_HASH, "and can compare against the previously known hash");

/* ---- 7. required fields and vocabularies ---- */
rejects(asset({ assetId: "asset-8f21c4a9b3d0" }), "malformed-asset-id", "a 12-hex assetId");
for (const [field, value, code] of [
  ["mediaType", "hologram", "unsupported-value"],
  ["role", "vibe", "unsupported-value"],
  ["source", "magic", "unsupported-value"],
  ["lifecycle", "pending", "unsupported-value"],
  ["scope", null, "missing"],
  ["storage", null, "missing"],
  ["legacy", null, "missing"],
  ["indexedAt", "", "missing"],
]) rejects(asset({ [field]: value }), code, `${field} = ${JSON.stringify(value)}`);

/* ---- 8. storage paths stay project-relative ----
   An absolute path would bake a machine — and on a synced root, a
   OneDrive/Dropbox/Drive location — into identity, so the project could not be
   moved, restored, or opened on the second machine it is already syncing to. */
for (const bad of [
  "C:\\CineBraid\\projects\\p\\shots\\a.png",
  "C:/CineBraid/projects/p/shots/a.png",
  "/home/user/projects/p/a.png",
  "\\\\server\\share\\a.png",
  "//server/share/a.png",
  "../outside.png",
  "shots/../../outside.png",
  "./shots/a.png",
  "",
]) {
  assert.strictEqual(A.isProjectRelativePath(bad), false, `${JSON.stringify(bad)} is not project-relative`);
  rejects(asset({ storage: { path: bad } }), "not-project-relative", `storage.path ${JSON.stringify(bad)}`);
}
for (const good of ["shots/SC-01-01/takes/a.png", "anchors/CHAR-KAI.png", "audio/vo.wav", "a.png"])
  assert.strictEqual(A.isProjectRelativePath(good), true, `${good} is project-relative`);

/* ---- 9. ledger-level rules ---- */
assert.strictEqual(A.validateLedger({ schemaVersion: 2, assets: [] }).ok, false, "an unknown schemaVersion is rejected");
assert.strictEqual(A.validateLedger({ schemaVersion: 1, assets: "no" }).ok, false, "assets must be an array");
const dup = asset();
assert(A.validateLedger({ schemaVersion: 1, assets: [dup, { ...dup }] }).errors.some((e) => e.code === "duplicate"),
  "a duplicate assetId inside one ledger is rejected");
assert.strictEqual(A.validateLedger(A.emptyLedger()).ok, true, "an empty ledger is valid");

console.log(
  `MediaAsset identity suite passed: 32-lowercase-hex ids with ${SAMPLE_SIZE} distinct mints, identity provably `
  + "independent of content, all three legal hash states plus every illegal pairing, a verified hash retained "
  + "through unavailability without re-minting, and project-relative storage paths enforced.",
);

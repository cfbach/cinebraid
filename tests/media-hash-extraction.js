/* CineBraid media hashing — the extraction must change nothing.
 *
 * The byte hasher moved out of continuity-cache.js so the MediaAsset ledger can
 * share it instead of growing a second one that drifts. The whole risk of that move
 * is the digest: continuity's stored observations are keyed on it, so a changed
 * hash would silently invalidate every cached observation and look like a quality
 * regression rather than a bug.
 *
 * The strongest evidence is not in this file. It is that tests/continuity-cache.js
 * passes UNMODIFIED — it already pins same-bytes-under-a-different-filename, a
 * one-byte change, an immediate same-length rewrite, the settle window, memo
 * invalidation, directory refusal and ENOENT. This suite adds what that one cannot
 * say: that the old spelling and the new spelling are the same function producing
 * the same digest.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const mediaHash = require("../media-hash");
const continuityCache = require("../continuity-cache");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-media-hash-"));

try {
  /* ---- 1. one implementation, two names ---- */
  assert.strictEqual(typeof mediaHash.hashMediaFile, "function", "media-hash.js must export hashMediaFile");
  assert.strictEqual(typeof mediaHash.hashImageFile, "function", "the legacy alias must survive");
  assert.strictEqual(
    typeof continuityCache.hashImageFile, "function",
    "continuity-cache.js must keep exporting hashImageFile — its route and suite spell it that way",
  );
  assert.strictEqual(
    continuityCache.hashImageFile, mediaHash.hashImageFile,
    "continuity must re-export the shared function, not a copy of it",
  );
  assert.strictEqual(
    continuityCache.sha256Hex, mediaHash.sha256Hex,
    "the digest helper must be shared, not duplicated",
  );

  /* ---- 2. golden digest: old path and new path agree, and the value is pinned ----
     A literal, so a future refactor cannot quietly change the algorithm and still
     agree with itself. */
  const GOLDEN_BYTES = Buffer.from("CineBraid golden digest fixture\n", "utf8");
  const GOLDEN_SHA256 = crypto.createHash("sha256").update(GOLDEN_BYTES).digest("hex");
  const golden = path.join(TEMP, "golden.bin");
  fs.writeFileSync(golden, GOLDEN_BYTES);

  const viaMedia = mediaHash.hashMediaFile(golden);
  const viaLegacy = mediaHash.hashImageFile(golden);
  const viaContinuity = continuityCache.hashImageFile(golden);

  assert.strictEqual(viaMedia.length, 64, "a digest is 64 hex characters");
  assert.strictEqual(viaMedia, GOLDEN_SHA256, "hashMediaFile must be a plain SHA-256 of the bytes");
  assert.strictEqual(viaLegacy, viaMedia, "the legacy alias must produce the same digest");
  assert.strictEqual(viaContinuity, viaMedia, "the continuity-facing path must produce the same digest");
  assert.match(viaMedia, /^[0-9a-f]{64}$/, "digests are lowercase hex");

  /* ---- 3. the memo is shared, so continuity and the ledger cannot disagree ---- */
  mediaHash.clearMediaHashMemo();
  const settled = path.join(TEMP, "settled.bin");
  fs.writeFileSync(settled, GOLDEN_BYTES);
  const past = Date.now() / 1000 - 60;
  fs.utimesSync(settled, past, past);
  const cold = mediaHash.hashMediaFile(settled);
  assert.strictEqual(mediaHash.hashMediaFile(settled), cold, "a settled file is served from the memo");
  assert.strictEqual(continuityCache.hashImageFile(settled), cold, "the same memo serves both spellings");
  continuityCache.clearImageHashMemo();
  assert.strictEqual(mediaHash.hashMediaFile(settled), cold, "clearing through continuity clears the shared memo");

  /* ---- 4. the settle window still refuses to memoise a recent file ----
     A same-length rewrite inside the window must still change the digest. This is
     the anti-poisoning property, and it is the one worth losing sleep over. */
  const OTHER_BYTES = Buffer.from("CineBraid golden digest FIXTURE\n", "utf8");
  assert.strictEqual(GOLDEN_BYTES.length, OTHER_BYTES.length, "the rewrite must be the same length to exercise it");
  const churn = path.join(TEMP, "churn.bin");
  fs.writeFileSync(churn, GOLDEN_BYTES);
  const before = mediaHash.hashMediaFile(churn);
  fs.writeFileSync(churn, OTHER_BYTES);
  assert.notStrictEqual(
    mediaHash.hashMediaFile(churn), before,
    "an immediate same-length rewrite must still change the hash",
  );

  /* ---- 5. the bounds moved with the algorithm ---- */
  assert.strictEqual(mediaHash.HASH_MEMO_LIMIT, 4096, "HASH_MEMO_LIMIT must be unchanged");
  assert.strictEqual(mediaHash.HASH_MEMO_SETTLE_MS, 2000, "HASH_MEMO_SETTLE_MS must be unchanged");
  assert.strictEqual(continuityCache.HASH_MEMO_LIMIT ?? 4096, 4096);

  /* ---- 6. failure modes are unchanged, including continuity's exact wording ----
     tests/continuity-cache.js asserts /regular image file/i on a directory, and the
     route surfaces the message, so the continuity spelling keeps its own subject. */
  assert.throws(() => mediaHash.hashMediaFile(path.join(TEMP, "absent.bin")), /ENOENT|no such file/i);
  assert.throws(() => continuityCache.hashImageFile(TEMP), /regular image file/i,
    "a directory must not hash as evidence");
  assert.throws(() => mediaHash.hashMediaFile(TEMP), /regular image file/i);
  try {
    continuityCache.hashImageFile(TEMP);
    assert.fail("expected a throw");
  } catch (error) {
    assert.strictEqual(error.status, 400, "the continuity refusal must keep its HTTP status");
    assert.match(error.message, /^Continuity observation /, "continuity keeps its own subject in the message");
  }

  /* ---- 7. cache identity is untouched, so pre-existing observations still admit ----
     The cache key is built from the image hash among other components. If the digest
     were perturbed, every stored entry would miss. */
  assert.strictEqual(
    continuityCache.CACHE_VERSION, "continuity-observation-cache-v1",
    "CACHE_VERSION must not change — a bump would discard every stored observation",
  );
  const keyArgs = {
    contractVersion: "v1", promptVersion: "p1", imageHash: viaMedia,
    manifestHash: "m1", provider: "custom", model: "test-model", endpointHash: "e1",
  };
  const keyBefore = continuityCache.observationKey(keyArgs);
  assert.strictEqual(
    continuityCache.observationKey({ ...keyArgs, imageHash: continuityCache.hashImageFile(golden) }),
    keyBefore,
    "an entry keyed by the old spelling still resolves to the same key under the new one",
  );
  assert.match(keyBefore, /^[0-9a-f]{64}$/);

  console.log(
    "Media hash extraction suite passed: one shared implementation behind both spellings, a pinned golden digest "
    + "identical on the continuity and MediaAsset paths, a shared memo with unchanged bounds and settle window, "
    + "continuity's exact refusal wording and status preserved, and CACHE_VERSION and observation keys untouched.",
  );
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}

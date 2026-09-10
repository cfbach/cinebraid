/* CineBraid media content hashing.
 *
 * The byte-identity primitive, shared by declared-entity continuity and — from
 * Phase 2 — by the MediaAsset ledger. It was continuity's, and it is unchanged:
 * this module is a MOVE, not a rewrite. The algorithm, the memo, both bounds and
 * the anti-poisoning window below are the ones continuity has been running,
 * because the semantics were already right and re-deriving them would only risk
 * changing a digest that stored observations depend on.
 *
 * What generalised is the NAME. "Image" was accurate when continuity was the only
 * caller; a ledger hashes video and audio too. `hashMediaFile` is the name going
 * forward, and `hashImageFile` stays as continuity's alias so nothing on that side
 * moves.
 *
 * Nothing here reads a directory or decides what to hash. Callers do that, and in
 * Phase 2 they do it only when they were going to read the bytes anyway.
 */

const crypto = require("crypto");
const fs = require("fs");

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/* ---------- media content identity ---------------------------------------

   The hash is of the BYTES. Filenames are not identity: CineBraid renames
   media (/api/media/rename, renameCandidateRecord), and a renamed file with
   identical bytes is the same evidence. Conversely a filename reused for
   different bytes is different evidence.

   The memo is only an optimisation. It never decides identity — it only
   avoids re-reading a file whose path, size and mtime are all unchanged
   within this process. Any doubt re-reads. */
const hashMemo = new Map();
const HASH_MEMO_LIMIT = 4096;
/* Filesystem metadata cannot prove content identity. A file rewritten in place
   with the same byte length, within the same filesystem timestamp tick as the
   write the memo recorded, presents an identical (size, mtime, ctime, inode)
   fingerprint while holding different pixels — and serving one image's
   observation for another is the worst failure this cache can have.

   So the memo is only consulted for files that have been settled for a while.
   A file modified within this window is always re-hashed, which closes the
   collision entirely: to be dangerous a rewrite must land in the same tick as
   the recorded write, and such a file is by definition recent. Approved
   production media is stable and takes the fast path. */
const HASH_MEMO_SETTLE_MS = 2000;

/* A cloud sync client can rewrite mtime, ctime and inode without the bytes
   changing. Three of this key's five components are therefore volatile on a
   OneDrive/Dropbox/Drive root — and that is SAFE, because a changed key can only
   cause a re-hash, never a stale hash. Do not "fix" it by dropping fields. */
const DEFAULT_SUBJECT = "CineBraid media hashing";

function hashMediaFile(absolutePath, { subject = DEFAULT_SUBJECT } = {}) {
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    const error = new Error(`${subject} needs a regular image file.`);
    error.status = 400;
    throw error;
  }
  const settled = Date.now() - stat.mtimeMs > HASH_MEMO_SETTLE_MS;
  const memoKey = `${absolutePath}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.ino}`;
  if (settled) {
    const memoized = hashMemo.get(memoKey);
    if (memoized) return memoized;
  }
  const hash = sha256Hex(fs.readFileSync(absolutePath));
  /* Bounded so a long-lived server scanning a large library cannot grow the
     memo without limit. Eviction only costs a re-read. */
  if (hashMemo.size >= HASH_MEMO_LIMIT) hashMemo.clear();
  if (settled) hashMemo.set(memoKey, hash);
  return hash;
}

/* Continuity's spelling, preserved exactly — including the wording of the
   non-file refusal, which its route surfaces and its suite asserts. Same
   implementation, same memo, same digest. */
function hashImageFile(absolutePath) {
  return hashMediaFile(absolutePath, { subject: "Continuity observation" });
}

function clearMediaHashMemo() {
  hashMemo.clear();
}

module.exports = {
  DEFAULT_SUBJECT,
  HASH_MEMO_LIMIT,
  HASH_MEMO_SETTLE_MS,
  clearImageHashMemo: clearMediaHashMemo,
  clearMediaHashMemo,
  hashImageFile,
  hashMediaFile,
  sha256Hex,
};

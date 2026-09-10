/* CineBraid Phase 2b — the only code allowed to read media bytes.
 *
 * Verification is where the same-path/different-bytes rule and hash-based rename
 * detection actually live, because both need a successful byte read and nothing
 * else in the ledger pipeline is permitted one.
 *
 * Two properties are asserted throughout:
 *
 *   Reading is bounded and explicit. There is no whole-project mode, a pass is
 *   capped by count and by bytes, and nothing invokes it on project open — on a
 *   cloud-synced root an unbounded pass downloads the corpus.
 *
 *   Only a successful, differing hash may retire an identity. A failed open, a
 *   rewritten mtime and a changed size are all hints or transients, and the old
 *   record survives every one of them with its verified digest intact.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const A = require("../src/media/media-assets");
const S = require("../src/media/media-asset-store");
const I = require("../src/media/media-asset-indexer");
const V = require("../src/media/media-asset-verify");
const { clearMediaHashMemo, sha256Hex } = require("../src/media/media-hash");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-verify-"));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let made = 0;
function makeProject(files = { "A.png": PNG }) {
  const dir = path.join(TEMP, `p${made += 1}`);
  fs.mkdirSync(path.join(dir, "shots", "S-01", "takes"), { recursive: true });
  for (const [name, bytes] of Object.entries(files))
    fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", name), bytes);
  return dir;
}
const project = () => ({ shots: [{ id: "S-01", keyframes: [], clips: [], candidateFiles: [] }], mediaAssets: [] });
const take = (name) => `shots/S-01/takes/${name}`;
const rowFor = (dir, p) => S.readLedger(dir).ledger.assets.find((a) => a.storage.path === p);
const digest = (bytes) => `sha256:${sha256Hex(bytes)}`;

/* Fails opening ONE file while leaving stat and every other path working — the
   exact shape of a Files-on-Demand fetch that cannot complete. */
function withUnopenable(target, code, fn) {
  const real = fs.readFileSync;
  fs.readFileSync = function patched(p, ...rest) {
    if (String(p) === target) {
      const error = new Error(`${code}: simulated`);
      error.code = code;
      throw error;
    }
    return real.call(this, p, ...rest);
  };
  try { return fn(); } finally { fs.readFileSync = real; }
}

async function main() {
  clearMediaHashMemo();

  /* ---- 1. there is no whole-project mode ---- */
  const guarded = makeProject();
  await I.indexProject({ projectDir: guarded, slug: "g", project: project() });
  await assert.rejects(
    () => V.verifyAssets({ projectDir: guarded }),
    (error) => error.code === "VERIFY_TARGETS_REQUIRED",
    "verification must refuse to run without explicit targets",
  );
  const unindexed = makeProject();
  assert.strictEqual(
    (await V.verifyAssets({ projectDir: unindexed, paths: [take("A.png")] })).status, "skipped",
    "a project with no ledger has nothing to verify and is not indexed as a side effect",
  );
  assert.strictEqual(S.readLedger(unindexed).exists, false, "and no ledger is created by asking");

  /* ---- 2. first verification is not a mismatch ---- */
  const first = makeProject();
  await I.indexProject({ projectDir: first, slug: "f", project: project() });
  const beforeId = rowFor(first, take("A.png")).assetId;
  assert.strictEqual(rowFor(first, take("A.png")).hashState, "unhashed");
  let result = await V.verifyAssets({ projectDir: first, paths: [take("A.png")] });
  assert.strictEqual(result.verified, 1);
  assert.strictEqual(result.replaced, 0, "a first read has no previous digest to disagree with");
  let row = rowFor(first, take("A.png"));
  assert.strictEqual(row.assetId, beforeId, "identity is unchanged by verification");
  assert.strictEqual(row.hashState, "hashed");
  assert.strictEqual(row.contentHash, digest(PNG));

  /* Verifying again confirms rather than re-verifies, and stays idempotent. */
  result = await V.verifyAssets({ projectDir: first, paths: [take("A.png")] });
  assert.strictEqual(result.confirmed, 1);
  assert.strictEqual(result.wrote, false, "an unchanged confirmation writes nothing");
  assert.strictEqual(rowFor(first, take("A.png")).assetId, beforeId);

  /* ---- 3. metadata churn is cleared by a confirming hash, not by the churn ---- */
  const churn = makeProject();
  await I.indexProject({ projectDir: churn, slug: "c", project: project() });
  await V.verifyAssets({ projectDir: churn, paths: [take("A.png")] });
  const churnId = rowFor(churn, take("A.png")).assetId;
  const churnFile = path.join(churn, "shots", "S-01", "takes", "A.png");
  const future = Date.now() / 1000 + 3600;
  fs.utimesSync(churnFile, future, future);
  await I.indexProject({ projectDir: churn, slug: "c", project: project() });
  assert.strictEqual(rowFor(churn, take("A.png")).needsVerify, true, "the index flags it");
  clearMediaHashMemo();
  result = await V.verifyAssets({ projectDir: churn, paths: [take("A.png")] });
  assert.strictEqual(result.confirmed, 1, "the bytes are the same, so the flag was a false alarm");
  assert.strictEqual(rowFor(churn, take("A.png")).needsVerify, undefined, "and it is cleared");
  assert.strictEqual(rowFor(churn, take("A.png")).assetId, churnId, "identity never moved");

  /* ---- 4. same path, different bytes — the ONLY branch that retires a path ---- */
  const replaced = makeProject();
  await I.indexProject({
    projectDir: replaced, slug: "r",
    project: { shots: [{ id: "S-01", winner: "A.png", keyframes: [], clips: [], candidateFiles: [] }], mediaAssets: [] },
  });
  await V.verifyAssets({ projectDir: replaced, paths: [take("A.png")] });
  const original = rowFor(replaced, take("A.png"));
  const originalId = original.assetId;
  assert.strictEqual(original.lifecycle, "approved", "the fixture starts as an approved winner");

  fs.writeFileSync(path.join(replaced, "shots", "S-01", "takes", "A.png"), PNG_B);
  clearMediaHashMemo();
  result = await V.verifyAssets({ projectDir: replaced, paths: [take("A.png")], detectRenames: false });
  assert.strictEqual(result.replaced, 1);

  const after = S.readLedger(replaced).ledger;
  const retained = after.assets.find((a) => a.assetId === originalId);
  assert(retained, "1: the old record is RETAINED, never mutated into the new content");
  assert.strictEqual(retained.contentHash, digest(PNG), "1: with its previously verified hash");
  assert.strictEqual(retained.hashState, "hashed");
  assert.strictEqual(retained.storage.missing, true, "2: marked as no longer present at that path");
  assert.strictEqual(retained.lifecycle, "approved",
    "7: byte replacement is NOT approval, rejection or supersede — lifecycle is untouched");
  const successor = after.assets.find((a) => a.storage.path === take("A.png") && !a.storage.missing);
  assert.notStrictEqual(successor.assetId, originalId, "3: the new bytes get a NEW assetId");
  assert.strictEqual(successor.contentHash, digest(PNG_B), "4: carrying the newly verified digest");
  assert.strictEqual(successor.hashState, "hashed");
  assert.strictEqual(successor.replacedAssetId, originalId, "5: and a link back to what it replaced");
  assert.strictEqual(successor.lifecycle, "candidate", "nothing has approved these bytes");
  assert.strictEqual(A.validateLedger(after).ok, true, "the resulting ledger is valid");

  /* ---- 5. a failed OPEN never reaches that branch ---- */
  for (const code of ["EBUSY", "EIO", "EPERM"]) {
    const stalled = makeProject();
    await I.indexProject({ projectDir: stalled, slug: "s", project: project() });
    await V.verifyAssets({ projectDir: stalled, paths: [take("A.png")] });
    const stalledId = rowFor(stalled, take("A.png")).assetId;
    clearMediaHashMemo();

    const target = path.join(stalled, "shots", "S-01", "takes", "A.png");
    result = await withUnopenable(target, code, () =>
      V.verifyAssets({ projectDir: stalled, paths: [take("A.png")] }));

    assert.strictEqual(result.replaced, 0, `${code}: an unreadable file is NOT a byte replacement`);
    assert.strictEqual(result.unavailable, 1);
    const stalledRow = rowFor(stalled, take("A.png"));
    assert.strictEqual(stalledRow.assetId, stalledId, `${code}: identity survives`);
    assert.strictEqual(stalledRow.contentHash, digest(PNG), `${code}: and so does the verified digest`);
    assert.strictEqual(stalledRow.hashState, "unavailable");
    assert.strictEqual(stalledRow.storage.missing, undefined, `${code}: transient is not deletion`);
    assert.strictEqual(S.readLedger(stalled).ledger.assets.length, 1, `${code}: no successor is minted`);

    /* And it recovers cleanly. */
    clearMediaHashMemo();
    result = await V.verifyAssets({ projectDir: stalled, paths: [take("A.png")] });
    assert.strictEqual(result.confirmed, 1, `${code}: the same bytes confirm when readable again`);
    assert.strictEqual(rowFor(stalled, take("A.png")).assetId, stalledId);
    assert.strictEqual(rowFor(stalled, take("A.png")).hashState, "hashed");
  }

  /* ---- 5b. offline, then back with DIFFERENT bytes ----
     The retained digest is what makes this detectable at all. An implementation
     that branched on hashState rather than on "was a digest ever verified" would
     treat the return as a first read and silently overwrite byte identity. */
  const returned = makeProject();
  await I.indexProject({ projectDir: returned, slug: "rt", project: project() });
  await V.verifyAssets({ projectDir: returned, paths: [take("A.png")] });
  const returnedId = rowFor(returned, take("A.png")).assetId;
  const returnedFile = path.join(returned, "shots", "S-01", "takes", "A.png");
  clearMediaHashMemo();
  await withUnopenable(returnedFile, "EIO", () => V.verifyAssets({ projectDir: returned, paths: [take("A.png")] }));
  assert.strictEqual(rowFor(returned, take("A.png")).hashState, "unavailable");

  fs.writeFileSync(returnedFile, PNG_B);
  clearMediaHashMemo();
  result = await V.verifyAssets({ projectDir: returned, paths: [take("A.png")], detectRenames: false });
  assert.strictEqual(result.replaced, 1,
    "a successful later hash that MISMATCHES triggers the replacement rule, not a silent overwrite");
  const survivor = S.readLedger(returned).ledger.assets.find((a) => a.assetId === returnedId);
  assert.strictEqual(survivor.contentHash, digest(PNG), "the previously verified digest is retained");
  assert.strictEqual(survivor.storage.missing, true);
  assert.notStrictEqual(
    S.readLedger(returned).ledger.assets.find((a) => !a.storage.missing).assetId, returnedId,
    "and the new bytes get their own identity",
  );

  /* ---- 6. a deleted file is missing, and keeps its identity and its hash ---- */
  const deleted = makeProject();
  await I.indexProject({ projectDir: deleted, slug: "d", project: project() });
  await V.verifyAssets({ projectDir: deleted, paths: [take("A.png")] });
  const deletedId = rowFor(deleted, take("A.png")).assetId;
  fs.unlinkSync(path.join(deleted, "shots", "S-01", "takes", "A.png"));
  result = await V.verifyAssets({ projectDir: deleted, paths: [take("A.png")] });
  assert.strictEqual(result.missing, 1);
  assert.deepStrictEqual(result.ambiguous, [], "a deleted file with no twin is not an ambiguity");
  assert.strictEqual(rowFor(deleted, take("A.png")).assetId, deletedId);
  assert.strictEqual(rowFor(deleted, take("A.png")).contentHash, digest(PNG));

  /* ---- 7. hashing is bounded by count AND by bytes ---- */
  const many = makeProject(Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [`F${i}.png`, Buffer.concat([PNG, Buffer.from(`pad-${i}`)])]),
  ));
  await I.indexProject({ projectDir: many, slug: "m", project: project() });
  const allPaths = Array.from({ length: 6 }, (_, i) => take(`F${i}.png`));
  result = await V.verifyAssets({ projectDir: many, paths: allPaths, limit: 2 });
  assert.strictEqual(result.verified, 2, "the count cap is honoured");
  assert.strictEqual(result.skipped, 4, "and the remainder is REPORTED, not silently dropped");
  assert(result.results.some((r) => r.outcome === "skipped-limit"));

  const budgeted = makeProject(Object.fromEntries(
    Array.from({ length: 4 }, (_, i) => [`F${i}.png`, Buffer.concat([PNG, Buffer.alloc(1024, i)])]),
  ));
  await I.indexProject({ projectDir: budgeted, slug: "b", project: project() });
  result = await V.verifyAssets({
    projectDir: budgeted, paths: Array.from({ length: 4 }, (_, i) => take(`F${i}.png`)), maxBytes: 1500,
  });
  assert.strictEqual(result.verified, 1, "the byte budget stops the pass");
  assert(result.results.some((r) => r.outcome === "skipped-budget"));
  assert(result.bytesRead > 0 && result.bytesRead <= 1500, "and the pass reports what it actually read");

  /* ---- 8. hash-based rename detection: identity survives the rename ---- */
  const renamed = makeProject({ "OLD.png": PNG });
  await I.indexProject({ projectDir: renamed, slug: "rn", project: project() });
  await V.verifyAssets({ projectDir: renamed, paths: [take("OLD.png")] });
  const keptId = rowFor(renamed, take("OLD.png")).assetId;

  fs.renameSync(
    path.join(renamed, "shots", "S-01", "takes", "OLD.png"),
    path.join(renamed, "shots", "S-01", "takes", "NEW.png"),
  );
  await I.indexProject({ projectDir: renamed, slug: "rn", project: project() });
  const placeholderId = rowFor(renamed, take("NEW.png")).assetId;
  assert.notStrictEqual(placeholderId, keptId, "discovery cannot know it is a rename, so it mints");
  assert.strictEqual(rowFor(renamed, take("OLD.png")).storage.missing, true);

  clearMediaHashMemo();
  result = await V.verifyAssets({ projectDir: renamed, paths: [take("NEW.png")] });
  assert.strictEqual(result.renames.length, 1, "the verified hash proves the association");
  const merged = S.readLedger(renamed).ledger;
  assert.strictEqual(merged.assets.length, 1, "one file is one row");
  assert.strictEqual(merged.assets[0].assetId, keptId,
    "the ESTABLISHED identity survives the rename — this is the bug the ledger exists to fix");
  assert.strictEqual(merged.assets[0].storage.path, take("NEW.png"), "and follows the file");
  assert.strictEqual(merged.assets[0].storage.missing, undefined);
  assert.strictEqual(merged.assets[0].renamedFrom, take("OLD.png"));
  assert(merged.assets[0].absorbedAssetIds.includes(placeholderId),
    "the placeholder id is recorded, not discarded, so an id observed earlier still resolves");
  assert.strictEqual(A.validateLedger(merged).ok, true);

  /* ---- 9. duplicate content makes association ambiguous — and it stays ambiguous ---- */
  const ambiguous = makeProject({ "ONE.png": PNG, "TWO.png": PNG, "GONE.png": PNG });
  await I.indexProject({ projectDir: ambiguous, slug: "am", project: project() });
  clearMediaHashMemo();
  await V.verifyAssets({
    projectDir: ambiguous, paths: [take("ONE.png"), take("TWO.png"), take("GONE.png")], detectRenames: false,
  });
  const ids = Object.fromEntries(S.readLedger(ambiguous).ledger.assets.map((a) => [a.storage.path, a.assetId]));
  assert.strictEqual(new Set(Object.values(ids)).size, 3, "identical bytes are still three production records");

  fs.unlinkSync(path.join(ambiguous, "shots", "S-01", "takes", "GONE.png"));
  await I.indexProject({ projectDir: ambiguous, slug: "am", project: project() });
  clearMediaHashMemo();
  result = await V.verifyAssets({ projectDir: ambiguous, paths: [take("ONE.png"), take("TWO.png")] });

  assert.strictEqual(result.renames.length, 0, "with two candidates, NOTHING may be associated");
  assert.strictEqual(result.ambiguous.length, 1, "the ambiguity is reported for a human");
  assert.strictEqual(result.ambiguous[0].missing, 1);
  assert.strictEqual(result.ambiguous[0].present, 2);
  const settled = S.readLedger(ambiguous).ledger;
  assert.strictEqual(settled.assets.length, 3, "no row is merged away on a guess");
  for (const [p, id] of Object.entries(ids))
    assert.strictEqual(settled.assets.find((a) => a.storage.path === p).assetId, id,
      `${p} keeps its identity through an ambiguous association`);
  assert.strictEqual(settled.assets.find((a) => a.storage.path === take("ONE.png")).renameAmbiguous, true);
  assert.strictEqual(settled.assets.find((a) => a.storage.path === take("GONE.png")).storage.missing, true,
    "and the absent file stays absent rather than being resurrected onto someone else's bytes");

  /* ---- 9b. replacement and rename are competing explanations, not both ----
     A.png is copied to B.png, then A.png is overwritten. Two rules could fire: the
     bytes at A.png were replaced, and the old bytes "moved" to B.png. Committing to
     the first must exclude the second, or the record retired a moment ago is
     transplanted onto whichever other file holds a copy of its old content. */
  const contest = makeProject({ "A.png": PNG });
  await I.indexProject({ projectDir: contest, slug: "ct", project: project() });
  clearMediaHashMemo();
  await V.verifyAssets({ projectDir: contest, paths: [take("A.png")] });
  const contestId = rowFor(contest, take("A.png")).assetId;

  fs.writeFileSync(path.join(contest, "shots", "S-01", "takes", "B.png"), PNG);      /* a copy */
  fs.writeFileSync(path.join(contest, "shots", "S-01", "takes", "A.png"), PNG_B);    /* overwritten */
  await I.indexProject({ projectDir: contest, slug: "ct", project: project() });
  clearMediaHashMemo();
  result = await V.verifyAssets({ projectDir: contest, paths: [take("A.png"), take("B.png")] });

  assert.strictEqual(result.replaced, 1, "the overwrite is a replacement");
  assert.strictEqual(result.renames.length, 0,
    "and the retired record must NOT also be re-homed onto the copy");
  const contested = S.readLedger(contest).ledger;
  const retired = contested.assets.find((a) => a.assetId === contestId);
  assert.strictEqual(retired.storage.path, take("A.png"),
    "the retired record stays where it was retired, with its history intact");
  assert.strictEqual(retired.storage.missing, true);
  assert.strictEqual(retired.contentHash, digest(PNG));
  assert.notStrictEqual(contested.assets.find((a) => a.storage.path === take("B.png")).assetId, contestId,
    "the copy keeps its own identity");
  assert.strictEqual(A.validateLedger(contested).ok, true);

  /* ---- 9c. a later INDEX pass must not resurrect the retired record ----
     Two rows now share one path. Discovery has to reuse the live one; picking the
     retired one would un-mark it missing and graft a record describing the old
     bytes back onto the file that replaced them. */
  const liveId = contested.assets.find((a) => a.storage.path === take("A.png") && !a.storage.missing).assetId;
  const reindexed = await I.indexProject({ projectDir: contest, slug: "ct", project: project() });
  assert.strictEqual(reindexed.minted, 0, "nothing new appeared");
  const settledContest = S.readLedger(contest).ledger;
  assert.strictEqual(settledContest.assets.find((a) => a.assetId === contestId).storage.missing, true,
    "the retired record stays retired across a re-index");
  assert.strictEqual(
    settledContest.assets.filter((a) => a.storage.path === take("A.png") && !a.storage.missing).length, 1,
    "and exactly one live row occupies the path",
  );
  assert.strictEqual(
    settledContest.assets.find((a) => a.storage.path === take("A.png") && !a.storage.missing).assetId, liveId,
    "which is the successor, not the record it replaced",
  );

  /* ---- 10. unknown targets are reported, never invented ---- */
  result = await V.verifyAssets({
    projectDir: first, paths: [take("A.png"), take("NOT-INDEXED.png")], assetIds: ["asset-" + "0".repeat(32)],
  });
  assert.deepStrictEqual(result.unknown.sort(), [take("NOT-INDEXED.png"), "asset-" + "0".repeat(32)].sort());
  assert.strictEqual(S.readLedger(first).ledger.assets.length, 1, "an unknown target does not create a row");

  /* ---- 11. a double-corrupt ledger refuses here too ---- */
  const doomed = makeProject({ "A.png": PNG, "B.png": PNG_B });
  await I.indexProject({ projectDir: doomed, slug: "dm", project: project() });
  fs.writeFileSync(path.join(doomed, "shots", "S-01", "takes", "C.png"), PNG);
  await I.indexProject({ projectDir: doomed, slug: "dm", project: project() });
  fs.writeFileSync(S.ledgerPath(doomed), "{ broken");
  fs.writeFileSync(S.backupPath(doomed), "also broken");
  await assert.rejects(
    () => V.verifyAssets({ projectDir: doomed, paths: [take("A.png")] }),
    (error) => error.code === "LEDGER_UNREADABLE",
    "verifying against an empty ledger would treat every asset as new",
  );

  console.log(
    "MediaAsset verify suite passed: reading is explicit and capped by count and bytes with skips reported; a first "
    + "read is a verification not a mismatch; only a successful differing hash retires a path, retaining the old "
    + "record, its digest and its lifecycle while minting a successor; EBUSY/EIO/EPERM and deletion never reach that "
    + "branch; a renamed file keeps its established assetId; and duplicate content is left ambiguous rather than guessed.",
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

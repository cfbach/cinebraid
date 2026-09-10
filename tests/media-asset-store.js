/* CineBraid MediaAsset ledger — durable persistence.
 *
 * The failure this suite exists to prevent is a silent empty ledger.
 * fal-generation.js:48 reads its job file with `catch { return []; }`, which turns
 * an unreadable file into "no jobs" and silently frees every concurrency slot. The
 * same shape here would mean "this project has no media" — and a later index would
 * re-mint an assetId for every file, discarding every relationship built on the old
 * ones. So a ledger whose primary AND backup are unreadable must REFUSE, loudly,
 * and leave both files alone.
 *
 * Everything runs against disposable temp directories. No project is touched.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const A = require("../src/media/media-assets");
const S = require("../src/media/media-asset-store");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-asset-store-"));
let created = 0;
function project() {
  const dir = path.join(TEMP, `p${created += 1}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function asset(overrides = {}) {
  return {
    assetId: A.mintAssetId(),
    contentHash: null,
    hashState: "unhashed",
    scope: { shotId: "SC-01-01" },
    mediaType: "image",
    role: "frame-candidate",
    source: "unknown",
    lifecycle: "candidate",
    storage: { path: "shots/SC-01-01/takes/a.png", bytes: 10, mtimeMs: 1 },
    legacy: { candidateArray: "shot.candidateFiles", candidateKey: "a.png", libraryAssetId: null },
    indexedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}
function ledgerOf(...assets) {
  return { schemaVersion: A.MEDIA_ASSETS_SCHEMA_VERSION, assets };
}

async function main() {
  /* ---- 1. a missing sidecar is NORMAL ----
     Every project is in this state until Phase 2b indexes it. */
  const fresh = project();
  const missing = S.readLedger(fresh);
  assert.strictEqual(missing.exists, false, "a missing ledger is not an error");
  assert.deepStrictEqual(missing.ledger.assets, [], "it reads as empty");
  assert.strictEqual(missing.recovered, false);
  assert.strictEqual(missing.warning, "");
  assert.strictEqual(fs.existsSync(S.ledgerPath(fresh)), false, "reading must not CREATE the file");

  /* ---- 2. write, read back, and the file is where it should be ---- */
  const one = asset();
  S.writeLedgerSync(fresh, ledgerOf(one));
  assert.strictEqual(path.basename(S.ledgerPath(fresh)), "media-assets.json");
  const readBack = S.readLedger(fresh);
  assert.strictEqual(readBack.exists, true);
  assert.strictEqual(readBack.readOnly, false);
  assert.strictEqual(readBack.ledger.assets.length, 1);
  assert.strictEqual(readBack.ledger.assets[0].assetId, one.assetId);
  assert.strictEqual(readBack.ledger.schemaVersion, A.MEDIA_ASSETS_SCHEMA_VERSION);

  /* ---- 3. idempotence — byte-identical on a repeated write ---- */
  const firstBytes = fs.readFileSync(S.ledgerPath(fresh), "utf8");
  S.writeLedgerSync(fresh, ledgerOf(one));
  assert.strictEqual(fs.readFileSync(S.ledgerPath(fresh), "utf8"), firstBytes,
    "writing the same ledger twice must produce an identical file");
  S.writeLedgerSync(fresh, S.readLedger(fresh).ledger);
  assert.strictEqual(fs.readFileSync(S.ledgerPath(fresh), "utf8"), firstBytes,
    "a read/write round trip must be stable");

  /* ---- 4. the backup is taken BEFORE the primary is replaced ---- */
  const two = asset();
  S.writeLedgerSync(fresh, ledgerOf(one, two));
  assert.strictEqual(fs.existsSync(S.backupPath(fresh)), true, "a .bak must exist after the second write");
  assert.strictEqual(fs.readFileSync(S.backupPath(fresh), "utf8"), firstBytes,
    "the backup holds the PREVIOUS ledger, so a crash mid-write leaves a readable one");

  /* ---- 5. primary corrupt, backup valid -> recovered, never silently empty ---- */
  const recoverable = project();
  S.writeLedgerSync(recoverable, ledgerOf(asset()));
  S.writeLedgerSync(recoverable, ledgerOf(asset(), asset()));   /* creates the .bak */
  fs.writeFileSync(S.ledgerPath(recoverable), "{ this is not json");
  const recovered = S.readLedger(recoverable);
  assert.strictEqual(recovered.recovered, true, "a corrupt primary must fall back to the backup");
  assert.strictEqual(recovered.ledger.assets.length, 1, "and serve what the backup held");
  assert(recovered.warning.includes("backup"), "recovery must say so rather than passing silently");

  /* ---- 6. BOTH corrupt -> explicit refusal, and nothing is destroyed ---- */
  const doomed = project();
  S.writeLedgerSync(doomed, ledgerOf(asset()));
  S.writeLedgerSync(doomed, ledgerOf(asset(), asset()));
  fs.writeFileSync(S.ledgerPath(doomed), "{ broken");
  fs.writeFileSync(S.backupPath(doomed), "also broken");
  let refused = null;
  try {
    S.readLedger(doomed);
    assert.fail("a ledger with no readable copy must NOT read as empty");
  } catch (error) {
    refused = error;
  }
  assert.strictEqual(refused.code, "LEDGER_UNREADABLE", "the refusal is typed");
  assert(refused instanceof S.LedgerUnreadableError);
  assert(/re-index|re-indexing|identity/i.test(refused.message),
    "the message must explain WHY an empty ledger is refused");
  assert.strictEqual(fs.readFileSync(S.ledgerPath(doomed), "utf8"), "{ broken",
    "the unreadable files are left untouched for recovery");
  assert.strictEqual(fs.readFileSync(S.backupPath(doomed), "utf8"), "also broken");

  /* The explicit anti-pattern assertion: no code path returns an empty ledger for a
     project that has one. */
  assert.notStrictEqual(refused, null, "there must be no silent empty-ledger fallback");

  /* ---- 7. a ledger document that is not a ledger ---- */
  const wrongShape = project();
  fs.writeFileSync(S.ledgerPath(wrongShape), JSON.stringify({ schemaVersion: 1, runs: [] }));
  assert.throws(
    () => S.readLedger(wrongShape),
    (error) => error.code === "LEDGER_UNREADABLE",
    "a JSON file that parses but is not a ledger must not read as an empty one",
  );

  /* ---- 8. an unknown schemaVersion degrades to read-only ---- */
  const future = project();
  fs.writeFileSync(S.ledgerPath(future), JSON.stringify({ schemaVersion: 99, assets: [] }, null, 2));
  const ahead = S.readLedger(future);
  assert.strictEqual(ahead.readOnly, true, "a newer ledger is readable but not writable");
  assert.strictEqual(ahead.schemaVersion, 99);
  assert(ahead.warning.includes("99"), "and says which version it found");

  /* ---- 9. validation happens BEFORE anything is persisted ---- */
  const guarded = project();
  for (const [label, bad] of [
    ["a hashed asset with no digest", asset({ hashState: "hashed", contentHash: null })],
    ["a malformed assetId", asset({ assetId: "asset-8f21c4a9b3d0" })],
    ["an absolute storage path", asset({ storage: { path: "C:\\projects\\p\\a.png" } })],
    ["an unknown lifecycle", asset({ lifecycle: "pending" })],
  ]) {
    assert.throws(
      () => S.writeLedgerSync(guarded, ledgerOf(bad)),
      (error) => error.code === "LEDGER_INVALID",
      `${label} must be refused before persistence`,
    );
    assert.strictEqual(fs.existsSync(S.ledgerPath(guarded)), false,
      `${label} must leave no partially accepted file`);
  }
  /* A duplicate id inside one ledger is refused too. */
  const twin = asset();
  assert.throws(() => S.writeLedgerSync(guarded, ledgerOf(twin, { ...twin })),
    (error) => error.code === "LEDGER_INVALID", "a duplicate assetId must not persist");

  /* ---- 10. no temp files survive a successful or a failed write ---- */
  const leftovers = fs.readdirSync(guarded).filter((name) => name.includes(".tmp"));
  assert.deepStrictEqual(leftovers, [], "a refused write must not leave a temp file");

  /* ---- 11. serialized concurrent writes: last write wins, none interleave ---- */
  const raced = project();
  const ledgers = Array.from({ length: 12 }, (_, i) => ledgerOf(...Array.from({ length: i + 1 }, () => asset())));
  await Promise.all(ledgers.map((l) => S.writeLedger(raced, l)));
  const settled = S.readLedger(raced);
  assert.strictEqual(settled.exists, true);
  const sizes = ledgers.map((l) => l.assets.length);
  assert(sizes.includes(settled.ledger.assets.length),
    "the surviving ledger must be exactly one of the writes, never a blend");
  assert.strictEqual(A.validateLedger(settled.ledger).ok, true, "and must still be valid JSON and schema");
  assert.deepStrictEqual(
    fs.readdirSync(raced).filter((name) => name.includes(".tmp")), [],
    "concurrent writes must not leave temp files behind",
  );

  console.log(
    "MediaAsset store suite passed: a missing sidecar is normal and reading never creates it, writes are atomic "
    + "and byte-idempotent with the backup taken first, a corrupt primary recovers from .bak, BOTH corrupt refuses "
    + "explicitly rather than reading as empty, invalid records never reach disk, and concurrent writes serialize "
    + "without interleaving.",
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

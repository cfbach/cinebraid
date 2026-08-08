/* CineBraid Phase 2b — behaviour on a cloud-synced project root.
 *
 * A project may live inside OneDrive, Dropbox or Google Drive. CineBraid acquires
 * no provider API and does not try to detect one — it just has to degrade correctly
 * under the filesystem behaviour those clients produce: files that stat fine but
 * cannot be opened, metadata rewritten without the bytes changing, sharing
 * violations, and whole roots that go offline for a moment.
 *
 * The single rule every case here enforces:
 *
 *   A transient inability to read is never deletion, never ledger corruption,
 *   never a hash mismatch, and never permission to re-mint identity.
 *
 * Getting that wrong turns a network hiccup into permanent identity loss, which is
 * exactly the failure the nullable-hash design exists to prevent.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const A = require("../media-assets");
const S = require("../media-asset-store");
const I = require("../media-asset-indexer");
const V = require("../media-asset-verify");
const { clearMediaHashMemo, hashMediaFile } = require("../media-hash");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-sync-safety-"));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let made = 0;
function makeProject(files = ["A.png"]) {
  const dir = path.join(TEMP, `p${made += 1}`);
  fs.mkdirSync(path.join(dir, "shots", "S-01", "takes"), { recursive: true });
  for (const name of files) fs.writeFileSync(path.join(dir, "shots", "S-01", "takes", name), PNG);
  return dir;
}
const project = () => ({ shots: [{ id: "S-01", keyframes: [], clips: [], candidateFiles: [] }], mediaAssets: [] });
const rowFor = (dir, p) => S.readLedger(dir).ledger.assets.find((a) => a.storage.path === p);

/* Makes one specific path fail with a chosen errno, leaving everything else alone —
   the shape a sync client actually produces. */
function withStatFailure(target, code, fn) {
  const realStat = fs.statSync;
  fs.statSync = function patched(p, ...rest) {
    if (String(p) === target) {
      const error = new Error(`${code}: simulated`);
      error.code = code;
      throw error;
    }
    return realStat.call(this, p, ...rest);
  };
  try { return fn(); } finally { fs.statSync = realStat; }
}

async function main() {
  /* ---- 1. errno classification is the foundation ---- */
  assert.strictEqual(I.classifyError({ code: "ENOENT" }), "absent", "ENOENT is the only confirmed absence");
  for (const code of ["EIO", "EBUSY", "EPERM", "EACCES", "ETIMEDOUT", "EAGAIN", "ESTALE", "UNKNOWN"])
    assert.strictEqual(I.classifyError({ code }), "transient", `${code} must be transient, never deletion`);
  assert.strictEqual(I.classifyError({}), "transient",
    "an unrecognised failure defaults to transient — guessing 'deleted' is the expensive way to be wrong");

  /* ---- 2/3/4. transient stat failures: EIO, EBUSY, EPERM ---- */
  for (const code of ["EIO", "EBUSY", "EPERM"]) {
    const dir = makeProject(["A.png", "B.png"]);
    await I.indexProject({ projectDir: dir, slug: "t", project: project() });
    const original = rowFor(dir, "shots/S-01/takes/A.png");
    const target = path.join(dir, "shots", "S-01", "takes", "A.png");

    await withStatFailure(target, code, async () => {
      await I.indexProject({ projectDir: dir, slug: "t", project: project() });
    });

    const after = rowFor(dir, "shots/S-01/takes/A.png");
    assert(after, `${code}: the row must be RETAINED, never deleted`);
    assert.strictEqual(after.assetId, original.assetId, `${code}: identity must NOT be re-minted`);
    assert.strictEqual(after.hashState, "unavailable", `${code}: recorded as unavailable`);
    assert.strictEqual(after.storage.missing, undefined, `${code}: transient is NOT missing`);
    assert.strictEqual(S.readLedger(dir).ledger.assets.length, 2, `${code}: no duplicate row is created`);
  }

  /* ---- 5. a specific ENOENT with a readable parent IS confirmed absence ---- */
  const removed = makeProject(["KEEP.png", "GONE.png"]);
  await I.indexProject({ projectDir: removed, slug: "r", project: project() });
  const goneBefore = rowFor(removed, "shots/S-01/takes/GONE.png");
  fs.unlinkSync(path.join(removed, "shots", "S-01", "takes", "GONE.png"));
  await I.indexProject({ projectDir: removed, slug: "r", project: project() });
  const goneAfter = rowFor(removed, "shots/S-01/takes/GONE.png");
  assert.strictEqual(goneAfter.storage.missing, true, "a real deletion with a readable parent is marked missing");
  assert.strictEqual(goneAfter.assetId, goneBefore.assetId, "but the identity is still retained");

  /* ---- 6. an unreadable directory says nothing about its contents ----
     The parent could not be listed, so no file inside it may be called missing. */
  const blinded = makeProject(["A.png", "B.png"]);
  await I.indexProject({ projectDir: blinded, slug: "b", project: project() });
  const beforeBlind = S.readLedger(blinded).ledger.assets.map((a) => a.assetId).sort();
  const takesDir = path.join(blinded, "shots", "S-01", "takes");
  const realReaddir = fs.readdirSync;
  fs.readdirSync = function patched(p, ...rest) {
    if (String(p) === takesDir) {
      const error = new Error("EBUSY: simulated");
      error.code = "EBUSY";
      throw error;
    }
    return realReaddir.call(this, p, ...rest);
  };
  let blindResult;
  try {
    blindResult = await I.indexProject({ projectDir: blinded, slug: "b", project: project() });
  } finally {
    fs.readdirSync = realReaddir;
  }
  for (const asset of S.readLedger(blinded).ledger.assets)
    assert.strictEqual(asset.storage.missing, undefined,
      "an unreadable directory must NOT mark its contents missing");
  assert.deepStrictEqual(S.readLedger(blinded).ledger.assets.map((a) => a.assetId).sort(), beforeBlind,
    "and must not disturb any identity");
  assert(blindResult.problems.some((p) => p.kind === "transient"), "the problem is recorded rather than swallowed");

  /* ---- 6b. an unreadable ROOT aborts the whole pass ---- */
  await assert.rejects(
    () => I.indexProject({ projectDir: path.join(TEMP, "gone-entirely"), slug: "x", project: project() }),
    (error) => error.code === "INDEX_ROOT_UNREADABLE",
    "a root failure must abort, never mass-mark every asset missing",
  );

  /* ---- 7/8. metadata churn without a byte read never re-mints ---- */
  const churn = makeProject(["A.png"]);
  await I.indexProject({ projectDir: churn, slug: "c", project: project() });
  const churnId = rowFor(churn, "shots/S-01/takes/A.png").assetId;
  const churnTarget = path.join(churn, "shots", "S-01", "takes", "A.png");
  /* A sync client rewriting mtime/ctime. */
  const future = Date.now() / 1000 + 7200;
  fs.utimesSync(churnTarget, future, future);
  await I.indexProject({ projectDir: churn, slug: "c", project: project() });
  assert.strictEqual(rowFor(churn, "shots/S-01/takes/A.png").assetId, churnId, "mtime churn must not re-mint");
  assert.strictEqual(rowFor(churn, "shots/S-01/takes/A.png").needsVerify, true,
    "it flags the row for verification instead");
  /* A size change is equally only a hint — it is NOT proof the bytes are different
     bytes belonging to a different asset. Only a hash can say that. */
  fs.writeFileSync(churnTarget, Buffer.concat([PNG, Buffer.from("more")]));
  await I.indexProject({ projectDir: churn, slug: "c", project: project() });
  assert.strictEqual(rowFor(churn, "shots/S-01/takes/A.png").assetId, churnId, "size churn must not re-mint either");
  assert.strictEqual(S.readLedger(churn).ledger.assets.length, 1, "and must not create a second row");

  /* ---- 9. a previously hashed asset going unavailable RETAINS its hash ----
     This is the invariant that stops a network hiccup erasing byte identity. */
  const hashed = makeProject(["A.png"]);
  await I.indexProject({ projectDir: hashed, slug: "h", project: project() });
  const led = S.readLedger(hashed).ledger;
  const digest = `sha256:${hashMediaFile(path.join(hashed, "shots", "S-01", "takes", "A.png"))}`;
  led.assets[0].hashState = "hashed";
  led.assets[0].contentHash = digest;
  S.writeLedgerSync(hashed, led);
  const hashedId = led.assets[0].assetId;

  await withStatFailure(path.join(hashed, "shots", "S-01", "takes", "A.png"), "EIO", async () => {
    await I.indexProject({ projectDir: hashed, slug: "h", project: project() });
  });
  const unavailable = rowFor(hashed, "shots/S-01/takes/A.png");
  assert.strictEqual(unavailable.hashState, "unavailable");
  assert.strictEqual(unavailable.contentHash, digest, "a VERIFIED hash survives temporary unavailability");
  assert.strictEqual(unavailable.assetId, hashedId, "and so does the identity");

  /* ---- 10. and it comes back as the same asset ---- */
  await I.indexProject({ projectDir: hashed, slug: "h", project: project() });
  const returned = rowFor(hashed, "shots/S-01/takes/A.png");
  assert.strictEqual(returned.assetId, hashedId, "a returning asset reuses its assetId");
  assert.strictEqual(returned.contentHash, digest, "and its previously known hash is still there to compare against");
  assert.strictEqual(returned.hashState, "unavailable",
    "a stat-only pass cannot promote it back to hashed — only a byte read can");

  /* ---- 11. an asset that goes offline and returns with DIFFERENT bytes ----
     The end of the chain. A stat failure produced `unavailable` and retained the
     digest; that retained digest is the only thing that can later prove the bytes
     were replaced. When a successful read finally disagrees with it, the rule that
     fires is same-path/different-bytes — never a silent overwrite of identity. */
  const replaced = makeProject(["A.png"]);
  await I.indexProject({
    projectDir: replaced, slug: "rp",
    project: { shots: [{ id: "S-01", winner: "A.png", keyframes: [], clips: [], candidateFiles: [] }], mediaAssets: [] },
  });
  const target = path.join(replaced, "shots", "S-01", "takes", "A.png");
  await V.verifyAssets({ projectDir: replaced, paths: ["shots/S-01/takes/A.png"] });
  const oldId = rowFor(replaced, "shots/S-01/takes/A.png").assetId;
  const oldDigest = `sha256:${hashMediaFile(target)}`;
  assert.strictEqual(rowFor(replaced, "shots/S-01/takes/A.png").lifecycle, "approved",
    "the fixture starts as an approved winner");

  /* It goes offline. */
  clearMediaHashMemo();
  await withStatFailure(target, "EIO", () => V.verifyAssets({ projectDir: replaced, paths: ["shots/S-01/takes/A.png"] }));
  assert.strictEqual(rowFor(replaced, "shots/S-01/takes/A.png").hashState, "unavailable");
  assert.strictEqual(rowFor(replaced, "shots/S-01/takes/A.png").contentHash, oldDigest,
    "the digest is retained precisely so the comparison below is possible");

  /* It returns, holding different bytes. */
  fs.writeFileSync(target, PNG_B);
  clearMediaHashMemo();
  const outcome = await V.verifyAssets({
    projectDir: replaced, paths: ["shots/S-01/takes/A.png"], detectRenames: false,
  });
  assert.strictEqual(outcome.replaced, 1, "a successful MISMATCH is what triggers the rule");

  const after = S.readLedger(replaced).ledger;
  const oldRecord = after.assets.find((a) => a.assetId === oldId);
  assert(oldRecord, "the old asset record is retained, not mutated away");
  assert.strictEqual(oldRecord.contentHash, oldDigest, "with its previously verified hash intact");
  assert.strictEqual(oldRecord.storage.missing, true, "marked as no longer present at that path");
  assert.strictEqual(oldRecord.lifecycle, "approved",
    "byte replacement is NOT read as approval, rejection or supersede");
  const occupant = after.assets.find((a) => a.storage.path === "shots/S-01/takes/A.png" && !a.storage.missing);
  assert.notStrictEqual(occupant.assetId, oldId, "the new bytes get a NEW identity");
  assert.strictEqual(occupant.contentHash, `sha256:${hashMediaFile(target)}`, "carrying the newly verified hash");
  assert.strictEqual(A.validateLedger(after).ok, true, "the resulting ledger is valid");

  /* And the branch stayed unreachable from every read failure above: each one
     produced `unavailable` with its identity and digest intact. */
  assert.strictEqual(unavailable.hashState, "unavailable",
    "a read/open failure never enters the byte-replacement branch");

  /* ---- 12. duplicate content across two assets — ambiguity stays ambiguity ----
     Two ledger rows may legitimately share a contentHash (the same image approved
     for two shots). Hash equality alone therefore cannot say WHICH production
     record moved, and guessing would corrupt identity. */
  const dupes = makeProject([]);
  fs.mkdirSync(path.join(dupes, "shots", "S-02", "takes"), { recursive: true });
  fs.writeFileSync(path.join(dupes, "shots", "S-01", "takes", "SAME.png"), PNG);
  fs.writeFileSync(path.join(dupes, "shots", "S-02", "takes", "SAME.png"), PNG);
  await I.indexProject({
    projectDir: dupes, slug: "d",
    project: { shots: [{ id: "S-01", keyframes: [], clips: [], candidateFiles: [] },
                       { id: "S-02", keyframes: [], clips: [], candidateFiles: [] }], mediaAssets: [] },
  });
  const dupePaths = ["shots/S-01/takes/SAME.png", "shots/S-02/takes/SAME.png"];
  assert.strictEqual(S.readLedger(dupes).ledger.assets.length, 2,
    "identical bytes in two shots are TWO production records");
  clearMediaHashMemo();
  await V.verifyAssets({ projectDir: dupes, paths: dupePaths });
  const dupLedger = S.readLedger(dupes).ledger;
  const [d1, d2] = dupePaths.map((p) => dupLedger.assets.find((a) => a.storage.path === p));
  assert.notStrictEqual(d1.assetId, d2.assetId, "with different identities");
  assert.strictEqual(d1.contentHash, d2.contentHash, "two assets legitimately share one contentHash");
  assert.strictEqual(A.validateLedger(dupLedger).ok, true,
    "and the ledger accepts that — a shared hash is not a duplicate");

  /* Now one of them disappears and a third path with the same bytes appears. Hash
     equality cannot say whether that is a rename of the vanished record or an
     unrelated copy, so nothing may be associated. */
  fs.unlinkSync(path.join(dupes, "shots", "S-02", "takes", "SAME.png"));
  fs.writeFileSync(path.join(dupes, "shots", "S-01", "takes", "THIRD.png"), PNG);
  await I.indexProject({
    projectDir: dupes, slug: "d",
    project: { shots: [{ id: "S-01", keyframes: [], clips: [], candidateFiles: [] },
                       { id: "S-02", keyframes: [], clips: [], candidateFiles: [] }], mediaAssets: [] },
  });
  clearMediaHashMemo();
  const ambiguousResult = await V.verifyAssets({
    projectDir: dupes, paths: ["shots/S-01/takes/SAME.png", "shots/S-01/takes/THIRD.png"],
  });
  assert.strictEqual(ambiguousResult.renames.length, 0,
    "with two possible destinations, NOTHING may be associated");
  assert.strictEqual(ambiguousResult.ambiguous.length, 1, "the ambiguity is reported for a human to resolve");
  const third = S.readLedger(dupes).ledger;
  assert.strictEqual(third.assets.length, 3, "an ambiguous same-content file keeps its own row, not a guess");
  assert.strictEqual(third.assets.filter((a) => a.assetId === d1.assetId).length, 1, "d1 keeps its identity");
  assert.strictEqual(third.assets.filter((a) => a.assetId === d2.assetId).length, 1, "d2 keeps its identity");
  assert.strictEqual(third.assets.find((a) => a.assetId === d2.assetId).storage.path, dupePaths[1],
    "and the vanished record is not transplanted onto the new file's path");

  console.log(
    "Cloud-sync safety suite passed: EIO/EBUSY/EPERM are transient and never delete, corrupt, mismatch or re-mint; "
    + "an unreadable directory marks nothing missing and an unreadable root aborts; mtime and size churn never "
    + "re-mint; a verified hash survives unavailability and the same asset returns; byte replacement retains the old "
    + "record and mints a successor without touching lifecycle; and duplicate-content ambiguity stays ambiguous.",
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

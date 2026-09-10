/* CineBraid MediaAsset verification — the only code that reads media bytes.
 *
 * Kept deliberately apart from media-asset-indexer.js. The indexer imports no
 * hasher and no read primitive, so it is structurally incapable of hydrating a
 * cloud placeholder; a suite asserts that. Everything that must open a file lives
 * here instead, behind an explicit, bounded, caller-named request.
 *
 * THE LIMITS ARE THE FEATURE:
 *
 *   - There is no "verify the whole project" mode. The caller names the assets.
 *   - A pass is capped by count AND by total bytes, and reports what it skipped.
 *   - Nothing here is invoked by opening a project, scanning, or indexing.
 *
 * A project may sit in OneDrive/Dropbox/Drive, where reading a file downloads it.
 * Hashing is therefore a deliberate act with a visible cost, never a side effect.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE — same path, different bytes:
 *
 *   A successful hash that DIFFERS from a previously verified digest is the only
 *   evidence that the bytes at a path were replaced. When that happens the old
 *   record is RETAINED with its verified hash and marked as no longer present at
 *   that path, and the new bytes get a NEW assetId. The old record's lifecycle is
 *   not touched: byte replacement is not approval, rejection or supersede.
 *
 *   Every other signal — a changed size, a rewritten mtime, a failed open, an
 *   offline placeholder — is a hint or a transient failure, and none of them may
 *   re-mint, retire or replace an identity.
 */

const fs = require("fs");
const path = require("path");

const { markUnavailable, mintAssetId } = require("./media-assets");
const { readLedger, writeLedgerSync } = require("./media-asset-store");
const { classifyError } = require("./media-asset-indexer");
const { hashMediaFile } = require("./media-hash");

/* Deliberately small. Verification is for "I am about to rely on these bytes",
   not for warming a corpus. A caller that wants more must ask for more, in the
   open, and wear the download. */
const DEFAULT_VERIFY_LIMIT = 25;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function digestOf(absolutePath) {
  return `sha256:${hashMediaFile(absolutePath, { subject: "CineBraid media verification" })}`;
}

/* ---------------------------------------------------------------------------
   Hash-based rename detection.

   Pure: no filesystem access, no writes. It reasons only about digests that were
   actually verified, which is why it lives behind hashing rather than beside
   discovery.

   The signal for a rename is narrow on purpose: exactly one row missing from its
   old path and exactly one row present at a new one, sharing a verified digest,
   with no third row carrying that digest. Anything wider is a guess, and a wrong
   guess silently transplants one asset's history onto another's bytes.

   Two rows sharing a contentHash is legal — the same still approved for two shots —
   so duplicate content is the expected ambiguous case, not an error. Ambiguity is
   recorded and left for a human; it is never resolved by picking. */
function reconcileRenames(ledger, options = {}) {
  const now = options.now || (() => new Date().toISOString());
  /* A record retired by the byte-replacement rule during THIS pass is excluded.
     Replacement and rename are two competing explanations for the same evidence —
     "the bytes at this path changed" and "this asset moved" — and a pass that has
     just committed to the first must not also apply the second, or a record retired
     a moment ago gets transplanted onto whichever other file happens to hold a copy
     of its old bytes. */
  const exclude = options.exclude instanceof Set ? options.exclude : new Set();
  const byDigest = new Map();
  for (const asset of ledger.assets) {
    if (!asset || asset.hashState !== "hashed" || !asset.contentHash) continue;
    if (exclude.has(asset.assetId)) continue;
    if (!byDigest.has(asset.contentHash)) byDigest.set(asset.contentHash, []);
    byDigest.get(asset.contentHash).push(asset);
  }

  const renames = [];
  const ambiguous = [];
  for (const [digest, rows] of byDigest) {
    const gone = rows.filter((row) => row.storage && row.storage.missing === true);
    const here = rows.filter((row) => !(row.storage && row.storage.missing === true));
    /* Nothing present with these bytes: the asset is simply absent, which is not a
       rename and not an ambiguity. Saying otherwise would report a conflict on
       every genuinely deleted file. */
    if (!gone.length || !here.length) continue;

    if (gone.length !== 1 || here.length !== 1) {
      /* Cannot say WHICH record moved. Say so, and change nothing. */
      for (const row of here) row.renameAmbiguous = true;
      ambiguous.push({ contentHash: digest, missing: gone.length, present: here.length });
      continue;
    }

    const [origin] = gone;
    const [arrival] = here;
    if (origin.assetId === arrival.assetId) continue;

    /* Identity survives; observation follows the file.

       The established row keeps assetId, contentHash and everything downstream
       relationships are built on. It adopts where the file now is and what the
       project record now says about that filename — which is the whole point:
       today an approval rename breaks every filename-keyed edge, and this is what
       makes the edge survive it. */
    const from = origin.storage.path;
    origin.storage = { ...arrival.storage };
    delete origin.storage.missing;
    origin.legacy = arrival.legacy;
    origin.scope = arrival.scope;
    origin.role = arrival.role;
    origin.lifecycle = arrival.lifecycle;
    origin.renamedFrom = from;
    /* The placeholder identity minted by discovery is recorded, not discarded, so
       an assetId that was observed before the association still resolves. */
    origin.absorbedAssetIds = [...(origin.absorbedAssetIds || []), arrival.assetId];
    if (origin.needsVerify) delete origin.needsVerify;
    origin.indexedAt = now();
    renames.push({ assetId: origin.assetId, from, to: origin.storage.path, absorbed: arrival.assetId });
  }

  if (renames.length) {
    const absorbed = new Set(renames.map((rename) => rename.absorbed));
    ledger.assets = ledger.assets.filter((asset) => !absorbed.has(asset.assetId));
  }
  return { renames, ambiguous };
}

/* ---------------------------------------------------------------------------
   The same-path/different-bytes rule, applied to one row. */
function recordReplacement(ledger, existing, digest, stat, now) {
  /* 1-2. The old record is retained, keeps its verified hash, and is marked as no
     longer present at that path. Its lifecycle is NOT touched. */
  const previous = existing.storage.path;
  existing.storage = { ...existing.storage, missing: true };
  existing.indexedAt = now();
  if (existing.needsVerify) delete existing.needsVerify;

  /* 3-5. The newly observed bytes get a NEW identity, and become the occupant of
     the path. Role, scope and legacy carry over because they describe the location
     and the project record, both unchanged; lifecycle restarts at candidate
     because nothing has approved these bytes. */
  const successor = {
    assetId: mintAssetId(),
    contentHash: digest,
    hashState: "hashed",
    scope: { ...existing.scope },
    mediaType: existing.mediaType,
    role: existing.role,
    source: "unknown",
    lifecycle: "candidate",
    storage: { path: previous, bytes: stat.size, mtimeMs: stat.mtimeMs },
    legacy: { ...existing.legacy },
    replacedAssetId: existing.assetId,
    indexedAt: now(),
  };
  ledger.assets.push(successor);
  return successor;
}

/* ---------------------------------------------------------------------------
   The pass. Explicit targets only. */
async function verifyAssets(options) {
  const projectDir = options.projectDir;
  const now = options.now || (() => new Date().toISOString());
  const limit = Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_VERIFY_LIMIT;
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES;
  const wantPaths = Array.isArray(options.paths) ? options.paths : [];
  const wantIds = Array.isArray(options.assetIds) ? options.assetIds : [];

  if (!wantPaths.length && !wantIds.length) {
    const error = new Error(
      "Verification needs an explicit list of assets. There is no whole-project mode: "
      + "reading every file would download an entire media corpus on a cloud-synced project.",
    );
    error.code = "VERIFY_TARGETS_REQUIRED";
    error.status = 400;
    throw error;
  }

  /* Not caught: a ledger with no readable copy must abort, never verify against an
     empty one — that would treat every asset as new. */
  const loaded = readLedger(projectDir);
  if (!loaded.exists) return { status: "skipped", reason: "no-ledger", verified: 0, wrote: false };
  if (loaded.readOnly)
    return { status: "skipped", reason: "ledger-newer-than-build", warning: loaded.warning, verified: 0, wrote: false };

  const ledger = loaded.ledger;
  const byPath = new Map();
  const byId = new Map();
  for (const asset of ledger.assets) {
    if (!asset || !asset.storage) continue;
    if (!byPath.has(asset.storage.path) || asset.storage.missing !== true) byPath.set(asset.storage.path, asset);
    byId.set(asset.assetId, asset);
  }

  const targets = [];
  const unknown = [];
  for (const relativePath of wantPaths) {
    const row = byPath.get(relativePath);
    if (row) targets.push(row); else unknown.push(relativePath);
  }
  for (const assetId of wantIds) {
    const row = byId.get(assetId);
    if (row) targets.push(row); else unknown.push(assetId);
  }

  const stats = { verified: 0, confirmed: 0, replaced: 0, unavailable: 0, missing: 0, skipped: 0 };
  const results = [];
  const retiredThisPass = new Set();
  let budget = maxBytes;
  let changed = false;

  for (const asset of targets) {
    if (stats.verified + stats.confirmed + stats.replaced + stats.unavailable + stats.missing >= limit) {
      stats.skipped += 1;
      results.push({ path: asset.storage.path, outcome: "skipped-limit" });
      continue;
    }

    const absolute = path.join(projectDir, asset.storage.path);
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch (error) {
      /* Stat is cheap and does not hydrate. A failure here decides whether the
         file is gone or merely unreachable, and neither outcome touches identity. */
      if (classifyError(error) === "absent") {
        if (!asset.storage.missing) {
          asset.storage = { ...asset.storage, missing: true };
          asset.indexedAt = now();
          changed = true;
        }
        stats.missing += 1;
        results.push({ path: asset.storage.path, outcome: "missing", assetId: asset.assetId });
      } else {
        /* Only stamp when the state actually moves. A file that is locked every
           pass would otherwise rewrite the ledger every pass, which is churn on a
           synced root and makes an unchanged verification non-idempotent. */
        if (asset.hashState !== "unavailable") {
          Object.assign(asset, markUnavailable(asset), { indexedAt: now() });
          changed = true;
        }
        stats.unavailable += 1;
        results.push({ path: asset.storage.path, outcome: "unavailable", assetId: asset.assetId, code: error?.code || "" });
      }
      continue;
    }

    if (stat.size > budget) {
      stats.skipped += 1;
      results.push({ path: asset.storage.path, outcome: "skipped-budget", bytes: stat.size });
      continue;
    }

    let digest;
    try {
      digest = digestOf(absolute);
    } catch (error) {
      /* THE failure this whole design is built around: a file that stats fine but
         cannot be opened, because a sync client is fetching it, a Windows process
         holds a share lock, or the network dropped. It is not a mismatch. */
      if (classifyError(error) === "absent") {
        if (!asset.storage.missing) {
          asset.storage = { ...asset.storage, missing: true };
          asset.indexedAt = now();
          changed = true;
        }
        stats.missing += 1;
      } else {
        if (asset.hashState !== "unavailable") {
          Object.assign(asset, markUnavailable(asset), { indexedAt: now() });
          changed = true;
        }
        stats.unavailable += 1;
      }
      results.push({
        path: asset.storage.path,
        outcome: classifyError(error) === "absent" ? "missing" : "unavailable",
        assetId: asset.assetId,
        code: error?.code || "",
      });
      continue;
    }

    budget -= stat.size;

    /* The branch is on whether a digest was ever VERIFIED, not on hashState.
       An `unavailable` row that was hashed before still carries its digest — that
       retention is the whole point of the state — so it must be compared against,
       not overwritten. Keying on hashState here would let a file that went offline
       and came back with different bytes silently mutate its own identity, which is
       precisely the failure the ledger is built to prevent. */
    if (!asset.contentHash) {
      /* First successful read. This is a FIRST VERIFICATION, not a mismatch: there
         was no previous digest to disagree with. An unavailable row that never had
         a hash lands here too. */
      asset.contentHash = digest;
      asset.hashState = "hashed";
      if (asset.needsVerify) delete asset.needsVerify;
      if (asset.storage.missing) delete asset.storage.missing;
      asset.storage = { ...asset.storage, bytes: stat.size, mtimeMs: stat.mtimeMs };
      asset.indexedAt = now();
      stats.verified += 1;
      changed = true;
      results.push({ path: asset.storage.path, outcome: "verified", assetId: asset.assetId, contentHash: digest });
      continue;
    }

    if (asset.contentHash === digest) {
      /* Same bytes. Whatever churned the metadata was metadata. */
      const wasFlagged = Boolean(asset.needsVerify) || asset.hashState !== "hashed";
      if (asset.needsVerify) delete asset.needsVerify;
      asset.hashState = "hashed";
      if (asset.storage.missing) delete asset.storage.missing;
      asset.storage = { ...asset.storage, bytes: stat.size, mtimeMs: stat.mtimeMs };
      if (wasFlagged) { asset.indexedAt = now(); changed = true; }
      stats.confirmed += 1;
      results.push({ path: asset.storage.path, outcome: "confirmed", assetId: asset.assetId, contentHash: digest });
      continue;
    }

    const successor = recordReplacement(ledger, asset, digest, stat, now);
    retiredThisPass.add(asset.assetId);
    stats.replaced += 1;
    changed = true;
    results.push({
      path: successor.storage.path,
      outcome: "replaced",
      assetId: successor.assetId,
      replacedAssetId: asset.assetId,
      previousContentHash: asset.contentHash,
      contentHash: digest,
    });
  }

  const reconciled = options.detectRenames === false
    ? { renames: [], ambiguous: [] }
    : reconcileRenames(ledger, { now, exclude: retiredThisPass });
  if (reconciled.renames.length || reconciled.ambiguous.length) changed = true;

  if (changed) writeLedgerSync(projectDir, ledger);

  return {
    status: "complete",
    ...stats,
    unknown,
    results,
    renames: reconciled.renames,
    ambiguous: reconciled.ambiguous,
    bytesRead: maxBytes - budget,
    wrote: changed,
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_VERIFY_LIMIT,
  reconcileRenames,
  verifyAssets,
};

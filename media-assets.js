/* CineBraid MediaAsset ledger — identity, schema, lifecycle, and the durable store.
 *
 * A MediaAsset is durable identity for one piece of project media. It outlives the
 * job that produced it, the filename it currently has, and the render node it came
 * from, and it is what lets ancestry survive the approval rename that breaks
 * filename-keyed edges today.
 *
 * PHASE 2a SCOPE. This module is INERT. It has no caller in the product: nothing
 * walks a directory, nothing hashes anything, and no `media-assets.json` is created
 * by opening a project. Phase 2b adds discovery and indexing; until then a project
 * with no sidecar is the normal state, and every reader must tolerate it.
 *
 * Two decisions shape everything below, and both are deliberate:
 *
 *   assetId is independent of content.  It is minted from randomness, so an asset
 *   has a complete identity before anything reads its bytes. Two assets may share a
 *   contentHash legitimately — the same image approved for two shots — and a
 *   content-derived id would make that state unrepresentable.
 *
 *   contentHash is NULLABLE.  projectsRoot is user-configurable and Windows puts
 *   Desktop and Documents inside OneDrive, so a project may live in a
 *   Files-on-Demand folder where reading a file downloads it. Node exposes no
 *   Windows file attributes, so a placeholder cannot even be detected — hydration
 *   has to be avoided by construction rather than by checking. An index that
 *   hashed everything would silently pull an entire media corpus over the network.
 *
 * Naming, because the collision is easy and permanent: `P.mediaAssets[]` in
 * project.json is the PROJECT MEDIA LIBRARY, a different and older thing. Rows in
 * this ledger are MediaAssets. Nothing here reads or writes project.json.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MEDIA_ASSETS_FILE = "media-assets.json";
const MEDIA_ASSETS_SCHEMA_VERSION = 1;

/* ---------------------------------------------------------------------------
   Identity.

   128 random bits. The width is chosen so that collision handling is an
   ASSERTION rather than a branch: at 48 bits a project reaches a one-in-a-million
   chance around 24,000 assets, which forces resolution code that will almost never
   execute and therefore will almost never be correct. At 128 bits a duplicate is a
   programming error, and is treated as one. */
const ASSET_ID_PREFIX = "asset-";
const ASSET_ID_HEX_LENGTH = 32;
const ASSET_ID_PATTERN = /^asset-[0-9a-f]{32}$/;

function mintAssetId() {
  return ASSET_ID_PREFIX + crypto.randomBytes(ASSET_ID_HEX_LENGTH / 2).toString("hex");
}
function isValidAssetId(value) {
  return typeof value === "string" && ASSET_ID_PATTERN.test(value);
}

/* ---------------------------------------------------------------------------
   Vocabularies. Data, not switches. */
const HASH_STATES = ["unhashed", "hashed", "unavailable"];
const MEDIA_TYPES = ["image", "video", "audio", "document"];
const ASSET_SOURCES = ["generated", "uploaded", "imported", "derived", "extracted", "unknown"];
const ASSET_LIFECYCLES = ["candidate", "approved", "rejected", "dismissed", "superseded"];
const ASSET_ROLES = [
  "frame-candidate", "frame-approved", "blocking-guide", "motion-candidate", "motion-approved",
  "entity-reference", "coverage-sheet", "coverage-crop", "expression-reference",
  "continuity-state-reference", "dialogue", "voice", "sfx", "foley", "ambience", "music",
  "room-tone", "temp-reference", "native-generated-audio", "document", "import", "unknown",
];
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
function fail(errors, field, code, message) {
  errors.push({ field, code, message });
}

/* A stored path is project-relative, always. An absolute path would bake a
   machine — and on a synced root, a OneDrive/Dropbox/Drive location — into
   identity, so a project could not be moved, restored from a backup, or opened on
   the second machine it is already syncing to. */
function isProjectRelativePath(value) {
  if (!isNonEmptyString(value)) return false;
  if (path.isAbsolute(value)) return false;
  if (/^[a-zA-Z]:/.test(value)) return false;      /* drive-qualified */
  if (value.startsWith("\\\\") || value.startsWith("//")) return false;  /* UNC */
  const segments = value.split(/[\\/]/);
  if (segments.some((segment) => segment === ".." || segment === ".")) return false;
  return segments.every((segment) => segment !== "");
}

/* ---------------------------------------------------------------------------
   The hash-state contract.

   Three states, and the pairing with contentHash is not free-form:

     unhashed     the bytes have never been read.        contentHash MUST be null.
     hashed       the bytes were read successfully.      contentHash MUST be a digest.
     unavailable  the bytes cannot be read right now.
                    never hashed before  -> contentHash null
                    hashed before        -> the last verified digest is RETAINED

   The retention rule is the load-bearing one. Temporary unavailability must never
   erase established byte identity: dropping the digest would discard the only
   durable statement about those bytes at exactly the moment nothing can re-derive
   it, and a later successful read would then look like a NEW asset rather than the
   same one returning.

   A read failure is therefore never a hash mismatch, never deletion, never ledger
   corruption, and never permission to re-mint an assetId. */
function validateHashState(asset, errors, at = "") {
  const prefix = at ? `${at}.` : "";
  const state = asset.hashState;
  const hash = asset.contentHash;

  if (!HASH_STATES.includes(state)) {
    fail(errors, `${prefix}hashState`, "unsupported-value",
      `hashState must be one of: ${HASH_STATES.join(", ")}.`);
    return;
  }
  if (hash !== null && hash !== undefined && !CONTENT_HASH_PATTERN.test(String(hash))) {
    fail(errors, `${prefix}contentHash`, "malformed-digest",
      'contentHash must be "sha256:" followed by 64 lowercase hex characters, or null.');
    return;
  }
  const hasHash = isNonEmptyString(hash);

  if (state === "unhashed" && hasHash)
    fail(errors, `${prefix}contentHash`, "contradiction",
      "An unhashed asset cannot carry a digest — nothing has read its bytes.");
  if (state === "hashed" && !hasHash)
    fail(errors, `${prefix}contentHash`, "contradiction",
      "A hashed asset must carry the digest that was computed.");
  /* `unavailable` accepts BOTH: null when never hashed, and a retained digest when
     it was. That is the whole point of the state. */
}

/* ---------------------------------------------------------------------------
   Asset validation. Strict about meaning, permissive about deferred fields. */
function validateMediaAsset(asset, options = {}) {
  const errors = [];
  const at = options.at || "";
  const prefix = at ? `${at}.` : "";

  if (!isRecord(asset)) {
    fail(errors, at || "asset", "invalid-type", "A MediaAsset must be an object.");
    return { ok: false, errors };
  }

  if (!isValidAssetId(asset.assetId))
    fail(errors, `${prefix}assetId`, "malformed-asset-id",
      'assetId must be "asset-" followed by 32 lowercase hex characters.');

  validateHashState(asset, errors, at);

  if (!MEDIA_TYPES.includes(asset.mediaType))
    fail(errors, `${prefix}mediaType`, "unsupported-value", `mediaType must be one of: ${MEDIA_TYPES.join(", ")}.`);
  if (!ASSET_ROLES.includes(asset.role))
    fail(errors, `${prefix}role`, "unsupported-value", "role is not a known production role.");
  if (!ASSET_SOURCES.includes(asset.source))
    fail(errors, `${prefix}source`, "unsupported-value", `source must be one of: ${ASSET_SOURCES.join(", ")}.`);
  if (!ASSET_LIFECYCLES.includes(asset.lifecycle))
    fail(errors, `${prefix}lifecycle`, "unsupported-value", `lifecycle must be one of: ${ASSET_LIFECYCLES.join(", ")}.`);

  if (!isRecord(asset.scope))
    fail(errors, `${prefix}scope`, "missing", "scope is required (its members may be null).");

  if (!isRecord(asset.storage)) {
    fail(errors, `${prefix}storage`, "missing", "storage is required.");
  } else {
    if (!isProjectRelativePath(asset.storage.path))
      fail(errors, `${prefix}storage.path`, "not-project-relative",
        "storage.path must be a project-relative path — never absolute, drive-qualified, UNC, or containing '..'.");
    for (const field of ["bytes", "mtimeMs"])
      if (asset.storage[field] != null && !(Number.isFinite(Number(asset.storage[field])) && Number(asset.storage[field]) >= 0))
        fail(errors, `${prefix}storage.${field}`, "out-of-range", `${field} must be a non-negative number when present.`);
  }

  if (!isRecord(asset.legacy))
    fail(errors, `${prefix}legacy`, "missing", "legacy is required (its members may be null).");

  if (!isNonEmptyString(asset.indexedAt))
    fail(errors, `${prefix}indexedAt`, "missing", "indexedAt is required.");

  return { ok: errors.length === 0, errors };
}

function validateLedger(ledger) {
  const errors = [];
  if (!isRecord(ledger)) {
    fail(errors, "ledger", "invalid-type", "A ledger must be an object.");
    return { ok: false, errors };
  }
  if (ledger.schemaVersion !== MEDIA_ASSETS_SCHEMA_VERSION)
    fail(errors, "schemaVersion", "unsupported-value",
      `schemaVersion must be ${MEDIA_ASSETS_SCHEMA_VERSION}.`);
  if (!Array.isArray(ledger.assets)) {
    fail(errors, "assets", "invalid-type", "assets must be an array.");
    return { ok: false, errors };
  }
  const seen = new Set();
  ledger.assets.forEach((asset, index) => {
    const result = validateMediaAsset(asset, { at: `assets[${index}]` });
    errors.push(...result.errors);
    if (isRecord(asset) && isValidAssetId(asset.assetId)) {
      if (seen.has(asset.assetId))
        fail(errors, `assets[${index}].assetId`, "duplicate", "assetId must be unique within a ledger.");
      else seen.add(asset.assetId);
    }
  });
  /* Two assets sharing a contentHash is LEGAL and deliberately not checked: the
     same image approved for two shots is two production records of one content. */
  return { ok: errors.length === 0, errors };
}

function emptyLedger() {
  return { schemaVersion: MEDIA_ASSETS_SCHEMA_VERSION, assets: [] };
}

/* Marking an asset unavailable. Separate function because getting this wrong is
   how byte identity gets thrown away by a network hiccup. */
function markUnavailable(asset) {
  if (!isRecord(asset)) return asset;
  return {
    ...asset,
    hashState: "unavailable",
    /* Retained, deliberately. Absence of bytes is not different bytes. */
    contentHash: asset.contentHash ?? null,
  };
}

/* ---------------------------------------------------------------------------
   Lifecycle projection.

   A PROJECTION, never authority. Phase 2 observes the approval state the product
   already keeps and reports it; it decides nothing, writes nothing, and changes no
   approval behaviour. That is what makes a ledger safe to introduce beside a mature
   approval workflow — a projection cannot corrupt what it projects.

   Dialects differ and must be handled apart. In particular an entity row carries
   its own decision vocabulary (approved-reference, approved-sheet-source,
   approved-coverage, approved-expression) which public/review-provenance.js would
   coerce to "unreviewed"; entity rows are therefore NEVER routed through
   candidateRecord() or any equivalent normaliser. */
function deriveLifecycle(row, context = {}) {
  if (!isRecord(row)) return "candidate";
  const dialect = context.dialect || "shot-candidate";
  const key = context.key
    || (isNonEmptyString(row.stored) ? row.stored : "")
    || (isNonEmptyString(row.name) ? row.name : "")
    || (isNonEmptyString(row.original) ? row.original : "");

  /* Supersede first: a replaced row may still carry stale approval timestamps. */
  if (isNonEmptyString(row.replacedAt) || isNonEmptyString(row.replacedBy)) return "superseded";
  if (isNonEmptyString(row.dismissedAt)) return "dismissed";

  if (dialect === "entity-candidate") {
    /* Approved only while something still points AT it. */
    const pointers = Array.isArray(context.approvedPointers) ? context.approvedPointers : [];
    if (key && pointers.includes(key)) return "approved";
    /* Its own vocabulary, preserved rather than coerced. */
    if (typeof row.decision === "string" && row.decision.startsWith("approved-"))
      return pointers.length ? "superseded" : "approved";
    if (row.decision === "rejected") return "rejected";
    return "candidate";
  }

  if (dialect === "library-entry") {
    return context.active === true ? "approved" : "candidate";
  }

  /* shot-candidate, the default. `approved` requires a LIVE pointer — an
     approvedAt alone is not enough, because supersede deletes the pointer and can
     leave a timestamp behind elsewhere. */
  const winners = Array.isArray(context.winners) ? context.winners : [];
  if (key && winners.includes(key)) return "approved";
  if (row.decision === "rejected") return "rejected";
  return "candidate";
}

/* No lifecycle value ever deletes bytes, and nothing here removes a row. */
const TERMINAL_LIFECYCLES = ["rejected", "dismissed", "superseded"];

module.exports = {
  ASSET_ID_HEX_LENGTH,
  ASSET_ID_PATTERN,
  ASSET_ID_PREFIX,
  ASSET_LIFECYCLES,
  ASSET_ROLES,
  ASSET_SOURCES,
  CONTENT_HASH_PATTERN,
  HASH_STATES,
  MEDIA_ASSETS_FILE,
  MEDIA_ASSETS_SCHEMA_VERSION,
  MEDIA_TYPES,
  TERMINAL_LIFECYCLES,
  deriveLifecycle,
  emptyLedger,
  isProjectRelativePath,
  isValidAssetId,
  markUnavailable,
  mintAssetId,
  validateHashState,
  validateLedger,
  validateMediaAsset,
};

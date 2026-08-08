/* CineBraid MediaAsset indexing — the stat-only backfill.
 *
 * Discovers the media a project already has and records it in the sidecar ledger.
 * It is an INDEX, not a source of truth: filename-keyed candidate, winner and
 * approval behaviour stays exactly as authoritative as it was, and a project with
 * no ledger row for a file degrades to the legacy path rather than breaking.
 *
 * THE RULE THAT SHAPES EVERYTHING: the default pass never opens a media file.
 *
 * `projectsRoot` is user-configurable and Windows puts Desktop and Documents inside
 * OneDrive, so a project may sit in a Files-on-Demand folder where reading a file
 * downloads it — and Node's fs.Stats exposes no Windows file attributes, so a
 * placeholder cannot even be detected. Hydration therefore has to be avoided by
 * construction. This module calls readdir and stat and nothing else; it does not
 * import the hasher at all, so it cannot hash by accident.
 *
 * The second rule: metadata is a hint, never identity. mtime, ctime, size and inode
 * are all volatile under a sync client, so none of them may mint, retire or replace
 * an assetId. Only a successful byte read can prove bytes changed, and that happens
 * in an explicit hashing pass — never here.
 */

const fs = require("fs");
const path = require("path");

const {
  emptyLedger,
  deriveLifecycle,
  markUnavailable,
  mintAssetId,
} = require("./media-assets");
const { LedgerUnreadableError, readLedger, writeLedgerSync } = require("./media-asset-store");

/* The extensions and directories CineBraid already treats as project media. Kept
   in step with server.js's MEDIA_EXT and scanProject deliberately: this indexes
   what the product already shows, and introduces no new layout. */
const MEDIA_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".mp4", ".webm", ".mov",
  ".wav", ".mp3", ".m4a", ".flac", ".ogg",
]);
const FLAT_MEDIA_DIRS = ["anchors", "plates", "props", "vehicles", "audio", "media"];
const SHOT_MEDIA_DIRS = ["takes", "locked", "blocking"];

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov"]);
const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".flac", ".ogg"]);

const DEFAULT_CHUNK_SIZE = 200;

/* Errno classification. The distinction is the whole safety story:

     confirmed absence  — the parent directory listed fine and the file is not in it
     cannot read NOW    — a sync client, a lock, a permission blip, an offline placeholder
     the root is gone   — says nothing about any individual asset

   A transient failure is never deletion, never corruption, never a hash mismatch,
   and never permission to re-mint. */
const TRANSIENT_CODES = new Set([
  "EIO", "EBUSY", "EPERM", "EACCES", "ETIMEDOUT", "EAGAIN", "EMFILE", "ENFILE",
  "ENETDOWN", "ENETUNREACH", "EHOSTDOWN", "EHOSTUNREACH", "ESTALE", "EWOULDBLOCK",
  /* Windows surfaces a sharing violation and a cloud-provider stall as these. */
  "EBUSY", "UNKNOWN",
]);
function classifyError(error) {
  const code = error && error.code ? String(error.code) : "";
  if (code === "ENOENT") return "absent";
  if (TRANSIENT_CODES.has(code)) return "transient";
  /* An unrecognised errno is treated as transient, deliberately. Guessing
     "deleted" on an unknown failure is the expensive direction to be wrong in. */
  return "transient";
}

class IndexRootUnreadableError extends Error {
  constructor(projectDir, cause) {
    super(
      `CineBraid could not read the project folder while indexing media (${projectDir}). `
      + "The pass was abandoned rather than concluding that every asset had been deleted.",
    );
    this.name = "IndexRootUnreadableError";
    this.code = "INDEX_ROOT_UNREADABLE";
    this.cause = cause;
  }
}

function mediaTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "document";
}

/* Role and scope come from the directory, which is the only thing the filesystem
   actually proves, refined by whichever project record references the file. What
   the source cannot prove stays null or "unknown" — a wrong role written once
   propagates into Ready-for-Edit selection later. */
function describeLocation(relativePath) {
  const parts = relativePath.split("/");
  if (parts[0] === "shots" && parts.length === 4) {
    const [, shotId, dir] = parts;
    if (!SHOT_MEDIA_DIRS.includes(dir)) return null;
    return {
      scope: { shotId, frameId: null, clipId: null, entityList: null, entityId: null },
      dir,
    };
  }
  if (parts.length === 2 && FLAT_MEDIA_DIRS.includes(parts[0])) {
    const entityList = ["anchors", "plates", "props", "vehicles"].includes(parts[0]) ? parts[0] : null;
    return {
      scope: { shotId: null, frameId: null, clipId: null, entityList, entityId: null },
      dir: parts[0],
    };
  }
  return null;
}

/* An index of what project.json already says, built once per pass. Read-only:
   nothing in this module writes a project record, and the ledger is allowed to
   know about legacy rows without those rows knowing about the ledger. */
function buildProjectEvidence(project) {
  const shotRows = new Map();       /* "<shotId>/<file>" -> candidate row */
  const shotWinners = new Map();    /* shotId -> [live pointer filenames] */
  const entityRows = new Map();     /* "<list>/<file>" -> candidate row */
  const entityPointers = new Map(); /* list -> [live pointer filenames] */
  const libraryByFile = new Map();  /* filename -> P.mediaAssets[] entry */
  const activeBlocking = new Set();

  if (!project || typeof project !== "object") {
    return { shotRows, shotWinners, entityRows, entityPointers, libraryByFile, activeBlocking };
  }

  for (const shot of Array.isArray(project.shots) ? project.shots : []) {
    const winners = [];
    if (shot.winner) winners.push(shot.winner);
    if (shot.canonicalName) winners.push(shot.canonicalName);
    if (shot.finalVideoFile) winners.push(shot.finalVideoFile);
    if (shot.finalStillFile) winners.push(shot.finalStillFile);
    for (const frame of Array.isArray(shot.keyframes) ? shot.keyframes : [])
      if (frame && frame.winner) winners.push(frame.winner);
    for (const clip of Array.isArray(shot.clips) ? shot.clips : []) {
      if (!clip) continue;
      for (const key of ["winner", "winnerEnd", "videoWinner"]) if (clip[key]) winners.push(clip[key]);
    }
    const brief = shot.creationBrief || {};
    for (const key of ["approvedMotionFile", "finalVideoFile", "finalStillFile"])
      if (brief[key]) winners.push(brief[key]);
    shotWinners.set(shot.id, winners.filter(Boolean));

    for (const row of Array.isArray(shot.candidateFiles) ? shot.candidateFiles : []) {
      const key = row && (row.stored || row.name || row.original);
      if (key) shotRows.set(`${shot.id}/${key}`, row);
    }
  }

  for (const list of ["characters", "locations", "props", "vehicles", "audio"]) {
    const pointers = [];
    for (const entity of Array.isArray(project[list]) ? project[list] : []) {
      if (!entity) continue;
      if (entity.approvedFile) pointers.push(entity.approvedFile);
      for (const state of Array.isArray(entity.continuityStates) ? entity.continuityStates : [])
        if (state && state.approvedFile) pointers.push(state.approvedFile);
      for (const group of ["coverageSlots", "expressionSlots"])
        for (const slot of Array.isArray(entity[group]) ? entity[group] : [])
          if (slot && slot.approvedFile) pointers.push(slot.approvedFile);
      /* Entity rows keep their own decision vocabulary. They are never routed
         through candidateRecord(), which would coerce it to "unreviewed". */
      for (const row of Array.isArray(entity.candidateFiles) ? entity.candidateFiles : []) {
        const key = row && (row.stored || row.name || row.original);
        if (key) entityRows.set(key, { row, entityId: entity.id, list });
      }
    }
    entityPointers.set(list, pointers.filter(Boolean));
  }

  for (const asset of Array.isArray(project.mediaAssets) ? project.mediaAssets : []) {
    if (!asset || !asset.file) continue;
    libraryByFile.set(asset.file, asset);
    for (const link of Array.isArray(asset.links) ? asset.links : [])
      if (link && link.blockingState === "active") activeBlocking.add(asset.file);
  }
  for (const shot of Array.isArray(project.shots) ? project.shots : []) {
    const activeId = shot?.creationBrief?.activeBlockingAssetId;
    if (!activeId) continue;
    for (const asset of Array.isArray(project.mediaAssets) ? project.mediaAssets : [])
      if (asset && asset.id === activeId && asset.file) activeBlocking.add(asset.file);
  }

  return { shotRows, shotWinners, entityRows, entityPointers, libraryByFile, activeBlocking };
}

/* What a discovered file is, according only to evidence that exists. */
function describeAsset(relativePath, location, evidence) {
  const file = path.posix.basename(relativePath);
  const mediaType = mediaTypeFor(file);
  const scope = { ...location.scope };
  let role = "unknown";
  let source = "unknown";
  let lifecycle = "candidate";
  const legacy = { candidateArray: null, candidateKey: null, libraryAssetId: null };

  if (location.scope.shotId) {
    const row = evidence.shotRows.get(`${location.scope.shotId}/${file}`);
    const winners = evidence.shotWinners.get(location.scope.shotId) || [];
    if (location.dir === "blocking") {
      role = "blocking-guide";
      const library = evidence.libraryByFile.get(file);
      if (library) legacy.libraryAssetId = library.id || null;
      lifecycle = deriveLifecycle(row || { stored: file }, {
        dialect: "library-entry", key: file, active: evidence.activeBlocking.has(file),
      });
    } else {
      role = mediaType === "video" ? "motion-candidate" : "frame-candidate";
      lifecycle = deriveLifecycle(row || { stored: file }, { winners, key: file });
      if (lifecycle === "approved") role = mediaType === "video" ? "motion-approved" : "frame-approved";
    }
    if (row) {
      legacy.candidateArray = "shot.candidateFiles";
      legacy.candidateKey = row.stored || row.name || row.original || file;
      if (row.frameId) scope.frameId = row.frameId;
      /* generationJobId is the only thing that proves a file was generated. */
      if (row.generationJobId) source = "generated";
      else if (row.addedAt) source = "uploaded";
    }
  } else if (location.scope.entityList) {
    const match = evidence.entityRows.get(file);
    const pointers = evidence.entityPointers.get(
      { anchors: "characters", plates: "locations", props: "props", vehicles: "vehicles" }[location.dir] || location.dir,
    ) || [];
    role = "entity-reference";
    lifecycle = deriveLifecycle(match ? match.row : { stored: file }, {
      dialect: "entity-candidate", key: file, approvedPointers: pointers,
    });
    if (match) {
      legacy.candidateArray = "entity.candidateFiles";
      legacy.candidateKey = match.row.stored || match.row.name || match.row.original || file;
      scope.entityId = match.entityId || null;
      if (match.row.generationJobId) source = "generated";
    }
  } else {
    /* media/ and audio/ are the project library and the sound folder. Nothing
       here proves a production role, so it stays unknown. */
    role = location.dir === "audio" ? "temp-reference" : "unknown";
    const library = evidence.libraryByFile.get(file);
    if (library) {
      legacy.libraryAssetId = library.id || null;
      source = library.generationRecord ? "generated" : "uploaded";
    }
  }

  return { mediaType, scope, role, source, lifecycle, legacy };
}

/* Directory enumeration. Stat only — this never opens a file. */
function listMediaDir(projectDir, relativeDir, problems) {
  const absolute = path.join(projectDir, relativeDir);
  let entries;
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    /* A directory that exists but cannot be listed is a transient condition for
       everything inside it — not proof that its contents were deleted. */
    problems.push({ dir: relativeDir, kind: classifyError(error), code: error?.code || "" });
    return null;
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!MEDIA_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    found.push(`${relativeDir}/${entry.name}`.split(path.sep).join("/"));
  }
  return found;
}

function discoverPaths(projectDir, problems) {
  const paths = [];
  const readable = new Set();
  for (const dir of FLAT_MEDIA_DIRS) {
    const listed = listMediaDir(projectDir, dir, problems);
    if (listed === null) continue;
    readable.add(dir);
    paths.push(...listed);
  }
  const shotsRoot = path.join(projectDir, "shots");
  let shotIds = [];
  try {
    shotIds = fs.readdirSync(shotsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error?.code !== "ENOENT")
      problems.push({ dir: "shots", kind: classifyError(error), code: error?.code || "" });
  }
  for (const shotId of shotIds)
    for (const dir of SHOT_MEDIA_DIRS) {
      const relative = `shots/${shotId}/${dir}`;
      const listed = listMediaDir(projectDir, relative, problems);
      if (listed === null) continue;
      readable.add(relative);
      paths.push(...listed);
    }
  return { paths: paths.sort(), readableDirs: readable };
}

function statOf(projectDir, relativePath) {
  try {
    const stat = fs.statSync(path.join(projectDir, relativePath));
    return { ok: true, bytes: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    return { ok: false, kind: classifyError(error), code: error?.code || "" };
  }
}

/* ---------------------------------------------------------------------------
   The pass.

   Chunked and yielding, so a large production stays usable while it runs and an
   interrupted pass leaves a valid ledger that a later pass simply continues. */
async function indexProject(options) {
  const projectDir = options.projectDir;
  const slug = options.slug || path.basename(projectDir);
  const project = options.project || null;
  const chunkSize = Number(options.chunkSize) > 0 ? Number(options.chunkSize) : DEFAULT_CHUNK_SIZE;
  const now = options.now || (() => new Date().toISOString());
  /* The pass belongs to ONE project identity from start to finish. If the active
     project changes mid-pass, later chunks must not write into the new one. */
  const activeSlug = typeof options.activeSlug === "function" ? options.activeSlug : null;
  const onChunk = typeof options.onChunk === "function" ? options.onChunk : null;

  /* A root that cannot be listed aborts. One root failure says nothing about any
     individual asset, and mass-marking everything missing would be catastrophic. */
  try {
    fs.readdirSync(projectDir);
  } catch (error) {
    throw new IndexRootUnreadableError(projectDir, error);
  }

  /* The store refuses when both copies are unreadable. That refusal is now
     reachable, and it is deliberately NOT caught: backfilling from empty would
     re-mint an assetId for every file and destroy every relationship built on the
     old ones. Aborting is the safe direction. */
  const loaded = readLedger(projectDir);
  if (loaded.readOnly) {
    return {
      slug, status: "skipped", reason: "ledger-newer-than-build",
      warning: loaded.warning, indexed: 0, minted: 0, chunks: 0,
    };
  }

  const ledger = loaded.exists ? loaded.ledger : emptyLedger();
  /* One path can carry two rows: verification retires a record when the bytes
     under it are replaced, and its successor occupies the same path. The LIVE row
     is the one to reuse — picking the retired one would un-mark it missing and
     graft a record that describes different bytes back onto the file. */
  const byPath = new Map();
  for (const asset of ledger.assets) {
    if (!asset || !asset.storage) continue;
    const held = byPath.get(asset.storage.path);
    if (held && held.storage.missing !== true) continue;
    byPath.set(asset.storage.path, asset);
  }

  const problems = [];
  const { paths, readableDirs } = discoverPaths(projectDir, problems);
  const evidence = buildProjectEvidence(project);

  const stats = { indexed: 0, minted: 0, reused: 0, unavailable: 0, missing: 0, chunks: 0, aborted: false };
  const seen = new Set();
  let changed = false;

  for (let offset = 0; offset < paths.length; offset += chunkSize) {
    /* Between chunks — never mid-chunk — check that we are still the active
       project. Continuity Phase 4 scoped its cache to its execution endpoint for
       exactly this class of bug. */
    if (activeSlug && activeSlug() !== slug) {
      stats.aborted = true;
      break;
    }

    const chunk = paths.slice(offset, offset + chunkSize);
    for (const relativePath of chunk) {
      const location = describeLocation(relativePath);
      if (!location) continue;
      seen.add(relativePath);

      const existing = byPath.get(relativePath);
      const stat = statOf(projectDir, relativePath);

      if (!stat.ok) {
        /* Discovered by readdir but unstatable a moment later. Transient. */
        if (existing) {
          const marked = markUnavailable(existing);
          Object.assign(existing, marked, { indexedAt: now() });
          stats.unavailable += 1;
          changed = true;
        }
        continue;
      }

      if (existing) {
        /* IDENTITY IS REUSED. A changed size or mtime is a hint that the bytes may
           differ, never proof — only a successful hash can establish that, and this
           pass does not hash. So the row is flagged for later verification and its
           assetId, contentHash and hashState are left exactly as they were. */
        const drifted = existing.storage.bytes !== stat.bytes || existing.storage.mtimeMs !== stat.mtimeMs;
        if (drifted) {
          existing.storage = { ...existing.storage, bytes: stat.bytes, mtimeMs: stat.mtimeMs };
          existing.needsVerify = true;
          existing.indexedAt = now();
          changed = true;
        }
        if (existing.storage.missing) {
          delete existing.storage.missing;
          existing.indexedAt = now();
          changed = true;
        }
        /* A file that was unavailable and can be statted again is present, but its
           bytes are still unread — so it returns to unhashed only if it never had a
           verified hash. A known hash survives. */
        if (existing.hashState === "unavailable" && !existing.contentHash) {
          existing.hashState = "unhashed";
          existing.indexedAt = now();
          changed = true;
        }
        stats.reused += 1;
      } else {
        const described = describeAsset(relativePath, location, evidence);
        ledger.assets.push({
          assetId: mintAssetId(),
          contentHash: null,
          hashState: "unhashed",
          scope: described.scope,
          mediaType: described.mediaType,
          role: described.role,
          source: described.source,
          lifecycle: described.lifecycle,
          storage: { path: relativePath, bytes: stat.bytes, mtimeMs: stat.mtimeMs },
          legacy: described.legacy,
          indexedAt: now(),
        });
        stats.minted += 1;
        changed = true;
      }
      stats.indexed += 1;
    }

    stats.chunks += 1;
    if (onChunk) onChunk({ slug, done: Math.min(offset + chunkSize, paths.length), total: paths.length });
    /* Yield, so a large production stays responsive and the pass is interruptible. */
    await new Promise((resolve) => setImmediate(resolve));
  }

  /* Rows whose file was not discovered this pass. Confirmed absence requires the
     containing directory to have listed successfully — otherwise the file may be
     perfectly fine behind a directory we could not read. */
  if (!stats.aborted) {
    for (const asset of ledger.assets) {
      const relativePath = asset?.storage?.path;
      if (!relativePath || seen.has(relativePath)) continue;
      const parent = relativePath.split("/").slice(0, -1).join("/");
      if (!readableDirs.has(parent)) continue;   /* directory unreadable — say nothing */
      if (!asset.storage.missing) {
        asset.storage = { ...asset.storage, missing: true };
        asset.indexedAt = now();
        stats.missing += 1;
        changed = true;
      }
    }
  }

  /* Persist what this pass established, even when it stopped early.

     The write target is `projectDir`, captured before the first chunk, so it can
     never be the project that was switched TO — the rows belong to the project the
     pass started on and belong in its ledger. Discarding them would throw away
     valid identities and force a later pass to re-mint them, which is the opposite
     of what project-switch isolation is protecting.

     Do not rewrite an unchanged ledger, though: an identical write is still a
     write, and on a synced root it is another file for the sync client to
     reconcile. */
  if (changed) writeLedgerSync(projectDir, ledger);

  return {
    slug,
    status: stats.aborted ? "aborted-project-switch" : "complete",
    ...stats,
    problems,
    wrote: changed,
  };
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  IndexRootUnreadableError,
  LedgerUnreadableError,
  MEDIA_EXT,
  buildProjectEvidence,
  classifyError,
  describeAsset,
  describeLocation,
  discoverPaths,
  indexProject,
  mediaTypeFor,
};

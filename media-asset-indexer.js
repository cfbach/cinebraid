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

/* The entity list each flat media directory belongs to. `audio/` is deliberately
   absent: describeLocation gives it no entityList, so it never reaches the entity
   arm at all. */
const ENTITY_LIST_FOR_DIR = { anchors: "characters", plates: "locations", props: "props", vehicles: "vehicles" };

/* Two project records claiming one file. Recorded rather than resolved: a legacy
   owner CineBraid cannot prove is left unresolved, because a wrong owner written
   once propagates into everything downstream and looks exactly like a right one. */
const AMBIGUOUS = Symbol("ambiguous-legacy-link");

/* Where a `P.mediaAssets[]` row's bytes actually live, project-relative.
   `storagePath` is what fal-generation.js writes for every blocking asset
   (fal-generation.js:865); the `media/<file>` fallback is server.js's own
   convention for a row that predates it (server.js:4964, :5656, :5762). A `file`
   that is not a bare name matches no convention, so it resolves to nothing and
   links to nothing. */
function libraryStoragePath(asset) {
  const stored = String(asset.storagePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (stored) return stored;
  const file = String(asset.file || "").replace(/\\/g, "/");
  if (!file || file.includes("/")) return "";
  return `media/${file}`;
}

/* An index of what project.json already says, built once per pass. Read-only:
   nothing in this module writes a project record, and the ledger is allowed to
   know about legacy rows without those rows knowing about the ledger.

   EVERY KEY HERE IS A PATH, NEVER A BARE FILENAME. A basename is not identity —
   `anchors/take.png` and `props/take.png` are two files, and CHAR-RHEA's candidate
   row is not evidence about a prop that happens to share its name. Keying any of
   these maps by basename is how an asset acquires an owner nothing proved. */
function buildProjectEvidence(project) {
  const shotRows = new Map();        /* "<shotId>/<file>" -> candidate row */
  const shotWinners = new Map();     /* shotId -> [live pointer filenames] */
  const entityRows = new Map();      /* "<list>/<file>" -> {row, entityId, list} | AMBIGUOUS */
  const entityPointers = new Map();  /* list -> [live pointer filenames] */
  const entityOwnPointers = new Map(); /* "<list>/<entityId>" -> [that entity's pointers] */
  const libraryByPath = new Map();   /* project-relative path -> P.mediaAssets[] entry | AMBIGUOUS */
  const libraryByShotFile = new Map(); /* "<shotId>/<file>" -> pathless entry | AMBIGUOUS */
  const activeLibraryIds = new Set();  /* library asset ids currently acting as a blocking guide */

  if (!project || typeof project !== "object") {
    return {
      shotRows, shotWinners, entityRows, entityPointers, entityOwnPointers,
      libraryByPath, libraryByShotFile, activeLibraryIds,
    };
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
      const own = [];
      if (entity.approvedFile) own.push(entity.approvedFile);
      for (const state of Array.isArray(entity.continuityStates) ? entity.continuityStates : [])
        if (state && state.approvedFile) own.push(state.approvedFile);
      for (const group of ["coverageSlots", "expressionSlots"])
        for (const slot of Array.isArray(entity[group]) ? entity[group] : [])
          if (slot && slot.approvedFile) own.push(slot.approvedFile);
      pointers.push(...own);
      if (entity.id) entityOwnPointers.set(`${list}/${entity.id}`, own.filter(Boolean));
      /* Entity rows keep their own decision vocabulary. They are never routed
         through candidateRecord(), which would coerce it to "unreviewed". */
      for (const row of Array.isArray(entity.candidateFiles) ? entity.candidateFiles : []) {
        const key = row && (row.stored || row.name || row.original);
        if (!key) continue;
        const scoped = `${list}/${key}`;
        const held = entityRows.get(scoped);
        /* Two entities in one list naming the same file. A Map would silently keep
           whichever was parsed last, handing one entity's history to another's
           bytes; instead the key is poisoned and neither is linked. A second row on
           the SAME entity is not a conflict — it is one owner listing a file twice. */
        if (held) {
          if (held !== AMBIGUOUS && held.entityId !== entity.id) entityRows.set(scoped, AMBIGUOUS);
          continue;
        }
        entityRows.set(scoped, { row, entityId: entity.id, list });
      }
    }
    entityPointers.set(list, pointers.filter(Boolean));
  }

  for (const shot of Array.isArray(project.shots) ? project.shots : []) {
    const activeId = shot?.creationBrief?.activeBlockingAssetId;
    if (activeId) activeLibraryIds.add(activeId);
  }
  for (const asset of Array.isArray(project.mediaAssets) ? project.mediaAssets : []) {
    if (!asset) continue;
    const links = Array.isArray(asset.links) ? asset.links : [];
    if (asset.id && links.some((link) => link && link.blockingState === "active")) activeLibraryIds.add(asset.id);

    const storagePath = libraryStoragePath(asset);
    if (storagePath) {
      /* Two library rows resolving to one path cannot both own it, and picking is
         what puts SH010's generation record on SH020's blocking frame. */
      if (libraryByPath.has(storagePath) && libraryByPath.get(storagePath) !== asset) libraryByPath.set(storagePath, AMBIGUOUS);
      else libraryByPath.set(storagePath, asset);
    }

    /* A row written before `storagePath` existed still proves which shot it belongs
       to, through its own link. Shot id plus filename is the same evidence shape
       shotRows already uses, and unlike a bare basename it cannot reach across
       shots. Rows that DO carry a storagePath are excluded — their path is the
       better evidence, and admitting both would let a mismatched pair collide. */
    const file = String(asset.file || "");
    if (!asset.storagePath && file && !file.includes("/") && !file.includes("\\")) {
      for (const link of links) {
        if (!link || link.targetType !== "shot" || !link.targetId) continue;
        const key = `${link.targetId}/${file}`;
        if (libraryByShotFile.has(key) && libraryByShotFile.get(key) !== asset) libraryByShotFile.set(key, AMBIGUOUS);
        else libraryByShotFile.set(key, asset);
      }
    }
  }

  return {
    shotRows, shotWinners, entityRows, entityPointers, entityOwnPointers,
    libraryByPath, libraryByShotFile, activeLibraryIds,
  };
}

/* The library row that provably describes THIS file, or nothing. Path first,
   because it is the stronger evidence; the shot-scoped fallback exists only for
   rows that carry no path at all. */
function libraryEntryFor(evidence, relativePath, shotId, file) {
  const byPath = evidence.libraryByPath.get(relativePath);
  if (byPath && byPath !== AMBIGUOUS) return { entry: byPath, ambiguous: false };
  if (byPath === AMBIGUOUS) return { entry: null, ambiguous: true };
  if (!shotId) return { entry: null, ambiguous: false };
  const byShot = evidence.libraryByShotFile.get(`${shotId}/${file}`);
  if (byShot && byShot !== AMBIGUOUS) return { entry: byShot, ambiguous: false };
  return { entry: null, ambiguous: byShot === AMBIGUOUS };
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
  /* Named rather than silently dropped: an ambiguous link is a fact about this
     asset, and a reader that cannot tell "no record" from "more than one record"
     will eventually resolve it by guessing. */
  const unresolved = [];

  if (location.scope.shotId) {
    const row = evidence.shotRows.get(`${location.scope.shotId}/${file}`);
    const winners = evidence.shotWinners.get(location.scope.shotId) || [];
    if (location.dir === "blocking") {
      role = "blocking-guide";
      const library = libraryEntryFor(evidence, relativePath, location.scope.shotId, file);
      if (library.entry) legacy.libraryAssetId = library.entry.id || null;
      if (library.ambiguous) unresolved.push("project.mediaAssets");
      /* Active is read off the row we PROVED owns this file, never off a name.
         An active guide in one shot must not mark a same-named file in another. */
      lifecycle = deriveLifecycle(row || { stored: file }, {
        dialect: "library-entry",
        key: file,
        active: Boolean(library.entry && library.entry.id && evidence.activeLibraryIds.has(library.entry.id)),
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
    /* Scoped to the list this DIRECTORY implies. An unscoped basename lookup let a
       characters row own `props/RHEA.png`, because the two files share a name — the
       exact false ownership the ledger exists to make impossible. */
    const list = ENTITY_LIST_FOR_DIR[location.dir] || location.dir;
    const held = evidence.entityRows.get(`${list}/${file}`);
    const match = held && held !== AMBIGUOUS ? held : null;
    if (held === AMBIGUOUS) unresolved.push("entity.candidateFiles");
    /* An owner we can prove narrows the question to that entity's own pointers.
       Falling back to every pointer in the list is only correct when no row claims
       the file, and using it anyway is how one character's approval marks another's
       same-named reference approved. */
    const pointers = (match && match.entityId
      ? evidence.entityOwnPointers.get(`${list}/${match.entityId}`)
      : evidence.entityPointers.get(list)) || [];
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
    const library = libraryEntryFor(evidence, relativePath, "", file);
    if (library.entry) {
      legacy.libraryAssetId = library.entry.id || null;
      source = library.entry.generationRecord ? "generated" : "uploaded";
    }
    if (library.ambiguous) unresolved.push("project.mediaAssets");
  }

  if (unresolved.length) legacy.unresolved = unresolved;
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
          stats.unavailable += 1;
          /* Re-stamping a row that already says `unavailable` rewrites the whole
             ledger on every pass for as long as the file stays locked. While the
             ledger was inert that cost nothing; now that a pass runs whenever a
             project is opened it is unbounded churn on a synced root, and it makes
             "an unchanged scan changes nothing" false. */
          if (existing.hashState !== "unavailable") {
            Object.assign(existing, markUnavailable(existing), { indexedAt: now() });
            changed = true;
          }
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
  AMBIGUOUS,
  DEFAULT_CHUNK_SIZE,
  ENTITY_LIST_FOR_DIR,
  FLAT_MEDIA_DIRS,
  IndexRootUnreadableError,
  LedgerUnreadableError,
  MEDIA_EXT,
  SHOT_MEDIA_DIRS,
  buildProjectEvidence,
  classifyError,
  describeAsset,
  describeLocation,
  discoverPaths,
  indexProject,
  libraryStoragePath,
  mediaTypeFor,
};

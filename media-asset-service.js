/* CineBraid MediaAsset activation — the one place the ledger meets the product.
 *
 * P4-SEM-C1. Until now `media-assets.js`, `media-asset-store.js`,
 * `media-asset-indexer.js` and `media-asset-verify.js` were complete and switched
 * off, and `tests/media-asset-inertness.js` mechanically forbade any production
 * module from reaching them. That was the right default while the semantics were
 * unratified. It is no longer, because every downstream fact — which file an
 * approval approved, which candidate a review reviewed, which bytes a job
 * delivered — is currently keyed by a filename that the approval flow itself
 * rewrites.
 *
 * WHAT REPLACED THE INERTNESS RULE. Not "anything may now call the ledger". This
 * module is the only production importer of the four, and the only production
 * caller of readLedger/writeLedger/indexProject/verifyAssets;
 * tests/media-asset-activation-boundary.js pins exactly that. Narrowing the ledger
 * to one owner is what keeps activation reviewable: there is a single answer to
 * "when does the ledger change, and who changed it".
 *
 * WHAT THIS OWNS, AND WHY EACH BELONGS HERE RATHER THAN IN A ROUTE:
 *
 *   Containment.     A project directory is derived from projectsRoot + slug and
 *                    proven to be a direct child. The service cannot be pointed
 *                    outside the projects root even by a caller that wants to.
 *   Serialisation.   indexProject and verifyAssets both do read -> mutate ->
 *                    writeLedgerSync across an await, and neither takes the store's
 *                    write chain. Two overlapping passes would lose rows. Exactly
 *                    one pass runs per project at a time, here.
 *   Coalescing.      A burst of opens and scans collapses into one pass plus at
 *                    most one follow-up, instead of a queue of duplicates.
 *   Throttling.      /api/scan is called after every mutation. A pass that ran a
 *                    moment ago is not run again.
 *   Containment of failure. A pass never throws into a request and never rejects.
 *                    An unreadable ledger, an unreadable root or an unreadable
 *                    project.json records a diagnostic and changes nothing.
 *
 * THE BYTE-READ POLICY, which is the whole safety argument:
 *
 *   A FIRST pass on a project with no ledger is a BACKFILL and reads ZERO media
 *   bytes. Every file gets a durable assetId from stat alone. This preserves
 *   media-asset-indexer.js's founding constraint exactly — a project may sit in a
 *   OneDrive/Dropbox/Drive folder where reading a file downloads it, and Node
 *   cannot even detect a placeholder — so opening a large production can never
 *   pull its corpus over the network.
 *
 *   Once a ledger exists a pass is INCREMENTAL, and verifies only what the
 *   stat-only pass produced evidence about: rows whose size or mtime drifted
 *   (possible byte replacement) and rows that appeared since the last pass
 *   (new arrivals, which is how a file acquires byte identity while it still
 *   exists). Both are bounded by the number of CHANGES, not by corpus size, and
 *   capped again by file count and total bytes. A pass over an unchanged project
 *   reads nothing and writes nothing.
 *
 *   The honest consequence: media that was present at backfill time carries no
 *   digest until something verifies it, so renaming it cannot be PROVEN to be the
 *   same media and it correctly acquires a new identity rather than a guessed
 *   link. Missing linkage is preferable to false linkage. `verifyNow` exists for a
 *   caller that wants to pay for the proof deliberately.
 *
 * WHAT THIS DOES NOT DO. It does not read or write project.json — it is handed the
 * document, or reads it read-only for evidence. It does not touch approval
 * pointers, candidate rows, job records or any filename semantics; carrying
 * assetId into those is P4-SEM-C2. Nothing here is authoritative for approval.
 */

const fs = require("fs");
const path = require("path");

const { MEDIA_ASSETS_FILE } = require("./media-assets");
const { LedgerUnreadableError, ledgerPath, readLedger } = require("./media-asset-store");
const { IndexRootUnreadableError, indexProject } = require("./media-asset-indexer");
const { verifyAssets } = require("./media-asset-verify");

/* A pass that just ran is not run again. /api/scan fires after most mutations, so
   without this a busy session would re-stat the corpus continuously. */
const DEFAULT_THROTTLE_MS = 15000;
/* Deliberately the verifier's own defaults, halved on bytes. A pass is allowed to
   read a handful of files that changed; it is never allowed to warm a corpus. */
const VERIFY_FILE_LIMIT = 25;
const VERIFY_BYTE_LIMIT = 64 * 1024 * 1024;

/* Reasons that mean "the user just moved", and so bypass the throttle. */
const URGENT_REASONS = new Set(["switch", "explicit"]);

const RUNTIME = new Map();   /* resolved project dir -> pass state */

function nowIso() {
  return new Date().toISOString();
}

/* Containment, proven by path semantics rather than string prefix — the same rule
   server.js applies to activeProject, restated here because this module must be
   safe independently of who calls it. A slug is one path segment below the root,
   and nothing else is a project. */
function resolveProjectDir(projectsRoot, slug) {
  const root = String(projectsRoot || "").trim();
  const name = String(slug || "").trim();
  if (!root || !name) return "";
  if (name !== path.basename(name)) return "";
  const base = path.resolve(root);
  const target = path.resolve(base, name);
  const rel = path.relative(base, target);
  if (!rel || path.isAbsolute(rel)) return "";
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || rel.startsWith("../")) return "";
  if (rel.split(/[\\/]/).length !== 1) return "";
  return target;
}

function stateFor(projectDir, slug) {
  let state = RUNTIME.get(projectDir);
  if (!state) {
    state = {
      slug,
      projectDir,
      running: null,
      queued: false,
      queuedReason: "",
      lastOptions: null,
      lastActivityAt: 0,
      passes: 0,
      throttled: 0,
      lastResult: null,
      lastError: null,
    };
    RUNTIME.set(projectDir, state);
  }
  return state;
}

/* Read-only, and tolerant of the same BOM every other CineBraid JSON reader
   tolerates. Nothing in this module ever writes project.json. */
function readProjectDocument(projectDir) {
  const raw = fs.readFileSync(path.join(projectDir, "project.json"), "utf8");
  const parsed = JSON.parse(String(raw).replace(/^﻿/, ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("project.json is not a project document.");
  return parsed;
}

/* Which files this pass earned the right to open.

   `needsVerify` is the indexer saying "size or mtime moved under a path I already
   knew", which is the only evidence that could mean the bytes were replaced. A
   path that appeared since the last pass is a new arrival, and hashing it now is
   what lets a LATER rename be recognised as the same media — a digest can only be
   compared against one that was captured while the file still existed.

   On a first pass `ledgerExisted` is false and `known` is empty, so the second
   arm is skipped entirely and a backfill reads nothing. That asymmetry is the
   cloud-sync guarantee, and it is the reason this function takes both. */
function chooseVerificationTargets(assets, known, ledgerExisted) {
  const drifted = [];
  const arrived = [];
  for (const asset of assets) {
    const relativePath = asset && asset.storage && asset.storage.path;
    if (!relativePath || asset.storage.missing === true) continue;
    if (asset.needsVerify === true) { drifted.push(relativePath); continue; }
    if (!ledgerExisted) continue;
    if (!known.has(relativePath) && asset.hashState === "unhashed") arrived.push(relativePath);
  }
  /* Drift first: a replaced file is a correctness question, a new file is only an
     opportunity to record identity earlier. */
  return [...drifted, ...arrived];
}

async function runPass(state, options) {
  const { projectDir, slug, reason, activeSlug, now } = options;
  const startedAt = nowIso();
  const started = Date.now();
  state.passes += 1;
  state.lastActivityAt = started;

  const record = {
    slug,
    reason,
    startedAt,
    finishedAt: "",
    status: "",
    indexed: null,
    verified: null,
    verificationDeferred: 0,
    ledgerExisted: false,
    warning: "",
  };

  /* The ledger BEFORE the pass, for two reasons: an unreadable one must abort
     here rather than half-way through, and the set of paths it already knows is
     what separates a new arrival from a backfilled one. */
  let known = new Set();
  try {
    const before = readLedger(projectDir);
    record.ledgerExisted = before.exists;
    record.warning = before.warning || "";
    if (before.readOnly) {
      record.status = "skipped";
      record.reasonDetail = "ledger-newer-than-build";
      return record;
    }
    for (const asset of before.ledger.assets)
      if (asset && asset.storage && asset.storage.path) known.add(asset.storage.path);
  } catch (error) {
    /* LedgerUnreadableError. Deliberately not softened: indexing from an assumed
       empty ledger would re-mint an assetId for every file and discard every
       relationship built on the old ones. */
    record.status = "failed";
    record.error = { code: error?.code || "LEDGER_UNREADABLE", message: String(error?.message || error) };
    return record;
  }

  /* Evidence, or no pass at all. describeAsset's role, lifecycle, scope and legacy
     fields are written once, when a row is minted, and reuse never re-derives
     them — so indexing without project.json would freeze "unknown / candidate /
     no owner" onto every file permanently because of a momentary read failure.
     Skipping and trying again on the next activation costs nothing. */
  let project;
  try {
    project = options.project || readProjectDocument(projectDir);
  } catch (error) {
    record.status = "skipped";
    record.reasonDetail = error?.code === "ENOENT" ? "no-project-document" : "project-unreadable";
    record.error = { code: error?.code || "PROJECT_UNREADABLE", message: String(error?.message || error) };
    return record;
  }

  try {
    /* chunkSize is forwarded, not defaulted here: it is what decides how often the
       pass re-checks that this project is still the active one, so a caller that
       wants a tighter switch guard must be able to ask for one. */
    record.indexed = await indexProject({ projectDir, slug, project, activeSlug, now, chunkSize: options.chunkSize });
  } catch (error) {
    record.status = "failed";
    record.error = {
      code: error?.code || (error instanceof IndexRootUnreadableError ? "INDEX_ROOT_UNREADABLE" : "INDEX_FAILED"),
      message: String(error?.message || error),
    };
    return record;
  }

  if (record.indexed.status !== "complete") {
    /* aborted-project-switch, or the store refused. Whatever the pass established
       is already persisted to the project it started on; verification of a project
       the user has left is not something to spend a byte read on. */
    record.status = record.indexed.status;
    record.finishedAt = nowIso();
    record.durationMs = Date.now() - started;
    return record;
  }

  if (options.verify !== false && (!activeSlug || activeSlug() === slug)) {
    try {
      const after = readLedger(projectDir);
      if (after.exists && !after.readOnly) {
        const targets = chooseVerificationTargets(after.ledger.assets, known, record.ledgerExisted);
        const limit = Number(options.verifyLimit) > 0 ? Number(options.verifyLimit) : VERIFY_FILE_LIMIT;
        const taken = targets.slice(0, limit);
        /* Never a silent cap: what was left for the next pass is reported. */
        record.verificationDeferred = targets.length - taken.length;
        if (taken.length) {
          record.verified = await verifyAssets({
            projectDir,
            paths: taken,
            limit,
            maxBytes: Number(options.verifyMaxBytes) > 0 ? Number(options.verifyMaxBytes) : VERIFY_BYTE_LIMIT,
            now,
          });
        }
      }
    } catch (error) {
      /* Verification is an optimisation over identity, never a precondition for
         it. The index already succeeded and its ids are on disk. */
      record.verifyError = { code: error?.code || "VERIFY_FAILED", message: String(error?.message || error) };
    }
  }

  record.status = "complete";
  record.finishedAt = nowIso();
  record.durationMs = Date.now() - started;
  return record;
}

/* THE ENTRY POINT. Schedules a pass for the project that just became active, or
   whose media was just re-enumerated.

   Never throws and never rejects, so a caller may fire it and forget it. Returns
   a promise for callers that want to wait — tests, and any future explicit
   route — which resolves to the pass record. */
function activateProject(options = {}) {
  const slug = String(options.slug || "").trim();
  const projectDir = resolveProjectDir(options.projectsRoot, slug);
  if (!projectDir) return Promise.resolve({ status: "skipped", reasonDetail: "no-contained-project", slug });
  if (!fs.existsSync(projectDir)) return Promise.resolve({ status: "skipped", reasonDetail: "no-project-directory", slug });

  const reason = String(options.reason || "open");
  const state = stateFor(projectDir, slug);
  const throttleMs = Number.isFinite(Number(options.throttleMs)) ? Number(options.throttleMs) : DEFAULT_THROTTLE_MS;

  if (!URGENT_REASONS.has(reason) && throttleMs > 0 && Date.now() - state.lastActivityAt < throttleMs) {
    state.throttled += 1;
    return state.running || Promise.resolve(state.lastResult || { status: "throttled", slug });
  }

  const passOptions = { ...options, projectDir, slug, reason };
  /* Recorded BEFORE the slot is examined, because the branch below returns early:
     whoever ends up holding the slot needs these to replay the follow-up, and a
     request that parked itself and left nothing behind is a dropped pass. The
     document is dropped deliberately — a replay re-reads project.json rather than
     reusing one that was current a pass ago. */
  state.lastOptions = { ...passOptions, project: null };

  /* One pass at a time per project. A request arriving mid-pass asks for a
     follow-up rather than a second concurrent writer. */
  if (state.running) {
    state.queued = true;
    state.queuedReason = reason;
    return state.running;
  }

  const run = (async () => {
    let current = passOptions;
    let record = null;
    for (;;) {
      record = await runPass(state, current);
      state.lastResult = record;
      state.lastError = record.error || record.verifyError || null;
      state.lastActivityAt = Date.now();
      if (!state.queued) break;
      state.queued = false;
      /* A follow-up re-reads project.json rather than reusing a document that was
         current one pass ago. */
      current = { ...passOptions, reason: state.queuedReason || "open", project: null };
    }
    return record;
  })().catch((error) => {
    /* Belt and braces: runPass contains its own failures, so reaching here means a
       programming error, and it still must not become an unhandled rejection in a
       request handler that did not await. */
    const record = { status: "failed", slug, error: { code: "ACTIVATION_FAILED", message: String(error?.message || error) } };
    state.lastResult = record;
    state.lastError = record.error;
    return record;
  });

  state.running = run;
  run.then(() => { if (state.running === run) state.running = null; });
  return run;
}

/* Deliberate, bounded, caller-named byte reads. Not wired to any route in C1;
   this is the escalation path for a caller that wants a digest badly enough to
   pay for it, and it is what the rename proofs use to establish byte identity
   before renaming. */
async function verifyNow(options = {}) {
  const slug = String(options.slug || "").trim();
  const projectDir = resolveProjectDir(options.projectsRoot, slug);
  if (!projectDir) throw new Error("verifyNow needs a project inside the projects root.");
  const state = stateFor(projectDir, slug);
  while (state.running) await state.running;

  const loaded = readLedger(projectDir);
  if (!loaded.exists) return { status: "skipped", reason: "no-ledger", verified: 0, wrote: false };
  const paths = Array.isArray(options.paths) && options.paths.length
    ? options.paths
    : loaded.ledger.assets
      .filter((asset) => asset && asset.storage && asset.storage.path && asset.storage.missing !== true)
      .map((asset) => asset.storage.path);
  if (!paths.length) return { status: "skipped", reason: "no-targets", verified: 0, wrote: false };

  const run = verifyAssets({
    projectDir,
    paths,
    limit: Number(options.limit) > 0 ? Number(options.limit) : paths.length,
    maxBytes: Number(options.maxBytes) > 0 ? Number(options.maxBytes) : VERIFY_BYTE_LIMIT,
    now: options.now,
  });
  /* Held on the same per-project slot as a pass, so an activation cannot start
     writing the ledger underneath a verification. */
  state.running = run.then(() => null, () => null);
  try {
    return await run;
  } finally {
    state.running = null;
    /* An activation that arrived mid-verification parked itself on the slot, and
       this function runs no follow-up loop of its own — so without this the pass
       would be dropped silently rather than merely delayed. */
    if (state.queued && state.lastOptions) {
      state.queued = false;
      activateProject({ ...state.lastOptions, throttleMs: 0 });
    }
  }
}

/* Read-only projection of the ledger. Propagates LedgerUnreadableError rather
   than reporting an empty media library — a corrupt ledger read as "no assets" is
   the failure mode media-asset-store.js was written to refuse. */
function readAssets(projectsRoot, slug) {
  const projectDir = resolveProjectDir(projectsRoot, slug);
  if (!projectDir) return { exists: false, assets: [], warning: "", readOnly: false, path: "" };
  const loaded = readLedger(projectDir);
  return {
    exists: loaded.exists,
    assets: loaded.ledger.assets,
    warning: loaded.warning,
    recovered: loaded.recovered,
    readOnly: loaded.readOnly,
    path: ledgerPath(projectDir),
  };
}

/* What activation has actually done, for diagnostics and for tests. */
function activationStatus(projectsRoot, slug) {
  const projectDir = resolveProjectDir(projectsRoot, slug);
  const state = projectDir ? RUNTIME.get(projectDir) : null;
  if (!state) return { slug, passes: 0, throttled: 0, running: false, lastResult: null, lastError: null };
  return {
    slug: state.slug,
    passes: state.passes,
    throttled: state.throttled,
    running: Boolean(state.running),
    lastResult: state.lastResult,
    lastError: state.lastError,
  };
}

/* Forgets scheduling state only. It never touches a ledger on disk, so a project
   reset here simply re-earns its next pass. */
function resetActivationState() {
  RUNTIME.clear();
}

module.exports = {
  DEFAULT_THROTTLE_MS,
  LedgerUnreadableError,
  MEDIA_ASSETS_FILE,
  VERIFY_BYTE_LIMIT,
  VERIFY_FILE_LIMIT,
  activateProject,
  activationStatus,
  chooseVerificationTargets,
  readAssets,
  resetActivationState,
  resolveProjectDir,
  verifyNow,
};

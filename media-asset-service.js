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

/* Reasons that bypass the throttle: the user just moved, or the filesystem
   provably just changed. Collapsing a rename into the scan throttle would leave a
   reconciled move waiting on the next unthrottled request for no reason. */
const URGENT_REASONS = new Set(["switch", "explicit", "rename"]);

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

/* Windows realpath casing is not stable enough to compare raw, and a case-sensitive
   equality test on `C:\Films\Film-B` vs `C:\films\film-b` would refuse a legitimate
   project. server.js settles the same question the same way at insideRealDirectory(). */
function samePhysicalPath(left, right) {
  const normalise = (value) => (process.platform === "win32" ? String(value).toLowerCase() : String(value));
  return path.resolve(normalise(left)) === path.resolve(normalise(right));
}

/* P1 — PHYSICAL project-directory containment. THE resolver every local-file
 * affordance goes through, and the one that has to run BEFORE the ledger is read.
 *
 * WHY resolveProjectDir() ABOVE IS NOT ENOUGH, and why that is not a criticism of
 * it. That function proves a slug is one segment below the projects root BY PATH
 * SEMANTICS, which is exactly the right rule for a NAME: it stops `..`, a drive
 * letter, a UNC share and a nested path from being spelled as a project. It says
 * nothing about what the directory that name refers to actually IS, because until
 * now nothing needed it to — the ledger passes it owns are scoped to whatever
 * `projects/<slug>` resolves to, and that is the project by definition.
 *
 * A FILE ACTION BREAKS THAT ASSUMPTION. `projects/film-b` can be a junction. Every
 * lexical test passes — the string plainly is one segment under the root — and the
 * directory it names is `projects/film-a`, or somewhere outside the root entirely.
 * The seam then reads FILM A'S LEDGER while the request says `film-b`, hands back
 * Film A's absolute path, and opens Explorer on it. Measured on Windows 11, not
 * theorised: both cases resolved `available` before this function existed.
 *
 * THE INVARIANT, stated so a future change has to argue with it:
 *
 *     A PROJECT SLUG IDENTIFIES ITS OWN PHYSICAL DIRECTORY UNDERNEATH THE
 *     AUTHORITATIVE PROJECTS ROOT. A REPARSE POINT AT THE PROJECT-ROOT BOUNDARY
 *     MUST NOT REDIRECT THAT IDENTITY.
 *
 * "Still somewhere under projects" is deliberately NOT the test. `film-b` pointing
 * at `film-a` never leaves the root and is precisely the cross-project failure this
 * exists to stop, so the requirement is EQUALITY with this slug's own canonical
 * location — not containment within the root.
 *
 * The root itself may be a link, and that is untouched: a workspace on `D:` reached
 * through `C:\CineBraid\Projects` canonicalises the ROOT first and every project
 * under it compares equal. Only the project boundary is pinned.
 *
 * Returns { ok, dir, realDir, realRoot, reason }. `dir` is the configured-root
 * spelling, for display and for launching; `realDir` is the physical directory,
 * which is what containment for anything INSIDE the project is then measured
 * against. It never throws: an unreadable root or a vanished project is a refusal
 * with a named reason, never an exception into a request. */
function resolvePhysicalProjectDir(projectsRoot, slug) {
  const refuse = (reason) => ({ ok: false, dir: "", realDir: "", realRoot: "", reason });

  /* 1. The existing one-segment project identity, unchanged and still first. */
  const dir = resolveProjectDir(projectsRoot, slug);
  if (!dir) return refuse("no-contained-project");
  const name = String(slug || "").trim();

  /* 2. The AUTHORITATIVE root, canonicalised once. Everything below is measured
        against this rather than against the configured spelling. */
  let realRoot;
  try {
    realRoot = fs.realpathSync.native(path.resolve(String(projectsRoot)));
  } catch {
    return refuse("no-projects-root");
  }

  /* 3. Where this slug's directory must physically be. */
  const expected = path.join(realRoot, name);

  /* 4 + 5. It must be there, be a directory, and not be a redirect. lstat does not
        follow the LAST component, which is the whole point: a junction reports as a
        symbolic link on Windows (server.js direntKind() says so at its own
        declaration), so this is where a reparse point at the boundary is named. */
  let entry;
  try {
    entry = fs.lstatSync(dir);
  } catch {
    return refuse("no-project-directory");
  }
  if (entry.isSymbolicLink()) return refuse("project-root-redirected");
  if (!entry.isDirectory()) return refuse("not-a-directory");

  /* 6. The physical directory. */
  let realDir;
  try {
    realDir = fs.realpathSync.native(dir);
  } catch {
    return refuse("no-project-directory");
  }

  /* 7. And it must be THIS slug's own directory. Checked independently of step 5
        rather than as a formality: a redirect introduced between the lstat and the
        realpath, or a form of reparse point lstat does not flag, still fails here,
        and this is the assertion that actually encodes the invariant. */
  if (!samePhysicalPath(realDir, expected)) return refuse("project-root-redirected");

  return { ok: true, dir, realDir, realRoot, reason: "" };
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

/* Which files this pass earned the right to open, in priority order.

   THREE TIERS, and the order between them is the policy:

     drifted   `needsVerify` — the indexer saying "size or mtime moved under a path
               I already knew". The only evidence that could mean the bytes were
               replaced, so it is a correctness question and goes first.
     arrived   a path that appeared since the last pass. Hashing it now is what
               lets a LATER rename be recognised as the same media, because a
               digest can only be compared against one captured while the file
               still existed.
     backlog   a present row that has never been hashed. This is the tier that
               makes the identity of media which pre-dates activation converge.

   The backlog tier is not optional, and leaving it out was a real defect. Without
   it, every file that existed when CineBraid first indexed a project stayed
   `contentHash: null` for ever unless something called verifyNow — and nothing
   did. "A same-byte rename preserves assetId" was then true only for media that
   arrived AFTER activation, which is not a guarantee worth making.

   What is preserved is the reason the indexer refuses to hash: on a FIRST pass
   `ledgerExisted` is false, so both later tiers are skipped entirely and opening a
   project CineBraid has never indexed still reads zero media bytes. Convergence
   starts on the pass after that, bounded by count and bytes, off the request
   path. A large production therefore opens instantly and becomes byte-anchored
   over the following minutes of ordinary use rather than in one stall. */
function chooseVerificationTargets(assets, known, ledgerExisted) {
  const drifted = [];
  const arrived = [];
  const backlog = [];
  for (const asset of assets) {
    const relativePath = asset && asset.storage && asset.storage.path;
    if (!relativePath || asset.storage.missing === true) continue;
    if (asset.needsVerify === true) { drifted.push(relativePath); continue; }
    if (!ledgerExisted) continue;
    if (asset.hashState !== "unhashed" || asset.contentHash) continue;
    if (known.has(relativePath)) backlog.push(relativePath);
    else arrived.push(relativePath);
  }
  return [...drifted, ...arrived, ...backlog];
}

/* Rows that are present and still carry no proven digest. Reported on every pass
   so convergence is observable rather than assumed. */
function countUnverified(assets) {
  let count = 0;
  for (const asset of assets) {
    if (!asset || !asset.storage || !asset.storage.path) continue;
    if (asset.storage.missing === true) continue;
    if (asset.hashState !== "unhashed" || asset.contentHash) continue;
    count += 1;
  }
  return count;
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
        /* Read back rather than inferred: verification can also retire a row or
           mint a successor, so the only honest count is the one on disk. */
        record.unverifiedRemaining = countUnverified(readLedger(projectDir).ledger.assets);
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

/* THE RENAME ANCHOR. Called immediately BEFORE CineBraid itself moves a media
   file, which today is exactly one place: POST /api/media/rename, the route both
   approval paths go through (public/library-tools.js:333, :531).
 *
 * Why it has to be before, and why it has to be here. A rename is only provably
 * the same media if a digest was captured while the file still existed at the old
 * path. The backlog tier gets there eventually, but an approval can land on a file
 * the background pass has not reached yet — and the approval rename is precisely
 * the operation whose identity must survive. Anchoring one named file at the
 * moment of the rename closes that window without asking every caller to know
 * about the ledger: the route hands over a path, and this decides whether a digest
 * is owed.
 *
 * Cost is one file, on a deliberate human action, and nothing at all when the row
 * is already hashed. It reads no other file and it is not a whole-project pass.
 *
 * It never throws. A ledger that cannot be read, a path with no row, a file that
 * cannot be opened — all of them mean the rename proceeds unanchored, which is the
 * behaviour that existed before C1 rather than a new failure. Blocking a
 * director's approval because a sidecar was busy would be the wrong trade. */
async function anchorBeforeRename(options = {}) {
  const slug = String(options.slug || "").trim();
  const projectDir = resolveProjectDir(options.projectsRoot, slug);
  if (!projectDir) return { anchored: false, reason: "no-contained-project" };
  const relativePath = String(options.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relativePath) return { anchored: false, reason: "no-path" };

  const state = stateFor(projectDir, slug);
  try {
    /* A pass in flight is already writing this ledger. */
    while (state.running) await state.running;

    const loaded = readLedger(projectDir);
    if (!loaded.exists || loaded.readOnly) return { anchored: false, reason: "no-ledger" };
    const row = loaded.ledger.assets.find(
      (asset) => asset && asset.storage && asset.storage.path === relativePath && asset.storage.missing !== true,
    );
    if (!row) return { anchored: false, reason: "no-row" };
    if (row.contentHash) return { anchored: true, reason: "already-verified", assetId: row.assetId, contentHash: row.contentHash };

    const run = verifyAssets({ projectDir, paths: [relativePath], limit: 1, maxBytes: VERIFY_BYTE_LIMIT, now: options.now });
    state.running = run.then(() => null, () => null);
    try {
      await run;
    } finally {
      state.running = null;
    }
    const after = readLedger(projectDir).ledger.assets.find(
      (asset) => asset && asset.storage && asset.storage.path === relativePath && asset.storage.missing !== true,
    );
    return after && after.contentHash
      ? { anchored: true, reason: "verified", assetId: after.assetId, contentHash: after.contentHash }
      : { anchored: false, reason: "unreadable" };
  } catch (error) {
    return { anchored: false, reason: "failed", error: String(error?.message || error) };
  }
}

/* P4-SEM-C2 — the one way durable identity leaves this module.
 *
 * A read-only projection: project-relative path -> assetId, for every row that
 * currently names a file on disk. C1 kept identity entirely inside the ledger,
 * which meant nothing the browser wrote could carry it; C2 needs approvals to
 * record the id of what they approved, and an approval cannot record an id it
 * was never told.
 *
 * What this deliberately is NOT: it is not an authority, and it grants none. The
 * ledger still decides nothing about approval — the caller learns which id names
 * which file, and every semantic conclusion is drawn elsewhere. That keeps
 * media-assets.js's founding rule intact: a projection cannot corrupt what it
 * projects.
 *
 * Synchronous, because it is read on the scan path and a scan answers now. It
 * reads one small JSON file and no media bytes, so it cannot hydrate a
 * cloud-synced corpus — the constraint that shapes every other read here.
 *
 * It never throws. An unreadable or absent ledger yields an empty map, and every
 * caller must treat a missing id as the normal state rather than as an error:
 * that is exactly the state of every project that has not yet had a pass, and of
 * every file backfilled before its first verification.
 *
 * Rows marked `storage.missing` are skipped. Identity is retained for a file that
 * has disappeared — deliberately, so a later reappearance can be reconciled — but
 * a retained row must never answer for a path a live file now occupies. */
function identityIndex(options = {}) {
  const index = new Map();
  const projectDir = resolveProjectDir(options.projectsRoot, options.slug);
  if (!projectDir) return index;
  try {
    const loaded = readLedger(projectDir);
    if (!loaded.exists) return index;
    for (const asset of loaded.ledger.assets || []) {
      const storagePath = asset && asset.storage ? String(asset.storage.path || "") : "";
      if (!storagePath || asset.storage.missing === true) continue;
      if (!index.has(storagePath)) index.set(storagePath, asset.assetId);
    }
  } catch {
    /* LedgerUnreadableError and anything else. Identity is optional by contract,
       and a media listing must not fail because a sidecar is unreadable. */
  }
  return index;
}

/* LOCAL FILE AFFORDANCES V1 — the inverse projection: one durable assetId -> the
 * project-relative path the ledger recorded for it.
 *
 * WHY IT IS HERE rather than in the module that needs it. C1 made this file the
 * single production importer of the ledger and pinned that count at one
 * (tests/media-asset-activation-boundary.js). A file-reveal feature that read the
 * sidecar for itself would be a second answer to "who reads the ledger", which is
 * exactly the property activation was granted in exchange for. So the reveal seam
 * asks here, and the ledger stays behind one door.
 *
 * WHY IT IS NOT identityIndex() INVERTED. That projection SKIPS rows marked
 * `storage.missing`, deliberately, so a retained identity can never shadow a live
 * file at the same path. Inverting it would therefore answer "unknown" for exactly
 * the case this feature has to tell the truth about — a durable record whose file
 * has gone — and the surface would say "CineBraid cannot locate this" when the
 * honest answer is "the file is no longer at its recorded local path". The flag is
 * reported instead of filtered, and the caller decides.
 *
 * A PROJECTION, granting nothing. It reads, it cannot write, it reads no media
 * bytes, and it never throws: an unreadable or absent ledger answers `known:false`,
 * which is the normal state of every project that has not yet had a pass.
 *
 * P1 — IT RESOLVES ITS OWN DIRECTORY, PHYSICALLY, AND TAKES NO DIRECTORY FROM A
 * CALLER. Reading the ledger is the first thing that can go wrong: with a junction
 * at `projects/film-b`, `media-assets.json` read "under film-b" IS FILM A'S LEDGER,
 * so every id in it answers, and the cross-project separation is gone before any
 * path check runs. Accepting a pre-validated directory as an argument would move
 * that guarantee into whoever called — this function keeps it, so it cannot be
 * pointed at another project's ledger by any caller, including a future one. */
function assetLocation(options = {}) {
  const unknown = { known: false, path: "", missing: false };
  const assetId = String(options.assetId || "").trim();
  if (!assetId) return unknown;
  const resolved = resolvePhysicalProjectDir(options.projectsRoot, options.slug);
  if (!resolved.ok) return unknown;
  const projectDir = resolved.realDir;
  try {
    const loaded = readLedger(projectDir);
    if (!loaded.exists) return unknown;
    const row = (loaded.ledger.assets || []).find(
      (asset) => asset && String(asset.assetId || "") === assetId,
    );
    if (!row || !row.storage) return unknown;
    const storagePath = String(row.storage.path || "");
    if (!storagePath) return unknown;
    return { known: true, path: storagePath, missing: row.storage.missing === true };
  } catch {
    /* LedgerUnreadableError and anything else. A file action must not fail
       because a sidecar is busy; it degrades to "no durable identity here". */
    return unknown;
  }
}

/* Deliberate, bounded, caller-named byte reads. The escalation path for a caller
   that wants a digest badly enough to pay for it, and what the rename proofs use
   to establish byte identity before renaming. */
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
  anchorBeforeRename,
  assetLocation,
  chooseVerificationTargets,
  countUnverified,
  identityIndex,
  readAssets,
  resetActivationState,
  resolvePhysicalProjectDir,
  resolveProjectDir,
  verifyNow,
};

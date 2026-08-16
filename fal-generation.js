/* CineBraid v6.2 — optional server-side fal image generation.
   Manual copy/generate/return remains fully supported. */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAspectRatio, h3AspectSupport } = require("./public/shared-aspect");
const { readJobLedger, writeJobLedgerSync, JobLedgerUnreadableError } = require("./generation-job-store");
const { jobOutputsForRename, repairJobOutputIdentity } = require("./public/shared-media-disposition");
const { compileH3ExecutionPlan, planProvenance, H3ExecutionError } = require("./h3-execution");
const { serializeH3PlanForFal, H3BackendError, FAL_H3_BACKEND } = require("./fal-h3-backend");
const { compileImageExecutionPlan, imagePlanProvenance, ImageExecutionError, IMAGE_MODEL_ID } = require("./image-execution");
const { serializeImagePlanForFal, FalImageBackendError, FAL_IMAGE_BACKEND } = require("./fal-image-backend");
const { generationOptionsFor, generationConnections } = require("./generation-options");
const { generationBindingRecord, GenerationBindingError } = require("./generation-binding");
const { submissionAccounting } = require("./generation-cost");
const Lifecycle = require("./generation-lifecycle");
const FramePresence = require("./public/shared-frame-presence");

/* The request that takes delivery of the background-recovery notice says so here rather
   than in the URL. See the GET /api/generation/fal/jobs route for why. Lowercase because
   that is how Node presents an incoming header name. */
const CLAIM_RECOVERY_HEADER = "x-cinebraid-claim-recovery";

function registerFalGeneration(app, context) {
  const { readConfig, readProject, writeProject, activeSlug, projectDirForSlug } = context;

  /* ---- project ownership ----------------------------------------------------

     An asynchronous generation operation belongs permanently to the project it
     started for. Every path this module touches used to be derived from a
     zero-argument PROJECT_DIR()/readProject()/writeProject(), which resolve the
     GLOBALLY ACTIVE project at the moment they are called. A generation is a
     long chain of awaits — submit, poll, download, ingest — and the user is free
     to switch projects during it. When they did, the download landed in the new
     project's shots folder and the OLD project's whole document was written over
     the NEW project's project.json: project A's title, shots and characters
     replacing project B's, with A itself receiving nothing.

     Ownership is therefore captured ONCE, before the first await, and every
     later read, write and path is addressed through that captured record. The
     project switcher stays fully available; what changes is that switching can
     no longer redirect work that is already in flight. */
  function ownerForSlug(slug) {
    const { dir, file } = projectDirForSlug(slug);
    return { slug, dir, file };
  }
  function captureOwner() {
    const slug = activeSlug();
    if (!slug) throw new Error("No active project.");
    return ownerForSlug(slug);
  }
  /* The owner a job record already belongs to. A job is only ever handled
     through the project whose ledger it was found in, so this is the captured
     owner of the route that loaded it. */
  function ownerProject(owner) {
    return readProject(owner.slug);
  }
  function saveOwnerProject(owner, project) {
    return writeProject(project, owner.slug);
  }

  function now() { return new Date().toISOString(); }
  function uid(prefix = "fal-job") {
    return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  }
  function config() {
    const c = readConfig();
    const fal = c.generation?.fal || {};
    return {
      enabled: fal.enabled === true,
      apiKey: process.env.FAL_KEY || fal.apiKey || "",
      baseUrl: String(fal.baseUrl || "https://queue.fal.run").replace(/\/$/, ""),
      textModel: fal.textModel || "openai/gpt-image-2",
      editModel: fal.editModel || "openai/gpt-image-2/edit",
      blockingQuality: fal.blockingQuality || "low",
      frameQuality: fal.frameQuality || "high",
      blockingResolution: String(fal.blockingResolution || "1k").toLowerCase(),
      frameResolution: String(fal.frameResolution || "1k").toLowerCase(),
      blockingOutputs: clamp(fal.blockingOutputs, 2, 1, 4),
      frameOutputs: clamp(fal.frameOutputs, 2, 1, 4),
      maxConcurrent: clamp(fal.maxConcurrent, 1, 1, 2),
      requireConfirmation: fal.requireConfirmation !== false,
      estimatedCostPerImage: Math.max(0, Number(fal.estimatedCostPerImage) || 0),
      h3TextModel: fal.h3TextModel || "minimax/h3/text-to-video",
      h3ImageModel: fal.h3ImageModel || "minimax/h3/image-to-video",
      h3ReferenceModel: fal.h3ReferenceModel || "minimax/h3/reference-to-video",
      h3Resolution: ["768P", "2K"].includes(String(fal.h3Resolution || "2K").toUpperCase()) ? String(fal.h3Resolution || "2K").toUpperCase() : "2K",
    };
  }
  /* THE SAVED GENERATION DEFAULTS, resolved for one compiled image request.
     The one place the compiled still-image path turns Settings into the values a paid
     dialog opens at. A request that names a size or a quality keeps it — an explicit
     choice in the dialog always outranks the saved default — and a request that names
     neither gets what the filmmaker saved rather than whatever the model pack falls back
     to on its own.

     WHY IT LIVES HERE. The pre-C2b job route has always applied this rule (see the
     `quality`/`resolution` fields on the job record below); the compiled path shipped
     without it, so "Create frame" opened at the pack's own auto/smallest-at-this-ratio
     no matter what Settings said. This is that same rule, at the compiled path's two
     entry points, rather than a second settings system.

     The resolution stays a TIER. Turning "2k" into a pixel pair needs this shot's aspect
     ratio and this model's documented size list, and the model pack owns both. */
  function savedImageSettings(purpose, body) {
    const cfg = config();
    const blocking = String(purpose) === "blocking";
    return {
      resolution: String(body?.resolution || (blocking ? cfg.blockingResolution : cfg.frameResolution) || ""),
      quality: String(body?.quality || (blocking ? cfg.blockingQuality : cfg.frameQuality) || ""),
    };
  }
  function clamp(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  }
  /* Durable, owner-addressed ledger access. A missing ledger is an empty list;
     a CORRUPT ledger is a typed refusal, never an empty list. See
     generation-job-store.js for why that distinction is load-bearing. */
  function readJobs(owner) {
    return readJobLedger(owner.dir).jobs;
  }
  /* A refusal the user can act on, rather than a blank history. The message says
     which file is unreadable and that nothing was overwritten, because the
     recovery is manual: restore the `.bak`, or move the corrupt file aside. */
  function ledgerFailureStatus(error) {
    if (error instanceof JobLedgerUnreadableError) return error.status;
    return /No such project|Invalid project slug|No active project/.test(String(error?.message || "")) ? 404 : 500;
  }
  function ledgerFailurePayload(error) {
    if (error instanceof JobLedgerUnreadableError)
      return { error: error.message, code: error.code, detail: error.detail };
    return { error: error?.message || "Could not read generation jobs." };
  }

  /* ---- one commit turn per project ------------------------------------------

     Every generation-job mutation used to follow the shape

         const jobs = readJobs();      // snapshot
         ... await provider ...        // seconds of network
         writeJobs(jobs);              // snapshot wins

     so any job created or advanced by an overlapping request during the await
     was erased by whichever snapshot was written last. A refresh that had
     already downloaded and ingested its images could be rolled back to
     IN_QUEUE, losing `ingestedAt` and inviting a second paid ingest of the same
     result.

     `commit` serialises mutations per project and RE-READS the durable ledger
     inside its own turn, so a mutation always applies to current state rather
     than to what the request saw minutes ago. Provider I/O happens outside the
     turn; `mutate` is synchronous by contract and must not await. */
  const commitChains = new Map();
  function commit(owner, mutate) {
    const key = owner.dir;
    const previous = commitChains.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => {
      const jobs = readJobs(owner);
      const result = mutate(jobs);
      writeJobLedgerSync(owner.dir, jobs);
      return result;
    });
    commitChains.set(key, next.catch(() => {}));
    return next;
  }

  /* P4-SEM-C4 — the job record follows the bytes it delivered.
   *
   * THE ONE WRITER of durable identity onto a job output, called by
   * POST /api/media/rename after the ledger anchored the move and after the file
   * was actually moved. That route is the only place CineBraid renames media and
   * the only moment it can prove two filenames name the same bytes, which is the
   * same argument C2 and C3 make for their own repairs.
   *
   * WHY IT LIVES HERE rather than in the route. The generation ledger has exactly
   * one writer and one per-project commit chain, and that is load-bearing: an
   * overlapping write from a second owner is the snapshot-clobbering defect
   * `commit` was written to end. Repairing from inside the same turn keeps the
   * count at one.
   *
   * READ BEFORE WRITE, deliberately. A project that has never generated has no
   * generation-jobs.json, and `commit` would create one holding `[]`. Renaming a
   * file must not be the thing that mints a generation history, so the ledger is
   * examined first and a turn is opened only when a job actually names this file.
   *
   * IT NEVER THROWS. The rename has already happened and the filesystem is
   * correct; an unreadable ledger or a busy sidecar must not turn a completed
   * approval into an error the director sees. Reporting what it did or did not do
   * is enough — the same trade anchorBeforeRename makes for the same reason. */
  async function repairJobMediaIdentity(change = {}) {
    const slug = String(change.slug || "").trim();
    const dir = String(change.dir || "").trim();
    const from = String(change.from || "").trim();
    const to = String(change.to || "").trim();
    if (!slug || !dir || !from || !to || from === to) return { repaired: 0, jobs: 0, reason: "no-change" };
    let owner;
    try {
      owner = ownerForSlug(slug);
    } catch (error) {
      return { repaired: 0, jobs: 0, reason: "no-project" };
    }
    const request = { dir, from, to, assetId: String(change.assetId || "") };
    try {
      const ledger = readJobLedger(owner.dir);
      if (!ledger.exists) return { repaired: 0, jobs: 0, reason: "no-ledger" };
      if (!ledger.jobs.some((job) => jobOutputsForRename(job, request).length))
        return { repaired: 0, jobs: 0, reason: "no-match" };
      return await commit(owner, (jobs) => {
        let repaired = 0;
        let touched = 0;
        for (const job of jobs) {
          const rows = repairJobOutputIdentity(job, request);
          if (!rows.length) continue;
          touched += 1;
          repaired += rows.length;
          job.updatedAt = now();
        }
        return { repaired, jobs: touched, reason: "repaired" };
      });
    } catch (error) {
      return { repaired: 0, jobs: 0, reason: "failed", error: String(error?.message || error) };
    }
  }

  /* Whole-operation serialisation for one job. Two refreshes of the same job
     must not both pass the `!job.ingestedAt` check and ingest the same result
     twice; ordering them makes the second observe the first's durable outcome. */
  const jobOperationChains = new Map();
  function serializeJobOperation(owner, jobId, run) {
    const key = `${owner.dir}::${jobId}`;
    const previous = jobOperationChains.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(run);
    jobOperationChains.set(key, next.catch(() => {}));
    return next;
  }
  /* ---- what CineBraid collected with nobody watching -------------------------
   *
   * A result the SERVER took delivery of, because the ingest reaper asked while no
   * browser was driving the job. Kept per project and only for the life of this
   * process: it is a notice, not a record. What actually happened is durable on the
   * job row and in the project — the outputs, the ingest stamp, the candidate files —
   * and this exists so the next window that opens is TOLD, instead of the work
   * appearing in a list with no explanation of when it arrived.
   *
   * Claimed once, by the browser's initial ledger load. The activity drawer re-reads
   * the same route every 3.5 seconds and must not consume the notice or announce it
   * again; see the route below for which request claims it. */
  const unattendedCollections = new Map();
  function recordUnattendedCollection(owner, job) {
    const rows = unattendedCollections.get(owner.slug) || [];
    rows.push({
      jobId: String(job.id || ""),
      purpose: String(job.purpose || ""),
      shotId: String(job.shotId || ""),
      entityId: String(job.entityId || ""),
      outputs: Array.isArray(job.outputs) ? job.outputs.length : 0,
      at: now(),
    });
    unattendedCollections.set(owner.slug, rows);
  }
  /* Plain language, and a count of RESULTS rather than of jobs: "2 results" is what a
     filmmaker sees in the workspace, and a job that returned four candidates delivered
     four of them. */
  function unattendedRecoveryNotice(slug, { claim = false } = {}) {
    const rows = unattendedCollections.get(slug) || [];
    if (!rows.length) return null;
    if (claim) unattendedCollections.delete(slug);
    const results = rows.reduce((sum, row) => sum + Math.max(0, Number(row.outputs) || 0), 0);
    return {
      jobs: rows.length,
      results,
      collections: rows,
      message: `Collected ${results} result${results === 1 ? "" : "s"} while no CineBraid window was open.`,
    };
  }
  /* Express 4 does not catch a rejected async handler, and an unanswered request
     is worse than an error: the browser waits forever on a generation it cannot
     see the state of. Every serialized route ends here. */
  function guardRoute(res, promise) {
    return promise.catch((error) => {
      if (res.headersSent) return;
      res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    });
  }

  /* Merges the outcome of a provider round-trip onto the CURRENT durable row.
     A terminal, already-ingested job is never walked backwards by a slower
     response arriving out of order, and identifiers that only the provider can
     supply are never cleared by a later update that lacks them. */
  const TERMINAL = Lifecycle.TERMINAL_LEDGER_STATUSES;
  /* `authoritative` says the incoming status came from the provider or from a person who
     checked it. It is the only thing that may displace UNRESOLVED — a stale write from
     an unrelated request must never turn "we do not know" into "we know it failed". */
  function mergeJobOutcome(target, source, options = {}) {
    if (!target || !source) return target;
    const settled = TERMINAL.includes(String(target.status || "")) && !!target.ingestedAt;
    for (const [key, value] of Object.entries(source)) {
      if (key === "status") continue;
      if (["externalId", "statusUrl", "responseUrl", "cancelUrl", "model", "modelFamily"].includes(key)) {
        if (value) target[key] = value; // never clear provenance with a blank
        continue;
      }
      if (key === "ingestedAt" && target.ingestedAt) continue;
      if (key === "outputs" && settled && (!Array.isArray(value) || !value.length)) continue;
      target[key] = value;
    }
    if (source.status)
      target.status = Lifecycle.nextStatus(target.status, source.status, {
        ingested: !!target.ingestedAt,
        authoritative: options.authoritative === true,
      });
    return target;
  }

  function readAutomationRuns(owner) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(owner.dir, "automation-runs.json"), "utf8"));
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.runs) ? parsed.runs : [];
    } catch { return []; }
  }
  function automationSubmissionError(owner, jobs, body, outputCount) {
    const runId = String(body?.automationRunId || "").trim();
    const stepKey = String(body?.automationStepKey || "").trim();
    if (!runId && !stepKey) return null;
    if (!runId || !stepKey) return { status: 400, message: "Automation generation requires both automationRunId and automationStepKey." };
    const run = readAutomationRuns(owner).find((item) => String(item.id) === runId);
    if (!run) return { status: 409, message: "Automation run was not found. No paid request was submitted." };
    const maxImages = Number(run.config?.maxImages);
    if (!Number.isInteger(maxImages) || maxImages <= 0) return { status: 409, message: "Automation credit guard has no valid positive image cap. No paid request was submitted." };
    const runnerId = String(body?.automationRunnerId || "").trim();
    const leaseExpiry = Date.parse(run.leaseExpiresAt || "");
    if (!runnerId || runnerId !== String(run.runnerId || "") || !Number.isFinite(leaseExpiry) || leaseExpiry <= Date.now()) {
      return { status: 409, code: "LEASE_NOT_ACTIVE", message: "Automation lease is not active for this window. No paid request was submitted." };
    }
    const committed = jobs
      .filter((job) => job.automationRunId === runId)
      .reduce((sum, job) => sum + Math.max(0, Number(job.outputCount || 0)), 0);
    const reportedUsage = Math.max(0, Number(run.usage?.imagesGenerated || 0));
    const consumed = Math.max(committed, reportedUsage);
    if (consumed + outputCount > maxImages) return { status: 409, message: `Automation credit guard stopped the request before exceeding its ${maxImages}-image cap.` };
    return null;
  }
  function publicJob(job) {
    if (!job) return null;
    const copy = structuredClone(job);
    delete copy.providerRequest;
    return copy;
  }
  function safeName(value, fallback) {
    const clean = path.basename(String(value || fallback)).replace(/[^\w.\-]+/g, "_");
    return clean || fallback;
  }
  function nextFile(dir, requested) {
    const ext = path.extname(requested) || ".png";
    const stem = path.basename(requested, ext) || "output";
    let name = `${stem}${ext}`, i = 1;
    while (fs.existsSync(path.join(dir, name))) name = `${stem}_${++i}${ext}`;
    return name;
  }
  function localAssetFile(owner, url) {
    const raw = String(url || "");
    if (!raw.startsWith("/assets/")) return "";
    const rel = decodeURIComponent(raw.slice("/assets/".length)).replace(/\\/g, "/");
    const allowed = /^(anchors|plates|props|vehicles|audio|media)\/[^/]+$/.test(rel) || /^shots\/[\w.-]+\/(takes|locked|blocking)\/[^/]+$/.test(rel);
    if (!allowed) throw new Error("Reference URL is outside CineBraid media storage.");
    const root = path.resolve(owner.dir), file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new Error(`Reference file is missing: ${rel}`);
    return file;
  }
  function mimeFor(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".avif") return "image/avif";
    if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
    if (ext === ".webm") return "video/webm";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".wav") return "audio/wav";
    if (ext === ".mp3") return "audio/mpeg";
    if (ext === ".m4a") return "audio/mp4";
    if (ext === ".ogg") return "audio/ogg";
    return "image/png";
  }
  function referenceInput(owner, ref) {
    const url = String(ref?.url || "");
    if (/^(https?:|data:)/i.test(url)) return url;
    const file = localAssetFile(owner, url);
    if (!file) throw new Error(`Reference ${ref?.label || ref?.key || "image"} has no usable URL.`);
    return `data:${mimeFor(file)};base64,${fs.readFileSync(file).toString("base64")}`;
  }
  function resolutionLongEdge(value) {
    const key = String(value || "1k").toLowerCase();
    if (key === "4k") return 4096;
    if (key === "2k") return 2048;
    return 1024;
  }
  function aspectSize(value, edit, resolution = "1k") {
    const ratio = String(value || "16:9").trim();
    /* Derived rather than looked up: the old eight-entry table had no 21:9 and no
       2.39:1, so an ultrawide or scope production silently generated 16:9 stills. Every
       entry the table used to hold falls inside the parser's believable range and so
       resolves to the identical pair; anything unparseable still lands on 16:9.
       The emission rule below is untouched — a mathematically exact ratio never earns an
       off-alignment pixel size. */
    const parsed = parseAspectRatio(ratio);
    const pair = parsed ? parsed.split(":").map(Number) : [16, 9];
    const longEdge = resolutionLongEdge(resolution);
    const landscape = pair[0] >= pair[1];
    const width = landscape ? longEdge : Math.round((longEdge * pair[0]) / pair[1]);
    const height = landscape ? Math.round((longEdge * pair[1]) / pair[0]) : longEdge;
    const even = (n) => Math.max(256, Math.round(n / 2) * 2);
    return { width: even(width), height: even(height) };
  }
  function activeCount(jobs) {
    return jobs.filter((job) => ["SUBMITTING", "IN_QUEUE", "IN_PROGRESS", "SUBMITTED"].includes(job.status)).length;
  }
  function normalizeError(data, status) {
    const detail = data?.detail;
    if (Array.isArray(detail)) return detail.map((row) => row?.msg || JSON.stringify(row)).join("; ");
    return detail?.message || detail || data?.error?.message || data?.error || data?.message || `fal request failed (${status})`;
  }
  function inferModelFamily(model) {
    const value = String(model || "").toLowerCase();
    if (!value) return "";
    if (value.includes("gpt-image-2")) return "gpt-image-2";
    if (value.includes("nano-banana")) return value.includes("pro") ? "nano-banana-pro" : "nano-banana-2";
    if (value.includes("flux")) return "flux-2";
    if (value.includes("krea")) return "krea-2";
    if (value.includes("seedream")) return "seedream-5-pro";
    if (value.includes("minimax/h3")) return "minimax-h3";
    return "";
  }
  function modelCompatibilityError(job, model) {
    const requestedFamily = String(job.profileFamily || "").trim();
    if (!requestedFamily) return "";
    const modelFamily = inferModelFamily(model);
    if (!modelFamily || modelFamily === requestedFamily) return "";
    return `Prompt profile ${job.profileName || job.profileId || requestedFamily} expects ${requestedFamily}, but the configured FAL endpoint ${model} behaves like ${modelFamily}. Switch the selected prompt adapter or the configured FAL endpoint so they match before submitting a paid request.`;
  }
  /* h3ReferenceGroups() was here. It bucketed the caller's reference array by media
     type so the dispatcher could take image[0] as the opening frame and image[1] as the
     ending one. That is the defect C1.1 exists to remove — the same two frames sent in
     the other order produced a shot that ended on its own first frame — so the function
     is deleted rather than left unused. Endpoints are bound by ROLE, through the plan's
     structured endpoint contract, in fal-h3-backend.js. */
  /* The single format gate for MiniMax H3, applied by the submission route before a
     job record is even created. It stays because a refused format must cost nothing;
     the compiler applies the same resolver, so the two cannot disagree. */
  function h3AspectGate(job) {
    const mode = String(job.profileMode || job.mode || "i2v");
    return h3AspectSupport(mode, job.aspectRatio);
  }

  /* Bytes for one PLAN reference. The plan carries a source — an assetId, a content
     hash, or a project-relative address — and never a provider URL, so turning one into
     something fal can fetch is transport work and lives here rather than in the
     compiler. Containment is unchanged: the same allowlist as every other reference. */
  function planReferenceAddress(owner, row) {
    const source = row?.source || {};
    const named = row?.production?.label || row?.refId || "input";
    if (source.kind === "data-uri" && source.dataUri) return { inline: source.dataUri };
    const address = String(source.path || "");
    if (/^https?:/i.test(address)) return { inline: address };
    if (!address)
      throw new H3BackendError("H3_REFERENCE_UNREADABLE", `Reference ${named} has no stored file to send.`, { refId: row?.refId });
    /* Refuses when the file is outside CineBraid media storage or has gone missing.
       Called during pre-flight as well as at dispatch, so a deleted approved frame is
       a refusal on the way in rather than a failed paid job — and a typed one, because
       "the frame you approved is no longer on disk" is something a filmmaker can fix
       and not a server fault. */
    let file = "";
    try {
      file = localAssetFile(owner, address);
    } catch (error) {
      throw new H3BackendError("H3_REFERENCE_UNREADABLE", `Reference ${named}: ${error.message}`, { refId: row?.refId });
    }
    if (!file)
      throw new H3BackendError("H3_REFERENCE_UNREADABLE", `Reference ${named} has no usable file.`, { refId: row?.refId });
    return { file };
  }
  function planReferenceInput(owner, row) {
    const resolved = planReferenceAddress(owner, row);
    if (resolved.inline) return resolved.inline;
    return `data:${mimeFor(resolved.file)};base64,${fs.readFileSync(resolved.file).toString("base64")}`;
  }

  /* WHAT THIS PAID REQUEST ACTUALLY CONSUMED, frozen onto the row.
   *
   * Called from the two compiled branches of the submission route, after the preflight
   * serialization has proved which references survive capability resolution and before
   * `commit()` makes the row durable — so the evidence exists before the POST, on the
   * same terms as the endpoint, the backend and the provider bindings beside it. A
   * process that dies between sending and answering leaves a row that still names the
   * exact files, bytes, states and frames the provider was handed.
   *
   * The consumed set comes from `serialized.bindings`, which is the serializer's own
   * account of what it put in the request. A reference the route refused, or the
   * capability layer dropped, never appears in it and therefore never appears here.
   *
   * The project is read ONCE, at this instant, and what it says is frozen. Every later
   * Canon edit, state re-declaration, approval and rename leaves this record alone —
   * that immutability is the whole value, and it is the same durability the compiled
   * plan, the submitted prompt and the cost estimate already have.
   *
   * IT FAILS CLOSED. A capture that cannot be completed REFUSES the dispatch rather than
   * recording nothing and carrying on. The reason is that the fail-open answer is not
   * "slightly less evidence": a new job with no binding is byte-for-byte the
   * representation reserved for genuine pre-instrumentation history — `recorded: false`,
   * `bindings: null` — so quietly skipping the capture forges that history rather than
   * merely omitting a field. Every throw here happens before the ledger commit and
   * before the POST, so refusing costs nothing and charges nothing. */
  function bindingRecordFor(owner, job, source, serialized) {
    let record;
    try {
      const project = ownerProject(owner);
      record = generationBindingRecord({
        at: now(),
        plan: source.plan,
        serialized,
        sourceReferences: source.sourceReferences,
        project,
        shot: (Array.isArray(project?.shots) ? project.shots : []).find((row) => String(row?.id) === String(job.shotId)) || null,
        frameId: job.frameId,
        /* The dispatcher's own containment rule, so the bytes that are hashed are the
           bytes that are sent and a reference outside media storage is unreadable here
           for exactly the reason it is unsendable there. The DIGEST is not passed:
           generation-binding.js applies CineBraid's one media hash itself, so this
           module keeps no opinion about what identifies a file. */
        resolveFile: (address) => localAssetFile(owner, address),
      });
    } catch (error) {
      throw new GenerationBindingError(
        "CineBraid could not record what this generation would consume, so it did not submit it. "
        + `Nothing was sent and nothing was charged. (${error.message})`,
        { jobId: job.id, purpose: job.purpose },
      );
    }
    /* A record the constructor returned but that describes nothing, for a request that
       demonstrably carries inputs, is the same forgery by another route. */
    if (!record || !Array.isArray(record.generationBinding))
      throw new GenerationBindingError(
        "CineBraid could not record what this generation would consume, so it did not submit it. "
        + "Nothing was sent and nothing was charged.",
        { jobId: job.id, purpose: job.purpose },
      );
    return record;
  }
  function applyBindingRecord(job, record) {
    job.generationBindingVersion = record.generationBindingVersion;
    job.generationBindingRecordedAt = record.generationBindingRecordedAt;
    job.generationBinding = record.generationBinding;
  }

  /* Everything the compilation decided, written onto the job record. After this the job
     IS the compiled request: its prompt, references, duration, resolution and format are
     the plan's, not the caller's. */
  function applyCompilationToJob(job, compiled) {
    const plan = compiled.plan;
    const extensions = plan.settings?.extensions?.[plan.model?.modelId] || {};
    job.compilation = planProvenance(compiled);
    job.mode = compiled.mode;
    job.profileMode = compiled.mode;
    job.profileId = compiled.profile.id || job.profileId;
    job.profileName = compiled.profile.name || job.profileName;
    job.sourceBuildId = compiled.source.buildId || job.sourceBuildId;
    job.packageId = compiled.source.packageId || job.packageId;
    /* Both prompts, always. They are identical unless the filmmaker edited one, and a
       reader must never have to guess which of the two a shot was made from. */
    job.compiledPrompt = compiled.compiledPrompt;
    job.prompt = compiled.submittedPrompt;
    job.promptEdited = compiled.promptEdited;
    job.durationSeconds = Number(plan.output?.durationSeconds) || Number(extensions.duration) || job.durationSeconds;
    job.resolution = String(extensions.resolution || job.resolution);
    job.aspectRatio = compiled.aspect.carriesAspectRatio ? String(extensions.ratio || compiled.aspect.value || "") : "source image";
    /* The plan's references, in the plan's order, in the shape the rest of this module
       and the ingest record already speak. Addresses only — no bytes in the ledger. */
    job.references = plan.inputs.references.map((row) => ({
      key: row.refId,
      token: "",
      label: row.production?.label || row.refId,
      role: row.role,
      instruction: row.production?.purpose || "",
      mediaType: row.mediaType,
      url: String(row.source?.path || ""),
    }));
  }

  /* A refusal a filmmaker can act on. The typed code is what a screen switches on; the
     message is what a person reads. Nothing here leaks a stack or a provider internal. */
  function h3Refusal(res, error) {
    const typed = error instanceof H3ExecutionError || error instanceof H3BackendError;
    const status = typed ? error.status || 400 : 500;
    return res.status(status).json({
      error: error?.message || "MiniMax H3 preparation failed.",
      code: typed ? error.code : "H3_PREPARATION_FAILED",
      ...(typed && error.detail && Object.keys(error.detail).length ? { detail: error.detail } : {}),
    });
  }
  function imageRefusal(res, error) {
    const typed = error instanceof ImageExecutionError || error instanceof FalImageBackendError;
    const status = typed ? error.status || 400 : 500;
    return res.status(status).json({
      error: error?.message || "Frame preparation failed.",
      code: typed ? error.code : "IMAGE_PREPARATION_FAILED",
      ...(typed && error.detail && Object.keys(error.detail).length ? { detail: error.detail } : {}),
    });
  }

  /* Everything the image compilation decided, written onto the job record. After this
     the job IS the compiled request: its prompt, references, size, quality and count
     are the plan's, not the caller's. The mirror of applyCompilationToJob, and
     deliberately a separate function rather than a branch inside it — the two write
     different fields and sharing one body would mean an image job carrying a duration
     because a video field happened to be assigned unconditionally. */
  function applyImageCompilationToJob(job, compiled) {
    const plan = compiled.plan;
    const extensions = plan.settings?.extensions?.[plan.model?.modelId] || {};
    job.compilation = imagePlanProvenance(compiled);
    job.mode = compiled.mode;
    job.profileMode = compiled.mode;
    job.profileId = compiled.profile.id || job.profileId;
    job.profileName = compiled.profile.name || job.profileName;
    job.profileFamily = "gpt-image-2";
    job.sourceBuildId = compiled.source.buildId || job.sourceBuildId;
    job.packageId = compiled.source.packageId || job.packageId;
    /* Both prompts, always. They are identical unless the filmmaker edited one, and a
       reader must never have to guess which of the two a frame was made from. */
    job.compiledPrompt = compiled.compiledPrompt;
    job.prompt = compiled.submittedPrompt;
    job.promptEdited = compiled.promptEdited;
    /* The size the model documents, not a long edge and a ratio. A still has no
       duration and this never writes one. */
    job.resolution = String(extensions.size || job.resolution);
    job.quality = String(extensions.quality || job.quality);
    job.outputCount = Number(plan.output?.candidateCount) || job.outputCount;
    job.aspectRatio = compiled.aspectRatio || job.aspectRatio;
    job.references = plan.inputs.references.map((row) => ({
      key: row.refId,
      token: "",
      label: row.production?.label || row.refId,
      role: row.role,
      instruction: row.production?.purpose || "",
      mediaType: row.mediaType,
      url: String(row.source?.path || ""),
    }));
  }

  /* THE ONLY COMPILED IMAGE DISPATCH.
   *
   * Its input is the compiled plan the job was minted from. There is no argument here
   * carrying a shot, a spec, a profile or a raw prompt, so this function cannot
   * rebuild filmmaking intent — it renames fields, picks the endpoint and resolves
   * bytes. It goes through the same providerPost boundary as every other paid
   * request, so C1.2's uncertainty handling applies to it without a line of its own. */
  async function submitImage(owner, job, cfg) {
    const compilation = job.compilation;
    if (!compilation || !compilation.plan)
      throw new ImageExecutionError(
        "IMAGE_PLAN_REQUIRED",
        "This request carries no compiled generation plan, so CineBraid will not submit it. Rebuild the prompt on this shot and generate again.",
        { jobId: job.id },
      );
    const serialized = serializeImagePlanForFal(compilation.plan, compilation.capability, {
      resolveReference: (row) => planReferenceInput(owner, row),
      config: cfg,
      ...(job.promptEdited ? { promptOverride: job.prompt } : {}),
    });
    /* The configured endpoint has to be the model the plan was compiled for. An
       operator who points textModel at a different family would otherwise get a
       request built from GPT Image 2's rules and sent to something else. */
    const configuredFamily = inferModelFamily(serialized.model);
    if (configuredFamily && configuredFamily !== serialized.modelFamily)
      throw new FalImageBackendError(
        "IMAGE_ENDPOINT_MISMATCH",
        `This frame was compiled for ${serialized.modelFamily}, but the configured FAL endpoint ${serialized.model} behaves like ${configuredFamily}. Fix the endpoint in Settings before submitting a paid request — nothing was sent.`,
        { endpoint: serialized.model, expected: serialized.modelFamily, configured: configuredFamily },
      );
    const { data } = await providerPost(`${cfg.baseUrl}/${serialized.model}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Key ${cfg.apiKey}`, "X-Fal-No-Retry": "1" },
      body: JSON.stringify(serialized.input),
    }, serialized.model);
    return {
      model: serialized.model,
      modelFamily: serialized.modelFamily,
      backendId: serialized.backendId,
      providerRequest: redactedImageRequest(serialized),
      providerBindings: serialized.bindings,
      submittedPromptCharacters: serialized.submittedPromptCharacters,
      externalId: data.request_id || "",
      statusUrl: data.status_url || "",
      responseUrl: data.response_url || "",
      cancelUrl: data.cancel_url || "",
      queuePosition: data.queue_position,
      status: "IN_QUEUE",
    };
  }

  /* The request as sent, minus the payload bytes. Every media field is replaced by the
     refIds the serializer bound to it, so the record stays small and still answers
     "which approved reference did this frame come from". */
  function redactedImageRequest(serialized) {
    const media = new Set(["image_urls", "mask_url"]);
    const out = {};
    for (const [key, value] of Object.entries(serialized.input)) {
      if (!media.has(key)) { out[key] = value; continue; }
      const bound = serialized.bindings.filter((row) => row.field === key).map((row) => row.refId);
      out[key] = Array.isArray(value) ? bound : bound[0] || "";
    }
    return out;
  }

  /* THE ONLY H3 DISPATCH.
   *
   * Its input is the compiled plan the job was minted from. There is no argument here
   * carrying a shot, a spec, a profile or a raw prompt, so this function cannot rebuild
   * filmmaking intent — it renames fields, picks the endpoint and resolves bytes.
   *
   * A job with no compiled plan is refused rather than served by an older code path.
   * That is the whole of the no-legacy-fallback rule: there is nothing left to fall
   * back to, and a stored job from before this wiring can still be read, refreshed and
   * cancelled, but cannot originate a new provider request. */
  /* THE PROVIDER BOUNDARY.
   *
   * Every paid dispatch in this module goes through here, so exactly one place decides
   * what a failure ESTABLISHED. The evidence it attaches is provider-neutral — did the
   * request leave, did anything answer, with what status — and generation-lifecycle.js
   * turns that into FAILED or UNRESOLVED without knowing which adapter called it.
   *
   * The line that matters is the `fetch` call itself: before it, nothing was sent and a
   * failure is ordinary; after it, the queue may hold the job whatever happens next. */
  async function providerPost(url, init, label) {
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const failure = new Error(
        `${label} did not answer (${error.message}). The request had already been sent, so it may have been accepted and charged — check the provider before generating this shot again.`,
      );
      failure.providerEvidence = { transmitted: true, httpStatus: null };
      throw failure;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const answered = new Error(normalizeError(data, response.status));
      answered.providerEvidence = { transmitted: true, httpStatus: response.status };
      throw answered;
    }
    /* A success CineBraid cannot identify a job from is not a success it can act on: the
       render may be running and there is no handle to follow or cancel it. Treated as
       uncertainty rather than recorded as a queued job with no id. */
    if (!data || !data.request_id) {
      const opaque = new Error(
        `${label} accepted the request but returned no request id, so CineBraid cannot follow it. The generation may be running and may have been charged — check the provider before generating this shot again.`,
      );
      opaque.providerEvidence = { transmitted: true, httpStatus: response.status };
      throw opaque;
    }
    return { response, data };
  }

  async function submitH3(owner, job, cfg) {
    const compilation = job.compilation;
    if (!compilation || !compilation.plan)
      throw new H3ExecutionError(
        "H3_PLAN_REQUIRED",
        "This MiniMax H3 request carries no compiled generation plan, so CineBraid will not submit it. Rebuild the motion prompt on this shot and generate again.",
        { jobId: job.id },
      );
    const serialized = serializeH3PlanForFal(compilation.plan, compilation.capability, {
      resolveReference: (row) => planReferenceInput(owner, row),
      config: cfg,
      /* Present only when the filmmaker edited the compiled text. It replaces the
         prompt string and reaches nothing else in the request. */
      ...(job.promptEdited ? { promptOverride: job.prompt } : {}),
    });
    const { data } = await providerPost(`${cfg.baseUrl}/${serialized.model}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Key ${cfg.apiKey}`, "X-Fal-No-Retry": "1" },
      body: JSON.stringify(serialized.input),
    }, serialized.model);
    return {
      model: serialized.model,
      modelFamily: serialized.modelFamily,
      backendId: serialized.backendId,
      /* What was actually sent, with the media replaced by the plan's own reference
         identity. The bytes are not repeated into the ledger; which reference filled
         which provider field is exactly what a later reader needs. */
      providerRequest: redactedProviderRequest(serialized),
      providerBindings: serialized.bindings,
      submittedPromptCharacters: serialized.submittedPromptCharacters,
      externalId: data.request_id || "",
      statusUrl: data.status_url || "",
      responseUrl: data.response_url || "",
      cancelUrl: data.cancel_url || "",
      queuePosition: data.queue_position,
      status: "IN_QUEUE",
    };
  }

  /* The request as sent, minus the payload bytes. Every media field is replaced by the
     refIds the serializer bound to it, so the record stays small and still answers
     "which approved frame opened this shot". */
  function redactedProviderRequest(serialized) {
    const media = new Set(["image_url", "end_image_url", "reference_image_urls", "reference_video_urls", "reference_audio_urls"]);
    const out = {};
    for (const [key, value] of Object.entries(serialized.input)) {
      if (!media.has(key)) { out[key] = value; continue; }
      const bound = serialized.bindings.filter((row) => row.field === key).map((row) => row.refId);
      out[key] = Array.isArray(value) ? bound : bound[0] || "";
    }
    return out;
  }

  /* WHICH JOBS TAKE THE UNCOMPILED PATH.
   *
   * Asked in exactly one place, because the submission route and `submit()` both have to
   * answer it and a disagreement between them is a job that prepares one request and
   * sends another. The test is the same one `submit()` has always applied: not H3, and
   * no compiled image plan. */
  function legacyDispatch(job) {
    if (job.profileFamily === "minimax-h3" || job.purpose === "motion-h3") return false;
    return !(job.compilation?.plan && String(job.compilation.plan.outputType) === "image");
  }

  /* THE UNCOMPILED REQUEST, BUILT ONCE.
   *
   * `entity-reference`, `correction`, and `frame`/`blocking` submitted without
   * `imagePlan` never reach the compiler, so they have no GenerationPlan and no
   * capability layer to serialize against. What they DO have is a final payload, and
   * that payload is the whole of what the provider consumes — so it is built here,
   * before the ledger commit, and handed to `submit()` rather than rebuilt there.
   *
   * WHY BUILD IT EARLY. The consumed set has to be the set that is actually sent. If
   * this ran inside `submit()` — after the row was already durable — the binding would
   * either be derived from a second computation that could disagree, or attached after
   * the POST, which is the one ordering that cannot be made safe. One construction, one
   * payload, one set of bindings, all before anything leaves the machine.
   *
   * `bindings` and `planView` are deliberately the SAME shapes the compiled serializers
   * produce, so generation-binding.js stays the single construction authority and this
   * path gets no provenance system of its own. What it cannot supply — an entityId, a
   * continuity state — it simply does not supply, and the record says so. Inventing them
   * from `job.entityId` would be worse than an absence: that field names the entity being
   * GENERATED, not the entity a consumed reference depicts. */
  function serializeLegacyRequest(owner, job, cfg) {
    const edit = job.mode === "edit";
    const model = edit ? cfg.editModel : cfg.textModel;
    const compatibility = modelCompatibilityError(job, model);
    if (compatibility) throw new Error(compatibility);

    const input = {
      prompt: job.prompt,
      image_size: aspectSize(job.aspectRatio, edit, job.resolution),
      quality: job.quality,
      num_images: job.outputCount,
      output_format: "png",
    };
    const bindings = [];
    const references = [];
    let sent = [];
    if (edit) {
      const supplied = Array.isArray(job.references) ? job.references : [];
      if (!supplied.length) throw new Error("The configured edit endpoint needs at least one input image.");
      /* THE FINAL LIMIT, APPLIED ONCE, HERE. Reference seventeen is not sent, so it is
         not consumed, so it does not appear in the binding — and because the payload
         below is the payload that ships, the two cannot come apart. */
      sent = supplied.slice(0, 16);
      input.image_urls = sent.map((ref, index) => {
        const refId = String(ref?.key || ref?.token || `image-${index + 1}`);
        const mediaType = ["image", "video", "audio"].includes(String(ref?.mediaType || "").toLowerCase())
          ? String(ref.mediaType).toLowerCase()
          : "image";
        const role = String(ref?.role || "reference");
        const url = String(ref?.url || "");
        bindings.push({ refId, role, mediaType, field: "image_urls", index, order: index });
        references.push({
          refId,
          role,
          mediaType,
          source: url.startsWith("data:") ? { kind: "data-uri", dataUri: url } : { kind: "project-asset", path: url },
          production: { label: String(ref?.label || refId), purpose: String(ref?.instruction || "") },
          order: index,
        });
        return referenceInput(owner, ref);
      });
    }
    return {
      model,
      modelFamily: inferModelFamily(model),
      input,
      bindings,
      /* The plan-shaped view the binding constructor reads a source address out of. It
         is a projection of these references and never a compiled plan; nothing else may
         treat it as one. */
      planView: { inputs: { prompt: input.prompt, references } },
      /* No entityId is claimed for any of them. */
      sourceReferences: references.map((row) => ({ refId: row.refId, entityId: "" })),
      redacted: { ...input, image_urls: edit ? sent.map((ref) => ref.url || "local-image") : undefined },
    };
  }

  async function submit(owner, job, refs, prepared) {
    const cfg = config();
    if (job.profileFamily === "minimax-h3" || job.purpose === "motion-h3") return submitH3(owner, job, cfg);
    /* A job that was compiled goes through its plan, whatever it produces. The test is
       the presence of a plan rather than a purpose string, so nothing has to be kept
       in step with a list of which purposes compile — and a job minted before this
       phase simply has no plan and takes the path it always took. */
    if (!legacyDispatch(job)) return submitImage(owner, job, cfg);
    /* THE PAYLOAD IS NOT REBUILT HERE. It was built before the row became durable, and
       the binding on that row describes it. Recomputing would reintroduce exactly the
       gap between what was recorded and what was sent that building it early closes, so
       a missing payload is a refusal rather than a rebuild. */
    if (!prepared || !prepared.input)
      throw new Error("This request was not prepared before submission, so CineBraid will not send it.");
    const { data } = await providerPost(`${cfg.baseUrl}/${prepared.model}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Key ${cfg.apiKey}`,
        "X-Fal-No-Retry": "1",
      },
      body: JSON.stringify(prepared.input),
    }, prepared.model);
    return {
      model: prepared.model,
      modelFamily: prepared.modelFamily,
      providerRequest: prepared.redacted,
      providerBindings: prepared.bindings,
      externalId: data.request_id || "",
      statusUrl: data.status_url || "",
      responseUrl: data.response_url || "",
      cancelUrl: data.cancel_url || "",
      queuePosition: data.queue_position,
      status: "IN_QUEUE",
    };
  }
  function statusName(value) {
    const status = String(value || "").toUpperCase();
    if (status === "COMPLETED") return "COMPLETED";
    if (status === "IN_PROGRESS") return "IN_PROGRESS";
    if (status === "IN_QUEUE") return "IN_QUEUE";
    if (/CANCEL/.test(status)) return "CANCELLED";
    if (/FAIL|ERROR/.test(status)) return "FAILED";
    return status || "IN_QUEUE";
  }
  function resultAssets(data, job) {
    const source = data?.data || data || {};
    if (job?.profileFamily === "minimax-h3" || job?.purpose === "motion-h3") return source.video?.url ? [source.video] : [];
    return Array.isArray(source.images) ? source.images : [];
  }
  async function downloadOutput(asset, fallbackMime = "application/octet-stream") {
    if (!asset?.url) throw new Error("fal returned an output without a URL.");
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`Could not download fal output (${response.status}).`);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mime: response.headers.get("content-type") || asset.content_type || fallbackMime,
      originalName: asset.file_name || path.basename(new URL(asset.url).pathname) || "fal-output",
      width: asset.width || 0,
      height: asset.height || 0,
    };
  }
  async function downloadImage(image) { return downloadOutput(image, "image/png"); }
  function newMediaLink(shotId, order) {
    return {
      id: uid("link"),
      targetType: "shot",
      targetId: shotId,
      role: "blocking-frame",
      order,
      priority: "supporting",
      generationInput: false,
      blockingState: "returned",
      blockingAdherence: "strict",
      blockingVersion: "",
    };
  }
  function entityTarget(job, project) {
    const allowed = { characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" };
    const list = String(job.entityList || "");
    const folder = allowed[list];
    if (!folder) throw new Error("Unsupported entity reference target.");
    const entity = (project[list] || []).find((item) => String(item.id) === String(job.entityId));
    if (!entity) throw new Error("Entity no longer exists.");
    return { list, folder, entity };
  }
  function updateEntityCoverageRun(owner, job, status, error = "") {
    if (job?.purpose !== "entity-reference" || !job.entityList || !job.entityId) return;
    try {
      const project = ownerProject(owner);
      const entity = (project[job.entityList] || []).find((item) => String(item.id) === String(job.entityId));
      if (!entity?.coverageAutomation) return;
      entity.coverageAutomation.status = status;
      entity.coverageAutomation.updatedAt = now();
      if (error) entity.coverageAutomation.error = String(error);
      if (["failed", "cancelled", "needs-attention"].includes(status)) entity.coverageAutomation.needsAttentionAt = now();
      saveOwnerProject(owner, project);
    } catch {}
  }
  function entityRole(list) {
    return { characters: "character-reference", locations: "location-reference", props: "prop-reference", vehicles: "vehicle-reference" }[list] || "planning-reference";
  }
  async function ingestEntity(owner, job, images, project) {
    const { list, folder, entity } = entityTarget(job, project);
    const dir = path.join(owner.dir, folder);
    fs.mkdirSync(dir, { recursive: true });
    entity.candidateFiles = Array.isArray(entity.candidateFiles) ? entity.candidateFiles : [];
    entity.generatedCandidates = Array.isArray(entity.generatedCandidates) ? entity.generatedCandidates : [];
    const outputs = [];
    for (let index = 0; index < images.length; index++) {
      const downloaded = await downloadImage(images[index]);
      const ext = downloaded.mime.includes("jpeg") ? ".jpg" : downloaded.mime.includes("webp") ? ".webp" : ".png";
      const name = nextFile(dir, safeName(`${entity.id}_FAL_CANDIDATE_${index + 1}${ext}`, `${entity.id}_FAL${ext}`));
      fs.writeFileSync(path.join(dir, name), downloaded.buffer);
      const provenance = {
        stored: name, original: downloaded.originalName, addedAt: now(), decision: "unreviewed",
        generationProvider: "fal", generationModel: job.model, generationJobId: job.id,
        generationRequestId: job.externalId, sourceBuildId: job.sourceBuildId || "",
        automationRunId: job.automationRunId || "", automationStepKey: job.automationStepKey || "",
        prompt: job.prompt, referenceCount: job.references.length, quality: job.quality, resolution: job.resolution, aspectRatio: job.aspectRatio,
        targetStateId: job.continuityStateId || "",
        targetStateName: job.continuityStateName || "",
        parentStateId: job.parentStateId || "",
        parentStateName: job.parentStateName || "",
        parentApprovedFile: job.parentApprovedFile || "",
        derivationMode: job.derivationMode || "independent",
        coverageJobType: job.coverageJobType || "",
        coverageSheetType: job.coverageSheetType || "",
        targetCoverageSlotId: job.targetCoverageSlotId || "",
        targetCoverageSlotName: job.targetCoverageSlotName || "",
        coverageSourceFile: job.coverageSourceFile || "",
        authorityContractVersion: job.authorityContractVersion || "",
        authorityManifest: (job.references || []).map((ref) => ({ token: ref.token || "", label: ref.label || "", role: ref.role || "", sourceFile: path.basename(String(ref.url || "").split("?")[0]) })),
      };
      entity.candidateFiles.push(provenance);
      entity.generatedCandidates.push({ ...provenance, role: entityRole(list) });
      outputs.push({ type: "entity-candidate", entityList: list, entityId: entity.id, continuityStateId: job.continuityStateId || "", continuityStateName: job.continuityStateName || "", name, url: `/assets/${folder}/${name}` });
    }
    if (!entity.workflowStatus || entity.workflowStatus === "DRAFT") entity.workflowStatus = "IN PROGRESS";
    if (!entity.status || entity.status === "NOT STARTED") entity.status = "IN PROGRESS";
    if (job.coverageJobType) {
      entity.coverageAutomation = entity.coverageAutomation && typeof entity.coverageAutomation === "object" ? entity.coverageAutomation : { list, entityId: entity.id, mode: job.coverageJobType === "sheet" ? "sheet" : "individual", sheetType: job.coverageSheetType || "angles", startedAt: job.createdAt || now(), jobs: [] };
      entity.coverageAutomation.jobs = Array.isArray(entity.coverageAutomation.jobs) ? entity.coverageAutomation.jobs : [];
      if (!entity.coverageAutomation.jobs.includes(job.id)) entity.coverageAutomation.jobs.push(job.id);
      const knownJobs = readJobs(owner);
      const pending = knownJobs.filter((item) => entity.coverageAutomation.jobs.includes(item.id) && item.id !== job.id && !["COMPLETED", "FAILED", "CANCELLED"].includes(String(item.status || "").toUpperCase()));
      if (!pending.length) {
        entity.coverageAutomation.status = job.coverageJobType === "sheet" ? "sheet-ready-for-review" : "slot-candidates-ready";
        entity.coverageAutomation.readyAt = now();
      }
    }
    saveOwnerProject(owner, project);
    job.outputs = outputs;
    job.ingestedAt = now();
    return job;
  }
  async function ingestMotion(owner, job, assets, project) {
    if (job.ingestedAt) return job;
    const shot = (project.shots || []).find((item) => String(item.id) === String(job.shotId));
    if (!shot) throw new Error("Shot no longer exists.");
    const dir = path.join(owner.dir, "shots", shot.id, "takes");
    fs.mkdirSync(dir, { recursive: true });
    shot.candidateFiles = Array.isArray(shot.candidateFiles) ? shot.candidateFiles : [];
    const outputs = [];
    for (let index = 0; index < assets.length; index++) {
      const downloaded = await downloadOutput(assets[index], "video/mp4");
      const ext = downloaded.mime.includes("webm") ? ".webm" : downloaded.mime.includes("quicktime") ? ".mov" : ".mp4";
      const name = nextFile(dir, safeName(`${shot.id}_MOTION_H3_${index + 1}${ext}`, `${shot.id}_H3${ext}`));
      fs.writeFileSync(path.join(dir, name), downloaded.buffer);
      shot.candidateFiles.push({
        stored: name, original: downloaded.originalName, addedAt: now(), decision: "unreviewed", notes: "",
        labels: ["MiniMax H3", job.profileMode || "motion"], sourceBuildId: job.sourceBuildId || "",
        sourcePackageId: job.packageId || job.sourceBuildId || "", sourcePackageLabel: job.packageId || job.profileName || "MiniMax H3 generation",
        generationProvider: "fal", generationModel: job.model, generationJobId: job.id, generationRequestId: job.externalId,
        generationDuration: job.durationSeconds, generationResolution: job.resolution,
        generationAspectRatio: ["i2v", "flf"].includes(job.profileMode) ? "source image" : job.aspectRatio,
        generationProfileId: job.profileId, generationProfileMode: job.profileMode,
        generationReferenceManifest: (job.references || []).map((ref) => ({ token: ref.token, label: ref.label, role: ref.role, mediaType: ref.mediaType, url: ref.url })),
      });
      outputs.push({ type: "motion-candidate", name, url: `/assets/shots/${shot.id}/takes/${name}`, profileId: job.profileId, profileMode: job.profileMode });
    }
    shot.workflowStatus = "IN PROGRESS";
    shot.status = "BUILT";
    shot.reviewStatus = "PENDING";
    saveOwnerProject(owner, project);
    job.outputs = outputs;
    job.ingestedAt = now();
    return job;
  }

  async function ingest(owner, job, images) {
    if (job.ingestedAt) return job;
    const P = ownerProject(owner);
    if (job.purpose === "motion-h3" || job.profileFamily === "minimax-h3") return ingestMotion(owner, job, images, P);
    if (job.purpose === "entity-reference") return ingestEntity(owner, job, images, P);
    const shot = (P.shots || []).find((item) => String(item.id) === String(job.shotId));
    if (!shot) throw new Error("Shot no longer exists.");
    const outputs = [];
    P.mediaAssets = Array.isArray(P.mediaAssets) ? P.mediaAssets : [];
    shot.candidateFiles = Array.isArray(shot.candidateFiles) ? shot.candidateFiles : [];
    for (let index = 0; index < images.length; index++) {
      const downloaded = await downloadImage(images[index]);
      const ext = downloaded.mime.includes("jpeg") ? ".jpg" : downloaded.mime.includes("webp") ? ".webp" : ".png";
      if (job.purpose === "blocking") {
        const dir = path.join(owner.dir, "shots", shot.id, "blocking");
        fs.mkdirSync(dir, { recursive: true });
        const name = nextFile(dir, safeName(`${shot.id}_BLOCKING_FAL_${index + 1}${ext}`, `${shot.id}_BLOCKING${ext}`));
        fs.writeFileSync(path.join(dir, name), downloaded.buffer);
        const link = newMediaLink(shot.id, P.mediaAssets.length + index);
        link.blockingFrameId = job.frameId || "";
        link.blockingVersion = `B${String((P.mediaAssets || []).filter((asset) => (asset.links || []).some((row) => row.targetType === "shot" && row.targetId === shot.id && row.role === "blocking-frame")).length + 1).padStart(2, "0")}`;
        const asset = {
          id: uid("blocking-media"),
          file: name,
          storagePath: `shots/${shot.id}/blocking/${name}`,
          originalName: downloaded.originalName,
          title: job.frameId ? `${shot.id} · Frame ${job.frameLabel || "?"} — FAL blocking ${index + 1}` : `${shot.id} — FAL blocking ${index + 1}`,
          kind: "image",
          notes: job.revisionRequest ? `Blocking revision request: ${job.revisionRequest}` : "Blocking frame — geometric planning scaffold, not visual canon.",
          provenance: job.packageId || job.sourceBuildId || "",
          generationRecord: {
            provider: "fal",
            model: job.model,
            requestId: job.externalId,
            jobId: job.id,
            automationRunId: job.automationRunId || "",
            automationStepKey: job.automationStepKey || "",
            prompt: job.prompt,
            packageId: job.packageId || "",
            sourceBuildId: job.sourceBuildId || "",
            revisedFromAssetId: job.revisedFromAssetId || "",
            requestedChanges: job.revisionRequest || "",
            quality: job.quality,
            resolution: job.resolution,
            date: now(),
          },
          createdAt: now(),
          links: [link],
        };
        P.mediaAssets.push(asset);
        outputs.push({ type: "blocking", assetId: asset.id, frameId: job.frameId || "", frameLabel: job.frameLabel || "", name, url: `/assets/${asset.storagePath}` });
      } else {
        const dir = path.join(owner.dir, "shots", shot.id, "takes");
        fs.mkdirSync(dir, { recursive: true });
        const frameLabel = job.frameLabel || "A";
        const correction = job.purpose === "correction";
        const stem = correction
          ? `${shot.id}_FRAME_${frameLabel}_CORRECTION_FAL_${index + 1}${ext}`
          : `${shot.id}_FRAME_${frameLabel}_FAL_${index + 1}${ext}`;
        const name = nextFile(dir, safeName(stem, `${shot.id}_FAL${ext}`));
        fs.writeFileSync(path.join(dir, name), downloaded.buffer);
        const candidate = {
          stored: name,
          original: downloaded.originalName,
          addedAt: now(),
          decision: "unreviewed",
          notes: "",
          labels: [],
          frameId: job.frameId || "",
          sourceBuildId: job.sourceBuildId || "",
          sourcePackageId: job.sourceBuildId || job.packageId || "",
          sourcePackageLabel: job.packageId || "FAL generation",
          generationProvider: "fal",
          generationModel: job.model,
          generationJobId: job.id,
          generationRequestId: job.externalId,
          automationRunId: job.automationRunId || "",
          automationStepKey: job.automationStepKey || "",
          generationQuality: job.quality,
          generationResolution: job.resolution,
        };
        if (correction) {
          candidate.correctionOf = job.sourceCandidate || "";
          candidate.correctionBuildId = job.sourceBuildId || "";
          candidate.correctionParentBuildId = job.parentBuildId || "";
          candidate.correctionParentPackageId = job.parentPackageId || "";
          candidate.correctionGuideAssetId = job.guideAssetId || "";
          candidate.correctionReferenceCount = job.references.length;
          candidate.correctionGeneratedAt = now();
          const source = shot.candidateFiles.find((item) => (item.stored || item.name) === job.sourceCandidate);
          if (source) {
            source.correctionResultNames = Array.isArray(source.correctionResultNames) ? source.correctionResultNames : [];
            source.correctionJobIds = Array.isArray(source.correctionJobIds) ? source.correctionJobIds : [];
            if (!source.correctionResultNames.includes(name)) source.correctionResultNames.push(name);
            if (!source.correctionJobIds.includes(job.id)) source.correctionJobIds.push(job.id);
          }
        }
        shot.candidateFiles.push(candidate);
        outputs.push({ type: "candidate", name, url: `/assets/shots/${shot.id}/takes/${name}`, frameId: job.frameId || "", correctionOf: job.sourceCandidate || "" });
      }
    }
    if (job.purpose === "frame" || job.purpose === "correction") {
      shot.workflowStatus = "IN PROGRESS";
      shot.status = "BUILT";
      shot.reviewStatus = "PENDING";
    }
    saveOwnerProject(owner, P);
    job.outputs = outputs;
    job.ingestedAt = now();
    return job;
  }
  async function refresh(owner, job) {
    const cfg = config();
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status) && job.ingestedAt) return job;
    const statusResponse = await fetch(job.statusUrl, {
      headers: { Authorization: `Key ${cfg.apiKey}` },
    });
    const statusData = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(normalizeError(statusData, statusResponse.status));
    job.status = statusName(statusData.status);
    job.queuePosition = statusData.queue_position;
    job.logs = Array.isArray(statusData.logs) ? statusData.logs.slice(-12) : [];
    job.updatedAt = now();
    if (job.status === "COMPLETED" && !job.ingestedAt) {
      const resultResponse = await fetch(job.responseUrl || statusData.response_url, {
        headers: { Authorization: `Key ${cfg.apiKey}` },
      });
      const resultData = await resultResponse.json().catch(() => ({}));
      if (!resultResponse.ok) throw new Error(normalizeError(resultData, resultResponse.status));
      const assets = resultAssets(resultData, job);
      if (!assets.length) throw new Error(job.profileFamily === "minimax-h3" ? "fal completed the MiniMax H3 request but returned no video." : "fal completed the request but returned no images.");
      await ingest(owner, job, assets);
    }
    return job;
  }

  app.get("/api/generation/fal/status", (req, res) => {
    const cfg = config();
    res.json({
      enabled: cfg.enabled,
      configured: !!cfg.apiKey,
      textModel: cfg.textModel,
      editModel: cfg.editModel,
      h3Models: { textToVideo: cfg.h3TextModel, imageToVideo: cfg.h3ImageModel, referenceToVideo: cfg.h3ReferenceModel },
      defaults: { blockingOutputs: cfg.blockingOutputs, frameOutputs: cfg.frameOutputs, blockingQuality: cfg.blockingQuality, frameQuality: cfg.frameQuality, blockingResolution: cfg.blockingResolution, frameResolution: cfg.frameResolution },
      keySource: process.env.FAL_KEY ? "environment" : cfg.apiKey ? "settings" : "none",
    });
  });
  /* CLAIM_RECOVERY_HEADER is sent by ONE caller — the browser's initial ledger load —
     and it is what takes delivery of the background-recovery notice. Every other reader
     of this route, including the activity drawer's 3.5-second refresh, leaves the notice
     where it is, so a result collected while nobody was watching is announced once to
     the next window that opens rather than on every poll.

     A HEADER RATHER THAN A QUERY PARAMETER, deliberately. Which request claims the
     notice is a property of the requester, not of the resource, and the URL of this
     route is matched exactly by suites and guards that have nothing to do with this
     — tests/ui-state-stability-real-browser.py fulfils `suffix == "/api/generation/fal/jobs"`
     and proxies anything else upstream. Adding a query string would have changed what
     those matched, in a surface no Node suite can execute. */
  app.get("/api/generation/fal/jobs", (req, res) => {
    try {
      const owner = captureOwner();
      const shotId = String(req.query.shotId || ""), entityId = String(req.query.entityId || ""), entityList = String(req.query.entityList || "");
      const jobs = readJobs(owner).filter((job) => (!shotId || String(job.shotId) === shotId) && (!entityId || String(job.entityId) === entityId) && (!entityList || String(job.entityList) === entityList));
      const recovery = unattendedRecoveryNotice(owner.slug, { claim: String(req.headers?.[CLAIM_RECOVERY_HEADER] || "") === "1" });
      res.json({ jobs: jobs.map(publicJob), ...(recovery ? { backgroundRecovery: recovery } : {}) });
    } catch (error) {
      res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
  });
  /* What WILL be sent, compiled and shown before anything is charged.
   *
   * The dialog used to display the prompt-engine's own text and the server used to
   * dispatch it, so "what you see" and "what is sent" were the same string by accident.
   * They are the same string here by construction: this route runs the identical
   * compilation the submission runs, and the compiler is deterministic — no clock, no
   * network, no assistant — so the same shot, package and settings produce the same
   * plan on both sides.
   *
   * Nothing durable is written and no provider is contacted. */
  app.post("/api/generation/fal/h3/plan", (req, res) => {
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    let compiled;
    try {
      compiled = compileH3ExecutionPlan({
        project: ownerProject(owner),
        shotId: String(req.body?.shotId || ""),
        buildId: String(req.body?.sourceBuildId || ""),
        mode: String(req.body?.profileMode || ""),
        durationSeconds: req.body?.durationSeconds,
        /* Same rule as the still-image preview: an explicit choice wins, and silence
           means the resolution the filmmaker saved rather than the pack's own. The paid
           submit has always read cfg.h3Resolution this way; the preview had not, so the
           dialog opened on a value Settings could not change. */
        resolution: String(req.body?.resolution || config().h3Resolution || ""),
        aspectRatio: String(req.body?.aspectRatio || ""),
        submittedPrompt: req.body?.prompt,
      });
    } catch (error) {
      return h3Refusal(res, error);
    }
    const plan = compiled.plan;
    const extensions = plan.settings?.extensions?.[plan.model?.modelId] || {};
    /* Serialised too, so an over-limit prompt or an unsendable reference is reported on
       the way IN rather than discovered when the filmmaker presses the paid button. */
    let dispatch = null;
    let refusal = null;
    try {
      const serialized = serializeH3PlanForFal(plan, compiled.capability, {
        resolveReference: (row) => { planReferenceAddress(owner, row); return "preflight"; },
        config: config(),
        ...(compiled.promptEdited ? { promptOverride: compiled.submittedPrompt } : {}),
      });
      dispatch = { model: serialized.model, backendId: serialized.backendId, bindings: serialized.bindings };
    } catch (error) {
      const typed = error instanceof H3BackendError || error instanceof H3ExecutionError;
      refusal = { error: error?.message || "This package cannot be submitted.", code: typed ? error.code : "H3_PREPARATION_FAILED", detail: typed ? error.detail : {} };
    }
    res.json({
      ok: !refusal,
      refusal,
      dispatch,
      mode: compiled.mode,
      profile: compiled.profile,
      source: compiled.source,
      compiledPrompt: compiled.compiledPrompt,
      compiledPromptCharacters: compiled.compiledPrompt.length,
      /* The one number the dialog may show as "the limit". It is the intersection of
         what MiniMax H3 reads and what fal accepts, never either one on its own. */
      maxPromptCharacters: compiled.capability.maxPromptCharacters,
      modelMaxPromptCharacters: compiled.model.maxPromptCharacters,
      backendMaxPromptCharacters: FAL_H3_BACKEND.maxPromptCharacters,
      durationSeconds: Number(plan.output?.durationSeconds) || null,
      /* Both numbers, always. Where they differ the shot asked for something this
         backend cannot render, and the dialog has to say that rather than present the
         adjusted value as the request. A paid submission refuses the difference. */
      durationRequested: compiled.durationRequested,
      durationRange: compiled.capability.durationSeconds,
      modelDurationRange: compiled.model.durationSeconds,
      resolution: extensions.resolution || "",
      resolutions: compiled.capability.resolutions,
      aspectRatio: compiled.aspect.carriesAspectRatio ? String(extensions.ratio || compiled.aspect.value || "") : "",
      carriesAspectRatio: compiled.aspect.carriesAspectRatio,
      endpoints: plan.endpoints,
      references: plan.inputs.references.map((row) => ({
        refId: row.refId, role: row.role, mediaType: row.mediaType, order: row.order,
        required: row.required, label: row.production?.label || "", purpose: row.production?.purpose || "",
      })),
      coverage: plan.coverage,
      warnings: plan.warnings,
      /* Only present when the caller sent edited text. Names what the compiler wrote and
         the edit removed, so a filmmaker can see the cost of their own change before
         paying for it — and can decide it was worth it. */
      editedCoverage: compiled.editedCoverage,
      promptEdited: compiled.promptEdited,
      compiler: plan.compiler,
      seedSupported: !!compiled.capability.flags?.seed,
    });
  });
  /* The same preview for a still frame. Nothing durable is written and no provider is
     contacted; the compilation is the identical one the submission runs. */
  app.post("/api/generation/fal/image/plan", (req, res) => {
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    let compiled;
    try {
      const purpose = String(req.body?.purpose || "frame");
      compiled = compileImageExecutionPlan({
        project: ownerProject(owner),
        purpose,
        shotId: String(req.body?.shotId || ""),
        buildId: String(req.body?.sourceBuildId || ""),
        aspectRatio: String(req.body?.aspectRatio || ""),
        /* The preview IS the dialog's initial state, so the saved defaults have to
           reach the compiler here or the dialog opens on values nobody chose. */
        ...savedImageSettings(purpose, req.body),
        candidateCount: req.body?.outputCount,
        submittedPrompt: req.body?.prompt,
      });
    } catch (error) {
      return imageRefusal(res, error);
    }
    const plan = compiled.plan;
    /* Serialised too, so an unsendable size or a missing reference file is reported on
       the way IN rather than discovered when the filmmaker presses the paid button. */
    let dispatch = null;
    let refusal = null;
    try {
      const serialized = serializeImagePlanForFal(plan, compiled.capability, {
        resolveReference: (row) => { planReferenceAddress(owner, row); return "preflight"; },
        config: config(),
        ...(compiled.promptEdited ? { promptOverride: compiled.submittedPrompt } : {}),
      });
      dispatch = { model: serialized.model, backendId: serialized.backendId, bindings: serialized.bindings };
    } catch (error) {
      const typed = error instanceof FalImageBackendError || error instanceof ImageExecutionError;
      refusal = { error: error?.message || "This package cannot be submitted.", code: typed ? error.code : "IMAGE_PREPARATION_FAILED", detail: typed ? error.detail : {} };
    }
    res.json({
      ok: !refusal,
      refusal,
      dispatch,
      mode: compiled.mode,
      purpose: compiled.purpose,
      profile: compiled.profile,
      source: compiled.source,
      compiledPrompt: compiled.compiledPrompt,
      compiledPromptCharacters: compiled.compiledPrompt.length,
      /* Null where neither the model nor the backend documents a ceiling, which is the
         honest answer for this family and is not the same as zero. */
      maxPromptCharacters: compiled.capability.maxPromptCharacters,
      modelMaxPromptCharacters: compiled.model.maxPromptCharacters,
      size: compiled.size,
      sizes: compiled.capability.resolutions,
      quality: compiled.quality,
      qualityTiers: compiled.model.qualityTiers,
      outputCount: compiled.candidateCount,
      aspectRatio: compiled.aspectRatio,
      maxReferenceImages: compiled.capability.maxReferenceImages,
      references: plan.inputs.references.map((row) => ({
        refId: row.refId, role: row.role, mediaType: row.mediaType, order: row.order,
        required: row.required, label: row.production?.label || "", purpose: row.production?.purpose || "",
      })),
      coverage: plan.coverage,
      warnings: plan.warnings,
      editedCoverage: compiled.editedCoverage,
      promptEdited: compiled.promptEdited,
      compiler: plan.compiler,
      seedSupported: !!compiled.capability.flags?.seed,
    });
  });

  /* WHAT CAN BE PRESSED, and why the rest cannot.
   *
   * One route for every filmmaker task, so the picker on a blocking frame and the
   * picker on a motion pass are the same code answering the same six questions. The
   * connection map is read here because only the server can see a key; the adapter
   * inventory comes from generation-options.js because only code knows what CineBraid
   * can serialise; and neither is inferred from the catalogue. */
  app.post("/api/generation/options", (req, res) => {
    try {
      const references = Array.isArray(req.body?.references) ? req.body.references : [];
      const inputs = {
        references: references.map((row) => ({
          role: String(row?.role || "reference"),
          mediaType: String(row?.mediaType || "image"),
        })),
      };
      const resolved = generationOptionsFor({
        task: String(req.body?.task || ""),
        inputs,
        request: {
          references: inputs.references,
          ...(Number(req.body?.durationSeconds) > 0 ? { durationSeconds: Number(req.body.durationSeconds) } : {}),
        },
        config: readConfig(),
      });
      res.json({
        task: resolved.task,
        taskLabel: resolved.taskLabel,
        taskSummary: resolved.taskSummary,
        outputType: resolved.outputType,
        modes: resolved.modes,
        options: resolved.options,
        normal: resolved.normal.map((option) => option.optionId),
        /* The use-case guide verbatim, decision state included. A screen renders
           "awaiting evaluation" from this and never fills a slot itself. */
        guide: resolved.guide
          ? {
            useCase: resolved.guide.useCase,
            headline: resolved.guide.headline,
            decisionState: resolved.guide.decision?.state || "",
            recommended: resolved.guide.decision?.recommended || null,
            localOption: resolved.guide.decision?.localOption || null,
            premiumAlternative: resolved.guide.decision?.premiumAlternative || null,
          }
          : null,
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Could not resolve generation options." });
    }
  });

  app.post("/api/generation/fal/test", (req, res) => {
    const cfg = config();
    if (!cfg.enabled) return res.status(400).json({ error: "Enable FAL image generation first." });
    if (!cfg.apiKey) return res.status(400).json({ error: "Add a FAL API key or set FAL_KEY on the server." });
    res.json({ ok: true, message: "FAL is configured. The first generation will verify the key with fal.", textModel: cfg.textModel, editModel: cfg.editModel });
  });
  app.post("/api/generation/fal/jobs", async (req, res) => {
    const cfg = config();
    /* Captured before the first await. Everything this request writes — the
       ledger row, the downloaded media, the project document — is addressed
       through this record, so switching projects mid-generation cannot redirect
       it. A corrupt ledger refuses here rather than presenting an empty history
       that would free the concurrency guard and re-dispatch paid work. */
    let owner, jobs;
    try {
      owner = captureOwner();
      jobs = readJobs(owner);
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    if (!cfg.enabled) return res.status(400).json({ error: "FAL generation is disabled in Settings." });
    if (!cfg.apiKey) return res.status(400).json({ error: "FAL API key is not configured." });
    const automationRunId = String(req.body?.automationRunId || "").trim();
    const automationStepKey = String(req.body?.automationStepKey || "").trim();
    if (automationRunId && automationStepKey) {
      const existing = jobs.find((item) => item.automationRunId === automationRunId && item.automationStepKey === automationStepKey);
      if (existing) return res.json({ ok: true, reused: true, job: publicJob(existing) });
    }
    const clientRequestId = String(req.body?.clientRequestId || "").trim();
    if (clientRequestId) {
      const existingByRequest = jobs.find((item) => String(item.clientRequestId || "") === clientRequestId);
      if (existingByRequest) return res.json({ ok: true, reused: true, job: publicJob(existingByRequest) });
    }
    const requestedEntityList = String(req.body?.entityList || "");
    const requestedEntityId = String(req.body?.entityId || "");
    const requestedCoverageJobType = String(req.body?.coverageJobType || "");
    const requestedCoverageSheetType = String(req.body?.coverageSheetType || "");
    const requestedCoverageSlotId = String(req.body?.targetCoverageSlotId || "");
    if (String(req.body?.purpose || "") === "entity-reference" && requestedEntityList && requestedEntityId && requestedCoverageJobType) {
      const duplicateActive = jobs.find((item) =>
        ["SUBMITTING", "IN_QUEUE", "IN_PROGRESS", "SUBMITTED"].includes(String(item.status || "").toUpperCase()) &&
        item.purpose === "entity-reference" &&
        String(item.entityList || "") === requestedEntityList &&
        String(item.entityId || "") === requestedEntityId &&
        String(item.coverageJobType || "") === requestedCoverageJobType &&
        String(item.coverageSheetType || "") === requestedCoverageSheetType &&
        String(item.targetCoverageSlotId || "") === requestedCoverageSlotId
      );
      if (duplicateActive) return res.json({ ok: true, reused: true, duplicatePrevented: true, job: publicJob(duplicateActive) });
    }
    /* THE DUPLICATE-PAID-WORK GUARD.
     *
     * An earlier submission for this same production result was sent and never answered.
     * It may be rendering right now and it may already have been charged for. Generating
     * again is the one action that turns an uncertainty into a certain second bill, and
     * it is also the most natural thing to reach for when a job looks like it failed —
     * which is precisely why UNRESOLVED is a separate state and why this refuses.
     *
     * Only a human who has gone and looked can clear it. There is deliberately no
     * time-based expiry: waiting is not evidence that a request was refused.
     *
     * Note what this does NOT do — it does not consume a concurrency slot. With a cap of
     * one or two, an unresolved job holding a slot forever would deadlock generation for
     * the whole project. Blocking the specific duplicate and leaving the global cap alone
     * is the narrower guarantee, and it is the one that matters. */
    const requestContext = Lifecycle.generationContextKey({
      purpose: String(req.body?.purpose || "frame"),
      shotId: String(req.body?.shotId || ""),
      entityList: String(req.body?.entityList || ""),
      entityId: String(req.body?.entityId || ""),
      frameId: String(req.body?.frameId || ""),
      sourceBuildId: String(req.body?.sourceBuildId || ""),
    });
    const unresolvedTwin = jobs.find((item) =>
      Lifecycle.blocksResubmission(item) && Lifecycle.generationContextKey(item) === requestContext);
    if (unresolvedTwin)
      return res.status(409).json({
        error: Lifecycle.resubmissionBlockReason(unresolvedTwin) === "unresolved"
          ? "CineBraid already sent this generation to the provider and never found out whether it was accepted. It may be running now and may already have been charged. Check the provider, then record what you found on that job before generating this again."
          : "CineBraid is still sending an earlier submission of this generation and has no provider reference for it yet. Wait for it to settle, or check the provider, before generating this again.",
        code: "GENERATION_UNRESOLVED",
        unresolvedJobId: unresolvedTwin.id,
        job: publicJob(unresolvedTwin),
      });
    if (activeCount(jobs) >= cfg.maxConcurrent) return res.status(409).json({ error: `FAL already has ${cfg.maxConcurrent} active CineBraid job${cfg.maxConcurrent === 1 ? "" : "s"}. Wait for completion or cancel it.` });
    const requestedPurpose = String(req.body?.purpose || "frame");
    const purpose = ["blocking", "frame", "correction", "entity-reference", "motion-h3"].includes(requestedPurpose) ? requestedPurpose : "frame";
    const requestedOutputCount = purpose === "motion-h3" ? 1 : clamp(req.body?.outputCount, purpose === "blocking" ? cfg.blockingOutputs : cfg.frameOutputs, 1, 4);
    const guardError = automationSubmissionError(owner, jobs, req.body, requestedOutputCount);
    if (guardError) return res.status(guardError.status).json({ error: guardError.message, code: guardError.code || "AUTOMATION_GUARD" });
    const refs = Array.isArray(req.body?.references) ? req.body.references.filter((ref) => ref && ref.url) : [];
    const edit = refs.length > 0;
    const job = {
      id: uid(),
      automationRunId,
      automationStepKey,
      automationRunnerId: String(req.body?.automationRunnerId || "").trim(),
      clientRequestId,
      provider: "fal",
      kind: purpose === "motion-h3" ? "motion-generation" : purpose === "correction" ? "candidate-correction-generation" : purpose === "entity-reference" ? "entity-reference-generation" : "image-generation",
      purpose,
      profileMode: String(req.body?.profileMode || ""),
      mode: purpose === "motion-h3" ? String(req.body?.profileMode || "i2v") : edit ? "edit" : "text-to-image",
      shotId: String(req.body?.shotId || ""),
      entityList: String(req.body?.entityList || ""),
      entityId: String(req.body?.entityId || ""),
      entityType: String(req.body?.entityType || ""),
      continuityStateId: String(req.body?.continuityStateId || ""),
      continuityStateName: String(req.body?.continuityStateName || ""),
      parentStateId: String(req.body?.parentStateId || ""),
      parentStateName: String(req.body?.parentStateName || ""),
      parentApprovedFile: String(req.body?.parentApprovedFile || ""),
      derivationMode: req.body?.derivationMode === "derive" ? "derive" : "independent",
      frameId: String(req.body?.frameId || ""),
      frameLabel: String(req.body?.frameLabel || "A"),
      sourceBuildId: String(req.body?.sourceBuildId || ""),
      packageId: String(req.body?.packageId || ""),
      profileId: String(req.body?.profileId || ""),
      profileName: String(req.body?.profileName || ""),
      profileFamily: String(req.body?.profileFamily || ""),
      parentBuildId: String(req.body?.parentBuildId || ""),
      parentPackageId: String(req.body?.parentPackageId || ""),
      sourceCandidate: String(req.body?.sourceCandidate || ""),
      guideAssetId: String(req.body?.guideAssetId || ""),
      coverageJobType: ["sheet", "slot", ""].includes(String(req.body?.coverageJobType || "")) ? String(req.body?.coverageJobType || "") : "",
      coverageSheetType: String(req.body?.coverageSheetType || ""),
      targetCoverageSlotId: String(req.body?.targetCoverageSlotId || ""),
      targetCoverageSlotName: String(req.body?.targetCoverageSlotName || ""),
      coverageSourceFile: String(req.body?.coverageSourceFile || ""),
      authorityContractVersion: String(req.body?.authorityContractVersion || ""),
      prompt: String(req.body?.prompt || "").trim(),
      references: refs.slice(0, 16).map((ref, index) => ({
        key: ref.key || `image-${index + 1}`,
        token: ref.token || `#image${index + 1}`,
        originalToken: ref.originalToken || "",
        label: ref.label || `Image ${index + 1}`,
        role: ref.role || "reference",
        instruction: ref.instruction || "",
        mediaType: ["image", "video", "audio"].includes(String(ref.mediaType || "").toLowerCase()) ? String(ref.mediaType).toLowerCase() : "",
        url: ref.url,
      })),
      outputCount: requestedOutputCount,
      quality: ["low", "medium", "high", "auto"].includes(req.body?.quality) ? req.body.quality : purpose === "blocking" ? cfg.blockingQuality : cfg.frameQuality,
      resolution: purpose === "motion-h3" ? (["768P", "2K"].includes(String(req.body?.resolution || "").toUpperCase()) ? String(req.body.resolution).toUpperCase() : cfg.h3Resolution) : (["1k", "2k", "4k"].includes(String(req.body?.resolution || "").toLowerCase()) ? String(req.body.resolution).toLowerCase() : (purpose === "blocking" ? cfg.blockingResolution : cfg.frameResolution)),
      /* Recorded as requested. For MiniMax H3 the compiled plan decides the value that
         is actually rendered, snapping it onto the effective range and warning about the
         difference; clamping here as well would apply a floor this module has no
         evidence for and would hide the adjustment. */
      durationSeconds: purpose === "motion-h3" ? Math.max(0, Math.round(Number(req.body?.durationSeconds) || 0)) : 0,
      aspectRatio: String(req.body?.aspectRatio || (purpose === "motion-h3" && String(req.body?.profileMode || "") === "r2v" ? "adaptive" : "16:9")),
      revisionRequest: String(req.body?.revisionRequest || "").trim(),
      revisedFromAssetId: String(req.body?.revisedFromAssetId || ""),
      createdAt: now(),
      updatedAt: now(),
      status: "SUBMITTING",
      outputs: [],
      error: "",
    };
    if (purpose === "motion-h3") {
      if (job.profileFamily !== "minimax-h3") return res.status(400).json({ error: "MiniMax H3 motion generation requires a minimax-h3 prompt profile." });
      if (!job.shotId) return res.status(400).json({ error: "shotId is required." });
      if (!["t2v", "i2v", "flf", "r2v"].includes(job.profileMode)) return res.status(400).json({ error: "Unsupported MiniMax H3 workflow mode." });
      /* Before the job record exists, before any state is written and before anything
         leaves this machine. A refused dispatch costs nothing and changes nothing:
         the prompt, frames, keyframes and settings the caller sent are simply not
         acted on, so the screen it came from still holds all of them. */
      const aspectGate = h3AspectGate(job);
      if (!aspectGate.ok)
        return res.status(400).json({
          error: aspectGate.message,
          code: "H3_ASPECT_UNSUPPORTED",
          requestedAspectRatio: aspectGate.requested,
          supportedAspectRatios: aspectGate.supported,
        });
      /* ONE compilation, here.
         Everything the provider is about to be told — the prompt, which frame opens the
         shot, which frame ends it, which references travel and what each is for, the
         duration, the format — is decided by this call and by nothing after it. The
         prompt, references and settings the caller posted are not the request; the
         shot's own approved package is, and this compiles it. */
      let compiled;
      try {
        compiled = compileH3ExecutionPlan({
          project: ownerProject(owner),
          shotId: job.shotId,
          buildId: job.sourceBuildId,
          mode: job.profileMode,
          durationSeconds: req.body?.durationSeconds,
          resolution: job.resolution,
          aspectRatio: job.aspectRatio,
          submittedPrompt: req.body?.prompt,
          /* A paid submission takes the requested duration or refuses it. It never
             quietly renders a different length than the one that was asked for. */
          enforceDuration: true,
        });
        applyCompilationToJob(job, compiled);
        /* Serialised against the effective capability with the provider call left out,
           so an over-limit prompt, an unsupported modality, a missing endpoint or a
           reference whose file has gone all refuse HERE — before a durable row exists,
           before anything leaves the machine, and before anything is charged. */
        const preflight = serializeH3PlanForFal(compiled.plan, compiled.capability, {
          resolveReference: (row) => { planReferenceAddress(owner, row); return "preflight"; },
          config: cfg,
          ...(job.promptEdited ? { promptOverride: job.prompt } : {}),
        });
        /* WHERE the paid request is about to go, recorded on the row BEFORE the row is
           committed — so it is durable before the POST rather than arriving with the
           response. A process that dies between sending and answering leaves a row that
           still names the endpoint, the backend and which reference filled which field,
           which is the difference between a reconcilable orphan and a mystery.
           Deterministic: submitH3 re-derives the identical values from the same plan. */
        job.model = preflight.model;
        job.modelFamily = preflight.modelFamily;
        job.backendId = preflight.backendId;
        job.providerBindings = preflight.bindings;
        job.submittedPromptCharacters = preflight.submittedPromptCharacters;
        /* WHAT IT WILL CONSUME, recorded beside WHERE it will go and for the same
           reason. submitH3 re-serializes the identical plan against the identical
           capability, so the set bound here is the set the provider receives. */
        applyBindingRecord(job, bindingRecordFor(owner, job, compiled, preflight));
      } catch (error) {
        return h3Refusal(res, error);
      }
    } else if (req.body?.imagePlan === true && ["blocking", "frame"].includes(purpose)) {
      /* ONE compilation, here.
         Everything the provider is about to be told — the prompt, which approved
         references travel and what each is for, the output size, the quality tier and
         how many options come back — is decided by this call and by nothing after it.
         The prompt and references the caller posted are not the request; the shot's
         own approved package is, and this compiles it. */
      if (!job.shotId) return res.status(400).json({ error: "shotId is required." });
      /* A blocking REVISION edits an existing attempt, and the compiled path does not
         carry one: blocking mode takes no references at all, so the source frame would
         be dropped without a word. Refused rather than half-converted — the revision
         flow still works, on the path it has always used. */
      if (purpose === "blocking" && (job.revisedFromAssetId || job.revisionRequest))
        return res.status(400).json({
          error: "Revising an existing blocking attempt does not use the compiled path yet. Generate a fresh blocking frame, or revise from the blocking panel.",
          code: "IMAGE_PLAN_REVISION_UNSUPPORTED",
        });
      let compiled;
      try {
        compiled = compileImageExecutionPlan({
          project: ownerProject(owner),
          purpose,
          shotId: job.shotId,
          buildId: job.sourceBuildId,
          aspectRatio: job.aspectRatio,
          /* The same resolution the preview used, so what was confirmed is what is
             charged for. A dialog that sent an explicit size still wins here. */
          ...savedImageSettings(purpose, req.body),
          candidateCount: requestedOutputCount,
          submittedPrompt: req.body?.prompt,
        });
        applyImageCompilationToJob(job, compiled);
        /* Serialised against the effective capability with the provider call left
           out, so an unsupported size, an over-limit reference set or a file that has
           gone all refuse HERE — before a durable row exists, before anything leaves
           the machine, and before anything is charged. */
        const preflight = serializeImagePlanForFal(compiled.plan, compiled.capability, {
          resolveReference: (row) => { planReferenceAddress(owner, row); return "preflight"; },
          config: cfg,
          ...(job.promptEdited ? { promptOverride: job.prompt } : {}),
        });
        /* WHERE the paid request is about to go, recorded on the row BEFORE the row is
           committed. Deterministic: submitImage re-derives the identical values from
           the same plan. */
        job.model = preflight.model;
        job.modelFamily = preflight.modelFamily;
        job.backendId = preflight.backendId;
        job.providerBindings = preflight.bindings;
        job.submittedPromptCharacters = preflight.submittedPromptCharacters;
        /* The same evidence the motion path records, on the same terms. A still image
           route that could not answer "which approved reference did this frame come
           from" would leave the identity question open on exactly the generations that
           produce the references everything else is built on. */
        applyBindingRecord(job, bindingRecordFor(owner, job, compiled, preflight));
      } catch (error) {
        return imageRefusal(res, error);
      }
    } else if (purpose === "entity-reference") {
      if (!["characters", "locations", "props", "vehicles"].includes(job.entityList)) return res.status(400).json({ error: "A supported entityList is required." });
      if (!job.entityId) return res.status(400).json({ error: "entityId is required." });
      const project = ownerProject(owner);
      const entity = (project[job.entityList] || []).find((item) => String(item.id) === job.entityId);
      if (!entity) return res.status(404).json({ error: "Entity no longer exists." });
      if (job.continuityStateId) {
        const state = (entity.continuityStates || []).find((item) => String(item?.id) === job.continuityStateId);
        if (!state) return res.status(400).json({ error: "Target continuity state no longer exists." });
        job.continuityStateName = job.continuityStateName || String(state.name || "State");
      }
      if (job.derivationMode === "derive" && (!job.references.length || job.references[0].role !== "base"))
        return res.status(400).json({ error: "Derived continuity-state generation requires the approved parent state as #image1 editable base." });
      if (job.derivationMode === "derive" && !job.parentApprovedFile)
        return res.status(400).json({ error: "Derived continuity-state generation requires parentApprovedFile provenance." });
    } else if (!job.shotId) return res.status(400).json({ error: "shotId is required." });
    if (!job.prompt) return res.status(400).json({ error: "Build a prompt before generating." });
    if (purpose === "correction" && (!job.references.length || job.references[0].role !== "base"))
      return res.status(400).json({ error: "Correction generation requires the failed candidate as #image1 editable base." });
    if (purpose === "correction" && !job.sourceCandidate) {
      const baseUrl = decodeURIComponent(String(job.references[0]?.url || "").split(/[?#]/)[0]);
      const parts = baseUrl.split("/").filter(Boolean), shotIndex = parts.indexOf("shots");
      if (shotIndex >= 0 && parts[shotIndex + 1] === job.shotId && parts[shotIndex + 2] === "takes" && parts[shotIndex + 3]) {
        job.sourceCandidate = path.basename(parts.slice(shotIndex + 3).join("/"));
        job.provenanceRecovered = true;
      }
    }
    if (purpose === "correction" && !job.sourceCandidate)
      return res.status(400).json({ error: "Correction generation requires sourceCandidate provenance and no safe editable-base filename could be recovered.", code: "SOURCE_CANDIDATE_REQUIRED" });
    /* ======================================================================
       THE UNIVERSAL FINAL PRE-PROVIDER FRAME-PRESENCE GATE.
       Dogfood #2 A3 / forensic F6, and the boundary the acceptance audit said
       was missing.

       EVERY frame-specific paid image request in CineBraid reaches this line —
       the generation picker, manual frame and blocking generation, full-shot
       automation, scene automation, candidate correction, scene continuity
       correction, retries and any future caller — because they all POST here.
       The compiled-plan branch above is optional and `imagePlan`-gated; THIS IS
       NOT. There is no request body, no purpose and no caller convention that
       skips it.

       It runs LAST, on `job.prompt` as it now stands: after the image plan may
       have replaced it, after a filmmaker's edit, after a correction's revision
       text was appended. The audit's objection to checking at compile time was
       precisely that the text can change afterwards; this reads what is about
       to be sent.

       And it runs BEFORE `submissionAccounting`, before `commit()` and before
       `submit()`. A refusal therefore creates no durable job row, contacts no
       provider, spends no money and consumes no retry budget — the caller sees
       a typed local refusal, and the screen it came from still holds everything
       it was about to send. */
    const presenceGate = FramePresence.finalDispatchPresenceGate({
      project: ownerProject(owner),
      purpose,
      shotId: job.shotId,
      frameId: job.frameId,
      prompt: job.prompt,
      references: job.references,
      /* K3A: the structured half. When the caller compiled through CineBraid it
         sends the entity ids the compiler positively asserted, and the gate
         compares id lists rather than reading English. Absent, the text check
         below still runs — this makes the common path exact, not the only path
         safe. */
      assertedEntityIds: Array.isArray(req.body?.assertedEntityIds) ? req.body.assertedEntityIds : [],
    });
    if (!presenceGate.ok)
      return res.status(409).json({
        error: presenceGate.message,
        code: presenceGate.code,
        classification: presenceGate.classification,
        contradictions: presenceGate.contradictions,
        absentEntityIds: presenceGate.absentEntityIds || [],
        shotId: job.shotId,
        frameId: job.frameId,
        providerContacted: false,
        paidRequestSubmitted: false,
      });
    /* THE UNCOMPILED ROUTES, PREPARED AND RECORDED HERE.
     *
     * `entity-reference`, `correction` and `frame`/`blocking` without `imagePlan` reach
     * the provider through `submit()`'s own payload builder rather than through a
     * compiled plan. They were left uninstrumented in the first pass, and the effect was
     * not "less provenance": a newly dispatched job with no binding is byte-for-byte the
     * representation reserved for jobs that predate this record — `recorded: false`,
     * `bindings: null` — so every new legacy dispatch was writing a false claim about
     * its own age.
     *
     * The payload is built, the binding is frozen from that same payload, and only then
     * does the row commit. `submit()` is handed the prepared payload rather than
     * building a second one, so what was recorded and what is sent are the same object.
     *
     * A FAILURE HERE REFUSES. Nothing has been committed and nothing has been sent, so
     * the cost of refusing is zero — and the alternative is dispatching paid work whose
     * record would claim it was made before any of this existed. */
    let preparedLegacy = null;
    if (legacyDispatch(job)) {
      try {
        preparedLegacy = serializeLegacyRequest(owner, job, cfg);
        applyBindingRecord(job, bindingRecordFor(
          owner,
          job,
          { plan: preparedLegacy.planView, sourceReferences: preparedLegacy.sourceReferences },
          preparedLegacy,
        ));
        job.model = preparedLegacy.model;
        job.modelFamily = preparedLegacy.modelFamily;
        job.providerBindings = preparedLegacy.bindings;
      } catch (error) {
        const typed = error instanceof GenerationBindingError;
        return res.status(typed ? error.status : 400).json({
          error: error.message,
          ...(typed ? { code: error.code, detail: error.detail } : {}),
          providerContacted: false,
          paidRequestSubmitted: false,
        });
      }
    }
    /* WHAT THIS WAS ESTIMATED TO COST, decided HERE and never again.
     *
     * Last thing before the row becomes durable, so it is computed against the
     * quantity that is actually about to be dispatched — the compiled image path
     * settles `outputCount` on the plan, and recording the number the caller asked
     * for would describe a job nobody submitted.
     *
     * The rate comes from the configuration in effect at THIS moment. Editing that
     * rate in Settings tomorrow changes what tomorrow's job is estimated at and
     * changes nothing about this one, which is the entire point: a row carries what
     * it was estimated to cost, not what today's policy would re-quote it at. */
    job.accounting = submissionAccounting({
      purpose: job.purpose,
      outputCount: job.outputCount,
      ratePerImage: cfg.estimatedCostPerImage,
      at: now(),
    });
    /* The row is committed against CURRENT durable state, not against the
       snapshot this request read minutes ago — a job created by an overlapping
       request in between must survive. */
    try {
      await commit(owner, (current) => { current.push(job); });
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    try {
      const outcome = await submit(owner, job, job.references, preparedLegacy);
      try {
        await commit(owner, (current) => {
          const row = current.find((item) => item.id === job.id);
          if (row) mergeJobOutcome(row, { ...outcome, status: outcome.status, updatedAt: now() }, { authoritative: true });
          Object.assign(job, row || {});
        });
      } catch (persistError) {
        /* The provider ACCEPTED — we are holding its request id — and the ledger write
           failed. Calling that FAILED would be the worst answer available: a render is
           running, it has been charged for, and the record would say it never happened.
           Recorded as unresolved, carrying the identifier so it can still be followed. */
        await commit(owner, (current) => {
          const row = current.find((item) => item.id === job.id);
          if (!row) return;
          row.status = Lifecycle.UNRESOLVED;
          row.providerContacted = true;
          row.providerAnswered = true;
          row.externalId = row.externalId || outcome.externalId || "";
          row.unresolvedReason = `The provider accepted this request${outcome.externalId ? ` as ${outcome.externalId}` : ""}, but CineBraid could not record the result: ${persistError.message}`;
          row.unresolvedAt = now();
          row.updatedAt = now();
          Object.assign(job, row);
        }).catch(() => {});
        return res.status(502).json({
          error: job.unresolvedReason || persistError.message,
          code: "GENERATION_UNRESOLVED",
          job: publicJob(job),
        });
      }
      res.json({ ok: true, job: publicJob(job) });
    } catch (error) {
      /* What the failure ESTABLISHED, decided by the generic lifecycle rules rather than
         here. A request that was sent and never answered is not a known failure, and the
         durable state has to say which of the two this was — the difference decides
         whether "Generate again" is safe. */
      const verdict = Lifecycle.describeSubmissionFailure(error);
      await commit(owner, (current) => {
        const row = current.find((item) => item.id === job.id);
        if (row) {
          row.status = verdict.status;
          row.error = error.message;
          row.providerContacted = verdict.providerContacted;
          row.providerAnswered = verdict.providerAnswered;
          if (verdict.status === Lifecycle.UNRESOLVED) {
            row.unresolvedReason = verdict.reason;
            row.unresolvedAt = now();
          }
          row.updatedAt = now();
          Object.assign(job, row);
        }
      }).catch(() => {});
      updateEntityCoverageRun(owner, job, "needs-attention", error.message);
      res.status(502).json({
        error: error.message,
        ...(verdict.status === Lifecycle.UNRESOLVED ? { code: "GENERATION_UNRESOLVED" } : {}),
        job: publicJob(job),
      });
    }
  });

  /* The way out of UNRESOLVED, and the only one that does not involve guessing.
   *
   * A person goes and looks at the provider and records what they found. CineBraid never
   * infers this: no time-based expiry, no "probably failed by now". Waiting is not
   * evidence that a request was refused, and a job that quietly aged into FAILED would
   * put the duplicate-charge back exactly where this phase removed it from. */
  app.post("/api/generation/fal/jobs/:id/reconcile", async (req, res) => {
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    const outcome = String(req.body?.outcome || "");
    if (!Lifecycle.isReconciliationOutcome(outcome))
      return res.status(400).json({
        error: `Record what you found at the provider: ${Object.keys(Lifecycle.RECONCILIATION_OUTCOMES).join(" or ")}.`,
        code: "GENERATION_RECONCILE_OUTCOME_REQUIRED",
      });
    return guardRoute(res, serializeJobOperation(owner, req.params.id, async () => {
      let job;
      try {
        job = readJobs(owner).find((item) => item.id === req.params.id);
      } catch (error) {
        return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
      }
      if (!job) return res.status(404).json({ error: "Generation job not found." });
      if (!Lifecycle.isUnresolved(job))
        return res.status(409).json({
          error: "Only a job whose provider outcome is unknown can be reconciled.",
          code: "GENERATION_NOT_UNRESOLVED",
        });
      const mutation = Lifecycle.reconcileUnresolved(job, outcome, {
        at: now(),
        by: "user",
        note: String(req.body?.note || "").slice(0, 500),
      });
      try {
        await commit(owner, (current) => {
          const row = current.find((item) => item.id === job.id);
          if (!row) return;
          /* Applied ON TOP of the record, never in place of it. The compiled plan, the
             endpoint, the bindings and the fact that this was once unresolved all
             survive — a reconciled job must still be able to explain itself. */
          row.status = mutation.status;
          row.reconciliation = mutation.reconciliation;
          row.updatedAt = now();
          Object.assign(job, row);
        });
      } catch (error) {
        return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
      }
      res.json({ ok: true, job: publicJob(job) });
    }));
  });
  /* ---- THE ONE COLLECTION PATH ------------------------------------------------
   *
   * Ask the provider what happened to a request that has ALREADY been submitted, and
   * take delivery of the result if there is one. This is the body POST .../refresh has
   * always run; it is a function now because the server-side ingest reaper
   * (generation-poller.js) has to run the SAME path rather than a second one that
   * would drift from it. Nothing here can create provider work: it reaches the network
   * only through refresh(), which fetches `statusUrl`, fetches `responseUrl`, and
   * downloads the assets those name.
   *
   * Still serialised per job, for the reason it always was: two overlapping
   * collections must not both observe `!ingestedAt` and ingest the same paid result
   * twice. The job is re-read INSIDE the turn, so the second one observes the first's
   * durable outcome instead of the snapshot it queued with. That is also what makes a
   * browser tab and this server polling the same job at the same time safe.
   *
   * `markFailureOnError` is the one difference between the two callers, and it is a
   * difference about who asked. A person pressing Refresh has established that they
   * want an answer now, and a failed round-trip is an answer they should see on the
   * job. A background sweep has established nothing: writing FAILED because a network
   * blip lost one status request would mark a live, paid, in-queue render as finished
   * and — because FAILED does not block resubmission — invite a second one. The reaper
   * therefore commits NOTHING when it cannot ask, and tries again later. */
  async function collectJob(owner, jobId, options = {}) {
    const markFailureOnError = options.markFailureOnError !== false;
    const unattended = options.unattended === true;
    return serializeJobOperation(owner, jobId, async () => {
      const job = readJobs(owner).find((item) => item.id === jobId);
      if (!job) return { ok: false, outcome: "not-found", error: "Generation job not found." };
      /* An unresolved job with no request id has nothing to poll. Pretending otherwise
         would fetch an empty URL and report the resulting error as though the provider
         had answered — inventing a status out of a failure. */
      if (Lifecycle.isUnresolved(job) && !job.externalId)
        return {
          ok: false,
          outcome: "no-handle",
          code: "GENERATION_UNRESOLVED_NO_HANDLE",
          job,
          error: "CineBraid never received a request id for this submission, so there is nothing it can check. Look for it at the provider and record what you find.",
        };
      const deliveredBefore = !!job.ingestedAt;
      try {
        await refresh(owner, job);
        await commit(owner, (current) => {
          const row = current.find((item) => item.id === job.id);
          /* Authoritative: this status came from the provider itself, so it is allowed
             to resolve an unresolved job in either direction. */
          if (row) Object.assign(job, mergeJobOutcome(row, job, { authoritative: true }));
          else current.push(job); // the row vanished underneath us; do not lose it
        });
        /* COLLECTED means THIS call took delivery — it went in without an ingest stamp
           and came out with one. A job that was already delivered is not counted again,
           which is what keeps a duplicate tick, a duplicate tab, or a tab and the reaper
           together from reporting the same result twice. */
        const collected = !deliveredBefore && !!job.ingestedAt;
        if (collected && unattended) recordUnattendedCollection(owner, job);
        return { ok: true, outcome: "polled", job, collected, outputs: collected ? (job.outputs || []).length : 0 };
      } catch (error) {
        if (markFailureOnError)
          await commit(owner, (current) => {
            const row = current.find((item) => item.id === job.id);
            if (row) {
              /* A poll that FAILED is not a provider answer, so it is never authoritative:
                 an unresolved job stays unresolved. Not being able to ask is not an answer,
                 and every other status keeps its existing behaviour. */
              row.status = Lifecycle.nextStatus(row.status, "FAILED", {
                ingested: !!row.ingestedAt,
                authoritative: false,
              });
              row.error = error.message;
              row.updatedAt = now();
              Object.assign(job, row);
            }
          }).catch(() => {});
        return { ok: false, outcome: "provider-error", job, error: error.message };
      }
    });
  }
  app.post("/api/generation/fal/jobs/:id/refresh", async (req, res) => {
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    return guardRoute(res, collectJob(owner, req.params.id).then((result) => {
      if (result.ok) return res.json({ ok: true, job: publicJob(result.job) });
      if (result.outcome === "not-found") return res.status(404).json({ error: result.error });
      if (result.outcome === "no-handle")
        return res.status(409).json({ error: result.error, code: result.code, job: publicJob(result.job) });
      updateEntityCoverageRun(owner, result.job, "needs-attention", result.error);
      res.status(502).json({ error: result.error, job: publicJob(result.job) });
    }));
  });
  app.post("/api/generation/fal/jobs/:id/cancel", async (req, res) => {
    const cfg = config();
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    return guardRoute(res, serializeJobOperation(owner, req.params.id, async () => {
      let job;
      try {
        job = readJobs(owner).find((item) => item.id === req.params.id);
      } catch (error) {
        return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
      }
      if (!job) return res.status(404).json({ error: "Generation job not found." });
      /* Cancelling an unresolved job with no provider handle would write CANCELLED over
         a request that may well be rendering — turning an honest "unknown" into a
         confident falsehood, and unblocking the retry that this state exists to hold.
         There is nothing to cancel; there is something to go and check. */
      if (Lifecycle.isUnresolved(job) && !job.cancelUrl)
        return res.status(409).json({
          error: "CineBraid never received a handle for this submission, so it cannot cancel it. The generation may be running at the provider. Check there, then record what you found on this job.",
          code: "GENERATION_UNRESOLVED_NO_HANDLE",
          job: publicJob(job),
        });
      if (job.cancelUrl && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
        await fetch(job.cancelUrl, { method: "PUT", headers: { Authorization: `Key ${cfg.apiKey}` } }).catch(() => null);
      }
      try {
        await commit(owner, (current) => {
          const row = current.find((item) => item.id === job.id);
          if (!row) return;
          /* A cancel that lands after the result was already ingested must not
             erase the delivery the user paid for. */
          if (!(row.status === "COMPLETED" && row.ingestedAt)) row.status = "CANCELLED";
          row.updatedAt = now();
          Object.assign(job, row);
        });
      } catch (error) {
        return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
      }
      updateEntityCoverageRun(owner, job, "cancelled", "Provider job cancelled by user.");
      res.json({ ok: true, job: publicJob(job) });
    }));
  });

  /* What this module exposes to callers that are not routes.
   *
   * `repairJobMediaIdentity` is the P4-SEM-C4 repair, so POST /api/media/rename can
   * keep the generation ledger truthful without becoming a second writer of it.
   *
   * `recovery` is the ingest reaper's whole surface, and its shape is the guarantee.
   * It can read the durable ledger, and it can COLLECT — ask about a request the
   * provider was already given and take delivery of what came back. There is no
   * submit, no retry, no repair-and-retry, no job constructor and no route handle in
   * it, so a poller holding this object has nothing that could start paid work even if
   * it tried. Everything it does goes through the same serialised turn, the same
   * lifecycle rules and the same commit chain as the browser's own Refresh. */
  return {
    repairJobMediaIdentity,
    recovery: {
      /* Whether asking the provider anything is possible at all. Not configured is not
         a job failure and must never be recorded as one — it is a reason to do nothing. */
      providerReady() {
        const cfg = config();
        return cfg.enabled === true && Boolean(cfg.apiKey);
      },
      ownerFor: ownerForSlug,
      /* Throws JobLedgerUnreadableError on a corrupt ledger, exactly as every other
         reader does. A sweep must skip that project, never rewrite it. */
      jobsFor: readJobs,
      collect: collectJob,
    },
  };
}

module.exports = { registerFalGeneration, CLAIM_RECOVERY_HEADER };

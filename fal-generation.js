/* CineBraid v6.2 — optional server-side fal image generation.
   Manual copy/generate/return remains fully supported. */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAspectRatio, h3AspectSupport, shotAspectLabel, referenceAspectLabel } = require("./public/shared-aspect");
const { readJobLedger, writeJobLedgerSync, JobLedgerUnreadableError } = require("./generation-job-store");
/* WHICH AUTHORIZATION A PAID DISPATCH BELONGS TO. Locates the record that owns the
   ceiling; owns no ceiling, no price and no plan of its own. See the module header. */
const PaidPermit = require("./paid-dispatch-permit");
const { jobOutputsForRename, repairJobOutputIdentity } = require("./public/shared-media-disposition");
const { compileH3ExecutionPlan, h3ControlCapability, planProvenance, H3ExecutionError } = require("./h3-execution");
const { serializeH3PlanForFal, H3BackendError, FAL_H3_BACKEND } = require("./fal-h3-backend");
const { compileImageExecutionPlan, imageControlCapability, imagePlanProvenance, ImageExecutionError, IMAGE_MODEL_ID } = require("./image-execution");
const { serializeImagePlanForFal, FalImageBackendError, FAL_IMAGE_BACKEND } = require("./fal-image-backend");
const { generationOptionsFor, generationConnections } = require("./generation-options");
const { INTENT_FIELDS } = require("./generation-compiler");
const { generationBindingRecord, GenerationBindingError } = require("./generation-binding");
const { submissionAccounting, summarizeRecordedCost } = require("./generation-cost");
const { configuredMotionRate, configuredImageRate, costEstimateFromRate, usdExceeds } = require("./public/shared-generation-rate");
const { guidePayload } = require("./generation-options");
const Lifecycle = require("./generation-lifecycle");
const FramePresence = require("./public/shared-frame-presence");
/* THE PAYLOAD GATE, ON THE SERVER. public/shared-generation-presentation.js is the
   module every dialog already restricts its body through; requiring it here is what
   moves that guarantee from a browser convention to the boundary that spends money.
   The policy is not reimplemented - this file calls restrictPayloadToPlan() itself. */
const Presentation = require("./public/shared-generation-presentation");
const BuildHistory = require("./public/shared-build-history");
const { generationOptionIdentityFor } = require("./generation-options");

/* The request that takes delivery of the background-recovery notice says so here rather
   than in the URL. See the GET /api/generation/fal/jobs route for why. Lowercase because
   that is how Node presents an incoming header name. */
const CLAIM_RECOVERY_HEADER = "x-cinebraid-claim-recovery";

/* THE FILMMAKER'S OWN WORD FOR AN INTENT KEY.
 *
 * The compiler has always emitted coverage as `{ intent: "camera.movement", state, via }`
 * and a screen has no business turning "camera.movement" into "camera movement" itself:
 * the label is already written down, once, beside the field that reads the intent, in
 * generation-compiler.js's INTENT_FIELDS. This joins the two on the way out so the dialog
 * renders the authority's words rather than a prettified key.
 *
 * `reproducibility.seed` is the one intent with no INTENT_FIELDS row - it is not read off
 * the shot, it is a request parameter - so it is named here and nowhere else.
 *
 * A JOIN, NOT A COMPUTATION. No entry is added, removed, reordered or re-judged; every
 * state and every reason is the compiler's, unchanged. */
const INTENT_LABELS = new Map([
  ...INTENT_FIELDS.map((field) => [field.key, field.label]),
  ["reproducibility.seed", "seed"],
]);
function labelledCoverage(coverage) {
  return (Array.isArray(coverage) ? coverage : []).map((entry) => ({
    ...entry,
    label: INTENT_LABELS.get(String(entry?.intent || "")) || String(entry?.intent || ""),
  }));
}

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

  /* ---- one project-write turn per project ------------------------------------

     THE SAME ARGUMENT AS `commit` ABOVE, FOR THE OTHER DURABLE RECORD.

     `commit` ended the snapshot-clobbering defect on the generation ledger. The
     PROJECT document still had exactly that shape in it. Every ingest read the whole
     project, awaited downloads for seconds, mutated its own copy, and wrote it whole:

         const P = ownerProject(owner);   // snapshot
         ... await download ...           // seconds of network
         saveOwnerProject(owner, P);      // snapshot wins

     Per-JOB serialisation did not help, because its key is the job. Two DIFFERENT
     jobs of the same project — a background sweep collecting one while a browser
     refresh collects another — each held a snapshot across their own downloads, and
     whichever saved last silently dropped the other's candidate row. The bytes stayed
     on disk and BOTH ledger rows still said `ingestedAt`, so an already-paid result
     became an unreferenced file that the record claimed had been delivered.

     `commitProject` serialises project writes per PROJECT and RE-READS the document
     inside its own turn, so a mutation always applies to current state rather than to
     what the caller read before its downloads. `mutate` is synchronous by contract and
     must not await: that is what makes the turn indivisible, and it is also what makes
     the file writes inside it safe — two collections can no longer pick the same
     filename, because `nextFile` and `writeFileSync` run inside the same turn.

     KEYED ON owner.dir, deliberately. Two different projects never wait on each other;
     a background sweep of project B cannot be the reason a save in project A is slow.
     The narrowest key that still protects the record being written. */
  const projectChains = new Map();
  function commitProject(owner, mutate) {
    const key = owner.dir;
    const previous = projectChains.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => {
      const project = ownerProject(owner);
      const result = mutate(project);
      saveOwnerProject(owner, project);
      return result;
    });
    projectChains.set(key, next.catch(() => {}));
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
  /* ---- what the SERVER took delivery of ---------------------------------------
   *
   * A result collected by the ingest reaper's sweep rather than by a browser refresh.
   * Kept per project and only for the life of this process: it is a notice, not a
   * record. What actually happened is durable on the job row and in the project — the
   * outputs, the ingest stamp, the candidate files — and this exists so the next window
   * that opens is TOLD, instead of the work appearing in a list with no explanation of
   * when it arrived.
   *
   * WHAT THIS KNOWS, AND WHAT IT MUST NOT CLAIM. It knows exactly one thing: the sweep
   * won the turn for this job. Nothing on the server observes browsers. `pollEligibility`
   * is derived from durable job fields alone — ingest stamp, reconciliation, status,
   * provider handle, age — and never from whether a window is open, so a sweep that
   * wins a race against three live refreshes is indistinguishable here from a sweep on
   * a machine with no browser running at all. The notice therefore says HOW the result
   * was collected and never asserts what the user was or was not doing.
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
      message: `Collected ${results} result${results === 1 ? "" : "s"} through background recovery.`,
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
  /* =========================================================================
     THE REQUEST-TRUTH GATE, AT THE BOUNDARY THAT SPENDS MONEY.

     Every generation dialog has restricted its own body through restrictPayloadToPlan()
     since Batch 2 Slice 4, and that was a real guarantee about the SCREEN and no
     guarantee at all about the REQUEST. The gate ran in the browser; this route did not
     run it, did not know a view mode existed, and could not tell a body a dialog built
     from one replayed by hand. A Simple-mode filmmaker who was never offered a size
     could still have a 4K size honoured here - not because anything was bypassed, but
     because nothing at this end had ever been told what Simple meant.

     So the same function now runs on the same declaration on both sides. The dialog
     attaches `generationRequest: { surface, viewMode }`; this reads it, rebuilds the
     control plan from the SAME shared table, and restricts the payload again. Where the
     two agree - the normal case - the second restriction removes nothing and the only
     visible effect is the ledger row recording what the screen was showing.

     WHAT THIS DOES NOT DO. It does not infer intent from an arbitrary payload, and it
     does not invent a plan for a request that declared none: a body with no declaration
     is REFUSED rather than defaulted. Defaulting would have to pick Simple (the narrower
     reading), which would silently delete a legitimate Advanced value from a caller that
     simply had not been updated - and the caller would never find out. A named refusal
     with a code is the honest failure. */

  /* WHICH SURFACE A REQUEST IS ALLOWED TO CLAIM, decided from the request itself rather
     than taken on trust. A declaration is evidence about a screen; letting it also
     choose its own vocabulary would let a replay pick the vocabulary that governs least. */
  /* WHICH SURFACE A REQUEST IS ASKING FOR, and then WHETHER IT MAY HAVE IT.
   *
   * The first question is pure and lives in public/shared-generation-presentation.js
   * beside the surface table, so this boundary and anything reproducing a dialog's
   * declaration cannot drift apart. The second question is this file's, because only a
   * request handler can read persisted state.
   *
   * `reference-automation` is the one surface whose vocabulary is NARROWER — resolution
   * is a route input there rather than a tiered control — which makes it the more
   * permissive surface for that one key. Two reviewers in a row got past the first
   * attempt at guarding it, and both were right: a declared surface name and then a
   * declared coverageJobType are both just fields in the body being judged.
   *
   * So it is corroborated below from state the request cannot carry. `automation-run` has
   * always been corroborated the same way — automationSubmissionError() requires the run
   * to exist, the runner to hold an unexpired lease, and the caps to allow the work. This
   * gives the coverage surface the equivalent. */
  function legalRequestSurfaces(owner, body, purpose, trusted) {
    const asked = Presentation.generationRequestSurfacesFor(body, purpose).legal;
    if (!asked.includes("reference-automation")) return asked;
    /* THE PRIVILEGED SURFACE BELONGS TO THE SERVER OPERATION THAT IS DISPATCHING.
     *
     * `trusted` is an argument of this function, constructed by the coverage route and
     * reachable from no body field, header, query, param or project value — which is what
     * "a client request cannot promote itself" means concretely.
     *
     * AND IT MUST BE THIS ENTITY'S OPERATION. The descriptor carries the entity the
     * coverage route validated for itself; a request naming a different one is not the
     * work that operation is running, so it does not inherit its surface. Both halves come
     * from the server: one from the argument, one from comparing the request against it.
     *
     * NOTE WHAT IS NO LONGER ASKED FOR: a live coverage run in the document. It cannot be
     * — the run is established at the dispatch-commit point below, after every
     * pre-submission refusal has passed, precisely so that a refused request never leaves
     * a live run behind. Requiring one here would have meant creating it before the
     * boundary had accepted the request, which is the defect this ordering removes. */
    if (trusted?.surface !== "reference-automation") return asked.filter(notCoverageAutomation);
    const sameEntity = String(trusted?.entityList || "") === String(body?.entityList || "")
      && String(trusted?.entityId || "") === String(body?.entityId || "");
    return sameEntity ? asked : asked.filter(notCoverageAutomation);
  }
  const notCoverageAutomation = (surface) => surface !== "reference-automation";

  /* The control capability for the gate, from the owner that already resolves it for
     this route. `fixed-image` has none to ask - it dispatches through the configured
     text/edit endpoints rather than a compiled plan - so the shared table carries the
     literal the dialogs already used, and generationRequestPlan() reads it from there. */
  function controlCapabilityForSurface(owner, surface, body, purpose) {
    if (surface === "compiled-frame")
      return imageControlCapability({
        project: ownerProject(owner),
        purpose,
        shotId: String(body?.shotId || ""),
        buildId: String(body?.sourceBuildId || ""),
      });
    if (surface === "motion-h3")
      return h3ControlCapability({
        project: ownerProject(owner),
        shotId: String(body?.shotId || ""),
        buildId: String(body?.sourceBuildId || ""),
      });
    return null;
  }

  /* A refusal shaped like every other pre-provider refusal in this route: nothing was
     committed, nothing was sent, and the screen it came from still holds everything it
     was about to send. */
  function requestTruthRefusal(res, status, code, error, extra = {}) {
    return res.status(status).json({
      error,
      code,
      ...extra,
      providerContacted: false,
      paidRequestSubmitted: false,
    });
  }

  /* =========================================================================
     THE PAID DISPATCH PERMIT, AT THE BOUNDARY THAT SPENDS MONEY.

     Two things had been true at once on this route: the plan gate above proved WHAT a
     request was allowed to carry, and nothing proved WHICH AUTHORIZATION was paying for
     it. Membership was a claim — `automationRunId` on the body, and a comparison of
     coverage presentation fields — so the bounded work could shed its own bound by
     omitting or restating a field it wrote itself. Both were reproduced.

     A permit is minted only by a path that has already established the authorization from
     state the request cannot reach: a validated run lease, the coverage operation this
     server is running, or the direct issuance route standing in for a person pressing
     Generate. The class comes from the ISSUANCE PATH. There is no body field that selects
     it, which is what makes "a run cannot reclassify itself as manual work" a fact about
     the shape of the system rather than a rule someone remembered to write.

     WHAT THIS DOES NOT DECIDE: price, ceiling, plan, freshness. It locates the record that
     owns the ceiling and hands it to the guards that already existed. */
  function resolveDispatchPermit(owner, jobs, req, trusted) {
    /* THE SERVER OPERATION'S OWN PERMIT. The coverage route establishes the authorization
       and mints in the same call, so this one never crosses a request or process boundary
       and is deliberately not persisted: there is no window in which it could be presented
       by anything else, and a file write would add a crash seam that buys nothing. */
    if (trusted?.permit) return { ok: true, membership: trusted.permit };
    const presented = String(req.body?.paidPermitId || "").trim();
    /* SPENTNESS IS THE LEDGER'S ANSWER, ASKED HERE TOO.
     *
     * The commit turn below is what makes single-use atomic, and this does not replace it.
     * It exists so a replay is told the TRUTH rather than a side effect: a redeemed permit
     * is dropped from the store as housekeeping, so without this a second attempt would be
     * refused as "CineBraid never issued this", which is false and sends a filmmaker
     * looking for the wrong problem. Reading the ledger — the same rows this request
     * already holds — answers from the record that actually decides. */
    if (presented) {
      const spent = jobs.find((item) => String(item?.paidPermitId || "") === presented);
      if (spent)
        return {
          ok: false, status: 409, code: "PAID_PERMIT_ALREADY_REDEEMED",
          error: `This dispatch permit has already been redeemed by generation ${spent.id}. Nothing was submitted.`,
          detail: { redeemedByJobId: spent.id },
        };
    }
    let found;
    try {
      found = PaidPermit.findPaidPermit(owner.dir, presented, now());
    } catch (error) {
      /* A corrupt permit store is not an empty one, for the same reason a corrupt ledger
         is not an empty ledger: reading it as empty refuses everything while looking
         exactly like a system working correctly. */
      return { ok: false, status: error?.status || 409, code: error?.code || "PAID_PERMIT_STORE_UNREADABLE", error: error.message, detail: error?.detail || {} };
    }
    if (found.ok) return { ok: true, membership: found.permit };
    if (found.reason === "missing")
      return {
        ok: false, status: 400, code: "PAID_PERMIT_REQUIRED",
        error: "This paid request carries no dispatch permit, so CineBraid cannot tell which authorization would be paying for it. Nothing was submitted. Generate again from a CineBraid generation dialog.",
      };
    if (found.reason === "expired")
      return {
        ok: false, status: 409, code: "PAID_PERMIT_EXPIRED",
        error: "This request's dispatch permit has expired, so CineBraid did not send it. Nothing was submitted. Generate again.",
      };
    return {
      ok: false, status: 409, code: "PAID_PERMIT_UNKNOWN",
      error: "CineBraid did not issue the dispatch permit this paid request presents, so it did not send it. Nothing was submitted. Generate again from a CineBraid generation dialog.",
    };
  }

  /* THE PAID-RELEVANT IDENTITY OF ONE DISPATCH, in one function so the issuer and the
     boundary cannot describe the same request differently. The issuance routes call it
     with the scope a caller declares; this line calls it with the request as gated. */
  function dispatchScopeFor(body, planGate, purpose, outputCount) {
    return {
      purpose: String(purpose || ""),
      surface: String(planGate?.surface || ""),
      viewMode: String(planGate?.declaration?.viewMode || ""),
      shotId: String(body?.shotId || ""),
      frameId: String(body?.frameId || ""),
      entityList: String(body?.entityList || ""),
      entityId: String(body?.entityId || ""),
      /* The REQUEST's own package name, not the resolved one. An issuer cannot see what
         readSourceIntent() will pick, and freshness plus the plan gate already own the
         resolution — binding a value the issuer could not know would refuse honest work. */
      buildId: String(body?.sourceBuildId || ""),
      outputCount: Math.max(0, Math.round(Number(outputCount) || 0)),
    };
  }

  /* THE PAID QUANTITY A DISPATCH WILL ACTUALLY BUY, computed the one way. Shared with the
     issuance routes so a declared scope and the dispatch it authorises agree by
     construction rather than by two copies of a clamp staying in step. */
  /* THE PURPOSE THIS ROUTE WILL ACT ON, in one place. The boundary normalises an unknown
     purpose to "frame"; an issuer that kept the caller's raw word would fingerprint a
     different request from the one about to be dispatched and refuse honest work. */
  const DISPATCH_PURPOSES = ["blocking", "frame", "correction", "entity-reference", "motion-h3"];
  function normalizedPurpose(body) {
    const requested = String(body?.purpose || "frame");
    return DISPATCH_PURPOSES.includes(requested) ? requested : "frame";
  }

  function effectiveOutputCount(purpose, body) {
    const cfg = config();
    return purpose === "motion-h3" ? 1 : clamp(body?.outputCount, purpose === "blocking" ? cfg.blockingOutputs : cfg.frameOutputs, 1, 4);
  }

  function enforceRequestPlan(owner, req, purpose, trusted) {
    const declaration = Presentation.readGenerationRequestDeclaration(req.body);
    const legal = legalRequestSurfaces(owner, req.body, purpose, trusted);
    if (!declaration.declared)
      return {
        ok: false,
        status: 400,
        code: "GENERATION_PLAN_REQUIRED",
        error: "This paid request did not say which generation surface built it or which view the filmmaker was using, so CineBraid cannot tell what it was allowed to send. Nothing was submitted. Generate again from a CineBraid generation dialog.",
        detail: { expectedSurfaces: legal },
      };
    if (!legal.includes(declaration.surface))
      return {
        ok: false,
        status: 400,
        code: "GENERATION_PLAN_SURFACE_MISMATCH",
        error: `This request says it came from the ${declaration.surface} surface, but its own contents describe a ${legal.join(" or ")} request. Nothing was submitted.`,
        detail: { declaredSurface: declaration.surface, expectedSurfaces: legal },
      };
    const expected = declaration.surface;
    let capability = null;
    try {
      capability = controlCapabilityForSurface(owner, expected, req.body, purpose);
    } catch (error) {
      /* The capability resolvers throw the same typed refusals the compilers do, and
         they are answering about the same package. Passed straight through rather than
         relabelled, so a missing package reads as a missing package. */
      return { ok: false, throwable: error };
    }
    const plan = Presentation.generationRequestPlan({ surface: expected, mode: declaration.viewMode, capability });
    if (!plan)
      return {
        ok: false,
        status: 400,
        code: "GENERATION_PLAN_UNRESOLVED",
        error: "CineBraid could not work out which controls this request was allowed to carry, so it did not send it.",
        detail: { surface: expected },
      };
    /* THE GATE. The same call the dialog made, on the same plan, at the boundary that
       spends money. `removed` is kept because a request that silently dropped a value
       is the mirror image of one that silently kept it. */
    const gated = Presentation.restrictPayloadToPlan(req.body, plan);
    /* AND WHICH PACKAGE THE ROUTE IS ABOUT TO COMPILE, when a compiled surface is in play.
       The capability resolvers ask readSourceIntent() that question already; carrying the
       answer out is what lets the freshness gate below examine the same package instead of
       the one the request happened to name. Null for the surfaces that compile nothing. */
    return { ok: true, declaration, plan, surface: expected, payload: gated.payload, removed: gated.removed, resolvedBuildId: String(capability?.buildId || "") };
  }

  /* WHAT THE SCREEN WAS SHOWING, recorded on the job. Additive execution-ledger facts:
     nothing here is production truth and nothing here is read back as authority. They
     exist so "why does this render have no seed in it" has an answer that does not
     require reconstructing a dialog from three months ago. */
  function applyRequestTruth(job, gate) {
    job.generationSurface = gate.surface;
    job.generationViewMode = gate.declaration.viewMode;
    job.removedPayloadKeys = gate.removed.slice();
    job.selectedOptionId = gate.declaration.selectedOptionId;
    job.selectedModelId = gate.declaration.selectedModelId;
  }

  /* THE MODEL THE SCREEN NAMED, checked against the model this route will actually
     dispatch.
   *
   * The compiled still path compiles for IMAGE_MODEL_ID unconditionally and the fixed
   * path dispatches whatever Settings configured, so a picker selection has never been
   * able to change either. That is a defensible route design and an indefensible
   * silence: a filmmaker who chose a model and got a different one was told nothing.
   *
   * This does not make the selection choose a model - that would be the provider
   * abstraction this slice is explicitly not building. It refuses the mismatch instead,
   * which is the honest half: CineBraid either dispatches what the screen named or says
   * it cannot. A request that names nothing is not refused - there is a well-defined
   * truthful fallback, which is that the route's own configured model is used and the
   * ledger records it - but a request that names the WRONG one never quietly proceeds. */
  function modelIdentityRefusal(job, cfg) {
    const claimed = String(job.selectedModelId || "");
    const optionId = String(job.selectedOptionId || "");
    /* THE PAIR HAS TO AGREE WITH ITSELF BEFORE IT IS WORTH CHECKING AGAINST THE ROUTE.
     *
     * An independent reviewer reproduced the gap: a request naming an UNSUPPORTED option
     * B together with the supported model A passed, because only the model half was ever
     * read. The dispatch was A, the refusal that should have caught B never ran, and the
     * ledger recorded a B/A pair describing a screen that cannot have existed.
     *
     * An option id is `modelId::surfaceId::mode`, minted by public/shared-generation-
     * options.js, and generationOptionIdentity() is that same module reading its own
     * identity back. This is not parsing client prose - it is asking the owner what a
     * CineBraid-minted id names. The route cannot re-resolve the option list here: that
     * needs a filmmaker task and the shot inputs, and a dispatch body carries neither.
     *
     * A LONE OPTION ID IS STILL AN ASSERTION ABOUT A SCREEN, so it is checked like one.
     * This was carried as a named residual - recorded and not validated - and the residual
     * was not stable: applyRequestTruth() writes selectedOptionId onto the ledger row
     * before this runs, so the impossible id an independent reviewer used to break the
     * pair check was durably recorded as the option a filmmaker chose whenever the model
     * half was simply left out. Mintability does not need the model half to answer -
     * generationOptionMintable() is not given one - so the only thing the old scope bought
     * was a way to skip it.
     *
     * WHAT IS STILL NOT DONE, and is still the widening it always was: a lone option id
     * does not DERIVE a dispatch model. The check below stays gated on `claimed`, so a
     * request that named no model keeps the well-defined fallback described above. This
     * refuses an id CineBraid could not have issued; it does not start choosing models. */
    if (optionId) {
      /* SHAPE IS NOT MINTABILITY. Three colon-separated segments is what an id looks
         like; whether CineBraid could ever have issued THIS one is a question about the
         catalogue, the surfaces that offer the model and the modes a filmmaker task can
         ask for. An independent reviewer proved the difference with
         `gpt-image-2/standard::not-a-real-surface::not-a-real-mode`, which is
         well-formed, impossible, and was dispatched and durably recorded as the option a
         filmmaker had chosen. generation-options.js answers it from the same sources the
         picker mints from; nothing here holds a vocabulary of its own. */
      const identity = generationOptionIdentityFor(optionId);
      if (!identity.mintable)
        return {
          status: 409,
          code: "GENERATION_OPTION_IDENTITY_INVALID",
          error: `This request names the generation option "${optionId}", which is not an option identity CineBraid could have issued (${identity.reason}). Nothing was submitted.`,
          detail: { selectedOptionId: optionId, selectedModelId: claimed, reason: identity.reason },
        };
      /* The pair check needs both halves by definition; a lone option id has nothing to
         disagree with, and inventing the comparison would be the derivation above. */
      if (claimed && identity.modelId !== claimed)
        return {
          status: 409,
          code: "GENERATION_OPTION_MODEL_MISMATCH",
          error: `This request names the option ${optionId}, which is ${identity.modelId}, but says its model is ${claimed}. CineBraid will not dispatch a request whose own two names disagree. Nothing was submitted.`,
          detail: { selectedOptionId: optionId, selectedModelId: claimed, optionModelId: identity.modelId },
        };
    }
    if (!claimed) return null;
    const dispatching = job.purpose === "motion-h3"
      ? ""
      : job.generationSurface === "compiled-frame"
        ? IMAGE_MODEL_ID
        : String((job.references || []).length ? cfg.editModel : cfg.textModel);
    /* Motion resolves its model from the package's own profile inside the compiler, and
       the compiler already refuses a mode the package was not built for. Nothing here
       could add to that without duplicating it. */
    if (!dispatching || claimed === dispatching) return null;
    return {
      status: 409,
      code: "GENERATION_MODEL_MISMATCH",
      error: `This request was set up for ${claimed}, but this route dispatches ${dispatching}. Nothing was submitted. Reopen the generation dialog and choose again.`,
      detail: { selectedModelId: claimed, dispatchModelId: dispatching },
    };
  }

  /* =========================================================================
     SERVER-SIDE PACKAGE FRESHNESS.

     public/fal-generation.js refuses an out-of-date motion package in three places, and
     all three are browser code: a replayed POST reached this route with a package the
     screen had already marked stale. The comparison itself now lives in
     public/shared-build-history.js - ONE comparator, called by the browser with the full
     evidence it can gather and by this route with the fields a Node process can read out
     of the project document alone.

     This is deliberately a SUBSET and says so. It does not evaluate references (that
     needs promptReferenceOptions(), whose closure spans four browser-only files) and it
     does not evaluate execution method (the browser reads a narrowed profile list this
     process cannot see). Building either here would be the second freshness architecture
     this refuses to build. Every reason it does report is one the browser reports in the
     same words, because they come from the same function.

     A package with no recorded dependency snapshot is NOT refused. Refusing on an absence
     would block every package compiled before dependencies were captured - and every
     blocking package, which never records one at all - on evidence nobody has. */
  /* THE FORMAT THIS REQUEST IS ENTITLED TO, and why it is not a control.
   *
   * `aspectRatio` is declared in the control vocabulary but appears in exactly one
   * surface's `only` list - motion-h3 - and the four image surfaces declare no
   * `aspectRatios` capability, so controlSupport() answers {supported:true, values:null},
   * the row is filtered out of plan.controls, and restrictPayloadToPlan has nothing to
   * govern. It survives the gate on every image surface in BOTH views.
   *
   * That would be harmless if it were a label. It is one of the two factors of the
   * provider's image_size: the compiled path lets it OVERWRITE the shot's compiled spec
   * (image-execution.js:199-200) and the uncompiled path computes width and height from
   * it directly (aspectSize below). No image dialog offers it - every one of them derives
   * it from the production format through the same two resolvers used here - so it is
   * exactly what the module header forbids: a control nothing rendered, contributing to
   * the payload. Simple stripping `resolution` so a filmmaker who was never offered a size
   * cannot ship 4K, while the second factor of that same field stayed free, was half a
   * guarantee.
   *
   * So it is treated as the route input it actually is, the way the other two route inputs
   * on this boundary already are: derived from state the request does not carry. Adding it
   * to the surface tables would change nothing - a simple-tier supported control is
   * rendered, and a rendered control is allowed.
   *
   * A COVERAGE SHEET IS NEITHER OF THE TWO RESOLVERS - an expression sheet is 4:3 and an
   * angle sheet 16:9, decided by the operation rather than by the entity - so that surface
   * carries its entitled format on the same server-built descriptor that already says
   * which operation is running. Same object, same construction, no new trust in the body. */
  function entitledAspectLabel(owner, body, purpose, trusted) {
    /* Motion resolves its own: the plan governs the control on this surface and
       h3AspectGate() already refuses a ratio the mode cannot carry. A second opinion here
       would be a second owner of the same question. */
    if (purpose === "motion-h3") return "";
    if (trusted?.aspectRatio) return String(trusted.aspectRatio);
    const entityList = String(body?.entityList || "");
    if (entityList) return referenceAspectLabel(entityList);
    const shotId = String(body?.shotId || "");
    if (!shotId) return "";
    const project = ownerProject(owner);
    const shot = (project.shots || []).find((row) => String(row?.id) === shotId);
    if (!shot) return "";
    return shotAspectLabel(project, shot);
  }

  /* Shaped like modelIdentityRefusal and applying its rule: a request that names nothing
     is not refused - it lands on the entitled format below, which is where every dialog
     was sending it anyway - and a request that names the WRONG one never quietly
     proceeds. Refusing rather than overwriting, because silently reframing a paid request
     is the same class of failure as silently resizing one. */
  function aspectAuthorityRefusal(owner, body, purpose, trusted) {
    const requested = String(body?.aspectRatio || "");
    if (!requested) return null;
    /* A STRING THAT IS NOT A FORMAT IS NOT A COMPETING CLAIM. aspectSize() already reads
       an unreadable ratio, and one outside the believable range, as "nobody said" and
       lands it on the same fallback an absent value gets - so there is nothing here for a
       caller to gain and nothing for this gate to protect. Refusing it would turn a
       fallback that has always been silent into an error, which is a different change from
       the one this makes. */
    if (!parseAspectRatio(requested)) return null;
    const entitled = entitledAspectLabel(owner, body, purpose, trusted);
    if (!entitled || requested === entitled) return null;
    return {
      status: 409,
      code: "GENERATION_ASPECT_MISMATCH",
      error: `This request asks for ${requested}, but this production delivers ${entitled} here. CineBraid will not spend on a frame in a format nothing asked for. Nothing was submitted.`,
      detail: { requestedAspectRatio: requested, entitledAspectRatio: entitled },
    };
  }

  function packageFreshnessRefusal(owner, job) {
    if (!job.shotId || !job.sourceBuildId) return null;
    const project = ownerProject(owner);
    const shot = (project.shots || []).find((row) => String(row?.id) === String(job.shotId));
    if (!shot) return null;
    const pack = BuildHistory.resolvePromptBuild(project, job.sourceBuildId);
    if (!pack || pack.missing) return null;
    const freshness = BuildHistory.packageProjectFreshness(project, shot, pack);
    if (!freshness.recorded || freshness.current) return null;
    return {
      status: 409,
      code: "GENERATION_PACKAGE_STALE",
      error: `This compiled package is out of date: ${freshness.reasons.join("; ")}. Nothing was submitted. Rebuild the prompt on this shot and generate from the new package.`,
      detail: { reasons: freshness.reasons, evidence: freshness.evidence, buildId: job.sourceBuildId },
    };
  }
  /* The statuses that mean a coverage run is EXECUTING, as opposed to waiting for a
     person or finished. ingestEntity() moves a run out of this set when the last job of
     the run returns, and updateEntityCoverageRun() writes the failure states; both go
     through INTERNAL_NONAUTHORITY_WRITE, so a generic project save never touches any of
     it. Read here only to decide whether one press is continuing an existing run. */
  const COVERAGE_RUN_ACTIVE_STATUSES = ["starting", "sheet-running", "individual-running"];

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
    const runJobs = jobs.filter((job) => job.automationRunId === runId);
    const committed = runJobs.reduce((sum, job) => sum + Math.max(0, Number(job.outputCount || 0)), 0);
    const reportedUsage = Math.max(0, Number(run.usage?.imagesGenerated || 0));
    const consumed = Math.max(committed, reportedUsage);
    if (consumed + outputCount > maxImages) return { status: 409, message: `Automation credit guard stopped the request before exceeding its ${maxImages}-image cap.` };
    /* AND THE DOLLAR CEILING THAT PRESS ALSO SET. `maxImages` is a count; the number the
       planner actually put in front of the person pressing the button was the spend it
       quoted. One press authorises both, so both are enforced — through the shared
       helper below, which is the same one coverage automation's ceiling goes through. */
    return authorizedSpendError(run.config?.maxSpend, runJobs, body, outputCount);
  }

  /* THE AUTHORISED SPEND, ENFORCED WHERE IT IS SPENT — ONCE, FOR BOTH BOUNDED RUNS.
   *
   * CineBraid has two paid automation paths: the automation runner, whose ceiling is
   * recorded on the run at authorisation, and coverage automation, whose ceiling is
   * recorded on the coverage run the same way. They are the same question about two
   * records, so this is the same code answering it. Duplicating it per path is how the
   * two would come to disagree about what "over budget" means.
   *
   * `authorized` is the run's own recorded figure — quoted and stored at authorisation
   * from costEstimateFromRate() — so this compares like with like and performs no
   * arithmetic of its own. What has been spent comes from the estimates the jobs already
   * carry, through summarizeRecordedCost(), which is the only sanctioned way to read them.
   *
   * DELIBERATELY CONSERVATIVE IN ONE DIRECTION. A run holding unpriced or unrecorded jobs
   * has a true spend at least as high as its priced sum, so this can let through a request
   * that is genuinely over - it can never refuse one that is genuinely under. Refusing on
   * a total known to be incomplete would stop authorised work on arithmetic nobody can
   * show.
   *
   * A run with no recorded ceiling is not refused here: there is nothing to compare
   * against, the count caps still stand, and inventing a dollar limit the filmmaker was
   * never quoted would be worse than having none. */
  function authorizedSpendError(authorized, runJobs, body, outputCount) {
    if (authorized && authorized.priced === true && Number.isFinite(Number(authorized.amount))) {
      const spent = summarizeRecordedCost(runJobs);
      const pending = submissionAccounting({
        purpose: String(body?.purpose || "frame"),
        outputCount,
        ratePerImage: config().estimatedCostPerImage,
        motionRate: configuredMotionRate({ generation: { fal: config() } }),
        durationSeconds: Number(body?.durationSeconds) || 0,
        at: now(),
      });
      /* WHAT THIS CHILD WOULD COST, or the honest admission that CineBraid cannot say.
       *
       * `confidence: "unknown"` is a real answer from the cost owner and it is NOT zero.
       * The first version of this guard added `Number(pending.estimate?.amount)` and fell
       * back to 0 when that was NaN, which is exactly "unknown counts as free": under a
       * numeric ceiling an unpriced child dispatched forever, because zero never moves a
       * total. A ceiling that cannot be checked has not been honoured - it has been
       * skipped - so the request is refused and told why. */
      const pendingAmount = pending.estimate?.confidence === "estimated" ? Number(pending.estimate.amount) : null;
      if (!Number.isFinite(pendingAmount))
        return {
          status: 409,
          code: "AUTOMATION_SPEND_UNKNOWN",
          message: `This run was authorised to spend up to ${formatRunUsd(authorized.amount)}, and CineBraid cannot price this request - ${unpricedReasonText(pending)}. It cannot prove the request stays inside what you approved, so it was not submitted. Configure a rate for this kind of output, or start a run without a spend ceiling.`,
        };
      /* WHAT THE RUN HAS ALREADY COMMITTED, and whether that figure is the whole story.
       *
       * summarizeRecordedCost() keeps three populations apart on purpose: `amount` is the
       * summed PRICED total, `priced`/`unpriced`/`unrecorded` are COUNTS, and `complete`
       * says whether the total describes every job. Reading the count as the total was
       * this slice's own first defect; reading an INCOMPLETE total as a complete one is
       * the same failure a level up. A run holding a child whose cost is unknown has a
       * true spend of at least the priced sum and possibly much more, so authorising
       * another paid child on the strength of the known subtotal is a guess dressed as a
       * budget check. */
      if (runJobs.length && spent.complete !== true)
        return {
          status: 409,
          code: "AUTOMATION_SPEND_UNKNOWN",
          message: `This run was authorised to spend up to ${formatRunUsd(authorized.amount)}, and ${spent.unpriced + spent.unrecorded} of its ${spent.jobs} submitted request${spent.jobs === 1 ? "" : "s"} carr${spent.unpriced + spent.unrecorded === 1 ? "ies" : "y"} no priced estimate. CineBraid cannot prove another request stays inside what you approved, so it was not submitted.`,
        };
      const projected = Number(spent.amount || 0) + pendingAmount;
      /* EQUALITY IS NOT AN EXCESS, and proving that needs integers. Three $0.10 children
         against a $0.30 ceiling sum to 0.30000000000000004 in binary floating point, so a
         raw `>` refused a run that had exactly met its budget while displaying both
         figures as $0.30. usdExceeds() compares in the micro-USD unit every amount in
         this system is already rounded to, in one place, so a tolerance cannot be defined
         differently by two callers. */
      if (usdExceeds(projected, authorized.amount))
        return {
          status: 409,
          code: "AUTOMATION_SPEND_CAP",
          message: `This run was authorised to spend up to ${formatRunUsd(authorized.amount)}. This request would take it to ${formatRunUsd(projected)}, so it was not submitted.`,
        };
    }
    return null;
  }

  /* =========================================================================
     THE OTHER BOUNDED RUN.

     Coverage automation is the second paid automation path in CineBraid, and it is the
     one that most obviously dispatches SEVERAL paid requests from one press: "generate
     missing slots individually" submits one paid request per unfilled slot, three
     candidates each, in a loop. The dialog quotes exactly that before the button — "N
     paid requests · up to M images · $X" — and the server has recorded both figures on
     the run it owns since the coverage route was written.

     It recorded them and read them back nowhere. `automationSubmissionError()` above is
     keyed on `automationRunId`, which a coverage job does not carry, so every count and
     spend guard on this boundary returned null for coverage work before the first control
     key was read. A press authorised for two requests and six images could dispatch four
     and commit twelve, and each individual job was inside every bound that was actually
     being checked. A run bounded only in the browser is not a bounded run: the whole
     point of the money boundary is that it holds for a request the browser did not build.

     WHAT THIS IS NOT: a second authorisation model. The bound is the one the coverage
     route already stores, the count comes from the ledger the way the automation guard's
     does, and the dollar ceiling goes through authorizedSpendError() — the same function,
     not a copy of it.

     WHICH DISPATCHES THIS GOVERNS. Only the coverage operation's, decided from `trusted`
     — the server-built descriptor the coverage route supplies and no request field can
     reach. A filmmaker generating one entity reference by hand is not run work and does
     not spend a run's budget. */
  function coverageSubmissionError(owner, jobs, body, outputCount, membership) {
    if (membership?.permitClass !== "coverage") return null;
    /* WHICH RUN THIS DISPATCH IS IN, read off the permit.
     *
     * This used to compare `run.sheetType`/`run.mode` against the same two fields on the
     * request, and an independent reviewer took a bounded run apart with that: blanking
     * `coverageMode` made byte-identical work "unrelated", so it escaped the bound AND
     * replaced the live run, which destroyed the authorization record along with it. A
     * membership test over fields the bounded work writes for itself cannot be repaired by
     * matching them more carefully — there is nothing to match. The coverage route decides
     * membership from the live run and the filing target and mints it into the permit;
     * this reads that decision. An empty reference is the establishing request, which has
     * no run to be judged against and is what sets the bound. */
    /* THE TRANSITION THE COVERAGE ROUTE ALREADY DECIDED, raised here rather than there.
     *
     * PLACEMENT IS THE SUBSTANCE. An equivalent retry of a submission CineBraid never got
     * an answer for is also "a request arriving over unsettled work", and for that one
     * `GENERATION_UNRESOLVED` — money may already have been spent — is the truer and more
     * actionable answer. Deciding this in the route pre-empted it and told a filmmaker to
     * wait. Every stronger truth on this boundary (uncertain provider state, idempotent
     * reuse, the permit itself) runs above this line and keeps its answer. */
    if (membership.transition?.action === "refuse")
      return coverageTransitionRefusal(membership.transition);
    const ref = String(membership.authorizationRef || "");
    if (!ref) return null;
    const list = String(body?.entityList || "");
    const entityId = String(body?.entityId || "");
    const entity = (ownerProject(owner)[list] || []).find((row) => String(row?.id) === entityId);
    const run = entity?.coverageAutomation;
    if (!run || String(run.id || "") !== ref) return null;
    if (!COVERAGE_RUN_ACTIVE_STATUSES.includes(String(run.status || ""))) return null;
    const authorizedRequests = Number(run.requestCount);
    const authorizedImages = Number(run.maximumImages);
    /* A RUN THAT RECORDED NO BOUND IS NOT A BOUNDED PRESS, and inventing one for it would
       refuse work nobody ever limited.
     *
     * The coverage dialog is not the only thing that reaches this route. The per-slot
     * "generate" control on the coverage board sends a single request for a single slot
     * and quotes nothing, because one press making one request has nothing to bound — and
     * consecutive presses on two different slots land in the SAME run record, since the
     * projection groups by task rather than by press. Refusing an unbounded continuation
     * therefore refuses the second slot a filmmaker asks for, which is not a bound being
     * enforced; it is authorised work being stopped on arithmetic nobody performed.
     *
     * So this enforces the bound a press DECLARED and does not manufacture one. What that
     * does and does not buy, stated plainly rather than implied: a quoted press cannot go
     * past its own quote, in either figure, and cannot restate it on the way — which is the
     * defect this closes. It is not a cap on coverage work in general, and it cannot be:
     * a caller reaching this route without a quote is making single presses, which is the
     * one thing every paid surface in CineBraid already permits one at a time.
     *
     * The absence is not a hole a later request can dig, either. `if (!continuing)` at the
     * establishment point means a continuation never writes these figures at all — so a
     * run that recorded a bound cannot have it removed any more than it can have it
     * raised. */
    const bounded = Number.isInteger(authorizedRequests) && authorizedRequests > 0
      && Number.isInteger(authorizedImages) && authorizedImages > 0;
    if (!bounded) return null;
    const runJobs = coverageRunJobs(jobs, run, list, entityId);
    if (runJobs.length + 1 > authorizedRequests)
      return {
        status: 409,
        code: "COVERAGE_REQUEST_CAP",
        message: `This coverage run was authorised for ${authorizedRequests} paid request${authorizedRequests === 1 ? "" : "s"} and has already submitted ${runJobs.length}. This one was not submitted.`,
      };
    const committedImages = runJobs.reduce((sum, job) => sum + Math.max(0, Number(job.outputCount || 0)), 0);
    if (committedImages + outputCount > authorizedImages)
      return {
        status: 409,
        code: "COVERAGE_IMAGE_CAP",
        message: `This coverage run was authorised for up to ${authorizedImages} image${authorizedImages === 1 ? "" : "s"}. This request would take it to ${committedImages + outputCount}, so it was not submitted.`,
      };
    return authorizedSpendError(run.maxSpend, runJobs, body, outputCount);
  }


  /* WHICH BOARD A COVERAGE RESULT FILES AGAINST. The one distinction the run record has
     always drawn — public/entities.js compares `group === "expressions"` against
     `run.sheetType === "expressions"`, and the crop writer groups the same way — said here
     once so membership and filing cannot answer differently. */
  function coverageFilingTarget(sheetType) {
    return String(sheetType || "") === "expressions" ? "expressions" : "angles";
  }

  /* DOES THIS RUN STILL HAVE PAID WORK NOBODY HAS HEARD BACK ABOUT?
   *
   * ingestEntity() has asked exactly this question since coverage was written, to decide
   * when a run stops running: the run's own job ids, intersected with the ledger, minus
   * everything settled. Lifted here unchanged so the liveness rule that now protects a
   * bounded authorization and the rule that ends a run are the same derivation rather than
   * two that can drift. `exceptJobId` is ingest's own "and not the one I am delivering". */
  const COVERAGE_JOB_SETTLED = ["COMPLETED", "FAILED", "CANCELLED"];
  function coverageRunUnsettled(jobs, run, exceptJobId = "") {
    const member = Array.isArray(run?.jobs) ? run.jobs : [];
    return (jobs || []).filter((item) => member.includes(item.id)
      && item.id !== exceptJobId
      && !COVERAGE_JOB_SETTLED.includes(String(item.status || "").toUpperCase()));
  }

  /* WHETHER A PRESS QUOTED ANYTHING, in one place and in one shape.
   *
   * `coverageRunBounded` reads it off a stored run; `coverageRequestBound` asks the same
   * question of the body that would become one, through the same function, so "bounded"
   * cannot mean one thing about a record and another about the request.
   *
   * The request pair is client-supplied, and reading it here is safe for the reason
   * `automationRunnerId` is: it can only make this press stricter. Declaring a quote can
   * cause a refusal or record a ceiling; it can never remove one, and it can never buy
   * access to an authorization the press does not own. */
  function coverageRunBounded(run) {
    return Number.isInteger(Number(run?.requestCount)) && Number(run.requestCount) > 0
      && Number.isInteger(Number(run?.maximumImages)) && Number(run.maximumImages) > 0;
  }
  function coverageRequestBound(body) {
    return coverageRunBounded({ requestCount: body?.coverageRequestCount, maximumImages: body?.coverageMaximumImages });
  }

  /* =========================================================================
     THE COVERAGE PROJECTION TRANSITION MODEL.

     ONE FUNCTION, and it is the only thing in CineBraid that decides what a coverage
     dispatch does to the run record it arrives at. Three reviews found three different
     holes here and each was patched where it was found, which is how a decision ends up
     spread across a route, a guard and a commit callback answering slightly different
     questions. It is a table now, so a future change moves one cell rather than one branch
     and leaves the others to be discovered later.

     `entity.coverageAutomation` is the SINGLE current coverage-run record. That is the
     whole source of the difficulty: every incoming press either joins what is there,
     replaces it, or must wait — there is no fourth outcome that does not mean a second run
     store, which is not something this correction is allowed to build and does not need.

     THE FOUR SERVER TRUTHS IT READS, and nothing else:
       existing bounded?    coverageRunBounded(run)      — did the press that opened it quote
       existing unsettled?  coverageRunUnsettled(...)    — is paid work still outstanding
       incoming bounded?    coverageRequestBound(body)   — does this press quote
       same board?          coverageFilingTarget(...)    — the ONE canonical filing answer

     CANONICAL FILING, NOT SPELLING. `coverageFilingTarget()` is the existing owner of
     "would these candidates land on the same board", and it is what the browser groups by —
     public/entities.js compares `group === "expressions"` against
     `run.sheetType === "expressions"`, and the crop writer buckets the same way. The
     predicate this replaces compared raw `sheetType` and raw `mode` instead, so a run
     stored as `sheetType: ""` and a press sending `sheetType: "angles"` — the SAME angles
     board by every reader in the product — were treated as different tasks and the second
     destroyed the first.

     `mode` is deliberately absent from the comparison. It is stored as a configuration fact
     and read by nothing: the only occurrences of a coverage run's `mode` anywhere in the
     repository are this file's own comments. What a job produces — a contact sheet or an
     entity card — is `coverageJobType` on the JOB row, where that distinction belongs and
     already lives. */
  const COVERAGE_TRANSITIONS = {
    /* No live run to reason about. */
    ESTABLISH: "establish",
    /* Join the existing projection: same run id, jobs accumulate, no bound changes hands. */
    CONTINUE: "continue",
    /* Join it AND be judged by its ceiling — the permit names it. */
    GOVERN: "govern",
    /* Neither joining nor replacing is safe. Wait. */
    REFUSE: "refuse",
  };

  function coverageTransition({ run, unsettled, requestBounded, incomingTarget }) {
    const live = !!run && COVERAGE_RUN_ACTIVE_STATUSES.includes(String(run.status || ""));
    if (!live) return { action: COVERAGE_TRANSITIONS.ESTABLISH };

    const existingTarget = coverageFilingTarget(run.sheetType);
    const sameBoard = existingTarget === incomingTarget;
    const outstanding = Number(unsettled) || 0;

    if (coverageRunBounded(run)) {
      /* A3 — a bounded run that has heard back about everything governs nothing further.
         Letting a finished ceiling reach forward and cap unrelated later work would be a
         bound nobody quoted for that work. */
      if (!outstanding) return { action: COVERAGE_TRANSITIONS.ESTABLISH };
      /* A2 — incompatible filing while its paid work is outstanding. Refusing rather than
         replacing is the point: replacing destroys a record of work in flight. */
      if (!sameBoard) return { action: COVERAGE_TRANSITIONS.REFUSE, reason: "incompatible-filing-target", existingTarget, incomingTarget, outstanding };
      /* A1 — this dispatch is that authorization's work, whatever the request calls itself,
         and its recorded ceiling is what judges it. */
      return { action: COVERAGE_TRANSITIONS.GOVERN, ref: String(run.id || "") };
    }

    /* C — an unbounded run with nothing outstanding can yield: no in-flight membership is
       destroyed, and the ledger keeps the history either way. A press that quotes a ceiling
       establishes its own run so the ceiling is not silently dropped into someone else's
       unbounded projection; a compatible press that quotes nothing simply continues. */
    if (!outstanding) {
      if (requestBounded || !sameBoard) return { action: COVERAGE_TRANSITIONS.ESTABLISH };
      return { action: COVERAGE_TRANSITIONS.CONTINUE, ref: String(run.id || "") };
    }

    /* B — unbounded, with paid work nobody has heard back about. Replacement is off the
       table entirely: it would drop an in-flight job out of the projection. */
    /* B3/B4 — incompatible filing is checked FIRST, so the reason a caller is given is the
       one that will still be true after the wait. A press that is both incompatible and
       newly bounded is told about the board, because settling the current work is not on
       its own enough to let it through. */
    if (!sameBoard) return { action: COVERAGE_TRANSITIONS.REFUSE, reason: "incompatible-filing-target", existingTarget, incomingTarget, outstanding };
    /* B2 — compatible, but it quoted a ceiling. Absorbing it drops that ceiling; replacing
       loses the in-flight work. So it waits. */
    if (requestBounded) return { action: COVERAGE_TRANSITIONS.REFUSE, reason: "unsettled-unbounded-work", existingTarget, incomingTarget, outstanding };
    /* B1 — compatible and unbounded: the ordinary per-slot press, which continues.
       `ref` names the run this files into. It is NOT the permit's authorizationRef — an
       unbounded run authorizes nothing and the permit keeps saying so — it is the projection
       identity, carried so the commit turn can check the record it finds is still that
       one. Two identities, deliberately, because they are two questions. */
    return { action: COVERAGE_TRANSITIONS.CONTINUE, ref: String(run.id || "") };
  }

  /* The transition for one incoming coverage dispatch, resolved from durable state. Called
     once by the coverage route so the authorization decision, the refusal and the
     projection decision are three readings of ONE answer rather than three answers. */
  function coverageTransitionFor(owner, jobs, body, sheetType) {
    const list = String(body?.entityList || "");
    const entityId = String(body?.entityId || "");
    const entity = (ownerProject(owner)[list] || []).find((row) => String(row?.id) === entityId);
    const run = entity?.coverageAutomation;
    return coverageTransition({
      run,
      unsettled: run ? coverageRunUnsettled(jobs, run).length : 0,
      requestBounded: coverageRequestBound(body),
      incomingTarget: coverageFilingTarget(sheetType),
    });
  }

  /* The refusal a REFUSE transition becomes on the wire, in the words each reason earns.
     Both go out under the existing coverage-busy code — coverage is running and this must
     wait, which is what that code has always meant — with the reason beside it so a caller
     can tell which wait it is in for without a second taxonomy for one situation. */
  function coverageTransitionRefusal(transition) {
    if (transition.reason === "incompatible-filing-target")
      return {
        status: 409,
        code: "COVERAGE_RUN_BUSY",
        message: `Coverage generation for this reference is already running ${transition.existingTarget} work that CineBraid has not heard back about, and ${transition.incomingTarget} candidates file against a different board. Nothing was submitted. Wait for the running coverage to return, then generate again.`,
        detail: { reason: "incompatible-filing-target", runningFilingTarget: transition.existingTarget, requestedFilingTarget: transition.incomingTarget },
      };
    return {
      status: 409,
      code: "COVERAGE_RUN_BUSY",
      message: `Coverage generation for this reference is already running ${transition.outstanding} request${transition.outstanding === 1 ? "" : "s"} that CineBraid has not heard back about, and this press asks for a bounded run of its own. Starting one now would either drop the limit you just approved or lose track of the work already in flight, so nothing was submitted. Wait for the running coverage to return, then start it again.`,
      detail: { reason: "unsettled-unbounded-work", unsettledJobs: transition.outstanding },
    };
  }


  /* WHAT THIS RUN HAS ALREADY COMMITTED, from the ledger rather than from any counter.
   *
   * Two signals, unioned, because either alone under-counts. The run's own `jobs` list is
   * the direct record and is what onDispatchCommit writes; it misses a job whose
   * projection write failed, which is a state this route deliberately tolerates and
   * records rather than refuses. So a coverage job for this same entity, carrying a
   * coverage job type and created no earlier than this run, counts as this run's work
   * too: only one coverage run can be live on an entity at a time, so there is no other
   * live run for such a job to belong to.
   *
   * A manual entity-reference generation carries no `coverageJobType` and is excluded —
   * charging it to a run the filmmaker did not start would refuse authorised work. */
  function coverageRunJobs(jobs, run, list, entityId) {
    const member = new Set((Array.isArray(run.jobs) ? run.jobs : []).map((id) => String(id)));
    const startedAt = Date.parse(run.startedAt || "");
    return jobs.filter((job) => {
      if (member.has(String(job.id))) return true;
      if (String(job.purpose || "") !== "entity-reference") return false;
      if (String(job.entityList || "") !== list || String(job.entityId || "") !== entityId) return false;
      if (!String(job.coverageJobType || "")) return false;
      const createdAt = Date.parse(job.createdAt || "");
      return Number.isFinite(startedAt) && Number.isFinite(createdAt) && createdAt >= startedAt;
    });
  }

  /* WHAT THE PRESS AUTHORISED IN MONEY, recorded beside what it authorised in images, at
     the moment the run is established.
   *
   * The same arithmetic the coverage dialog already showed the filmmaker: it prices its
   * quote with generationPriceLine() over configuredImageRate() and the same image count,
   * and public/automation.js records the automation runner's ceiling from
   * costEstimateFromRate() over the same rate. This is that one function, over the count
   * this run was established with — not a second multiplication, and not a figure the
   * request supplied.
   *
   * Recorded once, at establishment, and never recomputed: editing the rate in Settings
   * tomorrow changes what tomorrow's press is authorised to spend and changes nothing
   * about this one. An unconfigured rate records an honest `priced: false`, and the run
   * then has no dollar ceiling to enforce — it still has both count caps. */
  function coverageAuthorizedSpend(maximumImages) {
    const derived = costEstimateFromRate({
      rate: configuredImageRate({ generation: { fal: config() } }),
      quantity: Math.max(0, Number(maximumImages) || 0),
    });
    return {
      priced: derived.priced,
      amount: derived.priced ? derived.estimate.amount : null,
      quantity: Math.max(0, Number(maximumImages) || 0),
      unitBasis: derived.basis.unitBasis,
      ratePerUnit: derived.basis.ratePerUnit,
      rateSource: derived.basis.rateSource,
      ...(derived.priced ? {} : { unpricedReason: derived.basis.unpricedReason || "no-configured-rate" }),
    };
  }
  /* The cost owner's own word for why it could not price something, in a sentence. It
     records the reason; this only reads it, and says so plainly when there is none. */
  function unpricedReasonText(accounting) {
    const reason = String(accounting?.basis?.unpricedReason || "");
    if (reason === "no-configured-rate") return "no rate is configured for it";
    if (reason === "no-rate-basis-for-this-output") return "CineBraid has no rate basis for this kind of output";
    if (reason === "no-quantity") return "it has no quantity to price";
    return reason ? `the cost owner reports ${reason}` : "it reports the cost as unknown";
  }
  /* The same two-decimal USD the price line uses. Named here rather than inlined so a
     refusal and a quote cannot format the same number differently. */
  function formatRunUsd(amount) {
    const value = Number(amount);
    return Number.isFinite(value) ? `$${value.toFixed(2)}` : "an unknown amount";
  }
  function publicJob(job) {
    if (!job) return null;
    const copy = structuredClone(job);
    delete copy.providerRequest;
    /* THE SERVER'S OWN ANSWER TO "DOES CINEBRAID KNOW WHAT HAPPENED TO THIS", carried on
       the wire because the browser was working it out for itself and getting a different
       answer. Its `falJobUnresolved()` asked only whether the status was UNRESOLVED, so a
       durable SUBMITTING row with no request id — the second way a submission becomes
       uncertain — was drawn as an ordinary running job: a Cancel button the route now
       correctly refuses, and no way at all to reach the reconciliation dialog that is the
       only exit from that state. The filmmaker was told to go and record what they found
       and given nothing to record it with.

       This is the uncertainty half only, not `isSubmissionUncertainWithoutHandle`: an
       UNRESOLVED job that DOES carry a handle is still something CineBraid cannot account
       for, and has always offered that dialog. */
    copy.uncertain = Lifecycle.blocksResubmission(job);
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
  /* Routed through the project turn like every other project write. This is a
     read-modify-write of the WHOLE document, so left outside the turn it could drop a
     candidate row an overlapping ingest had just committed — the same clobbering
     defect, reached from an error path instead of a success path. It still never
     throws: a coverage annotation that cannot be written is not a reason to fail the
     response its caller is already sending. */
  /* WHETHER THE PROJECT DOCUMENT WAS ACTUALLY WRITTEN, answered rather than
     implied. This runs on three routes that mostly do NOT touch project.json —
     a cancel, a failed submission, a failed collection — and only writes when the
     job is an entity-reference job whose entity has coverage automation
     configured. A browser cannot see that condition, so it used to have to guess
     from the HTTP status, and a guess in either direction is wrong: guessing YES
     invalidates a perfectly good prepared refresh on every cancel, and guessing NO
     lets a prepared snapshot reinstall the pre-cancel coverage status. The answer
     is cheap here and unknowable there, so it travels in the response. */
  /* THE COVERAGE RUN A JOB ROW JUSTIFIES, rebuilt from the job row.
   *
   * This is the whole recovery mechanism, and it needs nothing that was not already
   * being written: a coverage job row carries `entityList`, `entityId`,
   * `coverageJobType`, `coverageSheetType` and `createdAt`, which is precisely the
   * record. ingestEntity() has always done this when the record was missing — the
   * behaviour is unchanged, it simply has a name now so the seam that can lose the
   * projection and the seam that repairs it are visibly the same rule.
   *
   * WHY A REBUILD IS ENOUGH. The ledger is written before the projection, so the only
   * interruption this has to answer is "job exists, record does not" — and every field
   * the record needs is on the job. The opposite state, a record with no job, is the one
   * the ordering makes unreachable.
   *
   * REBUILDING IS NOT THE SAME AS WATCHING IT HAPPEN, which is what decides the status
   * a rebuilt record starts at. The live dispatch writes its own record while it still
   * knows what it is doing (see onDispatchCommit) and is untouched by any of this — a
   * SUBMITTING row the current request is about to submit legitimately reads as running.
   * RECONSTRUCTION has less to go on: all it has is the persisted row, and `SUBMITTING`
   * with no handle is ambiguous there. It means the process stopped before the provider
   * was contacted, or the provider accepted and the answer was lost. Presenting that as
   * an ordinary running generation tells a filmmaker their sheet is on its way when
   * nobody knows whether it exists, so recovery says what is true: this needs a person.
   * The JOB is not touched — its status is the ledger's business, and the projection is
   * only how the project describes it.
   *
   * Mutates the entity in place and is only ever called inside a commitProject() turn. */
  function projectCoverageRunFromJob(entity, job) {
    const uncertain = Lifecycle.isSubmissionUncertainWithoutHandle(job);
    const runningStatus = job.coverageJobType === "sheet" ? "sheet-running" : "individual-running";
    const existing = entity.coverageAutomation && typeof entity.coverageAutomation === "object"
      ? entity.coverageAutomation
      : {
        id: `coverage:${job.entityList}:${job.entityId}:${job.id}`,
        list: job.entityList,
        entityId: entity.id,
        mode: job.coverageJobType === "sheet" ? "sheet" : "individual",
        sheetType: job.coverageSheetType || "angles",
        status: uncertain ? "needs-attention" : runningStatus,
        ...(uncertain ? {
          needsAttentionAt: now(),
          error: "CineBraid has no request id for this submission, so it cannot check what happened to it.",
        } : {}),
        startedAt: job.createdAt || now(),
        /* Named so a reader can tell a rebuilt projection from one the dispatch wrote,
           which is a real difference: this one was reconstructed after its own write was
           lost or interrupted. */
        rebuiltFromJobAt: now(),
        jobs: [],
      };
    existing.jobs = Array.isArray(existing.jobs) ? existing.jobs : [];
    if (!existing.jobs.includes(job.id)) existing.jobs.push(job.id);
    entity.coverageAutomation = existing;
    return existing;
  }

  /* Rebuild a coverage projection that an interruption left unwritten. Deliberately
     narrow: it only ever ADDS a record the ledger justifies, never advances or finishes
     one, because lifecycle transitions belong to updateEntityCoverageRun() and ingest. */
  async function repairCoverageProjection(owner, job) {
    if (job?.purpose !== "entity-reference" || !job.coverageJobType || !job.entityList || !job.entityId) return false;
    try {
      const known = (ownerProject(owner)[job.entityList] || []).find((item) => String(item.id) === String(job.entityId));
      if (!known || known.coverageAutomation) return false;
      let wrote = false;
      await commitProject(owner, (project) => {
        const entity = (project[job.entityList] || []).find((item) => String(item.id) === String(job.entityId));
        if (!entity || entity.coverageAutomation) return;
        projectCoverageRunFromJob(entity, job);
        wrote = true;
      });
      return wrote;
    } catch { return false; }
  }

  async function updateEntityCoverageRun(owner, job, status, error = "") {
    if (job?.purpose !== "entity-reference" || !job.entityList || !job.entityId) return false;
    try {
      const known = (ownerProject(owner)[job.entityList] || []).find((item) => String(item.id) === String(job.entityId));
      if (!known?.coverageAutomation) return false;
      let wrote = false;
      await commitProject(owner, (project) => {
        const entity = (project[job.entityList] || []).find((item) => String(item.id) === String(job.entityId));
        if (!entity?.coverageAutomation) return;
        entity.coverageAutomation.status = status;
        entity.coverageAutomation.updatedAt = now();
        if (error) entity.coverageAutomation.error = String(error);
        if (["failed", "cancelled", "needs-attention"].includes(status)) entity.coverageAutomation.needsAttentionAt = now();
        /* Inside the committing turn, so it is true only for a turn that reached
           the mutation — commitProject() re-reads and writes around this callback,
           and a callback that returns early leaves the document as it found it. */
        wrote = true;
      });
      return wrote;
    } catch { return false; }
  }
  function entityRole(list) {
    return { characters: "character-reference", locations: "location-reference", props: "prop-reference", vehicles: "vehicle-reference" }[list] || "planning-reference";
  }
  async function ingestEntity(owner, job, images) {
    /* Refused early against current state, exactly as before. The authoritative read
       is the one inside the turn below. */
    entityTarget(job, ownerProject(owner));
    /* DOWNLOAD PHASE — network only. Nothing is written to disk and no project state
       is held across it, so an interrupted download leaves no file to orphan and no
       snapshot to go stale. */
    const downloads = [];
    for (let index = 0; index < images.length; index++) downloads.push(await downloadImage(images[index]));
    /* COMMIT PHASE — one indivisible turn against freshly read state. */
    const outputs = await commitProject(owner, (project) => {
      const { list, folder, entity } = entityTarget(job, project);
      const dir = path.join(owner.dir, folder);
      fs.mkdirSync(dir, { recursive: true });
      entity.candidateFiles = Array.isArray(entity.candidateFiles) ? entity.candidateFiles : [];
      entity.generatedCandidates = Array.isArray(entity.generatedCandidates) ? entity.generatedCandidates : [];
      const outputs = [];
      for (let index = 0; index < downloads.length; index++) {
        const downloaded = downloads[index];
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
          /* THE ROW'S STRUCTURAL DECLARATION. On a candidate row this field is what
             shared-coverage.js's referenceArtifactStructure() keys on, and it is the
             same field manual intake writes (public/library-tools.js). A coverage job
             already answers it — "sheet" or "slot" — and keeps precedence. Anything
             else takes the dispatch's own declaration, so a reference CineBraid
             generated for one continuity state no longer arrives `undeclared` and
             refused by its own authority gate.
             The job's coverage membership is NOT widened to make this work: the
             branch below still reads job.coverageJobType, which stays empty for a
             manual reference generation. */
          coverageJobType: job.coverageJobType || job.artifactStructure || "",
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
        projectCoverageRunFromJob(entity, job);
        const knownJobs = readJobs(owner);
        const pending = knownJobs.filter((item) => entity.coverageAutomation.jobs.includes(item.id) && item.id !== job.id && !["COMPLETED", "FAILED", "CANCELLED"].includes(String(item.status || "").toUpperCase()));
        if (!pending.length) {
          entity.coverageAutomation.status = job.coverageJobType === "sheet" ? "sheet-ready-for-review" : "slot-candidates-ready";
          entity.coverageAutomation.readyAt = now();
        }
      }
      return outputs;
    });
    job.outputs = outputs;
    job.ingestedAt = now();
    return job;
  }
  async function ingestMotion(owner, job, assets) {
    if (job.ingestedAt) return job;
    if (!(ownerProject(owner).shots || []).some((item) => String(item.id) === String(job.shotId)))
      throw new Error("Shot no longer exists.");
    /* DOWNLOAD PHASE — see ingestEntity. A held video download leaves nothing behind. */
    const downloads = [];
    for (let index = 0; index < assets.length; index++) downloads.push(await downloadOutput(assets[index], "video/mp4"));
    /* COMMIT PHASE — one indivisible turn against freshly read state. */
    const outputs = await commitProject(owner, (project) => {
      const shot = (project.shots || []).find((item) => String(item.id) === String(job.shotId));
      if (!shot) throw new Error("Shot no longer exists.");
      const dir = path.join(owner.dir, "shots", shot.id, "takes");
      fs.mkdirSync(dir, { recursive: true });
      shot.candidateFiles = Array.isArray(shot.candidateFiles) ? shot.candidateFiles : [];
      const outputs = [];
      for (let index = 0; index < downloads.length; index++) {
        const downloaded = downloads[index];
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
      return outputs;
    });
    job.outputs = outputs;
    job.ingestedAt = now();
    return job;
  }

  async function ingest(owner, job, images) {
    if (job.ingestedAt) return job;
    if (job.purpose === "motion-h3" || job.profileFamily === "minimax-h3") return ingestMotion(owner, job, images);
    if (job.purpose === "entity-reference") return ingestEntity(owner, job, images);
    if (!(ownerProject(owner).shots || []).some((item) => String(item.id) === String(job.shotId)))
      throw new Error("Shot no longer exists.");
    /* DOWNLOAD PHASE — see ingestEntity. */
    const downloads = [];
    for (let index = 0; index < images.length; index++) downloads.push(await downloadImage(images[index]));
    /* COMMIT PHASE — one indivisible turn against freshly read state. */
    const outputs = await commitProject(owner, (P) => {
      const shot = (P.shots || []).find((item) => String(item.id) === String(job.shotId));
      if (!shot) throw new Error("Shot no longer exists.");
      const outputs = [];
      P.mediaAssets = Array.isArray(P.mediaAssets) ? P.mediaAssets : [];
      shot.candidateFiles = Array.isArray(shot.candidateFiles) ? shot.candidateFiles : [];
      for (let index = 0; index < downloads.length; index++) {
        const downloaded = downloads[index];
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
      return outputs;
    });
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
     where it is, so a result the sweep collected is announced once to the next window
     that opens rather than on every poll.

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
      /* WHICH PROJECT THIS LEDGER IS. `captureOwner()` resolved it from the server's
         ACTIVE project, which is one value for the whole machine — so a window that
         polls this route while the active project was switched somewhere else (a
         second tab, another creator on the LAN) receives a different project's jobs
         with nothing in the payload to say so, and its Activity drawer, its counts
         and its rail present them as its own. The reviewer reproduced exactly that.
         Stating the owner is what lets the caller refuse them; the automation-run
         route states it for the same reason. */
      res.json({ jobs: jobs.map(publicJob), projectSlug: owner.slug, ...(recovery ? { backgroundRecovery: recovery } : {}) });
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
      coverage: labelledCoverage(plan.coverage),
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
      coverage: labelledCoverage(plan.coverage),
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
        /* The use-case guide verbatim, decision state AND the decision's own reasoning.
           One serializer, in generation-options.js, so what a test exercises is what the
           wire carries rather than a lookalike of it. */
        guide: guidePayload(resolved.guide),
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
  /* THE ONE PAID BOUNDARY, and the only thing that changed about it: it now takes the
     server context of the operation dispatching the work.
   *
   * `trusted` is never built from a request body. The public route below passes null;
   * the coverage operation passes the surface it is actually executing. Everything after
   * this line — the payload gate, the plan requirement, freshness, model identity, spend
   * and quantity bounds, binding, accounting and adapter preparation — is unchanged and
   * happens exactly once, for both entry points. */
  async function dispatchGenerationRequest(req, res, trusted) {
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
    /* THE PERMIT, BEFORE ANY OTHER READ OF THE BODY.
     *
     * WHICH AUTHORIZATION THIS DISPATCH BELONGS TO IS SETTLED HERE, from a token a server
     * path minted after establishing that authorization from state the request cannot
     * reach. Everything below reads membership off `membership` and never off the body:
     * that is the difference between a bound and a suggestion.
     *
     * PLACEMENT IS PART OF THE GUARANTEE, and it is not merely "early". The automation
     * reuse guard on the next lines used to read `req.body.automationRunId`; a request
     * that simply omitted the field slipped past its own run's idempotency and could
     * dispatch a second paid job for a step that already had one. So the permit resolves
     * FIRST and the guard is given the run and step the permit names.
     *
     * A refusal here is the cheapest one on this route: no row, no project write, no
     * provider, nothing to undo. */
    const permitGate = resolveDispatchPermit(owner, jobs, req, trusted);
    if (!permitGate.ok)
      return requestTruthRefusal(res, permitGate.status, permitGate.code, permitGate.error, permitGate.detail || {});
    const membership = permitGate.membership;
    /* THE RUN AND STEP THIS DISPATCH IS IN, taken from the permit and written back onto
       the body so that every existing reader below — the reuse guard, the job row, the
       credit guard, the runner's own diagnostics — keeps working unchanged while reading
       server truth instead of a claim. Omitting or editing either field on the wire now
       changes nothing at all. */
    /* `automationRunnerId` is deliberately NOT taken from the permit. It is the one
       automation field that can only narrow: the credit guard refuses unless it equals the
       run's current lease holder and that lease is unexpired, so a wrong or omitted one
       refuses this request and nothing else. The run and the step are different — they
       decide WHICH ceiling applies, which is exactly what a request must not choose. */
    if (membership.permitClass === "automation") {
      req.body = { ...(req.body && typeof req.body === "object" ? req.body : {}) };
      req.body.automationRunId = membership.authorizationRef;
      req.body.automationStepKey = membership.stepKey;
    }
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
    const purpose = normalizedPurpose(req.body);
    /* THE PAYLOAD GATE, BEFORE THE FIRST CONTROL KEY IS READ.
     *
     * Placement is the whole guarantee. `requestedOutputCount` on the next line is the
     * first read of a control key, the compiled branches consume resolution, duration
     * and aspect ratio, and the fixed branch hands its own `job.resolution` to the
     * adapter - so a gate that ran any later would be restricting a request that had
     * already been built around the keys it was removing.
     *
     * It also runs before `commit()` and before `submit()`. A refusal here creates no
     * durable row, contacts no provider and spends nothing. */
    const planGate = enforceRequestPlan(owner, req, purpose, trusted);
    if (!planGate.ok) {
      if (planGate.throwable) return purpose === "motion-h3" ? h3Refusal(res, planGate.throwable) : imageRefusal(res, planGate.throwable);
      return requestTruthRefusal(res, planGate.status, planGate.code, planGate.error, planGate.detail || {});
    }
    /* THE RESTRICTED PAYLOAD IS THE REQUEST FROM HERE ON. Assigned back onto req.body
       rather than threaded through sixty reads, so there is no way for a later line to
       reach a key the active view never rendered by simply forgetting to use the gated
       copy. */
    req.body = planGate.payload;
    const requestedOutputCount = purpose === "motion-h3" ? 1 : clamp(req.body?.outputCount, purpose === "blocking" ? cfg.blockingOutputs : cfg.frameOutputs, 1, 4);
    /* AND THE PERMIT WAS MINTED FOR THIS PAID WORK, not merely for this authorization.
     *
     * Recomputed HERE and not earlier, because two of the fingerprinted values only become
     * true at this line: the payload has been restricted to what the declared view can
     * carry, and `requestedOutputCount` is the quantity that will actually be bought
     * rather than the one the body asked for. Comparing against the raw body would bind a
     * permit to a number the route was never going to honour.
     *
     * Without this a permit would be a licence for the authorization rather than for the
     * dispatch: one minted for a single blocking candidate would buy four 4K frames on
     * another shot, and the ledger would record it under an authorization that had agreed
     * to neither. */
    const presentedScope = dispatchScopeFor(req.body, planGate, purpose, requestedOutputCount);
    if (PaidPermit.paidScopeFingerprint(presentedScope) !== String(membership.scopeFingerprint || ""))
      return requestTruthRefusal(res, 409, "PAID_PERMIT_SCOPE_MISMATCH",
        "This paid request is not the work its dispatch permit was issued for, so CineBraid did not send it. Nothing was submitted. Generate again from the CineBraid dialog.",
        { presentedScope });
    const guardError = automationSubmissionError(owner, jobs, req.body, requestedOutputCount);
    /* Through the same helper as every other refusal on this route, so it carries the same
       pre-provider evidence. automationSubmissionError() runs here — before the job row is
       built, before commit() and long before submit() — so `providerContacted: false` is a
       fact this line can assert rather than a hope. It was the one refusal shape that said
       nothing, and the automation runner reads exactly that field to decide whether an
       attempt was spent. */
    if (guardError) return requestTruthRefusal(res, guardError.status, guardError.code || "AUTOMATION_GUARD", guardError.message);
    /* AND THE OTHER BOUNDED RUN, in the same slot and for the same reasons. Coverage
       automation dispatches one paid request per unfilled slot from a single press, and
       until this line the count and spend the filmmaker approved were enforced only by
       the browser that drew them. Same position — before the row is built, before commit()
       and long before submit() — so `providerContacted: false` is a fact rather than a
       hope, and the same refusal helper, so it carries the same pre-provider evidence. */
    const coverageGuardError = coverageSubmissionError(owner, jobs, req.body, requestedOutputCount, membership);
    if (coverageGuardError) return requestTruthRefusal(res, coverageGuardError.status, coverageGuardError.code, coverageGuardError.message, coverageGuardError.detail || {});
    const refs = Array.isArray(req.body?.references) ? req.body.references.filter((ref) => ref && ref.url) : [];
    const edit = refs.length > 0;
    /* Resolved once, before the row is built, so the same answer is both what a request
       naming nothing lands on and what a request naming something is judged against. */
    const entitledAspect = entitledAspectLabel(owner, req.body, purpose, trusted);
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
      /* WHAT THE RETURNED ARTIFACTS ARE, kept deliberately separate from
         `coverageJobType` above even though both end up describing structure.
         `coverageJobType` on a JOB is coverage-RUN MEMBERSHIP: coverageRunJobs()
         treats any non-empty value as "this job belongs to a coverage run", and
         ingestEntity() mints an entity.coverageAutomation projection from it. A
         manual reference generation that borrowed that field to say "single image"
         would be charged to a run the filmmaker never started.
         So the declaration travels in its own field, is whitelisted to the values
         the shared classifier already understands, and is copied into the CANDIDATE
         ROW at ingest — where `coverageJobType` means something else entirely and
         is the field library-tools.js's manual intake has always written. */
      artifactStructure: ["single-reference", "sheet", ""].includes(String(req.body?.artifactStructure || "")) ? String(req.body?.artifactStructure || "") : "",
      coverageSheetType: String(req.body?.coverageSheetType || ""),
      targetCoverageSlotId: String(req.body?.targetCoverageSlotId || ""),
      targetCoverageSlotName: String(req.body?.targetCoverageSlotName || ""),
      coverageSourceFile: String(req.body?.coverageSourceFile || ""),
      authorityContractVersion: String(req.body?.authorityContractVersion || ""),
      /* WHICH AUTHORIZATION PAID FOR THIS, written by the server from the permit rather
         than copied from the request. This pair IS the durable membership the ledger never
         had: `automationRunId` beside it is the same value, but that field is what the
         body claimed and this is what the boundary established. It is also what makes a
         permit single-use — a permit is redeemed if and only if a row here names it. */
      paidPermitId: String(membership.id || ""),
      paidAuthorization: {
        class: String(membership.permitClass || ""),
        ref: String(membership.authorizationRef || ""),
        ...(membership.stepKey ? { stepKey: String(membership.stepKey) } : {}),
      },
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
      /* The entitled format is the fallback rather than a bare "16:9". The unpaid preview
         route passes "" here and lets the compiled spec win, so a literal made the paid
         route answer differently from the preview of the same shot on a production that
         is not 16:9 - the request had to carry the format to get its own. */
      aspectRatio: String(req.body?.aspectRatio || (purpose === "motion-h3" && String(req.body?.profileMode || "") === "r2v" ? "adaptive" : entitledAspect || "16:9")),
      revisionRequest: String(req.body?.revisionRequest || "").trim(),
      revisedFromAssetId: String(req.body?.revisedFromAssetId || ""),
      createdAt: now(),
      updatedAt: now(),
      status: "SUBMITTING",
      outputs: [],
      error: "",
    };
    /* WHAT THE SCREEN WAS SHOWING, on the row before the row exists. */
    applyRequestTruth(job, planGate);
    /* THE PACKAGE THE ROUTE WILL ACTUALLY COMPILE, named on the row before anything asks
       whether it is current.
     *
     * `sourceBuildId` is copied straight off the body and has never been required: both
     * compilers read an empty one as "take this shot's last usable build". So a request
     * that simply omitted the key compiled and dispatched a package the freshness gate
     * below had returned null on without performing a single comparison - while the
     * byte-identical request naming that same package was refused 409. One omitted field
     * decided it, which is the shape of a bypass rather than a lenience.
     *
     * Filled in from the resolution the gate already performed, so this is the same
     * package by construction. Lines 1101/1042 write the compiled build's id onto the row
     * after compilation for exactly this value; they become a no-op re-assert, and the row
     * stops naming a build id nothing had checked. */
    job.sourceBuildId = job.sourceBuildId || planGate.resolvedBuildId || "";
    /* THE MODEL THE SCREEN NAMED, and THE PACKAGE THE SHOT STILL STANDS BEHIND. Both
       refuse before compilation, before the row is committed and before anything leaves
       this machine, for the same reason every other gate on this route does: a refused
       dispatch costs nothing and changes nothing. */
    const identityRefusal = modelIdentityRefusal(job, cfg);
    if (identityRefusal)
      return requestTruthRefusal(res, identityRefusal.status, identityRefusal.code, identityRefusal.error, identityRefusal.detail);
    /* THE FORMAT THE SCREEN WAS SHOWING, in the same slot and for the same reason: it is
       the other factor of the size, and it was the one the plan could not reach. */
    const aspectRefusal = aspectAuthorityRefusal(owner, req.body, purpose, trusted);
    if (aspectRefusal)
      return requestTruthRefusal(res, aspectRefusal.status, aspectRefusal.code, aspectRefusal.error, aspectRefusal.detail);
    const staleRefusal = packageFreshnessRefusal(owner, job);
    if (staleRefusal)
      return requestTruthRefusal(res, staleRefusal.status, staleRefusal.code, staleRefusal.error, staleRefusal.detail);
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
      /* THE SAME RATE THE DIALOG QUOTED FROM. The browser read this out of the
         configuration it was served and multiplied it by the duration it displayed;
         this reads the configuration in effect at submission and multiplies it by the
         duration the COMPILED PLAN settled on. Where those differ the plan wins, for
         exactly the reason the image path records the plan's candidate count rather
         than the caller's: the record must describe the job that was submitted. */
      motionRate: configuredMotionRate({ generation: { fal: cfg } }),
      durationSeconds: job.durationSeconds,
      at: now(),
    });
    /* The row is committed against CURRENT durable state, not against the
       snapshot this request read minutes ago — a job created by an overlapping
       request in between must survive. */
    /* ===================================================================
       THE DISPATCH-COMMIT POINT, AND THE ORDER OF ITS TWO DURABLE WRITES.

       Everything above this line can still refuse: the plan gate, the surface, the
       payload restriction, model identity, package freshness, the compiled-plan and
       capability preparation, the frame-presence gate, the legacy binding, the
       concurrency cap, the unresolved twin, the automation lease and both spend guards.
       Every one of them returns without a durable row and without contacting anything.

       Below it, a job row exists and a provider is about to be told about it.

       THE LEDGER IS WRITTEN FIRST, AND THAT IS THE WHOLE CORRECTION HERE.

       The coverage run and the generation ledger are two files with two persistence
       chains. An earlier version of this code wrote the run first and called the pair
       "one durable turn", which was simply false: an independent reviewer interrupted
       the process between them and got `sheet-running` carrying a job id that no ledger
       had ever heard of, with zero provider calls. Adjacent writes are not atomic and a
       catch block is not protection against process death.

       So the projection may never precede its source. A crash between these two writes
       now leaves a `SUBMITTING` job with no coverage record — which UNDER-claims, is
       visible in Activity, is refused a duplicate by blocksResubmission(), and is
       rebuilt into a coverage record the next time the job is ingested or refreshed.
       The old order could only over-claim, which is the direction that lies.

       See docs/coverage-durability-correction-note.md for the reading at every seam. */
    /* AND THE PERMIT IS SPENT IN THE SAME TURN THAT SPENDS IT.
     *
     * commit() serialises per project directory and RE-READS the ledger inside its own
     * turn with a synchronous mutator, so this check and the row it guards are indivisible
     * against every other dispatch of this project. That is what makes a permit
     * single-use without a lock, a counter or a second store: two concurrent redemptions
     * cannot both find no row, because the second turn reads what the first wrote.
     *
     * SPENTNESS LIVES HERE AND NOWHERE ELSE. Writing `redeemed: true` into paid-permits.json
     * would be a second answer in a file that cannot be written atomically with this one —
     * adjacent writes are not a transaction, which this route learned at the coverage seam
     * below. Removing the permit from that store afterwards is housekeeping; nothing about
     * this guarantee depends on it succeeding. */
    try {
      await commit(owner, (current) => {
        const spent = current.find((item) => String(item?.paidPermitId || "") === String(membership.id || ""));
        if (spent) {
          const error = new Error(`This dispatch permit has already been redeemed by generation ${spent.id}. Nothing was submitted.`);
          error.paidPermitRedeemed = spent.id;
          throw error;
        }
        current.push(job);
      });
    } catch (error) {
      /* Nothing durable exists and nothing has been sent. There is no coverage record to
         reconcile, because it has not been written yet — which is the point of the
         order. */
      if (error?.paidPermitRedeemed)
        return requestTruthRefusal(res, 409, "PAID_PERMIT_ALREADY_REDEEMED", error.message, { redeemedByJobId: error.paidPermitRedeemed });
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    /* Housekeeping, after the fact that matters is durable. A stored permit that survives
       a crash here is refused by the ledger check above, so this failing costs nothing. */
    if (!trusted?.permit) PaidPermit.dropPaidPermit(owner.dir, membership.id);
    if (typeof trusted?.onDispatchCommit === "function") {
      try {
        await trusted.onDispatchCommit(owner, job);
      } catch (error) {
        /* THE JOB IS ALREADY DURABLE, so this is not a refusal — refusing now would
           report "nothing happened" about a row that exists and is about to be
           submitted. The projection is simply missing, and the job it would have been
           built from carries everything needed to rebuild it: entity, list, coverage job
           type, sheet type and creation time. It is rebuilt on the next refresh or at
           ingest, exactly as a record lost to a crash at this same seam is.

           Recorded ON THE DURABLE ROW, not just on the in-memory job: a note only this
           process can see explains nothing to the next reader, which is the whole
           difference between a missing projection that is understood and one that is a
           mystery. A failure to write the note is not worth failing the dispatch over —
           the job is still real and the rebuild does not depend on the note. */
        job.coverageProjectionError = String(error?.message || error);
        await commit(owner, (current) => {
          const row = current.find((item) => item.id === job.id);
          if (row) row.coverageProjectionError = job.coverageProjectionError;
        }).catch(() => {});
      }
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
        /* AND THE COVERAGE PROJECTION MUST NOT GO ON LOOKING HEALTHY.
         *
         * An independent reviewer drove exactly this: the provider accepted and returned
         * img-1, BOTH acknowledgement writes failed, and the durable state was left with
         * one provider submission, a job still reading `SUBMITTING` with no external id,
         * and a coverage run still reading `sheet-running`. The response object was the
         * only thing that ever knew the request id. The job half of that is already
         * handled — an in-flight row with no handle blocks its own duplicate — but the
         * coverage board went on presenting the run as running, which is the half that
         * tells a filmmaker nothing is wrong.
         *
         * Reconciled through updateEntityCoverageRun(), the same lifecycle owner every
         * other failure on this route uses. `needs-attention` is the existing word for
         * "a person has to look at this", and it is the truthful one: the provider may
         * genuinely be rendering, and CineBraid cannot say. */
        await updateEntityCoverageRun(owner, job, "needs-attention",
          job.unresolvedReason || `CineBraid could not record the provider's answer: ${persistError.message}`).catch(() => {});
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
      await updateEntityCoverageRun(owner, job, "needs-attention", error.message);
      res.status(502).json({
        error: error.message,
        ...(verdict.status === Lifecycle.UNRESOLVED ? { code: "GENERATION_UNRESOLVED" } : {}),
        job: publicJob(job),
      });
    }
  }

  /* THE DIRECT AUTHORIZATION PATH.
   *
   * A filmmaker pressing Generate in a generation dialog is an authorization in its own
   * right, and it always was: manual generation is legitimate while an automation run is
   * live on the same shot, two differently scoped runs may touch one object at once, and a
   * manual payload can be materially identical to an automation step. CineBraid has never
   * claimed exclusivity over a production object and this does not start.
   *
   * So the class is `direct` BECAUSE THIS ROUTE MINTED IT, and never because a field was
   * missing. That distinction is the whole point: inferring "manual" from an absent
   * `automationRunId`, absent coverage fields, a manual-looking payload or a run nobody
   * happened to find is exactly the inference that let bounded work reclassify itself.
   *
   * WHAT THIS ROUTE DOES NOT DO: price anything, establish any ceiling, resolve a
   * generation plan, or dispatch. It records the paid scope a dialog is about to submit
   * and hands back a token for it. It is a round trip inside one Generate press, not a
   * confirmation step, and nothing here is shown to a filmmaker. */
  app.post("/api/generation/paid-permit", (req, res) => {
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    const cfg = config();
    if (!cfg.enabled) return res.status(400).json({ error: "FAL generation is disabled in Settings.", providerContacted: false, paidRequestSubmitted: false });
    const scopeBody = req.body && typeof req.body === "object" ? req.body : {};
    const declaration = Presentation.readGenerationRequestDeclaration(scopeBody);
    if (!declaration.declared)
      return res.status(400).json({
        error: "A dispatch permit has to say which generation surface and view the request will come from. Nothing was submitted.",
        code: "PAID_PERMIT_SCOPE_REQUIRED", providerContacted: false, paidRequestSubmitted: false,
      });
    const purpose = normalizedPurpose(scopeBody);
    try {
      /* Through the SAME two functions the boundary will use, so a scope declared here and
         the dispatch it authorises agree by construction rather than by two copies of the
         same arithmetic staying in step. */
      const permit = PaidPermit.issuePaidPermit(owner.dir, {
        permitClass: "direct",
        scope: dispatchScopeFor(scopeBody, { surface: declaration.surface, declaration }, purpose, effectiveOutputCount(purpose, scopeBody)),
        at: now(),
      });
      res.json({ ok: true, paidPermitId: permit.id, expiresAt: permit.expiresAt });
    } catch (error) {
      res.status(error?.status || 500).json({
        error: error?.message || "Could not issue a dispatch permit.",
        code: error?.code || "PAID_PERMIT_ISSUE_FAILED", providerContacted: false, paidRequestSubmitted: false,
      });
    }
  });

  /* THE PUBLIC ENTRY POINT. No trusted context, ever: a browser request describes the
     work it wants and cannot tell the server which privileged operation is running. */
  /* Both entry points end in guardRoute(), as guardRoute's own note says every
     serialized route must. Express 4 does not catch a rejected async handler, and an
     unanswered paid request is worse than an error: the browser waits forever on a
     generation whose state it cannot see, and the process dies on the unhandled
     rejection. These two were the only serialized routes still outside it. */
  app.post("/api/generation/fal/jobs", (req, res) => guardRoute(res, dispatchGenerationRequest(req, res, null)));

  /* THE COVERAGE OPERATION, which is a SERVER operation that happens to be started by a
     browser press.
   *
   * The browser asks for coverage work on an entity. The server establishes the run
   * record itself — through writeProject(), which uses INTERNAL_NONAUTHORITY_WRITE and is
   * therefore the only writer that can author it now that prepareSuccessor() preserves
   * the field across an ordinary save — and then dispatches through the same paid
   * boundary, supplying `reference-automation` as its own context.
   *
   * That is the whole ownership correction. The browser never says "I am
   * reference-automation"; it says "run coverage for this entity", and the server decides
   * what surface the operation it is running has. */
  app.post("/api/generation/fal/coverage/jobs", async (req, res) => {
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    const list = String(req.body?.entityList || "");
    const entityId = String(req.body?.entityId || "");
    const jobType = String(req.body?.coverageJobType || "");
    /* OPERATION SHAPE ONLY. Just enough to know WHICH server operation is being asked
       for, and no more: there is no plan check, no payload restriction, no capability,
       freshness, model, quantity or spend logic here. All of that belongs to the shared
       boundary and happens there exactly once, for this route and the public one alike. */
    if (!["characters", "locations", "props", "vehicles"].includes(list))
      return res.status(400).json({ error: "A supported entityList is required.", code: "COVERAGE_ENTITY_LIST_REQUIRED", providerContacted: false, paidRequestSubmitted: false });
    if (!entityId)
      return res.status(400).json({ error: "entityId is required.", code: "COVERAGE_ENTITY_REQUIRED", providerContacted: false, paidRequestSubmitted: false });
    if (!Presentation.CINEBRAID_COVERAGE_JOB_TYPES.includes(jobType))
      return res.status(400).json({
        error: `Coverage generation needs a coverage job type (${Presentation.CINEBRAID_COVERAGE_JOB_TYPES.join(" or ")}).`,
        code: "COVERAGE_JOB_TYPE_REQUIRED", providerContacted: false, paidRequestSubmitted: false,
      });
    if (!(ownerProject(owner)[list] || []).some((item) => String(item?.id) === entityId))
      return res.status(404).json({ error: "Entity no longer exists.", code: "COVERAGE_ENTITY_MISSING", providerContacted: false, paidRequestSubmitted: false });

    const mode = String(req.body?.coverageMode || jobType);
    const sheetType = String(req.body?.coverageSheetType || "");
    /* WHICH COVERAGE AUTHORIZATION THIS PRESS BELONGS TO, decided before anything is
       dispatched and from the server's own run record. Every provider-bound request that
       enters through this route gets a COVERAGE-class permit — there is no branch here in
       which a missing or altered field could earn it a `direct` one instead. */
    let coverageJobs;
    try {
      coverageJobs = readJobs(owner);
    } catch (error) {
      return res.status(ledgerFailureStatus(error)).json(ledgerFailurePayload(error));
    }
    /* THE TRANSITION, DECIDED ONCE. The permit's authorization reference, the refusal at
       the money boundary and the projection decision at the dispatch-commit point are three
       readings of this one answer rather than three answers that have to agree. */
    const transition = coverageTransitionFor(owner, coverageJobs, req.body, sheetType);
    /* Minted here and handed straight to the boundary as an argument. It never reaches a
       client and never crosses a process boundary, so it is deliberately not persisted:
       there is no window in which anything else could present it. */
    const coveragePermit = PaidPermit.mintPaidPermit({
      permitClass: "coverage",
      authorizationRef: transition.action === "govern" ? String(transition.ref || "") : "",
      scope: dispatchScopeFor(
        req.body,
        { surface: "reference-automation", declaration: { viewMode: Presentation.readGenerationRequestDeclaration(req.body).viewMode } },
        normalizedPurpose(req.body),
        effectiveOutputCount(normalizedPurpose(req.body), req.body),
      ),
      at: now(),
    });
    /* THE TRUSTED OPERATION DESCRIPTOR. Built here from values this route validated for
       itself, handed to the shared boundary as an argument, and reachable from no request
       field. It says which operation is running, which entity it is for, and what to do
       at the one moment the boundary decides the work is really happening. */
    return guardRoute(res, dispatchGenerationRequest(req, res, {
      surface: "reference-automation",
      permit: { ...coveragePermit, transition },
      entityList: list,
      entityId,
      /* WHICH COVERAGE TASK THIS IS, on the descriptor rather than re-derived downstream.
         The boundary's run guard and onDispatchCommit below both have to decide whether
         this request is continuing the run already on the entity, and two derivations of
         one predicate is how they would come to answer differently. Same two values, read
         once, here. */
      coverageMode: mode,
      coverageSheetType: sheetType,
      /* AND WHAT FORMAT THIS OPERATION DELIVERS. A sheet is a contact sheet rather than an
         entity card - an expression sheet is 4:3 and an angle sheet 16:9 - so it is the
         operation, not the entity, that decides. Read from the jobType and sheetType this
         route validated for itself a few lines above, exactly as the coverage dispatcher
         reads them; slot work is an entity card like any other and takes the list's own
         format. On the descriptor so that the boundary's aspect check is answering about
         the operation it is running rather than about a field the request supplied. */
      aspectRatio: jobType === "sheet" ? (sheetType === "expressions" ? "4:3" : "16:9") : referenceAspectLabel(list),
      async onDispatchCommit(dispatchOwner, job) {
        await commitProject(dispatchOwner, (project) => {
          const entity = (project[list] || []).find((item) => String(item?.id) === entityId);
          if (!entity) throw new Error(`Entity ${entityId} no longer exists.`);
          const existing = entity.coverageAutomation;
          /* WHICH RUN THIS FILES INTO, read off the transition decided before dispatch.
           *
           * The predicate this replaces lived here and compared the stored run's raw
           * `sheetType` and `mode` against the request's own two fields — so a run stored
           * as `sheetType: ""` and a press sending `"angles"`, the same board by every
           * reader in the product, were different tasks and the second destroyed the first.
           * Three reviews found three holes in that shape. It is a table now, in
           * coverageTransition(), and this is one reading of it.
           *
           * RE-CHECKED AGAINST THE RUN THIS TURN ACTUALLY FINDS. commitProject() re-reads
           * the document inside its own turn, so the record here need not be the one the
           * transition was computed from — an overlapping dispatch may have moved it. A
           * decision to join a specific run is therefore honoured only if that run is still
           * the live one; otherwise this press establishes, which under-claims rather than
           * writing into a projection that has since changed underneath it. */
          const continuing = !!existing
            && COVERAGE_RUN_ACTIVE_STATUSES.includes(String(existing.status || ""))
            && (transition.action === "govern" || transition.action === "continue")
            && String(existing.id || "") === String(transition.ref || "");
          const run = continuing ? { ...existing, updatedAt: now() } : {
            id: `coverage:${list}:${entityId}:${uid()}`,
            list, entityId, mode, sheetType,
            status: jobType === "sheet" ? "sheet-running" : "individual-running",
            startedAt: now(), updatedAt: now(), jobs: [],
          };
          /* WHAT THIS PRESS AUTHORISED, WRITTEN ONCE, WHEN IT IS AUTHORISED.
           *
           * These two figures are the quote the coverage dialog put in front of the
           * filmmaker — "N paid requests · up to M images" — and since coverageSubmission-
           * Error() they are what the money boundary holds every later job of this run to.
           * That makes WHEN they may be written the whole of the guarantee.
           *
           * They used to be assigned on every job of the run, continuing or not. So the
           * fourth request of a two-request run simply restated the ceiling as it went
           * past it, and the guard would have read back a bound handed to it by the thing
           * it was bounding. A ceiling the bounded work can rewrite is not a ceiling.
           *
           * `continuing` is already the answer to "is this the same press": a live run for
           * the same task. So a continuation inherits the bound it is a continuation of,
           * and only the establishing job — the one that just created `run` above — sets
           * it. They are display facts on the machine's own record in exactly the sense
           * they always were: they grant nothing, and now they withhold. */
          if (!continuing) {
            if (Number(req.body?.coverageRequestCount) > 0) run.requestCount = Number(req.body.coverageRequestCount);
            if (Number(req.body?.coverageMaximumImages) > 0) run.maximumImages = Number(req.body.coverageMaximumImages);
            /* AND WHAT IT AUTHORISED IN MONEY, from the count above through the one owner
               that multiplies a rate by a quantity. Recorded only where a count was, so a
               run never carries a ceiling describing work nobody quoted. */
            if (Number(run.maximumImages) > 0) run.maxSpend = coverageAuthorizedSpend(run.maximumImages);
          }
          /* THE JOB THIS RUN IS BECOMING LIVE FOR, recorded with it. A run and the job it
             was established for exist in the same durable turn, so there is no moment at
             which the record claims work with nothing behind it. */
          run.jobs = Array.isArray(run.jobs) ? run.jobs : [];
          if (!run.jobs.includes(job.id)) run.jobs.push(job.id);
          entity.coverageAutomation = run;
        });
      },
    }));
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
      /* Both ways a job can be uncertain, so a submission that died in flight has the
         same way out as one the classifier marked unresolved — asked once, of the owner
         of the question, rather than spelled out again here. */
      if (!Lifecycle.blocksResubmission(job))
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
      /* AN UNCERTAIN JOB WITH NO REQUEST ID HAS NOTHING TO POLL.
       *
       * This used to ask `isUnresolved(job)`, which is only one of the two ways a job
       * reaches that condition. The other is a durable `SUBMITTING` row with no handle,
       * and an independent reviewer followed what happened to it: the guard did not fire,
       * refresh() built a provider status URL out of nothing, the fetch failed, and the
       * catch below wrote FAILED. FAILED does not block resubmission — so a refresh
       * turned "we do not know whether we were billed" into "it definitely failed", and
       * the next request with the same context and a fresh clientRequestId was free to
       * send a second paid submission.
       *
       * A MISSING HANDLE IS NOT EVIDENCE OF FAILURE. The same durable row means either
       * the process stopped before the provider was contacted, or the provider accepted
       * and CineBraid could not record the answer. Nothing here can tell those apart, and
       * only one of them is free.
       *
       * So the question asked is the lifecycle's own, by name: a job whose outcome is
       * uncertain and which carries no request id to ask about. The poller and the
       * duplicate guard cannot disagree about which jobs are uncertain, because there is
       * only one definition of it and this is not a second copy of it. */
      if (Lifecycle.isSubmissionUncertainWithoutHandle(job, "externalId")) {
        /* The projection is a projection: a run whose only job is uncertain must not go
           on presenting itself as an ordinary healthy generation. The durable JOB is
           left exactly as it is — see the invariant above — and only the coverage record
           is moved, through the same lifecycle owner every other attention state uses. */
        await updateEntityCoverageRun(owner, job, "needs-attention",
          "CineBraid has no request id for this submission, so it cannot check what happened to it.").catch(() => {});
        const reason = Lifecycle.resubmissionBlockReason(job);
        return {
          ok: false,
          outcome: "no-handle",
          code: "GENERATION_UNRESOLVED_NO_HANDLE",
          job,
          blockReason: reason,
          error: reason === "in-flight-without-handle"
            ? "CineBraid never received a request id for this submission, so there is nothing it can check. It may never have reached the provider, or the provider may have accepted it and the answer was lost — CineBraid cannot tell which. Look for it at the provider and record what you find."
            : "CineBraid never received a request id for this submission, so there is nothing it can check. Look for it at the provider and record what you find.",
        };
      }
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
    return guardRoute(res, collectJob(owner, req.params.id).then(async (result) => {
      /* THE EARLIEST DETERMINISTIC REPAIR. A crash between the ledger write and the
         projection write leaves a coverage job whose record was never written; the
         browser polls this route for exactly such a job, because it is still active. So
         the projection is rebuilt here from the row, rather than waiting for outputs to
         arrive at ingest. A record that already exists is untouched. */
      if (result.job) await repairCoverageProjection(owner, result.job);
      if (result.ok) return res.json({ ok: true, job: publicJob(result.job) });
      if (result.outcome === "not-found") return res.status(404).json({ error: result.error });
      if (result.outcome === "no-handle")
        return res.status(409).json({ error: result.error, code: result.code, job: publicJob(result.job) });
      await repairCoverageProjection(owner, result.job);
      const projectUpdated = await updateEntityCoverageRun(owner, result.job, "needs-attention", result.error);
      res.status(502).json({ error: result.error, job: publicJob(result.job), projectUpdated });
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
      /* CANCELLING AN UNCERTAIN JOB WITH NO HANDLE WOULD WRITE CANCELLED OVER A REQUEST
         THAT MAY WELL BE RENDERING — turning an honest "unknown" into a confident
         falsehood, and releasing the duplicate block that the uncertainty exists to hold.
         There is nothing to cancel; there is something to go and check.

         This asked `isUnresolved(job)`, one of the two ways a job becomes uncertain, so a
         durable `SUBMITTING` row with no request id walked straight past it: no provider
         was contacted, because there was no cancel URL to contact one with, and CANCELLED
         was persisted anyway from local intent alone. CANCELLED does not block
         resubmission, so the next press bought the shot again. Wanting a job cancelled is
         not evidence that the provider never took it.

         The question is now the lifecycle's own, narrowed to the handle THIS operation
         needs: without a cancel URL there is no way to tell the provider anything, so
         writing a terminal status here is local inference whatever else the row carries.
         An uncertain job that HAS a cancel URL is untouched — it still contacts the
         provider and still cancels, which is real evidence, not a guess. */
      if (Lifecycle.isSubmissionUncertainWithoutHandle(job, "cancelUrl"))
        return res.status(409).json({
          error: "CineBraid never received a handle for this submission, so it cannot cancel it. The generation may be running at the provider. Check there, then record what you found on this job.",
          code: "GENERATION_UNRESOLVED_NO_HANDLE",
          blockReason: Lifecycle.resubmissionBlockReason(job),
          job: publicJob(job),
        });
      if (job.cancelUrl && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
        /* A CANCELLATION THE PROVIDER DID NOT CONFIRM IS NOT A CANCELLATION.
         *
         * The response used to be discarded outright — `.catch(() => null)` and nothing
         * read — so a 503, a 404 or a dropped connection all ended at the same write
         * below, and CANCELLED was persisted for a render that may well still be running
         * and still be charged. An independent reviewer took the obvious next step: a
         * CANCELLED job does not block resubmission, so a failed cancel handed the
         * filmmaker permission to buy the same shot again.
         *
         * The criterion is not invented here. `response.ok` is what this module already
         * treats as a usable provider answer — refresh() polls the status URL and throws
         * `normalizeError(data, status)` on anything else — so a cancellation is
         * confirmed on exactly the terms every other provider call in this file is, and
         * nothing else about fal's cancel semantics is assumed.
         *
         * On failure the durable job is left EXACTLY as it was, in whatever state it was
         * truthfully in, and so is its coverage record: the projection describes the job,
         * the job did not change, so neither does the projection. 502 is the status this
         * module already answers with when the provider gives no usable answer. */
        const response = await fetch(job.cancelUrl, { method: "PUT", headers: { Authorization: `Key ${cfg.apiKey}` } }).catch(() => null);
        if (!response || !response.ok) {
          const detail = response ? normalizeError(await response.json().catch(() => ({})), response.status) : "the provider could not be reached";
          return res.status(502).json({
            error: `CineBraid asked the provider to cancel this generation and did not get a confirmation (${detail}). It may still be running and may still be charged, so CineBraid has left the job as it was rather than recording a cancellation it cannot vouch for.`,
            code: "GENERATION_CANCEL_UNCONFIRMED",
            job: publicJob(job),
          });
        }
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
      const projectUpdated = await updateEntityCoverageRun(owner, job, "cancelled", "Provider job cancelled by user.");
      res.json({ ok: true, job: publicJob(job), projectUpdated });
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

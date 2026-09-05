/* Local ComfyUI generation: dispatch, state and delivery.
 *
 * The route layer between a CineBraid shot and comfy-client.js. Everything durable it
 * writes — the job ledger row, the candidate row, the project document — goes through
 * the same shared writers fal-generation.js uses, so there is one generation ledger,
 * one project-commit chain and one returned-candidate writer in the product, not two.
 *
 * ------------------------------------------------------------------------------
 * WHY THIS IS NOT ROUTED THROUGH dispatchGenerationRequest()
 *
 * fal-generation.js's dispatcher is CineBraid's PAID BOUNDARY. It refuses unless
 * `generation.fal.enabled` and an API key are present, it mints and spends a paid
 * permit, and its whole shape is the machinery that stops money being spent by
 * accident. A local render needs none of it: generation-contracts.js's own
 * `requiresExplicitAuthorization()` returns false for `free_local`, because there is
 * nothing to authorise.
 *
 * Threading a free path through that function would mean loosening the two enablement
 * gates that guard every paid dispatch, to serve a caller that must never reach a paid
 * provider. That is a change to the money boundary made for the benefit of something
 * that is not on the other side of it. So ComfyUI dispatches here, and the paid
 * boundary is left exactly as it was — a property a test can state and this file can
 * keep: NOTHING IN THIS MODULE CAN CONTACT A PAID PROVIDER. It imports no provider key,
 * no permit, and one client whose only permitted destination is this machine.
 *
 * WHAT IT DOES SHARE, because sharing these is correctness rather than convenience:
 *   generation-commit.js            one commit chain per project, across all backends
 *   generation-candidate-ingest.js  one writer of a returned candidate
 *   generation-job-store.js         one generation ledger per project
 *   generation-lifecycle.js         one status vocabulary
 *   generation-contracts.js         the provider-neutral job and result contract
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Client = require("./comfy-client");
const Registry = require("./comfy-registry");
const Workflow = require("./comfy-workflow");
const Contracts = require("./generation-contracts");
const Lifecycle = require("./generation-lifecycle");
const { readJobLedger, JobLedgerUnreadableError } = require("./generation-job-store");
const { commitJobLedger, commitProjectDocument, serializeJobOperation } = require("./generation-commit");
const { markShotAwaitingReview, writeShotCandidates } = require("./generation-candidate-ingest");
const { isProjectRelativeMediaPath } = require("./public/shared-local-file");
const { isLoopbackRequest } = require("./loopback-request");

/* CineBraid's word for what produced a candidate. Rendered verbatim by the media
   inspector's Provider row, so it is the product's real name rather than a slug. */
const COMFY_PROVIDER = "ComfyUI";
/* The filename stem a delivered result carries, beside fal's "FAL". */
const COMFY_FILE_STEM = "COMFY";
/* The contract-level identity of what ran.
 *
 * NOT a checkpoint name. A registered workflow loads whatever weights its author wired
 * into it, CineBraid cannot verify which, and a product that prints a guess beside a
 * picture has told the director something it does not know. What IS knowable is that
 * this was an operator's own local graph, and the graph itself is recorded as the
 * recipe — which is exactly what data/provider-surfaces.json already says the
 * comfy-local surface is identified by: `identifierScheme.format: "recipe-id"`. */
const COMFY_MODEL_ID = "comfy-local/workflow";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function nowIso() {
  return new Date().toISOString();
}
function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

/* ---------------------------------------------------------------------------
   Cost truth. One shape, and it is not a number CineBraid made up.

   generation-cost.js hardcodes `metered_api` for every fal job, which is correct there
   and would be a lie here. The contract's own validator refuses anything else:
   free_local must carry unit "none" and amount 0, and `local_native` must carry
   free_local. So this is not a claim this module makes — it is the only shape
   validateCostEstimate() will accept for a render that happens on the operator's own
   machine, and the dispatch below is refused if it ever stops matching.

   WHAT IT DOES NOT SAY. It does not say the render was free. Electricity, wear and the
   GPU-hour a filmmaker could have spent elsewhere are real; what `free_local` states,
   precisely, is that NO HOSTED PROVIDER WILL CHARGE FOR THIS — the only cost question
   CineBraid is in a position to answer. The label a screen shows says the same thing in
   words: "Local ComfyUI · no provider charge". */
function localAccounting(at) {
  return {
    costClass: "free_local",
    estimate: { costClass: "free_local", unit: "none", amount: 0, confidence: "quoted", quotedAt: at },
    recordedAt: at,
    basis: { kind: "local-render", why: "This runs on the machine CineBraid is running on. No hosted provider is contacted and none can bill for it." },
  };
}
const COMFY_COST_LABEL = "Local ComfyUI · no provider charge";

/* ---------------------------------------------------------------------------
   The status vocabulary is CineBraid's, and it is USED rather than merely cited.

   Every status this module writes goes through here, so a typo cannot reach the ledger
   and a state this product has no word for cannot be invented locally. That matters more
   than it looks: `generation-poller.js`, the activity drawer, `blocksResubmission()` and
   every surface that asks "is this still running" read these exact strings, and a backend
   that quietly spelled one of them differently would be invisible to all of them while
   looking correct in its own file. */
function ledgerStatus(value) {
  const status = text(value);
  if (!Lifecycle.LEDGER_STATUSES.includes(status))
    throw new ComfyGenerationError(
      "COMFY_STATUS_UNKNOWN",
      `CineBraid has no generation status called "${status}".`,
      { status, known: Lifecycle.LEDGER_STATUSES },
      500,
    );
  return status;
}

/* ---------------------------------------------------------------------------
   Configuration. Two scalars, in data/config.json where every other setting lives. */
function comfyConfig(readConfig) {
  const c = readConfig() || {};
  const comfy = isRecord(c.generation?.comfy) ? c.generation.comfy : {};
  return {
    enabled: comfy.enabled === true,
    baseUrl: text(comfy.baseUrl) || Client.COMFY_DEFAULT_BASE_URL,
    workflowFolder: text(comfy.workflowFolder),
  };
}

/* ---------------------------------------------------------------------------
   Input media identity.

   A reference must be a CineBraid media identity, never a path or a label. The request
   carries the same `/assets/<project-relative>` URL every other CineBraid surface uses
   for media, and it is validated by the SHIPPED predicate —
   public/shared-local-file.js's isProjectRelativeMediaPath — rather than by a second
   regex written here. That predicate already refuses backslashes, drive letters, a
   leading slash, NULs, and any `.`/`..` segment, and then requires one of CineBraid's
   own media folder shapes. Reusing it is what keeps this backend and the local-file
   affordances from drifting into two different ideas of what a media path is.

   Containment is then re-proved against the OWNER's directory, so a URL that satisfies
   the shape but resolves elsewhere is still refused, and so a reference belonging to
   film A cannot be read while generating for film B. */
function resolveOwnedMedia(owner, assetUrl) {
  const raw = text(assetUrl);
  if (!raw) throw new ComfyGenerationError("COMFY_REFERENCE_UNNAMED", "A reference image was requested with no media identity.", {}, 400);
  if (!raw.startsWith("/assets/"))
    throw new ComfyGenerationError("COMFY_REFERENCE_NOT_CINEBRAID_MEDIA", "A reference must be CineBraid media, named the way CineBraid names it.", { assetUrl: raw }, 400);
  let rel;
  try {
    rel = decodeURIComponent(raw.slice("/assets/".length));
  } catch {
    throw new ComfyGenerationError("COMFY_REFERENCE_NOT_CINEBRAID_MEDIA", "That reference is not a media identity CineBraid can read.", { assetUrl: raw }, 400);
  }
  if (!isProjectRelativeMediaPath(rel))
    throw new ComfyGenerationError("COMFY_REFERENCE_OUTSIDE_MEDIA", "That reference is outside CineBraid media storage.", { assetUrl: raw }, 400);
  const root = path.resolve(owner.dir);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep))
    throw new ComfyGenerationError("COMFY_REFERENCE_OUTSIDE_PROJECT", "That reference belongs to a different project.", { assetUrl: raw }, 400);
  if (!fs.existsSync(file))
    throw new ComfyGenerationError("COMFY_REFERENCE_MISSING", "That reference is recorded but its file is not there.", { assetUrl: raw }, 409);
  return { file, relativePath: rel, assetUrl: raw };
}

const MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

class ComfyGenerationError extends Error {
  constructor(code, message, detail = {}, status = 400) {
    super(message);
    this.name = "ComfyGenerationError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

function failureOf(error) {
  const status = Number(error?.status) || 500;
  return {
    status,
    body: {
      error: text(error?.message) || "ComfyUI generation failed.",
      code: text(error?.code) || "COMFY_FAILED",
      detail: isRecord(error?.detail) ? error.detail : {},
    },
  };
}

/* ---------------------------------------------------------------------------
   The provider-neutral job, built and VALIDATED.
 *
 * This is what makes ComfyUI the first real consumer of generation-contracts.js rather
 * than a second thing beside it. The contract is not decoration here: it refuses a
 * `local_native` result that claims a metered cost, refuses a free job that carries an
 * account connection, and — through FORBIDDEN_INTENT_KEYS — refuses a job whose
 * production intent has learned the words `workflow`, `class_type`, `nodeid`,
 * `prompt_id` or `comfy`. Those are precisely the leaks this integration could produce,
 * and the validator that catches them already shipped. */
function contractJob({ jobId, shotId, frameId, prompt, negativePrompt, references, seed, recipeId, status }) {
  const job = {
    jobId,
    target: { kind: "shot-frame", shotId, frameId: frameId || "", purpose: "frame" },
    mode: "t2i",
    outputType: "image",
    /* modelId only. A display name in intent is refused by the contract, and rightly:
       the moment anything selects on a label, renaming it changes behaviour. */
    model: { modelId: COMFY_MODEL_ID },
    inputs: {
      prompt: String(prompt || ""),
      /* A negative prompt is a production input, not a provider parameter — it says
         what the shot must not contain. It rides in `settings` rather than `inputs`
         because `inputs.prompt` is the single compiled text the contract knows. */
      references: references.map((reference, index) => ({
        refId: `r${index + 1}`,
        role: reference.role,
        mediaType: "image",
        source: { kind: "project-asset", path: reference.relativePath },
        order: index + 1,
      })),
    },
    output: { candidateCount: 1 },
    settings: {
      seedMode: Number.isFinite(Number(seed)) ? "explicit" : "random",
      ...(Number.isFinite(Number(seed)) ? { seed: Number(seed) } : {}),
      routingIntent: "standard",
      negativePrompt: String(negativePrompt || ""),
    },
    /* Routing is deliberately OUTSIDE the intent blocks the contract scans. A backend
       id and a recipe id are how this job is wired, and the shot must never carry them
       — which is exactly why they live here and not in `model` or `settings`. */
    routing: {
      selection: "backend",
      policy: "local_only",
      backendId: Client.COMFY_BACKEND_ID,
      recipeId,
      resolved: {
        executionKind: "local_native",
        orchestratorLocation: "same_host",
        inferenceLocation: "same_host",
        costClass: "free_local",
      },
    },
    governance: { dataClassification: "INTERNAL", requiredAssurances: [] },
    accounting: { costClass: "free_local", estimate: localAccounting(nowIso()).estimate },
    status,
  };
  const validated = Contracts.validateGenerationJob(job);
  if (!validated.ok)
    throw new ComfyGenerationError(
      "COMFY_JOB_CONTRACT",
      `CineBraid built a generation request it will not send: ${validated.errors[0].message}`,
      { errors: validated.errors },
      500,
    );
  return job;
}

function contractResult({ jobId, status, artifacts, recipeId, recipeVersion, inputsUsed, errors }) {
  const result = {
    jobId,
    status,
    backend: {
      backendId: Client.COMFY_BACKEND_ID,
      executionKind: "local_native",
      orchestratorLocation: "same_host",
      inferenceLocation: "same_host",
      costClass: "free_local",
    },
    model: { modelId: COMFY_MODEL_ID },
    recipe: { recipeId, version: Number(recipeVersion) || Workflow.COMFY_MAPPING_VERSION },
    artifacts,
    inputsUsed: inputsUsed || [],
    errors: errors || [],
  };
  const validated = Contracts.validateGenerationResult(result);
  if (!validated.ok)
    throw new ComfyGenerationError(
      "COMFY_RESULT_CONTRACT",
      `CineBraid will not record a result it cannot describe: ${validated.errors[0].message}`,
      { errors: validated.errors },
      500,
    );
  return result;
}

/* ---------------------------------------------------------------------------
   Registration. */
function registerComfyGeneration(app, context) {
  const { readConfig, readProject, writeProject, activeSlug, projectDirForSlug } = context;

  function ownerForSlug(slug) {
    const { dir, file } = projectDirForSlug(slug);
    return { slug, dir, file };
  }
  /* Captured ONCE, before the first await, exactly as fal-generation.js captures it and
     for the same reason: a generation is a long chain of awaits and the user is free to
     switch projects during it. Every later read, write and path is addressed through
     this record, so switching cannot redirect work already in flight. */
  function captureOwner() {
    const slug = activeSlug();
    if (!slug) throw new ComfyGenerationError("COMFY_NO_PROJECT", "No project is open.", {}, 404);
    return ownerForSlug(slug);
  }
  function ownerProject(owner) {
    return readProject(owner.slug);
  }
  function saveOwnerProject(owner, project) {
    return writeProject(project, owner.slug);
  }
  function commitProject(owner, mutate) {
    return commitProjectDocument(owner, mutate, {
      readProject: (owner) => ownerProject(owner),
      writeProject: (owner, project) => saveOwnerProject(owner, project),
    });
  }

  function comfyJobs(owner) {
    return readJobLedger(owner.dir).jobs.filter((row) => text(row?.backendId) === Client.COMFY_BACKEND_ID);
  }

  /* ---- connection truth --------------------------------------------------- */
  async function connectionStatus() {
    const cfg = comfyConfig(readConfig);
    if (!cfg.enabled)
      return { ...cfg, connected: false, code: "COMFY_DISABLED", reason: "Local ComfyUI generation is switched off in Settings.", version: "", costLabel: COMFY_COST_LABEL };
    const probed = await Client.probe(cfg.baseUrl);
    return { ...cfg, ...probed, costLabel: COMFY_COST_LABEL };
  }

  app.get("/api/generation/comfy/status", async (req, res) => {
    try {
      res.json(await connectionStatus());
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* A real round trip, deliberately, rather than a config check. "Test connection" that
     only re-reads the settings the user just typed answers a question nobody asked. */
  app.post("/api/generation/comfy/test", async (req, res) => {
    try {
      const cfg = comfyConfig(readConfig);
      /* The address under test is whatever Settings holds; an unsaved field is not a
         connection. The panel saves before it tests. */
      const probed = await Client.probe(cfg.baseUrl);
      res.json({ ...probed, enabled: cfg.enabled, costLabel: COMFY_COST_LABEL });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* ---- the workflow folder ------------------------------------------------
   *
   * THESE FOUR ROUTES READ THE SERVER'S OWN FILESYSTEM, so they answer only this
   * machine. Every /api route is already editor-gated, and an editor can already set a
   * workspace root — but "may configure this production" and "may read directories on
   * the machine hosting it" are different powers, and this integration has no reason to
   * grant the second to a browser on the network. The ComfyUI it drives is loopback-only
   * and the folder it reads is local, so a request from another device is configuring
   * something it cannot see.
   *
   * The same rule local-file-affordance.js applies, applied for the same reason: the
   * shipped predicate reads the socket's peer address and deliberately ignores Host,
   * X-Forwarded-For and every other header a caller controls.
   *
   * Dispatch, collection and status are NOT gated here — those act on production, which
   * an editor on the network is entitled to do. IMPLEMENTATION_NOTES records that a
   * remote browser therefore sees no workflow list and no GENERATE LOCALLY control,
   * which is the honest consequence: local ComfyUI is set up from the machine it runs
   * on. */
  function requireLocalMachine(req, res) {
    if (isLoopbackRequest(req)) return true;
    res.status(403).json({
      error: "Local ComfyUI is set up on the computer running CineBraid.",
      code: "LOOPBACK_REQUIRED",
    });
    return false;
  }

  app.get("/api/generation/comfy/workflows", (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      const cfg = comfyConfig(readConfig);
      if (!cfg.workflowFolder)
        return res.json({ folder: "", workflows: [], configured: false, reason: "No workflow folder is set." });
      res.json({ ...Registry.listWorkflows(cfg.workflowFolder), configured: true });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  app.post("/api/generation/comfy/workflow", (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      const cfg = comfyConfig(readConfig);
      res.json(Registry.describeForMapping(cfg.workflowFolder, text(req.body?.relativePath)));
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* THE ONLY ROUTE THAT WRITES A MAPPING. A suggestion reaches the browser from
     /workflow above and has no storage; it becomes a binding only by being posted back
     here, which is a person pressing Save. */
  app.post("/api/generation/comfy/workflow/mapping", (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      const cfg = comfyConfig(readConfig);
      res.json(Registry.confirmMapping(cfg.workflowFolder, text(req.body?.relativePath), req.body?.bindings));
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  app.post("/api/generation/comfy/workflow/forget", (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      res.json(Registry.forgetWorkflow(text(req.body?.relativePath)));
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* ---- the ledger --------------------------------------------------------- */
  app.get("/api/generation/comfy/jobs", (req, res) => {
    try {
      const owner = captureOwner();
      res.json({ jobs: comfyJobs(owner), costLabel: COMFY_COST_LABEL });
    } catch (error) {
      if (error instanceof JobLedgerUnreadableError)
        return res.status(error.status).json({ error: error.message, code: error.code, detail: error.detail });
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* ---- dispatch ----------------------------------------------------------- */
  async function dispatch(owner, request) {
    const cfg = comfyConfig(readConfig);
    if (!cfg.enabled)
      throw new ComfyGenerationError("COMFY_DISABLED", "Local ComfyUI generation is switched off in Settings.", {}, 409);

    const shotId = text(request.shotId);
    const shot = (ownerProject(owner).shots || []).find((row) => String(row.id) === shotId);
    if (!shot) throw new ComfyGenerationError("COMFY_SHOT_MISSING", "That shot is not in this project.", { shotId }, 404);

    /* The workflow, revalidated against the bytes on disk right now. loadForDispatch()
       refuses a broken mapping here rather than at the screen, so a caller that skipped
       the screen is refused too. */
    const workflow = Registry.loadForDispatch(cfg.workflowFolder, text(request.relativePath));

    /* Inputs. Every reference is resolved to an owned CineBraid file BEFORE anything is
       uploaded, so a refusal costs nothing and cannot leave a stray file in ComfyUI's
       input folder. */
    const prompt = String(request.prompt || "");
    if (!prompt.trim()) throw new ComfyGenerationError("COMFY_PROMPT_EMPTY", "This generation has no prompt.", {}, 400);
    const bindings = workflow.mapping.bindings || {};
    const references = [];
    for (const key of Workflow.COMFY_IMAGE_SEMANTIC_KEYS) {
      const requested = text(request.references?.[key]);
      if (!requested) continue;
      if (!bindings[key])
        throw new ComfyGenerationError("COMFY_INPUT_UNMAPPED", `This workflow has no ${key} input, so CineBraid cannot send one.`, { key }, 409);
      const resolved = resolveOwnedMedia(owner, requested);
      references.push({ key, role: Workflow.COMFY_SEMANTIC_INPUTS.find((e) => e.key === key).referenceRole, ...resolved });
    }

    const seed = Number.isFinite(Number(request.seed)) ? Number(request.seed) : null;
    const jobId = uid("comfy-job");
    /* Built and validated BEFORE the ledger row exists, so an intent CineBraid would
       not send never becomes a durable record of something it tried. */
    const contract = contractJob({
      jobId,
      shotId,
      frameId: text(request.frameId),
      prompt,
      negativePrompt: String(request.negativePrompt || ""),
      references,
      seed,
      recipeId: workflow.relativePath,
      status: "preparing_inputs",
    });

    /* Upload every reference and record what ComfyUI named it. The uploaded name is
       derived from the CineBraid asset it came from, so a file in ComfyUI's input
       folder is traceable back to the shot that sent it. */
    const uploads = {};
    const inputsUsed = [];
    for (const reference of references) {
      const ext = path.extname(reference.file).toLowerCase();
      const uploaded = await Client.uploadImage(cfg.baseUrl, {
        buffer: fs.readFileSync(reference.file),
        filename: `${shotId}_${reference.key}_${path.basename(reference.file)}`,
        mime: MIME_BY_EXT[ext] || "application/octet-stream",
      });
      uploads[reference.key] = uploaded.reference;
      inputsUsed.push({ path: reference.relativePath, role: reference.role, comfyInputName: uploaded.reference });
    }

    /* The execution snapshot. A deep copy — the filmmaker's file is never written. */
    const built = Workflow.buildDispatchGraph(workflow.bytes, workflow.mapping, {
      positivePrompt: prompt,
      negativePrompt: String(request.negativePrompt || ""),
      seed,
      ...uploads,
    });

    const clientId = uid("cinebraid");
    const at = nowIso();
    /* The durable row is written BEFORE submission. A job that is submitted and then
       crashes before it is recorded is a render nobody can find; a job recorded and
       then refused is a row that says so. */
    const job = {
      id: jobId,
      provider: COMFY_PROVIDER,
      backendId: Client.COMFY_BACKEND_ID,
      surfaceId: Client.COMFY_SURFACE_ID,
      kind: "image",
      purpose: "frame",
      mode: "t2i",
      shotId,
      frameId: text(request.frameId),
      frameLabel: text(request.frameLabel) || "A",
      /* What a filmmaker recognises. The workflow IS the recipe, and the recipe is what
         comfy-local is identified by; see COMFY_MODEL_ID for what is deliberately not
         claimed here. */
      model: workflow.relativePath,
      modelId: COMFY_MODEL_ID,
      prompt,
      negativePrompt: String(request.negativePrompt || ""),
      references: references.map((row) => ({ key: row.key, role: row.role, url: row.assetUrl, path: row.relativePath })),
      outputCount: 1,
      quality: "",
      resolution: "",
      seed,
      createdAt: at,
      updatedAt: at,
      status: ledgerStatus("SUBMITTING"),
      outputs: [],
      error: "",
      ingestedAt: "",
      accounting: localAccounting(at),
      contract,
      comfy: comfyProvenance({ cfg, workflow, built, uploads, references, clientId, seed }),
    };
    await commitJobLedger(owner, (jobs) => { jobs.push(job); return job; });

    let submitted;
    try {
      submitted = await Client.submitPrompt(cfg.baseUrl, built.graph, { clientId });
    } catch (error) {
      await commitJobLedger(owner, (jobs) => {
        const row = jobs.find((item) => item.id === jobId);
        if (!row) return null;
        row.status = ledgerStatus("FAILED");
        row.error = text(error.message);
        row.errorCode = text(error.code);
        row.errorDetail = isRecord(error.detail) ? error.detail : {};
        row.updatedAt = nowIso();
        return row;
      });
      throw error;
    }

    return commitJobLedger(owner, (jobs) => {
      const row = jobs.find((item) => item.id === jobId);
      if (!row) return job;
      row.externalId = submitted.promptId;
      row.queuePosition = Number.isFinite(submitted.queueNumber) ? submitted.queueNumber : null;
      row.status = ledgerStatus("IN_QUEUE");
      row.updatedAt = nowIso();
      row.comfy = { ...row.comfy, promptId: submitted.promptId, submittedAt: row.updatedAt };
      return row;
    });
  }

  /* ---------------------------------------------------------------------------
     Provenance — everything needed to explain or reproduce this run.

     ComfyUI-specific facts live under `job.comfy`, never in the shot and never in the
     contract's intent blocks. That separation is not a convention here: FORBIDDEN_INTENT_KEYS
     refuses `workflow`, `class_type`, `nodeid`, `prompt_id` and `client_id` inside
     target/inputs/output/settings/model, so an attempt to move any of this into
     production intent fails validateGenerationJob() rather than shipping.

     THE GRAPH SNAPSHOT IS STORED WHOLE. It is the only thing that can answer "what
     exactly ran", it is a few kilobytes of JSON, and a reference to a file that the
     filmmaker may edit tomorrow is not a snapshot. Both hashes are kept beside it: the
     file as it was when a person confirmed the mapping, and the file as it was at
     dispatch. When they differ, the run is still explainable and the difference is
     legible instead of invisible. */
  function comfyProvenance({ cfg, workflow, built, uploads, references, clientId, seed }) {
    return {
      backendId: Client.COMFY_BACKEND_ID,
      surfaceId: Client.COMFY_SURFACE_ID,
      /* The address, with no credential — this client sends none and stores none. */
      serverUrl: Client.normalizeBaseUrl(cfg.baseUrl),
      executionKind: "local_native",
      orchestratorLocation: "same_host",
      inferenceLocation: "same_host",
      trustClass: "loopback",
      costClass: "free_local",
      workflow: {
        relativePath: workflow.relativePath,
        format: workflow.format,
        contentHash: workflow.contentHash,
        mappedHash: workflow.mappedHash,
        changedSinceConfirmed: Boolean(workflow.mappedHash) && workflow.mappedHash !== workflow.contentHash,
        state: workflow.state,
      },
      mapping: {
        mappingVersion: workflow.mapping.mappingVersion,
        confirmedAt: workflow.mapping.confirmedAt || "",
        bindings: workflow.mapping.bindings,
      },
      /* Which semantic inputs CineBraid actually set, and which it left as the
         workflow's own value. A negative prompt left empty means the author's negative
         prompt ran — a different fact from an empty one, and one a reader must be able
         to recover. */
      appliedInputs: built.applied,
      keptWorkflowValues: built.skipped,
      uploadedInputs: uploads,
      sourceAssets: references.map((row) => ({ key: row.key, role: row.role, path: row.relativePath, assetUrl: row.assetUrl })),
      outputNodes: built.outputNodes,
      seed,
      clientId,
      /* THE EXECUTED GRAPH, whole. */
      graphSnapshot: built.graph,
      preparedAt: nowIso(),
    };
  }

  /* ---------------------------------------------------------------------------
     Collection and delivery. */
  async function collect(owner, jobId) {
    return serializeJobOperation(owner, jobId, async () => {
      const job = comfyJobs(owner).find((row) => row.id === jobId);
      if (!job) throw new ComfyGenerationError("COMFY_JOB_MISSING", "That generation is not in this project's record.", { jobId }, 404);
      if (job.ingestedAt) return job;
      if (!text(job.externalId)) throw new ComfyGenerationError("COMFY_JOB_UNSUBMITTED", "That generation was never accepted by ComfyUI.", { jobId }, 409);

      const cfg = comfyConfig(readConfig);
      const history = await Client.readHistory(cfg.baseUrl, job.externalId);

      if (history.state === "failed") {
        return commitJobLedger(owner, (jobs) => {
          const row = jobs.find((item) => item.id === jobId);
          if (!row) return job;
          row.status = ledgerStatus("FAILED");
          row.error = text(history.error) || "ComfyUI reported an error while running this workflow.";
          row.updatedAt = nowIso();
          row.comfy = { ...row.comfy, completedAt: row.updatedAt, statusText: history.statusText };
          return row;
        });
      }
      if (history.state !== "completed") {
        const queue = history.state === "pending" ? await Client.queuePosition(cfg.baseUrl, job.externalId) : { state: "running", position: 0 };
        const status = ledgerStatus(queue.state === "queued" ? "IN_QUEUE" : queue.state === "running" ? "IN_PROGRESS" : job.status);
        return commitJobLedger(owner, (jobs) => {
          const row = jobs.find((item) => item.id === jobId);
          if (!row) return job;
          row.status = status;
          row.queuePosition = queue.position;
          row.updatedAt = nowIso();
          return row;
        });
      }

      const images = history.outputs.filter((row) => row.kind === "image");
      if (!images.length)
        return commitJobLedger(owner, (jobs) => {
          const row = jobs.find((item) => item.id === jobId);
          if (!row) return job;
          row.status = ledgerStatus("FAILED");
          row.error = "ComfyUI finished this workflow but saved no image. A workflow CineBraid can deliver ends in a Save node.";
          row.updatedAt = nowIso();
          return row;
        });

      /* DOWNLOAD PHASE — every byte fetched before the commit turn opens, because the
         turn is synchronous by contract and holding the project document open across a
         transfer is the defect generation-commit.js exists to prevent. */
      const downloads = [];
      for (const descriptor of images) downloads.push({ ...(await Client.fetchOutput(cfg.baseUrl, descriptor)), descriptor });

      /* The result contract, validated before anything durable is written. This is what
         refuses a `local_native` result that has acquired a metered cost. */
      const result = contractResult({
        jobId,
        status: "completed",
        artifacts: downloads.map((row, index) => ({
          artifactId: `${jobId}-a${index + 1}`,
          kind: "image",
          role: "candidate",
          bytes: row.buffer.length,
        })),
        recipeId: job.comfy?.workflow?.relativePath || job.model,
        recipeVersion: job.comfy?.mapping?.mappingVersion,
        inputsUsed: (job.references || []).map((row) => ({ path: row.path })),
      });

      /* COMMIT PHASE — one indivisible turn, through the SHARED writer, against freshly
         read state. The shot is re-found inside the turn: a shot deleted while a render
         ran must not receive a candidate. */
      const outputs = await commitProject(owner, (P) => {
        const shot = (P.shots || []).find((row) => String(row.id) === String(job.shotId));
        if (!shot) throw new ComfyGenerationError("COMFY_SHOT_MISSING", "That shot no longer exists, so its result was not attached.", { shotId: job.shotId }, 409);
        const written = writeShotCandidates({
          ownerDir: owner.dir,
          project: P,
          shot,
          downloads,
          job,
          provider: COMFY_PROVIDER,
          fileStem: COMFY_FILE_STEM,
          packageLabel: "ComfyUI generation",
        });
        markShotAwaitingReview(shot);
        return written;
      });

      return commitJobLedger(owner, (jobs) => {
        const row = jobs.find((item) => item.id === jobId);
        if (!row) return job;
        row.status = ledgerStatus("COMPLETED");
        row.outputs = outputs;
        row.ingestedAt = nowIso();
        row.updatedAt = row.ingestedAt;
        row.result = result;
        row.comfy = {
          ...row.comfy,
          completedAt: row.ingestedAt,
          /* Which ComfyUI node produced which delivered file — the last link in the
             chain from a shot to a picture. */
          returnedOutputs: downloads.map((download, index) => ({
            nodeId: download.descriptor.nodeId,
            filename: download.descriptor.filename,
            subfolder: download.descriptor.subfolder,
            type: download.descriptor.type,
            bytes: download.buffer.length,
            deliveredAs: outputs[index]?.name || "",
          })),
        };
        return row;
      });
    });
  }

  app.post("/api/generation/comfy/jobs", async (req, res) => {
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      const { status, body } = failureOf(error);
      return res.status(status).json(body);
    }
    try {
      const job = await dispatch(owner, isRecord(req.body) ? req.body : {});
      res.json({ ok: true, job, costLabel: COMFY_COST_LABEL });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  app.post("/api/generation/comfy/jobs/:id/refresh", async (req, res) => {
    let owner;
    try {
      owner = captureOwner();
    } catch (error) {
      const { status, body } = failureOf(error);
      return res.status(status).json(body);
    }
    try {
      const job = await collect(owner, text(req.params.id));
      res.json({ ok: true, job, costLabel: COMFY_COST_LABEL });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* What the poller and the tests reach for. Deliberately narrow: an owner, its comfy
     jobs, and one collection. */
  return {
    COMFY_COST_LABEL,
    collect,
    connectionStatus,
    comfyJobs,
    dispatch,
    ownerForSlug,
  };
}

module.exports = {
  COMFY_COST_LABEL,
  COMFY_FILE_STEM,
  COMFY_MODEL_ID,
  COMFY_PROVIDER,
  ComfyGenerationError,
  contractJob,
  contractResult,
  localAccounting,
  registerComfyGeneration,
};

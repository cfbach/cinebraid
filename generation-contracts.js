/* Provider-neutral generation contracts.
 *
 * What a production wants generated, and what came back, expressed once so that a
 * hosted API, a Comfy graph on a LAN machine and a partner orchestrator can all be
 * described without any of them leaking into the shot.
 *
 * The single rule this module exists to enforce:
 *
 *     A GenerationJob says WHAT production result is wanted.
 *     It never says HOW a provider is wired.
 *
 * So production intent carries a stable modelId and a semantic reference role, and
 * never a provider URL, a provider endpoint string, a workflow node id, a graph
 * binding, or a credential. Those belong to an adapter, and an adapter is chosen
 * after the intent exists. A model is added by adding data, never by adding a
 * conditional on a model name.
 *
 * PHASE 1 SCOPE. Nothing here is wired into live generation. There is no runner, no
 * backend, no generic route, and no caller in the product: FAL continues to build and
 * submit its own request bodies exactly as before. This module is pure — no HTTP, no
 * filesystem, no routing, no ingestion, no browser state — so it can be validated and
 * tested long before anything dispatches through it.
 *
 * Fields are deliberately permissive about presence and strict about meaning. A field
 * a later phase will populate may be absent; a field that contradicts another field
 * is an error. That is what lets the contract roll out incrementally without a
 * migration, and existing FAL job records need none.
 */

const {
  CINEBRAID_GENERATION_MODES,
  CINEBRAID_REFERENCE_ROLES,
} = require("./public/shared-generation-capability");

const GENERATION_CONTRACT_VERSION = 1;

/* ---------------------------------------------------------------------------
   Vocabulary. Every list here is data that validators read; none of it is a switch
   on a provider or a model name. */

/* Which medium a mode produces. Derived once so a job cannot claim a video duration
   on a text-to-image request, and so nothing has to hard-code "t2v means video". */
const MODE_OUTPUT_TYPES = {
  t2i: "image", edit: "image", "multi-reference": "image", "style-reference": "image",
  moodboard: "image", blocking: "image", variation: "image", inpaint: "image",
  outpaint: "image", "control-guided": "image", upscale: "image", restore: "image",
  t2v: "video", i2v: "video", flf: "video", r2v: "video", "video-edit": "video",
  "audio-video": "video", retake: "video", v2v: "video",
};

const OUTPUT_TYPES = ["image", "video", "audio", "multi_artifact"];
const TARGET_KINDS = ["shot-frame", "shot-blocking", "shot-motion", "entity-reference", "entity-coverage"];
/* The legacy discriminator fal-generation.js already persists. Preserved verbatim so
   an existing job record stays readable. */
const LEGACY_PURPOSES = ["blocking", "frame", "correction", "entity-reference", "motion-h3"];
const REFERENCE_MEDIA_TYPES = ["image", "video", "audio"];
const REFERENCE_SOURCE_KINDS = ["media-asset", "project-asset", "candidate", "data-uri"];
const OUTPUT_AUDIO_MODES = ["none", "preferred", "required", "native"];
const SEED_MODES = ["explicit", "random", "derived"];
const ROUTING_INTENTS = ["draft", "fast", "standard", "quality", "specialist"];

const ROUTING_SELECTIONS = ["auto", "auto_local", "backend", "node"];
const ROUTING_POLICIES = ["local_only", "local_preferred", "selected_backend_only", "allow_paid_fallback"];

/* Two independent axes, deliberately not collapsed into one enum: a ComfyUI on the
   trusted LAN that submits through a partner node orchestrates locally and infers
   remotely, and a badge that cannot express that will eventually call a billed remote
   render "Local". */
const EXECUTION_LOCATIONS = ["same_host", "trusted_lan", "remote_private", "hosted_partner", "hosted_api", "remote_public"];
const EXECUTION_KINDS = ["local_native", "comfy_partner", "hosted_api"];
/* A third axis again: where work may run is not the same question as what CineBraid
   is willing to send there. 192.168.x.x is not 127.0.0.1. */
const TRUST_CLASSES = ["loopback", "lan_approved", "lan_unapproved", "remote_credentialed", "remote_public"];

const COST_CLASSES = ["free_local", "metered_partner", "metered_api", "metered_credits"];
const COST_UNITS = ["none", "usd", "buzz", "images", "videoSeconds"];
const COST_CONFIDENCES = ["quoted", "estimated", "unknown"];

const JOB_STATUSES = [
  "draft", "validating", "preparing_inputs", "submitting", "submitted", "queued",
  "running", "retrieving", "importing", "completed",
  "failed", "cancelled", "interrupted", "orphaned", "unresolved",
];
const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled", "interrupted", "orphaned"];
const RESULT_STATUSES = ["completed", "failed", "cancelled", "partial"];
const ARTIFACT_KINDS = ["image", "video", "audio", "metadata"];
const ARTIFACT_ROLES = ["candidate", "preview", "sidecar", "mask"];
const AUDIO_SOURCES = ["none", "native", "external", "replaced"];

const DATA_CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
/* Ordered least to most sensitive, so a derived asset can inherit the highest of its
   parents rather than whichever happened to be first. */
const DATA_CLASSIFICATION_RANK = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };

/* ---------------------------------------------------------------------------
   Small helpers. */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
function fail(errors, field, code, message) {
  errors.push({ field, code, message });
}
function checkEnum(errors, field, value, allowed, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) fail(errors, field, "missing", `${field} is required.`);
    return;
  }
  if (!allowed.includes(String(value)))
    fail(errors, field, "unsupported-value", `${field} must be one of: ${allowed.join(", ")}.`);
}

/* ---------------------------------------------------------------------------
   The intent boundary.

   These keys never belong in production intent. Two families:

     provider transport   a URL, an endpoint string, a route, a credential
     graph structure      a workflow node id, a class type, a binding

   A recipe knows that `identity` binds to ref_images.ref_image_0 here and image1
   there. The shot must not, or the shot becomes unportable the moment a second
   backend exists. `settings.extensions` is exempt by design: model-specific values
   live there namespaced by modelId, and core never reads inside.

   This is an explicit list of known transport and graph keys, NOT a name heuristic.
   A bare `token` is deliberately absent: `references[].token` is the prompt engine's
   own reference token (#image1) and has nothing to do with a credential. Deciding
   secrecy or provenance from whether a field name merely contains "token" is how a
   legitimate field gets refused and an unlisted one gets through. */
const FORBIDDEN_INTENT_KEYS = [
  "url", "baseurl", "endpoint", "falendpoint", "statusurl", "responseurl", "cancelurl",
  "route", "apikey", "authorization", "accesstoken", "refreshtoken", "bearer",
  "credential", "secret",
  "nodeid", "node_id", "classtype", "class_type", "bindings", "binding", "workflow",
  "workflowfile", "promptid", "prompt_id", "clientid", "client_id", "recipeid",
  "fal", "comfy", "civitai",
];
const INTENT_BLOCKS = ["target", "inputs", "output", "settings", "model"];
const URL_SHAPED = /^[a-z][a-z0-9+.-]*:\/\//i;

function scanIntent(node, errors, trail, { exempt = false } = {}) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanIntent(item, errors, `${trail}[${index}]`, { exempt }));
    return;
  }
  if (!isRecord(node)) {
    if (!exempt && typeof node === "string" && URL_SHAPED.test(node) && !node.startsWith("data:"))
      fail(errors, trail, "provider-url-in-intent",
        "Production intent must not contain a provider URL. An address belongs to a backend, not to a shot.");
    return;
  }
  for (const key of Object.keys(node)) {
    const lower = key.toLowerCase();
    const next = `${trail}.${key}`;
    /* settings.extensions is namespaced by modelId and is deliberately opaque. */
    const nextExempt = exempt || (trail === "settings" && key === "extensions");
    if (!nextExempt && FORBIDDEN_INTENT_KEYS.includes(lower))
      fail(errors, next, "provider-detail-in-intent",
        `Production intent must not contain "${key}". Provider transport and graph structure belong to a backend adapter.`);
    scanIntent(node[key], errors, next, { exempt: nextExempt });
  }
}

/* ---------------------------------------------------------------------------
   Reference source identity.

   assetId is canonical, contentHash proves the bytes, and a legacy project-relative
   path stays valid indefinitely — a job carrying only a path is not deprecated, it is
   simply not yet converged. Resolution order is fixed so two readers cannot disagree
   about which field wins. */
function resolveReferenceSource(source) {
  if (!isRecord(source)) return { ok: false, by: null, value: null };
  if (isNonEmptyString(source.assetId)) return { ok: true, by: "assetId", value: source.assetId.trim() };
  if (isNonEmptyString(source.contentHash)) return { ok: true, by: "contentHash", value: source.contentHash.trim() };
  if (isNonEmptyString(source.path)) return { ok: true, by: "path", value: source.path.trim() };
  if (isNonEmptyString(source.dataUri)) return { ok: true, by: "dataUri", value: source.dataUri.trim() };
  return { ok: false, by: null, value: null };
}

/* ---------------------------------------------------------------------------
   GenerationJob. */
/* `options.modes` / `options.referenceRoles` replace the shipped vocabulary.

   The shipped lists are a DEFAULT, not an enum welded into the validator: a phase that
   introduces a mode supplies it and no branch in here changes. That is the property
   that matters — what must never exist is a switch on a model, family or vendor name
   deciding what a model can do, because that is what turns adding a model into an
   application-wide edit. Once a mode registry file exists, it becomes the source of
   this default and the signature does not move. */
function validateGenerationJob(job, options = {}) {
  const errors = [];
  const warnings = [];
  const modes = options.modes || CINEBRAID_GENERATION_MODES;
  const roles = options.referenceRoles || CINEBRAID_REFERENCE_ROLES;

  if (!isRecord(job)) {
    fail(errors, "job", "missing", "A generation job must be an object.");
    return { ok: false, errors, warnings };
  }

  if (!isNonEmptyString(job.jobId)) fail(errors, "jobId", "missing", "jobId is required.");

  /* --- target --- */
  const target = isRecord(job.target) ? job.target : null;
  if (!target) fail(errors, "target", "missing", "target is required.");
  else {
    checkEnum(errors, "target.kind", target.kind, TARGET_KINDS, { required: true });
    if (target.purpose != null && target.purpose !== "")
      checkEnum(errors, "target.purpose", target.purpose, LEGACY_PURPOSES);
    const shotScoped = ["shot-frame", "shot-blocking", "shot-motion"].includes(String(target.kind));
    const entityScoped = ["entity-reference", "entity-coverage"].includes(String(target.kind));
    if (shotScoped && !isNonEmptyString(target.shotId))
      fail(errors, "target.shotId", "missing", "A shot-scoped job must name its shot.");
    if (entityScoped && !isNonEmptyString(target.entityId))
      fail(errors, "target.entityId", "missing", "An entity-scoped job must name its entity.");
    if (entityScoped && !isNonEmptyString(target.entityList))
      fail(errors, "target.entityList", "missing", "An entity-scoped job must name its entity list.");
  }

  /* --- mode and outputType --- */
  checkEnum(errors, "mode", job.mode, modes, { required: true });
  checkEnum(errors, "outputType", job.outputType, OUTPUT_TYPES, { required: true });
  const expected = MODE_OUTPUT_TYPES[String(job.mode)];
  if (expected && isNonEmptyString(job.outputType)
    && job.outputType !== expected && job.outputType !== "multi_artifact")
    fail(errors, "outputType", "contradiction",
      `Mode ${job.mode} produces ${expected}; outputType says ${job.outputType}.`);

  /* --- model --- */
  const model = isRecord(job.model) ? job.model : null;
  if (!model) fail(errors, "model", "missing", "model is required.");
  else {
    if (!isNonEmptyString(model.modelId))
      fail(errors, "model.modelId", "missing", "model.modelId is the authoritative identity and is required.");
    if (isNonEmptyString(model.displayName))
      /* A display name is a label. The moment anything selects on it, renaming a
         model in the registry changes behaviour. */
      fail(errors, "model.displayName", "display-name-in-intent",
        "A display name must not appear in production intent; modelId is identity.");
  }

  /* --- inputs and references --- */
  const inputs = isRecord(job.inputs) ? job.inputs : null;
  if (!inputs) fail(errors, "inputs", "missing", "inputs is required.");
  else {
    if (typeof inputs.prompt !== "string")
      fail(errors, "inputs.prompt", "missing", "inputs.prompt must be a string (it may be empty).");
    const references = Array.isArray(inputs.references) ? inputs.references : [];
    if (inputs.references != null && !Array.isArray(inputs.references))
      fail(errors, "inputs.references", "invalid-type", "inputs.references must be an array.");
    const seenRefIds = new Set();
    references.forEach((reference, index) => {
      const at = `inputs.references[${index}]`;
      if (!isRecord(reference)) {
        fail(errors, at, "invalid-type", "A reference must be an object.");
        return;
      }
      if (!isNonEmptyString(reference.refId)) fail(errors, `${at}.refId`, "missing", "refId is required.");
      else if (seenRefIds.has(reference.refId)) fail(errors, `${at}.refId`, "duplicate", "refId must be unique within a job.");
      else seenRefIds.add(reference.refId);
      checkEnum(errors, `${at}.role`, reference.role, roles, { required: true });
      checkEnum(errors, `${at}.mediaType`, reference.mediaType, REFERENCE_MEDIA_TYPES, { required: true });
      const source = isRecord(reference.source) ? reference.source : null;
      if (!source) fail(errors, `${at}.source`, "missing", "A reference must name a source.");
      else {
        checkEnum(errors, `${at}.source.kind`, source.kind, REFERENCE_SOURCE_KINDS, { required: true });
        const resolved = resolveReferenceSource(source);
        if (!resolved.ok)
          fail(errors, `${at}.source`, "unresolvable",
            "A reference source needs an assetId, a contentHash, or a project-relative path.");
      }
      /* A temporal contract is an image contract. */
      if (["first-frame", "last-frame"].includes(String(reference.role)) && reference.mediaType !== "image")
        fail(errors, `${at}.mediaType`, "contradiction", `A ${reference.role} reference must be an image.`);
      if (String(reference.role) === "voice" && reference.mediaType !== "audio")
        fail(errors, `${at}.mediaType`, "contradiction", "A voice reference must be audio.");
    });
  }

  /* --- output --- */
  const output = isRecord(job.output) ? job.output : {};
  checkEnum(errors, "output.audio", output.audio, OUTPUT_AUDIO_MODES);
  if (output.candidateCount != null) {
    const count = Number(output.candidateCount);
    if (!Number.isInteger(count) || count < 1)
      fail(errors, "output.candidateCount", "out-of-range", "candidateCount must be a positive integer.");
  }
  const producesVideo = job.outputType === "video" || expected === "video";
  if (!producesVideo) {
    for (const field of ["durationSeconds", "fps"])
      if (output[field] != null)
        fail(errors, `output.${field}`, "contradiction", `${field} is meaningless for a ${job.outputType} result.`);
    if (["native", "required"].includes(String(output.audio)))
      fail(errors, "output.audio", "contradiction", `A ${job.outputType} result cannot carry ${output.audio} audio.`);
  }
  if (output.durationSeconds != null && !(Number(output.durationSeconds) > 0))
    fail(errors, "output.durationSeconds", "out-of-range", "durationSeconds must be greater than zero.");

  /* --- settings --- */
  const settings = isRecord(job.settings) ? job.settings : {};
  checkEnum(errors, "settings.seedMode", settings.seedMode, SEED_MODES);
  checkEnum(errors, "settings.routingIntent", settings.routingIntent, ROUTING_INTENTS);
  if (String(settings.seedMode) === "explicit" && !Number.isFinite(Number(settings.seed)))
    fail(errors, "settings.seed", "contradiction", "seedMode explicit requires a seed.");
  if (String(settings.seedMode) === "random" && settings.seed != null)
    fail(errors, "settings.seed", "contradiction", "seedMode random must not carry a seed.");
  if (settings.adapters != null && !Array.isArray(settings.adapters))
    fail(errors, "settings.adapters", "invalid-type", "settings.adapters must be an array.");
  if (settings.extensions != null && !isRecord(settings.extensions))
    fail(errors, "settings.extensions", "invalid-type", "settings.extensions must be an object keyed by modelId.");

  /* --- routing --- */
  const routing = isRecord(job.routing) ? job.routing : {};
  checkEnum(errors, "routing.selection", routing.selection, ROUTING_SELECTIONS);
  checkEnum(errors, "routing.policy", routing.policy, ROUTING_POLICIES);
  if (String(routing.selection) === "node" && !isNonEmptyString(routing.nodeId))
    fail(errors, "routing.nodeId", "missing", "selection node requires a nodeId.");
  if (String(routing.selection) === "backend" && !isNonEmptyString(routing.backendId))
    fail(errors, "routing.backendId", "missing", "selection backend requires a backendId.");
  if (isRecord(routing.resolved)) {
    checkEnum(errors, "routing.resolved.executionKind", routing.resolved.executionKind, EXECUTION_KINDS);
    checkEnum(errors, "routing.resolved.orchestratorLocation", routing.resolved.orchestratorLocation, EXECUTION_LOCATIONS);
    checkEnum(errors, "routing.resolved.inferenceLocation", routing.resolved.inferenceLocation, EXECUTION_LOCATIONS);
    checkEnum(errors, "routing.resolved.costClass", routing.resolved.costClass, COST_CLASSES);
  }

  /* --- governance --- */
  const governance = isRecord(job.governance) ? job.governance : {};
  checkEnum(errors, "governance.dataClassification", governance.dataClassification, DATA_CLASSIFICATIONS);
  if (governance.requiredAssurances != null && !Array.isArray(governance.requiredAssurances))
    fail(errors, "governance.requiredAssurances", "invalid-type", "requiredAssurances must be an array.");

  /* --- accounting --- */
  const accounting = isRecord(job.accounting) ? job.accounting : {};
  checkEnum(errors, "accounting.costClass", accounting.costClass, COST_CLASSES);
  if (accounting.estimate != null) {
    const estimate = validateCostEstimate(accounting.estimate);
    for (const error of estimate.errors) fail(errors, `accounting.estimate.${error.field}`, error.code, error.message);
  }
  if (String(accounting.costClass) === "free_local" && isNonEmptyString(routing.accountConnectionId))
    warnings.push({
      field: "routing.accountConnectionId",
      code: "account-on-free-job",
      message: "A free local render does not need an account connection.",
    });

  /* --- status --- */
  checkEnum(errors, "status", job.status, JOB_STATUSES);

  /* --- the intent boundary --- */
  for (const block of INTENT_BLOCKS)
    if (job[block] != null) scanIntent(job[block], errors, block);

  return { ok: errors.length === 0, errors, warnings };
}

/* ---------------------------------------------------------------------------
   GenerationResult. */
function validateGenerationResult(result) {
  const errors = [];
  const warnings = [];
  if (!isRecord(result)) {
    fail(errors, "result", "missing", "A generation result must be an object.");
    return { ok: false, errors, warnings };
  }

  if (!isNonEmptyString(result.jobId)) fail(errors, "jobId", "missing", "jobId is required.");
  if (result.attempt != null && !(Number.isInteger(result.attempt) && result.attempt >= 1))
    fail(errors, "attempt", "out-of-range", "attempt must be a positive integer.");
  checkEnum(errors, "status", result.status, RESULT_STATUSES, { required: true });

  const backend = isRecord(result.backend) ? result.backend : null;
  if (!backend) fail(errors, "backend", "missing", "backend identity is required.");
  else {
    if (!isNonEmptyString(backend.backendId)) fail(errors, "backend.backendId", "missing", "backendId is required.");
    checkEnum(errors, "backend.executionKind", backend.executionKind, EXECUTION_KINDS, { required: true });
    checkEnum(errors, "backend.orchestratorLocation", backend.orchestratorLocation, EXECUTION_LOCATIONS, { required: true });
    checkEnum(errors, "backend.inferenceLocation", backend.inferenceLocation, EXECUTION_LOCATIONS, { required: true });
    checkEnum(errors, "backend.costClass", backend.costClass, COST_CLASSES, { required: true });
    /* Derived, and the derivation is the whole reason the two locations are separate
       fields: a graph that runs on the LAN but infers at a partner is not local, and
       must never be badged as though it were. */
    const local = backend.orchestratorLocation === backend.inferenceLocation
      && ["same_host", "trusted_lan", "remote_private"].includes(String(backend.orchestratorLocation));
    if (backend.executionKind === "local_native" && !local)
      fail(errors, "backend.executionKind", "contradiction",
        "local_native requires inference to run where the graph runs, on an operator-controlled machine.");
    if (backend.executionKind === "local_native" && backend.costClass !== "free_local")
      fail(errors, "backend.costClass", "contradiction", "A local_native render is not metered.");
    if (backend.executionKind === "comfy_partner" && backend.inferenceLocation !== "hosted_partner")
      fail(errors, "backend.inferenceLocation", "contradiction", "comfy_partner infers at a partner.");
  }

  const model = isRecord(result.model) ? result.model : null;
  if (!model) fail(errors, "model", "missing", "model identity is required.");
  else if (!isNonEmptyString(model.modelId)) fail(errors, "model.modelId", "missing", "model.modelId is required.");

  if (result.recipe != null) {
    if (!isRecord(result.recipe)) fail(errors, "recipe", "invalid-type", "recipe must be an object when present.");
    else {
      if (!isNonEmptyString(result.recipe.recipeId)) fail(errors, "recipe.recipeId", "missing", "recipeId is required when a recipe is recorded.");
      if (result.recipe.version != null && !Number.isInteger(result.recipe.version))
        fail(errors, "recipe.version", "invalid-type", "recipe.version must be an integer.");
    }
  }

  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : null;
  if (!artifacts) fail(errors, "artifacts", "missing", "artifacts must be an array.");
  else {
    if (result.status === "completed" && artifacts.length === 0)
      fail(errors, "artifacts", "contradiction", "A completed result must carry at least one artifact.");
    const seen = new Set();
    artifacts.forEach((artifact, index) => {
      const at = `artifacts[${index}]`;
      if (!isRecord(artifact)) {
        fail(errors, at, "invalid-type", "An artifact must be an object.");
        return;
      }
      if (!isNonEmptyString(artifact.artifactId)) fail(errors, `${at}.artifactId`, "missing", "artifactId is required.");
      else if (seen.has(artifact.artifactId)) fail(errors, `${at}.artifactId`, "duplicate", "artifactId must be unique within a result.");
      else seen.add(artifact.artifactId);
      checkEnum(errors, `${at}.kind`, artifact.kind, ARTIFACT_KINDS, { required: true });
      checkEnum(errors, `${at}.role`, artifact.role, ARTIFACT_ROLES);
      if (artifact.bytes != null && !(Number.isInteger(artifact.bytes) && artifact.bytes >= 0))
        fail(errors, `${at}.bytes`, "out-of-range", "bytes must be a non-negative integer.");
      if (artifact.contentHash != null && !isNonEmptyString(artifact.contentHash))
        fail(errors, `${at}.contentHash`, "invalid-type", "contentHash must be a string when present.");
      /* assetId is absent for the whole of Phase 1 — nothing mints one yet — so its
         absence is normal and only its shape is checked. */
      if (artifact.assetId != null && !isNonEmptyString(artifact.assetId))
        fail(errors, `${at}.assetId`, "invalid-type", "assetId must be a string when present.");
      if (artifact.hasNativeAudio === true && artifact.kind !== "video")
        fail(errors, `${at}.hasNativeAudio`, "contradiction", "Only a video artifact can carry native audio.");
      if (artifact.audioSource != null) checkEnum(errors, `${at}.audioSource`, artifact.audioSource, AUDIO_SOURCES);
      if (artifact.kind === "image" && (artifact.durationSeconds != null || artifact.fps != null))
        fail(errors, `${at}.durationSeconds`, "contradiction", "An image artifact has no duration.");
    });
  }

  if (result.inputsUsed != null && !Array.isArray(result.inputsUsed))
    fail(errors, "inputsUsed", "invalid-type", "inputsUsed must be an array.");
  else if (Array.isArray(result.inputsUsed))
    result.inputsUsed.forEach((used, index) => {
      if (!isRecord(used)) {
        fail(errors, `inputsUsed[${index}]`, "invalid-type", "An input record must be an object.");
        return;
      }
      if (!resolveReferenceSource(used).ok)
        fail(errors, `inputsUsed[${index}]`, "unresolvable",
          "A recorded input needs an assetId, a contentHash, or a path.");
    });

  for (const field of ["warnings", "errors"])
    if (result[field] != null && !Array.isArray(result[field]))
      fail(errors, field, "invalid-type", `${field} must be an array.`);

  return { ok: errors.length === 0, errors, warnings };
}

/* ---------------------------------------------------------------------------
   CostEstimate.

   Generic on purpose: no provider pricing lives here, and Phase 1 calls nobody. The
   load-bearing field is `confidence` — `quoted` means the provider priced THIS job,
   `estimated` means CineBraid computed it locally, and `unknown` means neither.
   A metered job whose cost is unknown must be confirmed however small the number
   looks; that rule is recorded by requiresExplicitAuthorization() and is NOT enforced
   anywhere in Phase 1, because nothing dispatches yet. */
function validateCostEstimate(estimate) {
  const errors = [];
  const warnings = [];
  if (!isRecord(estimate)) {
    fail(errors, "estimate", "missing", "A cost estimate must be an object.");
    return { ok: false, errors, warnings };
  }
  checkEnum(errors, "costClass", estimate.costClass, COST_CLASSES, { required: true });
  checkEnum(errors, "unit", estimate.unit, COST_UNITS, { required: true });
  checkEnum(errors, "confidence", estimate.confidence, COST_CONFIDENCES, { required: true });

  const metered = estimate.costClass !== "free_local";
  if (!metered) {
    if (estimate.unit !== "none")
      fail(errors, "unit", "contradiction", "A free local render is measured in nothing.");
    if (Number(estimate.amount || 0) !== 0)
      fail(errors, "amount", "contradiction", "A free local render costs nothing.");
  } else {
    if (estimate.amount != null && !(Number.isFinite(Number(estimate.amount)) && Number(estimate.amount) >= 0))
      fail(errors, "amount", "out-of-range", "amount must be a non-negative number.");
    if (estimate.confidence !== "unknown" && estimate.amount == null)
      fail(errors, "amount", "missing", "A quoted or estimated cost must carry an amount.");
    if (estimate.confidence === "unknown" && estimate.amount != null)
      fail(errors, "amount", "contradiction", "An unknown cost must not carry an amount.");
  }

  if (estimate.confidence === "quoted" && !isNonEmptyString(estimate.quotedAt))
    fail(errors, "quotedAt", "missing", "A quoted cost must record when it was quoted.");
  if (estimate.breakdown != null) {
    if (!Array.isArray(estimate.breakdown)) fail(errors, "breakdown", "invalid-type", "breakdown must be an array.");
    else estimate.breakdown.forEach((line, index) => {
      if (!isRecord(line) || !isNonEmptyString(line.label) || !Number.isFinite(Number(line.amount)))
        fail(errors, `breakdown[${index}]`, "invalid-type", "A breakdown line needs a label and an amount.");
    });
  }
  if (estimate.balanceAfter != null && !Number.isFinite(Number(estimate.balanceAfter)))
    fail(errors, "balanceAfter", "invalid-type", "balanceAfter must be a number or null.");

  return { ok: errors.length === 0, errors, warnings };
}

/* Recorded now so the rule cannot drift before the phase that enforces it. */
function requiresExplicitAuthorization(estimate) {
  if (!isRecord(estimate)) return true;
  if (estimate.costClass === "free_local") return false;
  return estimate.confidence === "unknown" || Number(estimate.amount || 0) > 0;
}

/* ---------------------------------------------------------------------------
   Governance seam.

   Studio and Enterprise are NOT implemented. What exists here is the shape their
   implementation will replace, so that adding one later needs no contract change.

   The invariant worth stating out loud, because it is the one that is easy to get
   backwards: a free local render is subject to exactly the same model, licence,
   origin and recipe checks as a paid one. Running a prohibited model on your own GPU
   does not make it approved. That is why this resolves on the whole tuple and why it
   is evaluated BEFORE a target is chosen — cost is not the question being asked.

   Community's answer is permissive: the only thing that denies is a project that has
   explicitly switched AI off. Phase 1 has ZERO runtime call sites. */
function highestClassification(values) {
  let best = "PUBLIC";
  for (const value of values || []) {
    const rank = DATA_CLASSIFICATION_RANK[String(value)];
    if (rank != null && rank > DATA_CLASSIFICATION_RANK[best]) best = String(value);
  }
  return best;
}

function resolveGovernance(job, context = {}) {
  const reasons = [];
  const classification = isNonEmptyString(context.classification)
    ? String(context.classification)
    : (isRecord(job) && isRecord(job.governance) && isNonEmptyString(job.governance.dataClassification)
      ? String(job.governance.dataClassification)
      : "INTERNAL");

  if (!DATA_CLASSIFICATIONS.includes(classification))
    reasons.push({
      code: "UNKNOWN_CLASSIFICATION",
      message: `Unknown data classification "${classification}".`,
      action: "Set a supported classification on the project.",
    });

  /* The single Community restriction, and it is an existing product rule rather than
     a new one: a project whose AI policy is "disabled" generates nothing. */
  if (String(context.aiPolicy) === "disabled")
    reasons.push({
      code: "PROJECT_AI_DISABLED",
      message: "AI features are disabled for this project.",
      action: "Change the project's AI policy to generate.",
    });

  return {
    allowed: reasons.length === 0,
    policyId: "community-permissive-v1",
    classification,
    reasons,
  };
}

module.exports = {
  GENERATION_CONTRACT_VERSION,
  MODE_OUTPUT_TYPES,
  OUTPUT_TYPES,
  TARGET_KINDS,
  LEGACY_PURPOSES,
  REFERENCE_MEDIA_TYPES,
  REFERENCE_SOURCE_KINDS,
  OUTPUT_AUDIO_MODES,
  SEED_MODES,
  ROUTING_INTENTS,
  ROUTING_SELECTIONS,
  ROUTING_POLICIES,
  EXECUTION_LOCATIONS,
  EXECUTION_KINDS,
  TRUST_CLASSES,
  COST_CLASSES,
  COST_UNITS,
  COST_CONFIDENCES,
  JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  RESULT_STATUSES,
  ARTIFACT_KINDS,
  ARTIFACT_ROLES,
  AUDIO_SOURCES,
  DATA_CLASSIFICATIONS,
  DATA_CLASSIFICATION_RANK,
  FORBIDDEN_INTENT_KEYS,
  highestClassification,
  requiresExplicitAuthorization,
  resolveGovernance,
  resolveReferenceSource,
  validateCostEstimate,
  validateGenerationJob,
  validateGenerationResult,
};

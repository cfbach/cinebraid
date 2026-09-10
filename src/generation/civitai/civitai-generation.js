/* Civitai generation: quote, authorize, dispatch, recover, deliver.
 *
 * The route layer between a CineBraid frame and civitai-client.js. Everything durable it
 * writes — the job ledger row, the candidate row, the project document — goes through the
 * same shared writers fal-generation.js and comfy-generation.js use, so there is one
 * generation ledger, one project-commit chain and one returned-candidate writer in the
 * product, not three.
 *
 * ------------------------------------------------------------------------------
 * WHY THIS IS NOT ROUTED THROUGH dispatchGenerationRequest()
 *
 * ComfyUI is mounted beside that function because a free local render must never touch
 * the paid boundary. Civitai is the opposite case and arrives at the same answer for a
 * narrower reason: the first two lines of that dispatcher are `if (!cfg.enabled)` and
 * `if (!cfg.apiKey)` against FAL'S configuration. Threading Civitai through it would mean
 * loosening the two enablement gates that guard every fal dispatch, on behalf of a caller
 * that must never reach fal.
 *
 * What it DOES reuse is the guarantee rather than the function: paid-dispatch-permit.js is
 * a separate, provider-neutral module that imports nothing from fal, and the single-use
 * property comes from a ledger row naming the permit inside a commit turn — which is the
 * same mechanism, not a copy of it.
 *
 * ------------------------------------------------------------------------------
 * THE PAID TRANSACTION, which is the whole point of this file.
 *
 *   1  ESTIMATE   rebuild the canonical body, ask Civitai `?whatif=true`. Free. Nothing
 *                 durable is written and no permit exists yet.
 *   2  a person reads the Buzz figure and presses Generate.
 *   3  AUTHORIZE  rebuild the body from the same inputs, recompute its fingerprint,
 *                 refuse unless it matches the one the quote was issued for, and mint a
 *                 permit whose scope CARRIES that fingerprint. Free, no provider call.
 *   4  DISPATCH   rebuild a third time, recompute, and refuse unless the permit's scope
 *                 fingerprint matches. Re-quote — free — so the number written onto the
 *                 durable row is one the SERVER obtained rather than one the browser
 *                 claimed, and refuse if that fresh quote is higher than the figure the
 *                 person approved. Write the row, redeem the permit inside the ledger's
 *                 own commit turn, then submit.
 *
 * A quote for request A therefore cannot authorize the submission of request B: the body
 * is built by this server three times from the same inputs, and any difference in prompt,
 * resource, size or step count changes the digest and refuses at step 3 or step 4.
 *
 * ------------------------------------------------------------------------------
 * WHERE THE CREDENTIAL COMES FROM, and what it is allowed to be.
 *
 * account-provider-civitai.js's `bearerFor` returns a bearer from either an OAuth access
 * token or a personal API key, and this file cannot tell which. That is deliberate:
 * Civitai's orchestration documentation names "a Civitai API token" and explicitly defers
 * token scopes to a later revision, so whether an OAuth bearer is accepted there is not
 * settled by anything published. OAuth is the preferred path and is what the connection
 * flow offers; the API key is the bounded fallback. Resolving that question is a step in
 * the real-proof plan, not a shape this code has to guess at.
 *
 * NOTHING IN THIS MODULE CAN SPEND WITHOUT A PERMIT. There is exactly one call to
 * Client.submitWorkflow, it is inside dispatch(), and every line above it is a refusal
 * that has not fired.
 */

const crypto = require("crypto");

const Client = require("./civitai-client");
const Workflow = require("./civitai-workflow");
const Contracts = require("../generation-contracts");
const Lifecycle = require("../generation-lifecycle");
const PaidPermit = require("../paid-dispatch-permit");
const CivitaiProvider = require("../../accounts/account-provider-civitai");
const { readJobLedger, JobLedgerUnreadableError } = require("../generation-job-store");
const { commitJobLedger, commitProjectDocument, serializeJobOperation } = require("../generation-commit");
const { markShotAwaitingReview, writeShotCandidates } = require("../generation-candidate-ingest");
const { findConnection } = require("../../accounts/account-connections");
const { isLoopbackRequest } = require("../../server/loopback-request");

/* CineBraid's word for what produced a candidate. Rendered verbatim by the media
   inspector's Provider row, so it is the product's real name rather than a slug. */
const CIVITAI_PROVIDER = "Civitai";
/* The filename stem a delivered result carries, beside fal's "FAL" and ComfyUI's "COMFY". */
const CIVITAI_FILE_STEM = "CIVITAI";
/* The surface constant the paid permit's scope records.
 *
 * fal's permit route reads a declaration off the request because two different fal
 * dialogs can build the same body and the permit has to tell them apart. Civitai has
 * exactly one paid surface in V1, so the value is a server-side constant: there is nothing
 * for a caller to declare and therefore nothing for a caller to misdeclare. */
const CIVITAI_SURFACE = "civitai-frame";
/* One image per paid request in V1, matching the ComfyUI foothold. Two images is a
   different purchase and would have to travel through the permit's outputCount as well as
   through the request body; one is the smallest thing that proves the loop. */
const CIVITAI_OUTPUT_COUNT = 1;

/* Buzz is Buzz. The contract's vocabulary already carries both of these — COST_CLASSES
   has `metered_credits` and COST_UNITS has `buzz` — so nothing here invents a word. */
const CIVITAI_COST_CLASS = "metered_credits";
const CIVITAI_COST_UNIT = "buzz";

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

class CivitaiGenerationError extends Error {
  constructor(code, message, detail = {}, status = 400) {
    super(message);
    this.name = "CivitaiGenerationError";
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
      error: text(error?.message) || "Civitai generation failed.",
      code: text(error?.code) || "CIVITAI_FAILED",
      detail: isRecord(error?.detail) ? error.detail : {},
      /* Every refusal on a paid route says whether money could possibly have moved.
         Callers of the fal boundary already read these two names. */
      providerContacted: error?.providerContacted === true,
      paidRequestSubmitted: error?.paidRequestSubmitted === true,
    },
  };
}

/* ---------------------------------------------------------------------------
   The status vocabulary is CineBraid's, and it is USED rather than merely cited. */
function ledgerStatus(name) {
  if (!Lifecycle.LEDGER_STATUSES.includes(name))
    throw new CivitaiGenerationError("CIVITAI_STATUS_UNKNOWN", `CineBraid has no generation status called ${name}.`, {}, 500);
  return name;
}

/* CIVITAI STATE → CINEBRAID STATE, and the two mappings that must not be collapsed.
 *
 *   unassigned / pending  IN_QUEUE      accepted, not started
 *   processing            IN_PROGRESS   running
 *   succeeded             IN_PROGRESS   REMOTELY done, LOCALLY undelivered. CineBraid does
 *                                       not say COMPLETED until bytes are on disk — a
 *                                       delivery that has not happened is not a delivery,
 *                                       and the collector is what promotes it.
 *   failed / canceled     FAILED        the provider answered and it is over
 *   expired               UNRESOLVED    the RESULT expired, which says nothing about
 *                                       whether the work ran or was charged for. Calling
 *                                       it FAILED would invite the one action that spends
 *                                       twice, which is the asymmetry generation-lifecycle
 *                                       exists to hold.
 *
 * An unrecognised status is UNRESOLVED rather than a guess. A word this product does not
 * know is not evidence that nothing happened. */
function ledgerStatusForWorkflow(status) {
  switch (text(status)) {
    case "unassigned":
    case "pending":
      return ledgerStatus("IN_QUEUE");
    case "processing":
    case "succeeded":
      return ledgerStatus("IN_PROGRESS");
    case "failed":
    case "canceled":
      return ledgerStatus("FAILED");
    default:
      return ledgerStatus(Lifecycle.UNRESOLVED);
  }
}

/* ---------------------------------------------------------------------------
   Configuration. */
function civitaiConfig(readConfig) {
  const cfg = (readConfig() || {}).generation || {};
  const row = isRecord(cfg.civitai) ? cfg.civitai : {};
  return {
    enabled: row.enabled === true,
    connectionId: text(row.connectionId),
    resourceAir: text(row.resourceAir),
  };
}

/* ---------------------------------------------------------------------------
   The provider-neutral job, built and VALIDATED.
 *
 * The contract is not decoration here. It refuses a `metered_credits` estimate that
 * contradicts itself, requires `quotedAt` beside a quoted amount, and — through
 * FORBIDDEN_INTENT_KEYS, which already bans the literal string "civitai" — refuses a job
 * whose production intent has learned an AIR, a workflow id, an endpoint or a credential.
 * Those are exactly the leaks this integration could produce, and the validator that
 * catches them already shipped. */
function contractJob({ jobId, shotId, frameId, prompt, negativePrompt, connectionId, quote, status }) {
  const job = {
    jobId,
    target: { kind: "shot-frame", shotId, frameId: frameId || "", purpose: "frame" },
    mode: "t2i",
    outputType: "image",
    /* modelId only, and it is CineBraid's identity for the route rather than the AIR.
       The AIR is how Civitai names weights; it belongs to routing and provenance, and the
       contract would refuse it inside `model` in any case. */
    model: { modelId: "civitai/orchestrator-image" },
    inputs: { prompt: String(prompt || ""), references: [] },
    output: { candidateCount: CIVITAI_OUTPUT_COUNT },
    settings: {
      seedMode: "random",
      routingIntent: "standard",
      negativePrompt: String(negativePrompt || ""),
    },
    /* Routing is deliberately OUTSIDE the intent blocks the contract scans. Which account
       pays, which backend runs it and which resource it names are how this job is WIRED;
       the shot must never carry any of them. */
    routing: {
      selection: "backend",
      policy: "selected_backend_only",
      backendId: Client.CIVITAI_BACKEND_ID,
      accountConnectionId: connectionId,
      resolved: {
        executionKind: "hosted_api",
        orchestratorLocation: "hosted_api",
        inferenceLocation: "hosted_api",
        costClass: CIVITAI_COST_CLASS,
      },
    },
    governance: { dataClassification: "INTERNAL", requiredAssurances: [] },
    accounting: civitaiAccounting(quote),
    status,
  };
  const validated = Contracts.validateGenerationJob(job);
  if (!validated.ok)
    throw new CivitaiGenerationError(
      "CIVITAI_JOB_CONTRACT",
      `CineBraid built a generation request it will not send: ${validated.errors[0].message}`,
      { errors: validated.errors },
      500,
    );
  return job;
}

/* THE FIRST QUOTED COST CINEBRAID HAS EVER RECORDED.
 *
 * generation-cost.js reserved `confidence: "quoted"` for "the day a provider does quote"
 * and said fal never would. Civitai does: `?whatif=true` prices this exact body and
 * returns a Buzz figure for it. So this is `quoted`, with `quotedAt` — which
 * validateCostEstimate already requires beside that word — and it is NOT built by
 * costEstimateFromRate, because there is no configured rate involved and no arithmetic
 * CineBraid performed. The number is Civitai's. */
function civitaiAccounting(quote) {
  const at = text(quote?.quotedAt) || nowIso();
  return {
    costClass: CIVITAI_COST_CLASS,
    estimate: {
      costClass: CIVITAI_COST_CLASS,
      unit: CIVITAI_COST_UNIT,
      amount: Number(quote?.amount),
      confidence: "quoted",
      quotedAt: at,
    },
    recordedAt: at,
    basis: {
      kind: "provider-quote",
      why: "Civitai priced this exact request before it was submitted. It is the provider's own figure, not a CineBraid estimate from a configured rate.",
    },
  };
}

function contractResult({ jobId, status, artifacts, errors }) {
  const result = {
    jobId,
    status,
    backend: {
      backendId: Client.CIVITAI_BACKEND_ID,
      executionKind: "hosted_api",
      orchestratorLocation: "hosted_api",
      inferenceLocation: "hosted_api",
      costClass: CIVITAI_COST_CLASS,
    },
    model: { modelId: "civitai/orchestrator-image" },
    artifacts,
    inputsUsed: [],
    errors: errors || [],
  };
  const validated = Contracts.validateGenerationResult(result);
  if (!validated.ok)
    throw new CivitaiGenerationError(
      "CIVITAI_RESULT_CONTRACT",
      `CineBraid will not record a result it cannot describe: ${validated.errors[0].message}`,
      { errors: validated.errors },
      500,
    );
  return result;
}

/* ---------------------------------------------------------------------------
   Registration. */
function registerCivitaiGeneration(app, context) {
  const { readConfig, writeConfig, readProject, writeProject, activeSlug, projectDirForSlug } = context;

  function ownerForSlug(slug) {
    const { dir, file } = projectDirForSlug(slug);
    return { slug, dir, file };
  }
  /* Captured ONCE, before the first await, exactly as fal-generation.js and
     comfy-generation.js capture it and for the same reason: a generation is a long chain
     of awaits and the user is free to switch projects during it. */
  function captureOwner() {
    const slug = activeSlug();
    if (!slug) throw new CivitaiGenerationError("CIVITAI_NO_PROJECT", "No project is open.", {}, 404);
    return ownerForSlug(slug);
  }
  function commitProject(owner, mutate) {
    return commitProjectDocument(owner, mutate, {
      readProject: (row) => readProject(row.slug),
      writeProject: (row, project) => writeProject(project, row.slug),
    });
  }
  function civitaiJobs(owner) {
    return readJobLedger(owner.dir).jobs.filter((row) => text(row?.backendId) === Client.CIVITAI_BACKEND_ID);
  }

  /* EVERY ROUTE IN THIS FILE ANSWERS ONLY THIS MACHINE.
   *
   * CineBraid may be started with --lan so a phone or a second workstation can reach the
   * workspace. The ComfyUI slice learned that a LAN caller must not be able to steer a
   * host request; here the stake is higher by one whole category, because what a LAN
   * caller could otherwise steer is the operator's own money. So the guard is on every
   * route without exception — including the read-only ones, because a job row carries the
   * workflow identity and the quoted cost of a paid request and a tablet has no reason to
   * hold either. */
  function requireLocalMachine(req, res) {
    if (isLoopbackRequest(req)) return true;
    res.status(403).json({
      error: "Civitai generation is set up and run on the computer running CineBraid.",
      code: "LOOPBACK_REQUIRED",
      providerContacted: false,
      paidRequestSubmitted: false,
    });
    return false;
  }

  /* ---- the credential, and the four ways there isn't one -------------------
   *
   * Resolved BEFORE a permit is minted and before anything is quoted, and a refresh
   * happens HERE or not at all: a token refresh inside a dispatch turn would put a
   * network round trip between the permit check and the submission, which is exactly the
   * window the commit chain exists to close. */
  async function resolveCredential(owner, { requireGeneration = true } = {}) {
    const cfg = civitaiConfig(readConfig);
    if (!cfg.enabled)
      throw new CivitaiGenerationError("CIVITAI_DISABLED", "Civitai generation is switched off in Settings.", {}, 400);
    if (!cfg.connectionId)
      throw new CivitaiGenerationError("CIVITAI_NO_CONNECTION", "Civitai generation is on, but no Civitai account is chosen to pay for it.", {}, 400);
    const config = readConfig();
    const accounts = Array.isArray(config.accounts) ? config.accounts : [];
    const connection = findConnection(accounts, cfg.connectionId);
    if (!connection || connection.providerId !== CivitaiProvider.PROVIDER_ID)
      throw new CivitaiGenerationError("CIVITAI_NO_CONNECTION", "The Civitai account CineBraid was set up to use is no longer connected.", {}, 400);

    let credential = connection.credential || {};
    let grantedScope = text(connection.identity?.grantedScope);
    const isOAuth = credential.tokenSource === "oauth";

    /* A token that is expired by the clock is refreshed once, now. There is no second
       attempt and no retry loop: a refresh storm against a rate-limited provider is worse
       than an honest refusal, and this is the same one-refresh rule accounts-api.js's
       verification path already keeps. */
    if (isOAuth && credential.expiresAt && Date.parse(credential.expiresAt) - 60000 <= Date.now()) {
      let refreshed;
      try {
        refreshed = await CivitaiProvider.refreshCredential({ config, refreshToken: credential.refreshToken });
      } catch (error) {
        throw new CivitaiGenerationError(
          "CIVITAI_CREDENTIAL_EXPIRED",
          "This Civitai connection has expired, so CineBraid did not contact Civitai. Reconnect the account in Settings → Accounts. Nothing was submitted.",
          { connectionId: connection.connectionId, cause: text(error?.code) },
          401,
        );
      }
      credential = { ...credential, ...refreshed.credential };
      if (refreshed.grantedScope) grantedScope = String(refreshed.grantedScope);
      /* Persisted immediately. A rotated refresh token that is used and not stored is a
         connection that works exactly once. */
      const next = accounts.map((row) => (
        row?.connectionId === connection.connectionId
          ? { ...row, credential: { ...row.credential, ...refreshed.credential }, identity: { ...row.identity, grantedScope } }
          : row
      ));
      writeConfig({ ...config, accounts: next });
    }

    /* THE SPEND GRANT, checked before anything is quoted rather than discovered at the
       provider after a permit exists.
     *
     * Only OAuth carries a scope CineBraid can read. A personal API key is the account
     * holder's own key and carries whatever their account carries; CineBraid cannot
     * inspect it and does not pretend to — Civitai refuses at its own boundary if it is
     * not permitted, and that refusal is reported honestly rather than guessed at here. */
    if (requireGeneration && isOAuth && !CivitaiProvider.hasGenerationGrant(grantedScope))
      throw new CivitaiGenerationError(
        "CIVITAI_GENERATION_NOT_AUTHORIZED",
        "This Civitai account is connected for identity only. Allow CineBraid to generate on it in Settings → Accounts before generating. Nothing was submitted.",
        { connectionId: connection.connectionId },
        403,
      );

    return {
      cfg,
      connection,
      connectionId: connection.connectionId,
      bearer: CivitaiProvider.bearerFor(credential),
      tokenSource: credential.tokenSource === "api_key" ? "api_key" : "oauth",
      grantedScope,
    };
  }

  /* ---- one request, built the same way every time --------------------------
   *
   * Every route that needs the canonical body calls THIS, with the values off the request.
   * There is no second builder and no route-local variation: that is what makes "the body
   * that was priced is the body that is sent" a property of the code rather than a hope. */
  function buildRequest(cfg, body) {
    const built = Workflow.buildImageRequest({
      jobId: text(body?.requestId),
      air: cfg.resourceAir,
      prompt: text(body?.prompt),
      negativePrompt: text(body?.negativePrompt),
    });
    if (!built.ok) throw new CivitaiGenerationError(built.code, built.error, {}, 400);
    return built;
  }

  /* THE PAID SCOPE OF ONE DISPATCH, in one function so the issuer and the boundary cannot
     describe the same request differently — the same discipline fal's dispatchScopeFor()
     keeps, with the one field Civitai forces added to it. */
  function dispatchScopeFor(body, fingerprint) {
    return {
      purpose: "frame",
      surface: CIVITAI_SURFACE,
      viewMode: "simple",
      shotId: text(body?.shotId),
      frameId: text(body?.frameId),
      entityList: "",
      entityId: "",
      buildId: text(body?.buildId),
      outputCount: CIVITAI_OUTPUT_COUNT,
      requestFingerprint: fingerprint,
    };
  }

  /* ---- routes -------------------------------------------------------------- */

  /* Readiness. No provider call and no live probe: this says whether CineBraid HAS what it
     needs, which is a different question from whether Civitai is up, and collapsing them
     would make a picker's answer depend on somebody else's uptime. */
  app.get("/api/generation/civitai/status", (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    const cfg = civitaiConfig(readConfig);
    const config = readConfig();
    const connection = cfg.connectionId
      ? findConnection(Array.isArray(config.accounts) ? config.accounts : [], cfg.connectionId)
      : null;
    const tokenSource = connection?.credential?.tokenSource === "api_key" ? "api_key" : "oauth";
    /* The bitmask itself never leaves this server. What a screen receives is CineBraid's
       own answer to "can this connection generate", which is what a person can act on. */
    const authorized = !connection
      ? false
      : tokenSource === "api_key" || CivitaiProvider.hasGenerationGrant(connection.identity?.grantedScope);
    const resource = Workflow.parseAir(cfg.resourceAir);
    res.json({
      enabled: cfg.enabled,
      connectionId: cfg.connectionId,
      connected: Boolean(connection),
      displayName: text(connection?.identity?.displayName),
      tokenSource,
      generationAuthorized: authorized,
      resourceAir: cfg.resourceAir,
      resourceValid: Boolean(resource) && Boolean(Workflow.ecosystemFor(cfg.resourceAir)),
      /* Buzz balance is not reported, and the reason is a finding rather than an omission:
         no endpoint in Civitai's published API returns one for an app to read. The figure
         a filmmaker needs before spending is the QUOTE for the request in hand, which the
         estimate route supplies. */
      balanceSupported: false,
      ready: cfg.enabled && Boolean(connection) && authorized && Boolean(Workflow.ecosystemFor(cfg.resourceAir)),
      reason: !cfg.enabled ? "Civitai generation is switched off in Settings."
        : !connection ? "No connected Civitai account is chosen to pay for generation."
          : !authorized ? "This Civitai account is connected for identity only. Allow CineBraid to generate on it in Settings → Accounts."
            : !Workflow.ecosystemFor(cfg.resourceAir) ? "No usable Civitai model is set in Settings → Generation."
              : "",
    });
  });

  /* WHICH CIVITAI CONNECTIONS MAY GENERATE, per connection.
   *
   * account-connections.js's safeConnection() deliberately does not project grantedScope
   * — its header says why: it is an internal provider encoding with no meaning to a user,
   * and a bitmask must never be rendered to one. So this answers CineBraid's own question
   * instead, in a boolean, from the one file that knows Civitai's encoding. The Accounts
   * panel needs it to draw "Allow generation" on the right row, and no other surface
   * learns anything it did not already know. */
  app.get("/api/generation/civitai/grants", (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    const accounts = Array.isArray(readConfig().accounts) ? readConfig().accounts : [];
    res.json({
      grants: accounts
        .filter((row) => row?.providerId === CivitaiProvider.PROVIDER_ID)
        .map((row) => ({
          connectionId: String(row.connectionId || ""),
          displayName: text(row.identity?.displayName),
          tokenSource: row.credential?.tokenSource === "api_key" ? "api_key" : "oauth",
          /* A personal API key carries the account holder's own permissions and has no
             scope string CineBraid can inspect, so it is reported as authorized and
             Civitai refuses at its own boundary if it is not. Claiming to know more than
             that would be inventing a permission check. */
          generationAuthorized: row.credential?.tokenSource === "api_key"
            || CivitaiProvider.hasGenerationGrant(row.identity?.grantedScope),
        })),
    });
  });

  /* Verify the configured resource against the account that would pay for it.
     `canGenerate` is asked for the CALLING USER, so this is an account-specific answer and
     is deliberately not cached across connections. */
  app.post("/api/generation/civitai/resource", async (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      const owner = captureOwner();
      const resolved = await resolveCredential(owner, { requireGeneration: false });
      const air = text(req.body?.resourceAir) || resolved.cfg.resourceAir;
      const parsed = Workflow.parseAir(air);
      if (!parsed || !Workflow.ecosystemFor(air))
        throw new CivitaiGenerationError(
          "CIVITAI_RESOURCE_AIR_INVALID",
          `CineBraid can generate with ${Object.values(Workflow.CIVITAI_ECOSYSTEMS).map((row) => row.label).join(", ")} checkpoints. Paste that model's AIR, which looks like urn:air:sdxl:checkpoint:civitai:101055@128078.`,
          {},
          400,
        );
      const resource = await Client.fetchResource(resolved.bearer, parsed.versionId);
      res.json({ ok: true, air, resource });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* THE QUOTE. Free, by Civitai's own contract: `?whatif=true` prices the body and debits
     nothing. Nothing durable is written here and no permit is minted — a person has not
     decided anything yet. */
  app.post("/api/generation/civitai/estimate", async (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      const owner = captureOwner();
      const resolved = await resolveCredential(owner);
      /* The request id is minted HERE, by the server, and travels through the whole
         transaction: it is the ledger row's id, the tag Civitai indexes the workflow
         under, and part of the body the fingerprint covers. */
      const requestId = uid("civitai");
      const built = buildRequest(resolved.cfg, { ...req.body, requestId });
      const quote = await Client.estimateWorkflow(resolved.bearer, built.canonicalBody);
      if (!quote.priced)
        throw new CivitaiGenerationError(
          "CIVITAI_QUOTE_UNAVAILABLE",
          "Civitai did not price this request, so CineBraid will not offer to pay for it. Nothing was submitted.",
          {},
          502,
        );
      res.json({
        ok: true,
        requestId,
        fingerprint: built.fingerprint,
        cost: { amount: quote.amount, unit: CIVITAI_COST_UNIT, confidence: "quoted", quotedAt: nowIso() },
        resource: built.resource,
        recipe: built.recipe,
        parameters: built.parameters,
        providerContacted: true,
        paidRequestSubmitted: false,
      });
    } catch (error) {
      /* `providerContacted` is carried on the error by the layer that knows — the client
         sets it where the failure actually happened — rather than inferred from a code
         here. An inference would report a refusal built before anything was sent as a
         request that had left. */
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* THE AUTHORIZATION. Still free, and it contacts nobody.
   *
   * It rebuilds the body from the request's own values and refuses unless the digest
   * equals the one the browser says it was quoted. That single comparison is what makes
   * the permit meaningful: a dialog that quoted one prompt and pressed Generate on another
   * cannot mint a permit at all. */
  app.post("/api/generation/civitai/authorize", async (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      const owner = captureOwner();
      const resolved = await resolveCredential(owner);
      const built = buildRequest(resolved.cfg, req.body);
      const quoted = text(req.body?.fingerprint);
      if (!quoted || quoted !== built.fingerprint)
        throw new CivitaiGenerationError(
          "CIVITAI_REQUEST_CHANGED",
          "This request is not the one Civitai priced, so CineBraid did not authorize it. Get a new quote and confirm that. Nothing was submitted.",
          {},
          409,
        );
      const permit = PaidPermit.issuePaidPermit(owner.dir, {
        permitClass: "direct",
        scope: dispatchScopeFor(req.body, built.fingerprint),
        at: nowIso(),
      });
      res.json({ ok: true, paidPermitId: permit.id, expiresAt: permit.expiresAt, providerContacted: false, paidRequestSubmitted: false });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* ---- dispatch: the only place in this file that can spend ---------------- */
  async function dispatch(owner, req) {
    /* THE PERMIT GATE COMES FIRST, AND BEFORE THE CREDENTIAL ON PURPOSE.
     *
     * Building the body needs only configuration, so the whole authorization check can run
     * before anything touches the network. resolveCredential() may refresh an OAuth token —
     * a provider round trip AND a config write — and doing that for a request that turns
     * out to carry no valid permit would be a side effect caused by an unauthorized caller.
     * A refusal here is the cheapest one on this route: no token traffic, no row, no
     * project write, no provider, nothing to undo. */
    const built = buildRequest(civitaiConfig(readConfig), req.body);

    const presented = text(req.body?.paidPermitId);
    let jobs;
    try {
      jobs = readJobLedger(owner.dir).jobs;
    } catch (error) {
      throw new CivitaiGenerationError(
        error?.code || "GENERATION_LEDGER_UNREADABLE",
        error?.message || "CineBraid could not read this project's generation record, so it did not submit a paid request.",
        error?.detail || {},
        error?.status || 409,
      );
    }
    /* Asked of the LEDGER as well as of the store, so a replay is told the truth rather
       than a side effect: a redeemed permit is dropped from the store as housekeeping, and
       without this a second attempt would be refused as "never issued", which is false. */
    const spent = jobs.find((row) => text(row?.paidPermitId) === presented && presented);
    if (spent)
      throw new CivitaiGenerationError(
        "PAID_PERMIT_ALREADY_REDEEMED",
        `This dispatch permit has already been redeemed by generation ${spent.id}. Nothing was submitted.`,
        { redeemedByJobId: spent.id },
        409,
      );
    let found;
    try {
      found = PaidPermit.findPaidPermit(owner.dir, presented, nowIso());
    } catch (error) {
      throw new CivitaiGenerationError(error?.code || "PAID_PERMIT_STORE_UNREADABLE", error.message, error?.detail || {}, error?.status || 409);
    }
    if (!found.ok)
      throw new CivitaiGenerationError(
        found.reason === "expired" ? "PAID_PERMIT_EXPIRED" : found.reason === "missing" ? "PAID_PERMIT_REQUIRED" : "PAID_PERMIT_UNKNOWN",
        found.reason === "expired"
          ? "This request's dispatch permit has expired, so CineBraid did not send it. Nothing was submitted. Get a new quote and confirm again."
          : found.reason === "missing"
            ? "This paid request carries no dispatch permit, so CineBraid cannot tell which authorization would be paying for it. Nothing was submitted."
            : "CineBraid did not issue the dispatch permit this paid request presents, so it did not send it. Nothing was submitted.",
        {},
        found.reason === "missing" ? 400 : 409,
      );

    /* THE BINDING. The scope is recomputed from the request AS GATED, including the digest
       of the body about to be sent, and compared to what the permit was minted for. A
       prompt, a resource, a size or a step count that changed since the quote lands here. */
    const membership = found.permit;
    if (PaidPermit.paidScopeFingerprint(dispatchScopeFor(req.body, built.fingerprint)) !== text(membership.scopeFingerprint))
      throw new CivitaiGenerationError(
        "CIVITAI_REQUEST_CHANGED",
        "This request is not the one that was authorized, so CineBraid did not send it. Nothing was submitted. Get a new quote and confirm that.",
        {},
        409,
      );

    /* Only now, with the authorization settled, is a credential resolved — which is also
       where an expired token is refreshed, well before the commit turn. A refresh inside
       that turn would put a network round trip between the permit check and the
       submission, which is the window the commit chain exists to close. */
    const resolved = await resolveCredential(owner);

    /* THE PRICE, OBTAINED BY THE SERVER, IMMEDIATELY BEFORE SPENDING.
     *
     * The row must record what this generation actually cost to authorize, and a number
     * the browser supplied is not that. `?whatif=true` is free and is the same endpoint
     * with the same bytes, so asking again costs nothing and makes the recorded figure
     * Civitai's own — the same principle shared-generation-rate.js holds for fal, where
     * the quote and the record derive from one function rather than two.
     *
     * A CEILING, NOT AN EQUALITY. A price that has fallen since the person approved it is
     * not a reason to refuse a purchase they already said yes to; a price that has RISEN
     * is, because they never approved that number. */
    const fresh = await Client.estimateWorkflow(resolved.bearer, built.canonicalBody);
    if (!fresh.priced)
      throw new CivitaiGenerationError(
        "CIVITAI_QUOTE_UNAVAILABLE",
        "Civitai would not price this request when CineBraid asked again, so it was not submitted. Nothing was charged.",
        {},
        502,
      );
    const approved = Number(req.body?.authorizedAmount);
    if (!Number.isFinite(approved) || approved < 0)
      throw new CivitaiGenerationError(
        "CIVITAI_AUTHORIZED_AMOUNT_MISSING",
        "CineBraid does not know which Buzz figure was approved for this request, so it did not submit it. Nothing was charged.",
        {},
        400,
      );
    if (fresh.amount > approved)
      throw new CivitaiGenerationError(
        "CIVITAI_QUOTE_INCREASED",
        `Civitai now prices this request at ${fresh.amount} Buzz, more than the ${approved} Buzz that was approved. CineBraid did not submit it and nothing was charged.`,
        { approved, quoted: fresh.amount },
        409,
      );

    const at = nowIso();
    const quote = { amount: fresh.amount, quotedAt: at };
    /* The id the estimate route minted, which is the ledger row's id AND the tag Civitai
       indexes the workflow under — buildRequest has already refused an empty one, and the
       fingerprint covers the tag it produced, so this value cannot differ from what was
       authorized. The duplicate check below is what stops a caller replaying an id that
       already names a row. */
    const jobId = text(req.body?.requestId);
    if (jobs.some((row) => text(row?.id) === jobId))
      throw new CivitaiGenerationError("CIVITAI_JOB_DUPLICATE", "CineBraid already has a generation with that identity.", { jobId }, 409);

    const contract = contractJob({
      jobId,
      shotId: text(req.body?.shotId),
      frameId: text(req.body?.frameId),
      prompt: text(req.body?.prompt),
      negativePrompt: text(req.body?.negativePrompt),
      connectionId: resolved.connectionId,
      quote,
      status: "submitting",
    });

    /* THE DURABLE ROW IS WRITTEN BEFORE SUBMISSION, and the permit is spent in the same
       turn that writes it. commitJobLedger serialises per project directory and RE-READS
       inside its own synchronous turn, so this check and the row it guards are indivisible
       against every other dispatch of this project — which is what makes a permit
       single-use without a lock, a counter or a second store. */
    const job = {
      id: jobId,
      provider: CIVITAI_PROVIDER,
      backendId: Client.CIVITAI_BACKEND_ID,
      surfaceId: Client.CIVITAI_SURFACE_ID,
      kind: "image",
      purpose: "frame",
      mode: "t2i",
      shotId: text(req.body?.shotId),
      frameId: text(req.body?.frameId),
      frameLabel: text(req.body?.frameLabel) || "A",
      sourceBuildId: text(req.body?.buildId),
      /* What a filmmaker recognises: the model they chose, by the name Civitai gave it. */
      model: text(req.body?.resourceLabel) || built.resource.air,
      modelId: "civitai/orchestrator-image",
      prompt: text(req.body?.prompt),
      negativePrompt: text(req.body?.negativePrompt),
      references: [],
      outputCount: CIVITAI_OUTPUT_COUNT,
      quality: "",
      resolution: `${built.parameters.width}x${built.parameters.height}`,
      createdAt: at,
      updatedAt: at,
      status: ledgerStatus("SUBMITTING"),
      outputs: [],
      error: "",
      ingestedAt: "",
      paidPermitId: membership.id,
      accounting: civitaiAccounting(quote),
      contract,
      civitai: civitaiProvenance({ resolved, built, quote, at }),
    };

    try {
      await commitJobLedger(owner, (current) => {
        const already = current.find((row) => text(row?.paidPermitId) === String(membership.id));
        if (already) {
          const error = new Error(`This dispatch permit has already been redeemed by generation ${already.id}. Nothing was submitted.`);
          error.paidPermitRedeemed = already.id;
          throw error;
        }
        current.push(job);
        return job;
      });
    } catch (error) {
      if (error?.paidPermitRedeemed)
        throw new CivitaiGenerationError("PAID_PERMIT_ALREADY_REDEEMED", error.message, { redeemedByJobId: error.paidPermitRedeemed }, 409);
      throw error;
    }
    /* Housekeeping, after the fact that matters is durable. A stored permit that survives
       a crash here is refused by the ledger check above, so this failing costs nothing. */
    PaidPermit.dropPaidPermit(owner.dir, membership.id);

    let submitted;
    try {
      submitted = await Client.submitWorkflow(resolved.bearer, built.canonicalBody);
    } catch (error) {
      /* DID THE PROVIDER TELL US, AUTHORITATIVELY, THAT IT DID NOT TAKE THE JOB?
         Everything else is uncertainty, and uncertainty gets its own durable state. A
         wrongly UNRESOLVED job costs one confirmation click; a wrongly FAILED one costs a
         second paid render. */
      const classified = Lifecycle.classifyProviderFailure({
        transmitted: true,
        httpStatus: Number(error?.detail?.providerStatus) || null,
      });
      await commitJobLedger(owner, (current) => {
        const row = current.find((item) => item.id === jobId);
        if (!row) return null;
        row.status = ledgerStatus(classified.status);
        row.error = text(error?.message);
        row.errorCode = text(error?.code);
        row.updatedAt = nowIso();
        row.civitai = { ...row.civitai, submitOutcome: classified.outcome, submitReason: classified.reason };
        return row;
      });
      const failure = new CivitaiGenerationError(text(error?.code) || "CIVITAI_SUBMIT_FAILED", text(error?.message), isRecord(error?.detail) ? error.detail : {}, Number(error?.status) || 502);
      failure.providerContacted = true;
      /* Honest about money on the one path where it matters: a request that was sent and
         never answered may have been accepted, and may have been charged for. */
      failure.paidRequestSubmitted = classified.status === Lifecycle.UNRESOLVED;
      throw failure;
    }

    return commitJobLedger(owner, (current) => {
      const row = current.find((item) => item.id === jobId);
      if (!row) return job;
      /* `externalId` is the field generation-lifecycle.js's providerRequestId() reads and
         the field the ingest reaper and the resubmission guard already trust. Writing the
         workflow id anywhere else would be inventing a name no reader looks for. */
      row.externalId = submitted.workflowId;
      row.status = ledgerStatusForWorkflow(submitted.status) === ledgerStatus("FAILED")
        ? ledgerStatus("FAILED")
        : ledgerStatusForWorkflow(submitted.status);
      row.updatedAt = nowIso();
      row.civitai = { ...row.civitai, workflowId: submitted.workflowId, submittedAt: row.updatedAt, remoteStatus: submitted.status };
      return row;
    });
  }

  /* ---------------------------------------------------------------------------
     Provenance — the minimum needed to explain or find this run again.

     Civitai-specific facts live under `job.civitai`, never in the shot and never in the
     contract's intent blocks. That separation is not a convention: FORBIDDEN_INTENT_KEYS
     already refuses the literal string "civitai" inside target/inputs/output/settings/model,
     so an attempt to move any of this into production intent fails validateGenerationJob()
     rather than shipping.

     WHAT IS DELIBERATELY NOT KEPT: the whole workflow response. Civitai returns nsfwLevel,
     callbacks, upgradeMode, allowMatureContent, experimental and per-job timing, and none
     of it explains a picture. The canonical body is not stored either — the FINGERPRINT is
     what the paid invariant needs, and a second copy of the prompt would be a second prompt
     authority beside the one the candidate row already carries. */
  function civitaiProvenance({ resolved, built, quote, at }) {
    return {
      backendId: Client.CIVITAI_BACKEND_ID,
      surfaceId: Client.CIVITAI_SURFACE_ID,
      executionKind: "hosted_api",
      orchestratorLocation: "hosted_api",
      inferenceLocation: "hosted_api",
      trustClass: "remote_credentialed",
      costClass: CIVITAI_COST_CLASS,
      /* WHICH ACCOUNT PAID, by connection rather than by name. */
      accountConnectionId: resolved.connectionId,
      tokenSource: resolved.tokenSource,
      resource: {
        air: built.resource.air,
        ecosystem: built.resource.ecosystem,
        type: built.resource.type,
        modelId: built.resource.modelId,
        versionId: built.resource.versionId,
      },
      recipe: built.recipe,
      parameters: built.parameters,
      /* The identity that ties this delivery to the request that was authorized. */
      requestFingerprint: built.fingerprint,
      jobTag: built.tag,
      quotedCost: { amount: quote.amount, unit: CIVITAI_COST_UNIT, quotedAt: quote.quotedAt },
      /* Populated only if Civitai returns it. Its documentation says Buzz charges live on
         the workflow's cost/transactions but publishes no field shape, so CineBraid carries
         what arrives and asserts nothing about it. */
      actualCost: null,
      returnedOutputs: [],
      preparedAt: at,
    };
  }

  /* ---------------------------------------------------------------------------
     Collection and delivery.

     A REMOTE SUCCESS IS NOT A DELIVERY. The row is promoted to COMPLETED only after the
     bytes are on this machine and a candidate row names them, because that is the only
     point at which a filmmaker actually has something to review. */
  async function collect(owner, jobId, { waitSeconds = 0 } = {}) {
    return serializeJobOperation(owner, jobId, async () => {
      const job = civitaiJobs(owner).find((row) => row.id === jobId);
      if (!job) throw new CivitaiGenerationError("CIVITAI_JOB_MISSING", "That generation is not in this project's record.", { jobId }, 404);
      if (job.ingestedAt) return job;
      if (!text(job.externalId))
        throw new CivitaiGenerationError(
          "CIVITAI_JOB_UNSUBMITTED",
          "CineBraid has no Civitai workflow for that generation. It may never have reached Civitai, or the answer may have been lost — it will not be sent again automatically, because that could pay for the same picture twice.",
          { jobId },
          409,
        );

      const resolved = await resolveCredential(owner, { requireGeneration: false });
      const workflow = await Client.getWorkflow(resolved.bearer, job.externalId, { waitSeconds });

      if (workflow.status === "failed" || workflow.status === "canceled")
        return commitJobLedger(owner, (jobs) => {
          const row = jobs.find((item) => item.id === jobId);
          if (!row) return job;
          row.status = ledgerStatus("FAILED");
          row.error = workflow.status === "canceled"
            ? "This generation was cancelled at Civitai."
            : "Civitai reported an error while running this generation.";
          row.updatedAt = nowIso();
          row.civitai = { ...row.civitai, remoteStatus: workflow.status, completedAt: row.updatedAt, cost: workflow.cost, transactions: workflow.transactions };
          return row;
        });

      if (workflow.status !== "succeeded")
        return commitJobLedger(owner, (jobs) => {
          const row = jobs.find((item) => item.id === jobId);
          if (!row) return job;
          row.status = ledgerStatusForWorkflow(workflow.status);
          row.updatedAt = nowIso();
          row.civitai = { ...row.civitai, remoteStatus: workflow.status };
          return row;
        });

      const outputs = workflow.outputs.filter((row) => row.url);
      if (!outputs.length)
        return commitJobLedger(owner, (jobs) => {
          const row = jobs.find((item) => item.id === jobId);
          if (!row) return job;
          /* Remotely succeeded, nothing to deliver. UNRESOLVED rather than FAILED: Buzz
             was spent on a workflow Civitai says worked, and the result may simply not be
             fetchable yet. */
          row.status = ledgerStatus(Lifecycle.UNRESOLVED);
          row.error = "Civitai finished this generation but returned no image CineBraid could download.";
          row.updatedAt = nowIso();
          row.civitai = { ...row.civitai, remoteStatus: workflow.status, completedAt: row.updatedAt, cost: workflow.cost, transactions: workflow.transactions };
          return row;
        });

      /* DOWNLOAD PHASE — every byte fetched BEFORE the commit turn opens, because that turn
         is synchronous by contract and holding the project document open across a transfer
         is the defect generation-commit.js exists to prevent.

         AN EXPIRING URL IS NEVER THE AUTHORITATIVE ASSET. Civitai's own documentation says
         these signed URLs expire and must not be cached, so the bytes are taken now and
         the URL is kept afterwards only as evidence of where they came from. */
      const downloads = [];
      try {
        for (const output of outputs) {
          const fetched = await Client.fetchBlob(output.url);
          downloads.push({
            buffer: fetched.buffer,
            mime: fetched.mime || output.mimeType,
            originalName: output.blobId ? `${output.blobId}` : `${job.externalId}`,
            descriptor: output,
          });
        }
      } catch (error) {
        /* MATERIALIZATION FAILED AFTER A REMOTE SUCCESS. The truth is that Civitai ran this
           and was paid for it, and CineBraid does not hold the result. Not COMPLETED,
           because nothing was delivered; not FAILED, because the work succeeded and
           resubmitting would pay twice. `ingestedAt` stays empty so a later Refresh
           re-reads the workflow, gets a FRESH signed URL and finishes the delivery — which
           is only possible because what was kept is the workflow id and not the URL. */
        return commitJobLedger(owner, (jobs) => {
          const row = jobs.find((item) => item.id === jobId);
          if (!row) return job;
          row.status = ledgerStatus(Lifecycle.UNRESOLVED);
          row.error = `Civitai finished this generation, but CineBraid could not download the result: ${text(error?.message)} It has not been paid for twice — press Refresh to try collecting it again.`;
          row.errorCode = text(error?.code);
          row.updatedAt = nowIso();
          row.civitai = {
            ...row.civitai,
            remoteStatus: workflow.status,
            completedAt: row.updatedAt,
            materializationFailedAt: row.updatedAt,
            cost: workflow.cost,
            transactions: workflow.transactions,
            /* Blob identities are kept; the URLs are not treated as an asset locator. */
            returnedOutputs: outputs.map((output) => ({ blobId: output.blobId, mimeType: output.mimeType, sourceUrlSeen: output.url, deliveredAs: "" })),
          };
          return row;
        });
      }

      const result = contractResult({
        jobId,
        status: "completed",
        artifacts: downloads.map((row, index) => ({
          artifactId: `${jobId}-a${index + 1}`,
          kind: "image",
          role: "candidate",
          bytes: row.buffer.length,
        })),
      });

      /* COMMIT PHASE — one indivisible turn, through the SHARED writer, against freshly
         read state. The shot is re-found INSIDE the turn: a shot deleted while a paid
         render ran must not receive a candidate. */
      const written = await commitProject(owner, (project) => {
        const shot = (project.shots || []).find((row) => String(row.id) === String(job.shotId));
        if (!shot)
          throw new CivitaiGenerationError("CIVITAI_SHOT_MISSING", "That shot no longer exists, so its result was not attached.", { shotId: job.shotId }, 409);
        const rows = writeShotCandidates({
          ownerDir: owner.dir,
          project,
          shot,
          downloads,
          job,
          provider: CIVITAI_PROVIDER,
          fileStem: CIVITAI_FILE_STEM,
          packageLabel: "Civitai generation",
        });
        markShotAwaitingReview(shot);
        return rows;
      });

      return commitJobLedger(owner, (jobs) => {
        const row = jobs.find((item) => item.id === jobId);
        if (!row) return job;
        row.status = ledgerStatus("COMPLETED");
        row.outputs = written;
        row.ingestedAt = nowIso();
        row.updatedAt = row.ingestedAt;
        row.result = result;
        /* A DELIVERED JOB CARRIES NO FAILURE MESSAGE.
         *
         * Found on the first real recovery: a job that failed to collect, was corrected and
         * then delivered stayed COMPLETED while still carrying "CineBraid could not download
         * the result". The shot strip renders job.error whenever it is present, so a
         * filmmaker was shown a delivered candidate beside the reason it had not been
         * delivered. The earlier failure is not erased — job.civitai.materializationFailedAt
         * is cleared just below and the whole attempt is recoverable from the ledger's
         * history — but the CURRENT state of this row is success, and the row must say so. */
        row.error = "";
        row.errorCode = "";
        row.civitai = {
          ...row.civitai,
          remoteStatus: workflow.status,
          completedAt: row.ingestedAt,
          materializationFailedAt: "",
          /* WHAT CIVITAI SAYS IT CHARGED, carried through unread. */
          cost: workflow.cost,
          transactions: workflow.transactions,
          workflowJobIds: workflow.steps.flatMap((step) => step.jobIds),
          /* Which remote blob became which durable CineBraid file — the last link in the
             chain from a shot to a picture. The URL is recorded as historic evidence and
             is never read back to serve anything. */
          returnedOutputs: downloads.map((download, index) => ({
            blobId: download.descriptor.blobId,
            mimeType: download.mime,
            bytes: download.buffer.length,
            sourceUrlSeen: download.descriptor.url,
            deliveredAs: written[index]?.name || "",
          })),
        };
        return row;
      });
    });
  }

  /* ---- remaining routes ---------------------------------------------------- */

  app.get("/api/generation/civitai/jobs", (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      res.json({ jobs: civitaiJobs(captureOwner()) });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  app.post("/api/generation/civitai/jobs", async (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      res.json({ ok: true, job: await dispatch(captureOwner(), req) });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  app.post("/api/generation/civitai/jobs/:id/refresh", async (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      /* A short server-side long poll, because Civitai supports one and a render that
         finishes inside it saves the filmmaker a second press. It is bounded by the
         client's own ceiling and there is no timer anywhere in this module. */
      const waitSeconds = Number(req.body?.waitSeconds);
      res.json({ ok: true, job: await collect(captureOwner(), String(req.params.id), { waitSeconds }) });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  /* THE ORPHAN CHECK. Asks Civitai whether a workflow exists carrying this job's tag, for
     the one window CineBraid cannot close on its own: a crash between writing the ledger
     row and receiving the submission's answer. It reads and never submits. */
  app.post("/api/generation/civitai/jobs/:id/reconcile", async (req, res) => {
    if (!requireLocalMachine(req, res)) return;
    try {
      const owner = captureOwner();
      const jobId = String(req.params.id);
      const job = civitaiJobs(owner).find((row) => row.id === jobId);
      if (!job) throw new CivitaiGenerationError("CIVITAI_JOB_MISSING", "That generation is not in this project's record.", { jobId }, 404);
      if (text(job.externalId)) return res.json({ ok: true, job, found: true, alreadyKnown: true });
      const resolved = await resolveCredential(owner, { requireGeneration: false });
      const matches = await Client.queryWorkflows(resolved.bearer, { tag: Workflow.jobTag(jobId) });
      if (!matches.length)
        return res.json({ ok: true, job, found: false, reason: "Civitai has no workflow carrying this generation's tag, so nothing was submitted for it." });
      const workflow = matches[0];
      const updated = await commitJobLedger(owner, (jobs) => {
        const row = jobs.find((item) => item.id === jobId);
        if (!row) return job;
        row.externalId = workflow.workflowId;
        row.status = ledgerStatusForWorkflow(workflow.status);
        row.updatedAt = nowIso();
        row.civitai = { ...row.civitai, workflowId: workflow.workflowId, remoteStatus: workflow.status, recoveredAt: row.updatedAt };
        return row;
      });
      res.json({ ok: true, job: updated, found: true, alreadyKnown: false });
    } catch (error) {
      const { status, body } = failureOf(error);
      res.status(status).json(body);
    }
  });

  return { collect, dispatch };
}

module.exports = {
  CIVITAI_COST_CLASS,
  CIVITAI_COST_UNIT,
  CIVITAI_FILE_STEM,
  CIVITAI_OUTPUT_COUNT,
  CIVITAI_PROVIDER,
  CIVITAI_SURFACE,
  CivitaiGenerationError,
  civitaiAccounting,
  contractJob,
  contractResult,
  ledgerStatusForWorkflow,
  registerCivitaiGeneration,
};

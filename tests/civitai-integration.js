/* Civitai Foothold V1 — the paid integration, proven end to end.
 *
 * The claim this suite exists to hold is one sentence:
 *
 *     A CineBraid frame can be priced by Civitai without spending, authorized by a person
 *     for THAT EXACT REQUEST, submitted once, and the result comes back as a returned
 *     candidate on THAT shot through the review path CineBraid already has — with Buzz
 *     recorded as Buzz and nothing approved by arriving.
 *
 * FIXTURES, NOT MOCKS, WHERE IT MATTERS. The Civitai at the other end is a real HTTP
 * server on loopback speaking the real orchestration protocol — POST /v2/consumer/workflows
 * with and without ?whatif=true, GET /v2/consumer/workflows/{id}, the tag query, the mini
 * model-version endpoint and a signed blob URL — and the routes under test are registered
 * on a real express app and driven over a real socket. Nothing in civitai-client.js, the
 * express layer, the loopback boundary, the paid permit or the commit chain is stubbed, so
 * what passes here is the code path a filmmaker uses. What is fixture is the WEIGHTS: the
 * fake server returns a small PNG instead of running a diffusion model.
 *
 * ZERO REAL BUZZ. The only address any of this may reach is 127.0.0.1. The suite asserts
 * that at the end, from the mock's own request log and from the environment the client was
 * built with — not by promising it in a comment.
 */

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const notes = [];
const note = (line) => notes.push(line);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const AIR = "urn:air:sdxl:checkpoint:civitai:101055@128078";
const CONNECTION_ID = "conn-0123456789abcdef0123456789abcdef";
const ACCESS_TOKEN = "civitai-access-fixture";
const API_KEY = "civitai-apikey-fixture";
/* UserRead | AIServicesRead | AIServicesWrite. A decimal bitmask string, which is what
   Civitai actually returns — never a name list. */
const GENERATION_SCOPE = "49153";
const IDENTITY_SCOPE = "1";

/* ---------------------------------------------------------------------------
   The Civitai fixture. */
function startMockOrchestrator() {
  const state = {
    requests: [],
    workflows: new Map(),
    /* One-shot overrides so a case can make the NEXT answer a refusal without racing. */
    script: [],
    /* A STANDING override that applies ONLY to a real submission, never to a whatif.
       The dispatch route prices before it spends, so a one-shot script entry would be
       eaten by the re-quote and the case would prove the wrong thing. */
    failSubmit: "",
    cost: 10,
    nextStatus: "succeeded",
    blobBroken: false,
    /* HOW THE RESULT IS SERVED. `redirect` is the shape the real Civitai uses and the one
       the first paid generation exposed: a same-origin 301 to a /content/<token> path. The
       `escape*` modes are the ones that must still be refused. */
    blobMode: "direct",
    canGenerate: true,
    checkPermission: false,
  };
  const next = () => (state.script.length ? state.script.shift() : "");
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
    let raw = "";
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      raw = Buffer.concat(chunks).toString("utf8");
    }
    state.requests.push({
      method: req.method,
      path: url.pathname,
      whatif: url.searchParams.get("whatif"),
      tags: url.searchParams.get("tags"),
      authorization: req.headers.authorization || "",
      body: raw,
    });
    const send = (status, body, type = "application/json") => {
      res.statusCode = status;
      res.setHeader("content-type", type);
      res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    const scripted = next();
    if (scripted === "insufficient-buzz")
      return send(400, { code: "BAD_REQUEST", message: "Hey buddy, seems like you don't have enough funds..." });
    if (scripted === "unauthorized") return send(401, { code: "UNAUTHORIZED" });
    if (scripted === "server-error") return send(500, { code: "SERVER_ERROR" });
    if (scripted === "drop") { req.socket.destroy(); return; }

    if (url.pathname === "/v2/consumer/workflows" && req.method === "POST") {
      const body = JSON.parse(raw);
      /* THE WHATIF AND THE SUBMIT MUST BE THE SAME BYTES. The mock records both so the
         suite can compare them rather than trust that they matched. */
      if (url.searchParams.get("whatif") === "true")
        return send(200, { status: "unassigned", cost: { total: state.cost } });
      if (state.failSubmit === "insufficient-buzz")
        return send(400, { code: "BAD_REQUEST", message: "Hey buddy, seems like you don't have enough funds..." });
      if (state.failSubmit === "drop") { req.socket.destroy(); return; }
      const id = `wf_${state.workflows.size + 1}`;
      state.workflows.set(id, { id, status: "unassigned", tags: body.tags || [], body });
      return send(200, { id, status: "unassigned", tags: body.tags || [] });
    }
    if (url.pathname === "/v2/consumer/workflows" && req.method === "GET") {
      const tag = url.searchParams.get("tags") || "";
      const items = [...state.workflows.values()].filter((row) => (row.tags || []).includes(tag));
      return send(200, { items: items.map((row) => workflowView(row, state)) });
    }
    const match = /^\/v2\/consumer\/workflows\/(.+)$/.exec(url.pathname);
    if (match && req.method === "GET") {
      const row = state.workflows.get(decodeURIComponent(match[1]));
      if (!row) return send(404, { code: "NOT_FOUND" });
      row.status = state.nextStatus;
      return send(200, workflowView(row, state));
    }
    if (/^\/api\/v1\/model-versions\/mini\/\d+$/.test(url.pathname))
      return send(200, {
        id: 128078, modelId: 101055, name: "v1.0", model: { name: "Fixture SDXL" },
        baseModel: "SDXL 1.0", air: AIR, availability: "Public",
        canGenerate: state.canGenerate, checkPermission: state.checkPermission,
      });
    /* The result address the workflow hands out. What it does depends on blobMode, so one
       fixture covers the legitimate redirect and every refusal that must survive it. */
    if (url.pathname === "/blob/output.png") {
      if (state.blobBroken) return send(403, { code: "EXPIRED" });
      const away = (location) => { res.statusCode = 302; res.setHeader("location", location); return res.end(); };
      switch (state.blobMode) {
        case "redirect":
          /* The real shape: 301, RELATIVE, same origin, to a /content/<token> path. */
          res.statusCode = 301;
          res.setHeader("location", "/blob/content/opaque-token-abc123");
          return res.end();
        case "escape-external":  return away("https://example.com/stolen.png");
        case "escape-loopback":  return away("http://127.0.0.1:9/other-port.png");
        case "escape-private":   return away("https://10.0.0.5/internal.png");
        case "escape-linklocal": return away("https://169.254.169.254/latest/meta-data/");
        case "escape-scheme":    return away("file:///etc/passwd");
        case "loop":             return away("/blob/output.png");
        case "no-location":      { res.statusCode = 302; return res.end(); }
        default:
          res.statusCode = 200;
          res.setHeader("content-type", "image/png");
          return res.end(PNG);
      }
    }
    /* Where the legitimate same-origin redirect lands. */
    if (url.pathname === "/blob/content/opaque-token-abc123") {
      res.statusCode = 200;
      res.setHeader("content-type", "image/png");
      return res.end(PNG);
    }
    return send(404, { code: "NOT_FOUND" });
  });

  function workflowView(row, current) {
    const base = { id: row.id, status: row.status, tags: row.tags, createdAt: "2026-09-05T00:00:00.000Z" };
    if (row.status !== "succeeded") return base;
    return {
      ...base,
      completedAt: "2026-09-05T00:01:00.000Z",
      cost: { total: current.cost },
      transactions: [{ type: "debit", amount: current.cost, currency: "buzz" }],
      steps: [{
        name: "0",
        $type: "imageGen",
        status: "succeeded",
        jobs: [{ id: "job-fixture-1" }],
        output: { images: [{ id: "blob_fixture_1", url: `http://127.0.0.1:${server.address().port}/blob/output.png`, available: true }] },
      }],
    };
  }

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      state,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      close: () => {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        server.close();
      },
    }));
  });
}

/* ---------------------------------------------------------------------------
   A CineBraid, in miniature. */
async function makeHarness({ orchestratorUrl, tokenSource = "oauth", grantedScope = GENERATION_SCOPE, enabled = true, connectionId = CONNECTION_ID, resourceAir = AIR, bindAll = false, mutate } = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "cb-civitai-"));
  const projectsRoot = path.join(dir, "projects");
  process.env.CINEBRAID_CONFIG_PATH = path.join(dir, "config.json");
  /* Set BEFORE the client is required: civitai-client.js pins its two hosts at load, which
     is the property that makes them unsteerable at runtime — so a harness that wants a
     different one has to say so before the module exists. */
  process.env.CINEBRAID_CIVITAI_ORCHESTRATION_BASE = orchestratorUrl;
  process.env.CINEBRAID_CIVITAI_API_BASE = orchestratorUrl;
  /* Evicted so every module reads the environment set above, and so a negative control can
     install a broken copy of any of them.

     generation-commit.js is deliberately NOT in this list. Its Maps are module-scoped on
     purpose and are keyed on the project directory, which is a fresh temp path per
     harness — so keeping it cached is both harmless and closer to production, where one
     process holds one chain for every backend. */
  for (const key of Object.keys(require.cache))
    if (/civitai-(client|workflow|generation)\.js$|account-provider-civitai\.js$|paid-dispatch-permit\.js$|generation-candidate-ingest\.js$|[\\/]config\.js$/.test(key))
      delete require.cache[key];
  /* A negative control installs a DELIBERATELY BROKEN copy of one module here — after the
     cache is cleared and before anything requires it — so the routes below are built ON
     the defect rather than beside it. `MUTATE` is consulted as well as the per-call hook,
     because main() builds many harnesses and a control has to break all of them.
     In memory only; nothing is written to disk. */
  if (typeof mutate === "function") mutate({ ROOT });
  if (typeof module.exports.MUTATE === "function") module.exports.MUTATE({ ROOT });

  const Config = require(path.join(ROOT, "config.js"));
  const { registerCivitaiGeneration } = require(path.join(ROOT, "civitai-generation.js"));

  const slugs = ["film-a", "film-b"];
  for (const slug of slugs) {
    fs.mkdirSync(path.join(projectsRoot, slug, "shots"), { recursive: true });
    fs.writeFileSync(path.join(projectsRoot, slug, "project.json"), JSON.stringify({
      title: slug,
      shots: (slug === "film-a" ? ["SC-01-01"] : ["SC-99-99"]).map((id) => ({ id, title: id, candidateFiles: [], keyframes: [] })),
      mediaAssets: [],
    }, null, 2));
  }

  Config.writeConfig(Config.mergeConfig(Config.readConfig(), {
    generation: { civitai: { enabled, connectionId, resourceAir } },
    accounts: connectionId ? [{
      connectionId: CONNECTION_ID,
      providerId: "civitai",
      providerLabel: "Civitai",
      status: "connected",
      identity: { providerUserId: "42", displayName: "fixture", avatarUrl: null, tier: "free", accountStatus: "active", grantedScope },
      credential: tokenSource === "api_key"
        ? { tokenSource: "api_key", accessToken: "", refreshToken: "", apiKey: API_KEY, expiresAt: null }
        : { tokenSource: "oauth", accessToken: ACCESS_TOKEN, refreshToken: "civitai-refresh-fixture", apiKey: "", expiresAt: null },
      balance: { supported: false, unit: null, amount: null, checkedAt: null },
      createdAt: "2026-09-05T00:00:00.000Z",
      lastVerifiedAt: "2026-09-05T00:00:00.000Z",
      lastError: null,
    }] : [],
  }));

  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  let current = "film-a";
  const projectFile = (slug) => path.join(projectsRoot, slug, "project.json");
  registerCivitaiGeneration(app, {
    readConfig: () => Config.readConfig(),
    writeConfig: (next) => Config.writeConfig(next),
    readProject: (slug) => JSON.parse(fs.readFileSync(projectFile(slug), "utf8")),
    writeProject: (project, slug) => fs.writeFileSync(projectFile(slug), JSON.stringify(project, null, 2)),
    activeSlug: () => current,
    projectDirForSlug: (slug) => {
      if (!/^[\w.-]+$/.test(String(slug || "")) || !slugs.includes(String(slug)))
        throw new Error("Invalid project slug.");
      return { dir: path.join(projectsRoot, slug), file: projectFile(slug) };
    },
  });
  const server = app.listen(0, bindAll ? "0.0.0.0" : "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = () => `http://127.0.0.1:${server.address().port}`;
  async function call(pathname, options = {}) {
    const response = await fetch(baseUrl() + pathname, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: response.status, ok: response.ok, body };
  }
  return {
    dir, projectsRoot, Config, app, server, baseUrl, call,
    port: () => server.address().port,
    setActive: (slug) => { current = slug; },
    project: (slug = current) => JSON.parse(fs.readFileSync(projectFile(slug), "utf8")),
    jobs: (slug = current) => {
      const file = path.join(projectsRoot, slug, "generation-jobs.json");
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    },
    permits: (slug = current) => {
      const file = path.join(projectsRoot, slug, "paid-permits.json");
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    },
    takes: (slug = current, shotId = "SC-01-01") => {
      const folder = path.join(projectsRoot, slug, "shots", shotId, "takes");
      return fs.existsSync(folder) ? fs.readdirSync(folder) : [];
    },
    close: () => {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      server.close();
    },
  };
}

const FRAME = { shotId: "SC-01-01", frameId: "F1", frameLabel: "A", buildId: "build-1", prompt: "a lighthouse at dusk", negativePrompt: "" };

/* Quote → authorize → dispatch, the whole paid transaction, as the browser drives it. */
async function generate(kit, overrides = {}) {
  const quote = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: { ...FRAME, ...overrides.estimate } });
  if (!quote.ok) return { quote };
  const authorizeBody = {
    ...FRAME,
    requestId: quote.body.requestId,
    fingerprint: quote.body.fingerprint,
    ...overrides.authorize,
  };
  const permit = await kit.call("/api/generation/civitai/authorize", { method: "POST", body: authorizeBody });
  if (!permit.ok) return { quote, permit };
  const dispatch = await kit.call("/api/generation/civitai/jobs", {
    method: "POST",
    body: {
      ...authorizeBody,
      paidPermitId: permit.body.paidPermitId,
      authorizedAmount: quote.body.cost.amount,
      ...overrides.dispatch,
    },
  });
  return { quote, permit, dispatch };
}

async function main() {
  const mock = await startMockOrchestrator();
  let kit = await makeHarness({ orchestratorUrl: mock.baseUrl });
  try {
    /* =====================================================================
       0. THE TWO GRANTS, AND THE ONE NOT ASKED FOR.

       Pure adapter checks, before any harness is involved. This is the vocabulary that
       keeps Settings' promise literally true: Connect asks for identity, spending is a
       second act, and no caller can ask a person for anything else. */
    {
      const Provider = require(path.join(ROOT, "account-provider-civitai.js"));
      const config = { accountProviders: { civitai: { clientId: "fixture-client" } } };
      const url = (grant) => new URL(Provider.buildAuthorization({ config, redirectUri: "http://127.0.0.1:4477/api/accounts/civitai/callback", grant }).authorizationUrl);

      assert.strictEqual(url("identity").searchParams.get("scope"), "1", "Connect asks for UserRead and nothing else");
      assert.strictEqual(url().searchParams.get("scope"), "1", "the default grant is identity, so an unstated grant never asks to spend");
      const generation = url("generation").searchParams.get("scope");
      assert.strictEqual(generation, "49153", "the spend grant is UserRead | AIServicesRead | AIServicesWrite");
      /* BuzzRead (65536) is deliberately absent: no published Civitai endpoint returns a
         balance to an application, so asking for it would be asking a person to trust a
         claim CineBraid cannot cash. */
      assert.strictEqual((Number(generation) & Provider.CIVITAI_SCOPE_BITS.AIServicesWrite) !== 0, true);
      assert.strictEqual((Number(generation) & 65536) === 0, true, "BuzzRead is never requested");
      assert.strictEqual(url("generation").searchParams.get("code_challenge_method"), "S256", "PKCE S256, on both grants");
      assert.strictEqual(url("generation").searchParams.has("client_secret"), false, "a public client sends no secret, ever");

      /* An unknown grant is a refusal rather than a silent fall back to identity: a caller
         that asked for generation and quietly received identity would send a person
         through a consent screen and leave them unable to generate. */
      let refused = "";
      try { Provider.buildAuthorization({ config, redirectUri: "http://127.0.0.1:4477/x", grant: "everything" }); }
      catch (error) { refused = String(error.code || ""); }
      assert.strictEqual(refused, "SCOPE_INSUFFICIENT");

      /* The bitmask is read in exactly one file, and an unreadable one is never a yes. */
      assert.strictEqual(Provider.hasGenerationGrant("49153"), true);
      assert.strictEqual(Provider.hasGenerationGrant("33554431"), true, "a Full grant includes the AI services bits");
      assert.strictEqual(Provider.hasGenerationGrant("1"), false, "identity alone cannot spend");
      assert.strictEqual(Provider.hasGenerationGrant("16384"), false, "reading generations is not permission to make one");
      for (const bad of ["", null, undefined, "AIServicesWrite", "not-a-number", "-1", "1e9"])
        assert.strictEqual(Provider.hasGenerationGrant(bad), false, `an unreadable scope (${String(bad)}) must never read as permission`);
      note("Connect asks scope 1; spending is a separate grant of 49153 with BuzzRead deliberately absent; an unreadable scope is never a yes");
    }

    /* =====================================================================
       1. THE QUOTE COSTS NOTHING, AND IT PRICES THIS EXACT REQUEST. */
    const quote = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
    assert(quote.ok, JSON.stringify(quote.body));
    assert.strictEqual(quote.body.cost.amount, 10);
    assert.strictEqual(quote.body.cost.unit, "buzz");
    assert.strictEqual(quote.body.cost.confidence, "quoted", "Civitai priced this job, so the confidence is quoted and not estimated");
    assert.strictEqual(quote.body.paidRequestSubmitted, false);
    assert.strictEqual(kit.jobs().length, 0, "an estimate writes no ledger row — an estimate is not a job");
    assert.strictEqual(kit.permits().length, 0, "an estimate mints no permit — nobody has decided anything yet");
    const whatifCalls = mock.state.requests.filter((row) => row.whatif === "true");
    assert.strictEqual(whatifCalls.length, 1);
    assert.strictEqual(mock.state.workflows.size, 0, "asking the price must not create a workflow");
    note("a quote prices the exact request, writes nothing durable and creates no workflow");

    /* =====================================================================
       2. THE WHOLE TRANSACTION, AND THE BYTES THAT WERE PRICED ARE THE BYTES SENT. */
    mock.state.requests.length = 0;
    const run = await generate(kit);
    assert(run.dispatch.ok, JSON.stringify(run.dispatch.body));
    const posts = mock.state.requests.filter((row) => row.method === "POST" && row.path === "/v2/consumer/workflows");
    const priced = posts.filter((row) => row.whatif === "true");
    const submitted = posts.filter((row) => row.whatif !== "true");
    assert.strictEqual(submitted.length, 1, "exactly one paid submission");
    assert(priced.length >= 1, "the dispatch re-prices before it spends");
    for (const row of priced)
      assert.strictEqual(row.body, submitted[0].body, "THE INVARIANT: the body that was priced is byte-for-byte the body that was sent");
    note("estimate and submit are byte-identical bodies; exactly one paid submission left CineBraid");

    /* The row, before anything came back. */
    let job = kit.jobs()[0];
    assert.strictEqual(job.status, "IN_QUEUE", "unassigned at Civitai maps to IN_QUEUE");
    assert.strictEqual(job.provider, "Civitai");
    assert.strictEqual(job.backendId, "civitai");
    assert(job.externalId.startsWith("wf_"), "the workflow id is stored where providerRequestId() reads it");
    assert.strictEqual(job.paidPermitId, run.permit.body.paidPermitId, "the ledger row names the permit it redeemed");
    assert.strictEqual(job.accounting.estimate.unit, "buzz");
    assert.strictEqual(job.accounting.estimate.amount, 10);
    assert.strictEqual(job.accounting.estimate.confidence, "quoted");
    assert.strictEqual(job.accounting.costClass, "metered_credits");
    assert(job.accounting.estimate.quotedAt, "a quoted cost must record when it was quoted");
    assert.strictEqual(job.civitai.accountConnectionId, CONNECTION_ID, "provenance records which account paid");
    assert.strictEqual(job.civitai.resource.air, AIR);
    assert.strictEqual(job.civitai.resource.versionId, "128078");
    assert(job.civitai.requestFingerprint, "the delivery is tied to the request that was authorized");
    assert.strictEqual(job.contract.routing.accountConnectionId, CONNECTION_ID);
    assert.strictEqual(job.contract.routing.resolved.costClass, "metered_credits");

    /* THE PERMIT IS SPENT. */
    assert.strictEqual(kit.permits().length, 0, "a redeemed permit is dropped from the store");
    const replay = await kit.call("/api/generation/civitai/jobs", {
      method: "POST",
      body: { ...FRAME, requestId: run.quote.body.requestId, fingerprint: run.quote.body.fingerprint, paidPermitId: run.permit.body.paidPermitId, authorizedAmount: 10 },
    });
    assert.strictEqual(replay.status, 409);
    assert.strictEqual(replay.body.code, "PAID_PERMIT_ALREADY_REDEEMED", "a permit is single-use, and the replay is told the truth from the ledger");
    assert.strictEqual(mock.state.workflows.size, 1, "the replay submitted nothing");
    note("one permit, one submission; a replay is refused from the ledger and spends nothing");

    /* =====================================================================
       3. QUEUED → RUNNING → SUCCEEDED-BUT-UNDELIVERED → DELIVERED. */
    mock.state.nextStatus = "processing";
    let refreshed = await kit.call(`/api/generation/civitai/jobs/${job.id}/refresh`, { method: "POST", body: {} });
    assert.strictEqual(refreshed.body.job.status, "IN_PROGRESS", "processing maps to IN_PROGRESS");
    assert.strictEqual(kit.takes().length, 0);

    mock.state.nextStatus = "succeeded";
    mock.state.blobBroken = true;
    refreshed = await kit.call(`/api/generation/civitai/jobs/${job.id}/refresh`, { method: "POST", body: {} });
    job = refreshed.body.job;
    assert.strictEqual(job.status, "UNRESOLVED", "a remote success CineBraid could not materialize is not COMPLETED and is not FAILED");
    assert.strictEqual(job.ingestedAt, "", "nothing was delivered, so nothing claims delivery");
    assert(job.civitai.materializationFailedAt, "the record says the bytes were not collected");
    assert.strictEqual(job.civitai.remoteStatus, "succeeded", "the remote success is retained");
    assert.strictEqual(kit.takes().length, 0, "no candidate is written for a delivery that did not happen");
    assert.strictEqual(mock.state.workflows.size, 1, "a materialization failure never resubmits and never pays twice");
    note("succeeded-but-unmaterialized records UNRESOLVED with the remote success kept, and does not resubmit");

    /* RECOVERY. A fresh signed URL is obtained by re-reading the workflow, which is only
       possible because what was kept is the workflow id and not the expiring URL. */
    mock.state.blobBroken = false;
    refreshed = await kit.call(`/api/generation/civitai/jobs/${job.id}/refresh`, { method: "POST", body: {} });
    job = refreshed.body.job;
    assert.strictEqual(job.status, "COMPLETED");
    assert(job.ingestedAt, "delivery is stamped only once bytes are on disk");
    assert.strictEqual(job.civitai.materializationFailedAt, "", "the earlier failure is cleared by the successful collection");
    assert.strictEqual(mock.state.workflows.size, 1, "recovery collected the SAME workflow; nothing was paid for twice");
    note("recovery re-reads the workflow, gets a fresh URL and delivers — no second submission");

    /* =====================================================================
       4. THE CANDIDATE, ON THE EXACT SHOT, UNREVIEWED. */
    const takes = kit.takes();
    assert.strictEqual(takes.length, 1, "one output, one file");
    assert(/^SC-01-01_FRAME_A_CIVITAI_1\.png$/.test(takes[0]), `unexpected filename: ${takes[0]}`);
    const shot = kit.project().shots.find((row) => row.id === "SC-01-01");
    assert.strictEqual(shot.candidateFiles.length, 1);
    const candidate = shot.candidateFiles[0];
    assert.strictEqual(candidate.decision, "unreviewed", "NOTHING IS APPROVED BY ARRIVING");
    assert.strictEqual(candidate.frameId, "F1", "it landed on the exact originating frame");
    assert.strictEqual(candidate.generationProvider, "Civitai");
    assert.strictEqual(candidate.generationJobId, job.id);
    assert.strictEqual(candidate.generationRequestId, job.externalId, "the candidate carries the workflow id as its request id");
    assert.strictEqual(candidate.sourceBuildId, "build-1");
    assert.strictEqual(shot.reviewStatus, "PENDING", "the shot owes a person a look");
    assert.strictEqual(shot.workflowStatus, "IN PROGRESS");
    assert.strictEqual(shot.winner, undefined, "generation success is not approval");
    assert(!shot.canon, "nothing became Canon by generating");
    assert.strictEqual(fs.readFileSync(path.join(kit.projectsRoot, "film-a", "shots", "SC-01-01", "takes", takes[0])).length, PNG.length);
    note("the result is an unreviewed candidate on the exact shot and frame; nothing approved, nothing Canon");

    /* THE PROVENANCE A FILMMAKER READS, through the shipped provider-generic reader and
       its real public entry point. Nothing in it has learned a Civitai word: it resolves
       provider, model, request id and cost from the same candidate-row fields fal and
       ComfyUI write, which is why a returned Civitai result appears in the Results and
       Candidate Review surfaces without either of them being told about Civitai. */
    const Media = require(path.join(ROOT, "public", "shared-production-media.js"));
    /* The scan the server hands this projection is a directory listing, so the suite
       builds one from the takes actually on disk rather than from the project document —
       which is the point: the record and the bytes are reconciled, not assumed. */
    const scan = { shots: { "SC-01-01": { takes: takes.map((name) => ({ name, url: `/assets/shots/SC-01-01/takes/${name}` })) } } };
    const projected = Media.productionMediaRecords({ project: kit.project(), scan, jobs: kit.jobs(), jobsAvailable: true });
    const mediaRow = projected.records.find((row) => String(row.key || "").endsWith(takes[0]));
    assert(mediaRow, `the shipped media projection must carry the returned candidate; saw ${projected.records.length} records`);
    const provenance = mediaRow.provenance;
    assert.strictEqual(provenance.provider.value, "Civitai");
    assert.strictEqual(provenance.requestId.value, job.externalId, "the workflow id is the request identity a reader sees");
    assert.strictEqual(provenance.cost.state, "priced");
    assert.strictEqual(provenance.cost.currency, "buzz", "BUZZ IS RECORDED AS BUZZ — never dollars");
    assert.strictEqual(provenance.cost.amount, 10);
    assert.strictEqual(provenance.cost.confidence, "quoted", "the provider priced this job, and the record says so");
    assert.strictEqual(mediaRow.disposition.role, "candidate", "it is a candidate awaiting review, not an approval");
    note("the shipped provider-generic media projection reports Civitai, 10 buzz, quoted — with no Civitai branch");

    /* Buzz never enters the US dollar total. */
    const { summarizeRecordedCost } = require(path.join(ROOT, "generation-cost.js"));
    const summary = summarizeRecordedCost(kit.jobs());
    assert.strictEqual(summary.amount, 0, "a Buzz job contributes nothing to the US dollar total");
    assert.deepStrictEqual(summary.otherUnits, [{ unit: "buzz", amount: 10, priced: 1 }]);
    note("summarizeRecordedCost keeps Buzz out of the dollar total");
    kit.close();

    /* =====================================================================
       5. THE BINDING: a quote for request A cannot authorize request B. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl });
    const mutations = [
      ["prompt", { prompt: "something else entirely" }],
      ["negative prompt", { negativePrompt: "added after the quote" }],
      ["request identity", { requestId: "civitai-forged" }],
    ];
    for (const [label, change] of mutations) {
      const attempt = await generate(kit, { authorize: change });
      assert.strictEqual(attempt.permit.status, 409, `${label}: authorize must refuse`);
      assert.strictEqual(attempt.permit.body.code, "CIVITAI_REQUEST_CHANGED", `${label}: refused for the right reason`);
      assert.strictEqual(kit.permits().length, 0, `${label}: no permit was minted`);
    }
    /* And the same mutation applied AFTER a valid permit exists — the dispatch boundary's
       own recomputation, which is the one that guards the money. */
    for (const [label, change] of mutations) {
      const before = mock.state.workflows.size;
      const attempt = await generate(kit, { dispatch: change });
      assert.strictEqual(attempt.dispatch.status, 409, `${label} after authorization: dispatch must refuse`);
      assert.strictEqual(attempt.dispatch.body.code, "CIVITAI_REQUEST_CHANGED");
      assert.strictEqual(attempt.dispatch.body.paidRequestSubmitted, false);
      assert.strictEqual(mock.state.workflows.size, before, `${label} after authorization: nothing was submitted`);
    }
    note("prompt, negative-prompt and identity mutations are refused at authorize AND at dispatch; nothing submitted");

    /* A MODEL SWAP is the same defect through a different door: change the configured
       resource between the quote and the dispatch and the digest no longer matches. */
    {
      const quoted = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
      const permit = await kit.call("/api/generation/civitai/authorize", { method: "POST", body: { ...FRAME, requestId: quoted.body.requestId, fingerprint: quoted.body.fingerprint } });
      kit.Config.writeConfig(kit.Config.mergeConfig(kit.Config.readConfig(), {
        generation: { civitai: { resourceAir: "urn:air:sdxl:checkpoint:civitai:999@888" } },
      }));
      const before = mock.state.workflows.size;
      const attempt = await kit.call("/api/generation/civitai/jobs", {
        method: "POST",
        body: { ...FRAME, requestId: quoted.body.requestId, fingerprint: quoted.body.fingerprint, paidPermitId: permit.body.paidPermitId, authorizedAmount: 10 },
      });
      assert.strictEqual(attempt.status, 409);
      assert.strictEqual(attempt.body.code, "CIVITAI_REQUEST_CHANGED", "a model swapped after the quote is a different purchase");
      assert.strictEqual(mock.state.workflows.size, before);
      kit.Config.writeConfig(kit.Config.mergeConfig(kit.Config.readConfig(), { generation: { civitai: { resourceAir: AIR } } }));
      note("swapping the model between the quote and the dispatch is refused; nothing submitted");
    }

    /* A STALE PERMIT cannot authorize anything, changed or not. */
    {
      const quoted = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
      const permit = await kit.call("/api/generation/civitai/authorize", { method: "POST", body: { ...FRAME, requestId: quoted.body.requestId, fingerprint: quoted.body.fingerprint } });
      const file = path.join(kit.projectsRoot, "film-a", "paid-permits.json");
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const row of stored) row.expiresAt = "2020-01-01T00:00:00.000Z";
      fs.writeFileSync(file, JSON.stringify(stored, null, 2));
      const before = mock.state.workflows.size;
      const attempt = await kit.call("/api/generation/civitai/jobs", {
        method: "POST",
        body: { ...FRAME, requestId: quoted.body.requestId, fingerprint: quoted.body.fingerprint, paidPermitId: permit.body.paidPermitId, authorizedAmount: 10 },
      });
      assert.strictEqual(attempt.body.code, "PAID_PERMIT_EXPIRED");
      assert.strictEqual(mock.state.workflows.size, before, "an expired permit submits nothing");
      fs.writeFileSync(file, "[]");
    }
    /* NO PERMIT AT ALL — and CIVITAI IS NOT CONTACTED AT ALL, not even to re-price.
       The authorization is settled from configuration and the permit store before a
       credential is resolved, so an unauthorized caller cannot cause a token refresh, a
       config write or a single packet to the provider. */
    {
      const seen = mock.state.requests.length;
      const attempt = await kit.call("/api/generation/civitai/jobs", { method: "POST", body: { ...FRAME, requestId: "civitai-x", authorizedAmount: 10 } });
      assert.strictEqual(attempt.body.code, "PAID_PERMIT_REQUIRED");
      assert.strictEqual(attempt.body.providerContacted, false);
      assert.strictEqual(mock.state.requests.length, seen, "a request with no permit reaches Civitai in no way at all");
      note("an expired permit and a missing permit both refuse before Civitai is contacted in any way");
    }

    /* THE PRICE MAY NOT RISE PAST WHAT A PERSON APPROVED. */
    {
      const quoted = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
      const permit = await kit.call("/api/generation/civitai/authorize", { method: "POST", body: { ...FRAME, requestId: quoted.body.requestId, fingerprint: quoted.body.fingerprint } });
      mock.state.cost = 500;
      const before = mock.state.workflows.size;
      const attempt = await kit.call("/api/generation/civitai/jobs", {
        method: "POST",
        body: { ...FRAME, requestId: quoted.body.requestId, fingerprint: quoted.body.fingerprint, paidPermitId: permit.body.paidPermitId, authorizedAmount: 10 },
      });
      assert.strictEqual(attempt.status, 409);
      assert.strictEqual(attempt.body.code, "CIVITAI_QUOTE_INCREASED");
      assert.strictEqual(mock.state.workflows.size, before, "a risen price submits nothing");
      /* AND THE RECORDED AMOUNT IS THE SERVER'S FRESH QUOTE, NEVER THE CALLER'S CLAIM.
         Quoted and approved at 10; the price then FALLS to 4 before the dispatch. A
         falling price is not a reason to refuse a purchase already approved at a higher
         figure — but the number written onto the durable row must be the one Civitai
         gave the server, which is the only arrangement in which the figure a filmmaker
         reads afterwards cannot have come from the wire. */
      mock.state.cost = 10;
      const fallQuote = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
      const fallPermit = await kit.call("/api/generation/civitai/authorize", { method: "POST", body: { ...FRAME, requestId: fallQuote.body.requestId, fingerprint: fallQuote.body.fingerprint } });
      assert.strictEqual(fallQuote.body.cost.amount, 10);
      mock.state.cost = 4;
      const cheaper = await kit.call("/api/generation/civitai/jobs", {
        method: "POST",
        body: { ...FRAME, requestId: fallQuote.body.requestId, fingerprint: fallQuote.body.fingerprint, paidPermitId: fallPermit.body.paidPermitId, authorizedAmount: 10 },
      });
      assert(cheaper.ok, JSON.stringify(cheaper.body));
      assert.strictEqual(kit.jobs().find((row) => row.id === fallQuote.body.requestId).accounting.estimate.amount, 4,
        "the recorded figure is the one the SERVER obtained from Civitai, not the one the caller sent");
      mock.state.cost = 10;
      note("a price that rose past the approved figure refuses; a price that fell is recorded at the server's own fresh quote");
    }
    kit.close();

    /* =====================================================================
       6. THE FOUR WAYS THERE IS NO AUTHORIZATION TO SPEND. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl, enabled: false });
    let refusal = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
    assert.strictEqual(refusal.body.code, "CIVITAI_DISABLED");
    kit.close();

    kit = await makeHarness({ orchestratorUrl: mock.baseUrl, connectionId: "" });
    refusal = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
    assert.strictEqual(refusal.body.code, "CIVITAI_NO_CONNECTION");
    kit.close();

    /* IDENTITY-ONLY REMAINS NON-SPENDING. This is the product promise Settings prints,
       held here as a property: a connection carrying only UserRead cannot reach Civitai
       at all through the paid path. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl, grantedScope: IDENTITY_SCOPE });
    const before = mock.state.requests.length;
    refusal = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
    assert.strictEqual(refusal.status, 403);
    assert.strictEqual(refusal.body.code, "CIVITAI_GENERATION_NOT_AUTHORIZED");
    assert.strictEqual(mock.state.requests.length, before, "an identity-only connection does not even contact Civitai");
    const status = await kit.call("/api/generation/civitai/status");
    assert.strictEqual(status.body.generationAuthorized, false);
    assert.strictEqual(status.body.ready, false);
    assert(/identity only/i.test(status.body.reason), "the refusal names the fix");
    /* And the grants projection says so per connection, as a boolean and never a bitmask. */
    const grants = await kit.call("/api/generation/civitai/grants");
    assert.strictEqual(grants.body.grants[0].generationAuthorized, false);
    /* The bitmask itself never leaves the server. What a browser receives is CineBraid's
       own boolean — checked by the ABSENCE of the field rather than by scanning for the
       digit, which a connection id would satisfy by accident. */
    for (const field of ["grantedScope", "scope", "credential", "accessToken", "apiKey"])
      assert.strictEqual(Object.prototype.hasOwnProperty.call(grants.body.grants[0], field), false,
        `a Civitai grants projection must not carry ${field}`);
    note("an identity-only connection refuses before any provider contact — connecting still spends nothing");
    kit.close();

    /* AN API KEY IS THE BOUNDED FALLBACK. It carries no scope CineBraid can read, so it
       is not blocked by a grant check CineBraid cannot perform. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl, tokenSource: "api_key", grantedScope: "" });
    const keyed = await generate(kit);
    assert(keyed.dispatch.ok, JSON.stringify(keyed.dispatch.body));
    const keyedCall = mock.state.requests.filter((row) => row.path === "/v2/consumer/workflows").pop();
    assert.strictEqual(keyedCall.authorization, `Bearer ${API_KEY}`, "the API key is the bearer, through the same abstraction OAuth uses");
    assert.strictEqual(kit.jobs()[0].civitai.tokenSource, "api_key", "provenance records which credential shape paid");
    note("the API-key fallback works through the same bearerFor abstraction and is recorded as such");
    kit.close();

    /* =====================================================================
       7. PROVIDER REFUSALS, TOLD APART. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl });
    mock.state.script.push("insufficient-buzz");
    refusal = await kit.call("/api/generation/civitai/estimate", { method: "POST", body: FRAME });
    assert.strictEqual(refusal.body.code, "CIVITAI_REQUEST_REFUSED");
    assert(/not enough Buzz/i.test(refusal.body.error) && /spending limit/i.test(refusal.body.error),
      "Civitai cannot tell the two apart, so CineBraid names both rather than guessing");

    /* Insufficient Buzz AT SUBMISSION: the provider answered, so this is FAILED and not
       uncertain — nothing is running and nothing was charged. */
    {
      mock.state.failSubmit = "insufficient-buzz";
      const attempt = await generate(kit);
      mock.state.failSubmit = "";
      assert.strictEqual(attempt.dispatch.ok, false);
      assert.strictEqual(attempt.dispatch.body.code, "CIVITAI_REQUEST_REFUSED");
      assert.strictEqual(attempt.dispatch.body.paidRequestSubmitted, false, "a provider-answered refusal is not uncertain");
      const row = kit.jobs().find((item) => item.id === attempt.quote.body.requestId);
      assert(row, "the durable row exists — it is written before the submission, so a refusal is explainable");
      assert.strictEqual(row.status, "FAILED", "the provider read the request and declined it: FAILED, not UNRESOLVED");
      assert.strictEqual(row.externalId, undefined, "a refused submission has no workflow to track");
      assert(!row.ingestedAt, "nothing was delivered");
      note("an insufficient-Buzz submission records FAILED, with no workflow and no claim of spend");
    }
    kit.close();

    /* UNCERTAINTY. A submission that was sent and never answered may have been accepted
       and may have been charged — it must never look like a failure. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl });
    {
      mock.state.failSubmit = "drop";
      const attempt = await generate(kit);
      mock.state.failSubmit = "";
      assert.strictEqual(attempt.dispatch.ok, false);
      const row = kit.jobs().find((item) => item.id === attempt.quote.body.requestId);
      assert(row, "the durable row exists before the submission, which is what makes a lost answer recoverable at all");
      assert.strictEqual(row.status, "UNRESOLVED", "a request that was sent and never answered is UNCERTAIN, not failed");
      assert.strictEqual(attempt.dispatch.body.paidRequestSubmitted, true, "a lost answer is reported as possibly charged");
      /* AND IT CANNOT BE COLLECTED BLINDLY. Without a workflow id there is nothing to
         read, and the refusal says so rather than resubmitting. */
      const collect = await kit.call(`/api/generation/civitai/jobs/${row.id}/refresh`, { method: "POST", body: {} });
      assert.strictEqual(collect.body.code, "CIVITAI_JOB_UNSUBMITTED");
      assert(/twice/i.test(collect.body.error), "the refusal says why it will not simply try again");
      /* RESTART RECOVERY, on a request that genuinely never arrived: the tag check says
         so honestly rather than inventing a workflow. */
      const found = await kit.call(`/api/generation/civitai/jobs/${row.id}/reconcile`, { method: "POST", body: {} });
      assert.strictEqual(found.body.found, false, "nothing reached Civitai in this case, and the check says so honestly");
      note("a lost submission records UNRESOLVED, reports possible spend, and refuses to resubmit or invent a workflow");
    }
    kit.close();

    /* THE ORPHAN NET, on work that DID reach Civitai. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl });
    {
      const done = await generate(kit);
      const id = done.dispatch.body.job.id;
      /* Simulate the one window CineBraid cannot close alone: the row exists, the answer
         was lost, so externalId is missing even though the workflow is real. */
      const file = path.join(kit.projectsRoot, "film-a", "generation-jobs.json");
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const row of rows) if (row.id === id) { delete row.externalId; row.status = "UNRESOLVED"; }
      fs.writeFileSync(file, JSON.stringify(rows, null, 2));
      const before2 = mock.state.workflows.size;
      const found = await kit.call(`/api/generation/civitai/jobs/${id}/reconcile`, { method: "POST", body: {} });
      assert.strictEqual(found.body.found, true, "the job tag found the paid workflow");
      assert(found.body.job.externalId.startsWith("wf_"), "the workflow id is restored to the ledger");
      assert.strictEqual(mock.state.workflows.size, before2, "recovery submitted nothing");
      /* And from there the ordinary collection path finishes the delivery. */
      const collected = await kit.call(`/api/generation/civitai/jobs/${id}/refresh`, { method: "POST", body: {} });
      assert.strictEqual(collected.body.job.status, "COMPLETED");
      assert.strictEqual(kit.takes().length, 1);
      note("a paid workflow whose answer was lost is recovered by tag and delivered — without a second submission");
    }
    kit.close();

    /* =====================================================================
       8. FAILED, AND A SHOT THAT WENT AWAY. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl });
    {
      const done = await generate(kit);
      mock.state.nextStatus = "failed";
      const failed = await kit.call(`/api/generation/civitai/jobs/${done.dispatch.body.job.id}/refresh`, { method: "POST", body: {} });
      assert.strictEqual(failed.body.job.status, "FAILED");
      assert.strictEqual(kit.takes().length, 0, "a failed generation delivers no candidate");

      /* `expired` IS NOT `failed`, AND NEITHER IS A WORD THIS PRODUCT DOES NOT KNOW.
         Civitai lists expired as terminal, but it means the RESULT expired — the work may
         have run and Buzz may already have been spent. Recording it as a plain failure
         invites the one action that pays twice, so it lands in the state this ledger keeps
         for uncertainty. An unrecognised status takes the same road, for the same reason:
         a word CineBraid has no meaning for is not evidence that nothing happened. */
      for (const remote of ["expired", "some-state-civitai-added-later"]) {
        const another = await generate(kit);
        mock.state.nextStatus = remote;
        const uncertain = await kit.call(`/api/generation/civitai/jobs/${another.dispatch.body.job.id}/refresh`, { method: "POST", body: {} });
        assert.strictEqual(uncertain.body.job.status, "UNRESOLVED", `${remote} must be uncertain, never a plain failure`);
        assert.strictEqual(kit.takes().length, 0);
      }
      mock.state.nextStatus = "succeeded";
      note("expired and unrecognised remote states record UNRESOLVED, never FAILED");
    }
    {
      const done = await generate(kit);
      const project = kit.project();
      project.shots = project.shots.filter((row) => row.id !== "SC-01-01");
      fs.writeFileSync(path.join(kit.projectsRoot, "film-a", "project.json"), JSON.stringify(project, null, 2));
      const orphaned = await kit.call(`/api/generation/civitai/jobs/${done.dispatch.body.job.id}/refresh`, { method: "POST", body: {} });
      assert.strictEqual(orphaned.body.code, "CIVITAI_SHOT_MISSING", "a shot deleted mid-render receives no candidate");
      note("a failed workflow delivers nothing; a deleted shot refuses delivery inside the commit turn");
    }
    kit.close();

    /* =====================================================================
       9. THE LAN BOUNDARY. Every Civitai route answers only this machine, because what a
       LAN caller could otherwise steer here is the operator's own money. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl, bindAll: true });
    const lan = lanAddress();
    if (lan) {
      const routes = [
        ["GET", "/api/generation/civitai/status"],
        ["GET", "/api/generation/civitai/jobs"],
        ["GET", "/api/generation/civitai/grants"],
        ["POST", "/api/generation/civitai/resource"],
        ["POST", "/api/generation/civitai/estimate"],
        ["POST", "/api/generation/civitai/authorize"],
        ["POST", "/api/generation/civitai/jobs"],
        ["POST", "/api/generation/civitai/jobs/anything/refresh"],
        ["POST", "/api/generation/civitai/jobs/anything/reconcile"],
      ];
      const seen = mock.state.requests.length;
      for (const [method, route] of routes) {
        const response = await fetch(`http://${lan}:${kit.port()}${route}`, {
          method,
          /* The two headers a header-reading guard gets wrong. A LAN peer can simply send
             them, and no proxy exists here to make either meaningful. */
          headers: { Host: "localhost", "X-Forwarded-For": "127.0.0.1", "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify(FRAME) : undefined,
        });
        assert.strictEqual(response.status, 403, `${method} ${route} must refuse a non-loopback peer`);
        const body = await response.json();
        assert.strictEqual(body.code, "LOOPBACK_REQUIRED");
        assert.strictEqual(body.paidRequestSubmitted, false);
      }
      assert.strictEqual(mock.state.requests.length, seen, "no LAN request reached Civitai");
      note(`all ${routes.length} Civitai routes refuse a real non-loopback peer, spoofed Host and X-Forwarded-For included`);
    } else {
      note("LAN boundary: skipped — this machine has no non-loopback IPv4 address to test against");
    }
    /* The positive control an over-strict guard gets wrong. */
    const local = await kit.call("/api/generation/civitai/status");
    assert(local.ok, "loopback must still be answered");
    kit.close();

    /* =====================================================================
       10. THE BLOB GUARD. The one address CineBraid does not choose. */
    {
      const Client = require(path.join(ROOT, "civitai-client.js"));
      const refused = (url) => {
        try { Client.assertDownloadableBlobUrl(url); return ""; } catch (error) { return String(error.code || ""); }
      };
      assert.strictEqual(refused("file:///etc/passwd"), "CIVITAI_BLOB_URL_REFUSED");
      assert.strictEqual(refused("https://169.254.169.254/latest/meta-data/"), "CIVITAI_BLOB_URL_REFUSED");
      assert.strictEqual(refused("https://192.168.1.1/admin"), "CIVITAI_BLOB_URL_REFUSED");
      assert.strictEqual(refused("https://10.0.0.5/x"), "CIVITAI_BLOB_URL_REFUSED");
      assert.strictEqual(refused("https://172.16.4.4/x"), "CIVITAI_BLOB_URL_REFUSED");
      assert.strictEqual(refused("not a url"), "CIVITAI_BLOB_URL_INVALID");
      assert.strictEqual(refused("https://blobs.civitai.com/signed.png"), "", "a real signed URL is permitted");
      note("a provider-supplied result address cannot be a file, a private range or a link-local address");
    }

    /* =====================================================================
       11. THE RETURNED-MEDIA REDIRECT, AND RECOVERY OF AN ALREADY-PAID JOB.

       Written from a real paid generation. Civitai served the result as

           GET  /v2/consumer/blobs/<id>?sig=…&exp=…
           301  Location: /v2/consumer/blobs/content/<token>     <- RELATIVE, same origin
           200  image/jpeg

       and fetchBlob() refused every 3xx outright, so a paid result sat undelivered. The
       refusal was conservative in the right direction — nothing lost, nothing claimed,
       the remote identity kept — but it was wrong, and the fix must not become "follow
       redirects". The boundary is now the ORIGIN THE AUTHENTICATED WORKFLOW NAMED. */
    kit = await makeHarness({ orchestratorUrl: mock.baseUrl });
    {
      mock.state.blobMode = "escape-external";
      const paidBefore = mock.state.workflows.size;
      const run = await generate(kit);
      assert(run.dispatch.ok, JSON.stringify(run.dispatch.body));
      const jobId = run.dispatch.body.job.id;
      const paidAfterSubmit = mock.state.workflows.size;
      assert.strictEqual(paidAfterSubmit, paidBefore + 1, "exactly one paid workflow was created");

      /* The failure, reproduced: provider success, collection refused. */
      let refreshed = await kit.call(`/api/generation/civitai/jobs/${jobId}/refresh`, { method: "POST", body: {} });
      let job = refreshed.body.job;
      assert.strictEqual(job.status, "UNRESOLVED", "a refused collection is uncertain, not failed and not delivered");
      assert.strictEqual(job.ingestedAt, "", "nothing may claim delivery");
      assert.strictEqual(job.errorCode, "CIVITAI_BLOB_REDIRECTED");
      assert.strictEqual(job.civitai.remoteStatus, "succeeded", "the provider success is retained");
      assert(job.externalId, "the remote identity is retained, which is what makes recovery possible");
      assert.strictEqual(kit.takes().length, 0);

      /* RECOVERY. The same job, the same remote id, the legitimate redirect this time. */
      const remoteId = job.externalId;
      const paidBeforeRecovery = mock.state.workflows.size;
      mock.state.blobMode = "redirect";
      refreshed = await kit.call(`/api/generation/civitai/jobs/${jobId}/refresh`, { method: "POST", body: {} });
      job = refreshed.body.job;
      assert.strictEqual(job.status, "COMPLETED", "the already-paid job is recovered and delivered");
      assert(job.ingestedAt, "delivery is stamped only once bytes are on disk");
      assert.strictEqual(job.externalId, remoteId, "recovery reused the SAME remote job identity");
      assert.strictEqual(mock.state.workflows.size, paidBeforeRecovery,
        "RECOVERY SUBMITTED NOTHING — no second paid workflow was created");
      assert.strictEqual(kit.takes().length, 1, "the redirected bytes were materialized exactly once");
      const delivered = kit.project().shots.find((row) => row.id === "SC-01-01");
      assert.strictEqual(delivered.candidateFiles.length, 1, "one candidate, not two");
      assert.strictEqual(delivered.candidateFiles[0].decision, "unreviewed");
      assert.strictEqual(job.civitai.materializationFailedAt, "", "the earlier failure is cleared by the successful collection");
      /* A DELIVERED JOB CARRIES NO FAILURE MESSAGE. The shot strip renders job.error
         whenever it is present, so a recovered job that kept its collection error would
         show a filmmaker a delivered candidate beside the reason it had not been
         delivered. Found on the first real recovery. */
      assert.strictEqual(job.error, "", "a recovered, delivered job must not still carry the collection failure message");
      assert.strictEqual(job.errorCode, "", "nor its failure code");

      /* NO CREDENTIAL REACHES THE MEDIA HOST, on the first hop or the redirected one. */
      const blobCalls = mock.state.requests.filter((row) => row.path.startsWith("/blob/"));
      assert(blobCalls.length >= 2, "both the signed address and the redirect target were fetched");
      for (const call of blobCalls)
        assert.strictEqual(call.authorization, "", `a bearer must never be sent to a media address (${call.path})`);
      note("a same-origin 301 delivers, the already-paid job recovers with no second submission, and no bearer reaches the media host");

      /* EVERY WAY OUT OF THE BOUNDARY IS STILL REFUSED — proved on the same paid job, so
         each attempt is also a proof that a refused collection never resubmits. */
      const escapes = [
        ["escape-external", "CIVITAI_BLOB_REDIRECTED", "an arbitrary external host"],
        ["escape-loopback", "CIVITAI_BLOB_REDIRECTED", "a different loopback port"],
        ["escape-private", "CIVITAI_BLOB_URL_REFUSED", "an RFC1918 address"],
        ["escape-linklocal", "CIVITAI_BLOB_URL_REFUSED", "a link-local metadata address"],
        ["escape-scheme", "CIVITAI_BLOB_URL_REFUSED", "a file:// scheme"],
        ["loop", "CIVITAI_BLOB_REDIRECT_DEPTH", "a redirect loop"],
        ["no-location", "CIVITAI_BLOB_REDIRECT_INVALID", "a redirect with no Location"],
      ];
      for (const [mode, expected, what] of escapes) {
        const fresh = await generate(kit);
        const id = fresh.dispatch.body.job.id;
        const created = mock.state.workflows.size;
        mock.state.blobMode = mode;
        const attempt = await kit.call(`/api/generation/civitai/jobs/${id}/refresh`, { method: "POST", body: {} });
        assert.strictEqual(attempt.body.job.status, "UNRESOLVED", `${what}: must not deliver`);
        assert.strictEqual(attempt.body.job.errorCode, expected, `${what}: refused for the right reason`);
        assert.strictEqual(attempt.body.job.ingestedAt, "", `${what}: nothing claims delivery`);
        assert.strictEqual(mock.state.workflows.size, created, `${what}: a refused collection never resubmits`);
      }
      mock.state.blobMode = "direct";
      note(`every way out of the provider's own origin is refused (${escapes.length} routes), and none of them resubmits`);
    }
    kit.close();

    /* =====================================================================
       12. NO REAL PROVIDER WAS CONTACTED, AND NO BUZZ WAS SPENT. */
    assert(mock.baseUrl.startsWith("http://127.0.0.1:"), "the only Civitai this suite can reach is loopback");
    assert.strictEqual(process.env.CINEBRAID_CIVITAI_ORCHESTRATION_BASE, mock.baseUrl);
    for (const row of mock.state.requests)
      assert(!/civitai\.com/i.test(row.path), "no request escaped the fixture");
    note(`${mock.state.workflows.size} fixture workflows created on loopback; 0 real Buzz spent`);

    console.log(["Civitai Foothold V1 integration passed:", ...notes.map((line) => `  - ${line}`)].join("\n"));
  } finally {
    try { kit.close(); } catch { /* already closed */ }
    mock.close();
  }
}

/* This machine's own non-loopback address. Connecting to it produces a genuine
   non-loopback peer without needing a second machine. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const entry of list || [])
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
  return "";
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
/* `MUTATE` is the seam the negative controls install a broken module through. It is null
   here and is set by that suite for the duration of one control — the positive path never
   assigns it, so running this file directly exercises the real modules and nothing else. */
module.exports = { main, makeHarness, startMockOrchestrator, AIR, FRAME, generate, MUTATE: null };

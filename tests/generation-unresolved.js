/* Unresolved paid submissions — a generic generation-safety contract.
 *
 * A paid request can cross the provider boundary and then lose transport before CineBraid
 * learns whether it was accepted. Before this suite existed that landed in FAILED, beside
 * "the provider read it and declined" — and the natural next action after a failure is to
 * press Generate again, which is exactly how one uncertainty becomes two bills.
 *
 * Everything here is about that distinction surviving: in the classifier, in the durable
 * ledger, across a restart, across a project switch, and in what the filmmaker is allowed
 * to do next. H3/fal is the first execution path to exercise it and is not special.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

const { registerFalGeneration } = require("../src/generation/fal/fal-generation");
const Lifecycle = require("../src/generation/generation-lifecycle");
const Contracts = require("../src/generation/generation-contracts");
const { addMotionPromptBuild } = require("./h3-execution-fixture");
const { withGenerationDeclaration } = require("./generation-request-fixture");

const ROOT = path.join(__dirname, "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const MP4 = Buffer.from("00000018667479706d703432000000006d703432", "hex");
const A_PNG = "/assets/shots/SH-1/takes/A.png";

const notes = [];
const note = (line) => notes.push(line);
const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });

function makeProject() {
  return {
    meta: { title: "unresolved", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  };
}

/* One provider, four behaviours, switched per test. */
async function harness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-unresolved-"));
  const dir = path.join(tmp, "project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "A.png"), PNG);
  const file = path.join(dir, "project.json");
  const project = makeProject();
  for (let i = 1; i <= 14; i++) addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: `pkg-${i}`, durationSeconds: 8, references: [] });
  fs.writeFileSync(file, JSON.stringify(project, null, 2));

  let behaviour = "accept";
  const calls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/minimax/h3/text-to-video", "/minimax/h3/image-to-video", "/minimax/h3/reference-to-video", "/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    calls.push({ behaviour, endpoint: req.path });
    if (behaviour === "drop") return req.socket.destroy();
    if (behaviour === "reject") return res.status(422).json({ detail: "the provider declined this prompt" });
    if (behaviour === "server-error") return res.status(503).json({ detail: "capacity" });
    if (behaviour === "opaque") return res.json({ accepted: true });
    const id = `h3-${calls.length}`;
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}`, cancel_url: `${mockOrigin}/cancel/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => res.json({ video: { url: `${mockOrigin}/video/${req.params.id}.mp4`, content_type: "video/mp4" } }));
  mock.get("/video/:name", (req, res) => res.type("video/mp4").send(MP4));
  mock.put("/cancel/:id", (req, res) => res.json({ ok: true }));
  const mockServer = await listen(mock);
  mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

  const SLUG = "unresolved-fixture";
  const config = { generation: { fal: {
    enabled: true, apiKey: "fal-secret-test-key", baseUrl: mockOrigin,
    h3TextModel: "minimax/h3/text-to-video", h3ImageModel: "minimax/h3/image-to-video",
    h3ReferenceModel: "minimax/h3/reference-to-video", h3Resolution: "2K", maxConcurrent: 2,
    textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit",
    frameOutputs: 1, blockingOutputs: 1, frameQuality: "high", blockingQuality: "low",
    frameResolution: "1k", blockingResolution: "1k",
  } } };

  /* Rebuildable: "restart" here means a brand-new server process reading the same
     ledger off disk, which is the only honest way to test durability. */
  const mount = async () => {
    const app = express();
    app.use(express.json({ limit: "8mb" }));
    registerFalGeneration(app, {
      readConfig: () => JSON.parse(JSON.stringify(config)),
      readProject: (slug = SLUG) => {
        if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
        return JSON.parse(fs.readFileSync(file, "utf8"));
      },
      writeProject: (next, slug = SLUG) => {
        if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
        fs.writeFileSync(file, JSON.stringify(next, null, 2));
      },
      activeSlug: () => SLUG,
      projectDirForSlug: (slug) => {
        if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
        return { slug, dir, file };
      },
    });
    const server = await listen(app);
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
  };

  const readLedger = () => {
    const primary = path.join(dir, "generation-jobs.json");
    for (const target of [primary, `${primary}.bak`]) {
      if (!fs.existsSync(target)) continue;
      try { return JSON.parse(fs.readFileSync(target, "utf8")); } catch { /* try the backup */ }
    }
    return [];
  };

  let mounted = await mount();
  const api = async (url, body, method = "POST") => {
    const response = await fetch(`${mounted.origin}${url}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(await withGenerationDeclaration(url, body, { origin: mounted.origin })) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };

  return {
    dir, file, calls,
    api,
    setBehaviour: (value) => { behaviour = value; },
    restart: async () => { mounted.server.close(); mounted = await mount(); },
    /* Reads the ledger the way the store does: primary first, backup when the primary is
       unreadable. The recovery test deliberately leaves a corrupt primary behind, and a
       helper that could not survive that would fail for the wrong reason. */
    ledger: readLedger,
    row: (id) => readLedger().find((r) => r.id === id) || null,
    writeLedger: (rows) => fs.writeFileSync(path.join(dir, "generation-jobs.json"), JSON.stringify(rows, null, 2)),
    close: () => { mockServer.close(); mounted.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

const submit = (h, pkg, extra = {}) => h.api("/api/generation/fal/jobs", {
  purpose: "motion-h3", shotId: "SH-1", sourceBuildId: pkg, profileFamily: "minimax-h3",
  profileMode: "t2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9",
  clientRequestId: `req-${pkg}-${extra.tag || "1"}`, ...extra,
});

async function main() {
  const h = await harness();
  try {
    /* ===================================================================
       1. THE CLASSIFIER — pure, provider-neutral, no model names
       =================================================================== */
    {
      const table = [
        [{ transmitted: false }, "FAILED", false, false, true],
        [{ transmitted: true, httpStatus: null }, "UNRESOLVED", true, false, false],
        [{ transmitted: true, httpStatus: 422 }, "FAILED", true, true, true],
        [{ transmitted: true, httpStatus: 401 }, "FAILED", true, true, true],
        [{ transmitted: true, httpStatus: 429 }, "FAILED", true, true, true],
        [{ transmitted: true, httpStatus: 408 }, "UNRESOLVED", true, true, false],
        [{ transmitted: true, httpStatus: 500 }, "UNRESOLVED", true, true, false],
        [{ transmitted: true, httpStatus: 503 }, "UNRESOLVED", true, true, false],
        [{ transmitted: true, httpStatus: 200 }, "UNRESOLVED", true, true, false],
      ];
      for (const [evidence, status, contacted, answered, authoritative] of table) {
        const v = Lifecycle.classifyProviderFailure(evidence);
        const label = JSON.stringify(evidence);
        assert.strictEqual(v.status, status, `${label} -> ${v.status}`);
        assert.strictEqual(v.providerContacted, contacted, `${label} contacted`);
        assert.strictEqual(v.providerAnswered, answered, `${label} answered`);
        assert.strictEqual(v.authoritative, authoritative, `${label} authoritative`);
      }
      /* The asymmetry is the whole design: uncertainty is never rounded down to a known
         failure, because that is the direction that costs money. */
      const source = fs.readFileSync(path.join(ROOT, "src/generation/generation-lifecycle.js"), "utf8");
      for (const token of ["minimax", "h3", "fal", "seedance", "kling"])
        assert(!new RegExp(`\\b${token}\\b`, "i").test(source.replace(/\/\*[\s\S]*?\*\//g, "")),
          `the lifecycle module must not name ${token} outside its commentary`);
      note(`classifier: ${table.length} evidence shapes classified, and the module names no provider or model in its code`);
    }
    {
      /* The state belongs to the shared contract, not to this module. */
      assert(Contracts.JOB_STATUSES.includes("unresolved"), "the contract carries the state");
      assert(!Contracts.TERMINAL_JOB_STATUSES.includes("unresolved"), "and does not treat it as finished");
      assert.strictEqual(Lifecycle.LEDGER_STATUS_TO_CONTRACT.UNRESOLVED, "unresolved", "the ledger vocabulary maps onto it");
      assert(!Lifecycle.TERMINAL_LEDGER_STATUSES.includes("UNRESOLVED"));
      assert(!Lifecycle.ACTIVE_LEDGER_STATUSES.includes("UNRESOLVED"),
        "unresolved is neither finished nor in flight — which is why it needed its own state");
      note("contract: unresolved lives in the shared GenerationJob vocabulary, non-terminal and non-active");
    }

    /* ===================================================================
       2. THE FOUR SUBMISSION BOUNDARIES
       =================================================================== */
    {
      /* A. Local failure before contact — no row, no POST, no uncertainty. */
      const before = h.calls.length;
      const beforeLedger = h.ledger().length;
      const result = await submit(h, "no-such-package");
      assert.strictEqual(result.status, 404, JSON.stringify(result.data));
      assert.strictEqual(h.calls.length, before, "nothing may reach the provider");
      assert.strictEqual(h.ledger().length, beforeLedger, "and nothing may be written to the ledger");
      assert.notStrictEqual(result.data.code, "GENERATION_UNRESOLVED", "a local refusal is not an uncertainty");
      note("A. local failure before contact: no provider call, no ledger row, not unresolved");
    }
    let rejectedId = "";
    {
      /* B. The provider answered and declined — a KNOWN failure. */
      h.setBehaviour("reject");
      const result = await submit(h, "pkg-2");
      assert.strictEqual(result.status, 502, JSON.stringify(result.data));
      rejectedId = result.data.job.id;
      const row = h.row(rejectedId);
      assert.strictEqual(row.status, "FAILED");
      assert.strictEqual(row.providerContacted, true);
      assert.strictEqual(row.providerAnswered, true);
      assert.strictEqual(result.data.code, undefined, "a known rejection is not flagged as unresolved");
      note("B. provider rejection: FAILED, contacted and answered — a known outcome");
    }
    {
      /* C. The provider accepted — unchanged from before this phase. */
      h.setBehaviour("accept");
      const result = await submit(h, "pkg-3");
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const row = h.row(result.data.job.id);
      assert.strictEqual(row.status, "IN_QUEUE");
      assert(row.externalId, "the provider request id is kept");
      assert(row.statusUrl, "as is the handle to follow it");
      await h.api(`/api/generation/fal/jobs/${row.id}/cancel`);
      note("C. provider acceptance: the existing queued state and its identifiers are unchanged");
    }
    let unresolvedId = "";
    {
      /* D. THE CASE THIS PHASE EXISTS FOR. */
      h.setBehaviour("drop");
      const result = await submit(h, "pkg-4");
      assert.strictEqual(result.status, 502, JSON.stringify(result.data));
      assert.strictEqual(result.data.code, "GENERATION_UNRESOLVED", "the API says which kind of failure this is");
      unresolvedId = result.data.job.id;
      const row = h.row(unresolvedId);
      assert.strictEqual(row.status, "UNRESOLVED");
      assert.strictEqual(row.providerContacted, true, "the request did leave");
      assert.strictEqual(row.providerAnswered, false, "and nothing came back");
      assert(row.unresolvedReason, "the reason is recorded, not only the status");
      assert(row.unresolvedAt, "with when it happened");
      /* Everything needed to go and look. */
      assert.strictEqual(row.model, "minimax/h3/text-to-video", "the endpoint it went to");
      assert.strictEqual(row.backendId, "fal-queue");
      assert.strictEqual(row.shotId, "SH-1");
      assert(row.createdAt);
      assert(row.compilation && row.compilation.plan, "the compiled plan survives");
      assert.strictEqual(row.compilation.plan.compiler.packId, "minimax-h3");
      assert(row.compiledPrompt, "and the exact prompt that was submitted");
      assert.strictEqual(row.prompt, row.compilation.compiledPrompt);
      assert(!JSON.stringify(row).includes("fal-secret-test-key"), "and no provider secret");
      /* The distinction is in the STATE, not only in prose. */
      assert.notStrictEqual(row.status, h.row(rejectedId).status,
        "a possibly-charged submission must not share a status with a known rejection");
      note("D. post-contact transport loss: UNRESOLVED, with endpoint, backend, plan and submitted prompt all durable");
    }

    /* ===================================================================
       3. DURABILITY
       =================================================================== */
    {
      /* Restart: a fresh server process reading the same file. */
      await h.restart();
      const listed = await h.api("/api/generation/fal/jobs", null, "GET");
      const job = listed.data.jobs.find((row) => row.id === unresolvedId);
      assert(job, "the job survives a restart");
      assert.strictEqual(job.status, "UNRESOLVED", "and is not quietly re-read as FAILED");
      assert.strictEqual(job.providerContacted, true);
      assert(job.compilation.plan, "with its provenance intact");
      note("durability: UNRESOLVED survives a process restart and is never re-read as a failure");
    }
    {
      /* Backup recovery: the durable store's own path, exercised by corrupting the
         primary and letting it recover from the .bak Repair B already writes.

         The backup is taken BEFORE the primary is replaced, so it is always one commit
         behind. A later unrelated commit is what rolls UNRESOLVED into it — so that is
         done first, and the assertion is about the recovery path preserving the state,
         not about the backup being impossibly current. */
      h.setBehaviour("accept");
      const filler = await submit(h, "pkg-11");
      await h.api(`/api/generation/fal/jobs/${filler.data.job.id}/cancel`);

      const primary = path.join(h.dir, "generation-jobs.json");
      const backup = `${primary}.bak`;
      assert(fs.existsSync(backup), "the ledger keeps a backup");
      assert(JSON.parse(fs.readFileSync(backup, "utf8")).some((row) => row.id === unresolvedId && row.status === "UNRESOLVED"),
        "the backup has caught up to the unresolved state");
      fs.writeFileSync(primary, "{ not json");
      const listed = await h.api("/api/generation/fal/jobs", null, "GET");
      assert.strictEqual(listed.status, 200, `recovery must succeed: ${JSON.stringify(listed.data)}`);
      const recovered = listed.data.jobs.find((row) => row.id === unresolvedId);
      assert(recovered, "the unresolved job survives ledger recovery");
      assert.strictEqual(recovered.status, "UNRESOLVED");
      assert.strictEqual(recovered.providerContacted, true, "with its provider-contact evidence");
      assert(recovered.compilation.plan, "and its compiled plan");
      note("durability: UNRESOLVED survives recovery of a corrupt ledger from its backup, with evidence and plan intact");
    }
    {
      /* The backup is one commit behind by design, so a recovery CAN land on a row that
         was still SUBMITTING. That is the same uncertainty wearing an in-flight label —
         the process was mid-request when the snapshot was taken and there is no provider
         handle to check with — so it must block a duplicate too. */
      const stranded = {
        id: "stranded-1", provider: "fal", purpose: "motion-h3", kind: "motion-generation",
        shotId: "SH-1", sourceBuildId: "pkg-12", status: "SUBMITTING", externalId: "",
        prompt: "x", references: [], outputs: [], createdAt: "2026-08-09T00:00:00.000Z",
      };
      h.writeLedger([...h.ledger(), stranded]);
      assert.strictEqual(Lifecycle.blocksResubmission(stranded), true);
      assert.strictEqual(Lifecycle.resubmissionBlockReason(stranded), "in-flight-without-handle");
      const before = h.calls.length;
      const retry = await submit(h, "pkg-12", { tag: "stranded" });
      assert.strictEqual(retry.status, 409, JSON.stringify(retry.data));
      assert.strictEqual(retry.data.code, "GENERATION_UNRESOLVED");
      assert.strictEqual(h.calls.length, before, "and no second paid request is sent");
      /* A row that DID get a handle is an ordinary in-flight job and is not blocked here. */
      assert.strictEqual(Lifecycle.blocksResubmission({ ...stranded, externalId: "abc" }), false);
      h.writeLedger(h.ledger().filter((row) => row.id !== "stranded-1"));
      note("durability: a submission stranded mid-flight with no provider handle blocks a duplicate just as UNRESOLVED does");
    }

    /* ===================================================================
       4. DUPLICATE PAID WORK
       =================================================================== */
    {
      h.setBehaviour("accept");
      const before = h.calls.length;
      /* Same package, fresh idempotency key — i.e. the filmmaker pressing Generate again. */
      const retry = await submit(h, "pkg-4", { tag: "retry" });
      assert.strictEqual(retry.status, 409, JSON.stringify(retry.data));
      assert.strictEqual(retry.data.code, "GENERATION_UNRESOLVED");
      assert.strictEqual(retry.data.unresolvedJobId, unresolvedId, "and it points at the job to resolve");
      assert(/may already have been charged/i.test(retry.data.error), "the refusal says why");
      assert.strictEqual(h.calls.length, before, "no second paid request may be sent");
      note("duplicate work: pressing Generate again on an unresolved submission is refused before any POST");
    }
    {
      /* A DIFFERENT generation on the same shot is not blocked — the guard is scoped to
         the submission that is actually unresolved, not to the whole project. */
      h.setBehaviour("accept");
      const other = await submit(h, "pkg-5");
      assert.strictEqual(other.status, 200, JSON.stringify(other.data));
      await h.api(`/api/generation/fal/jobs/${other.data.job.id}/cancel`);
      note("duplicate work: a different package on the same shot still generates — the guard is scoped, not global");
    }
    {
      /* And the unresolved job does NOT eat a concurrency slot. With a cap of one or two,
         holding one forever would deadlock generation for the whole project; blocking the
         specific duplicate is the narrower and more useful guarantee.

         Cleared first: the recovery test above deliberately rolled the ledger back to a
         backup, which can restore rows that were live at that moment. The cap is being
         measured here, so it starts from a known floor. */
      for (const row of h.ledger().filter((item) => Lifecycle.ACTIVE_LEDGER_STATUSES.includes(item.status)))
        await h.api(`/api/generation/fal/jobs/${row.id}/cancel`);
      assert.strictEqual(
        h.ledger().filter((row) => Lifecycle.ACTIVE_LEDGER_STATUSES.includes(row.status)).length, 0,
        "the cap starts empty",
      );
      assert(h.ledger().some((row) => row.status === "UNRESOLVED"), "while an unresolved job is still on the ledger");
      h.setBehaviour("accept");
      const a = await submit(h, "pkg-6");
      const b = await submit(h, "pkg-7");
      assert.strictEqual(a.status, 200, JSON.stringify(a.data));
      assert.strictEqual(b.status, 200, JSON.stringify(b.data));
      await h.api(`/api/generation/fal/jobs/${a.data.job.id}/cancel`);
      await h.api(`/api/generation/fal/jobs/${b.data.job.id}/cancel`);
      note("concurrency: an unresolved job holds no slot — two other generations still run against a cap of two");
    }

    /* ===================================================================
       5. REFRESH / CANCEL WITH NO HANDLE
       =================================================================== */
    {
      const refreshed = await h.api(`/api/generation/fal/jobs/${unresolvedId}/refresh`);
      assert.strictEqual(refreshed.status, 409, JSON.stringify(refreshed.data));
      assert.strictEqual(refreshed.data.code, "GENERATION_UNRESOLVED_NO_HANDLE");
      assert.strictEqual(h.row(unresolvedId).status, "UNRESOLVED", "and the attempt changes nothing");
      const cancelled = await h.api(`/api/generation/fal/jobs/${unresolvedId}/cancel`);
      assert.strictEqual(cancelled.status, 409, JSON.stringify(cancelled.data));
      assert.strictEqual(cancelled.data.code, "GENERATION_UNRESOLVED_NO_HANDLE");
      assert.strictEqual(h.row(unresolvedId).status, "UNRESOLVED",
        "cancelling must not write a confident CANCELLED over a request that may be rendering");
      note("no handle: refresh and cancel both refuse with a typed reason and leave the state alone");
    }

    /* ===================================================================
       6. TRANSITIONS
       =================================================================== */
    {
      /* Stale, non-authoritative writes cannot resolve uncertainty. */
      assert.strictEqual(Lifecycle.nextStatus("UNRESOLVED", "FAILED", {}), "UNRESOLVED");
      assert.strictEqual(Lifecycle.nextStatus("UNRESOLVED", "CANCELLED", {}), "UNRESOLVED");
      /* An authoritative provider answer can. */
      assert.strictEqual(Lifecycle.nextStatus("UNRESOLVED", "COMPLETED", { authoritative: true }), "COMPLETED");
      assert.strictEqual(Lifecycle.nextStatus("UNRESOLVED", "FAILED", { authoritative: true }), "FAILED");
      /* Known outcomes never regress into uncertainty. */
      assert.strictEqual(Lifecycle.nextStatus("COMPLETED", "UNRESOLVED", { authoritative: true }), "COMPLETED");
      assert.strictEqual(Lifecycle.nextStatus("CANCELLED", "UNRESOLVED", { authoritative: true }), "CANCELLED");
      /* Repair B's existing rule is unchanged. */
      assert.strictEqual(Lifecycle.nextStatus("COMPLETED", "IN_QUEUE", { ingested: true }), "COMPLETED");
      assert.strictEqual(Lifecycle.nextStatus("IN_QUEUE", "IN_PROGRESS", {}), "IN_PROGRESS");
      note("transitions: stale writes cannot resolve UNRESOLVED, authoritative ones can, and COMPLETED never regresses");
    }

    /* ===================================================================
       7. RECONCILIATION
       =================================================================== */
    {
      const bad = await h.api(`/api/generation/fal/jobs/${unresolvedId}/reconcile`, { outcome: "probably-fine" });
      assert.strictEqual(bad.status, 400);
      assert.strictEqual(bad.data.code, "GENERATION_RECONCILE_OUTCOME_REQUIRED");
      assert.strictEqual(h.row(unresolvedId).status, "UNRESOLVED");

      const wrongJob = await h.api(`/api/generation/fal/jobs/${rejectedId}/reconcile`, { outcome: "not-accepted" });
      assert.strictEqual(wrongJob.status, 409);
      assert.strictEqual(wrongJob.data.code, "GENERATION_NOT_UNRESOLVED", "only uncertainty can be reconciled");

      const before = h.row(unresolvedId);
      const done = await h.api(`/api/generation/fal/jobs/${unresolvedId}/reconcile`, { outcome: "not-accepted", note: "checked the dashboard" });
      assert.strictEqual(done.status, 200, JSON.stringify(done.data));
      const after = h.row(unresolvedId);
      assert.strictEqual(after.status, "FAILED", "a checked-and-not-accepted job becomes a known failure");
      assert.strictEqual(after.reconciliation.outcome, "not-accepted");
      assert.strictEqual(after.reconciliation.previousStatus, "UNRESOLVED", "and still reads as having been unresolved");
      assert.strictEqual(after.reconciliation.by, "user", "recorded as a human decision");
      assert(after.reconciliation.at, "with when it was made");
      assert.strictEqual(after.reconciliation.note, "checked the dashboard");
      /* Nothing was erased. */
      assert.strictEqual(after.compilation.compiledPrompt, before.compilation.compiledPrompt);
      assert.strictEqual(after.model, before.model, "the endpoint survives reconciliation");
      assert.strictEqual(after.unresolvedReason, before.unresolvedReason, "as does why it was unresolved");
      assert.strictEqual(after.compilation.plan.compiler.packId, "minimax-h3");
      note("reconciliation: an explicit human outcome resolves the job, is recorded with who/when/what, and erases nothing");
    }
    {
      /* Only after reconciliation does the retry become available. */
      h.setBehaviour("accept");
      const retry = await submit(h, "pkg-4", { tag: "after-reconcile" });
      assert.strictEqual(retry.status, 200, `retry must be allowed once reconciled: ${JSON.stringify(retry.data)}`);
      await h.api(`/api/generation/fal/jobs/${retry.data.job.id}/cancel`);
      note("reconciliation: retry becomes possible only after the filmmaker records what they found");
    }

    /* ===================================================================
       8. THE OTHER AMBIGUOUS SHAPES
       =================================================================== */
    {
      /* A 5xx does not establish that the queue never took the job. */
      h.setBehaviour("server-error");
      const result = await submit(h, "pkg-8");
      assert.strictEqual(result.data.code, "GENERATION_UNRESOLVED", JSON.stringify(result.data));
      assert.strictEqual(h.row(result.data.job.id).status, "UNRESOLVED");
      await h.api(`/api/generation/fal/jobs/${result.data.job.id}/reconcile`, { outcome: "not-accepted" });

      /* A success CineBraid cannot identify a job from is not actionable either. */
      h.setBehaviour("opaque");
      const opaque = await submit(h, "pkg-9");
      assert.strictEqual(opaque.data.code, "GENERATION_UNRESOLVED", JSON.stringify(opaque.data));
      const row = h.row(opaque.data.job.id);
      assert.strictEqual(row.status, "UNRESOLVED");
      assert(!row.externalId, "there is no id to follow it by");
      await h.api(`/api/generation/fal/jobs/${row.id}/reconcile`, { outcome: "not-accepted" });
      note("ambiguity: a 5xx and an unidentifiable success are both uncertainty, not known failure");
    }
    {
      /* Reconciled as accepted: an orphan, honestly labelled. CineBraid will not pretend
         it completed and will not invent an id to poll. */
      h.setBehaviour("drop");
      const result = await submit(h, "pkg-10");
      const id = result.data.job.id;
      const reconciled = await h.api(`/api/generation/fal/jobs/${id}/reconcile`, { outcome: "accepted" });
      assert.strictEqual(reconciled.status, 200, JSON.stringify(reconciled.data));
      const row = h.row(id);
      assert.strictEqual(row.status, "ORPHANED", "it ran somewhere CineBraid cannot reach");
      assert.strictEqual(row.reconciliation.outcome, "accepted");
      assert.strictEqual(row.reconciliation.previousStatus, "UNRESOLVED");
      assert(!row.externalId, "and no identifier was fabricated to make it look followable");
      note("reconciliation: 'it was accepted' records an orphan rather than faking a completion or an id");
    }

    /* ===================================================================
       9. PROJECT OWNERSHIP AND OLD LEDGERS
       =================================================================== */
    {
      const rows = h.ledger();
      for (const row of rows.filter((r) => r.status === "UNRESOLVED" || r.reconciliation))
        assert.strictEqual(row.compilation.source.shotId, "SH-1", "an unresolved job stays owned by the project that started it");
      /* An old ledger with none of this metadata still reads, and nothing is inferred
         about it: a historical FAILED stays FAILED. */
      const legacy = { ...rows[0], id: "legacy-1", status: "FAILED", error: "old failure" };
      delete legacy.compilation; delete legacy.providerContacted; delete legacy.providerAnswered;
      delete legacy.unresolvedReason; delete legacy.reconciliation;
      h.writeLedger([...rows, legacy]);
      const listed = await h.api("/api/generation/fal/jobs", null, "GET");
      const seen = listed.data.jobs.find((r) => r.id === "legacy-1");
      assert(seen, "an old job still reads");
      assert.strictEqual(seen.status, "FAILED", "and is never retroactively reclassified as uncertain");
      assert.strictEqual(seen.providerContacted, undefined, "missing metadata is not invented");
      note("compatibility: pre-C1.2 jobs read unchanged; a historical FAILED is never reinterpreted as uncertainty");
    }

    /* ===================================================================
       10. GENERIC, NOT AN H3 FEATURE
       =================================================================== */
    {
      const server = fs.readFileSync(path.join(ROOT, "src/generation/fal/fal-generation.js"), "utf8");
      const body = server.replace(/\/\*[\s\S]*?\*\//g, "");
      /* One provider boundary shared by every dispatch in the module, and no state
         decision that branches on a model. */
      assert.strictEqual((body.match(/await fetch\(`\$\{cfg\.baseUrl\}/g) || []).length, 0,
        "no dispatch may call the provider outside the shared boundary");
      assert((body.match(/providerPost\(/g) || []).length >= 3, "and both submit paths go through it");
      for (const shape of [/minimax[^\n]*UNRESOLVED/i, /UNRESOLVED[^\n]*minimax/i, /h3[^\n]*UNRESOLVED/i])
        assert(!shape.test(body), "the uncertainty state must not be conditioned on a model family");
      note("generic: one shared provider boundary, and no uncertainty rule anywhere branches on a model");
    }
    {
      /* Proved by BEHAVIOUR, not only by reading the source: the plain image path — a
         different endpoint, a different adapter, no GenerationPlan and no model pack —
         produces the same state from the same kind of failure. That is what makes this a
         generation-safety contract rather than an H3 feature. */
      for (const row of h.ledger().filter((item) => Lifecycle.ACTIVE_LEDGER_STATUSES.includes(item.status)))
        await h.api(`/api/generation/fal/jobs/${row.id}/cancel`);
      h.setBehaviour("drop");
      const before = h.calls.length;
      const image = await h.api("/api/generation/fal/jobs", {
        purpose: "frame", shotId: "SH-1", frameId: "frame-a", frameLabel: "A",
        prompt: "A still frame, generated through the image path.", outputCount: 1,
        quality: "high", aspectRatio: "16:9", clientRequestId: "image-drop",
      });
      assert.strictEqual(h.calls.length, before + 1, "the image path reached the provider");
      assert.strictEqual(h.calls[h.calls.length - 1].endpoint, "/openai/gpt-image-2", "on its own endpoint");
      assert.strictEqual(image.data.code, "GENERATION_UNRESOLVED", JSON.stringify(image.data));
      const row = h.row(image.data.job.id);
      assert.strictEqual(row.status, "UNRESOLVED");
      assert.strictEqual(row.providerContacted, true);
      assert.strictEqual(row.providerAnswered, false);
      assert(!row.compilation, "and it has no GenerationPlan — this path never had one");
      /* And the duplicate guard covers it just the same. */
      const retry = await h.api("/api/generation/fal/jobs", {
        purpose: "frame", shotId: "SH-1", frameId: "frame-a", frameLabel: "A",
        prompt: "A still frame, generated through the image path.", outputCount: 1,
        quality: "high", aspectRatio: "16:9", clientRequestId: "image-drop-retry",
      });
      assert.strictEqual(retry.status, 409, JSON.stringify(retry.data));
      assert.strictEqual(retry.data.code, "GENERATION_UNRESOLVED");
      note("generic: the plain image path — no plan, no model pack, another endpoint — produces UNRESOLVED and is duplicate-guarded identically");
    }

    /* =====================================================================
       THE ONE DEFINITION OF UNCERTAIN-WITHOUT-HANDLE.

       Two separate reviews found the same defect in two routes because the question
       "is this submission uncertain" was being asked in different words in each of
       them: the poller asked `isUnresolved && !externalId`, cancel asked
       `isUnresolved && !cancelUrl`, and neither counted a durable `SUBMITTING` row
       with no handle. Each route then wrote a terminal status over a request that
       might already have been paid for, and each of those releases the duplicate
       block.

       This is the state matrix the shared predicate has to get right, asserted
       directly rather than through any one route, so a future consumer can be checked
       against it without rediscovering the two defects. */
    {
      const handled = { externalId: "req-1", statusUrl: "https://provider/status/req-1", responseUrl: "https://provider/result/req-1", cancelUrl: "https://provider/cancel/req-1" };
      const cases = [
        /* The two uncertainties, which is the whole point of the predicate. */
        [{ status: "SUBMITTING" }, true, "a submission still in flight with no handle at all"],
        [{ status: Lifecycle.UNRESOLVED }, true, "a classified unresolved job with no handle at all"],
        /* Everything the reviewer named as OUT. */
        [{ status: "SUBMITTING", ...handled }, false, "SUBMITTING with a valid request id"],
        [{ status: "IN_QUEUE", ...handled }, false, "IN_QUEUE with a provider handle"],
        [{ status: "IN_PROGRESS", ...handled }, false, "an ordinary healthy active job"],
        [{ status: "COMPLETED", ...handled, ingestedAt: "2026-08-28T00:00:00.000Z" }, false, "a completed job"],
        [{ status: "FAILED", error: "the provider declined" }, false, "an ordinary failed job"],
        [{ status: "CANCELLED" }, false, "a cancelled job"],
        [{ status: Lifecycle.UNRESOLVED, reconciliation: { outcome: "not-accepted", previousStatus: Lifecycle.UNRESOLVED } }, false, "a job a person has already settled"],
        [{ status: "FAILED", reconciliation: { outcome: "not-accepted", previousStatus: "SUBMITTING" } }, false, "a settled in-flight submission"],
      ];
      for (const [job, expected, label] of cases) {
        assert.strictEqual(Lifecycle.isSubmissionUncertainWithoutHandle(job), expected,
          `${label} must ${expected ? "" : "NOT "}be uncertain-without-handle: ${JSON.stringify(job)}`);
      }

      /* NARROWING ONLY EVER ADDS JOBS. Each route asks about the handle its own
         operation needs — the poller a request id, cancel a cancel URL — and that must
         never be a way to be MORE permissive than the bare question, or the routes are
         back to disagreeing. Proved over the whole matrix plus the partial rows that
         only a recovered ledger produces. */
      const partials = [
        { status: "UNRESOLVED", externalId: "req-2" },
        { status: "UNRESOLVED", cancelUrl: "https://provider/cancel/req-2" },
        { status: "UNRESOLVED", statusUrl: "https://provider/status/req-2" },
        { status: "SUBMITTING", cancelUrl: "https://provider/cancel/req-2" },
        { status: "SUBMITTING", statusUrl: "https://provider/status/req-2" },
      ];
      for (const job of [...cases.map(([job]) => job), ...partials]) {
        const bare = Lifecycle.isSubmissionUncertainWithoutHandle(job);
        for (const field of Lifecycle.PROVIDER_HANDLE_FIELDS) {
          const narrowed = Lifecycle.isSubmissionUncertainWithoutHandle(job, field);
          assert(!bare || narrowed,
            `narrowing to ${field} must not release a job the bare question calls uncertain: ${JSON.stringify(job)}`);
          assert(!narrowed || Lifecycle.blocksResubmission(job),
            `and it must never fire on a job the lifecycle does not consider uncertain: ${JSON.stringify(job)}`);
        }
      }

      /* THE INVARIANT ITSELF: every job the predicate calls uncertain is one the
         duplicate guard is already holding. A route that refuses on this predicate is
         therefore never refusing work that could legitimately proceed. */
      for (const [job, expected] of cases) {
        if (expected) assert.strictEqual(Lifecycle.blocksResubmission(job), true,
          `an uncertain-without-handle job must block resubmission: ${JSON.stringify(job)}`);
      }
      note("predicate: isSubmissionUncertainWithoutHandle() covers both uncertainties and excludes SUBMITTING-with-id, IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED and reconciled jobs; narrowing to a single handle field can only ADD jobs, never release one, and every job it names is already blocking resubmission");
    }

    console.log(`\nUnresolved paid-submission suite passed:\n  ${notes.join("\n  ")}\n`);
  } finally {
    h.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

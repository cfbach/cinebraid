/* P4-SEM 0a — historical generation cost.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: what a job was estimated to cost is
 * decided once, at submission, and no later edit to Settings can move it.
 *
 * Before this batch `job.accounting` was defined and validated by the generation
 * contract but never written by the dispatch path, so every historical cost surface
 * re-derived spending at render time as `imagesGenerated × today's rate`. Editing one
 * number in Settings silently rewrote what a project had spent. These tests submit
 * real jobs through the real HTTP route against a MOCK provider, change the rate
 * between submissions, and assert the earlier rows do not move.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. `baseUrl` points at a loopback Express
 * server created in this process; every request is counted and its target asserted,
 * so a dispatch that escaped to a real endpoint would show up as a missing mock call
 * rather than passing quietly.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const express = require("express");

const ROOT = path.join(__dirname, "..");
const { registerFalGeneration } = require("../fal-generation");
const { registerAutomationRuns } = require("../automation-runs");
const { submissionAccounting, summarizeRecordedCost, recordedAmount, recordedEstimate, RECORDED_BASIS } = require("../generation-cost");
const { validateCostEstimate } = require("../generation-contracts");
const { declaredRequestInit } = require("./generation-request-fixture");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;
async function json(url, options = {}) {
  /* A suite that posts to the paid route is standing in for a dialog, and a dialog
     declares which surface and view it was. See tests/generation-request-fixture.js. */
  const response = await fetch(url, await declaredRequestInit(url, options));
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
const RUN_ID = "run-cost";
const RUNNER_ID = "runner-cost";
const SLUG = "cost-fixture";

async function harness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-cost-"));
  const projectDir = path.join(tmp, "project");
  fs.mkdirSync(path.join(projectDir, "shots", "S1", "takes"), { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles"]) fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  const projectFile = path.join(projectDir, "project.json");
  fs.writeFileSync(projectFile, JSON.stringify({
    meta: { title: "Cost History", aspectRatio: "16:9" },
    shots: [{ id: "S1", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [], mediaAssets: [],
  }, null, 2));

  const lease = new Date(Date.now() + 30 * 60_000).toISOString();
  fs.writeFileSync(path.join(projectDir, "automation-runs.json"), JSON.stringify({
    schemaVersion: 2,
    runs: [{
      id: RUN_ID, revision: 1, type: "shot-chain", targetId: "S1", scope: "stills", status: "running", label: "Cost run",
      config: { maxImages: 40 }, usage: { imagesGenerated: 0, imageRequests: 0, assistantCalls: 0, reviewCalls: 0 },
      steps: {}, logs: [], runnerId: RUNNER_ID, leaseExpiresAt: lease,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }],
  }, null, 2));

  /* The provider. It is in this process, on loopback, and it counts everything. */
  const providerCalls = [];
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    const id = `img-${providerCalls.length + 1}`;
    providerCalls.push({ endpoint: req.path, body: req.body });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}`, cancel_url: `${mockOrigin}/cancel/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => res.json({ images: [{ url: `${mockOrigin}/image/${req.params.id}.png`, width: 1, height: 1 }] }));
  mock.get("/image/:name", (req, res) => res.type("png").send(PNG));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  /* Mutable on purpose: changing this between submissions IS the experiment. */
  const config = {
    generation: {
      fal: {
        enabled: true, apiKey: "fal-test-key", baseUrl: mockOrigin,
        textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit",
        blockingOutputs: 1, frameOutputs: 2, blockingQuality: "low", frameQuality: "high",
        blockingResolution: "1k", frameResolution: "1k", maxConcurrent: 2,
        requireConfirmation: true, estimatedCostPerImage: 0,
      },
    },
  };

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerFalGeneration(app, {
    readConfig: () => JSON.parse(JSON.stringify(config)),
    readProject: (slug = SLUG) => { if (slug !== SLUG) throw new Error(`No such project: ${slug}`); return JSON.parse(fs.readFileSync(projectFile, "utf8")); },
    writeProject: (project, slug = SLUG) => { if (slug !== SLUG) throw new Error(`No such project: ${slug}`); fs.writeFileSync(projectFile, JSON.stringify(project, null, 2)); },
    activeSlug: () => SLUG,
    projectDirForSlug: (slug) => { if (slug !== SLUG) throw new Error(`No such project: ${slug}`); return { slug, dir: projectDir, file: projectFile }; },
  });
  registerAutomationRuns(app, {
    projectDir: () => projectDir,
    readProject: () => JSON.parse(fs.readFileSync(projectFile, "utf8")),
    activeSlug: () => SLUG,
    projectReadinessIssues: () => [],
  });
  const appServer = await listen(app);

  return {
    origin: originOf(appServer),
    mockOrigin,
    projectDir,
    config,
    providerCalls,
    ledgerFile: path.join(projectDir, "generation-jobs.json"),
    ledger: () => JSON.parse(fs.readFileSync(path.join(projectDir, "generation-jobs.json"), "utf8")),
    setRate: (value) => { config.generation.fal.estimatedCostPerImage = value; },
    close: () => { appServer.close(); mockServer.close(); },
  };
}

/* One paid-shaped submission, then driven to completion so the next one has a slot.
   Completion matters for its own reason too: the estimate has to survive ingest. */
async function submitFrame(kit, { outputCount, stepKey }) {
  const submit = await json(`${kit.origin}/api/generation/fal/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      purpose: "frame", shotId: "S1", frameId: `frame-${stepKey}`, frameLabel: "A",
      prompt: "A quiet galley at night, sodium practicals.", outputCount,
      aspectRatio: "16:9", sourceBuildId: "build-1",
      automationRunId: RUN_ID, automationStepKey: stepKey, automationRunnerId: RUNNER_ID,
    }),
  });
  assert(submit.response.ok, `submit ${stepKey} failed: ${JSON.stringify(submit.data)}`);
  const id = submit.data.job.id;
  const refresh = await json(`${kit.origin}/api/generation/fal/jobs/${id}/refresh`, { method: "POST" });
  assert(refresh.response.ok, `refresh ${stepKey} failed: ${JSON.stringify(refresh.data)}`);
  return id;
}

const usd = (value) => Math.round(Number(value) * 1e6) / 1e6;

/* Negative controls only. A control that reintroduces a defect into a BROWSER script
   installs the patched source here, because no require.cache entry exists to swap for
   a file the browser loads by tag. Empty in every normal run, so the assertions below
   read the real public/reports.js off disk. */
const SOURCE_OVERRIDES = new Map();
function readSource(relative) {
  return SOURCE_OVERRIDES.has(relative)
    ? SOURCE_OVERRIDES.get(relative)
    : fs.readFileSync(path.join(ROOT, relative), "utf8");
}

/* public/reports.js is a browser script. Evaluated in a sandbox with the helpers it
   needs, so the rendered wording is asserted against the real source rather than a
   paraphrase of it. */
function reportsSandbox() {
  const context = {
    console,
    window: {},
    /* Deliberately loud. The correct renderer never consults this, so a figure
       derived from 9.99 appearing on screen is itself the regression. */
    CONFIG: { generation: { fal: { estimatedCostPerImage: 9.99 } } },
    esc: (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    attr: (value) => String(value ?? "").replace(/"/g, "&quot;"),
    plural: (n, one, many) => `${n} ${Number(n) === 1 ? one : (many || `${one}s`)}`,
  };
  vm.createContext(context);
  vm.runInContext(readSource(path.join("public", "reports.js")), context, { filename: "reports.js" });
  assert.strictEqual(typeof context.reportsRecordedCostMarkup, "function", "reports.js must expose the recorded-cost renderer");
  return context;
}

async function main() {
  const kit = await harness();
  try {
    /* ---------------------------------------------------------------------
       CASE 2 (first half) — a job is estimated at the rate in effect when it
       is submitted. Job A: 2 images at $0.06 = $0.12. */
    kit.setRate(0.06);
    const jobA = await submitFrame(kit, { outputCount: 2, stepKey: "step-a" });

    const afterA = kit.ledger().find((job) => job.id === jobA);
    assert(afterA, "job A must be in the durable ledger");
    assert(afterA.accounting, "a submitted job must carry accounting");
    assert.strictEqual(afterA.accounting.estimate.confidence, "estimated");
    assert.strictEqual(usd(afterA.accounting.estimate.amount), 0.12, "job A must be estimated at 2 x $0.06");
    assert.strictEqual(afterA.accounting.estimate.costClass, "metered_api");
    assert.strictEqual(afterA.accounting.estimate.unit, "usd");
    assert.strictEqual(afterA.accounting.basis.quantity, 2);
    assert.strictEqual(afterA.accounting.basis.ratePerUnit, 0.06);
    /* The stored estimate must satisfy the contract that already existed, rather
       than a second cost shape invented for this batch. */
    const contractA = validateCostEstimate(afterA.accounting.estimate);
    assert(contractA.ok, `job A estimate must satisfy validateCostEstimate: ${JSON.stringify(contractA.errors)}`);

    /* ---------------------------------------------------------------------
       CASE 1 — THE CENTRAL ONE. Settings changes; job A does not.
       Today's calculation for job A would now be 2 x $0.24 = $0.48. */
    kit.setRate(0.24);
    const jobAAfterSettingsChange = kit.ledger().find((job) => job.id === jobA);
    assert.strictEqual(usd(jobAAfterSettingsChange.accounting.estimate.amount), 0.12,
      "CASE 1: changing the Settings rate must not move an already-recorded job estimate");
    assert.strictEqual(jobAAfterSettingsChange.accounting.basis.ratePerUnit, 0.06,
      "CASE 1: the recorded rate is the one that was in effect at submission");

    /* ---------------------------------------------------------------------
       CASE 2 (second half) — the NEXT job uses the NEW rate.
       Job B: 4 images at $0.12 = $0.48. Total $0.60, not 6 x anything. */
    kit.setRate(0.12);
    const jobB = await submitFrame(kit, { outputCount: 4, stepKey: "step-b" });
    const afterB = kit.ledger().find((job) => job.id === jobB);
    assert.strictEqual(usd(afterB.accounting.estimate.amount), 0.48, "job B must be estimated at 4 x $0.12");
    assert.strictEqual(usd(kit.ledger().find((job) => job.id === jobA).accounting.estimate.amount), 0.12,
      "CASE 2: job A keeps its own estimate while job B is priced at the newer rate");

    const twoJobs = summarizeRecordedCost(kit.ledger());
    assert.strictEqual(usd(twoJobs.amount), 0.6, "CASE 2: the total is 0.12 + 0.48, not both jobs at one rate");
    assert.strictEqual(twoJobs.priced, 2);
    assert.strictEqual(twoJobs.unrecorded, 0);

    /* ---------------------------------------------------------------------
       CASE 3 — quantity belongs to the submitted job, not to a current setting.
       Job C: 4 images at the SAME $0.06 job A used, so only the quantity differs
       and the amount must double rather than track any Settings value. */
    kit.setRate(0.06);
    const jobC = await submitFrame(kit, { outputCount: 4, stepKey: "step-c" });
    const afterC = kit.ledger().find((job) => job.id === jobC);
    assert.strictEqual(afterC.accounting.basis.quantity, 4);
    assert.strictEqual(usd(afterC.accounting.estimate.amount), 0.24,
      "CASE 3: same rate, double the images, double the estimate");
    assert.strictEqual(usd(afterC.accounting.estimate.amount), usd(afterA.accounting.estimate.amount * 2),
      "CASE 3: the estimate scales with the job's own quantity");

    /* And every one of the three still holds its own number after one more edit. */
    kit.setRate(9.99);
    const settled = Object.fromEntries(kit.ledger().map((job) => [job.id, usd(job.accounting?.estimate?.amount)]));
    assert.deepStrictEqual(settled, { [jobA]: 0.12, [jobB]: 0.48, [jobC]: 0.24 },
      "CASE 1/2/3: three jobs, three rates, none of them moved when Settings did");

    /* ---------------------------------------------------------------------
       CASE 1 THROUGH THE REPORTS READ PATH — the surface, not just the ledger.
       The rate is currently $9.99; a recomputing Reports would say 10 images x
       $9.99 = $99.90. */
    const summary = await json(`${kit.origin}/api/automation/reports/summary`);
    assert(summary.response.ok, JSON.stringify(summary.data));
    const totals = summary.data.summary?.totals || summary.data.totals;
    assert(totals?.recordedCost, "the reports summary must carry a recorded-cost block");
    assert.strictEqual(usd(totals.recordedCost.amount), 0.84,
      "CASE 1: Reports totals 0.12 + 0.48 + 0.24 from the stored estimates, not 10 images at today's rate");
    assert.strictEqual(totals.recordedCost.priced, 3);
    assert.strictEqual(totals.recordedCost.unrecorded, 0);
    assert.strictEqual(totals.recordedCost.complete, true);
    assert.strictEqual(totals.recordedCost.basis, RECORDED_BASIS);

    /* A job reachable from two runs is one paid request and must be counted once.
       A run claims a job either by automationRunId or through a step's childJobId,
       so a second run pointing a step at job A puts it in both lists. */
    const runsFile = path.join(kit.projectDir, "automation-runs.json");
    const runsDoc = JSON.parse(fs.readFileSync(runsFile, "utf8"));
    runsDoc.runs.push({
      id: "run-cost-second", revision: 1, type: "shot-chain", targetId: "S1", scope: "stills", status: "completed",
      config: { maxImages: 40 }, usage: { imagesGenerated: 0, imageRequests: 0, assistantCalls: 0, reviewCalls: 0 },
      steps: { "generation:1": { key: "generation:1", label: "Reused", kind: "generation", status: "completed", childJobId: jobA } },
      logs: [], runnerId: RUNNER_ID, leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    fs.writeFileSync(runsFile, JSON.stringify(runsDoc, null, 2));
    const shared = await json(`${kit.origin}/api/automation/reports/summary`);
    const sharedTotals = shared.data.summary?.totals || shared.data.totals;
    assert.strictEqual(usd(sharedTotals.recordedCost.amount), 0.84,
      "a job claimed by two runs is one paid request and must not be added to the total twice");
    assert.strictEqual(sharedTotals.recordedCost.jobs, 3, "and it must be counted once in the population too");

    /* ---------------------------------------------------------------------
       CASE 5 — an estimate stays an estimate.
       Nothing in the record or on the screen may present these as money the
       provider confirmed charging, because CineBraid is never told that. */
    for (const job of kit.ledger()) {
      assert.strictEqual(job.accounting.estimate.confidence, "estimated",
        "CASE 5: fal does not quote at submission, so nothing may claim it did");
      const record = JSON.stringify(job.accounting).toLowerCase();
      for (const word of ["actualcost", "\"actual\"", "charged", "invoice", "billed"])
        assert(!record.includes(word), `CASE 5: the accounting record must not imply confirmed spend (found ${word})`);
    }
    const reports = reportsSandbox();
    const pricedMarkup = reports.reportsRecordedCostMarkup(totals.recordedCost);
    assert(pricedMarkup.includes("$0.84"), "the recorded total must be rendered");
    assert(!pricedMarkup.includes("9.99") && !pricedMarkup.includes("99.90"),
      "CASE 1: the renderer must not consult the current Settings rate at all");
    assert(/not provider billing/i.test(pricedMarkup), "CASE 5: the surface must say this is not provider billing");
    assert(/Estimated when submitted/i.test(pricedMarkup), "CASE 5: the surface must date the estimate to submission");
    for (const word of ["Actual", "Confirmed spend", "Charged", "Invoiced"])
      assert(!pricedMarkup.includes(word), `CASE 5: the surface must not use "${word}"`);

    /* ---------------------------------------------------------------------
       CASE 4 — a legacy job with no recorded estimate.
       No crash, no fabricated history, no silent mutation, and a deterministic
       "not recorded" rather than $0.00 or today's rate applied backwards. */
    const legacy = { id: "legacy-job-1", provider: "fal", purpose: "frame", shotId: "S1", outputCount: 3, status: "COMPLETED", createdAt: "2026-01-01T00:00:00.000Z", outputs: [] };
    const withLegacy = [...kit.ledger(), legacy];
    fs.writeFileSync(kit.ledgerFile, JSON.stringify(withLegacy, null, 2));
    const beforeRead = fs.readFileSync(kit.ledgerFile, "utf8");

    assert.strictEqual(recordedEstimate(legacy), null, "CASE 4: a legacy job has no estimate to read");
    assert.strictEqual(recordedAmount(legacy), null, "CASE 4: absent is not zero");

    const mixed = summarizeRecordedCost(withLegacy);
    assert.strictEqual(mixed.unrecorded, 1, "CASE 4: the legacy job is counted as unrecorded");
    assert.strictEqual(mixed.priced, 3);
    assert.strictEqual(usd(mixed.amount), 0.84, "CASE 4: the legacy job adds nothing rather than being re-priced");
    assert.strictEqual(mixed.complete, false, "CASE 4: a total with a gap must not present itself as complete");

    /* Reading it through the live surface must not write to it. */
    const legacySummary = await json(`${kit.origin}/api/automation/reports/summary`);
    assert(legacySummary.response.ok);
    const legacyReport = await json(`${kit.origin}/api/automation/runs/${RUN_ID}/report`);
    assert(legacyReport.response.ok, JSON.stringify(legacyReport.data));
    assert(legacyReport.data.report.recordedCost, "the run report must carry recorded cost");
    assert.strictEqual(fs.readFileSync(kit.ledgerFile, "utf8"), beforeRead,
      "CASE 4: opening a project must not backfill a historical estimate onto an old job");

    /* A ledger of nothing but legacy rows must say "Not recorded" — never $0.00. */
    const legacyOnly = reports.reportsRecordedCostMarkup(summarizeRecordedCost([legacy, { ...legacy, id: "legacy-job-2" }]));
    assert(legacyOnly.includes("Not recorded"), "CASE 4: an all-legacy history reads as not recorded");
    assert(!legacyOnly.includes("$0.00"), "CASE 4: an all-legacy history must never render a confident $0.00");
    assert(/predate/.test(legacyOnly), "CASE 4: the surface must say why the figure is missing");

    /* An empty history renders nothing at all rather than a zero. */
    assert.strictEqual(reports.reportsRecordedCostMarkup(summarizeRecordedCost([])), "");
    assert.strictEqual(reports.reportsRecordedCostMarkup(null), "");

    /* ---------------------------------------------------------------------
       Unpriced-but-recorded: the project that never filled the rate in.
       This is the population that used to report a confident $0.00. */
    const unpriced = submissionAccounting({ purpose: "frame", outputCount: 4, ratePerImage: 0, at: "2026-08-10T00:00:00.000Z" });
    assert.strictEqual(unpriced.estimate.confidence, "unknown");
    assert.strictEqual(unpriced.estimate.amount, undefined, "an unknown cost must not carry an amount");
    assert(validateCostEstimate(unpriced.estimate).ok, "the unpriced estimate must still satisfy the contract");
    assert.strictEqual(recordedAmount({ accounting: unpriced }), null, "unknown is not zero");
    const unpricedSummary = summarizeRecordedCost([{ accounting: unpriced }]);
    assert.strictEqual(unpricedSummary.unpriced, 1);
    assert.strictEqual(unpricedSummary.amount, 0);
    assert.strictEqual(unpricedSummary.complete, false);
    const unpricedMarkup = reports.reportsRecordedCostMarkup(unpricedSummary);
    assert(unpricedMarkup.includes("Not recorded"), "no configured rate must not render as $0.00");
    assert(/no rate configured/.test(unpricedMarkup));

    /* ---------------------------------------------------------------------
       CASE 6 — ONE LEDGER, MORE THAN ONE CURRENCY, AND THEY ARE NEVER ADDED.

       There is one generation ledger per project and every backend writes into it, so a
       Buzz-priced hosted render and a USD-priced hosted render can sit side by side.
       Before this case the summary summed `amount` over all of them and labelled the
       result `currency: "usd"`, which turned a ten-Buzz generation into USD 10.00 on the
       automation report. CineBraid holds no exchange rate and must not invent one. */
    const buzzJob = {
      accounting: {
        costClass: "metered_credits",
        estimate: { costClass: "metered_credits", unit: "buzz", amount: 10, confidence: "quoted", quotedAt: "2026-09-05T00:00:00.000Z" },
        recordedAt: "2026-09-05T00:00:00.000Z",
      },
    };
    assert(validateCostEstimate(buzzJob.accounting.estimate).ok, "a quoted Buzz cost must satisfy the shipped contract unchanged");

    const buzzOnly = summarizeRecordedCost([buzzJob]);
    assert.strictEqual(buzzOnly.amount, 0, "CASE 6: a Buzz amount must never land in the US dollar total");
    assert.deepStrictEqual(buzzOnly.otherUnits, [{ unit: "buzz", amount: 10, priced: 1 }],
      "CASE 6: Buzz is reported under its own name with its own count");
    assert.strictEqual(buzzOnly.priced, 1, "CASE 6: a quoted Buzz job is still a priced job");
    const buzzMarkup = reports.reportsRecordedCostMarkup(buzzOnly);
    assert(buzzMarkup.includes("10 BUZZ"), "CASE 6: the surface names the currency it is reporting");
    assert(!buzzMarkup.includes("$10"), "CASE 6: 10 Buzz must never be rendered as ten dollars");
    assert(!buzzMarkup.includes("$0.00"), "CASE 6: a Buzz-only history must not report a confident zero in dollars");

    /* Mixed. Built from explicit rows rather than from the live ledger, which by this
       point carries CASE 4's legacy job and would make `complete` false for a reason
       that has nothing to do with currency.

       The dollar total is exactly the dollars, and the Buzz is beside it rather than
       inside it. `complete` is false because a dollar figure is not the whole story once
       money was also spent in another currency — which is the one question `complete`
       exists to answer. */
    const usdJob = {
      accounting: {
        costClass: "metered_api",
        estimate: { costClass: "metered_api", unit: "usd", amount: 0.84, confidence: "estimated" },
      },
    };
    const mixedCurrency = summarizeRecordedCost([usdJob, buzzJob]);
    assert.strictEqual(usd(mixedCurrency.amount), 0.84, "CASE 6: the US dollar total is unchanged by the presence of a Buzz job");
    assert.deepStrictEqual(mixedCurrency.otherUnits, [{ unit: "buzz", amount: 10, priced: 1 }]);
    assert.strictEqual(mixedCurrency.priced, 2);
    assert.strictEqual(mixedCurrency.complete, false, "CASE 6: a dollar total is not complete when Buzz was also spent");
    const mixedMarkup = reports.reportsRecordedCostMarkup(mixedCurrency);
    assert(mixedMarkup.includes("$0.84") && mixedMarkup.includes("10 BUZZ"), "CASE 6: both figures are shown, separately");
    assert(/never added together/.test(mixedMarkup), "CASE 6: the surface says why there are two figures");

    /* A legacy row that recorded an amount before `unit` existed is still US dollars.
       Every amount CineBraid has ever recorded was one, and moving history into an
       unknown bucket would make every pre-existing project read as incomplete. */
    const unitless = { accounting: { costClass: "metered_api", estimate: { costClass: "metered_api", amount: 0.5, confidence: "estimated" } } };
    const legacyUnit = summarizeRecordedCost([unitless]);
    assert.strictEqual(usd(legacyUnit.amount), 0.5, "CASE 6: an amount recorded before units existed is read as US dollars");
    assert.deepStrictEqual(legacyUnit.otherUnits, []);
    assert.strictEqual(legacyUnit.complete, true, "CASE 6: a unitless legacy amount must not make a record read as incomplete");

    /* A free local render is priced and costs nothing in any currency. It joins no total
       and — this is the half that would otherwise regress — it does not make a project
       that has ever used ComfyUI report itself as incomplete. */
    const freeJob = { accounting: { costClass: "free_local", estimate: { costClass: "free_local", unit: "none", amount: 0, confidence: "quoted", quotedAt: "2026-09-05T00:00:00.000Z" } } };
    const withFree = summarizeRecordedCost([usdJob, freeJob]);
    assert.strictEqual(usd(withFree.amount), 0.84, "CASE 6: a free local render adds nothing to the dollar total");
    assert.deepStrictEqual(withFree.otherUnits, [], "CASE 6: 'none' is not a currency and must not appear beside real ones");
    assert.strictEqual(withFree.complete, true, "CASE 6: a free render must not make a complete record read as incomplete");

    /* Motion is billed on a different basis, so a per-image rate must not be
       multiplied into a confident number for it. */
    const motion = submissionAccounting({ purpose: "motion-h3", outputCount: 1, ratePerImage: 0.06, at: "2026-08-10T00:00:00.000Z" });
    assert.strictEqual(motion.estimate.confidence, "unknown", "a per-image rate must not price a video");
    assert.strictEqual(motion.basis.unitBasis, "video");
    assert(validateCostEstimate(motion.estimate).ok);

    /* ---------------------------------------------------------------------
       NO PAID PROVIDER CALL. Three submissions, three mock dispatches, all of
       them to the loopback server this test created. */
    assert.strictEqual(kit.providerCalls.length, 3, "exactly the three mocked submissions were dispatched");
    assert(kit.mockOrigin.startsWith("http://127.0.0.1:"), "the only provider this test can reach is loopback");
    assert.strictEqual(kit.config.generation.fal.baseUrl, kit.mockOrigin, "no route may be configured to a real provider");

    console.log([
      "P4-SEM 0a historical generation cost passed:",
      "  - CASE 1: a recorded estimate does not move when the Settings rate changes (ledger and Reports)",
      "  - CASE 2: job A $0.12 at $0.06/image, job B $0.48 at $0.12/image, total $0.60 — not both at one rate",
      "  - CASE 3: same rate and double the images doubles the estimate, from the job's own quantity",
      "  - CASE 4: a legacy job reads as not recorded, is never re-priced, and is never written to on read",
      "  - CASE 5: every figure stays an estimate; no record or surface implies confirmed provider spend",
      "  - CASE 6: Buzz is reported as Buzz — never summed into the US dollar total, never rendered as dollars",
      "  - unpriced and motion jobs record confidence:unknown instead of a confident $0.00",
      "  - 3 provider dispatches, all to a loopback mock; $0 of real spend",
    ].join("\n"));
  } finally {
    kit.close();
  }
}

/* `harness` and `submitFrame` are exported so the negative controls can observe a
   reintroduced defect through real behaviour rather than by inspecting patched text. */
module.exports = { main, harness, submitFrame, SOURCE_OVERRIDES };

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

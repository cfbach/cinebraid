/* Negative controls for the historical generation-cost record.
 *
 * A regression test that has never failed is a claim, not evidence. Each control below
 * reintroduces exactly one of the defects P4-SEM 0a exists to remove — Reports
 * recomputing history from today's rate (in the browser and again on the server), a
 * later Settings change rewriting an earlier job's recorded figure, the estimate never
 * being persisted at all, a legacy job being treated as though its cost had been
 * recorded, and an estimate wearing the label of confirmed provider spend — and
 * asserts that the guarding test FAILS.
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. The defect is
 *   introduced by compiling a modified copy of the source IN MEMORY, so a broad
 *   `git checkout` can never be the thing that undoes it.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt: the
 *   anchor must exist, must be unique, must actually change the source, and the DEFECT
 *   ITSELF must be observed through a behavioural probe before the guarded assertion is
 *   allowed to count as detection. A control whose anchor has gone stale reports itself
 *   as stale rather than passing quietly.
 *
 * No paid provider call is possible here either: every probe runs through the same
 * loopback mock the positive suite builds.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
/* Normalised to LF before matching. Anchors span lines, and on a Windows checkout with
   core.autocrlf on they would arrive as \r\n — the anchor would not match, the control
   would report itself as stale, and the failure would look like a source change rather
   than a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* Everything a patch may invalidate, including the positive suite itself: it captures
   its module references at require time, so a stale copy would exercise the real code
   and the control would report a false pass. */
const IN_SCOPE = [
  path.join(ROOT, "generation-cost.js"),
  /* The arithmetic moved here when the browser quote and the durable record were made
     to derive from one configured rate. A control that patched only generation-cost.js
     would leave the real multiplication in the cache and report a false pass, so the
     module that now performs it is in scope for eviction and for patching. */
  path.join(ROOT, "public", "shared-generation-rate.js"),
  path.join(ROOT, "fal-generation.js"),
  path.join(ROOT, "automation-runs.js"),
  path.join(__dirname, "generation-cost-history.js"),
];
const inScope = (key) => IN_SCOPE.includes(key);

function applyEdits(relative, original, edits) {
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${relative}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${relative}; the control would test the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${relative} was not modified at all`);
  return code;
}

function evict() {
  for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
}
const SUITE = path.join(__dirname, "generation-cost-history.js");

/* Compile a modified copy of a Node module IN MEMORY, install it in the cache, run,
   restore. Every in-scope module is evicted first so the positive suite and the two
   servers all resolve to the patched copy. */
async function patched(relative, edits, run) {
  const file = require.resolve(path.join(ROOT, relative));
  const code = applyEdits(relative, readLF(file), edits);
  const saved = new Map();
  for (const key of Object.keys(require.cache)) if (inScope(key)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const copy = new Module(file, module);
    copy.filename = file;
    copy.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = copy;
    copy._compile(code, file);
    copy.loaded = true;
    return await run();
  } finally {
    evict();
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

/* A source-only patch, for the browser script no Node test can require. */
function patchedBrowserSource(relative, edits) {
  return applyEdits(relative, readLF(path.join(ROOT, relative)), edits);
}

/* The positive suite, freshly compiled against whatever is currently in the cache.
   Only the suite itself is dropped: evicting the whole in-scope set here would delete
   the patched module `patched()` just installed and quietly restore the real code. */
function freshSuite() {
  delete require.cache[SUITE];
  return require("./generation-cost-history");
}

/* Evaluate a (possibly patched) copy of public/reports.js the way the positive suite
   does, so a browser-side probe can observe its output directly. */
function renderCost(source, cost) {
  const context = {
    console,
    window: {},
    CONFIG: { generation: { fal: { estimatedCostPerImage: 9.99 } } },
    esc: (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    attr: (value) => String(value ?? "").replace(/"/g, "&quot;"),
    plural: (n, one, many) => `${n} ${Number(n) === 1 ? one : (many || `${one}s`)}`,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "reports.js" });
  return context.reportsRecordedCostMarkup(cost);
}

const results = [];
/* `defect` MUST observe the reintroduced defect. Without that receipt an anchor that
   silently stopped matching, or a patch that changed nothing that runs, would throw
   somewhere unrelated and be counted as the guard working. */
async function control({ id, label, guards, defect, guarded }) {
  const observed = await defect();
  assert(observed === true, `NEGATIVE CONTROL ${id}: the defect probe did not observe the reintroduced defect, so nothing below proves anything`);
  let detected = null;
  try {
    await guarded();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = error;
  }
  assert(detected, `NEGATIVE CONTROL ${id} FAILED: with "${label}" reintroduced, "${guards}" still passed. That test cannot detect the defect it exists for.`);
  results.push({ id, label, guards, outcome: String(detected.message).split("\n")[0].slice(0, 120) });
}

/* A representative recorded-cost block: three priced jobs totalling $0.84, which is
   what the positive suite produces and what a recomputing renderer would replace. */
const SAMPLE_COST = { basis: "estimated-at-submission", currency: "usd", amount: 0.84, priced: 3, unpriced: 0, unrecorded: 0, jobs: 3, complete: true };

async function main() {
  /* -------------------------------------------------------------------------
     NC-A — Reports ignores the stored estimate and recomputes from Settings.
     The original defect, verbatim: job count times today's per-image rate. */
  const NC_A_EDITS = [[
    '<b>${priced ? `$${Number(cost.amount || 0).toFixed(2)}` : "Not recorded"}</b>',
    '<b>${`$${(Number(cost.jobs || 0) * Number(CONFIG?.generation?.fal?.estimatedCostPerImage || 0)).toFixed(2)}`}</b>',
  ]];
  await control({
    id: "NC-A",
    label: "Reports recomputes historical cost from the current Settings rate",
    guards: "CASE 1 — the renderer must not consult the current Settings rate at all",
    defect: () => {
      const markup = renderCost(patchedBrowserSource(path.join("public", "reports.js"), NC_A_EDITS), SAMPLE_COST);
      /* 3 jobs x 9.99 = 29.97: a figure that exists only because Settings was read. */
      return markup.includes("29.97") && !markup.includes("$0.84");
    },
    guarded: async () => {
      const suite = freshSuite();
      suite.SOURCE_OVERRIDES.set(path.join("public", "reports.js"), patchedBrowserSource(path.join("public", "reports.js"), NC_A_EDITS));
      try { await suite.main(); } finally { suite.SOURCE_OVERRIDES.clear(); }
    },
  });

  /* -------------------------------------------------------------------------
     NC-A2 — the same defect one layer down: the server summary re-derives the
     total from image counts instead of summing what the jobs recorded. */
  const NC_A2_EDITS = [[
    "recordedCost: summarizeRecordedCost(costJobs) }",
    "recordedCost: { basis: \"estimated-at-submission\", currency: \"usd\", amount: Math.round(costJobs.reduce((sum, row) => sum + Number(row.outputCount || 0), 0) * 0.24 * 1e6) / 1e6, priced: costJobs.length, unpriced: 0, unrecorded: 0, jobs: costJobs.length, complete: true } }",
  ]];
  await control({
    id: "NC-A2",
    label: "the server summary re-derives spend from image counts instead of stored estimates",
    guards: "CASE 1 — Reports totals come from stored estimates, not today's rate",
    defect: async () => {
      return patched("automation-runs.js", NC_A2_EDITS, async () => {
        const { harness, submitFrame } = freshSuite();
        const kit = await harness();
        try {
          kit.setRate(0.06);
          await submitFrame(kit, { outputCount: 2, stepKey: "probe-a2" });
          const response = await fetch(`${kit.origin}/api/automation/reports/summary`);
          const data = await response.json();
          const totals = data.summary?.totals || data.totals;
          /* Recorded: 2 x 0.06 = 0.12. Recomputed: 2 images x 0.24 = 0.48. */
          return Math.abs(Number(totals.recordedCost.amount) - 0.48) < 1e-9;
        } finally { kit.close(); }
      });
    },
    guarded: () => patched("automation-runs.js", NC_A2_EDITS, () => freshSuite().main()),
  });

  /* -------------------------------------------------------------------------
     NC-B — a later submission re-prices the jobs already in the ledger, which is
     exactly "changing Settings rewrites history" expressed as a write. */
  const NC_B_EDITS = [[
    "      await commit(owner, (current) => { current.push(job); });",
    "      await commit(owner, (current) => { current.push(job); for (const row of current) if (row.accounting) row.accounting = submissionAccounting({ purpose: row.purpose, outputCount: row.outputCount, ratePerImage: cfg.estimatedCostPerImage, at: now() }); });",
  ]];
  await control({
    id: "NC-B",
    label: "a stored job estimate is re-priced when a later job is submitted at a new rate",
    guards: "CASE 1/2 — job A keeps its own estimate while job B is priced at the newer rate",
    defect: () => patched("fal-generation.js", NC_B_EDITS, async () => {
      const { harness, submitFrame } = freshSuite();
      const kit = await harness();
      try {
        kit.setRate(0.06);
        await submitFrame(kit, { outputCount: 2, stepKey: "probe-b1" });
        kit.setRate(0.5);
        await submitFrame(kit, { outputCount: 1, stepKey: "probe-b2" });
        const first = kit.ledger().find((job) => job.automationStepKey === "probe-b1");
        /* Recorded at submission: 0.12. Re-priced at the newer rate: 1.00. */
        return Math.abs(Number(first.accounting.estimate.amount) - 0.12) > 1e-9;
      } finally { kit.close(); }
    }),
    guarded: () => patched("fal-generation.js", NC_B_EDITS, () => freshSuite().main()),
  });

  /* -------------------------------------------------------------------------
     NC-C — the estimate is never persisted at submission, which is the state
     this whole batch found the dispatch path in. */
  const NC_C_EDITS = [["    job.accounting = submissionAccounting({", "    job.accountingNotPersisted = submissionAccounting({"]];
  await control({
    id: "NC-C",
    label: "the dispatch path stops persisting the estimate at submission",
    guards: "CASE 2 — a submitted job must carry accounting",
    defect: () => patched("fal-generation.js", NC_C_EDITS, async () => {
      const { harness, submitFrame } = freshSuite();
      const kit = await harness();
      try {
        kit.setRate(0.06);
        await submitFrame(kit, { outputCount: 2, stepKey: "probe-c" });
        return kit.ledger().every((job) => job.accounting == null);
      } finally { kit.close(); }
    }),
    guarded: () => patched("fal-generation.js", NC_C_EDITS, () => freshSuite().main()),
  });

  /* -------------------------------------------------------------------------
     NC-D — a legacy job is handed a historical estimate it never had. This is
     the fabrication the fallback rule exists to prevent: $0.00 presented as a
     recorded fact rather than as an absence. */
  const NC_D_EDITS = [[
    `  if (!isRecord(job) || !isRecord(job.accounting)) return null;
  return isRecord(job.accounting.estimate) ? job.accounting.estimate : null;`,
    `  if (!isRecord(job)) return null;
  if (!isRecord(job.accounting) || !isRecord(job.accounting.estimate))
    return { costClass: COST_CLASS, unit: CURRENCY, confidence: "estimated", amount: 0 };
  return job.accounting.estimate;`,
  ]];
  await control({
    id: "NC-D",
    label: "a legacy job with no stored estimate is treated as though one had been recorded",
    guards: "CASE 4 — a legacy job reads as unrecorded and is never re-priced",
    defect: () => patched("generation-cost.js", NC_D_EDITS, async () => {
      const { recordedEstimate, summarizeRecordedCost } = require("../generation-cost");
      const legacy = { id: "legacy", purpose: "frame", outputCount: 3 };
      return recordedEstimate(legacy) !== null && summarizeRecordedCost([legacy]).unrecorded === 0;
    }),
    guarded: () => patched("generation-cost.js", NC_D_EDITS, () => freshSuite().main()),
  });

  /* -------------------------------------------------------------------------
     NC-E — the estimate is relabelled as money the provider confirmed charging.
     CineBraid receives no such figure from fal, so this is an invention. */
  const NC_E_EDITS = [[
    `  return {
    costClass: COST_CLASS,
    estimate: derived.estimate,
    recordedAt: String(at || ""),`,
    `  return {
    costClass: COST_CLASS,
    estimate: derived.estimate,
    actualCost: derived.estimate.amount,
    recordedAt: String(at || ""),`,
  ]];
  await control({
    id: "NC-E",
    label: "the submission estimate is also written as an actual provider charge",
    guards: "CASE 5 — the accounting record must not imply confirmed spend",
    defect: () => patched("generation-cost.js", NC_E_EDITS, async () => {
      const { submissionAccounting } = require("../generation-cost");
      const record = submissionAccounting({ purpose: "frame", outputCount: 2, ratePerImage: 0.06, at: "2026-08-10T00:00:00.000Z" });
      return Math.abs(Number(record.actualCost) - 0.12) < 1e-9;
    }),
    guarded: () => patched("generation-cost.js", NC_E_EDITS, () => freshSuite().main()),
  });

  /* -------------------------------------------------------------------------
     NC-E2 — the softer version of the same lie: a locally computed number
     claiming the provider priced this job. `quoted` is a real word in the
     contract and it must stay reserved for when it is true. */
  /* The anchor moved with the code. `confidence` is chosen in the shared rate module
     now, because that is where the one multiplication lives — so the control patches
     the module that would actually have to tell the lie. Patching generation-cost.js
     for it would edit a file that no longer contains the word and report itself stale.

     `quotedAt` is injected as a literal rather than as `String(at || "")`: `at` is a
     parameter of submissionAccounting and does not exist in this scope, and an injected
     defect that throws a ReferenceError is a control that proves nothing. */
  const NC_E2_EDITS = [[
    `      confidence: "estimated",
      amount,`,
    `      confidence: "quoted",
      quotedAt: "2026-08-10T00:00:00.000Z",
      amount,`,
  ]];
  await control({
    id: "NC-E2",
    label: "a locally computed estimate claims the provider quoted it",
    guards: "CASE 5 — fal does not quote at submission, so nothing may claim it did",
    defect: () => patched("public/shared-generation-rate.js", NC_E2_EDITS, async () => {
      const { submissionAccounting } = require("../generation-cost");
      return submissionAccounting({ purpose: "frame", outputCount: 2, ratePerImage: 0.06, at: "2026-08-10T00:00:00.000Z" }).estimate.confidence === "quoted";
    }),
    guarded: () => patched("public/shared-generation-rate.js", NC_E2_EDITS, () => freshSuite().main()),
  });

  /* -------------------------------------------------------------------------
     NC-F — the dedup is removed, so a job reachable from two runs is billed to
     the project twice. A double-counted paid request is a wrong total in the
     same way a re-quoted one is: the ledger stops describing what happened. */
  const NC_F_EDITS = [[
    "      for (const job of jobs) if (!costJobIds.has(job.id)) { costJobIds.add(job.id); costJobs.push(job); }",
    "      costJobs.push(...jobs);",
  ]];
  await control({
    id: "NC-F",
    label: "a job claimed by two runs is added to the project total twice",
    guards: "a job claimed by two runs is one paid request and must not be added to the total twice",
    defect: () => patched("automation-runs.js", NC_F_EDITS, async () => {
      const { harness, submitFrame } = freshSuite();
      const kit = await harness();
      try {
        kit.setRate(0.06);
        const id = await submitFrame(kit, { outputCount: 2, stepKey: "probe-f" });
        const runsFile = path.join(kit.projectDir, "automation-runs.json");
        const doc = JSON.parse(fs.readFileSync(runsFile, "utf8"));
        doc.runs.push({
          id: "run-f-second", revision: 1, type: "shot-chain", targetId: "S1", scope: "stills", status: "completed",
          config: { maxImages: 40 }, usage: { imagesGenerated: 0, imageRequests: 0, assistantCalls: 0, reviewCalls: 0 },
          steps: { "generation:1": { key: "generation:1", label: "Reused", kind: "generation", status: "completed", childJobId: id } },
          logs: [], runnerId: "runner-cost", leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        fs.writeFileSync(runsFile, JSON.stringify(doc, null, 2));
        const data = await (await fetch(`${kit.origin}/api/automation/reports/summary`)).json();
        const totals = data.summary?.totals || data.totals;
        /* Recorded once: 0.12. Counted from both runs: 0.24. */
        return Math.abs(Number(totals.recordedCost.amount) - 0.24) < 1e-9;
      } finally { kit.close(); }
    }),
    guarded: () => patched("automation-runs.js", NC_F_EDITS, () => freshSuite().main()),
  });

  /* The real modules, green, after every control has been undone. */
  evict();
  await require("./generation-cost-history").main();

  console.log([
    `P4-SEM 0a negative controls passed: ${results.length} deliberate defects reintroduced in memory — every one detected by the property that guards it, every one with a live-defect receipt, and the real modules green afterwards. Nothing was written to disk and nothing was reverted with git.`,
    ...results.map((row) => `  - ${row.id}: ${row.label} -> caught by "${row.guards}"`),
  ].join("\n"));
}

main().catch((error) => { console.error(error); process.exit(1); });

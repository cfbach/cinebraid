/* CineBraid — Batch 2, Slice 4 NEGATIVE CONTROLS.
 *
 * Every property the positive suite asserts is only worth what its failure mode is worth.
 * So each control here reintroduces one specific defect IN MEMORY, proves the defect is
 * really live, and proves the property that guards it turns red — and then proves the
 * real modules are green afterwards, so nothing was left broken on disk.
 *
 * THREE PHASES, AND THE RECEIPT NAMES ALL THREE. A control that only ran the guarded
 * suite would report a pass whether it had armed anything or not: a setup error, a stale
 * anchor or a mutation that no longer applies all look identical to a caught regression
 * from the outside. So every control reports armed / caught, and a control whose defect
 * did not actually take effect is reported as BROKEN-NOT-ARMED rather than as a pass.
 *
 * Nothing is written to disk. No `git checkout` is ever used to undo a mutation — the
 * patched source is compiled from a string and the module cache is restored by hand,
 * because a working tree is not a scratchpad and a revert that reaches it takes unstaged
 * work with it.
 *
 * Provider calls: 0. Paid calls: 0.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const { render, buildFixture } = require("./render-harness");

/* Everything a patch may invalidate, including the positive suite itself: it captures its
   module references at require time, so a stale copy would exercise the real code and the
   control would report a false pass. */
const IN_SCOPE = [
  path.join(ROOT, "public", "shared-generation-presentation.js"),
  path.join(ROOT, "public", "shared-generation-rate.js"),
  path.join(ROOT, "public", "shared-generation-capability.js"),
  path.join(ROOT, "generation-cost.js"),
  path.join(ROOT, "generation-contracts.js"),
  path.join(ROOT, "config.js"),
  path.join(__dirname, "generation-simple-advanced.js"),
];
const inScope = (key) => IN_SCOPE.includes(key);

function applyEdits(relative, original, edits) {
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${relative}; the control must be UPDATED, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${relative}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${relative}; the control would be testing the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${relative} was not modified at all`);
  return code;
}

/* Compile a modified copy of a Node module IN MEMORY, install it in the cache, run,
   restore. Every in-scope module is evicted first so the positive suite and everything it
   requires resolve to the patched copy. */
async function patched(relative, edits, run) {
  const file = require.resolve(path.join(ROOT, relative));
  const code = applyEdits(relative, readLF(relative), edits);
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
    for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

function freshSuite() {
  delete require.cache[path.join(__dirname, "generation-simple-advanced.js")];
  return require("./generation-simple-advanced.js");
}

const receipts = [];

/* THE THREE PHASES.
 *
 * `defect` must return true — the mutation really is live. If it returns false the control
 * is BROKEN-NOT-ARMED and the run fails, because a mutation that did not apply cannot
 * prove anything about the guard.
 *
 * `guarded` must THROW — the property that owns this behaviour noticed. If it passes, the
 * guard is missing and the run fails. */
async function control({ id, label, guards, defect, guarded }) {
  let armed = false;
  try {
    armed = (await defect()) === true;
  } catch (error) {
    throw new Error(`${id}: the defect probe itself failed to run — the control proves nothing.\n${error.stack}`);
  }
  assert(armed, `${id}: BROKEN-NOT-ARMED — the injected defect did not take effect, so this control tests nothing`);

  let caught = null;
  try {
    await guarded();
  } catch (error) {
    caught = error;
  }
  assert(caught, `${id}: MISSED — the defect is live and no property failed. "${guards}" does not actually guard it.`);
  receipts.push(`${id}: ${label} -> caught by "${guards}"`);
}

/* A control whose defect lives in the BROWSER rather than in a required module. The
   render harness compiles the shipped scripts from a string, so the mutation reaches the
   real dialog without touching the file on disk. */
async function browserControl({ id, label, guards, file, edits, probe }) {
  const view = await render("#/shot/L1-01", buildFixture(), {
    mutateSource: (name, original) => (name === file ? applyEdits(file, original.replace(/\r\n/g, "\n"), edits) : original),
  });
  const outcome = await probe(view);
  assert(outcome.armed === true, `${id}: BROKEN-NOT-ARMED — the injected defect did not take effect`);
  assert(outcome.caught === true, `${id}: MISSED — the defect is live and the property did not notice`);
  receipts.push(`${id}: ${label} -> caught by "${guards}"`);
}

async function main() {
  /* ---------------------------------------------------------------------------
     NC-A — SIMPLE STOPS BEING THE DEFAULT. The single most load-bearing sentence in
     the slice: an unspecified preference must resolve to Simple. A default that
     flipped to Advanced would put the full expert grid back in front of every
     filmmaker while every other property still passed. */
  const NC_A_EDITS = [[
    `function generationViewMode(value) {
  return CINEBRAID_GENERATION_VIEW_MODES.includes(presentationText(value))
    ? presentationText(value)
    : "simple";
}`,
    `function generationViewMode(value) {
  return CINEBRAID_GENERATION_VIEW_MODES.includes(presentationText(value))
    ? presentationText(value)
    : "advanced";
}`,
  ]];
  await control({
    id: "NC-A",
    label: "an unspecified generation view resolves to Advanced instead of Simple",
    guards: "section 1 — Simple is the default",
    defect: () => patched("public/shared-generation-presentation.js", NC_A_EDITS, async () => {
      const P = require("../public/shared-generation-presentation");
      return P.generationViewMode(undefined) === "advanced";
    }),
    guarded: () => patched("public/shared-generation-presentation.js", NC_A_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-B — AN UNSUPPORTED CONTROL IS RENDERED ANYWAY, which is the "disabled with a
     default value" defect this slice exists to remove. `rendered` stops consulting
     `supported`, so a model with no seed gets a seed control — and, because the payload
     keys are the same derivation, a seed in the request. */
  const NC_B_EDITS = [[
    `      rendered: inVocabulary && support.supported === true && inTier,`,
    `      rendered: inVocabulary && inTier,`,
  ]];
  await control({
    id: "NC-B",
    label: "a control the model does not support is rendered (and therefore submittable) anyway",
    guards: "section 2 — an unsupported capability is absent, not disabled",
    defect: () => patched("public/shared-generation-presentation.js", NC_B_EDITS, async () => {
      const P = require("../public/shared-generation-presentation");
      const suite = freshSuite();
      const plan = P.generationControlPlan({ capability: suite.CAPABLE_OF_NOTHING_EXTRA, mode: "advanced" });
      return plan.rendered.includes("seed") && plan.payloadKeys.includes("seed");
    }),
    guarded: () => patched("public/shared-generation-presentation.js", NC_B_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-C — THE PAYLOAD GATE IS REMOVED. The screen still hides the control; the request
     still carries it. This is the exact shape of "a hidden Advanced value silently
     alters a Simple submission", and it is invisible from the screen alone. */
  const NC_C_EDITS = [[
    `    if (CINEBRAID_CONTROL_PAYLOAD_KEYS.includes(key) && governed.has(key) && !allowed.has(key)) { removed.push(key); continue; }`,
    `    if (false) { removed.push(key); continue; }`,
  ]];
  await control({
    id: "NC-C",
    label: "the payload gate stops removing keys the active view did not render",
    guards: "sections 3 and 4 — the payload is the render plan read differently",
    defect: () => patched("public/shared-generation-presentation.js", NC_C_EDITS, async () => {
      const P = require("../public/shared-generation-presentation");
      const suite = freshSuite();
      const plan = P.generationControlPlan({ capability: suite.CAPABLE_OF_NOTHING_EXTRA, mode: "simple" });
      return P.restrictPayloadToPlan({ prompt: "P", seed: 42, resolution: "1024x1024" }, plan).payload.seed === 42;
    }),
    guarded: () => patched("public/shared-generation-presentation.js", NC_C_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-D — `only` BECOMES AN EXEMPTION. A surface that simply does not declare `seed`
     is allowed to ship one, which turns the invariant into a convention that holds only
     while every caller remembers it. The subtle version of NC-C and the one a review
     would be most likely to wave through. */
  const NC_D_EDITS = [[
    `  const governed = new Set(rows.filter((row) => row.inVocabulary !== false || row.supported !== true).flatMap(keysOf));`,
    `  const governed = new Set(rows.filter((row) => row.inVocabulary !== false).flatMap(keysOf));`,
  ], [
    `  }).filter((control) => control.inVocabulary || !control.supported);`,
    `  }).filter((control) => control.inVocabulary);`,
  ]];
  await control({
    id: "NC-D",
    label: "a surface that never declared a control is exempted from the gate for it",
    guards: "section 3 — an unsupported control is stripped whether or not the surface declared it",
    defect: () => patched("public/shared-generation-presentation.js", NC_D_EDITS, async () => {
      const P = require("../public/shared-generation-presentation");
      const suite = freshSuite();
      const plan = P.generationControlPlan({ capability: suite.CAPABLE_OF_NOTHING_EXTRA, mode: "advanced", only: ["quality"] });
      return P.restrictPayloadToPlan({ prompt: "P", seed: 42 }, plan).payload.seed === 42;
    }),
    guarded: () => patched("public/shared-generation-presentation.js", NC_D_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-E — RECOMMENDATION FALLS BACK TO THE FIRST ACTIONABLE OPTION. The forbidden
     derivation, in its most plausible clothes: the guide is undecided, so "just pick the
     first one that works" looks like helpfulness. `resolveCapability` alphabetises, so
     first-in-list is an alphabetical accident, and this is how "the best resolution"
     became 768P. */
  const NC_E_EDITS = [[
    `  if (state !== "decided")
    return {
      available: false,
      reason: "undecided",`,
    `  if (state !== "decided")
    return rows[0] ? {
      available: true,
      reason: "",
      modelId: presentationText(rows[0].modelId),
      option: rows[0],
      headline: "Recommended · " + presentationText(rows[0].modelName),
      detail: "Best available option.",
    } : {
      available: false,
      reason: "undecided",`,
  ]];
  await control({
    id: "NC-E",
    label: "an undecided guide is answered with the first actionable option",
    guards: "section 8 — no recommendation is inferred from list order",
    defect: () => patched("public/shared-generation-presentation.js", NC_E_EDITS, async () => {
      const P = require("../public/shared-generation-presentation");
      const result = P.generationRecommendation({
        guide: { decisionState: "undecided-pending-evaluation" },
        options: [{ optionId: "a", modelId: "alpha/model", modelName: "Alpha", actionable: true },
          { optionId: "z", modelId: "zulu/model", modelName: "Zulu", actionable: true }],
      });
      return result.available === true && result.modelId === "alpha/model";
    }),
    guarded: () => patched("public/shared-generation-presentation.js", NC_E_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-F — AN UNCONFIGURED RATE PRICES A JOB AT ZERO. The defect the whole cost module
     was built to prevent, reintroduced one layer lower: 0 stops meaning UNCONFIGURED and
     starts meaning "this costs nothing", so an install that never filled the field in
     reports a confident $0.00 for every render. */
  const NC_F_EDITS = [[
    `  const priced = applicable.configured === true && amountPer > 0 && units > 0;`,
    `  const priced = units > 0;`,
  ]];
  await control({
    id: "NC-F",
    label: "an unconfigured rate produces a confident zero instead of unknown",
    guards: "sections 7 and 9 — no configured rate stays unknown and is never rendered as $0",
    defect: () => patched("public/shared-generation-rate.js", NC_F_EDITS, async () => {
      const R = require("../public/shared-generation-rate");
      const line = R.generationPriceLine({ rate: R.configuredMotionRate({}), quantity: 8 });
      return line.kind === "estimated" && line.amount === 0;
    }),
    guarded: () => patched("public/shared-generation-rate.js", NC_F_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-G — THE BROWSER GETS ITS OWN RATE BACK. A second derivation with a hard-coded
     number, which is precisely the arrangement this slice removed: the quote and the
     record would agree only by coincidence, and would diverge the moment either moved. */
  const NC_G_EDITS = [[
    `  const derived = costEstimateFromRate({ rate, quantity });
  const provenance = rateProvenance(rate);`,
    `  const secondRate = 0.26;
  const own = roundRateUsd(Number(quantity || 0) * secondRate);
  const derived = { priced: true, estimate: { amount: own, breakdown: [{ label: "own rate", amount: own }] } };
  const provenance = rateProvenance(rate);`,
  ]];
  await control({
    id: "NC-G",
    label: "the pre-flight quote is computed from its own hard-coded per-second rate",
    guards: "section 5 — the quote and the record derive from one configured rate",
    defect: () => patched("public/shared-generation-rate.js", NC_G_EDITS, async () => {
      const R = require("../public/shared-generation-rate");
      /* No rate configured at all, and it still quotes a number — two authorities. */
      return R.generationPriceLine({ rate: R.configuredMotionRate({}), quantity: 8 }).amount === 2.08;
    }),
    guarded: () => patched("public/shared-generation-rate.js", NC_G_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-H — A LEGACY ROW IS HANDED AN ESTIMATE IT NEVER HAD. The no-backfill rule, which
     this slice was explicitly forbidden to weaken while adding a second rate basis. */
  const NC_H_EDITS = [[
    `  if (!isRecord(job) || !isRecord(job.accounting)) return null;
  return isRecord(job.accounting.estimate) ? job.accounting.estimate : null;`,
    `  if (!isRecord(job)) return null;
  if (!isRecord(job.accounting) || !isRecord(job.accounting.estimate))
    return { costClass: COST_CLASS, unit: CURRENCY, confidence: "estimated", amount: 0 };
  return job.accounting.estimate;`,
  ]];
  await control({
    id: "NC-H",
    label: "a legacy job with no stored estimate is treated as though one had been recorded",
    guards: "section 7 — a legacy row is read, classified as unrecorded, and left alone",
    defect: () => patched("generation-cost.js", NC_H_EDITS, async () => {
      const { recordedEstimate, summarizeRecordedCost } = require("../generation-cost");
      const legacy = { id: "legacy", purpose: "motion-h3", outputCount: 1 };
      return recordedEstimate(legacy) !== null && summarizeRecordedCost([legacy]).unrecorded === 0;
    }),
    guarded: () => patched("generation-cost.js", NC_H_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-I — THE ESTIMATE CLAIMS THE PROVIDER QUOTED IT. `quoted` is a real word in the
     accepted contract and must stay reserved for when a provider actually priced the
     job. fal does not quote at submission. */
  const NC_I_EDITS = [[
    `      confidence: "estimated",
      amount,`,
    `      confidence: "quoted",
      quotedAt: "2026-08-18T00:00:00.000Z",
      amount,`,
  ]];
  await control({
    id: "NC-I",
    label: "a locally computed estimate is relabelled as a provider quote",
    guards: "section 7 — an estimate never becomes an actual or a quote",
    defect: () => patched("public/shared-generation-rate.js", NC_I_EDITS, async () => {
      const R = require("../public/shared-generation-rate");
      const rate = R.configuredMotionRate({ generation: { fal: { motionRate: { usdPerSecond: 0.26 } } } });
      return R.costEstimateFromRate({ rate, quantity: 8 }).estimate.confidence === "quoted";
    }),
    guarded: () => patched("public/shared-generation-rate.js", NC_I_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-J — A LOCAL ROUTE SAYS "FREE". The word every generation UI reaches for, and the
     one that asserts something CineBraid does not know: local compute costs power,
     hardware and a GPU that cannot do anything else meanwhile. */
  const NC_J_EDITS = [[
    `const CINEBRAID_LOCAL_CHARGE_LINE = "$0 provider charge";`,
    `const CINEBRAID_LOCAL_CHARGE_LINE = "Free";`,
  ]];
  await control({
    id: "NC-J",
    label: "a local route is described as Free rather than as $0 provider charge",
    guards: "section 9 — local reads \"$0 provider charge\" and no surface says Free",
    defect: () => patched("public/shared-generation-rate.js", NC_J_EDITS, async () => {
      const R = require("../public/shared-generation-rate");
      return R.generationPriceLine({ rate: R.configuredMotionRate({}), quantity: 8, local: true }).headline === "Free";
    }),
    guarded: () => patched("public/shared-generation-rate.js", NC_J_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-K — AN UNKNOWN PRICE RENDERS AS $0.00. The difference between "we do not know"
     and "it is free", collapsed — and collapsed in the direction that makes a paid
     dispatch look costless. */
  const NC_K_EDITS = [[
    `      kind: "unavailable",
      amount: null,
      headline: CINEBRAID_RATE_UNAVAILABLE_LINE,`,
    `      kind: "unavailable",
      amount: 0,
      headline: "$0.00",`,
  ]];
  await control({
    id: "NC-K",
    label: "an unpriced route renders a confident $0.00 instead of unavailable",
    guards: "section 9 — unknown reads unavailable and is never a guessed zero",
    defect: () => patched("public/shared-generation-rate.js", NC_K_EDITS, async () => {
      const R = require("../public/shared-generation-rate");
      return R.generationPriceLine({ rate: R.configuredMotionRate({}), quantity: 8 }).headline === "$0.00";
    }),
    guarded: () => patched("public/shared-generation-rate.js", NC_K_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-L — A FRESHNESS DATE IS MANUFACTURED. An `asOf` that quietly becomes a real date
     when nobody wrote one is a verification timestamp CineBraid invented, which is worse
     than admitting the age is unknown — it is unfalsifiable from the screen. */
  const NC_L_EDITS = [[
    `function rateAsOf(value) {
  const text = rateText(value);
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(text) ? text : "";
}`,
    `function rateAsOf(value) {
  const text = rateText(value);
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(text) ? text : "2026-08-18";
}`,
  ]];
  await control({
    id: "NC-L",
    label: "an unrecorded freshness date is filled in with a manufactured one",
    guards: "section 6 — a value that is not an ISO date must not become one",
    defect: () => patched("public/shared-generation-rate.js", NC_L_EDITS, async () => {
      const R = require("../public/shared-generation-rate");
      return R.configuredMotionRate({ generation: { fal: { motionRate: { usdPerSecond: 0.26, asOf: "recently" } } } }).asOf === "2026-08-18";
    }),
    guarded: () => patched("public/shared-generation-rate.js", NC_L_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-M — A GENERATION TIME IS INVENTED. CineBraid records no timing anywhere, so any
     number here is fabricated — and a fabricated render time beside a paid button is the
     confident wrongness this slice removes. */
  const NC_M_EDITS = [[
    `  return {
    available: false,
    seconds: null,
    headline: "Estimated time unavailable",`,
    `  return {
    available: true,
    seconds: 45,
    headline: "Estimated time about 45 seconds",`,
  ]];
  await control({
    id: "NC-M",
    label: "a generation-time estimate is invented from nothing",
    guards: "section 10 — no time may be shown because none is recorded",
    defect: () => patched("public/shared-generation-presentation.js", NC_M_EDITS, async () => {
      const P = require("../public/shared-generation-presentation");
      return P.generationTimeEstimate().seconds === 45;
    }),
    guarded: () => patched("public/shared-generation-presentation.js", NC_M_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-N — THE CAPABILITY VOCABULARY LOSES CFG AND STEPS. Without a name for them their
     absence cannot be DERIVED — a screen would simply never have heard of a CFG slider,
     which looks identical from the outside and stops being true the moment a model
     declares one. */
  const NC_N_EDITS = [[
    `  "cfgScale", "steps",
];`,
    `];`,
  ]];
  await control({
    id: "NC-N",
    label: "CFG and steps stop being expressible capabilities",
    guards: "section 2 — CFG and steps must be declared capabilities, not unknown words",
    defect: () => patched("public/shared-generation-capability.js", NC_N_EDITS, async () => {
      const C = require("../public/shared-generation-capability");
      return !C.CINEBRAID_CAPABILITY_FLAGS.includes("cfgScale") && !C.CINEBRAID_CAPABILITY_FLAGS.includes("steps");
    }),
    guarded: () => patched("public/shared-generation-capability.js", NC_N_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-O — THE CONFIG NORMALISER ACCEPTS ANY FRESHNESS STRING. The same lie as NC-L one
     layer down, where a hand-edited config file could smuggle it in past the reader. */
  const NC_O_EDITS = [[
    `  merged.generation.fal.motionRate.asOf = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(merged.generation.fal.motionRate.asOf || "").trim())
    ? String(merged.generation.fal.motionRate.asOf).trim()
    : "";`,
    `  merged.generation.fal.motionRate.asOf = String(merged.generation.fal.motionRate.asOf || "").trim();`,
  ]];
  await control({
    id: "NC-O",
    label: "the config normaliser accepts a freshness value that is not a date",
    guards: "section 6 — the normaliser must refuse a non-date too",
    defect: () => patched("config.js", NC_O_EDITS, async () => {
      const { normalizeConfig } = require("../config");
      return normalizeConfig({ generation: { fal: { motionRate: { usdPerSecond: 1, asOf: "yesterday" } } } })
        .generation.fal.motionRate.asOf === "yesterday";
    }),
    guarded: () => patched("config.js", NC_O_EDITS, () => freshSuite().main()),
  });

  /* ---------------------------------------------------------------------------
     NC-P — THE PRICE MOVES INSIDE THE DISCLOSURE. Rendered into the controls panel, the
     cost is only visible in whichever view happens to be open — so a filmmaker on Simple
     could dispatch a paid request having never been shown a figure. This one is a
     BROWSER control: the defect is in shipped markup, not in a required module. */
  await browserControl({
    id: "NC-P",
    label: "price and route are moved inside the Advanced disclosure",
    guards: "section 11 — price and route render outside the controls panel",
    file: "generation-view.js",
    edits: [[
      `    + generationAlwaysVisibleMarkup({ option, recommendation, rate, quantity })
    + \`<div class="gen-view-controls"`,
      `    + \`<div class="gen-view-controls"`,
    ], [
      `role="tabpanel" aria-labelledby="gen-view-tab-\${attr(view)}">\${controlsMarkup || ""}`,
      `role="tabpanel" aria-labelledby="gen-view-tab-\${attr(view)}">\${generationAlwaysVisibleMarkup({ option, recommendation, rate, quantity })}\${controlsMarkup || ""}`,
    ]],
    probe: async (view) => {
      const markup = view.context.generationViewMarkup({
        mode: "simple",
        plan: view.context.generationControlPlan({ capability: { flags: {} }, mode: "simple" }),
        option: null,
        recommendation: view.context.generationRecommendation({ guide: null, options: [] }),
        rate: view.context.configuredMotionRate({}),
        quantity: 8,
        limits: null,
        controlsMarkup: "",
      });
      /* ARMED: the price now sits inside the controls panel. */
      const armed = markup.indexOf("gen-view-controls") < markup.indexOf("gen-view-price");
      /* CAUGHT: the property that owns the ordering rule reads the shipped source, so it
         is run against the mutated text rather than against the rendered string. */
      let caught = false;
      try {
        /* BOTH edits, because the defect is the PAIR: the block is removed from outside
           the panel and added back inside it. Applying only the first would leave the
           marker absent, and an ordering assertion is satisfied by an absence — which is
           exactly the weakness the positive property was tightened to close. */
        const mutated = applyEdits("generation-view.js", readLF("public/generation-view.js"), edits);
        const shell = mutated.split("function generationViewMarkup")[1] || "";
        assert(shell.includes("generationAlwaysVisibleMarkup"),
          "S/19: the shell must render the always-visible price and route block at all");
        assert(shell.indexOf("generationAlwaysVisibleMarkup") < shell.indexOf("gen-view-controls"),
          "S/19: price and route must render before, and outside, the controls panel");
        assert.strictEqual(shell.split("generationAlwaysVisibleMarkup").length - 1, 1,
          "S/19: and must not be duplicated inside the controls panel");
      } catch { caught = true; }
      return { armed, caught };
    },
  });

  /* Everything real, and green, after every mutation was rolled back in memory. */
  await freshSuite().main();

  console.log([
    `Batch 2 Slice 4 negative controls passed: ${receipts.length} deliberate defects reintroduced in memory — every one armed and`,
    "proven live, every one caught by the property that guards it, and the real modules green afterwards. Nothing was written to",
    "disk and nothing was reverted with git.",
    ...receipts.map((line) => `  - ${line}`),
  ].join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

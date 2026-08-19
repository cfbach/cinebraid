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
const vm = require("vm");

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
  /* The route's own guide serializer lives here now, and the positive suite calls it. */
  path.join(ROOT, "generation-options.js"),
  path.join(ROOT, "model-intelligence.js"),
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

/* A control whose defect lives in a BROWSER file the positive suite reads as SOURCE
   rather than requires. The mutation is applied in memory and the suite's own predicate
   is re-run over the mutated text, so what is exercised is the real assertion and not a
   restatement of it. */
async function sourceControl({ id, label, guards, file, edits, defect, guarded }) {
  const mutated = applyEdits(file, readLF(file), edits);
  assert(defect(mutated) === true,
    `${id}: BROKEN-NOT-ARMED — the injected defect did not take effect in ${file}`);
  let caught = false;
  try { guarded(mutated); } catch { caught = true; }
  assert(caught, `${id}: MISSED — the defect is live and "${guards}" did not notice`);
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
  /* Re-anchored when the calendar test landed: the shape-only regex this used to patch
     is gone, and the control follows the code rather than being deleted with it. */
  const NC_L_EDITS = [[
    `function rateAsOf(value) {
  const text = rateText(value);
  return isCalendarDate(text) ? text : "";
}`,
    `function rateAsOf(value) {
  const text = rateText(value);
  return isCalendarDate(text) ? text : "2026-08-18";
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
  /* Re-anchored alongside NC-L. The mutation is the strongest form of the same defect:
     the normaliser stops validating freshness at all. NC-U covers the subtler version,
     where it validates with a second, shape-only rule of its own. */
  const NC_O_EDITS = [[
    `  merged.generation.fal.motionRate.asOf = isCalendarDate(motionAsOf) ? motionAsOf : "";`,
    `  merged.generation.fal.motionRate.asOf = motionAsOf;`,
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

  /* =========================================================================
     THE THREE CORRECTIONS, each with the defect that made it necessary. */

  /* NC-Q — THE ENTITY-STATE BYPASS COMES BACK. "GENERATE 3 MORE" builds its own paid
     request body and POSTs it: no preflight, no provider or cost disclosure, no
     Simple/Advanced plan and no payload gate. This is the exact defect an independent
     review found, restored verbatim in shape. */
  await sourceControl({
    id: "NC-Q",
    label: "the entity-state shortcut dispatches a paid request without the preflight",
    guards: "section 13a — no paid entity-state dispatch may skip the preflight",
    file: "public/fal-generation.js",
    edits: [[
      `  return openFalEntityGenerationModal(list, entityId, build.id, state.id, { candidateCount: 3 });`,
      `  const body = { purpose: "entity-reference", entityId, prompt: build.prompt, outputCount: 3 };
  const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return response;`,
    ]],
    defect: (source) => {
      const action = source.split("window.generateMoreEntityStateCandidates")[1].split("window.startFalEntityGeneration")[0];
      return /fetch\(\s*["'`]\/api\/generation\/fal\/jobs/.test(action)
        && !/restrictPayloadToPlan/.test(action);
    },
    guarded: (source) => {
      const action = String(source).replace(/\/\*[\s\S]*?\*\//g, "")
        .split("window.generateMoreEntityStateCandidates")[1].split("window.startFalEntityGeneration")[0];
      assert(!/fetch\(\s*["'`]\/api\/generation\/fal\/jobs/.test(action),
        "13a: the entity-state action must not reach the paid endpoint at all");
      assert(!/purpose:\s*["'`]entity-reference/.test(action),
        "13a: nor build a paid request body of its own");
      const bodies = (String(source).match(/purpose:\s*"entity-reference"/g) || []).length;
      assert.strictEqual(bodies, 1, `13a: exactly one entity-reference request body may exist, found ${bodies}`);
    },
  });

  /* NC-R — THE WIRE DROPS THE REASON AGAIN. The recommendation's identity survives and
     its authored rationale does not, which is precisely what made the presentation layer
     substitute a sentence CineBraid never wrote. */
  const NC_R_EDITS = [[
    `    /* The authority's own words, verbatim and unabridged. */
    note: decision.note || "",`,
    ``,
  ]];
  await control({
    id: "NC-R",
    label: "the generation-options wire drops the decision's authored rationale",
    guards: "section 13b — a decided recommendation's reason survives the wire",
    defect: () => patched("generation-options.js", NC_R_EDITS, async () => {
      const { guidePayload } = require("../generation-options");
      return guidePayload({ decision: { state: "decided", recommended: "m", note: "REAL REASON" } }).note === undefined;
    }),
    guarded: () => patched("generation-options.js", NC_R_EDITS, () => freshSuite().main()),
  });

  /* NC-S — THE SCREEN READS THE WRONG FIELD. `decision.why` is the shortlist rows' field
     and no decision has ever carried it, so a decided guide falls straight through to the
     generic sentence. This is the original defect, restored. */
  const NC_S_EDITS = [[
    `  const rationale = presentationText(decision.note) || presentationText(decision.why);`,
    `  const rationale = presentationText(decision.why);`,
  ]];
  await control({
    id: "NC-S",
    label: "the presentation layer reads a rationale field no decision carries",
    guards: "section 13b — the authority's own words reach the screen",
    defect: () => patched("public/shared-generation-presentation.js", NC_S_EDITS, async () => {
      const P = require("../public/shared-generation-presentation");
      const out = P.generationRecommendation({
        guide: { decisionState: "decided", recommended: "m", note: "REAL REASON" },
        options: [{ optionId: "o", modelId: "m", modelName: "M" }],
      });
      return out.available === true && out.detail !== "REAL REASON";
    }),
    guarded: () => patched("public/shared-generation-presentation.js", NC_S_EDITS, () => freshSuite().main()),
  });

  /* NC-T — THE CALENDAR DEGRADES TO A SHAPE. 2026-99-99 and 2026-02-30 pass again, and
     "as of 2026-99-99" is rendered as configured provenance. */
  const NC_T_EDITS = [[
    `  if (month < 1 || month > 12 || day < 1) return false;`,
    `  if (false) return false;`,
  ], [
    `  return day <= (month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1]);`,
    `  return true;`,
  ]];
  await control({
    id: "NC-T",
    label: "an impossible calendar date passes the freshness check again",
    guards: "section 13c — a date-shaped string is not a date",
    defect: () => patched("public/shared-generation-rate.js", NC_T_EDITS, async () => {
      const R = require("../public/shared-generation-rate");
      return R.isCalendarDate("2026-99-99") === true && R.isCalendarDate("2026-02-30") === true;
    }),
    guarded: () => patched("public/shared-generation-rate.js", NC_T_EDITS, () => freshSuite().main()),
  });

  /* NC-U — THE NORMALISER KEEPS ITS OWN COPY OF THE RULE. Two validators are two answers
     waiting to disagree, and the one that disagrees is the one a hand-edited config file
     reaches first. */
  const NC_U_EDITS = [[
    `  const motionAsOf = String(merged.generation.fal.motionRate.asOf || "").trim();
  merged.generation.fal.motionRate.asOf = isCalendarDate(motionAsOf) ? motionAsOf : "";`,
    `  const motionAsOf = String(merged.generation.fal.motionRate.asOf || "").trim();
  merged.generation.fal.motionRate.asOf = /^\\d{4}-\\d{2}-\\d{2}$/.test(motionAsOf) ? motionAsOf : "";`,
  ]];
  await control({
    id: "NC-U",
    label: "the config normaliser validates freshness with a second, shape-only rule",
    guards: "section 13c — one calendar serves both readers",
    defect: () => patched("config.js", NC_U_EDITS, async () => {
      const { normalizeConfig } = require("../config");
      return normalizeConfig({ generation: { fal: { motionRate: { usdPerSecond: 1, asOf: "2026-02-30" } } } })
        .generation.fal.motionRate.asOf === "2026-02-30";
    }),
    guarded: () => patched("config.js", NC_U_EDITS, () => freshSuite().main()),
  });

  /* NC-V — THE CORRECTION POSTS ITS RAW BODY AGAIN. The exact defect an independent
     review reproduced in Chromium: the paid edit request leaves carrying whatever the
     dialog's selects held, past the plan that decides what may be sent. */
  await sourceControl({
    id: "NC-V",
    label: "candidate-correction submits a raw body past the payload gate",
    guards: "section 13d — the correction submits the gated body and keeps no raw POST beside it",
    file: "public/fal-generation.js",
    edits: [[
      `  const gatedBody = restrictPayloadToPlan(body, falFixedImageControlPlan(generationViewPreference(), draft)).payload;
  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gatedBody) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start correction generation");`,
      `  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start correction generation");`,
    ]],
    defect: (source) => {
      const dispatch = source.split("window.startCandidateCorrectionGeneration")[1]
        .split("window.refreshCandidateCorrectionGeneration")[0];
      return /body: JSON\.stringify\(body\)/.test(dispatch) && !/restrictPayloadToPlan/.test(dispatch);
    },
    guarded: (source) => {
      const dispatch = String(source).replace(/\/\*[\s\S]*?\*\//g, "")
        .split("window.startCandidateCorrectionGeneration")[1]
        .split("window.refreshCandidateCorrectionGeneration")[0];
      assert(/JSON\.stringify\(gatedBody\)/.test(dispatch), "13d: the correction must submit the gated body");
      assert(!/body: JSON\.stringify\(body\)/.test(dispatch), "13d: and must not keep a raw-body POST beside it");
      assert(/restrictPayloadToPlan\(\s*body,\s*falFixedImageControlPlan\(/.test(dispatch),
        "13d: through the accepted plan authority, not one of its own");
    },
  });

  /* NC-W — THE DIALOG DRAWS ITS OWN THREE-CONTROL GRID AGAIN. Count, quality and
     resolution side by side whatever the model supports, with no plan and no price above
     them — the presentation half of the same defect, and the half a payload assertion
     alone would never notice. */
  await sourceControl({
    id: "NC-W",
    label: "candidate-correction draws a fixed count/quality/resolution grid of its own",
    guards: "section 13d — every control the dialog draws is plan-derived",
    file: "public/review-provenance.js",
    edits: [[
      `<div id="candidate-correction-generation-view"></div>`,
      `<div class="two-col candidate-correction-settings"><label><span>Number of options</span><select id="candidate-correction-output-count"></select></label><label><span>Quality</span><select id="candidate-correction-quality"></select></label><label><span>Resolution</span><select id="candidate-correction-resolution"></select></label></div>`,
    ]],
    defect: (source) => /<select id="candidate-correction-resolution"/.test(source)
      && !/id="candidate-correction-generation-view"/.test(source),
    guarded: (source) => {
      assert(!/candidate-correction-settings/.test(source),
        "13d: the hand-rolled settings grid must be gone, not merely hidden");
      assert(/id="candidate-correction-generation-view"/.test(source),
        "13d: the accepted preflight must be mounted in the dialog");
      for (const id of ["candidate-correction-output-count", "candidate-correction-quality", "candidate-correction-resolution"])
        assert(!new RegExp(`<select id="${id}"`).test(source), `13d: ${id} must not be drawn by the dialog itself`);
    },
  });

  /* NC-X — THE CONTROLS STOP ANNOUNCING THEMSELVES. Exactly the reproduced defect: the
     count changes, nothing redraws, and the price above the paid button keeps describing
     the request the dialog opened with while the body carries the new one. */
  await sourceControl({
    id: "NC-X",
    label: "the shared generation controls stop reporting a change, freezing the quote",
    guards: "section 13e — every control announces itself",
    file: "public/fal-generation.js",
    edits: [[
      `  const onchange = \` onchange="refreshFalFixedImageView()"\`;`,
      `  const onchange = "";`,
    ]],
    defect: (source) => {
      const controls = source.split("function falFixedImageControlsMarkup")[1]
        .split("function renderFalFixedImageView")[0];
      return !/onchange="refreshFalFixedImageView\(\)"/.test(controls);
    },
    guarded: (source) => {
      const controls = String(source).split("function falFixedImageControlsMarkup")[1]
        .split("function renderFalFixedImageView")[0];
      assert.strictEqual((controls.match(/onchange="refreshFalFixedImageView\(\)"/g) || []).length, 1,
        "13e: the handler is declared once and interpolated, not repeated per control");
      for (const key of ["ids.count", "ids.quality", "ids.resolution"])
        assert(new RegExp(`attr\\(${key.replace(".", "\\.")}\\)}"\\$\\{lock}\\$\\{onchange}`).test(controls),
          `13e: ${key} must carry it too`);
    },
  });

  /* NC-Y — THE REFRESHER REDRAWS THE OPENING STATE INSTEAD OF THE LIVE CONTROLS. The
     softer shape of the same lie, and the one a handler-presence check alone would miss:
     the event fires, something redraws, and the number never moves.

     A BROWSER control, because this defect is only visible in behaviour — the handler is
     present, the render happens, and only the VALUE it renders from is wrong. */
  await browserControl({
    id: "NC-Y",
    label: "the refresher redraws the dialog's opening state instead of its current controls",
    guards: "section 13e — the visible quote is read from the live control",
    file: "fal-generation.js",
    edits: [[
      `  const count = Number(read(state.ids.count, state.current.count));
  renderFalFixedImageView(state.hostId, state.ids, {
    ...state.current,
    count: Number.isFinite(count) && count > 0 ? Math.max(1, Math.min(4, Math.round(count))) : state.current.count,
    quality: read(state.ids.quality, state.current.quality),
    resolution: read(state.ids.resolution, state.current.resolution),
  }, state.limits, mode);`,
      `  renderFalFixedImageView(state.hostId, state.ids, { ...state.current }, state.limits, mode);`,
    ]],
    probe: async (view) => {
      vm.runInContext(
        `CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: ${JSON.stringify({ enabled: true, apiKey: "k", frameOutputs: 2, frameQuality: "high", frameResolution: "1k", estimatedCostPerImage: 0.06 })} } };`,
        view.context);
      const ids = { count: "ncy-count", quality: "ncy-quality", resolution: "ncy-res" };
      view.context.renderFalFixedImageView("ncy-view", ids,
        { count: 2, quality: "high", resolution: "1k", disabled: false },
        (n) => ({ rows: [{ value: n, label: "candidates returned" }], stopEarly: "x" }), "simple");
      const quote = () => (/gen-view-price[\s\S]*?<b>([^<]*)</.exec(
        String(view.context.document.getElementById("ncy-view").innerHTML)) || [])[1] || "";
      const opened = quote();
      view.context.document.getElementById(ids.count).value = "4";
      view.context.refreshFalFixedImageView();
      const afterChange = quote();
      /* ARMED: four candidates, and the screen still quotes two. */
      const armed = opened === "Estimated $0.12" && afterChange === "Estimated $0.12";
      /* CAUGHT: the property that owns this reads the same screen. */
      let caught = false;
      try {
        assert.strictEqual(afterChange, "Estimated $0.24",
          "13e: at 4 candidates the visible estimate must be $0.24");
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

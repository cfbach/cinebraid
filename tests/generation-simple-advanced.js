/* CineBraid — Batch 2, Slice 4: SIMPLE VS ADVANCED GENERATION + PRICE TRUTH.
 *
 * "Make this, about this good, for about this much" — without first learning fifteen
 * provider controls.
 *
 * Two claims, and this suite exists to prove both and to prove what they did NOT change.
 *
 * CLAIM ONE — A CONTROL THAT IS NOT RENDERED CONTRIBUTES NOTHING TO THE PAYLOAD.
 * Not "is rendered disabled". Not "is rendered at the model's default". Absent. The
 * failure this prevents costs money: a settings grid draws CFG, steps and seed for every
 * model because some model somewhere supports them, greys out the ones this model does
 * not, and ships their defaults in the request anyway. Sections 2 and 3 assert the screen
 * and the request come out of ONE derivation, so they cannot disagree about what was
 * offered — and section 4 asserts the same of a view switch: a value typed under Advanced
 * does not survive a return to Simple merely because it was typed.
 *
 * CLAIM TWO — ONE RATE, TWO READERS.
 * Before this slice the browser quoted a MiniMax H3 render from a hard-coded $0.26 per
 * second inside falH3CostEstimate() and printed "about $2.60 USD" beside the paid button,
 * while generation-cost.js recorded `confidence: "unknown"` for the same job because it
 * had no motion rate to read. Two authorities, two answers, and the filmmaker only ever
 * saw one of them. Section 5 proves the pre-flight quote and the durable record now
 * derive from the same configured rate through the same function, and sections 6 and 7
 * prove the honest answers survived: no configured rate is UNKNOWN rather than $0.00, a
 * legacy row is never backfilled, and an estimate never becomes an actual.
 *
 * Sections, mapped to the slice's acceptance list:
 *
 *   1  A      Simple is the default on every generation surface
 *   2  C/15/16 controls are capability-driven; an unsupported one is absent, not disabled
 *   3  C/D    the payload is the render plan read differently
 *   4  D/17   Advanced -> Simple cannot ship a hidden value
 *   5  E/7    one configured rate feeds the quote and the record
 *   6  F/K/14 the rate's provenance and freshness, and the refusal to invent either
 *   7  G/H/J/10/11/13 unknown stays unknown, legacy stays untouched, estimate stays estimate
 *   8  B/5/6  recommendation comes from the accepted authority or says it cannot
 *   9  I/12   local is "$0 provider charge" and never "Free"
 *  10  L/M/N  time, limits and stop-early claim only what exists
 *  11  P/18/19 nothing closed was reopened; paid-dispatch truth stays visible
 *  12  20/21  Slices 1-3 preserved, no Slice 5 vocabulary anywhere
 *
 * Provider calls: 0. Paid calls: 0. Nothing is written to any project on disk.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readLF = (file) => read(file).replace(/\r\n/g, "\n");
const { render, buildFixture } = require("./render-harness");

const Presentation = require("../public/shared-generation-presentation");
const Rate = require("../public/shared-generation-rate");
const Capability = require("../public/shared-generation-capability");
const { submissionAccounting, recordedEstimate, recordedAmount, summarizeRecordedCost } = require("../generation-cost");
const { validateCostEstimate } = require("../generation-contracts");

const notes = [];
const note = (line) => notes.push(line);

/* Comments name what they retired, so a source census that included prose would count the
   explanation as the thing. Same strip the Slice 2 and Slice 3 suites use. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

/* ------------------------------------------------------------------ detectors
   Lifted out so the negative controls exercise the SAME predicate the positive
   assertions rely on, rather than a lookalike that could pass while the real one
   is broken. */
const detectors = {
  /* A control is DRAWN when the panel carries an element carrying its id. */
  drawn(html, id) {
    return new RegExp(`id="${id}"`).test(String(html));
  },
  /* The view a panel is actually showing, from the panel's own stamp rather than from
     what the caller believes it asked for. */
  viewMode(html) {
    return (/data-gen-view="([a-z]+)"/.exec(String(html)) || [])[1] || "";
  },
  /* Every key a payload carries that the control vocabulary claims. */
  controlKeys(payload) {
    return Object.keys(payload || {}).filter((key) => Presentation.CINEBRAID_CONTROL_PAYLOAD_KEYS.includes(key)).sort();
  },
  /* Money words that must never appear together with a route CineBraid is not billed
     for. "Free" is the one every generation UI reaches for and it is the false one. */
  saysFree(html) {
    return /\bfree\b/i.test(String(html).replace(/free[- ]?(text|prose|form)/gi, ""));
  },
  /* A confident zero. `$0 provider charge` is a claim about the PROVIDER and is allowed;
     a bare `$0.00` where the price is unknown is the fiction. */
  saysZeroDollars(html) {
    return /\$0\.00/.test(String(html));
  },
};

/* ---------------------------------------------------------- capability fixtures

   Deliberately NOT the shipped models. Neither GPT Image 2 nor MiniMax H3 supports a
   seed, CFG or steps, so a suite that only used them could not tell "the control is
   capability-gated" from "this code has never heard of a seed". These two layers make
   the mechanism observable in both directions. */
const CAPABLE_OF_EVERYTHING = {
  resolutions: ["1024x1024", "2048x1152"],
  qualityTiers: ["low", "medium", "high"],
  aspectRatios: ["16:9", "2.39:1"],
  durationSeconds: [5, 15],
  flags: { seed: true, candidateBatching: true, referenceWeights: true, cfgScale: true, steps: true },
};
const CAPABLE_OF_NOTHING_EXTRA = {
  resolutions: ["1024x1024"],
  qualityTiers: ["low", "high"],
  aspectRatios: ["16:9"],
  durationSeconds: null,
  flags: { seed: false, candidateBatching: true, referenceWeights: false, cfgScale: false, steps: false },
};

const EXPERT_CONTROLS = ["seed", "cfgScale", "steps", "referenceStrength"];

/* One shot fixture and one stubbed compile, so the dialog sections all open the same
   screen and differ only in what they then do to it. */
function framePlanPayload(overrides = {}) {
  return {
    ok: true, refusal: null, mode: "t2i", purpose: "frame",
    compiledPrompt: "COMPILED FRAME PROMPT", outputCount: 2,
    quality: "high", size: "2048x1152",
    sizes: ["1024x1024", "2048x1152", "3840x2160"],
    qualityTiers: ["auto", "low", "medium", "high"],
    aspectRatio: "16:9", references: [], warnings: [], coverage: {},
    seedSupported: false,
    source: { buildId: "b1", packageId: "p1", frameLabel: "A" },
    compiler: { packId: "gpt-image-2", packVersion: "1" },
    dispatch: { model: "openai/gpt-image-2" },
    ...overrides,
  };
}

const PICKER_SCRIPTS = ["shared-model-intelligence.js", "generation-picker.js"];
function withPicker(view) {
  /* render-harness evaluates SCRIPT_ORDER, which still does not include every script
     index.html loads. These two are evaluated into the SAME context here rather than
     widened into the shared order — every one of these scripts declares top-level
     `const`s in one shared scope, so a second evaluation is a SyntaxError on the first
     repeated identifier and takes the whole context with it. */
  for (const file of PICKER_SCRIPTS)
    vm.runInContext(readLF(path.join("public", file)), view.context, { filename: file });
  return view;
}
function setClientConfig(view, fal) {
  /* CONFIG is a top-level `let` in the evaluated client scripts — a lexical binding, not
     a property of the contextified global — so assigning context.CONFIG from out here
     would create a second, invisible one. */
  vm.runInContext(
    `CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: ${JSON.stringify({ enabled: true, apiKey: "test-key", ...fal })} } };`,
    view.context,
  );
}

async function openFrameDialog(fal = {}, planOverrides = {}) {
  const view = withPicker(await render("#/shot/L1-01", buildFixture()));
  setClientConfig(view, fal);
  let submitted = null;
  view.context.fetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : {};
    if (String(url).includes("/api/generation/fal/image/plan"))
      return { ok: true, json: async () => framePlanPayload(planOverrides) };
    /* THE SUBMISSION ENDPOINT EXACTLY. Polling POSTs to
       /api/generation/fal/jobs/<id>/refresh with NO BODY, so a stub matching the path
       prefix — or even the method — overwrites the captured submission with {}. The
       control would then report a pass while inspecting an empty object, which is the
       failure mode where a test agrees with everything. */
    if (/\/api\/generation\/fal\/jobs$/.test(String(url))) {
      submitted = body;
      return { ok: true, json: async () => ({ job: { id: "job-1", status: "COMPLETED", purpose: body.purpose } }) };
    }
    if (String(url).includes("/api/generation/fal/jobs"))
      return { ok: true, json: async () => ({ job: { id: "job-1", status: "COMPLETED" } }) };
    return { ok: true, json: async () => ({ options: [], normal: [] }) };
  };
  await view.context.openFalFrameGenerationModal("frame", "L1-01", "FR-A", "b1");
  await new Promise((resolve) => setTimeout(resolve, 25));
  return {
    view,
    panel: () => view.context.document.getElementById("fal-frame-generation-view").innerHTML,
    submittedBody: () => submitted,
  };
}

/* ==================================================== 1 · SIMPLE IS THE DEFAULT */
async function simpleIsDefaultSection() {
  /* The derivation itself, before any screen: an unspecified mode is Simple, and a
     nonsense one is Simple rather than an error — a generation surface that failed
     closed on a corrupt preference would be unopenable. */
  assert.strictEqual(Presentation.generationViewMode(undefined), "simple");
  assert.strictEqual(Presentation.generationViewMode(""), "simple");
  assert.strictEqual(Presentation.generationViewMode("expert"), "simple");
  assert.strictEqual(Presentation.generationViewMode("advanced"), "advanced");
  assert.deepStrictEqual(Presentation.CINEBRAID_GENERATION_VIEW_MODES, ["simple", "advanced"]);

  const frame = await openFrameDialog();
  assert.strictEqual(detectors.viewMode(frame.panel()), "simple",
    "A: the compiled frame dialog must open on Simple");

  /* And the planner, which is a different file rendering the same block. */
  const planner = withPicker(await render("#/shot/L1-01", buildFixture()));
  setClientConfig(planner, {});
  planner.context.openShotAutomationModal("L1-01");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const plannerPanel = planner.context.document.getElementById("shot-generation-view").innerHTML;
  assert.strictEqual(detectors.viewMode(plannerPanel), "simple",
    "A: the full-shot planner must open on Simple too");

  note("1. A · Simple is the default in the derivation, on the compiled frame dialog and on the automation planner");
}

/* ============================== 2 · CONTROLS ARE CAPABILITY-DRIVEN, NOT UNIVERSAL */
function capabilityDrivenSection() {
  /* THE SHIPPED TRUTH FIRST. Neither model in the catalogue declares a seed, and the
     two sampler flags are declared by nothing at all — so the four expert controls
     render on nothing today. That is the honest state of the product and it is asserted
     rather than assumed. */
  for (const flag of ["cfgScale", "steps"])
    assert(Capability.CINEBRAID_CAPABILITY_FLAGS.includes(flag),
      `C: ${flag} must be expressible as a capability, or its absence cannot be derived`);
  const undeclared = Capability.resolveCapability({ model: { modes: ["t2i"] } });
  for (const flag of ["seed", "cfgScale", "steps", "referenceWeights"])
    assert.strictEqual(undeclared.flags[flag], false,
      `C: a capability nothing declares must resolve ${flag} to false, not to undefined`);

  /* A model that HAS them draws them under Advanced... */
  const rich = Presentation.generationControlPlan({ capability: CAPABLE_OF_EVERYTHING, mode: "advanced" });
  for (const key of EXPERT_CONTROLS)
    assert(rich.rendered.includes(key), `C: ${key} must render for a model that declares it`);

  /* ...and a model that has none draws none of them, in EITHER view. */
  for (const mode of ["simple", "advanced"]) {
    const poor = Presentation.generationControlPlan({ capability: CAPABLE_OF_NOTHING_EXTRA, mode });
    for (const key of EXPERT_CONTROLS) {
      assert(!poor.rendered.includes(key), `C/15/16: ${key} must not render in ${mode} for a model without it`);
      assert(poor.unsupported.includes(key), `C: and it must be reported as unsupported rather than silently missing`);
    }
    /* NOT "disabled with a default value" — absent. The distinction is the whole
       requirement, and `supported` vs `rendered` is where it lives. */
    for (const row of poor.controls.filter((control) => EXPERT_CONTROLS.includes(control.key))) {
      assert.strictEqual(row.supported, false);
      assert.strictEqual(row.rendered, false);
      assert(row.reason, `C: an unsupported control must carry the sentence saying why`);
    }
  }

  /* An EMPTY enum is "no legal value" and removes the control; a NULL enum is "nobody
     constrained it" and does not. Collapsing those two is how a control every layer was
     happy to allow disappears. */
  const empty = Presentation.generationControlPlan({ capability: { resolutions: [], flags: {} }, mode: "advanced" });
  assert(empty.unsupported.includes("resolution"), "C: an empty resolution set must remove the control");
  const unconstrained = Presentation.generationControlPlan({ capability: { resolutions: null, flags: {} }, mode: "advanced" });
  assert(unconstrained.rendered.includes("resolution"), "C: an unconstrained resolution must not be mistaken for an empty one");

  note("2. C/15/16 · CFG, steps, seed and reference strength are declared capabilities; they render for a model that has them, "
    + "and for a model that does not they are absent in both views rather than disabled with a default");
}

/* ================================ 3 · THE PAYLOAD IS THE PLAN, READ DIFFERENTLY */
function payloadIsThePlanSection() {
  for (const [label, capability] of [["capable", CAPABLE_OF_EVERYTHING], ["plain", CAPABLE_OF_NOTHING_EXTRA]]) {
    for (const mode of ["simple", "advanced"]) {
      const plan = Presentation.generationControlPlan({ capability, mode });
      const renderedKeys = plan.controls.filter((row) => row.rendered).flatMap((row) => row.payloadKeys).sort();
      assert.deepStrictEqual(plan.payloadKeys, Array.from(new Set(renderedKeys)).sort(),
        `C/D: ${label}/${mode} — what may be submitted must be exactly what was rendered`);
    }
  }

  /* And the gate that enforces it, over a body carrying every control at once. */
  const body = {
    prompt: "P", shotId: "L1-01", sourceBuildId: "b1", references: [],
    outputCount: 3, quality: "high", resolution: "1024x1024", aspectRatio: "16:9",
    seed: 42, cfgScale: 7, steps: 30, referenceStrength: 0.8,
  };
  const plain = Presentation.generationControlPlan({ capability: CAPABLE_OF_NOTHING_EXTRA, mode: "advanced" });
  const gated = Presentation.restrictPayloadToPlan(body, plain);
  for (const key of ["seed", "cfgScale", "steps", "referenceStrength"])
    assert(!(key in gated.payload), `C: ${key} is unsupported and must not survive into the payload`);
  assert.deepStrictEqual(gated.removed, ["cfgScale", "referenceStrength", "seed", "steps"],
    "C: and the removal must be reported rather than silent");

  /* THE REQUEST ITSELF IS NOT A SETTING. A filter that could not tell the prompt from a
     control would quietly delete the request. */
  for (const key of ["prompt", "shotId", "sourceBuildId", "references"])
    assert(key in gated.payload, `C: ${key} is the request, not a control, and must pass through untouched`);

  /* AN UNSUPPORTED CONTROL CANNOT SHIP FROM A SURFACE THAT NEVER DECLARED IT. `only`
     narrows what may be DRAWN; it must never widen what may be SENT, or a surface that
     simply forgot to list `seed` would be free to ship one. */
  const narrow = Presentation.generationControlPlan({
    capability: CAPABLE_OF_NOTHING_EXTRA, mode: "advanced", only: ["quality"],
  });
  const narrowed = Presentation.restrictPayloadToPlan(body, narrow);
  for (const key of EXPERT_CONTROLS)
    assert(!(key in narrowed.payload), `C: ${key} must be stripped even though this surface never declared it`);
  /* A control the surface does not own and the model DOES support is none of this
     gate's business — the frame dialog shows the shot's aspect ratio rather than
     offering a picker, and stripping the key would hand the server its literal "16:9"
     fallback and silently reframe a scope production. */
  assert.strictEqual(narrowed.payload.aspectRatio, "16:9",
    "C: a supported control outside the surface's vocabulary must travel untouched");

  note("3. C/D · rendered controls and permitted payload keys are one derivation; an unsupported control is stripped from any "
    + "surface whether or not it declared it, and the request itself is never mistaken for a setting");
}

/* ============================= 4 · ADVANCED -> SIMPLE CANNOT SHIP A HIDDEN VALUE */
async function viewSwitchSection() {
  const advanced = Presentation.generationControlPlan({ capability: CAPABLE_OF_EVERYTHING, mode: "advanced" });
  const simple = Presentation.generationControlPlan({ capability: CAPABLE_OF_EVERYTHING, mode: "simple" });
  const typed = { prompt: "P", outputCount: 2, quality: "high", resolution: "2048x1152", seed: 99, cfgScale: 7, steps: 30 };

  /* Under Advanced every one of them is legitimately in the request. */
  const underAdvanced = Presentation.restrictPayloadToPlan(typed, advanced).payload;
  for (const key of ["resolution", "seed", "cfgScale", "steps"])
    assert(key in underAdvanced, `D: ${key} must be submittable while Advanced is showing`);

  /* Return to Simple and the SAME typed values cannot travel. */
  const underSimple = Presentation.restrictPayloadToPlan(typed, simple).payload;
  for (const key of ["resolution", "seed", "cfgScale", "steps"])
    assert(!(key in underSimple), `D/17: ${key} must not survive a return to Simple merely because it was typed`);
  assert.deepStrictEqual(detectors.controlKeys(underSimple), ["outputCount", "quality"],
    "D: a Simple submission carries exactly the Simple controls");

  /* THE SCREEN AGREES WITH THE PAYLOAD. Advanced controls are REMOVED from the DOM, not
     hidden — a hidden input still answers getElementById().value and would keep shipping
     whatever was last typed into it. */
  const frame = await openFrameDialog();
  assert(!detectors.drawn(frame.panel(), "fal-frame-size"), "D: Size must be absent from the Simple screen");
  frame.view.context.setGenerationViewMode("advanced");
  assert(detectors.drawn(frame.panel(), "fal-frame-size"), "D: and present under Advanced");
  frame.view.context.setGenerationViewMode("simple");
  assert(!detectors.drawn(frame.panel(), "fal-frame-size"),
    "D/17: returning to Simple must REMOVE the control, not hide it");

  /* And the dialog says so, rather than dropping the value invisibly. A guarantee the
     filmmaker cannot see is indistinguishable from a bug. */
  assert(/Simple is not asking about/i.test(frame.panel()),
    "D: Simple must name the expert settings it is not asking about and what happens instead");

  /* The real submission, through the real dialog, in each view.
     The harness never parses markup into live elements, so the prompt textarea has to be
     given the value a filmmaker's browser would already have put there — without it the
     dialog refuses on an empty prompt and the control below would pass against a
     dispatch that never happened. */
  frame.view.context.document.getElementById("fal-frame-prompt-editor").value = "COMPILED FRAME PROMPT";
  await frame.view.context.startFalFrameGeneration();
  const simpleBody = frame.submittedBody();
  assert(simpleBody, "D: the dialog must have submitted");
  assert(!("resolution" in simpleBody), "D/17: a Simple dispatch must not carry the expert size");
  for (const key of EXPERT_CONTROLS)
    assert(!(key in simpleBody), `D: nor ${key}, which this model does not support at all`);
  assert.strictEqual(simpleBody.prompt, "COMPILED FRAME PROMPT", "D: and the request itself must be intact");

  note("4. D/17 · an Advanced value cannot ride back into a Simple submission — the control is removed from the DOM rather "
    + "than hidden, the payload gate refuses the key, the dispatch carries neither, and Simple states what it is not asking about");
}

/* ================================== 5 · ONE CONFIGURED RATE, QUOTE AND RECORD */
function oneRateSection() {
  const CONFIGURED = { generation: { fal: { motionRate: { usdPerSecond: 0.26, source: "fal pricing page", asOf: "2026-08-15" } } } };
  const rate = Rate.configuredMotionRate(CONFIGURED);
  assert.strictEqual(rate.configured, true);
  assert.strictEqual(rate.basis, "second");
  assert.strictEqual(rate.configPath, "generation.fal.motionRate.usdPerSecond");

  /* THE QUOTE the dialog draws, and THE RECORD the ledger keeps, for the same 8 seconds. */
  const quote = Rate.generationPriceLine({ rate, quantity: 8, local: false });
  const record = submissionAccounting({ purpose: "motion-h3", outputCount: 1, motionRate: rate, durationSeconds: 8, at: "2026-08-18T00:00:00.000Z" });
  assert.strictEqual(quote.kind, "estimated");
  assert.strictEqual(record.estimate.confidence, "estimated");
  assert.strictEqual(quote.amount, record.estimate.amount,
    "E/7: the pre-flight quote and the recorded estimate must be the same number");
  assert.strictEqual(record.estimate.amount, 2.08, "E: 8 seconds at 0.26 is 2.08 and nothing rounds it away");
  assert.strictEqual(record.basis.ratePerUnit, 0.26);
  assert.strictEqual(record.basis.unitBasis, "second");
  assert.strictEqual(record.basis.quantity, 8);
  assert(validateCostEstimate(record.estimate).ok, "E: and the record still satisfies the accepted cost contract");

  /* Change the configured rate and BOTH move together. Two independent authorities would
     have shown up here as one of them standing still. */
  const dearer = Rate.configuredMotionRate({ generation: { fal: { motionRate: { usdPerSecond: 0.52 } } } });
  assert.strictEqual(
    Rate.generationPriceLine({ rate: dearer, quantity: 8 }).amount,
    submissionAccounting({ purpose: "motion-h3", outputCount: 1, motionRate: dearer, durationSeconds: 8, at: "t" }).estimate.amount,
    "E/7: the quote and the record must move together when the configured rate moves",
  );

  /* THERE IS ONE DERIVATION, and it is required rather than reimplemented. */
  const costSource = codeOnly(readLF("generation-cost.js"));
  assert(/require\(["']\.\/public\/shared-generation-rate["']\)/.test(costSource),
    "E: the recording authority must call the shared derivation rather than keep its own");
  assert(!/rate\s*\*\s*quantity|ratePerImage\s*\*/.test(costSource),
    "E: and must not multiply a rate itself");
  /* THE HARD-CODED BROWSER RATE IS GONE, not moved. */
  const client = readLF("public/fal-generation.js");
  assert(!/falH3CostEstimate/.test(codeOnly(client)), "E: the browser's own H3 cost function must be gone");
  assert(!/0\.26/.test(codeOnly(client)), "E: and the per-second figure must not survive anywhere in the browser");
  assert(/configuredMotionRate/.test(codeOnly(client)), "E: the dialog must read the configured rate instead");

  /* The image rate travels the same road, so there is not a second arrangement for
     stills. */
  const imageRate = Rate.configuredImageRate({ generation: { fal: { estimatedCostPerImage: 0.06 } } });
  assert.strictEqual(
    Rate.generationPriceLine({ rate: imageRate, quantity: 4 }).amount,
    submissionAccounting({ purpose: "frame", outputCount: 4, ratePerImage: 0.06, at: "t" }).estimate.amount,
    "E: the image quote and the image record must agree the same way",
  );

  note("5. E/7 · one configured rate feeds both readers: the pre-flight quote and the durable record produce the same number "
    + "for the same request, move together when the rate moves, and the hard-coded browser figure is deleted rather than relocated");
}

/* ============================================ 6 · PROVENANCE AND FRESHNESS */
function provenanceSection() {
  const full = Rate.rateProvenance(Rate.configuredMotionRate({
    generation: { fal: { motionRate: { usdPerSecond: 0.26, source: "fal pricing page", asOf: "2026-08-15" } } },
  }));
  assert.strictEqual(full.configured, true);
  assert.strictEqual(full.asOf, "2026-08-15");
  assert(/fal pricing page/.test(full.line) && /as of 2026-08-15/.test(full.line),
    "K/14: a rate with provenance must show both where it came from and when it was read");

  /* NO SOURCE, NO DATE — and it says so rather than implying verification. */
  const bare = Rate.rateProvenance(Rate.configuredMotionRate({ generation: { fal: { motionRate: { usdPerSecond: 0.26 } } } }));
  assert(/source not recorded/.test(bare.line) && /freshness unknown/.test(bare.line),
    "K: an unattributed rate must admit both gaps");
  assert(!/verified|confirmed|checked/i.test(bare.line), "K: and must claim no verification");

  /* A DATE NOBODY WROTE IS NOT A DATE. Anything that is not an ISO calendar date becomes
     empty and renders as unknown — a freshness stamp defaulted to today would be exactly
     the manufactured verification this field exists to prevent. */
  for (const bad of ["recently", "last week", "2026-8-1", "", null, undefined, "2026/08/15"]) {
    const parsed = Rate.configuredMotionRate({ generation: { fal: { motionRate: { usdPerSecond: 0.26, asOf: bad } } } });
    assert.strictEqual(parsed.asOf, "", `K: ${JSON.stringify(bad)} is not a date and must not become one`);
  }
  /* And config.js agrees, so a hand-edited file cannot smuggle one in. */
  const { normalizeConfig } = require("../config");
  const normalized = normalizeConfig({ generation: { fal: { motionRate: { usdPerSecond: "0.26", source: " fal ", asOf: "yesterday" } } } });
  assert.strictEqual(normalized.generation.fal.motionRate.asOf, "", "F/K: the config normaliser must refuse a non-date too");
  assert.strictEqual(normalized.generation.fal.motionRate.usdPerSecond, 0.26);
  assert.strictEqual(normalized.generation.fal.motionRate.source, "fal");
  /* Bounded like the per-image rate it sits beside. */
  assert.strictEqual(normalizeConfig({ generation: { fal: { motionRate: { usdPerSecond: -5 } } } }).generation.fal.motionRate.usdPerSecond, 0);
  assert.strictEqual(normalizeConfig({ generation: { fal: { motionRate: { usdPerSecond: 9999 } } } }).generation.fal.motionRate.usdPerSecond, 100);

  /* NO PRICE TABLE. The rate ships at zero and CineBraid carries no provider prices. */
  const { DEFAULT_CONFIG } = require("../config");
  assert.strictEqual(DEFAULT_CONFIG.generation.fal.motionRate.usdPerSecond, 0,
    "O: CineBraid must ship no price; an unconfigured install knows nothing");
  assert.strictEqual(DEFAULT_CONFIG.generation.fal.motionRate.source, "");
  assert.strictEqual(DEFAULT_CONFIG.generation.fal.motionRate.asOf, "");
  /* NO HARD-CODED RATE ANYWHERE IN THE DERIVATION. Stated as "no literal is ever assigned
     to a rate field" rather than "no decimal appears in the file", because the module
     legitimately contains a 0.01 sub-cent display threshold and a 1e6 rounding factor —
     a detector that fired on those is one nobody could keep, and a detector nobody keeps
     gets deleted the first time it is inconvenient. */
  for (const file of ["public/shared-generation-rate.js", "public/shared-generation-presentation.js", "public/generation-view.js", "generation-cost.js"]) {
    const source = codeOnly(readLF(file));
    for (const pattern of [/usdPerSecond\s*[:=]\s*[\d.]+/, /ratePerUnit\s*[:=]\s*[\d.]+/, /amount\s*[:=]\s*\d+\.\d+/, /perSecond\s*[:=]\s*[\d.]+/, /estimatedCostPerImage\s*[:=]\s*[\d.]+/])
      assert(!pattern.test(source), `O: ${file} must hold no hard-coded rate (${pattern})`);
  }

  note("6. F/K/14 · the rate carries where it came from and when it was read, admits both gaps when it has neither, refuses any "
    + "freshness value that is not an ISO date, and ships unconfigured — CineBraid holds no provider price table");
}

/* ============ 7 · UNKNOWN STAYS UNKNOWN · LEGACY STAYS UNTOUCHED · ESTIMATE STAYS ESTIMATE */
function unknownAndLegacySection() {
  /* NEW JOB, NO CONFIGURED RATE -> unknown. Not $0.00, not last year's number. */
  const unconfigured = Rate.configuredMotionRate({ generation: { fal: {} } });
  assert.strictEqual(unconfigured.configured, false);
  const unpriced = submissionAccounting({ purpose: "motion-h3", outputCount: 1, motionRate: unconfigured, durationSeconds: 8, at: "t" });
  assert.strictEqual(unpriced.estimate.confidence, "unknown", "G/9: no applicable rate must record unknown");
  assert.strictEqual(unpriced.estimate.amount, undefined, "J: an unknown cost must carry no amount at all");
  assert.strictEqual(recordedAmount({ accounting: unpriced }), null, "J: and unknown must never read back as zero");
  assert(validateCostEstimate(unpriced.estimate).ok);

  /* A PER-IMAGE RATE STILL CANNOT PRICE A VIDEO — the rule that predates this slice. */
  const wrongBasis = submissionAccounting({ purpose: "motion-h3", outputCount: 1, ratePerImage: 0.06, at: "t" });
  assert.strictEqual(wrongBasis.estimate.confidence, "unknown", "J: a per-image rate must not price a video");
  assert.strictEqual(wrongBasis.basis.unitBasis, "video");

  /* NEW JOB, CONFIGURED RATE -> estimated. Both halves of requirement G, together. */
  const rate = Rate.configuredMotionRate({ generation: { fal: { motionRate: { usdPerSecond: 0.26 } } } });
  assert.strictEqual(
    submissionAccounting({ purpose: "motion-h3", outputCount: 1, motionRate: rate, durationSeconds: 8, at: "t" }).estimate.confidence,
    "estimated", "G/8: a configured applicable rate must record an estimate");

  /* LEGACY JOB -> untouched. Read, classified as unrecorded, and never written to. */
  const legacy = Object.freeze({ id: "legacy", purpose: "motion-h3", outputCount: 1, durationSeconds: 8 });
  assert.strictEqual(recordedEstimate(legacy), null, "G/10: a legacy row carries no estimate");
  assert.strictEqual(recordedAmount(legacy), null, "G: and reading it must not invent one");
  const summary = summarizeRecordedCost([legacy]);
  assert.strictEqual(summary.unrecorded, 1, "G/10: it is counted as unrecorded rather than as free");
  assert.strictEqual(summary.priced, 0);
  assert.strictEqual(summary.complete, false, "G: and a history containing it never claims to be complete");
  /* The row is frozen: any backfill attempt would have thrown by now. */
  assert.deepStrictEqual(Object.keys(legacy).sort(), ["durationSeconds", "id", "outputCount", "purpose"],
    "G/10: nothing may be added to a legacy row on read");

  /* ESTIMATE IS NEVER ACTUAL, in the record or in the words. */
  const priced = submissionAccounting({ purpose: "frame", outputCount: 2, ratePerImage: 0.06, at: "t" });
  assert.strictEqual(priced.estimate.confidence, "estimated");
  assert(!("actualCost" in priced) && !("charged" in priced) && !("actual" in priced.estimate),
    "H/11: nothing in the record may present the estimate as provider spend");
  assert(!("quotedAt" in priced.estimate), "H: and `quoted` is reserved for a provider that actually quoted");
  const line = Rate.generationPriceLine({ rate: Rate.configuredImageRate({ generation: { fal: { estimatedCostPerImage: 0.06 } } }), quantity: 2 });
  assert(/^Estimated /.test(line.headline), "H/11: the price a filmmaker reads must lead with the word estimated");
  assert(/not provider billing/i.test(line.detail), "H: and say plainly that it is not billing");

  note("7. G/H/J/10/11/13 · a new job records an estimate only when an applicable rate is configured and unknown otherwise, "
    + "a per-image rate still cannot price a video, a legacy row is read and left alone, and no estimate is ever worded as spend");
}

/* ================================================== 8 · RECOMMENDATION AUTHORITY */
function recommendationSection() {
  /* THE ACCEPTED SOURCE, and only it. A decided guide naming a model that is on offer
     produces a recommendation carrying the guide's own words. */
  const decided = Presentation.generationRecommendation({
    guide: { decisionState: "decided", recommended: "beta/model", why: "Chosen on the evaluation record." },
    options: [
      { optionId: "a", modelId: "alpha/model", modelName: "Alpha" },
      { optionId: "b", modelId: "beta/model", modelName: "Beta" },
      { optionId: "c", modelId: "gamma/model", modelName: "Gamma" },
    ],
  });
  assert.strictEqual(decided.available, true);
  assert.strictEqual(decided.modelId, "beta/model");
  assert.strictEqual(decided.option.optionId, "b", "B: the recommendation must be matched by model id");
  assert(/Chosen on the evaluation record/.test(decided.detail), "B: and carry the guide's own rationale");

  /* NEVER FROM LIST POSITION. The same option list with an UNDECIDED guide must produce
     no recommendation at all — not the first item, not the last, not the alphabetically
     first. resolveCapability alphabetises its results and reading position as quality is
     how "the best resolution" once became 768P. */
  const positions = [
    { label: "undecided", guide: { decisionState: "undecided-pending-evaluation", shortlist: { recommended: [{ modelId: "alpha/model" }] } } },
    { label: "no guide", guide: null },
    { label: "decided but names nobody", guide: { decisionState: "decided", recommended: "" } },
    { label: "names a model nothing offers", guide: { decisionState: "decided", recommended: "delta/model" } },
  ];
  for (const { label, guide } of positions) {
    const options = [
      { optionId: "a", modelId: "alpha/model", modelName: "Alpha", actionable: true },
      { optionId: "z", modelId: "zulu/model", modelName: "Zulu", actionable: true },
    ];
    const result = Presentation.generationRecommendation({ guide, options });
    assert.strictEqual(result.available, false, `B/5: ${label} must produce no recommendation`);
    assert.strictEqual(result.option, null, `B/5: ${label} must not adopt a candidate`);
    assert(/unavailable/i.test(result.headline), `B/6: ${label} must say so truthfully`);
    /* Reversing the list must not change the answer. A derivation that read position
       would flip here and this is the assertion that would catch it. */
    const reversed = Presentation.generationRecommendation({ guide, options: [...options].reverse() });
    assert.deepStrictEqual(
      { available: reversed.available, modelId: reversed.modelId },
      { available: result.available, modelId: result.modelId },
      `B/5: ${label} must give the same answer whatever order the options arrived in`,
    );
  }

  /* A shortlist is NOT a recommendation. The one guide CineBraid ships is undecided and
     carries two shortlisted candidates; promoting either would be the recommendation
     nobody made. */
  const definitions = JSON.parse(readLF("data/model-definitions.json"));
  const guides = definitions.useCaseGuides || [];
  assert(guides.length >= 1, "B: the guide authority must exist for this assertion to mean anything");
  for (const guide of guides) {
    if (guide.decision?.state === "decided") continue;
    const shortlisted = Object.values(guide.decision?.shortlist || {}).flat();
    assert(shortlisted.length >= 1, "B: an undecided guide is expected to carry its shortlist");
    const rendered = Presentation.generationRecommendation({
      guide: { decisionState: guide.decision.state, recommended: guide.decision.recommended },
      options: shortlisted.map((row, index) => ({ optionId: `o${index}`, modelId: row.modelId, modelName: row.modelId })),
    });
    assert.strictEqual(rendered.available, false,
      `B/6: ${guide.useCase} is undecided, so no shortlisted candidate may be promoted to a recommendation`);
  }

  /* WHAT SIMPLE SAYS INSTEAD: the model it is going to use, described as a fit rather
     than as a winner. */
  const standing = Presentation.selectedModelStanding(
    { modelId: "alpha/model", modelName: "Alpha" },
    { available: false },
  );
  assert(/^Compatible choice · Alpha$/.test(standing.label), "B: an unranked model is a compatible choice, not a best");
  assert(/has not ranked/i.test(standing.detail), "B: and says explicitly that nothing was ranked");
  const recommendedStanding = Presentation.selectedModelStanding(
    { modelId: "beta/model", modelName: "Beta" },
    { available: true, modelId: "beta/model", detail: "Because the evaluation says so." },
  );
  assert(/^Recommended · Beta$/.test(recommendedStanding.label), "B: and a real recommendation is named as one");

  /* THE PICKER'S NO-RANKING RULE IS INTACT, and this module did not become a second
     ranking authority. */
  const presentation = codeOnly(readLF("public/shared-generation-presentation.js"));
  assert(!/\.sort\(|\[0\]|\.at\(-1\)|\.at\(0\)/.test(presentation.split("generationRecommendation")[1] || ""),
    "Q: the recommendation derivation must not sort or index into the option list");
  const picker = readLF("public/generation-picker.js");
  assert(/NO RANKING/.test(picker), "Q: the picker's no-ranking rule must still be stated");
  assert(/never sorts, never scores/.test(picker), "Q: and still be the rule it was");

  note("8. B/5/6 · recommendation comes from the use-case guide's own decision or is truthfully unavailable; it is matched by "
    + "model id, is unchanged by list order, refuses to promote a shortlist, and the picker's no-ranking rule is untouched");
}

/* ============================================ 9 · LOCAL, UNKNOWN AND THE WORD FREE */
function priceLanguageSection() {
  /* LOCAL: a claim about the PROVIDER, not about cost. Running weights on the
     filmmaker's own machine costs electricity, hardware and a GPU that cannot do
     anything else meanwhile — "Free" asserts something CineBraid does not know. */
  const local = Rate.generationPriceLine({ rate: Rate.configuredMotionRate({}), quantity: 8, local: true });
  assert.strictEqual(local.kind, "local");
  assert.strictEqual(local.headline, "$0 provider charge", "I/12: a local route says exactly this");
  assert.strictEqual(Rate.CINEBRAID_LOCAL_CHARGE_LINE, "$0 provider charge");
  assert(!detectors.saysFree(local.headline + local.detail), "I/12: and never the word Free");
  assert(/local compute still costs you/i.test(local.detail), "I: it names what local DOES cost");

  /* A local route is priced by nothing, so an unconfigured rate cannot make it wrong. */
  assert.strictEqual(
    Rate.generationPriceLine({ rate: Rate.configuredMotionRate({ generation: { fal: { motionRate: { usdPerSecond: 5 } } } }), quantity: 8, local: true }).headline,
    "$0 provider charge", "I: a configured API rate must not be applied to a local route");

  /* UNKNOWN: unavailable, and never a guessed zero. */
  const unknown = Rate.generationPriceLine({ rate: Rate.configuredMotionRate({}), quantity: 8, local: false });
  assert.strictEqual(unknown.kind, "unavailable");
  assert.strictEqual(unknown.amount, null, "J/13: an unknown price is null, not 0");
  assert(/unavailable/i.test(unknown.headline), "J/13: and says unavailable");
  assert(!detectors.saysZeroDollars(unknown.headline), "J/13: never $0.00");
  assert(!detectors.saysFree(unknown.headline + unknown.detail), "J: and never Free");
  assert(/still paid/i.test(unknown.detail), "J: an unpriced paid route must still say it is paid");

  /* NO SLICE-4-REACHABLE GENERATION SURFACE MAY SAY IT. */
  for (const file of [
    "public/generation-view.js", "public/generation-picker.js", "public/fal-generation.js",
    "public/automation.js", "public/scene-automation.js", "public/shared-generation-rate.js",
    "public/shared-generation-presentation.js",
  ]) {
    const source = codeOnly(readLF(file));
    assert(!/["'`][^"'`]*\bFree\b[^"'`]*["'`]/.test(source),
      `I/12: ${file} must not put the word Free in front of a filmmaker`);
  }

  /* Sub-cent totals are real and must not round to nothing — the same lie as "Free"
     wearing a decimal point. */
  const tiny = Rate.generationPriceLine({ rate: Rate.configuredImageRate({ generation: { fal: { estimatedCostPerImage: 0.0004 } } }), quantity: 1 });
  assert(!/\$0\.00\b/.test(tiny.headline), "I: a real sub-cent charge must not be rendered as $0.00");

  note("9. I/J/12/13 · a local route reads \"$0 provider charge\" and explains what local really costs, an unpriced route reads "
    + "unavailable and still says it is paid, no generation surface contains the word Free, and a sub-cent charge is not rounded away");
}

/* ================================== 10 · TIME, LIMITS AND STOP-EARLY CLAIM ONLY WHAT EXISTS */
function claimsSection() {
  /* NO TIMING TRUTH EXISTS ANYWHERE, so none is offered. Not in the model catalogue, not
     in the provider surfaces, not in a model pack, not in a capability layer. A number
     here would be fabricated, and a fabricated render time in front of a paid button is
     exactly the confident wrongness this slice removes. */
  const time = Presentation.generationTimeEstimate();
  assert.strictEqual(time.available, false, "L: no generation-time estimate may be offered");
  assert.strictEqual(time.seconds, null, "L: and certainly not a number");
  assert(/unavailable/i.test(time.headline), "L: it says unavailable");
  /* ASSERTED ON STRUCTURE, NOT ON PROSE. The catalogue's evidence notes are written by
     people and one of them describes an audio model's documented "latency dial" — a
     sentence about a vendor's feature, not a field CineBraid could read. A free-text scan
     would call that a timing source and the control would be untrue in the direction that
     matters least. What must not exist is a KEY, so the keys are what is checked. */
  const TIMING_KEYS = /^(latency|latencySeconds|typicalDuration|typicalDurationSeconds|generationTime|generationSeconds|etaSeconds|renderTime|renderSeconds|averageDuration)$/i;
  const timingKeysIn = (value, found = []) => {
    if (Array.isArray(value)) value.forEach((row) => timingKeysIn(row, found));
    else if (value && typeof value === "object")
      for (const [key, row] of Object.entries(value)) {
        if (TIMING_KEYS.test(key)) found.push(key);
        timingKeysIn(row, found);
      }
    return found;
  };
  for (const file of ["data/model-definitions.json", "data/provider-surfaces.json"])
    assert.deepStrictEqual(timingKeysIn(JSON.parse(readLF(file))), [],
      `L: ${file} records no timing field, which is why no time may be shown`);
  /* And the capability vocabulary has no member for one either, so a pack could not
     declare it even if a vendor published one. */
  for (const key of ["latency", "generationTime", "renderTime"])
    assert(!Capability.CINEBRAID_CAPABILITY_FLAGS.includes(key),
      `L: ${key} is not a capability CineBraid can resolve, so it cannot be intersected or shown`);

  /* LIMITS ARE RENDERED ONLY WHERE A SURFACE DECLARES THEM. A planner with no rounds
     prints nothing rather than inventing a policy. */
  const view = readLF("public/generation-view.js");
  assert(/rows\.length \|\| stop/.test(view) || /if \(!rows\.length && !stop\) return ""/.test(view),
    "M: an undeclared limit set must render nothing at all");

  /* STOP-EARLY IS CLAIMED ONLY WHERE THE RUN PATH SUPPORTS IT. The automation planners
     really do stop on a passing result — that sentence predates this slice — and the
     single-request dialogs claim cancellation and candidate status instead, which is what
     they actually offer. */
  const automation = readLF("public/automation.js");
  assert(/stops as soon as a guide passes review/.test(automation),
    "N: the blocking planner's real early stop must be stated");
  const client = readLF("public/fal-generation.js");
  assert(/can be cancelled from the shot while it runs/.test(client),
    "N: the motion dialog claims cancellation, which this path genuinely supports");
  assert(!/stops early/i.test(codeOnly(client).split("renderFalH3GenerationView")[1] || ""),
    "N: and does not claim an early stop it has no run loop for");

  note("10. L/M/N · generation time is unavailable because CineBraid records none, limits render only where a surface declares "
    + "them, and stop-early is claimed only by the paths that really have it");
}

/* ================================ 11 · NOTHING CLOSED WAS REOPENED */
function preservationSection() {
  /* The contract vocabulary is untouched: this slice chose values inside the accepted
     CostEstimate and defined no second one. */
  const contracts = readLF("generation-contracts.js");
  assert(/const COST_CONFIDENCES = \[/.test(contracts) || /COST_CONFIDENCES/.test(contracts),
    "P: the cost confidence vocabulary must still live in the contract");
  for (const word of ["estimated", "unknown", "quoted"])
    assert(contracts.includes(`"${word}"`), `P/H: the word ${word} must survive in the contract`);

  /* generationBinding and provenance are not this slice's business and were not touched. */
  const binding = readLF("generation-binding.js");
  for (const forbidden of ["motionRate", "generationViewMode", "generationControlPlan", "restrictPayloadToPlan", "simple", "advanced"])
    assert(!new RegExp(`\\b${forbidden}\\b`).test(binding),
      `P/18: generation-binding.js must not have learned ${forbidden}`);

  /* The picker still refuses to press an option the server did not call actionable, and
     the paid warning still renders before the button rather than after it. */
  const picker = readLF("public/generation-picker.js");
  assert(/PAID GENERATION/.test(picker), "19: the paid-dispatch banner must still be on the dialog");
  assert(/option\.actionable/.test(picker), "19: and a row must still be pressable only when the server said so");

  /* THE COST BLOCK IS OUTSIDE THE DISCLOSURE. Advanced must not be able to hide the
     price, the route or a refusal behind a closed panel. */
  const view = readLF("public/generation-view.js");
  const shell = view.split("function generationViewMarkup")[1] || "";
  /* PRESENT, and then BEFORE. Ordering alone would pass on a shell that had dropped the
     block entirely — indexOf returns -1, and -1 is less than everything. */
  assert(shell.includes("generationAlwaysVisibleMarkup"),
    "S/19: the shell must render the always-visible price and route block at all");
  assert(shell.indexOf("generationAlwaysVisibleMarkup") < shell.indexOf("gen-view-controls"),
    "S/19: price and route must render before, and outside, the controls panel");
  /* And exactly once, so it cannot ALSO be rendered inside the panel. */
  assert.strictEqual(shell.split("generationAlwaysVisibleMarkup").length - 1, 1,
    "S/19: and must not be duplicated inside the controls panel");
  assert(!/gen-view-always[\s\S]{0,200}hidden/.test(view), "S: and must never be conditionally hidden");

  /* Accessibility: the switch is a real tablist of real buttons, not a <details>. app.js
     restores every <details>'s open state by POSITION among the page's details, so a
     freshly computed `open` is overridden by whatever sat at that index last render. */
  assert(/role="tablist"/.test(view) && /role="tab"/.test(view), "S: the switch must be a keyboard tablist");
  assert(/aria-selected=/.test(view) && /aria-controls=/.test(view), "S: with its state exposed");
  assert(/tabindex="\$\{selected \? "0" : "-1"\}/.test(view), "S: and roving tabstop");
  assert(!/<details[^>]*gen-view/.test(view), "S: it must not be a details element");
  const styles = readLF("public/styles.css");
  assert(/\.gen-view-tab:focus-visible/.test(styles), "S: the switch must show a visible focus ring");
  /* Named exactly. `styles.split(".gen-view")[1]` would return only the few characters
     between the first two occurrences of the class, so the old form asserted almost
     nothing about almost none of the block. */
  assert(/@media \(prefers-reduced-motion:no-preference\)\{\.gen-view-tab/.test(styles),
    "S: the switch's transition must be behind a reduced-motion preference");
  assert(!/#[0-9a-f]{6}/i.test((/\.gen-view\{[^}]*\}/.exec(styles) || [""])[0]),
    "S: the block must be built from theme tokens so it renders in both themes");

  note("11. P/18/19/S · the cost contract, generation binding and the picker's paid-dispatch rules are untouched; price and route "
    + "render outside the disclosure; the switch is a keyboard tablist rather than a details, themed from tokens");
}

/* ============================== 12 · SLICES 1-3 PRESERVED, NO SLICE 5 LEAKAGE */
function noLeakageSection() {
  /* Slice 5's vocabulary must not appear anywhere this slice touched. */
  const SLICE_5 = [/\bshot\s*intent\b/i, /\bdelivery\s*route\b/i, /adaptive\s*execution/i, /\bstage[- ]set\s*redesign\b/i];
  for (const file of [
    "public/shared-generation-presentation.js", "public/shared-generation-rate.js", "public/generation-view.js",
    "public/generation-picker.js", "public/fal-generation.js", "public/automation.js", "public/scene-automation.js",
    "config.js", "generation-cost.js",
  ]) {
    const source = readLF(file);
    for (const pattern of SLICE_5)
      assert(!pattern.test(source), `21: ${file} must contain no Slice 5 vocabulary (${pattern})`);
  }
  /* And no persisted route schema was invented. */
  const schema = readLF("ofp/ofp-schema.js");
  for (const invented of ["shotIntent", "deliveryRoute", "executionMethod", "motionRate", "viewMode"])
    assert(!schema.includes(invented), `21/F: ${invented} must not have reached the persistent format`);

  /* Slice 1: the rail and terminal defaults are untouched. */
  const surfaces = readLF("public/creator-surfaces.js");
  assert(/cinebraid-creator-rail-open/.test(surfaces), "20: Slice 1's rail preference key must survive");
  /* Through codeOnly, because live-activity.js names the retired strip in the comment
     explaining WHY it was retired — a census that counted prose would count the
     explanation as the thing. */
  assert(!/automation-global-live-strip/.test(codeOnly(readLF("public/live-activity.js"))),
    "20: and the retired strip must stay retired");

  /* Slice 2: three intents, one recommendation call site. */
  const studio = readLF("public/creation-studio.js");
  assert(/creationRecommendedActionMarkup/.test(studio), "20: Slice 2's shared landing renderer must be intact");
  const app = readLF("public/app.js");
  assert(/creationStartPath|assisted/.test(app + studio), "20: Slice 2's intents must survive");

  /* Slice 3: the coverage default was not flipped by this slice either. */
  const coverage = readLF("public/shared-coverage.js");
  assert(/coverageDemand/.test(coverage), "20: Slice 3's demand projection must survive");
  assert(!/motionRate|generationViewMode|Simple|Advanced/.test(coverage),
    "20/21: and the coverage module must not have learned any of this slice's vocabulary");
  const entities = readLF("public/entities.js");
  assert(!/motionRate|falH3MotionQuote|generationPriceLine/.test(entities),
    "20: Slice 3's reference workspace must not have gained a price authority");

  note("12. 20/21 · Slices 1-3 behaviour is preserved, no Slice 5 vocabulary reached any file this slice touched, and no route "
    + "or rate field entered the persistent format");
}

/* ------------------------------------------------------------------------ run */
async function main() {
  await simpleIsDefaultSection();
  capabilityDrivenSection();
  payloadIsThePlanSection();
  await viewSwitchSection();
  oneRateSection();
  provenanceSection();
  unknownAndLegacySection();
  recommendationSection();
  priceLanguageSection();
  claimsSection();
  preservationSection();
  noLeakageSection();

  console.log([
    "Batch 2 Slice 4 — Simple vs Advanced generation + price truth — passed:",
    ...notes.map((line) => `  - ${line}`),
    "  - 0 provider calls, 0 paid calls, nothing written to any project on disk",
  ].join("\n"));
}

/* Exported so the negative controls observe a reintroduced defect through the REAL
   properties rather than through a lookalike of them. */
module.exports = { detectors, main, CAPABLE_OF_EVERYTHING, CAPABLE_OF_NOTHING_EXTRA, EXPERT_CONTROLS };

/* Guarded, because the negative controls require this file to run it deliberately under a
   mutation. An unguarded auto-run would fire at require time, throw outside the control's
   own try, and escape as a suite crash instead of being recorded as the regression it is. */
if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

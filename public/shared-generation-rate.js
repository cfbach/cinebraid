/* The configured rate a generation is quoted from — ONE derivation, shared by the
 * browser's pre-flight quote and the server's durable record.
 *
 * WHAT THIS FIXES. Before this file there were two independent cost authorities and
 * they disagreed by design. The browser quoted a MiniMax H3 render from
 * `falH3CostEstimate()`, a hard-coded $0.26 per second living in public/fal-generation.js,
 * and printed "about $2.60 USD" beside the paid button. The server then recorded that
 * same job as `confidence: "unknown"`, because generation-cost.js had no motion rate to
 * read and correctly refused to multiply a per-IMAGE rate by a video. So a filmmaker was
 * shown a confident number before paying and a shrug afterwards, and neither surface was
 * wrong about its own inputs — they simply were not the same inputs.
 *
 * So the arithmetic lives here, once, and both sides call it. A quote and a record that
 * derive from one function against one configured rate cannot drift apart; two functions
 * reading two numbers always eventually do.
 *
 * WHAT IS DELIBERATELY NOT HERE: provider price tables. CineBraid ships no prices. Every
 * number this module returns came out of configuration an operator filled in, and a rate
 * nobody configured is UNCONFIGURED — which is not zero, not free, and not last year's
 * published figure. `confidence: "unknown"` is the honest answer and this module returns
 * it without apology.
 *
 * THE RECORD SHAPE IS NOT THIS MODULE'S. `estimate` is the CostEstimate that
 * generation-contracts.js already defines and validateCostEstimate() already tests; this
 * module chooses values inside that shape and defines no second one. generation-cost.js
 * remains the recording authority — it decides WHEN a rate applies to a purpose and what
 * goes on the durable row. This decides only what the arithmetic says.
 *
 * Pure. No network, no filesystem, no clock, and it never edits its arguments.
 */

/* Every rate CineBraid can hold is in US dollars, which is what the CostEstimate
   contract's `unit` vocabulary spells `usd`. */
const CINEBRAID_RATE_UNIT = "usd";

/* What one unit of the quantity IS. A per-image rate multiplies images; a per-second
   rate multiplies seconds of rendered output. These are not interchangeable and the
   whole reason motion recorded `unknown` for so long is that CineBraid only had the
   first and would not fake the second. */
const CINEBRAID_RATE_BASES = ["image", "second"];

/* Every rate here prices a remote paid API call. A local render is not priced by this
   module at all — it is not metered, and see `CINEBRAID_LOCAL_CHARGE_LINE` below. */
const CINEBRAID_RATE_COST_CLASS = "metered_api";

/* THE ONE SENTENCE FOR A LOCAL ROUTE, and the reason it is a constant rather than a
   string each screen writes for itself.
 *
 * "Free" is the word every generation UI reaches for here and it is false. Running
 * weights on the filmmaker's own machine costs electricity, wears hardware and occupies
 * a GPU that cannot do anything else meanwhile. What CineBraid actually knows is much
 * narrower and entirely about the provider: nobody is going to bill for this. So that is
 * what it says, and a control asserts no generation surface may say the other thing. */
const CINEBRAID_LOCAL_CHARGE_LINE = "$0 provider charge";

/* What is shown where no configured rate applies. Never "$0", never "Free", never a
   stale published figure borrowed from a different model. */
const CINEBRAID_RATE_UNAVAILABLE_LINE = "Provider price unavailable";

function rateRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function rateText(value) {
  return String(value == null ? "" : value).trim();
}
/* A rate is a positive finite number or it is not a rate. 0 is the DEFAULT of an
   unconfigured field, so treating it as a real price of zero is the exact fiction this
   module exists to prevent. */
function rateNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
/* Sub-cent rates are ordinary — fractions of a cent per image, fractions of a dollar per
   second — so arithmetic is carried at micro-dollar precision. Display rounding is the
   surface's business, not the record's. */
function roundRateUsd(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 1e6) / 1e6 : 0;
}

/* An ISO calendar date and nothing else. A freshness field that will accept "recently"
   or "last week" is a freshness field that cannot be compared to anything, and one that
   silently accepts today's date when the operator left it blank is a manufactured
   verification timestamp — which is precisely what must never happen. Blank stays blank
   and renders as unknown. */
function rateAsOf(value) {
  const text = rateText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

/* ---------------------------------------------------------------------------
   READING A RATE OUT OF CONFIGURATION.

   Two rates exist and they are not symmetrical, deliberately. The per-image rate has
   been a bare number in Settings since long before this file and gains no provenance
   here — widening it is not this change's business, and a `source` field nobody has
   filled in would render as "not recorded" either way. The motion rate is new and
   carries its provenance from the start, because there was never a moment when it was
   only a number. */

function unconfiguredRate(basis, configPath, why) {
  return {
    configured: false,
    amount: null,
    unit: CINEBRAID_RATE_UNIT,
    basis: String(basis),
    unitNoun: basis === "second" ? "second" : "image",
    configPath: String(configPath),
    source: "",
    asOf: "",
    unpricedReason: String(why || "no-configured-rate"),
  };
}

function configuredImageRate(config) {
  const fal = rateRecord(rateRecord(rateRecord(config)?.generation)?.fal);
  const amount = rateNumber(fal?.estimatedCostPerImage);
  if (!amount) return unconfiguredRate("image", "generation.fal.estimatedCostPerImage");
  return {
    configured: true,
    amount,
    unit: CINEBRAID_RATE_UNIT,
    basis: "image",
    unitNoun: "image",
    configPath: "generation.fal.estimatedCostPerImage",
    /* The per-image field records no provenance and this module will not invent any.
       A screen renders "source not recorded · freshness unknown" from these two empty
       strings, which is true, rather than borrowing the motion rate's. */
    source: "",
    asOf: "",
    unpricedReason: "",
  };
}

function configuredMotionRate(config) {
  const fal = rateRecord(rateRecord(rateRecord(config)?.generation)?.fal);
  const declared = rateRecord(fal?.motionRate);
  const amount = rateNumber(declared?.usdPerSecond);
  if (!amount) return unconfiguredRate("second", "generation.fal.motionRate.usdPerSecond");
  return {
    configured: true,
    amount,
    unit: CINEBRAID_RATE_UNIT,
    basis: "second",
    unitNoun: "second",
    configPath: "generation.fal.motionRate.usdPerSecond",
    /* Whatever the operator wrote down, verbatim. CineBraid cannot check a provider's
       pricing page and does not pretend to: this is a note from the person who read it,
       shown so the next person can judge how much to trust the number. */
    source: rateText(declared?.source),
    asOf: rateAsOf(declared?.asOf),
    unpricedReason: "",
  };
}

/* ---------------------------------------------------------------------------
   THE ARITHMETIC. The only place a rate is ever multiplied by a quantity.

   Returns the CostEstimate the contract defines AND the basis block the durable row
   carries, together, from one calculation — so a quote the filmmaker read and a record
   the ledger kept describe the same multiplication or neither exists. */
function costEstimateFromRate({ rate, quantity } = {}) {
  const applicable = rateRecord(rate) || unconfiguredRate("image", "", "no-rate-supplied");
  /* Whole units. Half an image is not a thing, and a fractional second would be a
     precision this system cannot honour — durations are integers everywhere upstream. */
  const units = Math.max(0, Math.round(Number(quantity) || 0));
  const amountPer = rateNumber(applicable.amount);
  const priced = applicable.configured === true && amountPer > 0 && units > 0;
  const amount = priced ? roundRateUsd(amountPer * units) : null;
  const noun = rateText(applicable.unitNoun) || "unit";

  const estimate = priced
    ? {
      costClass: CINEBRAID_RATE_COST_CLASS,
      unit: CINEBRAID_RATE_UNIT,
      confidence: "estimated",
      amount,
      /* The arithmetic in words, so the figure explains itself years later without a
         Settings value that has since moved. */
      breakdown: [{ label: `${units} ${noun}${units === 1 ? "" : "s"} at ${amountPer} USD each`, amount }],
    }
    : {
      /* Metered and honestly unpriced. The contract refuses an amount beside `unknown`,
         which is exactly the guarantee wanted. */
      costClass: CINEBRAID_RATE_COST_CLASS,
      unit: CINEBRAID_RATE_UNIT,
      confidence: "unknown",
    };

  return {
    priced,
    estimate,
    basis: {
      unitBasis: applicable.basis,
      quantity: units,
      ratePerUnit: priced ? amountPer : null,
      rateSource: priced ? rateText(applicable.configPath) : null,
      ...(priced ? {} : {
        /* The rate first, because it is the more fundamental absence: a job with no
           configured rate would still be unpriced if the quantity were perfect, and
           reporting "no-quantity" for it would send the next reader looking in the
           wrong place. A configured rate that produced nothing can only have had
           nothing to multiply. */
        unpricedReason: applicable.configured === true
          ? "no-quantity"
          : rateText(applicable.unpricedReason) || "no-configured-rate",
      }),
    },
  };
}

/* ---------------------------------------------------------------------------
   PRESENTATION. Words for the four cases a filmmaker must be able to tell apart, and
   nothing else. */

function formatRateUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  /* Sub-cent totals exist and rounding them to $0.00 would render a real charge as
     nothing at all — which is the same lie as "Free" wearing a decimal point. */
  const digits = amount > 0 && amount < 0.01 ? 4 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD",
      minimumFractionDigits: 2, maximumFractionDigits: digits,
    }).format(amount);
  } catch { return `$${amount.toFixed(digits)}`; }
}

/* Where the number came from and how old it is, in the compact form a dialog can carry
   beside the figure. Both halves answer honestly when they do not know, because
   "verified" with no date behind it is worse than no claim at all. */
function rateProvenance(rate) {
  const applicable = rateRecord(rate);
  if (!applicable || applicable.configured !== true)
    return { configured: false, source: "", asOf: "", line: "No rate is configured for this route" };
  const source = rateText(applicable.source);
  const asOf = rateAsOf(applicable.asOf);
  return {
    configured: true,
    source,
    asOf,
    line: [
      "Configured estimate",
      source || "source not recorded",
      asOf ? `as of ${asOf}` : "freshness unknown",
    ].join(" · "),
  };
}

/* The one price line a generation surface may print, chosen from what is actually
   known. Four answers, and they are four different facts:

     local        nobody will bill for this — see CINEBRAID_LOCAL_CHARGE_LINE
     priced       a configured rate multiplied a real quantity
     unavailable  no rate applies, and CineBraid will not guess one
     no quantity  a rate exists but there is nothing yet to multiply it by

   `estimated` is in every priced sentence and cannot be configured out of it. Nothing
   this module returns may be presented as provider billing. */
function generationPriceLine({ rate, quantity, local } = {}) {
  if (local === true)
    return {
      kind: "local",
      amount: 0,
      headline: CINEBRAID_LOCAL_CHARGE_LINE,
      detail: "This route runs on your own machine. Local compute still costs you time, power and hardware — CineBraid is only saying no provider will bill for it.",
      provenance: { configured: false, source: "", asOf: "", line: "" },
    };
  const derived = costEstimateFromRate({ rate, quantity });
  const provenance = rateProvenance(rate);
  if (!derived.priced)
    return {
      kind: "unavailable",
      amount: null,
      headline: CINEBRAID_RATE_UNAVAILABLE_LINE,
      detail: rateRecord(rate)?.configured === true
        ? "A rate is configured, but this request has nothing to price yet."
        : "No verified rate is configured for this model and route, so CineBraid is not showing a number. This generation is still paid.",
      provenance,
    };
  return {
    kind: "estimated",
    amount: derived.estimate.amount,
    headline: `Estimated ${formatRateUsd(derived.estimate.amount)}`,
    detail: `${derived.estimate.breakdown[0].label}. An estimate, not provider billing.`,
    provenance,
  };
}

const GENERATION_RATE_EXPORTS = {
  CINEBRAID_RATE_UNIT,
  CINEBRAID_RATE_BASES,
  CINEBRAID_RATE_COST_CLASS,
  CINEBRAID_LOCAL_CHARGE_LINE,
  CINEBRAID_RATE_UNAVAILABLE_LINE,
  configuredImageRate,
  configuredMotionRate,
  costEstimateFromRate,
  formatRateUsd,
  generationPriceLine,
  rateProvenance,
  roundRateUsd,
  unconfiguredRate,
};

if (typeof window !== "undefined") Object.assign(window, GENERATION_RATE_EXPORTS);
if (typeof module !== "undefined" && module.exports) module.exports = GENERATION_RATE_EXPORTS;

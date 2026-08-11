/* CineBraid — historical generation cost.
 *
 * ONE RULE, and everything in this file exists to hold it: a historical fact and a
 * current policy are different objects.
 *
 * `generation.fal.estimatedCostPerImage` in Settings is a POLICY — it is what the
 * NEXT job will be estimated at. What a job was estimated to cost when it was
 * submitted is a FACT, and a fact does not move when the policy moves. A system that
 * derives the second from the first has no history at all; it has a re-quote, and it
 * silently rewrites what a project spent every time somebody edits a number in
 * Settings.
 *
 * So the estimate is computed ONCE, at submission, from the configuration in effect
 * at that moment, and written onto the durable job row. Every later surface READS
 * that number and never recomputes it.
 *
 * A row with no recorded estimate reports "not recorded" — never $0.00, and never
 * today's rate applied backwards. A job that ran before CineBraid recorded cost has
 * no recorded cost, and saying otherwise invents history. That is the same discipline
 * candidate review already applies to reviewer attribution ("Not recorded for this
 * review" rather than borrowing today's Settings value), and it is why nothing here
 * ever backfills: a legacy row is read, classified as unrecorded, and left alone.
 *
 * SHAPE. The estimate is the CostEstimate the generation contract already defines and
 * already tests (`generation-contracts.js`, validateCostEstimate). This module chooses
 * values; it does not define or validate a second one. `confidence` is the
 * load-bearing field:
 *
 *   estimated — CineBraid computed the number from a configured rate.
 *   unknown   — no rate applies to this output, so there is NO number and we say so.
 *   quoted    — the provider priced THIS job. fal does not quote at submission, so
 *               nothing in this module ever writes it. It stays in the vocabulary
 *               because the day a provider does quote, the honest word already exists.
 *
 * ESTIMATE IS NOT ACTUAL. Nothing here produces an actual charged amount, and nothing
 * here may be relabelled as one. CineBraid receives no trustworthy billing figure from
 * fal, so the only honest word for every number below is "estimate". Reconciling
 * against a provider invoice is a different job than this one.
 *
 * WHAT IS DELIBERATELY NOT HERE: provider price tables. A job records the single rate
 * that produced its own figure and the quantity it multiplied — the arithmetic behind
 * one number, which is what it takes to explain that number later. Current prices stay
 * in configuration, where policy belongs.
 *
 * Pure module: no I/O, no configuration reads of its own, no clock of its own.
 */

/* Purposes billed per generated image. `motion-h3` is billed by the provider on a
   different basis entirely — duration, resolution and reference count — and
   multiplying a per-IMAGE rate by a video would be a fabricated number wearing a real
   one's clothes. So a motion job records `confidence: "unknown"`: metered, honestly
   unpriced, and never folded into a total as if it were free.

   A per-second model for H3 does exist, but it lives in the browser as a hard-coded
   pre-flight quote (`falH3CostEstimate`, public/fal-generation.js) rather than in
   configuration, so the server has no rate to record here. Giving motion a recorded
   amount means first giving that model a home the server can read; that is a larger
   change than this one and is deliberately left out rather than approximated. */
const IMAGE_PURPOSES = ["blocking", "frame", "correction", "entity-reference"];

/* Every fal dispatch is a remote paid API call. Nothing in this module is free_local. */
const COST_CLASS = "metered_api";
const CURRENCY = "usd";

/* The word that must appear wherever these numbers are shown. */
const RECORDED_BASIS = "estimated-at-submission";

function positiveRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/* Sub-cent rates are legitimate (fractions of a cent per image are common), so the
   sum is carried at micro-dollar precision rather than rounded to cents on the way
   in. Display rounding is the surface's business, not the record's. */
function roundUsd(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 1e6) / 1e6 : 0;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/* -------------------------------------------------------------------------
   WRITE SIDE — called once, at submission, and never again.

   Called with the quantity that is actually about to be dispatched, which for the
   compiled image path is the count the PLAN settled on rather than the count the
   caller asked for. Recording the requested number would describe a job that was
   never submitted. */
function submissionAccounting({ purpose, outputCount, ratePerImage, at } = {}) {
  const kind = String(purpose || "");
  const perImage = IMAGE_PURPOSES.includes(kind);
  const quantity = Math.max(0, Math.round(Number(outputCount) || 0));
  const rate = positiveRate(ratePerImage);
  /* Priced only when a per-image rate genuinely applies AND one is configured. An
     unconfigured rate is the default (0), and treating that as "this job cost $0"
     is the exact fiction this module exists to prevent. */
  const priced = perImage && rate > 0 && quantity > 0;
  const amount = priced ? roundUsd(rate * quantity) : null;

  const estimate = priced
    ? {
      costClass: COST_CLASS,
      unit: CURRENCY,
      confidence: "estimated",
      amount,
      breakdown: [{
        label: `${quantity} image${quantity === 1 ? "" : "s"} at ${rate} USD each`,
        amount,
      }],
    }
    : {
      /* Metered, and honestly unpriced. The contract refuses an amount alongside
         `unknown`, which is precisely the guarantee wanted here. */
      costClass: COST_CLASS,
      unit: CURRENCY,
      confidence: "unknown",
    };

  return {
    costClass: COST_CLASS,
    estimate,
    recordedAt: String(at || ""),
    /* The arithmetic, not a price list: the one rate used and the one quantity it
       multiplied, so the figure can be explained years later without consulting a
       Settings value that has since changed. */
    basis: {
      unitBasis: perImage ? "image" : "video",
      quantity,
      ratePerUnit: priced ? rate : null,
      rateSource: priced ? "generation.fal.estimatedCostPerImage" : null,
      ...(priced ? {} : {
        unpricedReason: perImage ? "no-configured-rate" : "no-per-image-rate-for-this-output",
      }),
    },
  };
}

/* -------------------------------------------------------------------------
   READ SIDE — the only way a surface is allowed to learn what a job cost. */

/* The stored estimate, or null for a job that predates cost recording. Never
   synthesises one, and never writes to the job it was handed. */
function recordedEstimate(job) {
  if (!isRecord(job) || !isRecord(job.accounting)) return null;
  return isRecord(job.accounting.estimate) ? job.accounting.estimate : null;
}

/* The recorded amount, or null when the job carries no estimate OR carries one that
   honestly says it does not know. Both absences are real answers and neither is 0. */
function recordedAmount(job) {
  const estimate = recordedEstimate(job);
  if (!estimate || estimate.confidence === "unknown") return null;
  const amount = Number(estimate.amount);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/* Aggregate across a set of jobs, keeping the three populations apart because they
   mean different things and collapsing them into one dollar figure is how a partial
   record starts reading as a complete one:
     priced     — an amount was recorded at submission
     unpriced   — recorded, and recorded as unknown (no rate applied)
     unrecorded — predates cost recording; nothing is known and nothing is guessed
   `complete` is the flag a surface uses to decide whether its total is the whole
   story. Amounts are what was ESTIMATED AT SUBMISSION for every recorded job,
   including ones that later failed; matching that against what a provider actually
   billed is reconciliation, which this does not attempt and does not claim. */
function summarizeRecordedCost(jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  let amount = 0, priced = 0, unpriced = 0, unrecorded = 0;
  for (const job of rows) {
    if (!recordedEstimate(job)) { unrecorded++; continue; }
    const value = recordedAmount(job);
    if (value == null) { unpriced++; continue; }
    amount += value;
    priced++;
  }
  return {
    basis: RECORDED_BASIS,
    currency: CURRENCY,
    amount: roundUsd(amount),
    priced,
    unpriced,
    unrecorded,
    jobs: rows.length,
    complete: rows.length > 0 && unpriced === 0 && unrecorded === 0,
  };
}

module.exports = {
  IMAGE_PURPOSES,
  RECORDED_BASIS,
  submissionAccounting,
  recordedEstimate,
  recordedAmount,
  summarizeRecordedCost,
};

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

/* THE ARITHMETIC IS NOT HERE, and that is the point of importing it.
 *
 * public/shared-generation-rate.js multiplies a configured rate by a quantity, and the
 * BROWSER calls the identical function to draw its pre-flight quote. Keeping the
 * multiplication in one place is what makes "the number you were shown" and "the number
 * that was recorded" the same number by construction rather than by review.
 *
 * This module still decides everything that is a POLICY question — which purposes are
 * billed per image, which per second, what a row carries and what "unpriced" means — and
 * it is still the only writer of a durable estimate. */
const { costEstimateFromRate } = require("./public/shared-generation-rate");

/* Purposes billed per generated image. `motion-h3` is billed by the provider on a
   different basis entirely — duration, resolution and reference count — and
   multiplying a per-IMAGE rate by a video would be a fabricated number wearing a real
   one's clothes. So a motion job records `confidence: "unknown"`: metered, honestly
   unpriced, and never folded into a total as if it were free.

   That basis now HAS a home the server can read. The per-second figure used to live in
   the browser as a hard-coded pre-flight quote (`falH3CostEstimate`) rather than in
   configuration, so the dialog printed a confident number and this module recorded
   `unknown` for the same job — two authorities, two answers, one of them invisible.
   The rate is configuration now (`generation.fal.motionRate`) and both sides derive
   from it through the one shared function in public/shared-generation-rate.js.

   WHAT HAS NOT CHANGED: an unconfigured rate is still unconfigured. A motion job on an
   install that never filled the field in records `confidence: "unknown"` exactly as it
   always did, and a per-IMAGE rate still cannot price a video. */
const IMAGE_PURPOSES = ["blocking", "frame", "correction", "entity-reference"];

/* Purposes billed per second of rendered output. One family today; a list rather than a
   comparison so a second one needs no new branch. */
const MOTION_PURPOSES = ["motion-h3"];

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
function submissionAccounting({ purpose, outputCount, ratePerImage, motionRate, durationSeconds, at } = {}) {
  const kind = String(purpose || "");
  const perImage = IMAGE_PURPOSES.includes(kind);
  const perSecond = MOTION_PURPOSES.includes(kind);

  /* WHICH RATE APPLIES TO THIS OUTPUT, decided here and by nothing downstream. This is
     the judgement that belongs to the recording authority: a per-image rate prices
     images and a per-second rate prices seconds, and neither may be pressed into
     service for the other. The arithmetic itself belongs to the shared module, so the
     figure this row keeps is the same figure the dialog quoted. */
  const applicable = perImage
    ? {
      rate: {
        configured: positiveRate(ratePerImage) > 0,
        amount: positiveRate(ratePerImage),
        basis: "image",
        unitNoun: "image",
        configPath: "generation.fal.estimatedCostPerImage",
        unpricedReason: "no-configured-rate",
      },
      quantity: Math.max(0, Math.round(Number(outputCount) || 0)),
    }
    : perSecond
      ? {
        rate: isRecord(motionRate) && positiveRate(motionRate.amount) > 0
          ? motionRate
          : {
            configured: false, amount: 0, basis: "second", unitNoun: "second",
            configPath: "generation.fal.motionRate.usdPerSecond",
            unpricedReason: "no-configured-rate",
          },
        quantity: Math.max(0, Math.round(Number(durationSeconds) || 0)),
      }
      /* An output whose billing basis CineBraid does not know. Not priced, and the
         quantity recorded is the one thing that is certainly true about it. */
      : {
        rate: {
          configured: false, amount: 0, basis: "video", unitNoun: "output",
          configPath: "", unpricedReason: "no-rate-basis-for-this-output",
        },
        quantity: Math.max(0, Math.round(Number(outputCount) || 0)),
      };

  const derived = costEstimateFromRate(applicable);
  const priced = derived.priced;

  return {
    costClass: COST_CLASS,
    estimate: derived.estimate,
    recordedAt: String(at || ""),
    /* The arithmetic, not a price list: the one rate used and the one quantity it
       multiplied, so the figure can be explained years later without consulting a
       Settings value that has since changed.

       An UNPRICED motion job still records `unitBasis: "video"` and its output count,
       because that is what is actually known about it — the per-second basis is claimed
       only when a per-second rate was really applied. */
    basis: priced
      ? derived.basis
      : {
        ...derived.basis,
        unitBasis: perImage ? "image" : "video",
        quantity: perSecond && !priced
          ? Math.max(0, Math.round(Number(outputCount) || 0))
          : derived.basis.quantity,
        unpricedReason: perImage || perSecond
          ? derived.basis.unpricedReason
          : "no-per-image-rate-for-this-output",
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

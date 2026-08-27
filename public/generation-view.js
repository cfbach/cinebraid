/* The shared Simple/Advanced RENDERER.
 *
 * public/shared-generation-presentation.js decides what Simple and Advanced MEAN — which
 * controls exist, which are rendered, and what may reach a payload. It is pure and knows
 * nothing about markup, because the Node server requires it too.
 *
 * This file is the browser half: the one block of HTML every generation surface draws, so
 * the compiled frame dialog, the MiniMax H3 motion dialog, the entity and continuity-state
 * reference dialogs and all five automation planners present the same facts in the same
 * order with the same words. It lives on its own rather than inside generation-picker.js
 * because five other files call it, and a renderer that made the picker a dependency of
 * the automation planner would be an import cycle waiting to be discovered.
 */

/* ---------------------------------------------------------------------------
   SIMPLE AND ADVANCED.

   One presentation, rendered by every generation surface in CineBraid: the compiled
   frame dialog above, the MiniMax H3 motion dialog, the entity and continuity-state
   reference dialogs, and the four automation planners. They differ in what they are
   generating; they must not differ in what a filmmaker is told before paying.

   SIMPLE IS THE DEFAULT, and it is not a reduced version of the expert screen — it is
   the set of facts that decide a paid dispatch. Which model, whether it runs here or at
   a provider, what it is estimated to cost and on whose authority, how long it will take,
   how many candidates come back, and what stops the run early. Advanced adds the machine
   settings; it removes nothing.

   WHAT NEVER MOVES INTO THE DISCLOSURE. Price, route and any refusal render OUTSIDE both
   panels and are visible in both modes. A cost a filmmaker has to open a panel to find is
   a cost they can dispatch without reading, and an error hidden behind a closed panel is
   an error nobody sees. Advanced is for controls, never for consequences.

   THE CONTROLS ARE REMOVED, NOT HIDDEN. Switching to Simple takes the advanced controls
   out of the DOM rather than setting `hidden` on them, because a hidden input still
   answers getElementById().value and would keep shipping whatever was last typed into
   it. Combined with restrictPayloadToPlan() on the way out, that is the whole of the
   Advanced-to-Simple guarantee: the value is neither readable nor permitted. */

const GENERATION_VIEW_STORAGE_KEY = "cinebraid-generation-view";

/* The filmmaker's standing preference, which is a UI fact and only a UI fact. It decides
   what is on screen; it never decides what is in a payload — that comes from the plan
   computed for whichever mode is actually active. */
function generationViewPreference() {
  try { return generationViewMode(localStorage.getItem(GENERATION_VIEW_STORAGE_KEY)); }
  catch { return "simple"; }
}

/* Each surface registers how to redraw itself when the mode changes. One slot, because
   exactly one generation dialog is open at a time. */
window._generationViewRefresh = null;
window.setGenerationViewMode = (mode) => {
  const next = generationViewMode(mode);
  try { localStorage.setItem(GENERATION_VIEW_STORAGE_KEY, next); } catch { /* private mode */ }
  const refresh = window._generationViewRefresh;
  if (typeof refresh === "function") refresh(next);
};

/* Two buttons, and they are buttons rather than a <details> for two reasons that have
   both bitten this codebase: app.js's captureRouteViewState() records and restores every
   <details>'s open state by POSITION among the page's details, so a freshly computed
   `open` is overridden by whatever sat at that index last render; and an author rule
   setting `display` on a direct <details> child beats the UA's `display:none`, which
   renders a "closed" panel at full height. A tablist derives its state from stored truth
   and has neither problem. */
function generationViewSwitchMarkup(mode) {
  const active = generationViewMode(mode);
  return '<div class="gen-view-switch" role="tablist" aria-label="Generation detail level">'
    + CINEBRAID_GENERATION_VIEW_MODES.map((value) => {
      const selected = value === active;
      return `<button type="button" role="tab" id="gen-view-tab-${attr(value)}" aria-selected="${selected}" aria-controls="gen-view-controls" tabindex="${selected ? "0" : "-1"}" class="gen-view-tab${selected ? " is-active" : ""}" data-gen-view-mode="${attr(value)}" onclick="setGenerationViewMode('${attr(value)}')">${esc(value === "simple" ? "Simple" : "Advanced")}</button>`;
    }).join("")
    + '</div>';
}

/* THE BLOCK THAT IS ALWAYS VISIBLE.

   Model standing, route, price and time — in that order, because that is the order the
   questions are asked in. Every one of them says "unavailable" rather than guessing, and
   the word "estimated" appears in every priced sentence and cannot be configured out. */
function generationAlwaysVisibleMarkup({ option, recommendation, rate, quantity }) {
  const standing = selectedModelStanding(option, recommendation);
  const placement = routePlacement(option);
  const price = generationPriceLine({ rate, quantity, local: placement.local });
  const time = generationTimeEstimate();
  const provenance = (price.provenance && price.provenance.line) || "";
  return '<div class="gen-view-always">'
    + `<div class="gen-view-fact gen-view-model"><span>Model</span><b>${esc(standing.label)}</b><small>${esc(standing.detail)}</small></div>`
    + `<div class="gen-view-fact gen-view-route"><span>Where it runs</span><b>${esc(placement.label)}</b><small>${esc(placement.detail)}</small></div>`
    + `<div class="gen-view-fact gen-view-price is-${attr(price.kind)}"><span>Provider cost</span><b>${esc(price.headline)}</b><small>${esc(price.detail)}</small>${provenance ? `<em class="gen-view-provenance">${esc(provenance)}</em>` : ""}</div>`
    + `<div class="gen-view-fact gen-view-time"><span>Estimated time</span><b>${esc(time.headline)}</b><small>${esc(time.detail)}</small></div>`
    + '</div>';
}

/* What this configuration cannot do, named rather than drawn as a dead control.
   Advanced only: in Simple it is noise, and in neither view is it a reason to render an
   input the model would refuse. */
function generationUnsupportedMarkup(plan) {
  if (!plan || plan.mode !== "advanced") return "";
  const rows = (plan.controls || []).filter((control) => !control.supported);
  if (!rows.length) return "";
  return `<div class="gen-view-unsupported"><b>Not supported by this model</b><ul>`
    + rows.map((row) => `<li><span>${esc(row.label)}</span><small>${esc(row.reason)}</small></li>`).join("")
    + '</ul><small>These are listed rather than greyed out because CineBraid will not send a value this model cannot accept.</small></div>';
}

/* WHAT SIMPLE IS NOT ASKING ABOUT, said out loud.
 *
 * An expert control that Simple hides is an expert control whose value is not in the
 * payload — that is the guarantee, and it is the right one. But a guarantee the filmmaker
 * cannot see is indistinguishable from a bug: set a size under Advanced, come back to
 * Simple, dispatch, and the render arrives at the saved default with no explanation.
 *
 * So the hidden-but-supported controls are named, with what happens instead. This is the
 * difference between a value that is dropped and a value that is dropped invisibly, and
 * only the second one is a defect. */
function generationSavedDefaultsMarkup(plan) {
  if (!plan || plan.mode !== "simple") return "";
  const hidden = (plan.controls || []).filter((control) => control.supported && !control.rendered);
  if (!hidden.length) return "";
  return `<p class="gen-view-defaults">Simple is not asking about ${
    esc(hidden.map((control) => control.label.toLowerCase()).join(", "))
  }. ${esc(hidden.length === 1 ? "It uses" : "They use")} your saved default${hidden.length === 1 ? "" : "s"}, and nothing you set under Advanced is sent while Simple is showing.</p>`;
}

/* The limits and the stop-early behaviour, in the filmmaker's terms. Rendered only from
   what a surface actually declares — a planner with no rounds passes none and this prints
   nothing rather than inventing a policy. Stop-early is never claimed on a path that does
   not already support it. */
function generationLimitsMarkup(limits) {
  const rows = ((limits && limits.rows) || []).filter((row) => row && row.label);
  const stop = limits && limits.stopEarly;
  if (!rows.length && !stop) return "";
  return '<div class="gen-view-limits">'
    + (rows.length ? `<div class="gen-view-limit-rows">${rows.map((row) => `<span><b>${esc(String(row.value))}</b>${esc(row.label)}</span>`).join("")}</div>` : "")
    + (stop ? `<p class="gen-view-stop-early">${esc(stop)}</p>` : "")
    + '</div>';
}

/* ---------------------------------------------------------------------------
   DID CINEBRAID ACTUALLY INCLUDE WHAT I ASKED FOR?

   The compiler has answered this since C1 and nothing has ever shown the answer. Every
   compiled plan carries a `coverage` array - one entry per piece of direction the shot
   was carrying - saying whether it reached the prompt, is anchored by a reference
   instead, was left out on purpose, or cannot be expressed by the selected model at all.
   It travelled on the wire from both plan preview routes and had no reader. A filmmaker
   pressing a paid button could see the compiled prompt and could not see which of their
   decisions were in it.

   THIS RENDERS THAT RECORD AND JUDGES NOTHING. Every state, every reason and every
   `via` below is the compiler's own; the label is the compiler's too, joined onto the
   entry by the route from generation-compiler.js's INTENT_FIELDS. There is no second
   semantic check here, no re-reading of the prompt and no language model - the whole of
   the analysis already happened, upstream, deterministically.

   WHAT IS SHOWN, AND WHERE — and the partition is the whole design, because a complete
   coverage record is LONG. A compiled still frame for a fully directed shot carries
   around thirty entries, and roughly half of them are `omitted-by-design`: a still has no
   duration, carries no sound, and holds one instant rather than a camera move. Those are
   correct, expected and reassuring, and listing sixteen of them in front of a paid button
   is a wall for the one row that actually needs reading.

   So exactly one state is alarming, and only it is shown in Simple:

     unsupported        THE FILMMAKER ASKED FOR SOMETHING THIS CONFIGURATION CANNOT DO.
                        The single most expensive thing to discover after paying, and
                        Advanced is a panel that may be closed. Always shown, both views.
     omitted-by-design  CineBraid left it out on purpose and says why - it belongs to a
                        different pass. Counted in Simple, listed in Advanced.
     represented        It reached the prompt. Reassurance rather than a decision.
     anchored           A reference carries it instead of the words. Also reassurance -
                        and the answer to "why is Kai not described in here".

   Simple never hides a count. It says how many are in each population and where to read
   them, which is the difference between a concise summary and an incomplete one. */
const GENERATION_COVERAGE_STATES = {
  represented: { word: "in the prompt", tone: "carried" },
  anchored: { word: "anchored by a reference", tone: "carried" },
  "omitted-by-design": { word: "left out on purpose", tone: "omitted" },
  unsupported: { word: "not supported by this model", tone: "missing" },
};
function generationCoverageRow(entry) {
  const state = GENERATION_COVERAGE_STATES[String(entry.state)] || { word: String(entry.state || ""), tone: "carried" };
  /* The compiler says WHY for the two states that need one and says nothing for the two
     that do not. Printing an empty reason as a dash would invent an absence. */
  const detail = String(entry.reason || "")
    || (entry.state === "anchored" ? `anchored by ${String(entry.via || "a reference")}` : "")
    || (entry.state === "represented" && String(entry.via) === "parameter" ? "sent as a request parameter" : "");
  return `<li data-coverage-state="${attr(entry.state)}"><span>${esc(entry.label || entry.intent)}</span><b>${esc(state.word)}</b>${detail ? `<small>${esc(detail)}</small>` : ""}</li>`;
}
function generationCoverageCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}
function generationCoverageMarkup(coverage, mode) {
  const rows = (Array.isArray(coverage) ? coverage : []).filter((entry) => entry && entry.intent);
  if (!rows.length) return "";
  const view = generationViewMode(mode);
  const unsupported = rows.filter((entry) => String(entry.state) === "unsupported");
  const omitted = rows.filter((entry) => String(entry.state) === "omitted-by-design");
  const carried = rows.filter((entry) => ["represented", "anchored"].includes(String(entry.state)));
  const shown = view === "advanced" ? [...unsupported, ...omitted, ...carried] : unsupported;
  /* The rest, as counts rather than rows. Simple is concise about a long record; it is
     never silent about one, because silence here reads as "coverage was not computed"
     and that is a different fact from "everything arrived". */
  const rest = [
    omitted.length ? `${generationCoverageCount(omitted.length, "piece", "pieces")} left out on purpose` : "",
    carried.length ? `${generationCoverageCount(carried.length, "piece", "pieces")} carried into this request` : "",
  ].filter(Boolean).join(" · ");
  const headline = unsupported.length
    ? `${generationCoverageCount(unsupported.length, "piece", "pieces")} of your direction ${unsupported.length === 1 ? "cannot be" : "cannot be"} carried by this model`
    : "Everything you asked for is accounted for";
  return `<section class="gen-coverage" data-coverage-summary="${attr(unsupported.length ? "unsupported" : "clear")}" data-coverage-total="${attr(String(rows.length))}">`
    + `<b>${esc(headline)}</b>`
    + `<small>${esc(unsupported.length
      ? "CineBraid compiled this request and recorded what reached it. This is that record, not a review."
      : "CineBraid's own record of what it wrote, intent by intent. Nothing you asked for was refused by this model.")}</small>`
    + (shown.length ? `<ul>${shown.map(generationCoverageRow).join("")}</ul>` : "")
    + (view === "simple" && rest
      ? `<small class="gen-coverage-rest">${esc(`${rest}. Open Advanced to read each one.`)}</small>`
      : "")
    + "</section>";
}

/* The whole shared shell. A surface supplies its own control markup for the active mode
   and gets everything else from here, so "Simple" means the same thing on the blocking
   dialog and on the scene planner. */
function generationViewMarkup({ mode, plan, option, recommendation, rate, quantity, limits, controlsMarkup, coverage }) {
  const view = generationViewMode(mode);
  return `<section class="gen-view" data-gen-view="${attr(view)}">`
    + `<header class="gen-view-head"><div><b>Generation settings</b><small>${esc(view === "simple" ? "The facts that decide this request. Open Advanced for the machine settings." : "Every setting this model and provider actually support.")}</small></div>${generationViewSwitchMarkup(view)}</header>`
    + generationAlwaysVisibleMarkup({ option, recommendation, rate, quantity })
    + `<div class="gen-view-controls" id="gen-view-controls" role="tabpanel" aria-labelledby="gen-view-tab-${attr(view)}">${controlsMarkup || ""}${generationSavedDefaultsMarkup(plan)}</div>`
    + generationLimitsMarkup(limits)
    + generationCoverageMarkup(coverage, view)
    + generationUnsupportedMarkup(plan)
    + '</section>';
}

/* The capability a plan response describes, in the shape resolveCapability() returns.
 *
 * A MAPPING, NOT A SECOND TRUTH LAYER. Every field below is one the server already
 * computed from the model-intersect-backend capability and already sends: `sizes` IS
 * capability.resolutions, `durationRange` IS capability.durationSeconds, `seedSupported`
 * IS capability.flags.seed. This puts them back into one record so the control plan can
 * read them the same way on both sides of the wire. It invents nothing, and every flag
 * it cannot find defaults to false rather than to true. */
function capabilityFromPlan(plan, extra) {
  const row = plan && typeof plan === "object" ? plan : {};
  const declared = extra && typeof extra === "object" ? extra : {};
  return {
    resolutions: Array.isArray(row.sizes) ? row.sizes : Array.isArray(row.resolutions) ? row.resolutions : null,
    qualityTiers: Array.isArray(row.qualityTiers) ? row.qualityTiers : null,
    aspectRatios: Array.isArray(declared.aspectRatios) ? declared.aspectRatios : null,
    durationSeconds: Array.isArray(row.durationRange) && row.durationRange.length === 2 ? row.durationRange : null,
    maxPromptCharacters: Number.isFinite(Number(row.maxPromptCharacters)) ? Number(row.maxPromptCharacters) : null,
    flags: {
      seed: row.seedSupported === true,
      /* Declared by the caller because it is a property of the OUTPUT: a still-image plan
         returns a candidate count and a motion plan returns one clip. Neither is inferable
         from the plan payload, so neither is guessed here. */
      candidateBatching: declared.candidateBatching === true,
      referenceWeights: declared.referenceWeights === true,
      cfgScale: declared.cfgScale === true,
      steps: declared.steps === true,
    },
  };
}

/* The rate that applies to a generation, chosen by what is being generated rather than by
   which dialog is asking. Both come from configuration through the one shared reader, so
   a surface cannot accidentally quote from a number of its own. */
function generationRateFor(outputType) {
  return String(outputType) === "video"
    ? configuredMotionRate(typeof CONFIG === "object" ? CONFIG : {})
    : configuredImageRate(typeof CONFIG === "object" ? CONFIG : {});
}

/* The recommendation for a resolved option list, from the use-case guide and nothing
   else. Every surface calls this rather than reading `guide` itself, so there is exactly
   one place where a "best model" could ever be decided — and it does not decide one. */
function generationRecommendationFor(resolved) {
  return generationRecommendation({
    guide: resolved && resolved.guide ? resolved.guide : null,
    options: (resolved && resolved.options) || [],
  });
}

/* The option a surface is actually going to dispatch, found BY ID. Never `[0]`, never
   `.at(-1)`, never "the first ready one" — those are list positions, and a list position
   is not a preference. A surface with no selection gets null and says so. */
function selectedGenerationOption(resolved, selectedOptionId) {
  const id = String(selectedOptionId || "");
  if (!id) return null;
  return ((resolved && resolved.options) || []).find((option) => String(option.optionId) === id) || null;
}

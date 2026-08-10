/* Canonical production aspect-ratio model, shared by the browser and the Node prompt
   compiler.
 *
 * CineBraid already stored the production format in three places — `meta.aspectRatio`,
 * the legacy `meta.format` free text it is parsed out of, and the per-shot
 * `creationBrief.composition.aspectRatio` override — and already parsed it with one
 * function. What it did not have was a way for any of that to reach the screen, so every
 * image well was hard-coded to 16:9 and a vertical or scope production was judged in a
 * widescreen box.
 *
 * This module is that single source. Nothing else in the product may compare ratio
 * strings: callers ask for a resolved ratio, a label, or a display size, and get one
 * answer. Display and generation call the same resolvers, so they cannot disagree.
 */

/* The range a ratio has to fall inside to be believable as a production format. Wider
   than any real delivery spec, narrow enough to reject a timecode or a lens note that
   happens to contain a colon. */
const CINEBRAID_ASPECT_MIN = 0.4;
const CINEBRAID_ASPECT_MAX = 3.2;

/* The formats the project and shot controls offer by name. Suggestions, not a
   whitelist — both controls still accept free text for an arbitrary ratio. */
const CINEBRAID_ASPECT_PRESETS = Object.freeze([
  Object.freeze(["16:9", "16:9 — widescreen"]),
  Object.freeze(["21:9", "21:9 — ultrawide"]),
  Object.freeze(["2.39:1", "2.39:1 — cinematic scope"]),
  Object.freeze(["1:1", "1:1 — square"]),
  Object.freeze(["9:16", "9:16 — vertical"]),
]);

/* The ratio used when nothing else is known. Everything that has ever shipped was 16:9,
   so a record with no format renders exactly as it did before this change. */
const CINEBRAID_ASPECT_FALLBACK = "16:9";

function aspectCleanText(v) {
  return String(v || "").trim();
}

/* Moved here from prompt-engine.js without alteration, and re-exported from there, so
   there is exactly one parser in the product. Signature, return type and the 0.4–3.2
   clamp are unchanged: the first W:H pair in the text whose ratio is believable, in its
   original written form, or "" when the text contains none. */
function parseAspectRatio(value) {
  const matches = [...aspectCleanText(value).matchAll(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/g)];
  for (const match of matches) {
    const left = Number(match[1]), right = Number(match[2]), ratio = left / right;
    if (left > 0 && right > 0 && ratio >= CINEBRAID_ASPECT_MIN && ratio <= CINEBRAID_ASPECT_MAX)
      return `${match[1]}:${match[2]}`;
  }
  return "";
}

/* A ratio in every form the rest of the product needs: the numbers for arithmetic, the
   CSS `aspect-ratio` value, and the label that goes back into project data and provider
   requests. Accepts a ratio string, or numeric width/height where the schema carries
   real dimensions. Returns null for anything unusable — no throw, no guess. */
function resolveAspect(value) {
  if (value && typeof value === "object") {
    const w = Number(value.w != null ? value.w : value.width);
    const h = Number(value.h != null ? value.h : value.height);
    return aspectFromNumbers(w, h);
  }
  const label = parseAspectRatio(value);
  if (!label) return null;
  const [w, h] = label.split(":").map(Number);
  return { w, h, ratio: w / h, css: `${w} / ${h}`, label };
}

function aspectFromNumbers(w, h) {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const ratio = w / h;
  if (ratio < CINEBRAID_ASPECT_MIN || ratio > CINEBRAID_ASPECT_MAX) return null;
  return { w, h, ratio, css: `${w} / ${h}`, label: `${w}:${h}` };
}

/* An imported or generated asset's own shape. References are shown at this, never at the
   production output ratio — a character sheet is not a shot. */
function intrinsicAspect(naturalWidth, naturalHeight) {
  return aspectFromNumbers(Number(naturalWidth), Number(naturalHeight));
}

/* The project's production format. `meta.format` is the legacy home of the ratio and is
   still read by prompt compilation, so it has to participate here too — otherwise a
   record carrying only `format: "2.39:1"` would display scope and generate widescreen. */
function productionAspect(project) {
  const meta = project?.meta || {};
  return resolveAspect(meta.aspectRatio) || resolveAspect(meta.format) || null;
}

/* A shot's own declared override, if the user set one. */
function shotAspect(shot) {
  return resolveAspect(shot?.creationBrief?.composition?.aspectRatio) || null;
}

/* Declared intent only: what the production says this shot's output should be. Returns
   null when neither level declares anything — the intrinsic fallback belongs to
   resolveDisplayAspect, not here, so callers that need the intent alone can have it. */
function shotOutputAspect(project, shot) {
  return shotAspect(shot) || productionAspect(project) || null;
}

/* The full display precedence: declared shot intent, then declared project intent, then
   the asset's own dimensions, then 16:9. */
function resolveDisplayAspect(options = {}) {
  const { project, shot, natural } = options;
  return (
    shotOutputAspect(project, shot) ||
    (natural ? intrinsicAspect(natural.width, natural.height) : null) ||
    resolveAspect(CINEBRAID_ASPECT_FALLBACK)
  );
}

/* The label that goes to a provider and into the job record. Same resolvers as display,
   so a project can never generate one format while showing another. */
function projectAspectLabel(project) {
  return productionAspect(project)?.label || CINEBRAID_ASPECT_FALLBACK;
}
function shotAspectLabel(project, shot) {
  return shotOutputAspect(project, shot)?.label || CINEBRAID_ASPECT_FALLBACK;
}

/* ---- reference-generation formats ------------------------------------------------
 *
 * A durable reference is not a shot. A character anchor is a full-body portrait, a
 * location plate is a wide master, a prop or vehicle card is a neutral three-quarter
 * view — and none of them is the production delivery format. CineBraid already knew
 * that: the three literals below were written out at five separate call sites. What it
 * did not have was one place to read them from, so only the provider REQUEST knew the
 * reference format. The compiled prompt was built from the production format instead,
 * and a 16:9 project asked for a 3:4 image in a prompt that said "Output at 16:9". The
 * request won and the frame came back portrait, with the prompt still arguing.
 *
 * One resolver, read by every request builder and by the reference compiler, is what
 * makes it impossible to say two things. This is not a new setting — there is nothing
 * here a user chooses that they could not choose before.
 */
const CINEBRAID_REFERENCE_ASPECTS = Object.freeze({
  characters: "3:4",
  locations: "16:9",
  props: "4:3",
  vehicles: "4:3",
});

/* An unrecognised list is an entity card like any other, and 4:3 is what props and
   vehicles — the two lists that are not a portrait or a plate — already used. */
const CINEBRAID_REFERENCE_ASPECT_FALLBACK = "4:3";

function referenceAspectLabel(list) {
  return CINEBRAID_REFERENCE_ASPECTS[String(list || "").trim()] || CINEBRAID_REFERENCE_ASPECT_FALLBACK;
}
function referenceAspect(list) {
  return resolveAspect(referenceAspectLabel(list));
}

/* Every believable ratio written anywhere in a block of text, in the order it appears.
   Same 0.4–3.2 clamp as the parser, so a duration, a lens note or a scale reading that
   happens to contain a colon is not mistaken for a format. */
function aspectRatioMentions(value) {
  const out = [];
  for (const match of aspectCleanText(value).matchAll(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/g)) {
    const left = Number(match[1]), right = Number(match[2]), ratio = left / right;
    if (left > 0 && right > 0 && ratio >= CINEBRAID_ASPECT_MIN && ratio <= CINEBRAID_ASPECT_MAX)
      out.push(`${match[1]}:${match[2]}`);
  }
  return out;
}

/* Which ratios in this prompt disagree with the ratio the request is about to carry.
   Empty means the prompt is either silent about shape or says the same thing the
   request says; anything returned is a contradiction the model has to resolve on its
   own, which is exactly the bug. Written in the same form the text used, so a report
   can quote it back. Pass "" for a request that authorises no literal ratio at all —
   then every literal is a contradiction, which is the source-preserving edit rule. */
function aspectPromptConflicts(value, label) {
  const wanted = resolveAspect(label);
  return aspectRatioMentions(value).filter((mention) => {
    const found = resolveAspect(mention);
    if (!wanted || !found) return true;
    return Math.abs(found.ratio - wanted.ratio) / wanted.ratio > 0.005;
  });
}

/* ---- MiniMax H3 output formats --------------------------------------------------
 *
 * H3 accepts a fixed list of aspect ratios and nothing else. The provider request
 * builder used to express that as `list.includes(x) ? x : "16:9"`, so a 2.39:1 or 3:2
 * production reached the provider as 16:9 — a paid video in a format the production
 * never asked for, with nothing anywhere in the interface saying so.
 *
 * The whitelist below is exactly the provider's, copied from the request builder and
 * not extended. What changed is what happens when a format is outside it: the dispatch
 * is refused before any external request, rather than quietly rewritten.
 *
 * Image-to-video and first/last-frame send no aspect_ratio at all — the video takes its
 * shape from the frames the user supplies — so there is nothing to substitute and
 * nothing to refuse. They are routed through the same resolver so that every H3 path
 * has one answer about its output format rather than an assumption.
 */
const CINEBRAID_H3_ASPECT_SUPPORT = Object.freeze({
  t2v: Object.freeze(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  r2v: Object.freeze(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  i2v: null,
  flf: null,
});

/* Two ratios are the same ratio however they are written, so 1920:1080 is 16:9 and is
   not refused. A tolerance this tight still separates 2.39:1 from 21:9, which differ by
   2.4% and are genuinely different deliveries. */
function h3RatioValue(label) {
  const parsed = parseAspectRatio(label);
  if (!parsed) return null;
  const [w, h] = parsed.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

/* One answer for every H3 dispatch path: manual generation, first/last frame,
   multi-keyframe, automation and any retry or resume. Returns the value that may be
   sent, or a refusal carrying plain-language copy — never a substituted ratio. */
function h3AspectSupport(mode, requested) {
  const key = String(mode || "").trim().toLowerCase();
  const allowed = CINEBRAID_H3_ASPECT_SUPPORT[key];
  const asked = aspectCleanText(requested);
  if (allowed === undefined)
    return { ok: false, mode: key, requested: asked, carriesAspectRatio: false, supported: [], reason: "mode", message: `"${asked || "(none)"}" cannot be checked: ${key || "(none)"} is not a MiniMax H3 workflow mode.` };
  if (allowed === null)
    return { ok: true, mode: key, requested: asked, carriesAspectRatio: false, supported: [], value: null };

  const supported = allowed.slice();
  if (supported.includes(asked)) return { ok: true, mode: key, requested: asked, carriesAspectRatio: true, supported, value: asked };

  const wanted = h3RatioValue(asked);
  if (wanted != null) {
    for (const candidate of supported) {
      const value = h3RatioValue(candidate);
      if (value != null && Math.abs(value - wanted) / wanted < 0.005)
        return { ok: true, mode: key, requested: asked, carriesAspectRatio: true, supported, value: candidate };
    }
  }
  const named = asked || "(no format)";
  return {
    ok: false,
    mode: key,
    requested: asked,
    carriesAspectRatio: true,
    supported,
    reason: "unsupported-ratio",
    message:
      `MiniMax H3 cannot produce ${named} video. It accepts ${supported.join(", ")} and nothing else, ` +
      `and CineBraid will not quietly deliver a different shape than the one you asked for. ` +
      `Nothing has been sent and nothing has been charged. ` +
      `To continue, either set this Shot's format to one MiniMax H3 accepts, or choose a video model that supports ${named}.`,
  };
}

/* ---- display sizing -------------------------------------------------------------
 * Two policies, deliberately separate.
 *
 * Overview — every grid, strip and tray. The grid's own column widths are never touched,
 * because a ratio-derived track width can invert a `minmax()` and collapse the layout.
 * Instead the well takes a clamped ratio and a height cap, and `object-fit: contain`
 * letterboxes whatever is left. That keeps rows scannable and stops a 9:16 card growing
 * to 340x604 while still giving vertical media far more area than a 16:9 box did.
 *
 * Selection — single-image review canvases, where both dimensions can actually be
 * applied and bounded by the viewport. Constant area: every format gets the same number
 * of pixels to be judged in, so vertical is tall and narrow rather than a strip, and
 * scope is wide and short rather than an unreadable ribbon.
 */
const CINEBRAID_OVERVIEW_MIN_RATIO = 0.75;
const CINEBRAID_OVERVIEW_MAX_RATIO = 2.4;

function overviewAspect(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) return 16 / 9;
  return Math.min(CINEBRAID_OVERVIEW_MAX_RATIO, Math.max(CINEBRAID_OVERVIEW_MIN_RATIO, value));
}

/* CSS `aspect-ratio` for an overview well: the intended ratio, clamped. */
function overviewAspectCss(aspect) {
  const ratio = overviewAspect(aspect?.ratio);
  if (aspect && ratio === aspect.ratio) return aspect.css;
  return `${Number(ratio.toFixed(4))} / 1`;
}

/* How tall an overview well is allowed to get, as a multiple of the 16:9 height the same
   column width would have produced. `browse` is for scanning; `judge` is for the grids
   that ask "choose between these" and can afford more canvas. */
const CINEBRAID_WELL_CAPS = Object.freeze({ browse: 1.5, judge: 1.9 });

function overviewWellCap(columnWidth, tier = "browse") {
  const width = Number(columnWidth);
  if (!Number.isFinite(width) || width <= 0) return 0;
  const factor = CINEBRAID_WELL_CAPS[tier] || CINEBRAID_WELL_CAPS.browse;
  return Math.round((width / (16 / 9)) * factor);
}

/* Constant-area review canvas. `area` is the pixel budget a 16:9 canvas of the default
   size would have used, so 16:9 is unchanged and every other format gets the same area
   in its own shape. */
const CINEBRAID_SELECTION_AREA = 438 * 246;
const CINEBRAID_SELECTION_MIN_W = 220;
const CINEBRAID_SELECTION_MAX_W = 560;

function selectionWell(ratio, area = CINEBRAID_SELECTION_AREA, bounds = {}) {
  const value = Number(ratio);
  const safe = Number.isFinite(value) && value > 0 ? value : 16 / 9;
  const minW = bounds.minW == null ? CINEBRAID_SELECTION_MIN_W : bounds.minW;
  const maxW = bounds.maxW == null ? CINEBRAID_SELECTION_MAX_W : bounds.maxW;
  const w = Math.min(maxW, Math.max(minW, Math.round(Math.sqrt(area * safe))));
  return { w, h: Math.round(w / safe) };
}

/* The inline custom properties a shot-scoped surface carries, so a shot with an override
   sizes from its own ratio while its inherited siblings keep the project's. Returned as
   a style string because every render site in this product builds HTML. */
function aspectStyleVars(aspect, options = {}) {
  if (!aspect) return "";
  const parts = [`--cb-well-aspect:${overviewAspectCss(aspect)}`];
  if (options.selection !== false) {
    const well = selectionWell(aspect.ratio, options.area, options.bounds);
    parts.push(`--cb-selection-w:${well.w}px`, `--cb-selection-h:${well.h}px`);
  }
  return parts.join(";");
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    CINEBRAID_ASPECT_PRESETS,
    CINEBRAID_ASPECT_FALLBACK,
    CINEBRAID_REFERENCE_ASPECTS,
    CINEBRAID_H3_ASPECT_SUPPORT,
    h3AspectSupport,
    parseAspectRatio,
    resolveAspect,
    intrinsicAspect,
    productionAspect,
    shotAspect,
    shotOutputAspect,
    resolveDisplayAspect,
    projectAspectLabel,
    shotAspectLabel,
    referenceAspectLabel,
    referenceAspect,
    aspectRatioMentions,
    aspectPromptConflicts,
    overviewAspect,
    overviewAspectCss,
    overviewWellCap,
    selectionWell,
    aspectStyleVars,
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CINEBRAID_ASPECT_MIN,
    CINEBRAID_ASPECT_MAX,
    CINEBRAID_ASPECT_PRESETS,
    CINEBRAID_ASPECT_FALLBACK,
    CINEBRAID_REFERENCE_ASPECTS,
    CINEBRAID_REFERENCE_ASPECT_FALLBACK,
    CINEBRAID_SELECTION_AREA,
    CINEBRAID_H3_ASPECT_SUPPORT,
    h3AspectSupport,
    parseAspectRatio,
    resolveAspect,
    intrinsicAspect,
    productionAspect,
    shotAspect,
    shotOutputAspect,
    resolveDisplayAspect,
    projectAspectLabel,
    shotAspectLabel,
    referenceAspectLabel,
    referenceAspect,
    aspectRatioMentions,
    aspectPromptConflicts,
    overviewAspect,
    overviewAspectCss,
    overviewWellCap,
    selectionWell,
    aspectStyleVars,
  };
}

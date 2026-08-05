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
    parseAspectRatio,
    resolveAspect,
    intrinsicAspect,
    productionAspect,
    shotAspect,
    shotOutputAspect,
    resolveDisplayAspect,
    projectAspectLabel,
    shotAspectLabel,
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
    CINEBRAID_SELECTION_AREA,
    parseAspectRatio,
    resolveAspect,
    intrinsicAspect,
    productionAspect,
    shotAspect,
    shotOutputAspect,
    resolveDisplayAspect,
    projectAspectLabel,
    shotAspectLabel,
    overviewAspect,
    overviewAspectCss,
    overviewWellCap,
    selectionWell,
    aspectStyleVars,
  };
}

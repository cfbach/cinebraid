/* Multi-aspect production formats — regression coverage.
 *
 * The repair before this one stopped judgement imagery being cropped, but built every
 * well at 16:9 because the shipped sample is 16:9. A 21:9, 2.39:1, 1:1 or 9:16
 * production was still judged in a widescreen box — uncropped, but a 9:16 frame arrived
 * as a 107px strip inside a 340px card, and a scope frame as a shallow ribbon.
 *
 * CineBraid already had the model: `meta.aspectRatio`, the legacy `meta.format` it is
 * parsed out of, a per-shot `creationBrief.composition.aspectRatio` override, and one
 * parser. It simply never reached the screen, and the shot override had no control.
 *
 * What this locks in:
 *   1. one parser and one precedence rule, byte-identical to what prompt compilation used
 *   2. overview wells take a clamped ratio and a height cap; grid columns stay literal
 *   3. review canvases take both computed dimensions, from the shot's own ratio
 *   4. references keep their intrinsic shape and never inherit the output ratio
 *   5. opening, switching or inspecting never writes project data
 *   6. a shot can actually be given a format, including an arbitrary one
 *
 * CI runs headless on Windows with no browser, so the framing contract is asserted
 * against the declared CSS, the rendered markup and the pure resolvers.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { render, buildFixture } = require('./render-harness');
const PromptEngine = require('../prompt-engine');
const Aspect = require('../public/shared-aspect');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

/* Narrow-width overrides must never stand in for the desktop rule under test. */
function stripAtRules(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') { out += text[i]; continue; }
    const open = text.indexOf('{', i);
    if (open === -1) { out += text.slice(i); break; }
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    i = j;
  }
  return out;
}
const baseCss = stripAtRules(css);

function ruleFor(selector, source = baseCss) {
  const blocks = [];
  let from = 0;
  while (true) {
    const at = source.indexOf(selector, from);
    if (at === -1) break;
    from = at + selector.length;
    const before = source[at - 1];
    const after = source[from];
    if (before && !/[\s,}{>+~]/.test(before)) continue;
    if (after && !/[\s,{]/.test(after)) continue;
    const open = source.indexOf('{', from);
    const close = source.indexOf('}', open);
    if (open === -1 || close === -1) continue;
    blocks.push(source.slice(open + 1, close));
  }
  return blocks;
}
function declaration(selector, property, source = baseCss) {
  let value = null;
  for (const block of ruleFor(selector, source)) {
    const match = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i'));
    if (match) value = match[1].trim().replace(/\s*!important\s*$/i, '');
  }
  return value;
}

const results = [];
function note(line) { results.push(line); }

/* The app's module-scope state is lexical inside the sandbox, so it is read by evaluating
 * in that context rather than off the context object. SAVE_REVISION is the honest signal
 * that something called dirty(): it increments before the debounced write is even queued. */
function saveRevision(context) { return vm.runInContext('SAVE_REVISION', context); }
function sandboxProject(context) { return vm.runInContext('P', context); }

/* The six formats this product has to support as primary workflows, plus the arbitrary
 * one. Every table below is driven from this list so none of them can drift apart. */
const FORMATS = [
  { label: '16:9', ratio: 16 / 9, name: 'widescreen' },
  { label: '21:9', ratio: 21 / 9, name: 'ultrawide' },
  { label: '2.39:1', ratio: 2.39, name: 'cinematic scope' },
  { label: '1:1', ratio: 1, name: 'square' },
  { label: '9:16', ratio: 0.5625, name: 'vertical' },
  { label: '3:2', ratio: 1.5, name: 'arbitrary custom' },
];

/* ================================================================================
   1. One parser, unchanged
   ================================================================================ */
/* The exact implementation that lived in prompt-engine.js before it moved. Prompt
 * compilation is the oldest consumer of this rule, so "the ratio model got a display
 * layer" must not quietly become "the ratio model changed". */
function originalParseAspectRatio(value) {
  const matches = [...String(value || '').trim().matchAll(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/g)];
  for (const match of matches) {
    const left = Number(match[1]), right = Number(match[2]), ratio = left / right;
    if (left > 0 && right > 0 && ratio >= 0.4 && ratio <= 3.2)
      return `${match[1]}:${match[2]}`;
  }
  return '';
}

const PARSER_CORPUS = [
  '16:9', '21:9', '2.39:1', '1:1', '9:16', '3:2', '4:3', '5:4', '3:4', '2:3', '4:5',
  '2:1', '1.85:1', '  2.39 : 1  ', 'Shot at 2.39:1 scope', 'Short film / 16:9',
  'Feature — 2.39:1 anamorphic', '', '   ', 'widescreen', 'vertical', 'square',
  '0:0', '1:0', '0:1', '50:1', '1:50', '10:1', '1:10', '3.3:1', '0.3:1',
  '12:34:56', 'lens 50mm f:1.4', 'timecode 00:03.2', null, undefined, 0, false,
  'a 4:3 insert inside a 2.39:1 feature', '16 : 9', '2,39:1', '-16:9',
];

for (const input of PARSER_CORPUS) {
  assert.strictEqual(
    Aspect.parseAspectRatio(input),
    originalParseAspectRatio(input),
    `the parser must behave exactly as it did before it moved, for input ${JSON.stringify(input)}`,
  );
}
assert.strictEqual(
  PromptEngine.parseAspectRatio,
  Aspect.parseAspectRatio,
  'prompt-engine must re-export the one shared parser rather than keep a second copy',
);
note(`parser: ${PARSER_CORPUS.length} inputs identical to the pre-move implementation, one shared function`);

/* Prompt compilation still reads what it always read, including the legacy fallback. */
{
  const declared = buildFixture();
  declared.meta.aspectRatio = '2.39:1';
  assert.strictEqual(PromptEngine.buildContext(declared, 'L1-01').project.aspectRatio, '2.39:1');

  const legacy = buildFixture();
  legacy.meta.aspectRatio = '';
  legacy.meta.format = 'Short film / 21:9';
  assert.strictEqual(
    PromptEngine.buildContext(legacy, 'L1-01').project.aspectRatio,
    '21:9',
    'a project carrying its ratio only in the legacy format field must still compile at that ratio',
  );

  const none = buildFixture();
  none.meta.format = 'Short film';
  assert.strictEqual(PromptEngine.buildContext(none, 'L1-01').project.aspectRatio, '');
  note('prompt compilation: declared, legacy-format and absent ratios all unchanged');
}

/* ================================================================================
   2. Precedence
   ================================================================================ */
{
  const project = buildFixture();
  project.meta.aspectRatio = '2.39:1';
  const shot = project.shots[0];

  assert.strictEqual(Aspect.productionAspect(project).label, '2.39:1');
  assert.strictEqual(Aspect.shotOutputAspect(project, shot).label, '2.39:1', 'a shot with no override follows its project');

  shot.creationBrief = { composition: { aspectRatio: '9:16' } };
  assert.strictEqual(Aspect.shotOutputAspect(project, shot).label, '9:16', 'a declared shot override wins over its project');
  assert.strictEqual(Aspect.shotAspectLabel(project, shot), '9:16');

  /* Declared intent only — the intrinsic fallback belongs to the display resolver, so a
   * caller that needs to know whether anything was actually declared can find out. */
  const undeclared = buildFixture();
  undeclared.meta.format = 'Short film';
  assert.strictEqual(Aspect.shotOutputAspect(undeclared, undeclared.shots[0]), null);
  assert.strictEqual(Aspect.shotAspectLabel(undeclared, undeclared.shots[0]), '16:9');

  /* Full display precedence: shot, project, asset dimensions, then 16:9. */
  assert.strictEqual(Aspect.resolveDisplayAspect({ project, shot }).label, '9:16');
  assert.strictEqual(
    Aspect.resolveDisplayAspect({ project: undeclared, shot: undeclared.shots[0], natural: { width: 1000, height: 1000 } }).label,
    '1000:1000',
    'with nothing declared, the asset\'s own dimensions decide',
  );
  assert.strictEqual(Aspect.resolveDisplayAspect({ project: undeclared, shot: undeclared.shots[0] }).label, '16:9');

  /* Malformed data must fall back safely and must never be rewritten. */
  for (const bad of ['widescreen', '0:0', '50:1', '{}', null]) {
    const broken = buildFixture();
    broken.meta.aspectRatio = bad;
    assert.strictEqual(Aspect.productionAspect(broken), null, `"${bad}" must not resolve to a format`);
    assert.strictEqual(Aspect.projectAspectLabel(broken), '16:9', `"${bad}" must fall back safely`);
    assert.strictEqual(broken.meta.aspectRatio, bad, `"${bad}" must be left in the record exactly as stored`);
  }
  note('precedence: shot override > project > legacy format > asset dimensions > 16:9, malformed falls back without rewriting');
}

/* Every supported format resolves, and none is rejected by the believable-range clamp. */
for (const format of FORMATS) {
  const resolved = Aspect.resolveAspect(format.label);
  assert(resolved, `${format.label} (${format.name}) must resolve — it is a production format this product supports`);
  assert(Math.abs(resolved.ratio - format.ratio) < 0.0005, `${format.label} resolved to ${resolved.ratio}`);
  assert(/^[\d.]+ \/ [\d.]+$/.test(resolved.css), `${format.label} must produce a usable CSS aspect-ratio, got "${resolved.css}"`);
}
note(`formats: ${FORMATS.map((f) => f.label).join(', ')} all resolve to usable CSS ratios`);

/* ================================================================================
   3. Overview policy — bounded wells, untouched grid columns
   ================================================================================ */
/* A ratio-derived column width can produce a track floor above its own ceiling, which
 * collapses an auto-fill grid. The board's columns therefore stay two literal constants
 * whatever the production format is, and the well is bounded by height instead. */
const BOARD_DENSITIES = [
  ['compact', '.shot-row.bounded-shot-page.size-compact', 260, 219],
  ['comfortable', '.shot-row.bounded-shot-page.size-comfortable', 340, 287],
  ['large', '.shot-row.bounded-shot-page.size-large', 460, 388],
];

for (const [label, selector, columnWidth, expectedCap] of BOARD_DENSITIES) {
  const track = declaration(selector, 'grid-template-columns');
  assert(track, `board size "${label}": ${selector} must declare its columns`);
  assert(
    !track.includes('var('),
    `board size "${label}": column widths must stay literal — a ratio-derived track can invert its own minmax(). Got "${track}"`,
  );
  const bounds = track.match(/minmax\(\s*([0-9.]+)px\s*,\s*([0-9.]+)px\s*\)/);
  assert(bounds, `board size "${label}": expected two literal px bounds, got "${track}"`);
  const [min, max] = [parseFloat(bounds[1]), parseFloat(bounds[2])];
  assert(min <= max, `board size "${label}": the column minimum (${min}px) must never exceed its maximum (${max}px)`);

  const cap = parseFloat(String(declaration(`${selector} .slate-thumb`, 'max-height') || '').replace('px', ''));
  assert.strictEqual(
    cap,
    expectedCap,
    `board size "${label}": the well cap must be round(${columnWidth} / (16/9) * 1.5) = ${expectedCap}px, got ${cap}px`,
  );
  assert.strictEqual(cap, Aspect.overviewWellCap(columnWidth, 'browse'), 'the declared cap must match the shared sizing rule');
  note(`board "${label}": columns ${min}-${max}px literal, well capped at ${cap}px`);
}

/* The measurement that motivated the whole repair: what a board card actually becomes in
 * each format, at each density. The 9:16 case is the one that used to be intolerable. */
for (const [label, selector, columnWidth, cap] of BOARD_DENSITIES) {
  for (const format of FORMATS) {
    const wellRatio = Aspect.overviewAspect(format.ratio);
    const height = Math.min(Math.round(columnWidth / wellRatio), cap);
    assert(
      height <= cap,
      `board "${label}" at ${format.label}: the well reached ${height}px, above its ${cap}px cap`,
    );
    assert(height > 0);
    if (format.label === '9:16') {
      const unbounded = Math.round(columnWidth / format.ratio);
      assert(
        unbounded > cap && height === cap,
        `board "${label}": a 9:16 card would reach ${columnWidth}x${unbounded} unbounded; it must be capped at ${cap}px`,
      );
      note(`board "${label}" at 9:16: ${columnWidth}x${height} — not ${columnWidth}x${unbounded}`);
    }
  }
}
/* Stated as the concrete number, because it is the number that was wrong. */
{
  const unbounded = Math.round(340 / 0.5625);
  assert.strictEqual(unbounded, 604, 'a 9:16 card in a 340px column is 604px tall if nothing bounds it');
  assert.strictEqual(Math.min(Math.round(340 / Aspect.overviewAspect(0.5625)), 287), 287);
  note('board "comfortable" at 9:16 is 340x287, never 340x604');
}

/* The clamp itself: vertical media cannot make a row three times as tall, and scope
 * cannot collapse a well to nothing. */
assert.strictEqual(Aspect.overviewAspect(0.5625), 0.75, '9:16 must clamp to the vertical floor');
assert.strictEqual(Aspect.overviewAspect(2.39), 2.39, 'scope is inside the range and must pass through');
assert.strictEqual(Aspect.overviewAspect(4), 2.4, 'anything wider than the ceiling must clamp to it');
assert.strictEqual(Aspect.overviewAspect(16 / 9), 16 / 9, 'the default format must be untouched by the clamp');
for (const bad of [0, -1, NaN, null, undefined, 'x']) {
  assert.strictEqual(Aspect.overviewAspect(bad), 16 / 9, `overviewAspect(${JSON.stringify(bad)}) must fall back safely`);
}

/* Shot-output wells read the shot-then-project chain; reference wells read a separate
 * property so a character sheet inside a 2.39:1 shot workspace cannot inherit that. */
const SHOT_OUTPUT_WELLS = ['.slate-thumb', '.production-inbox-item>div', '.guided-candidate-preview', '.frame-sequence-thumbs img', '.scene-review-approved-strip img'];
const REFERENCE_WELLS = ['.library-preview', '.guided-input-thumb', '.entity-authority-thumb-button .entity-authority-thumb', '.state-approved-preview', '.state-validation-thumbs img'];

for (const selector of SHOT_OUTPUT_WELLS) {
  const declared = declaration(selector, 'aspect-ratio') || '';
  assert(
    declared.includes('--cb-well-aspect') && declared.includes('--cb-production-aspect') && declared.includes('16/9'),
    `${selector}: shot imagery must read shot override, then project format, then the 16/9 fallback. Got "${declared}"`,
  );
}
for (const selector of REFERENCE_WELLS) {
  const declared = declaration(selector, 'aspect-ratio') || '';
  assert(
    declared.includes('--cb-intrinsic-aspect'),
    `${selector}: a reference must be shown at its own shape. Got "${declared}"`,
  );
  assert(
    !declared.includes('--cb-production-aspect') && !declared.includes('--cb-well-aspect'),
    `${selector}: a character sheet, prop or angle reference must never be forced into the production's output ratio. Got "${declared}"`,
  );
}
note(`wells: ${SHOT_OUTPUT_WELLS.length} shot-output surfaces follow the production format, ${REFERENCE_WELLS.length} reference surfaces stay intrinsic`);

/* AND EVERY WELL THAT READS THE VARIABLE HAS SOMETHING THAT WRITES IT.
 *
 * `--cb-intrinsic-aspect` is written by exactly one place -- `applyIntrinsicAspect()`,
 * over the wells named in app.js's `CB_INTRINSIC_WELLS`. A stylesheet rule can read the
 * variable without that query ever selecting its element, and nothing complains: the
 * `var()` fallback simply stands in forever. That is not hypothetical. The reference
 * detail hero, `.reference-primary-preview`, declared `var(--cb-intrinsic-aspect,4/3)`
 * and was never named in the query, so every reference in the product was framed 4/3
 * whatever its real shape -- a 2:3 character sheet showed half of itself and a 1:3
 * costume plate a quarter, hard-clipped by the well's own `overflow:hidden`.
 *
 * So the two halves are asserted against each other rather than each on its own: every
 * selector that READS the property must be covered by a selector that gets it WRITTEN. */
{
  const wellsSource = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const declared = wellsSource.match(/const CB_INTRINSIC_WELLS\s*=\s*"([^"]+)"/);
  assert(declared, 'app.js must declare CB_INTRINSIC_WELLS as one string literal');
  const written = declared[1].split(',').map((part) => part.trim()).filter(Boolean);

  /* Selector groups from the full stylesheet, media queries included: a well declared
     only inside one still needs a writer. */
  const readers = new Set();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rule.exec(css))) {
    if (!/--cb-intrinsic-aspect/.test(match[2])) continue;
    for (const selector of match[1].split(',')) {
      const trimmed = selector.trim().replace(/\s+/g, ' ');
      if (trimmed && !trimmed.startsWith('@')) readers.add(trimmed);
    }
  }
  assert(readers.size > 0, 'the stylesheet must contain wells that read --cb-intrinsic-aspect');

  /* A writer covers a reader when it selects the same element: either the identical
     selector, or the reader's own trailing compound (`.a .b` is written by `.b`). The
     boundary check keeps `.thumb` from appearing to cover `.other-thumb`. */
  function covers(writer, reader) {
    if (writer === reader) return true;
    if (!reader.endsWith(writer)) return false;
    return /[\s>+~]/.test(reader[reader.length - writer.length - 1] || '');
  }

  for (const reader of readers) {
    assert(
      written.some((writer) => covers(writer, reader)),
      `${reader}: reads --cb-intrinsic-aspect but no CB_INTRINSIC_WELLS selector writes it, so it is stuck on its var() fallback forever`,
    );
  }
  assert(
    readers.has('.reference-primary-preview'),
    "the reference detail hero must still take the reference's own shape",
  );
  note(`intrinsic wells: ${readers.size} selectors read --cb-intrinsic-aspect, all covered by ${written.length} writers`);
}

/* AND THE HERO'S MEDIA ROW CANNOT OUTGROW THE WELL. The hero is a grid, and its media
 * sat in an implicit, content-sized row: a tall reference laid out at its full intrinsic
 * height (1074px inside a 270px well), `height:100%` resolved against that overflowing
 * row rather than against the well, and `object-fit:contain` never got to contain
 * anything -- `overflow:hidden` simply cut the rest off. An explicit track bounds it. */
{
  const rows = declaration('.reference-primary-preview', 'grid-template-rows');
  assert(rows, '.reference-primary-preview must declare an explicit grid-template-rows');
  assert(
    /minmax\(\s*0/.test(rows),
    `.reference-primary-preview: its media row must be bounded by the well (minmax(0,...)), or a tall reference overflows it and is clipped. Got "${rows}"`,
  );
  assert.strictEqual(
    declaration('.reference-primary-preview img', 'object-fit'),
    'contain',
    'the hero must contain its reference, never crop it',
  );
  note('reference hero: bounded media row + object-fit:contain, so every reference shape is shown whole');
}

/* ================================================================================
   4. Selection policy — constant-area review canvases
   ================================================================================ */
const SELECTION_EXPECTED = {
  '16:9': { w: 438, h: 246 },
  '21:9': { w: 501, h: 215 },
  '2.39:1': { w: 507, h: 212 },
  '1:1': { w: 328, h: 328 },
  '9:16': { w: 246, h: 437 },
  '3:2': { w: 402, h: 268 },
};
const baselineArea = SELECTION_EXPECTED['16:9'].w * SELECTION_EXPECTED['16:9'].h;
for (const format of FORMATS) {
  const well = Aspect.selectionWell(format.ratio);
  assert.deepStrictEqual(
    well,
    SELECTION_EXPECTED[format.label],
    `${format.label}: review canvas should be ${SELECTION_EXPECTED[format.label].w}x${SELECTION_EXPECTED[format.label].h}`,
  );
  const area = well.w * well.h;
  assert(
    Math.abs(area - baselineArea) / baselineArea < 0.02,
    `${format.label}: every format must get the same area to be judged in — ${area} against ${baselineArea}`,
  );
  /* The two failures the constant-area rule exists to prevent. */
  assert(well.w >= 220, `${format.label}: a review canvas ${well.w}px wide is a strip, not a composition`);
  assert(well.h >= 200, `${format.label}: a review canvas ${well.h}px tall is an unreadable ribbon`);
  note(`review canvas at ${format.label}: ${well.w}x${well.h} (${area}px², baseline ${baselineArea})`);
}

/* Both dimensions are published and both are used, and the viewport still wins. */
{
  const width = declaration('.guided-next-action .guided-lifecycle-preview', 'width') || '';
  const height = declaration('.guided-next-action .guided-lifecycle-preview', 'height') || '';
  const maxHeight = declaration('.guided-next-action .guided-lifecycle-preview', 'max-height') || '';
  assert(width.includes('--cb-selection-w'), `the review canvas must take its computed width, got "${width}"`);
  assert(height.includes('--cb-selection-h'), `the review canvas must take its computed height, got "${height}"`);
  assert(/vh/.test(maxHeight), `the review canvas must stay inside the viewport, got "${maxHeight}"`);
  const track = declaration('.guided-next-action', 'grid-template-columns') || '';
  assert(
    !/minmax\([^)]*var\(/.test(track),
    `the review canvas column must not put a computed width inside a minmax() minimum, got "${track}"`,
  );
  note(`review canvas: width ${width}, height ${height}, bounded by ${maxHeight}`);
}

/* ================================================================================
   5. The format actually reaches the screen
   ================================================================================ */
function projectAt(label, { shotOverride } = {}) {
  const project = buildFixture();
  project.meta.aspectRatio = label;
  if (shotOverride !== undefined) {
    project.shots[0].creationBrief = { composition: { aspectRatio: shotOverride } };
  }
  return project;
}
/* Approvals cleared so RETURNED RESULTS has a decision to show. */
function pendingAt(label, options) {
  const project = projectAt(label, options);
  for (const shot of project.shots) for (const frame of shot.keyframes || []) frame.winner = '';
  return project;
}

async function main() {
  for (const format of FORMATS) {
    const board = await render('#/shots', projectAt(format.label));
    const expected = Aspect.overviewAspectCss(Aspect.resolveAspect(format.label));
    assert(
      board.html.includes(`--cb-well-aspect:${expected}`),
      `${format.label}: the board card well must carry the production format, expected --cb-well-aspect:${expected}`,
    );
    assert.strictEqual(saveRevision(board.context), 0, `${format.label}: rendering the board must not mark the project dirty`);

    const production = await render('#/production', pendingAt(format.label));
    assert(
      production.html.includes(`--cb-well-aspect:${expected}`),
      `${format.label}: the returned-results row must carry the production format too, not only the board`,
    );
    assert.strictEqual(saveRevision(production.context), 0, `${format.label}: the dashboard must not mark the project dirty`);
    note(`${format.label}: board and returned results both render --cb-well-aspect:${expected}`);
  }

  /* A shot with its own format keeps it everywhere it appears, not only in its own
   * workspace — that is the difference between a real override and a local one. */
  {
    const override = Aspect.overviewAspectCss(Aspect.resolveAspect('9:16'));
    const project = Aspect.overviewAspectCss(Aspect.resolveAspect('16:9'));
    const board = await render('#/shots', projectAt('16:9', { shotOverride: '9:16' }));
    assert(
      board.html.includes(`--cb-well-aspect:${override}`) && !board.html.includes(`--cb-well-aspect:${project}`),
      'a shot override must reach the board card, not just the open shot workspace',
    );
    const dashboard = await render('#/production', pendingAt('16:9', { shotOverride: '9:16' }));
    assert(
      dashboard.html.includes(`--cb-well-aspect:${override}`),
      'a shot override must reach the returned-results dashboard',
    );
    note('shot override: reaches the board card and the dashboard row, beating its project');
  }

  /* Both dimensions of a review canvas come from the shot's effective ratio. The
   * project-level values are only what an inherited shot falls back to. */
  for (const [projectLabel, shotLabel] of [['16:9', '9:16'], ['9:16', '2.39:1']]) {
    const shotWell = Aspect.selectionWell(Aspect.resolveAspect(shotLabel).ratio);
    const projectWell = Aspect.selectionWell(Aspect.resolveAspect(projectLabel).ratio);
    const overridden = await render('#/shot/L1-01', projectAt(projectLabel, { shotOverride: shotLabel }));
    assert(
      overridden.html.includes(`--cb-selection-w:${shotWell.w}px`) && overridden.html.includes(`--cb-selection-h:${shotWell.h}px`),
      `a ${shotLabel} shot inside a ${projectLabel} project must review at ${shotWell.w}x${shotWell.h}, both dimensions from the shot`,
    );
    assert(
      !overridden.html.includes(`--cb-selection-w:${projectWell.w}px`),
      `a ${shotLabel} shot must not review at its project's ${projectWell.w}x${projectWell.h}`,
    );

    const inherited = await render('#/shot/L1-01', projectAt(projectLabel));
    assert(
      inherited.html.includes(`--cb-selection-w:${projectWell.w}px`) && inherited.html.includes(`--cb-selection-h:${projectWell.h}px`),
      `a shot that inherits must review at its project's ${projectWell.w}x${projectWell.h}`,
    );
    note(`review canvas: ${shotLabel} shot in a ${projectLabel} project renders ${shotWell.w}x${shotWell.h}; inherited shots stay ${projectWell.w}x${projectWell.h}`);
  }

  /* A project with no format, and one with unusable format data, both render on the
   * stylesheet's own 16/9 fallback rather than being corrected on disk. */
  for (const [description, value] of [['no ratio metadata', ''], ['malformed ratio data', 'widescreen'], ['an out-of-range ratio', '50:1']]) {
    const project = buildFixture();
    project.meta.aspectRatio = value;
    project.meta.format = 'Short film';
    const board = await render('#/shots', project);
    assert(
      !board.html.includes('--cb-well-aspect:'),
      `a project with ${description} must emit no ratio at all and let the 16/9 CSS fallback stand`,
    );
    assert.strictEqual(saveRevision(board.context), 0, `a project with ${description} must not be rewritten on open`);
    assert.strictEqual(sandboxProject(board.context).meta.aspectRatio, value, `${description} must be left in the record exactly as stored`);
    note(`${description}: renders on the 16/9 fallback, record untouched, no write`);
  }

  /* References are shown at their own shape. Nothing in a references view declares an
   * output ratio, so the intrinsic binding is the only thing that can size those wells. */
  {
    const library = await render('#/library', projectAt('2.39:1'));
    assert(
      !library.html.includes('--cb-well-aspect:'),
      'a widescreen or scope project must not stamp its output ratio onto reference cards',
    );
    assert.strictEqual(saveRevision(library.context), 0);
    note('references: a 2.39:1 project leaves reference cards intrinsic');
  }

  /* ==============================================================================
     6. The shot format control
     ============================================================================== */
  {
    const shotPage = await render('#/shot/L1-01', projectAt('2.39:1'), {
      storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'look' },
    });
    const html = shotPage.html;
    assert(html.includes('shot-aspect-control'), 'the shot workspace must expose a format control — the override was previously unreachable');
    assert(html.includes('Use the project format (2.39:1)'), 'the inherit option must name the format it inherits');
    for (const [value] of Aspect.CINEBRAID_ASPECT_PRESETS)
      assert(html.includes(`value="${value}"`), `the control must offer ${value}`);
    assert(html.includes('>Custom…<'), 'the control must offer an arbitrary ratio');
    assert(!html.includes('shot-aspect-custom-L1-01'), 'a shot on a named format needs no free-text field taking up the workspace');
    note('shot control: inherit, five named formats and Custom…, free-text field held back until it is needed');

    const ctx = shotPage.context;
    const shot = () => sandboxProject(ctx).shots.find((s) => s.id === 'L1-01');
    const stored = () => shot().creationBrief?.composition?.aspectRatio || '';

    ctx.setShotAspectRatio('L1-01', '9:16');
    assert.strictEqual(stored(), '9:16', 'choosing a named format must store it');

    /* Custom… has to be able to accept a value — an option that only selects is a dead
     * end. It reveals the field and stores nothing until a real ratio arrives. */
    ctx.setShotAspectRatio('L1-01', 'custom');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const opened = ctx.document.getElementById('main').innerHTML;
    assert(opened.includes('id="shot-aspect-custom-L1-01"'), 'Custom… must reveal a field that can actually take a ratio');
    assert(!/id="shot-aspect-custom-L1-01"[^>]*disabled/.test(opened), 'the revealed field must be usable');
    assert.strictEqual(stored(), '9:16', 'selecting Custom… alone must not change what is stored');

    ctx.setShotAspectRatio('L1-01', '2:1');
    assert.strictEqual(stored(), '2:1', 'an arbitrary ratio must persist explicitly');

    const before = saveRevision(ctx);
    ctx.setShotAspectRatio('L1-01', 'not a ratio');
    assert.strictEqual(stored(), '2:1', 'unreadable input must never overwrite a good stored format');
    assert.strictEqual(saveRevision(ctx), before, 'a rejected entry must not queue a save');
    const hint = ctx.document.getElementById('shot-aspect-hint-L1-01');
    assert(/not a usable aspect ratio/.test(hint.textContent), 'a rejected entry must say why');

    ctx.setShotAspectRatio('L1-01', '');
    assert.strictEqual(stored(), '', 'the control must be able to return the shot to project inheritance');
    note('shot control: named formats, an arbitrary 2:1, rejection without data loss, and a way back to inheritance');

    /* A stored value that is not a preset comes back as Custom…, with the field open and
     * filled, so an arbitrary ratio round-trips rather than being silently lost. */
    const custom = await render('#/shot/L1-01', projectAt('16:9', { shotOverride: '2:1' }), {
      storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'look' },
    });
    assert(/<option value="custom" selected>/.test(custom.html), 'a stored arbitrary ratio must reopen as Custom…');
    assert(/id="shot-aspect-custom-L1-01"[^>]*value="2:1"/.test(custom.html), 'the custom field must come back filled');
    assert(!/id="shot-aspect-custom-L1-01"[^>]*disabled/.test(custom.html), 'the custom field must come back usable');
    note('shot control: an arbitrary ratio round-trips through Custom…');
  }

  /* ==============================================================================
     7. Inheritance, and values the old default already stamped
     ============================================================================== */
  {
    /* Opening a shot workspace used to stamp the project's format onto the shot, which
     * froze it. It must not do that any more. */
    const fresh = await render('#/shot/L1-01', projectAt('2.39:1'));
    const shot = sandboxProject(fresh.context).shots.find((s) => s.id === 'L1-01');
    assert.strictEqual(
      shot.creationBrief.composition.aspectRatio,
      '',
      'opening a shot must leave its format unset so it keeps following the project',
    );
    assert.strictEqual(saveRevision(fresh.context), 0, 'opening a shot workspace must not mark the project dirty');

    /* An unstamped shot follows a later project change; an explicit one does not. */
    const project = projectAt('16:9');
    const inherited = project.shots[0];
    assert.strictEqual(Aspect.shotAspectLabel(project, inherited), '16:9');
    project.meta.aspectRatio = '9:16';
    assert.strictEqual(Aspect.shotAspectLabel(project, inherited), '9:16', 'an inherited shot must follow the project when the format changes');

    const overridden = projectAt('16:9', { shotOverride: '2.39:1' });
    assert.strictEqual(Aspect.shotAspectLabel(overridden, overridden.shots[0]), '2.39:1');
    overridden.meta.aspectRatio = '9:16';
    assert.strictEqual(
      Aspect.shotAspectLabel(overridden, overridden.shots[0]),
      '2.39:1',
      'an explicit shot format must not be dragged along by a project change',
    );

    /* A value the old default already wrote is indistinguishable from a deliberate one,
     * so it is honoured as an override and left alone. Clearing it is the user's call. */
    const legacyStamped = projectAt('9:16', { shotOverride: '16:9' });
    assert.strictEqual(
      Aspect.shotAspectLabel(legacyStamped, legacyStamped.shots[0]),
      '16:9',
      'a previously stamped shot value must be honoured, never silently cleared or migrated',
    );
    const stampedRender = await render('#/shot/L1-01', legacyStamped, {
      storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'look' },
    });
    assert.strictEqual(sandboxProject(stampedRender.context).shots[0].creationBrief.composition.aspectRatio, '16:9');
    assert.strictEqual(saveRevision(stampedRender.context), 0, 'a stamped shot must not be rewritten on open');
    assert(
      /<option value="16:9" selected>/.test(stampedRender.html),
      'a stamped value must be shown as the explicit override it is now indistinguishable from',
    );
    note('inheritance: unset shots follow the project, explicit ones do not, previously stamped values are honoured and never rewritten');
  }

  /* ==============================================================================
     8. Reference imagery that appears after the first render
     ============================================================================== */
  /* Tabs, modals and comparison panels render without a route change, and a cached image
   * is complete before any handler could attach. Exercised against a minimal DOM so the
   * four cases are deterministic. */
  {
    const bound = [];
    function makeImage(src, { cached = false, width = 900, height = 1600 } = {}) {
      const listeners = {};
      return {
        tagName: 'IMG',
        dataset: {},
        complete: cached,
        naturalWidth: cached ? width : 0,
        naturalHeight: cached ? height : 0,
        getAttribute: () => src,
        addEventListener(type, handler, options) {
          listeners[type] = listeners[type] || [];
          listeners[type].push({ handler, once: options && options.once });
        },
        listeners,
        finishLoading(w = width, h = height) {
          this.complete = true;
          this.naturalWidth = w;
          this.naturalHeight = h;
          for (const entry of listeners.load || []) entry.handler();
        },
        setSrc(next) { src = next; },
      };
    }
    function makeWell(img) {
      return {
        tagName: 'DIV',
        querySelector: () => img,
        style: { setProperty: (name, value) => bound.push([name, value]) },
      };
    }

    const app = await render('#/library', buildFixture());
    const bind = app.context.bindIntrinsicAspect;

    /* 1. cached — already complete, so no load event will ever fire */
    const cachedImg = makeImage('/assets/anchors/KAI.png', { cached: true, width: 1000, height: 1000 });
    const cachedWell = makeWell(cachedImg);
    bind({ querySelectorAll: () => [cachedWell] });
    assert.deepStrictEqual(bound.at(-1), ['--cb-intrinsic-aspect', '1000 / 1000'], 'a cached image must be measured immediately');

    /* 2. later-loaded */
    const lateImg = makeImage('/assets/plates/LOC.png');
    const lateWell = makeWell(lateImg);
    bind({ querySelectorAll: () => [lateWell] });
    assert.strictEqual(bound.length, 1, 'an image that has not loaded yet must not be measured early');
    lateImg.finishLoading(2100, 900);
    assert.deepStrictEqual(bound.at(-1), ['--cb-intrinsic-aspect', '2100 / 900']);

    /* 3. inserted after the route render, with the already-bound images still present */
    const insertedImg = makeImage('/assets/props/TOOL.png', { cached: true, width: 1600, height: 900 });
    const insertedWell = makeWell(insertedImg);
    const scope = { querySelectorAll: () => [cachedWell, lateWell, insertedWell] };
    const beforeInsert = bound.length;
    bind(scope);
    assert.strictEqual(bound.length, beforeInsert + 1, 'only the newly inserted image should be measured again');
    assert.deepStrictEqual(bound.at(-1), ['--cb-intrinsic-aspect', '1600 / 900']);

    /* re-running over unchanged content must do nothing and must not stack listeners */
    const quiet = bound.length;
    bind(scope);
    assert.strictEqual(bound.length, quiet, 'rebinding unchanged content must be a no-op');
    assert.strictEqual(lateImg.listeners.load.length, 1, 'an image must never collect a second load listener');

    /* 4. the src changes in place */
    insertedImg.setSrc('/assets/props/TOOL-V2.png');
    insertedImg.naturalWidth = 900;
    insertedImg.naturalHeight = 1600;
    bind(scope);
    assert.deepStrictEqual(
      bound.at(-1),
      ['--cb-intrinsic-aspect', '0.75 / 1'],
      'swapping an image source must recompute its shape rather than leave the old one',
    );
    note('dynamic references: cached, later-loaded, inserted after render and src-swapped images all resolve, with no duplicate listeners');
  }

  console.log('multi-aspect-media: OK');
  for (const line of results) console.log('  ' + line);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

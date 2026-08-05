/* Image review scale and inspection — regression coverage.
 *
 * Imagery a filmmaker is asked to judge used to be sized by whatever container
 * happened to hold it, and cropped to fit:
 *
 *   shot board cards      960x540 source in a 16/10 well with `cover` — 10% of every frame discarded
 *   production candidates 64x46  (1.39:1) with `cover` — 21.7% discarded
 *   references grid       4/3 well with `cover` — 25% discarded
 *   reference angles      60x46  (1.30:1) with `cover` — 26.6% discarded
 *   frame candidates      correctly fitted, but with no way to enlarge them
 *
 * The repair defines three deliberate tiers — overview, selection, inspection —
 * gives judgement imagery an aspect-ratio-correct well with `object-fit: contain`,
 * and routes every enlargement through the one existing media theatre modal.
 *
 * CI runs headless on Windows with no browser, so the framing contract is asserted
 * against the declared CSS and the rendered markup rather than against a screenshot.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, buildFixture } = require('./render-harness');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

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

/* --- tiny CSS reader: last declaration wins, matching cascade order for equal specificity --- */
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
/* The wells are driven by the production format now, so a declared aspect ratio or width
 * is a var() chain whose final fallback is the value a record declaring no format still
 * gets. Resolving to that fallback holds this contract to exactly what it always meant:
 * the shipped 16:9 sample, and any project without a format, is framed as before. */
function resolveVarFallback(value, depth = 0) {
  const text = String(value || '').trim();
  if (depth > 6) return text;
  const match = text.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]+))?\)$/i);
  if (!match) return text;
  if (match[2] == null) {
    const declared = declaration(':root', match[1]);
    return declared ? resolveVarFallback(declared, depth + 1) : '';
  }
  return resolveVarFallback(match[2], depth + 1);
}
/* Resolves `104px`, `var(--img-angle-w)` and `calc(var(--img-angle-w) + 12px)`
 * against the custom properties declared on :root. */
function resolveLength(value, depth = 0) {
  const text = resolveVarFallback(value);
  if (!text || depth > 4) return null;
  const calc = text.match(/^calc\((.+)\)$/i);
  if (calc) {
    const [left, op, right] = calc[1].split(/\s+([+\-])\s+/);
    const a = resolveLength(left, depth + 1);
    const b = resolveLength(right, depth + 1);
    if (a === null || b === null) return null;
    return op === '-' ? a - b : a + b;
  }
  const variable = text.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (variable) return resolveLength(declaration(':root', variable[1]), depth + 1);
  const px = text.match(/^([0-9.]+)px$/);
  return px ? parseFloat(px[1]) : null;
}
function ratio(value) {
  const parts = resolveVarFallback(value).split('/').map((x) => parseFloat(x));
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return parts[0] / parts[1];
}

/* Every sample and generated still in this product is 16:9. A judgement well whose
 * aspect ratio differs from the source, filled with `cover`, silently crops. */
const SOURCE_RATIO = 16 / 9;

/* --- the three tiers, and what each is required to deliver ---------------------- */
const OVERVIEW_MIN_WIDTH = 96;   /* recognizable while browsing */
const SELECTION_MIN_WIDTH = 240; /* comparable side by side */

const JUDGEMENT_SURFACES = [
  {
    name: 'shot board card',
    tier: 'selection',
    well: '.slate-thumb',
    image: '.slate-thumb img',
  },
  {
    name: 'production returned result',
    tier: 'overview',
    well: '.production-inbox-item>div',
    image: '.production-inbox-item img',
    widthFrom: '.production-inbox-item>div',
  },
  {
    name: 'references grid card',
    tier: 'selection',
    well: '.library-preview',
    image: '.library-preview img',
  },
  {
    name: 'reference-angle choice',
    tier: 'overview',
    well: '.entity-authority-thumb-button .entity-authority-thumb',
    image: '.entity-authority-thumb-button img',
    widthFrom: '.entity-authority-thumb-button .entity-authority-thumb',
  },
  {
    name: 'shot input tray reference',
    tier: 'overview',
    well: '.guided-input-thumb',
    image: '.guided-input-thumb img',
    widthFrom: '.guided-input-thumb',
  },
  {
    name: 'shot next-action image',
    tier: 'selection',
    image: '.guided-lifecycle-media img',
  },
  {
    name: 'frame candidate',
    tier: 'selection',
    image: '.guided-candidate-preview img',
  },
  {
    name: 'scene approved still',
    tier: 'selection',
    image: '.scene-review-approved-strip img',
  },
  {
    name: 'approved-reference hero',
    tier: 'selection',
    well: '.state-approved-preview',
    image: '.state-approved-preview img',
    widthFrom: '.state-approved-preview',
  },
  {
    name: 'continuity-state comparison',
    tier: 'overview',
    well: '.state-validation-thumbs img',
    image: '.state-validation-thumbs img',
    widthFrom: '.state-validation-thumbs img',
  },
  {
    name: 'approved frame sequence',
    tier: 'overview',
    well: '.frame-sequence-thumbs img',
    image: '.frame-sequence-thumbs img',
  },
  {
    name: 'approved motion frame',
    tier: 'overview',
    well: '.guided-motion-frame-preview img',
    image: '.guided-motion-frame-preview img',
  },
  {
    name: 'media theatre stage',
    tier: 'inspection',
    image: '.media-theatre-stage img',
  },
];

/* The card-size control has to stay usable at all three settings. Compact is the
 * density the user deliberately chose for browsing, so it is held to the overview
 * floor; Standard and Large are the sizes people switch to in order to compare
 * frames, so they have to reach the selection tier. */
const BOARD_DENSITIES = [
  ['compact', '.shot-row.bounded-shot-page.size-compact', 200],
  ['comfortable', '.shot-row.bounded-shot-page.size-comfortable', SELECTION_MIN_WIDTH],
  ['large', '.shot-row.bounded-shot-page.size-large', 340],
];

function trackFloor(template) {
  /* `repeat(auto-fill, minmax(A, B))` — A is the width a card is guaranteed. */
  const match = String(template || '').match(/minmax\(\s*([0-9.]+)px/);
  return match ? parseFloat(match[1]) : null;
}

async function main() {
  const results = [];

  /* ---------- 1. no judgement image is cropped ---------- */
  for (const surface of JUDGEMENT_SURFACES) {
    const fit = declaration(surface.image, 'object-fit');
    assert.strictEqual(
      fit,
      'contain',
      `${surface.name}: judgement imagery must preserve the whole source frame, but ${surface.image} declares object-fit: ${fit}`,
    );
    if (surface.well) {
      const declared = declaration(surface.well, 'aspect-ratio');
      assert(declared, `${surface.name}: ${surface.well} must declare an aspect ratio so the well matches the frame`);
      const wellRatio = ratio(declared);
      assert(
        wellRatio !== null && Math.abs(wellRatio - SOURCE_RATIO) < 0.01,
        `${surface.name}: a 16:9 source must not be presented in a ${declared} (${wellRatio && wellRatio.toFixed(2)}:1) box — that is the silent crop this repair removes`,
      );
      results.push(`${surface.name}: well ${declared}, object-fit ${fit}`);
    } else {
      results.push(`${surface.name}: object-fit ${fit}`);
    }
  }

  /* ---------- 2. each tier is big enough for the decision it asks for ---------- */
  for (const surface of JUDGEMENT_SURFACES.filter((s) => s.widthFrom)) {
    const declared = declaration(surface.widthFrom, 'width');
    const resolved = resolveLength(declared);
    assert(
      resolved !== null,
      `${surface.name}: ${surface.widthFrom} must declare a resolvable width, got "${declared}"`,
    );
    assert(
      resolved >= OVERVIEW_MIN_WIDTH,
      `${surface.name}: an image the user is asked to judge must render at least ${OVERVIEW_MIN_WIDTH}px wide, got ${resolved}px (${declared})`,
    );
    results.push(`${surface.name}: ${resolved}px wide`);
  }

  for (const [label, selector, minimum] of BOARD_DENSITIES) {
    const floor = trackFloor(declaration(selector, 'grid-template-columns'));
    assert(
      floor !== null,
      `board card size "${label}": ${selector} must declare a minmax card floor so the thumbnail size is knowable`,
    );
    assert(
      floor >= minimum,
      `board card size "${label}": cards must stay usable for judging a frame (>=${minimum}px), got ${floor}px`,
    );
    results.push(`board "${label}": card floor ${floor}px -> thumbnail ${Math.round(floor / SOURCE_RATIO)}px tall at 16:9`);
  }

  /* ---------- 3. one viewer, reached from every judgement surface ---------- */
  const board = await render('#/shots', buildFixture());
  const library = await render('#/library', buildFixture());

  /* RETURNED RESULTS only lists frames with candidates and no approval yet, so the
   * production fixture has its approvals cleared to put a decision in the inbox. */
  const pending = buildFixture();
  for (const shot of pending.shots) for (const frame of shot.keyframes || []) frame.winner = '';
  const production = await render('#/production', pending);

  const surfaces = [
    ['shot board card', board.html, 'slate-enlarge'],
    ['production returned result', production.html, 'production-enlarge'],
    ['references grid card', library.html, 'library-enlarge'],
  ];
  for (const [name, html, marker] of surfaces) {
    assert(
      html.includes(marker),
      `${name}: no click-to-enlarge control was rendered (expected .${marker})`,
    );
    const at = html.indexOf(marker);
    const control = html.slice(html.lastIndexOf('<button', at), html.indexOf('</button>', at));
    assert(
      control.includes('openMediaTheatre('),
      `${name}: enlargement must reuse the existing media theatre, not a competing viewer`,
    );
    assert(
      /aria-label="[^"]+"/.test(control),
      `${name}: the enlarge control needs an accessible label describing what is being enlarged`,
    );
    assert(
      control.includes('event.stopPropagation()') && control.includes('event.preventDefault()'),
      `${name}: enlarging sits inside a link, so it must not navigate away`,
    );
    for (const forbidden of ['dirty(', 'approve', 'setWinner', 'select']) {
      assert(
        !control.replace(/aria-label="[^"]*"/g, '').includes(forbidden),
        `${name}: enlarging must not approve, select or modify project data (found "${forbidden}")`,
      );
    }
    results.push(`${name}: enlarge control -> openMediaTheatre, labelled, non-navigating`);
  }

  /* The candidate and scene-still controls are built by the creation studio and the
   * scene review module; assert their markup rather than a live render so the check
   * does not depend on a shot reaching a particular workflow state. */
  const creationJs = fs.readFileSync(path.join(ROOT, 'public', 'creation-studio.js'), 'utf8');
  const sceneJs = fs.readFileSync(path.join(ROOT, 'public', 'scene-review.js'), 'utf8');
  assert(
    /candidate-enlarge[^]{0,400}openMediaTheatre\(/.test(creationJs),
    'frame candidates must offer click-to-enlarge through the media theatre',
  );
  assert(
    /candidate-enlarge[^]{0,400}event\.stopPropagation\(\)/.test(creationJs),
    'enlarging a frame candidate must not select or approve it',
  );
  assert(
    /scene-still-preview[^]{0,400}openMediaTheatre\(/.test(sceneJs),
    'the scene approved-stills strip must offer click-to-enlarge through the media theatre',
  );
  results.push('frame candidate + scene approved still: enlarge control -> openMediaTheatre');

  /* No second enlargement system: every enlarge control in the app resolves to the
   * one media theatre entry point. */
  const theatreDefinitions = (appJs.match(/window\.openMediaTheatre\s*=/g) || []).length;
  assert.strictEqual(
    theatreDefinitions,
    1,
    `there must be exactly one media theatre implementation, found ${theatreDefinitions}`,
  );

  /* ---------- 4. viewer behaviour and accessibility contract ---------- */
  const theatre = appJs.slice(appJs.indexOf('window.openMediaTheatre'), appJs.indexOf('window.closeModal'));
  assert(
    /class="cancel"[^>]*onclick="closeModal\(\)"/.test(theatre),
    'the enlarged view must close with an explicit Close control',
  );
  assert(
    /aria-label="Close the enlarged view of/.test(theatre),
    'the Close control needs a label saying what it closes',
  );
  assert(
    /alt="Enlarged view of/.test(theatre),
    'the enlarged image needs an accessible description of what is being enlarged',
  );

  const review = fs.readFileSync(path.join(ROOT, 'public', 'review.js'), 'utf8');
  assert(
    /if \(e\.key === "Escape"\) closeModal\(\);/.test(review),
    'Escape must close the enlarged view',
  );

  const openModal = appJs.slice(appJs.indexOf('function openModal'), appJs.indexOf('window.openMediaTheatre'));
  assert(
    /MODAL_RETURN_FOCUS\s*=/.test(openModal),
    'the viewer must record the element to hand focus back to',
  );
  assert(
    /window\.event\?\.currentTarget/.test(openModal),
    'a pointer click does not always leave the thumbnail focused, so the trigger must be recovered from the dispatching event — otherwise focus is dropped on the body when the viewer closes',
  );
  assert(
    /target\?\.focus\?\.\(\)/.test(openModal) || /modalFocusable/.test(openModal),
    'keyboard focus must move into the viewer when it opens',
  );
  const closeModal = appJs.slice(appJs.indexOf('window.closeModal'), appJs.indexOf('function confirmModal'));
  assert(
    /returnFocus\?\.focus\?\.\(/.test(closeModal),
    'focus must return to the triggering thumbnail when the viewer closes',
  );
  results.push('viewer: explicit Close + Escape, focus moves in and returns, labelled');

  /* ---------- 5. inspection must not be hover-only ---------- */
  const enlargeHint = declaration('.guided-thumb-preview>span', 'opacity');
  assert(
    enlargeHint !== null && parseFloat(enlargeHint) > 0,
    `the "View larger" affordance must be visible without a pointer hovering it, got opacity ${enlargeHint}`,
  );
  results.push(`enlarge affordance visible at rest (opacity ${enlargeHint})`);

  /* ---------- 6. the repaired Shot workspace column model is untouched ---------- */
  /* PR #4 made the preview track absorb a narrowing window and gave the approve-and-
   * review column a floor, so the APPROVE control can no longer be clipped at 1280px.
   * Nothing in this repair may take that back. */
  const frameBody = declaration('body[data-focused-workspace="1"] .guided-frame-body', 'grid-template-columns');
  const tracks = String(frameBody || '').match(/minmax\([^)]*\)/g) || [];
  assert.strictEqual(tracks.length, 2, `the frame-review body must keep its two-track model, got "${frameBody}"`);
  const floorOf = (track) => parseFloat(String(track).replace(/^minmax\(\s*/, '')) || 0;
  const previewFloor = floorOf(tracks[0]);
  const workFloor = floorOf(tracks[1]);
  assert.strictEqual(
    previewFloor,
    0,
    `the preview track must still yield first (floor 0), got ${previewFloor}px in "${frameBody}"`,
  );
  assert(
    workFloor >= 320,
    `the approve-and-review column must keep its floor (>=320px), got ${workFloor}px in "${frameBody}"`,
  );
  results.push(`Shot workspace preserved: preview floor ${previewFloor}px, work column floor ${workFloor}px`);

  console.log('image-review-scale: OK');
  for (const line of results) console.log('  ' + line);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

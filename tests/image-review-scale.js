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
const vm = require('vm');
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
/* Is this width one that keeps a judgement image big enough to judge?
 *
 * Two ways to be. A length this suite can resolve to pixels is compared against the
 * tier minimum, as it always was. A FULL-BLEED `100%` is accepted on its own terms,
 * because it is a scale guarantee rather than a missing one: a well that fills its
 * column cannot render narrower than the fixed well it replaced, in a column already
 * far wider than the minimum. That is what the accepted Production lead hero
 * declares — `.production-work .production-inbox-list>:first-child
 * .production-inbox-item>div` — and the reader above finds it because it is the last
 * and most specific rule ending in the base selector, not because it replaced it.
 *
 * ONLY at 100%. Any smaller percentage is a fraction of a container this suite cannot
 * measure, so it is not a guarantee and does not qualify; neither does a missing,
 * intrinsic or otherwise unresolvable width. The table in the negative control below
 * runs through this same function, so widening it once cannot quietly widen it twice. */
function widthVerdict(declared, minimum) {
  if (/^100%$/.test(resolveVarFallback(declared))) return { ok: true, note: 'full-bleed (100%)' };
  const resolved = resolveLength(declared);
  if (resolved === null) return { ok: false, note: `declares no resolvable width, got "${declared}"` };
  if (resolved < minimum) return { ok: false, note: `renders ${resolved}px wide (${declared}), below the ${minimum}px an image the user is asked to judge needs` };
  return { ok: true, note: `${resolved}px wide` };
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

/* EV2-7 B2.3 RETIRED THE BOARD'S CARD-SIZE CONTROL. This suite used to hold the three
 * density tracks in styles.css (`.shot-row.bounded-shot-page.size-compact`, `-comfortable`,
 * `-large`) to their floors, but the board renders no size class any more, so those rules
 * size no card a filmmaker sees and a floor asserted on them would pass on dead CSS. The
 * live board has ONE card size per width, declared as container steps in the Shot Board
 * section of public/experience-coherence.css: from each step's threshold, column count and
 * gap follows the NARROWEST card that step can lay out, and that card must still reach the
 * selection tier. The rendered widths are measured at 390, 1280, 1440 and 1920 by
 * tests/v6642-board-density-real-browser.py. */
const coherenceCss = fs.readFileSync(path.join(ROOT, 'public', 'experience-coherence.css'), 'utf8');
function boardColumnSteps(source) {
  const base = source.match(/#main \.shot-board \.log-strip \.shot-row\.bounded-shot-page \{([^}]*)\}/);
  const gap = base && base[1].match(/(?:^|;)\s*gap\s*:\s*([0-9.]+)px/);
  const steps = [...source.matchAll(/@container shot-board \(min-width:\s*([0-9.]+)px\)\s*\{([\s\S]*?)\n\}/g)].map((match) => {
    const columns = match[2].match(/\.shot-row\.bounded-shot-page \{[^}]*grid-template-columns:\s*repeat\((\d+),\s*minmax\(0,\s*1fr\)\)/);
    const frame = match[2].match(/\.shot-board-frame \{[^}]*max-width:\s*([0-9.]+)px/);
    return { threshold: parseFloat(match[1]), columns: columns ? Number(columns[1]) : null, frame: frame ? parseFloat(frame[1]) : null };
  });
  return { gap: gap ? parseFloat(gap[1]) : null, steps };
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
    const verdict = widthVerdict(declaration(surface.widthFrom, 'width'), OVERVIEW_MIN_WIDTH);
    assert(verdict.ok, `${surface.name}: ${surface.widthFrom} ${verdict.note}`);
    results.push(`${surface.name}: ${verdict.note}`);
  }

  /* Negative control for the rule directly above. Accepting one new shape of width is
     how a size rule stops being one, so every value below goes through the SAME
     widthVerdict() the assertion uses — the table cannot drift away from the rule it
     guards. Full bleed passes; malformed, intrinsic, undersized and absent all fail. */
  const WIDTH_CONTROL = [
    ['100%',               true,  'the accepted full-bleed lead hero'],
    ['128px',              true,  'a fixed well above the tier minimum'],
    ['var(--img-overview-w)', true, 'the shipped custom property'],
    ['99%',                false, 'a percentage that is not full bleed'],
    ['100 %',              false, 'a malformed percentage'],
    ['100',                false, 'a bare number is not a length'],
    ['calc(100% - 12px)',  false, 'a percentage expression this suite cannot resolve'],
    ['auto',               false, 'auto declares nothing about scale'],
    ['fit-content',        false, 'an intrinsic keyword, measurable only in a browser'],
    ['48px',               false, 'a fixed well below the tier minimum'],
    ['',                   false, 'an empty declaration'],
    [null,                 false, 'no width declaration found at all'],
  ];
  for (const [value, expected, why] of WIDTH_CONTROL) {
    assert.strictEqual(
      widthVerdict(value, OVERVIEW_MIN_WIDTH).ok,
      expected,
      `width control: ${JSON.stringify(value)} (${why}) must ${expected ? 'pass' : 'fail'} and did not`,
    );
  }
  results.push(`width rule negative control: ${WIDTH_CONTROL.length} values — full bleed accepted, malformed/intrinsic/undersized/absent rejected`);

  const boardSteps = boardColumnSteps(coherenceCss);
  assert(boardSteps.gap !== null, 'the Shot Board row must declare a literal px gap, so its narrowest card is knowable');
  assert.deepStrictEqual(
    boardSteps.steps.map((step) => step.columns),
    [2, 3, 4],
    'the Shot Board must widen from one card to two, three and four columns as the board gains room',
  );
  for (const step of boardSteps.steps) {
    assert(step.frame !== null, `board step at ${step.threshold}px must bound the board to its cards, so no card stretches past its width`);
    const narrowest = (step.threshold - (step.columns - 1) * boardSteps.gap) / step.columns;
    const widest = (step.frame - (step.columns - 1) * boardSteps.gap) / step.columns;
    assert(
      narrowest >= SELECTION_MIN_WIDTH,
      `board step at ${step.threshold}px: ${step.columns} cards must stay usable for recognizing a frame (>=${SELECTION_MIN_WIDTH}px), narrowest is ${narrowest.toFixed(1)}px`,
    );
    assert(narrowest <= widest, `board step at ${step.threshold}px: its narrowest card (${narrowest}px) cannot exceed its widest (${widest}px)`);
    results.push(`board ${step.columns} columns from ${step.threshold}px: cards ${Math.floor(narrowest)}-${Math.round(widest)}px -> thumbnail ${Math.round(narrowest / SOURCE_RATIO)}-${Math.round(widest / SOURCE_RATIO)}px tall at 16:9`);
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
    /* O5 CHANGED WHAT THESE THREE CONTROLS OPEN, and this assertion changed with it
     * rather than being dropped.
     *
     * All three sit on PRODUCTION MEDIA — the shot board's approved pick, a candidate
     * waiting for a decision, an entity's approved reference. The question a filmmaker
     * has there is "what is this and is it approved", not "make it bigger", so they
     * now open the Universal Media Inspector, which offers the larger view as one of
     * its own actions.
     *
     * The property this check exists for is UNCHANGED and is still proven: there is
     * ONE inspection path and ONE viewer. `inspectMediaFile` is the single bounded
     * hand-off (asserted here), and it resolves to the single shipped theatre
     * (asserted below, against public/media-inspector.js). What is forbidden is a
     * surface opening a viewer of its own, and that is still forbidden. */
    assert(
      control.includes('inspectMediaFile('),
      `${name}: inspection must go through the one bounded hand-off, not a viewer of its own`,
    );
    assert(
      !control.includes('openMediaTheatre('),
      `${name}: a production-media surface must not bypass the Inspector by opening the theatre directly`,
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
    results.push(`${name}: inspect control -> inspectMediaFile, labelled, non-navigating`);
  }

  /* THE HAND-OFF STILL RESOLVES TO THE ONE VIEWER. This is the half of "one viewer"
   * that moved when O5 put the Inspector in front of it: inspectMediaFile must fall
   * back to the shipped theatre for media the projection does not hold, and the
   * Inspector's own full-preview action must call the same entry point. A second
   * viewer introduced anywhere in that path fails here. */
  const inspectorJs = fs.readFileSync(path.join(ROOT, 'public', 'media-inspector.js'), 'utf8');
  assert(
    /function inspectFile\([^]{0,1600}window\.openMediaTheatre\(/.test(inspectorJs),
    'inspectMediaFile must fall back to the one shipped media theatre for media with no production record',
  );
  assert(
    /open-full-preview[^]{0,600}window\.openMediaTheatre\(/.test(inspectorJs),
    "the Inspector's full-preview action must reuse the one shipped media theatre",
  );
  results.push('inspector: inspectMediaFile + full preview both resolve to openMediaTheatre');

  /* The candidate and scene-still controls are built by the creation studio and the
   * scene review module; assert their markup rather than a live render so the check
   * does not depend on a shot reaching a particular workflow state. */
  const creationJs = fs.readFileSync(path.join(ROOT, 'public', 'creation-studio.js'), 'utf8');
  const sceneJs = fs.readFileSync(path.join(ROOT, 'public', 'scene-review.js'), 'utf8');
  /* EV2-7 B2.12 RETIRED THE FRAME'S CANDIDATE TRAY, and with it the tray's own enlarge
   * control. A frame candidate is looked at and compared in Results, whose Inspector action
   * hands the exact result to the one Inspector (whose full preview is the one theatre,
   * asserted above); the Shot Desk's returned-result preview inspects through
   * inspectMediaFile. Neither path selects or approves anything. */
  const resultsJs = fs.readFileSync(path.join(ROOT, 'public', 'results-desk.js'), 'utf8');
  assert(
    !/candidate-enlarge/.test(creationJs),
    'the retired frame candidate tray must not come back with an enlarge control of its own',
  );
  assert(
    /btn\('inspector','Inspector'/.test(resultsJs) && /if\(id==='inspector'\)return CineBraidMediaInspector\.inspect\(/.test(resultsJs),
    'frame candidates must offer enlargement from Results through the one Inspector',
  );
  assert(
    /const inspect = `inspectMediaFile\(/.test(creationJs) && /class="guided-lifecycle-media image" onclick="\$\{inspect\}"/.test(creationJs),
    "the Shot Desk's returned-result preview must inspect through inspectMediaFile, not a viewer of its own",
  );
  assert(
    !/if\(id==='inspector'\)[^;]*(approve|choose|select)/i.test(resultsJs),
    'enlarging a frame candidate must not select or approve it',
  );
  assert(
    /scene-still-preview[^]{0,400}openMediaTheatre\(/.test(sceneJs),
    'the scene approved-stills strip must offer click-to-enlarge through the media theatre',
  );
  results.push('frame candidate (Results -> Inspector) + scene approved still (theatre): one viewer, nothing selected or approved');

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
    theatre.includes('class="cancel"') && theatre.includes('"closeModal()"') && theatre.includes('window.inspectMedia(decodeURIComponent('),
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
  // Execute the close transaction: focus behavior must not depend on the local
  // variable name used after resolving an opener replaced by a same-page render.
  for (const [label, connected, restoreFocus] of [
    ['connected opener', true, true],
    ['replaced opener', false, true],
    ['navigation dismissal', true, false],
  ]) {
    const calls = [];
    const opener = { isConnected: connected, focus: () => calls.push('original'), closest: () => null };
    const replacement = { focus: () => calls.push('replacement') };
    const modal = { classList: { add: value => calls.push(value) },
      removeEventListener: () => calls.push('untrap'), innerHTML: 'dialog' };
    const context = { window: { scrollTo() {} }, $: () => modal,
      MODAL_LOCK: null, AGENT_RESULT_MODAL_TIMER: null, MODAL_KEY_HANDLER: () => {},
      MODAL_RETURN_FOCUS: opener,
      MODAL_RETURN_FOCUS_RESOLVER: () => { calls.push('resolve'); return replacement; },
      MODAL_SCROLL_Y: 0, MODAL_ANCHOR_TOP: null,
      setTimeout: callback => callback(), clearTimeout() {} };
    vm.createContext(context);
    vm.runInContext(closeModal, context);
    context.window.closeModal({ restoreFocus });
    const expected = !restoreFocus ? ['hidden', 'untrap'] : connected
      ? ['hidden', 'untrap', 'original'] : ['hidden', 'untrap', 'resolve', 'replacement'];
    assert.deepStrictEqual(calls, expected, `${label}: close must resolve the correct focus destination`);
    for (const key of ['MODAL_KEY_HANDLER', 'MODAL_RETURN_FOCUS', 'MODAL_RETURN_FOCUS_RESOLVER'])
      assert.strictEqual(context[key], null, `${label}: close must clear ${key}`);
    if (!restoreFocus) assert.strictEqual(modal.innerHTML, '', 'navigation must remove the old dialog content');
  }
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

/* Responsive Shot workspace layout — regression coverage.
 *
 * The Shot workspace used to reserve fixed pixel tracks that never yielded, so a
 * narrower window took every pixel out of the column holding the work. At 1280px
 * the frame-review column collapsed to 116px, the APPROVE control overflowed it,
 * a collapsed navigator still cost a 240px track and its toggle could not be
 * clicked. These checks lock the repaired column model in place.
 *
 * CI runs headless on Windows with no browser, so the layout contract is asserted
 * against the declared CSS and the grid maths are solved from the parsed values
 * rather than from numbers copied into this file.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, buildFixture } = require('./render-harness');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

/* The default column model lives outside any @media block; narrow-width overrides
 * are asserted separately so a mobile rule can never stand in for the desktop one. */
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

/* The widths this repair is required to serve. */
const TARGET_WIDTHS = [1280, 1366, 1440, 1600, 1920];
/* Chrome measured 264px of application chrome (sidebar, #main padding) around the
 * shot shell at every one of these widths; the shell gap is 16px. */
const CHROME_AROUND_SHELL = 264;
const SHELL_GAP = 16;
const FRAME_BODY_GAP = 14;
/* Everything between .shot-main's inner edge and .guided-frame-body's content box,
 * measured in Chrome: card border/padding on the frame card and its body. */
const FRAME_BODY_INSET = 26;
/* .shot-main caps its own width so a very wide window does not stretch a line of
 * body text across the whole screen; read it rather than assuming it. */
const SHOT_MAIN_MAX = (() => {
  const declared = declaration('.guided-shot-shell .shot-main', 'max-width');
  return declared ? parseFloat(declared) : Infinity;
})();

/* --- tiny CSS reader: last declaration wins, matching cascade order for equal specificity --- */
function ruleFor(selector, source = baseCss) {
  const blocks = [];
  const needle = selector;
  let from = 0;
  while (true) {
    const at = source.indexOf(needle, from);
    if (at === -1) break;
    from = at + needle.length;
    const before = source[at - 1];
    const after = source[from];
    // The selector must stand alone, not be a prefix of a longer one.
    if (before && !/[\s,}{>+~]/.test(before)) continue;
    if (after && !/[\s,{]/.test(after)) continue;
    const open = source.indexOf('{', from);
    const close = source.indexOf('}', open);
    if (open === -1 || close === -1) continue;
    blocks.push(source.slice(open + 1, close));
  }
  return blocks;
}

function declaration(selector, property) {
  const blocks = ruleFor(selector);
  let value = null;
  for (const block of blocks) {
    const match = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i'));
    if (match) value = match[1].trim();
  }
  return value;
}

/* --- grid solver: resolve `auto | <px> | minmax(a,b) | <n>fr` against an available width --- */
function parseTrack(token) {
  const minmax = token.match(/^minmax\(\s*([^,]+)\s*,\s*(.+)\)$/i);
  if (minmax) return { min: parseLength(minmax[1]), max: parseLength(minmax[2]) };
  const length = parseLength(token);
  return { min: length, max: length };
}

function parseLength(token) {
  const value = token.trim();
  if (value.endsWith('fr')) return { fr: parseFloat(value) };
  if (value.endsWith('px')) return { px: parseFloat(value) };
  if (value === 'auto' || value === 'min-content' || value === 'max-content') return { auto: true };
  return { px: 0 };
}

function splitTracks(template) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of template) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/* Resolves track sizes the way CSS grid does for this simple case: definite
 * bases first, then free space distributed across fr tracks and clamped by max. */
function solveGrid(template, available, gap, autoWidths = []) {
  const tracks = splitTracks(template).map(parseTrack);
  const totalGap = gap * (tracks.length - 1);
  let space = available - totalGap;
  let autoIndex = 0;
  const sizes = tracks.map((t) => {
    if (t.min.auto) return { fixed: autoWidths[autoIndex++] ?? 0 };
    if (t.min.px !== undefined && t.max.px !== undefined && t.min.px === t.max.px) return { fixed: t.min.px };
    return { flexible: t };
  });
  for (const s of sizes) if (s.fixed !== undefined) space -= s.fixed;
  // Give every flexible track its floor first — this is what stops starvation.
  const flexible = sizes.filter((s) => s.flexible);
  for (const s of flexible) {
    s.value = s.flexible.min.px || 0;
    space -= s.value;
  }
  // Tracks with a definite ceiling reach it before any fr track takes free space.
  let remaining = space;
  for (const s of flexible.filter((s) => !s.flexible.max.fr)) {
    const grow = Math.max(0, Math.min(s.flexible.max.px - s.value, remaining));
    s.value += grow;
    remaining -= grow;
  }
  // Whatever is left is shared between the fr tracks by their flex factors.
  const frTracks = flexible.filter((s) => s.flexible.max.fr);
  const frTotal = frTracks.reduce((n, s) => n + s.flexible.max.fr, 0);
  if (frTotal > 0 && remaining > 0) {
    for (const s of frTracks) s.value += (remaining * s.flexible.max.fr) / frTotal;
  }
  return sizes.map((s) => Math.round((s.fixed !== undefined ? s.fixed : s.value) * 10) / 10);
}

async function main() {
  /* ---------------------------------------------------------------- 1. shell */
  const shellColumns = declaration('.focused-workspace-shell', 'grid-template-columns');
  assert(shellColumns, '.focused-workspace-shell must declare its column model');
  assert(
    !/^\s*minmax\(\s*\d+px/.test(shellColumns),
    `the shot shell must not open with a fixed navigator track (got "${shellColumns}")`,
  );
  assert(
    splitTracks(shellColumns).length === 2,
    `the shot shell must reserve two tracks by default, not a third for an inspector that may not exist (got "${shellColumns}")`,
  );
  const gatedColumns = declaration('.focused-workspace-shell:has(> .focused-inspector)', 'grid-template-columns');
  assert(gatedColumns, 'the inspector track must be gated on an inspector actually being rendered');
  assert(splitTracks(gatedColumns).length === 3, 'the gated rule is the one that adds the inspector track');

  /* A collapsed navigator must release its width rather than hold a track open. */
  const closedWidth = declaration('.focused-workspace-shell > .project-navigator.closed', 'width');
  const openWidth = declaration('.focused-workspace-shell > .project-navigator.open', 'width');
  assert.strictEqual(closedWidth, '34px', 'a closed navigator must collapse to its rail width');
  assert.strictEqual(openWidth, '270px', 'an open navigator keeps its panel width');
  assert(
    parseFloat(closedWidth) < 40,
    `a closed navigator must not reserve a full panel track (got ${closedWidth})`,
  );

  /* ------------------------------------------------------- 2. navigator toggle */
  const navOverflow = declaration('.focused-workspace-shell > .project-navigator', 'overflow');
  assert.strictEqual(navOverflow, 'visible', 'the navigator must not clip its own toggle');
  const toggleRight = declaration('.navigator-toggle', 'right');
  assert(
    !toggleRight.startsWith('-'),
    `the toggle must sit inside the panel in the open state (got right:${toggleRight})`,
  );
  const closedMinHeight = declaration('.project-navigator.closed', 'min-height');
  assert(
    closedMinHeight && parseFloat(closedMinHeight) >= 44,
    'a collapsed navigator needs a box tall enough to hold a clickable toggle',
  );
  assert(
    css.includes('body[data-focused-workspace="1"] #main{overflow-x:clip}'),
    'the horizontal-overflow guard must use clip; hidden creates a scroll container and breaks the sticky navigator',
  );

  /* ------------------------------------------------- 3. frame-review column floor */
  const frameColumns = declaration('.guided-frame-body', 'grid-template-columns');
  assert(frameColumns, '.guided-frame-body must declare its column model');
  const frameTracks = splitTracks(frameColumns.replace(/!important/i, '').trim());
  assert.strictEqual(frameTracks.length, 2, 'the frame body is a preview column beside a work column');
  const preview = parseTrack(frameTracks[0]);
  const work = parseTrack(frameTracks[1]);
  assert.strictEqual(preview.min.px, 0, 'the preview column must be the one that yields');
  assert(
    work.min.px >= 320,
    `the review column needs a floor wide enough for its controls (got ${work.min.px}px)`,
  );

  /* ------------------------------------ 4. solve the real widths, both nav states */
  const navWidths = { closed: parseFloat(closedWidth), open: parseFloat(openWidth) };
  const results = [];
  /* The preview cap widens on wide desktops so reclaimed width goes to the frame. */
  function frameColumnsAt(viewport) {
    const breakpoints = [...css.matchAll(/@media\(min-width:(\d+)px\)\{([\s\S]*?)\n\}/g)]
      .map((m) => ({ at: Number(m[1]), body: m[2] }))
      .filter((b) => b.body.includes('.guided-frame-body') && viewport >= b.at)
      .sort((a, b) => a.at - b.at);
    let value = frameColumns;
    for (const b of breakpoints) {
      const match = b.body.match(/\.guided-frame-body\{grid-template-columns:([^;}]+)/);
      if (match) value = match[1];
    }
    return value.replace(/!important/i, '').trim();
  }

  for (const viewport of TARGET_WIDTHS) {
    for (const state of ['closed', 'open']) {
      const shellAvailable = viewport - CHROME_AROUND_SHELL;
      const [navTrack, mainTrack] = solveGrid(shellColumns, shellAvailable, SHELL_GAP, [navWidths[state]]);
      /* .shot-main caps its own reading width; the frame body sizes to the cap. */
      const contentWidth = Math.min(mainTrack, SHOT_MAIN_MAX);
      const bodyAvailable = contentWidth - FRAME_BODY_INSET;
      const [previewTrack, workTrack] = solveGrid(
        frameColumnsAt(viewport),
        bodyAvailable,
        FRAME_BODY_GAP,
      );
      results.push({ viewport, state, navTrack, mainTrack, previewTrack, workTrack });

      assert.strictEqual(
        navTrack,
        navWidths[state],
        `${viewport}px / navigator ${state}: the navigator track must equal the navigator's own width`,
      );
      assert(
        workTrack >= work.min.px - 0.5,
        `${viewport}px / navigator ${state}: the review column fell to ${workTrack}px, below its ${work.min.px}px floor`,
      );
      assert(
        previewTrack + workTrack + FRAME_BODY_GAP <= bodyAvailable + 0.5,
        `${viewport}px / navigator ${state}: the frame body overflows its container`,
      );
      /* The frame is the thing being judged: its column must never be the one
       * that gets squeezed as the window narrows. */
      assert(
        previewTrack >= 260,
        `${viewport}px / navigator ${state}: the frame preview fell to ${previewTrack}px, too small to judge a composition`,
      );
      /* The APPROVE control is 140px wide in the shipped type scale; the column
       * must hold it and the surrounding controls without clipping. */
      assert(
        workTrack >= 140,
        `${viewport}px / navigator ${state}: the review column (${workTrack}px) cannot hold the 140px APPROVE control`,
      );
    }
  }

  /* The narrowest supported width must not be the worst one — the old model made
   * 1280 worse than 1062 by adding a third track exactly when space ran out. */
  const byWidth = new Map();
  for (const r of results.filter((r) => r.state === 'closed')) byWidth.set(r.viewport, r.workTrack);
  for (let i = 1; i < TARGET_WIDTHS.length; i++) {
    const narrow = byWidth.get(TARGET_WIDTHS[i - 1]);
    const wide = byWidth.get(TARGET_WIDTHS[i]);
    assert(
      wide >= narrow,
      `the review column must never shrink as the window widens (${TARGET_WIDTHS[i - 1]}px gave ${narrow}px, ${TARGET_WIDTHS[i]}px gave ${wide}px)`,
    );
  }

  /* Below the point where two side-by-side columns stop fitting, the review
   * column stacks instead of being squeezed. */
  const narrowStack = /@media\(max-width:1100px\)\{[\s\S]*?\.guided-frame-body\{grid-template-columns:minmax\(0,1fr\)!important\}/.test(
    css.replace(/\s*\n\s*/g, ''),
  );
  assert(narrowStack, 'below 1100px the frame body must stack rather than starve the review column');

  /* --------------------------------------------- 5. imagery keeps its proportions */
  const approvedPreview = ruleFor('.guided-frame-approved-preview img').join(';');
  assert(
    /object-fit\s*:\s*contain/.test(approvedPreview),
    'the approved frame must not be cropped to fit its box',
  );
  const contextImage = ruleFor('.guided-frame-context > img').join(';');
  assert(
    /object-fit\s*:\s*contain/.test(contextImage) && /aspect-ratio\s*:\s*16\s*\/\s*9/.test(contextImage),
    'the context frame must letterbox a 16:9 source rather than crop it',
  );
  const candidateImage = ruleFor('.guided-frame-candidate img').join(';');
  assert(
    /object-fit\s*:\s*contain/.test(candidateImage),
    'frame candidates are chosen by composition and must not be cropped',
  );
  const previewBox = declaration('.guided-frame-approved-preview', 'aspect-ratio');
  assert(
    previewBox && /16\s*\/\s*9/.test(previewBox),
    'the approved-frame well must be a 16:9 slot rather than a fixed pixel height',
  );

  /* -------------------------------------- 6. a disabled Approve stays legible */
  const disabledBlocks = ruleFor('.approve-btn:disabled').join(';');
  assert(disabledBlocks, 'a disabled approval control needs its own treatment');
  assert(
    /opacity\s*:\s*1\s*!important/.test(disabledBlocks),
    'the disabled approval control must not rely on a blanket opacity that renders it illegible',
  );
  assert(
    /background\s*:\s*color-mix\([^;]*var\(--acc\)/.test(disabledBlocks),
    'the disabled state must dim the accent fill alongside the label, not keep it at full strength',
  );
  assert(
    /color\s*:\s*color-mix\([^;]*var\(--ink\)/.test(disabledBlocks),
    'the disabled label must be derived from the readable ink colour',
  );

  /* --------------------------------------------------- 7. the markup still holds */
  const project = buildFixture();
  const shot = await render('#/shot/L1-01', project, {
    storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'frames' },
  });
  assert(shot.html.includes('focused-workspace-shell'), 'the shot workspace must still use the focused shell');
  assert(shot.html.includes('navigator-toggle'), 'the navigator toggle must be rendered');
  assert(
    /class="project-navigator (open|closed)"/.test(shot.html),
    'the navigator must declare an explicit open or closed state for the column model to read',
  );
  assert(
    shot.html.indexOf('navigator-toggle') < shot.html.indexOf('navigator-list') ||
      !shot.html.includes('navigator-list'),
    'the toggle must precede the scrollable list so it is never inside the scroll region',
  );

  console.log('shot-workspace-responsive-layout: OK');
  for (const r of results.filter((r) => r.state === 'closed')) {
    console.log(`  ${r.viewport}px  nav ${r.navTrack}px  main ${r.mainTrack}px  preview ${r.previewTrack}px  review ${r.workTrack}px`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

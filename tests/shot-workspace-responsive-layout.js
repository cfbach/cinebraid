/* Responsive Shot workspace layout — regression coverage.
 *
 * The Shot workspace used to reserve fixed pixel tracks that never yielded, so a
 * narrower window took every pixel out of the column holding the work. At 1280px
 * the frame-review column collapsed to 116px, the APPROVE control overflowed it,
 * a collapsed navigator still cost a 240px track and its toggle could not be
 * clicked. The single-sidebar prototype now returns that entire secondary track
 * to the work. These checks retain the field, artwork and approval-control floors.
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
const coherence = fs.readFileSync(path.join(ROOT, 'public', 'experience-coherence.css'), 'utf8').replace(/\r\n/g, '\n');

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

/* EV2-7 Checkpoint 2 (B2.16) gives the Shot workspace its own column model in the section of
 * public/experience-coherence.css it appended. That stylesheet loads after styles.css, so its
 * shot rule is the one in force. It is sliced from its own heading to the next EV2-7 section
 * heading, so rules another section appends are never read as the Shots layout. */
const SHOT_LAYOUT_HEADING = '/* EV2-7 Checkpoint 2 — Stage bar & Shot layout */';
const shotLayoutCss = (() => {
  const at = coherence.indexOf(SHOT_LAYOUT_HEADING);
  if (at < 0) return '';
  const rest = coherence.slice(at + SHOT_LAYOUT_HEADING.length);
  const next = rest.search(/\/\* EV2-7 Checkpoint \d/);
  return stripAtRules(next < 0 ? rest : rest.slice(0, next)).replace(/\/\*[\s\S]*?\*\//g, ' ');
})();
const SHOT_SHELL = '.bounded-shot-workspace.focused-workspace-shell';

/* The widths this repair is required to serve. */
const TARGET_WIDTHS = [1280, 1366, 1440, 1600, 1920];
/* Chrome measured 264px of application chrome (sidebar, #main padding) around the
 * shot shell at every one of these widths; the shell gap is 16px. */
const CHROME_AROUND_SHELL = 264;
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

function declaration(selector, property, source = baseCss) {
  const blocks = ruleFor(selector, source);
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
  /* EV2-7 B2.16 — THE SHOT WORKSPACE HAS NO INSPECTOR TRACK. The Shot Inspector aside is
     removed (tests/focused-workspaces.js drives enhance() and requires nothing appended), so
     the `:has(> .focused-inspector)` rule in styles.css no longer applies to any shot and is
     not asserted here: a check against a rule the shot route never reaches would keep
     passing on dead CSS. What is asserted is the Shots column model in force. */
  assert(shotLayoutCss, `public/experience-coherence.css must carry the "${SHOT_LAYOUT_HEADING}" section`);
  const shotColumns = declaration(SHOT_SHELL, 'grid-template-columns', shotLayoutCss);
  assert(shotColumns, `the Shots section must declare the shot shell's column model (${SHOT_SHELL})`);
  const shotTracks = splitTracks(shotColumns);
  assert.strictEqual(shotTracks.length, 1,
    `the Shot workspace has only its work track; contextual navigation belongs in the sidebar (got "${shotColumns}")`);
  const shotWork = parseTrack(shotTracks[0]);
  assert(shotWork.min.px === 0 && shotWork.max.px > 0 && shotWork.max.fr === undefined,
    `the work track must yield and be bounded, so a wide window does not inflate every card (got "${shotTracks[0]}")`);
  /* Reclaimed room belongs to the work up to its existing reading-width cap. */
  assert.strictEqual(declaration(SHOT_SHELL, 'justify-content', shotLayoutCss), 'start',
    'the bounded Shot shell leaves spare desktop width after the work');
  /* Scoped to Shots: no !important and no rule reaching the generic focused shell, the
     References shell or any inspector. */
  /* EV2-7 dogfood correction: this section also carries the stage strip's own treatment, and the
     strip's neutral chrome has to answer `!important` declarations two stylesheets down
     (styles.css paints .focused-task-button's border, background and padding that way). That is
     allowed — inside #cb-stage-mount, which reaches nothing but the bar. Anything else in this
     section that shouts is the defect this check was written for. */
  const shouting = shotLayoutCss.split('}')
    .filter((chunk) => chunk.includes('!important'))
    .map((chunk) => chunk.slice(0, chunk.lastIndexOf('{')).split(/[{;]/).pop().trim().replace(/\s+/g, ' '));
  for (const selector of shouting)
    assert(selector.startsWith('#cb-stage-mount'),
      `the Shots layout must not override the focused shells with !important: ${selector}`);
  for (const [pattern, what] of [
    [/(^|[\s,}>])\.focused-workspace-shell\s*[{,:]/, 'every focused workspace shell'],
    [/\.focused-entity-shell/, 'the References shell'],
    [/\.focused-inspector/, 'an inspector'],
  ]) assert(!pattern.test(shotLayoutCss), `the Shots layout section must not restyle ${what}`);
  /* And the References layout keeps its own three tracks, inspector included. */
  const entityColumns = declaration('.focused-entity-shell', 'grid-template-columns');
  assert(entityColumns && splitTracks(entityColumns).length === 3,
    `the References shell keeps navigator | main | inspector (got "${entityColumns}")`);

  assert.strictEqual(shotColumns, 'minmax(0,1360px)',
    'the work always receives the former secondary rail track, within its existing desktop cap');
  assert(!coherence.includes('.shot-navigator-toggle') && !coherence.includes('.shot-navigator-close'),
    'no breadcrumb opener or secondary-rail close control remains in the prototype');
  assert(css.includes('#app{--cb-nav-width:220px;'),
    'the canonical desktop sidebar keeps its established width');
  assert(/#rail\s*\{[^}]*width:240px;[^}]*height:100dvh/.test(coherence),
    'narrow layouts reuse the existing 240px sidebar drawer');
  assert(
    css.includes('body[data-focused-workspace="1"] #main{overflow-x:clip}'),
    'the horizontal-overflow guard must use clip; hidden would change document scroll and sticky behavior',
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

  /* ------------------------------------ 4. solve reclaimed desktop work widths */
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
    const shellAvailable = viewport - CHROME_AROUND_SHELL;
    const [mainTrack] = solveGrid(shotColumns, shellAvailable, 0);
    assert(
      mainTrack <= shotWork.max.px + 0.5,
      `${viewport}px: the work track grew to ${mainTrack}px, past its ${shotWork.max.px}px bound`,
    );
    assert(
      Math.abs(mainTrack - Math.min(shellAvailable, shotWork.max.px)) <= 0.5,
      `${viewport}px: work must receive all available width up to the existing cap (${mainTrack}px)`,
    );
    const oldOpenWork = Math.min(Math.max(0, shellAvailable - 270 - 16), shotWork.max.px);
    assert(mainTrack >= oldOpenWork,
      `${viewport}px: removing the secondary rail must never reduce production workspace`);
    /* .shot-main caps its own reading width; the frame body sizes to the cap. */
    const contentWidth = Math.min(mainTrack, SHOT_MAIN_MAX);
    const bodyAvailable = contentWidth - FRAME_BODY_INSET;
    const [previewTrack, workTrack] = solveGrid(
      frameColumnsAt(viewport), bodyAvailable, FRAME_BODY_GAP,
    );
    results.push({ viewport, mainTrack, previewTrack, workTrack });
    assert(
      workTrack >= work.min.px - 0.5,
      `${viewport}px: the review column fell to ${workTrack}px, below its ${work.min.px}px floor`,
    );
    assert(
      previewTrack + workTrack + FRAME_BODY_GAP <= bodyAvailable + 0.5,
      `${viewport}px: the frame body overflows its container`,
    );
    /* Artwork remains large enough to judge a composition. */
    assert(previewTrack >= 260,
      `${viewport}px: the frame preview fell to ${previewTrack}px, too small to judge a composition`);
    /* The shipped APPROVE control must fit with the surrounding controls. */
    assert(workTrack >= 140,
      `${viewport}px: the review column (${workTrack}px) cannot hold the 140px APPROVE control`);
  }

  /* With no secondary rail, the work reaches its
   * 1360px cap before 1920. At that breakpoint the preview deliberately grows
   * from 360 to 430px; its gain may come from the review column, but the total
   * artwork-and-review area cannot shrink and the review floor still holds. */
  const byWidth = new Map();
  for (const r of results) byWidth.set(r.viewport, r);
  for (let i = 1; i < TARGET_WIDTHS.length; i++) {
    const narrow = byWidth.get(TARGET_WIDTHS[i - 1]);
    const wide = byWidth.get(TARGET_WIDTHS[i]);
    assert(wide.previewTrack + wide.workTrack >= narrow.previewTrack + narrow.workTrack,
      'the frame workspace must not lose total inspection width as the window widens');
    assert(wide.workTrack >= narrow.workTrack - Math.max(0, wide.previewTrack - narrow.previewTrack),
      'review may yield only the width deliberately granted to the artwork');
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
  for (const legacyPreference of ['0', '1']) {
    const shot = await render('#/shot/L1-01', project, {
      storage: { 'cinebraid-focused:fixture:shot-task:L1-01': 'frames', 'cinebraid-project-nav-open-v662': legacyPreference },
    });
    assert(shot.html.includes('focused-workspace-shell'), 'the shot workspace retains its focused shell');
    assert(!/project-nav-list|project-navigator|shot-navigator-(?:toggle|close)/.test(shot.html),
      `legacy navigator preference ${legacyPreference} must not restore a secondary rail or control`);
    assert(!shot.html.includes('class="context-shot'),
      'contextual shot links belong in the canonical sidebar, not the work markup');
    const navigation = shot.context.sidebarShotsMarkup('shot', 'L1-01');
    const links = [...navigation.matchAll(/<a class="context-shot[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
    assert.strictEqual(links.length, project.shots.length, 'every fixture shot is directly reachable in the sidebar');
    assert.strictEqual(links.filter(link => link.includes('aria-current="page"')).length, 1,
      'the sidebar identifies exactly one current shot');
    assert(links.find(link => link.includes('href="#/shot/L1-01"'))?.includes('aria-current="page"'),
      'current-shot identity follows the exact open route');
    for (const scene of project.scenes) assert(navigation.includes(`data-context-scene="${scene.id}"`),
      `scene grouping preserves ${scene.id}`);
    assert(navigation.includes('id="sidebar-shot-filter"'), 'direct shot navigation retains filtering');
    assert(links.every(link => link.includes('nav-status wf-') && link.includes('class="sr-only"')),
      'workflow status has both a visible indicator and readable text');
  }

  console.log('shot-workspace-responsive-layout: OK');
  for (const r of results) {
    console.log(`  ${r.viewport}px  main ${r.mainTrack}px  preview ${r.previewTrack}px  review ${r.workTrack}px`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

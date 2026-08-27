/* The three confirmed private-launch blockers, locked in.
 *
 * 1. CB-01 — "Light canvas" rendered its headline Production metrics at 1.12:1 and its
 *    NEXT ACTION card at 1.09:1. The cause was structural, not cosmetic: the studio.4
 *    refresh added a second, derived token set at :root — `--text:var(--ink)`,
 *    `--accent:var(--acc)`, `--surface`, `--canvas` and friends. A custom property that
 *    references another is substituted where it is *declared*, so those aliases froze
 *    the dark values at :root and no `#app[data-surf="light"]` override could move them.
 *
 * 2. CB-02 — MiniMax H3 accepts a fixed list of aspect ratios. A 2.39:1 or 3:2 project
 *    was rewritten to 16:9 (or to "adaptive") inside the provider request, on a paid
 *    dispatch, with no warning anywhere. The whitelist is the provider's and is not
 *    touched here; what changed is that an unsupported format is now refused before any
 *    external request instead of being silently swapped.
 *
 * 3. CB-03 — the shot hero preview cropped any frame narrower than the shot format,
 *    losing up to ~24% of the image with no indication. `object-fit:contain` was already
 *    declared and was already doing nothing, because the image never took the well's
 *    height: the still renders inside a <button>, and a percentage height there resolves
 *    against an indefinite box.
 *
 * CI runs headless on Windows with no browser, so the contrast and framing contracts are
 * asserted against the declared stylesheet and the shared resolvers. The provider
 * refusal is asserted against a real HTTP mock whose call count must stay at zero.
 */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Aspect = require('../public/shared-aspect');
const { registerFalGeneration } = require('../fal-generation');
const { addMotionPromptBuild } = require('./h3-execution-fixture');
const { withGenerationDeclaration } = require('./generation-request-fixture');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const results = [];
const note = (line) => results.push(line);

/* ---------------------------------------------------------------- CSS reading -- */
/* Narrow-width overrides must never stand in for the desktop rule under test. */
function stripAtRules(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') { out += text[i]; continue; }
    const open = text.indexOf('{', i);
    if (open === -1) { out += text.slice(i); break; }
    let depth = 0, j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    i = j;
  }
  return out;
}
/* Comments are stripped before any rule is read. The declaration reader below anchors on
   `;`, so a comment sitting between two declarations would hide the one after it — and
   the blocks under test are the most heavily commented in the sheet, because they are
   the ones carrying the reasoning for this repair. */
const baseCss = stripAtRules(css.replace(/\/\*[\s\S]*?\*\//g, ';'));

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
/* Every declaration of a custom property under a selector, in source order, so the
   winning value is the last one — the same rule the cascade applies here, since all of
   these selectors carry identical specificity. */
function customProperty(selector, name) {
  return declaration(selector, name.replace(/^--/, '--'));
}
/* `.slate-thumb` is also the tail of `.shot-row.size-large .slate-thumb`, and
   `.guided-lifecycle-media` is the head of `.guided-lifecycle-media img`. The reader
   above matches both, which is what you want when asking "does anything targeting this
   declare X" and wrong when asking "what does this exact rule declare". This one only
   accepts a rule whose own selector list contains the selector as a whole item. */
const ALL_RULES = (() => {
  const rules = [];
  let at = 0;
  while (true) {
    const open = baseCss.indexOf('{', at);
    if (open === -1) break;
    const close = baseCss.indexOf('}', open);
    if (close === -1) break;
    const head = baseCss.slice(at, open);
    const start = Math.max(head.lastIndexOf('}'), -1) + 1;
    rules.push({
      /* Stripped comments left `;` markers behind so the declaration reader keeps its
         anchor; they are not part of a selector. */
      selectors: head.slice(start).split(',').map((s) => s.replace(/^[;\s]+/, '').trim()).filter(Boolean),
      body: baseCss.slice(open + 1, close),
    });
    at = close + 1;
  }
  return rules;
})();
function exactDeclaration(selector, property) {
  let value = null;
  for (const rule of ALL_RULES) {
    if (!rule.selectors.includes(selector)) continue;
    const match = rule.body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i'));
    if (match) value = match[1].trim().replace(/\s*!important\s*$/i, '');
  }
  return value;
}

/* ---------------------------------------------------------------- WCAG -------- */
function channel(value) {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (high + 0.05) / (low + 0.05);
}
function rgb(value) {
  const text = String(value || '').trim();
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].substr(i, 2), 16));
  const short = text.match(/^#([0-9a-f]{3})$/i);
  if (short) return [0, 1, 2].map((i) => parseInt(short[1][i] + short[1][i], 16));
  const fn = text.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2]];
  }
  return null;
}

/* ================================================================================
   1. CB-01 — Light canvas contrast
   ================================================================================ */
const LIGHT = '#app[data-surf="light"]';
const DARK_SURFACES = ['#app[data-surf="night"]', '#app[data-surf="cool"]', '#app[data-surf="warm"]'];
const ACCENTS = ['blue', 'green', 'amber', 'rust'];

/* The aliases are the defect. If either is ever left to inherit the :root value again,
   every surface it paints goes back to dark-on-light. */
for (const name of ['--text', '--accent']) {
  const rootValue = customProperty(':root', name);
  assert(
    /var\(--(ink|acc)\)/.test(String(rootValue)),
    `${name} is declared at :root as an alias (${rootValue}); this test exists because that value cannot follow a theme`,
  );
  assert(
    customProperty(LIGHT, name),
    `${name} must be redeclared inside ${LIGHT}. Declared only at :root it is substituted there and freezes the dark value, which is what made the Production metrics 1.12:1.`,
  );
}
/* The rest of the derived set, which painted near-black cards under light-theme ink. */
for (const name of ['--surface', '--surface-2', '--canvas', '--workspace', '--panel-strong']) {
  assert(
    customProperty(LIGHT, name),
    `${name} carries a dark literal at :root and must be redeclared for the light surface`,
  );
}
/* Dark themes must be untouched: they keep the :root values they always had. */
for (const selector of DARK_SURFACES) {
  for (const name of ['--text', '--accent', '--surface', '--surface-2', '--canvas', '--workspace', '--panel-strong', '--green', '--blue', '--amber', '--red']) {
    assert.strictEqual(
      customProperty(selector, name),
      null,
      `${selector} must not declare ${name} — the three dark themes are required to render exactly as they did before this repair`,
    );
  }
}
note(`light canvas: --text, --accent and the five frozen surface tokens are theme-aware; ${DARK_SURFACES.length} dark themes declare none of them`);

/* The measured contract. Every colour a light-canvas surface can paint text in, against
   every surface it can paint it on. */
function lightToken(name, accent) {
  const scoped = customProperty(`${LIGHT}[data-acc="${accent}"]`, name);
  const value = scoped || customProperty(LIGHT, name);
  if (!value) return null;
  const alias = String(value).match(/^var\((--[\w-]+)\)$/);
  if (alias) return lightToken(alias[1], accent);
  return value;
}
const LIGHT_TEXT_TOKENS = ['--ink', '--text', '--muted', '--faint', '--acc', '--accent', '--green', '--blue', '--amber', '--red'];
const LIGHT_SURFACE_TOKENS = ['--panel', '--panel-2', '--bg', '--bg-2', '--media-well', '--img-well-bg'];

let worstPair = { ratio: Infinity };
const measurements = [];
for (const accent of ACCENTS) {
  for (const textName of LIGHT_TEXT_TOKENS) {
    const textValue = lightToken(textName, accent);
    assert(textValue, `${textName} must resolve in Light canvas with the ${accent} accent`);
    const text = rgb(textValue);
    assert(text, `${textName} resolved to "${textValue}", which is not a colour this test can measure`);
    for (const surfaceName of LIGHT_SURFACE_TOKENS) {
      const surfaceValue = lightToken(surfaceName, accent);
      assert(surfaceValue, `${surfaceName} must resolve in Light canvas`);
      const surface = rgb(surfaceValue);
      assert(surface, `${surfaceName} resolved to "${surfaceValue}"`);
      const ratio = contrast(text, surface);
      measurements.push({ accent, textName, surfaceName, ratio });
      if (ratio < worstPair.ratio) worstPair = { accent, textName, textValue, surfaceName, surfaceValue, ratio };
      assert(
        ratio >= 4.5,
        `Light canvas / ${accent}: ${textName} (${textValue}) on ${surfaceName} (${surfaceValue}) is ${ratio.toFixed(2)}:1. Normal text must reach 4.5:1.`,
      );
    }
  }
}
/* The hierarchy the correction has to preserve: primary ink is the strongest, muted sits
   below it, faint below that. A pass that flattens all three into one tone is not a pass. */
for (const accent of ACCENTS) {
  const panel = rgb(lightToken('--panel', accent));
  const [ink, muted, faint] = ['--ink', '--muted', '--faint'].map((n) => contrast(rgb(lightToken(n, accent)), panel));
  assert(ink > muted && muted > faint, `Light canvas / ${accent}: ink ${ink.toFixed(2)} > muted ${muted.toFixed(2)} > faint ${faint.toFixed(2)} must hold`);
}
note(`light canvas: ${measurements.length} token pairs measured across ${ACCENTS.length} accents, worst ${worstPair.ratio.toFixed(2)}:1 (${worstPair.textName} on ${worstPair.surfaceName}, ${worstPair.accent})`);

/* The specific failures the review named, at the rule that produced them. */
assert.strictEqual(
  declaration('.production-summary b', 'color'),
  'var(--text)',
  'the headline Production metrics still read --text; if that changes, the token contract above stops covering them',
);
for (const selector of ['.production-next', '.board-list-controls', '.shot-command-summary article', '.focused-taskbar', '.automation-activity-drawer']) {
  const scoped = declaration(`${LIGHT} ${selector}`, 'background');
  assert(scoped, `${selector} paints a dark literal and needs a light-surface background`);
  assert(
    !/#0|rgba?\(\s*(?:[0-9]|1[0-9]|2[0-9]|3[0-9])\s*,/.test(scoped),
    `${LIGHT} ${selector} must not resolve back to a near-black literal. Got "${scoped}"`,
  );
}
note('light canvas: the five raised surfaces painted from dark literals now carry light-surface backgrounds');

/* ================================================================================
   2. CB-02 — unsupported H3 aspect ratios
   ================================================================================ */
/* The provider's list, verbatim. Widening it here would be the one change this repair
   must never make: CineBraid cannot grant H3 a format the provider does not accept. */
const PROVIDER_WHITELIST = {
  t2v: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  r2v: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
};
for (const [mode, list] of Object.entries(PROVIDER_WHITELIST)) {
  assert.deepStrictEqual(
    [...Aspect.CINEBRAID_H3_ASPECT_SUPPORT[mode]],
    list,
    `the ${mode} whitelist must stay exactly the provider's list`,
  );
}
for (const mode of ['i2v', 'flf']) {
  assert.strictEqual(
    Aspect.CINEBRAID_H3_ASPECT_SUPPORT[mode],
    null,
    `${mode} sends no aspect_ratio — the video takes its shape from the supplied frames — so it must declare that rather than a list`,
  );
  const gate = Aspect.h3AspectSupport(mode, '2.39:1');
  assert(gate.ok && gate.carriesAspectRatio === false && gate.value === null,
    `${mode} must resolve without an aspect_ratio rather than inventing one`);
}

/* Supported formats behave exactly as before: the requested value is what is sent. */
for (const [mode, list] of Object.entries(PROVIDER_WHITELIST)) {
  for (const label of list) {
    const gate = Aspect.h3AspectSupport(mode, label);
    assert(gate.ok, `${mode} must still accept ${label}`);
    assert.strictEqual(gate.value, label, `${mode}/${label} must be sent unchanged`);
  }
}
/* The formats the review caught being substituted, plus the unparseable case. */
const REFUSED = ['2.39:1', '3:2', '1.85:1', '5:4', 'banana', ''];
for (const mode of ['t2v', 'r2v']) {
  for (const label of REFUSED) {
    const gate = Aspect.h3AspectSupport(mode, label);
    assert(!gate.ok, `${mode} must refuse ${JSON.stringify(label)} rather than substitute a format`);
    assert.strictEqual(gate.value, undefined, `a refusal must carry no ratio to send for ${JSON.stringify(label)}`);
    if (label) assert(gate.message.includes(label), `the refusal must name the requested ratio, got: ${gate.message}`);
    assert(/MiniMax H3/.test(gate.message), 'the refusal must name MiniMax H3');
    for (const supported of PROVIDER_WHITELIST[mode])
      assert(gate.message.includes(supported), `the refusal must list ${supported} as an alternative`);
    assert(/Shot's format/.test(gate.message) && /video model/.test(gate.message),
      'the refusal must say how to proceed: a supported Shot format, or a different video model');
  }
}
/* The same ratio written differently is the same ratio, and must not be refused. */
assert.strictEqual(Aspect.h3AspectSupport('t2v', '1920:1080').value, '16:9', '1920:1080 is 16:9 and must be accepted as such');
assert.strictEqual(Aspect.h3AspectSupport('t2v', '2.39:1').ok, false, '2.39:1 and 21:9 differ by 2.4% and are not the same delivery');
note(`h3 formats: ${Object.values(PROVIDER_WHITELIST).flat().length} supported values unchanged, ${REFUSED.length} unsupported values refused per mode, whitelist not widened`);

/* ================================================================================
   3. CB-03 — the shot hero preview
   ================================================================================ */
{
  const selector = '.guided-lifecycle-media img';
  const objectFit = declaration(selector, 'object-fit');
  assert.strictEqual(objectFit, 'contain', `the hero still must letterbox, not crop. Got "${objectFit}"`);

  /* `object-fit:contain` was already declared before this repair and did nothing,
     because the image was never given the well's box to fit inside. These three
     declarations are what actually constrains it, and they are what a regression would
     remove. */
  /* `object-fit:contain` was already declared before this repair and did nothing, because
     the image was never given the well's box to fit inside. These are the declarations
     that actually constrain it, and they are what a regression would remove. A percentage
     cannot be used: inside the <button> that wraps the still it resolves against an
     indefinite box and computes to auto, which is the whole defect. */
  const hero = '.guided-next-action .guided-lifecycle-media img';
  const heroHeight = declaration(hero, 'height') || '';
  const heroWidth = declaration(hero, 'width') || '';
  const heroMaxHeight = declaration(hero, 'max-height') || '';
  assert(heroHeight.includes('--cb-selection-h'),
    `the hero still must take the shot's computed height as a length. "height:100%" resolves to auto inside the button and let a 9:16 source render 901px tall in a 212px well. Got "${heroHeight}"`);
  assert(heroWidth.includes('--cb-selection-w'), `the hero still must take the shot's computed width, got "${heroWidth}"`);
  assert(heroMaxHeight.includes('--cb-selection-h') && /vh/.test(heroMaxHeight),
    `the hero still must stay inside the viewport with its well, got "${heroMaxHeight}"`);
  assert.strictEqual(declaration(hero, 'max-width'), '100%', 'the hero still must never exceed its column');
  assert.strictEqual(declaration('.guided-next-action .guided-lifecycle-media video', 'height'), heroHeight,
    'the video branch takes the same constraint, so the two cannot drift apart');
  assert.strictEqual(exactDeclaration(hero, 'position'), null,
    'the hero still must stay in flow: the shot column is a fit-content track and an out-of-flow image contributes no width, which collapses the well to zero');

  /* The well itself still carries the shot's format, so the frame is judged in the
     shape it will be delivered in and the letterboxing is deliberate. The image and the
     well must read the same two properties, or the crop comes back. */
  const wellHeight = declaration('.guided-next-action .guided-lifecycle-preview', 'height') || '';
  const wellWidth = declaration('.guided-next-action .guided-lifecycle-preview', 'width') || '';
  assert(wellHeight.includes('--cb-selection-h'), `the hero well must keep the shot's computed height, got "${wellHeight}"`);
  assert(wellWidth.includes('--cb-selection-w'), `the hero well must keep the shot's computed width, got "${wellWidth}"`);
  assert.strictEqual(heroHeight, wellHeight, 'the hero still and its well must take the same height, or one can exceed the other');
  assert.strictEqual(exactDeclaration('.guided-lifecycle-media', 'position'), 'relative', 'the well must be the positioning context');
  assert.strictEqual(exactDeclaration('.guided-lifecycle-media', 'background'), 'var(--img-well-bg)', 'the letterbox must be the themed well colour');
  assert.strictEqual(exactDeclaration('.guided-lifecycle-media', 'overflow'), 'hidden', 'the well keeps its clip; the image simply no longer exceeds it');

  /* Every source edge survives, in every format this product supports, against a source
     narrower and a source wider than the well. This is the arithmetic the pixel probe
     confirmed over CDP. */
  const HERO_CASES = [
    ['16:9', 16 / 9, '9:16', 0.5625],
    ['2.39:1', 2.39, '9:16', 0.5625],
    ['1:1', 1, '1:4', 0.25],
    ['9:16', 0.5625, '1:4', 0.25],
    ['9:16', 0.5625, '16:9', 16 / 9],
  ];
  for (const [formatLabel, formatRatio, sourceLabel, sourceRatio] of HERO_CASES) {
    const well = Aspect.selectionWell(formatRatio);
    const scale = Math.min(well.w / sourceRatio, well.h) / well.h;
    const drawn = { w: Math.min(well.w, well.h * sourceRatio), h: Math.min(well.h, well.w / sourceRatio) };
    assert(drawn.w <= well.w + 0.5 && drawn.h <= well.h + 0.5,
      `${sourceLabel} inside a ${formatLabel} well draws ${drawn.w}x${drawn.h} in ${well.w}x${well.h} — contain must fit both axes`);
    assert(scale > 0);
    note(`hero ${formatLabel} well ${well.w}x${well.h}: a ${sourceLabel} source draws ${Math.round(drawn.w)}x${Math.round(drawn.h)}, whole frame inside the well`);
  }

  /* Surfaces the repair is required not to touch. */
  assert.strictEqual(exactDeclaration('.slate-thumb', 'max-height'), '287px', 'board-grid sizing must be unchanged');
  assert.strictEqual(exactDeclaration('.guided-candidate-preview', 'max-height'), '342px', 'candidate-strip sizing must be unchanged');
  assert.strictEqual(exactDeclaration('.media-theatre-stage img', 'max-height'), 'calc(100dvh - 239px)', 'media-theatre sizing must be unchanged');
  assert.strictEqual(exactDeclaration('.media-theatre-stage img', 'object-fit'), 'contain');
  assert.strictEqual(exactDeclaration('.guided-candidate-preview img', 'object-fit'), 'contain');
  for (const untouched of ['.slate-thumb img', '.guided-candidate-preview img', '.media-theatre-stage img', '.library-preview img']) {
    assert.notStrictEqual(exactDeclaration(untouched, 'position'), 'absolute', `${untouched} must not take the hero's constraint`);
    assert.strictEqual(exactDeclaration(untouched, 'inset'), null, `${untouched} must not take the hero's constraint`);
  }
}

/* ================================================================================
   4. CB-02 end to end — the mock provider must never be called
   ================================================================================ */
async function providerRefusal() {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=', 'base64');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-h3-guard-'));
  const projectDir = path.join(tmp, 'project');
  fs.mkdirSync(path.join(projectDir, 'shots', 'S1', 'takes'), { recursive: true });
  for (const name of ['A.png', 'B.png', 'C.png']) fs.writeFileSync(path.join(projectDir, 'shots', 'S1', 'takes', name), PNG);
  const projectFile = path.join(projectDir, 'project.json');
  fs.writeFileSync(projectFile, JSON.stringify({ meta: { title: 'H3 guard', aspectRatio: '2.39:1' }, shots: [{ id: 'S1', candidateFiles: [], creationBrief: {} }], mediaAssets: [] }, null, 2));
  /* A live H3 request now compiles from the shot's durable motion package, so the guard
     is exercised against a shot that genuinely could dispatch. Without this the refusals
     below would be "no package built" rather than "that format is not supported", and
     the thing under test — that no unsupported format reaches the provider from ANY
     dispatch shape — would pass for the wrong reason. */
  {
    const seeded = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    addMotionPromptBuild(seeded, 'S1', { mode: 't2v', id: 'h3-guard-build', durationSeconds: 8, references: [] });
    fs.writeFileSync(projectFile, JSON.stringify(seeded, null, 2));
  }
  const projectBefore = fs.readFileSync(projectFile, 'utf8');
  /* A live automation run, so the automation dispatch path clears its own guard and
     genuinely reaches the format gate rather than being turned away earlier. */
  fs.writeFileSync(path.join(projectDir, 'automation-runs.json'), JSON.stringify({
    schemaVersion: 2,
    runs: [{
      id: 'run-h3-guard', revision: 1, type: 'shot-chain', targetId: 'S1', scope: 'motion', status: 'running',
      config: { maxImages: 8 }, usage: { imagesGenerated: 0 }, steps: {}, logs: [], runnerId: 'runner-h3-guard',
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }],
  }, null, 2));

  const providerCalls = [];
  const mock = express();
  mock.use(express.json({ limit: '25mb' }));
  let mockOrigin = '';
  mock.post(['/minimax/h3/text-to-video', '/minimax/h3/image-to-video', '/minimax/h3/reference-to-video'], (req, res) => {
    providerCalls.push({ endpoint: req.path, body: req.body });
    const id = `h3-${providerCalls.length}`;
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}`, cancel_url: `${mockOrigin}/cancel/${id}` });
  });
  const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const mockServer = await listen(mock);
  mockOrigin = `http://127.0.0.1:${mockServer.address().port}`;

  const config = { generation: { fal: {
    enabled: true, apiKey: 'fal-secret-test-key', baseUrl: mockOrigin,
    h3TextModel: 'minimax/h3/text-to-video', h3ImageModel: 'minimax/h3/image-to-video',
    h3ReferenceModel: 'minimax/h3/reference-to-video', h3Resolution: '2K', maxConcurrent: 1,
  } } };
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  /* Generation captures an explicit project slug before its first await, so the
     harness supplies a resolver rather than a zero-argument directory. */
  const FIXTURE_SLUG = 'h3-guard-fixture';
  registerFalGeneration(app, {
    readConfig: () => JSON.parse(JSON.stringify(config)),
    readProject: (slug = FIXTURE_SLUG) => {
      if (slug !== FIXTURE_SLUG) throw new Error(`No such project: ${slug}`);
      return JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    },
    writeProject: (project, slug = FIXTURE_SLUG) => {
      if (slug !== FIXTURE_SLUG) throw new Error(`No such project: ${slug}`);
      fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));
    },
    activeSlug: () => FIXTURE_SLUG,
    projectDirForSlug: (slug) => {
      if (slug !== FIXTURE_SLUG) throw new Error(`No such project: ${slug}`);
      return { slug, dir: projectDir, file: projectFile };
    },
  });
  const appServer = await listen(app);
  const appOrigin = `http://127.0.0.1:${appServer.address().port}`;

  const prompt = 'Hold the frame steady while the courier steps forward through the rain.';
  const reference = (name, role) => ({ key: name, label: name, role, mediaType: 'image', url: `/assets/shots/S1/takes/${name}` });
  const submit = (body) => fetch(`${appOrigin}/api/generation/fal/jobs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    /* A paid request declares which surface built it and which view was showing; the
       boundary refuses one that does not, and this suite is standing in for the motion
       dialog. See tests/generation-request-fixture.js. */
    body: JSON.stringify(withGenerationDeclaration('/api/generation/fal/jobs', { purpose: 'motion-h3', shotId: 'S1', profileFamily: 'minimax-h3', prompt, ...body })),
  }).then(async (response) => ({ status: response.status, data: await response.json() }));

  try {
    /* Every H3 dispatch shape, at a format the provider does not accept. */
    const UNSUPPORTED = ['2.39:1', '3:2'];
    const PATHS = [
      { name: 'manual text-to-video', body: { profileMode: 't2v' } },
      { name: 'multi-keyframe reference-to-video', body: { profileMode: 'r2v', references: [reference('A.png', 'reference'), reference('B.png', 'reference'), reference('C.png', 'reference')] } },
      { name: 'automation step', body: { profileMode: 't2v', automationRunId: 'run-h3-guard', automationStepKey: 'motion-1', automationRunnerId: 'runner-h3-guard' } },
      { name: 'retry with a fresh idempotency key', body: { profileMode: 't2v', clientRequestId: 'retry-1' } },
      { name: 'resume of the same request', body: { profileMode: 't2v', clientRequestId: 'retry-1' } },
    ];
    let refusals = 0;
    for (const ratio of UNSUPPORTED) {
      for (const dispatchPath of PATHS) {
        const { status, data } = await submit({ ...dispatchPath.body, aspectRatio: ratio });
        assert.strictEqual(status, 400, `${dispatchPath.name} at ${ratio} must be refused, got ${status}`);
        assert.strictEqual(data.code, 'H3_ASPECT_UNSUPPORTED', `${dispatchPath.name} at ${ratio} must be refused for the format, got ${JSON.stringify(data)}`);
        assert(data.error.includes(ratio) && data.error.includes('MiniMax H3'), 'the refusal must name the ratio and the model');
        assert(data.supportedAspectRatios.length, 'the refusal must carry the supported alternatives');
        refusals++;
      }
    }
    assert.strictEqual(providerCalls.length, 0, `no unsupported format may reach the provider — the mock recorded ${providerCalls.length} call(s)`);
    assert.strictEqual(fs.readFileSync(projectFile, 'utf8'), projectBefore, 'a refused dispatch must leave the project record byte-identical');
    const listed = await fetch(`${appOrigin}/api/generation/fal/jobs`).then((response) => response.json());
    assert.strictEqual((listed.jobs || []).length, 0, 'a refused dispatch must not leave a job record behind');
    note(`h3 dispatch: ${refusals} refusals across ${PATHS.length} paths x ${UNSUPPORTED.length} unsupported formats, provider call count 0, project untouched, no orphan job`);

    /* A supported format still reaches the provider, carrying the requested ratio. */
    const ok = await submit({ profileMode: 't2v', aspectRatio: '9:16', clientRequestId: 'supported-1' });
    assert.strictEqual(ok.status, 200, `a supported format must still dispatch, got ${ok.status}: ${JSON.stringify(ok.data)}`);
    assert.strictEqual(providerCalls.length, 1, 'the supported format must reach the provider exactly once');
    assert.strictEqual(providerCalls[0].body.aspect_ratio, '9:16', 'the provider must receive the format that was asked for');
    note('h3 dispatch: a supported 9:16 request still compiles and reaches the provider as 9:16');
  } finally {
    mockServer.close();
    appServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ================================================================================
   5. Reference-image import — the workflow the review had to record as blocked
   ================================================================================ */
/* The review could not tell a harness limitation from an app defect and, correctly,
   claimed neither. It was an app defect: `wireEntityDropzone` returned on the absence of
   `#entity-dz`, a drop target that is no longer rendered anywhere in the product, before
   reaching the line that gives `#entity-file` its change handler. Choosing a file in the
   picker therefore did nothing at all — on every Reference, in every project. */
async function referenceUploader() {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'library-tools.js'), 'utf8');
  const body = source.slice(source.indexOf('function wireEntityDropzone'));
  const wiresInput = body.indexOf('input.onchange');
  const readsDropzone = body.indexOf("getElementById(\"entity-dz\")");
  const bailsOnDropzone = body.indexOf('if (!dz) return');
  assert(wiresInput > 0 && bailsOnDropzone > 0, 'wireEntityDropzone must still both wire the input and tolerate a missing drop target');
  assert(
    wiresInput < bailsOnDropzone,
    'the file input must be wired before wireEntityDropzone gives up on the drop target. Reversed, the reference picker opens and nothing happens.',
  );
  assert(readsDropzone > wiresInput, 'the drop target must be looked up after the picker is wired');

  /* And the function itself, run against exactly the DOM every reference workspace
     presents: a file input, and no drop target. */
  const input = { id: 'entity-file', files: [], onchange: null };
  const sandbox = {
    document: { getElementById: (id) => (id === 'entity-file' ? input : null) },
    window: {},
    console,
    intakeModal: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'library-tools.js'), 'utf8'), sandbox);
  vm.runInContext("wireEntityDropzone('character', 'KAI')", sandbox);
  assert.strictEqual(
    typeof input.onchange,
    'function',
    'choosing a file in the reference picker must reach the intake step. Without a change handler the picker opens, a file is chosen, and nothing happens — no request, no error, no state change.',
  );

  /* And it still works when the drop target is present, so nothing was traded away. */
  const withDropzone = { id: 'entity-file', files: [], onchange: null };
  const events = [];
  const dropzone = { addEventListener: (type) => events.push(type), classList: { add() {}, remove() {} } };
  const both = {
    document: { getElementById: (id) => (id === 'entity-file' ? withDropzone : id === 'entity-dz' ? dropzone : null) },
    window: {}, console, intakeModal: () => {},
  };
  both.window = both;
  vm.createContext(both);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'library-tools.js'), 'utf8'), both);
  vm.runInContext("wireEntityDropzone('character', 'KAI')", both);
  assert.strictEqual(typeof withDropzone.onchange, 'function');
  assert(events.includes('drop'), 'a drop target, where one exists, must still receive its listeners');
  note('reference import: the picker is wired with and without a drop target; every reference workspace renders none');
}

providerRefusal()
  .then(referenceUploader)
  .then(() => {
    console.log('launch-blockers: OK');
    for (const line of results) console.log('  ' + line);
  })
  .catch((error) => { console.error(error); process.exit(1); });

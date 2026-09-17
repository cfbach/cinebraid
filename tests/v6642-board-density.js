/* CineBraid EV2-7 Checkpoint 2 — THE SHOT BOARD: ONE CARD SIZE, ONE WAY INTO A SHOT, ONE SCOPE.
 *
 * This suite used to hold the v6.6.4.2 card-size control to its three densities and to the
 * styles.css tracks behind them. EV2-7 B2.3 retired that control: the board has one card
 * size per width, declared in public/experience-coherence.css and measured in a real browser
 * at 390, 1280, 1440 and 1920 by tests/v6642-board-density-real-browser.py (columns, whole
 * titles, contained and bounded media, no overflow, paging focus, return to the board).
 * What a rendered page proves without a layout engine is asserted here, off its markup:
 *   (a) no card-size control, and a stored card size is neither applied nor erased;
 *   (b) each card is ONE link to its shot, named by its whole title and described by its
 *       leading action and reason, in the ruling's order, with no control inside it, no
 *       relation badges, and Inspect preview beside the link, not in it;
 *   (c) the head counts the page and offers one contextual Add shot and no Continue;
 *   (d) one Show selector with the canonical counts, the matching count and range beside it,
 *       and More filters explaining Production state, with its active count and Clear
 *       filters outside the fold;
 *   (e) a returned result leads its card under All shots AND under the default, while
 *       "Needs a decision" still counts readiness decisions only;
 *   (f) a filter that matches nothing says so, and says how to see the rest;
 *   (g) five cards a page, one pager after them, none for a single page;
 *   (h) collapsing a scene is still remembered under its stable key.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { render, rawFixture, withCanon } = require('./render-harness');
const RELEASE_VERSION = require('../package.json').version;

let checks = 0;
const equal = (a, b, m) => { checks += 1; assert.strictEqual(a, b, m); };
const deepEqual = (a, b, m) => { checks += 1; assert.deepStrictEqual(a, b, m); };
const ok = (v, m) => { checks += 1; assert(v, m); };
const evaluate = (context, body) => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${body} })())`, context));
const mainHtml = (page) => page.context.document.getElementById('main').innerHTML;
const text = (value) => String(value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* ---------------------------------------------------------------- fixtures
   Every cast reference approved, as tests/ev2-7-shot-leading-action.js builds them, so a
   returned result can lead a card and readiness is not blocked by an unrelated reference. */
const CAST_CANON = [
  { kind: 'entity-state', list: 'characters', entityId: 'KAI', stateId: 'state-default', value: 'KAI-ANCHOR.png' },
  { kind: 'entity-state', list: 'locations', entityId: 'LOC-HULL', stateId: 'state-default', value: 'LOC-HULL-PLATE.png' },
  { kind: 'entity-state', list: 'props', entityId: 'PR-TOOL', stateId: 'state-default', value: 'PR-TOOL-PLATE.png' },
];
const LONG_TITLE = 'The long slow push-in along the rain-streaked hull as the maintenance cart pulls away and the warning lamps change from amber to red one after another';
function projectOf(shots) {
  const project = rawFixture();
  const template = project.shots[0];
  project.scenes = [project.scenes[0], { id: 'SC-02', title: 'Upper deck', tier: 'B', whatHappens: 'Kai climbs to the upper deck.', howItFeels: 'Exposed.' }];
  project.shots = shots.map((spec) => ({
    ...JSON.parse(JSON.stringify(template)),
    id: spec.id,
    scene: spec.scene || 'SC-01',
    title: spec.title || `Shot ${spec.id}`,
    keyframes: [{ id: 'frame-a', label: 'A', title: 'Frame A', winner: '', description: 'Worker at panel.', required: true, generationPackages: [] }],
    clips: [],
    candidateFiles: spec.candidates || [],
    creationBrief: { deliveryIntent: 'still' },
    promptBuilds: [],
    promptOptions: [],
  }));
  return withCanon(project, CAST_CANON);
}
function scanWith(project, takesByShot = {}) {
  const approved = (list, dir) => (project[list] || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/${dir}/${x.approvedFile}` }));
  return {
    anchors: approved('characters', 'anchors'), plates: approved('locations', 'plates'), props: approved('props', 'props'),
    vehicles: [], audio: [], media: [],
    shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, {
      takes: (takesByShot[shot.id] || []).map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })),
      locked: [],
    }])),
  };
}
const candidate = (name) => ({
  stored: name, original: name, notes: '', labels: [], addedAt: '2026-08-20T10:00:00.000Z', decision: 'unreviewed',
  frameId: 'frame-a', generationJobId: `job-${name}`, generationProvider: 'fal', generationModel: 'gpt-image-2',
});
const board = (project, { takes = {}, storage = {} } = {}) => render('#/shots/board', project, { scan: scanWith(project, takes), storage });

/* ---------------------------------------------------------------- readers */
function cardsOf(html) {
  return html.split('<article class="slate').slice(1).map((chunk) => {
    const card = chunk.split('</article>')[0];
    const [, linkAttrs = '', inside = ''] = /<a\b([^>]*)>([\s\S]*)<\/a>/.exec(card) || [];
    const attr = (source, name) => (String(source).match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
    const span = (cls) => {
      const match = new RegExp(`<span class="${cls}( [^"]*)?"([^>]*)>([^<]*)</span>`).exec(inside);
      return match ? { cls: (match[1] || '').trim(), attrs: match[2], text: text(match[3]), id: attr(match[2], 'id') } : null;
    };
    return {
      card, linkAttrs, inside,
      links: (card.match(/<a\b/g) || []).length,
      shotId: attr(card.split('>')[0], 'data-shot-id'),
      href: attr(linkAttrs, 'href'),
      after: card.includes('</a>') ? card.slice(card.indexOf('</a>') + 4) : '',
      top: span('slate-id'), state: span('slate-state'), title: span('slate-title'), next: span('slate-next'), reason: span('slate-reason'),
      order: ['slate-top', 'slate-title', 'slate-thumb', 'slate-next', 'slate-reason', 'slate-open'].map((cls) => inside.indexOf(`class="${cls}`)),
    };
  });
}
const optionsOf = (html) => [...html.matchAll(/<option\b([^>]*\bdata-board-filter="([^"]*)"[^>]*)>([^<]*)<\/option>/g)].map((match) => ({
  id: match[2], count: Number((match[1].match(/\bdata-count="(\d+)"/) || [])[1]), selected: /\sselected\b/.test(match[1]), words: text(match[3]),
}));
const rangeOf = (html) => text((html.match(/<span class="board-range" id="shot-board-range">([^<]*)<\/span>/) || [])[1]);
const foldOf = (html) => (html.match(/<details class="board-filter-fold"[\s\S]*?<\/details>/) || [''])[0];

/* ---------------------------------------------------------------- (a) */
async function caseA() {
  const project = projectOf([{ id: 'L1-01' }, { id: 'L1-02' }]);
  const page = await board(project, { storage: { 'cinebraid-shot-board-density': 'large', 'cinebraid-shot-action-filter': 'all' } });
  let html = mainHtml(page);
  ok(!/Card size|board-density|setShotBoardDensity\(/.test(html), '(a) the board renders no card-size control');
  ok(!/\bsize-(compact|comfortable|large)\b/.test(html), '(a) a stored card size is not applied to any row');
  equal(page.context.localStorage.getItem('cinebraid-shot-board-density'), 'large', '(a) and the stored card size is not erased');
  page.context.setShotBoardDensity('compact');
  await page.context.route();
  html = mainHtml(page);
  equal(page.context.localStorage.getItem('cinebraid-shot-board-density'), 'compact', '(a) the compatibility entry point still records a choice');
  ok(!/\bsize-(compact|comfortable|large)\b/.test(html), '(a) and the board still applies none');
  equal(cardsOf(html).length, 2, '(a) the board still shows its cards');
}

/* ---------------------------------------------------------------- (b) */
async function caseB() {
  const project = projectOf([{ id: 'L1-01', title: LONG_TITLE }, { id: 'L1-02' }]);
  project.shots[1].keyframes[0].winner = 'FRAME_B2.png';
  const page = await board(project, { takes: { 'L1-02': ['FRAME_B2.png'] }, storage: { 'cinebraid-shot-action-filter': 'all' } });
  const html = mainHtml(page);
  const cards = cardsOf(html);
  equal(cards.length, 2, '(b) precondition: both shots are on the page');
  ok(!/relation-chip|board-badge-legend|CARD BADGES/.test(html), '(b) no relation badges and no badge legend');
  for (const card of cards) {
    const shot = project.shots.find((row) => row.id === card.shotId);
    ok(shot, `(b) the card names a real shot: ${card.shotId}`);
    equal(card.links, 1, `(b) ${shot.id}: title, media and body are ONE link`);
    equal(card.href, `#/shot/${shot.id}`, `(b) ${shot.id}: and it opens the shot`);
    ok(!/<(button|select|input|textarea|details|a)\b/.test(card.inside), `(b) ${shot.id}: nothing interactive is nested inside the link`);
    equal(card.title && card.title.text, shot.title, `(b) ${shot.id}: the card carries the whole title`);
    equal((card.linkAttrs.match(/\baria-labelledby="([^"]*)"/) || [])[1], card.title.id, `(b) ${shot.id}: the link is named by that title`);
    deepEqual((card.linkAttrs.match(/\baria-describedby="([^"]*)"/) || [])[1].split(' '), [card.next.id, card.reason.id], `(b) ${shot.id}: and described by its leading action and its reason`);
    ok(card.order.every((at, index) => at >= 0 && (index === 0 || at > card.order[index - 1])), `(b) ${shot.id}: identity and state, title, preview, action, reason, Open shot — in that order: ${card.order}`);
    equal(card.top.text, shot.id, `(b) ${shot.id}: the card leads with the shot ID`);
    equal(card.state.text, evaluate(page.context, `return workflowState(shotById(${JSON.stringify(shot.id)})).label;`), `(b) ${shot.id}: beside its recorded workflow status`);
    ok(/data-leading-source="[^"]+"/.test(card.next.attrs) && /data-readiness-code="/.test(card.next.attrs), `(b) ${shot.id}: the action line keeps its leading-action data`);
    ok(/>Open shot <span aria-hidden="true">→<\/span><\/span>/.test(card.inside), `(b) ${shot.id}: with a visible Open shot cue`);
    ok(!/onclick=/.test(card.next.attrs), `(b) ${shot.id}: the action line only describes; it dispatches nothing`);
  }
  const imaged = cards.find((card) => card.shotId === 'L1-02');
  ok(/<button type="button" class="media-enlarge-btn slate-enlarge"[^>]*onclick="[^"]*inspectMediaFile\(/.test(imaged.after), '(b) Inspect preview sits beside the link, not inside it');
  ok(imaged.after.includes('aria-label="Inspect the L1-02 image"'), '(b) and names the shot whose media it inspects');
  ok(imaged.after.includes(encodeURIComponent('/assets/shots/L1-02/takes/FRAME_B2.png')), '(b) and hands over that exact file');
}

/* ---------------------------------------------------------------- (c) */
async function caseC() {
  const one = projectOf([{ id: 'L1-01' }]);
  one.scenes = [one.scenes[0]];
  const single = mainHtml(await board(one));
  ok(single.includes('<h1 class="view-title">Shots</h1>'), '(c) the page is headed Shots');
  ok(single.includes('>1 shot · 1 scene<'), '(c) with a count that says 1 shot, not 1 shots');
  const many = mainHtml(await board(projectOf([{ id: 'L1-01' }, { id: 'L1-02', scene: 'SC-02' }])));
  ok(many.includes('>2 shots · 2 scenes<'), '(c) and pluralises when there are more');
  const bare = projectOf([]);
  bare.scenes = [];
  const empty = mainHtml(await board(bare));
  ok(empty.includes('<h2>This project has no shots yet</h2>') && !empty.includes('shot-board-show'), '(c) an empty board says it has no shots, with nothing to filter');
  for (const html of [single, many, empty]) {
    equal((html.match(/onclick="openContextualAdd\('shot'\)"/g) || []).length, 1, '(c) the board offers exactly one contextual Add shot, empty or not');
    ok(!html.includes('continueProduction()'), '(c) and no Continue');
  }
}

/* ---------------------------------------------------------------- (d) */
async function caseD() {
  const project = projectOf([{ id: 'L1-01' }, { id: 'L1-02' }, { id: 'L1-03', scene: 'SC-02' }]);
  const page = await board(project, { storage: { 'cinebraid-shot-action-filter': 'missing-inputs' } });
  let html = mainHtml(page);
  equal((html.match(/<select\b/g) || []).length - (foldOf(html).match(/<select\b/g) || []).length, 1, '(d) one Show selector outside More filters');
  ok(/<label class="board-show" for="shot-board-show"><span>Show<\/span><select id="shot-board-show" aria-describedby="shot-board-range" onchange="setShotActionFilter\(this\.value\)">/.test(html), '(d) labelled Show, described by the matching count, and filtering through the canonical owner');
  const options = optionsOf(html);
  deepEqual(options.map((row) => row.id), ['unfinished', 'review', 'missing-inputs', 'ready', 'complete', 'all'], '(d) the six canonical production states, in order');
  const canonical = evaluate(page.context, `
    const feed = projectShotReadiness(), previous = FILTER.action, counts = {};
    for (const id of ["unfinished", "review", "missing-inputs", "ready", "complete", "all"]) {
      FILTER.action = id;
      counts[id] = P.shots.filter((shot) => shotBoardActionMatches(shot, feed)).length;
    }
    FILTER.action = previous;
    return counts;`);
  for (const row of options) {
    equal(row.count, canonical[row.id], `(d) ${row.id}: the option count is the canonical count`);
    ok(row.words.endsWith(` · ${row.count}`), `(d) ${row.id}: and the option shows it: ${row.words}`);
  }
  deepEqual(options.filter((row) => row.selected).map((row) => row.id), ['missing-inputs'], '(d) the remembered filter is the selected option');
  const matching = canonical['missing-inputs'];
  equal(rangeOf(html), `${matching} of 3 shots${matching ? ` · 1–${Math.min(matching, 5)} shown` : ''}`, '(d) the matching count and range sit beside Show');

  page.context.setShotActionFilter('all');
  await page.context.route();
  html = mainHtml(page);
  equal(page.context.localStorage.getItem('cinebraid-shot-action-filter'), 'all', '(d) choosing a state is remembered where it always was');
  equal(rangeOf(html), '3 of 3 shots · 1–3 shown', '(d) and the range follows it');
  const fold = foldOf(html);
  ok(/<summary>More filters<\/summary>/.test(fold), '(d) More filters is one closed secondary fold with nothing active');
  ok(/<b>Production state<\/b> is what Show filters by/.test(fold) && /returned result waiting for your review does not change/.test(fold), '(d) and it names the Show dimension Production state, unchanged by returned results');
  ok(!html.includes('Clear filters'), '(d) with no filter applied there is nothing to clear');

  vm.runInContext('FILTER.status = "IN PROGRESS";', page.context);
  await page.context.route();
  html = mainHtml(page);
  ok(/<summary>More filters <span class="board-filter-count">1 active<\/span><\/summary>/.test(foldOf(html)), '(d) an applied filter is counted on the fold itself');
  ok(/<\/details><button type="button" class="board-clear-filters" onclick="clearShotBoardFilters\(\)">Clear filters<\/button>/.test(html), '(d) and Clear filters sits outside the fold, visible while it is closed');
  page.context.clearShotBoardFilters();
  await page.context.route();
  equal(vm.runInContext('FILTER.status + FILTER.route + FILTER.char', page.context), '', '(d) Clear filters clears the More filters');
  equal(vm.runInContext('FILTER.action', page.context), 'all', '(d) and leaves Show as chosen');
}

/* ---------------------------------------------------------------- (e) */
async function caseE() {
  const project = projectOf([{ id: 'L1-01', candidates: [candidate('FRAME_A.png')] }, { id: 'L1-02' }]);
  for (const filter of ['all', 'unfinished']) {
    const page = await board(project, { takes: { 'L1-01': ['FRAME_A.png'] }, storage: { 'cinebraid-shot-action-filter': filter } });
    const html = mainHtml(page);
    const card = cardsOf(html).find((row) => row.shotId === 'L1-01');
    ok(card, `(e) under ${filter}: the shot with a returned result is on the board`);
    ok(/\bdata-leading-source="returned-review"/.test(card.next.attrs), `(e) under ${filter}: its card leads with the returned result`);
    equal(card.next.text, 'Review Frame A result', `(e) under ${filter}: in the leading review words`);
    equal((card.next.attrs.match(/\bdata-leading-key="([^"]*)"/) || [])[1], 'path:shots/L1-01/takes/FRAME_A.png', `(e) under ${filter}: carrying the exact key of the result it means`);
    equal(card.reason.text, 'A returned Frame A result is waiting for your decision.', `(e) under ${filter}: with one plain reason and no filename wall`);
    deepEqual(optionsOf(html).filter((row) => row.selected).map((row) => row.id), [filter], `(e) under ${filter}: which is the state Show says`);
    equal(optionsOf(html).find((row) => row.id === 'review').count, 0, `(e) under ${filter}: "Needs a decision" still counts readiness decisions, not returned results`);
  }
}

/* ---------------------------------------------------------------- (f) */
async function caseF() {
  const project = projectOf([{ id: 'L1-01' }, { id: 'L1-02' }]);
  const page = await board(project, { storage: { 'cinebraid-shot-action-filter': 'complete' } });
  let html = mainHtml(page);
  equal(optionsOf(html).find((row) => row.id === 'complete').count, 0, '(f) precondition: nothing is delivered');
  equal(cardsOf(html).length, 0, '(f) no card is shown');
  equal(rangeOf(html), '0 of 2 shots', '(f) the count says none match');
  ok(html.includes('<h2>No shots match “Delivered”</h2>'), '(f) the board says which state matched nothing');
  ok(html.includes('None of this project’s 2 shots are in this production state. To see them, show all shots.'), '(f) and how to see the others');
  ok(html.includes(`<button type="button" onclick="setShotActionFilter('all')">Show all shots</button>`), '(f) with the control that does it');
  ok(!html.includes('board-pager'), '(f) and no pager');
  page.context.setShotActionFilter('all');
  await page.context.route();
  equal(cardsOf(mainHtml(page)).length, 2, '(f) Show all shots brings the others back');

  vm.runInContext('FILTER.char = "NOBODY";', page.context);
  await page.context.route();
  html = mainHtml(page);
  ok(html.includes('<h2>No shots match these filters</h2>'), '(f) a More filter that matches nothing says so too');
  ok(html.includes('match the filters in More filters. To see them, clear filters.'), '(f) and names the way back');
  ok(html.includes('class="board-clear-filters"'), '(f) which is visible beside the fold');
}

/* ---------------------------------------------------------------- (g) */
async function caseG() {
  const shots = Array.from({ length: 7 }, (_, index) => ({ id: `L1-0${index + 1}`, scene: index < 4 ? 'SC-01' : 'SC-02' }));
  const page = await board(projectOf(shots), { storage: { 'cinebraid-shot-action-filter': 'all' } });
  let html = mainHtml(page);
  equal(cardsOf(html).length, 5, '(g) five cards a page');
  equal((html.match(/<nav class="bounded-pager board-pager"/g) || []).length, 1, '(g) one pager');
  ok(html.indexOf('board-pager') > html.lastIndexOf('</article>'), '(g) after the cards, not above them');
  ok(html.includes('<span>1–5 of 7</span>') && html.includes('onclick="setShotBoardPage(1)">Next</button>'), '(g) naming the range and turning through the board owner');
  equal(rangeOf(html), '7 of 7 shots · 1–5 shown', '(g) the range also sits beside Show');
  ok(/<h2 class="log-heading" id="board-scene-SC-01" tabindex="-1">/.test(html), '(g) each scene heading can take focus when a page turns');
  page.context.setShotBoardPage(1);
  await page.context.route();
  html = mainHtml(page);
  equal(cardsOf(html).length, 2, '(g) the next page holds the rest');
  ok(html.includes('<span>6–7 of 7</span>'), '(g) and says so');
  equal(page.context.localStorage.getItem('cinebraid-bounded:fixture:page:shots:board::::all'), '1', '(g) the page is the bounded page state, so returning to the board keeps it');
  const few = mainHtml(await board(projectOf(shots.slice(0, 3)), { storage: { 'cinebraid-shot-action-filter': 'all' } }));
  ok(!few.includes('board-pager'), '(g) a single page has no pager');
}

/* ---------------------------------------------------------------- (h) */
async function caseH() {
  const project = projectOf([{ id: 'L1-01' }]);
  const page = await board(project, { storage: { 'cinebraid-shot-action-filter': 'all' } });
  page.context.toggleSceneCollapse('SC-01');
  const stored = JSON.parse(page.context.localStorage.getItem('cinebraid-collapsed-scenes') || '[]');
  ok(stored.includes('SC-01'), '(h) collapsing a scene persists under cinebraid-collapsed-scenes');
  await page.context.route();
  const html = mainHtml(page);
  ok(html.includes('aria-expanded="false"') && cardsOf(html).length === 0, '(h) and the collapsed scene hides its cards');
}

(async () => {
  for (const [name, fn] of [['a', caseA], ['b', caseB], ['c', caseC], ['d', caseD], ['e', caseE], ['f', caseF], ['g', caseG], ['h', caseH]]) {
    await fn();
    console.log(`  ok  (${name})`);
  }
  console.log(`v${RELEASE_VERSION} shot board suite: ${checks} checks passed — one card size with no density control, one link per card, Show with canonical counts and range, returned results under All and the default, zero-match guidance, one pager, scene collapse.`);
})().catch((error) => { console.error(error.stack || error); process.exit(1); });

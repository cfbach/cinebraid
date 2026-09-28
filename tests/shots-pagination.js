/* Shots page-size preference: scope, paging, filtering and stable scene/shot order. */
const assert = require('assert');
const vm = require('vm');
const { render, buildFixture } = require('./render-harness');
const SIZE_KEY = 'cinebraid-bounded:fixture:page-size:shots';
const ids = (page) => [...page.map.get('main').innerHTML.matchAll(/<article class="slate[^>]*data-shot-id="([^"]+)"/g)].map((m) => m[1]);
const run = (page, code) => vm.runInContext(code, page.context);

async function main() {
  const project = buildFixture();
  const template = project.shots[0];
  const scene = project.scenes[0];
  project.scenes = [{ ...scene, id: 'SC-B' }, { ...scene, id: 'SC-A' }];
  project.shots = Array.from({ length: 31 }, (_, i) => ({
    ...JSON.parse(JSON.stringify(template)), id: `S-${String(31 - i).padStart(2, '0')}`,
    scene: i % 2 ? 'SC-A' : 'SC-B', characters: i < 8 ? ['KAI'] : [],
  }));
  const ordered = project.scenes.flatMap((s) => project.shots.filter((shot) => shot.scene === s.id).map((shot) => shot.id));
  const before = JSON.stringify(project);
  const page = await render('#/shots/board', project, { storage: { 'cinebraid-shot-action-filter': 'all' } });
  assert.deepStrictEqual(ids(page), ordered.slice(0, 20), 'default 20 preserves existing scene/shot order');
  const normalizedBefore = JSON.stringify(run(page, 'P'));
  const markup = page.map.get('main').innerHTML;
  assert(markup.includes('for="shot-board-page-size"><span>Shots per page</span>'));
  const options = markup.match(/<select id="shot-board-page-size"[^>]*>(.*?)<\/select>/)[1];
  assert.deepStrictEqual([...options.matchAll(/value="(\d+)"/g)].map(m => Number(m[1])), [5,10,15,20,25]);
  assert(options.includes('value="20" selected'));
  for (const size of [5,10,15,20,25]) {
    await page.context.setShotBoardPageSize(String(size));
    assert.deepStrictEqual(ids(page), ordered.slice(0,size));
    const all = [...ids(page)];
    for (let index=1; index<Math.ceil(31/size); index++) {
      page.context.setShotBoardPage(index); await page.context.route();
      all.push(...ids(page));
    }
    assert.deepStrictEqual(all, ordered, `size ${size}: every shot once, same order across scenes`);
    assert(page.map.get('main').innerHTML.match(/<button type="button" disabled onclick="setShotBoardPage\(\d+\)">Next/));
    await page.context.setShotBoardPageSize(String(size));
    assert.deepStrictEqual(ids(page), ordered.slice(0,size), 'size change starts on page one');
  }
  await page.context.setShotBoardPageSize('5');
  page.context.setShotBoardPage(6); await page.context.route();
  run(page, 'FILTER.char="KAI"'); await page.context.route();
  const filtered = ordered.filter(id => project.shots.find(s => s.id === id).characters.includes('KAI'));
  assert.deepStrictEqual(ids(page), filtered.slice(0,5), 'filter applies before pagination');
  page.context.setShotBoardPage(1); await page.context.route();
  await page.context.setShotBoardPageSize('10');
  assert.deepStrictEqual(ids(page), filtered, 'size change retains filter and resets its page');
  assert.strictEqual(run(page, 'FILTER.char'), 'KAI');
  run(page, 'FILTER.char="absent"'); await page.context.route();
  assert.deepStrictEqual(ids(page), []);
  assert(page.map.get('main').innerHTML.includes('Shots per page'), 'control remains available for zero matches');
  await page.context.setShotBoardPageSize('20');
  page.context.clearShotBoardFilters(); await page.context.route();
  assert.deepStrictEqual(ids(page), ordered.slice(0,20));
  for (const value of ['0','6','100','NaN','']) {
    await page.context.setShotBoardPageSize(value);
    assert.strictEqual(page.context.localStorage.getItem(SIZE_KEY), '20', 'invalid size ignored');
  }
  await page.context.setShotBoardPageSize('15');
  const reopened = await render('#/shots/board', project, { storage: { 'cinebraid-shot-action-filter':'all', [SIZE_KEY]: page.context.localStorage.getItem(SIZE_KEY) } });
  assert.deepStrictEqual(ids(reopened), ordered.slice(0,15), 'saved size survives reopen');
  run(page, 'ACTIVE_PROJECT_SLUG="another-project"');
  assert.strictEqual(run(page, 'shotBoardPageSize()'), 20, 'other projects default independently');
  const bad = await render('#/shots/board', project, { storage: { 'cinebraid-shot-action-filter':'all', [SIZE_KEY]:'999' } });
  assert.deepStrictEqual(ids(bad), ordered.slice(0,20), 'invalid saved size falls back to 20');
  assert.strictEqual(JSON.stringify(project), before, 'browsing leaves source project unchanged');
  assert.strictEqual(JSON.stringify(run(page, 'P')), normalizedBefore, 'browsing leaves normalized project data unchanged');
  console.log('Shots pagination passed: defaults/options, all five sizes, page boundaries, scene/shot order, filters/zero matches, reset, persistence, project isolation, invalid values and data immutability.');
}
main().catch(error => { console.error(error); process.exitCode=1; });

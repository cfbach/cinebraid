const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, buildFixture } = require('./render-harness');
const RELEASE_VERSION = require("../package.json").version;

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

async function main() {
  const app = read('public/app.js');
  const styles = read('public/styles.css');

  assert(app.includes('cinebraid-shot-board-density'), 'shot card density must persist in local storage');
  assert(app.includes('shotBoardDensityControl()'), 'Production board must expose a card-size control');
  assert(app.includes('size-${SHOT_BOARD_DENSITY}'), 'the selected density must be applied to each visible scene row');
  assert(app.includes('"cinebraid-collapsed-scenes"'), 'scene collapse state must use a stable storage key');
  assert(styles.includes('.shot-row.bounded-shot-page.size-compact{grid-template-columns:repeat(auto-fill,minmax(220px,260px))}'), 'compact cards must have a bounded maximum width');
  assert(styles.includes('.shot-row.bounded-shot-page.size-comfortable{grid-template-columns:repeat(auto-fill,minmax(280px,340px))}'), 'standard cards must have a bounded maximum width');
  assert(styles.includes('.shot-row.bounded-shot-page.size-large{grid-template-columns:repeat(auto-fill,minmax(360px,460px))}'), 'large cards must have a bounded maximum width');

  const fixture = buildFixture();
  fixture.meta.version = '6.6.4-studio.repair.13';
  const result = await render('#/shots/board', fixture, { storage: {
    'cinebraid-shot-board-density': 'compact',
    'cinebraid-shot-action-filter': 'all',
  }});
  let html = result.context.document.getElementById('main').innerHTML;
  assert(html.includes('Card size'), 'shot board must label the density control');
  assert(html.includes('size-compact'), 'compact must be the rendered density');
  assert(html.includes('aria-pressed="true">Compact'), 'compact density must expose selected state');

  result.context.setShotBoardDensity('large');
  await result.context.route();
  html = result.context.document.getElementById('main').innerHTML;
  assert.strictEqual(result.context.localStorage.getItem('cinebraid-shot-board-density'), 'large');
  assert(html.includes('size-large'), 'large selection must rerender the board');
  assert(html.includes('aria-pressed="true">Large'), 'large density must expose selected state');

  const sceneId = fixture.scenes[0].id;
  result.context.toggleSceneCollapse(sceneId);
  const storedCollapsed = JSON.parse(result.context.localStorage.getItem('cinebraid-collapsed-scenes') || '[]');
  assert(storedCollapsed.includes(sceneId), 'scene collapse choice must persist');

  console.log(`v${RELEASE_VERSION} board-density suite passed compact/standard/large controls, bounded card widths, persistence, and scene-collapse storage.`);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });

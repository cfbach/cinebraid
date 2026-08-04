const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const source = fs.readFileSync(path.join(ROOT, 'public', 'focused-workspaces.js'), 'utf8');
assert(index.includes('focused-workspaces.js?v=6.6.4-studio.repair.13'), 'focused workspace module must be loaded and cache busted');
assert(index.indexOf('motion-sound-composer.js?v=6.6.4-studio.repair.13') < index.indexOf('focused-workspaces.js?v=6.6.4-studio.repair.13'), 'focused workspaces load after composer');
assert(index.indexOf('focused-workspaces.js?v=6.6.4-studio.repair.13') < index.indexOf('bootstrap.js?v=6.6.4-studio.repair.13'), 'focused workspaces load before bootstrap');
for (const marker of ['focused-taskbar','focused-inspector','focused-entity-shell','focused-pagination','focused-slot-rail']) assert(css.includes(marker), `missing focused CSS marker ${marker}`);
for (const marker of ['enhanceShot','enhanceEntity','enhanceScene','paginate','focusSlotBoards']) assert(source.includes(`function ${marker}`), `missing workspace behavior ${marker}`);
assert(source.includes('PAGE_SIZE = { candidates: 12, reports: 50, shots: 40 }'), 'large collection limits must be explicit');
assert(source.includes('focused-task-hidden'), 'only one selected task should remain visible');
assert(source.includes('localStorage'), 'task state should persist outside project data');
assert(!/\bdirty\s*\(/.test(source) && !/\broute\s*\(/.test(source), 'focused workspace must not save or rerender project data');

assert(source.includes('FOCUSED_DETAIL_VIEWS'), 'focused route eligibility must be explicit');
assert(source.includes('delete document.body.dataset.focusedWorkspace'), 'overview routes must clear focused detail mode');
assert(css.includes('body[data-focused-route="shots"]{overflow-x:clip}'), 'shot overview must prevent viewport-level horizontal overflow');
assert(css.includes('body[data-focused-route="shots"] .shot-row>*{min-width:0;max-width:100%}'), 'shot cards must not force overview width');

const sandbox = {
  window: { addEventListener() {} },
  document: { body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
  location: { hash: '#/shots/board' },
  localStorage: { getItem() { return null; }, setItem() {} },
  requestAnimationFrame(fn) { return 0; },
  MutationObserver: function () { this.observe = function () {}; },
  console,
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.location = sandbox.location;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
sandbox.window.MutationObserver = sandbox.MutationObserver;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
assert.strictEqual(sandbox.window.__CINEBRAID_FOCUSED.isFocusedDetailView('shot'), true, 'shot detail should use focused layout');
assert.strictEqual(sandbox.window.__CINEBRAID_FOCUSED.isFocusedDetailView('character'), true, 'reference detail should use focused layout');
assert.strictEqual(sandbox.window.__CINEBRAID_FOCUSED.isFocusedDetailView('shots'), false, 'shots overview must not use focused detail layout');
assert.strictEqual(sandbox.window.__CINEBRAID_FOCUSED.isFocusedDetailView('production'), false, 'production overview must not use focused detail layout');
sandbox.window.__CINEBRAID_FOCUSED.syncFocusedRouteMode('shot');
assert.strictEqual(sandbox.document.body.dataset.focusedWorkspace, '1');
sandbox.window.__CINEBRAID_FOCUSED.syncFocusedRouteMode('shots');
assert.strictEqual(sandbox.document.body.dataset.focusedWorkspace, undefined, 'overview route must remove focused workspace mode');
assert.strictEqual(sandbox.document.body.dataset.focusedRoute, 'shots');
console.log('Focused Workspaces suite passed module order, task isolation, inspectors, list pagination, slot focus, mobile rules, and non-persistent UI state.');

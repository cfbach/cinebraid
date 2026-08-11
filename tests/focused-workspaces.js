const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RELEASE_VERSION = require("../package.json").version;
const ROOT = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const source = fs.readFileSync(path.join(ROOT, 'public', 'focused-workspaces.js'), 'utf8');
assert(index.includes(`focused-workspaces.js?v=${RELEASE_VERSION}`), 'focused workspace module must be loaded and cache busted');
assert(index.indexOf(`motion-sound-composer.js?v=${RELEASE_VERSION}`) < index.indexOf(`focused-workspaces.js?v=${RELEASE_VERSION}`), 'focused workspaces load after composer');
assert(index.indexOf(`focused-workspaces.js?v=${RELEASE_VERSION}`) < index.indexOf(`bootstrap.js?v=${RELEASE_VERSION}`), 'focused workspaces load before bootstrap');
for (const marker of ['focused-taskbar','focused-inspector','focused-entity-shell','focused-pagination','focused-slot-rail']) assert(css.includes(marker), `missing focused CSS marker ${marker}`);
for (const marker of ['enhanceShot','enhanceEntity','enhanceScene','paginate','focusSlotBoards']) assert(source.includes(`function ${marker}`), `missing workspace behavior ${marker}`);
assert(source.includes('PAGE_SIZE = { candidates: 12, reports: 50, shots: 40 }'), 'large collection limits must be explicit');
assert(source.includes('focused-task-hidden'), 'only one selected task should remain visible');
assert(source.includes('localStorage'), 'task state should persist outside project data');
assert(!/\bdirty\s*\(/.test(source) && !/\broute\s*\(/.test(source), 'focused workspace must not save or rerender project data');

/* ---------------------------------------------------------------------------
   The runtime wiring, guarded here so a Node-only run still catches its return.

   public/app.js declares project state as `let P` at the top level of a classic
   script, so it lives in the page's global LEXICAL scope and is NEVER a property
   of window. This module used to read `window.P` — permanently undefined in a
   browser — so `enhance()` returned at its own guard and none of the behaviour
   asserted above ran anywhere except a test that called its pure functions
   directly. ACTIVE_PROJECT_SLUG, AUTOMATION_RUNS, `esc`, `shotById` and
   `sceneById` are declared the same way and were read the same wrong way.

   The real proof is tests/focused-workspaces-real-browser.py, which asserts DOM
   only this module's runtime can build. This is the cheap portable guard that
   the access pattern has not come back. */
const RETIRED_WINDOW_READS = ['window.P', 'window.ACTIVE_PROJECT_SLUG', 'window.AUTOMATION_RUNS',
  'window.esc', 'window.shotById', 'window.sceneById'];
const executable = source.replace(/\/\*[\s\S]*?\*\//g, '');
for (const read of RETIRED_WINDOW_READS)
  assert(!executable.includes(read),
    `focused-workspaces.js reads ${read}, which is undefined in a browser: app.js declares it with let/const, so it is in the global lexical scope and not on window`);
for (const accessor of ['function activeProject()', 'function activeProjectSlug()', 'function activeAutomationRuns()',
  'function findShot(', 'function findScene(', 'function escapeText('])
  assert(source.includes(accessor), `focused-workspaces.js must resolve shared runtime state through ${accessor}`);
assert(/typeof P === "undefined" \? null : P/.test(source),
  'the project accessor must return the live lexical binding, not a copy of it');
assert(!/JSON\.parse\(JSON\.stringify|structuredClone/.test(executable),
  'the workspace must never snapshot project state — there is one authoritative project object');

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

/* The accessors have to survive a scope with no app.js in it, which is exactly
   what this sandbox is: a bare `P` here would throw ReferenceError and take the
   module's own load with it. That is why the guards are `typeof` guards. */
assert.strictEqual(sandbox.window.__CINEBRAID_FOCUSED.activeProject(), null,
  'with no project in scope the workspace must resolve nothing rather than throw');
sandbox.window.enhanceFocusedWorkspace();
assert.strictEqual(sandbox.document.body.dataset.focusedRoute, 'shots',
  'enhancing with no project in scope must be a no-op, not an error');

console.log('Focused Workspaces suite passed module order, task isolation, inspectors, list pagination, slot focus, mobile rules, non-persistent UI state, and lexical-scope runtime resolution.');

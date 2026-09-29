/* Global search settles only for its current query and production context.
 * Pure browser-boundary tests: controlled fetch promises, no server, provider or data access. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const review = fs.readFileSync(path.join(__dirname, '../public/review.js'), 'utf8');
const start = review.indexOf('/* ---------- global production search ---------- */');
assert(start >= 0, 'exercise the shipped search implementation');
const source = review.slice(start);

function fixture() {
  const inputEvents = new Map(), documentEvents = new Map(), windowEvents = new Map();
  const requests = [], modals = [], messages = [], timers = new Map();
  let timerId = 0, closed = 0;
  const add = (map, type, handler) => map.set(type, [...(map.get(type) || []), handler]);
  const emit = (map, type, event = {}) => (map.get(type) || []).forEach((handler) => handler(event));
  const input = { value: '', _wired: false, blur() {}, focus() {}, addEventListener: (type, handler) => add(inputEvents, type, handler) };
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const context = {
    P: { meta: { title: 'Synthetic production A' } }, ACTIVE_PROJECT_SLUG: 'synthetic-a', PROJECT_OPEN_EPOCH: 1,
    location: { hash: '#/shots/board' }, LB: null, AbortController, esc: escape, attr: escape,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: (id) => timers.delete(id),
    document: { activeElement: { tagName: 'INPUT' }, getElementById: (id) => id === 'global-search' ? input : null, addEventListener: (type, handler) => add(documentEvents, type, handler) },
    window: { addEventListener: (type, handler) => add(windowEvents, type, handler) },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
    openModal(html) { modals.push(html); emit(windowEvents, 'cinebraid:modal-opened'); },
    closeModal() { closed += 1; }, toast: (message) => messages.push(message),
  };
  vm.createContext(context); vm.runInContext(source, context, { filename: 'public/review.js:search' });
  context.wireSearch();
  const results = (title = 'Found shot', extra = {}) => ({ ok: true, json: async () => ({ results: [{ type: 'shot', id: 'S-01', title, snippet: 'Synthetic text', ...extra }] }) });
  return { context, input, requests, modals, messages, timers, results, closed: () => closed,
    inputEvent: () => emit(inputEvents, 'input'), key: (key) => emit(documentEvents, 'keydown', { key }),
    inputKey: (key) => emit(inputEvents, 'keydown', { key }), click: (target) => emit(documentEvents, 'click', { target }),
    navigate(hash) { context.location.hash = hash; emit(windowEvents, 'hashchange'); },
    modalOpened: () => emit(windowEvents, 'cinebraid:modal-opened'),
    flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); },
  };
}
const cases = [];
const test = (name, run) => cases.push([name, run]);

test('newer results win even if an aborted request resolves late', async () => {
  const f = fixture();
  const older = f.context.runSearch('older'), newer = f.context.runSearch('newer');
  assert(f.requests[0].options.signal.aborted, 'superseded request is aborted');
  f.requests[1].resolve(f.results('NEWER')); await newer;
  f.requests[0].resolve(f.results('OLDER')); await older;
  assert.strictEqual(f.modals.length, 1); assert(f.modals[0].includes('NEWER'));
});
test('typing invalidates pending results before the debounce starts another request', async () => {
  const f = fixture(); f.input.value = 'first';
  const pending = f.context.runSearch('first');
  f.input.value = 'second'; f.inputEvent();
  f.requests[0].resolve(f.results('STALE')); await pending;
  assert.strictEqual(f.modals.length, 0); assert.strictEqual(f.requests.length, 1);
  f.flushTimers(); assert.strictEqual(f.requests.length, 2);
  assert.deepStrictEqual(JSON.parse(f.requests[1].options.body), { q: 'second', project: 'synthetic-a' });
  f.requests[1].resolve(f.results('CURRENT'));
});
test('an input value change is checked again when a response settles', async () => {
  const f = fixture(); f.input.value = 'first'; const pending = f.context.runSearch('first');
  f.input.value = 'changed without an event';
  f.requests[0].resolve(f.results()); await pending; assert.strictEqual(f.modals.length, 0);
});
test('Escape anywhere and Escape in the input cancel in-flight results and debounce', async () => {
  for (const useInput of [false, true]) {
    const f = fixture(); const pending = f.context.runSearch('find');
    if (useInput) f.inputKey('Escape'); else f.key('Escape');
    f.requests[0].resolve(f.results()); await pending;
    assert.strictEqual(f.modals.length, 0); assert(f.requests[0].options.signal.aborted);
    f.input.value = 'queued'; f.inputEvent(); f.key('Escape'); f.flushTimers();
    assert.strictEqual(f.requests.length, 1);
  }
});
test('Close and backdrop clicks prevent a pending response from reopening the dialog', async () => {
  for (const target of [{ id: 'modal' }, { closest: (selector) => selector === '#modal .cancel' }]) {
    const f = fixture(); const pending = f.context.runSearch('find');
    f.click(target); f.context.closeModal(); f.requests[0].resolve(f.results()); await pending;
    assert.strictEqual(f.modals.length, 0);
  }
});
test('opening another dialog cancels pending search', async () => {
  const f = fixture(); const pending = f.context.runSearch('find'); f.modalOpened();
  f.requests[0].resolve(f.results()); await pending; assert.strictEqual(f.modals.length, 0);
});
test('project switch, reopen and close each discard their old response', async () => {
  for (const mutate of [f => { f.context.ACTIVE_PROJECT_SLUG = 'synthetic-b'; }, f => { f.context.PROJECT_OPEN_EPOCH++; }, f => { f.context.P = null; }]) {
    const f = fixture(); const pending = f.context.runSearch('find'); mutate(f);
    f.requests[0].resolve(f.results('OLD PROJECT')); await pending; assert.strictEqual(f.modals.length, 0);
  }
});
test('a query queued in another project is never dispatched', () => {
  const f = fixture(); f.input.value = 'find'; f.inputEvent(); f.context.PROJECT_OPEN_EPOCH++;
  f.flushTimers(); assert.strictEqual(f.requests.length, 0);
});
test('route changes discard pending results even after returning to the original route', async () => {
  const f = fixture(); const pending = f.context.runSearch('find');
  f.navigate('#/bible/project'); f.navigate('#/shots/board');
  f.requests[0].resolve(f.results()); await pending; assert.strictEqual(f.modals.length, 0);
});
test('current network failures are actionable and stale failures stay silent', async () => {
  const f = fixture(); const pending = f.context.runSearch('find');
  f.requests[0].reject(new Error('offline')); await pending;
  assert.deepStrictEqual(f.messages, ['Search could not reach CineBraid. Try again.']);
  const stale = f.context.runSearch('later'); f.key('Escape');
  f.requests[1].reject(new Error('offline')); await stale; assert.strictEqual(f.messages.length, 1);
});
test('server refusal is shown without rendering a false empty result list', async () => {
  const f = fixture(); const pending = f.context.runSearch('find');
  f.requests[0].resolve({ ok: false, json: async () => ({ error: 'The production could not be read.' }) }); await pending;
  assert.deepStrictEqual(f.messages, ['The production could not be read.']); assert.strictEqual(f.modals.length, 0);
});
test('a malformed response stays a recoverable search failure', async () => {
  const f = fixture(); const pending = f.context.runSearch('find');
  f.requests[0].resolve({ ok: true, json: async () => null }); await pending;
  assert.deepStrictEqual(f.messages, ['Search is unavailable right now.']); assert.strictEqual(f.modals.length, 0);
});
test('no project and empty queries make no request', async () => {
  const f = fixture(); await f.context.runSearch('  '); f.context.P = null; await f.context.runSearch('find');
  assert.strictEqual(f.requests.length, 0);
});
test('known destinations encode ids; unsupported records are readable non-links', async () => {
  const f = fixture(); const pending = f.context.runSearch('<find>');
  const types = ['bible', 'scene', 'shot', 'character', 'location', 'prop', 'vehicle', 'audio', 'style', 'session', '__proto__'];
  f.requests[0].resolve({ ok: true, json: async () => ({ results: types.map(type => ({ type, id: 'A/B?#"', title: '<Title>', snippet: '<text>' })) }) });
  await pending; const html = f.modals[0];
  assert(html.includes('<h3>Search production</h3>')); assert(html.includes('&lt;find&gt;'));
  assert(html.includes('href="#/bible/A%2FB%3F%23%22"'));
  for (const route of ['scene','shot','character','location','prop','vehicle','sound']) assert(html.includes('href="#/'+route+'/A%2FB%3F%23%22"'));
  assert(html.includes('href="#/settings"')); assert(html.includes('Open in Settings'));
  assert.strictEqual((html.match(/<a class="qc-item"/g) || []).length, 9);
  assert.strictEqual((html.match(/Search excerpt · no separate workspace/g) || []).length, 2);
  assert(!html.includes('href="#"')); assert(!html.includes('<Title>')); assert(html.includes('&lt;Title&gt;'));
});

(async () => {
  for (const [name, run] of cases) { await run(); console.log('PASS ' + name); }
  console.log('PASS global search behavior: ' + cases.length + ' cases');
})().catch(error => { console.error(error); process.exitCode = 1; });

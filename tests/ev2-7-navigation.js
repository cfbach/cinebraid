/* EV2-7 — ONE contextual return. A realistic VM harness for public/media-return.js.

   It loads the shipped coordinator together with the shipped Results Desk, Working Bible
   and Reference Desk scripts, and drives them through a small DOM whose event order is the
   browser's: a location.hash assignment fires hashchange (with oldURL/newURL) on a later task;
   history.replaceState changes the hash silently; a click runs window and document capture
   listeners, then the inline handler and the target's own listeners, then document and window
   bubble listeners, and only then activates an a[href]. requestAnimationFrame and setTimeout
   run from one task queue. The Media Inspector is represented by the exact two calls it makes
   (capture when it opens, go when an owner is chosen).

   No app config, projects root, server, provider or network is read or written here. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const BASE = 'http://fixture.invalid/';

/* ---------------------------------------------------------------- a small DOM */
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source']);
const kebab = key => key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function splitTop(text, separator) {
  const out = []; let depth = 0, quote = '', token = '';
  for (const ch of text) {
    if (quote) { token += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; token += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && (separator === ' ' ? /\s/.test(ch) : ch === separator)) { out.push(token); token = ''; continue; }
    token += ch;
  }
  out.push(token);
  return out.map(x => x.trim()).filter(Boolean);
}
function compound(text) {
  if (/[>+~]/.test(text.replace(/"[^"]*"|'[^']*'/g, ''))) throw Error('unsupported selector combinator in ' + text);
  const c = { tag: '', id: '', classes: [], attrs: [], nots: [] }; let rest = text;
  const take = re => { const m = rest.match(re); if (m) rest = rest.slice(m[0].length); return m; };
  let m = take(/^[a-zA-Z][a-zA-Z0-9-]*|^\*/); if (m && m[0] !== '*') c.tag = m[0].toUpperCase();
  while (rest) {
    if ((m = take(/^#([\w-]+)/))) c.id = m[1];
    else if ((m = take(/^\.([\w-]+)/))) c.classes.push(m[1]);
    else if ((m = take(/^\[([\w-]+)(?:([\^]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/))) c.attrs.push({ name: m[1], op: m[2] || '', value: m[3] ?? m[4] ?? m[5] ?? '' });
    else if ((m = take(/^:not\(/))) { let depth = 1, i = 0; for (; i < rest.length && depth; i++) { if (rest[i] === '(') depth++; if (rest[i] === ')') depth--; } c.nots.push(compound(rest.slice(0, i - 1))); rest = rest.slice(i); }
    else throw Error('unsupported selector part: ' + rest);
  }
  return c;
}
function matchCompound(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  if (c.classes.some(name => !el.classList.contains(name))) return false;
  for (const a of c.attrs) { const v = el.getAttribute(a.name); if (v == null) return false; if (a.op === '=' && v !== a.value) return false; if (a.op === '^=' && !v.startsWith(a.value)) return false; }
  return !c.nots.some(n => matchCompound(el, n));
}
function matchesSelector(el, selector) {
  return splitTop(selector, ',').some(complex => {
    const parts = splitTop(complex, ' ').map(compound);
    if (!matchCompound(el, parts[parts.length - 1])) return false;
    let node = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) { while (node && !matchCompound(node, parts[i])) node = node.parentNode; if (!node) return false; node = node.parentNode; }
    return true;
  });
}
class TextNode { constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } remove() { detach(this); } }
function detach(node) { if (node.parentNode) { const list = node.parentNode.childNodes; list.splice(list.indexOf(node), 1); node.parentNode = null; } }
class Element {
  constructor(tag) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attributes = new Map(); this.childNodes = []; this.parentNode = null; this.listeners = []; this.scrollTop = 0; this.focusCount = 0;
    const self = this;
    this.dataset = new Proxy({}, { get: (_, k) => typeof k === 'string' ? (self.getAttribute('data-' + kebab(k)) ?? undefined) : undefined, set: (_, k, v) => { self.setAttribute('data-' + kebab(k), String(v)); return true; }, has: (_, k) => self.hasAttribute('data-' + kebab(k)) });
    this.classList = { contains: c => (self.getAttribute('class') || '').split(/\s+/).includes(c), add: (...cs) => cs.forEach(c => { if (!self.classList.contains(c)) self.setAttribute('class', ((self.getAttribute('class') || '') + ' ' + c).trim()); }), remove: (...cs) => self.setAttribute('class', (self.getAttribute('class') || '').split(/\s+/).filter(x => x && !cs.includes(x)).join(' ')), toggle: (c, force) => { const on = force === undefined ? !self.classList.contains(c) : !!force; if (on) self.classList.add(c); else self.classList.remove(c); return on; } };
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  get id() { return this.getAttribute('id') || ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
  get type() { return this.getAttribute('type') || ''; } set type(v) { this.setAttribute('type', v); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const list = this.parentNode?.childNodes; return list ? list[list.indexOf(this) + 1] || null : null; }
  get isConnected() { let node = this; while (node.parentNode) node = node.parentNode; return node === documentElement; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (v !== '') this.append(String(v)); }
  set innerHTML(html) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; parseInto(this, String(html)); }
  adopt(nodes) { return nodes.map(n => { if (typeof n === 'string') n = new TextNode(n); detach(n); n.parentNode = this; return n; }); }
  append(...nodes) { this.childNodes.push(...this.adopt(nodes)); }
  appendChild(node) { this.append(node); return node; }
  prepend(...nodes) { this.childNodes.unshift(...this.adopt(nodes)); }
  after(...nodes) { const parent = this.parentNode; const adopted = parent.adopt(nodes); parent.childNodes.splice(parent.childNodes.indexOf(this) + 1, 0, ...adopted); }
  remove() { detach(this); }
  descendants() { const out = []; const walk = node => node.children.forEach(child => { out.push(child); walk(child); }); walk(this); return out; }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) { let node = this; while (node && node.nodeType === 1) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { return this.descendants().filter(el => el.matches(selector)); }
  querySelector(selector) { return this.descendants().find(el => el.matches(selector)) || null; }
  addEventListener(type, fn) { this.listeners.push({ type, fn }); }
  focus() { document.activeElement = this; this.focusCount++; }
  blur() { if (document.activeElement === this) document.activeElement = document.body; }
  setSelectionRange() {}
  scrollIntoView() {}
}
function parseInto(root, html) {
  let current = root; const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g; let m;
  while ((m = re.exec(html))) {
    if (m[1]) { let node = current; while (node !== root && node.tagName !== m[1].toUpperCase()) node = node.parentNode; if (node !== root) current = node.parentNode; }
    else if (m[2]) {
      const el = new Element(m[2]); const attrRe = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
      while ((a = attrRe.exec(m[3] || ''))) el.setAttribute(a[1], unescape(a[2] ?? a[3] ?? a[4] ?? ''));
      current.append(el); if (!VOID.has(m[2].toLowerCase())) current = el;
    } else if (m[4]) current.append(unescape(m[4]));
  }
}
const documentElement = new Element('html'), body = new Element('body'); documentElement.append(body);
const docListeners = [];
const document = { documentElement, body, activeElement: body,
  addEventListener(type, fn, options) { docListeners.push({ type, fn, capture: options === true || !!options?.capture }); },
  getElementById(id) { return documentElement.descendants().find(el => el.id === id) || null; },
  querySelector: selector => documentElement.querySelector(selector), querySelectorAll: selector => documentElement.querySelectorAll(selector),
  createElement: tag => new Element(tag) };

/* ------------------------------------------------ one task queue, one event order */
const tasks = [], frames = [], winListeners = [];
let clock = 1000;
const performance = { now: () => clock };
function setTimeout(fn) { tasks.push(fn); return tasks.length; }
function requestAnimationFrame(fn) { frames.push(fn); return frames.length; }
async function flush() {
  for (let i = 0; i < 500; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (tasks.length) { tasks.shift()(); continue; }
    if (frames.length) { frames.splice(0).forEach(fn => fn()); continue; }
    await new Promise(resolve => setImmediate(resolve));
    if (!tasks.length && !frames.length) return;
  }
  throw Error('the harness event loop did not settle');
}
/* Window has no event path, and Chromium runs its listeners in REGISTRATION order, capture or not (proven with a
   bubble listener registered before a capture one: bubble ran first). app.js registers hashchange → route before
   media-return.js loads, so a synchronous route renders and dispatches cinebraid:route-rendered BEFORE the
   coordinator's hashchange listener runs. 'phase' (capture first) models an asynchronous route, whose render lands
   after that listener. Every journey runs under both. */
let windowOrder = 'phase';
function dispatchWindow(event) {
  const listeners = winListeners.filter(l => l.type === event.type);
  if (windowOrder === 'registration' && event.type === 'hashchange') return listeners.slice().forEach(l => l.fn(event));
  for (const phase of [true, false]) listeners.filter(l => l.capture === phase).forEach(l => l.fn(event));
}
const location = { _hash: '#/production',
  get hash() { return this._hash; },
  set hash(value) { value = String(value); if (!value.startsWith('#')) value = '#' + value; if (value === this._hash) return; const oldURL = BASE + this._hash, newURL = BASE + value; this._hash = value; tasks.push(() => dispatchWindow({ type: 'hashchange', oldURL, newURL })); },
  get href() { return BASE + this._hash; } };
const history = { state: null, replaceState(state, title, url) { location._hash = String(url); } };
const context = { console, URL, Promise, setImmediate, queueMicrotask, document, location, history, performance, setTimeout, clearTimeout() {}, requestAnimationFrame,
  CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  addEventListener(type, fn, options) { winListeners.push({ type, fn, capture: options === true || !!options?.capture }); },
  dispatchEvent(event) { dispatchWindow(event); return true; },
  scrollX: 0, scrollY: 0, scrollTo(x, y) { context.scrollX = x; context.scrollY = y; },
  // reference-desk.css makes #main a flex row on the Reference Desk and its tools page; the fixture routes record that here.
  getComputedStyle: el => ({ display: el.getAttribute('data-fixture-display') || 'block', flexDirection: 'row' }),
  matchMedia: () => ({ matches: false, addEventListener() {} }) };
context.window = context;
async function click(el, { focus = true } = {}) {
  assert.ok(el, 'the control to press exists');
  if (focus) el.focus();
  let prevented = false, stopped = false;
  const event = { type: 'click', target: el, get defaultPrevented() { return prevented; }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } };
  winListeners.filter(l => l.type === 'click' && l.capture).slice().forEach(l => l.fn(event));
  docListeners.filter(l => l.type === 'click' && l.capture).slice().forEach(l => l.fn(event));
  const inline = el.getAttribute('onclick');
  if (inline) { context.__el = el; context.__event = event; vm.runInContext('(function(event){' + inline + '}).call(__el,__event)', context); }
  el.listeners.filter(l => l.type === 'click').forEach(l => l.fn(event));
  if (!stopped) docListeners.filter(l => l.type === 'click' && !l.capture).slice().forEach(l => l.fn(event));   // a stopped event never bubbles to document or window
  if (!stopped) winListeners.filter(l => l.type === 'click' && !l.capture).slice().forEach(l => l.fn(event));
  if (el.matches('a[href]') && !prevented) { const href = el.getAttribute('href'); if (href.startsWith('#')) location.hash = href; }
  await flush();
}

/* ------------------------------------------------- the app seams media-return.js uses */
const SHOT = { id: 'SH010', title: 'The signal', scene: 'SC1', keyframes: [{ id: 'A', label: 'A' }] };
Object.assign(context, {
  ACTIVE_PROJECT_SLUG: 'synthetic-film', PROJECT_OPEN_EPOCH: 1, PROJECT_REVISION: 'r1', CURRENT_RENDER_ROUTE_KEY: '',
  ENTITY_ROUTE: { characters: 'character', locations: 'location', props: 'prop', vehicles: 'vehicle', audio: 'sound' },
  P: { meta: { title: 'Synthetic film' }, characters: [{ id: 'KAI', name: 'Kai' }, { id: 'MARA', name: 'Mara' }], locations: [], props: [], vehicles: [], audio: [], shots: [SHOT], scenes: [{ id: 'SC1', title: 'Scene One' }] },
  esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  shotById: id => (id === SHOT.id ? SHOT : null), sceneById: id => (id === 'SC1' ? { id: 'SC1', title: 'Scene One' } : null),
  SAVE_BLOCKED: false, PROJECT_CONFLICT: false, PROJECT_QUARANTINE: false, AUTHORITY_SAVE_REFUSED: false, saveTimer: null,
  projectSaveSettled: () => ({ settled: true }), paintProjectSaveState() {}, entityVisualDescription: () => '', shotDependencyRecords: () => [],
  entityStateListRead: () => [{ id: 'default', name: 'Default', isDefault: true }], entityCandidateTargetStateId: () => 'default', entityCandidateRow: () => null, currentHumanAuthority: () => null,
  returnedReviewProjectionForBrowser: () => ({ items: [] }), routeReviewClaim: () => '', shotCandidateRowFor: () => null,
  openGuidedPanel() {}, clickGuidedUpload() {}, selectEntityResultTask() {}, boundedWriteState() {}, toast() {},
  CineBraidReferenceMedia: { listing: () => [], coverage: () => ({ filled: 0, required: 0 }), requiredSlots: () => [] },
  CineBraidMediaInspector: { projection: () => ({ records: [], unresolvedReferences: [] }) },
  fetch: async () => ({ ok: true, json: async () => ({ entities: [] }), headers: { get: () => context.ACTIVE_PROJECT_SLUG } }),
});
context.attr = context.esc;
const shell = new Element('div'); shell.id = 'app'; body.append(shell);
parseInto(shell, '<aside id="rail"><button id="project-title" onclick="void 0">Synthetic film</button><div id="project-menu"><button id="menu-switch" onclick="location.hash=\'#/settings\'">Switch project</button></div><nav id="nav"><button class="nav-btn" data-view="shots" onclick="location.hash=\'#/shots\'">Shots</button></nav></aside><section id="workspace"><header id="topbar"><div id="topbar-view">Production</div><button id="global-add">Add</button></header><main id="main"></main><aside id="cb-shell-rail"><a id="rail-link" href="#/character/MARA">Mara</a></aside></section><div id="modal" class="modal hidden"></div>');
const main = document.getElementById('main'), modal = document.getElementById('modal');
context.openModal = html => { modal.innerHTML = '<div class="modal-box">' + html + '</div>'; modal.classList.remove('hidden'); };
context.updateOpenModal = context.openModal;
context.closeModal = () => { modal.innerHTML = ''; modal.classList.add('hidden'); };
const selectorFor = el => !el || el === body ? '' : el.id ? '#' + el.id : el.getAttribute('data-focus-key') ? '[data-focus-key="' + el.getAttribute('data-focus-key') + '"]' : el.getAttribute('onclick') ? el.tagName.toLowerCase() + '[onclick="' + el.getAttribute('onclick') + '"]' : '';
context.currentRouteKey = () => context.ACTIVE_PROJECT_SLUG + ':' + (location.hash.split('?')[0] || '#/production');
let viewSerial = 0, restoreToken = 0;
const restoreCalls = [];
context.captureRouteViewState = (key = context.currentRouteKey()) => context.CURRENT_RENDER_ROUTE_KEY === key ? { id: ++viewSerial, routeKey: key, selector: selectorFor(document.activeElement), mainScrollTop: main.scrollTop, windowX: context.scrollX, windowY: context.scrollY } : null;
function applyView(state) {
  const token = ++restoreToken; main.scrollTop = state.mainScrollTop; context.scrollTo(state.windowX, state.windowY);
  requestAnimationFrame(() => requestAnimationFrame(() => { if (token !== restoreToken || context.currentRouteKey() !== state.routeKey) return; const target = state.selector && document.querySelector(state.selector); if (target) target.focus(); }));
}
context.restoreRouteViewState = state => { if (!state) return; restoreCalls.push(state); applyView(state); };

/* The routes the journeys cross. Results and the Working Bible are the shipped renderers. */
let refuse = null;
function render(hash) {
  const p = hash.split('?')[0].split('/');
  if (p[1] === 'shot' && p[3] === 'review') return '<section class="shot-desk" data-shot-desk><header class="sd-context"><nav class="sd-crumb"><a href="#/production">Production</a><span>SH010</span></nav><h1 id="sd-heading">The signal</h1><span class="sd-frame">Frame A · Wide</span></header><a id="sd-ref" href="#/character/KAI">Kai reference</a><button id="sd-noop">Zoom</button></section>';
  if (p[1] === 'shot' && p[3] === 'results' || p[3] === 'results') return context.CineBraidResults.view();
  if (p[1] === 'shot') return '<section class="shot-page"><h1>The signal</h1><a id="shot-ref" href="#/character/KAI">Kai</a><button id="noop">Expand</button><button id="open-results" onclick="CineBraidResults.open({shotId:\'SH010\',kind:\'frame\',frameId:\'A\'})">Frame A Results</button></section>';
  if (/^(character|location|prop|vehicle)$/.test(p[1]) && p[3] === 'tools') return referenceTools('characters', p[2]) + '<div class="bounded-entity-page clarity-entity-page" data-bounded-entity="1"><div class="crumb"><a href="#/library/characters">References</a> / ' + p[2] + '</div><header class="entity-clarity-head"><h1 id="rd-title">' + (p[2] === 'MARA' ? 'Mara' : 'Kai') + ' tools</h1></header><a id="rd-other" href="#/character/MARA">Mara</a></div></div>';
  if (/^(character|location|prop|vehicle)$/.test(p[1])) return '<section class="reference-desk" data-reference-desk><nav class="rd-crumb"><a href="#/production">Production</a><a id="crumb-references" href="#/library/characters">References</a></nav><span data-return-slot></span><h1 id="rd-title">' + (p[2] === 'MARA' ? 'Mara' : 'Kai') + (p[3] === 'tools' ? ' tools' : '') + '</h1><button id="rd-results" onclick="CineBraidResults.open({list:\'characters\',id:\'' + p[2] + '\',stateId:\'default\',slotId:\'\'})">Review results</button><a id="rd-tools" href="#/character/' + p[2] + '/tools">Tools</a><a id="rd-other" href="#/character/MARA">Mara</a><button id="rd-choose">Choose from production media</button></section>';
  if (p[1] === 'bible') return context.CineBraidWorkingBible.view() + '<p class="fixture-plain"><a href="#/character/MARA">Mara, from a Bible link with no id</a></p>';
  if (p[1] === 'results') return '<section class="production-contact-sheet" data-md="production"><h1>Production media</h1><button data-md-open="media:1">Card one</button><button id="md-2" data-md-open="media:2">Card two</button></section>';
  if (p[1] === 'library') return '<section class="rd-library" data-reference-library><h1>References</h1></section>';
  return '<section><h1>' + (p[1] || 'production') + '</h1></section>';
}
context.route = () => {
  if (refuse && refuse(location.hash)) return Promise.resolve();
  const key = context.currentRouteKey(), state = context.CURRENT_RENDER_ROUTE_KEY === key ? context.captureRouteViewState(key) : null;
  main.setAttribute('data-fixture-display', /^#\/(character|location|prop|vehicle)\//.test(location.hash) ? 'flex' : 'block');
  main.innerHTML = render(location.hash);
  if (!document.activeElement.isConnected) document.activeElement = body;
  if (state) applyView(state); else { main.scrollTop = 0; context.scrollTo(0, 0); }
  context.CURRENT_RENDER_ROUTE_KEY = key;
  dispatchWindow({ type: 'cinebraid:route-rendered', detail: {} });
  return Promise.resolve();
};
context.addEventListener('hashchange', () => context.route());
context.CineBraidResults = {};
vm.createContext(context);
/* The Reference tools page is rendered from the shipped entities.js prefix, so a slot or a column placement is real. */
const referenceTools = (() => {
  const template = read('public/entities.js').match(/const toolsPrefix = location\.hash\.endsWith\("\/tools"\) \? (`[^`]*`) : "";/);
  assert.ok(template, 'entities.js still renders the Reference tools prefix');
  return vm.runInContext('(function(list,id){return ' + template[1] + ';})', context);
})();
for (const file of ['public/media-return.js', 'public/reference-desk.js', 'public/working-bible.js', 'public/results-desk.js']) vm.runInContext(read(file), context, { filename: file });
const api = context.CineBraidMediaReturn;
const returns = () => document.querySelectorAll('[data-media-return]');
const returnLabel = () => { const all = returns(); assert.strictEqual(all.length <= 1, true, `never more than one return control, found ${all.length}`); return all[0] ? all[0].querySelector('.cb-return-label').textContent.replace(/^← /, '') : null; };
async function go(hash) { location.hash = hash; await flush(); }
async function reset(hash = '#/production') { refuse = null; api.cancel(); context.closeModal(); await go(hash); await go('#/settings/reset'); api.cancel(); await go(hash); clock += 5000; }
const inspectorOpen = options => api.capture({ resume: options?.resume });                 // media-inspector.js inspect()/inspectInventory()
const inspectorOwner = (hash, origin) => api.go(hash, origin || api.capture());           // media-inspector.js owner()

(async () => {
  const cases = [];
  const test = (name, fn) => cases.push([name, fn]);

  test('1 · Production Media → Inspector → owner keeps "Return to Production Media" across a silent result-key change', async () => {
    await reset('#/results');
    const card = main.querySelector('[data-md-open="media:1"]'); card.focus(); main.scrollTop = 420;
    const origin = inspectorOpen();
    context.openModal('<div data-media-inspector><button data-mi-action="open-owner">Review in Frame Results</button></div>');
    inspectorOwner('#/shot/SH010/review/key-one', origin); await flush();
    assert.strictEqual(returnLabel(), 'Return to Production Media');
    history.replaceState(null, '', '#/shot/SH010/review/key-two'); await context.route(); await flush();
    assert.strictEqual(returns().length, 1, 'a replaceState key change keeps exactly one return');
    assert.strictEqual(returnLabel(), 'Return to Production Media');
    history.replaceState(null, '', '#/shot/SH010/results/frame/A/key-three'); await context.route(); await flush();   // choosing a result from the review
    assert.strictEqual(returns().length, 1, 'choosing a result keeps exactly one return');
    assert.strictEqual(returnLabel(), 'Return to Production Media');
    assert.strictEqual(document.getElementById('rx-origin')?.textContent, 'Open shot', 'a Production Media origin leaves the plain shot target in place');
    const before = restoreCalls.length, focusBefore = card.focusCount;
    await click(returns()[0]);
    assert.strictEqual(location.hash, '#/results');
    assert.strictEqual(returns().length, 0, 'the completed return is popped on arrival');
    assert.strictEqual(restoreCalls.length - before, 1, 'the coordinator restores the origin view once');
    assert.strictEqual(restoreCalls[restoreCalls.length - 1], origin.view, 'with the exact captured view');
    assert.strictEqual(main.scrollTop, 420, 'main scroll is restored');
    const reopened = main.querySelector('[data-md-open="media:1"]');
    assert.strictEqual(document.activeElement, reopened, 'focus returns to the exact card that opened the Inspector');
    assert.strictEqual(reopened.focusCount, 1, 'exact-opener focus is applied once');
    assert.ok(focusBefore >= 1);
  });

  test('2 · Bible → Reference → Results → Inspector → owner unwinds in order with one control each time', async () => {
    await reset('#/bible/characters/KAI'); await flush();
    assert.ok(main.querySelector('#wb-open-reference'), 'the shipped Bible renders its reference link');
    main.scrollTop = 310;
    await click(main.querySelector('#wb-open-reference'));
    assert.strictEqual(location.hash, '#/character/KAI');
    assert.strictEqual(returnLabel(), 'Return to Working Bible');
    assert.strictEqual(returns()[0].parentNode.hasAttribute('data-return-slot'), true, 'placed in the desk return slot');
    await click(main.querySelector('#rd-results'));
    assert.strictEqual(location.hash, '#/character/KAI/results/default/-/-');
    assert.strictEqual(returnLabel(), 'Return to Kai', 'Results names the reference it came from');
    assert.strictEqual(document.getElementById('rx-origin'), null, 'with a trail, Results shows no second origin control');
    assert.ok(returns()[0].parentNode.hasAttribute('data-return-slot'), 'Results places the return in its head slot');
    const opener = main.querySelector('#rx-screen') || main.querySelector('#rx-heading'); opener.focus();
    const origin = inspectorOpen();
    inspectorOwner('#/shot/SH010/review/key-one', origin); await flush();
    assert.strictEqual(returnLabel(), 'Return to Results');
    await click(returns()[0]);
    assert.strictEqual(location.hash, '#/character/KAI/results/default/-/-');
    assert.strictEqual(returnLabel(), 'Return to Kai');
    assert.strictEqual(document.getElementById('rx-origin'), null, 'arriving back at Results renders no stacked origin control');
    await click(returns()[0]);
    assert.strictEqual(location.hash, '#/character/KAI');
    assert.strictEqual(returnLabel(), 'Return to Working Bible');
    await click(returns()[0]);
    await flush();
    assert.strictEqual(location.hash, '#/bible/characters/KAI');
    assert.strictEqual(returns().length, 0, 'the trail is fully unwound');
    assert.strictEqual(document.activeElement.id, 'wb-open-reference', 'focus returns to the Bible link that started the journey');
    assert.strictEqual(main.scrollTop, 310, 'the Bible scroll position is restored');
  });

  test('3 · Browser Back to the recorded origin pops it', async () => {
    await reset('#/bible/characters/KAI'); await flush();
    await click(main.querySelector('#wb-open-reference'));
    assert.strictEqual(returnLabel(), 'Return to Working Bible');
    const before = restoreCalls.length;
    await go('#/bible/characters/KAI');   // history.back(): a hashchange to the origin
    assert.strictEqual(returns().length, 0);
    assert.strictEqual(api.hasOrigin(), false);
    assert.strictEqual(restoreCalls.length - before >= 1, true, 'Back restores the origin view');
    await go('#/character/KAI');
    assert.strictEqual(returns().length, 0, 'Forward is direct navigation and invents nothing');
  });

  test('4 · A stale non-navigating click never becomes a return for later Back or address-bar navigation', async () => {
    await reset('#/shot/SH010');
    await click(main.querySelector('#noop'));
    await go('#/character/KAI');
    assert.strictEqual(returns().length, 0, 'address-bar navigation after a non-navigating shot click invents no return');
    await reset('#/bible/characters/KAI'); await flush();
    await click(main.querySelector('[data-wb="find"]'));
    await go('#/character/KAI');
    assert.strictEqual(returns().length, 0, 'address-bar navigation after a non-navigating Bible click invents no return');
    await reset('#/shot/SH010');
    await click(main.querySelector('#shot-ref'));
    assert.strictEqual(returnLabel(), 'Return to SH010 · The signal', 'an actual reference link from the shot does create one');
    clock += 5000;
  });

  test('5 · Browsing inside the Bible makes no entry', async () => {
    await reset('#/bible/characters/KAI'); await flush();
    const row = main.querySelector('a[href="#/bible/characters/MARA"]');
    assert.ok(row, 'the shipped Bible index lists Mara');
    await click(row);
    assert.strictEqual(location.hash, '#/bible/characters/MARA');
    assert.strictEqual(returns().length, 0, 'no "Return to Working Bible" while still in the Bible');
    await click(main.querySelector('#wb-open-reference'));
    assert.strictEqual(returnLabel(), 'Return to Working Bible');
    await click(returns()[0]);
    assert.strictEqual(location.hash, '#/bible/characters/MARA', 'the return goes to the exact Bible entry');
  });

  test('6 · A search result ([data-global-navigation]) clears the trail', async () => {
    await reset('#/bible/characters/KAI'); await flush();
    await click(main.querySelector('#wb-open-reference'));
    assert.strictEqual(returnLabel(), 'Return to Working Bible');
    context.openModal('<div data-global-navigation><h3>Search</h3><a class="qc-item" id="search-mara" href="#/character/MARA" onclick="closeModal()">Mara</a><button class="cancel" onclick="closeModal()">Close</button></div>');
    await click(modal.querySelector('#search-mara'));
    assert.strictEqual(location.hash, '#/character/MARA');
    assert.strictEqual(returns().length, 0);
    assert.strictEqual(api.hasOrigin(), false);
    await reset('#/bible/characters/KAI'); await flush();
    context.openModal('<div data-global-navigation><a id="search-kai" href="#/character/KAI" onclick="closeModal()">Kai</a></div>');
    await click(modal.querySelector('#search-kai'));
    assert.strictEqual(returns().length, 0, 'search from the Bible is not a Bible handoff');
    await reset('#/shot/SH010');
    context.openModal('<div class="global-add-modal"><button id="add-character" onclick="closeModal();location.hash=\'#/character/MARA\'">Character</button></div>');
    await click(modal.querySelector('#add-character'));
    assert.strictEqual(returns().length, 0, 'a Global Add choice is global navigation');
    await reset('#/bible/characters/KAI'); await flush();
    await click(main.querySelector('#wb-open-reference'));
    context.openModal('<div data-global-navigation><button class="cancel" id="search-close" onclick="closeModal()">Close</button></div>');
    await click(modal.querySelector('#search-close'));
    assert.strictEqual(returnLabel(), 'Return to Working Bible', 'dismissing search keeps the return');
    document.getElementById('cb-shell-rail').innerHTML = '<a id="rail-link" href="#/character/MARA">Mara</a>';   // this journey replaces the rail below
    await click(document.getElementById('rail-link'));
    assert.strictEqual(returns().length, 0, 'a Braidy rail link is global navigation');
    await reset('#/bible/characters/KAI'); await flush();
    const rail = document.getElementById('cb-shell-rail');
    rail.innerHTML = '<button id="rail-handoff" onclick="CineBraidMediaReturn.prepare(CineBraidMediaReturn.capture());location.hash=\'#/character/MARA\'">Open Mara</button>';
    await click(document.getElementById('rail-handoff'));
    assert.strictEqual(location.hash, '#/character/MARA');
    assert.strictEqual(returns().length, 0, 'a handoff pressed in the Braidy rail is still global navigation');
  });

  test('7 · #nav and the project menu clear; opening #project-title alone does not', async () => {
    await reset('#/bible/characters/KAI'); await flush();
    await click(main.querySelector('#wb-open-reference'));
    await click(document.getElementById('project-title'));
    assert.strictEqual(returnLabel(), 'Return to Working Bible', 'opening the project menu is not navigation');
    await click(document.querySelector('#nav .nav-btn'));
    assert.strictEqual(location.hash, '#/shots');
    assert.strictEqual(returns().length, 0);
    assert.strictEqual(api.hasOrigin(), false);
  });

  test('8 · A project epoch or slug change invalidates the trail and a pending return', async () => {
    await reset('#/bible/characters/KAI'); await flush();
    await click(main.querySelector('#wb-open-reference'));
    assert.ok(api.hasOrigin());
    const before = restoreCalls.length, epoch = context.PROJECT_OPEN_EPOCH;
    api.back();
    context.PROJECT_OPEN_EPOCH = epoch + 1;
    await flush();
    assert.strictEqual(restoreCalls.length, before, 'a pending return from the earlier open restores nothing');
    assert.strictEqual(api.hasOrigin(), false);
    assert.strictEqual(returns().length, 0, 'a reopened project shows no earlier return');
    assert.strictEqual(api.go('#/character/KAI', { slug: 'synthetic-film', epoch, hash: '#/bible/characters/KAI' }), false, 'an earlier open cannot push');
    await go('#/bible/characters/KAI'); await flush();
    await click(main.querySelector('#wb-open-reference'));
    assert.ok(api.hasOrigin());
    context.ACTIVE_PROJECT_SLUG = 'other-film'; await context.route(); await flush();
    assert.strictEqual(api.hasOrigin(), false, 'a different project cannot reuse the trail');
    assert.strictEqual(returns().length, 0);
    context.ACTIVE_PROJECT_SLUG = 'synthetic-film';
  });

  test('9 · A refused return keeps its entry and forgets the pending restore', async () => {
    await reset('#/shot/SH010');
    await click(main.querySelector('#shot-ref'));
    const id = returns()[0].dataset.returnId;
    refuse = hash => { if (hash !== '#/shot/SH010') return false; location.hash = '#/character/KAI'; return true; };   // app.js puts the hash back
    const before = restoreCalls.length;
    await click(returns()[0]);
    assert.strictEqual(location.hash, '#/character/KAI', 'the refusal put the hash back');
    assert.strictEqual(returnLabel(), 'Return to SH010 · The signal', 'the entry survives the refusal');
    assert.strictEqual(returns()[0].dataset.returnId, id, 'as the same entry');
    assert.strictEqual(restoreCalls.length, before, 'nothing was restored for a refused return');
    refuse = null;
    await click(document.querySelector('#nav .nav-btn'));
    await go('#/shot/SH010');
    assert.strictEqual(restoreCalls.length, before, 'a later direct arrival replays no stale snapshot');
    assert.strictEqual(returns().length, 0);
    await go('#/character/KAI');
    assert.strictEqual(returns().length, 0);
    await go('#/shot/SH010');
    await click(main.querySelector('#shot-ref'));
    refuse = hash => { if (hash !== '#/shot/SH010') return false; location.hash = '#/character/KAI'; return true; };
    await click(returns()[0]);
    refuse = null;
    await click(returns()[0]);
    assert.strictEqual(location.hash, '#/shot/SH010', 'the kept entry still returns once navigation is allowed');
    assert.strictEqual(restoreCalls.length, before + 1);
  });

  test('10 · Shot ↔ Results round trips collapse instead of stacking', async () => {
    await reset('#/shot/SH010');
    await click(main.querySelector('#open-results'));
    assert.strictEqual(returnLabel(), 'Return to SH010 · The signal');
    assert.strictEqual(document.getElementById('rx-origin'), null);
    await click(main.querySelector('#rx-import'));
    assert.strictEqual(location.hash, '#/shot/SH010');
    assert.strictEqual(returnLabel(), 'Return to Results');
    await click(main.querySelector('#open-results'));
    assert.strictEqual(returnLabel(), 'Return to SH010 · The signal');
    await click(main.querySelector('#rx-import'));
    await click(main.querySelector('#open-results'));
    await click(returns()[0]);
    assert.strictEqual(location.hash, '#/shot/SH010');
    assert.strictEqual(returns().length, 0, 'one Return unwinds the whole ping-pong');
  });

  test('11 · A picker resume is labelled "Return to media selection" and resumed once', async () => {
    await reset('#/character/KAI');
    let resumed = 0;
    context.openModal('<div class="rd-picker"><button id="picker-card" data-md-inspect="media:9">Inspect</button></div>');
    modal.querySelector('#picker-card').focus();
    const origin = inspectorOpen({ resume: () => { resumed++; } });
    inspectorOwner('#/character/KAI/results/default/-/key', origin); await flush();
    assert.strictEqual(returnLabel(), 'Return to media selection');
    assert.strictEqual(document.getElementById('rx-origin'), null, 'no stacked "Open reference" beside the return');
    const before = restoreCalls.length;
    await click(returns()[0]);
    assert.strictEqual(location.hash, '#/character/KAI');
    assert.strictEqual(resumed, 1);
    assert.strictEqual(restoreCalls.length - before, 1);
    assert.strictEqual(returns().length, 0);
  });

  test('12 · Shot Desk review → reference keeps the scene and frame context', async () => {
    await reset('#/shot/SH010/review/key-one');
    await click(main.querySelector('#sd-ref'));
    assert.strictEqual(location.hash, '#/character/KAI');
    assert.strictEqual(returnLabel(), 'Return to SH010 · The signal');
    assert.strictEqual(returns()[0].querySelector('small').textContent, 'Scene One · Frame A · Wide');
    await click(main.querySelector('#rd-tools'));
    assert.strictEqual(returnLabel(), 'Return to SH010 · The signal', 'the same reference\'s tools keep the return');
    const tools = main.querySelector('[data-reference-tools]'), onTools = returns()[0];
    assert.ok(tools, 'the shipped tools markup rendered');
    assert.ok(onTools.parentNode.hasAttribute('data-return-slot') && onTools.closest('[data-reference-tools]') === tools, 'on tools the return sits in the tools slot');
    assert.ok(main.children.every(child => child !== onTools), 'never a column beside the tools pane in the flex-row #main');
    assert.strictEqual(tools.querySelector('.rd-tools-back').textContent, 'Open reference', 'the tools page names a plain parent target');
    assert.strictEqual([...main.querySelectorAll('a,button')].filter(el => /^\s*←/.test(el.textContent)).length, 1, 'exactly one back arrow on the tools page');
    await click(main.querySelector('#rd-other'));
    assert.strictEqual(returns().length, 0, 'a different reference is direct navigation');
    await reset('#/shot/SH010/review/key-one');
    await click(main.querySelector('#sd-ref'));
    await click(main.querySelector('#crumb-references'));
    assert.strictEqual(returns().length, 0, 'the References crumb is direct navigation');
  });

  test('13 · Placement: the desk slot, after the Shot Desk context, never a column beside #main', async () => {
    await reset('#/results');
    main.querySelector('[data-md-open="media:1"]').focus();
    inspectorOwner('#/shot/SH010/review/key-one', inspectorOpen()); await flush();
    const control = returns()[0], desk = main.querySelector('.shot-desk');
    assert.strictEqual(control.parentNode, desk, 'inside the Shot Desk');
    assert.strictEqual(desk.children[1], control, 'directly after its context header');
    assert.ok(main.children.every(child => child !== control), 'never a direct child of #main');
    control.focus();
    await context.route(); await flush();
    assert.strictEqual(returns().length, 1, 'a repaint keeps one control');
    assert.strictEqual(document.activeElement, returns()[0], 'a repaint keeps focus on the return control');
    assert.strictEqual(returns()[0].getAttribute('type'), 'button');
    // Fallbacks on the flex-row Reference #main: the tools pane without its slot, then an unknown page.
    await reset('#/shot/SH010');
    await click(main.querySelector('#shot-ref'));
    await click(main.querySelector('#rd-tools'));
    const pane = main.querySelector('[data-reference-tools]');
    pane.querySelector('[data-return-slot]').remove(); returns().forEach(el => el.remove());
    dispatchWindow({ type: 'cinebraid:route-rendered', detail: {} }); await flush();
    assert.strictEqual(returns()[0]?.parentNode, pane, 'without a slot the return goes inside the tools pane');
    main.innerHTML = '<div class="unknown-page"><h1>Kai tools</h1></div>';
    dispatchWindow({ type: 'cinebraid:route-rendered', detail: {} }); await flush();
    assert.strictEqual(returns()[0]?.parentNode, main.querySelector('.unknown-page'), 'a flex-row #main is never prepended into; its first child hosts the return');
    main.setAttribute('data-fixture-display', 'block'); main.innerHTML = '<div class="unknown-page"><h1>Kai tools</h1></div>';
    dispatchWindow({ type: 'cinebraid:route-rendered', detail: {} }); await flush();
    assert.strictEqual(returns()[0]?.parentNode, main, 'a block #main keeps the top of the page');
    clock += 5000;
  });

  test('14 · Restoration: one coordinator restore, exact opener focused once, Bible does not restore again', async () => {
    await reset('#/bible/characters/KAI'); await flush();
    const captured = [], capture = api.capture;
    api.capture = (...args) => { const saved = capture(...args); captured.push(saved); return saved; };   // the Bible hands its origin through this call
    await click(main.querySelector('#wb-open-reference'));
    api.capture = capture;
    assert.strictEqual(captured.length, 1, 'the Bible prepares one origin');
    assert.strictEqual(captured[0].view.selector, '#wb-open-reference', 'the captured view names the exact opener');
    const before = restoreCalls.length;
    let renders = 0; const count = () => { renders++; }; context.addEventListener('cinebraid:route-rendered', count);
    await click(returns()[0]);
    winListeners.splice(winListeners.findIndex(l => l.fn === count), 1);
    const restored = restoreCalls.slice(before);
    assert.strictEqual(restored.filter(state => state === captured[0].view).length, 1, 'the coordinator restores the captured view exactly once');
    assert.ok(restored.length <= renders, `no render restores the Bible view twice (${restored.length} restores over ${renders} renders)`);
    const opener = main.querySelector('#wb-open-reference');
    assert.strictEqual(document.activeElement, opener, 'focus is on the exact opener');
    assert.strictEqual(opener.focusCount, 1, 'the rendered opener is focused once');
    await reset('#/shot/SH010');
    await click(main.querySelector('#open-results'));
    const beforeResults = restoreCalls.length;
    await click(returns()[0]);
    assert.strictEqual(restoreCalls.length - beforeResults, 1, 'returning from Results restores once');
    const button = main.querySelector('#open-results');
    assert.strictEqual(document.activeElement, button, 'the exact Results opener is focused');
    assert.strictEqual(button.focusCount, 1, 'and focused exactly once');
  });

  test('15 · A Bible opener with no id still gets focus back after the resume', async () => {
    await reset('#/bible/characters/KAI'); await flush();
    const plain = main.querySelector('.fixture-plain a');
    await click(plain);
    assert.strictEqual(location.hash, '#/character/MARA');
    assert.strictEqual(returnLabel(), 'Return to Working Bible');
    await click(returns()[0]); await flush();
    assert.strictEqual(location.hash, '#/bible/characters/KAI');
    const reopened = main.querySelector('.fixture-plain a');
    assert.notStrictEqual(document.activeElement, body, 'focus is not left on the body');
    assert.strictEqual(document.activeElement, reopened, 'focus returns to the exact id-less opener');
    assert.strictEqual(reopened.focusCount, 1, 'and is applied once');
  });

  test('16 · A stopped or same-hash press leaves nothing armed for a later Back', async () => {
    await reset('#/character/KAI');
    await go('#/shot/SH010');
    const stop = document.createElement('button'); stop.id = 'stopped'; stop.setAttribute('onclick', 'event.stopPropagation()');
    main.querySelector('.shot-page').append(stop);
    await click(stop);
    await go('#/character/KAI');   // browser Back inside the arm window
    assert.strictEqual(returns().length, 0, 'a press that stopped propagation invents no "Return to shot" on Back');
    assert.strictEqual(api.hasOrigin(), false);
    await reset('#/bible/characters/KAI'); await flush();
    const captured = [], capture = api.capture;
    api.capture = (...args) => { const saved = capture(...args); captured.push(saved); return saved; };
    await click(main.querySelector('#wb-open-reference'));
    api.capture = capture;
    assert.strictEqual(returnLabel(), 'Return to Working Bible');
    context.openModal('<div data-global-navigation><a id="search-same" href="#/character/KAI" onclick="closeModal()">Kai</a></div>');
    await click(modal.querySelector('#search-same'));   // the current hash: no hashchange
    assert.strictEqual(returnLabel(), 'Return to Working Bible', 'a search result naming the current page keeps the return');
    const before = restoreCalls.length;
    await go('#/bible/characters/KAI');   // browser Back to the recorded origin
    assert.strictEqual(restoreCalls.slice(before).filter(state => state === captured[0].view).length, 1, 'Back still pops and restores the origin instead of spending a stale global intent');
    assert.strictEqual(returns().length, 0);
  });

  test('17 · Chromium order: the destination renders before the coordinator sees the hashchange, and still gets one return', async () => {
    const outer = windowOrder; windowOrder = 'registration';
    const seen = []; const onRender = () => seen.push({ hash: location.hash, origin: api.hasOrigin(), controls: returns().length, rxOrigin: !!document.getElementById('rx-origin') });
    context.addEventListener('cinebraid:route-rendered', onRender);
    try {
      // An explicit prepare() opener: the Working Bible's reference link.
      await reset('#/bible/characters/KAI'); await flush(); seen.length = 0;
      await click(main.querySelector('#wb-open-reference'));
      assert.strictEqual(location.hash, '#/character/KAI');
      assert.deepStrictEqual(seen.map(r => [r.hash, r.origin, r.controls]), [['#/character/KAI', false, 0]], 'one render, and it ran before the edge was pushed');
      assert.strictEqual(returns().length, 1, 'exactly one return control appears without a further render');
      assert.strictEqual(returnLabel(), 'Return to Working Bible');
      assert.ok(returns()[0].parentNode.hasAttribute('data-return-slot'), 'placed in the desk slot');
      // The implicit origin: a reference opened from a shot.
      await reset('#/shot/SH010'); seen.length = 0;
      await click(main.querySelector('#shot-ref'));
      assert.deepStrictEqual(seen.map(r => [r.hash, r.origin, r.controls]), [['#/character/KAI', false, 0]], 'one render, before the implicit arm became an edge');
      assert.strictEqual(returns().length, 1, 'exactly one return control appears without a further render');
      assert.strictEqual(returnLabel(), 'Return to SH010 · The signal');
      // Browser Back to a recorded origin that already rendered is an arrival: it pops, restores once and Forward invents nothing.
      // (A shot origin renders once; the harness Bible renders again after its authority read, which would hide this.)
      clock += 5000; await reset('#/shot/SH010');
      main.querySelector('#noop').focus(); main.scrollTop = 240;
      await click(main.querySelector('#shot-ref'));
      assert.strictEqual(returnLabel(), 'Return to SH010 · The signal');
      const before = restoreCalls.length; seen.length = 0;
      await go('#/shot/SH010');   // history.back()
      assert.strictEqual(returns().length, 0);
      assert.strictEqual(api.hasOrigin(), false, 'Back pops the edge');
      assert.strictEqual(restoreCalls.length - before, 1, 'Back restores the origin view once');
      assert.strictEqual(main.scrollTop, 240, 'with the captured scroll');
      assert.strictEqual(document.activeElement.id, 'shot-ref', 'and focus on the link that opened the reference');
      await go('#/character/KAI');   // history.forward()
      assert.strictEqual(returns().length, 0, 'Forward is direct navigation and invents nothing');
      assert.strictEqual(api.hasOrigin(), false);
      // Browser Back onto Results, whose render decides between its plain target and the trail.
      await reset('#/character/KAI');
      await click(main.querySelector('#rd-results'));   // Kai → Results (go pushes before the hash changes)
      const results = location.hash;
      main.querySelector('#rx-heading').focus();
      inspectorOwner('#/shot/SH010/review/key-one', inspectorOpen()); await flush();
      assert.strictEqual(returnLabel(), 'Return to Results');
      seen.length = 0;
      await go(results);   // history.back()
      assert.strictEqual(returns().length, 1, 'one return on the Results we went back to');
      assert.strictEqual(returnLabel(), 'Return to Kai');
      assert.strictEqual(document.getElementById('rx-origin'), null, 'Results renders no stacked plain target beside the return');
      assert.strictEqual(seen[seen.length - 1].rxOrigin, false, 'the render that remains saw the popped trail');
      await click(returns()[0]);
      assert.strictEqual(location.hash, '#/character/KAI');
      assert.strictEqual(returns().length, 0);
    } finally {
      winListeners.splice(winListeners.findIndex(l => l.fn === onRender), 1);
      windowOrder = outer; clock += 5000;
    }
  });

  test('Shipped adapters: no competing return owners remain', async () => {
    const results = read('public/results-desk.js'), reference = read('public/reference-desk.js'), bible = read('public/working-bible.js'), review = read('public/review.js'), shotDesk = read('public/shot-desk.js'), styles = read('public/styles.css');
    assert.ok(!/Back to '\+\(scope\.shotId/.test(results) && results.includes("btn('origin',scope.shotId?'Open shot':'Open reference')"), 'Results offers a plain target only when there is no trail');
    assert.ok(results.includes('<span data-return-slot></span>'), 'Results reserves the return slot');
    assert.ok(!/capture\(\{label:'Return to '\+\(scope\.shotId/.test(results), 'Results open() uses the computed label');
    assert.ok(reference.includes("</nav><span data-return-slot></span>'"), 'Reference Desk reserves the slot after its crumb');
    assert.ok(!/\borigin=|\breturning\b|frameLabel/.test(reference), 'Reference Desk no longer captures its own shot origin');
    assert.ok(!/function back\(|action==='back'|\borigin=null/.test(bible), 'Working Bible no longer owns a return');
    assert.ok(/openModal\(`<div data-global-navigation><h3>Search<\/h3>/.test(review), 'the search modal is marked as global navigation');
    assert.ok(/function stampCeremony\(text\) \{\}/.test(review), 'the approval announcement seam paints nothing');
    assert.ok(!shotDesk.includes('>Return to shot<'), 'Shot Desk error state offers a target, not a return');
    assert.ok(!/\.stamp-overlay\{|\.stamp-big\{|--z-stamp:|@keyframes stamp-hit/.test(styles), 'the oversized APPROVED overlay is gone');
    assert.ok(!/\.md-return\{/.test(read('public/production-media.css')), 'no legacy .md-return styling competes with .cb-return');
    const app = read('public/app.js'), paintSave = app.slice(app.indexOf('function paintProjectSaveState()'), app.indexOf('function currentAuthorityTransition('));
    assert.ok(/el\.title = label/.test(paintSave), 'the topbar save status mirrors its full label into title');
    const shell = read('public/experience-coherence.css');
    assert.ok(/#topbar \.topbar-actions \{[^}]*min-width:0;/.test(shell) && !/#topbar \.topbar-actions \{[^}]*min-width:auto/.test(shell), 'the actions row may shrink (the 761–820 seam stays fixed)');
    assert.ok(/#topbar #save-state \{[^}]*flex:0 4 auto;[^}]*max-width:/.test(shell) && /#topbar #save-state>span:last-child \{[^}]*text-overflow:ellipsis/.test(shell), 'a long save label gives way instead of pushing the controls');
  });

  let failed = 0, ran = 0;
  for (const order of ['phase', 'registration']) {
    windowOrder = order;
    for (const [name, fn] of cases) {
      ran++;
      try { await fn(); console.log('  ok  [' + order + '] ' + name); }
      catch (error) { failed++; console.error('  FAIL [' + order + '] ' + name + '\n       ' + (error && error.stack || error)); }
    }
  }
  if (failed) { console.error(`FAIL ev2-7 navigation: ${failed} of ${ran} journeys failed.`); process.exit(1); }
  console.log(`PASS ev2-7 navigation: ${cases.length} journeys through the one return coordinator, under both window listener orders (${ran} runs).`);
})().catch(error => { console.error(error); process.exit(1); });

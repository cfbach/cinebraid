/* EV2-7 dogfood — THE TWO SHELL UTILITIES, driven rather than read.
 *
 * The human dogfood found four things about Activity and Braidy:
 *
 *   * the topbar Activity control opened the bottom drawer and could not close it —
 *     the only way back was the drawer's own Collapse;
 *   * Activity and Braidy could be open at once and squeeze the work between them;
 *   * Braidy toggled on the Shot Desk and looked inert on Results;
 *   * with no assistant configured the rail had nothing to say about that state.
 *
 * Every one of those is a claim about BEHAVIOUR, so this suite runs the shipped files in
 * one realm over a DOM built from the SHIPPED shell markup — public/index.html's own
 * `#workspace` section, lifted out rather than retyped, so a fixture cannot drift from
 * what the product declares. The three CSS facts a Node realm genuinely cannot run (the
 * rail is not hidden on the desk routes, the frame's controls are 44px, the one return
 * control is a single 44px line) are asserted against the shipped stylesheet here and
 * measured in a real browser by the probe and by tests/quiet-shell-real-browser.py.
 *
 * NOTHING IS CONFIGURED AND NOTHING IS PAID FOR. No assistant, key or provider is set;
 * no project, config or credential is read or written; no server and no network.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* The shipped tree, unless a negative control points this at a patched COPY of it. The
   companion suite (tests/ev2-7-shell-utilities-negative-controls.js) writes its
   mutations into a temporary directory and runs this file against that, so a control
   never edits a repo file and two suites can run at once. */
const ROOT = process.env.EV2_7_SHELL_SOURCE_ROOT || path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const notes = [];
const note = (line) => notes.push(line);

/* ---------------------------------------------------------------- a small DOM
   The same shape as tests/ev2-7-navigation.js's: enough of an element to hold the
   shell's slots, its classes and its focus, and nothing that pretends to lay anything
   out. Geometry is deliberately absent — every geometric claim in this pass is made in
   the browser, and a fake rectangle here would look like one and not be one. */
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source']);
const kebab = (key) => key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const unescape_ = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

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
  return out.map((x) => x.trim()).filter(Boolean);
}
function compound(text) {
  const c = { tag: '', id: '', classes: [], attrs: [] }; let rest = text;
  const take = (re) => { const m = rest.match(re); if (m) rest = rest.slice(m[0].length); return m; };
  let m = take(/^[a-zA-Z][a-zA-Z0-9-]*|^\*/); if (m && m[0] !== '*') c.tag = m[0].toUpperCase();
  while (rest) {
    if ((m = take(/^#([\w-]+)/))) c.id = m[1];
    else if ((m = take(/^\.([\w-]+)/))) c.classes.push(m[1]);
    else if ((m = take(/^\[([\w-]+)(?:([\^]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/))) c.attrs.push({ name: m[1], op: m[2] || '', value: m[3] ?? m[4] ?? m[5] ?? '' });
    else throw Error('unsupported selector part: ' + rest);
  }
  return c;
}
function matchCompound(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  if (c.classes.some((name) => !el.classList.contains(name))) return false;
  for (const a of c.attrs) { const v = el.getAttribute(a.name); if (v == null) return false; if (a.op === '=' && v !== a.value) return false; if (a.op === '^=' && !v.startsWith(a.value)) return false; }
  return true;
}
function matchesSelector(el, selector) {
  return splitTop(selector, ',').some((complex) => {
    /* `:scope > x` is what public/workspace-shell.js asks a slot for. */
    const scoped = complex.startsWith(':scope >');
    const parts = splitTop(scoped ? complex.slice(8) : complex, ' ').map(compound);
    if (!matchCompound(el, parts[parts.length - 1])) return false;
    let node = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) { while (node && !matchCompound(node, parts[i])) node = node.parentNode; if (!node) return false; node = node.parentNode; }
    return true;
  });
}
class TextNode { constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; } get textContent() { return this.data; } }
function detach(node) { if (node.parentNode) { const list = node.parentNode.childNodes; list.splice(list.indexOf(node), 1); node.parentNode = null; } }
class Element {
  constructor(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attributes = new Map(); this.childNodes = []; this.parentNode = null; this.listeners = [];
    this.focusCount = 0; this.scrollCount = 0;
    const self = this;
    this.style = { properties: new Map(), setProperty: (k, v) => self.style.properties.set(k, v), removeProperty: (k) => self.style.properties.delete(k), getPropertyValue: (k) => self.style.properties.get(k) || '' };
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? (self.getAttribute('data-' + kebab(k)) ?? undefined) : undefined),
      set: (_, k, v) => { self.setAttribute('data-' + kebab(k), String(v)); return true; },
      deleteProperty: (_, k) => { self.removeAttribute('data-' + kebab(k)); return true; },
      has: (_, k) => self.hasAttribute('data-' + kebab(k)),
    });
    this.classList = {
      contains: (c) => (self.getAttribute('class') || '').split(/\s+/).includes(c),
      add: (...cs) => cs.forEach((c) => { if (!self.classList.contains(c)) self.setAttribute('class', ((self.getAttribute('class') || '') + ' ' + c).trim()); }),
      remove: (...cs) => self.setAttribute('class', (self.getAttribute('class') || '').split(/\s+/).filter((x) => x && !cs.includes(x)).join(' ')),
      toggle: (c, force) => { const on = force === undefined ? !self.classList.contains(c) : !!force; if (on) self.classList.add(c); else self.classList.remove(c); return on; },
    };
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  get id() { return this.getAttribute('id') || ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get tabIndex() { return Number(this.getAttribute('tabindex') || -1); } set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get title() { return this.getAttribute('title') || ''; } set title(v) { this.setAttribute('title', v); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get isConnected() { let node = this; while (node.parentNode) node = node.parentNode; return node === documentElement; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; if (v !== '') this.append(String(v)); }
  get innerHTML() { return this.children.map((c) => c.outerHTML).join(''); }
  set innerHTML(html) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; parseInto(this, String(html)); }
  get outerHTML() { return `<${this.tagName.toLowerCase()}${[...this.attributes].map(([k, v]) => ` ${k}="${v}"`).join('')}>${this.childNodes.map((n) => (n.nodeType === 1 ? n.outerHTML : n.data)).join('')}</${this.tagName.toLowerCase()}>`; }
  adopt(nodes) { return nodes.map((n) => { if (typeof n === 'string') n = new TextNode(n); detach(n); n.parentNode = this; return n; }); }
  append(...nodes) { this.childNodes.push(...this.adopt(nodes)); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; this.append(...nodes); }
  descendants() { const out = []; const walk = (node) => node.children.forEach((child) => { out.push(child); walk(child); }); walk(this); return out; }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) { let node = this; while (node && node.nodeType === 1) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { return this.descendants().filter((el) => el.matches(selector)); }
  querySelector(selector) { return this.descendants().find((el) => el.matches(selector)) || null; }
  addEventListener(type, fn) { this.listeners.push({ type, fn }); }
  focus() { document.activeElement = this; this.focusCount++; }
  scrollIntoView() { this.scrollCount++; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
}
function parseInto(root, html) {
  let current = root;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { let node = current; while (node !== root && node.tagName !== m[1].toUpperCase()) node = node.parentNode; if (node !== root) current = node.parentNode; }
    else if (m[2]) {
      const el = new Element(m[2]); const attrRe = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
      while ((a = attrRe.exec(m[3] || ''))) el.setAttribute(a[1], unescape_(a[2] ?? a[3] ?? a[4] ?? ''));
      current.append(el); if (!VOID.has(m[2].toLowerCase())) current = el;
    } else if (m[4] && m[4].trim()) current.append(unescape_(m[4]));
  }
}

const documentElement = new Element('html');
const body = new Element('body');
documentElement.append(body);
const docListeners = [];
const document = {
  documentElement, body, activeElement: body, readyState: 'complete',
  addEventListener(type, fn, options) { docListeners.push({ type, fn, capture: options === true || !!options?.capture }); },
  removeEventListener() {},
  getElementById(id) { return documentElement.descendants().find((el) => el.id === id) || null; },
  querySelector: (selector) => documentElement.querySelector(selector),
  querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
  createElement: (tag) => new Element(tag),
};
documentElement.style = { properties: new Map(), setProperty: (k, v) => documentElement.style.properties.set(k, v), removeProperty: (k) => documentElement.style.properties.delete(k) };

/* THE SHIPPED SHELL, lifted out of public/index.html rather than retyped. */
const INDEX = read('public/index.html');
const SHELL_MARKUP = INDEX.slice(INDEX.indexOf('<section id="workspace">'), INDEX.indexOf('</section>', INDEX.indexOf('<div id="cb-shell-dock"')) + '</section>'.length);
assert.ok(SHELL_MARKUP.includes('id="cb-shell-rail"') && SHELL_MARKUP.includes('id="cb-shell-dock"') && SHELL_MARKUP.includes('id="automation-activity-toggle"'),
  'the harness must be built from the shipped #workspace markup');
/* The shipped modal host, for the same reason: a dialog opened from a utility is part of
   what Escape has to get right, and `#modal.hidden` is how this product says "no dialog". */
const MODAL_MARKUP = (INDEX.match(/<div id="modal"[^>]*><\/div>/) || [''])[0];
assert.ok(MODAL_MARKUP, 'the harness must be built from the shipped modal host');
const app = new Element('div'); app.id = 'app'; body.append(app);
parseInto(app, SHELL_MARKUP + MODAL_MARKUP);

/* ---------------------------------------------------------------- the realm */
const winListeners = [];
const store = new Map();
const location = { hash: '#/shot/SH-02' };
const sandbox = {
  console, Promise, setTimeout, clearTimeout, queueMicrotask, URL,
  requestAnimationFrame: (fn) => fn(),
  document, location,
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  esc: (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
  plural: (n, one, many = one + 's') => `${n} ${Number(n) === 1 ? one : many}`,
  CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  addEventListener: (type, fn, options) => winListeners.push({ type, fn, capture: options === true || !!options?.capture }),
  dispatchEvent: (event) => { winListeners.filter((l) => l.type === event.type).forEach((l) => l.fn(event)); return true; },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  innerWidth: 1440,
};
sandbox.attr = (t) => sandbox.esc(t).replace(/'/g, '&#39;');
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
/* A project is open — that is what makes the shell present at all — and nothing else
   about it matters here. Declared with `var` because the shipped files read it the way
   public/app.js declares it: a lexical binding on the shared script scope, not a
   property of window. */
vm.runInContext('var P = { meta: { title: "Synthetic production" }, shots: [{ id: "SH-02", title: "Mara steps off the tram" }] };', sandbox);
for (const file of ['public/shared-workspace-shell.js', 'public/shared-creator-state.js', 'public/shared-braidy.js',
  'public/workspace-shell.js', 'public/braidy-rail.js', 'public/creator-surfaces.js']) {
  vm.runInContext(read(file), sandbox, { filename: file });
}
const surfaces = sandbox.window.CineBraidCreatorSurfaces;
const shell = sandbox.window.CineBraidShell;
assert.ok(surfaces && shell, 'the shipped shell and its two utilities must load in one realm');

const activityToggle = document.getElementById('automation-activity-toggle');
const railToggle = document.getElementById('creator-rail-toggle');
const railSlot = document.getElementById('cb-shell-rail');
const dockSlot = document.getElementById('cb-shell-dock');

/* The shipped binding, applied the way public/live-activity.js applies it. Loading that
   file whole would drag in the whole activity ledger; the ONE line under test is read
   from its source and asserted below, so what runs here is what ships. */
const ACTIVITY_BINDING = read('public/live-activity.js').match(/toggle\.onclick = \(\) => window\.CineBraidCreatorSurfaces\?\.(\w+)\?\.\(\)/);
assert.ok(ACTIVITY_BINDING, 'public/live-activity.js must bind the topbar Activity control to a creator-surfaces verb');
activityToggle.addEventListener('click', () => surfaces[ACTIVITY_BINDING[1]]());

function pressControl(element) {
  assert.ok(element, 'the control to press exists');
  element.focus();
  element.listeners.filter((l) => l.type === 'click').forEach((l) => l.fn({ type: 'click', target: element }));
  const inline = element.getAttribute('onclick');
  if (inline) { sandbox.__el = element; vm.runInContext(`(function(){${inline}}).call(__el)`, sandbox); }
}
function pressEscape(target) {
  let prevented = false, stopped = false;
  const event = { type: 'keydown', key: 'Escape', target, get defaultPrevented() { return prevented; }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
  for (const listener of docListeners.filter((l) => l.type === 'keydown' && l.capture)) { listener.fn(event); if (stopped) break; }
  return { prevented, stopped };
}
const activityOpen = () => !surfaces.terminalCollapsed();
const railMounted = () => railSlot.hasAttribute('data-occupied');
const reset = () => { store.clear(); surfaces.paint(); };

/* =========================================================================== */
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('1 · both utilities are closed by default, and no route change opens either', () => {
  reset();
  assert.strictEqual(surfaces.terminalCollapsed(), true, 'with no stored preference the Activity drawer is closed');
  assert.strictEqual(surfaces.railOpen(), false, 'with no stored preference Braidy is closed');
  assert.strictEqual(railMounted(), false, 'a closed rail is not mounted, which is what gives the centre its width back');
  assert.strictEqual(activityToggle.getAttribute('aria-expanded'), 'false', 'the Activity control ships saying the drawer is closed');
  assert.strictEqual(railToggle.getAttribute('aria-expanded'), 'false', 'the Braidy control ships saying the rail is closed');
  for (const signal of ['cinebraid:route-rendered', 'cinebraid:workspace-updated', 'cinebraid:activity-updated', 'hashchange']) {
    location.hash = signal === 'hashchange' ? '#/production' : location.hash;
    sandbox.dispatchEvent({ type: signal });
    assert.strictEqual(activityOpen(), false, `${signal} must not expand the Activity drawer`);
    assert.strictEqual(surfaces.railOpen(), false, `${signal} must not open Braidy`);
  }
  location.hash = '#/shot/SH-02';
  note('1. closed by default, and four repaint signals leave both closed');
});

check('2 · the topbar Activity control is a true open/close toggle', () => {
  reset();
  assert.strictEqual(ACTIVITY_BINDING[1], 'toggleActivity',
    `the topbar control is bound to ${ACTIVITY_BINDING[1]}(); expandTerminal() is the one-verb opener every "Open Activity" control uses, and binding it here is the reported defect`);
  pressControl(activityToggle);
  assert.strictEqual(activityOpen(), true, 'one press opens the drawer');
  assert.strictEqual(activityToggle.getAttribute('aria-expanded'), 'true', 'and says so');
  pressControl(activityToggle);
  assert.strictEqual(activityOpen(), false, 'a second press CLOSES it — the reported defect');
  assert.strictEqual(activityToggle.getAttribute('aria-expanded'), 'false', 'and says that too');
  assert.strictEqual(document.activeElement, activityToggle, 'closing with the control leaves focus on the control');
  note('2. press opens, press again closes, and aria-expanded follows both');
});

check("3 · the drawer's own control and the topbar control are never out of step", () => {
  reset();
  pressControl(activityToggle);
  const collapse = dockSlot.querySelector('.cb-terminal-head .cb-utility-control');
  assert.ok(collapse, 'the drawer offers its own collapse control');
  assert.strictEqual(collapse.getAttribute('aria-expanded'), 'true');
  pressControl(collapse);
  assert.strictEqual(activityOpen(), false, "the drawer's own control still collapses it");
  assert.strictEqual(activityToggle.getAttribute('aria-expanded'), 'false',
    'the topbar control must not still claim the drawer is open after the drawer closed itself');
  const expand = dockSlot.querySelector('.cb-terminal-head .cb-utility-control');
  assert.strictEqual(expand.getAttribute('aria-expanded'), 'false');
  pressControl(expand);
  assert.strictEqual(activityOpen(), true);
  assert.strictEqual(activityToggle.getAttribute('aria-expanded'), 'true', 'and it follows the drawer back open');
  note('3. the topbar control tracks the drawer through the drawer\'s own control, both ways');
});

check('4 · Braidy is a true toggle, and it is the same toggle on every route', () => {
  for (const hash of ['#/production', '#/shot/SH-02', '#/shot/SH-02/results/frame/frame-a/-', '#/character/MARA/results/state-default/-/-', '#/results', '#/library']) {
    reset();
    location.hash = hash;
    surfaces.paint();
    pressControl(railToggle);
    assert.strictEqual(surfaces.railOpen(), true, `${hash}: one press opens Braidy`);
    assert.strictEqual(railMounted(), true, `${hash}: the rail slot is occupied, so there is something to paint`);
    assert.ok(railSlot.querySelector('.cb-braidy'), `${hash}: Braidy itself is in the rail`);
    assert.strictEqual(railToggle.getAttribute('aria-expanded'), 'true', `${hash}: the control says it is open`);
    pressControl(railToggle);
    assert.strictEqual(surfaces.railOpen(), false, `${hash}: a second press closes it`);
    assert.strictEqual(railMounted(), false, `${hash}: and unmounts it`);
    assert.strictEqual(railToggle.getAttribute('aria-expanded'), 'false', `${hash}: and says that`);
  }
  location.hash = '#/shot/SH-02';
  note('4. Braidy opens and closes on all six shell routes, including Results and Screening');
});

check('5 · opening either utility closes the other, through every door', () => {
  /* The topbar controls. */
  reset();
  pressControl(railToggle);
  pressControl(activityToggle);
  assert.strictEqual(surfaces.railOpen(), false, 'opening Activity closes Braidy');
  assert.strictEqual(activityOpen(), true);
  pressControl(railToggle);
  assert.strictEqual(activityOpen(), false, 'opening Braidy closes Activity');
  assert.strictEqual(surfaces.railOpen(), true);

  /* An "Open Activity" caller — the verb every compact run status, stage body and
     Braidy action uses. It opens and never toggles, and it still closes the rail. */
  surfaces.expandTerminal();
  assert.strictEqual(activityOpen(), true, 'expandTerminal opens the drawer');
  assert.strictEqual(surfaces.railOpen(), false, 'and closes Braidy on the way');
  surfaces.expandTerminal();
  assert.strictEqual(activityOpen(), true, 'expandTerminal on an open drawer leaves it open — it is not a toggle');

  /* The drawer's own control, and Braidy's own contextual opener. */
  surfaces.openRail();
  assert.strictEqual(activityOpen(), false, 'openRail closes the drawer');
  surfaces.toggleTerminal();
  assert.strictEqual(surfaces.railOpen(), false, "the drawer's own control closes Braidy too");
  assert.strictEqual(activityOpen(), true);

  /* And the stored pair a build from before this rule could leave behind. */
  store.clear();
  store.set('cinebraid-creator-rail-open', '1');
  store.set('cinebraid-creator-terminal-collapsed', '0');
  surfaces.paint();
  assert.strictEqual(activityOpen() && surfaces.railOpen(), false,
    'two stored open utilities must be corrected on paint, not rendered on top of each other');
  note('5. mutual exclusion through both toggles, expandTerminal, openRail and the drawer\'s own control, and a stored pair is corrected');
});

check('6 · opening moves focus into the utility; Escape closes it and hands focus back', () => {
  reset();
  pressControl(activityToggle);
  const heading = dockSlot.querySelector('[data-cb-utility-focus]');
  assert.ok(heading, 'the drawer names where focus should land');
  assert.strictEqual(document.activeElement, heading, 'opening from the topbar moves focus into the drawer');
  const escaped = pressEscape(heading);
  assert.strictEqual(activityOpen(), false, 'Escape inside the drawer closes it');
  assert.ok(escaped.prevented && escaped.stopped,
    'the press must be consumed, or the surfaces underneath act on the same Escape');
  assert.strictEqual(document.activeElement, activityToggle, 'and focus returns to the control that opened it');

  pressControl(railToggle);
  const railHead = railSlot.querySelector('[data-cb-utility-focus]');
  assert.ok(railHead, 'the rail names where focus should land');
  assert.strictEqual(document.activeElement, railHead, 'opening Braidy moves focus into the rail');
  pressEscape(railSlot.querySelector('.cb-braidy-send') || railHead);
  assert.strictEqual(surfaces.railOpen(), false, 'Escape inside the rail closes it');
  assert.strictEqual(document.activeElement, railToggle, 'and focus returns to the Braidy control');

  /* An Escape pressed anywhere else is not the utilities' to take. */
  pressControl(activityToggle);
  const elsewhere = pressEscape(document.getElementById('main'));
  assert.strictEqual(activityOpen(), true, 'Escape in the workspace must not close the drawer');
  assert.ok(!elsewhere.prevented && !elsewhere.stopped, 'and must not be consumed');

  /* AND A DIALOG OPENED FROM A UTILITY OWNS ITS OWN ESCAPE. "Dismiss previous alerts"
     opens a confirmation from inside the drawer and leaves focus on the control that
     opened it; the drawer taking that press would close the surface underneath a dialog
     that is still standing. */
  const modal = document.getElementById('modal');
  modal.classList.remove('hidden');
  const overDialog = pressEscape(dockSlot.querySelector('.cb-terminal-head .cb-utility-control'));
  assert.strictEqual(activityOpen(), true, 'a utility must not take the Escape aimed at a dialog above it');
  assert.ok(!overDialog.prevented && !overDialog.stopped, 'and must leave the press to the dialog');
  modal.classList.add('hidden');
  note('6. focus enters the opened utility, Escape closes it and returns focus, and an Escape elsewhere is left alone');
});

check('7 · the rail closes from inside itself, which is the only way back at phone widths', () => {
  reset();
  pressControl(railToggle);
  const close = railSlot.querySelector('.cb-utility-close');
  assert.ok(close, 'the rail frame carries its own Close control');
  assert.strictEqual(close.textContent.trim(), 'Close');
  pressControl(close);
  assert.strictEqual(surfaces.railOpen(), false, 'it closes the rail');
  assert.strictEqual(document.activeElement, railToggle, 'and hands focus back to the control that opens it');
  note('7. the rail closes from its own header, and public/styles.css withdraws the topbar control at 720px and below');
});

check('8 · with no assistant, Braidy still opens and explains that state', () => {
  reset();
  pressControl(railToggle);
  const rail = railSlot.querySelector('.cb-braidy');
  assert.ok(rail, 'the rail opens with no assistant configured');
  const text = rail.textContent.replace(/\s+/g, ' ');
  assert.ok(/Braidy is not connected/.test(text), `the rail must name the state plainly, got: ${text.slice(0, 160)}`);
  const link = railSlot.querySelector('.cb-utility-link');
  assert.ok(link, 'and offer the one place that state is changed');
  assert.strictEqual(link.getAttribute('href'), '#/settings/assistant', 'which is the shipped Settings section, not a new surface');
  const source = read('public/braidy-rail.js');
  assert.ok(!/apiKey|provider\s*=\s*["']|fetch\("\/api\/(agents|settings)/.test(source.slice(source.indexOf('function threadMarkup'))),
    'explaining the state must not configure anything');
  note('8. no assistant: the rail opens, says it is not connected, repeats CineBraid\'s own message and links to Settings');
});

check('9 · one visual system: the utility frames are the shell\'s, not a second one', () => {
  const surfacesSource = read('public/creator-surfaces.js');
  /* Comments are stripped where this asks "is that gone?": the retirement note names
     what it retired, which is what a reader needs and what an absence check must not
     trip over. The rendered strings are read from the uncommented source below. */
  const rendered = surfacesSource.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/ACTIVITY TERMINAL|>EXPAND<|>COLLAPSE<|RECHECK STATUS|DISMISS PREVIOUS ALERTS/.test(rendered),
    'the drawer frame must not carry uppercase monospace chrome');
  assert.ok(/<h2 class="cb-terminal-title"[^>]*>Activity<\/h2>/.test(surfacesSource),
    'the drawer names itself the way its control does');
  /* The two global actions are rendered literally; the collapse control's word depends
     on the state, so it is read off the rendered drawer in both of them. */
  for (const label of ['Recheck status', 'Dismiss previous alerts']) {
    assert.ok(rendered.includes(`>${label}<`), `the drawer's header control "${label}" must be sentence case`);
  }
  reset();
  pressControl(activityToggle);
  assert.strictEqual(dockSlot.querySelector('.cb-terminal-head .cb-utility-control').textContent.trim(), 'Collapse',
    "the open drawer's control says which way it goes, in sentence case");
  pressControl(activityToggle);
  assert.strictEqual(dockSlot.querySelector('.cb-terminal-head .cb-utility-control').textContent.trim(), 'Expand',
    "the closed drawer's control says which way it goes, in sentence case");
  assert.strictEqual(dockSlot.querySelector('.cb-terminal-title').textContent.trim(), 'Activity',
    'and the frame names the utility the way the topbar control does');
  const css = read('public/experience-coherence.css');
  const section = css.slice(css.indexOf('/* EV2-7 Dogfood — Shell utilities & contextual return */'));
  assert.ok(section, 'the shell utilities own a section of the shared stylesheet');
  assert.ok(/#cb-shell-dock .cb-terminal-head .cb-terminal-action,#cb-shell-rail .cb-utility-close,#cb-shell-rail .cb-utility-link \{[^}]*min-height:44px/.test(section),
    'every control in either frame is at least 44px');
  assert.ok(/#cb-shell-dock .cb-terminal-head .cb-terminal-action,#cb-shell-rail .cb-utility-close,#cb-shell-rail .cb-utility-link \{[^}]*var\(--body\)/.test(section),
    'and is written in the body font');
  assert.ok(/#cb-shell-dock,#cb-shell-rail \{[^}]*background:var\(--cb-shell-bg\)/.test(section),
    'both frames sit on the shell\'s own ground');
  /* The row register below the header is content and is deliberately untouched. */
  assert.ok(/VIEW REPORT|DISMISS<|CHECK</.test(surfacesSource),
    'the operational rows keep their own register — this pass restyles frames, not page content');
  note('9. sentence-case 44px body-font header controls in both frames, on the shell\'s ground, with the rows untouched');
});

check('10 · no desk stylesheet may leave Braidy open and invisible', () => {
  const hiding = [];
  for (const file of ['public/results-desk.css', 'public/reference-desk.css', 'public/shot-desk.css', 'public/production-media.css', 'public/working-bible.css', 'public/settings-studio.css', 'public/shot-desk.css']) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.split('}')) {
      if (/#cb-shell-rail/.test(rule.split('{')[0] || '') && /display:\s*none/.test(rule)) hiding.push({ file, rule: rule.split('{')[0].trim() });
    }
  }
  const section = read('public/experience-coherence.css');
  const override = section.slice(section.indexOf('/* EV2-7 Dogfood'));
  for (const hidden of hiding) {
    /* A desk may still hide the slot — three of them need the workspace at 100dvh — as
       long as the shared shell hands the rail back as an overlay on that same surface,
       or the control is a control that does nothing. */
    const bodyClasses = [...hidden.rule.matchAll(/\.([a-z-]+-active)/g)].map((m) => m[1]);
    assert.ok(bodyClasses.length, `${hidden.file}: a rule hiding the rail must be scoped to a named surface, got ${hidden.rule}`);
    for (const name of bodyClasses) {
      assert.ok(new RegExp(`\\.${name}[^{]*#cb-shell-rail\\[data-occupied\\]`).test(override),
        `${hidden.file} hides the rail on .${name}, and nothing in the shared shell paints it there: Braidy's control would open a rail that cannot be seen — the reported Results defect`);
    }
  }
  assert.ok(/display:block!important; position:fixed/.test(override.replace(/\s+/g, ' ')) || hiding.length === 0,
    'where a desk hides the slot the rail must be handed back out of flow, so it covers the work rather than squeezing it');
  note(`10. ${hiding.length} desk rule(s) hide the rail slot; each named surface is answered by the shared shell`);
});

check('11 · one contextual return control: one line, 44px, above the page heading', () => {
  const source = read('public/media-return.js');
  assert.ok(/class="cb-return-line"|className = 'cb-return-line'/.test(source) || source.includes("line.className = 'cb-return-line'"),
    'the label and its context share one line');
  assert.ok(/button\.setAttribute\('title', whole\); button\.setAttribute\('aria-label', whole\)/.test(source),
    'the whole label stays in the title and the accessible name, because the line truncates');
  const place = source.slice(source.indexOf('function place(button)'), source.indexOf('function paint(entry)'));
  assert.ok(/\[data-return-slot\]/.test(place), 'a page that reserves a slot decides for itself');
  assert.ok(place.includes('.shot-main'), 'the Shot Desk work column is one of the placements, or the Desk return sits above the whole shell');
  assert.ok(/crumb\.after\(button\)/.test(place), 'where a page has a crumb the return sits under it, above the heading');
  const css = read('public/experience-coherence.css');
  const section = css.slice(css.indexOf('/* EV2-7 Dogfood — Shell utilities & contextual return */')).replace(/\s+/g, ' ');
  assert.ok(/\.md-return\.cb-return \{[^}]*height:44px/.test(section), 'the control is 44px on every page');
  assert.ok(/\.md-return\.cb-return \{[^}]*white-space:nowrap/.test(section) && /\.cb-return-line \{[^}]*text-overflow:ellipsis/.test(section),
    'one line, truncated rather than wrapped, so it is never taller than one row');
  assert.ok(!/\.cb-return \{[^}]*flex-direction:column/.test(css),
    'the stacked two-line control is gone; that is the oversized Screening return');
  note('11. the return control is one 44px line everywhere, truncated with its full text in the title, placed above the heading');
});

/* =========================================================================== */
let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log('  ok  ' + name); }
  catch (error) { failed++; console.error('  FAIL ' + name + '\n       ' + (error && error.message ? error.message : error)); if (process.env.EV2_7_STACK) console.error(error.stack); }
}
console.log(notes.map((line) => '  ' + line).join('\n'));
if (failed) { console.error(`FAIL ev2-7 shell utilities: ${failed} of ${checks.length} checks failed.`); process.exit(1); }
console.log(`PASS ev2-7 shell utilities: ${checks.length} checks — two utilities that open and close, never both at once, keyboard-reachable, explained when unconfigured, and one contextual return.`);

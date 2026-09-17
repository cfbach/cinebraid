/* ONE contextual return, owned here. An ephemeral, project-open-scoped trail: no production,
 * storage or server writes, and nothing survives a reload or a project switch.
 *
 * A route FAMILY keeps its return across its own sub-routes (result keys, Shot Desk review keys,
 * reference /tools), including history.replaceState. A return is created only by an owner that
 * names a real origin (go/prepare) or by opening a reference from a shot. Everything else is direct
 * navigation and clears the trail: #nav, the project menu, search, Add, the Braidy rail and the
 * Activity dock, browser history that is not the recorded origin, and the address bar.
 * A pending return is popped only when its origin actually renders, so a refused or superseded
 * navigation keeps the entry. Restoration reuses app.js captureRouteViewState/restoreRouteViewState.
 */
(function () {
  'use strict';
  const ARM_MS = 1500, GLOBAL = '[data-global-navigation],.global-add-modal,#cb-shell-rail,#cb-shell-dock';
  const OPENER = ['data-rd-action', 'data-rd-slot', 'data-rd-results-slot', 'data-wb', 'onclick', 'href'];
  let trail = [], pending = null, armed = null, press = null, globalIntent = false, restoredRender = false;
  let serial = 0, nextId = 0, lastScope = '', lastHash = location.hash, renderedHash = '';
  const bare = hash => String(hash || '').split('?')[0];
  const now = () => (typeof performance === 'object' && performance && performance.now ? performance.now() : Date.now());
  const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };
  const scope = () => ACTIVE_PROJECT_SLUG + ':' + PROJECT_OPEN_EPOCH;
  const valid = saved => !!saved && saved.slug === ACTIVE_PROJECT_SLUG && saved.epoch === PROJECT_OPEN_EPOCH;
  function family(hash) {
    const p = bare(hash).split('/');
    if (p[1] === 'shot' && p[2]) return p[3] === 'results' || p[3] === 'review' ? 'shot:' + p[2] + ':results' : 'shot:' + p[2];
    if (/^(character|location|prop|vehicle|sound)$/.test(p[1] || '') && p[2]) return p[3] === 'results' ? ['ref', p[1], p[2], 'results', p[4] || '', p[5] || ''].join(':') : 'ref:' + p[1] + ':' + p[2];
    if (p[1] === 'bible') return 'bible';
    if (p[1] === 'results') return 'media';
    return bare(hash);
  }
  const owner = hash => family(hash).replace(/:results(:.*)?$/, '');
  function describe(hash) {
    const f = family(hash), p = bare(hash).split('/').map(decode), main = document.getElementById('main');
    if (f.startsWith('shot:') && p[3] !== 'results') {
      const shot = typeof shotById === 'function' ? shotById(p[2]) : null, scene = shot && typeof sceneById === 'function' ? sceneById(shot.scene) : null;
      const frame = p[3] === 'review' ? main?.querySelector('.sd-frame')?.textContent : '';
      return { label: 'Return to ' + (shot ? [shot.id, shot.title].filter(Boolean).join(' · ') : 'shot'), context: [scene?.title || scene?.id, frame].map(x => String(x || '').trim()).filter(Boolean).join(' · ') };
    }
    if (f.includes(':results')) return { label: 'Return to Results' };
    if (f.startsWith('ref:')) {
      const list = typeof ENTITY_ROUTE === 'object' ? Object.keys(ENTITY_ROUTE).find(key => ENTITY_ROUTE[key] === p[1]) : '';
      const entity = list && typeof P === 'object' && P && Array.isArray(P[list]) ? P[list].find(x => x.id === p[2]) : null;
      return { label: 'Return to ' + (entity?.name || p[2]) };
    }
    if (f === 'bible') return { label: 'Return to Working Bible' };
    if (f === 'media') return { label: 'Return to Production Media' };
    return { label: 'Return to ' + (String(document.getElementById('topbar-view')?.textContent || '').trim() || 'previous view') };
  }
  function capture(extra = {}) {
    const control = press?.control || document.activeElement, main = document.getElementById('main');
    const named = extra.label ? {} : extra.resume ? { label: 'Return to media selection' } : describe(location.hash);
    return { slug: ACTIVE_PROJECT_SLUG, epoch: PROJECT_OPEN_EPOCH, hash: location.hash,
      scroll: main?.scrollTop || 0, windowX: window.scrollX || 0, windowY: window.scrollY || 0,
      controlId: control?.id || '', focus: control?.getAttribute?.('data-md-open') || control?.getAttribute?.('data-md-inspect') || '',
      controlAttribute: OPENER.map(name => [name, control?.getAttribute?.(name)]).find(([, value]) => value != null) || null,
      view: typeof captureRouteViewState === 'function' ? captureRouteViewState() : null,
      context: '', ...named, ...extra };
  }
  function cancel() { trail = []; pending = armed = null; globalIntent = false; serial++; document.querySelectorAll('[data-media-return]').forEach(el => el.remove()); }
  function push(destination, saved) {
    if (!valid(saved) || (family(saved.hash) === family(destination) && !saved.resume)) return false;
    // Returning to an ancestor collapses the cycle instead of stacking Shot ↔ Results edges.
    const at = trail.map(entry => family(entry.saved.hash)).lastIndexOf(family(destination));
    if (at >= 0) trail.length = at;
    trail.push({ id: ++nextId, destination, saved });
    return true;
  }
  function go(hash, saved) {
    if (!valid(saved)) return false;
    push(hash, saved); armed = null; globalIntent = false;
    closeModal({ restoreFocus: false });
    const same = location.hash === hash; location.hash = hash;
    if (same && typeof route === 'function') route();
    return true;
  }
  function current() {
    // While a pending return is arriving, its origin already renders as if the edge were popped.
    const at = pending && bare(location.hash) === bare(pending.saved.hash) ? trail.findIndex(entry => entry.id === pending.id) : -1;
    const entry = (at >= 0 ? trail.slice(0, at) : trail).slice(-1)[0];
    return entry && valid(entry.saved) && family(entry.destination) === family(location.hash) ? entry : null;
  }
  function back() {
    const entry = current(); if (!entry) { cancel(); return false; }
    pending = { id: entry.id, saved: entry.saved, token: ++serial }; armed = null; globalIntent = false;
    closeModal({ restoreFocus: false });
    if (location.hash === entry.saved.hash) route(); else location.hash = entry.saved.hash;
    return true;
  }
  function restore(saved, token) {
    const main = document.getElementById('main');
    if (saved.view && typeof restoreRouteViewState === 'function') restoreRouteViewState(saved.view);
    else { if (main) main.scrollTop = saved.scroll || 0; window.scrollTo?.(saved.windowX || 0, saved.windowY || 0); }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== serial || !valid(saved) || bare(location.hash) !== bare(saved.hash)) return;
      const main = document.getElementById('main'), active = () => document.activeElement;
      if (saved.resume) {
        saved.resume();
        // A resume that reopened its own surface, placed focus in the page, or whose opener restoreRouteViewState can
        // name keeps that focus. Only an opener the route view cannot name (no id or focus key) is still owed focus here.
        if (document.querySelector('#modal:not(.hidden)') || (active() && active() !== document.body && active().isConnected !== false && active().closest?.('#main'))) return;
        if (saved.view?.selector && document.querySelector(saved.view.selector)) return;
      }
      const selected = saved.view?.selector ? document.querySelector(saved.view.selector) : null;
      if (selected && active() === selected) return; // restoreRouteViewState already focused the exact opener
      const controls = [...(main?.querySelectorAll('button,a,input,select,textarea,[data-md-open],[data-md-inspect]') || [])];
      // An attribute match can name several controls (two links to one route): prefer one that can take focus, and
      // fall back to the heading when the chosen control is hidden and focus did not move.
      const visible = el => !el.getClientRects || el.getClientRects().length > 0;
      const byAttribute = saved.controlAttribute ? controls.filter(el => el.getAttribute(saved.controlAttribute[0]) === saved.controlAttribute[1]) : [];
      const exact = (saved.controlId && document.getElementById(saved.controlId)) || (saved.focus && controls.find(el => (el.getAttribute('data-md-open') || el.getAttribute('data-md-inspect')) === saved.focus)) || byAttribute.find(visible) || byAttribute[0];
      if (exact && visible(exact)) exact.focus({ preventScroll: true });
      else if (!selected) { const heading = main?.querySelector('h1') || main?.querySelector('h2') || main; if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }
    }));
  }
  // EV2-7 dogfood: ONE placement rule, so the control sits in the same place on every page it
  // appears on — at the top of the work area, above the page's heading, never inside a heading's
  // action group. A page that reserves [data-return-slot] decides for itself and puts the slot
  // first in its own header; every other page is placed from its own shape: after its crumb when
  // it has one (the Shot Desk's work column, the Reference Desk, the EV2-6 review page), otherwise
  // at the very top of the work container (Production media, the Working Bible, the library).
  function place(button) {
    const main = document.getElementById('main'); if (!main) return;
    const slot = main.querySelector('[data-return-slot]');
    if (slot) { if (button.parentNode !== slot) slot.appendChild(button); return; }
    const desk = main.querySelector('.results-desk,.reference-desk,.shot-desk,.shot-main,.rd-library,.rd-existing-tools,.production-contact-sheet,.wb-dossier');
    const crumb = desk && [...desk.children].find(el => ['rd-crumb', 'crumb', 'sd-context'].some(name => el.classList.contains(name)));
    if (crumb) { if (crumb.nextSibling !== button) crumb.after(button); return; }
    // A desk #main is a flex or grid row: a direct child would become a column beside the page, so go inside its first child.
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(main) : null;
    const host = desk || (style && /flex|grid/.test(style.display) && !/column/.test(style.flexDirection || '') ? main.children && [...main.children].find(el => el !== button) : null) || main;
    if (host.firstChild !== button) host.prepend(button);
  }
  function paint(entry) {
    const existing = [...document.querySelectorAll('[data-media-return]')];
    const reused = entry && existing.find(el => el.dataset.returnId === String(entry.id));
    existing.forEach(el => { if (el !== reused) el.remove(); });
    if (!entry) return;
    let button = reused;
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.className = 'md-return cb-return';
      button.dataset.mediaReturn = ''; button.dataset.returnId = String(entry.id); button.dataset.focusKey = 'media-return';
      const text = entry.saved.label || describe(entry.saved.hash).label;
      const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '← ';
      const label = document.createElement('span'); label.className = 'cb-return-label'; label.append(arrow, text);
      // EV2-7 dogfood: ONE line, at every width and on every page. The context is folded into the
      // same line rather than stacking a second one, the line truncates with an ellipsis when the
      // page is narrow, and the whole of it stays available in the title and the accessible name —
      // so the control is the same height everywhere and nothing it says is lost.
      const line = document.createElement('span'); line.className = 'cb-return-line'; line.append(label);
      if (entry.saved.context) { const context = document.createElement('small'); context.textContent = entry.saved.context; line.append(context); }
      button.append(line);
      const whole = [text, entry.saved.context].map(part => String(part || '').trim()).filter(Boolean).join(' · ');
      button.setAttribute('title', whole); button.setAttribute('aria-label', whole);
      button.addEventListener('click', () => back());
    }
    place(button);
  }
  function mount() {
    restoredRender = false;
    if (lastScope && lastScope !== scope()) cancel(); lastScope = scope();
    trail = trail.filter(entry => valid(entry.saved));
    if (pending && !valid(pending.saved)) pending = null;
    const top = trail[trail.length - 1];
    if (top && family(top.destination) === family(location.hash)) top.destination = location.hash; // replaceState inside the destination
    if (pending && bare(location.hash) === bare(pending.saved.hash)) {
      const done = pending, at = trail.findIndex(entry => entry.id === done.id); pending = null;
      if (at >= 0) trail.length = at;
      restoredRender = true; restore(done.saved, done.token);
    }
    paint(current());
    lastHash = renderedHash = location.hash;
  }
  document.addEventListener('click', event => {
    const control = event.target?.closest?.('button,a[href],[role="button"]'); if (!control) return;
    const pressed = press = { control, hash: location.hash };
    // The next task settles this press even when a handler stopped propagation or a link named the current hash:
    // a press that did not change the hash leaves no implicit arm and no global intent behind. prepare() keeps its own guard.
    setTimeout(() => {
      if (press === pressed) press = null;
      if (location.hash !== pressed.hash) return;
      if (armed?.press === pressed) armed = null;
      if (globalIntent === pressed) globalIntent = false;
    }, 0);
    globalIntent = false;
    if (control.closest('#nav,#project-menu')) { cancel(); return; }
    if (control.closest(GLOBAL)) { armed = null; globalIntent = control.classList.contains('cancel') ? false : pressed; return; }
    // The only implicit origin: opening a reference from a shot or its Shot Desk review.
    const opensReference = control.matches('a[href]') ? /^ref:[^:]+:[^:]+$/.test(family(control.getAttribute('href'))) : true;
    armed = control.closest('#main') && family(location.hash).startsWith('shot:') && opensReference ? { snapshot: capture(), explicit: false, t: now(), press: pressed } : null;
  }, true);
  window.addEventListener('click', event => {
    const pressed = press; if (!pressed) return;
    // Inline and document handlers have run. Only a synchronous hash change or a hash link keeps the intent.
    if (location.hash === pressed.hash && !(pressed.control.matches('a[href^="#/"]') && !event.defaultPrevented)) { armed = null; globalIntent = false; }
  });
  // On Window, Chromium runs hashchange listeners in registration order, capture or not: app.js's route listener
  // comes first, so a synchronous route renders (and mount paints the unsettled trail) before this runs.
  // A pushed or cleared edge only needs a repaint. A Browser Back to the recorded origin is an arrival: render it
  // once more so mount pops and restores it and render-time owners (Results, the Bible) see the popped trail.
  window.addEventListener('hashchange', event => {
    const rendered = !!renderedHash && bare(renderedHash) === bare(location.hash);
    onHashChange(event);
    if (!rendered) return;
    if (pending && bare(location.hash) === bare(pending.saved.hash) && typeof route === 'function') { route(); return; }
    paint(current());
  }, true);
  function onHashChange(event) {
    let from = lastHash; try { if (event?.oldURL) from = new URL(event.oldURL).hash; } catch {}
    from = bare(from); lastHash = location.hash;
    const to = bare(location.hash);
    if (pending) { if (to === bare(pending.saved.hash)) return; pending = null; } // refused or superseded
    if (globalIntent) { globalIntent = false; trail = []; armed = null; return; }
    const top = trail[trail.length - 1];
    if (top && family(top.destination) === family(to)) { top.destination = location.hash; armed = null; return; }
    const intent = armed; armed = null;
    if (intent && valid(intent.snapshot) && bare(intent.snapshot.hash) === from && now() - intent.t < ARM_MS && family(from) !== family(to)
      && (intent.explicit || (family(from).startsWith('shot:') && /^ref:[^:]+:[^:]+$/.test(family(to))))) { push(location.hash, intent.snapshot); return; }
    if (top && valid(top.saved) && bare(top.saved.hash) === to) { pending = { id: top.id, saved: top.saved, token: ++serial }; return; } // browser Back
    trail = [];
  }
  window.addEventListener('cinebraid:route-rendered', mount);
  window.CineBraidMediaReturn = { capture, go, back, cancel, family,
    matches(hash) { const entry = current(); return !!hash && !!entry && owner(entry.saved.hash) === owner(hash); },
    prepare(saved) { armed = valid(saved) ? { snapshot: saved, explicit: true, t: now() } : null; },
    hasOrigin() { return !!current(); },
    restoredThisRender() { return restoredRender; } };
})();

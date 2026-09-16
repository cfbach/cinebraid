/* One ephemeral, project-open-scoped task trail. No production or storage writes.
 * Existing Media callers retain their API; Bible and Reference handoffs share it.
 * Ordinary navigation clears the trail. A result-key change stays in its target.
 */
(function () {
  'use strict';
  let trail = [], pending = null, prepared = null, clickSnapshot = null, serial = 0;
  let lastHash = location.hash, lastScope = '';
  const scope = () => ACTIVE_PROJECT_SLUG + ':' + PROJECT_OPEN_EPOCH;
  const family = hash => /\/results\//.test(hash) ? hash.split('/').slice(0, 6).join('/') : hash;
  function valid(saved) { return !!saved && saved.slug === ACTIVE_PROJECT_SLUG && saved.epoch === PROJECT_OPEN_EPOCH; }
  function label(hash) {
    const match = hash.match(/^#\/shot\/([^/]+)/);
    if (match) { const shot = shotById(decodeURIComponent(match[1])); return 'Return to ' + (shot ? [shot.id, shot.title].filter(Boolean).join(' · ') : 'shot'); }
    if (hash.startsWith('#/bible')) return 'Return to Working Bible';
    if (hash.startsWith('#/results')) return 'Return to Production Media';
    return 'Return to reference';
  }
  function capture(extra = {}) {
    const control = document.activeElement;
    return { slug: ACTIVE_PROJECT_SLUG, epoch: PROJECT_OPEN_EPOCH, hash: location.hash,
      scroll: document.getElementById('main')?.scrollTop || 0, windowX: window.scrollX || 0, windowY: window.scrollY || 0,
      controlId: control?.id || '', focus: control?.getAttribute('data-md-open') || control?.getAttribute('data-md-inspect') || '',
      controlAttribute: ['data-rd-action', 'data-rd-slot', 'data-rd-results-slot', 'data-wb', 'onclick'].map(name => [name, control?.getAttribute(name)]).find(([, value]) => value != null) || null,
      view: typeof captureRouteViewState === 'function' ? captureRouteViewState() : null,
      label: label(location.hash), ...extra };
  }
  function cancel() { trail = []; pending = prepared = clickSnapshot = null; serial++; document.querySelector('[data-media-return]')?.remove(); }
  function push(destination, saved) {
    if (!valid(saved)) return false;
    if (saved.hash === destination && !saved.resume) return false;
    if (!trail.length || trail[trail.length - 1].saved !== saved) trail.push({ destination, saved });
    return true;
  }
  function go(hash, saved) {
    if (!valid(saved)) return false;
    push(hash, saved); prepared = null; clickSnapshot = null;
    closeModal({ restoreFocus: false });
    const same = location.hash === hash; location.hash = hash;
    if (same && typeof route === 'function') route();
    return true;
  }
  function current() {
    const entry = trail[trail.length - 1];
    return entry && valid(entry.saved) && family(entry.destination) === family(location.hash) ? entry : null;
  }
  function back() {
    const entry = current(); if (!entry) { cancel(); return; }
    pending = entry.saved; trail.pop(); prepared = clickSnapshot = null;
    closeModal({ restoreFocus: false });
    if (location.hash === pending.hash) route(); else location.hash = pending.hash;
  }
  function restore(saved) {
    const token = ++serial;
    if (saved.view && typeof restoreRouteViewState === 'function') restoreRouteViewState(saved.view);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== serial || !valid(saved) || location.hash !== saved.hash) return;
      const main = document.getElementById('main');
      if (!saved.view) { if (main) main.scrollTop = saved.scroll; window.scrollTo(saved.windowX || 0, saved.windowY || 0); }
      if (saved.resume) { saved.resume(); return; }
      const byAttribute = saved.controlAttribute && [...(main?.querySelectorAll('button,a,input,select,textarea') || [])].find(el => el.getAttribute(saved.controlAttribute[0]) === saved.controlAttribute[1]);
      const exact = (saved.controlId && document.getElementById(saved.controlId)) || (saved.focus && [...(main?.querySelectorAll('[data-md-open],[data-md-inspect]') || [])].find(el => (el.dataset.mdOpen || el.dataset.mdInspect) === saved.focus)) || byAttribute;
      if (exact) exact.focus({ preventScroll: true });
      else if (!saved.view?.selector || !main?.querySelector(saved.view.selector)) { const heading = main?.querySelector('h1,h2') || main; if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }
    }));
  }
  function mount() {
    if (lastScope && lastScope !== scope()) cancel(); lastScope = scope();
    trail = trail.filter(entry => valid(entry.saved));
    if (pending) {
      const saved = pending;
      if (!valid(saved)) pending = null;
      else if (location.hash === saved.hash) { pending = null; restore(saved); }
    }
    const entry = current();
    document.querySelectorAll('[data-media-return]').forEach(el => el.remove());
    if (entry) {
      const main = document.getElementById('main');
      if (main) { const button = document.createElement('button'); button.type = 'button'; button.className = 'md-return'; button.dataset.mediaReturn = ''; button.textContent = entry.saved.label || label(entry.saved.hash); button.onclick = back; main.prepend(button); }
    }
    lastHash = location.hash;
  }
  document.addEventListener('click', event => {
    const control = event.target.closest('button,a[href]'); if (!control) return;
    if (control.closest('#nav,#project-menu') || control.matches('#project-title')) { cancel(); return; }
    clickSnapshot = capture();
    // Capture the actual pointer opener as well as a previously keyboard-focused control.
    clickSnapshot.controlId = control.id || '';
    clickSnapshot.controlAttribute = ['data-rd-action','data-rd-slot','data-rd-results-slot','data-wb','onclick'].map(name => [name, control.getAttribute(name)]).find(([, value]) => value != null) || null;
  }, true);
  window.addEventListener('hashchange', event => {
    const from = event.oldURL ? new URL(event.oldURL).hash : lastHash, to = location.hash;
    if (pending && pending.hash === to) return;
    const entry = trail[trail.length - 1];
    if (entry && family(entry.destination) === family(to)) { entry.destination = to; return; }
    const saved = prepared || (clickSnapshot?.hash === from ? clickSnapshot : null);
    prepared = clickSnapshot = null;
    if (valid(saved) && (from.startsWith('#/bible') || (/^#\/shot\/[^/]+$/.test(from) && /^#\/(character|location|prop|vehicle)\//.test(to)))) push(to, saved);
    else if (entry && entry.saved.hash === to && valid(entry.saved)) { trail.pop(); pending = entry.saved; }
    else trail = [];
  }, true);
  window.addEventListener('cinebraid:route-rendered', mount);
  window.CineBraidMediaReturn = { capture, go, back, cancel, matches(hash) { return current()?.saved.hash === hash; },
    prepare(saved) { prepared = valid(saved) ? saved : null; }, hasOrigin() { return !!current(); } };
})();

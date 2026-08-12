/* CineBraid v6.6.1 — browser-only bounded rendering state and helpers. */
(function () {
  const DEFAULT_SIZES = Object.freeze({ candidates: 12, shots: 40, scenes: 20, reports: 50, references: 40 });
  function projectKey() { return (typeof ACTIVE_PROJECT_SLUG !== "undefined" && ACTIVE_PROJECT_SLUG) || window.ACTIVE_PROJECT_SLUG || window.P?.meta?.id || "project"; }
  function key(scope, id) { return `cinebraid-bounded:${projectKey()}:${scope}:${String(id || "root")}`; }
  function read(scope, id, fallback = "") {
    try { const value = localStorage.getItem(key(scope, id)); return value == null ? fallback : value; }
    catch { return fallback; }
  }
  function write(scope, id, value) {
    try { localStorage.setItem(key(scope, id), String(value)); } catch {}
  }
  function page(items, scope, id, size = 0) {
    const rows = Array.isArray(items) ? items : [];
    const limit = Math.max(1, Number(size || DEFAULT_SIZES[scope] || 20));
    const pages = Math.max(1, Math.ceil(rows.length / limit));
    const requested = Math.max(0, Number(read(`page:${scope}`, id, 0)) || 0);
    const current = Math.min(pages - 1, requested);
    if (current !== requested) write(`page:${scope}`, id, current);
    const start = current * limit;
    return { rows: rows.slice(start, start + limit), page: current, pages, total: rows.length, size: limit, start, end: Math.min(rows.length, start + limit) };
  }
  function selected(scope, id, ids, fallback = "") {
    const allowed = Array.isArray(ids) ? ids.filter(Boolean).map(String) : [];
    if (!allowed.length) return "";
    const stored = String(read(`selected:${scope}`, id, fallback || allowed[0]) || "");
    return allowed.includes(stored) ? stored : (allowed.includes(String(fallback || "")) ? String(fallback) : allowed[0]);
  }
  function statusPill(status) {
    const tone = String(status?.tone || "pending");
    const label = String(status?.label || "Ready");
    return `<small class="bounded-status tone-${window.attr ? window.attr(tone) : tone}">${window.esc ? window.esc(label) : label}</small>`;
  }
  function pagerMarkup(scope, id, info, label = "items") {
    if (!info || info.pages <= 1) return "";
    const safeScope = window.attr ? window.attr(scope) : scope;
    const safeId = window.attr ? window.attr(id) : id;
    return `<nav class="bounded-pager" aria-label="${window.attr ? window.attr(label) : label} pages"><button type="button" ${info.page <= 0 ? "disabled" : ""} onclick="setBoundedPage('${safeScope}','${safeId}',${info.page - 1})">Previous</button><span>${info.start + 1}–${info.end} of ${info.total}</span><button type="button" ${info.page >= info.pages - 1 ? "disabled" : ""} onclick="setBoundedPage('${safeScope}','${safeId}',${info.page + 1})">Next</button></nav>`;
  }
  window.BOUNDED_PAGE_SIZES = DEFAULT_SIZES;
  window.boundedReadState = read;
  window.boundedWriteState = write;
  window.boundedPage = page;
  window.boundedSelected = selected;
  window.boundedPagerMarkup = pagerMarkup;
  window.boundedStatusPill = statusPill;
  window.setBoundedPage = (scope, id, nextPage) => { write(`page:${scope}`, id, Math.max(0, Number(nextPage) || 0)); window.route?.(); };
  window.selectBoundedItem = (scope, id, value) => { write(`selected:${scope}`, id, value); window.route?.(); };
  function focusedTask(scope, id, allowed, fallback = "") {
    const ids = Array.isArray(allowed) ? allowed.map(String).filter(Boolean) : [];
    if (!ids.length) return "";
    let stored = "";
    try { stored = localStorage.getItem(`cinebraid-focused:${projectKey()}:${scope}:${String(id || "root")}`) || ""; } catch {}
    if (/^\d+$/.test(stored)) stored = ids[Math.max(0, Math.min(ids.length - 1, Number(stored)))] || "";
    return ids.includes(stored) ? stored : (ids.includes(String(fallback || "")) ? String(fallback) : ids[0]);
  }
  window.boundedFocusedTask = focusedTask;
  // Match v6.6 focused-workspace storage so old and new layouts share one task preference.
  // The write is separated from the re-render because a cross-panel action selects the task
  // and then routes once itself; two writers of this key would be two task states.
  function writeFocusedTask(scope, id, value) {
    try { localStorage.setItem(`cinebraid-focused:${projectKey()}:${scope}:${String(id || "root")}`, String(value)); } catch {}
    return String(value);
  }
  window.boundedWriteFocusedTask = writeFocusedTask;
  window.selectBoundedTask = (scope, id, value) => {
    writeFocusedTask(scope, id, value);
    window.route?.();
  };
})();

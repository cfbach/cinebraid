/* CineBraid — the creator workspace shell runtime.

   The DECLARATION lives in public/shared-workspace-shell.js. This file is the
   browser half: it applies eligibility, tracks slot occupancy, and publishes the
   two measurements the shell's layout cannot express in static CSS.

   WHAT THIS FILE DELIBERATELY DOES NOT DO: construct regions. The shell's three
   regions are static markup in public/index.html, exactly like `#rail`, `#topbar`
   and `#main` have always been. That is not laziness — it is the property. A shell
   built by JavaScript is a shell that can be built twice, and "the rail slot is the
   same node it was before the stage changed" then depends on every future caller
   remembering to check. Static markup makes single-instance and cross-render
   identity true by construction, and leaves this file responsible only for state.

   ---------------------------------------------------------------------------
   WHY ANY JAVASCRIPT AT ALL. Exactly two things static CSS cannot answer:

   1. ELIGIBILITY. Whether a surface is a creator workspace depends on the route
      AND on whether a project is open — the first-run and project-failure screens
      render into `#main` on an otherwise eligible route.

   2. THE DOCK'S RESERVATION. The dock is out of document flow — that is what stops
      future Terminal volume from lengthening the page — so it cannot push the
      center up by existing. Its height depends on what a consumer mounted, bounded
      by the dock's own max-height, so no stylesheet can state it. It is measured
      here and given back through --cb-dock-reserve.

   A THIRD CANDIDATE WAS REJECTED ON EVIDENCE, recorded so it is not reintroduced:
   the dock's LEFT EDGE. Deriving it by measuring #workspace is not merely redundant,
   it is wrong — #app carries `zoom:var(--ui-scale)`, getBoundingClientRect reports
   post-zoom pixels, and writing those back into an element inside the zoomed subtree
   scales them a second time, so the dock would miss the navigation edge at every UI
   scale except 100%. It belongs in public/styles.css as --cb-nav-width, read by the
   #app grid and by the dock, and it is correct at any zoom because both sides scale
   together.

   No layout decision is made in this file. One number is, because only the running
   document knows it.

   ---------------------------------------------------------------------------
   SCROLL OWNERSHIP, stated once so it cannot be re-decided per consumer.

     the document      owns vertical scrolling of the page, as it always has.
                       `#rail` and `#topbar` are position:sticky and depend on it.
                       This batch does not move it.

     the rail slot     owns its own vertical scrolling, bounded to the viewport
                       below the topbar. An unbounded Assistant conversation must
                       not be able to lengthen the page.

     the dock slot     owns its own vertical scrolling, bounded by max-height, and
                       is position:fixed so its content is out of document flow.

   Nothing else in the shell scrolls. */

(function () {
  if (typeof document === "undefined") return;

  /* The shell root is the SHIPPED `#workspace` element, adopted rather than
     replaced — for the same reason `#main` is adopted as the center. `#workspace`
     already contains all three regions and already carries the workspace's sizing
     contract; introducing a second root beside it would mean two elements could
     disagree about whether the shell is present. */
  const SHELL_ROOT_ID = "workspace";
  const MAIN_REGION_ID = "cb-shell-main";
  /* The ONE number this file publishes, consumed by public/styles.css. Named rather
     than inlined so a suite can assert the runtime and the stylesheet are talking
     about the same property.

     There is deliberately no second variable for the dock's left inset. That began
     as a measurement here and became `--cb-nav-width` in the stylesheet, because
     #app carries `zoom:var(--ui-scale)` and a measured device-pixel offset written
     back into the zoomed subtree is scaled twice. CSS owns widths; this file owns
     only the height, which depends on mounted content and therefore cannot be
     declared anywhere. */
  const RESERVE_VARIABLE = "--cb-dock-reserve";

  function declaration() {
    /* The shared module assigns onto the same global scope this script shares. It is
       read through a function rather than captured at load so that a suite can prove
       this file has no private copy of the route list. */
    return typeof creatorShellState === "function"
      ? { creatorShellState, shellSlotElementId, MOUNTABLE_SLOT_NAMES, SHELL_SLOT_NAMES }
      : null;
  }

  function activeProject() {
    /* `P` is a top-level `let` in public/app.js, which in a classic script is a
       lexical binding on the shared script scope and NOT a property of `window`.
       Reading `window.P` here would be undefined on every route — the exact defect
       public/focused-workspaces.js documents at its own `activeProject`. */
    return typeof P === "undefined" ? null : P;
  }

  function currentView() {
    const hash = String(location.hash || "#/production").split("?")[0];
    return hash.split("/")[1] || "production";
  }

  function shellRoot() {
    return document.getElementById(SHELL_ROOT_ID);
  }

  function mainRegion() {
    return document.getElementById(MAIN_REGION_ID);
  }

  function slotElement(name) {
    const api = declaration();
    const id = api ? api.shellSlotElementId(name) : "";
    return id ? document.getElementById(id) : null;
  }

  function mountableNames() {
    const api = declaration();
    return api ? api.MOUNTABLE_SLOT_NAMES : [];
  }

  /* ==========================================================================
     OCCUPANCY.

     A slot holds its content in a dedicated child rather than directly, so that
     "is this slot occupied" is a question about one element's children and never
     about attributes a future consumer might also want to use. `data-occupied` is
     the rendered projection of that fact; `slotHasContent` reads the DOM, not the
     attribute, so the two cannot drift. */
  function slotBody(name) {
    const slot = slotElement(name);
    return slot ? slot.querySelector(":scope > .cb-shell-slot-body") : null;
  }

  function slotHasContent(name) {
    const body = slotBody(name);
    return !!body && body.childNodes.length > 0;
  }

  function syncSlotOccupancy(name) {
    const slot = slotElement(name);
    if (!slot) return;
    const occupied = slotHasContent(name);
    if (occupied) slot.dataset.occupied = "1";
    else delete slot.dataset.occupied;
  }

  /* ==========================================================================
     ELIGIBILITY.

     Applied to the shell root as a data attribute, which is what public/styles.css
     keys the whole shell off. An ineligible surface collapses both mountable slots
     and refuses new mounts.

     MOUNTED CONTENT IS RETAINED, NOT DESTROYED, when a surface becomes ineligible.
     Visiting Settings must not throw away an Assistant conversation and then hand
     the filmmaker a fresh one on the way back — persistence across navigation is
     the reason this shell exists. "Present" and "occupied" are therefore separate
     questions with separate readers. */
  function isShellPresent() {
    const root = shellRoot();
    return !!root && root.dataset.creatorShell === "1";
  }

  function syncCreatorShell() {
    const api = declaration();
    const root = shellRoot();
    if (!api || !root) return null;
    const state = api.creatorShellState({ view: currentView(), hasProject: !!activeProject() });
    if (state.present) {
      root.dataset.creatorShell = "1";
      delete root.dataset.creatorShellBlocked;
    } else {
      delete root.dataset.creatorShell;
      root.dataset.creatorShellBlocked = state.reason;
    }
    api.MOUNTABLE_SLOT_NAMES.forEach(syncSlotOccupancy);
    measure();
    return state;
  }

  /* ==========================================================================
     THE TWO MEASUREMENTS.

     Written onto `#app` rather than `:root` so that the shell's numbers live with
     the shell's other runtime state (`data-acc`, `data-surf`, `--ui-scale`) instead
     of in a second place nobody thinks to look. */
  function variableHost() {
    return document.getElementById("app") || document.documentElement;
  }

  function measure() {
    const host = variableHost();
    if (!host || !host.style) return;
    /* The reservation is the dock's real rendered height, and it is zero whenever
       the dock is not showing — including on an ineligible surface, where the dock
       may still hold retained content. Reserving space for something that is not
       painted would leave a permanent empty band at the bottom of Settings. */
    const dock = slotElement("dock");
    const shown = isShellPresent() && slotHasContent("dock");
    const height = shown && dock && typeof dock.getBoundingClientRect === "function"
      ? Math.round(dock.getBoundingClientRect().height)
      : 0;
    host.style.setProperty(RESERVE_VARIABLE, `${height}px`);
  }

  /* ==========================================================================
     THE MOUNT API.

     Deliberately four functions. A future consumer needs to put a node somewhere,
     take it away again, ask whether it is there, and be told when the shell's
     eligibility changed under it. Anything more general than that would be a portal
     system, and this batch is not the place to invent one.

     `mountSlot` replaces rather than appends. Two Assistants in one rail is not a
     state any caller wants, and an API that permits it will eventually produce it. */
  function mountSlot(name, node) {
    if (!mountableNames().includes(String(name))) return false;
    const body = slotBody(name);
    if (!body || !node) return false;
    body.replaceChildren(node);
    syncSlotOccupancy(name);
    measure();
    return true;
  }

  function clearSlot(name) {
    if (!mountableNames().includes(String(name))) return false;
    const body = slotBody(name);
    if (!body) return false;
    body.replaceChildren();
    syncSlotOccupancy(name);
    measure();
    return true;
  }

  /* ==========================================================================
     WIRING.

     The same four signals public/focused-workspaces.js listens to, for the same
     reason: they are the points at which the route or the project can have changed.
     Note what is NOT here — no edit to public/app.js's `route()`. The shell reacts
     to the render rather than being driven by it, which is what keeps the renderer
     ignorant of the shell and therefore keeps the shell stage-agnostic. */
  let observer = null;
  function watch() {
    if (observer || typeof ResizeObserver !== "function") return;
    /* The dock only. Its height is the one shell number CSS cannot state, because it
       depends on what a consumer mounted. Everything else about the shell's geometry
       is declared in public/styles.css and is not watched from here. */
    observer = new ResizeObserver(() => measure());
    const dock = slotElement("dock");
    if (dock) observer.observe(dock);
  }

  function start() {
    syncCreatorShell();
    watch();
  }

  window.addEventListener("hashchange", syncCreatorShell);
  window.addEventListener("cinebraid:route-rendered", syncCreatorShell);
  window.addEventListener("cinebraid:workspace-updated", syncCreatorShell);
  window.addEventListener("load", start);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.CineBraidShell = {
    slot: slotElement,
    slotHasContent,
    mountSlot,
    clearSlot,
    isShellPresent,
    syncCreatorShell,
  };
  /* Exported for the suites, which must be able to drive the runtime's OWN
     measurement rather than a reimplementation of it — proving two surfaces agree
     is worth nothing if the test computes one of them itself. */
  window.__CINEBRAID_SHELL = {
    SHELL_ROOT_ID,
    MAIN_REGION_ID,
    mainRegion,
    RESERVE_VARIABLE,
    currentView,
    activeProject,
    slotBody,
    measure,
    variableHost,
  };
})();

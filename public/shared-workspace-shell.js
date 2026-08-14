/* CineBraid — the declared creator workspace shell, shared by browser and Node the
   same way public/shared-stage-model.js is shared.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: CineBraid knows which surfaces
   are creator workspaces, and which regions a creator workspace has, because they
   are declared here — not because a stage renderer happened to build a column.

   ---------------------------------------------------------------------------
   WHAT THIS IS FOR. The shipped page has exactly one content slot, `#main`, and
   public/app.js replaces its innerHTML wholesale on every route render — including
   the renders caused by switching between the five declared shot stages, which do
   not change the hash at all (see public/shared-stage-model.js: stage navigation is
   `task-selection`, not routing). Anything a filmmaker should keep across a stage
   change therefore cannot live inside `#main`.

   The Assistant rail and the Activity Terminal are both such things. Neither is
   built here. This module declares WHERE they will live and WHEN a surface has
   somewhere to put them, so that the code which eventually builds them does not
   also have to decide the page layout, and so that five stages do not grow five
   answers to the same question — which is precisely the failure public/shared-stage-model.js
   was written to undo for stages.

   ---------------------------------------------------------------------------
   THREE PROPERTIES THAT ARE STRUCTURAL HERE RATHER THAN MERELY TESTED.

   * NOTHING IS STORED. No project field records shell presence, slot occupancy,
     rail width or dock height. Eligibility is DERIVED on every call from the route
     and whether a project is open. A caller that persists the result has created
     production state out of a page layout, which is the thing this module must not
     become. tests/workspace-shell-negative-controls.js breaks that line and
     requires a failure.

   * ELIGIBILITY IS ONE ANSWER, NOT A CASCADE. A surface is a creator workspace or
     it is not, and the list is here. The alternative — per-region CSS exceptions
     for Settings, for the first-run screen, for the project-failure screen — is how
     a shell acquires four disagreeing opinions about whether it is present.

     Eligibility is the SHELL's question and it is coarse on purpose: it answers
     "does this surface have somewhere to put persistent tools", not "does this
     particular tool have anything to say here". A consumer whose content is
     narrower than the shell — O4's stage strip exists only on a shot — answers its
     own narrower question by declining to mount, which collapses its slot. Pushing
     that distinction down here would give the shell an opinion about what its
     consumers are for, and the slot list would then have to grow a route list each.

   * THE SLOTS ARE DECLARED, THE CONTENT IS NOT. This module names three regions
     and says nothing whatever about what goes in them. It contains no reference to
     `inputs`, `look`, `frames`, `motion` or `deliver`, and no reference to the
     Assistant or the Terminal beyond naming their slots. A shell that knows what a
     stage is has stopped being stage-agnostic.

   ---------------------------------------------------------------------------
   THE VOCABULARY.

     center   The filmmaker's current production task. This is the SHIPPED `#main`
              element, adopted rather than replaced — every existing view renders
              into it exactly as before.

     bar      Persistent horizontal slot directly beneath the topbar and above the
              centre. Full workspace width, its own HORIZONTAL scroll, and sticky —
              it is the one region a filmmaker is meant to be able to read without
              scrolling back up. Added in O4 for the stage strip and its actions.

              Note the axis, which is why `scroll` distinguishes them. The rail and
              the dock bound CONTENT VOLUME, so they own their vertical scroll
              ("self"). The bar's content is a fixed small number of items whose
              combined WIDTH can exceed a narrow viewport, so it owns its horizontal
              scroll and nothing else ("self-horizontal") — a bar that scrolled
              vertically would be a bar that could grow, and a persistent surface
              that can grow eventually eats the workspace it sits above.

     rail     Persistent right-hand slot. Bounded width, its own vertical scroll.
              Reserved for the future Assistant. Empty in this batch.

     dock     Persistent bottom slot. Bounded height, its own vertical scroll, and
              out of document flow so its future content volume cannot lengthen the
              page. Reserved for the future Activity Terminal. Empty in this batch.

     Note what `dock` is NOT: it is not the Activity drawer. The drawer is a modal
     overlay that covers the workspace and is dismissed; the dock is a persistent
     surface that reserves space and stays. They coexist deliberately — the drawer
     paints above the dock and is untouched by this module.

   OCCUPANCY, and why an empty slot collapses. A declared slot with no content
   renders nothing and occupies no space. The DOM node still exists — that is the
   identity guarantee the later work depends on — but a permanently visible empty
   rectangle labelled with a feature that does not exist yet is a claim the app
   cannot support. Collapsed-until-mounted is the least misleading behaviour and it
   is also the one under which this batch changes no shipped pixel. */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  function shellText(value) {
    return String(value == null ? "" : value).trim();
  }

  /* ==========================================================================
     THE REGION DECLARATION.

     `element` is the id the runtime gives the slot in the document. `center` names
     the SHIPPED element — this module adopts `#main` rather than introducing a
     rival content slot, because a second content region would mean every view
     renderer had to be told which one to use.

     `owner` records who is allowed to put content in the slot, and is the field
     that keeps this batch honest: the shell owns the region, a future consumer owns
     the content, and neither owns the other. */
  const SHELL_SLOTS = deepFreeze([
    {
      name: "center",
      element: "main",
      owner: "the current production workspace",
      purpose: "The filmmaker's current production task.",
      /* The shell does not create or destroy the center; public/app.js has always
         owned its contents and continues to. */
      mountable: false,
      collapsesWhenEmpty: false,
      scroll: "document",
    },
    {
      name: "bar",
      element: "cb-shell-bar",
      owner: "the persistent workflow navigator and its stage actions",
      purpose: "Persistent horizontal slot between the topbar and the current production task.",
      mountable: true,
      collapsesWhenEmpty: true,
      /* Horizontal only. See THE VOCABULARY: this slot bounds width, not volume. */
      scroll: "self-horizontal",
    },
    {
      name: "rail",
      element: "cb-shell-rail",
      owner: "a future persistent Assistant",
      purpose: "Persistent right-hand slot beside the current production task.",
      mountable: true,
      collapsesWhenEmpty: true,
      /* The rail scrolls INSIDE ITSELF rather than lengthening the page, because a
         conversation is unbounded and the page is not. */
      scroll: "self",
    },
    {
      name: "dock",
      element: "cb-shell-dock",
      owner: "a future Activity Terminal",
      purpose: "Persistent bottom slot beneath the whole workspace.",
      mountable: true,
      collapsesWhenEmpty: true,
      scroll: "self",
    },
  ]);

  const SHELL_SLOT_NAMES = deepFreeze(SHELL_SLOTS.map((slot) => slot.name));
  const MOUNTABLE_SLOT_NAMES = deepFreeze(SHELL_SLOTS.filter((slot) => slot.mountable).map((slot) => slot.name));

  function shellSlot(name) {
    const key = shellText(name);
    return SHELL_SLOTS.find((slot) => slot.name === key) || null;
  }

  function shellSlotElementId(name) {
    return shellSlot(name)?.element || "";
  }

  /* ==========================================================================
     THE ELIGIBILITY DECLARATION.

     These are the `view` values public/app.js's `route()` derives from the hash —
     the keys of ROUTES in public/views.js — and nothing else. A hash naming no
     declared view falls through to the production view in the runtime, and falls
     through to ineligible here, which is the safe direction: a surface gains the
     shell by being named, never by being unrecognised. */
  const CREATOR_SHELL_VIEWS = deepFreeze([
    "production",
    "shots",
    "shot",
    "scene",
    "library",
    "characters",
    "locations",
    "props",
    "vehicles",
    "audio",
    "character",
    "location",
    "prop",
    "vehicle",
    "sound",
    "reports",
  ]);

  /* Declared exclusions, with the reason attached. These are stated rather than
     merely omitted so that "Settings has no rail" is a decision on the record and
     not an oversight somebody later corrects by accident. Two of CineBraid's four
     surfaces are separate documents — public/login.html and public/bible.html carry
     neither `#app` nor `#main` and never load public/app.js — so they cannot inherit
     the shell by construction and need no entry here. */
  const EXCLUDED_SHELL_VIEWS = deepFreeze({
    settings: "Settings configures the application; it is not a production task, and persistent production tools there would be describing work the surface cannot do.",
    create: "The new-project surface is bootstrap. There is no production to assist with until a project exists.",
  });

  const EXCLUDED_SHELL_VIEW_NAMES = deepFreeze(Object.keys(EXCLUDED_SHELL_VIEWS));

  function isCreatorShellView(view) {
    const key = shellText(view);
    if (!key) return false;
    if (Object.prototype.hasOwnProperty.call(EXCLUDED_SHELL_VIEWS, key)) return false;
    return CREATOR_SHELL_VIEWS.includes(key);
  }

  /* ==========================================================================
     THE DERIVATION.

     One function, reading two facts. `hasProject` is separate from the view name
     because the first-run screen and the project-failure screen both render into
     `#main` on a route whose NAME is eligible — public/app.js renders them for
     `#/production` when there is nothing to open. Deriving eligibility from the
     route alone would put an Assistant rail beside "no project is open", which is a
     workspace claiming to assist with work that does not exist.

     `reason` is returned for the ineligible case so a caller can say why without
     re-deriving it, and so a test can distinguish "excluded surface" from "no
     project" — two different bugs that look identical from the outside. */
  function creatorShellState(facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const view = shellText(raw.view);
    const hasProject = !!raw.hasProject;
    if (!hasProject) return { present: false, view, reason: "no-project" };
    if (Object.prototype.hasOwnProperty.call(EXCLUDED_SHELL_VIEWS, view))
      return { present: false, view, reason: "excluded-view" };
    if (!isCreatorShellView(view)) return { present: false, view, reason: "unknown-view" };
    return { present: true, view, reason: "" };
  }

  return {
    SHELL_SLOTS,
    SHELL_SLOT_NAMES,
    MOUNTABLE_SLOT_NAMES,
    CREATOR_SHELL_VIEWS,
    EXCLUDED_SHELL_VIEWS,
    EXCLUDED_SHELL_VIEW_NAMES,
    shellSlot,
    shellSlotElementId,
    isCreatorShellView,
    creatorShellState,
  };
});

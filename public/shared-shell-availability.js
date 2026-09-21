/* CineBraid — WHAT THE SHELL CAN HONESTLY OFFER WHEN NO PROJECT IS OPEN.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: a control in the CineBraid shell
 * is enabled only where pressing it does the thing it says, and where it is not,
 * it says why — because that answer is DECLARED here, once, rather than decided
 * separately by the navigation, the add chooser, the rail foot, the topbar and the
 * router.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG WITHOUT IT. Measured on the shipped build at 3b20a4f, with an
 * empty projects root:
 *
 *   * all seven primary navigation items were enabled; all seven moved the hash
 *     and left the welcome card on screen, so the URL said `#/settings`, the rail
 *     said Production and the page said neither;
 *   * `＋ Add` offered eight records, seven of which cannot exist without a
 *     project;
 *   * `＋ Add → New project` closed the chooser and did nothing;
 *   * `Sync local folders` reported "Local folders synced" with nothing to sync;
 *   * the Activity control reported `aria-expanded="true"` over a dock of zero
 *     height;
 *   * nine unknown hashes rendered Production, three of them under a lit Shots
 *     navigation item.
 *
 * Every one of those is the same defect: a surface deciding for itself whether
 * the shell can do something, and deciding wrong. So the decision is taken out of
 * all of them and written down here.
 *
 * ---------------------------------------------------------------------------
 * THREE PROPERTIES THAT ARE STRUCTURAL HERE RATHER THAN MERELY TESTED.
 *
 *   * NOTHING IS STORED. Availability is DERIVED from one fact — is a project
 *     open — on every call. A caller that caches the answer has made a page state
 *     out of a project fact, and will be wrong the moment a project is opened or
 *     closed.
 *
 *   * A REASON IS PART OF THE ANSWER, NOT A DECORATION. Every unavailable answer
 *     carries the sentence that explains it, so a control cannot be disabled in
 *     one place and explained in another — which is how a build ends up with a
 *     greyed button and no way to learn why. `tests/no-project-shell-truth.js`
 *     requires every unavailable answer to carry one.
 *
 *   * THIS FILE KNOWS NOTHING ABOUT DOM. It names views, controls and reasons.
 *     It does not know that navigation is a `<button>`, that the reason is shown
 *     in the rail foot, or that the router writes `#main`. Those are the runtime's
 *     business, and a predicate that reached into them could not be read by Node.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE.
 *
 *   * HOW A REFUSED ENTITY FORM IS DRAWN. Whether a shot, scene or reference may be
 *     created at all is decided here (ORPHAN_ENTITY_CREATION_REFUSAL_V1, below the add
 *     chooser); where the refusal appears — the chooser, the form's own SAVE — is the
 *     runtime's business, for the same reason the rail's note is.
 *
 *   * WHAT `#/create` LOOKS LIKE, OR WHERE A NEW PROJECT LANDS. The start surface
 *     still says "The one you have open now is not changed", which is not true when
 *     none is open — correcting it is `PROJECT_CREATION_LANDING_V1`'s work. So with
 *     no project a `#/create` is answered IN PLACE by the welcome screen, which is
 *     the start surface a projectless install genuinely has, under the same topbar
 *     word and the same unlit rail the project shell gives `#/create`. The address is
 *     never rewritten: `newProject()` sets `#/create` BEFORE it loads the project it
 *     just made, so a rewrite here would silently move that landing — which is
 *     exactly the change this slice is not allowed to make.
 */

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

  function availabilityText(value) {
    return String(value == null ? "" : value).trim();
  }

  /* ==========================================================================
     THE ONE SENTENCE EVERY REFUSAL ENDS WITH.

     Written once so seven controls cannot end up telling a filmmaker seven
     slightly different things about the same missing project — and so the two
     actions that DO work when nothing is open are named in every refusal, rather
     than being something the person has to go and find. */
  const SHELL_NO_PROJECT_REMEDY = "Create a project or open an existing one first.";

  const SHELL_NO_PROJECT_REASONS = deepFreeze({
    nav: `This part of CineBraid works inside a project. ${SHELL_NO_PROJECT_REMEDY}`,
    add: `Records like shots and references belong to a project. ${SHELL_NO_PROJECT_REMEDY}`,
    rescan: `Local folders are synced into an open project, and none is open. ${SHELL_NO_PROJECT_REMEDY}`,
    activity: `Activity reports the work running in an open project, and none is open. ${SHELL_NO_PROJECT_REMEDY}`,
    search: `Search reads the canon of an open project, and none is open. ${SHELL_NO_PROJECT_REMEDY}`,
    settingsProject: `These settings are stored in the project record, and no project is open. ${SHELL_NO_PROJECT_REMEDY}`,
    route: `This workspace is part of a project. ${SHELL_NO_PROJECT_REMEDY}`,
  });

  /* ==========================================================================
     THE SHELL'S HOME, AND THE TWO THINGS THAT WORK WITHOUT A PROJECT.

     `production` is the home in both states: with a project it is the production
     workspace, and without one it is the welcome/start screen the runtime already
     renders there. Keeping ONE home means the rail's first item is always the way
     back — which is how Settings stays reachable without stranding anybody, and
     why returning from it needs no browser Back.

     Settings is here because the entire point of reaching it before a project
     exists is to configure the integrations a first project will use. Studio-level
     settings and Connections are application-wide facts; they do not become
     readable because a project was created. */
  const SHELL_HOME_VIEW = "production";

  const SHELL_NO_PROJECT_VIEWS = deepFreeze([SHELL_HOME_VIEW, "settings"]);

  /* The primary navigation items that cannot do their job without a project. These
     are `data-view` values in the shipped rail, and the list is exactly the rail
     minus the two above. */
  const SHELL_PROJECT_DEPENDENT_NAV = deepFreeze(["shots", "library", "results", "bible", "reports"]);

  /* Settings sections whose content is stored in the project record rather than in
     the application configuration. They are reachable without a project — a person
     looking for them should find out WHY they cannot be used, not find a dead link
     — and they refuse visibly when opened. */
  const SHELL_PROJECT_SCOPED_SETTINGS = deepFreeze(["project", "project-recovery"]);

  /* Views that exist, are project work, and are therefore refused in words when a
     pasted URL reaches them with nothing open. `create` is not here: see the header. */
  const SHELL_PROJECT_DEPENDENT_VIEWS = deepFreeze([
    "shots", "library", "results", "bible", "reports",
    "scene", "shot",
    "character", "location", "prop", "vehicle", "sound",
    "characters", "locations", "props", "vehicles", "audio",
  ]);

  /* Known views that, with no project open, are answered IN PLACE by the welcome
     screen — the start surface a projectless install actually has. See the header
     for why the address is left exactly as it was asked for. */
  const SHELL_START_VIEWS = deepFreeze(["create"]);

  /* The names these views carry in the topbar. A SUBSET of public/app.js's own
     `updateChrome()` table, repeated here because the no-project router cannot call
     into a function that needs a project — and pinned to it by
     tests/no-project-shell-truth.js, so the two cannot drift. `production` is
     absent deliberately: with no project open the home is not Production, it is the
     welcome screen, and SHELL_HOME_LABEL is what the topbar says there. */
  const SHELL_VIEW_LABELS = deepFreeze({
    bible: "Project Bible",
    shots: "Shots",
    library: "References",
    results: "Production media",
    reports: "Reports",
    settings: "Settings",
    scene: "Scene",
    shot: "Shot",
    character: "Character",
    location: "Location",
    prop: "Prop",
    vehicle: "Vehicle",
    sound: "Audio asset",
    create: "New Project",
  });

  const SHELL_HOME_LABEL = "Welcome";
  const SHELL_NOT_FOUND_LABEL = "Not found";

  function shellViewLabel(view) {
    const key = availabilityText(view);
    if (key === SHELL_HOME_VIEW) return SHELL_HOME_LABEL;
    return SHELL_VIEW_LABELS[key] || "";
  }

  /* ==========================================================================
     NAVIGATION.

     One answer per rail item. With a project open every item is available and the
     reason is empty — the shell does not acquire a second opinion about a working
     build. */
  function shellNavAvailability(view, facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const hasProject = !!raw.hasProject;
    const key = availabilityText(view);
    if (hasProject) return { view: key, available: true, reason: "" };
    if (SHELL_PROJECT_DEPENDENT_NAV.includes(key))
      return { view: key, available: false, reason: SHELL_NO_PROJECT_REASONS.nav };
    return { view: key, available: true, reason: "" };
  }

  /* The rail items a filmmaker can press right now, and the ones they cannot. Both
     lists are returned because the visible explanation names the unavailable set,
     and a sentence that listed them separately would be a second place to get the
     list wrong. */
  function shellNavPartition(facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const asked = availabilityList(raw.views);
    const rows = asked.length ? asked : [...SHELL_NO_PROJECT_VIEWS, ...SHELL_PROJECT_DEPENDENT_NAV];
    const available = [], unavailable = [];
    for (const view of rows) (shellNavAvailability(view, raw).available ? available : unavailable).push(view);
    return { available, unavailable };
  }

  function availabilityList(value) {
    return Array.isArray(value) ? value.map(availabilityText).filter(Boolean) : [];
  }

  /* ==========================================================================
     THE ROUTER'S ANSWER WHEN NO PROJECT IS OPEN.

     Four kinds, and the caller renders one surface per kind:

       home          the welcome/start screen — on the shell's home route, and in
                     place for `#/create` (see the header).
       settings      Settings, which needs no project to be useful.
       needs-project a real project workspace, reached by a pasted or bookmarked
                     URL — refused in words rather than answered with somebody
                     else's screen.
       not-found     a hash naming no view at all.

     `navView` is the rail item that may be lit. It is "" wherever nothing in the
     rail is the surface being shown, so nothing in the rail may claim to be — which
     is the exact disagreement this slice removes. `#/create` lights nothing for the
     same reason it lights nothing with a project open: the rail has no item for it.

     The address is NEVER rewritten here. Every answer is drawn at the hash that was
     asked for, so the only thing that can move the address bar is the person. */
  function shellRouteWithoutProject(view, facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const known = availabilityList(raw.knownRoutes);
    const key = availabilityText(view) || SHELL_HOME_VIEW;
    if (key === SHELL_HOME_VIEW)
      return { kind: "home", view: key, navView: SHELL_HOME_VIEW, label: SHELL_HOME_LABEL, reason: "" };
    if (key === "settings")
      return { kind: "settings", view: key, navView: "settings", label: SHELL_VIEW_LABELS.settings, reason: "" };
    if (SHELL_START_VIEWS.includes(key))
      return { kind: "home", view: key, navView: "", label: SHELL_VIEW_LABELS[key], reason: "" };
    /* A view this build does not have is not a project problem, so it is answered
       as what it is. Asked WITHOUT a route table — a caller that has not loaded one
       — the declared project views still answer for themselves, and everything else
       is unknown, which is the safe direction: a surface is claimed by being named. */
    if (known.length ? !known.includes(key) : !SHELL_PROJECT_DEPENDENT_VIEWS.includes(key))
      return { kind: "not-found", view: key, navView: "", label: SHELL_NOT_FOUND_LABEL, reason: "" };
    return {
      kind: "needs-project",
      view: key,
      navView: "",
      label: shellViewLabel(key) || SHELL_VIEW_LABELS.shots,
      reason: SHELL_NO_PROJECT_REASONS.route,
    };
  }

  /* WITH a project open, the only thing the shell still owes an answer about is a
     hash naming no view — the nine ghost routes that fell through to Production.
     This is deliberately separate from the function above: the no-project shell and
     the unknown-route fall-through are two different defects, and a single function
     answering both would make it impossible to change one without touching the
     other. */
  function shellRouteIsKnown(view, knownRoutes) {
    const known = availabilityList(knownRoutes);
    const key = availabilityText(view) || SHELL_HOME_VIEW;
    return known.includes(key);
  }

  /* ==========================================================================
     ORPHAN_ENTITY_CREATION_REFUSAL_V1 — A RECORD IS CREATED INTO A PROJECT, OR NOT AT ALL.

     Every record the add control makes other than a project — shot, scene,
     character, location, prop, vehicle, audio — is pushed into the open project's
     record and saved with it. With no record to push into, the shipped forms opened
     anyway, took the filmmaker's typing, closed on SAVE and threw it away: no
     request, no message, no error on screen. Measured at 12a338d in four states,
     not one:

       first run      the chooser was already honest, but every direct creator
                      (openContextualAdd, runGlobalAdd, addEntity, addScene) still
                      opened its form;
       Recovery mode  the chooser offered all seven records and six of them opened
       load failure   a form that discarded its input;
       still opening  a form opened before the project arrived discarded its input
                      if SAVE was pressed before it did.

     THE FACT IS THE RECORD, NOT "IS A PROJECT OPEN". `hasProject` above means "the
     shell has not confirmed first run", which is deliberately TRUE in the last three
     states so the rail keeps its shipped behaviour there. A record cannot be written
     into any of them, so creation asks the narrower question: `projectRecord`, whether
     this window holds a project record the save path can write. A caller that has
     not learnt that fact is answered from `hasProject`, exactly as before.

     ONE ANSWER CARRIES EVERYTHING A SURFACE NEEDS: the `state` it is in, the
     `heading` and `reason` it says, and the one `action` it may offer. A surface
     renders that answer; it does not decide a second one.

       state        action           when
       open         —                a project record is installed and nothing is opening
       opening      wait             a project is being opened or created. Nothing is
                                     offered — not New project, not Open project, not a
                                     form — because each would start a second project
                                     operation beside the one already running
       no-project   create-project   confirmed first run
       unopenable   create-project   Recovery mode, a failed load: no record, no open running
       replaced     none             a form's SAVE, when a DIFFERENT project is installed
                                     than the one the form was opened for
       gone         none             a form's SAVE, when the project it was opened for is
                                     no longer installed and none has replaced it

     THE LAST TWO ARE A FORM'S, AND ONLY A FORM'S. A form is drawn for one project;
     `projectChanged` is the runtime's report that the project installed at SAVE is
     not that one. "Both P and a slug are truthy again" is not the same project, and a
     record saved on that basis lands in whichever project happens to be open.

     THE PRE-OPEN REASON IS THE ONE THE ADD CONTROL ALREADY OWNED.
     SHELL_NO_PROJECT_REASONS.add was declared for the chooser and ends in the shell's
     one remedy. The four sentences below end differently on purpose: "create a
     project" is not true advice while one is opening, or to a form whose own project
     went away. */
  const SHELL_RECORD_LABELS = deepFreeze({
    shot: "Shot", scene: "Scene", character: "Character", location: "Location",
    prop: "Prop", vehicle: "Vehicle", audio: "Audio",
  });

  const SHELL_ENTITY_CREATION_TEXT = deepFreeze({
    openingHeading: "The project is still opening",
    opening: "Records are added to a project once it has opened. Wait until it finishes before adding records.",
    replaced: "This form was opened in a different project from the one open now, so nothing was saved — saving here would put the record in the wrong project. Everything you entered is still in the form.",
    gone: "The project this form was opened in is no longer open, so nothing was saved. Everything you entered is still in the form.",
  });

  function shellEntityCreationAvailability(key, facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const record = availabilityText(key);
    const label = SHELL_RECORD_LABELS[record] || "This record";
    if (raw.opening)
      return { record, available: false, state: "opening", action: "wait",
        heading: SHELL_ENTITY_CREATION_TEXT.openingHeading, reason: SHELL_ENTITY_CREATION_TEXT.opening };
    const writable = Object.prototype.hasOwnProperty.call(raw, "projectRecord") ? !!raw.projectRecord : !!raw.hasProject;
    if (raw.projectChanged === true)
      return writable
        ? { record, available: false, state: "replaced", action: "none", heading: `${label} was not saved`, reason: SHELL_ENTITY_CREATION_TEXT.replaced }
        : { record, available: false, state: "gone", action: "none", heading: `${label} was not saved`, reason: SHELL_ENTITY_CREATION_TEXT.gone };
    if (writable) return { record, available: true, state: "open", action: "", heading: "", reason: "" };
    return { record, available: false, state: raw.hasProject ? "unopenable" : "no-project", action: "create-project",
      heading: `${label} needs an open project`, reason: SHELL_NO_PROJECT_REASONS.add };
  }

  /* ==========================================================================
     THE ADD CHOOSER.

     Only the record that can exist without a project. Everything else is a child
     of one, and offering it is the promise the shipped build could not keep — so a
     child record is offered exactly when it could be created, and New project exactly
     when the answer above permits that action. Both are the answer above, not a
     second one. */
  function shellAddChoiceAvailable(key, facts) {
    if (availabilityText(key) === "project") return shellEntityCreationAvailability("", facts).state !== "opening";
    return shellEntityCreationAvailability(key, facts).available;
  }

  function shellAddChoices(keys, facts) {
    return availabilityList(keys).filter((key) => shellAddChoiceAvailable(key, facts));
  }

  /* ==========================================================================
     THE TWO RAIL/TOPBAR UTILITIES.

     `state` is the word the control itself shows when it cannot act, because a
     control that only dims has not said anything. Braidy is NOT here: it already
     hides and disables itself correctly with no project, and a second owner for a
     working answer is how a working answer stops working. */
  const SHELL_UTILITIES = deepFreeze({
    rescan: { reason: SHELL_NO_PROJECT_REASONS.rescan, state: "No project" },
    activity: { reason: SHELL_NO_PROJECT_REASONS.activity, state: "No project" },
    /* THE TOPBAR SEARCH. Its `state` is what the box itself says in place of "Search
       canon", because an input's placeholder is the one place a sighted person reads
       before typing. Measured on first run: 3b20a4f left it enabled and inert (typing
       did nothing at all), and wiring it the way a project window does sends
       POST /api/search to a server with no project file — which takes the whole local
       server down. There is no meaningful search without a project to search. */
    search: { reason: SHELL_NO_PROJECT_REASONS.search, state: "Open a project to search canon" },
  });

  const SHELL_UTILITY_NAMES = deepFreeze(Object.keys(SHELL_UTILITIES));

  function shellUtilityAvailability(name, facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const key = availabilityText(name);
    const declared = Object.prototype.hasOwnProperty.call(SHELL_UTILITIES, key) ? SHELL_UTILITIES[key] : null;
    if (!declared) return { utility: key, available: true, reason: "", state: "" };
    if (raw.hasProject) return { utility: key, available: true, reason: "", state: "" };
    return { utility: key, available: false, reason: declared.reason, state: declared.state };
  }

  /* ==========================================================================
     SETTINGS SCOPE.

     Application-wide sections are available always — that is what "application
     wide" means, and it is the whole reason Settings is reachable before a first
     project. A project-scoped section refuses, in words, on the panel where a
     person went looking for it. */
  function shellSettingsScopeAvailability(section, facts) {
    const raw = facts && typeof facts === "object" ? facts : {};
    const key = availabilityText(section);
    const projectScoped = SHELL_PROJECT_SCOPED_SETTINGS.includes(key);
    if (!projectScoped || raw.hasProject)
      return { section: key, projectScoped, available: true, reason: "" };
    return { section: key, projectScoped, available: false, reason: SHELL_NO_PROJECT_REASONS.settingsProject };
  }

  return {
    SHELL_NO_PROJECT_REMEDY,
    SHELL_NO_PROJECT_REASONS,
    SHELL_HOME_VIEW,
    SHELL_HOME_LABEL,
    SHELL_NOT_FOUND_LABEL,
    SHELL_NO_PROJECT_VIEWS,
    SHELL_PROJECT_DEPENDENT_NAV,
    SHELL_PROJECT_DEPENDENT_VIEWS,
    SHELL_PROJECT_SCOPED_SETTINGS,
    SHELL_START_VIEWS,
    SHELL_VIEW_LABELS,
    SHELL_UTILITIES,
    SHELL_UTILITY_NAMES,
    shellViewLabel,
    shellNavAvailability,
    shellNavPartition,
    shellRouteWithoutProject,
    shellRouteIsKnown,
    SHELL_RECORD_LABELS,
    SHELL_ENTITY_CREATION_TEXT,
    shellEntityCreationAvailability,
    shellAddChoiceAvailable,
    shellAddChoices,
    shellUtilityAvailability,
    shellSettingsScopeAvailability,
  };
});

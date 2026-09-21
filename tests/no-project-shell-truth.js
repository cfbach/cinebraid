/* NO_PROJECT_SHELL_TRUTH_V1 — THE SHELL CANNOT OFFER WHAT IT CANNOT DO.
 *
 * Measured on the shipped build at 3b20a4f with an empty projects root, a filmmaker's
 * first minute was: press Settings, nothing happens; press ＋ Add → New project,
 * nothing happens; press anything else in the rail, the welcome card stays up under a
 * hash that says otherwise. Seven navigation items were enabled and seven did nothing;
 * nine hashes that name no view rendered Production, three of them under a lit Shots
 * item; the Activity control reported an open drawer over zero pixels.
 *
 * This suite pins the repair at the level Node can actually see: the predicate that
 * decides availability, and the places in the shipped source that are now required to
 * ask it instead of deciding for themselves. What a filmmaker SEES — a refused press
 * that changes no hash, Settings rendering with nothing open, a ghost route answered as
 * not found — is measured in a real browser by tests/no-project-shell-truth-real-browser.py,
 * because those are claims about a running document and a source assertion would only
 * look like proof of them.
 *
 * The companion tests/no-project-shell-truth-negative-controls.js breaks one property
 * per control against a COPY of the shipped tree and requires the named check below to
 * go red for it.
 *
 * NOTHING IS CONFIGURED, RUN OR PAID FOR. No server, no network, no project, no
 * credential; every file is read and none is written.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* The shipped tree, unless a negative control points this at a patched COPY of it. */
const ROOT = process.env.NO_PROJECT_SHELL_SOURCE_ROOT || path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const Availability = require(path.join(ROOT, 'public', 'shared-shell-availability.js'));
const {
  SHELL_NO_PROJECT_REMEDY, SHELL_NO_PROJECT_REASONS, SHELL_HOME_VIEW, SHELL_HOME_LABEL,
  SHELL_NOT_FOUND_LABEL, SHELL_NO_PROJECT_VIEWS, SHELL_PROJECT_DEPENDENT_NAV,
  SHELL_PROJECT_DEPENDENT_VIEWS, SHELL_PROJECT_SCOPED_SETTINGS, SHELL_START_VIEWS,
  SHELL_VIEW_LABELS, SHELL_UTILITY_NAMES, shellViewLabel, shellNavAvailability,
  shellNavPartition, shellRouteWithoutProject, shellRouteIsKnown, shellAddChoiceAvailable,
  shellAddChoices, shellUtilityAvailability, shellSettingsScopeAvailability,
} = Availability;

const notes = [];
const note = (line) => notes.push(line);
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

/* The rail the product actually ships, read out of the markup rather than retyped, so a
   navigation item added or removed in public/index.html cannot leave this suite
   asserting about a shell that no longer exists. */
function shippedNavViews() {
  const html = read('public/index.html');
  return [...html.matchAll(/<button data-view="([a-z-]+)" data-label="([^"]+)"/g)].map((m) => ({ view: m[1], label: m[2] }));
}

/* The route table the runtime dispatches on. Parsed from its own object literal for the
   same reason. */
function shippedRouteKeys() {
  const src = read('public/views.js');
  const start = src.indexOf('\nconst ROUTES = {');
  assert.ok(start > 0, 'public/views.js no longer declares a ROUTES object literal');
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  return [...src.slice(start, end).matchAll(/^ {2}(?:async )?"?([a-zA-Z][a-zA-Z-]*)"?\(/gm)].map((m) => m[1]);
}

/* The nine hashes the assessment measured falling through to Production, plus one that
   nobody would ever type on purpose. */
const GHOST_HASHES = ['board', 'scenes', 'queue', 'activity', 'sessions', 'runs', 'canon', 'sources', 'zzz-nonsense-hash'];

/* =========================================================================== 1 */
check('1. the two things that work with no project are the home and Settings, and they are the ONLY two', () => {
  const rail = shippedNavViews().map((row) => row.view);
  assert.deepStrictEqual(rail.slice(0, 1), [SHELL_HOME_VIEW],
    'the first rail item is the shell home, because it is the way back from Settings with no project');
  const partition = shellNavPartition({ hasProject: false, views: rail });
  assert.deepStrictEqual(partition.available, [...SHELL_NO_PROJECT_VIEWS],
    'exactly the home and Settings may be pressed with no project open');
  assert.deepStrictEqual(partition.unavailable, [...SHELL_PROJECT_DEPENDENT_NAV],
    'exactly the five project workspaces are unavailable');
  assert.deepStrictEqual([...SHELL_NO_PROJECT_VIEWS, ...SHELL_PROJECT_DEPENDENT_NAV].sort(), [...rail].sort(),
    'the predicate answers for every shipped rail item and for nothing else');
  note(`1. with no project: ${partition.available.join(' + ')} work; ${partition.unavailable.join(', ')} do not`);
});

/* =========================================================================== 2 */
check('2. with a project open every rail item is available and nothing carries a reason', () => {
  for (const { view } of shippedNavViews()) {
    const answer = shellNavAvailability(view, { hasProject: true });
    assert.strictEqual(answer.available, true, `${view} must be available with a project open`);
    assert.strictEqual(answer.reason, '', `${view} must carry no refusal with a project open`);
  }
  assert.deepStrictEqual(shellNavPartition({ hasProject: true }).unavailable, [],
    'a working build acquires no second opinion about itself');
  note('2. a window with a project open is answered exactly as it always was');
});

/* =========================================================================== 3 */
check('3. every unavailable answer carries a reason, and every reason names the way out', () => {
  const answers = [
    ...SHELL_PROJECT_DEPENDENT_NAV.map((view) => shellNavAvailability(view, { hasProject: false })),
    ...SHELL_UTILITY_NAMES.map((name) => shellUtilityAvailability(name, { hasProject: false })),
    ...SHELL_PROJECT_SCOPED_SETTINGS.map((id) => shellSettingsScopeAvailability(id, { hasProject: false })),
    shellRouteWithoutProject('shots', { knownRoutes: shippedRouteKeys() }),
  ];
  for (const answer of answers) {
    assert.strictEqual(answer.available === false || answer.kind === 'needs-project', true,
      `expected an unavailable answer, got ${JSON.stringify(answer)}`);
    assert.ok(answer.reason && answer.reason.length > 20,
      `an unavailable answer with no reason is a greyed control with no explanation: ${JSON.stringify(answer)}`);
    assert.ok(answer.reason.endsWith(SHELL_NO_PROJECT_REMEDY),
      `every refusal ends with the one remedy, so seven controls cannot say seven things: ${answer.reason}`);
  }
  for (const [key, reason] of Object.entries(SHELL_NO_PROJECT_REASONS))
    assert.ok(reason.endsWith(SHELL_NO_PROJECT_REMEDY), `${key} must end with the shared remedy`);
  note(`3. ${answers.length} refusals, each with a reason, each ending "${SHELL_NO_PROJECT_REMEDY}"`);
});

/* =========================================================================== 4 */
check('4. the projectless router answers each hash as itself, and never as somebody else', () => {
  const routes = shippedRouteKeys();
  const home = shellRouteWithoutProject(SHELL_HOME_VIEW, { knownRoutes: routes });
  assert.strictEqual(home.kind, 'home');
  assert.strictEqual(home.navView, SHELL_HOME_VIEW, 'the home lights the home item; that is how Settings is left');
  assert.strictEqual(home.label, SHELL_HOME_LABEL, 'the topbar names the welcome screen, not Production');

  const settings = shellRouteWithoutProject('settings', { knownRoutes: routes });
  assert.strictEqual(settings.kind, 'settings');
  assert.strictEqual(settings.navView, 'settings', 'Settings lights Settings — the defect was that it did not');
  assert.strictEqual(settings.label, 'Settings');

  for (const view of SHELL_PROJECT_DEPENDENT_VIEWS) {
    const answer = shellRouteWithoutProject(view, { knownRoutes: routes });
    assert.strictEqual(answer.kind, 'needs-project', `${view} reached with nothing open must refuse, not borrow a screen`);
    assert.strictEqual(answer.navView, '', `${view} must light NO rail item: nothing in the rail is what is being shown`);
    assert.ok(answer.label, `${view} must still be named in the topbar`);
  }

  for (const view of GHOST_HASHES) {
    const answer = shellRouteWithoutProject(view, { knownRoutes: routes });
    assert.strictEqual(answer.kind, 'not-found', `#/${view} names no view and must be answered as not found`);
    assert.strictEqual(answer.navView, '', `#/${view} must light no rail item`);
    assert.strictEqual(answer.label, SHELL_NOT_FOUND_LABEL);
  }

  for (const view of SHELL_START_VIEWS) {
    const answer = shellRouteWithoutProject(view, { knownRoutes: routes });
    assert.strictEqual(answer.kind, 'home', `#/${view} is answered by the start surface a projectless install actually has`);
    assert.strictEqual(answer.navView, '', `#/${view} lights nothing, exactly as it does with a project open — the rail has no item for it`);
    assert.strictEqual(answer.label, SHELL_VIEW_LABELS[view], `#/${view} keeps the topbar word the project shell gives it`);
  }
  for (const view of [SHELL_HOME_VIEW, 'settings', ...SHELL_START_VIEWS, ...SHELL_PROJECT_DEPENDENT_VIEWS, ...GHOST_HASHES]) {
    const answer = shellRouteWithoutProject(view, { knownRoutes: routes });
    assert.ok(!Object.prototype.hasOwnProperty.call(answer, 'correctedHash'),
      `#/${view}: the projectless router must never name another address to move to`);
  }
  /* WHY THE ADDRESS IS NEVER MOVED. newProject() sets #/create and switchProject() sets
     #/production BEFORE the open that follows commits, so for that moment this router
     answers a hash that belongs to the project on its way in. A rewrite there moves
     where a new project lands — PROJECT_CREATION_LANDING_V1's decision, not this one's. */
  const app = read('public/app.js');
  const router = app.slice(app.indexOf('async function routeWithoutProject('), app.indexOf('function noProjectSurfaceMarkup('));
  assert.ok(!/location\.(replace|assign)\(|location\.hash\s*=/.test(router),
    'the projectless router must not move the address bar');
  const created = app.slice(app.indexOf('window.newProject = '), app.indexOf('/* ---------- modal helpers ---------- */'));
  assert.ok(/location\.hash = intent === "scratch" \? "#\/production" : "#\/create";\n {6}await load\(\);/.test(created),
    'the post-creation landing is untouched: the hash is still chosen by intent and set before the load');
  note(`4. ${SHELL_PROJECT_DEPENDENT_VIEWS.length} project views refuse, ${GHOST_HASHES.length} unknown hashes are not found, #/create answered in place, no address ever rewritten`);
});

/* =========================================================================== 5 */
check('5. an unknown hash is unknown WITH a project open too — that is the ghost-route fall-through', () => {
  const routes = shippedRouteKeys();
  for (const view of GHOST_HASHES)
    assert.strictEqual(shellRouteIsKnown(view, routes), false, `#/${view} must not be a known route`);
  for (const view of routes)
    assert.strictEqual(shellRouteIsKnown(view, routes), true, `#/${view} is a declared route and must be known`);
  const app = read('public/app.js');
  /* The STATEMENT, not the phrase: the comment above the repair quotes the old line on
     purpose, and a check that could not tell the two apart would fail on its own
     explanation. */
  assert.ok(!/const fn = ROUTES\[view\] \|\| ROUTES\.production;/.test(app),
    'the fall-through that rendered Production for nine hashes that name nothing must be gone');
  assert.ok(/const routeKnown = typeof shellRouteIsKnown === "function"/.test(app),
    'the router asks the predicate whether a hash names a view');
  assert.ok(/const fn = routeKnown \? ROUTES\[view\] : null;/.test(app),
    'a hash that names nothing dispatches to nothing');
  assert.ok(/sharedNotFoundView\("Workspace", `#\/\$\{view\}`/.test(app),
    'and is answered with the not-found treatment the product already has');
  note('5. ROUTES[view] || ROUTES.production is gone; an unknown hash dispatches to sharedNotFoundView');
});

/* =========================================================================== 6 */
check('6. the rail alias table names only views that exist, so no ghost can light an item', () => {
  const app = read('public/app.js');
  const table = app.slice(app.indexOf('const navName = routeKnown'), app.indexOf('document\n      .querySelectorAll(".nav-btn[data-view]")'));
  assert.ok(table, 'the navigation alias table has moved');
  const aliases = [...table.matchAll(/^ {10}([a-z]+): "([a-z]+)",$/gm)].map((m) => m[1]);
  assert.ok(aliases.length, 'the alias table is empty — every entity route would stop lighting References');
  const routes = shippedRouteKeys();
  for (const alias of aliases)
    assert.ok(routes.includes(alias), `"${alias}" is aliased to a rail item but is not a declared route — that is a ghost`);
  for (const ghost of ['board', 'scenes', 'queue', 'runs', 'sessions', 'canon'])
    assert.ok(!aliases.includes(ghost), `"${ghost}" names no view and must not light a rail item`);
  note(`6. ${aliases.length} aliases, all of them declared routes; board/scenes/queue/runs/sessions/canon are gone`);
});

/* =========================================================================== 7 */
check('7. the topbar word for a view is one word, not two that can drift', () => {
  const app = read('public/app.js');
  const labels = app.slice(app.indexOf('function updateChrome('), app.indexOf('$("#topbar-view").textContent = routeKnown'));
  const shipped = Object.fromEntries([...labels.matchAll(/^ {4}([a-z]+): "([^"]+)",$/gm)].map((m) => [m[1], m[2]]));
  assert.ok(Object.keys(shipped).length >= 14, 'the chrome label table has moved or shrunk');
  for (const [view, label] of Object.entries(SHELL_VIEW_LABELS)) {
    assert.ok(shipped[view], `the predicate names "${view}" but the chrome table does not`);
    assert.strictEqual(label, shipped[view],
      `"${view}" is "${label}" to the projectless router and "${shipped[view]}" to the chrome — the topbar would change word on the same surface`);
  }
  assert.ok(!Object.prototype.hasOwnProperty.call(SHELL_VIEW_LABELS, SHELL_HOME_VIEW),
    'the home has its own word with no project open; borrowing "Production" would name a workspace that is not on screen');
  for (const { view, label } of shippedNavViews()) {
    if (view === SHELL_HOME_VIEW) continue;
    assert.strictEqual(shellViewLabel(view), label,
      `the rail calls "${view}" ${label}; the topbar would call it ${shellViewLabel(view)}`);
  }
  note(`7. ${Object.keys(SHELL_VIEW_LABELS).length} labels agree with public/app.js's chrome table and with the shipped rail`);
});

/* =========================================================================== 8 */
check('8. the router runs with no project open instead of returning and leaving the last screen up', () => {
  const app = read('public/app.js');
  assert.ok(!/async function route\(recoveryAttempt = false\) \{\n  if \(!P\) return;/.test(app),
    'the bare early return is the whole of the first defect: the hash moved and nothing rendered');
  assert.ok(/if \(!P\) return shellInFirstRun\(\) \? routeWithoutProject\(\) : undefined;/.test(app),
    'a CONFIRMED first run has its own render path, and every other null record keeps the shipped early return');
  /* FIRST RUN IS A FACT ABOUT AN OPEN, NOT ABOUT A NULL RECORD. A project still opening,
     the load-failure screen and Recovery mode all have `P === null`; treating them as
     first run refused an Activity request made during a load and would route the welcome
     card over a failure screen. The predicate is scoped to the open that confirmed it. */
  assert.ok(/function shellInFirstRun\(\) \{\n  return !P && !PROJECT_QUARANTINE && SHELL_FIRST_RUN_EPOCH === PROJECT_OPEN_EPOCH;\n\}/.test(app),
    'first run is the open showFirstRunWorkspace() performed, still current, outside Recovery mode — not merely a null record');
  const firstRun = app.slice(app.indexOf('async function showFirstRunWorkspace('), app.indexOf('function firstRunWorkspaceMarkup('));
  assert.ok(/beginProjectOpen\(\);\n(?: {2}\/\*[\s\S]*?\*\/\n)? {2}SHELL_FIRST_RUN_EPOCH = PROJECT_OPEN_EPOCH;/.test(firstRun),
    'showFirstRunWorkspace() records the epoch of the open it just performed');
  const failed = app.slice(app.indexOf('function markProjectLoadFailure('), app.indexOf('function markProjectLoadFailure(') + 600);
  assert.ok(/SHELL_FIRST_RUN_EPOCH = -1;/.test(failed),
    'a load-failure screen is never first run, even when it follows one');
  assert.ok(/let P = null,[\s\S]*?\n {2}SHELL_FIRST_RUN_EPOCH = -1,/.test(app),
    'the first-run epoch starts at a value no open can have');
  assert.ok(/async function routeWithoutProject\(prepared = null\)/.test(app),
    'and that path is a named function, not a branch inside route()');
  const body = app.slice(app.indexOf('async function routeWithoutProject('), app.indexOf('function noProjectSurfaceMarkup('));
  for (const fragment of ['shellRouteWithoutProject(', '$("#topbar-view").textContent = decision.label', 'b.classList.toggle("active", b.dataset.view === decision.navView)'])
    assert.ok(body.includes(fragment), `the projectless router must set ${fragment}`);
  assert.ok(/markRouteRenderSettled\(requestToken\)/.test(body),
    'it settles the render flag, or every browser suite waiting on it hangs');
  assert.ok(!/\btally\(\)/.test(body), 'it must not call tally(), which counts shots in a project that is not open');
  note('8. route() delegates to routeWithoutProject(), which sets the rail, the topbar and the content together');
});

/* =========================================================================== 9 */
check('9. an unavailable shell control is focusable, explained, and refuses before the hash moves', () => {
  const app = read('public/app.js');
  const apply = app.slice(app.indexOf('function applyShellControlAvailability('), app.indexOf('function listWords('));
  assert.ok(/control\.setAttribute\("aria-disabled", "true"\)/.test(apply),
    'aria-disabled, so the control still reports itself unavailable');
  assert.ok(!/control\.disabled = true/.test(apply),
    'NOT `disabled`: a control a keyboard cannot reach is a control whose explanation a keyboard cannot hear');
  assert.ok(/control\.setAttribute\("aria-describedby", noteId\)/.test(apply),
    'the reason is attached to the control, not merely printed somewhere on the page');
  assert.ok(/control\.title = reason/.test(apply), 'and is on the control itself for a pointer user');

  const refused = app.slice(app.indexOf('function shellControlRefused('), app.indexOf('function markNoProjectHome('));
  assert.ok(/aria-disabled"\) !== "true"\) return false/.test(refused), 'the refusal reads the same attribute the writer set');
  assert.ok(/toast\(reason\)/.test(refused), 'a refused gesture says why; swallowing it silently is the defect wearing a different hat');
  assert.ok(!/location\.hash/.test(refused) && !/fetch\(/.test(refused) && !/openModal\(/.test(refused),
    'a refusal changes no hash, makes no request and opens no modal');

  /* PRESENT, THEN FIRST. An ordering check alone passes when the refusal is deleted,
     because a missing index is -1 and -1 comes "before" everything — the negative
     controls found exactly that. */
  const before = (text, first, second, message) => {
    const a = text.indexOf(first), b = text.indexOf(second);
    assert.ok(a >= 0, `${message} — the refusal is missing entirely`);
    assert.ok(b >= 0, `${message} — the guarded action has moved`);
    assert.ok(a < b, message);
  };
  const nav = app.slice(app.indexOf('document.querySelectorAll(".nav-btn[data-view]").forEach('), app.indexOf('$("#rescan").onclick'));
  before(nav, 'if (shellControlRefused(b)) return;', 'location.hash = "#/" + b.dataset.view',
    'the refusal is BEFORE the hash: moving the address bar and then declining to render is the three-way disagreement');
  const rescan = app.slice(app.indexOf('$("#rescan").onclick'), app.indexOf('$("#mobile-nav").onclick'));
  before(rescan, 'if (shellControlRefused($("#rescan"))) return;', 'fetch("/api/scan")',
    'Sync local folders refuses before it reports "Local folders synced" for work it did not do');
  note('9. aria-disabled + aria-describedby + a title, and a refusal that fires before the hash or the request');
});

/* =========================================================================== 10 */
check('10. the reason a filmmaker reads and the reason a screen reader hears are the same element', () => {
  const html = read('public/index.html');
  for (const id of ['nav-availability-note', 'rescan-availability-note']) {
    assert.ok(new RegExp(`id="${id}" class="nav-availability-note" hidden`).test(html),
      `${id} ships in the markup, empty and hidden — the page script owns its state and never its existence`);
  }
  const app = read('public/app.js');
  const sync = app.slice(app.indexOf('function syncShellAvailability('), app.indexOf('function applyShellControlAvailability('));
  assert.ok(/applyShellControlAvailability\(button, answer\.available, answer\.reason, "nav-availability-note"\)/.test(sync),
    'each unavailable rail item is described by the note');
  assert.ok(/note\.textContent = unavailable\.length/.test(sync) && /listWords\(unavailable\)/.test(sync),
    'and the note is written from the same pass that dimmed them, naming the ones it dimmed');
  const css = read('public/experience-coherence.css');
  assert.ok(/\.nav-btn\[aria-disabled="true"\]/.test(css), 'the unavailable state is styled from the same attribute the script writes');
  assert.ok(/\.nav-availability-note \{[^}]*color:var\(--muted\)/.test(css), 'the note is visible text, not a screen-reader-only string');
  /* THE DIMMING IS THE APPLICATION'S OWN. Every aria-disabled control takes public/styles.css's
     disabled treatment, !important, so a shell-local opacity would be dead code that claims a look
     the page never shows. The first draft declared one; this pins that none is declared. */
  const styles = read('public/styles.css');
  assert.ok(/button:disabled,\n\[aria-disabled="true"\],\n\.disabled\{opacity:\.58!important;color:var\(--muted\)!important\}/.test(styles),
    'the shell relies on the application\'s disabled treatment for aria-disabled controls');
  const block = css.slice(css.indexOf('/* NO_PROJECT_SHELL_TRUTH_V1 — WHAT AN UNAVAILABLE SHELL CONTROL LOOKS LIKE.'), css.indexOf('/* NO_PROJECT_SHELL_TRUTH_V1 — THE TOPBAR SEARCH'));
  assert.ok(block && !/opacity:/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the rail controls declare no opacity of their own — it would lose to the application\'s !important rule');
  note('10. one element is both the visible note and the accessible description, so the two cannot drift');
});

/* =========================================================================== 11 */
check('11. the add chooser offers only what it can deliver, and New project opens the dialog', () => {
  assert.deepStrictEqual(shellAddChoices(['shot', 'scene', 'character', 'location', 'prop', 'vehicle', 'audio', 'project'], { hasProject: false }),
    ['project'], 'with nothing open the only record that can be created is a project');
  for (const key of ['shot', 'scene', 'character', 'audio'])
    assert.strictEqual(shellAddChoiceAvailable(key, { hasProject: true }), true, `${key} is offered again once a project is open`);

  const app = read('public/app.js');
  const open = app.slice(app.indexOf('window.openGlobalAdd = '), app.indexOf('/* ADD, WHERE THE SURFACE HAS ALREADY NAMED THE RECORD.'));
  assert.ok(/GLOBAL_ADD_CHOICES\.filter\(\(\[key\]\) => shellAddChoiceAvailable\(key, \{ hasProject \}\)\)/.test(open),
    'the chooser filters through the predicate rather than carrying a second list');
  const run = app.slice(app.indexOf('window.runGlobalAdd = '), app.indexOf('/* THE BOARD FILTERS ARE A THIRD READING'));
  assert.ok(/if \(shellInFirstRun\(\)\) return newProject\(\);/.test(run),
    'New project with nothing open opens the existing new-project dialog — it used to close the chooser and do nothing');
  assert.ok(/location\.hash = "#\/create";/.test(run),
    'and a window that HAS a project still goes to the start surface, unchanged');
  note('11. eight choices become one with no project; New project opens formModal("New CineBraid project")');
});

/* =========================================================================== 12 */
check('12. the two utilities that had nothing to show cannot report that they are showing it', () => {
  for (const name of SHELL_UTILITY_NAMES) {
    const off = shellUtilityAvailability(name, { hasProject: false });
    assert.strictEqual(off.available, false);
    assert.ok(off.state, `${name} must have a word to show, not only a dimmer`);
    assert.strictEqual(shellUtilityAvailability(name, { hasProject: true }).available, true);
  }
  const surfaces = read('public/creator-surfaces.js');
  const sync = surfaces.slice(surfaces.indexOf('function syncActivityToggle()'), surfaces.indexOf('/* THE ONE PLACE A MARK BECOMES THE SHIPPED BRAIDY.'));
  assert.ok(/shellUtilityAvailability\("activity", \{ hasProject: !firstRunConfirmed\(\) \}\)/.test(sync),
    'the Activity control asks whether there is anything to expand — from the confirmed first-run fact, not a null record');
  assert.ok(/function firstRunConfirmed\(\) \{\n {4}return typeof shellInFirstRun === "function" \? !!shellInFirstRun\(\) : false;\n {2}\}/.test(surfaces),
    'creator-surfaces reads public/app.js\'s first-run fact, and a realm without it keeps the shipped behaviour');
  assert.ok(!/hasProject: !!activeProject\(\)/.test(surfaces),
    'a null record is also a project still opening; the drawer must stay openable then');
  assert.ok(/const open = availability\.available && !terminalCollapsed\(\);/.test(sync),
    'aria-expanded can no longer come from a stored preference alone — that is how it reported true over a zero-height dock');
  assert.ok(/state\.textContent = availability\.state/.test(sync), 'and the chip shows the word, not only a dimmer');
  const writer = surfaces.slice(surfaces.indexOf('function setUtilities('), surfaces.indexOf('KEYBOARD AND FOCUS.'));
  /* The WHOLE guard, including the return that makes it a refusal. A guard that asks the
     predicate and then carries on is a guard in name only. */
  assert.ok(/ {4}if \(activityNext && !activityWas && typeof shellUtilityAvailability === "function"\n {6}&& !shellUtilityAvailability\("activity", \{ hasProject: !firstRunConfirmed\(\) \}\)\.available\) \{\n {6}syncActivityToggle\(\);\n {6}return \{ rail: railWas, activity: activityWas \};\n {4}\}/.test(writer),
    'and opening it is refused in the one writer — before any preference is written — so six callers do not each have to remember');
  assert.ok(writer.indexOf('!shellUtilityAvailability("activity"') < writer.indexOf('writeTerminalCollapsed(!activityNext)'),
    'the refusal is BEFORE the preference write, or a refused open would still be read back as an open drawer');

  assert.ok(!/shellUtilityAvailability\("rail"|shellUtilityAvailability\("braidy"/.test(surfaces),
    'Braidy already hides and disables itself correctly with no project; a second owner for a working answer is how it stops working');
  assert.ok(/button\.hidden = !enabled;\n    button\.disabled = !enabled;/.test(surfaces),
    "Braidy's own unavailable state is preserved exactly as it shipped");
  note('12. Activity is unavailable and says so; Braidy keeps the correct behaviour it already had');
});

/* =========================================================================== 13 */
check('13. Settings is reachable with nothing open, and its project-scoped panels refuse in words', () => {
  const studio = read('public/settings-studio.js');
  const scoped = studio.match(/const STUDIO_PROJECT_SCOPED = \[([^\]]+)\];/);
  assert.ok(scoped, 'STUDIO_PROJECT_SCOPED has moved');
  const ids = scoped[1].split(',').map((x) => x.trim().replace(/"/g, ''));
  assert.deepStrictEqual(ids, [...SHELL_PROJECT_SCOPED_SETTINGS],
    'the predicate and Settings must agree about which sections belong to a project');
  assert.ok(!/const scope = projectScope \? `Project · <b data-settings-project-title>\$\{esc\(P\.meta/.test(studio),
    'the scope line read P.meta unconditionally, which is one of the two reasons Settings could not render at all');
  assert.ok(/shellSettingsScopeAvailability\(selected, \{ hasProject: !!P \}\)/.test(studio),
    'it asks the predicate instead');

  const views = read('public/views.js');
  assert.ok(/const projectPanel = !P \? projectScopeRefusal\(/.test(views),
    'the project preferences form is not drawn at all with nothing open: a field that cannot be saved should never accept a keystroke');
  assert.ok(/const recoveryPanel = !P \? projectScopeRefusal\(/.test(views),
    'and neither are backups OF a project that is not open');
  const refusal = views.slice(views.indexOf('const projectScopeRefusal ='), views.indexOf('const projectPanel = '));
  assert.ok(/data-settings-refusal="no-project"/.test(refusal), 'the refusal is marked, so a suite can find it and a style can reach it');
  assert.ok(/onclick="newProject\(\)"/.test(refusal) && /href="#\/settings\/connections"/.test(refusal),
    'and it offers the two things that do work: create a project, or set up connections');
  for (const section of ['overview', 'connections', 'generation', 'assistant', 'appearance', 'files', 'naming', 'access', 'recovery', 'fal', 'integrations', 'accounts'])
    assert.strictEqual(shellSettingsScopeAvailability(section, { hasProject: false }).available, true,
      `${section} is application-wide and must be usable before a first project exists`);
  note('13. Connections and every studio section work with nothing open; Project and Project backups refuse and say why');
});

/* =========================================================================== 14 */
check('14. the predicate is loaded before the shell that reads it, and adds no second global', () => {
  const html = read('public/index.html');
  const mine = html.indexOf('<script src="shared-shell-availability.js');
  assert.ok(mine > 0, 'public/shared-shell-availability.js is not loaded by the shipped page');
  assert.ok(mine < html.indexOf('<script src="app.js'), 'it must load before public/app.js, which reads it on the first paint');
  const source = read('public/shared-shell-availability.js');
  assert.ok(/if \(root\) Object\.assign\(root, api\);/.test(source),
    'it publishes by assignment, which is safe to evaluate twice — a top-level const is a SyntaxError in a realm that already holds it');
  const topLevel = [...source.matchAll(/^(const|let|class) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[2]);
  assert.deepStrictEqual(topLevel, [], 'the module declares nothing at the top level of the shared browser scope');
  assert.ok(/module\.exports = api/.test(source), 'and Node can require it, which is how this suite reads it at all');
  note('14. one module, loaded before app.js, published by assignment, with no top-level binding of its own');
});

/* =========================================================================== 15 */
check('15. no shipped link points at a hash this build has no view for', () => {
  const routes = shippedRouteKeys();
  const dir = path.join(ROOT, 'public');
  /* LINK POSITIONS ONLY — an `href`, an assignment to `location.hash`, or a destination
     recorded as an object value. Scanning every `#/…` in the file would also read the
     prose above each repair, which quotes the ghost hashes it removed by name. */
  const LINK = /(?:href=["']|location\.hash\s*=\s*["']|:\s*["'])#\/([a-zA-Z][a-zA-Z0-9-]*)/g;
  const offenders = [];
  let scanned = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(js|html)$/.test(name)) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of src.matchAll(LINK)) {
      scanned += 1;
      if (!routes.includes(m[1])) offenders.push(`${name} → #/${m[1]}`);
    }
  }
  assert.ok(scanned > 40, `the link scan matched only ${scanned} destinations — the pattern has stopped finding links`);
  assert.deepStrictEqual(offenders, [],
    'an unknown hash is answered as not found now, so a link the product generates itself must not aim at one');
  assert.ok(!/\n {4}session: "#\/activity",/.test(read('public/review.js')),
    'the search result for a session pointed at #/activity, which names no view');
  note(`15. every #/ link in public/ names one of the ${routes.length} declared routes`);
});

/* =========================================================================== 16 */
check('16. the topbar search cannot be typed into, and cannot reach the server, with no project open', () => {
  /* MEASURED ON FIRST RUN, 2026-09-20. On 3b20a4f the box was enabled and inert: typing
     did nothing. Wired the way a project window wires it, typing sends POST /api/search
     to a server with no project file, and the server process EXITS. So it is refused in
     two independent layers — the control, and the one place the request is made. */
  const answer = shellUtilityAvailability('search', { hasProject: false });
  assert.strictEqual(answer.available, false, 'search is unavailable with no project');
  assert.strictEqual(answer.state, 'Open a project to search canon', 'the box says, in its own words, why it cannot search');
  assert.ok(answer.reason.endsWith(SHELL_NO_PROJECT_REMEDY), 'and its full reason names the way out');
  assert.strictEqual(shellUtilityAvailability('search', { hasProject: true }).available, true, 'search works again with a project');

  const html = read('public/index.html');
  assert.ok(/<input id="global-search" aria-label="Search canon" placeholder="Search canon"><kbd>\/<\/kbd><span id="search-availability-note" class="sr-only"><\/span>/.test(html),
    'the accessible reason has a home beside the box — static markup, like the other notes');

  const app = read('public/app.js');
  const sync = app.slice(app.indexOf('function syncShellAvailability('), app.indexOf('function applyShellControlAvailability('));
  assert.ok(/applyShellControlAvailability\(search, answer\.available, answer\.reason, "search-availability-note"\);\n {4}applySearchAvailability\(search, answer\);/.test(sync),
    'the search box is marked by the same writer, from the same pass, as every other shell control');
  const apply = app.slice(app.indexOf('function applySearchAvailability('), app.indexOf('/* aria-disabled RATHER THAN disabled'));
  assert.ok(/search\.readOnly = true;/.test(apply),
    'an aria-disabled INPUT still takes keystrokes, so it is read-only too — focusable for its reason, unable to hold a query');
  assert.ok(/search\.placeholder = answer\.state;/.test(apply), 'the short reason is where a sighted person reads before typing');
  assert.ok(/if \(search\.dataset\.shellPlaceholder === undefined\) return;/.test(apply),
    'and a window that never lacked a project is never touched');

  const refusal = app.slice(app.indexOf('/* THE SEARCH BOX, REFUSED AT THE KEYSTROKE.'), app.indexOf('$("#rescan").onclick'));
  assert.ok(/\$\("#global-search"\)\?\.addEventListener\("keydown", \(event\) => \{/.test(refusal) && /\}, true\);/.test(refusal),
    'a keystroke into the unavailable box is refused in the capture phase, before the search\'s own handlers');
  assert.ok(/event\.preventDefault\(\);\n {2}event\.stopImmediatePropagation\(\);\n {2}shellControlRefused\(search\);/.test(refusal),
    'and says why, the way every other refused shell control does');
  assert.ok(/"Tab", "Escape"/.test(refusal), 'Tab and Escape keep doing exactly what they did, so focus is never trapped');

  const review = read('public/review.js');
  const run = review.slice(review.indexOf('async function runSearch('), review.indexOf('const go = {'));
  const guard = run.indexOf('if (typeof P === "undefined" || !P) return;');
  assert.ok(guard > 0, 'runSearch() refuses without a loaded project record — the second, independent layer');
  assert.ok(guard < run.indexOf('fetch("/api/search"'), 'and it refuses BEFORE the request, which is what keeps the server alive');
  /* C3. The server refuses a search it cannot run (404 NO_ACTIVE_PROJECT, 422
     PROJECT_UNREADABLE); a window that still believes a project is open must show that
     sentence, not read `results` off a refusal and throw. */
  /* `run` ends where the result list is first used (`const go = {`), so presence inside it
     is the "before". */
  assert.ok(run.indexOf('if (!r.ok || !Array.isArray(d.results)) return toast(d.error') > 0,
    'a refused search shows the server\'s own sentence before anything reads its result list');

  const css = read('public/experience-coherence.css');
  assert.ok(/#topbar \.topbar-search\[data-shell-unavailable="no-project"\] \{ opacity:\.58; \}/.test(css),
    'the box is dimmed to the application\'s own disabled value, the one the rail\'s controls get');
  assert.ok(/#topbar \.topbar-search\[data-shell-unavailable="no-project"\] input\[aria-disabled="true"\] \{ opacity:1 !important;/.test(css),
    'and the input\'s own disabled opacity is cancelled, or the two would compound to about a third');
  assert.ok(/@media\(max-width:1180px\) \{\n {2}#topbar \.topbar-search\[data-shell-unavailable="no-project"\] input\[aria-disabled="true"\] \{ opacity:0 !important; \}/.test(css),
    'in the folded narrow header the input stays an invisible overlay until focused, as it shipped');
  assert.ok(/ {2}#topbar \.topbar-search\[data-shell-unavailable="no-project"\]:focus-within \{ opacity:1; \}\n {2}#topbar \.topbar-search\[data-shell-unavailable="no-project"\]:focus-within input\[aria-disabled="true"\] \{ opacity:\.58 !important; \}/.test(css),
    'expanded, the narrow search is an overlay across the header — it stays opaque and the dimming moves to the input');
  note('16. search: aria-disabled + read-only + "Open a project to search canon", keystrokes refused with the reason, and runSearch() never posts without a project');
});

/* =========================================================================== 17 */
check('17. the welcome card carries the real CineBraid mark, not a monogram', () => {
  const app = read('public/app.js');
  const markup = app.slice(app.indexOf('function firstRunWorkspaceMarkup('), app.indexOf('/* WHERE THE WORK WILL BE KEPT'));
  assert.ok(!/<div class="first-run-mark">CB<\/div>/.test(markup), 'the "CB" monogram stand-in is gone');
  const tag = (markup.match(/<div class="first-run-mark">(<img\b[^>]*>)<\/div>/) || [])[1];
  assert.ok(tag, 'the badge holds an image, in the SAME box, so the card\'s footprint and alignment do not move');
  assert.ok(tag.includes('src="/cinebraid-logo-xs.png"'), 'it is the shipped production logo the rail, login and Bible use — not a new asset');
  assert.ok(/width="80" height="103"/.test(tag), 'with the intrinsic size declared, as every brand image in the repo does');
  assert.ok(/alt=""/.test(tag), '"WELCOME TO CINEBRAID" beside it already names the product, so the mark is not announced twice');
  const css = read('public/styles.css');
  const rule = (css.match(/\.first-run-logo\{([^}]*)\}/) || [])[1] || '';
  assert.ok(/height:\d+px/.test(rule) && /width:auto/.test(rule) && /object-fit:contain/.test(rule) && !/\bwidth:\d+px/.test(rule),
    'the same rules as .brand-logo: a fixed height, a width that follows the asset, never stretched');
  assert.ok(/@media\(max-width:720px\)\{\.first-run-logo\{height:\d+px\}\}/.test(css), 'and a smaller fixed height where the badge shrinks to 72px');
  note('17. the welcome badge shows /cinebraid-logo-xs.png (80x103, alt="") inside the unchanged 104px / 72px box');
});

/* =========================================================================== */
let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log('  ok  ' + name); }
  catch (error) { failed++; console.error('  FAIL ' + name + '\n       ' + (error && error.message ? error.message : error)); if (process.env.NO_PROJECT_SHELL_STACK) console.error(error.stack); }
}
console.log(notes.map((line) => '  ' + line).join('\n'));
if (failed) { console.error(`FAIL no-project shell truth: ${failed} of ${checks.length} checks failed.`); process.exit(1); }
console.log(`PASS no-project shell truth: ${checks.length} checks — with no project open the shell offers the home and Settings, refuses the rest in words, and answers an unknown hash as what it is.`);

/* NEGATIVE CONTROLS for tests/no-project-shell-truth.js.
 *
 * Each control below rebuilds ONE defect the assessment measured on 3b20a4f, or one way
 * the repair could quietly regress, and requires the named check to go red for it. A
 * suite that cannot fail proves nothing.
 *
 * The four runtime seams the brief names — the navigation guard, Settings falling
 * through to the welcome card, the unknown-route fallback, the inert New project action —
 * are ALSO broken in a real browser by tests/no-project-shell-truth-real-browser.py,
 * against the served page. These are their source-level twins, plus the properties only
 * the source can show: that the explanation is attached rather than printed, that the
 * predicate is loaded first, that the labels cannot drift.
 *
 * NOTHING IS WRITTEN INTO THE REPOSITORY. The shipped files are COPIED into a temporary
 * directory, the mutation is applied to the copy, and the suite is run against it through
 * NO_PROJECT_SHELL_SOURCE_ROOT. A crash cannot leave a patched source on disk, and two
 * suites can run at once.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'no-project-shell-truth.js');

const notes = [];
let failures = 0;

/* EVERY file under public/ that the suite can read — check 15 scans the whole directory
   for links — so nothing is answered by the real tree by accident. Media assets are not
   source and are left out. */
function sandboxCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-no-project-shell-nc-'));
  fs.mkdirSync(path.join(dir, 'public'));
  for (const name of fs.readdirSync(path.join(ROOT, 'public'))) {
    if (!/\.(js|html|css)$/.test(name)) continue;
    fs.copyFileSync(path.join(ROOT, 'public', name), path.join(dir, 'public', name));
  }
  return dir;
}

function patch(dir, file, from, to, label) {
  const at = path.join(dir, file);
  const normalised = fs.readFileSync(at, 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(normalised.split(from).length - 1, 1,
    `${label}: the anchor for ${file} is not present exactly once — the control is patching something that has moved:\n${from}`);
  fs.writeFileSync(at, normalised.replace(from, to));
}

function run(dir) {
  const result = spawnSync(process.execPath, [SUITE], { env: { ...process.env, NO_PROJECT_SHELL_SOURCE_ROOT: dir }, encoding: 'utf8' });
  const output = String(result.stdout || '') + String(result.stderr || '');
  const failed = [...output.matchAll(/^ {2}FAIL (\d+)\./gm)].map((m) => Number(m[1]));
  return { code: result.status, failed, output };
}

function control(label, expectedCheck, apply) {
  const dir = sandboxCopy();
  try {
    apply(dir);
    const { code, failed, output } = run(dir);
    assert.notStrictEqual(code, 0, `${label}: the suite accepted the broken build.\n${output.slice(-900)}`);
    assert.ok(failed.includes(expectedCheck),
      `${label}: expected check ${expectedCheck} to fail; the suite failed ${JSON.stringify(failed)} instead.\n${output.slice(-900)}`);
    notes.push(`  ${label} — check ${expectedCheck} failed for it`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message}`);
    return;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`  ok  ${label}`);
}

/* The control that proves the harness itself: an unpatched copy must PASS, or every
   control below would "fail" for the wrong reason. */
(function unpatchedCopyPasses() {
  const dir = sandboxCopy();
  try {
    const { code, output } = run(dir);
    assert.strictEqual(code, 0, `N0: the unpatched copy must pass, or the controls prove nothing.\n${output.slice(-1400)}`);
    console.log('  ok  N0 the unpatched copy of the shipped tree passes');
    notes.push('  N0 — an unpatched copy passes, so a red control is the mutation and not the copy');
  } catch (error) { failures += 1; console.error(`  FAIL N0\n       ${error.message}`); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();

/* ------------------------------------------------------ the shipped defects, rebuilt */

control('C1 the router returns early with no project again (the whole first defect)', 8, (dir) =>
  patch(dir, 'public/app.js', '  if (!P) return shellInFirstRun() ? routeWithoutProject() : undefined;', '  if (!P) return;', 'C1'));

control('C21 first run is read from a null record again, so a project still opening is refused', 8, (dir) =>
  patch(dir, 'public/app.js',
    '  return !P && !PROJECT_QUARANTINE && SHELL_FIRST_RUN_EPOCH === PROJECT_OPEN_EPOCH;',
    '  return !P;', 'C21'));

control('C22 a load-failure screen that follows a first run is still treated as first run', 8, (dir) =>
  patch(dir, 'public/app.js',
    '  SHELL_FIRST_RUN_EPOCH = -1;\n  const title = (failure && (failure.title || failure.slug)) || "";',
    '  const title = (failure && (failure.title || failure.slug)) || "";', 'C22'));

control('C23 the Activity drawer reads a null record instead of the first-run fact', 12, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '      ? shellUtilityAvailability("activity", { hasProject: !firstRunConfirmed() })',
    '      ? shellUtilityAvailability("activity", { hasProject: !!activeProject() })', 'C23'));

control('C2 an unknown hash falls through to Production again', 5, (dir) =>
  patch(dir, 'public/app.js', '    const fn = routeKnown ? ROUTES[view] : null;', '    const fn = ROUTES[view] || ROUTES.production;', 'C2'));

control('C3 #/board is aliased to the Shots rail item again', 6, (dir) =>
  patch(dir, 'public/app.js', '          scene: "shots",\n          shot: "shots",\n', '          scene: "shots",\n          shot: "shots",\n          board: "shots",\n', 'C3'));

control('C4 a navigation item moves the hash before it asks whether it may', 9, (dir) =>
  patch(dir, 'public/app.js', '      if (shellControlRefused(b)) return;\n', '', 'C4'));

control('C5 the unavailable state uses `disabled`, which a keyboard can never reach', 9, (dir) =>
  patch(dir, 'public/app.js', '  control.setAttribute("aria-disabled", "true");\n  control.setAttribute("data-shell-unavailable", "no-project");',
    '  control.disabled = true;\n  control.setAttribute("data-shell-unavailable", "no-project");', 'C5'));

control('C6 Sync local folders reports "synced" before it asks whether a project is open', 9, (dir) =>
  patch(dir, 'public/app.js', '  if (shellControlRefused($("#rescan"))) return;\n', '', 'C6'));

control('C7 the ＋ Add chooser offers all eight records with no project again', 11, (dir) =>
  patch(dir, 'public/app.js', '    ? GLOBAL_ADD_CHOICES.filter(([key]) => shellAddChoiceAvailable(key, facts))', '    ? GLOBAL_ADD_CHOICES', 'C7'));

control('C8 ＋ Add → New project closes the chooser and does nothing again', 11, (dir) =>
  patch(dir, 'public/app.js', '    if (!projectRecordInstalled()) return newProject();\n', '', 'C8'));

control('C9 Activity reports aria-expanded from the stored preference alone again', 12, (dir) =>
  patch(dir, 'public/creator-surfaces.js', '    const open = availability.available && !terminalCollapsed();', '    const open = !terminalCollapsed();', 'C9'));

control('C10 opening Activity with no project is no longer refused in the writer', 12, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '      syncActivityToggle();\n      return { rail: railWas, activity: activityWas };\n',
    '      syncActivityToggle();\n', 'C10'));

control('C11 the Settings scope line reads P.meta with no project again', 13, (dir) =>
  patch(dir, 'public/settings-studio.js',
    '    ? shellSettingsScopeAvailability(selected, { hasProject: !!P }).available',
    '    ? true', 'C11'));

control('C12 the project preferences form is drawn with no project to save into', 13, (dir) =>
  patch(dir, 'public/views.js', '    const projectPanel = !P ? projectScopeRefusal(', '    const projectPanel = false ? projectScopeRefusal(', 'C12'));

/* ------------------------------------------------------ the predicate itself */

control('C13 Settings becomes unavailable with no project', 1, (dir) =>
  patch(dir, 'public/shared-shell-availability.js',
    '  const SHELL_PROJECT_DEPENDENT_NAV = deepFreeze(["shots", "library", "results", "bible", "reports"]);',
    '  const SHELL_PROJECT_DEPENDENT_NAV = deepFreeze(["shots", "library", "results", "bible", "reports", "settings"]);', 'C13'));

control('C14 a refusal loses its reason, leaving a greyed control with no explanation', 3, (dir) =>
  patch(dir, 'public/shared-shell-availability.js',
    '    nav: `This part of CineBraid works inside a project. ${SHELL_NO_PROJECT_REMEDY}`,',
    '    nav: "",', 'C14'));

control('C15 the projectless topbar calls a view something the chrome does not', 7, (dir) =>
  patch(dir, 'public/shared-shell-availability.js', '    results: "Production media",', '    results: "Media",', 'C15'));

control('C20 the projectless router rewrites the address, which would move where a new project lands', 4, (dir) =>
  patch(dir, 'public/app.js',
    '  document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === decision.navView));\n  $("#topbar-view").textContent = decision.label;\n',
    '  if (decision.view === "create") location.replace("#/production");\n  document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === decision.navView));\n  $("#topbar-view").textContent = decision.label;\n', 'C20'));

control('C16 the projectless router lights a rail item over a refusal', 4, (dir) =>
  patch(dir, 'public/shared-shell-availability.js',
    '      kind: "needs-project",\n      view: key,\n      navView: "",',
    '      kind: "needs-project",\n      view: key,\n      navView: key,', 'C16'));

/* ------------------------------------------------------ the markup and the wiring */

control('C17 the visible reason is removed from the rail markup', 10, (dir) =>
  patch(dir, 'public/index.html', '      <p id="nav-availability-note" class="nav-availability-note" hidden></p>\n', '', 'C17'));

control('C18 the predicate is loaded after public/app.js, which reads it on the first paint', 14, (dir) => {
  const tag = '<script src="shared-shell-availability.js?v=6.9.0-alpha.1"></script>\n';
  patch(dir, 'public/index.html', tag, '', 'C18');
  patch(dir, 'public/index.html', '<script src="media.js?v=6.9.0-alpha.1"></script>\n', `<script src="media.js?v=6.9.0-alpha.1"></script>\n${tag}`, 'C18');
});

control('C19 a search result links to a hash this build has no view for again', 15, (dir) =>
  patch(dir, 'public/review.js', '    style: "#/settings",\n', '    style: "#/settings",\n    session: "#/activity",\n', 'C19'));

/* ------------------------------------------------------ the topbar search (C2) */

control('C24 runSearch() posts to the server with no project again — which takes the server down', 16, (dir) =>
  patch(dir, 'public/review.js', '  if (typeof P === "undefined" || !P) return;\n', '', 'C24'));

control('C25 a keystroke into the unavailable search is swallowed silently instead of explained', 16, (dir) =>
  patch(dir, 'public/app.js', '  event.preventDefault();\n  event.stopImmediatePropagation();\n  shellControlRefused(search);\n', '  event.preventDefault();\n', 'C25'));

control('C26 the search box is left enabled and inert with no project', 16, (dir) =>
  patch(dir, 'public/app.js',
    '    applyShellControlAvailability(search, answer.available, answer.reason, "search-availability-note");\n    applySearchAvailability(search, answer);\n',
    '', 'C26'));

control('C27 the unavailable search is aria-disabled but still accepts a query', 16, (dir) =>
  patch(dir, 'public/app.js', '    search.readOnly = true;\n', '', 'C27'));

control('C30 the expanded narrow search goes translucent, so the header shows through its text', 16, (dir) =>
  patch(dir, 'public/experience-coherence.css',
    '  #topbar .topbar-search[data-shell-unavailable="no-project"]:focus-within { opacity:1; }\n', '', 'C30'));

control('C31 a refused search is read as a result list, and the page throws instead of saying why', 16, (dir) =>
  patch(dir, 'public/review.js',
    '  if (!r.ok || !Array.isArray(d.results)) return toast(d.error || "Search is unavailable right now.");\n', '', 'C31'));

/* ------------------------------------------------------ the welcome mark (C1) */

control('C28 the welcome card shows the "CB" monogram again', 17, (dir) =>
  patch(dir, 'public/app.js',
    '<div class="first-run-mark"><img src="/cinebraid-logo-xs.png" alt="" width="80" height="103" class="first-run-logo"></div>',
    '<div class="first-run-mark">CB</div>', 'C28'));

control('C29 the welcome logo is announced beside the heading that already names CineBraid', 17, (dir) =>
  patch(dir, 'public/app.js', '<img src="/cinebraid-logo-xs.png" alt="" width="80" height="103" class="first-run-logo">',
    '<img src="/cinebraid-logo-xs.png" alt="CineBraid" width="80" height="103" class="first-run-logo">', 'C29'));

/* =========================================================================== */
console.log(notes.join('\n'));
if (failures) {
  console.error(`FAIL no-project shell truth negative controls: ${failures} control(s) did not behave.`);
  process.exit(1);
}
console.log('PASS no-project shell truth negative controls: every rebuilt defect is caught by the check that owns it.');

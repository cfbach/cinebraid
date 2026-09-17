/* NEGATIVE CONTROLS for tests/ev2-7-shell-utilities.js.
 *
 * Each control below breaks ONE property of the two shell utilities and requires the
 * named check to go red for it. A suite that cannot fail proves nothing, and every
 * property here is one the human dogfood actually found broken — so each control is a
 * reconstruction of the defect, not a synthetic mutation.
 *
 * NOTHING IS WRITTEN INTO THE REPOSITORY. The shipped files are COPIED into a temporary
 * directory, the mutation is applied to the copy, and the suite is run against it
 * through EV2_7_SHELL_SOURCE_ROOT. Two suites can therefore run at once, and a crash
 * cannot leave a patched source on disk — which is the failure mode the suites that
 * rewrite sources in place have to be run sequentially to avoid.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'ev2-7-shell-utilities.js');
/* Every file the suite reads. A file it reads and this does not copy would be read from
   the real tree by accident, and a control against it would be answered by the shipped
   source instead of the mutation. */
const FILES = [
  'public/index.html', 'public/shared-workspace-shell.js', 'public/shared-creator-state.js', 'public/shared-braidy.js',
  'public/workspace-shell.js', 'public/braidy-rail.js', 'public/creator-surfaces.js', 'public/live-activity.js',
  'public/media-return.js', 'public/experience-coherence.css', 'public/results-desk.css', 'public/reference-desk.css',
  'public/shot-desk.css', 'public/production-media.css', 'public/working-bible.css', 'public/settings-studio.css',
];

const notes = [];
let failures = 0;

function sandboxCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-ev2-7-shell-nc-'));
  fs.mkdirSync(path.join(dir, 'public'));
  for (const file of FILES) fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  return dir;
}

function patch(dir, file, from, to, label) {
  const at = path.join(dir, file);
  const source = fs.readFileSync(at, 'utf8');
  const normalised = source.replace(/\r\n/g, '\n');
  assert.strictEqual(normalised.split(from).length - 1, 1,
    `${label}: the anchor for ${file} is not present exactly once — the control is patching something that has moved:\n${from}`);
  fs.writeFileSync(at, normalised.replace(from, to));
}

/* Runs the suite against the patched copy and returns which checks failed. */
function run(dir) {
  const result = spawnSync(process.execPath, [SUITE], { env: { ...process.env, EV2_7_SHELL_SOURCE_ROOT: dir }, encoding: 'utf8' });
  const output = String(result.stdout || '') + String(result.stderr || '');
  const failed = [...output.matchAll(/^ {2}FAIL (\d+)/gm)].map((m) => Number(m[1]));
  return { code: result.status, failed, output };
}

function control(label, expectedCheck, apply) {
  const dir = sandboxCopy();
  try {
    apply(dir);
    const { code, failed, output } = run(dir);
    assert.notStrictEqual(code, 0, `${label}: the suite accepted the broken build.\n${output.slice(-800)}`);
    assert.ok(failed.includes(expectedCheck),
      `${label}: expected check ${expectedCheck} to fail; the suite failed ${JSON.stringify(failed)} instead.\n${output.slice(-800)}`);
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
    assert.strictEqual(code, 0, `N0: the unpatched copy must pass, or the controls prove nothing.\n${output.slice(-1200)}`);
    console.log('  ok  N0 the unpatched copy of the shipped tree passes');
    notes.push('  N0 — an unpatched copy passes, so a red control is the mutation and not the copy');
  } catch (error) { failures += 1; console.error(`  FAIL N0\n       ${error.message}`); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();

control('N1 the topbar Activity control goes back to opening only', 2, (dir) =>
  patch(dir, 'public/live-activity.js',
    'toggle.onclick = () => window.CineBraidCreatorSurfaces?.toggleActivity?.();',
    'toggle.onclick = () => window.CineBraidCreatorSurfaces?.expandTerminal?.();', 'N1'));

control('N2 opening one utility stops closing the other', 5, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '    if (railNext && activityNext) {\n      if (next.rail === true) activityNext = false;\n      else railNext = false;\n    }',
    '', 'N2'));

control('N3 a stored pair of open utilities is rendered on top of each other', 5, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '    if (railOpen() && !terminalCollapsed()) writeTerminalCollapsed(true);',
    '', 'N3'));

control('N4 Escape inside a utility stops closing it', 6, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '  document.addEventListener("keydown", utilityEscape, true);',
    '', 'N4'));

control('N4b a utility takes the Escape aimed at a dialog standing over it', 6, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '    const modal = document.getElementById("modal");\n    if (modal && !modal.classList.contains("hidden")) return;',
    '', 'N4b'));

control('N5 opening a utility stops moving focus into it', 6, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '    if (options.focus === "rail" && railNext) focusUtility("rail");\n    if (options.focus === "dock" && activityNext) focusUtility("dock");',
    '', 'N5'));

control('N6 the rail loses the control that closes it from inside', 7, (dir) =>
  patch(dir, 'public/braidy-rail.js',
    '      + `<button type="button" class="cb-utility-close" data-cb-utility-close="rail" onclick="window.CineBraidCreatorSurfaces.closeRail({ focusToggle: \'rail\' })" title="Close Braidy">Close</button>`\n',
    '', 'N6'));

control('N7 an unconfigured Braidy stops offering the place that state is changed', 8, (dir) =>
  patch(dir, 'public/braidy-rail.js',
    '        + `<a class="cb-utility-link" href="#/settings/assistant">Choose an assistant in Settings</a></article>`;',
    '        + `</article>`;', 'N7'));

control('N8 the drawer goes back to an uppercase monospace heading', 9, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '<h2 class="cb-terminal-title" data-cb-utility-focus="1" tabindex="-1">Activity</h2>',
    '<span>ACTIVITY TERMINAL</span>', 'N8'));

control('N9 a desk hides the rail and the shared shell stops handing it back', 10, (dir) =>
  patch(dir, 'public/experience-coherence.css',
    'body:is(.reference-desk-active,.production-media-active,.shot-desk-active) #workspace[data-creator-shell="1"] #cb-shell-rail[data-occupied] {',
    'body:is(.nothing-at-all) #workspace[data-creator-shell="1"] #cb-shell-rail[data-occupied] {', 'N9'));

control('N10 the contextual return goes back to a stacked two-line control', 11, (dir) =>
  patch(dir, 'public/experience-coherence.css',
    '.md-return.cb-return { display:inline-flex; align-items:center;',
    '.cb-return { display:inline-flex; flex-direction:column; align-items:flex-start;', 'N10'));

control('N11 the topbar control stops tracking the drawer it opened', 3, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '    button.setAttribute("aria-expanded", open ? "true" : "false");\n    button.classList.toggle("open", open);\n  }\n\n  /* THE ONE PLACE A MARK BECOMES THE SHIPPED BRAIDY.',
    '  }\n\n  /* THE ONE PLACE A MARK BECOMES THE SHIPPED BRAIDY.', 'N11'));

control('N12 the Activity drawer is expanded again with no stored preference', 1, (dir) =>
  patch(dir, 'public/creator-surfaces.js',
    '      return stored === null ? true : stored !== "0";',
    '      return stored === null ? false : stored !== "0";', 'N12'));

console.log(notes.join('\n'));
if (failures) { console.error(`FAIL ev2-7 shell utility negative controls: ${failures} control(s) did not fire.`); process.exit(1); }
console.log('PASS ev2-7 shell utility negative controls: 13 reconstructions of the dogfood defects, each caught by its own check, none of them written into the repository.');

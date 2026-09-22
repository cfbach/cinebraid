/* NEGATIVE CONTROLS for tests/orphan-entity-creation-refusal.js (ORPHAN_ENTITY_CREATION_REFUSAL_V1).
 *
 * Each control rebuilds ONE way the refusal could be lost — the shared decision, the
 * chooser, a creator's door, the SAVE-time refusal, the accessible reason, the server's
 * guard — and requires the check that OWNS that contract to fail, by number AND by the words
 * of the assertion that fired. A control can therefore never pass because something
 * unrelated went red, and an anchor that has moved can never pass for a caught defect.
 *
 * The visible behaviour behind the client controls is broken again in a real browser by
 * tests/orphan-entity-creation-refusal-real-browser.py, against the served page.
 *
 * NOTHING IS WRITTEN INTO THE REPOSITORY. A client control patches a COPY of public/ in a
 * temporary directory; a server control applies its edit IN MEMORY, to the server child
 * only, as node loads src/server/server.js. Every shipped file the controls read is hashed
 * before the first control and after the last, and must be byte-identical.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'orphan-entity-creation-refusal.js');
const SERVER = path.join(ROOT, 'src', 'server', 'server.js');

const notes = [];
let failures = 0;

/* Every shipped file a control reads, by content, so "restored byte-identically" is measured. */
const WATCHED = [SERVER, ...fs.readdirSync(path.join(ROOT, 'public')).filter((n) => /\.(js|html|css)$/.test(n)).map((n) => path.join(ROOT, 'public', n))];
const digests = () => Object.fromEntries(WATCHED.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const BEFORE = digests();

function sandboxCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-orphan-entity-nc-'));
  fs.mkdirSync(path.join(dir, 'public'));
  for (const name of fs.readdirSync(path.join(ROOT, 'public')))
    if (/\.(js|html|css)$/.test(name)) fs.copyFileSync(path.join(ROOT, 'public', name), path.join(dir, 'public', name));
  return dir;
}

function patch(dir, file, from, to, label) {
  const at = path.join(dir, file);
  const normalised = fs.readFileSync(at, 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(normalised.split(from).length - 1, 1,
    `${label}: the anchor for ${file} is not present exactly once — the control is patching something that has moved:\n${from}`);
  fs.writeFileSync(at, normalised.replace(from, to));
}

function run(env) {
  const result = spawnSync(process.execPath, [SUITE], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 300000 });
  const output = String(result.stdout || '') + String(result.stderr || '');
  const failed = {};
  for (const m of output.matchAll(/^ {2}FAIL (\d+)\.[^\n]*\n\s+([^\n]*)/gm)) failed[Number(m[1])] = m[2];
  return { code: result.status, failed, output };
}

function judge(label, expectedCheck, expectedWords, outcome) {
  const { code, failed, output } = outcome;
  assert.ok(!/MUTATION ANCHOR FOUND/.test(output),
    `${label}: the anchor is not in src/server/server.js exactly once — the control has drifted off the seam it breaks`);
  assert.notStrictEqual(code, 0, `${label}: the suite accepted the broken build.\n${output.slice(-900)}`);
  assert.ok(Object.prototype.hasOwnProperty.call(failed, expectedCheck),
    `${label}: expected check ${expectedCheck} to fail; the suite failed ${JSON.stringify(Object.keys(failed))} instead.\n${output.slice(-900)}`);
  assert.ok(failed[expectedCheck].includes(expectedWords),
    `${label}: check ${expectedCheck} failed, but not at the assertion that owns this contract. Expected "${expectedWords}", got: ${failed[expectedCheck].slice(0, 300)}`);
  notes.push(`  ${label}\n      check ${expectedCheck}: ${failed[expectedCheck].slice(0, 170)}`);
}

function clientControl(label, expectedCheck, expectedWords, apply) {
  const dir = sandboxCopy();
  try {
    apply(dir);
    judge(label, expectedCheck, expectedWords, run({ ORPHAN_ENTITY_SOURCE_ROOT: dir, ORPHAN_ENTITY_PART: 'client' }));
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function serverControl(label, expectedCheck, expectedWords, mutation) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-orphan-entity-nc-server-'));
  try {
    const spec = path.join(dir, 'mutation.json');
    fs.writeFileSync(spec, JSON.stringify({ file: SERVER, ...mutation }));
    judge(label, expectedCheck, expectedWords, run({ ORPHAN_ENTITY_SERVER_MUTATION: spec, ORPHAN_ENTITY_PART: 'server' }));
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* The harness itself: the unmutated suite, both halves, must pass, or every red below is
   the harness and not the mutation. */
(function unmutatedPasses() {
  const { code, output } = run({ ORPHAN_ENTITY_PART: '' });
  try {
    assert.strictEqual(code, 0, `N0: the unmutated suite must pass, or the controls prove nothing.\n${output.slice(-1400)}`);
    console.log('  ok  N0 the unmutated suite passes, client and server');
    notes.push('  N0 the unmutated suite passes, so a red control is the mutation and not the harness');
  } catch (error) { failures += 1; console.error(`  FAIL N0\n       ${error.message}`); }
})();

/* ------------------------------------------------------------- the shared decision */

clientControl('NC1 the shared decision allows every record whenever nothing is opening', 1,
  'first run: shot.available must be false',
  (dir) => patch(dir, 'public/shared-shell-availability.js',
    '    if (writable) return { record, available: true, state: "open", action: "", heading: "", reason: "" };',
    '    if (true) return { record, available: true, state: "open", action: "", heading: "", reason: "" };', 'NC1'));

clientControl('NC2 the chooser answers from first run alone again, so Recovery mode offers all eight', 2,
  'the chooser and the decision disagree',
  (dir) => patch(dir, 'public/shared-shell-availability.js',
    '  function shellAddChoiceAvailable(key, facts) {\n'
    + '    if (availabilityText(key) === "project") return shellEntityCreationAvailability("", facts).state !== "opening";\n'
    + '    return shellEntityCreationAvailability(key, facts).available;\n'
    + '  }',
    '  function shellAddChoiceAvailable(key, facts) {\n'
    + '    const raw = facts && typeof facts === "object" ? facts : {};\n'
    + '    if (raw.hasProject) return true;\n'
    + '    return availabilityText(key) === "project";\n'
    + '  }', 'NC2'));

clientControl('NC14 a running open offers New project again — a second project operation beside the first', 2,
  'while a project is opening NOTHING is offered',
  (dir) => patch(dir, 'public/shared-shell-availability.js',
    '    if (availabilityText(key) === "project") return shellEntityCreationAvailability("", facts).state !== "opening";\n',
    '    if (availabilityText(key) === "project") return true;\n', 'NC14'));

clientControl('NC3 the save path keeps its own copy of the record condition again', 3,
  'captureProjectSave() must ask the same function',
  (dir) => patch(dir, 'public/app.js',
    '  if (!projectRecordInstalled()) return null;',
    '  if (!P || !ACTIVE_PROJECT_SLUG) return null;', 'NC3'));

clientControl('NC15 the creators are no longer told that an open is running', 3,
  'the creation facts are the shell\'s first-run answer, the record, the running open',
  (dir) => patch(dir, 'public/app.js',
    'opening: projectOpenInFlight() };', 'opening: false };', 'NC15'));

clientControl('NC16 a replacement is dispatched without being counted as a running open', 3,
  'every replacement must be counted as a running open',
  (dir) => patch(dir, 'public/app.js',
    '    : trackProjectOpen(() => runProjectReplacement());\n', '    : runProjectReplacement();\n', 'NC16'));

/* ------------------------------------------------------------- the creators' door */

/* Its SAVE-time refusal is still in the form, so what fires is the ORDER: the form is drawn
   before anything is asked. */
clientControl('NC4 addEntity draws its form without asking the door', 4,
  'addEntity touches the record or draws its dialog BEFORE asking the door',
  (dir) => patch(dir, 'public/mutations.js', '  if (refuseEntityCreation(record)) return;\n', '', 'NC4'));

clientControl('NC5 addShot reads the record before it asks the door', 4,
  'addShot touches the record or draws its dialog BEFORE asking the door',
  (dir) => patch(dir, 'public/mutations.js',
    '  if (refuseEntityCreation("shot")) return;\n  const hasScenes = !!P.scenes.length;\n',
    '  const hasScenes = !!P.scenes.length;\n  if (refuseEntityCreation("shot")) return;\n', 'NC5'));

clientControl('NC6 a new record writer is added with no door at all', 4,
  'must find exactly the four shipped creators',
  (dir) => patch(dir, 'public/mutations.js',
    '/* ---------- drag-and-drop takes ---------- */\n',
    '/* ---------- drag-and-drop takes ---------- */\nwindow.addStrayRecord = () => { P.characters.push({ id: "STRAY" }); };\n', 'NC6'));

/* ------------------------------------------------------------- SAVE, its project, and the reason */

clientControl('NC7 SAVE closes the dialog before it asks, so a vanished project throws the typing away again', 5,
  'SAVE must ask the refusal, with the remembered project, and return BEFORE closeModal()',
  (dir) => patch(dir, 'public/app.js',
    '    const refusal = refuse ? refuse(openedFor) : "";\n'
    + '    if (refusal) {\n'
    + '      const note = $("#form-modal-refusal");\n'
    + '      if (note) { note.textContent = refusal; note.hidden = false; }\n'
    + '      return;\n'
    + '    }\n', '', 'NC7'));

clientControl('NC8 addEntity stops asking at SAVE', 5,
  'addEntity must hand its SAVE-time refusal the project it was drawn for',
  (dir) => patch(dir, 'public/mutations.js', '    { refuse: (openedFor) => entityCreationRefusal(record, openedFor) },\n', '', 'NC8'));

clientControl('NC17 only the project-identity binding is removed: "a record is installed" passes for "the same project"', 5,
  'the same project means the same slug AND the same explicit open',
  (dir) => patch(dir, 'public/app.js',
    '  return !!identity && projectRecordInstalled()\n    && identity.slug === ACTIVE_PROJECT_SLUG && identity.epoch === PROJECT_OPEN_EPOCH;\n',
    '  return !!identity && projectRecordInstalled();\n', 'NC17'));

clientControl('NC18 the save boundary forgets which project the form was drawn for', 5,
  'formModal — the one save boundary — must remember the project identity',
  (dir) => patch(dir, 'public/app.js',
    '  const openedFor = refuse ? projectOpenIdentity() : null;\n', '  const openedFor = undefined;\n', 'NC18'));

clientControl('NC9 the reason is printed but is no longer the dialog\'s accessible description', 6,
  'the reason must be the dialog\'s accessible description',
  (dir) => patch(dir, 'public/app.js', '  $("#modal .modal-box")?.setAttribute("aria-describedby", "global-add-reason");\n', '', 'NC9'));

clientControl('NC19 a chooser saying "still opening" is never redrawn once the open settles', 6,
  'the redraw is asked for when the last open settles',
  (dir) => patch(dir, 'public/app.js',
    '    if (!PROJECT_OPENS_IN_FLIGHT) try { refreshEntityCreationRefusal(); } catch (_) {}\n', '', 'NC19'));

clientControl('NC13 the refusal\'s one offered action is keyed to first run again, a dead end in Recovery', 6,
  'New project must open the shipped dialog wherever there is no record',
  (dir) => patch(dir, 'public/app.js',
    '    if (!projectRecordInstalled()) return newProject();\n',
    '    if (shellInFirstRun()) return newProject();\n', 'NC13'));

/* ------------------------------------------------------------- a form's initial focus */

/* Exactly the line that was removed: the form's own second focus of its first field, 30 ms after
   openModal() had already put focus there. */
clientControl('NC22 formModal queues its own delayed first-field focus again', 7,
  'formModal must queue no focus of its own',
  (dir) => patch(dir, 'public/app.js',
    '      <button class="lock-btn" onclick="_formSubmit()">SAVE</button></div>`);\n}\n',
    '      <button class="lock-btn" onclick="_formSubmit()">SAVE</button></div>`);\n  setTimeout(() => $("#ff-" + fields[0].k)?.focus(), 30);\n}\n', 'NC22'));

/* ------------------------------------------------------------- the server */

const GATE = '  if (!inspected.ok) throw mediaOwnerError(inspected.status === 422 ? "PROJECT_UNREADABLE" : "NO_ACTIVE_PROJECT");\n';

serverControl('NC10 the server gate is removed — media lands in <projects root>/_none again', 8,
  'a media write must be REFUSED and create nothing', { from: GATE, to: '' });

serverControl('NC20 only the unreadable-project guard is removed — Recovery\'s damaged project is written into again', 13,
  'the damaged project directory changed',
  { from: GATE, to: '  if (!inspected.ok && inspected.status !== 422) throw mediaOwnerError("NO_ACTIVE_PROJECT");\n' });

serverControl('NC11 the no-project refusal names the placeholder directory it refused to write into', 9,
  'a no-project refusal must leak nothing',
  { from: '    : "No project is open, so there is no project to store this in. Open or create a project first.";\n',
    to: '    : "No project is open, so there is no project to store this in. Open or create a project first. (" + PROJECT_DIR() + ")";\n' });

serverControl('NC21 the unreadable-project refusal names the damaged folder it refused to write into', 14,
  'an unreadable-project refusal must leak no path',
  { from: '"This project\'s file cannot be read, so nothing was stored in it. CineBraid does not write into a project it cannot open — recover it or open another project first."',
    to: '"This project\'s file cannot be read, so nothing was stored in it. CineBraid does not write into a project it cannot open — recover it or open another project first. (" + PROJECT_DIR() + ")"' });

serverControl('NC12 the no-project refusal loses its status and answers a generic 400', 8,
  'must refuse with its own status 404',
  { from: '  if (error?.code === "NO_ACTIVE_PROJECT") return 404;\n', to: '' });

/* The controls patched copies and memory, never the tree. Proven, not asserted in prose. */
try {
  const after = digests();
  const changed = WATCHED.filter((file) => after[file] !== BEFORE[file]).map((file) => path.relative(ROOT, file));
  assert.deepStrictEqual(changed, [], 'shipped files changed on disk during the controls — they must patch copies or memory only');
  notes.push(`  ${WATCHED.length} shipped files (src/server/server.js and every public/ source) byte-identical before and after every control`);
} catch (error) { failures += 1; console.error(`  FAIL ${error.message}`); }

console.log(notes.join('\n'));
if (failures) {
  console.error(`FAIL orphan entity creation refusal negative controls: ${failures} control(s) did not behave.`);
  process.exit(1);
}
console.log('PASS orphan entity creation refusal negative controls: every rebuilt defect is caught by the assertion that owns it.');

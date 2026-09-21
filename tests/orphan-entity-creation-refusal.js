/* ORPHAN_ENTITY_CREATION_REFUSAL_V1 — A RECORD IS CREATED INTO A PROJECT, OR NOT AT ALL.
 *
 * MEASURED ON 12a338d (NO_PROJECT_SHELL_TRUTH_V1 merged), 2026-09-21, against a real
 * Chromium and a real server in disposable roots:
 *
 *   * first run: the ＋ Add chooser already offered only New project, but every direct
 *     creator — openContextualAdd, runGlobalAdd, addEntity, addScene — still opened its
 *     full form, and its SAVE closed the dialog, threw a TypeError on the missing record
 *     and made no request: the typing was gone with no word on screen;
 *   * Recovery mode and a failed load: the chooser offered all eight records, and Scene,
 *     Character, Location, Prop, Vehicle and Audio opened that same discarding form;
 *   * a project still opening: a form opened before the record arrived discarded its input
 *     if SAVE was pressed before it did;
 *   * the server: POST /api/media/upload (and every media route that resolves the active
 *     project) with no project open wrote into `<projects root>/_none/…` and answered
 *     {ok:true} — a success receipt for a character reference no project will ever list.
 *
 * This suite pins the repair at the level Node can see: the shared decision, the places in
 * the shipped source that must ask it, and the server's own refusal, measured on a real
 * server child. What a filmmaker SEES — no form opens, the refusal is read aloud, a SAVE
 * whose project vanished keeps the typing — is measured in a real browser by
 * tests/orphan-entity-creation-refusal-real-browser.py.
 *
 * FOUR KNOBS, for the companion negative controls and for the pristine reproduction:
 *   ORPHAN_ENTITY_SOURCE_ROOT      read public/ from another tree (a patched copy, or 12a338d)
 *   ORPHAN_ENTITY_SERVER_ROOT      run the server from another tree (12a338d, to reproduce)
 *   ORPHAN_ENTITY_SERVER_MUTATION  a JSON file {file, from, to}: one anchored edit applied to
 *                                  that server source IN MEMORY as node loads it
 *   ORPHAN_ENTITY_PART             "client" or "server": run only checks 1-6 or 7-12. The
 *                                  controls use it so a client control does not start a
 *                                  server; every ordinary run leaves it unset and runs both.
 *
 * NOTHING IS CONFIGURED, PAID FOR, OR SENT ANYWHERE. Every server runs in a disposable root
 * (tests/helpers/disposable-root.js: providers off, credentials blanked) on loopback, and
 * every outbound connection the server process opens is recorded and must be loopback.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { disposableRoot } = require('./helpers/disposable-root');

const REPO = path.resolve(path.join(__dirname, '..'));
const ROOT = path.resolve(process.env.ORPHAN_ENTITY_SOURCE_ROOT || REPO);
const SERVER_ROOT = path.resolve(process.env.ORPHAN_ENTITY_SERVER_ROOT || REPO);
const MUTATION = process.env.ORPHAN_ENTITY_SERVER_MUTATION || '';
const PART = process.env.ORPHAN_ENTITY_PART || '';
if (PART && !['client', 'server'].includes(PART)) throw new Error(`ORPHAN_ENTITY_PART must be "client" or "server", got ${PART}`);
const read =(file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const notes = [];
const note = (line) => notes.push(line);
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The records the add control can create inside a project — its own keys, read out of the
   shipped chooser rather than retyped, so a record added there is covered here. */
function shippedAddKeys() {
  const app = read('public/app.js');
  const start = app.indexOf('const GLOBAL_ADD_CHOICES = [');
  assert.ok(start > 0, 'public/app.js no longer declares GLOBAL_ADD_CHOICES');
  const block = app.slice(start, app.indexOf('];', start));
  return [...block.matchAll(/^\s*\["([a-z]+)",/gm)].map((m) => m[1]);
}

/* The same list with its labels, for the decision's record names. */
function shippedAddChoices() {
  const app = read('public/app.js');
  const start = app.indexOf('const GLOBAL_ADD_CHOICES = [');
  const block = app.slice(start, app.indexOf('];', start));
  return [...block.matchAll(/^\s*\["([a-z]+)","([^"]+)",/gm)].map((m) => [m[1], m[2]]);
}

/* A shipped `window.<name> = …` assignment, from its first line to the next top-level one. */
function creatorSource(src, name) {
  const at = src.indexOf(`\nwindow.${name} = `);
  assert.ok(at >= 0, `window.${name} is no longer assigned where this suite expects it`);
  const next = src.slice(at + 1).search(/\n(?:window\.\w+ = |function |async function |const |let |\/\* )/);
  return src.slice(at + 1, next < 0 ? undefined : at + 1 + next);
}

/* =========================================================================== CLIENT */

check('1. the shared decision answers every state with its own heading, reason and permitted action', () => {
  const Availability = require(path.join(ROOT, 'public', 'shared-shell-availability.js'));
  assert.strictEqual(typeof Availability.shellEntityCreationAvailability, 'function',
    'public/shared-shell-availability.js must answer whether a record may be created — without it every creator decides for itself, which is how six forms came to discard their input');
  const { shellEntityCreationAvailability: decide, SHELL_NO_PROJECT_REASONS, SHELL_NO_PROJECT_REMEDY, SHELL_RECORD_LABELS, SHELL_ENTITY_CREATION_TEXT: TEXT } = Availability;
  const keys = shippedAddKeys().filter((key) => key !== 'project');
  assert.deepStrictEqual(keys, ['shot', 'scene', 'character', 'location', 'prop', 'vehicle', 'audio'],
    'the add control creates these seven records inside a project');
  assert.deepStrictEqual(Object.entries(SHELL_RECORD_LABELS), shippedAddChoices().filter(([key]) => key !== 'project').map(([key, label]) => [key, label]),
    'the decision\'s record labels must be the chooser\'s own labels, in its order — a second list that drifted would head a refusal with the wrong name');
  const expect = (label, facts, want) => {
    for (const key of keys) {
      const answer = decide(key, facts);
      for (const [field, value] of Object.entries(want(key)))
        assert.deepStrictEqual(answer[field], value, `${label}: ${key}.${field} must be ${JSON.stringify(value)}, got ${JSON.stringify(answer[field])} for ${JSON.stringify(facts)}`);
    }
  };
  expect('a project still opening', { hasProject: true, projectRecord: false, opening: true },
    () => ({ available: false, state: 'opening', action: 'wait', heading: TEXT.openingHeading, reason: TEXT.opening }));
  expect('an open running over an installed record', { hasProject: true, projectRecord: true, opening: true },
    () => ({ available: false, state: 'opening', action: 'wait' }));
  expect('a SAVE while an open is running', { hasProject: true, projectRecord: true, opening: true, projectChanged: true },
    () => ({ state: 'opening', action: 'wait' }));
  expect('first run', { hasProject: false, projectRecord: false },
    (key) => ({ available: false, state: 'no-project', action: 'create-project', heading: `${SHELL_RECORD_LABELS[key]} needs an open project`, reason: SHELL_NO_PROJECT_REASONS.add }));
  expect('Recovery mode / a failed load', { hasProject: true, projectRecord: false },
    (key) => ({ available: false, state: 'unopenable', action: 'create-project', heading: `${SHELL_RECORD_LABELS[key]} needs an open project`, reason: SHELL_NO_PROJECT_REASONS.add }));
  expect('first run, asked without the record fact', { hasProject: false }, () => ({ available: false, state: 'no-project' }));
  expect('a form\'s SAVE with ANOTHER project installed', { hasProject: true, projectRecord: true, projectChanged: true },
    (key) => ({ available: false, state: 'replaced', action: 'none', heading: `${SHELL_RECORD_LABELS[key]} was not saved`, reason: TEXT.replaced }));
  expect('a form\'s SAVE after its project went away', { hasProject: true, projectRecord: false, projectChanged: true },
    () => ({ available: false, state: 'gone', action: 'none', reason: TEXT.gone }));
  expect('a form\'s SAVE into the project it was drawn for', { hasProject: true, projectRecord: true, projectChanged: false },
    () => ({ available: true, state: 'open', reason: '' }));
  expect('a record installed', { hasProject: true, projectRecord: true }, () => ({ available: true, state: 'open', action: '', reason: '' }));
  expect('a record installed, asked without the record fact', { hasProject: true }, () => ({ available: true }));
  assert.ok(/belong to a project/.test(SHELL_NO_PROJECT_REASONS.add) && SHELL_NO_PROJECT_REASONS.add.endsWith(SHELL_NO_PROJECT_REMEDY),
    `the pre-open reason must say a record belongs to a project and end with the shell's one remedy: ${SHELL_NO_PROJECT_REASONS.add}`);
  assert.ok(/still opening/.test(TEXT.openingHeading) && /Wait until it finishes before adding records/.test(TEXT.opening) && !/create|open an existing|new project/i.test(TEXT.opening),
    `the opening answer must say to wait, and must not advise starting another project operation: ${TEXT.opening}`);
  assert.ok(/nothing was saved/.test(TEXT.replaced) && /wrong project/.test(TEXT.replaced) && /nothing was saved/.test(TEXT.gone) && /still in the form/.test(TEXT.gone),
    'a refused SAVE must say nothing was saved, why, and that the entries are kept');
  note(`1. ${keys.length} records × 7 states: opening/wait, no-project + unopenable/create-project, replaced + gone/none, open`);
});

check('2. the ＋ Add chooser offers exactly what the answer permits — nothing at all while a project opens', () => {
  const { shellAddChoices, shellAddChoiceAvailable, shellEntityCreationAvailability: decide } =
    require(path.join(ROOT, 'public', 'shared-shell-availability.js'));
  const keys = shippedAddKeys();
  for (const facts of [{ hasProject: false, projectRecord: false }, { hasProject: true, projectRecord: false }, { hasProject: true, projectRecord: true },
    { hasProject: true, projectRecord: false, opening: true }, { hasProject: true, projectRecord: true, opening: true }])
    for (const key of keys.filter((k) => k !== 'project'))
      assert.strictEqual(shellAddChoiceAvailable(key, facts), decide(key, facts).available,
        `the chooser and the decision disagree about ${key} for ${JSON.stringify(facts)}`);
  assert.deepStrictEqual(shellAddChoices(keys, { hasProject: true, projectRecord: false }), ['project'],
    'Recovery mode and a failed load offer only New project — the shipped chooser offered all eight');
  assert.deepStrictEqual(shellAddChoices(keys, { hasProject: false, projectRecord: false }), ['project'], 'first run offers only New project');
  assert.deepStrictEqual(shellAddChoices(keys, { hasProject: true, projectRecord: false, opening: true }), [],
    'while a project is opening NOTHING is offered — New project would start a second project operation beside the one running');
  assert.deepStrictEqual(shellAddChoices(keys, { hasProject: true, projectRecord: true }), keys, 'with a record every choice is offered');
  const app = read('public/app.js');
  const open = app.slice(app.indexOf('window.openGlobalAdd = '), app.indexOf('/* ADD, WHERE THE SURFACE HAS ALREADY NAMED THE RECORD.'));
  assert.ok(/const facts = entityCreationFacts\(\);/.test(open) && /GLOBAL_ADD_CHOICES\.filter\(\(\[key\]\) => shellAddChoiceAvailable\(key, facts\)\)/.test(open),
    'the chooser must filter on the facts every creator is answered from, not on first run alone');
  note('2. the chooser is the answer: New project alone with no record, nothing at all while a project opens, everything with one');
});

check('3. each fact has one owner: the record, the running open, and the project a form was drawn for', () => {
  const app = read('public/app.js');
  const def = app.match(/function projectRecordInstalled\(\) \{\n\s*return ([^;]+);\n\}/);
  assert.ok(def, 'public/app.js must define projectRecordInstalled()');
  assert.strictEqual(def[1], '!!P && !!ACTIVE_PROJECT_SLUG', 'the record fact is the save path\'s own condition');
  const capture = app.slice(app.indexOf('function captureProjectSave() {'), app.indexOf('function captureProjectSave() {') + 160);
  assert.ok(/^function captureProjectSave\(\) \{\n\s*if \(!projectRecordInstalled\(\)\) return null;/.test(capture),
    'captureProjectSave() must ask the same function, or creation and saving can disagree about whether there is a record');
  assert.ok(/function entityCreationFacts\(openedFor\) \{\n\s*const facts = \{ hasProject: shellHasProject\(\), projectRecord: projectRecordInstalled\(\), opening: projectOpenInFlight\(\) \};\n\s*if \(openedFor !== undefined\) facts\.projectChanged = !sameProjectOpen\(openedFor\);/.test(app),
    'the creation facts are the shell\'s first-run answer, the record, the running open and — for a form\'s SAVE — whether its project is still installed; nothing re-derived');
  /* THE RUNNING OPEN IS THE LIFECYCLE'S OWN FACT: counted around the one replacement entry. */
  const load = app.slice(app.indexOf('async function load(options = {}) {'), app.indexOf('/* ORPHAN_ENTITY_CREATION_REFUSAL_V1 — WHETHER AN OPEN IS RUNNING.'));
  assert.ok(/: trackProjectOpen\(\(\) => runProjectReplacement\(\)\);/.test(load),
    'every replacement must be counted as a running open where load() dispatches it — an open the facts cannot see is a window that offers New project while one is already starting');
  assert.ok(/function trackProjectOpen\(start\) \{\n\s*PROJECT_OPENS_IN_FLIGHT \+= 1;[\s\S]*?\.finally\(\(\) => \{\n\s*PROJECT_OPENS_IN_FLIGHT -= 1;/.test(app),
    'the count must rise before the open starts and fall however it settles');
  assert.ok(/function projectOpenInFlight\(\) \{\n\s*return PROJECT_OPENS_IN_FLIGHT > 0 \|\| \(typeof manualReplacementBusy === "function" && !!manualReplacementBusy\(\)\);/.test(app),
    'the manual create transaction is a running open too');
  assert.strictEqual([...app.matchAll(/PROJECT_OPENS_IN_FLIGHT [+-]= 1/g)].length, 2, 'the count has one increment and one decrement, both in trackProjectOpen()');
  const publicDir = path.join(ROOT, 'public');
  const askers = fs.readdirSync(publicDir).filter((name) => name.endsWith('.js') && name !== 'shared-shell-availability.js')
    .flatMap((name) => [...fs.readFileSync(path.join(publicDir, name), 'utf8').matchAll(/shellEntityCreationAvailability\(/g)].map(() => name));
  assert.deepStrictEqual(askers, ['app.js'], `exactly one runtime place asks the decision (entityCreationAnswer), found ${JSON.stringify(askers)}`);
  note('3. projectRecordInstalled() is captureProjectSave()\'s gate; the running open is counted where load() dispatches a replacement; one caller asks the decision');
});

check('4. every writer of a new record passes the door before it draws or touches anything', () => {
  const lists = 'scenes|shots|characters|locations|props|vehicles|audio';
  const pushes = new RegExp(`\\bP(?:\\.(?:${lists})|\\[list\\])\\.push\\(`, 'g');
  const publicDir = path.join(ROOT, 'public');
  const found = [];
  for (const name of fs.readdirSync(publicDir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(publicDir, name), 'utf8').replace(/\r\n/g, '\n');
    for (const m of src.matchAll(pushes)) {
      const head = src.lastIndexOf('\nwindow.', m.index);
      const owner = head >= 0 ? (src.slice(head + 1).match(/^window\.(\w+) = /) || [])[1] : '';
      found.push({ file: name, owner: owner || '(no creator)' });
    }
  }
  const owners = [...new Set(found.map((row) => `${row.file}:${row.owner}`))].sort();
  assert.deepStrictEqual(owners, ['mutations.js:addEntity', 'mutations.js:addScene', 'mutations.js:addShot', 'mutations.js:confirmDuplicateShot'],
    `the census of every new-record push in public/ must find exactly the four shipped creators, found ${JSON.stringify(owners)}`);
  const mutations = read('public/mutations.js');
  const touches = /formModal\(|openModal\(|shotById\(|\bP\.|\bP\[/;
  for (const [name, key] of [['addEntity', null], ['addScene', 'scene'], ['addShot', 'shot'], ['duplicateShot', 'shot'], ['confirmDuplicateShot', 'shot']]) {
    const src = creatorSource(mutations, name);
    const door = src.search(/refuseEntityCreation\(|entityCreationRefusal\(/);
    const first = src.search(touches);
    assert.ok(door > 0, `${name} never asks whether a record may be created — it would draw its form with no project to save into`);
    assert.ok(first < 0 || door < first, `${name} touches the record or draws its dialog BEFORE asking the door`);
    if (key) assert.ok(src.includes(`("${key}"`), `${name} must ask about the ${key} record`);
  }
  assert.ok(/const record = \{ characters: "character", locations: "location", props: "prop", vehicles: "vehicle", audio: "audio" \}\[list\] \|\| list;\n\s*if \(refuseEntityCreation\(record\)\) return;/.test(creatorSource(mutations, 'addEntity')),
    'addEntity must ask about the chooser key of the list it creates in');
  note(`4. ${found.length} new-record writes in public/, all inside addEntity/addScene/addShot/confirmDuplicateShot, each behind the door`);
});

check('5. every creator\'s SAVE asks again, before the dialog closes, about the project it was drawn for', () => {
  const app = read('public/app.js');
  const form = app.slice(app.indexOf('function formModal(title, fields, onSubmit, options = {}) {'), app.indexOf('/* ---------- routing ---------- */'));
  assert.ok(form.length > 100, 'formModal must accept an options argument carrying the SAVE-time refusal');
  assert.ok(/const refuse = typeof options\.refuse === "function" \? options\.refuse : null;\n\s*const openedFor = refuse \? projectOpenIdentity\(\) : null;\n\s*window\._formSubmit = \(\) => \{/.test(form),
    'formModal — the one save boundary — must remember the project identity the form was DRAWN for, before SAVE can be pressed');
  const submit = form.slice(form.indexOf('window._formSubmit = () => {'), form.indexOf('openModal('));
  const asked = submit.indexOf('const refusal = refuse ? refuse(openedFor) : "";');
  const refusedReturn = submit.indexOf('return;', asked);
  const closed = submit.indexOf('closeModal();');
  assert.ok(asked >= 0 && closed > 0 && asked < closed && refusedReturn > asked && refusedReturn < closed,
    'SAVE must ask the refusal, with the remembered project, and return BEFORE closeModal() — this dialog closed first, so a failing save had already thrown the typing away');
  assert.ok(/<p id="form-modal-refusal" class="form-refusal" role="alert" hidden><\/p>/.test(form),
    'the SAVE-time refusal is shown inside the form in an alert, so the press is answered aloud');
  const ident = app.match(/function sameProjectOpen\(identity\) \{\n\s*return ([^;]+);\n\}/);
  assert.ok(ident && /identity\.slug === ACTIVE_PROJECT_SLUG/.test(ident[1]) && /identity\.epoch === PROJECT_OPEN_EPOCH/.test(ident[1]) && /projectRecordInstalled\(\)/.test(ident[1]),
    `the same project means the same slug AND the same explicit open, with a record installed — "P and a slug are truthy again" is not the same project: ${ident && ident[1]}`);
  assert.ok(/function projectOpenIdentity\(\) \{\n\s*return projectRecordInstalled\(\) \? \{ slug: ACTIVE_PROJECT_SLUG, epoch: PROJECT_OPEN_EPOCH \} : null;/.test(app),
    'the identity remembered is the slug and the open that installed it');
  const mutations = read('public/mutations.js');
  for (const [name, key] of [['addScene', '"scene"'], ['addShot', '"shot"'], ['addEntity', 'record']])
    assert.ok(creatorSource(mutations, name).includes(`{ refuse: (openedFor) => entityCreationRefusal(${key}, openedFor) }`),
      `${name} must hand its SAVE-time refusal the project it was drawn for`);
  assert.ok(/window\._duplicateShotOpenedFor = projectOpenIdentity\(\);/.test(creatorSource(mutations, 'duplicateShot'))
    && /const refusal = entityCreationRefusal\("shot", window\._duplicateShotOpenedFor \|\| null\);\n\s*if \(refusal\) return toast\(refusal\);/.test(creatorSource(mutations, 'confirmDuplicateShot')),
    'the duplicate dialog, which is not a formModal, must remember its own project and refuse its confirm in words when that project is gone or replaced');
  note('5. formModal remembers {slug, epoch} when drawn and asks refuse(openedFor) before closeModal(); every creator passes it; the duplicate dialog keeps its own');
});

check('6. a refused creator answers in the chooser the shared answer draws — and a "still opening" answer is redrawn when it stops being true', () => {
  const app = read('public/app.js');
  const door = app.slice(app.indexOf('function refuseEntityCreation(key) {'), app.indexOf('window.openGlobalAdd = '));
  assert.ok(/if \(!entityCreationRefusal\(key\)\) return false;\n\s*openGlobalAdd\(key\);\n\s*return true;/.test(door),
    'a refused creator opens the chooser for the record it was asked for, and nothing else');
  const open = app.slice(app.indexOf('window.openGlobalAdd = '), app.indexOf('/* ADD, WHERE THE SURFACE HAS ALREADY NAMED THE RECORD.'));
  assert.ok(/const answer = entityCreationAnswer\(asked \|\| "shot"\)/.test(open) && /const sub = answer\.available \? "Choose the record you need\.[^"]*" : answer\.reason;/.test(open),
    'the chooser\'s sentence is the shared answer\'s reason whenever a record cannot be created');
  assert.ok(/const heading = !answer\.available && \(asked \|\| answer\.state === "opening"\) \? answer\.heading : "What are you adding\?";/.test(open),
    'the heading is the shared answer\'s — the record asked for, or the open that is running');
  assert.ok(/data-entity-creation-state="\$\{attr\(answer\.state\)\}"/.test(open), 'the chooser carries the state it was drawn in');
  assert.ok(/<div class="modal-sub" id="global-add-reason">\$\{esc\(sub\)\}<\/div>/.test(open)
    && /\$\("#modal \.modal-box"\)\?\.setAttribute\("aria-describedby", "global-add-reason"\);/.test(open),
    'the reason must be the dialog\'s accessible description, so a screen reader hears it with the heading');
  const refresh = app.slice(app.indexOf('function refreshEntityCreationRefusal() {'), app.indexOf('function refreshEntityCreationRefusal() {') + 700);
  assert.ok(/data-entity-creation-state"\) !== "opening"\) return;/.test(refresh) && /if \(projectOpenInFlight\(\)\) return;/.test(refresh)
    && /openGlobalAdd\(box\.getAttribute\("data-preferred"\) \|\| "", \{ refresh: true \}\);/.test(refresh),
    'a chooser saying "still opening" must be redrawn from the true answer once no open is running, and nothing else touched');
  assert.ok(/if \(!PROJECT_OPENS_IN_FLIGHT\) try \{ refreshEntityCreationRefusal\(\); \} catch \(_\) \{\}/.test(app)
    && /window\.addEventListener\("cinebraid:route-rendered", refreshEntityCreationRefusal\)/.test(app),
    'the redraw is asked for when the last open settles (success, first run, refusal or failure) and after every route render');
  /* The one action the no-record refusal offers must work wherever it is offered. */
  const run = app.slice(app.indexOf('window.runGlobalAdd = '), app.indexOf('/* THE BOARD FILTERS ARE A THIRD READING'));
  assert.ok(/if \(!projectRecordInstalled\(\)\) return newProject\(\);/.test(run),
    'New project must open the shipped dialog wherever there is no record — the refusal offers it in every such state');
  note('6. the chooser draws the shared answer (state, heading, reason, choices); "still opening" is redrawn when the last open settles; New project opens its dialog wherever offered');
});

/* =========================================================================== SERVER */

const RECORDER = `
const net = require('net'); const fs = require('fs');
const log = process.env.ORPHAN_ENTITY_CONNECTIONS;
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  try {
    const first = args[0];
    const row = Array.isArray(first) ? first[0] : first;
    const target = row && typeof row === 'object'
      ? (row.path ? { path: String(row.path) } : { host: String(row.host || 'localhost'), port: Number(row.port) })
      : (typeof row === 'string' && isNaN(Number(row)) ? { path: row } : { host: String(args[1] || 'localhost'), port: Number(row) });
    fs.appendFileSync(log, JSON.stringify(target) + '\\n');
  } catch {}
  return original.apply(this, args);
};`;
const MUTATOR = `
const Module = require('module'); const fs = require('fs'); const path = require('path');
const spec = JSON.parse(fs.readFileSync(process.env.ORPHAN_ENTITY_SERVER_MUTATION, 'utf8'));
const target = path.resolve(spec.file);
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (path.resolve(filename) !== target) return original(module, filename);
  const source = fs.readFileSync(filename, 'utf8').replace(/\\r\\n/g, '\\n');
  const count = source.split(spec.from).length - 1;
  if (count !== 1) { console.error('MUTATION ANCHOR FOUND ' + count + ' TIMES in ' + filename); process.exit(97); }
  module._compile(source.replace(spec.from, spec.to), filename);
};`;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
function tail(text, lines = 4) { return String(text || '').trim().split(/\r?\n/).slice(-lines).join(' | '); }

async function startServer(label, { config = {}, prepare = null } = {}) {
  /* A CLOSED loopback port for local embeddings, so the one search check 14 makes to prove
     the recorder live takes its plain-text fallback and writes nothing. Not port 9, which is
     on fetch's blocked list and would never open a socket for the recorder to see. */
  const embedPort = await freePort();
  const workspace = disposableRoot(`orphan-entity-${label}`, { config: { ollamaUrl: `http://127.0.0.1:${embedPort}`, ...config } });
  if (prepare) prepare(workspace);
  const connections = path.join(workspace.home, 'connections.jsonl');
  fs.writeFileSync(connections, '');
  fs.writeFileSync(path.join(workspace.home, 'record-connections.js'), RECORDER);
  const nodePath = (file) => file.split(path.sep).join('/');
  const preload = [`--require "${nodePath(path.join(workspace.home, 'record-connections.js'))}"`];
  if (MUTATION) {
    fs.writeFileSync(path.join(workspace.home, 'apply-mutation.js'), MUTATOR);
    preload.push(`--require "${nodePath(path.join(workspace.home, 'apply-mutation.js'))}"`);
  }
  const port = await freePort();
  let log = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_ROOT,
    env: workspace.serverEnv(port, { NODE_OPTIONS: preload.join(' '), ORPHAN_ENTITY_CONNECTIONS: connections, ORPHAN_ENTITY_SERVER_MUTATION: MUTATION }),
    windowsHide: true,
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const server = { label, workspace, port, embedPort, child, connections, base: `http://127.0.0.1:${port}`, exit: null, log: () => log };
  child.on('exit', (code, signal) => { server.exit = { code, signal }; });
  for (let i = 0; i < 160 && !server.exit; i += 1) {
    try { if ((await fetch(`${server.base}/api/config`)).ok) return server; } catch {}
    await sleep(250);
  }
  throw new Error(`the ${label} server never answered${server.exit ? ` — it exited (${JSON.stringify(server.exit)}): ${tail(log)}` : ''}`);
}
async function stopServer(server) {
  if (!server) return;
  if (!server.exit) { server.child.kill(); for (let i = 0; i < 40 && !server.exit; i += 1) await sleep(100); }
  try { server.workspace.cleanup(); } catch {}
}
function assertAlive(server, when) {
  assert.ok(!server.exit, `the server process EXITED ${when} (${JSON.stringify(server.exit)}): ${tail(server.log())}`);
}

async function call(server, route) {
  const init = { method: route.method, headers: {} };
  if (route.bytes) { init.body = route.bytes; init.headers['Content-Type'] = 'application/octet-stream'; }
  else if (route.json) { init.body = JSON.stringify(route.json); init.headers['Content-Type'] = 'application/json'; }
  try {
    const response = await fetch(server.base + route.url, init);
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { route: `${route.method} ${route.url}`, status: response.status, text, json };
  } catch (error) {
    await sleep(300);
    return { route: `${route.method} ${route.url}`, status: 0, text: '', json: null, failure: String(error && (error.cause && error.cause.code || error.message)) };
  }
}

function snapshot(roots) {
  const out = {};
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { out[full + path.sep] = 'dir'; walk(full); }
      else if (entry.isFile()) out[full] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  for (const root of roots) walk(root);
  return out;
}
function snapshotDiff(before, after) {
  const changed = [];
  for (const file of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (before[file] !== after[file]) changed.push(`${before[file] ? (after[file] ? 'changed' : 'removed') : 'created'} ${file}`);
  return changed;
}

/* A refusal is a sentence. Nothing a filesystem, a parser or a runtime said on the way. A
   placeholder name counts as a leak unless the caller named it in the request itself. */
function leaks(text, server, route) {
  const found = [];
  const patterns = [
    [/[A-Za-z]:[\\/]/, 'a Windows drive path'],
    [/(^|[\s"'(])\/(Users|home|tmp|var|private|mnt)\//, 'a POSIX absolute path'],
    [/project\.json/i, 'the project file name'],
    [/\bENOENT\b|\bEACCES\b|\bEPERM\b|no such file or directory/i, 'a filesystem error'],
    [/\n\s+at\s|\bat [\w.<>]+ \(/, 'a stack trace'],
    [/SyntaxError|TypeError|ReferenceError|Unexpected token/, 'an exception message'],
    [/api[_-]?key|secret|password|bearer|sk-[A-Za-z0-9]/i, 'something secret-shaped'],
  ];
  if (!route.url.includes('_none')) patterns.push([/_none/, 'the placeholder project directory']);
  for (const [pattern, label] of patterns) if (pattern.test(text)) found.push(label);
  for (const local of [server.workspace.home, server.workspace.projectsRoot, SERVER_ROOT])
    if (local && text.toLowerCase().includes(String(local).toLowerCase().replace(/\\/g, '\\\\'))) found.push('a local directory');
  return found;
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
/* Every media route that resolves its project the same way, called the way a stale tab or a
   script would call it: naming no project. Every route answers a refusal through the one
   mediaOwnerRefusal() — blocking and use-reference included, whose own catch-alls used to
   answer every failure 400 — so an ownership refusal is the no-project 404 everywhere.
   `use-reference` resolves its source first, and with no project there is none, so it is
   refused (400, "missing") before it ever asks for a project — held here only to prove it
   still writes nothing. */
const MEDIA_ROUTES = [
  ...['anchors', 'plates', 'props', 'vehicles', 'audio', 'media'].map((type) =>
    ({ method: 'POST', url: `/api/media/upload?type=${type}&name=orphan-${type}.png`, bytes: PNG, status: 404, guarded: true })),
  { method: 'POST', url: '/api/shots/SC-ORPHAN-01/take?name=orphan-take.png', bytes: PNG, status: 404, guarded: true },
  { method: 'POST', url: '/api/shots/SC-ORPHAN-01/blocking?name=orphan-blocking.png', bytes: PNG, status: 404, guarded: true },
  { method: 'POST', url: '/api/shots/SC-ORPHAN-01/folder', status: 404, guarded: true },
  { method: 'POST', url: '/api/media/prepare-identity', json: { dir: 'anchors', name: 'orphan-anchors.png' }, status: 404, guarded: true },
  { method: 'POST', url: '/api/media/rename', json: { dir: 'anchors', from: 'orphan-anchors.png', to: 'renamed.png' }, status: 404, guarded: true },
  { method: 'POST', url: '/api/shots/SC-ORPHAN-01/use-reference', json: { url: '/assets/anchors/orphan-anchors.png' }, status: 400, guarded: false },
];
/* The routes an entity record itself is saved through, and the enrollment route that binds
   a reference to one. These already refused on 12a338d; they are held here so they stay so. */
const RECORD_ROUTES = [
  { method: 'PUT', url: '/api/project', json: { meta: { title: 'Orphan' }, characters: [{ id: 'CHAR-ORPHAN', name: 'Orphan' }] } },
  { method: 'PUT', url: '/api/projects/orphan-film/project', json: { meta: { title: 'Orphan' }, characters: [{ id: 'CHAR-ORPHAN', name: 'Orphan' }] } },
  { method: 'PUT', url: '/api/projects/_none/project', json: { meta: { title: 'Orphan' }, characters: [{ id: 'CHAR-ORPHAN', name: 'Orphan' }] } },
  { method: 'POST', url: '/api/projects/orphan-film/canon-transition', json: { successor: { meta: { title: 'Orphan' } } } },
  { method: 'POST', url: '/api/references/enroll', json: { projectSlug: '', list: 'characters', id: 'CHAR-ORPHAN' } },
];

const state = {};

check('7. with no project open, every media route refuses — 404, nothing created, no placeholder project — and the process survives', async () => {
  state.first = await startServer('first');
  state.roots = [state.first.workspace.projectsRoot, state.first.workspace.configPath, path.join(SERVER_ROOT, 'data'), path.join(SERVER_ROOT, 'projects')];
  state.before = snapshot(state.roots);
  state.refusals = [];
  const accepted = [];
  for (const route of MEDIA_ROUTES) {
    const before = snapshot([state.first.workspace.projectsRoot]);
    const answer = await call(state.first, route);
    assertAlive(state.first, `on ${answer.route}`);
    const created = snapshotDiff(before, snapshot([state.first.workspace.projectsRoot]));
    state.refusals.push({ answer, route });
    if (answer.status < 400 || created.length) accepted.push(`${answer.route} → ${answer.status} ${answer.text.slice(0, 80)}${created.length ? ` and ${created.join(', ')}` : ''}`);
  }
  assert.deepStrictEqual(accepted, [],
    'with no project open a media write must be REFUSED and create nothing — the shipped server wrote into <projects root>/_none and answered {ok:true}');
  assert.ok(!fs.existsSync(path.join(state.first.workspace.projectsRoot, '_none')), 'no placeholder project directory may exist');
  for (const { answer, route } of state.refusals) {
    assert.strictEqual(answer.status, route.status,
      `${answer.route} must refuse with its own status ${route.status} (the no-project 404 wherever the route answers through mediaOwnerStatus), got ${answer.status}`);
    if (route.guarded)
      assert.ok(answer.json && /no project is open/i.test(answer.json.error) && /open or create a project/i.test(answer.json.error)
        && answer.json.code === 'NO_ACTIVE_PROJECT',
        `${answer.route} must say what is wrong and what to do, with the NO_ACTIVE_PROJECT code, got ${answer.text.slice(0, 160)}`);
  }
  note(`7. ${MEDIA_ROUTES.length} media routes with no project: ${state.refusals.map(({ answer }) => answer.status).join('/')} — ` +
    `"${state.refusals[0].answer.json && state.refusals[0].answer.json.error}"; nothing created, no _none; alive`);
});

check('8. the refusals say nothing they should not — no path, exception text, stack or secret', async () => {
  assert.ok(state.refusals && state.refusals.length, 'check 7 did not obtain responses to inspect');
  const leaking = [];
  for (const { answer, route } of state.refusals) {
    const found = leaks(answer.text, state.first, route);
    if (found.length) leaking.push(`${answer.route}: ${found.join(', ')} — ${answer.text.slice(0, 140)}`);
  }
  assert.deepStrictEqual(leaking, [], 'a no-project refusal must leak nothing');
  note(`8. ${state.refusals.length} refusal bodies inspected: no path, exception, stack, secret or placeholder name`);
});

check('9. the routes an entity record is saved through refuse with no project, write nothing, and leak nothing', async () => {
  const server = state.first;
  const before = snapshot(state.roots);
  const rows = [];
  for (const route of RECORD_ROUTES) {
    const answer = await call(server, route);
    assertAlive(server, `on ${answer.route}`);
    rows.push({ answer, route });
  }
  const accepted = rows.filter(({ answer }) => !(answer.status >= 400 && answer.status < 500));
  assert.deepStrictEqual(accepted.map(({ answer }) => `${answer.route} → ${answer.status} ${answer.text.slice(0, 80)}`), [],
    'every entity-record save with no project open must be refused with a 4xx');
  assert.deepStrictEqual(snapshotDiff(before, snapshot(state.roots)), [], 'and nothing may be written by any of them');
  const leaking = rows.map(({ answer, route }) => [answer.route, leaks(answer.text, server, route)]).filter(([, found]) => found.length);
  assert.deepStrictEqual(leaking, [], 'and no refusal may leak');
  note(`9. ${rows.map(({ answer }) => `${answer.route.replace(/^(\w+) /, '$1 ')} ${answer.status}`).join('; ')}`);
});

check('10. repeated and concurrent refusals are side-effect free, and the same process keeps serving', async () => {
  const server = state.first;
  const pid = server.child.pid;
  const sequential = [];
  for (let round = 0; round < 2; round += 1) for (const route of [...MEDIA_ROUTES, ...RECORD_ROUTES]) sequential.push(await call(server, route));
  const concurrent = await Promise.all(Array.from({ length: 24 }, (_, i) => call(server, MEDIA_ROUTES[i % MEDIA_ROUTES.length])));
  assertAlive(server, 'during repeated refusals');
  const wrong = [...sequential, ...concurrent].filter((row) => !(row.status >= 400 && row.status < 500));
  assert.deepStrictEqual(wrong.map((row) => `${row.route} → ${row.status || row.failure}`), [], 'every repetition is the same refusal');
  assert.deepStrictEqual(snapshotDiff(state.before, snapshot(state.roots)), [],
    'the isolated projects root and settings, and the repository\'s data/ and projects/, must be byte-identical after every refusal');
  const project = await fetch(`${server.base}/api/project`);
  assert.strictEqual(project.status, 404, 'GET /api/project still answers the ordinary no-project 404');
  const settings = await fetch(`${server.base}/api/config`);
  assert.ok(settings.ok, 'and Settings still answers');
  assert.strictEqual(server.child.pid, pid, 'from the SAME process');
  note(`10. ${sequential.length} sequential + ${concurrent.length} concurrent refusals; ${Object.keys(state.before).length} paths byte-identical; pid ${pid} serving`);
});

check('11. with a project open, the same routes still write into THAT project, and nowhere else', async () => {
  const server = state.first;
  server.workspace.installSample('cinebraid-sample');
  const switched = await fetch(`${server.base}/api/projects/switch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'cinebraid-sample' }),
  });
  assert.ok(switched.ok, `opening the sample must succeed, got ${switched.status}`);
  const project = path.join(server.workspace.projectsRoot, 'cinebraid-sample');
  const before = snapshot([server.workspace.projectsRoot]);
  const unnamed = await call(server, { method: 'POST', url: '/api/media/upload?type=anchors&name=open-project-anchor.png', bytes: PNG });
  const named = await call(server, { method: 'POST', url: '/api/media/upload?type=audio&name=open-project-audio.png&slug=cinebraid-sample', bytes: PNG });
  const folder = await call(server, { method: 'POST', url: '/api/shots/SC-ORPHAN-OPEN/folder' });
  assertAlive(server, 'on writes into an open project');
  for (const answer of [unnamed, named, folder])
    assert.ok(answer.status === 200 && answer.json && answer.json.ok === true, `${answer.route} must succeed with a project open, got ${answer.status} ${answer.text.slice(0, 120)}`);
  const created = snapshotDiff(before, snapshot([server.workspace.projectsRoot])).sort();
  const expected = [
    `created ${path.join(project, 'anchors', unnamed.json.name)}`,
    `created ${path.join(project, 'audio', named.json.name)}`,
    `created ${path.join(project, 'shots', 'SC-ORPHAN-OPEN') + path.sep}`,
    `created ${path.join(project, 'shots', 'SC-ORPHAN-OPEN', 'locked') + path.sep}`,
    `created ${path.join(project, 'shots', 'SC-ORPHAN-OPEN', 'takes') + path.sep}`,
  ].sort();
  /* Two further writes are the ordinary consequence of those, and are named rather than
     waved through: the folder an upload makes when the project has none of that type yet,
     and the project's MediaAsset ledger, which indexes a new file. Nothing else, and
     nothing outside the open project. */
  const explained = (row) => [path.join(project, 'anchors'), path.join(project, 'audio')].some((dir) => row === `created ${dir}${path.sep}`)
    || /^(created|changed) /.test(row) && row.endsWith(` ${path.join(project, 'media-assets.json')}`);
  const unexpected = created.filter((row) => !expected.includes(row) && !explained(row));
  for (const row of expected) assert.ok(created.includes(row), `expected ${row}; the writes were: ${created.join(' | ')}`);
  assert.deepStrictEqual(unexpected, [], `nothing else may be written, and nothing outside the open project; all writes: ${created.join(' | ')}`);
  assert.ok(!fs.existsSync(path.join(server.workspace.projectsRoot, '_none')), 'and still no placeholder project');
  note(`11. with cinebraid-sample open: anchors/${unnamed.json.name}, audio/${named.json.name} and the shot folder land in that project and nowhere else`);
});

/* ---------------------------------------------------------------- THE PROJECT THAT CANNOT BE OPENED.
   A second install whose active project's record is not JSON — exactly what Recovery mode
   protects. It already holds media, so rename, prepare-identity and use-reference have a
   real source to act on and would write if they were let through. */
const DAMAGED = 'damaged-film';
const DAMAGED_MEDIA = [
  ...['anchors', 'plates', 'props', 'vehicles', 'audio', 'media'].map((type) =>
    ({ method: 'POST', url: `/api/media/upload?type=${type}&name=damaged-${type}.png`, bytes: PNG })),
  { method: 'POST', url: '/api/shots/SC-DAMAGED-01/take?name=damaged-take.png', bytes: PNG },
  { method: 'POST', url: '/api/shots/SC-DAMAGED-01/blocking?name=damaged-blocking.png', bytes: PNG },
  { method: 'POST', url: '/api/shots/SC-DAMAGED-01/folder' },
  { method: 'POST', url: '/api/media/prepare-identity', json: { dir: 'anchors', name: 'existing.png' } },
  { method: 'POST', url: '/api/media/rename', json: { dir: 'anchors', from: 'existing.png', to: 'renamed.png' } },
  { method: 'POST', url: '/api/shots/SC-DAMAGED-01/use-reference', json: { url: '/assets/anchors/existing.png' } },
];
/* The same writes, naming the damaged project explicitly — the boundary is the project, not
   whether the caller said which one. */
const DAMAGED_NAMED = DAMAGED_MEDIA.map((route) => route.json
  ? { ...route, json: { ...route.json, projectSlug: DAMAGED } }
  : { ...route, url: `${route.url}${route.url.includes('?') ? '&' : '?'}slug=${DAMAGED}` });

check('12. a project whose record cannot be read is never written into by any media route — PROJECT_UNREADABLE, byte-identical', async () => {
  state.damaged = await startServer('damaged', {
    config: { activeProject: DAMAGED },
    prepare: (workspace) => {
      const dir = path.join(workspace.projectsRoot, DAMAGED);
      fs.mkdirSync(path.join(dir, 'anchors'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'project.json'), '{ "meta": { "title": "Damaged" }, "shots": [', 'utf8');
      fs.writeFileSync(path.join(dir, 'anchors', 'existing.png'), PNG);
    },
  });
  const server = state.damaged;
  state.damagedBefore = snapshot([server.workspace.projectsRoot]);
  state.damagedRefusals = [];
  for (const route of [...DAMAGED_MEDIA, ...DAMAGED_NAMED]) {
    const answer = await call(server, route);
    assertAlive(server, `on ${answer.route}`);
    state.damagedRefusals.push({ answer, route });
  }
  /* THE FILE SYSTEM FIRST: a write into the damaged project is the defect, whatever was answered. */
  const changed = snapshotDiff(state.damagedBefore, snapshot([server.workspace.projectsRoot]));
  assert.deepStrictEqual(changed, [],
    'the damaged project directory changed — a media route wrote into a project CineBraid cannot open, which is exactly what Recovery mode promises never happens');
  const wrong = state.damagedRefusals.filter(({ answer }) => !(answer.status === 422 && answer.json && answer.json.code === 'PROJECT_UNREADABLE'
    && /cannot be read/.test(answer.json.error) && /recover it or open another project/.test(answer.json.error)));
  assert.deepStrictEqual(wrong.map(({ answer }) => `${answer.route} → ${answer.status} ${answer.text.slice(0, 100)}`), [],
    'every media write into the unreadable project must be refused 422 PROJECT_UNREADABLE — the status and code POST /api/search already uses for it');
  note(`12. ${state.damagedRefusals.length} media writes into an unreadable project (${DAMAGED_MEDIA.length} naming no project, ${DAMAGED_NAMED.length} naming it): all 422 PROJECT_UNREADABLE; its folder byte-identical`);
});

check('13. unreadable-project refusals leak nothing, repeat and overlap without side effects, and the server keeps serving', async () => {
  const server = state.damaged;
  assert.ok(server && state.damagedRefusals && state.damagedRefusals.length, 'check 12 did not obtain responses to inspect');
  const leaking = state.damagedRefusals.map(({ answer, route }) => [answer.route, leaks(answer.text, server, route)]).filter(([, found]) => found.length);
  assert.deepStrictEqual(leaking, [], 'an unreadable-project refusal must leak no path, parser message, stack or secret');
  const pid = server.child.pid;
  const all = [...DAMAGED_MEDIA, ...DAMAGED_NAMED];
  const sequential = [];
  for (let round = 0; round < 2; round += 1) for (const route of all) sequential.push(await call(server, route));
  const concurrent = await Promise.all(Array.from({ length: 24 }, (_, i) => call(server, all[i % all.length])));
  assertAlive(server, 'during repeated unreadable-project refusals');
  const changed = snapshotDiff(state.damagedBefore, snapshot([server.workspace.projectsRoot]));
  assert.deepStrictEqual(changed, [], 'the damaged project directory changed during repeated or concurrent refusals');
  const wrong = [...sequential, ...concurrent].filter((row) => !(row.status === 422 && row.json && row.json.code === 'PROJECT_UNREADABLE'));
  assert.deepStrictEqual(wrong.map((row) => `${row.route} → ${row.status || row.failure}`), [], 'every repetition is the same refusal');
  const project = await fetch(`${server.base}/api/project`);
  assert.strictEqual(project.status, 422, 'GET /api/project still refuses to open the damaged project, unchanged');
  const settings = await fetch(`${server.base}/api/config`);
  assert.ok(settings.ok, 'and Settings still answers');
  assert.strictEqual(server.child.pid, pid, 'from the SAME process');
  note(`13. ${sequential.length} sequential + ${concurrent.length} concurrent unreadable-project refusals; no leak; folder byte-identical; pid ${pid} serving`);
});

check('14. the server connected to nothing but this machine', async () => {
  const server = state.first;
  /* THE RECORDER PROVES ITSELF FIRST: a search with the project open tries the local
     embedding endpoint — a closed loopback port — before its plain-text fallback. */
  const searched = await fetch(`${server.base}/api/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'parcel' }),
  });
  assert.ok(searched.ok, `the recorder's self-test search must answer, got ${searched.status}`);
  await sleep(300);
  const rows = fs.readFileSync(server.connections, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(rows.some((row) => row.host === '127.0.0.1' && row.port === server.embedPort),
    `the recorder did not see the server's own embedding attempt on 127.0.0.1:${server.embedPort}, so it is blind: ${JSON.stringify(rows)}`);
  const damaged = state.damaged && fs.existsSync(state.damaged.connections)
    ? fs.readFileSync(state.damaged.connections, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  const offsite = [...rows, ...damaged].filter((row) => !row.path && !/^(127\.\d+\.\d+\.\d+|::1|localhost)$/i.test(row.host));
  assert.deepStrictEqual(offsite, [], `the servers opened connections off this machine: ${JSON.stringify(offsite)}`);
  note(`14. ${rows.length + damaged.length} outbound connections recorded, including the self-test on 127.0.0.1:${server.embedPort}; all loopback`);
});

/* =========================================================================== */
(async () => {
  let failed = 0;
  const selected = checks.filter(([name]) => !PART || (PART === 'client') === (Number(name.split('.')[0]) <= 6));
  try {
    for (const [name, fn] of selected) {
      try { await fn(); console.log('  ok  ' + name); }
      catch (error) { failed += 1; console.error('  FAIL ' + name + '\n       ' + String(error && error.message ? error.message : error).split('\n')[0]); }
    }
  } finally {
    await stopServer(state.first);
    await stopServer(state.damaged);
  }
  console.log(notes.map((line) => '  ' + line).join('\n'));
  if (MUTATION) console.log(`  (server mutation applied in memory: ${MUTATION})`);
  if (ROOT !== REPO) console.log(`  (public/ read from ${ROOT})`);
  if (SERVER_ROOT !== REPO) console.log(`  (server run from ${SERVER_ROOT})`);
  if (PART) console.log(`  (only the ${PART} checks were run)`);
  if (failed) { console.error(`FAIL orphan entity creation refusal: ${failed} of ${selected.length} checks failed.`); process.exit(1); }
  console.log(`PASS orphan entity creation refusal: ${selected.length} checks — no record is created without a project record to hold it, no media is written to a placeholder project, and an open project works as it did.`);
})();

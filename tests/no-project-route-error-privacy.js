/* NO_PROJECT_ROUTE_ERROR_PRIVACY_V1 — two routes refuse a missing project in JSON, and a
 * synchronous route failure is answered in JSON rather than by Express's error page.
 *
 * THE DEFECTS, as measured on 89e13d8 with no project open:
 *
 *   - POST /api/test-feedback ("Leave feedback" in the rail, offered with no project)
 *     read `<projects>/_none/project.json`, caught the ENOENT itself and answered
 *     500 {error: error.message} — the absolute path of the projects root, in the toast.
 *   - GET /api/scan read the same file from a synchronous handler. Express caught the
 *     throw and, with no error handler of CineBraid's own below the routes, its default
 *     one answered 500 text/html: the stack, every frame naming the install folder.
 *
 * Both routes now ask the open gate first (projectOwnerVerdict in server.js) and refuse
 * with the repository's codes — NO_ACTIVE_PROJECT 404, PROJECT_UNREADABLE 422 — before
 * any project-owned path is resolved. And a terminal error handler
 * (routeErrorHandler, src/server/async-route-boundary.js) answers whatever a route still
 * throws synchronously the way the async boundary accepted in 89e13d8 answers a
 * rejection: logged on the server, a sentence and a code to the client.
 *
 * Every provider is off or a closed loopback port. Nothing leaves this machine (check 9
 * measures it). Every location is a disposable workspace outside the repository.
 *
 *   NO_PROJECT_ROUTE_PRIVACY_MUTATION   a JSON file {files: [{file, edits: [{from, to}]}]}:
 *                                       anchored edits applied IN MEMORY as the server
 *                                       loads each source. Used by the negative controls;
 *                                       nothing is written into any tree.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { disposableRoot } = require('./helpers/disposable-root');

const SOURCE = path.resolve(path.join(__dirname, '..'));
const MUTATION = process.env.NO_PROJECT_ROUTE_PRIVACY_MUTATION || '';
const SECRET = 'sk-route-privacy-' + crypto.randomBytes(6).toString('hex');
/* Planted in the errors the boundary child throws. Neither is a real location, and
   neither may ever reach a client. */
const PLANTED_WINDOWS = 'D:\\CineBraidPlanted\\vault\\project.json';
const PLANTED_POSIX = '/var/lib/cinebraid-planted/vault/project.json';
const PLANTED_EXCEPTION = 'PlantedRouteException';

const notes = [];
const note = (line) => notes.push(line);
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nodePath = (file) => file.split(path.sep).join('/');

/* ------------------------------------------------------------------ the server child */

/* Records every outbound TCP connection the process opens, so "only loopback" is
   measured rather than assumed. */
const RECORDER = `
const net = require('net'); const fs = require('fs');
const log = process.env.NO_PROJECT_ROUTE_PRIVACY_CONNECTIONS;
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
/* Each anchor must occur exactly once, or the run refuses loudly: a moved anchor can
   never pass for a caught defect. */
const MUTATOR = `
const Module = require('module'); const fs = require('fs'); const path = require('path');
const spec = JSON.parse(fs.readFileSync(process.env.NO_PROJECT_ROUTE_PRIVACY_MUTATION, 'utf8'));
const byFile = new Map(spec.files.map((entry) => [path.resolve(entry.file), entry.edits]));
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  const edits = byFile.get(path.resolve(filename));
  if (!edits) return original(module, filename);
  let source = fs.readFileSync(filename, 'utf8').replace(/\\r\\n/g, '\\n');
  for (const edit of edits) {
    const count = source.split(edit.from).length - 1;
    if (count !== 1) { console.error('MUTATION ANCHOR FOUND ' + count + ' TIMES in ' + filename); process.exit(97); }
    source = source.replace(edit.from, () => edit.to);
  }
  module._compile(source, filename);
};`;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

function tail(text, lines = 4) {
  return String(text || '').trim().split(/\r?\n/).slice(-lines).join(' | ');
}

function preloadFor(home) {
  fs.writeFileSync(path.join(home, 'record-connections.js'), RECORDER);
  const preload = [`--require "${nodePath(path.join(home, 'record-connections.js'))}"`];
  if (MUTATION) {
    fs.writeFileSync(path.join(home, 'apply-mutation.js'), MUTATOR);
    preload.push(`--require "${nodePath(path.join(home, 'apply-mutation.js'))}"`);
  }
  return preload.join(' ');
}

async function startServer(label, { config = {}, prepare = null } = {}) {
  const workspace = disposableRoot(`route-privacy-${label}`, { config });
  if (prepare) await prepare(workspace);
  const connections = path.join(workspace.home, 'connections.jsonl');
  fs.writeFileSync(connections, '');
  const port = await freePort();
  let log = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SOURCE,
    env: workspace.serverEnv(port, {
      NODE_OPTIONS: preloadFor(workspace.home),
      NO_PROJECT_ROUTE_PRIVACY_CONNECTIONS: connections,
      NO_PROJECT_ROUTE_PRIVACY_MUTATION: MUTATION,
    }),
    windowsHide: true,
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const server = { label, workspace, port, child, connections, base: `http://127.0.0.1:${port}`, exit: null, log: () => log };
  child.on('exit', (code, signal) => { server.exit = { code, signal }; });
  for (let i = 0; i < 160 && !server.exit; i += 1) {
    try { if ((await fetch(`${server.base}/api/projects`)).ok) return server; } catch {}
    await sleep(250);
  }
  throw new Error(`the ${label} server never answered${server.exit ? ` — it exited (${JSON.stringify(server.exit)}): ${tail(log)}` : ''}`);
}

async function stopServer(server) {
  if (!server) return;
  if (!server.exit) {
    server.child.kill();
    for (let i = 0; i < 40 && !server.exit; i += 1) await sleep(100);
  }
  try { server.workspace.cleanup(); } catch {}
}

const responses = [];
async function call(server, method, route, body, { raw = null } = {}) {
  try {
    const response = await fetch(`${server.base}${route}`, {
      method,
      headers: body || raw ? { 'Content-Type': 'application/json' } : {},
      body: raw !== null ? raw : body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const headers = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
    const row = { method, route, status: response.status, type: response.headers.get('content-type') || '', headers, text, json, server };
    responses.push(row);
    return row;
  } catch (error) {
    await sleep(400);
    return { method, route, status: 0, type: '', headers: '', text: '', json: null, failure: String(error && (error.cause && error.cause.code || error.message)) };
  }
}

/* Asked of the process directly, not inferred from a response. */
function assertAlive(server, when) {
  assert.ok(!server.exit,
    `the server process EXITED ${when} (${JSON.stringify(server.exit)}). Its last words: ${tail(server.log())}`);
}
async function assertAnswering(server, when) {
  assertAlive(server, when);
  const ping = await call(server, 'GET', '/api/projects');
  assert.strictEqual(ping.status, 200, `the server must keep answering ${when}, got ${ping.status || ping.failure}`);
}

/* Every file AND directory under the roots, files by content. A `_none` folder is a
   change even when it is empty. */
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

function leaks(text, server) {
  const found = [];
  const patterns = [
    [/[A-Za-z]:[\\/]{1,2}[A-Za-z]/, 'a Windows drive path'],
    [/(^|[\s"'(=])\/(Users|home|tmp|var|private|mnt|srv|opt)\//, 'a POSIX absolute path'],
    [/project\.json|_none|test-feedback\.json|server\.js|async-route-boundary/i, 'an internal file name'],
    [/\bENOENT\b|\bEACCES\b|\bEPERM\b|\bEISDIR\b|no such file or directory|operation not permitted/i, 'a filesystem error'],
    [/\n\s+at\s|\bat [\w.<>]+ \(|node_modules|<pre>|<!DOCTYPE/i, 'a stack trace or error page'],
    [/SyntaxError|TypeError|ReferenceError|Unexpected (token|end)|is not valid JSON/, 'an exception message'],
    [/x-powered-by|express/i, 'the server implementation'],
    [/bearer /i, 'an authorization header'],
  ];
  for (const [pattern, label] of patterns) if (pattern.test(text)) found.push(label);
  for (const planted of [SECRET, PLANTED_WINDOWS, PLANTED_POSIX, PLANTED_EXCEPTION])
    if (text.includes(planted)) found.push(`the planted value ${planted.slice(0, 16)}…`);
  for (const local of [server.workspace && server.workspace.home, server.workspace && server.workspace.projectsRoot, SOURCE])
    if (local && text.toLowerCase().includes(String(local).toLowerCase().replace(/\\/g, '\\\\'))) found.push('a local directory');
  return found;
}

function assertRefusal(answer, status, code, what) {
  assert.ok(!/text\/html/.test(answer.type), `${what} answered Express's HTML error page: ${answer.text.slice(0, 200)}`);
  assert.strictEqual(answer.status, status, `${what} must answer ${status} ${code}, got ${answer.status || answer.failure} ${answer.text.slice(0, 200)}`);
  assert.ok(/^application\/json/.test(answer.type), `${what} must answer JSON, got ${answer.type}`);
  assert.ok(answer.json && answer.json.code === code && typeof answer.json.error === 'string' && answer.json.error.length > 20,
    `${what} must carry code ${code} and a sentence, got ${answer.text.slice(0, 200)}`);
  assert.deepStrictEqual(Object.keys(answer.json).sort(), ['code', 'error'],
    `${what} carries a sentence and a code and nothing else, got ${Object.keys(answer.json).join(', ')}`);
}

function assertRouteFailed(answer, what, status = 500) {
  assert.ok(!/text\/html/.test(answer.type), `${what} must answer JSON, not Express's HTML error page: ${answer.text.slice(0, 200)}`);
  assert.strictEqual(answer.status, status, `${what} must fail as a controlled ${status}, got ${answer.status || answer.failure} ${answer.text.slice(0, 200)}`);
  assert.ok(/^application\/json/.test(answer.type), `${what} must answer JSON, got ${answer.type}`);
  assert.deepStrictEqual(answer.json, ROUTE_FAILURE,
    `${what} must answer the generic route failure and nothing else, got ${answer.text.slice(0, 200)}`);
}
const { ROUTE_FAILURE } = require(path.join(SOURCE, 'src', 'server', 'async-route-boundary.js'));

/* A configured media root holding a file, synced in "assisted" mode — so a scan that
   reaches scanProject() would copy it into whatever PROJECT_DIR() is. */
function plantMediaRoot(workspace) {
  const mediaRoot = path.join(workspace.home, 'incoming-media');
  fs.mkdirSync(path.join(mediaRoot, 'anchors'), { recursive: true });
  fs.writeFileSync(path.join(mediaRoot, 'anchors', 'INCOMING.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  return mediaRoot;
}
function assistedSync(workspace) {
  const file = workspace.configPath;
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  current.workspace = { ...(current.workspace || {}), syncMode: 'assisted', mediaRoot: plantMediaRoot(workspace) };
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', 'utf8');
}
/* The settings file is re-read per request, so this moves the running server's active
   project without a switch (a switch would refuse a project it would not open). */
function setActiveProject(server, slug) {
  const file = server.workspace.configPath;
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...current, activeProject: slug }, null, 2) + '\n', 'utf8');
}

/* ------------------------------------------------------------------ the contracts */

const state = {};
const FEEDBACK = { note: 'The scan button did nothing I could see.', route: '#/production' };

check('1. with no project open, both routes refuse in JSON and the server keeps answering', async () => {
  state.deadPort = await freePort();
  state.none = await startServer('none', {
    config: { ollamaUrl: `http://127.0.0.1:${state.deadPort}`, customKey: SECRET },
    prepare: (workspace) => assistedSync(workspace),
  });
  state.repoRoots = [path.join(SOURCE, 'data'), path.join(SOURCE, 'projects')];
  state.repoBefore = snapshot(state.repoRoots);
  state.noneRoots = [state.none.workspace.projectsRoot, path.join(state.none.workspace.home, 'incoming-media')];
  state.noneBefore = snapshot(state.noneRoots);
  const projects = await call(state.none, 'GET', '/api/projects');
  assert.strictEqual(projects.json.active, null, `this must be a run with no project open, but ${projects.json.active} is active`);
  const asked = [
    ['GET', '/api/scan', null],
    ['POST', '/api/test-feedback', FEEDBACK],
    ['GET', '/api/test-feedback', null],
    ['GET', '/api/test-feedback/test-note-anything/export', null],
  ];
  for (const [method, route, body] of asked) {
    const answer = await call(state.none, method, route, body);
    assertRefusal(answer, 404, 'NO_ACTIVE_PROJECT', `${method} ${route} with no project open`);
    await assertAnswering(state.none, `after ${method} ${route} with no project open`);
  }
  /* The route's existing contract for a named project that does not exist is kept. */
  const unknown = await call(state.none, 'GET', '/api/scan?project=not-a-project');
  assertRefusal(unknown, 404, 'PROJECT_NOT_FOUND', 'a scan naming a project that does not exist');
  note('1. no project: GET/POST test-feedback, its export and GET /api/scan → 404 JSON NO_ACTIVE_PROJECT; ?project=unknown keeps 404 PROJECT_NOT_FOUND; the process answers after each');
});

check('2. a refusal with no project creates, modifies and deletes nothing', async () => {
  assert.ok(state.none && state.noneBefore, 'check 1 did not record the roots');
  const changed = snapshotDiff(state.noneBefore, snapshot(state.noneRoots));
  assert.deepStrictEqual(changed, [], `a no-project refusal changed the disk: ${changed.join('; ')}`);
  assert.ok(!fs.existsSync(path.join(state.none.workspace.projectsRoot, '_none')), 'no `_none` placeholder project exists');
  assert.deepStrictEqual(fs.readdirSync(state.none.workspace.projectsRoot), [], 'the projects root is still empty');
  const repo = snapshotDiff(state.repoBefore, snapshot(state.repoRoots));
  assert.deepStrictEqual(repo, [], `the repository's data/ or projects/ changed: ${repo.join('; ')}`);
  note('2. no `_none`, no feedback file, nothing synced from the assisted media root, and data/ and projects/ in the repository untouched');
});

/* The open gate's own verdict, unnarrowed. Two damaged projects, each made active in
   turn: one whose file is not JSON, and one that parses but fails save validation (a shot
   naming no scene) — the document GET /api/project sends to Recovery, which promises to
   leave it untouched. Both routes can WRITE into the folder (the scan syncs the incoming
   media root in; a feedback save writes its note), so the disk is compared byte for byte
   BEFORE any status is asserted: a guard that lets either through is caught by what it
   wrote, not only by what it answered. */
check('3. an unreadable or Recovery project is refused where it would be written, and left byte-identical', async () => {
  state.broken = await startServer('broken', {
    config: { activeProject: 'broken', customKey: SECRET },
    prepare: (workspace) => {
      const dir = path.join(workspace.projectsRoot, 'broken');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'project.json'), '{ "title": ');
      fs.writeFileSync(path.join(dir, 'test-feedback.json'), JSON.stringify({ schemaVersion: 1, notes: [{ id: 'test-note-kept', note: 'kept' }] }));
      const recovery = path.join(workspace.projectsRoot, 'recovery');
      fs.mkdirSync(recovery, { recursive: true });
      fs.writeFileSync(path.join(recovery, 'project.json'), JSON.stringify({
        meta: { title: 'Recovery' }, characters: [], locations: [], props: [], vehicles: [], audio: [],
        scenes: [], shots: [{ id: 'S-01', scene: '', title: 'S', keyframes: [], clips: [] }],
      }));
      fs.writeFileSync(path.join(recovery, 'test-feedback.json'), JSON.stringify({ schemaVersion: 1, notes: [{ id: 'test-note-recovery', note: 'kept' }] }));
      assistedSync(workspace);
    },
  });
  const roots = [state.broken.workspace.projectsRoot, path.join(state.broken.workspace.home, 'incoming-media')];
  const before = snapshot(roots);
  const answers = {};
  const ask = async (key, method, route, body) => { answers[key] = await call(state.broken, method, route, body); await assertAnswering(state.broken, `after ${method} ${route} (${key})`); };

  /* Not JSON. */
  await ask('broken save', 'POST', '/api/test-feedback', FEEDBACK);
  await ask('broken scan', 'GET', '/api/scan');
  await ask('broken scoped scan', 'GET', '/api/scan?project=broken');
  await ask('broken read', 'GET', '/api/test-feedback');
  /* An async route failing on the same file: the 89e13d8 boundary's own 500. */
  await ask('broken async failure', 'GET', '/api/agents/status');
  /* Parses, fails validation: Recovery. */
  setActiveProject(state.broken, 'recovery');
  await ask('recovery open', 'GET', '/api/project');
  await ask('recovery scan', 'GET', '/api/scan');
  await ask('recovery save', 'POST', '/api/test-feedback', FEEDBACK);
  await ask('recovery read', 'GET', '/api/test-feedback');
  await ask('recovery scoped scan', 'GET', '/api/scan?project=recovery');

  const changed = snapshotDiff(before, snapshot(roots));
  assert.deepStrictEqual(changed, [], `a damaged or Recovery project, or the incoming media root, changed on disk: ${changed.join('; ')}`);

  assert.strictEqual(answers['recovery open'].status, 422, `the fixture must be a project the open gate sends to Recovery, got ${answers['recovery open'].status}`);
  for (const key of ['broken save', 'broken scan', 'broken scoped scan', 'recovery scan', 'recovery save', 'recovery scoped scan'])
    assertRefusal(answers[key], 422, 'PROJECT_UNREADABLE', key);
  assertRouteFailed(answers['broken async failure'], 'an async route failing on an unreadable project');
  /* Reading notes already saved needs no project.json and writes nothing: not refused. */
  assert.strictEqual(answers['broken read'].status, 200, `reading saved feedback in an unreadable project answered ${answers['broken read'].status}`);
  assert.deepStrictEqual(answers['broken read'].json.notes.map((row) => row.id), ['test-note-kept'], 'the saved notes are read as they are');
  assert.strictEqual(answers['recovery read'].status, 200, `reading saved feedback in a Recovery project answered ${answers['recovery read'].status}`);
  assert.deepStrictEqual(answers['recovery read'].json.notes.map((row) => row.id), ['test-note-recovery'], 'the Recovery project\'s notes are read as they are');
  note('3. not-JSON and Recovery (parses, fails validation; GET /api/project 422) projects: feedback save, active scan and scoped scan → 422 JSON PROJECT_UNREADABLE; saved notes still read (200); both folders and the incoming media root byte-identical');
});

check('4. an unexpected synchronous failure in a real route is generic JSON, and the server survives', async () => {
  /* The feedback file is a directory, so the save's rename throws a real EPERM/EISDIR
     naming two absolute paths — the kind of message the route used to hand back. */
  state.throwing = await startServer('throwing', {
    config: { activeProject: 'cinebraid-sample', customKey: SECRET },
    prepare: (workspace) => {
      workspace.installSample();
      fs.mkdirSync(path.join(workspace.projectsRoot, 'cinebraid-sample', 'test-feedback.json'));
    },
  });
  const save = await call(state.throwing, 'POST', '/api/test-feedback', FEEDBACK);
  assertRouteFailed(save, 'a feedback save whose write throws');
  await assertAnswering(state.throwing, 'after a route threw synchronously');
  assert.ok(/API_ROUTE_FAILED POST \/api\/test-feedback/.test(state.throwing.log()), 'the failure is logged on the server, where its detail belongs');
  note(`4. a real synchronous failure (the feedback write) → 500 JSON ROUTE_FAILED, detail only in the server log; the process answers`);
});

/* The boundary itself, in a child whose only routes are these, so "the process
   survived" is measured on a process that did nothing else. It loads the modules the
   server loads, through the same preload, so a negative control reaches it too. */
check('5. the terminal handler: sync throws answered, async contract unchanged, no second response', async () => {
  const home = state.none.workspace.home;
  const script = path.join(home, 'boundary-routes.js');
  fs.writeFileSync(script, `
const express = require(${JSON.stringify(nodePath(path.join(SOURCE, 'node_modules', 'express')))});
const { installAsyncRouteBoundary, routeErrorHandler } = require(${JSON.stringify(nodePath(path.join(SOURCE, 'src', 'server', 'async-route-boundary.js')))});
const planted = ${JSON.stringify(`${PLANTED_EXCEPTION}: ENOENT: no such file or directory, open '${PLANTED_WINDOWS}' (also ${PLANTED_POSIX}) key=${SECRET}`)};
const fail = () => { throw new Error(planted); };
const app = installAsyncRouteBoundary(express());
app.disable('x-powered-by');
app.use(express.json());
app.get('/sync-throws', () => fail());
app.post('/echo', (req, res) => res.json({ got: req.body }));
app.get('/async-rejects', async () => { await new Promise((r) => setTimeout(r, 5)); fail(); });
app.get('/sync-answered-then-throws', (req, res) => { res.json({ ok: true, from: 'the handler' }); fail(); });
app.get('/sync-started-then-throws', (req, res) => { res.status(200).type('application/json'); res.write('{"partial":true'); fail(); });
app.get('/async-answered-then-rejects', async (req, res) => { res.json({ ok: true, from: 'the handler' }); await new Promise((r) => setTimeout(r, 10)); fail(); });
app.get('/controlled', (req, res) => res.status(404).json({ error: 'No project is open.', code: 'NO_ACTIVE_PROJECT' }));
app.get('/alive', (req, res) => res.json({ alive: true }));
app.use(routeErrorHandler);
app.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('ready'));
`, 'utf8');
  const port = await freePort();
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: String(port), NODE_OPTIONS: preloadFor(home), NO_PROJECT_ROUTE_PRIVACY_CONNECTIONS: state.none.connections, NO_PROJECT_ROUTE_PRIVACY_MUTATION: MUTATION },
    windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const routes = { label: 'boundary', exit: null, log: () => log, workspace: state.none.workspace, base: `http://127.0.0.1:${port}` };
  child.on('exit', (code, signal) => { routes.exit = { code, signal }; });
  state.routes = routes;
  try {
    for (let i = 0; i < 80 && !routes.exit; i += 1) {
      try { if ((await fetch(`${routes.base}/alive`)).ok) break; } catch {}
      await sleep(100);
    }
    assert.ok(!routes.exit, `the boundary routes never started (${JSON.stringify(routes.exit)}): ${tail(log)}`);

    assertRouteFailed(await call(routes, 'GET', '/sync-throws'), 'a synchronous throw');
    assertRouteFailed(await call(routes, 'GET', '/async-rejects'), 'an async rejection (the 89e13d8 contract)');
    /* A request the client got wrong keeps its status; the body is still generic. */
    assertRouteFailed(await call(routes, 'POST', '/echo', null, { raw: '{"note": ' }), 'a request body that is not JSON', 400);
    const echo = await call(routes, 'POST', '/echo', { note: 'fine' });
    assert.deepStrictEqual(echo.json, { got: { note: 'fine' } }, 'a well-formed body still reaches its route');
    assert.deepStrictEqual((await call(routes, 'GET', '/controlled')).json, { error: 'No project is open.', code: 'NO_ACTIVE_PROJECT' },
      'a refusal a route writes itself is not touched');

    for (const route of ['/sync-answered-then-throws', '/async-answered-then-rejects']) {
      const answered = await call(routes, 'GET', route);
      await sleep(250);
      assert.ok(!routes.exit, `the process EXITED after ${route} (${JSON.stringify(routes.exit)}): ${tail(log)}`);
      assert.strictEqual(answered.status, 200, `${route} keeps its own status, got ${answered.status}`);
      assert.strictEqual(answered.text, '{"ok":true,"from":"the handler"}', `a second response was appended by ${route}: ${answered.text.slice(0, 240)}`);
    }
    let startedText = '';
    try { startedText = await (await fetch(`${routes.base}/sync-started-then-throws`)).text(); }
    catch (error) { startedText = `(the connection ended: ${String(error && (error.cause?.code || error.message))})`; }
    await sleep(250);
    assert.ok(!routes.exit, `the process EXITED after a synchronous throw in a half-written response (${JSON.stringify(routes.exit)}): ${tail(log)}`);
    assert.ok(!/ROUTE_FAILED/.test(startedText), `a JSON failure was written into a body already in flight: ${startedText.slice(0, 240)}`);
    const found = leaks(startedText, routes);
    assert.deepStrictEqual(found, [], `the half-written body leaks ${found.join(', ')}: ${startedText.slice(0, 240)}`);

    const alive = await fetch(`${routes.base}/alive`);
    assert.strictEqual(alive.status, 200, `the process must still answer afterwards, got ${alive.status}`);
    assert.ok(log.includes(PLANTED_EXCEPTION), 'the detail is logged on the server, where it belongs');
    note(`5. sync throw → 500 ROUTE_FAILED; async rejection → the same 500 as 89e13d8; a body that is not JSON → 400 generic JSON; answered-then-throw keeps its answer; half-written ends as ${JSON.stringify(startedText.slice(0, 30))}; the process answers`);
  } finally {
    child.kill();
    for (let i = 0; i < 40 && !routes.exit; i += 1) await sleep(50);
  }
});

check('6. with a valid project open, both routes behave exactly as before', async () => {
  state.valid = await startServer('valid', {
    config: { activeProject: 'cinebraid-sample', customKey: SECRET },
    prepare: (workspace) => workspace.installSample(),
  });
  const dir = path.join(state.valid.workspace.projectsRoot, 'cinebraid-sample');
  const projectBefore = fs.readFileSync(path.join(dir, 'project.json'));
  const empty = await call(state.valid, 'GET', '/api/test-feedback');
  assert.deepStrictEqual([empty.status, empty.json], [200, { notes: [] }], `feedback read answered ${empty.status} ${empty.text.slice(0, 160)}`);
  const saved = await call(state.valid, 'POST', '/api/test-feedback', FEEDBACK);
  assert.strictEqual(saved.status, 201, `a feedback save answered ${saved.status} ${saved.text.slice(0, 200)}`);
  assert.strictEqual(saved.json.record.projectSlug, 'cinebraid-sample', 'the note names the open project');
  assert.strictEqual(saved.json.record.note, FEEDBACK.note, 'the note is stored as written');
  assert.ok(saved.json.record.projectSummary.shots > 0 && /# CineBraid test note/.test(saved.json.markdown), 'the note carries its project summary and markdown');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'test-feedback.json'), 'utf8'));
  assert.deepStrictEqual(stored.notes.map((row) => row.id), [saved.json.record.id], 'the note is written into the open project');
  const listed = await call(state.valid, 'GET', '/api/test-feedback');
  assert.deepStrictEqual(listed.json.notes.map((row) => row.id), [saved.json.record.id], 'the saved note is listed');
  const exported = await call(state.valid, 'GET', `/api/test-feedback/${encodeURIComponent(saved.json.record.id)}/export?format=markdown`);
  assert.ok(exported.status === 200 && /^text\/markdown/.test(exported.type) && exported.text.includes(FEEDBACK.note), `export answered ${exported.status} ${exported.type}`);
  const missing = await call(state.valid, 'GET', '/api/test-feedback/test-note-absent/export');
  assert.deepStrictEqual([missing.status, missing.json], [404, { error: 'test note not found' }], 'an unknown note keeps its 404');
  for (const route of ['/api/scan', '/api/scan?project=cinebraid-sample']) {
    const scan = await call(state.valid, 'GET', route);
    assert.strictEqual(scan.status, 200, `GET ${route} answered ${scan.status} ${scan.text.slice(0, 200)}`);
    assert.deepStrictEqual(Object.keys(scan.json).sort(),
      ['anchors', 'audio', 'media', 'mediaInventory', 'plates', 'props', 'references', 'shots', 'vehicles', 'workspaceSync'],
      `GET ${route} keeps its shape`);
    assert.ok(scan.json.anchors.length > 0 && Object.keys(scan.json.shots).length > 0, `GET ${route} lists the sample's media`);
  }
  assert.ok(projectBefore.equals(fs.readFileSync(path.join(dir, 'project.json'))), 'neither route rewrites project.json');
  note(`6. valid project: feedback read [] → save 201 (written into the project) → listed → markdown export 200; unknown note 404; both scans 200 with the same ten keys; project.json byte-identical`);
});

check('7. an established controlled refusal is not re-answered by the terminal handler', async () => {
  const settings = state.none.workspace.configPath;
  const good = fs.readFileSync(settings);
  const hadBackup = fs.existsSync(settings + '.bak');
  const goodBackup = hadBackup ? fs.readFileSync(settings + '.bak') : null;
  const answers = [];
  try {
    fs.writeFileSync(settings, '{ "generation": ');
    fs.writeFileSync(settings + '.bak', '{');
    for (const [method, route, body] of [['GET', '/api/scan'], ['POST', '/api/test-feedback', FEEDBACK]])
      answers.push([route, await call(state.none, method, route, body)]);
  } finally {
    fs.writeFileSync(settings, good);
    if (hadBackup) fs.writeFileSync(settings + '.bak', goodBackup); else fs.rmSync(settings + '.bak', { force: true });
    fs.rmSync(settings + '.corrupt', { force: true });
  }
  for (const [route, answer] of answers) assertRefusal(answer, 503, 'CONFIG_UNREADABLE', `${route} with unreadable settings`);
  await assertAnswering(state.none, 'after the settings refusal');
  note('7. unreadable settings → both routes still 503 CONFIG_UNREADABLE from the settings middleware');
});

check('8. no response carries a path, stack, exception, credential or implementation detail', async () => {
  /* Every response the checks asked for, less the two they ask only to set up or confirm
     state: the project list, and GET /api/project, whose Recovery payload names the
     project file by design and is not a route this slice owns. */
  const inspected = responses.filter((row) => row.route !== '/api/projects' && row.route !== '/api/project');
  assert.ok(inspected.length >= 25, `too few responses to inspect (${inspected.length}); an earlier check did not run`);
  assert.ok(inspected.some((row) => row.status === 500) && inspected.some((row) => row.status === 404) && inspected.some((row) => row.status === 422),
    'the 404, 422 and 500 answers were not all inspected; an earlier check did not run');
  const bad = inspected
    .map((row) => ({ row, found: leaks(`${row.headers}\n${row.text}`, row.server) }))
    .filter(({ found }) => found.length)
    .map(({ row, found }) => `${row.method} ${row.route} ${row.status} leaks ${found.join(', ')}: ${row.text.slice(0, 200)}`);
  assert.deepStrictEqual(bad, [], bad.join('\n'));
  note(`8. ${inspected.length} responses and their headers, ${inspected.filter((row) => row.status >= 400).length} of them refusals or failures, carry none of the planted paths, exception, credential, stack or server detail`);
});

check('9. the servers connected to nothing but this machine and called no provider', async () => {
  /* The recorder proves itself first: status probes the configured, closed Ollama port. */
  await call(state.none, 'GET', '/api/agents/status');
  await sleep(200);
  const rows = [state.none, state.broken, state.throwing, state.valid].filter(Boolean)
    .flatMap((server) => fs.readFileSync(server.connections, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
  assert.ok(rows.some((row) => row.host === '127.0.0.1' && row.port === state.deadPort),
    `the recorder did not see the probe of 127.0.0.1:${state.deadPort}, so it is blind. Recorded: ${JSON.stringify(rows)}`);
  const offsite = rows.filter((row) => !row.path && !/^(127\.\d+\.\d+\.\d+|::1|localhost)$/i.test(row.host));
  assert.deepStrictEqual(offsite, [], `a server opened connections off this machine: ${JSON.stringify(offsite)}`);
  const provider = rows.filter((row) => !row.path && row.port !== state.deadPort);
  assert.deepStrictEqual(provider, [], `the routes under test opened provider connections: ${JSON.stringify(provider)}`);
  note(`9. ${rows.length} outbound connection(s), every one the recorder's own loopback self-test; the routes under test opened none`);
});

check('10. no real-server response names Express in an X-Powered-By header', async () => {
  const real = responses.filter((row) => row.server && row.server.child);
  const kinds = {
    'a successful response': real.filter((row) => row.status === 200 || row.status === 201),
    'a controlled 404 refusal': real.filter((row) => row.status === 404 && row.json && row.json.code === 'NO_ACTIVE_PROJECT'),
    'a controlled 422 refusal': real.filter((row) => row.status === 422 && row.json && row.json.code === 'PROJECT_UNREADABLE'),
    'a generic synchronous 500': real.filter((row) => row.status === 500 && row.method === 'POST' && row.route === '/api/test-feedback'),
    'a generic asynchronous 500': real.filter((row) => row.status === 500 && row.route === '/api/agents/status'),
  };
  for (const [kind, rows] of Object.entries(kinds)) {
    assert.ok(rows.length > 0, `no ${kind} was recorded; an earlier check did not run`);
    const named = rows.filter((row) => /^x-powered-by:/im.test(row.headers));
    assert.deepStrictEqual(named.map((row) => `${row.method} ${row.route} ${row.status}`), [],
      `${kind} carries an X-Powered-By header naming the server implementation`);
  }
  note(`10. X-Powered-By absent from ${Object.entries(kinds).map(([kind, rows]) => `${rows.length} × ${kind.replace(/^an? /, '')}`).join(', ')}`);
});

/* =========================================================================== */
(async () => {
  let failed = 0;
  try {
    for (const [name, fn] of checks) {
      try { await fn(); console.log('  ok  ' + name); }
      catch (error) { failed += 1; console.error('  FAIL ' + name + '\n       ' + (error && error.message ? error.message : error)); }
    }
  } finally {
    for (const server of [state.none, state.broken, state.throwing, state.valid]) await stopServer(server);
  }
  console.log(notes.map((line) => '  ' + line).join('\n'));
  if (MUTATION) console.log(`  (mutation applied in memory: ${MUTATION})`);
  if (failed) { console.error(`FAIL no-project route error privacy: ${failed} of ${checks.length} checks failed.`); process.exit(1); }
  console.log(`PASS no-project route error privacy: ${checks.length} checks — no-project and unreadable-project refusals are JSON with the repository's codes, a synchronous route failure is generic JSON, the process survives, nothing leaks and nothing is written.`);
})();

/* FIRST_RUN_SETTINGS_SERVER_SURVIVAL_V1 — a first-run Settings save must not end the server.
 *
 * THE DEFECT, as measured on a75c66d. With no project open, Settings → Generation →
 * "Save generation settings" sends PUT /api/config, which SUCCEEDS and is stored. The save
 * then refreshes readiness with GET /api/agents/status, and that route read the active
 * project unconditionally: with none, readProject() opened `<projects>/_none/project.json`,
 * threw ENOENT, and — because the handler is async and Express 4 ignores the promise a
 * handler returns — the rejection went unhandled and Node ended the process (exit 1). The
 * browser saw a reset connection and every later request was refused.
 *
 * Two things are therefore proven, one per cause:
 *
 *   - the route: agents/status answers a first run truthfully. Assistant readiness is
 *     per-user; only the index and the run history belong to a project, and with none
 *     open they are empty.
 *   - the boundary (src/server/async-route-boundary.js): whatever an async route fails
 *     on, the request fails with a controlled 500 and the process survives. Check 4
 *     fails the status route through it on purpose with an unreadable project. (An
 *     unreadable settings file never reaches a route: the settings middleware answers
 *     503 CONFIG_UNREADABLE first, and check 3 holds that contract too.)
 *
 * Every provider is a closed loopback port or a loopback fake. Nothing leaves this
 * machine (check 8 measures it). Every location is a disposable workspace outside the
 * repository.
 *
 *   FIRST_RUN_SURVIVAL_MUTATION   a JSON file {file, edits: [{from, to}]}: anchored edits
 *                                 applied to that source IN MEMORY as the server loads
 *                                 it. Used by the negative controls; nothing is written
 *                                 into any tree.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { disposableRoot } = require('./helpers/disposable-root');

const SOURCE = path.resolve(path.join(__dirname, '..'));
const MUTATION = process.env.FIRST_RUN_SURVIVAL_MUTATION || '';
const SECRET = 'sk-first-run-survival-' + crypto.randomBytes(6).toString('hex');

const notes = [];
const note = (line) => notes.push(line);
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ the server child */

/* Records every outbound TCP connection the server opens — fetch and http both end at
   net.Socket#connect — so "only loopback" is measured rather than assumed. */
const RECORDER = `
const net = require('net'); const fs = require('fs');
const log = process.env.FIRST_RUN_SURVIVAL_CONNECTIONS;
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
const spec = JSON.parse(fs.readFileSync(process.env.FIRST_RUN_SURVIVAL_MUTATION, 'utf8'));
const target = path.resolve(spec.file);
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (path.resolve(filename) !== target) return original(module, filename);
  let source = fs.readFileSync(filename, 'utf8').replace(/\\r\\n/g, '\\n');
  for (const edit of spec.edits) {
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

async function startServer(label, { config = {}, prepare = null } = {}) {
  const workspace = disposableRoot(`first-run-survival-${label}`, { config });
  if (prepare) await prepare(workspace);
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
    cwd: SOURCE,
    env: workspace.serverEnv(port, {
      NODE_OPTIONS: preload.join(' '),
      FIRST_RUN_SURVIVAL_CONNECTIONS: connections,
      FIRST_RUN_SURVIVAL_MUTATION: MUTATION,
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
async function call(server, method, route, body) {
  try {
    const response = await fetch(`${server.base}${route}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const row = { method, route, status: response.status, text, json, server };
    responses.push(row);
    return row;
  } catch (error) {
    /* A reset connection is the symptom being fixed; give the exit event time to land. */
    await sleep(400);
    return { method, route, status: 0, text: '', json: null, failure: String(error && (error.cause && error.cause.code || error.message)) };
  }
}

/* Asked of the process directly, not inferred from a response. */
function assertAlive(server, when) {
  assert.ok(!server.exit,
    `the server process EXITED ${when} (${JSON.stringify(server.exit)}) — one request ended CineBraid. ` +
    `Its last words: ${tail(server.log())}`);
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
    [/(^|[\s"'(])\/(Users|home|tmp|var|private|mnt)\//, 'a POSIX absolute path'],
    [/project\.json|_none/i, 'the project file name'],
    [/\bENOENT\b|\bEACCES\b|\bEPERM\b|no such file or directory/i, 'a filesystem error'],
    [/\n\s+at\s|\bat [\w.<>]+ \(|node_modules/, 'a stack trace'],
    [/SyntaxError|TypeError|ReferenceError|Unexpected token|is not valid JSON/, 'an exception message'],
    [/bearer /i, 'an authorization header'],
  ];
  for (const [pattern, label] of patterns) if (pattern.test(text)) found.push(label);
  if (text.includes(SECRET)) found.push('the stored credential');
  for (const local of [server.workspace.home, server.workspace.projectsRoot, SOURCE])
    if (local && text.toLowerCase().includes(String(local).toLowerCase().replace(/\\/g, '\\\\'))) found.push('a local directory');
  return found;
}

function assertControlledFailure(answer, what) {
  assert.strictEqual(answer.status, 500, `${what} must fail as a controlled 500, got ${answer.status || answer.failure} ${answer.text.slice(0, 160)}`);
  assert.ok(answer.json && answer.json.code === 'ROUTE_FAILED' && typeof answer.json.error === 'string',
    `${what} must answer JSON with code ROUTE_FAILED, got ${answer.text.slice(0, 160)}`);
  assert.deepStrictEqual(Object.keys(answer.json).sort(), ['code', 'error'],
    `${what} carries a sentence and a code and nothing else, got ${Object.keys(answer.json).join(', ')}`);
}

/* Rewrites the settings file the running server reads, keeping everything else. */
function patchSettings(server, patch) {
  const file = server.workspace.configPath;
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2) + '\n', 'utf8');
}

/* A loopback Ollama that lists the configured models. */
function fakeOllama(models) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
      res.statusCode = 404;
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* ------------------------------------------------------------------ the contracts */

const state = {};
const GENERATION_SAVE = { generation: { fal: { enabled: false, blockingOutputs: 3, frameQuality: 'medium' } } };

check('1. first-run generation settings save with no project open', async () => {
  state.deadPort = await freePort();
  state.first = await startServer('first', { config: { ollamaUrl: `http://127.0.0.1:${state.deadPort}` } });
  state.repoRoots = [path.join(SOURCE, 'data'), path.join(SOURCE, 'projects')];
  state.repoBefore = snapshot(state.repoRoots);
  state.projectsBefore = snapshot([state.first.workspace.projectsRoot]);
  const projects = await call(state.first, 'GET', '/api/projects');
  assert.strictEqual(projects.status, 200, `GET /api/projects answered ${projects.status}`);
  assert.strictEqual(projects.json.active, null, `this must be a first run with no project open, but ${projects.json.active} is active`);
  assert.deepStrictEqual(projects.json.projects, [], 'this must be a first run with no projects at all');
  const saved = await call(state.first, 'PUT', '/api/config', GENERATION_SAVE);
  assertAlive(state.first, 'on the first-run settings save');
  assert.strictEqual(saved.status, 200, `the save must succeed with no project open, got ${saved.status} ${saved.text.slice(0, 160)}`);
  assert.deepStrictEqual(saved.json, { ok: true }, `the save answers {ok:true}, got ${saved.text.slice(0, 160)}`);
  const stored = JSON.parse(fs.readFileSync(state.first.workspace.configPath, 'utf8'));
  assert.strictEqual(stored.generation.fal.blockingOutputs, 3, 'the saved blockingOutputs is in the per-user settings file');
  assert.strictEqual(stored.generation.fal.frameQuality, 'medium', 'the saved frameQuality is in the per-user settings file');
  note('1. PUT /api/config with no project open → 200 {ok:true}; the per-user settings file holds the new values');
});

check('2. the server survives the save and the status request that follows it', async () => {
  assert.ok(state.first, 'check 1 did not start a server');
  /* The exact sequence Settings runs after a successful save (public/settings.js). */
  const reread = await call(state.first, 'GET', '/api/config');
  assert.strictEqual(reread.status, 200, `the settings re-read answered ${reread.status}`);
  const status = await call(state.first, 'GET', '/api/agents/status');
  assertAlive(state.first, 'on GET /api/agents/status with no project open');
  assert.strictEqual(status.status, 200,
    `with no project open, status must answer 200 with per-user readiness, got ${status.status} ${status.text.slice(0, 160)}`);
  assert.ok(status.json.capabilities && status.json.capabilities.text, 'status reports assistant capabilities on a first run');
  assert.strictEqual(status.json.capabilities.text.ready, false, 'a closed provider port is reported as not ready');
  assert.deepStrictEqual(status.json.runs, [], 'with no project there is no run history');
  assert.strictEqual(status.json.index.ready, false, 'with no project there is no index');
  state.firstStatus = status;
  const after = await call(state.first, 'GET', '/api/projects');
  assertAlive(state.first, 'after the status request');
  assert.strictEqual(after.status, 200, `the server must still answer after the status request, got ${after.status || after.failure}`);
  note(`2. save → GET /api/config 200 → GET /api/agents/status 200 (text ready=${status.json.capabilities.text.ready}, runs=[], index.ready=false) → GET /api/projects 200; the process is alive`);
});

check('3. absent, malformed and unavailable provider or settings state is answered, never fatal', async () => {
  assert.ok(state.first, 'check 1 did not start a server');
  /* Unavailable: every provider is a closed loopback port, and one holds a credential. */
  patchSettings(state.first, {
    assistant: { provider: 'custom', visionProvider: 'ollama' },
    agents: { enabled: true },
    customBaseUrl: `http://127.0.0.1:${state.deadPort}/v1`, customModel: 'local-model', customKey: SECRET,
  });
  const unavailable = await call(state.first, 'GET', '/api/agents/status');
  assertAlive(state.first, 'with unavailable providers');
  assert.strictEqual(unavailable.status, 200, `unavailable providers are a status, not a failure; got ${unavailable.status}`);
  assert.strictEqual(unavailable.json.capabilities.text.ready, false, 'an unreachable custom provider is not ready');
  /* Malformed provider settings: addresses that are not addresses. */
  patchSettings(state.first, { customBaseUrl: 'not a url at all', ollamaUrl: 'http://[::bad' });
  const malformedProvider = await call(state.first, 'GET', '/api/agents/status');
  assertAlive(state.first, 'with malformed provider addresses');
  assert.strictEqual(malformedProvider.status, 200, `malformed provider addresses are a status, not a failure; got ${malformedProvider.status}`);
  assert.strictEqual(malformedProvider.json.capabilities.text.ready, false, 'a malformed provider is not ready');
  /* Malformed settings: the file and its backup both unreadable while the server runs.
     The settings middleware answers this before any route runs (503 CONFIG_UNREADABLE),
     and a repaired file is picked up without a restart. */
  const settings = state.first.workspace.configPath;
  const good = fs.readFileSync(settings);
  const hadBackup = fs.existsSync(settings + '.bak');
  const goodBackup = hadBackup ? fs.readFileSync(settings + '.bak') : null;
  let broken;
  try {
    fs.writeFileSync(settings, '{ "generation": ');
    fs.writeFileSync(settings + '.bak', '{');
    broken = await call(state.first, 'GET', '/api/agents/status');
    assertAlive(state.first, 'on GET /api/agents/status with unreadable settings');
  } finally {
    fs.writeFileSync(settings, good);
    if (hadBackup) fs.writeFileSync(settings + '.bak', goodBackup); else fs.rmSync(settings + '.bak', { force: true });
    fs.rmSync(settings + '.corrupt', { force: true });
  }
  assert.strictEqual(broken.status, 503, `status with unreadable settings answers the settings refusal, got ${broken.status || broken.failure} ${broken.text.slice(0, 160)}`);
  assert.strictEqual(broken.json && broken.json.code, 'CONFIG_UNREADABLE', `the refusal names the settings, got ${broken.text.slice(0, 160)}`);
  const recovered = await call(state.first, 'GET', '/api/agents/status');
  assert.strictEqual(recovered.status, 200, `once the settings are readable again status answers 200, got ${recovered.status}`);
  note('3. unavailable providers → 200 not ready; malformed provider addresses → 200 not ready; unreadable settings → 503 CONFIG_UNREADABLE, process alive, 200 again once repaired');
});

check('4. an open project that cannot be read fails the status request, not the server', async () => {
  const deadPort = await freePort();
  state.broken = await startServer('broken', {
    config: { ollamaUrl: `http://127.0.0.1:${deadPort}`, activeProject: 'broken' },
    prepare: (workspace) => {
      fs.mkdirSync(path.join(workspace.projectsRoot, 'broken'), { recursive: true });
      fs.writeFileSync(path.join(workspace.projectsRoot, 'broken', 'project.json'), '{ "title": ');
    },
  });
  const before = snapshot([state.broken.workspace.projectsRoot]);
  const status = await call(state.broken, 'GET', '/api/agents/status');
  assertAlive(state.broken, 'on GET /api/agents/status with an unreadable project');
  assertControlledFailure(status, 'status with an unreadable project');
  const after = await call(state.broken, 'GET', '/api/projects');
  assert.strictEqual(after.status, 200, `the server keeps answering after the failed request, got ${after.status || after.failure}`);
  assert.deepStrictEqual(snapshotDiff(before, snapshot([state.broken.workspace.projectsRoot])), [], 'the unreadable project is left exactly as it was');
  note('4. an unreadable project.json → GET /api/agents/status 500 ROUTE_FAILED; the process is alive and the file untouched');
});

check('5. a valid existing configuration with a project open still works', async () => {
  const ollama = await fakeOllama(['local-text-model', 'local-vision-model', 'local-embed-model']);
  state.fakes = [ollama];
  state.valid = await startServer('valid', {
    config: {
      activeProject: 'cinebraid-sample', agents: { enabled: true },
      assistant: { provider: 'ollama', visionProvider: 'same' },
      ollamaUrl: `http://127.0.0.1:${ollama.address().port}`,
      ollamaModel: 'local-text-model', ollamaVisionModel: 'local-vision-model', ollamaEmbedModel: 'local-embed-model',
    },
    prepare: (workspace) => workspace.installSample(),
  });
  const project = JSON.parse(fs.readFileSync(path.join(state.valid.workspace.projectsRoot, 'cinebraid-sample', 'project.json'), 'utf8'));
  state.validBefore = snapshot([state.valid.workspace.projectsRoot]);
  const status = await call(state.valid, 'GET', '/api/agents/status');
  assert.strictEqual(status.status, 200, `status with a valid configuration answered ${status.status}`);
  assert.strictEqual(status.json.capabilities.text.ready, true, 'a reachable provider with the configured model is ready');
  assert.strictEqual(status.json.manualMode, false, 'with a ready text provider CineBraid is not in manual mode');
  assert.strictEqual(status.json.runs.length, Math.min(40, (project.agentRuns || []).length), 'the open project\'s run history is reported');
  assert.ok(status.json.index && typeof status.json.index.ready === 'boolean', 'the open project\'s index state is reported');
  const saved = await call(state.valid, 'PUT', '/api/config', GENERATION_SAVE);
  assert.strictEqual(saved.status, 200, `the save with a project open answered ${saved.status}`);
  const again = await call(state.valid, 'GET', '/api/agents/status');
  assert.strictEqual(again.status, 200, `status after a save with a project open answered ${again.status}`);
  assertAlive(state.valid, 'with a valid configuration');
  note(`5. with the sample open and a loopback Ollama: status 200, text ready, ${status.json.runs.length} runs reported; save 200; status 200 again`);
});

check('6. no project file or project directory is created or modified', async () => {
  assert.ok(state.first && state.projectsBefore, 'check 1 did not record the projects root');
  const created = snapshotDiff(state.projectsBefore, snapshot([state.first.workspace.projectsRoot]));
  assert.deepStrictEqual(created, [], `the first-run flow wrote into the projects root: ${created.join('; ')}`);
  assert.ok(!fs.existsSync(path.join(state.first.workspace.projectsRoot, '_none')), 'no `_none` placeholder project exists');
  if (state.valid) {
    const changed = snapshotDiff(state.validBefore, snapshot([state.valid.workspace.projectsRoot]));
    assert.deepStrictEqual(changed, [], `status and settings saves changed the open project: ${changed.join('; ')}`);
  }
  const repo = snapshotDiff(state.repoBefore, snapshot(state.repoRoots));
  assert.deepStrictEqual(repo, [], `the repository's data/ or projects/ changed: ${repo.join('; ')}`);
  note('6. the first-run projects root is still empty (no `_none`), the open sample is byte-identical, and data/ and projects/ in the repository are untouched');
});

check('7. no secret, absolute path or stack trace reaches the client', async () => {
  const inspected = responses.filter((row) => row.route === '/api/agents/status' || row.method === 'PUT');
  assert.ok(inspected.length >= 8, `too few responses to inspect (${inspected.length}); an earlier check did not run`);
  assert.ok(inspected.some((row) => row.status === 500), 'no failure response was inspected; checks 3 and 4 did not run');
  const bad = inspected
    .map((row) => ({ row, found: leaks(row.text, row.server) }))
    .filter(({ found }) => found.length)
    .map(({ row, found }) => `${row.method} ${row.route} ${row.status} leaks ${found.join(', ')}: ${row.text.slice(0, 200)}`);
  assert.deepStrictEqual(bad, [], bad.join('\n'));
  note(`7. ${inspected.length} status and save responses, including ${inspected.filter((row) => row.status === 500).length} failures, carry no path, exception, stack or credential`);
});

check('8. the servers connected to nothing but this machine', async () => {
  const rows = [state.first, state.broken, state.valid].filter(Boolean)
    .flatMap((server) => fs.readFileSync(server.connections, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
  /* The recorder proves itself: the first server probed its closed Ollama port. */
  assert.ok(rows.some((row) => row.host === '127.0.0.1' && row.port === state.deadPort),
    `the recorder did not see the probe of 127.0.0.1:${state.deadPort}, so it is blind. Recorded: ${JSON.stringify(rows)}`);
  const offsite = rows.filter((row) => !row.path && !/^(127\.\d+\.\d+\.\d+|::1|localhost)$/i.test(row.host));
  assert.deepStrictEqual(offsite, [], `the server opened connections off this machine: ${JSON.stringify(offsite)}`);
  note(`8. ${rows.length} outbound connections recorded, every one loopback`);
});

/* A rejection that arrives AFTER the answer has started. The boundary cannot send a
   second response to a request that already has one: an answered request must keep the
   handler's own answer, a half-written one must simply be closed, and neither may be
   followed by a JSON 500 — which would corrupt the body and, on an already-ended
   response, throw inside the rejection handler and end the process after all.

   Run in a child whose only routes are these, so "the process survived" is measured on
   a process that did nothing else. Loaded through the same preload as the server child,
   so a negative control can reach the boundary here too. */
check('9. a rejection after the response has started adds nothing and kills nothing', async () => {
  const home = state.first.workspace.home;
  const script = path.join(home, 'late-rejection-routes.js');
  const nodePath = (file) => file.split(path.sep).join('/');
  fs.writeFileSync(script, `
const express = require(${JSON.stringify(nodePath(path.join(SOURCE, 'node_modules', 'express')))});
const { installAsyncRouteBoundary } = require(${JSON.stringify(nodePath(path.join(SOURCE, 'src', 'server', 'async-route-boundary.js')))});
/* Shaped like the real one: an ENOENT naming an absolute path, with a stack. */
const fail = () => { throw new Error("ENOENT: no such file or directory, open '" + ${JSON.stringify(path.join(home, 'secret', 'project.json'))} + "' " + ${JSON.stringify(SECRET)}); };
const app = installAsyncRouteBoundary(express());
app.get('/answered-then-rejects', async (req, res) => { res.json({ ok: true, from: 'the handler' }); await new Promise((r) => setTimeout(r, 10)); fail(); });
app.get('/started-then-rejects', async (req, res) => {
  res.status(200).type('application/json');
  res.write('{"partial":true');
  await new Promise((r) => setTimeout(r, 10));
  fail();
});
app.get('/alive', (req, res) => res.json({ alive: true }));
app.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('ready'));
`, 'utf8');
  const port = await freePort();
  const preload = [`--require "${nodePath(path.join(home, 'record-connections.js'))}"`];
  if (MUTATION) preload.push(`--require "${nodePath(path.join(home, 'apply-mutation.js'))}"`);
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: String(port), NODE_OPTIONS: preload.join(' '), FIRST_RUN_SURVIVAL_CONNECTIONS: state.first.connections, FIRST_RUN_SURVIVAL_MUTATION: MUTATION },
    windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const routes = { exit: null, log: () => log, workspace: state.first.workspace };
  child.on('exit', (code, signal) => { routes.exit = { code, signal }; });
  try {
    for (let i = 0; i < 80 && !routes.exit; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/alive`)).ok) break; } catch {}
      await sleep(100);
    }
    assert.ok(!routes.exit, `the late-rejection routes never started (${JSON.stringify(routes.exit)}): ${tail(log)}`);

    /* Already answered: the handler's answer stands, alone. */
    const answered = await fetch(`http://127.0.0.1:${port}/answered-then-rejects`);
    const answeredText = await answered.text();
    await sleep(300);
    assert.ok(!routes.exit, `the process EXITED after a rejection that followed a completed response (${JSON.stringify(routes.exit)}): ${tail(log)}`);
    assert.strictEqual(answered.status, 200, `the completed answer keeps its own status, got ${answered.status}`);
    assert.strictEqual(answeredText, '{"ok":true,"from":"the handler"}',
      `a second response was appended to an answered request: ${answeredText.slice(0, 240)}`);

    /* Half-written: closed where it stopped, with nothing added. */
    let startedText = '';
    try {
      const started = await fetch(`http://127.0.0.1:${port}/started-then-rejects`);
      startedText = await started.text();
    } catch (error) { startedText = `(the connection ended: ${String(error && (error.cause?.code || error.message))})`; }
    await sleep(300);
    assert.ok(!routes.exit, `the process EXITED after a rejection that followed a half-written response (${JSON.stringify(routes.exit)}): ${tail(log)}`);
    assert.ok(!/ROUTE_FAILED/.test(startedText), `a JSON 500 was written into a body already in flight: ${startedText.slice(0, 240)}`);
    for (const text of [answeredText, startedText]) {
      const found = leaks(text, routes);
      assert.deepStrictEqual(found, [], `a late-rejection body leaks ${found.join(', ')}: ${text.slice(0, 240)}`);
    }

    const alive = await fetch(`http://127.0.0.1:${port}/alive`);
    assert.strictEqual(alive.status, 200, `the process must still answer after both late rejections, got ${alive.status}`);
    note(`9. answered-then-rejects keeps "${answeredText}"; started-then-rejects ends as ${JSON.stringify(startedText.slice(0, 40))} with no 500 appended; the process answers afterwards`);
  } finally {
    child.kill();
    for (let i = 0; i < 40 && !routes.exit; i += 1) await sleep(50);
  }
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
    for (const server of [state.first, state.broken, state.valid]) await stopServer(server);
    for (const fake of state.fakes || []) fake.close();
  }
  console.log(notes.map((line) => '  ' + line).join('\n'));
  if (MUTATION) console.log(`  (mutation applied in memory: ${MUTATION})`);
  if (failed) { console.error(`FAIL first-run settings server survival: ${failed} of ${checks.length} checks failed.`); process.exit(1); }
  console.log(`PASS first-run settings server survival: ${checks.length} checks — the first-run save is stored, status answers with no project, failures are controlled 500s, the process survives, nothing leaks and nothing is written.`);
})();

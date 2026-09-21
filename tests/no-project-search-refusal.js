/* NO_PROJECT_SHELL_TRUTH_V1 (C3) — A SEARCH WITH NO PROJECT IS REFUSED, AND NOTHING DIES.
 *
 * MEASURED ON 3b20a4f, 2026-09-20: `POST /api/search` with no active project read
 * `<projects root>/_none/project.json` inside an async express handler. The file does not
 * exist, readJsonSync threw ENOENT, express does not catch a rejected async handler, and
 * the unhandled rejection ENDED THE SERVER PROCESS (exit code 1). One request stopped
 * CineBraid. The shell no longer sends it (public/app.js, public/review.js); this suite is
 * about the server's own defence, which must hold whatever calls it.
 *
 * Everything here is a real server child on loopback, in a disposable workspace
 * (tests/helpers/disposable-root.js: every provider off, every credential blanked):
 *
 *   1  the request is refused — 404, code NO_ACTIVE_PROJECT — and the process survives
 *   2  the refusal says nothing it should not: no path, no exception text, no stack, no secret
 *   3  the same process then answers its status, Settings and project-list routes
 *   4  repeated refusals, sequential and concurrent, write nothing anywhere
 *   5  a project that is open but cannot be read is refused too (422 PROJECT_UNREADABLE)
 *   6  once a project is open, ordinary search returns the four "parcel" results
 *   7  the server made no connection to anything but this machine
 *
 * TWO KNOBS, for the companion negative controls and for the pristine reproduction:
 *   NO_PROJECT_SEARCH_SOURCE_ROOT  run the server from another tree (3b20a4f, to reproduce)
 *   NO_PROJECT_SEARCH_MUTATION     a JSON file {file, from, to}: one anchored edit applied to
 *                                  that source IN MEMORY as the server loads it. Nothing is
 *                                  written into any tree.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { disposableRoot } = require('./helpers/disposable-root');

const SOURCE = path.resolve(process.env.NO_PROJECT_SEARCH_SOURCE_ROOT || path.join(__dirname, '..'));
const MUTATION = process.env.NO_PROJECT_SEARCH_MUTATION || '';

const notes = [];
const note = (line) => notes.push(line);
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ the server child */

/* Written into the disposable home, never into a tree. The first records every outbound
   TCP connection the server process opens — node's fetch and http both end at
   net.Socket#connect — so "only loopback" is measured, not assumed. The second applies
   one anchored edit to one source file as node loads it, and refuses loudly if the
   anchor is not there exactly once, so a moved anchor can never pass for a caught defect. */
const RECORDER = `
const net = require('net'); const fs = require('fs');
const log = process.env.NO_PROJECT_SEARCH_CONNECTIONS;
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
const spec = JSON.parse(fs.readFileSync(process.env.NO_PROJECT_SEARCH_MUTATION, 'utf8'));
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

async function startServer(label, config = {}, prepare = null) {
  /* The embedding endpoint is a CLOSED loopback port, so a search that reaches the
     semantic path takes its plain-text fallback deterministically and can never write
     data/embeddings.json into the tree. Not port 9: that is on fetch's blocked-port list,
     so no socket would ever be opened and check 7 would have nothing to prove its
     recorder works with. A free port nothing listens on is refused by the OS instead. */
  const embedPort = await freePort();
  const workspace = disposableRoot(`no-project-search-${label}`, {
    config: { ollamaUrl: `http://127.0.0.1:${embedPort}`, ...config },
  });
  if (prepare) prepare(workspace);
  const connections = path.join(workspace.home, 'connections.jsonl');
  fs.writeFileSync(connections, '');
  fs.writeFileSync(path.join(workspace.home, 'record-connections.js'), RECORDER);
  /* NODE_OPTIONS reads a backslash inside quotes as an escape, so a quoted Windows path
     must use forward slashes — which node accepts, and which still survive a space. */
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
      NO_PROJECT_SEARCH_CONNECTIONS: connections,
      NO_PROJECT_SEARCH_MUTATION: MUTATION,
    }),
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

function tail(text, lines = 4) {
  return String(text || '').trim().split(/\r?\n/).slice(-lines).join(' | ');
}

async function stopServer(server) {
  if (!server) return;
  if (!server.exit) {
    server.child.kill();
    for (let i = 0; i < 40 && !server.exit; i += 1) await sleep(100);
  }
  try { server.workspace.cleanup(); } catch {}
}

async function search(server, body) {
  try {
    const response = await fetch(`${server.base}/api/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: response.status, text, json };
  } catch (error) {
    await sleep(300);
    return { status: 0, text: '', json: null, failure: String(error && (error.cause && error.cause.code || error.message)) };
  }
}

/* The process is the thing that must survive. Asked directly, not inferred from a
   response, so a restarted or dying process cannot read as a healthy one. */
function assertAlive(server, when) {
  assert.ok(!server.exit,
    `the server process EXITED ${when} (${JSON.stringify(server.exit)}) — one request ended CineBraid. ` +
    `Its last words: ${tail(server.log())}`);
}

/* Every file under the given roots, by content. Byte-identical means byte-identical. */
function snapshot(roots) {
  const out = {};
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
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

/* A refusal body must be a sentence and a code — nothing a filesystem, a parser or a
   runtime said on the way. */
function leaks(text, server) {
  const found = [];
  const patterns = [
    [/[A-Za-z]:[\\/]/, 'a Windows drive path'],
    [/(^|[\s"'(])\/(Users|home|tmp|var|private|mnt)\//, 'a POSIX absolute path'],
    [/project\.json|_none/i, 'the project file name'],
    [/\bENOENT\b|\bEACCES\b|\bEPERM\b|no such file or directory/i, 'a filesystem error'],
    [/\n\s+at\s|\bat [\w.<>]+ \(/, 'a stack trace'],
    [/SyntaxError|TypeError|ReferenceError|Unexpected token/, 'an exception message'],
    [/api[_-]?key|secret|password|bearer|sk-[A-Za-z0-9]/i, 'something secret-shaped'],
  ];
  for (const [pattern, label] of patterns) if (pattern.test(text)) found.push(label);
  for (const local of [server.workspace.home, server.workspace.projectsRoot, SOURCE])
    if (local && text.toLowerCase().includes(String(local).toLowerCase().replace(/\\/g, '\\\\'))) found.push('a local directory');
  return found;
}

/* ------------------------------------------------------------------ the contracts */

const state = {};

check('1. a search with no project open is refused — 404 NO_ACTIVE_PROJECT — and the process survives', async () => {
  state.first = await startServer('first');
  state.repoRoots = [path.join(SOURCE, 'data'), path.join(SOURCE, 'projects')];
  state.isolated = [state.first.workspace.configPath, state.first.workspace.projectsRoot];
  state.before = snapshot([...state.repoRoots, ...state.isolated]);
  state.embeddingsBefore = fs.existsSync(path.join(SOURCE, 'data', 'embeddings.json'));
  const answer = await search(state.first, { q: 'courier' });
  state.refusal = answer;
  assertAlive(state.first, 'on a no-project search');
  assert.ok(answer.status >= 400,
    `a no-project search must be REFUSED, but it answered ${answer.status} ${answer.text.slice(0, 160)} — ` +
    'a success with no project behind it is a false result');
  assert.strictEqual(answer.status, 404, `the refusal uses the repository's no-project status (GET /api/project answers 404), got ${answer.status}`);
  assert.ok(answer.json, `the refusal must be JSON, got ${answer.text.slice(0, 160)}`);
  assert.strictEqual(answer.json.code, 'NO_ACTIVE_PROJECT', `the machine-readable code must be NO_ACTIVE_PROJECT, got ${answer.json.code}`);
  assert.ok(typeof answer.json.error === 'string' && /no project is open/i.test(answer.json.error) && /create a project/i.test(answer.json.error),
    `the message must tell a filmmaker what is wrong and what to do, got ${JSON.stringify(answer.json.error)}`);
  note(`1. POST /api/search with no project → ${answer.status} ${answer.json.code}: "${answer.json.error}"`);
});

check('2. the refusal says nothing it should not — no path, exception text, stack or secret', async () => {
  const answer = state.refusal;
  assert.ok(answer && answer.status, 'check 1 did not obtain a response to inspect');
  const found = leaks(answer.text, state.first);
  assert.deepStrictEqual(found, [], `the refusal body leaks ${found.join(', ')}: ${answer.text.slice(0, 240)}`);
  assert.deepStrictEqual(Object.keys(answer.json || {}).sort(), ['code', 'error'],
    `the refusal carries a sentence and a code and nothing else, got ${Object.keys(answer.json || {}).join(', ')}`);
  note(`2. the body is exactly {error, code}; no path, exception, stack or secret in ${answer.text.length} bytes`);
});

check('3. the same process still answers its status, Settings and project-list routes', async () => {
  const server = state.first;
  assertAlive(server, 'after the refusal');
  const pid = server.child.pid;
  const status = await fetch(`${server.base}/api/project`);
  const statusBody = await status.json();
  assert.strictEqual(status.status, 404, 'GET /api/project still answers the ordinary no-project 404');
  assert.strictEqual(statusBody.error, 'No active project.', 'and says so in its own words');
  const settings = await fetch(`${server.base}/api/config`);
  const config = await settings.json();
  assert.ok(settings.ok && config && typeof config === 'object' && !Array.isArray(config), 'GET /api/config (Settings) still answers');
  const listing = await fetch(`${server.base}/api/projects`);
  const projects = await listing.json();
  assert.ok(listing.ok && Array.isArray(projects.projects), 'GET /api/projects (the write-free project list the welcome screen reads) still answers');
  assertAlive(server, 'after the follow-up requests');
  assert.strictEqual(server.child.pid, pid, 'and it is the SAME process — nothing restarted it');
  note(`3. pid ${pid} answered /api/project 404, /api/config 200 and /api/projects 200 after the refusal`);
});

check('4. repeated refusals, one after another and all at once, write nothing anywhere', async () => {
  const server = state.first;
  const bodies = [{ q: 'courier' }, { q: 'parcel' }, { q: '' }, { q: '   ' }, {}, { q: 'x'.repeat(2000) }, { q: 'LOC-PLATFORM' }];
  const sequential = [];
  for (let round = 0; round < 2; round += 1)
    for (const body of bodies) sequential.push(await search(server, body));
  const concurrent = await Promise.all(Array.from({ length: 10 }, (_, i) => search(server, bodies[i % bodies.length])));
  assertAlive(server, 'during repeated no-project searches');
  const all = [...sequential, ...concurrent];
  const wrong = all.filter((row) => row.status !== 404 || !row.json || row.json.code !== 'NO_ACTIVE_PROJECT');
  assert.deepStrictEqual(wrong.map((row) => `${row.status} ${row.text.slice(0, 80)}`), [],
    'every no-project search — including an empty query — is the same refusal');
  const after = snapshot([...state.repoRoots, ...state.isolated]);
  const changed = snapshotDiff(state.before, after);
  assert.deepStrictEqual(changed, [],
    'data/, projects/, the isolated settings file and the isolated projects root must be byte-identical after refused searches');
  assert.strictEqual(fs.existsSync(path.join(SOURCE, 'data', 'embeddings.json')), state.embeddingsBefore,
    'no embedding cache may be created by a refused search');
  note(`4. ${all.length} refusals (${sequential.length} sequential, ${concurrent.length} concurrent): ${Object.keys(after).length} files byte-identical, no embeddings written`);
});

check('5. a project that is open but cannot be read is refused too — 422 PROJECT_UNREADABLE — and nothing dies', async () => {
  /* The broken record exists BEFORE the server starts, as it would for a person whose
     project file was damaged between sessions. */
  const broken = await startServer('unreadable', { activeProject: 'broken-record' }, (workspace) => {
    const dir = path.join(workspace.projectsRoot, 'broken-record');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.json'), '{ "meta": { "title": "Broken" }, "shots": [', 'utf8');
  });
  try {
    const before = snapshot([broken.workspace.projectsRoot, broken.workspace.configPath]);
    const answer = await search(broken, { q: 'courier' });
    assertAlive(broken, 'on a search of an unreadable project');
    assert.strictEqual(answer.status, 422, `an unreadable open project must be refused with 422, got ${answer.status} ${answer.text.slice(0, 160)}`);
    assert.strictEqual(answer.json && answer.json.code, 'PROJECT_UNREADABLE', `code must be PROJECT_UNREADABLE, got ${answer.text.slice(0, 160)}`);
    const found = leaks(answer.text, broken);
    assert.deepStrictEqual(found, [], `the refusal leaks ${found.join(', ')}: ${answer.text.slice(0, 200)}`);
    assert.deepStrictEqual(snapshotDiff(before, snapshot([broken.workspace.projectsRoot, broken.workspace.configPath])), [],
      'the unreadable project is left exactly as it was');
    const settings = await fetch(`${broken.base}/api/config`);
    assert.ok(settings.ok, 'and the same server still answers Settings');
    note(`5. an unreadable open project → ${answer.status} ${answer.json.code}; the file untouched; the server alive`);
  } finally {
    state.brokenLog = fs.existsSync(broken.connections) ? fs.readFileSync(broken.connections, 'utf8') : '';
    await stopServer(broken);
  }
});

check('6. once a project is open, ordinary search returns the four "parcel" results', async () => {
  const server = state.first;
  assertAlive(server, 'before a project was opened');
  server.workspace.installSample('cinebraid-sample');
  const switched = await fetch(`${server.base}/api/projects/switch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'cinebraid-sample' }),
  });
  assert.ok(switched.ok, `opening the sample must succeed, got ${switched.status}`);
  const answer = await search(server, { q: 'parcel' });
  assertAlive(server, 'on an ordinary search');
  assert.strictEqual(answer.status, 200, `ordinary search must answer 200, got ${answer.status} ${answer.text.slice(0, 160)}`);
  assert.ok(answer.json && Array.isArray(answer.json.results), 'with a result list');
  assert.strictEqual(answer.json.results.length, 4,
    `"parcel" must return the sample's four results, got ${answer.json.results.length}: ${answer.json.results.map((r) => r.id).join(', ')}`);
  for (const row of answer.json.results)
    assert.ok(row.type && row.id && row.title, `every result names a record, got ${JSON.stringify(row).slice(0, 120)}`);
  const empty = await search(server, { q: '' });
  assert.deepStrictEqual(empty.json, { mode: 'none', results: [] }, 'an empty query with a project open is still the empty answer it always was');
  note(`6. with the sample open: "parcel" → ${answer.json.results.length} results (${answer.json.mode}): ${answer.json.results.map((r) => r.id).join(', ')}`);
});

check('7. the server connected to nothing but this machine', async () => {
  const rows = [state.first && state.first.connections]
    .filter((file) => file && fs.existsSync(file))
    .flatMap((file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
  const extra = state.brokenLog ? state.brokenLog.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  /* THE RECORDER PROVES ITSELF FIRST. Check 6's search tried the embedding endpoint — a
     closed loopback port — before falling back to text. If that attempt is missing from
     the log the recorder is blind, and an empty log would prove nothing about the network. */
  assert.ok(rows.some((row) => row.host === '127.0.0.1' && row.port === state.first.embedPort),
    `the recorder did not see the server's own embedding attempt on 127.0.0.1:${state.first.embedPort}, so it is blind ` +
    `and "no offsite connection" would be vacuous. Recorded: ${JSON.stringify(rows)}`);
  const offsite = [...rows, ...extra].filter((row) => !row.path && !/^(127\.\d+\.\d+\.\d+|::1|localhost)$/i.test(row.host));
  assert.deepStrictEqual(offsite, [], `the server opened connections off this machine: ${JSON.stringify(offsite)}`);
  note(`7. ${rows.length + extra.length} outbound connections recorded in the server process — including its own embedding ` +
    `attempt on 127.0.0.1:${state.first.embedPort}, so the recorder is live — every one loopback or a local pipe`);
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
    await stopServer(state.first);
  }
  console.log(notes.map((line) => '  ' + line).join('\n'));
  if (MUTATION) console.log(`  (mutation applied in memory: ${MUTATION})`);
  if (SOURCE !== path.resolve(path.join(__dirname, '..'))) console.log(`  (server run from ${SOURCE})`);
  if (failed) { console.error(`FAIL no-project search refusal: ${failed} of ${checks.length} checks failed.`); process.exit(1); }
  console.log(`PASS no-project search refusal: ${checks.length} checks — refused with 404 NO_ACTIVE_PROJECT, nothing leaked, nothing written, nothing died, and search still works with a project.`);
})();

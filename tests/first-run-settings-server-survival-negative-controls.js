/* NEGATIVE CONTROLS for tests/first-run-settings-server-survival.js.
 *
 * Each control takes away one piece of the repair and requires the check that OWNS that
 * contract to fail — by number AND by the words of the assertion that fired, so a control
 * can never pass because something unrelated went red.
 *
 * NOTHING IS WRITTEN INTO THE REPOSITORY. The edits are applied IN MEMORY, to the server
 * child only, as node loads the source (see the suite's FIRST_RUN_SURVIVAL_MUTATION
 * preload). Both files are hashed before and after every control.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'first-run-settings-server-survival.js');
const SERVER = path.join(ROOT, 'src', 'server', 'server.js');
const BOUNDARY = path.join(ROOT, 'src', 'server', 'async-route-boundary.js');
const digest = () => [SERVER, BOUNDARY].map((file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')).join(':');
const DIGEST = digest();

const notes = [];
let failures = 0;

/* The two seams, exactly as they ship. */
const BOUNDARY_INSTALLED = 'const app = installAsyncRouteBoundary(express());\n';
const BOUNDARY_ABSENT = 'const app = express();\n';
const NO_PROJECT_READ = '  const slug = activeSlug();\n  const P = slug ? readProject(slug) : null;\n';
/* The line a75c66d had: read the active project whether or not there is one. With none,
   readProject() falls back to <projects>/_none/project.json. */
const PRISTINE_READ = '  const P = readProject();\n';
const BOUNDARY_ANSWER = '  res.status(500).json(ROUTE_FAILURE);\n';
const HEADERS_SENT_GUARD = '  if (res.headersSent) {\n    if (!res.writableEnded) res.end();\n    return;\n  }\n';

function run(file, edits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-first-run-survival-nc-'));
  try {
    const env = { ...process.env };
    if (edits) {
      const spec = path.join(dir, 'mutation.json');
      fs.writeFileSync(spec, JSON.stringify({ file, edits }));
      env.FIRST_RUN_SURVIVAL_MUTATION = spec;
    } else {
      delete env.FIRST_RUN_SURVIVAL_MUTATION;
    }
    const result = spawnSync(process.execPath, [SUITE], { env, encoding: 'utf8', timeout: 240000 });
    const output = String(result.stdout || '') + String(result.stderr || '');
    const failed = {};
    for (const m of output.matchAll(/^ {2}FAIL (\d+)\.[^\n]*\n\s+([^\n]*)/gm)) failed[Number(m[1])] = m[2];
    return { code: result.status, failed, output };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function control(label, expectedCheck, expectedWords, file, edits) {
  try {
    const { code, failed, output } = run(file, edits);
    assert.ok(!/MUTATION ANCHOR FOUND/.test(output),
      `${label}: an anchor is not in ${path.basename(file)} exactly once — the control has drifted off the seam it breaks`);
    assert.notStrictEqual(code, 0, `${label}: the suite accepted the broken server.\n${output.slice(-900)}`);
    assert.ok(Object.prototype.hasOwnProperty.call(failed, expectedCheck),
      `${label}: expected check ${expectedCheck} to fail; the suite failed ${JSON.stringify(Object.keys(failed))} instead.\n${output.slice(-900)}`);
    assert.ok(failed[expectedCheck].includes(expectedWords),
      `${label}: check ${expectedCheck} failed, but not at the assertion that owns this contract. ` +
      `Expected "${expectedWords}", got: ${failed[expectedCheck].slice(0, 300)}`);
    notes.push(`  ${label}\n      check ${expectedCheck}: ${failed[expectedCheck].slice(0, 170)}`);
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message}`);
  }
}

/* The harness itself: an unmutated server must pass, or every red below is the harness. */
(function unmutatedPasses() {
  const { code, output } = run(null, null);
  try {
    assert.strictEqual(code, 0, `N0: the unmutated suite must pass, or the controls prove nothing.\n${output.slice(-1200)}`);
    console.log('  ok  N0 the unmutated server passes');
    notes.push('  N0 an unmutated server passes, so a red control is the mutation and not the harness');
  } catch (error) { failures += 1; console.error(`  FAIL N0\n       ${error.message}`); }
})();

control('NC1 the a75c66d crash restored — no boundary, and status reads a project that does not exist', 2,
  'the server process EXITED on GET /api/agents/status with no project open',
  SERVER, [{ from: BOUNDARY_INSTALLED, to: BOUNDARY_ABSENT }, { from: NO_PROJECT_READ, to: PRISTINE_READ }]);

control('NC2 the route repair alone removed — the boundary survives it, but a first run gets a failure', 2,
  'with no project open, status must answer 200 with per-user readiness, got 500',
  SERVER, [{ from: NO_PROJECT_READ, to: PRISTINE_READ }]);

control('NC3 the boundary alone removed — an unreadable project ends the server again', 4,
  'the server process EXITED on GET /api/agents/status with an unreadable project',
  SERVER, [{ from: BOUNDARY_INSTALLED, to: BOUNDARY_ABSENT }]);

control('NC4 the boundary answers with the error it caught — path and exception reach the client', 4,
  'status with an unreadable project carries a sentence and a code and nothing else',
  BOUNDARY, [{ from: BOUNDARY_ANSWER, to: '  res.status(500).json({ ...ROUTE_FAILURE, detail: String(error && error.stack) });\n' }]);

control('NC5 the boundary answers a request that already has an answer', 9,
  'the process EXITED after a rejection that followed a completed response',
  BOUNDARY, [{ from: HEADERS_SENT_GUARD, to: '' }]);

/* The controls patched memory, never the files. Proven, not asserted in prose. */
try {
  assert.strictEqual(digest(), DIGEST, 'server.js or async-route-boundary.js changed on disk during the controls — they must patch in memory only');
  notes.push('  src/server/server.js and src/server/async-route-boundary.js are byte-identical before and after every control');
} catch (error) { failures += 1; console.error(`  FAIL ${error.message}`); }

console.log(notes.join('\n'));
if (failures) { console.error(`FAIL first-run settings server survival negative controls: ${failures} failed.`); process.exit(1); }
console.log('PASS first-run settings server survival negative controls: the original crash, the route repair, the boundary, its silence and its restraint after a response has started are each caught by the check that owns them.');

/* NEGATIVE CONTROLS for tests/no-project-route-error-privacy.js.
 *
 * Each control takes away one piece of the repair and requires the check that OWNS that
 * contract to fail — by number AND by the words of the assertion that fired, so a control
 * can never pass because something unrelated went red.
 *
 * NOTHING IS WRITTEN INTO THE REPOSITORY. The edits are applied IN MEMORY, to the server
 * children only, as node loads the source (see the suite's
 * NO_PROJECT_ROUTE_PRIVACY_MUTATION preload). Every file a control edits is hashed
 * before and after.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'no-project-route-error-privacy.js');
const SERVER = path.join(ROOT, 'src', 'server', 'server.js');
const RUNS = path.join(ROOT, 'src', 'automation', 'automation-runs.js');
const digest = () => [SERVER, RUNS].map((file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')).join(':');
const DIGEST = digest();

const notes = [];
let failures = 0;

/* The seams, exactly as they ship. */
const SCAN_GUARD = '  const owner = projectOwnerVerdict(scope || activeSlug() || "");\n';
const FEEDBACK_GUARD = '    const owner = typeof projectOwnerVerdict === "function" ? projectOwnerVerdict() : { ok: true };\n';
const NO_OWNER_CHECK = (indent) => `${indent}const owner = { ok: true };\n`;
const TERMINAL_HANDLER = 'app.use(routeErrorHandler);\n';
const FEEDBACK_CATCH = '      next(error);\n';
/* The catch 89e13d8 had: the exception's own message, path and all, as the answer. */
const PRISTINE_CATCH = '      res.status(500).json({ error: error.message || "Could not save test note." });\n';

const withoutScanGuard = { file: SERVER, edits: [{ from: SCAN_GUARD, to: NO_OWNER_CHECK('  ') }] };
const withoutFeedbackGuard = { file: RUNS, edits: [{ from: FEEDBACK_GUARD, to: NO_OWNER_CHECK('    ') }] };
const withoutTerminalHandler = { file: SERVER, edits: [{ from: TERMINAL_HANDLER, to: '' }] };
const withPristineCatch = { file: RUNS, edits: [{ from: FEEDBACK_CATCH, to: PRISTINE_CATCH }] };
/* The open gate's verdict, narrowed to "it parses": a Recovery project passes. */
const OPEN_GATE = '  if (inspected.ok) return { ok: true, slug: inspected.slug };\n';
const withParseOnlyGate = { file: SERVER, edits: [{ from: OPEN_GATE, to: '  if (inspected.ok || inspected.reason === "invalid-structure") return { ok: true, slug: inspected.slug };\n' }] };
const withPoweredByHeader = { file: SERVER, edits: [{ from: 'app.disable("x-powered-by");\n', to: '' }] };

function run(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-route-privacy-nc-'));
  try {
    const env = { ...process.env };
    if (files) {
      /* Two edits to one file are one entry, or the second would replace the first. */
      const merged = new Map();
      for (const entry of files) merged.set(entry.file, [...(merged.get(entry.file) || []), ...entry.edits]);
      const spec = path.join(dir, 'mutation.json');
      fs.writeFileSync(spec, JSON.stringify({ files: [...merged].map(([file, edits]) => ({ file, edits })) }));
      env.NO_PROJECT_ROUTE_PRIVACY_MUTATION = spec;
    } else {
      delete env.NO_PROJECT_ROUTE_PRIVACY_MUTATION;
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

function control(label, expectedCheck, expectedWords, files) {
  try {
    const { code, failed, output } = run(files);
    assert.ok(!/MUTATION ANCHOR FOUND/.test(output),
      `${label}: an anchor is not in its file exactly once — the control has drifted off the seam it breaks`);
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
  const { code, output } = run(null);
  try {
    assert.strictEqual(code, 0, `N0: the unmutated suite must pass, or the controls prove nothing.\n${output.slice(-1200)}`);
    console.log('  ok  N0 the unmutated server passes');
    notes.push('  N0 an unmutated server passes, so a red control is the mutation and not the harness');
  } catch (error) { failures += 1; console.error(`  FAIL N0\n       ${error.message}`); }
})();

control('NC1 the 89e13d8 leak restored — no guards, no terminal handler, the old catch', 1,
  "GET /api/scan with no project open answered Express's HTML error page",
  [withoutScanGuard, withoutFeedbackGuard, withoutTerminalHandler, withPristineCatch]);

control('NC2 the scan guard alone removed — the terminal handler hides the leak, but a no-project scan is a failure', 1,
  'GET /api/scan with no project open must answer 404 NO_ACTIVE_PROJECT, got 500',
  [withoutScanGuard]);

control('NC3 the feedback guard alone removed — saving with no project reads `_none` and fails', 1,
  'POST /api/test-feedback with no project open must answer 404 NO_ACTIVE_PROJECT, got 500',
  [withoutFeedbackGuard]);

control('NC4 the terminal handler unmounted — a synchronous route failure is Express\'s HTML page again', 4,
  "a feedback save whose write throws must answer JSON, not Express's HTML error page",
  [withoutTerminalHandler]);

control('NC5 the feedback catch answers with the exception again — its path reaches the client', 4,
  'a feedback save whose write throws must answer the generic route failure and nothing else',
  [withPristineCatch]);

control('NC6 the semantic-validity guard alone weakened — a Recovery project is written into', 3,
  'a damaged or Recovery project, or the incoming media root, changed on disk',
  [withParseOnlyGate]);

control('NC7 the X-Powered-By header restored', 10,
  'carries an X-Powered-By header naming the server implementation',
  [withPoweredByHeader]);

/* The controls patched memory, never the files. Proven, not asserted in prose. */
try {
  assert.strictEqual(digest(), DIGEST, 'server.js or automation-runs.js changed on disk during the controls — they must patch in memory only');
  notes.push('  src/server/server.js and src/automation/automation-runs.js are byte-identical before and after every control');
} catch (error) { failures += 1; console.error(`  FAIL ${error.message}`); }

console.log(notes.join('\n'));
if (failures) { console.error(`FAIL no-project route error privacy negative controls: ${failures} failed.`); process.exit(1); }
console.log('PASS no-project route error privacy negative controls: the 89e13d8 leak, each no-project guard, the terminal handler, the feedback catch, the open gate\'s semantic validity and the header are each caught by the check that owns them.');

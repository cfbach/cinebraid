/* NEGATIVE CONTROLS for tests/no-project-search-refusal.js (NO_PROJECT_SHELL_TRUTH_V1, C3).
 *
 * Each control rebuilds one way the server-side search refusal could be lost, and requires
 * the check that OWNS that contract to fail — by number AND by the words of the assertion
 * that fired, so a control can never pass because something unrelated went red, and a
 * moved anchor can never pass for a caught defect.
 *
 * NOTHING IS WRITTEN INTO THE REPOSITORY. The edit is applied IN MEMORY, to the server
 * child only, as node loads src/server/server.js (see the suite's NO_PROJECT_SEARCH_MUTATION
 * preload). The file on disk is read and compared before and after every control.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'no-project-search-refusal.js');
const SERVER = path.join(ROOT, 'src', 'server', 'server.js');
const digest = () => crypto.createHash('sha256').update(fs.readFileSync(SERVER)).digest('hex');
const SERVER_DIGEST = digest();

const notes = [];
let failures = 0;

/* The C3 region of the handler, exactly as it ships. Every anchor below is a piece of it. */
const GUARD =
  '  if (!activeSlug() || !fs.existsSync(DATA()))\n' +
  '    return res.status(404).json({\n' +
  '      error: "No project is open, so there is nothing to search. Create a project or open an existing one first.",\n' +
  '      code: "NO_ACTIVE_PROJECT",\n' +
  '    });\n';
const REFUSAL_RETURN =
  '    return res.status(404).json({\n' +
  '      error: "No project is open, so there is nothing to search. Create a project or open an existing one first.",\n' +
  '      code: "NO_ACTIVE_PROJECT",\n' +
  '    });\n';
const MESSAGE_LINE =
  '      error: "No project is open, so there is nothing to search. Create a project or open an existing one first.",\n';
const UNREADABLE_GUARD =
  '  let P, docs;\n' +
  '  try {\n' +
  '    P = readJsonSync(DATA());\n' +
  '    docs = searchCorpus(P);\n' +
  '  } catch {\n' +
  '    return res.status(422).json({\n' +
  '      error: "The open project could not be read, so it cannot be searched. Nothing was changed.",\n' +
  '      code: "PROJECT_UNREADABLE",\n' +
  '    });\n' +
  '  }\n';
const PRISTINE_READ = '  const P = readJsonSync(DATA());\n  const docs = searchCorpus(P);\n';

function run(mutation) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-no-project-search-nc-'));
  try {
    const env = { ...process.env };
    if (mutation) {
      const spec = path.join(dir, 'mutation.json');
      fs.writeFileSync(spec, JSON.stringify({ file: SERVER, ...mutation }));
      env.NO_PROJECT_SEARCH_MUTATION = spec;
    } else {
      delete env.NO_PROJECT_SEARCH_MUTATION;
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

function control(label, expectedCheck, expectedWords, mutation) {
  try {
    const { code, failed, output } = run(mutation);
    assert.ok(!/MUTATION ANCHOR FOUND/.test(output),
      `${label}: the anchor is not in src/server/server.js exactly once — the control has drifted off the seam it breaks`);
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

control('NC1 the server-side project guard is removed', 1,
  'the refusal uses the repository\'s no-project status',
  { from: GUARD, to: '' });

/* The whole C3 region, from the first guard to the end of the second, taken from the file as
   it ships (the explanatory comment between them included), replaced by the four lines
   3b20a4f had. An empty span — either guard missing — is refused rather than applied. */
const C3_REGION = (() => {
  const source = fs.readFileSync(SERVER, 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf(GUARD), end = source.indexOf(UNREADABLE_GUARD);
  return start >= 0 && end > start ? source.slice(start, end + UNREADABLE_GUARD.length) : '\u0000missing C3 region\u0000';
})();
/* NC2 and NC5 once ended the process. Since FIRST_RUN_SETTINGS_SERVER_SURVIVAL_V1 the
   async route boundary (src/server/async-route-boundary.js) answers an unguarded read
   with a generic 500 and the server survives, so what still catches them is the refusal
   contract itself: a 500 is not the 404 or 422 this route owes. */
control('NC2 the pristine handler is restored — no guard at all, the read unprotected', 1,
  'the refusal uses the repository\'s no-project status (GET /api/project answers 404), got 500',
  { from: C3_REGION,
    to: '  const q = String(req.body.q || "").trim();\n  if (!q) return res.json({ mode: "none", results: [] });\n' + PRISTINE_READ });

control('NC3 a no-project search answers a false success instead of a refusal', 1,
  'a no-project search must be REFUSED, but it answered 200',
  { from: REFUSAL_RETURN, to: '    return res.json({ mode: "none", results: [] });\n' });

control('NC4 the file-not-found detail and local path leak into the refusal', 2,
  'the refusal body leaks',
  { from: MESSAGE_LINE,
    to: '      error: "No project is open, so there is nothing to search. Create a project or open an existing one first."'
      + ' + (() => { try { readJsonSync(DATA()); return ""; } catch (e) { return " (" + e.message + ")"; } })(),\n' });

control('NC5 an open project that cannot be read is no longer refused as unreadable', 5,
  'an unreadable open project must be refused with 422, got 500',
  { from: UNREADABLE_GUARD, to: PRISTINE_READ });

/* The controls patched memory, never the file. Proven, not asserted in prose. */
try {
  assert.strictEqual(digest(), SERVER_DIGEST, 'src/server/server.js changed on disk during the controls — they must patch in memory only');
  notes.push('  src/server/server.js is byte-identical before and after every control');
} catch (error) { failures += 1; console.error(`  FAIL ${error.message}`); }

console.log(notes.join('\n'));
if (failures) {
  console.error(`FAIL no-project search refusal negative controls: ${failures} control(s) did not behave.`);
  process.exit(1);
}
console.log('PASS no-project search refusal negative controls: every rebuilt defect is caught by the assertion that owns it.');

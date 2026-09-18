'use strict';
/* THE NODE SIDE OF THE ONE MANAGED BROWSER RUNTIME.

   `npm run setup:browser-tests` installs Playwright - pinned in tests/browser-requirements.txt -
   into the project-managed .venv-browser, and proves its Chromium launches. That Python package
   already ships the Node driver it runs on (playwright/driver/package), so the Node-based browser
   suites use exactly that driver instead of a second, separately versioned Playwright from npm:
   one pin, one Chromium, and a layout assertion that means the same thing on a workstation as on
   a Windows CI runner.

   `playwright` is deliberately not an npm dependency, so a bare require('playwright') found
   nothing on a clean checkout, and on PR #74 three gated suites died on MODULE_NOT_FOUND halfway
   through the gate - passing only where somebody's shell happened to export
   CINEBRAID_PLAYWRIGHT_MODULE. The repository now finds its own driver.

   RESOLUTION ORDER, AND WHY EACH STEP EXISTS
     1. CINEBRAID_PLAYWRIGHT_MODULE - an explicit override, for a deliberately different driver.
     2. The managed venv's bundled driver - the canonical answer once setup has run.
     3. A project-level `playwright` package, if one is ever installed.
   Finding none is a named setup failure that says what to run, never a MODULE_NOT_FOUND. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SETUP = 'Run `npm run setup:browser-tests` to create the project-managed browser runtime, then re-run this check.';

/* Where pip puts the package: Lib\site-packages on Windows, lib/pythonX.Y/site-packages elsewhere. */
function managedDriverPaths(root = ROOT) {
  const venv = path.join(root, '.venv-browser');
  const candidates = [path.join(venv, 'Lib', 'site-packages', 'playwright', 'driver', 'package')];
  const lib = path.join(venv, 'lib');
  if (fs.existsSync(lib)) {
    for (const entry of fs.readdirSync(lib).sort()) {
      if (/^python3/.test(entry)) candidates.push(path.join(lib, entry, 'site-packages', 'playwright', 'driver', 'package'));
    }
  }
  return candidates;
}

/* Which driver would be used, without loading it: { from, source } or { error }. */
function locatePlaywright(root = ROOT) {
  const override = String(process.env.CINEBRAID_PLAYWRIGHT_MODULE || '').trim();
  if (override) return { from: override, source: 'CINEBRAID_PLAYWRIGHT_MODULE' };
  for (const candidate of managedDriverPaths(root)) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return { from: candidate, source: 'managed .venv-browser driver' };
  }
  try {
    return { from: require.resolve('playwright', { paths: [root] }), source: 'project playwright package' };
  } catch {
    return { error: `No Playwright driver for the Node browser suites. ${SETUP}` };
  }
}

/* The loaded module, or a named failure. `label` names the suite asking. */
function requirePlaywright(label = 'browser suite') {
  const found = locatePlaywright();
  if (found.error) throw new Error(`${label}: ${found.error}`);
  try {
    return require(found.from);
  } catch (error) {
    throw new Error(`${label}: the Playwright driver at ${found.from} (${found.source}) could not be loaded: ${error.message}. ${SETUP}`);
  }
}

module.exports = { locatePlaywright, requirePlaywright, managedDriverPaths };

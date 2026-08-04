const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, buildFixture } = require('./render-harness');

(async () => {
  const assisted = buildFixture();
  assisted.meta.workflowEmphasis = 'assisted';
  const result = await render('#/shot/L1-01', assisted);
  assert(result.html.includes('Build, generate, or automate a greyscale composition guide'), 'blocking workspace must explain generation and automation');
  assert(result.html.includes('AUTOMATE BLOCKING'), 'assisted blocking workspace must expose standalone automation');
  assert(result.html.includes('Build Prompt reveals the paid Generate action'), 'blocking workspace must explain where manual generation appears');

  result.context.openBlockingAutomationModal('L1-01');
  const modal = result.context.document.getElementById('modal').innerHTML;
  assert(modal.includes('Plan blocking automation'), 'blocking automation planner must open from Look & blocking');
  assert(modal.includes('START BLOCKING AUTOMATION'), 'blocking automation planner must retain its primary action');
  assert(modal.includes('NO FINISHED STILL'), 'blocking automation must state its limited scope');

  const manual = buildFixture();
  manual.meta.workflowEmphasis = 'manual';
  const manualResult = await render('#/shot/L1-01', manual);
  const assistedDetails = manualResult.html.match(/<details class="guided-assisted-tools blocking-assisted-tools"([^>]*)>/i);
  assert(assistedDetails && !/\bopen\b/i.test(assistedDetails[1] || ''), 'manual-first must keep blocking automation inside the collapsed optional assisted area');

  const automationSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'automation.js'), 'utf8');
  assert(automationSource.includes('scope === "blocking-only"'), 'shot automation runner must dispatch blocking-only runs');
  assert(automationSource.includes('await v626OpeningBlocking(run, run.targetId)'), 'blocking-only automation must reuse the bounded opening-blocking pipeline');

  console.log('Blocking automation discoverability passed: manual generation guidance, standalone bounded automation, manual-first collapse, and runner dispatch are present.');
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

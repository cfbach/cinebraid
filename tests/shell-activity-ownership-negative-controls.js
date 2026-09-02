/* NEGATIVE CONTROLS FOR SHELL / ACTIVITY OWNERSHIP — A1.
 *
 * A1 removed a surface, and removing a surface is the kind of change that reverts by
 * accident: a caller comes back, a control gets copied into the wrong owner, a
 * renderer regrows the list it was relieved of. Each control below reintroduces ONE
 * of those, IN MEMORY, runs the real detector against the broken source, and requires
 * the named failure.
 *
 * WHAT "RETIRED" MEANS HERE, and why these are source controls rather than pixel ones:
 * the drawer was retired as an OWNER. A CSS-hidden drawer would still be an owner, so
 * a control that looked at visibility would pass against exactly the regression this
 * slice exists to prevent. These read ownership — who renders it, who can open it, who
 * holds the controls — which is the property that actually moved.
 *
 * NOTHING IN THE WORKING TREE IS WRITTEN. NO PROJECT DATA IS TOUCHED. NO PROVIDER,
 * MODEL OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const toLF = (text) => String(text).split("\r\n").join("\n");

let controls = 0;
const notes = [];

/* THE PROBE RECEIPT. A plain Error rather than an assertion: a control whose anchor
   has moved must fail the suite loudly, not be mistaken for the thing firing. */
function mutate(text, needle, replacement, label, expected = 1) {
  const body = toLF(text);
  const anchor = toLF(needle);
  const hits = body.split(anchor).length - 1;
  if (hits !== expected) {
    throw new Error(`probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.");
  }
  return body.split(anchor).join(toLF(replacement));
}

/* ===========================================================================
   THE DETECTORS. Each is the real rule, run over a source map so a control can
   hand it a broken one. Every detector is exercised against the SHIPPED sources
   first, so a rule that cannot hold is caught before it is trusted to break.
   =========================================================================== */
const SOURCES = () => ({
  markup: read("public/index.html"),
  activity: read("public/live-activity.js"),
  surfaces: read("public/creator-surfaces.js"),
  automation: read("public/automation.js"),
  entities: read("public/entities.js"),
  focused: read("public/focused-workspaces.js"),
  braidy: read("public/shared-braidy.js"),
  scene: read("public/scene-automation.js"),
});

/* SA-2 / SA-11 — the drawer is retired as an owner. Not hidden: absent, with nothing
   left that can render it or mount it. */
function checkDrawerIsRetired(sources) {
  assert.ok(!/id="automation-activity-drawer"/.test(sources.markup),
    "the retired Global Activity drawer must not be mounted in index.html");
  assert.ok(!/function v641RenderActivityDrawer\b/.test(toLF(sources.activity)),
    "nothing may still render the retired drawer");
  assert.ok(!/window\.openGlobalAutomationActivity\s*=/.test(toLF(sources.activity)),
    "the retired drawer must have no opener");
}

/* SA-10 — no caller survives, including the two that opened it on a timer with no
   user gesture. A compatibility shim would satisfy a grep for the element and still
   be the old behaviour, so this reads the CALL. */
function checkNoDrawerCallers(sources) {
  for (const [name, text] of Object.entries(sources)) {
    if (name === "markup") continue;
    assert.ok(!/openGlobalAutomationActivity/.test(toLF(text)),
      `public source "${name}" still calls openGlobalAutomationActivity; the drawer has no owner to open`);
  }
}

/* SA-3 — every capability the drawer alone used to own has a surviving owner, and
   that owner is the Activity Terminal. */
function checkDrawerParity(sources) {
  const surfaces = toLF(sources.surfaces);
  for (const capability of ["recheckAutomationGateStatus()", "archivePreviousAutomationFailures()", "dismissAutomationActivityRun(", "openAutomationReport("]) {
    assert.ok(surfaces.includes(capability),
      `the Activity Terminal must own ${capability} — it was the retired drawer's alone`);
  }
  /* The fifth one the plan missed: a window listing another project's activity has to
     keep saying so. */
  assert.ok(/cb-terminal-foreign/.test(surfaces),
    "the Terminal must carry the foreign-project warning the drawer used to render");
}

/* SA-4 — the run controls have ONE owner and it is task-local. The Terminal may
   navigate to the task; it may not grow its own copy of the controls, because that
   copy would have to re-derive the lease and the run's identity. */
function checkRunActionsAreTaskLocal(sources) {
  const surfaces = toLF(sources.surfaces);
  for (const action of ["pauseAutomationRun(", "resumeAutomationRun(", "startFreshAutomationRun(", "retryFailedAutomationStep(", "cancelAutomationProviderJob("]) {
    assert.ok(!surfaces.includes(action),
      `the Activity Terminal renders ${action}; the run controls are v626RunActions' alone`);
  }
  assert.ok(/function v626RunActions\(/.test(toLF(sources.automation)),
    "v626RunActions must remain the task-local owner of the run controls");
}

/* SA-1 — the task page is the task. The full run report belongs to Reports. */
function checkTaskPageHasNoRunReport(sources) {
  const automation = toLF(sources.automation);
  const panel = automation.slice(automation.indexOf("function v626AutomationPanel("));
  assert.ok(!/v626RunReportMarkup\(run\)/.test(panel),
    "the task page must not embed the full run report; Reports owns deep evidence");
  assert.ok(!/EXPERIMENTAL · DURABLE/.test(panel),
    "the task page must not present orchestration vocabulary as its heading");
}

/* SA-6 — the Assistant interprets. It does not keep a per-run ledger. */
function checkAssistantIsNotALedger(sources) {
  const surfaces = toLF(sources.surfaces);
  assert.ok(!/function assistantRow\(/.test(surfaces),
    "the Assistant must not render a row per run; that ledger is the Terminal's");
  const markup = surfaces.slice(surfaces.indexOf("function assistantMarkup("));
  const body = markup.slice(0, markup.indexOf("\n  }"));
  assert.ok(!/\.map\(\(fact\)/.test(body),
    "the Assistant must not map over facts into rows");
}

/* SA-8 — one classifier. A surface that hand-writes a status list has become a second
   opinion about what a run is. */
function checkNoHandWrittenStatusLists(sources) {
  /* THE RULE IS "ASK THE PREDICATE", NOT "NEVER WRITE THESE WORDS".
     A1 left the literal in place as the FALLBACK arm of each ternary, because these
     files also load in realms where public/live-activity.js is absent — the same
     defensive shape creator-surfaces.js uses for every cross-file binding. What must
     not exist is a literal that DECIDES on its own, so each line carrying one has to
     consult v670RunUnsettled on that same line. A rule that banned the words would
     have been satisfied by moving them one line up. */
  const literal = /\[\s*"running"\s*,\s*"awaiting-review"/;
  for (const name of ["surfaces", "focused", "scene", "automation"]) {
    for (const line of toLF(sources[name]).split("\n")) {
      if (!literal.test(line)) continue;
      assert.ok(/v670RunUnsettled/.test(line),
        `public source "${name}" decides a run's state from a hand-written status list: ${line.trim().slice(0, 90)}`);
    }
  }
}

const CHECKS = {
  checkDrawerIsRetired,
  checkNoDrawerCallers,
  checkDrawerParity,
  checkRunActionsAreTaskLocal,
  checkTaskPageHasNoRunReport,
  checkAssistantIsNotALedger,
  checkNoHandWrittenStatusLists,
};

/* Every rule must hold against the shipped tree before any control is trusted. */
for (const [name, check] of Object.entries(CHECKS)) {
  check(SOURCES());
  notes.push(`  ${name} holds against the shipped sources`);
}

function control(label, checkName, patch, expectation) {
  controls += 1;
  assert.strictEqual(typeof CHECKS[checkName], "function", `${label} names an unknown check ${checkName}`);
  const sources = { ...SOURCES(), ...patch };
  let failed = false;
  try {
    CHECKS[checkName](sources);
  } catch (error) {
    if (error instanceof assert.AssertionError) failed = true;
    else throw error;
  }
  assert.ok(failed, `${label}: ${checkName} accepted the broken ownership. ${expectation}`);
  notes.push(`  ${label} — ${checkName} failed as required`);
}

/* NC-A1 — the drawer is mounted again. */
control("NC-A1 the retired drawer is mounted back into the shell", "checkDrawerIsRetired",
  { markup: mutate(read("public/index.html"),
      `  <main id="main"></main>`,
      `  <main id="main"></main>\n  <aside id="automation-activity-drawer" class="automation-activity-drawer" aria-hidden="true"></aside>`,
      "NC-A1") },
  "A second global operational surface is the thing this slice removed.");

/* NC-A2 — a caller comes back. Written as the auto-opener, because that is the form
   that returns by accident: a run starting and summoning a console nobody asked for. */
control("NC-A2 a drawer caller is reintroduced", "checkNoDrawerCallers",
  { scene: mutate(read("public/scene-automation.js"),
      `  location.hash = \`#/scene/\${scene.id}\`;\n  runSceneAutomation(saved.id);`,
      `  location.hash = \`#/scene/\${scene.id}\`;\n  setTimeout(() => typeof openGlobalAutomationActivity === "function" && openGlobalAutomationActivity(saved.id), 120);\n  runSceneAutomation(saved.id);`,
      "NC-A2") },
  "A caller with no owner to call is a dead reference at best and the old behaviour at worst.");

/* NC-A3 — the Terminal grows its own copy of the run controls. */
control("NC-A3 the Terminal renders the run controls as well as the task page", "checkRunActionsAreTaskLocal",
  { surfaces: mutate(read("public/creator-surfaces.js"),
      `    const isRun = fact.source === "automation-run" && fact.id;`,
      `    const stop = \`<button type="button" onclick="pauseAutomationRun('shot-chain', '\${fact.target.id}', 'stills')">STOP</button>\`;\n    const isRun = fact.source === "automation-run" && fact.id;`,
      "NC-A3") },
  "Two owners of one stop control means two answers about whether the lease is held here.");

/* NC-A4 — the Assistant grows its per-run rows back. */
control("NC-A4 the Assistant renders a row per run again", "checkAssistantIsNotALedger",
  { surfaces: mutate(read("public/creator-surfaces.js"),
      `  function assistantCountLine(state) {`,
      `  function assistantRow(fact) { return \`<article class="cb-assistant-row">\${esc(fact.label)}</article>\`; }\n  function assistantCountLine(state) {`,
      "NC-A4") },
  "A rail that lists runs is a second chronological feed of the ledger below it.");

/* NC-A5 — a hand-written status list reappears in the A1 presentation boundary. */
control("NC-A5 a manual status-literal classifier returns", "checkNoHandWrittenStatusLists",
  { focused: mutate(read("public/focused-workspaces.js"),
      `(typeof window.v670RunUnsettled === "function" ? window.v670RunUnsettled(row) : ["running", "awaiting-review", "failed"].includes(row.status))`,
      `["running", "awaiting-review", "failed"].includes(row.status)`,
      "NC-A5") },
  "A second status list drifts from the shipped predicates exactly where they already disagree.");

/* NC-A6 — a drawer-only capability is dropped rather than rehomed. This is the one
   that catches a retirement done by deletion instead of by parity. */
control("NC-A6 a drawer-only capability loses its owner", "checkDrawerParity",
  { surfaces: mutate(read("public/creator-surfaces.js"),
      `onclick="recheckAutomationGateStatus()"`,
      `onclick="void 0"`,
      "NC-A6") },
  "Retiring a surface without rehoming what only it could do is a capability deletion wearing a convergence's clothes.");

/* NC-A7 — the full run report returns to the task page. */
control("NC-A7 the task page embeds the run report again", "checkTaskPageHasNoRunReport",
  { automation: mutate(read("public/automation.js"),
      `<div class="creation-actions automation-actions">\${v626RunActions(run, type, targetId, scope, startMarkup)}</div></section>\`;`,
      `<div class="creation-actions automation-actions">\${v626RunActions(run, type, targetId, scope, startMarkup)}</div>\${v626RunReportMarkup(run)}</section>\`;`,
      "NC-A7") },
  "Starting AI help must add assistance, not replace the workspace with a process console.");

for (const line of notes) console.log(line);
console.log(`\n${controls} controls, all ${Object.keys(CHECKS).length} ownership rules driven to failure.`);
console.log("shell / activity ownership negative controls passed");
console.log("No file in the working tree was modified. Provider calls made: 0.");
